import type { Db } from '../../db/index.js';
import { AppError, badRequest, conflict, notFound } from '../../lib/errors.js';
import { writeAudit } from '../../lib/audit.js';
import { parseIsoDate } from '../../lib/dates.js';
import { decimalPlaces, formatAmount, parseAmount } from '../../lib/money.js';

/**
 * Billing domain service - exact decimal math, numbered sequences, balances.
 *
 * Nothing here talks to the accounting engine: a billing document is a
 * commercial document, and posting it is a separate, explicit operation
 * (see `modules/ai/proposals.ts`).
 */

// ---------------------------------------------------------------------------
// Money helpers (BigInt, scale 4 - same representation as numeric(20,4))
// ---------------------------------------------------------------------------

const SCALE = 4n;
const FACTOR = 10n ** SCALE;
const HUNDRED = 100n;

function divRound(numerator: bigint, denominator: bigint): bigint {
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  const absRemainder = remainder < 0n ? -remainder : remainder;
  if (absRemainder * 2n >= denominator) return quotient + (numerator < 0n ? -1n : 1n);
  return quotient;
}

/** Multiplies two amounts expressed with 4 decimals (quantity x unit price). */
export function mulMoney(a: bigint, b: bigint): bigint {
  return divRound(a * b, FACTOR);
}

/** `amount` (scale 4) x `percent` (scale 4) / 100, rounded to scale 4. */
export function applyPercent(amount: bigint, percent: bigint): bigint {
  return divRound(amount * percent, HUNDRED * FACTOR);
}

export function money(value: string | number, field: string): bigint {
  try {
    if (decimalPlaces(value) > 4) {
      throw badRequest('VALIDATION_ERROR', `${field} is limited to 4 decimal places`);
    }
    const parsed = parseAmount(value);
    if (parsed < 0n) throw badRequest('VALIDATION_ERROR', `${field} must be positive`);
    return parsed;
  } catch (err) {
    if (err && typeof err === 'object' && 'status' in err) throw err;
    throw badRequest('VALIDATION_ERROR', `Invalid amount for ${field}`);
  }
}

// ---------------------------------------------------------------------------
// VAT configuration: never invented, never assumed
// ---------------------------------------------------------------------------

export type VatTreatment = 'standard' | 'zero_rated' | 'exempt' | 'out_of_scope';

export interface TaxRateRow {
  id: string;
  company_id: string;
  code: string;
  label: string;
  rate: string;
  effective_from: string;
  effective_to: string | null;
  verified: boolean;
}

export interface ItemRow {
  id: string;
  company_id: string;
  reference: string;
  label_fr: string;
  label_en: string | null;
  description: string | null;
  unit_price: string;
  currency: string;
  unit: string;
  category: string | null;
  vat_treatment: VatTreatment;
  vat_rate_id: string | null;
  revenue_account_id: string | null;
  is_active: boolean;
}

export interface PreparedLine {
  lineNo: number;
  itemId: string | null;
  description: string;
  quantity: bigint;
  unitPrice: bigint;
  unit: string;
  discountPct: bigint;
  vatTreatment: VatTreatment;
  vatRate: bigint | null;
  vatRateId: string | null;
  netAmount: bigint;
  discountAmount: bigint;
  taxAmount: bigint;
  lineTotal: bigint;
  revenueAccountId: string | null;
}

export interface LineRequest {
  itemId?: string | null;
  description?: string | null;
  quantity: string | number;
  unitPrice?: string | number | null;
  unit?: string | null;
  discountPct?: string | number | null;
  vatTreatment?: VatTreatment | null;
  vatRateId?: string | null;
  revenueAccountId?: string | null;
}

export interface DocumentContext {
  companyId: string;
  issueDate: string;
  currency: string;
  vatEnabled: boolean;
  taxRates: Map<string, TaxRateRow>;
  items: Map<string, ItemRow>;
  defaultRevenueAccountId: string | null;
}

/**
 * Resolves the VAT treatment and rate of one line.
 *
 * - `standard` requires a *verified*, dated configuration applicable on the
 *   issue date: no rate is ever inferred, and an unverified row is refused;
 * - `zero_rated`, `exempt` and `out_of_scope` are distinct qualifications and
 *   are stored as such (a 0% line is never silently the same as "unknown");
 * - if VAT is disabled for the company, only non-standard treatments are
 *   accepted, so no tax is computed by accident.
 */
