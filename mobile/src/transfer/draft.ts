import { getRandomValues } from 'expo-crypto';
import { createTransferSchema, parseMxnToCents } from '@treo/shared';
import type { ParseMoneyError } from '@treo/shared';
import type { CreateTransferRequest } from '../api/types';
import type { TransferDisplay } from './pendingStore';

/** Valores tal como los capturó el usuario (para volver a editarlos). */
export interface TransferFormValues {
  source_account_id: string;
  beneficiary_id: string;
  amount: string;
  concept: string;
  reference: string;
}

export interface TransferDraft {
  values: TransferFormValues;
  payload: CreateTransferRequest;
  display: TransferDisplay;
}

export type FormErrors = Partial<Record<keyof TransferFormValues, string>>;

const AMOUNT_ERRORS: Record<ParseMoneyError, string> = {
  EMPTY: 'Requerido',
  INVALID_FORMAT: 'Escribe un monto como 1,234.56',
  TOO_MANY_DECIMALS: 'Máximo 2 decimales',
  OUT_OF_RANGE: 'El monto excede el máximo por transferencia',
};

const FIELD_OF: Record<string, keyof TransferFormValues> = {
  source_account_id: 'source_account_id',
  beneficiary_id: 'beneficiary_id',
  amount_cents: 'amount',
  concept: 'concept',
  reference: 'reference',
};

/** Referencia numérica de 7 dígitos al azar (el usuario puede cambiarla). */
export function generateReference(): string {
  const [n] = getRandomValues(new Uint32Array(1));
  return String(1_000_000 + ((n ?? 0) % 9_000_000));
}

/**
 * Convierte lo capturado en el cuerpo de la API con las reglas compartidas
 * (parseMxnToCents y createTransferSchema de @treo/shared): sin float, sin
 * redondeo y solo a beneficiarios registrados (R4.16).
 */
export function validateTransfer(
  v: TransferFormValues,
): { ok: true; payload: CreateTransferRequest } | { ok: false; errors: FormErrors } {
  const errors: FormErrors = {};
  const money = parseMxnToCents(v.amount);
  if (!money.ok) errors.amount = AMOUNT_ERRORS[money.error];
  if (!v.source_account_id) errors.source_account_id = 'Elige la cuenta de origen';
  if (!v.beneficiary_id) errors.beneficiary_id = 'Elige a quién transferir';

  const parsed = createTransferSchema.safeParse({
    source_account_id: v.source_account_id,
    beneficiary_id: v.beneficiary_id,
    amount_cents: money.ok ? money.cents : 1,
    concept: v.concept,
    reference: v.reference.trim(),
  });
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const field = FIELD_OF[String(issue.path[0])];
      if (field && !errors[field]) errors[field] = issue.message;
    }
  }
  if (Object.keys(errors).length > 0 || !parsed.success) return { ok: false, errors };
  return { ok: true, payload: parsed.data };
}
