import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native';
import { colors, space } from './theme';

interface Props {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary';
  disabled?: boolean;
  loading?: boolean;
}

export function Button({ title, onPress, variant = 'primary', disabled, loading }: Props) {
  const isDisabled = disabled || loading;
  const primary = variant === 'primary';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!isDisabled, busy: !!loading }}
      disabled={isDisabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        primary ? styles.primary : styles.secondary,
        (pressed || isDisabled) && styles.dim,
      ]}
    >
      {loading && <ActivityIndicator color={primary ? colors.primaryText : colors.primary} />}
      <Text style={[styles.label, { color: primary ? colors.primaryText : colors.primary }]}>
        {title}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 48,
    borderRadius: 999,
    paddingHorizontal: space.md,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: space.sm,
  },
  primary: { backgroundColor: colors.primary },
  secondary: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.primary },
  dim: { opacity: 0.6 },
  label: { fontSize: 16, fontWeight: '600' },
});
