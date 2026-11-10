import { randomUUID } from 'node:crypto';
import type { DataSource, EntityManager } from 'typeorm';
import type { LoginInput, RegisterInput } from '@treo/shared';
import type { AppConfig } from '../../config/env';
import { inTransaction } from '../../db/data-source';
import { User } from '../../db/entities/user.entity';
import { Account } from '../../db/entities/account.entity';
import { RefreshToken } from '../../db/entities/refresh-token.entity';
import { AppError } from '../../lib/problem';
import { pgCode, pgConstraint } from '../../lib/db-errors';
import { AuditService, type RequestContext } from '../audit/audit.service';
import { generateUniqueClabe } from '../accounts/clabe-generator';
import { burnPasswordCheck, hashPassword, verifyPassword } from './passwords';
import { newRefreshTokenValue, sha256Hex, type TokenService } from './tokens';

export interface PublicUser {
  id: string;
  email: string;
  full_name: string;
  created_at: string;
}

export interface IssuedTokens {
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
}

export const DEFAULT_ACCOUNT_NAMES = ['Principal', 'Ahorro'] as const;

export function toPublicUser(u: User): PublicUser {
  return { id: u.id, email: u.email, full_name: u.fullName, created_at: u.createdAt.toISOString() };
}

const INVALID_CREDENTIALS = () =>
  new AppError('INVALID_CREDENTIALS', 401, 'Correo o contraseña incorrectos');

export class AuthService {
  constructor(
    private readonly ds: DataSource,
    private readonly config: AppConfig,
    private readonly tokens: TokenService,
    private readonly audit: AuditService,
  ) {}

  /** R1.1–R1.3: crea usuario + cuentas Principal y Ahorro (A-1) en una transacción. */
  async register(input: RegisterInput, ctx: RequestContext): Promise<PublicUser> {
    const passwordHash = await hashPassword(input.password);
    try {
      return await inTransaction(this.ds, async (m) => {
        const inserted = await m
          .createQueryBuilder()
          .insert()
          .into(User)
          .values({
            email: input.email,
            fullName: input.full_name,
            passwordHash,
            dailyLimitCents: this.config.DEFAULT_DAILY_LIMIT_CENTS,
          })
          .returning(['id'])
          .execute();
        const userId = (inserted.raw as Array<{ id: string }>)[0]!.id;
        for (const name of DEFAULT_ACCOUNT_NAMES) {
          const clabe = await generateUniqueClabe(m, this.config.CLABE_PREFIX);
          await m.insert(Account, { userId, kind: 'USER', name, clabe, status: 'ACTIVE' });
        }
        await this.audit.record(m, ctx, {
          action: 'user.registered',
          actorUserId: userId,
          entityType: 'user',
          entityId: userId,
        });
        const user = await m.findOneByOrFail(User, { id: userId });
        return toPublicUser(user);
      });
    } catch (err) {
      if (pgCode(err) === '23505' && pgConstraint(err) === 'users_email_key') {
        throw new AppError('EMAIL_ALREADY_REGISTERED', 409, 'El correo ya está registrado');
      }
      throw err;
    }
  }

  /** R1.4, R1.5: mismo error y tiempo comparable para correo inexistente o contraseña errónea. */
  async login(input: LoginInput, ctx: RequestContext): Promise<IssuedTokens> {
    const user = await this.ds
      .getRepository(User)
      .createQueryBuilder('u')
      .addSelect('u.passwordHash')
      .where('u.email = :email', { email: input.email })
      .getOne();

    const ok = user ? await verifyPassword(user.passwordHash, input.password) : false;
    if (!user) await burnPasswordCheck(input.password);

    if (!user || !ok) {
      await this.audit.record(this.ds.manager, ctx, {
        action: 'auth.login_failed',
        actorUserId: user?.id ?? null,
        metadata: { email_sha256: sha256Hex(input.email) },
      });
      throw INVALID_CREDENTIALS();
    }

    return inTransaction(this.ds, async (m) => {
      const issued = await this.issueTokens(m, user.id, randomUUID());
      await this.audit.record(m, ctx, {
        action: 'auth.login_succeeded',
        actorUserId: user.id,
        entityType: 'user',
        entityId: user.id,
      });
      return issued;
    });
  }

  private async issueTokens(
    m: EntityManager,
    userId: string,
    familyId: string,
  ): Promise<IssuedTokens> {
    const refreshToken = newRefreshTokenValue();
    const inserted = await m
      .createQueryBuilder()
      .insert()
      .into(RefreshToken)
      .values({
        userId,
        familyId,
        tokenHash: sha256Hex(refreshToken),
        expiresAt: this.tokens.refreshExpiry(),
      })
      .returning(['id'])
      .execute();
    void inserted;
    return {
      accessToken: this.tokens.signAccess(userId),
      expiresIn: this.tokens.accessTtlSeconds,
      refreshToken,
    };
  }
}
