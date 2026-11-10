import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import {
  bearer,
  buildTestApp,
  registerAndLogin,
  type TestContext,
  type TestUser,
} from '../helpers/app';
import { accountsOf, balanceOf, fund } from '../helpers/fund';

/**
 * T-15: pruebas de concurrencia contra un servidor HTTP real y PostgreSQL real.
 * Las peticiones se disparan a la vez con fetch; el pool de conexiones (25) es
 * menor que el número de peticiones, igual que en producción.
 */
let ctx: TestContext;
let server: Server;
let baseUrl: string;

beforeAll(async () => {
  ctx = await buildTestApp({}, 25);
  server = ctx.app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
});
afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await ctx.close();
});

async function beneficiary(owner: TestUser, target: TestUser): Promise<string> {
  const acc = await accountsOf(ctx.ds, target.id);
  const [{ clabe }] = await ctx.ds.query(`SELECT clabe FROM accounts WHERE id = $1`, [
    acc.principal,
  ]);
  const b = await ctx.services.beneficiaries.create(
    owner.id,
    { name: 'B', alias: 'B', clabe },
    { requestId: randomUUID() },
  );
  return b.id;
}

function postTransfer(user: TestUser, key: string, body: Record<string, unknown>) {
  return fetch(`${baseUrl}/transfers`, {
    method: 'POST',
    headers: { ...bearer(user), 'Content-Type': 'application/json', 'Idempotency-Key': key },
    body: JSON.stringify(body),
  }).then(async (r) => ({
    status: r.status,
    replayed: r.headers.get('idempotent-replayed') === 'true',
    body: (await r.json()) as Record<string, unknown> & {
      id?: string;
      code?: string;
      transfer?: { id: string };
    },
  }));
}

async function ledgerIsConsistent(): Promise<void> {
  const [{ total }] = await ctx.ds.query(
    `SELECT COALESCE(SUM(amount_cents), 0)::text AS total FROM ledger_entries`,
  );
  expect(total).toBe('0');
  const drift = await ctx.ds.query(`
    SELECT a.id FROM accounts a
    LEFT JOIN ledger_entries le ON le.account_id = a.id
    GROUP BY a.id, a.balance_cents
    HAVING a.balance_cents <> COALESCE(SUM(le.amount_cents), 0)`);
  expect(drift).toHaveLength(0);
  const negative = await ctx.ds.query(
    `SELECT id FROM accounts WHERE kind = 'USER' AND balance_cents < 0`,
  );
  expect(negative).toHaveLength(0);
}

describe('concurrencia [R4.8, R4.9, R4.12, EC-1, EC-7, EC-8]', () => {
  it('100 transferencias simultáneas desde una cuenta cuadran al centavo', async () => {
    const ana = await registerAndLogin(ctx.app, 'Ana');
    const beto = await registerAndLogin(ctx.app, 'Beto');
    const anaAcc = await accountsOf(ctx.ds, ana.id);
    const betoAcc = await accountsOf(ctx.ds, beto.id);
    const benId = await beneficiary(ana, beto);
    const initial = 100_000; // $1,000.00
    const amount = 1_500; // $15.00
    await fund(ctx.ds, anaAcc.principal, initial);

    const results = await Promise.all(
      Array.from({ length: 100 }, () =>
        postTransfer(ana, randomUUID(), {
          source_account_id: anaAcc.principal,
          beneficiary_id: benId,
          amount_cents: amount,
          concept: 'Concurrencia',
          reference: '1',
        }),
      ),
    );

    const ok = results.filter((r) => r.status === 201).length;
    const insufficient = results.filter(
      (r) => r.status === 422 && r.body.code === 'INSUFFICIENT_FUNDS',
    ).length;
    const expectedOk = Math.floor(initial / amount); // 66
    expect(results.filter((r) => r.status >= 500)).toHaveLength(0);
    expect(ok).toBe(expectedOk);
    expect(insufficient).toBe(100 - expectedOk);
    expect(await balanceOf(ctx.ds, anaAcc.principal)).toBe(initial - expectedOk * amount); // $10.00
    expect(await balanceOf(ctx.ds, betoAcc.principal)).toBe(expectedOk * amount);
    await ledgerIsConsistent();
  });

  it('transferencias cruzadas A→B y B→A simultáneas no producen deadlocks', async () => {
    const ana = await registerAndLogin(ctx.app, 'Ana');
    const beto = await registerAndLogin(ctx.app, 'Beto');
    const anaAcc = await accountsOf(ctx.ds, ana.id);
    const betoAcc = await accountsOf(ctx.ds, beto.id);
    await fund(ctx.ds, anaAcc.principal, 1_000_000);
    await fund(ctx.ds, betoAcc.principal, 1_000_000);
    const anaToBeto = await beneficiary(ana, beto);
    const betoToAna = await beneficiary(beto, ana);

    const requests = Array.from({ length: 100 }, (_, i) =>
      i % 2 === 0
        ? postTransfer(ana, randomUUID(), {
            source_account_id: anaAcc.principal,
            beneficiary_id: anaToBeto,
            amount_cents: 1_000,
            concept: 'A→B',
            reference: '1',
          })
        : postTransfer(beto, randomUUID(), {
            source_account_id: betoAcc.principal,
            beneficiary_id: betoToAna,
            amount_cents: 1_000,
            concept: 'B→A',
            reference: '2',
          }),
    );
    const results = await Promise.all(requests);
    expect(results.map((r) => r.status).filter((s) => s !== 201)).toEqual([]);
    expect(await balanceOf(ctx.ds, anaAcc.principal)).toBe(1_000_000);
    expect(await balanceOf(ctx.ds, betoAcc.principal)).toBe(1_000_000);
    await ledgerIsConsistent();
  });

  it('20 peticiones simultáneas con la misma llave ejecutan una sola transferencia', async () => {
    const ana = await registerAndLogin(ctx.app, 'Ana');
    const beto = await registerAndLogin(ctx.app, 'Beto');
    const anaAcc = await accountsOf(ctx.ds, ana.id);
    const benId = await beneficiary(ana, beto);
    await fund(ctx.ds, anaAcc.principal, 50_000);
    const key = randomUUID();
    const body = {
      source_account_id: anaAcc.principal,
      beneficiary_id: benId,
      amount_cents: 7_500,
      concept: 'Doble clic',
      reference: '1',
    };
    const results = await Promise.all(
      Array.from({ length: 20 }, () => postTransfer(ana, key, body)),
    );
    expect(results.every((r) => r.status === 201)).toBe(true);
    expect(new Set(results.map((r) => r.body.id)).size).toBe(1);
    expect(results.filter((r) => !r.replayed)).toHaveLength(1);
    expect(await balanceOf(ctx.ds, anaAcc.principal)).toBe(50_000 - 7_500);
    const [{ n }] = await ctx.ds.query(
      `SELECT count(*)::int AS n FROM transfers WHERE user_id = $1 AND idempotency_key = $2`,
      [ana.id, key],
    );
    expect(n).toBe(1);
    await ledgerIsConsistent();
  });
});