function resolveVat(
  line: LineRequest,
  ctx: DocumentContext,
): { treatment: VatTreatment; rate: bigint | null; rateId: string | null; warnings: string[] } {
  const item = line.itemId ? ctx.items.get(line.itemId) : undefined;
  const treatment: VatTreatment =
    line.vatTreatment ?? item?.vat_treatment ?? ('standard' as VatTreatment);
  const rateId = line.vatRateId ?? item?.vat_rate_id ?? null;
  const warnings: string[] = [];

  if (treatment !== 'standard') {
    if (rateId || (line.vatTreatment === undefined && item?.vat_rate_id)) {
      throw badRequest('VALIDATION_ERROR', 'A VAT rate cannot be attached to a non-standard treatment', [
        { path: 'vatRateId', message: 'Remove the rate or use the standard treatment' },
      ]);
    }
    warnings.push(
      treatment === 'zero_rated'
        ? 'VAT_ZERO_RATED: 0% zero-rated supply - the legal qualification must be confirmed by the cabinet.'
        : treatment === 'exempt'
          ? 'VAT_EXEMPT: exempt supply - the legal qualification must be confirmed by the cabinet.'
          : 'VAT_OUT_OF_SCOPE: out-of-scope operation - the legal qualification must be confirmed by the cabinet.',
    );
    return { treatment, rate: null, rateId: null, warnings };
  }

  if (!ctx.vatEnabled) {
    throw conflict(
      'VAT_NOT_CONFIGURED',
      'VAT is not enabled for this company: configure a verified rate or use an explicit non-standard treatment',
    );
  }
  if (!rateId) {
    throw conflict(
      'VAT_NOT_CONFIGURED',
      'No VAT rate is configured for this line: no rate is ever assumed',
    );
  }
  const rate = ctx.taxRates.get(rateId);
  if (!rate) {
    throw badRequest('VAT_RATE_NOT_FOUND', 'The selected VAT rate does not belong to this company');
  }
  if (!rate.verified) {
    throw conflict(
      'VAT_RATE_NOT_VERIFIED',
      `VAT rate "${rate.code}" is not verified yet: a professional must confirm it before any computation`,
    );
  }
  if (ctx.issueDate < rate.effective_from || (rate.effective_to && ctx.issueDate > rate.effective_to)) {
    throw conflict(
      'VAT_RATE_NOT_APPLICABLE',
      `VAT rate "${rate.code}" is not applicable on ${ctx.issueDate}`,
    );
  }
  const parsed = parseAmount(rate.rate);
  if (parsed < 0n || parsed > parseAmount('100')) {
    throw conflict('VAT_RATE_NOT_VERIFIED', `VAT rate "${rate.code}" has an invalid value`);
  }
  return { treatment, rate: parsed, rateId: rate.id, warnings: [] };
}

export interface DocumentComputation {
  lines: PreparedLine[];
  subtotal: bigint;
  discountTotal: bigint;
  taxTotal: bigint;
  total: bigint;
  warnings: string[];
}

export function computeDocument(lines: LineRequest[], ctx: DocumentContext): DocumentComputation {
  if (!Array.isArray(lines) || lines.length === 0) {
    throw badRequest('VALIDATION_ERROR', 'A document needs at least one line');
  }
  if (lines.length > 200) throw badRequest('VALIDATION_ERROR', 'Too many lines (max 200)');

  const warnings = new Set<string>();
  const prepared: PreparedLine[] = lines.map((line, index) => {
    const item = line.itemId ? ctx.items.get(line.itemId) : undefined;
    if (line.itemId && !item) {
      throw badRequest('VALIDATION_ERROR', 'Item does not belong to this company', [
        { path: `lines.${index}.itemId`, message: 'Unknown item' },
      ]);
    }
    const description = (line.description ?? item?.label_fr ?? '').trim();
    if (!description) {
      throw badRequest('VALIDATION_ERROR', 'A line description is required', [
        { path: `lines.${index}.description`, message: 'Description required' },
      ]);
    }
    const quantity = money(line.quantity, 'quantity');
    if (quantity <= 0n) {
      throw badRequest('VALIDATION_ERROR', 'Quantity must be greater than zero', [
        { path: `lines.${index}.quantity`, message: 'Quantity must be positive' },
      ]);
    }
    const rawUnitPrice = line.unitPrice ?? item?.unit_price;
    if (rawUnitPrice === undefined || rawUnitPrice === null || rawUnitPrice === '') {
      throw badRequest('VALIDATION_ERROR', 'A unit price is required', [
        { path: `lines.${index}.unitPrice`, message: 'Unit price required' },
      ]);
    }
    const unitPrice = money(rawUnitPrice, 'unitPrice');
    const discountPct = line.discountPct === undefined || line.discountPct === null || line.discountPct === ''
      ? 0n
      : money(line.discountPct, 'discountPct');
    if (discountPct > parseAmount('100')) {
      throw badRequest('VALIDATION_ERROR', 'A discount cannot exceed 100%', [
        { path: `lines.${index}.discountPct`, message: 'Invalid discount' },
      ]);
    }

    const vat = resolveVat(line, ctx);
    for (const w of vat.warnings) warnings.add(w);

    const netAmount = mulMoney(quantity, unitPrice);
    const discountAmount = applyPercent(netAmount, discountPct);
    const taxable = netAmount - discountAmount;
    const taxAmount = vat.rate === null ? 0n : applyPercent(taxable, vat.rate);
    const lineTotal = taxable + taxAmount;

    const revenueAccountId =
      line.revenueAccountId ?? item?.revenue_account_id ?? ctx.defaultRevenueAccountId;
    if (!revenueAccountId) {
      warnings.add(
        'REVENUE_ACCOUNT_MISSING: no revenue account is mapped to this line; accounting will require a human decision.',
      );
    }

    return {
      lineNo: index + 1,
      itemId: line.itemId ?? null,
      description,
      quantity,
      unitPrice,
      unit: (line.unit ?? item?.unit ?? 'unit').trim() || 'unit',
      discountPct,
      vatTreatment: vat.treatment,
      vatRate: vat.rate,
      vatRateId: vat.rateId,
      netAmount,
      discountAmount,
      taxAmount,
      lineTotal,
      revenueAccountId,
    };
  });

  const subtotal = prepared.reduce((acc, l) => acc + l.netAmount, 0n);
  const discountTotal = prepared.reduce((acc, l) => acc + l.discountAmount, 0n);
  const taxTotal = prepared.reduce((acc, l) => acc + l.taxAmount, 0n);
  const total = prepared.reduce((acc, l) => acc + l.lineTotal, 0n);
  return { lines: prepared, subtotal, discountTotal, taxTotal, total, warnings: [...warnings] };
}

