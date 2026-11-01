/**
 * Mission 19 — browser demo for equity, annual closing and result allocation.
 *
 * Every figure and document reference is fictitious. The module reproduces the
 * controls of the real API (supporting document required, human approval before
 * posting, exact allocation of the result, locked posted records) but stores
 * everything in localStorage only. No Mauritian legal or tax rule is encoded:
 * accounts are picked from the demonstration chart.
 */
import { ApiError } from '../errors';
import { scaled4ToString, toScaled4 } from '../format';
import type { DemoAccount, DemoEntry, DemoJournal, DemoLine, DemoPeriod, DemoState } from './runtime';

export interface DemoEquityMovement {
  id: string;
  company_id: string;
  movement_no: string;
  movement_date: string;
  category: 'capital' | 'contribution' | 'reserve' | 'retained_earnings' | 'dividend' | 'adjustment';
  direction: 'increase' | 'decrease';
  amount: string;
  equity_account_id: string;
  counterpart_account_id: string;
  journal_id: string;
  description: string;
  document_ref: string;
  status: 'DRAFT' | 'APPROVED' | 'POSTED' | 'CANCELLED';
  approval_note: string | null;
  approved_at: string | null;
  entry_id: string | null;
  created_at: string;
}

export interface DemoFiscalClosing {
  id: string;
  company_id: string;
  source_period_id: string;
  source_start: string;
  source_end: string;
  version: number;
  journal_id: string;
  result_account_id: string;
  next_start_date: string;
  next_end_date: string;
  next_period_id: string | null;
  result_amount: string;
  status: 'DRAFT' | 'REVIEW_REQUIRED' | 'BLOCKED' | 'APPROVED' | 'REJECTED' | 'POSTED';
  checks: DemoCheck[];
  blockers: DemoCheck[];
  warnings: DemoCheck[];
  lines: { accountId: string; code: string; name: string; description: string; debit: string; credit: string }[];
  source_fingerprint: string;
  prepared_at: string;
  decision_note: string | null;
  decided_at: string | null;
  rejection_reason: string | null;
  closing_entry_id: string | null;
  posted_at: string | null;
}

export interface DemoEquityAllocation {
  id: string;
  company_id: string;
  closing_id: string;
  allocation_date: string;
  journal_id: string;
  document_ref: string;
  decision_date: string;
  note: string;
  result_amount: string;
  allocated_amount: string;
  status: 'DRAFT' | 'APPROVED' | 'POSTED' | 'REJECTED';
  approval_note: string | null;
  approved_at: string | null;
  entry_id: string | null;
  created_at: string;
}

export interface DemoEquityAllocationLine {
  id: string;
  company_id: string;
  allocation_id: string;
  line_no: number;
  nature: 'retained_earnings' | 'reserves' | 'dividends' | 'other';
  account_id: string;
  amount: string;
}

export interface DemoCheck {
  code: string;
  severity: 'ok' | 'warning' | 'block';
  scope: 'closing' | 'posting' | 'statement';
  messageEn: string;
  messageFr: string;
}

const uid = () => crypto.randomUUID();
const now = () => new Date().toISOString();
const fmt = (value: bigint) => scaled4ToString(value);
const amt = (value: unknown): bigint => toScaled4(value as string) ?? 0n;

function accountsOf(state: DemoState, companyId: string): DemoAccount[] {
  return state.accounts.filter((a) => a.company_id === companyId);
}
function accountByCode(state: DemoState, companyId: string, code: string): DemoAccount | undefined {
  return accountsOf(state, companyId).find((a) => a.code === code);
}
function journalByCode(state: DemoState, companyId: string, code: string): DemoJournal | undefined {
  return state.journals.find((j) => j.company_id === companyId && j.code === code);
}
function account(state: DemoState, companyId: string, id: string): DemoAccount {
  const found = accountsOf(state, companyId).find((a) => a.id === id);
  if (!found) throw new ApiError(404, 'ACCOUNT_NOT_FOUND', 'Compte introuvable dans cette société');
  return found;
}
function journal(state: DemoState, companyId: string, id: string): DemoJournal {
  const found = state.journals.find((j) => j.company_id === companyId && j.id === id);
  if (!found) throw new ApiError(404, 'JOURNAL_NOT_FOUND', 'Journal introuvable');
  return found;
}
function memberRole(state: DemoState, companyId: string): string {
  const user = state.users.find((u) => u.id === state.session);
  const member = state.members.find((m) => m.company_id === companyId && m.user_id === user?.id);
  if (!member) throw new ApiError(404, 'COMPANY_NOT_FOUND', 'Société introuvable');
  return member.role;
}
function requireWriter(state: DemoState, companyId: string) {
  const role = memberRole(state, companyId);
  if (!['owner', 'admin', 'accountant', 'manager', 'cabinet_admin'].includes(role)) {
    throw new ApiError(403, 'FORBIDDEN', 'Rôle comptable requis');
  }
}
function requireManager(state: DemoState, companyId: string) {
  const role = memberRole(state, companyId);
  if (!['owner', 'admin', 'manager', 'cabinet_admin'].includes(role)) {
    throw new ApiError(403, 'FORBIDDEN', 'Rôle manager requis pour une opération irréversible');
  }
}

/* --------------------------------------------------------------- entries */

function periodCovering(state: DemoState, companyId: string, date: string): DemoPeriod | undefined {
  return state.periods.find(
    (p) => p.company_id === companyId && p.start_date <= date && p.end_date >= date,
  );
}
function assertOpenPeriod(state: DemoState, companyId: string, date: string) {
  const period = periodCovering(state, companyId, date);
  if (!period || period.status === 'closed') {
    throw new ApiError(409, 'PERIOD_CLOSED', `La période comptable du ${date} est clôturée ou absente`);
  }
}
function nextEntryNo(state: DemoState, companyId: string, journalCode: string, date: string): string {
  const year = date.slice(0, 4);
  const key = `${journalCode}-${year}`;
  const next = (state.sequences[key] ?? 0) + 1;
  state.sequences[key] = next;
  return `${journalCode}-${year}-${String(next).padStart(4, '0')}`;
}

function pushEntry(
  state: DemoState,
  companyId: string,
  journalId: string,
  journalCode: string,
  date: string,
  description: string,
  source: DemoEntry['source'],
  reference: string | null,
  lines: { accountId: string; description: string; debit?: string; credit?: string }[],
): DemoEntry {
  const debit = lines.reduce((sum, l) => sum + amt(l.debit), 0n);
  const credit = lines.reduce((sum, l) => sum + amt(l.credit), 0n);
  if (debit !== credit) throw new ApiError(400, 'ENTRY_UNBALANCED', 'Écriture déséquilibrée');
  const entry: DemoEntry = {
    id: uid(),
    company_id: companyId,
    journal_id: journalId,
    entry_no: nextEntryNo(state, companyId, journalCode, date),
    entry_date: date,
    reference,
    description,
    currency: 'MUR',
    exchange_rate: '1.00000000',
    status: 'posted',
    source,
    reversal_of_entry_id: null,
    posted_at: now(),
    created_at: now(),
  };
  state.entries.push(entry);
  lines.forEach((line, index) => {
    const row: DemoLine = {
      id: uid(),
      entry_id: entry.id,
      company_id: companyId,
      account_id: line.accountId,
      line_no: index + 1,
      description: line.description,
      debit: fmt(amt(line.debit)),
      credit: fmt(amt(line.credit)),
      txn_amount: fmt(amt(line.debit)) !== '0.0000' ? fmt(amt(line.debit)) : fmt(amt(line.credit)),
      txn_currency: 'MUR',
      fx_rate: null,
    };
    state.lines.push(row);
  });
  return entry;
}

