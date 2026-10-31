import type { Db } from '../../db/index.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { writeAudit } from '../../lib/audit.js';
import { formatAmount, multiply, parseAmount } from '../../lib/money.js';
import {
  addDays,
  addMonths,
  amount,
  computeSchedule,
  iso,
  max,
  monthEnd,
  monthStart,
  parseDate,
  parseRate8,
  rateToString8,
  type DepreciationContext,
  type DepreciationMethod,
  type EstimateParams,
  type ScheduleLine,
} from './depreciation.js';

export interface AssetActor {
  companyId: string;
  userId: string;
  ip?: string | null;
  locale?: 'fr' | 'en';
}

export interface CategoryInput {
  code: string;
  nameEn: string;
  nameFr: string;
  isDepreciable?: boolean;
  defaultMethod?: DepreciationMethod | null;
  defaultUsefulLifeMonths?: number | null;
  defaultResidualValue?: string | number | null;
  defaultReducingRate?: string | number | null;
  assetAccountId?: string | null;
  accumulatedDepreciationAccountId?: string | null;
  depreciationExpenseAccountId?: string | null;
  accumulatedImpairmentAccountId?: string | null;
  impairmentLossAccountId?: string | null;
  impairmentReversalAccountId?: string | null;
  disposalGainAccountId?: string | null;
  disposalLossAccountId?: string | null;
  cwipAccountId?: string | null;
  isActive?: boolean;
}

