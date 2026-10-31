/**
 * Mission 21 — prior-period adjustments.
 *
 * An error discovered after a period was closed never reopens that period and
 * never edits the original entry. The correction is a new, balanced, approved
 * entry posted in an open period; the treatment and the accounts are chosen
 * explicitly by the user. No Mauritian or IFRS rule is selected automatically.
 */
import type { Db } from '../../db/index.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { formatAmount, parseAmount } from '../../lib/money.js';
import { assertOpenPeriod, insertLines, loadAccounts, loadJournal, nextEntryNo, prepareEntry } from '../entries/service.js';
import { computeTrialBalance } from '../reports/service.js';
import { writeAudit } from '../../lib/audit.js';
import type { Check, FinancialYearActor } from './types.js';

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const TREATMENTS = ['retained_earnings', 'current_year_result', 'custom'] as const;
type Treatment = (typeof TREATMENTS)[number];
function amount(value: unknown): bigint {
  try { return parseAmount(String(value ?? '0')); } catch { return 0n; }
}
function date(value: string, field: string): string {
  if (!ISO.test(value)) throw badRequest('VALIDATION_ERROR', `${field} must be YYYY-MM-DD`);
  return value;
}
async function audit(db: Db, actor: FinancialYearActor, action: string, entityId: string, details: Record<string, unknown> = {}) {
  await writeAudit(db, { companyId: actor.companyId, userId: actor.userId, entityType: 'prior_year_adjustment', entityId, action, details, ip: actor.ip ?? null });
}

export interface AdjustmentLineInput {
  accountId: string; description?: string | null; debit?: string | number | null; credit?: string | number | null;
}
function normaliseLines(raw: AdjustmentLineInput[]) {
  if (!Array.isArray(raw) || raw.length < 2) throw badRequest('ADJUSTMENT_LINES_REQUIRED', 'At least two adjustment lines are required');
  if (raw.length > 50) throw badRequest('VALIDATION_ERROR', 'Too many adjustment lines (max 50)');
  const seen = new Set<string>();
  return raw.map((line, index) => {
    if (!line || typeof line.accountId !== 'string') throw badRequest('VALIDATION_ERROR', `Line ${index + 1}: account is required`);
    if (seen.has(line.accountId)) throw badRequest('VALIDATION_ERROR', `Line ${index + 1}: an account may appear only once`);
    seen.add(line.accountId);
    const debit = amount(line.debit);
    const credit = amount(line.credit);
    if (debit < 0n || credit < 0n) throw badRequest('VALIDATION_ERROR', `Line ${index + 1}: amounts must be positive`);
    if ((debit > 0n) === (credit > 0n)) throw badRequest('VALIDATION_ERROR', `Line ${index + 1}: exactly one of debit or credit must be positive`);
    return { accountId: line.accountId, description: line.description ? String(line.description).trim().slice(0, 500) : null, debit, credit };
  });
}

export interface AdjustmentInput {
  sourcePeriodId: string;
  adjustmentDate: string;
  journalId: string;
  treatment: Treatment;
  originalEntryId?: string | null;
  originalReference: string;
  reason: string;
  documentRef: string;
  restatesComparatives?: boolean;
  comparativeNote?: string | null;
  lines: AdjustmentLineInput[];
}

