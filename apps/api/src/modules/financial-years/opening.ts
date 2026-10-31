/**
 * Mission 21 — opening balances and carry-forward.
 *
 * The suite posts a single continuous ledger: the opening balance of a period
 * is the sum of the posted lines dated before its start. No duplicate opening
 * entry is created by the ordinary carry-forward. The external opening batch is
 * deliberately restricted to an initial migration where no posted entry exists
 * before the destination period.
 */
import { createHash } from 'node:crypto';
import type { Db } from '../../db/index.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { formatAmount, parseAmount } from '../../lib/money.js';
import { assertOpenPeriod, insertLines, loadAccounts, loadJournal, nextEntryNo, prepareEntry } from '../entries/service.js';
import { computeTrialBalance } from '../reports/service.js';
import { writeAudit } from '../../lib/audit.js';
import type { Check, FinancialYearActor } from './types.js';

const ISO = /^\d{4}-\d{2}-\d{2}$/;
function rowAmount(value: unknown): bigint {
  try { return parseAmount(String(value ?? '0')); } catch { return 0n; }
}
async function companyRow(db: Db, companyIdValue: string): Promise<{ cabinet_id: string; functional_currency: string }> {
  const res = await db.query<any>('SELECT cabinet_id, functional_currency FROM companies WHERE id = $1', [companyIdValue]);
  if (!res.rows[0]) throw notFound('COMPANY_NOT_FOUND', 'Company not found');
  return res.rows[0];
}
async function audit(db: Db, actor: FinancialYearActor, action: string, entityId: string | null, details: Record<string, unknown> = {}) {
  await writeAudit(db, { companyId: actor.companyId, userId: actor.userId, entityType: 'financial_year', entityId: entityId ?? undefined, action, details, ip: actor.ip ?? null });
}

export interface OpeningLineInput {
  accountId: string; debit?: string | number | null; credit?: string | number | null; description?: string | null;
}
interface NormalisedLine { accountId: string; debit: bigint; credit: bigint; description: string | null; }
function normaliseLines(raw: OpeningLineInput[]): NormalisedLine[] {
  if (!Array.isArray(raw) || raw.length < 2) throw badRequest('OPENING_LINES_REQUIRED', 'At least two opening lines are required');
  if (raw.length > 200) throw badRequest('VALIDATION_ERROR', 'Too many opening lines (max 200)');
  const seen = new Set<string>();
  return raw.map((line, index) => {
    if (!line || typeof line.accountId !== 'string') throw badRequest('VALIDATION_ERROR', `Line ${index + 1}: account is required`);
    if (seen.has(line.accountId)) throw badRequest('OPENING_DUPLICATE_ACCOUNT', `Line ${index + 1}: an account may appear only once`);
    seen.add(line.accountId);
    const debit = rowAmount(line.debit);
    const credit = rowAmount(line.credit);
    if (debit < 0n || credit < 0n) throw badRequest('VALIDATION_ERROR', `Line ${index + 1}: amounts must be positive`);
    if ((debit > 0n) === (credit > 0n)) throw badRequest('VALIDATION_ERROR', `Line ${index + 1}: exactly one of debit or credit must be positive`);
    return { accountId: line.accountId, debit, credit, description: line.description ? String(line.description).trim().slice(0, 500) : null };
  });
}

