import type { DataSource } from 'typeorm';
import type { Logger } from 'pino';
import type { Express } from 'express';
import type { AppConfig } from './config/env';
import { createApp } from './http/app';
import { mountDocs } from './http/docs';
import { AuditService } from './modules/audit/audit.service';
import { AuthService } from './modules/auth/auth.service';
import { TokenService } from './modules/auth/tokens';
import { authRouter } from './modules/auth/auth.controller';
import { authenticate } from './http/middleware/authenticate';
import { AccountsService } from './modules/accounts/accounts.service';
import { accountsRouter } from './modules/accounts/accounts.controller';
import { BeneficiariesService } from './modules/beneficiaries/beneficiaries.service';
import { beneficiariesRouter } from './modules/beneficiaries/beneficiaries.controller';
import { TransfersService } from './modules/transfers/transfers.service';

export interface Services {
  audit: AuditService;
  tokens: TokenService;
  auth: AuthService;
  accounts: AccountsService;
  beneficiaries: BeneficiariesService;
  transfers: TransfersService;
}

export function buildServices(ds: DataSource, config: AppConfig, logger: Logger): Services {
  const audit = new AuditService();
  const tokens = new TokenService(config);
  const auth = new AuthService(ds, config, tokens, audit);
  const accounts = new AccountsService(ds, config);
  const beneficiaries = new BeneficiariesService(ds, audit);
  const transfers = new TransfersService(ds, config, audit, logger);
  return { audit, tokens, auth, accounts, beneficiaries, transfers };
}

/** Ensambla la app Express con todos los módulos (composición manual, sin framework de DI). */
export function buildApp(
  ds: DataSource,
  config: AppConfig,
  logger: Logger,
): { app: Express; services: Services } {
  const services = buildServices(ds, config, logger);
  const requireAuth = authenticate(services.tokens);
  const auth = authRouter(services.auth, config);
  const app = createApp({
    config,
    logger,
    preSecurity: mountDocs,
    healthCheck: async () => {
      await ds.query('SELECT 1');
    },
    routers: [
      auth,
      accountsRouter(services.accounts, requireAuth),
      beneficiariesRouter(services.beneficiaries, requireAuth),
    ],
  });
  return { app, services };
}
