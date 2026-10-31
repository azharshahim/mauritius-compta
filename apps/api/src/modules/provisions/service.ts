/**
 * Mission 22 — controlled provisions register.
 *
 * A provision is a documented management judgement: evidence, measurement
 * basis, recognition, revisions, utilisation and reversal are separate
 * movements. Each movement is proposed, approved by a human, then posted.
 * No IAS 37 compliance, probability threshold or Mauritian rule is asserted or
 * applied automatically. AI suggestions can never create a posted provision.
 */
import type { Db } from '../../db/index.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { formatAmount, parseAmount } from '../../lib/money.js';
import { postEntryTx } from '../../lib/posting.js';
import { writeAudit } from '../../lib/audit.js';
import { assertOpenPeriod } from '../entries/service.js';

export interface ProvisionActor { companyId: string; userId: string; ip?: string | null; }
export type ProvisionCategory = 'litigation' | 'warranty' | 'restructuring' | 'other';
export type MovementType = 'recognition' | 'revision' | 'utilisation' | 'reversal';

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const amt = (v: unknown) => parseAmount(v ?? 0);
const fmt = (v: bigint) => formatAmount(v);
function date(value: string) {
  if (!ISO.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) throw badRequest('PROVISION_DATE_INVALID', 'Invalid date (YYYY-MM-DD)');
  return value;
}
async function cabinetIdOf(db: Db, companyId: string) {
  const res = await db.query<any>('SELECT cabinet_id FROM companies WHERE id=$1', [companyId]);
  if (!res.rows[0]) throw notFound('COMPANY_NOT_FOUND', 'Company not found');
  return res.rows[0].cabinet_id as string;
}
async function account(db: Db, companyId: string, id: string, label: string, types: string[]) {
  const res = await db.query<any>('SELECT id, code, name, type, is_active FROM accounts WHERE id=$1 AND company_id=$2', [id, companyId]);
  const row = res.rows[0];
  if (!row) throw badRequest('PROVISION_ACCOUNT_INVALID', `${label} does not belong to this company`);
  if (!row.is_active) throw badRequest('PROVISION_ACCOUNT_INVALID', `${label} is inactive`);
  if (!types.includes(row.type)) throw badRequest('PROVISION_ACCOUNT_INVALID', `${label} has an incompatible account type`);
  return row;
}
async function audit(db: Db, actor: ProvisionActor, action: string, id: string, details: Record<string, unknown> = {}) {
  await writeAudit(db, { companyId: actor.companyId, userId: actor.userId, action, entityType: 'provision', entityId: id, details, ip: actor.ip ?? null });
}
function requireDecision(confirm: unknown, note: unknown) {
  if (confirm !== true || String(note ?? '').trim().length < 10) {
    throw badRequest('PROVISION_DECISION_REQUIRED', 'A confirmation and a note of at least 10 characters are required');
  }
  return String(note).trim();
}

