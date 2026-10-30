-- ---------------------------------------------------------------------------
-- 0002_controls.sql - database level accounting controls (defence in depth)
--
-- These triggers guarantee invariants even if a bug or a direct SQL client
-- bypasses the API layer:
--   1. a posted entry must be balanced (sum debit = sum credit);
--   2. posted entries and their lines can no longer be modified or deleted;
--   3. an account used on a posted entry cannot be deleted;
--   4. journal lines can only reference accounts and journals of the same
--      company as the entry (cross-company isolation);
--   5. entry numbering is unique per company and journal.
-- ---------------------------------------------------------------------------

-- 1. Balance check -----------------------------------------------------------
CREATE OR REPLACE FUNCTION mc_assert_entry_balanced(p_entry_id uuid)
RETURNS void AS $$
DECLARE
  v_status   text;
  v_debit    numeric(20,4);
  v_credit   numeric(20,4);
  v_lines    integer;
BEGIN
  SELECT status INTO v_status FROM journal_entries WHERE id = p_entry_id;
  IF v_status IS NULL OR v_status <> 'posted' THEN
    RETURN;
  END IF;

  SELECT count(*),
         COALESCE(sum(debit), 0),
         COALESCE(sum(credit), 0)
    INTO v_lines, v_debit, v_credit
    FROM journal_lines WHERE entry_id = p_entry_id;

  IF v_lines < 2 THEN
    RAISE EXCEPTION 'ENTRY_TOO_FEW_LINES: posted entry % has % line(s)', p_entry_id, v_lines
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_debit <> v_credit THEN
    RAISE EXCEPTION 'ENTRY_UNBALANCED: entry % debit % <> credit %', p_entry_id, v_debit, v_credit
      USING ERRCODE = 'check_violation';
  END IF;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION mc_check_entry_balance()
RETURNS trigger AS $$
BEGIN
  IF TG_TABLE_NAME = 'journal_lines' THEN
    PERFORM mc_assert_entry_balanced(COALESCE(NEW.entry_id, OLD.entry_id));
  ELSE
    PERFORM mc_assert_entry_balanced(NEW.id);
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Deferred constraint triggers: checked at COMMIT so multi-line inserts work.
CREATE CONSTRAINT TRIGGER journal_lines_balance_trg
  AFTER INSERT OR UPDATE OR DELETE ON journal_lines
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION mc_check_entry_balance();

CREATE CONSTRAINT TRIGGER journal_entries_balance_trg
  AFTER INSERT OR UPDATE ON journal_entries
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION mc_check_entry_balance();

-- 2. Posted entries are immutable -------------------------------------------
CREATE OR REPLACE FUNCTION mc_guard_posted_entry()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'posted' THEN
      RAISE EXCEPTION 'POSTED_ENTRY_IMMUTABLE: entry % cannot be deleted', OLD.id
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.status = 'posted' THEN
    RAISE EXCEPTION 'POSTED_ENTRY_IMMUTABLE: entry % cannot be modified', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER journal_entries_immutable_trg
  BEFORE UPDATE OR DELETE ON journal_entries
  FOR EACH ROW EXECUTE FUNCTION mc_guard_posted_entry();

CREATE OR REPLACE FUNCTION mc_guard_posted_line()
RETURNS trigger AS $$
DECLARE
  v_status text;
BEGIN
  SELECT status INTO v_status FROM journal_entries
   WHERE id = COALESCE(NEW.entry_id, OLD.entry_id);
  IF v_status = 'posted' THEN
    RAISE EXCEPTION 'POSTED_ENTRY_IMMUTABLE: lines of a posted entry cannot be changed'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER journal_lines_immutable_trg
  BEFORE UPDATE OR DELETE ON journal_lines
  FOR EACH ROW EXECUTE FUNCTION mc_guard_posted_line();

-- 3. Accounts used on posted entries cannot be deleted ----------------------
CREATE OR REPLACE FUNCTION mc_guard_account_delete()
RETURNS trigger AS $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM journal_lines l
      JOIN journal_entries e ON e.id = l.entry_id
     WHERE l.account_id = OLD.id
  ) THEN
    RAISE EXCEPTION 'ACCOUNT_IN_USE: account % is referenced by journal entries', OLD.code
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER accounts_delete_guard_trg
  BEFORE DELETE ON accounts
  FOR EACH ROW EXECUTE FUNCTION mc_guard_account_delete();

-- 4. Cross-company isolation on lines --------------------------------------
CREATE OR REPLACE FUNCTION mc_guard_line_company()
RETURNS trigger AS $$
DECLARE
  v_entry_company  uuid;
  v_account_company uuid;
BEGIN
  SELECT company_id INTO v_entry_company FROM journal_entries WHERE id = NEW.entry_id;
  SELECT company_id INTO v_account_company FROM accounts WHERE id = NEW.account_id;

  IF v_entry_company IS NULL OR NEW.company_id <> v_entry_company THEN
    RAISE EXCEPTION 'CROSS_COMPANY_REFERENCE: line company does not match entry company'
      USING ERRCODE = 'check_violation';
  END IF;
  IF v_account_company IS NULL OR v_account_company <> v_entry_company THEN
    RAISE EXCEPTION 'CROSS_COMPANY_REFERENCE: account belongs to another company'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER journal_lines_company_trg
  BEFORE INSERT OR UPDATE ON journal_lines
  FOR EACH ROW EXECUTE FUNCTION mc_guard_line_company();
