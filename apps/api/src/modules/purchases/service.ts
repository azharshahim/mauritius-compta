import type { Db } from '../../db/index.js';
import { AppError, badRequest, conflict, notFound } from '../../lib/errors.js';
import { writeAudit } from '../../lib/audit.js';
import { formatAmount, parseAmount, parseRate } from '../../lib/money.js';
import {
  accountForRole,
  computeDocument,
  loadBillingContext,
  money,
  type DocumentComputation,
  type VatTreatment,
} from '../billing/service.js';
import { createAsset, getAsset, type AssetInput } from '../fixed-assets/service.js';

/**
 * Purchases & suppliers (mission 11).
 *
 * This is a *subledger*, not a second accounting engine:
 *  - commercial documents and allocations live here;
 *  - every journal entry is created later by `proposals.postProposal`, through
 *    the one `postEntryTx` engine;
 *  - VAT uses the dated, verified configuration of the company. No rate,
 *    recoverability rule or Mauritian tax rule is invented.
 *
 * All money is BigInt scaled by 10^4. No float, no silent rounding.
 */

export interface SupplierRow {
  id: string;
  company_id: string;
  name: string;
  reference: string | null;
  country: string;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  postcode: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  registration_number: string | null;
  tax_number: string | null;
  preferred_currency: string | null;
  payment_terms_days: number | null;
  payable_account_id: string | null;
  notes: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface PurchaseDocumentRow {
  id: string;
  company_id: string;
  supplier_id: string;
  kind: 'invoice' | 'credit_note';
  doc_no: string | null;
  supplier_reference: string;
  issue_date: string;
  received_date: string | null;
  due_date: string | null;
  currency: string;
  exchange_rate: string;
  description: string | null;
  subtotal: string;
  tax_total: string;
  total_amount: string;
  amount_paid: string;
  credited_amount: string;
  status: 'draft' | 'validated' | 'cancelled';
  payment_status: 'unpaid' | 'partial' | 'paid' | 'overpaid';
  source_document_id: string | null;
  reason: string | null;
  warnings: unknown;
  validated_by: string | null;
  validated_at: string | null;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  accounting_entry_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface PurchasePaymentRow {
  id: string;
  company_id: string;
  supplier_id: string;
  payment_no: string | null;
  kind: 'payment' | 'advance';
  payment_date: string;
  value_date: string | null;
  amount: string;
  currency: string;
  exchange_rate: string;
  method: string;
  reference: string | null;
  unallocated_amount: string;
  status: 'recorded' | 'cancelled';
  accounting_entry_id: string | null;
  created_at: string;
}

export interface PurchaseLineInput {
  description: string;
  quantity: string | number;
  unitPrice: string | number;
  accountId: string;
  vatTreatment?: VatTreatment | null;
  vatRateId?: string | null;
  vatRecoverable?: boolean | null;
}

export interface PurchaseDocumentInput {
  kind: 'invoice' | 'credit_note';
  supplierId: string;
  supplierReference: string;
  issueDate: string;
  receivedDate?: string | null;
  dueDate?: string | null;
  currency: string;
  exchangeRate?: string | number | null;
  description?: string | null;
  reason?: string | null;
  sourceDocumentId?: string | null;
  lines: PurchaseLineInput[];
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const CURRENCY_RE = /^[A-Z]{3}$/;

export function amount(value: string | null | undefined): bigint {
  if (value === null || value === undefined) return 0n;
  try {
    return parseAmount(value);
  } catch {
    return 0n;
  }
}

function requireDate(value: string | null | undefined, field: string): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (!DATE_RE.test(value)) {
    throw badRequest('VALIDATION_ERROR', `${field} must be a YYYY-MM-DD date`);
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw badRequest('VALIDATION_ERROR', `${field} is not a valid calendar date`);
  }
  return value;
}

function requireCurrency(value: string, field = 'currency'): string {
  const currency = String(value ?? '').trim().toUpperCase();
  if (!CURRENCY_RE.test(currency)) {
    throw badRequest('VALIDATION_ERROR', `${field} must be a three-letter ISO code`);
  }
  return currency;
}

function positiveMoney(value: string | number, field: string): bigint {
  const parsed = money(value, field);
  if (parsed <= 0n) throw badRequest('VALIDATION_ERROR', `${field} must be greater than zero`);
  return parsed;
}

function normaliseName(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string): number {
  const left = Date.parse(`${from}T00:00:00Z`);
  const right = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(left) || Number.isNaN(right)) return 0;
  return Math.round((right - left) / 86_400_000);
}

export async function recordPurchaseEvent(
  db: Db,
  companyId: string,
  entity: 'supplier' | 'document' | 'payment' | 'allocation',
  entityId: string | null,
  action: string,
  actorId: string | null,
  details: Record<string, unknown> = {},
): Promise<void> {
  await db.query(
    `INSERT INTO purchase_events (company_id, entity, entity_id, action, actor_id, details)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
    [companyId, entity, entityId, action, actorId, JSON.stringify(details)],
  );
}

// ---------------------------------------------------------------------------
// Suppliers
// ---------------------------------------------------------------------------

export async function listSuppliers(
  db: Db,
  companyId: string,
  filters: { search?: string; includeInactive?: boolean; limit?: number } = {},
): Promise<SupplierRow[]> {
  const search = filters.search?.trim() ? `%${filters.search.trim()}%` : null;
  const res = await db.query<SupplierRow>(
    `SELECT * FROM purchase_suppliers
      WHERE company_id = $1
        AND ($2::boolean OR is_active)
        AND ($3::text IS NULL OR name ILIKE $3 OR reference ILIKE $3
             OR registration_number ILIKE $3 OR tax_number ILIKE $3)
      ORDER BY is_active DESC, name
      LIMIT $4`,
    [companyId, filters.includeInactive === true, search, Math.min(filters.limit ?? 200, 500)],
  );
  return res.rows;
}

export async function getSupplier(db: Db, companyId: string, supplierId: string): Promise<SupplierRow> {
  const res = await db.query<SupplierRow>(
    'SELECT * FROM purchase_suppliers WHERE id = $1 AND company_id = $2',
    [supplierId, companyId],
  );
  if (!res.rows[0]) throw notFound('SUPPLIER_NOT_FOUND', 'Supplier not found');
  return res.rows[0];
}

export interface SupplierInput {
  name: string;
  reference?: string | null;
  country?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  postcode?: string | null;
  contactName?: string | null;
  contactPhone?: string | null;
  contactEmail?: string | null;
  registrationNumber?: string | null;
  taxNumber?: string | null;
  preferredCurrency?: string | null;
  paymentTermsDays?: number | null;
  payableAccountId?: string | null;
  notes?: string | null;
  isActive?: boolean;
}

async function assertPayableAccount(
  db: Db,
  companyId: string,
  accountId: string | null | undefined,
): Promise<void> {
  if (!accountId) return;
  const res = await db.query<{ id: string; is_active: boolean }>(
    'SELECT id, is_active FROM accounts WHERE id = $1 AND company_id = $2',
    [accountId, companyId],
  );
  if (!res.rows[0]) throw badRequest('VALIDATION_ERROR', 'The payable account does not belong to this company');
  if (!res.rows[0].is_active) throw conflict('ACCOUNT_INACTIVE', 'The payable account is inactive');
}

export async function supplierDuplicateCheck(
  db: Db,
  companyId: string,
  input: { name?: string; reference?: string | null; registrationNumber?: string | null; excludeId?: string | null },
): Promise<{ duplicates: { id: string; name: string; reference: string | null; reason: string; severity: 'error' | 'warning' }[] }> {
  const name = input.name?.trim() ? normaliseName(input.name) : null;
  const reference = input.reference?.trim() ?? null;
  const registration = input.registrationNumber?.trim() ?? null;
  const rows = await db.query<SupplierRow>(
    `SELECT * FROM purchase_suppliers
      WHERE company_id = $1 AND ($2::uuid IS NULL OR id <> $2::uuid)`,
    [companyId, input.excludeId ?? null],
  );
  const duplicates: { id: string; name: string; reference: string | null; reason: string; severity: 'error' | 'warning' }[] = [];
  for (const row of rows.rows) {
    if (reference && row.reference && row.reference.trim().toLowerCase() === reference.toLowerCase()) {
      duplicates.push({ id: row.id, name: row.name, reference: row.reference, reason: 'REFERENCE_EXISTS', severity: 'error' });
      continue;
    }
    if (
      registration &&
      row.registration_number &&
      row.registration_number.trim().toLowerCase() === registration.toLowerCase()
    ) {
      duplicates.push({ id: row.id, name: row.name, reference: row.reference, reason: 'REGISTRATION_EXISTS', severity: 'error' });
      continue;
    }
    if (name && normaliseName(row.name) === name) {
      duplicates.push({ id: row.id, name: row.name, reference: row.reference, reason: 'NAME_EXACT', severity: 'warning' });
    }
  }
  return { duplicates };
}

export async function createSupplier(
  db: Db,
  companyId: string,
  userId: string,
  input: SupplierInput,
): Promise<SupplierRow> {
  const name = input.name?.trim();
  if (!name) throw badRequest('VALIDATION_ERROR', 'A supplier name is required');
  const reference = input.reference?.trim() || null;
  const registration = input.registrationNumber?.trim() || null;
  const check = await supplierDuplicateCheck(db, companyId, {
    name,
    reference,
    registrationNumber: registration,
  });
  const hard = check.duplicates.filter((d) => d.severity === 'error');
  if (hard.length > 0) {
    throw conflict('SUPPLIER_DUPLICATE', 'A supplier with the same reference or registration number already exists', {
      duplicates: hard,
    });
  }
  await assertPayableAccount(db, companyId, input.payableAccountId);
  const currency = input.preferredCurrency ? requireCurrency(input.preferredCurrency) : null;
  if (input.paymentTermsDays !== undefined && input.paymentTermsDays !== null) {
    if (!Number.isInteger(input.paymentTermsDays) || input.paymentTermsDays < 0 || input.paymentTermsDays > 365) {
      throw badRequest('VALIDATION_ERROR', 'paymentTermsDays must be between 0 and 365');
    }
  }
  const country = (input.country ?? 'MU').trim().toUpperCase().slice(0, 2);
  const res = await db.query<SupplierRow>(
    `INSERT INTO purchase_suppliers
       (company_id, name, reference, country, address_line1, address_line2, city, postcode,
        contact_name, contact_phone, contact_email, registration_number, tax_number,
        preferred_currency, payment_terms_days, payable_account_id, notes, is_active, created_by, updated_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$19)
     RETURNING *`,
    [
      companyId,
      name,
      reference,
      country,
      input.addressLine1 ?? null,
      input.addressLine2 ?? null,
      input.city ?? null,
      input.postcode ?? null,
      input.contactName ?? null,
      input.contactPhone ?? null,
      input.contactEmail ?? null,
      registration,
      input.taxNumber?.trim() || null,
      currency,
      input.paymentTermsDays ?? null,
      input.payableAccountId ?? null,
      input.notes ?? null,
      input.isActive ?? true,
      userId,
    ],
  );
  const supplier = res.rows[0]!;
  await recordPurchaseEvent(db, companyId, 'supplier', supplier.id, 'supplier.created', userId, {
    name: supplier.name,
    reference: supplier.reference,
    country: supplier.country,
  });
  await writeAudit(db, {
    companyId,
    userId,
    action: 'purchases.supplier.create',
    entityType: 'purchase_supplier',
    entityId: supplier.id,
    details: { name: supplier.name, country: supplier.country },
  });
  return supplier;
}

export async function updateSupplier(
  db: Db,
  companyId: string,
  userId: string,
  supplierId: string,
  input: Partial<SupplierInput>,
): Promise<SupplierRow> {
  const current = await getSupplier(db, companyId, supplierId);
  if (input.name !== undefined && !input.name.trim()) {
    throw badRequest('VALIDATION_ERROR', 'A supplier name cannot be empty');
  }
  await assertPayableAccount(db, companyId, input.payableAccountId);
  if (input.paymentTermsDays !== undefined && input.paymentTermsDays !== null) {
    if (!Number.isInteger(input.paymentTermsDays) || input.paymentTermsDays < 0 || input.paymentTermsDays > 365) {
      throw badRequest('VALIDATION_ERROR', 'paymentTermsDays must be between 0 and 365');
    }
  }
  const reference = input.reference === undefined ? current.reference : input.reference?.trim() || null;
  const registration =
    input.registrationNumber === undefined ? current.registration_number : input.registrationNumber?.trim() || null;
  if (input.reference !== undefined || input.registrationNumber !== undefined) {
    const check = await supplierDuplicateCheck(db, companyId, {
      reference,
      registrationNumber: registration,
      excludeId: supplierId,
    });
    const hard = check.duplicates.filter((d) => d.severity === 'error');
    if (hard.length > 0) {
      throw conflict('SUPPLIER_DUPLICATE', 'Another supplier uses this reference or registration number', {
        duplicates: hard,
      });
    }
  }
  const res = await db.query<SupplierRow>(
    `UPDATE purchase_suppliers SET
       name = COALESCE($3, name),
       reference = $4,
       country = COALESCE($5, country),
       address_line1 = $6,
       address_line2 = $7,
       city = $8,
       postcode = $9,
       contact_name = $10,
       contact_phone = $11,
       contact_email = $12,
       registration_number = $13,
       tax_number = $14,
       preferred_currency = $15,
       payment_terms_days = $16,
       payable_account_id = $17,
       notes = $18,
       is_active = COALESCE($19, is_active),
       updated_by = $2,
       updated_at = now()
     WHERE id = $1 AND company_id = $20
     RETURNING *`,
    [
      supplierId,
      userId,
      input.name?.trim() || null,
      reference,
      input.country?.trim().toUpperCase().slice(0, 2) ?? null,
      input.addressLine1 === undefined ? current.address_line1 : input.addressLine1,
      input.addressLine2 === undefined ? current.address_line2 : input.addressLine2,
      input.city === undefined ? current.city : input.city,
      input.postcode === undefined ? current.postcode : input.postcode,
      input.contactName === undefined ? current.contact_name : input.contactName,
      input.contactPhone === undefined ? current.contact_phone : input.contactPhone,
      input.contactEmail === undefined ? current.contact_email : input.contactEmail,
      registration,
      input.taxNumber === undefined ? current.tax_number : input.taxNumber?.trim() || null,
      input.preferredCurrency === undefined
        ? current.preferred_currency
        : input.preferredCurrency
          ? requireCurrency(input.preferredCurrency)
          : null,
      input.paymentTermsDays === undefined ? current.payment_terms_days : input.paymentTermsDays,
      input.payableAccountId === undefined ? current.payable_account_id : input.payableAccountId,
      input.notes === undefined ? current.notes : input.notes,
      input.isActive === undefined ? null : input.isActive,
      companyId,
    ],
  );
  const supplier = res.rows[0]!;
  await recordPurchaseEvent(db, companyId, 'supplier', supplier.id, 'supplier.updated', userId, {
    fields: Object.keys(input),
  });
  await writeAudit(db, {
    companyId,
    userId,
    action: 'purchases.supplier.update',
    entityType: 'purchase_supplier',
    entityId: supplier.id,
    details: { fields: Object.keys(input) },
  });
  return supplier;
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

export interface PurchaseLineView {
  id: string;
  lineNo: number;
  description: string;
  quantity: string;
  unitPrice: string;
  accountId: string;
  accountCode: string;
  accountName: string;
  vatTreatment: VatTreatment;
  vatRate: string | null;
  vatRateId: string | null;
  netAmount: string;
  taxAmount: string;
  lineTotal: string;
  vatRecoverable: boolean | null;
}

export interface PurchaseDocumentView extends PurchaseDocumentRow {
  supplier_name: string;
  supplier_reference_internal: string | null;
  supplier_country: string;
  outstanding_amount: string;
  credit_available: string;
  lines: PurchaseLineView[];
  supplier_reference_number?: string | null;
}

async function nextPurchaseNumber(
  db: Db,
  companyId: string,
  kind: 'invoice' | 'credit_note' | 'payment',
  day: string,
): Promise<string> {
  const year = Number(day.slice(0, 4));
  const res = await db.query<{ last_no: number }>(
    `INSERT INTO purchase_number_sequences (company_id, kind, year, last_no)
     VALUES ($1,$2,$3,1)
     ON CONFLICT (company_id, kind, year)
     DO UPDATE SET last_no = purchase_number_sequences.last_no + 1
     RETURNING last_no`,
    [companyId, kind, year],
  );
  const no = res.rows[0]!.last_no;
  const prefix = kind === 'invoice' ? 'ACH' : kind === 'credit_note' ? 'AVF' : 'RF';
  return `${prefix}-${year}-${String(no).padStart(4, '0')}`;
}

async function assertPurchaseAccount(
  db: Db,
  companyId: string,
  accountId: string,
): Promise<{ id: string; type: string; is_active: boolean }> {
  const res = await db.query<{ id: string; type: string; is_active: boolean }>(
    'SELECT id, type, is_active FROM accounts WHERE id = $1 AND company_id = $2',
    [accountId, companyId],
  );
  const row = res.rows[0];
  if (!row) throw badRequest('VALIDATION_ERROR', 'A line account does not belong to this company');
  if (!row.is_active) throw conflict('ACCOUNT_INACTIVE', 'A line account is inactive');
  if (row.type === 'revenue' || row.type === 'equity') {
    throw badRequest(
      'PURCHASE_ACCOUNT_INVALID',
      'A purchase line cannot be posted to a revenue or equity account',
    );
  }
  return row;
}

async function resolveExchangeRate(
  db: Db,
  companyId: string,
  currency: string,
  provided: string | number | null | undefined,
): Promise<{ rate: string; foreign: boolean }> {
  const company = await db.query<{ functional_currency: string }>(
    'SELECT functional_currency FROM companies WHERE id = $1',
    [companyId],
  );
  const functional = company.rows[0]?.functional_currency ?? 'MUR';
  const foreign = currency !== functional;
  if (!provided || String(provided).trim() === '') {
    if (foreign) {
      throw conflict(
        'PURCHASE_EXCHANGE_RATE_REQUIRED',
        `A foreign-currency document (${currency}) requires an explicit exchange rate to ${functional}`,
      );
    }
    return { rate: '1', foreign };
  }
  const raw = String(provided).trim();
  if (!/^\d{1,10}(\.\d{0,8})?$/.test(raw)) {
    throw badRequest('VALIDATION_ERROR', 'exchangeRate must be a positive decimal with at most 8 decimals');
  }
  const scaled = parseRate(raw);
  if (scaled <= 0n) throw badRequest('VALIDATION_ERROR', 'exchangeRate must be positive');
  if (!foreign && scaled !== parseRate('1')) {
    throw conflict(
      'PURCHASE_EXCHANGE_RATE_INVALID',
      `The document is already in the functional currency (${functional}); its rate must be 1`,
    );
  }
  return { rate: raw, foreign };
}

interface ComputedDocument {
  computed: DocumentComputation;
  accounts: { id: string; type: string }[];
  recoverable: (boolean | null)[];
}

async function computePurchase(
  db: Db,
  companyId: string,
  input: PurchaseDocumentInput,
  issueDate: string,
  currency: string,
): Promise<ComputedDocument> {
  if (!Array.isArray(input.lines) || input.lines.length === 0) {
    throw badRequest('VALIDATION_ERROR', 'A purchase document needs at least one line');
  }
  if (input.lines.length > 200) throw badRequest('VALIDATION_ERROR', 'Too many lines (max 200)');
  const billingCtx = await loadBillingContext(db, companyId);
  const accounts: { id: string; type: string }[] = [];
  const recoverable: (boolean | null)[] = [];
  for (const [index, line] of input.lines.entries()) {
    const account = await assertPurchaseAccount(db, companyId, line.accountId);
    accounts.push({ id: account.id, type: account.type });
    if (line.vatRecoverable !== undefined && line.vatRecoverable !== null && typeof line.vatRecoverable !== 'boolean') {
      throw badRequest('VALIDATION_ERROR', `lines.${index}.vatRecoverable must be a boolean`);
    }
    recoverable.push(line.vatRecoverable ?? null);
  }
  const computed = computeDocument(
    input.lines.map((line) => ({
      description: line.description,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      vatTreatment: line.vatTreatment ?? null,
      vatRateId: line.vatRateId ?? null,
      revenueAccountId: line.accountId,
    })),
    {
      companyId,
      issueDate,
      currency,
      vatEnabled: billingCtx.settings.vat_enabled,
      taxRates: billingCtx.taxRates,
      items: new Map(),
      defaultRevenueAccountId: null,
    },
  );
  for (const [index, line] of computed.lines.entries()) {
    if (line.taxAmount > 0n && recoverable[index] === null) {
      throw conflict(
        'PURCHASE_VAT_RECOVERABILITY_REQUIRED',
        `Line ${index + 1} carries tax: state explicitly whether the input VAT is recoverable`,
      );
    }
    if (line.taxAmount === 0n && recoverable[index] === true) {
      throw badRequest('VALIDATION_ERROR', `Line ${index + 1} has no tax and cannot be marked recoverable`);
    }
  }
  return { computed, accounts, recoverable };
}

async function insertLines(
  db: Db,
  companyId: string,
  documentId: string,
  computed: ComputedDocument,
): Promise<void> {
  for (const [index, line] of computed.computed.lines.entries()) {
    await db.query(
      `INSERT INTO purchase_document_lines
         (document_id, company_id, line_no, description, quantity, unit_price, account_id,
          vat_treatment, vat_rate, vat_rate_id, net_amount, tax_amount, line_total, vat_recoverable)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [
        documentId,
        companyId,
        line.lineNo,
        line.description,
        formatAmount(line.quantity),
        formatAmount(line.unitPrice),
        computed.accounts[index]!.id,
        line.vatTreatment,
        line.vatRate === null ? null : formatAmount(line.vatRate),
        line.vatRateId,
        formatAmount(line.netAmount),
        formatAmount(line.taxAmount),
        formatAmount(line.lineTotal),
        computed.recoverable[index],
      ],
    );
  }
}

