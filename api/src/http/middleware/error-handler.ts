import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { AppError, toProblem } from '../../lib/problem';
import { translateDbError } from '../../lib/db-errors';

function requestIdOf(req: { id?: unknown }): string {
  return String(req.id ?? '');
}

export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(new AppError('NOT_FOUND', 404, `No existe la ruta ${req.method} ${req.path}`));
};

/** Traduce cualquier error a RFC 7807 sin filtrar detalles internos (NFR-5). */
export const problemHandler: ErrorRequestHandler = (err, req, res, _next) => {
  let appError: AppError;
  if (err instanceof AppError) {
    appError = err;
  } else if (err instanceof ZodError) {
    appError = new AppError('VALIDATION_ERROR', 400, 'La solicitud contiene datos inválidos', {
      errors: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  } else if (
    err &&
    typeof err === 'object' &&
    'type' in err &&
    err.type === 'entity.parse.failed'
  ) {
    appError = new AppError('VALIDATION_ERROR', 400, 'El cuerpo no es JSON válido');
  } else if (err && typeof err === 'object' && 'type' in err && err.type === 'entity.too.large') {
    appError = new AppError(
      'PAYLOAD_TOO_LARGE',
      413,
      'El cuerpo de la solicitud es demasiado grande',
    );
  } else {
    appError =
      translateDbError(err) ?? new AppError('INTERNAL_ERROR', 500, 'Ocurrió un error inesperado');
  }

  if (appError.status >= 500) {
    req.log?.error({ err }, 'request failed');
  } else {
    req.log?.info({ code: appError.code, status: appError.status }, 'request rejected');
  }

  res
    .status(appError.status)
    .type('application/problem+json')
    .json(toProblem(appError, req.originalUrl, requestIdOf(req)));
};
