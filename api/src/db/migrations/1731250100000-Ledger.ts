import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * T-06: transferencias, libro mayor de partida doble y OTP.
 * Invariantes garantizadas por la base (design.md §3.2):
 *  - el saldo solo cambia al insertar asientos (trigger SECURITY DEFINER);
 *  - el CHECK de accounts impide saldos negativos en cuentas de usuario;
 *  - un constraint trigger diferido exige que los asientos de cada transferencia
 *    COMPLETED sumen cero (y que las no completadas no tengan asientos);
 *  - asientos inmutables; idempotencia única por usuario.
 */
export class Ledger1731250100000 implements MigrationInterface {
  name = 'Ledger1731250100000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TYPE transfer_kind AS ENUM ('P2P', 'OWN_ACCOUNTS', 'DEPOSIT')`);
    await q.query(
      `CREATE TYPE transfer_status AS ENUM ('PENDING_OTP', 'COMPLETED', 'REJECTED', 'EXPIRED')`,
    );
    await q.query(`CREATE TYPE entry_type AS ENUM ('TRANSFER_IN', 'TRANSFER_OUT', 'DEPOSIT')`);

    await q.query(`
      CREATE TABLE transfers (
        id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id                uuid REFERENCES users (id),
        idempotency_key        uuid,
        request_hash           char(64),
        kind                   transfer_kind NOT NULL,
        source_account_id      uuid NOT NULL REFERENCES accounts (id),
        destination_account_id uuid NOT NULL REFERENCES accounts (id),
        beneficiary_id         uuid REFERENCES beneficiaries (id),
        amount_cents           bigint NOT NULL,
        concept                varchar(40) NOT NULL,
        reference              varchar(7) NOT NULL,
        status                 transfer_status NOT NULL,
        rejection_code         text,
        tracking_code          text NOT NULL,
        counts_toward_limit    boolean NOT NULL DEFAULT false,
        created_at             timestamptz NOT NULL DEFAULT now(),
        completed_at           timestamptz,
        CONSTRAINT transfers_idempotency_key_unique UNIQUE (user_id, idempotency_key),
        CONSTRAINT transfers_tracking_code_key UNIQUE (tracking_code),
        CONSTRAINT transfers_amount_positive CHECK (amount_cents > 0),
        CONSTRAINT transfers_distinct_accounts CHECK (source_account_id <> destination_account_id),
        CONSTRAINT transfers_concept_length CHECK (char_length(concept) BETWEEN 1 AND 40),
        CONSTRAINT transfers_reference_numeric CHECK (reference ~ '^[0-9]{1,7}$'),
        CONSTRAINT transfers_initiator_required CHECK (
          kind = 'DEPOSIT'
          OR (user_id IS NOT NULL AND idempotency_key IS NOT NULL AND request_hash IS NOT NULL)
        ),
        CONSTRAINT transfers_completed_at CHECK ((status = 'COMPLETED') = (completed_at IS NOT NULL)),
        CONSTRAINT transfers_rejection_code CHECK ((status = 'REJECTED') = (rejection_code IS NOT NULL))
      )`);
    await q.query(`
      CREATE INDEX transfers_daily_limit_idx ON transfers (user_id, completed_at)
      WHERE status = 'COMPLETED' AND counts_toward_limit`);

    await q.query(`
      CREATE TABLE ledger_entries (
        id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        transfer_id         uuid NOT NULL REFERENCES transfers (id),
        account_id          uuid NOT NULL REFERENCES accounts (id),
        entry_type          entry_type NOT NULL,
        amount_cents        bigint NOT NULL,
        balance_after_cents bigint NOT NULL,
        created_at          timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT ledger_entries_amount_non_zero CHECK (amount_cents <> 0),
        CONSTRAINT ledger_entries_sign CHECK ((entry_type = 'TRANSFER_OUT') = (amount_cents < 0))
      )`);
    await q.query(`
      CREATE INDEX ledger_entries_history_idx
      ON ledger_entries (account_id, created_at DESC, id DESC)
      INCLUDE (entry_type, amount_cents, balance_after_cents, transfer_id)`);
    await q.query(`CREATE INDEX ledger_entries_transfer_idx ON ledger_entries (transfer_id)`);

    await q.query(`
      CREATE TABLE otp_challenges (
        id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        transfer_id  uuid NOT NULL REFERENCES transfers (id),
        code_hash    char(64) NOT NULL,
        attempts     smallint NOT NULL DEFAULT 0,
        max_attempts smallint NOT NULL,
        expires_at   timestamptz NOT NULL,
        consumed_at  timestamptz,
        created_at   timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT otp_challenges_transfer_key UNIQUE (transfer_id),
        CONSTRAINT otp_challenges_attempts_range CHECK (attempts >= 0 AND attempts <= max_attempts),
        CONSTRAINT otp_challenges_max_attempts_positive CHECK (max_attempts > 0)
      )`);

