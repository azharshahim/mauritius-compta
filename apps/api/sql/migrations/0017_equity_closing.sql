-- ---------------------------------------------------------------------------
-- 0017_equity_closing.sql - Mission 19
--
-- Equity movement register, annual closing and result allocation.
--
-- Design notes:
-- * No Mauritian account number, legal reserve percentage or tax treatment is
--   encoded here. Every account is chosen from the company's own chart.
-- * Closing and allocation entries are posted through the existing journal
--   engine. A human approval is required before any posting.
-- * A posted period is locked by accounting_periods (existing behaviour).
-- * No entry is created automatically by preparing a closing.
-- ---------------------------------------------------------------------------

-- 1. New journal sources -----------------------------------------------------
ALTER TABLE journal_entries DROP CONSTRAINT IF EXISTS journal_entries_source_check;
ALTER TABLE journal_entries
  ADD CONSTRAINT journal_entries_source_check
  CHECK (source IN ('manual', 'reversal', 'opening', 'billing', 'purchase', 'ai',
                    'migration', 'migration_opening', 'fx', 'payroll',
                    'equity', 'closing', 'equity_allocation'));

-- 2. Numbering for the equity register --------------------------------------
CREATE TABLE IF NOT EXISTS equity_sequences (
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  year       int  NOT NULL,
  last_no    int  NOT NULL DEFAULT 0 CHECK (last_no >= 0),
  PRIMARY KEY (company_id, year)
);

-- 3. Equity movement register ------------------------------------------------
CREATE TABLE IF NOT EXISTS equity_movements (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id               uuid NOT NULL REFERENCES cabinets(id) ON DELETE CASCADE,
  company_id               uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  movement_no              text NOT NULL,
  movement_date            date NOT NULL,
  category                 text NOT NULL
                           CHECK (category IN ('capital', 'contribution', 'reserve',
                                               'retained_earnings', 'dividend', 'adjustment')),
  direction                text NOT NULL CHECK (direction IN ('increase', 'decrease')),
  amount                   numeric(20,4) NOT NULL CHECK (amount > 0),
  equity_account_id        uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  counterpart_account_id   uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  journal_id               uuid NOT NULL REFERENCES journals(id) ON DELETE RESTRICT,
  description              text NOT NULL,
  document_ref             text NOT NULL,
  status                   text NOT NULL DEFAULT 'DRAFT'
                           CHECK (status IN ('DRAFT', 'APPROVED', 'POSTED', 'CANCELLED')),
  approved_by              uuid REFERENCES app_users(id) ON DELETE SET NULL,
  approved_at              timestamptz,
  approval_note            text,
  entry_id                 uuid UNIQUE REFERENCES journal_entries(id) ON DELETE RESTRICT,
  created_by               uuid REFERENCES app_users(id) ON DELETE SET NULL,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, movement_no),
  UNIQUE (company_id, document_ref)
);
CREATE INDEX IF NOT EXISTS equity_movements_company_date_idx
  ON equity_movements (company_id, movement_date, movement_no);
CREATE INDEX IF NOT EXISTS equity_movements_company_status_idx
  ON equity_movements (company_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS equity_movements_entry_idx
  ON equity_movements (entry_id) WHERE entry_id IS NOT NULL;

-- An equity movement may only reference accounts, a journal and a company that
-- all belong to the same company.
CREATE OR REPLACE FUNCTION mc_guard_equity_movement() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM journals j
                  WHERE j.id = NEW.journal_id AND j.company_id = NEW.company_id) THEN
    RAISE EXCEPTION 'EQUITY_CROSS_COMPANY_REFERENCE';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM accounts a
                  WHERE a.id = NEW.equity_account_id AND a.company_id = NEW.company_id) THEN
    RAISE EXCEPTION 'EQUITY_CROSS_COMPANY_REFERENCE';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM accounts a
                  WHERE a.id = NEW.counterpart_account_id AND a.company_id = NEW.company_id) THEN
    RAISE EXCEPTION 'EQUITY_CROSS_COMPANY_REFERENCE';
  END IF;
  IF (SELECT type FROM accounts WHERE id = NEW.equity_account_id) <> 'equity' THEN
    RAISE EXCEPTION 'EQUITY_ACCOUNT_NOT_EQUITY';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS equity_movements_guard_company ON equity_movements;
CREATE TRIGGER equity_movements_guard_company
  BEFORE INSERT OR UPDATE ON equity_movements
  FOR EACH ROW EXECUTE FUNCTION mc_guard_equity_movement();

-- A posted equity movement is immutable.
CREATE OR REPLACE FUNCTION mc_equity_movement_immutable() RETURNS trigger AS $$
BEGIN
  IF OLD.status = 'POSTED' THEN
    RAISE EXCEPTION 'EQUITY_POSTED_IMMUTABLE';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS equity_movements_immutable ON equity_movements;
