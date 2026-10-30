-- ---------------------------------------------------------------------------
-- 0001_core.sql - Mauritius Compta core schema (PostgreSQL 14+)
--
-- Design notes:
--  * Every accounting row carries company_id: strict multi-company isolation.
--  * Money is numeric(20,4); never floating point.
--  * Immutability of posted entries is enforced by database triggers (defence
--    in depth) in addition to application checks.
-- ---------------------------------------------------------------------------

CREATE TABLE app_users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL,
  password_hash text NOT NULL,
  full_name     text NOT NULL,
  locale        text NOT NULL DEFAULT 'fr' CHECK (locale IN ('fr', 'en')),
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX app_users_email_lower_idx ON app_users (lower(email));

CREATE TABLE sessions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  ip         text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user_idx ON sessions (user_id);
CREATE INDEX sessions_expires_idx ON sessions (expires_at);

-- ---------------------------------------------------------------------------
-- Companies
-- ---------------------------------------------------------------------------
CREATE TABLE companies (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                   text NOT NULL CHECK (length(trim(name)) > 0),
  brn                    text,
  vat_number             text,
  registered_address     text,
  business_activity      text,
  financial_year_start   date NOT NULL,
  financial_year_end     date NOT NULL,
  functional_currency    char(3) NOT NULL DEFAULT 'MUR',
  presentation_currency  char(3) NOT NULL DEFAULT 'MUR',
  accounting_standard    text NOT NULL DEFAULT 'IFRS',
  status                 text NOT NULL DEFAULT 'active'
                           CHECK (status IN ('active', 'inactive', 'archived')),
  locale                 text NOT NULL DEFAULT 'fr' CHECK (locale IN ('fr', 'en')),
  created_by             uuid REFERENCES app_users(id) ON DELETE SET NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT companies_fy_order CHECK (financial_year_end > financial_year_start)
);
CREATE UNIQUE INDEX companies_brn_unique_idx
  ON companies (lower(brn)) WHERE brn IS NOT NULL AND btrim(brn) <> '';

CREATE TABLE company_members (
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  role       text NOT NULL CHECK (role IN ('owner', 'admin', 'accountant', 'viewer')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, user_id)
);

CREATE TABLE company_settings (
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  key        text NOT NULL,
  value      jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, key)
);

-- ---------------------------------------------------------------------------
-- Chart of accounts
-- ---------------------------------------------------------------------------
CREATE TABLE accounts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  code            text NOT NULL,
  name            text NOT NULL,
  type            text NOT NULL
                    CHECK (type IN ('asset', 'liability', 'equity', 'revenue', 'expense')),
  parent_id       uuid REFERENCES accounts(id) ON DELETE RESTRICT,
  currency        char(3) NOT NULL DEFAULT 'MUR',
  is_active       boolean NOT NULL DEFAULT true,
  fs_mapping      text,
  description     text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT accounts_code_not_blank CHECK (length(trim(code)) > 0)
);
CREATE UNIQUE INDEX accounts_company_code_idx ON accounts (company_id, lower(btrim(code)));
CREATE INDEX accounts_company_type_idx ON accounts (company_id, type);

-- ---------------------------------------------------------------------------
-- Journals
-- ---------------------------------------------------------------------------
CREATE TABLE journals (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  code       text NOT NULL,
  name       text NOT NULL,
  type       text NOT NULL
               CHECK (type IN ('sales', 'purchases', 'bank', 'cash', 'general')),
  is_active  boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX journals_company_code_idx ON journals (company_id, lower(btrim(code)));

-- ---------------------------------------------------------------------------
-- Accounting periods (closed-period control)
-- ---------------------------------------------------------------------------
CREATE TABLE accounting_periods (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name       text NOT NULL,
  start_date date NOT NULL,
  end_date   date NOT NULL,
  status     text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  closed_at  timestamptz,
  closed_by  uuid REFERENCES app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT periods_date_order CHECK (end_date >= start_date)
);
CREATE INDEX accounting_periods_company_idx ON accounting_periods (company_id, start_date, end_date);

-- ---------------------------------------------------------------------------
-- Journal entries
-- ---------------------------------------------------------------------------
CREATE TABLE journal_entries (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id           uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  journal_id           uuid NOT NULL REFERENCES journals(id) ON DELETE RESTRICT,
  entry_no             text NOT NULL,
  entry_date           date NOT NULL,
  reference            text,
  description          text NOT NULL,
  currency             char(3) NOT NULL,
  exchange_rate        numeric(20,8) NOT NULL DEFAULT 1 CHECK (exchange_rate > 0),
  status               text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'posted')),
  source               text NOT NULL DEFAULT 'manual'
                         CHECK (source IN ('manual', 'reversal', 'opening')),
  reversal_of_entry_id uuid REFERENCES journal_entries(id) ON DELETE RESTRICT,
  posted_at            timestamptz,
  posted_by            uuid REFERENCES app_users(id) ON DELETE SET NULL,
  created_by           uuid REFERENCES app_users(id) ON DELETE SET NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX journal_entries_company_no_idx ON journal_entries (company_id, entry_no);