/* ------------------------------------------------------------------ seed */

/**
 * Adds two closed prior exercises, their closings, a documented allocation and
 * a draft equity movement. All amounts and references are invented.
 */
export function seedDemoEquity(state: DemoState): void {
  if (state.equityMovements) return;
  const company = state.companies[0]!;
  const companyId = company.id;
  const capital = accountByCode(state, companyId, '3000');
  const retained = accountByCode(state, companyId, '3100');
  const reserves = accountByCode(state, companyId, '3200');
  const revenue = accountByCode(state, companyId, '4000');
  const expense = accountByCode(state, companyId, '6100');
  const cashCode = accountByCode(state, companyId, '1010');
  const bank = accountByCode(state, companyId, '1100');
  const journal = journalByCode(state, companyId, 'OD');
  state.equitySequences = {};
  state.equityMovements = [];
  state.fiscalClosings = [];
  state.equityAllocations = [];
  state.equityAllocationLines = [];
  if (!capital || !retained || !reserves || !revenue || !expense || !bank || !journal) return;
  const cash = cashCode ?? bank;

  // Two closed exercises, only if the demonstration dataset does not have them.
  const ensurePeriod = (name: string, start: string, end: string) => {
    const existing = state.periods.find(
      (p) => p.company_id === companyId && p.start_date === start && p.end_date === end,
    );
    if (existing) return existing;
    const period: DemoPeriod = { id: uid(), company_id: companyId, name, start_date: start, end_date: end, status: 'closed' };
    state.periods.push(period);
    return period;
  };
  const lossYear = ensurePeriod('FY 2023/2024 (DEMO)', '2023-07-01', '2024-06-30');
  const profitYear = ensurePeriod('FY 2024/2025 (DEMO)', '2024-07-01', '2025-06-30');

  // 2023/2024 — fictitious loss of 15,000.
  pushEntry(state, companyId, journal.id, journal.code, '2023-08-10', 'Fictitious sales 2023/2024', 'manual', 'DEMO-2324-SAL', [
    { accountId: bank.id, description: 'Encaissement fictif', debit: '80000.0000' },
    { accountId: revenue.id, description: 'Produits fictifs', credit: '80000.0000' },
  ]);
  pushEntry(state, companyId, journal.id, journal.code, '2023-09-15', 'Fictitious expenses 2023/2024', 'manual', 'DEMO-2324-PUR', [
    { accountId: expense.id, description: 'Fictitious expenses', debit: '95000.0000' },
    { accountId: bank.id, description: 'Paiement fictif', credit: '95000.0000' },
  ]);
  const lossClosing = pushEntry(state, companyId, journal.id, journal.code, '2024-06-30', 'Fictitious closing 2023/2024', 'closing', 'CLOSE-2024-06-30', [
    { accountId: revenue.id, description: 'Solde des produits', debit: '80000.0000' },
    { accountId: expense.id, description: 'Solde des charges', credit: '95000.0000' },
    { accountId: retained.id, description: 'Perte de l’exercice fictive', debit: '15000.0000' },
  ]);

  // 2024/2025 — fictitious profit of 30,000, allocated by a fictional decision.
  pushEntry(state, companyId, journal.id, journal.code, '2024-08-12', 'Fictitious sales 2024/2025', 'manual', 'DEMO-2425-SAL', [
    { accountId: bank.id, description: 'Encaissement fictif', debit: '120000.0000' },
    { accountId: revenue.id, description: 'Produits fictifs', credit: '120000.0000' },
  ]);
  pushEntry(state, companyId, journal.id, journal.code, '2024-09-20', 'Fictitious expenses 2024/2025', 'manual', 'DEMO-2425-PUR', [
    { accountId: expense.id, description: 'Fictitious expenses', debit: '90000.0000' },
    { accountId: bank.id, description: 'Paiement fictif', credit: '90000.0000' },
  ]);
  const profitClosing = pushEntry(state, companyId, journal.id, journal.code, '2025-06-30', 'Fictitious closing 2024/2025', 'closing', 'CLOSE-2025-06-30', [
    { accountId: revenue.id, description: 'Solde des produits', debit: '120000.0000' },
    { accountId: expense.id, description: 'Solde des charges', credit: '90000.0000' },
    { accountId: retained.id, description: 'Résultat de l’exercice fictif', credit: '30000.0000' },
  ]);
  const allocationEntry = pushEntry(state, companyId, journal.id, journal.code, '2025-09-15', 'Fictitious allocation of the 2024/2025 result', 'equity_allocation', 'PV-AFF-2025-001', [
    { accountId: retained.id, description: 'Allocated result (fictitious)', debit: '30000.0000' },
    { accountId: reserves.id, description: 'Réserve fictive', credit: '10000.0000' },
    { accountId: retained.id, description: 'Report à nouveau fictif', credit: '20000.0000' },
  ]);

  const capitalEntry = pushEntry(state, companyId, journal.id, journal.code, '2023-07-05', 'Apport en capital fictif', 'equity', 'PV-2023-001', [
    { accountId: cash.id, description: 'Apport fictif', debit: '150000.0000' },
    { accountId: capital.id, description: 'Capital fictif', credit: '150000.0000' },
  ]);
  state.equityMovements.push({
    id: uid(),
    company_id: companyId,
    movement_no: 'EQ-2023-0001',
    movement_date: '2023-07-05',
    category: 'capital',
    direction: 'increase',
    amount: '150000.0000',
    equity_account_id: capital.id,
    counterpart_account_id: cash.id,
    journal_id: journal.id,
    description: 'Apport en capital fictif décidé en assemblée',
    document_ref: 'PV-2023-001',
    status: 'POSTED',
    approval_note: 'Approbation fictive de démonstration.',
    approved_at: now(),
    entry_id: capitalEntry.id,
    created_at: now(),
  });
  state.equityMovements.push({
    id: uid(),
    company_id: companyId,
    movement_no: 'EQ-2025-0001',
    movement_date: '2025-11-20',
    category: 'adjustment',
    direction: 'increase',
    amount: '2000.0000',
    equity_account_id: reserves.id,
    counterpart_account_id: retained.id,
    journal_id: journal.id,
    description: 'Ajustement fictif à faire approuver (brouillon de démonstration)',
    document_ref: 'PROJET-AJUST-2025-01',
    status: 'DRAFT',
    approval_note: null,
    approved_at: null,
    entry_id: null,
    created_at: now(),
  });

  state.fiscalClosings.push({
    id: uid(),
    company_id: companyId,
    source_period_id: lossYear.id,
    source_start: '2023-07-01',
    source_end: '2024-06-30',
    version: 1,
    journal_id: journal.id,
    result_account_id: retained.id,
    next_start_date: '2024-07-01',
    next_end_date: '2025-06-30',
    next_period_id: profitYear.id,
    result_amount: '-15000.0000',
    status: 'POSTED',
    checks: [],
    blockers: [],
    warnings: [],
    lines: [],
    source_fingerprint: 'demo-closing-2024',
    prepared_at: now(),
    decision_note: 'Clôture fictive approuvée pour illustrer un exercice déficitaire.',
    decided_at: now(),
    rejection_reason: null,
    closing_entry_id: lossClosing.id,
    posted_at: now(),
  });
  const allocationId = uid();
  state.fiscalClosings.push({
    id: uid(),
    company_id: companyId,
    source_period_id: profitYear.id,
    source_start: '2024-07-01',
    source_end: '2025-06-30',
    version: 1,
    journal_id: journal.id,
    result_account_id: retained.id,
    next_start_date: '2025-07-01',
    next_end_date: '2026-06-30',
    next_period_id: state.periods.find((p) => p.company_id === companyId && p.start_date === '2025-07-01')?.id ?? null,
    result_amount: '30000.0000',
    status: 'POSTED',
    checks: [],
    blockers: [],
    warnings: [],
    lines: [],
    source_fingerprint: 'demo-closing-2025',
    prepared_at: now(),
    decision_note: 'Clôture fictive approuvée ; affectation décidée par PV fictif.',
    decided_at: now(),
    rejection_reason: null,
    closing_entry_id: profitClosing.id,
    posted_at: now(),
  });
  state.equityAllocations.push({
    id: allocationId,
    company_id: companyId,
    closing_id: state.fiscalClosings[1]!.id,
    allocation_date: '2025-09-15',
    journal_id: journal.id,
    document_ref: 'PV-AFF-2025-001',
    decision_date: '2025-09-10',
    note: 'Affectation fictive : 10 000 en réserve et 20 000 en report à nouveau.',
    result_amount: '30000.0000',
    allocated_amount: '30000.0000',
    status: 'POSTED',
    approval_note: 'Approbation fictive de démonstration.',
    approved_at: now(),
    entry_id: allocationEntry.id,
    created_at: now(),
  });
  state.equityAllocationLines.push(
    {
      id: uid(),
      company_id: companyId,
      allocation_id: allocationId,
      line_no: 1,
      nature: 'reserves',
      account_id: reserves.id,
      amount: '10000.0000',
    },
    {
      id: uid(),
      company_id: companyId,
      allocation_id: allocationId,
      line_no: 2,
      nature: 'retained_earnings',
      account_id: retained.id,
      amount: '20000.0000',
    },
  );
}

