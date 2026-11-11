import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { LoginInput } from '@treo/shared';
import * as api from '../api/endpoints';
import { getAccessToken, onAccessTokenChange, refreshAccessToken } from '../api/session';
import { ATTEMPT_STORAGE_KEY } from '../transfer/TransferFlow';

type Status = 'checking' | 'authenticated' | 'anonymous';

interface AuthContextValue {
  status: Status;
  login: (input: LoginInput) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * Al cargar la página no hay access token (vive en memoria): se intenta
 * renovar con la cookie HttpOnly para mantener la sesión tras recargar.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<Status>(getAccessToken() ? 'authenticated' : 'checking');

  useEffect(() => {
    if (getAccessToken()) return;
    let cancelled = false;
    refreshAccessToken()
      .then(() => !cancelled && setStatus('authenticated'))
      .catch(() => !cancelled && setStatus('anonymous'));
    return () => {
      cancelled = true;
    };
  }, []);

  // Si una renovación falla más tarde (sesión revocada), se vuelve a "anónimo".
  useEffect(
    () =>
      onAccessTokenChange((token) => {
        setStatus((prev) => (token ? 'authenticated' : prev === 'checking' ? prev : 'anonymous'));
      }),
    [],
  );

  const login = useCallback(async (input: LoginInput) => {
    await api.login(input);
    setStatus('authenticated');
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      queryClient.clear();
      try {
        sessionStorage.removeItem(ATTEMPT_STORAGE_KEY);
      } catch {
        // sin almacenamiento disponible
      }
      setStatus('anonymous');
    }
  }, [queryClient]);

  const value = useMemo(() => ({ status, login, logout }), [status, login, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth debe usarse dentro de <AuthProvider>');
  return ctx;
}
