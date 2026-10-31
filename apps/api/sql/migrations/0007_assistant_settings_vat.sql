-- ---------------------------------------------------------------------------
-- 0007_assistant_settings_vat.sql - Mission 7
--
-- Additive and idempotent. Migrations 0001-0006 are untouched, no table is
-- dropped, no existing column is rewritten or renamed. Existing accounting,
-- billing and AI data therefore keep their meaning and behaviour.
--
--  1. Company identification: trade name and contacts (the rest already exists).
--  2. Billing settings: sender details, document language, default accounts.
--  3. VAT configuration: explicit fiscal treatment, VAT account, dated human
--     verification trail. No rate is ever seeded by this migration.
--  4. VAT change history (who changed what, when, before/after).
--  5. Universal assistant: conversations, messages and read-only tool runs,
--     scoped to one cabinet, one company and one user, with a retention date.
-- ---------------------------------------------------------------------------

-- 1. Company identification ---------------------------------------------------
ALTER TABLE companies ADD COLUMN IF NOT EXISTS trade_name    text;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS contact_name  text;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS contact_email text;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS contact_phone text;

-- 2. Billing settings: sender details and defaults ----------------------------
ALTER TABLE billing_settings ADD COLUMN IF NOT EXISTS document_language text NOT NULL DEFAULT 'fr';
ALTER TABLE billing_settings ADD COLUMN IF NOT EXISTS logo_url text;
ALTER TABLE billing_settings ADD COLUMN IF NOT EXISTS default_revenue_account_id uuid REFERENCES accounts(id) ON DELETE SET NULL;
ALTER TABLE billing_settings ADD COLUMN IF NOT EXISTS default_receivable_account_id uuid REFERENCES accounts(id) ON DELETE SET NULL;
ALTER TABLE billing_settings ADD COLUMN IF NOT EXISTS default_bank_account_id uuid REFERENCES accounts(id) ON DELETE SET NULL;
ALTER TABLE billing_settings ADD COLUMN IF NOT EXISTS default_purchase_account_id uuid REFERENCES accounts(id) ON DELETE SET NULL;
ALTER TABLE billing_settings ADD COLUMN IF NOT EXISTS default_vat_input_account_id uuid REFERENCES accounts(id) ON DELETE SET NULL;
ALTER TABLE billing_settings ADD COLUMN IF NOT EXISTS default_vat_output_account_id uuid REFERENCES accounts(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'billing_settings_document_language_chk'
  ) THEN
    ALTER TABLE billing_settings
      ADD CONSTRAINT billing_settings_document_language_chk
      CHECK (document_language IN ('fr', 'en'));
  END IF;
END $$;

-- 3. VAT configuration: treatment and verification trail ----------------------
ALTER TABLE billing_tax_rates ADD COLUMN IF NOT EXISTS treatment text NOT NULL DEFAULT 'taxable';
ALTER TABLE billing_tax_rates ADD COLUMN IF NOT EXISTS vat_account_id uuid REFERENCES accounts(id) ON DELETE SET NULL;
ALTER TABLE billing_tax_rates ADD COLUMN IF NOT EXISTS verified_at timestamptz;
ALTER TABLE billing_tax_rates ADD COLUMN IF NOT EXISTS verified_by uuid REFERENCES app_users(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'billing_tax_rates_treatment_chk'
  ) THEN
    ALTER TABLE billing_tax_rates
      ADD CONSTRAINT billing_tax_rates_treatment_chk
      CHECK (treatment IN ('taxable', 'zero_rated', 'exempt', 'out_of_scope'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'billing_tax_rates_rate_range_chk'
  ) THEN
    ALTER TABLE billing_tax_rates
      ADD CONSTRAINT billing_tax_rates_rate_range_chk CHECK (rate >= 0 AND rate <= 100);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'billing_tax_rates_period_chk'
  ) THEN
    ALTER TABLE billing_tax_rates
      ADD CONSTRAINT billing_tax_rates_period_chk
      CHECK (effective_to IS NULL OR effective_to >= effective_from);
  END IF;
END $$;

-- A non-taxable treatment never carries a percentage: the four categories are
-- distinct and must never be silently assimilated.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'billing_tax_rates_treatment_rate_chk'
  ) THEN
    ALTER TABLE billing_tax_rates
      ADD CONSTRAINT billing_tax_rates_treatment_rate_chk
      CHECK (treatment = 'taxable' OR rate = 0);
  END IF;
END $$;

-- 4. VAT change history -------------------------------------------------------
CREATE TABLE IF NOT EXISTS billing_tax_rate_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  tax_rate_id  uuid NOT NULL REFERENCES billing_tax_rates(id) ON DELETE CASCADE,
  action       text NOT NULL CHECK (action IN ('created', 'updated', 'verified', 'unverified', 'archived')),
  actor_id     uuid REFERENCES app_users(id) ON DELETE SET NULL,
  before_state jsonb,
  after_state  jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS billing_tax_rate_events_rate_idx
  ON billing_tax_rate_events (company_id, tax_rate_id, created_at DESC);

-- 5. Universal assistant ------------------------------------------------------
CREATE TABLE IF NOT EXISTS ai_conversations (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  module     text NOT NULL CHECK (module IN ('cabinet', 'accounting', 'billing', 'payroll')),
  screen     text,
  locale     text NOT NULL DEFAULT 'fr' CHECK (locale IN ('fr', 'en')),
  title      text,
  status     text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_conversations_owner_idx
  ON ai_conversations (cabinet_id, company_id, user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS ai_messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
  role            text NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content         text NOT NULL,
  -- Minimal, server-validated navigation context (never a database dump).
  context         jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Structured payload returned to the UI: tool results and proposed actions.
  payload         jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_messages_conversation_idx
  ON ai_messages (conversation_id, created_at);

CREATE TABLE IF NOT EXISTS ai_tool_runs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
  message_id      uuid REFERENCES ai_messages(id) ON DELETE SET NULL,
  company_id      uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id         uuid REFERENCES app_users(id) ON DELETE SET NULL,
  tool_key        text NOT NULL,
  module          text NOT NULL,
  args            jsonb NOT NULL DEFAULT '{}'::jsonb,
  status          text NOT NULL CHECK (status IN ('ok', 'denied', 'error')),
  error_code      text,
  row_count       integer,
  duration_ms     integer,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_tool_runs_conversation_idx
  ON ai_tool_runs (conversation_id, created_at);
CREATE INDEX IF NOT EXISTS ai_tool_runs_company_idx
  ON ai_tool_runs (company_id, created_at DESC);