async function validateAdjustment(db: Db, companyIdValue: string, input: AdjustmentInput) {
  const source = await db.query<any>('SELECT * FROM accounting_periods WHERE id = $1 AND company_id = $2', [input.sourcePeriodId, companyIdValue]);
  const sourcePeriod = source.rows[0];
  if (!sourcePeriod) throw notFound('PERIOD_NOT_FOUND', 'Source period not found');
  if (sourcePeriod.status !== 'closed') throw conflict('ADJUSTMENT_SOURCE_NOT_CLOSED', 'The source period must be closed before a prior-period adjustment');
  const adjustmentDate = date(input.adjustmentDate, 'adjustmentDate');
  if (adjustmentDate <= sourcePeriod.end_date) throw conflict('ADJUSTMENT_DATE_IN_CLOSED_PERIOD', 'The adjustment date must be after the source period end');
  if (!TREATMENTS.includes(input.treatment)) throw badRequest('ADJUSTMENT_TREATMENT_REQUIRED', 'A documented treatment is required');
  const reason = String(input.reason ?? '').trim();
  const documentRef = String(input.documentRef ?? '').trim();
  const originalReference = String(input.originalReference ?? '').trim();
  if (reason.length < 10) throw badRequest('ADJUSTMENT_REASON_REQUIRED', 'A reason of at least 10 characters is required');
  if (documentRef.length < 2) throw badRequest('ADJUSTMENT_DOCUMENT_REQUIRED', 'A supporting document reference is required');
  if (originalReference.length < 1) throw badRequest('ADJUSTMENT_ORIGINAL_REQUIRED', 'The original transaction reference is required');
  const restates = Boolean(input.restatesComparatives);
  const comparativeNote = String(input.comparativeNote ?? '').trim();
  if (restates && comparativeNote.length < 10) throw badRequest('ADJUSTMENT_COMPARATIVE_NOTE_REQUIRED', 'A comparative restatement note of at least 10 characters is required');
  const journal = await loadJournal(db, companyIdValue, input.journalId);
  if (!journal.is_active) throw badRequest('JOURNAL_INACTIVE', 'The journal is inactive');
  if (input.originalEntryId) {
    const original = await db.query<any>('SELECT id, entry_date, entry_no, status FROM journal_entries WHERE id = $1 AND company_id = $2', [input.originalEntryId, companyIdValue]);
    const row = original.rows[0];
    if (!row) throw notFound('ENTRY_NOT_FOUND', 'The original entry was not found in this company');
    if (row.status !== 'posted') throw badRequest('ADJUSTMENT_ORIGINAL_NOT_POSTED', 'The original entry must be posted');
    if (row.entry_date < sourcePeriod.start_date || row.entry_date > sourcePeriod.end_date) {
      throw badRequest('ADJUSTMENT_ORIGINAL_OUTSIDE_PERIOD', 'The original entry does not belong to the source period');
    }
  }
  const lines = normaliseLines(input.lines);
  const accounts = await db.query<any>('SELECT id, code, name, type, is_active FROM accounts WHERE company_id = $1 AND id = ANY($2::uuid[])', [companyIdValue, lines.map((l) => l.accountId)]);
  if (accounts.rows.length !== lines.length) throw badRequest('ACCOUNT_NOT_FOUND', 'An adjustment account does not belong to this company');
  const byId = new Map<string, any>(accounts.rows.map((r: any) => [r.id, r]));
  let debitTotal = 0n;
  let creditTotal = 0n;
  const blocks: Check[] = [];
  for (const line of lines) {
    const account = byId.get(line.accountId)!;
    if (!account.is_active) blocks.push({ code: 'ADJUSTMENT_ACCOUNT_INACTIVE', severity: 'block', messageEn: `Account ${account.code} is inactive.`, messageFr: `Le compte ${account.code} est inactif.` });
    debitTotal += line.debit;
    creditTotal += line.credit;
  }
  if (debitTotal !== creditTotal) blocks.push({ code: 'ADJUSTMENT_UNBALANCED', severity: 'block', messageEn: 'Adjustment debit and credit totals must be equal.', messageFr: 'Les totaux débit et crédit de l’ajustement doivent être égaux.' });
  if (input.treatment === 'retained_earnings' && !lines.some((l) => byId.get(l.accountId)!.type === 'equity')) {
    blocks.push({ code: 'ADJUSTMENT_EQUITY_LINE_REQUIRED', severity: 'block', messageEn: 'A retained-earnings treatment requires at least one equity account line.', messageFr: 'Le traitement par report à nouveau exige au moins une ligne de capitaux propres.' });
  }
  if (input.treatment === 'current_year_result' && !lines.some((l) => ['revenue', 'expense'].includes(byId.get(l.accountId)!.type))) {
    blocks.push({ code: 'ADJUSTMENT_RESULT_LINE_REQUIRED', severity: 'block', messageEn: 'A current-year-result treatment requires at least one profit or loss account line.', messageFr: 'Le traitement en résultat de l’exercice exige au moins une ligne de charge ou de produit.' });
  }
  const fingerprint = JSON.stringify(lines.map((l) => [l.accountId, l.debit.toString(), l.credit.toString()]));
  return { sourcePeriod, adjustmentDate, reason, documentRef, originalReference, comparativeNote, restates, journal, lines, byId, debitTotal, creditTotal, blocks, fingerprint };
}

