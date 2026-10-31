import type { Db } from '../../db/index.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { formatAmount, parseAmount } from '../../lib/money.js';
import { assertOpenPeriod, insertLines, loadAccounts, loadJournal, nextEntryNo, prepareEntry } from '../entries/service.js';
import { writeAudit } from '../../lib/audit.js';
import { addDays, addMonths, computeSchedule, monthEnd } from './depreciation.js';
import {
  accumulatedUpTo,
  functionalCost,
  getAssetRow,
  getCategoryRow,
  loadContext,
  type AssetActor,
} from './service.js';

const ISO = /^\d{4}-\d{2}-\d{2}$/;
function assertMonthRange(from: string, to: string) {
  if (from.slice(8, 10) !== '01' || monthEnd(to) !== to) {
    throw badRequest('DEPRECIATION_PERIOD_INVALID', 'A depreciation period must start on the first day and end on the last day of a month');
  }
}
async function assertAccount(db: Db, companyId: string, accountId: string | null | undefined, label: string) {
  if (!accountId) throw badRequest('FIXED_ASSET_ACCOUNT_INVALID', `${label} is required`);
  const res = await db.query<{ is_active: boolean }>('SELECT is_active FROM accounts WHERE id = $1 AND company_id = $2', [accountId, companyId]);
  if (!res.rows[0]) throw badRequest('FIXED_ASSET_ACCOUNT_INVALID', `${label} does not belong to this company`);
  if (!res.rows[0].is_active) throw badRequest('FIXED_ASSET_ACCOUNT_INVALID', `${label} is inactive`);
  return accountId;
}

const checkDate = (value: string) => {
  if (!ISO.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw badRequest('FIXED_ASSET_DATES_INVALID', 'Invalid date (YYYY-MM-DD)');
  }
  return value;
};

async function audit(db: Db, actor: AssetActor, action: string, entityType: string, entityId: string, details: Record<string, unknown> = {}) {
  await writeAudit(db, { companyId: actor.companyId, userId: actor.userId, action, entityType, entityId, details, ip: actor.ip ?? null });
}
async function cabinetIdOf(db: Db, companyId: string): Promise<string> {
  const res = await db.query<{ cabinet_id: string }>('SELECT cabinet_id FROM companies WHERE id = $1', [companyId]);
  if (!res.rows[0]) throw notFound('COMPANY_NOT_FOUND', 'Company not found');
  return res.rows[0].cabinet_id;
}
function requireAccounts(category: any, keys: [string, string][]) {
  const missing = keys.filter(([key]) => !category[key]).map(([, label]) => label);
  if (missing.length > 0) {
    throw badRequest('FIXED_ASSET_ACCOUNTS_NOT_CONFIGURED', `Category accounts are not configured: ${missing.join(', ')}`, { missing });
  }
}

/* ------------------------------------------------------------- depreciation */

export interface BatchPreviewLine {
  assetId: string;
  assetCode: string;
  description: string;
  categoryId: string;
  monthStart: string;
  monthEnd: string;
  amount: string;
  method: string;
  openingNbv: string;
  depreciableBase: string;
  closingNbv: string;
  daysActive: number;
  daysInMonth: number;
  expenseAccountId: string | null;
  accumulatedAccountId: string | null;
}

export interface BatchPreview {
  from: string;
  to: string;
  lines: BatchPreviewLine[];
  totals: { amount: string; debit: string; credit: string; difference: string };
  checks: { code: string; severity: 'ok' | 'warning' | 'block'; message: string }[];
  blockers: { code: string; severity: string; message: string }[];
  warnings: { code: string; severity: string; message: string }[];
  assets: number;
}

export async function previewDepreciation(db: Db, companyId: string, from: string, to: string, assetIds?: string[]): Promise<BatchPreview> {
  checkDate(from); checkDate(to);
  if (from > to) throw badRequest('DEPRECIATION_PERIOD_INVALID', 'The start date must be before the end date');
  assertMonthRange(from, to);
  const assets = await db.query<any>(
    `SELECT a.* FROM fixed_assets a WHERE a.company_id = $1 AND a.status IN ('in_service','suspended')
      ${assetIds && assetIds.length ? 'AND a.id = ANY($2::uuid[])' : ''}
      ORDER BY a.asset_code`,
    assetIds && assetIds.length ? [companyId, assetIds] : [companyId],
  );
  const checks: BatchPreview['checks'] = [];
  const lines: BatchPreviewLine[] = [];
  let skippedNoAccounts = 0;
  for (const asset of assets.rows) {
    const category = await getCategoryRow(db, companyId, asset.category_id);
    const accountErrors: string[] = [];
    if (!category.depreciation_expense_account_id) accountErrors.push('depreciation expense');
    if (!category.accumulated_depreciation_account_id) accountErrors.push('accumulated depreciation');
    if (accountErrors.length > 0) {
      skippedNoAccounts += 1;
      checks.push({ code: 'ACCOUNTS_NOT_CONFIGURED', severity: 'block', message: `Asset ${asset.asset_code}: missing ${accountErrors.join(', ')} account` });
      continue;
    }
    const { context, accumulatedPosted, impairmentPosted } = await loadContext(db, companyId, asset.id, from);
    const schedule = computeSchedule(context, { from, to, accumulatedPosted, impairmentPosted });
    for (const line of schedule) {
      lines.push({
        assetId: asset.id, assetCode: asset.asset_code, description: asset.description,
        categoryId: asset.category_id, monthStart: line.monthStart, monthEnd: line.monthEnd,
        amount: formatAmount(line.amount), method: line.method,
        openingNbv: formatAmount(line.openingNbv), depreciableBase: formatAmount(line.depreciableBase),
        closingNbv: formatAmount(line.closingNbv),
        daysActive: line.daysActive, daysInMonth: line.daysInMonth,
        expenseAccountId: category.depreciation_expense_account_id,
        accumulatedAccountId: category.accumulated_depreciation_account_id,
      });
    }
  }
  const overlapParams: unknown[] = [companyId, from, to];
  const assetFilter = assetIds && assetIds.length ? 'AND l.asset_id = ANY($4::uuid[])' : '';
  if (assetFilter) overlapParams.push(assetIds);
  const postedOverlap = await db.query<any>(
    `SELECT l.asset_id, l.month_start FROM fixed_asset_depreciation_lines l
       JOIN fixed_asset_depreciation_batches b ON b.id = l.batch_id
      WHERE l.company_id = $1 AND b.status = 'POSTED'
        AND l.month_start <= $3 AND l.month_end >= $2 ${assetFilter}`,
    overlapParams);
  if (postedOverlap.rowCount > 0) {
    checks.push({ code: 'DEPRECIATION_ALREADY_POSTED', severity: 'block', message: 'Depreciation is already posted for at least one month in this period' });
  }
  const closed = await db.query(
    'SELECT 1 FROM accounting_periods WHERE company_id = $1 AND status = $2 AND start_date <= $3 AND end_date >= $4',
    [companyId, 'closed', to, from]);
  if (closed.rowCount > 0) checks.push({ code: 'DEPRECIATION_PERIOD_CLOSED', severity: 'block', message: 'The accounting period of the last month is closed' });
  if (assets.rows.length === 0) checks.push({ code: 'NO_ELIGIBLE_ASSET', severity: 'warning', message: 'No asset is in service for this period' });
  if (skippedNoAccounts > 0) checks.push({ code: 'ASSETS_SKIPPED', severity: 'warning', message: `${skippedNoAccounts} asset(s) skipped for missing accounts` });
  if (from <= to && lines.length === 0 && checks.every((c) => c.severity !== 'block')) {
    checks.push({ code: 'DEPRECIATION_NOTHING_TO_POST', severity: 'warning', message: 'No depreciation is due for this period' });
  }
  const total = lines.reduce((sum, line) => sum + parseAmount(line.amount), 0n);
  const checksBalanced = total >= 0n;
  if (checksBalanced) checks.push({ code: 'ENTRY_BALANCED', severity: 'ok', message: 'Expense and accumulated depreciation totals are equal' });
  const blockers = checks.filter((c) => c.severity === 'block');
  return {
    from, to, lines,
    totals: { amount: formatAmount(total), debit: formatAmount(total), credit: formatAmount(total), difference: '0.0000' },
    checks, blockers,
    warnings: checks.filter((c) => c.severity === 'warning'),
    assets: new Set(lines.map((l) => l.assetId)).size,
  };
}

