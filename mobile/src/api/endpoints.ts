import type { LoginInput } from '@treo/shared';
import { request } from './client';
import { clearSession, saveTokens } from './session';
import { KEYS, readSecure } from './secureStorage';
import type {
  Account,
  Beneficiary,
  CreateTransferRequest,
  Me,
  MovementPage,
  TokenResponse,
  Transfer,
} from './types';

export async function login(input: LoginInput): Promise<void> {
  const { data } = await request<TokenResponse>('/auth/login', {
    method: 'POST',
    body: input,
    auth: false,
  });
  await saveTokens(data);
}

export async function logout(): Promise<void> {
  const refreshToken = await readSecure(KEYS.refreshToken);
  try {
    if (refreshToken) {
      await request('/auth/logout', {
        method: 'POST',
        body: { refresh_token: refreshToken },
        auth: false,
      });
    }
  } catch {
    // Si la API no responde, la sesión local se borra de todos modos.
  } finally {
    await clearSession();
  }
}

export const getMe = () => request<Me>('/me').then((r) => r.data);

export const getAccounts = () => request<{ data: Account[] }>('/accounts').then((r) => r.data.data);

/** R5.7: últimos 20 movimientos de la cuenta. */
export const getRecentMovements = (accountId: string, limit = 20) =>
  request<MovementPage>(`/accounts/${encodeURIComponent(accountId)}/movements`, {
    query: { limit },
  }).then((r) => r.data);

export const getBeneficiaries = () =>
  request<{ data: Beneficiary[] }>('/beneficiaries').then((r) => r.data.data);

/** La llave la genera la máquina de envío una sola vez por intento (R4.17). */
export const createTransfer = (input: CreateTransferRequest, idempotencyKey: string) =>
  request<Transfer>('/transfers', {
    method: 'POST',
    body: input,
    headers: { 'Idempotency-Key': idempotencyKey },
  });

export const getTransfer = (id: string) =>
  request<Transfer>(`/transfers/${encodeURIComponent(id)}`).then((r) => r.data);

export const confirmTransfer = (id: string, code: string) =>
  request<Transfer>(`/transfers/${encodeURIComponent(id)}/confirm`, {
    method: 'POST',
    body: { code },
  }).then((r) => r.data);
