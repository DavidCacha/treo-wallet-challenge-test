import type { ValueTransformer } from 'typeorm';

/**
 * `pg` entrega BIGINT como string. Se convierte a number SOLO si es un entero
 * seguro; de lo contrario se lanza un error en vez de perder precisión (D-1).
 */
export function toSafeInteger(value: string | number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(n)) {
    throw new RangeError(`Valor BIGINT fuera del rango seguro: ${String(value)}`);
  }
  return n;
}

export const bigintColumn: ValueTransformer = {
  to: (value: number | null | undefined) => value,
  from: (value: string | null) => (value === null ? null : toSafeInteger(value)),
};
