/**
 * Demo engine for bank import and reconciliation (mission 9).
 *
 * It reuses the **same pure modules as the API** (statement engine,
 * reconciliation scoring, deterministic account suggestions). Only persistence
 * differs: everything stays in the browser localStorage, no file leaves the
 * page, no bank and no AI provider is contacted.
 */
import { ApiError } from '../errors';
import type {
  DemoAccount,
  DemoBankAccount,
  DemoBankImport,
  DemoBankMatch,
  DemoBankProposal,
  DemoBankRule,
  DemoBankTransaction,
  DemoBillingAllocation,
  DemoBillingDocument,
  DemoBillingLine,
  DemoBillingPayment,
  DemoCompany,
  DemoEntry,
  DemoLine,
  DemoPeriod,
  DemoState,
} from './runtime';
import { parseUpload, type ParsedFile, type SheetData } from '../../../api/src/modules/migration/parse';
import { stableDigest } from '../../../api/src/modules/bank/hash';
import { formatScaled, parseAmount } from '../../../api/src/modules/migration/normalize';
import {
  autoBankMapping,
  suggestBankMapping,
  BANK_FIELDS,
  BANK_SOURCE_LABELS,
  type BankColumnSuggestion,
  type BankFieldKey,
} from '../../../api/src/modules/bank/profiles';
import {
  bankFingerprint,
  buildBankPreview,
  type BankPreview,
} from '../../../api/src/modules/bank/engine';
import {
  findInternalTransfer,
  suggestAccount,
  suggestMatches,
  type AccountSuggestion,
  type LedgerBankLine,
  type MatchSuggestion,
  type SuggestionAccount,
  type SuggestionRule,
} from '../../../api/src/modules/bank/reconcile';

export const DEMO_BANK_LIMITS = { maxBytes: 5 * 1024 * 1024, maxRows: 5_000 } as const;

const now = () => new Date().toISOString();

function id(): string {
  return crypto.randomUUID();
}

function fmt(value: bigint): string {
  return formatScaled(value);
}

/* -------------------------------------------------------------------------- */
/* Seed                                                                       */
/* -------------------------------------------------------------------------- */

