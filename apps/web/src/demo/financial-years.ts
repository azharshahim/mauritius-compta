/**
 * Mission 21 — browser demo for financial years, opening balances, prior-year
 * adjustments, closing checklists and annual archives.
 *
 * Everything is fictitious and lives in localStorage only. The module mirrors
 * the controls of the real API (continuous ledger, no duplicate opening entry,
 * human approval before posting, closed periods untouched, unavailable checks
 * never reported as passed, read-only sealed archives) but it never claims the
 * demonstration fingerprints are cryptographic SHA-256 hashes, nor that the
 * downloaded JSON is a server ZIP or a legally certified archive.
 */
import { ApiError } from '../errors';
import { scaled4ToString, toScaled4 } from '../format';
import type {
  DemoAccount, DemoEntry, DemoJournal, DemoLine, DemoPeriod, DemoState,
} from './runtime';
import { demoMission22Checklist } from './inventory';
import type { DemoFixedAssetState } from './fixed-assets';

/* ------------------------------------------------------------------ types */

export interface DemoFiscalYearSettings {
  company_id: string;
  suspense_account_ids: string[];
  retention_months: number | null;
  retention_note: string | null;
  document_backup_note: string | null;
  updated_at: string;
}

export interface DemoOpeningBatchLine {
  id: string;
  line_no: number;
  account_id: string;
  debit: string;
  credit: string;
  description: string | null;
}

export interface DemoOpeningBatch {
  id: string;
  company_id: string;
  period_id: string;
  reference: string;
  source_reference: string;
  journal_id: string;
  notes: string | null;
  status: 'DRAFT' | 'APPROVED' | 'POSTED';
  total_debit: string;
  total_credit: string;
  entry_id: string | null;
  approval_note: string | null;
  approved_at: string | null;
  posted_at: string | null;
  created_at: string;
  lines: DemoOpeningBatchLine[];
}

export interface DemoAdjustmentLine {
  line_no: number;
  account_id: string;
  debit: string;
  credit: string;
  description: string | null;
}

export interface DemoPriorYearAdjustment {
  id: string;
  company_id: string;
  adjustment_no: string;
  source_period_id: string;
  adjustment_date: string;
  journal_id: string;
  treatment: 'retained_earnings' | 'current_year_result' | 'custom';
  original_entry_id: string | null;
  original_reference: string;
  reason: string;
  document_ref: string;
  status: 'PROPOSED' | 'APPROVED' | 'REJECTED' | 'POSTED';
  restates_comparatives: boolean;
  comparative_note: string | null;
  approval_note: string | null;
  approved_at: string | null;
  rejection_reason: string | null;
  entry_id: string | null;
  created_at: string;
  lines: DemoAdjustmentLine[];
}

export interface DemoChecklist {
  id: string;
  company_id: string;
  period_id: string;
  version: number;
  status: 'GENERATED' | 'REVIEWED';
  items: any[];
  counts: Record<string, number>;
  review_note: string | null;
  reviewed_at: string | null;
  created_at: string;
}

export interface DemoArchive {
  id: string;
  company_id: string;
  period_id: string;
  version: number;
  status: 'SEALED';
  note: string | null;
  manifest: any;
  snapshot: { metadata: any; sections: Record<string, any> };
  checksum: string;
  size_bytes: number;
  retention_months: number | null;
  retention_note: string | null;
  created_at: string;
}

/* --------------------------------------------------------------- helpers */

const uid = () => crypto.randomUUID();
const nowIso = () => new Date().toISOString();
const fmt = (value: bigint) => scaled4ToString(value);
const amt = (value: unknown): bigint => {
  try {
    return toScaled4(value === null || value === undefined || value === '' ? 0 : (value as any)) ?? 0n;
  } catch {
    return 0n;
  }
};
const iso = (value: unknown) => /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? ''));

function stable(value: any): string {
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/**
 * Demonstration-only fingerprint. It is deliberately labelled `demo-` and is
 * not SHA-256: the browser demo has no server-side cryptographic archive.
 */
function demoChecksum(value: any): string {
  const text = stable(value);
  let a = 0x811c9dc5 >>> 0;
  let b = 0x9e3779b9 >>> 0;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    a = Math.imul(a ^ code, 0x01000193) >>> 0;
    b = Math.imul(b ^ code, 0x85ebca6b) >>> 0;
  }
  return `demo-${a.toString(16).padStart(8, '0')}${b.toString(16).padStart(8, '0')}`;
}
function demoBytes(value: string): number {
  return new TextEncoder().encode(value).length;
}

function accountsOf(state: DemoState, companyId: string): DemoAccount[] {
  return state.accounts.filter((a) => a.company_id === companyId);
}
function accountById(state: DemoState, companyId: string, id: string): DemoAccount {
  const found = accountsOf(state, companyId).find((a) => a.id === id);
  if (!found) throw new ApiError(404, 'ACCOUNT_NOT_FOUND', 'Compte introuvable dans cette société');
  return found;
}
function journalById(state: DemoState, companyId: string, id: string): DemoJournal {
  const found = state.journals.find((j) => j.company_id === companyId && j.id === id);
  if (!found) throw new ApiError(404, 'JOURNAL_NOT_FOUND', 'Journal introuvable');
  return found;
}
function periodById(state: DemoState, companyId: string, id: string): DemoPeriod {
  const found = state.periods.find((p) => p.id === id && p.company_id === companyId);
  if (!found) throw new ApiError(404, 'PERIOD_NOT_FOUND', 'Période comptable introuvable');
  return found;
}
function memberRole(state: DemoState, companyId: string): string {
  const member = state.members.find((m) => m.company_id === companyId && m.user_id === state.session);
  if (!member) throw new ApiError(404, 'COMPANY_NOT_FOUND', 'Société introuvable');
  return member.role;
}
function requireWriter(state: DemoState, companyId: string) {
  if (!['owner', 'admin', 'accountant', 'manager', 'cabinet_admin'].includes(memberRole(state, companyId))) {
    throw new ApiError(403, 'FORBIDDEN', 'Rôle comptable requis');
  }
}
function requireManager(state: DemoState, companyId: string) {
  if (!['owner', 'admin', 'manager', 'cabinet_admin'].includes(memberRole(state, companyId))) {
    throw new ApiError(403, 'FORBIDDEN', 'Permission manager requise pour une décision ou un scellement');
  }
}
function nextEntryNo(state: DemoState, companyId: string, journalCode: string, date: string): string {
  const key = `${journalCode}-${date.slice(0, 4)}`;
  const next = (state.sequences[key] ?? 0) + 1;
  state.sequences[key] = next;
  return `${journalCode}-${date.slice(0, 4)}-${String(next).padStart(4, '0')}`;
}
function pushEntry(
  state: DemoState,
  companyId: string,
  journalId: string,
  date: string,
  description: string,
  source: DemoEntry['source'],
  reference: string | null,
  lines: { accountId: string; description: string; debit?: string; credit?: string }[],
): DemoEntry {
  const debit = lines.reduce((sum, l) => sum + amt(l.debit), 0n);
  const credit = lines.reduce((sum, l) => sum + amt(l.credit), 0n);
  if (debit !== credit) throw new ApiError(400, 'ENTRY_UNBALANCED', 'Écriture déséquilibrée');
  const journal = journalById(state, companyId, journalId);
  const entry: DemoEntry = {
    id: uid(), company_id: companyId, journal_id: journalId,
    entry_no: nextEntryNo(state, companyId, journal.code, date),
    entry_date: date, reference, description, currency: 'MUR', exchange_rate: '1.00000000',
    status: 'posted', source, reversal_of_entry_id: null, posted_at: nowIso(), created_at: nowIso(),
  };
  state.entries.push(entry);
  lines.forEach((line, index) => {
    const d = amt(line.debit);
    const c = amt(line.credit);
    const row: DemoLine = {
      id: uid(), entry_id: entry.id, company_id: companyId, account_id: line.accountId,
      line_no: index + 1, description: line.description,
      debit: fmt(d), credit: fmt(c),
      txn_amount: fmt(d > 0n ? d : c), txn_currency: 'MUR', fx_rate: null,
    };
    state.lines.push(row);
  });
  return entry;
}

function audit(state: DemoState, companyId: string, action: string, entityType: string, entityId: string | null, details: any) {
  state.auditSeq += 1;
  state.audit.push({
    id: uid(), seq: state.auditSeq, company_id: companyId,
    actor_id: state.session, action, entity_type: entityType, entity_id: entityId,
    details, created_at: nowIso(),
  } as any);
}

/** Cumulative posted balances per account, up to and including `through`. */
function balancesThrough(state: DemoState, companyId: string, through: string): Map<string, { debit: bigint; credit: bigint }> {
  const result = new Map<string, { debit: bigint; credit: bigint }>();
  const posted = new Map(state.entries
    .filter((e) => e.company_id === companyId && e.status === 'posted' && e.entry_date <= through)
    .map((e) => [e.id, e]));
  for (const line of state.lines) {
    if (line.company_id !== companyId) continue;
    if (!posted.has(line.entry_id)) continue;
    const row = result.get(line.account_id) ?? { debit: 0n, credit: 0n };
    row.debit += amt(line.debit);
    row.credit += amt(line.credit);
    result.set(line.account_id, row);
  }
  return result;
}
function balancesBefore(state: DemoState, companyId: string, date: string): Map<string, { debit: bigint; credit: bigint }> {
  const previousDay = new Date(`${date}T00:00:00Z`);
  previousDay.setUTCDate(previousDay.getUTCDate() - 1);
  return balancesThrough(state, companyId, previousDay.toISOString().slice(0, 10));
}

/* ------------------------------------------------------------------ views */

