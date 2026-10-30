import type { Db } from '../../db/index.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { formatAmount, multiply, parseAmount } from '../../lib/money.js';
import { isValidRate } from '../../lib/money.js';
import type { JournalRow } from '../../types.js';

export interface LineInput {
  accountId: string;
  description?: string | null;
  debit?: string | number | null;
  credit?: string | number | null;
}

export interface EntryInput {
  journalId: string;
  entryDate: string;
  reference?: string | null;
  description: string;
  currency?: string;
  exchangeRate?: string | number | null;
  lines: LineInput[];
}

export interface PreparedLine {
  accountId: string;
  description: string | null;
  debit: bigint;
  credit: bigint;
  txnAmount: bigint;
  fxRate: string;
}

export interface PreparedEntry {
  lines: PreparedLine[];
  debitTotal: bigint;
  creditTotal: bigint;
  txnDebitTotal: bigint;
  txnCreditTotal: bigint;
  currency: string;
  fxRate: string;
  balanced: boolean;
}

/**
 * Validates lines and converts transaction-currency amounts to functional
 * currency. No invented rate: a date-matched rate must be supplied by the user
 * whenever the entry currency differs from the company functional currency.
 */
export function prepareEntry(
  input: EntryInput,
  functionalCurrency: string,
  accountIds: Set<string>,
  activeAccountIds: Set<string>,
): PreparedEntry {
  const currency = (input.currency ?? functionalCurrency).toUpperCase();
  const isForeign = currency !== functionalCurrency;

  let fxRate = '1';
  if (isForeign) {
    if (input.exchangeRate === undefined || input.exchangeRate === null || input.exchangeRate === '') {
      throw badRequest(
        'EXCHANGE_RATE_REQUIRED',
        `An exchange rate is required for entries in ${currency}`,
      );
    }
    fxRate = String(input.exchangeRate).trim();
    if (!isValidRate(fxRate)) {
      throw badRequest('VALIDATION_ERROR', 'Exchange rate must be a positive number', [
        { path: 'exchangeRate', message: 'Invalid exchange rate' },
      ]);
    }
  }

  if (!Array.isArray(input.lines) || input.lines.length < 2) {
    throw badRequest('ENTRY_TOO_FEW_LINES', 'An entry must have at least two lines');
  }
  if (input.lines.length > 200) {
    throw badRequest('VALIDATION_ERROR', 'Too many lines (max 200)');
  }

  const prepared: PreparedLine[] = input.lines.map((line, index) => {
    if (!accountIds.has(line.accountId)) {
      throw badRequest('VALIDATION_ERROR', 'Account does not belong to this company', [
        { path: `lines.${index}.accountId`, message: 'Unknown account' },
      ]);
    }
    if (!activeAccountIds.has(line.accountId)) {
      throw badRequest('VALIDATION_ERROR', 'Account is inactive', [
        { path: `lines.${index}.accountId`, message: 'Inactive account' },
      ]);
    }

    const hasDebit = line.debit !== undefined && line.debit !== null && line.debit !== '';
    const hasCredit = line.credit !== undefined && line.credit !== null && line.credit !== '';
    if (hasDebit === hasCredit) {
      throw badRequest('VALIDATION_ERROR', 'Each line must have either a debit or a credit', [
        { path: `lines.${index}`, message: 'Exactly one of debit/credit is required' },
      ]);
    }

    let debit = 0n;
    let credit = 0n;
    try {
      debit = hasDebit ? parseAmount(line.debit) : 0n;
      credit = hasCredit ? parseAmount(line.credit) : 0n;
    } catch {
      throw badRequest('VALIDATION_ERROR', 'Invalid amount', [
        { path: `lines.${index}`, message: 'Invalid amount' },
      ]);
    }
    if (debit < 0n || credit < 0n) {
      throw badRequest('VALIDATION_ERROR', 'Amounts must be positive; use the debit/credit side', [
        { path: `lines.${index}`, message: 'Negative amounts are not allowed' },
      ]);
    }
    if (debit === 0n && credit === 0n) {
      throw badRequest('VALIDATION_ERROR', 'Amount must be greater than zero', [
        { path: `lines.${index}`, message: 'Zero amount' },
      ]);
    }

    const txnAmount = debit > 0n ? debit : credit;
    const functionalDebit = debit > 0n ? multiply(debit, fxRate) : 0n;
    const functionalCredit = credit > 0n ? multiply(credit, fxRate) : 0n;

    return {
      accountId: line.accountId,
      description: line.description?.trim() || null,
      debit: functionalDebit,
      credit: functionalCredit,
      txnAmount,
      fxRate,
    };
  });

  const debitTotal = prepared.reduce((a, l) => a + l.debit, 0n);
  const creditTotal = prepared.reduce((a, l) => a + l.credit, 0n);
  const txnDebitTotal = prepared.reduce((a, l) => a + (l.debit > 0n ? l.txnAmount : 0n), 0n);
  const txnCreditTotal = prepared.reduce((a, l) => a + (l.credit > 0n ? l.txnAmount : 0n), 0n);

  return {
    lines: prepared,
    debitTotal,
    creditTotal,
    txnDebitTotal,
    txnCreditTotal,
    currency,
    fxRate,
    balanced: debitTotal === creditTotal,
  };
}

