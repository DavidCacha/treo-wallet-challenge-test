import * as SecureStore from 'expo-secure-store';
import { request } from './client';
import { login, logout } from './endpoints';
import { __resetSessionForTests, getAccessToken, refreshAccessToken } from './session';
import { KEYS } from './secureStorage';
import { json, mockFetch, secureStore, tokens } from '../test/helpers';

beforeEach(() => {
  secureStore().clear();
  __resetSessionForTests();
  jest.clearAllMocks();
});

describe('sesión móvil [R1.11]', () => {
  it('login envía X-Client-Platform: mobile y guarda el refresh token SOLO en SecureStore', async () => {
    const { calls } = mockFetch([
      { method: 'POST', path: '/auth/login', handler: () => json(tokens(1)) },
    ]);
    await login({ email: 'ana@treo.dev', password: 'Demo12345!' });

    expect(calls[0]?.headers['X-Client-Platform']).toBe('mobile');
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
      KEYS.refreshToken,
      'refresh-1',
      expect.objectContaining({ keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }),
    );
    expect(secureStore().get(KEYS.refreshToken)).toBe('refresh-1');
    // El access token no se persiste: vive en memoria.
    expect([...secureStore().values()]).not.toContain('access-1');
    expect(getAccessToken()).toBe('access-1');
  });

  it('renueva enviando el refresh token en el cuerpo y guarda el token rotado', async () => {
    secureStore().set(KEYS.refreshToken, 'refresh-1');
    const { calls } = mockFetch([
      { method: 'POST', path: '/auth/refresh', handler: () => json(tokens(2)) },
    ]);
    await expect(refreshAccessToken()).resolves.toBe('access-2');
    expect(calls[0]?.body).toEqual({ refresh_token: 'refresh-1' });
    expect(calls[0]?.headers['X-Client-Platform']).toBe('mobile');
    expect(secureStore().get(KEYS.refreshToken)).toBe('refresh-2');
  });

  it('single-flight: renovaciones simultáneas hacen una sola petición', async () => {
    secureStore().set(KEYS.refreshToken, 'refresh-1');
    const { calls } = mockFetch([
      {
        method: 'POST',
        path: '/auth/refresh',
        handler: async () => {
          await new Promise((r) => setTimeout(r, 10));
          return json(tokens(2));
        },
      },
    ]);
    await Promise.all([refreshAccessToken(), refreshAccessToken(), refreshAccessToken()]);
    expect(calls).toHaveLength(1);
  });

  it('ante un 401 renueva una vez y repite la petición con el token nuevo', async () => {
    const seen: string[] = [];
    mockFetch([
      { method: 'POST', path: '/auth/login', handler: () => json(tokens(1)) },
      { method: 'POST', path: '/auth/refresh', handler: () => json(tokens(2)) },
      {
        method: 'GET',
        path: '/me',
        handler: ({ headers }) => {
          seen.push(headers.Authorization ?? '');
          return seen.length === 1 ? json({ code: 'TOKEN_EXPIRED' }, 401) : json({ ok: true });
        },
      },
    ]);
    await login({ email: 'ana@treo.dev', password: 'Demo12345!' });
    const res = await request<{ ok: boolean }>('/me');
    expect(res.data.ok).toBe(true);
    expect(seen).toEqual(['Bearer access-1', 'Bearer access-2']);
  });

  it('si la API rechaza el refresh token, borra la sesión guardada', async () => {
    secureStore().set(KEYS.refreshToken, 'refresh-1');
    mockFetch([
      {
        method: 'POST',
        path: '/auth/refresh',
        handler: () => json({ code: 'REFRESH_TOKEN_REUSED' }, 401),
      },
    ]);
    await expect(refreshAccessToken()).rejects.toMatchObject({ code: 'REFRESH_TOKEN_REUSED' });
    expect(secureStore().has(KEYS.refreshToken)).toBe(false);
    expect(getAccessToken()).toBeNull();
  });

  it('sin red conserva el refresh token para reintentar después', async () => {
    secureStore().set(KEYS.refreshToken, 'refresh-1');
    mockFetch([
      {
        method: 'POST',
        path: '/auth/refresh',
        handler: () => {
          throw new TypeError('Network request failed');
        },
      },
    ]);
    await expect(refreshAccessToken()).rejects.toMatchObject({ name: 'NetworkError' });
    expect(secureStore().get(KEYS.refreshToken)).toBe('refresh-1');
  });

  it('logout revoca en la API con el refresh token y borra SecureStore', async () => {
    secureStore().set(KEYS.refreshToken, 'refresh-1');
    const { calls } = mockFetch([
      { method: 'POST', path: '/auth/logout', handler: () => new Response(null, { status: 204 }) },
    ]);
    await logout();
    expect(calls[0]?.body).toEqual({ refresh_token: 'refresh-1' });
    expect(secureStore().has(KEYS.refreshToken)).toBe(false);
  });
});
