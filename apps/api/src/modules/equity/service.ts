import { createHash } from 'node:crypto';
import type { Db } from '../../db/index.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { decimalPlaces, formatAmount, parseAmount } from '../../lib/money.js';
import { assertOpenPeriod, insertLines, loadAccounts, loadJournal, nextEntryNo, prepareEntry } from '../entries/service.js';
import { computeTrialBalance } from '../reports/service.js';
import { writeAudit } from '../../lib/audit.js';

export interface EquityActor { companyId: string; userId: string; ip?: string | null; }
const CATEGORIES = ['capital', 'contribution', 'reserve', 'retained_earnings', 'dividend', 'adjustment'] as const;
const DIRECTIONS = ['increase', 'decrease'] as const;
const NATURES = ['retained_earnings', 'reserves', 'dividends', 'other'] as const;

export interface MovementInput {
  movementDate: string; category: (typeof CATEGORIES)[number]; direction: (typeof DIRECTIONS)[number];
  amount: string | number; equityAccountId: string; counterpartAccountId: string; journalId: string;
  description: string; documentRef: string;
}

interface Check { code: string; severity: 'ok' | 'warning' | 'block'; scope: 'closing' | 'posting' | 'statement'; messageEn: string; messageFr: string; }
const ok = (code: string, en: string, fr: string): Check => ({ code, severity: 'ok', scope: 'closing', messageEn: en, messageFr: fr });
const warn = (code: string, en: string, fr: string): Check => ({ code, severity: 'warning', scope: 'closing', messageEn: en, messageFr: fr });
const block = (code: string, en: string, fr: string): Check => ({ code, severity: 'block', scope: 'closing', messageEn: en, messageFr: fr });

function dateValue(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw badRequest('VALIDATION_ERROR', 'Expected date YYYY-MM-DD');
  return value;
}
function assertAmount(raw: string | number): bigint {
  if (decimalPlaces(raw) > 4) throw badRequest('EQUITY_AMOUNT_INVALID', 'Amounts are limited to 4 decimals');
  let value: bigint;
  try { value = parseAmount(raw); } catch { throw badRequest('EQUITY_AMOUNT_INVALID', 'Invalid amount'); }
  if (value <= 0n) throw badRequest('EQUITY_AMOUNT_INVALID', 'Amount must be positive');
  return value;
}
async function accountRow(db: Db, companyId: string, id: string) {
  const res = await db.query<any>('SELECT id, code, name, type, is_active FROM accounts WHERE id = $1 AND company_id = $2', [id, companyId]);
  const row = res.rows[0];
  if (!row) throw notFound('ACCOUNT_NOT_FOUND', 'Account not found in this company');
  return row;
}
async function journalRow(db: Db, companyId: string, id: string) {
  const res = await db.query<any>('SELECT * FROM journals WHERE id = $1 AND company_id = $2', [id, companyId]);
  const row = res.rows[0];
  if (!row) throw notFound('JOURNAL_NOT_FOUND', 'Journal not found');
  return row;
}
async function nextMovementNo(tx: Db, companyId: string, date: string): Promise<string> {
  const year = Number(date.slice(0, 4));
  const res = await tx.query<{ last_no: number }>(
    `INSERT INTO equity_sequences (company_id, year, last_no) VALUES ($1, $2, 1)
     ON CONFLICT (company_id, year) DO UPDATE SET last_no = equity_sequences.last_no + 1
     RETURNING last_no`, [companyId, year],
  );
  return `EQ-${year}-${String(res.rows[0]!.last_no).padStart(4, '0')}`;
}
async function audit(db: Db, actor: EquityActor, action: string, entityType: string, entityId: string, details?: Record<string, unknown>) {
  await writeAudit(db, { companyId: actor.companyId, userId: actor.userId, action, entityType, entityId, details: details ?? {}, ip: actor.ip ?? null });
}

