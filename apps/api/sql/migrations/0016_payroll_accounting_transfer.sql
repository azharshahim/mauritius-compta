-- ---------------------------------------------------------------------------
-- 0016_payroll_accounting_transfer.sql - Mission 18
--
-- Payroll -> accounting bridge. Additive and idempotent.
--
-- * A payroll account mapping is an explicitly validated, versioned set of
--   company accounts. It never imposes a chart of accounts: every account is
--   chosen from the company's own plan.
-- * A transfer proposal is an immutable snapshot of the source payroll
--   calculations, mapping version, accounting lines and controls. Approval,
--   rejection and posting are separate audited decisions.
-- * No payroll entry is posted automatically. The `POSTED` status is guarded by
--   the service and can only be reached when the payroll rules and calculations
--   are approved for real use, which is not the case in this mission.
-- ---------------------------------------------------------------------------

-- 1. Payroll journal entries can be traced back to their payroll source. -------
ALTER TABLE journal_entries DROP CONSTRAINT IF EXISTS journal_entries_source_check;
ALTER TABLE journal_entries
  ADD CONSTRAINT journal_entries_source_check
  CHECK (source IN ('manual', 'reversal', 'opening', 'billing', 'purchase', 'ai',
                    'migration', 'migration_opening', 'fx', 'payroll'));

-- 2. Versioned account mapping -----------------------------------------------
CREATE TABLE IF NOT EXISTS payroll_account_mappings (
  id                              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id                      uuid NOT NULL REFERENCES cabinets(id) ON DELETE CASCADE,
  company_id                      uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  version                         int NOT NULL CHECK (version > 0),
  status                          text NOT NULL DEFAULT 'VALIDATED'
                                  CHECK (status IN ('VALIDATED', 'SUPERSEDED')),
  journal_id                      uuid NOT NULL REFERENCES journals(id) ON DELETE RESTRICT,
  wages_expense_account_id        uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  employer_csg_expense_account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  employer_nsf_expense_account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  training_levy_expense_account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  paye_payable_account_id         uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  csg_employee_payable_account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  csg_employer_payable_account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  nsf_employee_payable_account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  nsf_employer_payable_account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  training_levy_payable_account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  net_payable_account_id          uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  other_deductions_payable_account_id uuid REFERENCES accounts(id) ON DELETE RESTRICT,
  reimbursements_account_id       uuid REFERENCES accounts(id) ON DELETE RESTRICT,
  note                            text,
  validated_by                    uuid REFERENCES app_users(id) ON DELETE SET NULL,
  validated_at                    timestamptz NOT NULL DEFAULT now(),
  superseded_at                   timestamptz,
  created_by                      uuid REFERENCES app_users(id) ON DELETE SET NULL,
  created_at                      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, version)
);
CREATE INDEX IF NOT EXISTS payroll_account_mappings_company_idx
  ON payroll_account_mappings (company_id, version DESC);
-- Exactly one mapping can be active for a company.
CREATE UNIQUE INDEX IF NOT EXISTS payroll_account_mappings_active_idx
  ON payroll_account_mappings (company_id) WHERE status = 'VALIDATED';

-- Every referenced account and journal must belong to the same company. This is
-- a database-level defence in depth on top of the service validation.
CREATE OR REPLACE FUNCTION mc_guard_payroll_mapping_company() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM journals j WHERE j.id = NEW.journal_id AND j.company_id = NEW.company_id) THEN
    RAISE EXCEPTION 'PAYROLL_MAPPING_JOURNAL_COMPANY_MISMATCH';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM unnest(ARRAY[
        NEW.wages_expense_account_id,
        NEW.employer_csg_expense_account_id,
        NEW.employer_nsf_expense_account_id,
        NEW.training_levy_expense_account_id,
        NEW.paye_payable_account_id,
        NEW.csg_employee_payable_account_id,
        NEW.csg_employer_payable_account_id,
        NEW.nsf_employee_payable_account_id,
        NEW.nsf_employer_payable_account_id,
        NEW.training_levy_payable_account_id,
        NEW.net_payable_account_id,
        NEW.other_deductions_payable_account_id,
        NEW.reimbursements_account_id
      ]) AS ids(id)
     WHERE ids.id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM accounts a WHERE a.id = ids.id AND a.company_id = NEW.company_id)
  ) THEN
    RAISE EXCEPTION 'PAYROLL_MAPPING_ACCOUNT_COMPANY_MISMATCH';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS mc_payroll_mapping_company ON payroll_account_mappings;
CREATE TRIGGER mc_payroll_mapping_company
  BEFORE INSERT OR UPDATE ON payroll_account_mappings
  FOR EACH ROW EXECUTE FUNCTION mc_guard_payroll_mapping_company();