function periodView(period: DemoPeriod) {
  return { id: period.id, name: period.name, startDate: period.start_date, endDate: period.end_date, status: period.status };
}
function adjustmentView(state: DemoState, companyId: string, a: DemoPriorYearAdjustment) {
  const period = state.periods.find((p) => p.id === a.source_period_id);
  const journal = state.journals.find((j) => j.id === a.journal_id);
  const entry = state.entries.find((e) => e.id === a.entry_id);
  const debit = a.lines.reduce((s, l) => s + amt(l.debit), 0n);
  const credit = a.lines.reduce((s, l) => s + amt(l.credit), 0n);
  return {
    id: a.id,
    adjustmentNo: a.adjustment_no,
    sourcePeriodId: a.source_period_id,
    sourcePeriod: period ? periodView(period) : null,
    adjustmentDate: a.adjustment_date,
    journal: journal ? { id: journal.id, code: journal.code, name: journal.name } : null,
    treatment: a.treatment,
    originalReference: a.original_reference,
    reason: a.reason,
    documentRef: a.document_ref,
    status: a.status,
    entryNo: entry?.entry_no ?? null,
    restatesComparatives: a.restates_comparatives,
    comparativeNote: a.comparative_note,
    totalDebit: fmt(debit),
    totalCredit: fmt(credit),
    balanced: debit === credit,
    lines: a.lines.map((l) => {
      const account = accountsOf(state, companyId).find((x) => x.id === l.account_id);
      return {
        accountId: l.account_id,
        account: account ? { code: account.code, name: account.name, type: account.type } : null,
        description: l.description, debit: l.debit, credit: l.credit,
      };
    }),
    approvalNote: a.approval_note,
    rejectionReason: a.rejection_reason,
    createdByName: 'Utilisateur démo',
    approvedByName: a.approved_at ? 'Utilisateur démo' : null,
    createdAt: a.created_at,
  };
}
function batchView(state: DemoState, companyId: string, b: DemoOpeningBatch) {
  const period = state.periods.find((p) => p.id === b.period_id);
  const journal = state.journals.find((j) => j.id === b.journal_id);
  const entry = state.entries.find((e) => e.id === b.entry_id);
  return {
    id: b.id, reference: b.reference, sourceReference: b.source_reference, status: b.status,
    period: period ? periodView(period) : null,
    journal: journal ? { id: journal.id, code: journal.code, name: journal.name } : null,
    totalDebit: b.total_debit, totalCredit: b.total_credit,
    notes: b.notes, entryNo: entry?.entry_no ?? null, entryId: b.entry_id,
    createdByName: 'Utilisateur démo', approvedByName: b.approved_at ? 'Utilisateur démo' : null,
    approvedAt: b.approved_at, approvalNote: b.approval_note, postedAt: b.posted_at,
    createdAt: b.created_at, updatedAt: b.created_at,
    lines: b.lines.map((l) => {
      const account = accountsOf(state, companyId).find((x) => x.id === l.account_id);
      return {
        id: l.id, lineNo: l.line_no, accountId: l.account_id,
        account: account ? { code: account.code, name: account.name, type: account.type } : null,
        description: l.description, debit: l.debit, credit: l.credit,
      };
    }),
  };
}
function archiveView(a: DemoArchive) {
  const m = a.manifest;
  return {
    id: a.id, version: a.version, status: a.status, periodId: a.period_id,
    periodName: m.period?.name, periodStart: m.period?.startDate, periodEnd: m.period?.endDate,
    generatedAt: m.generatedAt, checksum: a.checksum, sizeBytes: a.size_bytes, note: a.note,
    retentionMonths: a.retention_months, retentionNote: a.retention_note,
    createdAt: a.created_at,
    sectionNames: (m.sections ?? []).map((s: any) => s.name),
    sections: m.sections ?? [], overall: m.overall,
    limitationsEn: m.limitationsEn, limitationsFr: m.limitationsFr,
    documentStorageEn: m.documentStorageEn, documentStorageFr: m.documentStorageFr,
  };
}

/* -------------------------------------------------------- opening balances */

function openingChecks(totals: any, previous: DemoPeriod | null, differences: any[], pnlOpening: any[]): any[] {
  const checks: any[] = [];
  checks.push(amt(totals.openingDebit) === amt(totals.openingCredit)
    ? { code: 'OPENING_BALANCED', severity: 'ok', messageEn: 'Opening debit and credit totals are equal.', messageFr: 'Les totaux débit et crédit d’ouverture sont égaux.' }
    : { code: 'OPENING_UNBALANCED', severity: 'block', messageEn: 'Opening debit and credit totals differ.', messageFr: 'Les totaux débit et crédit d’ouverture diffèrent.' });
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
    checks.push(differences.length === 0
      ? { code: 'CARRY_FORWARD_CONTINUOUS', severity: 'ok', messageEn: 'Opening balances equal the preceding period closing balances.', messageFr: 'Les soldes d’ouverture égalent les soldes de clôture de la période précédente.' }
      : { code: 'CARRY_FORWARD_GAP', severity: 'block', messageEn: `${differences.length} account(s) differ from the preceding closing balance.`, messageFr: `${differences.length} compte(s) diffèrent du solde de clôture précédent.` });
  } else {
    checks.push({ code: 'CARRY_FORWARD_FIRST_PERIOD', severity: 'warning', messageEn: 'No preceding period: continuity cannot be compared.', messageFr: 'Aucune période précédente : la continuité ne peut pas être comparée.' });
  }
  return checks;
}

function externalPreview(state: DemoState, companyId: string, periodId: string, raw: any[]) {
  const period = periodById(state, companyId, periodId);
  const seen = new Set<string>();
  const lines = (raw ?? []).map((line: any, index: number) => {
    if (!line || !line.accountId) throw new ApiError(400, 'VALIDATION_ERROR', `Ligne ${index + 1} : compte requis`);
    if (seen.has(line.accountId)) throw new ApiError(400, 'OPENING_DUPLICATE_ACCOUNT', `Ligne ${index + 1} : un compte ne peut apparaître qu’une fois`);
    seen.add(line.accountId);
    const account = accountById(state, companyId, String(line.accountId));
    const debit = amt(line.debit);
    const credit = amt(line.credit);
    if (debit < 0n || credit < 0n) throw new ApiError(400, 'VALIDATION_ERROR', `Ligne ${index + 1} : montants positifs requis`);
    if ((debit > 0n) === (credit > 0n)) throw new ApiError(400, 'VALIDATION_ERROR', `Ligne ${index + 1} : débit ou crédit requis`);
    return { account, debit, credit, description: line.description ? String(line.description).slice(0, 500) : null };
  });
  const blocks: any[] = [];
  let debitTotal = 0n;
  let creditTotal = 0n;
  for (const line of lines) {
    if (!line.account.is_active) blocks.push({ code: 'OPENING_ACCOUNT_INACTIVE', severity: 'block', messageEn: `Account ${line.account.code} is inactive.`, messageFr: `Le compte ${line.account.code} est inactif.` });
    if (line.account.type === 'revenue' || line.account.type === 'expense') {
      blocks.push({ code: 'OPENING_PROFIT_LOSS_ACCOUNT', severity: 'block', messageEn: `Account ${line.account.code} is a profit or loss account: it cannot be used as an ordinary opening balance.`, messageFr: `Le compte ${line.account.code} est un compte de résultat : il ne peut pas être utilisé comme solde d’ouverture ordinaire.` });
    }
    debitTotal += line.debit;
    creditTotal += line.credit;
  }
  if (debitTotal !== creditTotal) blocks.push({ code: 'OPENING_UNBALANCED', severity: 'block', messageEn: 'Opening debit and credit totals must be equal.', messageFr: 'Les totaux débit et crédit d’ouverture doivent être égaux.' });
  return {
    period: periodView(period),
    lines: lines.map((l) => ({
      accountId: l.account.id, debit: fmt(l.debit), credit: fmt(l.credit), description: l.description,
      account: { id: l.account.id, code: l.account.code, name: l.account.name, type: l.account.type },
    })),
    totals: { debit: fmt(debitTotal), credit: fmt(creditTotal), difference: fmt(debitTotal - creditTotal) },
    blocks, balanced: debitTotal === creditTotal && debitTotal > 0n,
    fingerprint: demoChecksum(lines.map((l) => [l.account.id, fmt(l.debit), fmt(l.credit)])),
  };
}

