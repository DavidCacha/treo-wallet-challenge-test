/* Mocks de módulos nativos para Jest (en Node no hay Keychain, NetInfo ni crypto nativo). */
jest.mock('expo-secure-store', () => require('./src/test/mocks/secureStore'));
jest.mock('@react-native-community/netinfo', () => require('./src/test/mocks/netinfo'));
jest.mock('expo-crypto', () => require('./src/test/mocks/expoCrypto'));
