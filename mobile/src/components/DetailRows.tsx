import { StyleSheet, Text, View } from 'react-native';
import { colors, space } from './theme';

/** Lista "etiqueta: valor" para resúmenes y comprobantes. */
export function DetailRows({ rows }: { rows: Array<[string, string]> }) {
  return (
    <View style={styles.card}>
      {rows.map(([k, v]) => (
        <View key={k} style={styles.row}>
          <Text style={styles.key}>{k}</Text>
          <Text style={styles.value}>{v}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: 12,
    padding: space.md,
    marginBottom: space.md,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
    gap: space.md,
  },
  key: { color: colors.muted },
  value: { color: colors.text, fontWeight: '600', flexShrink: 1, textAlign: 'right' },
});