function buildOpening(state: DemoState, companyId: string, periodId: string, raw?: any[]) {
  const period = periodById(state, companyId, periodId);
  const previous = state.periods
    .filter((p) => p.company_id === companyId && p.end_date < period.start_date)
    .sort((a, b) => b.end_date.localeCompare(a.end_date))[0] ?? null;
  const through = balancesThrough(state, companyId, period.end_date);
  const before = balancesBefore(state, companyId, period.start_date);
  const source = previous ? balancesThrough(state, companyId, previous.end_date) : null;
  const ids = new Set<string>([...through.keys(), ...before.keys(), ...(source ? source.keys() : [])]);
  const rows: any[] = [];
  for (const id of ids) {
    const account = accountsOf(state, companyId).find((a) => a.id === id);
    if (!account) continue;
    const opening = before.get(id) ?? { debit: 0n, credit: 0n };
    const closing = source?.get(id) ?? { debit: 0n, credit: 0n };
    // The trial balance presents a NET opening balance, not cumulative
    // turnover. A closed profit-or-loss account therefore shows 0/0 even
    // though it has equal historical debits and credits.
    const openingNet = opening.debit - opening.credit;
    const closingNet = closing.debit - closing.credit;
    const diff = closingNet - openingNet;
    rows.push({
      accountId: id, code: account.code, name: account.name, type: account.type,
      eligible: account.type !== 'revenue' && account.type !== 'expense',
      sourceClosingDebit: closingNet > 0n ? fmt(closingNet) : '0.0000',
      sourceClosingCredit: closingNet < 0n ? fmt(-closingNet) : '0.0000',
      openingDebit: openingNet > 0n ? fmt(openingNet) : '0.0000',
      openingCredit: openingNet < 0n ? fmt(-openingNet) : '0.0000',
      differenceDebit: diff < 0n ? fmt(-diff) : '0.0000',
      differenceCredit: diff > 0n ? fmt(diff) : '0.0000', differs: diff !== 0n,
    });
  }
  rows.sort((a, b) => a.code.localeCompare(b.code));
  const totals = {
    openingDebit: fmt(rows.reduce((s, r) => s + amt(r.openingDebit), 0n)),
    openingCredit: fmt(rows.reduce((s, r) => s + amt(r.openingCredit), 0n)),
    sourceDebit: fmt(rows.reduce((s, r) => s + amt(r.sourceClosingDebit), 0n)),
    sourceCredit: fmt(rows.reduce((s, r) => s + amt(r.sourceClosingCredit), 0n)),
  };
  const pnlOpening = rows.filter((r) => !r.eligible && (amt(r.openingDebit) !== 0n || amt(r.openingCredit) !== 0n));
  const differences = rows.filter((r) => r.differs);
  const checks = openingChecks(totals, previous, differences, pnlOpening);
  const asOf = previous?.end_date ?? period.start_date;
  const customerDocs = state.billingDocuments.filter((d) => d.company_id === companyId && d.kind === 'invoice'
    && d.status === 'issued' && d.issue_date <= asOf);
  const supplierDocs = state.purchaseDocuments.filter((d) => d.company_id === companyId
    && d.status === 'validated' && d.payment_status !== 'paid' && d.issue_date <= asOf);
  const bankRows = state.bankTransactions.filter((t) => t.company_id === companyId && t.txn_date <= asOf);
  const assetsState = (state as DemoState & { fixedAssets?: DemoFixedAssetState }).fixedAssets;
  const assets = (assetsState?.assets ?? []).filter((a) => a.company_id === companyId
    && a.acquisition_date <= asOf && !['disposed', 'written_off'].includes(a.status));
  const externalBatches = (state.fyOpeningBatches ?? []).filter((b) => b.company_id === companyId && b.period_id === periodId);
  return {
    period: periodView(period),
    previousPeriod: previous ? periodView(previous) : null,
    method: 'continuous_ledger',
    noteEn: 'The ledger is continuous: the opening balance is the sum of posted lines before the period start. No duplicate opening entry is created.',
    noteFr: 'Le grand livre est continu : le solde d’ouverture est la somme des lignes comptabilisées avant le début de la période. Aucune écriture d’ouverture en double n’est créée.',
    rows, totals, checks,
    balanced: amt(totals.openingDebit) === amt(totals.openingCredit),
    continuity: previous ? differences.length === 0 : null,
    differences, profitAndLossOpening: pnlOpening,
    preserved: {
      customerOpenItems: { count: customerDocs.length, total: fmt(customerDocs.reduce((s, d) => s + (amt(d.total_amount) - amt(d.amount_paid) - amt(d.credited_amount)), 0n)), note: 'Open customer invoices are preserved through their receivable account balances and document records.' },
      supplierOpenItems: { count: supplierDocs.length, total: fmt(supplierDocs.reduce((s, d) => s + (amt(d.total_amount) - amt(d.amount_paid) - amt(d.credited_amount)), 0n)), note: 'Open supplier documents are preserved; no separate opening subledger is created.' },
      bankUnreconciled: { count: bankRows.filter((t) => ['unmatched', 'proposed', 'review'].includes(t.status)).length, totalTransactions: bankRows.length },
      fixedAssets: { count: assets.length, grossCost: fmt(assets.reduce((s, a) => s + amt(a.cost) + amt(a.attributable_costs), 0n)), note: 'Fixed-asset costs and accumulated depreciation continue through their posted balances and batches.' },
      partnerBalances: { accounts: rows.filter((r) => r.type === 'equity').map((r) => ({ code: r.code, name: r.name, openingDebit: r.openingDebit, openingCredit: r.openingCredit })), note: 'No partner-level subledger exists yet; equity account balances continue without duplication.' },
      loans: { status: 'UNAVAILABLE', note: 'No loan module exists; any loan balance continues only through its general-ledger account.' },
    },
    externalBatch: externalBatches[0] ? batchView(state, companyId, externalBatches[0]) : null,
    externalPreview: raw ? externalPreview(state, companyId, periodId, raw) : null,
  };
}

/* -------------------------------------------------------------- checklist */

function settingsOf(state: DemoState, companyId: string): DemoFiscalYearSettings {
  state.fySettings ??= [];
  let settings = state.fySettings.find((s) => s.company_id === companyId);
  if (!settings) {
    settings = { company_id: companyId, suspense_account_ids: [], retention_months: null,
      retention_note: null, document_backup_note: null, updated_at: nowIso() };
    state.fySettings.push(settings);
  }
  return settings;
}

