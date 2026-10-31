-- ---------------------------------------------------------------------------
-- 0015_statutory_engine.sql - Mission 15
--
-- Additive and idempotent. Extends Mission 14 payroll with:
--   * EDF declarations and their revision history;
--   * statutory employee profile fields used to select dated rules;
--   * structured rule parameters and source metadata;
--   * statutory result columns on calculations.
--
-- No rate is created here. Rules are seeded per company by the application
-- with an official source and the RESEARCHED status only. EXPERT_VALIDATED
-- remains an explicit, audited administrator action.
-- ---------------------------------------------------------------------------

-- 1. Statutory profile -------------------------------------------------------
ALTER TABLE payroll_employees ADD COLUMN IF NOT EXISTS pay_frequency text NOT NULL DEFAULT 'monthly';
ALTER TABLE payroll_employees ADD COLUMN IF NOT EXISTS worker_type text NOT NULL DEFAULT 'full_time';
ALTER TABLE payroll_employees ADD COLUMN IF NOT EXISTS paye_category text NOT NULL DEFAULT 'standard';
ALTER TABLE payroll_employees ADD COLUMN IF NOT EXISTS tax_residency text NOT NULL DEFAULT 'resident';
ALTER TABLE payroll_employees ADD COLUMN IF NOT EXISTS is_public_sector boolean NOT NULL DEFAULT false;
ALTER TABLE payroll_employees ADD COLUMN IF NOT EXISTS public_sector_prb boolean NOT NULL DEFAULT false;
ALTER TABLE payroll_employees ADD COLUMN IF NOT EXISTS is_household_worker boolean NOT NULL DEFAULT false;
ALTER TABLE payroll_employees ADD COLUMN IF NOT EXISTS csg_exempt boolean NOT NULL DEFAULT false;
ALTER TABLE payroll_employees ADD COLUMN IF NOT EXISTS csg_exempt_reason text;
ALTER TABLE payroll_employees ADD COLUMN IF NOT EXISTS nsf_exempt boolean NOT NULL DEFAULT false;
ALTER TABLE payroll_employees ADD COLUMN IF NOT EXISTS nsf_exempt_reason text;
ALTER TABLE payroll_employees ADD COLUMN IF NOT EXISTS training_levy_exempt boolean NOT NULL DEFAULT false;
ALTER TABLE payroll_employees ADD COLUMN IF NOT EXISTS additional_remuneration_excluded boolean NOT NULL DEFAULT false;
ALTER TABLE payroll_employees ADD COLUMN IF NOT EXISTS additional_remuneration_exclusion_reason text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payroll_employees_pay_frequency_chk') THEN
    ALTER TABLE payroll_employees ADD CONSTRAINT payroll_employees_pay_frequency_chk
      CHECK (pay_frequency IN ('daily', 'weekly', 'fortnightly', 'half_monthly', 'monthly'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payroll_employees_worker_type_chk') THEN
    ALTER TABLE payroll_employees ADD CONSTRAINT payroll_employees_worker_type_chk
      CHECK (worker_type IN ('full_time', 'part_time', 'piece_rate', 'atypical'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payroll_employees_paye_category_chk') THEN
    ALTER TABLE payroll_employees ADD CONSTRAINT payroll_employees_paye_category_chk
      CHECK (paye_category IN ('standard', 'director', 'board_member', 'pensioner'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payroll_employees_tax_residency_chk') THEN
    ALTER TABLE payroll_employees ADD CONSTRAINT payroll_employees_tax_residency_chk
      CHECK (tax_residency IN ('resident', 'non_resident'));
  END IF;
END $$;

-- 2. EDF declarations --------------------------------------------------------
CREATE TABLE IF NOT EXISTS payroll_edf_declarations (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id          uuid NOT NULL REFERENCES cabinets(id) ON DELETE CASCADE,
  company_id          uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  employee_id         uuid NOT NULL REFERENCES payroll_employees(id) ON DELETE CASCADE,
  tax_year_start      date NOT NULL,
  declaration_date    date NOT NULL,
  effective_from      date NOT NULL,
  dependent_count     int NOT NULL DEFAULT 0 CHECK (dependent_count BETWEEN 0 AND 20),
  dependent_deduction numeric(20,4) NOT NULL DEFAULT 0 CHECK (dependent_deduction >= 0),
  other_reliefs       numeric(20,4) NOT NULL DEFAULT 0 CHECK (other_reliefs >= 0),
  total_reliefs       numeric(20,4) NOT NULL DEFAULT 0 CHECK (total_reliefs >= 0),
  status              text NOT NULL DEFAULT 'submitted'
                      CHECK (status IN ('draft', 'submitted', 'superseded')),
  document_ref        text,
  source_reference    text,
  notes               text,
  revision            int NOT NULL DEFAULT 1 CHECK (revision >= 1),
  supersedes_id       uuid REFERENCES payroll_edf_declarations(id) ON DELETE SET NULL,
  created_by          uuid REFERENCES app_users(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, employee_id, tax_year_start, revision),
  CONSTRAINT payroll_edf_dates_chk CHECK (effective_from >= tax_year_start)
);
CREATE UNIQUE INDEX IF NOT EXISTS payroll_edf_one_active_idx
  ON payroll_edf_declarations (company_id, employee_id, tax_year_start)
  WHERE status = 'submitted';
CREATE INDEX IF NOT EXISTS payroll_edf_employee_idx
  ON payroll_edf_declarations (company_id, employee_id, tax_year_start, effective_from DESC);

-- 3. Structured regulatory rules --------------------------------------------
ALTER TABLE payroll_rules ADD COLUMN IF NOT EXISTS parameters jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE payroll_rules ADD COLUMN IF NOT EXISTS formula text;
ALTER TABLE payroll_rules ADD COLUMN IF NOT EXISTS article text;
ALTER TABLE payroll_rules ADD COLUMN IF NOT EXISTS publication_date date;
ALTER TABLE payroll_rules ADD COLUMN IF NOT EXISTS accessed_at date;
ALTER TABLE payroll_rules ADD COLUMN IF NOT EXISTS source_fingerprint text;
ALTER TABLE payroll_rules ADD COLUMN IF NOT EXISTS implemented_at timestamptz;
ALTER TABLE payroll_rules ADD COLUMN IF NOT EXISTS implementation_status text NOT NULL DEFAULT 'PENDING'
  CHECK (implementation_status IN ('PENDING', 'IMPLEMENTED', 'NOT_APPLICABLE'));

-- 4. Statutory calculation results ------------------------------------------
ALTER TABLE payroll_calculations ADD COLUMN IF NOT EXISTS taxable_emoluments numeric(20,4);
ALTER TABLE payroll_calculations ADD COLUMN IF NOT EXISTS basic_wage numeric(20,4);
ALTER TABLE payroll_calculations ADD COLUMN IF NOT EXISTS paye_basis text;
ALTER TABLE payroll_calculations ADD COLUMN IF NOT EXISTS csg_employee numeric(20,4);
ALTER TABLE payroll_calculations ADD COLUMN IF NOT EXISTS csg_employer numeric(20,4);
ALTER TABLE payroll_calculations ADD COLUMN IF NOT EXISTS nsf_employee numeric(20,4);
ALTER TABLE payroll_calculations ADD COLUMN IF NOT EXISTS nsf_employer numeric(20,4);
ALTER TABLE payroll_calculations ADD COLUMN IF NOT EXISTS training_levy numeric(20,4);
ALTER TABLE payroll_calculations ADD COLUMN IF NOT EXISTS additional_remuneration numeric(20,4) NOT NULL DEFAULT 0;
ALTER TABLE payroll_calculations ADD COLUMN IF NOT EXISTS employer_cost numeric(20,4);
ALTER TABLE payroll_calculations ADD COLUMN IF NOT EXISTS net_after_statutory numeric(20,4);
ALTER TABLE payroll_calculations ADD COLUMN IF NOT EXISTS net_payable numeric(20,4);
ALTER TABLE payroll_calculations ADD COLUMN IF NOT EXISTS statutory_status text NOT NULL DEFAULT 'RULES_INCOMPLETE';
ALTER TABLE payroll_calculations ADD COLUMN IF NOT EXISTS edf_basis text;
ALTER TABLE payroll_calculations ADD COLUMN IF NOT EXISTS rules_applied jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE payroll_calculations ADD COLUMN IF NOT EXISTS review_reasons jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE payroll_calculations ADD COLUMN IF NOT EXISTS approved_for_test_by uuid REFERENCES app_users(id) ON DELETE SET NULL;
ALTER TABLE payroll_calculations ADD COLUMN IF NOT EXISTS approved_for_test_at timestamptz;
ALTER TABLE payroll_calculations ADD COLUMN IF NOT EXISTS approved_for_test_note text;
ALTER TABLE payroll_calculations ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE payroll_calculations DROP CONSTRAINT IF EXISTS payroll_calculations_status_check;
ALTER TABLE payroll_calculations ADD CONSTRAINT payroll_calculations_status_check
  CHECK (status IN ('blocked', 'simulated', 'rules_incomplete', 'calculated',
                    'review_required', 'expert_review_pending', 'approved_for_test',
                    'finalisation_blocked', 'approved', 'finalised'));

-- 5. Payroll settings switches ----------------------------------------------
ALTER TABLE payroll_settings ADD COLUMN IF NOT EXISTS statutory_ar_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE payroll_settings ADD COLUMN IF NOT EXISTS statutory_bonus_enabled boolean NOT NULL DEFAULT false;

-- 6. Company isolation for EDF rows -----------------------------------------
CREATE OR REPLACE FUNCTION mc_guard_payroll_edf_company() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM payroll_employees e
     WHERE e.id = NEW.employee_id AND e.company_id = NEW.company_id
  ) THEN
    RAISE EXCEPTION 'PAYROLL_EMPLOYEE_COMPANY_MISMATCH';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS mc_payroll_edf_company ON payroll_edf_declarations;
CREATE TRIGGER mc_payroll_edf_company
  BEFORE INSERT OR UPDATE ON payroll_edf_declarations
  FOR EACH ROW EXECUTE FUNCTION mc_guard_payroll_edf_company();
