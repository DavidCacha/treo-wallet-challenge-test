import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DataSource } from 'typeorm';
import { appDataSource, ownerDataSource, sqlError, sqlState } from '../helpers/db';

let app: DataSource;
let owner: DataSource;

beforeAll(async () => {
  app = await appDataSource(2);
  owner = await ownerDataSource();
});
afterAll(async () => {
  await app.destroy();
  await owner.destroy();
});

describe('auditoría inmutable [NFR-4, T-05]', () => {
  it('treo_app puede insertar eventos', async () => {
    const rows = await app.query(
      `INSERT INTO audit_events (action, metadata) VALUES ('test.event', '{}') RETURNING id`,
    );
    expect(rows).toHaveLength(1);
  });

  it('treo_app no puede actualizar, borrar ni truncar (42501)', async () => {
    expect(await sqlState(app.query(`UPDATE audit_events SET action = 'x'`))).toBe('42501');
    expect(await sqlState(app.query(`DELETE FROM audit_events`))).toBe('42501');
    expect(await sqlState(app.query(`TRUNCATE audit_events`))).toBe('42501');
  });

  it('el trigger bloquea UPDATE/DELETE/TRUNCATE incluso al dueño del esquema', async () => {
    expect(await sqlState(owner.query(`UPDATE audit_events SET action = 'x'`))).toBe('42501');
    expect(await sqlState(owner.query(`DELETE FROM audit_events`))).toBe('42501');
    expect(await sqlState(owner.query(`TRUNCATE audit_events`))).toBe('42501');
  });
});

describe('permisos mínimos del rol de la aplicación [NFR-1, T-05]', () => {
  it('treo_app no puede borrar usuarios ni cambiar su contraseña directamente', async () => {
    expect(await sqlState(app.query(`DELETE FROM users`))).toBe('42501');
    expect(await sqlState(app.query(`UPDATE users SET password_hash = 'x'`))).toBe('42501');
  });
});

// ---------------------------------------------------------------------------
// T-06: libro mayor, cuadre de asientos y saldo no negativo garantizados en la base
// ---------------------------------------------------------------------------
import { randomUUID } from 'node:crypto';
import { buildClabe } from '@treo/shared';

let clabeSeq = 0;
function nextClabe(): string {
  clabeSeq += 1;
  return buildClabe(
    '999181',
    String(Date.now() % 1e8).padStart(8, '0') + String(clabeSeq).padStart(3, '0'),
  );
}

async function makeUser(ds: DataSource): Promise<string> {
  const [row] = await ds.query(
    `INSERT INTO users (email, full_name, password_hash, daily_limit_cents)
     VALUES ($1, 'Prueba', 'x', 5000000) RETURNING id`,
    [`${randomUUID()}@test.dev`],
  );
  return row.id;
}

async function makeAccount(ds: DataSource, userId: string | null): Promise<string> {
  const [row] = await ds.query(
    `INSERT INTO accounts (user_id, kind, name, clabe) VALUES ($1, $2, 'Cuenta', $3) RETURNING id`,
    [userId, userId ? 'USER' : 'SYSTEM', nextClabe()],
  );
  return row.id;
}

async function balance(ds: DataSource, accountId: string): Promise<number> {
  const [row] = await ds.query(`SELECT balance_cents FROM accounts WHERE id = $1`, [accountId]);
  return Number(row.balance_cents);
}

/** Inserta una transferencia y asientos arbitrarios en UNA transacción. */
async function postRaw(
  ds: DataSource,
  t: { src: string; dst: string; amount: number; status?: string; kind?: string },
  entries: Array<{ account: string; type: string; amount: number }>,
): Promise<void> {
  await ds.transaction(async (m) => {
    const id = randomUUID();
    const status = t.status ?? 'COMPLETED';
    await m.query(
      `INSERT INTO transfers (id, user_id, idempotency_key, request_hash, kind, source_account_id,
         destination_account_id, amount_cents, concept, reference, status, tracking_code, completed_at, rejection_code)
       VALUES ($1, NULL, NULL, NULL, $2, $3, $4, $5, 'prueba', '1', $6::transfer_status, $7,
               CASE WHEN $6::text = 'COMPLETED' THEN now() END, CASE WHEN $6::text = 'REJECTED' THEN 'X' END)`,
      [id, t.kind ?? 'DEPOSIT', t.src, t.dst, t.amount, status, `T${id}`],
    );
    for (const e of entries) {
      await m.query(
        `INSERT INTO ledger_entries (transfer_id, account_id, entry_type, amount_cents) VALUES ($1, $2, $3, $4)`,
        [id, e.account, e.type, e.amount],
      );
    }
  });
}

