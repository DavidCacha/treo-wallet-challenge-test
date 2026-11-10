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

export interface Services {
  audit: AuditService;
  tokens: TokenService;
  auth: AuthService;
}

export function buildServices(ds: DataSource, config: AppConfig, _logger: Logger): Services {
  const audit = new AuditService();
  const tokens = new TokenService(config);
  const auth = new AuthService(ds, config, tokens, audit);
  return { audit, tokens, auth };
}

/** Ensambla la app Express con todos los módulos (composición manual, sin framework de DI). */
export function buildApp(
  ds: DataSource,
  config: AppConfig,
  logger: Logger,
): { app: Express; services: Services } {
  const services = buildServices(ds, config, logger);
  const auth = authRouter(services.auth, config);
  const app = createApp({
    config,
    logger,
    preSecurity: mountDocs,
    healthCheck: async () => {
      await ds.query('SELECT 1');
    },
    routers: [auth],
  });
  return { app, services };
}