// ---------------------------------------------------------------------------
// Context loading
// ---------------------------------------------------------------------------

/** Codes of the demonstration chart used as *fallbacks only*: the proposal
 * always resolves a real, active account of the company, never a hard-coded id. */
const DEFAULTS = {
  receivable: '1100',
  revenue: '4010',
  vatOutput: '2200',
} as const;

export interface CompanyBillingContext {
  settings: {
    quote_prefix: string;
    invoice_prefix: string;
    credit_prefix: string;
    numbering_policy: 'yearly' | 'continuous';
    default_payment_terms: number;
    default_currency: string;
    vat_enabled: boolean;
    vat_number: string | null;
    legal_footer_fr: string | null;
    legal_footer_en: string | null;
    bank_details: string | null;
  };
  accounts: { id: string; code: string; name: string; type: string; is_active: boolean }[];
  accountsByCode: Map<string, { id: string; code: string; name: string; type: string; is_active: boolean }>;
  taxRates: Map<string, TaxRateRow>;
  items: Map<string, ItemRow>;
  defaultRevenueAccountId: string | null;
}

export async function ensureBillingSettings(tx: Db, companyId: string): Promise<void> {
  const currency = await tx.query<{ functional_currency: string }>(
    'SELECT functional_currency FROM companies WHERE id = $1',
    [companyId],
  );
  await tx.query(
    `INSERT INTO billing_settings (company_id, default_currency)
     VALUES ($1, $2)
     ON CONFLICT (company_id) DO NOTHING`,
    [companyId, currency.rows[0]?.functional_currency ?? 'MUR'],
  );
}

export async function loadBillingContext(tx: Db, companyId: string): Promise<CompanyBillingContext> {
  await ensureBillingSettings(tx, companyId);
  const settingsRes = await tx.query<any>('SELECT * FROM billing_settings WHERE company_id = $1', [companyId]);
  const settings = settingsRes.rows[0]!;

  const accountsRes = await tx.query<{ id: string; code: string; name: string; type: string; is_active: boolean }>(
    'SELECT id, code, name, type, is_active FROM accounts WHERE company_id = $1 ORDER BY code',
    [companyId],
  );
  const accountsByCode = new Map(accountsRes.rows.map((a) => [a.code, a]));

  const ratesRes = await tx.query<TaxRateRow>(
    'SELECT * FROM billing_tax_rates WHERE company_id = $1 ORDER BY effective_from DESC',
    [companyId],
  );
  const taxRates = new Map(ratesRes.rows.map((r) => [r.id, r]));

  const itemsRes = await tx.query<ItemRow>('SELECT * FROM billing_items WHERE company_id = $1', [companyId]);
  const items = new Map(itemsRes.rows.map((i) => [i.id, i]));

  const defaultRevenue =
    accountsByCode.get(DEFAULTS.revenue)?.id ??
    accountsRes.rows.find((a) => a.type === 'revenue' && a.is_active)?.id ??
    null;

  return {
    settings: settings as CompanyBillingContext['settings'],
    accounts: accountsRes.rows,
    accountsByCode,
    taxRates,
    items,
    defaultRevenueAccountId: defaultRevenue,
  };
}

export function accountForRole(
  ctx: CompanyBillingContext,
  role:
    | 'receivable'
    | 'revenue'
    | 'vatOutput'
    | 'vatInput'
    | 'bank'
    | 'cash'
    | 'payable'
    | 'otherLiabilities'
    | 'prepayment',
): { id: string; code: string; name: string } | null {
  const code =
    role === 'receivable'
      ? DEFAULTS.receivable
      : role === 'revenue'
        ? DEFAULTS.revenue
        : role === 'vatOutput'
          ? DEFAULTS.vatOutput
          : role === 'vatInput'
            ? '1200'
            : role === 'bank'
              ? '1010'
              : role === 'cash'
                ? '1000'
                : role === 'payable'
                  ? '2000'
                  : role === 'prepayment'
                    ? '1150'
                    : '2100';
  const direct = ctx.accountsByCode.get(code);
  if (direct && direct.is_active) return direct;
  // Supplier advances must land on a dedicated prepayment account. Never fall
  // back to "any asset", which could silently post to the bank account.
  if (role === 'prepayment') return null;
  const type =
    role === 'receivable' || role === 'bank' || role === 'cash'
    ? 'asset'
    : role === 'revenue'
      ? 'revenue'
      : 'liability';
  const candidate = ctx.accounts.find((a) => a.is_active && a.type === type);
  return candidate ?? null;
}

