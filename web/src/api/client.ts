import { ApiError, NetworkError } from './errors';
import { apiUrl } from './config';
import { getAccessToken, refreshAccessToken } from './session';

export interface RequestOptions {
  method?: 'GET' | 'POST';
  body?: unknown;
  headers?: Record<string, string>;
  query?: Record<string, string | number | undefined>;
  /** false para login/registro: no adjunta token ni intenta renovar. */
  auth?: boolean;
  signal?: AbortSignal;
}

export interface ApiResponse<T> {
  status: number;
  data: T;
  headers: Headers;
}

function buildUrl(path: string, query?: RequestOptions['query']): string {
  const url = new URL(apiUrl(path));
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v !== undefined && v !== '') url.searchParams.set(k, String(v));
  }
  return url.toString();
}

async function send(path: string, opts: RequestOptions, token: string | null): Promise<Response> {
  const headers: Record<string, string> = { Accept: 'application/json', ...opts.headers };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  try {
    return await fetch(buildUrl(path, opts.query), {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      credentials: 'include',
      signal: opts.signal,
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e;
    throw new NetworkError(e);
  }
}

/**
 * Cliente HTTP tipado. Con `auth` (por defecto) adjunta el access token; si la
 * API responde 401, renueva una sola vez (single-flight) y repite la petición.
 * Repetir es seguro: las transferencias llevan la misma Idempotency-Key.
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
  const payload: unknown = res.status === 204 || !isJson ? undefined : await res.json();
  if (!res.ok) {
    throw new ApiError(res.status, payload as ApiError['problem'], res.headers.get('Retry-After'));
  }
  return { status: res.status, data: payload as T, headers: res.headers };
}
