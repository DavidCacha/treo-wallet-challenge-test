import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { buildTestApp, PASSWORD, registerAndLogin, type TestContext } from '../helpers/app';

let ctx: TestContext;
beforeAll(async () => {
  ctx = await buildTestApp();
});
afterAll(async () => {
  await ctx.close();
});

async function auditActions(userId: string): Promise<string[]> {
  const rows = await ctx.ds.query(
    `SELECT action FROM audit_events WHERE actor_user_id = $1 ORDER BY id`,
    [userId],
  );
  return rows.map((r: { action: string }) => r.action);
}

describe('registro [R1.1–R1.3, T-07]', () => {
  it('crea el usuario con cuentas Principal y Ahorro, sin exponer el hash', async () => {
    const email = `Nuevo-${randomUUID()}@Test.dev`;
    const res = await request(ctx.app)
      .post('/api/v1/auth/register')
      .send({ email, full_name: 'Ana Pérez', password: PASSWORD });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ email: email.toLowerCase(), full_name: 'Ana Pérez' });
    expect(JSON.stringify(res.body)).not.toMatch(/password|argon/i);

    const accounts = await ctx.ds.query(
      `SELECT name, clabe, balance_cents FROM accounts WHERE user_id = $1 ORDER BY name`,
      [res.body.id],
    );
    expect(accounts.map((a: { name: string }) => a.name)).toEqual(['Ahorro', 'Principal']);
    const { isValidClabe } = await import('@treo/shared');
    for (const a of accounts) {
      expect(isValidClabe(a.clabe)).toBe(true);
      expect(Number(a.balance_cents)).toBe(0);
    }
    const [{ password_hash }] = await ctx.ds.query(
      `SELECT password_hash FROM users WHERE id = $1`,
      [res.body.id],
    );
    expect(password_hash).toMatch(/^\$argon2id\$/);
    expect(await auditActions(res.body.id)).toContain('user.registered');
  });

  it('correo duplicado (sin importar mayúsculas) → 409 EMAIL_ALREADY_REGISTERED', async () => {
    const email = `dup-${randomUUID()}@test.dev`;
    await request(ctx.app)
      .post('/api/v1/auth/register')
      .send({ email, full_name: 'A', password: PASSWORD })
      .expect(201);
    const res = await request(ctx.app)
      .post('/api/v1/auth/register')
      .send({ email: email.toUpperCase(), full_name: 'B', password: PASSWORD });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('EMAIL_ALREADY_REGISTERED');
  });

  it('contraseña corta → 400 con error por campo', async () => {
    const res = await request(ctx.app)
      .post('/api/v1/auth/register')
      .send({ email: `x-${randomUUID()}@test.dev`, full_name: 'A', password: 'corta' });
    expect(res.status).toBe(400);
    expect(res.body.errors[0].path).toBe('password');
  });
});

describe('login [R1.4–R1.6, R1.12, T-07]', () => {
  it('credenciales correctas → access + refresh (móvil en el cuerpo)', async () => {
    const user = await registerAndLogin(ctx.app);
    expect(user.accessToken.split('.')).toHaveLength(3);
    expect(user.refreshToken.length).toBeGreaterThan(40);
    expect(await auditActions(user.id)).toContain('auth.login_succeeded');
    const [row] = await ctx.ds.query(`SELECT token_hash FROM refresh_tokens WHERE user_id = $1`, [
      user.id,
    ]);
    expect(row.token_hash).not.toBe(user.refreshToken);
  });

  it('web recibe el refresh en cookie HttpOnly SameSite=Strict y no en el cuerpo [R1.10]', async () => {
    const user = await registerAndLogin(ctx.app);
    const res = await request(ctx.app)
      .post('/api/v1/auth/login')
      .set('X-Client-Platform', 'web')
      .send({ email: user.email, password: PASSWORD })
      .expect(200);
    expect(res.body.refresh_token).toBeUndefined();
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toMatch(/refresh_token=/);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Strict/);
    expect(cookie).toMatch(/Secure/);
    expect(cookie).toMatch(/Path=\/api\/v1\/auth/);
  });

  it('correo inexistente y contraseña errónea dan el mismo 401', async () => {
    const user = await registerAndLogin(ctx.app);
    const wrong = await request(ctx.app)
      .post('/api/v1/auth/login')
      .set('X-Client-Platform', 'mobile')
      .send({ email: user.email, password: 'otra-contraseña-123' });
    const missing = await request(ctx.app)
      .post('/api/v1/auth/login')
      .set('X-Client-Platform', 'mobile')
      .send({ email: `nadie-${randomUUID()}@test.dev`, password: 'otra-contraseña-123' });
    expect(wrong.status).toBe(401);
    expect(missing.status).toBe(401);
    expect(wrong.body.code).toBe('INVALID_CREDENTIALS');
    expect(missing.body.detail).toBe(wrong.body.detail);
    expect(await auditActions(user.id)).toContain('auth.login_failed');
  });

  it('sin X-Client-Platform → 400', async () => {
    const res = await request(ctx.app)
      .post('/api/v1/auth/login')
      .send({ email: 'a@b.dev', password: 'x' });
    expect(res.status).toBe(400);
  });

  it('el 6.º intento en la ventana → 429 con Retry-After [R1.6]', async () => {
    const email = `rl-${randomUUID()}@test.dev`;
    const statuses: number[] = [];
    let last: request.Response | undefined;
    for (let i = 0; i < 6; i++) {
      last = await request(ctx.app)
        .post('/api/v1/auth/login')
        .set('X-Client-Platform', 'mobile')
        .send({ email, password: 'incorrecta-123' });
      statuses.push(last.status);
    }
    expect(statuses).toEqual([401, 401, 401, 401, 401, 429]);
    expect(last!.headers['retry-after']).toBeDefined();
    expect(last!.body.code).toBe('RATE_LIMITED');
  });
});

