import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import type { ReactNode } from 'react';
import NetInfo from '@react-native-community/netinfo';
import { randomUUID } from 'expo-crypto';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as api from '../api/endpoints';
import { qk } from '../api/queryKeys';
import { isOnline, waitForNetwork } from '../lib/network';
import type { TransferDraft } from './draft';
import { TransferMachine } from './machine';
import type { MachineDeps, MachineState } from './machine';
import { securePendingStore } from './pendingStore';
import type { PendingStore, PendingTransfer } from './pendingStore';

interface TransferValue {
  state: MachineState;
  /** Intento sin resultado definitivo (bloquea iniciar otra transferencia). */
  pending: PendingTransfer | null;
  /** false mientras se revisa si quedó un intento guardado de una sesión anterior. */
  ready: boolean;
  /** Guarda el intento (llave nueva) y lo envía; `onPersisted` corre antes del envío. */
  start: (draft: TransferDraft, onPersisted?: () => void) => Promise<void>;
  verifyAgain: () => Promise<void>;
  confirmOtp: (code: string) => Promise<void>;
  reset: () => void;
}

const TransferContext = createContext<TransferValue | null>(null);

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function TransferProvider({
  children,
  store = securePendingStore,
  deps: depsOverride,
}: {
  children: ReactNode;
  store?: PendingStore;
  deps?: Partial<MachineDeps>;
}) {
  const queryClient = useQueryClient();
  const me = useQuery({ queryKey: qk.me, queryFn: api.getMe });

  const machineRef = useRef<TransferMachine | null>(null);
  if (!machineRef.current) {
    machineRef.current = new TransferMachine({
      createTransfer: api.createTransfer,
      getTransfer: api.getTransfer,
      confirmTransfer: api.confirmTransfer,
      store,
      sleep,
      waitForNetwork,
      isOnline: async () => isOnline(await NetInfo.fetch()),
      onCompleted: () => {
        void Promise.all([
          queryClient.invalidateQueries({ queryKey: qk.accounts }),
          queryClient.invalidateQueries({ queryKey: qk.me }),
          queryClient.invalidateQueries({ queryKey: qk.movementsAll }),
        ]);
      },
      ...depsOverride,
    });
  }
  const machine = machineRef.current;
  const state = useSyncExternalStore(
    useCallback((cb) => machine.subscribe(cb), [machine]),
    () => machine.getState(),
  );
  const [ready, setReady] = useState(false);

  // Al entrar: si quedó un intento sin resolver, se consulta su estado real
  // antes de permitir otra operación (§5.4).
  const userId = me.data?.id;
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    (async () => {
      const saved = await store.load();
      if (cancelled) return;
      if (saved && saved.userId !== userId) {
        // Intento de otro usuario en este dispositivo: no se puede retomar.
        await store.clear();
      } else if (saved) {
        void machine.resume(saved);
      }
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, store, machine]);

  // Al volver la red con el estado desconocido, se verifica automáticamente.
  useEffect(() => {
    let wasOnline = true;
    return NetInfo.addEventListener((s) => {
      const online = isOnline(s);
      if (online && !wasOnline && machine.getState().kind === 'unknown') {
        void machine.verifyAgain();
      }
      wasOnline = online;
    });
  }, [machine]);

  // Al cerrar sesión se detienen los reintentos; el intento queda guardado.
  useEffect(() => () => machine.stop(), [machine]);

  const start = useCallback(
    async (draft: TransferDraft, onPersisted?: () => void) => {
      if (!userId) return;
      await machine.start(
        {
          v: 1,
          userId,
          idempotencyKey: randomUUID(),
          payload: draft.payload,
          display: draft.display,
          createdAt: new Date().toISOString(),
        },
        onPersisted,
      );
    },
    [machine, userId],
  );

  const value = useMemo<TransferValue>(
    () => ({
      state,
      pending: machine.getPending(),
      ready,
      start,
      verifyAgain: () => machine.verifyAgain(),
      confirmOtp: (code) => machine.confirmOtp(code),
      reset: () => machine.reset(),
    }),
    [state, machine, ready, start],
  );
  return <TransferContext.Provider value={value}>{children}</TransferContext.Provider>;
}

export function useTransfer(): TransferValue {
  const ctx = useContext(TransferContext);
  if (!ctx) throw new Error('useTransfer fuera de TransferProvider');
  return ctx;
}
