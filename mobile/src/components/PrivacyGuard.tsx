import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { AppState, StyleSheet, Text, View } from 'react-native';
import type { AppStateStatus } from 'react-native';
import { colors, space } from './theme';

/**
 * NFR-13: cuando la app deja de estar activa (`inactive` en el selector de apps
 * de iOS, `background` en ambas plataformas) se tapa todo el contenido para que
 * saldos y movimientos no aparezcan en la vista previa del sistema. El
 * contenido no se desmonta: la navegación y una transferencia en curso siguen.
 */
/** Al arrancar el estado puede ser "unknown" un instante: se trata como activo. */
function initialState(): AppStateStatus {
  const s = AppState.currentState as AppStateStatus | null;
  return !s || s === 'unknown' ? 'active' : s;
}

export function PrivacyGuard({ children }: { children: ReactNode }) {
  const [appState, setAppState] = useState<AppStateStatus>(initialState);

  useEffect(() => {
    const sub = AppState.addEventListener('change', setAppState);
    return () => sub.remove();
  }, []);

  const covered = appState !== 'active';
  return (
    <View style={styles.flex}>
      <View
        style={styles.flex}
        aria-hidden={covered}
        accessibilityElementsHidden={covered}
        importantForAccessibility={covered ? 'no-hide-descendants' : 'auto'}
      >
        {children}
      </View>
      {covered && (
        <View style={styles.cover} testID="privacy-cover" accessibilityLabel="Contenido oculto">
          <Text style={styles.brand}>Treo</Text>
          <Text style={styles.note}>Contenido oculto por privacidad</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  cover: {
    ...StyleSheet.absoluteFill,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    zIndex: 10,
    elevation: 10,
  },
  brand: { color: colors.primaryText, fontSize: 40, fontWeight: '800' },
  note: { color: colors.primaryText, fontSize: 16 },
});
