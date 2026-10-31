import { stableDigest } from './hash.js';
import {
  formatScaled,
  isCreditIndicator,
  normalizeHeader,
  parseAmount,
  parseDate,
} from '../migration/normalize.js';
import type { SheetData } from '../migration/parse.js';

/**
 * Deterministic bank statement engine.
 *
 * It never posts anything: it turns a sheet into signed bank transactions,
 * reports every anomaly and refuses to guess a missing/contradictory amount.
 *
 * Sign convention (documented and tested):
 *   positive amount = money in (credit of the bank statement)
 *   negative amount = money out (debit of the bank statement)
 */

export interface BankFinding {
  severity: 'error' | 'warning' | 'info';
  code: string;
  rowNumber: number | null;
  messageFr: string;
  messageEn: string;
  details?: Record<string, unknown>;
}

export interface BankTransactionDraft {
  rowNumber: number;
  txnDate: string | null;
  valueDate: string | null;
  label: string;
  reference: string | null;
  amount: string;
  currency: string;
  balance: string | null;
  externalId: string | null;
  fingerprint: string;
  action: 'import' | 'skip';
  duplicate: boolean;
  duplicateOfRow: number | null;
}

export interface BankPreview {
  transactions: BankTransactionDraft[];
  findings: BankFinding[];
  summary: {
    total: number;
    importable: number;
    duplicates: number;
    alreadyImported: number;
    errors: number;
    warnings: number;
  };
  blocksImport: boolean;
  totals: { in: string; out: string; net: string };
  balances: {
    opening: string | null;
    closing: string | null;
    computedClosing: string | null;
    consistent: boolean | null;
  };
  currencies: string[];
}

export interface BankImportOptions {
  accountId: string;
  accountCurrency: string;
  companyCurrency?: string;
  dayFirst?: boolean;
  /** Fingerprints already stored for this bank account (re-import detection). */
  existingFingerprints?: string[];
  /** ISO ranges of open accounting periods. */
  openPeriods?: { startDate: string; endDate: string }[];
  openingBalance?: string | null;
  closingBalance?: string | null;
}

const MAX_LABEL = 240;
const MAX_REFERENCE = 120;

function finding(
  severity: BankFinding['severity'],
  code: string,
  rowNumber: number | null,
  messageFr: string,
  messageEn: string,
  details?: Record<string, unknown>,
): BankFinding {
  return { severity, code, rowNumber, messageFr, messageEn, ...(details ? { details } : {}) };
}

function cell(row: string[], headers: string[], mapping: Record<string, string>, field: string): string {
  const header = mapping[field];
  if (!header) return '';
  const index = headers.findIndex((h) => h === header);
  if (index < 0) return '';
  return (row[index] ?? '').trim();
}

/** Extracts the signed 4-decimal amount of one row, or a stable error code. */
export function signedAmountOf(
  read: (field: string) => string,
): { amount: bigint } | { error: 'INVALID_AMOUNT' | 'BOTH_DEBIT_CREDIT' | 'ZERO_AMOUNT' | 'INVALID_INDICATOR'; detail?: string } {
  const debitRaw = read('debit');
  const creditRaw = read('credit');
  const amountRaw = read('amount');
  const direction = read('direction');

  const debit = debitRaw ? parseAmount(debitRaw) : null;
  const credit = creditRaw ? parseAmount(creditRaw) : null;
  const signed = amountRaw ? parseAmount(amountRaw) : null;

  if (debitRaw && debit === null) return { error: 'INVALID_AMOUNT', detail: debitRaw };
  if (creditRaw && credit === null) return { error: 'INVALID_AMOUNT', detail: creditRaw };
  if (amountRaw && signed === null) return { error: 'INVALID_AMOUNT', detail: amountRaw };
  if (debit && credit) return { error: 'BOTH_DEBIT_CREDIT' };

  let amount: bigint | null = null;
  if (debit && debit > 0n) amount = -debit;
  else if (credit && credit > 0n) amount = credit;
  else if (signed !== null && signed !== 0n) amount = signed;
  else if ((debit !== null || credit !== null) && !debit && !credit) return { error: 'ZERO_AMOUNT' };

  if (amount === null) {
    return { error: amountRaw || debitRaw || creditRaw ? 'ZERO_AMOUNT' : 'INVALID_AMOUNT' };
  }

  if (direction) {
    const creditIndicator = isCreditIndicator(direction);
    if (creditIndicator === null) return { error: 'INVALID_INDICATOR', detail: direction };
    amount = creditIndicator ? (amount < 0n ? -amount : amount) : amount > 0n ? -amount : amount;
  }
  if (amount === 0n) return { error: 'ZERO_AMOUNT' };
  return { amount };
}

