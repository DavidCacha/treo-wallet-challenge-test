import type { CreateTransferRequest } from '../api/types';
import { deleteSecure, KEYS, readSecure, writeSecure } from '../api/secureStorage';

/** Lo que se muestra del intento (para la pantalla de estado, incluso tras reabrir la app). */
export interface TransferDisplay {
  sourceName: string;
  beneficiaryAlias: string;
  beneficiaryClabe: string;
  requiresOtp: boolean;
}

/**
 * Un intento de transferencia en curso: su Idempotency-Key y el cuerpo exacto.
 * Se persiste en SecureStore ANTES del primer envío y se borra solo con un
 * resultado definitivo (§5.3, §5.4), así sobrevive a cierres de la app.
 */
export interface PendingTransfer {
  v: 1;
  userId: string;
  idempotencyKey: string;
  payload: CreateTransferRequest;
  display: TransferDisplay;
  /** Se conoce cuando la API respondió 202 (requiere OTP). */
  transferId?: string;
  createdAt: string;
}

export interface PendingStore {
  load(): Promise<PendingTransfer | null>;
  save(p: PendingTransfer): Promise<void>;
  clear(): Promise<void>;
}

function isPending(x: unknown): x is PendingTransfer {
  const p = x as PendingTransfer | null;
  return (
    !!p &&
    p.v === 1 &&
    typeof p.userId === 'string' &&
    typeof p.idempotencyKey === 'string' &&
    typeof p.payload?.amount_cents === 'number' &&
    typeof p.display?.beneficiaryAlias === 'string'
  );
}

export const securePendingStore: PendingStore = {
  async load() {
    const raw = await readSecure(KEYS.pendingTransfer);
    if (!raw) return null;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (isPending(parsed)) return parsed;
    } catch {
      // continúa: registro ilegible
    }
    await deleteSecure(KEYS.pendingTransfer);
    return null;
  },
  save: (p) => writeSecure(KEYS.pendingTransfer, JSON.stringify(p)),
  clear: () => deleteSecure(KEYS.pendingTransfer),
};
