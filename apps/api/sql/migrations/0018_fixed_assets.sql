-- ---------------------------------------------------------------------------
-- 0018_fixed_assets.sql - Mission 20
--
-- Fixed asset register, depreciation engine and asset journal proposals.
--
-- Design notes:
-- * No Mauritian tax rate, capital allowance, useful life or account number is
--   encoded. Categories and accounts are configured per company.
-- * Every accounting entry is a proposal approved by a human, then posted
--   through the existing journal engine.
-- * Depreciation is computed with exact decimal arithmetic (numeric(20,4)).
-- * A posted depreciation line can never be posted twice for the same month.
-- ---------------------------------------------------------------------------

-- 1. Journal source ----------------------------------------------------------
ALTER TABLE journal_entries DROP CONSTRAINT IF EXISTS journal_entries_source_check;
ALTER TABLE journal_entries
  ADD CONSTRAINT journal_entries_source_check
  CHECK (source IN ('manual', 'reversal', 'opening', 'billing', 'purchase', 'ai',
                    'migration', 'migration_opening', 'fx', 'payroll',
                    'equity', 'closing', 'equity_allocation', 'asset'));

-- 2. Category configuration --------------------------------------------------
CREATE TABLE IF NOT EXISTS fixed_asset_categories (
  id                                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id                          uuid NOT NULL REFERENCES cabinets(id) ON DELETE CASCADE,
  company_id                          uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  code                                text NOT NULL,
  name_en                             text NOT NULL,
  name_fr                             text NOT NULL,
  is_depreciable                      boolean NOT NULL DEFAULT true,
  default_method                      text CHECK (default_method IN ('straight_line', 'reducing_balance')),
  default_useful_life_months          int CHECK (default_useful_life_months > 0),
  default_residual_value              numeric(20,4) CHECK (default_residual_value >= 0),
  default_reducing_rate               numeric(12,8) CHECK (default_reducing_rate > 0 AND default_reducing_rate <= 1),
  asset_account_id                    uuid REFERENCES accounts(id) ON DELETE RESTRICT,
  accumulated_depreciation_account_id uuid REFERENCES accounts(id) ON DELETE RESTRICT,
  depreciation_expense_account_id     uuid REFERENCES accounts(id) ON DELETE RESTRICT,
  accumulated_impairment_account_id   uuid REFERENCES accounts(id) ON DELETE RESTRICT,
  impairment_loss_account_id          uuid REFERENCES accounts(id) ON DELETE RESTRICT,
  impairment_reversal_account_id      uuid REFERENCES accounts(id) ON DELETE RESTRICT,
  disposal_gain_account_id            uuid REFERENCES accounts(id) ON DELETE RESTRICT,
  disposal_loss_account_id            uuid REFERENCES accounts(id) ON DELETE RESTRICT,
  cwip_account_id                     uuid REFERENCES accounts(id) ON DELETE RESTRICT,
  is_active                           boolean NOT NULL DEFAULT true,
  created_at                          timestamptz NOT NULL DEFAULT now(),
  updated_at                          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, code)
);
CREATE INDEX IF NOT EXISTS fixed_asset_categories_company_idx
  ON fixed_asset_categories (company_id, code);

-- 3. Asset numbers -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS fixed_asset_sequences (
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  year       int  NOT NULL,
  last_no    int  NOT NULL DEFAULT 0 CHECK (last_no >= 0),
  PRIMARY KEY (company_id, year)
);