// ---------------------------------------------------------------------------
// Numbering: atomic, gap-free per company / kind / year
// ---------------------------------------------------------------------------

export type NumberKind = 'quote' | 'invoice' | 'credit_note' | 'payment';

export function sequenceYear(policy: 'yearly' | 'continuous', issueDate: string): number {
  return policy === 'continuous' ? 0 : Number(issueDate.slice(0, 4));
}

export function formatDocumentNumber(prefix: string, year: number, no: number, continuous: boolean): string {
  const seq = String(no).padStart(4, '0');
  return continuous ? `${prefix}-${seq}` : `${prefix}-${year}-${seq}`;
}

/**
 * Allocates the next number with a single atomic UPSERT. PostgreSQL serialises
 * the concurrent writers on the sequence row, so two documents can never share
 * a number even when issued at the same instant.
 */
export async function nextBillingNumber(
  tx: Db,
  companyId: string,
  kind: NumberKind,
  year: number,
): Promise<number> {
  const res = await tx.query<{ last_no: number }>(
    `INSERT INTO billing_number_sequences (company_id, kind, year, last_no)
     VALUES ($1, $2, $3, 1)
     ON CONFLICT (company_id, kind, year)
     DO UPDATE SET last_no = billing_number_sequences.last_no + 1
     RETURNING last_no`,
    [companyId, kind, year],
  );
  return Number(res.rows[0]!.last_no);
}

export function prefixFor(settings: CompanyBillingContext['settings'], kind: NumberKind): string {
  if (kind === 'quote') return settings.quote_prefix;
  if (kind === 'credit_note') return settings.credit_prefix;
  if (kind === 'payment') return 'REC';
  return settings.invoice_prefix;
}

// ---------------------------------------------------------------------------
// Loading documents
// ---------------------------------------------------------------------------

export interface DocumentRow {
  id: string;
  company_id: string;
  kind: 'quote' | 'invoice' | 'credit_note';
  doc_no: string | null;
  customer_id: string | null;
  customer_name: string;
  customer_brn: string | null;
  issue_date: string;
  due_date: string | null;
  currency: string;
  exchange_rate: string;
  total_amount: string;
  subtotal: string;
  discount_total: string;
  tax_total: string;
  amount_paid: string;
  credited_amount: string;
  payment_status: string;
  status: string;
  source_kind: string | null;
  source_document_id: string | null;
  valid_until: string | null;
  notes: string | null;
  terms: string | null;
  sequence_year: number | null;
  sequence_no: number | null;
  issued_at: string | null;
  locked_at: string | null;
  sent_at: string | null;
  accepted_at: string | null;
  refused_at: string | null;
  cancelled_at: string | null;
  accounting_entry_id: string | null;
  customer_snapshot: Record<string, unknown> | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export async function loadDocument(
  tx: Db,
  companyId: string,
  documentId: string,
): Promise<{ document: DocumentRow; lines: any[] }> {
  const res = await tx.query<DocumentRow>(
    `SELECT * FROM billing_documents WHERE id = $1 AND company_id = $2`,
    [documentId, companyId],
  );
  const document = res.rows[0];
  if (!document) throw notFound('DOCUMENT_NOT_FOUND', 'Billing document not found');
  const lines = await tx.query<any>(
    `SELECT * FROM billing_document_lines WHERE document_id = $1 ORDER BY line_no`,
    [documentId],
  );
  return { document, lines: lines.rows };
}

export async function loadCustomer(tx: Db, companyId: string, customerId: string): Promise<any> {
  const res = await tx.query(
    'SELECT * FROM billing_customers WHERE id = $1 AND company_id = $2',
    [customerId, companyId],
  );
  const customer = res.rows[0];
  if (!customer) throw notFound('CUSTOMER_NOT_FOUND', 'Customer not found');
  return customer;
}

// ---------------------------------------------------------------------------
// Balances and aging
// ---------------------------------------------------------------------------

export interface AgingBuckets {
  current: bigint;
  days1to30: bigint;
  days31to60: bigint;
  days61to90: bigint;
  over90: bigint;
  total: bigint;
}

function emptyBuckets(): AgingBuckets {
  return { current: 0n, days1to30: 0n, days31to60: 0n, days61to90: 0n, over90: 0n, total: 0n };
}

export function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  return Math.floor((b - a) / 86_400_000);
}

/** Outstanding amount of an invoice: total - payments - credit notes. */
export function outstandingOf(row: {
  total_amount: string;
  amount_paid: string;
  credited_amount: string;
}): bigint {
  const value =
    parseAmount(row.total_amount) - parseAmount(row.amount_paid) - parseAmount(row.credited_amount);
  return value > 0n ? value : 0n;
}

export interface AgingRow {
  customerId: string;
  customerName: string;
  currency: string;
  buckets: Record<keyof AgingBuckets, string>;
  invoiceCount: number;
}

