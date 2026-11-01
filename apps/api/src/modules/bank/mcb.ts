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
export type BankPdfProfileKey = 'mcb' | 'generic';

export interface McbParseResult {
  rows: McbRow[];
  openingBalance: string | null;
  closingBalance: string | null;
  warnings: { code: string; line: number | null; message: string }[];
  unparsedLines: { line: number; text: string }[];
  profile: string;
  compatibilityNote: string;
  /** Metadata printed on the statement, read before any import decision. */
  bankName: string | null;
  accountNumber: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  currency: string | null;
  profileKey: BankPdfProfileKey;
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

interface BankSignature { key: BankPdfProfileKey; name: string; pattern: RegExp }

/**
 * Known bank headers. MCB is the only profile with a dedicated parser; the
 * other signatures are metadata only and deliberately fall back to the cautious
 * generic layout reader. No signature list can prove that a layout is supported.
 */
const BANK_SIGNATURES: BankSignature[] = [
  { key: 'mcb', name: 'Mauritius Commercial Bank', pattern: /mauritius commercial bank|\bmcb\b|savings regular account/i },
  { key: 'generic', name: 'State Bank of Mauritius', pattern: /state bank of mauritius|\bsbm\b/i },
  { key: 'generic', name: 'Absa Bank (Mauritius)', pattern: /absa bank/i },
  { key: 'generic', name: 'HSBC Mauritius', pattern: /hsbc/i },
  { key: 'generic', name: 'Bank One', pattern: /bank one/i },
  { key: 'generic', name: 'AfrAsia Bank', pattern: /afrasia bank/i },
  { key: 'generic', name: 'MauBank', pattern: /maubank/i },
  { key: 'generic', name: 'Standard Chartered Mauritius', pattern: /standard chartered/i },
  { key: 'generic', name: 'SBI (Mauritius)', pattern: /state bank of india|\bsbi\b/i },
  { key: 'generic', name: 'Bank of Baroda (Mauritius)', pattern: /bank of baroda/i },
  { key: 'generic', name: 'Habib Bank', pattern: /habib bank/i },
  { key: 'generic', name: 'ABC Banking Corporation', pattern: /abc banking/i },
  { key: 'generic', name: 'Bank of China', pattern: /bank of china/i },
  { key: 'generic', name: 'Citibank', pattern: /citibank/i },
  { key: 'generic', name: 'Deutsche Bank', pattern: /deutsche bank/i },
];

function detectBank(rawText: string): { key: BankPdfProfileKey; name: string | null } {
  const head = rawText.slice(0, 3000);
  const found = BANK_SIGNATURES.find((signature) => signature.pattern.test(head));
  return found ? { key: found.key, name: found.name } : { key: 'generic', name: null };
}

function metadataDate(raw: string): string | null {
  return parseDate(raw.replace(/\s+/g, ' ').trim());
}

function readMetadata(rawText: string): {
  accountNumber: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  currency: string | null;
} {
  let accountNumber: string | null = null;
  const accountPattern =
    /(?:account\s*(?:number|no\.?|num[ée]ro)|a\/c\s*(?:no\.?)?|compte\s*(?:n[°o]|num[ée]ro)?)\s*[:#\-]?\s*([A-Z0-9*Xx][A-Z0-9*Xx\-/ ]{4,34})/i;
  for (const line of rawText.split(/\r?\n/).slice(0, 80)) {
    const match = accountPattern.exec(line);
    if (!match) continue;
    const candidate = match[1]!.replace(/\s{2,}/g, ' ').trim().replace(/[|;]+$/, '');
    if ((candidate.match(/\d/g) ?? []).length >= 4 && !/statement|period|name|address/i.test(candidate)) {
      accountNumber = candidate.slice(0, 40);
      break;
    }
  }

  const period = /(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4}|\d{1,2}\s+[A-Za-z]{3,9}\s+\d{2,4}|\d{4}-\d{2}-\d{2})\s*(?:to|au|jusqu(?:'|’)?au|[-–])\s*(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4}|\d{1,2}\s+[A-Za-z]{3,9}\s+\d{2,4}|\d{4}-\d{2}-\d{2})/i.exec(rawText);
  let periodStart: string | null = null;
  let periodEnd: string | null = null;
  if (period) {
    periodStart = metadataDate(period[1]!);
    periodEnd = metadataDate(period[2]!);
  }

  const currencyMatch = /\b(MUR|EUR|USD|GBP|ZAR|AUD|CAD|CHF|JPY)\b/.exec(rawText.slice(0, 4000));
  return {
    accountNumber,
    periodStart,
    periodEnd,
    currency: currencyMatch ? currencyMatch[1]! : null,
  };
}

export function parseMcbStatement(rawText: string): McbParseResult {
  const detected = detectBank(rawText);
  const metadata = readMetadata(rawText);
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

  const isMcb = detected.key === 'mcb';
  const finalWarnings = isMcb
    ? warnings
    : warnings.map((warning) => ({
        ...warning,
        code: warning.code.replace(/^MCB_/, 'BANK_PDF_'),
      }));
  if (!isMcb && !openingBalance && rows.length > 0) {
    finalWarnings.push({
      code: 'BANK_PDF_OPENING_MISSING',
      line: null,
      message:
        'No opening balance was found for a non-MCB layout: debit/credit direction cannot be proven from the statement alone.',
    });
  }
  if (!isMcb && !detected.name) {
    finalWarnings.push({
      code: 'BANK_PDF_BANK_UNRECOGNISED',
      line: null,
      message: 'The bank name is not recognised. The generic layout reader must not be treated as bank-specific.',
    });
  }
  return {
    rows,
    openingBalance,
    closingBalance,
    warnings: finalWarnings,
    unparsedLines,
    profile: isMcb
      ? 'MCB Savings Regular Account — initial statement layout'
      : `${detected.name ?? 'Generic bank'} — cautious generic layout`,
    compatibilityNote: isMcb
      ? 'Not asserted for every MCB account type or statement layout. Review the preview before importing.'
      : 'Generic layout only: accepted when balances and debit/credit columns are recognised. No country-wide bank format is assumed; review every line and block the import when anything is uncertain.',
    bankName: detected.name,
    accountNumber: metadata.accountNumber,
    periodStart: metadata.periodStart ?? rows[0]?.date ?? null,
    periodEnd: metadata.periodEnd ?? rows[rows.length - 1]?.date ?? null,
    currency: metadata.currency,
    profileKey: detected.key,
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
