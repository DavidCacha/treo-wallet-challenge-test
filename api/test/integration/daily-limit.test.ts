import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';
import { buildTestApp, registerAndLogin, type TestContext } from '../helpers/app';
import { accountsOf, fund } from '../helpers/fund';
import { ownerDataSource } from '../helpers/db';
import { usedTodayCents } from '../../src/modules/transfers/daily-limit';

let ctx: TestContext;
let owner: DataSource;
beforeAll(async () => {
  ctx = await buildTestApp();
  owner = await ownerDataSource();
});
afterAll(async () => {
  await ctx.close();
  await owner.destroy();
});

const rc = () => ({ requestId: randomUUID() });

async function setup(limitCents: number) {
  const ana = await registerAndLogin(ctx.app);
  const beto = await registerAndLogin(ctx.app);
  const anaAcc = await accountsOf(ctx.ds, ana.id);
  const betoAcc = await accountsOf(ctx.ds, beto.id);
  await fund(ctx.ds, anaAcc.principal, 10_000_000);
  await owner.query(`UPDATE users SET daily_limit_cents = $1 WHERE id = $2`, [limitCents, ana.id]);
  const [{ clabe }] = await ctx.ds.query(`SELECT clabe FROM accounts WHERE id = $1`, [
    betoAcc.principal,
  ]);
  const b = await ctx.services.beneficiaries.create(
    ana.id,
    { name: 'Beto', alias: 'Beto', clabe },
    rc(),
  );
  const send = (amount: number) =>
    ctx.services.transfers.create(
      ana.id,
      randomUUID(),
      {
        source_account_id: anaAcc.principal,
        beneficiary_id: b.id,
        amount_cents: amount,
        concept: 'x',
        reference: '1',
      },
      rc(),
    );
  return { ana, anaAcc, send };
}

describe('límite diario [R6.1, R6.2, EC-4, T-12]', () => {
  it('igualar el límite se permite; superarlo se rechaza con DAILY_LIMIT_EXCEEDED', async () => {
    const { send } = await setup(500_000);
    expect((await send(300_000)).transfer.status).toBe('COMPLETED');
    expect((await send(200_000)).transfer.status).toBe('COMPLETED');
    const over = await send(1);
    expect(over.transfer).toMatchObject({
      status: 'REJECTED',
      rejection_code: 'DAILY_LIMIT_EXCEEDED',
    });
  });

  it('los rechazos no consumen límite', async () => {
    const { ana, send } = await setup(500_000);
    await send(600_000);
    expect(await usedTodayCents(ctx.ds.manager, ana.id, 'America/Mexico_City')).toBe(0);
  });

  it('las transferencias entre cuentas propias no consumen el límite (A-3)', async () => {
    const { ana, anaAcc, send } = await setup(500_000);
    const own = await ctx.services.transfers.create(
      ana.id,
      randomUUID(),
      {
        source_account_id: anaAcc.principal,
        destination_account_id: anaAcc.ahorro,
        amount_cents: 900_000,
        concept: 'x',
        reference: '1',
      },
      rc(),
    );
    expect(own.transfer.status).toBe('COMPLETED');
    expect(await usedTodayCents(ctx.ds.manager, ana.id, 'America/Mexico_City')).toBe(0);
    expect((await send(500_000)).transfer.status).toBe('COMPLETED');
  });

  it('la ventana del día usa America/Mexico_City y se reinicia a medianoche local', async () => {
    const { ana, send } = await setup(5_000_000);
    const t = await send(450_000);
    // 23:59:59 del 9 de noviembre en CDMX = 05:59:59Z del 10 (UTC-6).
    await owner.query(`UPDATE transfers SET completed_at = '2026-11-10T05:59:59Z' WHERE id = $1`, [
      t.transfer.id,
    ]);
    const tz = 'America/Mexico_City';
    // Un instante antes de la medianoche local: cuenta para el día 9.
    expect(
      await usedTodayCents(ctx.ds.manager, ana.id, tz, new Date('2026-11-10T05:59:59.500Z')),
    ).toBe(450_000);
    // Medianoche local en adelante: día nuevo, acumulado en cero.
    expect(await usedTodayCents(ctx.ds.manager, ana.id, tz, new Date('2026-11-10T06:00:00Z'))).toBe(
      0,
    );
    expect(await usedTodayCents(ctx.ds.manager, ana.id, tz, new Date('2026-11-10T06:00:01Z'))).toBe(
      0,
    );
    // A las 23:00Z del 9 (17:00 en CDMX) también es el día 9.
    expect(await usedTodayCents(ctx.ds.manager, ana.id, tz, new Date('2026-11-09T23:00:00Z'))).toBe(
      450_000,
    );
    // En UTC sería otro día: la zona importa.
    expect(
      await usedTodayCents(ctx.ds.manager, ana.id, 'UTC', new Date('2026-11-10T05:59:59.500Z')),
    ).toBe(450_000);
    expect(
      await usedTodayCents(ctx.ds.manager, ana.id, 'UTC', new Date('2026-11-09T23:00:00Z')),
    ).toBe(0);
  });

  it('una transferencia de ayer (hora CDMX) no cuenta para el límite de hoy', async () => {
    const { send } = await setup(500_000);
    const t = await send(500_000);
    await owner.query(
      `UPDATE transfers SET completed_at = completed_at - interval '1 day' WHERE id = $1`,
      [t.transfer.id],
    );
    expect((await send(500_000)).transfer.status).toBe('COMPLETED');
  });
});
