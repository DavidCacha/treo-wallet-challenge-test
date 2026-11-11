type NetState = { isConnected: boolean | null };
type Listener = (s: NetState) => void;

const listeners = new Set<Listener>();
const state: NetState = { isConnected: true };

export default {
  fetch: jest.fn(async () => ({ ...state })),
  addEventListener: jest.fn((l: Listener) => {
    listeners.add(l);
    l({ ...state });
    return () => {
      listeners.delete(l);
    };
  }),
};

/** Cambia la conectividad simulada y avisa a los suscriptores. */
export function __setConnected(isConnected: boolean | null): void {
  state.isConnected = isConnected;
  for (const l of [...listeners]) l({ ...state });
}
