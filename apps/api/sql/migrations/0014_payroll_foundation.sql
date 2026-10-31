-- ---------------------------------------------------------------------------
-- 0014_payroll_foundation.sql - Mission 14
--
-- Additive and idempotent. Mission 4 created `payroll_employees` with identity
-- only; this migration extends it and adds the payroll foundation:
-- employee master data, contracts, pay items, time, leave, monthly variables,
-- dated rules, periods, deterministic calculations and simulation payslips.
--
-- No statutory rate, threshold, PAYE/CSG/NSF rule or leave entitlement is
-- seeded. Rules can only become EXPERT_VALIDATED through an authorised action.
-- ---------------------------------------------------------------------------

-- 1. Employee master data ----------------------------------------------------
ALTER TABLE payroll_employees ADD COLUMN IF NOT EXISTS employee_number   text;
ALTER TABLE payroll_employees ADD COLUMN IF NOT EXISTS first_name        text;
ALTER TABLE payroll_employees ADD COLUMN IF NOT EXISTS last_name         text;
ALTER TABLE payroll_employees ADD COLUMN IF NOT EXISTS preferred_name    text;
ALTER TABLE payroll_employees ADD COLUMN IF NOT EXISTS date_of_birth     date;
ALTER TABLE payroll_employees ADD COLUMN IF NOT EXISTS nationality       text;
ALTER TABLE payroll_employees ADD COLUMN IF NOT EXISTS country_of_residence text;
ALTER TABLE payroll_employees ADD COLUMN IF NOT EXISTS address           text;
ALTER TABLE payroll_employees ADD COLUMN IF NOT EXISTS email             text;
ALTER TABLE payroll_employees ADD COLUMN IF NOT EXISTS phone             text;
ALTER TABLE payroll_employees ADD COLUMN IF NOT EXISTS employment_status text NOT NULL DEFAULT 'active';
ALTER TABLE payroll_employees ADD COLUMN IF NOT EXISTS hire_date         date;
ALTER TABLE payroll_employees ADD COLUMN IF NOT EXISTS termination_date  date;
ALTER TABLE payroll_employees ADD COLUMN IF NOT EXISTS department        text;
ALTER TABLE payroll_employees ADD COLUMN IF NOT EXISTS work_location     text;
ALTER TABLE payroll_employees ADD COLUMN IF NOT EXISTS manager_employee_id uuid REFERENCES payroll_employees(id) ON DELETE SET NULL;
ALTER TABLE payroll_employees ADD COLUMN IF NOT EXISTS cost_centre       text;
ALTER TABLE payroll_employees ADD COLUMN IF NOT EXISTS payroll_currency  text NOT NULL DEFAULT 'MUR';
ALTER TABLE payroll_employees ADD COLUMN IF NOT EXISTS payment_method    text;
ALTER TABLE payroll_employees ADD COLUMN IF NOT EXISTS bank_name         text;
-- Only a masked suffix and a one-way fingerprint are stored. A full bank
-- account number must never be persisted in clear text or logged.
ALTER TABLE payroll_employees ADD COLUMN IF NOT EXISTS bank_account_last4 text;
ALTER TABLE payroll_employees ADD COLUMN IF NOT EXISTS bank_account_fingerprint text;
ALTER TABLE payroll_employees ADD COLUMN IF NOT EXISTS statutory_id_last4 text;
ALTER TABLE payroll_employees ADD COLUMN IF NOT EXISTS statutory_id_fingerprint text;
ALTER TABLE payroll_employees ADD COLUMN IF NOT EXISTS statutory_ref_last4 text;
ALTER TABLE payroll_employees ADD COLUMN IF NOT EXISTS emergency_contact_name text;
ALTER TABLE payroll_employees ADD COLUMN IF NOT EXISTS emergency_contact_phone text;
ALTER TABLE payroll_employees ADD COLUMN IF NOT EXISTS emergency_contact_relation text;
ALTER TABLE payroll_employees ADD COLUMN IF NOT EXISTS notes text;
ALTER TABLE payroll_employees ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES app_users(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payroll_employees_employment_status_chk') THEN
    ALTER TABLE payroll_employees ADD CONSTRAINT payroll_employees_employment_status_chk
      CHECK (employment_status IN ('active', 'probation', 'suspended', 'terminated'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payroll_employees_payment_method_chk') THEN
    ALTER TABLE payroll_employees ADD CONSTRAINT payroll_employees_payment_method_chk
      CHECK (payment_method IS NULL OR payment_method IN ('bank_transfer', 'cheque', 'cash'));
  END IF;
END $$;

UPDATE payroll_employees
   SET first_name = COALESCE(first_name, split_part(full_name, ' ', 1)),
       last_name = COALESCE(last_name, NULLIF(btrim(substr(full_name, length(split_part(full_name, ' ', 1)) + 1)), '')),
       employee_number = COALESCE(employee_number, employee_ref),
       hire_date = COALESCE(hire_date, start_date),
       termination_date = COALESCE(termination_date, end_date)
 WHERE first_name IS NULL OR last_name IS NULL OR employee_number IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS payroll_employees_number_idx
  ON payroll_employees (company_id, lower(btrim(employee_number)))
  WHERE employee_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS payroll_employees_name_idx
  ON payroll_employees (company_id, lower(last_name), lower(first_name));

-- 2. Contracts and dated salary history --------------------------------------
CREATE TABLE IF NOT EXISTS payroll_contracts (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id        uuid NOT NULL REFERENCES cabinets(id) ON DELETE CASCADE,
  company_id        uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  employee_id       uuid NOT NULL REFERENCES payroll_employees(id) ON DELETE CASCADE,
  contract_type     text NOT NULL CHECK (contract_type IN ('permanent', 'fixed_term')),
  work_pattern      text NOT NULL CHECK (work_pattern IN ('full_time', 'part_time')),
  status            text NOT NULL DEFAULT 'active' CHECK (status IN ('draft', 'active', 'suspended', 'terminated', 'superseded')),
  effective_from    date NOT NULL,
  effective_to      date,
  base_salary       numeric(20,4) NOT NULL CHECK (base_salary >= 0),
  salary_period     text NOT NULL CHECK (salary_period IN ('monthly', 'hourly', 'daily')),
  currency          text NOT NULL DEFAULT 'MUR',
  weekly_hours      numeric(8,2),
  department        text,
  job_title         text,
  work_location     text,
  probation_end     date,
  change_reason     text,
  amendment_of      uuid REFERENCES payroll_contracts(id) ON DELETE SET NULL,
  created_by        uuid REFERENCES app_users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payroll_contracts_dates_chk CHECK (effective_to IS NULL OR effective_to >= effective_from)
);
CREATE INDEX IF NOT EXISTS payroll_contracts_employee_idx
  ON payroll_contracts (company_id, employee_id, effective_from DESC);
CREATE UNIQUE INDEX IF NOT EXISTS payroll_contracts_one_active_idx
  ON payroll_contracts (company_id, employee_id)
  WHERE status = 'active';

CREATE TABLE IF NOT EXISTS payroll_contract_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id   uuid NOT NULL REFERENCES cabinets(id) ON DELETE CASCADE,
  company_id   uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  contract_id  uuid NOT NULL REFERENCES payroll_contracts(id) ON DELETE CASCADE,
  employee_id  uuid NOT NULL REFERENCES payroll_employees(id) ON DELETE CASCADE,
  action       text NOT NULL,
  effective_from date,

  change_reason text,
  previous     jsonb,
  current      jsonb,
  actor_id     uuid REFERENCES app_users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS payroll_contract_events_idx
  ON payroll_contract_events (company_id, employee_id, created_at DESC);

-- 3. Pay items ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payroll_pay_items (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id        uuid NOT NULL REFERENCES cabinets(id) ON DELETE CASCADE,
  company_id        uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  code              text NOT NULL CHECK (length(btrim(code)) > 0),
  label_en          text NOT NULL,
  label_fr          text NOT NULL,
  category          text NOT NULL CHECK (category IN ('earning', 'deduction', 'reimbursement', 'advance', 'loan')),
  unit              text NOT NULL CHECK (unit IN ('money', 'hour', 'day', 'quantity')),
  calculation_method text NOT NULL CHECK (calculation_method IN ('fixed', 'quantity_times_rate')),
  treatment_status  text NOT NULL DEFAULT 'UNVERIFIED'
                    CHECK (treatment_status IN ('UNVERIFIED', 'RESEARCHED', 'REVIEW_REQUIRED', 'EXPERT_VALIDATED', 'DEPRECATED')),
  taxable           boolean,
  accountable       boolean NOT NULL DEFAULT false,
  account_id        uuid REFERENCES accounts(id) ON DELETE SET NULL,
  effective_from    date NOT NULL,
  effective_to      date,
  source            text,
  parameters        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by        uuid REFERENCES app_users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payroll_pay_items_dates_chk CHECK (effective_to IS NULL OR effective_to >= effective_from)
);
CREATE UNIQUE INDEX IF NOT EXISTS payroll_pay_items_code_idx
  ON payroll_pay_items (company_id, lower(btrim(code)));

CREATE TABLE IF NOT EXISTS payroll_employee_pay_items (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  employee_id   uuid NOT NULL REFERENCES payroll_employees(id) ON DELETE CASCADE,
  pay_item_id   uuid NOT NULL REFERENCES payroll_pay_items(id) ON DELETE CASCADE,
  amount        numeric(20,4) NOT NULL DEFAULT 0 CHECK (amount >= 0),
  effective_from date NOT NULL,
  effective_to  date,
  created_by    uuid REFERENCES app_users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS payroll_employee_pay_items_idx
  ON payroll_employee_pay_items (company_id, employee_id, effective_from DESC);

-- 4. Work calendar, time and absences ----------------------------------------
CREATE TABLE IF NOT EXISTS payroll_work_calendars (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id   uuid NOT NULL REFERENCES cabinets(id) ON DELETE CASCADE,
  company_id   uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name         text NOT NULL,
  work_days    int[] NOT NULL DEFAULT ARRAY[1,2,3,4,5],
  hours_per_day numeric(8,2) NOT NULL DEFAULT 8 CHECK (hours_per_day > 0),
  effective_from date NOT NULL,
  effective_to date,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS payroll_holidays (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  holiday_date date NOT NULL,
  name_en      text NOT NULL,
  name_fr      text NOT NULL,
  source       text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, holiday_date)
);

CREATE TABLE IF NOT EXISTS payroll_time_entries (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id      uuid NOT NULL REFERENCES cabinets(id) ON DELETE CASCADE,
  company_id      uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  employee_id     uuid NOT NULL REFERENCES payroll_employees(id) ON DELETE CASCADE,
  work_date       date NOT NULL,
  hours_worked    numeric(8,2) NOT NULL DEFAULT 0 CHECK (hours_worked >= 0),
  overtime_hours  numeric(8,2) NOT NULL DEFAULT 0 CHECK (overtime_hours >= 0),
  lateness_minutes int NOT NULL DEFAULT 0 CHECK (lateness_minutes >= 0),
  note            text,
  source          text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'import', 'timesheet')),
  created_by      uuid REFERENCES app_users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, employee_id, work_date)
);
CREATE INDEX IF NOT EXISTS payroll_time_period_idx
  ON payroll_time_entries (company_id, work_date);

CREATE TABLE IF NOT EXISTS payroll_absences (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id     uuid NOT NULL REFERENCES cabinets(id) ON DELETE CASCADE,
  company_id     uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  employee_id    uuid NOT NULL REFERENCES payroll_employees(id) ON DELETE CASCADE,
  leave_type     text NOT NULL CHECK (leave_type IN ('annual', 'sick', 'unpaid', 'maternity', 'paternity', 'other')),
  start_date     date NOT NULL,
  end_date       date NOT NULL,
  days           numeric(8,2) NOT NULL CHECK (days > 0),
  status         text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'approved', 'rejected', 'cancelled')),
  reason         text,
  decision_reason text,
  document_ref   text,
  requested_by   uuid REFERENCES app_users(id) ON DELETE SET NULL,
  decided_by     uuid REFERENCES app_users(id) ON DELETE SET NULL,
  decided_at     timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payroll_absences_dates_chk CHECK (end_date >= start_date)
);
CREATE INDEX IF NOT EXISTS payroll_absences_employee_idx
  ON payroll_absences (company_id, employee_id, start_date DESC);

