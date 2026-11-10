import type { EntityManager } from 'typeorm';

export interface PostableTransfer {
  id: string;
  kind: 'P2P' | 'OWN_ACCOUNTS' | 'DEPOSIT';
  sourceAccountId: string;
  destinationAccountId: string;
  amountCents: number;
}

/**
 * Partida doble: débito en origen y crédito en destino por el mismo monto.
 * El trigger aplica cada asiento al saldo (y el CHECK impide negativos); el
 * constraint trigger diferido verifica al COMMIT que la suma sea cero (D-2).
 * created_at toma el now() de la transacción, igual que transfers.completed_at.
 */
export async function postTransferEntries(m: EntityManager, t: PostableTransfer): Promise<void> {
  if (!Number.isSafeInteger(t.amountCents) || t.amountCents <= 0) {
    throw new RangeError('Monto inválido para asentar');
  }
  const creditType = t.kind === 'DEPOSIT' ? 'DEPOSIT' : 'TRANSFER_IN';
  await m.query(
    `INSERT INTO ledger_entries (transfer_id, account_id, entry_type, amount_cents)
     VALUES ($1, $2, 'TRANSFER_OUT', $3), ($1, $4, $5::entry_type, $6)`,
    [t.id, t.sourceAccountId, -t.amountCents, t.destinationAccountId, creditType, t.amountCents],
  );
}