export function seedDemoBank(state: DemoState): void {
  const company = state.companies[0];
  if (!company) return;
  const bankAccount = state.accounts.find(
    (a) => a.company_id === company.id && a.code === '1010',
  );
  const fxAccount = state.accounts.find((a) => a.company_id === company.id && a.code === '1015');
  if (!bankAccount || !fxAccount) return;

  const mur: DemoBankAccount = {
    id: id(),
    company_id: company.id,
    name: 'Main current account (DEMO practice)',
    bank_name: 'Fictitious Ocean Bank (DEMO)',
    currency: 'MUR',
    account_id: bankAccount.id,
    masked_reference: '•••• 1234',
    is_active: true,
    created_at: now(),
  };
  const eur: DemoBankAccount = {
    id: id(),
    company_id: company.id,
    name: 'Foreign currency account (DEMO)',
    bank_name: 'Fictitious Ocean Bank (DEMO)',
    currency: 'EUR',
    account_id: fxAccount.id,
    masked_reference: '•••• 9876',
    is_active: true,
    created_at: now(),
  };

  const txn = (
    account: DemoBankAccount,
    input: {
      date: string;
      label: string;
      reference?: string | null;
      amount: string;
      balance?: string | null;
      externalId?: string | null;
    },
  ): DemoBankTransaction => {
    const amount = parseAmount(input.amount)!;
    return {
      id: id(),
      company_id: company.id,
      bank_account_id: account.id,
      import_id: null,
      txn_date: input.date,
      value_date: null,
      label: input.label,
      reference: input.reference ?? null,
      amount: fmt(amount),
      currency: account.currency,
      balance: input.balance ? fmt(parseAmount(input.balance)!) : null,
      external_id: input.externalId ?? null,
      fingerprint: bankFingerprint({
        accountId: account.id,
        externalId: input.externalId ?? null,
        txnDate: input.date,
        label: input.label,
        amount,
        currency: account.currency,
        balance: input.balance ? parseAmount(input.balance) : null,
      }),
      status: 'unmatched',
      created_at: now(),
    };
  };

  // ---------------------------------------------------------------- scenarios
  // Seven fictional scenarios A..G. They use the same data model and the same
  // rules as the API; nothing is posted from the browser.
  const scenarioCustomer = state.billingCustomers[0]!;
  const scenarioAccount = state.accounts.find(
    (a) => a.company_id === company.id && a.code === '1100',
  );
  const scenarioRevenue = state.accounts.find(
    (a) => a.company_id === company.id && a.code === '4000',
  );
  const scenarioDocs = new Map<string, DemoBillingDocument>();
  const scenarioPayments: DemoBillingPayment[] = [];
  const scenarioAllocations: DemoBillingAllocation[] = [];

  const makeScenarioInvoice = (
    key: string,
    total: string,
    date: string,
    label: string,
  ): DemoBillingDocument => {
    const doc: DemoBillingDocument = {
      id: id(),
      company_id: company.id,
      kind: 'invoice',
      doc_no: `FAC-DEMO-${key}`,
      customer_id: scenarioCustomer.id,
      customer_name: scenarioCustomer.name,
      customer_brn: scenarioCustomer.brn,
      issue_date: date,
      due_date: '2025-12-31',
      valid_until: null,
      currency: 'MUR',
      exchange_rate: '1.00000000',
      subtotal: fmt(amt(total)),
      discount_total: '0.0000',
      tax_total: '0.0000',
      total_amount: fmt(amt(total)),
      amount_paid: '0.0000',
      credited_amount: '0.0000',
      payment_status: 'unpaid',
      status: 'issued',
      source_kind: null,
      source_document_id: null,
      notes: `${label} — fictitious demonstration data, no real-world value.`,
      terms: null,
      sequence_year: Number(date.slice(0, 4)),
      sequence_no: 900 + scenarioDocs.size,
      issued_at: now(),
      locked_at: now(),
      accounting_entry_id: null,
      created_at: now(),
      updated_at: now(),
    };
    state.billingDocuments.push(doc);
    const line: DemoBillingLine = {
      id: id(),
      document_id: doc.id,
      company_id: company.id,
      line_no: 1,
      item_id: null,
      description: label,
      quantity: '1.0000',
      unit_price: doc.total_amount,
      unit: 'unit',
      discount_pct: '0.0000',
      vat_treatment: 'zero_rated',
      vat_rate: null,
      vat_rate_id: null,
      net_amount: doc.total_amount,
      discount_amount: '0.0000',
      tax_amount: '0.0000',
      line_total: doc.total_amount,
      revenue_account_id: scenarioRevenue?.id ?? null,
    };
    state.billingLines.push(line);
    scenarioDocs.set(key, doc);
    return doc;
  };

  const makeScenarioPayment = (
    key: string,
    date: string,
    total: string,
    allocations: { doc: DemoBillingDocument; amount: string }[],
    accountingEntryId: string | null = null,
  ): DemoBillingPayment => {
    const allocated = allocations.reduce((acc, a) => acc + amt(a.amount), 0n);
    const payment: DemoBillingPayment = {
      id: id(),
      company_id: company.id,
      customer_id: scenarioCustomer.id,
      payment_no: `REC-DEMO-${key}`,
      payment_date: date,
      value_date: date,
      amount: fmt(amt(total)),
      currency: 'MUR',
      exchange_rate: '1.00000000',
      method: 'bank_transfer',
      reference: `SCEN-${key}`,
      unallocated_amount: fmt(amt(total) - allocated),
      status: 'recorded',
      sequence_year: Number(date.slice(0, 4)),
      sequence_no: 900 + scenarioPayments.length,
      accounting_entry_id: accountingEntryId,
      created_at: now(),
    };
    state.billingPayments.push(payment);
    scenarioPayments.push(payment);
    for (const allocation of allocations) {
      const row: DemoBillingAllocation = {
        id: id(),
        payment_id: payment.id,
        invoice_id: allocation.doc.id,
        company_id: company.id,
        amount: fmt(amt(allocation.amount)),
      };
      state.billingAllocations.push(row);
      scenarioAllocations.push(row);
    }
    return payment;
  };

  const refreshScenarioInvoice = (doc: DemoBillingDocument) => {
    const paid = state.billingAllocations
      .filter((a) => a.invoice_id === doc.id)
      .reduce((acc, a) => acc + amt(a.amount), 0n);
    doc.amount_paid = fmt(paid);
    const settled = paid + amt(doc.credited_amount);
    doc.payment_status =
      settled >= amt(doc.total_amount) ? (settled > amt(doc.total_amount) ? 'overpaid' : 'paid') : settled > 0n ? 'partial' : 'unpaid';
    doc.status =
      settled >= amt(doc.total_amount)
        ? 'paid'
        : settled > 0n
          ? 'partially_paid'
          : 'issued';
  };

  // Scenario D needs a real (fictional) posted entry so that no second posting
  // can ever be offered.
  const postedJournal = state.journals.find(
    (j) => j.company_id === company.id && (j.code === 'BQ' || j.type === 'bank'),
  );
  let scenarioPostedEntryId: string | null = null;
  if (postedJournal && scenarioAccount) {
    const bankChart = state.accounts.find(
      (a) => a.company_id === company.id && a.code === '1010',
    );
    const year = '2025';
    const entry: DemoEntry = {
      id: id(),
      company_id: company.id,
      journal_id: postedJournal.id,
      entry_no: `${postedJournal.code}-${year}-9001`,
      entry_date: '2025-08-20',
      reference: 'SCEN-D',
      description: 'Fictitious posting of SCEN-D settlement (DEMO)',
      currency: 'MUR',
      exchange_rate: '1.00000000',
      status: 'posted',
      source: 'billing',
      reversal_of_entry_id: null,
      posted_at: now(),
      created_at: now(),
    };
    state.entries.push(entry);
    if (bankChart) {
      state.lines.push(
        {
          id: id(),
          entry_id: entry.id,
          company_id: company.id,
          account_id: bankChart.id,
          line_no: 1,
          description: 'Fictitious receipt SCEN-D',
          debit: '12000.0000',
          credit: '0.0000',
          txn_amount: '12000.0000',
          txn_currency: 'MUR',
          fx_rate: '1.00000000',
        },
        {
          id: id(),
          entry_id: entry.id,
          company_id: company.id,
          account_id: scenarioAccount.id,
          line_no: 2,
          description: 'Fictitious receivable SCEN-D',
          debit: '0.0000',
          credit: '12000.0000',
          txn_amount: '12000.0000',
          txn_currency: 'MUR',
          fx_rate: '1.00000000',
        },
      );
      scenarioPostedEntryId = entry.id;
    }
  }

  const scenarioA = makeScenarioInvoice('A', '100000.0000', '2025-08-01', 'Practice scenario A — three transfers for one invoice');
  makeScenarioPayment('A1', '2025-08-05', '40000.0000', [{ doc: scenarioA, amount: '40000.0000' }]);
  makeScenarioPayment('A2', '2025-08-06', '35000.0000', [{ doc: scenarioA, amount: '35000.0000' }]);
  makeScenarioPayment('A3', '2025-08-07', '25000.0000', [{ doc: scenarioA, amount: '25000.0000' }]);
  refreshScenarioInvoice(scenarioA);

  const scenarioB = makeScenarioInvoice('B', '80000.0000', '2025-08-02', 'Practice scenario B — partially settled invoice');
  makeScenarioPayment('B1', '2025-08-08', '30000.0000', [{ doc: scenarioB, amount: '30000.0000' }]);
  refreshScenarioInvoice(scenarioB);

  const scenarioC1 = makeScenarioInvoice('C1', '60000.0000', '2025-08-03', 'Practice scenario C — first grouped invoice');
  const scenarioC2 = makeScenarioInvoice('C2', '40000.0000', '2025-08-03', 'Practice scenario C — second grouped invoice');
  makeScenarioPayment('C1', '2025-08-09', '100000.0000', [
    { doc: scenarioC1, amount: '60000.0000' },
    { doc: scenarioC2, amount: '40000.0000' },
  ]);
  refreshScenarioInvoice(scenarioC1);
  refreshScenarioInvoice(scenarioC2);

  const scenarioD = makeScenarioInvoice('D', '12000.0000', '2025-08-04', 'Practice scenario D — settlement already posted');
  makeScenarioPayment(
    'D1',
    '2025-08-20',
    '12000.0000',
    [{ doc: scenarioD, amount: '12000.0000' }],
    scenarioPostedEntryId,
  );
  refreshScenarioInvoice(scenarioD);

  const scenarioE = makeScenarioInvoice('E', '15000.0000', '2025-08-05', 'Practice scenario E — duplicate-match attempt');
  makeScenarioPayment('E1', '2025-08-21', '15000.0000', [{ doc: scenarioE, amount: '15000.0000' }]);
  refreshScenarioInvoice(scenarioE);

  const scenarioF1 = makeScenarioInvoice('F1', '5000.0000', '2025-08-06', 'Practice scenario F — ambiguous invoice 1');
  const scenarioF2 = makeScenarioInvoice('F2', '5000.0000', '2025-08-06', 'Practice scenario F — ambiguous invoice 2');
  makeScenarioPayment('F1', '2025-08-22', '5000.0000', [{ doc: scenarioF1, amount: '5000.0000' }]);
  makeScenarioPayment('F2', '2025-08-22', '5000.0000', [{ doc: scenarioF2, amount: '5000.0000' }]);
  refreshScenarioInvoice(scenarioF1);
  refreshScenarioInvoice(scenarioF2);

  const transactions: DemoBankTransaction[] = [
    txn(mur, {
      date: '2025-08-05',
      label: 'Encaissement client FA-2025-001',
      reference: 'FA-2025-001',
      amount: '125000.0000',
      balance: '505000.0000',
    }),
    txn(mur, {
      date: '2025-08-01',
      label: 'Loyer du mois d’août',
      reference: 'LOYER-AOUT',
      amount: '-15000.0000',
      balance: '380000.0000',
    }),
    txn(mur, {
      date: '2025-07-10',
      label: 'Achat de matériel informatique',
      reference: 'MAT-INFO',
      amount: '-120000.0000',
      balance: '395000.0000',
    }),
    txn(mur, {
      date: '2025-08-07',
      label: 'Frais bancaires du mois',
      reference: 'FRAIS-08',
      amount: '-2500.0000',
      balance: '502500.0000',
    }),
    txn(mur, {
      date: '2025-08-08',
      label: 'Virement salaires août',
      reference: 'SAL-08',
      amount: '-45000.0000',
      balance: '457500.0000',
    }),
    txn(mur, {
      date: '2025-08-09',
      label: 'Paiement fournisseur AC-2025-001',
      reference: 'AC-2025-001',
      amount: '-32000.0000',
      balance: '425500.0000',
    }),
    txn(mur, {
      date: '2025-08-10',
      label: 'Opération sans correspondance (fictive)',
      reference: 'INCONNU-01',
      amount: '-7500.0000',
      balance: '418000.0000',
    }),
    txn(mur, {
      date: '2025-08-05',
      label: 'Practice scenario A — transfer 1/3',
      reference: 'SCEN-A1',
      amount: '40000.0000',
      balance: '565000.0000',
    }),
    txn(mur, {
      date: '2025-08-06',
      label: 'Practice scenario A — transfer 2/3',
      reference: 'SCEN-A2',
      amount: '35000.0000',
      balance: '600000.0000',
    }),
    txn(mur, {
      date: '2025-08-07',
      label: 'Practice scenario A — transfer 3/3',
      reference: 'SCEN-A3',
      amount: '25000.0000',
      balance: '625000.0000',
    }),
    txn(mur, {
      date: '2025-08-08',
      label: 'Practice scenario B — partial settlement 30,000',
      reference: 'SCEN-B1',
      amount: '30000.0000',
      balance: '655000.0000',
    }),
    txn(mur, {
      date: '2025-08-09',
      label: 'Practice scenario C — grouped transfer 100,000',
      reference: 'SCEN-C',
      amount: '100000.0000',
      balance: '755000.0000',
    }),
    txn(mur, {
      date: '2025-08-20',
      label: 'Practice scenario D — settlement already posted',
      reference: 'SCEN-D',
      amount: '12000.0000',
      balance: '767000.0000',
    }),
    txn(mur, {
      date: '2025-08-21',
      label: 'Practice scenario E — duplicate-match attempt',
      reference: 'SCEN-E',
      amount: '15000.0000',
      balance: '782000.0000',
    }),
    txn(mur, {
      date: '2025-08-22',
      label: 'Practice scenario F — ambiguous transfer',
      reference: 'SCEN-F',
      amount: '5000.0000',
      balance: '787000.0000',
    }),
    txn(mur, {
      date: '2025-08-23',
      label: 'Practice scenario G — internal transfer (out)',
      reference: 'SCEN-G-OUT',
      amount: '-10000.0000',
      balance: '777000.0000',
    }),
    txn(mur, {
      date: '2025-08-23',
      label: 'Practice scenario G — internal transfer (in)',
      reference: 'SCEN-G-IN',
      amount: '10000.0000',
      balance: '787000.0000',
    }),
    txn(eur, {
      date: '2025-08-12',
      label: 'Transfer received in euros (fictitious)',
      reference: 'EUR-DEMO-01',
      amount: '1000.0000',
      balance: '1000.0000',
    }),
  ];

  state.bankAccounts = [mur, eur];
  state.bankImports = [];
  state.bankTransactions = transactions;
  const scenarioETxn = transactions.find((t) => t.reference === 'SCEN-E');
  const scenarioEPayment = scenarioPayments.find((p) => p.payment_no === 'REC-DEMO-E1');
  state.bankMatches = [];
  if (scenarioETxn && scenarioEPayment) {
    scenarioETxn.status = 'matched';
    state.bankMatches.push({
      id: id(),
      company_id: company.id,
      bank_account_id: mur.id,
      transaction_id: scenarioETxn.id,
      entry_id: null,
      entry_line_id: null,
      billing_payment_id: scenarioEPayment.id,
      billing_invoice_id: scenarioE.id,
      amount: '15000.0000',
      note: 'Rapprochement fictif déjà confirmé (scénario E).',
      status: 'confirmed',
      kind: 'invoice',
      confidence: 1,
      reasons: ['Validation humaine fictive déjà enregistrée'],
      created_at: now(),
      decided_at: now(),
      decided_by: actorName(state),
    });
  }
  state.bankRules = [];
  state.bankProposals = [];
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function actorName(state: DemoState): string | null {
  const user = state.users.find((u) => u.id === state.session);
  return user?.full_name ?? user?.email ?? null;
}

function companyOf(state: DemoState, companyId: string): DemoCompany {
  const company = state.companies.find((c) => c.id === companyId);
  if (!company) throw new ApiError(404, 'COMPANY_NOT_FOUND', 'Société introuvable');
  return company;
}

function accountOf(state: DemoState, companyId: string, bankAccountId: string): DemoBankAccount {
  const account = state.bankAccounts.find(
    (a) => a.id === bankAccountId && a.company_id === companyId,
  );
  if (!account) throw new ApiError(404, 'BANK_ACCOUNT_NOT_FOUND', 'Compte bancaire introuvable');
  return account;
}

function chartAccount(state: DemoState, companyId: string, accountId: string): DemoAccount {
  const account = state.accounts.find((a) => a.id === accountId && a.company_id === companyId);
  if (!account) throw new ApiError(400, 'BANK_CHART_ACCOUNT_NOT_FOUND', 'Compte comptable introuvable');
  return account;
}

function ledgerLines(state: DemoState, companyId: string, accountId: string): LedgerBankLine[] {
  const result: LedgerBankLine[] = [];
  for (const line of state.lines) {
    if (line.company_id !== companyId || line.account_id !== accountId) continue;
    const entry = state.entries.find((e: DemoEntry) => e.id === line.entry_id);
    if (!entry || entry.status !== 'posted') continue;
    result.push({
      entryId: entry.id,
      lineId: line.id,
      entryNo: entry.entry_no,
      entryDate: entry.entry_date,
      reference: entry.reference,
      description: line.description,
      accountId: line.account_id,
      debit: line.debit,
      credit: line.credit,
      currency: entry.currency,
      txnCurrency: line.txn_currency,
      txnAmount: line.txn_amount,
      matched: state.bankMatches.some(
        (m) => m.entry_line_id === line.id && m.status === 'confirmed',
      ),
    });
  }
  return result.sort((a, b) => (a.entryDate < b.entryDate ? 1 : -1));
}

function suggestionAccounts(state: DemoState, companyId: string): SuggestionAccount[] {
  return state.accounts
    .filter((a) => a.company_id === companyId)
    .map((a) => ({
      id: a.id,
      code: a.code,
      name: a.name,
      type: a.type,
      isActive: a.is_active,
      currency: a.currency,
    }));
}

function suggestionRules(state: DemoState, companyId: string): SuggestionRule[] {
  return state.bankRules
    .filter((r) => r.company_id === companyId && r.is_active)
    .map((r) => ({
      id: r.id,
      name: r.name,
      labelPattern: r.label_pattern,
      referencePattern: r.reference_pattern,
      bankAccountId: r.bank_account_id,
      currency: r.currency,
      direction: r.direction,
      accountId: r.account_id,
      journalId: r.journal_id,
      priority: r.priority,
      version: r.version,
    }));
}

function matchFor(
  state: DemoState,
  company: DemoCompany,
  account: DemoBankAccount,
  txn: DemoBankTransaction,
): MatchSuggestion {
  const refs = state.billingDocuments
    .filter((d: DemoBillingDocument) => d.company_id === company.id && d.kind === 'invoice' && d.doc_no)
    .map((d) => d.doc_no!)
    .filter((no) => `${txn.label} ${txn.reference ?? ''}`.toLowerCase().includes(no.toLowerCase()));
  return suggestMatches(
    {
      id: txn.id,
      txnDate: txn.txn_date,
      label: txn.label,
      reference: txn.reference,
      amount: txn.amount,
      currency: txn.currency,
    },
    ledgerLines(state, company.id, account.account_id),
    { companyCurrency: company.functional_currency, windowDays: 7 },
    refs,
  );
}

function accountFor(
  state: DemoState,
  company: DemoCompany,
  account: DemoBankAccount,
  txn: DemoBankTransaction,
): AccountSuggestion {
  return suggestAccount(
    {
      id: txn.id,
      txnDate: txn.txn_date,
      label: txn.label,
      reference: txn.reference,
      amount: txn.amount,
      currency: txn.currency,
    },
    account.id,
    suggestionAccounts(state, company.id),
    suggestionRules(state, company.id),
    state.journals.filter((j) => j.company_id === company.id && j.is_active).map((j) => ({ id: j.id, code: j.code })),
  );
}

function amt(value: string | null | undefined): bigint {
  return parseAmount(value ?? '0') ?? 0n;
}

function absAmt(value: bigint): bigint {
  return value < 0n ? -value : value;
}

function billingCandidatesOf(
  state: DemoState,
  companyId: string,
  txn: DemoBankTransaction,
) {
  const txnTotal = absAmt(amt(txn.amount));
  const allocated = state.bankMatches
    .filter((m) => m.transaction_id === txn.id && m.status === 'confirmed')
    .reduce((acc, m) => acc + amt(m.amount), 0n);
  const remaining = txnTotal > allocated ? txnTotal - allocated : 0n;
  const candidates = state.billingPayments
    .filter(
      (p) =>
        p.company_id === companyId &&
        p.status === 'recorded' &&
        p.currency === txn.currency,
    )
    .map((payment) => {
      const customer = state.billingCustomers.find((c) => c.id === payment.customer_id);
      const allocations = state.billingAllocations
        .filter((a) => a.payment_id === payment.id)
        .map((a) => {
          const doc = state.billingDocuments.find((d) => d.id === a.invoice_id);
          const outstanding = doc
            ? amt(doc.total_amount) - amt(doc.amount_paid) - amt(doc.credited_amount)
            : 0n;
          return {
            invoiceId: a.invoice_id,
            invoiceNumber: doc?.doc_no ?? null,
            amount: fmt(amt(a.amount)),
            invoiceTotal: fmt(amt(doc?.total_amount)),
            invoicePaid: fmt(amt(doc?.amount_paid)),
            invoiceCredited: fmt(amt(doc?.credited_amount)),
            invoiceOutstanding: fmt(outstanding > 0n ? outstanding : 0n),
            invoiceStatus: doc?.status ?? 'unknown',
            invoicePaymentStatus: doc?.payment_status ?? 'unpaid',
            currency: doc?.currency ?? payment.currency,
          };
        });
      const matched = state.bankMatches
        .filter((m) => m.billing_payment_id === payment.id && m.status === 'confirmed')
        .reduce((acc, m) => acc + amt(m.amount), 0n);
      const available = amt(payment.amount) - matched > 0n ? amt(payment.amount) - matched : 0n;
      const linked = state.bankMatches.find(
        (m) =>
          m.transaction_id === txn.id &&
          m.billing_payment_id === payment.id &&
          m.status === 'confirmed',
      );
      const suggested = remaining < available ? remaining : available;
      const issues: { code: string; fr: string; en: string; blocking: boolean }[] = [];
      const reasons: { code: string; fr: string; en: string }[] = [];
      let confidence = 0.25;
      if (amt(txn.amount) < 0n) {
        issues.push({
          code: 'DIRECTION_MISMATCH',
          fr: 'Décaissement : ne peut pas financer un encaissement client.',
          en: 'Money out: cannot fund a customer receipt.',
          blocking: true,
        });
      }
      if (allocations.length === 0) {
        issues.push({
          code: 'NO_INVOICE_ALLOCATION',
          fr: 'Règlement non affecté à une facture.',
          en: 'Payment not allocated to an invoice.',
          blocking: true,
        });
      }
      if (available === 0n) {
        issues.push({
          code: 'PAYMENT_FULLY_ALLOCATED',
          fr: 'Règlement déjà rapproché à son montant total.',
          en: 'Payment already reconciled up to its full amount.',
          blocking: true,
        });
      }
      if (remaining === 0n && !linked) {
        issues.push({
          code: 'TRANSACTION_FULLY_ALLOCATED',
          fr: 'Transaction déjà affectée à son montant total.',
          en: 'Transaction already fully allocated.',
          blocking: true,
        });
      }
      if (suggested > 0n && suggested < remaining) {
        issues.push({
          code: 'PARTIAL_AMOUNT',
          fr: `Affectation partielle : ${fmt(suggested)} sur ${fmt(remaining)} restants.`,
          en: `Partial allocation: ${fmt(suggested)} of ${fmt(remaining)} remaining.`,
          blocking: false,
        });
      }
      const haystack = `${txn.label} ${txn.reference ?? ''} ${payment.reference ?? ''}`.toLowerCase();
      for (const allocation of allocations) {
        if (allocation.invoiceNumber && haystack.includes(allocation.invoiceNumber.toLowerCase())) {
          confidence += 0.25;
          reasons.push({
            code: 'INVOICE_REFERENCE',
            fr: `Référence ${allocation.invoiceNumber} présente dans le libellé.`,
            en: `Invoice reference ${allocation.invoiceNumber} in the label.`,
          });
          break;
        }
      }
      if (payment.reference && haystack.includes(payment.reference.toLowerCase())) {
        confidence += 0.15;
        reasons.push({
          code: 'PAYMENT_REFERENCE',
          fr: 'Référence du règlement présente dans le libellé.',
          en: 'Payment reference in the label.',
        });
      }
      if (customer && haystack.includes(customer.name.toLowerCase())) {
        confidence += 0.1;
        reasons.push({
          code: 'CUSTOMER_NAME',
          fr: 'Nom du client présent dans le libellé.',
          en: 'Customer name in the label.',
        });
      }
      if (suggested > 0n && (suggested === remaining || suggested === available)) {
        confidence += 0.2;
        reasons.push({
          code: 'AMOUNT_MATCH',
          fr: 'Montant exact d’un des deux côtés.',
          en: 'Exact amount on one side.',
        });
      }
      if (payment.payment_date === txn.txn_date) {
        confidence += 0.1;
        reasons.push({ code: 'DATE_PROXIMITY', fr: 'Même date.', en: 'Same date.' });
      }
      if (allocations.some((a) => a.invoicePaymentStatus !== 'paid')) {
        reasons.push({
          code: 'INVOICE_NOT_SETTLED',
          fr: 'Facture non soldée : le restant dû reste affiché.',
          en: 'Invoice not fully settled: outstanding remains visible.',
        });
      }
      reasons.push(
        payment.accounting_entry_id
          ? {
              code: 'ACCOUNTING_ALREADY_POSTED',
              fr: 'Règlement déjà comptabilisé : aucune seconde écriture.',
              en: 'Payment already posted: no second entry.',
            }
          : {
              code: 'ACCOUNTING_PENDING',
              fr: 'Règlement non comptabilisé : action humaine distincte requise.',
              en: 'Payment not posted: separate human action required.',
            },
      );
      return {
        paymentId: payment.id,
        paymentNumber: payment.payment_no ?? '—',
        paymentDate: payment.payment_date,
        amount: payment.amount,
        currency: payment.currency,
        method: payment.method,
        reference: payment.reference,
        customerId: payment.customer_id,
        customerName: customer?.name ?? '—',
        unallocatedAmount: payment.unallocated_amount,
        accountingEntryId: payment.accounting_entry_id,
        accountingPosted: Boolean(payment.accounting_entry_id),
        matchedAmount: fmt(matched),
        availableAmount: fmt(available),
        suggestedAmount: fmt(suggested),
        confidence: Math.min(1, Math.round(confidence * 100) / 100),
        reasons,
        issues,
        allocations,
        alreadyLinkedToTransaction: Boolean(linked),
      };
    })
    .sort((a, b) => {
      if (a.alreadyLinkedToTransaction !== b.alreadyLinkedToTransaction) {
        return a.alreadyLinkedToTransaction ? 1 : -1;
      }
      const aBlocked = a.issues.some((i) => i.blocking);
      const bBlocked = b.issues.some((i) => i.blocking);
      if (aBlocked !== bBlocked) return aBlocked ? 1 : -1;
      if (b.confidence !== a.confidence) return b.confidence - a.confidence;
      return a.paymentDate < b.paymentDate ? 1 : -1;
    });
  return {
    transactionRemaining: fmt(remaining),
    allocatedAmount: fmt(allocated),
    candidates,
  };
}

function paymentCandidateView(
  state: DemoState,
  companyId: string,
  payment: DemoBillingPayment,
  linked = true,
) {
  const base = billingCandidatesOf(state, companyId, {
    id: 'candidate-view',
    company_id: companyId,
    bank_account_id: '',
    import_id: null,
    txn_date: payment.payment_date,
    value_date: null,
    label: '',
    reference: null,
    amount: payment.amount,
    currency: payment.currency,
    balance: null,
    external_id: null,
    fingerprint: '',
    status: 'unmatched',
    created_at: payment.created_at,
  }).candidates.find((c) => c.paymentId === payment.id);
  return { ...base, alreadyLinkedToTransaction: linked };
}

function detailOf(state: DemoState, companyId: string, transactionId: string) {
  const txn = state.bankTransactions.find(
    (t) => t.id === transactionId && t.company_id === companyId,
  );
  if (!txn) throw new ApiError(404, 'BANK_TRANSACTION_NOT_FOUND', 'Transaction introuvable');
  const account = accountOf(state, companyId, txn.bank_account_id);
  const company = companyOf(state, companyId);
  const match = matchFor(state, company, account, txn);
  const accountSuggestion = accountFor(state, company, account, txn);
  const otherTxns = state.bankTransactions.filter(
    (t) =>
      t.company_id === companyId &&
      t.id !== txn.id &&
      ['unmatched', 'review'].includes(t.status),
  );
  const internalTransfer = findInternalTransfer(
    {
      id: txn.id,
      txnDate: txn.txn_date,
      label: txn.label,
      reference: txn.reference,
      amount: txn.amount,
      currency: txn.currency,
    },
    otherTxns.map((t) => ({
      id: t.id,
      bankAccountId: t.bank_account_id,
      txnDate: t.txn_date,
      amount: t.amount,
      currency: t.currency,
      label: t.label,
    })),
  );
  return {
    transaction: txn,
    bankAccount: account,
    match,
    account: accountSuggestion,
    internalTransfer,
    billing: billingCandidatesOf(state, companyId, txn),
    existingMatches: state.bankMatches.filter((m) => m.transaction_id === txn.id),
    proposals: state.bankProposals
      .filter((p) => p.transaction_id === txn.id)
      .map((p) => {
        const chart = state.accounts.find((a) => a.id === p.account_id);
        const journal = state.journals.find((j) => j.id === p.journal_id);
        return {
          ...p,
          account_code: chart?.code ?? null,
          account_name: chart?.name ?? null,
          journal_code: journal?.code ?? null,
        };
      }),
  };
}

function viewBankImport(item: DemoBankImport) {
  return { ...item };
}

/* -------------------------------------------------------------------------- */
/* Request handler                                                            */
/* -------------------------------------------------------------------------- */


function supplierCandidatesOf(state: DemoState, companyId: string, txn: DemoBankTransaction) {
  const signed = amt(txn.amount);
  const direction = signed < 0n ? 'out' : 'in';
  const allocated = state.bankMatches
    .filter((m) => m.transaction_id === txn.id && m.status === 'confirmed')
    .reduce((sum, m) => sum + amt(m.amount), 0n);
  const remaining = (signed < 0n ? -signed : signed) - allocated;
  const candidates = state.purchasePayments
    .filter((p) => p.company_id === companyId && p.status === 'recorded' && p.currency === txn.currency)
    .map((payment) => {
      const supplier = state.purchaseSuppliers.find((s) => s.id === payment.supplier_id);
      const matched = state.bankMatches
        .filter((m) => m.purchase_payment_id === payment.id && m.status === 'confirmed')
        .reduce((sum, m) => sum + amt(m.amount), 0n);
      const available = amt(payment.amount) - matched;
      const linked = state.bankMatches.find(
        (m) =>
          m.transaction_id === txn.id &&
          m.purchase_payment_id === payment.id &&
          m.status === 'confirmed',
      );
      const suggested = linked
        ? amt(linked.amount)
        : available < (remaining > 0n ? remaining : 0n)
          ? available
          : remaining > 0n
            ? remaining
            : 0n;
      const allocations = state.purchaseAllocations
        .filter((a) => a.payment_id === payment.id && !a.cancelled_at)
        .map((a) => {
          const invoice = state.purchaseDocuments.find((d) => d.id === a.invoice_id);
          const outstanding = invoice
            ? amt(invoice.total_amount) - amt(invoice.amount_paid) - amt(invoice.credited_amount)
            : 0n;
          return {
            invoiceId: a.invoice_id,
            invoiceNumber: invoice?.doc_no ?? null,
            supplierReference: invoice?.supplier_reference ?? '',
            amount: a.amount,
            invoiceTotal: invoice?.total_amount ?? '0.0000',
            invoicePaid: invoice?.amount_paid ?? '0.0000',
            invoiceCredited: invoice?.credited_amount ?? '0.0000',
            invoiceOutstanding: formatScaled(outstanding > 0n ? outstanding : 0n),
            currency: invoice?.currency ?? payment.currency,
          };
        });
      const issues: { code: string; fr: string; en: string; blocking: boolean }[] = [];
      if (direction === 'in') {
        issues.push({
          code: 'DIRECTION_MISMATCH',
          fr: 'Un crédit bancaire ne peut pas financer un paiement fournisseur.',
          en: 'A bank credit cannot fund a supplier payment.',
          blocking: true,
        });
      }
      if (available <= 0n) {
        issues.push({
          code: 'PAYMENT_FULLY_ALLOCATED',
          fr: 'Ce règlement est déjà entièrement rapproché en banque.',
          en: 'This payment is already fully reconciled in the bank.',
          blocking: true,
        });
      }
      if (remaining <= 0n) {
        issues.push({
          code: 'TRANSACTION_FULLY_ALLOCATED',
          fr: 'Cette transaction bancaire est déjà entièrement affectée.',
          en: 'This bank transaction is already fully allocated.',
          blocking: true,
        });
      }
      const reasons: { code: string; fr: string; en: string }[] = [];
      if (txn.reference && payment.reference && txn.reference.toLowerCase() === payment.reference.toLowerCase()) {
        reasons.push({
          code: 'REFERENCE_MATCH',
          fr: 'Référence bancaire identique à celle du règlement.',
          en: 'Bank reference matches the payment reference.',
        });
      }
      return {
        paymentId: payment.id,
        paymentNumber: payment.payment_no,
        paymentDate: payment.payment_date,
        kind: payment.kind,
        amount: payment.amount,
        currency: payment.currency,
        method: payment.method,
        reference: payment.reference,
        supplierId: payment.supplier_id,
        supplierName: supplier?.name ?? '',
        unallocatedAmount: formatScaled(available > 0n ? available : 0n),
        accountingEntryId: payment.accounting_entry_id,
        accountingPosted: Boolean(payment.accounting_entry_id),
        matchedAmount: formatScaled(matched),
        availableAmount: formatScaled(available > 0n ? available : 0n),
        suggestedAmount: formatScaled(suggested > 0n ? suggested : 0n),
        confidence: reasons.length ? 0.75 : 0.3,
        reasons,
        issues,
        allocations,
        alreadyLinkedToTransaction: Boolean(linked),
      };
    });
  return {
    transactionRemaining: formatScaled(remaining > 0n ? remaining : 0n),
    allocatedAmount: formatScaled(allocated),
    direction,
    candidates,
  };
}

export function handleDemoBank(
  state: DemoState,
  companyId: string,
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  rest: string,
  query: URLSearchParams,
  payload: Record<string, any>,
): unknown | undefined {
  if (!rest.startsWith('/bank')) return undefined;
  const company = companyOf(state, companyId);
  const path = rest.slice('/bank'.length);

  if (path === '/profiles' && method === 'GET') {
    return {
      fields: BANK_FIELDS,
      sources: BANK_SOURCE_LABELS,
      features: {
        csv: true,
        xlsx: true,
        tsv: true,
        ofx: false,
        pdfOcr: true,
        pdfText: true,
        pdfScanned: true,
        pdfGenericLayout: true,
        directBankConnection: false,
        aiProvider: null,
        suggestions: 'deterministic',
      },
      limits: DEMO_BANK_LIMITS,
      notImplemented: [
        { fr: 'OFX/QFX : non implémenté dans la démo.', en: 'OFX/QFX: not implemented in the demo.' },
        { fr: 'PDF bancaire : lecture prioritaire MCB, autres banques uniquement si soldes et colonnes reconnus ; import refusé sinon.', en: 'Bank PDF: MCB parsed first, other banks only when balances and columns are recognised; import refused otherwise.' },
        { fr: 'Aucune connexion bancaire réelle.', en: 'No real bank connection.' },
      ],
    };
  }

  if (path === '/accounts' && method === 'GET') {
    return {
      accounts: state.bankAccounts
        .filter((a) => a.company_id === companyId)
        .map((a) => {
          const chart = state.accounts.find((c) => c.id === a.account_id);
          const txns = state.bankTransactions.filter((t) => t.bank_account_id === a.id);
          return {
            ...a,
            account_code: chart?.code ?? null,
            account_name: chart?.name ?? null,
            transaction_count: txns.length,
            unmatched_count: txns.filter((t) =>
              ['unmatched', 'review', 'proposed'].includes(t.status),
            ).length,
          };
        }),
    };
  }

  if (path === '/accounts' && method === 'POST') {
    const chart = chartAccount(state, companyId, String(payload.accountId ?? ''));
    if (!chart.is_active || chart.type !== 'asset') {
      throw new ApiError(400, 'BANK_CHART_ACCOUNT_NOT_ASSET', 'Compte comptable inactif ou non patrimonial');
    }
    const currency = String(payload.currency ?? '').toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) {
      throw new ApiError(400, 'BANK_INVALID_CURRENCY', 'Devise invalide');
    }
    const created: DemoBankAccount = {
      id: id(),
      company_id: companyId,
      name: String(payload.name ?? '').trim(),
      bank_name: String(payload.bankName ?? '').trim(),
      currency,
      account_id: chart.id,
      masked_reference: payload.maskedReference ? `•••• ${String(payload.maskedReference).slice(-4)}` : null,
      is_active: true,
      created_at: now(),
    };
    if (!created.name || !created.bank_name) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Nom et banque requis');
    }
    state.bankAccounts.push(created);
    return { account: created };
  }

  if (path === '/preview' && method === 'POST') {
    const account = accountOf(state, companyId, String(payload.bankAccountId ?? ''));
    const preview = parseDemoStatement(state, company, account, payload);
    return preview;
  }

  if (path === '/imports' && method === 'POST') {
    const account = accountOf(state, companyId, String(payload.bankAccountId ?? ''));
    const parsed = parseDemoStatement(state, company, account, payload);
    if (parsed.preview.blocksImport) {
      throw new ApiError(400, 'BANK_IMPORT_BLOCKED', 'Des contrôles bloquants empêchent l’import');
    }
    const existing = state.bankImports.find(
      (i) => i.bank_account_id === account.id && i.idempotency_key === parsed.idempotencyKey,
    );
    if (existing) {
      return {
        import: viewBankImport(existing),
        imported: 0,
        duplicates: parsed.preview.summary.total,
        reimport: true,
        preview: parsed.preview,
        bankAccount: account,
      };
    }
    const record: DemoBankImport = {
      id: id(),
      company_id: companyId,
      bank_account_id: account.id,
      file_name: String(payload.fileName ?? 'releve.csv'),
      file_size: parsed.bytes,
      file_hash: parsed.fileHash,
      idempotency_key: parsed.idempotencyKey,
      format: parsed.format,
      encoding: parsed.encoding,
      status: 'imported',
      row_count: parsed.preview.summary.total,
      imported_count: 0,
      duplicate_count: 0,
      opening_balance: parsed.preview.balances.opening,
      closing_balance: parsed.preview.balances.closing,
      summary: parsed.preview.summary,
      created_at: now(),
    };
    for (const item of parsed.preview.transactions) {
      if (item.action === 'skip') {
        record.duplicate_count += 1;
        continue;
      }
      state.bankTransactions.push({
        id: id(),
        company_id: companyId,
        bank_account_id: account.id,
        import_id: record.id,
        txn_date: item.txnDate!,
        value_date: item.valueDate,
        label: item.label,
        reference: item.reference,
        amount: item.amount,
        currency: item.currency,
        balance: item.balance,
        external_id: item.externalId,
        fingerprint: item.fingerprint,
        status: 'unmatched',
        created_at: now(),
      });
      record.imported_count += 1;
    }
    state.bankImports.unshift(record);
    return {
      import: viewBankImport(record),
      imported: record.imported_count,
      duplicates: record.duplicate_count,
      reimport: false,
      preview: parsed.preview,
      bankAccount: account,
    };
  }

  if (path === '/imports' && method === 'GET') {
    const bankAccountId = query.get('bankAccountId');
    return {
      imports: state.bankImports.filter(
        (i) => i.company_id === companyId && (!bankAccountId || i.bank_account_id === bankAccountId),
      ),
    };
  }

  if (path === '/transactions' && method === 'GET') {
    const bankAccountId = query.get('bankAccountId');
    const status = query.get('status');
    return {
      transactions: state.bankTransactions
        .filter(
          (t) =>
            t.company_id === companyId &&
            (!bankAccountId || t.bank_account_id === bankAccountId) &&
            (!status || t.status === status),
        )
        .sort((a, b) => (a.txn_date < b.txn_date ? 1 : -1))
        .map((t) => ({ ...t, bank_name: state.bankAccounts.find((b) => b.id === t.bank_account_id)?.name })),
    };
  }

  const supplierCandidatesMatch = /^\/transactions\/([^/]+)\/supplier-candidates$/.exec(path);
  if (supplierCandidatesMatch && method === 'GET') {
    const txn = state.bankTransactions.find(
      (t) => t.id === supplierCandidatesMatch[1] && t.company_id === companyId,
    );
    if (!txn) throw new ApiError(404, 'BANK_TRANSACTION_NOT_FOUND', 'Transaction introuvable');
    return supplierCandidatesOf(state, companyId, txn);
  }

  const supplierLinkMatch = /^\/transactions\/([^/]+)\/supplier-payments(?:\/([^/]+))?$/.exec(path);
  if (supplierLinkMatch) {
    const txn = state.bankTransactions.find(
      (t) => t.id === supplierLinkMatch[1] && t.company_id === companyId,
    );
    if (!txn) throw new ApiError(404, 'BANK_TRANSACTION_NOT_FOUND', 'Transaction introuvable');
    const paymentId = supplierLinkMatch[2];
    if (method === 'POST' && !paymentId) {
      if (payload.confirm !== true) {
        throw new ApiError(400, 'BANK_CONFIRMATION_REQUIRED', 'Confirmation humaine explicite requise');
      }
      const payment = state.purchasePayments.find(
        (p) => p.id === String(payload.paymentId ?? '') && p.company_id === companyId,
      );
      if (!payment) throw new ApiError(404, 'PURCHASE_PAYMENT_NOT_FOUND', 'Règlement fournisseur introuvable');
      if (payment.status !== 'recorded') {
        throw new ApiError(409, 'PURCHASE_PAYMENT_CANCELLED', 'Règlement fournisseur annulé');
      }
      if (payment.currency !== txn.currency) {
        throw new ApiError(409, 'BANK_CURRENCY_MISMATCH', 'Devises incompatibles');
      }
      if (amt(txn.amount) >= 0n) {
        throw new ApiError(409, 'BANK_DIRECTION_MISMATCH', 'Un encaissement ne finance pas un paiement fournisseur');
      }
      const requested = parseAmount(String(payload.amount ?? ''));
      if (requested === null || requested <= 0n) {
        throw new ApiError(400, 'BANK_INVALID_AMOUNT', 'Montant positif requis');
      }
      const existing = state.bankMatches.find(
        (m) =>
          m.transaction_id === txn.id &&
          m.purchase_payment_id === payment.id &&
          m.status === 'confirmed',
      );
      if (existing) {
        if (amt(existing.amount) !== requested) {
          throw new ApiError(409, 'BANK_LINK_ALREADY_EXISTS', 'Ce règlement est déjà lié pour un autre montant');
        }
        return { match: existing, transaction: txn, idempotent: true };
      }
      const txnAllocated = state.bankMatches
        .filter((m) => m.transaction_id === txn.id && m.status === 'confirmed')
        .reduce((sum, m) => sum + amt(m.amount), 0n);
      const txnRemaining = (amt(txn.amount) < 0n ? -amt(txn.amount) : amt(txn.amount)) - txnAllocated;
      if (requested > txnRemaining) {
        throw new ApiError(409, 'BANK_AMOUNT_EXCEEDS_TRANSACTION', 'Montant supérieur au restant de la transaction');
      }
      const paymentMatched = state.bankMatches
        .filter((m) => m.purchase_payment_id === payment.id && m.status === 'confirmed')
        .reduce((sum, m) => sum + amt(m.amount), 0n);
      const available = amt(payment.amount) - paymentMatched;
      if (requested > available) {
        throw new ApiError(409, 'BANK_AMOUNT_EXCEEDS_PAYMENT', 'Montant supérieur au restant du règlement');
      }
      const match: DemoBankMatch = {
        id: id(),
        company_id: companyId,
        bank_account_id: txn.bank_account_id,
        transaction_id: txn.id,
        entry_id: null,
        entry_line_id: null,
        billing_payment_id: null,
        purchase_payment_id: payment.id,
        amount: formatScaled(requested),
        note: payload.note ?? null,
        status: 'confirmed',
        kind: 'supplier_payment',
        confidence: 1,
        reasons: ['Lien humain confirmé — règlement fournisseur existant'],
        created_at: new Date().toISOString(),
        decided_at: new Date().toISOString(),
        decided_by: null,
      };
      state.bankMatches.push(match);
      txn.status = 'matched';
      return { match, transaction: txn, idempotent: false };
    }
    if (method === 'DELETE' && paymentId) {
      if (payload.confirm !== true) {
        throw new ApiError(400, 'BANK_CONFIRMATION_REQUIRED', 'Confirmation humaine explicite requise');
      }
      const index = state.bankMatches.findIndex(
        (m) =>
          m.transaction_id === txn.id &&
          m.purchase_payment_id === paymentId &&
          m.status === 'confirmed',
      );
      if (index < 0) throw new ApiError(404, 'BANK_MATCH_NOT_FOUND', 'Rapprochement fournisseur introuvable');
      state.bankMatches.splice(index, 1);
      txn.status = state.bankMatches.some((m) => m.transaction_id === txn.id && m.status === 'confirmed')
        ? 'matched'
        : 'unmatched';
      return { removed: true };
    }
  }

  const billingCandidatesMatch = /^\/transactions\/([^/]+)\/billing-candidates$/.exec(path);
  if (billingCandidatesMatch && method === 'GET') {
    const txn = state.bankTransactions.find(
      (t) => t.id === billingCandidatesMatch[1] && t.company_id === companyId,
    );
    if (!txn) throw new ApiError(404, 'BANK_TRANSACTION_NOT_FOUND', 'Transaction introuvable');
    return billingCandidatesOf(state, companyId, txn);
  }

  const billingLinkMatch = /^\/transactions\/([^/]+)\/billing-payments(?:\/([^/]+))?$/.exec(path);
  if (billingLinkMatch) {
    const txn = state.bankTransactions.find(
      (t) => t.id === billingLinkMatch[1] && t.company_id === companyId,
    );
    if (!txn) throw new ApiError(404, 'BANK_TRANSACTION_NOT_FOUND', 'Transaction introuvable');
    const paymentId = billingLinkMatch[2];
    if (!paymentId && method === 'POST') {
      if (payload.confirm !== true) {
        throw new ApiError(400, 'BANK_CONFIRMATION_REQUIRED', 'Confirmation humaine explicite requise');
      }
      const payment = state.billingPayments.find(
        (p) => p.id === String(payload.paymentId ?? '') && p.company_id === companyId,
      );
      if (!payment) throw new ApiError(404, 'PAYMENT_NOT_FOUND', 'Règlement introuvable');
      if (payment.status !== 'recorded') {
        throw new ApiError(409, 'PAYMENT_CANCELLED', 'Règlement annulé');
      }
      if (payment.currency !== txn.currency) {
        throw new ApiError(409, 'BANK_CURRENCY_MISMATCH', 'Devises incompatibles');
      }
      if (amt(txn.amount) < 0n) {
        throw new ApiError(409, 'BANK_DIRECTION_MISMATCH', 'Un décaissement ne finance pas un encaissement');
      }
      const requested = parseAmount(String(payload.amount ?? ''));
      if (requested === null || requested <= 0n) {
        throw new ApiError(400, 'BANK_INVALID_AMOUNT', 'Montant positif requis');
      }
      const existing = state.bankMatches.find(
        (m) =>
          m.transaction_id === txn.id &&
          m.billing_payment_id === payment.id &&
          m.status === 'confirmed',
      );
      if (existing) {
        if (amt(existing.amount) !== requested) {
          throw new ApiError(
            409,
            'BANK_LINK_ALREADY_EXISTS',
            'Ce règlement est déjà lié à cette transaction pour un autre montant',
          );
        }
        return {
          match: existing,
          transaction: txn,
          payment: paymentCandidateView(state, companyId, payment),
          idempotent: true,
        };
      }
      const allocations = state.billingAllocations.filter((a) => a.payment_id === payment.id);
      if (allocations.length === 0) {
        throw new ApiError(
          409,
          'PAYMENT_NOT_ALLOCATED',
          'Ce règlement n’est affecté à aucune facture',
        );
      }
      if (txn.status === 'excluded' || txn.status === 'cancelled') {
        throw new ApiError(409, 'BANK_TRANSACTION_CLOSED', 'Transaction close');
      }
      const txnAllocated = state.bankMatches
        .filter((m) => m.transaction_id === txn.id && m.status === 'confirmed')
        .reduce((acc, m) => acc + amt(m.amount), 0n);
      const txnRemaining = absAmt(amt(txn.amount)) - txnAllocated;
      if (requested > txnRemaining) {
        throw new ApiError(
          409,
          'BANK_AMOUNT_EXCEEDS_TRANSACTION',
          `Demandé ${fmt(requested)}, restant ${fmt(txnRemaining > 0n ? txnRemaining : 0n)}`,
        );
      }
      const paymentMatched = state.bankMatches
        .filter((m) => m.billing_payment_id === payment.id && m.status === 'confirmed')
        .reduce((acc, m) => acc + amt(m.amount), 0n);
      const paymentRemaining = amt(payment.amount) - paymentMatched;
      if (requested > paymentRemaining) {
        throw new ApiError(
          409,
          'BANK_AMOUNT_EXCEEDS_PAYMENT',
          `Demandé ${fmt(requested)}, restant ${fmt(paymentRemaining > 0n ? paymentRemaining : 0n)}`,
        );
      }
      const match = {
        id: id(),
        company_id: companyId,
        bank_account_id: txn.bank_account_id,
        transaction_id: txn.id,
        entry_id: payment.accounting_entry_id,
        entry_line_id: null,
        billing_payment_id: payment.id,
        billing_invoice_id: allocations.length === 1 ? allocations[0]!.invoice_id : null,
        amount: fmt(requested),
        note: payload.note ? String(payload.note) : null,
        status: 'confirmed' as const,
        kind: 'invoice' as const,
        confidence: 1,
        reasons: ['Validation humaine explicite', 'Comptabilisation distincte'],
        created_at: now(),
        decided_at: now(),
        decided_by: actorName(state),
      };
      state.bankMatches.push(match);
      const total = txnAllocated + requested;
      txn.status = total >= absAmt(amt(txn.amount)) ? 'matched' : 'partially_matched';
      return {
        match,
        transaction: txn,
        payment: paymentCandidateView(state, companyId, payment),
        idempotent: false,
      };
    }
    if (paymentId && method === 'DELETE') {
      if (payload.confirm !== true) {
        throw new ApiError(400, 'BANK_CONFIRMATION_REQUIRED', 'Confirmation humaine explicite requise');
      }
      const match = state.bankMatches.find(
        (m) =>
          m.transaction_id === txn.id &&
          m.billing_payment_id === paymentId &&
          m.status === 'confirmed',
      );
      if (!match) throw new ApiError(404, 'BANK_MATCH_NOT_FOUND', 'Aucun rapprochement confirmé');
      match.status = 'rejected';
      match.decided_at = now();
      match.decided_by = actorName(state);
      match.note = payload.reason ? String(payload.reason) : match.note ?? null;
      const remaining = state.bankMatches
        .filter((m) => m.transaction_id === txn.id && m.status === 'confirmed')
        .reduce((acc, m) => acc + amt(m.amount), 0n);
      const total = absAmt(amt(txn.amount));
      txn.status =
        remaining === 0n ? 'unmatched' : remaining >= total ? 'matched' : 'partially_matched';
      return { match, transaction: txn };
    }
  }

  const txnMatch = /^\/transactions\/([^/]+)(?:\/(matches|exclude|proposals))?$/.exec(path);
  if (txnMatch) {
    const transactionId = txnMatch[1]!;
    const action = txnMatch[2];
    if (!action && method === 'GET') return detailOf(state, companyId, transactionId);
    if (action === 'exclude' && method === 'POST') {
      const txn = state.bankTransactions.find((t) => t.id === transactionId && t.company_id === companyId);
      if (!txn) throw new ApiError(404, 'BANK_TRANSACTION_NOT_FOUND', 'Transaction introuvable');
      if (txn.status === 'matched') throw new ApiError(409, 'BANK_ALREADY_MATCHED', 'Déjà rapprochée');
      if (state.bankMatches.some((m) => m.transaction_id === txn.id && m.status === 'confirmed')) {
        throw new ApiError(
          409,
          'BANK_TRANSACTION_PARTIALLY_ALLOCATED',
          'Des affectations confirmées existent : retirez-les avant d’exclure',
        );
      }
      txn.status = 'excluded';
      return { transaction: txn };
    }
    if (action === 'matches' && method === 'POST') {
      if (payload.confirm !== true) {
        throw new ApiError(400, 'BANK_CONFIRMATION_REQUIRED', 'Confirmation humaine explicite requise');
      }
      const lineIds = Array.isArray(payload.lineIds) ? payload.lineIds.map(String) : [];
      if (lineIds.length === 0) throw new ApiError(400, 'BANK_LINES_REQUIRED', 'Aucune ligne sélectionnée');
      const detail = detailOf(state, companyId, transactionId);
      const txn = detail.transaction;
      if (txn.status === 'matched') throw new ApiError(409, 'BANK_ALREADY_MATCHED', 'Déjà rapprochée');
      if (state.bankMatches.some((m) => m.transaction_id === txn.id && m.status === 'confirmed')) {
        throw new ApiError(
          409,
          'BANK_TRANSACTION_PARTIALLY_ALLOCATED',
          'Transaction déjà affectée à des règlements',
        );
      }
      const lines = ledgerLines(state, companyId, detail.bankAccount.account_id).filter((l) =>
        lineIds.includes(l.lineId),
      );
      if (lines.length !== lineIds.length) {
        throw new ApiError(400, 'BANK_LINE_NOT_FOUND', 'Ligne comptable introuvable');
      }
      if (lines.some((l) => l.matched)) {
        throw new ApiError(409, 'BANK_LINE_ALREADY_MATCHED', 'Ligne déjà rapprochée');
      }
      const total = lines.reduce(
        (acc, l) => acc + (parseAmount(l.debit) ?? 0n) - (parseAmount(l.credit) ?? 0n),
        0n,
      );
      if (total !== parseAmount(txn.amount)) {
        throw new ApiError(400, 'BANK_AMOUNT_MISMATCH', 'Les lignes ne totalisent pas le montant bancaire');
      }
      for (const line of lines) {
        state.bankMatches.push({
          id: id(),
          company_id: companyId,
          bank_account_id: detail.bankAccount.id,
          transaction_id: txn.id,
          entry_id: line.entryId,
          entry_line_id: line.lineId,
          billing_payment_id: null,
          amount: fmt(
            absAmt((parseAmount(line.debit) ?? 0n) - (parseAmount(line.credit) ?? 0n)),
          ),
          status: 'confirmed',
          kind: 'entry',
          confidence: 1,
          reasons: ['Validation humaine explicite'],
          created_at: now(),
          decided_at: now(),
          decided_by: actorName(state),
        });
      }
      txn.status = 'matched';
      return { matched: lines.length, transaction: txn };
    }
    if (action === 'proposals' && method === 'POST') {
      const detail = detailOf(state, companyId, transactionId);
      const txn = detail.transaction;
      if (txn.status === 'matched') throw new ApiError(409, 'BANK_ALREADY_MATCHED', 'Déjà rapprochée');
      if (state.bankMatches.some((m) => m.transaction_id === txn.id && m.status === 'confirmed')) {
        throw new ApiError(
          409,
          'BANK_TRANSACTION_PARTIALLY_ALLOCATED',
          'Transaction déjà affectée à des règlements',
        );
      }
      const accountId = payload.accountId ? String(payload.accountId) : detail.account.accountId;
      if (!accountId) {
        throw new ApiError(400, 'BANK_ACCOUNT_DECISION_REQUIRED', 'Aucun compte approprié : décision humaine requise');
      }
      const chart = chartAccount(state, companyId, accountId);
      if (!chart.is_active) throw new ApiError(400, 'BANK_CHART_ACCOUNT_INACTIVE', 'Compte inactif');
      const journals = state.journals.filter((j) => j.company_id === companyId && j.is_active);
      const journal =
        journals.find((j) => j.code === (payload.journalCode ?? 'BQ')) ??
        journals.find((j) => j.code === 'BQ') ??
        journals.find((j) => j.code === 'OD') ??
        journals[0];
      if (!journal) throw new ApiError(400, 'BANK_JOURNAL_NOT_FOUND', 'Aucun journal disponible');
      const native = parseAmount(txn.amount)!;
      const proposal: DemoBankProposal = {
        id: id(),
        company_id: companyId,
        bank_account_id: detail.bankAccount.id,
        transaction_id: txn.id,
        account_id: chart.id,
        journal_id: journal.id,
        entry_date: txn.txn_date,
        amount: fmt(native < 0n ? -native : native),
        direction: native > 0n ? 'in' : 'out',
        status: 'proposed',
        confidence: detail.account.confidence,
        rationale: {
          fr: detail.account.rationaleFr,
          en: detail.account.rationaleEn,
          kind: detail.account.kind,
          salary: detail.account.kind === 'salary',
        },
        rule_id: detail.account.ruleId,
        created_entry_id: null,
        created_at: now(),
        decided_at: null,
      };
      state.bankProposals.unshift(proposal);
      return { proposal };
    }
  }

  const proposalMatch = /^\/proposals\/([^/]+)\/(accept|reject)$/.exec(path);
  if (proposalMatch && method === 'POST') {
    const proposalId = proposalMatch[1]!;
    const action = proposalMatch[2];
    const proposal = state.bankProposals.find(
      (p) => p.id === proposalId && p.company_id === companyId,
    );
    if (!proposal) throw new ApiError(404, 'BANK_PROPOSAL_NOT_FOUND', 'Proposition introuvable');
    if (proposal.status !== 'proposed') {
      throw new ApiError(409, 'BANK_PROPOSAL_CLOSED', 'Proposition déjà traitée');
    }
    if (action === 'reject') {
      proposal.status = 'rejected';
      proposal.decided_at = now();
      return { proposal };
    }
    if (payload.confirm !== true) {
      throw new ApiError(400, 'BANK_CONFIRMATION_REQUIRED', 'Confirmation humaine explicite requise');
    }
    const txn = state.bankTransactions.find((t) => t.id === proposal.transaction_id);
    if (!txn) throw new ApiError(404, 'BANK_TRANSACTION_NOT_FOUND', 'Transaction introuvable');
    if (txn.status === 'matched') throw new ApiError(409, 'BANK_ALREADY_MATCHED', 'Déjà rapprochée');
    if (state.bankMatches.some((m) => m.transaction_id === txn.id && m.status === 'confirmed')) {
      throw new ApiError(
        409,
        'BANK_TRANSACTION_PARTIALLY_ALLOCATED',
        'Transaction déjà affectée à des règlements',
      );
    }
    const bankAccount = accountOf(state, companyId, proposal.bank_account_id);
    if (!proposal.account_id) {
      throw new ApiError(400, 'BANK_ACCOUNT_DECISION_REQUIRED', 'Aucun compte de contrepartie');
    }
    if (txn.currency !== company.functional_currency && !payload.exchangeRate) {
      throw new ApiError(
        400,
        'BANK_EXCHANGE_RATE_REQUIRED',
        'Un compte en devise exige un taux explicite : aucun taux n’est inventé',
      );
    }
    const journal = state.journals.find((j) => j.id === proposal.journal_id);
    if (!journal) throw new ApiError(400, 'BANK_JOURNAL_NOT_FOUND', 'Journal introuvable');
    const period = state.periods.find(
      (p: DemoPeriod) =>
        p.company_id === companyId &&
        p.status === 'open' &&
        p.start_date <= txn.txn_date &&
        p.end_date >= txn.txn_date,
    );
    if (!period) throw new ApiError(409, 'PERIOD_CLOSED', 'Aucune période ouverte ne couvre cette date');

    const native = parseAmount(txn.amount)!;
    const amount = native < 0n ? -native : native;
    const seqKey = `${companyId}:${journal.id}:${txn.txn_date.slice(0, 4)}`;
    state.sequences[seqKey] = (state.sequences[seqKey] ?? 0) + 1;
    const entry: DemoEntry = {
      id: id(),
      company_id: companyId,
      journal_id: journal.id,
      entry_no: `${journal.code}-${txn.txn_date.slice(0, 4)}-${String(state.sequences[seqKey]).padStart(4, '0')}`,
      entry_date: txn.txn_date,
      reference: txn.reference,
      description: txn.label.slice(0, 300),
      currency: txn.currency,
      exchange_rate: String(payload.exchangeRate ?? '1'),
      status: 'posted',
      source: 'manual',
      reversal_of_entry_id: null,
      posted_at: now(),
      created_at: now(),
    };
    state.entries.push(entry);
    const bankLine: DemoLine = {
      id: id(),
      entry_id: entry.id,
      company_id: companyId,
      account_id: bankAccount.account_id,
      line_no: 1,
      description: txn.label,
      debit: native > 0n ? fmt(amount) : '0.0000',
      credit: native < 0n ? fmt(amount) : '0.0000',
      txn_amount: fmt(amount),
      txn_currency: txn.currency,
      fx_rate: String(payload.exchangeRate ?? '1'),
    };
    const counterpart: DemoLine = {
      id: id(),
      entry_id: entry.id,
      company_id: companyId,
      account_id: proposal.account_id,
      line_no: 2,
      description: txn.label,
      debit: native < 0n ? fmt(amount) : '0.0000',
      credit: native > 0n ? fmt(amount) : '0.0000',
      txn_amount: fmt(amount),
      txn_currency: txn.currency,
      fx_rate: String(payload.exchangeRate ?? '1'),
    };
    state.lines.push(bankLine, counterpart);
    proposal.status = 'accepted';
    proposal.created_entry_id = entry.id;
    proposal.decided_at = now();
    state.bankMatches.push({
      id: id(),
      company_id: companyId,
      bank_account_id: bankAccount.id,
      transaction_id: txn.id,
      entry_id: entry.id,
      entry_line_id: bankLine.id,
      billing_payment_id: null,
      amount: fmt(amount),
      status: 'confirmed',
      kind: 'entry',
      confidence: 1,
      reasons: ['Proposition acceptée par un humain'],
      created_at: now(),
      decided_at: now(),
      decided_by: actorName(state),
    });
    txn.status = 'matched';
    return { proposal, entry, matched: 1 };
  }

  if (path === '/rules' && method === 'GET') {
    return {
      rules: state.bankRules
        .filter((r) => r.company_id === companyId)
        .map((r) => {
          const chart = state.accounts.find((a) => a.id === r.account_id);
          const journal = state.journals.find((j) => j.id === r.journal_id);
          return { ...r, account_code: chart?.code ?? null, account_name: chart?.name ?? null, journal_code: journal?.code ?? null };
        }),
    };
  }

  if (path === '/rules' && method === 'POST') {
    if (!payload.labelPattern && !payload.referencePattern) {
      throw new ApiError(400, 'BANK_RULE_PATTERN_REQUIRED', 'Un motif de libellé ou de référence est requis');
    }
    const chart = chartAccount(state, companyId, String(payload.accountId ?? ''));
    if (!chart.is_active) throw new ApiError(400, 'BANK_CHART_ACCOUNT_INACTIVE', 'Compte inactif');
    if (payload.bankAccountId) accountOf(state, companyId, String(payload.bankAccountId));
    const journal = payload.journalId
      ? state.journals.find((j) => j.id === payload.journalId && j.company_id === companyId)
      : state.journals.find((j) => j.company_id === companyId && j.code === 'BQ');
    let version = 1;
    if (payload.supersedesId) {
      const previous = state.bankRules.find(
        (r) => r.id === payload.supersedesId && r.company_id === companyId,
      );
      if (!previous) throw new ApiError(404, 'BANK_RULE_NOT_FOUND', 'Règle introuvable');
      version = previous.version + 1;
      previous.is_active = false;
    }
    const rule: DemoBankRule = {
      id: id(),
      company_id: companyId,
      name: String(payload.name ?? '').trim(),
      label_pattern: payload.labelPattern ?? null,
      reference_pattern: payload.referencePattern ?? null,
      bank_account_id: payload.bankAccountId ?? null,
      currency: payload.currency ?? null,
      direction: payload.direction ?? 'any',
      account_id: chart.id,
      journal_id: journal?.id ?? null,
      priority: Number(payload.priority ?? 100),
      version,
      supersedes_id: payload.supersedesId ?? null,
      is_active: true,
      notes: payload.notes ?? null,
      created_at: now(),
    };
    if (!rule.name) throw new ApiError(400, 'VALIDATION_ERROR', 'Nom requis');
    state.bankRules.unshift(rule);
    return { rule };
  }

  const ruleMatch = /^\/rules\/([^/]+)$/.exec(path);
  if (ruleMatch && method === 'DELETE') {
    const rule = state.bankRules.find((r) => r.id === ruleMatch[1] && r.company_id === companyId);
    if (!rule) throw new ApiError(404, 'BANK_RULE_NOT_FOUND', 'Règle introuvable');
    rule.is_active = false;
    return {};
  }

  if (path === '/reconciliation-report' && method === 'GET') {
    const bankAccountId = query.get('bankAccountId');
    if (!bankAccountId) return { report: null };
    return {
      report: buildAdvancedDemoReport(
        state,
        company,
        bankAccountId,
        query.get('from'),
        query.get('to'),
      ),
    };
  }

  if (path === '/reconciliation-report.csv' && method === 'GET') {
    const bankAccountId = query.get('bankAccountId');
    if (!bankAccountId) throw new ApiError(400, 'VALIDATION_ERROR', 'bankAccountId requis');
    const report = buildAdvancedDemoReport(
      state,
      company,
      bankAccountId,
      query.get('from'),
      query.get('to'),
    );
    return advancedDemoCsv(report, query.get('lang') === 'en' ? 'en' : 'fr');
  }

  if (path === '/report' && method === 'GET') {
    const bankAccountId = query.get('bankAccountId');
    if (!bankAccountId) return { report: null };
    return { report: buildDemoReport(state, company, bankAccountId, query.get('from'), query.get('to')) };
  }

  return undefined;
}