/* ------------------------------------------------------------------ views */

function movementView(state: DemoState, companyId: string, movement: DemoEquityMovement) {
  const equity = account(state, companyId, movement.equity_account_id);
  const counterpart = account(state, companyId, movement.counterpart_account_id);
  const journalRow = state.journals.find((j) => j.id === movement.journal_id);
  const entry = state.entries.find((e) => e.id === movement.entry_id);
  return {
    id: movement.id,
    movementNo: movement.movement_no,
    movementDate: movement.movement_date,
    category: movement.category,
    direction: movement.direction,
    amount: movement.amount,
    equityAccount: { id: equity.id, code: equity.code, name: equity.name },
    counterpartAccount: { id: counterpart.id, code: counterpart.code, name: counterpart.name },
    journal: { id: journalRow?.id ?? '', code: journalRow?.code ?? '', name: journalRow?.name ?? '' },
    description: movement.description,
    documentRef: movement.document_ref,
    status: movement.status,
    approvedByName: movement.status === 'DRAFT' ? null : 'Utilisateur démo',
    approvedAt: movement.approved_at,
    approvalNote: movement.approval_note,
    entryId: movement.entry_id,
    entryNo: entry?.entry_no ?? null,
    createdByName: 'Utilisateur démo',
    createdAt: movement.created_at,
  };
}

function closingView(state: DemoState, closing: DemoFiscalClosing) {
  const period = state.periods.find((p) => p.id === closing.source_period_id);
  const journalRow = state.journals.find((j) => j.id === closing.journal_id);
  const resultAccount = account(state, closing.company_id, closing.result_account_id);
  const entry = state.entries.find((e) => e.id === closing.closing_entry_id);
  return {
    id: closing.id,
    sourcePeriodId: closing.source_period_id,
    sourcePeriodName: period?.name ?? '',
    sourceStart: closing.source_start,
    sourceEnd: closing.source_end,
    version: closing.version,
    journal: { id: journalRow?.id ?? '', code: journalRow?.code ?? '', name: journalRow?.name ?? '' },
    resultAccount: { id: resultAccount.id, code: resultAccount.code, name: resultAccount.name },
    nextStartDate: closing.next_start_date,
    nextEndDate: closing.next_end_date,
    nextPeriodId: closing.next_period_id,
    resultAmount: closing.result_amount,
    status: closing.status,
    checks: closing.checks,
    blockers: closing.blockers,
    warnings: closing.warnings,
    lines: closing.lines,
    sourceFingerprint: closing.source_fingerprint,
    preparedByName: 'Utilisateur démo',
    preparedAt: closing.prepared_at,
    decidedByName: closing.decided_at ? 'Utilisateur démo' : null,
    decidedAt: closing.decided_at,
    decisionNote: closing.decision_note,
    rejectionReason: closing.rejection_reason,
    closingEntryId: closing.closing_entry_id,
    closingEntryNo: entry?.entry_no ?? null,
    postedAt: closing.posted_at,
    createdAt: closing.prepared_at,
  };
}

function allocationView(state: DemoState, allocation: DemoEquityAllocation) {
  const journalRow = state.journals.find((j) => j.id === allocation.journal_id);
  const entry = state.entries.find((e) => e.id === allocation.entry_id);
  const lines = (state.equityAllocationLines ?? [])
    .filter((l) => l.allocation_id === allocation.id)
    .sort((a, b) => a.line_no - b.line_no)
    .map((l) => {
      const acc = account(state, allocation.company_id, l.account_id);
      return {
        id: l.id,
        lineNo: l.line_no,
        nature: l.nature,
        amount: l.amount,
        account: { id: acc.id, code: acc.code, name: acc.name, type: acc.type },
      };
    });
  const unallocated = (amt(allocation.result_amount) < 0n ? -amt(allocation.result_amount) : amt(allocation.result_amount)) - amt(allocation.allocated_amount);
  return {
    id: allocation.id,
    closingId: allocation.closing_id,
    allocationDate: allocation.allocation_date,
    journal: { id: journalRow?.id ?? '', code: journalRow?.code ?? '', name: journalRow?.name ?? '' },
    documentRef: allocation.document_ref,
    decisionDate: allocation.decision_date,
    note: allocation.note,
    resultAmount: allocation.result_amount,
    allocatedAmount: allocation.allocated_amount,
    unallocatedAmount: fmt(unallocated),
    status: allocation.status,
    approvedByName: allocation.approved_at ? 'Utilisateur démo' : null,
    approvedAt: allocation.approved_at,
    approvalNote: allocation.approval_note,
    entryId: allocation.entry_id,
    entryNo: entry?.entry_no ?? null,
    createdByName: 'Utilisateur démo',
    createdAt: allocation.created_at,
    lines,
  };
}

