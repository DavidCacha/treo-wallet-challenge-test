import { StyleSheet, Text, View } from 'react-native';
import { formatCents } from '@treo/shared';
import type { Movement } from '../api/types';
import { formatDateTime, movementLabel } from '../lib/format';
import { colors, space } from './theme';

export function MovementItem({ movement: m }: { movement: Movement }) {
  const incoming = m.amount_cents > 0;
  const amount = `${incoming ? '+' : ''}${formatCents(m.amount_cents)}`;
  const who = m.counterparty?.display_name;
  return (
    <View
      style={styles.row}
      accessible
      accessibilityLabel={`${movementLabel(m.type)}${who ? ` ${who}` : ''}, ${amount}, ${formatDateTime(m.created_at)}`}
    >
      <View style={styles.left}>
        <Text style={styles.title}>{who ?? movementLabel(m.type)}</Text>
        <Text style={styles.muted} numberOfLines={1}>
          {movementLabel(m.type)}
          {m.concept ? ` · ${m.concept}` : ''}
        </Text>
        <Text style={styles.muted}>{formatDateTime(m.created_at)}</Text>
      </View>
      <View style={styles.right}>
        <Text style={[styles.amount, { color: incoming ? colors.success : colors.text }]}>
          {amount}
        </Text>
        <Text style={styles.muted}>Saldo {formatCents(m.balance_after_cents)}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: space.md,
    backgroundColor: colors.card,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    gap: space.sm,
  },
  left: { flex: 1 },
  right: { alignItems: 'flex-end' },
  title: { fontSize: 15, fontWeight: '600', color: colors.text },
  amount: { fontSize: 15, fontWeight: '700' },
  muted: { color: colors.muted, fontSize: 13 },
});
