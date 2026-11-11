import { useEffect, useState } from 'react';
import NetInfo from '@react-native-community/netinfo';
import type { NetInfoState } from '@react-native-community/netinfo';
import { onlineManager } from '@tanstack/react-query';

/** `isConnected` puede ser null mientras NetInfo aún no sabe: se asume conectado. */
export function isOnline(state: Pick<NetInfoState, 'isConnected'>): boolean {
  return state.isConnected !== false;
}

export function useIsOnline(): boolean {
  const [online, setOnline] = useState(true);
  useEffect(() => NetInfo.addEventListener((s) => setOnline(isOnline(s))), []);
  return online;
}

/** Resuelve en cuanto haya red (inmediatamente si ya la hay). */
export async function waitForNetwork(): Promise<void> {
  if (isOnline(await NetInfo.fetch())) return;
  await new Promise<void>((resolve) => {
    const unsubscribe = NetInfo.addEventListener((s) => {
      if (isOnline(s)) {
        unsubscribe();
        resolve();
      }
    });
  });
}

/** React Query pausa consultas sin red y las reanuda al volver. */
export function connectQueryOnlineManager(): () => void {
  onlineManager.setEventListener((setOnline) =>
    NetInfo.addEventListener((s) => setOnline(isOnline(s))),
  );
  return () => onlineManager.setEventListener(() => undefined);
}
