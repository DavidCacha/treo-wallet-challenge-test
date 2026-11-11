
import { useState } from 'react';
import {
  StyleSheet,
  Text,
  TextInput,
  View,
  Pressable,
} from 'react-native';
import type { TextInputProps } from 'react-native';
import { colors, space } from './theme';

interface Props extends TextInputProps {
  label: string;
  error?: string | null;
  hint?: string;
}

export function TextField({
  label,
  error,
  hint,
  style,
  secureTextEntry,
  ...input
}: Props) {
  const [showPassword, setShowPassword] = useState(false);
  const isPassword = secureTextEntry === true;

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label}</Text>

      <View style={isPassword ? styles.inputRow : undefined}>
        <TextInput
          accessibilityLabel={label}
          accessibilityHint={error ?? hint}
          placeholderTextColor={colors.muted}
          style={[
            styles.input,
            isPassword ? styles.passwordInput : null,
            error ? styles.inputError : null,
            style,
          ]}
          secureTextEntry={
            isPassword ? !showPassword : secureTextEntry
          }
          {...input}
        />

        {isPassword && (
          <Pressable
            onPress={() => setShowPassword((current) => !current)}
            accessibilityRole="button"
            accessibilityLabel={
              showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'
            }
            accessibilityState={{ selected: showPassword }}
            style={styles.toggle}
            hitSlop={8}
          >
            <Text style={styles.toggleText}>
              {showPassword ? '◉' : '◎'}
            </Text>
          </Pressable>
        )}
      </View>

      {error ? (
        <Text style={styles.error} accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : hint ? (
        <Text style={styles.hint}>{hint}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: space.md },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
    marginBottom: space.xs,
  },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    fontSize: 16,
    backgroundColor: colors.card,
    color: colors.text,
  },
  inputRow: {
    position: 'relative',
    justifyContent: 'center',
  },
  passwordInput: {
    paddingRight: 48,
  },
  toggle: {
    position: 'absolute',
    right: 8,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    width: 36,
  },
  toggleText: {
    fontSize: 20,
    color: colors.text,
  },
  inputError: { borderColor: colors.danger },
  error: { color: colors.danger, marginTop: space.xs },
  hint: { color: colors.muted, marginTop: space.xs },
});
