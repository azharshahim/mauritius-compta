/**
 * Mission 23 — document intake, extraction persistence and human-validated
 * accounting proposals. Nothing is posted automatically: approval creates a
 * DRAFT journal entry that an accountant still has to post.
 */
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Db } from '../../db/index.js';
import type { Config } from '../../config.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { formatAmount, parseAmount } from '../../lib/money.js';
import { extractDocument } from './extract.js';
import { parseInvoiceText, type ParsedInvoice } from './parse-invoice.js';
import { assertOpenPeriod, insertLines, nextEntryNo, prepareEntry } from '../entries/service.js';

const ALLOWED = new Set(['application/pdf', 'image/jpeg', 'image/png']);
const EXT: Record<string, string> = {
  'application/pdf': '.pdf', 'image/jpeg': '.jpg', 'image/png': '.png',
};
const MAX_DOCUMENT_BYTES = 8 * 1024 * 1024;

export function detectSignature(buffer: Buffer): 'application/pdf' | 'image/jpeg' | 'image/png' | null {
  if (buffer.length >= 5 && buffer.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  return null;
}

export interface UploadDocumentInput {
  fileName: string;
  contentBase64: string;
  declaredMime?: string;
  kind: 'purchase' | 'sale';
}
export interface DocumentRow {
  id: string; company_id: string; kind: string; status: string; original_name: string;
  mime_type: string; size_bytes: number; sha256: string; page_count: number;
  extraction_method: string; extracted: ParsedInvoice & { text?: string }; warnings: string[];
  confidence: string | null; party_name: string | null; invoice_number: string | null;
  invoice_date: string | null; due_date: string | null; currency: string | null;
  subtotal: string | null; vat_total: string | null; total_amount: string | null;
  document_type: 'invoice' | 'credit_note' | 'unknown'; discount_total: string | null;
  tax_ids: ParsedInvoice['taxIds']; purchase_order: string | null; payment_terms: string | null;
  field_confidence: Record<string, number>; uncertain_fields: string[]; extraction_quality: Record<string, unknown>;
  duplicate_of: string | null; created_at: string;
}

const CORRECTED_FIELD_NAMES: Record<string, string[]> = {
  party_name: ['supplierName', 'customerName'],
  invoice_number: ['invoiceNumber'],
  invoice_date: ['invoiceDate'],
  due_date: ['dueDate'],
  currency: ['currency'],
  subtotal: ['subtotal'],
  vat_total: ['vatTotal'],
  total_amount: ['total'],
  document_type: ['documentType'],
  discount_total: ['discountTotal'],
  purchase_order: ['purchaseOrder'],
  payment_terms: ['paymentTerms'],
  tax_ids: ['supplierBrn', 'supplierVat', 'customerBrn', 'customerVat'],
};
function correctedFieldNames(patch: Record<string, unknown>): string[] {
  return [...new Set(Object.keys(patch).flatMap((key) => CORRECTED_FIELD_NAMES[key] ?? []))];
}

async function cabinetOf(db: Db, companyId: string): Promise<string | null> {
  const res = await db.query<{ cabinet_id: string | null }>('SELECT cabinet_id FROM companies WHERE id=$1', [companyId]);
  return res.rows[0]?.cabinet_id ?? null;
}

function safeName(name: string): string {
  return name.replace(/[^A-Za-z0-9._-]/g, '_').slice(-120) || 'document';
}

export async function uploadDocument(
  db: Db,
  config: Config,
  actor: { userId: string; companyId: string; ip?: string },
  input: UploadDocumentInput,
) {
  if (!input.contentBase64 || typeof input.contentBase64 !== 'string') {
    throw badRequest('DOCUMENT_EMPTY', 'No file content was supplied');
  }
  const buffer = Buffer.from(input.contentBase64.replace(/^data:[^;]+;base64,/, ''), 'base64');
  if (!buffer.length) throw badRequest('DOCUMENT_EMPTY', 'The uploaded file is empty');
  if (buffer.length > Math.min(config.MAX_UPLOAD_BYTES, MAX_DOCUMENT_BYTES)) {
    throw badRequest('DOCUMENT_TOO_LARGE', 'The document exceeds the upload limit');
  }
  if (input.declaredMime && !ALLOWED.has(input.declaredMime)) {
    throw badRequest('DOCUMENT_TYPE_NOT_ALLOWED', 'Only PDF, JPEG and PNG documents are accepted');
  }
  const signature = detectSignature(buffer);
  if (!signature) throw badRequest('DOCUMENT_TYPE_NOT_ALLOWED', 'The file signature is not PDF, JPEG or PNG');
  if (input.declaredMime && input.declaredMime !== signature) {
    throw badRequest('DOCUMENT_TYPE_NOT_ALLOWED', 'The declared type does not match the file content');
  }

  const sha256 = createHash('sha256').update(buffer).digest('hex');
  const prior = await db.query<any>(
    `SELECT id, invoice_number, party_name, status FROM document_imports
      WHERE company_id=$1 AND sha256=$2 AND status <> 'FAILED' ORDER BY created_at LIMIT 1`,
    [actor.companyId, sha256]);
  const duplicateOf = prior.rows[0]?.id ?? null;

  let extraction;
  try {
    extraction = await extractDocument(buffer, signature);
  } catch (error) {
    throw badRequest('DOCUMENT_EXTRACTION_FAILED', `Text extraction failed: ${(error as Error).message}`);
  }
  const parsed = parseInvoiceText(extraction.text, {
    extractionMethod: extraction.method,
    extractionConfidence: extraction.confidence,
    pageCount: extraction.pageCount,
  });
  const warnings = [...extraction.warnings, ...parsed.warnings];
  if (!extraction.text.trim()) warnings.push('No text was recognised. Enter the fields manually.');
  if (extraction.method !== 'pdf_text' && extraction.confidence < 0.6) {
    warnings.push(`OCR quality is low (${Math.round(extraction.confidence * 100)}%); review every field before generating a proposal.`);
  }
  if (duplicateOf) warnings.push('An identical file was already imported for this company.');
  const criticalFields = ['supplierName', 'invoiceNumber', 'invoiceDate', 'currency', 'total', 'vatTotal'];
  const confidenceValues = criticalFields
    .map((field) => parsed.fieldConfidence[field] ?? 0)
    .filter((value) => value > 0);
  const confidence = confidenceValues.length
    ? (confidenceValues.reduce((a, b) => a + b, 0) / confidenceValues.length).toFixed(4)
    : '0.0000';

  const id = randomUUID();
  const storageKey = path.posix.join('documents', actor.companyId, `${id}${EXT[signature]}`);
  const dir = path.join(config.STORAGE_DIR, 'documents', actor.companyId);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(config.STORAGE_DIR, storageKey), buffer, { mode: 0o600 });

  const invoiceKey = parsed.invoiceNumber && parsed.supplierName
    ? await db.query<any>(
      `SELECT id FROM document_imports WHERE company_id=$1 AND lower(coalesce(invoice_number,''))=lower($2)
        AND lower(coalesce(party_name,''))=lower($3) AND id<>$4 LIMIT 1`,
      [actor.companyId, parsed.invoiceNumber, parsed.supplierName, id])
    : null;
  const invoiceDuplicate = invoiceKey?.rows[0]?.id ?? null;

  const status = duplicateOf ? 'DUPLICATE' : 'EXTRACTED';
  const extraWarnings = [...warnings];
  if (invoiceDuplicate && !duplicateOf) extraWarnings.push('The same invoice number and party already exist; check for a duplicate before approving.');

  // Mission 42 / M41 D-02: a rescanned or re-compressed copy has a different
  // hash. We surface a deterministic similarity score; nothing is deleted or
  // blocked, a human decides.
  const recent = await db.query<any>(
    `SELECT id, party_name, invoice_number, total_amount, invoice_date, original_name
       FROM document_imports
      WHERE company_id = $1 AND status <> 'FAILED' AND created_at >= now() - INTERVAL '365 days'
      ORDER BY created_at DESC LIMIT 300`,
    [actor.companyId],
  );
  const similarDocuments = recent.rows
    .map((row) => {
      let score = 0;
      if (parsed.supplierName && row.party_name
          && normalise(parsed.supplierName) === normalise(row.party_name)) score += 0.45;
      if (parsed.invoiceNumber && row.invoice_number
          && normalise(parsed.invoiceNumber) === normalise(row.invoice_number)) score += 0.3;
      if (parsed.total && row.total_amount
          && parseAmount(parsed.total) === parseAmount(row.total_amount)) score += 0.15;
      if (parsed.invoiceDate && row.invoice_date
          && Math.abs(Date.parse(parsed.invoiceDate) - Date.parse(row.invoice_date)) <= 3 * 86_400_000) score += 0.1;
      return { id: row.id, originalName: row.original_name, score: Math.round(score * 100) / 100 };
    })
    .filter((row) => row.score >= 0.7)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
  if (similarDocuments.length > 0 && !duplicateOf) {
    extraWarnings.push(
      `POSSIBLE_RESCAN: ${similarDocuments.length} previously imported document(s) look similar. Review before approving; nothing was deleted.`,
    );
  }

  const inserted = await db.query<DocumentRow>(
    `INSERT INTO document_imports
       (id, cabinet_id, company_id, created_by, kind, status, original_name, mime_type, size_bytes,
        sha256, storage_key, page_count, extraction_method, extracted, warnings, confidence,
        party_name, invoice_number, invoice_date, due_date, currency, subtotal, vat_total,
        total_amount, document_type, discount_total, tax_ids, purchase_order, payment_terms,
        field_confidence, uncertain_fields, extraction_quality, duplicate_of)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15::jsonb,$16,
        $17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27::jsonb,$28,$29,$30::jsonb,$31::jsonb,
        $32::jsonb,$33) RETURNING *`,
    [id, await cabinetOf(db, actor.companyId), actor.companyId, actor.userId, input.kind, status,
      safeName(input.fileName).slice(0, 200), signature, buffer.length, sha256, storageKey,
      extraction.pageCount, extraction.method, JSON.stringify({ ...parsed, text: extraction.text.slice(0, 200_000) }),
      JSON.stringify(extraWarnings), confidence, parsed.supplierName ?? parsed.customerName,
      parsed.invoiceNumber, parsed.invoiceDate, parsed.dueDate, parsed.currency, parsed.subtotal,
      parsed.vatTotal, parsed.total, parsed.documentType, parsed.discountTotal,
      JSON.stringify(parsed.taxIds), parsed.purchaseOrder, parsed.paymentTerms,
      JSON.stringify(parsed.fieldConfidence), JSON.stringify(parsed.uncertainFields),
      JSON.stringify({
        method: extraction.method,
        confidence: Math.round(extraction.confidence * 10000) / 10000,
        pageCount: extraction.pageCount,
        pages: extraction.pages.map((page) => ({
          characters: page.text.replace(/\s/g, '').length,
          confidence: page.confidence === null ? null : Math.round(page.confidence * 10000) / 10000,
        })),
        invoiceCountSuspected: parsed.invoiceCountSuspected,
        multipleInvoicesSuspected: parsed.warningCodes.includes('MULTIPLE_INVOICES_SUSPECTED'),
        similarDocuments,
        extractionWarnings: extraction.warnings,
      }),
      duplicateOf ?? invoiceDuplicate]);

  let lineNo = 1;
  for (const line of parsed.lines) {
    await db.query(
      `INSERT INTO document_import_lines
         (document_id, company_id, line_no, description, quantity, unit_price, net_amount,
          vat_amount, total_amount, confidence)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [id, actor.companyId, lineNo++, line.description, line.quantity, line.unitPrice,
        line.netAmount, line.vatAmount, line.totalAmount, line.confidence]);
  }
  return { document: inserted.rows[0]! };
}

/**
 * Mission 29 — re-read the stored source with the current parser.
 *
 * The preview is read-only. Applying a new extraction is an explicit human
 * action and is restricted to an EXTRACTED document so a proposal is never
 * silently invalidated or a finalised document rewritten.
 */
export async function reextractDocument(
  db: Db, config: Config, actor: { userId: string; companyId: string },
  documentId: string, apply = false,
) {
  const existing = await db.query<DocumentRow>(
    'SELECT * FROM document_imports WHERE id=$1 AND company_id=$2', [documentId, actor.companyId]);
  const document = existing.rows[0];
  if (!document) throw notFound('DOCUMENT_NOT_FOUND', 'Document not found');
  if (apply && document.status !== 'EXTRACTED') {
    throw conflict('DOCUMENT_NOT_REEXTRACTABLE', 'Only an extracted document that has not been proposed can be re-extracted');
  }
  const file = await documentFile(db, config, actor.companyId, documentId);
  const extraction = await extractDocument(file.buffer, file.mimeType as 'application/pdf' | 'image/jpeg' | 'image/png');
  const parsed = parseInvoiceText(extraction.text, {
    extractionMethod: extraction.method,
    extractionConfidence: extraction.confidence,
    pageCount: extraction.pageCount,
  });
  const criticalFields = ['supplierName', 'invoiceNumber', 'invoiceDate', 'currency', 'total', 'vatTotal'];
  const values = criticalFields.map((field) => parsed.fieldConfidence[field] ?? 0).filter((value) => value > 0);
  const confidence = values.length ? (values.reduce((a, b) => a + b, 0) / values.length).toFixed(4) : '0.0000';
  const warnings = [...extraction.warnings, ...parsed.warnings];
  const fields = {
    party_name: parsed.supplierName ?? parsed.customerName,
    invoice_number: parsed.invoiceNumber,
    invoice_date: parsed.invoiceDate,
    due_date: parsed.dueDate,
    currency: parsed.currency,
    subtotal: parsed.subtotal,
    vat_total: parsed.vatTotal,
    total_amount: parsed.total,
    document_type: parsed.documentType,
    discount_total: parsed.discountTotal,
    purchase_order: parsed.purchaseOrder,
    payment_terms: parsed.paymentTerms,
  };
  const changedFields = Object.entries(fields)
    .filter(([key, value]) => String((document as unknown as Record<string, unknown>)[key] ?? '') !== String(value ?? ''))
    .map(([key]) => key);

  if (!apply) {
    return {
      documentId,
      applied: false,
      extraction: { method: extraction.method, pageCount: extraction.pageCount,
        confidence: Math.round(extraction.confidence * 10000) / 10000, warnings: extraction.warnings },
      parsed,
      warnings,
      changedFields,
      note: 'Preview only. Call again with apply=true to replace the extraction fields of this EXTRACTED document.',
    };
  }

  const updated = await db.query<DocumentRow>(
    `UPDATE document_imports SET
       party_name=$3, invoice_number=$4, invoice_date=$5, due_date=$6, currency=$7,
       subtotal=$8, vat_total=$9, total_amount=$10, document_type=$11, discount_total=$12,
       purchase_order=$13, payment_terms=$14, tax_ids=$15::jsonb, field_confidence=$16::jsonb,
       uncertain_fields=$17::jsonb, extraction_quality=$18::jsonb, extracted=$19::jsonb,
       warnings=$20::jsonb, confidence=$21, extraction_method=$22, page_count=$23, updated_at=now()
     WHERE id=$1 AND company_id=$2 RETURNING *`,
    [documentId, actor.companyId, fields.party_name, fields.invoice_number, fields.invoice_date,
      fields.due_date, fields.currency, fields.subtotal, fields.vat_total, fields.total_amount,
      fields.document_type, fields.discount_total, fields.purchase_order, fields.payment_terms,
      JSON.stringify(parsed.taxIds), JSON.stringify(parsed.fieldConfidence),
      JSON.stringify(parsed.uncertainFields), JSON.stringify({
        method: extraction.method, confidence: Math.round(extraction.confidence * 10000) / 10000,
        pageCount: extraction.pageCount, invoiceCountSuspected: parsed.invoiceCountSuspected,
        multipleInvoicesSuspected: parsed.warningCodes.includes('MULTIPLE_INVOICES_SUSPECTED'),
      }), JSON.stringify({ ...parsed, text: extraction.text.slice(0, 200_000) }),
      JSON.stringify(warnings), confidence, extraction.method, extraction.pageCount]);
  return { documentId, applied: true, document: updated.rows[0]!, extraction: {
    method: extraction.method, pageCount: extraction.pageCount,
    confidence: Math.round(extraction.confidence * 10000) / 10000, warnings: extraction.warnings,
  }, parsed, warnings, changedFields };
}

export async function listDocuments(db: Db, companyId: string, status?: string) {
  const params: unknown[] = [companyId];
  let where = 'd.company_id=$1';
  if (status) { params.push(status); where += ` AND d.status=$${params.length}`; }
  const res = await db.query(
    `SELECT d.id, d.kind, d.status, d.original_name, d.mime_type, d.size_bytes, d.page_count,
            d.extraction_method, d.confidence, d.party_name, d.invoice_number, d.invoice_date,
            d.due_date, d.currency, d.subtotal, d.vat_total, d.total_amount, d.document_type,
            d.discount_total, d.tax_ids, d.purchase_order, d.payment_terms, d.field_confidence,
            d.uncertain_fields, d.extraction_quality, d.warnings, d.duplicate_of, d.created_at,
            d.purchase_document_id, pd.doc_no AS purchase_document_no,
            pd.accounting_entry_id AS purchase_accounting_entry_id,
            p.status AS proposal_status, p.draft_entry_id,
            je.status AS draft_entry_status,
            CASE
              WHEN pd.accounting_entry_id IS NOT NULL THEN 'posted'
              WHEN je.status = 'posted' THEN 'posted'
              WHEN p.draft_entry_id IS NOT NULL THEN 'draft'
              WHEN p.status = 'PROPOSED' THEN 'proposed'
              ELSE 'not_prepared'
            END AS posting_status
       FROM document_imports d
       LEFT JOIN purchase_documents pd ON pd.id = d.purchase_document_id
       LEFT JOIN document_proposals p ON p.document_id = d.id
       LEFT JOIN journal_entries je ON je.id = p.draft_entry_id
      WHERE ${where}
      ORDER BY d.created_at DESC LIMIT 200`, params);
  return res.rows;
}

export async function getDocument(db: Db, companyId: string, documentId: string) {
  const res = await db.query<any>(
    `SELECT d.*, pd.doc_no AS purchase_document_no,
            pd.accounting_entry_id AS purchase_accounting_entry_id,
            p.status AS proposal_status, p.draft_entry_id,
            je.status AS draft_entry_status,
            CASE
              WHEN pd.accounting_entry_id IS NOT NULL THEN 'posted'
              WHEN je.status = 'posted' THEN 'posted'
              WHEN p.draft_entry_id IS NOT NULL THEN 'draft'
              WHEN p.status = 'PROPOSED' THEN 'proposed'
              ELSE 'not_prepared'
            END AS posting_status
       FROM document_imports d
       LEFT JOIN purchase_documents pd ON pd.id = d.purchase_document_id
       LEFT JOIN document_proposals p ON p.document_id = d.id
       LEFT JOIN journal_entries je ON je.id = p.draft_entry_id
      WHERE d.id=$1 AND d.company_id=$2`, [documentId, companyId]);
  const document = res.rows[0];
  if (!document) throw notFound('DOCUMENT_NOT_FOUND', 'Document not found');
  const lines = await db.query<any>(
    `SELECT l.*, a.code AS account_code, a.name AS account_name
       FROM document_import_lines l LEFT JOIN accounts a ON a.id=l.account_id
      WHERE l.document_id=$1 ORDER BY l.line_no`, [documentId]);
  const proposals = await db.query<any>(
    `SELECT * FROM document_proposals WHERE document_id=$1 ORDER BY created_at DESC`, [documentId]);
  return { document, lines: lines.rows, proposals: proposals.rows };
}

export async function documentFile(db: Db, config: Config, companyId: string, documentId: string) {
  const res = await db.query<{ storage_key: string; mime_type: string; original_name: string }>(
    `SELECT storage_key, mime_type, original_name FROM document_imports
      WHERE id=$1 AND company_id=$2 AND storage_key IS NOT NULL`, [documentId, companyId]);
  const row = res.rows[0];
  if (!row) throw notFound('DOCUMENT_NOT_FOUND', 'Document file not found');
  const resolved = path.resolve(config.STORAGE_DIR, row.storage_key);
  const root = path.resolve(config.STORAGE_DIR, 'documents');
  if (!resolved.startsWith(`${root}${path.sep}`)) throw badRequest('DOCUMENT_PATH_INVALID', 'Invalid storage path');
  return { buffer: await readFile(resolved), mimeType: row.mime_type, fileName: row.original_name };
}

export async function updateDocument(
  db: Db, companyId: string, documentId: string,
  patch: {
    kind?: 'purchase' | 'sale'; party_name?: string | null; invoice_number?: string | null;
    invoice_date?: string | null; due_date?: string | null; currency?: string | null;
    subtotal?: string | number | null; vat_total?: string | number | null;
    total_amount?: string | number | null;
    document_type?: 'invoice' | 'credit_note' | 'unknown';
    discount_total?: string | number | null;
    purchase_order?: string | null;
    payment_terms?: string | null;
    tax_ids?: Partial<ParsedInvoice['taxIds']> | null;
  },
) {
  const existing = await db.query<DocumentRow>(
    'SELECT * FROM document_imports WHERE id=$1 AND company_id=$2', [documentId, companyId]);
  if (!existing.rows[0]) throw notFound('DOCUMENT_NOT_FOUND', 'Document not found');
  const amount = (v: string | number | null | undefined) => {
    if (v === undefined || v === null || v === '') return null;
    try { return formatAmount(parseAmount(v)); }
    catch { throw badRequest('DOCUMENT_AMOUNT_INVALID', 'One of the corrected amounts is not a valid decimal'); }
  };
  const updated = await db.query<DocumentRow>(
    `UPDATE document_imports SET
       kind=COALESCE($3,kind), party_name=COALESCE($4,party_name),
       invoice_number=COALESCE($5,invoice_number),
       invoice_date=CASE WHEN $6::boolean THEN $7::date ELSE invoice_date END,
       due_date=CASE WHEN $8::boolean THEN $9::date ELSE due_date END,
       currency=COALESCE($10,currency), subtotal=COALESCE($11,subtotal),
       vat_total=COALESCE($12,vat_total), total_amount=COALESCE($13,total_amount),
       document_type=COALESCE($14,document_type),
       discount_total=COALESCE($15,discount_total),
       purchase_order=COALESCE($16,purchase_order),
       tax_ids=CASE WHEN $17::jsonb IS NULL THEN tax_ids ELSE tax_ids || $17::jsonb END,
       payment_terms=COALESCE($18,payment_terms),
       uncertain_fields=uncertain_fields - $19::text[],
       updated_at=now()
     WHERE id=$1 AND company_id=$2 RETURNING *`,
    [documentId, companyId, patch.kind ?? null, patch.party_name ?? null, patch.invoice_number ?? null,
      patch.invoice_date !== undefined, patch.invoice_date ?? null,
      patch.due_date !== undefined, patch.due_date ?? null, patch.currency ?? null,
      amount(patch.subtotal), amount(patch.vat_total), amount(patch.total_amount),
      patch.document_type ?? null, amount(patch.discount_total), patch.purchase_order ?? null,
      patch.tax_ids === undefined || patch.tax_ids === null ? null : JSON.stringify(patch.tax_ids),
      patch.payment_terms ?? null, correctedFieldNames(patch)]);
  return updated.rows[0]!;
}

/* -------------------------------------------------------------------------- */
/* Proposal generation                                                        */
/* -------------------------------------------------------------------------- */

interface Account {
  id: string; code: string; name: string; type: string; account_role: string | null;
  name_en: string | null; name_fr: string | null;
}
export interface ProposalLine {
  accountId: string | null; accountCode: string | null; accountName: string | null;
  description: string; debit: string; credit: string; needsAccount: boolean; role: string | null;
}
export interface PartyCandidate { id: string; name: string; score: number; type: 'supplier' | 'customer' }

const KEYWORDS: { role: string; words: RegExp }[] = [
  { role: 'rent', words: /rent|loyer|lease|bail/i },
  { role: 'utilities', words: /electric|water|utility|utilit|ceb|cwa|eau|électric/i },
  { role: 'telecom', words: /telecom|phone|mobile|internet|orange|mauritius telecom|my\.t/i },
  { role: 'professional_fees', words: /professional|consult|account|audit|legal|avocat|honoraire/i },
  { role: 'insurance', words: /insurance|assurance|policy/i },
  { role: 'bank_charges', words: /bank\s*(charge|fee)|frais bancaire|commission/i },
  { role: 'external_services', words: /service|maintenance|repair|cleaning|transport|delivery|marketing/i },
  { role: 'purchases', words: /paper|toner|office|supply|stock|goods|marchandise|purchase|achat/i },
  { role: 'revenue', words: /sale|goods|marchandise|vente/i },
  { role: 'service_revenue', words: /service|consult|prestation|honoraire/i },
];
function normalise(v: string): string {
  return v.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\b(ltd|limited|ltée|sarl|sas|sa|inc|co|company)\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim();
}
function keywordOf(description: string): string {
  return normalise(description).split(' ').filter((w) => w.length > 2).slice(0, 3).join(' ');
}

export async function partyCandidates(db: Db, companyId: string, kind: 'purchase' | 'sale', name: string | null): Promise<PartyCandidate[]> {
  if (!name) return [];
  const table = kind === 'purchase' ? 'purchase_suppliers' : 'billing_customers';
  const res = await db.query<{ id: string; name: string }>(
    `SELECT id, name FROM ${table} WHERE company_id=$1 AND is_active=true LIMIT 500`, [companyId]);
  const wanted = normalise(name);
  const words = new Set(wanted.split(' ').filter(Boolean));
  return res.rows.map((row) => {
    const candidate = normalise(row.name);
    let score = 0;
    if (candidate === wanted) score = 1;
    else if (candidate.includes(wanted) || wanted.includes(candidate)) score = 0.85;
    else {
      const other = new Set(candidate.split(' ').filter(Boolean));
      const common = [...words].filter((w) => other.has(w)).length;
      score = common / Math.max(words.size, other.size);
    }
    return { id: row.id, name: row.name, score: Math.round(score * 100) / 100,
      type: kind === 'purchase' ? 'supplier' as const : 'customer' as const };
  }).filter((c) => c.score > 0.3).sort((a, b) => b.score - a.score).slice(0, 5);
}

function accountForRole(accounts: Account[], role: string | null): Account | null {
  return role ? accounts.find((a) => a.account_role === role) ?? null : null;
}
function accountByLabel(accounts: Account[], pattern: RegExp, type?: string): Account | null {
  return accounts.find((a) => pattern.test(`${a.name} ${a.name_en ?? ''} ${a.name_fr ?? ''}`)
    && (!type || a.type === type)) ?? null;
}
function fallbackVatAccount(accounts: Account[], kind: 'purchase' | 'sale'): Account | null {
  return accountByLabel(accounts, /\b(vat|tva)\b/i,
    kind === 'purchase' ? 'asset' : 'liability')
    ?? accountByLabel(accounts, /\b(vat|tva)\b/i);
}
function fallbackPartyAccount(accounts: Account[], kind: 'purchase' | 'sale'): Account | null {
  return kind === 'purchase'
    ? accountByLabel(accounts, /(fournisseur|supplier|payable|crediteur|créditeur)/i, 'liability')
    : accountByLabel(accounts, /(client|customer|receivable|debiteur|débiteur)/i, 'asset');
}
function fallbackTradingAccount(accounts: Account[], kind: 'purchase' | 'sale'): Account | null {
  return accounts.find((a) => a.type === (kind === 'purchase' ? 'expense' : 'revenue')) ?? null;
}
function accountForDescription(accounts: Account[], description: string, kind: 'purchase' | 'sale') {
  for (const keyword of KEYWORDS) {
    if (kind === 'purchase' && ['revenue', 'service_revenue'].includes(keyword.role)) continue;
    if (kind === 'sale' && !['revenue', 'service_revenue'].includes(keyword.role)) continue;
    if (!keyword.words.test(description)) continue;
    const byRole = accountForRole(accounts, keyword.role);
    if (byRole) return byRole;
    const byName = accounts.find((a) => keyword.words.test(a.name) && a.type === (kind === 'purchase' ? 'expense' : 'revenue'));
    if (byName) return byName;
  }
  return accountForRole(accounts, kind === 'purchase' ? 'other_expense' : 'other_income');
}
function line(account: Account | null, description: string, debit: string, credit: string, role: string | null): ProposalLine {
  return { accountId: account?.id ?? null, accountCode: account?.code ?? null,
    accountName: account?.name ?? null, description, debit, credit, needsAccount: !account, role };
}

export async function generateProposal(
  db: Db,
  actor: { userId: string; companyId: string },
  documentId: string,
  options: { confirmMultipleInvoices?: boolean } = {},
) {
  const detail = await getDocument(db, actor.companyId, documentId);
  const document = detail.document;
  if (document.status === 'DUPLICATE') throw conflict('DOCUMENT_DUPLICATE', 'A duplicate document cannot be proposed');
  if (['APPROVED', 'REJECTED'].includes(document.status)) throw conflict('DOCUMENT_FINAL', 'This document is already finalised');
  const quality = document.extraction_quality ?? {};
  if ((quality.multipleInvoicesSuspected === true || Number(quality.invoiceCountSuspected ?? 0) > 1)
      && options.confirmMultipleInvoices !== true) {
    throw conflict(
      'DOCUMENT_MULTIPLE_INVOICES_CONFIRMATION_REQUIRED',
      'Several invoices were detected in this file. Split the file or confirm explicitly that the proposal covers exactly one invoice.',
      { invoiceCountSuspected: quality.invoiceCountSuspected ?? null },
    );
  }
  const kind: 'purchase' | 'sale' = document.kind === 'sale' ? 'sale' : 'purchase';
  const absolute = (value: string | null) => value === null ? null : formatAmount((() => {
    const parsed = parseAmount(value);
    return parsed < 0n ? -parsed : parsed;
  })());
  const isCreditNote = document.document_type === 'credit_note';
  const totalRaw = absolute(document.total_amount ? formatAmount(parseAmount(document.total_amount)) : null);
  if (!totalRaw) throw badRequest('DOCUMENT_TOTAL_MISSING', 'Enter the document total before generating a proposal');
  // The proposal currency is never guessed: a missing document currency must
  // be corrected by a human before any accounting proposal is created.
  if (!document.currency) throw badRequest('DOCUMENT_CURRENCY_MISSING', 'Choose the document currency before generating a proposal');

  const accountsRes = await db.query<Account>(
    `SELECT id, code, name, type, account_role, name_en, name_fr FROM accounts
      WHERE company_id=$1 AND is_active=true AND posting_allowed=true ORDER BY code`, [actor.companyId]);
  const accounts = accountsRes.rows;
  const journalRes = await db.query<{ id: string }>(
    `SELECT id FROM journals WHERE company_id=$1 AND is_active=true AND type=$2 ORDER BY created_at LIMIT 1`,
    [actor.companyId, kind === 'purchase' ? 'purchases' : 'sales']);
  const journalId = journalRes.rows[0]?.id ?? null;
  const candidates = await partyCandidates(db, actor.companyId, kind, document.party_name);
  const party = candidates[0] ?? null;
  // A habitual supplier may not exist yet in the supplier master. The party
  // key learned from a human approval still applies to the extracted name.
  const learnedPartyName = party?.name ?? document.party_name;

  const net = absolute(document.subtotal ? formatAmount(parseAmount(document.subtotal)) : null);
  const vat = absolute(document.vat_total ? formatAmount(parseAmount(document.vat_total)) : '0.0000') ?? '0.0000';
  const discount = absolute(document.discount_total ? formatAmount(parseAmount(document.discount_total)) : null);
  const uncertain: string[] = [];
  if (!journalId) uncertain.push('journal');
  if (!party) uncertain.push('party');
  if (!document.invoice_date) uncertain.push('invoiceDate');
  if (!document.currency) uncertain.push('currency');
  if (document.document_type === 'unknown') uncertain.push('documentType');
  if (Array.isArray(document.uncertain_fields)) {
    for (const field of document.uncertain_fields) if (typeof field === 'string') uncertain.push(field);
  }

  const lines: ProposalLine[] = [];
  const mappings = learnedPartyName ? await db.query<{ keyword_key: string; account_id: string }>(
    `SELECT keyword_key, account_id FROM document_mappings
      WHERE company_id=$1 AND kind=$2 AND party_key=$3
        AND is_active = true AND usage_count >= 2`,
    [actor.companyId, kind, normalise(learnedPartyName)]) : null;

  const expenseLines = detail.lines.length
    ? detail.lines
    : [{ description: 'Document total', net_amount: net ?? totalRaw, vat_amount: vat, line_no: 1 }];
  const tradingAccounts: (Account | null)[] = [];
  for (const docLine of expenseLines) {
    const description = String(docLine.description);
    const learned = mappings?.rows.find((m) => keywordOf(description).startsWith(m.keyword_key)
      || m.keyword_key.includes(keywordOf(description)))?.account_id;
    let account = learned ? accounts.find((a) => a.id === learned) ?? null : null;
    if (!account) account = accountForDescription(accounts, description, kind)
      ?? fallbackTradingAccount(accounts, kind);
    if (!account) uncertain.push('account');
    tradingAccounts.push(account);
    const netLine = absolute(docLine.net_amount ? formatAmount(parseAmount(docLine.net_amount)) : net)
      ?? totalRaw;
    lines.push(kind === 'purchase'
      ? line(account, description, netLine, '0.0000', account?.account_role ?? null)
      : line(account, description, '0.0000', netLine, account?.account_role ?? null));
  }

  // A printed discount reduces the expense/revenue without changing the
  // document total. It is represented by a separate line so the audit trail
  // shows the discount instead of silently reducing a line amount.
  if (discount && parseAmount(discount) > 0n) {
    const discountAccount = tradingAccounts.find((account) => account !== null)
      ?? fallbackTradingAccount(accounts, kind);
    if (!discountAccount) uncertain.push('discountAccount');
    lines.push(kind === 'purchase'
      ? line(discountAccount, 'Discount stated on document', '0.0000', discount, 'discount')
      : line(discountAccount, 'Discount stated on document', discount, '0.0000', 'discount'));
  }

  const vatValue = parseAmount(vat);
  if (vatValue > 0n) {
    const vatAccount = accountForRole(accounts, kind === 'purchase' ? 'vat_input' : 'vat_output')
      ?? fallbackVatAccount(accounts, kind);
    if (!vatAccount) uncertain.push('vatAccount');
    lines.push(kind === 'purchase'
      ? line(vatAccount, 'VAT stated on document', vat, '0.0000', 'vat_input')
      : line(vatAccount, 'VAT stated on document', '0.0000', vat, 'vat_output'));
  }
  const partyAccount = kind === 'purchase'
    ? (party ? await db.query<{ payable_account_id: string | null }>(
      'SELECT payable_account_id FROM purchase_suppliers WHERE id=$1', [party.id])
      .then((r) => r.rows[0]?.payable_account_id ?? null) : null)
    : (party ? await db.query<{ receivable_account_id: string | null }>(
      'SELECT receivable_account_id FROM billing_customers WHERE id=$1', [party.id])
      .then((r) => r.rows[0]?.receivable_account_id ?? null) : null);
  const partyAcc = partyAccount ? accounts.find((a) => a.id === partyAccount) ?? null
    : accountForRole(accounts, kind === 'purchase' ? 'payable' : 'receivable')
      ?? fallbackPartyAccount(accounts, kind);
  if (!partyAcc) uncertain.push('partyAccount');
  lines.push(kind === 'purchase'
    ? line(partyAcc, party?.name ?? document.party_name ?? 'Supplier', '0.0000', totalRaw, 'payable')
    : line(partyAcc, party?.name ?? document.party_name ?? 'Customer', totalRaw, '0.0000', 'receivable'));

  // A supplier credit note reverses the invoice directions. It is still only a
  // proposal; the human approval creates a draft entry, never a posted entry.
  if (isCreditNote) {
    for (const draftLine of lines) {
      const debitValue = draftLine.debit;
      draftLine.debit = draftLine.credit;
      draftLine.credit = debitValue;
    }
  }

  const debit = lines.reduce((sum, l) => sum + parseAmount(l.debit), 0n);
  const credit = lines.reduce((sum, l) => sum + parseAmount(l.credit), 0n);
  const balanced = debit === credit;
  if (!balanced) uncertain.push('imbalance');

  const entryDate = document.invoice_date ? String(document.invoice_date).slice(0, 10)
    : new Date().toISOString().slice(0, 10);
  if (!document.invoice_date) uncertain.push('entryDate');

  const result = await db.query<any>(
    `INSERT INTO document_proposals
       (cabinet_id, company_id, document_id, kind, party_id, party_name, journal_id, entry_date,
        currency, lines, balanced, uncertain_fields, rationale)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12::jsonb,$13::jsonb)
     ON CONFLICT (document_id) DO UPDATE SET status='PROPOSED', party_id=$5, party_name=$6,
       journal_id=$7, entry_date=$8, currency=$9, lines=$10::jsonb, balanced=$11,
       uncertain_fields=$12::jsonb, rationale=$13::jsonb, updated_at=now()
     RETURNING *`,
    [await cabinetOf(db, actor.companyId), actor.companyId, documentId, kind, party?.id ?? null,
      party?.name ?? document.party_name, journalId, entryDate,
      document.currency, JSON.stringify(lines), balanced,
      JSON.stringify([...new Set(uncertain)]),
      JSON.stringify({ candidates, debitTotal: formatAmount(debit), creditTotal: formatAmount(credit),
        confidence: document.confidence, extractionMethod: document.extraction_method })]);
  await db.query(`UPDATE document_imports SET status='PROPOSED', updated_at=now() WHERE id=$1`, [documentId]);
  return { proposal: result.rows[0], candidates };
}

export interface ApprovalLineInput {
  accountId: string; description?: string | null; debit?: string | number | null; credit?: string | number | null;
}
export async function approveProposal(
  db: Db, actor: { userId: string; companyId: string },
  proposalId: string, body: { confirm: true; lines: ApprovalLineInput[]; partyId?: string | null;
    journalId?: string; entryDate?: string; reference?: string | null; exchangeRate?: string | number | null },
) {
  const res = await db.query<any>(
    `SELECT p.*, d.id AS doc_id, d.status AS doc_status, d.original_name, d.invoice_number
       FROM document_proposals p JOIN document_imports d ON d.id=p.document_id
      WHERE p.id=$1 AND p.company_id=$2`, [proposalId, actor.companyId]);
  const proposal = res.rows[0];
  if (!proposal) throw notFound('PROPOSAL_NOT_FOUND', 'Proposal not found');
  if (proposal.status === 'APPROVED') throw conflict('PROPOSAL_ALREADY_APPROVED', 'This proposal is already approved');
  if (proposal.status === 'REJECTED') throw conflict('PROPOSAL_REJECTED', 'This proposal was rejected');
  if (proposal.doc_status === 'DUPLICATE') throw conflict('DOCUMENT_DUPLICATE', 'A duplicate document cannot be approved');
  if (body.lines.length < 2) throw badRequest('PROPOSAL_TOO_FEW_LINES', 'At least two lines are required');

  const accounts = await db.query<{ id: string; type: string }>(
    `SELECT id, type FROM accounts WHERE company_id=$1 AND is_active=true AND id = ANY($2::uuid[])`,
    [actor.companyId, [...new Set(body.lines.map((l) => l.accountId))]]);
  const byId = new Map(accounts.rows.map((a) => [a.id, a]));
  for (const lineInput of body.lines) {
    if (!byId.has(lineInput.accountId)) throw badRequest('PROPOSAL_ACCOUNT_INVALID', 'Every line must use an active account of this company');
  }
  let partyId = proposal.party_id as string | null;
  let partyName = proposal.party_name as string | null;
  if (body.partyId !== undefined && body.partyId !== null) {
    const table = proposal.kind === 'purchase' ? 'purchase_suppliers' : 'billing_customers';
    const party = await db.query<{ id: string; name: string }>(
      `SELECT id, name FROM ${table} WHERE id=$1 AND company_id=$2 AND is_active=true`,
      [body.partyId, actor.companyId]);
    if (!party.rows[0]) throw badRequest('PROPOSAL_PARTY_INVALID', 'Choose an active party of this company');
    partyId = party.rows[0].id;
    partyName = party.rows[0].name;
  }
  const journalId = body.journalId ?? proposal.journal_id;
  if (!journalId) throw badRequest('PROPOSAL_JOURNAL_REQUIRED', 'Choose a journal');
  const journal = await db.query<any>(
    `SELECT * FROM journals WHERE id=$1 AND company_id=$2 AND is_active=true`, [journalId, actor.companyId]);
  if (!journal.rows[0]) throw badRequest('PROPOSAL_JOURNAL_REQUIRED', 'Choose an active journal of this company');

  const entryDate = body.entryDate ?? String(proposal.entry_date).slice(0, 10);
  const company = await db.query<{ functional_currency: string }>(
    'SELECT functional_currency FROM companies WHERE id=$1', [actor.companyId]);
  const functional = company.rows[0]!.functional_currency;
  const prepared = prepareEntry({
    journalId, entryDate, description: `Document import — ${proposal.original_name}`.slice(0, 300),
    reference: body.reference ?? (proposal.invoice_number ? `DOC:${proposal.invoice_number}` : null),
    currency: proposal.currency, exchangeRate: body.exchangeRate ?? null,
    lines: body.lines,
  }, functional, new Set(byId.keys()), new Set(byId.keys()));
  if (!prepared.balanced) throw badRequest('PROPOSAL_NOT_BALANCED', 'Debits and credits must be equal');

  const result = await db.transaction(async (tx) => {
    await assertOpenPeriod(tx, actor.companyId, entryDate);
    const journalRow = journal.rows[0];
    const entryNo = await nextEntryNo(tx, actor.companyId, journalRow, entryDate);
    const entry = await tx.query<any>(
      `INSERT INTO journal_entries
         (company_id, journal_id, entry_no, entry_date, reference, description, currency,
          exchange_rate, status, source, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'draft','manual',$9) RETURNING *`,
      [actor.companyId, journalId, entryNo, entryDate,
        body.reference ?? (proposal.invoice_number ? `DOC:${proposal.invoice_number}` : null),
        `Document import — ${proposal.original_name}`.slice(0, 300), prepared.currency,
        prepared.fxRate, actor.userId]);
    await insertLines(tx, entry.rows[0].id, actor.companyId, prepared);
    await tx.query(
      `UPDATE document_proposals SET status='APPROVED', lines=$2::jsonb, journal_id=$3,
         entry_date=$4, balanced=true, draft_entry_id=$5, approved_at=now(), approved_by=$6,
         party_id=$7, party_name=$8, updated_at=now() WHERE id=$1`,
      [proposalId, JSON.stringify(body.lines.map((l, i) => ({
        ...l, accountCode: null, needsAccount: false, lineNo: i + 1,
      }))), journalId, entryDate, entry.rows[0].id, actor.userId, partyId, partyName]);
    await tx.query(
      `UPDATE document_imports SET status='APPROVED', approved_at=now(), approved_by=$2, updated_at=now()
        WHERE id=$1`, [proposal.doc_id, actor.userId]);

    // Learning happens only here, after an explicit human approval. A rejected
    // or merely suggested proposal never writes a mapping.
    const partyKey = normalise(partyName ?? '');
    if (partyKey) {
      for (let i = 0; i < body.lines.length; i += 1) {
        const inputLine = body.lines[i]!;
        const type = byId.get(inputLine.accountId)?.type;
        if (type !== 'expense' && type !== 'revenue') continue;
        const sourceLine = Array.isArray(proposal.lines) ? proposal.lines[i] : null;
        const keyword = keywordOf(String(sourceLine?.description ?? inputLine.description ?? ''));
        if (!keyword) continue;
        await tx.query(
          `INSERT INTO document_mappings
             (company_id, kind, party_key, keyword_key, account_id, usage_count, last_used_at, created_by)
           VALUES ($1,$2,$3,$4,$5,1,now(),$6)
           ON CONFLICT (company_id, kind, party_key, keyword_key)
           DO UPDATE SET account_id=$5, usage_count=document_mappings.usage_count+1,
             last_used_at=now(), created_by=$6`,
          [actor.companyId, proposal.kind, partyKey, keyword, inputLine.accountId, actor.userId]);
      }
    }
    return entry.rows[0];
  });
  return { proposalId, status: 'APPROVED', draftEntry: result,
    note: 'A draft entry was created. It is not posted until an accountant posts it in Journals.' };
}

export async function rejectProposal(
  db: Db, actor: { userId: string; companyId: string }, proposalId: string, reason: string,
) {
  const res = await db.query<any>(
    `SELECT * FROM document_proposals WHERE id=$1 AND company_id=$2`, [proposalId, actor.companyId]);
  if (!res.rows[0]) throw notFound('PROPOSAL_NOT_FOUND', 'Proposal not found');
  if (res.rows[0].status === 'APPROVED') throw conflict('PROPOSAL_ALREADY_APPROVED', 'An approved proposal cannot be rejected');
  await db.query(
    `UPDATE document_proposals SET status='REJECTED', rejected_reason=$2, updated_at=now() WHERE id=$1`,
    [proposalId, reason]);
  await db.query(
    `UPDATE document_imports SET status='REJECTED', rejected_reason=$2, updated_at=now() WHERE id=$1`,
    [res.rows[0].document_id, reason]);
  return { proposalId, status: 'REJECTED' };
}


/**
 * Mission 28 — supervised classification rules.
 *
 * A mapping is created by each human approval, but it is only *applied* once
 * two identical approvals have been recorded (`usage_count >= 2`). The list
 * below exposes the rule, its evidence count and an explicit enable switch so
 * that no single correction silently becomes policy.
 */
export interface DocumentRule {
  id: string;
  kind: 'purchase' | 'sale';
  party_key: string;
  keyword_key: string;
  account_id: string;
  account_code: string | null;
  account_name: string | null;
  usage_count: number;
  last_used_at: string;
  is_active: boolean;
}

export async function listDocumentRules(db: Db, companyId: string): Promise<DocumentRule[]> {
  const res = await db.query<DocumentRule>(
    `SELECT m.id, m.kind, m.party_key, m.keyword_key, m.account_id,
            a.code AS account_code, a.name AS account_name,
            m.usage_count, m.last_used_at::text, m.is_active
       FROM document_mappings m
       LEFT JOIN accounts a ON a.id = m.account_id
      WHERE m.company_id = $1
      ORDER BY m.is_active DESC, m.last_used_at DESC, m.party_key
      LIMIT 500`,
    [companyId],
  );
  return res.rows;
}

export async function updateDocumentRule(
  db: Db,
  companyId: string,
  ruleId: string,
  input: { accountId?: string; isActive?: boolean },
): Promise<DocumentRule> {
  const existing = await db.query<{ kind: 'purchase' | 'sale' }>(
    'SELECT kind FROM document_mappings WHERE id = $1 AND company_id = $2',
    [ruleId, companyId],
  );
  const rule = existing.rows[0];
  if (!rule) throw notFound('DOCUMENT_RULE_NOT_FOUND', 'Classification rule not found');

  if (input.accountId !== undefined) {
    const account = await db.query<{ type: string }>(
      'SELECT type FROM accounts WHERE id = $1 AND company_id = $2 AND is_active = true',
      [input.accountId, companyId],
    );
    const expected = rule.kind === 'purchase' ? 'expense' : 'revenue';
    if (account.rows[0]?.type !== expected) {
      throw badRequest('DOCUMENT_RULE_ACCOUNT_INVALID', `A ${rule.kind} rule requires an active ${expected} account`);
    }
    await db.query(
      'UPDATE document_mappings SET account_id = $3, updated_at = now() WHERE id = $1 AND company_id = $2',
      [ruleId, companyId, input.accountId],
    );
  }
  if (input.isActive !== undefined) {
    await db.query(
      'UPDATE document_mappings SET is_active = $3, updated_at = now() WHERE id = $1 AND company_id = $2',
      [ruleId, companyId, input.isActive],
    );
  }
  const all = await listDocumentRules(db, companyId);
  return all.find((row) => row.id === ruleId)!;
}

/* -------------------------------------------------------------------------- */
/* Mission 42 — explicit OCR document -> supplier invoice conversion          */
/* -------------------------------------------------------------------------- */

export interface OcrPurchaseConversionInput {
  supplierId?: string | null;
  supplierReference?: string | null;
  issueDate?: string | null;
  dueDate?: string | null;
  exchangeRate?: string | number | null;
  vatRecoverable?: boolean;
  confirm: true;
}

/**
 * Converts an APPROVED purchase proposal into a real supplier invoice.
 *
 * The conversion is deliberately a separate human action:
 *  - approval already produced a draft journal entry (never posted);
 *  - this action creates and validates the purchase subledger document;
 *  - posting remains a distinct action through the existing proposal engine.
 *
 * One document import can produce at most one purchase document (database
 * unique index). A second call returns the existing link instead of creating a
 * duplicate.
 */
export async function createPurchaseFromOcr(
  db: Db,
  actor: { userId: string; companyId: string },
  proposalId: string,
  input: OcrPurchaseConversionInput,
): Promise<{
  purchaseDocument: any;
  alreadyCreated: boolean;
  draftEntryId: string | null;
  note: string;
}> {
  const { createPurchaseDocument, validatePurchaseDocumentTx } = await import('../purchases/service.js');
  const result = await db.transaction(async (tx) => {
    const found = await tx.query<any>(
      `SELECT p.*, d.id AS document_import_id, d.purchase_document_id AS existing_purchase_id,
              d.document_type, d.invoice_number, d.invoice_date, d.due_date, d.currency,
              d.total_amount AS document_total, d.vat_total AS document_vat,
              d.subtotal AS document_subtotal, d.party_name, d.original_name, d.status AS document_status
         FROM document_proposals p
         JOIN document_imports d ON d.id = p.document_id
        WHERE p.id = $1 AND p.company_id = $2
        FOR UPDATE`,
      [proposalId, actor.companyId],
    );
    const proposal = found.rows[0];
    if (!proposal) throw notFound('PROPOSAL_NOT_FOUND', 'Proposal not found');
    if (proposal.kind !== 'purchase') {
      throw badRequest('OCR_NOT_PURCHASE', 'Only a purchase document can become a supplier invoice');
    }
    if (proposal.status !== 'APPROVED') {
      throw conflict('OCR_PROPOSAL_NOT_APPROVED', 'Approve the OCR proposal before creating a supplier invoice');
    }
    if (proposal.existing_purchase_id) {
      const existing = await tx.query<any>(
        'SELECT * FROM purchase_documents WHERE id = $1 AND company_id = $2',
        [proposal.existing_purchase_id, actor.companyId],
      );
      return { purchaseDocument: existing.rows[0], alreadyCreated: true, draftEntryId: proposal.draft_entry_id ?? null };
    }
    if (proposal.document_type === 'unknown') {
      throw conflict('OCR_DOCUMENT_TYPE_REQUIRED', 'Correct the document type (invoice or credit note) first');
    }
    if (Array.isArray(proposal.rationale?.multipleInvoices) && proposal.rationale.multipleInvoices.length > 0) {
      // Kept for forward compatibility; the quality guard lives in the route.
    }

    const issueDate = input.issueDate ?? (proposal.invoice_date ? String(proposal.invoice_date).slice(0, 10) : null);
    if (!issueDate) throw conflict('OCR_ISSUE_DATE_REQUIRED', 'Enter the invoice date before creating a supplier invoice');
    const dueDate = input.dueDate ?? (proposal.due_date ? String(proposal.due_date).slice(0, 10) : null) ?? issueDate;
    const currency = String(input.exchangeRate ? proposal.currency : proposal.currency ?? '').toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) throw conflict('OCR_CURRENCY_REQUIRED', 'Choose the document currency first');
    const supplierReference =
      input.supplierReference?.trim() ||
      (proposal.invoice_number ? String(proposal.invoice_number).trim() : '');
    if (!supplierReference) {
      throw conflict('OCR_SUPPLIER_REFERENCE_REQUIRED', 'Enter the supplier invoice number first');
    }

    let supplierId = input.supplierId ?? (proposal.party_id as string | null);
    if (supplierId) {
      const supplier = await tx.query<any>(
        'SELECT id FROM purchase_suppliers WHERE id = $1 AND company_id = $2 AND is_active = true',
        [supplierId, actor.companyId],
      );
      if (!supplier.rows[0]) supplierId = null;
    }
    if (!supplierId && proposal.party_name) {
      const matched = await tx.query<any>(
        `SELECT id FROM purchase_suppliers
          WHERE company_id = $1 AND is_active = true AND lower(btrim(name)) = lower(btrim($2))
          ORDER BY created_at LIMIT 1`,
        [actor.companyId, proposal.party_name],
      );
      supplierId = matched.rows[0]?.id ?? null;
    }
    if (!supplierId) {
      throw conflict(
        'OCR_SUPPLIER_REQUIRED',
        'Choose an active supplier before creating the purchase invoice; no supplier is created automatically',
      );
    }

    const proposalLines: any[] = Array.isArray(proposal.lines) ? proposal.lines : [];
    if (proposalLines.length === 0) throw conflict('OCR_PROPOSAL_EMPTY', 'The approved proposal has no lines');
    const accountIds = [...new Set(proposalLines.map((line) => line.accountId).filter(Boolean))];
    const accounts = await tx.query<any>(
      `SELECT id, account_role, type FROM accounts WHERE company_id = $1 AND id = ANY($2::uuid[])`,
      [actor.companyId, accountIds],
    );
    const accountById = new Map(accounts.rows.map((a) => [a.id, a]));
    const isVat = (line: any) => {
      const account = accountById.get(line.accountId);
      return account?.account_role === 'vat_input' || /vat|tva/i.test(String(line.description ?? ''));
    };
    const isPayable = (line: any) => accountById.get(line.accountId)?.account_role === 'payable';
    const creditNote = proposal.document_type === 'credit_note';
    const tradingLines = proposalLines.filter((line) => {
      if (!line.accountId || isVat(line) || isPayable(line)) return false;
      return creditNote ? parseAmount(line.credit ?? '0') > 0n : parseAmount(line.debit ?? '0') > 0n;
    });
    if (tradingLines.length === 0) {
      throw conflict('OCR_PURCHASE_LINES_REQUIRED', 'The proposal has no expense or asset line to convert');
    }
    const importLines = await tx.query<any>(
      `SELECT * FROM document_import_lines WHERE document_id = $1 ORDER BY line_no`,
      [proposal.document_import_id],
    );
    const vatTotal = parseAmount(proposal.document_vat ?? '0');
    const rates = vatTotal > 0n
      ? (await tx.query<any>(
          `SELECT id, rate::text FROM billing_tax_rates
            WHERE company_id = $1 AND verified = true AND effective_from <= $2
              AND (effective_to IS NULL OR effective_to >= $2)
            ORDER BY effective_from DESC`,
          [actor.companyId, issueDate],
        )).rows
      : [];

    const lines: any[] = [];
    for (const [index, trading] of tradingLines.entries()) {
      const source = importLines.rows[index];
      const net = source
        ? parseAmount(source.net_amount ?? '0')
        : parseAmount(creditNote ? trading.credit ?? '0' : trading.debit ?? '0');
      const tax = source ? parseAmount(source.vat_amount ?? '0') : 0n;
      if (net <= 0n) throw conflict('OCR_PURCHASE_LINES_REQUIRED', 'A purchase line has no positive net amount');
      let vatRateId: string | null = null;
      if (tax > 0n) {
        const match = rates.find((rate: any) => {
          const rateValue = parseAmount(rate.rate);
          const computed = (net * rateValue + 50n * 10n ** 4n) / (100n * 10n ** 4n);
          return computed === tax;
        });
        if (!match) {
          throw conflict(
            'OCR_VAT_RATE_REQUIRED',
            'No verified tax rate exactly reproduces the extracted VAT: correct the line or choose a verified rate',
          );
        }
        vatRateId = match.id;
      }
      const quantity = source?.quantity && parseAmount(source.quantity) > 0n ? source.quantity : '1';
      const unitPrice = source?.unit_price && parseAmount(source.unit_price) >= 0n
        ? source.unit_price
        : formatAmount(net);
      lines.push({
        description: String(source?.description ?? trading.description ?? 'Document line').slice(0, 500),
        quantity,
        unitPrice,
        accountId: trading.accountId,
        vatTreatment: tax > 0n ? 'standard' : 'out_of_scope',
        vatRateId,
        vatRecoverable: tax > 0n ? input.vatRecoverable !== false : null,
      });
    }

    const created = await createPurchaseDocument(tx, actor.companyId, actor.userId, {
      kind: creditNote ? 'credit_note' : 'invoice',
      supplierId,
      supplierReference,
      issueDate,
      dueDate,
      currency,
      exchangeRate: input.exchangeRate ?? null,
      description: `Document OCR — ${proposal.original_name}`.slice(0, 2000),
      lines,
    });
    if (parseAmount(created.total_amount) !== parseAmount(proposal.document_total ?? '0')) {
      throw conflict(
        'OCR_TOTAL_MISMATCH',
        'The converted purchase total does not match the approved document total; no invoice was created',
        { expected: proposal.document_total, converted: created.total_amount },
      );
    }
    const validated = await validatePurchaseDocumentTx(tx, actor.companyId, actor.userId, created.id);
    await tx.query(
      `UPDATE document_imports SET purchase_document_id = $2, updated_at = now()
        WHERE id = $1 AND company_id = $3 AND purchase_document_id IS NULL`,
      [proposal.document_import_id, validated.id, actor.companyId],
    );
    await tx.query(
      `UPDATE document_proposals SET purchase_document_id = $2, updated_at = now()
        WHERE id = $1 AND company_id = $3 AND purchase_document_id IS NULL`,
      [proposalId, validated.id, actor.companyId],
    );
    return {
      purchaseDocument: validated,
      alreadyCreated: false,
      draftEntryId: proposal.draft_entry_id ?? null,
    };
  });
  return {
    ...result,
    note: result.alreadyCreated
      ? 'This document was already converted; no second purchase invoice was created.'
      : 'A supplier invoice was created and validated. The OCR draft entry is still unposted; posting remains a separate human action.',
  };
}
