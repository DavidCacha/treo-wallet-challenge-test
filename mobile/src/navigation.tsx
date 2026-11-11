import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { BackHandler } from 'react-native';
import type { TransferDraft, TransferFormValues } from './transfer/draft';

/**
 * Navegación mínima por estado (pila). La app tiene pocas pantallas y un flujo
 * lineal; una librería de navegación agregaría dependencias nativas sin aportar
 * a los requisitos.
 */
export type Route =
  | { name: 'home' }
  | { name: 'transferForm'; values?: TransferFormValues }
  | { name: 'transferReview'; draft: TransferDraft }
  | { name: 'transferStatus'; values?: TransferFormValues };

interface Nav {
  route: Route;
  push: (r: Route) => void;
  replace: (r: Route) => void;
  back: () => void;
  /** Reemplaza toda la pila (una ruta o varias, la última queda visible). */
  reset: (r: Route | Route[]) => void;
  canGoBack: boolean;
}

const NavContext = createContext<Nav | null>(null);

export function NavigationProvider({ initial, children }: { initial: Route; children: ReactNode }) {
  const [stack, setStack] = useState<Route[]>([initial]);
  const push = useCallback((r: Route) => setStack((s) => [...s, r]), []);
  const replace = useCallback((r: Route) => setStack((s) => [...s.slice(0, -1), r]), []);
  const back = useCallback(() => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s)), []);
  const reset = useCallback((r: Route | Route[]) => setStack(Array.isArray(r) ? r : [r]), []);
  const route = stack[stack.length - 1] ?? initial;
  const canGoBack = stack.length > 1;

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!canGoBack) return false;
      back();
      return true;
    });
    return () => sub.remove();
  }, [canGoBack, back]);

  const value = useMemo(
    () => ({ route, push, replace, back, reset, canGoBack }),
    [route, push, replace, back, reset, canGoBack],
  );
  return <NavContext.Provider value={value}>{children}</NavContext.Provider>;
}

export function useNav(): Nav {
  const ctx = useContext(NavContext);
  if (!ctx) throw new Error('useNav fuera de NavigationProvider');
  return ctx;
}