const adjustmentSelect = `
  SELECT a.*, p.name AS source_period_name, p.start_date AS source_start, p.end_date AS source_end,
         j.code AS journal_code, j.name AS journal_name, e.entry_no,
         oe.entry_no AS original_entry_no,
         cu.full_name AS created_by_name, au.full_name AS approved_by_name, ru.full_name AS rejected_by_name
    FROM prior_year_adjustments a
    JOIN accounting_periods p ON p.id = a.source_period_id
    JOIN journals j ON j.id = a.journal_id
    LEFT JOIN journal_entries e ON e.id = a.entry_id
    LEFT JOIN journal_entries oe ON oe.id = a.original_entry_id
    LEFT JOIN app_users cu ON cu.id = a.created_by
    LEFT JOIN app_users au ON au.id = a.approved_by
    LEFT JOIN app_users ru ON ru.id = a.rejected_by
`;
async function view(db: Db, companyIdValue: string, id: string) {
  const res = await db.query<any>(`${adjustmentSelect} WHERE a.company_id = $1 AND a.id = $2`, [companyIdValue, id]);
  if (!res.rows[0]) throw notFound('ADJUSTMENT_NOT_FOUND', 'Prior-year adjustment not found');
  const r = res.rows[0];
  const lines = await db.query<any>(`SELECT l.*, ac.code, ac.name, ac.type FROM prior_year_adjustment_lines l JOIN accounts ac ON ac.id = l.account_id WHERE l.adjustment_id = $1 AND l.company_id = $2 ORDER BY l.line_no`, [id, companyIdValue]);
  const totalDebit = lines.rows.reduce((s: bigint, l: any) => s + amount(l.debit), 0n);
  const totalCredit = lines.rows.reduce((s: bigint, l: any) => s + amount(l.credit), 0n);
  return {
    id: r.id, adjustmentNo: r.adjustment_no, sourcePeriodId: r.source_period_id,
    sourcePeriod: { id: r.source_period_id, name: r.source_period_name, startDate: r.source_start, endDate: r.source_end },
    adjustmentDate: r.adjustment_date, journal: { id: r.journal_id, code: r.journal_code, name: r.journal_name },
    treatment: r.treatment, originalEntryId: r.original_entry_id, originalEntryNo: r.original_entry_no,
    originalReference: r.original_reference, reason: r.reason, documentRef: r.document_ref,
    restatesComparatives: r.restates_comparatives, comparativeNote: r.comparative_note,
    status: r.status, entryId: r.entry_id, entryNo: r.entry_no,
    createdByName: r.created_by_name, approvedByName: r.approved_by_name, approvedAt: r.approved_at,
    approvalNote: r.approval_note, rejectedByName: r.rejected_by_name, rejectedAt: r.rejected_at,
    rejectionReason: r.rejection_reason, postedAt: r.posted_at, createdAt: r.created_at, updatedAt: r.updated_at,
    totalDebit: formatAmount(totalDebit), totalCredit: formatAmount(totalCredit), balanced: totalDebit === totalCredit,
    lines: lines.rows.map((l: any) => ({ id: l.id, lineNo: l.line_no, accountId: l.account_id,
      account: { code: l.code, name: l.name, type: l.type }, description: l.description,
      debit: formatAmount(amount(l.debit)), credit: formatAmount(amount(l.credit)) })),
  };
}
export async function listAdjustments(db: Db, companyIdValue: string) {
  const res = await db.query<any>(`${adjustmentSelect} WHERE a.company_id = $1 ORDER BY a.adjustment_date DESC, a.created_at DESC`, [companyIdValue]);
  return res.rows.map((r: any) => ({ id: r.id, adjustmentNo: r.adjustment_no, sourcePeriodId: r.source_period_id,
    sourcePeriodName: r.source_period_name, adjustmentDate: r.adjustment_date, treatment: r.treatment,
    originalReference: r.original_reference, reason: r.reason, documentRef: r.document_ref,
    status: r.status, entryNo: r.entry_no, restatesComparatives: r.restates_comparatives,
    createdAt: r.created_at, postedAt: r.posted_at }));
}
export async function getAdjustment(db: Db, companyIdValue: string, id: string) { return view(db, companyIdValue, id); }

