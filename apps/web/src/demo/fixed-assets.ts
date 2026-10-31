/**
 * Mission 20 — browser demonstration for fixed assets and depreciation.
 *
 * Fictional data only, stored in localStorage. The module mirrors the controls
 * of the real API (exact decimal arithmetic, monthly batches, human approval
 * before posting, locked posted records, company isolation) but does not encode
 * any Mauritian useful life, tax rate or account number. Accounts come from the
 * demonstration charts.
 */
import { ApiError } from '../errors';
import { scaled4ToString, toScaled4 } from '../format';
import type { DemoAccount, DemoEntry, DemoJournal, DemoLine, DemoState } from './runtime';

export interface DemoFaCategory {
  id: string;
  company_id: string;
  code: string;
  name_en: string;
  name_fr: string;
  is_depreciable: boolean;
  default_method: 'straight_line' | 'reducing_balance' | null;
  default_useful_life_months: number | null;
  default_residual_value: string;
  default_reducing_rate: string | null;
  asset_account_id: string | null;
  accumulated_depreciation_account_id: string | null;
  depreciation_expense_account_id: string | null;
  accumulated_impairment_account_id: string | null;
  impairment_loss_account_id: string | null;
  impairment_reversal_account_id: string | null;
  disposal_gain_account_id: string | null;
  disposal_loss_account_id: string | null;
  cwip_account_id: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface DemoFaAsset {
  id: string;
  company_id: string;
  category_id: string;
  asset_code: string;
  description: string;
  serial_number: string | null;
  location: string | null;
  acquisition_date: string;
  in_service_date: string | null;
  supplier_name: string | null;
  invoice_ref: string | null;
  document_ref: string | null;
  cost: string;
  attributable_costs: string;
  residual_value: string;
  currency: string;
  exchange_rate: string;
  fx_note: string | null;
  method: 'straight_line' | 'reducing_balance' | null;
  useful_life_months: number | null;
  reducing_rate: string | null;
  depreciation_start_date: string | null;
  depreciation_end_date: string | null;
  status: 'draft' | 'in_service' | 'suspended' | 'disposed' | 'written_off';
  suspended_from: string | null;
  suspended_to: string | null;
  suspended_reason: string | null;
  notes: string | null;
  disposal_date: string | null;
  disposal_proceeds: string | null;
  disposal_costs: string | null;
  created_at: string;
  updated_at: string;
}

export interface DemoFaEstimate {
  id: string;
  company_id: string;
  asset_id: string;
  effective_from: string;
  method: 'straight_line' | 'reducing_balance';
  useful_life_months: number;
  residual_value: string;
  reducing_rate: string | null;
  reason: string;
  created_at: string;
}

export interface DemoFaEvent {
  id: string;
  company_id: string;
  asset_id: string;
  event_type: string;
  event_date: string;
  reason: string | null;
  details: Record<string, unknown>;
  created_at: string;
}

export interface DemoFaBatch {
  id: string;
  company_id: string;
  reference: string;
  period_start: string;
  period_end: string;
  journal_id: string;
  status: 'DRAFT' | 'APPROVED' | 'POSTED' | 'CANCELLED';
  total_amount: string;
  checks: { code: string; severity: string; message: string }[];
  approval_note: string | null;
  approved_at: string | null;
  entry_id: string | null;
  posted_at: string | null;
  created_at: string;
  lines: DemoFaDepreciationLine[];
}

export interface DemoFaDepreciationLine {
  id: string;
  batch_id: string;
  asset_id: string;
  category_id: string;
  month_start: string;
  month_end: string;
  method: 'straight_line' | 'reducing_balance';
  opening_nbv: string;
  depreciable_base: string;
  amount: string;
  closing_nbv: string;
  days_active: number;
  days_in_month: number;
  expense_account_id: string;
  accumulated_account_id: string;
}

export interface DemoFaProposal {
  id: string;
  company_id: string;
  asset_id: string;
  kind: string;
  event_date: string;
  reference: string;
  description: string;
  journal_id: string;
  currency: string;
  lines: { accountId: string; description: string; debit?: string; credit?: string }[];
  checks: { code: string; severity: string; message: string }[];
  payload: Record<string, unknown>;
  status: 'PROPOSED' | 'APPROVED' | 'POSTED' | 'REJECTED';
  approval_note: string | null;
  rejection_reason: string | null;
  entry_id: string | null;
  posted_at: string | null;
  created_at: string;
}

export interface DemoFaImpairment {
  id: string;
  company_id: string;
  asset_id: string;
  impairment_date: string;
  amount: string;
  reason: string;
  is_reversal: boolean;
  status: 'POSTED';
  entry_id: string;
  created_at: string;
}

export interface DemoFixedAssetState {
  categories: DemoFaCategory[];
  assets: DemoFaAsset[];
  estimates: DemoFaEstimate[];
  events: DemoFaEvent[];
  batches: DemoFaBatch[];
  proposals: DemoFaProposal[];
  impairments: DemoFaImpairment[];
  sequences: Record<string, number>;
}

/* ------------------------------------------------------------------ arithmetic */

const uid = () => crypto.randomUUID();
const nowIso = () => new Date().toISOString();
const fmt = (value: bigint) => scaled4ToString(value);
const amt = (value: string | number | null | undefined) => toScaled4(value ?? 0) ?? 0n;
const RATE_FACTOR = 10n ** 8n;

function parseRate(value: string | number | null | undefined): bigint {
  const raw = String(value ?? '').trim().replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(raw)) throw new ApiError(400, 'FIXED_ASSET_RATE_REQUIRED', 'Taux invalide');
  const [int, dec = ''] = raw.split('.');
  return BigInt(int!) * RATE_FACTOR + BigInt(dec.slice(0, 8).padEnd(8, '0'));
}
function divideRounded(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n || numerator <= 0n) return 0n;
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  return remainder * 2n >= denominator ? quotient + 1n : quotient;
}
const isoDate = (value: string) => new Date(`${value}T00:00:00.000Z`);
const iso = (date: Date) => date.toISOString().slice(0, 10);
const addDays = (value: string, days: number) => {
  const d = isoDate(value);
  d.setUTCDate(d.getUTCDate() + days);
  return iso(d);
};
const addMonths = (value: string, months: number) => {
  const d = isoDate(value);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return iso(d);
};
const monthStart = (value: string) => `${value.slice(0, 7)}-01`;
const monthEnd = (value: string) => {
  const d = isoDate(value);
  return iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)));
};
const daysInMonth = (value: string) => Number(monthEnd(value).slice(8, 10));
function daysInclusive(from: string, to: string): number {
  if (to < from) return 0;
  let days = 0;
  let cursor = from;
  while (cursor <= to) { days += 1; cursor = addDays(cursor, 1); }
  return days;
}

interface ScheduleLine {
  monthStart: string;
  monthEnd: string;
  amount: bigint;
  method: 'straight_line' | 'reducing_balance';
  openingNbv: bigint;
  depreciableBase: bigint;
  closingNbv: bigint;
  daysActive: number;
  daysInMonth: number;
}

function computeSchedule(
  asset: DemoFaAsset,
  estimates: DemoFaEstimate[],
  from: string,
  to: string,
  accumulatedPosted: bigint,
  impairmentPosted: bigint,
): ScheduleLine[] {
  const lines: ScheduleLine[] = [];
  const start = asset.depreciation_start_date ?? asset.in_service_date;
  if (!start || !asset.method) return lines;
  const functionalCost = amt(asset.cost) + amt(asset.attributable_costs);
  const sorted = [...estimates].sort((a, b) => a.effective_from.localeCompare(b.effective_from));
  const paramsFor = (month: string) => {
    let chosen = sorted[0]!;
    for (const estimate of sorted) if (estimate.effective_from <= month) chosen = estimate;
    return chosen;
  };
  let accumulated = accumulatedPosted;
  let cursor = monthStart(from);
  const end = monthEnd(to);
  while (cursor <= end) {
    const mStart = cursor;
    const mEnd = monthEnd(cursor);
    const estimate = paramsFor(mStart);
    const lifeStart = start > estimate.effective_from ? start : estimate.effective_from;
    const lifeEnd = addDays(addMonths(lifeStart, estimate.useful_life_months), -1);
    const base = functionalCost - amt(estimate.residual_value);
    const windowEnd = asset.status === 'disposed' || asset.status === 'written_off' ? asset.disposal_date : null;
    const lastDay = windowEnd && windowEnd < lifeEnd ? windowEnd : lifeEnd;
    const activeFrom = mStart > start ? mStart : start;
    const activeTo = mEnd < lastDay ? mEnd : lastDay;
    let days = activeTo >= activeFrom ? daysInclusive(activeFrom, activeTo) : 0;
    if (asset.suspended_from && asset.suspended_from <= activeTo && (asset.suspended_to === null || asset.suspended_to >= activeFrom)) {
      const sFrom = activeFrom > asset.suspended_from ? activeFrom : asset.suspended_from;
      const sTo = asset.suspended_to && asset.suspended_to < activeTo ? asset.suspended_to : activeTo;
      if (sTo >= sFrom) days -= daysInclusive(sFrom, sTo);
    }
    const dim = daysInMonth(mStart);
    if (days > 0 && base > accumulated) {
      let amount = 0n;
      if (estimate.method === 'straight_line') {
        const monthly = divideRounded(base, BigInt(estimate.useful_life_months));
        amount = divideRounded(monthly * BigInt(days), BigInt(dim));
      } else {
        const rate = parseRate(estimate.reducing_rate ?? '0');
        const opening = functionalCost - accumulated - impairmentPosted;
        if (opening > 0n) {
          amount = divideRounded(opening * rate * BigInt(days), RATE_FACTOR * 12n * BigInt(dim));
        }
      }
      const remaining = base - accumulated;
      if (lifeEnd <= mEnd && remaining > 0n) amount = remaining;
      if (amount > remaining) amount = remaining;
      if (amount > 0n) {
        const opening = functionalCost - accumulated - impairmentPosted;
        accumulated += amount;
        lines.push({
          monthStart: mStart, monthEnd: mEnd, amount, method: estimate.method,
          openingNbv: opening, depreciableBase: base,
          closingNbv: functionalCost - accumulated - impairmentPosted,
          daysActive: days, daysInMonth: dim,
        });
      }
    }
    cursor = addDays(mEnd, 1);
  }
  return lines;
}

function accumulatedFor(state: DemoFixedAssetState, assetId: string, asOf?: string): bigint {
  return state.batches
    .filter((batch) => batch.status === 'POSTED')
    .flatMap((batch) => batch.lines)
    .filter((line) => line.asset_id === assetId && (!asOf || line.month_end <= asOf))
    .reduce((sum, line) => sum + amt(line.amount), 0n);
}
function impairmentFor(state: DemoFixedAssetState, assetId: string, asOf?: string): bigint {
  return state.impairments
    .filter((imp) => imp.asset_id === assetId && (!asOf || imp.impairment_date <= asOf))
    .reduce((sum, imp) => sum + (imp.is_reversal ? -amt(imp.amount) : amt(imp.amount)), 0n);
}
function functionalCostOf(asset: DemoFaAsset): bigint {
  return (amt(asset.cost) + amt(asset.attributable_costs)) * parseRate(asset.exchange_rate || '1') / RATE_FACTOR;
}
function functionalResidualOf(asset: DemoFaAsset): bigint {
  return amt(asset.residual_value) * parseRate(asset.exchange_rate || '1') / RATE_FACTOR;
}

function accountView(state: DemoState, id: string | null) {
  if (!id) return null;
  const account = state.accounts.find((a) => a.id === id);
  return account ? { id, code: account.code, name: account.name } : null;
}