-- 4. Asset register ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS fixed_assets (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id                uuid NOT NULL REFERENCES cabinets(id) ON DELETE CASCADE,
  company_id                uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  category_id               uuid NOT NULL REFERENCES fixed_asset_categories(id) ON DELETE RESTRICT,
  asset_code                text NOT NULL,
  description               text NOT NULL,
  serial_number             text,
  location                  text,
  acquisition_date          date NOT NULL,
  in_service_date           date,
  supplier_name             text,
  invoice_ref               text,
  document_ref              text,
  cost                      numeric(20,4) NOT NULL CHECK (cost > 0),
  attributable_costs        numeric(20,4) NOT NULL DEFAULT 0 CHECK (attributable_costs >= 0),
  residual_value            numeric(20,4) NOT NULL DEFAULT 0 CHECK (residual_value >= 0),
  currency                  text NOT NULL DEFAULT 'MUR',
  exchange_rate             numeric(20,8) NOT NULL DEFAULT 1 CHECK (exchange_rate > 0),
  fx_note                   text,
  method                    text CHECK (method IN ('straight_line', 'reducing_balance')),
  useful_life_months        int CHECK (useful_life_months > 0),
  reducing_rate             numeric(12,8) CHECK (reducing_rate > 0 AND reducing_rate <= 1),
  depreciation_start_date   date,
  depreciation_end_date     date,
  status                    text NOT NULL DEFAULT 'draft'
                            CHECK (status IN ('draft', 'in_service', 'suspended', 'disposed', 'written_off')),
  suspended_from            date,
  suspended_to              date,
  suspended_reason          text,
  responsible_user_id       uuid REFERENCES app_users(id) ON DELETE SET NULL,
  notes                     text,
  disposal_date             date,
  disposal_proceeds         numeric(20,4),
  disposal_costs            numeric(20,4),
  created_by                uuid REFERENCES app_users(id) ON DELETE SET NULL,
  updated_by                uuid REFERENCES app_users(id) ON DELETE SET NULL,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, asset_code),
  CONSTRAINT fixed_asset_date_order CHECK (in_service_date IS NULL OR in_service_date >= acquisition_date),
  CONSTRAINT fixed_asset_dep_dates CHECK (depreciation_end_date IS NULL OR depreciation_start_date IS NULL
                                          OR depreciation_end_date >= depreciation_start_date),
  CONSTRAINT fixed_asset_suspension_order CHECK (suspended_to IS NULL OR suspended_from IS NOT NULL
                                                 AND suspended_to >= suspended_from),
  CONSTRAINT fixed_asset_residual_cap CHECK (residual_value <= cost + attributable_costs)
);
CREATE INDEX IF NOT EXISTS fixed_assets_company_status_idx
  ON fixed_assets (company_id, status, acquisition_date DESC);
CREATE INDEX IF NOT EXISTS fixed_assets_company_category_idx
  ON fixed_assets (company_id, category_id);

-- 5. Estimate history (prospective revisions) --------------------------------
CREATE TABLE IF NOT EXISTS fixed_asset_estimates (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  asset_id           uuid NOT NULL REFERENCES fixed_assets(id) ON DELETE CASCADE,
  effective_from     date NOT NULL,
  method             text NOT NULL CHECK (method IN ('straight_line', 'reducing_balance')),
  useful_life_months int NOT NULL CHECK (useful_life_months > 0),
  residual_value     numeric(20,4) NOT NULL CHECK (residual_value >= 0),
  reducing_rate      numeric(12,8) CHECK (reducing_rate > 0 AND reducing_rate <= 1),
  reason             text NOT NULL,
  created_by         uuid REFERENCES app_users(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, asset_id, effective_from)
);
CREATE INDEX IF NOT EXISTS fixed_asset_estimates_asset_idx
  ON fixed_asset_estimates (asset_id, effective_from);

-- 6. Lifecycle / audit events ------------------------------------------------
CREATE TABLE IF NOT EXISTS fixed_asset_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  asset_id     uuid NOT NULL REFERENCES fixed_assets(id) ON DELETE CASCADE,
  event_type   text NOT NULL CHECK (event_type IN
               ('created', 'updated', 'activated', 'estimate_revised', 'suspended',
                'resumed', 'impairment', 'impairment_reversal', 'disposal',
                'written_off', 'reclassified', 'depreciation_posted')),
  event_date   date NOT NULL,
  reason       text,
  details      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by   uuid REFERENCES app_users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fixed_asset_events_asset_idx
  ON fixed_asset_events (asset_id, created_at DESC);

-- 7. Depreciation batches and monthly lines ----------------------------------
CREATE TABLE IF NOT EXISTS fixed_asset_depreciation_batches (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id    uuid NOT NULL REFERENCES cabinets(id) ON DELETE CASCADE,
  company_id    uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  reference     text NOT NULL,
  period_start  date NOT NULL,
  period_end    date NOT NULL,
  journal_id    uuid NOT NULL REFERENCES journals(id) ON DELETE RESTRICT,
  status        text NOT NULL DEFAULT 'DRAFT'
                CHECK (status IN ('DRAFT', 'APPROVED', 'POSTED', 'CANCELLED')),
  total_amount  numeric(20,4) NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
  checks        jsonb NOT NULL DEFAULT '[]'::jsonb,
  blockers      jsonb NOT NULL DEFAULT '[]'::jsonb,
  warnings      jsonb NOT NULL DEFAULT '[]'::jsonb,
  approval_note text,
  approved_by   uuid REFERENCES app_users(id) ON DELETE SET NULL,
  approved_at   timestamptz,
  entry_id      uuid UNIQUE REFERENCES journal_entries(id) ON DELETE RESTRICT,
  posted_at     timestamptz,
  created_by    uuid REFERENCES app_users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, reference),
  CONSTRAINT depreciation_batch_dates CHECK (period_end >= period_start)
);
CREATE INDEX IF NOT EXISTS depreciation_batches_company_idx
  ON fixed_asset_depreciation_batches (company_id, period_end DESC);