export interface ProvisionInput {
  category: ProvisionCategory; description: string; evidenceRef: string; recognitionDate: string;
  measurementBasis: string; expenseAccountId: string; provisionAccountId: string;
  currentPortion?: string | number | null; nonCurrentPortion?: string | number | null;
  initialAmount?: string | number | null; journalId?: string | null;
  initialReason?: string | null; documentRef?: string | null;
}
async function provisionRow(db: Db, companyId: string, id: string) {
  const res = await db.query<any>(
    `SELECT p.*, ea.code AS expense_code, ea.name AS expense_name,
            pa.code AS provision_code, pa.name AS provision_name
       FROM provisions p JOIN accounts ea ON ea.id=p.expense_account_id
       JOIN accounts pa ON pa.id=p.provision_account_id
      WHERE p.id=$1 AND p.company_id=$2`, [id, companyId]);
  if (!res.rows[0]) throw notFound('PROVISION_NOT_FOUND', 'Provision not found');
  return res.rows[0];
}
async function movements(db: Db, companyId: string, provisionId: string) {
  const res = await db.query<any>(
    `SELECT m.*, e.entry_no, j.code AS journal_code, j.name AS journal_name,
            a.code AS counterpart_code, a.name AS counterpart_name
       FROM provision_movements m LEFT JOIN journal_entries e ON e.id=m.entry_id
       LEFT JOIN journals j ON j.id=m.journal_id LEFT JOIN accounts a ON a.id=m.counterpart_account_id
      WHERE m.company_id=$1 AND m.provision_id=$2 ORDER BY m.movement_date, m.movement_no`, [companyId, provisionId]);
  return res.rows;
}
function signed(m: any): bigint {
  return m.direction === 'increase' ? amt(m.amount) : -amt(m.amount);
}
function movementView(m: any) {
  return { id: m.id, movementNo: m.movement_no, movementType: m.movement_type,
    movementDate: m.movement_date, amount: fmt(amt(m.amount)), direction: m.direction,
    reason: m.reason, documentRef: m.document_ref, status: m.status,
    journal: { id: m.journal_id, code: m.journal_code, name: m.journal_name },
    counterpartAccountId: m.counterpart_account_id,
    counterpartAccount: m.counterpart_code ? { code: m.counterpart_code, name: m.counterpart_name } : null,
    entryId: m.entry_id, entryNo: m.entry_no ?? null, approvalNote: m.approval_note,
    approvedAt: m.approved_at, rejectionReason: m.rejection_reason, postedAt: m.posted_at,
    createdByName: m.created_by_name ?? null, createdAt: m.created_at };
}
function provisionView(row: any, mvs: any[]) {
  const posted = mvs.filter((m) => m.status === 'POSTED');
  const recognised = posted.filter((m) => m.movement_type === 'recognition').reduce((s, m) => s + amt(m.amount), 0n);
  const revisionsUp = posted.filter((m) => m.movement_type === 'revision' && m.direction === 'increase').reduce((s, m) => s + amt(m.amount), 0n);
  const revisionsDown = posted.filter((m) => m.movement_type === 'revision' && m.direction === 'decrease').reduce((s, m) => s + amt(m.amount), 0n);
  const utilised = posted.filter((m) => m.movement_type === 'utilisation').reduce((s, m) => s + amt(m.amount), 0n);
  const reversed = posted.filter((m) => m.movement_type === 'reversal').reduce((s, m) => s + amt(m.amount), 0n);
  const carrying = posted.reduce((s, m) => s + signed(m), 0n);
  return {
    id: row.id, provisionNo: row.provision_no, category: row.category, description: row.description,
    evidenceRef: row.evidence_ref, recognitionDate: row.recognition_date, measurementBasis: row.measurement_basis,
    expenseAccountId: row.expense_account_id, provisionAccountId: row.provision_account_id,
    expenseAccount: { code: row.expense_code, name: row.expense_name },
    provisionAccount: { code: row.provision_code, name: row.provision_name },
    currentPortion: row.current_portion === null ? null : fmt(amt(row.current_portion)),
    nonCurrentPortion: row.non_current_portion === null ? null : fmt(amt(row.non_current_portion)),
    status: row.status, createdAt: row.created_at, updatedAt: row.updated_at,
    movements: mvs.map(movementView),
    totals: { recognised: fmt(recognised), revisionsUp: fmt(revisionsUp), revisionsDown: fmt(revisionsDown),
      utilised: fmt(utilised), reversed: fmt(reversed), carrying: fmt(carrying) },
    pendingMovements: mvs.filter((m) => ['PROPOSED', 'APPROVED'].includes(m.status)).length,
    note: 'Movement totals are derived from posted movements only. No probability or statutory threshold is inferred.',
  };
}
export async function getProvision(db: Db, companyId: string, id: string) {
  return provisionView(await provisionRow(db, companyId, id), await movements(db, companyId, id));
}
export async function listProvisions(db: Db, companyId: string, filter: { category?: string; status?: string } = {}) {
  const params: unknown[] = [companyId];
  let where = 'p.company_id=$1';
  if (filter.category) { params.push(filter.category); where += ` AND p.category=$${params.length}`; }
  if (filter.status) { params.push(filter.status); where += ` AND p.status=$${params.length}`; }
  const res = await db.query<any>(`SELECT p.id FROM provisions p WHERE ${where} ORDER BY p.recognition_date DESC, p.provision_no DESC`, params);
  const rows = [];
  for (const r of res.rows) rows.push(await getProvision(db, companyId, r.id));
  return rows;
}

