import type { Db } from '../../db/index.js';
import { badRequest } from '../../lib/errors.js';
import { formatAmount, parseAmount } from '../../lib/money.js';
import { addDays } from './depreciation.js';
import { functionalCost, functionalResidual } from './service.js';

const ISO = /^\d{4}-\d{2}-\d{2}$/;
function date(value: string, field: string) {
  if (!ISO.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw badRequest('FIXED_ASSET_REPORT_RANGE_INVALID', `${field} must be a valid date`);
  }
  return value;
}
function range(from: string, to: string) {
  if (from > to) throw badRequest('FIXED_ASSET_REPORT_RANGE_INVALID', 'The start date must be before the end date');
}

async function rowsAsOf(db: Db, companyId: string, asOf: string) {
  const res = await db.query<any>(
    `SELECT a.*, c.code AS category_code, c.name_en AS category_name_en, c.name_fr AS category_name_fr,
            c.asset_account_id, c.accumulated_depreciation_account_id, c.accumulated_impairment_account_id,
            COALESCE(dep.amount,0)::text AS accumulated_depreciation,
            COALESCE(imp.amount,0)::text AS accumulated_impairment
       FROM fixed_assets a
       JOIN fixed_asset_categories c ON c.id = a.category_id
       LEFT JOIN (
         SELECT l.asset_id, SUM(l.amount) AS amount
           FROM fixed_asset_depreciation_lines l
           JOIN fixed_asset_depreciation_batches b ON b.id = l.batch_id
          WHERE b.status = 'POSTED' AND l.month_end <= $2
          GROUP BY l.asset_id
       ) dep ON dep.asset_id = a.id
       LEFT JOIN (
         SELECT i.asset_id, SUM(CASE WHEN i.is_reversal THEN -i.amount ELSE i.amount END) AS amount
           FROM fixed_asset_impairments i
          WHERE i.status = 'POSTED' AND i.impairment_date <= $2
          GROUP BY i.asset_id
       ) imp ON imp.asset_id = a.id
      WHERE a.company_id = $1 AND a.acquisition_date <= $2
      ORDER BY c.code, a.asset_code`, [companyId, asOf]);
  return res.rows.map((row: any) => {
    const rate = String(row.exchange_rate);
    const cost = functionalCost(row.cost, row.attributable_costs, rate);
    const residual = functionalResidual(row.residual_value, rate);
    const dep = parseAmount(row.accumulated_depreciation);
    const imp = parseAmount(row.accumulated_impairment);
    const disposed = ['disposed', 'written_off'].includes(row.status) && !!row.disposal_date && row.disposal_date <= asOf;
    return {
      id: row.id, assetCode: row.asset_code, description: row.description,
      categoryId: row.category_id, categoryCode: row.category_code,
      categoryNameEn: row.category_name_en, categoryNameFr: row.category_name_fr,
      acquisitionDate: row.acquisition_date, inServiceDate: row.in_service_date,
      method: row.method, usefulLifeMonths: row.useful_life_months,
      depreciationStartDate: row.depreciation_start_date, depreciationEndDate: row.depreciation_end_date,
      status: row.status, location: row.location,
      grossCost: formatAmount(cost), cost: formatAmount(disposed ? 0n : cost),
      residualValue: formatAmount(residual),
      accumulatedDepreciation: formatAmount(disposed ? 0n : dep),
      accumulatedImpairment: formatAmount(disposed ? 0n : imp),
      historicalAccumulatedDepreciation: formatAmount(dep),
      netBookValue: formatAmount(disposed ? 0n : cost - dep - imp),
      assetAccountId: row.asset_account_id,
      accumulatedAccountId: row.accumulated_depreciation_account_id,
      impairmentAccountId: row.accumulated_impairment_account_id,
      disposed, disposalDate: row.disposal_date,
    };
  });
}