describe('libro mayor y cuadre [R4.7, R4.8, R2.2, T-06]', () => {
  let system: string;
  let a: string;
  let b: string;

  beforeAll(async () => {
    system = await makeAccount(app, null);
    a = await makeAccount(app, await makeUser(app));
    b = await makeAccount(app, await makeUser(app));
    await postRaw(app, { src: system, dst: a, amount: 1000 }, [
      { account: system, type: 'TRANSFER_OUT', amount: -1000 },
      { account: a, type: 'DEPOSIT', amount: 1000 },
    ]);
  });

  it('los asientos actualizan el saldo vía trigger y registran balance_after', async () => {
    expect(await balance(app, a)).toBe(1000);
    const [entry] = await app.query(
      `SELECT balance_after_cents FROM ledger_entries WHERE account_id = $1 ORDER BY id DESC LIMIT 1`,
      [a],
    );
    expect(Number(entry.balance_after_cents)).toBe(1000);
  });

  it('un asiento que deja saldo negativo falla con CHECK (23514) y no cambia nada', async () => {
    const err = await sqlError(
      postRaw(app, { src: a, dst: b, amount: 1500, kind: 'DEPOSIT' }, [
        { account: a, type: 'TRANSFER_OUT', amount: -1500 },
        { account: b, type: 'TRANSFER_IN', amount: 1500 },
      ]),
    );
    expect(err).toEqual({ code: '23514', constraint: 'accounts_balance_non_negative' });
    expect(await balance(app, a)).toBe(1000);
    expect(await balance(app, b)).toBe(0);
  });

  it('asientos que no suman cero se rechazan al COMMIT', async () => {
    const err = await sqlError(
      postRaw(app, { src: a, dst: b, amount: 100 }, [
        { account: a, type: 'TRANSFER_OUT', amount: -100 },
        { account: b, type: 'TRANSFER_IN', amount: 50 },
      ]),
    );
    expect(err).toEqual({ code: '23514', constraint: 'ledger_entries_balanced' });
    expect(await balance(app, a)).toBe(1000);
    expect(await balance(app, b)).toBe(0);
  });

  it('una transferencia COMPLETED sin asientos se rechaza al COMMIT', async () => {
    expect(await sqlError(postRaw(app, { src: a, dst: b, amount: 100 }, []))).toEqual({
      code: '23514',
      constraint: 'ledger_entries_balanced',
    });
  });

  it('una transferencia no completada no puede tener asientos', async () => {
    const state = await sqlState(
      postRaw(app, { src: a, dst: b, amount: 100, status: 'PENDING_OTP' }, [
        { account: a, type: 'TRANSFER_OUT', amount: -100 },
        { account: b, type: 'TRANSFER_IN', amount: 100 },
      ]),
    );
    expect(state).toBe('23514');
  });

  it('el signo del asiento debe corresponder a su tipo', async () => {
    const state = await sqlState(
      postRaw(app, { src: a, dst: b, amount: 100 }, [
        { account: a, type: 'TRANSFER_IN', amount: -100 },
        { account: b, type: 'TRANSFER_IN', amount: 100 },
      ]),
    );
    expect(state).toBe('23514');
  });

  it('treo_app no puede modificar saldos directamente (solo el trigger)', async () => {
    expect(
      await sqlState(app.query(`UPDATE accounts SET balance_cents = 999999 WHERE id = $1`, [a])),
    ).toBe('42501');
  });

  it('los asientos son inmutables', async () => {
    expect(await sqlState(app.query(`UPDATE ledger_entries SET amount_cents = 1`))).toBe('42501');
    expect(await sqlState(app.query(`DELETE FROM ledger_entries`))).toBe('42501');
    expect(await sqlState(owner.query(`DELETE FROM ledger_entries`))).toBe('42501');
  });

  it('la llave de idempotencia es única por usuario (23505)', async () => {
    const userId = await makeUser(app);
    const src = await makeAccount(app, userId);
    const key = randomUUID();
    const insert = () =>
      app.query(
        `INSERT INTO transfers (user_id, idempotency_key, request_hash, kind, source_account_id,
           destination_account_id, amount_cents, concept, reference, status, tracking_code, rejection_code)
         VALUES ($1, $2, repeat('a', 64), 'P2P', $3, $4, 100, 'c', '1', 'REJECTED', $5, 'INSUFFICIENT_FUNDS')`,
        [userId, key, src, b, randomUUID()],
      );
    await insert();
    expect(await sqlState(insert())).toBe('23505');
  });

  it('una transferencia no puede tener la misma cuenta como origen y destino', async () => {
    expect(
      await sqlState(
        postRaw(app, { src: a, dst: a, amount: 100 }, [
          { account: a, type: 'TRANSFER_OUT', amount: -100 },
          { account: a, type: 'TRANSFER_IN', amount: 100 },
        ]),
      ),
    ).toBe('23514');
  });

  it('el saldo de cada cuenta es igual a la suma de sus asientos', async () => {
    const rows = await app.query(`
      SELECT a.id FROM accounts a
      LEFT JOIN ledger_entries le ON le.account_id = a.id
      GROUP BY a.id, a.balance_cents
      HAVING a.balance_cents <> COALESCE(SUM(le.amount_cents), 0)`);
    expect(rows).toHaveLength(0);
  });
});
