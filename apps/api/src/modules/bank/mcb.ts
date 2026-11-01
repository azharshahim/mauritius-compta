/**
 * Mission 23 — native MCB PDF statement reader.
 *
 * Initial scope: the textual layout of an MCB Savings Regular Account statement
 * (the fictional test set supplied with this mission). No claim is made that
 * every MCB statement format is supported. Amounts are never recomputed: the
 * signed amount is taken from the balance movement so debit/credit direction is
 * faithful, and the printed movement is cross-checked against that movement.
 */
import { parseAmount, formatAmount } from '../../lib/money.js';

export interface McbRow {
  date: string;
  valueDate: string;
  details: string;
  debit: string;
  credit: string;
  balance: string;
  sourceLine: number;
  printedMovement?: string;
}
export interface McbParseResult {
  rows: McbRow[];
  openingBalance: string | null;
  closingBalance: string | null;
  warnings: { code: string; line: number | null; message: string }[];
  unparsedLines: { line: number; text: string }[];
  profile: string;
  compatibilityNote: string;
}

const DATE_RE = /^(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4}|\d{1,2}\s+[A-Za-z]{3,9}\s+\d{2,4}|\d{4}-\d{2}-\d{2})\b/;
const AMOUNT_RE = /-?\d{1,3}(?:,\d{3})*(?:\.\d{2})|-?\d+(?:\.\d{2})/g;
const NOISE = /^(page\s+\d+|continued|mcb|mauritius commercial bank|statement of account|savings regular account|account number|account name|statement period|date\s+value date\s+transaction details|transaction date|opening balance|closing balance|total debits|total credits|this statement|please examine)/i;