describe('refresh rotativo y logout [R1.7–R1.9, EC-11, T-08]', () => {
  const refresh = (token: string) =>
    request(ctx.app)
      .post('/api/v1/auth/refresh')
      .set('X-Client-Platform', 'mobile')
      .send({ refresh_token: token });

  it('rota el token: el nuevo funciona y el anterior deja de servir', async () => {
    const user = await registerAndLogin(ctx.app);
    const first = await refresh(user.refreshToken);
    expect(first.status).toBe(200);
    expect(first.body.refresh_token).not.toBe(user.refreshToken);
    expect(first.body.access_token).toBeTruthy();
    const second = await refresh(first.body.refresh_token);
    expect(second.status).toBe(200);
  });

  it('reusar un token rotado revoca toda la familia y se audita', async () => {
    const user = await registerAndLogin(ctx.app);
    const rotated = await refresh(user.refreshToken);
    const reuse = await refresh(user.refreshToken);
    expect(reuse.status).toBe(401);
    expect(reuse.body.code).toBe('REFRESH_TOKEN_REUSED');
    // El token legítimo más reciente también quedó revocado.
    const afterReuse = await refresh(rotated.body.refresh_token);
    expect(afterReuse.status).toBe(401);
    expect(await auditActions(user.id)).toContain('auth.refresh_reuse_detected');
  });

  it('dos renovaciones simultáneas con el mismo token no emiten dos sesiones válidas', async () => {
    const user = await registerAndLogin(ctx.app);
    const results = await Promise.all([refresh(user.refreshToken), refresh(user.refreshToken)]);
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([200, 401]);
  });

  it('web renueva con la cookie y recibe una cookie nueva', async () => {
    const user = await registerAndLogin(ctx.app);
    // supertest no reenvía cookies Secure sobre http; se envía manualmente.
    const login = await request(ctx.app)
      .post('/api/v1/auth/login')
      .set('X-Client-Platform', 'web')
      .send({ email: user.email, password: PASSWORD });
    const cookie = String(login.headers['set-cookie']).split(';')[0]!;
    const res = await request(ctx.app)
      .post('/api/v1/auth/refresh')
      .set('X-Client-Platform', 'web')
      .set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.refresh_token).toBeUndefined();
    expect(String(res.headers['set-cookie'])).toMatch(/refresh_token=/);
  });

  it('logout revoca el refresh token', async () => {
    const user = await registerAndLogin(ctx.app);
    await request(ctx.app)
      .post('/api/v1/auth/logout')
      .set('X-Client-Platform', 'mobile')
      .send({ refresh_token: user.refreshToken })
      .expect(204);
    expect((await refresh(user.refreshToken)).status).toBe(401);
    expect(await auditActions(user.id)).toContain('auth.logout');
  });

  it('token inexistente → 401', async () => {
    expect((await refresh('no-existe')).status).toBe(401);
  });
});