function categoryView(state: DemoState, category: DemoFaCategory) {
  return {
    id: category.id, code: category.code, nameEn: category.name_en, nameFr: category.name_fr,
    isDepreciable: category.is_depreciable, isActive: category.is_active,
    defaultMethod: category.default_method, defaultUsefulLifeMonths: category.default_useful_life_months,
    defaultResidualValue: category.default_residual_value, defaultReducingRate: category.default_reducing_rate,
    accounts: {
      asset: accountView(state, category.asset_account_id),
      accumulatedDepreciation: accountView(state, category.accumulated_depreciation_account_id),
      depreciationExpense: accountView(state, category.depreciation_expense_account_id),
      accumulatedImpairment: accountView(state, category.accumulated_impairment_account_id),
      impairmentLoss: accountView(state, category.impairment_loss_account_id),
      impairmentReversal: accountView(state, category.impairment_reversal_account_id),
      disposalGain: accountView(state, category.disposal_gain_account_id),
      disposalLoss: accountView(state, category.disposal_loss_account_id),
      cwip: accountView(state, category.cwip_account_id),
    },
    createdAt: category.created_at, updatedAt: category.updated_at,
  };
}

function assetView(state: DemoFixedAssetState, all: DemoState, asset: DemoFaAsset) {
  const category = state.categories.find((c) => c.id === asset.category_id)!;
  const dep = accumulatedFor(state, asset.id);
  const impairment = impairmentFor(state, asset.id);
  const functional = functionalCostOf(asset);
  const disposed = ['disposed', 'written_off'].includes(asset.status);
  return {
    id: asset.id, assetCode: asset.asset_code, description: asset.description,
    category: { id: category.id, code: category.code, nameEn: category.name_en, nameFr: category.name_fr, isDepreciable: category.is_depreciable },
    serialNumber: asset.serial_number, location: asset.location,
    acquisitionDate: asset.acquisition_date, inServiceDate: asset.in_service_date,
    supplierName: asset.supplier_name, invoiceRef: asset.invoice_ref, documentRef: asset.document_ref,
    cost: fmt(amt(asset.cost)), attributableCosts: fmt(amt(asset.attributable_costs)),
    totalCost: fmt(amt(asset.cost) + amt(asset.attributable_costs)),
    residualValue: fmt(amt(asset.residual_value)), currency: asset.currency,
    exchangeRate: asset.exchange_rate,
    fxNote: asset.fx_note, functionalCost: fmt(functional), functionalResidual: fmt(functionalResidualOf(asset)),
    method: asset.method, usefulLifeMonths: asset.useful_life_months, reducingRate: asset.reducing_rate,
    depreciationStartDate: asset.depreciation_start_date, depreciationEndDate: asset.depreciation_end_date,
    status: asset.status, suspendedFrom: asset.suspended_from, suspendedTo: asset.suspended_to,
    suspendedReason: asset.suspended_reason, responsibleUserId: null, responsibleName: null, notes: asset.notes,
    disposalDate: asset.disposal_date, disposalProceeds: asset.disposal_proceeds, disposalCosts: asset.disposal_costs,
    accumulatedDepreciation: fmt(dep), accumulatedImpairment: fmt(impairment),
    netBookValue: fmt(disposed ? 0n : functional - dep - impairment),
    createdAt: asset.created_at, updatedAt: asset.updated_at,
  };
}

function proposalView(state: DemoFixedAssetState, all: DemoState, proposal: DemoFaProposal) {
  const asset = state.assets.find((a) => a.id === proposal.asset_id)!;
  const journal = all.journals.find((j) => j.id === proposal.journal_id);
  const entry = proposal.entry_id ? all.entries.find((e) => e.id === proposal.entry_id) : null;
  return {
    id: proposal.id, assetId: asset.id, assetCode: asset.asset_code, assetDescription: asset.description,
    kind: proposal.kind, eventDate: proposal.event_date, reference: proposal.reference,
    description: proposal.description, journal: { id: journal?.id, code: journal?.code, name: journal?.name },
    currency: proposal.currency,
    lines: proposal.lines.map((l) => ({ ...l, account: accountView(all, l.accountId) })),
    checks: proposal.checks, blockers: [], warnings: [], payload: proposal.payload,
    status: proposal.status, approvalNote: proposal.approval_note, approvedByName: null,
    approvedAt: null, rejectionReason: proposal.rejection_reason,
    entryId: proposal.entry_id, entryNo: entry?.entry_no ?? null, postedAt: proposal.posted_at,
    createdAt: proposal.created_at,
  };
}

/* ------------------------------------------------------------------- seed */

function ensureAccount(state: DemoState, companyId: string, code: string, name: string, type: DemoAccount['type']): DemoAccount {
  const existing = state.accounts.find((a) => a.company_id === companyId && a.code === code);
  if (existing) return existing;
  const account: DemoAccount = {
    id: uid(), company_id: companyId, code, name, type, parent_id: null,
    currency: 'MUR', is_active: true, fs_mapping: null, description: 'Compte fictif de démonstration',
  };
  state.accounts.push(account);
  return account;
}

function nextEntryNo(state: DemoState, journal: DemoJournal, date: string): string {
  const key = `${journal.code}-${date.slice(0, 4)}`;
  const next = (state.sequences[key] ?? 0) + 1;
  state.sequences[key] = next;
  return `${journal.code}-${date.slice(0, 4)}-${String(next).padStart(4, '0')}`;
}

function postEntry(
  all: DemoState, companyId: string, journal: DemoJournal, date: string, reference: string,
  description: string, lines: { accountId: string; description: string; debit?: bigint; credit?: bigint }[],
): DemoEntry {
  const debit = lines.reduce((sum, l) => sum + (l.debit ?? 0n), 0n);
  const credit = lines.reduce((sum, l) => sum + (l.credit ?? 0n), 0n);
  if (debit !== credit) throw new ApiError(409, 'ENTRY_UNBALANCED', 'Écriture déséquilibrée');
  const entry: DemoEntry = {
    id: uid(), company_id: companyId, journal_id: journal.id,
    entry_no: nextEntryNo(all, journal, date), entry_date: date, reference,
    description, currency: 'MUR', exchange_rate: '1.00000000', status: 'posted',
    source: 'asset', reversal_of_entry_id: null, posted_at: nowIso(), created_at: nowIso(),
  };
  all.entries.push(entry);
  lines.forEach((line, index) => {
    all.lines.push({
      id: uid(), entry_id: entry.id, company_id: companyId, account_id: line.accountId, line_no: index + 1,
      description: line.description, debit: fmt(line.debit ?? 0n), credit: fmt(line.credit ?? 0n),
      txn_amount: fmt(line.debit ?? line.credit ?? 0n), txn_currency: 'MUR', fx_rate: null,
    } satisfies DemoLine);
  });
  return entry;
}

