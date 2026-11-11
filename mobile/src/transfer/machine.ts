import type { ApiResponse } from '../api/client';
import { ApiError, messageFor, messageForCode, NetworkError } from '../api/errors';
import type { CreateTransferRequest, Transfer } from '../api/types';
import type { PendingStore, PendingTransfer } from './pendingStore';

/**
 * Máquina de envío de transferencias en móvil (design.md §5.4, R4.17, EC-2).
 *
 * Reglas:
 * - La Idempotency-Key se genera una sola vez por intento y se persiste con el
 *   cuerpo antes del primer envío; todo reintento usa la MISMA llave y cuerpo.
 * - Sin respuesta (sin red, timeout) o 5xx: se reintenta con backoff 1s, 2s, 4s
 *   y 8s, esperando a que haya red. Si los 4 reintentos fallan, el estado queda
 *   "desconocido" y solo se sale con "Verificar de nuevo" (misma llave).
 * - Nunca se muestra éxito o fallo sin una respuesta del servidor.
 * - La llave se borra solo con un resultado definitivo (completada, rechazada,
 *   expirada).
 */
export const BACKOFF_MS = [1000, 2000, 4000, 8000] as const;

export type MachineState =
  | { kind: 'idle' }
  | { kind: 'sending' }
  | { kind: 'retrying'; retry: number; delayMs: number; waitingForNetwork: boolean }
  | { kind: 'unknown' }
  | { kind: 'otp'; transfer: Transfer; error?: string; attemptsRemaining?: number }
  | { kind: 'confirming'; transfer: Transfer }
  | { kind: 'completed'; transfer: Transfer }
  | { kind: 'rejected'; code: string; message: string; transfer?: Transfer }
  | { kind: 'expired'; message: string; transfer?: Transfer };

export interface MachineDeps {
  createTransfer: (body: CreateTransferRequest, key: string) => Promise<ApiResponse<Transfer>>;
  getTransfer: (id: string) => Promise<Transfer>;
  confirmTransfer: (id: string, code: string) => Promise<Transfer>;
  store: PendingStore;
  sleep: (ms: number) => Promise<void>;
  /** Resuelve cuando hay red. */
  waitForNetwork: () => Promise<void>;
  isOnline: () => Promise<boolean>;
  /** La sesión expiró (401 tras intentar renovar): el intento se conserva. */
  onSessionLost?: () => void;
  onCompleted?: (t: Transfer) => void;
}

/** Sin respuesta o error del servidor: no sabemos si se ejecutó. */
export function isRecoverable(e: unknown): boolean {
  return e instanceof NetworkError || (e instanceof ApiError && e.status >= 500);
}

class Cancelled extends Error {}

export class TransferMachine {
  private state: MachineState = { kind: 'idle' };
  private pending: PendingTransfer | null = null;
  private running = false;
  private generation = 0;
  private readonly listeners = new Set<(s: MachineState) => void>();

  constructor(private readonly deps: MachineDeps) {}

  getState(): MachineState {
    return this.state;
  }

  getPending(): PendingTransfer | null {
    return this.pending;
  }

  /** true mientras hay una operación en curso (envío, reintentos o confirmación). */
  isBusy(): boolean {
    return this.running;
  }

