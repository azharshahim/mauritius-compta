-- ---------------------------------------------------------------------------
-- 0012_reconciliation_lettering.sql - ledger lettering (mission 12)
--
-- A lettering group links *already posted* journal lines of one third-party
-- account. It never modifies, duplicates or deletes a journal line. Allocation
-- of a customer/supplier payment to a document remains a separate commercial
-- operation, and bank reconciliation remains a third, separate operation.
--
-- Amounts use the same numeric(20,4) precision as journal_lines. A line may be
-- split across several groups, but the sum of active allocations can never
-- exceed the line side amount (enforced transactionally by the service).
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS ledger_letterings (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id          uuid NOT NULL REFERENCES cabinets(id) ON DELETE CASCADE,
  company_id          uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  account_id          uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  code                text NOT NULL,
  status              text NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active', 'reversed')),
  method              text NOT NULL DEFAULT 'manual'
                        CHECK (method IN ('manual', 'suggested')),
  currency            char(3) NOT NULL,
  source_currency     char(3) NOT NULL,
  amount              numeric(20,4) NOT NULL CHECK (amount > 0),
  total_debit         numeric(20,4) NOT NULL CHECK (total_debit > 0),
  total_credit        numeric(20,4) NOT NULL CHECK (total_credit > 0),
  rationale           text,
  request_key         text,
  created_by          uuid REFERENCES app_users(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  reversed_by         uuid REFERENCES app_users(id) ON DELETE SET NULL,
  reversed_at         timestamptz,
  reversal_reason     text,
  CONSTRAINT ledger_letterings_balanced_chk
    CHECK (total_debit = total_credit AND amount = total_debit),
  CONSTRAINT ledger_letterings_reversal_chk
    CHECK (
      (status = 'active' AND reversed_at IS NULL AND reversal_reason IS NULL)
      OR (status = 'reversed' AND reversed_at IS NOT NULL AND btrim(reversal_reason) <> '')
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS ledger_letterings_code_uniq
  ON ledger_letterings (company_id, lower(btrim(code)));
CREATE UNIQUE INDEX IF NOT EXISTS ledger_letterings_request_uniq
  ON ledger_letterings (company_id, request_key)
  WHERE request_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS ledger_letterings_account_idx
  ON ledger_letterings (company_id, account_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS ledger_letterings_company_idx
  ON ledger_letterings (company_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS ledger_lettering_lines (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lettering_id       uuid NOT NULL REFERENCES ledger_letterings(id) ON DELETE CASCADE,
  cabinet_id         uuid NOT NULL REFERENCES cabinets(id) ON DELETE CASCADE,
  company_id         uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  journal_line_id    uuid NOT NULL REFERENCES journal_lines(id) ON DELETE RESTRICT,
  entry_id           uuid NOT NULL REFERENCES journal_entries(id) ON DELETE RESTRICT,
  account_id         uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  side               text NOT NULL CHECK (side IN ('debit', 'credit')),
  amount             numeric(20,4) NOT NULL CHECK (amount > 0),
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (lettering_id, journal_line_id)
);

CREATE INDEX IF NOT EXISTS ledger_lettering_lines_group_idx
  ON ledger_lettering_lines (lettering_id);
CREATE INDEX IF NOT EXISTS ledger_lettering_lines_line_idx
  ON ledger_lettering_lines (journal_line_id);
CREATE INDEX IF NOT EXISTS ledger_lettering_lines_account_idx
  ON ledger_lettering_lines (company_id, account_id);

CREATE TABLE IF NOT EXISTS ledger_lettering_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id   uuid NOT NULL REFERENCES cabinets(id) ON DELETE CASCADE,
  company_id   uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  lettering_id uuid NOT NULL REFERENCES ledger_letterings(id) ON DELETE CASCADE,
  action       text NOT NULL CHECK (action IN ('created', 'reversed', 'suggested')),
  actor_id     uuid REFERENCES app_users(id) ON DELETE SET NULL,
  reason       text,
  details      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ledger_lettering_events_idx
  ON ledger_lettering_events (company_id, lettering_id, created_at DESC);

CREATE TABLE IF NOT EXISTS ledger_lettering_sequences (
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  year       integer NOT NULL,
  last_no    integer NOT NULL DEFAULT 0,
  PRIMARY KEY (company_id, year)
);

-- Cross-company / cross-cabinet guards. The service checks these too, but the
-- database refuses a line from another dossier even if a future caller forgets.
CREATE OR REPLACE FUNCTION mc_guard_ledger_lettering_company()
RETURNS trigger AS $$
DECLARE
  v_company uuid;
  v_cabinet uuid;
  v_account uuid;
BEGIN
  SELECT a.company_id, c.cabinet_id INTO v_company, v_cabinet
    FROM accounts a JOIN companies c ON c.id = a.company_id
   WHERE a.id = NEW.account_id;
  IF v_company IS NULL OR v_company <> NEW.company_id OR v_cabinet <> NEW.cabinet_id THEN
    RAISE EXCEPTION 'CROSS_COMPANY_REFERENCE: lettering account belongs to another company'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ledger_letterings_company_trg ON ledger_letterings;
CREATE TRIGGER ledger_letterings_company_trg
  BEFORE INSERT OR UPDATE ON ledger_letterings
  FOR EACH ROW EXECUTE FUNCTION mc_guard_ledger_lettering_company();

CREATE OR REPLACE FUNCTION mc_guard_ledger_lettering_line_company()
RETURNS trigger AS $$
DECLARE
  v_lettering_company uuid;
  v_lettering_cabinet uuid;
  v_lettering_account uuid;
  v_line_company uuid;
  v_line_account uuid;
  v_entry_id uuid;
  v_entry_company uuid;
  v_entry_status text;
BEGIN
  SELECT company_id, cabinet_id, account_id
    INTO v_lettering_company, v_lettering_cabinet, v_lettering_account
    FROM ledger_letterings WHERE id = NEW.lettering_id;
  SELECT company_id, account_id, entry_id
    INTO v_line_company, v_line_account, v_entry_id
    FROM journal_lines WHERE id = NEW.journal_line_id;
  SELECT company_id, status INTO v_entry_company, v_entry_status
    FROM journal_entries WHERE id = v_entry_id;
  IF v_lettering_company IS NULL OR v_line_company IS NULL OR v_entry_company IS NULL
     OR v_lettering_company <> NEW.company_id OR v_line_company <> NEW.company_id
     OR v_entry_company <> NEW.company_id OR v_lettering_cabinet <> NEW.cabinet_id
     OR v_lettering_account <> NEW.account_id OR v_line_account <> NEW.account_id
     OR NEW.entry_id <> v_entry_id THEN
    RAISE EXCEPTION 'CROSS_COMPANY_REFERENCE: lettering line spans companies or accounts'
      USING ERRCODE = 'check_violation';
  END IF;
  IF v_entry_status <> 'posted' THEN
    RAISE EXCEPTION 'UNPOSTED_ENTRY: only posted journal lines can be lettered'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ledger_lettering_lines_company_trg ON ledger_lettering_lines;
CREATE TRIGGER ledger_lettering_lines_company_trg
  BEFORE INSERT OR UPDATE ON ledger_lettering_lines
  FOR EACH ROW EXECUTE FUNCTION mc_guard_ledger_lettering_line_company();

CREATE OR REPLACE FUNCTION mc_guard_ledger_lettering_event_company()
RETURNS trigger AS $$
DECLARE
  v_company uuid;
  v_cabinet uuid;
BEGIN
  SELECT company_id, cabinet_id INTO v_company, v_cabinet
    FROM ledger_letterings WHERE id = NEW.lettering_id;
  IF v_company IS NULL OR v_company <> NEW.company_id OR v_cabinet <> NEW.cabinet_id THEN
    RAISE EXCEPTION 'CROSS_COMPANY_REFERENCE: lettering event belongs to another company'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ledger_lettering_events_company_trg ON ledger_lettering_events;
CREATE TRIGGER ledger_lettering_events_company_trg
  BEFORE INSERT OR UPDATE ON ledger_lettering_events
  FOR EACH ROW EXECUTE FUNCTION mc_guard_ledger_lettering_event_company();

-- Immutability: an active lettering is never rewritten in place. The only
-- allowed transition is active -> reversed, with a mandatory reason. Amounts
-- and line allocations cannot be edited after creation.
CREATE OR REPLACE FUNCTION mc_guard_ledger_lettering_immutable()
RETURNS trigger AS $$
BEGIN
  IF OLD.status = 'reversed' THEN
    RAISE EXCEPTION 'LETTERING_IMMUTABLE: a reversed lettering cannot be changed'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status <> 'reversed' THEN
    RAISE EXCEPTION 'LETTERING_IMMUTABLE: only reversal is allowed'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.amount <> OLD.amount OR NEW.total_debit <> OLD.total_debit
     OR NEW.total_credit <> OLD.total_credit OR NEW.account_id <> OLD.account_id
     OR NEW.code <> OLD.code OR NEW.company_id <> OLD.company_id
     OR NEW.cabinet_id <> OLD.cabinet_id THEN
    RAISE EXCEPTION 'LETTERING_IMMUTABLE: amounts, account and code cannot change'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ledger_letterings_immutable_trg ON ledger_letterings;
CREATE TRIGGER ledger_letterings_immutable_trg
  BEFORE UPDATE ON ledger_letterings
  FOR EACH ROW EXECUTE FUNCTION mc_guard_ledger_lettering_immutable();

CREATE OR REPLACE FUNCTION mc_guard_ledger_lettering_line_immutable()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'LETTERING_IMMUTABLE: lettering allocations are never deleted'
      USING ERRCODE = 'check_violation';
  END IF;
  RAISE EXCEPTION 'LETTERING_IMMUTABLE: lettering allocations cannot be edited'
    USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ledger_lettering_lines_immutable_trg ON ledger_lettering_lines;
CREATE TRIGGER ledger_lettering_lines_immutable_trg
  BEFORE UPDATE OR DELETE ON ledger_lettering_lines
  FOR EACH ROW EXECUTE FUNCTION mc_guard_ledger_lettering_line_immutable();