CREATE TABLE IF NOT EXISTS payroll_leave_rules (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id     uuid NOT NULL REFERENCES cabinets(id) ON DELETE CASCADE,
  company_id     uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  leave_type     text NOT NULL CHECK (leave_type IN ('annual', 'sick', 'unpaid', 'maternity', 'paternity', 'other')),
  days_per_year  numeric(8,2) NOT NULL CHECK (days_per_year >= 0),
  accrual_method text NOT NULL DEFAULT 'configured_annual'
                 CHECK (accrual_method IN ('configured_annual', 'configured_monthly')),
  effective_from date NOT NULL,
  effective_to   date,
  status         text NOT NULL DEFAULT 'UNVERIFIED'
                 CHECK (status IN ('UNVERIFIED', 'RESEARCHED', 'REVIEW_REQUIRED', 'EXPERT_VALIDATED', 'DEPRECATED')),
  source         text,
  reviewer_id    uuid REFERENCES app_users(id) ON DELETE SET NULL,
  validated_at   timestamptz,
  created_by     uuid REFERENCES app_users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS payroll_leave_rules_type_idx
  ON payroll_leave_rules (company_id, leave_type, effective_from);

-- 5. Dated regulatory rules registry ----------------------------------------
CREATE TABLE IF NOT EXISTS payroll_rules (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id      uuid NOT NULL REFERENCES cabinets(id) ON DELETE CASCADE,
  company_id      uuid REFERENCES companies(id) ON DELETE CASCADE,
  rule_code       text NOT NULL,
  name_en         text NOT NULL,
  name_fr         text NOT NULL,
  legal_source    text,
  source_reference text,
  source_url      text,
  effective_from  date,
  effective_to    date,
  employee_category text,
  employer_category text,
  calculation_basis text,
  rate            numeric(20,8),
  threshold_amount numeric(20,4),
  cap_amount      numeric(20,4),
  exemption_amount numeric(20,4),
  rounding_policy text,
  status          text NOT NULL DEFAULT 'UNVERIFIED'
                  CHECK (status IN ('UNVERIFIED', 'RESEARCHED', 'REVIEW_REQUIRED', 'EXPERT_VALIDATED', 'DEPRECATED')),
  required_for_calculation boolean NOT NULL DEFAULT true,
  version         int NOT NULL DEFAULT 1,
  test_cases      jsonb NOT NULL DEFAULT '[]'::jsonb,
  notes           text,
  reviewer_id     uuid REFERENCES app_users(id) ON DELETE SET NULL,
  validated_at    timestamptz,
  created_by      uuid REFERENCES app_users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payroll_rules_rate_chk CHECK (rate IS NULL OR rate >= 0),
  CONSTRAINT payroll_rules_dates_chk CHECK (effective_to IS NULL OR effective_from IS NULL OR effective_to >= effective_from)
);
CREATE UNIQUE INDEX IF NOT EXISTS payroll_rules_code_version_idx
  ON payroll_rules (company_id, upper(btrim(rule_code)), version);
CREATE INDEX IF NOT EXISTS payroll_rules_status_idx
  ON payroll_rules (company_id, status, effective_from DESC);

-- 6. Payroll settings, periods, variables -----------------------------------
CREATE TABLE IF NOT EXISTS payroll_settings (
  company_id             uuid PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  cabinet_id             uuid NOT NULL REFERENCES cabinets(id) ON DELETE CASCADE,
  salary_expense_account_id uuid REFERENCES accounts(id) ON DELETE SET NULL,
  salary_payable_account_id uuid REFERENCES accounts(id) ON DELETE SET NULL,
  paye_payable_account_id uuid REFERENCES accounts(id) ON DELETE SET NULL,
  csg_payable_account_id uuid REFERENCES accounts(id) ON DELETE SET NULL,
  nsf_payable_account_id uuid REFERENCES accounts(id) ON DELETE SET NULL,
  default_currency       text NOT NULL DEFAULT 'MUR',
  notes                  text,
  updated_by             uuid REFERENCES app_users(id) ON DELETE SET NULL,
  updated_at             timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS payroll_periods (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id      uuid NOT NULL REFERENCES cabinets(id) ON DELETE CASCADE,
  company_id      uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  period_year     int NOT NULL CHECK (period_year BETWEEN 2000 AND 2100),
  period_month    int NOT NULL CHECK (period_month BETWEEN 1 AND 12),
  start_date      date NOT NULL,
  end_date        date NOT NULL,
  payment_date    date,
  status          text NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft', 'data_collection', 'ready_for_review', 'blocked', 'calculated', 'approved', 'finalised')),
  version         int NOT NULL DEFAULT 1,
  calculated_at   timestamptz,
  approved_by     uuid REFERENCES app_users(id) ON DELETE SET NULL,
  approved_at     timestamptz,
  finalised_by    uuid REFERENCES app_users(id) ON DELETE SET NULL,
  finalised_at    timestamptz,
  reopened_at     timestamptz,
  reopen_reason   text,
  created_by      uuid REFERENCES app_users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, period_year, period_month),
  CONSTRAINT payroll_periods_dates_chk CHECK (end_date >= start_date)
);

CREATE TABLE IF NOT EXISTS payroll_variables (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id      uuid NOT NULL REFERENCES cabinets(id) ON DELETE CASCADE,
  company_id      uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  period_id       uuid NOT NULL REFERENCES payroll_periods(id) ON DELETE CASCADE,
  employee_id     uuid NOT NULL REFERENCES payroll_employees(id) ON DELETE CASCADE,
  pay_item_id     uuid NOT NULL REFERENCES payroll_pay_items(id) ON DELETE RESTRICT,
  quantity        numeric(20,4) NOT NULL DEFAULT 1,
  rate            numeric(20,4) NOT NULL DEFAULT 0,
  amount          numeric(20,4) NOT NULL,
  note            text,
  status          text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'validated', 'rejected')),
  import_key      text,
  source          text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'csv', 'xlsx', 'api')),
  created_by      uuid REFERENCES app_users(id) ON DELETE SET NULL,
  validated_by    uuid REFERENCES app_users(id) ON DELETE SET NULL,
  validated_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS payroll_variables_import_idx
  ON payroll_variables (company_id, import_key) WHERE import_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS payroll_variables_period_idx
  ON payroll_variables (company_id, period_id, employee_id, status);

