import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { bearer, buildTestApp, registerAndLogin, type TestContext } from '../helpers/app';
import { accountsOf, fund } from '../helpers/fund';

let ctx: TestContext;
beforeAll(async () => {
  ctx = await buildTestApp();
});
afterAll(async () => {
  await ctx.close();
});

const rc = () => ({ requestId: randomUUID() });

function todayInMexicoCity(offsetDays = 0): string {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(d);
}

async function scenario() {
  const ana = await registerAndLogin(ctx.app, 'Ana Pérez');
  const beto = await registerAndLogin(ctx.app, 'Beto López');
  const anaAcc = await accountsOf(ctx.ds, ana.id);
  const betoAcc = await accountsOf(ctx.ds, beto.id);
  await fund(ctx.ds, anaAcc.principal, 1_000_000); // 1 DEPOSIT
  const [{ clabe }] = await ctx.ds.query(`SELECT clabe FROM accounts WHERE id = $1`, [
    betoAcc.principal,
  ]);
  const ben = await ctx.services.beneficiaries.create(
    ana.id,
    { name: 'Beto López', alias: 'Betito', clabe },
    rc(),
  );
  for (let i = 1; i <= 15; i++) {
    await ctx.services.transfers.create(
      ana.id,
      randomUUID(),
      {
        source_account_id: anaAcc.principal,
        beneficiary_id: ben.id,
        amount_cents: i * 100,
        concept: `Pago ${i}`,
        reference: String(i),
      },
      rc(),
    );
  }
  for (let i = 1; i <= 5; i++) {
    await ctx.services.transfers.create(
      ana.id,
      randomUUID(),
      {
        source_account_id: anaAcc.principal,
        destination_account_id: anaAcc.ahorro,
        amount_cents: 1_000,
        concept: `Ahorro ${i}`,
        reference: '9',
      },
      rc(),
    );
  }
  return { ana, beto, anaAcc, betoAcc };
}

describe('historial de movimientos [R5.1–R5.5, T-16]', () => {
  it('recorre todas las páginas por cursor sin repetir ni omitir, del más reciente al más antiguo', async () => {
    const s = await scenario();
    const seen: Array<{ id: string; created_at: string }> = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const res: request.Response = await request(ctx.app)
        .get(`/api/v1/accounts/${s.anaAcc.principal}/movements`)
        .query({ limit: 7, ...(cursor ? { cursor } : {}) })
        .set(bearer(s.ana))
        .expect(200);
      seen.push(...res.body.data);
      cursor = res.body.next_cursor;
      pages++;
    } while (cursor && pages < 10);
    expect(seen).toHaveLength(21); // 1 depósito + 15 P2P + 5 a Ahorro
    expect(pages).toBe(3);
    expect(new Set(seen.map((m) => m.id)).size).toBe(21);
    const keys = seen.map((m) => `${m.created_at}|${m.id.padStart(20, '0')}`);
    expect([...keys].sort().reverse()).toEqual(keys);
  });

  it('cada movimiento trae tipo, monto con signo, saldo posterior, concepto y contraparte enmascarada', async () => {
    const s = await scenario();
    const res = await request(ctx.app)
      .get(`/api/v1/accounts/${s.anaAcc.principal}/movements`)
      .query({ limit: 100 })
      .set(bearer(s.ana))
      .expect(200);
    const latest = res.body.data[0];
    expect(latest).toMatchObject({
      type: 'TRANSFER_OUT',
      amount_cents: -1_000,
      concept: 'Ahorro 5',
      reference: '9',
    });
    expect(latest.counterparty).toMatchObject({ display_name: 'Ahorro' });
    expect(latest.counterparty.clabe_masked).toMatch(/^\*{14}\d{4}$/);
    const p2p = res.body.data.find((m: { concept: string }) => m.concept === 'Pago 15');
    expect(p2p.counterparty.display_name).toBe('Betito');
    const deposit = res.body.data.at(-1);
    expect(deposit).toMatchObject({
      type: 'DEPOSIT',
      amount_cents: 1_000_000,
      balance_after_cents: 1_000_000,
      counterparty: null,
    });
    // El saldo posterior del más reciente coincide con el saldo de la cuenta.
    const [{ balance }] = await ctx.ds.query(
      `SELECT balance_cents::int AS balance FROM accounts WHERE id = $1`,
      [s.anaAcc.principal],
    );
    expect(latest.balance_after_cents).toBe(balance);

    // El receptor ve la entrada con el nombre del remitente.
    const betoRes = await request(ctx.app)
      .get(`/api/v1/accounts/${s.betoAcc.principal}/movements`)
      .set(bearer(s.beto))
      .expect(200);
    expect(betoRes.body.data[0]).toMatchObject({
      type: 'TRANSFER_IN',
      counterparty: { display_name: 'Ana Pérez' },
    });
  });

  it('filtra por tipo y por fecha (America/Mexico_City)', async () => {
    const s = await scenario();
    const url = `/api/v1/accounts/${s.anaAcc.principal}/movements`;
    const deposits = await request(ctx.app)
      .get(url)
      .query({ type: 'DEPOSIT' })
      .set(bearer(s.ana))
      .expect(200);
    expect(deposits.body.data).toHaveLength(1);
    const outs = await request(ctx.app)
      .get(url)
      .query({ type: 'TRANSFER_OUT', limit: 100 })
      .set(bearer(s.ana))
      .expect(200);
    expect(outs.body.data).toHaveLength(20);
    const today = todayInMexicoCity();
    const todayRes = await request(ctx.app)
      .get(url)
      .query({ from: today, to: today, limit: 100 })
      .set(bearer(s.ana))
      .expect(200);
    expect(todayRes.body.data).toHaveLength(21);
    const yesterday = todayInMexicoCity(-1);
    const old = await request(ctx.app)
      .get(url)
      .query({ to: yesterday })
      .set(bearer(s.ana))
      .expect(200);
    expect(old.body).toEqual({ data: [], next_cursor: null });
  });

  it('parámetros inválidos → 400; cuenta ajena → 404', async () => {
    const s = await scenario();
    const url = `/api/v1/accounts/${s.anaAcc.principal}/movements`;
    const cases = [
      { from: '2026-11-10', to: '2026-11-01' },
      { type: 'FEE' },
      { limit: 101 },
      { cursor: 'no-es-un-cursor' },
      { cursor: Buffer.from(JSON.stringify(['2026-01-01', '1'])).toString('base64url') },
      { offset: 10 },
    ];
    for (const query of cases) {
      const res = await request(ctx.app).get(url).query(query).set(bearer(s.ana));
      expect(res.status, JSON.stringify(query)).toBe(400);
    }
    await request(ctx.app).get(url).set(bearer(s.beto)).expect(404);
  });
});