export async function purchaseDocumentDuplicateCheck(
  db: Db,
  companyId: string,
  input: {
    supplierId: string;
    supplierReference: string;
    kind?: 'invoice' | 'credit_note';
    total?: string | null;
    issueDate?: string | null;
    excludeId?: string | null;
  },
): Promise<{ duplicates: { id: string; docNo: string | null; supplierReference: string; reason: string; severity: 'error' | 'warning' }[] }> {
  const kind = input.kind ?? 'invoice';
  const rows = await db.query<PurchaseDocumentRow>(
    `SELECT * FROM purchase_documents
      WHERE company_id = $1 AND supplier_id = $2 AND kind = $3 AND status <> 'cancelled'
        AND ($4::uuid IS NULL OR id <> $4::uuid)`,
    [companyId, input.supplierId, kind, input.excludeId ?? null],
  );
  const reference = input.supplierReference.trim().toLowerCase();
  const total = input.total ? amount(input.total) : null;
  const duplicates: { id: string; docNo: string | null; supplierReference: string; reason: string; severity: 'error' | 'warning' }[] = [];
  for (const row of rows.rows) {
    if (row.supplier_reference.trim().toLowerCase() === reference) {
      duplicates.push({
        id: row.id,
        docNo: row.doc_no,
        supplierReference: row.supplier_reference,
        reason: 'SUPPLIER_REFERENCE_EXISTS',
        severity: 'error',
      });
      continue;
    }
    if (total !== null && amount(row.total_amount) === total && input.issueDate && row.issue_date === input.issueDate) {
      duplicates.push({
        id: row.id,
        docNo: row.doc_no,
        supplierReference: row.supplier_reference,
        reason: 'SAME_AMOUNT_AND_DATE',
        severity: 'warning',
      });
    }
  }
  return { duplicates };
}