CREATE TABLE IF NOT EXISTS payroll_variable_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  variable_id  uuid NOT NULL REFERENCES payroll_variables(id) ON DELETE CASCADE,
  action       text NOT NULL,
  previous     jsonb,
  current      jsonb,
  actor_id     uuid REFERENCES app_users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- 7. Deterministic calculations and payslips --------------------------------
CREATE TABLE IF NOT EXISTS payroll_calculations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id      uuid NOT NULL REFERENCES cabinets(id) ON DELETE CASCADE,
  company_id      uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  period_id       uuid NOT NULL REFERENCES payroll_periods(id) ON DELETE CASCADE,
  employee_id     uuid NOT NULL REFERENCES payroll_employees(id) ON DELETE CASCADE,
  version         int NOT NULL,
  status          text NOT NULL CHECK (status IN ('blocked', 'simulated', 'approved', 'finalised')),
  currency        text NOT NULL,
  contract_id     uuid REFERENCES payroll_contracts(id) ON DELETE SET NULL,
  base_amount     numeric(20,4) NOT NULL DEFAULT 0,
  proration_days  numeric(8,2),
  period_days     int,
  earnings        numeric(20,4) NOT NULL DEFAULT 0,
  gross           numeric(20,4) NOT NULL DEFAULT 0,
  deductions      numeric(20,4) NOT NULL DEFAULT 0,
  net_arithmetic  numeric(20,4) NOT NULL DEFAULT 0,
  paye            numeric(20,4),
  csg             numeric(20,4),
  nsf             numeric(20,4),
  employer_contributions numeric(20,4),
  statutory_complete boolean NOT NULL DEFAULT false,
  missing_rules   jsonb NOT NULL DEFAULT '[]'::jsonb,
  warnings        jsonb NOT NULL DEFAULT '[]'::jsonb,
  input_hash      text NOT NULL,
  rule_version    text,
  calculated_by   uuid REFERENCES app_users(id) ON DELETE SET NULL,
  calculated_at   timestamptz NOT NULL DEFAULT now(),
  approved_by     uuid REFERENCES app_users(id) ON DELETE SET NULL,
  approved_at     timestamptz,
  UNIQUE (period_id, employee_id, version)
);
CREATE INDEX IF NOT EXISTS payroll_calculations_period_idx
  ON payroll_calculations (company_id, period_id, employee_id);

