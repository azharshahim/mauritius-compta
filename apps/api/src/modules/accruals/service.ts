/**
 * Mission 22 — accruals, prepayments and deferred income.
 *
 * A schedule allocates an exact total over monthly periods. Each line is posted
 * only after human approval of the schedule and an explicit posting action; a
 * posted line can be reversed, never edited. The four workflows are:
 *   accrued expense   Dr expense        / Cr accrued liability
 *   accrued income    Dr accrued asset  / Cr revenue
 *   prepaid expense   Dr expense        / Cr prepaid asset
 *   deferred income   Dr deferred liability / Cr revenue
 * Commercial customer/supplier advances remain in their own modules; this
 * register is only for period-end accounting allocations.
 */
import type { Db } from '../../db/index.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { formatAmount, parseAmount } from '../../lib/money.js';
import { postEntryTx } from '../../lib/posting.js';
import { writeAudit } from '../../lib/audit.js';
import { assertOpenPeriod } from '../entries/service.js';

export type AccrualKind = 'accrued_expense' | 'accrued_income' | 'prepaid_expense' | 'deferred_income';
export interface AccrualActor { companyId: string; userId: string; ip?: string | null; }

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const amt = (v: unknown) => parseAmount(v ?? 0);
const fmt = (v: bigint) => formatAmount(v);
function date(value: string) {
  if (!ISO.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) throw badRequest('ACCRUAL_DATE_INVALID', 'Invalid date (YYYY-MM-DD)');
  return value;
}
function addMonths(value: string, months: number): string {
  const d = new Date(`${value}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}
const monthEnd = (value: string) => { const d = new Date(`${value}T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + 1); d.setUTCDate(0); return d.toISOString().slice(0, 10); };
const addDays = (value: string, days: number) => { const d = new Date(`${value}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };
async function cabinetIdOf(db: Db, companyId: string) {
  const res = await db.query<any>('SELECT cabinet_id FROM companies WHERE id=$1', [companyId]);
  if (!res.rows[0]) throw notFound('COMPANY_NOT_FOUND', 'Company not found');
  return res.rows[0].cabinet_id as string;
}
async function account(db: Db, companyId: string, id: string, label: string, types: string[]) {
  const res = await db.query<any>('SELECT id, code, name, type, is_active FROM accounts WHERE id=$1 AND company_id=$2', [id, companyId]);
  const row = res.rows[0];
  if (!row) throw badRequest('ACCRUAL_ACCOUNT_INVALID', `${label} does not belong to this company`);
  if (!row.is_active) throw badRequest('ACCRUAL_ACCOUNT_INVALID', `${label} is inactive`);
  if (!types.includes(row.type)) throw badRequest('ACCRUAL_ACCOUNT_INVALID', `${label} has an incompatible account type`);
  return row;
}
async function audit(db: Db, actor: AccrualActor, action: string, id: string, details: Record<string, unknown> = {}) {
  await writeAudit(db, { companyId: actor.companyId, userId: actor.userId, action, entityType: 'accrual_schedule', entityId: id, details, ip: actor.ip ?? null });
}

export interface ScheduleInput {
  reference: string; kind: AccrualKind; description: string; counterparty?: string | null;
  documentRef: string; pnlAccountId: string; balanceAccountId: string; journalId: string;
  totalAmount: string | number; startDate: string; endDate: string; months: number; notes?: string | null;
}

function validateKindAccounts(kind: AccrualKind, pnl: any, balance: any) {
  const expense = kind === 'accrued_expense' || kind === 'prepaid_expense';
  if (expense && pnl.type !== 'expense') throw badRequest('ACCRUAL_ACCOUNT_INVALID', 'A profit-or-loss expense account is required');
  if (!expense && pnl.type !== 'revenue') throw badRequest('ACCRUAL_ACCOUNT_INVALID', 'A revenue account is required');
  const asset = kind === 'accrued_income' || kind === 'prepaid_expense';
  if (asset && balance.type !== 'asset') throw badRequest('ACCRUAL_ACCOUNT_INVALID', 'A balance-sheet asset account is required');
  if (!asset && balance.type !== 'liability') throw badRequest('ACCRUAL_ACCOUNT_INVALID', 'A balance-sheet liability account is required');
}

function scheduleView(row: any, lines: any[]) {
  return {
    id: row.id, reference: row.reference, kind: row.kind, description: row.description,
    counterparty: row.counterparty, documentRef: row.document_ref,
    pnlAccountId: row.pnl_account_id, balanceAccountId: row.balance_account_id,
    journal: { id: row.journal_id, code: row.journal_code, name: row.journal_name },
    totalAmount: fmt(amt(row.total_amount)), startDate: row.start_date, endDate: row.end_date,
    months: row.months, status: row.status, notes: row.notes,
    createdByName: row.created_by_name ?? null, approvedByName: row.approved_by_name ?? null,
    approvedAt: row.approved_at, approvalNote: row.approval_note,
    createdAt: row.created_at, updatedAt: row.updated_at,
    lines: lines.map((l) => ({ id: l.id, lineNo: l.line_no, periodStart: l.period_start,
      periodEnd: l.period_end, amount: fmt(amt(l.amount)), status: l.status,
      entryId: l.entry_id, entryNo: l.entry_no ?? null,
      reversalEntryId: l.reversal_entry_id, reversalEntryNo: l.reversal_entry_no ?? null,
      postedAt: l.posted_at, reversedAt: l.reversed_at })),
    totals: {
      posted: fmt(lines.filter((l) => ['POSTED', 'REVERSED'].includes(l.status)).reduce((s, l) => s + amt(l.amount), 0n)),
      pending: fmt(lines.filter((l) => l.status === 'PENDING').reduce((s, l) => s + amt(l.amount), 0n)),
      reversed: fmt(lines.filter((l) => l.status === 'REVERSED').reduce((s, l) => s + amt(l.amount), 0n)),
    },
  };
}

async function scheduleRow(db: Db, companyId: string, id: string) {
  const res = await db.query<any>(
    `SELECT s.*, j.code AS journal_code, j.name AS journal_name,
            cu.full_name AS created_by_name, au.full_name AS approved_by_name
       FROM accrual_schedules s JOIN journals j ON j.id=s.journal_id
       LEFT JOIN app_users cu ON cu.id=s.created_by LEFT JOIN app_users au ON au.id=s.approved_by
      WHERE s.id=$1 AND s.company_id=$2`, [id, companyId]);
  if (!res.rows[0]) throw notFound('ACCRUAL_SCHEDULE_NOT_FOUND', 'Accrual schedule not found');
  return res.rows[0];
}
async function scheduleLines(db: Db, companyId: string, id: string) {
  const res = await db.query<any>(
    `SELECT l.*, e.entry_no, re.entry_no AS reversal_entry_no
       FROM accrual_schedule_lines l
       LEFT JOIN journal_entries e ON e.id=l.entry_id
       LEFT JOIN journal_entries re ON re.id=l.reversal_entry_id
      WHERE l.company_id=$1 AND l.schedule_id=$2 ORDER BY l.line_no`, [companyId, id]);
  return res.rows;
}
export async function getSchedule(db: Db, companyId: string, id: string) {
  return scheduleView(await scheduleRow(db, companyId, id), await scheduleLines(db, companyId, id));
}
export async function listSchedules(db: Db, companyId: string, filter: { from?: string; to?: string; kind?: string; status?: string } = {}) {
  const params: unknown[] = [companyId];
  let where = 's.company_id=$1';
  if (filter.kind) { params.push(filter.kind); where += ` AND s.kind=$${params.length}`; }
  if (filter.status) { params.push(filter.status); where += ` AND s.status=$${params.length}`; }
  if (filter.from) { params.push(filter.from); where += ` AND s.end_date >= $${params.length}`; }
  if (filter.to) { params.push(filter.to); where += ` AND s.start_date <= $${params.length}`; }
  const res = await db.query<any>(`SELECT s.id FROM accrual_schedules s WHERE ${where} ORDER BY s.start_date DESC, s.reference`, params);
  const rows = [];
  for (const r of res.rows) rows.push(await getSchedule(db, companyId, r.id));
  return rows;
}

export async function createSchedule(db: Db, actor: AccrualActor, input: ScheduleInput) {
  date(input.startDate); date(input.endDate);
  if (input.endDate < input.startDate) throw badRequest('ACCRUAL_DATES_INVALID', 'The end date must be after the start date');
  if (!Number.isInteger(input.months) || input.months < 1 || input.months > 120) throw badRequest('ACCRUAL_MONTHS_INVALID', 'Months must be an integer between 1 and 120');
  if (!input.reference?.trim() || !input.description?.trim() || !input.documentRef?.trim()) {
    throw badRequest('ACCRUAL_EVIDENCE_REQUIRED', 'Reference, description and supporting document are required');
  }
  const total = amt(input.totalAmount);
  if (total <= 0n) throw badRequest('ACCRUAL_AMOUNT_INVALID', 'The total amount must be positive');
  const pnl = await account(db, actor.companyId, input.pnlAccountId, 'Profit-or-loss account', ['expense', 'revenue']);
  const balance = await account(db, actor.companyId, input.balanceAccountId, 'Balance-sheet account', ['asset', 'liability']);
  validateKindAccounts(input.kind, pnl, balance);
  const journal = await db.query<any>('SELECT id FROM journals WHERE id=$1 AND company_id=$2 AND is_active', [input.journalId, actor.companyId]);
  if (!journal.rows[0]) throw badRequest('JOURNAL_NOT_FOUND', 'Journal is unknown or inactive');
  const base = total / BigInt(input.months);
  if (base <= 0n) throw badRequest('ACCRUAL_AMOUNT_TOO_SMALL', 'The total is too small to allocate over the requested months');
  const cabinet = await cabinetIdOf(db, actor.companyId);
  return db.transaction(async (tx) => {
    const created = await tx.query<any>(
      `INSERT INTO accrual_schedules (cabinet_id, company_id, reference, kind, description, counterparty, document_ref,
         pnl_account_id, balance_account_id, journal_id, total_amount, start_date, end_date, months, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING id`,
      [cabinet, actor.companyId, input.reference.trim(), input.kind, input.description.trim(), input.counterparty ?? null,
        input.documentRef.trim(), pnl.id, balance.id, journal.rows[0].id, fmt(total), input.startDate, input.endDate,
        input.months, input.notes ?? null, actor.userId]);
    const id = created.rows[0].id;
    for (let i = 0; i < input.months; i += 1) {
      const lineStart = addMonths(input.startDate, i);
      let lineEnd = addDays(addMonths(lineStart, 1), -1);
      if (lineEnd > input.endDate) lineEnd = input.endDate;
      const lineAmount = i === input.months - 1 ? total - base * BigInt(input.months - 1) : base;
      await tx.query(
        `INSERT INTO accrual_schedule_lines (company_id, schedule_id, line_no, period_start, period_end, amount)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [actor.companyId, id, i + 1, lineStart, lineEnd, fmt(lineAmount)]);
    }
    await audit(tx, actor, 'accrual.schedule.create', id, { reference: input.reference, total: fmt(total), months: input.months });
    return getSchedule(tx, actor.companyId, id);
  });
}