/* -------------------------------------------------------------- statement */

function postedLines(state: DemoState, companyId: string, to: string) {
  const entries = new Map(
    state.entries.filter((e) => e.company_id === companyId && e.status === 'posted').map((e) => [e.id, e]),
  );
  return state.lines
    .filter((l) => l.company_id === companyId)
    .map((line) => ({ line, entry: entries.get(line.entry_id) }))
    .filter((row): row is { line: DemoLine; entry: DemoEntry } => !!row.entry && row.entry.entry_date <= to);
}

function statement(state: DemoState, companyId: string, from: string, to: string) {
  const company = state.companies.find((c) => c.id === companyId);
  if (!company) throw new ApiError(404, 'COMPANY_NOT_FOUND', 'Société introuvable');
  const rows = accountsOf(state, companyId)
    .filter((a) => a.type === 'equity')
    .map((acc) => {
      let opening = 0n;
      let movement = 0n;
      let closing = 0n;
      for (const row of postedLines(state, companyId, to)) {
        if (row.line.account_id !== acc.id) continue;
        const net = -amt(row.line.debit) + amt(row.line.credit);
        if (row.entry.entry_date < from) opening += net;
        else if (row.entry.entry_date <= to) movement += net;
        closing += net;
      }
      return { acc, opening, movement, closing };
    })
    .filter((row) => row.opening !== 0n || row.movement !== 0n || row.closing !== 0n)
    .sort((a, b) => a.acc.code.localeCompare(b.acc.code))
    .map((row) => ({
      accountId: row.acc.id,
      code: row.acc.code,
      name: row.acc.name,
      opening: fmt(row.opening),
      increases: fmt(row.movement > 0n ? row.movement : 0n),
      decreases: fmt(row.movement < 0n ? -row.movement : 0n),
      movement: fmt(row.movement),
      closing: fmt(row.closing),
      trialBalanceClosing: fmt(row.closing),
      difference: '0.0000',
    }));
  const lastClose = (state.fiscalClosings ?? [])
    .filter((c) => c.company_id === companyId && c.status === 'POSTED' && c.source_end <= to)
    .sort((a, b) => b.source_end.localeCompare(a.source_end))[0];
  const pnlFrom = lastClose ? lastClose.source_end : '1900-01-01';
  let periodResult = 0n;
  let assets = 0n;
  let liabilities = 0n;
  let equityAccounts = 0n;
  for (const row of postedLines(state, companyId, to)) {
    const acc = state.accounts.find((a) => a.id === row.line.account_id);
    if (!acc) continue;
    const debit = amt(row.line.debit);
    const credit = amt(row.line.credit);
    if (acc.type === 'asset') assets += debit - credit;
    else if (acc.type === 'liability') liabilities += credit - debit;
    else if (acc.type === 'equity') equityAccounts += credit - debit;
    else if (row.entry.source !== 'closing' && row.entry.entry_date > pnlFrom) {
      periodResult += acc.type === 'revenue' ? credit - debit : -(debit - credit);
    }
  }
  const closingTotal = rows.reduce((sum, r) => sum + amt(r.closing), 0n);
  const difference = assets - liabilities - equityAccounts - periodResult;
  return {
    from,
    to,
    currency: company.functional_currency,
    rows,
    unappropriatedResult: fmt(periodResult),
    totals: {
      opening: fmt(rows.reduce((sum, r) => sum + amt(r.opening), 0n)),
      increases: fmt(rows.reduce((sum, r) => sum + amt(r.increases), 0n)),
      decreases: fmt(rows.reduce((sum, r) => sum + amt(r.decreases), 0n)),
      closing: fmt(closingTotal),
      result: fmt(periodResult),
      equityWithResult: fmt(closingTotal + periodResult),
    },
    reconciliation: {
      assets: fmt(assets),
      liabilities: fmt(liabilities),
      equityAccounts: fmt(equityAccounts),
      unappropriatedResult: fmt(periodResult),
      difference: fmt(difference),
      balanced: difference === 0n,
      trialBalanceBalanced: difference === 0n,
    },
    closedThrough: lastClose?.source_end ?? null,
    note: 'Statement prepared from posted entries. No dividend, reserve percentage or tax rule is inferred.',
    noteFr: 'État préparé depuis les écritures comptabilisées. Aucun dividende, pourcentage de réserve ou règle fiscale n’est déduit.',
    demo: true,
  };
}

/* --------------------------------------------------------------- closing */

function hash(value: unknown): string {
  const text = JSON.stringify(value);
  let h = 5381;
  for (let i = 0; i < text.length; i += 1) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0;
  return `demo-${h.toString(16)}`;
}

