-- ---------------------------------------------------------------------------
-- 0019_financial_years_archives.sql — Mission 21
--
-- Financial-year opening balances, prior-year adjustments, year-end checklist
-- and immutable annual archives.
--
-- Design notes:
-- * The ledger is continuous: a balance exists because its posted lines exist.
--   No duplicate "opening entry" is created by the ordinary carry-forward.
--   An external opening batch is only allowed when no posted entry precedes
--   the destination period (initial data migration).
-- * No Mauritian retention period, legal form, tax treatment or accounting rule
--   is encoded. Every account and every period is chosen by the user.
-- * Archives are immutable snapshots with SHA-256 checksums. A ZIP download is
--   not presented as legally certified archiving.
-- ---------------------------------------------------------------------------

-- 1. Journal sources ----------------------------------------------------------
ALTER TABLE journal_entries DROP CONSTRAINT IF EXISTS journal_entries_source_check;
ALTER TABLE journal_entries
  ADD CONSTRAINT journal_entries_source_check
  CHECK (source IN ('manual', 'reversal', 'opening', 'billing', 'purchase', 'ai',
                    'migration', 'migration_opening', 'fx', 'payroll',
                    'equity', 'closing', 'equity_allocation', 'asset',
                    'prior_year_adjustment'));

-- 2. Company-level financial-year settings -----------------------------------
CREATE TABLE IF NOT EXISTS fiscal_year_settings (
  company_id          uuid PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  retention_months    integer CHECK (retention_months IS NULL OR retention_months > 0),
  retention_note      text,
  document_backup_note text,
  suspense_account_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_by          uuid REFERENCES app_users(id) ON DELETE SET NULL,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CHECK (jsonb_typeof(suspense_account_ids) = 'array')
);

-- 3. External opening balances (initial migration only) ----------------------
CREATE TABLE IF NOT EXISTS opening_balance_batches (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id         uuid NOT NULL REFERENCES cabinets(id) ON DELETE CASCADE,
  company_id         uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  period_id          uuid NOT NULL REFERENCES accounting_periods(id) ON DELETE RESTRICT,
  reference          text NOT NULL,
  source_reference   text NOT NULL,
  journal_id         uuid NOT NULL REFERENCES journals(id) ON DELETE RESTRICT,
  status             text NOT NULL DEFAULT 'DRAFT'
                       CHECK (status IN ('DRAFT', 'APPROVED', 'POSTED', 'CANCELLED')),
  total_debit        numeric(20,4) NOT NULL DEFAULT 0 CHECK (total_debit >= 0),
  total_credit       numeric(20,4) NOT NULL DEFAULT 0 CHECK (total_credit >= 0),
  notes              text,
  source_fingerprint text NOT NULL,
  entry_id           uuid UNIQUE REFERENCES journal_entries(id) ON DELETE RESTRICT,
  created_by         uuid REFERENCES app_users(id) ON DELETE SET NULL,
  approved_by        uuid REFERENCES app_users(id) ON DELETE SET NULL,
  approved_at        timestamptz,
  approval_note      text,
  posted_at          timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, period_id),
  UNIQUE (company_id, reference)
);
CREATE INDEX IF NOT EXISTS opening_balance_batches_company_idx
  ON opening_balance_batches (company_id, created_at DESC);

CREATE TABLE IF NOT EXISTS opening_balance_lines (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  batch_id    uuid NOT NULL REFERENCES opening_balance_batches(id) ON DELETE CASCADE,
  line_no     integer NOT NULL CHECK (line_no > 0),
  account_id  uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  debit       numeric(20,4) NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit      numeric(20,4) NOT NULL DEFAULT 0 CHECK (credit >= 0),
  description text,
  UNIQUE (batch_id, line_no),
  UNIQUE (batch_id, account_id),
  CHECK ((debit > 0 AND credit = 0) OR (credit > 0 AND debit = 0))
);
CREATE INDEX IF NOT EXISTS opening_balance_lines_batch_idx
  ON opening_balance_lines (batch_id, line_no);

