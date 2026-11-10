/**
 * Reglas de negocio de una transferencia como función pura (sin HTTP ni base de
 * datos) para poder probarlas de forma unitaria. El servicio la evalúa con las filas
 * ya bloqueadas, dentro de la transacción.
 */
export type RejectionCode = 'ACCOUNT_BLOCKED' | 'INSUFFICIENT_FUNDS' | 'DAILY_LIMIT_EXCEEDED';

export type Decision =
  | { kind: 'execute' }
  | { kind: 'require_otp' }
  | { kind: 'reject'; code: RejectionCode };

export interface PolicyInput {
  transferKind: 'P2P' | 'OWN_ACCOUNTS';
  amountCents: number;
  sourceBalanceCents: number;
  sourceStatus: 'ACTIVE' | 'BLOCKED';
  destinationStatus: 'ACTIVE' | 'BLOCKED';
  /** Transferencias a terceros completadas hoy (solo P2P cuenta, supuesto A-3). */
  usedTodayCents: number;
  dailyLimitCents: number;
  otpThresholdCents: number;
  /** true al confirmar con un OTP válido: ya no se vuelve a pedir. */
  otpVerified: boolean;
}

export function decideTransfer(i: PolicyInput): Decision {
  for (const n of [
    i.amountCents,
    i.sourceBalanceCents,
    i.usedTodayCents,
    i.dailyLimitCents,
    i.otpThresholdCents,
  ]) {
    if (!Number.isSafeInteger(n))
      throw new RangeError('Montos deben ser enteros seguros de centavos');
  }
  if (i.amountCents <= 0) throw new RangeError('El monto debe ser positivo');

  if (i.sourceStatus !== 'ACTIVE' || i.destinationStatus !== 'ACTIVE') {
    return { kind: 'reject', code: 'ACCOUNT_BLOCKED' };
  }
  if (i.sourceBalanceCents < i.amountCents) {
    return { kind: 'reject', code: 'INSUFFICIENT_FUNDS' };
  }
  if (i.transferKind === 'P2P') {
    // Igualar el límite está permitido; superarlo no (R6.1).
    if (i.usedTodayCents + i.amountCents > i.dailyLimitCents) {
      return { kind: 'reject', code: 'DAILY_LIMIT_EXCEEDED' };
    }
    // "Supera cierto monto" → estrictamente mayor que el umbral (R6.3).
    if (!i.otpVerified && i.amountCents > i.otpThresholdCents) {
      return { kind: 'require_otp' };
    }
  }
  return { kind: 'execute' };
}