function checklistItems(state: DemoState, companyId: string, period: DemoPeriod, settings: DemoFiscalYearSettings) {
  const items: any[] = [];
  const add = (item: any) => items.push(item);
  const posted = state.entries.filter((e) => e.company_id === companyId && e.status === 'posted'
    && e.entry_date >= period.start_date && e.entry_date <= period.end_date);
  const drafts = state.entries.filter((e) => e.company_id === companyId && e.status === 'draft'
    && e.entry_date >= period.start_date && e.entry_date <= period.end_date);
  add({ code: 'UNPOSTED_JOURNALS', module: 'entries', labelEn: 'Unposted journals', labelFr: 'Brouillards non comptabilisés',
    state: drafts.length > 0 ? 'warning' : 'ok', count: drafts.length,
    detailEn: drafts.length > 0 ? `${drafts.length} draft entry(ies) remain in the period.` : 'No draft entry in the period.',
    detailFr: drafts.length > 0 ? `${drafts.length} brouillon(s) restent dans la période.` : 'Aucun brouillon dans la période.' });

  const balances = balancesThrough(state, companyId, period.end_date);
  let debit = 0n;
  let credit = 0n;
  for (const row of balances.values()) { debit += row.debit; credit += row.credit; }
  add({ code: 'TRIAL_BALANCE_INTEGRITY', module: 'reports', labelEn: 'Trial balance integrity', labelFr: 'Intégrité de la balance',
    state: debit === credit ? 'ok' : 'block', amount: fmt(debit - credit),
    detailEn: debit === credit ? 'Cumulative posted debits equal credits.' : 'Cumulative posted debits and credits differ.',
    detailFr: debit === credit ? 'Les débits et crédits comptabilisés cumulés sont égaux.' : 'Les débits et crédits comptabilisés cumulés diffèrent.' });

  const bankRows = state.bankTransactions.filter((t) => t.company_id === companyId
    && t.txn_date >= period.start_date && t.txn_date <= period.end_date);
  const openBank = bankRows.filter((t) => ['unmatched', 'proposed', 'review'].includes(t.status));
  add({ code: 'BANK_RECONCILIATION', module: 'bank', labelEn: 'Bank reconciliation', labelFr: 'Rapprochement bancaire',
    state: bankRows.length === 0 ? 'unavailable' : openBank.length > 0 ? 'warning' : 'ok',
    count: openBank.length,
    detailEn: bankRows.length === 0 ? 'No bank transaction imported for this period.' : `${openBank.length} bank transaction(s) not reconciled.`,
    detailFr: bankRows.length === 0 ? 'Aucune transaction bancaire importée pour cette période.' : `${openBank.length} transaction(s) bancaire(s) non rapprochée(s).` });

  if (settings.suspense_account_ids.length === 0) {
    add({ code: 'SUSPENSE_ACCOUNTS', module: 'financial_years', labelEn: 'Suspense accounts', labelFr: 'Comptes d’attente',
      state: 'pending', count: 0,
      detailEn: 'No suspense account is configured: the check cannot run.',
      detailFr: 'Aucun compte d’attente n’est configuré : le contrôle ne peut pas s’exécuter.' });
  } else {
    const open = settings.suspense_account_ids.filter((id) => {
      const row = balances.get(id);
      return row ? row.debit !== row.credit : false;
    });
    add({ code: 'SUSPENSE_ACCOUNTS', module: 'financial_years', labelEn: 'Suspense accounts', labelFr: 'Comptes d’attente',
      state: open.length > 0 ? 'warning' : 'ok', count: open.length,
      detailEn: open.length > 0 ? `${open.length} configured suspense account(s) carry a balance.` : 'Configured suspense accounts are empty.',
      detailFr: open.length > 0 ? `${open.length} compte(s) d’attente configuré(s) portent un solde.` : 'Les comptes d’attente configurés sont soldés.' });
  }

  const assetsState = (state as DemoState & { fixedAssets?: DemoFixedAssetState }).fixedAssets;
  const assets = (assetsState?.assets ?? []).filter((a) => a.company_id === companyId && a.acquisition_date <= period.end_date);
  const batches = (assetsState?.batches ?? []).filter((b) => b.company_id === companyId
    && b.period_start <= period.end_date && b.period_end >= period.start_date);
  if (assets.length === 0) {
    add({ code: 'FIXED_ASSET_DEPRECIATION', module: 'fixed_assets', labelEn: 'Depreciation', labelFr: 'Amortissements',
      state: 'unavailable', detailEn: 'No fixed asset recorded.', detailFr: 'Aucune immobilisation enregistrée.' });
  } else {
    const postedBatch = batches.some((b) => b.status === 'POSTED');
    add({ code: 'FIXED_ASSET_DEPRECIATION', module: 'fixed_assets', labelEn: 'Depreciation', labelFr: 'Amortissements',
      state: postedBatch ? 'ok' : 'pending', count: batches.length,
      detailEn: postedBatch ? 'A posted depreciation batch covers the period.' : 'No posted depreciation batch covers this period.',
      detailFr: postedBatch ? 'Un lot d’amortissement comptabilisé couvre la période.' : 'Aucun lot d’amortissement comptabilisé ne couvre cette période.' });
  }

  // Mission 22 controls are real in the demo: an empty register is pending,
  // never a false green, and never "unavailable".
  const m22 = demoMission22Checklist(state, companyId, period.end_date);
  if (m22.categories === 0) {
    add({ code: 'INVENTORY', module: 'inventory', labelEn: 'Inventory valuation and reconciliation', labelFr: 'Valorisation et rapprochement des stocks',
      state: 'pending', count: 0,
      detailEn: 'No inventory category recorded: the control cannot pass yet.',
      detailFr: 'Aucune catégorie de stock enregistrée : le contrôle ne peut pas encore réussir.' });
  } else {
    const blocking = m22.negativeBalances > 0 || m22.reconciliation?.balanced === false;
    const pending = m22.pendingMovements + m22.draftCounts + m22.pendingWriteDowns;
    add({ code: 'INVENTORY', module: 'inventory', labelEn: 'Inventory valuation and reconciliation', labelFr: 'Valorisation et rapprochement des stocks',
      state: blocking ? 'block' : pending > 0 ? 'warning' : 'ok', count: pending,
      amount: m22.reconciliation?.totalDifference ?? '0.0000',
      detailEn: blocking ? 'Negative stock or a subledger/ledger difference exists.'
        : pending > 0 ? `${pending} stock item(s) await a human decision.`
        : 'Stock valuation reconciles with the ledger; no proposal is pending.',
      detailFr: blocking ? 'Stock négatif ou écart entre sous-registre et grand livre.'
        : pending > 0 ? `${pending} élément(s) de stock attendent une décision humaine.`
        : 'La valorisation rapproche avec le grand livre ; aucune proposition en attente.' });
  }
  if (m22.schedules === 0) {
    add({ code: 'ACCRUALS_PREPAYMENTS', module: 'accruals', labelEn: 'Accruals, prepayments and deferred income', labelFr: 'Charges à payer, avances et produits différés',
      state: 'pending', count: 0,
      detailEn: 'No accrual schedule recorded: the control cannot pass yet.',
      detailFr: 'Aucun échéancier enregistré : le contrôle ne peut pas encore réussir.' });
  } else {
    const missing = m22.missingAccrualEvidence;
    const pending = m22.draftSchedules + m22.pendingAccrualLines;
    add({ code: 'ACCRUALS_PREPAYMENTS', module: 'accruals', labelEn: 'Accruals, prepayments and deferred income', labelFr: 'Charges à payer, avances et produits différés',
      state: missing > 0 ? 'block' : pending > 0 ? 'warning' : 'ok', count: pending,
      detailEn: missing > 0 ? `${missing} schedule(s) lack a supporting document.`
        : pending > 0 ? `${pending} period line(s) or draft schedule(s) require review.`
        : 'All schedules are approved and their due periods posted.',
      detailFr: missing > 0 ? `${missing} échéancier(s) sans justificatif.`
        : pending > 0 ? `${pending} ligne(s) ou échéancier(s) en attente de revue.`
        : 'Tous les échéanciers sont approuvés et leurs échéances dues comptabilisées.' });
  }
  if (m22.provisions === 0) {
    add({ code: 'PROVISIONS', module: 'provisions', labelEn: 'Provisions', labelFr: 'Provisions',
      state: 'pending', count: 0,
      detailEn: 'No provision recorded: the control cannot pass yet.',
      detailFr: 'Aucune provision enregistrée : le contrôle ne peut pas encore réussir.' });
  } else {
    const missing = m22.missingProvisionEvidence;
    add({ code: 'PROVISIONS', module: 'provisions', labelEn: 'Provisions review', labelFr: 'Revue des provisions',
      state: missing > 0 ? 'block' : m22.pendingProvisionMovements > 0 ? 'warning' : 'ok',
      count: m22.pendingProvisionMovements,
      detailEn: missing > 0 ? `${missing} provision(s) lack evidence.`
        : m22.pendingProvisionMovements > 0 ? `${m22.pendingProvisionMovements} provision movement(s) await approval or posting.`
        : 'All provision movements have been decided by a human.',
      detailFr: missing > 0 ? `${missing} provision(s) sans preuve.`
        : m22.pendingProvisionMovements > 0 ? `${m22.pendingProvisionMovements} mouvement(s) de provision en attente d’approbation ou de comptabilisation.`
        : 'Tous les mouvements de provision ont été décidés par un humain.' });
  }

  const customerDocs = state.billingDocuments.filter((d) => d.company_id === companyId && d.kind === 'invoice'
    && d.status === 'issued' && d.issue_date <= period.end_date
    && amt(d.total_amount) - amt(d.amount_paid) - amt(d.credited_amount) !== 0n);
  add({ code: 'CUSTOMER_BALANCES', module: 'billing', labelEn: 'Customer balances', labelFr: 'Soldes clients',
    state: customerDocs.length > 0 ? 'warning' : 'ok', count: customerDocs.length,
    amount: fmt(customerDocs.reduce((s, d) => s + amt(d.total_amount) - amt(d.amount_paid) - amt(d.credited_amount), 0n)),
    detailEn: `${customerDocs.length} open customer invoice(s) at period end.`,
    detailFr: `${customerDocs.length} facture(s) client ouverte(s) à la fin de la période.` });

  const supplierDocs = state.purchaseDocuments.filter((d) => d.company_id === companyId
    && d.status === 'validated' && d.issue_date <= period.end_date && d.payment_status !== 'paid');
  add({ code: 'SUPPLIER_BALANCES', module: 'purchases', labelEn: 'Supplier balances', labelFr: 'Soldes fournisseurs',
    state: supplierDocs.length > 0 ? 'warning' : 'ok', count: supplierDocs.length,
    amount: fmt(supplierDocs.reduce((s, d) => s + amt(d.total_amount) - amt(d.amount_paid) - amt(d.credited_amount), 0n)),
    detailEn: `${supplierDocs.length} open supplier document(s) at period end.`,
    detailFr: `${supplierDocs.length} document(s) fournisseur ouvert(s) à la fin de la période.` });

  const closing = (state.fiscalClosings ?? []).filter((c) => c.company_id === companyId && c.source_period_id === period.id)
    .sort((a, b) => b.version - a.version)[0];
  const allocation = closing ? (state.equityAllocations ?? []).find((a) => a.closing_id === closing.id) : null;
  add({ code: 'PROFIT_ALLOCATION', module: 'equity', labelEn: 'Profit allocation', labelFr: 'Affectation du résultat',
    state: !closing ? 'pending' : closing.status !== 'POSTED' ? 'pending' : amt(closing.result_amount) === 0n ? 'ok'
      : allocation?.status === 'POSTED' ? 'ok' : 'pending',
    amount: closing ? closing.result_amount : undefined,
    detailEn: !closing ? 'No closing has been prepared.' : closing.status !== 'POSTED' ? `Closing status: ${closing.status}.`
      : amt(closing.result_amount) === 0n ? 'Result is zero: no allocation entry is required.'
        : allocation?.status === 'POSTED' ? 'A posted allocation exists.' : 'The result is not yet allocated by a posted decision.',
    detailFr: !closing ? 'Aucune clôture n’a été préparée.' : closing.status !== 'POSTED' ? `Statut de clôture : ${closing.status}.`
      : amt(closing.result_amount) === 0n ? 'Le résultat est nul : aucune écriture d’affectation n’est requise.'
        : allocation?.status === 'POSTED' ? 'Une affectation comptabilisée existe.' : 'Le résultat n’est pas encore affecté par une décision comptabilisée.' });

  const pendingAdj = (state.fyAdjustments ?? []).filter((a) => a.company_id === companyId
    && a.source_period_id === period.id && ['PROPOSED', 'APPROVED'].includes(a.status));
  add({ code: 'PRIOR_YEAR_ADJUSTMENTS', module: 'financial_years', labelEn: 'Prior-year adjustments', labelFr: 'Ajustements antérieurs',
    state: pendingAdj.length > 0 ? 'warning' : 'ok', count: pendingAdj.length,
    detailEn: pendingAdj.length > 0 ? `${pendingAdj.length} adjustment(s) await approval or posting.` : 'No pending prior-year adjustment for this period.',
    detailFr: pendingAdj.length > 0 ? `${pendingAdj.length} ajustement(s) en attente d’approbation ou de comptabilisation.` : 'Aucun ajustement en attente pour cette période.' });

  add({ code: 'MISSING_SUPPORTING_DOCUMENTS', module: 'attachments', labelEn: 'Missing supporting documents', labelFr: 'Justificatifs manquants',
    state: 'pending', count: posted.filter((e) => !['closing', 'equity_allocation'].includes(e.source)).length,
    detailEn: 'Attachment storage is not simulated in the browser demo: this check stays pending and is never reported as passed.',
    detailFr: 'Le stockage des pièces jointes n’est pas simulé dans la démonstration : ce contrôle reste en attente et n’est jamais présenté comme réussi.' });

  const counts = items.reduce((acc: Record<string, number>, item) => { acc[item.state] = (acc[item.state] ?? 0) + 1; return acc; }, { ok: 0, warning: 0, pending: 0, unavailable: 0, block: 0 });
  return { items, counts };
}

function buildChecklist(state: DemoState, companyId: string, periodId: string) {
  const period = periodById(state, companyId, periodId);
  const settings = settingsOf(state, companyId);
  const { items, counts } = checklistItems(state, companyId, period, settings);
  const saved = (state.fyChecklists ?? []).filter((c) => c.company_id === companyId && c.period_id === periodId)
    .sort((a, b) => b.version - a.version)[0];
  return {
    id: saved?.id, version: saved?.version, status: saved?.status,
    period: periodView(period), items, counts, total: items.length,
    ready: counts.block === 0 && counts.warning === 0 && counts.pending === 0,
    createdByName: saved ? 'Utilisateur démo' : undefined,
    createdAt: saved?.created_at,
    reviewedByName: saved?.status === 'REVIEWED' ? 'Utilisateur démo' : null,
    reviewedAt: saved?.reviewed_at ?? null, reviewNote: saved?.review_note ?? null,
    noteEn: 'Unavailable or pending checks are never reported as passed. No check posts or closes anything.',
    noteFr: 'Les contrôles indisponibles ou en attente ne sont jamais présentés comme réussis. Aucun contrôle ne comptabilise ni ne clôture.',
  };
}

/* ---------------------------------------------------------------- archives */

