import type { DataSource } from 'typeorm';
import { createDataSource } from '../../src/db/data-source';

/** Conexión con el rol de la aplicación (permisos mínimos). */
export async function appDataSource(poolMax = 25): Promise<DataSource> {
  const ds = createDataSource({ url: process.env.TEST_DATABASE_URL!, poolMax });
  await ds.initialize();
  return ds;
}

/** Conexión con el rol dueño del esquema (solo para preparar escenarios en pruebas). */
export async function ownerDataSource(): Promise<DataSource> {
  const ds = createDataSource({ url: process.env.TEST_DATABASE_MIGRATION_URL!, poolMax: 2 });
  await ds.initialize();
  return ds;
}

/** Captura el código SQLSTATE de una promesa que debe fallar. */
export async function sqlState(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
    return undefined;
  } catch (err) {
    const e = err as { code?: string; driverError?: { code?: string } };
    return e.driverError?.code ?? e.code;
  }
}
