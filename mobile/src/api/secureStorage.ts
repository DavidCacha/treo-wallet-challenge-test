import * as SecureStore from 'expo-secure-store';

/**
 * Único punto de persistencia de la app (R1.11): Keychain en iOS y Keystore en
 * Android vía expo-secure-store. AsyncStorage está prohibido por una regla de
 * ESLint en mobile/**.
 */
export const KEYS = {
  refreshToken: 'treo.refresh_token',
  pendingTransfer: 'treo.pending_transfer',
} as const;

type Key = (typeof KEYS)[keyof typeof KEYS];

const options: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

export function readSecure(key: Key): Promise<string | null> {
  return SecureStore.getItemAsync(key, options);
}

export function writeSecure(key: Key, value: string): Promise<void> {
  return SecureStore.setItemAsync(key, value, options);
}

export function deleteSecure(key: Key): Promise<void> {
  return SecureStore.deleteItemAsync(key, options);
}
