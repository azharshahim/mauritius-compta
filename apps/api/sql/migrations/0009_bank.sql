-- ---------------------------------------------------------------------------
-- 0009_bank.sql - Bank statement import and reconciliation (mission 9)
--
-- Additive only. The accounting engine is untouched: a reconciliation never
-- posts anything, and an accepted *proposal* is posted through the existing
-- `postEntryTx` service, exactly like a manual entry.
--
--  1. Physical bank accounts, distinct from their chart-of-accounts account.
--  2. Statement imports (metadata only: the uploaded file is never stored).
--  3. Imported transactions, idempotent by fingerprint.
--  4. Reconciliation matches (proposed / confirmed / rejected).
--  5. Cabinet-validated classification rules, versioned.
--  6. Draft accounting proposals; acceptance is a human action.
--  7. Append-only audit events.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS bank_accounts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id       uuid NOT NULL REFERENCES cabinets(id) ON DELETE CASCADE,
  company_id       uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name             text NOT NULL,
  bank_name        text NOT NULL,
  currency         char(3) NOT NULL,
  -- The chart-of-accounts account (asset) that holds this bank balance.
  account_id       uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  -- Last digits only: the full IBAN/account number is never stored.
  masked_reference text,
  is_active        boolean NOT NULL DEFAULT true,
  created_by       uuid REFERENCES app_users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, name)
);
CREATE INDEX IF NOT EXISTS bank_accounts_company_idx ON bank_accounts (company_id, is_active);
CREATE INDEX IF NOT EXISTS bank_accounts_cabinet_idx ON bank_accounts (cabinet_id);

