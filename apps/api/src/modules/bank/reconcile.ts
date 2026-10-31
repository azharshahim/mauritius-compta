import { formatAmount, parseAmount } from '../../lib/money.js';
import { normalizeHeader } from '../migration/normalize.js';

/**
 * Reconciliation engine: bank transaction -> bank line of an existing posted
 * journal entry. It only *proposes*; a human confirms every match.
 *
 * Deliberate V1 limits (blocked with an explicit reason instead of a wrong
 * match):
 *  - a bank transaction split across several entries is not guessed;
 *  - several transactions matching one entry line (a partial payment series)
 *    is blocked, because the ledger line would be consumed twice;
 *  - a foreign-currency line without the original transaction amount/rate is
 *    sent to review, never converted with an invented rate.
 * One transaction against several lines of the same entry is supported through
 * an explicit `split` proposal and a human acceptance.
 */

export interface LedgerBankLine {
  entryId: string;
  lineId: string;
  entryNo: string;
  entryDate: string;
  reference: string | null;
  description: string | null;
  accountId: string;
  debit: string;
  credit: string;
  currency: string;
  txnCurrency: string | null;
  txnAmount: string | null;
  /** A confirmed match already consumes this line. */
  matched?: boolean;
}

export interface BankTransactionRef {
  id: string;
  txnDate: string;
  label: string;
  reference: string | null;
  amount: string;
  currency: string;
}

export interface MatchCandidate {
  entryId: string;
  lineId: string;
  entryNo: string;
  entryDate: string;
  reference: string | null;
  description: string | null;
  amount: string;
  score: number;
  reasons: string[];
  kind: 'exact' | 'partial' | 'fx';
}

export interface SplitCandidate {
  entryId: string;
  entryNo: string;
  entryDate: string;
  lineIds: string[];
  total: string;
  score: number;
  reasons: string[];
}

export interface MatchSuggestion {
  status: 'none' | 'proposed' | 'ambiguous' | 'review';
  candidates: MatchCandidate[];
  split: SplitCandidate | null;
  reasonCode: string | null;
  reasonFr: string | null;
  reasonEn: string | null;
}

export interface ReconOptions {
  windowDays?: number;
  companyCurrency: string;
}

const DAY = 86_400_000;

