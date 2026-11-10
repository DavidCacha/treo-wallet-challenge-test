import { randomBytes } from 'node:crypto';

/** Folio legible para el comprobante: TRX + fecha UTC + 8 hex aleatorios. */
export function newTrackingCode(now = new Date()): string {
  const ymd = now.toISOString().slice(0, 10).replace(/-/g, '');
  return `TRX${ymd}${randomBytes(4).toString('hex').toUpperCase()}`;
}
