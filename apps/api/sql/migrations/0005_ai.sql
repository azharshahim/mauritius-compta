-- ---------------------------------------------------------------------------
-- 0005_ai.sql - Mauritius AI Engine, multi-provider (mission 5)
--
-- Additive only. Nothing is dropped, no column is rewritten and every
-- statement is idempotent, so the migration can be replayed on an existing
-- database without losing accounting data.
--
--  1. `cabinets`: an accounting firm that owns one or more client dossiers.
--     Existing companies are attached to a cabinet derived from their
--     administrator, which keeps single-cabinet installations working.
--  2. AI configuration per cabinet: toggle, provider/model selection, fallback,
--     monthly budget, per-module feature switches.
--  3. API credentials, encrypted at rest with a dedicated key (never stored in
--     clear, never returned by the API).
--  4. Usage and cost tracking per cabinet, company, provider, model, module.
--  5. Account-suggestion proposals, their human decision trail and the
--     per-company rules learned from validated proposals.
--  6. A dated price catalogue (no price is assumed to be current).
-- ---------------------------------------------------------------------------

-- 1. Cabinets ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cabinets (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL CHECK (btrim(name) <> ''),
  owner_user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cabinets_owner_idx ON cabinets (owner_user_id);

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS cabinet_id uuid REFERENCES cabinets(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS companies_cabinet_idx
  ON companies (cabinet_id)
  WHERE cabinet_id IS NOT NULL;

-- One cabinet per existing administrator (idempotent).
INSERT INTO cabinets (name, owner_user_id)
SELECT DISTINCT 'Cabinet ' || split_part(u.email, '@', 1), m.user_id
  FROM company_members m
  JOIN app_users u ON u.id = m.user_id
 WHERE m.role IN ('owner', 'admin', 'cabinet_admin')
   AND NOT EXISTS (SELECT 1 FROM cabinets cb WHERE cb.owner_user_id = m.user_id)
   AND NOT EXISTS (
     SELECT 1 FROM company_members m2 JOIN cabinets cb2 ON cb2.owner_user_id = m2.user_id
      WHERE m2.company_id = m.company_id
   );

-- Attach each orphan company to the cabinet of one of its administrators.
UPDATE companies c
   SET cabinet_id = sub.cabinet_id
  FROM (
    SELECT DISTINCT ON (m.company_id) m.company_id, cb.id AS cabinet_id
      FROM company_members m
      JOIN cabinets cb ON cb.owner_user_id = m.user_id
     WHERE m.role IN ('owner', 'admin', 'cabinet_admin')
     ORDER BY m.company_id, cb.created_at ASC
  ) sub
 WHERE c.id = sub.company_id
   AND c.cabinet_id IS NULL;

-- 2. AI settings ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ai_settings (
  cabinet_id         uuid PRIMARY KEY REFERENCES cabinets(id) ON DELETE CASCADE,
  enabled            boolean NOT NULL DEFAULT false,
  -- Provider/model keys come from the catalogue (config/ai-providers.json),
  -- never from a hard-coded list in the code.
  primary_provider   text,
  primary_model      text,
  fallback_provider  text,
  fallback_model     text,
  routing_mode       text NOT NULL DEFAULT 'manual'
                       CHECK (routing_mode IN ('manual', 'automatic')),
  monthly_budget_usd numeric(12, 4) CHECK (monthly_budget_usd IS NULL OR monthly_budget_usd >= 0),
  -- Hard cap that works even without a dated price on file.
  monthly_request_limit integer CHECK (monthly_request_limit IS NULL OR monthly_request_limit > 0),
  -- Per-provider options (custom base URL, model override), validated server side.
  provider_options   jsonb NOT NULL DEFAULT '{}'::jsonb,
  alert_threshold    integer NOT NULL DEFAULT 80
                       CHECK (alert_threshold BETWEEN 1 AND 100),
  -- Feature switches per module: {"accounting": true, "billing": false, ...}
  features           jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Mode B (AI included in the subscription, shared keys) stays disabled.
  shared_pool_enabled boolean NOT NULL DEFAULT false
                        CHECK (shared_pool_enabled = false),
  updated_by         uuid REFERENCES app_users(id) ON DELETE SET NULL,
  updated_at         timestamptz NOT NULL DEFAULT now()
);

-- 3. Credentials ---------------------------------------------------------------
--    `ciphertext` holds `iv.tag.payload` encoded in base64 (AES-256-GCM).
--    No hint about the key length or characters is stored: only a creation date
--    and the version of the encryption key, which makes rotation auditable.
CREATE TABLE IF NOT EXISTS ai_credentials (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id   uuid NOT NULL REFERENCES cabinets(id) ON DELETE CASCADE,
  provider     text NOT NULL,
  ciphertext   text NOT NULL,
  key_version  text NOT NULL,
  created_by   uuid REFERENCES app_users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  rotated_at   timestamptz,
  revoked_at   timestamptz,
  last_used_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS ai_credentials_cabinet_provider_idx
  ON ai_credentials (cabinet_id, provider)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS ai_credentials_cabinet_idx ON ai_credentials (cabinet_id);

-- 4. Usage and cost control ----------------------------------------------------
CREATE TABLE IF NOT EXISTS ai_usage (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id         uuid NOT NULL REFERENCES cabinets(id) ON DELETE CASCADE,
  company_id         uuid REFERENCES companies(id) ON DELETE SET NULL,
  module             text NOT NULL,
  feature            text NOT NULL,
  provider           text NOT NULL,
  model              text NOT NULL,
  request_count      integer NOT NULL DEFAULT 1,
  input_tokens       integer CHECK (input_tokens IS NULL OR input_tokens >= 0),
  output_tokens      integer CHECK (output_tokens IS NULL OR output_tokens >= 0),
  estimated_cost_usd numeric(12, 6) CHECK (estimated_cost_usd IS NULL OR estimated_cost_usd >= 0),
  -- 'catalogue' = computed from a dated price row, 'unknown' = no price on
  -- file. An unknown cost is stored as NULL, never as an invented amount.
  cost_source        text NOT NULL DEFAULT 'unknown'
                       CHECK (cost_source IN ('catalogue', 'unknown')),
  status             text NOT NULL
                       CHECK (status IN ('ok', 'error', 'timeout', 'blocked', 'refused')),
  error_code         text,
  latency_ms         integer CHECK (latency_ms IS NULL OR latency_ms >= 0),
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_usage_cabinet_month_idx
  ON ai_usage (cabinet_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_usage_company_idx
  ON ai_usage (company_id, created_at DESC)
  WHERE company_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ai_usage_provider_idx
  ON ai_usage (cabinet_id, provider, model, created_at DESC);

-- 5. Account suggestions -------------------------------------------------------
CREATE TABLE IF NOT EXISTS ai_suggestions (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id             uuid NOT NULL REFERENCES cabinets(id) ON DELETE CASCADE,
  company_id             uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  module                 text NOT NULL DEFAULT 'accounting',
  feature                text NOT NULL DEFAULT 'account_suggestion',
  input_text             text NOT NULL,
  amount                 numeric(20, 4),
  currency               text,
  suggested_account_id   uuid REFERENCES accounts(id) ON DELETE SET NULL,
  suggested_account_code text,
  category               text,
  rationale              text,
  confidence             numeric(4, 3) CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  status                 text NOT NULL DEFAULT 'proposed'
                           CHECK (status IN ('proposed', 'accepted', 'modified', 'rejected')),
  decided_account_id     uuid REFERENCES accounts(id) ON DELETE SET NULL,
  decided_by             uuid REFERENCES app_users(id) ON DELETE SET NULL,
  decided_at             timestamptz,
  source                 text NOT NULL DEFAULT 'provider'
                           CHECK (source IN ('provider', 'rule')),
  provider               text,
  model                  text,
  created_by             uuid REFERENCES app_users(id) ON DELETE SET NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  -- A suggestion never creates an accounting entry by itself. The link below is
  -- only filled once a human has posted the entry in the accounting module.
  posted_entry_id        uuid REFERENCES journal_entries(id) ON DELETE SET NULL,
  CONSTRAINT ai_suggestions_decided_chk
    CHECK (status = 'proposed' OR (decided_by IS NOT NULL AND decided_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS ai_suggestions_company_idx
  ON ai_suggestions (company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_suggestions_cabinet_idx
  ON ai_suggestions (cabinet_id, created_at DESC);

-- Rules learned from *validated* proposals: always scoped to one company unless
-- the cabinet explicitly shares them (out of scope for this mission).
CREATE TABLE IF NOT EXISTS ai_account_rules (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  keyword    text NOT NULL CHECK (btrim(keyword) <> ''),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  use_count  integer NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX IF NOT EXISTS ai_account_rules_company_keyword_idx
  ON ai_account_rules (company_id, lower(keyword));

CREATE INDEX IF NOT EXISTS ai_account_rules_company_idx ON ai_account_rules (company_id);

-- Metadata-only call log: provider, model, tokens, latency, status. Prompt and
-- document contents are deliberately NOT stored here.
CREATE TABLE IF NOT EXISTS ai_request_log (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id    uuid NOT NULL REFERENCES cabinets(id) ON DELETE CASCADE,
  company_id    uuid REFERENCES companies(id) ON DELETE SET NULL,
  user_id       uuid REFERENCES app_users(id) ON DELETE SET NULL,
  module        text NOT NULL,
  feature       text NOT NULL,
  provider      text NOT NULL,
  model         text NOT NULL,
  status        text NOT NULL,
  error_code    text,
  latency_ms    integer,
  input_tokens  integer,
  output_tokens integer,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_request_log_cabinet_idx
  ON ai_request_log (cabinet_id, created_at DESC);

-- 6. Price catalogue -----------------------------------------------------------
--    Prices are *dated data*, not constants in the code. Rows are seeded from
--    config/ai-providers.json with `verified = false`: automatic routing stays
--    disabled until an operator confirms them.
CREATE TABLE IF NOT EXISTS ai_prices (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider              text NOT NULL,
  model                 text NOT NULL,
  input_usd_per_mtok    numeric(12, 6) NOT NULL CHECK (input_usd_per_mtok >= 0),
  output_usd_per_mtok   numeric(12, 6) NOT NULL CHECK (output_usd_per_mtok >= 0),
  effective_from        date NOT NULL,
  source                text NOT NULL,
  verified              boolean NOT NULL DEFAULT false,
  notes                 text,
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ai_prices_provider_model_from_idx
  ON ai_prices (provider, model, effective_from);
