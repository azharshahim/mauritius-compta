-- ---------------------------------------------------------------------------
-- 0006_billing.sql - Billing module (mission 6) + AI journal proposals V2
--
-- Additive and idempotent. Migrations 0001-0005 are untouched, no table is
-- dropped, no existing column is rewritten: the accounting engine and the AI
-- engine of mission 5 keep their data and behaviour.
--
--  1. Customers, items, VAT configuration (never seeded: no invented rate) and
--     per-company numbering policy.
--  2. Billing document lines, extended document header (drafts, quotes,
--     invoices, credit notes), immutable numbering and per-document events.
--  3. Payments and their allocations, with over-payment kept as unallocated.
--  4. AI journal proposals (full balanced entries) and their lines, linked to
--     their source document for idempotent posting.
--  5. Deterministic counterparty rules with versions, priority and conflicts.
--  6. Duplicate detection support (indexes only: the check is deterministic in
--     application code, no destructive action).
-- ---------------------------------------------------------------------------

-- 1. Customers ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS billing_customers (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id             uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name                   text NOT NULL CHECK (length(btrim(name)) > 0),
  legal_name             text,
  brn                    text,
  vat_number             text,
  address_line1          text,
  address_line2          text,
  city                   text,
  postcode               text,
  country                text NOT NULL DEFAULT 'MU',
  contact_name           text,
  contact_email          text,
  contact_phone          text,
  preferred_currency     char(3),
  payment_terms_days     integer CHECK (payment_terms_days IS NULL OR payment_terms_days BETWEEN 0 AND 365),
  -- Optional collective/auxiliary receivable account (1100 by default).
  receivable_account_id  uuid REFERENCES accounts(id) ON DELETE SET NULL,
  notes                  text,
  is_active              boolean NOT NULL DEFAULT true,
  archived_at            timestamptz,
  created_by             uuid REFERENCES app_users(id) ON DELETE SET NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS billing_customers_company_idx
  ON billing_customers (company_id, is_active, name);

-- Only an *identical* BRN is a hard duplicate inside one company: two
-- legitimate homonyms without a BRN stay possible (soft warning only).
CREATE UNIQUE INDEX IF NOT EXISTS billing_customers_company_brn_idx
  ON billing_customers (company_id, lower(btrim(brn)))
  WHERE brn IS NOT NULL AND btrim(brn) <> '';

-- 2. Items --------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS billing_items (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  reference         text NOT NULL CHECK (length(btrim(reference)) > 0),
  label_fr          text NOT NULL CHECK (length(btrim(label_fr)) > 0),
  label_en          text,
  description       text,
  unit_price        numeric(20,4) NOT NULL CHECK (unit_price >= 0),
  currency          char(3) NOT NULL DEFAULT 'MUR',
  unit              text NOT NULL DEFAULT 'unit',
  category          text,
  -- Explicit fiscal qualification. 'standard' requires a verified rate.
  vat_treatment     text NOT NULL DEFAULT 'standard'
                      CHECK (vat_treatment IN ('standard', 'zero_rated', 'exempt', 'out_of_scope')),
  vat_rate_id       uuid,
  revenue_account_id uuid REFERENCES accounts(id) ON DELETE SET NULL,
  is_active         boolean NOT NULL DEFAULT true,
  created_by        uuid REFERENCES app_users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS billing_items_company_ref_idx
  ON billing_items (company_id, lower(btrim(reference)));
CREATE INDEX IF NOT EXISTS billing_items_company_idx
  ON billing_items (company_id, is_active, label_fr);

-- 3. VAT configuration --------------------------------------------------------
--    No rate is ever seeded: a rate is dated data entered by the cabinet and
--    marked `verified` only after a professional confirmed it. Until then any
--    computation is refused with a clear error instead of inventing a rate.
CREATE TABLE IF NOT EXISTS billing_tax_rates (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  code           text NOT NULL CHECK (length(btrim(code)) > 0),
  label          text NOT NULL,
  rate           numeric(7,4) NOT NULL CHECK (rate >= 0 AND rate <= 100),
  effective_from date NOT NULL,
  effective_to   date,
  verified       boolean NOT NULL DEFAULT false,
  source         text,
  notes          text,
  created_by     uuid REFERENCES app_users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

CREATE UNIQUE INDEX IF NOT EXISTS billing_tax_rates_company_code_idx
  ON billing_tax_rates (company_id, lower(btrim(code)), effective_from);

CREATE INDEX IF NOT EXISTS billing_tax_rates_company_idx
  ON billing_tax_rates (company_id, effective_from DESC);

ALTER TABLE billing_items
  DROP CONSTRAINT IF EXISTS billing_items_vat_rate_fk;
ALTER TABLE billing_items
  ADD CONSTRAINT billing_items_vat_rate_fk
  FOREIGN KEY (vat_rate_id) REFERENCES billing_tax_rates(id) ON DELETE SET NULL;

-- 4. Per-company billing settings --------------------------------------------
CREATE TABLE IF NOT EXISTS billing_settings (
  company_id              uuid PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  quote_prefix            text NOT NULL DEFAULT 'DEV',
  invoice_prefix          text NOT NULL DEFAULT 'FAC',
  credit_prefix           text NOT NULL DEFAULT 'AV',
  -- 'yearly' resets the counter each calendar year; 'continuous' never resets.
  numbering_policy        text NOT NULL DEFAULT 'yearly'
                            CHECK (numbering_policy IN ('yearly', 'continuous')),
  default_payment_terms   integer NOT NULL DEFAULT 30 CHECK (default_payment_terms BETWEEN 0 AND 365),
  default_currency        char(3) NOT NULL DEFAULT 'MUR',
  vat_enabled             boolean NOT NULL DEFAULT false,
  -- Fiscal information printed on documents: free text, never a claim of
  -- compliance. Empty by default.
  vat_number              text,
  legal_footer_fr         text,
  legal_footer_en         text,
  bank_details            text,
  updated_by              uuid REFERENCES app_users(id) ON DELETE SET NULL,
  updated_at              timestamptz NOT NULL DEFAULT now()
);

-- 5. Billing documents --------------------------------------------------------
--    Extend the mission-4 foundation. Drafts have no number yet; the number is
--    assigned once, at issuance, from billing_number_sequences.
ALTER TABLE billing_documents
  ADD COLUMN IF NOT EXISTS customer_id uuid REFERENCES billing_customers(id) ON DELETE SET NULL;
ALTER TABLE billing_documents
  ADD COLUMN IF NOT EXISTS source_kind text CHECK (source_kind IS NULL OR source_kind IN ('quote', 'invoice'));
ALTER TABLE billing_documents
  ADD COLUMN IF NOT EXISTS source_document_id uuid REFERENCES billing_documents(id) ON DELETE SET NULL;
ALTER TABLE billing_documents
  ADD COLUMN IF NOT EXISTS subtotal numeric(20,4) NOT NULL DEFAULT 0;
ALTER TABLE billing_documents
  ADD COLUMN IF NOT EXISTS discount_total numeric(20,4) NOT NULL DEFAULT 0;
ALTER TABLE billing_documents
  ADD COLUMN IF NOT EXISTS tax_total numeric(20,4) NOT NULL DEFAULT 0;
ALTER TABLE billing_documents
  ADD COLUMN IF NOT EXISTS amount_paid numeric(20,4) NOT NULL DEFAULT 0;
ALTER TABLE billing_documents
  ADD COLUMN IF NOT EXISTS credited_amount numeric(20,4) NOT NULL DEFAULT 0;
ALTER TABLE billing_documents
  ADD COLUMN IF NOT EXISTS payment_status text NOT NULL DEFAULT 'unpaid'
    CHECK (payment_status IN ('unpaid', 'partial', 'paid', 'overpaid'));
ALTER TABLE billing_documents
  ADD COLUMN IF NOT EXISTS exchange_rate numeric(20,8) NOT NULL DEFAULT 1 CHECK (exchange_rate > 0);
ALTER TABLE billing_documents
  ADD COLUMN IF NOT EXISTS valid_until date;
ALTER TABLE billing_documents
  ADD COLUMN IF NOT EXISTS notes text;
ALTER TABLE billing_documents
  ADD COLUMN IF NOT EXISTS terms text;
ALTER TABLE billing_documents
  ADD COLUMN IF NOT EXISTS sequence_year integer;
ALTER TABLE billing_documents
  ADD COLUMN IF NOT EXISTS sequence_no integer;
ALTER TABLE billing_documents
  ADD COLUMN IF NOT EXISTS issued_at timestamptz;
ALTER TABLE billing_documents
  ADD COLUMN IF NOT EXISTS locked_at timestamptz;
ALTER TABLE billing_documents
  ADD COLUMN IF NOT EXISTS sent_at timestamptz;
ALTER TABLE billing_documents
  ADD COLUMN IF NOT EXISTS accepted_at timestamptz;
ALTER TABLE billing_documents
  ADD COLUMN IF NOT EXISTS refused_at timestamptz;
ALTER TABLE billing_documents
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;
ALTER TABLE billing_documents
  ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES app_users(id) ON DELETE SET NULL;
ALTER TABLE billing_documents
  ADD COLUMN IF NOT EXISTS customer_snapshot jsonb;

-- A draft carries no number: the constraint of mission 4 is relaxed here.
ALTER TABLE billing_documents ALTER COLUMN doc_no DROP NOT NULL;

-- Status vocabulary extended (quotes have their own lifecycle).
ALTER TABLE billing_documents DROP CONSTRAINT IF EXISTS billing_documents_status_check;
ALTER TABLE billing_documents
  ADD CONSTRAINT billing_documents_status_check
  CHECK (status IN (
    'draft',          -- editable, provisional number only
    'sent',           -- quote sent to the customer
    'accepted',       -- quote accepted by the customer
    'refused',        -- quote refused
    'expired',        -- quote past its validity date
    'issued',         -- invoice or credit note issued (locked)
    'partially_paid',
    'paid',
    'cancelled'       -- never a hard delete
  ));

-- One sequence per company, kind and year (see billing_number_sequences).
CREATE UNIQUE INDEX IF NOT EXISTS billing_documents_number_idx
  ON billing_documents (company_id, kind, sequence_year, sequence_no)
  WHERE sequence_no IS NOT NULL;

CREATE INDEX IF NOT EXISTS billing_documents_customer_idx
  ON billing_documents (company_id, customer_id, issue_date DESC)
  WHERE customer_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS billing_documents_source_idx
  ON billing_documents (source_document_id)
  WHERE source_document_id IS NOT NULL;

-- 6. Document lines -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS billing_document_lines (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id         uuid NOT NULL REFERENCES billing_documents(id) ON DELETE CASCADE,
  company_id          uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  line_no             integer NOT NULL CHECK (line_no > 0),
  item_id             uuid REFERENCES billing_items(id) ON DELETE SET NULL,
  description         text NOT NULL CHECK (length(btrim(description)) > 0),
  quantity            numeric(20,4) NOT NULL CHECK (quantity > 0),
  unit_price          numeric(20,4) NOT NULL CHECK (unit_price >= 0),
  unit                text NOT NULL DEFAULT 'unit',
  discount_pct        numeric(7,4) NOT NULL DEFAULT 0 CHECK (discount_pct >= 0 AND discount_pct <= 100),
  vat_treatment       text NOT NULL DEFAULT 'standard'
                        CHECK (vat_treatment IN ('standard', 'zero_rated', 'exempt', 'out_of_scope')),
  vat_rate            numeric(7,4) CHECK (vat_rate IS NULL OR (vat_rate >= 0 AND vat_rate <= 100)),
  vat_rate_id         uuid REFERENCES billing_tax_rates(id) ON DELETE SET NULL,
  net_amount          numeric(20,4) NOT NULL DEFAULT 0,
  discount_amount     numeric(20,4) NOT NULL DEFAULT 0,
  tax_amount          numeric(20,4) NOT NULL DEFAULT 0,
  line_total          numeric(20,4) NOT NULL DEFAULT 0,
  revenue_account_id  uuid REFERENCES accounts(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS billing_document_lines_no_idx
  ON billing_document_lines (document_id, line_no);
CREATE INDEX IF NOT EXISTS billing_document_lines_company_idx
  ON billing_document_lines (company_id, document_id);

-- 7. Sequences ----------------------------------------------------------------
--    Same pattern as the accounting entry sequence: a single UPSERT ...
--    RETURNING is atomic under concurrency, so two invoices can never share a
--    number.
CREATE TABLE IF NOT EXISTS billing_number_sequences (
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  kind       text NOT NULL CHECK (kind IN ('quote', 'invoice', 'credit_note', 'payment')),
  year       integer NOT NULL,
  last_no    integer NOT NULL DEFAULT 0,
  PRIMARY KEY (company_id, kind, year)
);

-- 8. Document events (traceability) -------------------------------------------
CREATE TABLE IF NOT EXISTS billing_document_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES billing_documents(id) ON DELETE CASCADE,
  company_id  uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  action      text NOT NULL,
  actor_id    uuid REFERENCES app_users(id) ON DELETE SET NULL,
  details     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS billing_document_events_doc_idx
  ON billing_document_events (document_id, created_at DESC);

-- 9. Payments and allocations -------------------------------------------------
CREATE TABLE IF NOT EXISTS billing_payments (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  customer_id         uuid NOT NULL REFERENCES billing_customers(id) ON DELETE CASCADE,
  payment_no          text,
  payment_date        date NOT NULL,
  value_date          date,
  amount              numeric(20,4) NOT NULL CHECK (amount > 0),
  currency            char(3) NOT NULL DEFAULT 'MUR',
  exchange_rate       numeric(20,8) NOT NULL DEFAULT 1 CHECK (exchange_rate > 0),
  method              text NOT NULL DEFAULT 'bank_transfer'
                        CHECK (method IN ('bank_transfer', 'cheque', 'cash', 'card', 'other')),
  reference           text,
  -- Part of the payment not allocated to an invoice (over-payment).
  unallocated_amount  numeric(20,4) NOT NULL DEFAULT 0,
  status              text NOT NULL DEFAULT 'recorded'
                        CHECK (status IN ('recorded', 'cancelled')),
  -- A payment can be posted to accounting at most once.
  accounting_entry_id uuid UNIQUE REFERENCES journal_entries(id) ON DELETE SET NULL,
  sequence_year       integer,
  sequence_no         integer,
  created_by          uuid REFERENCES app_users(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS billing_payments_company_idx
  ON billing_payments (company_id, payment_date DESC);
CREATE UNIQUE INDEX IF NOT EXISTS billing_payments_no_idx
  ON billing_payments (company_id, lower(btrim(payment_no)))
  WHERE payment_no IS NOT NULL;

CREATE TABLE IF NOT EXISTS billing_payment_allocations (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid NOT NULL REFERENCES billing_payments(id) ON DELETE CASCADE,
  invoice_id uuid NOT NULL REFERENCES billing_documents(id) ON DELETE RESTRICT,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  amount     numeric(20,4) NOT NULL CHECK (amount > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS billing_payment_allocations_uniq
  ON billing_payment_allocations (payment_id, invoice_id);
CREATE INDEX IF NOT EXISTS billing_payment_allocations_invoice_idx
  ON billing_payment_allocations (invoice_id);

-- 10. AI journal proposals (V2) ----------------------------------------------
--     A proposal is never an entry. Posting is a separate, explicit action that
--     creates the journal entry through the existing accounting service.
CREATE TABLE IF NOT EXISTS ai_entry_proposals (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id     uuid NOT NULL REFERENCES cabinets(id) ON DELETE CASCADE,
  company_id     uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  source_kind    text NOT NULL
                   CHECK (source_kind IN ('manual', 'billing_invoice', 'billing_credit_note', 'billing_payment')),
  source_id      uuid,
  journal_id     uuid REFERENCES journals(id) ON DELETE SET NULL,
  entry_date     date NOT NULL,
  reference      text,
  description    text NOT NULL CHECK (length(btrim(description)) > 0),
  currency       char(3) NOT NULL,
  exchange_rate  numeric(20,8),
  status         text NOT NULL DEFAULT 'proposed'
                   CHECK (status IN ('proposed', 'validated', 'posted', 'rejected')),
  confidence     numeric(4,3) CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  rationale      text,
  warnings       jsonb NOT NULL DEFAULT '[]'::jsonb,
  missing        jsonb NOT NULL DEFAULT '[]'::jsonb,
  rule_trace     jsonb NOT NULL DEFAULT '[]'::jsonb,
  provider       text,
  model          text,
  fingerprint    text,
  created_by     uuid REFERENCES app_users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  validated_by   uuid REFERENCES app_users(id) ON DELETE SET NULL,
  validated_at   timestamptz,
  rejected_by    uuid REFERENCES app_users(id) ON DELETE SET NULL,
  rejected_at    timestamptz,
  rejection_note text,
  entry_id       uuid UNIQUE REFERENCES journal_entries(id) ON DELETE SET NULL,
  CONSTRAINT ai_entry_proposals_posted_chk
    CHECK (status <> 'posted' OR (entry_id IS NOT NULL AND validated_by IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS ai_entry_proposals_company_idx
  ON ai_entry_proposals (company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_entry_proposals_source_idx
  ON ai_entry_proposals (source_kind, source_id)
  WHERE source_id IS NOT NULL;

-- One live proposal per source document: re-proposing replaces a rejected one
-- but never duplicates a proposal that is still proposed/validated/posted.
CREATE UNIQUE INDEX IF NOT EXISTS ai_entry_proposals_live_source_idx
  ON ai_entry_proposals (source_kind, source_id)
  WHERE source_id IS NOT NULL AND status <> 'rejected';

CREATE TABLE IF NOT EXISTS ai_entry_proposal_lines (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id uuid NOT NULL REFERENCES ai_entry_proposals(id) ON DELETE CASCADE,
  line_no     integer NOT NULL CHECK (line_no > 0),
  account_id  uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  description text,
  debit       numeric(20,4) NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit      numeric(20,4) NOT NULL DEFAULT 0 CHECK (credit >= 0),
  rule_id     uuid,
  CONSTRAINT ai_entry_proposal_lines_one_side_chk
    CHECK ((debit = 0) <> (credit = 0))
);

CREATE UNIQUE INDEX IF NOT EXISTS ai_entry_proposal_lines_no_idx
  ON ai_entry_proposal_lines (proposal_id, line_no);

-- 11. Deterministic learned rules (V2) ----------------------------------------
--     "Learning" here = reusing rules a human validated. No model is trained on
--     cabinet data, and a rule never crosses a company boundary.
CREATE TABLE IF NOT EXISTS ai_rules (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id          uuid NOT NULL REFERENCES cabinets(id) ON DELETE CASCADE,
  company_id          uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  rule_type           text NOT NULL
                        CHECK (rule_type IN ('counterparty', 'bank_label', 'expense_category',
                                             'billing_item', 'payment_method', 'journal')),
  match_key           text NOT NULL CHECK (length(btrim(match_key)) > 0),
  match_label         text,
  account_id          uuid REFERENCES accounts(id) ON DELETE CASCADE,
  counter_account_id  uuid REFERENCES accounts(id) ON DELETE CASCADE,
  journal_id          uuid REFERENCES journals(id) ON DELETE SET NULL,
  priority            integer NOT NULL DEFAULT 100,
  version             integer NOT NULL DEFAULT 1,
  is_active           boolean NOT NULL DEFAULT true,
  previous_version_id uuid REFERENCES ai_rules(id) ON DELETE SET NULL,
  notes               text,
  use_count           integer NOT NULL DEFAULT 0,
  created_by          uuid REFERENCES app_users(id) ON DELETE SET NULL,
  validated_by        uuid REFERENCES app_users(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  last_used_at        timestamptz
);

-- Only one *active* rule per key: a conflict is resolved by versioning (the
-- previous rule is deactivated and points to its successor), never by silently
-- picking one at random.
CREATE UNIQUE INDEX IF NOT EXISTS ai_rules_active_uniq
  ON ai_rules (company_id, rule_type, lower(btrim(match_key)))
  WHERE is_active;

CREATE INDEX IF NOT EXISTS ai_rules_company_idx
  ON ai_rules (company_id, rule_type, is_active, priority);

-- 12. Duplicate detection indexes ---------------------------------------------
CREATE INDEX IF NOT EXISTS billing_documents_dup_idx
  ON billing_documents (company_id, kind, total_amount, issue_date)
  WHERE status <> 'cancelled';

-- 13. Journal entry source ------------------------------------------------------
--     Billing-generated and AI-generated entries are traceable to their origin.
--     The reference of a billing entry is the document number, and a partial
--     unique index makes a second posting of the same document impossible at
--     the database level (idempotency defence in depth).
ALTER TABLE journal_entries DROP CONSTRAINT IF EXISTS journal_entries_source_check;
ALTER TABLE journal_entries
  ADD CONSTRAINT journal_entries_source_check
  CHECK (source IN ('manual', 'reversal', 'opening', 'billing', 'ai'));

CREATE UNIQUE INDEX IF NOT EXISTS journal_entries_billing_reference_uniq
  ON journal_entries (company_id, lower(btrim(reference)))
  WHERE source = 'billing' AND reference IS NOT NULL AND btrim(reference) <> '';

-- Side of `account_id` in the template taught by a learned rule.
ALTER TABLE ai_rules
  ADD COLUMN IF NOT EXISTS account_side text NOT NULL DEFAULT 'debit'
    CHECK (account_side IN ('debit', 'credit'));