-- 4. Prior-period adjustments ------------------------------------------------
CREATE TABLE IF NOT EXISTS prior_year_adjustments (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id            uuid NOT NULL REFERENCES cabinets(id) ON DELETE CASCADE,
  company_id            uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  adjustment_no         text NOT NULL,
  source_period_id      uuid NOT NULL REFERENCES accounting_periods(id) ON DELETE RESTRICT,
  adjustment_date       date NOT NULL,
  journal_id            uuid NOT NULL REFERENCES journals(id) ON DELETE RESTRICT,
  treatment             text NOT NULL
                          CHECK (treatment IN ('retained_earnings',
                                               'current_year_result', 'custom')),
  original_entry_id     uuid REFERENCES journal_entries(id) ON DELETE RESTRICT,
  original_reference    text NOT NULL,
  reason                text NOT NULL,
  document_ref          text NOT NULL,
  restates_comparatives boolean NOT NULL DEFAULT false,
  comparative_note      text,
  status                text NOT NULL DEFAULT 'PROPOSED'
                          CHECK (status IN ('PROPOSED', 'APPROVED', 'POSTED', 'REJECTED')),
  entry_id              uuid UNIQUE REFERENCES journal_entries(id) ON DELETE RESTRICT,
  created_by            uuid REFERENCES app_users(id) ON DELETE SET NULL,
  approved_by           uuid REFERENCES app_users(id) ON DELETE SET NULL,
  approved_at           timestamptz,
  approval_note         text,
  rejected_by           uuid REFERENCES app_users(id) ON DELETE SET NULL,
  rejected_at           timestamptz,
  rejection_reason      text,
  posted_at             timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, adjustment_no),
  CHECK (length(btrim(reason)) >= 10),
  CHECK (NOT restates_comparatives OR (comparative_note IS NOT NULL
                                       AND length(btrim(comparative_note)) >= 10))
);
CREATE INDEX IF NOT EXISTS prior_year_adjustments_company_idx
  ON prior_year_adjustments (company_id, adjustment_date DESC);

CREATE TABLE IF NOT EXISTS prior_year_adjustment_lines (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  adjustment_id uuid NOT NULL REFERENCES prior_year_adjustments(id) ON DELETE CASCADE,
  line_no       integer NOT NULL CHECK (line_no > 0),
  account_id    uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  description   text,
  debit         numeric(20,4) NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit        numeric(20,4) NOT NULL DEFAULT 0 CHECK (credit >= 0),
  UNIQUE (adjustment_id, line_no),
  CHECK ((debit > 0 AND credit = 0) OR (credit > 0 AND debit = 0))
);
CREATE INDEX IF NOT EXISTS prior_year_adjustment_lines_idx
  ON prior_year_adjustment_lines (adjustment_id, line_no);

-- 5. Year-end checklist runs -------------------------------------------------
CREATE TABLE IF NOT EXISTS year_end_checklists (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id  uuid NOT NULL REFERENCES cabinets(id) ON DELETE CASCADE,
  company_id  uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  period_id   uuid NOT NULL REFERENCES accounting_periods(id) ON DELETE RESTRICT,
  version     integer NOT NULL CHECK (version > 0),
  status      text NOT NULL DEFAULT 'GENERATED'
                CHECK (status IN ('GENERATED', 'REVIEWED')),
  items       jsonb NOT NULL,
  counts      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by  uuid REFERENCES app_users(id) ON DELETE SET NULL,
  reviewed_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  review_note text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, period_id, version)
);
CREATE INDEX IF NOT EXISTS year_end_checklists_company_idx
  ON year_end_checklists (company_id, period_id, version DESC);

