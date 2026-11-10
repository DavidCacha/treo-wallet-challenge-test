import 'reflect-metadata';
import { loadConfig } from './config/env';
import { createLogger } from './lib/logger';
import { createDataSource } from './db/data-source';
import { buildApp } from './container';

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config.LOG_LEVEL);
  const ds = createDataSource({ url: config.DATABASE_URL, poolMax: config.DB_POOL_MAX });
  await ds.initialize();
  const { app } = buildApp(ds, config, logger);
  const server = app.listen(config.PORT, () => {
    logger.info({ port: config.PORT, docs: `http://localhost:${config.PORT}/docs` }, 'API lista');
  });

  const shutdown = (signal: string) => {
    logger.info({ signal }, 'cerrando');
    server.close(() => {
      void ds.destroy().finally(() => process.exit(0));
    });
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
