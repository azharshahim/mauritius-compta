-- ---------------------------------------------------------------------------
-- 0011_purchases.sql - Purchases & suppliers (mission 11)
--
-- Additive and idempotent. No existing table is dropped, no customer data is
-- rewritten. The supplier cycle is a *subledger*: every journal entry still
-- goes through the single accounting engine (`postEntryTx`) and every proposal
-- still goes through `ai_entry_proposals` with human validation.
--
-- Fiscal rules are never invented: VAT uses the existing, dated and verified
-- `billing_tax_rates` configuration. Recoverability is an explicit per-line
-- human decision, never a default.
-- ---------------------------------------------------------------------------

-- 1. Suppliers ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS purchase_suppliers (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name                  text NOT NULL CHECK (length(btrim(name)) > 0),
  reference             text,
  country               text NOT NULL DEFAULT 'MU',
  address_line1         text,
  address_line2         text,
  city                  text,
  postcode              text,
  contact_name          text,
  contact_phone         text,
  contact_email         text,
  registration_number   text,
  tax_number            text,
  preferred_currency    char(3),
  payment_terms_days    integer CHECK (payment_terms_days IS NULL OR payment_terms_days BETWEEN 0 AND 365),
  payable_account_id    uuid REFERENCES accounts(id) ON DELETE SET NULL,
  notes                 text,
  is_active             boolean NOT NULL DEFAULT true,
  created_by            uuid REFERENCES app_users(id) ON DELETE SET NULL,
  updated_by            uuid REFERENCES app_users(id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS purchase_suppliers_company_idx
  ON purchase_suppliers (company_id, is_active, name);

-- An identical internal reference or registration number is a hard duplicate
-- inside one company. Similar names are only warnings: two legal entities may
-- legitimately share a name. Nothing is ever merged automatically.
CREATE UNIQUE INDEX IF NOT EXISTS purchase_suppliers_company_ref_idx
  ON purchase_suppliers (company_id, lower(btrim(reference)))
  WHERE reference IS NOT NULL AND btrim(reference) <> '';

CREATE UNIQUE INDEX IF NOT EXISTS purchase_suppliers_company_reg_idx
  ON purchase_suppliers (company_id, lower(btrim(registration_number)))
  WHERE registration_number IS NOT NULL AND btrim(registration_number) <> '';

-- Internal purchase numbering: one atomic counter per company, kind and year.
-- Drafts carry no number; a number is assigned once, at validation.
CREATE TABLE IF NOT EXISTS purchase_number_sequences (
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  kind       text NOT NULL CHECK (kind IN ('invoice', 'credit_note', 'payment')),
  year       integer NOT NULL,
  last_no    integer NOT NULL DEFAULT 0,
  PRIMARY KEY (company_id, kind, year)
);

-- 2. Purchase documents (invoices and supplier credit notes) ------------------
CREATE TABLE IF NOT EXISTS purchase_documents (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  supplier_id           uuid NOT NULL REFERENCES purchase_suppliers(id) ON DELETE RESTRICT,
  kind                  text NOT NULL CHECK (kind IN ('invoice', 'credit_note')),
  doc_no                text,
  supplier_reference    text NOT NULL CHECK (length(btrim(supplier_reference)) > 0),
  issue_date            date NOT NULL,
  received_date         date,
  due_date              date,
  currency              char(3) NOT NULL,
  exchange_rate         numeric(20,8) NOT NULL DEFAULT 1 CHECK (exchange_rate > 0),
  description           text,
  subtotal              numeric(20,4) NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
  tax_total             numeric(20,4) NOT NULL DEFAULT 0 CHECK (tax_total >= 0),
  total_amount          numeric(20,4) NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
  amount_paid           numeric(20,4) NOT NULL DEFAULT 0 CHECK (amount_paid >= 0),
  credited_amount       numeric(20,4) NOT NULL DEFAULT 0 CHECK (credited_amount >= 0),
  status                text NOT NULL DEFAULT 'draft'
                          CHECK (status IN ('draft', 'validated', 'cancelled')),
  payment_status        text NOT NULL DEFAULT 'unpaid'
                          CHECK (payment_status IN ('unpaid', 'partial', 'paid', 'overpaid')),
  source_document_id    uuid REFERENCES purchase_documents(id) ON DELETE SET NULL,
  reason                text,
  warnings              jsonb NOT NULL DEFAULT '[]'::jsonb,
  validated_by          uuid REFERENCES app_users(id) ON DELETE SET NULL,
  validated_at          timestamptz,
  cancelled_by          uuid REFERENCES app_users(id) ON DELETE SET NULL,
  cancelled_at          timestamptz,
  cancellation_reason   text,
  accounting_entry_id   uuid UNIQUE REFERENCES journal_entries(id) ON DELETE SET NULL,
  created_by            uuid REFERENCES app_users(id) ON DELETE SET NULL,
  updated_by            uuid REFERENCES app_users(id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT purchase_documents_credit_source_chk
    CHECK (kind <> 'credit_note' OR source_document_id IS NULL OR source_document_id <> id)
);

CREATE UNIQUE INDEX IF NOT EXISTS purchase_documents_number_idx
  ON purchase_documents (company_id, doc_no)
  WHERE doc_no IS NOT NULL;

-- A supplier invoice reference is unique per supplier and company. A cancelled
-- document no longer blocks a corrected re-entry, but it is never deleted.
CREATE UNIQUE INDEX IF NOT EXISTS purchase_documents_supplier_ref_idx
  ON purchase_documents (company_id, supplier_id, kind, lower(btrim(supplier_reference)))
  WHERE status <> 'cancelled';

CREATE INDEX IF NOT EXISTS purchase_documents_company_idx
  ON purchase_documents (company_id, kind, status, issue_date DESC);
CREATE INDEX IF NOT EXISTS purchase_documents_due_idx
  ON purchase_documents (company_id, due_date)
  WHERE status = 'validated' AND kind = 'invoice';
CREATE INDEX IF NOT EXISTS purchase_documents_supplier_idx
  ON purchase_documents (company_id, supplier_id, issue_date DESC);

CREATE TABLE IF NOT EXISTS purchase_document_lines (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id       uuid NOT NULL REFERENCES purchase_documents(id) ON DELETE CASCADE,
  company_id        uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  line_no           integer NOT NULL CHECK (line_no > 0),
  description       text NOT NULL CHECK (length(btrim(description)) > 0),
  quantity          numeric(20,4) NOT NULL CHECK (quantity > 0),
  unit_price        numeric(20,4) NOT NULL CHECK (unit_price >= 0),
  account_id        uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  vat_treatment     text NOT NULL
                      CHECK (vat_treatment IN ('standard', 'zero_rated', 'exempt', 'out_of_scope')),
  vat_rate          numeric(7,4) CHECK (vat_rate IS NULL OR (vat_rate >= 0 AND vat_rate <= 100)),
  vat_rate_id       uuid REFERENCES billing_tax_rates(id) ON DELETE SET NULL,
  net_amount        numeric(20,4) NOT NULL CHECK (net_amount >= 0),
  tax_amount        numeric(20,4) NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
  line_total        numeric(20,4) NOT NULL CHECK (line_total >= 0),
  vat_recoverable   boolean,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT purchase_document_lines_vat_recoverable_chk
    CHECK (tax_amount = 0 OR vat_recoverable IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS purchase_document_lines_no_idx
  ON purchase_document_lines (document_id, line_no);
CREATE INDEX IF NOT EXISTS purchase_document_lines_company_idx
  ON purchase_document_lines (company_id, document_id);

-- 3. Supplier payments and allocations ---------------------------------------
CREATE TABLE IF NOT EXISTS purchase_payments (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  supplier_id           uuid NOT NULL REFERENCES purchase_suppliers(id) ON DELETE RESTRICT,
  payment_no            text,
  kind                  text NOT NULL DEFAULT 'payment'
                          CHECK (kind IN ('payment', 'advance')),
  payment_date          date NOT NULL,
  value_date            date,
  amount                numeric(20,4) NOT NULL CHECK (amount > 0),
  currency              char(3) NOT NULL,
  exchange_rate         numeric(20,8) NOT NULL DEFAULT 1 CHECK (exchange_rate > 0),
  method                text NOT NULL DEFAULT 'bank_transfer'
                          CHECK (method IN ('bank_transfer', 'cheque', 'cash', 'card', 'other')),
  reference             text,
  unallocated_amount    numeric(20,4) NOT NULL DEFAULT 0 CHECK (unallocated_amount >= 0),
  status                text NOT NULL DEFAULT 'recorded'
                          CHECK (status IN ('recorded', 'cancelled')),
  accounting_entry_id   uuid UNIQUE REFERENCES journal_entries(id) ON DELETE SET NULL,
  created_by            uuid REFERENCES app_users(id) ON DELETE SET NULL,
  cancelled_by          uuid REFERENCES app_users(id) ON DELETE SET NULL,
  cancelled_at          timestamptz,
  cancellation_reason   text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS purchase_payments_no_idx
  ON purchase_payments (company_id, lower(btrim(payment_no)))
  WHERE payment_no IS NOT NULL;
CREATE INDEX IF NOT EXISTS purchase_payments_company_idx
  ON purchase_payments (company_id, payment_date DESC);
CREATE INDEX IF NOT EXISTS purchase_payments_supplier_idx
  ON purchase_payments (company_id, supplier_id, payment_date DESC);

CREATE TABLE IF NOT EXISTS purchase_payment_allocations (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id        uuid NOT NULL REFERENCES purchase_payments(id) ON DELETE CASCADE,
  invoice_id        uuid NOT NULL REFERENCES purchase_documents(id) ON DELETE RESTRICT,
  company_id        uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  amount            numeric(20,4) NOT NULL CHECK (amount > 0),
  cancelled_at      timestamptz,
  cancelled_by      uuid REFERENCES app_users(id) ON DELETE SET NULL,
  cancellation_reason text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS purchase_payment_allocations_uniq
  ON purchase_payment_allocations (payment_id, invoice_id);
CREATE INDEX IF NOT EXISTS purchase_payment_allocations_invoice_idx
  ON purchase_payment_allocations (invoice_id) WHERE cancelled_at IS NULL;

-- 4. Supplier credit-note allocations ----------------------------------------
CREATE TABLE IF NOT EXISTS purchase_credit_allocations (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  credit_note_id    uuid NOT NULL REFERENCES purchase_documents(id) ON DELETE RESTRICT,
  invoice_id        uuid NOT NULL REFERENCES purchase_documents(id) ON DELETE RESTRICT,
  company_id        uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  amount            numeric(20,4) NOT NULL CHECK (amount > 0),
  cancelled_at      timestamptz,
  cancelled_by      uuid REFERENCES app_users(id) ON DELETE SET NULL,
  cancellation_reason text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT purchase_credit_allocations_distinct_chk
    CHECK (credit_note_id <> invoice_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS purchase_credit_allocations_uniq
  ON purchase_credit_allocations (credit_note_id, invoice_id)
  WHERE cancelled_at IS NULL;
CREATE INDEX IF NOT EXISTS purchase_credit_allocations_invoice_idx
  ON purchase_credit_allocations (invoice_id) WHERE cancelled_at IS NULL;

-- 5. Traceability ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS purchase_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  entity      text NOT NULL CHECK (entity IN ('supplier', 'document', 'payment', 'allocation')),
  entity_id   uuid,
  action      text NOT NULL,
  actor_id    uuid REFERENCES app_users(id) ON DELETE SET NULL,
  details     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS purchase_events_entity_idx
  ON purchase_events (company_id, entity, entity_id, created_at DESC);

-- 6. Proposals and journal sources -------------------------------------------
-- The source vocabulary is extended, not replaced. A posted purchase proposal
-- still uses the same unique `entry_id` and the same human validation.
ALTER TABLE ai_entry_proposals
  DROP CONSTRAINT IF EXISTS ai_entry_proposals_source_kind_check;
ALTER TABLE ai_entry_proposals
  ADD CONSTRAINT ai_entry_proposals_source_kind_check
  CHECK (source_kind IN (
    'manual', 'billing_invoice', 'billing_credit_note', 'billing_payment',
    'purchase_invoice', 'purchase_credit_note', 'purchase_payment'
  ));

ALTER TABLE journal_entries DROP CONSTRAINT IF EXISTS journal_entries_source_check;
ALTER TABLE journal_entries
  ADD CONSTRAINT journal_entries_source_check
  CHECK (source IN (
    'manual', 'reversal', 'opening', 'billing', 'purchase', 'ai',
    'migration', 'migration_opening'
  ));

-- Mission 10 index only covered billing references. Purchase entries have
-- their own reference namespace and their own unique guard.
CREATE UNIQUE INDEX IF NOT EXISTS journal_entries_purchase_reference_uniq
  ON journal_entries (company_id, lower(btrim(reference)))
  WHERE source = 'purchase' AND reference IS NOT NULL AND btrim(reference) <> '';

-- 7. Bank reconciliation <-> supplier cycle ----------------------------------
ALTER TABLE bank_matches
  ADD COLUMN IF NOT EXISTS purchase_payment_id uuid REFERENCES purchase_payments(id) ON DELETE SET NULL;
ALTER TABLE bank_matches
  ADD COLUMN IF NOT EXISTS purchase_invoice_id uuid REFERENCES purchase_documents(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS bank_matches_txn_purchase_payment_confirmed
  ON bank_matches (transaction_id, purchase_payment_id)
  WHERE purchase_payment_id IS NOT NULL AND status = 'confirmed';
CREATE UNIQUE INDEX IF NOT EXISTS bank_matches_txn_purchase_invoice_confirmed
  ON bank_matches (transaction_id, purchase_invoice_id)
  WHERE purchase_invoice_id IS NOT NULL AND status = 'confirmed';
CREATE INDEX IF NOT EXISTS bank_matches_purchase_payment_idx
  ON bank_matches (purchase_payment_id, status)
  WHERE purchase_payment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS bank_matches_purchase_invoice_idx
  ON bank_matches (purchase_invoice_id, status)
  WHERE purchase_invoice_id IS NOT NULL;

-- One confirmed bank link may point at either a customer receipt or a supplier
-- payment, never both. This is defence in depth for the application checks.
ALTER TABLE bank_matches DROP CONSTRAINT IF EXISTS bank_matches_single_party_chk;
ALTER TABLE bank_matches
  ADD CONSTRAINT bank_matches_single_party_chk
  CHECK (NOT (billing_payment_id IS NOT NULL AND purchase_payment_id IS NOT NULL));

-- 8. Attachments -------------------------------------------------------------
-- The existing signature-checked attachment storage can now justify a purchase
-- document without changing the customer module.
ALTER TABLE attachments
  ADD COLUMN IF NOT EXISTS purchase_document_id uuid REFERENCES purchase_documents(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS attachments_purchase_document_idx
  ON attachments (purchase_document_id)
  WHERE purchase_document_id IS NOT NULL;

-- 8. Cross-company guards -----------------------------------------------------
-- The service always filters by company_id, but PostgreSQL also refuses a
-- reference that would silently cross two dossiers. This mirrors 0003.
CREATE OR REPLACE FUNCTION mc_guard_purchase_document_company()
RETURNS trigger AS $$
DECLARE
  v_supplier_company uuid;
  v_source_company uuid;
  v_entry_company uuid;
BEGIN
  SELECT company_id INTO v_supplier_company FROM purchase_suppliers WHERE id = NEW.supplier_id;
  IF v_supplier_company IS NULL OR v_supplier_company <> NEW.company_id THEN
    RAISE EXCEPTION 'CROSS_COMPANY_REFERENCE: purchase supplier belongs to another company'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.source_document_id IS NOT NULL THEN
    SELECT company_id INTO v_source_company FROM purchase_documents WHERE id = NEW.source_document_id;
    IF v_source_company IS NULL OR v_source_company <> NEW.company_id THEN
      RAISE EXCEPTION 'CROSS_COMPANY_REFERENCE: source purchase document belongs to another company'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF NEW.accounting_entry_id IS NOT NULL THEN
    SELECT company_id INTO v_entry_company FROM journal_entries WHERE id = NEW.accounting_entry_id;
    IF v_entry_company IS NULL OR v_entry_company <> NEW.company_id THEN
      RAISE EXCEPTION 'CROSS_COMPANY_REFERENCE: purchase accounting entry belongs to another company'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS purchase_documents_company_trg ON purchase_documents;
CREATE TRIGGER purchase_documents_company_trg
  BEFORE INSERT OR UPDATE ON purchase_documents
  FOR EACH ROW EXECUTE FUNCTION mc_guard_purchase_document_company();

CREATE OR REPLACE FUNCTION mc_guard_purchase_line_company()
RETURNS trigger AS $$
DECLARE
  v_doc_company uuid;
  v_account_company uuid;
BEGIN
  SELECT company_id INTO v_doc_company FROM purchase_documents WHERE id = NEW.document_id;
  IF v_doc_company IS NULL OR v_doc_company <> NEW.company_id THEN
    RAISE EXCEPTION 'CROSS_COMPANY_REFERENCE: purchase line document belongs to another company'
      USING ERRCODE = 'check_violation';
  END IF;
  SELECT company_id INTO v_account_company FROM accounts WHERE id = NEW.account_id;
  IF v_account_company IS NULL OR v_account_company <> NEW.company_id THEN
    RAISE EXCEPTION 'CROSS_COMPANY_REFERENCE: purchase line account belongs to another company'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS purchase_document_lines_company_trg ON purchase_document_lines;
CREATE TRIGGER purchase_document_lines_company_trg
  BEFORE INSERT OR UPDATE ON purchase_document_lines
  FOR EACH ROW EXECUTE FUNCTION mc_guard_purchase_line_company();

CREATE OR REPLACE FUNCTION mc_guard_purchase_payment_company()
RETURNS trigger AS $$
DECLARE
  v_supplier_company uuid;
BEGIN
  SELECT company_id INTO v_supplier_company FROM purchase_suppliers WHERE id = NEW.supplier_id;
  IF v_supplier_company IS NULL OR v_supplier_company <> NEW.company_id THEN
    RAISE EXCEPTION 'CROSS_COMPANY_REFERENCE: payment supplier belongs to another company'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS purchase_payments_company_trg ON purchase_payments;
CREATE TRIGGER purchase_payments_company_trg
  BEFORE INSERT OR UPDATE ON purchase_payments
  FOR EACH ROW EXECUTE FUNCTION mc_guard_purchase_payment_company();

CREATE OR REPLACE FUNCTION mc_guard_purchase_allocation_company()
RETURNS trigger AS $$
DECLARE
  v_payment_company uuid;
  v_invoice_company uuid;
BEGIN
  SELECT company_id INTO v_payment_company FROM purchase_payments WHERE id = NEW.payment_id;
  SELECT company_id INTO v_invoice_company FROM purchase_documents WHERE id = NEW.invoice_id;
  IF v_payment_company IS NULL OR v_invoice_company IS NULL
     OR v_payment_company <> NEW.company_id OR v_invoice_company <> NEW.company_id THEN
    RAISE EXCEPTION 'CROSS_COMPANY_REFERENCE: purchase allocation spans companies'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS purchase_payment_allocations_company_trg ON purchase_payment_allocations;
CREATE TRIGGER purchase_payment_allocations_company_trg
  BEFORE INSERT OR UPDATE ON purchase_payment_allocations
  FOR EACH ROW EXECUTE FUNCTION mc_guard_purchase_allocation_company();

CREATE OR REPLACE FUNCTION mc_guard_purchase_credit_allocation_company()
RETURNS trigger AS $$
DECLARE
  v_credit_company uuid;
  v_invoice_company uuid;
BEGIN
  SELECT company_id INTO v_credit_company FROM purchase_documents WHERE id = NEW.credit_note_id;
  SELECT company_id INTO v_invoice_company FROM purchase_documents WHERE id = NEW.invoice_id;
  IF v_credit_company IS NULL OR v_invoice_company IS NULL
     OR v_credit_company <> NEW.company_id OR v_invoice_company <> NEW.company_id THEN
    RAISE EXCEPTION 'CROSS_COMPANY_REFERENCE: purchase credit allocation spans companies'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS purchase_credit_allocations_company_trg ON purchase_credit_allocations;
CREATE TRIGGER purchase_credit_allocations_company_trg
  BEFORE INSERT OR UPDATE ON purchase_credit_allocations
  FOR EACH ROW EXECUTE FUNCTION mc_guard_purchase_credit_allocation_company();

-- Attachments can now point at a purchase document before any entry exists.
CREATE OR REPLACE FUNCTION mc_guard_attachment_company()
RETURNS trigger AS $$
DECLARE
  v_entry_company uuid;
  v_purchase_company uuid;
BEGIN
  IF NEW.entry_id IS NOT NULL THEN
    SELECT company_id INTO v_entry_company FROM journal_entries WHERE id = NEW.entry_id;
    IF v_entry_company IS NULL OR v_entry_company <> NEW.company_id THEN
      RAISE EXCEPTION 'CROSS_COMPANY_REFERENCE: attachment entry belongs to another company'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF NEW.purchase_document_id IS NOT NULL THEN
    SELECT company_id INTO v_purchase_company FROM purchase_documents WHERE id = NEW.purchase_document_id;
    IF v_purchase_company IS NULL OR v_purchase_company <> NEW.company_id THEN
      RAISE EXCEPTION 'CROSS_COMPANY_REFERENCE: attachment purchase document belongs to another company'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
