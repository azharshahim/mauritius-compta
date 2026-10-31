-- ---------------------------------------------------------------------------
-- 0013_multi_currency.sql - multi-currency, validated rates and FX differences
--
-- Additive: no existing amount, entry, invoice or rate is rewritten.
--
-- Design rules:
--   * the functional currency of a company is locked as soon as a posted entry
--     exists; changing it later is a separate, unimplemented procedure;
--   * a rate is an immutable, dated and sourced row. Only an explicit human
--     validation makes it usable; a new version supersedes the old one;
--   * no last-known rate is ever selected silently, and inverse pairs are never
--     derived automatically;
--   * realized differences are proposed, never posted automatically;
--   * latent revaluations are simulations until the accounting treatment is
--     validated by a professional (posting is deliberately blocked).
-- ---------------------------------------------------------------------------

-- 1. Currencies allowed per company -----------------------------------------
CREATE TABLE IF NOT EXISTS company_currencies (
  company_id  uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  currency    char(3) NOT NULL,
  is_allowed  boolean NOT NULL DEFAULT true,
  created_by  uuid REFERENCES app_users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, currency)
);

INSERT INTO company_currencies (company_id, currency)
SELECT c.id, c.functional_currency FROM companies c
ON CONFLICT (company_id, currency) DO NOTHING;

INSERT INTO company_currencies (company_id, currency)
SELECT DISTINCT company_id, currency FROM billing_documents
ON CONFLICT (company_id, currency) DO NOTHING;

INSERT INTO company_currencies (company_id, currency)
SELECT DISTINCT company_id, currency FROM purchase_documents
ON CONFLICT (company_id, currency) DO NOTHING;

-- 2. Company FX configuration ------------------------------------------------
CREATE TABLE IF NOT EXISTS fx_settings (
  company_id              uuid PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  functional_locked       boolean NOT NULL DEFAULT false,
  functional_locked_at    timestamptz,
  functional_locked_by    uuid REFERENCES app_users(id) ON DELETE SET NULL,
  -- Default policy: only validated rows of the exact currency pair and date.
  rate_policy             text NOT NULL DEFAULT 'validated_only'
                            CHECK (rate_policy IN ('validated_only')),
  fx_gain_account_id      uuid REFERENCES accounts(id) ON DELETE RESTRICT,
  fx_loss_account_id      uuid REFERENCES accounts(id) ON DELETE RESTRICT,
  valuation_enabled       boolean NOT NULL DEFAULT false,
  valuation_posting       boolean NOT NULL DEFAULT false,
  notes                   text,
  updated_by              uuid REFERENCES app_users(id) ON DELETE SET NULL,
  updated_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fx_settings_valuation_posting_chk
    CHECK (valuation_posting = false)
);

INSERT INTO fx_settings (company_id, functional_locked, functional_locked_at)
SELECT c.id,
       EXISTS (SELECT 1 FROM journal_entries e WHERE e.company_id = c.id AND e.status = 'posted'),
       CASE WHEN EXISTS (SELECT 1 FROM journal_entries e WHERE e.company_id = c.id AND e.status = 'posted')
            THEN now() ELSE NULL END
  FROM companies c
ON CONFLICT (company_id) DO NOTHING;

-- The two FX accounts must belong to the same company and have a compatible
-- nature. No account is ever guessed by the database.
CREATE OR REPLACE FUNCTION mc_guard_fx_settings_accounts()
RETURNS trigger AS $$
DECLARE
  v_company uuid;
  v_type text;
BEGIN
  IF NEW.fx_gain_account_id IS NOT NULL THEN
    SELECT company_id, type INTO v_company, v_type FROM accounts WHERE id = NEW.fx_gain_account_id;
    IF v_company IS NULL OR v_company <> NEW.company_id OR v_type NOT IN ('revenue') THEN
      RAISE EXCEPTION 'FX_ACCOUNT_INVALID: the gain account must be a revenue account of this company'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF NEW.fx_loss_account_id IS NOT NULL THEN
    SELECT company_id, type INTO v_company, v_type FROM accounts WHERE id = NEW.fx_loss_account_id;
    IF v_company IS NULL OR v_company <> NEW.company_id OR v_type NOT IN ('expense') THEN
      RAISE EXCEPTION 'FX_ACCOUNT_INVALID: the loss account must be an expense account of this company'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS fx_settings_accounts_trg ON fx_settings;
