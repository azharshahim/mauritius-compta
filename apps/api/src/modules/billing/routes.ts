import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../../db/index.js';
import { AppError, badRequest, conflict, notFound } from '../../lib/errors.js';
import { clientIp, parse } from '../../lib/http.js';
import { writeAudit } from '../../lib/audit.js';
import { requireCompany } from '../../lib/tenant.js';
import { cabinetForCompanyUser } from '../../lib/cabinets.js';
import { parseIsoDate } from '../../lib/dates.js';
import { formatAmount, parseAmount } from '../../lib/money.js';
import {
  allocateBillingPayment,
  buildAging,
  cancelBillingPaymentAllocation,
  computeDocument,
  customerBalance,
  formatDocumentNumber,
  loadBillingContext,
  loadCustomer,
  loadDocument,
  logDocumentEvent,
  nextBillingNumber,
  outstandingOf,
  prefixFor,
  refreshInvoiceBalance,
  sequenceYear,
  type CompanyBillingContext,
  type DocumentRow,
  type LineRequest,
  type NumberKind,
  type VatTreatment,
} from './service.js';
import { findDuplicates } from './duplicates.js';
import { proposeBillingAllocationReclass } from '../ai/proposals.js';
import { billingDocumentPdf, paymentReceiptPdf } from './pdf.js';

/**
 * Billing module - operational chain (mission 6).
 *
 *   Customer -> Quote -> Invoice -> Credit note -> Payment -> Accounting
 *
 * Creating or issuing a document never writes a journal entry: posting is a
 * separate, human action on an AI proposal (`/ai/entry-proposals/:id/post`),
 * which goes through the accounting engine.
 *
 * Fiscal discipline:
 *  - no VAT rate is seeded or guessed; `standard` lines need a verified, dated
 *    configuration, while `zero_rated`, `exempt` and `out_of_scope` stay
 *    distinct qualifications;
 *  - MRA e-invoicing is not implemented and is reported as unavailable;
 *  - nothing is physically deleted: drafts are cancelled and every transition
 *    is journaled in `billing_document_events`.
 */

const uuid = z.string().uuid();
const amountInput = z.union([z.string().regex(/^\d{1,15}(\.\d{1,4})?$/), z.number().min(0).max(1e15)]);
const rateInput = z.union([z.string().regex(/^\d{1,6}(\.\d{1,8})?$/), z.number().positive()]);
const dateInput = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const vatTreatmentSchema = z.enum(['standard', 'zero_rated', 'exempt', 'out_of_scope']);

const customerBody = z
  .object({
    name: z.string().trim().min(1).max(200),
    legalName: z.string().trim().max(200).nullable().optional(),
    brn: z.string().trim().max(40).nullable().optional(),
    vatNumber: z.string().trim().max(40).nullable().optional(),
    addressLine1: z.string().trim().max(200).nullable().optional(),
    addressLine2: z.string().trim().max(200).nullable().optional(),
    city: z.string().trim().max(120).nullable().optional(),
    postcode: z.string().trim().max(20).nullable().optional(),
    country: z.string().trim().length(2).optional(),
    contactName: z.string().trim().max(120).nullable().optional(),
    contactEmail: z.string().trim().email().max(200).nullable().optional(),
    contactPhone: z.string().trim().max(40).nullable().optional(),
    preferredCurrency: z.string().length(3).toUpperCase().nullable().optional(),
    paymentTermsDays: z.number().int().min(0).max(365).nullable().optional(),
    receivableAccountId: uuid.nullable().optional(),
    notes: z.string().trim().max(1000).nullable().optional(),
    isActive: z.boolean().optional(),
    /** Explicit confirmation of a legitimate homonym (never a silent bypass). */
    confirmDuplicate: z.boolean().optional(),
  })
  .strict();

