import type { Account, Beneficiary, Me, Movement, Transfer } from '../api/types';

export const me: Me = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'ana@treo.dev',
  full_name: 'Ana López',
  created_at: '2026-01-01T00:00:00Z',
  daily_limit_cents: 5_000_000,
  used_today_cents: 0,
  otp_threshold_cents: 1_000_000,
  business_timezone: 'America/Mexico_City',
};

export const accounts: Account[] = [
  {
    id: 'aaaaaaaa-0000-4000-8000-000000000001',
    name: 'Principal',
    clabe: '646180000000000018',
    currency: 'MXN',
    available_balance_cents: 9_324_951,
    status: 'ACTIVE',
  },
  {
    id: 'aaaaaaaa-0000-4000-8000-000000000002',
    name: 'Ahorro',
    clabe: '646180000000000021',
    currency: 'MXN',
    available_balance_cents: 500_000,
    status: 'ACTIVE',
  },
];

export const beneficiaries: Beneficiary[] = [
  {
    id: 'bbbbbbbb-0000-4000-8000-000000000001',
    name: 'Beto Ramírez',
    alias: 'Beto',
    clabe: '646180000000000034',
    created_at: '2026-01-01T00:00:00Z',
  },
];

export function movement(id: string, amount: number, who: string): Movement {
  return {
    id,
    type: amount < 0 ? 'TRANSFER_OUT' : 'TRANSFER_IN',
    amount_cents: amount,
    balance_after_cents: 9_324_951,
    transfer_id: 'cccccccc-0000-4000-8000-000000000001',
    concept: 'Comida',
    reference: '1234567',
    counterparty: { display_name: who, clabe_masked: '************0034' },
    created_at: '2026-11-10T18:00:00Z',
  };
}

export function transfer(over: Partial<Transfer> = {}): Transfer {
  return {
    id: 'dddddddd-0000-4000-8000-000000000001',
    status: 'COMPLETED',
    kind: 'P2P',
    amount_cents: 30_000,
    source_account_id: accounts[0]!.id,
    destination: { display_name: 'Beto', clabe_masked: '************0034' },
    concept: 'Comida',
    reference: '1234567',
    tracking_code: 'TRX20261111A1B2C3D4',
    created_at: '2026-11-11T18:00:00Z',
    completed_at: '2026-11-11T18:00:01Z',
    ...over,
  } as Transfer;
}
