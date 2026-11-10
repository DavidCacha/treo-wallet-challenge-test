import type { EntityManager } from 'typeorm';
import { maskClabe } from '@treo/shared';
import { toSafeInteger } from '../../db/transformers';
import type { TransferStatus } from '../../db/entities/transfer.entity';

export interface OtpChallengeView {
  id: string;
  expires_at: string;
  attempts_remaining: number;
  dev_otp_code?: string;
}

export interface TransferView {
  id: string;
  status: TransferStatus;
  kind: 'P2P' | 'OWN_ACCOUNTS';
  amount_cents: number;
  source_account_id: string;
  destination: { display_name: string; clabe_masked: string };
  concept: string;
  reference: string;
  tracking_code: string;
  rejection_code: string | null;
  challenge: OtpChallengeView | null;
  created_at: string;
  completed_at: string | null;
}

interface Row {
  id: string;
  status: TransferStatus;
  kind: 'P2P' | 'OWN_ACCOUNTS';
  amount_cents: string;
  source_account_id: string;
  concept: string;
  reference: string;
  tracking_code: string;
  rejection_code: string | null;
  created_at: Date;
  completed_at: Date | null;
  dst_name: string;
  dst_clabe: string;
  ben_alias: string | null;
  ch_id: string | null;
  ch_expires_at: Date | null;
  ch_attempts: number | null;
  ch_max: number | null;
}

/**
 * Comprobante reconstruido siempre desde la base, así una respuesta repetida por
 * idempotencia refleja el estado real de la misma transferencia (R4.11, R4.17).
 */
export async function loadTransferView(
  m: EntityManager,
  transferId: string,
  userId: string,
): Promise<TransferView | undefined> {
  const rows: Row[] = await m.query(
    `SELECT t.id, t.status, t.kind, t.amount_cents::text AS amount_cents, t.source_account_id,
            t.concept, t.reference, t.tracking_code, t.rejection_code, t.created_at, t.completed_at,
            d.name AS dst_name, d.clabe AS dst_clabe, b.alias AS ben_alias,
            c.id AS ch_id, c.expires_at AS ch_expires_at, c.attempts AS ch_attempts, c.max_attempts AS ch_max
       FROM transfers t
       JOIN accounts d ON d.id = t.destination_account_id
       LEFT JOIN beneficiaries b ON b.id = t.beneficiary_id
       LEFT JOIN otp_challenges c ON c.transfer_id = t.id
      WHERE t.id = $1 AND t.user_id = $2`,
    [transferId, userId],
  );
  const r = rows[0];
  if (!r) return undefined;
  return {
    id: r.id,
    status: r.status,
    kind: r.kind,
    amount_cents: toSafeInteger(r.amount_cents),
    source_account_id: r.source_account_id,
    destination: {
      display_name: r.ben_alias ?? r.dst_name,
      clabe_masked: maskClabe(r.dst_clabe),
    },
    concept: r.concept,
    reference: r.reference,
    tracking_code: r.tracking_code,
    rejection_code: r.rejection_code,
    challenge:
      r.status === 'PENDING_OTP' && r.ch_id && r.ch_expires_at
        ? {
            id: r.ch_id,
            expires_at: r.ch_expires_at.toISOString(),
            attempts_remaining: Math.max(0, (r.ch_max ?? 0) - (r.ch_attempts ?? 0)),
          }
        : null,
    created_at: r.created_at.toISOString(),
    completed_at: r.completed_at ? r.completed_at.toISOString() : null,
  };
}
