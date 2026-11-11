import { ApiError, NetworkError } from '../api/errors';
import type { Transfer } from '../api/types';
import { transfer } from '../test/fixtures';
import { BACKOFF_MS, TransferMachine } from './machine';
import type { MachineDeps, MachineState } from './machine';
import type { PendingStore, PendingTransfer } from './pendingStore';

const KEY = '00000000-0000-4000-8000-0000000000aa';

function pendingFixture(over: Partial<PendingTransfer> = {}): PendingTransfer {
  return {
    v: 1,
    userId: 'u1',
    idempotencyKey: KEY,
    payload: {
      source_account_id: 'aaaaaaaa-0000-4000-8000-000000000001',
      beneficiary_id: 'bbbbbbbb-0000-4000-8000-000000000001',
      amount_cents: 30_000,
      concept: 'Comida',
      reference: '1234567',
    },
    display: {
      sourceName: 'Principal',
      beneficiaryAlias: 'Beto',
      beneficiaryClabe: '646180000000000034',
      requiresOtp: false,
    },
    createdAt: '2026-11-11T00:00:00Z',
    ...over,
  };
}

function memoryStore() {
  let value: PendingTransfer | null = null;
  const store: PendingStore & { value: () => PendingTransfer | null } = {
    load: async () => value,
    save: async (p) => {
      value = p;
    },
    clear: async () => {
      value = null;
    },
    value: () => value,
  };
  return store;
}

const ok = (t: Transfer, status = 201) => ({ status, data: t, headers: new Headers() });
const net = () => new NetworkError(new TypeError('Network request failed'));
const problem = (status: number, code: string, extra: Record<string, unknown> = {}) =>
  new ApiError(status, {
    code,
    status,
    title: code,
    type: 'about:blank',
    request_id: 'r',
    ...extra,
  });

function setup(over: Partial<MachineDeps> = {}) {
  const store = memoryStore();
  const delays: number[] = [];
  const deps: MachineDeps = {
    createTransfer: jest.fn(),
    getTransfer: jest.fn(),
    confirmTransfer: jest.fn(),
    store,
    sleep: jest.fn(async (ms: number) => {
      delays.push(ms);
    }),
    waitForNetwork: jest.fn(async () => undefined),
    isOnline: jest.fn(async () => true),
    ...over,
  };
  const machine = new TransferMachine(deps);
  const states: MachineState['kind'][] = [];
  machine.subscribe((s) => states.push(s.kind));
  return { machine, deps, store, delays, states };
}

