import { API_URL, REQUEST_TIMEOUT_MS } from '../config';
import { ApiError, NetworkError } from './errors';
import { getAccessToken, MOBILE, refreshAccessToken } from './session';

export interface RequestOptions {
  method?: 'GET' | 'POST';
  body?: unknown;
  headers?: Record<string, string>;
  query?: Record<string, string | number | undefined>;
  /** false para login: no adjunta token ni intenta renovar. */
  auth?: boolean;
  timeoutMs?: number;
}

export interface ApiResponse<T> {
  status: number;
  data: T;
  headers: Headers;
}

function buildUrl(path: string, query?: RequestOptions['query']): string {
  const params = Object.entries(query ?? {})
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  return `${API_URL}${path}${params.length ? `?${params.join('&')}` : ''}`;
}

async function send(path: string, opts: RequestOptions, token: string | null): Promise<Response> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...MOBILE,
    ...opts.headers,
  };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? REQUEST_TIMEOUT_MS);
  try {
    return await fetch(buildUrl(path, opts.query), {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: controller.signal,
    });
  } catch (e) {
    // Sin red o sin respuesta a tiempo: no sabemos qué hizo el servidor.
    throw new NetworkError(e);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Cliente HTTP tipado. Con `auth` (por defecto) adjunta el access token; si la
 * API responde 401, renueva una sola vez y repite la petición. Repetir es
 * seguro: las transferencias llevan la misma Idempotency-Key.
 */
export async function request<T>(path: string, opts: RequestOptions = {}): Promise<ApiResponse<T>> {
  const useAuth = opts.auth !== false;
  let token = useAuth ? getAccessToken() : null;
  if (useAuth && !token) token = await refreshAccessToken();

  let res = await send(path, opts, token);
  if (useAuth && res.status === 401) {
    token = await refreshAccessToken();
    res = await send(path, opts, token);
  }

  const isJson = (res.headers.get('Content-Type') ?? '').includes('json');
  let payload: unknown;
  if (res.status !== 204 && isJson) {
    try {
      payload = await res.json();
    } catch (e) {
      // Cuerpo cortado a mitad: equivale a no haber recibido respuesta.
      throw new NetworkError(e);
    }
  }
  if (!res.ok) {
    throw new ApiError(res.status, payload as ApiError['problem'], res.headers.get('Retry-After'));
  }
  return { status: res.status, data: payload as T, headers: res.headers };
}
