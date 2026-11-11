import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { server } from '../test/server';
import { API } from '../test/fixtures';
import { request } from './client';
import { getAccessToken, refreshAccessToken, setAccessToken } from './session';

describe('sesión web [R1.10, R1.8]', () => {
  it('single-flight: renovaciones simultáneas hacen una sola petición a /auth/refresh', async () => {
    let calls = 0;
    server.use(
      http.post(`${API}/auth/refresh`, async () => {
        calls += 1;
        await new Promise((r) => setTimeout(r, 20));
        return HttpResponse.json({
          access_token: `t${calls}`,
          token_type: 'Bearer',
          expires_in: 900,
        });
      }),
    );
    const tokens = await Promise.all([
      refreshAccessToken(),
      refreshAccessToken(),
      refreshAccessToken(),
    ]);
    expect(calls).toBe(1);
    expect(new Set(tokens)).toEqual(new Set(['t1']));
    expect(getAccessToken()).toBe('t1');
  });

  it('envía X-Client-Platform: web y la cookie (credentials) al renovar', async () => {
    let platform: string | null = null;
    server.use(
      http.post(`${API}/auth/refresh`, ({ request }) => {
        platform = request.headers.get('X-Client-Platform');
        return HttpResponse.json({ access_token: 'x', token_type: 'Bearer', expires_in: 900 });
      }),
    );
    await refreshAccessToken();
    expect(platform).toBe('web');
  });

  it('ante un 401 renueva una vez y repite la petición con el token nuevo', async () => {
    setAccessToken('vencido');
    const seen: Array<string | null> = [];
    server.use(
      http.get(`${API}/me`, ({ request }) => {
        const auth = request.headers.get('Authorization');
        seen.push(auth);
        return auth === 'Bearer nuevo'
          ? HttpResponse.json({ ok: true })
          : HttpResponse.json({ code: 'TOKEN_EXPIRED' }, { status: 401 });
      }),
      http.post(`${API}/auth/refresh`, () =>
        HttpResponse.json({ access_token: 'nuevo', token_type: 'Bearer', expires_in: 900 }),
      ),
    );
    const res = await request<{ ok: boolean }>('/me');
    expect(res.data.ok).toBe(true);
    expect(seen).toEqual(['Bearer vencido', 'Bearer nuevo']);
  });

  it('dos peticiones con token vencido comparten una sola renovación', async () => {
    setAccessToken('vencido');
    let refreshes = 0;
    server.use(
      http.get(`${API}/me`, ({ request }) =>
        request.headers.get('Authorization') === 'Bearer nuevo'
          ? HttpResponse.json({})
          : HttpResponse.json({ code: 'TOKEN_EXPIRED' }, { status: 401 }),
      ),
      http.get(`${API}/accounts`, ({ request }) =>
        request.headers.get('Authorization') === 'Bearer nuevo'
          ? HttpResponse.json({ data: [] })
          : HttpResponse.json({ code: 'TOKEN_EXPIRED' }, { status: 401 }),
      ),
      http.post(`${API}/auth/refresh`, async () => {
        refreshes += 1;
        await new Promise((r) => setTimeout(r, 10));
        return HttpResponse.json({ access_token: 'nuevo', token_type: 'Bearer', expires_in: 900 });
      }),
    );
    await Promise.all([request('/me'), request('/accounts')]);
    expect(refreshes).toBe(1);
  });

  it('si la renovación falla, borra el token en memoria', async () => {
    setAccessToken('algo');
    server.use(
      http.post(`${API}/auth/refresh`, () =>
        HttpResponse.json({ code: 'REFRESH_TOKEN_REUSED' }, { status: 401 }),
      ),
    );
    await expect(refreshAccessToken()).rejects.toMatchObject({ code: 'REFRESH_TOKEN_REUSED' });
    expect(getAccessToken()).toBeNull();
  });
});