export async function registerReport(db: Db, companyId: string, asOf: string) {
  date(asOf, 'asOf');
  const rows = await rowsAsOf(db, companyId, asOf);
  return {
    report: 'register', asOf,
    rows: rows.map((r) => ({
      ...r,
      label: `${r.categoryCode} — ${r.assetCode}`,
    })),
    totals: {
      cost: formatAmount(rows.reduce((s, r) => s + parseAmount(r.grossCost), 0n)),
      accumulatedDepreciation: formatAmount(rows.reduce((s, r) => s + parseAmount(r.historicalAccumulatedDepreciation), 0n)),
      accumulatedImpairment: formatAmount(rows.reduce((s, r) => s + parseAmount(r.accumulatedImpairment), 0n)),
      netBookValue: formatAmount(rows.reduce((s, r) => s + parseAmount(r.netBookValue), 0n)),
    },
  };
}


export async function scheduleReport(db: Db, companyId: string, from: string, to: string, assetId?: string) {
  date(from, 'from'); date(to, 'to'); range(from, to);
  const params: unknown[] = [companyId, from, to];
  let filter = '';
  if (assetId) { params.push(assetId); filter = `AND l.asset_id = $${params.length}`; }
  const res = await db.query<any>(
    `SELECT l.*, a.asset_code, a.description AS asset_description, c.code AS category_code,
            b.reference AS batch_reference, b.status AS batch_status, b.entry_id
       FROM fixed_asset_depreciation_lines l
       JOIN fixed_assets a ON a.id = l.asset_id
       JOIN fixed_asset_categories c ON c.id = l.category_id
       JOIN fixed_asset_depreciation_batches b ON b.id = l.batch_id
      WHERE l.company_id = $1 AND l.month_start >= $2 AND l.month_end <= $3 ${filter}
      ORDER BY a.asset_code, l.month_start`, params);
  const rows = res.rows.map((r: any) => ({
    id: r.id, assetId: r.asset_id, assetCode: r.asset_code, description: r.asset_description,
    categoryCode: r.category_code, monthStart: r.month_start, monthEnd: r.month_end,
    method: r.method, amount: r.amount, openingNbv: r.opening_nbv, closingNbv: r.closing_nbv,
    daysActive: r.days_active, daysInMonth: r.days_in_month,
    batchReference: r.batch_reference, batchStatus: r.batch_status, entryId: r.entry_id,
  }));
  return {
    report: 'schedule', from, to,
    rows,
    totals: {
      amount: formatAmount(rows.reduce((s: bigint, r: any) => s + parseAmount(r.amount), 0n)),
      posted: formatAmount(rows.filter((r: any) => r.batchStatus === 'POSTED').reduce((s: bigint, r: any) => s + parseAmount(r.amount), 0n)),
      draft: formatAmount(rows.filter((r: any) => r.batchStatus !== 'POSTED').reduce((s: bigint, r: any) => s + parseAmount(r.amount), 0n)),
    },
  };
}

export async function accumulatedReport(db: Db, companyId: string, asOf: string) {
  const register = await registerReport(db, companyId, asOf);
  const byCategory = new Map<string, any>();
  for (const row of register.rows) {
    const key = row.categoryId;
    const existing = byCategory.get(key) ?? {
      categoryId: key, categoryCode: row.categoryCode,
      categoryNameEn: row.categoryNameEn, categoryNameFr: row.categoryNameFr,
      cost: 0n, accumulatedDepreciation: 0n, accumulatedImpairment: 0n,
    };
    existing.cost += parseAmount(row.cost);
    existing.accumulatedDepreciation += parseAmount(row.accumulatedDepreciation);
    existing.accumulatedImpairment += parseAmount(row.accumulatedImpairment);
    byCategory.set(key, existing);
  }
  return {
    report: 'accumulated', asOf,
    rows: register.rows.map((r) => ({
      assetId: r.id, assetCode: r.assetCode, description: r.description,
      categoryCode: r.categoryCode, cost: r.cost,
      accumulatedDepreciation: r.accumulatedDepreciation, accumulatedImpairment: r.accumulatedImpairment,
      netBookValue: r.netBookValue,
    })),
    byCategory: [...byCategory.values()].map((c) => ({
      ...c, cost: formatAmount(c.cost),
      accumulatedDepreciation: formatAmount(c.accumulatedDepreciation),
      accumulatedImpairment: formatAmount(c.accumulatedImpairment),
    })),
    totals: register.totals,
  };
}

