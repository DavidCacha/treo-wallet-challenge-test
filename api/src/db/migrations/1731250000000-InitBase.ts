import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * T-05: esquema base, roles y auditoría inmutable.
 * Se escribe en SQL porque TypeORM no modela grants por columna, triggers,
 * citext ni enums nombrados con la precisión que necesitamos (design.md §3.4).
 * Requiere que existan los roles treo_owner (quien migra) y treo_app.
 */
export class InitBase1731250000000 implements MigrationInterface {
  name = 'InitBase1731250000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE EXTENSION IF NOT EXISTS citext`);
    await q.query(`CREATE TYPE account_kind AS ENUM ('USER', 'SYSTEM')`);
    await q.query(`CREATE TYPE account_status AS ENUM ('ACTIVE', 'BLOCKED')`);

    await q.query(`
      CREATE TABLE users (
        id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        email             citext NOT NULL,
        full_name         text NOT NULL,
        password_hash     text NOT NULL,
        daily_limit_cents bigint NOT NULL,
        created_at        timestamptz NOT NULL DEFAULT now(),
        updated_at        timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT users_email_key UNIQUE (email),
        CONSTRAINT users_full_name_length CHECK (char_length(full_name) BETWEEN 1 AND 120),
        CONSTRAINT users_daily_limit_positive CHECK (daily_limit_cents > 0)
      )`);

    await q.query(`
      CREATE TABLE accounts (
        id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id       uuid REFERENCES users (id),
        kind          account_kind NOT NULL DEFAULT 'USER',
        name          text NOT NULL,
        clabe         char(18) NOT NULL,
        currency      char(3) NOT NULL DEFAULT 'MXN',
        balance_cents bigint NOT NULL DEFAULT 0,
        status        account_status NOT NULL DEFAULT 'ACTIVE',
        created_at    timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT accounts_clabe_key UNIQUE (clabe),
        CONSTRAINT accounts_clabe_format CHECK (clabe ~ '^[0-9]{18}$'),
        CONSTRAINT accounts_currency_mxn CHECK (currency = 'MXN'),
        CONSTRAINT accounts_balance_non_negative CHECK (kind = 'SYSTEM' OR balance_cents >= 0),
        CONSTRAINT accounts_system_owner CHECK ((kind = 'SYSTEM') = (user_id IS NULL))
      )`);
    await q.query(`CREATE INDEX accounts_user_id_idx ON accounts (user_id)`);

    await q.query(`
      CREATE TABLE beneficiaries (
        id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id    uuid NOT NULL REFERENCES users (id),
        account_id uuid NOT NULL REFERENCES accounts (id),
        name       text NOT NULL,
        alias      text NOT NULL,
        clabe      char(18) NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT beneficiaries_user_clabe_key UNIQUE (user_id, clabe),
        CONSTRAINT beneficiaries_clabe_format CHECK (clabe ~ '^[0-9]{18}$'),
        CONSTRAINT beneficiaries_name_length CHECK (char_length(name) BETWEEN 1 AND 80),
        CONSTRAINT beneficiaries_alias_length CHECK (char_length(alias) BETWEEN 1 AND 30)
      )`);

    await q.query(`
      CREATE TABLE refresh_tokens (
        id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id        uuid NOT NULL REFERENCES users (id),
        family_id      uuid NOT NULL,
        token_hash     char(64) NOT NULL,
        replaced_by_id uuid REFERENCES refresh_tokens (id),
        expires_at     timestamptz NOT NULL,
        revoked_at     timestamptz,
        created_at     timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT refresh_tokens_token_hash_key UNIQUE (token_hash)
      )`);
    await q.query(`CREATE INDEX refresh_tokens_family_idx ON refresh_tokens (family_id)`);
    await q.query(`CREATE INDEX refresh_tokens_user_idx ON refresh_tokens (user_id)`);

    await q.query(`
      CREATE TABLE audit_events (
        id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        occurred_at   timestamptz NOT NULL DEFAULT now(),
        actor_user_id uuid REFERENCES users (id),
        action        text NOT NULL,
        entity_type   text,
        entity_id     text,
        request_id    text,
        ip            inet,
        metadata      jsonb NOT NULL DEFAULT '{}'::jsonb
      )`);
    await q.query(
      `CREATE INDEX audit_events_actor_idx ON audit_events (actor_user_id, occurred_at)`,
    );

    // Inmutabilidad: además del REVOKE, un trigger bloquea UPDATE/DELETE/TRUNCATE
    // incluso para roles con más privilegios (defensa en profundidad).
    await q.query(`
      CREATE FUNCTION forbid_mutation() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        RAISE EXCEPTION 'la tabla % es de solo inserción', TG_TABLE_NAME
          USING ERRCODE = 'insufficient_privilege';
      END
      $$`);
    await q.query(`
      CREATE TRIGGER audit_events_append_only
      BEFORE UPDATE OR DELETE ON audit_events
      FOR EACH ROW EXECUTE FUNCTION forbid_mutation()`);
    await q.query(`
      CREATE TRIGGER audit_events_no_truncate
      BEFORE TRUNCATE ON audit_events
      FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation()`);

    // Permisos mínimos del rol de la aplicación.
    await q.query(`GRANT USAGE ON SCHEMA public TO treo_app`);
    await q.query(
      `REVOKE ALL ON users, accounts, beneficiaries, refresh_tokens, audit_events FROM treo_app`,
    );
    await q.query(
      `GRANT SELECT, INSERT ON users, accounts, beneficiaries, refresh_tokens, audit_events TO treo_app`,
    );
    await q.query(`GRANT UPDATE (full_name, updated_at) ON users TO treo_app`);
    await q.query(`GRANT UPDATE (name, status) ON accounts TO treo_app`);
    await q.query(`GRANT UPDATE (revoked_at, replaced_by_id) ON refresh_tokens TO treo_app`);
    await q.query(`GRANT DELETE ON beneficiaries TO treo_app`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS audit_events`);
    await q.query(`DROP FUNCTION IF EXISTS forbid_mutation()`);
    await q.query(`DROP TABLE IF EXISTS refresh_tokens`);
    await q.query(`DROP TABLE IF EXISTS beneficiaries`);
    await q.query(`DROP TABLE IF EXISTS accounts`);
    await q.query(`DROP TABLE IF EXISTS users`);
    await q.query(`DROP TYPE IF EXISTS account_status`);
    await q.query(`DROP TYPE IF EXISTS account_kind`);
  }
}