CREATE TABLE IF NOT EXISTS bank_imports (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id        uuid NOT NULL REFERENCES cabinets(id) ON DELETE CASCADE,
  company_id        uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  bank_account_id   uuid NOT NULL REFERENCES bank_accounts(id) ON DELETE CASCADE,
  created_by        uuid REFERENCES app_users(id) ON DELETE SET NULL,
  file_name         text NOT NULL,
  file_size         integer NOT NULL DEFAULT 0 CHECK (file_size >= 0),
  file_hash         text NOT NULL,
  idempotency_key   text NOT NULL,
  format            text,
  encoding          text,
  status            text NOT NULL DEFAULT 'previewed'
                      CHECK (status IN ('previewed', 'imported', 'failed', 'cancelled')),
  row_count         integer NOT NULL DEFAULT 0 CHECK (row_count >= 0),
  imported_count    integer NOT NULL DEFAULT 0 CHECK (imported_count >= 0),
  duplicate_count   integer NOT NULL DEFAULT 0 CHECK (duplicate_count >= 0),
  opening_balance   numeric(20,4),
  closing_balance   numeric(20,4),
  summary           jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (bank_account_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS bank_imports_company_idx ON bank_imports (company_id, created_at DESC);

CREATE TABLE IF NOT EXISTS bank_transactions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id      uuid NOT NULL REFERENCES cabinets(id) ON DELETE CASCADE,
  company_id      uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  bank_account_id uuid NOT NULL REFERENCES bank_accounts(id) ON DELETE CASCADE,
  import_id       uuid REFERENCES bank_imports(id) ON DELETE SET NULL,
  txn_date        date NOT NULL,
  value_date      date,
  label           text NOT NULL,
  reference       text,
  -- Signed in the account currency: positive = money in, negative = money out.
  amount          numeric(20,4) NOT NULL CHECK (amount <> 0),
  currency        char(3) NOT NULL,
  balance         numeric(20,4),
  external_id     text,
  fingerprint     text NOT NULL,
  status          text NOT NULL DEFAULT 'unmatched'
                    CHECK (status IN ('unmatched', 'proposed', 'matched', 'review', 'excluded', 'cancelled')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (bank_account_id, fingerprint)
);
CREATE INDEX IF NOT EXISTS bank_transactions_account_idx ON bank_transactions (bank_account_id, txn_date DESC);
CREATE INDEX IF NOT EXISTS bank_transactions_company_idx ON bank_transactions (company_id, status);
CREATE INDEX IF NOT EXISTS bank_transactions_external_idx ON bank_transactions (bank_account_id, external_id);

CREATE TABLE IF NOT EXISTS bank_matches (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id         uuid NOT NULL REFERENCES cabinets(id) ON DELETE CASCADE,
  company_id         uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  bank_account_id    uuid NOT NULL REFERENCES bank_accounts(id) ON DELETE CASCADE,
  transaction_id     uuid NOT NULL REFERENCES bank_transactions(id) ON DELETE CASCADE,
  entry_id           uuid REFERENCES journal_entries(id) ON DELETE CASCADE,
  entry_line_id      uuid REFERENCES journal_lines(id) ON DELETE CASCADE,
  billing_payment_id uuid REFERENCES billing_payments(id) ON DELETE SET NULL,
  status             text NOT NULL DEFAULT 'proposed'
                       CHECK (status IN ('proposed', 'confirmed', 'rejected')),
  kind               text NOT NULL DEFAULT 'entry'
                       CHECK (kind IN ('entry', 'invoice', 'internal_transfer')),
  confidence         numeric(5,4),
  reasons            jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by         uuid REFERENCES app_users(id) ON DELETE SET NULL,
  decided_by         uuid REFERENCES app_users(id) ON DELETE SET NULL,
  decided_at         timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (transaction_id, entry_line_id)
);
CREATE INDEX IF NOT EXISTS bank_matches_txn_idx ON bank_matches (transaction_id, status);
CREATE INDEX IF NOT EXISTS bank_matches_entry_idx ON bank_matches (entry_id, status);
CREATE INDEX IF NOT EXISTS bank_matches_company_idx ON bank_matches (company_id, status);

CREATE TABLE IF NOT EXISTS bank_rules (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id        uuid NOT NULL REFERENCES cabinets(id) ON DELETE CASCADE,
  company_id        uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name              text NOT NULL,
  label_pattern     text,
  reference_pattern text,
  bank_account_id   uuid REFERENCES bank_accounts(id) ON DELETE CASCADE,
  currency          char(3),
  direction         text NOT NULL DEFAULT 'any'
                      CHECK (direction IN ('any', 'in', 'out')),
  account_id        uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  journal_id        uuid REFERENCES journals(id) ON DELETE SET NULL,
  priority          integer NOT NULL DEFAULT 100,
  version           integer NOT NULL DEFAULT 1,
  supersedes_id     uuid REFERENCES bank_rules(id) ON DELETE SET NULL,
  is_active         boolean NOT NULL DEFAULT true,
  notes             text,
  created_by        uuid REFERENCES app_users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bank_rules_company_idx ON bank_rules (company_id, is_active, priority);
CREATE INDEX IF NOT EXISTS bank_rules_cabinet_idx ON bank_rules (cabinet_id);

CREATE TABLE IF NOT EXISTS bank_proposals (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id       uuid NOT NULL REFERENCES cabinets(id) ON DELETE CASCADE,
  company_id       uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  bank_account_id  uuid NOT NULL REFERENCES bank_accounts(id) ON DELETE CASCADE,
  transaction_id   uuid NOT NULL REFERENCES bank_transactions(id) ON DELETE CASCADE,
  account_id       uuid REFERENCES accounts(id) ON DELETE SET NULL,
  journal_id       uuid REFERENCES journals(id) ON DELETE SET NULL,
  entry_date       date NOT NULL,
  amount           numeric(20,4) NOT NULL,
  direction        text NOT NULL CHECK (direction IN ('in', 'out')),
  status           text NOT NULL DEFAULT 'proposed'
                     CHECK (status IN ('proposed', 'accepted', 'rejected')),
  confidence       numeric(5,4),
  rationale        jsonb NOT NULL DEFAULT '{}'::jsonb,
  rule_id          uuid REFERENCES bank_rules(id) ON DELETE SET NULL,
  created_entry_id uuid REFERENCES journal_entries(id) ON DELETE SET NULL,
  created_by       uuid REFERENCES app_users(id) ON DELETE SET NULL,
  decided_by       uuid REFERENCES app_users(id) ON DELETE SET NULL,
  decided_at       timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bank_proposals_txn_idx ON bank_proposals (transaction_id, status);
CREATE INDEX IF NOT EXISTS bank_proposals_company_idx ON bank_proposals (company_id, status);

CREATE TABLE IF NOT EXISTS bank_events (
  id          bigserial PRIMARY KEY,
  cabinet_id  uuid NOT NULL REFERENCES cabinets(id) ON DELETE CASCADE,
  company_id  uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  entity      text NOT NULL,
  entity_id   uuid,
  event       text NOT NULL,
  actor_id    uuid REFERENCES app_users(id) ON DELETE SET NULL,
  ip          text,
  metadata    jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bank_events_company_idx ON bank_events (company_id, created_at DESC);
