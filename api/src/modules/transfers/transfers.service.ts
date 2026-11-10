import { randomUUID } from 'node:crypto';
import type { DataSource, EntityManager } from 'typeorm';
import type { Logger } from 'pino';
import type { CreateTransferInput } from '@treo/shared';
import type { AppConfig } from '../../config/env';
import { inTransaction } from '../../db/data-source';
import { Account } from '../../db/entities/account.entity';
import { Beneficiary } from '../../db/entities/beneficiary.entity';
import { Transfer, type TransferKind } from '../../db/entities/transfer.entity';
import { User } from '../../db/entities/user.entity';
import { OtpChallenge } from '../../db/entities/otp-challenge.entity';
import { AppError } from '../../lib/problem';
import { isRetryableLockError, pgCode, pgConstraint } from '../../lib/db-errors';
import type { AuditService, RequestContext } from '../audit/audit.service';
import { usedTodayCents } from './daily-limit';
import { postTransferEntries } from './ledger';
import { decideTransfer, type RejectionCode } from './policy';
import { generateOtpCode, hashOtp, verifyOtp } from './otp';
import { transferRequestHash } from './request-hash';
import { newTrackingCode } from './tracking';
import { loadTransferView, type TransferView } from './transfer-view';

export interface TransferOutcome {
  transfer: TransferView;
  /** true si la respuesta corresponde a una llave de idempotencia ya usada. */
  replayed: boolean;
}

const MAX_ATTEMPTS = 3;

