/**
 * Dinero como centavos enteros. NUNCA se usa aritmética de punto flotante
 * para interpretar montos (NFR-2): se parsea la cadena por partes.
 */
export const MAX_TRANSFER_CENTS = 100_000_000; // 1,000,000.00 MXN

export type ParseMoneyError = 'EMPTY' | 'INVALID_FORMAT' | 'TOO_MANY_DECIMALS' | 'OUT_OF_RANGE';
export type ParseMoneyResult = { ok: true; cents: number } | { ok: false; error: ParseMoneyError };

const WITH_THOUSANDS = /^\d{1,3}(,\d{3})+$/;
const PLAIN = /^\d+$/;

/**
 * Convierte una cadena escrita por el usuario a centavos.
 * Acepta "1234", "1,234", "1234.5", "1,234.56" y un "$" inicial opcional.
 * Rechaza signos, notación científica y más de 2 decimales (no redondea).
 */
export function parseMxnToCents(input: string): ParseMoneyResult {
  const raw = input.trim().replace(/^\$\s*/, '');
  if (raw === '') return { ok: false, error: 'EMPTY' };

  const parts = raw.split('.');
  if (parts.length > 2) return { ok: false, error: 'INVALID_FORMAT' };
  const intRaw = parts[0] ?? '';
  const fracRaw = parts[1];

  if (!(PLAIN.test(intRaw) || WITH_THOUSANDS.test(intRaw))) {
    return { ok: false, error: 'INVALID_FORMAT' };
  }
  if (fracRaw !== undefined) {
    if (!/^\d+$/.test(fracRaw)) return { ok: false, error: 'INVALID_FORMAT' };
    if (fracRaw.length > 2) return { ok: false, error: 'TOO_MANY_DECIMALS' };
  }

  const intDigits = intRaw.replace(/,/g, '').replace(/^0+(?=\d)/, '');
  // 13 dígitos enteros = 10^15 centavos, aún dentro de Number.MAX_SAFE_INTEGER.
  if (intDigits.length > 13) return { ok: false, error: 'OUT_OF_RANGE' };

  const frac = (fracRaw ?? '').padEnd(2, '0');
  const cents = Number(intDigits) * 100 + Number(frac);
  if (!Number.isSafeInteger(cents)) return { ok: false, error: 'OUT_OF_RANGE' };
  return { ok: true, cents };
}

function assertSafeCents(cents: number): void {
  if (!Number.isSafeInteger(cents)) {
    throw new RangeError('El monto debe ser un entero seguro de centavos');
  }
}

/** Cadena decimal exacta: 123456 → "1234.56", -5 → "-0.05". */
export function centsToDecimalString(cents: number): string {
  assertSafeCents(cents);
  const negative = cents < 0;
  const abs = String(Math.abs(cents)).padStart(3, '0');
  const int = abs.slice(0, -2);
  const frac = abs.slice(-2);
  return `${negative ? '-' : ''}${int}.${frac}`;
}

const currencyFormatters = new Map<string, Intl.NumberFormat>();
function currencyFormatter(locale: string): Intl.NumberFormat {
  let f = currencyFormatters.get(locale);
  if (!f) {
    f = new Intl.NumberFormat(locale, { style: 'currency', currency: 'MXN' });
    currencyFormatters.set(locale, f);
  }
  return f;
}

/**
 * Formatea centavos como moneda MXN en es-MX sin pasar por float:
 * Intl.NumberFormat v3 acepta cadenas decimales exactas. Si el motor no lo
 * soporta (p. ej. Hermes antiguo), se formatea la parte entera y se concatenan
 * los centavos.
 */
export function formatCents(cents: number, locale = 'es-MX'): string {
  const decimal = centsToDecimalString(cents);
  const formatter = currencyFormatter(locale);
  try {
    // El tipo de TS aún no declara la sobrecarga con string (ES2023 Intl.NumberFormat v3).
    const out = (formatter.format as (v: string) => string)(decimal);
    if (!out.includes('NaN')) return out;
  } catch {
    // continúa con la alternativa
  }
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const pesos = Math.trunc(abs / 100); // división entera exacta para enteros seguros
  const centavos = String(abs % 100).padStart(2, '0');
  const intFormatted = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(pesos);
  return `${negative ? '-' : ''}$${intFormatted}.${centavos}`;
}