export async function createPurchaseDocument(
  db: Db,
  companyId: string,
  userId: string,
  input: PurchaseDocumentInput,
): Promise<PurchaseDocumentView> {
  if (input.kind !== 'invoice' && input.kind !== 'credit_note') {
    throw badRequest('VALIDATION_ERROR', 'kind must be invoice or credit_note');
  }
  const supplier = await getSupplier(db, companyId, input.supplierId);
  if (!supplier.is_active) throw conflict('SUPPLIER_INACTIVE', 'An inactive supplier cannot receive a new document');
  const reference = input.supplierReference?.trim();
  if (!reference) throw badRequest('VALIDATION_ERROR', 'A supplier reference is required');
  const issueDate = requireDate(input.issueDate, 'issueDate')!;
  const receivedDate = requireDate(input.receivedDate, 'receivedDate');
  const dueDate = requireDate(input.dueDate, 'dueDate');
  if (input.kind === 'invoice' && !dueDate) {
    throw badRequest('VALIDATION_ERROR', 'An invoice requires a due date');
  }
  const currency = requireCurrency(input.currency);
  const { rate } = await resolveExchangeRate(db, companyId, currency, input.exchangeRate);
  if (input.kind === 'credit_note' && input.sourceDocumentId) {
    const source = await db.query<PurchaseDocumentRow>(
      'SELECT * FROM purchase_documents WHERE id = $1 AND company_id = $2',
      [input.sourceDocumentId, companyId],
    );
    const invoice = source.rows[0];
    if (!invoice || invoice.kind !== 'invoice') {
      throw badRequest('VALIDATION_ERROR', 'The source document must be a supplier invoice of this company');
    }
    if (invoice.supplier_id !== supplier.id) {
      throw conflict('PURCHASE_SUPPLIER_MISMATCH', 'The credit note and its invoice must belong to the same supplier');
    }
    if (invoice.currency !== currency) {
      throw conflict('PURCHASE_CURRENCY_MISMATCH', 'The credit note must use the invoice currency');
    }
  }
  const duplicate = await purchaseDocumentDuplicateCheck(db, companyId, {
    supplierId: supplier.id,
    supplierReference: reference,
    kind: input.kind,
  });
  if (duplicate.duplicates.some((d) => d.severity === 'error')) {
    throw conflict('PURCHASE_DUPLICATE', 'This supplier reference already exists for this supplier', {
      duplicates: duplicate.duplicates,
    });
  }
  const computation = await computePurchase(db, companyId, input, issueDate, currency);
  const computed = computation.computed;
  if (computed.total <= 0n) {
    throw badRequest('VALIDATION_ERROR', 'The document total must be greater than zero');
  }
  let document: PurchaseDocumentRow;
  try {
    const inserted = await db.query<PurchaseDocumentRow>(
      `INSERT INTO purchase_documents
         (company_id, supplier_id, kind, supplier_reference, issue_date, received_date, due_date,
          currency, exchange_rate, description, subtotal, tax_total, total_amount, status,
          source_document_id, reason, warnings, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'draft',$14,$15,$16::jsonb,$17,$17)
       RETURNING *`,
      [
        companyId,
        supplier.id,
        input.kind,
        reference,
        issueDate,
        receivedDate,
        dueDate,
        currency,
        rate,
        input.description ?? null,
        formatAmount(computed.subtotal - computed.discountTotal),
        formatAmount(computed.taxTotal),
        formatAmount(computed.total),
        input.sourceDocumentId ?? null,
        input.reason ?? null,
        JSON.stringify(computed.warnings),
        userId,
      ],
    );
    document = inserted.rows[0]!;
  } catch (err) {
    if (err && typeof err === 'object' && 'code' in err && (err as { code?: string }).code === '23505') {
      throw conflict('PURCHASE_DUPLICATE', 'This supplier reference already exists for this supplier');
    }
    throw err;
  }
  await insertLines(db, companyId, document.id, computation);
  await recordPurchaseEvent(db, companyId, 'document', document.id, 'document.created', userId, {
    kind: document.kind,
    supplierReference: reference,
    total: document.total_amount,
    currency,
  });
  await writeAudit(db, {
    companyId,
    userId,
    action: 'purchases.document.create',
    entityType: 'purchase_document',
    entityId: document.id,
    details: { kind: document.kind, total: document.total_amount, currency },
  });
  return getPurchaseDocument(db, companyId, document.id);
}

export async function updatePurchaseDocument(
  db: Db,
  companyId: string,
  userId: string,
  documentId: string,
  input: PurchaseDocumentInput,
): Promise<PurchaseDocumentView> {
  const existing = await db.query<PurchaseDocumentRow>(
    'SELECT * FROM purchase_documents WHERE id = $1 AND company_id = $2 FOR UPDATE',
    [documentId, companyId],
  );
  const current = existing.rows[0];
  if (!current) throw notFound('PURCHASE_DOCUMENT_NOT_FOUND', 'Purchase document not found');
  if (current.status !== 'draft') {
    throw conflict('PURCHASE_DOCUMENT_LOCKED', 'Only a draft purchase document can be edited');
  }
  if (input.kind !== current.kind) throw badRequest('VALIDATION_ERROR', 'The document kind cannot be changed');
  if (current.supplier_id !== input.supplierId) {
    throw badRequest('VALIDATION_ERROR', 'The supplier of a draft cannot be changed; cancel and recreate it');
  }
  const supplier = await getSupplier(db, companyId, input.supplierId);
  const reference = input.supplierReference?.trim();
  if (!reference) throw badRequest('VALIDATION_ERROR', 'A supplier reference is required');
  const issueDate = requireDate(input.issueDate, 'issueDate')!;
  const receivedDate = requireDate(input.receivedDate, 'receivedDate');
  const dueDate = requireDate(input.dueDate, 'dueDate');
  if (input.kind === 'invoice' && !dueDate) throw badRequest('VALIDATION_ERROR', 'An invoice requires a due date');
  const currency = requireCurrency(input.currency);
  const { rate } = await resolveExchangeRate(db, companyId, currency, input.exchangeRate);
  if (input.kind === 'credit_note' && input.sourceDocumentId) {
    const source = await db.query<PurchaseDocumentRow>(
      'SELECT * FROM purchase_documents WHERE id = $1 AND company_id = $2',
      [input.sourceDocumentId, companyId],
    );
    const invoice = source.rows[0];
    if (!invoice || invoice.kind !== 'invoice') {
      throw badRequest('VALIDATION_ERROR', 'The source document must be a supplier invoice of this company');
    }
    if (invoice.supplier_id !== supplier.id) {
      throw conflict('PURCHASE_SUPPLIER_MISMATCH', 'The credit note and its invoice must belong to the same supplier');
    }
    if (invoice.currency !== currency) {
      throw conflict('PURCHASE_CURRENCY_MISMATCH', 'The credit note must use the invoice currency');
    }
  }
  const duplicate = await purchaseDocumentDuplicateCheck(db, companyId, {
    supplierId: supplier.id,
    supplierReference: reference,
    kind: input.kind,
    excludeId: documentId,
  });
  if (duplicate.duplicates.some((d) => d.severity === 'error')) {
    throw conflict('PURCHASE_DUPLICATE', 'This supplier reference already exists for this supplier', {
      duplicates: duplicate.duplicates,
    });
  }
  const computation = await computePurchase(db, companyId, input, issueDate, currency);
  const computed = computation.computed;
  if (computed.total <= 0n) throw badRequest('VALIDATION_ERROR', 'The document total must be greater than zero');
  await db.query(
    `UPDATE purchase_documents SET
       supplier_reference = $3, issue_date = $4, received_date = $5, due_date = $6,
       currency = $7, exchange_rate = $8, description = $9, subtotal = $10, tax_total = $11,
       total_amount = $12, source_document_id = $13, reason = $14, warnings = $15::jsonb,
       updated_by = $2, updated_at = now()
     WHERE id = $1 AND company_id = $16`,
    [
      documentId,
      userId,
      reference,
      issueDate,
      receivedDate,
      dueDate,
      currency,
      rate,
      input.description ?? null,
      formatAmount(computed.subtotal - computed.discountTotal),
      formatAmount(computed.taxTotal),
      formatAmount(computed.total),
      input.sourceDocumentId ?? null,
      input.reason ?? null,
      JSON.stringify(computed.warnings),
      companyId,
    ],
  );
  await db.query('DELETE FROM purchase_document_lines WHERE document_id = $1 AND company_id = $2', [
    documentId,
    companyId,
  ]);
  await insertLines(db, companyId, documentId, computation);
  await recordPurchaseEvent(db, companyId, 'document', documentId, 'document.updated', userId, {
    total: formatAmount(computed.total),
    currency,
  });
  return getPurchaseDocument(db, companyId, documentId);
}

export async function getPurchaseDocument(
  db: Db,
  companyId: string,
  documentId: string,
): Promise<PurchaseDocumentView> {
  const res = await db.query<PurchaseDocumentRow & { supplier_name: string; supplier_internal_reference: string | null; supplier_country: string }>(
    `SELECT d.*, s.name AS supplier_name, s.reference AS supplier_internal_reference, s.country AS supplier_country
       FROM purchase_documents d
       JOIN purchase_suppliers s ON s.id = d.supplier_id AND s.company_id = d.company_id
      WHERE d.id = $1 AND d.company_id = $2`,
    [documentId, companyId],
  );
  const row = res.rows[0];
  if (!row) throw notFound('PURCHASE_DOCUMENT_NOT_FOUND', 'Purchase document not found');
  const lines = await db.query<any>(
    `SELECT l.*, a.code AS account_code, a.name AS account_name
       FROM purchase_document_lines l
       JOIN accounts a ON a.id = l.account_id AND a.company_id = $2
      WHERE l.document_id = $1
      ORDER BY l.line_no`,
    [documentId, companyId],
  );
  const creditUsed = await db.query<{ total: string }>(
    `SELECT COALESCE(SUM(amount), 0)::text AS total
       FROM purchase_credit_allocations
      WHERE credit_note_id = $1 AND cancelled_at IS NULL`,
    [documentId],
  );
  const paid = amount(row.amount_paid);
  const credited = amount(row.credited_amount);
  const total = amount(row.total_amount);
  const outstanding = total - paid - credited;
  return {
    ...row,
    supplier_reference_internal: row.supplier_internal_reference,
    outstanding_amount: formatAmount(outstanding > 0n ? outstanding : 0n),
    credit_available:
      row.kind === 'credit_note'
        ? formatAmount(total - amount(creditUsed.rows[0]?.total) > 0n ? total - amount(creditUsed.rows[0]?.total) : 0n)
        : '0.0000',
    lines: lines.rows.map((line) => ({
      id: line.id,
      lineNo: line.line_no,
      description: line.description,
      quantity: line.quantity,
      unitPrice: line.unit_price,
      accountId: line.account_id,
      accountCode: line.account_code,
      accountName: line.account_name,
      vatTreatment: line.vat_treatment,
      vatRate: line.vat_rate,
      vatRateId: line.vat_rate_id,
      netAmount: line.net_amount,
      taxAmount: line.tax_amount,
      lineTotal: line.line_total,
      vatRecoverable: line.vat_recoverable,
      fixedAssetId: line.fixed_asset_id,
      fixedAssetCode: line.fixed_asset_code,
    })),
  };
}