function buildPreview(
  state: DemoState,
  companyId: string,
  period: DemoPeriod,
  journalId: string,
  resultAccountId: string,
  nextStartDate: string,
  nextEndDate: string,
) {
  const journalRow = journal(state, companyId, journalId);
  const resultAccount = account(state, companyId, resultAccountId);
  const checks: DemoCheck[] = [];
  const push = (severity: DemoCheck['severity'], code: string, fr: string, en: string) =>
    checks.push({ code, severity, scope: 'closing', messageFr: fr, messageEn: en });
  if (period.status === 'closed') push('block', 'SOURCE_PERIOD_CLOSED', 'La période source est déjà clôturée.', 'The source period is already closed.');
  else push('ok', 'SOURCE_PERIOD_OPEN', 'La période source est ouverte.', 'The source period is open.');
  if (resultAccount.type !== 'equity') push('block', 'RESULT_ACCOUNT_NOT_EQUITY', 'Le compte de résultat doit être un compte de capitaux propres.', 'The result account must be an equity account.');
  else push('ok', 'RESULT_ACCOUNT_EQUITY', 'Le compte de résultat est un compte de capitaux propres.', 'The result account is an equity account.');
  if (!resultAccount.is_active) push('block', 'RESULT_ACCOUNT_INACTIVE', 'Le compte de résultat est inactif.', 'The result account is inactive.');
  if (!journalRow.is_active) push('block', 'JOURNAL_INACTIVE', 'Le journal de clôture est inactif.', 'The closing journal is inactive.');
  if (nextStartDate <= period.end_date) push('block', 'NEXT_PERIOD_DATES_INVALID', 'L’exercice suivant doit commencer après la fin de la période source.', 'The next exercise must start after the source end date.');
  if (nextEndDate < nextStartDate) push('block', 'NEXT_PERIOD_DATES_INVALID', 'La fin de l’exercice suivant précède son début.', 'The next exercise end date is before its start date.');
  const drafts = state.entries.filter(
    (e) => e.company_id === companyId && e.status === 'draft' && e.entry_date >= period.start_date && e.entry_date <= period.end_date,
  );
  if (drafts.length > 0) push('block', 'DRAFT_ENTRIES_PRESENT', `${drafts.length} écriture(s) en brouillon existent dans la période.`, `${drafts.length} draft entry(ies) exist in the period.`);
  else push('ok', 'NO_DRAFT_ENTRIES', 'Aucune écriture en brouillon ne reste dans la période.', 'No draft entry remains in the period.');

  let unbalanced = false;
  for (const entry of state.entries.filter((e) => e.company_id === companyId && e.status === 'posted')) {
    const lines = state.lines.filter((l) => l.entry_id === entry.id);
    if (lines.reduce((s, l) => s + amt(l.debit), 0n) !== lines.reduce((s, l) => s + amt(l.credit), 0n)) unbalanced = true;
  }
  if (unbalanced) push('block', 'UNBALANCED_POSTED_ENTRIES', 'Une écriture comptabilisée est déséquilibrée.', 'A posted entry is unbalanced.');
  else push('ok', 'POSTED_ENTRIES_BALANCED', 'Chaque écriture comptabilisée est équilibrée.', 'Every posted entry is balanced.');

  const pnlAccounts = accountsOf(state, companyId).filter((a) => a.type === 'revenue' || a.type === 'expense');
  const lines: DemoFiscalClosing['lines'] = [];
  let revenueTotal = 0n;
  let expenseTotal = 0n;
  for (const acc of pnlAccounts) {
    let net = 0n;
    for (const row of postedLines(state, companyId, period.end_date)) {
      if (row.line.account_id !== acc.id || row.entry.entry_date < period.start_date) continue;
      if (row.entry.source === 'closing') continue;
      net += amt(row.line.debit) - amt(row.line.credit);
    }
    if (net === 0n) continue;
    if (!acc.is_active) push('block', 'ACCOUNT_INACTIVE', `Le compte ${acc.code} est inactif et ne peut pas recevoir de ligne de clôture.`, `Account ${acc.code} is inactive and cannot receive a closing line.`);
    if (acc.type === 'revenue') {
      revenueTotal += -net;
      lines.push({
        accountId: acc.id, code: acc.code, name: acc.name,
        description: net < 0n ? 'Year-end closing — revenue' : 'Year-end closing — revenue contra balance',
        debit: net < 0n ? fmt(-net) : '0.0000', credit: net > 0n ? fmt(net) : '0.0000',
      });
    } else {
      expenseTotal += net;
      lines.push({
        accountId: acc.id, code: acc.code, name: acc.name,
        description: net > 0n ? 'Year-end closing — expense' : 'Year-end closing — expense contra balance',
        debit: net < 0n ? fmt(-net) : '0.0000', credit: net > 0n ? fmt(net) : '0.0000',
      });
    }
  }
  const result = revenueTotal - expenseTotal;
  if (lines.length === 0) push('block', 'NO_PROFIT_AND_LOSS_ACTIVITY', 'Aucun mouvement de produit ou de charge comptabilisé sur cette période.', 'No posted profit or loss movement exists in this period.');
  if (lines.length > 198) push('block', 'TOO_MANY_CLOSING_LINES', 'Plus de 198 comptes de résultat à clôturer.', 'More than 198 profit and loss accounts must be closed.');
  if (result > 0n) lines.push({ accountId: resultAccount.id, code: resultAccount.code, name: resultAccount.name, description: 'Result for the year — profit', debit: '0.0000', credit: fmt(result) });
  if (result < 0n) lines.push({ accountId: resultAccount.id, code: resultAccount.code, name: resultAccount.name, description: 'Result for the year — loss', debit: fmt(-result), credit: '0.0000' });
  const debit = lines.reduce((s, l) => s + amt(l.debit), 0n);
  const credit = lines.reduce((s, l) => s + amt(l.credit), 0n);
  if (lines.length >= 2 && debit === credit) push('ok', 'CLOSING_ENTRY_BALANCED', 'L’écriture de clôture est exactement équilibrée.', 'The closing entry is exactly balanced.');
  else if (lines.length >= 2) push('block', 'CLOSING_ENTRY_UNBALANCED', 'L’écriture de clôture n’est pas équilibrée ; aucun ajustement n’est créé.', 'The closing entry is not balanced; no adjustment is created.');

  const overlap = state.periods.filter(
    (p) => p.company_id === companyId && p.start_date <= nextEndDate && p.end_date >= nextStartDate && p.id !== period.id,
  );
  let nextPeriod: DemoPeriod | null = null;
  if (overlap.length === 1 && overlap[0]!.start_date === nextStartDate && overlap[0]!.end_date === nextEndDate) {
    nextPeriod = overlap[0]!;
    if (nextPeriod.status === 'closed') push('block', 'NEXT_PERIOD_CLOSED', 'L’exercice suivant existe déjà mais est clôturé.', 'The next exercise already exists but is closed.');
    else push('ok', 'NEXT_PERIOD_EXISTS', 'L’exercice suivant existe déjà et est ouvert.', 'The next exercise already exists and is open.');
  } else if (overlap.length > 0) {
    push('block', 'NEXT_PERIOD_OVERLAP', 'L’exercice suivant demandé chevauche une autre période.', 'The requested next exercise overlaps another period.');
  } else {
    push('ok', 'NEXT_PERIOD_WILL_BE_CREATED', 'L’exercice suivant sera créé lors de la comptabilisation.', 'The next exercise will be created when the closing is posted.');
  }
  const fingerprint = hash({ companyId, period: period.id, journalId, resultAccountId, nextStartDate, nextEndDate, result: fmt(result), lines });
  return {
    checks,
    blockers: checks.filter((c) => c.severity === 'block'),
    warnings: checks.filter((c) => c.severity === 'warning'),
    lines,
    resultAmount: fmt(result),
    nextPeriod,
    fingerprint,
    journal: journalRow,
    resultAccount,
  };
}

/* ---------------------------------------------------------------- handler */

