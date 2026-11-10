import 'dotenv/config';
import { createDataSource } from '../data-source';

async function main(): Promise<void> {
  const direction = process.argv[2] ?? 'up';
  const url = process.env.DATABASE_MIGRATION_URL;
  if (!url) {
    throw new Error(
      'Define DATABASE_MIGRATION_URL (rol dueño del esquema) para correr migraciones',
    );
  }
  const ds = createDataSource({ url, poolMax: 1 });
  await ds.initialize();
  try {
    if (direction === 'down') {
      await ds.undoLastMigration({ transaction: 'each' });
      console.log('Última migración revertida');
    } else {
      const ran = await ds.runMigrations({ transaction: 'each' });
      console.log(
        ran.length
          ? `Migraciones aplicadas: ${ran.map((m) => m.name).join(', ')}`
          : 'Sin migraciones pendientes',
      );
    }
  } finally {
    await ds.destroy();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
