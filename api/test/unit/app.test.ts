import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { Writable } from 'node:stream';
import { createApp } from '../../src/http/app';
import { loadConfig } from '../../src/config/env';
import { createLogger } from '../../src/lib/logger';

function memoryLogger() {
  const lines: string[] = [];
  const dest = new Writable({
    write(chunk, _enc, cb) {
      lines.push(String(chunk));
      cb();
    },
  });
  return { logger: createLogger('info', dest), lines };
}

describe('esqueleto HTTP [T-02]', () => {
  const config = loadConfig();

  it('GET /api/v1/health responde 200 y devuelve X-Request-Id', async () => {
    const { logger } = memoryLogger();
    const res = await request(createApp({ config, logger })).get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('reutiliza un X-Request-Id válido del cliente', async () => {
    const { logger } = memoryLogger();
    const id = '6f1c2a5e-8f0b-4b8e-9d4a-2c1e5b7a9f00';
    const res = await request(createApp({ config, logger }))
      .get('/api/v1/health')
      .set('X-Request-Id', id);
    expect(res.headers['x-request-id']).toBe(id);
  });

  it('ruta inexistente → problem+json RFC 7807 con request_id', async () => {
    const { logger } = memoryLogger();
    const res = await request(createApp({ config, logger })).get('/api/v1/nope');
    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.body).toMatchObject({
      type: 'https://treo.example/problems/not-found',
      status: 404,
      code: 'NOT_FOUND',
      instance: '/api/v1/nope',
    });
    expect(res.body.request_id).toBe(res.headers['x-request-id']);
  });

  it('JSON malformado → 400 VALIDATION_ERROR sin detalles internos', async () => {
    const { logger } = memoryLogger();
    const res = await request(createApp({ config, logger }))
      .post('/api/v1/health')
      .set('Content-Type', 'application/json')
      .send('{"a":');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(JSON.stringify(res.body)).not.toMatch(/stack|SyntaxError/);
  });

  it('errores inesperados → 500 genérico, sin stack', async () => {
    const { logger } = memoryLogger();
    const app = createApp({
      config,
      logger,
      healthCheck: async () => {
        throw new Error('connection refused at 10.0.0.1');
      },
    });
    const res = await request(app).get('/api/v1/health');
    expect(res.status).toBe(500);
    expect(res.body.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(res.body)).not.toContain('10.0.0.1');
  });

  it('el logger redacta secretos y enmascara CLABEs', () => {
    const { logger, lines } = memoryLogger();
    logger.info(
      {
        req: { headers: { authorization: 'Bearer abc.def' } },
        body: {
          password: 'Secreta123!',
          refresh_token: 'rt',
          code: '123456',
          clabe: '999180000000000013',
        },
      },
      'test',
    );
    const out = lines.join('');
    expect(out).not.toContain('Bearer abc.def');
    expect(out).not.toContain('Secreta123!');
    expect(out).not.toContain('123456"');
    expect(out).not.toContain('999180000000000013');
    expect(out).toContain('**************0013');
  });
});

describe('documentación OpenAPI [T-04]', () => {
  it('sirve Swagger UI en /docs y el contrato en /docs/openapi.json', async () => {
    const { mountDocs } = await import('../../src/http/docs');
    const config = loadConfig();
    const app = createApp({ config, logger: createLogger('silent'), preSecurity: mountDocs });
    const html = await request(app).get('/docs/').redirects(1);
    expect(html.status).toBe(200);
    expect(html.text).toContain('swagger-ui');
    const json = await request(app).get('/docs/openapi.json');
    expect(json.body.openapi).toBe('3.1.0');
    expect(Object.keys(json.body.paths)).toContain('/transfers');
  });
});
