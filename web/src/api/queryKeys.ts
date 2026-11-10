import type { MovementFilters } from './endpoints';

export const qk = {
  me: ['me'] as const,
  accounts: ['accounts'] as const,
  beneficiaries: ['beneficiaries'] as const,
  movements: (accountId: string, filters?: MovementFilters) =>
    filters ? (['movements', accountId, filters] as const) : (['movements', accountId] as const),
  movementsAll: ['movements'] as const,
  transfer: (id: string) => ['transfer', id] as const,
};
