import { randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';
import { buildClabe } from '@treo/shared';

let systemAccountId: string | undefined;

async function systemAccount(ds: DataSource): Promise<string> {
  if (systemAccountId) return systemAccountId;
  const existing = await ds.query(`SELECT id FROM accounts WHERE kind = 'SYSTEM' LIMIT 1`);
  if (existing[0]) {
    systemAccountId = existing[0].id as string;
    return systemAccountId;
  }
  const [row] = await ds.query(
    `INSERT INTO accounts (user_id, kind, name, clabe) VALUES (NULL, 'SYSTEM', 'Tesorería', $1) RETURNING id`,
    [buildClabe('999000', '00000000001')],
  );
  systemAccountId = row.id as string;
  return systemAccountId;
}

/** Depósito de prueba: asientos balanceados desde la cuenta SYSTEM (como el seed). */
export async function fund(ds: DataSource, accountId: string, cents: number): Promise<void> {
  const system = await systemAccount(ds);
  await ds.transaction(async (m) => {
    const id = randomUUID();
    await m.query(
      `INSERT INTO transfers (id, kind, source_account_id, destination_account_id, amount_cents,
         concept, reference, status, tracking_code, completed_at)
       VALUES ($1, 'DEPOSIT', $2, $3, $4, 'Depósito de prueba', '1', 'COMPLETED', $5, now())`,
      [id, system, accountId, cents, `DEP-${id}`],
    );
    await m.query(
      `INSERT INTO ledger_entries (transfer_id, account_id, entry_type, amount_cents)
       VALUES ($1, $2, 'TRANSFER_OUT', $3), ($1, $4, 'DEPOSIT', $5)`,
      [id, system, -cents, accountId, cents],
    );
  });
}

export async function accountsOf(
  ds: DataSource,
  userId: string,
): Promise<{ principal: string; ahorro: string }> {
  const rows: Array<{ id: string; name: string }> = await ds.query(
    `SELECT id, name FROM accounts WHERE user_id = $1`,
    [userId],
  );
  return {
    principal: rows.find((r) => r.name === 'Principal')!.id,
    ahorro: rows.find((r) => r.name === 'Ahorro')!.id,
  };
}

export async function balanceOf(ds: DataSource, accountId: string): Promise<number> {
  const [row] = await ds.query(`SELECT balance_cents FROM accounts WHERE id = $1`, [accountId]);
  return Number(row.balance_cents);
}