CREATE TABLE IF NOT EXISTS fixed_asset_depreciation_lines (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  batch_id       uuid NOT NULL REFERENCES fixed_asset_depreciation_batches(id) ON DELETE CASCADE,
  asset_id       uuid NOT NULL REFERENCES fixed_assets(id) ON DELETE RESTRICT,
  category_id    uuid NOT NULL REFERENCES fixed_asset_categories(id) ON DELETE RESTRICT,
  month_start    date NOT NULL,
  month_end      date NOT NULL,
  method         text NOT NULL CHECK (method IN ('straight_line', 'reducing_balance')),
  opening_nbv    numeric(20,4) NOT NULL,
  depreciable_base numeric(20,4) NOT NULL CHECK (depreciable_base >= 0),
  amount         numeric(20,4) NOT NULL CHECK (amount > 0),
  closing_nbv    numeric(20,4) NOT NULL,
  days_active    int NOT NULL CHECK (days_active > 0),
  days_in_month  int NOT NULL CHECK (days_in_month > 0),
  expense_account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  accumulated_account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  UNIQUE (batch_id, asset_id, month_start)
);
CREATE INDEX IF NOT EXISTS depreciation_lines_asset_idx
  ON fixed_asset_depreciation_lines (company_id, asset_id, month_start);

-- 8. Impairment history ------------------------------------------------------
CREATE TABLE IF NOT EXISTS fixed_asset_impairments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  asset_id      uuid NOT NULL REFERENCES fixed_assets(id) ON DELETE RESTRICT,
  impairment_date date NOT NULL,
  amount        numeric(20,4) NOT NULL CHECK (amount > 0),
  reason        text NOT NULL,
  is_reversal   boolean NOT NULL DEFAULT false,
  status        text NOT NULL DEFAULT 'DRAFT'
                CHECK (status IN ('DRAFT', 'APPROVED', 'POSTED', 'CANCELLED')),
  entry_id      uuid UNIQUE REFERENCES journal_entries(id) ON DELETE RESTRICT,
  created_by    uuid REFERENCES app_users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fixed_asset_impairments_asset_idx
  ON fixed_asset_impairments (asset_id, impairment_date);

-- 9. Human-approved journal proposals ---------------------------------------
CREATE TABLE IF NOT EXISTS fixed_asset_proposals (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id    uuid NOT NULL REFERENCES cabinets(id) ON DELETE CASCADE,
  company_id    uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  asset_id      uuid NOT NULL REFERENCES fixed_assets(id) ON DELETE RESTRICT,
  kind          text NOT NULL CHECK (kind IN
                ('acquisition', 'cwip', 'commissioning', 'depreciation',
                 'impairment', 'impairment_reversal', 'disposal', 'write_off',
                 'reclassification', 'estimate_revision')),
  event_date    date NOT NULL,
  reference     text NOT NULL,
  description   text NOT NULL,
  journal_id    uuid NOT NULL REFERENCES journals(id) ON DELETE RESTRICT,
  currency      text NOT NULL,
  exchange_rate numeric(20,8) NOT NULL DEFAULT 1,
  lines         jsonb NOT NULL DEFAULT '[]'::jsonb,
  checks        jsonb NOT NULL DEFAULT '[]'::jsonb,
  blockers      jsonb NOT NULL DEFAULT '[]'::jsonb,
  warnings      jsonb NOT NULL DEFAULT '[]'::jsonb,
  payload       jsonb NOT NULL DEFAULT '{}'::jsonb,
  status        text NOT NULL DEFAULT 'PROPOSED'
                CHECK (status IN ('PROPOSED', 'APPROVED', 'POSTED', 'REJECTED')),
  approval_note text,
  approved_by   uuid REFERENCES app_users(id) ON DELETE SET NULL,
  approved_at   timestamptz,
  rejection_reason text,
  entry_id      uuid UNIQUE REFERENCES journal_entries(id) ON DELETE RESTRICT,
  posted_at     timestamptz,
  created_by    uuid REFERENCES app_users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, reference)
);
CREATE INDEX IF NOT EXISTS fixed_asset_proposals_company_idx
  ON fixed_asset_proposals (company_id, event_date DESC);
