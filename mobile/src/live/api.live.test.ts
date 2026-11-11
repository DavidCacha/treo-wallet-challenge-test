/**
 * Validación contra la API local real (no corre con `npm test`).
 *   1) API arriba con NODE_ENV=development y la base con seed.
 *   2) npm run test:live   (EXPO_PUBLIC_API_URL, por defecto http://localhost:3000/api/v1)
 * Usa el mismo cliente, sesión y máquina de envío que la app; solo SecureStore y
 * NetInfo están simulados (no existen en Node).
 */
import * as api from '../api/endpoints';
import { NetworkError } from '../api/errors';
import { __resetSessionForTests, refreshAccessToken } from '../api/session';
import { KEYS } from '../api/secureStorage';
import type { Account, Beneficiary, Transfer } from '../api/types';
import { TransferMachine } from '../transfer/machine';
import type { MachineDeps } from '../transfer/machine';
import type { PendingStore, PendingTransfer } from '../transfer/pendingStore';
import { secureStore } from '../test/helpers';

jest.setTimeout(30_000);

function memoryStore(): PendingStore & { value: () => PendingTransfer | null } {
  let value: PendingTransfer | null = null;
  return {
    load: async () => value,
    save: async (p) => {
      value = p;
    },
    clear: async () => {
      value = null;
    },
    value: () => value,
  };
}

let principal: Account;
let ahorro: Account;
let beto: Beneficiary;
let userId: string;
let counter = 0;

/** Llave UUID v4 única por intento (en Node no hay expo-crypto real). */
const newKey = () => {
  counter += 1;
  return crypto.randomUUID();
};

function pending(source: Account, amount: number, concept: string): PendingTransfer {
  return {
    v: 1,
    userId,
    idempotencyKey: newKey(),
    payload: {
      source_account_id: source.id,
      beneficiary_id: beto.id,
      amount_cents: amount,
      concept,
      reference: String(1_000_000 + counter),
    },
    display: {
      sourceName: source.name,
      beneficiaryAlias: beto.alias,
      beneficiaryClabe: beto.clabe,
      requiresOtp: false,
    },
    createdAt: new Date().toISOString(),
  };
}

function machineWith(over: Partial<MachineDeps> = {}) {
  const store = memoryStore();
  const machine = new TransferMachine({
    createTransfer: api.createTransfer,
    getTransfer: api.getTransfer,
    confirmTransfer: api.confirmTransfer,
    store,
    sleep: async () => undefined,
    waitForNetwork: async () => undefined,
    isOnline: async () => true,
    ...over,
  });
  return { machine, store };
}

const balanceOf = async (id: string) =>
  (await api.getAccounts()).find((a) => a.id === id)!.available_balance_cents;

beforeAll(async () => {
  secureStore().clear();
  __resetSessionForTests();
  await api.login({ email: 'ana@treo.dev', password: 'Demo12345!' });
  const me = await api.getMe();
  userId = me.id;
  const accounts = await api.getAccounts();
  principal = accounts.find((a) => a.name === 'Principal')!;
  ahorro = accounts.find((a) => a.name === 'Ahorro')!;
  beto = (await api.getBeneficiaries()).find((b) => b.alias === 'Beto')!;
});

describe('API local real con el cliente móvil', () => {
  it('login móvil: el refresh token queda en SecureStore y rota al renovar', async () => {
    const first = secureStore().get(KEYS.refreshToken);
    expect(first).toEqual(expect.any(String));
    await refreshAccessToken();
    const second = secureStore().get(KEYS.refreshToken);
    expect(second).toEqual(expect.any(String));
    expect(second).not.toBe(first);
  });

  it('saldos en centavos enteros y últimos 20 movimientos', async () => {
    expect(Number.isSafeInteger(principal.available_balance_cents)).toBe(true);
    const page = await api.getRecentMovements(principal.id);
    expect(page.data.length).toBeGreaterThan(0);
    expect(page.data.length).toBeLessThanOrEqual(20);
  });

  it('transferencia completada: el saldo baja exactamente el monto', async () => {
    const before = await balanceOf(principal.id);
    const { machine, store } = machineWith();
    await machine.start(pending(principal, 100, 'Prueba movil'));
    expect(machine.getState().kind).toBe('completed');
    expect(store.value()).toBeNull();
    expect(await balanceOf(principal.id)).toBe(before - 100);
  });

  it('respuesta perdida tras ejecutar: el reintento con la misma llave no duplica', async () => {
    const before = await balanceOf(principal.id);
    const keys: string[] = [];
    const replayed: Array<string | null> = [];
    let lose = true;
    const { machine } = machineWith({
      createTransfer: async (body, key) => {
        keys.push(key);
        const res = await api.createTransfer(body, key); // el servidor SÍ la ejecuta
        replayed.push(res.headers.get('Idempotent-Replayed'));
        if (lose) {
          lose = false;
          throw new NetworkError(new TypeError('respuesta perdida (simulada)'));
        }
        return res;
      },
    });
    await machine.start(pending(principal, 250, 'Reintento movil'));
    const state = machine.getState();
    expect(state.kind).toBe('completed');
    expect(keys).toHaveLength(2);
    expect(keys[1]).toBe(keys[0]);
    expect(replayed).toEqual([null, 'true']);
    expect(await balanceOf(principal.id)).toBe(before - 250);
  });

  it('saldo insuficiente: rechazada con INSUFFICIENT_FUNDS y el saldo no cambia', async () => {
    const before = await balanceOf(ahorro.id);
    const { machine } = machineWith();
    await machine.start(pending(ahorro, before + 100, 'Sin fondos'));
    expect(machine.getState()).toMatchObject({
      kind: 'rejected',
      code: 'INSUFFICIENT_FUNDS',
      message: 'Saldo insuficiente en la cuenta de origen.',
    });
    expect(await balanceOf(ahorro.id)).toBe(before);
  });

  it('monto mayor al umbral: pide OTP y se completa al confirmarlo', async () => {
    const before = await balanceOf(principal.id);
    const { machine } = machineWith();
    await machine.start(pending(principal, 1_000_001, 'Con codigo'));
    const s = machine.getState();
    expect(s.kind).toBe('otp');
    const t = (s as { transfer: Transfer }).transfer;
    const code = t.challenge?.dev_otp_code;
    expect(code).toMatch(/^\d{6}$/);
    await machine.confirmOtp(code!);
    expect(machine.getState().kind).toBe('completed');
    expect(await balanceOf(principal.id)).toBe(before - 1_000_001);
  });

  it('servidor inalcanzable: el cliente lo reporta como NetworkError (estado "sin conexión")', async () => {
    const prev = process.env.EXPO_PUBLIC_API_URL;
    process.env.EXPO_PUBLIC_API_URL = 'http://127.0.0.1:9/api/v1'; // puerto cerrado
    try {
      let client: typeof import('../api/client') | undefined;
      let errors: typeof import('../api/errors') | undefined;
      jest.isolateModules(() => {
        client = require('../api/client');
        errors = require('../api/errors');
      });
      const e = await client!.request('/health', { auth: false }).catch((err: unknown) => err);
      expect(e).toBeInstanceOf(errors!.NetworkError);
      expect(errors!.messageFor(e)).toBe(
        'No pudimos comunicarnos con el servidor. Revisa tu conexión.',
      );
    } finally {
      process.env.EXPO_PUBLIC_API_URL = prev;
    }
  });
});