export async function assertOpenPeriod(tx: Db, companyId: string, entryDate: string): Promise<void> {
  const closed = await tx.query(
    `SELECT 1 FROM accounting_periods
      WHERE company_id = $1 AND status = 'closed' AND start_date <= $2 AND end_date >= $2`,
    [companyId, entryDate],
  );
  if (closed.rowCount > 0) {
    throw conflict('PERIOD_CLOSED', `The accounting period containing ${entryDate} is closed`);
  }
  const open = await tx.query(
    `SELECT 1 FROM accounting_periods
      WHERE company_id = $1 AND status = 'open' AND start_date <= $2 AND end_date >= $2`,
    [companyId, entryDate],
  );
  if (open.rowCount === 0) {
    throw conflict('PERIOD_CLOSED', `No open accounting period covers ${entryDate}`);
  }
}

export async function nextEntryNo(
  tx: Db,
  companyId: string,
  journal: JournalRow,
  entryDate: string,
): Promise<string> {
  const year = Number(entryDate.slice(0, 4));
  const seq = await tx.query<{ last_no: number }>(
    `INSERT INTO entry_sequences (company_id, journal_id, year, last_no)
     VALUES ($1, $2, $3, 1)
     ON CONFLICT (company_id, journal_id, year)
     DO UPDATE SET last_no = entry_sequences.last_no + 1
     RETURNING last_no`,
    [companyId, journal.id, year],
  );
  const no = seq.rows[0]!.last_no;
  return `${journal.code}-${year}-${String(no).padStart(4, '0')}`;
}

export async function loadJournal(tx: Db, companyId: string, journalId: string): Promise<JournalRow> {
  const res = await tx.query<JournalRow>('SELECT * FROM journals WHERE id = $1 AND company_id = $2', [
    journalId,
    companyId,
  ]);
  const journal = res.rows[0];
  if (!journal) throw notFound('JOURNAL_NOT_FOUND', 'Journal not found');
  return journal;
}

export async function loadAccounts(
  tx: Db,
  companyId: string,
  ids: string[],
): Promise<{ all: Set<string>; active: Set<string> }> {
  if (ids.length === 0) return { all: new Set(), active: new Set() };
  const res = await tx.query<{ id: string; is_active: boolean }>(
    'SELECT id, is_active FROM accounts WHERE company_id = $1 AND id = ANY($2::uuid[])',
    [companyId, ids],
  );
  return {
    all: new Set(res.rows.map((r) => r.id)),
    active: new Set(res.rows.filter((r) => r.is_active).map((r) => r.id)),
  };
}

export async function insertLines(
  tx: Db,
  entryId: string,
  companyId: string,
  prepared: PreparedEntry,
): Promise<void> {
  let lineNo = 1;
  for (const line of prepared.lines) {
    await tx.query(
      `INSERT INTO journal_lines
         (entry_id, company_id, line_no, account_id, description, debit, credit,
          txn_currency, txn_amount, fx_rate)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        entryId,
        companyId,
        lineNo++,
        line.accountId,
        line.description,
        formatAmount(line.debit),
        formatAmount(line.credit),
        prepared.currency,
        formatAmount(line.txnAmount),
        prepared.fxRate,
      ],
    );
  }
}

export function describeImbalance(prepared: PreparedEntry): {
  debitTotal: string;
  creditTotal: string;
  difference: string;
} {
  return {
    debitTotal: formatAmount(prepared.debitTotal),
    creditTotal: formatAmount(prepared.creditTotal),
    difference: formatAmount(prepared.debitTotal - prepared.creditTotal),
  };
}
