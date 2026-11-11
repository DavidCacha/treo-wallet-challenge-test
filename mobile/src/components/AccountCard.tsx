import { Pressable, StyleSheet, Text } from 'react-native';
import { formatCents } from '@treo/shared';
import type { Account } from '../api/types';
import { colors, space } from './theme';

export function AccountCard({
  account,
  selected,
  onPress,
}: {
  account: Account;
  selected: boolean;
  onPress: () => void;
}) {
  const balance = formatCents(account.available_balance_cents);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={`${account.name}, saldo disponible ${balance}`}
      onPress={onPress}
      style={[styles.card, selected && styles.selected]}
    >
      <Text style={styles.name}>{account.name}</Text>
      <Text style={styles.balance}>{balance}</Text>
      <Text style={styles.muted}>
        Saldo disponible · CLABE ···{account.clabe.slice(-4)}
        {account.status === 'BLOCKED' ? ' · Bloqueada' : ''}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: 18,
    padding: space.md,
    marginBottom: space.sm,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  selected: { borderColor: colors.primary },
  name: { fontSize: 14, fontWeight: '600', color: colors.muted },
  balance: { fontSize: 28, fontWeight: '700', color: colors.text, marginVertical: space.xs },
  muted: { color: colors.muted, fontSize: 13 },
});