function parseDemoStatement(
  state: DemoState,
  company: DemoCompany,
  account: DemoBankAccount,
  payload: Record<string, any>,
) {
  let bytes: Uint8Array;
  if (typeof payload.contentBase64 === 'string' && payload.contentBase64) {
    const binary = atob(payload.contentBase64);
    bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  } else if (typeof payload.contentText === 'string') {
    bytes = new TextEncoder().encode(payload.contentText);
  } else {
    throw new ApiError(400, 'BANK_FILE_REQUIRED', 'Aucun fichier fourni');
  }
  if (bytes.length > DEMO_BANK_LIMITS.maxBytes) {
    throw new ApiError(400, 'BANK_FILE_TOO_LARGE', 'Fichier trop volumineux pour la démo');
  }
  let file: ParsedFile;
  try {
    file = parseUpload(String(payload.fileName ?? 'releve.csv'), bytes);
  } catch (error) {
    throw new ApiError(400, 'BANK_FILE_INVALID', (error as Error).message);
  }
  const sheet: SheetData | undefined =
    (payload.sheetName ? file.sheets.find((s) => s.name === payload.sheetName) : null) ??
    file.sheets.find((s) => s.rows.length > 0 && s.headers.length >= 2) ??
    file.sheets[0];
  if (!sheet) throw new ApiError(400, 'BANK_NO_TABLE', 'Aucun tableau détecté');
  const suggestions = suggestBankMapping(sheet.headers);
  const mapping =
    payload.mapping && Object.keys(payload.mapping).length > 0
      ? payload.mapping
      : autoBankMapping(suggestions);
  const existing = state.bankTransactions
    .filter((t) => t.bank_account_id === account.id)
    .map((t) => t.fingerprint);
  const periods = state.periods
    .filter((p) => p.company_id === company.id && p.status === 'open')
    .map((p) => ({ startDate: p.start_date, endDate: p.end_date }));
  const preview = buildBankPreview(sheet, mapping, {
    accountId: account.id,
    accountCurrency: account.currency,
    companyCurrency: company.functional_currency,
    dayFirst: payload.dayFirst !== false,
    existingFingerprints: existing,
    openPeriods: periods,
    openingBalance: payload.openingBalance ?? null,
    closingBalance: payload.closingBalance ?? null,
  });
  return {
    bankAccount: account,
    sheets: file.sheets.map((s) => ({ name: s.name, headers: s.headers, rows: s.rows.length })),
    sheetName: sheet.name,
    format: file.format,
    encoding: file.encoding,
    delimiter: file.delimiter,
    suggestions: suggestions as Record<BankFieldKey, BankColumnSuggestion>,
    mapping,
    preview: preview as BankPreview,
    idempotencyKey: stableDigest(['demo-bank-import', account.id, stableDigest([bytes.length, String.fromCharCode(...bytes.slice(0, 64))])]),
    fileHash: stableDigest([bytes.length, String.fromCharCode(...bytes.slice(0, 64))]),
    bytes: bytes.length,
    limits: DEMO_BANK_LIMITS,
  };
}

