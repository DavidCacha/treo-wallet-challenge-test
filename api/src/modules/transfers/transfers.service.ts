import { randomUUID } from 'node:crypto';
import type { DataSource, EntityManager } from 'typeorm';
import type { CreateTransferInput } from '@treo/shared';
import type { AppConfig } from '../../config/env';
import { inTransaction } from '../../db/data-source';
import { Account } from '../../db/entities/account.entity';
import { Beneficiary } from '../../db/entities/beneficiary.entity';
import { Transfer, type TransferKind } from '../../db/entities/transfer.entity';
import { User } from '../../db/entities/user.entity';
import { AppError } from '../../lib/problem';
import { isRetryableLockError, pgCode, pgConstraint } from '../../lib/db-errors';
import type { AuditService, RequestContext } from '../audit/audit.service';
import { usedTodayCents } from './daily-limit';
import { postTransferEntries } from './ledger';
import { decideTransfer } from './policy';
import { transferRequestHash } from './request-hash';
import { newTrackingCode } from './tracking';
import { loadTransferView, type TransferView } from './transfer-view';

export interface TransferOutcome {
  transfer: TransferView;
  /** true si la respuesta corresponde a una llave de idempotencia ya usada. */
  replayed: boolean;
}

const MAX_ATTEMPTS = 3;

