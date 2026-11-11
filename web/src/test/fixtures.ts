import type { Account, Beneficiary, Me, Movement, Transfer } from '../api/types';

export const API = 'http://localhost:5173/api/v1';

export const me: Me = {
  id: '6f1c3e5a-1111-4c1d-9a00-000000000001',
  email: 'ana@treo.dev',
  full_name: 'Ana Demo',
  created_at: '2026-11-01T12:00:00.000Z',
  daily_limit_cents: 5_000_000,
  used_today_cents: 125_000,
  otp_threshold_cents: 1_000_000,
  business_timezone: 'America/Mexico_City',
};

export const accounts: Account[] = [
  {
    id: 'a0000000-0000-4000-8000-000000000001',
    name: 'Principal',
    clabe: '999180000000000017',
    currency: 'MXN',
    available_balance_cents: 123_456,
    status: 'ACTIVE',
  },
  {
    id: 'a0000000-0000-4000-8000-000000000002',
    name: 'Ahorro',
    clabe: '999180000000000025',
    currency: 'MXN',
    available_balance_cents: 5_000_000,
    status: 'ACTIVE',
  },
];

export const beneficiaries: Beneficiary[] = [
  {
    id: 'b0000000-0000-4000-8000-000000000001',
    name: 'Beto Demo',
    alias: 'Beto',
    clabe: '999180000000000033',
    created_at: '2026-11-02T12:00:00.000Z',
  },
];

export function movement(i: number, overrides: Partial<Movement> = {}): Movement {
  return {
    id: String(1000 - i),
    type: 'TRANSFER_OUT',
    amount_cents: -1000 * (i + 1),
    balance_after_cents: 100_000 - 1000 * i,
    transfer_id: `c0000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    concept: `Pago ${i}`,
    reference: String(i),
    counterparty: { display_name: 'Beto', clabe_masked: '**************0033' },
    created_at: '2026-11-10T18:00:00.000Z',
    ...overrides,
  };
}

export function transfer(overrides: Partial<Transfer> = {}): Transfer {
  return {
    id: 'd0000000-0000-4000-8000-000000000001',
    status: 'COMPLETED',
    kind: 'P2P',
    amount_cents: 5000,
    source_account_id: accounts[0]!.id,
    destination: { display_name: 'Beto', clabe_masked: '**************0033' },
    concept: 'Comida',
    reference: '1',
    tracking_code: 'TRX20261110ABCDEF12',
    rejection_code: null,
    challenge: null,
    created_at: '2026-11-10T18:00:00.000Z',
    completed_at: '2026-11-10T18:00:00.000Z',
    ...overrides,
  };
}

export function problem(status: number, code: string, extra: Record<string, unknown> = {}) {
  return {
    type: `https://treo.example/problems/${code.toLowerCase().replace(/_/g, '-')}`,
    title: 'Error',
    status,
    code,
    request_id: 'req-test',
    ...extra,
  };
}
