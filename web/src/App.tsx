import type { ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';
import type { RouteObject } from 'react-router-dom';
import { AuthProvider } from './auth/AuthProvider';
import { RedirectIfAuthenticated, RequireAuth } from './auth/RequireAuth';
import { Layout, PublicLayout } from './components/Layout';
import { privateRoutes, publicRoutes } from './routes';

/** Opciones de React Router v7 activadas desde ya (evita avisos de migración). */
export const routerFuture = {
  v7_relativeSplatPath: true,
  v7_fetcherPersist: true,
  v7_normalizeFormMethod: true,
  v7_partialHydration: true,
  v7_skipActionErrorRevalidation: true,
} as const;

/** Árbol de rutas: públicas (login/registro) y protegidas tras RequireAuth. */
export function buildRoutes(): RouteObject[] {
  return [
    {
      element: <PublicLayout />,
      children: [{ element: <RedirectIfAuthenticated />, children: publicRoutes }],
    },
    {
      element: <RequireAuth />,
      children: [{ element: <Layout />, children: privateRoutes }],
    },
  ];
}

export function Providers({ client, children }: { client: QueryClient; children: ReactNode }) {
  return (
    <QueryClientProvider client={client}>
      <AuthProvider>{children}</AuthProvider>
    </QueryClientProvider>
  );
}
