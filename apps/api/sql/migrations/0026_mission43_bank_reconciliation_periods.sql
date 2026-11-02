-- 0026_mission43_bank_reconciliation_periods.sql
-- Mission 43 (C-01/C-02/C-03): explicit bank statement periods.
--
-- A reconciliation period freezes the statement opening/closing balances and
-- the ledger opening/closing balances that were reviewed by a human. Validation
-- NEVER posts a journal entry: any adjustment stays a separate proposal.
-- The table is additive; no existing bank, billing or purchase data is changed.

CREATE TABLE IF NOT EXISTS bank_reconciliation_periods (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id           uuid NOT NULL REFERENCES cabinets(id) ON DELETE CASCADE,
  company_id           uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  bank_account_id      uuid NOT NULL REFERENCES bank_accounts(id) ON DELETE CASCADE,
  period_from          date NOT NULL,
  period_to            date NOT NULL,
  currency             text NOT NULL,
  opening_bank         numeric(20,4),
  closing_bank         numeric(20,4),
  opening_ledger       numeric(20,4) NOT NULL DEFAULT 0,
  closing_ledger       numeric(20,4) NOT NULL DEFAULT 0,
  difference           numeric(20,4) NOT NULL DEFAULT 0,
  accepted_difference  numeric(20,4) NOT NULL DEFAULT 0,
  status               text NOT NULL DEFAULT 'open'
                         CHECK (status IN ('open', 'validated', 'reopened')),
  statement_hash       text NOT NULL,
  matched_count        integer NOT NULL DEFAULT 0,
  partial_count        integer NOT NULL DEFAULT 0,
  unmatched_count      integer NOT NULL DEFAULT 0,
  excluded_count       integer NOT NULL DEFAULT 0,
  note                 text,
  validated_by         uuid REFERENCES app_users(id) ON DELETE SET NULL,
  validated_at         timestamptz,
  reopened_by          uuid REFERENCES app_users(id) ON DELETE SET NULL,
  reopened_at          timestamptz,
  reopen_reason        text,
  created_by           uuid REFERENCES app_users(id) ON DELETE SET NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bank_reconciliation_periods_dates CHECK (period_from <= period_to)
);

CREATE UNIQUE INDEX IF NOT EXISTS bank_reconciliation_periods_unique
  ON bank_reconciliation_periods (company_id, bank_account_id, period_from, period_to);
CREATE INDEX IF NOT EXISTS bank_reconciliation_periods_status_idx
  ON bank_reconciliation_periods (company_id, bank_account_id, status, period_to DESC);

-- Human decisions on a period are append-only. Reopening keeps the previous
-- validation history instead of overwriting it.
CREATE TABLE IF NOT EXISTS bank_reconciliation_period_events (
  id          bigserial PRIMARY KEY,
  cabinet_id  uuid NOT NULL REFERENCES cabinets(id) ON DELETE CASCADE,
  company_id  uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  period_id   uuid NOT NULL REFERENCES bank_reconciliation_periods(id) ON DELETE CASCADE,
  event       text NOT NULL,
  actor_id    uuid REFERENCES app_users(id) ON DELETE SET NULL,
  note        text,
  metadata    jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bank_reconciliation_period_events_idx
  ON bank_reconciliation_period_events (period_id, created_at);

-- Mission 42.1 (Phase A): the supplier-advance account (default 1150) is
-- configurable per company. A dedicated, active asset account can be chosen
-- instead of the provisional shared 1150 "Advances to Suppliers" account.
-- No existing value is changed; NULL keeps the current behaviour.
ALTER TABLE billing_settings
  ADD COLUMN IF NOT EXISTS advance_to_supplier_account_id uuid
    REFERENCES accounts(id) ON DELETE SET NULL;
