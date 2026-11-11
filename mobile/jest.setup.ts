/* Mocks de módulos nativos para Jest (en Node no hay Keychain, NetInfo ni crypto nativo). */
jest.mock('expo-secure-store', () => require('./src/test/mocks/secureStore'));
jest.mock('@react-native-community/netinfo', () => require('./src/test/mocks/netinfo'));
jest.mock('expo-crypto', () => require('./src/test/mocks/expoCrypto'));

// React Query notifica en un setTimeout; se envuelve en act() para que esas
// actualizaciones no generen advertencias fuera de act en las pruebas.
import { act } from 'react';
import { notifyManager } from '@tanstack/react-query';
notifyManager.setNotifyFunction((fn) => {
  act(fn);
});
