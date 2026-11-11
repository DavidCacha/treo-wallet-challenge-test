import { render } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { buildRoutes, Providers, routerFuture } from '../App';
import { createQueryClient } from '../lib/queryClient';

/** Monta la app completa (rutas reales) en una ruta inicial. */
export function renderApp(initialPath = '/') {
  const client = createQueryClient();
  client.setDefaultOptions({
    queries: { ...client.getDefaultOptions().queries, retry: false, staleTime: 0 },
    mutations: { retry: false },
  });
  const router = createMemoryRouter(buildRoutes(), {
    initialEntries: [initialPath],
    future: routerFuture,
  });
  const utils = render(
    <Providers client={client}>
      <RouterProvider router={router} future={{ v7_startTransition: true }} />
    </Providers>,
  );
  return { ...utils, router, client };
}
