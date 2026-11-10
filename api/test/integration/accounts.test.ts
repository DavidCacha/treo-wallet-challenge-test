import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { bearer, buildTestApp, registerAndLogin, type TestContext } from '../helpers/app';
import { accountsOf, fund } from '../helpers/fund';

let ctx: TestContext;
beforeAll(async () => {
  ctx = await buildTestApp();
});
afterAll(async () => {
  await ctx.close();
});

describe('cuentas y saldo [R2.1–R2.3, R6.8, T-09]', () => {
  it('lista solo las cuentas propias con saldo entero en centavos', async () => {
    const ana = await registerAndLogin(ctx.app);
    const beto = await registerAndLogin(ctx.app);
    const { principal } = await accountsOf(ctx.ds, ana.id);
    await fund(ctx.ds, principal, 123456);

    const res = await request(ctx.app).get('/api/v1/accounts').set(bearer(ana)).expect(200);
    expect(res.body.data).toHaveLength(2);
    const p = res.body.data.find((a: { name: string }) => a.name === 'Principal');
    expect(p).toMatchObject({ currency: 'MXN', available_balance_cents: 123456, status: 'ACTIVE' });
    expect(Number.isInteger(p.available_balance_cents)).toBe(true);
    expect(p.clabe).toMatch(/^\d{18}$/);

    const betoAccounts = await accountsOf(ctx.ds, beto.id);
    const ids = res.body.data.map((a: { id: string }) => a.id);
    expect(ids).not.toContain(betoAccounts.principal);
  });

  it('cuenta ajena → 404 (no 403) [R2.3]', async () => {
    const ana = await registerAndLogin(ctx.app);
    const beto = await registerAndLogin(ctx.app);
    const { principal } = await accountsOf(ctx.ds, beto.id);
    const res = await request(ctx.app).get(`/api/v1/accounts/${principal}`).set(bearer(ana));
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
    const own = await accountsOf(ctx.ds, ana.id);
    await request(ctx.app).get(`/api/v1/accounts/${own.principal}`).set(bearer(ana)).expect(200);
  });

  it('sin token → 401', async () => {
    await request(ctx.app).get('/api/v1/accounts').expect(401);
  });

  it('GET /me expone límite diario, consumo de hoy y umbral OTP', async () => {
    const ana = await registerAndLogin(ctx.app);
    const res = await request(ctx.app).get('/api/v1/me').set(bearer(ana)).expect(200);
    expect(res.body).toMatchObject({
      email: ana.email,
      daily_limit_cents: 5_000_000,
      used_today_cents: 0,
      otp_threshold_cents: 1_000_000,
      business_timezone: 'America/Mexico_City',
    });
  });
});
