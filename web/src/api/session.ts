import type { TokenResponse } from './types';
import { ApiError, NetworkError } from './errors';
import { apiUrl } from './config';

/**
 * Sesión web (R1.10): el access token vive SOLO en memoria de este módulo.
 * El refresh token es una cookie HttpOnly que el navegador envía a /api/v1/auth.
 */
let accessToken: string | null = null;
let refreshInFlight: Promise<string> | null = null;
const listeners = new Set<(token: string | null) => void>();

export function getAccessToken(): string | null {
  return accessToken;
}

export function setAccessToken(token: string | null): void {
  accessToken = token;
  for (const l of listeners) l(token);
}

export function onAccessTokenChange(listener: (token: string | null) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Renueva el access token con la cookie de refresh. *Single-flight*: si ya hay
 * una renovación en curso, todas las llamadas comparten la misma promesa. Dos
 * renovaciones simultáneas presentarían el mismo refresh token dos veces y la
 * API lo trataría como reutilización (revoca la familia, R1.8).
 */
export function refreshAccessToken(): Promise<string> {
  if (!refreshInFlight) {
    refreshInFlight = doRefresh().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

async function doRefresh(): Promise<string> {
  let res: Response;
  try {
    res = await fetch(apiUrl('/auth/refresh'), {
      method: 'POST',
      credentials: 'include',
      headers: { 'X-Client-Platform': 'web', Accept: 'application/json' },
    });
  } catch (e) {
    throw new NetworkError(e);
  }
  if (!res.ok) {
    setAccessToken(null);
    throw new ApiError(res.status, await res.json().catch(() => undefined));
  }
  const body = (await res.json()) as TokenResponse;
  setAccessToken(body.access_token);
  return body.access_token;
}