export async function validateOpeningLines(db: Db, companyIdValue: string, raw: OpeningLineInput[]) {
  const lines = normaliseLines(raw);
  const ids = lines.map((l) => l.accountId);
  const res = await db.query<any>('SELECT id, code, name, type, is_active FROM accounts WHERE company_id = $1 AND id = ANY($2::uuid[])', [companyIdValue, ids]);
  if (res.rows.length !== ids.length) throw badRequest('ACCOUNT_NOT_FOUND', 'An opening account does not belong to this company');
  const byId = new Map<string, any>(res.rows.map((r: any) => [r.id, r]));
  let debitTotal = 0n;
  let creditTotal = 0n;
  const blocks: Check[] = [];
  for (const line of lines) {
    const account = byId.get(line.accountId)!;
    if (!account.is_active) blocks.push({ code: 'OPENING_ACCOUNT_INACTIVE', severity: 'block', messageEn: `Account ${account.code} is inactive.`, messageFr: `Le compte ${account.code} est inactif.` });
    if (account.type === 'revenue' || account.type === 'expense') {
      blocks.push({ code: 'OPENING_PROFIT_LOSS_ACCOUNT', severity: 'block', messageEn: `Account ${account.code} is a profit or loss account: it cannot be used as an ordinary opening balance.`, messageFr: `Le compte ${account.code} est un compte de résultat : il ne peut pas être utilisé comme solde d’ouverture ordinaire.` });
    }
    debitTotal += line.debit;
    creditTotal += line.credit;
  }
  if (debitTotal !== creditTotal) blocks.push({ code: 'OPENING_UNBALANCED', severity: 'block', messageEn: 'Opening debit and credit totals must be equal.', messageFr: 'Les totaux débit et crédit d’ouverture doivent être égaux.' });
  const fingerprint = createHash('sha256').update(JSON.stringify(lines.map((l) => [l.accountId, l.debit.toString(), l.credit.toString()]))).digest('hex').slice(0, 32);
  return {
    lines: lines.map((l) => ({ accountId: l.accountId, debit: formatAmount(l.debit), credit: formatAmount(l.credit), description: l.description, account: { id: l.accountId, code: byId.get(l.accountId)!.code, name: byId.get(l.accountId)!.name, type: byId.get(l.accountId)!.type } })),
    totals: { debit: formatAmount(debitTotal), credit: formatAmount(creditTotal), difference: formatAmount(debitTotal - creditTotal) },
    blocks, balanced: debitTotal === creditTotal && debitTotal > 0n, fingerprint,
  };
}

function differenceFlag(sourceDebit: bigint, sourceCredit: bigint, openDebit: bigint, openCredit: bigint) {
  const net = (sourceDebit - sourceCredit) - (openDebit - openCredit);
  return {
    differenceDebit: net < 0n ? formatAmount(-net) : '0.0000',
    differenceCredit: net > 0n ? formatAmount(net) : '0.0000',
    differs: net !== 0n,
  };
}