  subscribe(listener: (s: MachineState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private set(state: MachineState) {
    this.state = state;
    for (const l of [...this.listeners]) l(state);
  }

  /**
   * Inicia un intento nuevo: persiste llave + cuerpo y envía. Ignora la llamada
   * si ya hay un intento sin resolver (evita doble envío por doble toque).
   * `onPersisted` se llama cuando el intento ya quedó guardado, antes de enviar.
   */
  async start(pending: PendingTransfer, onPersisted?: () => void): Promise<void> {
    if (this.running || this.pending) return;
    this.running = true; // guardia síncrona antes de cualquier await
    try {
      await this.deps.store.save(pending);
      this.pending = pending;
    } catch (e) {
      this.running = false;
      throw e;
    }
    onPersisted?.();
    await this.run(() => this.sendLoop());
  }

  /** Retoma un intento persistido (al abrir la app o tras iniciar sesión). */
  async resume(pending: PendingTransfer): Promise<void> {
    if (this.running) return;
    this.pending = pending;
    this.running = true;
    await this.run(() => this.verify());
  }

  /** "Verificar de nuevo": consulta el estado real con la misma llave. */
  async verifyAgain(): Promise<void> {
    if (this.running || !this.pending) return;
    this.running = true;
    await this.run(() => this.verify());
  }

  async confirmOtp(code: string): Promise<void> {
    const s = this.state;
    if (this.running || s.kind !== 'otp') return;
    this.running = true;
    await this.run(async () => {
      this.set({ kind: 'confirming', transfer: s.transfer });
      try {
        const t = await this.deps.confirmTransfer(s.transfer.id, code);
        await this.settle(t);
      } catch (e) {
        if (e instanceof ApiError && e.code === 'OTP_INVALID') {
          const left = e.problem?.attempts_remaining;
          this.set({
            kind: 'otp',
            transfer: s.transfer,
            attemptsRemaining: typeof left === 'number' ? left : undefined,
            error:
              typeof left === 'number'
                ? `El código no es correcto. Te ${left === 1 ? 'queda 1 intento' : `quedan ${left} intentos`}.`
                : messageFor(e),
          });
        } else if (e instanceof ApiError && e.code === 'TRANSFER_NOT_PENDING') {
          await this.pollTransfer(s.transfer.id);
        } else if (isRecoverable(e)) {
          // No sabemos si el código llegó: se consulta el estado real (no se
          // reenvía el código para no gastar intentos).
          await this.pollTransfer(s.transfer.id, true);
        } else if (
          e instanceof ApiError &&
          (e.status === 401 || e.code === 'OTP_EXPIRED' || e.problem?.transfer)
        ) {
          await this.fail(e);
        } else {
          // Cualquier otro error no cambia la transferencia: sigue pendiente de código.
          this.set({ kind: 'otp', transfer: s.transfer, error: messageFor(e) });
        }
      }
    });
  }

  /** Detiene reintentos en curso (p. ej. al cerrar sesión); el intento sigue guardado. */
  stop(): void {
    this.generation += 1;
    this.running = false;
  }

  /** Vuelve a reposo tras un resultado definitivo. */
  reset(): void {
    if (this.running || this.pending) return;
    this.set({ kind: 'idle' });
  }

  // --- internos -------------------------------------------------------------

  private async run(task: () => Promise<void>): Promise<void> {
    const gen = this.generation;
    try {
      await task();
    } catch (e) {
      if (!(e instanceof Cancelled)) throw e;
    } finally {
      if (gen === this.generation) this.running = false;
    }
  }

  private assertAlive(gen: number) {
    if (gen !== this.generation) throw new Cancelled();
  }

  private verify(): Promise<void> {
    const id = this.pending?.transferId;
    // Con id conocido se consulta GET; si no, se reenvía el POST con la misma
    // llave: el servidor responde el estado actual sin ejecutar de nuevo.
    return id ? this.pollTransfer(id) : this.sendLoop();
  }

  private sendLoop(): Promise<void> {
    const p = this.pending;
    if (!p) return Promise.resolve();
    return this.withRetry(
      async () => {
        const res = await this.deps.createTransfer(p.payload, p.idempotencyKey);
        await this.settle(res.data);
      },
      (e) => this.fail(e),
    );
  }

  private pollTransfer(id: string, afterOtpUncertainty = false): Promise<void> {
    return this.withRetry(
      async () => {
        const t = await this.deps.getTransfer(id);
        await this.settle(
          t,
          afterOtpUncertainty
            ? 'No pudimos confirmar si el código llegó. Escríbelo de nuevo.'
            : undefined,
        );
      },
      (e) => this.fail(e),
    );
  }

  /** Ejecuta `op`; ante errores recuperables reintenta con backoff y espera de red. */
  private async withRetry(
    op: () => Promise<void>,
    onFatal: (e: unknown) => Promise<void>,
  ): Promise<void> {
    const gen = this.generation;
    for (let retries = 0; ; ) {
      this.assertAlive(gen);
      if (retries === 0) this.set({ kind: 'sending' });
      try {
        await op();
        return;
      } catch (e) {
        this.assertAlive(gen);
        if (!isRecoverable(e)) {
          await onFatal(e);
          return;
        }
        const delayMs = BACKOFF_MS[retries];
        if (delayMs === undefined) {
          this.set({ kind: 'unknown' });
          return;
        }
        retries += 1;
        this.set({ kind: 'retrying', retry: retries, delayMs, waitingForNetwork: false });
        await this.deps.sleep(delayMs);
        this.assertAlive(gen);
        if (!(await this.deps.isOnline())) {
          this.set({ kind: 'retrying', retry: retries, delayMs, waitingForNetwork: true });
          await this.deps.waitForNetwork();
          this.assertAlive(gen);
        }
        this.set({ kind: 'sending' });
      }
    }
  }

  /** Aplica una transferencia devuelta por el servidor. */
  private async settle(t: Transfer, otpNotice?: string): Promise<void> {
    switch (t.status) {
      case 'COMPLETED':
        await this.finish();
        this.deps.onCompleted?.(t);
        this.set({ kind: 'completed', transfer: t });
        return;
      case 'PENDING_OTP':
        if (this.pending && this.pending.transferId !== t.id) {
          this.pending = { ...this.pending, transferId: t.id };
          await this.deps.store.save(this.pending);
        }
        this.set({
          kind: 'otp',
          transfer: t,
          attemptsRemaining: t.challenge?.attempts_remaining,
          error: otpNotice,
        });
        return;
      case 'REJECTED':
        await this.finish();
        this.set({
          kind: 'rejected',
          code: t.rejection_code ?? 'REJECTED',
          message: messageForCode(t.rejection_code),
          transfer: t,
        });
        return;
      case 'EXPIRED':
        await this.finish();
        this.set({
          kind: 'expired',
          message: 'El código expiró o se agotaron los intentos. La transferencia no se realizó.',
          transfer: t,
        });
        return;
    }
  }

  /** Respuesta definitiva de error del servidor. */
  private async fail(e: unknown): Promise<void> {
    if (e instanceof ApiError && e.status === 401) {
      // Sesión perdida: NO se borra la llave; al volver a entrar se retoma.
      this.set({ kind: 'unknown' });
      this.deps.onSessionLost?.();
      return;
    }
    const transfer = e instanceof ApiError ? e.problem?.transfer : undefined;
    if (transfer) {
      await this.settle(transfer);
      return;
    }
    await this.finish();
    if (e instanceof ApiError && e.code === 'OTP_EXPIRED') {
      this.set({ kind: 'expired', message: messageFor(e) });
      return;
    }
    this.set({
      kind: 'rejected',
      code: e instanceof ApiError ? e.code : 'UNKNOWN',
      message: messageFor(e),
    });
  }

  private async finish(): Promise<void> {
    this.pending = null;
    await this.deps.store.clear();
  }
}