CREATE INDEX journal_entries_company_date_idx ON journal_entries (company_id, entry_date);
CREATE INDEX journal_entries_status_idx ON journal_entries (company_id, status);

CREATE TABLE journal_lines (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id      uuid NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
  company_id    uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  line_no       integer NOT NULL,
  account_id    uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  description   text,
  debit         numeric(20,4) NOT NULL DEFAULT 0,
  credit        numeric(20,4) NOT NULL DEFAULT 0,
  txn_currency  char(3) NOT NULL DEFAULT 'MUR',
  txn_amount    numeric(20,4),
  fx_rate       numeric(20,8),
  CONSTRAINT journal_lines_amounts CHECK (debit >= 0 AND credit >= 0),
  CONSTRAINT journal_lines_one_side CHECK (
    (debit > 0 AND credit = 0) OR (credit > 0 AND debit = 0)
  )
);
CREATE INDEX journal_lines_entry_idx ON journal_lines (entry_id);
CREATE INDEX journal_lines_account_idx ON journal_lines (company_id, account_id);

CREATE TABLE entry_sequences (
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  journal_id uuid NOT NULL REFERENCES journals(id) ON DELETE CASCADE,
  year       integer NOT NULL,
  last_no    integer NOT NULL DEFAULT 0,
  PRIMARY KEY (company_id, journal_id, year)
);

-- ---------------------------------------------------------------------------
-- Multidcurrency
-- ---------------------------------------------------------------------------
CREATE TABLE exchange_rates (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  from_currency char(3) NOT NULL,
  to_currency   char(3) NOT NULL,
  rate_date     date NOT NULL,
  rate          numeric(20,8) NOT NULL CHECK (rate > 0),
  source        text NOT NULL DEFAULT 'manual',
  created_by    uuid REFERENCES app_users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT exchange_rates_pair CHECK (from_currency <> to_currency)
);
CREATE UNIQUE INDEX exchange_rates_unique_idx
  ON exchange_rates (company_id, from_currency, to_currency, rate_date);

-- ---------------------------------------------------------------------------
-- Supporting documents (justificatifs)
-- ---------------------------------------------------------------------------
CREATE TABLE attachments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  entry_id      uuid REFERENCES journal_entries(id) ON DELETE CASCADE,
  original_name text NOT NULL,
  stored_name   text NOT NULL,
  mime_type     text NOT NULL,
  size_bytes    integer NOT NULL CHECK (size_bytes >= 0),
  sha256        text NOT NULL,
  uploaded_by   uuid REFERENCES app_users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX attachments_entry_idx ON attachments (entry_id);

-- ---------------------------------------------------------------------------
-- Audit trail (sensitive operations)
-- ---------------------------------------------------------------------------
CREATE TABLE audit_log (
  id          bigserial PRIMARY KEY,
  company_id  uuid REFERENCES companies(id) ON DELETE SET NULL,
  user_id     uuid REFERENCES app_users(id) ON DELETE SET NULL,
  action      text NOT NULL,
  entity_type text NOT NULL,
  entity_id   text,
  details     jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip          text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_company_idx ON audit_log (company_id, created_at DESC);

CREATE TABLE login_attempts (
  id          bigserial PRIMARY KEY,
  email       text NOT NULL,
  ip          text,
  successful  boolean NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX login_attempts_email_idx ON login_attempts (lower(email), created_at DESC);
