import 'dotenv/config';
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';
import { buildClabe } from '@treo/shared';
import { loadConfig } from '../../config/env';
import { createLogger } from '../../lib/logger';
import { createDataSource } from '../data-source';
import { buildServices } from '../../container';
import { postTransferEntries } from '../../modules/transfers/ledger';

/**
 * npm run db:seed (T-17). Idempotente: si los usuarios demo existen, no hace nada.
 * Usa el rol de la aplicación (DATABASE_URL): el seed respeta los mismos permisos
 * y triggers que la API. Todo el dinero entra por asientos desde la cuenta SYSTEM.
 */
export const DEMO_PASSWORD = 'Demo12345!';
export const DEMO_USERS = {
  ana: { email: 'ana@treo.dev', full_name: 'Ana Pérez' },
  beto: { email: 'beto@treo.dev', full_name: 'Beto López' },
  historial: { email: 'historial@treo.dev', full_name: 'Cuenta Histórica' },
} as const;
export const HISTORY_TRANSFERS = 60_000; // → 120,000 asientos
const HISTORY_BATCH = 1_000;

const SYSTEM_CLABE = buildClabe('999000', '00000000001');

async function systemAccountId(ds: DataSource): Promise<string> {
  const rows: Array<{ id: string }> = await ds.query(
    `SELECT id FROM accounts WHERE kind = 'SYSTEM' LIMIT 1`,
  );
  if (rows[0]) return rows[0].id;
  const [row] = (await ds.query(
    `INSERT INTO accounts (user_id, kind, name, clabe) VALUES (NULL, 'SYSTEM', 'Tesorería', $1) RETURNING id`,
    [SYSTEM_CLABE],
  )) as Array<{ id: string }>;
  return row!.id;
}

async function deposit(
  ds: DataSource,
  systemId: string,
  accountId: string,
  cents: number,
  concept: string,
) {
  await ds.transaction('READ COMMITTED', async (m) => {
    const id = randomUUID();
    await m.query(
      `INSERT INTO transfers (id, kind, source_account_id, destination_account_id, amount_cents,
         concept, reference, status, tracking_code, completed_at)
       VALUES ($1, 'DEPOSIT', $2, $3, $4, $5, '1', 'COMPLETED', $6, now())`,
      [
        id,
        systemId,
        accountId,
        cents,
        concept,
        `DEP${id.replace(/-/g, '').slice(0, 16).toUpperCase()}`,
      ],
    );
    await postTransferEntries(m, {
      id,
      kind: 'DEPOSIT',
      sourceAccountId: systemId,
      destinationAccountId: accountId,
      amountCents: cents,
    });
  });
}

async function accountsByName(ds: DataSource, userId: string): Promise<Record<string, string>> {
  const rows: Array<{ id: string; name: string }> = await ds.query(
    `SELECT id, name FROM accounts WHERE user_id = $1`,
    [userId],
  );
  return Object.fromEntries(rows.map((r) => [r.name, r.id]));
}

/**
 * Historial masivo en una sola sentencia: transferencias entre las dos cuentas
 * propias del usuario histórico, en orden cronológico (balance_after coherente),
 * con asientos balanceados intercalados para que ningún saldo sea negativo.
 */
async function generateHistory(ds: DataSource, userId: string, principal: string, ahorro: string) {
  // Lotes pequeños: cada asiento actualiza la misma fila de accounts; muchas versiones
  // de una fila dentro de UNA transacción hacen cada UPDATE más lento (cadena de
  // versiones muertas). Lotes de 1,000 transferencias mantienen el seed en segundos.
  for (let high = HISTORY_TRANSFERS; high >= 1; high -= HISTORY_BATCH) {
    const low = Math.max(1, high - HISTORY_BATCH + 1);
    await insertHistoryBatch(ds, userId, principal, ahorro, low, high);
  }
}

