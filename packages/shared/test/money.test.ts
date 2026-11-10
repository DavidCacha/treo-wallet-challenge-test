import { describe, expect, it } from 'vitest';
import { centsToDecimalString, formatCents, parseMxnToCents } from '../src/money';

describe('parseMxnToCents [R4.3, NFR-2, EC-3]', () => {
  it.each([
    ['1234', 123400],
    ['1,234.56', 123456],
    ['1234.5', 123450],
    ['0.01', 1],
    ['$ 10', 1000],
    ['0.10', 10],
    ['1,000,000.00', 100000000],
    ['0', 0],
  ])('%s → %i centavos', (input, cents) => {
    expect(parseMxnToCents(input)).toEqual({ ok: true, cents });
  });

  it('no redondea: más de 2 decimales se rechaza', () => {
    expect(parseMxnToCents('100.005')).toEqual({ ok: false, error: 'TOO_MANY_DECIMALS' });
    expect(parseMxnToCents('0.001')).toEqual({ ok: false, error: 'TOO_MANY_DECIMALS' });
  });

  it('casos clásicos de float se calculan exactos', () => {
    // 0.1 + 0.2 en float = 0.30000000000000004; aquí se trabaja con cadenas.
    expect(parseMxnToCents('0.29')).toEqual({ ok: true, cents: 29 });
    expect(parseMxnToCents('1.15')).toEqual({ ok: true, cents: 115 });
    expect(parseMxnToCents('4.35')).toEqual({ ok: true, cents: 435 });
  });

  it.each(['-5', '1e3', 'abc', '1.2.3', '12,34', '1,2345', '.5', '5.', ' ', '+3', '1 000'])(
    'rechaza %j',
    (input) => {
      expect(parseMxnToCents(input).ok).toBe(false);
    },
  );

  it('rechaza montos fuera del rango seguro', () => {
    expect(parseMxnToCents('99999999999999999')).toEqual({ ok: false, error: 'OUT_OF_RANGE' });
  });
});

describe('formato de montos [R2.4]', () => {
  it('centsToDecimalString es exacto', () => {
    expect(centsToDecimalString(123456)).toBe('1234.56');
    expect(centsToDecimalString(5)).toBe('0.05');
    expect(centsToDecimalString(-5)).toBe('-0.05');
    expect(centsToDecimalString(0)).toBe('0.00');
    expect(centsToDecimalString(9007199254740991)).toBe('90071992547409.91');
  });

  it('formatCents usa es-MX / MXN', () => {
    expect(formatCents(123456)).toBe('$1,234.56');
    expect(formatCents(1)).toBe('$0.01');
    expect(formatCents(100000000)).toBe('$1,000,000.00');
  });

  it('formatCents no pierde precisión con enteros grandes', () => {
    expect(formatCents(9007199254740991)).toBe('$90,071,992,547,409.91');
  });

  it('rechaza montos no enteros', () => {
    expect(() => formatCents(10.5)).toThrow(RangeError);
  });
});