-- 3. Transfer proposals ------------------------------------------------------
CREATE TABLE IF NOT EXISTS payroll_accounting_transfers (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id           uuid NOT NULL REFERENCES cabinets(id) ON DELETE CASCADE,
  company_id           uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  period_id            uuid NOT NULL REFERENCES payroll_periods(id) ON DELETE RESTRICT,
  version              int NOT NULL CHECK (version > 0),
  status               text NOT NULL
                       CHECK (status IN ('DRAFT', 'BLOCKED', 'REVIEW_REQUIRED',
                                         'APPROVED_FOR_TEST', 'REJECTED', 'POSTED')),
  mapping_id           uuid REFERENCES payroll_account_mappings(id) ON DELETE RESTRICT,
  mapping_version      int,
  journal_id           uuid REFERENCES journals(id) ON DELETE RESTRICT,
  currency             char(3) NOT NULL DEFAULT 'MUR',
  calculation_ids      uuid[] NOT NULL DEFAULT '{}'::uuid[],
  source_fingerprint   text NOT NULL,
  source_rules         jsonb NOT NULL DEFAULT '[]'::jsonb,
  totals               jsonb NOT NULL DEFAULT '{}'::jsonb,
  lines                jsonb NOT NULL DEFAULT '[]'::jsonb,
  checks               jsonb NOT NULL DEFAULT '[]'::jsonb,
  blockers             jsonb NOT NULL DEFAULT '[]'::jsonb,
  warnings             jsonb NOT NULL DEFAULT '[]'::jsonb,
  posting_blockers     jsonb NOT NULL DEFAULT '[]'::jsonb,
  can_post             boolean NOT NULL DEFAULT false,
  note                 text,
  created_by           uuid REFERENCES app_users(id) ON DELETE SET NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  decided_by           uuid REFERENCES app_users(id) ON DELETE SET NULL,
  decided_at           timestamptz,
  decision_note        text,
  rejection_reason     text,
  posted_entry_id      uuid REFERENCES journal_entries(id) ON DELETE RESTRICT,
  posted_at            timestamptz,
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, period_id, version),
  CONSTRAINT payroll_transfer_approved_chk CHECK (
    status <> 'APPROVED_FOR_TEST'
    OR (decided_by IS NOT NULL AND decided_at IS NOT NULL AND decision_note IS NOT NULL)
  ),
  CONSTRAINT payroll_transfer_rejected_chk CHECK (
    status <> 'REJECTED' OR rejection_reason IS NOT NULL
  ),
  CONSTRAINT payroll_transfer_posted_chk CHECK (
    status <> 'POSTED' OR (posted_entry_id IS NOT NULL AND posted_at IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS payroll_accounting_transfers_period_idx
  ON payroll_accounting_transfers (company_id, period_id, version DESC);
CREATE INDEX IF NOT EXISTS payroll_accounting_transfers_status_idx
  ON payroll_accounting_transfers (company_id, status);
-- A payroll period can only have one posted transfer: no double expense or debt.
CREATE UNIQUE INDEX IF NOT EXISTS payroll_accounting_transfers_one_posted_idx
  ON payroll_accounting_transfers (company_id, period_id) WHERE status = 'POSTED';
-- The same calculation set cannot be approved twice (test approval or posting).
CREATE UNIQUE INDEX IF NOT EXISTS payroll_accounting_transfers_active_source_idx
  ON payroll_accounting_transfers (company_id, period_id, source_fingerprint)
  WHERE status IN ('APPROVED_FOR_TEST', 'POSTED');

-- The source lines and totals of an approved/posting proposal are immutable.
CREATE OR REPLACE FUNCTION mc_guard_payroll_transfer_immutable() RETURNS trigger AS $$
BEGIN
  IF OLD.status = 'POSTED' AND NEW.status <> 'POSTED' THEN
    RAISE EXCEPTION 'PAYROLL_TRANSFER_POSTED_IMMUTABLE';
  END IF;
  IF OLD.status IN ('APPROVED_FOR_TEST', 'POSTED') AND (
       NEW.lines IS DISTINCT FROM OLD.lines
    OR NEW.totals IS DISTINCT FROM OLD.totals
    OR NEW.calculation_ids IS DISTINCT FROM OLD.calculation_ids
    OR NEW.source_fingerprint IS DISTINCT FROM OLD.source_fingerprint
    OR NEW.mapping_id IS DISTINCT FROM OLD.mapping_id
    OR NEW.mapping_version IS DISTINCT FROM OLD.mapping_version
  ) THEN
    RAISE EXCEPTION 'PAYROLL_TRANSFER_APPROVED_IMMUTABLE';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS mc_payroll_transfer_immutable ON payroll_accounting_transfers;
CREATE TRIGGER mc_payroll_transfer_immutable
  BEFORE UPDATE ON payroll_accounting_transfers
  FOR EACH ROW EXECUTE FUNCTION mc_guard_payroll_transfer_immutable();
