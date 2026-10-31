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
  DemoBillingDocument,
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
    name: 'Compte courant principal (démo)',
    bank_name: 'Banque Fictive de l’Océan',
    currency: 'MUR',
    account_id: bankAccount.id,
    masked_reference: '•••• 1234',
    is_active: true,
    created_at: now(),
  };
  const eur: DemoBankAccount = {
    id: id(),
    company_id: company.id,
    name: 'Compte devises (démo)',
    bank_name: 'Banque Fictive de l’Océan',
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
    txn(eur, {
      date: '2025-08-12',
      label: 'Virement reçu en euros (fictif)',
      reference: 'EUR-DEMO-01',
      amount: '1000.0000',
      balance: '1000.0000',
    }),
  ];

  state.bankAccounts = [mur, eur];
  state.bankImports = [];
  state.bankTransactions = transactions;
  state.bankMatches = [];
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
        pdfOcr: false,
        directBankConnection: false,
        aiProvider: null,
        suggestions: 'deterministic',
      },
      limits: DEMO_BANK_LIMITS,
      notImplemented: [
        { fr: 'OFX/QFX : non implémenté dans la démo.', en: 'OFX/QFX: not implemented in the demo.' },
        { fr: 'PDF bancaire : OCR non implémenté.', en: 'Bank PDF: OCR not implemented.' },
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

  const txnMatch = /^\/transactions\/([^/]+)(?:\/(matches|exclude|proposals))?$/.exec(path);
  if (txnMatch) {
    const transactionId = txnMatch[1]!;
    const action = txnMatch[2];
    if (!action && method === 'GET') return detailOf(state, companyId, transactionId);
    if (action === 'exclude' && method === 'POST') {
      const txn = state.bankTransactions.find((t) => t.id === transactionId && t.company_id === companyId);
      if (!txn) throw new ApiError(404, 'BANK_TRANSACTION_NOT_FOUND', 'Transaction introuvable');
      if (txn.status === 'matched') throw new ApiError(409, 'BANK_ALREADY_MATCHED', 'Déjà rapprochée');
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
