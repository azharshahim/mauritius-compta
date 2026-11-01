-- ---------------------------------------------------------------------------
-- 0025_cabinet_onboarding.sql - Mission 44, Accountant Workspace
--
-- Additive and reversible. No existing table is rewritten, no existing row is
-- updated. Three new tables hold the client-file onboarding, and a handful of
-- nullable descriptive columns are added to `companies` (trading name, contact,
-- legal form...). Accounting data continues to live in the existing tables:
-- this migration creates **no** second accounting engine and no second client
-- master file — `companies` remains the single client repository.
--
-- Down migration (manual, tested in docs/cabinet-onboarding.md):
--   ALTER TABLE companies
--     DROP COLUMN IF EXISTS trade_name,
--     DROP COLUMN IF EXISTS contact_name,
--     DROP COLUMN IF EXISTS contact_email,
--     DROP COLUMN IF EXISTS contact_phone,
--     DROP COLUMN IF EXISTS legal_form,
--     DROP COLUMN IF EXISTS incorporation_date,
--     DROP COLUMN IF EXISTS business_description,
--     DROP COLUMN IF EXISTS country;
--   DROP TABLE IF EXISTS client_kyc_checks;
--   DROP TABLE IF EXISTS client_onboarding;
--   DROP TABLE IF EXISTS cabinet_client_drafts;
-- ---------------------------------------------------------------------------

-- Descriptive fields requested by the accountant on the first onboarding step.
-- All nullable: existing dossiers keep working untouched.
ALTER TABLE companies ADD COLUMN IF NOT EXISTS trade_name          text;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS contact_name        text;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS contact_email       text;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS contact_phone       text;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS legal_form          text;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS incorporation_date  date;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS business_description text;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS country             text;

-- ---------------------------------------------------------------------------
-- 1. Drafts of the guided "Create New Client" assistant.
--
-- A draft belongs to the user who typed it, not to a company: no incomplete
-- dossier ever appears in the client list, and no half-created tenant exists.
-- The payload is exactly what the assistant collected; nothing is posted.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cabinet_client_drafts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  current_step  smallint NOT NULL DEFAULT 1 CHECK (current_step BETWEEN 1 AND 6),
  payload       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cabinet_client_drafts_owner_idx
  ON cabinet_client_drafts (owner_user_id, updated_at DESC);

-- ---------------------------------------------------------------------------
-- 2. Onboarding state of an existing client company.
--
-- `companies` stays the client master file; this table only adds the cabinet
-- workflow around it. A missing row means "not started" and is created on the
-- first write or on activation.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS client_onboarding (
  company_id             uuid PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  status                 text NOT NULL DEFAULT 'in_progress'
                           CHECK (status IN ('not_started', 'in_progress', 'pending_review', 'approved', 'rejected')),
  kyc_review_status      text NOT NULL DEFAULT 'not_started'
                           CHECK (kyc_review_status IN ('not_started', 'in_progress', 'pending_review', 'approved', 'rejected')),
  current_step           smallint NOT NULL DEFAULT 1 CHECK (current_step BETWEEN 1 AND 6),
  sector                 text,
  sector_notes           text,
  accounting_setup       jsonb NOT NULL DEFAULT '{}'::jsonb,
  selected_modules       jsonb NOT NULL DEFAULT '[]'::jsonb,
  assigned_accountant_id uuid REFERENCES app_users(id) ON DELETE SET NULL,
  activated_at           timestamptz,
  activated_by           uuid REFERENCES app_users(id) ON DELETE SET NULL,
  last_activity_at       timestamptz NOT NULL DEFAULT now(),
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS client_onboarding_status_idx ON client_onboarding (status);
CREATE INDEX IF NOT EXISTS client_onboarding_accountant_idx ON client_onboarding (assigned_accountant_id);

-- ---------------------------------------------------------------------------
-- 3. KYC checklist.
--
-- A checklist of *expected* documents and of the cabinet's follow-up. It does
-- not store any identity document: `document_ref` is a free reference (file
-- name, physical folder, future secure-storage id) and no binary is accepted.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS client_kyc_checks (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  key          text NOT NULL,
  category     text NOT NULL,
  required     boolean NOT NULL DEFAULT true,
  status       text NOT NULL DEFAULT 'not_started'
                 CHECK (status IN ('not_started', 'requested', 'received', 'verified', 'missing', 'needs_correction', 'not_applicable')),
  document_ref text,
  note         text,
  updated_by   uuid REFERENCES app_users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, key)
);
CREATE INDEX IF NOT EXISTS client_kyc_checks_company_idx
  ON client_kyc_checks (company_id, category, key);
