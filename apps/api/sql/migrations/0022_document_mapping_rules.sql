-- Mission 28 — supervised document classification rules.
--
-- A correction is never applied as a definitive rule after a single approval:
-- the proposal engine only reads active mappings whose usage_count is at least
-- two. Accountants can review, re-point or disable a rule from the document
-- screens; the audit trail records every change.

ALTER TABLE document_mappings
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS document_mappings_company_active_idx
  ON document_mappings (company_id, kind, is_active, last_used_at DESC);