export async function updateSchedule(db: Db, actor: AccrualActor, id: string, input: Partial<ScheduleInput>) {
  const row = await scheduleRow(db, actor.companyId, id);
  if (row.status !== 'DRAFT') throw conflict('ACCRUAL_SCHEDULE_DECIDED', 'Only a draft schedule can be modified');
  const total = input.totalAmount === undefined ? amt(row.total_amount) : amt(input.totalAmount);
  const months = input.months ?? row.months;
  if (total <= 0n || !Number.isInteger(months) || months < 1) throw badRequest('ACCRUAL_AMOUNT_INVALID', 'Amount and months are invalid');
  const pnl = input.pnlAccountId ? await account(db, actor.companyId, input.pnlAccountId, 'Profit-or-loss account', ['expense', 'revenue']) : null;
  const balance = input.balanceAccountId ? await account(db, actor.companyId, input.balanceAccountId, 'Balance-sheet account', ['asset', 'liability']) : null;
  const kind = (input.kind ?? row.kind) as AccrualKind;
  if (pnl || balance) {
    const pnlRow = pnl ?? await account(db, actor.companyId, row.pnl_account_id, 'Profit-or-loss account', ['expense', 'revenue']);
    const balanceRow = balance ?? await account(db, actor.companyId, row.balance_account_id, 'Balance-sheet account', ['asset', 'liability']);
    validateKindAccounts(kind, pnlRow, balanceRow);
  }
  const startDate = input.startDate ?? row.start_date;
  const endDate = input.endDate ?? row.end_date;
  date(startDate); date(endDate);
  if (endDate < startDate) throw badRequest('ACCRUAL_DATES_INVALID', 'The end date must be after the start date');
  const base = total / BigInt(months);
  if (base <= 0n) throw badRequest('ACCRUAL_AMOUNT_TOO_SMALL', 'The total is too small to allocate');
  return db.transaction(async (tx) => {
    await tx.query(
      `UPDATE accrual_schedules SET reference=$3, kind=$4, description=$5, counterparty=$6, document_ref=$7,
         pnl_account_id=$8, balance_account_id=$9, journal_id=$10, total_amount=$11, start_date=$12, end_date=$13,
         months=$14, notes=$15, updated_at=now() WHERE id=$1 AND company_id=$2`,
      [id, actor.companyId, input.reference?.trim() ?? row.reference, kind,
        input.description?.trim() ?? row.description,
        input.counterparty === undefined ? row.counterparty : input.counterparty,
        input.documentRef?.trim() ?? row.document_ref,
        pnl?.id ?? row.pnl_account_id, balance?.id ?? row.balance_account_id,
        input.journalId ?? row.journal_id, fmt(total), startDate, endDate, months,
        input.notes === undefined ? row.notes : input.notes]);
    await tx.query('DELETE FROM accrual_schedule_lines WHERE company_id=$1 AND schedule_id=$2', [actor.companyId, id]);
    for (let i = 0; i < months; i += 1) {
      const lineStart = addMonths(startDate, i);
      let lineEnd = addDays(addMonths(lineStart, 1), -1);
      if (lineEnd > endDate) lineEnd = endDate;
      const lineAmount = i === months - 1 ? total - base * BigInt(months - 1) : base;
      await tx.query(
        `INSERT INTO accrual_schedule_lines (company_id, schedule_id, line_no, period_start, period_end, amount)
         VALUES ($1,$2,$3,$4,$5,$6)`, [actor.companyId, id, i + 1, lineStart, lineEnd, fmt(lineAmount)]);
    }
    await audit(tx, actor, 'accrual.schedule.update', id, {});
    return getSchedule(tx, actor.companyId, id);
  });
}