export interface AssetInput {
  assetCode?: string | null;
  categoryId: string;
  description: string;
  serialNumber?: string | null;
  location?: string | null;
  acquisitionDate: string;
  inServiceDate?: string | null;
  supplierName?: string | null;
  invoiceRef?: string | null;
  documentRef?: string | null;
  cost: string | number;
  attributableCosts?: string | number | null;
  residualValue?: string | number | null;
  currency?: string;
  exchangeRate?: string | number | null;
  fxNote?: string | null;
  method?: DepreciationMethod | null;
  usefulLifeMonths?: number | null;
  reducingRate?: string | number | null;
  depreciationStartDate?: string | null;
  responsibleUserId?: string | null;
  notes?: string | null;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const firstDayOfMonth = (value: string) => value.slice(8, 10) === '01';

function checkIso(value: string, field: string): string {
  if (!ISO.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw badRequest('FIXED_ASSET_DATES_INVALID', `${field} must be a valid date (YYYY-MM-DD)`);
  }
  return value;
}

/** Exact functional-currency cost (cost + attributable costs). */
export function functionalCost(cost: string | number, attributable: string | number | null | undefined, rate: string): bigint {
  const total = parseAmount(cost) + parseAmount(attributable ?? 0);
  return multiply(total, String(rate));
}

export function functionalResidual(residual: string | number | null | undefined, rate: string): bigint {
  return multiply(parseAmount(residual ?? 0), String(rate));
}

async function cabinetIdOf(db: Db, companyId: string): Promise<string> {
  const res = await db.query<{ cabinet_id: string }>('SELECT cabinet_id FROM companies WHERE id = $1', [companyId]);
  if (!res.rows[0]) throw notFound('COMPANY_NOT_FOUND', 'Company not found');
  return res.rows[0].cabinet_id;
}

async function audit(db: Db, actor: AssetActor, action: string, entityType: string, entityId: string, details: Record<string, unknown> = {}) {
  await writeAudit(db, { companyId: actor.companyId, userId: actor.userId, action, entityType, entityId, details, ip: actor.ip ?? null });
}

export async function nextAssetCode(db: Db, companyId: string, year: number): Promise<string> {
  const res = await db.query<{ last_no: number }>(
    `INSERT INTO fixed_asset_sequences (company_id, year, last_no) VALUES ($1, $2, 1)
     ON CONFLICT (company_id, year) DO UPDATE SET last_no = fixed_asset_sequences.last_no + 1
     RETURNING last_no`, [companyId, year]);
  return `FA-${year}-${String(res.rows[0]!.last_no).padStart(4, '0')}`;
}

/* --------------------------------------------------------------- categories */

const CATEGORY_SELECT = `
  SELECT c.*, a.code AS asset_code, a.name AS asset_name,
         d.code AS dep_account_code, d.name AS dep_account_name,
         e.code AS expense_code, e.name AS expense_name,
         ai.code AS accum_impairment_code, ai.name AS accum_impairment_name,
         il.code AS impairment_loss_code, il.name AS impairment_loss_name,
         ir.code AS impairment_reversal_code, ir.name AS impairment_reversal_name,
         dg.code AS disposal_gain_code, dg.name AS disposal_gain_name,
         dl.code AS disposal_loss_code, dl.name AS disposal_loss_name,
         cw.code AS cwip_code, cw.name AS cwip_name
    FROM fixed_asset_categories c
    LEFT JOIN accounts a ON a.id = c.asset_account_id
    LEFT JOIN accounts d ON d.id = c.accumulated_depreciation_account_id
    LEFT JOIN accounts e ON e.id = c.depreciation_expense_account_id
    LEFT JOIN accounts ai ON ai.id = c.accumulated_impairment_account_id
    LEFT JOIN accounts il ON il.id = c.impairment_loss_account_id
    LEFT JOIN accounts ir ON ir.id = c.impairment_reversal_account_id
    LEFT JOIN accounts dg ON dg.id = c.disposal_gain_account_id
    LEFT JOIN accounts dl ON dl.id = c.disposal_loss_account_id
    LEFT JOIN accounts cw ON cw.id = c.cwip_account_id
`;
function categoryView(row: any) {
  const account = (id: string | null, code: string | null, name: string | null) =>
    id ? { id, code, name } : null;
  return {
    id: row.id, code: row.code, nameEn: row.name_en, nameFr: row.name_fr,
    isDepreciable: row.is_depreciable, isActive: row.is_active,
    defaultMethod: row.default_method, defaultUsefulLifeMonths: row.default_useful_life_months,
    defaultResidualValue: row.default_residual_value, defaultReducingRate: row.default_reducing_rate,
    accounts: {
      asset: account(row.asset_account_id, row.asset_code, row.asset_name),
      accumulatedDepreciation: account(row.accumulated_depreciation_account_id, row.dep_account_code, row.dep_account_name),
      depreciationExpense: account(row.depreciation_expense_account_id, row.expense_code, row.expense_name),
      accumulatedImpairment: account(row.accumulated_impairment_account_id, row.accum_impairment_code, row.accum_impairment_name),
      impairmentLoss: account(row.impairment_loss_account_id, row.impairment_loss_code, row.impairment_loss_name),
      impairmentReversal: account(row.impairment_reversal_account_id, row.impairment_reversal_code, row.impairment_reversal_name),
      disposalGain: account(row.disposal_gain_account_id, row.disposal_gain_code, row.disposal_gain_name),
      disposalLoss: account(row.disposal_loss_account_id, row.disposal_loss_code, row.disposal_loss_name),
      cwip: account(row.cwip_account_id, row.cwip_code, row.cwip_name),
    },
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}
export async function listCategories(db: Db, companyId: string) {
  const res = await db.query<any>(`${CATEGORY_SELECT} WHERE c.company_id = $1 ORDER BY c.code`, [companyId]);
  return res.rows.map(categoryView);
}
export async function getCategoryRow(db: Db, companyId: string, id: string) {
  const res = await db.query<any>('SELECT * FROM fixed_asset_categories WHERE id = $1 AND company_id = $2', [id, companyId]);
  if (!res.rows[0]) throw notFound('FIXED_ASSET_CATEGORY_NOT_FOUND', 'Fixed asset category not found');
  return res.rows[0];
}
export async function getCategory(db: Db, companyId: string, id: string) {
  const res = await db.query<any>(`${CATEGORY_SELECT} WHERE c.id = $1 AND c.company_id = $2`, [id, companyId]);
  if (!res.rows[0]) throw notFound('FIXED_ASSET_CATEGORY_NOT_FOUND', 'Fixed asset category not found');
  return categoryView(res.rows[0]);
}

async function assertAccount(db: Db, companyId: string, id: string | null | undefined, types: string[], requiredLabel?: string) {
  if (!id) {
    if (requiredLabel) throw badRequest('FIXED_ASSET_CATEGORY_ACCOUNTS_REQUIRED', `${requiredLabel} account is required`);
    return;
  }
  const res = await db.query<any>('SELECT id, type, is_active FROM accounts WHERE id = $1 AND company_id = $2', [id, companyId]);
  const row = res.rows[0];
  if (!row) throw badRequest('FIXED_ASSET_ACCOUNT_INVALID', 'Account does not belong to this company');
  if (!row.is_active) throw badRequest('FIXED_ASSET_ACCOUNT_INVALID', 'Account is inactive');
  if (!types.includes(row.type)) throw badRequest('FIXED_ASSET_ACCOUNT_INVALID', 'Account type is not valid for this use');
}

async function validateCategory(db: Db, companyId: string, input: CategoryInput) {
  const code = String(input.code ?? '').trim().toUpperCase();
  if (!/^[A-Z0-9_-]{2,20}$/.test(code)) throw badRequest('VALIDATION_ERROR', 'Category code is invalid');
  const nameEn = String(input.nameEn ?? '').trim();
  const nameFr = String(input.nameFr ?? '').trim();
  if (nameEn.length < 2 || nameFr.length < 2) throw badRequest('VALIDATION_ERROR', 'Both category names are required');
  if (input.defaultMethod && !['straight_line', 'reducing_balance'].includes(input.defaultMethod)) {
    throw badRequest('FIXED_ASSET_METHOD_INVALID', 'Invalid depreciation method');
  }
  if (input.defaultUsefulLifeMonths !== undefined && input.defaultUsefulLifeMonths !== null && input.defaultUsefulLifeMonths <= 0) {
    throw badRequest('FIXED_ASSET_LIFE_INVALID', 'Useful life must be positive');
  }
  const residual = input.defaultResidualValue === null || input.defaultResidualValue === undefined ? 0n : parseAmount(input.defaultResidualValue);
  if (residual < 0n) throw badRequest('FIXED_ASSET_RESIDUAL_INVALID', 'Residual value cannot be negative');
  let rate: string | null = null;
  if (input.defaultReducingRate !== undefined && input.defaultReducingRate !== null && input.defaultReducingRate !== '') {
    const parsed = parseRate8(input.defaultReducingRate);
    if (parsed <= 0n || parsed > 10n ** 8n) throw badRequest('FIXED_ASSET_RATE_REQUIRED', 'Rate must be between 0 and 1');
    rate = rateToString8(parsed);
  }
  await assertAccount(db, companyId, input.assetAccountId, ['asset']);
  await assertAccount(db, companyId, input.accumulatedDepreciationAccountId, ['asset', 'liability']);
  await assertAccount(db, companyId, input.depreciationExpenseAccountId, ['expense']);
  await assertAccount(db, companyId, input.accumulatedImpairmentAccountId, ['asset', 'liability']);
  await assertAccount(db, companyId, input.impairmentLossAccountId, ['expense']);
  await assertAccount(db, companyId, input.impairmentReversalAccountId, ['revenue']);
  await assertAccount(db, companyId, input.disposalGainAccountId, ['revenue']);
  await assertAccount(db, companyId, input.disposalLossAccountId, ['expense']);
  await assertAccount(db, companyId, input.cwipAccountId, ['asset']);
  return { code, nameEn, nameFr, residual, rate };
}

export async function createCategory(db: Db, actor: AssetActor, input: CategoryInput) {
  const v = await validateCategory(db, actor.companyId, input);
  const cabinetId = await cabinetIdOf(db, actor.companyId);
  const dup = await db.query('SELECT 1 FROM fixed_asset_categories WHERE company_id = $1 AND code = $2', [actor.companyId, v.code]);
  if (dup.rowCount > 0) throw conflict('FIXED_ASSET_CATEGORY_CODE_TAKEN', 'This category code already exists');
  const res = await db.query<{ id: string }>(
    `INSERT INTO fixed_asset_categories
      (cabinet_id, company_id, code, name_en, name_fr, is_depreciable, default_method,
       default_useful_life_months, default_residual_value, default_reducing_rate,
       asset_account_id, accumulated_depreciation_account_id, depreciation_expense_account_id,
       accumulated_impairment_account_id, impairment_loss_account_id, impairment_reversal_account_id,
       disposal_gain_account_id, disposal_loss_account_id, cwip_account_id, is_active)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
     RETURNING id`,
    [cabinetId, actor.companyId, v.code, v.nameEn, v.nameFr, input.isDepreciable ?? true,
      input.defaultMethod ?? null, input.defaultUsefulLifeMonths ?? null, formatAmount(v.residual), v.rate,
      input.assetAccountId ?? null, input.accumulatedDepreciationAccountId ?? null,
      input.depreciationExpenseAccountId ?? null, input.accumulatedImpairmentAccountId ?? null,
      input.impairmentLossAccountId ?? null, input.impairmentReversalAccountId ?? null,
      input.disposalGainAccountId ?? null, input.disposalLossAccountId ?? null,
      input.cwipAccountId ?? null, input.isActive ?? true]);
  await db.transaction(async (tx) => {
    await audit(tx, actor, 'fixed_asset.category.create', 'fixed_asset_category', res.rows[0]!.id, { code: v.code });
  });
  return getCategory(db, actor.companyId, res.rows[0]!.id);
}

export async function updateCategory(db: Db, actor: AssetActor, id: string, input: CategoryInput) {
  const existing = await getCategoryRow(db, actor.companyId, id);
  const v = await validateCategory(db, actor.companyId, input);
  if (v.code !== existing.code) {
    const dup = await db.query('SELECT 1 FROM fixed_asset_categories WHERE company_id = $1 AND code = $2 AND id <> $3', [actor.companyId, v.code, id]);
    if (dup.rowCount > 0) throw conflict('FIXED_ASSET_CATEGORY_CODE_TAKEN', 'This category code already exists');
  }
  await db.transaction(async (tx) => {
    await tx.query(
      `UPDATE fixed_asset_categories SET code=$2, name_en=$3, name_fr=$4, is_depreciable=$5,
         default_method=$6, default_useful_life_months=$7, default_residual_value=$8,
         default_reducing_rate=$9, asset_account_id=$10, accumulated_depreciation_account_id=$11,
         depreciation_expense_account_id=$12, accumulated_impairment_account_id=$13,
         impairment_loss_account_id=$14, impairment_reversal_account_id=$15,
         disposal_gain_account_id=$16, disposal_loss_account_id=$17, cwip_account_id=$18,
         is_active=$19, updated_at=now() WHERE id=$1`,
      [id, v.code, v.nameEn, v.nameFr, input.isDepreciable ?? true, input.defaultMethod ?? null,
        input.defaultUsefulLifeMonths ?? null, formatAmount(v.residual), v.rate,
        input.assetAccountId ?? null, input.accumulatedDepreciationAccountId ?? null,
        input.depreciationExpenseAccountId ?? null, input.accumulatedImpairmentAccountId ?? null,
        input.impairmentLossAccountId ?? null, input.impairmentReversalAccountId ?? null,
        input.disposalGainAccountId ?? null, input.disposalLossAccountId ?? null,
        input.cwipAccountId ?? null, input.isActive ?? true]);
    await audit(tx, actor, 'fixed_asset.category.update', 'fixed_asset_category', id, { code: v.code });
  });
  return getCategory(db, actor.companyId, id);
}

/** Standard category templates: names only, no statutory rate or account. */
export const CATEGORY_TEMPLATES = [
  { code: 'LAND_BUILDINGS', nameEn: 'Land and Buildings', nameFr: 'Terrains et constructions', isDepreciable: true },
  { code: 'PLANT_MACHINERY', nameEn: 'Plant and Machinery', nameFr: 'Installations et machines', isDepreciable: true },
  { code: 'MOTOR_VEHICLES', nameEn: 'Motor Vehicles', nameFr: 'Véhicules', isDepreciable: true },
  { code: 'FURNITURE_FIXTURES', nameEn: 'Furniture and Fixtures', nameFr: 'Mobilier et agencements', isDepreciable: true },
  { code: 'COMPUTER_EQUIPMENT', nameEn: 'Computer Equipment', nameFr: 'Matériel informatique', isDepreciable: true },
  { code: 'OFFICE_EQUIPMENT', nameEn: 'Office Equipment', nameFr: 'Matériel de bureau', isDepreciable: true },
  { code: 'INTANGIBLE', nameEn: 'Intangible Assets', nameFr: 'Immobilisations incorporelles', isDepreciable: true },
  { code: 'ASSETS_UNDER_CONSTRUCTION', nameEn: 'Assets Under Construction', nameFr: 'Immobilisations en cours', isDepreciable: false },
] as const;

/* ------------------------------------------------------------------- assets */

const ASSET_SELECT = `
  SELECT a.*, c.code AS category_code, c.name_en AS category_name_en, c.name_fr AS category_name_fr,
         c.is_depreciable, u.full_name AS responsible_name,
         COALESCE(dep.amount, 0)::text AS accumulated_depreciation,
         COALESCE(imp.amount, 0)::text AS accumulated_impairment
    FROM fixed_assets a
    JOIN fixed_asset_categories c ON c.id = a.category_id
    LEFT JOIN app_users u ON u.id = a.responsible_user_id
    LEFT JOIN (
      SELECT l.asset_id, SUM(l.amount) AS amount
        FROM fixed_asset_depreciation_lines l
        JOIN fixed_asset_depreciation_batches b ON b.id = l.batch_id
       WHERE b.status = 'POSTED'
       GROUP BY l.asset_id
    ) dep ON dep.asset_id = a.id
    LEFT JOIN (
      SELECT i.asset_id,
             SUM(CASE WHEN i.is_reversal THEN -i.amount ELSE i.amount END) AS amount
        FROM fixed_asset_impairments i
       WHERE i.status = 'POSTED'
       GROUP BY i.asset_id
    ) imp ON imp.asset_id = a.id
`;
function assetView(row: any) {
  const cost = parseAmount(row.cost) + parseAmount(row.attributable_costs);
  const functional = functionalCost(row.cost, row.attributable_costs, String(row.exchange_rate));
  const dep = parseAmount(row.accumulated_depreciation);
  const impair = parseAmount(row.accumulated_impairment);
  return {
    id: row.id, assetCode: row.asset_code, description: row.description,
    category: { id: row.category_id, code: row.category_code, nameEn: row.category_name_en, nameFr: row.category_name_fr, isDepreciable: row.is_depreciable },
    serialNumber: row.serial_number, location: row.location,
    acquisitionDate: row.acquisition_date, inServiceDate: row.in_service_date,
    supplierName: row.supplier_name, invoiceRef: row.invoice_ref, documentRef: row.document_ref,
    cost: formatAmount(parseAmount(row.cost)), attributableCosts: formatAmount(parseAmount(row.attributable_costs)),
    totalCost: formatAmount(cost), residualValue: formatAmount(parseAmount(row.residual_value)),
    currency: row.currency, exchangeRate: String(row.exchange_rate), fxNote: row.fx_note,
    functionalCost: formatAmount(functional),
    functionalResidual: formatAmount(functionalResidual(row.residual_value, String(row.exchange_rate))),
    method: row.method, usefulLifeMonths: row.useful_life_months, reducingRate: row.reducing_rate,
    depreciationStartDate: row.depreciation_start_date, depreciationEndDate: row.depreciation_end_date,
    status: row.status, suspendedFrom: row.suspended_from, suspendedTo: row.suspended_to,
    suspendedReason: row.suspended_reason,
    responsibleUserId: row.responsible_user_id, responsibleName: row.responsible_name,
    notes: row.notes,
    disposalDate: row.disposal_date, disposalProceeds: row.disposal_proceeds, disposalCosts: row.disposal_costs,
    accumulatedDepreciation: formatAmount(dep),
    accumulatedImpairment: formatAmount(impair),
    netBookValue: formatAmount(['disposed', 'written_off'].includes(row.status) ? 0n : functional - dep - impair),
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

export async function listAssets(db: Db, companyId: string, filters: { categoryId?: string; status?: string; asOf?: string } = {}) {
  const params: unknown[] = [companyId];
  let where = 'WHERE a.company_id = $1';
  if (filters.categoryId) { params.push(filters.categoryId); where += ` AND a.category_id = $${params.length}`; }
  if (filters.status) { params.push(filters.status); where += ` AND a.status = $${params.length}`; }
  if (filters.asOf) { params.push(filters.asOf); where += ` AND a.acquisition_date <= $${params.length}`; }
  const res = await db.query<any>(`${ASSET_SELECT} ${where} ORDER BY a.acquisition_date DESC, a.asset_code`, params);
  return res.rows.map(assetView);
}
export async function getAssetRow(db: Db, companyId: string, id: string) {
  const res = await db.query<any>('SELECT * FROM fixed_assets WHERE id = $1 AND company_id = $2', [id, companyId]);
  if (!res.rows[0]) throw notFound('FIXED_ASSET_NOT_FOUND', 'Fixed asset not found');
  return res.rows[0];
}
export async function getAsset(db: Db, companyId: string, id: string) {
  const res = await db.query<any>(`${ASSET_SELECT} WHERE a.id = $1 AND a.company_id = $2`, [id, companyId]);
  if (!res.rows[0]) throw notFound('FIXED_ASSET_NOT_FOUND', 'Fixed asset not found');
  const estimates = await db.query<any>('SELECT * FROM fixed_asset_estimates WHERE asset_id = $1 ORDER BY effective_from', [id]);
  const events = await db.query<any>('SELECT * FROM fixed_asset_events WHERE asset_id = $1 ORDER BY created_at DESC LIMIT 100', [id]);
  const proposals = await db.query<any>('SELECT * FROM fixed_asset_proposals WHERE asset_id = $1 ORDER BY created_at DESC LIMIT 100', [id]);
  const impairments = await db.query<any>('SELECT * FROM fixed_asset_impairments WHERE asset_id = $1 ORDER BY impairment_date, created_at', [id]);
  return {
    asset: assetView(res.rows[0]),
    estimates: estimates.rows.map((r: any) => ({
      id: r.id, effectiveFrom: r.effective_from, method: r.method,
      usefulLifeMonths: r.useful_life_months, residualValue: r.residual_value,
      reducingRate: r.reducing_rate, reason: r.reason, createdAt: r.created_at,
    })),
    events: events.rows.map((r: any) => ({ id: r.id, eventType: r.event_type, eventDate: r.event_date, reason: r.reason, details: r.details, createdAt: r.created_at })),
    proposals: proposals.rows.map((r: any) => ({
      id: r.id, kind: r.kind, eventDate: r.event_date, reference: r.reference, description: r.description,
      status: r.status, total: formatAmount(r.lines.reduce((s: bigint, l: any) => s + parseAmount(l.debit ?? 0), 0n)),
      entryId: r.entry_id, createdAt: r.created_at,
    })),
    impairments: impairments.rows.map((r: any) => ({
      id: r.id, impairmentDate: r.impairment_date, amount: r.amount, reason: r.reason,
      isReversal: r.is_reversal, status: r.status, entryId: r.entry_id,
    })),
  };
}

function validateDepreciationParams(method: DepreciationMethod | null | undefined, life: number | null | undefined, residual: bigint, totalCost: bigint, rate: string | number | null | undefined) {
  if (!method) return;
  if (!['straight_line', 'reducing_balance'].includes(method)) throw badRequest('FIXED_ASSET_METHOD_INVALID', 'Invalid depreciation method');
  if (!life || life <= 0) throw badRequest('FIXED_ASSET_LIFE_INVALID', 'Useful life must be positive');
  if (residual < 0n || residual > totalCost) throw badRequest('FIXED_ASSET_RESIDUAL_INVALID', 'Residual value must be between zero and cost');
  if (method === 'reducing_balance') {
    if (rate === null || rate === undefined || rate === '') throw badRequest('FIXED_ASSET_RATE_REQUIRED', 'A reducing-balance rate must be configured by the user');
    const parsed = parseRate8(String(rate));
    if (parsed <= 0n || parsed > 10n ** 8n) throw badRequest('FIXED_ASSET_RATE_REQUIRED', 'Rate must be between 0 and 1');
  }
}

export async function createAsset(db: Db, actor: AssetActor, input: AssetInput) {
  const category = await getCategoryRow(db, actor.companyId, input.categoryId);
  if (!category.is_active) throw badRequest('FIXED_ASSET_CATEGORY_NOT_FOUND', 'Category is inactive');
  const acquisitionDate = checkIso(input.acquisitionDate, 'acquisitionDate');
  const inServiceDate = input.inServiceDate ? checkIso(input.inServiceDate, 'inServiceDate') : null;
  if (inServiceDate && inServiceDate < acquisitionDate) throw badRequest('FIXED_ASSET_DATES_INVALID', 'In-service date cannot precede acquisition');
  const cost = parseAmount(input.cost);
  if (cost <= 0n) throw badRequest('VALIDATION_ERROR', 'Cost must be positive');
  const attributable = parseAmount(input.attributableCosts ?? 0);
  if (attributable < 0n) throw badRequest('VALIDATION_ERROR', 'Attributable costs cannot be negative');
  const residual = parseAmount(input.residualValue ?? category.default_residual_value ?? 0);
  const total = cost + attributable;
  validateDepreciationParams(input.method ?? category.default_method, input.usefulLifeMonths ?? category.default_useful_life_months ?? null, residual, total, input.reducingRate ?? category.default_reducing_rate);
  const rate = input.exchangeRate === null || input.exchangeRate === undefined || input.exchangeRate === ''
    ? '1'
    : String(input.exchangeRate);
  if (!/^\d+(\.\d{1,8})?$/.test(rate) || parseAmount(rate) <= 0n) throw badRequest('VALIDATION_ERROR', 'Invalid exchange rate');
  const currency = (input.currency ?? 'MUR').toUpperCase();
  const depStart = input.depreciationStartDate ? checkIso(input.depreciationStartDate, 'depreciationStartDate') : inServiceDate;
  const description = String(input.description ?? '').trim();
  if (description.length < 3) throw badRequest('VALIDATION_ERROR', 'Description is required');
  const cabinetId = await cabinetIdOf(db, actor.companyId);
  const year = Number(acquisitionDate.slice(0, 4));
  const savedId = await db.transaction(async (tx) => {
    const code = input.assetCode?.trim().toUpperCase() || (await nextAssetCode(tx, actor.companyId, year));
    const dup = await tx.query('SELECT 1 FROM fixed_assets WHERE company_id = $1 AND asset_code = $2', [actor.companyId, code]);
    if (dup.rowCount > 0) throw conflict('FIXED_ASSET_CODE_TAKEN', 'This asset code already exists');
    const method = input.method ?? category.default_method ?? null;
    const life = input.usefulLifeMonths ?? category.default_useful_life_months ?? null;
    const reducingRate = method === 'reducing_balance'
      ? (input.reducingRate !== undefined && input.reducingRate !== null && input.reducingRate !== ''
          ? rateToString8(parseRate8(input.reducingRate))
          : category.default_reducing_rate)
      : null;
    const res = await tx.query<{ id: string }>(
      `INSERT INTO fixed_assets
        (cabinet_id, company_id, category_id, asset_code, description, serial_number, location,
         acquisition_date, in_service_date, supplier_name, invoice_ref, document_ref,
         cost, attributable_costs, residual_value, currency, exchange_rate, fx_note,
         method, useful_life_months, reducing_rate, depreciation_start_date,
         status, responsible_user_id, notes, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$26)
       RETURNING id`,
      [cabinetId, actor.companyId, category.id, code, description, input.serialNumber?.trim() || null,
        input.location?.trim() || null, acquisitionDate, inServiceDate, input.supplierName?.trim() || null,
        input.invoiceRef?.trim() || null, input.documentRef?.trim() || null, formatAmount(cost),
        formatAmount(attributable), formatAmount(residual), currency, rate, input.fxNote?.trim() || null,
        method, life, reducingRate, depStart, inServiceDate ? 'in_service' : 'draft',
        input.responsibleUserId ?? null, input.notes?.trim() || null, actor.userId]);
    const id = res.rows[0]!.id;
    if (inServiceDate && method) {
      await tx.query(
        `INSERT INTO fixed_asset_estimates (company_id, asset_id, effective_from, method, useful_life_months, residual_value, reducing_rate, reason, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [actor.companyId, id, depStart ?? inServiceDate, method, life, formatAmount(residual), reducingRate, 'Initial estimate', actor.userId]);
      await tx.query(`UPDATE fixed_assets SET depreciation_end_date = $2 WHERE id = $1`,
        [id, addDays(addMonths(depStart ?? inServiceDate, life!), -1)]);
    }
    await tx.query(
      `INSERT INTO fixed_asset_events (company_id, asset_id, event_type, event_date, reason, details, created_by)
       VALUES ($1,$2,'created',$3,$4,$5::jsonb,$6)`,
      [actor.companyId, id, acquisitionDate, description, JSON.stringify({ code, cost: formatAmount(cost) }), actor.userId]);
    await audit(tx, actor, 'fixed_asset.create', 'fixed_asset', id, { code, cost: formatAmount(cost) });
    return id;
  });
  return getAsset(db, actor.companyId, savedId);
}

export async function updateAsset(db: Db, actor: AssetActor, id: string, input: Partial<AssetInput>) {
  const row = await getAssetRow(db, actor.companyId, id);
  if (['disposed', 'written_off'].includes(row.status)) throw badRequest('FIXED_ASSET_ALREADY_DISPOSED', 'A disposed asset cannot be modified');
  const financialKeys: (keyof AssetInput)[] = ['categoryId', 'cost', 'attributableCosts', 'residualValue', 'currency', 'exchangeRate', 'acquisitionDate', 'inServiceDate', 'method', 'usefulLifeMonths', 'reducingRate', 'depreciationStartDate'];
  const columnMap: Record<string, string> = {
    categoryId: 'category_id', cost: 'cost', attributableCosts: 'attributable_costs',
    residualValue: 'residual_value', currency: 'currency', exchangeRate: 'exchange_rate',
    acquisitionDate: 'acquisition_date', inServiceDate: 'in_service_date', method: 'method',
    usefulLifeMonths: 'useful_life_months', reducingRate: 'reducing_rate',
    depreciationStartDate: 'depreciation_start_date',
  };
  const touched = financialKeys.filter((key) => {
    if (input[key] === undefined) return false;
    const current = (row as Record<string, unknown>)[columnMap[key as string] ?? ''];
    return String(input[key] ?? '') !== String(current ?? '');
  });
  if (touched.length > 0 && row.status !== 'draft') {
    throw badRequest('FIXED_ASSET_DRAFT_ONLY', 'Financial fields can only be changed while the asset is a draft; use an estimate revision afterwards');
  }
  if (touched.length > 0 && row.status === 'draft') {
    const posted = await db.query('SELECT 1 FROM fixed_asset_proposals WHERE asset_id = $1 AND status = $2', [id, 'POSTED']);
    if (posted.rowCount > 0) throw conflict('FIXED_ASSET_DRAFT_ONLY', 'A posted acquisition locks the financial fields');
  }
  const description = input.description !== undefined ? String(input.description).trim() : row.description;
  if (description.length < 3) throw badRequest('VALIDATION_ERROR', 'Description is required');
  const cost = input.cost !== undefined ? parseAmount(input.cost) : parseAmount(row.cost);
  const attributable = input.attributableCosts !== undefined ? parseAmount(input.attributableCosts) : parseAmount(row.attributable_costs);
  const residual = input.residualValue !== undefined ? parseAmount(input.residualValue) : parseAmount(row.residual_value);
  validateDepreciationParams((input.method ?? row.method) as DepreciationMethod | null, input.usefulLifeMonths ?? row.useful_life_months, residual, cost + attributable, input.reducingRate ?? row.reducing_rate);
  await db.transaction(async (tx) => {
    await tx.query(
      `UPDATE fixed_assets SET description=$2, serial_number=$3, location=$4, supplier_name=$5,
         invoice_ref=$6, document_ref=$7, responsible_user_id=$8, notes=$9,
         cost=$10, attributable_costs=$11, residual_value=$12, category_id=$13,
         updated_by=$14, updated_at=now() WHERE id=$1`,
      [id, description, input.serialNumber !== undefined ? input.serialNumber?.trim() || null : row.serial_number,
        input.location !== undefined ? input.location?.trim() || null : row.location,
        input.supplierName !== undefined ? input.supplierName?.trim() || null : row.supplier_name,
        input.invoiceRef !== undefined ? input.invoiceRef?.trim() || null : row.invoice_ref,
        input.documentRef !== undefined ? input.documentRef?.trim() || null : row.document_ref,
        input.responsibleUserId !== undefined ? input.responsibleUserId ?? null : row.responsible_user_id,
        input.notes !== undefined ? input.notes?.trim() || null : row.notes,
        formatAmount(cost), formatAmount(attributable), formatAmount(residual),
        input.categoryId ?? row.category_id, actor.userId]);
    await tx.query(
      `INSERT INTO fixed_asset_events (company_id, asset_id, event_type, event_date, reason, details, created_by)
       VALUES ($1,$2,'updated',$3,$4,$5::jsonb,$6)`,
      [actor.companyId, id, iso(new Date()), 'Asset updated', JSON.stringify({ fields: Object.keys(input) }), actor.userId]);
    await audit(tx, actor, 'fixed_asset.update', 'fixed_asset', id, { fields: Object.keys(input) });
  });
  return getAsset(db, actor.companyId, id);
}

export async function activateAsset(db: Db, actor: AssetActor, id: string, input: {
  inServiceDate: string; depreciationStartDate?: string | null; method?: DepreciationMethod | null;
  usefulLifeMonths?: number | null; residualValue?: string | number | null;
  reducingRate?: string | number | null; reason?: string;
}) {
  const row = await getAssetRow(db, actor.companyId, id);
  if (row.status !== 'draft') throw conflict('FIXED_ASSET_STATUS_INVALID', 'Only a draft asset can be put in service');
  const inServiceDate = checkIso(input.inServiceDate, 'inServiceDate');
  if (inServiceDate < row.acquisition_date) throw badRequest('FIXED_ASSET_DATES_INVALID', 'In-service date cannot precede acquisition');
  const method = input.method ?? row.method ?? null;
  const life = input.usefulLifeMonths ?? row.useful_life_months ?? null;
  const residual = input.residualValue !== undefined && input.residualValue !== null ? parseAmount(input.residualValue) : parseAmount(row.residual_value);
  const total = parseAmount(row.cost) + parseAmount(row.attributable_costs);
  validateDepreciationParams(method as DepreciationMethod | null, life, residual, total, input.reducingRate ?? row.reducing_rate);
  const depStart = input.depreciationStartDate ? checkIso(input.depreciationStartDate, 'depreciationStartDate') : inServiceDate;
  if (depStart < inServiceDate) throw badRequest('FIXED_ASSET_DATES_INVALID', 'Depreciation cannot start before the in-service date');
  const reducingRate = method === 'reducing_balance'
    ? (input.reducingRate ? rateToString8(parseRate8(input.reducingRate)) : row.reducing_rate)
    : null;
  if (method === 'reducing_balance' && !reducingRate) throw badRequest('FIXED_ASSET_RATE_REQUIRED', 'A reducing-balance rate must be configured by the user');
  const end = method && life ? addDays(addMonths(depStart, life), -1) : null;
  await db.transaction(async (tx) => {
    await tx.query(
      `UPDATE fixed_assets SET status='in_service', in_service_date=$2, depreciation_start_date=$3,
         method=$4, useful_life_months=$5, residual_value=$6, reducing_rate=$7,
         depreciation_end_date=$8, suspended_from=NULL, suspended_to=NULL, suspended_reason=NULL,
         updated_by=$9, updated_at=now() WHERE id=$1`,
      [id, inServiceDate, depStart, method, life, formatAmount(residual), reducingRate, end, actor.userId]);
    if (method && life) {
      await tx.query(
        `INSERT INTO fixed_asset_estimates (company_id, asset_id, effective_from, method, useful_life_months, residual_value, reducing_rate, reason, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (company_id, asset_id, effective_from) DO UPDATE SET
           method=EXCLUDED.method, useful_life_months=EXCLUDED.useful_life_months,
           residual_value=EXCLUDED.residual_value, reducing_rate=EXCLUDED.reducing_rate,
           reason=EXCLUDED.reason`,
        [actor.companyId, id, depStart, method, life, formatAmount(residual), reducingRate,
          input.reason?.trim() || 'Commissioning / initial estimate', actor.userId]);
    }
    await tx.query(
      `INSERT INTO fixed_asset_events (company_id, asset_id, event_type, event_date, reason, details, created_by)
       VALUES ($1,$2,'activated',$3,$4,$5::jsonb,$6)`,
      [actor.companyId, id, inServiceDate, input.reason?.trim() || null,
        JSON.stringify({ method, usefulLifeMonths: life, depStart }), actor.userId]);
    await audit(tx, actor, 'fixed_asset.activate', 'fixed_asset', id, { inServiceDate, method, life });
  });
  return getAsset(db, actor.companyId, id);
}

export async function reviseEstimate(db: Db, actor: AssetActor, id: string, input: {
  effectiveFrom: string; method: DepreciationMethod; usefulLifeMonths: number;
  residualValue: string | number; reducingRate?: string | number | null; reason: string;
}) {
  const row = await getAssetRow(db, actor.companyId, id);
  if (!['in_service', 'suspended'].includes(row.status)) throw badRequest('FIXED_ASSET_IN_SERVICE_REQUIRED', 'Estimates can only be revised on an asset in service');
  const effectiveFrom = checkIso(input.effectiveFrom, 'effectiveFrom');
  if (!firstDayOfMonth(effectiveFrom)) throw badRequest('FIXED_ASSET_ESTIMATE_DATE_INVALID', 'A revision must start on the first day of a month');
  if (effectiveFrom <= (row.depreciation_start_date ?? '')) throw badRequest('FIXED_ASSET_ESTIMATE_DATE_INVALID', 'A revision must start after the current depreciation start');
  const residual = parseAmount(input.residualValue);
  const total = parseAmount(row.cost) + parseAmount(row.attributable_costs);
  validateDepreciationParams(input.method, input.usefulLifeMonths, residual, total, input.reducingRate ?? null);
  const reason = String(input.reason ?? '').trim();
  if (reason.length < 5) throw badRequest('FIXED_ASSET_ESTIMATE_INVALID', 'A documented reason is required');
  const rate = input.method === 'reducing_balance'
    ? rateToString8(parseRate8(input.reducingRate === undefined || input.reducingRate === null ? '' : String(input.reducingRate)))
    : null;
  const end = addDays(addMonths(effectiveFrom, input.usefulLifeMonths), -1);
  await db.transaction(async (tx) => {
    const dup = await tx.query('SELECT 1 FROM fixed_asset_estimates WHERE asset_id = $1 AND effective_from = $2', [id, effectiveFrom]);
    if (dup.rowCount > 0) throw conflict('FIXED_ASSET_ESTIMATE_DATE_INVALID', 'An estimate already exists for this date');
    await tx.query(
      `INSERT INTO fixed_asset_estimates (company_id, asset_id, effective_from, method, useful_life_months, residual_value, reducing_rate, reason, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [actor.companyId, id, effectiveFrom, input.method, input.usefulLifeMonths, formatAmount(residual), rate, reason, actor.userId]);
    await tx.query(
      `UPDATE fixed_assets SET method=$2, useful_life_months=$3, residual_value=$4, reducing_rate=$5,
         depreciation_end_date=$6, updated_by=$7, updated_at=now() WHERE id=$1`,
      [id, input.method, input.usefulLifeMonths, formatAmount(residual), rate, end, actor.userId]);
    await tx.query(
      `INSERT INTO fixed_asset_events (company_id, asset_id, event_type, event_date, reason, details, created_by)
       VALUES ($1,$2,'estimate_revised',$3,$4,$5::jsonb,$6)`,
      [actor.companyId, id, effectiveFrom, reason,
        JSON.stringify({ method: input.method, usefulLifeMonths: input.usefulLifeMonths, residualValue: formatAmount(residual), reducingRate: rate }), actor.userId]);
    await audit(tx, actor, 'fixed_asset.estimate.revise', 'fixed_asset', id, { effectiveFrom, reason });
  });
  return getAsset(db, actor.companyId, id);
}

export async function suspendAsset(db: Db, actor: AssetActor, id: string, input: { from: string; reason: string }) {
  const row = await getAssetRow(db, actor.companyId, id);
  if (row.status !== 'in_service') throw badRequest('FIXED_ASSET_STATUS_INVALID', 'Only an asset in service can be suspended');
  const from = checkIso(input.from, 'from');
  const reason = String(input.reason ?? '').trim();
  if (reason.length < 5) throw badRequest('FIXED_ASSET_SUSPENSION_INVALID', 'A documented reason is required');
  if (row.depreciation_start_date && from < row.depreciation_start_date) throw badRequest('FIXED_ASSET_SUSPENSION_INVALID', 'Suspension cannot start before depreciation');
  await db.transaction(async (tx) => {
    await tx.query(`UPDATE fixed_assets SET status='suspended', suspended_from=$2, suspended_to=NULL, suspended_reason=$3, updated_by=$4, updated_at=now() WHERE id=$1`,
      [id, from, reason, actor.userId]);
    await tx.query(
      `INSERT INTO fixed_asset_events (company_id, asset_id, event_type, event_date, reason, created_by)
       VALUES ($1,$2,'suspended',$3,$4,$5)`, [actor.companyId, id, from, reason, actor.userId]);
    await audit(tx, actor, 'fixed_asset.suspend', 'fixed_asset', id, { from, reason });
  });
  return getAsset(db, actor.companyId, id);
}

export async function resumeAsset(db: Db, actor: AssetActor, id: string, input: { from: string; reason?: string }) {
  const row = await getAssetRow(db, actor.companyId, id);
  if (row.status !== 'suspended' || !row.suspended_from) throw badRequest('FIXED_ASSET_NOT_SUSPENDED', 'Asset is not suspended');
  const from = checkIso(input.from, 'from');
  if (from < row.suspended_from) throw badRequest('FIXED_ASSET_SUSPENSION_INVALID', 'Resume date cannot precede suspension');
  await db.transaction(async (tx) => {
    await tx.query(`UPDATE fixed_assets SET status='in_service', suspended_to=$2, updated_by=$3, updated_at=now() WHERE id=$1`,
      [id, from, actor.userId]);
    await tx.query(
      `INSERT INTO fixed_asset_events (company_id, asset_id, event_type, event_date, reason, created_by)
       VALUES ($1,$2,'resumed',$3,$4,$5)`, [actor.companyId, id, from, input.reason?.trim() || null, actor.userId]);
    await audit(tx, actor, 'fixed_asset.resume', 'fixed_asset', id, { from });
  });
  return getAsset(db, actor.companyId, id);
}

/* ------------------------------------------------------- posting context */

export async function loadContext(db: Db, companyId: string, assetId: string, before?: string): Promise<{
  asset: any; category: any; context: DepreciationContext; accumulatedPosted: bigint; impairmentPosted: bigint;
}> {
  const asset = await getAssetRow(db, companyId, assetId);
  const category = await getCategoryRow(db, companyId, asset.category_id);
  const estimates = await db.query<any>('SELECT * FROM fixed_asset_estimates WHERE asset_id = $1 ORDER BY effective_from', [assetId]);
  const dep = await db.query<{ amount: string }>(
    `SELECT COALESCE(SUM(l.amount),0)::text AS amount FROM fixed_asset_depreciation_lines l
       JOIN fixed_asset_depreciation_batches b ON b.id = l.batch_id
      WHERE l.asset_id = $1 AND b.status = 'POSTED'${before ? ' AND l.month_end < $2' : ''}`,
    before ? [assetId, before] : [assetId]);
  const imp = await db.query<{ amount: string }>(
    `SELECT COALESCE(SUM(CASE WHEN is_reversal THEN -amount ELSE amount END),0)::text AS amount
       FROM fixed_asset_impairments WHERE asset_id = $1 AND status = 'POSTED'${before ? ' AND impairment_date < $2' : ''}`,
    before ? [assetId, before] : [assetId]);
  const rate = String(asset.exchange_rate);
  const estimatesParsed: EstimateParams[] = estimates.rows.length > 0
    ? estimates.rows.map((r: any) => ({
        effectiveFrom: r.effective_from,
        method: r.method,
        usefulLifeMonths: r.useful_life_months,
        residualValue: functionalResidual(r.residual_value, rate),
        reducingRate: r.reducing_rate ? parseRate8(r.reducing_rate) : null,
      }))
    : asset.method
      ? [{
          effectiveFrom: asset.depreciation_start_date ?? asset.in_service_date,
          method: asset.method,
          usefulLifeMonths: asset.useful_life_months,
          residualValue: functionalResidual(asset.residual_value, rate),
          reducingRate: asset.reducing_rate ? parseRate8(asset.reducing_rate) : null,
        }]
      : [];
  return {
    asset,
    category,
    context: {
      functionalCost: functionalCost(asset.cost, asset.attributable_costs, rate),
      inServiceDate: asset.in_service_date,
      depreciationStart: asset.depreciation_start_date,
      suspendedFrom: asset.suspended_from,
      suspendedTo: asset.suspended_to,
      endDate: ['disposed', 'written_off'].includes(asset.status) ? asset.disposal_date : null,
      estimates: estimatesParsed,
    },
    accumulatedPosted: parseAmount(dep.rows[0]!.amount),
    impairmentPosted: parseAmount(imp.rows[0]!.amount),
  };
}

export async function assetSchedule(db: Db, companyId: string, assetId: string, from: string, to: string): Promise<ScheduleLine[]> {
  const { context, accumulatedPosted, impairmentPosted } = await loadContext(db, companyId, assetId, from);
  return computeSchedule(context, { from, to, accumulatedPosted, impairmentPosted });
}

/** Accumulated depreciation and impairment up to a date (posted only). */
export async function accumulatedUpTo(db: Db, companyId: string, assetId: string, asOf: string) {
  const dep = await db.query<{ amount: string }>(
    `SELECT COALESCE(SUM(l.amount),0)::text AS amount FROM fixed_asset_depreciation_lines l
       JOIN fixed_asset_depreciation_batches b ON b.id = l.batch_id
      WHERE l.asset_id = $1 AND b.status = 'POSTED' AND l.month_end <= $2`, [assetId, asOf]);
  const imp = await db.query<{ amount: string }>(
    `SELECT COALESCE(SUM(CASE WHEN is_reversal THEN -amount ELSE amount END),0)::text AS amount
       FROM fixed_asset_impairments WHERE asset_id = $1 AND status = 'POSTED' AND impairment_date <= $2`, [assetId, asOf]);
  return { depreciation: parseAmount(dep.rows[0]!.amount), impairment: parseAmount(imp.rows[0]!.amount) };
}
