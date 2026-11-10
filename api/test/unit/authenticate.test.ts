import { describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { loadConfig } from '../../src/config/env';
import { TokenService } from '../../src/modules/auth/tokens';
import { authenticate } from '../../src/http/middleware/authenticate';
import { problemHandler } from '../../src/http/middleware/error-handler';

const config = loadConfig();
const tokens = new TokenService(config);

function app() {
  const a = express();
  a.get('/private', authenticate(tokens), (req, res) => {
    res.json({ userId: req.auth?.userId });
  });
  a.use(problemHandler);
  return a;
}

describe('authenticate [R1.4, T-08]', () => {
  it('acepta un JWT válido', async () => {
    const token = tokens.signAccess('11111111-1111-4111-8111-111111111111');
    const res = await request(app()).get('/private').set('Authorization', `Bearer ${token}`);
    expect(res.body.userId).toBe('11111111-1111-4111-8111-111111111111');
  });

  it('sin token → 401 UNAUTHORIZED', async () => {
    const res = await request(app()).get('/private');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNAUTHORIZED');
  });

  it('token expirado → 401 TOKEN_EXPIRED', async () => {
    const token = jwt.sign(
      { sub: 'u', exp: Math.floor(Date.now() / 1000) - 10 },
      config.JWT_SECRET,
      {
        issuer: config.JWT_ISSUER,
        audience: config.JWT_AUDIENCE,
      },
    );
    const res = await request(app()).get('/private').set('Authorization', `Bearer ${token}`);
    expect(res.body.code).toBe('TOKEN_EXPIRED');
  });

  it('firma inválida, algoritmo none o audiencia ajena → 401', async () => {
    const forged = jwt.sign({ sub: 'u' }, 'otro-secreto-de-al-menos-32-caracteres!!', {
      issuer: config.JWT_ISSUER,
      audience: config.JWT_AUDIENCE,
    });
    const none = jwt.sign({ sub: 'u' }, '', { algorithm: 'none' });
    const otherAud = jwt.sign({ sub: 'u' }, config.JWT_SECRET, {
      issuer: config.JWT_ISSUER,
      audience: 'x',
    });
    for (const t of [forged, none, otherAud]) {
      const res = await request(app()).get('/private').set('Authorization', `Bearer ${t}`);
      expect(res.status).toBe(401);
    }
  });
});