async function insertHistoryBatch(
  ds: DataSource,
  userId: string,
  principal: string,
  ahorro: string,
  low: number,
  high: number,
) {
  await ds.transaction('READ COMMITTED', async (m) => {
    await m.query(
      `WITH gen AS (
         SELECT g,
                (1 + floor(random() * 50000))::bigint AS amount,
                now() - (g * interval '5 minutes') AS ts
           FROM generate_series($4::int, $5::int) AS g
       ),
       ins AS (
         INSERT INTO transfers (id, user_id, idempotency_key, request_hash, kind, source_account_id,
           destination_account_id, amount_cents, concept, reference, status, tracking_code,
           counts_toward_limit, created_at, completed_at)
         SELECT gen_random_uuid(), $1, gen_random_uuid(), repeat('0', 64), 'OWN_ACCOUNTS',
                CASE WHEN g % 2 = 0 THEN $2::uuid ELSE $3::uuid END,
                CASE WHEN g % 2 = 0 THEN $3::uuid ELSE $2::uuid END,
                amount, 'Movimiento histórico ' || g, (g % 9999999)::text, 'COMPLETED',
                'SEED' || lpad(g::text, 10, '0'), false, ts, ts
           FROM gen
         RETURNING id, source_account_id, destination_account_id, amount_cents, completed_at
       )
       INSERT INTO ledger_entries (transfer_id, account_id, entry_type, amount_cents, created_at)
       SELECT ins.id, e.account_id, e.entry_type::entry_type, e.amount, ins.completed_at
         FROM ins
         CROSS JOIN LATERAL (VALUES
           (1, ins.source_account_id, 'TRANSFER_OUT', -ins.amount_cents),
           (2, ins.destination_account_id, 'TRANSFER_IN', ins.amount_cents)
         ) AS e(side, account_id, entry_type, amount)
        ORDER BY ins.completed_at ASC, e.side ASC`,
      [userId, principal, ahorro, low, high],
    );
  });
}

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config.LOG_LEVEL);
  const ds = createDataSource({ url: config.DATABASE_URL, poolMax: 4 });
  await ds.initialize();
  try {
    const exists: Array<{ id: string }> = await ds.query(`SELECT id FROM users WHERE email = $1`, [
      DEMO_USERS.ana.email,
    ]);
    if (exists.length > 0) {
      logger.info('Seed ya aplicado: los usuarios demo existen; no se hace nada');
      return;
    }

    const services = buildServices(ds, config, logger);
    const ctx = { requestId: randomUUID() };
    const systemId = await systemAccountId(ds);

    const ana = await services.auth.register({ ...DEMO_USERS.ana, password: DEMO_PASSWORD }, ctx);
    const beto = await services.auth.register({ ...DEMO_USERS.beto, password: DEMO_PASSWORD }, ctx);
    const hist = await services.auth.register(
      { ...DEMO_USERS.historial, password: DEMO_PASSWORD },
      ctx,
    );
    const anaAcc = await accountsByName(ds, ana.id);
    const betoAcc = await accountsByName(ds, beto.id);
    const histAcc = await accountsByName(ds, hist.id);

    await deposit(ds, systemId, anaAcc.Principal!, 10_000_000, 'Depósito inicial'); // $100,000.00
    await deposit(ds, systemId, betoAcc.Principal!, 2_500_000, 'Depósito inicial'); // $25,000.00
    await deposit(ds, systemId, histAcc.Principal!, 100_000_000, 'Depósito inicial'); // $1,000,000.00
    await deposit(ds, systemId, histAcc.Ahorro!, 100_000_000, 'Depósito inicial');

    const [betoClabe] = (await ds.query(`SELECT clabe FROM accounts WHERE id = $1`, [
      betoAcc.Principal,
    ])) as Array<{
      clabe: string;
    }>;
    const [anaClabe] = (await ds.query(`SELECT clabe FROM accounts WHERE id = $1`, [
      anaAcc.Principal,
    ])) as Array<{
      clabe: string;
    }>;
    const benBeto = await services.beneficiaries.create(
      ana.id,
      { name: DEMO_USERS.beto.full_name, alias: 'Beto', clabe: betoClabe!.clabe },
      ctx,
    );
    await services.beneficiaries.create(
      beto.id,
      { name: DEMO_USERS.ana.full_name, alias: 'Ana', clabe: anaClabe!.clabe },
      ctx,
    );

    const samples: Array<[number, string, string]> = [
      [45_000, 'Cena', '101'],
      [120_050, 'Renta compartida', '102'],
      [9_999, 'Café', '103'],
    ];
    for (const [amount, concept, reference] of samples) {
      await services.transfers.create(
        ana.id,
        randomUUID(),
        {
          source_account_id: anaAcc.Principal!,
          beneficiary_id: benBeto.id,
          amount_cents: amount,
          concept,
          reference,
        },
        ctx,
      );
    }
    await services.transfers.create(
      ana.id,
      randomUUID(),
      {
        source_account_id: anaAcc.Principal!,
        destination_account_id: anaAcc.Ahorro!,
        amount_cents: 500_000,
        concept: 'Ahorro mensual',
        reference: '201',
      },
      ctx,
    );

    logger.info({ transfers: HISTORY_TRANSFERS }, 'Generando historial masivo…');
    await generateHistory(ds, hist.id, histAcc.Principal!, histAcc.Ahorro!);

    const entryRows: Array<{ entries: number }> = await ds.query(
      `SELECT count(*)::int AS entries FROM ledger_entries`,
    );
    const entries = entryRows[0]?.entries ?? 0;
    const totalRows: Array<{ total: string }> = await ds.query(
      `SELECT COALESCE(SUM(amount_cents), 0)::text AS total FROM ledger_entries`,
    );
    const total = totalRows[0]?.total;
    if (total !== '0') throw new Error(`El libro no cuadra tras el seed: ${total}`);

    // ANALYZE requiere ser dueño de la tabla: se usa el rol de migraciones si está disponible.
    if (process.env.DATABASE_MIGRATION_URL) {
      const ownerDs = createDataSource({ url: process.env.DATABASE_MIGRATION_URL, poolMax: 1 });
      await ownerDs.initialize();
      await ownerDs.query('ANALYZE');
      await ownerDs.destroy();
    }

    logger.info(
      {
        ledger_entries: entries,
        users: Object.values(DEMO_USERS).map((u) => u.email),
        password: DEMO_PASSWORD,
        history_account_id: histAcc.Principal,
      },
      'Seed completado (contraseña solo para demo local)',
    );
  } finally {
    await ds.destroy();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