CREATE TRIGGER equity_movements_immutable
  BEFORE UPDATE OR DELETE ON equity_movements
  FOR EACH ROW EXECUTE FUNCTION mc_equity_movement_immutable();

-- 4. Annual closings ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS fiscal_closings (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id         uuid NOT NULL REFERENCES cabinets(id) ON DELETE CASCADE,
  company_id         uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  source_period_id   uuid NOT NULL REFERENCES accounting_periods(id) ON DELETE RESTRICT,
  source_start       date NOT NULL,
  source_end         date NOT NULL,
  version            int NOT NULL CHECK (version > 0),
  journal_id         uuid NOT NULL REFERENCES journals(id) ON DELETE RESTRICT,
  result_account_id  uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  next_start_date    date NOT NULL,
  next_end_date      date NOT NULL,
  next_period_id     uuid REFERENCES accounting_periods(id) ON DELETE SET NULL,
  result_amount      numeric(20,4) NOT NULL DEFAULT 0, -- positive profit, negative loss
  status             text NOT NULL DEFAULT 'DRAFT'
                     CHECK (status IN ('DRAFT', 'REVIEW_REQUIRED', 'BLOCKED',
                                       'APPROVED', 'REJECTED', 'POSTED')),
  checks             jsonb NOT NULL DEFAULT '[]'::jsonb,
  blockers           jsonb NOT NULL DEFAULT '[]'::jsonb,
  warnings           jsonb NOT NULL DEFAULT '[]'::jsonb,
  lines              jsonb NOT NULL DEFAULT '[]'::jsonb,
  source_fingerprint text NOT NULL,
  prepared_by        uuid REFERENCES app_users(id) ON DELETE SET NULL,
  prepared_at        timestamptz NOT NULL DEFAULT now(),
  decided_by         uuid REFERENCES app_users(id) ON DELETE SET NULL,
  decided_at         timestamptz,
  decision_note      text,
  rejection_reason   text,
  closing_entry_id   uuid UNIQUE REFERENCES journal_entries(id) ON DELETE RESTRICT,
  posted_at          timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, source_period_id, version),
  CONSTRAINT closing_date_order CHECK (next_end_date >= next_start_date),
  CONSTRAINT closing_dates_after_source CHECK (next_start_date > source_end),
  CONSTRAINT closing_source_order CHECK (source_end >= source_start)
);
CREATE INDEX IF NOT EXISTS fiscal_closings_company_idx
  ON fiscal_closings (company_id, source_end DESC, version DESC);
CREATE UNIQUE INDEX IF NOT EXISTS fiscal_closings_one_posted_idx
  ON fiscal_closings (company_id, source_period_id) WHERE status = 'POSTED';

CREATE OR REPLACE FUNCTION mc_guard_fiscal_closing() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM accounting_periods p
                  WHERE p.id = NEW.source_period_id AND p.company_id = NEW.company_id) THEN
    RAISE EXCEPTION 'CLOSING_CROSS_COMPANY_REFERENCE';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM journals j
                  WHERE j.id = NEW.journal_id AND j.company_id = NEW.company_id) THEN
    RAISE EXCEPTION 'CLOSING_CROSS_COMPANY_REFERENCE';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM accounts a
                  WHERE a.id = NEW.result_account_id AND a.company_id = NEW.company_id) THEN
    RAISE EXCEPTION 'CLOSING_CROSS_COMPANY_REFERENCE';
  END IF;
  IF (SELECT type FROM accounts WHERE id = NEW.result_account_id) <> 'equity' THEN
    RAISE EXCEPTION 'CLOSING_RESULT_ACCOUNT_NOT_EQUITY';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS fiscal_closings_guard_company ON fiscal_closings;
CREATE TRIGGER fiscal_closings_guard_company
  BEFORE INSERT OR UPDATE ON fiscal_closings
  FOR EACH ROW EXECUTE FUNCTION mc_guard_fiscal_closing();

CREATE OR REPLACE FUNCTION mc_fiscal_closing_immutable() RETURNS trigger AS $$
BEGIN
  IF OLD.status = 'POSTED' THEN
    RAISE EXCEPTION 'CLOSING_POSTED_IMMUTABLE';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS fiscal_closings_immutable ON fiscal_closings;
CREATE TRIGGER fiscal_closings_immutable
  BEFORE UPDATE OR DELETE ON fiscal_closings
  FOR EACH ROW EXECUTE FUNCTION mc_fiscal_closing_immutable();