function buildSections(state: DemoState, companyId: string, period: DemoPeriod): Record<string, any> {
  const ending = balancesThrough(state, companyId, period.end_date);
  const starting = balancesBefore(state, companyId, period.start_date);
  const rows = [...ending.keys()].sort().map((id) => {
    const account = accountsOf(state, companyId).find((a) => a.id === id);
    const end = ending.get(id)!;
    const start = starting.get(id) ?? { debit: 0n, credit: 0n };
    return {
      accountId: id, code: account?.code, name: account?.name, type: account?.type,
      openingDebit: fmt(start.debit), openingCredit: fmt(start.credit),
      closingDebit: fmt(end.debit), closingCredit: fmt(end.credit),
      closingBalance: fmt((end.debit - end.credit) - (start.debit - start.credit)),
    };
  });
  const entries = state.entries.filter((e) => e.company_id === companyId && e.status === 'posted'
    && e.entry_date >= period.start_date && e.entry_date <= period.end_date)
    .sort((a, b) => a.entry_date.localeCompare(b.entry_date) || a.entry_no.localeCompare(b.entry_no));
  const journals = {
    entries: entries.map((e) => ({
      id: e.id, entryNo: e.entry_no, entryDate: e.entry_date, reference: e.reference, description: e.description,
      source: e.source, status: e.status,
      journal: state.journals.find((j) => j.id === e.journal_id)?.code ?? null,
      lines: state.lines.filter((l) => l.entry_id === e.id).map((l) => {
        const account = accountsOf(state, companyId).find((a) => a.id === l.account_id);
        return { lineNo: l.line_no, accountCode: account?.code, accountName: account?.name,
          description: l.description, debit: l.debit, credit: l.credit };
      }),
    })),
  };
  const totalsByType: Record<string, { debit: bigint; credit: bigint }> = {};
  for (const row of rows) {
    const type = row.type ?? 'other';
    const acc = totalsByType[type] ?? { debit: 0n, credit: 0n };
    acc.debit += amt(row.closingDebit);
    acc.credit += amt(row.closingCredit);
    totalsByType[type] = acc;
  }
  const statements = {
    note: 'Demonstration summary only. No statutory presentation or Mauritian accounting standard is asserted.',
    balanceSheet: rows.filter((r) => ['asset', 'liability', 'equity'].includes(String(r.type))),
    profitAndLoss: rows.filter((r) => ['revenue', 'expense'].includes(String(r.type))),
    totals: Object.fromEntries(Object.entries(totalsByType).map(([k, v]) => [k, { debit: fmt(v.debit), credit: fmt(v.credit) }])),
  };
  const bank = state.bankTransactions.filter((t) => t.company_id === companyId
    && t.txn_date >= period.start_date && t.txn_date <= period.end_date);
  const assetsState = (state as DemoState & { fixedAssets?: DemoFixedAssetState }).fixedAssets;
  const assets = (assetsState?.assets ?? []).filter((a) => a.company_id === companyId);
  const movement = (state as any).equityMovements ?? [];
  const closings = (state.fiscalClosings ?? []).filter((c) => c.company_id === companyId && c.source_period_id === period.id);
  const allocations = (state.equityAllocations ?? []).filter((a) => a.company_id === companyId
    && closings.some((c) => c.id === a.closing_id));
  const adjustments = (state.fyAdjustments ?? []).filter((a) => a.company_id === companyId
    && (a.source_period_id === period.id || (a.adjustment_date >= period.start_date && a.adjustment_date <= period.end_date)));
  const opening = buildOpening(state, companyId, period.id);
  const settings = settingsOf(state, companyId);
  const approvals = state.audit.filter((a) => a.company_id === companyId
    && /^(closing|equity|adjustment|opening_batch|checklist|archive|fixed_asset|financial_year)\./.test(a.action)).slice(0, 500);
  return {
    trialBalance: { rows, totals: opening.totals, note: 'Cumulative posted balances at period end (demo).' },
    generalLedger: { entries: journals.entries.flatMap((e) => e.lines.map((l) => ({ ...l, entryNo: e.entryNo, entryDate: e.entryDate, journal: e.journal }))) },
    statements,
    journals,
    bankReconciliations: {
      accounts: state.bankAccounts.filter((b) => b.company_id === companyId).map((b) => ({ id: b.id, name: b.name })),
      transactions: bank.map((t) => ({ id: t.id, date: t.txn_date, label: t.label, amount: t.amount, status: t.status })),
      note: 'Demo reconciliation evidence only; no bank feed is connected.',
    },
    fixedAssets: {
      register: assets.map((a) => ({ id: a.id, code: a.asset_code, description: a.description, acquisitionDate: a.acquisition_date,
        cost: a.cost, attributableCosts: a.attributable_costs, status: a.status })),
      batches: (assetsState?.batches ?? []).filter((b) => b.company_id === companyId).map((b) => ({ id: b.id, reference: b.reference,
        periodStart: b.period_start, periodEnd: b.period_end, status: b.status, totalAmount: b.total_amount })),
      note: 'Cost and accumulated depreciation are carried by posted entries (demo).',
    },
    equity: { movements: movement.filter((m: any) => m.company_id === companyId), closings, allocations },
    adjustments,
    openingBalances: { period: opening.period, previousPeriod: opening.previousPeriod, method: opening.method,
      totals: opening.totals, checks: opening.checks, balanced: opening.balanced, continuity: opening.continuity,
      noteEn: opening.noteEn, noteFr: opening.noteFr },
    supportingDocuments: { documents: [], note: 'Scanned documents are not stored in the browser demo; their backup is external to this snapshot.' },
    approvals,
    retention: settings,
  };
}

function sealArchive(state: DemoState, companyId: string, period: DemoPeriod, note: string | null): DemoArchive {
  if (period.status !== 'closed') throw new ApiError(409, 'ARCHIVE_PERIOD_NOT_CLOSED', 'Seul un exercice clôturé peut être archivé');
  const previous = (state.fyArchives ?? []).filter((a) => a.company_id === companyId && a.period_id === period.id);
  const version = previous.reduce((max, a) => Math.max(max, a.version), 0) + 1;
  const company = state.companies.find((c) => c.id === companyId)!;
  const settings = settingsOf(state, companyId);
  const generatedAt = nowIso();
  const raw = buildSections(state, companyId, period);
  const sections = JSON.parse(JSON.stringify(raw));
  const sectionManifest = Object.keys(sections).sort().map((name) => ({
    name, sha256: demoChecksum(sections[name]), sizeBytes: demoBytes(stable(sections[name])),
  }));
  const overall = demoChecksum(sectionManifest);
  const manifest = {
    format: 'mauritius-compta-archive/v1-demo', version, algorithm: 'demo-fingerprint',
    generatedAt,
    company: { id: companyId, name: company.name, functionalCurrency: company.functional_currency },
    period: { id: period.id, name: period.name, startDate: period.start_date, endDate: period.end_date },
    sections: sectionManifest, overall,
    limitationsEn: 'This demonstration package is an immutable accounting snapshot with non-cryptographic demo fingerprints. It is not SHA-256, not a legally certified archive and it does not contain scanned documents.',
    limitationsFr: 'Ce paquet de démonstration est un instantané comptable immuable avec des empreintes de démonstration non cryptographiques. Ce n’est pas du SHA-256, ni une archive légalement certifiée, et il ne contient pas les documents scannés.',
    documentStorageEn: 'Supporting documents are not stored in the browser demo; their storage backup remains external to this snapshot.',
    documentStorageFr: 'Les justificatifs ne sont pas stockés dans la démonstration ; leur sauvegarde reste externe à cet instantané.',
  };
  const snapshot = { metadata: manifest, sections };
  const snapshotText = JSON.stringify(snapshot);
  const archive: DemoArchive = {
    id: uid(), company_id: companyId, period_id: period.id, version, status: 'SEALED', note,
    manifest, snapshot: JSON.parse(snapshotText), checksum: overall, size_bytes: demoBytes(snapshotText),
    retention_months: settings.retention_months, retention_note: settings.retention_note, created_at: generatedAt,
  };
  state.fyArchives = [...(state.fyArchives ?? []), archive];
  audit(state, companyId, 'archive.create', 'fiscal_archive', archive.id, { periodId: period.id, version, checksum: overall, demo: true });
  return archive;
}

function verifyArchive(archive: DemoArchive) {
  const sections = archive.snapshot.sections ?? {};
  const expected = new Map<string, any>((archive.manifest.sections ?? []).map((s: any) => [s.name, s]));
  const results = Object.keys(sections).sort().map((name) => {
    const checksum = demoChecksum(sections[name]);
    return { name, checksum, expected: expected.get(name)?.sha256 ?? null, ok: checksum === expected.get(name)?.sha256 };
  });
  const manifestSection = Object.keys(sections).sort().map((name) => ({
    name, sha256: demoChecksum(sections[name]), sizeBytes: demoBytes(stable(sections[name])),
  }));
  const overall = demoChecksum(manifestSection);
  return {
    archiveId: archive.id, version: archive.version, algorithm: 'demo-fingerprint', sections: results,
    overall, expectedOverall: archive.manifest.overall, overallOk: overall === archive.manifest.overall,
    ok: results.every((r) => r.ok) && overall === archive.manifest.overall && results.length === expected.size,
    noteEn: 'Verification recomputes demonstration fingerprints from the stored snapshot. It is not SHA-256 and does not prove legal certification.',
    noteFr: 'La vérification recalcule des empreintes de démonstration depuis l’instantané stocké. Ce n’est pas du SHA-256 et cela ne prouve pas une certification légale.',
  };
}

/* ------------------------------------------------------------------ seed */

export function seedDemoFinancialYears(state: DemoState): void {
  state.fySettings ??= [];
  state.fyOpeningBatches ??= [];
  state.fyAdjustments ??= [];
  state.fyChecklists ??= [];
  state.fyArchives ??= [];
  const company = state.companies[0];
  if (!company) return;
  const companyId = company.id;
  settingsOf(state, companyId);
  if (state.fyAdjustments.some((a) => a.company_id === companyId)) {
    if (!state.fyArchives.some((a) => a.company_id === companyId)) seedArchives(state, companyId);
    return;
  }
  const retained = accountsOf(state, companyId).find((a) => a.code === '3100');
  const payable = accountsOf(state, companyId).find((a) => a.code === '2100');
  const journal = state.journals.find((j) => j.company_id === companyId && j.code === 'OD');
  const source = state.periods.find((p) => p.company_id === companyId && p.start_date === '2024-07-01' && p.status === 'closed');
  if (!retained || !payable || !journal || !source) return;
  const current = state.periods.find((p) => p.company_id === companyId && p.start_date === '2025-07-01');
  if (!current) return;

  // Documented, already posted correction of a fictitious omission in the
  // closed 2024/2025 exercise. The original entries are never modified.
  const posted = pushEntry(state, companyId, journal.id, '2025-08-20',
    'Ajustement fictif sur exercice antérieur — charge omise', 'prior_year_adjustment', 'PYA-DEMO-2025-001', [
      { accountId: retained.id, description: 'Report à nouveau fictif', debit: '4000.0000' },
      { accountId: payable.id, description: 'Charge fictive à payer', credit: '4000.0000' },
    ]);
  state.fyAdjustments.push({
    id: uid(), company_id: companyId, adjustment_no: 'PYA-2025-0001', source_period_id: source.id,
    adjustment_date: '2025-08-20', journal_id: journal.id, treatment: 'retained_earnings',
    original_entry_id: null, original_reference: 'DEMO-2425-PUR',
    reason: 'Correction fictive d’une charge omise en 2024/2025, documentée pour la démonstration.',
    document_ref: 'JUSTIF-DEMO-PYA-001', status: 'POSTED', restates_comparatives: true,
    comparative_note: 'Comparatif fictif proposé ; aucune décision de présentation n’est imposée.',
    approval_note: 'Approbation fictive de démonstration.', approved_at: nowIso(), rejection_reason: null,
    entry_id: posted.id, created_at: nowIso(),
    lines: [
      { line_no: 1, account_id: retained.id, debit: '4000.0000', credit: '0.0000', description: 'Report à nouveau fictif' },
      { line_no: 2, account_id: payable.id, debit: '0.0000', credit: '4000.0000', description: 'Charge fictive à payer' },
    ],
  });
  // A second, still proposed adjustment so the approval workflow can be tried.
  state.fyAdjustments.push({
    id: uid(), company_id: companyId, adjustment_no: 'PYA-2025-0002', source_period_id: source.id,
    adjustment_date: '2025-09-05', journal_id: journal.id, treatment: 'retained_earnings',
    original_entry_id: null, original_reference: 'DEMO-2425-SAL',
    reason: 'Ajustement fictif proposé sur un produit mal rattaché, en attente de revue professionnelle.',
    document_ref: 'JUSTIF-DEMO-PYA-002', status: 'PROPOSED', restates_comparatives: false,
    comparative_note: null, approval_note: null, approved_at: null, rejection_reason: null,
    entry_id: null, created_at: nowIso(),
    lines: [
      { line_no: 1, account_id: retained.id, debit: '1500.0000', credit: '0.0000', description: 'Correction fictive proposée' },
      { line_no: 2, account_id: payable.id, debit: '0.0000', credit: '1500.0000', description: 'Contrepartie fictive proposée' },
    ],
  });
  seedArchives(state, companyId);
}