export async function approveSchedule(db: Db, actor: AccrualActor, id: string, input: { confirm: boolean; note: string }) {
  if (input.confirm !== true || String(input.note ?? '').trim().length < 10) {
    throw badRequest('ACCRUAL_DECISION_REQUIRED', 'A confirmation and a note of at least 10 characters are required');
  }
  const row = await scheduleRow(db, actor.companyId, id);
  if (row.status !== 'DRAFT') throw conflict('ACCRUAL_SCHEDULE_DECIDED', 'This schedule has already been decided');
  await db.query(`UPDATE accrual_schedules SET status='APPROVED', approved_by=$3, approved_at=now(), approval_note=$4, updated_at=now()
    WHERE id=$1 AND company_id=$2`, [id, actor.companyId, actor.userId, String(input.note).trim()]);
  await audit(db, actor, 'accrual.schedule.approve', id, { note: String(input.note).trim() });
  return getSchedule(db, actor.companyId, id);
}
export async function cancelSchedule(db: Db, actor: AccrualActor, id: string) {
  const row = await scheduleRow(db, actor.companyId, id);
  if (!['DRAFT', 'APPROVED'].includes(row.status)) throw conflict('ACCRUAL_SCHEDULE_DECIDED', 'A posted schedule cannot be cancelled');
  await db.query(`UPDATE accrual_schedules SET status='CANCELLED', updated_at=now() WHERE id=$1 AND company_id=$2`, [id, actor.companyId]);
  await audit(db, actor, 'accrual.schedule.cancel', id, {});
  return getSchedule(db, actor.companyId, id);
}