-- 5. Documented result allocation -------------------------------------------
CREATE TABLE IF NOT EXISTS equity_allocations (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id        uuid NOT NULL REFERENCES cabinets(id) ON DELETE CASCADE,
  company_id        uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  closing_id        uuid NOT NULL UNIQUE REFERENCES fiscal_closings(id) ON DELETE RESTRICT,
  allocation_date   date NOT NULL,
  journal_id        uuid NOT NULL REFERENCES journals(id) ON DELETE RESTRICT,
  document_ref      text NOT NULL,
  decision_date     date NOT NULL,
  note              text NOT NULL,
  result_amount     numeric(20,4) NOT NULL,
  allocated_amount  numeric(20,4) NOT NULL DEFAULT 0 CHECK (allocated_amount >= 0),
  status            text NOT NULL DEFAULT 'DRAFT'
                    CHECK (status IN ('DRAFT', 'APPROVED', 'POSTED', 'REJECTED')),
  approved_by       uuid REFERENCES app_users(id) ON DELETE SET NULL,
  approved_at       timestamptz,
  approval_note     text,
  entry_id          uuid UNIQUE REFERENCES journal_entries(id) ON DELETE RESTRICT,
  created_by        uuid REFERENCES app_users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, document_ref)
);
CREATE INDEX IF NOT EXISTS equity_allocations_company_idx
  ON equity_allocations (company_id, allocation_date DESC);

CREATE TABLE IF NOT EXISTS equity_allocation_lines (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  allocation_id uuid NOT NULL REFERENCES equity_allocations(id) ON DELETE CASCADE,
  company_id    uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  line_no       int NOT NULL CHECK (line_no > 0),
  nature        text NOT NULL
                CHECK (nature IN ('retained_earnings', 'reserves', 'dividends', 'other')),
  account_id    uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  amount        numeric(20,4) NOT NULL CHECK (amount > 0),
  UNIQUE (allocation_id, line_no),
  UNIQUE (allocation_id, account_id)
);
CREATE INDEX IF NOT EXISTS equity_allocation_lines_allocation_idx
  ON equity_allocation_lines (allocation_id, line_no);

CREATE OR REPLACE FUNCTION mc_guard_equity_allocation() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM fiscal_closings c
                  WHERE c.id = NEW.closing_id AND c.company_id = NEW.company_id) THEN
    RAISE EXCEPTION 'ALLOCATION_CROSS_COMPANY_REFERENCE';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM journals j
                  WHERE j.id = NEW.journal_id AND j.company_id = NEW.company_id) THEN
    RAISE EXCEPTION 'ALLOCATION_CROSS_COMPANY_REFERENCE';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS equity_allocations_guard_company ON equity_allocations;
CREATE TRIGGER equity_allocations_guard_company
  BEFORE INSERT OR UPDATE ON equity_allocations
  FOR EACH ROW EXECUTE FUNCTION mc_guard_equity_allocation();

CREATE OR REPLACE FUNCTION mc_guard_equity_allocation_line() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM equity_allocations a
                  WHERE a.id = NEW.allocation_id AND a.company_id = NEW.company_id) THEN
    RAISE EXCEPTION 'ALLOCATION_CROSS_COMPANY_REFERENCE';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM accounts a
                  WHERE a.id = NEW.account_id AND a.company_id = NEW.company_id) THEN
    RAISE EXCEPTION 'ALLOCATION_CROSS_COMPANY_REFERENCE';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS equity_allocation_lines_guard_company ON equity_allocation_lines;
CREATE TRIGGER equity_allocation_lines_guard_company
  BEFORE INSERT OR UPDATE ON equity_allocation_lines
  FOR EACH ROW EXECUTE FUNCTION mc_guard_equity_allocation_line();

CREATE OR REPLACE FUNCTION mc_equity_allocation_immutable() RETURNS trigger AS $$
BEGIN
  IF OLD.status = 'POSTED' THEN
    RAISE EXCEPTION 'ALLOCATION_POSTED_IMMUTABLE';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS equity_allocations_immutable ON equity_allocations;
CREATE TRIGGER equity_allocations_immutable
  BEFORE UPDATE OR DELETE ON equity_allocations
  FOR EACH ROW EXECUTE FUNCTION mc_equity_allocation_immutable();

CREATE OR REPLACE FUNCTION mc_guard_equity_allocation_lines_locked() RETURNS trigger AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM equity_allocations a
              WHERE a.id = COALESCE(NEW.allocation_id, OLD.allocation_id)
                AND a.status = 'POSTED') THEN
    RAISE EXCEPTION 'ALLOCATION_POSTED_IMMUTABLE';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS equity_allocation_lines_locked ON equity_allocation_lines;
CREATE TRIGGER equity_allocation_lines_locked
  BEFORE INSERT OR UPDATE OR DELETE ON equity_allocation_lines
  FOR EACH ROW EXECUTE FUNCTION mc_guard_equity_allocation_lines_locked();
