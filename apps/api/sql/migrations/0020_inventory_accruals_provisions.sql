-- ---------------------------------------------------------------------------
-- 0020_inventory_accruals_provisions.sql — Mission 22
--
-- Inventory subledger (FIFO and weighted average), accruals / prepayments /
-- deferred income schedules, and a controlled provisions register.
--
-- Design notes:
-- * No Mauritian tax rate, statutory valuation rule or IFRS requirement is
--   encoded. Accounts, valuation method and treatment are chosen by the user.
-- * Inventory quantities and values are numeric(20,4); application arithmetic
--   is exact integer/decimal, never floating point.
-- * A movement is proposed first, approved by a human, then posted. Posting is
--   an explicit action and creates one journal entry through the shared engine.
-- * Closed periods cannot be posted into (enforced by the entry engine).
-- ---------------------------------------------------------------------------

-- 1. Journal sources ---------------------------------------------------------
ALTER TABLE journal_entries DROP CONSTRAINT IF EXISTS journal_entries_source_check;
ALTER TABLE journal_entries
  ADD CONSTRAINT journal_entries_source_check
  CHECK (source IN ('manual', 'reversal', 'opening', 'billing', 'purchase', 'ai',
                    'migration', 'migration_opening', 'fx', 'payroll',
                    'equity', 'closing', 'equity_allocation', 'asset',
                    'prior_year_adjustment', 'inventory', 'accrual', 'provision'));

-- 2. Inventory ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS inventory_categories (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id              uuid NOT NULL REFERENCES cabinets(id) ON DELETE CASCADE,
  company_id              uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  code                    text NOT NULL,
  name                    text NOT NULL,
  valuation_method        text NOT NULL DEFAULT 'weighted_average'
                            CHECK (valuation_method IN ('fifo', 'weighted_average')),
  inventory_account_id    uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  cogs_account_id         uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  adjustment_account_id   uuid REFERENCES accounts(id) ON DELETE RESTRICT,
  write_down_account_id   uuid REFERENCES accounts(id) ON DELETE RESTRICT,
  allow_negative_stock    boolean NOT NULL DEFAULT false,
  is_active               boolean NOT NULL DEFAULT true,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, code)
);

CREATE TABLE IF NOT EXISTS inventory_locations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id  uuid NOT NULL REFERENCES cabinets(id) ON DELETE CASCADE,
  company_id  uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  code        text NOT NULL,
  name        text NOT NULL,
  description text,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, code)
);

CREATE TABLE IF NOT EXISTS inventory_items (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id     uuid NOT NULL REFERENCES cabinets(id) ON DELETE CASCADE,
  company_id     uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  category_id    uuid NOT NULL REFERENCES inventory_categories(id) ON DELETE RESTRICT,
  sku            text NOT NULL,
  name           text NOT NULL,
  unit           text NOT NULL DEFAULT 'unit',
  reorder_level  numeric(20,4) CHECK (reorder_level IS NULL OR reorder_level >= 0),
  is_active      boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, sku)
);

CREATE TABLE IF NOT EXISTS inventory_balances (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id  uuid NOT NULL REFERENCES cabinets(id) ON DELETE CASCADE,
  company_id  uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  item_id     uuid NOT NULL REFERENCES inventory_items(id) ON DELETE RESTRICT,
  location_id uuid NOT NULL REFERENCES inventory_locations(id) ON DELETE RESTRICT,
  quantity    numeric(20,4) NOT NULL DEFAULT 0,
  value       numeric(20,4) NOT NULL DEFAULT 0,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (item_id, location_id)
);