const itemBody = z
  .object({
    reference: z.string().trim().min(1).max(60),
    labelFr: z.string().trim().min(1).max(200),
    labelEn: z.string().trim().max(200).nullable().optional(),
    description: z.string().trim().max(1000).nullable().optional(),
    unitPrice: amountInput,
    currency: z.string().length(3).toUpperCase().optional(),
    unit: z.string().trim().max(20).optional(),
    category: z.string().trim().max(60).nullable().optional(),
    vatTreatment: vatTreatmentSchema.optional(),
    vatRateId: uuid.nullable().optional(),
    revenueAccountId: uuid.nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .strict();

const taxRateBody = z
  .object({
    code: z.string().trim().min(1).max(30),
    label: z.string().trim().min(1).max(120),
    rate: z.union([z.string().regex(/^\d{1,3}(\.\d{1,4})?$/), z.number().min(0).max(100)]),
    effectiveFrom: dateInput,
    effectiveTo: dateInput.nullable().optional(),
    verified: z.boolean().optional(),
    source: z.string().trim().max(200).nullable().optional(),
    notes: z.string().trim().max(500).nullable().optional(),
    // Mission 7: the four fiscal treatments are distinct and never assimilated.
    treatment: z.enum(['taxable', 'zero_rated', 'exempt', 'out_of_scope']).optional(),
    vatAccountId: z.string().uuid().nullable().optional(),
  })
  .strict();

const verifyBody = z
  .object({
    source: z.string().trim().min(5).max(200),
    note: z.string().trim().max(500).optional(),
    confirm: z.literal(true),
  })
  .strict();

const settingsBody = z
  .object({
    quotePrefix: z.string().trim().min(1).max(10).optional(),
    invoicePrefix: z.string().trim().min(1).max(10).optional(),
    creditPrefix: z.string().trim().min(1).max(10).optional(),
    numberingPolicy: z.enum(['yearly', 'continuous']).optional(),
    defaultPaymentTerms: z.number().int().min(0).max(365).optional(),
    defaultCurrency: z.string().length(3).toUpperCase().optional(),
    vatEnabled: z.boolean().optional(),
    vatNumber: z.string().trim().max(40).nullable().optional(),
    legalFooterFr: z.string().trim().max(600).nullable().optional(),
    legalFooterEn: z.string().trim().max(600).nullable().optional(),
    bankDetails: z.string().trim().max(600).nullable().optional(),
  })
  .strict();

const lineBody = z
  .object({
    itemId: uuid.nullable().optional(),
    description: z.string().trim().max(300).nullable().optional(),
    quantity: amountInput,
    unitPrice: amountInput.optional(),
    unit: z.string().trim().max(20).nullable().optional(),
    discountPct: amountInput.optional(),
    vatTreatment: vatTreatmentSchema.nullable().optional(),
    vatRateId: uuid.nullable().optional(),
    revenueAccountId: uuid.nullable().optional(),
  })
  .strict();

const documentBody = z
  .object({
    kind: z.enum(['quote', 'invoice', 'credit_note']),
    customerId: uuid,
    issueDate: dateInput,
    dueDate: dateInput.nullable().optional(),
    validUntil: dateInput.nullable().optional(),
    currency: z.string().length(3).toUpperCase().optional(),
    exchangeRate: rateInput.nullable().optional(),
    notes: z.string().trim().max(2000).nullable().optional(),
    terms: z.string().trim().max(2000).nullable().optional(),
    sourceDocumentId: uuid.nullable().optional(),
    lines: z.array(lineBody).min(1).max(200).optional(),
    confirmDuplicate: z.boolean().optional(),
  })
  .strict();

const patchDocumentBody = z
  .object({
    customerId: uuid.optional(),
    issueDate: dateInput.optional(),
    dueDate: dateInput.nullable().optional(),
    validUntil: dateInput.nullable().optional(),
    currency: z.string().length(3).toUpperCase().optional(),
    exchangeRate: rateInput.nullable().optional(),
    notes: z.string().trim().max(2000).nullable().optional(),
    terms: z.string().trim().max(2000).nullable().optional(),
    lines: z.array(lineBody).min(1).max(200).optional(),
  })
  .strict();

const paymentBody = z
  .object({
    customerId: uuid,
    paymentDate: dateInput,
    valueDate: dateInput.nullable().optional(),
    amount: amountInput,
    currency: z.string().length(3).toUpperCase().optional(),
    exchangeRate: rateInput.nullable().optional(),
    method: z.enum(['bank_transfer', 'cheque', 'cash', 'card', 'other']).optional(),
    reference: z.string().trim().max(100).nullable().optional(),
    allocations: z
      .array(z.object({ invoiceId: uuid, amount: amountInput }).strict())
      .max(50)
      .optional(),
    confirmDuplicate: z.boolean().optional(),
  })
  .strict();

const duplicateBody = z
  .object({
    kind: z.enum(['quote', 'invoice', 'credit_note']),
    customerId: uuid.nullable().optional(),
    customerName: z.string().trim().max(200).optional(),
    docNo: z.string().trim().max(60).nullable().optional(),
    issueDate: dateInput,
    totalAmount: amountInput,
    currency: z.string().length(3).toUpperCase(),
    sourceDocumentId: uuid.nullable().optional(),
    excludeDocumentId: uuid.nullable().optional(),
  })
  .strict();

function decimal(value: string | number | null | undefined, fallback = '0'): string {
  if (value === undefined || value === null) return fallback;
  const raw = typeof value === 'number' ? value.toFixed(4) : value;
  return formatAmount(parseAmount(raw));
}

function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function nullable(value: unknown): string | null {
  const text = typeof value === 'string' ? value.trim() : '';
  return text ? text : null;
}

function customerView(row: any) {
  return {
    id: row.id,
    name: row.name,
    legalName: row.legal_name,
    brn: row.brn,
    vatNumber: row.vat_number,
    addressLine1: row.address_line1,
    addressLine2: row.address_line2,
    city: row.city,
    postcode: row.postcode,
    country: row.country,
    contactName: row.contact_name,
    contactEmail: row.contact_email,
    contactPhone: row.contact_phone,
    preferredCurrency: row.preferred_currency,
    paymentTermsDays: row.payment_terms_days,
    receivableAccountId: row.receivable_account_id,
    notes: row.notes,
    isActive: row.is_active,
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function itemView(row: any) {
  return {
    id: row.id,
    reference: row.reference,
    labelFr: row.label_fr,
    labelEn: row.label_en,
    description: row.description,
    unitPrice: row.unit_price,
    currency: row.currency,
    unit: row.unit,
    category: row.category,
    vatTreatment: row.vat_treatment,
    vatRateId: row.vat_rate_id,
    revenueAccountId: row.revenue_account_id,
    isActive: row.is_active,
    createdAt: row.created_at,
  };
}

function documentView(row: DocumentRow, lines: any[] = []) {
  return {
    id: row.id,
    kind: row.kind,
    number: row.doc_no,
    status: row.status,
    paymentStatus: row.payment_status,
    customerId: row.customer_id,
    customerName: row.customer_name,
    customerBrn: row.customer_brn,
    issueDate: row.issue_date,
    dueDate: row.due_date,
    validUntil: row.valid_until,
    currency: row.currency,
    exchangeRate: row.exchange_rate,
    subtotal: row.subtotal,
    discountTotal: row.discount_total,
    taxTotal: row.tax_total,
    total: row.total_amount,
    amountPaid: row.amount_paid,
    creditedAmount: row.credited_amount,
    outstanding: formatAmount(outstandingOf(row)),
    sourceKind: row.source_kind,
    sourceDocumentId: row.source_document_id,
    notes: row.notes,
    terms: row.terms,
    issuedAt: row.issued_at,
    sentAt: row.sent_at,
    acceptedAt: row.accepted_at,
    refusedAt: row.refused_at,
    cancelledAt: row.cancelled_at,
    lockedAt: row.locked_at,
    accountingEntryId: row.accounting_entry_id,
    sequence: row.sequence_no === null ? null : { year: row.sequence_year, no: row.sequence_no },
    lines: lines.map((l) => ({
      id: l.id,
      lineNo: l.line_no,
      itemId: l.item_id,
      description: l.description,
      quantity: l.quantity,
      unitPrice: l.unit_price,
      unit: l.unit,
      discountPct: l.discount_pct,
      vatTreatment: l.vat_treatment,
      vatRate: l.vat_rate,
      vatRateId: l.vat_rate_id,
      netAmount: l.net_amount,
      discountAmount: l.discount_amount,
      taxAmount: l.tax_amount,
      lineTotal: l.line_total,
      revenueAccountId: l.revenue_account_id,
    })),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function paymentView(row: any, allocations: any[] = []) {
  return {
    id: row.id,
    number: row.payment_no,
    customerId: row.customer_id,
    paymentDate: row.payment_date,
    valueDate: row.value_date,
    amount: row.amount,
    currency: row.currency,
    exchangeRate: row.exchange_rate,
    method: row.method,
    reference: row.reference,
    unallocatedAmount: row.unallocated_amount,
    status: row.status,
    accountingEntryId: row.accounting_entry_id,
    allocations: allocations.map((a) => ({
      id: a.id,
      invoiceId: a.invoice_id,
      amount: a.amount,
      invoiceNumber: a.doc_no ?? null,
      customerName: a.customer_name ?? null,
    })),
    createdAt: row.created_at,
  };
}

function lineRequestsFromRows(rows: any[]): LineRequest[] {
  return rows.map((row) => ({
    itemId: row.item_id,
    description: row.description,
    quantity: row.quantity,
    unitPrice: row.unit_price,
    unit: row.unit,
    discountPct: row.discount_pct,
    vatTreatment: row.vat_treatment as VatTreatment,
    vatRateId: row.vat_rate_id,
    revenueAccountId: row.revenue_account_id,
  }));
}

async function insertLines(
  tx: Db,
  companyId: string,
  documentId: string,
  lines: ReturnType<typeof computeDocument>['lines'],
): Promise<void> {
  for (const line of lines) {
    await tx.query(
      `INSERT INTO billing_document_lines
         (document_id, company_id, line_no, item_id, description, quantity, unit_price, unit,
          discount_pct, vat_treatment, vat_rate, vat_rate_id, net_amount, discount_amount,
          tax_amount, line_total, revenue_account_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
      [
        documentId,
        companyId,
        line.lineNo,
        line.itemId,
        line.description,
        formatAmount(line.quantity),
        formatAmount(line.unitPrice),
        line.unit,
        formatAmount(line.discountPct),
        line.vatTreatment,
        line.vatRate === null ? null : formatAmount(line.vatRate),
        line.vatRateId,
        formatAmount(line.netAmount),
        formatAmount(line.discountAmount),
        formatAmount(line.taxAmount),
        formatAmount(line.lineTotal),
        line.revenueAccountId,
      ],
    );
  }
}

async function assertAccountInCompany(tx: Db, companyId: string, accountId: string, field: string) {
  const res = await tx.query('SELECT 1 FROM accounts WHERE id = $1 AND company_id = $2', [
    accountId,
    companyId,
  ]);
  if (res.rowCount === 0) {
    throw badRequest('VALIDATION_ERROR', `${field} does not belong to this company`, [
      { path: field, message: 'Unknown account' },
    ]);
  }
}

async function functionalCurrency(tx: Db, companyId: string): Promise<string> {
  const res = await tx.query<{ functional_currency: string }>(
    'SELECT functional_currency FROM companies WHERE id = $1',
    [companyId],
  );
  return res.rows[0]?.functional_currency ?? 'MUR';
}

interface CreateParams {
  companyId: string;
  userId: string;
  ip: string | null;
  body: z.infer<typeof documentBody>;
}

async function createDocumentTx(
  tx: Db,
  params: CreateParams,
): Promise<{ document: DocumentRow; lines: any[]; duplicates: Awaited<ReturnType<typeof findDuplicates>>; warnings: string[] }> {
  const { companyId, body, userId } = params;
  const ctx = await loadBillingContext(tx, companyId);
  const customer = await loadCustomer(tx, companyId, body.customerId);
  if (!customer.is_active) throw conflict('DOCUMENT_STATUS_INVALID', 'This customer is archived');
  const functional = await functionalCurrency(tx, companyId);

  const issueDate = parseIsoDate(body.issueDate, 'issueDate');

  let source: DocumentRow | null = null;
  let sourceLines: any[] = [];
  if (body.sourceDocumentId) {
    const loaded = await loadDocument(tx, companyId, body.sourceDocumentId);
    source = loaded.document;
    sourceLines = loaded.lines;

    if (body.kind === 'invoice') {
      if (source.kind !== 'quote') throw badRequest('VALIDATION_ERROR', 'An invoice can only be created from a quote');
      if (['refused', 'expired', 'cancelled'].includes(source.status)) {
        throw conflict('DOCUMENT_STATUS_INVALID', `Quote ${source.doc_no ?? ''} is ${source.status}`);
      }
      const already = await tx.query(
        `SELECT 1 FROM billing_documents
          WHERE company_id = $1 AND kind = 'invoice' AND source_document_id = $2
            AND status <> 'cancelled' LIMIT 1`,
        [companyId, source.id],
      );
      if (already.rowCount > 0) {
        throw conflict('QUOTE_ALREADY_CONVERTED', 'This quote has already been converted into an invoice');
      }
    } else if (body.kind === 'credit_note') {
      if (source.kind !== 'invoice') {
        throw badRequest('VALIDATION_ERROR', 'A credit note must reference an invoice');
      }
      if (!['issued', 'partially_paid', 'paid'].includes(source.status)) {
        throw conflict('DOCUMENT_NOT_ISSUED', 'Only an issued invoice can be credited');
      }
      if (source.customer_id && source.customer_id !== customer.id) {
        throw badRequest('VALIDATION_ERROR', 'The credit note customer must be the invoice customer');
      }
    } else {
      throw badRequest('VALIDATION_ERROR', 'A quote cannot be created from another document');
    }
  } else if (body.kind === 'credit_note') {
    throw badRequest(
      'VALIDATION_ERROR',
      'A credit note must reference its original invoice (sourceDocumentId is required)',
    );
  }

  const currency = (body.currency ?? source?.currency ?? customer.preferred_currency ?? ctx.settings.default_currency ?? functional).toUpperCase();
  if (source && currency !== source.currency) {
    throw badRequest('CURRENCY_MISMATCH', 'The document currency must match its source document');
  }
  let exchangeRate = body.exchangeRate === undefined || body.exchangeRate === null ? null : decimal(body.exchangeRate);
  if (currency !== functional) {
    if (!exchangeRate) {
      if (source && source.currency === currency) exchangeRate = source.exchange_rate;
    }
    if (!exchangeRate) {
      throw badRequest(
        'EXCHANGE_RATE_REQUIRED',
        `An exchange rate is required for a document in ${currency} (functional currency: ${functional})`,
      );
    }
  } else {
    exchangeRate = exchangeRate ?? '1';
  }

  const rawLines = body.lines ?? (sourceLines.length > 0 ? lineRequestsFromRows(sourceLines) : []);
  if (rawLines.length === 0) {
    throw badRequest('VALIDATION_ERROR', 'A document needs at least one line');
  }

  const computation = computeDocument(rawLines, {
    companyId,
    issueDate,
    currency,
    vatEnabled: ctx.settings.vat_enabled,
    taxRates: ctx.taxRates,
    items: ctx.items,
    defaultRevenueAccountId: ctx.defaultRevenueAccountId,
  });

  if (body.kind === 'credit_note' && source) {
    const alreadyCredited = parseAmount(source.credited_amount);
    if (alreadyCredited + computation.total > parseAmount(source.total_amount)) {
      throw new AppError(
        'CREDIT_EXCEEDS_INVOICE',
        409,
        'The credit note would exceed the total amount of the original invoice',
        {
          invoiceTotal: source.total_amount,
          alreadyCredited: formatAmount(alreadyCredited),
          requested: formatAmount(computation.total),
        },
      );
    }
    // Per-line check on quantities already credited for the same item.
    for (const line of computation.lines) {
      if (!line.itemId) continue;
      const credited = await tx.query<{ qty: string }>(
        `SELECT COALESCE(SUM(l.quantity), 0) AS qty
           FROM billing_document_lines l
           JOIN billing_documents d ON d.id = l.document_id
          WHERE d.company_id = $1 AND d.kind = 'credit_note' AND d.source_document_id = $2
            AND d.status = 'issued' AND l.item_id = $3`,
        [companyId, source.id, line.itemId],
      );
      const invoiced = sourceLines
        .filter((l) => l.item_id === line.itemId)
        .reduce((acc, l) => acc + parseAmount(l.quantity), 0n);
      if (invoiced > 0n && parseAmount(credited.rows[0]?.qty ?? '0') + line.quantity > invoiced) {
        throw new AppError('CREDIT_EXCEEDS_INVOICE', 409, 'The credited quantity exceeds the invoiced quantity', {
          itemId: line.itemId,
          invoiced: formatAmount(invoiced),
          alreadyCredited: credited.rows[0]?.qty ?? '0',
        });
      }
    }
  }

  const duplicates = await findDuplicates(tx, companyId, {
    kind: body.kind,
    customerId: customer.id,
    customerName: customer.name,
    docNo: null,
    issueDate,
    totalAmount: formatAmount(computation.total),
    currency,
    sourceDocumentId: source?.id ?? null,
  });
  if (!body.confirmDuplicate && duplicates.level === 'certain') {
    throw new AppError('CUSTOMER_DUPLICATE', 409, 'A certain duplicate exists: confirm explicitly to continue', {
      duplicates,
    });
  }

  const dueDate =
    body.kind === 'invoice'
      ? (body.dueDate ? parseIsoDate(body.dueDate, 'dueDate') : addDays(issueDate, customer.payment_terms_days ?? ctx.settings.default_payment_terms))
      : body.dueDate
        ? parseIsoDate(body.dueDate, 'dueDate')
        : null;

  const snapshot = JSON.stringify({
    name: customer.name,
    legalName: customer.legal_name,
    brn: customer.brn,
    vatNumber: customer.vat_number,
    addressLine1: customer.address_line1,
    addressLine2: customer.address_line2,
    city: customer.city,
    postcode: customer.postcode,
    country: customer.country,
    contactEmail: customer.contact_email,
  });

  const inserted = await tx.query<DocumentRow>(
    `INSERT INTO billing_documents
       (company_id, kind, doc_no, customer_id, customer_name, customer_brn, issue_date, due_date,
        currency, exchange_rate, total_amount, subtotal, discount_total, tax_total, status,
        source_kind, source_document_id, valid_until, notes, terms, customer_snapshot,
        created_by, updated_by)
     VALUES ($1,$2,NULL,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'draft',$14,$15,$16,$17,$18,$19::jsonb,$20,$20)
     RETURNING *`,
    [
      companyId,
      body.kind,
      customer.id,
      customer.name,
      customer.brn ?? null,
      issueDate,
      dueDate,
      currency,
      exchangeRate ?? '1',
      formatAmount(computation.total),
      formatAmount(computation.subtotal),
      formatAmount(computation.discountTotal),
      formatAmount(computation.taxTotal),
      source ? source.kind : null,
      source?.id ?? null,
      body.validUntil ? parseIsoDate(body.validUntil, 'validUntil') : null,
      nullable(body.notes),
      nullable(body.terms),
      snapshot,
      userId,
    ],
  );
  const document = inserted.rows[0]!;
  await insertLines(tx, companyId, document.id, computation.lines);

  await logDocumentEvent(tx, {
    companyId,
    documentId: document.id,
    action: 'created',
    userId,
    details: {
      kind: body.kind,
      total: formatAmount(computation.total),
      currency,
      sourceDocumentId: source?.id ?? null,
      duplicateLevel: duplicates.level,
    },
  });
  await writeAudit(tx, {
    companyId,
    userId,
    action: 'billing.document.create',
    entityType: 'billing_document',
    entityId: document.id,
    details: { kind: body.kind, total: formatAmount(computation.total), currency },
    ip: params.ip,
  });

  const lines = await tx.query('SELECT * FROM billing_document_lines WHERE document_id = $1 ORDER BY line_no', [
    document.id,
  ]);
  return { document, lines: lines.rows, duplicates, warnings: computation.warnings };
}

/**
 * Append-only VAT configuration history (mission 7). Every creation, update and
 * verification is recorded with the actor and the before/after state, so a rate
 * can never be changed silently.
 */
async function logRateEvent(
  db: Db,
  companyId: string,
  taxRateId: string,
  action: 'created' | 'updated' | 'verified' | 'unverified' | 'archived',
  actorId: string,
  before: unknown,
  after: unknown,
): Promise<void> {
  const pick = (row: any) =>
    row
      ? {
          code: row.code,
          label: row.label,
          rate: row.rate,
          treatment: row.treatment,
          effectiveFrom: row.effective_from,
          effectiveTo: row.effective_to,
          verified: row.verified,
          source: row.source,
          vatAccountId: row.vat_account_id,
        }
      : null;
  await db.query(
    `INSERT INTO billing_tax_rate_events
       (company_id, tax_rate_id, action, actor_id, before_state, after_state)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb)`,
    [companyId, taxRateId, action, actorId, JSON.stringify(pick(before)), JSON.stringify(pick(after))],
  );
}

/** Camel-cased view of a VAT rate, with the raw row kept for compatibility. */
function rateView(row: any) {
  if (!row) return row;
  return {
    ...row,
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to ?? null,
    verifiedAt: row.verified_at ?? null,
    verifiedBy: row.verified_by ?? null,
    vatAccountId: row.vat_account_id ?? null,
  };
}

export function billingRoutes(app: FastifyInstance, db: Db): void {
  // -------------------------------------------------------------------------
  // Settings
  // -------------------------------------------------------------------------
  app.get('/companies/:companyId/billing/settings', async (req) => {
    const user = req.user!;
    const { companyId } = req.params as { companyId: string };
    await requireCompany(db, user.id, companyId, 'viewer', 'billing');
    const ctx = await loadBillingContext(db, companyId);
    return {
      settings: {
        quotePrefix: ctx.settings.quote_prefix,
        invoicePrefix: ctx.settings.invoice_prefix,
        creditPrefix: ctx.settings.credit_prefix,
        numberingPolicy: ctx.settings.numbering_policy,
        defaultPaymentTerms: ctx.settings.default_payment_terms,
        defaultCurrency: ctx.settings.default_currency,
        vatEnabled: ctx.settings.vat_enabled,
        vatNumber: ctx.settings.vat_number,
        legalFooterFr: ctx.settings.legal_footer_fr,
        legalFooterEn: ctx.settings.legal_footer_en,
        bankDetails: ctx.settings.bank_details,
      },
      capabilities: {
        numbering: true,
        sequentialNumbering: true,
        vatComputation: ctx.settings.vat_enabled,
        vatRatesConfigured: [...ctx.taxRates.values()].filter((r) => r.verified).length,
        mraEInvoicing: false,
        eInvoicingNotice: 'MRA e-invoicing is not implemented and cannot be enabled in this build.',
        postingToAccounting: true,
        postingMode: 'human_validation_required',
        pdf: true,
        multiCurrency: true,
        duplicateDetection: 'deterministic',
      },
    };
  });

  app.patch('/companies/:companyId/billing/settings', async (req) => {
    const user = req.user!;
    const { companyId } = req.params as { companyId: string };
    await requireCompany(db, user.id, companyId, 'admin', 'billing');
    const body = parse(settingsBody, req.body);
    await loadBillingContext(db, companyId);
    await db.query(
      `UPDATE billing_settings SET
         quote_prefix = COALESCE($2, quote_prefix),
         invoice_prefix = COALESCE($3, invoice_prefix),
         credit_prefix = COALESCE($4, credit_prefix),
         numbering_policy = COALESCE($5, numbering_policy),
         default_payment_terms = COALESCE($6, default_payment_terms),
         default_currency = COALESCE($7, default_currency),
         vat_enabled = COALESCE($8, vat_enabled),
         vat_number = $9,
         legal_footer_fr = $10,
         legal_footer_en = $11,
         bank_details = $12,
         updated_by = $13,
         updated_at = now()
       WHERE company_id = $1`,
      [
        companyId,
        body.quotePrefix ?? null,
        body.invoicePrefix ?? null,
        body.creditPrefix ?? null,
        body.numberingPolicy ?? null,
        body.defaultPaymentTerms ?? null,
        body.defaultCurrency ?? null,
        body.vatEnabled === undefined ? null : body.vatEnabled,
        body.vatNumber === undefined ? undefined : nullable(body.vatNumber),
        body.legalFooterFr === undefined ? undefined : nullable(body.legalFooterFr),
        body.legalFooterEn === undefined ? undefined : nullable(body.legalFooterEn),
        body.bankDetails === undefined ? undefined : nullable(body.bankDetails),
        user.id,
      ],
    );
    await writeAudit(db, {
      companyId,
      userId: user.id,
      action: 'billing.settings.update',
      entityType: 'billing_settings',
      entityId: companyId,
      details: { fields: Object.keys(body) },
      ip: clientIp(req),
    });
    const ctx = await loadBillingContext(db, companyId);
    return { settings: ctx.settings };
  });

  // -------------------------------------------------------------------------
  // VAT configuration (no rate is ever seeded)
  // -------------------------------------------------------------------------
  app.get('/companies/:companyId/billing/tax-rates', async (req) => {
    const user = req.user!;
    const { companyId } = req.params as { companyId: string };
    await requireCompany(db, user.id, companyId, 'viewer', 'billing');
    const res = await db.query(
      'SELECT * FROM billing_tax_rates WHERE company_id = $1 ORDER BY effective_from DESC, code',
      [companyId],
    );
    return {
      rates: res.rows.map((r: any) => ({
        id: r.id,
        code: r.code,
        label: r.label,
        rate: r.rate,
        effectiveFrom: r.effective_from,
        effectiveTo: r.effective_to,
        verified: r.verified,
        verifiedAt: r.verified_at,
        verifiedBy: r.verified_by,
        source: r.source,
        notes: r.notes,
        treatment: r.treatment,
        vatAccountId: r.vat_account_id,
        historyUrl: `/api/companies/${companyId}/billing/tax-rates/${r.id}/history`,
      })),
      notice:
        'No rate is pre-filled. A rate must be entered by the cabinet, sourced and verified by a professional before any computation.',
    };
  });

  app.post('/companies/:companyId/billing/tax-rates', async (req, reply) => {
    const user = req.user!;
    const { companyId } = req.params as { companyId: string };
    await requireCompany(db, user.id, companyId, 'admin', 'billing');
    const body = parse(taxRateBody, req.body);
    const rate = decimal(body.rate);
    if (parseAmount(rate) > parseAmount('100')) {
      throw badRequest('VALIDATION_ERROR', 'A VAT rate cannot exceed 100%');
    }
    const treatment = body.treatment ?? 'taxable';
    if (treatment !== 'taxable' && parseAmount(rate) !== 0n) {
      throw badRequest(
        'VALIDATION_ERROR',
        'A zero-rated, exempt or out-of-scope treatment carries no percentage',
      );
    }
    // A "verified" flag is never self-granted: it requires a documented source
    // and the explicit confirmation of an administrator. The assistant can
    // never call this route.
    if (body.verified === true && !nullable(body.source)) {
      throw badRequest(
        'VAT_SOURCE_REQUIRED',
        'A verified VAT rate requires a documented source',
      );
    }
    if (body.vatAccountId) {
      const account = await db.query('SELECT 1 FROM accounts WHERE id = $1 AND company_id = $2', [
        body.vatAccountId,
        companyId,
      ]);
      if (account.rowCount === 0) {
        throw badRequest('SETTINGS_ACCOUNT_NOT_IN_CHART', 'VAT account not in this chart of accounts');
      }
    }
    const inserted = await db.query(
      `INSERT INTO billing_tax_rates
         (company_id, code, label, rate, effective_from, effective_to, verified, source, notes,
          created_by, treatment, vat_account_id, verified_at, verified_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       RETURNING *`,
      [
        companyId,
        body.code,
        body.label,
        rate,
        parseIsoDate(body.effectiveFrom, 'effectiveFrom'),
        body.effectiveTo ? parseIsoDate(body.effectiveTo, 'effectiveTo') : null,
        body.verified ?? false,
        nullable(body.source),
        nullable(body.notes),
        user.id,
        treatment,
        body.vatAccountId ?? null,
        body.verified === true ? new Date().toISOString() : null,
        body.verified === true ? user.id : null,
      ],
    );
    await logRateEvent(db, companyId, (inserted.rows[0] as any).id, 'created', user.id, null, inserted.rows[0]);
    await writeAudit(db, {
      companyId,
      userId: user.id,
      action: 'billing.tax_rate.create',
      entityType: 'billing_tax_rate',
      entityId: (inserted.rows[0] as any).id,
      details: { code: body.code, verified: body.verified ?? false },
      ip: clientIp(req),
    });
    return reply.code(201).send({ rate: rateView(inserted.rows[0]) });
  });

  app.patch('/companies/:companyId/billing/tax-rates/:rateId', async (req) => {
    const user = req.user!;
    const { companyId, rateId } = req.params as { companyId: string; rateId: string };
    await requireCompany(db, user.id, companyId, 'admin', 'billing');
    const body = parse(taxRateBody.partial(), req.body);

    const current = (
      await db.query('SELECT * FROM billing_tax_rates WHERE id = $1 AND company_id = $2', [
        rateId,
        companyId,
      ])
    ).rows[0];
    if (!current) throw notFound('VAT_RATE_NOT_FOUND', 'VAT rate not found');

    // Once an issued document carries this rate, its percentage, treatment and
    // period are frozen: issued documents are never rewritten retroactively.
    const used = await db.query(
      `SELECT 1 FROM billing_document_lines l
         JOIN billing_documents d ON d.id = l.document_id
        WHERE l.company_id = $1 AND l.vat_rate_id = $2 AND d.status <> 'draft'
        LIMIT 1`,
      [companyId, rateId],
    );
    if (
      used.rowCount &&
      used.rowCount > 0 &&
      (body.rate !== undefined ||
        body.treatment !== undefined ||
        body.effectiveFrom !== undefined ||
        body.effectiveTo !== undefined)
    ) {
      throw conflict(
        'VAT_RATE_LOCKED',
        'This VAT rate is already used by an issued document: its percentage, treatment and period are frozen',
      );
    }

    const treatment = body.treatment ?? (current as any).treatment;
    const nextRate = body.rate === undefined ? (current as any).rate : decimal(body.rate);
    if (treatment !== 'taxable' && parseAmount(nextRate) !== 0n) {
      throw badRequest(
        'VALIDATION_ERROR',
        'A zero-rated, exempt or out-of-scope treatment carries no percentage',
      );
    }
    if (body.verified === true && !nullable(body.source ?? current.source)) {
      throw badRequest('VAT_SOURCE_REQUIRED', 'A verified VAT rate requires a documented source');
    }
    if (body.vatAccountId) {
      const account = await db.query('SELECT 1 FROM accounts WHERE id = $1 AND company_id = $2', [
        body.vatAccountId,
        companyId,
      ]);
      if (account.rowCount === 0) {
        throw badRequest('SETTINGS_ACCOUNT_NOT_IN_CHART', 'VAT account not in this chart of accounts');
      }
    }

    const updated = await db.query(
      `UPDATE billing_tax_rates SET
         code = COALESCE($3, code),
         label = COALESCE($4, label),
         rate = COALESCE($5, rate),
         effective_from = COALESCE($6, effective_from),
         effective_to = $7,
         verified = COALESCE($8, verified),
         source = $9,
         notes = $10,
         treatment = COALESCE($11, treatment),
         vat_account_id = $12,
         verified_at = CASE
           WHEN $13::boolean IS TRUE AND verified IS NOT TRUE THEN now()
           WHEN $13::boolean IS FALSE THEN NULL
           ELSE verified_at END,
         verified_by = CASE
           WHEN $13::boolean IS TRUE AND verified IS NOT TRUE THEN $14::uuid
           WHEN $13::boolean IS FALSE THEN NULL
           ELSE verified_by END
       WHERE id = $1 AND company_id = $2
       RETURNING *`,
      [
        rateId,
        companyId,
        body.code ?? null,
        body.label ?? null,
        body.rate === undefined ? null : decimal(body.rate),
        body.effectiveFrom ? parseIsoDate(body.effectiveFrom, 'effectiveFrom') : null,
        body.effectiveTo === undefined ? undefined : body.effectiveTo ? parseIsoDate(body.effectiveTo, 'effectiveTo') : null,
        body.verified ?? null,
        body.source === undefined ? undefined : nullable(body.source),
        body.notes === undefined ? undefined : nullable(body.notes),
        body.treatment ?? null,
        body.vatAccountId === undefined ? undefined : body.vatAccountId,
        body.verified === undefined ? null : body.verified,
        user.id,
      ],
    );
    if (updated.rowCount === 0) throw notFound('VAT_RATE_NOT_FOUND', 'VAT rate not found');

    await logRateEvent(
      db,
      companyId,
      rateId,
      body.verified === true ? 'verified' : body.verified === false ? 'unverified' : 'updated',
      user.id,
      current,
      updated.rows[0],
    );
    return { rate: rateView(updated.rows[0]) };
  });

  // Explicit human verification: documented source + confirmation. This route
  // is never called by the assistant.
  app.post('/companies/:companyId/billing/tax-rates/:rateId/verify', async (req) => {
    const user = req.user!;
    const { companyId, rateId } = req.params as { companyId: string; rateId: string };
    await requireCompany(db, user.id, companyId, 'admin', 'billing');
    const body = parse(verifyBody, req.body);
    const current = (
      await db.query('SELECT * FROM billing_tax_rates WHERE id = $1 AND company_id = $2', [
        rateId,
        companyId,
      ])
    ).rows[0];
    if (!current) throw notFound('VAT_RATE_NOT_FOUND', 'VAT rate not found');
    if (body.note) {
      await db.query(
        'UPDATE billing_tax_rates SET notes = COALESCE($3, notes) WHERE id = $1 AND company_id = $2',
        [rateId, companyId, body.note],
      );
    }
    const updated = await db.query(
      `UPDATE billing_tax_rates
          SET verified = true, verified_at = now(), verified_by = $3, source = $4
        WHERE id = $1 AND company_id = $2
        RETURNING *`,
      [rateId, companyId, user.id, body.source],
    );
    await logRateEvent(db, companyId, rateId, 'verified', user.id, current, updated.rows[0]);
    await writeAudit(db, {
      companyId,
      userId: user.id,
      action: 'billing.tax_rate.verify',
      entityType: 'billing_tax_rate',
      entityId: rateId,
      details: { source: body.source, confirm: true },
      ip: clientIp(req),
    });
    return { rate: rateView(updated.rows[0]) };
  });

  app.post('/companies/:companyId/billing/tax-rates/:rateId/unverify', async (req) => {
    const user = req.user!;
    const { companyId, rateId } = req.params as { companyId: string; rateId: string };
    await requireCompany(db, user.id, companyId, 'admin', 'billing');
    const current = (
      await db.query('SELECT * FROM billing_tax_rates WHERE id = $1 AND company_id = $2', [
        rateId,
        companyId,
      ])
    ).rows[0];
    if (!current) throw notFound('VAT_RATE_NOT_FOUND', 'VAT rate not found');
    const updated = await db.query(
      `UPDATE billing_tax_rates
          SET verified = false, verified_at = NULL, verified_by = NULL
        WHERE id = $1 AND company_id = $2 RETURNING *`,
      [rateId, companyId],
    );
    await logRateEvent(db, companyId, rateId, 'unverified', user.id, current, updated.rows[0]);
    await writeAudit(db, {
      companyId,
      userId: user.id,
      action: 'billing.tax_rate.unverify',
      entityType: 'billing_tax_rate',
      entityId: rateId,
      ip: clientIp(req),
    });
    return { rate: rateView(updated.rows[0]) };
  });

  app.get('/companies/:companyId/billing/tax-rates/:rateId/history', async (req) => {
    const user = req.user!;
    const { companyId, rateId } = req.params as { companyId: string; rateId: string };
    await requireCompany(db, user.id, companyId, 'viewer', 'billing');
    const res = await db.query(
      `SELECT id, action, actor_id, before_state, after_state, created_at
         FROM billing_tax_rate_events
        WHERE company_id = $1 AND tax_rate_id = $2
        ORDER BY created_at DESC LIMIT 100`,
      [companyId, rateId],
    );
    return {
      events: res.rows.map((r: any) => ({
        id: r.id,
        action: r.action,
        actorId: r.actor_id,
        before: r.before_state,
        after: r.after_state,
        createdAt: r.created_at,
      })),
    };
  });

  // -------------------------------------------------------------------------
  // Customers
  // -------------------------------------------------------------------------
  app.get('/companies/:companyId/billing/customers', async (req) => {
    const user = req.user!;
    const { companyId } = req.params as { companyId: string };
    await requireCompany(db, user.id, companyId, 'viewer', 'billing');
    const q = req.query as Record<string, string | undefined>;
    const params: unknown[] = [companyId];
    const where = ['company_id = $1'];
    if (q.includeArchived !== 'true') where.push('archived_at IS NULL');
    if (q.search) {
      params.push(`%${q.search.trim()}%`);
      where.push(`(name ILIKE $${params.length} OR brn ILIKE $${params.length} OR vat_number ILIKE $${params.length})`);
    }
    const res = await db.query(
      `SELECT * FROM billing_customers WHERE ${where.join(' AND ')} ORDER BY name ASC LIMIT 500`,
      params,
    );
    return { customers: res.rows.map(customerView), available: true };
  });

  app.post('/companies/:companyId/billing/customers', async (req, reply) => {
    const user = req.user!;
    const { companyId } = req.params as { companyId: string };
    await requireCompany(db, user.id, companyId, 'billing_clerk', 'billing');
    const body = parse(customerBody, req.body);
    if (body.receivableAccountId) {
      await assertAccountInCompany(db, companyId, body.receivableAccountId, 'receivableAccountId');
    }

    const existing = await db.query<any>(
      `SELECT id, name, brn, city, vat_number FROM billing_customers
        WHERE company_id = $1 AND archived_at IS NULL
          AND (lower(btrim(name)) = lower(btrim($2))
               OR ($3 <> '' AND lower(btrim(coalesce(brn, ''))) = lower(btrim($3))))`,
      [companyId, body.name, body.brn ?? ''],
    );
    if (existing.rowCount > 0 && !body.confirmDuplicate) {
      throw new AppError(
        'CUSTOMER_DUPLICATE',
        409,
        'A customer with the same name or BRN already exists: confirm explicitly for a legitimate homonym',
        {
          matches: existing.rows.map((r) => ({ id: r.id, name: r.name, brn: r.brn, city: r.city })),
        },
      );
    }

    const inserted = await db.query(
      `INSERT INTO billing_customers
         (company_id, name, legal_name, brn, vat_number, address_line1, address_line2, city,
          postcode, country, contact_name, contact_email, contact_phone, preferred_currency,
          payment_terms_days, receivable_account_id, notes, is_active, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
       RETURNING *`,
      [
        companyId,
        body.name,
        nullable(body.legalName),
        nullable(body.brn),
        nullable(body.vatNumber),
        nullable(body.addressLine1),
        nullable(body.addressLine2),
        nullable(body.city),
        nullable(body.postcode),
        (body.country ?? 'MU').toUpperCase(),
        nullable(body.contactName),
        nullable(body.contactEmail),
        nullable(body.contactPhone),
        body.preferredCurrency ?? null,
        body.paymentTermsDays ?? null,
        body.receivableAccountId ?? null,
        nullable(body.notes),
        body.isActive ?? true,
        user.id,
      ],
    );
    await writeAudit(db, {
      companyId,
      userId: user.id,
      action: 'billing.customer.create',
      entityType: 'billing_customer',
      entityId: (inserted.rows[0] as any).id,
      details: { name: body.name, homonymConfirmed: existing.rowCount > 0 },
      ip: clientIp(req),
    });
    return reply.code(201).send({ customer: customerView(inserted.rows[0]) });
  });

  app.get('/companies/:companyId/billing/customers/:customerId', async (req) => {
    const user = req.user!;
    const { companyId, customerId } = req.params as { companyId: string; customerId: string };
    await requireCompany(db, user.id, companyId, 'viewer', 'billing');
    const customer = await loadCustomer(db, companyId, customerId);
    const query = req.query as Record<string, string | undefined>;
    const asOf = query.asOf ? parseIsoDate(query.asOf, 'asOf') : today();
    const balance = await customerBalance(db, companyId, customerId, asOf);
    return { customer: customerView(customer), balance };
  });

  app.get('/companies/:companyId/billing/customers/:customerId/balance', async (req) => {
    const user = req.user!;
    const { companyId, customerId } = req.params as { companyId: string; customerId: string };
    await requireCompany(db, user.id, companyId, 'viewer', 'billing');
    await loadCustomer(db, companyId, customerId);
    const query = req.query as Record<string, string | undefined>;
    const asOf = query.asOf ? parseIsoDate(query.asOf, 'asOf') : today();
    return { balance: await customerBalance(db, companyId, customerId, asOf) };
  });

  app.patch('/companies/:companyId/billing/customers/:customerId', async (req) => {
    const user = req.user!;
    const { companyId, customerId } = req.params as { companyId: string; customerId: string };
    await requireCompany(db, user.id, companyId, 'billing_clerk', 'billing');
    const body = parse(customerBody.partial(), req.body);
    if (body.receivableAccountId) {
      await assertAccountInCompany(db, companyId, body.receivableAccountId, 'receivableAccountId');
    }
    const archived = body.isActive === false;
    const updated = await db.query(
      `UPDATE billing_customers SET
         name = COALESCE($3, name),
         legal_name = CASE WHEN $4::boolean THEN $5 ELSE legal_name END,
         brn = CASE WHEN $6::boolean THEN $7 ELSE brn END,
         vat_number = CASE WHEN $8::boolean THEN $9 ELSE vat_number END,
         address_line1 = CASE WHEN $10::boolean THEN $11 ELSE address_line1 END,
         city = CASE WHEN $12::boolean THEN $13 ELSE city END,
         country = COALESCE($14, country),
         contact_name = CASE WHEN $15::boolean THEN $16 ELSE contact_name END,
         contact_email = CASE WHEN $17::boolean THEN $18 ELSE contact_email END,
         contact_phone = CASE WHEN $19::boolean THEN $20 ELSE contact_phone END,
         preferred_currency = CASE WHEN $21::boolean THEN $22 ELSE preferred_currency END,
         payment_terms_days = CASE WHEN $23::boolean THEN $24 ELSE payment_terms_days END,
         receivable_account_id = CASE WHEN $25::boolean THEN $26::uuid ELSE receivable_account_id END,
         notes = CASE WHEN $27::boolean THEN $28 ELSE notes END,
         is_active = COALESCE($29, is_active),
         archived_at = CASE WHEN $29::boolean THEN now() WHEN $29::boolean = false THEN NULL ELSE archived_at END,
         updated_at = now()
       WHERE id = $1 AND company_id = $2
       RETURNING *`,
      [
        customerId,
        companyId,
        body.name ?? null,
        body.legalName !== undefined,
        nullable(body.legalName),
        body.brn !== undefined,
        nullable(body.brn),
        body.vatNumber !== undefined,
        nullable(body.vatNumber),
        body.addressLine1 !== undefined,
        nullable(body.addressLine1),
        body.city !== undefined,
        nullable(body.city),
        body.country ?? null,
        body.contactName !== undefined,
        nullable(body.contactName),
        body.contactEmail !== undefined,
        nullable(body.contactEmail),
        body.contactPhone !== undefined,
        nullable(body.contactPhone),
        body.preferredCurrency !== undefined,
        body.preferredCurrency ?? null,
        body.paymentTermsDays !== undefined,
        body.paymentTermsDays ?? null,
        body.receivableAccountId !== undefined,
        body.receivableAccountId ?? null,
        body.notes !== undefined,
        nullable(body.notes),
        body.isActive ?? null,
        archived,
      ],
    );
    if (updated.rowCount === 0) throw notFound('CUSTOMER_NOT_FOUND', 'Customer not found');
    await writeAudit(db, {
      companyId,
      userId: user.id,
      action: 'billing.customer.update',
      entityType: 'billing_customer',
      entityId: customerId,
      details: { fields: Object.keys(body) },
    });
    return { customer: customerView(updated.rows[0]) };
  });

  /** Archiving, never a physical delete: issued history must survive. */
  app.delete('/companies/:companyId/billing/customers/:customerId', async (req) => {
    const user = req.user!;
    const { companyId, customerId } = req.params as { companyId: string; customerId: string };
    await requireCompany(db, user.id, companyId, 'billing_clerk', 'billing');
    const updated = await db.query(
      `UPDATE billing_customers SET is_active = false, archived_at = now(), updated_at = now()
        WHERE id = $1 AND company_id = $2 RETURNING id`,
      [customerId, companyId],
    );
    if (updated.rowCount === 0) throw notFound('CUSTOMER_NOT_FOUND', 'Customer not found');
    await writeAudit(db, {
      companyId,
      userId: user.id,
      action: 'billing.customer.archive',
      entityType: 'billing_customer',
      entityId: customerId,
    });
    return { archived: true };
  });

  app.get('/companies/:companyId/billing/customers/:customerId/history', async (req) => {
    const user = req.user!;
    const { companyId, customerId } = req.params as { companyId: string; customerId: string };
    await requireCompany(db, user.id, companyId, 'viewer', 'billing');
    await loadCustomer(db, companyId, customerId);
    const docs = await db.query(
      `SELECT id, kind, doc_no, status, payment_status, issue_date, due_date, currency,
              total_amount, amount_paid, credited_amount
         FROM billing_documents
        WHERE company_id = $1 AND customer_id = $2
        ORDER BY issue_date DESC, created_at DESC LIMIT 200`,
      [companyId, customerId],
    );
    const payments = await db.query(
      `SELECT id, payment_no, payment_date, amount, currency, method, reference,
              unallocated_amount, status, accounting_entry_id
         FROM billing_payments WHERE company_id = $1 AND customer_id = $2
        ORDER BY payment_date DESC LIMIT 200`,
      [companyId, customerId],
    );
    return {
      documents: docs.rows.map((r: any) => ({
        id: r.id,
        kind: r.kind,
        number: r.doc_no,
        status: r.status,
        paymentStatus: r.payment_status,
        issueDate: r.issue_date,
        dueDate: r.due_date,
        currency: r.currency,
        total: r.total_amount,
        amountPaid: r.amount_paid,
        creditedAmount: r.credited_amount,
        outstanding: formatAmount(outstandingOf(r)),
      })),
      payments: payments.rows.map((r: any) => ({
        id: r.id,
        number: r.payment_no,
        paymentDate: r.payment_date,
        amount: r.amount,
        currency: r.currency,
        method: r.method,
        reference: r.reference,
        unallocated: r.unallocated_amount,
        status: r.status,
        accountingEntryId: r.accounting_entry_id,
      })),
      balance: await customerBalance(db, companyId, customerId, today()),
    };
  });

  // -------------------------------------------------------------------------
  // Items
  // -------------------------------------------------------------------------
  app.get('/companies/:companyId/billing/items', async (req) => {
    const user = req.user!;
    const { companyId } = req.params as { companyId: string };
    await requireCompany(db, user.id, companyId, 'viewer', 'billing');
    const q = req.query as Record<string, string | undefined>;
    const params: unknown[] = [companyId];
    const where = ['company_id = $1'];
    if (q.includeInactive !== 'true') where.push('is_active = true');
    if (q.search) {
      params.push(`%${q.search.trim()}%`);
      where.push(`(reference ILIKE $${params.length} OR label_fr ILIKE $${params.length} OR label_en ILIKE $${params.length})`);
    }
    const res = await db.query(
      `SELECT * FROM billing_items WHERE ${where.join(' AND ')} ORDER BY reference ASC LIMIT 500`,
      params,
    );
    return { items: res.rows.map(itemView) };
  });

  app.post('/companies/:companyId/billing/items', async (req, reply) => {
    const user = req.user!;
    const { companyId } = req.params as { companyId: string };
    await requireCompany(db, user.id, companyId, 'billing_clerk', 'billing');
    const body = parse(itemBody, req.body);
    const functional = await functionalCurrency(db, companyId);
    if (body.revenueAccountId) {
      await assertAccountInCompany(db, companyId, body.revenueAccountId, 'revenueAccountId');
    }
    if (body.vatRateId) {
      const rate = await db.query('SELECT 1 FROM billing_tax_rates WHERE id = $1 AND company_id = $2', [
        body.vatRateId,
        companyId,
      ]);
      if (rate.rowCount === 0) throw notFound('VAT_RATE_NOT_FOUND', 'VAT rate not found');
    }
    const treatment = body.vatTreatment ?? 'standard';
    if (treatment !== 'standard' && body.vatRateId) {
      throw badRequest('VALIDATION_ERROR', 'A non-standard treatment cannot carry a VAT rate');
    }
    const inserted = await db.query(
      `INSERT INTO billing_items
         (company_id, reference, label_fr, label_en, description, unit_price, currency, unit,
          category, vat_treatment, vat_rate_id, revenue_account_id, is_active, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       RETURNING *`,
      [
        companyId,
        body.reference,
        body.labelFr,
        nullable(body.labelEn),
        nullable(body.description),
        decimal(body.unitPrice),
        body.currency ?? functional,
        body.unit ?? 'unit',
        nullable(body.category),
        treatment,
        body.vatRateId ?? null,
        body.revenueAccountId ?? null,
        body.isActive ?? true,
        user.id,
      ],
    );
    await writeAudit(db, {
      companyId,
      userId: user.id,
      action: 'billing.item.create',
      entityType: 'billing_item',
      entityId: (inserted.rows[0] as any).id,
      details: { reference: body.reference },
      ip: clientIp(req),
    });
    return reply.code(201).send({ item: itemView(inserted.rows[0]) });
  });

  app.patch('/companies/:companyId/billing/items/:itemId', async (req) => {
    const user = req.user!;
    const { companyId, itemId } = req.params as { companyId: string; itemId: string };
    await requireCompany(db, user.id, companyId, 'billing_clerk', 'billing');
    const body = parse(itemBody.partial(), req.body);
    if (body.revenueAccountId) {
      await assertAccountInCompany(db, companyId, body.revenueAccountId, 'revenueAccountId');
    }
    const updated = await db.query(
      `UPDATE billing_items SET
         reference = COALESCE($3, reference),
         label_fr = COALESCE($4, label_fr),
         label_en = CASE WHEN $5::boolean THEN $6 ELSE label_en END,
         description = CASE WHEN $7::boolean THEN $8 ELSE description END,
         unit_price = COALESCE($9, unit_price),
         currency = COALESCE($10, currency),
         unit = COALESCE($11, unit),
         category = CASE WHEN $12::boolean THEN $13 ELSE category END,
         vat_treatment = COALESCE($14, vat_treatment),
         vat_rate_id = CASE WHEN $15::boolean THEN $16::uuid ELSE vat_rate_id END,
         revenue_account_id = CASE WHEN $17::boolean THEN $18::uuid ELSE revenue_account_id END,
         is_active = COALESCE($19, is_active),
         updated_at = now()
       WHERE id = $1 AND company_id = $2 RETURNING *`,
      [
        itemId,
        companyId,
        body.reference ?? null,
        body.labelFr ?? null,
        body.labelEn !== undefined,
        nullable(body.labelEn),
        body.description !== undefined,
        nullable(body.description),
        body.unitPrice === undefined ? null : decimal(body.unitPrice),
        body.currency ?? null,
        body.unit ?? null,
        body.category !== undefined,
        nullable(body.category),
        body.vatTreatment ?? null,
        body.vatRateId !== undefined,
        body.vatRateId ?? null,
        body.revenueAccountId !== undefined,
        body.revenueAccountId ?? null,
        body.isActive ?? null,
      ],
    );
    if (updated.rowCount === 0) throw notFound('ITEM_NOT_FOUND', 'Item not found');
    return { item: itemView(updated.rows[0]) };
  });

  app.delete('/companies/:companyId/billing/items/:itemId', async (req) => {
    const user = req.user!;
    const { companyId, itemId } = req.params as { companyId: string; itemId: string };
    await requireCompany(db, user.id, companyId, 'billing_clerk', 'billing');
    const updated = await db.query(
      'UPDATE billing_items SET is_active = false, updated_at = now() WHERE id = $1 AND company_id = $2 RETURNING id',
      [itemId, companyId],
    );
    if (updated.rowCount === 0) throw notFound('ITEM_NOT_FOUND', 'Item not found');
    return { archived: true };
  });

  // -------------------------------------------------------------------------
  // Documents
  // -------------------------------------------------------------------------
  app.get('/companies/:companyId/billing/documents', async (req) => {
    const user = req.user!;
    const { companyId } = req.params as { companyId: string };
    await requireCompany(db, user.id, companyId, 'viewer', 'billing');
    const q = req.query as Record<string, string | undefined>;
    const params: unknown[] = [companyId];
    const where = ['d.company_id = $1'];
    if (q.kind && ['quote', 'invoice', 'credit_note'].includes(q.kind)) {
      params.push(q.kind);
      where.push(`d.kind = $${params.length}`);
    }
    if (q.status) {
      params.push(q.status);
      where.push(`d.status = $${params.length}`);
    }
    if (q.customerId) {
      params.push(q.customerId);
      where.push(`d.customer_id = $${params.length}`);
    }
    if (q.search) {
      params.push(`%${q.search.trim()}%`);
      where.push(`(d.doc_no ILIKE $${params.length} OR d.customer_name ILIKE $${params.length})`);
    }
    if (q.from) {
      params.push(parseIsoDate(q.from, 'from'));
      where.push(`d.issue_date >= $${params.length}`);
    }
    if (q.to) {
      params.push(parseIsoDate(q.to, 'to'));
      where.push(`d.issue_date <= $${params.length}`);
    }
    const limit = Math.min(Math.max(Number(q.limit ?? 100), 1), 500);
    const res = await db.query(
      `SELECT d.* FROM billing_documents d
        WHERE ${where.join(' AND ')}
        ORDER BY d.issue_date DESC, d.created_at DESC LIMIT ${limit}`,
      params,
    );
    return {
      documents: res.rows.map((row: any) => documentView(row)),
      available: true,
      capabilities: { mraEInvoicing: false, postingToAccounting: true },
    };
  });

  app.post('/companies/:companyId/billing/documents', async (req, reply) => {
    const user = req.user!;
    const { companyId } = req.params as { companyId: string };
    await requireCompany(db, user.id, companyId, 'billing_clerk', 'billing');
    const body = parse(documentBody, req.body);
    const result = await db.transaction((tx) =>
      createDocumentTx(tx, { companyId, userId: user.id, ip: clientIp(req), body }),
    );
    return reply.code(201).send({
      document: documentView(result.document, result.lines),
      duplicates: result.duplicates,
      warnings: result.warnings,
    });
  });

  app.get('/companies/:companyId/billing/documents/:documentId', async (req) => {
    const user = req.user!;
    const { companyId, documentId } = req.params as { companyId: string; documentId: string };
    await requireCompany(db, user.id, companyId, 'viewer', 'billing');
    const loaded = await loadDocument(db, companyId, documentId);
    const events = await db.query(
      'SELECT action, actor_id, details, created_at FROM billing_document_events WHERE document_id = $1 ORDER BY created_at',
      [documentId],
    );
    const duplicates = await findDuplicates(db, companyId, {
      kind: loaded.document.kind,
      customerId: loaded.document.customer_id,
      customerName: loaded.document.customer_name,
      docNo: loaded.document.doc_no,
      issueDate: loaded.document.issue_date,
      totalAmount: loaded.document.total_amount,
      currency: loaded.document.currency,
      sourceDocumentId: loaded.document.source_document_id,
      excludeDocumentId: loaded.document.id,
    });
    return {
      document: documentView(loaded.document, loaded.lines),
      events: events.rows,
      duplicates,
    };
  });

  app.patch('/companies/:companyId/billing/documents/:documentId', async (req) => {
    const user = req.user!;
    const { companyId, documentId } = req.params as { companyId: string; documentId: string };
    await requireCompany(db, user.id, companyId, 'billing_clerk', 'billing');
    const body = parse(patchDocumentBody, req.body);

    const result = await db.transaction(async (tx) => {
      const locked = await tx.query<DocumentRow>(
        'SELECT * FROM billing_documents WHERE id = $1 AND company_id = $2 FOR UPDATE',
        [documentId, companyId],
      );
      const document = locked.rows[0];
      if (!document) throw notFound('DOCUMENT_NOT_FOUND', 'Billing document not found');
      if (document.status !== 'draft') {
        throw conflict('DOCUMENT_LOCKED', 'An issued document can no longer be modified; use a credit note');
      }
      const ctx = await loadBillingContext(tx, companyId);
      const customer = body.customerId
        ? await loadCustomer(tx, companyId, body.customerId)
        : await loadCustomer(tx, companyId, document.customer_id!);
      const functional = await functionalCurrency(tx, companyId);
      const issueDate = body.issueDate ? parseIsoDate(body.issueDate, 'issueDate') : document.issue_date;
      const currency = (body.currency ?? document.currency).toUpperCase();
      let exchangeRate =
        body.exchangeRate === undefined
          ? document.exchange_rate
          : body.exchangeRate === null
            ? null
            : decimal(body.exchangeRate);
      if (currency !== functional) {
        if (!exchangeRate) {
          throw badRequest('EXCHANGE_RATE_REQUIRED', `An exchange rate is required for ${currency}`);
        }
      } else {
        exchangeRate = exchangeRate ?? '1';
      }

      let lines: LineRequest[];
      if (body.lines) {
        lines = body.lines as LineRequest[];
      } else {
        const current = await tx.query(
          'SELECT * FROM billing_document_lines WHERE document_id = $1 ORDER BY line_no',
          [documentId],
        );
        lines = lineRequestsFromRows(current.rows);
      }
      const computation = computeDocument(lines, {
        companyId,
        issueDate,
        currency,
        vatEnabled: ctx.settings.vat_enabled,
        taxRates: ctx.taxRates,
        items: ctx.items,
        defaultRevenueAccountId: ctx.defaultRevenueAccountId,
      });

      const dueDate =
        body.dueDate === undefined
          ? document.due_date
          : body.dueDate === null
            ? null
            : parseIsoDate(body.dueDate, 'dueDate');

      const updated = await tx.query<DocumentRow>(
        `UPDATE billing_documents SET
           customer_id = $3, customer_name = $4, customer_brn = $5, issue_date = $6, due_date = $7,
           valid_until = CASE WHEN $8::boolean THEN $9::date ELSE valid_until END,
           currency = $10, exchange_rate = $11, subtotal = $12, discount_total = $13, tax_total = $14,
           total_amount = $15, notes = CASE WHEN $16::boolean THEN $17 ELSE notes END,
           terms = CASE WHEN $18::boolean THEN $19 ELSE terms END, updated_by = $20, updated_at = now()
         WHERE id = $21 AND company_id = $22 AND status = 'draft'
         RETURNING *`,
        [
          customer.id,
          customer.name,
          customer.brn ?? null,
          issueDate,
          dueDate,
          body.validUntil !== undefined,
          body.validUntil ? parseIsoDate(body.validUntil, 'validUntil') : null,
          currency,
          exchangeRate ?? '1',
          formatAmount(computation.subtotal),
          formatAmount(computation.discountTotal),
          formatAmount(computation.taxTotal),
          formatAmount(computation.total),
          body.notes !== undefined,
          nullable(body.notes),
          body.terms !== undefined,
          nullable(body.terms),
          user.id,
          documentId,
          companyId,
        ],
      );
      if (updated.rowCount === 0) throw conflict('DOCUMENT_LOCKED', 'Document is no longer a draft');
      await tx.query('DELETE FROM billing_document_lines WHERE document_id = $1 AND company_id = $2', [
        documentId,
        companyId,
      ]);
      await insertLines(tx, companyId, documentId, computation.lines);
      await logDocumentEvent(tx, {
        companyId,
        documentId,
        action: 'updated',
        userId: user.id,
        details: { total: formatAmount(computation.total) },
      });
      const linesOut = await tx.query(
        'SELECT * FROM billing_document_lines WHERE document_id = $1 ORDER BY line_no',
        [documentId],
      );
      return { document: updated.rows[0]!, lines: linesOut.rows, warnings: computation.warnings };
    });

    return { document: documentView(result.document, result.lines), warnings: result.warnings };
  });

  /** Issues a quote (status `sent`) or an invoice / credit note (status `issued`). */
  app.post('/companies/:companyId/billing/documents/:documentId/issue', async (req) => {
    const user = req.user!;
    const { companyId, documentId } = req.params as { companyId: string; documentId: string };
    await requireCompany(db, user.id, companyId, 'billing_clerk', 'billing');

    const result = await db.transaction(async (tx) => {
      const locked = await tx.query<DocumentRow>(
        'SELECT * FROM billing_documents WHERE id = $1 AND company_id = $2 FOR UPDATE',
        [documentId, companyId],
      );
      const document = locked.rows[0];
      if (!document) throw notFound('DOCUMENT_NOT_FOUND', 'Billing document not found');
      if (document.status !== 'draft') {
        throw conflict('DOCUMENT_STATUS_INVALID', `Document is already ${document.status}`);
      }
      if (document.kind !== 'quote' && document.kind !== 'invoice' && document.kind !== 'credit_note') {
        throw badRequest('DOCUMENT_STATUS_INVALID', 'Unsupported document kind');
      }
      if (!document.customer_id) {
        throw badRequest('VALIDATION_ERROR', 'A customer is required before issuing a document');
      }
      const ctx = await loadBillingContext(tx, companyId);

      if (document.kind === 'credit_note') {
        if (!document.source_document_id) {
          throw badRequest('VALIDATION_ERROR', 'A credit note must reference an invoice');
        }
        const invoice = await tx.query<any>(
          'SELECT * FROM billing_documents WHERE id = $1 AND company_id = $2 FOR UPDATE',
          [document.source_document_id, companyId],
        );
        const original = invoice.rows[0];
        if (!original) throw notFound('DOCUMENT_NOT_FOUND', 'Original invoice not found');
        if (parseAmount(original.credited_amount) + parseAmount(document.total_amount) > parseAmount(original.total_amount)) {
          throw conflict('CREDIT_EXCEEDS_INVOICE', 'The credit note exceeds the remaining creditable amount');
        }
      }

      const year = sequenceYear(ctx.settings.numbering_policy, document.issue_date);
      const kind = document.kind as NumberKind;
      const no = await nextBillingNumber(tx, companyId, kind, year);
      const number = formatDocumentNumber(
        prefixFor(ctx.settings, kind),
        year,
        no,
        ctx.settings.numbering_policy === 'continuous',
      );
      const status = kind === 'quote' ? 'sent' : 'issued';
      const dueDate =
        kind === 'invoice' && !document.due_date
          ? addDays(document.issue_date, ctx.settings.default_payment_terms)
          : document.due_date;

      const updated = await tx.query<DocumentRow>(
        `UPDATE billing_documents SET
           doc_no = $1, sequence_year = $2, sequence_no = $3, status = $4, due_date = $5,
           issued_at = now(), locked_at = now(),
           sent_at = CASE WHEN $4 = 'sent' THEN now() ELSE sent_at END,
           updated_at = now(), updated_by = $6
         WHERE id = $7 AND company_id = $8
         RETURNING *`,
        [number, year, no, status, dueDate, user.id, documentId, companyId],
      );
      if (kind === 'credit_note' && document.source_document_id) {
        await refreshInvoiceBalance(tx, companyId, document.source_document_id);
      }
      await logDocumentEvent(tx, {
        companyId,
        documentId,
        action: kind === 'quote' ? 'sent' : 'issued',
        userId: user.id,
        details: { number, year, sequence: no },
      });
      await writeAudit(tx, {
        companyId,
        userId: user.id,
        action: 'billing.document.issue',
        entityType: 'billing_document',
        entityId: documentId,
        details: { number, kind, total: document.total_amount },
        ip: clientIp(req),
      });
      return updated.rows[0]!;
    });

    const loaded = await loadDocument(db, companyId, documentId);
    return { document: documentView(result, loaded.lines), entryCreated: false };
  });

  app.post('/companies/:companyId/billing/documents/:documentId/cancel-draft', async (req) => {
    const user = req.user!;
    const { companyId, documentId } = req.params as { companyId: string; documentId: string };
    await requireCompany(db, user.id, companyId, 'billing_clerk', 'billing');
    const result = await db.transaction(async (tx) => {
      const locked = await tx.query<DocumentRow>(
        'SELECT * FROM billing_documents WHERE id = $1 AND company_id = $2 FOR UPDATE',
        [documentId, companyId],
      );
      const document = locked.rows[0];
      if (!document) throw notFound('DOCUMENT_NOT_FOUND', 'Billing document not found');
      if (document.status !== 'draft') {
        throw conflict(
          'DOCUMENT_LOCKED',
          'An issued document is never deleted: issue a credit note or cancel through the documented process',
        );
      }
      await tx.query(
        `UPDATE billing_documents SET status = 'cancelled', cancelled_at = now(), updated_at = now(),
           updated_by = $3 WHERE id = $1 AND company_id = $2`,
        [documentId, companyId, user.id],
      );
      await logDocumentEvent(tx, {
        companyId,
        documentId,
        action: 'cancelled_draft',
        userId: user.id,
      });
      return true;
    });
    void result;
    return { cancelled: true, deleted: false };
  });

  app.post('/companies/:companyId/billing/documents/:documentId/accept', async (req) => {
    const user = req.user!;
    const { companyId, documentId } = req.params as { companyId: string; documentId: string };
    await requireCompany(db, user.id, companyId, 'billing_clerk', 'billing');
    const updated = await db.query(
      `UPDATE billing_documents SET status = 'accepted', accepted_at = now(), updated_at = now()
        WHERE id = $1 AND company_id = $2 AND kind = 'quote' AND status = 'sent'
        RETURNING *`,
      [documentId, companyId],
    );
    if (updated.rowCount === 0) {
      throw conflict('DOCUMENT_STATUS_INVALID', 'Only a sent quote can be accepted');
    }
    await logDocumentEvent(db, {
      companyId,
      documentId,
      action: 'accepted',
      userId: user.id,
    });
    return { document: documentView(updated.rows[0] as DocumentRow) };
  });

  app.post('/companies/:companyId/billing/documents/:documentId/refuse', async (req) => {
    const user = req.user!;
    const { companyId, documentId } = req.params as { companyId: string; documentId: string };
    await requireCompany(db, user.id, companyId, 'billing_clerk', 'billing');
    const updated = await db.query(
      `UPDATE billing_documents SET status = 'refused', refused_at = now(), updated_at = now()
        WHERE id = $1 AND company_id = $2 AND kind = 'quote' AND status IN ('sent', 'accepted')
        RETURNING *`,
      [documentId, companyId],
    );
    if (updated.rowCount === 0) throw conflict('DOCUMENT_STATUS_INVALID', 'Only a quote can be refused');
    return { document: documentView(updated.rows[0] as DocumentRow) };
  });

  /** Quote -> invoice draft. The conversion is traceable and happens only once. */
  app.post('/companies/:companyId/billing/documents/:documentId/convert', async (req, reply) => {
    const user = req.user!;
    const { companyId, documentId } = req.params as { companyId: string; documentId: string };
    await requireCompany(db, user.id, companyId, 'billing_clerk', 'billing');
    const body = parse(
      z.object({ issueDate: dateInput.optional(), confirmDuplicate: z.boolean().optional() }).strict(),
      req.body ?? {},
    );

    const result = await db.transaction(async (tx) => {
      const quote = await loadDocument(tx, companyId, documentId);
      if (quote.document.kind !== 'quote') {
        throw badRequest('VALIDATION_ERROR', 'Only a quote can be converted into an invoice');
      }
      if (!quote.document.customer_id) {
        throw badRequest('VALIDATION_ERROR', 'The quote has no customer to invoice');
      }
      const created = await createDocumentTx(tx, {
        companyId,
        userId: user.id,
        ip: clientIp(req),
        body: {
          kind: 'invoice',
          customerId: quote.document.customer_id,
          issueDate: body.issueDate ?? today(),
          currency: quote.document.currency,
          exchangeRate: null,
          sourceDocumentId: quote.document.id,
          confirmDuplicate: body.confirmDuplicate,
        },
      });
      if (quote.document.status === 'sent') {
        await tx.query(
          `UPDATE billing_documents SET status = 'accepted', accepted_at = now(), updated_at = now()
            WHERE id = $1 AND company_id = $2 AND status = 'sent'`,
          [documentId, companyId],
        );
      }
      await logDocumentEvent(tx, {
        companyId,
        documentId,
        action: 'converted',
        userId: user.id,
        details: { invoiceId: created.document.id },
      });
      return created;
    });

    return reply.code(201).send({
      document: documentView(result.document, result.lines),
      duplicates: result.duplicates,
      entryCreated: false,
    });
  });

  app.get('/companies/:companyId/billing/documents/:documentId/events', async (req) => {
    const user = req.user!;
    const { companyId, documentId } = req.params as { companyId: string; documentId: string };
    await requireCompany(db, user.id, companyId, 'viewer', 'billing');
    const res = await db.query(
      `SELECT action, actor_id, details, created_at FROM billing_document_events
        WHERE document_id = $1 AND company_id = $2 ORDER BY created_at ASC`,
      [documentId, companyId],
    );
    return { events: res.rows };
  });

  app.get('/companies/:companyId/billing/documents/:documentId/pdf', async (req, reply) => {
    const user = req.user!;
    const { companyId, documentId } = req.params as { companyId: string; documentId: string };
    await requireCompany(db, user.id, companyId, 'viewer', 'billing');
    const loaded = await loadDocument(db, companyId, documentId);
    if (loaded.document.status === 'draft') {
      throw conflict('DOCUMENT_NOT_ISSUED', 'A draft has no legal value: issue the document before exporting a PDF');
    }
    const company = await db.query<any>('SELECT * FROM companies WHERE id = $1', [companyId]);
    const ctx = await loadBillingContext(db, companyId);
    const customer = loaded.document.customer_id
      ? await loadCustomer(db, companyId, loaded.document.customer_id)
      : null;
    const q = req.query as Record<string, string | undefined>;
    const locale = q.lang === 'en' ? 'en' : 'fr';
    const buffer = await billingDocumentPdf({
      company: company.rows[0],
      settings: ctx.settings,
      document: loaded.document,
      lines: loaded.lines,
      customer,
      locale,
    });
    reply.header('content-type', 'application/pdf');
    reply.header(
      'content-disposition',
      `inline; filename="${(loaded.document.doc_no ?? 'document').replace(/[^A-Za-z0-9_-]/g, '_')}.pdf"`,
    );
    reply.header('cache-control', 'private, no-store');
    return reply.send(buffer);
  });

  // -------------------------------------------------------------------------
  // Duplicate detection (deterministic, no automatic deletion)
  // -------------------------------------------------------------------------
  app.post('/companies/:companyId/billing/duplicates/check', async (req) => {
    const user = req.user!;
    const { companyId } = req.params as { companyId: string };
    await requireCompany(db, user.id, companyId, 'viewer', 'billing');
    const body = parse(duplicateBody, req.body);
    const check = await findDuplicates(db, companyId, {
      kind: body.kind,
      customerId: body.customerId ?? null,
      customerName: body.customerName ?? null,
      docNo: body.docNo ?? null,
      issueDate: parseIsoDate(body.issueDate, 'issueDate'),
      totalAmount: decimal(body.totalAmount),
      currency: body.currency,
      sourceDocumentId: body.sourceDocumentId ?? null,
      excludeDocumentId: body.excludeDocumentId ?? null,
    });
    return { check, automaticAction: 'none', humanValidationRequired: true };
  });

  // -------------------------------------------------------------------------
  // Payments
  // -------------------------------------------------------------------------
  app.get('/companies/:companyId/billing/payments', async (req) => {
    const user = req.user!;
    const { companyId } = req.params as { companyId: string };
    await requireCompany(db, user.id, companyId, 'viewer', 'billing');
    const q = req.query as Record<string, string | undefined>;
    const params: unknown[] = [companyId];
    const where = ['p.company_id = $1'];
    if (q.customerId) {
      params.push(q.customerId);
      where.push(`p.customer_id = $${params.length}`);
    }
    if (q.status) {
      params.push(q.status);
      where.push(`p.status = $${params.length}`);
    }
    const res = await db.query(
      `SELECT p.* FROM billing_payments p WHERE ${where.join(' AND ')}
        ORDER BY p.payment_date DESC, p.created_at DESC LIMIT 300`,
      params,
    );
    return {
      payments: res.rows.map((row: any) => paymentView(row)),
      methods: ['bank_transfer', 'cheque', 'cash', 'card', 'other'],
    };
  });

  app.post('/companies/:companyId/billing/payments', async (req, reply) => {
    const user = req.user!;
    const { companyId } = req.params as { companyId: string };
    await requireCompany(db, user.id, companyId, 'billing_clerk', 'billing');
    const body = parse(paymentBody, req.body);

    const result = await db.transaction(async (tx) => {
      const ctx = await loadBillingContext(tx, companyId);
      const customer = await loadCustomer(tx, companyId, body.customerId);
      if (!customer.is_active) throw conflict('DOCUMENT_STATUS_INVALID', 'This customer is archived');
      const functional = await functionalCurrency(tx, companyId);
      const currency = (body.currency ?? customer.preferred_currency ?? ctx.settings.default_currency).toUpperCase();
      if (currency !== functional && (body.exchangeRate === undefined || body.exchangeRate === null)) {
        throw badRequest('EXCHANGE_RATE_REQUIRED', `An exchange rate is required for a payment in ${currency}`);
      }
      const exchangeRate = currency === functional ? '1' : decimal(body.exchangeRate);
      const amount = parseAmount(decimal(body.amount));
      if (amount <= 0n) throw badRequest('VALIDATION_ERROR', 'The payment amount must be greater than zero');
      const paymentDate = parseIsoDate(body.paymentDate, 'paymentDate');
      const valueDate = body.valueDate ? parseIsoDate(body.valueDate, 'valueDate') : null;

      const allocations: { invoiceId: string; amount: bigint; number: string | null }[] = [];
      const seen = new Set<string>();
      let allocated = 0n;
      for (const requested of body.allocations ?? []) {
        if (seen.has(requested.invoiceId)) {
          throw badRequest('ALLOCATION_INVALID', 'The same invoice is allocated twice in one payment');
        }
        seen.add(requested.invoiceId);
        const invoice = await tx.query<any>(
          'SELECT * FROM billing_documents WHERE id = $1 AND company_id = $2 AND kind = $3 FOR UPDATE',
          [requested.invoiceId, companyId, 'invoice'],
        );
        const row = invoice.rows[0];
        if (!row) throw notFound('DOCUMENT_NOT_FOUND', 'Invoice not found');
        if (row.customer_id !== customer.id) {
          throw badRequest('ALLOCATION_INVALID', 'The invoice belongs to another customer');
        }
        if (!['issued', 'partially_paid'].includes(row.status)) {
          throw conflict('ALLOCATION_INVALID', `Invoice ${row.doc_no ?? ''} is not open for payment`);
        }
        if (row.currency !== currency) {
          throw badRequest('CURRENCY_MISMATCH', 'The payment currency must match the invoice currency');
        }
        const allocation = parseAmount(decimal(requested.amount));
        if (allocation <= 0n) {
          throw badRequest('ALLOCATION_INVALID', 'An allocation must be greater than zero');
        }
        const outstanding = outstandingOf(row);
        if (allocation > outstanding) {
          throw new AppError('ALLOCATION_EXCEEDS_INVOICE', 409, 'The allocation exceeds the outstanding amount', {
            invoiceId: row.id,
            outstanding: formatAmount(outstanding),
            requested: formatAmount(allocation),
          });
        }
        allocated += allocation;
        allocations.push({ invoiceId: row.id, amount: allocation, number: row.doc_no });
      }
      if (allocated > amount) {
        throw badRequest('ALLOCATION_INVALID', 'Allocations exceed the payment amount');
      }
      const unallocated = amount - allocated;

      const year = sequenceYear(ctx.settings.numbering_policy, paymentDate);
      const no = await nextBillingNumber(tx, companyId, 'payment', year);
      const number = formatDocumentNumber(
        ctx.settings.quote_prefix === 'DEV' ? 'REC' : 'REC',
        year,
        no,
        ctx.settings.numbering_policy === 'continuous',
      );

      const inserted = await tx.query<any>(
        `INSERT INTO billing_payments
           (company_id, customer_id, payment_no, payment_date, value_date, amount, currency,
            exchange_rate, method, reference, unallocated_amount, status, sequence_year, sequence_no, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'recorded',$12,$13,$14)
         RETURNING *`,
        [
          companyId,
          customer.id,
          number,
          paymentDate,
          valueDate,
          formatAmount(amount),
          currency,
          exchangeRate,
          body.method ?? 'bank_transfer',
          nullable(body.reference),
          formatAmount(unallocated),
          year,
          no,
          user.id,
        ],
      );
      const payment = inserted.rows[0]!;
      for (const allocation of allocations) {
        await tx.query(
          `INSERT INTO billing_payment_allocations
             (payment_id, invoice_id, company_id, amount, allocated_date)
           VALUES ($1,$2,$3,$4,$5)`,
          [payment.id, allocation.invoiceId, companyId, formatAmount(allocation.amount), paymentDate],
        );
        await refreshInvoiceBalance(tx, companyId, allocation.invoiceId);
      }

      // Deterministic duplicate warning: same customer, amount and date, or a
      // reused transaction reference. It never blocks, a human decides.
      const duplicate = await tx.query<any>(
        `SELECT id, payment_no, payment_date, amount, reference FROM billing_payments
          WHERE company_id = $1 AND customer_id = $2 AND status = 'recorded' AND id <> $3
            AND amount = $4 AND payment_date BETWEEN ($5::date - 3) AND ($5::date + 3)
          LIMIT 5`,
        [companyId, customer.id, payment.id, formatAmount(amount), paymentDate],
      );
      const sameReference = body.reference
        ? await tx.query<any>(
            `SELECT id FROM billing_payments WHERE company_id = $1 AND status = 'recorded'
              AND id <> $2 AND reference IS NOT NULL AND lower(btrim(reference)) = lower(btrim($3)) LIMIT 3`,
            [companyId, payment.id, body.reference],
          )
        : { rowCount: 0, rows: [] };
      const warnings: string[] = [];
      if (duplicate.rowCount > 0) {
        warnings.push('POSSIBLE_DUPLICATE_PAYMENT: a payment with the same amount and a close date already exists');
      }
      if (sameReference.rowCount > 0) {
        warnings.push('POSSIBLE_DUPLICATE_REFERENCE: this transaction reference is already used');
      }

      await writeAudit(tx, {
        companyId,
        userId: user.id,
        action: 'billing.payment.create',
        entityType: 'billing_payment',
        entityId: payment.id,
        details: {
          number,
          amount: formatAmount(amount),
          unallocated: formatAmount(unallocated),
          currency,
        },
        ip: clientIp(req),
      });
      const paymentAllocations = await tx.query(
        `SELECT a.*, d.doc_no, d.customer_name FROM billing_payment_allocations a
           JOIN billing_documents d ON d.id = a.invoice_id WHERE a.payment_id = $1`,
        [payment.id],
      );
      return {
        payment,
        allocations: paymentAllocations.rows,
        warnings,
        duplicates: duplicate.rows,
        entryCreated: false,
      };
    });

    return reply.code(201).send({
      payment: paymentView(result.payment, result.allocations),
      warnings: result.warnings,
      duplicates: result.duplicates,
      entryCreated: false,
    });
  });

  app.get('/companies/:companyId/billing/payments/:paymentId', async (req) => {
    const user = req.user!;
    const { companyId, paymentId } = req.params as { companyId: string; paymentId: string };
    await requireCompany(db, user.id, companyId, 'viewer', 'billing');
    const payment = await db.query<any>(
      'SELECT * FROM billing_payments WHERE id = $1 AND company_id = $2',
      [paymentId, companyId],
    );
    if (payment.rowCount === 0) throw notFound('PAYMENT_NOT_FOUND', 'Payment not found');
    const allocations = await db.query(
      `SELECT a.*, d.doc_no, d.customer_name FROM billing_payment_allocations a
         JOIN billing_documents d ON d.id = a.invoice_id WHERE a.payment_id = $1`,
      [paymentId],
    );
    return { payment: paymentView(payment.rows[0], allocations.rows) };
  });

  app.post('/companies/:companyId/billing/payments/:paymentId/allocations', async (req, reply) => {
    const user = req.user!;
    const { companyId, paymentId } = req.params as { companyId: string; paymentId: string };
    await requireCompany(db, user.id, companyId, 'billing_clerk', 'billing');
    const body = parse(
      z
        .object({
          invoiceId: z.string().uuid(),
          amount: z.union([z.string().min(1).max(30), z.number()]),
          allocationDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
          reason: z.string().trim().max(1000).optional(),
          confirm: z.literal(true),
        })
        .strict(),
      req.body,
    );
    const result = await allocateBillingPayment(db, companyId, user.id, paymentId, body);
    return reply.code(201).send({
      ...result,
      note: result.reclassRequired
        ? 'The payment is already posted: prepare the separate reclassification proposal before closing the period.'
        : 'The over-payment is now allocated; no revenue or VAT amount was changed.',
    });
  });

  app.delete(
    '/companies/:companyId/billing/payments/:paymentId/allocations/:allocationId',
    async (req) => {
      const user = req.user!;
      const { companyId, paymentId, allocationId } = req.params as {
        companyId: string;
        paymentId: string;
        allocationId: string;
      };
      await requireCompany(db, user.id, companyId, 'billing_clerk', 'billing');
      const body = parse(
        z.object({ reason: z.string().trim().min(1).max(1000) }).strict(),
        req.body,
      );
      return cancelBillingPaymentAllocation(db, companyId, user.id, paymentId, allocationId, body.reason);
    },
  );

  app.post('/companies/:companyId/billing/payments/:paymentId/cancel', async (req) => {
    const user = req.user!;
    const { companyId, paymentId } = req.params as { companyId: string; paymentId: string };
    await requireCompany(db, user.id, companyId, 'billing_clerk', 'billing');
    const result = await db.transaction(async (tx) => {
      const locked = await tx.query<any>(
        'SELECT * FROM billing_payments WHERE id = $1 AND company_id = $2 FOR UPDATE',
        [paymentId, companyId],
      );
      const payment = locked.rows[0];
      if (!payment) throw notFound('PAYMENT_NOT_FOUND', 'Payment not found');
      if (payment.status === 'cancelled') throw conflict('DOCUMENT_STATUS_INVALID', 'Payment already cancelled');
      if (payment.accounting_entry_id) {
        throw conflict(
          'ACCOUNTING_ALREADY_POSTED',
          'This payment is posted to accounting: reverse the journal entry instead of cancelling it',
        );
      }
      const reconciled = await tx.query(
        `SELECT 1 FROM bank_matches
          WHERE billing_payment_id = $1 AND status = 'confirmed' LIMIT 1`,
        [paymentId],
      );
      if (reconciled.rowCount && reconciled.rowCount > 0) {
        throw conflict(
          'PAYMENT_RECONCILED',
          'This payment is linked to a confirmed bank reconciliation: unreconcile it first',
        );
      }
      await tx.query(
        `UPDATE billing_payments SET status = 'cancelled', updated_at = now() WHERE id = $1 AND company_id = $2`,
        [paymentId, companyId],
      );
      const allocations = await tx.query<{ invoice_id: string }>(
        'SELECT invoice_id FROM billing_payment_allocations WHERE payment_id = $1',
        [paymentId],
      );
      for (const row of allocations.rows) {
        await refreshInvoiceBalance(tx, companyId, row.invoice_id);
      }
      await writeAudit(tx, {
        companyId,
        userId: user.id,
        action: 'billing.payment.cancel',
        entityType: 'billing_payment',
        entityId: paymentId,
      });
      return { invoices: allocations.rows.map((r) => r.invoice_id) };
    });
    return { cancelled: true, invoicesRefreshed: result.invoices };
  });

  app.post(
    '/companies/:companyId/billing/payments/:paymentId/allocations/:allocationId/reclass-proposal',
    async (req, reply) => {
      const user = req.user!;
      const { companyId, allocationId } = req.params as {
        companyId: string;
        paymentId: string;
        allocationId: string;
      };
      await requireCompany(db, user.id, companyId, 'accountant', 'billing');
      const { cabinetId } = await cabinetForCompanyUser(db, companyId, user.id);
      const result = await proposeBillingAllocationReclass(db, {
        cabinetId,
        companyId,
        userId: user.id,
        allocationId,
      });
      return reply.code(result.reused ? 200 : 201).send({ ...result, entryCreated: false });
    },
  );

  app.get('/companies/:companyId/billing/payments/:paymentId/receipt.pdf', async (req, reply) => {
    const user = req.user!;
    const { companyId, paymentId } = req.params as { companyId: string; paymentId: string };
    await requireCompany(db, user.id, companyId, 'viewer', 'billing');
    const payment = await db.query<any>(
      'SELECT * FROM billing_payments WHERE id = $1 AND company_id = $2',
      [paymentId, companyId],
    );
    if (payment.rowCount === 0) throw notFound('PAYMENT_NOT_FOUND', 'Payment not found');
    if (payment.rows[0].status !== 'recorded') {
      throw conflict('DOCUMENT_STATUS_INVALID', 'A cancelled payment has no receipt');
    }
    const allocations = await db.query<{
      amount: string;
      doc_no: string | null;
      issue_date: string;
      total_amount: string;
      currency: string;
    }>(
      `SELECT a.amount, d.doc_no, d.issue_date, d.total_amount, d.currency
         FROM billing_payment_allocations a JOIN billing_documents d ON d.id = a.invoice_id
        WHERE a.payment_id = $1 ORDER BY d.doc_no`,
      [paymentId],
    );
    const company = await db.query<any>('SELECT * FROM companies WHERE id = $1', [companyId]);
    const ctx = await loadBillingContext(db, companyId);
    const customer = await loadCustomer(db, companyId, payment.rows[0].customer_id);
    const q = req.query as Record<string, string | undefined>;
    const locale = q.lang === 'en' ? 'en' : 'fr';
    const buffer = await paymentReceiptPdf({
      company: company.rows[0],
      settings: ctx.settings,
      payment: payment.rows[0],
      allocations: allocations.rows,
      customer,
      locale,
    });
    reply.header('content-type', 'application/pdf');
    reply.header(
      'content-disposition',
      `inline; filename="${(payment.rows[0].payment_no ?? 'receipt').replace(/[^A-Za-z0-9_-]/g, '_')}.pdf"`,
    );
    reply.header('cache-control', 'private, no-store');
    return reply.send(buffer);
  });

  // -------------------------------------------------------------------------
  // Aging, overdue and summary
  // -------------------------------------------------------------------------
  app.get('/companies/:companyId/billing/aging', async (req) => {
    const user = req.user!;
    const { companyId } = req.params as { companyId: string };
    await requireCompany(db, user.id, companyId, 'viewer', 'billing');
    const q = req.query as Record<string, string | undefined>;
    const asOf = q.asOf ? parseIsoDate(q.asOf, 'asOf') : today();
    return buildAging(db, companyId, asOf, { customerId: q.customerId });
  });

  app.get('/companies/:companyId/billing/overdue', async (req) => {
    const user = req.user!;
    const { companyId } = req.params as { companyId: string };
    await requireCompany(db, user.id, companyId, 'viewer', 'billing');
    const asOf = today();
    const res = await db.query<any>(
      `SELECT d.*, d.due_date < $2::date AS overdue,
              ($2::date - d.due_date) AS days_late
         FROM billing_documents d
        WHERE d.company_id = $1 AND d.kind = 'invoice'
          AND d.status IN ('issued', 'partially_paid')
          AND d.due_date IS NOT NULL AND d.due_date < $2::date
        ORDER BY d.due_date ASC LIMIT 300`,
      [companyId, asOf],
    );
    const rows = res.rows
      .map((row: any) => ({ ...documentView(row, []), daysLate: Number(row.days_late) }))
      .filter((row) => parseAmount(row.outstanding) > 0n);
    return { asOf, invoices: rows, totalOverdue: formatAmount(rows.reduce((acc, r) => acc + parseAmount(r.outstanding), 0n)) };
  });

  app.get('/companies/:companyId/billing/summary', async (req) => {
    const user = req.user!;
    const { companyId } = req.params as { companyId: string };
    await requireCompany(db, user.id, companyId, 'viewer', 'billing');
    const ctx = await loadBillingContext(db, companyId);
    const counts = await db.query<any>(
      `SELECT kind, status, COUNT(*)::int AS count FROM billing_documents
        WHERE company_id = $1 GROUP BY kind, status ORDER BY kind, status`,
      [companyId],
    );
    const open = await db.query<any>(
      `SELECT currency, COALESCE(SUM(total_amount - amount_paid - credited_amount), 0) AS outstanding
         FROM billing_documents
        WHERE company_id = $1 AND kind = 'invoice' AND status IN ('issued', 'partially_paid')
        GROUP BY currency ORDER BY currency`,
      [companyId],
    );
    const openByCurrency = open.rows.map((r: any) => ({
      currency: r.currency,
      amount: formatAmount(parseAmount(r.outstanding)),
    }));
    const aging = await buildAging(db, companyId, today());
    const entries = await db.query<any>(
      `SELECT COUNT(*)::int AS posted FROM billing_documents
        WHERE company_id = $1 AND accounting_entry_id IS NOT NULL`,
      [companyId],
    );
    const awaiting = await db.query<any>(
      `SELECT COUNT(*)::int AS count FROM billing_documents
        WHERE company_id = $1 AND kind IN ('invoice', 'credit_note')
          AND status NOT IN ('draft', 'cancelled') AND accounting_entry_id IS NULL`,
      [companyId],
    );
    const payments = await db.query<any>(
      `SELECT currency, COUNT(*)::int AS count, COALESCE(SUM(unallocated_amount), 0) AS unallocated
         FROM billing_payments WHERE company_id = $1 AND status = 'recorded'
        GROUP BY currency ORDER BY currency`,
      [companyId],
    );
    const paymentsByCurrency = payments.rows.map((r: any) => ({
      currency: r.currency,
      count: Number(r.count),
      unallocated: formatAmount(parseAmount(r.unallocated)),
    }));
    return {
      available: true,
      counts: counts.rows.map((r: any) => ({ kind: r.kind, status: r.status, count: Number(r.count) })),
      // A single amount only when one currency is open: never add MUR and EUR.
      openReceivables: openByCurrency.length === 1 ? openByCurrency[0]!.amount : null,
      openReceivablesByCurrency: openByCurrency,
      aging: aging.totals,
      agingByCurrency: aging.totalsByCurrency,
      postedDocuments: Number(entries.rows[0]?.posted ?? 0),
      awaitingAccounting: Number(awaiting.rows[0]?.count ?? 0),
      payments: {
        count: paymentsByCurrency.reduce((sum: number, p: any) => sum + p.count, 0),
        unallocated: paymentsByCurrency.length === 1 ? paymentsByCurrency[0]!.unallocated : null,
        byCurrency: paymentsByCurrency,
      },
      capabilities: {
        numbering: true,
        vatComputation: ctx.settings.vat_enabled,
        mraEInvoicing: false,
        postingToAccounting: true,
        postingMode: 'human_validation_required',
        pdf: true,
        multiCurrency: true,
        duplicateDetection: 'deterministic',
        eInvoicingNotice: 'MRA e-invoicing is not implemented and cannot be enabled in this build.',
      },
      currency: ctx.settings.default_currency,
    };
  });
}
