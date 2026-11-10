import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildClabe } from '@treo/shared';
import { bearer, buildTestApp, registerAndLogin, type TestContext } from '../helpers/app';

let ctx: TestContext;
beforeAll(async () => {
  ctx = await buildTestApp();
});
afterAll(async () => {
  await ctx.close();
});

async function clabeOf(userId: string): Promise<string> {
  const [row] = await ctx.ds.query(
    `SELECT clabe FROM accounts WHERE user_id = $1 AND name = 'Principal'`,
    [userId],
  );
  return row.clabe;
}

describe('beneficiarios [R3.1–R3.6, R3.8, T-10]', () => {
  it('registra un beneficiario con CLABE válida de la plataforma', async () => {
    const ana = await registerAndLogin(ctx.app);
    const beto = await registerAndLogin(ctx.app);
    const clabe = await clabeOf(beto.id);
    const res = await request(ctx.app)
      .post('/api/v1/beneficiaries')
      .set(bearer(ana))
      .send({ name: 'Beto López', alias: 'Beto', clabe });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ name: 'Beto López', alias: 'Beto', clabe });

    const list = await request(ctx.app).get('/api/v1/beneficiaries').set(bearer(ana)).expect(200);
    expect(list.body.data).toHaveLength(1);
    const otherList = await request(ctx.app)
      .get('/api/v1/beneficiaries')
      .set(bearer(beto))
      .expect(200);
    expect(otherList.body.data).toHaveLength(0);

    const [audit] = await ctx.ds.query(
      `SELECT metadata FROM audit_events WHERE actor_user_id = $1 AND action = 'beneficiary.created'`,
      [ana.id],
    );
    expect(audit.metadata.clabe_masked).toMatch(/^\*{14}\d{4}$/);
  });

  it('dígito verificador incorrecto → 422 INVALID_CLABE_CHECK_DIGIT', async () => {
    const ana = await registerAndLogin(ctx.app);
    const res = await request(ctx.app)
      .post('/api/v1/beneficiaries')
      .set(bearer(ana))
      .send({ name: 'X', alias: 'X', clabe: '002010077777777772' });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('INVALID_CLABE_CHECK_DIGIT');
  });

  it('formato inválido → 400', async () => {
    const ana = await registerAndLogin(ctx.app);
    const res = await request(ctx.app)
      .post('/api/v1/beneficiaries')
      .set(bearer(ana))
      .send({ name: 'X', alias: 'X', clabe: '12345' });
    expect(res.status).toBe(400);
  });

  it('CLABE válida pero fuera de la plataforma → 422 CLABE_NOT_FOUND', async () => {
    const ana = await registerAndLogin(ctx.app);
    const res = await request(ctx.app)
      .post('/api/v1/beneficiaries')
      .set(bearer(ana))
      .send({ name: 'X', alias: 'X', clabe: buildClabe('002010', '99999999999') });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('CLABE_NOT_FOUND');
  });

  it('CLABE propia → 422 BENEFICIARY_IS_OWN_ACCOUNT', async () => {
    const ana = await registerAndLogin(ctx.app);
    const res = await request(ctx.app)
      .post('/api/v1/beneficiaries')
      .set(bearer(ana))
      .send({ name: 'Yo', alias: 'Yo', clabe: await clabeOf(ana.id) });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('BENEFICIARY_IS_OWN_ACCOUNT');
  });

  it('duplicado → 409, también con altas simultáneas', async () => {
    const ana = await registerAndLogin(ctx.app);
    const beto = await registerAndLogin(ctx.app);
    const clabe = await clabeOf(beto.id);
    const send = () =>
      request(ctx.app)
        .post('/api/v1/beneficiaries')
        .set(bearer(ana))
        .send({ name: 'B', alias: 'B', clabe });
    const results = await Promise.all([send(), send(), send()]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409]);
    expect(results.find((r) => r.status === 409)!.body.code).toBe('BENEFICIARY_ALREADY_EXISTS');
  });
});