async function nextAdjustmentNo(tx: Db, companyIdValue: string, year: string): Promise<string> {
  const res = await tx.query<any>(`SELECT adjustment_no FROM prior_year_adjustments WHERE company_id = $1 AND adjustment_no LIKE $2 ORDER BY adjustment_no DESC LIMIT 1`, [companyIdValue, `PYA-${year}-%`]);
  const last = res.rows[0] ? Number(String(res.rows[0].adjustment_no).split('-')[2]) : 0;
  return `PYA-${year}-${String(last + 1).padStart(4, '0')}`;
}

export async function createAdjustment(db: Db, actor: FinancialYearActor, input: AdjustmentInput) {
  const v = await validateAdjustment(db, actor.companyId, input);
  if (v.blocks.length > 0) throw badRequest('ADJUSTMENT_BLOCKED', 'The prior-year adjustment has blocking controls', { blocks: v.blocks });
  const company = await db.query<any>('SELECT cabinet_id FROM companies WHERE id = $1', [actor.companyId]);
  let id = '';
  await db.transaction(async (tx) => {
    const adjustmentNo = await nextAdjustmentNo(tx, actor.companyId, input.adjustmentDate.slice(0, 4));
    const res = await tx.query<any>(
      `INSERT INTO prior_year_adjustments
        (cabinet_id, company_id, adjustment_no, source_period_id, adjustment_date, journal_id, treatment,
         original_entry_id, original_reference, reason, document_ref, restates_comparatives, comparative_note, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
      [company.rows[0]!.cabinet_id, actor.companyId, adjustmentNo, input.sourcePeriodId, v.adjustmentDate,
        v.journal.id, input.treatment, input.originalEntryId ?? null, v.originalReference, v.reason,
        v.documentRef, v.restates, v.restates ? v.comparativeNote : null, actor.userId],
    );
    id = res.rows[0].id;
    for (let i = 0; i < v.lines.length; i += 1) {
      const line = v.lines[i]!;
      await tx.query(`INSERT INTO prior_year_adjustment_lines (company_id, adjustment_id, line_no, account_id, description, debit, credit) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [actor.companyId, id, i + 1, line.accountId, line.description, formatAmount(line.debit), formatAmount(line.credit)]);
    }
    await audit(tx, actor, 'adjustment.create', id, { adjustmentNo, sourcePeriodId: input.sourcePeriodId, treatment: input.treatment, totalDebit: formatAmount(v.debitTotal) });
  });
  return view(db, actor.companyId, id);
}