export async function previewOpening(db: Db, companyIdValue: string, periodId: string, raw?: OpeningLineInput[]) {
  const company = await companyRow(db, companyIdValue);
  const periodRes = await db.query<any>('SELECT * FROM accounting_periods WHERE id = $1 AND company_id = $2', [periodId, companyIdValue]);
  const period = periodRes.rows[0];
  if (!period) throw notFound('PERIOD_NOT_FOUND', 'Accounting period not found');
  const previousRes = await db.query<any>(
    `SELECT * FROM accounting_periods WHERE company_id = $1 AND end_date < $2 ORDER BY end_date DESC LIMIT 1`,
    [companyIdValue, period.start_date],
  );
  const previous = previousRes.rows[0] ?? null;
  const current = await computeTrialBalance(db, companyIdValue, company.functional_currency, { from: period.start_date, to: period.end_date });
  const prior = previous
    ? await computeTrialBalance(db, companyIdValue, company.functional_currency, { from: previous.start_date, to: previous.end_date })
    : null;
  const priorByAccount = new Map<string, any>((prior?.rows ?? []).map((r: any) => [r.accountId, r]));
  const rows: any[] = current.rows.map((r: any) => {
    const before: any = priorByAccount.get(r.accountId);
    const sourceDebit = before ? rowAmount(before.closingDebit) : 0n;
    const sourceCredit = before ? rowAmount(before.closingCredit) : 0n;
    const openDebit = rowAmount(r.openingDebit);
    const openCredit = rowAmount(r.openingCredit);
    const diff = differenceFlag(sourceDebit, sourceCredit, openDebit, openCredit);
    return {
      accountId: r.accountId, code: r.code, name: r.name, type: r.type,
      eligible: r.type !== 'revenue' && r.type !== 'expense',
      sourceClosingDebit: formatAmount(sourceDebit), sourceClosingCredit: formatAmount(sourceCredit),
      openingDebit: formatAmount(openDebit), openingCredit: formatAmount(openCredit),
      differenceDebit: diff.differenceDebit, differenceCredit: diff.differenceCredit, differs: diff.differs,
    };
  });
  for (const before of prior?.rows ?? []) {
    if (rows.some((r) => r.accountId === before.accountId)) continue;
    const sourceDebit = rowAmount(before.closingDebit);
    const sourceCredit = rowAmount(before.closingCredit);
    const diff = differenceFlag(sourceDebit, sourceCredit, 0n, 0n);
    rows.push({
      accountId: before.accountId, code: before.code, name: before.name, type: before.type,
      eligible: before.type !== 'revenue' && before.type !== 'expense',
      sourceClosingDebit: formatAmount(sourceDebit), sourceClosingCredit: formatAmount(sourceCredit),
      openingDebit: '0.0000', openingCredit: '0.0000',
      differenceDebit: diff.differenceDebit, differenceCredit: diff.differenceCredit, differs: diff.differs,
    });
  }
  rows.sort((a, b) => String(a.code).localeCompare(String(b.code)));
  const totals = {
    openingDebit: formatAmount(rows.reduce((s, r) => s + rowAmount(r.openingDebit), 0n)),
    openingCredit: formatAmount(rows.reduce((s, r) => s + rowAmount(r.openingCredit), 0n)),
    sourceDebit: formatAmount(rows.reduce((s, r) => s + rowAmount(r.sourceClosingDebit), 0n)),
    sourceCredit: formatAmount(rows.reduce((s, r) => s + rowAmount(r.sourceClosingCredit), 0n)),
  };
  const pnlOpening = rows.filter((r) => !r.eligible && (rowAmount(r.openingDebit) !== 0n || rowAmount(r.openingCredit) !== 0n));
  const diffs = rows.filter((r) => r.differs);
  const checks: Check[] = [
    rowAmount(totals.openingDebit) === rowAmount(totals.openingCredit)
      ? { code: 'OPENING_BALANCED', severity: 'ok', messageEn: 'Opening debit and credit totals are equal.', messageFr: 'Les totaux débit et crédit d’ouverture sont égaux.' }
      : { code: 'OPENING_UNBALANCED', severity: 'block', messageEn: 'Opening debit and credit totals differ.', messageFr: 'Les totaux débit et crédit d’ouverture diffèrent.' },
  ];
  if (pnlOpening.length === 0) {
    checks.push({ code: 'NO_PNL_OPENING', severity: 'ok', messageEn: 'No profit or loss account has an ordinary opening balance.', messageFr: 'Aucun compte de résultat ne porte de solde d’ouverture ordinaire.' });
  } else if (previous && previous.status !== 'closed') {
    // The preceding year is still open: its profit-or-loss balances are
    // current-year accumulations, not an opening balance to close.
    checks.push({ code: 'PNL_OPENING_PENDING_CLOSE', severity: 'warning', messageEn: `${pnlOpening.length} profit or loss account(s) carry current-year balances because the preceding period is not closed yet.`, messageFr: `${pnlOpening.length} compte(s) de résultat portent des soldes de l’exercice en cours car la période précédente n’est pas encore clôturée.` });
  } else {
    checks.push({ code: 'PNL_OPENING_PRESENT', severity: 'block', messageEn: `${pnlOpening.length} profit or loss account(s) carry an opening balance after a closed period.`, messageFr: `${pnlOpening.length} compte(s) de résultat portent un solde d’ouverture après une période clôturée.` });
  }
  if (previous) {
    checks.push(diffs.length === 0
      ? { code: 'CARRY_FORWARD_CONTINUOUS', severity: 'ok', messageEn: 'Opening balances equal the preceding period closing balances.', messageFr: 'Les soldes d’ouverture égalent les soldes de clôture de la période précédente.' }
      : { code: 'CARRY_FORWARD_GAP', severity: 'block', messageEn: `${diffs.length} account(s) differ from the preceding closing balance.`, messageFr: `${diffs.length} compte(s) diffèrent du solde de clôture précédent.` });
  } else {
    checks.push({ code: 'CARRY_FORWARD_FIRST_PERIOD', severity: 'warning', messageEn: 'No preceding period: continuity cannot be compared.', messageFr: 'Aucune période précédente : la continuité ne peut pas être comparée.' });
  }
  const openingBatch = await db.query<any>(`SELECT id, reference, source_reference, status, entry_id FROM opening_balance_batches WHERE company_id = $1 AND period_id = $2`, [companyIdValue, periodId]);
  const asOf = previous?.end_date ?? period.start_date;
  const customer = await db.query<any>(`SELECT count(*)::int AS count, COALESCE(SUM(total_amount),0)::text AS total FROM billing_documents WHERE company_id = $1 AND kind = 'invoice' AND status = 'issued' AND issue_date <= $2`, [companyIdValue, asOf]);
  const supplier = await db.query<any>(`SELECT count(*)::int AS count, COALESCE(SUM(GREATEST(total_amount - amount_paid - credited_amount, 0)),0)::text AS total FROM purchase_documents WHERE company_id = $1 AND status = 'validated' AND payment_status <> 'paid' AND issue_date <= $2`, [companyIdValue, asOf]);
  const bank = await db.query<any>(`SELECT count(*) FILTER (WHERE status IN ('unmatched','proposed','review'))::int AS outstanding, count(*)::int AS total FROM bank_transactions WHERE company_id = $1 AND txn_date <= $2`, [companyIdValue, asOf]);
  const assets = await db.query<any>(`SELECT count(*)::int AS count, COALESCE(SUM(CASE WHEN status NOT IN ('disposed','written_off') THEN cost + attributable_costs ELSE 0 END),0)::text AS gross FROM fixed_assets WHERE company_id = $1 AND acquisition_date <= $2`, [companyIdValue, asOf]);
  const equityAccounts = rows.filter((r) => r.type === 'equity');
  const external = raw ? await validateOpeningLines(db, companyIdValue, raw) : null;
  return {
    period: { id: period.id, name: period.name, startDate: period.start_date, endDate: period.end_date, status: period.status },
    previousPeriod: previous ? { id: previous.id, name: previous.name, startDate: previous.start_date, endDate: previous.end_date, status: previous.status } : null,
    method: 'continuous_ledger',
    noteEn: 'The ledger is continuous: the opening balance is the sum of posted lines before the period start. No duplicate opening entry is created.',
    noteFr: 'Le grand livre est continu : le solde d’ouverture est la somme des lignes comptabilisées avant le début de la période. Aucune écriture d’ouverture en double n’est créée.',
    rows, totals, checks,
    balanced: rowAmount(totals.openingDebit) === rowAmount(totals.openingCredit),
    continuity: previous ? diffs.length === 0 : null,
    differences: diffs,
    profitAndLossOpening: pnlOpening,
    preserved: {
      customerOpenItems: { count: Number(customer.rows[0]?.count ?? 0), total: String(customer.rows[0]?.total ?? '0.0000'), note: 'Open customer invoices are preserved through their receivable account balances and document records.' },
      supplierOpenItems: { count: Number(supplier.rows[0]?.count ?? 0), total: String(supplier.rows[0]?.total ?? '0.0000'), note: 'Open supplier documents are preserved; no separate opening subledger is created.' },
      bankUnreconciled: { count: Number(bank.rows[0]?.outstanding ?? 0), totalTransactions: Number(bank.rows[0]?.total ?? 0) },
      fixedAssets: { count: Number(assets.rows[0]?.count ?? 0), grossCost: String(assets.rows[0]?.gross ?? '0.0000'), note: 'Fixed-asset costs and accumulated depreciation continue through their posted balances and batches.' },
      partnerBalances: { accounts: equityAccounts.map((r) => ({ code: r.code, name: r.name, openingDebit: r.openingDebit, openingCredit: r.openingCredit })), note: 'No partner-level subledger exists yet; equity account balances continue without duplication.' },
      loans: { status: 'UNAVAILABLE', note: 'No loan module exists; any loan balance continues only through its general-ledger account.' },
    },
    externalBatch: openingBatch.rows[0] ?? null,
    externalPreview: external,
  };
}

