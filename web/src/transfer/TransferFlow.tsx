import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { CreateTransferRequest } from '../api/types';

/** Valores tal como los capturó el usuario (para volver a editarlos). */
export interface TransferFormValues {
  source_account_id: string;
  destination: string; // "b:<beneficiaryId>" | "a:<accountId>"
  amount: string;
  concept: string;
  reference: string;
}

export interface TransferDraft {
  values: TransferFormValues;
  payload: CreateTransferRequest;
  display: {
    sourceName: string;
    destinationName: string;
    destinationDetail: string;
    requiresOtp: boolean;
  };
}

/** Un intento = un borrador revisado + su Idempotency-Key. */
export interface TransferAttempt {
  draft: TransferDraft;
  idempotencyKey: string;
}

interface TransferFlowValue {
  attempt: TransferAttempt | null;
  /** Último borrador (se conserva al "Editar" para no volver a capturar todo). */
  lastValues: TransferFormValues | null;
  startAttempt: (draft: TransferDraft) => void;
  /** Editar/Corregir: termina el intento (descarta la llave) y conserva lo capturado. */
  endAttempt: () => void;
  /** La transferencia ya existe en el servidor: se olvida el intento y el borrador. */
  finishAttempt: () => void;
}

const TransferFlowContext = createContext<TransferFlowValue | null>(null);

export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

/**
 * R4.14: la llave se genera UNA vez por intento, al pasar del formulario a la
 * pantalla de confirmación, y se reutiliza en cada reintento de ese intento.
 * "Editar" o "Corregir" terminan el intento: el siguiente envío lleva otra llave.
 */
export function TransferFlowProvider({ children }: { children: ReactNode }) {
  const [attempt, setAttempt] = useState<TransferAttempt | null>(null);
  const [lastValues, setLastValues] = useState<TransferFormValues | null>(null);

  const startAttempt = useCallback((draft: TransferDraft) => {
    setLastValues(draft.values);
    setAttempt({ draft, idempotencyKey: newIdempotencyKey() });
  }, []);

  const endAttempt = useCallback(() => setAttempt(null), []);

  const finishAttempt = useCallback(() => {
    setAttempt(null);
    setLastValues(null);
  }, []);

  const value = useMemo(
    () => ({ attempt, lastValues, startAttempt, endAttempt, finishAttempt }),
    [attempt, lastValues, startAttempt, endAttempt, finishAttempt],
  );
  return <TransferFlowContext.Provider value={value}>{children}</TransferFlowContext.Provider>;
}

export function useTransferFlow(): TransferFlowValue {
  const ctx = useContext(TransferFlowContext);
  if (!ctx) throw new Error('useTransferFlow debe usarse dentro de <TransferFlowProvider>');
  return ctx;
}