CREATE TABLE IF NOT EXISTS inventory_lots (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id            uuid NOT NULL REFERENCES cabinets(id) ON DELETE CASCADE,
  company_id            uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  item_id               uuid NOT NULL REFERENCES inventory_items(id) ON DELETE RESTRICT,
  location_id           uuid NOT NULL REFERENCES inventory_locations(id) ON DELETE RESTRICT,
  received_date         date NOT NULL,
  unit_cost             numeric(20,4) NOT NULL CHECK (unit_cost >= 0),
  original_quantity     numeric(20,4) NOT NULL CHECK (original_quantity > 0),
  remaining_quantity    numeric(20,4) NOT NULL CHECK (remaining_quantity >= 0),
  source_movement_id    uuid,
  created_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS inventory_lots_fifo_idx
  ON inventory_lots (company_id, item_id, location_id, received_date, created_at);

CREATE TABLE IF NOT EXISTS inventory_movements (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id              uuid NOT NULL REFERENCES cabinets(id) ON DELETE CASCADE,
  company_id              uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  item_id                 uuid NOT NULL REFERENCES inventory_items(id) ON DELETE RESTRICT,
  location_id             uuid NOT NULL REFERENCES inventory_locations(id) ON DELETE RESTRICT,
  destination_location_id uuid REFERENCES inventory_locations(id) ON DELETE RESTRICT,
  movement_no             text NOT NULL,
  movement_date           date NOT NULL,
  direction               text NOT NULL
                            CHECK (direction IN ('in', 'out', 'transfer_in', 'transfer_out',
                                                 'adjustment_in', 'adjustment_out')),
  source_kind             text NOT NULL
                            CHECK (source_kind IN ('opening', 'receipt', 'issue', 'adjustment',
                                                   'count', 'transfer', 'write_down', 'reversal')),
  quantity                numeric(20,4) NOT NULL CHECK (quantity > 0),
  unit_cost               numeric(20,4) CHECK (unit_cost IS NULL OR unit_cost >= 0),
  value                   numeric(20,4) CHECK (value IS NULL OR value >= 0),
  valuation_method        text CHECK (valuation_method IS NULL OR valuation_method IN ('fifo', 'weighted_average')),
  reference               text,
  description             text NOT NULL,
  document_ref            text,
  journal_id              uuid NOT NULL REFERENCES journals(id) ON DELETE RESTRICT,
  inventory_account_id    uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  counterpart_account_id  uuid REFERENCES accounts(id) ON DELETE RESTRICT,
  transfer_group_id       uuid,
  status                  text NOT NULL DEFAULT 'PROPOSED'
                            CHECK (status IN ('PROPOSED', 'APPROVED', 'POSTED', 'REJECTED')),
  entry_id                uuid UNIQUE REFERENCES journal_entries(id) ON DELETE RESTRICT,
  approval_note           text,
  approved_by             uuid REFERENCES app_users(id) ON DELETE SET NULL,
  approved_at             timestamptz,
  rejection_reason        text,
  posted_at               timestamptz,
  created_by              uuid REFERENCES app_users(id) ON DELETE SET NULL,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, movement_no)
);
CREATE INDEX IF NOT EXISTS inventory_movements_company_idx
  ON inventory_movements (company_id, movement_date DESC, movement_no DESC);

CREATE TABLE IF NOT EXISTS inventory_lot_allocations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  movement_id   uuid NOT NULL REFERENCES inventory_movements(id) ON DELETE CASCADE,
  lot_id        uuid NOT NULL REFERENCES inventory_lots(id) ON DELETE RESTRICT,
  quantity      numeric(20,4) NOT NULL CHECK (quantity > 0),
  unit_cost     numeric(20,4) NOT NULL CHECK (unit_cost >= 0),
  value         numeric(20,4) NOT NULL CHECK (value >= 0),
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (movement_id, lot_id)
);

CREATE TABLE IF NOT EXISTS inventory_counts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id    uuid NOT NULL REFERENCES cabinets(id) ON DELETE CASCADE,
  company_id    uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  location_id   uuid NOT NULL REFERENCES inventory_locations(id) ON DELETE RESTRICT,
  count_no      text NOT NULL,
  count_date    date NOT NULL,
  reference     text,
  notes         text,
  status        text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'POSTED', 'CANCELLED')),
  created_by    uuid REFERENCES app_users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, count_no)
);