const movementSelect = `
  SELECT m.*, a.code AS equity_account_code, a.name AS equity_account_name,
         c.code AS counterpart_account_code, c.name AS counterpart_account_name,
         j.code AS journal_code, j.name AS journal_name,
         e.entry_no, u.full_name AS approved_by_name, cu.full_name AS created_by_name
    FROM equity_movements m
    JOIN accounts a ON a.id = m.equity_account_id
    JOIN accounts c ON c.id = m.counterpart_account_id
    JOIN journals j ON j.id = m.journal_id
    LEFT JOIN journal_entries e ON e.id = m.entry_id
    LEFT JOIN app_users u ON u.id = m.approved_by
    LEFT JOIN app_users cu ON cu.id = m.created_by
`;
function movementView(row: any) {
  return {
    id: row.id, movementNo: row.movement_no, movementDate: row.movement_date,
    category: row.category, direction: row.direction, amount: row.amount,
    equityAccount: { id: row.equity_account_id, code: row.equity_account_code, name: row.equity_account_name },
    counterpartAccount: { id: row.counterpart_account_id, code: row.counterpart_account_code, name: row.counterpart_account_name },
    journal: { id: row.journal_id, code: row.journal_code, name: row.journal_name },
    description: row.description, documentRef: row.document_ref, status: row.status,
    approvedByName: row.approved_by_name, approvedAt: row.approved_at, approvalNote: row.approval_note,
    entryId: row.entry_id, entryNo: row.entry_no, createdByName: row.created_by_name,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}
export async function listEquityMovements(db: Db, companyId: string) {
  const res = await db.query<any>(`${movementSelect} WHERE m.company_id = $1 ORDER BY m.movement_date DESC, m.movement_no DESC`, [companyId]);
  return res.rows.map(movementView);
}
export async function getEquityMovement(db: Db, companyId: string, id: string) {
  const res = await db.query<any>(`${movementSelect} WHERE m.company_id = $1 AND m.id = $2`, [companyId, id]);
  if (!res.rows[0]) throw notFound('EQUITY_MOVEMENT_NOT_FOUND', 'Equity movement not found');
  return movementView(res.rows[0]);
}

async function validateMovement(db: Db, companyId: string, input: MovementInput) {
  if (!CATEGORIES.includes(input.category)) throw badRequest('VALIDATION_ERROR', 'Invalid equity category');
  if (!DIRECTIONS.includes(input.direction)) throw badRequest('VALIDATION_ERROR', 'Invalid equity direction');
  const amount = assertAmount(input.amount);
  const movementDate = dateValue(input.movementDate);
  const description = String(input.description ?? '').trim();
  const documentRef = String(input.documentRef ?? '').trim();
  if (description.length < 3) throw badRequest('VALIDATION_ERROR', 'Description is required');
  if (documentRef.length < 2) throw badRequest('VALIDATION_ERROR', 'A supporting document reference is required');
  const equity = await accountRow(db, companyId, input.equityAccountId);
  if (equity.type !== 'equity') throw badRequest('EQUITY_ACCOUNT_NOT_EQUITY', 'The equity account must be an equity account');
  if (!equity.is_active) throw badRequest('EQUITY_ACCOUNT_INACTIVE', 'The equity account is inactive');
  const counterpart = await accountRow(db, companyId, input.counterpartAccountId);
  if (!counterpart.is_active) throw badRequest('EQUITY_ACCOUNT_INACTIVE', 'The counterpart account is inactive');
  if (equity.id === counterpart.id) throw badRequest('VALIDATION_ERROR', 'Equity and counterpart accounts must differ');
  const journal = await journalRow(db, companyId, input.journalId);
  if (!journal.is_active) throw badRequest('EQUITY_JOURNAL_INACTIVE', 'The journal is inactive');
  return { amount, movementDate, description, documentRef, equity, counterpart, journal };
}

export async function createEquityMovement(db: Db, actor: EquityActor, input: MovementInput) {
  const v = await validateMovement(db, actor.companyId, input);
  const company = await db.query<{ cabinet_id: string }>('SELECT cabinet_id FROM companies WHERE id = $1', [actor.companyId]);
  const cabinetId = company.rows[0]?.cabinet_id;
  if (!cabinetId) throw notFound('COMPANY_NOT_FOUND', 'Company not found');
  const created = await db.transaction(async (tx) => {
    const movementNo = await nextMovementNo(tx, actor.companyId, v.movementDate);
    const res = await tx.query<any>(
      `INSERT INTO equity_movements
        (cabinet_id, company_id, movement_no, movement_date, category, direction, amount,
         equity_account_id, counterpart_account_id, journal_id, description, document_ref, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
      [cabinetId, actor.companyId, movementNo, v.movementDate, input.category, input.direction,
        formatAmount(v.amount), v.equity.id, v.counterpart.id, v.journal.id, v.description, v.documentRef, actor.userId],
    );
    await audit(tx, actor, 'equity.movement.create', 'equity_movement', res.rows[0].id, { movementNo, category: input.category, amount: formatAmount(v.amount), documentRef: v.documentRef });
    return res.rows[0].id as string;
  });
  return getEquityMovement(db, actor.companyId, created);
}

export async function updateEquityMovement(db: Db, actor: EquityActor, id: string, input: MovementInput) {
  const existing = await db.query<any>('SELECT * FROM equity_movements WHERE id = $1 AND company_id = $2', [id, actor.companyId]);
  const row = existing.rows[0];
  if (!row) throw notFound('EQUITY_MOVEMENT_NOT_FOUND', 'Equity movement not found');
  if (row.status !== 'DRAFT') throw conflict('EQUITY_MOVEMENT_DRAFT_ONLY', 'Only a draft movement can be changed');
  const v = await validateMovement(db, actor.companyId, input);
  await db.transaction(async (tx) => {
    await tx.query(
      `UPDATE equity_movements SET movement_date=$2, category=$3, direction=$4, amount=$5,
         equity_account_id=$6, counterpart_account_id=$7, journal_id=$8, description=$9,
         document_ref=$10, updated_at=now() WHERE id=$1`,
      [id, v.movementDate, input.category, input.direction, formatAmount(v.amount), v.equity.id,
        v.counterpart.id, v.journal.id, v.description, v.documentRef],
    );
    await audit(tx, actor, 'equity.movement.update', 'equity_movement', id, { documentRef: v.documentRef });
  });
  return getEquityMovement(db, actor.companyId, id);
}

export async function deleteEquityMovement(db: Db, actor: EquityActor, id: string) {
  const res = await db.query<any>('SELECT status FROM equity_movements WHERE id = $1 AND company_id = $2', [id, actor.companyId]);
  if (!res.rows[0]) throw notFound('EQUITY_MOVEMENT_NOT_FOUND', 'Equity movement not found');
  if (res.rows[0].status !== 'DRAFT') throw conflict('EQUITY_MOVEMENT_DRAFT_ONLY', 'Only a draft movement can be deleted');
  await db.transaction(async (tx) => {
    await tx.query('DELETE FROM equity_movements WHERE id = $1 AND company_id = $2', [id, actor.companyId]);
    await audit(tx, actor, 'equity.movement.delete', 'equity_movement', id);
  });
  return { ok: true };
}

export async function approveEquityMovement(db: Db, actor: EquityActor, id: string, input: { confirm: boolean; note: string }) {
  if (!input.confirm || String(input.note ?? '').trim().length < 10) throw badRequest('EQUITY_DECISION_REQUIRED', 'A confirmation and a note of at least 10 characters are required');
  await db.transaction(async (tx) => {
    const res = await tx.query<any>('SELECT * FROM equity_movements WHERE id = $1 AND company_id = $2 FOR UPDATE', [id, actor.companyId]);
    const row = res.rows[0];
    if (!row) throw notFound('EQUITY_MOVEMENT_NOT_FOUND', 'Equity movement not found');
    if (row.status === 'POSTED') throw conflict('EQUITY_MOVEMENT_POSTED_IMMUTABLE', 'A posted movement cannot be approved');
    if (row.status === 'APPROVED') throw conflict('CONFLICT', 'This movement is already approved');
    if (row.status !== 'DRAFT') throw conflict('CONFLICT', 'Only a draft movement can be approved');
    await tx.query(`UPDATE equity_movements SET status='APPROVED', approved_by=$2, approved_at=now(), approval_note=$3, updated_at=now() WHERE id=$1`, [id, actor.userId, String(input.note).trim()]);
    await audit(tx, actor, 'equity.movement.approve', 'equity_movement', id, { note: String(input.note).trim() });
  });
  return getEquityMovement(db, actor.companyId, id);
}

export async function postEquityMovement(db: Db, actor: EquityActor, id: string) {
  const entry = await db.transaction(async (tx) => {
    const res = await tx.query<any>('SELECT * FROM equity_movements WHERE id = $1 AND company_id = $2 FOR UPDATE', [id, actor.companyId]);
    const movement = res.rows[0];
    if (!movement) throw notFound('EQUITY_MOVEMENT_NOT_FOUND', 'Equity movement not found');
    if (movement.status === 'POSTED') throw conflict('EQUITY_MOVEMENT_POSTED_IMMUTABLE', 'This movement is already posted');
    if (movement.status !== 'APPROVED') throw conflict('EQUITY_MOVEMENT_NOT_APPROVED', 'The movement must be approved first');
    const equity = await accountRow(tx, actor.companyId, movement.equity_account_id);
    const counterpart = await accountRow(tx, actor.companyId, movement.counterpart_account_id);
    if (!equity.is_active || !counterpart.is_active) throw badRequest('EQUITY_ACCOUNT_INACTIVE', 'An account is inactive');
    const journal = await journalRow(tx, actor.companyId, movement.journal_id);
    if (!journal.is_active) throw badRequest('EQUITY_JOURNAL_INACTIVE', 'The journal is inactive');
    await assertOpenPeriod(tx, actor.companyId, movement.movement_date);
    const lines = movement.direction === 'increase'
      ? [{ accountId: counterpart.id, description: movement.description, debit: String(movement.amount) },
         { accountId: equity.id, description: movement.description, credit: String(movement.amount) }]
      : [{ accountId: equity.id, description: movement.description, debit: String(movement.amount) },
         { accountId: counterpart.id, description: movement.description, credit: String(movement.amount) }];
    const loaded = await loadAccounts(tx, actor.companyId, [...new Set(lines.map((l) => l.accountId))]);
    const prepared = prepareEntry({ journalId: journal.id, entryDate: movement.movement_date, reference: movement.movement_no,
      description: `Equity — ${movement.document_ref} — ${movement.description}`, currency: 'MUR', lines }, 'MUR', loaded.all, loaded.active);
    if (!prepared.balanced) throw conflict('ENTRY_UNBALANCED', 'The equity movement is not balanced');
    const entryNo = await nextEntryNo(tx, actor.companyId, journal, movement.movement_date);
    const inserted = await tx.query<any>(
      `INSERT INTO journal_entries
        (company_id, journal_id, entry_no, entry_date, reference, description, currency,
         exchange_rate, status, source, created_by, posted_at, posted_by)
       VALUES ($1,$2,$3,$4,$5,$6,'MUR',1,'posted','equity',$7,now(),$7) RETURNING *`,
      [actor.companyId, journal.id, entryNo, movement.movement_date, movement.movement_no,
        `Equity — ${movement.document_ref} — ${movement.description}`, actor.userId],
    );
    await insertLines(tx, inserted.rows[0].id, actor.companyId, prepared);
    await tx.query(`UPDATE equity_movements SET status='POSTED', entry_id=$2, updated_at=now() WHERE id=$1`, [id, inserted.rows[0].id]);
    await audit(tx, actor, 'equity.movement.post', 'equity_movement', id, { entryNo });
    return inserted.rows[0];
  });
  return { movement: await getEquityMovement(db, actor.companyId, id), entry };
}

/* --------------------------------------------------------------- closing */
interface ClosingLine { accountId: string; code: string; name: string; description: string; debit: string; credit: string; }
interface ClosingPreview {
  company: any; period: any; journal: any; resultAccount: any;
  nextStartDate: string; nextEndDate: string; nextPeriod: any | null;
  lines: ClosingLine[]; checks: Check[]; blockers: Check[]; warnings: Check[];
  resultAmount: bigint; revenueTotal: bigint; expenseTotal: bigint; fingerprint: string;
}
function defaultNextDate(end: string): { start: string; end: string } {
  const [y, m, d] = end.split('-').map(Number);
  return {
    start: new Date(Date.UTC(y!, m! - 1, d! + 1)).toISOString().slice(0, 10),
    end: new Date(Date.UTC(y! + 1, m! - 1, d!)).toISOString().slice(0, 10),
  };
}
export async function buildClosingPreview(db: Db, companyId: string, periodId: string,
  input: { journalId: string; resultAccountId: string; nextStartDate?: string | null; nextEndDate?: string | null }): Promise<ClosingPreview> {
  const companyRes = await db.query<any>('SELECT * FROM companies WHERE id = $1', [companyId]);
  const company = companyRes.rows[0];
  if (!company) throw notFound('COMPANY_NOT_FOUND', 'Company not found');
  const periodRes = await db.query<any>('SELECT * FROM accounting_periods WHERE id = $1 AND company_id = $2', [periodId, companyId]);
  const period = periodRes.rows[0];
  if (!period) throw notFound('CLOSING_NOT_FOUND', 'Accounting period not found');
  const journal = await journalRow(db, companyId, input.journalId);
  const resultAccount = await accountRow(db, companyId, input.resultAccountId);
  const defaults = defaultNextDate(period.end_date);
  const nextStartDate = dateValue(input.nextStartDate || defaults.start);
  const nextEndDate = dateValue(input.nextEndDate || defaults.end);
  const checks: Check[] = [];

  checks.push(period.status === 'closed'
    ? block('SOURCE_PERIOD_CLOSED', 'The source period is already closed.', 'La période source est déjà clôturée.')
    : ok('SOURCE_PERIOD_OPEN', 'The source period is open.', 'La période source est ouverte.'));
  checks.push(resultAccount.type !== 'equity'
    ? block('RESULT_ACCOUNT_NOT_EQUITY', 'The result account must be an equity account.', 'Le compte de résultat doit être un compte de capitaux propres.')
    : ok('RESULT_ACCOUNT_EQUITY', 'The result account is an equity account.', 'Le compte de résultat est un compte de capitaux propres.'));
  if (!resultAccount.is_active) checks.push(block('RESULT_ACCOUNT_INACTIVE', 'The result account is inactive.', 'Le compte de résultat est inactif.'));
  if (!journal.is_active) checks.push(block('JOURNAL_INACTIVE', 'The closing journal is inactive.', 'Le journal de clôture est inactif.'));
  if (nextStartDate <= period.end_date) checks.push(block('NEXT_PERIOD_DATES_INVALID', 'The next exercise must start after the source end date.', 'L’exercice suivant doit commencer après la fin de la période source.'));
  if (nextEndDate < nextStartDate) checks.push(block('NEXT_PERIOD_DATES_INVALID', 'The next exercise end date is before its start date.', 'La fin de l’exercice suivant précède son début.'));

  const draft = await db.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM journal_entries WHERE company_id = $1 AND status = 'draft' AND entry_date BETWEEN $2 AND $3`,
    [companyId, period.start_date, period.end_date]);
  checks.push(Number(draft.rows[0]!.count) > 0
    ? block('DRAFT_ENTRIES_PRESENT', `${draft.rows[0]!.count} draft entry(ies) exist in the period.`, `${draft.rows[0]!.count} écriture(s) en brouillon existent dans la période.`)
    : ok('NO_DRAFT_ENTRIES', 'No draft entry remains in the period.', 'Aucune écriture en brouillon ne reste dans la période.'));

  const unbalanced = await db.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM (
       SELECT e.id FROM journal_entries e JOIN journal_lines l ON l.entry_id = e.id
        WHERE e.company_id = $1 AND e.status = 'posted' GROUP BY e.id HAVING SUM(l.debit) <> SUM(l.credit)
     ) x`, [companyId]);
  checks.push(Number(unbalanced.rows[0]!.count) > 0
    ? block('UNBALANCED_POSTED_ENTRIES', 'A posted entry is unbalanced.', 'Une écriture comptabilisée est déséquilibrée.')
    : ok('POSTED_ENTRIES_BALANCED', 'Every posted entry is balanced.', 'Chaque écriture comptabilisée est équilibrée.'));

  const pnl = await db.query<any>(
    `SELECT a.id, a.code, a.name, a.type, a.is_active, COALESCE(SUM(l.debit - l.credit), 0)::text AS net
       FROM accounts a JOIN journal_lines l ON l.account_id = a.id JOIN journal_entries e ON e.id = l.entry_id
      WHERE a.company_id = $1 AND e.company_id = $1 AND e.status = 'posted'
        AND e.entry_date BETWEEN $2 AND $3 AND a.type IN ('revenue','expense') AND e.source <> 'closing'
      GROUP BY a.id, a.code, a.name, a.type, a.is_active
      HAVING SUM(l.debit - l.credit) <> 0 ORDER BY a.code`,
    [companyId, period.start_date, period.end_date]);
  const lines: ClosingLine[] = [];
  let revenueTotal = 0n;
  let expenseTotal = 0n;
  for (const row of pnl.rows) {
    const net = parseAmount(row.net);
    if (!row.is_active) checks.push(block('ACCOUNT_INACTIVE', `Account ${row.code} is inactive and cannot receive a closing line.`, `Le compte ${row.code} est inactif et ne peut pas recevoir de ligne de clôture.`));
    if (row.type === 'revenue') {
      revenueTotal += -net;
      if (net < 0n) lines.push({ accountId: row.id, code: row.code, name: row.name, description: 'Year-end closing — revenue', debit: formatAmount(-net), credit: '0.0000' });
      else if (net > 0n) lines.push({ accountId: row.id, code: row.code, name: row.name, description: 'Year-end closing — revenue contra balance', debit: '0.0000', credit: formatAmount(net) });
    } else {
      expenseTotal += net;
      if (net > 0n) lines.push({ accountId: row.id, code: row.code, name: row.name, description: 'Year-end closing — expense', debit: '0.0000', credit: formatAmount(net) });
      else if (net < 0n) lines.push({ accountId: row.id, code: row.code, name: row.name, description: 'Year-end closing — expense contra balance', debit: formatAmount(-net), credit: '0.0000' });
    }
  }
  const resultAmount = revenueTotal - expenseTotal;
  if (lines.length === 0) checks.push(block('NO_PROFIT_AND_LOSS_ACTIVITY', 'No posted profit or loss movement exists in this period.', 'Aucun mouvement de produit ou de charge comptabilisé n’existe sur cette période.'));
  if (lines.length > 198) checks.push(block('TOO_MANY_CLOSING_LINES', 'More than 198 profit and loss accounts must be closed.', 'Plus de 198 comptes de résultat doivent être clôturés.'));
  if (resultAmount > 0n) lines.push({ accountId: resultAccount.id, code: resultAccount.code, name: resultAccount.name, description: 'Result for the year — profit', debit: '0.0000', credit: formatAmount(resultAmount) });
  else if (resultAmount < 0n) lines.push({ accountId: resultAccount.id, code: resultAccount.code, name: resultAccount.name, description: 'Result for the year — loss', debit: formatAmount(-resultAmount), credit: '0.0000' });
  else if (lines.length > 0) checks.push(warn('RESULT_ZERO', 'The result is zero; no result line is added.', 'Le résultat est nul ; aucune ligne de résultat n’est ajoutée.'));
  const debitTotal = lines.reduce((sum, l) => sum + parseAmount(l.debit), 0n);
  const creditTotal = lines.reduce((sum, l) => sum + parseAmount(l.credit), 0n);
  if (debitTotal === creditTotal && lines.length >= 2) checks.push(ok('CLOSING_ENTRY_BALANCED', 'The closing entry is exactly balanced.', 'L’écriture de clôture est exactement équilibrée.'));
  else if (lines.length >= 2) checks.push(block('CLOSING_ENTRY_UNBALANCED', 'The closing entry is not balanced; no adjustment is created.', 'L’écriture de clôture n’est pas équilibrée ; aucun ajustement n’est créé.'));

  const overlap = await db.query<any>(
    `SELECT id, name, start_date, end_date, status FROM accounting_periods
      WHERE company_id = $1 AND start_date <= $3 AND end_date >= $2 ORDER BY start_date`,
    [companyId, nextStartDate, nextEndDate]);
  let nextPeriod: any = null;
  if (overlap.rows.length === 1 && overlap.rows[0].start_date === nextStartDate && overlap.rows[0].end_date === nextEndDate) {
    nextPeriod = overlap.rows[0];
    checks.push(nextPeriod.status === 'closed'
      ? block('NEXT_PERIOD_CLOSED', 'The next exercise already exists but is closed.', 'L’exercice suivant existe déjà mais est clôturé.')
      : ok('NEXT_PERIOD_EXISTS', 'The next exercise already exists and is open.', 'L’exercice suivant existe déjà et est ouvert.'));
  } else if (overlap.rows.length > 0) {
    checks.push(block('NEXT_PERIOD_OVERLAP', 'The requested next exercise overlaps another period.', 'L’exercice suivant demandé chevauche une autre période.'));
  } else {
    checks.push(ok('NEXT_PERIOD_WILL_BE_CREATED', 'The next exercise will be created when the closing is posted.', 'L’exercice suivant sera créé lors de la comptabilisation de la clôture.'));
  }
  const blockers = checks.filter((c) => c.severity === 'block');
  const warnings = checks.filter((c) => c.severity === 'warning');
  const fingerprint = createHash('sha256').update(JSON.stringify({
    companyId, periodId, periodStart: period.start_date, periodEnd: period.end_date,
    journalId: journal.id, resultAccountId: resultAccount.id, nextStartDate, nextEndDate,
    resultAmount: formatAmount(resultAmount), lines, pnl: pnl.rows.map((r: any) => [r.id, r.net]),
  })).digest('hex').slice(0, 32);
  return { company, period, journal, resultAccount, nextStartDate, nextEndDate, nextPeriod, lines, checks, blockers, warnings, resultAmount, revenueTotal, expenseTotal, fingerprint };
}

const closingSelect = `
  SELECT c.*, j.code AS journal_code, j.name AS journal_name,
         a.code AS result_account_code, a.name AS result_account_name,
         p.name AS source_period_name, p.status AS source_period_status,
         e.entry_no AS closing_entry_no, u.full_name AS decided_by_name, pu.full_name AS prepared_by_name
    FROM fiscal_closings c
    JOIN journals j ON j.id = c.journal_id
    JOIN accounts a ON a.id = c.result_account_id
    JOIN accounting_periods p ON p.id = c.source_period_id
    LEFT JOIN journal_entries e ON e.id = c.closing_entry_id
    LEFT JOIN app_users u ON u.id = c.decided_by
    LEFT JOIN app_users pu ON pu.id = c.prepared_by
`;
function closingView(row: any) {
  return {
    id: row.id, sourcePeriodId: row.source_period_id, sourcePeriodName: row.source_period_name,
    sourceStart: row.source_start, sourceEnd: row.source_end, version: row.version,
    journal: { id: row.journal_id, code: row.journal_code, name: row.journal_name },
    resultAccount: { id: row.result_account_id, code: row.result_account_code, name: row.result_account_name },
    nextStartDate: row.next_start_date, nextEndDate: row.next_end_date, nextPeriodId: row.next_period_id,
    resultAmount: row.result_amount, status: row.status, checks: row.checks ?? [], blockers: row.blockers ?? [],
    warnings: row.warnings ?? [], lines: row.lines ?? [], sourceFingerprint: row.source_fingerprint,
    preparedByName: row.prepared_by_name, preparedAt: row.prepared_at, decidedByName: row.decided_by_name,
    decidedAt: row.decided_at, decisionNote: row.decision_note, rejectionReason: row.rejection_reason,
    closingEntryId: row.closing_entry_id, closingEntryNo: row.closing_entry_no, postedAt: row.posted_at,
    createdAt: row.created_at,
  };
}
export async function listClosings(db: Db, companyId: string) {
  const res = await db.query<any>(`${closingSelect} WHERE c.company_id = $1 ORDER BY c.source_end DESC, c.version DESC`, [companyId]);
  return res.rows.map(closingView);
}
export async function getClosing(db: Db, companyId: string, id: string) {
  const res = await db.query<any>(`${closingSelect} WHERE c.company_id = $1 AND c.id = $2`, [companyId, id]);
  if (!res.rows[0]) throw notFound('CLOSING_NOT_FOUND', 'Closing not found');
  return closingView(res.rows[0]);
}

export async function prepareClosing(db: Db, actor: EquityActor, periodId: string,
  input: { journalId: string; resultAccountId: string; nextStartDate?: string | null; nextEndDate?: string | null }) {
  const preview = await buildClosingPreview(db, actor.companyId, periodId, input);
  const existing = await db.query<any>('SELECT * FROM fiscal_closings WHERE company_id = $1 AND source_period_id = $2 ORDER BY version DESC', [actor.companyId, periodId]);
  if (existing.rows.some((r) => r.status === 'POSTED')) throw conflict('CLOSING_ALREADY_POSTED', 'This period is already closed');
  const active = existing.rows.find((r) => ['REVIEW_REQUIRED', 'APPROVED', 'BLOCKED'].includes(r.status));
  const company = await db.query<{ cabinet_id: string }>('SELECT cabinet_id FROM companies WHERE id = $1', [actor.companyId]);
  const cabinetId = company.rows[0]!.cabinet_id;
  const status = preview.blockers.length > 0 ? 'BLOCKED' : 'REVIEW_REQUIRED';
  const version = active ? active.version : Math.max(0, ...existing.rows.map((r) => Number(r.version))) + 1;
  const savedId = await db.transaction(async (tx) => {
    let id: string;
    if (active) {
      await tx.query(
        `UPDATE fiscal_closings SET source_start=$2, source_end=$3, journal_id=$4, result_account_id=$5,
           next_start_date=$6, next_end_date=$7, next_period_id=$8, result_amount=$9, status=$10,
           checks=$11::jsonb, blockers=$12::jsonb, warnings=$13::jsonb, lines=$14::jsonb,
           source_fingerprint=$15, prepared_by=$16, prepared_at=now(), decided_by=NULL, decided_at=NULL,
           decision_note=NULL, rejection_reason=NULL, updated_at=now() WHERE id=$1`,
        [active.id, preview.period.start_date, preview.period.end_date, preview.journal.id, preview.resultAccount.id,
          preview.nextStartDate, preview.nextEndDate, preview.nextPeriod?.id ?? null, formatAmount(preview.resultAmount),
          status, JSON.stringify(preview.checks), JSON.stringify(preview.blockers), JSON.stringify(preview.warnings),
          JSON.stringify(preview.lines), preview.fingerprint, actor.userId],
      );
      id = active.id;
    } else {
      const res = await tx.query<any>(
        `INSERT INTO fiscal_closings
          (cabinet_id, company_id, source_period_id, source_start, source_end, version, journal_id,
           result_account_id, next_start_date, next_end_date, next_period_id, result_amount, status,
           checks, blockers, warnings, lines, source_fingerprint, prepared_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15::jsonb,$16::jsonb,$17::jsonb,$18,$19)
         RETURNING id`,
        [cabinetId, actor.companyId, periodId, preview.period.start_date, preview.period.end_date, version,
          preview.journal.id, preview.resultAccount.id, preview.nextStartDate, preview.nextEndDate,
          preview.nextPeriod?.id ?? null, formatAmount(preview.resultAmount), status,
          JSON.stringify(preview.checks), JSON.stringify(preview.blockers), JSON.stringify(preview.warnings),
          JSON.stringify(preview.lines), preview.fingerprint, actor.userId],
      );
      id = res.rows[0].id;
    }
    await audit(tx, actor, 'closing.prepare', 'fiscal_closing', id, { periodId, version, status, resultAmount: formatAmount(preview.resultAmount) });
    return id;
  });
  return getClosing(db, actor.companyId, savedId);
}

async function assertClosingCurrent(tx: Db, actor: EquityActor, row: any) {
  const preview = await buildClosingPreview(tx, actor.companyId, row.source_period_id, {
    journalId: row.journal_id, resultAccountId: row.result_account_id,
    nextStartDate: row.next_start_date, nextEndDate: row.next_end_date,
  });
  if (preview.fingerprint !== row.source_fingerprint) throw conflict('CLOSING_STALE', 'The closing source changed; prepare it again');
  if (preview.blockers.length > 0) throw conflict('CLOSING_BLOCKED', 'The closing still has blocking controls', { blockers: preview.blockers });
  return preview;
}

export async function approveClosing(db: Db, actor: EquityActor, id: string, input: { confirm: boolean; note: string }) {
  if (!input.confirm || String(input.note ?? '').trim().length < 10) throw badRequest('CLOSING_DECISION_REQUIRED', 'A confirmation and a note of at least 10 characters are required');
  await db.transaction(async (tx) => {
    const res = await tx.query<any>('SELECT * FROM fiscal_closings WHERE id = $1 AND company_id = $2 FOR UPDATE', [id, actor.companyId]);
    const row = res.rows[0];
    if (!row) throw notFound('CLOSING_NOT_FOUND', 'Closing not found');
    if (row.status === 'POSTED') throw conflict('CLOSING_ALREADY_POSTED', 'A posted closing is immutable');
    if (row.status === 'REJECTED') throw conflict('CLOSING_REJECTED', 'A rejected closing must be prepared again');
    if (row.status === 'APPROVED') throw conflict('CLOSING_ALREADY_APPROVED', 'This closing is already approved');
    if (row.status === 'BLOCKED') throw conflict('CLOSING_BLOCKED', 'A blocked closing cannot be approved');
    await assertClosingCurrent(tx, actor, row);
    await tx.query(`UPDATE fiscal_closings SET status='APPROVED', decided_by=$2, decided_at=now(), decision_note=$3, updated_at=now() WHERE id=$1`, [id, actor.userId, String(input.note).trim()]);
    await audit(tx, actor, 'closing.approve', 'fiscal_closing', id, { note: String(input.note).trim() });
  });
  return getClosing(db, actor.companyId, id);
}

export async function rejectClosing(db: Db, actor: EquityActor, id: string, input: { reason: string }) {
  if (String(input.reason ?? '').trim().length < 10) throw badRequest('CLOSING_DECISION_REQUIRED', 'A rejection reason of at least 10 characters is required');
  await db.transaction(async (tx) => {
    const res = await tx.query<any>('SELECT * FROM fiscal_closings WHERE id = $1 AND company_id = $2 FOR UPDATE', [id, actor.companyId]);
    const row = res.rows[0];
    if (!row) throw notFound('CLOSING_NOT_FOUND', 'Closing not found');
    if (row.status === 'POSTED') throw conflict('CLOSING_ALREADY_POSTED', 'A posted closing is immutable');
    await tx.query(`UPDATE fiscal_closings SET status='REJECTED', decided_by=$2, decided_at=now(), rejection_reason=$3, updated_at=now() WHERE id=$1`, [id, actor.userId, String(input.reason).trim()]);
    await audit(tx, actor, 'closing.reject', 'fiscal_closing', id, { reason: String(input.reason).trim() });
  });
  return getClosing(db, actor.companyId, id);
}

export async function postClosing(db: Db, actor: EquityActor, id: string) {
  const entry = await db.transaction(async (tx) => {
    const res = await tx.query<any>('SELECT * FROM fiscal_closings WHERE id = $1 AND company_id = $2 FOR UPDATE', [id, actor.companyId]);
    const row = res.rows[0];
    if (!row) throw notFound('CLOSING_NOT_FOUND', 'Closing not found');
    if (row.status === 'POSTED') throw conflict('CLOSING_ALREADY_POSTED', 'This closing is already posted');
    if (row.status !== 'APPROVED') throw conflict('CLOSING_NOT_APPROVED', 'The closing must be approved first');
    const preview = await assertClosingCurrent(tx, actor, row);
    await assertOpenPeriod(tx, actor.companyId, preview.period.end_date);
    const journal = await loadJournal(tx, actor.companyId, preview.journal.id);
    if (!journal.is_active) throw badRequest('EQUITY_JOURNAL_INACTIVE', 'The closing journal is inactive');
    const loaded = await loadAccounts(tx, actor.companyId, [...new Set(preview.lines.map((l) => l.accountId))]);
    const prepared = prepareEntry({
      journalId: journal.id, entryDate: preview.period.end_date, reference: `CLOSE-${preview.period.end_date}`,
      description: `Year-end closing ${preview.period.start_date} → ${preview.period.end_date}`,
      currency: preview.company.functional_currency,
      lines: preview.lines.map((line) => ({ accountId: line.accountId, description: line.description,
        debit: line.debit === '0.0000' ? null : line.debit, credit: line.credit === '0.0000' ? null : line.credit })),
    }, preview.company.functional_currency, loaded.all, loaded.active);
    if (!prepared.balanced) throw conflict('ENTRY_UNBALANCED', 'The closing entry is not balanced; no adjustment is created');
    const entryNo = await nextEntryNo(tx, actor.companyId, journal, preview.period.end_date);
    const inserted = await tx.query<any>(
      `INSERT INTO journal_entries
        (company_id, journal_id, entry_no, entry_date, reference, description, currency,
         exchange_rate, status, source, created_by, posted_at, posted_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,1,'posted','closing',$8,now(),$8) RETURNING *`,
      [actor.companyId, journal.id, entryNo, preview.period.end_date, `CLOSE-${preview.period.end_date}`,
        `Year-end closing ${preview.period.start_date} → ${preview.period.end_date}`,
        preview.company.functional_currency, actor.userId],
    );
    await insertLines(tx, inserted.rows[0].id, actor.companyId, prepared);
    await tx.query(`UPDATE accounting_periods SET status='closed', closed_at=now(), closed_by=$2 WHERE id=$1`, [preview.period.id, actor.userId]);
    let nextPeriodId = preview.nextPeriod?.id ?? null;
    if (!nextPeriodId) {
      const created = await tx.query<any>(
        `INSERT INTO accounting_periods (company_id, name, start_date, end_date, status)
         VALUES ($1,$2,$3,$4,'open') RETURNING id`,
        [actor.companyId, `FY ${preview.nextStartDate.slice(0, 4)}/${preview.nextEndDate.slice(0, 4)}`,
          preview.nextStartDate, preview.nextEndDate]);
      nextPeriodId = created.rows[0].id;
    }
    await tx.query(`UPDATE fiscal_closings SET status='POSTED', closing_entry_id=$2, next_period_id=$3, posted_at=now(), updated_at=now() WHERE id=$1`, [id, inserted.rows[0].id, nextPeriodId]);
    await audit(tx, actor, 'closing.post', 'fiscal_closing', id, { entryNo, nextPeriodId, resultAmount: formatAmount(preview.resultAmount) });
    return inserted.rows[0];
  });
  return { closing: await getClosing(db, actor.companyId, id), entry };
}

/* ------------------------------------------------------------ allocation */
export async function getAllocation(db: Db, companyId: string, closingId: string) {
  const res = await db.query<any>(
    `SELECT a.*, j.code AS journal_code, j.name AS journal_name, e.entry_no,
            u.full_name AS approved_by_name, cu.full_name AS created_by_name
       FROM equity_allocations a JOIN journals j ON j.id = a.journal_id
       LEFT JOIN journal_entries e ON e.id = a.entry_id
       LEFT JOIN app_users u ON u.id = a.approved_by
       LEFT JOIN app_users cu ON cu.id = a.created_by
      WHERE a.company_id = $1 AND a.closing_id = $2`, [companyId, closingId]);
  const row = res.rows[0];
  if (!row) return null;
  const lines = await db.query<any>(
    `SELECT l.*, ac.code AS account_code, ac.name AS account_name, ac.type AS account_type
       FROM equity_allocation_lines l JOIN accounts ac ON ac.id = l.account_id
      WHERE l.allocation_id = $1 ORDER BY l.line_no`, [row.id]);
  const result = parseAmount(row.result_amount);
  const absResult = result < 0n ? -result : result;
  return {
    id: row.id, closingId: row.closing_id, allocationDate: row.allocation_date,
    journal: { id: row.journal_id, code: row.journal_code, name: row.journal_name },
    documentRef: row.document_ref, decisionDate: row.decision_date, note: row.note,
    resultAmount: row.result_amount, allocatedAmount: row.allocated_amount,
    unallocatedAmount: formatAmount(absResult - parseAmount(row.allocated_amount)),
    status: row.status, approvedByName: row.approved_by_name, approvedAt: row.approved_at,
    approvalNote: row.approval_note, entryId: row.entry_id, entryNo: row.entry_no,
    createdByName: row.created_by_name, createdAt: row.created_at,
    lines: lines.rows.map((l: any) => ({ id: l.id, lineNo: l.line_no, nature: l.nature, amount: l.amount,
      account: { id: l.account_id, code: l.account_code, name: l.account_name, type: l.account_type } })),
  };
}
export interface AllocationInput {
  allocationDate: string; journalId: string; documentRef: string; decisionDate: string; note: string;
  lines: { nature: (typeof NATURES)[number]; accountId: string; amount: string | number }[];
}
export async function saveAllocation(db: Db, actor: EquityActor, closingId: string, input: AllocationInput) {
  const closingRes = await db.query<any>('SELECT * FROM fiscal_closings WHERE id = $1 AND company_id = $2', [closingId, actor.companyId]);
  const closing = closingRes.rows[0];
  if (!closing) throw notFound('CLOSING_NOT_FOUND', 'Closing not found');
  if (closing.status !== 'POSTED') throw conflict('ALLOCATION_CLOSING_NOT_POSTED', 'The closing must be posted before allocating its result');
  const result = parseAmount(closing.result_amount);
  if (result === 0n) throw badRequest('ALLOCATION_INVALID_LINES', 'A zero result cannot be allocated');
  const existing = await db.query<any>('SELECT * FROM equity_allocations WHERE company_id = $1 AND closing_id = $2', [actor.companyId, closingId]);
  if (existing.rows[0]?.status === 'POSTED') throw conflict('ALLOCATION_ALREADY_POSTED', 'The allocation is already posted');
  if (existing.rows[0]?.status === 'APPROVED') throw conflict('CONFLICT', 'An approved allocation cannot be changed');
  if (!Array.isArray(input.lines) || input.lines.length === 0 || input.lines.length > 20) throw badRequest('ALLOCATION_INVALID_LINES', 'Between 1 and 20 allocation lines are required');
  const note = String(input.note ?? '').trim();
  const documentRef = String(input.documentRef ?? '').trim();
  if (note.length < 5) throw badRequest('ALLOCATION_INVALID_LINES', 'A documented allocation note is required');
  if (documentRef.length < 2) throw badRequest('ALLOCATION_INVALID_LINES', 'A decision document reference is required');
  dateValue(input.allocationDate); dateValue(input.decisionDate);
  const journal = await journalRow(db, actor.companyId, input.journalId);
  if (!journal.is_active) throw badRequest('EQUITY_JOURNAL_INACTIVE', 'The allocation journal is inactive');
  const seen = new Set<string>();
  const lines: { nature: string; accountId: string; amount: bigint }[] = [];
  for (const line of input.lines) {
    if (!NATURES.includes(line.nature)) throw badRequest('ALLOCATION_INVALID_LINES', 'Invalid allocation nature');
    if (seen.has(line.accountId)) throw badRequest('ALLOCATION_INVALID_LINES', 'An account can only appear once');
    seen.add(line.accountId);
    const account = await accountRow(db, actor.companyId, line.accountId);
    if (!account.is_active) throw badRequest('EQUITY_ACCOUNT_INACTIVE', 'An allocation account is inactive');
    lines.push({ nature: line.nature, accountId: account.id, amount: assertAmount(line.amount) });
  }
  const allocated = lines.reduce((sum, l) => sum + l.amount, 0n);
  const absResult = result < 0n ? -result : result;
  if (allocated !== absResult) throw badRequest('ALLOCATION_AMOUNT_MISMATCH', 'The allocation lines must sum exactly to the absolute result', { expected: formatAmount(absResult), actual: formatAmount(allocated) });
  const company = await db.query<{ cabinet_id: string }>('SELECT cabinet_id FROM companies WHERE id = $1', [actor.companyId]);
  const cabinetId = company.rows[0]!.cabinet_id;
  const savedId = await db.transaction(async (tx) => {
    let id: string;
    if (existing.rows[0]) {
      id = existing.rows[0].id;
      await tx.query(
        `UPDATE equity_allocations SET allocation_date=$2, journal_id=$3, document_ref=$4, decision_date=$5,
           note=$6, result_amount=$7, allocated_amount=$8, status='DRAFT', approved_by=NULL,
           approved_at=NULL, approval_note=NULL, updated_at=now() WHERE id=$1`,
        [id, input.allocationDate, journal.id, documentRef, input.decisionDate, note, formatAmount(result), formatAmount(allocated)]);
      await tx.query('DELETE FROM equity_allocation_lines WHERE allocation_id = $1', [id]);
    } else {
      const res = await tx.query<any>(
        `INSERT INTO equity_allocations
          (cabinet_id, company_id, closing_id, allocation_date, journal_id, document_ref,
           decision_date, note, result_amount, allocated_amount, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
        [cabinetId, actor.companyId, closingId, input.allocationDate, journal.id, documentRef,
          input.decisionDate, note, formatAmount(result), formatAmount(allocated), actor.userId]);
      id = res.rows[0].id;
    }
    let no = 1;
    for (const line of lines) {
      await tx.query(
        `INSERT INTO equity_allocation_lines (allocation_id, company_id, line_no, nature, account_id, amount)
         VALUES ($1,$2,$3,$4,$5,$6)`, [id, actor.companyId, no++, line.nature, line.accountId, formatAmount(line.amount)]);
    }
    await audit(tx, actor, 'equity.allocation.save', 'equity_allocation', id, { closingId, documentRef, allocated: formatAmount(allocated) });
    return id;
  });
  return getAllocation(db, actor.companyId, closingId);
}