function entryLines(row: any, amount: bigint) {
  const desc = row.description;
  switch (row.kind) {
    case 'accrued_expense': return [{ accountId: row.pnl_account_id, description: desc, debit: fmt(amount) }, { accountId: row.balance_account_id, description: desc, credit: fmt(amount) }];
    case 'prepaid_expense': return [{ accountId: row.pnl_account_id, description: desc, debit: fmt(amount) }, { accountId: row.balance_account_id, description: desc, credit: fmt(amount) }];
    case 'accrued_income': return [{ accountId: row.balance_account_id, description: desc, debit: fmt(amount) }, { accountId: row.pnl_account_id, description: desc, credit: fmt(amount) }];
    case 'deferred_income': return [{ accountId: row.balance_account_id, description: desc, debit: fmt(amount) }, { accountId: row.pnl_account_id, description: desc, credit: fmt(amount) }];
    default: throw badRequest('ACCRUAL_KIND_INVALID', 'Unknown accrual kind');
  }
}

export async function postLine(db: Db, actor: AccrualActor, id: string, lineId: string) {
  return db.transaction(async (tx) => {
    const row = await scheduleRow(tx, actor.companyId, id);
    if (!['APPROVED', 'ACTIVE'].includes(row.status)) throw conflict('ACCRUAL_SCHEDULE_NOT_APPROVED', 'The schedule must be approved before posting');
    const line = await tx.query<any>('SELECT * FROM accrual_schedule_lines WHERE id=$1 AND schedule_id=$2 AND company_id=$3 FOR UPDATE', [lineId, id, actor.companyId]);
    if (!line.rows[0]) throw notFound('ACCRUAL_LINE_NOT_FOUND', 'Accrual line not found');
    if (line.rows[0].status !== 'PENDING') throw conflict('ACCRUAL_LINE_DECIDED', 'This line has already been posted or reversed');
    await assertOpenPeriod(tx, actor.companyId, line.rows[0].period_end);
    const amount = amt(line.rows[0].amount);
    const posted = await postEntryTx(tx, {
      companyId: actor.companyId, userId: actor.userId, journalId: row.journal_id,
      entryDate: line.rows[0].period_end, reference: row.reference,
      description: `Accrual ${row.reference} ${line.rows[0].period_start} → ${line.rows[0].period_end}`,
      lines: entryLines(row, amount), source: 'accrual',
    });
    await tx.query(`UPDATE accrual_schedule_lines SET status='POSTED', entry_id=$3, posted_at=now() WHERE id=$1 AND company_id=$2`,
      [lineId, actor.companyId, posted.entry.id]);
    const remaining = await tx.query<any>(`SELECT count(*)::int AS count FROM accrual_schedule_lines
      WHERE schedule_id=$1 AND company_id=$2 AND status='PENDING'`, [id, actor.companyId]);
    await tx.query(`UPDATE accrual_schedules SET status=$3, updated_at=now() WHERE id=$1 AND company_id=$2`,
      [id, actor.companyId, Number(remaining.rows[0]?.count ?? 0) === 0 ? 'COMPLETED' : 'ACTIVE']);
    await audit(tx, actor, 'accrual.line.post', id, { lineId, entryNo: posted.entry.entry_no });
    return { schedule: await getSchedule(tx, actor.companyId, id), entry: posted.entry };
  });
}

