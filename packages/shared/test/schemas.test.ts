import { describe, expect, it } from 'vitest';
import { createTransferSchema, movementsQuerySchema } from '../src/schemas';

const base = {
  source_account_id: '11111111-1111-4111-8111-111111111111',
  beneficiary_id: '22222222-2222-4222-8222-222222222222',
  amount_cents: 1000,
  concept: 'Renta',
  reference: '0012',
};

describe('createTransferSchema [R4.3, R4.4]', () => {
  it('acepta una transferencia válida', () => {
    expect(createTransferSchema.safeParse(base).success).toBe(true);
  });
  it.each([10000.5, '1000', 0, -1, 100_000_001])('rechaza amount_cents=%j', (amount) => {
    expect(createTransferSchema.safeParse({ ...base, amount_cents: amount }).success).toBe(false);
  });
  it('exige exactamente un destino', () => {
    expect(
      createTransferSchema.safeParse({ ...base, destination_account_id: base.beneficiary_id })
        .success,
    ).toBe(false);
    const { beneficiary_id: _b, ...noDest } = base;
    expect(createTransferSchema.safeParse(noDest).success).toBe(false);
  });
  it.each(['', '12345678', '12a'])('rechaza referencia %j', (reference) => {
    expect(createTransferSchema.safeParse({ ...base, reference }).success).toBe(false);
  });
  it('rechaza concepto de más de 40 caracteres', () => {
    expect(createTransferSchema.safeParse({ ...base, concept: 'x'.repeat(41) }).success).toBe(
      false,
    );
  });
  it('rechaza campos desconocidos', () => {
    expect(createTransferSchema.safeParse({ ...base, fee: 1 }).success).toBe(false);
  });
});

describe('movementsQuerySchema [R5.3, R5.4]', () => {
  it('aplica limit por defecto 20', () => {
    expect(movementsQuerySchema.parse({}).limit).toBe(20);
  });
  it('rechaza from > to y fechas inválidas', () => {
    expect(movementsQuerySchema.safeParse({ from: '2026-11-10', to: '2026-11-01' }).success).toBe(
      false,
    );
    expect(movementsQuerySchema.safeParse({ from: '2026-02-30' }).success).toBe(false);
    expect(movementsQuerySchema.safeParse({ limit: '101' }).success).toBe(false);
    expect(movementsQuerySchema.safeParse({ type: 'FEE' }).success).toBe(false);
  });
});
