export const qk = {
  me: ['me'] as const,
  accounts: ['accounts'] as const,
  beneficiaries: ['beneficiaries'] as const,
  movements: (accountId: string) => ['movements', accountId] as const,
  movementsAll: ['movements'] as const,
};