CREATE TABLE IF NOT EXISTS inventory_count_lines (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  count_id       uuid NOT NULL REFERENCES inventory_counts(id) ON DELETE CASCADE,
  item_id        uuid NOT NULL REFERENCES inventory_items(id) ON DELETE RESTRICT,
  counted_quantity numeric(20,4) NOT NULL CHECK (counted_quantity >= 0),
  system_quantity  numeric(20,4) NOT NULL,
  difference       numeric(20,4) NOT NULL,
  unit_cost        numeric(20,4),
  movement_id      uuid REFERENCES inventory_movements(id) ON DELETE RESTRICT,
  UNIQUE (count_id, item_id)
);

CREATE TABLE IF NOT EXISTS inventory_write_downs (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id             uuid NOT NULL REFERENCES cabinets(id) ON DELETE CASCADE,
  company_id             uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  item_id                uuid NOT NULL REFERENCES inventory_items(id) ON DELETE RESTRICT,
  location_id            uuid NOT NULL REFERENCES inventory_locations(id) ON DELETE RESTRICT,
  write_down_no          text NOT NULL,
  kind                   text NOT NULL DEFAULT 'write_down' CHECK (kind IN ('write_down', 'reversal')),
  reverses_id            uuid REFERENCES inventory_write_downs(id) ON DELETE RESTRICT,
  write_down_date        date NOT NULL,
  amount                 numeric(20,4) NOT NULL CHECK (amount > 0),
  reason                 text NOT NULL,
  document_ref           text NOT NULL,
  journal_id             uuid NOT NULL REFERENCES journals(id) ON DELETE RESTRICT,
  inventory_account_id   uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  write_down_account_id  uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  status                 text NOT NULL DEFAULT 'PROPOSED'
                           CHECK (status IN ('PROPOSED', 'APPROVED', 'POSTED', 'REJECTED')),
  entry_id               uuid UNIQUE REFERENCES journal_entries(id) ON DELETE RESTRICT,
  approval_note          text,
  approved_by            uuid REFERENCES app_users(id) ON DELETE SET NULL,
  approved_at            timestamptz,
  rejection_reason       text,
  posted_at              timestamptz,
  created_by             uuid REFERENCES app_users(id) ON DELETE SET NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, write_down_no)
);

-- 3. Accruals, prepayments and deferred income -------------------------------
CREATE TABLE IF NOT EXISTS accrual_schedules (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id           uuid NOT NULL REFERENCES cabinets(id) ON DELETE CASCADE,
  company_id           uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  reference            text NOT NULL,
  kind                 text NOT NULL
                         CHECK (kind IN ('accrued_expense', 'accrued_income',
                                         'prepaid_expense', 'deferred_income')),
  description          text NOT NULL,
  counterparty         text,
  document_ref         text NOT NULL,
  pnl_account_id       uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  balance_account_id   uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  journal_id           uuid NOT NULL REFERENCES journals(id) ON DELETE RESTRICT,
  total_amount         numeric(20,4) NOT NULL CHECK (total_amount > 0),
  start_date           date NOT NULL,
  end_date             date NOT NULL,
  months               integer NOT NULL CHECK (months > 0 AND months <= 120),
  status               text NOT NULL DEFAULT 'DRAFT'
                         CHECK (status IN ('DRAFT', 'APPROVED', 'ACTIVE', 'COMPLETED', 'CANCELLED')),
  notes                text,
  created_by           uuid REFERENCES app_users(id) ON DELETE SET NULL,
  approved_by          uuid REFERENCES app_users(id) ON DELETE SET NULL,
  approved_at          timestamptz,
  approval_note        text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date),
  UNIQUE (company_id, reference)
);

