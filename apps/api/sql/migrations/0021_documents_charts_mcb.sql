-- 0021_documents_charts_mcb.sql — Mission 23
-- Bilingual chart metadata, document intake/OCR proposals and MCB import audit.
-- Additive only. No existing account is renumbered or rewritten; the legacy
-- `accounts.name` remains the fallback label.

ALTER TABLE accounts ADD COLUMN IF NOT EXISTS name_en text;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS name_fr text;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS posting_allowed boolean NOT NULL DEFAULT true;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS account_role text;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS vat_default text;

CREATE TABLE IF NOT EXISTS chart_profiles (
  company_id          uuid PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  template_type       text NOT NULL DEFAULT 'provisional_mauritius'
                        CHECK (template_type IN ('provisional_mauritius', 'firm_chart', 'custom_company')),
  status              text NOT NULL DEFAULT 'PENDING PROFESSIONAL VALIDATION'
                        CHECK (status IN ('PENDING PROFESSIONAL VALIDATION', 'AWAITING FIRM CONFIRMATION', 'CONFIRMED BY FIRM')),
  source_name         text,
  source_sha256       text,
  imported_at         timestamptz,
  confirmed_at        timestamptz,
  confirmed_by        uuid REFERENCES app_users(id) ON DELETE SET NULL,
  notes               text,
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS document_imports (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id          uuid REFERENCES cabinets(id) ON DELETE CASCADE,
  company_id          uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  created_by          uuid REFERENCES app_users(id) ON DELETE SET NULL,
  kind                text NOT NULL CHECK (kind IN ('purchase', 'sale', 'unknown')),
  status              text NOT NULL DEFAULT 'EXTRACTED'
                        CHECK (status IN ('EXTRACTED', 'PROPOSED', 'APPROVED', 'REJECTED', 'DUPLICATE', 'FAILED')),
  original_name       text NOT NULL,
  mime_type           text NOT NULL,
  size_bytes          integer NOT NULL CHECK (size_bytes >= 0),
  sha256              text NOT NULL,
  storage_key         text,
  page_count          integer NOT NULL DEFAULT 0 CHECK (page_count >= 0),
  extraction_method   text NOT NULL CHECK (extraction_method IN ('pdf_text', 'ocr_image', 'ocr_pdf', 'manual')),
  extracted           jsonb NOT NULL DEFAULT '{}'::jsonb,
  warnings            jsonb NOT NULL DEFAULT '[]'::jsonb,
  confidence          numeric(5,4),
  party_name          text,
  invoice_number      text,
  invoice_date        date,
  due_date            date,
  currency            char(3),
  subtotal            numeric(20,4),
  vat_total           numeric(20,4),
  total_amount        numeric(20,4),
  duplicate_of        uuid REFERENCES document_imports(id) ON DELETE SET NULL,
  approved_at         timestamptz,
  approved_by         uuid REFERENCES app_users(id) ON DELETE SET NULL,
  rejected_reason     text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS document_imports_company_idx ON document_imports (company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS document_imports_duplicate_idx ON document_imports (company_id, sha256);

CREATE TABLE IF NOT EXISTS document_import_lines (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id         uuid NOT NULL REFERENCES document_imports(id) ON DELETE CASCADE,
  company_id          uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  line_no             integer NOT NULL CHECK (line_no > 0),
  description         text NOT NULL,
  quantity            numeric(20,4),
  unit_price          numeric(20,4),
  net_amount          numeric(20,4) NOT NULL DEFAULT 0,
  vat_amount          numeric(20,4) NOT NULL DEFAULT 0,
  total_amount        numeric(20,4) NOT NULL DEFAULT 0,
  account_id          uuid REFERENCES accounts(id) ON DELETE SET NULL,
  vat_account_id      uuid REFERENCES accounts(id) ON DELETE SET NULL,
  confidence          numeric(5,4),
  UNIQUE (document_id, line_no)
);

CREATE TABLE IF NOT EXISTS document_proposals (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id          uuid REFERENCES cabinets(id) ON DELETE CASCADE,
  company_id          uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  document_id         uuid NOT NULL REFERENCES document_imports(id) ON DELETE CASCADE,
  status              text NOT NULL DEFAULT 'PROPOSED'
                        CHECK (status IN ('PROPOSED', 'APPROVED', 'REJECTED')),
  kind                text NOT NULL CHECK (kind IN ('purchase', 'sale')),
  party_id            uuid,
  party_name          text,
  journal_id          uuid REFERENCES journals(id) ON DELETE SET NULL,
  entry_date          date NOT NULL,
  currency            char(3) NOT NULL,
  lines               jsonb NOT NULL DEFAULT '[]'::jsonb,
  balanced            boolean NOT NULL DEFAULT false,
  uncertain_fields    jsonb NOT NULL DEFAULT '[]'::jsonb,
  rationale           jsonb NOT NULL DEFAULT '{}'::jsonb,
  draft_entry_id      uuid REFERENCES journal_entries(id) ON DELETE SET NULL,
  approved_at         timestamptz,
  approved_by         uuid REFERENCES app_users(id) ON DELETE SET NULL,
  rejected_reason     text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS document_proposals_company_idx ON document_proposals (company_id, status, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS document_proposals_document_idx ON document_proposals (document_id);

CREATE TABLE IF NOT EXISTS document_mappings (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  kind                text NOT NULL CHECK (kind IN ('purchase', 'sale')),
  party_key           text NOT NULL,
  keyword_key         text NOT NULL,
  account_id          uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  vat_account_id      uuid REFERENCES accounts(id) ON DELETE SET NULL,
  usage_count         integer NOT NULL DEFAULT 1,
  last_used_at        timestamptz NOT NULL DEFAULT now(),
  created_by          uuid REFERENCES app_users(id) ON DELETE SET NULL,
  UNIQUE (company_id, kind, party_key, keyword_key)
);
