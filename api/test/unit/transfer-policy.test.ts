import { describe, expect, it } from 'vitest';
import { decideTransfer, type PolicyInput } from '../../src/modules/transfers/policy';
import { transferRequestHash } from '../../src/modules/transfers/request-hash';
import { newTrackingCode } from '../../src/modules/transfers/tracking';

const base: PolicyInput = {
  transferKind: 'P2P',
  amountCents: 50_000,
  sourceBalanceCents: 100_000,
  sourceStatus: 'ACTIVE',
  destinationStatus: 'ACTIVE',
  usedTodayCents: 0,
  dailyLimitCents: 5_000_000,
  otpThresholdCents: 1_000_000,
  otpVerified: false,
};

describe('decideTransfer [R4.5, R6.1, R6.3, T-11]', () => {
  it('ejecuta una transferencia válida', () => {
    expect(decideTransfer(base)).toEqual({ kind: 'execute' });
  });

  it('saldo insuficiente', () => {
    expect(decideTransfer({ ...base, sourceBalanceCents: 49_999 })).toEqual({
      kind: 'reject',
      code: 'INSUFFICIENT_FUNDS',
    });
  });

  it('saldo exacto se permite', () => {
    expect(decideTransfer({ ...base, sourceBalanceCents: 50_000 })).toEqual({ kind: 'execute' });
  });

  it('cuenta bloqueada (origen o destino)', () => {
    expect(decideTransfer({ ...base, sourceStatus: 'BLOCKED' })).toMatchObject({
      code: 'ACCOUNT_BLOCKED',
    });
    expect(decideTransfer({ ...base, destinationStatus: 'BLOCKED' })).toMatchObject({
      code: 'ACCOUNT_BLOCKED',
    });
  });

  it('igualar el límite diario se permite; superarlo no', () => {
    expect(decideTransfer({ ...base, usedTodayCents: 4_950_000 })).toEqual({ kind: 'execute' });
    expect(decideTransfer({ ...base, usedTodayCents: 4_950_001 })).toEqual({
      kind: 'reject',
      code: 'DAILY_LIMIT_EXCEEDED',
    });
  });

  it('el límite no aplica a cuentas propias (A-3)', () => {
    expect(
      decideTransfer({
        ...base,
        transferKind: 'OWN_ACCOUNTS',
        usedTodayCents: 5_000_000,
        amountCents: 2_000_000,
        sourceBalanceCents: 2_000_000,
      }),
    ).toEqual({ kind: 'execute' });
  });

  it('OTP solo cuando el monto es estrictamente mayor al umbral', () => {
    const big = { ...base, sourceBalanceCents: 5_000_000 };
    expect(decideTransfer({ ...big, amountCents: 1_000_000 })).toEqual({ kind: 'execute' });
    expect(decideTransfer({ ...big, amountCents: 1_000_001 })).toEqual({ kind: 'require_otp' });
    expect(decideTransfer({ ...big, amountCents: 1_000_001, otpVerified: true })).toEqual({
      kind: 'execute',
    });
    expect(
      decideTransfer({ ...big, amountCents: 1_000_001, transferKind: 'OWN_ACCOUNTS' }),
    ).toEqual({ kind: 'execute' });
  });

  it('el saldo se valida antes de pedir OTP (no se pide código inútilmente)', () => {
    expect(
      decideTransfer({ ...base, amountCents: 2_000_000, sourceBalanceCents: 10 }),
    ).toMatchObject({
      code: 'INSUFFICIENT_FUNDS',
    });
  });

  it('rechaza montos no enteros como error de programación', () => {
    expect(() => decideTransfer({ ...base, amountCents: 10.5 })).toThrow(RangeError);
  });
});

describe('hash canónico de la solicitud [R4.10]', () => {
  const input = {
    source_account_id: '11111111-1111-4111-8111-111111111111',
    beneficiary_id: '22222222-2222-4222-8222-222222222222',
    amount_cents: 1000,
    concept: 'Renta',
    reference: '12',
  };
  it('no depende del orden de las propiedades', () => {
    const reordered = {
      reference: '12',
      concept: 'Renta',
      amount_cents: 1000,
      beneficiary_id: input.beneficiary_id,
      source_account_id: input.source_account_id,
    };
    expect(transferRequestHash(reordered)).toBe(transferRequestHash(input));
  });
  it('cambia con cualquier campo de negocio', () => {
    expect(transferRequestHash({ ...input, amount_cents: 1001 })).not.toBe(
      transferRequestHash(input),
    );
    expect(transferRequestHash({ ...input, reference: '13' })).not.toBe(transferRequestHash(input));
  });
});

describe('folio', () => {
  it('formato TRX + fecha + 8 hex', () => {
    expect(newTrackingCode(new Date('2026-11-10T12:00:00Z'))).toMatch(/^TRX20261110[0-9A-F]{8}$/);
  });
});