CREATE TABLE IF NOT EXISTS accrual_schedule_lines (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  schedule_id        uuid NOT NULL REFERENCES accrual_schedules(id) ON DELETE CASCADE,
  line_no            integer NOT NULL CHECK (line_no > 0),
  period_start       date NOT NULL,
  period_end         date NOT NULL,
  amount             numeric(20,4) NOT NULL CHECK (amount > 0),
  status             text NOT NULL DEFAULT 'PENDING'
                       CHECK (status IN ('PENDING', 'POSTED', 'REVERSED')),
  entry_id           uuid UNIQUE REFERENCES journal_entries(id) ON DELETE RESTRICT,
  reversal_entry_id  uuid UNIQUE REFERENCES journal_entries(id) ON DELETE RESTRICT,
  posted_at          timestamptz,
  reversed_at        timestamptz,
  UNIQUE (schedule_id, line_no),
  CHECK (period_end >= period_start)
);
CREATE INDEX IF NOT EXISTS accrual_lines_company_idx ON accrual_schedule_lines (company_id, period_end);

-- 4. Provisions --------------------------------------------------------------
CREATE TABLE IF NOT EXISTS provisions (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id            uuid NOT NULL REFERENCES cabinets(id) ON DELETE CASCADE,
  company_id            uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  provision_no          text NOT NULL,
  category              text NOT NULL
                          CHECK (category IN ('litigation', 'warranty', 'restructuring', 'other')),
  description           text NOT NULL,
  evidence_ref          text NOT NULL,
  recognition_date      date NOT NULL,
  measurement_basis     text NOT NULL,
  expense_account_id    uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  provision_account_id  uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  current_portion       numeric(20,4) NOT NULL DEFAULT 0 CHECK (current_portion >= 0),
  non_current_portion   numeric(20,4) NOT NULL DEFAULT 0 CHECK (non_current_portion >= 0),
  status                text NOT NULL DEFAULT 'DRAFT'
                          CHECK (status IN ('DRAFT', 'ACTIVE', 'REVERSED', 'CLOSED')),
  created_by            uuid REFERENCES app_users(id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, provision_no)
);

CREATE TABLE IF NOT EXISTS provision_movements (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id     uuid NOT NULL REFERENCES cabinets(id) ON DELETE CASCADE,
  company_id     uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  provision_id   uuid NOT NULL REFERENCES provisions(id) ON DELETE RESTRICT,
  movement_no    text NOT NULL,
  movement_type  text NOT NULL
                   CHECK (movement_type IN ('recognition', 'revision', 'utilisation', 'reversal')),
  movement_date  date NOT NULL,
  amount         numeric(20,4) NOT NULL CHECK (amount > 0),
  direction      text NOT NULL CHECK (direction IN ('increase', 'decrease')),
  reason         text NOT NULL,
  document_ref   text NOT NULL,
  journal_id     uuid NOT NULL REFERENCES journals(id) ON DELETE RESTRICT,
  counterpart_account_id uuid REFERENCES accounts(id) ON DELETE RESTRICT,
  status         text NOT NULL DEFAULT 'PROPOSED'
                   CHECK (status IN ('PROPOSED', 'APPROVED', 'POSTED', 'REJECTED')),
  entry_id       uuid UNIQUE REFERENCES journal_entries(id) ON DELETE RESTRICT,
  approval_note  text,
  approved_by    uuid REFERENCES app_users(id) ON DELETE SET NULL,
  approved_at    timestamptz,
  rejection_reason text,
  posted_at      timestamptz,
  created_by     uuid REFERENCES app_users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, movement_no)
);