export async function postDueLines(db: Db, actor: AccrualActor, id: string, asOf: string) {
  date(asOf);
  const row = await scheduleRow(db, actor.companyId, id);
  if (!['APPROVED', 'ACTIVE'].includes(row.status)) throw conflict('ACCRUAL_SCHEDULE_NOT_APPROVED', 'The schedule must be approved before posting');
  const lines = await db.query<any>(`SELECT id FROM accrual_schedule_lines WHERE company_id=$1 AND schedule_id=$2
    AND status='PENDING' AND period_end <= $3 ORDER BY line_no`, [actor.companyId, id, asOf]);
  const entries = [];
  for (const line of lines.rows) entries.push((await postLine(db, actor, id, line.id)).entry);
  return { schedule: await getSchedule(db, actor.companyId, id), entries };
}

export async function reverseLine(db: Db, actor: AccrualActor, id: string, lineId: string, input: { reversalDate: string; reason: string }) {
  date(input.reversalDate);
  if (!String(input.reason ?? '').trim()) throw badRequest('ACCRUAL_REVERSAL_REASON_REQUIRED', 'A reversal reason is required');
  return db.transaction(async (tx) => {
    const row = await scheduleRow(tx, actor.companyId, id);
    const line = await tx.query<any>('SELECT * FROM accrual_schedule_lines WHERE id=$1 AND schedule_id=$2 AND company_id=$3 FOR UPDATE', [lineId, id, actor.companyId]);
    if (!line.rows[0]) throw notFound('ACCRUAL_LINE_NOT_FOUND', 'Accrual line not found');
    if (line.rows[0].status !== 'POSTED') throw conflict('ACCRUAL_LINE_NOT_POSTED', 'Only a posted line can be reversed');
    await assertOpenPeriod(tx, actor.companyId, input.reversalDate);
    const amount = amt(line.rows[0].amount);
    const original = entryLines(row, amount).map((l) => ({ accountId: l.accountId, description: `Reversal — ${input.reason}`, debit: l.credit, credit: l.debit }));
    const posted = await postEntryTx(tx, {
      companyId: actor.companyId, userId: actor.userId, journalId: row.journal_id,
      entryDate: input.reversalDate, reference: `${row.reference}-REV`,
      description: `Reversal of accrual ${row.reference} (${line.rows[0].period_start} → ${line.rows[0].period_end})`,
      lines: original, source: 'accrual',
    });
    await tx.query(`UPDATE accrual_schedule_lines SET status='REVERSED', reversal_entry_id=$3, reversed_at=now()
      WHERE id=$1 AND company_id=$2`, [lineId, actor.companyId, posted.entry.id]);
    await audit(tx, actor, 'accrual.line.reverse', id, { lineId, entryNo: posted.entry.entry_no, reason: input.reason });
    return { schedule: await getSchedule(tx, actor.companyId, id), entry: posted.entry };
  });
}

