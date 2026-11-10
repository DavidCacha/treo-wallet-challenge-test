import { readFileSync } from 'node:fs';
import type { Express } from 'express';
import swaggerUi from 'swagger-ui-express';
import { parse } from 'yaml';

let cached: Record<string, unknown> | undefined;

/** Contrato OpenAPI 3.1 (fuente: packages/shared/openapi.yaml). */
export function loadOpenApiDocument(): Record<string, unknown> {
  if (!cached) {
    const file = require.resolve('@treo/shared/openapi.yaml');
    cached = parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
  }
  return cached;
}

/** Swagger UI navegable en /docs y el JSON en /docs/openapi.json. */
export function mountDocs(app: Express): void {
  const doc = loadOpenApiDocument();
  app.get('/docs/openapi.json', (_req, res) => {
    res.json(doc);
  });
  app.use('/docs', swaggerUi.serve, swaggerUi.setup(doc, { customSiteTitle: 'Treo Wallet API' }));
}