CREATE TABLE IF NOT EXISTS payroll_calculation_lines (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  calculation_id  uuid NOT NULL REFERENCES payroll_calculations(id) ON DELETE CASCADE,
  line_no         int NOT NULL,
  line_type       text NOT NULL CHECK (line_type IN ('base', 'earning', 'deduction', 'reimbursement', 'advance', 'loan', 'employer')),
  code            text NOT NULL,
  label_en        text NOT NULL,
  label_fr        text NOT NULL,
  quantity        numeric(20,4),
  rate            numeric(20,4),
  amount          numeric(20,4) NOT NULL,
  source          text,
  note            text
);
CREATE INDEX IF NOT EXISTS payroll_calculation_lines_idx
  ON payroll_calculation_lines (calculation_id, line_no);

CREATE TABLE IF NOT EXISTS payroll_payslips (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id      uuid NOT NULL REFERENCES cabinets(id) ON DELETE CASCADE,
  company_id      uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  calculation_id  uuid NOT NULL UNIQUE REFERENCES payroll_calculations(id) ON DELETE CASCADE,
  period_id       uuid NOT NULL REFERENCES payroll_periods(id) ON DELETE CASCADE,
  employee_id     uuid NOT NULL REFERENCES payroll_employees(id) ON DELETE CASCADE,
  payslip_no      text NOT NULL,
  status          text NOT NULL DEFAULT 'simulation' CHECK (status IN ('simulation', 'final')),
  version         int NOT NULL DEFAULT 1,
  snapshot        jsonb NOT NULL,
  generated_by    uuid REFERENCES app_users(id) ON DELETE SET NULL,
  generated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, payslip_no)
);
CREATE INDEX IF NOT EXISTS payroll_payslips_period_idx
  ON payroll_payslips (company_id, period_id, employee_id);

