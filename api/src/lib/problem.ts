/**
 * Errores de dominio que se traducen a application/problem+json (RFC 7807).
 * Los mensajes son seguros para el cliente: nunca contienen SQL, stack ni nombres internos.
 */
export class AppError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    public readonly detail?: string,
    public readonly extras: Record<string, unknown> = {},
  ) {
    super(detail ?? code);
    this.name = 'AppError';
  }
}

const TITLES: Record<number, string> = {
  400: 'Solicitud inválida',
  401: 'No autenticado',
  403: 'Prohibido',
  404: 'No encontrado',
  409: 'Conflicto',
  413: 'Solicitud demasiado grande',
  422: 'Regla de negocio incumplida',
  429: 'Demasiadas solicitudes',
  500: 'Error interno',
  503: 'Servicio no disponible temporalmente',
};

export function problemType(code: string): string {
  return `https://treo.example/problems/${code.toLowerCase().replace(/_/g, '-')}`;
}

export interface ProblemBody {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  code: string;
  request_id: string;
  [key: string]: unknown;
}

export function toProblem(err: AppError, instance: string, requestId: string): ProblemBody {
  return {
    type: problemType(err.code),
    title: TITLES[err.status] ?? 'Error',
    status: err.status,
    ...(err.detail ? { detail: err.detail } : {}),
    instance,
    code: err.code,
    request_id: requestId,
    ...err.extras,
  };
}

export const Errors = {
  notFound: (what = 'Recurso') => new AppError('NOT_FOUND', 404, `${what} no encontrado`),
  unauthorized: (detail = 'Se requiere autenticación') => new AppError('UNAUTHORIZED', 401, detail),
  internal: () => new AppError('INTERNAL_ERROR', 500, 'Ocurrió un error inesperado'),
};
