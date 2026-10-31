/**
 * Browser demonstration of ledger lettering (mission 12).
 *
 * Fictional data only, stored in localStorage. The same rules as the server are
 * reproduced: posted lines only, exact integer arithmetic (scale 10^4), no
 * automatic validation, immutable groups and reasoned, audited unlettering.
 */
import { ApiError } from '../errors';
import type {
  DemoAccount,
  DemoEntry,
  DemoLettering,
  DemoLetteringEvent,
  DemoLetteringLine,
  DemoLine,
  DemoState,
} from './runtime';
import { formatScaled, parseAmount } from '../../../api/src/modules/migration/normalize';

type Big = bigint;
const amt = (value: unknown): Big => {
  const parsed = parseAmount(value as never);
  if (parsed === null) throw new ApiError(400, 'VALIDATION_ERROR', 'Montant invalide');
  return parsed;
};
const fmt = (value: Big) => formatScaled(value);
const now = () => new Date().toISOString();
const uid = () => crypto.randomUUID();
const zero = (v: Big) => v === 0n;
const big = (v: string) => amt(v);

const accountOf = (state: DemoState, companyId: string, accountId: string): DemoAccount => {
  const account = state.accounts.find((a) => a.id === accountId && a.company_id === companyId);
  if (!account) throw new ApiError(404, 'ACCOUNT_NOT_FOUND', 'Compte introuvable');
  return account;
};

function letteredByLine(state: DemoState): Map<string, Big> {
  const active = new Set(state.letterings.filter((g) => g.status === 'active').map((g) => g.id));
  const map = new Map<string, Big>();
  for (const line of state.letteringLines) {
    if (!active.has(line.lettering_id)) continue;
    map.set(line.journal_line_id, (map.get(line.journal_line_id) ?? 0n) + amt(line.amount));
  }
  return map;
}

interface LineView {
  id: string;
  entryId: string;
  entryNo: string;
  entryDate: string;
  entryReference: string | null;
  entryDescription: string;
  entryStatus: string;
  journalCode: string;
  accountId: string;
  accountCode: string;
  accountName: string;
  accountType: string;
  description: string | null;
  debit: string;
  credit: string;
  side: 'debit' | 'credit';
  amount: string;
  lettered: string;
  remaining: string;
  currency: string;
  entryCurrency: string;
  documentId: string | null;
  documentKind: string | null;
  documentNo: string | null;
  documentStatus: string | null;
  partnerName: string | null;
  commercialOutstanding: string | null;
}

function documentFor(state: DemoState, companyId: string, entryId: string) {
  // Seeded demo documents are not all linked by accounting_entry_id yet. A
  // document is only matched when its number is literally quoted by the
  // posted entry reference/description: no fuzzy or invented association.
  const entry = state.entries.find((e) => e.id === entryId);
  const quoted = `${entry?.reference ?? ''} ${entry?.description ?? ''}`;
  const quotes = (docNo: string | null) => Boolean(docNo && quoted.includes(docNo));
  const purchaseDoc = state.purchaseDocuments.find(
    (d) =>
      d.company_id === companyId && (d.accounting_entry_id === entryId || quotes(d.doc_no)),
  );
  if (purchaseDoc) {
    const supplier = state.purchaseSuppliers.find((s) => s.id === purchaseDoc.supplier_id);
    const outstanding =
      amt(purchaseDoc.total_amount) - amt(purchaseDoc.amount_paid) - amt(purchaseDoc.credited_amount);
    return {
      documentId: purchaseDoc.id,
      documentKind: purchaseDoc.kind,
      documentNo: purchaseDoc.doc_no,
      documentStatus: purchaseDoc.status,
      partnerName: supplier?.name ?? null,
      commercialOutstanding: fmt(outstanding > 0n ? outstanding : 0n),
    };
  }
  const purchasePayment = state.purchasePayments.find(
    (p) =>
      p.company_id === companyId &&
      (p.accounting_entry_id === entryId || quotes(p.payment_no)),
  );
  if (purchasePayment) {
    const supplier = state.purchaseSuppliers.find((s) => s.id === purchasePayment.supplier_id);
    return {
      documentId: purchasePayment.id,
      documentKind: 'payment',
      documentNo: purchasePayment.payment_no,
      documentStatus: purchasePayment.status,
      partnerName: supplier?.name ?? null,
      commercialOutstanding: null,
    };
  }
  const billingDoc = state.billingDocuments.find(
    (d) =>
      d.company_id === companyId && (d.accounting_entry_id === entryId || quotes(d.doc_no)),
  );
  if (billingDoc) {
    const customer = state.billingCustomers.find((c) => c.id === billingDoc.customer_id);
    return {
      documentId: billingDoc.id,
      documentKind: billingDoc.kind,
      documentNo: billingDoc.doc_no,
      documentStatus: billingDoc.status,
      partnerName: customer?.name ?? null,
      commercialOutstanding: null,
    };
  }
  const billingPayment = state.billingPayments.find(
    (p) =>
      p.company_id === companyId &&
      (p.accounting_entry_id === entryId || quotes(p.payment_no)),
  );
  if (billingPayment) {
    const customer = state.billingCustomers.find((c) => c.id === billingPayment.customer_id);
    return {
      documentId: billingPayment.id,
      documentKind: 'payment',
      documentNo: billingPayment.payment_no,
      documentStatus: billingPayment.status,
      partnerName: customer?.name ?? null,
      commercialOutstanding: null,
    };
  }
  return {
    documentId: null,
    documentKind: null,
    documentNo: null,
    documentStatus: null,
    partnerName: null,
    commercialOutstanding: null,
  };
}

