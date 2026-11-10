import { AppError } from './problem';

interface PgError {
  code?: string;
  constraint?: string;
  driverError?: PgError;
}

function pgErrorOf(err: unknown): PgError | undefined {
  if (!err || typeof err !== 'object') return undefined;
  const e = err as PgError;
  if (e.driverError && typeof e.driverError === 'object') return e.driverError;
  return typeof e.code === 'string' ? e : undefined;
}

export function pgCode(err: unknown): string | undefined {
  return pgErrorOf(err)?.code;
}

export function pgConstraint(err: unknown): string | undefined {
  return pgErrorOf(err)?.constraint;
}

/** Errores transitorios de bloqueo: es seguro reintentar la transacción completa. */
export function isRetryableLockError(err: unknown): boolean {
  const code = pgCode(err);
  return (
    code === '40P01' /* deadlock */ || code === '55P03' /* lock_not_available */ || code === '40001'
  );
}

/**
 * Traduce errores de PostgreSQL a errores de dominio SIN exponer nombres de constraints.
 * Es la red de seguridad: los servicios validan antes, pero la base tiene la última palabra.
 */
export function translateDbError(err: unknown): AppError | undefined {
  const code = pgCode(err);
  const constraint = pgConstraint(err);
  if (!code) return undefined;
  if (code === '23514' && constraint === 'accounts_balance_non_negative') {
    return new AppError('INSUFFICIENT_FUNDS', 422, 'Saldo insuficiente');
  }
  if (isRetryableLockError(err)) {
    return new AppError(
      'TRY_AGAIN',
      503,
      'El sistema está ocupado; reintenta con la misma llave de idempotencia',
    );
  }
  return undefined;
}
