import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { buildTestApp, registerAndLogin, type TestContext, type TestUser } from '../helpers/app';
import { accountsOf, balanceOf, fund } from '../helpers/fund';

let ctx: TestContext;
beforeAll(async () => {
  ctx = await buildTestApp();
});
afterAll(async () => {
  await ctx.close();
});

const rc = () => ({ requestId: randomUUID() });

interface Pair {
  ana: TestUser;
  beto: TestUser;
  anaAcc: { principal: string; ahorro: string };
  betoAcc: { principal: string; ahorro: string };
  beneficiaryId: string;
}

/** Ana con saldo y Beto registrado como beneficiario de Ana. */
async function pair(anaBalance = 100_000): Promise<Pair> {
  const ana = await registerAndLogin(ctx.app, 'Ana');
  const beto = await registerAndLogin(ctx.app, 'Beto');
  const anaAcc = await accountsOf(ctx.ds, ana.id);
  const betoAcc = await accountsOf(ctx.ds, beto.id);
  if (anaBalance > 0) await fund(ctx.ds, anaAcc.principal, anaBalance);
  const [{ clabe }] = await ctx.ds.query(`SELECT clabe FROM accounts WHERE id = $1`, [
    betoAcc.principal,
  ]);
  const b = await ctx.services.beneficiaries.create(
    ana.id,
    { name: 'Beto', alias: 'Beto', clabe },
    rc(),
  );
  return { ana, beto, anaAcc, betoAcc, beneficiaryId: b.id };
}