    // Aplicación de saldo: única vía para modificar accounts.balance_cents.
    await q.query(`
      CREATE FUNCTION apply_ledger_entry() RETURNS trigger
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
      DECLARE
        new_balance bigint;
      BEGIN
        UPDATE accounts
           SET balance_cents = balance_cents + NEW.amount_cents
         WHERE id = NEW.account_id
        RETURNING balance_cents INTO new_balance;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'cuenta % inexistente', NEW.account_id USING ERRCODE = 'foreign_key_violation';
        END IF;
        NEW.balance_after_cents := new_balance;
        RETURN NEW;
      END
      $$`);
    await q.query(`REVOKE ALL ON FUNCTION apply_ledger_entry() FROM PUBLIC`);
    await q.query(`
      CREATE TRIGGER ledger_entries_apply_balance
      BEFORE INSERT ON ledger_entries
      FOR EACH ROW EXECUTE FUNCTION apply_ledger_entry()`);

    // Cuadre: se evalúa al COMMIT (diferido) para permitir insertar ambos asientos.
    await q.query(`
      CREATE FUNCTION assert_transfer_balanced() RETURNS trigger
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
      DECLARE
        t_id   uuid;
        st     transfer_status;
        total  bigint;
        n      integer;
      BEGIN
        IF TG_TABLE_NAME = 'ledger_entries' THEN
          t_id := NEW.transfer_id;
        ELSE
          t_id := NEW.id;
        END IF;
        SELECT status INTO st FROM transfers WHERE id = t_id;
        SELECT COALESCE(SUM(amount_cents), 0), COUNT(*) INTO total, n
          FROM ledger_entries WHERE transfer_id = t_id;
        IF st = 'COMPLETED' THEN
          IF n < 2 OR total <> 0 THEN
            RAISE EXCEPTION 'asientos desbalanceados en la transferencia % (suma %, asientos %)', t_id, total, n
              USING ERRCODE = 'check_violation', CONSTRAINT = 'ledger_entries_balanced';
          END IF;
        ELSIF n > 0 THEN
          RAISE EXCEPTION 'la transferencia % tiene asientos pero no está COMPLETED', t_id
            USING ERRCODE = 'check_violation', CONSTRAINT = 'ledger_entries_balanced';
        END IF;
        RETURN NULL;
      END
      $$`);
    await q.query(`REVOKE ALL ON FUNCTION assert_transfer_balanced() FROM PUBLIC`);
    await q.query(`
      CREATE CONSTRAINT TRIGGER ledger_entries_balanced
      AFTER INSERT ON ledger_entries
      DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW EXECUTE FUNCTION assert_transfer_balanced()`);
    await q.query(`
      CREATE CONSTRAINT TRIGGER transfers_balanced
      AFTER INSERT OR UPDATE ON transfers
      DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW EXECUTE FUNCTION assert_transfer_balanced()`);

    // Libro inmutable.
    await q.query(`
      CREATE TRIGGER ledger_entries_append_only
      BEFORE UPDATE OR DELETE ON ledger_entries
      FOR EACH ROW EXECUTE FUNCTION forbid_mutation()`);
    await q.query(`
      CREATE TRIGGER ledger_entries_no_truncate
      BEFORE TRUNCATE ON ledger_entries
      FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation()`);

    // Permisos.
    await q.query(`REVOKE ALL ON transfers, ledger_entries, otp_challenges FROM treo_app`);
    await q.query(`GRANT SELECT, INSERT ON transfers, ledger_entries, otp_challenges TO treo_app`);
    await q.query(`GRANT UPDATE (status, rejection_code, completed_at) ON transfers TO treo_app`);
    await q.query(`GRANT UPDATE (attempts, consumed_at) ON otp_challenges TO treo_app`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS otp_challenges`);
    await q.query(`DROP TABLE IF EXISTS ledger_entries`);
    await q.query(`DROP TABLE IF EXISTS transfers`);
    await q.query(`DROP FUNCTION IF EXISTS assert_transfer_balanced()`);
    await q.query(`DROP FUNCTION IF EXISTS apply_ledger_entry()`);
    await q.query(`DROP TYPE IF EXISTS entry_type`);
    await q.query(`DROP TYPE IF EXISTS transfer_status`);
    await q.query(`DROP TYPE IF EXISTS transfer_kind`);
  }
}