function daysBetween(a: string, b: string): number {
  return Math.abs((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / DAY);
}

function movementOf(line: LedgerBankLine, txnCurrency: string, companyCurrency: string): bigint | null {
  const debit = parseAmount(line.debit) ?? 0n;
  const credit = parseAmount(line.credit) ?? 0n;
  if (txnCurrency === companyCurrency) return debit - credit;
  if (line.txnCurrency && line.txnCurrency === txnCurrency && line.txnAmount) {
    const native = parseAmount(line.txnAmount);
    if (native === null) return null;
    return debit > 0n ? native : credit > 0n ? -native : null;
  }
  return null;
}

function referenceHit(txn: BankTransactionRef, line: LedgerBankLine, invoiceRefs: string[]): boolean {
  const haystack = normalizeHeader(`${txn.label} ${txn.reference ?? ''}`);
  const refs = [line.reference, ...invoiceRefs].filter((r): r is string => Boolean(r && r.trim()));
  return refs.some((ref) => {
    const needle = normalizeHeader(ref);
    return needle.length >= 3 && haystack.includes(needle);
  });
}

export function suggestMatches(
  txn: BankTransactionRef,
  lines: LedgerBankLine[],
  options: ReconOptions,
  invoiceRefs: string[] = [],
): MatchSuggestion {
  const windowDays = options.windowDays ?? 7;
  const amount = parseAmount(txn.amount);
  if (amount === null || amount === 0n) {
    return {
      status: 'none',
      candidates: [],
      split: null,
      reasonCode: 'INVALID_AMOUNT',
      reasonFr: 'Montant bancaire invalide.',
      reasonEn: 'Invalid bank amount.',
    };
  }

  const candidates: MatchCandidate[] = [];
  let fxSeen = false;
  let partialSeen = false;

  for (const line of lines) {
    if (line.matched) continue;
    const movement = movementOf(line, txn.currency, options.companyCurrency);
    if (movement === null) {
      if (line.debit !== '0.0000' || line.credit !== '0.0000') fxSeen = true;
      continue;
    }
    const signOk = (amount > 0n && movement > 0n) || (amount < 0n && movement < 0n);
    if (!signOk) continue;
    const delta = daysBetween(txn.txnDate, line.entryDate);
    if (delta > windowDays) continue;
    const hit = referenceHit(txn, line, invoiceRefs);
    const exact = movement === amount;

    let score = 0;
    const reasons: string[] = [];
    if (exact) {
      score += 0.6;
      reasons.push('Montant exact');
    } else {
      score += 0.25;
      reasons.push('Montant différent (paiement partiel probable)');
    }
    score += Math.max(0, 0.15 - (delta / Math.max(windowDays, 1)) * 0.15);
    reasons.push(`Écart de ${delta} jour(s)`);
    if (hit) {
      score += 0.15;
      reasons.push('Référence concordante');
    }
    if (line.description && normalizeHeader(txn.label).includes(normalizeHeader(line.description).slice(0, 24))) {
      score += 0.05;
      reasons.push('Libellé proche');
    }
    if (!exact) partialSeen = true;
    candidates.push({
      entryId: line.entryId,
      lineId: line.lineId,
      entryNo: line.entryNo,
      entryDate: line.entryDate,
      reference: line.reference,
      description: line.description,
      amount: movement > 0n ? formatAmount(movement) : formatAmount(-movement),
      score: Number(score.toFixed(4)),
      reasons,
      kind: exact ? 'exact' : 'partial',
    });
  }

  const exact = candidates.filter((c) => c.kind === 'exact').sort((a, b) => b.score - a.score);
  if (exact.length >= 2 && exact[0]!.score - exact[1]!.score < 0.03) {
    return {
      status: 'ambiguous',
      candidates: exact.slice(0, 5),
      split: null,
      reasonCode: 'AMBIGUOUS_MATCH',
      reasonFr: 'Plusieurs écritures correspondent aussi bien : choisissez la bonne.',
      reasonEn: 'Several entries match equally well: choose the right one.',
    };
  }
  if (exact.length > 0) {
    return {
      status: 'proposed',
      candidates: exact.slice(0, 5),
      split: null,
      reasonCode: null,
      reasonFr: null,
      reasonEn: null,
    };
  }

  // One transaction against several lines of the same entry (split match).
  const byEntry = new Map<string, MatchCandidate[]>();
  for (const candidate of candidates.filter((c) => c.kind === 'partial')) {
    const list = byEntry.get(candidate.entryId) ?? [];
    list.push(candidate);
    byEntry.set(candidate.entryId, list);
  }
  for (const [entryId, list] of byEntry) {
    for (let i = 0; i < list.length; i += 1) {
      for (let j = i + 1; j < list.length; j += 1) {
        const a = list[i]!;
        const b = list[j]!;
        const sign = amount > 0n ? 1n : -1n;
        const sum = (parseAmount(a.amount) ?? 0n) + (parseAmount(b.amount) ?? 0n);
        if (sum === (amount > 0n ? amount : -amount)) {
          return {
            status: 'review',
            candidates: list,
            split: {
              entryId,
              entryNo: a.entryNo,
              entryDate: a.entryDate,
              lineIds: [a.lineId, b.lineId],
              total: formatAmount(sum * sign),
              score: 0.7,
              reasons: ['Somme de deux lignes = montant bancaire'],
            },
            reasonCode: 'SPLIT_MATCH',
            reasonFr: 'Deux lignes de la même écriture forment le montant : validation explicite requise.',
            reasonEn: 'Two lines of the same entry add up to the amount: explicit confirmation required.',
          };
        }
      }
    }
  }

  if (fxSeen) {
    return {
      status: 'review',
      candidates: [],
      split: null,
      reasonCode: 'FX_REVIEW',
      reasonFr:
        'Une écriture en devise existe sans montant d’origine exploitable : aucun taux n’est inventé, vérification humaine requise.',
      reasonEn:
        'A foreign-currency entry exists without a usable original amount: no rate is invented, human review required.',
    };
  }
  if (partialSeen) {
    return {
      status: 'review',
      candidates: candidates.filter((c) => c.kind === 'partial').slice(0, 5),
      split: null,
      reasonCode: 'PARTIAL_PAYMENT',
      reasonFr:
        'Le montant ne correspond pas exactement (paiement partiel probable). Aucun rapprochement automatique.',
      reasonEn: 'The amount is not an exact match (likely partial payment). No automatic match.',
    };
  }
  return {
    status: 'none',
    candidates: [],
    split: null,
    reasonCode: null,
    reasonFr: null,
    reasonEn: null,
  };
}

/** Several transactions against one entry line: blocked in V1, never guessed. */
export function blockedMultiTransaction(
  txn: BankTransactionRef,
  line: LedgerBankLine,
): MatchSuggestion | null {
  const amount = parseAmount(txn.amount);
  if (amount === null || line.matched) return null;
  return {
    status: 'review',
    candidates: [],
    split: null,
    reasonCode: 'MULTI_TRANSACTION_V1',
    reasonFr:
      'Plusieurs opérations semblent régler une même ligne comptable : ce cas est bloqué en V1 (aucun rapprochement partiel automatique).',
    reasonEn:
      'Several transactions appear to settle one ledger line: this case is blocked in V1 (no automatic partial matching).',
  };
}

/* -------------------------------------------------------------------------- */
/* Account suggestions                                                        */
/* -------------------------------------------------------------------------- */

export interface SuggestionAccount {
  id: string;
  code: string;
  name: string;
  type: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';
  isActive: boolean;
  currency: string;
}

export interface SuggestionRule {
  id: string;
  name: string;
  labelPattern: string | null;
  referencePattern: string | null;
  bankAccountId: string | null;
  currency: string | null;
  direction: 'any' | 'in' | 'out';
  accountId: string;
  journalId: string | null;
  priority: number;
  version: number;
}

export interface AccountSuggestion {
  status: 'proposed' | 'ambiguous' | 'none';
  kind: 'rule' | 'fee' | 'salary' | 'rent' | 'energy' | 'insurance' | 'customer' | 'supplier' | 'bank' | 'manual';
  accountId: string | null;
  journalCode: string | null;
  confidence: number;
  ruleId: string | null;
  rationaleFr: string;
  rationaleEn: string;
  choices: { accountId: string; code: string; name: string; rationaleFr: string; rationaleEn: string }[];
}

function matchesPattern(value: string, pattern: string | null): boolean {
  if (!pattern) return false;
  const needle = normalizeHeader(pattern);
  return needle.length >= 3 && normalizeHeader(value).includes(needle);
}

function findAccount(
  accounts: SuggestionAccount[],
  patterns: RegExp[],
  type?: SuggestionAccount['type'],
): SuggestionAccount | null {
  const active = accounts.filter((a) => a.isActive && (!type || a.type === type));
  for (const pattern of patterns) {
    const found = active.find((a) => pattern.test(`${a.code} ${a.name}`));
    if (found) return found;
  }
  return null;
}

export function suggestAccount(
  txn: BankTransactionRef,
  bankAccountId: string,
  accounts: SuggestionAccount[],
  rules: SuggestionRule[],
  journalCodes: { code: string; id: string }[],
): AccountSuggestion {
  const direction = (parseAmount(txn.amount) ?? 0n) > 0n ? 'in' : 'out';
  const active = new Map(accounts.filter((a) => a.isActive).map((a) => [a.id, a]));

  const matchingRules = rules
    .filter((rule) => {
      if (rule.bankAccountId && rule.bankAccountId !== bankAccountId) return false;
      if (rule.currency && rule.currency !== txn.currency) return false;
      if (rule.direction !== 'any' && rule.direction !== direction) return false;
      const labelOk = matchesPattern(txn.label, rule.labelPattern);
      const refOk = matchesPattern(txn.reference ?? '', rule.referencePattern);
      if (!rule.labelPattern && !rule.referencePattern) return false;
      return labelOk || refOk;
    })
    .sort((a, b) => a.priority - b.priority);
  if (matchingRules.length > 0) {
    const top = matchingRules[0]!;
    const account = active.get(top.accountId);
    if (account) {
      const tied = matchingRules.filter(
        (r) => r.priority === top.priority && r.accountId !== top.accountId,
      );
      if (tied.length > 0) {
        const choices = [top, ...tied]
          .map((r) => active.get(r.accountId))
          .filter((a): a is SuggestionAccount => Boolean(a))
          .map((a) => ({
            accountId: a.id,
            code: a.code,
            name: a.name,
            rationaleFr: `Règle « ${top.name} » (priorité ${top.priority}).`,
            rationaleEn: `Rule “${top.name}” (priority ${top.priority}).`,
          }));
        return {
          status: 'ambiguous',
          kind: 'rule',
          accountId: null,
          journalCode: null,
          confidence: 0,
          ruleId: null,
          rationaleFr: 'Plusieurs règles de même priorité visent des comptes différents : décision humaine.',
          rationaleEn: 'Several rules with the same priority target different accounts: human decision.',
          choices,
        };
      }
      return {
        status: 'proposed',
        kind: 'rule',
        accountId: account.id,
        journalCode: top.journalId
          ? journalCodes.find((j) => j.id === top.journalId)?.code ?? 'BQ'
          : 'BQ',
        confidence: 0.95,
        ruleId: top.id,
        rationaleFr: `Règle validée « ${top.name} » (version ${top.version}) : libellé/référence reconnu.`,
        rationaleEn: `Validated rule “${top.name}” (version ${top.version}): label/reference recognised.`,
        choices: [],
      };
    }
  }

  const hint = `${txn.label} ${txn.reference ?? ''}`;

  if (/frais|commission|bank charge|charges bancaires|\bfees?\b/i.test(hint)) {
    const account = findAccount(accounts, [/frais bancaire/i, /bank charge/i, /\bcommission\b/i], 'expense');
    if (account) {
      return {
        status: 'proposed',
        kind: 'fee',
        accountId: account.id,
        journalCode: 'BQ',
        confidence: 0.7,
        ruleId: null,
        rationaleFr: `Libellé de frais bancaires ; compte de charges existant ${account.code}.`,
        rationaleEn: `Bank fee wording; existing expense account ${account.code}.`,
        choices: [],
      };
    }
  }

  if (/salaire|salary|salaries|payroll|wages|\bpaie\b|virement.*(salaire|paie)/i.test(hint)) {
    const liability = findAccount(
      accounts,
      [/paye.*payer/i, /salaire.*payer/i, /dette.*salar/i, /salary payable/i, /accrued payroll/i, /personnel.*payer/i],
      'liability',
    );
    if (liability) {
      return {
        status: 'proposed',
        kind: 'salary',
        accountId: liability.id,
        journalCode: 'SAL',
        confidence: 0.65,
        ruleId: null,
        rationaleFr:
          'Libellé de paie détecté : proposition vers le compte de dette existant. Un libellé ne prouve pas un salaire ; aucune paie n’est calculée ni créée.',
        rationaleEn:
          'Payroll wording detected: proposal to the existing payable account. A label does not prove a salary; no payroll is computed or created.',
        choices: [],
      };
    }
    return {
      status: 'none',
      kind: 'salary',
      accountId: null,
      journalCode: null,
      confidence: 0,
      ruleId: null,
      rationaleFr:
        'Libellé de paie détecté, mais aucun compte de dette salariale n’existe : décision humaine requise. Aucun compte n’est inventé.',
      rationaleEn:
        'Payroll wording detected, but no salary payable account exists: human decision required. No account is invented.',
      choices: [],
    };
  }

  const categories: { kind: AccountSuggestion['kind']; patterns: RegExp[]; account: RegExp[] }[] = [
    { kind: 'rent', patterns: [/loyer|rent/i], account: [/loyer/i, /rent expense/i] },
    { kind: 'energy', patterns: [/electric|energie|energy|ceb\b|eau/i], account: [/electric|energie|energy|eau/i] },
    { kind: 'insurance', patterns: [/assurance|insurance/i], account: [/assurance|insurance/i] },
    { kind: 'supplier', patterns: [/fournisseur|supplier|achat|purchase/i], account: [/fournisseur/i, /supplier/i] },
    { kind: 'customer', patterns: [/client|customer|vente|sale|recette|receipt/i], account: [/client/i, /receivable/i] },
    { kind: 'bank', patterns: [/virement interne|internal transfer|transfer/i], account: [/banque/i, /bank/i] },
  ];
  for (const category of categories) {
    if (!category.patterns.some((p) => p.test(hint))) continue;
    const type: SuggestionAccount['type'] =
      category.kind === 'supplier' ? 'liability' : category.kind === 'customer' ? 'asset' : category.kind === 'bank' ? 'asset' : 'expense';
    const account = findAccount(accounts, category.account, type);
    if (account) {
      return {
        status: 'proposed',
        kind: category.kind,
        accountId: account.id,
        journalCode: category.kind === 'bank' ? 'BQ' : 'BQ',
        confidence: 0.55,
        ruleId: null,
        rationaleFr: `Libellé reconnu ; compte existant ${account.code} ${account.name}. Proposition à valider.`,
        rationaleEn: `Wording recognised; existing account ${account.code} ${account.name}. Proposal to validate.`,
        choices: [],
      };
    }
  }

  return {
    status: 'none',
    kind: 'manual',
    accountId: null,
    journalCode: null,
    confidence: 0,
    ruleId: null,
    rationaleFr: 'Aucun compte approprié dans le plan comptable : décision humaine. Aucun compte n’est inventé.',
    rationaleEn: 'No suitable account in the chart of accounts: human decision. No account is invented.',
    choices: [],
  };
}

/** Bank account suggestions never create a second bank account. */
export function findInternalTransfer(
  txn: BankTransactionRef,
  others: { id: string; bankAccountId: string; txnDate: string; amount: string; currency: string; label: string }[],
): { transactionId: string; bankAccountId: string; days: number } | null {
  const amount = parseAmount(txn.amount);
  if (amount === null) return null;
  for (const other of others) {
    if (other.id === txn.id) continue;
    if (other.currency !== txn.currency) continue;
    const otherAmount = parseAmount(other.amount);
    if (otherAmount === null || otherAmount !== -amount) continue;
    const days = daysBetween(txn.txnDate, other.txnDate);
    if (days <= 2) return { transactionId: other.id, bankAccountId: other.bankAccountId, days };
  }
  return null;
}