export async function listPurchaseDocuments(
  db: Db,
  companyId: string,
  filters: {
    kind?: 'invoice' | 'credit_note';
    supplierId?: string;
    status?: string;
    from?: string;
    to?: string;
    currency?: string;
    dueOnly?: boolean;
    limit?: number;
  } = {},
): Promise<PurchaseDocumentView[]> {
  const res = await db.query<PurchaseDocumentRow & { supplier_name: string; supplier_country: string; supplier_internal_reference: string | null; credit_used: string }>(
    `SELECT d.*, s.name AS supplier_name, s.country AS supplier_country,
            s.reference AS supplier_internal_reference,
            COALESCE((SELECT SUM(a.amount) FROM purchase_credit_allocations a
                       WHERE a.credit_note_id = d.id AND a.cancelled_at IS NULL), 0)::text AS credit_used
       FROM purchase_documents d
       JOIN purchase_suppliers s ON s.id = d.supplier_id AND s.company_id = d.company_id
      WHERE d.company_id = $1
        AND ($2::text IS NULL OR d.kind = $2)
        AND ($3::uuid IS NULL OR d.supplier_id = $3::uuid)
        AND ($4::text IS NULL OR d.status = $4)
        AND ($5::date IS NULL OR d.issue_date >= $5::date)
        AND ($6::date IS NULL OR d.issue_date <= $6::date)
        AND ($7::text IS NULL OR d.currency = $7)
        AND ($8::boolean IS NOT TRUE OR (d.kind = 'invoice' AND d.status = 'validated'
             AND d.total_amount - d.amount_paid - d.credited_amount > 0))
      ORDER BY d.issue_date DESC, d.created_at DESC
      LIMIT $9`,
    [
      companyId,
      filters.kind ?? null,
      filters.supplierId ?? null,
      filters.status ?? null,
      filters.from ?? null,
      filters.to ?? null,
      filters.currency ?? null,
      filters.dueOnly === true,
      Math.min(filters.limit ?? 200, 500),
    ],
  );
  const documents: PurchaseDocumentView[] = [];
  for (const row of res.rows) {
    documents.push({
      ...row,
      supplier_reference_internal: row.supplier_internal_reference,
      outstanding_amount: formatAmount(
        amount(row.total_amount) - amount(row.amount_paid) - amount(row.credited_amount) > 0n
          ? amount(row.total_amount) - amount(row.amount_paid) - amount(row.credited_amount)
          : 0n,
      ),
      credit_available:
        row.kind === 'credit_note'
          ? formatAmount(
              amount(row.total_amount) - amount(row.credit_used) > 0n
                ? amount(row.total_amount) - amount(row.credit_used)
                : 0n,
            )
          : '0.0000',
      lines: [],
    });
  }
  return documents;
}

export async function refreshPurchaseInvoiceBalance(
  db: Db,
  companyId: string,
  invoiceId: string,
): Promise<PurchaseDocumentRow> {
  const paid = await db.query<{ total: string }>(
    `SELECT COALESCE(SUM(amount), 0)::text AS total
       FROM purchase_payment_allocations
      WHERE invoice_id = $1 AND company_id = $2 AND cancelled_at IS NULL`,
    [invoiceId, companyId],
  );
  const credited = await db.query<{ total: string }>(
    `SELECT COALESCE(SUM(amount), 0)::text AS total
       FROM purchase_credit_allocations
      WHERE invoice_id = $1 AND company_id = $2 AND cancelled_at IS NULL`,
    [invoiceId, companyId],
  );
  const doc = await db.query<PurchaseDocumentRow>(
    'SELECT * FROM purchase_documents WHERE id = $1 AND company_id = $2 FOR UPDATE',
    [invoiceId, companyId],
  );
  const row = doc.rows[0];
  if (!row) throw notFound('PURCHASE_DOCUMENT_NOT_FOUND', 'Purchase document not found');
  const settled = amount(paid.rows[0]?.total) + amount(credited.rows[0]?.total);
  const total = amount(row.total_amount);
  const paymentStatus =
    settled <= 0n ? 'unpaid' : settled < total ? 'partial' : amount(paid.rows[0]?.total) > total ? 'overpaid' : 'paid';
  const updated = await db.query<PurchaseDocumentRow>(
    `UPDATE purchase_documents
        SET amount_paid = $3, credited_amount = $4, payment_status = $5, updated_at = now()
      WHERE id = $1 AND company_id = $2 AND kind = 'invoice'
      RETURNING *`,
    [invoiceId, companyId, paid.rows[0]?.total ?? '0', credited.rows[0]?.total ?? '0', paymentStatus],
  );
  return updated.rows[0] ?? row;
}

export async function validatePurchaseDocument(
  db: Db,
  companyId: string,
  userId: string,
  documentId: string,
): Promise<PurchaseDocumentView> {
  const result = await db.transaction(async (tx) => validatePurchaseDocumentTx(tx, companyId, userId, documentId));
  if (result.kind === 'invoice') await refreshPurchaseInvoiceBalance(db, companyId, result.id);
  return getPurchaseDocument(db, companyId, result.id);
}

/**
 * Validation body usable inside an existing transaction. Mission 42 needs it
 * for the OCR conversion, which must stay atomic without opening a nested
 * transaction (unsupported and deadlocking on some drivers).
 */
export async function validatePurchaseDocumentTx(
  tx: Db,
  companyId: string,
  userId: string,
  documentId: string,
): Promise<PurchaseDocumentRow> {
  {
    const locked = await tx.query<PurchaseDocumentRow>(
      'SELECT * FROM purchase_documents WHERE id = $1 AND company_id = $2 FOR UPDATE',
      [documentId, companyId],
    );
    const doc = locked.rows[0];
    if (!doc) throw notFound('PURCHASE_DOCUMENT_NOT_FOUND', 'Purchase document not found');
    if (doc.status === 'validated') return doc;
    if (doc.status !== 'draft') throw conflict('PURCHASE_DOCUMENT_LOCKED', 'A cancelled document cannot be validated');
    const supplier = await getSupplier(tx, companyId, doc.supplier_id);
    if (!supplier.is_active) throw conflict('SUPPLIER_INACTIVE', 'The supplier is inactive');
    const lineCount = await tx.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM purchase_document_lines WHERE document_id = $1 AND company_id = $2',
      [documentId, companyId],
    );
    if (Number(lineCount.rows[0]?.count ?? 0) === 0) {
      throw conflict('PURCHASE_DOCUMENT_EMPTY', 'A document without lines cannot be validated');
    }
    if (doc.kind === 'invoice' && !doc.due_date) {
      throw conflict('PURCHASE_DUE_DATE_REQUIRED', 'An invoice requires a due date');
    }
    const number = await nextPurchaseNumber(tx, companyId, doc.kind, doc.issue_date);
    const updated = await tx.query<PurchaseDocumentRow>(
      `UPDATE purchase_documents
          SET doc_no = COALESCE(doc_no, $3), status = 'validated', validated_by = $4,
              validated_at = now(), updated_by = $4, updated_at = now()
        WHERE id = $1 AND company_id = $2 AND status = 'draft'
        RETURNING *`,
      [documentId, companyId, number, userId],
    );
    if (!updated.rows[0]) throw conflict('PURCHASE_DOCUMENT_LOCKED', 'The document changed during validation');
    await recordPurchaseEvent(tx, companyId, 'document', documentId, 'document.validated', userId, {
      docNo: number,
    });
    await writeAudit(tx, {
      companyId,
      userId,
      action: 'purchases.document.validate',
      entityType: 'purchase_document',
      entityId: documentId,
      details: { docNo: number, kind: doc.kind, total: doc.total_amount },
    });
    return updated.rows[0]!;
  }
}