export async function approveAllocation(db: Db, actor: EquityActor, closingId: string, input: { confirm: boolean; note: string }) {
  if (!input.confirm || String(input.note ?? '').trim().length < 10) throw badRequest('EQUITY_DECISION_REQUIRED', 'A confirmation and a note of at least 10 characters are required');
  const res = await db.query<any>('SELECT * FROM equity_allocations WHERE company_id = $1 AND closing_id = $2', [actor.companyId, closingId]);
  const row = res.rows[0];
  if (!row) throw notFound('ALLOCATION_NOT_FOUND', 'Allocation not found');
  if (row.status === 'POSTED') throw conflict('ALLOCATION_ALREADY_POSTED', 'The allocation is already posted');
  await db.transaction(async (tx) => {
    await tx.query(`UPDATE equity_allocations SET status='APPROVED', approved_by=$2, approved_at=now(), approval_note=$3, updated_at=now() WHERE id=$1`, [row.id, actor.userId, String(input.note).trim()]);
    await audit(tx, actor, 'equity.allocation.approve', 'equity_allocation', row.id, { note: String(input.note).trim() });
  });
  return getAllocation(db, actor.companyId, closingId);
}

export async function postAllocation(db: Db, actor: EquityActor, closingId: string) {
  const entry = await db.transaction(async (tx) => {
    const closingRes = await tx.query<any>('SELECT * FROM fiscal_closings WHERE id = $1 AND company_id = $2 FOR UPDATE', [closingId, actor.companyId]);
    const closing = closingRes.rows[0];
    if (!closing) throw notFound('CLOSING_NOT_FOUND', 'Closing not found');
    if (closing.status !== 'POSTED') throw conflict('ALLOCATION_CLOSING_NOT_POSTED', 'The closing must be posted first');
    const res = await tx.query<any>('SELECT * FROM equity_allocations WHERE company_id = $1 AND closing_id = $2 FOR UPDATE', [actor.companyId, closingId]);
    const allocation = res.rows[0];
    if (!allocation) throw notFound('ALLOCATION_NOT_FOUND', 'Allocation not found');
    if (allocation.status === 'POSTED') throw conflict('ALLOCATION_ALREADY_POSTED', 'The allocation is already posted');
    if (allocation.status !== 'APPROVED') throw conflict('ALLOCATION_NOT_APPROVED', 'The allocation must be approved first');
    const linesRes = await tx.query<any>(
      `SELECT l.*, a.code, a.name FROM equity_allocation_lines l JOIN accounts a ON a.id = l.account_id
        WHERE l.allocation_id = $1 ORDER BY l.line_no`, [allocation.id]);
    const result = parseAmount(allocation.result_amount);
    const absResult = result < 0n ? -result : result;
    const total = linesRes.rows.reduce((sum: bigint, l: any) => sum + parseAmount(l.amount), 0n);
    if (total !== absResult) throw badRequest('ALLOCATION_AMOUNT_MISMATCH', 'Allocation no longer matches the result');
    const journal = await loadJournal(tx, actor.companyId, allocation.journal_id);
    if (!journal.is_active) throw badRequest('EQUITY_JOURNAL_INACTIVE', 'The allocation journal is inactive');
    await assertOpenPeriod(tx, actor.companyId, allocation.allocation_date);
    const entryLines = result > 0n
      ? [{ accountId: closing.result_account_id, description: `Result allocation — ${allocation.document_ref}`, debit: formatAmount(result) },
         ...linesRes.rows.map((l: any) => ({ accountId: l.account_id, description: `${l.nature} — ${allocation.document_ref}`, credit: String(l.amount) }))]
      : [{ accountId: closing.result_account_id, description: `Loss allocation — ${allocation.document_ref}`, credit: formatAmount(-result) },
         ...linesRes.rows.map((l: any) => ({ accountId: l.account_id, description: `${l.nature} — ${allocation.document_ref}`, debit: String(l.amount) }))];
    const loaded = await loadAccounts(tx, actor.companyId, [...new Set(entryLines.map((l) => l.accountId))]);
    const prepared = prepareEntry({ journalId: journal.id, entryDate: allocation.allocation_date,
      reference: allocation.document_ref, description: `Allocation of result — ${allocation.document_ref}`,
      currency: 'MUR', lines: entryLines }, 'MUR', loaded.all, loaded.active);
    if (!prepared.balanced) throw conflict('ENTRY_UNBALANCED', 'The allocation entry is not balanced');
    const entryNo = await nextEntryNo(tx, actor.companyId, journal, allocation.allocation_date);
    const inserted = await tx.query<any>(
      `INSERT INTO journal_entries
        (company_id, journal_id, entry_no, entry_date, reference, description, currency,
         exchange_rate, status, source, created_by, posted_at, posted_by)
       VALUES ($1,$2,$3,$4,$5,$6,'MUR',1,'posted','equity_allocation',$7,now(),$7) RETURNING *`,
      [actor.companyId, journal.id, entryNo, allocation.allocation_date, allocation.document_ref,
        `Allocation of result — ${allocation.document_ref}`, actor.userId]);
    await insertLines(tx, inserted.rows[0].id, actor.companyId, prepared);
    await tx.query(`UPDATE equity_allocations SET status='POSTED', entry_id=$2, updated_at=now() WHERE id=$1`, [allocation.id, inserted.rows[0].id]);
    await audit(tx, actor, 'equity.allocation.post', 'equity_allocation', allocation.id, { entryNo, closingId });
    return inserted.rows[0];
  });
  return { allocation: await getAllocation(db, actor.companyId, closingId), entry };
}