export async function accrualReport(db: Db, companyId: string, asOf: string) {
  date(asOf);
  const rows = await db.query<any>(
    `SELECT l.amount::text, l.status, s.kind, s.balance_account_id, a.code, a.name
       FROM accrual_schedule_lines l JOIN accrual_schedules s ON s.id=l.schedule_id
       JOIN accounts a ON a.id=s.balance_account_id
      WHERE l.company_id=$1 AND l.period_end <= $2`, [companyId, asOf]);
  const byKind: Record<string, { posted: bigint; pending: bigint; reversed: bigint }> = {};
  for (const r of rows.rows) {
    const bucket = byKind[r.kind] ?? { posted: 0n, pending: 0n, reversed: 0n };
    const value = amt(r.amount);
    if (r.status === 'REVERSED') bucket.reversed += value;
    else if (r.status === 'POSTED') bucket.posted += value;
    else bucket.pending += value;
    byKind[r.kind] = bucket;
  }
  const accountsRes = await db.query<any>(
    `SELECT DISTINCT a.id, a.code, a.name FROM accrual_schedules s JOIN accounts a ON a.id=s.balance_account_id
      WHERE s.company_id=$1 ORDER BY a.code`, [companyId]);
  const reconcile = [];
  for (const a of accountsRes.rows) {
    // Scope the ledger side to entries generated by this register: a prepaid
    // asset or deferred liability may also carry an opening payment/receipt
    // recorded outside the register, which must not be silently absorbed.
    const gl = await db.query<any>(`SELECT COALESCE(SUM(l.debit-l.credit),0)::text AS balance
      FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id
      WHERE l.company_id=$1 AND l.account_id=$2 AND e.status='posted' AND e.source='accrual' AND e.entry_date <= $3`, [companyId, a.id, asOf]);
    const scheduleBalance = await db.query<any>(
      `SELECT COALESCE(SUM(CASE WHEN s.kind IN ('accrued_income','deferred_income') THEN l.amount ELSE -l.amount END),0)::text AS balance
        FROM accrual_schedule_lines l
        JOIN accrual_schedules s ON s.id=l.schedule_id
        JOIN journal_entries e ON e.id=l.entry_id
        LEFT JOIN journal_entries re ON re.id=l.reversal_entry_id
       WHERE l.company_id=$1 AND s.balance_account_id=$2
         AND e.entry_date <= $3
         AND (re.entry_date IS NULL OR re.entry_date > $3)`, [companyId, a.id, asOf]);
    const expected = amt(scheduleBalance.rows[0]?.balance);
    const ledger = amt(gl.rows[0]?.balance);
    reconcile.push({ account: { code: a.code, name: a.name }, scheduleBalance: fmt(expected),
      ledgerBalance: fmt(ledger), difference: fmt(expected - ledger), balanced: expected === ledger });
  }
  return { asOf,
    byKind: Object.fromEntries(Object.entries(byKind).map(([k, v]) => [k, { posted: fmt(v.posted), pending: fmt(v.pending), reversed: fmt(v.reversed) }])),
    reconciliation: reconcile, balanced: reconcile.every((r) => r.balanced),
    note: 'Schedule balances are compared with posted general-ledger entries generated by this register (source accrual). Amounts posted outside the register remain visible but are not absorbed or adjusted automatically.' };
}
export async function accrualCheck(db: Db, companyId: string, periodStart: string, periodEnd: string) {
  const pending = await db.query<any>(`SELECT count(*)::int AS count FROM accrual_schedule_lines l
    JOIN accrual_schedules s ON s.id=l.schedule_id
    WHERE l.company_id=$1 AND l.status='PENDING' AND s.status IN ('DRAFT','APPROVED')
      AND l.period_end >= $2 AND l.period_start <= $3`, [companyId, periodStart, periodEnd]);
  const unapproved = await db.query<any>(`SELECT count(*)::int AS count FROM accrual_schedules
    WHERE company_id=$1 AND status='DRAFT' AND start_date <= $2 AND end_date >= $3`, [companyId, periodEnd, periodStart]);
  const missingDocs = await db.query<any>(`SELECT count(*)::int AS count FROM accrual_schedules
    WHERE company_id=$1 AND (document_ref IS NULL OR btrim(document_ref)='')`, [companyId]);
  const report = await accrualReport(db, companyId, periodEnd);
  return { pendingLines: Number(pending.rows[0]?.count ?? 0), draftSchedules: Number(unapproved.rows[0]?.count ?? 0),
    missingDocuments: Number(missingDocs.rows[0]?.count ?? 0), report };
}