export async function cancelPurchaseDocument(
  db: Db,
  companyId: string,
  userId: string,
  documentId: string,
  reason: string,
): Promise<PurchaseDocumentView> {
  if (!reason.trim()) throw badRequest('VALIDATION_ERROR', 'A cancellation reason is required');
  await db.transaction(async (tx) => {
    const locked = await tx.query<PurchaseDocumentRow>(
      'SELECT * FROM purchase_documents WHERE id = $1 AND company_id = $2 FOR UPDATE',
      [documentId, companyId],
    );
    const doc = locked.rows[0];
    if (!doc) throw notFound('PURCHASE_DOCUMENT_NOT_FOUND', 'Purchase document not found');
    if (doc.status === 'cancelled') return;
    if (doc.accounting_entry_id) {
      throw conflict(
        'PURCHASE_ACCOUNTING_POSTED',
        'This document is posted to accounting: prepare a reversal or correction instead of cancelling it',
      );
    }
    const bank = await tx.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM bank_matches
        WHERE company_id = $1 AND purchase_invoice_id = $2 AND status = 'confirmed'`,
      [companyId, documentId],
    );
    if (Number(bank.rows[0]?.count ?? 0) > 0) {
      throw conflict('PURCHASE_BANK_RECONCILED', 'Remove the confirmed bank reconciliation first');
    }
    if (doc.kind === 'invoice') {
      const allocations = await tx.query<{ total: string }>(
        `SELECT (SELECT COALESCE(SUM(amount),0) FROM purchase_payment_allocations
                  WHERE invoice_id = $1 AND cancelled_at IS NULL)
              + (SELECT COALESCE(SUM(amount),0) FROM purchase_credit_allocations
                  WHERE invoice_id = $1 AND cancelled_at IS NULL) AS total::text`,
        [documentId],
      );
      if (amount(allocations.rows[0]?.total) > 0n) {
        throw conflict('PURCHASE_HAS_ALLOCATIONS', 'Cancel the supplier payments or credit allocations first');
      }
    } else {
      const used = await tx.query<{ total: string }>(
        `SELECT COALESCE(SUM(amount),0)::text AS total FROM purchase_credit_allocations
          WHERE credit_note_id = $1 AND cancelled_at IS NULL`,
        [documentId],
      );
      if (amount(used.rows[0]?.total) > 0n) {
        throw conflict('PURCHASE_HAS_ALLOCATIONS', 'Remove the credit allocations first');
      }
    }
    await tx.query(
      `UPDATE purchase_documents
          SET status = 'cancelled', cancelled_by = $3, cancelled_at = now(),
              cancellation_reason = $4, updated_by = $3, updated_at = now()
        WHERE id = $1 AND company_id = $2`,
      [documentId, companyId, userId, reason.trim()],
    );
    await recordPurchaseEvent(tx, companyId, 'document', documentId, 'document.cancelled', userId, {
      reason: reason.trim(),
    });
    await writeAudit(tx, {
      companyId,
      userId,
      action: 'purchases.document.cancel',
      entityType: 'purchase_document',
      entityId: documentId,
      details: { reason: reason.trim() },
    });
  });
  return getPurchaseDocument(db, companyId, documentId);
}

export async function listPurchaseDocumentEvents(
  db: Db,
  companyId: string,
  documentId: string,
): Promise<Record<string, unknown>[]> {
  await getPurchaseDocument(db, companyId, documentId);
  const res = await db.query<Record<string, unknown>>(
    `SELECT e.*, u.email AS actor_email
       FROM purchase_events e
       LEFT JOIN app_users u ON u.id = e.actor_id
      WHERE e.company_id = $1 AND e.entity = 'document' AND e.entity_id = $2
      ORDER BY e.created_at DESC`,
    [companyId, documentId],
  );
  return res.rows;
}

// ---------------------------------------------------------------------------
// Supplier payments and allocations
// ---------------------------------------------------------------------------

export interface PurchasePaymentAllocationView {
  id: string;
  invoiceId: string;
  invoiceNumber: string | null;
  supplierReference: string;
  amount: string;
  invoiceTotal: string;
  invoicePaid: string;
  invoiceCredited: string;
  invoiceOutstanding: string;
  currency: string;
  allocatedDate: string | null;
  reclassEntryId: string | null;
  cancelledAt: string | null;
}

export interface PurchasePaymentView extends PurchasePaymentRow {
  supplier_name: string;
  supplier_country: string;
  allocations: PurchasePaymentAllocationView[];
}

export interface PurchasePaymentInput {
  supplierId: string;
  kind?: 'payment' | 'advance';
  paymentDate: string;
  valueDate?: string | null;
  amount: string | number;
  currency: string;
  exchangeRate?: string | number | null;
  method?: 'bank_transfer' | 'cheque' | 'cash' | 'card' | 'other';
  reference?: string | null;
  allocations?: { invoiceId: string; amount: string | number }[];
}

async function loadPaymentAllocations(
  db: Db,
  companyId: string,
  paymentId: string,
): Promise<PurchasePaymentAllocationView[]> {
  const res = await db.query<any>(
    `SELECT a.id, a.invoice_id, a.amount::text, a.allocated_date, a.cancelled_at,
            a.reclass_entry_id, d.doc_no, d.supplier_reference,
            d.total_amount::text, d.amount_paid::text, d.credited_amount::text, d.currency
       FROM purchase_payment_allocations a
       JOIN purchase_documents d ON d.id = a.invoice_id AND d.company_id = $2
      WHERE a.payment_id = $1
      ORDER BY d.issue_date, d.doc_no`,
    [paymentId, companyId],
  );
  return res.rows.map((row) => {
    const total = amount(row.total_amount);
    const paid = amount(row.amount_paid);
    const credited = amount(row.credited_amount);
    const outstanding = total - paid - credited;
    return {
      id: row.id,
      invoiceId: row.invoice_id,
      invoiceNumber: row.doc_no,
      supplierReference: row.supplier_reference,
      amount: row.amount,
      invoiceTotal: row.total_amount,
      invoicePaid: row.amount_paid,
      invoiceCredited: row.credited_amount,
      invoiceOutstanding: formatAmount(outstanding > 0n ? outstanding : 0n),
      currency: row.currency,
      allocatedDate: row.allocated_date,
      reclassEntryId: row.reclass_entry_id,
      cancelledAt: row.cancelled_at,
    };
  });
}

export async function getPurchasePayment(
  db: Db,
  companyId: string,
  paymentId: string,
): Promise<PurchasePaymentView> {
  const res = await db.query<PurchasePaymentRow & { supplier_name: string; supplier_country: string }>(
    `SELECT p.*, s.name AS supplier_name, s.country AS supplier_country
       FROM purchase_payments p
       JOIN purchase_suppliers s ON s.id = p.supplier_id AND s.company_id = p.company_id
      WHERE p.id = $1 AND p.company_id = $2`,
    [paymentId, companyId],
  );
  const row = res.rows[0];
  if (!row) throw notFound('PURCHASE_PAYMENT_NOT_FOUND', 'Supplier payment not found');
  return { ...row, allocations: await loadPaymentAllocations(db, companyId, paymentId) };
}

export async function listPurchasePayments(
  db: Db,
  companyId: string,
  filters: { supplierId?: string; status?: string; from?: string; to?: string; limit?: number } = {},
): Promise<PurchasePaymentView[]> {
  const res = await db.query<PurchasePaymentRow & { supplier_name: string; supplier_country: string }>(
    `SELECT p.*, s.name AS supplier_name, s.country AS supplier_country
       FROM purchase_payments p
       JOIN purchase_suppliers s ON s.id = p.supplier_id AND s.company_id = p.company_id
      WHERE p.company_id = $1
        AND ($2::uuid IS NULL OR p.supplier_id = $2::uuid)
        AND ($3::text IS NULL OR p.status = $3)
        AND ($4::date IS NULL OR p.payment_date >= $4::date)
        AND ($5::date IS NULL OR p.payment_date <= $5::date)
      ORDER BY p.payment_date DESC, p.created_at DESC
      LIMIT $6`,
    [
      companyId,
      filters.supplierId ?? null,
      filters.status ?? null,
      filters.from ?? null,
      filters.to ?? null,
      Math.min(filters.limit ?? 200, 500),
    ],
  );
  const payments: PurchasePaymentView[] = [];
  for (const row of res.rows) {
    payments.push({ ...row, allocations: await loadPaymentAllocations(db, companyId, row.id) });
  }
  return payments;
}

export async function createPurchasePayment(
  db: Db,
  companyId: string,
  userId: string,
  input: PurchasePaymentInput,
): Promise<PurchasePaymentView> {
  const kind = input.kind ?? 'payment';
  if (kind !== 'payment' && kind !== 'advance') {
    throw badRequest('VALIDATION_ERROR', 'kind must be payment or advance');
  }
  const supplier = await getSupplier(db, companyId, input.supplierId);
  if (!supplier.is_active) throw conflict('SUPPLIER_INACTIVE', 'An inactive supplier cannot be paid');
  const paymentDate = requireDate(input.paymentDate, 'paymentDate')!;
  const valueDate = requireDate(input.valueDate, 'valueDate');
  const amountTotal = positiveMoney(input.amount, 'amount');
  const currency = requireCurrency(input.currency);
  const { rate } = await resolveExchangeRate(db, companyId, currency, input.exchangeRate);
  const method = input.method ?? 'bank_transfer';
  if (!['bank_transfer', 'cheque', 'cash', 'card', 'other'].includes(method)) {
    throw badRequest('VALIDATION_ERROR', 'Unknown payment method');
  }
  const allocations = (input.allocations ?? []).map((a) => ({
    invoiceId: a.invoiceId,
    amount: positiveMoney(a.amount, 'allocation amount'),
  }));
  if (allocations.length === 0 && kind !== 'advance') {
    throw badRequest('VALIDATION_ERROR', 'A payment must be allocated to at least one invoice; use kind=advance for a prepayment');
  }
  if (allocations.length > 0 && kind === 'advance') {
    throw badRequest('VALIDATION_ERROR', 'An advance cannot be allocated to an invoice before it is received');
  }
  if (new Set(allocations.map((a) => a.invoiceId)).size !== allocations.length) {
    throw badRequest('VALIDATION_ERROR', 'The same invoice cannot appear twice in one payment');
  }
  const allocated = allocations.reduce((sum, a) => sum + a.amount, 0n);
  if (allocated > amountTotal) {
    throw conflict('PURCHASE_ALLOCATION_EXCEEDS_PAYMENT', 'Allocations exceed the payment amount');
  }
  if (kind === 'payment' && allocated !== amountTotal) {
    throw conflict(
      'PURCHASE_PAYMENT_UNALLOCATED',
      'A payment must be fully allocated; record the remainder as a separate advance',
    );
  }

  const result = await db.transaction(async (tx) => {
    // Lock invoices in a deterministic order to avoid cross-payment deadlocks.
    const ordered = [...allocations].sort((a, b) => a.invoiceId.localeCompare(b.invoiceId));
    const invoiceRows = new Map<string, PurchaseDocumentRow>();
    for (const allocation of ordered) {
      const locked = await tx.query<PurchaseDocumentRow>(
        'SELECT * FROM purchase_documents WHERE id = $1 AND company_id = $2 FOR UPDATE',
        [allocation.invoiceId, companyId],
      );
      const invoice = locked.rows[0];
      if (!invoice) throw notFound('PURCHASE_DOCUMENT_NOT_FOUND', 'Invoice not found');
      if (invoice.kind !== 'invoice') throw badRequest('VALIDATION_ERROR', 'A payment can only be allocated to an invoice');
      if (invoice.status !== 'validated') {
        throw conflict('PURCHASE_DOCUMENT_NOT_VALIDATED', 'The invoice must be validated first');
      }
      if (invoice.supplier_id !== supplier.id) {
        throw conflict('PURCHASE_SUPPLIER_MISMATCH', 'The payment and its invoice must belong to the same supplier');
      }
      if (invoice.currency !== currency) {
        throw conflict('PURCHASE_CURRENCY_MISMATCH', 'Payment and invoice must use the same currency');
      }
      const activePaid = await tx.query<{ total: string }>(
        `SELECT COALESCE(SUM(amount), 0)::text AS total FROM purchase_payment_allocations
          WHERE invoice_id = $1 AND cancelled_at IS NULL`,
        [invoice.id],
      );
      const activeCredited = await tx.query<{ total: string }>(
        `SELECT COALESCE(SUM(amount), 0)::text AS total FROM purchase_credit_allocations
          WHERE invoice_id = $1 AND cancelled_at IS NULL`,
        [invoice.id],
      );
      const outstanding =
        amount(invoice.total_amount) - amount(activePaid.rows[0]?.total) - amount(activeCredited.rows[0]?.total);
      if (allocation.amount > outstanding) {
        throw conflict(
          'PURCHASE_ALLOCATION_EXCEEDS_INVOICE',
          `Allocation ${formatAmount(allocation.amount)} exceeds the invoice outstanding ${formatAmount(outstanding > 0n ? outstanding : 0n)}`,
        );
      }
      invoiceRows.set(invoice.id, invoice);
    }

    const paymentNo = await nextPurchaseNumber(tx, companyId, 'payment', paymentDate);
    const inserted = await tx.query<PurchasePaymentRow>(
      `INSERT INTO purchase_payments
         (company_id, supplier_id, payment_no, kind, payment_date, value_date, amount, currency,
          exchange_rate, method, reference, unallocated_amount, status, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'recorded',$13)
       RETURNING *`,
      [
        companyId,
        supplier.id,
        paymentNo,
        kind,
        paymentDate,
        valueDate,
        formatAmount(amountTotal),
        currency,
        rate,
        method,
        input.reference ?? null,
        kind === 'advance' ? formatAmount(amountTotal) : '0.0000',
        userId,
      ],
    );
    const payment = inserted.rows[0]!;
    for (const allocation of allocations) {
      await tx.query(
        `INSERT INTO purchase_payment_allocations
           (payment_id, invoice_id, company_id, amount, allocated_date)
         VALUES ($1,$2,$3,$4,$5)`,
        [payment.id, allocation.invoiceId, companyId, formatAmount(allocation.amount), paymentDate],
      );
    }
    for (const invoiceId of invoiceRows.keys()) {
      await refreshPurchaseInvoiceBalance(tx, companyId, invoiceId);
    }
    await recordPurchaseEvent(tx, companyId, 'payment', payment.id, 'payment.recorded', userId, {
      paymentNo,
      kind,
      amount: payment.amount,
      currency,
      allocations: allocations.map((a) => ({ invoiceId: a.invoiceId, amount: formatAmount(a.amount) })),
    });
    await writeAudit(tx, {
      companyId,
      userId,
      action: 'purchases.payment.create',
      entityType: 'purchase_payment',
      entityId: payment.id,
      details: {
        paymentNo,
        kind,
        amount: payment.amount,
        currency,
        invoices: allocations.length,
      },
    });
    return payment;
  });
  return getPurchasePayment(db, companyId, result.id);
}

/**
 * Mission 42 — allocate a recorded advance (or a payment's remaining amount)
 * to a later invoice.
 *
 * This is the explicit missing step of M41 A-03. It does not create a journal
 * entry: if the advance is already posted on the prepayment account, a separate
 * reclassification proposal is required (see proposePurchaseAllocationReclass).
 */
export async function allocatePurchasePayment(
  db: Db,
  companyId: string,
  userId: string,
  paymentId: string,
  input: {
    invoiceId: string;
    amount: string | number;
    allocationDate?: string | null;
    reason?: string | null;
  },
): Promise<{
  payment: PurchasePaymentView;
  invoice: PurchaseDocumentView;
  allocationId: string;
  reclassRequired: boolean;
}> {
  const value = positiveMoney(input.amount, 'amount');
  const result = await db.transaction(async (tx) => {
    const paymentRes = await tx.query<PurchasePaymentRow>(
      'SELECT * FROM purchase_payments WHERE id = $1 AND company_id = $2 FOR UPDATE',
      [paymentId, companyId],
    );
    const payment = paymentRes.rows[0];
    if (!payment) throw notFound('PURCHASE_PAYMENT_NOT_FOUND', 'Supplier payment not found');
    if (payment.status !== 'recorded') {
      throw conflict('PURCHASE_PAYMENT_CANCELLED', 'A cancelled payment cannot be allocated');
    }
    const invoiceRes = await tx.query<PurchaseDocumentRow>(
      'SELECT * FROM purchase_documents WHERE id = $1 AND company_id = $2 FOR UPDATE',
      [input.invoiceId, companyId],
    );
    const invoice = invoiceRes.rows[0];
    if (!invoice) throw notFound('PURCHASE_DOCUMENT_NOT_FOUND', 'Invoice not found');
    if (invoice.kind !== 'invoice') {
      throw badRequest('VALIDATION_ERROR', 'A payment can only be allocated to an invoice');
    }
    if (invoice.status !== 'validated') {
      throw conflict('PURCHASE_DOCUMENT_NOT_VALIDATED', 'The invoice must be validated first');
    }
    if (invoice.supplier_id !== payment.supplier_id) {
      throw conflict('PURCHASE_SUPPLIER_MISMATCH', 'Payment and invoice must belong to the same supplier');
    }
    if (invoice.currency !== payment.currency) {
      throw conflict('PURCHASE_CURRENCY_MISMATCH', 'Payment and invoice must use the same currency');
    }
    const allocationDate =
      requireDate(input.allocationDate ?? today(), 'allocationDate')!;
    if (allocationDate < payment.payment_date) {
      throw badRequest('VALIDATION_ERROR', 'An allocation cannot predate the payment');
    }

    const active = await tx.query<{ total: string }>(
      `SELECT COALESCE(SUM(amount), 0)::text AS total
         FROM purchase_payment_allocations
        WHERE payment_id = $1 AND cancelled_at IS NULL`,
      [paymentId],
    );
    const available = amount(payment.amount) - amount(active.rows[0]?.total);
    if (value > available) {
      throw conflict(
        'PURCHASE_PAYMENT_ALLOCATION_EXCEEDS_AVAILABLE',
        `Requested ${formatAmount(value)}, payment available ${formatAmount(available > 0n ? available : 0n)}`,
      );
    }

    const paid = await tx.query<{ total: string }>(
      `SELECT COALESCE(SUM(amount), 0)::text AS total
         FROM purchase_payment_allocations
        WHERE invoice_id = $1 AND cancelled_at IS NULL`,
      [invoice.id],
    );
    const credited = await tx.query<{ total: string }>(
      `SELECT COALESCE(SUM(amount), 0)::text AS total
         FROM purchase_credit_allocations
        WHERE invoice_id = $1 AND cancelled_at IS NULL`,
      [invoice.id],
    );
    const outstanding =
      amount(invoice.total_amount) - amount(paid.rows[0]?.total) - amount(credited.rows[0]?.total);
    if (value > outstanding) {
      throw conflict(
        'PURCHASE_ALLOCATION_EXCEEDS_INVOICE',
        `Requested ${formatAmount(value)}, invoice outstanding ${formatAmount(outstanding > 0n ? outstanding : 0n)}`,
      );
    }

    const existing = await tx.query<{ id: string; cancelled_at: string | null }>(
      `SELECT id, cancelled_at FROM purchase_payment_allocations
        WHERE payment_id = $1 AND invoice_id = $2 FOR UPDATE`,
      [paymentId, invoice.id],
    );
    if (existing.rows[0]?.cancelled_at === null) {
      throw conflict('PURCHASE_ALLOCATION_EXISTS', 'This payment is already allocated to this invoice');
    }
    let allocationId: string;
    if (existing.rows[0]) {
      const reactivated = await tx.query<{ id: string }>(
        `UPDATE purchase_payment_allocations
            SET amount = $2, allocated_date = $3, cancelled_at = NULL, cancelled_by = NULL,
                cancellation_reason = NULL, reclass_amount = $4
          WHERE id = $1 RETURNING id`,
        [
          existing.rows[0].id,
          formatAmount(value),
          allocationDate,
          formatAmount(payment.accounting_entry_id && payment.kind === 'advance' ? value : 0n),
        ],
      );
      allocationId = reactivated.rows[0]!.id;
    } else {
      const inserted = await tx.query<{ id: string }>(
        `INSERT INTO purchase_payment_allocations
           (payment_id, invoice_id, company_id, amount, allocated_date, reclass_amount)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [
          paymentId,
          invoice.id,
          companyId,
          formatAmount(value),
          allocationDate,
          formatAmount(payment.accounting_entry_id && payment.kind === 'advance' ? value : 0n),
        ],
      );
      allocationId = inserted.rows[0]!.id;
    }

    const allocatedNow = amount(active.rows[0]?.total) + value;
    await tx.query(
      `UPDATE purchase_payments
          SET unallocated_amount = $2, updated_at = now()
        WHERE id = $1`,
      [paymentId, formatAmount(amount(payment.amount) - allocatedNow > 0n ? amount(payment.amount) - allocatedNow : 0n)],
    );
    await refreshPurchaseInvoiceBalance(tx, companyId, invoice.id);
    await recordPurchaseEvent(tx, companyId, 'allocation', allocationId, 'payment.allocated', userId, {
      paymentId,
      invoiceId: invoice.id,
      amount: formatAmount(value),
      allocationDate,
      reason: input.reason ?? null,
    });
    await writeAudit(tx, {
      companyId,
      userId,
      action: 'purchases.payment.allocate',
      entityType: 'purchase_payment_allocation',
      entityId: allocationId,
      details: {
        paymentId,
        invoiceId: invoice.id,
        amount: formatAmount(value),
        allocationDate,
      },
    });
    return {
      allocationId,
      invoiceId: invoice.id,
      reclassRequired: Boolean(payment.accounting_entry_id && payment.kind === 'advance'),
    };
  });
  return {
    payment: await getPurchasePayment(db, companyId, paymentId),
    invoice: await getPurchaseDocument(db, companyId, result.invoiceId),
    allocationId: result.allocationId,
    reclassRequired: result.reclassRequired,
  };
}

