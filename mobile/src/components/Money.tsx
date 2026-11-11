import { Text } from 'react-native';
import type { TextProps } from 'react-native';
import { formatCents } from '@treo/shared';

/** Montos siempre como centavos enteros; el formato viene de @treo/shared (NFR-2). */
export function Money({ cents, ...props }: { cents: number } & TextProps) {
  return <Text {...props}>{formatCents(cents)}</Text>;
}