export async function buildAging(
  db: Db,
  companyId: string,
  asOf: string,
  options: { customerId?: string } = {},
): Promise<{
  asOf: string;
  rows: AgingRow[];
  totals: Record<keyof AgingBuckets, string> | null;
  totalsByCurrency: { currency: string; buckets: Record<keyof AgingBuckets, string> }[];
}> {
  const params: unknown[] = [companyId, asOf];
  let filter = '';
  if (options.customerId) {
    params.push(options.customerId);
    filter = ` AND d.customer_id = $${params.length}`;
  }
  const res = await db.query<any>(
    `WITH calc AS (
       SELECT d.id, d.customer_id, d.customer_name, d.currency, d.total_amount, d.due_date,
              d.issue_date,
              COALESCE((
                SELECT SUM(a.amount) FROM billing_payment_allocations a
                  JOIN billing_payments p ON p.id = a.payment_id AND p.status = 'recorded'
                 WHERE a.invoice_id = d.id
                   AND (a.cancelled_at IS NULL OR a.cancelled_at::date > $2::date)
                   AND COALESCE(a.allocated_date, p.payment_date) <= $2::date
              ), 0) AS amount_paid,
              COALESCE((
                SELECT SUM(c.total_amount) FROM billing_documents c
                 WHERE c.kind = 'credit_note' AND c.source_document_id = d.id
                   AND c.status = 'issued' AND c.issue_date <= $2::date
              ), 0) AS credited_amount
         FROM billing_documents d
        WHERE d.company_id = $1 AND d.kind = 'invoice'
          AND d.status NOT IN ('draft', 'cancelled')
          AND d.issue_date <= $2::date${filter}
     )
     SELECT *, (total_amount - amount_paid - credited_amount)::text AS outstanding
       FROM calc
      WHERE total_amount - amount_paid - credited_amount > 0
      ORDER BY issue_date ASC`,
    params,
  );

  const byCustomer = new Map<string, AgingRow & { raw: AgingBuckets }>();
  const byCurrency = new Map<string, AgingBuckets>();

  for (const row of res.rows) {
    const outstanding = parseAmount(row.outstanding);
    if (outstanding === 0n) continue;
    const key = `${row.customer_id ?? 'unknown'}|${row.currency}`;
    let entry = byCustomer.get(key);
    if (!entry) {
      entry = {
        customerId: row.customer_id ?? 'unknown',
        customerName: row.customer_name,
        currency: row.currency,
        buckets: {} as Record<keyof AgingBuckets, string>,
        invoiceCount: 0,
        raw: emptyBuckets(),
      };
      byCustomer.set(key, entry);
    }
    let currencyTotals = byCurrency.get(row.currency);
    if (!currencyTotals) {
      currencyTotals = emptyBuckets();
      byCurrency.set(row.currency, currencyTotals);
    }
    const due = row.due_date ?? row.issue_date;
    const daysLate = daysBetween(due, asOf);
    const bucket: keyof AgingBuckets =
      daysLate <= 0
        ? 'current'
        : daysLate <= 30
          ? 'days1to30'
          : daysLate <= 60
            ? 'days31to60'
            : daysLate <= 90
              ? 'days61to90'
              : 'over90';
    entry.raw[bucket] += outstanding;
    entry.raw.total += outstanding;
    entry.invoiceCount += 1;
    currencyTotals[bucket] += outstanding;
    currencyTotals.total += outstanding;
  }

  const rows: AgingRow[] = [...byCustomer.values()]
    .sort((a, b) =>
      a.customerName === b.customerName
        ? a.currency.localeCompare(b.currency)
        : a.customerName > b.customerName
          ? 1
          : -1,
    )
    .map((entry) => ({
      customerId: entry.customerId,
      customerName: entry.customerName,
      currency: entry.currency,
      invoiceCount: entry.invoiceCount,
      buckets: {
        current: formatAmount(entry.raw.current),
        days1to30: formatAmount(entry.raw.days1to30),
        days31to60: formatAmount(entry.raw.days31to60),
        days61to90: formatAmount(entry.raw.days61to90),
        over90: formatAmount(entry.raw.over90),
        total: formatAmount(entry.raw.total),
      },
    }));

  const totalsByCurrency = [...byCurrency.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, buckets]) => ({
      currency,
      buckets: {
        current: formatAmount(buckets.current),
        days1to30: formatAmount(buckets.days1to30),
        days31to60: formatAmount(buckets.days31to60),
        days61to90: formatAmount(buckets.days61to90),
        over90: formatAmount(buckets.over90),
        total: formatAmount(buckets.total),
      },
    }));

  return {
    asOf,
    rows,
    // A single total is only meaningful when every row shares one currency.
    totals:
      totalsByCurrency.length === 1
        ? totalsByCurrency[0]!.buckets
        : totalsByCurrency.length === 0
          ? {
              current: '0.0000',
              days1to30: '0.0000',
              days31to60: '0.0000',
              days61to90: '0.0000',
              over90: '0.0000',
              total: '0.0000',
            }
          : null,
    totalsByCurrency,
  };
}

export interface CurrencyCustomerBalance {
  currency: string;
  invoiced: string;
  paid: string;
  credited: string;
  outstanding: string;
  unallocated: string;
  balance: string;
}

