import type { ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { messageFor } from '../api/errors';
import { Button } from './Button';
import { colors, space } from './theme';

export function LoadingState({ label = 'Cargando…' }: { label?: string }) {
  return (
    <View style={styles.center} accessibilityRole="progressbar" accessibilityLabel={label}>
      <ActivityIndicator color={colors.primary} size="large" />
      <Text style={styles.muted}>{label}</Text>
    </View>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <View style={[styles.box, styles.error]} accessibilityRole="alert">
      <Text style={styles.title}>No pudimos cargar la información</Text>
      <Text style={styles.body}>{messageFor(error)}</Text>
      {onRetry && <Button title="Reintentar" variant="secondary" onPress={onRetry} />}
    </View>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <View style={styles.box}>
      <Text style={styles.title}>{title}</Text>
      {typeof children === 'string' ? <Text style={styles.body}>{children}</Text> : children}
    </View>
  );
}

/** Aviso destacado: tono informativo, de advertencia, error o éxito. */
export function Notice({
  tone = 'info',
  title,
  children,
}: {
  tone?: 'info' | 'warning' | 'error' | 'success';
  title?: string;
  children?: ReactNode;
}) {
  const toneStyle = {
    info: styles.box,
    warning: styles.warning,
    error: styles.error,
    success: styles.success,
  }[tone];
  return (
    <View
      style={[styles.box, toneStyle]}
      accessibilityRole={tone === 'error' ? 'alert' : undefined}
    >
      {title && <Text style={styles.title}>{title}</Text>}
      {typeof children === 'string' ? <Text style={styles.body}>{children}</Text> : children}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { padding: space.lg, alignItems: 'center', gap: space.sm },
  muted: { color: colors.muted },
  box: {
    padding: space.md,
    borderRadius: 12,
    backgroundColor: colors.card,
    gap: space.sm,
    marginBottom: space.md,
  },
  error: { backgroundColor: colors.dangerBg },
  warning: { backgroundColor: colors.warningBg },
  success: { backgroundColor: colors.successBg },
  title: { fontSize: 16, fontWeight: '700', color: colors.text },
  body: { color: colors.text, lineHeight: 20 },
});