export async function cancelPurchasePayment(
  db: Db,
  companyId: string,
  userId: string,
  paymentId: string,
  reason: string,
): Promise<PurchasePaymentView> {
  if (!reason.trim()) throw badRequest('VALIDATION_ERROR', 'A cancellation reason is required');
  await db.transaction(async (tx) => {
    const locked = await tx.query<PurchasePaymentRow>(
      'SELECT * FROM purchase_payments WHERE id = $1 AND company_id = $2 FOR UPDATE',
      [paymentId, companyId],
    );
    const payment = locked.rows[0];
    if (!payment) throw notFound('PURCHASE_PAYMENT_NOT_FOUND', 'Supplier payment not found');
    if (payment.status === 'cancelled') return;
    if (payment.accounting_entry_id) {
      throw conflict(
        'PURCHASE_ACCOUNTING_POSTED',
        'This payment is posted to accounting: prepare a reversal instead of cancelling it',
      );
    }
    const bank = await tx.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM bank_matches
        WHERE company_id = $1 AND purchase_payment_id = $2 AND status = 'confirmed'`,
      [companyId, paymentId],
    );
    if (Number(bank.rows[0]?.count ?? 0) > 0) {
      throw conflict('PURCHASE_PAYMENT_RECONCILED', 'Remove the confirmed bank reconciliation first');
    }
    const allocated = await tx.query<{ invoice_id: string }>(
      `SELECT invoice_id FROM purchase_payment_allocations
        WHERE payment_id = $1 AND cancelled_at IS NULL FOR UPDATE`,
      [paymentId],
    );
    await tx.query(
      `UPDATE purchase_payment_allocations
          SET cancelled_at = now(), cancelled_by = $2, cancellation_reason = $3
        WHERE payment_id = $1 AND cancelled_at IS NULL`,
      [paymentId, userId, reason.trim()],
    );
    await tx.query(
      `UPDATE purchase_payments
          SET status = 'cancelled', cancelled_by = $2, cancelled_at = now(),
              cancellation_reason = $3, updated_at = now()
        WHERE id = $1`,
      [paymentId, userId, reason.trim()],
    );
    for (const row of allocated.rows) {
      await refreshPurchaseInvoiceBalance(tx, companyId, row.invoice_id);
    }
    await recordPurchaseEvent(tx, companyId, 'payment', paymentId, 'payment.cancelled', userId, {
      reason: reason.trim(),
      allocationsCancelled: allocated.rows.length,
    });
    await writeAudit(tx, {
      companyId,
      userId,
      action: 'purchases.payment.cancel',
      entityType: 'purchase_payment',
      entityId: paymentId,
      details: { reason: reason.trim() },
    });
  });
  return getPurchasePayment(db, companyId, paymentId);
}

// ---------------------------------------------------------------------------
// Credit notes
// ---------------------------------------------------------------------------

export async function allocateSupplierCredit(
  db: Db,
  companyId: string,
  userId: string,
  creditNoteId: string,
  invoiceId: string,
  requested: string | number,
  reason: string | null,
): Promise<{ creditNote: PurchaseDocumentView; invoice: PurchaseDocumentView }> {
  const value = positiveMoney(requested, 'amount');
  await db.transaction(async (tx) => {
    const noteRes = await tx.query<PurchaseDocumentRow>(
      'SELECT * FROM purchase_documents WHERE id = $1 AND company_id = $2 FOR UPDATE',
      [creditNoteId, companyId],
    );
    const note = noteRes.rows[0];
    if (!note) throw notFound('PURCHASE_DOCUMENT_NOT_FOUND', 'Credit note not found');
    if (note.kind !== 'credit_note') throw badRequest('VALIDATION_ERROR', 'This document is not a credit note');
    if (note.status !== 'validated') throw conflict('PURCHASE_DOCUMENT_NOT_VALIDATED', 'The credit note must be validated');
    const invoiceRes = await tx.query<PurchaseDocumentRow>(
      'SELECT * FROM purchase_documents WHERE id = $1 AND company_id = $2 FOR UPDATE',
      [invoiceId, companyId],
    );
    const invoice = invoiceRes.rows[0];
    if (!invoice) throw notFound('PURCHASE_DOCUMENT_NOT_FOUND', 'Invoice not found');
    if (invoice.kind !== 'invoice') throw badRequest('VALIDATION_ERROR', 'A credit note can only be allocated to an invoice');
    if (invoice.status !== 'validated') throw conflict('PURCHASE_DOCUMENT_NOT_VALIDATED', 'The invoice must be validated');
    if (invoice.supplier_id !== note.supplier_id) {
      throw conflict('PURCHASE_SUPPLIER_MISMATCH', 'Credit note and invoice must belong to the same supplier');
    }
    if (invoice.currency !== note.currency) {
      throw conflict('PURCHASE_CURRENCY_MISMATCH', 'Credit note and invoice must use the same currency');
    }
    const used = await tx.query<{ total: string }>(
      `SELECT COALESCE(SUM(amount), 0)::text AS total FROM purchase_credit_allocations
        WHERE credit_note_id = $1 AND cancelled_at IS NULL`,
      [creditNoteId],
    );
    const available = amount(note.total_amount) - amount(used.rows[0]?.total);
    if (value > available) {
      throw conflict(
        'PURCHASE_CREDIT_EXCEEDS_AVAILABLE',
        `Requested ${formatAmount(value)}, credit available ${formatAmount(available > 0n ? available : 0n)}`,
      );
    }
    const paid = await tx.query<{ total: string }>(
      `SELECT COALESCE(SUM(amount), 0)::text AS total FROM purchase_payment_allocations
        WHERE invoice_id = $1 AND cancelled_at IS NULL`,
      [invoice.id],
    );
    const credited = await tx.query<{ total: string }>(
      `SELECT COALESCE(SUM(amount), 0)::text AS total FROM purchase_credit_allocations
        WHERE invoice_id = $1 AND cancelled_at IS NULL`,
      [invoice.id],
    );
    const outstanding =
      amount(invoice.total_amount) - amount(paid.rows[0]?.total) - amount(credited.rows[0]?.total);
    if (value > outstanding) {
      throw conflict(
        'PURCHASE_ALLOCATION_EXCEEDS_INVOICE',
        `Requested ${formatAmount(value)}, invoice outstanding ${formatAmount(outstanding > 0n ? outstanding : 0n)}`,
      );
    }
    const existing = await tx.query<{ id: string }>(
      `SELECT id FROM purchase_credit_allocations
        WHERE credit_note_id = $1 AND invoice_id = $2 AND cancelled_at IS NULL FOR UPDATE`,
      [creditNoteId, invoiceId],
    );
    if (existing.rows[0]) {
      await tx.query('UPDATE purchase_credit_allocations SET amount = amount + $2 WHERE id = $1', [
        existing.rows[0].id,
        formatAmount(value),
      ]);
    } else {
      await tx.query(
        `INSERT INTO purchase_credit_allocations
           (credit_note_id, invoice_id, company_id, amount, allocated_date)
         VALUES ($1,$2,$3,$4,$5)`,
        [creditNoteId, invoiceId, companyId, formatAmount(value), note.issue_date],
      );
    }
    await refreshPurchaseInvoiceBalance(tx, companyId, invoiceId);
    await recordPurchaseEvent(tx, companyId, 'allocation', existing.rows[0]?.id ?? null, 'credit.allocated', userId, {
      creditNoteId,
      invoiceId,
      amount: formatAmount(value),
      reason,
    });
    await writeAudit(tx, {
      companyId,
      userId,
      action: 'purchases.credit.allocate',
      entityType: 'purchase_document',
      entityId: creditNoteId,
      details: { invoiceId, amount: formatAmount(value) },
    });
  });
  return {
    creditNote: await getPurchaseDocument(db, companyId, creditNoteId),
    invoice: await getPurchaseDocument(db, companyId, invoiceId),
  };
}

export async function cancelSupplierCreditAllocation(
  db: Db,
  companyId: string,
  userId: string,
  allocationId: string,
  reason: string,
): Promise<{ creditNote: PurchaseDocumentView; invoice: PurchaseDocumentView }> {
  if (!reason.trim()) throw badRequest('VALIDATION_ERROR', 'A cancellation reason is required');
  const result = await db.transaction(async (tx) => {
    const locked = await tx.query<{ id: string; credit_note_id: string; invoice_id: string; amount: string }>(
      `SELECT id, credit_note_id, invoice_id, amount::text FROM purchase_credit_allocations
        WHERE id = $1 AND company_id = $2 AND cancelled_at IS NULL FOR UPDATE`,
      [allocationId, companyId],
    );
    const allocation = locked.rows[0];
    if (!allocation) throw notFound('PURCHASE_ALLOCATION_NOT_FOUND', 'Credit allocation not found');
    await tx.query(
      `UPDATE purchase_credit_allocations
          SET cancelled_at = now(), cancelled_by = $2, cancellation_reason = $3
        WHERE id = $1`,
      [allocationId, userId, reason.trim()],
    );
    await refreshPurchaseInvoiceBalance(tx, companyId, allocation.invoice_id);
    await recordPurchaseEvent(tx, companyId, 'allocation', allocationId, 'credit.unallocated', userId, {
      creditNoteId: allocation.credit_note_id,
      invoiceId: allocation.invoice_id,
      amount: allocation.amount,
      reason: reason.trim(),
    });
    return allocation;
  });
  return {
    creditNote: await getPurchaseDocument(db, companyId, result.credit_note_id),
    invoice: await getPurchaseDocument(db, companyId, result.invoice_id),
  };
}

export async function listSupplierCreditAllocations(
  db: Db,
  companyId: string,
  creditNoteId: string,
): Promise<Record<string, unknown>[]> {
  const res = await db.query<Record<string, unknown>>(
    `SELECT a.*, d.doc_no AS invoice_number, d.supplier_reference AS invoice_reference
       FROM purchase_credit_allocations a
       JOIN purchase_documents d ON d.id = a.invoice_id AND d.company_id = $2
      WHERE a.credit_note_id = $1 AND a.company_id = $2
      ORDER BY a.created_at DESC`,
    [creditNoteId, companyId],
  );
  return res.rows;
}

// ---------------------------------------------------------------------------
// Balances, aging and dashboard
// ---------------------------------------------------------------------------

export interface CurrencyBalance {
  currency: string;
  invoiced: string;
  paid: string;
  credited: string;
  outstanding: string;
  overdue: string;
  dueSoon: string;
  invoiceCount: number;
  overdueCount: number;
}

export async function supplierBalance(
  db: Db,
  companyId: string,
  supplierId: string,
  asOf = today(),
): Promise<{
  supplier: SupplierRow;
  balances: CurrencyBalance[];
  creditAvailable: { currency: string; amount: string }[];
  advanceAvailable: { currency: string; amount: string }[];
  position: {
    currency: string;
    outstanding: string;
    creditAvailable: string;
    advanceAvailable: string;
    netPosition: string;
  }[];
}> {
  const supplier = await getSupplier(db, companyId, supplierId);
  const asOfDate = requireDate(asOf, 'asOf')!;
  const res = await db.query<{
    currency: string;
    invoiced: string;
    paid: string;
    credited: string;
    outstanding: string;
    overdue: string;
    due_soon: string;
    invoice_count: string;
    overdue_count: string;
  }>(
    `WITH calc AS (
       SELECT d.id, d.currency, d.total_amount, d.due_date,
              COALESCE((
                SELECT SUM(a.amount) FROM purchase_payment_allocations a
                  JOIN purchase_payments p ON p.id = a.payment_id
                 WHERE a.invoice_id = d.id AND a.cancelled_at IS NULL AND p.status = 'recorded'
                   AND COALESCE(a.allocated_date, p.payment_date) <= $3::date
              ), 0) AS amount_paid,
              COALESCE((
                SELECT SUM(c.amount) FROM purchase_credit_allocations c
                 WHERE c.invoice_id = d.id AND c.cancelled_at IS NULL
                   AND COALESCE(c.allocated_date, d.issue_date) <= $3::date
              ), 0) AS credited_amount
         FROM purchase_documents d
        WHERE d.company_id = $1 AND d.supplier_id = $2 AND d.kind = 'invoice'
          AND d.status = 'validated' AND d.issue_date <= $3::date
     )
     SELECT currency,
            COALESCE(SUM(total_amount), 0)::text AS invoiced,
            COALESCE(SUM(amount_paid), 0)::text AS paid,
            COALESCE(SUM(credited_amount), 0)::text AS credited,
            COALESCE(SUM(GREATEST(total_amount - amount_paid - credited_amount, 0)), 0)::text AS outstanding,
            COALESCE(SUM(CASE WHEN due_date IS NOT NULL AND due_date < $3::date
                              THEN GREATEST(total_amount - amount_paid - credited_amount, 0) ELSE 0 END), 0)::text AS overdue,
            COALESCE(SUM(CASE WHEN due_date IS NOT NULL AND due_date >= $3::date
                               AND due_date <= ($3::date + INTERVAL '30 days')
                              THEN GREATEST(total_amount - amount_paid - credited_amount, 0) ELSE 0 END), 0)::text AS due_soon,
            count(*)::text AS invoice_count,
            COALESCE(SUM(CASE WHEN due_date IS NOT NULL AND due_date < $3::date THEN 1 ELSE 0 END), 0)::text AS overdue_count
       FROM calc
      GROUP BY currency
      ORDER BY currency`,
    [companyId, supplierId, asOfDate],
  );
  const credits = await db.query<{ currency: string; amount: string }>(
    `SELECT d.currency,
            COALESCE(SUM(d.total_amount - COALESCE(a.used, 0)), 0)::text AS amount
       FROM purchase_documents d
       LEFT JOIN (
         SELECT credit_note_id, SUM(amount) AS used
           FROM purchase_credit_allocations
          WHERE cancelled_at IS NULL AND allocated_date <= $3::date
          GROUP BY credit_note_id
       ) a ON a.credit_note_id = d.id
      WHERE d.company_id = $1 AND d.supplier_id = $2 AND d.kind = 'credit_note'
        AND d.status = 'validated' AND d.issue_date <= $3::date
      GROUP BY d.currency
      HAVING SUM(d.total_amount - COALESCE(a.used, 0)) > 0
      ORDER BY d.currency`,
    [companyId, supplierId, asOfDate],
  );
  const advances = await db.query<{ currency: string; amount: string }>(
    `SELECT p.currency,
            COALESCE(SUM(p.amount - COALESCE(a.used, 0)), 0)::text AS amount
       FROM purchase_payments p
       LEFT JOIN (
         SELECT payment_id, SUM(amount) AS used
           FROM purchase_payment_allocations
          WHERE cancelled_at IS NULL AND allocated_date <= $3::date
          GROUP BY payment_id
       ) a ON a.payment_id = p.id
      WHERE p.company_id = $1 AND p.supplier_id = $2 AND p.status = 'recorded'
        AND p.kind = 'advance' AND p.payment_date <= $3::date
      GROUP BY p.currency
      HAVING SUM(p.amount - COALESCE(a.used, 0)) > 0
      ORDER BY p.currency`,
    [companyId, supplierId, asOfDate],
  );
  const balances: CurrencyBalance[] = res.rows.map((row) => ({
    currency: row.currency,
    invoiced: row.invoiced,
    paid: row.paid,
    credited: row.credited,
    outstanding: row.outstanding,
    overdue: row.overdue,
    dueSoon: row.due_soon,
    invoiceCount: Number(row.invoice_count),
    overdueCount: Number(row.overdue_count),
  }));
  const positionCurrencies = new Set([
    ...balances.map((b) => b.currency),
    ...credits.rows.map((c) => c.currency),
    ...advances.rows.map((a) => a.currency),
  ]);
  const creditByCurrency = new Map(credits.rows.map((c) => [c.currency, amount(c.amount)]));
  const advanceByCurrency = new Map(advances.rows.map((a) => [a.currency, amount(a.amount)]));
  const outstandingByCurrency = new Map(balances.map((b) => [b.currency, amount(b.outstanding)]));
  return {
    supplier,
    balances,
    creditAvailable: credits.rows,
    advanceAvailable: advances.rows,
    position: [...positionCurrencies].sort().map((currency) => {
      const outstanding = outstandingByCurrency.get(currency) ?? 0n;
      const credit = creditByCurrency.get(currency) ?? 0n;
      const advance = advanceByCurrency.get(currency) ?? 0n;
      return {
        currency,
        outstanding: formatAmount(outstanding),
        creditAvailable: formatAmount(credit),
        advanceAvailable: formatAmount(advance),
        netPosition: formatAmount(outstanding - credit - advance),
      };
    }),
  };
}

export interface AgingInvoice {
  id: string;
  docNo: string | null;
  supplierId: string;
  supplierName: string;
  supplierReference: string;
  issueDate: string;
  dueDate: string | null;
  currency: string;
  total: string;
  paid: string;
  credited: string;
  outstanding: string;
  daysOverdue: number;
  bucket: 'not_due' | 'due_soon' | '1_30' | '31_60' | '61_90' | 'over_90';
  accountingPosted: boolean;
}

export interface AgingGroup {
  supplierId: string;
  supplierName: string;
  currency: string;
  invoiceCount: number;
  total: string;
  paid: string;
  credited: string;
  outstanding: string;
  overdue: string;
  dueSoon: string;
  invoices: AgingInvoice[];
}

export interface PurchasesAging {
  asOf: string;
  summary: CurrencyBalance[];
  groups: AgingGroup[];
  totalsByCurrency: { currency: string; outstanding: string; overdue: string; dueSoon: string; invoices: number }[];
}

function agingBucket(daysOverdue: number): AgingInvoice['bucket'] {
  if (daysOverdue <= 0) return daysOverdue >= -30 ? 'due_soon' : 'not_due';
  if (daysOverdue <= 30) return '1_30';
  if (daysOverdue <= 60) return '31_60';
  if (daysOverdue <= 90) return '61_90';
  return 'over_90';
}

export async function purchasesAging(
  db: Db,
  companyId: string,
  filters: { asOf?: string; supplierId?: string; currency?: string; includeDetail?: boolean } = {},
): Promise<PurchasesAging> {
  const asOf = requireDate(filters.asOf ?? today(), 'asOf')!;
  const res = await db.query<any>(
    `WITH calc AS (
       SELECT d.id, d.doc_no, d.supplier_id, s.name AS supplier_name, d.supplier_reference,
              d.issue_date, d.due_date, d.currency, d.total_amount,
              COALESCE((
                SELECT SUM(a.amount) FROM purchase_payment_allocations a
                  JOIN purchase_payments p ON p.id = a.payment_id
                 WHERE a.invoice_id = d.id AND a.cancelled_at IS NULL AND p.status = 'recorded'
                   AND COALESCE(a.allocated_date, p.payment_date) <= $2::date
              ), 0) AS amount_paid,
              COALESCE((
                SELECT SUM(c.amount) FROM purchase_credit_allocations c
                 WHERE c.invoice_id = d.id AND c.cancelled_at IS NULL
                   AND COALESCE(c.allocated_date, d.issue_date) <= $2::date
              ), 0) AS credited_amount,
              d.accounting_entry_id
         FROM purchase_documents d
         JOIN purchase_suppliers s ON s.id = d.supplier_id AND s.company_id = d.company_id
        WHERE d.company_id = $1 AND d.kind = 'invoice' AND d.status = 'validated'
          AND d.issue_date <= $2::date
          AND ($3::uuid IS NULL OR d.supplier_id = $3::uuid)
          AND ($4::text IS NULL OR d.currency = $4)
     )
     SELECT *, (total_amount - amount_paid - credited_amount)::text AS outstanding
       FROM calc
      WHERE total_amount - amount_paid - credited_amount > 0
      ORDER BY supplier_name, currency, due_date NULLS LAST, doc_no`,
    [companyId, asOf, filters.supplierId ?? null, filters.currency ?? null],
  );
  const details: AgingInvoice[] = res.rows.map((row) => {
    const daysOverdue = row.due_date ? daysBetween(row.due_date, asOf) : 0;
    return {
      id: row.id,
      docNo: row.doc_no,
      supplierId: row.supplier_id,
      supplierName: row.supplier_name,
      supplierReference: row.supplier_reference,
      issueDate: row.issue_date,
      dueDate: row.due_date,
      currency: row.currency,
      total: row.total_amount,
      paid: row.amount_paid,
      credited: row.credited_amount,
      outstanding: row.outstanding,
      daysOverdue: row.due_date ? Math.max(daysOverdue, 0) : 0,
      bucket: agingBucket(daysOverdue),
      accountingPosted: Boolean(row.accounting_entry_id),
    };
  });
  const groupMap = new Map<string, AgingGroup>();
  const totalMap = new Map<string, { currency: string; outstanding: bigint; overdue: bigint; dueSoon: bigint; invoices: number }>();
  for (const invoice of details) {
    const key = `${invoice.supplierId}|${invoice.currency}`;
    let group = groupMap.get(key);
    if (!group) {
      group = {
        supplierId: invoice.supplierId,
        supplierName: invoice.supplierName,
        currency: invoice.currency,
        invoiceCount: 0,
        total: '0.0000',
        paid: '0.0000',
        credited: '0.0000',
        outstanding: '0.0000',
        overdue: '0.0000',
        dueSoon: '0.0000',
        invoices: [],
      };
      groupMap.set(key, group);
    }
    group.invoiceCount += 1;
    group.total = formatAmount(amount(group.total) + amount(invoice.total));
    group.paid = formatAmount(amount(group.paid) + amount(invoice.paid));
    group.credited = formatAmount(amount(group.credited) + amount(invoice.credited));
    group.outstanding = formatAmount(amount(group.outstanding) + amount(invoice.outstanding));
    if (invoice.bucket !== 'not_due' && invoice.bucket !== 'due_soon') {
      group.overdue = formatAmount(amount(group.overdue) + amount(invoice.outstanding));
    }
    if (invoice.bucket === 'due_soon') {
      group.dueSoon = formatAmount(amount(group.dueSoon) + amount(invoice.outstanding));
    }
    group.invoices.push(invoice);

    let total = totalMap.get(invoice.currency);
    if (!total) {
      total = { currency: invoice.currency, outstanding: 0n, overdue: 0n, dueSoon: 0n, invoices: 0 };
      totalMap.set(invoice.currency, total);
    }
    total.outstanding += amount(invoice.outstanding);
    if (invoice.bucket !== 'not_due' && invoice.bucket !== 'due_soon') total.overdue += amount(invoice.outstanding);
    if (invoice.bucket === 'due_soon') total.dueSoon += amount(invoice.outstanding);
    total.invoices += 1;
  }
  const groups = [...groupMap.values()].map((group) => ({
    ...group,
    invoices: filters.includeDetail === false ? [] : group.invoices,
  }));
  const summary: CurrencyBalance[] = [...totalMap.values()].map((total) => {
    const group = groups.filter((g) => g.currency === total.currency);
    return {
      currency: total.currency,
      invoiced: formatAmount(group.reduce((sum, g) => sum + amount(g.total), 0n)),
      paid: formatAmount(group.reduce((sum, g) => sum + amount(g.paid), 0n)),
      credited: formatAmount(group.reduce((sum, g) => sum + amount(g.credited), 0n)),
      outstanding: formatAmount(total.outstanding),
      overdue: formatAmount(total.overdue),
      dueSoon: formatAmount(total.dueSoon),
      invoiceCount: total.invoices,
      overdueCount: details.filter(
        (d) => d.currency === total.currency && d.bucket !== 'not_due' && d.bucket !== 'due_soon',
      ).length,
    };
  });
  return {
    asOf,
    summary,
    groups,
    totalsByCurrency: [...totalMap.values()].map((total) => ({
      currency: total.currency,
      outstanding: formatAmount(total.outstanding),
      overdue: formatAmount(total.overdue),
      dueSoon: formatAmount(total.dueSoon),
      invoices: total.invoices,
    })),
  };
}

export async function purchasesDashboard(db: Db, companyId: string): Promise<Record<string, unknown>> {
  const suppliers = await db.query<{ total: string; active: string }>(
    `SELECT count(*)::text AS total,
            COALESCE(SUM(CASE WHEN is_active THEN 1 ELSE 0 END), 0)::text AS active
       FROM purchase_suppliers WHERE company_id = $1`,
    [companyId],
  );
  const documents = await db.query<{ drafts: string; invoices: string; credits: string; uncounted: string }>(
    `SELECT
       COALESCE(SUM(CASE WHEN status = 'draft' THEN 1 ELSE 0 END), 0)::text AS drafts,
       COALESCE(SUM(CASE WHEN kind = 'invoice' AND status = 'validated' THEN 1 ELSE 0 END), 0)::text AS invoices,
       COALESCE(SUM(CASE WHEN kind = 'credit_note' AND status = 'validated' THEN 1 ELSE 0 END), 0)::text AS credits,
       COALESCE(SUM(CASE WHEN status = 'validated' AND accounting_entry_id IS NULL THEN 1 ELSE 0 END), 0)::text AS uncounted
     FROM purchase_documents WHERE company_id = $1`,
    [companyId],
  );
  const aging = await purchasesAging(db, companyId, { includeDetail: false });
  const payments = await db.query<{ recorded: string; cancelled: string; uncounted: string }>(
    `SELECT
       COALESCE(SUM(CASE WHEN status = 'recorded' THEN 1 ELSE 0 END), 0)::text AS recorded,
       COALESCE(SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END), 0)::text AS cancelled,
       COALESCE(SUM(CASE WHEN status = 'recorded' AND accounting_entry_id IS NULL THEN 1 ELSE 0 END), 0)::text AS uncounted
     FROM purchase_payments WHERE company_id = $1`,
    [companyId],
  );
  return {
    asOf: aging.asOf,
    suppliers: {
      total: Number(suppliers.rows[0]?.total ?? 0),
      active: Number(suppliers.rows[0]?.active ?? 0),
    },
    documents: {
      drafts: Number(documents.rows[0]?.drafts ?? 0),
      invoices: Number(documents.rows[0]?.invoices ?? 0),
      creditNotes: Number(documents.rows[0]?.credits ?? 0),
      awaitingAccounting: Number(documents.rows[0]?.uncounted ?? 0),
    },
    payments: {
      recorded: Number(payments.rows[0]?.recorded ?? 0),
      cancelled: Number(payments.rows[0]?.cancelled ?? 0),
      awaitingAccounting: Number(payments.rows[0]?.uncounted ?? 0),
    },
    aging: {
      summary: aging.summary,
      totalsByCurrency: aging.totalsByCurrency,
    },
  };
}

export function purchasesAgingCsv(report: PurchasesAging): string {
  const lines = [
    ['Fournisseur', 'Devise', 'Facture', 'Référence fournisseur', 'Date', 'Échéance', 'Total', 'Payé', 'Avoir', 'Restant', 'Jours de retard', 'Comptabilisée'].join(','),
    ...report.groups.flatMap((group) =>
      group.invoices.map((invoice) =>
        [
          group.supplierName,
          invoice.currency,
          invoice.docNo ?? '',
          invoice.supplierReference,
          invoice.issueDate,
          invoice.dueDate ?? '',
          invoice.total,
          invoice.paid,
          invoice.credited,
          invoice.outstanding,
          String(invoice.daysOverdue),
          invoice.accountingPosted ? 'oui' : 'non',
        ]
          .map((value) => `"${String(value).replace(/"/g, '""')}"`)
          .join(','),
      ),
    ),
    '',
    'Totaux par devise (aucune addition entre devises)',
    ['Devise', 'Factures', 'Restant', 'Échu', 'À échoir 30 j'].join(','),
    ...report.totalsByCurrency.map((total) =>
      [total.currency, String(total.invoices), total.outstanding, total.overdue, total.dueSoon]
        .map((value) => `"${String(value).replace(/"/g, '""')}"`)
        .join(','),
    ),
  ];
  return lines.join('\n');
}

