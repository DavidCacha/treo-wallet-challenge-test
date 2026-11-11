/**
 * URL base de la API. En Expo Go el teléfono no puede usar "localhost" (es el
 * propio teléfono): define EXPO_PUBLIC_API_URL con la IP LAN de tu equipo,
 * p. ej. http://192.168.1.50:3000/api/v1 (ver mobile/README.md).
 * Expo incrusta las variables EXPO_PUBLIC_* al empaquetar.
 */
export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000/api/v1').replace(
  /\/$/,
  '',
);

/** Tiempo máximo de espera por respuesta; al vencer se trata como falta de red. */
export const REQUEST_TIMEOUT_MS = 15_000;
