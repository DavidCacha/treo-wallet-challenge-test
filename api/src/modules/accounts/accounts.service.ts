import type { DataSource } from 'typeorm';
import type { AppConfig } from '../../config/env';
import { Account } from '../../db/entities/account.entity';
import { User } from '../../db/entities/user.entity';
import { AppError } from '../../lib/problem';
import { usedTodayCents } from '../transfers/daily-limit';
import { toPublicUser, type PublicUser } from '../auth/auth.service';

export interface AccountView {
  id: string;
  name: string;
  clabe: string;
  currency: 'MXN';
  available_balance_cents: number;
  status: 'ACTIVE' | 'BLOCKED';
}

export interface MeView extends PublicUser {
  daily_limit_cents: number;
  used_today_cents: number;
  otp_threshold_cents: number;
  business_timezone: string;
}

export function toAccountView(a: Account): AccountView {
  return {
    id: a.id,
    name: a.name,
    clabe: a.clabe,
    currency: 'MXN',
    available_balance_cents: a.balanceCents,
    status: a.status,
  };
}

export class AccountsService {
  constructor(
    private readonly ds: DataSource,
    private readonly config: AppConfig,
  ) {}

  /** R2.1: solo cuentas del usuario (nunca la cuenta SYSTEM). */
  async list(userId: string): Promise<AccountView[]> {
    const accounts = await this.ds.getRepository(Account).find({
      where: { userId, kind: 'USER' },
      order: { createdAt: 'ASC', name: 'DESC' },
    });
    return accounts.map(toAccountView);
  }

  /** R2.3: una cuenta ajena responde 404, igual que una inexistente. */
  async getOwned(userId: string, accountId: string): Promise<AccountView> {
    const account = await this.ds
      .getRepository(Account)
      .findOneBy({ id: accountId, userId, kind: 'USER' });
    if (!account) throw new AppError('NOT_FOUND', 404, 'Cuenta no encontrada');
    return toAccountView(account);
  }

  /** R6.8: límite diario, consumo de hoy y umbral de OTP. */
  async me(userId: string): Promise<MeView> {
    const user = await this.ds.getRepository(User).findOneBy({ id: userId });
    if (!user) throw new AppError('UNAUTHORIZED', 401, 'Usuario no encontrado');
    return {
      ...toPublicUser(user),
      daily_limit_cents: user.dailyLimitCents,
      used_today_cents: await usedTodayCents(
        this.ds.manager,
        userId,
        this.config.BUSINESS_TIMEZONE,
      ),
      otp_threshold_cents: this.config.OTP_THRESHOLD_CENTS,
      business_timezone: this.config.BUSINESS_TIMEZONE,
    };
  }
}