/**
 * Mission 42 — explicit link from a capitalised purchase line to the fixed
 * asset register. No asset is created automatically: the human chooses the
 * category and confirms. One purchase line can create at most one asset.
 */
export async function createFixedAssetFromPurchaseLine(
  db: Db,
  companyId: string,
  userId: string,
  documentId: string,
  lineId: string,
  input: {
    categoryId: string;
    description?: string | null;
    serialNumber?: string | null;
    location?: string | null;
    inServiceDate?: string | null;
    usefulLifeMonths?: number | null;
    method?: 'straight_line' | 'reducing_balance' | null;
    residualValue?: string | number | null;
    notes?: string | null;
  },
): Promise<{ asset: any; document: PurchaseDocumentView }> {
  const document = await getPurchaseDocument(db, companyId, documentId);
  if (document.status !== 'validated') {
    throw conflict('PURCHASE_DOCUMENT_NOT_VALIDATED', 'Validate the purchase invoice before creating its fixed asset');
  }
  const line = document.lines.find((l: any) => l.id === lineId) as any;
  if (!line) throw notFound('PURCHASE_LINE_NOT_FOUND', 'Purchase line not found');
  const account = await db.query<{ type: string }>(
    'SELECT type FROM accounts WHERE id = $1 AND company_id = $2',
    [line.accountId, companyId],
  );
  if (account.rows[0]?.type !== 'asset') {
    throw conflict('PURCHASE_LINE_NOT_CAPITALISED', 'Only a purchase line posted to an asset account can create a fixed asset');
  }
  const existing = await db.query<any>(
    `SELECT fa.* FROM fixed_assets fa
      WHERE fa.company_id = $1 AND fa.purchase_document_line_id = $2`,
    [companyId, lineId],
  );
  if (existing.rows[0]) {
    return { asset: existing.rows[0], document };
  }
  const supplier = await getSupplier(db, companyId, document.supplier_id);
  const assetInput: AssetInput = {
    categoryId: input.categoryId,
    description: input.description?.trim() || line.description,
    serialNumber: input.serialNumber ?? null,
    location: input.location ?? null,
    acquisitionDate: document.issue_date,
    inServiceDate: input.inServiceDate ?? null,
    supplierName: supplier.name,
    invoiceRef: document.doc_no ?? document.supplier_reference,
    documentRef: `purchase:${document.id}`,
    cost: line.netAmount,
    currency: document.currency,
    exchangeRate: document.exchange_rate,
    method: input.method ?? null,
    usefulLifeMonths: input.usefulLifeMonths ?? null,
    residualValue: input.residualValue ?? null,
    notes: input.notes ?? `Créé depuis la facture fournisseur ${document.doc_no ?? document.supplier_reference}`,
  };
  const createdAsset = await createAsset(db, { companyId, userId }, assetInput);
  const asset = createdAsset.asset;
  const updated = await db.query(
    `UPDATE fixed_assets SET purchase_document_line_id = $2, updated_at = now()
      WHERE id = $1 AND company_id = $3 AND purchase_document_line_id IS NULL`,
    [asset.id, lineId, companyId],
  );
  if (updated.rowCount === 0) {
    throw conflict('FIXED_ASSET_ALREADY_LINKED', 'This purchase line is already linked to a fixed asset');
  }
  await recordPurchaseEvent(db, companyId, 'document', documentId, 'document.fixed_asset.created', userId, {
    lineId,
    assetId: asset.id,
    assetCode: asset.assetCode,
  });
  await writeAudit(db, {
    companyId,
    userId,
    action: 'purchases.line.fixed_asset.create',
    entityType: 'purchase_document_line',
    entityId: lineId,
    details: { documentId, assetId: asset.id, assetCode: asset.assetCode },
  });
  const assetView = await getAsset(db, companyId, asset.id);
  return {
    asset: assetView.asset,
    document: await getPurchaseDocument(db, companyId, documentId),
  };
}
