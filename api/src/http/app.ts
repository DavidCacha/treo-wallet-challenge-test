import express, { type Express, type Router } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import pinoHttp from 'pino-http';
import type { Logger } from 'pino';
import type { AppConfig } from '../config/env';
import { genRequestId } from './middleware/request-id';
import { notFoundHandler, problemHandler } from './middleware/error-handler';

export interface AppOptions {
  config: AppConfig;
  logger: Logger;
  /** Verifica dependencias para /health (p. ej. SELECT 1). */
  healthCheck?: () => Promise<void>;
  /** Routers de los módulos de dominio montados bajo /api/v1. */
  routers?: Router[];
  /** Montajes previos a helmet (Swagger UI necesita scripts en línea). */
  preSecurity?: (app: Express) => void;
}

export function createApp(opts: AppOptions): Express {
  const { config, logger } = opts;
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', false);

  app.use(
    pinoHttp({
      logger,
      genReqId: genRequestId,
      customProps: (req) => ({ user_id: (req as express.Request).auth?.userId }),
      serializers: {
        req: (req: { id: unknown; method: string; url: string }) => ({
          id: req.id,
          method: req.method,
          url: req.url,
        }),
        res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
      },
    }),
  );

  opts.preSecurity?.(app);

  app.use(helmet());
  app.use(
    cors({
      origin: config.CORS_ORIGINS,
      credentials: true,
      allowedHeaders: [
        'Content-Type',
        'Authorization',
        'Idempotency-Key',
        'X-Client-Platform',
        'X-Request-Id',
      ],
      exposedHeaders: ['X-Request-Id', 'Idempotent-Replayed', 'Retry-After'],
    }),
  );
  app.use(express.json({ limit: '10kb' }));
  app.use(cookieParser());

  const api = express.Router();
  api.get('/health', async (_req, res) => {
    await opts.healthCheck?.();
    res.json({ status: 'ok' });
  });
  for (const router of opts.routers ?? []) api.use(router);
  app.use('/api/v1', api);

  app.use(notFoundHandler);
  app.use(problemHandler);
  return app;
}