function lineView(state: DemoState, line: DemoLine, lettered: Map<string, Big>): LineView {
  const entry = state.entries.find((e) => e.id === line.entry_id)!;
  const journal = state.journals.find((j) => j.id === entry.journal_id);
  const account = state.accounts.find((a) => a.id === line.account_id)!;
  const debit = amt(line.debit);
  const credit = amt(line.credit);
  const sideAmount = debit > 0n ? debit : credit;
  const already = lettered.get(line.id) ?? 0n;
  const remaining = sideAmount - already;
  const document = documentFor(state, line.company_id, entry.id);
  return {
    id: line.id,
    entryId: entry.id,
    entryNo: entry.entry_no,
    entryDate: entry.entry_date,
    entryReference: entry.reference,
    entryDescription: entry.description,
    entryStatus: entry.status,
    journalCode: journal?.code ?? '—',
    accountId: account?.id ?? '',
    accountCode: account?.code ?? '',
    accountName: account?.name ?? '',
    accountType: account?.type ?? '',
    description: line.description,
    debit: line.debit,
    credit: line.credit,
    side: debit > 0n ? 'debit' : 'credit',
    amount: fmt(sideAmount),
    lettered: fmt(already > 0n ? already : 0n),
    remaining: fmt(remaining > 0n ? remaining : 0n),
    currency: entry.currency,
    entryCurrency: entry.currency,
    ...document,
  };
}

const LETTERABLE_CODES = new Set(['1100', '2000']);

export function letterableAccounts(state: DemoState, companyId: string): DemoAccount[] {
  return state.accounts.filter(
    (a) => a.company_id === companyId && a.is_active && LETTERABLE_CODES.has(a.code),
  );
}

function assertLetterable(state: DemoState, companyId: string, accountId: string): DemoAccount {
  const account = accountOf(state, companyId, accountId);
  if (!account.is_active || !LETTERABLE_CODES.has(account.code)) {
    throw new ApiError(400, 'LETTERING_ACCOUNT_NOT_ALLOWED', 'Ce compte n’est pas un compte de tiers lettrable');
  }
  return account;
}