function isIdempotencyRace(err: unknown): boolean {
  return pgCode(err) === '23505' && pgConstraint(err) === 'transfers_idempotency_key_unique';
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export class TransfersService {
  constructor(
    private readonly ds: DataSource,
    private readonly config: AppConfig,
    private readonly audit: AuditService,
  ) {}

  /**
   * POST /transfers (design.md §5.1). Todo ocurre en UNA transacción READ COMMITTED:
   *  1. FOR UPDATE de la fila del usuario → serializa sus transferencias salientes
   *     (idempotencia y límite diario sin carreras).
   *  2. Si la llave ya existe: mismo hash → repetir; otro hash → 422.
   *  3. FOR UPDATE de las cuentas en orden ascendente de id → sin deadlocks.
   *  4. Reglas (función pura) → REJECTED / PENDING_OTP / COMPLETED + asientos.
   */
  async create(
    userId: string,
    idempotencyKey: string,
    input: CreateTransferInput,
    ctx: RequestContext,
  ): Promise<TransferOutcome> {
    const requestHash = transferRequestHash(input);
    return this.withRetry(() =>
      inTransaction(this.ds, async (m) => {
        await this.setLockTimeout(m);
        const user = await this.lockUser(m, userId);

        const existing = await m.findOneBy(Transfer, { userId, idempotencyKey });
        if (existing) {
          if (existing.requestHash !== requestHash) {
            throw new AppError(
              'IDEMPOTENCY_KEY_REUSED',
              422,
              'La llave de idempotencia ya se usó con un contenido distinto',
            );
          }
          return { transfer: await this.view(m, existing.id, userId), replayed: true };
        }

        // Destino: beneficiario propio (P2P) u otra cuenta propia (OWN_ACCOUNTS).
        let destinationAccountId: string;
        let beneficiaryId: string | null = null;
        let kind: Exclude<TransferKind, 'DEPOSIT'>;
        if (input.beneficiary_id) {
          const beneficiary = await m.findOneBy(Beneficiary, { id: input.beneficiary_id, userId });
          if (!beneficiary) throw new AppError('NOT_FOUND', 404, 'Beneficiario no encontrado');
          destinationAccountId = beneficiary.accountId;
          beneficiaryId = beneficiary.id;
          kind = 'P2P';
        } else {
          destinationAccountId = input.destination_account_id!;
          kind = 'OWN_ACCOUNTS';
        }
        if (destinationAccountId === input.source_account_id) {
          throw new AppError(
            'SAME_ACCOUNT_TRANSFER',
            422,
            'La cuenta origen y destino no pueden ser la misma',
          );
        }

        const [source, destination] = await this.lockAccounts(
          m,
          input.source_account_id,
          destinationAccountId,
        );
        if (!source || source.kind !== 'USER' || source.userId !== userId) {
          throw new AppError('NOT_FOUND', 404, 'Cuenta origen no encontrada');
        }
        if (
          !destination ||
          destination.kind !== 'USER' ||
          (kind === 'OWN_ACCOUNTS' && destination.userId !== userId)
        ) {
          throw new AppError('NOT_FOUND', 404, 'Cuenta destino no encontrada');
        }

        const decision = decideTransfer({
          transferKind: kind,
          amountCents: input.amount_cents,
          sourceBalanceCents: source.balanceCents,
          sourceStatus: source.status,
          destinationStatus: destination.status,
          usedTodayCents:
            kind === 'P2P' ? await usedTodayCents(m, userId, this.config.BUSINESS_TIMEZONE) : 0,
          dailyLimitCents: user.dailyLimitCents,
          otpThresholdCents: this.config.OTP_THRESHOLD_CENTS,
          otpVerified: false,
        });

        const base = {
          id: randomUUID(),
          userId,
          idempotencyKey,
          requestHash,
          kind,
          sourceAccountId: source.id,
          destinationAccountId: destination.id,
          beneficiaryId,
          amountCents: input.amount_cents,
          concept: input.concept,
          reference: input.reference,
          trackingCode: newTrackingCode(),
          countsTowardLimit: kind === 'P2P',
        };

        switch (decision.kind) {
          case 'reject': {
            // Se persiste para que reintentos con la misma llave den el mismo resultado (A-5).
            await m.insert(Transfer, { ...base, status: 'REJECTED', rejectionCode: decision.code });
            await this.audit.record(m, ctx, {
              action: 'transfer.rejected',
              actorUserId: userId,
              entityType: 'transfer',
              entityId: base.id,
              metadata: { code: decision.code, amount_cents: base.amountCents },
            });
            break;
          }
          case 'require_otp':
            throw new AppError('NOT_IMPLEMENTED', 501, 'Confirmación OTP pendiente de implementar');
          case 'execute': {
            await m
              .createQueryBuilder()
              .insert()
              .into(Transfer)
              .values({ ...base, status: 'COMPLETED', completedAt: () => 'now()' })
              .execute();
            await postTransferEntries(m, base);
            await this.audit.record(m, ctx, {
              action: 'transfer.completed',
              actorUserId: userId,
              entityType: 'transfer',
              entityId: base.id,
              metadata: { amount_cents: base.amountCents, kind },
            });
            break;
          }
        }
        return { transfer: await this.view(m, base.id, userId), replayed: false };
      }),
    );
  }

  /** R4.13: estado y comprobante de una transferencia propia. */
  async get(userId: string, transferId: string): Promise<TransferView> {
    return this.view(this.ds.manager, transferId, userId);
  }

  private async view(m: EntityManager, transferId: string, userId: string): Promise<TransferView> {
    const view = await loadTransferView(m, transferId, userId);
    if (!view) throw new AppError('NOT_FOUND', 404, 'Transferencia no encontrada');
    return view;
  }

  private async setLockTimeout(m: EntityManager): Promise<void> {
    const ms = Math.trunc(this.config.LOCK_TIMEOUT_MS);
    await m.query(`SET LOCAL lock_timeout = ${ms}`);
  }

  private async lockUser(m: EntityManager, userId: string): Promise<User> {
    const user = await m
      .getRepository(User)
      .createQueryBuilder('u')
      .setLock('pessimistic_write')
      .where('u.id = :userId', { userId })
      .getOne();
    if (!user) throw new AppError('UNAUTHORIZED', 401, 'Usuario no encontrado');
    return user;
  }

  /** Bloquea ambas cuentas en orden ascendente de id (orden determinista → sin deadlocks). */
  private async lockAccounts(
    m: EntityManager,
    sourceId: string,
    destinationId: string,
  ): Promise<[Account | undefined, Account | undefined]> {
    const rows = await m
      .getRepository(Account)
      .createQueryBuilder('a')
      .where('a.id IN (:...ids)', { ids: [sourceId, destinationId] })
      .orderBy('a.id', 'ASC')
      .setLock('pessimistic_write')
      .getMany();
    return [rows.find((a) => a.id === sourceId), rows.find((a) => a.id === destinationId)];
  }

  /**
   * Reintenta la transacción completa ante deadlock/lock timeout (no deberían
   * ocurrir por el orden de bloqueo) o ante la carrera de idempotencia (la segunda
   * vuelta encuentra la fila y repite la respuesta).
   */
  private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await fn();
      } catch (err) {
        const retryable = isRetryableLockError(err) || isIdempotencyRace(err);
        if (!retryable || attempt >= MAX_ATTEMPTS) throw err;
        await sleep(10 * 2 ** attempt + Math.floor(Math.random() * 10));
      }
    }
  }
}
