import { formatCents } from '@treo/shared';

/** Muestra centavos enteros como MXN en es-MX sin aritmética de punto flotante (R2.4). */
export function Money({ cents, className }: { cents: number; className?: string }) {
  return <span className={className ? `money ${className}` : 'money'}>{formatCents(cents)}</span>;
}