export async function listBatches(db: Db, companyId: string) {
  const res = await db.query<any>(
    `SELECT b.*, j.code AS journal_code, j.name AS journal_name, e.entry_no,
            u.full_name AS approved_by_name
       FROM fixed_asset_depreciation_batches b
       JOIN journals j ON j.id = b.journal_id
       LEFT JOIN journal_entries e ON e.id = b.entry_id
       LEFT JOIN app_users u ON u.id = b.approved_by
      WHERE b.company_id = $1 ORDER BY b.period_end DESC, b.created_at DESC`, [companyId]);
  const lines = await db.query<any>(
    `SELECT l.*, a.asset_code, a.description FROM fixed_asset_depreciation_lines l
       JOIN fixed_assets a ON a.id = l.asset_id WHERE l.company_id = $1 ORDER BY l.asset_id, l.month_start`, [companyId]);
  return res.rows.map((row: any) => batchView(row, lines.rows.filter((l: any) => l.batch_id === row.id)));
}
function batchView(row: any, lines: any[]) {
  return {
    id: row.id, reference: row.reference, periodStart: row.period_start, periodEnd: row.period_end,
    journal: { id: row.journal_id, code: row.journal_code, name: row.journal_name },
    status: row.status, totalAmount: row.total_amount, checks: row.checks, blockers: row.blockers,
    warnings: row.warnings, approvalNote: row.approval_note, approvedByName: row.approved_by_name,
    approvedAt: row.approved_at, entryId: row.entry_id, entryNo: row.entry_no, postedAt: row.posted_at,
    createdAt: row.created_at,
    lines: lines.map((l: any) => ({
      id: l.id, assetId: l.asset_id, assetCode: l.asset_code, description: l.description,
      monthStart: l.month_start, monthEnd: l.month_end, method: l.method, amount: l.amount,
      openingNbv: l.opening_nbv, closingNbv: l.closing_nbv, daysActive: l.days_active,
      daysInMonth: l.days_in_month, depreciableBase: l.depreciable_base,
    })),
  };
}
export async function getBatch(db: Db, companyId: string, id: string) {
  const res = await db.query<any>(
    `SELECT b.*, j.code AS journal_code, j.name AS journal_name, e.entry_no, u.full_name AS approved_by_name
       FROM fixed_asset_depreciation_batches b
       JOIN journals j ON j.id = b.journal_id
       LEFT JOIN journal_entries e ON e.id = b.entry_id
       LEFT JOIN app_users u ON u.id = b.approved_by
      WHERE b.id = $1 AND b.company_id = $2`, [id, companyId]);
  if (!res.rows[0]) throw notFound('DEPRECIATION_BATCH_NOT_FOUND', 'Depreciation batch not found');
  const lines = await db.query<any>(
    `SELECT l.*, a.asset_code, a.description FROM fixed_asset_depreciation_lines l
       JOIN fixed_assets a ON a.id = l.asset_id WHERE l.batch_id = $1 ORDER BY a.asset_code, l.month_start`, [id]);
  return batchView(res.rows[0], lines.rows);
}

