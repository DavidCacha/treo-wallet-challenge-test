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

// ---------------------------------------------------------------------------
// T-14: contrato HTTP de /transfers
// ---------------------------------------------------------------------------
import request from 'supertest';
import { bearer } from '../helpers/app';

describe('HTTP /transfers [R4.2, R4.9–R4.13, T-14]', () => {
  const post = (p: Pair, body: Record<string, unknown>, key?: string) => {
    const req = request(ctx.app).post('/api/v1/transfers').set(bearer(p.ana));
    if (key) req.set('Idempotency-Key', key);
    return req.send(body);
  };
  const body = (p: Pair, amount = 2_500) => ({
    source_account_id: p.anaAcc.principal,
    beneficiary_id: p.beneficiaryId,
    amount_cents: amount,
    concept: 'Comida',
    reference: '123',
  });

  it('201 con comprobante; la repetición devuelve lo mismo con Idempotent-Replayed', async () => {
    const p = await pair();
    const key = randomUUID();
    const first = await post(p, body(p), key);
    expect(first.status).toBe(201);
    expect(first.headers['idempotent-replayed']).toBeUndefined();
    expect(first.headers['cache-control']).toBe('no-store');
    const again = await post(p, body(p), key);
    expect(again.status).toBe(201);
    expect(again.headers['idempotent-replayed']).toBe('true');
    expect(again.body).toEqual(first.body);
    expect(await balanceOf(ctx.ds, p.anaAcc.principal)).toBe(100_000 - 2_500);
  });

  it('sin Idempotency-Key o con una inválida → 400', async () => {
    const p = await pair();
    expect((await post(p, body(p))).status).toBe(400);
    const bad = await post(p, body(p), 'no-es-uuid');
    expect(bad.status).toBe(400);
    expect(bad.body.errors[0].path).toBe('Idempotency-Key');
  });

  it('misma llave con otro cuerpo → 422 IDEMPOTENCY_KEY_REUSED [EC-6]', async () => {
    const p = await pair();
    const key = randomUUID();
    await post(p, body(p), key).expect(201);
    const res = await post(p, body(p, 2_501), key);
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it.each([10000.5, '1000', 0, -5, 1e9])(
    'amount_cents=%j → 400 sin redondear [EC-3]',
    async (amount) => {
      const p = await pair();
      const res = await post(p, { ...body(p), amount_cents: amount }, randomUUID());
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(await balanceOf(ctx.ds, p.anaAcc.principal)).toBe(100_000);
    },
  );

  it('saldo insuficiente → 422 INSUFFICIENT_FUNDS con la transferencia REJECTED, también al repetir', async () => {
    const p = await pair(1_000);
    const key = randomUUID();
    const res = await post(p, body(p, 5_000), key);
    expect(res.status).toBe(422);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.body).toMatchObject({
      code: 'INSUFFICIENT_FUNDS',
      transfer: { status: 'REJECTED' },
    });
    const again = await post(p, body(p, 5_000), key);
    expect(again.status).toBe(422);
    expect(again.headers['idempotent-replayed']).toBe('true');
    expect(again.body.transfer.id).toBe(res.body.transfer.id);
  });

  it('misma cuenta origen/destino → 422 SAME_ACCOUNT_TRANSFER', async () => {
    const p = await pair();
    const res = await post(
      p,
      {
        source_account_id: p.anaAcc.principal,
        destination_account_id: p.anaAcc.principal,
        amount_cents: 1,
        concept: 'x',
        reference: '1',
      },
      randomUUID(),
    );
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('SAME_ACCOUNT_TRANSFER');
  });

  it('GET /transfers/:id propio 200; ajeno 404', async () => {
    const p = await pair();
    const created = await post(p, body(p), randomUUID()).expect(201);
    await request(ctx.app)
      .get(`/api/v1/transfers/${created.body.id}`)
      .set(bearer(p.ana))
      .expect(200);
    await request(ctx.app)
      .get(`/api/v1/transfers/${created.body.id}`)
      .set(bearer(p.beto))
      .expect(404);
  });

  it('monto > umbral → 202 PENDING_OTP; código incorrecto → 422 OTP_INVALID con intentos restantes', async () => {
    const p = await pair(2_000_000);
    const res = await post(p, body(p, 1_000_001), randomUUID());
    expect(res.status).toBe(202);
    expect(res.body.status).toBe('PENDING_OTP');
    const wrong = await request(ctx.app)
      .post(`/api/v1/transfers/${res.body.id}/confirm`)
      .set(bearer(p.ana))
      .send({ code: '000000' });
    // Probabilidad 1e-6 de acertar al azar.
    expect(wrong.status).toBe(422);
    expect(wrong.body).toMatchObject({ code: 'OTP_INVALID', attempts_remaining: 2 });
    const badFormat = await request(ctx.app)
      .post(`/api/v1/transfers/${res.body.id}/confirm`)
      .set(bearer(p.ana))
      .send({ code: '12' });
    expect(badFormat.status).toBe(400);
  });
});

describe('HTTP confirmación OTP (modo desarrollo) [R6.4, T-14]', () => {
  it('202 → confirm 200 COMPLETED → repetir el POST da 201 con Idempotent-Replayed', async () => {
    const dev = await buildTestApp({ NODE_ENV: 'development' });
    try {
      const ana = await registerAndLogin(dev.app);
      const beto = await registerAndLogin(dev.app);
      const anaAcc = await accountsOf(dev.ds, ana.id);
      const betoAcc = await accountsOf(dev.ds, beto.id);
      await fund(dev.ds, anaAcc.principal, 2_000_000);
      const [{ clabe }] = await dev.ds.query(`SELECT clabe FROM accounts WHERE id = $1`, [
        betoAcc.principal,
      ]);
      const ben = await request(dev.app)
        .post('/api/v1/beneficiaries')
        .set(bearer(ana))
        .send({ name: 'Beto', alias: 'Beto', clabe })
        .expect(201);
      const key = randomUUID();
      const payload = {
        source_account_id: anaAcc.principal,
        beneficiary_id: ben.body.id,
        amount_cents: 1_200_000,
        concept: 'Auto',
        reference: '9',
      };
      const created = await request(dev.app)
        .post('/api/v1/transfers')
        .set(bearer(ana))
        .set('Idempotency-Key', key)
        .send(payload)
        .expect(202);
      const confirmed = await request(dev.app)
        .post(`/api/v1/transfers/${created.body.id}/confirm`)
        .set(bearer(ana))
        .send({ code: created.body.challenge.dev_otp_code })
        .expect(200);
      expect(confirmed.body.status).toBe('COMPLETED');
      const replay = await request(dev.app)
        .post('/api/v1/transfers')
        .set(bearer(ana))
        .set('Idempotency-Key', key)
        .send(payload);
      expect(replay.status).toBe(201);
      expect(replay.headers['idempotent-replayed']).toBe('true');
      expect(await balanceOf(dev.ds, anaAcc.principal)).toBe(800_000);
    } finally {
      await dev.close();
    }
  });
});