export function bankFingerprint(input: {
  accountId: string;
  externalId?: string | null;
  txnDate: string;
  label: string;
  amount: bigint;
  currency: string;
  balance?: bigint | null;
}): string {
  const external = input.externalId?.trim();
  return stableDigest([
    'bank',
    input.accountId,
    external ? `id:${normalizeHeader(external)}` : '',
    input.txnDate,
    normalizeHeader(input.label),
    formatScaled(input.amount),
    input.currency,
    external ? '' : input.balance === null || input.balance === undefined ? '' : formatScaled(input.balance),
  ]);
}

export function buildBankPreview(
  sheet: SheetData,
  mapping: Record<string, string>,
  options: BankImportOptions,
): BankPreview {
  const findings: BankFinding[] = [];
  const transactions: BankTransactionDraft[] = [];
  const accountCurrency = options.accountCurrency.toUpperCase();
  const existing = new Set(options.existingFingerprints ?? []);
  const dayFirst = options.dayFirst ?? true;

  const required: { key: string; label: string }[] = [
    { key: 'txnDate', label: 'date' },
    { key: 'label', label: 'label' },
  ];
  for (const field of required) {
    if (!mapping[field.key]) {
      findings.push(
        finding(
          'error',
          'MISSING_REQUIRED_COLUMN',
          null,
          `La colonne obligatoire « ${field.key === 'txnDate' ? 'date d’opération' : 'libellé'} » n’est pas associée.`,
          `The mandatory “${field.label}” column is not mapped.`,
        ),
      );
    }
  }
  const hasAmount =
    Boolean(mapping.debit) || Boolean(mapping.credit) || Boolean(mapping.amount);
  if (!hasAmount) {
    findings.push(
      finding(
        'error',
        'MISSING_AMOUNT_COLUMN',
        null,
        'Aucune colonne de montant (débit, crédit ou montant signé) n’est associée.',
        'No amount column (debit, credit or signed amount) is mapped.',
      ),
    );
  }
  if (!options.accountCurrency || !/^[A-Z]{3}$/.test(accountCurrency)) {
    findings.push(
      finding('error', 'INVALID_ACCOUNT_CURRENCY', null, 'La devise du compte bancaire est invalide.', 'The bank account currency is invalid.'),
    );
  }

  const seenFingerprints = new Map<string, number>();
  const seenExternalIds = new Map<string, { fingerprint: string; rowNumber: number }>();
  let totalIn = 0n;
  let totalOut = 0n;
  let running: bigint | null = null;
  let firstOpening: bigint | null = null;
  let lastBalance: bigint | null = null;
  let balanceBroken = false;
  const currencies = new Set<string>();

  sheet.rows.forEach((row, index) => {
    const rowNumber = index + 2; // header is row 1 in the source file
    const isEmpty = row.every((v) => !v.trim());
    if (isEmpty) return;

    const read = (field: string) => cell(row, sheet.headers, mapping, field);
    const dateRaw = read('txnDate');
    const valueRaw = read('valueDate');
    const label = read('label').slice(0, MAX_LABEL);
    const reference = read('reference').slice(0, MAX_REFERENCE) || null;
    const currencyRaw = read('currency').toUpperCase();
    const externalId = read('externalId').slice(0, 120) || null;
    const balanceRaw = read('balance');

    if (!dateRaw && !label) return;
    if (!dateRaw) {
      findings.push(
        finding('error', 'INVALID_DATE', rowNumber, 'La date d’opération est absente.', 'The transaction date is missing.'),
      );
      return;
    }
    if (!label && !reference) {
      findings.push(
        finding('error', 'MISSING_LABEL', rowNumber, 'Le libellé et la référence sont tous deux absents.', 'Both description and reference are missing.'),
      );
      return;
    }
    const txnDate = parseDate(dateRaw, { dayFirst });
    if (!txnDate) {
      findings.push(
        finding(
          'error',
          'INVALID_DATE',
          rowNumber,
          `La date « ${dateRaw} » est invalide ou ambiguë.`,
          `The date “${dateRaw}” is invalid or ambiguous.`,
          { value: dateRaw },
        ),
      );
      return;
    }
    const valueDate = valueRaw ? parseDate(valueRaw, { dayFirst }) : null;
    if (valueRaw && !valueDate) {
      findings.push(
        finding('warning', 'INVALID_VALUE_DATE', rowNumber, `La date de valeur « ${valueRaw} » est invalide ; elle est ignorée.`, `The value date “${valueRaw}” is invalid and ignored.`),
      );
    }

    const signed = signedAmountOf(read);
    if ('error' in signed) {
      const messages: Record<string, [string, string]> = {
        INVALID_AMOUNT: ['Le montant est illisible.', 'The amount cannot be read.'],
        BOTH_DEBIT_CREDIT: ['Débit et crédit sont renseignés sur la même ligne.', 'Debit and credit are both filled on the same row.'],
        ZERO_AMOUNT: ['Le montant est nul.', 'The amount is zero.'],
        INVALID_INDICATOR: ['Le sens débit/crédit est inconnu.', 'The debit/credit indicator is unknown.'],
      };
      const [fr, en] = messages[signed.error] ?? ['Montant invalide.', 'Invalid amount.'];
      findings.push(finding('error', signed.error, rowNumber, fr, en, signed.detail ? { value: signed.detail } : undefined));
      return;
    }

    const currency = (currencyRaw || accountCurrency).toUpperCase();
    currencies.add(currency);
    if (currency !== accountCurrency) {
      findings.push(
        finding(
          'error',
          'CURRENCY_MISMATCH',
          rowNumber,
          `La devise ${currency} ne correspond pas à celle du compte (${accountCurrency}). Aucune conversion n’est inventée.`,
          `Currency ${currency} does not match the account currency (${accountCurrency}). No conversion is invented.`,
          { currency, accountCurrency },
        ),
      );
      return;
    }

    const balance = balanceRaw ? parseAmount(balanceRaw) : null;
    if (balanceRaw && balance === null) {
      findings.push(
        finding('error', 'INVALID_BALANCE', rowNumber, `Le solde « ${balanceRaw} » est illisible.`, `The balance “${balanceRaw}” cannot be read.`),
      );
      return;
    }

    const fingerprint = bankFingerprint({
      accountId: options.accountId,
      externalId,
      txnDate,
      label: label || reference || '',
      amount: signed.amount,
      currency,
      balance,
    });

    if (externalId) {
      const known = seenExternalIds.get(externalId);
      if (known && known.fingerprint !== fingerprint) {
        findings.push(
          finding(
            'error',
            'REFERENCE_CONFLICT',
            rowNumber,
            `L’identifiant « ${externalId} » est réutilisé avec un contenu différent (ligne ${known.rowNumber}).`,
            `Identifier “${externalId}” is reused with a different content (row ${known.rowNumber}).`,
            { externalId, firstRow: known.rowNumber },
          ),
        );
        return;
      }
      if (!known) seenExternalIds.set(externalId, { fingerprint, rowNumber });
    }

    let action: 'import' | 'skip' = 'import';
    let duplicate = false;
    let duplicateOfRow: number | null = null;
    if (seenFingerprints.has(fingerprint)) {
      duplicate = true;
      duplicateOfRow = seenFingerprints.get(fingerprint) ?? null;
      action = 'skip';
      findings.push(
        finding(
          'warning',
          'DUPLICATE_IN_FILE',
          rowNumber,
          `Opération identique à la ligne ${duplicateOfRow} : elle sera ignorée.`,
          `Transaction identical to row ${duplicateOfRow}: it will be skipped.`,
          { duplicateOfRow },
        ),
      );
    } else {
      seenFingerprints.set(fingerprint, rowNumber);
      if (existing.has(fingerprint)) {
        action = 'skip';
        duplicate = true;
        findings.push(
          finding(
            'info',
            'ALREADY_IMPORTED',
            rowNumber,
            'Cette opération a déjà été importée (même empreinte) : elle est ignorée.',
            'This transaction was already imported (same fingerprint): skipped.',
          ),
        );
      }
    }

    if (balance !== null) {
      if (firstOpening === null) {
        firstOpening = balance - signed.amount;
        running = balance;
      } else if (running !== null) {
        const expected = running + signed.amount;
        if (expected !== balance) {
          balanceBroken = true;
          findings.push(
            finding(
              'error',
              'BALANCE_MISMATCH',
              rowNumber,
              `Solde incohérent : attendu ${formatScaled(expected)}, lu ${formatScaled(balance)}. Le montant bancaire n’est pas corrigé.`,
              `Inconsistent balance: expected ${formatScaled(expected)}, read ${formatScaled(balance)}. The bank amount is not adjusted.`,
              { expected: formatScaled(expected), actual: formatScaled(balance) },
            ),
          );
        }
        running = balance;
      }
      lastBalance = balance;
    }

    if (signed.amount > 0n) totalIn += signed.amount;
    else totalOut += -signed.amount;

    transactions.push({
      rowNumber,
      txnDate,
      valueDate,
      label: label || reference || '',
      reference,
      amount: formatScaled(signed.amount),
      currency,
      balance: balance === null ? null : formatScaled(balance),
      externalId,
      fingerprint,
      action,
      duplicate,
      duplicateOfRow,
    });
  });

  const sum = transactions.reduce((acc, t) => acc + parseAmount(t.amount)!, 0n);
  const computedClosing = firstOpening === null ? null : firstOpening + sum;
  let consistent: boolean | null = null;

  if (firstOpening !== null && lastBalance !== null) {
    consistent = computedClosing === lastBalance && !balanceBroken;
    if (!consistent && !balanceBroken) {
      findings.push(
        finding(
          'error',
          'CLOSING_BALANCE_MISMATCH',
          null,
          `Le solde final calculé (${formatScaled(computedClosing!)}) diffère du solde lu (${formatScaled(lastBalance)}).`,
          `The computed closing balance (${formatScaled(computedClosing!)}) differs from the read balance (${formatScaled(lastBalance)}).`,
        ),
      );
    }
  }
  if (options.openingBalance) {
    const declared = parseAmount(options.openingBalance);
    if (declared !== null && firstOpening !== null && declared !== firstOpening) {
      findings.push(
        finding(
          'error',
          'OPENING_BALANCE_MISMATCH',
          null,
          `Le solde d’ouverture déclaré (${formatScaled(declared)}) diffère du solde déduit (${formatScaled(firstOpening)}).`,
          `The declared opening balance (${formatScaled(declared)}) differs from the inferred one (${formatScaled(firstOpening)}).`,
        ),
      );
    }
  }
  if (options.closingBalance) {
    const declared = parseAmount(options.closingBalance);
    if (declared !== null && lastBalance !== null && declared !== lastBalance) {
      findings.push(
        finding(
          'error',
          'CLOSING_BALANCE_MISMATCH',
          null,
          `Le solde de clôture déclaré (${formatScaled(declared)}) diffère du solde lu (${formatScaled(lastBalance)}).`,
          `The declared closing balance (${formatScaled(declared)}) differs from the read balance (${formatScaled(lastBalance)}).`,
        ),
      );
    }
  }

  if (firstOpening === null && transactions.length > 0) {
    findings.push(
      finding(
        'info',
        'NO_BALANCE_COLUMN',
        null,
        'Aucun solde n’est fourni : seule la cohérence des montants est vérifiée.',
        'No balance is provided: only amounts are checked.',
      ),
    );
  }

  if (options.openPeriods && transactions.length > 0) {
    const outside = transactions.filter(
      (t) =>
        t.txnDate &&
        !options.openPeriods!.some((p) => p.startDate <= t.txnDate! && p.endDate >= t.txnDate!),
    );
    if (outside.length > 0) {
      findings.push(
        finding(
          'warning',
          'NO_OPEN_PERIOD',
          outside[0]!.rowNumber,
          `${outside.length} opération(s) ne tombent dans aucune période comptable ouverte. Import possible, comptabilisation ultérieure bloquée.`,
          `${outside.length} transaction(s) fall outside any open accounting period. Import is allowed, later posting is blocked.`,
        ),
      );
    }
  }

  const errors = findings.filter((f) => f.severity === 'error').length;
  const warnings = findings.filter((f) => f.severity === 'warning').length;
  return {
    transactions,
    findings,
    summary: {
      total: transactions.length,
      importable: transactions.filter((t) => t.action === 'import').length,
      duplicates: transactions.filter((t) => t.duplicate).length,
      alreadyImported: findings.filter((f) => f.code === 'ALREADY_IMPORTED').length,
      errors,
      warnings,
    },
    blocksImport: errors > 0,
    totals: {
      in: formatScaled(totalIn),
      out: formatScaled(totalOut),
      net: formatScaled(totalIn - totalOut),
    },
    balances: {
      opening: firstOpening === null ? null : formatScaled(firstOpening),
      closing: lastBalance === null ? null : formatScaled(lastBalance),
      computedClosing: computedClosing === null ? null : formatScaled(computedClosing),
      consistent,
    },
    currencies: [...currencies],
  };
}