export function handleDemoEquity(
  state: DemoState,
  companyId: string,
  method: string,
  rest: string,
  query: Record<string, string>,
  payload: any,
): unknown {
  const company = state.companies.find((c) => c.id === companyId);
  if (!company) throw new ApiError(404, 'COMPANY_NOT_FOUND', 'Société introuvable');
  state.equityMovements ??= [];
  state.fiscalClosings ??= [];
  state.equityAllocations ??= [];
  state.equityAllocationLines ??= [];
  state.equitySequences ??= {};
  const movements = state.equityMovements;
  const closings = state.fiscalClosings;
  const allocations = state.equityAllocations;

  if (rest === '/overview' && method === 'GET') {
    const from = query.from || company.financial_year_start;
    const to = query.to || company.financial_year_end;
    return {
      statement: statement(state, companyId, from, to),
      movements: movements
        .filter((m) => m.company_id === companyId)
        .sort((a, b) => b.movement_date.localeCompare(a.movement_date) || b.movement_no.localeCompare(a.movement_no))
        .map((m) => movementView(state, companyId, m)),
      closings: closings
        .filter((c) => c.company_id === companyId)
        .sort((a, b) => b.source_end.localeCompare(a.source_end))
        .map((c) => closingView(state, c)),
      accounts: accountsOf(state, companyId),
      journals: state.journals.filter((j) => j.company_id === companyId),
      periods: state.periods.filter((p) => p.company_id === companyId).sort((a, b) => b.start_date.localeCompare(a.start_date)),
    };
  }

  if (rest === '/statement' && method === 'GET') {
    return statement(state, companyId, query.from || company.financial_year_start, query.to || company.financial_year_end);
  }

  // ----------------------------------------------------------- movements
  if (rest === '/movements' && method === 'GET') {
    return {
      movements: movements
        .filter((m) => m.company_id === companyId)
        .sort((a, b) => b.movement_date.localeCompare(a.movement_date))
        .map((m) => movementView(state, companyId, m)),
    };
  }

  if (rest === '/movements' && method === 'POST') {
    requireWriter(state, companyId);
    const equity = account(state, companyId, String(payload.equityAccountId));
    if (equity.type !== 'equity') throw new ApiError(400, 'EQUITY_ACCOUNT_NOT_EQUITY', 'Le compte doit être un compte de capitaux propres');
    if (!equity.is_active) throw new ApiError(400, 'EQUITY_ACCOUNT_INACTIVE', 'Compte de capitaux propres inactif');
    const counterpart = account(state, companyId, String(payload.counterpartAccountId));
    if (!counterpart.is_active) throw new ApiError(400, 'EQUITY_ACCOUNT_INACTIVE', 'Compte de contrepartie inactif');
    const journalRow = journal(state, companyId, String(payload.journalId));
    if (!journalRow.is_active) throw new ApiError(400, 'EQUITY_JOURNAL_INACTIVE', 'Journal inactif');
    const value = amt(payload.amount);
    if (value <= 0n) throw new ApiError(400, 'EQUITY_AMOUNT_INVALID', 'Montant invalide');
    const date = String(payload.movementDate ?? '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new ApiError(400, 'VALIDATION_ERROR', 'Date invalide');
    const documentRef = String(payload.documentRef ?? '').trim();
    if (documentRef.length < 2) throw new ApiError(400, 'VALIDATION_ERROR', 'Justificatif obligatoire');
    if (movements.some((m) => m.company_id === companyId && m.document_ref.toLowerCase() === documentRef.toLowerCase())) {
      throw new ApiError(409, 'CONFLICT', 'Ce justificatif est déjà utilisé');
    }
    const year = Number(date.slice(0, 4));
    const key = `EQ-${year}`;
    const no = (state.equitySequences[key] ?? 0) + 1;
    state.equitySequences[key] = no;
    const movement: DemoEquityMovement = {
      id: uid(),
      company_id: companyId,
      movement_no: `EQ-${year}-${String(no).padStart(4, '0')}`,
      movement_date: date,
      category: payload.category,
      direction: payload.direction,
      amount: fmt(value),
      equity_account_id: equity.id,
      counterpart_account_id: counterpart.id,
      journal_id: journalRow.id,
      description: String(payload.description ?? '').trim(),
      document_ref: documentRef,
      status: 'DRAFT',
      approval_note: null,
      approved_at: null,
      entry_id: null,
      created_at: now(),
    };
    movements.push(movement);
    return { movement: movementView(state, companyId, movement) };
  }

  const movementMatch = /^\/movements\/([0-9a-f-]{36})(?:\/(approve|post))?$/.exec(rest);
  if (movementMatch) {
    const movement = movements.find((m) => m.id === movementMatch[1] && m.company_id === companyId);
    if (!movement) throw new ApiError(404, 'EQUITY_MOVEMENT_NOT_FOUND', 'Mouvement introuvable');
    const action = movementMatch[2];
    if (!action && method === 'GET') return { movement: movementView(state, companyId, movement) };
    if (!action && method === 'PATCH') {
      requireWriter(state, companyId);
      if (movement.status !== 'DRAFT') throw new ApiError(409, 'EQUITY_MOVEMENT_DRAFT_ONLY', 'Seul un brouillon peut être modifié');
      const equity = account(state, companyId, String(payload.equityAccountId));
      if (equity.type !== 'equity') throw new ApiError(400, 'EQUITY_ACCOUNT_NOT_EQUITY', 'Compte de capitaux propres requis');
      const counterpart = account(state, companyId, String(payload.counterpartAccountId));
      Object.assign(movement, {
        movement_date: String(payload.movementDate ?? movement.movement_date),
        category: payload.category ?? movement.category,
        direction: payload.direction ?? movement.direction,
        amount: fmt(amt(payload.amount)),
        equity_account_id: equity.id,
        counterpart_account_id: counterpart.id,
        journal_id: journal(state, companyId, String(payload.journalId)).id,
        description: String(payload.description ?? movement.description).trim(),
        document_ref: String(payload.documentRef ?? movement.document_ref).trim(),
      });
      return { movement: movementView(state, companyId, movement) };
    }
    if (!action && method === 'DELETE') {
      requireWriter(state, companyId);
      if (movement.status !== 'DRAFT') throw new ApiError(409, 'EQUITY_MOVEMENT_DRAFT_ONLY', 'Seul un brouillon peut être supprimé');
      state.equityMovements = movements.filter((m) => m.id !== movement.id);
      return { ok: true };
    }
    if (action === 'approve' && method === 'POST') {
      requireManager(state, companyId);
      if (!payload.confirm || String(payload.note ?? '').trim().length < 10) {
        throw new ApiError(400, 'EQUITY_DECISION_REQUIRED', 'Confirmation et note de 10 caractères minimum requises');
      }
      if (movement.status === 'POSTED') throw new ApiError(409, 'EQUITY_MOVEMENT_POSTED_IMMUTABLE', 'Mouvement comptabilisé : immuable');
      if (movement.status === 'APPROVED') throw new ApiError(409, 'CONFLICT', 'Déjà approuvé');
      movement.status = 'APPROVED';
      movement.approved_at = now();
      movement.approval_note = String(payload.note).trim();
      return { movement: movementView(state, companyId, movement) };
    }
    if (action === 'post' && method === 'POST') {
      requireManager(state, companyId);
      if (movement.status === 'POSTED') throw new ApiError(409, 'EQUITY_MOVEMENT_POSTED_IMMUTABLE', 'Mouvement déjà comptabilisé');
      if (movement.status !== 'APPROVED') throw new ApiError(409, 'EQUITY_MOVEMENT_NOT_APPROVED', 'Approbation préalable requise');
      const equity = account(state, companyId, movement.equity_account_id);
      const counterpart = account(state, companyId, movement.counterpart_account_id);
      const journalRow = journal(state, companyId, movement.journal_id);
      assertOpenPeriod(state, companyId, movement.movement_date);
      const base = [
        { accountId: equity.id, description: movement.description },
        { accountId: counterpart.id, description: movement.description },
      ];
      const lines =
        movement.direction === 'increase'
          ? [
              { ...base[1]!, debit: movement.amount },
              { ...base[0]!, credit: movement.amount },
            ]
          : [
              { ...base[0]!, debit: movement.amount },
              { ...base[1]!, credit: movement.amount },
            ];
      const entry = pushEntry(state, companyId, journalRow.id, journalRow.code, movement.movement_date, `Capitaux propres — ${movement.document_ref}`, 'equity', movement.movement_no, lines);
      movement.status = 'POSTED';
      movement.entry_id = entry.id;
      return { movement: movementView(state, companyId, movement), entry };
    }
  }

  // ------------------------------------------------------------ closings
  if (rest === '/closings' && method === 'GET') {
    return {
      closings: closings
        .filter((c) => c.company_id === companyId)
        .sort((a, b) => b.source_end.localeCompare(a.source_end))
        .map((c) => closingView(state, c)),
    };
  }

  if (rest === '/closings' && method === 'POST') {
    requireWriter(state, companyId);
    const period = state.periods.find((p) => p.id === payload.periodId && p.company_id === companyId);
    if (!period) throw new ApiError(404, 'CLOSING_NOT_FOUND', 'Période introuvable');
    const nextStart = String(payload.nextStartDate ?? '');
    const nextEnd = String(payload.nextEndDate ?? '');
    const defaultStart = new Date(Date.parse(`${period.end_date}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
    const defaultEnd = new Date(Date.parse(`${defaultStart}T00:00:00Z`));
    defaultEnd.setUTCFullYear(defaultEnd.getUTCFullYear() + 1);
    defaultEnd.setUTCDate(defaultEnd.getUTCDate() - 1);
    const preview = buildPreview(
      state, companyId, period, String(payload.journalId), String(payload.resultAccountId),
      nextStart || defaultStart, nextEnd || defaultEnd.toISOString().slice(0, 10),
    );
    let closing = closings.find(
      (c) => c.company_id === companyId && c.source_period_id === period.id && c.status !== 'POSTED' && c.status !== 'REJECTED',
    );
    if (!closing) {
      const version = Math.max(0, ...closings.filter((c) => c.company_id === companyId && c.source_period_id === period.id).map((c) => c.version)) + 1;
      closing = {
        id: uid(), company_id: companyId, source_period_id: period.id, source_start: period.start_date, source_end: period.end_date,
        version, journal_id: preview.journal.id, result_account_id: preview.resultAccount.id,
        next_start_date: nextStart || defaultStart, next_end_date: nextEnd || defaultEnd.toISOString().slice(0, 10),
        next_period_id: preview.nextPeriod?.id ?? null, result_amount: preview.resultAmount,
        status: preview.blockers.length ? 'BLOCKED' : 'REVIEW_REQUIRED',
        checks: preview.checks, blockers: preview.blockers, warnings: preview.warnings, lines: preview.lines,
        source_fingerprint: preview.fingerprint, prepared_at: now(), decision_note: null, decided_at: null,
        rejection_reason: null, closing_entry_id: null, posted_at: null,
      };
      closings.push(closing);
    } else {
      Object.assign(closing, {
        source_start: period.start_date, source_end: period.end_date, journal_id: preview.journal.id,
        result_account_id: preview.resultAccount.id, next_start_date: nextStart || defaultStart,
        next_end_date: nextEnd || defaultEnd.toISOString().slice(0, 10), next_period_id: preview.nextPeriod?.id ?? null,
        result_amount: preview.resultAmount, status: preview.blockers.length ? 'BLOCKED' : 'REVIEW_REQUIRED',
        checks: preview.checks, blockers: preview.blockers, warnings: preview.warnings, lines: preview.lines,
        source_fingerprint: preview.fingerprint, prepared_at: now(), decision_note: null, decided_at: null,
        rejection_reason: null,
      });
    }
    return { closing: closingView(state, closing) };
  }

  const closingMatch = /^\/closings\/([0-9a-f-]{36})(?:\/(approve|reject|post|allocation)(?:\/(approve|post))?)?$/.exec(rest);
  if (closingMatch) {
    const closing = closings.find((c) => c.id === closingMatch[1] && c.company_id === companyId);
    if (!closing) throw new ApiError(404, 'CLOSING_NOT_FOUND', 'Clôture introuvable');
    const action = closingMatch[2];
    const sub = closingMatch[3];
    if (!action && method === 'GET') return { closing: closingView(state, closing) };

    if (action === 'approve' && method === 'POST') {
      requireManager(state, companyId);
      if (!payload.confirm || String(payload.note ?? '').trim().length < 10) {
        throw new ApiError(400, 'CLOSING_DECISION_REQUIRED', 'Confirmation et note de 10 caractères minimum requises');
      }
      if (closing.status === 'POSTED') throw new ApiError(409, 'CLOSING_ALREADY_POSTED', 'Clôture déjà comptabilisée');
      if (closing.status === 'BLOCKED') throw new ApiError(409, 'CLOSING_BLOCKED', 'Contrôles bloquants non levés');
      if (closing.status === 'REJECTED') throw new ApiError(409, 'CLOSING_REJECTED', 'Clôture rejetée à préparer de nouveau');
      if (closing.status === 'APPROVED') throw new ApiError(409, 'CLOSING_ALREADY_APPROVED', 'Déjà approuvée');
      const period = state.periods.find((p) => p.id === closing!.source_period_id)!;
      const preview = buildPreview(state, companyId, period, closing.journal_id, closing.result_account_id, closing.next_start_date, closing.next_end_date);
      if (preview.fingerprint !== closing.source_fingerprint) throw new ApiError(409, 'CLOSING_STALE', 'La source a changé : préparez de nouveau la clôture');
      if (preview.blockers.length > 0) throw new ApiError(409, 'CLOSING_BLOCKED', 'Contrôles bloquants non levés');
      closing.status = 'APPROVED';
      closing.decision_note = String(payload.note).trim();
      closing.decided_at = now();
      return { closing: closingView(state, closing) };
    }

    if (action === 'reject' && method === 'POST') {
      requireManager(state, companyId);
      if (String(payload.reason ?? '').trim().length < 10) throw new ApiError(400, 'CLOSING_DECISION_REQUIRED', 'Motif de 10 caractères minimum requis');
      if (closing.status === 'POSTED') throw new ApiError(409, 'CLOSING_ALREADY_POSTED', 'Clôture déjà comptabilisée');
      closing.status = 'REJECTED';
      closing.rejection_reason = String(payload.reason).trim();
      closing.decided_at = now();
      return { closing: closingView(state, closing) };
    }

    if (action === 'post' && method === 'POST') {
      requireManager(state, companyId);
      if (closing.status === 'POSTED') throw new ApiError(409, 'CLOSING_ALREADY_POSTED', 'Clôture déjà comptabilisée');
      if (closing.status !== 'APPROVED') throw new ApiError(409, 'CLOSING_NOT_APPROVED', 'Approbation préalable requise');
      const period = state.periods.find((p) => p.id === closing.source_period_id)!;
      const preview = buildPreview(state, companyId, period, closing.journal_id, closing.result_account_id, closing.next_start_date, closing.next_end_date);
      if (preview.fingerprint !== closing.source_fingerprint) throw new ApiError(409, 'CLOSING_STALE', 'La source a changé : préparez de nouveau la clôture');
      if (preview.blockers.length > 0) throw new ApiError(409, 'CLOSING_BLOCKED', 'Contrôles bloquants non levés');
      assertOpenPeriod(state, companyId, period.end_date);
      const journalRow = journal(state, companyId, closing.journal_id);
      const entry = pushEntry(state, companyId, journalRow.id, journalRow.code, period.end_date, `Clôture annuelle ${period.start_date} → ${period.end_date}`, 'closing', `CLOSE-${period.end_date}`, preview.lines.map((l) => ({
        accountId: l.accountId, description: l.description, debit: l.debit, credit: l.credit,
      })));
      period.status = 'closed';
      let nextPeriod = preview.nextPeriod;
      if (!nextPeriod) {
        nextPeriod = {
          id: uid(), company_id: companyId,
          name: `FY ${closing.next_start_date.slice(0, 4)}/${closing.next_end_date.slice(0, 4)}`,
          start_date: closing.next_start_date, end_date: closing.next_end_date, status: 'open',
        };
        state.periods.push(nextPeriod);
      }
      closing.status = 'POSTED';
      closing.closing_entry_id = entry.id;
      closing.next_period_id = nextPeriod.id;
      closing.posted_at = now();
      return { closing: closingView(state, closing), entry };
    }

    if (action === 'allocation') {
      const allocation = allocations.find((a) => a.closing_id === closing.id && a.company_id === companyId);
      if (!allocation && method === 'GET') return { allocation: null };
      if (method === 'GET') return { allocation: allocationView(state, allocation!) };
      if (method === 'PUT') {
        requireWriter(state, companyId);
        if (closing.status !== 'POSTED') throw new ApiError(409, 'ALLOCATION_CLOSING_NOT_POSTED', 'La clôture doit être comptabilisée');
        const result = amt(closing.result_amount);
        if (result === 0n) throw new ApiError(400, 'ALLOCATION_INVALID_LINES', 'Un résultat nul ne peut pas être affecté');
        if (allocation?.status === 'POSTED') throw new ApiError(409, 'ALLOCATION_ALREADY_POSTED', 'Affectation déjà comptabilisée');
        const rows: any[] = Array.isArray(payload.lines) ? payload.lines : [];
        if (rows.length === 0 || rows.length > 20) throw new ApiError(400, 'ALLOCATION_INVALID_LINES', 'Entre 1 et 20 lignes sont requises');
        const documentRef = String(payload.documentRef ?? '').trim();
        const note = String(payload.note ?? '').trim();
        if (documentRef.length < 2) throw new ApiError(400, 'ALLOCATION_INVALID_LINES', 'Référence de décision requise');
        if (note.length < 5) throw new ApiError(400, 'ALLOCATION_INVALID_LINES', 'Décision documentée requise');
        const journalRow = journal(state, companyId, String(payload.journalId));
        if (!journalRow.is_active) throw new ApiError(400, 'EQUITY_JOURNAL_INACTIVE', 'Journal inactif');
        const seen = new Set<string>();
        const prepared = rows.map((row) => {
          const acc = account(state, companyId, String(row.accountId));
          if (!acc.is_active) throw new ApiError(400, 'EQUITY_ACCOUNT_INACTIVE', 'Compte inactif');
          if (seen.has(acc.id)) throw new ApiError(400, 'ALLOCATION_INVALID_LINES', 'Un compte ne peut apparaître qu’une fois');
          seen.add(acc.id);
          return { nature: row.nature, account_id: acc.id, amount: amt(row.amount) };
        });
        const total = prepared.reduce((sum, r) => sum + r.amount, 0n);
        const absResult = result < 0n ? -result : result;
        if (total !== absResult) {
          throw new ApiError(400, 'ALLOCATION_AMOUNT_MISMATCH', 'Les lignes doivent totaliser exactement le résultat', {
            expected: fmt(absResult), actual: fmt(total),
          });
        }
        let target = allocations.find((a) => a.closing_id === closing.id && a.company_id === companyId);
        if (!target) {
          target = {
            id: uid(), company_id: companyId, closing_id: closing.id, allocation_date: String(payload.allocationDate),
            journal_id: journalRow.id, document_ref: documentRef, decision_date: String(payload.decisionDate), note,
            result_amount: fmt(result), allocated_amount: fmt(total), status: 'DRAFT', approval_note: null,
            approved_at: null, entry_id: null, created_at: now(),
          };
          allocations.push(target);
        } else {
          Object.assign(target, {
            allocation_date: String(payload.allocationDate), journal_id: journalRow.id, document_ref: documentRef,
            decision_date: String(payload.decisionDate), note, result_amount: fmt(result), allocated_amount: fmt(total),
            status: 'DRAFT', approval_note: null, approved_at: null,
          });
          state.equityAllocationLines = state.equityAllocationLines!.filter((l) => l.allocation_id !== target!.id);
        }
        prepared.forEach((row, index) => {
          state.equityAllocationLines!.push({
            id: uid(), company_id: companyId, allocation_id: target!.id, line_no: index + 1,
            nature: row.nature, account_id: row.account_id, amount: fmt(row.amount),
          });
        });
        return { allocation: allocationView(state, target) };
      }
      if (!allocation) throw new ApiError(404, 'ALLOCATION_NOT_FOUND', 'Affectation introuvable');
      if (sub === 'approve' && method === 'POST') {
        requireManager(state, companyId);
        if (!payload.confirm || String(payload.note ?? '').trim().length < 10) {
          throw new ApiError(400, 'EQUITY_DECISION_REQUIRED', 'Confirmation et note de 10 caractères minimum requises');
        }
        if (allocation.status === 'POSTED') throw new ApiError(409, 'ALLOCATION_ALREADY_POSTED', 'Affectation déjà comptabilisée');
        allocation.status = 'APPROVED';
        allocation.approved_at = now();
        allocation.approval_note = String(payload.note).trim();
        return { allocation: allocationView(state, allocation) };
      }
      if (sub === 'post' && method === 'POST') {
        requireManager(state, companyId);
        if (allocation.status === 'POSTED') throw new ApiError(409, 'ALLOCATION_ALREADY_POSTED', 'Affectation déjà comptabilisée');
        if (allocation.status !== 'APPROVED') throw new ApiError(409, 'ALLOCATION_NOT_APPROVED', 'Approbation préalable requise');
        const lines = (state.equityAllocationLines ?? []).filter((l) => l.allocation_id === allocation!.id);
        const result = amt(allocation.result_amount);
        const absResult = result < 0n ? -result : result;
        if (lines.reduce((sum, l) => sum + amt(l.amount), 0n) !== absResult) {
          throw new ApiError(400, 'ALLOCATION_AMOUNT_MISMATCH', 'Les lignes ne correspondent plus au résultat');
        }
        assertOpenPeriod(state, companyId, allocation.allocation_date);
        const journalRow = journal(state, companyId, allocation.journal_id);
        const entryLines =
          result > 0n
            ? [
                { accountId: closing.result_account_id, description: `Affectation — ${allocation.document_ref}`, debit: fmt(result) },
                ...lines.map((l) => ({ accountId: l.account_id, description: `${l.nature} — ${allocation.document_ref}`, credit: l.amount })),
              ]
            : [
                { accountId: closing.result_account_id, description: `Affectation de la perte — ${allocation.document_ref}`, credit: fmt(-result) },
                ...lines.map((l) => ({ accountId: l.account_id, description: `${l.nature} — ${allocation.document_ref}`, debit: l.amount })),
              ];
        const entry = pushEntry(state, companyId, journalRow.id, journalRow.code, allocation.allocation_date, `Affectation du résultat — ${allocation.document_ref}`, 'equity_allocation', allocation.document_ref, entryLines);
        allocation.status = 'POSTED';
        allocation.entry_id = entry.id;
        return { allocation: allocationView(state, allocation), entry };
      }
    }
  }

  return undefined;
}