export function seedDemoFixedAssets(all: DemoState): void {
  const categories: DemoFaCategory[] = [];
  const assets: DemoFaAsset[] = [];
  const estimates: DemoFaEstimate[] = [];
  const events: DemoFaEvent[] = [];
  const batches: DemoFaBatch[] = [];
  const proposals: DemoFaProposal[] = [];
  const impairments: DemoFaImpairment[] = [];
  const sequences: Record<string, number> = {};
  const timestamp = nowIso();

  const main = all.companies[0]!;
  const second = all.companies.find((c) => c.id !== main.id && c.status === 'active');

  const setup = (companyId: string) => {
    const assetAccount = ensureAccount(all, companyId, '1500', 'Immobilisations (démo)', 'asset');
    const accumAccount = ensureAccount(all, companyId, '1510', 'Amortissements cumulés (démo)', 'asset');
    const expenseAccount = ensureAccount(all, companyId, '6200', 'Dotations aux amortissements (démo)', 'expense');
    const impairmentAccount = ensureAccount(all, companyId, '1530', 'Dépréciations cumulées (démo)', 'asset');
    const lossAccount = ensureAccount(all, companyId, '6290', 'Pertes de dépréciation et de cession (démo)', 'expense');
    const gainAccount = ensureAccount(all, companyId, '4100', 'Autres produits (démo)', 'revenue');
    const cwipAccount = ensureAccount(all, companyId, '1520', 'Immobilisations en cours (démo)', 'asset');
    return { assetAccount, accumAccount, expenseAccount, impairmentAccount, lossAccount, gainAccount, cwipAccount };
  };

  const createCategory = (companyId: string, code: string, nameEn: string, nameFr: string, accounts: ReturnType<typeof setup>, options: Partial<DemoFaCategory> = {}) => {
    const category: DemoFaCategory = {
      id: uid(), company_id: companyId, code, name_en: nameEn, name_fr: nameFr, is_depreciable: true,
      default_method: null, default_useful_life_months: null, default_residual_value: '0.0000', default_reducing_rate: null,
      asset_account_id: accounts.assetAccount.id, accumulated_depreciation_account_id: accounts.accumAccount.id,
      depreciation_expense_account_id: accounts.expenseAccount.id,
      accumulated_impairment_account_id: accounts.impairmentAccount.id,
      impairment_loss_account_id: accounts.lossAccount.id, impairment_reversal_account_id: accounts.gainAccount.id,
      disposal_gain_account_id: accounts.gainAccount.id, disposal_loss_account_id: accounts.lossAccount.id,
      cwip_account_id: accounts.cwipAccount.id, is_active: true, created_at: timestamp, updated_at: timestamp,
      ...options,
    };
    categories.push(category);
    return category;
  };

  const createAsset = (companyId: string, category: DemoFaCategory, data: Partial<DemoFaAsset> & { code: string; description: string; acquisition: string; cost: string }) => {
    const year = data.acquisition.slice(0, 4);
    const seqKey = `${companyId}-${year}`;
    sequences[seqKey] = (sequences[seqKey] ?? 0) + 1;
    const asset: DemoFaAsset = {
      id: uid(), company_id: companyId, category_id: category.id,
      asset_code: data.code, description: data.description, serial_number: data.serial_number ?? null,
      location: data.location ?? 'Site fictif de démonstration', acquisition_date: data.acquisition,
      in_service_date: data.in_service_date ?? null, supplier_name: data.supplier_name ?? 'Fournisseur fictif (démo)',
      invoice_ref: data.invoice_ref ?? null, document_ref: data.document_ref ?? 'DOC-DEMO-FICTIF',
      cost: data.cost, attributable_costs: data.attributable_costs ?? '0.0000',
      residual_value: data.residual_value ?? '0.0000', currency: 'MUR', exchange_rate: '1.00000000',
      fx_note: data.fx_note ?? null, method: data.method ?? null, useful_life_months: data.useful_life_months ?? null,
      reducing_rate: data.reducing_rate ?? null, depreciation_start_date: data.depreciation_start_date ?? null,
      depreciation_end_date: data.depreciation_end_date ?? null, status: data.status ?? 'draft',
      suspended_from: data.suspended_from ?? null, suspended_to: data.suspended_to ?? null,
      suspended_reason: data.suspended_reason ?? null, notes: data.notes ?? 'Donnée fictive de démonstration.',
      disposal_date: data.disposal_date ?? null, disposal_proceeds: data.disposal_proceeds ?? null,
      disposal_costs: data.disposal_costs ?? null, created_at: timestamp, updated_at: timestamp,
    };
    assets.push(asset);
    events.push({
      id: uid(), company_id: companyId, asset_id: asset.id, event_type: 'created',
      event_date: asset.acquisition_date, reason: 'Création fictive de démonstration', details: {}, created_at: timestamp,
    });
    return asset;
  };

  const acquisition = (companyId: string, asset: DemoFaAsset, category: DemoFaCategory, journal: DemoJournal, kind: 'acquisition' | 'cwip' = 'acquisition') => {
    const target = kind === 'cwip' ? category.cwip_account_id! : category.asset_account_id!;
    const bank = ensureAccount(all, companyId, '1010', 'Banque (MUR)', 'asset');
    const amount = amt(asset.cost) + amt(asset.attributable_costs);
    const entry = postEntry(all, companyId, journal, asset.acquisition_date, `FA-${asset.asset_code}`,
      `${kind === 'cwip' ? 'Immobilisation en cours' : 'Acquisition'} — ${asset.description} (démo fictive)`,
      [{ accountId: target, description: asset.description, debit: amount },
        { accountId: bank.id, description: 'Décaissement fictif', credit: amount }]);
    const proposal: DemoFaProposal = {
      id: uid(), company_id: companyId, asset_id: asset.id, kind, event_date: asset.acquisition_date,
      reference: `FA-${asset.asset_code}`, description: `Acquisition fictive — ${asset.description}`,
      journal_id: journal.id, currency: 'MUR',
      lines: [1, 2].map(() => ({ accountId: '', description: '', debit: '0.0000', credit: '0.0000' })),
      checks: [{ code: 'ENTRY_BALANCED', severity: 'ok', message: 'Écriture équilibrée (démonstration)' }],
      payload: {}, status: 'POSTED', approval_note: 'Validation fictive de démonstration',
      rejection_reason: null, entry_id: entry.id, posted_at: timestamp, created_at: timestamp,
    };
    // Store the real lines from the entry for display purposes.
    proposal.lines = all.lines.filter((l) => l.entry_id === entry.id).map((l) => ({
      accountId: l.account_id, description: l.description ?? '', debit: l.debit, credit: l.credit,
    }));
    proposals.push(proposal);
    return entry;
  };

  const addDepreciationBatch = (
    companyId: string, asset: DemoFaAsset, category: DemoFaCategory, journal: DemoJournal,
    accounts: ReturnType<typeof setup>, from: string, to: string, reference: string,
  ) => {
    const assetEstimates = estimates.filter((e) => e.asset_id === asset.id);
    const before = accumulatedFor({ categories, assets, estimates, events, batches, proposals, impairments, sequences }, asset.id, from);
    const impairmentPosted = impairmentFor({ categories, assets, estimates, events, batches, proposals, impairments, sequences }, asset.id, from);
    const schedule = computeSchedule(asset, assetEstimates, from, to, before, impairmentPosted);
    if (schedule.length === 0) return null;
    const total = schedule.reduce((sum, line) => sum + line.amount, 0n);
    const entry = postEntry(all, companyId, journal, monthEnd(to), reference,
      `Dotation aux amortissements ${from} → ${to} (démo fictive)`,
      [{ accountId: accounts.expenseAccount.id, description: 'Dotation aux amortissements', debit: total },
        { accountId: accounts.accumAccount.id, description: 'Amortissements cumulés', credit: total }]);
    const batch: DemoFaBatch = {
      id: uid(), company_id: companyId, reference, period_start: from, period_end: to, journal_id: journal.id,
      status: 'POSTED', total_amount: fmt(total),
      checks: [{ code: 'ENTRY_BALANCED', severity: 'ok', message: 'Écriture équilibrée (démonstration)' }],
      approval_note: 'Validation fictive de démonstration', approved_at: timestamp, entry_id: entry.id,
      posted_at: timestamp, created_at: timestamp,
      lines: schedule.map((line) => ({
        id: uid(), batch_id: '', asset_id: asset.id, category_id: category.id,
        month_start: line.monthStart, month_end: line.monthEnd, method: line.method,
        opening_nbv: fmt(line.openingNbv), depreciable_base: fmt(line.depreciableBase),
        amount: fmt(line.amount), closing_nbv: fmt(line.closingNbv),
        days_active: line.daysActive, days_in_month: line.daysInMonth,
        expense_account_id: accounts.expenseAccount.id, accumulated_account_id: accounts.accumAccount.id,
      })),
    };
    batch.lines.forEach((line) => { line.batch_id = batch.id; });
    batches.push(batch);
    events.push({
      id: uid(), company_id: companyId, asset_id: asset.id, event_type: 'depreciation_posted',
      event_date: batch.period_end, reason: reference, details: { entryId: entry.id }, created_at: timestamp,
    });
    return batch;
  };

  const seedCompany = (company: typeof main, isMain: boolean) => {
    const accounts = setup(company.id);
    const journal = all.journals.find((j) => j.company_id === company.id && j.code === 'OD')
      ?? all.journals.find((j) => j.company_id === company.id)!;
    const category = createCategory(company.id, isMain ? 'VEH' : 'VEH-B',
      isMain ? 'Motor vehicles (demo)' : 'Vehicles — second demo company',
      isMain ? 'Véhicules (démo)' : 'Véhicules — seconde société (démo)', accounts);
    const equipment = createCategory(company.id, isMain ? 'EQP' : 'EQP-B',
      isMain ? 'Computer and office equipment (demo)' : 'Equipment — second demo company',
      isMain ? 'Matériel informatique et bureau (démo)' : 'Matériel — seconde société (démo)', accounts);
    const cwipCategory = createCategory(company.id, isMain ? 'CWIP' : 'CWIP-B',
      'Assets under construction (demo)', 'Immobilisations en cours (démo)', accounts,
      {
        asset_account_id: accounts.cwipAccount.id,
        accumulated_depreciation_account_id: null,
        depreciation_expense_account_id: null,
        accumulated_impairment_account_id: null,
        impairment_loss_account_id: null,
        impairment_reversal_account_id: null,
      });

    if (isMain) {
      const vehicle = createAsset(company.id, category, {
        code: 'FA-2025-0001', description: 'Pick-up utilitaire (fictif)', acquisition: '2025-07-01',
        in_service_date: '2025-07-01', cost: '480000.0000', method: 'straight_line', useful_life_months: 60,
        depreciation_start_date: '2025-07-01', depreciation_end_date: '2030-06-30', status: 'in_service',
        invoice_ref: 'FACT-DEMO-001', location: 'Entrepôt fictif, Port-Louis',
      });
      estimates.push({ id: uid(), company_id: company.id, asset_id: vehicle.id, effective_from: '2025-07-01', method: 'straight_line', useful_life_months: 60, residual_value: '0.0000', reducing_rate: null, reason: 'Estimation fictive initiale', created_at: timestamp });
      acquisition(company.id, vehicle, category, journal);
      addDepreciationBatch(company.id, vehicle, category, journal, accounts, '2025-07-01', '2025-07-31', 'DEP-DEMO-2025-07-VEH');

      const computer = createAsset(company.id, equipment, {
        code: 'FA-2025-0002', description: 'Ordinateur portable (fictif)', acquisition: '2025-07-01',
        in_service_date: '2025-07-01', cost: '36000.0000', method: 'straight_line', useful_life_months: 36,
        depreciation_start_date: '2025-07-01', depreciation_end_date: '2028-06-30', status: 'in_service',
        invoice_ref: 'FACT-DEMO-002', serial_number: 'SERIE-FICTIVE-001',
      });
      estimates.push({ id: uid(), company_id: company.id, asset_id: computer.id, effective_from: '2025-07-01', method: 'straight_line', useful_life_months: 36, residual_value: '0.0000', reducing_rate: null, reason: 'Estimation fictive initiale', created_at: timestamp });
      acquisition(company.id, computer, equipment, journal);
      addDepreciationBatch(company.id, computer, equipment, journal, accounts, '2025-07-01', '2025-07-31', 'DEP-DEMO-2025-07-EQP');
      const impairmentEntry = postEntry(all, company.id, journal, '2025-07-31', 'IMP-DEMO-001',
        'Dépréciation fictive documentée — ordinateur portable',
        [{ accountId: accounts.lossAccount.id, description: 'Perte de dépréciation', debit: 20_000_000n },
          { accountId: accounts.impairmentAccount.id, description: 'Dépréciation cumulée', credit: 20_000_000n }]);
      impairments.push({
        id: uid(), company_id: company.id, asset_id: computer.id, impairment_date: '2025-07-31',
        amount: '2000.0000', reason: 'Obsolescence fictive documentée (démonstration)', is_reversal: false,
        status: 'POSTED', entry_id: impairmentEntry.id, created_at: timestamp,
      });
      events.push({ id: uid(), company_id: company.id, asset_id: computer.id, event_type: 'impairment', event_date: '2025-07-31', reason: 'Dépréciation fictive documentée', details: {}, created_at: timestamp });

      const machine = createAsset(company.id, category, {
        code: 'FA-2025-0003', description: 'Machine cédée avant la fin de sa durée (fictive)', acquisition: '2025-07-01',
        in_service_date: '2025-07-01', cost: '30000.0000', method: 'straight_line', useful_life_months: 60,
        depreciation_start_date: '2025-07-01', depreciation_end_date: '2030-06-30', status: 'in_service',
        invoice_ref: 'FACT-DEMO-003',
      });
      estimates.push({ id: uid(), company_id: company.id, asset_id: machine.id, effective_from: '2025-07-01', method: 'straight_line', useful_life_months: 60, residual_value: '0.0000', reducing_rate: null, reason: 'Estimation fictive initiale', created_at: timestamp });
      acquisition(company.id, machine, category, journal);
      addDepreciationBatch(company.id, machine, category, journal, accounts, '2025-07-01', '2025-07-31', 'DEP-DEMO-2025-07-MACH');
      // Disposal: NBV 275 000, proceeds 260 000, loss 15 000.
      const disposalEntry = postEntry(all, company.id, journal, '2025-07-20', 'FA-DEMO-DIS-001',
        'Cession fictive de la machine — produit 26 500, moins-value 3 000',
        [{ accountId: ensureAccount(all, company.id, '1010', 'Banque (MUR)', 'asset').id, description: 'Produit de cession fictif', debit: 265_000_000n },
          { accountId: accounts.accumAccount.id, description: 'Amortissements repris', debit: 5_000_000n },
          { accountId: accounts.lossAccount.id, description: 'Moins-value de cession', debit: 30_000_000n },
          { accountId: accounts.assetAccount.id, description: 'Coût d’origine', credit: 300_000_000n }]);
      machine.status = 'disposed';
      machine.disposal_date = '2025-07-20';
      machine.disposal_proceeds = '26500.0000';
      machine.disposal_costs = '0.0000';
      const disposalProposal: DemoFaProposal = {
        id: uid(), company_id: company.id, asset_id: machine.id, kind: 'disposal', event_date: '2025-07-20',
        reference: 'FA-DEMO-DIS-001', description: 'Cession fictive de la machine', journal_id: journal.id,
        currency: 'MUR', lines: all.lines.filter((l) => l.entry_id === disposalEntry.id).map((l) => ({
          accountId: l.account_id, description: l.description ?? '', debit: l.debit, credit: l.credit,
        })),
        checks: [{ code: 'ENTRY_BALANCED', severity: 'ok', message: 'Écriture équilibrée (démonstration)' }],
        payload: { proceeds: '26500.0000', nbv: '29500.0000', gain: '-3000.0000' },
        status: 'POSTED', approval_note: 'Validation fictive de démonstration', rejection_reason: null,
        entry_id: disposalEntry.id, posted_at: timestamp, created_at: timestamp,
      };
      proposals.push(disposalProposal);
      events.push({ id: uid(), company_id: company.id, asset_id: machine.id, event_type: 'disposal', event_date: '2025-07-20', reason: 'Cession fictive', details: {}, created_at: timestamp });

      const fully = createAsset(company.id, equipment, {
        code: 'FA-2025-0005', description: 'Imprimante totalement amortie (fictive)', acquisition: '2025-07-01',
        in_service_date: '2025-07-01', cost: '12000.0000', method: 'straight_line', useful_life_months: 1,
        depreciation_start_date: '2025-07-01', depreciation_end_date: '2025-07-31', status: 'in_service',
        invoice_ref: 'FACT-DEMO-004',
      });
      estimates.push({ id: uid(), company_id: company.id, asset_id: fully.id, effective_from: '2025-07-01', method: 'straight_line', useful_life_months: 1, residual_value: '0.0000', reducing_rate: null, reason: 'Estimation fictive initiale', created_at: timestamp });
      acquisition(company.id, fully, equipment, journal);
      addDepreciationBatch(company.id, fully, equipment, journal, accounts, '2025-07-01', '2025-07-31', 'DEP-DEMO-2025-07-FULL');

      // A pre-existing demonstration purchase already debits the asset account;
      // registering it keeps the register reconciled with the ledger.
      const existing = all.entries.find((e) => e.company_id === company.id && /matériel informatique/i.test(e.description));
      if (existing) {
        const line = all.lines.find((l) => l.entry_id === existing.id && l.account_id === accounts.assetAccount.id);
        if (line) {
          createAsset(company.id, equipment, {
            code: nextAssetCode({ categories, assets, estimates, events, batches, proposals, impairments, sequences }, company.id, Number(existing.entry_date.slice(0, 4))),
            description: 'Matériel informatique déjà enregistré (fictif)', acquisition: existing.entry_date,
            cost: line.debit, status: 'draft', invoice_ref: 'FACT-DEMO-000',
            notes: 'Immobilisation fictive rattachée à une écriture de démonstration existante.',
          });
        }
      }

      const cwip = createAsset(company.id, cwipCategory, {
        code: 'FA-2025-0004', description: 'Local en construction (fictif)', acquisition: '2025-07-01',
        cost: '500000.0000', status: 'draft', invoice_ref: 'FACT-DEMO-005',
      });
      const cwipEntry = postEntry(all, company.id, journal, '2025-07-01', 'FA-DEMO-CWIP-001',
        'Immobilisation en cours — local fictif',
        [{ accountId: accounts.cwipAccount.id, description: 'Immobilisation en cours', debit: 5000000000n },
          { accountId: ensureAccount(all, company.id, '1010', 'Banque (MUR)', 'asset').id, description: 'Décaissement fictif', credit: 5000000000n }]);
      proposals.push({
        id: uid(), company_id: company.id, asset_id: cwip.id, kind: 'cwip', event_date: '2025-07-01',
        reference: 'FA-DEMO-CWIP-001', description: 'Immobilisation en cours fictive', journal_id: journal.id,
        currency: 'MUR', lines: all.lines.filter((l) => l.entry_id === cwipEntry.id).map((l) => ({
          accountId: l.account_id, description: l.description ?? '', debit: l.debit, credit: l.credit,
        })),
        checks: [{ code: 'ENTRY_BALANCED', severity: 'ok', message: 'Écriture équilibrée (démonstration)' }],
        payload: {}, status: 'POSTED', approval_note: 'Validation fictive de démonstration', rejection_reason: null,
        entry_id: cwipEntry.id, posted_at: timestamp, created_at: timestamp,
      });
    } else {
      const truck = createAsset(company.id, category, {
        code: 'FA-2025-0101', description: 'Camionnette (fictif — seconde société)', acquisition: '2025-08-01',
        in_service_date: '2025-08-01', cost: '600000.0000', method: 'straight_line', useful_life_months: 48,
        depreciation_start_date: '2025-08-01', depreciation_end_date: '2029-07-31', status: 'in_service',
        invoice_ref: 'FACT-DEMO-B-001',
      });
      estimates.push({ id: uid(), company_id: company.id, asset_id: truck.id, effective_from: '2025-08-01', method: 'straight_line', useful_life_months: 48, residual_value: '0.0000', reducing_rate: null, reason: 'Estimation fictive initiale', created_at: timestamp });
      acquisition(company.id, truck, category, journal);
      addDepreciationBatch(company.id, truck, category, journal, accounts, '2025-08-01', '2025-12-31', 'DEP-DEMO-B-2025');

      const press = createAsset(company.id, equipment, {
        code: 'FA-2025-0102', description: 'Presse (fictive — seconde société)', acquisition: '2025-09-01',
        in_service_date: '2025-09-01', cost: '240000.0000', method: 'reducing_balance', useful_life_months: 60,
        reducing_rate: '0.20000000', depreciation_start_date: '2025-09-01', depreciation_end_date: '2030-08-31', status: 'in_service',
        invoice_ref: 'FACT-DEMO-B-002',
      });
      estimates.push({ id: uid(), company_id: company.id, asset_id: press.id, effective_from: '2025-09-01', method: 'reducing_balance', useful_life_months: 60, residual_value: '0.0000', reducing_rate: '0.20000000', reason: 'Méthode dégressive fictive de la seconde société', created_at: timestamp });
      acquisition(company.id, press, equipment, journal);
      addDepreciationBatch(company.id, press, equipment, journal, accounts, '2025-09-01', '2025-12-31', 'DEP-DEMO-B-2025-DEG');
    }
  };

  seedCompany(main, true);
  if (second) seedCompany(second, false);

  (all as DemoState & { fixedAssets?: DemoFixedAssetState }).fixedAssets = {
    categories, assets, estimates, events, batches, proposals, impairments, sequences,
  };
}