-- 8. Audit events specific to payroll ---------------------------------------
CREATE TABLE IF NOT EXISTS payroll_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id   uuid NOT NULL REFERENCES cabinets(id) ON DELETE CASCADE,
  company_id   uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  entity_type  text NOT NULL,
  entity_id    uuid,
  action       text NOT NULL,
  details      jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_id     uuid REFERENCES app_users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS payroll_events_company_idx
  ON payroll_events (company_id, created_at DESC);

-- 9. Guard rails -------------------------------------------------------------
-- A payslip can never be final while its calculation is not finalised.
CREATE OR REPLACE FUNCTION mc_guard_payroll_payslip_status() RETURNS trigger AS $$
DECLARE
  calc_status text;
BEGIN
  SELECT status INTO calc_status FROM payroll_calculations WHERE id = NEW.calculation_id;
  IF NEW.status = 'final' AND calc_status <> 'finalised' THEN
    RAISE EXCEPTION 'PAYROLL_PAYSLIP_NOT_FINALISABLE';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS mc_payroll_payslip_status ON payroll_payslips;
CREATE TRIGGER mc_payroll_payslip_status
  BEFORE INSERT OR UPDATE ON payroll_payslips
  FOR EACH ROW EXECUTE FUNCTION mc_guard_payroll_payslip_status();

