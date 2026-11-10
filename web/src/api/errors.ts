import type { Problem } from './types';

/** Error HTTP con el problema RFC 7807 que devolvió la API. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly problem: Problem | undefined;
  readonly retryAfterSeconds: number | undefined;

  constructor(status: number, problem: Problem | undefined, retryAfter?: string | null) {
    super(problem?.detail ?? problem?.title ?? `HTTP ${status}`);
    this.name = 'ApiError';
    this.status = status;
    this.code = problem?.code ?? 'HTTP_ERROR';
    this.problem = problem;
    const n = retryAfter ? Number(retryAfter) : NaN;
    this.retryAfterSeconds = Number.isInteger(n) && n > 0 ? n : undefined;
  }
}

/** La petición no obtuvo respuesta (sin red, servidor caído, CORS). */
export class NetworkError extends Error {
  constructor(cause?: unknown) {
    super('No hay conexión con el servidor');
    this.name = 'NetworkError';
    this.cause = cause;
  }
}

const MESSAGES: Record<string, string> = {
  INVALID_CREDENTIALS: 'Correo o contraseña incorrectos.',
  EMAIL_ALREADY_REGISTERED: 'Ese correo ya está registrado.',
  RATE_LIMITED: 'Demasiados intentos. Espera un momento e inténtalo de nuevo.',
  BENEFICIARY_ALREADY_EXISTS: 'Ya tienes un beneficiario con esa CLABE.',
  INVALID_CLABE_CHECK_DIGIT: 'El dígito verificador de la CLABE no es válido.',
  CLABE_NOT_FOUND: 'La CLABE no pertenece a una cuenta de la plataforma.',
  BENEFICIARY_IS_OWN_ACCOUNT: 'Esa CLABE es de una de tus cuentas. Usa "Mis cuentas" como destino.',
  INSUFFICIENT_FUNDS: 'Saldo insuficiente en la cuenta de origen.',
  DAILY_LIMIT_EXCEEDED: 'La transferencia supera tu límite diario disponible.',
  SAME_ACCOUNT_TRANSFER: 'La cuenta de origen y la de destino no pueden ser la misma.',
  ACCOUNT_BLOCKED: 'La cuenta no está activa.',
  IDEMPOTENCY_KEY_REUSED:
    'Este intento ya se usó con otros datos. Vuelve a capturar la transferencia.',
  OTP_INVALID: 'El código no es correcto.',
  OTP_EXPIRED: 'El código expiró o se agotaron los intentos. La transferencia no se realizó.',
  TRANSFER_NOT_PENDING: 'La transferencia ya no está pendiente de confirmación.',
  TRY_AGAIN: 'El servicio está ocupado. Reintenta: no se duplicará la operación.',
  NOT_FOUND: 'No encontramos lo que buscas.',
  VALIDATION_ERROR: 'Revisa los datos capturados.',
};

/** Mensaje en español para mostrar al usuario a partir de cualquier error. */
export function messageFor(error: unknown): string {
  if (error instanceof NetworkError) {
    return 'No pudimos comunicarnos con el servidor. Revisa tu conexión.';
  }
  if (error instanceof ApiError) {
    if (error.code === 'RATE_LIMITED' && error.retryAfterSeconds) {
      return `Demasiados intentos. Inténtalo de nuevo en ${error.retryAfterSeconds} segundos.`;
    }
    return MESSAGES[error.code] ?? 'Ocurrió un error inesperado. Inténtalo de nuevo.';
  }
  return 'Ocurrió un error inesperado. Inténtalo de nuevo.';
}

export function isApiError(error: unknown, code?: string): error is ApiError {
  return error instanceof ApiError && (code === undefined || error.code === code);
}
