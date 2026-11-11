import type { QueryClient } from '@tanstack/react-query';
import { qk } from '../api/queryKeys';
import type { Transfer } from '../api/types';

/** Tras completar una transferencia cambian saldos, límite usado e historial. */
export async function afterTransferCompleted(client: QueryClient, t: Transfer): Promise<void> {
  client.setQueryData(qk.transfer(t.id), t);
  await Promise.all([
    client.invalidateQueries({ queryKey: qk.accounts }),
    client.invalidateQueries({ queryKey: qk.me }),
    client.invalidateQueries({ queryKey: qk.movementsAll }),
  ]);
}