CREATE TRIGGER fx_settings_accounts_trg
  BEFORE INSERT OR UPDATE ON fx_settings
  FOR EACH ROW EXECUTE FUNCTION mc_guard_fx_settings_accounts();

-- 3. Dated, sourced and versioned rates --------------------------------------
CREATE TABLE IF NOT EXISTS fx_rates (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  base_currency   char(3) NOT NULL,
  quote_currency  char(3) NOT NULL,
  rate_date       date NOT NULL,
  rate            numeric(20,8) NOT NULL CHECK (rate > 0),
  source_kind     text NOT NULL
                    CHECK (source_kind IN ('manual', 'imported', 'demo')),
  source          text NOT NULL,
  reference       text,
  status          text NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft', 'validated', 'rejected', 'superseded')),
  version         integer NOT NULL DEFAULT 1 CHECK (version > 0),
  supersedes_id   uuid REFERENCES fx_rates(id) ON DELETE RESTRICT,
  created_by      uuid REFERENCES app_users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  validated_by    uuid REFERENCES app_users(id) ON DELETE SET NULL,
  validated_at    timestamptz,
  validation_note text,
  CONSTRAINT fx_rates_pair_chk CHECK (base_currency <> quote_currency),
  CONSTRAINT fx_rates_source_chk CHECK (length(btrim(source)) > 0),
  CONSTRAINT fx_rates_validation_chk CHECK (
    (status = 'draft' AND validated_at IS NULL AND validated_by IS NULL)
    OR (status = 'validated' AND validated_at IS NOT NULL AND validated_by IS NOT NULL)
    OR status = 'rejected'
    OR status = 'superseded'
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS fx_rates_version_uniq
  ON fx_rates (company_id, base_currency, quote_currency, rate_date, version);
CREATE UNIQUE INDEX IF NOT EXISTS fx_rates_one_validated_uniq
  ON fx_rates (company_id, base_currency, quote_currency, rate_date)
  WHERE status = 'validated';
CREATE INDEX IF NOT EXISTS fx_rates_lookup_idx
  ON fx_rates (company_id, base_currency, quote_currency, rate_date DESC, status);
CREATE INDEX IF NOT EXISTS fx_rates_company_idx
  ON fx_rates (company_id, rate_date DESC, base_currency, quote_currency);

CREATE TABLE IF NOT EXISTS fx_rate_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  rate_id      uuid NOT NULL REFERENCES fx_rates(id) ON DELETE CASCADE,
  action       text NOT NULL
                 CHECK (action IN ('created', 'validated', 'rejected', 'superseded')),
  actor_id     uuid REFERENCES app_users(id) ON DELETE SET NULL,
  reason       text,
  snapshot     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fx_rate_events_idx
  ON fx_rate_events (company_id, rate_id, created_at DESC);

-- A rate row is immutable. The only allowed transitions are:
-- draft -> validated / rejected, and validated -> superseded.
CREATE OR REPLACE FUNCTION mc_guard_fx_rate_immutable()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'FX_RATE_IMMUTABLE: rate rows are never deleted'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.company_id <> OLD.company_id
     OR NEW.base_currency <> OLD.base_currency
     OR NEW.quote_currency <> OLD.quote_currency
     OR NEW.rate_date <> OLD.rate_date
     OR NEW.rate <> OLD.rate
     OR NEW.source_kind <> OLD.source_kind
     OR NEW.source <> OLD.source
     OR NEW.reference IS DISTINCT FROM OLD.reference
     OR NEW.version <> OLD.version THEN
    RAISE EXCEPTION 'FX_RATE_IMMUTABLE: currency pair, date, value and source cannot change'
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status = 'validated' AND NEW.status <> 'superseded' THEN
    RAISE EXCEPTION 'FX_RATE_IMMUTABLE: a validated rate can only be superseded'
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status IN ('rejected', 'superseded') AND NEW.status <> OLD.status THEN
    RAISE EXCEPTION 'FX_RATE_IMMUTABLE: a closed rate cannot be reopened'
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status = 'draft' AND NEW.status NOT IN ('draft', 'validated', 'rejected') THEN
    RAISE EXCEPTION 'FX_RATE_IMMUTABLE: invalid transition'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS fx_rates_immutable_trg ON fx_rates;
CREATE TRIGGER fx_rates_immutable_trg
  BEFORE UPDATE OR DELETE ON fx_rates
  FOR EACH ROW EXECUTE FUNCTION mc_guard_fx_rate_immutable();

-- 4. Realized FX differences -------------------------------------------------
CREATE TABLE IF NOT EXISTS fx_realized_adjustments (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id               uuid NOT NULL REFERENCES cabinets(id) ON DELETE CASCADE,
  company_id               uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  side                     text NOT NULL CHECK (side IN ('customer', 'supplier')),
  source_type              text NOT NULL
                             CHECK (source_type IN ('billing', 'purchase')),
  invoice_id               uuid NOT NULL,
  payment_id               uuid NOT NULL,
  invoice_no               text,
  payment_no               text,
  partner_name             text,
  currency                 char(3) NOT NULL,
  invoice_rate             numeric(20,8) NOT NULL CHECK (invoice_rate > 0),
  settlement_rate          numeric(20,8) NOT NULL CHECK (settlement_rate > 0),
  settled_txn_amount       numeric(20,4) NOT NULL CHECK (settled_txn_amount > 0),
  invoice_functional       numeric(20,4) NOT NULL CHECK (invoice_functional > 0),
  settlement_functional    numeric(20,4) NOT NULL CHECK (settlement_functional > 0),
  difference               numeric(20,4) NOT NULL CHECK (difference > 0),
  direction                text NOT NULL CHECK (direction IN ('gain', 'loss')),
  status                   text NOT NULL DEFAULT 'proposed'
                             CHECK (status IN ('proposed', 'posted', 'rejected')),
  entry_id                 uuid UNIQUE REFERENCES journal_entries(id) ON DELETE RESTRICT,
  rationale                text,
  created_by               uuid REFERENCES app_users(id) ON DELETE SET NULL,
  created_at               timestamptz NOT NULL DEFAULT now(),
  decided_by               uuid REFERENCES app_users(id) ON DELETE SET NULL,
  decided_at               timestamptz,
  CONSTRAINT fx_realized_diff_chk
    CHECK (difference = abs(settlement_functional - invoice_functional)),
  CONSTRAINT fx_realized_direction_chk
    CHECK (
      (side = 'customer' AND direction = 'gain' AND settlement_functional > invoice_functional)
      OR (side = 'customer' AND direction = 'loss' AND settlement_functional < invoice_functional)
      OR (side = 'supplier' AND direction = 'loss' AND settlement_functional > invoice_functional)
      OR (side = 'supplier' AND direction = 'gain' AND settlement_functional < invoice_functional)
    ),
  CONSTRAINT fx_realized_posted_chk
    CHECK ((status = 'posted' AND entry_id IS NOT NULL) OR (status <> 'posted'))
);

CREATE UNIQUE INDEX IF NOT EXISTS fx_realized_source_uniq
  ON fx_realized_adjustments (company_id, source_type, payment_id, invoice_id);
CREATE INDEX IF NOT EXISTS fx_realized_company_idx
  ON fx_realized_adjustments (company_id, status, created_at DESC);

-- 5. Latent revaluation (simulation only) ------------------------------------
CREATE TABLE IF NOT EXISTS fx_revaluations (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id     uuid NOT NULL REFERENCES cabinets(id) ON DELETE CASCADE,
  company_id     uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  valuation_date date NOT NULL,
  status         text NOT NULL DEFAULT 'simulated'
                   CHECK (status IN ('simulated', 'validated', 'rejected')),
  note           text NOT NULL,
  created_by     uuid REFERENCES app_users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  validated_by   uuid REFERENCES app_users(id) ON DELETE SET NULL,
  validated_at   timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS fx_revaluations_date_uniq
  ON fx_revaluations (company_id, valuation_date);

CREATE TABLE IF NOT EXISTS fx_revaluation_lines (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  revaluation_id      uuid NOT NULL REFERENCES fx_revaluations(id) ON DELETE CASCADE,
  company_id          uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  source_type         text NOT NULL
                        CHECK (source_type IN ('billing_document', 'purchase_document', 'bank_account')),
  source_id           uuid NOT NULL,
  document_no         text,
  partner_name        text,
  currency            char(3) NOT NULL,
  amount_txn          numeric(20,4),
  carrying_functional numeric(20,4),
  valuation_rate      numeric(20,8),
  revalued_functional numeric(20,4),
  difference          numeric(20,4),
  direction           text CHECK (direction IN ('gain', 'loss')),
  blocked_reason      text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fx_revaluation_line_unique UNIQUE (revaluation_id, source_type, source_id)
);
CREATE INDEX IF NOT EXISTS fx_revaluation_lines_idx
  ON fx_revaluation_lines (revaluation_id, currency);

-- 6. Internal transfers between company bank accounts (simulation) ----------
CREATE TABLE IF NOT EXISTS fx_transfers (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id            uuid NOT NULL REFERENCES cabinets(id) ON DELETE CASCADE,
  company_id            uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  from_bank_account_id  uuid NOT NULL REFERENCES bank_accounts(id) ON DELETE RESTRICT,
  to_bank_account_id    uuid NOT NULL REFERENCES bank_accounts(id) ON DELETE RESTRICT,
  transfer_date         date NOT NULL,
  from_currency         char(3) NOT NULL,
  to_currency           char(3) NOT NULL,
  from_amount           numeric(20,4) NOT NULL CHECK (from_amount > 0),
  to_amount             numeric(20,4) NOT NULL CHECK (to_amount > 0),
  rate                  numeric(20,8) NOT NULL CHECK (rate > 0),
  fee_amount            numeric(20,4) NOT NULL DEFAULT 0 CHECK (fee_amount >= 0),
  fee_currency          char(3),
  status                text NOT NULL DEFAULT 'simulated'
                          CHECK (status IN ('simulated', 'validated', 'rejected')),
  note                  text NOT NULL,
  created_by            uuid REFERENCES app_users(id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fx_transfers_distinct_chk CHECK (from_bank_account_id <> to_bank_account_id)
);
CREATE INDEX IF NOT EXISTS fx_transfers_company_idx
  ON fx_transfers (company_id, transfer_date DESC);

-- 7. Functional currency lock ------------------------------------------------
CREATE OR REPLACE FUNCTION mc_guard_functional_currency()
RETURNS trigger AS $$
DECLARE
  v_posted boolean;
  v_locked boolean;
BEGIN
  IF NEW.functional_currency = OLD.functional_currency THEN
    RETURN NEW;
  END IF;
  SELECT EXISTS (
    SELECT 1 FROM journal_entries WHERE company_id = OLD.id AND status = 'posted'
  ) INTO v_posted;
  SELECT functional_locked INTO v_locked FROM fx_settings WHERE company_id = OLD.id;
  IF v_posted OR v_locked THEN
    RAISE EXCEPTION 'FUNCTIONAL_CURRENCY_LOCKED: posted entries exist; changing the functional currency requires a controlled migration'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS companies_functional_currency_trg ON companies;
CREATE TRIGGER companies_functional_currency_trg
  BEFORE UPDATE OF functional_currency ON companies
  FOR EACH ROW EXECUTE FUNCTION mc_guard_functional_currency();

-- 8. FX source of journal entries -------------------------------------------
ALTER TABLE journal_entries DROP CONSTRAINT IF EXISTS journal_entries_source_check;
ALTER TABLE journal_entries
  ADD CONSTRAINT journal_entries_source_check
  CHECK (source IN ('manual', 'reversal', 'opening', 'billing', 'purchase', 'ai',
                    'migration', 'migration_opening', 'fx'));
