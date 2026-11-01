-- 0025_mission42_purchase_sales_integrity.sql — Mission 42
--
-- Additive only. This migration closes the M41 gaps between the OCR intake,
-- the purchase/sales subledgers and the general ledger. No existing amount is
-- rewritten and no accounting engine is duplicated.
--
--   1. OCR document -> purchase document link (one conversion at most).
--   2. Dated allocations, later re-allocation and reclassification links.
--   3. Fixed-asset link on a purchase line.
--   4. New proposal source kinds for allocation reclassification.

-- 1. OCR -> purchase invoice -------------------------------------------------
ALTER TABLE document_imports
  ADD COLUMN IF NOT EXISTS purchase_document_id uuid REFERENCES purchase_documents(id) ON DELETE SET NULL;
ALTER TABLE document_proposals
  ADD COLUMN IF NOT EXISTS purchase_document_id uuid REFERENCES purchase_documents(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS document_imports_purchase_document_uniq
  ON document_imports (purchase_document_id)
  WHERE purchase_document_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS document_proposals_purchase_document_uniq
  ON document_proposals (purchase_document_id)
  WHERE purchase_document_id IS NOT NULL;

-- 2. Dated allocations -------------------------------------------------------
-- The allocation date is the date on which the invoice balance is reduced.
-- Existing rows are backfilled from the payment/credit-note date: this is the
-- historical evidence available and is never an invented date.
ALTER TABLE purchase_payment_allocations
  ADD COLUMN IF NOT EXISTS allocated_date date;
ALTER TABLE purchase_payment_allocations
  ADD COLUMN IF NOT EXISTS reclass_entry_id uuid REFERENCES journal_entries(id) ON DELETE SET NULL;
ALTER TABLE purchase_payment_allocations
  ADD COLUMN IF NOT EXISTS reclass_amount numeric(20,4) NOT NULL DEFAULT 0 CHECK (reclass_amount >= 0);
UPDATE purchase_payment_allocations a
   SET allocated_date = p.payment_date
  FROM purchase_payments p
 WHERE p.id = a.payment_id AND a.allocated_date IS NULL;
ALTER TABLE purchase_payment_allocations
  ALTER COLUMN allocated_date SET DEFAULT CURRENT_DATE;

ALTER TABLE purchase_credit_allocations
  ADD COLUMN IF NOT EXISTS allocated_date date;
ALTER TABLE purchase_credit_allocations
  ADD COLUMN IF NOT EXISTS reclass_entry_id uuid REFERENCES journal_entries(id) ON DELETE SET NULL;
UPDATE purchase_credit_allocations a
   SET allocated_date = d.issue_date
  FROM purchase_documents d
 WHERE d.id = a.credit_note_id AND a.allocated_date IS NULL;
ALTER TABLE purchase_credit_allocations
  ALTER COLUMN allocated_date SET DEFAULT CURRENT_DATE;

ALTER TABLE billing_payment_allocations
  ADD COLUMN IF NOT EXISTS allocated_date date;
ALTER TABLE billing_payment_allocations
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;
ALTER TABLE billing_payment_allocations
  ADD COLUMN IF NOT EXISTS cancelled_by uuid REFERENCES app_users(id) ON DELETE SET NULL;
ALTER TABLE billing_payment_allocations
  ADD COLUMN IF NOT EXISTS cancellation_reason text;
ALTER TABLE billing_payment_allocations
  ADD COLUMN IF NOT EXISTS reclass_entry_id uuid REFERENCES journal_entries(id) ON DELETE SET NULL;
ALTER TABLE billing_payment_allocations
  ADD COLUMN IF NOT EXISTS reclass_amount numeric(20,4) NOT NULL DEFAULT 0 CHECK (reclass_amount >= 0);
UPDATE billing_payment_allocations a
   SET allocated_date = p.payment_date
  FROM billing_payments p
 WHERE p.id = a.payment_id AND a.allocated_date IS NULL;
ALTER TABLE billing_payment_allocations
  ALTER COLUMN allocated_date SET DEFAULT CURRENT_DATE;

CREATE INDEX IF NOT EXISTS purchase_payment_allocations_date_idx
  ON purchase_payment_allocations (invoice_id, allocated_date)
  WHERE cancelled_at IS NULL;
CREATE INDEX IF NOT EXISTS purchase_credit_allocations_date_idx
  ON purchase_credit_allocations (invoice_id, allocated_date)
  WHERE cancelled_at IS NULL;
CREATE INDEX IF NOT EXISTS billing_payment_allocations_date_idx
  ON billing_payment_allocations (invoice_id, allocated_date)
  WHERE cancelled_at IS NULL;

-- 2b. Supplier advances account ---------------------------------------------
-- New companies receive 1150 from the provisional chart. Existing companies
-- get the same account additively, so a posted supplier advance can be
-- reclassified to trade payable without touching any existing balance.
INSERT INTO accounts (company_id, code, name, name_en, name_fr, type, currency,
                      is_active, posting_allowed, account_role)
SELECT c.id, '1150', 'Avances aux fournisseurs', 'Advances to suppliers',
       'Avances aux fournisseurs', 'asset', c.functional_currency, true, true, 'prepayment'
  FROM companies c
 WHERE EXISTS (SELECT 1 FROM accounts a WHERE a.company_id = c.id AND a.code = '1100')
   AND NOT EXISTS (SELECT 1 FROM accounts a WHERE a.company_id = c.id AND a.code = '1150');

-- 3. Purchase line -> fixed asset -------------------------------------------
ALTER TABLE fixed_assets
  ADD COLUMN IF NOT EXISTS purchase_document_line_id uuid
    REFERENCES purchase_document_lines(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS fixed_assets_purchase_line_uniq
  ON fixed_assets (purchase_document_line_id)
  WHERE purchase_document_line_id IS NOT NULL;

-- 4. Reclassification proposals ---------------------------------------------
-- A later allocation may require a reclassification entry (prepayment/advance
-- to supplier payable, or customer overpayment to receivable). The proposal is
-- still a proposal: it goes through validateProposal/postProposal.
ALTER TABLE ai_entry_proposals DROP CONSTRAINT IF EXISTS ai_entry_proposals_source_kind_check;
ALTER TABLE ai_entry_proposals
  ADD CONSTRAINT ai_entry_proposals_source_kind_check
  CHECK (source_kind IN (
    'manual', 'billing_invoice', 'billing_credit_note', 'billing_payment', 'billing_allocation',
    'purchase_invoice', 'purchase_credit_note', 'purchase_payment', 'purchase_allocation'
  ));
