import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { LoginInput } from '@treo/shared';
import * as api from '../api/endpoints';
import { ApiError } from '../api/errors';
import { hasStoredSession, onSessionChange, refreshAccessToken } from '../api/session';

type Status = 'restoring' | 'signedOut' | 'signedIn';

interface AuthValue {
  status: Status;
  login: (input: LoginInput) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<Status>('restoring');

  useEffect(() => {
    const unsubscribe = onSessionChange((signedIn) => {
      setStatus(signedIn ? 'signedIn' : 'signedOut');
      if (!signedIn) queryClient.clear();
    });
    let cancelled = false;
    (async () => {
      if (!(await hasStoredSession())) {
        if (!cancelled) setStatus('signedOut');
        return;
      }
      try {
        await refreshAccessToken();
      } catch (e) {
        // Sin red no se cierra la sesión: el refresh token sigue guardado y se
        // reintentará con la siguiente petición. Solo un rechazo de la API la termina.
        if (e instanceof ApiError && !cancelled) {
          setStatus('signedOut');
          return;
        }
      }
      if (!cancelled) setStatus('signedIn');
    })();
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [queryClient]);

  const login = useCallback((input: LoginInput) => api.login(input), []);
  const logout = useCallback(() => api.logout(), []);

  const value = useMemo(() => ({ status, login, logout }), [status, login, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth fuera de AuthProvider');
  return ctx;
}
