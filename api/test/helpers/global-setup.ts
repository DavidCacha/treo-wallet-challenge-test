import 'reflect-metadata';
import { createDataSource } from '../../src/db/data-source';

/**
 * Reinicia la base de pruebas (rol dueño) y aplica todas las migraciones.
 * Las tablas de libro y auditoría son inmutables, por eso se recrea el esquema
 * en vez de truncar; cada prueba usa usuarios nuevos y no necesita limpieza.
 */
export default async function setup(): Promise<void> {
  const url =
    process.env.TEST_DATABASE_MIGRATION_URL ??
    'postgres://treo_owner:treo_owner_dev@localhost:5432/treo_test';
  const ds = createDataSource({ url, poolMax: 1 });
  await ds.initialize();
  try {
    await ds.query('DROP SCHEMA IF EXISTS public CASCADE');
    await ds.query('CREATE SCHEMA public');
    await ds.runMigrations({ transaction: 'each' });
  } finally {
    await ds.destroy();
  }
}
