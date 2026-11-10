import argon2 from 'argon2';

/** argon2id con parámetros recomendados por OWASP (19 MiB, t=2, p=1). */
const OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

export function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, OPTIONS);
}

export function verifyPassword(hash: string, plain: string): Promise<boolean> {
  return argon2.verify(hash, plain).catch(() => false);
}

let dummyHash: Promise<string> | undefined;

/**
 * Verifica contra un hash ficticio cuando el correo no existe, para que el tiempo
 * de respuesta sea comparable y no permita enumerar usuarios (R1.5).
 */
export async function burnPasswordCheck(plain: string): Promise<void> {
  dummyHash ??= hashPassword('dummy-password-for-timing-equalization');
  await verifyPassword(await dummyHash, plain);
}