const batchSelect = `
  SELECT b.*, p.name AS period_name, p.start_date, p.end_date, p.status AS period_status,
         j.code AS journal_code, j.name AS journal_name, e.entry_no,
         cu.full_name AS created_by_name, au.full_name AS approved_by_name
    FROM opening_balance_batches b
    JOIN accounting_periods p ON p.id = b.period_id
    JOIN journals j ON j.id = b.journal_id
    LEFT JOIN journal_entries e ON e.id = b.entry_id
    LEFT JOIN app_users cu ON cu.id = b.created_by
    LEFT JOIN app_users au ON au.id = b.approved_by
`;
async function batchView(db: Db, companyIdValue: string, id: string) {
  const res = await db.query<any>(`${batchSelect} WHERE b.company_id = $1 AND b.id = $2`, [companyIdValue, id]);
  if (!res.rows[0]) throw notFound('OPENING_BATCH_NOT_FOUND', 'Opening balance batch not found');
  const row = res.rows[0];
  const lines = await db.query<any>(`SELECT l.*, a.code, a.name, a.type FROM opening_balance_lines l JOIN accounts a ON a.id = l.account_id WHERE l.batch_id = $1 AND l.company_id = $2 ORDER BY l.line_no`, [id, companyIdValue]);
  return {
    id: row.id, reference: row.reference, sourceReference: row.source_reference, status: row.status,
    period: { id: row.period_id, name: row.period_name, startDate: row.start_date, endDate: row.end_date, status: row.period_status },
    journal: { id: row.journal_id, code: row.journal_code, name: row.journal_name },
    totalDebit: formatAmount(rowAmount(row.total_debit)), totalCredit: formatAmount(rowAmount(row.total_credit)),
    notes: row.notes, sourceFingerprint: row.source_fingerprint, entryId: row.entry_id, entryNo: row.entry_no,
    createdByName: row.created_by_name, approvedByName: row.approved_by_name, approvedAt: row.approved_at,
    approvalNote: row.approval_note, postedAt: row.posted_at, createdAt: row.created_at, updatedAt: row.updated_at,
    lines: lines.rows.map((l: any) => ({ id: l.id, lineNo: l.line_no, accountId: l.account_id,
      account: { code: l.code, name: l.name, type: l.type }, description: l.description,
      debit: formatAmount(rowAmount(l.debit)), credit: formatAmount(rowAmount(l.credit)) })),
  };
}
export async function listOpeningBatches(db: Db, companyIdValue: string) {
  const res = await db.query<any>(`${batchSelect} WHERE b.company_id = $1 ORDER BY b.created_at DESC`, [companyIdValue]);
  return res.rows.map((row: any) => ({ id: row.id, reference: row.reference, sourceReference: row.source_reference,
    status: row.status, periodId: row.period_id, periodName: row.period_name,
    totalDebit: formatAmount(rowAmount(row.total_debit)), totalCredit: formatAmount(rowAmount(row.total_credit)),
    entryNo: row.entry_no, createdAt: row.created_at, postedAt: row.posted_at }));
}
export async function getOpeningBatch(db: Db, companyIdValue: string, id: string) { return batchView(db, companyIdValue, id); }

