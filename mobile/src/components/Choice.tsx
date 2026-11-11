import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, space } from './theme';

export interface ChoiceOption {
  value: string;
  label: string;
  detail?: string;
}

/** Grupo de opciones tipo radio (accesible) para cuentas y beneficiarios. */
export function ChoiceGroup({
  label,
  options,
  value,
  onChange,
  error,
}: {
  label: string;
  options: ChoiceOption[];
  value: string;
  onChange: (v: string) => void;
  error?: string;
}) {
  return (
    <View style={styles.wrap} accessibilityRole="radiogroup" accessibilityLabel={label}>
      <Text style={styles.label}>{label}</Text>
      {options.map((o) => {
        const checked = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="radio"
            accessibilityState={{ checked }}
            accessibilityLabel={o.detail ? `${o.label}, ${o.detail}` : o.label}
            onPress={() => onChange(o.value)}
            style={[styles.option, checked && styles.checked]}
          >
            <View style={[styles.dot, checked && styles.dotOn]} />
            <View style={styles.text}>
              <Text style={styles.optionLabel}>{o.label}</Text>
              {o.detail && <Text style={styles.detail}>{o.detail}</Text>}
            </View>
          </Pressable>
        );
      })}
      {error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: space.md },
  label: { fontSize: 14, fontWeight: '600', color: colors.text, marginBottom: space.xs },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    marginBottom: space.xs,
  },
  checked: { borderColor: colors.primary, borderWidth: 2 },
  dot: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: colors.border },
  dotOn: { borderColor: colors.primary, backgroundColor: colors.primary },
  text: { flex: 1 },
  optionLabel: { fontSize: 15, fontWeight: '600', color: colors.text },
  detail: { color: colors.muted, fontSize: 13 },
  error: { color: colors.danger, marginTop: space.xs },
});