async function nextNo(db: Db, companyId: string, table: string, column: string, prefix: string, year: string): Promise<string> {
  const pattern = `${prefix}-${year}-%`;
  const res = await db.query<any>(`SELECT count(*)::int AS count FROM ${table} WHERE company_id=$1 AND ${column} LIKE $2`, [companyId, pattern]);
  return `${prefix}-${year}-${String(Number(res.rows[0]?.count ?? 0) + 1).padStart(4, '0')}`;
}

export async function createProvision(db: Db, actor: ProvisionActor, input: ProvisionInput) {
  date(input.recognitionDate);
  if (!input.description?.trim() || !input.evidenceRef?.trim() || !input.measurementBasis?.trim()) {
    throw badRequest('PROVISION_EVIDENCE_REQUIRED', 'Description, evidence reference and measurement basis are required');
  }
  const expense = await account(db, actor.companyId, input.expenseAccountId, 'Expense account', ['expense']);
  const provisionAccount = await account(db, actor.companyId, input.provisionAccountId, 'Provision account', ['liability']);
  const current = input.currentPortion === undefined || input.currentPortion === null ? null : amt(input.currentPortion);
  const nonCurrent = input.nonCurrentPortion === undefined || input.nonCurrentPortion === null ? null : amt(input.nonCurrentPortion);
  if ((current ?? 0n) < 0n || (nonCurrent ?? 0n) < 0n) throw badRequest('PROVISION_AMOUNT_INVALID', 'Portions cannot be negative');
  const initial = input.initialAmount === undefined || input.initialAmount === null ? 0n : amt(input.initialAmount);
  if (initial < 0n) throw badRequest('PROVISION_AMOUNT_INVALID', 'The initial amount cannot be negative');
  if (initial > 0n && !input.journalId) throw badRequest('PROVISION_JOURNAL_REQUIRED', 'A journal is required for a recognition proposal');
  const cabinet = await cabinetIdOf(db, actor.companyId);
  return db.transaction(async (tx) => {
    const year = input.recognitionDate.slice(0, 4);
    const provisionNo = await nextNo(tx, actor.companyId, 'provisions', 'provision_no', 'PROV', year);
    const created = await tx.query<any>(
      `INSERT INTO provisions (cabinet_id, company_id, provision_no, category, description, evidence_ref,
         recognition_date, measurement_basis, expense_account_id, provision_account_id,
         current_portion, non_current_portion, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
      [cabinet, actor.companyId, provisionNo, input.category, input.description.trim(), input.evidenceRef.trim(),
        input.recognitionDate, input.measurementBasis.trim(), expense.id, provisionAccount.id,
        fmt(current ?? 0n), fmt(nonCurrent ?? 0n), actor.userId]);
    const id = created.rows[0].id;
    if (initial > 0n) {
      const journal = await tx.query<any>('SELECT id FROM journals WHERE id=$1 AND company_id=$2 AND is_active', [input.journalId, actor.companyId]);
      if (!journal.rows[0]) throw badRequest('JOURNAL_NOT_FOUND', 'Journal is unknown or inactive');
      const movementNo = await nextNo(tx, actor.companyId, 'provision_movements', 'movement_no', 'PM', year);
      await tx.query(
        `INSERT INTO provision_movements (cabinet_id, company_id, provision_id, movement_no, movement_type,
           movement_date, amount, direction, reason, document_ref, journal_id, created_by)
         VALUES ($1,$2,$3,$4,'recognition',$5,$6,'increase',$7,$8,$9,$10)`,
        [cabinet, actor.companyId, id, movementNo, input.recognitionDate, fmt(initial),
          input.initialReason?.trim() || 'Initial recognition proposal', input.documentRef?.trim() || input.evidenceRef.trim(),
          journal.rows[0].id, actor.userId]);
    }
    await audit(tx, actor, 'provision.create', id, { provisionNo, category: input.category, initial: fmt(initial) });
    return getProvision(tx, actor.companyId, id);
  });
}

export async function updateProvision(db: Db, actor: ProvisionActor, id: string, input: Partial<ProvisionInput>) {
  const row = await provisionRow(db, actor.companyId, id);
  if (row.status !== 'DRAFT') throw conflict('PROVISION_DECIDED', 'Only a draft provision can be modified');
  const expense = input.expenseAccountId ? await account(db, actor.companyId, input.expenseAccountId, 'Expense account', ['expense']) : null;
  const accountRow = input.provisionAccountId ? await account(db, actor.companyId, input.provisionAccountId, 'Provision account', ['liability']) : null;
  const current = input.currentPortion === undefined ? amt(row.current_portion) : amt(input.currentPortion ?? 0);
  const nonCurrent = input.nonCurrentPortion === undefined ? amt(row.non_current_portion) : amt(input.nonCurrentPortion ?? 0);
  if (current < 0n || nonCurrent < 0n) throw badRequest('PROVISION_AMOUNT_INVALID', 'Portions cannot be negative');
  await db.query(
    `UPDATE provisions SET category=$3, description=$4, evidence_ref=$5, recognition_date=$6,
       measurement_basis=$7, expense_account_id=$8, provision_account_id=$9,
       current_portion=$10, non_current_portion=$11, updated_at=now()
     WHERE id=$1 AND company_id=$2`,
    [id, actor.companyId, input.category ?? row.category, input.description?.trim() ?? row.description,
      input.evidenceRef?.trim() ?? row.evidence_ref, input.recognitionDate ?? row.recognition_date,
      input.measurementBasis?.trim() ?? row.measurement_basis, expense?.id ?? row.expense_account_id,
      accountRow?.id ?? row.provision_account_id, fmt(current), fmt(nonCurrent)]);
  await audit(db, actor, 'provision.update', id, {});
  return getProvision(db, actor.companyId, id);
}

export interface MovementInput {
  movementType: MovementType; movementDate: string; amount: string | number;
  direction?: 'increase' | 'decrease'; reason: string; documentRef: string;
  journalId: string; counterpartAccountId?: string | null;
}
export async function createMovement(db: Db, actor: ProvisionActor, provisionId: string, input: MovementInput) {
  date(input.movementDate);
  const provision = await provisionRow(db, actor.companyId, provisionId);
  if (['REVERSED', 'CLOSED'].includes(provision.status)) throw conflict('PROVISION_CLOSED', 'This provision is closed');
  const amount = amt(input.amount);
  if (amount <= 0n) throw badRequest('PROVISION_AMOUNT_INVALID', 'The amount must be positive');
  if (!input.reason?.trim() || !input.documentRef?.trim()) throw badRequest('PROVISION_EVIDENCE_REQUIRED', 'A reason and a supporting document are required');
  if (input.movementType === 'recognition' && provision.status !== 'DRAFT') throw conflict('PROVISION_RECOGNITION_EXISTS', 'Recognition has already been proposed');
  if (input.movementType === 'recognition' && (await movements(db, actor.companyId, provisionId)).some((m) => m.movement_type === 'recognition')) {
    throw conflict('PROVISION_RECOGNITION_EXISTS', 'A recognition movement already exists');
  }
  const direction = input.movementType === 'recognition' ? 'increase'
    : input.movementType === 'utilisation' || input.movementType === 'reversal' ? 'decrease'
      : input.direction ?? 'increase';
  const posted = (await movements(db, actor.companyId, provisionId)).filter((m) => m.status === 'POSTED');
  const carrying = posted.reduce((s, m) => s + signed(m), 0n);
  if (direction === 'decrease' && amount > carrying) throw conflict('PROVISION_EXCEEDS_CARRYING', 'The decrease exceeds the provision carrying amount');
  const journal = await db.query<any>('SELECT id FROM journals WHERE id=$1 AND company_id=$2 AND is_active', [input.journalId, actor.companyId]);
  if (!journal.rows[0]) throw badRequest('JOURNAL_NOT_FOUND', 'Journal is unknown or inactive');
  const counterpart = input.counterpartAccountId ? await account(db, actor.companyId, input.counterpartAccountId, 'Counterpart account', ['asset', 'liability', 'expense', 'revenue', 'equity']) : null;
  if (input.movementType === 'utilisation' && !counterpart) throw badRequest('PROVISION_COUNTERPART_REQUIRED', 'A counterpart account is required for utilisation');
  const cabinet = await cabinetIdOf(db, actor.companyId);
  const movementNo = await nextNo(db, actor.companyId, 'provision_movements', 'movement_no', 'PM', input.movementDate.slice(0, 4));
  const res = await db.query<any>(
    `INSERT INTO provision_movements (cabinet_id, company_id, provision_id, movement_no, movement_type,
       movement_date, amount, direction, reason, document_ref, journal_id, counterpart_account_id, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
    [cabinet, actor.companyId, provisionId, movementNo, input.movementType, input.movementDate,
      fmt(amount), direction, input.reason.trim(), input.documentRef.trim(), journal.rows[0].id,
      counterpart?.id ?? null, actor.userId]);
  await audit(db, actor, 'provision.movement.create', provisionId, { movementNo, type: input.movementType, amount: fmt(amount) });
  return { provision: await getProvision(db, actor.companyId, provisionId), movementId: res.rows[0].id };
}

async function movementRow(db: Db, companyId: string, id: string) {
  const res = await db.query<any>(
    `SELECT m.*, p.description, p.status AS provision_status, p.expense_account_id, p.provision_account_id
       FROM provision_movements m JOIN provisions p ON p.id=m.provision_id
      WHERE m.id=$1 AND m.company_id=$2`, [id, companyId]);
  if (!res.rows[0]) throw notFound('PROVISION_MOVEMENT_NOT_FOUND', 'Provision movement not found');
  return res.rows[0];
}
export async function approveMovement(db: Db, actor: ProvisionActor, id: string, input: { confirm: boolean; note: string }) {
  const note = requireDecision(input.confirm, input.note);
  const row = await movementRow(db, actor.companyId, id);
  if (row.status !== 'PROPOSED') throw conflict('PROVISION_MOVEMENT_DECIDED', 'This movement has already been decided');
  await db.query(`UPDATE provision_movements SET status='APPROVED', approval_note=$3, approved_by=$4, approved_at=now()
    WHERE id=$1 AND company_id=$2`, [id, actor.companyId, note, actor.userId]);
  await audit(db, actor, 'provision.movement.approve', row.provision_id, { movementId: id, note });
  return getProvision(db, actor.companyId, row.provision_id);
}
export async function rejectMovement(db: Db, actor: ProvisionActor, id: string, reason: string) {
  const row = await movementRow(db, actor.companyId, id);
  if (row.status !== 'PROPOSED') throw conflict('PROVISION_MOVEMENT_DECIDED', 'This movement has already been decided');
  await db.query(`UPDATE provision_movements SET status='REJECTED', rejection_reason=$3 WHERE id=$1 AND company_id=$2`,
    [id, actor.companyId, String(reason ?? '').trim() || null]);
  await audit(db, actor, 'provision.movement.reject', row.provision_id, { movementId: id });
  return getProvision(db, actor.companyId, row.provision_id);
}
export async function postMovement(db: Db, actor: ProvisionActor, id: string) {
  const provisionId = await db.transaction(async (tx) => {
    const row = await movementRow(tx, actor.companyId, id);
    if (row.status !== 'APPROVED') throw conflict('PROVISION_MOVEMENT_NOT_APPROVED', 'The movement must be approved before posting');
    await assertOpenPeriod(tx, actor.companyId, row.movement_date);
    const amount = amt(row.amount);
    const lines = [];
    if (row.movement_type === 'recognition' || (row.movement_type === 'revision' && row.direction === 'increase')) {
      lines.push({ accountId: row.expense_account_id, description: row.reason, debit: fmt(amount) });
      lines.push({ accountId: row.provision_account_id, description: row.reason, credit: fmt(amount) });
    } else if (row.movement_type === 'utilisation') {
      lines.push({ accountId: row.provision_account_id, description: row.reason, debit: fmt(amount) });
      lines.push({ accountId: row.counterpart_account_id, description: row.reason, credit: fmt(amount) });
    } else {
      lines.push({ accountId: row.provision_account_id, description: row.reason, debit: fmt(amount) });
      lines.push({ accountId: row.expense_account_id, description: row.reason, credit: fmt(amount) });
    }
    const posted = await postEntryTx(tx, {
      companyId: actor.companyId, userId: actor.userId, journalId: row.journal_id,
      entryDate: row.movement_date, reference: row.movement_no,
      description: `Provision ${row.movement_type} ${row.movement_no}`, lines, source: 'provision',
    });
    await tx.query(`UPDATE provision_movements SET status='POSTED', entry_id=$3, posted_at=now() WHERE id=$1 AND company_id=$2`,
      [id, actor.companyId, posted.entry.id]);
    if (row.movement_type === 'recognition') {
      await tx.query(`UPDATE provisions SET status='ACTIVE', updated_at=now() WHERE id=$1 AND company_id=$2`, [row.provision_id, actor.companyId]);
    }
    const all = await movements(tx, actor.companyId, row.provision_id);
    const carrying = all.filter((m) => m.status === 'POSTED').reduce((s, m) => s + signed(m), 0n);
    if (carrying === 0n && row.movement_type === 'reversal') {
      await tx.query(`UPDATE provisions SET status='REVERSED', updated_at=now() WHERE id=$1 AND company_id=$2`, [row.provision_id, actor.companyId]);
    }
    await audit(tx, actor, 'provision.movement.post', row.provision_id, { movementId: id, entryNo: posted.entry.entry_no });
    return row.provision_id;
  });
  return { provision: await getProvision(db, actor.companyId, provisionId) };
}

export async function movementReport(db: Db, companyId: string, from: string, to: string) {
  date(from); date(to);
  if (from > to) throw badRequest('PROVISION_DATES_INVALID', 'The start date must be before the end date');
  const rows = await db.query<any>(
    `SELECT m.*, p.provision_no, p.category, p.description, p.status AS provision_status, e.entry_no
       FROM provision_movements m JOIN provisions p ON p.id=m.provision_id
       LEFT JOIN journal_entries e ON e.id=m.entry_id
      WHERE m.company_id=$1 AND m.movement_date BETWEEN $2 AND $3
      ORDER BY m.movement_date, m.movement_no`, [companyId, from, to]);
  return { from, to, movements: rows.rows.map((m) => ({ ...movementView(m), provisionNo: m.provision_no,
    category: m.category, provisionDescription: m.description, provisionStatus: m.provision_status })) };
}
export async function reconciliationReport(db: Db, companyId: string, asOf: string) {
  date(asOf);
  const provisions = await provisionsWithTotals(db, companyId);
  const accounts = new Map<string, any>();
  for (const p of provisions) accounts.set(p.provisionAccountId, p.provisionAccount);
  const rows = [];
  for (const [accountId, accountRow] of accounts) {
    const asOfCarrying = await db.query<any>(
      `SELECT COALESCE(SUM(CASE WHEN m.direction='increase' THEN m.amount ELSE -m.amount END),0)::text AS carrying
         FROM provision_movements m JOIN provisions p ON p.id=m.provision_id
        WHERE m.company_id=$1 AND p.provision_account_id=$2 AND m.status='POSTED' AND m.movement_date <= $3`,
      [companyId, accountId, asOf]);
    const carrying = amt(asOfCarrying.rows[0]?.carrying);
    // Scope to entries generated by the provision register, so a liability
    // account shared with another register is not compared with the wrong side.
    const gl = await db.query<any>(`SELECT COALESCE(SUM(l.debit-l.credit),0)::text AS balance
      FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id
      WHERE l.company_id=$1 AND l.account_id=$2 AND e.status='posted' AND e.source='provision' AND e.entry_date <= $3`, [companyId, accountId, asOf]);
    const ledger = amt(gl.rows[0]?.balance);
    const expected = -carrying;
    rows.push({ account: accountRow, carrying: fmt(carrying), ledgerBalance: fmt(ledger),
      difference: fmt(expected - ledger), balanced: expected === ledger });
  }
  return { asOf, rows, balanced: rows.every((r) => r.balanced),
    note: 'The register carrying amount is compared with posted provision entries in its liability account. Amounts posted outside the register remain visible and are never adjusted automatically.' };
}
async function provisionsWithTotals(db: Db, companyId: string) {
  return listProvisions(db, companyId);
}
export async function provisionCheck(db: Db, companyId: string, asOf: string) {
  const list = await provisionsWithTotals(db, companyId);
  return {
    active: list.filter((p) => p.status === 'ACTIVE').length,
    pendingMovements: list.reduce((s, p) => s + p.pendingMovements, 0),
    missingEvidence: list.filter((p) => !String(p.evidenceRef ?? '').trim()).length,
    reconciliation: await reconciliationReport(db, companyId, asOf),
  };
}