function linesOf(
  state: DemoState,
  companyId: string,
  accountId: string,
  options: { status?: string; includeUnposted?: boolean; search?: string; from?: string; to?: string; currency?: string } = {},
): LineView[] {
  const lettered = letteredByLine(state);
  const all = state.lines
    .filter((l) => l.company_id === companyId && l.account_id === accountId)
    .map((line) => lineView(state, line, lettered))
    .filter((line) => options.includeUnposted || line.entryStatus === 'posted');
  const search = options.search?.toLowerCase().trim();
  return all.filter((line) => {
    if (options.currency && line.currency !== options.currency.toUpperCase()) return false;
    if (options.from && line.entryDate < options.from) return false;
    if (options.to && line.entryDate > options.to) return false;
    if (search) {
      const haystack = [
        line.entryNo,
        line.entryReference,
        line.entryDescription,
        line.documentNo,
        line.partnerName,
        line.accountName,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    if (options.status === 'unlettered') return big(line.remaining) > 0n;
    if (options.status === 'lettered') return big(line.remaining) === 0n;
    if (options.status === 'partial') return big(line.lettered) > 0n && big(line.remaining) > 0n;
    return true;
  });
}

interface Allocation {
  lineId: string;
  amount: string;
}

function validateAllocations(
  state: DemoState,
  companyId: string,
  accountId: string,
  allocations: Allocation[],
  company: { functional_currency: string },
) {
  const issues: { code: string; fr: string; en: string; blocking: boolean }[] = [];
  const warnings: { code: string; fr: string; en: string }[] = [];
  const unique = new Set(allocations.map((a) => a.lineId));
  if (allocations.length < 2) {
    issues.push({
      code: 'LETTERING_TWO_LINES_REQUIRED',
      fr: 'Un lettrage exige au moins une ligne au débit et une au crédit.',
      en: 'A lettering requires at least one debit and one credit line.',
      blocking: true,
    });
  }
  if (unique.size !== allocations.length) {
    issues.push({
      code: 'LETTERING_DUPLICATE_LINE',
      fr: 'Une ligne ne peut apparaître qu’une seule fois.',
      en: 'A line can appear only once.',
      blocking: true,
    });
  }
  const lettered = letteredByLine(state);
  let debit = 0n;
  let credit = 0n;
  let sourceCurrency: string | null = null;
  const seenEntries = new Set<string>();
  for (const allocation of allocations) {
    const line = state.lines.find((l) => l.id === allocation.lineId && l.company_id === companyId);
    if (!line) {
      issues.push({
        code: 'LETTERING_LINE_NOT_FOUND',
        fr: 'Une ligne comptable est introuvable dans cette société.',
        en: 'A journal line was not found in this company.',
        blocking: true,
      });
      continue;
    }
    const view = lineView(state, line, lettered);
    if (line.account_id !== accountId) {
      issues.push({
        code: 'LETTERING_ACCOUNT_MISMATCH',
        fr: 'Toutes les lignes doivent appartenir au même compte tiers.',
        en: 'All lines must belong to the same third-party account.',
        blocking: true,
      });
    }
    if (view.entryStatus !== 'posted') {
      issues.push({
        code: 'LETTERING_ENTRY_NOT_POSTED',
        fr: `Écriture ${view.entryNo} non comptabilisée : aucun lettrage artificiel n’est créé.`,
        en: `Entry ${view.entryNo} is not posted: no artificial lettering is created.`,
        blocking: true,
      });
    }
    const value = amt(allocation.amount);
    if (value <= 0n) {
      issues.push({
        code: 'LETTERING_AMOUNT_INVALID',
        fr: 'Chaque montant lettré doit être strictement positif.',
        en: 'Every lettered amount must be positive.',
        blocking: true,
      });
    }
    if (value > big(view.remaining)) {
      issues.push({
        code: 'LETTERING_EXCEEDS_AVAILABLE',
        fr: `Montant supérieur au restant lettrable de la ligne ${view.entryNo}.`,
        en: `Amount exceeds the remaining letterable amount of line ${view.entryNo}.`,
        blocking: true,
      });
    }
    if (view.side === 'debit') debit += value;
    else credit += value;
    if (sourceCurrency === null) sourceCurrency = view.currency;
    else if (sourceCurrency !== view.currency) {
      issues.push({
        code: 'LETTERING_CURRENCY_MISMATCH',
        fr: 'Les écritures n’ont pas la même devise d’origine ; aucun change n’est inventé.',
        en: 'Selected entries do not share the same source currency; no exchange rate is invented.',
        blocking: true,
      });
    }
    seenEntries.add(view.entryId);
  }
  if (debit !== credit || debit <= 0n) {
    issues.push({
      code: 'LETTERING_UNBALANCED',
      fr: `Lettrage déséquilibré : débit ${fmt(debit)}, crédit ${fmt(credit)}.`,
      en: `Unbalanced lettering: debit ${fmt(debit)}, credit ${fmt(credit)}.`,
      blocking: true,
    });
  }
  for (const entryId of seenEntries) {
    const entry = state.entries.find((e) => e.id === entryId);
    if (!entry) continue;
    const closed = state.periods.some(
      (p) =>
        p.company_id === companyId &&
        p.status === 'closed' &&
        p.start_date <= entry.entry_date &&
        p.end_date >= entry.entry_date,
    );
    if (closed) {
      issues.push({
        code: 'LETTERING_PERIOD_CLOSED',
        fr: `La période de l’écriture ${entry.entry_no} est clôturée.`,
        en: `The period of entry ${entry.entry_no} is closed.`,
        blocking: true,
      });
    }
  }
  if (allocations.some((a) => !documentFor(state, companyId, state.lines.find((l) => l.id === a.lineId)?.entry_id ?? '').documentId)) {
    warnings.push({
      code: 'LETTERING_WITHOUT_DOCUMENT',
      fr: 'Certaines lignes ne sont liées à aucune facture ou règlement : le lettrage reste comptable.',
      en: 'Some lines are not linked to an invoice or payment: lettering stays purely accounting.',
    });
  }
  return {
    valid: issues.every((i) => !i.blocking),
    accountId,
    accountCode: letterableAccounts(state, companyId).find((a) => a.id === accountId)?.code ?? null,
    accountName: letterableAccounts(state, companyId).find((a) => a.id === accountId)?.name ?? null,
    currency: company.functional_currency,
    sourceCurrency,
    totalDebit: fmt(debit),
    totalCredit: fmt(credit),
    amount: fmt(debit < credit ? debit : credit),
    lines: allocations.flatMap((a) => {
      const line = state.lines.find((l) => l.id === a.lineId);
      return line ? [{ ...lineView(state, line, lettered), remaining: fmt(amt(a.amount)) }] : [];
    }),
    issues,
    warnings,
  };
}

function nextCode(state: DemoState, companyId: string): string {
  const year = new Date().toISOString().slice(0, 4);
  const key = `${companyId}:${year}`;
  const next = (state.letteringSequences[key] ?? 0) + 1;
  state.letteringSequences[key] = next;
  return `LET-${year}-${String(next).padStart(4, '0')}`;
}

function viewOf(state: DemoState, companyId: string, id: string) {
  const group = state.letterings.find((g) => g.id === id && g.company_id === companyId);
  if (!group) throw new ApiError(404, 'LETTERING_NOT_FOUND', 'Lettrage introuvable');
  const account = state.accounts.find((a) => a.id === group.account_id);
  const lines = state.letteringLines
    .filter((l) => l.lettering_id === group.id)
    .map((allocation) => {
      const line = state.lines.find((l) => l.id === allocation.journal_line_id)!;
      const view = lineView(state, line, new Map([[line.id, 0n]]));
      return { ...view, allocatedAmount: fmt(amt(allocation.amount)) };
    });
  const events = state.letteringEvents.filter((e) => e.lettering_id === group.id);
  return {
    ...group,
    account_code: account?.code ?? '',
    account_name: account?.name ?? '',
    amount: fmt(amt(group.amount)),
    total_debit: fmt(amt(group.total_debit)),
    total_credit: fmt(amt(group.total_credit)),
    lines,
    events,
    documents: [
      ...new Map(
        lines
          .filter((l) => l.documentId)
          .map((l) => [
            l.documentId,
            {
              id: l.documentId,
              kind: l.documentKind,
              number: l.documentNo,
              status: l.documentStatus,
              partnerName: l.partnerName,
            },
          ]),
      ).values(),
    ],
  };
}

function suggestionsOf(state: DemoState, companyId: string, accountId?: string) {
  const accounts = letterableAccounts(state, companyId).filter((a) => !accountId || a.id === accountId);
  const out: any[] = [];
  for (const account of accounts) {
    const open = linesOf(state, companyId, account.id, { status: 'unlettered' });
    const debits = open.filter((l) => l.side === 'debit');
    const credits = open.filter((l) => l.side === 'credit');
    for (const debit of debits) {
      for (const credit of credits) {
        if (debit.entryId === credit.entryId) continue;
        if (debit.currency !== credit.currency) continue;
        const available = big(debit.remaining) < big(credit.remaining) ? big(debit.remaining) : big(credit.remaining);
        if (available <= 0n) continue;
        const exact = big(debit.remaining) === big(credit.remaining);
        const refMatch =
          Boolean(debit.entryReference) &&
          Boolean(credit.entryReference) &&
          (debit.entryReference!.includes(credit.entryReference!) ||
            credit.entryReference!.includes(debit.entryReference!) ||
            debit.entryReference === credit.entryReference);
        let confidence = 0.35;
        const rationale = [
          {
            code: 'SAME_THIRD_PARTY_ACCOUNT',
            fr: `Même compte tiers ${account.code}.`,
            en: `Same third-party account ${account.code}.`,
          },
          {
            code: 'SAME_SOURCE_CURRENCY',
            fr: `Même devise d’origine (${debit.currency}).`,
            en: `Same source currency (${debit.currency}).`,
          },
        ];
        if (exact) {
          confidence += 0.25;
          rationale.push({ code: 'EXACT_AMOUNT', fr: 'Montants restants strictement égaux.', en: 'Remaining amounts are exactly equal.' });
        }
        if (refMatch) {
          confidence += 0.2;
          rationale.push({ code: 'REFERENCE_MATCH', fr: 'Références correspondantes.', en: 'References match.' });
        }
        const ambiguities: any[] = [];
        if (credits.filter((l) => l.id !== credit.id && l.remaining === credit.remaining).length > 0) {
          ambiguities.push({
            code: 'AMBIGUOUS_CREDIT',
            fr: 'Plusieurs crédits ont le même restant.',
            en: 'Several credits have the same remaining amount.',
          });
          confidence = Math.min(confidence, 0.7);
        }
        if (debits.filter((l) => l.id !== debit.id && l.remaining === debit.remaining).length > 0) {
          ambiguities.push({
            code: 'AMBIGUOUS_DEBIT',
            fr: 'Plusieurs débits ont le même restant.',
            en: 'Several debits have the same remaining amount.',
          });
          confidence = Math.min(confidence, 0.7);
        }
        out.push({
          accountId: account.id,
          accountCode: account.code,
          accountName: account.name,
          currency: debit.currency,
          amount: fmt(available),
          confidence,
          rationale,
          ambiguities,
          debitLine: debit,
          creditLine: credit,
          suggestedLines: [
            { lineId: debit.id, amount: fmt(available) },
            { lineId: credit.id, amount: fmt(available) },
          ],
        });
      }
    }
  }
  return out.sort((a, b) => Number(a.ambiguities.length > 0) - Number(b.ambiguities.length > 0) || b.confidence - a.confidence).slice(0, 30);
}

function reportOf(state: DemoState, companyId: string) {
  const accounts = letterableAccounts(state, companyId);
  const lettered = letteredByLine(state);
  const lines: LineView[] = [];
  for (const account of accounts) lines.push(...linesOf(state, companyId, account.id, { status: 'unlettered' }));
  const byCurrency = new Map<string, { currency: string; debit: Big; credit: Big; lines: number }>();
  for (const line of lines) {
    const row = byCurrency.get(line.currency) ?? { currency: line.currency, debit: 0n, credit: 0n, lines: 0 };
    if (line.side === 'debit') row.debit += big(line.remaining);
    else row.credit += big(line.remaining);
    row.lines += 1;
    byCurrency.set(line.currency, row);
  }
  const documents = [
    ...state.purchaseDocuments
      .filter((d) => d.company_id === companyId && d.accounting_entry_id)
      .map((d) => {
        const supplier = state.purchaseSuppliers.find((s) => s.id === d.supplier_id);
        const entryLines = state.lines.filter((l) => l.entry_id === d.accounting_entry_id);
        const payable = entryLines.find((l) => {
          const account = state.accounts.find((a) => a.id === l.account_id);
          return account?.code === '2000';
        });
        const accounting = payable ? amt(payable.debit) + amt(payable.credit) : 0n;
        const letteredAmount = payable ? lettered.get(payable.id) ?? 0n : 0n;
        const accountingRemaining = accounting - letteredAmount > 0n ? accounting - letteredAmount : 0n;
        const commercial = amt(d.total_amount) - amt(d.amount_paid) - amt(d.credited_amount);
        const commercialOutstanding = commercial > 0n ? commercial : 0n;
        return {
          source: 'purchase',
          id: d.id,
          number: d.doc_no,
          partnerName: supplier?.name ?? '',
          currency: d.currency,
          commercialOutstanding: fmt(commercialOutstanding),
          accountingRemaining: fmt(accountingRemaining),
          variance: fmt(commercialOutstanding - accountingRemaining),
          letteringStatus: accountingRemaining <= 0n ? 'fully_lettered' : letteredAmount > 0n ? 'partially_lettered' : 'unlettered',
        };
      }),
    ...state.billingDocuments
      .filter((d) => d.company_id === companyId && d.accounting_entry_id)
      .map((d) => {
        const customer = state.billingCustomers.find((c) => c.id === d.customer_id);
        const entryLines = state.lines.filter((l) => l.entry_id === d.accounting_entry_id);
        const receivable = entryLines.find((l) => {
          const account = state.accounts.find((a) => a.id === l.account_id);
          return account?.code === '1100';
        });
        const accounting = receivable ? amt(receivable.debit) + amt(receivable.credit) : 0n;
        const letteredAmount = receivable ? lettered.get(receivable.id) ?? 0n : 0n;
        const accountingRemaining = accounting - letteredAmount > 0n ? accounting - letteredAmount : 0n;
        const commercial = amt(d.total_amount) - amt(d.amount_paid) - amt(d.credited_amount);
        const commercialOutstanding = commercial > 0n ? commercial : 0n;
        return {
          source: 'billing',
          id: d.id,
          number: d.doc_no,
          partnerName: customer?.name ?? '',
          currency: d.currency,
          commercialOutstanding: fmt(commercialOutstanding),
          accountingRemaining: fmt(accountingRemaining),
          variance: fmt(commercialOutstanding - accountingRemaining),
          letteringStatus: accountingRemaining <= 0n ? 'fully_lettered' : letteredAmount > 0n ? 'partially_lettered' : 'unlettered',
        };
      }),
  ];
  // Demonstration scenarios are posted journal entries rather than complete
  // commercial documents. They are surfaced explicitly as fictional scenarios,
  // never as real invoices, so the commercial/accounting variance stays visible.
  for (const group of state.letterings.filter((g) => g.status === 'active')) {
    for (const allocation of state.letteringLines.filter((l) => l.lettering_id === group.id)) {
      const line = state.lines.find((l) => l.id === allocation.journal_line_id);
      const entry = state.entries.find((e) => e.id === line?.entry_id);
      if (!line || !entry) continue;
      const account = state.accounts.find((a) => a.id === line.account_id);
      if (!account || !['1100', '2000'].includes(account.code)) continue;
      if (!entry.reference || documents.some((d) => d.number === entry.reference)) continue;
      const view = lineView(state, line, lettered);
      const remaining = big(view.remaining);
      documents.push({
        source: account.code === '1100' ? 'billing' : 'purchase',
        id: `${group.id}:${line.id}`,
        number: entry.reference,
        partnerName: 'Scénario de démonstration (DEMO)',
        currency: entry.currency,
        commercialOutstanding: fmt(remaining),
        accountingRemaining: fmt(remaining),
        variance: '0.0000',
        letteringStatus:
          remaining === 0n ? 'fully_lettered' : view.lettered !== '0.0000' ? 'partially_lettered' : 'unlettered',
      });
    }
  }

  const payments = [
    ...state.purchasePayments
      .filter((p) => p.company_id === companyId && p.status === 'recorded')
      .map((p) => {
        const supplier = state.purchaseSuppliers.find((s) => s.id === p.supplier_id);
        return {
          source: 'purchase',
          id: p.id,
          number: p.payment_no,
          paymentDate: p.payment_date,
          amount: p.amount,
          currency: p.currency,
          partnerName: supplier?.name ?? '',
          remaining: p.accounting_entry_id ? p.amount : p.amount,
          status: !p.accounting_entry_id ? 'awaiting_accounting' : 'partially_lettered',
        };
      }),
    ...state.billingPayments
      .filter((p) => p.company_id === companyId && p.status === 'recorded')
      .map((p) => {
        const customer = state.billingCustomers.find((c) => c.id === p.customer_id);
        return {
          source: 'billing',
          id: p.id,
          number: p.payment_no,
          paymentDate: p.payment_date,
          amount: p.amount,
          currency: p.currency,
          partnerName: customer?.name ?? '',
          remaining: p.amount,
          status: !p.accounting_entry_id ? 'awaiting_accounting' : 'partially_lettered',
        };
      }),
  ];
  return {
    accounts: accounts.map((a) => {
      const accountLines = lines.filter((l) => l.accountId === a.id);
      const perCurrency = [...new Set(accountLines.map((l) => l.currency))].map((currency) => {
        const currencyLines = accountLines.filter((l) => l.currency === currency);
        return {
          currency,
          amount: fmt(currencyLines.reduce((sum, l) => sum + big(l.remaining), 0n)),
          lines: String(currencyLines.length),
        };
      });
      return {
        ...a,
        unlettered:
          perCurrency.length === 1 ? perCurrency[0]!.amount : perCurrency.length === 0 ? '0.0000' : null,
        unlettered_by_currency: perCurrency,
        line_count: String(accountLines.length),
        display_currency:
          perCurrency.length === 1 ? perCurrency[0]!.currency : perCurrency.length === 0 ? a.currency : null,
        multiple_currencies: perCurrency.length > 1,
      };
    }),
    unlettered: {
      lines,
      byCurrency: [...byCurrency.values()].map((row) => ({
        currency: row.currency,
        debit: fmt(row.debit),
        credit: fmt(row.credit),
        balance: fmt(row.debit - row.credit),
        lines: row.lines,
      })),
      byAccount: [],
    },
    documents,
    fullyLettered: documents.filter((d) => d.letteringStatus === 'fully_lettered'),
    partiallyLettered: documents.filter((d) => d.letteringStatus === 'partially_lettered'),
    unletteredDocuments: documents.filter((d) => d.letteringStatus === 'unlettered'),
    payments,
    unletteredPayments: payments.filter((p) => p.status !== 'fully_lettered'),
    variances: documents.filter((d) => d.variance !== '0.0000'),
    history: state.letteringEvents,
    note:
      'Les devises sont présentées séparément. Le lettrage comptable ne modifie ni le solde commercial d’une facture ni le rapprochement bancaire.',
  };
}

function csvOf(state: DemoState, companyId: string): string {
  const accounts = letterableAccounts(state, companyId);
  const escape = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const rows: unknown[][] = [
    ['Compte', 'Intitulé', 'Écriture', 'Date', 'Référence', 'Libellé', 'Tiers', 'Débit', 'Crédit', 'Restant', 'Devise', 'Document', 'Statut document', 'Lettrage'],
  ];
  for (const account of accounts) {
    for (const line of linesOf(state, companyId, account.id, { status: 'unlettered' })) {
      const active = state.letterings
        .filter((g) => g.status === 'active' && state.letteringLines.some((l) => l.lettering_id === g.id && l.journal_line_id === line.id))
        .map((g) => g.code);
      rows.push([
        line.accountCode,
        line.accountName,
        line.entryNo,
        line.entryDate,
        line.entryReference ?? '',
        line.entryDescription,
        line.partnerName ?? '',
        line.debit,
        line.credit,
        line.remaining,
        line.currency,
        line.documentNo ?? '',
        line.documentStatus ?? '',
        active.join(' '),
      ]);
    }
  }
  return rows.map((row) => row.map(escape).join(';')).join('\r\n');
}

export function handleDemoLettering(
  state: DemoState,
  companyId: string,
  method: string,
  rest: string,
  query: Record<string, string>,
  payload: any,
  userId: string,
): unknown {
  const company = state.companies.find((c) => c.id === companyId);
  if (!company) throw new ApiError(404, 'COMPANY_NOT_FOUND', 'Société introuvable');
  const path = rest.replace(/^\/lettering/, '');

  if (method === 'GET' && path === '/accounts') {
    return { accounts: reportOf(state, companyId).accounts };
  }
  if (method === 'GET' && (path === '/lines.csv' || path === '/report.csv')) {
    return csvOf(state, companyId);
  }
  if (method === 'GET' && path === '/lines') {
    const accountId = query.accountId;
    if (!accountId) return { lines: [], pending: [], accounts: letterableAccounts(state, companyId) };
    assertLetterable(state, companyId, accountId);
    const status = (query.status ?? 'unlettered') as string;
    return {
      lines: linesOf(state, companyId, accountId, { status, search: query.search, from: query.from, to: query.to, currency: query.currency }),
      pending: linesOf(state, companyId, accountId, { status: 'all', includeUnposted: true }).filter((l) => l.entryStatus !== 'posted'),
      accounts: letterableAccounts(state, companyId),
    };
  }
  if (method === 'POST' && path === '/preview') {
    const account = assertLetterable(state, companyId, String(payload.accountId));
    return { preview: validateAllocations(state, companyId, account.id, payload.allocations ?? [], company) };
  }
  if (method === 'GET' && path === '/suggestions') {
    return { suggestions: suggestionsOf(state, companyId, query.accountId), method: 'deterministic', autoValidated: false };
  }
  if (method === 'GET' && path === '/report') {
    return { report: reportOf(state, companyId) };
  }
  if (method === 'GET' && path === '/history') {
    return {
      events: state.letteringEvents
        .filter((e) => e.company_id === companyId && (!query.letteringId || e.lettering_id === query.letteringId))
        .map((e) => {
          const group = state.letterings.find((g) => g.id === e.lettering_id);
          const account = state.accounts.find((a) => a.id === group?.account_id);
          return { ...e, code: group?.code ?? '', account_code: account?.code ?? '', actor_name: 'Démonstration' };
        })
        .sort((a, b) => b.created_at.localeCompare(a.created_at)),
    };
  }
  if (method === 'GET' && path === '') {
    const status = query.status ?? 'all';
    return {
      letterings: state.letterings
        .filter((g) => g.company_id === companyId && (status === 'all' || g.status === status))
        .map((g) => {
          const account = state.accounts.find((a) => a.id === g.account_id);
          return {
            ...g,
            amount: fmt(amt(g.amount)),
            total_debit: fmt(amt(g.total_debit)),
            total_credit: fmt(amt(g.total_credit)),
            account_code: account?.code ?? '',
            account_name: account?.name ?? '',
            line_count: String(state.letteringLines.filter((l) => l.lettering_id === g.id).length),
          };
        })
        .sort((a, b) => b.created_at.localeCompare(a.created_at)),
    };
  }
  if (method === 'POST' && path === '') {
    const account = assertLetterable(state, companyId, String(payload.accountId));
    const requestKey = payload.idempotencyKey ?? null;
    if (requestKey) {
      const existing = state.letterings.find((g) => g.company_id === companyId && g.request_key === requestKey);
      if (existing) return { lettering: viewOf(state, companyId, existing.id), idempotent: true };
    }
    const preview = validateAllocations(state, companyId, account.id, payload.allocations ?? [], company);
    if (!preview.valid) {
      const blocking = preview.issues.find((i) => i.blocking);
      throw new ApiError(409, blocking?.code ?? 'LETTERING_INVALID', blocking?.fr ?? 'Lettrage invalide', { issues: preview.issues });
    }
    const id = uid();
    const group: DemoLettering = {
      id,
      company_id: companyId,
      account_id: account.id,
      code: nextCode(state, companyId),
      status: 'active',
      method: payload.method === 'suggested' ? 'suggested' : 'manual',
      currency: preview.currency,
      source_currency: preview.sourceCurrency ?? preview.currency,
      amount: preview.amount,
      total_debit: preview.totalDebit,
      total_credit: preview.totalCredit,
      rationale: payload.rationale ?? null,
      request_key: requestKey,
      created_by: userId,
      created_at: now(),
      reversed_by: null,
      reversed_at: null,
      reversal_reason: null,
    };
    state.letterings.push(group);
    for (const allocation of payload.allocations as Allocation[]) {
      const line = state.lines.find((l) => l.id === allocation.lineId)!;
      state.letteringLines.push({
        id: uid(),
        company_id: companyId,
        lettering_id: id,
        journal_line_id: line.id,
        entry_id: line.entry_id,
        account_id: line.account_id,
        side: amt(line.debit) > 0n ? 'debit' : 'credit',
        amount: fmt(amt(allocation.amount)),
      });
    }
    state.letteringEvents.push({
      id: uid(),
      company_id: companyId,
      lettering_id: id,
      action: 'created',
      actor_id: userId,
      reason: null,
      details: { allocations: payload.allocations.length },
      created_at: now(),
    });
    return { lettering: viewOf(state, companyId, id), idempotent: false };
  }

  const reverse = /^\/([0-9a-f-]{36})\/reverse$/.exec(path);
  if (method === 'POST' && reverse) {
    const group = state.letterings.find((g) => g.id === reverse[1] && g.company_id === companyId);
    if (!group) throw new ApiError(404, 'LETTERING_NOT_FOUND', 'Lettrage introuvable');
    if (group.status === 'reversed') throw new ApiError(409, 'LETTERING_ALREADY_REVERSED', 'Lettrage déjà contrepassé');
    if (!payload.reason?.trim()) throw new ApiError(400, 'LETTERING_REASON_REQUIRED', 'Un motif est obligatoire');
    if (payload.confirm !== true) throw new ApiError(400, 'VALIDATION_ERROR', 'Confirmation explicite requise');
    for (const allocation of state.letteringLines.filter((l) => l.lettering_id === group.id)) {
      const entry = state.entries.find((e) => e.id === allocation.entry_id);
      if (!entry) continue;
      const closed = state.periods.some(
        (p) =>
          p.company_id === companyId &&
          p.status === 'closed' &&
          p.start_date <= entry.entry_date &&
          p.end_date >= entry.entry_date,
      );
      if (closed) throw new ApiError(409, 'LETTERING_PERIOD_CLOSED', 'Période clôturée : délettrage impossible');
    }
    group.status = 'reversed';
    group.reversed_by = userId;
    group.reversed_at = now();
    group.reversal_reason = payload.reason.trim();
    state.letteringEvents.push({
      id: uid(),
      company_id: companyId,
      lettering_id: group.id,
      action: 'reversed',
      actor_id: userId,
      reason: payload.reason.trim(),
      details: { code: group.code },
      created_at: now(),
    });
    return { lettering: viewOf(state, companyId, group.id), reversed: true };
  }

  const explain = /^\/explain\/([0-9a-f-]{36})$/.exec(path);
  if (method === 'GET' && explain) {
    const line = state.lines.find((l) => l.id === explain[1] && l.company_id === companyId);
    if (!line) throw new ApiError(404, 'LETTERING_LINE_NOT_FOUND', 'Ligne introuvable');
    const view = lineView(state, line, letteredByLine(state));
    return {
      explanation: {
        line: view,
        groups: state.letterings.filter(
          (g) => state.letteringLines.some((l) => l.lettering_id === g.id && l.journal_line_id === line.id),
        ),
        explanation: {
          fr: big(view.remaining) === 0n
            ? 'Cette ligne est entièrement lettrée.'
            : big(view.lettered) > 0n
              ? `Cette ligne est partiellement lettrée : ${view.lettered} sur ${view.amount}, restant ${view.remaining} ${view.currency}.`
              : `Cette ligne n’est pas lettrée : restant ${view.remaining} ${view.currency}.`,
          en: big(view.remaining) === 0n
            ? 'This line is fully lettered.'
            : big(view.lettered) > 0n
              ? `This line is partially lettered: ${view.lettered} of ${view.amount}, remaining ${view.remaining} ${view.currency}.`
              : `This line is not lettered: remaining ${view.remaining} ${view.currency}.`,
        },
      },
    };
  }

  const groupMatch = /^\/([0-9a-f-]{36})$/.exec(path);
  if (method === 'GET' && groupMatch) return { lettering: viewOf(state, companyId, groupMatch[1]!) };
  return undefined;
}

/* --------------------------------------------------------------- demo seed */

function seedEntry(
  state: DemoState,
  companyId: string,
  journalCode: string,
  date: string,
  reference: string,
  description: string,
  lines: { code: string; debit?: string; credit?: string }[],
): DemoEntry {
  const company = state.companies.find((c) => c.id === companyId)!;
  const journal = state.journals.find((j) => j.company_id === companyId && j.code === journalCode)!;
  const year = date.slice(0, 4);
  const key = `${journalCode}-${year}`;
  const next = (state.sequences[key] ?? 0) + 1;
  state.sequences[key] = next;
  const entry: DemoEntry = {
    id: uid(),
    company_id: companyId,
    journal_id: journal.id,
    entry_no: `${journalCode}-${year}-${String(next).padStart(4, '0')}`,
    entry_date: date,
    reference,
    description,
    currency: company.functional_currency,
    exchange_rate: '1.00000000',
    status: 'posted',
    source: 'manual',
    reversal_of_entry_id: null,
    posted_at: now(),
    created_at: now(),
  };
  state.entries.push(entry);
  lines.forEach((line, index) => {
    const account = state.accounts.find((a) => a.company_id === companyId && a.code === line.code)!;
    state.lines.push({
      id: uid(),
      entry_id: entry.id,
      company_id: companyId,
      account_id: account.id,
      line_no: index + 1,
      description,
      debit: line.debit ? fmt(amt(line.debit)) : fmt(0n),
      credit: line.credit ? fmt(amt(line.credit)) : fmt(0n),
      txn_amount: null,
      txn_currency: company.functional_currency,
      fx_rate: null,
    });
  });
  return entry;
}

function seedGroup(
  state: DemoState,
  companyId: string,
  accountId: string,
  allocations: Allocation[],
  options: { status?: 'active' | 'reversed'; reason?: string; reversedReason?: string } = {},
): DemoLettering {
  const year = new Date().toISOString().slice(0, 4);
  const key = `${companyId}:${year}`;
  const next = (state.letteringSequences[key] ?? 0) + 1;
  state.letteringSequences[key] = next;
  let debit = 0n;
  let credit = 0n;
  for (const allocation of allocations) {
    const line = state.lines.find((l) => l.id === allocation.lineId)!;
    if (amt(line.debit) > 0n) debit += amt(allocation.amount);
    else credit += amt(allocation.amount);
  }
  const group: DemoLettering = {
    id: uid(),
    company_id: companyId,
    account_id: accountId,
    code: `LET-${year}-${String(next).padStart(4, '0')}`,
    status: options.status ?? 'active',
    method: 'manual',
    currency: 'MUR',
    source_currency: 'MUR',
    amount: fmt(debit < credit ? debit : credit),
    total_debit: fmt(debit),
    total_credit: fmt(credit),
    rationale: options.reason ?? 'Scénario fictif de démonstration',
    request_key: null,
    created_by: state.users[0]!.id,
    created_at: now(),
    reversed_by: options.status === 'reversed' ? state.users[0]!.id : null,
    reversed_at: options.status === 'reversed' ? now() : null,
    reversal_reason: options.status === 'reversed' ? options.reversedReason ?? 'Délettrage fictif de démonstration' : null,
  };
  state.letterings.push(group);
  for (const allocation of allocations) {
    const line = state.lines.find((l) => l.id === allocation.lineId)!;
    state.letteringLines.push({
      id: uid(),
      company_id: companyId,
      lettering_id: group.id,
      journal_line_id: line.id,
      entry_id: line.entry_id,
      account_id: accountId,
      side: amt(line.debit) > 0n ? 'debit' : 'credit',
      amount: fmt(amt(allocation.amount)),
    });
  }
  state.letteringEvents.push({
    id: uid(),
    company_id: companyId,
    lettering_id: group.id,
    action: 'created',
    actor_id: state.users[0]!.id,
    reason: null,
    details: { scenario: 'demo' },
    created_at: now(),
  });
  if (group.status === 'reversed') {
    state.letteringEvents.push({
      id: uid(),
      company_id: companyId,
      lettering_id: group.id,
      action: 'reversed',
      actor_id: state.users[0]!.id,
      reason: group.reversal_reason,
      details: { scenario: 'demo' },
      created_at: now(),
    });
  }
  return group;
}

export function seedDemoLettering(state: DemoState): void {
  const company = state.companies[0];
  if (!company) return;
  const accounts = state.accounts.filter((a) => a.company_id === company.id);
  const recv = accounts.find((a) => a.code === '1100');
  const payable = accounts.find((a) => a.code === '2000');
  if (!recv || !payable) return;
  const lineOf = (entry: DemoEntry, code: string) => {
    const account = accounts.find((a) => a.code === code)!;
    return state.lines.find((l) => l.entry_id === entry.id && l.account_id === account.id)!;
  };

  // A - full customer scenario, 100,000 = 40,000 + 35,000 + 25,000.
  const aInv = seedEntry(state, company.id, 'SAL', '2026-01-05', 'FAC-DEMO-A', 'Facture cliente fictive A (DEMO)', [
    { code: '1100', debit: '100000' },
    { code: '4010', credit: '100000' },
  ]);
  const aP1 = seedEntry(state, company.id, 'BQ', '2026-01-10', 'REG-DEMO-A1', 'Règlement fictif A1 (DEMO)', [
    { code: '1010', debit: '40000' },
    { code: '1100', credit: '40000' },
  ]);
  const aP2 = seedEntry(state, company.id, 'BQ', '2026-01-12', 'REG-DEMO-A2', 'Règlement fictif A2 (DEMO)', [
    { code: '1010', debit: '35000' },
    { code: '1100', credit: '35000' },
  ]);
  const aP3 = seedEntry(state, company.id, 'BQ', '2026-01-15', 'REG-DEMO-A3', 'Règlement fictif A3 (DEMO)', [
    { code: '1010', debit: '25000' },
    { code: '1100', credit: '25000' },
  ]);
  seedGroup(state, company.id, recv.id, [
    { lineId: lineOf(aInv, '1100').id, amount: '100000' },
    { lineId: lineOf(aP1, '1100').id, amount: '40000' },
    { lineId: lineOf(aP2, '1100').id, amount: '35000' },
    { lineId: lineOf(aP3, '1100').id, amount: '25000' },
  ], { reason: 'Scénario A — lettrage complet (DEMO)' });

  // B - partial customer scenario, 50,000 invoice / 20,000 payment.
  const bInv = seedEntry(state, company.id, 'SAL', '2026-02-02', 'FAC-DEMO-B', 'Facture cliente fictive B (DEMO)', [
    { code: '1100', debit: '50000' },
    { code: '4010', credit: '50000' },
  ]);
  const bPay = seedEntry(state, company.id, 'BQ', '2026-02-08', 'REG-DEMO-B1', 'Règlement partiel fictif B (DEMO)', [
    { code: '1010', debit: '20000' },
    { code: '1100', credit: '20000' },
  ]);
  seedGroup(state, company.id, recv.id, [
    { lineId: lineOf(bInv, '1100').id, amount: '20000' },
    { lineId: lineOf(bPay, '1100').id, amount: '20000' },
  ], { reason: 'Scénario B — lettrage partiel client (DEMO)' });

  // C - supplier 80,000 / 30,000.
  const cInv = seedEntry(state, company.id, 'PUR', '2026-02-10', 'ACH-DEMO-C', 'Facture fournisseur fictive C (DEMO)', [
    { code: '6100', debit: '80000' },
    { code: '2000', credit: '80000' },
  ]);
  const cPay = seedEntry(state, company.id, 'BQ', '2026-02-15', 'REG-DEMO-C1', 'Règlement fournisseur fictif C (DEMO)', [
    { code: '2000', debit: '30000' },
    { code: '1010', credit: '30000' },
  ]);
  seedGroup(state, company.id, payable.id, [
    { lineId: lineOf(cInv, '2000').id, amount: '30000' },
    { lineId: lineOf(cPay, '2000').id, amount: '30000' },
  ], { reason: 'Scénario C — 80 000 / 30 000, restant 50 000 (DEMO)' });

  // D - several invoices against one supplier payment.
  const d1 = seedEntry(state, company.id, 'PUR', '2026-03-01', 'ACH-DEMO-D1', 'Facture fournisseur fictive D1 (DEMO)', [
    { code: '6100', debit: '60000' },
    { code: '2000', credit: '60000' },
  ]);
  const d2 = seedEntry(state, company.id, 'PUR', '2026-03-02', 'ACH-DEMO-D2', 'Facture fournisseur fictive D2 (DEMO)', [
    { code: '6100', debit: '40000' },
    { code: '2000', credit: '40000' },
  ]);
  const dPay = seedEntry(state, company.id, 'BQ', '2026-03-10', 'REG-DEMO-D', 'Règlement groupé fictif D (DEMO)', [
    { code: '2000', debit: '100000' },
    { code: '1010', credit: '100000' },
  ]);
  seedGroup(state, company.id, payable.id, [
    { lineId: lineOf(d1, '2000').id, amount: '60000' },
    { lineId: lineOf(d2, '2000').id, amount: '40000' },
    { lineId: lineOf(dPay, '2000').id, amount: '100000' },
  ], { reason: 'Scénario D — plusieurs factures, un règlement (DEMO)' });

  // E - supplier invoice + credit note + balance.
  const eInv = seedEntry(state, company.id, 'PUR', '2026-04-01', 'ACH-DEMO-E', 'Facture fournisseur fictive E (DEMO)', [
    { code: '6100', debit: '45000' },
    { code: '2000', credit: '45000' },
  ]);
  const eCredit = seedEntry(state, company.id, 'PUR', '2026-04-05', 'AVF-DEMO-E', 'Avoir fournisseur fictif E (DEMO)', [
    { code: '2000', debit: '5000' },
    { code: '6100', credit: '5000' },
  ]);
  const ePay = seedEntry(state, company.id, 'BQ', '2026-04-10', 'REG-DEMO-E', 'Règlement solde fictif E (DEMO)', [
    { code: '2000', debit: '40000' },
    { code: '1010', credit: '40000' },
  ]);
  seedGroup(state, company.id, payable.id, [
    { lineId: lineOf(eInv, '2000').id, amount: '45000' },
    { lineId: lineOf(eCredit, '2000').id, amount: '5000' },
    { lineId: lineOf(ePay, '2000').id, amount: '40000' },
  ], { reason: 'Scénario E — facture, avoir et solde fournisseur (DEMO)' });

  // F - intentionally left lettered: attempting it again is refused by the demo API.

  // G - an already reversed group, with its reason and full history.
  const gInv = seedEntry(state, company.id, 'SAL', '2026-05-02', 'FAC-DEMO-G', 'Facture cliente fictive G (DEMO)', [
    { code: '1100', debit: '30000' },
    { code: '4010', credit: '30000' },
  ]);
  const gPay = seedEntry(state, company.id, 'BQ', '2026-05-08', 'REG-DEMO-G', 'Règlement fictif G (DEMO)', [
    { code: '1010', debit: '30000' },
    { code: '1100', credit: '30000' },
  ]);
  seedGroup(state, company.id, recv.id, [
    { lineId: lineOf(gInv, '1100').id, amount: '30000' },
    { lineId: lineOf(gPay, '1100').id, amount: '30000' },
  ], {
    status: 'reversed',
    reason: 'Scénario G — délettrage historisé (DEMO)',
    reversedReason: 'Erreur de sélection fictive — motif conservé (DEMO)',
  });

  // H - a payment already reconciled with a fictional bank transaction is shown
  // by the existing bank module; lettering itself stays a separate operation.

  // I - an unposted purchase document stays explicitly "awaiting accounting".
  const unposted = state.purchaseDocuments.find((d) => d.status === 'validated' && !d.accounting_entry_id);
  if (unposted) unposted.notes = `${unposted.notes ?? ''} Démonstration I : facture non comptabilisée, lettrage bloqué.`;
}