/* -------------------------------------------------------------- statement */
export async function equityStatement(db: Db, companyId: string, from: string, to: string) {
  dateValue(from); dateValue(to);
  if (from > to) throw badRequest('INVALID_DATE_RANGE', 'The start date must be before the end date');
  const companyRes = await db.query<any>('SELECT name, functional_currency FROM companies WHERE id = $1', [companyId]);
  const company = companyRes.rows[0];
  if (!company) throw notFound('COMPANY_NOT_FOUND', 'Company not found');
  const currency = company.functional_currency;
  const rows = await db.query<any>(
    `SELECT a.id, a.code, a.name,
            COALESCE(SUM(CASE WHEN e.entry_date < $2 THEN l.debit - l.credit ELSE 0 END),0)::text AS opening,
            COALESCE(SUM(CASE WHEN e.entry_date BETWEEN $2 AND $3 THEN l.debit - l.credit ELSE 0 END),0)::text AS movement,
            COALESCE(SUM(CASE WHEN e.entry_date <= $3 THEN l.debit - l.credit ELSE 0 END),0)::text AS closing
       FROM accounts a JOIN journal_lines l ON l.account_id = a.id JOIN journal_entries e ON e.id = l.entry_id
      WHERE a.company_id = $1 AND e.company_id = $1 AND e.status = 'posted' AND a.type = 'equity'
      GROUP BY a.id, a.code, a.name ORDER BY a.code`, [companyId, from, to]);
  const tb = await computeTrialBalance(db, companyId, currency, { from: '1900-01-01', to });
  const tbByAccount = new Map(tb.rows.map((r) => [r.accountId, r]));
  const equityRows = rows.rows.map((r: any) => {
    const opening = -parseAmount(r.opening);
    const movement = -parseAmount(r.movement);
    const closing = -parseAmount(r.closing);
    const tbRow = tbByAccount.get(r.id);
    const trialBalanceClosing = tbRow ? parseAmount(tbRow.closingCredit) - parseAmount(tbRow.closingDebit) : 0n;
    return { accountId: r.id, code: r.code, name: r.name, opening: formatAmount(opening),
      increases: formatAmount(movement > 0n ? movement : 0n), decreases: formatAmount(movement < 0n ? -movement : 0n),
      movement: formatAmount(movement), closing: formatAmount(closing),
      trialBalanceClosing: formatAmount(trialBalanceClosing), difference: formatAmount(closing - trialBalanceClosing) };
  });
  const closingTotal = equityRows.reduce((sum, r) => sum + parseAmount(r.closing), 0n);
  const lastClose = await db.query<{ source_end: string }>(
    `SELECT source_end::text FROM fiscal_closings WHERE company_id = $1 AND status = 'POSTED' AND source_end <= $2 ORDER BY source_end DESC LIMIT 1`,
    [companyId, to]);
  const closedThrough = lastClose.rows[0]?.source_end ?? null;
  const pnlFrom = closedThrough && to >= closedThrough ? closedThrough : '1900-01-01';
  const pnl = await db.query<any>(
    `SELECT a.type, COALESCE(SUM(l.credit - l.debit), 0)::text AS credit_net,
            COALESCE(SUM(l.debit - l.credit), 0)::text AS debit_net
       FROM accounts a JOIN journal_lines l ON l.account_id = a.id JOIN journal_entries e ON e.id = l.entry_id
      WHERE a.company_id = $1 AND e.company_id = $1 AND e.status = 'posted' AND a.type IN ('revenue','expense')
        AND e.entry_date <= $2 AND e.entry_date > $3 AND e.source <> 'closing'
      GROUP BY a.type`, [companyId, to, pnlFrom]);
  let periodResult = 0n;
  for (const row of pnl.rows) periodResult += row.type === 'revenue' ? parseAmount(row.credit_net) : -parseAmount(row.debit_net);
  const balance = await db.query<any>(
    `SELECT a.type, COALESCE(SUM(l.debit - l.credit), 0)::text AS net
       FROM accounts a JOIN journal_lines l ON l.account_id = a.id JOIN journal_entries e ON e.id = l.entry_id
      WHERE a.company_id = $1 AND e.company_id = $1 AND e.status = 'posted' AND e.entry_date <= $2
      GROUP BY a.type`, [companyId, to]);
  let assets = 0n; let liabilities = 0n; let equityAccounts = 0n;
  for (const row of balance.rows) {
    const net = parseAmount(row.net);
    if (row.type === 'asset') assets += net;
    else if (row.type === 'liability') liabilities += -net;
    else if (row.type === 'equity') equityAccounts += -net;
  }
  const difference = assets - liabilities - equityAccounts - periodResult;
  const balanced = difference === 0n && equityRows.every((r) => parseAmount(r.difference) === 0n);
  return {
    from, to, currency, rows: equityRows, unappropriatedResult: formatAmount(periodResult),
    totals: {
      opening: formatAmount(equityRows.reduce((sum, r) => sum + parseAmount(r.opening), 0n)),
      increases: formatAmount(equityRows.reduce((sum, r) => sum + parseAmount(r.increases), 0n)),
      decreases: formatAmount(equityRows.reduce((sum, r) => sum + parseAmount(r.decreases), 0n)),
      closing: formatAmount(closingTotal), result: formatAmount(periodResult),
      equityWithResult: formatAmount(closingTotal + periodResult),
    },
    reconciliation: {
      assets: formatAmount(assets), liabilities: formatAmount(liabilities), equityAccounts: formatAmount(equityAccounts),
      unappropriatedResult: formatAmount(periodResult), difference: formatAmount(difference), balanced,
      trialBalanceBalanced: tb.balanced,
    },
    closedThrough,
    note: 'Statement prepared from posted entries. No dividend, reserve percentage or tax rule is inferred.',
    noteFr: 'État préparé depuis les écritures comptabilisées. Aucun dividende, pourcentage de réserve ou règle fiscale n’est déduit.',
  };
}

export async function equityOverview(db: Db, companyId: string, from: string, to: string) {
  const [statement, movements, closings] = await Promise.all([
    equityStatement(db, companyId, from, to), listEquityMovements(db, companyId), listClosings(db, companyId),
  ]);
  const accounts = await db.query<any>('SELECT id, code, name, type, is_active FROM accounts WHERE company_id = $1 ORDER BY code', [companyId]);
  const journals = await db.query<any>('SELECT id, code, name, type, is_active FROM journals WHERE company_id = $1 ORDER BY code', [companyId]);
  const periods = await db.query<any>(`SELECT id, name, start_date::text, end_date::text, status FROM accounting_periods WHERE company_id = $1 ORDER BY start_date DESC`, [companyId]);
  return { statement, movements, closings, accounts: accounts.rows, journals: journals.rows, periods: periods.rows };
}
