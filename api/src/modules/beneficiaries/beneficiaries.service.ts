import type { DataSource } from 'typeorm';
import { isValidClabe, maskClabe, type CreateBeneficiaryInput } from '@treo/shared';
import { inTransaction } from '../../db/data-source';
import { Account } from '../../db/entities/account.entity';
import { Beneficiary } from '../../db/entities/beneficiary.entity';
import { AppError } from '../../lib/problem';
import { pgCode, pgConstraint } from '../../lib/db-errors';
import type { AuditService, RequestContext } from '../audit/audit.service';

export interface BeneficiaryView {
  id: string;
  name: string;
  alias: string;
  clabe: string;
  created_at: string;
}

function toView(b: Beneficiary): BeneficiaryView {
  return {
    id: b.id,
    name: b.name,
    alias: b.alias,
    clabe: b.clabe,
    created_at: b.createdAt.toISOString(),
  };
}

const alreadyExists = () =>
  new AppError('BENEFICIARY_ALREADY_EXISTS', 409, 'Ya tienes un beneficiario con esa CLABE');

export class BeneficiariesService {
  constructor(
    private readonly ds: DataSource,
    private readonly audit: AuditService,
  ) {}

  async list(userId: string): Promise<BeneficiaryView[]> {
    const rows = await this.ds.getRepository(Beneficiary).find({
      where: { userId },
      order: { alias: 'ASC' },
    });
    return rows.map(toView);
  }

  /** R3.1–R3.5, R3.8 (supuesto A-2: solo CLABEs de cuentas activas de la plataforma). */
  async create(
    userId: string,
    input: CreateBeneficiaryInput,
    ctx: RequestContext,
  ): Promise<BeneficiaryView> {
    if (!isValidClabe(input.clabe)) {
      throw new AppError(
        'INVALID_CLABE_CHECK_DIGIT',
        422,
        'El dígito verificador de la CLABE no es válido',
      );
    }
    try {
      return await inTransaction(this.ds, async (m) => {
        const account = await m
          .getRepository(Account)
          .findOneBy({ clabe: input.clabe, kind: 'USER' });
        if (!account || account.status !== 'ACTIVE') {
          throw new AppError(
            'CLABE_NOT_FOUND',
            422,
            'La CLABE no corresponde a una cuenta de la plataforma',
          );
        }
        if (account.userId === userId) {
          throw new AppError(
            'BENEFICIARY_IS_OWN_ACCOUNT',
            422,
            'La CLABE es de una cuenta propia; ya puedes transferirle directamente',
          );
        }
        if (await m.existsBy(Beneficiary, { userId, clabe: input.clabe })) throw alreadyExists();

        const inserted = await m
          .createQueryBuilder()
          .insert()
          .into(Beneficiary)
          .values({
            userId,
            accountId: account.id,
            name: input.name,
            alias: input.alias,
            clabe: input.clabe,
          })
          .returning(['id'])
          .execute();
        const id = (inserted.raw as Array<{ id: string }>)[0]!.id;
        await this.audit.record(m, ctx, {
          action: 'beneficiary.created',
          actorUserId: userId,
          entityType: 'beneficiary',
          entityId: id,
          metadata: { clabe_masked: maskClabe(input.clabe) },
        });
        return toView(await m.findOneByOrFail(Beneficiary, { id }));
      });
    } catch (err) {
      // Carrera entre dos altas simultáneas: el UNIQUE de la base decide.
      if (pgCode(err) === '23505' && pgConstraint(err) === 'beneficiaries_user_clabe_key')
        throw alreadyExists();
      throw err;
    }
  }
}
