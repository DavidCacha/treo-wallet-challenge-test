import { API_URL } from '../config';
import { ApiError, NetworkError } from './errors';
import { deleteSecure, KEYS, readSecure, writeSecure } from './secureStorage';
import type { TokenResponse } from './types';

/**
 * Sesión móvil (R1.11): el access token vive solo en memoria; el refresh token
 * (rotativo) se guarda en expo-secure-store y se envía en el cuerpo de
 * /auth/refresh con X-Client-Platform: mobile.
 */
let accessToken: string | null = null;
let refreshInFlight: Promise<string> | null = null;
const listeners = new Set<(signedIn: boolean) => void>();

export const MOBILE = { 'X-Client-Platform': 'mobile' } as const;

export function getAccessToken(): string | null {
  return accessToken;
}

function notify(signedIn: boolean) {
  for (const l of listeners) l(signedIn);
}

/** Avisa cuando la sesión se pierde (refresh rechazado) o se inicia. */
export function onSessionChange(listener: (signedIn: boolean) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Guarda un par de tokens recién emitido por /auth/login o /auth/refresh. */
export async function saveTokens(body: TokenResponse): Promise<void> {
  if (!body.refresh_token) throw new Error('La API no devolvió refresh_token para móvil');
  await writeSecure(KEYS.refreshToken, body.refresh_token);
  accessToken = body.access_token;
  notify(true);
}

export async function clearSession(): Promise<void> {
  accessToken = null;
  refreshInFlight = null;
  await deleteSecure(KEYS.refreshToken);
  notify(false);
}

export function hasStoredSession(): Promise<boolean> {
  return readSecure(KEYS.refreshToken).then((t) => t !== null);
}

/**
 * Renueva el access token. *Single-flight*: el refresh token rota en cada uso y
 * presentar el mismo dos veces revoca la familia completa (R1.8).
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
  const refreshToken = await readSecure(KEYS.refreshToken);
  if (!refreshToken) {
    throw new ApiError(401, undefined);
  }
  let res: Response;
  try {
    res = await fetch(`${API_URL}/auth/refresh`, {
      method: 'POST',
      headers: { ...MOBILE, Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
  } catch (e) {
    // Sin red no sabemos si el token sigue vigente: se conserva para reintentar.
    throw new NetworkError(e);
  }
  if (!res.ok) {
    const problem = await res.json().catch(() => undefined);
    if (res.status === 401) await clearSession();
    throw new ApiError(res.status, problem);
  }
  const body = (await res.json()) as TokenResponse;
  await saveTokens(body);
  return body.access_token;
}

/** Solo para pruebas. */
export function __resetSessionForTests(): void {
  accessToken = null;
  refreshInFlight = null;
  listeners.clear();
}
