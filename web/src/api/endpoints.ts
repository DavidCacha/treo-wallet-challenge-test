import type { LoginInput, MovementType, RegisterInput } from '@treo/shared';
import { request } from './client';
import { setAccessToken } from './session';
import type {
  Account,
  Beneficiary,
  CreateBeneficiaryRequest,
  CreateTransferRequest,
  Me,
  MovementPage,
  TokenResponse,
  Transfer,
} from './types';

const WEB = { 'X-Client-Platform': 'web' };

export async function login(input: LoginInput): Promise<void> {
  const { data } = await request<TokenResponse>('/auth/login', {
    method: 'POST',
    body: input,
    headers: WEB,
    auth: false,
  });
  setAccessToken(data.access_token);
}

export async function register(input: RegisterInput): Promise<void> {
  await request('/auth/register', { method: 'POST', body: input, auth: false });
}

export async function logout(): Promise<void> {
  try {
    await request('/auth/logout', { method: 'POST', headers: WEB, auth: false });
  } finally {
    setAccessToken(null);
  }
}

export const getMe = () => request<Me>('/me').then((r) => r.data);

export const getAccounts = () => request<{ data: Account[] }>('/accounts').then((r) => r.data.data);

export interface MovementFilters {
  from?: string;
  to?: string;
  type?: MovementType;
}

export const getMovements = (
  accountId: string,
  filters: MovementFilters,
  cursor?: string,
  limit = 20,
) =>
  request<MovementPage>(`/accounts/${encodeURIComponent(accountId)}/movements`, {
    query: { ...filters, cursor, limit },
  }).then((r) => r.data);

export const getBeneficiaries = () =>
  request<{ data: Beneficiary[] }>('/beneficiaries').then((r) => r.data.data);

export const createBeneficiary = (input: CreateBeneficiaryRequest) =>
  request<Beneficiary>('/beneficiaries', { method: 'POST', body: input }).then((r) => r.data);

/** La llave la genera la pantalla de confirmación una sola vez por intento (R4.14). */
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