function parseDate(raw: string): string | null {
  const text = raw.trim().replace(/\s+/g, ' ');
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (m) return valid(`${m[1]}-${m[2]}-${m[3]}`);
  m = /^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})$/.exec(text);
  if (m) {
    let [, d, mo, y] = m;
    if (y!.length === 2) y = `20${y}`;
    return valid(`${y}-${mo!.padStart(2, '0')}-${d!.padStart(2, '0')}`, true);
  }
  m = /^(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{2,4})$/.exec(text);
  if (m) {
    const month = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
      .indexOf(m[2]!.slice(0, 3).toLowerCase()) + 1;
    if (!month) return null;
    let year = m[3]!;
    if (year.length === 2) year = `20${year}`;
    return valid(`${year}-${String(month).padStart(2, '0')}-${m[1]!.padStart(2, '0')}`);
  }
  return null;
}
function valid(iso: string, dayFirst = false): string | null {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  if (dayFirst && d > 12 && m > 12) return null;
  return iso;
}
function amount(raw: string): bigint | null {
  const cleaned = raw.replace(/,/g, '').replace(/\s/g, '');
  try { return parseAmount(cleaned); } catch { return null; }
}
function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function parseMcbStatement(rawText: string): McbParseResult {
  const warnings: McbParseResult['warnings'] = [];
  const unparsedLines: McbParseResult['unparsedLines'] = [];
  const rows: McbRow[] = [];
  const lines = rawText.replace(/\r/g, '').split('\n').map((l) => l.trim());
  let openingBalance: string | null = null;
  let closingBalance: string | null = null;

  const openingMatch = /opening\s*balance[^\d-]*(-?\d[\d,]*(?:\.\d{2})?)/i.exec(rawText);
  if (openingMatch) {
    const value = amount(openingMatch[1]!);
    if (value !== null) openingBalance = formatAmount(value);
  }
  const closingMatch = /closing\s*balance[^\d-]*(-?\d[\d,]*(?:\.\d{2})?)/i.exec(rawText);
  if (closingMatch) {
    const value = amount(closingMatch[1]!);
    if (value !== null) closingBalance = formatAmount(value);
  }

  const currentState: { current: McbRow | null } = { current: null };
  const pendingState: { pending: { date: string; valueDate: string; text: string; line: number } | null } = { pending: null };
  let expected: bigint | null = openingBalance ? parseAmount(openingBalance) : null;

  const startRow = (date: string, valueDate: string, rest: string, line: number) => {
    const amounts = [...rest.matchAll(AMOUNT_RE)].map((m) => m[0]);
    if (amounts.length < 2) {
      pendingState.pending = { date, valueDate, text: rest, line };
      return;
    }
    if (currentState.current) { finaliseRow(currentState.current, rows, warnings, expected); currentState.current = null; }
    const balanceRaw = amounts[amounts.length - 1]!;
    const movementRaw = amounts[amounts.length - 2]!;
    const balance = amount(balanceRaw);
    const movement = amount(movementRaw);
    if (balance === null || movement === null) {
      unparsedLines.push({ line, text: rest });
      pendingState.pending = null;
      return;
    }
    const details = rest.slice(0, rest.lastIndexOf(movementRaw)).replace(/[|;]+/g, ' ').trim();
    currentState.current = {
      date, valueDate, details: details || 'Bank transaction',
      debit: '0.0000', credit: '0.0000', balance: formatAmount(balance), sourceLine: line,
      printedMovement: formatAmount(movement),
    };
    expected = balance;
    pendingState.pending = null;
  };

  for (let index = 0; index < lines.length; index += 1) {
    const text = lines[index]!;
    if (!text) continue;
    if (/^(date\s+)?value\s+date|transaction\s+date\s+details|debit\s+credit\s+balance/i.test(text)) continue;
    if (NOISE.test(text) && !DATE_RE.test(text)) continue;

    const dateMatch = DATE_RE.exec(text);
    if (dateMatch) {
      if (currentState.current) { finaliseRow(currentState.current, rows, warnings, expected); currentState.current = null; }
      const rest = text.slice(dateMatch[0].length).trim();
      const date = parseDate(dateMatch[0]);
      let valueDate = date;
      let restAfterValue = rest;
      const secondDate = DATE_RE.exec(rest);
      if (secondDate) {
        const parsedSecond = parseDate(secondDate[0]);
        if (parsedSecond) {
          valueDate = parsedSecond;
          restAfterValue = rest.slice(secondDate[0].length).trim();
        }
      }
      if (!date || !valueDate) {
        unparsedLines.push({ line: index + 1, text });
        pendingState.pending = null;
        continue;
      }
      startRow(date, valueDate, restAfterValue, index + 1);
      continue;
    }

    if (pendingState.pending) {
      const combined = `${pendingState.pending.text} ${text}`.replace(/\s+/g, ' ').trim();
      const amounts = [...combined.matchAll(AMOUNT_RE)].map((m) => m[0]);
      if (amounts.length >= 2) {
        startRow(pendingState.pending.date, pendingState.pending.valueDate, combined, pendingState.pending.line);
        continue;
      }
      pendingState.pending.text = combined.slice(0, 600);
      continue;
    }

    if (currentState.current) {
      const trailing = [...text.matchAll(AMOUNT_RE)].map((m) => m[0]);
      const lower = text.toLowerCase();
      if (trailing.length && !/(closing|opening|total|balance carried|balance b\/f)/i.test(lower)) {
        warnings.push({ code: 'MCB_MULTILINE_AMOUNT', line: index + 1,
          message: 'A continuation line contains an amount; check that it belongs to the preceding transaction.' });
      }
      currentState.current.details = `${currentState.current.details} ${text}`.replace(/\s+/g, ' ').slice(0, 500);
    } else if (!NOISE.test(text) && text.length > 8) {
      unparsedLines.push({ line: index + 1, text });
    }
  }
  if (currentState.current) finaliseRow(currentState.current, rows, warnings, expected);
  if (pendingState.pending) unparsedLines.push({ line: (pendingState.pending as { line: number }).line, text: (pendingState.pending as { text: string }).text });
  let previous: bigint | null = openingBalance ? parseAmount(openingBalance) : null;
  for (const [i, row] of rows.entries()) {
    const balance = parseAmount(row.balance);
    if (previous !== null) {
      const delta = balance - previous;
      const printed = parseAmount(row.printedMovement ?? '0');
      if (delta > 0n) { row.credit = formatAmount(delta); row.debit = '0.0000'; }
      else if (delta < 0n) { row.debit = formatAmount(-delta); row.credit = '0.0000'; }
      if (printed !== 0n && printed !== (delta < 0n ? -delta : delta)) {
        warnings.push({ code: 'MCB_MOVEMENT_MISMATCH', line: row.sourceLine,
          message: `Printed movement ${formatAmount(printed)} differs from balance movement ${formatAmount(delta < 0n ? -delta : delta)}.` });
      }
      if (delta === 0n) {
        warnings.push({ code: 'MCB_ZERO_MOVEMENT', line: row.sourceLine,
          message: 'A transaction line has no balance movement.' });
      }
    } else if (i === 0) {
      warnings.push({ code: 'MCB_OPENING_INFERRED', line: row.sourceLine,
        message: 'No opening balance was found; the first movement cannot be signed from the statement alone.' });
    }
    previous = balance;
  }
  if (rows.length && closingBalance && parseAmount(rows[rows.length - 1]!.balance) !== parseAmount(closingBalance)) {
    warnings.push({ code: 'MCB_CLOSING_MISMATCH', line: null,
      message: `Last transaction balance (${rows[rows.length - 1]!.balance}) differs from the printed closing balance (${closingBalance}).` });
  }
  if (!rows.length) warnings.push({ code: 'MCB_NO_TRANSACTIONS', line: null,
    message: 'No transaction line was recognised in this PDF.' });

  return {
    rows, openingBalance, closingBalance, warnings, unparsedLines,
    profile: 'MCB Savings Regular Account — initial statement layout',
    compatibilityNote: 'Not asserted for every MCB account type or statement layout. Review the preview before importing.',
  };
}

function finaliseRow(row: McbRow, rows: McbRow[], warnings: McbParseResult['warnings'], _expected: bigint | null) {
  if (!row.details.trim()) row.details = 'Bank transaction';
  rows.push(row);
}

/** Converts the parsed statement into the existing bank import CSV shape. */
export function mcbRowsToCsv(rows: McbRow[]): string {
  const header = ['Transaction Date', 'Value Date', 'Transaction Details', 'Debit', 'Credit', 'Balance'];
  const body = rows.map((row) => [
    row.date, row.valueDate, row.details,
    row.debit === '0.0000' ? '' : row.debit,
    row.credit === '0.0000' ? '' : row.credit,
    row.balance,
  ].map(csvCell).join(','));
  return [header.join(','), ...body].join('\n');
}

export const MCB_MAPPING = {
  txnDate: 'Transaction Date', valueDate: 'Value Date', label: 'Transaction Details',
  debit: 'Debit', credit: 'Credit', balance: 'Balance',
};
