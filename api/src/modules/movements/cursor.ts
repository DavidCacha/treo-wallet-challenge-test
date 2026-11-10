import { AppError } from '../../lib/problem';

/**
 * Cursor opaco para paginación keyset por (created_at, id).
 * created_at viaja como texto con MICROsegundos: un Date de JS solo tiene
 * milisegundos y perdería precisión, lo que duplicaría u omitiría filas.
 */
export interface Cursor {
  t: string; // 2026-11-10T18:04:05.123456Z
  id: string; // id del asiento (bigint como texto)
}

const TS_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const ID_RE = /^\d{1,19}$/;

export function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify([c.t, c.id]), 'utf8').toString('base64url');
}

export function decodeCursor(raw: string): Cursor {
  const invalid = () =>
    new AppError('VALIDATION_ERROR', 400, 'Cursor inválido', {
      errors: [{ path: 'cursor', message: 'Cursor inválido' }],
    });
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    throw invalid();
  }
  if (
    !Array.isArray(parsed) ||
    parsed.length !== 2 ||
    typeof parsed[0] !== 'string' ||
    typeof parsed[1] !== 'string' ||
    !TS_RE.test(parsed[0]) ||
    !ID_RE.test(parsed[1]) ||
    Number.isNaN(Date.parse(parsed[0]))
  ) {
    throw invalid();
  }
  return { t: parsed[0], id: parsed[1] };
}
