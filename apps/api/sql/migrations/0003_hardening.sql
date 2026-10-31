-- ---------------------------------------------------------------------------
-- 0003_hardening.sql - integrity hardening discovered during the V0.1.1 audit
--
--  1. one reversal per entry (race-condition proof, not only an API check);
--  2. uniqueness of manually recorded references within a company;
--  3. journal / reversal / attachment / parent-account must belong to the same
--     company as the row (database-level tenant isolation);
--  4. the audit log is append-only;
--  5. additional indexes for reporting and attachments;
--  6. company deletion (demo reset) is still possible while direct deletion of
--     posted entries remains forbidden.
-- ---------------------------------------------------------------------------

-- 1. A given entry can be reversed only once ---------------------------------
CREATE UNIQUE INDEX journal_entries_one_reversal_idx
  ON journal_entries (reversal_of_entry_id)
  WHERE reversal_of_entry_id IS NOT NULL;

-- 2. References are unique per company for manually recorded entries ---------
--    (reversal entries inherit the original reference and are excluded)
CREATE UNIQUE INDEX journal_entries_reference_unique_idx
  ON journal_entries (company_id, lower(btrim(reference)))
  WHERE reference IS NOT NULL AND btrim(reference) <> '' AND source = 'manual';

-- 3. Cross-company protection on entries -------------------------------------
CREATE OR REPLACE FUNCTION mc_guard_entry_company()
RETURNS trigger AS $$
DECLARE
  v_journal_company  uuid;
  v_reversal_company uuid;
  v_reversal_status  text;
BEGIN
  SELECT company_id INTO v_journal_company FROM journals WHERE id = NEW.journal_id;
  IF v_journal_company IS NULL OR v_journal_company <> NEW.company_id THEN
    RAISE EXCEPTION 'CROSS_COMPANY_REFERENCE: journal belongs to another company'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.reversal_of_entry_id IS NOT NULL THEN
    SELECT company_id, status INTO v_reversal_company, v_reversal_status
      FROM journal_entries WHERE id = NEW.reversal_of_entry_id;
    IF v_reversal_company IS NULL OR v_reversal_company <> NEW.company_id THEN
      RAISE EXCEPTION 'CROSS_COMPANY_REFERENCE: reversed entry belongs to another company'
        USING ERRCODE = 'check_violation';
    END IF;
    IF v_reversal_status <> 'posted' THEN
      RAISE EXCEPTION 'INVALID_REVERSAL: only a posted entry can be reversed'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER journal_entries_company_trg
  BEFORE INSERT OR UPDATE ON journal_entries
  FOR EACH ROW EXECUTE FUNCTION mc_guard_entry_company();

-- 4. Attachments must belong to an entry of the same company ------------------
CREATE OR REPLACE FUNCTION mc_guard_attachment_company()
RETURNS trigger AS $$
DECLARE
  v_entry_company uuid;
BEGIN
  IF NEW.entry_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT company_id INTO v_entry_company FROM journal_entries WHERE id = NEW.entry_id;
  IF v_entry_company IS NULL OR v_entry_company <> NEW.company_id THEN
    RAISE EXCEPTION 'CROSS_COMPANY_REFERENCE: attachment entry belongs to another company'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER attachments_company_trg
  BEFORE INSERT OR UPDATE ON attachments
  FOR EACH ROW EXECUTE FUNCTION mc_guard_attachment_company();

-- 5. Parent accounts must belong to the same company --------------------------
CREATE OR REPLACE FUNCTION mc_guard_account_parent_company()
RETURNS trigger AS $$
DECLARE
  v_parent_company uuid;
BEGIN
  IF NEW.parent_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT company_id INTO v_parent_company FROM accounts WHERE id = NEW.parent_id;
  IF v_parent_company IS NULL OR v_parent_company <> NEW.company_id THEN
    RAISE EXCEPTION 'CROSS_COMPANY_REFERENCE: parent account belongs to another company'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER accounts_parent_company_trg
  BEFORE INSERT OR UPDATE ON accounts
  FOR EACH ROW EXECUTE FUNCTION mc_guard_account_parent_company();

-- 6. Audit log is append-only -------------------------------------------------
--    Only the foreign-key driven anonymisation (company_id / user_id set to
--    NULL when a company or user is deleted) is tolerated.
CREATE OR REPLACE FUNCTION mc_guard_audit_append_only()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'AUDIT_LOG_APPEND_ONLY: audit records cannot be deleted'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.id = OLD.id
     AND NEW.action = OLD.action
     AND NEW.entity_type = OLD.entity_type
     AND NEW.entity_id IS NOT DISTINCT FROM OLD.entity_id
     AND NEW.details = OLD.details
     AND NEW.ip IS NOT DISTINCT FROM OLD.ip
     AND NEW.created_at = OLD.created_at
     AND (NEW.company_id IS NULL OR NEW.company_id = OLD.company_id)
     AND (NEW.user_id IS NULL OR NEW.user_id = OLD.user_id)
  THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'AUDIT_LOG_APPEND_ONLY: audit records cannot be modified'
    USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_log_append_only_trg
  BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION mc_guard_audit_append_only();

-- 7. Immutability guards: keep protecting posted entries, but allow the
--    deletion of the whole company (demo reset). The company row is deleted
--    before the cascade reaches its children, so the existence test is false
--    during a cascade and true for a direct DELETE.
CREATE OR REPLACE FUNCTION mc_guard_posted_entry()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'posted' AND EXISTS (SELECT 1 FROM companies WHERE id = OLD.company_id) THEN
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

CREATE OR REPLACE FUNCTION mc_guard_account_delete()
RETURNS trigger AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM companies WHERE id = OLD.company_id)
     AND EXISTS (
       SELECT 1
         FROM journal_lines l
         JOIN journal_entries e ON e.id = l.entry_id
        WHERE l.account_id = OLD.id
     )
  THEN
    RAISE EXCEPTION 'ACCOUNT_IN_USE: account % is referenced by journal entries', OLD.code
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

-- 8. Indexes for reporting and attachment lookups ----------------------------
CREATE INDEX attachments_company_idx ON attachments (company_id);
CREATE INDEX journal_entries_company_status_date_idx
  ON journal_entries (company_id, status, entry_date);