function seedArchives(state: DemoState, companyId: string) {
  for (const period of state.periods.filter((p) => p.company_id === companyId && p.status === 'closed')) {
    if (state.fyArchives?.some((a) => a.company_id === companyId && a.period_id === period.id)) continue;
    try { sealArchive(state, companyId, period, 'Archive annuelle fictive de démonstration.'); } catch { /* keep seeding */ }
  }
}

/* ---------------------------------------------------------------- handler */

export function handleDemoFinancialYears(
  state: DemoState,
  companyId: string,
  method: string,
  rest: string,
  query: Record<string, string>,
  payload: any,
): unknown {
  const company = state.companies.find((c) => c.id === companyId);
  if (!company) throw new ApiError(404, 'COMPANY_NOT_FOUND', 'Société introuvable');
  state.fySettings ??= [];
  state.fyOpeningBatches ??= [];
  state.fyAdjustments ??= [];
  state.fyChecklists ??= [];
  state.fyArchives ??= [];
  memberRole(state, companyId);
  const settings = settingsOf(state, companyId);

  if (rest === '/timeline' && method === 'GET') {
    const periods = state.periods.filter((p) => p.company_id === companyId)
      .sort((a, b) => b.start_date.localeCompare(a.start_date));
    const archives = state.fyArchives.filter((a) => a.company_id === companyId).sort((a, b) => b.created_at.localeCompare(a.created_at));
    const rows = periods.map((p) => {
      const closing = (state.fiscalClosings ?? []).filter((c) => c.company_id === companyId && c.source_period_id === p.id)
        .sort((a, b) => b.version - a.version)[0] ?? null;
      const allocation = closing ? (state.equityAllocations ?? []).find((a) => a.closing_id === closing.id) ?? null : null;
      return {
        id: p.id, name: p.name, startDate: p.start_date, endDate: p.end_date, status: p.status,
        draftEntries: state.entries.filter((e) => e.company_id === companyId && e.status === 'draft'
          && e.entry_date >= p.start_date && e.entry_date <= p.end_date).length,
        postedEntries: state.entries.filter((e) => e.company_id === companyId && e.status === 'posted'
          && e.entry_date >= p.start_date && e.entry_date <= p.end_date).length,
        closing: closing ? { id: closing.id, version: closing.version, status: closing.status,
          resultAmount: closing.result_amount, postedAt: closing.posted_at, allocation } : null,
        archives: archives.filter((a) => a.period_id === p.id).map((a) => ({ id: a.id, version: a.version, checksum: a.checksum,
          sizeBytes: a.size_bytes, createdAt: a.created_at })),
      };
    });
    // The exercise awaiting its annual closing is the earliest open one: its
    // preceding exercise is already closed. A later payroll exercise may also
    // be open for current operations and stays visible in the timeline.
    const openRows = rows.filter((r) => r.status === 'open');
    return {
      company: { id: company.id, name: company.name, functionalCurrency: company.functional_currency },
      currentPeriod: openRows[openRows.length - 1] ?? null,
      lastClosedPeriod: rows.find((r) => r.status === 'closed') ?? null,
      periods: rows,
      counts: { periods: rows.length, open: rows.filter((r) => r.status === 'open').length,
        closed: rows.filter((r) => r.status === 'closed').length, archives: archives.length },
      noteEn: 'Balances are continuous across periods. Closing entries and later carry-forward do not duplicate each other.',
      noteFr: 'Les soldes sont continus d’une période à l’autre. Les écritures de clôture et le report ne se dupliquent pas.',
    };
  }

  /* --------------------------------------------------- opening balances */
  if (rest === '/opening-balances' && method === 'GET') {
    if (!query.periodId) throw new ApiError(400, 'VALIDATION_ERROR', 'periodId est requis');
    return buildOpening(state, companyId, query.periodId);
  }
  if (rest === '/opening-balances/preview' && method === 'POST') {
    if (!payload?.periodId) throw new ApiError(400, 'VALIDATION_ERROR', 'periodId est requis');
    return buildOpening(state, companyId, payload.periodId, payload.lines ?? []);
  }
  if (rest === '/opening-balances/batches' && method === 'GET') {
    return { batches: state.fyOpeningBatches.filter((b) => b.company_id === companyId)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .map((b) => ({ id: b.id, reference: b.reference, sourceReference: b.source_reference, status: b.status,
        periodId: b.period_id, periodName: state.periods.find((p) => p.id === b.period_id)?.name ?? '',
        totalDebit: b.total_debit, totalCredit: b.total_credit,
        entryNo: state.entries.find((e) => e.id === b.entry_id)?.entry_no ?? null,
        createdAt: b.created_at, postedAt: b.posted_at })) };
  }
  if (rest === '/opening-balances/batches' && method === 'POST') {
    requireWriter(state, companyId);
    if (!payload?.periodId) throw new ApiError(400, 'VALIDATION_ERROR', 'periodId est requis');
    const period = periodById(state, companyId, String(payload.periodId));
    if (period.status === 'closed') throw new ApiError(409, 'PERIOD_CLOSED', 'La période est clôturée');
    if (state.fyOpeningBatches.some((b) => b.company_id === companyId && b.period_id === period.id && b.status !== 'POSTED')) {
      throw new ApiError(409, 'CONFLICT', 'Un lot existe déjà pour cette période');
    }
    const preview = externalPreview(state, companyId, period.id, payload.lines ?? []);
    if (!preview.balanced || preview.blocks.length > 0) {
      throw new ApiError(400, preview.blocks[0]?.code ?? 'OPENING_UNBALANCED', preview.blocks[0]?.messageFr ?? 'Lot d’ouverture invalide');
    }
    const batch: DemoOpeningBatch = {
      id: uid(), company_id: companyId, period_id: period.id,
      reference: String(payload.reference ?? '').trim(), source_reference: String(payload.sourceReference ?? '').trim(),
      journal_id: journalById(state, companyId, String(payload.journalId)).id,
      notes: payload.notes ? String(payload.notes).slice(0, 2000) : null,
      status: 'DRAFT', total_debit: preview.totals.debit, total_credit: preview.totals.credit,
      entry_id: null, approval_note: null, approved_at: null, posted_at: null, created_at: nowIso(),
      lines: preview.lines.map((l: any, index: number) => ({ id: uid(), line_no: index + 1, account_id: l.accountId,
        debit: l.debit, credit: l.credit, description: l.description })),
    };
    if (batch.reference.length < 2 || batch.source_reference.length < 2) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Référence et source obligatoires');
    }
    state.fyOpeningBatches.push(batch);
    audit(state, companyId, 'opening_batch.create', 'opening_balance_batch', batch.id, { demo: true });
    return { batch: batchView(state, companyId, batch) };
  }
  const batchMatch = /^\/opening-balances\/batches\/([0-9a-f-]{36})(?:\/(approve|post))?$/.exec(rest);
  if (batchMatch) {
    const batch = state.fyOpeningBatches.find((b) => b.id === batchMatch[1] && b.company_id === companyId);
    if (!batch) throw new ApiError(404, 'OPENING_BATCH_NOT_FOUND', 'Lot d’ouverture introuvable');
    const action = batchMatch[2];
    if (!action && method === 'GET') return { batch: batchView(state, companyId, batch) };
    if (!action && method === 'PUT') {
      requireWriter(state, companyId);
      if (batch.status !== 'DRAFT') throw new ApiError(409, 'CONFLICT', 'Seul un brouillon peut être modifié');
      const preview = externalPreview(state, companyId, batch.period_id, payload.lines ?? []);
      batch.reference = String(payload.reference ?? batch.reference).trim();
      batch.source_reference = String(payload.sourceReference ?? batch.source_reference).trim();
      batch.journal_id = journalById(state, companyId, String(payload.journalId ?? batch.journal_id)).id;
      batch.notes = payload.notes ? String(payload.notes).slice(0, 2000) : null;
      batch.total_debit = preview.totals.debit;
      batch.total_credit = preview.totals.credit;
      batch.lines = preview.lines.map((l: any, index: number) => ({ id: batch.lines[index]?.id ?? uid(), line_no: index + 1,
        account_id: l.accountId, debit: l.debit, credit: l.credit, description: l.description }));
      audit(state, companyId, 'opening_batch.update', 'opening_balance_batch', batch.id, { demo: true });
      return { batch: batchView(state, companyId, batch) };
    }
    if (!action && method === 'DELETE') {
      requireWriter(state, companyId);
      if (batch.status !== 'DRAFT') throw new ApiError(409, 'CONFLICT', 'Seul un brouillon peut être supprimé');
      state.fyOpeningBatches = state.fyOpeningBatches.filter((b) => b.id !== batch.id);
      audit(state, companyId, 'opening_batch.delete', 'opening_balance_batch', batch.id, { demo: true });
      return { ok: true };
    }
    if (action === 'approve' && method === 'POST') {
      requireManager(state, companyId);
      if (!payload?.confirm || String(payload.note ?? '').trim().length < 10) {
        throw new ApiError(400, 'FINANCIAL_YEAR_DECISION_REQUIRED', 'Confirmation et note d’au moins 10 caractères requises');
      }
      if (batch.status !== 'DRAFT') throw new ApiError(409, 'CONFLICT', 'Ce lot a déjà été décidé');
      batch.status = 'APPROVED';
      batch.approval_note = String(payload.note).trim();
      batch.approved_at = nowIso();
      audit(state, companyId, 'opening_batch.approve', 'opening_balance_batch', batch.id, { note: batch.approval_note, demo: true });
      return { batch: batchView(state, companyId, batch) };
    }
    if (action === 'post' && method === 'POST') {
      requireManager(state, companyId);
      if (batch.status !== 'APPROVED') throw new ApiError(409, 'CONFLICT', 'Le lot doit être approuvé avant comptabilisation');
      const period = periodById(state, companyId, batch.period_id);
      if (period.status === 'closed') throw new ApiError(409, 'PERIOD_CLOSED', 'La période est clôturée');
      if (state.entries.some((e) => e.company_id === companyId && e.status === 'posted' && e.entry_date < period.start_date)) {
        throw new ApiError(409, 'OPENING_ENTRIES_ALREADY_EXIST', 'Un lot d’ouverture externe n’est autorisé que sans écriture antérieure');
      }
      const entry = pushEntry(state, companyId, batch.journal_id, period.start_date,
        `Soldes d’ouverture — ${batch.reference}`, 'opening', batch.source_reference,
        batch.lines.map((l) => ({ accountId: l.account_id, description: l.description ?? batch.reference, debit: l.debit, credit: l.credit })));
      batch.status = 'POSTED';
      batch.entry_id = entry.id;
      batch.posted_at = nowIso();
      audit(state, companyId, 'opening_batch.post', 'opening_balance_batch', batch.id, { entryId: entry.id, demo: true });
      return { batch: batchView(state, companyId, batch) };
    }
    throw new ApiError(400, 'VALIDATION_ERROR', 'Action d’ouverture inconnue');
  }

  /* --------------------------------------------- opening settings (shared) */
  if (rest === '/settings' && method === 'GET') return { settings };
  if (rest === '/settings' && method === 'PUT') {
    requireWriter(state, companyId);
    if (payload?.suspenseAccountIds) {
      const ids = [...new Set((payload.suspenseAccountIds as unknown[]).map(String))];
      for (const id of ids) accountById(state, companyId, id);
      settings.suspense_account_ids = ids;
    }
    if (payload?.retentionMonths !== undefined) {
      if (payload.retentionMonths !== null && (!Number.isInteger(payload.retentionMonths) || payload.retentionMonths <= 0)) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'La durée de conservation doit être un entier positif ou null');
      }
      settings.retention_months = payload.retentionMonths;
      settings.retention_note = payload.retentionNote ? String(payload.retentionNote).slice(0, 2000) : null;
      settings.document_backup_note = payload.documentBackupNote ? String(payload.documentBackupNote).slice(0, 2000) : null;
    }
    settings.updated_at = nowIso();
    audit(state, companyId, 'financial_year.settings.update', 'fiscal_year_settings', companyId, { demo: true });
    return { settings };
  }

  /* -------------------------------------------------------- adjustments */
  if (rest === '/prior-year-adjustments' && method === 'GET') {
    return { adjustments: state.fyAdjustments.filter((a) => a.company_id === companyId)
      .sort((a, b) => b.adjustment_date.localeCompare(a.adjustment_date))
      .map((a) => adjustmentView(state, companyId, a)) };
  }
  if (rest === '/prior-year-adjustments' && method === 'POST') {
    requireWriter(state, companyId);
    const source = periodById(state, companyId, String(payload?.sourcePeriodId));
    if (source.status !== 'closed') throw new ApiError(400, 'ADJUSTMENT_SOURCE_NOT_CLOSED', 'La période source doit être clôturée');
    const date = String(payload?.adjustmentDate ?? '');
    if (!iso(date) || date <= source.end_date) throw new ApiError(400, 'ADJUSTMENT_DATE_INVALID', 'La date doit être postérieure à la période source');
    if (!['retained_earnings', 'current_year_result', 'custom'].includes(payload?.treatment)) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Traitement invalide');
    }
    const reason = String(payload?.reason ?? '').trim();
    const documentRef = String(payload?.documentRef ?? '').trim();
    const originalReference = String(payload?.originalReference ?? '').trim();
    if (reason.length < 10 || documentRef.length < 2 || originalReference.length < 1) {
      throw new ApiError(400, 'ADJUSTMENT_JUSTIFICATION_REQUIRED', 'Référence d’origine, motif (10 caractères) et justificatif requis');
    }
    const lines = (payload?.lines ?? []).map((l: any, index: number) => {
      const account = accountById(state, companyId, String(l.accountId));
      if (!account.is_active) throw new ApiError(400, 'ACCOUNT_INACTIVE', `Compte ${account.code} inactif`);
      const debit = amt(l.debit);
      const credit = amt(l.credit);
      if ((debit > 0n) === (credit > 0n)) throw new ApiError(400, 'VALIDATION_ERROR', `Ligne ${index + 1} : débit ou crédit requis`);
      return { line_no: index + 1, account_id: account.id, debit: fmt(debit), credit: fmt(credit),
        description: l.description ? String(l.description).slice(0, 500) : null, account };
    });
    if (lines.length < 2) throw new ApiError(400, 'VALIDATION_ERROR', 'Au moins deux lignes sont requises');
    const debitTotal = lines.reduce((s: bigint, l: any) => s + amt(l.debit), 0n);
    const creditTotal = lines.reduce((s: bigint, l: any) => s + amt(l.credit), 0n);
    if (debitTotal !== creditTotal) throw new ApiError(400, 'ADJUSTMENT_UNBALANCED', 'L’ajustement doit être équilibré');
    if (payload.treatment === 'retained_earnings' && !lines.some((l: any) => l.account.type === 'equity')) {
      throw new ApiError(400, 'ADJUSTMENT_EQUITY_LINE_REQUIRED', 'Un compte de capitaux propres est requis');
    }
    if (payload.treatment === 'current_year_result' && !lines.some((l: any) => ['revenue', 'expense'].includes(l.account.type))) {
      throw new ApiError(400, 'ADJUSTMENT_RESULT_LINE_REQUIRED', 'Un compte de résultat est requis');
    }
    const year = Number(date.slice(0, 4));
    const count = state.fyAdjustments.filter((a) => a.company_id === companyId && a.adjustment_no.startsWith(`PYA-${year}-`)).length;
    const adjustment: DemoPriorYearAdjustment = {
      id: uid(), company_id: companyId, adjustment_no: `PYA-${year}-${String(count + 1).padStart(4, '0')}`,
      source_period_id: source.id, adjustment_date: date,
      journal_id: journalById(state, companyId, String(payload.journalId)).id,
      treatment: payload.treatment, original_entry_id: payload.originalEntryId ?? null,
      original_reference: originalReference, reason, document_ref: documentRef, status: 'PROPOSED',
      restates_comparatives: Boolean(payload.restatesComparatives),
      comparative_note: payload.comparativeNote ? String(payload.comparativeNote).slice(0, 2000) : null,
      approval_note: null, approved_at: null, rejection_reason: null, entry_id: null, created_at: nowIso(),
      lines: lines.map(({ account: _account, ...line }: any) => line),
    };
    state.fyAdjustments.push(adjustment);
    audit(state, companyId, 'adjustment.create', 'prior_year_adjustment', adjustment.id, { adjustmentNo: adjustment.adjustment_no, demo: true });
    return { adjustment: adjustmentView(state, companyId, adjustment) };
  }
  const adjustmentMatch = /^\/prior-year-adjustments\/([0-9a-f-]{36})(?:\/(approve|reject|post|restatement))?$/.exec(rest);
  if (adjustmentMatch) {
    const adjustment = state.fyAdjustments.find((a) => a.id === adjustmentMatch[1] && a.company_id === companyId);
    if (!adjustment) throw new ApiError(404, 'ADJUSTMENT_NOT_FOUND', 'Ajustement introuvable');
    const action = adjustmentMatch[2];
    if (!action && method === 'GET') return { adjustment: adjustmentView(state, companyId, adjustment) };
    if (!action && method === 'PUT') {
      requireWriter(state, companyId);
      if (adjustment.status !== 'PROPOSED') throw new ApiError(409, 'CONFLICT', 'Seul un brouillon peut être modifié');
      Object.assign(adjustment, {
        reason: String(payload.reason ?? adjustment.reason).trim(),
        document_ref: String(payload.documentRef ?? adjustment.document_ref).trim(),
        restates_comparatives: Boolean(payload.restatesComparatives ?? adjustment.restates_comparatives),
        comparative_note: payload.comparativeNote ? String(payload.comparativeNote).slice(0, 2000) : null,
      });
      audit(state, companyId, 'adjustment.update', 'prior_year_adjustment', adjustment.id, { demo: true });
      return { adjustment: adjustmentView(state, companyId, adjustment) };
    }
    if (!action && method === 'DELETE') {
      requireWriter(state, companyId);
      if (adjustment.status !== 'PROPOSED') throw new ApiError(409, 'CONFLICT', 'Seul un brouillon peut être supprimé');
      state.fyAdjustments = state.fyAdjustments.filter((a) => a.id !== adjustment.id);
      audit(state, companyId, 'adjustment.delete', 'prior_year_adjustment', adjustment.id, { demo: true });
      return { ok: true };
    }
    if (action === 'approve' && method === 'POST') {
      requireManager(state, companyId);
      if (!payload?.confirm || String(payload.note ?? '').trim().length < 10) {
        throw new ApiError(400, 'FINANCIAL_YEAR_DECISION_REQUIRED', 'Confirmation et note d’au moins 10 caractères requises');
      }
      if (adjustment.status !== 'PROPOSED') throw new ApiError(409, 'CONFLICT', 'Cet ajustement a déjà été décidé');
      adjustment.status = 'APPROVED';
      adjustment.approval_note = String(payload.note).trim();
      adjustment.approved_at = nowIso();
      audit(state, companyId, 'adjustment.approve', 'prior_year_adjustment', adjustment.id, { note: adjustment.approval_note, demo: true });
      return { adjustment: adjustmentView(state, companyId, adjustment) };
    }
    if (action === 'reject' && method === 'POST') {
      requireManager(state, companyId);
      if (adjustment.status === 'POSTED') throw new ApiError(409, 'CONFLICT', 'Un ajustement comptabilisé ne peut être rejeté');
      if (adjustment.status === 'REJECTED') throw new ApiError(409, 'CONFLICT', 'Cet ajustement est déjà rejeté');
      adjustment.status = 'REJECTED';
      adjustment.rejection_reason = String(payload?.reason ?? '').trim() || null;
      audit(state, companyId, 'adjustment.reject', 'prior_year_adjustment', adjustment.id, { reason: adjustment.rejection_reason, demo: true });
      return { adjustment: adjustmentView(state, companyId, adjustment) };
    }
    if (action === 'post' && method === 'POST') {
      requireManager(state, companyId);
      if (adjustment.status !== 'APPROVED') throw new ApiError(409, 'CONFLICT', 'L’ajustement doit être approuvé avant comptabilisation');
      const period = state.periods.find((p) => p.company_id === companyId
        && p.start_date <= adjustment.adjustment_date && p.end_date >= adjustment.adjustment_date);
      if (!period || period.status === 'closed') throw new ApiError(409, 'PERIOD_CLOSED', 'La période de l’ajustement est clôturée ou absente');
      const entry = pushEntry(state, companyId, adjustment.journal_id, adjustment.adjustment_date,
        `Ajustement exercice antérieur ${adjustment.adjustment_no}`, 'prior_year_adjustment', adjustment.document_ref,
        adjustment.lines.map((l) => ({ accountId: l.account_id, description: l.description ?? adjustment.reason,
          debit: amt(l.debit) > 0n ? l.debit : undefined, credit: amt(l.credit) > 0n ? l.credit : undefined })));
      adjustment.status = 'POSTED';
      adjustment.entry_id = entry.id;
      audit(state, companyId, 'adjustment.post', 'prior_year_adjustment', adjustment.id, { entryId: entry.id, demo: true });
      return { adjustment: adjustmentView(state, companyId, adjustment) };
    }
    if (action === 'restatement' && method === 'GET') {
      const source = periodById(state, companyId, adjustment.source_period_id);
      const sourceEntries = state.entries.filter((e) => e.company_id === companyId && e.status === 'posted'
        && e.entry_date >= source.start_date && e.entry_date <= source.end_date && e.source !== 'closing');
      const byId = new Map<string, any>();
      for (const entry of sourceEntries) {
        for (const line of state.lines.filter((l) => l.entry_id === entry.id)) {
          const account = accountsOf(state, companyId).find((a) => a.id === line.account_id);
          if (!account || !['revenue', 'expense'].includes(account.type)) continue;
          const current = byId.get(account.id) ?? { accountId: account.id, code: account.code, name: account.name,
            type: account.type, originalDebit: 0n, originalCredit: 0n, adjustmentDebit: 0n, adjustmentCredit: 0n };
          current.originalDebit += amt(line.debit);
          current.originalCredit += amt(line.credit);
          byId.set(account.id, current);
        }
      }
      for (const line of adjustment.lines) {
        const account = accountById(state, companyId, line.account_id);
        if (!['revenue', 'expense'].includes(account.type)) continue;
        const current = byId.get(account.id) ?? { accountId: account.id, code: account.code, name: account.name,
          type: account.type, originalDebit: 0n, originalCredit: 0n, adjustmentDebit: 0n, adjustmentCredit: 0n };
        current.adjustmentDebit += amt(line.debit);
        current.adjustmentCredit += amt(line.credit);
        byId.set(account.id, current);
      }
      let originalResult = 0n;
      let adjustmentResult = 0n;
      for (const row of byId.values()) {
        if (!['revenue', 'expense'].includes(row.type)) continue;
        originalResult += (row.type === 'revenue'
          ? row.originalCredit - row.originalDebit
          : -(row.originalDebit - row.originalCredit)) as unknown as bigint;
        adjustmentResult += (row.type === 'revenue'
          ? row.adjustmentCredit - row.adjustmentDebit
          : -(row.adjustmentDebit - row.adjustmentCredit)) as unknown as bigint;
      }
      return {
        restatement: {
          adjustmentId: adjustment.id, adjustmentNo: adjustment.adjustment_no,
          sourcePeriod: periodView(source),
          originalResult: fmt(originalResult), adjustmentResult: fmt(adjustmentResult),
          restatedResult: fmt(originalResult + adjustmentResult),
          rows: [...byId.values()].map((row) => ({
            accountId: row.accountId, code: row.code, name: row.name, type: row.type,
            originalDebit: fmt(row.originalDebit), originalCredit: fmt(row.originalCredit),
            adjustmentDebit: fmt(row.adjustmentDebit), adjustmentCredit: fmt(row.adjustmentCredit),
            restatedDebit: fmt(row.originalDebit + row.adjustmentDebit),
            restatedCredit: fmt(row.originalCredit + row.adjustmentCredit),
          })),
          noteEn: 'Proposal only: the closed period and any sealed archive are unchanged. Comparative restatement is a presentation decision to validate.',
          noteFr: 'Proposition seulement : la période clôturée et toute archive scellée restent inchangées. Le retraitement comparatif est une décision de présentation à valider.',
        },
      };
    }
    throw new ApiError(400, 'VALIDATION_ERROR', 'Action d’ajustement inconnue');
  }

  /* ----------------------------------------------------------- checklist */
  if (rest === '/checklist' && method === 'GET') {
    if (!query.periodId) throw new ApiError(400, 'VALIDATION_ERROR', 'periodId est requis');
    return buildChecklist(state, companyId, query.periodId);
  }
  if (rest === '/checklists' && method === 'GET') {
    return { checklists: state.fyChecklists.filter((c) => c.company_id === companyId
      && (!query.periodId || c.period_id === query.periodId))
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .map((c) => ({ id: c.id, version: c.version, status: c.status, periodId: c.period_id,
        periodName: state.periods.find((p) => p.id === c.period_id)?.name ?? '', counts: c.counts, createdAt: c.created_at })) };
  }
  if (rest === '/checklists' && method === 'POST') {
    requireWriter(state, companyId);
    const period = periodById(state, companyId, String(payload?.periodId));
    const built = buildChecklist(state, companyId, period.id);
    const version = state.fyChecklists.filter((c) => c.company_id === companyId && c.period_id === period.id)
      .reduce((max, c) => Math.max(max, c.version), 0) + 1;
    const saved: DemoChecklist = {
      id: uid(), company_id: companyId, period_id: period.id, version, status: 'GENERATED',
      items: built.items, counts: built.counts, review_note: null, reviewed_at: null, created_at: nowIso(),
    };
    state.fyChecklists.push(saved);
    audit(state, companyId, 'checklist.generate', 'year_end_checklist', saved.id, { periodId: period.id, version, counts: saved.counts, demo: true });
    return { checklist: { ...built, id: saved.id, version, status: saved.status, createdAt: saved.created_at } };
  }
  const checklistMatch = /^\/checklists\/([0-9a-f-]{36})(?:\/review)?$/.exec(rest);
  if (checklistMatch) {
    const saved = state.fyChecklists.find((c) => c.id === checklistMatch[1] && c.company_id === companyId);
    if (!saved) throw new ApiError(404, 'CHECKLIST_NOT_FOUND', 'Contrôle de clôture introuvable');
    if (method === 'GET') {
      const built = buildChecklist(state, companyId, saved.period_id);
      return { ...built, id: saved.id, version: saved.version, status: saved.status, items: saved.items, counts: saved.counts,
        reviewNote: saved.review_note, reviewedAt: saved.reviewed_at, createdAt: saved.created_at };
    }
    if (method === 'POST' && rest.endsWith('/review')) {
      requireManager(state, companyId);
      if (!payload?.confirm || String(payload.note ?? '').trim().length < 10) {
        throw new ApiError(400, 'FINANCIAL_YEAR_DECISION_REQUIRED', 'Confirmation et note d’au moins 10 caractères requises');
      }
      if (saved.status === 'REVIEWED') throw new ApiError(409, 'CONFLICT', 'Ce contrôle est déjà revu');
      saved.status = 'REVIEWED';
      saved.review_note = String(payload.note).trim();
      saved.reviewed_at = nowIso();
      audit(state, companyId, 'checklist.review', 'year_end_checklist', saved.id, { note: saved.review_note, demo: true });
      const built = buildChecklist(state, companyId, saved.period_id);
      return { ...built, id: saved.id, version: saved.version, status: saved.status, items: saved.items, counts: saved.counts,
        reviewNote: saved.review_note, reviewedAt: saved.reviewed_at };
    }
  }

  /* ------------------------------------------------------------ archives */
  if (rest === '/archives' && method === 'GET') {
    return { archives: state.fyArchives.filter((a) => a.company_id === companyId
      && (!query.periodId || a.period_id === query.periodId))
      .sort((a, b) => b.created_at.localeCompare(a.created_at)).map(archiveView) };
  }
  if (rest === '/archives' && method === 'POST') {
    requireManager(state, companyId);
    const period = periodById(state, companyId, String(payload?.periodId));
    const archive = sealArchive(state, companyId, period, payload?.note ? String(payload.note).slice(0, 2000) : null);
    return { archive: archiveView(archive) };
  }
  const archiveMatch = /^\/archives\/([0-9a-f-]{36})(?:\/(verify|download|sections\/([a-zA-Z]+)))?$/.exec(rest);
  if (archiveMatch) {
    const archive = state.fyArchives.find((a) => a.id === archiveMatch[1] && a.company_id === companyId);
    if (!archive) throw new ApiError(404, 'ARCHIVE_NOT_FOUND', 'Archive annuelle introuvable');
    const action = archiveMatch[2];
    const sectionName = archiveMatch[3];
    if (!action && method === 'GET') return { archive: archiveView(archive) };
    if (action === 'verify' && method === 'GET') return { verification: verifyArchive(archive) };
    if (action === 'download' && method === 'GET') {
      return { fileName: `archive-demo-v${archive.version}.json`, contentType: 'application/json',
        body: JSON.stringify({ manifest: archive.manifest, snapshot: archive.snapshot }, null, 2) };
    }
    if (action?.startsWith('sections/') && method === 'GET') {
      if (!sectionName || !(sectionName in archive.snapshot.sections)) {
        throw new ApiError(404, 'ARCHIVE_SECTION_NOT_FOUND', 'Section d’archive introuvable');
      }
      return { section: sectionName, data: archive.snapshot.sections[sectionName] };
    }
  }

  throw new ApiError(404, 'NOT_FOUND', 'Route exercices & archives inconnue');
}