export async function createBatch(db: Db, actor: AssetActor, input: {
  from: string; to: string; journalId: string; reference?: string; assetIds?: string[]; note?: string;
}) {
  const from = checkDate(input.from);
  const to = checkDate(input.to);
  if (from > to) throw badRequest('DEPRECIATION_PERIOD_INVALID', 'The start date must be before the end date');
  assertMonthRange(from, to);
  const journal = await loadJournal(db, actor.companyId, input.journalId);
  if (!journal.is_active) throw badRequest('DEPRECIATION_PERIOD_CLOSED', 'Journal is inactive');
  const preview = await previewDepreciation(db, actor.companyId, from, to, input.assetIds);
  if (preview.blockers.length > 0) {
    throw conflict('DEPRECIATION_DUPLICATE_PERIOD', preview.blockers[0]!.message, { blockers: preview.blockers });
  }
  if (preview.lines.length === 0) throw badRequest('DEPRECIATION_NOTHING_TO_POST', 'No depreciation is due for this period');
  const existing = await db.query('SELECT 1 FROM fixed_asset_depreciation_batches WHERE company_id = $1 AND period_start = $2 AND period_end = $3 AND status <> $4', [actor.companyId, from, to, 'CANCELLED']);
  if (existing.rowCount > 0) throw conflict('DEPRECIATION_BATCH_EXISTS', 'A depreciation batch already exists for this period');
  const cabinetId = await cabinetIdOf(db, actor.companyId);
  const reference = String(input.reference ?? '').trim() || `DEP-${from.slice(0, 7)}`;
  const total = preview.lines.reduce((sum, line) => sum + parseAmount(line.amount), 0n);
  const id = await db.transaction(async (tx) => {
    const res = await tx.query<{ id: string }>(
      `INSERT INTO fixed_asset_depreciation_batches
        (cabinet_id, company_id, reference, period_start, period_end, journal_id, status,
         total_amount, checks, blockers, warnings, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,'DRAFT',$7,$8::jsonb,$9::jsonb,$10::jsonb,$11) RETURNING id`,
      [cabinetId, actor.companyId, reference, from, to, journal.id, formatAmount(total),
        JSON.stringify(preview.checks), JSON.stringify(preview.blockers), JSON.stringify(preview.warnings), actor.userId]);
    const batchId = res.rows[0]!.id;
    for (const line of preview.lines) {
      const category = await getCategoryRow(tx, actor.companyId, line.categoryId);
      await tx.query(
        `INSERT INTO fixed_asset_depreciation_lines
          (company_id, batch_id, asset_id, category_id, month_start, month_end, method,
           opening_nbv, depreciable_base, amount, closing_nbv, days_active, days_in_month,
           expense_account_id, accumulated_account_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
        [actor.companyId, batchId, line.assetId, line.categoryId, line.monthStart, line.monthEnd,
          line.method, line.openingNbv, line.depreciableBase, line.amount, line.closingNbv,
          line.daysActive, line.daysInMonth, category.depreciation_expense_account_id,
          category.accumulated_depreciation_account_id]);
    }
    await audit(tx, actor, 'fixed_asset.depreciation.create', 'depreciation_batch', batchId, { from, to, total: formatAmount(total) });
    return batchId;
  });
  return getBatch(db, actor.companyId, id);
}

export async function approveBatch(db: Db, actor: AssetActor, id: string, input: { confirm: boolean; note: string }) {
  if (!input.confirm || String(input.note ?? '').trim().length < 10) {
    throw badRequest('FIXED_ASSET_PROPOSAL_INVALID', 'A confirmation and a note of at least 10 characters are required');
  }
  await db.transaction(async (tx) => {
    const res = await tx.query<any>('SELECT * FROM fixed_asset_depreciation_batches WHERE id = $1 AND company_id = $2 FOR UPDATE', [id, actor.companyId]);
    const batch = res.rows[0];
    if (!batch) throw notFound('DEPRECIATION_BATCH_NOT_FOUND', 'Depreciation batch not found');
    if (batch.status !== 'DRAFT') throw conflict('DEPRECIATION_BATCH_LOCKED', 'Only a draft batch can be approved');
    await tx.query(`UPDATE fixed_asset_depreciation_batches SET status='APPROVED', approval_note=$2, approved_by=$3, approved_at=now(), updated_at=now() WHERE id=$1`,
      [id, String(input.note).trim(), actor.userId]);
    await audit(tx, actor, 'fixed_asset.depreciation.approve', 'depreciation_batch', id, { note: String(input.note).trim() });
  });
  return getBatch(db, actor.companyId, id);
}

export async function deleteBatch(db: Db, actor: AssetActor, id: string) {
  const res = await db.query<any>('SELECT status FROM fixed_asset_depreciation_batches WHERE id = $1 AND company_id = $2', [id, actor.companyId]);
  if (!res.rows[0]) throw notFound('DEPRECIATION_BATCH_NOT_FOUND', 'Depreciation batch not found');
  if (res.rows[0].status !== 'DRAFT') throw conflict('DEPRECIATION_BATCH_LOCKED', 'Only a draft batch can be deleted');
  await db.transaction(async (tx) => {
    await tx.query('DELETE FROM fixed_asset_depreciation_lines WHERE batch_id = $1', [id]);
    await tx.query('DELETE FROM fixed_asset_depreciation_batches WHERE id = $1', [id]);
    await audit(tx, actor, 'fixed_asset.depreciation.delete', 'depreciation_batch', id);
  });
  return { ok: true };
}

export async function postBatch(db: Db, actor: AssetActor, id: string) {
  const result = await db.transaction(async (tx) => {
    const res = await tx.query<any>(
      `SELECT b.*, j.code AS journal_code FROM fixed_asset_depreciation_batches b
         JOIN journals j ON j.id = b.journal_id
        WHERE b.id = $1 AND b.company_id = $2 FOR UPDATE`, [id, actor.companyId]);
    const batch = res.rows[0];
    if (!batch) throw notFound('DEPRECIATION_BATCH_NOT_FOUND', 'Depreciation batch not found');
    if (batch.status === 'POSTED') throw conflict('DEPRECIATION_ALREADY_POSTED', 'This batch is already posted');
    if (batch.status !== 'APPROVED') throw conflict('DEPRECIATION_BATCH_NOT_APPROVED', 'The batch must be approved first');
    await assertOpenPeriod(tx, actor.companyId, batch.period_end);
    const linesRes = await tx.query<any>(
      `SELECT l.*, a.asset_code FROM fixed_asset_depreciation_lines l
         JOIN fixed_assets a ON a.id = l.asset_id WHERE l.batch_id = $1 ORDER BY l.asset_id, l.month_start`, [id]);
    const stored = new Map<string, bigint>();
    for (const line of linesRes.rows) {
      stored.set(`${line.asset_id}|${line.month_start}`, parseAmount(line.amount));
    }
    const assetIds = [...new Set(linesRes.rows.map((l: any) => l.asset_id))] as string[];
    for (const assetId of assetIds) {
      const { context, accumulatedPosted, impairmentPosted } = await loadContext(tx, actor.companyId, assetId, batch.period_start);
      const recomputed = computeSchedule(context, { from: batch.period_start, to: batch.period_end, accumulatedPosted, impairmentPosted });
      const expected = new Map(recomputed.map((l) => [`${assetId}|${l.monthStart}`, l.amount]));
      for (const [key, value] of stored) {
        if (!key.startsWith(`${assetId}|`)) continue;
        const now = expected.get(key) ?? 0n;
        if (now !== value) throw conflict('DEPRECIATION_BATCH_LOCKED', 'Estimates changed since preparation; regenerate the batch');
      }
    }
    const grouped = new Map<string, { expense: string; accumulated: string; amount: bigint }>();
    for (const line of linesRes.rows) {
      const key = `${line.expense_account_id}|${line.accumulated_account_id}`;
      const entry = grouped.get(key) ?? { expense: line.expense_account_id, accumulated: line.accumulated_account_id, amount: 0n };
      entry.amount += parseAmount(line.amount);
      grouped.set(key, entry);
    }
    const entryLines = [...grouped.values()].flatMap((group) => ([
      { accountId: group.expense, description: `Depreciation ${batch.period_start} → ${batch.period_end}`, debit: formatAmount(group.amount) },
      { accountId: group.accumulated, description: `Accumulated depreciation ${batch.period_start} → ${batch.period_end}`, credit: formatAmount(group.amount) },
    ]));
    const journal = await loadJournal(tx, actor.companyId, batch.journal_id);
    const company = await tx.query<{ functional_currency: string }>('SELECT functional_currency FROM companies WHERE id = $1', [actor.companyId]);
    const loaded = await loadAccounts(tx, actor.companyId, [...new Set(entryLines.map((l) => l.accountId))]);
    const prepared = prepareEntry({
      journalId: journal.id, entryDate: batch.period_end, reference: batch.reference,
      description: `Depreciation ${batch.period_start} → ${batch.period_end}`, currency: company.rows[0]?.functional_currency ?? 'MUR',
      lines: entryLines,
    }, company.rows[0]?.functional_currency ?? 'MUR', loaded.all, loaded.active);
    if (!prepared.balanced) throw conflict('ENTRY_UNBALANCED', 'The depreciation entry is not balanced');
    const entryNo = await nextEntryNo(tx, actor.companyId, journal, batch.period_end);
    const inserted = await tx.query<any>(
      `INSERT INTO journal_entries
        (company_id, journal_id, entry_no, entry_date, reference, description, currency,
         exchange_rate, status, source, created_by, posted_at, posted_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,1,'posted','asset',$8,now(),$8) RETURNING *`,
      [actor.companyId, journal.id, entryNo, batch.period_end, batch.reference,
        `Depreciation ${batch.period_start} → ${batch.period_end}`,
        company.rows[0]?.functional_currency ?? 'MUR', actor.userId]);
    await insertLines(tx, inserted.rows[0].id, actor.companyId, prepared);
    await tx.query(`UPDATE fixed_asset_depreciation_batches SET status='POSTED', entry_id=$2, posted_at=now(), updated_at=now() WHERE id=$1`,
      [id, inserted.rows[0].id]);
    for (const assetId of assetIds) {
      await tx.query(
        `INSERT INTO fixed_asset_events (company_id, asset_id, event_type, event_date, reason, details, created_by)
         VALUES ($1,$2,'depreciation_posted',$3,$4,$5::jsonb,$6)`,
        [actor.companyId, assetId, batch.period_end, batch.reference, JSON.stringify({ batchId: id, entryNo }), actor.userId]);
    }
    await audit(tx, actor, 'fixed_asset.depreciation.post', 'depreciation_batch', id, { entryNo });
    return inserted.rows[0];
  });
  return { batch: await getBatch(db, actor.companyId, id), entry: result };
}

/* ---------------------------------------------------------------- proposals */

export type ProposalKind =
  | 'acquisition' | 'cwip' | 'commissioning' | 'impairment' | 'impairment_reversal'
  | 'disposal' | 'write_off' | 'reclassification';

export interface ProposalInput {
  kind: ProposalKind;
  eventDate: string;
  journalId: string;
  reference: string;
  description?: string;
  counterpartyAccountId?: string;
  proceedsAmount?: string | number;
  proceedsAccountId?: string;
  sellingCosts?: string | number;
  impairmentAmount?: string | number;
  impairmentReason?: string;
  fromAccountId?: string;
  toAccountId?: string;
  reclassAmount?: string | number;
  targetCategoryId?: string;
  inServiceDate?: string;
  method?: 'straight_line' | 'reducing_balance';
  usefulLifeMonths?: number;
  residualValue?: string | number;
  reducingRate?: string | number;
}

interface Check { code: string; severity: 'ok' | 'warning' | 'block'; message: string }

interface ProposalLine { accountId: string; description: string; debit?: string; credit?: string }

function line(accountId: string, description: string, debit: bigint, credit: bigint): ProposalLine | null {
  if (debit === 0n && credit === 0n) return null;
  return {
    accountId, description,
    debit: debit > 0n ? formatAmount(debit) : undefined,
    credit: credit > 0n ? formatAmount(credit) : undefined,
  };
}

export async function buildProposal(db: Db, companyId: string, assetId: string, input: ProposalInput) {
  const asset = await getAssetRow(db, companyId, assetId);
  const category = await getCategoryRow(db, companyId, asset.category_id);
  const eventDate = checkDate(input.eventDate);
  const rate = String(asset.exchange_rate);
  const grossCost = functionalCost(asset.cost, asset.attributable_costs, rate);
  const checks: Check[] = [];
  const lines: ProposalLine[] = [];
  const push = (severity: Check['severity'], code: string, message: string) => checks.push({ code, severity, message });
  let payload: Record<string, unknown> = {};

  if (['disposed', 'written_off'].includes(asset.status) && !['reclassification'].includes(input.kind)) {
    throw badRequest('FIXED_ASSET_ALREADY_DISPOSED', 'Asset is disposed or written off');
  }
  if (asset.status === 'draft' && !['acquisition', 'cwip', 'commissioning'].includes(input.kind)) {
    throw badRequest('FIXED_ASSET_IN_SERVICE_REQUIRED', 'This operation requires an asset in service');
  }
  if (input.kind === 'commissioning' && asset.status !== 'draft') {
    throw conflict('FIXED_ASSET_STATUS_INVALID', 'Only a draft asset can be commissioned');
  }
  if (input.kind !== 'acquisition' && input.kind !== 'cwip' && eventDate < (asset.in_service_date ?? asset.acquisition_date)) {
    throw badRequest('FIXED_ASSET_DATES_INVALID', 'Operation date cannot precede the in-service date');
  }

  const counterparty = input.counterpartyAccountId
    ? await assertAccount(db, companyId, input.counterpartyAccountId, 'Counterparty account')
    : null;
  const proceedsAccount = input.proceedsAccountId
    ? await assertAccount(db, companyId, input.proceedsAccountId, 'Proceeds account')
    : null;
  if (input.fromAccountId) await assertAccount(db, companyId, input.fromAccountId, 'Source account');
  if (input.toAccountId) await assertAccount(db, companyId, input.toAccountId, 'Target account');
  switch (input.kind) {
    case 'acquisition':
    case 'cwip': {
      requireAccounts(category, input.kind === 'cwip'
        ? [['cwip_account_id', 'CWIP account']]
        : [['asset_account_id', 'asset account']]);
      if (!counterparty) throw badRequest('FIXED_ASSET_ACCOUNT_INVALID', 'A counterparty account is required');
      const target = input.kind === 'cwip' ? category.cwip_account_id : category.asset_account_id;
      if (!target) throw badRequest('FIXED_ASSET_ACCOUNTS_NOT_CONFIGURED', 'The category has no wip/asset account configured');
      lines.push(line(target, `${input.kind === 'cwip' ? 'Asset under construction' : 'Acquisition'} — ${asset.description}`, grossCost, 0n)!);
      lines.push(line(counterparty, `Acquisition — ${asset.asset_code}`, 0n, grossCost)!);
      push('ok', 'ACQUISITION_BALANCED', 'Acquisition entry is balanced');
      break;
    }
    case 'commissioning': {
      requireAccounts(category, [['asset_account_id', 'asset account'], ['cwip_account_id', 'CWIP account']]);
      lines.push(line(category.asset_account_id, `Commissioning — ${asset.description}`, grossCost, 0n)!);
      lines.push(line(category.cwip_account_id, `Transfer from CWIP — ${asset.asset_code}`, 0n, grossCost)!);
      if (!input.inServiceDate) throw badRequest('FIXED_ASSET_DATES_INVALID', 'An in-service date is required for commissioning');
      payload = {
        inServiceDate: checkDate(input.inServiceDate), method: input.method ?? null,
        usefulLifeMonths: input.usefulLifeMonths ?? null,
        residualValue: input.residualValue ?? formatAmount(parseAmount(asset.residual_value)),
        reducingRate: input.reducingRate ?? null,
      };
      break;
    }
    case 'impairment':
    case 'impairment_reversal': {
      const accumImpairment = category.accumulated_impairment_account_id;
      const pnl = input.kind === 'impairment' ? category.impairment_loss_account_id : category.impairment_reversal_account_id;
      if (!accumImpairment || !pnl) throw badRequest('FIXED_ASSET_ACCOUNTS_NOT_CONFIGURED', 'Impairment accounts are not configured');
      const value = parseAmount(input.impairmentAmount ?? '0');
      if (value <= 0n) throw badRequest('FIXED_ASSET_IMPAIRMENT_INVALID', 'Impairment amount must be positive');
      const reason = String(input.impairmentReason ?? '').trim();
      if (reason.length < 5) throw badRequest('FIXED_ASSET_IMPAIRMENT_INVALID', 'A documented impairment reason is required');
      const accum = await accumulatedUpTo(db, companyId, assetId, eventDate);
      const nbv = grossCost - accum.depreciation - accum.impairment;
      if (input.kind === 'impairment' && value > nbv) throw badRequest('FIXED_ASSET_IMPAIRMENT_INVALID', 'Impairment cannot exceed the net book value');
      if (input.kind === 'impairment_reversal' && value > accum.impairment) throw badRequest('FIXED_ASSET_IMPAIRMENT_INVALID', 'A reversal cannot exceed accumulated impairment');
      if (input.kind === 'impairment') {
        lines.push(line(pnl, `Impairment — ${asset.asset_code}`, value, 0n)!);
        lines.push(line(accumImpairment, `Accumulated impairment — ${asset.asset_code}`, 0n, value)!);
      } else {
        lines.push(line(accumImpairment, `Impairment reversal — ${asset.asset_code}`, value, 0n)!);
        lines.push(line(pnl, `Impairment reversal — ${asset.asset_code}`, 0n, value)!);
      }
      payload = { amount: formatAmount(value), reason, isReversal: input.kind === 'impairment_reversal' };
      break;
    }
    case 'disposal': {
      requireAccounts(category, [
        ['asset_account_id', 'asset account'], ['accumulated_depreciation_account_id', 'accumulated depreciation'],
        ['disposal_gain_account_id', 'disposal gain'], ['disposal_loss_account_id', 'disposal loss'],
      ]);
      const proceeds = parseAmount(input.proceedsAmount ?? '0');
      if (proceeds < 0n) throw badRequest('FIXED_ASSET_PROCEEDS_INVALID', 'Proceeds cannot be negative');
      if (!proceedsAccount) throw badRequest('FIXED_ASSET_ACCOUNT_INVALID', 'A proceeds account is required');
      const costs = parseAmount(input.sellingCosts ?? '0');
      if (costs < 0n) throw badRequest('FIXED_ASSET_PROCEEDS_INVALID', 'Selling costs cannot be negative');
      if (eventDate < (asset.in_service_date ?? asset.acquisition_date)) throw badRequest('FIXED_ASSET_DISPOSAL_DATE_INVALID', 'Disposal date is invalid');
      const accum = await accumulatedUpTo(db, companyId, assetId, eventDate);
      const nbv = grossCost - accum.depreciation - accum.impairment;
      const gain = proceeds - nbv;
      lines.push(line(proceedsAccount!, `Disposal proceeds — ${asset.asset_code}`, proceeds, 0n)!);
      lines.push(line(category.accumulated_depreciation_account_id, `Accumulated depreciation — ${asset.asset_code}`, accum.depreciation, 0n)!);
      if (category.accumulated_impairment_account_id) {
        lines.push(line(category.accumulated_impairment_account_id, `Accumulated impairment — ${asset.asset_code}`, accum.impairment, 0n)!);
      } else if (accum.impairment > 0n) {
        throw badRequest('FIXED_ASSET_ACCOUNTS_NOT_CONFIGURED', 'An accumulated impairment account is required');
      }
      lines.push(line(category.asset_account_id!, `Cost — ${asset.asset_code}`, 0n, grossCost)!);
      if (gain > 0n) lines.push(line(category.disposal_gain_account_id!, `Gain on disposal — ${asset.asset_code}`, 0n, gain)!);
      if (gain < 0n) lines.push(line(category.disposal_loss_account_id!, `Loss on disposal — ${asset.asset_code}`, -gain, 0n)!);
      if (costs > 0n) {
        lines.push(line(category.disposal_loss_account_id!, `Selling costs — ${asset.asset_code}`, costs, 0n)!);
        lines.push(line(proceedsAccount!, `Selling costs paid — ${asset.asset_code}`, 0n, costs)!);
      }
      payload = {
        proceeds: formatAmount(proceeds), costs: formatAmount(costs), nbv: formatAmount(nbv),
        gain: formatAmount(gain), accumulatedDepreciation: formatAmount(accum.depreciation),
        accumulatedImpairment: formatAmount(accum.impairment), proceedsAccountId: proceedsAccount,
      };
      push('ok', 'DISPOSAL_NBV', `Net book value at disposal: ${formatAmount(nbv)}`);
      break;
    }
    case 'write_off': {
      requireAccounts(category, [['asset_account_id', 'asset account'], ['accumulated_depreciation_account_id', 'accumulated depreciation'], ['disposal_loss_account_id', 'write-off loss']]);
      const accum = await accumulatedUpTo(db, companyId, assetId, eventDate);
      const nbv = grossCost - accum.depreciation - accum.impairment;
      lines.push(line(category.accumulated_depreciation_account_id, `Accumulated depreciation — ${asset.asset_code}`, accum.depreciation, 0n)!);
      if (accum.impairment > 0n) {
        if (!category.accumulated_impairment_account_id) throw badRequest('FIXED_ASSET_ACCOUNTS_NOT_CONFIGURED', 'Accumulated impairment account is required');
        lines.push(line(category.accumulated_impairment_account_id, `Accumulated impairment — ${asset.asset_code}`, accum.impairment, 0n)!);
      }
      if (nbv > 0n) lines.push(line(category.disposal_loss_account_id, `Write-off — ${asset.asset_code}`, nbv, 0n)!);
      lines.push(line(category.asset_account_id!, `Cost — ${asset.asset_code}`, 0n, grossCost)!);
      payload = { nbv: formatAmount(nbv), accumulatedDepreciation: formatAmount(accum.depreciation) };
      break;
    }
    case 'reclassification': {
      if (!input.fromAccountId || !input.toAccountId) throw badRequest('FIXED_ASSET_ACCOUNT_INVALID', 'Both source and target accounts are required');
      const value = parseAmount(input.reclassAmount ?? '0');
      if (value <= 0n) throw badRequest('FIXED_ASSET_PROPOSAL_INVALID', 'Reclassification amount must be positive');
      lines.push(line(input.toAccountId!, `Reclassification in — ${asset.asset_code}`, value, 0n)!);
      lines.push(line(input.fromAccountId!, `Reclassification out — ${asset.asset_code}`, 0n, value)!);
      payload = { amount: formatAmount(value), fromAccountId: input.fromAccountId, toAccountId: input.toAccountId, targetCategoryId: input.targetCategoryId ?? null };
      break;
    }
    default:
      throw badRequest('FIXED_ASSET_PROPOSAL_INVALID', 'Unknown proposal kind');
  }

  const clean = lines.filter((l): l is ProposalLine => !!l);
  if (clean.length < 2) throw badRequest('FIXED_ASSET_PROPOSAL_INVALID', 'At least two lines are required');
  const debit = clean.reduce((sum, l) => sum + parseAmount(l.debit ?? 0), 0n);
  const credit = clean.reduce((sum, l) => sum + parseAmount(l.credit ?? 0), 0n);
  if (debit !== credit) throw badRequest('ENTRY_UNBALANCED', 'The asset entry is not balanced', { debit: formatAmount(debit), credit: formatAmount(credit) });
  push('ok', 'ENTRY_BALANCED', 'Debit and credit are exactly equal');

  return {
    asset, category, eventDate, lines: clean, checks, payload,
    totals: { debit: formatAmount(debit), credit: formatAmount(credit), difference: '0.0000' },
  };
}

export async function createProposal(db: Db, actor: AssetActor, assetId: string, input: ProposalInput) {
  const reference = String(input.reference ?? '').trim();
  if (reference.length < 2) throw badRequest('FIXED_ASSET_PROPOSAL_INVALID', 'A unique reference is required');
  const journal = await loadJournal(db, actor.companyId, input.journalId);
  if (!journal.is_active) throw badRequest('FIXED_ASSET_PROPOSAL_INVALID', 'Journal is inactive');
  const dup = await db.query('SELECT 1 FROM fixed_asset_proposals WHERE company_id = $1 AND reference = $2', [actor.companyId, reference]);
  if (dup.rowCount > 0) throw conflict('FIXED_ASSET_PROPOSAL_REFERENCE_TAKEN', 'This reference is already used');
  const built = await buildProposal(db, actor.companyId, assetId, input);
  const company = await db.query<{ cabinet_id: string; functional_currency: string }>('SELECT cabinet_id, functional_currency FROM companies WHERE id = $1', [actor.companyId]);
  const cabinetId = company.rows[0]!.cabinet_id;
  const currency = company.rows[0]!.functional_currency;
  const id = await db.transaction(async (tx) => {
    const res = await tx.query<{ id: string }>(
      `INSERT INTO fixed_asset_proposals
        (cabinet_id, company_id, asset_id, kind, event_date, reference, description, journal_id,
         currency, exchange_rate, lines, checks, blockers, warnings, payload, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,1,$10::jsonb,$11::jsonb,'[]'::jsonb,'[]'::jsonb,$12::jsonb,$13)
       RETURNING id`,
      [cabinetId, actor.companyId, assetId, input.kind, built.eventDate, reference,
        String(input.description ?? '').trim() || `${input.kind} — ${built.asset.asset_code}`,
        journal.id, currency, JSON.stringify(built.lines), JSON.stringify(built.checks),
        JSON.stringify(built.payload), actor.userId]);
    await audit(tx, actor, 'fixed_asset.proposal.create', 'fixed_asset_proposal', res.rows[0]!.id, { kind: input.kind, reference });
    return res.rows[0]!.id;
  });
  return getProposal(db, actor.companyId, id);
}

function proposalView(row: any, lines?: any[]) {
  const parsed = (row.lines ?? []).map((l: any) => ({
    accountId: l.accountId, description: l.description,
    debit: l.debit ?? '0.0000', credit: l.credit ?? '0.0000',
    account: lines?.find?.((x: any) => x.id === l.accountId) ?? null,
  }));
  return {
    id: row.id, assetId: row.asset_id, assetCode: row.asset_code, assetDescription: row.asset_description,
    kind: row.kind, eventDate: row.event_date, reference: row.reference, description: row.description,
    journal: { id: row.journal_id, code: row.journal_code, name: row.journal_name },
    currency: row.currency, lines: parsed, checks: row.checks, blockers: row.blockers, warnings: row.warnings,
    payload: row.payload, status: row.status, approvalNote: row.approval_note,
    approvedByName: row.approved_by_name, approvedAt: row.approved_at, rejectionReason: row.rejection_reason,
    entryId: row.entry_id, entryNo: row.entry_no, postedAt: row.posted_at, createdAt: row.created_at,
  };
}
const PROPOSAL_SELECT = `
  SELECT p.*, j.code AS journal_code, j.name AS journal_name, a.asset_code, a.description AS asset_description,
         e.entry_no, u.full_name AS approved_by_name
    FROM fixed_asset_proposals p
    JOIN journals j ON j.id = p.journal_id
    JOIN fixed_assets a ON a.id = p.asset_id
    LEFT JOIN journal_entries e ON e.id = p.entry_id
    LEFT JOIN app_users u ON u.id = p.approved_by
`;
export async function listProposals(db: Db, companyId: string, filters: { assetId?: string; kind?: string; status?: string } = {}) {
  const params: unknown[] = [companyId];
  let where = 'WHERE p.company_id = $1';
  if (filters.assetId) { params.push(filters.assetId); where += ` AND p.asset_id = $${params.length}`; }
  if (filters.kind) { params.push(filters.kind); where += ` AND p.kind = $${params.length}`; }
  if (filters.status) { params.push(filters.status); where += ` AND p.status = $${params.length}`; }
  const res = await db.query<any>(`${PROPOSAL_SELECT} ${where} ORDER BY p.created_at DESC`, params);
  return res.rows.map((row: any) => proposalView(row));
}
export async function getProposal(db: Db, companyId: string, id: string) {
  const res = await db.query<any>(`${PROPOSAL_SELECT} WHERE p.id = $1 AND p.company_id = $2`, [id, companyId]);
  if (!res.rows[0]) throw notFound('FIXED_ASSET_PROPOSAL_NOT_FOUND', 'Fixed asset proposal not found');
  const accounts = await db.query<any>('SELECT id, code, name FROM accounts WHERE company_id = $1', [companyId]);
  return proposalView(res.rows[0], accounts.rows);
}

export async function approveProposal(db: Db, actor: AssetActor, id: string, input: { confirm: boolean; note: string }) {
  if (!input.confirm || String(input.note ?? '').trim().length < 10) {
    throw badRequest('FIXED_ASSET_PROPOSAL_INVALID', 'A confirmation and a note of at least 10 characters are required');
  }
  await db.transaction(async (tx) => {
    const res = await tx.query<any>('SELECT * FROM fixed_asset_proposals WHERE id = $1 AND company_id = $2 FOR UPDATE', [id, actor.companyId]);
    const row = res.rows[0];
    if (!row) throw notFound('FIXED_ASSET_PROPOSAL_NOT_FOUND', 'Fixed asset proposal not found');
    if (row.status === 'POSTED') throw conflict('FIXED_ASSET_PROPOSAL_ALREADY_POSTED', 'A posted proposal is immutable');
    if (row.status === 'APPROVED') throw conflict('FIXED_ASSET_PROPOSAL_LOCKED', 'This proposal is already approved');
    if (row.status === 'REJECTED') throw conflict('FIXED_ASSET_PROPOSAL_LOCKED', 'A rejected proposal cannot be approved');
    await tx.query(`UPDATE fixed_asset_proposals SET status='APPROVED', approval_note=$2, approved_by=$3, approved_at=now(), updated_at=now() WHERE id=$1`,
      [id, String(input.note).trim(), actor.userId]);
    await audit(tx, actor, 'fixed_asset.proposal.approve', 'fixed_asset_proposal', id, { note: String(input.note).trim() });
  });
  return getProposal(db, actor.companyId, id);
}

export async function rejectProposal(db: Db, actor: AssetActor, id: string, input: { reason: string }) {
  const reason = String(input.reason ?? '').trim();
  if (reason.length < 10) throw badRequest('FIXED_ASSET_PROPOSAL_INVALID', 'A rejection reason is required');
  await db.transaction(async (tx) => {
    const res = await tx.query<any>('SELECT * FROM fixed_asset_proposals WHERE id = $1 AND company_id = $2 FOR UPDATE', [id, actor.companyId]);
    const row = res.rows[0];
    if (!row) throw notFound('FIXED_ASSET_PROPOSAL_NOT_FOUND', 'Fixed asset proposal not found');
    if (row.status === 'POSTED') throw conflict('FIXED_ASSET_PROPOSAL_ALREADY_POSTED', 'A posted proposal is immutable');
    await tx.query(`UPDATE fixed_asset_proposals SET status='REJECTED', rejection_reason=$2, approved_by=$3, approved_at=now(), updated_at=now() WHERE id=$1`,
      [id, reason, actor.userId]);
    await audit(tx, actor, 'fixed_asset.proposal.reject', 'fixed_asset_proposal', id, { reason });
  });
  return getProposal(db, actor.companyId, id);
}

export async function postProposal(db: Db, actor: AssetActor, id: string) {
  const entry = await db.transaction(async (tx) => {
    const res = await tx.query<any>(
      `SELECT p.*, j.code AS journal_code FROM fixed_asset_proposals p
         JOIN journals j ON j.id = p.journal_id
        WHERE p.id = $1 AND p.company_id = $2 FOR UPDATE`, [id, actor.companyId]);
    const row = res.rows[0];
    if (!row) throw notFound('FIXED_ASSET_PROPOSAL_NOT_FOUND', 'Fixed asset proposal not found');
    if (row.status === 'POSTED') throw conflict('FIXED_ASSET_PROPOSAL_ALREADY_POSTED', 'This proposal is already posted');
    if (row.status !== 'APPROVED') throw conflict('FIXED_ASSET_PROPOSAL_NOT_APPROVED', 'The proposal must be approved first');
    await assertOpenPeriod(tx, actor.companyId, row.event_date);
    const journal = await loadJournal(tx, actor.companyId, row.journal_id);
    const loaded = await loadAccounts(tx, actor.companyId, [...new Set((row.lines as any[]).map((l) => l.accountId))]);
    const prepared = prepareEntry({
      journalId: journal.id, entryDate: row.event_date, reference: row.reference,
      description: row.description, currency: row.currency, exchangeRate: row.exchange_rate,
      lines: (row.lines as any[]).map((l) => ({ accountId: l.accountId, description: l.description, debit: l.debit, credit: l.credit })),
    }, row.currency, loaded.all, loaded.active);
    if (!prepared.balanced) throw conflict('ENTRY_UNBALANCED', 'The proposal is not balanced');
    const entryNo = await nextEntryNo(tx, actor.companyId, journal, row.event_date);
    const inserted = await tx.query<any>(
      `INSERT INTO journal_entries
        (company_id, journal_id, entry_no, entry_date, reference, description, currency,
         exchange_rate, status, source, created_by, posted_at, posted_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'posted','asset',$9,now(),$9) RETURNING *`,
      [actor.companyId, journal.id, entryNo, row.event_date, row.reference, row.description,
        row.currency, row.exchange_rate, actor.userId]);
    await insertLines(tx, inserted.rows[0].id, actor.companyId, prepared);
    await tx.query(`UPDATE fixed_asset_proposals SET status='POSTED', entry_id=$2, posted_at=now(), updated_at=now() WHERE id=$1`,
      [id, inserted.rows[0].id]);

    const locked = await tx.query<any>('SELECT * FROM fixed_assets WHERE id = $1 AND company_id = $2 FOR UPDATE', [row.asset_id, actor.companyId]);
    const asset = locked.rows[0];
    if (!asset) throw notFound('FIXED_ASSET_NOT_FOUND', 'Fixed asset not found');
    if (['disposal', 'write_off'].includes(row.kind) && ['disposed', 'written_off'].includes(asset.status)) {
      throw conflict('FIXED_ASSET_ALREADY_DISPOSED', 'This asset has already been disposed of or written off');
    }
    if (row.kind === 'commissioning' && asset.status !== 'draft') {
      throw conflict('FIXED_ASSET_STATUS_INVALID', 'This asset is no longer a draft');
    }
    const payload = row.payload ?? {};
    switch (row.kind) {
      case 'commissioning': {
        const inServiceDate = String(payload.inServiceDate);
        const method = payload.method as 'straight_line' | 'reducing_balance' | null;
        const life = payload.usefulLifeMonths as number | null;
        const residual = formatAmount(parseAmount(String(payload.residualValue ?? '0')));
        const rate = payload.reducingRate ? String(payload.reducingRate) : null;
        const end = method && life ? addDays(addMonths(inServiceDate, life), -1) : null;
        await tx.query(
          `UPDATE fixed_assets SET status='in_service', in_service_date=$2, depreciation_start_date=$3,
             method=$4, useful_life_months=$5, residual_value=$6, reducing_rate=$7,
             depreciation_end_date=$8, updated_by=$9, updated_at=now() WHERE id=$1`,
          [asset.id, inServiceDate, inServiceDate, method, life, residual, rate, end, actor.userId]);
        if (method && life) {
          await tx.query(
            `INSERT INTO fixed_asset_estimates (company_id, asset_id, effective_from, method, useful_life_months, residual_value, reducing_rate, reason, created_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
             ON CONFLICT (company_id, asset_id, effective_from) DO NOTHING`,
            [actor.companyId, asset.id, inServiceDate, method, life, residual, rate, 'Commissioning', actor.userId]);
        }
        break;
      }
      case 'impairment':
      case 'impairment_reversal': {
        await tx.query(
          `INSERT INTO fixed_asset_impairments (company_id, asset_id, impairment_date, amount, reason, is_reversal, status, entry_id, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,'POSTED',$7,$8)`,
          [actor.companyId, asset.id, row.event_date, String(payload.amount), String(payload.reason),
            Boolean(payload.isReversal), inserted.rows[0].id, actor.userId]);
        break;
      }
      case 'disposal': {
        await tx.query(
          `UPDATE fixed_assets SET status='disposed', disposal_date=$2, disposal_proceeds=$3,
             disposal_costs=$4, updated_by=$5, updated_at=now() WHERE id=$1`,
          [asset.id, row.event_date, String(payload.proceeds ?? '0'), String(payload.costs ?? '0'), actor.userId]);
        break;
      }
      case 'write_off': {
        await tx.query(
          `UPDATE fixed_assets SET status='written_off', disposal_date=$2, updated_by=$3, updated_at=now() WHERE id=$1`,
          [asset.id, row.event_date, actor.userId]);
        break;
      }
      case 'reclassification': {
        if (payload.targetCategoryId) {
          const target = await getCategoryRow(tx, actor.companyId, String(payload.targetCategoryId));
          await tx.query('UPDATE fixed_assets SET category_id=$2, updated_by=$3, updated_at=now() WHERE id=$1',
            [asset.id, target.id, actor.userId]);
        }
        break;
      }
      default:
        break;
    }
    await tx.query(
      `INSERT INTO fixed_asset_events (company_id, asset_id, event_type, event_date, reason, details, created_by)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)`,
      [actor.companyId, asset.id,
        row.kind === 'acquisition' || row.kind === 'cwip' ? 'created' : row.kind === 'commissioning' ? 'activated' : row.kind,
        row.event_date, row.reference, JSON.stringify({ proposalId: id, entryNo }), actor.userId]);
    await audit(tx, actor, 'fixed_asset.proposal.post', 'fixed_asset_proposal', id, { entryNo, kind: row.kind });
    return inserted.rows[0];
  });
  return { proposal: await getProposal(db, actor.companyId, id), entry };
}