export async function nbvReport(db: Db, companyId: string, asOf: string) {
  const register = await registerReport(db, companyId, asOf);
  return {
    report: 'nbv', asOf,
    rows: register.rows.map((r) => ({
      assetId: r.id, assetCode: r.assetCode, description: r.description,
      categoryCode: r.categoryCode, cost: r.cost, residualValue: r.residualValue,
      accumulatedDepreciation: r.accumulatedDepreciation, accumulatedImpairment: r.accumulatedImpairment,
      netBookValue: r.netBookValue, status: r.status,
    })),
    totals: register.totals,
  };
}

export async function additionsDisposalsReport(db: Db, companyId: string, from: string, to: string) {
  date(from, 'from'); date(to, 'to'); range(from, to);
  const register = await registerReport(db, companyId, to);
  const additions = register.rows.filter((r) => r.acquisitionDate >= from && r.acquisitionDate <= to);
  const disposals = register.rows.filter((r) => r.disposed && r.disposalDate && r.disposalDate >= from && r.disposalDate <= to);
  return {
    report: 'additions-disposals', from, to,
    additions: additions.map((r) => ({
      assetId: r.id, assetCode: r.assetCode, description: r.description,
      categoryCode: r.categoryCode, acquisitionDate: r.acquisitionDate, cost: r.grossCost,
    })),
    disposals: disposals.map((r) => ({
      assetId: r.id, assetCode: r.assetCode, description: r.description,
      categoryCode: r.categoryCode, disposalDate: r.disposalDate, cost: r.grossCost,
      accumulatedDepreciation: r.historicalAccumulatedDepreciation, netBookValue: '0.0000',
    })),
    totals: {
      additions: formatAmount(additions.reduce((s, r) => s + parseAmount(r.grossCost), 0n)),
      disposalsCost: formatAmount(disposals.reduce((s, r) => s + parseAmount(r.grossCost), 0n)),
      disposalsNbv: formatAmount(disposals.reduce((s, r) => s + parseAmount(r.netBookValue), 0n)),
    },
  };
}

export async function reconciliationReport(db: Db, companyId: string, asOf: string) {
  date(asOf, 'asOf');
  const register = await registerReport(db, companyId, asOf);
  // Group by configured accounts, because several categories may share the
  // same general-ledger accounts.
  const byCategory = new Map<string, any>();
  for (const row of register.rows) {
    const key = `${row.assetAccountId ?? ''}|${row.accumulatedAccountId ?? ''}|${row.impairmentAccountId ?? ''}`;
    if (!byCategory.has(key)) {
      byCategory.set(key, {
        categoryId: key, categoryCode: row.categoryCode,
        categoryNameEn: row.categoryNameEn, categoryNameFr: row.categoryNameFr,
        assetAccountId: row.assetAccountId, accumulatedAccountId: row.accumulatedAccountId,
        impairmentAccountId: row.impairmentAccountId,
        registerCost: 0n, registerDepreciation: 0n, registerImpairment: 0n,
      });
    }
    const entry = byCategory.get(key);
    const codes = String(entry.categoryCode).split(', ');
    if (!codes.includes(row.categoryCode)) entry.categoryCode = [...codes, row.categoryCode].join(', ');
    entry.registerCost += parseAmount(row.cost);
    entry.registerDepreciation += parseAmount(row.accumulatedDepreciation);
    entry.registerImpairment += parseAmount(row.accumulatedImpairment);
  }
  const accountBalance = async (accountId: string | null) => {
    if (!accountId) return 0n;
    const res = await db.query<{ net: string }>(
      `SELECT COALESCE(SUM(l.debit - l.credit),0)::text AS net
         FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
        WHERE l.account_id = $1 AND e.company_id = $2 AND e.status = 'posted' AND e.entry_date <= $3`,
      [accountId, companyId, asOf]);
    return parseAmount(res.rows[0]!.net);
  };
  const rows = [];
  for (const category of byCategory.values()) {
    const assetGl = await accountBalance(category.assetAccountId);
    const depGl = -(await accountBalance(category.accumulatedAccountId));
    const impGl = -(await accountBalance(category.impairmentAccountId));
    rows.push({
      categoryId: category.categoryId, categoryCode: category.categoryCode,
      categoryNameEn: category.categoryNameEn, categoryNameFr: category.categoryNameFr,
      registerCost: formatAmount(category.registerCost), assetGl: formatAmount(assetGl),
      costDifference: formatAmount(category.registerCost - assetGl),
      registerDepreciation: formatAmount(category.registerDepreciation), depreciationGl: formatAmount(depGl),
      depreciationDifference: formatAmount(category.registerDepreciation - depGl),
      registerImpairment: formatAmount(category.registerImpairment), impairmentGl: formatAmount(impGl),
      impairmentDifference: formatAmount(category.registerImpairment - impGl),
    });
  }
  const differences = rows.reduce((s, r) => s + parseAmount(r.costDifference) + parseAmount(r.depreciationDifference) + parseAmount(r.impairmentDifference), 0n);
  return { report: 'reconciliation', asOf, rows, difference: formatAmount(differences), balanced: differences === 0n };
}