describe('máquina de envío móvil [§5.4, R4.17, EC-2]', () => {
  it('201 COMPLETED: muestra completada y borra la llave', async () => {
    const { machine, deps, store, states } = setup();
    (deps.createTransfer as jest.Mock).mockResolvedValue(ok(transfer()));
    await machine.start(pendingFixture());
    expect(states).toEqual(['sending', 'completed']);
    expect(store.value()).toBeNull();
  });

  it('persiste llave y cuerpo ANTES del primer envío', async () => {
    const { machine, deps, store } = setup();
    let storedAtSend: PendingTransfer | null = null;
    (deps.createTransfer as jest.Mock).mockImplementation(async () => {
      storedAtSend = store.value();
      return ok(transfer());
    });
    await machine.start(pendingFixture());
    expect(storedAtSend).toMatchObject({ idempotencyKey: KEY, payload: { amount_cents: 30_000 } });
  });

  it('tras un error de red el reintento usa la MISMA llave y el mismo cuerpo', async () => {
    const { machine, deps, states, delays } = setup();
    (deps.createTransfer as jest.Mock)
      .mockRejectedValueOnce(net())
      .mockResolvedValueOnce(ok(transfer()));
    await machine.start(pendingFixture());
    const calls = (deps.createTransfer as jest.Mock).mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual(calls[1]);
    expect(calls[1]?.[1]).toBe(KEY);
    expect(delays).toEqual([1000]);
    expect(states).toEqual(['sending', 'retrying', 'sending', 'completed']);
  });

  it('503 TRY_AGAIN también se reintenta con la misma llave', async () => {
    const { machine, deps } = setup();
    (deps.createTransfer as jest.Mock)
      .mockRejectedValueOnce(problem(503, 'TRY_AGAIN'))
      .mockResolvedValueOnce(ok(transfer()));
    await machine.start(pendingFixture());
    expect(machine.getState().kind).toBe('completed');
  });

  it('tras 4 reintentos fallidos (backoff 1s, 2s, 4s, 8s) queda en estado desconocido y conserva la llave', async () => {
    const { machine, deps, store, delays } = setup();
    (deps.createTransfer as jest.Mock).mockRejectedValue(net());
    await machine.start(pendingFixture());
    expect(delays).toEqual([...BACKOFF_MS]);
    expect(deps.createTransfer).toHaveBeenCalledTimes(1 + BACKOFF_MS.length);
    for (const call of (deps.createTransfer as jest.Mock).mock.calls) expect(call[1]).toBe(KEY);
    expect(machine.getState()).toEqual({ kind: 'unknown' });
    expect(store.value()?.idempotencyKey).toBe(KEY);
  });

  it('"Verificar de nuevo" reenvía con la misma llave y muestra el resultado real (replay)', async () => {
    const { machine, deps } = setup();
    (deps.createTransfer as jest.Mock).mockRejectedValue(net());
    await machine.start(pendingFixture());
    expect(machine.getState().kind).toBe('unknown');

    // El servidor sí la había completado: el replay devuelve la misma transferencia.
    (deps.createTransfer as jest.Mock).mockReset().mockResolvedValue(ok(transfer()));
    await machine.verifyAgain();
    expect((deps.createTransfer as jest.Mock).mock.calls[0]?.[1]).toBe(KEY);
    expect(machine.getState()).toMatchObject({
      kind: 'completed',
      transfer: { tracking_code: 'TRX20261111A1B2C3D4' },
    });
  });

  it('no permite iniciar otra transferencia mientras el intento anterior no se resuelva', async () => {
    const { machine, deps } = setup();
    (deps.createTransfer as jest.Mock).mockRejectedValue(net());
    await machine.start(pendingFixture());
    await machine.start(pendingFixture({ idempotencyKey: 'otra-llave' }));
    expect(machine.getPending()?.idempotencyKey).toBe(KEY);
  });

  it('doble toque: dos start() simultáneos producen un solo envío', async () => {
    const { machine, deps } = setup();
    (deps.createTransfer as jest.Mock).mockResolvedValue(ok(transfer()));
    await Promise.all([machine.start(pendingFixture()), machine.start(pendingFixture())]);
    expect(deps.createTransfer).toHaveBeenCalledTimes(1);
  });

  it('sin red espera a que vuelva la conexión antes de reintentar', async () => {
    let online = false;
    const { machine, deps, states } = setup({
      isOnline: jest.fn(async () => online),
      waitForNetwork: jest.fn(async () => {
        online = true;
      }),
    });
    (deps.createTransfer as jest.Mock)
      .mockRejectedValueOnce(net())
      .mockResolvedValueOnce(ok(transfer()));
    await machine.start(pendingFixture());
    expect(deps.waitForNetwork).toHaveBeenCalledTimes(1);
    expect(states).toEqual(['sending', 'retrying', 'retrying', 'sending', 'completed']);
  });

  it('422 INSUFFICIENT_FUNDS: rechazada con el mensaje del servidor y borra la llave', async () => {
    const { machine, deps, store } = setup();
    const rejected = transfer({ status: 'REJECTED', rejection_code: 'INSUFFICIENT_FUNDS' });
    (deps.createTransfer as jest.Mock).mockRejectedValue(
      problem(422, 'INSUFFICIENT_FUNDS', { transfer: rejected }),
    );
    await machine.start(pendingFixture());
    expect(machine.getState()).toMatchObject({
      kind: 'rejected',
      code: 'INSUFFICIENT_FUNDS',
      message: 'Saldo insuficiente en la cuenta de origen.',
    });
    expect(deps.createTransfer).toHaveBeenCalledTimes(1);
    expect(store.value()).toBeNull();
  });

  it('401 (sesión perdida) no borra la llave: se retoma al volver a entrar', async () => {
    const onSessionLost = jest.fn();
    const { machine, deps, store } = setup({ onSessionLost });
    (deps.createTransfer as jest.Mock).mockRejectedValue(problem(401, 'UNAUTHORIZED'));
    await machine.start(pendingFixture());
    expect(onSessionLost).toHaveBeenCalled();
    expect(store.value()?.idempotencyKey).toBe(KEY);
  });

  describe('OTP [R6.3]', () => {
    const pendingOtp = transfer({
      status: 'PENDING_OTP',
      completed_at: null,
      challenge: { id: 'ch1', expires_at: '2026-11-11T18:05:00Z', attempts_remaining: 3 },
    } as Partial<Transfer>);

    it('202 PENDING_OTP guarda el id; código correcto completa y borra la llave', async () => {
      const { machine, deps, store } = setup();
      (deps.createTransfer as jest.Mock).mockResolvedValue(ok(pendingOtp, 202));
      await machine.start(pendingFixture());
      expect(machine.getState().kind).toBe('otp');
      expect(store.value()?.transferId).toBe(pendingOtp.id);

      (deps.confirmTransfer as jest.Mock).mockResolvedValue(transfer());
      await machine.confirmOtp('123456');
      expect(machine.getState().kind).toBe('completed');
      expect(store.value()).toBeNull();
    });

    it('código incorrecto: sigue en OTP con los intentos restantes', async () => {
      const { machine, deps } = setup();
      (deps.createTransfer as jest.Mock).mockResolvedValue(ok(pendingOtp, 202));
      await machine.start(pendingFixture());
      (deps.confirmTransfer as jest.Mock).mockRejectedValue(
        problem(422, 'OTP_INVALID', { attempts_remaining: 2 }),
      );
      await machine.confirmOtp('000000');
      expect(machine.getState()).toMatchObject({
        kind: 'otp',
        attemptsRemaining: 2,
        error: 'El código no es correcto. Te quedan 2 intentos.',
      });
    });

    it('sin red al confirmar consulta GET /transfers/{id} (no reenvía el código)', async () => {
      const { machine, deps } = setup();
      (deps.createTransfer as jest.Mock).mockResolvedValue(ok(pendingOtp, 202));
      await machine.start(pendingFixture());
      (deps.confirmTransfer as jest.Mock).mockRejectedValue(net());
      (deps.getTransfer as jest.Mock).mockRejectedValueOnce(net()).mockResolvedValue(transfer());
      await machine.confirmOtp('123456');
      expect(deps.confirmTransfer).toHaveBeenCalledTimes(1);
      expect(deps.getTransfer).toHaveBeenCalledWith(pendingOtp.id);
      expect(machine.getState().kind).toBe('completed');
    });

    it('OTP_EXPIRED: expirada y borra la llave', async () => {
      const { machine, deps, store } = setup();
      (deps.createTransfer as jest.Mock).mockResolvedValue(ok(pendingOtp, 202));
      await machine.start(pendingFixture());
      (deps.confirmTransfer as jest.Mock).mockRejectedValue(problem(422, 'OTP_EXPIRED'));
      await machine.confirmOtp('123456');
      expect(machine.getState().kind).toBe('expired');
      expect(store.value()).toBeNull();
    });

    it('al retomar un intento con id conocido consulta el estado real con GET', async () => {
      const { machine, deps } = setup();
      (deps.getTransfer as jest.Mock).mockResolvedValue(pendingOtp);
      await machine.resume(pendingFixture({ transferId: pendingOtp.id }));
      expect(deps.createTransfer).not.toHaveBeenCalled();
      expect(machine.getState().kind).toBe('otp');
    });
  });
});
