import { createHash } from 'node:crypto';
import type { CreateTransferInput } from '@treo/shared';

/**
 * Hash del cuerpo canónico (orden fijo de campos, destino normalizado) para
 * detectar que una llave de idempotencia se reutiliza con otro contenido (R4.10).
 */
export function transferRequestHash(input: CreateTransferInput): string {
  const canonical = JSON.stringify([
    input.source_account_id.toLowerCase(),
    input.beneficiary_id?.toLowerCase() ?? null,
    input.destination_account_id?.toLowerCase() ?? null,
    input.amount_cents,
    input.concept,
    input.reference,
  ]);
  return createHash('sha256').update(canonical).digest('hex');
}
