import type { ReactElement, ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { API_URL } from '../config';
// Mismas instancias que jest.setup.ts registra como mocks de los módulos nativos.
import * as mockNetInfo from './mocks/netinfo';
import * as mockSecureStore from './mocks/secureStore';

export { API_URL };

type Handler = (req: {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}) => Response | Promise<Response>;

export interface Route {
  method: string;
  path: string | RegExp;
  handler: Handler;
}

export const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': status >= 400 ? 'application/problem+json' : 'application/json',
      ...headers,
    },
  });

export const networkError = () => {
  throw new TypeError('Network request failed');
};

/** Reemplaza fetch global por un enrutador mínimo; registra cada petición. */
export function mockFetch(routes: Route[]) {
  const calls: Array<{
    method: string;
    url: string;
    headers: Record<string, string>;
    body: unknown;
  }> = [];
  const fetchMock = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const headers = { ...(init?.headers as Record<string, string> | undefined) };
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    const path = url.replace(API_URL, '').split('?')[0] ?? '';
    calls.push({ method, url, headers, body });
    const route = routes.find(
      (r) =>
        r.method === method && (typeof r.path === 'string' ? r.path === path : r.path.test(path)),
    );
    if (!route) throw new Error(`Sin mock para ${method} ${path}`);
    return route.handler({ url, method, headers, body });
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  return { calls, fetchMock };
}

export function newQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } },
  });
}

export function renderWithProviders(ui: ReactElement, client = newQueryClient()) {
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 390, height: 844 },
        insets: { top: 0, left: 0, right: 0, bottom: 0 },
      }}
    >
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </SafeAreaProvider>
  );
  return render(ui, { wrapper: Wrapper });
}

export function secureStore(): Map<string, string> {
  return mockSecureStore.__store;
}

export function setConnected(v: boolean | null) {
  mockNetInfo.__setConnected(v);
}

export const tokens = (n = 1) => ({
  access_token: `access-${n}`,
  refresh_token: `refresh-${n}`,
  token_type: 'Bearer',
  expires_in: 900,
});