async function assertInitialPeriod(tx: Db, companyIdValue: string, startDate: string) {
  const existing = await tx.query<{ count: string }>(`SELECT count(*)::text AS count FROM journal_entries WHERE company_id = $1 AND entry_date < $2 AND status = 'posted'`, [companyIdValue, startDate]);
  if (Number(existing.rows[0]!.count) > 0) throw conflict('OPENING_ENTRIES_ALREADY_EXIST', 'An external opening batch is only allowed when no posted entry exists before the period start');
}

async function insertOpeningLines(tx: Db, companyIdValue: string, batchId: string, raw: OpeningLineInput[]) {
  const lines = normaliseLines(raw);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    await tx.query(`INSERT INTO opening_balance_lines (company_id, batch_id, line_no, account_id, debit, credit, description) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [companyIdValue, batchId, i + 1, line.accountId, formatAmount(line.debit), formatAmount(line.credit), line.description]);
  }
}

export async function createOpeningBatch(db: Db, actor: FinancialYearActor, input: {
  periodId: string; reference: string; sourceReference: string; journalId: string; notes?: string | null; lines: OpeningLineInput[];
}) {
  const company = await companyRow(db, actor.companyId);
  const periodRes = await db.query<any>('SELECT * FROM accounting_periods WHERE id = $1 AND company_id = $2', [input.periodId, actor.companyId]);
  const period = periodRes.rows[0];
  if (!period) throw notFound('PERIOD_NOT_FOUND', 'Accounting period not found');
  if (period.status === 'closed') throw conflict('PERIOD_CLOSED', 'The destination period is closed');
  const reference = String(input.reference ?? '').trim();
  const sourceReference = String(input.sourceReference ?? '').trim();
  if (reference.length < 2) throw badRequest('VALIDATION_ERROR', 'A batch reference is required');
  if (sourceReference.length < 2) throw badRequest('VALIDATION_ERROR', 'A source reference is required');
  await assertInitialPeriod(db, actor.companyId, period.start_date);
  const journal = await loadJournal(db, actor.companyId, input.journalId);
  if (!journal.is_active) throw badRequest('JOURNAL_INACTIVE', 'The journal is inactive');
  const v = await validateOpeningLines(db, actor.companyId, input.lines);
  if (v.blocks.length > 0) throw badRequest('OPENING_BLOCKED', 'The opening batch has blocking controls', { blocks: v.blocks });
  let id = '';
  await db.transaction(async (tx) => {
    const exists = await tx.query<any>('SELECT id FROM opening_balance_batches WHERE company_id = $1 AND period_id = $2', [actor.companyId, input.periodId]);
    if (exists.rows[0]) throw conflict('OPENING_BATCH_EXISTS', 'An opening batch already exists for this period');
    const res = await tx.query<any>(
      `INSERT INTO opening_balance_batches
        (cabinet_id, company_id, period_id, reference, source_reference, journal_id, status,
         total_debit, total_credit, notes, source_fingerprint, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,'DRAFT',$7,$8,$9,$10,$11) RETURNING id`,
      [company.cabinet_id, actor.companyId, input.periodId, reference, sourceReference, journal.id,
        v.totals.debit, v.totals.credit, input.notes ? String(input.notes).trim().slice(0, 2000) : null, v.fingerprint, actor.userId],
    );
    id = res.rows[0].id;
    await insertOpeningLines(tx, actor.companyId, id, input.lines);
    await audit(tx, actor, 'opening_batch.create', id, { reference, periodId: input.periodId, totalDebit: v.totals.debit, sourceReference });
  });
  return batchView(db, actor.companyId, id);
}

export async function updateOpeningBatch(db: Db, actor: FinancialYearActor, id: string, input: {
  reference: string; sourceReference: string; journalId: string; notes?: string | null; lines: OpeningLineInput[];
}) {
  const existing = await db.query<any>('SELECT * FROM opening_balance_batches WHERE company_id = $1 AND id = $2', [actor.companyId, id]);
  const row = existing.rows[0];
  if (!row) throw notFound('OPENING_BATCH_NOT_FOUND', 'Opening balance batch not found');
  if (row.status !== 'DRAFT') throw conflict('OPENING_BATCH_DRAFT_ONLY', 'Only a draft opening batch can be changed');
  const period = await db.query<any>('SELECT start_date FROM accounting_periods WHERE id = $1 AND company_id = $2', [row.period_id, actor.companyId]);
  await assertInitialPeriod(db, actor.companyId, period.rows[0]!.start_date);
  const journal = await loadJournal(db, actor.companyId, input.journalId);
  if (!journal.is_active) throw badRequest('JOURNAL_INACTIVE', 'The journal is inactive');
  const v = await validateOpeningLines(db, actor.companyId, input.lines);
  if (v.blocks.length > 0) throw badRequest('OPENING_BLOCKED', 'The opening batch has blocking controls', { blocks: v.blocks });
  await db.transaction(async (tx) => {
    await tx.query(`UPDATE opening_balance_batches SET reference=$2, source_reference=$3, journal_id=$4, notes=$5, total_debit=$6, total_credit=$7, source_fingerprint=$8, updated_at=now() WHERE id=$1`,
      [id, String(input.reference).trim(), String(input.sourceReference).trim(), journal.id,
        input.notes ? String(input.notes).trim().slice(0, 2000) : null, v.totals.debit, v.totals.credit, v.fingerprint]);
    await tx.query('DELETE FROM opening_balance_lines WHERE batch_id = $1 AND company_id = $2', [id, actor.companyId]);
    await insertOpeningLines(tx, actor.companyId, id, input.lines);
    await audit(tx, actor, 'opening_batch.update', id, { reference: String(input.reference).trim(), totalDebit: v.totals.debit });
  });
  return batchView(db, actor.companyId, id);
}

export async function deleteOpeningBatch(db: Db, actor: FinancialYearActor, id: string) {
  const res = await db.query<any>('SELECT status FROM opening_balance_batches WHERE company_id = $1 AND id = $2', [actor.companyId, id]);
  if (!res.rows[0]) throw notFound('OPENING_BATCH_NOT_FOUND', 'Opening balance batch not found');
  if (res.rows[0].status !== 'DRAFT') throw conflict('OPENING_BATCH_DRAFT_ONLY', 'Only a draft opening batch can be deleted');
  await db.transaction(async (tx) => {
    await tx.query('DELETE FROM opening_balance_batches WHERE id = $1 AND company_id = $2', [id, actor.companyId]);
    await audit(tx, actor, 'opening_batch.delete', id);
  });
  return { ok: true };
}

export async function approveOpeningBatch(db: Db, actor: FinancialYearActor, id: string, input: { confirm: boolean; note: string }) {
  if (!input.confirm || String(input.note ?? '').trim().length < 10) throw badRequest('FINANCIAL_YEAR_DECISION_REQUIRED', 'A confirmation and a note of at least 10 characters are required');
  await db.transaction(async (tx) => {
    const res = await tx.query<any>('SELECT * FROM opening_balance_batches WHERE company_id = $1 AND id = $2 FOR UPDATE', [actor.companyId, id]);
    const row = res.rows[0];
    if (!row) throw notFound('OPENING_BATCH_NOT_FOUND', 'Opening balance batch not found');
    if (row.status === 'POSTED') throw conflict('OPENING_BATCH_POSTED_IMMUTABLE', 'A posted opening batch is immutable');
    if (row.status === 'APPROVED') throw conflict('CONFLICT', 'This opening batch is already approved');
    if (row.status !== 'DRAFT') throw conflict('CONFLICT', 'Only a draft opening batch can be approved');
    const period = await tx.query<any>('SELECT start_date FROM accounting_periods WHERE id = $1', [row.period_id]);
    await assertInitialPeriod(tx, actor.companyId, period.rows[0].start_date);
    await tx.query(`UPDATE opening_balance_batches SET status='APPROVED', approved_by=$2, approved_at=now(), approval_note=$3, updated_at=now() WHERE id=$1`, [id, actor.userId, String(input.note).trim()]);
    await audit(tx, actor, 'opening_batch.approve', id, { note: String(input.note).trim() });
  });
  return batchView(db, actor.companyId, id);
}

export async function postOpeningBatch(db: Db, actor: FinancialYearActor, id: string) {
  const entry = await db.transaction(async (tx) => {
    const res = await tx.query<any>('SELECT * FROM opening_balance_batches WHERE company_id = $1 AND id = $2 FOR UPDATE', [actor.companyId, id]);
    const row = res.rows[0];
    if (!row) throw notFound('OPENING_BATCH_NOT_FOUND', 'Opening balance batch not found');
    if (row.status === 'POSTED') throw conflict('OPENING_BATCH_POSTED_IMMUTABLE', 'This opening batch is already posted');
    if (row.status !== 'APPROVED') throw conflict('OPENING_BATCH_NOT_APPROVED', 'The opening batch must be approved first');
    const period = await tx.query<any>('SELECT * FROM accounting_periods WHERE id = $1 AND company_id = $2', [row.period_id, actor.companyId]);
    const p = period.rows[0];
    if (!p) throw notFound('PERIOD_NOT_FOUND', 'Accounting period not found');
    if (p.status === 'closed') throw conflict('PERIOD_CLOSED', 'The destination period is closed');
    await assertOpenPeriod(tx, actor.companyId, p.start_date);
    await assertInitialPeriod(tx, actor.companyId, p.start_date);
    const lines = await tx.query<any>('SELECT * FROM opening_balance_lines WHERE batch_id = $1 AND company_id = $2 ORDER BY line_no', [id, actor.companyId]);
    if (!lines.rows.length) throw conflict('OPENING_LINES_REQUIRED', 'The opening batch has no lines');
    const totalDebit = lines.rows.reduce((s: bigint, l: any) => s + rowAmount(l.debit), 0n);
    const totalCredit = lines.rows.reduce((s: bigint, l: any) => s + rowAmount(l.credit), 0n);
    if (totalDebit !== totalCredit || totalDebit === 0n) throw conflict('OPENING_UNBALANCED', 'The opening batch is not exactly balanced');
    const journal = await loadJournal(tx, actor.companyId, row.journal_id);
    if (!journal.is_active) throw badRequest('JOURNAL_INACTIVE', 'The journal is inactive');
    const loaded = await loadAccounts(tx, actor.companyId, [...new Set<string>(lines.rows.map((l: any) => l.account_id))]);
    const prepared = prepareEntry({
      journalId: journal.id, entryDate: p.start_date, reference: row.reference,
      description: `Opening balances — ${row.source_reference}`, currency: 'MUR',
      lines: lines.rows.map((l: any) => ({ accountId: l.account_id, description: l.description ?? 'Opening balance', debit: rowAmount(l.debit) > 0n ? String(l.debit) : null, credit: rowAmount(l.credit) > 0n ? String(l.credit) : null })),
    }, 'MUR', loaded.all, loaded.active);
    if (!prepared.balanced) throw conflict('ENTRY_UNBALANCED', 'The opening entry is not balanced');
    const entryNo = await nextEntryNo(tx, actor.companyId, journal, p.start_date);
    const inserted = await tx.query<any>(
      `INSERT INTO journal_entries
        (company_id, journal_id, entry_no, entry_date, reference, description, currency,
         exchange_rate, status, source, created_by, posted_at, posted_by)
       VALUES ($1,$2,$3,$4,$5,$6,'MUR',1,'posted','opening',$7,now(),$7) RETURNING *`,
      [actor.companyId, journal.id, entryNo, p.start_date, row.reference, `Opening balances — ${row.source_reference}`, actor.userId],
    );
    await insertLines(tx, inserted.rows[0].id, actor.companyId, prepared);
    await tx.query(`UPDATE opening_balance_batches SET status='POSTED', entry_id=$2, posted_at=now(), updated_at=now() WHERE id=$1`, [id, inserted.rows[0].id]);
    await audit(tx, actor, 'opening_batch.post', id, { entryNo, reference: row.reference, totalDebit: formatAmount(totalDebit) });
    return inserted.rows[0];
  });
  return { batch: await batchView(db, actor.companyId, id), entry };
}
