import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';
import { buildTestApp, registerAndLogin, type TestContext } from '../helpers/app';
import { accountsOf, balanceOf, fund } from '../helpers/fund';
import { ownerDataSource } from '../helpers/db';

let dev: TestContext; // NODE_ENV=development → expone dev_otp_code
let owner: DataSource;
beforeAll(async () => {
  dev = await buildTestApp({ NODE_ENV: 'development' });
  owner = await ownerDataSource();
});
afterAll(async () => {
  await dev.close();
  await owner.destroy();
});

const rc = () => ({ requestId: randomUUID() });
const BIG = 1_500_000; // > umbral de 1,000,000

async function setup(ctx: TestContext, balance = 3_000_000) {
  const ana = await registerAndLogin(ctx.app);
  const beto = await registerAndLogin(ctx.app);
  const anaAcc = await accountsOf(ctx.ds, ana.id);
  const betoAcc = await accountsOf(ctx.ds, beto.id);
  await fund(ctx.ds, anaAcc.principal, balance);
  const [{ clabe }] = await ctx.ds.query(`SELECT clabe FROM accounts WHERE id = $1`, [
    betoAcc.principal,
  ]);
  const b = await ctx.services.beneficiaries.create(
    ana.id,
    { name: 'Beto', alias: 'Beto', clabe },
    rc(),
  );
  const input = (amount = BIG) => ({
    source_account_id: anaAcc.principal,
    beneficiary_id: b.id,
    amount_cents: amount,
    concept: 'Pago grande',
    reference: '77',
  });
  return { ana, anaAcc, betoAcc, input };
}