function buildAdvancedDemoReport(
  state: DemoState,
  company: DemoCompany,
  bankAccountId: string,
  from: string | null,
  to: string | null,
) {
  const account = accountOf(state, company.id, bankAccountId);
  const txns = state.bankTransactions
    .filter(
      (t) =>
        t.company_id === company.id &&
        t.bank_account_id === bankAccountId &&
        (!from || t.txn_date >= from) &&
        (!to || t.txn_date <= to),
    )
    .sort((a, b) => (a.txn_date < b.txn_date ? 1 : -1));
  const matches = state.bankMatches.filter(
    (m) =>
      m.company_id === company.id &&
      m.bank_account_id === bankAccountId &&
      m.status === 'confirmed',
  );
  const paymentMatched = new Map<string, bigint>();
  for (const match of matches) {
    if (!match.billing_payment_id) continue;
    paymentMatched.set(
      match.billing_payment_id,
      (paymentMatched.get(match.billing_payment_id) ?? 0n) + amt(match.amount),
    );
  }
  const transactions = txns.map((txn) => {
    const allocated = matches
      .filter((m) => m.transaction_id === txn.id)
      .reduce((acc, m) => acc + amt(m.amount), 0n);
    const total = absAmt(amt(txn.amount));
    return {
      id: txn.id,
      date: txn.txn_date,
      label: txn.label,
      reference: txn.reference,
      amount: txn.amount,
      currency: txn.currency,
      status: txn.status,
      allocatedAmount: fmt(allocated),
      remainingAmount: fmt(total - allocated > 0n ? total - allocated : 0n),
      allocationCount: matches.filter((m) => m.transaction_id === txn.id).length,
      billingPaymentNumbers: [
        ...new Set(
          matches
            .filter((m) => m.transaction_id === txn.id && m.billing_payment_id)
            .map(
              (m) =>
                state.billingPayments.find((p) => p.id === m.billing_payment_id)?.payment_no ?? '',
            )
            .filter(Boolean),
        ),
      ],
    };
  });
  const allocations = matches.map((match) => {
    const txn = state.bankTransactions.find((t) => t.id === match.transaction_id)!;
    const payment = state.billingPayments.find((p) => p.id === match.billing_payment_id);
    const linkedInvoices = state.billingAllocations
      .filter((a) => payment && a.payment_id === payment.id)
      .map((a) => {
        const doc = state.billingDocuments.find((d) => d.id === a.invoice_id);
        const outstanding = doc
          ? amt(doc.total_amount) - amt(doc.amount_paid) - amt(doc.credited_amount)
          : 0n;
        return {
          invoiceId: a.invoice_id,
          invoiceNumber: doc?.doc_no ?? null,
          amount: fmt(amt(a.amount)),
          total: fmt(amt(doc?.total_amount)),
          outstanding: fmt(outstanding > 0n ? outstanding : 0n),
          paymentStatus: doc?.payment_status ?? 'unpaid',
        };
      });
    const paymentMatchedAmount = payment ? paymentMatched.get(payment.id) ?? 0n : 0n;
    return {
      matchId: match.id,
      transactionId: txn.id,
      transactionDate: txn.txn_date,
      transactionLabel: txn.label,
      transactionReference: txn.reference,
      transactionAmount: fmt(absAmt(amt(txn.amount))),
      allocatedAmount: fmt(amt(match.amount)),
      transactionRemaining: fmt(
        absAmt(amt(txn.amount)) - amt(match.amount) > 0n
          ? absAmt(amt(txn.amount)) - amt(match.amount)
          : 0n,
      ),
      status: match.status,
      kind: match.kind,
      paymentId: payment?.id ?? null,
      paymentNumber: payment?.payment_no ?? null,
      paymentDate: payment?.payment_date ?? null,
      paymentAmount: payment ? fmt(amt(payment.amount)) : null,
      paymentMatchedAmount: payment ? fmt(paymentMatchedAmount) : null,
      paymentAvailableAmount: payment
        ? fmt(
            amt(payment.amount) - paymentMatchedAmount > 0n
              ? amt(payment.amount) - paymentMatchedAmount
              : 0n,
          )
        : null,
      accountingEntryId: payment?.accounting_entry_id ?? null,
      accountingEntryNo:
        state.entries.find((e) => e.id === payment?.accounting_entry_id)?.entry_no ?? null,
      accountingPosted: Boolean(payment?.accounting_entry_id),
      invoices: linkedInvoices,
      decidedAt: match.decided_at,
      decidedBy: match.decided_by ?? null,
      note: match.note ?? null,
    };
  });
  const invoices = state.billingDocuments
    .filter(
      (d) =>
        d.company_id === company.id &&
        d.kind === 'invoice' &&
        d.status !== 'draft' &&
        d.status !== 'cancelled',
    )
    .map((d) => {
      const outstanding = amt(d.total_amount) - amt(d.amount_paid) - amt(d.credited_amount);
      return {
        invoiceId: d.id,
        invoiceNumber: d.doc_no,
        customerName: d.customer_name,
        currency: d.currency,
        issueDate: d.issue_date,
        dueDate: d.due_date,
        total: d.total_amount,
        paid: d.amount_paid,
        credited: d.credited_amount,
        outstanding: fmt(outstanding > 0n ? outstanding : 0n),
        paymentStatus: d.payment_status,
        documentStatus: d.status,
        accountingPosted: Boolean(d.accounting_entry_id),
      };
    });
  const outstandingByCurrency = new Map<string, { amount: bigint; count: number }>();
  for (const invoice of invoices) {
    if (amt(invoice.outstanding) <= 0n) continue;
    const current = outstandingByCurrency.get(invoice.currency) ?? { amount: 0n, count: 0 };
    current.amount += amt(invoice.outstanding);
    current.count += 1;
    outstandingByCurrency.set(invoice.currency, current);
  }
  let reconciledPaymentTotal = 0n;
  let unreconciledPaymentTotal = 0n;
  let postedPaymentCount = 0;
  for (const payment of state.billingPayments.filter(
    (p) => p.company_id === company.id && p.status === 'recorded',
  )) {
    const matched = paymentMatched.get(payment.id) ?? 0n;
    reconciledPaymentTotal += matched;
    const rest = amt(payment.amount) - matched;
    if (rest > 0n) unreconciledPaymentTotal += rest;
    if (payment.accounting_entry_id) postedPaymentCount += 1;
  }
  const allocationsTotal = transactions.reduce((acc, t) => acc + amt(t.allocatedAmount), 0n);
  const unallocatedTotal = transactions.reduce((acc, t) => acc + amt(t.remainingAmount), 0n);
  return {
    generatedAt: now(),
    companyId: company.id,
    bankAccount: {
      id: account.id,
      name: account.name,
      bankName: account.bank_name,
      currency: account.currency,
      maskedReference: account.masked_reference,
    },
    period: { from, to },
    summary: {
      transactionCount: transactions.length,
      matchedCount: transactions.filter((t) => t.status === 'matched').length,
      partiallyMatchedCount: transactions.filter((t) => t.status === 'partially_matched').length,
      openCount: transactions.filter((t) =>
        ['unmatched', 'proposed', 'review'].includes(t.status),
      ).length,
      allocatedTotal: fmt(allocationsTotal),
      unallocatedTotal: fmt(unallocatedTotal),
      allocationCount: allocations.length,
      partialAllocationCount: transactions.filter((t) => t.status === 'partially_matched').length,
      postedPaymentCount,
      unpostedPaymentCount:
        state.billingPayments.filter(
          (p) => p.company_id === company.id && p.status === 'recorded',
        ).length - postedPaymentCount,
      invoiceCount: invoices.length,
      invoicesPaid: invoices.filter((i) => i.paymentStatus === 'paid').length,
      invoicesPartial: invoices.filter((i) => i.paymentStatus === 'partial').length,
      invoicesUnpaid: invoices.filter((i) => i.paymentStatus === 'unpaid').length,
      invoicesOverpaid: invoices.filter((i) => i.paymentStatus === 'overpaid').length,
      outstandingByCurrency: [...outstandingByCurrency.entries()].map(([currency, value]) => ({
        currency,
        amount: fmt(value.amount),
        count: value.count,
      })),
      billingReconciledPaymentTotal: fmt(reconciledPaymentTotal),
      billingUnreconciledPaymentTotal: fmt(unreconciledPaymentTotal),
    },
    simpleReport: buildDemoReport(state, company, bankAccountId, from, to),
    transactions,
    allocations,
    invoices,
  };
}

