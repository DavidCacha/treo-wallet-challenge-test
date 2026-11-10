import rateLimit from 'express-rate-limit';
import type { RequestHandler } from 'express';
import type { AppConfig } from '../config/env';
import { AppError, toProblem } from '../lib/problem';

/**
 * R1.6: máximo N intentos de login por IP + correo en la ventana configurada.
 * Almacén en memoria (una réplica); en producción se mueve a Redis/WAF.
 */
export function loginRateLimiter(config: AppConfig): RequestHandler {
  return rateLimit({
    windowMs: config.LOGIN_RATE_LIMIT_WINDOW_MS,
    limit: config.LOGIN_RATE_LIMIT_MAX,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: (req) => {
      const email =
        typeof req.body === 'object' && req.body && typeof req.body.email === 'string'
          ? req.body.email.trim().toLowerCase()
          : '';
      return `${req.ip ?? 'unknown'}|${email}`;
    },
    handler: (req, res, _next, options) => {
      const retryAfter = Math.ceil(options.windowMs / 1000);
      if (!res.getHeader('Retry-After')) res.setHeader('Retry-After', String(retryAfter));
      const err = new AppError(
        'RATE_LIMITED',
        429,
        'Demasiados intentos; espera antes de reintentar',
      );
      res
        .status(429)
        .type('application/problem+json')
        .json(toProblem(err, req.originalUrl, String(req.id)));
    },
  });
}

/** Límite general para /auth/* por IP. */
export function authRateLimiter(config: AppConfig): RequestHandler {
  return rateLimit({
    windowMs: 60_000,
    limit: config.AUTH_RATE_LIMIT_MAX,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (req, res) => {
      const err = new AppError('RATE_LIMITED', 429, 'Demasiadas solicitudes');
      res
        .status(429)
        .setHeader('Retry-After', '60')
        .type('application/problem+json')
        .json(toProblem(err, req.originalUrl, String(req.id)));
    },
  });
}
