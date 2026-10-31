-- ---------------------------------------------------------------------------
-- 0004_cabinet.sql - Mauritius Business Suite: cabinet module + foundations
--
-- Additive only. No existing table is dropped or rewritten: the accounting
-- engine (V0.1.1) keeps its tables, its triggers and its data.
--
--  1. Companies become "dossiers" of the cabinet: CRN, dossier manager,
--     archive timestamp and a human client code (all nullable).
--  2. Company roles are extended with the cabinet vocabulary.
--  3. Per-module permissions (cabinet / accounting / billing / payroll) are
--     stored separately from the global role so payroll can never be reached
--     with accounting rights.
--  4. Cabinet tasks, their comments and their history.
--  5. Foundations for billing and payroll: tables and invariants only, no
--     tax/PAYE/CSG/NSF computation.
-- ---------------------------------------------------------------------------

-- 1. Companies -----------------------------------------------------------------
ALTER TABLE companies ADD COLUMN IF NOT EXISTS crn text;
ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS dossier_manager_id uuid REFERENCES app_users(id) ON DELETE SET NULL;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS archived_at timestamptz;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS client_code text;

CREATE UNIQUE INDEX IF NOT EXISTS companies_client_code_idx
  ON companies (lower(client_code))
  WHERE client_code IS NOT NULL AND btrim(client_code) <> '';

CREATE INDEX IF NOT EXISTS companies_dossier_manager_idx
  ON companies (dossier_manager_id)
  WHERE dossier_manager_id IS NOT NULL;

-- 2. Role vocabulary ------------------------------------------------------------
--    Existing rows keep their role: the new labels are additions.
ALTER TABLE company_members DROP CONSTRAINT IF EXISTS company_members_role_check;
ALTER TABLE company_members
  ADD CONSTRAINT company_members_role_check
  CHECK (role IN (
    'owner',            -- legacy: creator of the company
    'admin',            -- legacy: company administrator
    'accountant',       -- accounting collaborator (accounting module)
    'viewer',           -- read-only
    'cabinet_admin',    -- cabinet administrator (all modules)
    'manager',          -- dossier manager
    'billing_clerk',    -- billing collaborator
    'payroll_manager'   -- payroll manager (no accounting write access)
  ));

-- 3. Module permissions ---------------------------------------------------------
--    Effective access = role default (see src/lib/permissions.ts) overridden,
--    module by module, by the rows below. A payroll grant never implies an
--    accounting grant and vice versa.
CREATE TABLE IF NOT EXISTS company_module_access (
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  module     text NOT NULL CHECK (module IN ('cabinet', 'accounting', 'billing', 'payroll')),
  access     text NOT NULL CHECK (access IN ('read', 'write', 'admin')),
  granted_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, user_id, module)
);
CREATE INDEX IF NOT EXISTS company_module_access_user_idx
  ON company_module_access (user_id, module);

-- The grant must reference an actual member of the company ----------------------
CREATE OR REPLACE FUNCTION mc_guard_module_access()
RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM company_members
     WHERE company_id = NEW.company_id AND user_id = NEW.user_id
  ) THEN
    RAISE EXCEPTION 'NOT_A_MEMBER: module access requires a company membership'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS company_module_access_member_trg ON company_module_access;
CREATE TRIGGER company_module_access_member_trg
  BEFORE INSERT OR UPDATE ON company_module_access
  FOR EACH ROW EXECUTE FUNCTION mc_guard_module_access();

-- 4. Cabinet tasks ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cabinet_tasks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  title       text NOT NULL CHECK (length(btrim(title)) > 0),
  description text,
  category    text NOT NULL CHECK (category IN (
                'accounting', 'vat', 'tax', 'payroll', 'financial_statements', 'administrative')),
  priority    text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  status      text NOT NULL DEFAULT 'todo'
                CHECK (status IN ('todo', 'in_progress', 'blocked', 'done', 'cancelled')),
  due_date    date,
  assigned_to uuid REFERENCES app_users(id) ON DELETE SET NULL,
  created_by  uuid REFERENCES app_users(id) ON DELETE SET NULL,
  completed_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cabinet_tasks_company_idx
  ON cabinet_tasks (company_id, status, due_date);