CREATE INDEX IF NOT EXISTS fixed_asset_proposals_asset_idx
  ON fixed_asset_proposals (asset_id, created_at DESC);

-- 10. Tenant isolation -------------------------------------------------------
CREATE OR REPLACE FUNCTION mc_guard_fixed_asset_category() RETURNS trigger AS $$
DECLARE
  acc uuid;
BEGIN
  FOREACH acc IN ARRAY ARRAY[
    NEW.asset_account_id, NEW.accumulated_depreciation_account_id,
    NEW.depreciation_expense_account_id, NEW.accumulated_impairment_account_id,
    NEW.impairment_loss_account_id, NEW.impairment_reversal_account_id,
    NEW.disposal_gain_account_id, NEW.disposal_loss_account_id, NEW.cwip_account_id
  ] LOOP
    IF acc IS NOT NULL AND NOT EXISTS (SELECT 1 FROM accounts a
                                       WHERE a.id = acc AND a.company_id = NEW.company_id) THEN
      RAISE EXCEPTION 'FIXED_ASSET_CROSS_COMPANY_REFERENCE';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS fixed_asset_categories_guard_company ON fixed_asset_categories;
CREATE TRIGGER fixed_asset_categories_guard_company
  BEFORE INSERT OR UPDATE ON fixed_asset_categories
  FOR EACH ROW EXECUTE FUNCTION mc_guard_fixed_asset_category();

CREATE OR REPLACE FUNCTION mc_guard_fixed_asset() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM fixed_asset_categories c
                  WHERE c.id = NEW.category_id AND c.company_id = NEW.company_id) THEN
    RAISE EXCEPTION 'FIXED_ASSET_CROSS_COMPANY_REFERENCE';
  END IF;
  IF NEW.residual_value > NEW.cost + NEW.attributable_costs THEN
    RAISE EXCEPTION 'FIXED_ASSET_RESIDUAL_INVALID';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS fixed_assets_guard_company ON fixed_assets;
CREATE TRIGGER fixed_assets_guard_company
  BEFORE INSERT OR UPDATE ON fixed_assets
  FOR EACH ROW EXECUTE FUNCTION mc_guard_fixed_asset();

CREATE OR REPLACE FUNCTION mc_guard_depreciation_line() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM fixed_assets a
                  WHERE a.id = NEW.asset_id AND a.company_id = NEW.company_id) THEN
    RAISE EXCEPTION 'FIXED_ASSET_CROSS_COMPANY_REFERENCE';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM fixed_asset_depreciation_batches b
                  WHERE b.id = NEW.batch_id AND b.company_id = NEW.company_id) THEN
    RAISE EXCEPTION 'FIXED_ASSET_CROSS_COMPANY_REFERENCE';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM accounts a
                  WHERE a.id = NEW.expense_account_id AND a.company_id = NEW.company_id) THEN
    RAISE EXCEPTION 'FIXED_ASSET_CROSS_COMPANY_REFERENCE';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM accounts a
                  WHERE a.id = NEW.accumulated_account_id AND a.company_id = NEW.company_id) THEN
    RAISE EXCEPTION 'FIXED_ASSET_CROSS_COMPANY_REFERENCE';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS depreciation_lines_guard_company ON fixed_asset_depreciation_lines;
CREATE TRIGGER depreciation_lines_guard_company
  BEFORE INSERT OR UPDATE ON fixed_asset_depreciation_lines
  FOR EACH ROW EXECUTE FUNCTION mc_guard_depreciation_line();

CREATE OR REPLACE FUNCTION mc_guard_fixed_asset_proposal() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM fixed_assets a
                  WHERE a.id = NEW.asset_id AND a.company_id = NEW.company_id) THEN
    RAISE EXCEPTION 'FIXED_ASSET_CROSS_COMPANY_REFERENCE';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM journals j
                  WHERE j.id = NEW.journal_id AND j.company_id = NEW.company_id) THEN
    RAISE EXCEPTION 'FIXED_ASSET_CROSS_COMPANY_REFERENCE';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS fixed_asset_proposals_guard_company ON fixed_asset_proposals;
CREATE TRIGGER fixed_asset_proposals_guard_company
  BEFORE INSERT OR UPDATE ON fixed_asset_proposals
  FOR EACH ROW EXECUTE FUNCTION mc_guard_fixed_asset_proposal();