/* ------------------------------------------------------------------ runtime */

type FaState = DemoFixedAssetState;

function faState(all: DemoState): FaState {
  const holder = all as DemoState & { fixedAssets?: FaState };
  if (!holder.fixedAssets) {
    holder.fixedAssets = {
      categories: [], assets: [], estimates: [], events: [], batches: [], proposals: [], impairments: [], sequences: {},
    };
  }
  return holder.fixedAssets;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const checkDate = (value: unknown): string => {
  const text = String(value ?? '');
  if (!ISO.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00Z`))) {
    throw new ApiError(400, 'FIXED_ASSET_DATES_INVALID', 'Date invalide (AAAA-MM-JJ)');
  }
  return text;
};

function categoryOf(state: FaState, companyId: string, id: string): DemoFaCategory {
  const category = state.categories.find((c) => c.id === id && c.company_id === companyId);
  if (!category) throw new ApiError(404, 'FIXED_ASSET_CATEGORY_NOT_FOUND', 'Catégorie introuvable');
  return category;
}
function assetOf(state: FaState, companyId: string, id: string): DemoFaAsset {
  const asset = state.assets.find((a) => a.id === id && a.company_id === companyId);
  if (!asset) throw new ApiError(404, 'FIXED_ASSET_NOT_FOUND', 'Immobilisation introuvable');
  return asset;
}
function journalOf(all: DemoState, companyId: string, id: string): DemoJournal {
  const journal = all.journals.find((j) => j.id === id && j.company_id === companyId && j.is_active);
  if (!journal) throw new ApiError(400, 'JOURNAL_NOT_FOUND', 'Journal introuvable');
  return journal;
}
function accountOf(all: DemoState, companyId: string, id: string | null | undefined, label: string): DemoAccount {
  const account = all.accounts.find((a) => a.id === id && a.company_id === companyId);
  if (!account || !account.is_active) throw new ApiError(400, 'FIXED_ASSET_ACCOUNT_INVALID', `${label} invalide`);
  return account;
}
function ensurePeriodOpen(all: DemoState, companyId: string, date: string): void {
  const closed = all.periods.some((p) => p.company_id === companyId && p.status === 'closed' && p.start_date <= date && p.end_date >= date);
  if (closed) throw new ApiError(409, 'PERIOD_CLOSED', 'La période comptable est clôturée');
}
function nextAssetCode(state: FaState, companyId: string, year: number): string {
  const key = `${companyId}-${year}`;
  const next = (state.sequences[key] ?? 0) + 1;
  state.sequences[key] = next;
  return `FA-${year}-${String(next).padStart(4, '0')}`;
}
function addEvent(state: FaState, companyId: string, assetId: string, type: string, date: string, reason: string | null): void {
  state.events.push({
    id: uid(), company_id: companyId, asset_id: assetId, event_type: type, event_date: date,
    reason, details: {}, created_at: nowIso(),
  });
}

function categoryInput(state: FaState, all: DemoState, companyId: string, payload: any) {
  const code = String(payload.code ?? '').trim().toUpperCase();
  if (!code) throw new ApiError(400, 'VALIDATION_ERROR', 'Code obligatoire');
  if (!payload.nameEn || !payload.nameFr) throw new ApiError(400, 'VALIDATION_ERROR', 'Noms obligatoires');
  const accounts: Record<string, string | null> = {};
  for (const [key, label] of Object.entries({
    assetAccountId: 'Compte d’immobilisation', accumulatedDepreciationAccountId: 'Compte d’amortissements cumulés',
    depreciationExpenseAccountId: 'Compte de dotation', accumulatedImpairmentAccountId: 'Compte de dépréciation cumulée',
    impairmentLossAccountId: 'Compte de perte de dépréciation', impairmentReversalAccountId: 'Compte de reprise',
    disposalGainAccountId: 'Compte de plus-value', disposalLossAccountId: 'Compte de moins-value',
    cwipAccountId: 'Compte d’immobilisation en cours',
  })) {
    const id = payload[key];
    if (id) { accountOf(all, companyId, id, label); accounts[key] = id; } else accounts[key] = null;
  }
  return {
    code,
    name_en: String(payload.nameEn).trim(),
    name_fr: String(payload.nameFr).trim(),
    is_depreciable: payload.isDepreciable !== false,
    default_method: payload.defaultMethod ?? null,
    default_useful_life_months: payload.defaultUsefulLifeMonths ?? null,
    default_residual_value: fmt(amt(payload.defaultResidualValue ?? '0')),
    default_reducing_rate: payload.defaultReducingRate ?? null,
    asset_account_id: accounts.assetAccountId ?? null,
    accumulated_depreciation_account_id: accounts.accumulatedDepreciationAccountId ?? null,
    depreciation_expense_account_id: accounts.depreciationExpenseAccountId ?? null,
    accumulated_impairment_account_id: accounts.accumulatedImpairmentAccountId ?? null,
    impairment_loss_account_id: accounts.impairmentLossAccountId ?? null,
    impairment_reversal_account_id: accounts.impairmentReversalAccountId ?? null,
    disposal_gain_account_id: accounts.disposalGainAccountId ?? null,
    disposal_loss_account_id: accounts.disposalLossAccountId ?? null,
    cwip_account_id: accounts.cwipAccountId ?? null,
    is_active: payload.isActive !== false,
  };
}

function assetPayload(all: DemoState, state: FaState, companyId: string, payload: any) {
  const category = categoryOf(state, companyId, String(payload.categoryId));
  const acquisitionDate = checkDate(payload.acquisitionDate);
  const inServiceDate = payload.inServiceDate ? checkDate(payload.inServiceDate) : null;
  if (inServiceDate && inServiceDate < acquisitionDate) {
    throw new ApiError(400, 'FIXED_ASSET_DATES_INVALID', 'La mise en service précède l’acquisition');
  }
  const cost = amt(payload.cost);
  if (cost <= 0n) throw new ApiError(400, 'FIXED_ASSET_COST_INVALID', 'Le coût doit être positif');
  const attributable = amt(payload.attributableCosts ?? '0');
  const residual = amt(payload.residualValue ?? '0');
  if (residual < 0n || residual > cost + attributable) throw new ApiError(400, 'FIXED_ASSET_RESIDUAL_INVALID', 'Valeur résiduelle invalide');
  const method = payload.method ?? null;
  const life = payload.usefulLifeMonths ? Number(payload.usefulLifeMonths) : null;
  if (method && (!life || life <= 0)) throw new ApiError(400, 'FIXED_ASSET_LIFE_INVALID', 'Durée d’utilité requise');
  const rate = payload.reducingRate ? String(payload.reducingRate) : null;
  if (method === 'reducing_balance' && !rate) throw new ApiError(400, 'FIXED_ASSET_RATE_REQUIRED', 'Taux dégressif requis');
  return {
    category, acquisitionDate, inServiceDate, cost, attributable, residual, method, life, rate,
    description: String(payload.description ?? '').trim(),
  };
}

/* ----------------------------------------------------------------- reports */

function reportRows(state: FaState, all: DemoState, companyId: string, asOf: string) {
  return state.assets
    .filter((a) => a.company_id === companyId && a.acquisition_date <= asOf)
    .map((asset) => {
      const view = assetView(state, all, asset) as any;
      const disposed = ['disposed', 'written_off'].includes(asset.status) && !!asset.disposal_date && asset.disposal_date <= asOf;
      return {
        ...view,
        assetCode: asset.asset_code,
        categoryCode: state.categories.find((c) => c.id === asset.category_id)?.code ?? '',
        grossCost: view.functionalCost,
        cost: disposed ? '0.0000' : view.functionalCost,
        historicalAccumulatedDepreciation: view.accumulatedDepreciation,
        accumulatedDepreciation: disposed ? '0.0000' : view.accumulatedDepreciation,
        accumulatedImpairment: disposed ? '0.0000' : view.accumulatedImpairment,
        netBookValue: view.netBookValue,
        assetAccountId: state.categories.find((c) => c.id === asset.category_id)?.asset_account_id ?? null,
        accumulatedAccountId: state.categories.find((c) => c.id === asset.category_id)?.accumulated_depreciation_account_id ?? null,
        impairmentAccountId: state.categories.find((c) => c.id === asset.category_id)?.accumulated_impairment_account_id ?? null,
        disposed,
      };
    });
}

function glBalance(all: DemoState, companyId: string, accountId: string | null, asOf: string): bigint {
  if (!accountId) return 0n;
  const entries = all.entries.filter((e) => e.company_id === companyId && e.status === 'posted' && e.entry_date <= asOf);
  return entries.flatMap((e) => all.lines.filter((l) => l.entry_id === e.id && l.account_id === accountId))
    .reduce((sum, line) => sum + amt(line.debit) - amt(line.credit), 0n);
}

function buildReport(state: FaState, all: DemoState, companyId: string, report: string, query: Record<string, string>) {
  const from = query.from ?? '2025-07-01';
  const to = query.to ?? '2026-06-30';
  const asOf = query.asOf ?? to;
  const rows = reportRows(state, all, companyId, asOf);
  const sum = (values: string[]) => values.reduce((total, value) => total + amt(value), 0n);
  switch (report) {
    case 'register':
      return {
        report, asOf, rows: rows.map((r) => ({ ...r, label: `${r.categoryCode} — ${r.assetCode}` })),
        totals: {
          cost: fmt(sum(rows.map((r) => r.grossCost))),
          accumulatedDepreciation: fmt(sum(rows.map((r) => r.historicalAccumulatedDepreciation))),
          accumulatedImpairment: fmt(sum(rows.map((r) => r.accumulatedImpairment))),
          netBookValue: fmt(sum(rows.map((r) => r.netBookValue))),
        },
      };
    case 'schedule': {
      const lines = state.batches.filter((b) => b.company_id === companyId)
        .flatMap((b) => b.lines.map((l) => ({ ...l, batch: b })))
        .filter((l) => l.month_start >= from && l.month_end <= to && (!query.assetId || l.asset_id === query.assetId));
      const mapped = lines.map((l) => {
        const asset = state.assets.find((a) => a.id === l.asset_id)!;
        return {
          id: l.id, assetId: l.asset_id, assetCode: asset.asset_code, description: asset.description,
          categoryCode: state.categories.find((c) => c.id === l.category_id)?.code ?? '',
          monthStart: l.month_start, monthEnd: l.month_end, method: l.method, amount: l.amount,
          openingNbv: l.opening_nbv, closingNbv: l.closing_nbv, daysActive: l.days_active,
          daysInMonth: l.days_in_month, batchReference: l.batch.reference,
          batchStatus: l.batch.status, entryId: l.batch.entry_id,
        };
      });
      return {
        report, from, to, rows: mapped,
        totals: {
          amount: fmt(sum(mapped.map((l) => l.amount))),
          posted: fmt(sum(mapped.filter((l) => l.batchStatus === 'POSTED').map((l) => l.amount))),
          draft: fmt(sum(mapped.filter((l) => l.batchStatus !== 'POSTED').map((l) => l.amount))),
        },
      };
    }
    case 'accumulated': {
      return {
        report, asOf,
        rows: rows.map((r) => ({
          assetId: r.id, assetCode: r.assetCode, description: r.description, categoryCode: r.categoryCode,
          cost: r.grossCost, accumulatedDepreciation: r.accumulatedDepreciation,
          accumulatedImpairment: r.accumulatedImpairment, netBookValue: r.netBookValue,
        })),
        byCategory: [], totals: {
          cost: fmt(sum(rows.map((r) => r.grossCost))),
          accumulatedDepreciation: fmt(sum(rows.map((r) => r.accumulatedDepreciation))),
          accumulatedImpairment: fmt(sum(rows.map((r) => r.accumulatedImpairment))),
          netBookValue: fmt(sum(rows.map((r) => r.netBookValue))),
        },
      };
    }
    case 'nbv':
      return {
        report, asOf,
        rows: rows.map((r) => ({
          assetId: r.id, assetCode: r.assetCode, description: r.description, categoryCode: r.categoryCode,
          cost: r.grossCost, residualValue: r.residualValue, accumulatedDepreciation: r.accumulatedDepreciation,
          accumulatedImpairment: r.accumulatedImpairment, netBookValue: r.netBookValue, status: r.status,
        })),
        totals: {
          cost: fmt(sum(rows.map((r) => r.grossCost))),
          accumulatedDepreciation: fmt(sum(rows.map((r) => r.accumulatedDepreciation))),
          accumulatedImpairment: fmt(sum(rows.map((r) => r.accumulatedImpairment))),
          netBookValue: fmt(sum(rows.map((r) => r.netBookValue))),
        },
      };
    case 'additions-disposals': {
      const additions = rows.filter((r) => r.acquisitionDate >= from && r.acquisitionDate <= to);
      const disposals = rows.filter((r) => r.disposed && r.disposalDate && r.disposalDate >= from && r.disposalDate <= to);
      return {
        report, from, to,
        additions: additions.map((r) => ({ assetId: r.id, assetCode: r.assetCode, description: r.description, categoryCode: r.categoryCode, acquisitionDate: r.acquisitionDate, cost: r.grossCost })),
        disposals: disposals.map((r) => ({ assetId: r.id, assetCode: r.assetCode, description: r.description, categoryCode: r.categoryCode, disposalDate: r.disposalDate, cost: r.grossCost, accumulatedDepreciation: r.historicalAccumulatedDepreciation, netBookValue: '0.0000' })),
        totals: { additions: fmt(sum(additions.map((r) => r.grossCost))), disposalsCost: fmt(sum(disposals.map((r) => r.grossCost))), disposalsNbv: '0.0000' },
      };
    }
    case 'reconciliation': {
      const groups = new Map<string, any>();
      for (const row of rows) {
        const key = `${row.assetAccountId ?? ''}|${row.accumulatedAccountId ?? ''}|${row.impairmentAccountId ?? ''}`;
        if (!groups.has(key)) {
          groups.set(key, {
            categoryId: key, categoryCode: row.categoryCode, categoryNameEn: '', categoryNameFr: '',
            assetAccountId: row.assetAccountId, accumulatedAccountId: row.accumulatedAccountId,
            impairmentAccountId: row.impairmentAccountId,
            registerCost: 0n, registerDepreciation: 0n, registerImpairment: 0n,
          });
        }
        const group = groups.get(key);
        if (!String(group.categoryCode).split(', ').includes(row.categoryCode)) {
          group.categoryCode = `${group.categoryCode}, ${row.categoryCode}`;
        }
        group.registerCost += amt(row.cost);
        group.registerDepreciation += amt(row.accumulatedDepreciation);
        group.registerImpairment += amt(row.accumulatedImpairment);
      }
      const output = [...groups.values()].map((group) => {
        const assetGl = glBalance(all, companyId, group.assetAccountId, asOf);
        const depGl = -glBalance(all, companyId, group.accumulatedAccountId, asOf);
        const impGl = -glBalance(all, companyId, group.impairmentAccountId, asOf);
        return {
          categoryId: group.categoryId, categoryCode: group.categoryCode, categoryNameEn: '', categoryNameFr: '',
          registerCost: fmt(group.registerCost), assetGl: fmt(assetGl), costDifference: fmt(group.registerCost - assetGl),
          registerDepreciation: fmt(group.registerDepreciation), depreciationGl: fmt(depGl),
          depreciationDifference: fmt(group.registerDepreciation - depGl),
          registerImpairment: fmt(group.registerImpairment), impairmentGl: fmt(impGl),
          impairmentDifference: fmt(group.registerImpairment - impGl),
        };
      });
      const difference = output.reduce((sumValue, row) => sumValue + amt(row.costDifference) + amt(row.depreciationDifference) + amt(row.impairmentDifference), 0n);
      return { report, asOf, rows: output, difference: fmt(difference), balanced: difference === 0n };
    }
    case 'movement-schedule': {
      const opening = reportRows(state, all, companyId, addDays(from, -1));
      const closing = reportRows(state, all, companyId, to);
      const additions = closing.filter((r) => r.acquisitionDate >= from && r.acquisitionDate <= to);
      const disposals = closing.filter((r) => r.disposed && r.disposalDate && r.disposalDate >= from && r.disposalDate <= to);
      const openingCost = sum(opening.map((r) => r.cost));
      const closingCost = sum(closing.map((r) => r.cost));
      const additionCost = sum(additions.map((r) => r.grossCost));
      const disposalCost = sum(disposals.map((r) => r.grossCost));
      const charge = sum(state.batches.filter((b) => b.company_id === companyId && b.status === 'POSTED')
        .flatMap((b) => b.lines).filter((l) => l.month_end >= from && l.month_end <= to).map((l) => l.amount));
      const openingDep = sum(opening.map((r) => r.accumulatedDepreciation));
      const closingDep = sum(closing.map((r) => r.accumulatedDepreciation));
      const disposalDep = sum(disposals.map((r) => r.historicalAccumulatedDepreciation));
      return {
        report, from, to,
        cost: { opening: fmt(openingCost), additions: fmt(additionCost), disposals: fmt(-disposalCost), closing: fmt(closingCost), check: fmt(openingCost + additionCost - disposalCost - closingCost) },
        depreciation: { opening: fmt(openingDep), charge: fmt(charge), disposals: fmt(-disposalDep), closing: fmt(closingDep), check: fmt(openingDep + charge - disposalDep - closingDep) },
        netBookValue: { opening: fmt(sum(opening.map((r) => r.netBookValue))), closing: fmt(sum(closing.map((r) => r.netBookValue))) },
        rows: closing.map((r) => ({ assetCode: r.assetCode, description: r.description, categoryCode: r.categoryCode, cost: r.cost, accumulatedDepreciation: r.accumulatedDepreciation, netBookValue: r.netBookValue, acquisitionDate: r.acquisitionDate, disposalDate: r.disposalDate })),
      };
    }
    default:
      throw new ApiError(400, 'FIXED_ASSET_REPORT_UNKNOWN', 'État inconnu');
  }
}

/* ------------------------------------------------------------------ handler */

export function handleDemoFixedAssets(
  all: DemoState,
  companyId: string,
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  rest: string,
  query: Record<string, string>,
  payload: any,
): unknown {
  const state = faState(all);
  const path = rest.split('?')[0] ?? '';

  // ------------------------------------------------------------ categories
  if (path === '/categories' && method === 'GET') {
    return { categories: state.categories.filter((c) => c.company_id === companyId).map((c) => categoryView(all, c)) };
  }
  if (path === '/categories' && method === 'POST') {
    const input = categoryInput(state, all, companyId, payload);
    if (state.categories.some((c) => c.company_id === companyId && c.code === input.code)) {
      throw new ApiError(409, 'FIXED_ASSET_CATEGORY_CODE_TAKEN', 'Ce code de catégorie existe déjà');
    }
    const category: DemoFaCategory = { id: uid(), company_id: companyId, ...input, created_at: nowIso(), updated_at: nowIso() };
    state.categories.push(category);
    return { category: categoryView(all, category) };
  }
  const categoryMatch = /^\/categories\/([0-9a-f-]{36})$/.exec(path);
  if (categoryMatch && method === 'PATCH') {
    const category = categoryOf(state, companyId, categoryMatch[1]!);
    const input = categoryInput(state, all, companyId, payload);
    Object.assign(category, input, { updated_at: nowIso() });
    return { category: categoryView(all, category) };
  }

  // ----------------------------------------------------------- reports
  const reportMatch = /^\/reports\/([a-z-]+)$/.exec(path);
  if (reportMatch && method === 'GET') {
    return buildReport(state, all, companyId, reportMatch[1]!, query);
  }

  // ------------------------------------------------------- depreciation
  if (path === '/depreciation/preview' && method === 'GET') {
    return previewBatch(all, state, companyId, query);
  }
  if (path === '/depreciation/batches' && method === 'GET') {
    return { batches: state.batches.filter((b) => b.company_id === companyId).map((b) => batchView(all, state, b)) };
  }
  if (path === '/depreciation/batches' && method === 'POST') {
    return { batch: createBatch(all, state, companyId, payload) };
  }
  const batchMatch = /^\/depreciation\/batches\/([0-9a-f-]{36})(?:\/(approve|post))?$/.exec(path);
  if (batchMatch) {
    const batch = state.batches.find((b) => b.id === batchMatch[1] && b.company_id === companyId);
    if (!batch) throw new ApiError(404, 'DEPRECIATION_BATCH_NOT_FOUND', 'Lot introuvable');
    if (method === 'GET' && !batchMatch[2]) return { batch: batchView(all, state, batch) };
    if (method === 'DELETE' && !batchMatch[2]) {
      if (batch.status !== 'DRAFT') throw new ApiError(409, 'DEPRECIATION_BATCH_LOCKED', 'Seul un brouillon peut être supprimé');
      state.batches = state.batches.filter((b) => b.id !== batch.id);
      return { ok: true };
    }
    if (method === 'POST' && batchMatch[2] === 'approve') {
      if (batch.status !== 'DRAFT') throw new ApiError(409, 'DEPRECIATION_BATCH_LOCKED', 'Seul un brouillon peut être approuvé');
      const note = String(payload?.note ?? '').trim();
      if (!payload?.confirm || note.length < 10) throw new ApiError(400, 'FIXED_ASSET_PROPOSAL_INVALID', 'Confirmation et note requises');
      batch.status = 'APPROVED';
      batch.approval_note = note;
      batch.approved_at = nowIso();
      return { batch: batchView(all, state, batch) };
    }
    if (method === 'POST' && batchMatch[2] === 'post') {
      if (batch.status === 'POSTED') throw new ApiError(409, 'DEPRECIATION_ALREADY_POSTED', 'Lot déjà comptabilisé');
      if (batch.status !== 'APPROVED') throw new ApiError(409, 'DEPRECIATION_BATCH_NOT_APPROVED', 'Le lot doit être approuvé');
      ensurePeriodOpen(all, companyId, batch.period_end);
      const byAsset = new Map<string, bigint>();
      for (const line of batch.lines) byAsset.set(line.asset_id, (byAsset.get(line.asset_id) ?? 0n) + amt(line.amount));
      const journal = journalOf(all, companyId, batch.journal_id);
      const lines: { accountId: string; description: string; debit?: bigint; credit?: bigint }[] = [];
      let total = 0n;
      for (const line of batch.lines) {
        lines.push({ accountId: line.expense_account_id, description: `Dotation ${line.month_start}`, debit: amt(line.amount) });
        lines.push({ accountId: line.accumulated_account_id, description: `Amortissements cumulés ${line.month_start}`, credit: amt(line.amount) });
        total += amt(line.amount);
      }
      const entry = postEntry(all, companyId, journal, batch.period_end, batch.reference,
        `Dotation aux amortissements ${batch.period_start} → ${batch.period_end} (démo)`, lines);
      batch.status = 'POSTED';
      batch.entry_id = entry.id;
      batch.posted_at = nowIso();
      batch.total_amount = fmt(total);
      for (const assetId of byAsset.keys()) addEvent(state, companyId, assetId, 'depreciation_posted', batch.period_end, batch.reference);
      return { batch: batchView(all, state, batch), entry };
    }
  }

  // ------------------------------------------------------------ proposals
  if (path === '/proposals' && method === 'GET') {
    return {
      proposals: state.proposals
        .filter((p) => p.company_id === companyId && (!query.assetId || p.asset_id === query.assetId) && (!query.kind || p.kind === query.kind) && (!query.status || p.status === query.status))
        .map((p) => proposalView(state, all, p)),
    };
  }
  const proposalMatch = /^\/proposals\/([0-9a-f-]{36})(?:\/(approve|reject|post))?$/.exec(path);
  if (proposalMatch) {
    const proposal = state.proposals.find((p) => p.id === proposalMatch[1] && p.company_id === companyId);
    if (!proposal) throw new ApiError(404, 'FIXED_ASSET_PROPOSAL_NOT_FOUND', 'Proposition introuvable');
    if (method === 'GET' && !proposalMatch[2]) return { proposal: proposalView(state, all, proposal) };
    if (method === 'POST' && proposalMatch[2] === 'approve') {
      if (proposal.status === 'POSTED') throw new ApiError(409, 'FIXED_ASSET_PROPOSAL_ALREADY_POSTED', 'Proposition déjà comptabilisée');
      if (proposal.status !== 'PROPOSED') throw new ApiError(409, 'FIXED_ASSET_PROPOSAL_LOCKED', 'Proposition verrouillée');
      const note = String(payload?.note ?? '').trim();
      if (!payload?.confirm || note.length < 10) throw new ApiError(400, 'FIXED_ASSET_PROPOSAL_INVALID', 'Confirmation et note requises');
      proposal.status = 'APPROVED';
      proposal.approval_note = note;
      return { proposal: proposalView(state, all, proposal) };
    }
    if (method === 'POST' && proposalMatch[2] === 'reject') {
      const reason = String(payload?.reason ?? '').trim();
      if (reason.length < 10) throw new ApiError(400, 'FIXED_ASSET_PROPOSAL_INVALID', 'Motif requis');
      proposal.status = 'REJECTED';
      proposal.rejection_reason = reason;
      return { proposal: proposalView(state, all, proposal) };
    }
    if (method === 'POST' && proposalMatch[2] === 'post') {
      if (proposal.status === 'POSTED') throw new ApiError(409, 'FIXED_ASSET_PROPOSAL_ALREADY_POSTED', 'Proposition déjà comptabilisée');
      if (proposal.status !== 'APPROVED') throw new ApiError(409, 'FIXED_ASSET_PROPOSAL_NOT_APPROVED', 'La proposition doit être approuvée');
      ensurePeriodOpen(all, companyId, proposal.event_date);
      const journal = journalOf(all, companyId, proposal.journal_id);
      const entry = postEntry(all, companyId, journal, proposal.event_date, proposal.reference,
        proposal.description, proposal.lines.map((l) => ({
          accountId: l.accountId, description: l.description, debit: amt(l.debit), credit: amt(l.credit),
        })));
      proposal.status = 'POSTED';
      proposal.entry_id = entry.id;
      proposal.posted_at = nowIso();
      applyProposalSideEffects(all, state, companyId, proposal);
      return { proposal: proposalView(state, all, proposal), entry };
    }
  }

  // --------------------------------------------------------------- assets
  if (path === '' && method === 'GET') {
    const assets = state.assets
      .filter((a) => a.company_id === companyId && (!query.categoryId || a.category_id === query.categoryId) && (!query.status || a.status === query.status) && (!query.asOf || a.acquisition_date <= query.asOf))
      .sort((a, b) => b.acquisition_date.localeCompare(a.acquisition_date) || a.asset_code.localeCompare(b.asset_code));
    return { assets: assets.map((a) => assetView(state, all, a)) };
  }
  if (path === '' && method === 'POST') {
    const input = assetPayload(all, state, companyId, payload);
    if (input.description.length < 3) throw new ApiError(400, 'VALIDATION_ERROR', 'Description requise');
    let code = payload.assetCode ? String(payload.assetCode) : nextAssetCode(state, companyId, Number(input.acquisitionDate.slice(0, 4)));
    if (state.assets.some((a) => a.company_id === companyId && a.asset_code === code)) {
      throw new ApiError(409, 'FIXED_ASSET_CODE_TAKEN', 'Ce code existe déjà');
    }
    const asset: DemoFaAsset = {
      id: uid(), company_id: companyId, category_id: input.category.id, asset_code: code,
      description: input.description, serial_number: payload.serialNumber ?? null, location: payload.location ?? null,
      acquisition_date: input.acquisitionDate, in_service_date: input.inServiceDate,
      supplier_name: payload.supplierName ?? null, invoice_ref: payload.invoiceRef ?? null, document_ref: payload.documentRef ?? null,
      cost: fmt(input.cost), attributable_costs: fmt(input.attributable), residual_value: fmt(input.residual),
      currency: String(payload.currency ?? 'MUR'), exchange_rate: String(payload.exchangeRate ?? '1'),
      fx_note: payload.fxNote ?? null, method: input.method, useful_life_months: input.life,
      reducing_rate: input.rate, depreciation_start_date: input.inServiceDate,
      depreciation_end_date: input.method && input.life && input.inServiceDate ? addDays(addMonths(input.inServiceDate, input.life), -1) : null,
      status: input.inServiceDate && input.method ? 'in_service' : 'draft',
      suspended_from: null, suspended_to: null, suspended_reason: null, notes: payload.notes ?? null,
      disposal_date: null, disposal_proceeds: null, disposal_costs: null, created_at: nowIso(), updated_at: nowIso(),
    };
    state.assets.push(asset);
    addEvent(state, companyId, asset.id, 'created', asset.acquisition_date, 'Création (démo)');
    if (input.inServiceDate && input.method && input.life) {
      state.estimates.push({
        id: uid(), company_id: companyId, asset_id: asset.id, effective_from: input.inServiceDate,
        method: input.method, useful_life_months: input.life, residual_value: fmt(input.residual),
        reducing_rate: input.rate, reason: 'Estimation initiale (démo)', created_at: nowIso(),
      });
    }
    return { asset: assetView(state, all, asset), estimates: state.estimates.filter((e) => e.asset_id === asset.id), events: [], proposals: [], impairments: [] };
  }
  const assetMatch = /^\/([0-9a-f-]{36})(?:\/(activate|revise-estimate|suspend|resume|schedule|proposals))?$/.exec(path);
  if (assetMatch) {
    const asset = assetOf(state, companyId, assetMatch[1]!);
    const action = assetMatch[2];
    if (method === 'GET' && !action) {
      return {
        asset: assetView(state, all, asset),
        estimates: state.estimates.filter((e) => e.asset_id === asset.id),
        events: state.events.filter((e) => e.asset_id === asset.id).sort((a, b) => b.created_at.localeCompare(a.created_at)),
        proposals: state.proposals.filter((p) => p.asset_id === asset.id).map((p) => ({
          id: p.id, kind: p.kind, eventDate: p.event_date, reference: p.reference, description: p.description,
          status: p.status, total: fmt(p.lines.reduce((sum, l) => sum + amt(l.debit), 0n)),
          entryId: p.entry_id, createdAt: p.created_at,
        })),
        impairments: state.impairments.filter((i) => i.asset_id === asset.id),
      };
    }
    if (method === 'PATCH' && !action) {
      if (['disposed', 'written_off'].includes(asset.status)) throw new ApiError(400, 'FIXED_ASSET_ALREADY_DISPOSED', 'Immobilisation sortie');
      const input = assetPayload(all, state, companyId, { ...asset, ...payload });
      asset.description = input.description;
      asset.category_id = input.category.id;
      asset.acquisition_date = input.acquisitionDate;
      asset.in_service_date = input.inServiceDate;
      asset.cost = fmt(input.cost);
      asset.attributable_costs = fmt(input.attributable);
      asset.residual_value = fmt(input.residual);
      asset.method = input.method;
      asset.useful_life_months = input.life;
      asset.reducing_rate = input.rate;
      asset.updated_at = nowIso();
      return { asset: assetView(state, all, asset) };
    }
    if (method === 'GET' && action === 'schedule') {
      const from = query.from ?? '2025-07-01';
      const to = query.to ?? '2026-06-30';
      const before = accumulatedBefore(state, asset.id, from);
      const impairmentBefore = impairmentBeforeDate(state, asset.id, from);
      const lines = computeSchedule(asset, state.estimates.filter((e) => e.asset_id === asset.id), from, to, before, impairmentBefore);
      return {
        from, to,
        lines: lines.map((l) => ({
          monthStart: l.monthStart, monthEnd: l.monthEnd, amount: fmt(l.amount), method: l.method,
          openingNbv: fmt(l.openingNbv), closingNbv: fmt(l.closingNbv), depreciableBase: fmt(l.depreciableBase),
          residualValue: '0.0000', daysActive: l.daysActive, daysInMonth: l.daysInMonth, usefulLifeMonths: 0,
        })),
      };
    }
    if (method === 'POST' && action === 'activate') {
      if (asset.status !== 'draft') throw new ApiError(409, 'FIXED_ASSET_STATUS_INVALID', 'Seul un brouillon peut être mis en service');
      const inService = checkDate(payload.inServiceDate);
      if (inService < asset.acquisition_date) throw new ApiError(400, 'FIXED_ASSET_DATES_INVALID', 'Date de mise en service invalide');
      asset.in_service_date = inService;
      asset.depreciation_start_date = inService;
      asset.method = payload.method ?? 'straight_line';
      asset.useful_life_months = Number(payload.usefulLifeMonths);
      asset.residual_value = fmt(amt(payload.residualValue ?? '0'));
      asset.reducing_rate = payload.reducingRate ?? null;
      asset.depreciation_end_date = addDays(addMonths(inService, asset.useful_life_months), -1);
      asset.status = 'in_service';
      asset.updated_at = nowIso();
      state.estimates.push({
        id: uid(), company_id: companyId, asset_id: asset.id, effective_from: inService,
        method: asset.method ?? 'straight_line', useful_life_months: asset.useful_life_months ?? 1, residual_value: asset.residual_value,
        reducing_rate: asset.reducing_rate, reason: String(payload.reason ?? 'Mise en service (démo)'), created_at: nowIso(),
      });
      addEvent(state, companyId, asset.id, 'activated', inService, 'Mise en service (démo)');
      return { asset: assetView(state, all, asset) };
    }
    if (method === 'POST' && action === 'revise-estimate') {
      const effective = checkDate(payload.effectiveFrom);
      if (!effective.endsWith('-01')) throw new ApiError(400, 'FIXED_ASSET_ESTIMATE_DATE_INVALID', 'La révision doit commencer le 1er du mois');
      state.estimates.push({
        id: uid(), company_id: companyId, asset_id: asset.id, effective_from: effective,
        method: payload.method ?? asset.method ?? 'straight_line', useful_life_months: Number(payload.usefulLifeMonths),
        residual_value: fmt(amt(payload.residualValue ?? '0')), reducing_rate: payload.reducingRate ?? null,
        reason: String(payload.reason ?? ''), created_at: nowIso(),
      });
      asset.method = payload.method ?? asset.method;
      asset.useful_life_months = Number(payload.usefulLifeMonths);
      asset.residual_value = fmt(amt(payload.residualValue ?? '0'));
      addEvent(state, companyId, asset.id, 'estimate_revised', effective, String(payload.reason ?? ''));
      return { asset: assetView(state, all, asset) };
    }
    if (method === 'POST' && action === 'suspend') {
      if (asset.status !== 'in_service') throw new ApiError(409, 'FIXED_ASSET_STATUS_INVALID', 'Immobilisation non en service');
      asset.status = 'suspended';
      asset.suspended_from = checkDate(payload.from);
      asset.suspended_reason = String(payload.reason ?? '');
      addEvent(state, companyId, asset.id, 'suspended', asset.suspended_from, asset.suspended_reason);
      return { asset: assetView(state, all, asset) };
    }
    if (method === 'POST' && action === 'resume') {
      if (asset.status !== 'suspended') throw new ApiError(409, 'FIXED_ASSET_NOT_SUSPENDED', 'Immobilisation non suspendue');
      asset.status = 'in_service';
      asset.suspended_to = checkDate(payload.from);
      addEvent(state, companyId, asset.id, 'resumed', asset.suspended_to, payload.reason ?? null);
      return { asset: assetView(state, all, asset) };
    }
    if (method === 'POST' && action === 'proposals') {
      const proposal = createProposal(all, state, companyId, asset, payload);
      return { proposal: proposalView(state, all, proposal) };
    }
  }
  throw new ApiError(404, 'NOT_FOUND', 'Route immobilisation inconnue');
}

function accumulatedBefore(state: FaState, assetId: string, date: string): bigint {
  return state.batches.filter((b) => b.status === 'POSTED').flatMap((b) => b.lines)
    .filter((l) => l.asset_id === assetId && l.month_end < date).reduce((sum, l) => sum + amt(l.amount), 0n);
}
function impairmentBeforeDate(state: FaState, assetId: string, date: string): bigint {
  return state.impairments.filter((i) => i.asset_id === assetId && i.impairment_date < date)
    .reduce((sum, i) => sum + (i.is_reversal ? -amt(i.amount) : amt(i.amount)), 0n);
}

function batchView(all: DemoState, state: FaState, batch: DemoFaBatch) {
  const journal = all.journals.find((j) => j.id === batch.journal_id);
  const entry = batch.entry_id ? all.entries.find((e) => e.id === batch.entry_id) : null;
  return {
    id: batch.id, reference: batch.reference, periodStart: batch.period_start, periodEnd: batch.period_end,
    journal: { id: journal?.id, code: journal?.code, name: journal?.name }, status: batch.status,
    totalAmount: batch.total_amount, checks: batch.checks, blockers: [], warnings: [],
    approvalNote: batch.approval_note, approvedByName: null, approvedAt: batch.approved_at,
    entryId: batch.entry_id, entryNo: entry?.entry_no ?? null, postedAt: batch.posted_at, createdAt: batch.created_at,
    lines: batch.lines.map((l) => ({
      id: l.id, assetId: l.asset_id,
      assetCode: state.assets.find((a) => a.id === l.asset_id)?.asset_code ?? '',
      description: state.assets.find((a) => a.id === l.asset_id)?.description ?? '',
      monthStart: l.month_start, monthEnd: l.month_end, method: l.method, amount: l.amount,
      openingNbv: l.opening_nbv, closingNbv: l.closing_nbv, daysActive: l.days_active,
      daysInMonth: l.days_in_month, depreciableBase: l.depreciable_base,
    })),
  };
}

function previewBatch(all: DemoState, state: FaState, companyId: string, query: Record<string, string>) {
  const from = checkDate(query.from);
  const to = checkDate(query.to);
  if (from > to) throw new ApiError(400, 'DEPRECIATION_PERIOD_INVALID', 'Période invalide');
  if (!from.endsWith('-01') || monthEnd(to) !== to) throw new ApiError(400, 'DEPRECIATION_PERIOD_INVALID', 'Période mensuelle complète requise');
  const assets = state.assets.filter((a) => a.company_id === companyId && ['in_service', 'suspended'].includes(a.status) && (!query.assetId || a.id === query.assetId));
  const checks: { code: string; severity: 'ok' | 'warning' | 'block'; message: string }[] = [];
  const lines: any[] = [];
  for (const asset of assets) {
    const category = state.categories.find((c) => c.id === asset.category_id)!;
    if (!category.depreciation_expense_account_id || !category.accumulated_depreciation_account_id) {
      checks.push({ code: 'ACCOUNTS_NOT_CONFIGURED', severity: 'block', message: `Compte manquant pour ${asset.asset_code}` });
      continue;
    }
    const before = accumulatedBefore(state, asset.id, from);
    const impairmentBefore = impairmentBeforeDate(state, asset.id, from);
    const schedule = computeSchedule(asset, state.estimates.filter((e) => e.asset_id === asset.id), from, to, before, impairmentBefore);
    for (const line of schedule) {
      lines.push({
        assetId: asset.id, assetCode: asset.asset_code, description: asset.description,
        categoryId: category.id, monthStart: line.monthStart, monthEnd: line.monthEnd,
        amount: fmt(line.amount), method: line.method, openingNbv: fmt(line.openingNbv),
        depreciableBase: fmt(line.depreciableBase), closingNbv: fmt(line.closingNbv),
        daysActive: line.daysActive, daysInMonth: line.daysInMonth,
        expenseAccountId: category.depreciation_expense_account_id,
        accumulatedAccountId: category.accumulated_depreciation_account_id,
      });
    }
  }
  const overlap = state.batches.filter((b) => b.company_id === companyId && b.status === 'POSTED')
    .flatMap((b) => b.lines)
    .some((l) => l.month_start <= to && l.month_end >= from && (!query.assetId || l.asset_id === query.assetId));
  if (overlap) checks.push({ code: 'DEPRECIATION_ALREADY_POSTED', severity: 'block', message: 'Un amortissement est déjà comptabilisé sur cette période' });
  const total = lines.reduce((sum, line) => sum + amt(line.amount), 0n);
  if (lines.length > 0) checks.push({ code: 'ENTRY_BALANCED', severity: 'ok', message: 'Débit et crédit égaux' });
  if (lines.length === 0 && !checks.some((c) => c.severity === 'block')) checks.push({ code: 'DEPRECIATION_NOTHING_TO_POST', severity: 'warning', message: 'Aucun amortissement dû sur la période' });
  return {
    from, to, lines,
    totals: { amount: fmt(total), debit: fmt(total), credit: fmt(total), difference: '0.0000' },
    checks, blockers: checks.filter((c) => c.severity === 'block'), warnings: checks.filter((c) => c.severity === 'warning'),
    assets: new Set(lines.map((l) => l.assetId)).size,
  };
}

function createBatch(all: DemoState, state: FaState, companyId: string, payload: any): any {
  const from = checkDate(payload.from);
  const to = checkDate(payload.to);
  const journal = journalOf(all, companyId, String(payload.journalId));
  const preview = previewBatch(all, state, companyId, { from, to });
  if (preview.blockers.length > 0) throw new ApiError(409, 'DEPRECIATION_DUPLICATE_PERIOD', preview.blockers[0]!.message);
  if (preview.lines.length === 0) throw new ApiError(400, 'DEPRECIATION_NOTHING_TO_POST', 'Aucun amortissement dû');
  const reference = String(payload.reference ?? '').trim() || `DEP-${from.slice(0, 7)}`;
  if (state.batches.some((b) => b.company_id === companyId && b.reference === reference)) {
    throw new ApiError(409, 'DEPRECIATION_BATCH_EXISTS', 'Référence déjà utilisée');
  }
  const batch: DemoFaBatch = {
    id: uid(), company_id: companyId, reference, period_start: from, period_end: to, journal_id: journal.id,
    status: 'DRAFT', total_amount: preview.totals.amount, checks: preview.checks,
    approval_note: null, approved_at: null, entry_id: null, posted_at: null, created_at: nowIso(),
    lines: preview.lines.map((line: any) => ({
      id: uid(), batch_id: '', asset_id: line.assetId, category_id: line.categoryId,
      month_start: line.monthStart, month_end: line.monthEnd, method: line.method,
      opening_nbv: line.openingNbv, depreciable_base: line.depreciableBase, amount: line.amount,
      closing_nbv: line.closingNbv, days_active: line.daysActive, days_in_month: line.daysInMonth,
      expense_account_id: line.expenseAccountId, accumulated_account_id: line.accumulatedAccountId,
    })),
  };
  batch.lines.forEach((line) => { line.batch_id = batch.id; });
  state.batches.push(batch);
  return batchView(all, state, batch);
}

function proposalAccount(all: DemoState, companyId: string, id: string | null | undefined, label: string): string {
  return accountOf(all, companyId, id, label).id;
}

function createProposal(all: DemoState, state: FaState, companyId: string, asset: DemoFaAsset, payload: any): DemoFaProposal {
  const kind = String(payload.kind);
  const eventDate = checkDate(payload.eventDate);
  const reference = String(payload.reference ?? '').trim();
  if (reference.length < 2) throw new ApiError(400, 'FIXED_ASSET_PROPOSAL_INVALID', 'Référence requise');
  if (state.proposals.some((p) => p.company_id === companyId && p.reference === reference)) {
    throw new ApiError(409, 'FIXED_ASSET_PROPOSAL_REFERENCE_TAKEN', 'Référence déjà utilisée');
  }
  const journal = journalOf(all, companyId, String(payload.journalId));
  const category = state.categories.find((c) => c.id === asset.category_id)!;
  const functional = functionalCostOf(asset);
  const accum = accumulatedBefore(state, asset.id, addDays(eventDate, 1));
  const impairment = impairmentBeforeDate(state, asset.id, addDays(eventDate, 1));
  const lines: { accountId: string; description: string; debit?: string; credit?: string }[] = [];
  let proposalPayload: Record<string, unknown> = {};
  const push = (accountId: string, description: string, debit: bigint, credit: bigint) => {
    if (debit === 0n && credit === 0n) return;
    lines.push({ accountId, description, debit: debit > 0n ? fmt(debit) : undefined, credit: credit > 0n ? fmt(credit) : undefined });
  };
  if (['disposed', 'written_off'].includes(asset.status)) throw new ApiError(400, 'FIXED_ASSET_ALREADY_DISPOSED', 'Immobilisation sortie');
  switch (kind) {
    case 'acquisition':
    case 'cwip': {
      const target = kind === 'cwip' ? category.cwip_account_id : category.asset_account_id;
      if (!target) throw new ApiError(400, 'FIXED_ASSET_ACCOUNTS_NOT_CONFIGURED', 'Compte non configuré');
      const counterparty = proposalAccount(all, companyId, payload.counterpartyAccountId, 'Contrepartie');
      push(target, asset.description, functional, 0n);
      push(counterparty, 'Contrepartie fictive', 0n, functional);
      break;
    }
    case 'commissioning': {
      if (!category.asset_account_id || !category.cwip_account_id) throw new ApiError(400, 'FIXED_ASSET_ACCOUNTS_NOT_CONFIGURED', 'Comptes non configurés');
      push(category.asset_account_id, `Mise en service — ${asset.description}`, functional, 0n);
      push(category.cwip_account_id, 'Transfert depuis immobilisation en cours', 0n, functional);
      proposalPayload = { inServiceDate: checkDate(payload.inServiceDate), method: payload.method, usefulLifeMonths: Number(payload.usefulLifeMonths), residualValue: fmt(amt(payload.residualValue ?? '0')) };
      break;
    }
    case 'impairment':
    case 'impairment_reversal': {
      if (!category.accumulated_impairment_account_id || !category.impairment_loss_account_id || !category.impairment_reversal_account_id) {
        throw new ApiError(400, 'FIXED_ASSET_ACCOUNTS_NOT_CONFIGURED', 'Comptes de dépréciation non configurés');
      }
      const amount = amt(payload.impairmentAmount);
      if (amount <= 0n) throw new ApiError(400, 'FIXED_ASSET_IMPAIRMENT_INVALID', 'Montant positif requis');
      const nbv = functional - accum - impairment;
      if (kind === 'impairment' && amount > nbv) throw new ApiError(400, 'FIXED_ASSET_IMPAIRMENT_INVALID', 'Dépréciation supérieure à la VNC');
      if (kind === 'impairment_reversal' && amount > impairment) throw new ApiError(400, 'FIXED_ASSET_IMPAIRMENT_INVALID', 'Reprise supérieure à la dépréciation cumulée');
      if (kind === 'impairment') {
        push(category.impairment_loss_account_id, 'Perte de dépréciation', amount, 0n);
        push(category.accumulated_impairment_account_id, 'Dépréciation cumulée', 0n, amount);
      } else {
        push(category.accumulated_impairment_account_id, 'Reprise de dépréciation', amount, 0n);
        push(category.impairment_reversal_account_id, 'Produit de reprise', 0n, amount);
      }
      if (String(payload.impairmentReason ?? '').trim().length < 5) throw new ApiError(400, 'FIXED_ASSET_IMPAIRMENT_INVALID', 'Motif documenté requis');
      proposalPayload = { amount: fmt(amount), reason: payload.impairmentReason, isReversal: kind === 'impairment_reversal' };
      break;
    }
    case 'disposal': {
      if (!category.asset_account_id || !category.accumulated_depreciation_account_id || !category.disposal_gain_account_id || !category.disposal_loss_account_id) {
        throw new ApiError(400, 'FIXED_ASSET_ACCOUNTS_NOT_CONFIGURED', 'Comptes de cession non configurés');
      }
      const proceeds = amt(payload.proceedsAmount ?? '0');
      const proceedsAccount = proposalAccount(all, companyId, payload.proceedsAccountId, 'Compte de produit');
      const nbv = functional - accum - impairment;
      const gain = proceeds - nbv;
      push(proceedsAccount, 'Produit de cession', proceeds, 0n);
      push(category.accumulated_depreciation_account_id, 'Amortissements repris', accum, 0n);
      if (impairment > 0n && category.accumulated_impairment_account_id) push(category.accumulated_impairment_account_id, 'Dépréciation reprise', impairment, 0n);
      push(category.asset_account_id, 'Coût d’origine', 0n, functional);
      if (gain > 0n) push(category.disposal_gain_account_id, 'Plus-value de cession', 0n, gain);
      if (gain < 0n) push(category.disposal_loss_account_id, 'Moins-value de cession', -gain, 0n);
      proposalPayload = { proceeds: fmt(proceeds), nbv: fmt(nbv), gain: fmt(gain), accumulatedDepreciation: fmt(accum) };
      break;
    }
    case 'write_off': {
      if (!category.asset_account_id || !category.accumulated_depreciation_account_id || !category.disposal_loss_account_id) {
        throw new ApiError(400, 'FIXED_ASSET_ACCOUNTS_NOT_CONFIGURED', 'Comptes de rebut non configurés');
      }
      const nbv = functional - accum - impairment;
      push(category.accumulated_depreciation_account_id, 'Amortissements repris', accum, 0n);
      if (impairment > 0n && category.accumulated_impairment_account_id) push(category.accumulated_impairment_account_id, 'Dépréciation reprise', impairment, 0n);
      if (nbv > 0n) push(category.disposal_loss_account_id, 'Mise au rebut', nbv, 0n);
      push(category.asset_account_id, 'Coût d’origine', 0n, functional);
      proposalPayload = { nbv: fmt(nbv) };
      break;
    }
    case 'reclassification': {
      const from = proposalAccount(all, companyId, payload.fromAccountId, 'Compte source');
      const to = proposalAccount(all, companyId, payload.toAccountId, 'Compte cible');
      const value = amt(payload.reclassAmount);
      if (value <= 0n) throw new ApiError(400, 'FIXED_ASSET_PROPOSAL_INVALID', 'Montant positif requis');
      push(to, 'Reclassement entrant', value, 0n);
      push(from, 'Reclassement sortant', 0n, value);
      proposalPayload = { amount: fmt(value), fromAccountId: from, toAccountId: to };
      break;
    }
    default:
      throw new ApiError(400, 'FIXED_ASSET_PROPOSAL_INVALID', 'Opération inconnue');
  }
  const debit = lines.reduce((sum, l) => sum + amt(l.debit), 0n);
  const credit = lines.reduce((sum, l) => sum + amt(l.credit), 0n);
  if (debit !== credit) throw new ApiError(400, 'ENTRY_UNBALANCED', 'Écriture déséquilibrée');
  const proposal: DemoFaProposal = {
    id: uid(), company_id: companyId, asset_id: asset.id, kind, event_date: eventDate, reference,
    description: String(payload.description ?? '').trim() || `${kind} — ${asset.asset_code}`,
    journal_id: journal.id, currency: 'MUR', lines,
    checks: [{ code: 'ENTRY_BALANCED', severity: 'ok', message: 'Débit et crédit égaux' }],
    payload: proposalPayload, status: 'PROPOSED', approval_note: null, rejection_reason: null,
    entry_id: null, posted_at: null, created_at: nowIso(),
  };
  state.proposals.push(proposal);
  return proposal;
}

function applyProposalSideEffects(all: DemoState, state: FaState, companyId: string, proposal: DemoFaProposal): void {
  const asset = state.assets.find((a) => a.id === proposal.asset_id)!;
  const category = state.categories.find((c) => c.id === asset.category_id)!;
  const payload = proposal.payload as any;
  switch (proposal.kind) {
    case 'commissioning': {
      asset.status = 'in_service';
      asset.in_service_date = String(payload.inServiceDate);
      asset.depreciation_start_date = String(payload.inServiceDate);
      asset.method = payload.method ?? null;
      asset.useful_life_months = payload.usefulLifeMonths ?? null;
      asset.residual_value = String(payload.residualValue ?? '0.0000');
      if (asset.method && asset.useful_life_months) {
        asset.depreciation_end_date = addDays(addMonths(asset.in_service_date, asset.useful_life_months), -1);
        state.estimates.push({
          id: uid(), company_id: companyId, asset_id: asset.id, effective_from: asset.in_service_date,
          method: asset.method, useful_life_months: asset.useful_life_months, residual_value: asset.residual_value,
          reducing_rate: null, reason: 'Mise en service (démo)', created_at: nowIso(),
        });
      }
      addEvent(state, companyId, asset.id, 'activated', String(payload.inServiceDate), 'Mise en service');
      break;
    }
    case 'impairment':
    case 'impairment_reversal':
      state.impairments.push({
        id: uid(), company_id: companyId, asset_id: asset.id, impairment_date: proposal.event_date,
        amount: String(payload.amount), reason: String(payload.reason), is_reversal: Boolean(payload.isReversal),
        status: 'POSTED', entry_id: proposal.entry_id!, created_at: nowIso(),
      });
      addEvent(state, companyId, asset.id, payload.isReversal ? 'impairment_reversal' : 'impairment', proposal.event_date, String(payload.reason));
      break;
    case 'disposal':
      asset.status = 'disposed';
      asset.disposal_date = proposal.event_date;
      asset.disposal_proceeds = String(payload.proceeds ?? '0.0000');
      asset.disposal_costs = '0.0000';
      addEvent(state, companyId, asset.id, 'disposal', proposal.event_date, 'Cession (démo)');
      break;
    case 'write_off':
      asset.status = 'written_off';
      asset.disposal_date = proposal.event_date;
      addEvent(state, companyId, asset.id, 'written_off', proposal.event_date, 'Mise au rebut (démo)');
      break;
    case 'reclassification':
      if (payload.targetCategoryId) asset.category_id = String(payload.targetCategoryId);
      addEvent(state, companyId, asset.id, 'reclassified', proposal.event_date, 'Reclassement (démo)');
      break;
    default:
      break;
  }
}

export function fixedAssetCsv(all: DemoState, companyId: string, report: string, query: Record<string, string>): string {
  const state = faState(all);
  const data: any = buildReport(state, all, companyId, report, query);
  const rows: (string | number)[][] = [];
  const esc = (value: string | number) => {
    const text = String(value);
    return /[;"\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  rows.push([`DEMONSTRATION EXPORT — fixed assets ${report}`]);
  if (report === 'register' || report === 'accumulated' || report === 'nbv') {
    rows.push(['Asset', 'Category', 'Description', 'Cost', 'Accumulated depreciation', 'Accumulated impairment', 'NBV']);
    for (const row of data.rows) rows.push([row.assetCode, row.categoryCode ?? '', row.description, row.cost ?? row.grossCost ?? '', row.accumulatedDepreciation ?? '', row.accumulatedImpairment ?? '', row.netBookValue ?? '']);
  } else if (report === 'schedule') {
    rows.push(['Asset', 'Month', 'Method', 'Amount', 'NBV', 'Batch']);
    for (const row of data.rows) rows.push([row.assetCode, row.monthStart, row.method, row.amount, row.closingNbv, row.batchReference]);
  } else if (report === 'reconciliation') {
    rows.push(['Category', 'Register cost', 'Ledger', 'Difference', 'Register depreciation', 'Ledger depreciation']);
    for (const row of data.rows) rows.push([row.categoryCode, row.registerCost, row.assetGl, row.costDifference, row.registerDepreciation, row.depreciationGl]);
  } else if (report === 'additions-disposals') {
    rows.push(['Type', 'Asset', 'Date', 'Cost', 'NBV']);
    data.additions.forEach((row: any) => rows.push(['Addition', row.assetCode, row.acquisitionDate, row.cost, '']));
    data.disposals.forEach((row: any) => rows.push(['Disposal', row.assetCode, row.disposalDate, row.cost, row.netBookValue]));
  } else {
    rows.push(['Section', 'Cost', 'Depreciation']);
    rows.push(['Opening', data.cost.opening, data.depreciation.opening]);
    rows.push(['Additions', data.cost.additions, data.depreciation.charge]);
    rows.push(['Disposals', data.cost.disposals, data.depreciation.disposals]);
    rows.push(['Closing', data.cost.closing, data.depreciation.closing]);
  }
  return rows.map((row) => row.map(esc).join(';')).join('\r\n');
}
