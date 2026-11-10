import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { Express } from 'express';
import type { DataSource } from 'typeorm';
import { loadConfig, type AppConfig } from '../../src/config/env';
import { createLogger } from '../../src/lib/logger';
import { buildApp, type Services } from '../../src/container';
import { appDataSource } from './db';

export interface TestContext {
  app: Express;
  ds: DataSource;
  config: AppConfig;
  services: Services;
  close: () => Promise<void>;
}

export async function buildTestApp(
  overrides: Record<string, string> = {},
  poolMax = 25,
): Promise<TestContext> {
  const config = loadConfig({ ...process.env, ...overrides });
  const ds = await appDataSource(poolMax);
  const { app, services } = buildApp(ds, config, createLogger('silent'));
  return { app, ds, config, services, close: () => ds.destroy() };
}

export const PASSWORD = 'Contraseña-Segura-123';

export interface TestUser {
  id: string;
  email: string;
  accessToken: string;
  refreshToken: string;
}

export async function registerAndLogin(app: Express, name = 'Usuario Prueba'): Promise<TestUser> {
  const email = `u-${randomUUID()}@test.dev`;
  const reg = await request(app)
    .post('/api/v1/auth/register')
    .send({ email, full_name: name, password: PASSWORD })
    .expect(201);
  const login = await request(app)
    .post('/api/v1/auth/login')
    .set('X-Client-Platform', 'mobile')
    .send({ email, password: PASSWORD })
    .expect(200);
  return {
    id: reg.body.id,
    email,
    accessToken: login.body.access_token,
    refreshToken: login.body.refresh_token,
  };
}

export function bearer(user: TestUser): Record<string, string> {
  return { Authorization: `Bearer ${user.accessToken}` };
}