-- 5. Isolation and immutability ---------------------------------------------
CREATE OR REPLACE FUNCTION mission22_child_company_check() RETURNS trigger AS $$
DECLARE parent_company uuid;
BEGIN
  IF TG_TABLE_NAME = 'inventory_lot_allocations' THEN
    SELECT company_id INTO parent_company FROM inventory_movements WHERE id = NEW.movement_id;
  ELSIF TG_TABLE_NAME = 'inventory_count_lines' THEN
    SELECT company_id INTO parent_company FROM inventory_counts WHERE id = NEW.count_id;
  ELSIF TG_TABLE_NAME = 'accrual_schedule_lines' THEN
    SELECT company_id INTO parent_company FROM accrual_schedules WHERE id = NEW.schedule_id;
  ELSIF TG_TABLE_NAME = 'provision_movements' THEN
    SELECT company_id INTO parent_company FROM provisions WHERE id = NEW.provision_id;
  END IF;
  IF parent_company IS NULL OR parent_company <> NEW.company_id THEN
    RAISE EXCEPTION 'Child row must belong to the same company as its parent'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS inventory_lot_allocations_company ON inventory_lot_allocations;
CREATE TRIGGER inventory_lot_allocations_company
  BEFORE INSERT OR UPDATE ON inventory_lot_allocations
  FOR EACH ROW EXECUTE FUNCTION mission22_child_company_check();

DROP TRIGGER IF EXISTS inventory_count_lines_company ON inventory_count_lines;
CREATE TRIGGER inventory_count_lines_company
  BEFORE INSERT OR UPDATE ON inventory_count_lines
  FOR EACH ROW EXECUTE FUNCTION mission22_child_company_check();

DROP TRIGGER IF EXISTS accrual_schedule_lines_company ON accrual_schedule_lines;
CREATE TRIGGER accrual_schedule_lines_company
  BEFORE INSERT OR UPDATE ON accrual_schedule_lines
  FOR EACH ROW EXECUTE FUNCTION mission22_child_company_check();

DROP TRIGGER IF EXISTS provision_movements_company ON provision_movements;
CREATE TRIGGER provision_movements_company
  BEFORE INSERT OR UPDATE ON provision_movements
  FOR EACH ROW EXECUTE FUNCTION mission22_child_company_check();

CREATE OR REPLACE FUNCTION mission22_block_posted_change() RETURNS trigger AS $$
BEGIN
  IF OLD.status = 'POSTED' THEN
    RAISE EXCEPTION 'A posted record is immutable'
      USING ERRCODE = '23514';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS inventory_movements_posted_immutable ON inventory_movements;
CREATE TRIGGER inventory_movements_posted_immutable
  BEFORE UPDATE OR DELETE ON inventory_movements
  FOR EACH ROW EXECUTE FUNCTION mission22_block_posted_change();

DROP TRIGGER IF EXISTS inventory_write_downs_posted_immutable ON inventory_write_downs;
CREATE TRIGGER inventory_write_downs_posted_immutable
  BEFORE UPDATE OR DELETE ON inventory_write_downs
  FOR EACH ROW EXECUTE FUNCTION mission22_block_posted_change();

DROP TRIGGER IF EXISTS accrual_schedule_lines_posted_guard ON accrual_schedule_lines;
CREATE OR REPLACE FUNCTION accrual_lines_guard() RETURNS trigger AS $$
BEGIN
  IF OLD.status = 'POSTED' AND NEW.status = 'POSTED' AND NEW.entry_id IS DISTINCT FROM OLD.entry_id THEN
    RAISE EXCEPTION 'A posted accrual line is immutable'
      USING ERRCODE = '23514';
  END IF;
  IF OLD.status IN ('POSTED', 'REVERSED') AND TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'A posted accrual line cannot be deleted'
      USING ERRCODE = '23514';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER accrual_schedule_lines_posted_guard
  BEFORE UPDATE OR DELETE ON accrual_schedule_lines
  FOR EACH ROW EXECUTE FUNCTION accrual_lines_guard();

DROP TRIGGER IF EXISTS provision_movements_posted_immutable ON provision_movements;
CREATE TRIGGER provision_movements_posted_immutable
  BEFORE UPDATE OR DELETE ON provision_movements
  FOR EACH ROW EXECUTE FUNCTION mission22_block_posted_change();