export async function updateAdjustment(db: Db, actor: FinancialYearActor, id: string, input: AdjustmentInput) {
  const existing = await db.query<any>('SELECT * FROM prior_year_adjustments WHERE company_id = $1 AND id = $2', [actor.companyId, id]);
  if (!existing.rows[0]) throw notFound('ADJUSTMENT_NOT_FOUND', 'Prior-year adjustment not found');
  if (existing.rows[0].status !== 'PROPOSED') throw conflict('ADJUSTMENT_PROPOSED_ONLY', 'Only a proposed adjustment can be changed');
  const v = await validateAdjustment(db, actor.companyId, input);
  if (v.blocks.length > 0) throw badRequest('ADJUSTMENT_BLOCKED', 'The prior-year adjustment has blocking controls', { blocks: v.blocks });
  await db.transaction(async (tx) => {
    await tx.query(`UPDATE prior_year_adjustments SET source_period_id=$2, adjustment_date=$3, journal_id=$4, treatment=$5,
       original_entry_id=$6, original_reference=$7, reason=$8, document_ref=$9, restates_comparatives=$10,
       comparative_note=$11, updated_at=now() WHERE id=$1`,
      [id, input.sourcePeriodId, v.adjustmentDate, v.journal.id, input.treatment, input.originalEntryId ?? null,
        v.originalReference, v.reason, v.documentRef, v.restates, v.restates ? v.comparativeNote : null]);
    await tx.query('DELETE FROM prior_year_adjustment_lines WHERE adjustment_id = $1 AND company_id = $2', [id, actor.companyId]);
    for (let i = 0; i < v.lines.length; i += 1) {
      const line = v.lines[i]!;
      await tx.query(`INSERT INTO prior_year_adjustment_lines (company_id, adjustment_id, line_no, account_id, description, debit, credit) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [actor.companyId, id, i + 1, line.accountId, line.description, formatAmount(line.debit), formatAmount(line.credit)]);
    }
    await audit(tx, actor, 'adjustment.update', id, { treatment: input.treatment, totalDebit: formatAmount(v.debitTotal) });
  });
  return view(db, actor.companyId, id);
}

export async function deleteAdjustment(db: Db, actor: FinancialYearActor, id: string) {
  const res = await db.query<any>('SELECT status FROM prior_year_adjustments WHERE company_id = $1 AND id = $2', [actor.companyId, id]);
  if (!res.rows[0]) throw notFound('ADJUSTMENT_NOT_FOUND', 'Prior-year adjustment not found');
  if (res.rows[0].status !== 'PROPOSED') throw conflict('ADJUSTMENT_PROPOSED_ONLY', 'Only a proposed adjustment can be deleted');
  await db.transaction(async (tx) => {
    await tx.query('DELETE FROM prior_year_adjustments WHERE id = $1 AND company_id = $2', [id, actor.companyId]);
    await audit(tx, actor, 'adjustment.delete', id);
  });
  return { ok: true };
}

export async function approveAdjustment(db: Db, actor: FinancialYearActor, id: string, input: { confirm: boolean; note: string }) {
  if (!input.confirm || String(input.note ?? '').trim().length < 10) throw badRequest('FINANCIAL_YEAR_DECISION_REQUIRED', 'A confirmation and a note of at least 10 characters are required');
  await db.transaction(async (tx) => {
    const res = await tx.query<any>('SELECT * FROM prior_year_adjustments WHERE company_id = $1 AND id = $2 FOR UPDATE', [actor.companyId, id]);
    const row = res.rows[0];
    if (!row) throw notFound('ADJUSTMENT_NOT_FOUND', 'Prior-year adjustment not found');
    if (row.status === 'POSTED') throw conflict('ADJUSTMENT_POSTED_IMMUTABLE', 'A posted adjustment is immutable');
    if (row.status === 'APPROVED') throw conflict('CONFLICT', 'This adjustment is already approved');
    if (row.status !== 'PROPOSED') throw conflict('CONFLICT', 'Only a proposed adjustment can be approved');
    await tx.query(`UPDATE prior_year_adjustments SET status='APPROVED', approved_by=$2, approved_at=now(), approval_note=$3, updated_at=now() WHERE id=$1`, [id, actor.userId, String(input.note).trim()]);
    await audit(tx, actor, 'adjustment.approve', id, { note: String(input.note).trim() });
  });
  return view(db, actor.companyId, id);
}

export async function rejectAdjustment(db: Db, actor: FinancialYearActor, id: string, input: { reason: string }) {
  if (String(input.reason ?? '').trim().length < 10) throw badRequest('FINANCIAL_YEAR_DECISION_REQUIRED', 'A rejection reason of at least 10 characters is required');
  await db.transaction(async (tx) => {
    const res = await tx.query<any>('SELECT * FROM prior_year_adjustments WHERE company_id = $1 AND id = $2 FOR UPDATE', [actor.companyId, id]);
    const row = res.rows[0];
    if (!row) throw notFound('ADJUSTMENT_NOT_FOUND', 'Prior-year adjustment not found');
    if (row.status === 'POSTED') throw conflict('ADJUSTMENT_POSTED_IMMUTABLE', 'A posted adjustment is immutable');
    await tx.query(`UPDATE prior_year_adjustments SET status='REJECTED', rejected_by=$2, rejected_at=now(), rejection_reason=$3, updated_at=now() WHERE id=$1`, [id, actor.userId, String(input.reason).trim()]);
    await audit(tx, actor, 'adjustment.reject', id, { reason: String(input.reason).trim() });
  });
  return view(db, actor.companyId, id);
}

export async function postAdjustment(db: Db, actor: FinancialYearActor, id: string) {
  const entry = await db.transaction(async (tx) => {
    const res = await tx.query<any>('SELECT * FROM prior_year_adjustments WHERE company_id = $1 AND id = $2 FOR UPDATE', [actor.companyId, id]);
    const row = res.rows[0];
    if (!row) throw notFound('ADJUSTMENT_NOT_FOUND', 'Prior-year adjustment not found');
    if (row.status === 'POSTED') throw conflict('ADJUSTMENT_POSTED_IMMUTABLE', 'This adjustment is already posted');
    if (row.status !== 'APPROVED') throw conflict('ADJUSTMENT_NOT_APPROVED', 'The adjustment must be approved first');
    const source = await tx.query<any>('SELECT status, end_date FROM accounting_periods WHERE id = $1 AND company_id = $2', [row.source_period_id, actor.companyId]);
    if (!source.rows[0] || source.rows[0].status !== 'closed') throw conflict('ADJUSTMENT_SOURCE_NOT_CLOSED', 'The source period is no longer closed');
    await assertOpenPeriod(tx, actor.companyId, row.adjustment_date);
    const lines = await tx.query<any>('SELECT * FROM prior_year_adjustment_lines WHERE adjustment_id = $1 AND company_id = $2 ORDER BY line_no', [id, actor.companyId]);
    if (!lines.rows.length) throw conflict('ADJUSTMENT_LINES_REQUIRED', 'The adjustment has no lines');
    const debitTotal = lines.rows.reduce((s: bigint, l: any) => s + amount(l.debit), 0n);
    const creditTotal = lines.rows.reduce((s: bigint, l: any) => s + amount(l.credit), 0n);
    if (debitTotal !== creditTotal || debitTotal === 0n) throw conflict('ENTRY_UNBALANCED', 'The adjustment is not exactly balanced');
    const journal = await loadJournal(tx, actor.companyId, row.journal_id);
    if (!journal.is_active) throw badRequest('JOURNAL_INACTIVE', 'The journal is inactive');
    const loaded = await loadAccounts(tx, actor.companyId, [...new Set<string>(lines.rows.map((l: any) => l.account_id))]);
    const prepared = prepareEntry({
      journalId: journal.id, entryDate: row.adjustment_date, reference: row.adjustment_no,
      description: `Prior-year adjustment ${row.adjustment_no} — ${row.original_reference}`,
      currency: 'MUR',
      lines: lines.rows.map((l: any) => ({ accountId: l.account_id, description: l.description ?? 'Prior-year adjustment', debit: amount(l.debit) > 0n ? String(l.debit) : null, credit: amount(l.credit) > 0n ? String(l.credit) : null })),
    }, 'MUR', loaded.all, loaded.active);
    if (!prepared.balanced) throw conflict('ENTRY_UNBALANCED', 'The prior-year adjustment is not balanced');
    const entryNo = await nextEntryNo(tx, actor.companyId, journal, row.adjustment_date);
    const inserted = await tx.query<any>(
      `INSERT INTO journal_entries
        (company_id, journal_id, entry_no, entry_date, reference, description, currency,
         exchange_rate, status, source, created_by, posted_at, posted_by)
       VALUES ($1,$2,$3,$4,$5,$6,'MUR',1,'posted','prior_year_adjustment',$7,now(),$7) RETURNING *`,
      [actor.companyId, journal.id, entryNo, row.adjustment_date, row.adjustment_no,
        `Prior-year adjustment ${row.adjustment_no} — ${row.original_reference}`, actor.userId],
    );
    await insertLines(tx, inserted.rows[0].id, actor.companyId, prepared);
    await tx.query(`UPDATE prior_year_adjustments SET status='POSTED', entry_id=$2, posted_at=now(), updated_at=now() WHERE id=$1`, [id, inserted.rows[0].id]);
    await audit(tx, actor, 'adjustment.post', id, { entryNo, totalDebit: formatAmount(debitTotal), sourcePeriodId: row.source_period_id });
    return inserted.rows[0];
  });
  return { adjustment: await view(db, actor.companyId, id), entry };
}

/** Read-only comparative proposal. It never modifies an archived or closed period. */
export async function restatementPreview(db: Db, companyIdValue: string, id: string) {
  const adjustment = await view(db, companyIdValue, id);
  const company = await db.query<any>('SELECT functional_currency FROM companies WHERE id = $1', [companyIdValue]);
  const source = await db.query<any>('SELECT * FROM accounting_periods WHERE id = $1 AND company_id = $2', [adjustment.sourcePeriodId, companyIdValue]);
  const p = source.rows[0];
  if (!p) throw notFound('PERIOD_NOT_FOUND', 'Source period not found');
  const trial = await computeTrialBalance(db, companyIdValue, company.rows[0]!.functional_currency, { from: p.start_date, to: p.end_date });
  const lineByAccount = new Map(adjustment.lines.map((l: any) => [l.accountId, l]));
  const rows = trial.rows.map((r: any) => {
    const line: any = lineByAccount.get(r.accountId);
    const debit = line ? amount(line.debit) : 0n;
    const credit = line ? amount(line.credit) : 0n;
    return { accountId: r.accountId, code: r.code, name: r.name, type: r.type,
      originalDebit: r.closingDebit, originalCredit: r.closingCredit,
      adjustmentDebit: formatAmount(debit), adjustmentCredit: formatAmount(credit),
      restatedDebit: formatAmount(amount(r.closingDebit) + debit),
      restatedCredit: formatAmount(amount(r.closingCredit) + credit) };
  });
  // The closing entry zeroes the profit and loss accounts. To show the original
  // result of the source year, compute it before that closing entry.
  const pnl = await db.query<any>(
    `SELECT a.type, COALESCE(SUM(l.debit),0)::text AS debit, COALESCE(SUM(l.credit),0)::text AS credit
       FROM accounts a JOIN journal_lines l ON l.account_id = a.id JOIN journal_entries e ON e.id = l.entry_id
      WHERE a.company_id = $1 AND e.company_id = $1 AND e.status = 'posted'
        AND e.entry_date BETWEEN $2 AND $3 AND a.type IN ('revenue','expense') AND e.source <> 'closing'
      GROUP BY a.type`, [companyIdValue, p.start_date, p.end_date]);
  let originalResult = 0n;
  for (const row of pnl.rows) {
    originalResult += row.type === 'revenue'
      ? amount(row.credit) - amount(row.debit)
      : -(amount(row.debit) - amount(row.credit));
  }
  const adjustmentResult = adjustment.lines.reduce((s: bigint, l: any) => {
    if (l.account.type === 'revenue') return s + amount(l.credit) - amount(l.debit);
    if (l.account.type === 'expense') return s - (amount(l.debit) - amount(l.credit));
    return s;
  }, 0n);
  return {
    adjustmentId: adjustment.id, adjustmentNo: adjustment.adjustmentNo,
    sourcePeriod: { id: p.id, name: p.name, startDate: p.start_date, endDate: p.end_date, status: p.status },
    originalResult: formatAmount(originalResult), adjustmentResult: formatAmount(adjustmentResult),
    restatedResult: formatAmount(originalResult + adjustmentResult),
    rows,
    noteEn: 'Proposal only: the closed period and any sealed archive are unchanged. Comparative restatement is a presentation decision to validate.',
    noteFr: 'Proposition seulement : la période clôturée et toute archive scellée restent inchangées. La retraitement comparatif est une décision de présentation à valider.',
  };
}
