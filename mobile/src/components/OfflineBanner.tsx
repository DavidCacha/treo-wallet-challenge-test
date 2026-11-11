import { StyleSheet, Text, View } from 'react-native';
import { useIsOnline } from '../lib/network';
import { colors, space } from './theme';

export function OfflineBanner() {
  const online = useIsOnline();
  if (online) return null;
  return (
    <View style={styles.banner} accessibilityRole="alert">
      <Text style={styles.text}>Sin conexión. Mostramos la última información disponible.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: { backgroundColor: colors.warningBg, padding: space.sm },
  text: { color: colors.warning, textAlign: 'center', fontWeight: '600' },
});