CREATE INDEX IF NOT EXISTS cabinet_tasks_assignee_idx
  ON cabinet_tasks (assigned_to, status);

CREATE TABLE IF NOT EXISTS cabinet_task_comments (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id    uuid NOT NULL REFERENCES cabinet_tasks(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  author_id  uuid REFERENCES app_users(id) ON DELETE SET NULL,
  body       text NOT NULL CHECK (length(btrim(body)) > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cabinet_task_comments_task_idx
  ON cabinet_task_comments (task_id, created_at);

-- Task assignments must target a member of the same company ---------------------
CREATE OR REPLACE FUNCTION mc_guard_task_member()
RETURNS trigger AS $$
BEGIN
  IF NEW.assigned_to IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM company_members
     WHERE company_id = NEW.company_id AND user_id = NEW.assigned_to
  ) THEN
    RAISE EXCEPTION 'NOT_A_MEMBER: task assignee must belong to the company'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS cabinet_tasks_assignee_trg ON cabinet_tasks;
CREATE TRIGGER cabinet_tasks_assignee_trg
  BEFORE INSERT OR UPDATE ON cabinet_tasks
  FOR EACH ROW EXECUTE FUNCTION mc_guard_task_member();

-- A comment must belong to the company of its task -------------------------------
CREATE OR REPLACE FUNCTION mc_guard_task_comment_company()
RETURNS trigger AS $$
DECLARE
  v_company uuid;
BEGIN
  SELECT company_id INTO v_company FROM cabinet_tasks WHERE id = NEW.task_id;
  IF v_company IS NULL OR v_company <> NEW.company_id THEN
    RAISE EXCEPTION 'CROSS_COMPANY_REFERENCE: comment belongs to another company'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS cabinet_task_comments_company_trg ON cabinet_task_comments;
CREATE TRIGGER cabinet_task_comments_company_trg
  BEFORE INSERT OR UPDATE ON cabinet_task_comments
  FOR EACH ROW EXECUTE FUNCTION mc_guard_task_comment_company();

-- 5. Billing foundation -----------------------------------------------------------
--    Documents only: no tax engine, no numbering engine, no MRA submission.
--    `accounting_entry_id` is unique so a document can never be posted twice.
CREATE TABLE IF NOT EXISTS billing_documents (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  kind                text NOT NULL CHECK (kind IN ('quote', 'invoice', 'credit_note')),
  doc_no              text NOT NULL CHECK (length(btrim(doc_no)) > 0),
  customer_name       text NOT NULL,
  customer_brn        text,
  issue_date          date NOT NULL,
  due_date            date,
  currency            char(3) NOT NULL DEFAULT 'MUR',
  total_amount        numeric(20,4) NOT NULL DEFAULT 0,
  status              text NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft', 'issued', 'paid', 'cancelled')),
  accounting_entry_id uuid UNIQUE REFERENCES journal_entries(id) ON DELETE SET NULL,
  created_by          uuid REFERENCES app_users(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS billing_documents_no_idx
  ON billing_documents (company_id, kind, lower(btrim(doc_no)));
CREATE INDEX IF NOT EXISTS billing_documents_company_idx
  ON billing_documents (company_id, status, issue_date DESC);

-- 6. Payroll foundation -----------------------------------------------------------
--    Identity and contracts only. No salary, no PAYE/CSG/NSF: those columns will
--    be added once the Mauritian rules are validated (see docs/mauritius-regulations).
CREATE TABLE IF NOT EXISTS payroll_employees (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  employee_ref text NOT NULL CHECK (length(btrim(employee_ref)) > 0),
  full_name    text NOT NULL,
  job_title    text,
  start_date   date,
  end_date     date,
  status       text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'ended')),
  created_by   uuid REFERENCES app_users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS payroll_employees_ref_idx
  ON payroll_employees (company_id, lower(btrim(employee_ref)));
CREATE INDEX IF NOT EXISTS payroll_employees_company_idx
  ON payroll_employees (company_id, status);

-- 7. Reporting helpers ------------------------------------------------------------
CREATE INDEX IF NOT EXISTS audit_log_user_idx ON audit_log (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_log_entity_idx ON audit_log (entity_type, entity_id);