describe('confirmación con código de un solo uso [R6.3–R6.7, R6.9, T-13]', () => {
  it('monto > umbral → PENDING_OTP con challenge y sin mover dinero', async () => {
    const s = await setup(dev);
    const out = await dev.services.transfers.create(s.ana.id, randomUUID(), s.input(), rc());
    expect(out.transfer.status).toBe('PENDING_OTP');
    expect(out.transfer.challenge).toMatchObject({ attempts_remaining: 3 });
    expect(out.transfer.challenge!.dev_otp_code).toMatch(/^\d{6}$/);
    expect(await balanceOf(dev.ds, s.anaAcc.principal)).toBe(3_000_000);
    const [row] = await dev.ds.query(
      `SELECT code_hash FROM otp_challenges WHERE transfer_id = $1`,
      [out.transfer.id],
    );
    expect(row.code_hash).not.toContain(out.transfer.challenge!.dev_otp_code);
  });

  it('monto igual al umbral no pide OTP', async () => {
    const s = await setup(dev);
    const out = await dev.services.transfers.create(
      s.ana.id,
      randomUUID(),
      s.input(1_000_000),
      rc(),
    );
    expect(out.transfer.status).toBe('COMPLETED');
  });

  it('código correcto → COMPLETED; reconfirmar no duplica asientos', async () => {
    const s = await setup(dev);
    const key = randomUUID();
    const out = await dev.services.transfers.create(s.ana.id, key, s.input(), rc());
    const code = out.transfer.challenge!.dev_otp_code!;
    const done = await dev.services.transfers.confirm(s.ana.id, out.transfer.id, code, rc());
    expect(done.status).toBe('COMPLETED');
    expect(done.challenge).toBeNull();
    const again = await dev.services.transfers.confirm(s.ana.id, out.transfer.id, code, rc());
    expect(again.status).toBe('COMPLETED');
    expect(await balanceOf(dev.ds, s.anaAcc.principal)).toBe(3_000_000 - BIG);
    expect(await balanceOf(dev.ds, s.betoAcc.principal)).toBe(BIG);
    const [{ n }] = await dev.ds.query(
      `SELECT count(*)::int AS n FROM ledger_entries WHERE transfer_id = $1`,
      [out.transfer.id],
    );
    expect(n).toBe(2);
    // Repetir el POST con la misma llave refleja el estado real (completada).
    const replay = await dev.services.transfers.create(s.ana.id, key, s.input(), rc());
    expect(replay).toMatchObject({
      replayed: true,
      transfer: { id: out.transfer.id, status: 'COMPLETED' },
    });
  });

  it('repetir el POST pendiente devuelve el mismo challenge sin reexponer el código', async () => {
    const s = await setup(dev);
    const key = randomUUID();
    const out = await dev.services.transfers.create(s.ana.id, key, s.input(), rc());
    const replay = await dev.services.transfers.create(s.ana.id, key, s.input(), rc());
    expect(replay.replayed).toBe(true);
    expect(replay.transfer.challenge!.id).toBe(out.transfer.challenge!.id);
    expect(replay.transfer.challenge!.dev_otp_code).toBeUndefined();
  });

  it('3 códigos incorrectos → EXPIRED; luego ni el correcto funciona', async () => {
    const s = await setup(dev);
    const out = await dev.services.transfers.create(s.ana.id, randomUUID(), s.input(), rc());
    const code = out.transfer.challenge!.dev_otp_code!;
    const wrong = code === '000000' ? '111111' : '000000';
    await expect(
      dev.services.transfers.confirm(s.ana.id, out.transfer.id, wrong, rc()),
    ).rejects.toMatchObject({
      code: 'OTP_INVALID',
      extras: { attempts_remaining: 2 },
    });
    await expect(
      dev.services.transfers.confirm(s.ana.id, out.transfer.id, wrong, rc()),
    ).rejects.toMatchObject({
      code: 'OTP_INVALID',
      extras: { attempts_remaining: 1 },
    });
    await expect(
      dev.services.transfers.confirm(s.ana.id, out.transfer.id, wrong, rc()),
    ).rejects.toMatchObject({
      code: 'OTP_EXPIRED',
    });
    await expect(
      dev.services.transfers.confirm(s.ana.id, out.transfer.id, code, rc()),
    ).rejects.toMatchObject({
      code: 'OTP_EXPIRED',
    });
    expect((await dev.services.transfers.get(s.ana.id, out.transfer.id)).status).toBe('EXPIRED');
    expect(await balanceOf(dev.ds, s.anaAcc.principal)).toBe(3_000_000);
    const actions = await dev.ds.query(
      `SELECT action FROM audit_events WHERE entity_id = $1 ORDER BY id`,
      [out.transfer.id],
    );
    expect(actions.map((a: { action: string }) => a.action)).toEqual([
      'transfer.created',
      'otp.issued',
      'otp.failed',
      'otp.failed',
      'otp.failed',
      'transfer.expired',
    ]);
  });

  it('código vencido por tiempo → OTP_EXPIRED', async () => {
    const s = await setup(dev);
    const out = await dev.services.transfers.create(s.ana.id, randomUUID(), s.input(), rc());
    await owner.query(
      `UPDATE otp_challenges SET expires_at = now() - interval '1 second' WHERE transfer_id = $1`,
      [out.transfer.id],
    );
    await expect(
      dev.services.transfers.confirm(
        s.ana.id,
        out.transfer.id,
        out.transfer.challenge!.dev_otp_code!,
        rc(),
      ),
    ).rejects.toMatchObject({ code: 'OTP_EXPIRED' });
  });

  it('si el saldo se gastó entre crear y confirmar → REJECTED INSUFFICIENT_FUNDS [EC-10]', async () => {
    const s = await setup(dev, 2_000_000);
    const out = await dev.services.transfers.create(s.ana.id, randomUUID(), s.input(), rc());
    // Gasta el saldo moviéndolo a Ahorro (no requiere OTP).
    await dev.services.transfers.create(
      s.ana.id,
      randomUUID(),
      {
        source_account_id: s.anaAcc.principal,
        destination_account_id: s.anaAcc.ahorro,
        amount_cents: 1_000_000,
        concept: 'x',
        reference: '1',
      },
      rc(),
    );
    await expect(
      dev.services.transfers.confirm(
        s.ana.id,
        out.transfer.id,
        out.transfer.challenge!.dev_otp_code!,
        rc(),
      ),
    ).rejects.toMatchObject({
      code: 'INSUFFICIENT_FUNDS',
      extras: { transfer: { status: 'REJECTED' } },
    });
    expect(await balanceOf(dev.ds, s.anaAcc.principal)).toBe(1_000_000);
  });

  it('confirmar una transferencia ajena → 404', async () => {
    const s = await setup(dev);
    const other = await registerAndLogin(dev.app);
    const out = await dev.services.transfers.create(s.ana.id, randomUUID(), s.input(), rc());
    await expect(
      dev.services.transfers.confirm(other.id, out.transfer.id, '123456', rc()),
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe('fuera de desarrollo [A-7]', () => {
  it('no expone dev_otp_code', async () => {
    const ctx = await buildTestApp({ NODE_ENV: 'test' });
    try {
      const s = await setup(ctx);
      const out = await ctx.services.transfers.create(s.ana.id, randomUUID(), s.input(), rc());
      expect(out.transfer.status).toBe('PENDING_OTP');
      expect(out.transfer.challenge!.dev_otp_code).toBeUndefined();
    } finally {
      await ctx.close();
    }
  });
});