interface ConfirmResult {
  view: TransferView;
  error?: { code: 'OTP_INVALID' | 'OTP_EXPIRED' | RejectionCode; attemptsRemaining?: number };
}

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
    private readonly logger?: Logger,
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
          case 'require_otp': {
            // R6.3: no se mueve dinero ni se aparta saldo (A-6); se revalida al confirmar.
            await m.insert(Transfer, { ...base, status: 'PENDING_OTP' });
            const code = generateOtpCode();
            const ttl = Math.trunc(this.config.OTP_TTL_SECONDS);
            await m
              .createQueryBuilder()
              .insert()
              .into(OtpChallenge)
              .values({
                transferId: base.id,
                codeHash: hashOtp(this.config.OTP_PEPPER, base.id, code),
                attempts: 0,
                maxAttempts: this.config.OTP_MAX_ATTEMPTS,
                expiresAt: () => `now() + interval '${ttl} seconds'`,
              })
              .execute();
            await this.audit.record(m, ctx, {
              action: 'transfer.created',
              actorUserId: userId,
              entityType: 'transfer',
              entityId: base.id,
              metadata: { amount_cents: base.amountCents, status: 'PENDING_OTP' },
            });
            await this.audit.record(m, ctx, {
              action: 'otp.issued',
              actorUserId: userId,
              entityType: 'transfer',
              entityId: base.id,
            });
            const view = await this.view(m, base.id, userId);
            // Entrega simulada (A-7): solo en desarrollo se expone el código.
            if (this.config.NODE_ENV === 'development' && view.challenge) {
              view.challenge.dev_otp_code = code;
              this.logger?.info(
                { transfer_id: base.id, otp_dev_code: code },
                'OTP simulado (solo desarrollo)',
              );
            }
            return { transfer: view, replayed: false };
          }
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

  /**
   * POST /transfers/{id}/confirm (R6.4–R6.7). Bloquea usuario → transferencia →
   * challenge → cuentas (mismo orden que create). Un intento fallido se confirma
   * (COMMIT) antes de responder el error, para que cuente aunque el cliente reintente.
   */
  async confirm(
    userId: string,
    transferId: string,
    code: string,
    ctx: RequestContext,
  ): Promise<TransferView> {
    const result = await this.withRetry(() =>
      inTransaction(this.ds, async (m): Promise<ConfirmResult> => {
        await this.setLockTimeout(m);
        const user = await this.lockUser(m, userId);
        const transfer = await m
          .getRepository(Transfer)
          .createQueryBuilder('t')
          .setLock('pessimistic_write')
          .where('t.id = :transferId AND t.user_id = :userId', { transferId, userId })
          .getOne();
        if (!transfer) throw new AppError('NOT_FOUND', 404, 'Transferencia no encontrada');

        if (transfer.status === 'COMPLETED') {
          return { view: await this.view(m, transfer.id, userId) }; // R6.7: idempotente
        }
        if (transfer.status === 'REJECTED') {
          throw new AppError('TRANSFER_NOT_PENDING', 409, 'La transferencia ya fue rechazada');
        }
        if (transfer.status === 'EXPIRED') {
          return { view: await this.view(m, transfer.id, userId), error: { code: 'OTP_EXPIRED' } };
        }

        const challenge = await m
          .getRepository(OtpChallenge)
          .createQueryBuilder('c')
          .setLock('pessimistic_write')
          .where('c.transfer_id = :transferId', { transferId })
          .getOneOrFail();
        const nowRows: Array<{ now: Date }> = await m.query(`SELECT now() AS now`);
        const now = nowRows[0]!.now;

        if (
          challenge.expiresAt.getTime() <= now.getTime() ||
          challenge.attempts >= challenge.maxAttempts
        ) {
          await this.expire(m, ctx, transfer);
          return { view: await this.view(m, transfer.id, userId), error: { code: 'OTP_EXPIRED' } };
        }

        if (!verifyOtp(this.config.OTP_PEPPER, transfer.id, code, challenge.codeHash)) {
          const attempts = challenge.attempts + 1;
          await m.update(OtpChallenge, { id: challenge.id }, { attempts });
          await this.audit.record(m, ctx, {
            action: 'otp.failed',
            actorUserId: userId,
            entityType: 'transfer',
            entityId: transfer.id,
            metadata: { attempts },
          });
          if (attempts >= challenge.maxAttempts) {
            await this.expire(m, ctx, transfer);
            return {
              view: await this.view(m, transfer.id, userId),
              error: { code: 'OTP_EXPIRED' },
            };
          }
          return {
            view: await this.view(m, transfer.id, userId),
            error: { code: 'OTP_INVALID', attemptsRemaining: challenge.maxAttempts - attempts },
          };
        }

        // Código válido: un solo uso y revalidación completa con filas bloqueadas (EC-10).
        await m.update(OtpChallenge, { id: challenge.id }, { consumedAt: () => 'now()' });
        const [source, destination] = await this.lockAccounts(
          m,
          transfer.sourceAccountId,
          transfer.destinationAccountId,
        );
        const decision = decideTransfer({
          transferKind: transfer.kind === 'OWN_ACCOUNTS' ? 'OWN_ACCOUNTS' : 'P2P',
          amountCents: transfer.amountCents,
          sourceBalanceCents: source!.balanceCents,
          sourceStatus: source!.status,
          destinationStatus: destination!.status,
          usedTodayCents: transfer.countsTowardLimit
            ? await usedTodayCents(m, userId, this.config.BUSINESS_TIMEZONE)
            : 0,
          dailyLimitCents: user.dailyLimitCents,
          otpThresholdCents: this.config.OTP_THRESHOLD_CENTS,
          otpVerified: true,
        });

        if (decision.kind === 'reject') {
          await m.update(
            Transfer,
            { id: transfer.id },
            { status: 'REJECTED', rejectionCode: decision.code },
          );
          await this.audit.record(m, ctx, {
            action: 'transfer.rejected',
            actorUserId: userId,
            entityType: 'transfer',
            entityId: transfer.id,
            metadata: { code: decision.code, at: 'confirm' },
          });
          return { view: await this.view(m, transfer.id, userId), error: { code: decision.code } };
        }

        await m.update(
          Transfer,
          { id: transfer.id },
          { status: 'COMPLETED', completedAt: () => 'now()' },
        );
        await postTransferEntries(m, transfer);
        await this.audit.record(m, ctx, {
          action: 'transfer.completed',
          actorUserId: userId,
          entityType: 'transfer',
          entityId: transfer.id,
          metadata: { amount_cents: transfer.amountCents, kind: transfer.kind, otp: true },
        });
        return { view: await this.view(m, transfer.id, userId) };
      }),
    );

    if (result.error) {
      const { code: errorCode, attemptsRemaining } = result.error;
      const detail: Record<string, string> = {
        OTP_INVALID: 'Código incorrecto',
        OTP_EXPIRED: 'El código expiró o se agotaron los intentos; inicia una nueva transferencia',
        INSUFFICIENT_FUNDS: 'Saldo insuficiente',
        DAILY_LIMIT_EXCEEDED: 'La operación excede tu límite diario',
        ACCOUNT_BLOCKED: 'Una de las cuentas no está activa',
      };
      throw new AppError(errorCode, 422, detail[errorCode], {
        transfer: result.view,
        ...(attemptsRemaining !== undefined ? { attempts_remaining: attemptsRemaining } : {}),
      });
    }
    return result.view;
  }

  private async expire(m: EntityManager, ctx: RequestContext, transfer: Transfer): Promise<void> {
    await m.update(Transfer, { id: transfer.id }, { status: 'EXPIRED' });
    await this.audit.record(m, ctx, {
      action: 'transfer.expired',
      actorUserId: transfer.userId,
      entityType: 'transfer',
      entityId: transfer.id,
    });
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
