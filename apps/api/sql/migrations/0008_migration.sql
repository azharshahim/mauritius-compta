-- ---------------------------------------------------------------------------
-- 0008_migration.sql - Accounting migration assistant (mission 8)
--
-- Additive and idempotent. Migrations 0001-0007 are untouched, no table is
-- dropped, no existing column rewritten. The accounting engine keeps its
-- behaviour: imported entries are written through the very same posting
-- service (`postEntryTx`), never through direct inserts of balances.
--
--  1. `journal_entries.source` accepts the two migration origins.
--  2. Migration jobs (one file + one target kind), their parsed uploads.
--  3. Saved column/account mappings per cabinet and per import kind.
--  4. Findings (errors, warnings, info), import batches and their report.
--  5. Idempotency ledger: a re-run of the same file can never duplicate a row.
--  6. Append-only migration events.
-- ---------------------------------------------------------------------------

ALTER TABLE journal_entries DROP CONSTRAINT IF EXISTS journal_entries_source_check;
ALTER TABLE journal_entries
  ADD CONSTRAINT journal_entries_source_check
  CHECK (source IN ('manual', 'reversal', 'opening', 'billing', 'ai', 'migration', 'migration_opening'));

CREATE TABLE IF NOT EXISTS migration_jobs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id       uuid NOT NULL REFERENCES cabinets(id) ON DELETE CASCADE,
  -- NULL only for a cabinet-level import of companies (no accounting data).
  company_id       uuid REFERENCES companies(id) ON DELETE CASCADE,
  created_by       uuid REFERENCES app_users(id) ON DELETE SET NULL,
  source           text NOT NULL
                     CHECK (source IN ('excel', 'csv', 'sage50', 'sage200', 'sage_accounting', 'sap', 'other')),
  import_kind      text NOT NULL
                     CHECK (import_kind IN ('chart_of_accounts', 'opening_balance', 'journal_entries', 'customers', 'companies')),
  status           text NOT NULL DEFAULT 'uploaded'
                     CHECK (status IN ('uploaded', 'analyzed', 'mapped', 'previewed', 'imported', 'failed', 'cancelled')),
  file_name        text NOT NULL,
  file_size        integer NOT NULL CHECK (file_size >= 0),
  file_hash        text NOT NULL,
  sheet_name       text,
  encoding         text,
  delimiter        text,
  row_count        integer NOT NULL DEFAULT 0 CHECK (row_count >= 0),
  idempotency_key  text NOT NULL,
  mapping          jsonb NOT NULL DEFAULT '{}'::jsonb,
  account_mapping  jsonb NOT NULL DEFAULT '{}'::jsonb,
  options          jsonb NOT NULL DEFAULT '{}'::jsonb,
  summary          jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS migration_jobs_cabinet_idx
  ON migration_jobs (cabinet_id, created_at DESC);
CREATE INDEX IF NOT EXISTS migration_jobs_company_idx
  ON migration_jobs (company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS migration_jobs_status_idx
  ON migration_jobs (cabinet_id, status);

-- Parsed content of the uploaded file, bounded and purged on a schedule.
CREATE TABLE IF NOT EXISTS migration_uploads (
  job_id        uuid PRIMARY KEY REFERENCES migration_jobs(id) ON DELETE CASCADE,
  sheets        jsonb NOT NULL,
  original_text text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS migration_uploads_expiry_idx ON migration_uploads (expires_at);

CREATE TABLE IF NOT EXISTS migration_templates (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id     uuid NOT NULL REFERENCES cabinets(id) ON DELETE CASCADE,
  name           text NOT NULL CHECK (btrim(name) <> ''),
  import_kind    text NOT NULL
                   CHECK (import_kind IN ('chart_of_accounts', 'opening_balance', 'journal_entries', 'customers', 'companies')),
  source         text NOT NULL
                   CHECK (source IN ('excel', 'csv', 'sage50', 'sage200', 'sage_accounting', 'sap', 'other')),
  mapping        jsonb NOT NULL DEFAULT '{}'::jsonb,
  account_mapping jsonb NOT NULL DEFAULT '{}'::jsonb,
  options        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by     uuid REFERENCES app_users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS migration_templates_name_idx
  ON migration_templates (cabinet_id, import_kind, lower(btrim(name)));

CREATE TABLE IF NOT EXISTS migration_findings (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id     uuid NOT NULL REFERENCES migration_jobs(id) ON DELETE CASCADE,
  company_id uuid REFERENCES companies(id) ON DELETE CASCADE,
  severity   text NOT NULL CHECK (severity IN ('error', 'warning', 'info')),
  code       text NOT NULL,
  row_number integer,
  message    text NOT NULL,
  details    jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS migration_findings_job_idx
  ON migration_findings (job_id, severity, row_number);

CREATE TABLE IF NOT EXISTS migration_batches (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id        uuid NOT NULL REFERENCES migration_jobs(id) ON DELETE CASCADE,
  company_id    uuid REFERENCES companies(id) ON DELETE CASCADE,
  status        text NOT NULL CHECK (status IN ('imported', 'failed')),
  created_count integer NOT NULL DEFAULT 0,
  skipped_count integer NOT NULL DEFAULT 0,
  error_count   integer NOT NULL DEFAULT 0,
  report        jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz
);
CREATE INDEX IF NOT EXISTS migration_batches_job_idx ON migration_batches (job_id);

-- Idempotency ledger. The unique key combines cabinet, company, source,
-- entity type, the stable source identifier and a content fingerprint: a rerun
-- of the same file cannot create a second row, and a *changed* row in the
-- source is reported as a conflict instead of being overwritten silently.
CREATE TABLE IF NOT EXISTS migration_records (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id   uuid NOT NULL REFERENCES cabinets(id) ON DELETE CASCADE,
  company_id   uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  job_id       uuid REFERENCES migration_jobs(id) ON DELETE SET NULL,
  source       text NOT NULL,
  entity_type  text NOT NULL
                 CHECK (entity_type IN ('account', 'entry', 'customer', 'company')),
  external_key text NOT NULL,
  content_hash text NOT NULL,
  entity_id    uuid,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS migration_records_idempotency_idx
  ON migration_records (cabinet_id, company_id, source, entity_type, external_key, content_hash);
CREATE INDEX IF NOT EXISTS migration_records_entity_idx
  ON migration_records (company_id, entity_type, external_key);

CREATE TABLE IF NOT EXISTS migration_events (
  id         bigserial PRIMARY KEY,
  job_id     uuid NOT NULL REFERENCES migration_jobs(id) ON DELETE CASCADE,
  company_id uuid REFERENCES companies(id) ON DELETE SET NULL,
  actor_id   uuid REFERENCES app_users(id) ON DELETE SET NULL,
  action     text NOT NULL,
  details    jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS migration_events_job_idx
  ON migration_events (job_id, created_at DESC);
