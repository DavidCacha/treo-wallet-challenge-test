/**
 * CLABE (Clave Bancaria Estandarizada): 18 dígitos.
 * 3 banco + 3 plaza + 11 cuenta + 1 dígito verificador.
 * DV: pesos 3,7,1 cíclicos sobre los primeros 17 dígitos;
 *     suma = Σ ((dᵢ·wᵢ) mod 10);  dv = (10 − (suma mod 10)) mod 10.
 */
const WEIGHTS = [3, 7, 1] as const;
const CLABE_RE = /^\d{18}$/;

export function computeClabeCheckDigit(first17: string): number {
  if (!/^\d{17}$/.test(first17)) {
    throw new Error('Se requieren exactamente 17 dígitos');
  }
  let sum = 0;
  for (let i = 0; i < 17; i++) {
    const digit = first17.charCodeAt(i) - 48;
    sum += (digit * WEIGHTS[i % 3]!) % 10;
  }
  return (10 - (sum % 10)) % 10;
}

export function isClabeFormat(value: string): boolean {
  return CLABE_RE.test(value);
}

export function isValidClabe(value: string): boolean {
  if (!isClabeFormat(value)) return false;
  return computeClabeCheckDigit(value.slice(0, 17)) === value.charCodeAt(17) - 48;
}

/** Construye una CLABE válida a partir de prefijo (6) + número de cuenta (11). */
export function buildClabe(prefix6: string, account11: string): string {
  const first17 = `${prefix6}${account11}`;
  return `${first17}${computeClabeCheckDigit(first17)}`;
}

/** `************1234`: solo los últimos 4 dígitos visibles. */
export function maskClabe(value: string): string {
  const last4 = value.slice(-4);
  return `${'*'.repeat(14)}${last4}`;
}