describe('TransfersService núcleo [R4.1, R4.5–R4.12, T-11]', () => {
  it('transfiere de forma atómica: saldos, dos asientos que suman cero y comprobante', async () => {
    const p = await pair();
    const out = await ctx.services.transfers.create(
      p.ana.id,
      randomUUID(),
      {
        source_account_id: p.anaAcc.principal,
        beneficiary_id: p.beneficiaryId,
        amount_cents: 12_345,
        concept: 'Renta',
        reference: '0042',
      },
      rc(),
    );
    expect(out.replayed).toBe(false);
    expect(out.transfer).toMatchObject({
      status: 'COMPLETED',
      kind: 'P2P',
      amount_cents: 12_345,
      reference: '0042',
      destination: { display_name: 'Beto' },
    });
    expect(out.transfer.destination.clabe_masked).toMatch(/^\*{14}\d{4}$/);
    expect(out.transfer.tracking_code).toMatch(/^TRX/);
    expect(await balanceOf(ctx.ds, p.anaAcc.principal)).toBe(100_000 - 12_345);
    expect(await balanceOf(ctx.ds, p.betoAcc.principal)).toBe(12_345);

    const entries = await ctx.ds.query(
      `SELECT entry_type, amount_cents::int AS amount FROM ledger_entries WHERE transfer_id = $1 ORDER BY amount_cents`,
      [out.transfer.id],
    );
    expect(entries).toEqual([
      { entry_type: 'TRANSFER_OUT', amount: -12_345 },
      { entry_type: 'TRANSFER_IN', amount: 12_345 },
    ]);
  });

  it('saldo insuficiente: REJECTED persistido, ningún saldo cambia', async () => {
    const p = await pair(1_000);
    const out = await ctx.services.transfers.create(
      p.ana.id,
      randomUUID(),
      {
        source_account_id: p.anaAcc.principal,
        beneficiary_id: p.beneficiaryId,
        amount_cents: 1_001,
        concept: 'x',
        reference: '1',
      },
      rc(),
    );
    expect(out.transfer).toMatchObject({
      status: 'REJECTED',
      rejection_code: 'INSUFFICIENT_FUNDS',
    });
    expect(await balanceOf(ctx.ds, p.anaAcc.principal)).toBe(1_000);
    expect(await balanceOf(ctx.ds, p.betoAcc.principal)).toBe(0);
    const [{ n }] = await ctx.ds.query(
      `SELECT count(*)::int AS n FROM ledger_entries WHERE transfer_id = $1`,
      [out.transfer.id],
    );
    expect(n).toBe(0);
  });

  it('misma llave y mismo cuerpo: se ejecuta una sola vez y se repite la respuesta', async () => {
    const p = await pair();
    const key = randomUUID();
    const input = {
      source_account_id: p.anaAcc.principal,
      beneficiary_id: p.beneficiaryId,
      amount_cents: 500,
      concept: 'x',
      reference: '1',
    };
    const first = await ctx.services.transfers.create(p.ana.id, key, input, rc());
    const second = await ctx.services.transfers.create(p.ana.id, key, input, rc());
    expect(second.replayed).toBe(true);
    expect(second.transfer).toEqual(first.transfer);
    expect(await balanceOf(ctx.ds, p.anaAcc.principal)).toBe(100_000 - 500);
  });

  it('misma llave con otro cuerpo → IDEMPOTENCY_KEY_REUSED', async () => {
    const p = await pair();
    const key = randomUUID();
    const input = {
      source_account_id: p.anaAcc.principal,
      beneficiary_id: p.beneficiaryId,
      amount_cents: 500,
      concept: 'x',
      reference: '1',
    };
    await ctx.services.transfers.create(p.ana.id, key, input, rc());
    await expect(
      ctx.services.transfers.create(p.ana.id, key, { ...input, amount_cents: 501 }, rc()),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED', status: 422 });
    expect(await balanceOf(ctx.ds, p.anaAcc.principal)).toBe(100_000 - 500);
  });

  it('a otra cuenta propia se permite; a la misma cuenta no [EC-5]', async () => {
    const p = await pair();
    const own = await ctx.services.transfers.create(
      p.ana.id,
      randomUUID(),
      {
        source_account_id: p.anaAcc.principal,
        destination_account_id: p.anaAcc.ahorro,
        amount_cents: 1_000,
        concept: 'Ahorro',
        reference: '1',
      },
      rc(),
    );
    expect(own.transfer).toMatchObject({
      status: 'COMPLETED',
      kind: 'OWN_ACCOUNTS',
      destination: { display_name: 'Ahorro' },
    });
    await expect(
      ctx.services.transfers.create(
        p.ana.id,
        randomUUID(),
        {
          source_account_id: p.anaAcc.principal,
          destination_account_id: p.anaAcc.principal,
          amount_cents: 1,
          concept: 'x',
          reference: '1',
        },
        rc(),
      ),
    ).rejects.toMatchObject({ code: 'SAME_ACCOUNT_TRANSFER', status: 422 });
  });

  it('cuenta origen, destino o beneficiario ajenos → 404', async () => {
    const p = await pair();
    const q = await pair();
    const tries = [
      { source_account_id: q.anaAcc.principal, beneficiary_id: p.beneficiaryId },
      { source_account_id: p.anaAcc.principal, beneficiary_id: q.beneficiaryId },
      { source_account_id: p.anaAcc.principal, destination_account_id: p.betoAcc.principal },
    ];
    for (const t of tries) {
      await expect(
        ctx.services.transfers.create(
          p.ana.id,
          randomUUID(),
          { ...t, amount_cents: 1, concept: 'x', reference: '1' },
          rc(),
        ),
      ).rejects.toMatchObject({ status: 404 });
    }
  });

  it('get devuelve solo transferencias propias', async () => {
    const p = await pair();
    const out = await ctx.services.transfers.create(
      p.ana.id,
      randomUUID(),
      {
        source_account_id: p.anaAcc.principal,
        beneficiary_id: p.beneficiaryId,
        amount_cents: 1,
        concept: 'x',
        reference: '1',
      },
      rc(),
    );
    expect((await ctx.services.transfers.get(p.ana.id, out.transfer.id)).id).toBe(out.transfer.id);
    await expect(ctx.services.transfers.get(p.beto.id, out.transfer.id)).rejects.toMatchObject({
      status: 404,
    });
  });
});
