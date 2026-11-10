import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';

/** Código de 6 dígitos con CSPRNG (R6.5). */
export function generateOtpCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

/** HMAC-SHA256 con pepper del servidor, ligado a la transferencia: el código nunca se guarda en claro. */
export function hashOtp(pepper: string, transferId: string, code: string): string {
  return createHmac('sha256', pepper).update(`${transferId}:${code}`).digest('hex');
}

/** Comparación en tiempo constante. */
export function verifyOtp(
  pepper: string,
  transferId: string,
  code: string,
  expectedHash: string,
): boolean {
  const actual = Buffer.from(hashOtp(pepper, transferId, code), 'hex');
  const expected = Buffer.from(expectedHash, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