export async function customerBalance(
  db: Db,
  companyId: string,
  customerId: string,
  asOf: string,
): Promise<CurrencyCustomerBalance & { asOf: string; balances: CurrencyCustomerBalance[] }> {
  const invoices = await db.query<any>(
    `WITH calc AS (
       SELECT d.id, d.currency, d.total_amount::text,
              COALESCE((
                SELECT SUM(a.amount) FROM billing_payment_allocations a
                  JOIN billing_payments p ON p.id = a.payment_id AND p.status = 'recorded'
                 WHERE a.invoice_id = d.id
                   AND (a.cancelled_at IS NULL OR a.cancelled_at::date > $3::date)
                   AND COALESCE(a.allocated_date, p.payment_date) <= $3::date
              ), 0)::text AS amount_paid,
              COALESCE((
                SELECT SUM(c.total_amount) FROM billing_documents c
                 WHERE c.kind = 'credit_note' AND c.source_document_id = d.id
                   AND c.status = 'issued' AND c.issue_date <= $3::date
              ), 0)::text AS credited_amount
         FROM billing_documents d
        WHERE d.company_id = $1 AND d.customer_id = $2 AND d.kind = 'invoice'
          AND d.status NOT IN ('draft', 'cancelled') AND d.issue_date <= $3::date
     )
     SELECT currency, total_amount, amount_paid, credited_amount FROM calc`,
    [companyId, customerId, asOf],
  );
  const payments = await db.query<any>(
    `WITH calc AS (
       SELECT p.currency, p.amount::text,
              COALESCE((
                SELECT SUM(a.amount) FROM billing_payment_allocations a
                 WHERE a.payment_id = p.id
                   AND (a.cancelled_at IS NULL OR a.cancelled_at::date > $3::date)
                   AND COALESCE(a.allocated_date, p.payment_date) <= $3::date
              ), 0)::text AS allocated
         FROM billing_payments p
        WHERE p.company_id = $1 AND p.customer_id = $2 AND p.status = 'recorded'
          AND p.payment_date <= $3::date
     )
     SELECT currency, amount, allocated FROM calc`,
    [companyId, customerId, asOf],
  );

  const currencies = new Set<string>([
    ...invoices.rows.map((r) => r.currency),
    ...payments.rows.map((r) => r.currency),
  ]);
  const balances: CurrencyCustomerBalance[] = [...currencies].sort().map((currency) => {
    let invoiced = 0n;
    let paid = 0n;
    let credited = 0n;
    for (const row of invoices.rows.filter((r) => r.currency === currency)) {
      invoiced += parseAmount(row.total_amount);
      paid += parseAmount(row.amount_paid);
      credited += parseAmount(row.credited_amount);
    }
    let unallocated = 0n;
    for (const row of payments.rows.filter((r) => r.currency === currency)) {
      unallocated += parseAmount(row.amount) - parseAmount(row.allocated);
    }
    const outstanding = invoiced - paid - credited;
    return {
      currency,
      invoiced: formatAmount(invoiced),
      paid: formatAmount(paid),
      credited: formatAmount(credited),
      outstanding: formatAmount(outstanding > 0n ? outstanding : 0n),
      unallocated: formatAmount(unallocated > 0n ? unallocated : 0n),
      balance: formatAmount(outstanding - unallocated),
    };
  });
  const primary = balances[0] ?? {
    currency: 'MUR',
    invoiced: '0.0000',
    paid: '0.0000',
    credited: '0.0000',
    outstanding: '0.0000',
    unallocated: '0.0000',
    balance: '0.0000',
  };
  return { ...primary, asOf, balances };
}

/** Recomputes the paid/credited aggregates of an invoice from its allocations. */
export async function refreshInvoiceBalance(tx: Db, companyId: string, invoiceId: string): Promise<void> {
  const paid = await tx.query<any>(
    `SELECT COALESCE(SUM(a.amount), 0) AS total
       FROM billing_payment_allocations a
       JOIN billing_payments p ON p.id = a.payment_id AND p.status = 'recorded'
      WHERE a.invoice_id = $1
        AND a.cancelled_at IS NULL`,
    [invoiceId],
  );
  const credited = await tx.query<any>(
    `SELECT COALESCE(SUM(d.total_amount), 0) AS total
       FROM billing_documents d
      WHERE d.company_id = $1 AND d.kind = 'credit_note' AND d.source_document_id = $2
        AND d.status = 'issued'`,
    [companyId, invoiceId],
  );
  const doc = await tx.query<any>(
    'SELECT status, total_amount FROM billing_documents WHERE id = $1 AND company_id = $2',
    [invoiceId, companyId],
  );
  const row = doc.rows[0];
  if (!row) return;
  const paidTotal = parseAmount(paid.rows[0]?.total ?? '0');
  const creditedTotal = parseAmount(credited.rows[0]?.total ?? '0');
  const total = parseAmount(row.total_amount);
  const settled = paidTotal + creditedTotal;
  const paymentStatus =
    settled >= total ? (settled > total ? 'overpaid' : 'paid') : settled > 0n ? 'partial' : 'unpaid';
  const status =
    row.status === 'cancelled' || row.status === 'draft'
      ? row.status
      : settled >= total
        ? 'paid'
        : settled > 0n
          ? 'partially_paid'
          : 'issued';
  await tx.query(
    `UPDATE billing_documents
        SET amount_paid = $1, credited_amount = $2, payment_status = $3, status = $4, updated_at = now()
      WHERE id = $5 AND company_id = $6`,
    [formatAmount(paidTotal), formatAmount(creditedTotal), paymentStatus, status, invoiceId, companyId],
  );
}

