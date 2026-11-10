import { QueryClient } from '@tanstack/react-query';
import { ApiError } from '../api/errors';

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 15_000,
        refetchOnWindowFocus: false,
        // No reintentar errores 4xx (permisos, validación, no encontrado).
        retry: (count, error) => !(error instanceof ApiError && error.status < 500) && count < 2,
      },
      // Las mutaciones (transferencias) nunca se reintentan solas: el usuario decide.
      mutations: { retry: false },
    },
  });
}
