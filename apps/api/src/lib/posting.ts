import type { Db } from '../db/index.js';
import { badRequest } from './errors.js';
import type { EntryRow } from '../types.js';
import {
  assertOpenPeriod,
  describeImbalance,
  insertLines,
  loadAccounts,
  loadJournal,
  nextEntryNo,
  prepareEntry,
  type EntryInput,
} from '../modules/entries/service.js';

/**
 * Single posting service.
 *
 * Every journal entry of the suite - written by hand, generated from a billing
 * document or accepted from an AI proposal - goes through this function. The
 * billing and AI modules therefore never build SQL of their own, never balance
 * amounts by themselves and can never bypass the accounting engine:
 *
 *  - accounts must exist in the company chart and be active;
 *  - amounts are exact decimals (scale 4) converted with the supplied rate;
 *  - a posted entry must be balanced and fall inside an open period;
 *  - the entry number comes from the same atomic sequence as manual entries.
 */
export interface PostingLine {
  accountId: string;
  description?: string | null;
  debit?: string | number | null;
  credit?: string | number | null;
}

export type PostingSource =
  | 'manual'
  | 'reversal'
  | 'opening'
  | 'billing'
  | 'ai'
  | 'migration'
  | 'migration_opening';

export interface PostingParams {
  companyId: string;
  userId: string;
  journalId: string;
  entryDate: string;
  description: string;
  reference?: string | null;
  currency?: string | null;
  exchangeRate?: string | number | null;
  lines: PostingLine[];
  source: PostingSource;
  /** Defaults to `posted`: the billing and AI flows always create a real entry. */
  status?: 'draft' | 'posted';
}

export interface PostingResult {
  entry: EntryRow;
  balanced: boolean;
  totalDebit: string;
  totalCredit: string;
}

export async function postEntryTx(tx: Db, params: PostingParams): Promise<PostingResult> {
  if (!params.description || !params.description.trim()) {
    throw badRequest('VALIDATION_ERROR', 'A description is required');
  }
  const status = params.status ?? 'posted';
  const journal = await loadJournal(tx, params.companyId, params.journalId);
  if (!journal.is_active) throw badRequest('VALIDATION_ERROR', 'Journal is inactive');

  const accountIds = [...new Set(params.lines.map((l) => l.accountId))];
  const { all, active } = await loadAccounts(tx, params.companyId, accountIds);

  const input: EntryInput = {
    journalId: journal.id,
    entryDate: params.entryDate,
    reference: params.reference ?? null,
    description: params.description.trim(),
    currency: params.currency ?? undefined,
    exchangeRate: params.exchangeRate ?? null,
    lines: params.lines,
  };
  const prepared = prepareEntry(
    input,
    (await tx.query<{ functional_currency: string }>(
      'SELECT functional_currency FROM companies WHERE id = $1',
      [params.companyId],
    )).rows[0]!.functional_currency,
    all,
    active,
  );

  if (status === 'posted') {
    if (!prepared.balanced) {
      throw badRequest('ENTRY_UNBALANCED', 'Debit and credit totals must be equal', {
        ...describeImbalance(prepared),
      });
    }
    await assertOpenPeriod(tx, params.companyId, params.entryDate);
  }

  const entryNo = await nextEntryNo(tx, params.companyId, journal, params.entryDate);
  const inserted = await tx.query<EntryRow>(
    `INSERT INTO journal_entries
       (company_id, journal_id, entry_no, entry_date, reference, description, currency,
        exchange_rate, status, source, created_by, posted_at, posted_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     RETURNING *`,
    [
      params.companyId,
      journal.id,
      entryNo,
      params.entryDate,
      params.reference?.trim() || null,
      params.description.trim(),
      prepared.currency,
      prepared.fxRate,
      status,
      params.source,
      params.userId,
      status === 'posted' ? new Date() : null,
      status === 'posted' ? params.userId : null,
    ],
  );
  const entry = inserted.rows[0]!;
  await insertLines(tx, entry.id, params.companyId, prepared);

  return {
    entry,
    balanced: prepared.balanced,
    totalDebit: String(prepared.debitTotal),
    totalCredit: String(prepared.creditTotal),
  };
}

/**
 * Locks a billing row (`SELECT ... FOR UPDATE`) before reading its accounting
 * link. Two concurrent "post" requests are serialised, so the second one sees
 * the first entry and is rejected as a duplicate instead of creating a second
 * entry.
 */
export async function lockRow(
  tx: Db,
  table: 'billing_documents' | 'billing_payments',
  id: string,
  companyId: string,
): Promise<Record<string, unknown> | null> {
  const res = await tx.query(
    `SELECT * FROM ${table} WHERE id = $1 AND company_id = $2 FOR UPDATE`,
    [id, companyId],
  );
  return res.rows[0] ?? null;
}