async function refreshBillingPaymentUnallocated(
  tx: Db,
  companyId: string,
  paymentId: string,
): Promise<void> {
  const payment = await tx.query<any>(
    'SELECT amount FROM billing_payments WHERE id = $1 AND company_id = $2 FOR UPDATE',
    [paymentId, companyId],
  );
  if (!payment.rows[0]) return;
  const active = await tx.query<any>(
    `SELECT COALESCE(SUM(amount), 0) AS total
       FROM billing_payment_allocations
      WHERE payment_id = $1 AND cancelled_at IS NULL`,
    [paymentId],
  );
  const remaining = parseAmount(payment.rows[0].amount) - parseAmount(active.rows[0]?.total ?? '0');
  await tx.query(
    `UPDATE billing_payments SET unallocated_amount = $2, updated_at = now()
      WHERE id = $1 AND company_id = $3`,
    [paymentId, formatAmount(remaining > 0n ? remaining : 0n), companyId],
  );
}

/**
 * Mission 42 — allocate an existing customer over-payment to a later invoice.
 * The payment entry is never rewritten. If it is already posted, the caller
 * receives `reclassRequired` and prepares a separate, validated proposal.
 */
export async function allocateBillingPayment(
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
  payment: any;
  invoice: any;
  allocationId: string;
  reclassRequired: boolean;
}> {
  const value = parseAmount(String(input.amount));
  if (value <= 0n) throw badRequest('ALLOCATION_INVALID', 'An allocation must be greater than zero');
  const allocationDate = input.allocationDate
    ? parseIsoDate(input.allocationDate, 'allocationDate')
    : new Date().toISOString().slice(0, 10);
  const result = await db.transaction(async (tx) => {
    const paymentRes = await tx.query<any>(
      'SELECT * FROM billing_payments WHERE id = $1 AND company_id = $2 FOR UPDATE',
      [paymentId, companyId],
    );
    const payment = paymentRes.rows[0];
    if (!payment) throw notFound('PAYMENT_NOT_FOUND', 'Payment not found');
    if (payment.status !== 'recorded') throw conflict('DOCUMENT_STATUS_INVALID', 'Cancelled payment');
    const invoiceRes = await tx.query<any>(
      `SELECT * FROM billing_documents
        WHERE id = $1 AND company_id = $2 AND kind = 'invoice' FOR UPDATE`,
      [input.invoiceId, companyId],
    );
    const invoice = invoiceRes.rows[0];
    if (!invoice) throw notFound('DOCUMENT_NOT_FOUND', 'Invoice not found');
    if (!['issued', 'partially_paid'].includes(invoice.status)) {
      throw conflict('ALLOCATION_INVALID', 'The invoice is not open for payment');
    }
    if (invoice.customer_id !== payment.customer_id) {
      throw badRequest('ALLOCATION_INVALID', 'The invoice belongs to another customer');
    }
    if (invoice.currency !== payment.currency) {
      throw badRequest('CURRENCY_MISMATCH', 'The payment and invoice currencies differ');
    }
    if (allocationDate < payment.payment_date) {
      throw badRequest('ALLOCATION_INVALID', 'An allocation cannot predate the payment');
    }
    const active = await tx.query<any>(
      `SELECT COALESCE(SUM(amount), 0) AS total FROM billing_payment_allocations
        WHERE payment_id = $1 AND cancelled_at IS NULL`,
      [paymentId],
    );
    const available = parseAmount(payment.amount) - parseAmount(active.rows[0]?.total ?? '0');
    if (value > available) {
      throw new AppError('ALLOCATION_EXCEEDS_PAYMENT', 409, 'The allocation exceeds the unallocated payment amount', {
        available: formatAmount(available > 0n ? available : 0n),
        requested: formatAmount(value),
      });
    }
    const paid = await tx.query<any>(
      `SELECT COALESCE(SUM(amount), 0) AS total FROM billing_payment_allocations
        WHERE invoice_id = $1 AND cancelled_at IS NULL`,
      [invoice.id],
    );
    const credited = await tx.query<any>(
      `SELECT COALESCE(SUM(total_amount), 0) AS total FROM billing_documents
        WHERE company_id = $1 AND kind = 'credit_note' AND source_document_id = $2
          AND status = 'issued'`,
      [companyId, invoice.id],
    );
    const outstanding =
      parseAmount(invoice.total_amount) - parseAmount(paid.rows[0]?.total ?? '0') - parseAmount(credited.rows[0]?.total ?? '0');
    if (value > outstanding) {
      throw new AppError('ALLOCATION_EXCEEDS_INVOICE', 409, 'The allocation exceeds the invoice outstanding', {
        outstanding: formatAmount(outstanding > 0n ? outstanding : 0n),
        requested: formatAmount(value),
      });
    }
    const priorUnallocated = parseAmount(payment.unallocated_amount);
    const reclassAmount = payment.accounting_entry_id
      ? (value < priorUnallocated ? value : priorUnallocated)
      : 0n;
    const existing = await tx.query<any>(
      `SELECT id, cancelled_at FROM billing_payment_allocations
        WHERE payment_id = $1 AND invoice_id = $2 FOR UPDATE`,
      [paymentId, invoice.id],
    );
    if (existing.rows[0]?.cancelled_at === null) {
      throw conflict('ALLOCATION_EXISTS', 'This payment is already allocated to this invoice');
    }
    let allocationId: string;
    if (existing.rows[0]) {
      const updated = await tx.query<any>(
        `UPDATE billing_payment_allocations
            SET amount = $2, allocated_date = $3, cancelled_at = NULL, cancelled_by = NULL,
                cancellation_reason = NULL, reclass_amount = $4
          WHERE id = $1 RETURNING id`,
        [existing.rows[0].id, formatAmount(value), allocationDate, formatAmount(reclassAmount)],
      );
      allocationId = updated.rows[0].id;
    } else {
      const inserted = await tx.query<any>(
        `INSERT INTO billing_payment_allocations
           (payment_id, invoice_id, company_id, amount, allocated_date, reclass_amount)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [paymentId, invoice.id, companyId, formatAmount(value), allocationDate, formatAmount(reclassAmount)],
      );
      allocationId = inserted.rows[0].id;
    }
    await refreshBillingPaymentUnallocated(tx, companyId, paymentId);
    await refreshInvoiceBalance(tx, companyId, invoice.id);
    await logDocumentEvent(tx, {
      companyId,
      documentId: invoice.id,
      action: 'payment.allocated',
      userId,
      details: { paymentId, allocationId, amount: formatAmount(value), allocationDate, reason: input.reason ?? null },
    });
    await writeAudit(tx, {
      companyId,
      userId,
      action: 'billing.payment.allocate',
      entityType: 'billing_payment_allocation',
      entityId: allocationId,
      details: { paymentId, invoiceId: invoice.id, amount: formatAmount(value), allocationDate },
    });
    return { allocationId, reclassRequired: reclassAmount > 0n };
  });
  const payment = (await db.query<any>('SELECT * FROM billing_payments WHERE id = $1', [paymentId])).rows[0];
  const invoice = (await loadDocument(db, companyId, input.invoiceId)).document;
  return { payment, invoice, allocationId: result.allocationId, reclassRequired: result.reclassRequired };
}

export async function cancelBillingPaymentAllocation(
  db: Db,
  companyId: string,
  userId: string,
  paymentId: string,
  allocationId: string,
  reason: string,
): Promise<{ payment: any; invoice: any }> {
  if (!reason.trim()) throw badRequest('VALIDATION_ERROR', 'A cancellation reason is required');
  const invoiceId = await db.transaction(async (tx) => {
    const allocation = await tx.query<any>(
      `SELECT * FROM billing_payment_allocations
        WHERE id = $1 AND payment_id = $2 AND company_id = $3 FOR UPDATE`,
      [allocationId, paymentId, companyId],
    );
    if (!allocation.rows[0]) throw notFound('ALLOCATION_NOT_FOUND', 'Allocation not found');
    if (allocation.rows[0].cancelled_at) return allocation.rows[0].invoice_id as string;
    if (allocation.rows[0].reclass_entry_id) {
      throw conflict('ALLOCATION_RECLASS_POSTED', 'Reverse the reclassification entry before cancelling this allocation');
    }
    await tx.query(
      `UPDATE billing_payment_allocations
          SET cancelled_at = now(), cancelled_by = $2, cancellation_reason = $3
        WHERE id = $1`,
      [allocationId, userId, reason.trim()],
    );
    await refreshBillingPaymentUnallocated(tx, companyId, paymentId);
    await refreshInvoiceBalance(tx, companyId, allocation.rows[0].invoice_id);
    await logDocumentEvent(tx, {
      companyId,
      documentId: allocation.rows[0].invoice_id,
      action: 'payment.allocation_cancelled',
      userId,
      details: { paymentId, allocationId, amount: allocation.rows[0].amount, reason: reason.trim() },
    });
    await writeAudit(tx, {
      companyId,
      userId,
      action: 'billing.payment.allocation.cancel',
      entityType: 'billing_payment_allocation',
      entityId: allocationId,
      details: { paymentId, reason: reason.trim() },
    });
    return allocation.rows[0].invoice_id as string;
  });
  return {
    payment: (await db.query<any>('SELECT * FROM billing_payments WHERE id = $1', [paymentId])).rows[0],
    invoice: (await loadDocument(db, companyId, invoiceId)).document,
  };
}

export async function logDocumentEvent(
  tx: Db,
  params: {
    companyId: string;
    documentId: string;
    action: string;
    userId: string;
    details?: Record<string, unknown>;
  },
): Promise<void> {
  await tx.query(
    `INSERT INTO billing_document_events (document_id, company_id, action, actor_id, details)
     VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [params.documentId, params.companyId, params.action, params.userId, JSON.stringify(params.details ?? {})],
  );
}