-- 6. Immutable annual archives ----------------------------------------------
CREATE TABLE IF NOT EXISTS fiscal_archives (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id        uuid NOT NULL REFERENCES cabinets(id) ON DELETE CASCADE,
  company_id        uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  period_id         uuid NOT NULL REFERENCES accounting_periods(id) ON DELETE RESTRICT,
  version           integer NOT NULL CHECK (version > 0),
  status            text NOT NULL DEFAULT 'SEALED' CHECK (status = 'SEALED'),
  manifest          jsonb NOT NULL,
  snapshot          jsonb NOT NULL,
  checksum          text NOT NULL CHECK (length(checksum) = 64),
  size_bytes        integer NOT NULL CHECK (size_bytes >= 0),
  note              text,
  retention_months  integer CHECK (retention_months IS NULL OR retention_months > 0),
  retention_note    text,
  created_by        uuid REFERENCES app_users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, period_id, version)
);
CREATE INDEX IF NOT EXISTS fiscal_archives_company_idx
  ON fiscal_archives (company_id, period_id, version DESC);

CREATE OR REPLACE FUNCTION fiscal_archives_block_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'A sealed annual archive is immutable'
    USING ERRCODE = '23514';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS fiscal_archives_immutable ON fiscal_archives;
CREATE TRIGGER fiscal_archives_immutable
  BEFORE UPDATE OR DELETE ON fiscal_archives
  FOR EACH ROW EXECUTE FUNCTION fiscal_archives_block_change();

DROP TRIGGER IF EXISTS opening_batches_posted_immutable ON opening_balance_batches;
CREATE OR REPLACE FUNCTION opening_batches_block_posted_change() RETURNS trigger AS $$
BEGIN
  IF OLD.status = 'POSTED' THEN
    RAISE EXCEPTION 'A posted opening balance batch is immutable'
      USING ERRCODE = '23514';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER opening_batches_posted_immutable
  BEFORE UPDATE OR DELETE ON opening_balance_batches
  FOR EACH ROW EXECUTE FUNCTION opening_batches_block_posted_change();

DROP TRIGGER IF EXISTS prior_adjustments_posted_immutable ON prior_year_adjustments;
CREATE OR REPLACE FUNCTION prior_adjustments_block_posted_change() RETURNS trigger AS $$
BEGIN
  IF OLD.status = 'POSTED' THEN
    RAISE EXCEPTION 'A posted prior-year adjustment is immutable'
      USING ERRCODE = '23514';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER prior_adjustments_posted_immutable
  BEFORE UPDATE OR DELETE ON prior_year_adjustments
  FOR EACH ROW EXECUTE FUNCTION prior_adjustments_block_posted_change();

-- 7. Company isolation for child rows ---------------------------------------
CREATE OR REPLACE FUNCTION financial_year_child_company_check() RETURNS trigger AS $$
DECLARE
  parent_company uuid;
BEGIN
  IF TG_TABLE_NAME = 'opening_balance_lines' THEN
    SELECT company_id INTO parent_company FROM opening_balance_batches WHERE id = NEW.batch_id;
  ELSIF TG_TABLE_NAME = 'prior_year_adjustment_lines' THEN
    SELECT company_id INTO parent_company FROM prior_year_adjustments WHERE id = NEW.adjustment_id;
  END IF;
  IF parent_company IS NULL OR parent_company <> NEW.company_id THEN
    RAISE EXCEPTION 'Child row must belong to the same company as its parent'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS opening_balance_lines_company ON opening_balance_lines;
CREATE TRIGGER opening_balance_lines_company
  BEFORE INSERT OR UPDATE ON opening_balance_lines
  FOR EACH ROW EXECUTE FUNCTION financial_year_child_company_check();

DROP TRIGGER IF EXISTS prior_year_adjustment_lines_company ON prior_year_adjustment_lines;
CREATE TRIGGER prior_year_adjustment_lines_company
  BEFORE INSERT OR UPDATE ON prior_year_adjustment_lines
  FOR EACH ROW EXECUTE FUNCTION financial_year_child_company_check();
