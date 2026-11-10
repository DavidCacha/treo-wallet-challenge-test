import type { DataSource } from 'typeorm';
import { maskClabe, type MovementsQuery, type MovementType } from '@treo/shared';
import type { AppConfig } from '../../config/env';
import { Account } from '../../db/entities/account.entity';
import { toSafeInteger } from '../../db/transformers';
import { AppError } from '../../lib/problem';
import { decodeCursor, encodeCursor } from './cursor';

export interface MovementView {
  id: string;
  type: MovementType;
  amount_cents: number;
  balance_after_cents: number;
  transfer_id: string;
  concept: string | null;
  reference: string | null;
  counterparty: { display_name: string; clabe_masked: string } | null;
  created_at: string;
}

export interface MovementPage {
  data: MovementView[];
  next_cursor: string | null;
}

interface Row {
  id: string;
  entry_type: MovementType;
  amount_cents: string;
  balance_after_cents: string;
  transfer_id: string;
  cursor_ts: string;
  kind: 'P2P' | 'OWN_ACCOUNTS' | 'DEPOSIT';
  concept: string;
  reference: string;
  other_name: string | null;
  other_clabe: string | null;
  other_owner: string | null;
  ben_alias: string | null;
}

/**
 * Página del historial. La CTE `page` es la parte que resuelve el índice
 * ledger_entries_history_idx (keyset, sin OFFSET); los JOIN de detalle solo
 * tocan las ≤ limit+1 filas de la página (design.md §10).
 */
export const MOVEMENTS_SQL = `
WITH page AS (
  SELECT le.id, le.transfer_id, le.entry_type, le.amount_cents, le.balance_after_cents, le.created_at
    FROM ledger_entries le
   WHERE le.account_id = $1
     AND ($3::date IS NULL OR le.created_at >= ($3::date::timestamp AT TIME ZONE $2))
     AND ($4::date IS NULL OR le.created_at < (($4::date + 1)::timestamp AT TIME ZONE $2))
     AND ($5::entry_type IS NULL OR le.entry_type = $5::entry_type)
     AND ($6::timestamptz IS NULL OR (le.created_at, le.id) < ($6::timestamptz, $7::bigint))
   ORDER BY le.created_at DESC, le.id DESC
   LIMIT $8
)
SELECT page.id::text AS id, page.entry_type, page.amount_cents::text AS amount_cents,
       page.balance_after_cents::text AS balance_after_cents, page.transfer_id,
       to_char(page.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_ts,
       t.kind, t.concept, t.reference,
       oa.name AS other_name, oa.clabe AS other_clabe, ou.full_name AS other_owner, b.alias AS ben_alias
  FROM page
  JOIN transfers t ON t.id = page.transfer_id
  LEFT JOIN LATERAL (
    SELECT le2.account_id FROM ledger_entries le2
     WHERE le2.transfer_id = page.transfer_id AND le2.account_id <> $1
     LIMIT 1
  ) other ON true
  LEFT JOIN accounts oa ON oa.id = other.account_id
  LEFT JOIN users ou ON ou.id = oa.user_id
  LEFT JOIN beneficiaries b ON b.id = t.beneficiary_id
 ORDER BY page.created_at DESC, page.id DESC`;

function counterpartyOf(r: Row): MovementView['counterparty'] {
  if (r.kind === 'DEPOSIT' || !r.other_clabe) return null;
  let displayName: string;
  if (r.kind === 'OWN_ACCOUNTS') displayName = r.other_name ?? 'Cuenta propia';
  else if (r.entry_type === 'TRANSFER_OUT')
    displayName = r.ben_alias ?? r.other_owner ?? 'Beneficiario';
  else displayName = r.other_owner ?? 'Remitente';
  return { display_name: displayName, clabe_masked: maskClabe(r.other_clabe) };
}

export class MovementsService {
  constructor(
    private readonly ds: DataSource,
    private readonly config: AppConfig,
  ) {}

  /** R5.1–R5.5: historial de una cuenta propia, más reciente primero, por cursor. */
  async list(userId: string, accountId: string, q: MovementsQuery): Promise<MovementPage> {
    const owned = await this.ds
      .getRepository(Account)
      .existsBy({ id: accountId, userId, kind: 'USER' });
    if (!owned) throw new AppError('NOT_FOUND', 404, 'Cuenta no encontrada');

    const cursor = q.cursor ? decodeCursor(q.cursor) : undefined;
    const rows: Row[] = await this.ds.query(MOVEMENTS_SQL, [
      accountId,
      this.config.BUSINESS_TIMEZONE,
      q.from ?? null,
      q.to ?? null,
      q.type ?? null,
      cursor?.t ?? null,
      cursor?.id ?? null,
      q.limit + 1,
    ]);

    const pageRows = rows.slice(0, q.limit);
    const last = pageRows[pageRows.length - 1];
    return {
      data: pageRows.map((r) => ({
        id: r.id,
        type: r.entry_type,
        amount_cents: toSafeInteger(r.amount_cents),
        balance_after_cents: toSafeInteger(r.balance_after_cents),
        transfer_id: r.transfer_id,
        concept: r.concept,
        reference: r.reference,
        counterparty: counterpartyOf(r),
        created_at: r.cursor_ts,
      })),
      next_cursor:
        rows.length > q.limit && last ? encodeCursor({ t: last.cursor_ts, id: last.id }) : null,
    };
  }
}
