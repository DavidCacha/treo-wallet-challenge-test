import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DataSource } from 'typeorm';
import { appDataSource, ownerDataSource, sqlState } from '../helpers/db';

let app: DataSource;
let owner: DataSource;

beforeAll(async () => {
  app = await appDataSource(2);
  owner = await ownerDataSource();
});
afterAll(async () => {
  await app.destroy();
  await owner.destroy();
});

describe('auditoría inmutable [NFR-4, T-05]', () => {
  it('treo_app puede insertar eventos', async () => {
    const rows = await app.query(
      `INSERT INTO audit_events (action, metadata) VALUES ('test.event', '{}') RETURNING id`,
    );
    expect(rows).toHaveLength(1);
  });

  it('treo_app no puede actualizar, borrar ni truncar (42501)', async () => {
    expect(await sqlState(app.query(`UPDATE audit_events SET action = 'x'`))).toBe('42501');
    expect(await sqlState(app.query(`DELETE FROM audit_events`))).toBe('42501');
    expect(await sqlState(app.query(`TRUNCATE audit_events`))).toBe('42501');
  });

  it('el trigger bloquea UPDATE/DELETE/TRUNCATE incluso al dueño del esquema', async () => {
    expect(await sqlState(owner.query(`UPDATE audit_events SET action = 'x'`))).toBe('42501');
    expect(await sqlState(owner.query(`DELETE FROM audit_events`))).toBe('42501');
    expect(await sqlState(owner.query(`TRUNCATE audit_events`))).toBe('42501');
  });
});

describe('permisos mínimos del rol de la aplicación [NFR-1, T-05]', () => {
  it('treo_app no puede borrar usuarios ni cambiar su contraseña directamente', async () => {
    expect(await sqlState(app.query(`DELETE FROM users`))).toBe('42501');
    expect(await sqlState(app.query(`UPDATE users SET password_hash = 'x'`))).toBe('42501');
  });
});
