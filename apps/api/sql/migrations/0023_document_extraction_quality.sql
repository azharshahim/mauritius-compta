-- 0023_document_extraction_quality.sql — Mission 29
-- Structured extraction metadata for human verification. Additive only.
--
-- The original file stays in `document_imports.storage_key`; these columns keep
-- the evidence needed to review it: document type, tax identifiers, discount,
-- purchase order, field-level confidence and the list of fields that require a
-- human correction. No value is inferred by the database.

ALTER TABLE document_imports
  ADD COLUMN IF NOT EXISTS document_type text NOT NULL DEFAULT 'unknown'
    CHECK (document_type IN ('invoice', 'credit_note', 'unknown')),
  ADD COLUMN IF NOT EXISTS discount_total numeric(20,4),
  ADD COLUMN IF NOT EXISTS tax_ids jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS purchase_order text,
  ADD COLUMN IF NOT EXISTS payment_terms text,
  ADD COLUMN IF NOT EXISTS field_confidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS uncertain_fields jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS extraction_quality jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS document_imports_type_idx
  ON document_imports (company_id, document_type, created_at DESC);
