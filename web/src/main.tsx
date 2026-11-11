import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { buildRoutes, Providers, routerFuture } from './App';
import { createQueryClient } from './lib/queryClient';
import './styles.css';

const router = createBrowserRouter(buildRoutes(), { future: routerFuture });
const client = createQueryClient();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Providers client={client}>
      <RouterProvider router={router} future={{ v7_startTransition: true }} />
    </Providers>
  </StrictMode>,
);