function advancedDemoCsv(
  report: ReturnType<typeof buildAdvancedDemoReport>,
  locale: 'fr' | 'en',
): string {
  const fr = locale === 'fr';
  const escape = (value: string | number | null | undefined) => {
    if (value === null || value === undefined) return '';
    let text = String(value);
    if (!/^-?\d+(\.\d+)?$/.test(text) && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
    return /[";\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const rows: (string | number | null | undefined)[][] = [
    [fr ? 'Rapport de rapprochement avancé (démo)' : 'Advanced reconciliation report (demo)'],
    [fr ? 'Généré le' : 'Generated at', report.generatedAt],
    [fr ? 'Société' : 'Company', report.companyId],
    [fr ? 'Compte' : 'Account', report.bankAccount.name],
    [fr ? 'Devise' : 'Currency', report.bankAccount.currency],
    [],
    [fr ? 'Affectations confirmées' : 'Confirmed allocations'],
    [
      fr ? 'Date' : 'Date',
      fr ? 'Transaction' : 'Transaction',
      fr ? 'Montant affecté' : 'Allocated amount',
      fr ? 'Restant' : 'Remaining',
      fr ? 'Règlement' : 'Payment',
      fr ? 'Factures' : 'Invoices',
      fr ? 'Écriture' : 'Entry',
      fr ? 'Comptabilisé' : 'Posted',
    ],
    ...report.allocations.map((a) => [
      a.transactionDate,
      a.transactionLabel,
      a.allocatedAmount,
      a.transactionRemaining,
      a.paymentNumber,
      a.invoices.map((i) => i.invoiceNumber ?? i.invoiceId).join(' | '),
      a.accountingEntryNo,
      a.accountingPosted ? (fr ? 'Oui' : 'Yes') : (fr ? 'Non' : 'No'),
    ]),
    [],
    [fr ? 'Factures' : 'Invoices'],
    [
      fr ? 'Numéro' : 'Number',
      fr ? 'Client' : 'Customer',
      fr ? 'Total' : 'Total',
      fr ? 'Restant dû' : 'Outstanding',
      fr ? 'Statut' : 'Status',
    ],
    ...report.invoices.map((i) => [i.invoiceNumber, i.customerName, i.total, i.outstanding, i.paymentStatus]),
  ];
  return '\uFEFF' + rows.map((row) => row.map(escape).join(';')).join('\r\n') + '\r\n';
}

export function buildDemoReport(
  state: DemoState,
  company: DemoCompany,
  bankAccountId: string,
  from?: string | null,
  to?: string | null,
) {
  const account = accountOf(state, company.id, bankAccountId);
  const inRange = (date: string) => (!from || date >= from) && (!to || date <= to);
  const txns = state.bankTransactions.filter((t) => t.bank_account_id === account.id && inRange(t.txn_date));
  const matched = txns.filter((t) => t.status === 'matched').length;
  const unmatched = txns.filter((t) => ['unmatched', 'proposed', 'review'].includes(t.status)).length;
  const withBalance = txns
    .filter((t) => t.balance !== null)
    .sort((a, b) => (a.txn_date < b.txn_date ? -1 : 1));
  const bankBalance = withBalance.at(-1)?.balance ?? null;
  const ledger = state.lines
    .filter((l) => l.company_id === company.id && l.account_id === account.account_id)
    .filter((l) => {
      const entry = state.entries.find((e) => e.id === l.entry_id);
      return entry?.status === 'posted' && inRange(entry.entry_date);
    })
    .reduce((acc, l) => acc + (parseAmount(l.debit) ?? 0n) - (parseAmount(l.credit) ?? 0n), 0n);
  const movement = txns.reduce((acc, t) => acc + (parseAmount(t.amount) ?? 0n), 0n);
  const difference = (parseAmount(bankBalance ?? '0') ?? 0n) - ledger;
  const ledgerUnmatched = state.lines.filter((l) => {
    if (l.company_id !== company.id || l.account_id !== account.account_id) return false;
    const entry = state.entries.find((e) => e.id === l.entry_id);
    return (
      entry?.status === 'posted' &&
      !state.bankMatches.some((m) => m.entry_line_id === l.id && m.status === 'confirmed')
    );
  }).length;
  const status =
    bankBalance !== null && unmatched === 0 && ledgerUnmatched === 0 && difference === 0n
      ? 'reconciled'
      : 'differences';
  const confirmed = state.bankMatches
    .filter(
      (m) =>
        m.bank_account_id === account.id &&
        m.status === 'confirmed' &&
        state.bankTransactions.some(
          (t) => t.id === m.transaction_id && inRange(t.txn_date),
        ),
    )
    .sort((a, b) => (a.decided_at ?? '').localeCompare(b.decided_at ?? ''));
  const lastDecision = confirmed.at(-1) ?? null;
  const chart = state.accounts.find((a) => a.id === account.account_id);
  const explanations: { code: string; fr: string; en: string }[] = [];
  if (!bankBalance) {
    explanations.push({
      code: 'NO_BANK_BALANCE',
      fr: 'Aucun solde bancaire n’est fourni : le rapport ne peut pas conclure.',
      en: 'No bank balance is available: the report cannot conclude.',
    });
  }
  if (unmatched > 0) {
    explanations.push({
      code: 'UNMATCHED_BANK_TRANSACTIONS',
      fr: `${unmatched} opération(s) non rapprochée(s) expliquent tout ou partie de l’écart.`,
      en: `${unmatched} unreconciled transaction(s) explain all or part of the difference.`,
    });
  }
  if (ledgerUnmatched > 0) {
    explanations.push({
      code: 'UNMATCHED_LEDGER_LINES',
      fr: `${ledgerUnmatched} ligne(s) comptable(s) du compte bancaire ne sont pas rapprochées : le rapport ne peut pas conclure.`,
      en: `${ledgerUnmatched} ledger line(s) of the bank account are not reconciled: the report cannot conclude.`,
    });
  }
  if (difference !== 0n) {
    explanations.push({
      code: 'BALANCE_DIFFERENCE',
      fr: 'Le solde bancaire et le solde comptable diffèrent : rapprochement incomplet.',
      en: 'The bank and ledger balances differ: reconciliation is incomplete.',
    });
  }
  if (status === 'reconciled') {
    explanations.push({ code: 'RECONCILED', fr: 'Aucun écart inexpliqué.', en: 'No unexplained difference.' });
  }
  return {
    companyId: company.id,
    bankAccount: {
      id: account.id,
      name: account.name,
      bankName: account.bank_name,
      currency: account.currency,
      maskedReference: account.masked_reference,
    },
    ledgerAccount: { code: chart?.code ?? null, name: chart?.name ?? null },
    period: { from: from ?? null, to: to ?? null },
    bankBalance,
    ledgerBalance: fmt(ledger),
    bankMovement: fmt(movement),
    matchedCount: matched,
    unmatchedCount: unmatched,
    ledgerUnmatchedCount: ledgerUnmatched,
    difference: fmt(difference),
    status,
    explanations,
    validatedAt: lastDecision?.decided_at ?? null,
    validatedBy: lastDecision?.decided_by ?? null,
  };
}