export async function movementScheduleReport(db: Db, companyId: string, from: string, to: string) {
  date(from, 'from'); date(to, 'to'); range(from, to);
  const openingDate = addDays(from, -1);
  const opening = await rowsAsOf(db, companyId, openingDate);
  const closing = await rowsAsOf(db, companyId, to);
  const additions = closing.filter((r) => r.acquisitionDate >= from && r.acquisitionDate <= to);
  const disposals = closing.filter((r) => r.disposed && r.disposalDate && r.disposalDate >= from && r.disposalDate <= to);
  const openingCost = opening.reduce((s, r) => s + parseAmount(r.cost), 0n);
  const closingCost = closing.reduce((s, r) => s + parseAmount(r.cost), 0n);
  const disposalCost = disposals.reduce((s, r) => s + parseAmount(r.grossCost), 0n);
  const additionCost = additions.reduce((s, r) => s + parseAmount(r.grossCost), 0n);
  const openingDep = opening.reduce((s, r) => s + parseAmount(r.accumulatedDepreciation), 0n);
  const closingDep = closing.reduce((s, r) => s + parseAmount(r.accumulatedDepreciation), 0n);
  const disposalDep = disposals.reduce((s, r) => s + parseAmount(r.historicalAccumulatedDepreciation), 0n);
  const chargeRes = await db.query<{ amount: string }>(
    `SELECT COALESCE(SUM(l.amount),0)::text AS amount
       FROM fixed_asset_depreciation_lines l
       JOIN fixed_asset_depreciation_batches b ON b.id = l.batch_id
      WHERE l.company_id = $1 AND b.status = 'POSTED' AND l.month_end >= $2 AND l.month_end <= $3`,
    [companyId, from, to]);
  const charge = parseAmount(chargeRes.rows[0]!.amount);
  return {
    report: 'movement-schedule', from, to,
    cost: {
      opening: formatAmount(openingCost), additions: formatAmount(additionCost),
      disposals: formatAmount(-disposalCost), closing: formatAmount(closingCost),
      check: formatAmount(openingCost + additionCost - disposalCost - closingCost),
    },
    depreciation: {
      opening: formatAmount(openingDep), charge: formatAmount(charge),
      disposals: formatAmount(-disposalDep), closing: formatAmount(closingDep),
      check: formatAmount(openingDep + charge - disposalDep - closingDep),
    },
    netBookValue: {
      opening: formatAmount(opening.reduce((s, r) => s + parseAmount(r.netBookValue), 0n)),
      closing: formatAmount(closing.reduce((s, r) => s + parseAmount(r.netBookValue), 0n)),
    },
    rows: closing.map((r) => ({
      assetCode: r.assetCode, description: r.description, categoryCode: r.categoryCode,
      cost: r.cost, accumulatedDepreciation: r.accumulatedDepreciation, netBookValue: r.netBookValue,
      acquisitionDate: r.acquisitionDate, disposalDate: r.disposalDate,
    })),
  };
}