-- Overlapping posted months for one asset are refused by a trigger so that the
-- rule also holds when a real PostgreSQL server is used.
CREATE OR REPLACE FUNCTION mc_guard_depreciation_overlap() RETURNS trigger AS $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM fixed_asset_depreciation_lines l
      JOIN fixed_asset_depreciation_batches b ON b.id = l.batch_id
     WHERE l.asset_id = NEW.asset_id
       AND l.id <> NEW.id
       AND b.status = 'POSTED'
       AND daterange(l.month_start, l.month_end, '[]') && daterange(NEW.month_start, NEW.month_end, '[]')
  ) THEN
    RAISE EXCEPTION 'DEPRECIATION_DUPLICATE_PERIOD';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS depreciation_lines_no_overlap ON fixed_asset_depreciation_lines;
CREATE TRIGGER depreciation_lines_no_overlap
  BEFORE INSERT OR UPDATE ON fixed_asset_depreciation_lines
  FOR EACH ROW EXECUTE FUNCTION mc_guard_depreciation_overlap();

-- A batch cannot be posted when one of its months overlaps an already posted
-- month for the same asset.
CREATE OR REPLACE FUNCTION mc_guard_depreciation_batch_posting() RETURNS trigger AS $$
BEGIN
  IF NEW.status = 'POSTED' AND OLD.status <> 'POSTED' THEN
    IF EXISTS (
      SELECT 1
        FROM fixed_asset_depreciation_lines l
        JOIN fixed_asset_depreciation_batches b ON b.id = l.batch_id
       WHERE l.batch_id = NEW.id
         AND EXISTS (
           SELECT 1 FROM fixed_asset_depreciation_lines o
             JOIN fixed_asset_depreciation_batches ob ON ob.id = o.batch_id
            WHERE o.asset_id = l.asset_id
              AND ob.status = 'POSTED'
              AND daterange(o.month_start, o.month_end, '[]') && daterange(l.month_start, l.month_end, '[]')
         )
    ) THEN
      RAISE EXCEPTION 'DEPRECIATION_DUPLICATE_PERIOD';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS depreciation_batches_posting_guard ON fixed_asset_depreciation_batches;
CREATE TRIGGER depreciation_batches_posting_guard
  BEFORE UPDATE ON fixed_asset_depreciation_batches
  FOR EACH ROW EXECUTE FUNCTION mc_guard_depreciation_batch_posting();

-- 11. Immutability after posting ---------------------------------------------
CREATE OR REPLACE FUNCTION mc_fixed_asset_depreciation_immutable() RETURNS trigger AS $$
BEGIN
  IF OLD.status = 'POSTED' THEN
    RAISE EXCEPTION 'DEPRECIATION_POSTED_IMMUTABLE';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS depreciation_batches_immutable ON fixed_asset_depreciation_batches;
CREATE TRIGGER depreciation_batches_immutable
  BEFORE UPDATE OR DELETE ON fixed_asset_depreciation_batches
  FOR EACH ROW EXECUTE FUNCTION mc_fixed_asset_depreciation_immutable();

CREATE OR REPLACE FUNCTION mc_fixed_asset_proposal_immutable() RETURNS trigger AS $$
BEGIN
  IF OLD.status = 'POSTED' THEN
    RAISE EXCEPTION 'FIXED_ASSET_PROPOSAL_POSTED_IMMUTABLE';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS fixed_asset_proposals_immutable ON fixed_asset_proposals;
CREATE TRIGGER fixed_asset_proposals_immutable
  BEFORE UPDATE OR DELETE ON fixed_asset_proposals
  FOR EACH ROW EXECUTE FUNCTION mc_fixed_asset_proposal_immutable();

CREATE OR REPLACE FUNCTION mc_guard_depreciation_lines_locked() RETURNS trigger AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM fixed_asset_depreciation_batches b
              WHERE b.id = COALESCE(NEW.batch_id, OLD.batch_id) AND b.status = 'POSTED') THEN
    RAISE EXCEPTION 'DEPRECIATION_POSTED_IMMUTABLE';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS depreciation_lines_locked ON fixed_asset_depreciation_lines;
CREATE TRIGGER depreciation_lines_locked
  BEFORE INSERT OR UPDATE OR DELETE ON fixed_asset_depreciation_lines
  FOR EACH ROW EXECUTE FUNCTION mc_guard_depreciation_lines_locked();
