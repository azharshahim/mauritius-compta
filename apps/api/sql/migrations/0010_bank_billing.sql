-- 0010_bank_billing.sql
-- Mission 10: advanced bank <-> billing reconciliation.
--
-- A bank transaction may now be allocated partially to a recorded customer
-- payment (itself allocated to one or more invoices). The amount column is the
-- single source of truth for the allocation; before this migration a match was
-- implicitly worth the whole transaction.
--
-- No data is deleted. Existing matches are backfilled with the absolute
-- movement of their ledger line when available, otherwise with the absolute
-- amount of their bank transaction. The migration refuses to proceed silently
-- if an existing split would produce an inconsistent amount, hence the
-- explicit NOT NULL check at the end.

ALTER TABLE bank_transactions
  DROP CONSTRAINT IF EXISTS bank_transactions_status_check;
ALTER TABLE bank_transactions
  ADD CONSTRAINT bank_transactions_status_check
  CHECK (status IN ('unmatched', 'proposed', 'matched', 'partially_matched', 'review', 'excluded', 'cancelled'));

ALTER TABLE bank_matches
  ADD COLUMN IF NOT EXISTS amount numeric(20,4);
ALTER TABLE bank_matches
  ADD COLUMN IF NOT EXISTS billing_invoice_id uuid REFERENCES billing_documents(id) ON DELETE SET NULL;
ALTER TABLE bank_matches
  ADD COLUMN IF NOT EXISTS note text;
ALTER TABLE bank_matches
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- Legacy rows: the ledger line movement is the exact allocation when present
-- (this preserves split reconciliations), otherwise the transaction itself.
UPDATE bank_matches m
   SET amount = COALESCE(
     (SELECT abs(l.debit - l.credit)
        FROM journal_lines l
       WHERE l.id = m.entry_line_id),
     (SELECT abs(t.amount)
        FROM bank_transactions t
       WHERE t.id = m.transaction_id)
   )
 WHERE m.amount IS NULL;

ALTER TABLE bank_matches
  ALTER COLUMN amount SET NOT NULL;

ALTER TABLE bank_matches
  DROP CONSTRAINT IF EXISTS bank_matches_amount_positive;
ALTER TABLE bank_matches
  ADD CONSTRAINT bank_matches_amount_positive CHECK (amount > 0);

-- A confirmed allocation is unique per transaction/payment and per
-- transaction/invoice. Partial unique indexes (rather than table constraints)
-- keep rejected history possible.
CREATE UNIQUE INDEX IF NOT EXISTS bank_matches_txn_payment_confirmed
  ON bank_matches (transaction_id, billing_payment_id)
  WHERE billing_payment_id IS NOT NULL AND status = 'confirmed';

CREATE UNIQUE INDEX IF NOT EXISTS bank_matches_txn_invoice_confirmed
  ON bank_matches (transaction_id, billing_invoice_id)
  WHERE billing_invoice_id IS NOT NULL AND status = 'confirmed';

CREATE INDEX IF NOT EXISTS bank_matches_payment_idx
  ON bank_matches (billing_payment_id, status)
  WHERE billing_payment_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS bank_matches_invoice_idx
  ON bank_matches (billing_invoice_id, status)
  WHERE billing_invoice_id IS NOT NULL;

-- Reconciliation audit: every link decision is already in bank_events; this
-- index keeps the per-payment history cheap to query.
CREATE INDEX IF NOT EXISTS bank_events_entity_idx
  ON bank_events (company_id, entity, entity_id, created_at DESC);
