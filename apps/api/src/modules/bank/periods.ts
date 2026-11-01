import type { Db } from '../../db/index.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { formatAmount, parseAmount } from '../../lib/money.js';
import { writeAudit } from '../../lib/audit.js';
import { bankReport, cabinetForCompany } from './service.js';
import { stableDigest } from './hash.js';

/**
 * Mission 43 (C-01/C-02/C-03): explicit statement reconciliation periods.
 *
 * A period stores the opening/closing statement balances and the
 * opening/closing ledger balances that were reviewed. Validation is a human
 * decision: it never posts an entry, never modifies a bank transaction and
 * never overwrites a difference. Any bank statement change after validation
 * makes the period stale (`reopened`) on the next read; the history of the
 * decision is kept in bank_reconciliation_period_events.
 */

export interface ReconciliationPeriodRow {
  id: string;
  cabinet_id: string;
  company_id: string;
  bank_account_id: string;
  period_from: string;
  period_to: string;
  currency: string;
  opening_bank: string | null;
  closing_bank: string | null;
  opening_ledger: string;
  closing_ledger: string;
  difference: string;
  accepted_difference: string;
  status: 'open' | 'validated' | 'reopened';
  statement_hash: string;
  matched_count: number;
  partial_count: number;
  unmatched_count: number;
  excluded_count: number;
  note: string | null;
  validated_by: string | null;
  validated_at: string | null;
  reopened_by: string | null;
  reopened_at: string | null;
  reopen_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface BankPeriodEvent {
  id: string;
  event: string;
  actor_id: string | null;
  actor_name?: string | null;
  note: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

interface Actor {
  userId: string;
  companyId: string;
  ip?: string;
}

function iso(value: unknown, field: string): string {
  const text = String(value ?? '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw badRequest('VALIDATION_ERROR', `${field} must be an ISO date`);
  return text;
}

async function statementHash(db: Db, bankAccountId: string, from: string, to: string): Promise<string> {
  const rows = await db.query<{
    txn_date: string;
    amount: string;
    reference: string | null;
    external_id: string | null;
    balance: string | null;
    status: string;
  }>(
    `SELECT txn_date::text, amount::text, reference, external_id, balance::text, status
       FROM bank_transactions
      WHERE bank_account_id = $1 AND txn_date >= $2::date AND txn_date <= $3::date
      ORDER BY txn_date, created_at, id`,
    [bankAccountId, from, to],
  );
  return stableDigest([
    'bank-period-v1',
    bankAccountId,
    from,
    to,
    ...rows.rows.flatMap((r) => [r.txn_date, r.amount, r.reference, r.external_id, r.balance, r.status]),
  ]);
}

async function periodRow(db: Db, companyId: string, periodId: string): Promise<ReconciliationPeriodRow> {
  const res = await db.query<ReconciliationPeriodRow>(
    `SELECT * FROM bank_reconciliation_periods WHERE id = $1 AND company_id = $2`,
    [periodId, companyId],
  );
  const row = res.rows[0];
  if (!row) throw notFound('BANK_PERIOD_NOT_FOUND', 'Reconciliation period not found');
  return row;
}

async function appendEvent(
  db: Db,
  actor: Actor,
  period: ReconciliationPeriodRow,
  event: string,
  note: string | null,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  const cabinetId = await cabinetForCompany(db, period.company_id);
  await db.query(
    `INSERT INTO bank_reconciliation_period_events
       (cabinet_id, company_id, period_id, event, actor_id, note, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)`,
    [cabinetId, period.company_id, period.id, event, actor.userId, note, JSON.stringify(metadata)],
  );
}

/**
 * Recomputes a period from the current statement/ledger and reopens it when
 * either the statement hash or the balances changed after validation.
 * Differences are never rewritten: the stored decision remains while the
 * status says the period must be reviewed again.
 */
async function refreshPeriod(
  db: Db,
  actor: Actor,
  period: ReconciliationPeriodRow,
): Promise<ReconciliationPeriodRow> {
  const report = await bankReport(db, period.company_id, period.bank_account_id, period.period_from, period.period_to);
  const hash = await statementHash(db, period.bank_account_id, period.period_from, period.period_to);
  const stale =
    period.status === 'validated' &&
    (hash !== period.statement_hash ||
      report.closingBankBalance !== (period.closing_bank === null ? null : formatAmount(parseAmount(period.closing_bank) ?? 0n)) ||
      report.closingLedgerBalance !== formatAmount(parseAmount(period.closing_ledger) ?? 0n));
  if (!stale) return period;
  const res = await db.query<ReconciliationPeriodRow>(
    `UPDATE bank_reconciliation_periods
        SET status = 'reopened', reopened_at = now(), reopen_reason = $3, updated_at = now()
      WHERE id = $1 AND company_id = $2
      RETURNING *`,
    [period.id, period.company_id, 'Bank statement or ledger changed after validation'],
  );
  const updated = res.rows[0]!;
  await appendEvent(db, actor, updated, 'period.reopened', 'Automatic reopening: period data changed', {
    previousHash: period.statement_hash,
    currentHash: hash,
  });
  return updated;
}

export interface PeriodView extends ReconciliationPeriodRow {
  events: BankPeriodEvent[];
  report?: Awaited<ReturnType<typeof bankReport>>;
}

function view(row: ReconciliationPeriodRow, events: BankPeriodEvent[], report?: Awaited<ReturnType<typeof bankReport>>): PeriodView {
  return { ...row, events, ...(report ? { report } : {}) };
}

async function eventsOf(db: Db, periodId: string): Promise<BankPeriodEvent[]> {
  const res = await db.query<BankPeriodEvent>(
    `SELECT e.id::text, e.event, e.actor_id, COALESCE(u.full_name, u.email) AS actor_name,
            e.note, e.metadata, e.created_at::text
       FROM bank_reconciliation_period_events e
       LEFT JOIN app_users u ON u.id = e.actor_id
      WHERE e.period_id = $1
      ORDER BY e.created_at, e.id`,
    [periodId],
  );
  return res.rows;
}

export async function listReconciliationPeriods(
  db: Db,
  actor: Actor,
  bankAccountId: string,
  from?: string | null,
  to?: string | null,
): Promise<PeriodView[]> {
  const res = await db.query<ReconciliationPeriodRow>(
    `SELECT * FROM bank_reconciliation_periods
      WHERE company_id = $1 AND bank_account_id = $2
        AND ($3::date IS NULL OR period_to >= $3)
        AND ($4::date IS NULL OR period_from <= $4)
      ORDER BY period_to DESC, period_from DESC`,
    [actor.companyId, bankAccountId, from ?? null, to ?? null],
  );
  const out: PeriodView[] = [];
  for (const row of res.rows) {
    const refreshed = await refreshPeriod(db, actor, row);
    out.push(view(refreshed, await eventsOf(db, refreshed.id)));
  }
  return out;
}

export async function getReconciliationPeriod(db: Db, actor: Actor, periodId: string): Promise<PeriodView> {
  const row = await periodRow(db, actor.companyId, periodId);
  const refreshed = await refreshPeriod(db, actor, row);
  const report = await bankReport(
    db,
    refreshed.company_id,
    refreshed.bank_account_id,
    refreshed.period_from,
    refreshed.period_to,
  );
  return view(refreshed, await eventsOf(db, refreshed.id), report);
}

export async function openReconciliationPeriod(
  db: Db,
  actor: Actor,
  input: { bankAccountId: string; from: string; to: string; note?: string | null },
): Promise<PeriodView> {
  const from = iso(input.from, 'from');
  const to = iso(input.to, 'to');
  if (from > to) throw badRequest('BANK_PERIOD_INVALID', 'The period start must be on or before the period end');
  const account = await db.query<{ id: string; currency: string; company_id: string }>(
    `SELECT id, currency, company_id FROM bank_accounts WHERE id = $1 AND company_id = $2`,
    [input.bankAccountId, actor.companyId],
  );
  const bank = account.rows[0];
  if (!bank) throw notFound('BANK_ACCOUNT_NOT_FOUND', 'Bank account not found');
  const report = await bankReport(db, actor.companyId, bank.id, from, to);
  const hash = await statementHash(db, bank.id, from, to);

  const existing = await db.query<ReconciliationPeriodRow>(
    `SELECT * FROM bank_reconciliation_periods
      WHERE company_id = $1 AND bank_account_id = $2 AND period_from = $3 AND period_to = $4`,
    [actor.companyId, bank.id, from, to],
  );
  let row: ReconciliationPeriodRow;
  if (existing.rows[0]) {
    if (existing.rows[0].status === 'validated') {
      throw conflict('BANK_PERIOD_ALREADY_VALIDATED', 'This period is already validated; reopen it before editing');
    }
    const res = await db.query<ReconciliationPeriodRow>(
      `UPDATE bank_reconciliation_periods
          SET statement_hash = $2, opening_bank = $3, closing_bank = $4, opening_ledger = $5,
              closing_ledger = $6, difference = $7, matched_count = $8, partial_count = $9,
              unmatched_count = $10, excluded_count = $11, note = COALESCE($12, note), updated_at = now()
        WHERE id = $1
        RETURNING *`,
      [
        existing.rows[0].id,
        hash,
        report.openingBankBalance,
        report.closingBankBalance,
        report.openingLedgerBalance,
        report.closingLedgerBalance,
        report.difference,
        report.matchedCount,
        report.partiallyMatchedCount,
        report.unmatchedCount,
        report.excludedCount,
        input.note ?? null,
      ],
    );
    row = res.rows[0]!;
    await appendEvent(db, actor, row, 'period.updated', input.note ?? null, { statementHash: hash });
  } else {
    const cabinetId = await cabinetForCompany(db, actor.companyId);
    const res = await db.query<ReconciliationPeriodRow>(
      `INSERT INTO bank_reconciliation_periods
         (cabinet_id, company_id, bank_account_id, period_from, period_to, currency,
          opening_bank, closing_bank, opening_ledger, closing_ledger, difference,
          statement_hash, matched_count, partial_count, unmatched_count, excluded_count,
          note, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
       RETURNING *`,
      [
        cabinetId,
        actor.companyId,
        bank.id,
        from,
        to,
        bank.currency,
        report.openingBankBalance,
        report.closingBankBalance,
        report.openingLedgerBalance,
        report.closingLedgerBalance,
        report.difference,
        hash,
        report.matchedCount,
        report.partiallyMatchedCount,
        report.unmatchedCount,
        report.excludedCount,
        input.note ?? null,
        actor.userId,
      ],
    );
    row = res.rows[0]!;
    await appendEvent(db, actor, row, 'period.opened', input.note ?? null, { statementHash: hash });
  }
  await writeAudit(db, {
    companyId: actor.companyId,
    userId: actor.userId,
    action: existing.rows[0] ? 'bank.period.update' : 'bank.period.open',
    entityType: 'bank_reconciliation_period',
    entityId: row.id,
    details: { from, to, statementHash: hash, difference: report.difference },
    ip: actor.ip ?? null,
  });
  return view(row, await eventsOf(db, row.id), report);
}

export async function validateReconciliationPeriod(
  db: Db,
  actor: Actor,
  periodId: string,
  input: { confirm: true; note?: string | null; acceptedDifference?: string | null },
): Promise<PeriodView> {
  const current = await periodRow(db, actor.companyId, periodId);
  const row = await refreshPeriod(db, actor, current);
  if (row.status === 'validated') throw conflict('BANK_PERIOD_ALREADY_VALIDATED', 'This period is already validated');
  const report = await bankReport(db, row.company_id, row.bank_account_id, row.period_from, row.period_to);
  if (report.closingBankBalance === null) {
    throw badRequest('BANK_PERIOD_NO_BANK_BALANCE', 'A closing statement balance is required before validation');
  }
  if (report.unmatchedCount > 0 || report.partiallyMatchedCount > 0) {
    throw conflict('BANK_PERIOD_UNMATCHED_TRANSACTIONS', 'Every bank transaction must be matched, partially matched, or excluded', {
      unmatched: report.unmatchedCount,
      partiallyMatched: report.partiallyMatchedCount,
    });
  }
  if (report.ledgerUnmatchedCount > 0) {
    throw conflict('BANK_PERIOD_UNMATCHED_LEDGER', 'Every posted bank ledger line must be reconciled before validation', {
      unmatchedLedger: report.ledgerUnmatchedCount,
    });
  }
  const difference = report.difference;
  const accepted = input.acceptedDifference === undefined || input.acceptedDifference === null
    ? formatAmount(0n)
    : formatAmount(parseAmount(String(input.acceptedDifference)) ?? 0n);
  if (difference !== '0.0000') {
    if (!input.note || input.note.trim().length < 10) {
      throw badRequest('BANK_PERIOD_DIFFERENCE_UNEXPLAINED', 'A documented note (at least 10 characters) is required to accept a difference');
    }
    if (accepted !== difference) {
      throw badRequest('BANK_PERIOD_DIFFERENCE_UNEXPLAINED', 'The accepted difference must equal the observed difference; it is never forced to zero');
    }
  } else if (accepted !== '0.0000') {
    throw badRequest('BANK_PERIOD_DIFFERENCE_INVALID', 'A zero difference cannot carry an accepted difference');
  }
  const hash = await statementHash(db, row.bank_account_id, row.period_from, row.period_to);
  const res = await db.query<ReconciliationPeriodRow>(
    `UPDATE bank_reconciliation_periods
        SET status = 'validated', opening_bank = $3, closing_bank = $4, opening_ledger = $5,
            closing_ledger = $6, difference = $7, accepted_difference = $8, statement_hash = $9,
            matched_count = $10, partial_count = $11, unmatched_count = $12, excluded_count = $13,
            note = $14, validated_by = $15, validated_at = now(), reopened_at = NULL,
            reopened_by = NULL, reopen_reason = NULL, updated_at = now()
      WHERE id = $1 AND company_id = $2
      RETURNING *`,
    [
      row.id,
      row.company_id,
      report.openingBankBalance,
      report.closingBankBalance,
      report.openingLedgerBalance,
      report.closingLedgerBalance,
      difference,
      accepted,
      hash,
      report.matchedCount,
      report.partiallyMatchedCount,
      report.unmatchedCount,
      report.excludedCount,
      input.note ?? null,
      actor.userId,
    ],
  );
  const updated = res.rows[0]!;
  await appendEvent(db, actor, updated, 'period.validated', input.note ?? null, {
    difference,
    acceptedDifference: accepted,
    statementHash: hash,
    entryCreated: false,
  });
  await writeAudit(db, {
    companyId: actor.companyId,
    userId: actor.userId,
    action: 'bank.period.validate',
    entityType: 'bank_reconciliation_period',
    entityId: updated.id,
    details: { difference, acceptedDifference: accepted, statementHash: hash, entryCreated: false },
    ip: actor.ip ?? null,
  });
  return view(updated, await eventsOf(db, updated.id), report);
}

export async function reopenReconciliationPeriod(
  db: Db,
  actor: Actor,
  periodId: string,
  input: { confirm: true; reason: string },
): Promise<PeriodView> {
  const row = await periodRow(db, actor.companyId, periodId);
  if (row.status === 'open' || row.status === 'reopened') {
    throw conflict('BANK_PERIOD_NOT_VALIDATED', 'Only a validated period can be reopened');
  }
  const reason = input.reason.trim();
  if (reason.length < 3) throw badRequest('VALIDATION_ERROR', 'A reason is required to reopen a period');
  const res = await db.query<ReconciliationPeriodRow>(
    `UPDATE bank_reconciliation_periods
        SET status = 'reopened', reopened_by = $3, reopened_at = now(), reopen_reason = $4, updated_at = now()
      WHERE id = $1 AND company_id = $2
      RETURNING *`,
    [row.id, row.company_id, actor.userId, reason],
  );
  const updated = res.rows[0]!;
  await appendEvent(db, actor, updated, 'period.reopened', reason, { entryCreated: false });
  await writeAudit(db, {
    companyId: actor.companyId,
    userId: actor.userId,
    action: 'bank.period.reopen',
    entityType: 'bank_reconciliation_period',
    entityId: updated.id,
    details: { reason, entryCreated: false },
    ip: actor.ip ?? null,
  });
  return view(updated, await eventsOf(db, updated.id));
}