-- A period cannot be finalised without every calculation finalised.
CREATE OR REPLACE FUNCTION mc_guard_payroll_period_finalise() RETURNS trigger AS $$
BEGIN
  IF NEW.status = 'finalised' AND OLD.status IS DISTINCT FROM 'finalised' THEN
    IF EXISTS (SELECT 1 FROM payroll_calculations c WHERE c.period_id = NEW.id AND c.status <> 'finalised') THEN
      RAISE EXCEPTION 'PAYROLL_PERIOD_NOT_READY';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS mc_payroll_period_finalise ON payroll_periods;
CREATE TRIGGER mc_payroll_period_finalise
  BEFORE UPDATE ON payroll_periods
  FOR EACH ROW EXECUTE FUNCTION mc_guard_payroll_period_finalise();

-- Isolation: every payroll child row must belong to the same company.
CREATE OR REPLACE FUNCTION mc_guard_payroll_company() RETURNS trigger AS $$
BEGIN
  IF TG_TABLE_NAME IN ('payroll_contracts', 'payroll_time_entries', 'payroll_absences', 'payroll_variables', 'payroll_calculations', 'payroll_payslips') THEN
    IF NOT EXISTS (SELECT 1 FROM companies c WHERE c.id = NEW.company_id) THEN
      RAISE EXCEPTION 'PAYROLL_COMPANY_INVALID';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
