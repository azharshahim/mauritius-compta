import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../../api';
import { demoEnabled } from '../../demo/mode';
import { useI18n } from '../../i18n';
import { errorMessage, useSession } from '../../store';
import { ACCOUNTING_UPLOAD_ACCEPT, validateAccountingUpload } from '../../lib/upload';
import { Badge, Button, Card, EmptyState, ErrorBanner, Field, Spinner } from '../../components/ui';
import { AppIcon } from '../../components/AppIcon';
import type { BankPreview, BankFinding } from '../../../../api/src/modules/bank/engine';
import type { AccountSuggestion, MatchSuggestion } from '../../../../api/src/modules/bank/reconcile';
import type { BankColumnSuggestion, BankFieldDef } from '../../../../api/src/modules/bank/profiles';

/**
 * Comptabilité → Banque & rapprochement (mission 9).
 *
 * The page never posts an accounting entry by itself: an import only stores
 * bank transactions, a match is confirmed through an explicit button, and a
 * proposal must be accepted by a human. In demo mode the same calls are served
 * by the in-browser engine (no network).
 */

const L = {
  fr: {
    title: 'Banque & rapprochement',
    intro:
      'Importez un relevé bancaire, rapprochez-le des écritures existantes et préparez les imputations manquantes. Aucune écriture n’est comptabilisée automatiquement.',
    accounts: 'Comptes bancaires',
    import: 'Importer un relevé',
    transactions: 'Transactions',
    rules: 'Règles',
    report: 'Rapport',
    name: 'Nom du compte',
    bank: 'Banque',
    currency: 'Devise',
    chart: 'Compte comptable associé',
    reference: 'Référence bancaire (masquée)',
    createAccount: 'Ajouter le compte',
    noAccounts: 'Aucun compte bancaire. Ajoutez-en un pour importer un relevé.',
    masked: 'Référence masquée',
    importFor: 'Compte bancaire',
    file: 'Fichier du relevé',
    dayFirst: 'Dates au format JJ/MM/AAAA',
    preview: 'Analyser le fichier',
    confirmImport: 'Confirmer l’import',
    pdfStatement: 'Importer un relevé PDF',
    summary: 'Synthèse',
    importable: 'opérations importables',
    duplicates: 'doublons ignorés',
    errors: 'contrôles bloquants',
    warnings: 'avertissements',
    blocked: 'Import bloqué : corrigez les contrôles en rouge.',
    imported: 'Import terminé',
    history: 'Historique des imports',
    noImports: 'Aucun import enregistré pour ce compte.',
    fileName: 'Fichier',
    importedAt: 'Importé le',
    rows: 'lignes',
    created: 'créée(s)',
    nothingNew: 'Aucune nouvelle opération : réimport identique.',
    samples: 'Fichiers fictifs téléchargeables',
    txnDate: 'Date',
    label: 'Libellé',
    ref: 'Référence',
    amount: 'Montant',
    debit: 'Débit',
    credit: 'Crédit',
    balance: 'Solde',
    currencyCol: 'Devise',
    toImport: 'À importer',
    duplicateRow: 'Doublon',
    status: 'Statut',
    open: 'Ouvrir',
    noTxns: 'Aucune transaction importée.',
    suggestions: 'Correspondances proposées',
    noMatch: 'Aucune écriture existante ne correspond.',
    confirmMatch: 'Confirmer le rapprochement',
    exclude: 'Refuser / à examiner',
    accountSuggestion: 'Imputation proposée',
    acceptProposal: 'Accepter et comptabiliser',
    createProposal: 'Préparer une proposition',
    rejectProposal: 'Refuser la proposition',
    salary: 'Libellé de paie détecté : proposition uniquement, aucune paie calculée.',
    transfer: 'Virement interne possible : vérification humaine requise.',
    matchStatus: 'Statut du rapprochement',
    statusUnmatched: 'Non rapproché',
    statusPartial: 'Partiellement affectée',
    billingTitle: 'Règlements clients liés',
    createPaymentTitle: 'Créer un règlement client depuis cet encaissement',
    createPaymentHint: 'Le règlement est enregistré et rapproché, mais aucune écriture comptable n’est créée : la comptabilisation reste une action séparée via le moteur existant.',
    selectCustomer: 'Client',
    selectInvoice: 'Facture à régler',
    invoiceOutstanding: 'Restant dû',
    createPayment: 'Créer le règlement et rapprocher',
    paymentCreated: 'Règlement créé, facture mise à jour et transaction rapprochée.',
    paymentIdempotent: 'Un règlement existe déjà pour cette transaction : aucun doublon créé.',
    noCustomer: 'Aucun client actif.',
    noOpenInvoice: 'Aucune facture ouverte dans la devise de cette transaction.',
    loadInvoices: 'Charger les factures',
    accountingSeparate: 'Aucune comptabilisation automatique.',
    openingBank: 'Solde bancaire d’ouverture',
    openingLedger: 'Solde comptable d’ouverture',
    closingBank: 'Solde bancaire de clôture',
    closingLedger: 'Solde comptable de clôture',
    bankMovement: 'Mouvement bancaire de la période',
    ledgerMovement: 'Mouvement comptable de la période',
    partialCount: 'partiellement rapprochées',
    excludedCount: 'exclues',
    totalCount: 'opérations dans la période',
    priorCount: 'opérations antérieures reprises à l’ouverture',
    periodsTitle: 'Validation de période de relevé',
    periodsHint: 'La validation fige les soldes et l’empreinte du relevé. Elle ne crée aucune écriture et ne force jamais un écart à zéro.',
    openPeriod: 'Ouvrir / actualiser la période',
    validatePeriod: 'Valider la période',
    reopenPeriod: 'Réouvrir la période',
    periodStatus: 'Statut de la période',
    periodNote: 'Note de validation (obligatoire si écart)',
    periodReason: 'Motif de réouverture',
    periodHash: 'Empreinte du relevé',
    periodDifference: 'Écart de clôture',
    periodAccepted: 'Écart accepté',
    periodCsv: 'CSV de la période validée (montants figés)',
    periodOpen: 'Ouverte',
    periodValidated: 'Validée',
    periodReopened: 'Réouverte',
    periodHistory: 'Historique des décisions',
    noPeriod: 'Aucune période enregistrée sur ces dates.',
    billingEmpty: 'Aucun règlement client enregistré pour cette devise.',
    billingRemaining: 'Restant à affecter sur la transaction',
    billingAmount: 'Montant à affecter',
    billingLink: 'Associer ce règlement',
    billingLinked: 'Règlement associé',
    billingInvoices: 'Factures concernées',
    billingOutstanding: 'Restant dû',
    billingPosted: 'Comptabilisé',
    billingNotPosted: 'Non comptabilisé',
    billingPost: 'Comptabiliser ce règlement',
    billingPostHint: 'Action humaine distincte, via le moteur comptable existant. Le rapprochement bancaire ne comptabilise rien.',
    billingUnlink: 'Retirer le rapprochement',
    billingUnlinkConfirm: 'Confirmer le retrait (l’historique est conservé)',
    billingBlocked: 'Non proposé',
    billingPartialWarning: 'Affectation partielle : le restant dû de la facture reste affiché.',
    billingNoAllocation: 'Ce règlement n’est affecté à aucune facture : il ne peut pas prouver un règlement.',
    supplierTitle: 'Règlements fournisseurs liés',
    supplierEmpty: 'Aucun règlement fournisseur enregistré pour cette devise.',
    supplierRemaining: 'Restant fournisseur à affecter sur la transaction',
    supplierAmount: 'Montant à affecter',
    supplierLink: 'Associer ce règlement fournisseur',
    supplierLinked: 'Règlement fournisseur associé',
    supplierInvoices: 'Factures fournisseurs concernées',
    supplierOutstanding: 'Restant dû',
    supplierPosted: 'Comptabilisé',
    supplierNotPosted: 'Non comptabilisé',
    supplierUnlink: 'Retirer le rapprochement fournisseur',
    supplierBlocked: 'Non proposé',
    supplierNoAllocation: 'Ce règlement fournisseur n’est affecté à aucune facture : il ne peut pas prouver un paiement.',
    supplierSecurity: 'Aucun paiement ni écriture n’est créé. Le rapprochement bancaire reste distinct du lettrage comptable.',
    advancedReport: 'Traçabilité détaillée',
    advancedInvoices: 'Factures et restants dus',
    advancedAllocations: 'Affectations confirmées',
    advancedOpen: 'Transactions ouvertes', allocated: 'affecté',
    advancedPartial: 'Partiellement affectées',
    advancedInvoiceStatus: 'Statut de paiement',
    advancedOutstanding: 'Restant dû',
    advancedEntry: 'Écriture comptable',
    advancedUser: 'Validé par',
    advancedAt: 'Validé le',
    advancedDownload: 'Télécharger le CSV détaillé',
    statusProposed: 'Correspondance proposée',
    statusMatched: 'Rapproché',
    statusReview: 'À examiner',
    statusExcluded: 'Écart / refusé',
    reasons: 'Justification',
    noAccount: 'Aucun compte approprié : choisissez un compte manuellement. Aucun compte n’est inventé.',
    ruleHint: 'Créer une règle depuis ce libellé',
    ruleName: 'Nom de la règle',
    rulePattern: 'Libellé contient',
    ruleAccount: 'Compte cible',
    saveRule: 'Enregistrer la règle',
    rulesTitle: 'Règles de correspondance du dossier',
    noRules: 'Aucune règle enregistrée.',
    version: 'Version',
    disable: 'Désactiver',
    from: 'Du',
    to: 'Au',
    bankBalance: 'Solde bancaire',
    ledgerBalance: 'Solde comptable',
    difference: 'Écart',
    reconciled: 'Rapproché',
    differences: 'Écart à analyser',
    download: 'Télécharger le rapport CSV',
    explanations: 'Explication des écarts',
    validated: 'Dernière validation humaine',
    notValidated: 'Aucune validation de rapprochement enregistrée',
    matched: 'rapprochées',
    unmatched: 'non rapprochées',
    ledgerUnmatched: 'lignes comptables non rapprochées',
    back: 'Retour',
    details: 'Détails techniques',
    confirmHuman: 'Je vérifie la proposition avant de poursuivre',
    exchangeRate: 'Taux de change explicite (devise ≠ MUR)',
    exchangeHint: 'Aucun taux n’est inventé : laissez vide si le compte est en devise fonctionnelle.',
    loadError: 'Impossible de charger le module Banque.',
    unsupported: 'Format non pris en charge. Choisissez un fichier .csv, .tsv, .txt ou .xlsx.',
    androidHint:
      'Sur Android, les types MIME génériques des fichiers téléchargés sont acceptés. Le contenu est vérifié après sélection.',
  },
  en: {
    title: 'Bank & reconciliation',
    intro:
      'Import a bank statement, reconcile it with existing entries and prepare missing postings. No entry is posted automatically.',
    accounts: 'Bank accounts',
    import: 'Import a statement',
    transactions: 'Transactions',
    rules: 'Rules',
    report: 'Report',
    name: 'Account name',
    bank: 'Bank',
    currency: 'Currency',
    chart: 'Linked chart account',
    reference: 'Bank reference (masked)',
    createAccount: 'Add account',
    noAccounts: 'No bank account yet. Add one before importing a statement.',
    masked: 'Masked reference',
    importFor: 'Bank account',
    file: 'Statement file',
    dayFirst: 'Dates as DD/MM/YYYY',
    preview: 'Analyse the file',
    confirmImport: 'Confirm import',
    pdfStatement: 'Import a PDF statement',
    summary: 'Summary',
    importable: 'importable transactions',
    duplicates: 'duplicates skipped',
    errors: 'blocking checks',
    warnings: 'warnings',
    blocked: 'Import blocked: fix the red checks.',
    imported: 'Import complete',
    history: 'Import history',
    noImports: 'No import recorded for this account.',
    fileName: 'File',
    importedAt: 'Imported on',
    rows: 'rows',
    created: 'imported',
    nothingNew: 'No new transaction: identical re-import.',
    samples: 'Downloadable fictional files',
    txnDate: 'Date',
    label: 'Description',
    ref: 'Reference',
    amount: 'Amount',
    debit: 'Debit',
    credit: 'Credit',
    balance: 'Balance',
    currencyCol: 'Currency',
    toImport: 'To import',
    duplicateRow: 'Duplicate',
    status: 'Status',
    open: 'Open',
    noTxns: 'No imported transaction.',
    suggestions: 'Proposed matches',
    noMatch: 'No existing entry matches.',
    confirmMatch: 'Confirm reconciliation',
    exclude: 'Reject / review',
    accountSuggestion: 'Proposed posting',
    acceptProposal: 'Accept and post',
    createProposal: 'Prepare a proposal',
    rejectProposal: 'Reject proposal',
    salary: 'Payroll wording detected: proposal only, no payroll computed.',
    transfer: 'Possible internal transfer: human review required.',
    matchStatus: 'Reconciliation status',
    statusUnmatched: 'Unreconciled',
    statusPartial: 'Partially allocated',
    billingTitle: 'Linked customer payments',
    createPaymentTitle: 'Create a customer payment from this receipt',
    createPaymentHint: 'The payment is recorded and reconciled, but no journal entry is created: posting remains a separate action through the existing engine.',
    selectCustomer: 'Customer',
    selectInvoice: 'Invoice to settle',
    invoiceOutstanding: 'Outstanding',
    createPayment: 'Create payment and reconcile',
    paymentCreated: 'Payment created, invoice updated and transaction reconciled.',
    paymentIdempotent: 'A payment already exists for this transaction: no duplicate was created.',
    noCustomer: 'No active customer.',
    noOpenInvoice: 'No open invoice in this transaction currency.',
    loadInvoices: 'Load invoices',
    accountingSeparate: 'No automatic posting.',
    openingBank: 'Opening bank balance',
    openingLedger: 'Opening ledger balance',
    closingBank: 'Closing bank balance',
    closingLedger: 'Closing ledger balance',
    bankMovement: 'Bank movement in period',
    ledgerMovement: 'Ledger movement in period',
    partialCount: 'partially matched',
    excludedCount: 'excluded',
    totalCount: 'transactions in period',
    priorCount: 'transactions before the period included in opening',
    periodsTitle: 'Statement period validation',
    periodsHint: 'Validation freezes balances and the statement hash. It never posts an entry and never forces a difference to zero.',
    openPeriod: 'Open / refresh period',
    validatePeriod: 'Validate period',
    reopenPeriod: 'Reopen period',
    periodStatus: 'Period status',
    periodNote: 'Validation note (required when a difference exists)',
    periodReason: 'Reopening reason',
    periodHash: 'Statement hash',
    periodDifference: 'Closing difference',
    periodAccepted: 'Accepted difference',
    periodCsv: 'Validated period CSV (frozen amounts)',
    periodOpen: 'Open',
    periodValidated: 'Validated',
    periodReopened: 'Reopened',
    periodHistory: 'Decision history',
    noPeriod: 'No period recorded for these dates.',
    billingEmpty: 'No customer payment recorded in this currency.',
    billingRemaining: 'Remaining to allocate on the transaction',
    billingAmount: 'Amount to allocate',
    billingLink: 'Link this payment',
    billingLinked: 'Linked payment',
    billingInvoices: 'Related invoices',
    billingOutstanding: 'Outstanding',
    billingPosted: 'Posted to accounting',
    billingNotPosted: 'Not posted',
    billingPost: 'Post this payment',
    billingPostHint: 'Separate human action through the existing accounting engine. Bank reconciliation posts nothing.',
    billingUnlink: 'Remove reconciliation',
    billingUnlinkConfirm: 'Confirm removal (history is kept)',
    billingBlocked: 'Not proposed',
    billingPartialWarning: 'Partial allocation: the invoice outstanding balance stays visible.',
    billingNoAllocation: 'This payment is not allocated to any invoice: it cannot prove a settlement.',
    supplierTitle: 'Linked supplier payments',
    supplierEmpty: 'No supplier payment recorded in this currency.',
    supplierRemaining: 'Supplier remaining to allocate on the transaction',
    supplierAmount: 'Amount to allocate',
    supplierLink: 'Link this supplier payment',
    supplierLinked: 'Linked supplier payment',
    supplierInvoices: 'Related supplier invoices',
    supplierOutstanding: 'Outstanding',
    supplierPosted: 'Posted to accounting',
    supplierNotPosted: 'Not posted',
    supplierUnlink: 'Remove supplier reconciliation',
    supplierBlocked: 'Not proposed',
    supplierNoAllocation: 'This supplier payment is not allocated to any invoice: it cannot prove a payment.',
    supplierSecurity: 'No payment or entry is created. Bank reconciliation remains separate from ledger lettering.',
    advancedReport: 'Detailed traceability',
    advancedInvoices: 'Invoices and outstanding balances',
    advancedAllocations: 'Confirmed allocations',
    advancedOpen: 'Open transactions', allocated: 'allocated',
    advancedPartial: 'Partially allocated',
    advancedInvoiceStatus: 'Payment status',
    advancedOutstanding: 'Outstanding',
    advancedEntry: 'Accounting entry',
    advancedUser: 'Confirmed by',
    advancedAt: 'Confirmed at',
    advancedDownload: 'Download detailed CSV',
    statusProposed: 'Match proposed',
    statusMatched: 'Reconciled',
    statusReview: 'To review',
    statusExcluded: 'Difference / rejected',
    reasons: 'Rationale',
    noAccount: 'No suitable account: choose one manually. No account is invented.',
    ruleHint: 'Create a rule from this wording',
    ruleName: 'Rule name',
    rulePattern: 'Description contains',
    ruleAccount: 'Target account',
    saveRule: 'Save rule',
    rulesTitle: 'Dossier matching rules',
    noRules: 'No saved rule.',
    version: 'Version',
    disable: 'Disable',
    from: 'From',
    to: 'To',
    bankBalance: 'Bank balance',
    ledgerBalance: 'Ledger balance',
    difference: 'Difference',
    reconciled: 'Reconciled',
    differences: 'Difference to analyse',
    download: 'Download CSV report',
    explanations: 'Difference explanation',
    validated: 'Last human validation',
    notValidated: 'No reconciliation validation recorded',
    matched: 'matched',
    unmatched: 'unmatched',
    ledgerUnmatched: 'unmatched ledger lines',
    back: 'Back',
    details: 'Technical details',
    confirmHuman: 'I reviewed the proposal before continuing',
    exchangeRate: 'Explicit exchange rate (currency ≠ MUR)',
    exchangeHint: 'No rate is invented: leave empty for the functional currency.',
    loadError: 'Unable to load the Bank module.',
    unsupported: 'Unsupported format. Choose a .csv, .tsv, .txt or .xlsx file.',
    androidHint:
      'On Android, generic MIME types from downloaded files are accepted. Content is checked after selection.',
  },
} as const;

interface BankAccount {
  id: string;
  name: string;
  bank_name: string;
  currency: string;
  account_id: string;
  masked_reference: string | null;
  is_active: boolean;
  account_code?: string;
  account_name?: string;
  transaction_count?: number;
  unmatched_count?: number;
}

interface BankTxn {
  id: string;
  bank_account_id: string;
  txn_date: string;
  value_date: string | null;
  label: string;
  reference: string | null;
  amount: string;
  currency: string;
  balance: string | null;
  external_id: string | null;
  status: string;
  bank_name?: string;
}

interface Catalogue {
  fields: BankFieldDef[];
  sources: Record<string, { fr: string; en: string; status: string }>;
  limits: { maxBytes: number; maxRows: number };
  features: Record<string, unknown>;
  notImplemented: { fr: string; en: string }[];
}

interface PreviewResponse {
  bankAccount: BankAccount;
  sheets: { name: string; headers: string[]; rows: number }[];
  sheetName: string;
  format: string;
  encoding: string;
  delimiter: string | null;
  suggestions: Record<string, BankColumnSuggestion>;
  mapping: Record<string, string>;
  preview: BankPreview;
  idempotencyKey: string;
  limits: { maxBytes: number; maxRows: number };
}

interface BankImportRow {
  id: string;
  file_name: string;
  format: string;
  status: string;
  row_count: number;
  imported_count: number;
  duplicate_count: number;
  created_at: string;
  bank_account_id: string;
}

interface BillingCandidate {
  paymentId: string;
  paymentNumber: string;
  paymentDate: string;
  amount: string;
  currency: string;
  method: string;
  reference: string | null;
  customerName: string;
  accountingEntryId: string | null;
  accountingPosted: boolean;
  matchedAmount: string;
  availableAmount: string;
  suggestedAmount: string;
  confidence: number;
  reasons: { code: string; fr: string; en: string }[];
  issues: { code: string; fr: string; en: string; blocking: boolean }[];
  allocations: {
    invoiceId: string;
    invoiceNumber: string | null;
    amount: string;
    invoiceTotal: string;
    invoicePaid: string;
    invoiceCredited: string;
    invoiceOutstanding: string;
    invoiceStatus: string;
    invoicePaymentStatus: string;
    currency: string;
  }[];
  alreadyLinkedToTransaction: boolean;
}

interface BillingCandidates {
  transactionRemaining: string;
  allocatedAmount: string;
  candidates: BillingCandidate[];
}

interface SupplierCandidate {
  paymentId: string;
  paymentNumber: string | null;
  paymentDate: string;
  amount: string;
  currency: string;
  supplierName: string;
  reference: string | null;
  accountingPosted: boolean;
  matchedAmount: string;
  availableAmount: string;
  suggestedAmount: string;
  confidence: number;
  reasons: { code: string; fr: string; en: string }[];
  issues: { code: string; fr: string; en: string; blocking: boolean }[];
  allocations: { invoiceId: string; invoiceNumber: string | null; amount: string; invoiceOutstanding: string }[];
  alreadyLinkedToTransaction: boolean;
}

interface SupplierCandidates {
  transactionRemaining: string;
  allocatedAmount: string;
  direction: 'in' | 'out';
  candidates: SupplierCandidate[];
}

interface Detail {
  transaction: BankTxn;
  bankAccount: BankAccount;
  match: MatchSuggestion;
  account: AccountSuggestion;
  internalTransfer: { transactionId: string; bankAccountId: string; days: number } | null;
  billing: BillingCandidates;
  supplier?: SupplierCandidates;
  existingMatches: { id: string; status: string; reasons: string[]; billing_payment_id?: string | null }[];
  proposals: {
    id: string;
    status: string;
    account_code: string | null;
    account_name: string | null;
    amount: string;
    confidence: number;
    rationale: Record<string, unknown>;
    journal_code: string | null;
  }[];
}

interface Rule {
  id: string;
  name: string;
  label_pattern: string | null;
  reference_pattern: string | null;
  direction: string;
  priority: number;
  version: number;
  is_active: boolean;
  account_code: string | null;
  account_name: string | null;
}

interface Report {
  bankAccount: { id: string; name: string; bankName: string; currency: string; maskedReference: string | null };
  openingBankBalance: string | null;
  openingLedgerBalance: string;
  bankMovement: string;
  ledgerMovement: string;
  closingBankBalance: string | null;
  closingLedgerBalance: string;
  bankBalance: string | null;
  ledgerBalance: string;
  difference: string;
  matchedCount: number;
  partiallyMatchedCount: number;
  unmatchedCount: number;
  excludedCount: number;
  totalCount: number;
  ledgerUnmatchedCount: number;
  priorTransactionCount: number;
  status: string;
  explanations: { code: string; fr: string; en: string }[];
  validatedAt: string | null;
  validatedBy: string | null;
}

interface ReconciliationPeriod {
  id: string;
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
  validated_at: string | null;
  reopened_at: string | null;
  reopen_reason: string | null;
  events: { id: string; event: string; actor_name: string | null; note: string | null; created_at: string }[];
}

interface AdvancedReport {
  generatedAt: string;
  bankAccount: { id: string; name: string; bankName: string; currency: string };
  summary: {
    transactionCount: number;
    matchedCount: number;
    partiallyMatchedCount: number;
    openCount: number;
    allocatedTotal: string;
    unallocatedTotal: string;
    postedPaymentCount: number;
    unpostedPaymentCount: number;
    invoicesPaid: number;
    invoicesPartial: number;
    invoicesUnpaid: number;
    invoicesOverpaid: number;
    allocationCount: number;
    outstandingByCurrency: { currency: string; amount: string; count: number }[];
  };
  allocations: {
    matchId: string;
    transactionDate: string;
    transactionLabel: string;
    transactionReference: string | null;
    transactionAmount: string;
    allocatedAmount: string;
    transactionRemaining: string;
    paymentNumber: string | null;
    paymentAmount: string | null;
    paymentMatchedAmount: string | null;
    paymentAvailableAmount: string | null;
    accountingEntryNo: string | null;
    accountingPosted: boolean;
    invoices: { invoiceId: string; invoiceNumber: string | null; amount: string; total: string; outstanding: string; paymentStatus: string }[];
    decidedAt: string | null;
    decidedBy: string | null;
    note: string | null;
  }[];
  invoices: {
    invoiceId: string;
    invoiceNumber: string | null;
    customerName: string;
    currency: string;
    total: string;
    paid: string;
    credited: string;
    outstanding: string;
    paymentStatus: string;
    documentStatus: string;
    accountingPosted: boolean;
  }[];
}

const money = (value: string) =>
  new Intl.NumberFormat('fr-MU', { minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(
    Number(value),
  );

async function fileToBase64(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function statusBadge(
  status: string,
  tr: {
    statusMatched: string;
    statusPartial: string;
    statusProposed: string;
    statusReview: string;
    statusExcluded: string;
    statusUnmatched: string;
  },
) {
  const map: Record<string, { kind: 'success' | 'warning' | 'danger' | 'info' | 'neutral'; label: string }> = {
    matched: { kind: 'success', label: tr.statusMatched },
    partially_matched: { kind: 'warning', label: tr.statusPartial },
    proposed: { kind: 'info', label: tr.statusProposed },
    review: { kind: 'warning', label: tr.statusReview },
    excluded: { kind: 'danger', label: tr.statusExcluded },
    unmatched: { kind: 'neutral', label: tr.statusUnmatched },
  };
  const item = map[status] ?? map.unmatched!;
  return <Badge kind={item.kind}>{item.label}</Badge>;
}

type BankTab = 'accounts' | 'import' | 'transactions' | 'rules' | 'report';

const BANK_TABS: readonly BankTab[] = ['accounts', 'import', 'transactions', 'rules', 'report'];

function parseBankTab(value: string | null): BankTab {
  return BANK_TABS.includes(value as BankTab) ? (value as BankTab) : 'accounts';
}

export default function BankPage() {
  const { t, locale } = useI18n();
  const tr = L[locale];
  const { company } = useSession();
  const companyId = company?.id ?? '';
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = parseBankTab(searchParams.get('tab'));
  const setTab = useCallback(
    (next: BankTab) => {
      setSearchParams(
        (previous) => {
          const params = new URLSearchParams(previous);
          if (next === 'accounts') params.delete('tab');
          else params.set('tab', next);
          return params;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );
  const requestedReturn = searchParams.get('returnTo');
  const returnTo =
    requestedReturn && requestedReturn.startsWith('/accounting/journals/')
      ? requestedReturn
      : '/accounting/journals/bank';
  const [accountId, setAccountIdState] = useState(
    () => searchParams.get('bankAccountId') ?? '',
  );
  const setAccountId = useCallback(
    (next: string) => {
      setAccountIdState(next);
      setSearchParams(
        (previous) => {
          const params = new URLSearchParams(previous);
          if (next) params.set('bankAccountId', next);
          else params.delete('bankAccountId');
          return params;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [chartAccounts, setChartAccounts] = useState<{ id: string; code: string; name: string; type: string }[]>([]);
  const [catalogue, setCatalogue] = useState<Catalogue | null>(null);
  const [txns, setTxns] = useState<BankTxn[]>([]);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [rules, setRules] = useState<Rule[]>([]);
  const [imports, setImports] = useState<BankImportRow[]>([]);
  const [report, setReport] = useState<Report | null>(null);
  const [advanced, setAdvanced] = useState<AdvancedReport | null>(null);
  const [selectedPayment, setSelectedPayment] = useState('');
  const [paymentAmount, setPaymentAmount] = useState('');
  const [supplierCandidates, setSupplierCandidates] = useState<SupplierCandidates | null>(null);
  const [selectedSupplierPayment, setSelectedSupplierPayment] = useState('');
  const [supplierAmount, setSupplierAmount] = useState('');
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [exchangeRate, setExchangeRate] = useState('');
  const [periods, setPeriods] = useState<ReconciliationPeriod[]>([]);
  const [periodNote, setPeriodNote] = useState('');
  const [periodReason, setPeriodReason] = useState('');
  const [periodAccepted, setPeriodAccepted] = useState('');
  const [customers, setCustomers] = useState<{ id: string; name: string; isActive: boolean }[]>([]);
  const [createCustomerId, setCreateCustomerId] = useState('');
  const [openInvoices, setOpenInvoices] = useState<
    { id: string; number: string | null; currency: string; outstanding: string; issueDate: string }[]
  >([]);
  const [createInvoiceId, setCreateInvoiceId] = useState('');
  const [createAmount, setCreateAmount] = useState('');
  const [importSummary, setImportSummary] = useState<string | null>(null);
  const [selectedLines, setSelectedLines] = useState<string[]>([]);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [newAccount, setNewAccount] = useState({ name: '', bankName: '', currency: 'MUR', accountId: '', maskedReference: '' });
  const [newRule, setNewRule] = useState({ name: '', labelPattern: '', accountId: '', priority: 100 });
  const fileInput = useRef<HTMLInputElement | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);

  const load = useCallback(async () => {
    if (!companyId) return;
    try {
      const [accountsRes, chartRes, catalogueRes] = await Promise.all([
        api.get<{ accounts: BankAccount[] }>(`/companies/${companyId}/bank/accounts`),
        api.get<{ accounts: { id: string; code: string; name: string; type: string }[] }>(
          `/companies/${companyId}/accounts`,
        ),
        api.get<Catalogue>(`/companies/${companyId}/bank/profiles`),
      ]);
      setAccounts(accountsRes.accounts);
      setChartAccounts(chartRes.accounts.filter((a) => a.type === 'asset'));
      setCatalogue(catalogueRes);
      setAccountIdState((current) => current || accountsRes.accounts[0]?.id || '');
    } catch (err) {
      setError(errorMessage(err, tr.loadError).message);
    } finally {
      setLoading(false);
    }
  }, [companyId, tr.loadError]);

  const loadTxns = useCallback(async () => {
    if (!companyId) return;
    try {
      const suffix = accountId ? `?bankAccountId=${accountId}` : '';
      const res = await api.get<{ transactions: BankTxn[] }>(`/companies/${companyId}/bank/transactions${suffix}`);
      setTxns(res.transactions);
    } catch (err) {
      setError(errorMessage(err, tr.loadError).message);
    }
  }, [accountId, companyId, tr.loadError]);

  const loadRules = useCallback(async () => {
    if (!companyId) return;
    try {
      const res = await api.get<{ rules: Rule[] }>(`/companies/${companyId}/bank/rules`);
      setRules(res.rules);
    } catch (err) {
      setError(errorMessage(err, tr.loadError).message);
    }
  }, [companyId, tr.loadError]);

  const loadReport = useCallback(async () => {
    if (!companyId || !accountId) return;
    try {
      const params = new URLSearchParams({ bankAccountId: accountId });
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      const res = await api.get<{ report: Report | null }>(`/companies/${companyId}/bank/report?${params}`);
      setReport(res.report);
      try {
        const listed = await api.get<{ periods: ReconciliationPeriod[] }>(
          `/companies/${companyId}/bank/periods?${params}`,
        );
        setPeriods(listed.periods);
      } catch {
        setPeriods([]);
      }
      try {
        const detailed = await api.get<{ report: AdvancedReport | null }>(
          `/companies/${companyId}/bank/reconciliation-report?${params}`,
        );
        setAdvanced(detailed.report);
      } catch {
        setAdvanced(null);
      }
    } catch (err) {
      setError(errorMessage(err, tr.loadError).message);
    }
  }, [accountId, companyId, from, to, tr.loadError]);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    const requested = searchParams.get('bankAccountId');
    if (requested && requested !== accountId) setAccountIdState(requested);
  }, [searchParams, accountId]);
  useEffect(() => {
    if (tab === 'transactions') void loadTxns();
  }, [tab, loadTxns]);
  useEffect(() => {
    if (tab === 'rules') void loadRules();
  }, [tab, loadRules]);
  useEffect(() => {
    if (tab === 'report') void loadReport();
  }, [tab, loadReport]);

  const selectedAccount = useMemo(
    () => accounts.find((a) => a.id === accountId) ?? null,
    [accounts, accountId],
  );

  const loadImports = useCallback(async () => {
    if (!companyId) return;
    try {
      const suffix = accountId ? `?bankAccountId=${accountId}` : '';
      const res = await api.get<{ imports: BankImportRow[] }>(
        `/companies/${companyId}/bank/imports${suffix}`,
      );
      setImports(res.imports);
    } catch (err) {
      setError(errorMessage(err, tr.loadError).message);
    }
  }, [accountId, companyId, tr.loadError]);

  useEffect(() => {
    if (tab === 'import') void loadImports();
  }, [tab, loadImports]);

  const chooseFile = async (file: File) => {
    setPendingFile(null);
    setPreview(null);
    setImportSummary(null);
    setError(null);
    const rejection = validateAccountingUpload(
      file,
      catalogue?.limits.maxBytes ?? 8 * 1024 * 1024,
    );
    if (rejection) {
      setBusy(false);
      setError(
        rejection === 'empty'
          ? locale === 'fr'
            ? 'Le fichier est vide.'
            : 'The file is empty.'
          : rejection === 'too-large'
            ? locale === 'fr'
              ? 'Fichier trop volumineux pour cet import.'
              : 'File too large for this import.'
            : tr.unsupported,
      );
      if (fileInput.current) fileInput.current.value = '';
      return;
    }
    setPendingFile(file);
    setBusy(true);
    try {
      const contentBase64 = await fileToBase64(file);
      const res = await api.post<PreviewResponse>(`/companies/${companyId}/bank/preview`, {
        bankAccountId: accountId,
        fileName: file.name,
        contentBase64,
        dayFirst: true,
      });
      setPreview(res);
    } catch (err) {
      setError(errorMessage(err, tr.loadError).message);
    } finally {
      setBusy(false);
      // Allows selecting the same file again after a failed preview.
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const confirmImport = async () => {
    if (!preview || !pendingFile) return;
    setBusy(true);
    setError(null);
    try {
      const contentBase64 = await fileToBase64(pendingFile);
      const res = await api.post<{ imported: number; duplicates: number; reimport: boolean; preview: BankPreview }>(
        `/companies/${companyId}/bank/imports`,
        {
          bankAccountId: accountId,
          fileName: pendingFile.name,
          contentBase64,
          dayFirst: true,
        },
      );
      const s = res.preview.summary;
      setImportSummary(
        `${tr.imported} : ${res.imported} ${tr.created}, ${res.duplicates} ${tr.duplicates.toLowerCase()}. ` +
          (s.errors ? `${s.errors} ${tr.errors}.` : `${s.importable} ${tr.importable}.`),
      );
      setNotice(res.reimport ? tr.nothingNew : null);
      await Promise.all([load(), loadTxns(), loadImports()]);
      setTab('transactions');
    } catch (err) {
      setError(errorMessage(err, tr.loadError).message);
    } finally {
      setBusy(false);
    }
  };

  const openTxn = async (id: string) => {
    setBusy(true);
    setError(null);
    setSelectedLines([]);
    setReviewed(false);
    setExchangeRate('');
    setSelectedPayment('');
    setPaymentAmount('');
    try {
      const [res, suppliers] = await Promise.all([
        api.get<Detail>(`/companies/${companyId}/bank/transactions/${id}`),
        api
          .get<SupplierCandidates>(`/companies/${companyId}/bank/transactions/${id}/supplier-candidates`)
          .catch(() => null),
      ]);
      setDetail(res);
      setSupplierCandidates(suppliers);
      const preferredSupplier = suppliers?.candidates.find(
        (c) => !c.alreadyLinkedToTransaction && !c.issues.some((i) => i.blocking),
      );
      setSelectedSupplierPayment(preferredSupplier?.paymentId ?? '');
      setSupplierAmount(preferredSupplier?.suggestedAmount ?? '');
      const preferred =
        res.billing.candidates.find((c) => !c.alreadyLinkedToTransaction && !c.issues.some((i) => i.blocking)) ??
        res.billing.candidates[0];
      setSelectedPayment(preferred?.paymentId ?? '');
      setPaymentAmount(preferred?.suggestedAmount ?? '');
      if (res.match.split) {
        setSelectedLines(res.match.split.lineIds);
      } else if (res.match.candidates.length === 1) {
        setSelectedLines([res.match.candidates[0]!.lineId]);
      }
      setNewRule((r) => ({ ...r, name: `Règle — ${res.transaction.label.slice(0, 40)}`, labelPattern: res.transaction.label.slice(0, 60), accountId: res.account.accountId ?? '' }));
    } catch (err) {
      setError(errorMessage(err, tr.loadError).message);
    } finally {
      setBusy(false);
    }
  };

  const confirmSupplier = async () => {
    if (!detail || !selectedSupplierPayment || !reviewed) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(
        `/companies/${companyId}/bank/transactions/${detail.transaction.id}/supplier-payments`,
        { paymentId: selectedSupplierPayment, amount: supplierAmount.trim(), confirm: true },
      );
      setNotice(`${tr.supplierLink} ✓`);
      setReviewed(false);
      await Promise.all([openTxn(detail.transaction.id), loadTxns(), load()]);
    } catch (err) {
      setError(errorMessage(err, tr.loadError).message);
    } finally {
      setBusy(false);
    }
  };

  const unlinkSupplier = async (paymentId: string) => {
    if (!detail || !reviewed) return;
    setBusy(true);
    setError(null);
    try {
      await api.del(
        `/companies/${companyId}/bank/transactions/${detail.transaction.id}/supplier-payments/${paymentId}`,
        { confirm: true, reason: 'Retrait humain depuis l’écran Banque' },
      );
      setNotice(`${tr.supplierUnlink} ✓`);
      setReviewed(false);
      await Promise.all([openTxn(detail.transaction.id), loadTxns()]);
    } catch (err) {
      setError(errorMessage(err, tr.loadError).message);
    } finally {
      setBusy(false);
    }
  };

  const confirmMatch = async () => {
    if (!detail || selectedLines.length === 0 || !reviewed) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/companies/${companyId}/bank/transactions/${detail.transaction.id}/matches`, {
        lineIds: selectedLines,
        confirm: true,
      });
      setNotice(`${tr.confirmMatch} ✓`);
      setDetail(null);
      await Promise.all([loadTxns(), load()]);
    } catch (err) {
      setError(errorMessage(err, tr.loadError).message);
    } finally {
      setBusy(false);
    }
  };

  const requestedTransaction = searchParams.get('transactionId');
  useEffect(() => {
    if (tab === 'transactions' && accountId && requestedTransaction) {
      void openTxn(requestedTransaction);
    }
    // `openTxn` is intentionally read from the current render; the query value
    // is the only trigger, otherwise reloading the detail would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, accountId, requestedTransaction]);

  const confirmBilling = async () => {
    if (!detail || !selectedPayment || !reviewed) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(
        `/companies/${companyId}/bank/transactions/${detail.transaction.id}/billing-payments`,
        {
          paymentId: selectedPayment,
          amount: paymentAmount.trim(),
          confirm: true,
        },
      );
      setNotice(`${tr.billingLink} ✓`);
      setReviewed(false);
      await Promise.all([openTxn(detail.transaction.id), loadTxns()]);
    } catch (err) {
      setError(errorMessage(err, tr.loadError).message);
    } finally {
      setBusy(false);
    }
  };

  const postBillingPayment = async (paymentId: string) => {
    if (!detail || !reviewed) return;
    setBusy(true);
    setError(null);
    try {
      const proposal = await api.post<{ proposal?: { id: string }; reused?: boolean }>(
        `/companies/${companyId}/ai/entry-proposals/from-billing`,
        { paymentId },
      );
      const proposalId = proposal.proposal?.id;
      if (!proposalId) throw new Error(tr.billingPost);
      await api.post(`/companies/${companyId}/ai/entry-proposals/${proposalId}/validate`, {});
      await api.post(`/companies/${companyId}/ai/entry-proposals/${proposalId}/post`, {});
      setNotice(`${tr.billingPost} ✓`);
      setReviewed(false);
      await Promise.all([openTxn(detail.transaction.id), loadTxns(), load()]);
    } catch (err) {
      const message = errorMessage(err, tr.loadError).message;
      setError(
        `${message} — ${locale === 'fr' ? 'aucune comptabilisation forcée ; utilisez l’assistant comptable pour traiter les avertissements.' : 'no posting was forced; use the accounting assistant to handle warnings.'}`,
      );
    } finally {
      setBusy(false);
    }
  };

  const unlinkBilling = async (paymentId: string) => {
    if (!detail || !reviewed) return;
    setBusy(true);
    setError(null);
    try {
      await api.del(
        `/companies/${companyId}/bank/transactions/${detail.transaction.id}/billing-payments/${paymentId}`,
        { confirm: true, reason: 'Retrait humain depuis l’écran Banque' },
      );
      setNotice(`${tr.billingUnlink} ✓`);
      setReviewed(false);
      await Promise.all([openTxn(detail.transaction.id), loadTxns()]);
    } catch (err) {
      setError(errorMessage(err, tr.loadError).message);
    } finally {
      setBusy(false);
    }
  };

  const exclude = async () => {
    if (!detail) return;
    setBusy(true);
    try {
      await api.post(`/companies/${companyId}/bank/transactions/${detail.transaction.id}/exclude`, {
        reason: 'Refus humain dans l’écran Banque',
      });
      setDetail(null);
      await loadTxns();
    } catch (err) {
      setError(errorMessage(err, tr.loadError).message);
    } finally {
      setBusy(false);
    }
  };

  const createProposal = async (account?: string | null) => {
    if (!detail) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/companies/${companyId}/bank/transactions/${detail.transaction.id}/proposals`, {
        accountId: account ?? detail.account.accountId,
      });
      await openTxn(detail.transaction.id);
    } catch (err) {
      setError(errorMessage(err, tr.loadError).message);
    } finally {
      setBusy(false);
    }
  };

  const decideProposal = async (id: string, decision: 'accept' | 'reject') => {
    if (!detail) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/companies/${companyId}/bank/proposals/${id}/${decision}`, {
        ...(decision === 'accept'
          ? { confirm: true, ...(exchangeRate.trim() ? { exchangeRate: exchangeRate.trim() } : {}) }
          : {}),
      });
      setNotice(decision === 'accept' ? `${tr.acceptProposal} ✓` : `${tr.rejectProposal} ✓`);
      setDetail(null);
      await Promise.all([loadTxns(), load()]);
    } catch (err) {
      setError(errorMessage(err, tr.loadError).message);
    } finally {
      setBusy(false);
    }
  };

  const createAccount = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/companies/${companyId}/bank/accounts`, newAccount);
      setNewAccount({ name: '', bankName: '', currency: 'MUR', accountId: '', maskedReference: '' });
      await load();
    } catch (err) {
      setError(errorMessage(err, tr.loadError).message);
    } finally {
      setBusy(false);
    }
  };

  const saveRule = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/companies/${companyId}/bank/rules`, {
        ...newRule,
        priority: Number(newRule.priority),
      });
      await loadRules();
      setNotice(`${tr.saveRule} ✓`);
    } catch (err) {
      setError(errorMessage(err, tr.loadError).message);
    } finally {
      setBusy(false);
    }
  };

  const openPeriod = async () => {
    if (!accountId || !from || !to) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/companies/${companyId}/bank/periods`, {
        bankAccountId: accountId,
        from,
        to,
        note: periodNote.trim() || null,
      });
      setNotice(`${tr.openPeriod} ✓`);
      await loadReport();
    } catch (err) {
      setError(errorMessage(err, tr.loadError).message);
    } finally {
      setBusy(false);
    }
  };

  const validatePeriod = async (period: ReconciliationPeriod) => {
    setBusy(true);
    setError(null);
    try {
      const note = periodNote.trim();
      await api.post(`/companies/${companyId}/bank/periods/${period.id}/validate`, {
        confirm: true,
        note: note || null,
        acceptedDifference: period.difference !== '0.0000' ? periodAccepted.trim() || period.difference : null,
      });
      setNotice(`${tr.validatePeriod} ✓`);
      setPeriodNote('');
      setPeriodAccepted('');
      await loadReport();
    } catch (err) {
      setError(errorMessage(err, tr.loadError).message);
    } finally {
      setBusy(false);
    }
  };

  const reopenPeriod = async (period: ReconciliationPeriod) => {
    if (periodReason.trim().length < 3) {
      setError(tr.periodReason);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.post(`/companies/${companyId}/bank/periods/${period.id}/reopen`, {
        confirm: true,
        reason: periodReason.trim(),
      });
      setNotice(`${tr.reopenPeriod} ✓`);
      setPeriodReason('');
      await loadReport();
    } catch (err) {
      setError(errorMessage(err, tr.loadError).message);
    } finally {
      setBusy(false);
    }
  };

  const downloadPeriod = async (period: ReconciliationPeriod) => {
    try {
      const text = await api.get<string>(
        `/companies/${companyId}/bank/periods/${period.id}/report.csv?lang=${locale === 'fr' ? 'fr' : 'en'}`,
      );
      const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `bank-period-${period.period_from}-${period.period_to}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(errorMessage(err, tr.loadError).message);
    }
  };

  const loadCustomers = async () => {
    try {
      const res = await api.get<{ customers: { id: string; name: string; isActive: boolean }[] }>(
        `/companies/${companyId}/billing/customers`,
      );
      setCustomers(res.customers.filter((c) => c.isActive));
    } catch (err) {
      setError(errorMessage(err, tr.loadError).message);
    }
  };

  const loadOpenInvoices = async (customerId: string) => {
    setCreateCustomerId(customerId);
    setCreateInvoiceId('');
    setCreateAmount('');
    if (!customerId) {
      setOpenInvoices([]);
      return;
    }
    try {
      const suffix = `kind=invoice&customerId=${customerId}`;
      const [issued, partial] = await Promise.all([
        api.get<{ documents: any[] }>(`/companies/${companyId}/billing/documents?${suffix}&status=issued`),
        api.get<{ documents: any[] }>(`/companies/${companyId}/billing/documents?${suffix}&status=partially_paid`),
      ]);
      const currency = detail?.transaction.currency;
      setOpenInvoices(
        [...issued.documents, ...partial.documents]
          .filter((d) => d.currency === currency)
          .map((d) => ({
            id: d.id,
            number: d.number,
            currency: d.currency,
            outstanding: d.outstanding,
            issueDate: d.issueDate,
          })),
      );
    } catch (err) {
      setError(errorMessage(err, tr.loadError).message);
    }
  };

  const createPaymentFromReceipt = async () => {
    if (!detail || !createCustomerId || !createInvoiceId || !reviewed) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ idempotent: boolean; payment: { paymentNumber: string } }>(
        `/companies/${companyId}/bank/transactions/${detail.transaction.id}/billing-payment`,
        {
          confirm: true,
          customerId: createCustomerId,
          allocations: [{ invoiceId: createInvoiceId, amount: createAmount.trim() }],
          note: 'Règlement créé depuis un encaissement bancaire, confirmé par un humain',
        },
      );
      setNotice(`${res.idempotent ? tr.paymentIdempotent : tr.paymentCreated} (${res.payment.paymentNumber})`);
      setReviewed(false);
      setCreateInvoiceId('');
      setCreateAmount('');
      await Promise.all([openTxn(detail.transaction.id), loadTxns(), loadReport()]);
    } catch (err) {
      setError(errorMessage(err, tr.loadError).message);
    } finally {
      setBusy(false);
    }
  };

  const downloadReport = async () => {
    if (!report) return;
    try {
      const params = new URLSearchParams({ bankAccountId: accountId, lang: locale });
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      const text = await api.get<string>(
        `/companies/${companyId}/bank/reconciliation-report.csv?${params}`,
      );
      const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'rapprochement-bancaire-detaille.csv';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      return;
    } catch {
      // Fall back to the summary already on screen, never to invented rows.
    }
    const rows = [
      ['Rapport de rapprochement bancaire'],
      ['Banque', report.bankAccount.bankName],
      ['Compte', report.bankAccount.name],
      ['Solde bancaire', report.bankBalance ?? ''],
      ['Solde comptable', report.ledgerBalance],
      ['Écart', report.difference],
      ['Statut', report.status],
      ...report.explanations.map((e) => [locale === 'fr' ? e.fr : e.en]),
    ];
    const escape = (v: string) => (/^[=+\-@\t\r]/.test(v) ? `'${v}` : v.includes(';') ? `"${v}"` : v);
    const blob = new Blob(['\uFEFF' + rows.map((r) => r.map(escape).join(';')).join('\r\n')], {
      type: 'text/csv;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'rapprochement-bancaire.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) return <Spinner label={tr.title} />;
  if (!companyId) return <EmptyState title={tr.title}>{tr.noAccounts}</EmptyState>;

  const findings = preview?.preview.findings ?? [];
  const blocking = findings.filter((f: BankFinding) => f.severity === 'error');
  const warnings = findings.filter((f: BankFinding) => f.severity === 'warning');
  const bankHref = (nextTab: BankTab) => {
    const params = new URLSearchParams({ tab: nextTab });
    if (accountId) params.set('bankAccountId', accountId);
    if (requestedReturn) params.set('returnTo', returnTo);
    return `/accounting/banking?${params.toString()}`;
  };
  const pdfHref = () => {
    const params = new URLSearchParams();
    if (accountId) params.set('bankAccountId', accountId);
    if (requestedReturn) params.set('returnTo', returnTo);
    const suffix = params.toString();
    return `/accounting/banking/pdf${suffix ? `?${suffix}` : ''}`;
  };

  return (
    <div className="bank-page">
      <div className="page-head">
        <div>
          <h1>{tr.title}</h1>
          <p className="muted">{tr.intro}</p>
        </div>
        {demoEnabled && <Badge kind="warning">{locale === 'fr' ? 'Démo locale' : 'Local demo'}</Badge>}
      </div>

      <ErrorBanner message={error} />
      {notice && (
        <div className="alert alert-success" role="status">
          {notice}
        </div>
      )}

      <div className="bank-tabs" role="tablist">
        {(
          [
            ['accounts', tr.accounts],
            ['import', tr.import],
            ['transactions', tr.transactions],
            ['rules', tr.rules],
            ['report', tr.report],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            className={`bank-tab ${tab === key ? 'active' : ''}`}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {importSummary && (
        <Card title={tr.imported}>
          <div className="alert alert-success" role="status">{importSummary}</div>
          <p className="muted small">{t('bankImport.notPosted')}</p>
          <div className="bank-import-actions">
            <Link className="btn" to={bankHref('transactions')}>
              {t('bankImport.viewTransactions')}
            </Link>
            <Link className="btn" to={bankHref('report')}>
              {t('bankImport.prepareReconciliation')}
            </Link>
            <Link className="btn btn-secondary" to={returnTo}>
              {t('bankImport.backToJournal')}
            </Link>
          </div>
        </Card>
      )}

      {tab === 'accounts' && (
        <div className="bank-grid">
          <Card title={tr.accounts}>
            {accounts.length === 0 ? (
              <p className="muted">{tr.noAccounts}</p>
            ) : (
              <ul className="bank-account-list">
                {accounts.map((account) => (
                  <li key={account.id} className={account.id === accountId ? 'selected' : ''}>
                    <button type="button" className="bank-account-button" onClick={() => setAccountId(account.id)}>
                      <strong>{account.name}</strong>
                      <span>{account.bank_name}</span>
                      <span>
                        {account.currency} · {account.account_code} {account.account_name}
                      </span>
                      <span className="muted">
                        {tr.masked} : {account.masked_reference ?? '—'} · {account.transaction_count ?? 0}{' '}
                        {locale === 'fr' ? 'opérations' : 'transactions'} · {account.unmatched_count ?? 0}{' '}
                        {tr.unmatched}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title={tr.createAccount}>
            <div className="bank-form">
              <Field label={tr.name}>
                <input value={newAccount.name} onChange={(e) => setNewAccount({ ...newAccount, name: e.target.value })} />
              </Field>
              <Field label={tr.bank}>
                <input value={newAccount.bankName} onChange={(e) => setNewAccount({ ...newAccount, bankName: e.target.value })} />
              </Field>
              <Field label={tr.currency}>
                <select value={newAccount.currency} onChange={(e) => setNewAccount({ ...newAccount, currency: e.target.value })}>
                  <option>MUR</option>
                  <option>EUR</option>
                  <option>USD</option>
                  <option>GBP</option>
                </select>
              </Field>
              <Field label={tr.chart}>
                <select value={newAccount.accountId} onChange={(e) => setNewAccount({ ...newAccount, accountId: e.target.value })}>
                  <option value="">—</option>
                  {chartAccounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.code} — {a.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={tr.reference}>
                <input
                  value={newAccount.maskedReference}
                  onChange={(e) => setNewAccount({ ...newAccount, maskedReference: e.target.value })}
                  placeholder="MU00…1234"
                />
              </Field>
              <Button variant="primary" onClick={() => void createAccount()} disabled={busy || !newAccount.name || !newAccount.accountId}>
                {tr.createAccount}
              </Button>
            </div>
          </Card>
        </div>
      )}

      {tab === 'import' && (
        <Card title={tr.import}>
          <div className="bank-form">
            <Field label={tr.importFor}>
              <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} ({a.currency})
                  </option>
                ))}
              </select>
            </Field>
            <Field label={tr.file}>
              <input
                ref={fileInput}
                type="file"
                accept={ACCOUNTING_UPLOAD_ACCEPT}
                aria-label={tr.file}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void chooseFile(file);
                }}
              />
            </Field>
          </div>
          <p className="muted small">
            {locale === 'fr' ? 'Formats réels' : 'Supported formats'} : CSV, TSV/TXT, XLSX · PDF{' '}
            {locale === 'fr' ? 'via le lecteur de relevés' : 'via the statement reader'} ·{' '}
            {catalogue?.limits.maxRows ?? 5000} {locale === 'fr' ? 'lignes' : 'rows'}
          </p>
          <p>
            <Link className="btn" to={pdfHref()}>📄 {tr.pdfStatement}</Link>
          </p>
          <p className="muted small">{tr.androidHint}</p>
          <div className="bank-import-history">
            <h3>{tr.history}</h3>
            {imports.length === 0 ? (
              <p className="muted">{tr.noImports}</p>
            ) : (
              <ul className="bank-import-list">
                {imports.map((item) => (
                  <li key={item.id}>
                    <strong>{item.file_name}</strong>{' '}
                    <span className="muted small">
                      {item.format.toUpperCase()} · {item.row_count} {tr.rows} ·{' '}
                      {item.imported_count} {tr.created} · {item.duplicate_count} {tr.duplicates} ·{' '}
                      {new Date(item.created_at).toLocaleString(locale === 'fr' ? 'fr-FR' : 'en-GB')}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="bank-samples">
            <strong>{tr.samples}</strong>
            <ul>
              {[
                'releve-bancaire-fictif.csv',
                'releve-bancaire-fictif.xlsx',
                'releve-bancaire-doublons.csv',
                'releve-bancaire-erreurs.csv',
              ].map((file) => (
                <li key={file}>
                  <a href={`${import.meta.env.BASE_URL}samples/${file}`} download>
                    {file}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          {busy && <Spinner label={tr.preview} />}
          {preview && (
            <div className="bank-preview">
              <h3>{tr.summary}</h3>
              <div className="bank-counts">
                <div className="bank-count ok">
                  <strong>{preview.preview.summary.importable}</strong>
                  <span>{tr.importable}</span>
                </div>
                <div className="bank-count">
                  <strong>{preview.preview.summary.duplicates}</strong>
                  <span>{tr.duplicates}</span>
                </div>
                <div className="bank-count warn">
                  <strong>{preview.preview.summary.warnings}</strong>
                  <span>{tr.warnings}</span>
                </div>
                <div className="bank-count danger">
                  <strong>{preview.preview.summary.errors}</strong>
                  <span>{tr.errors}</span>
                </div>
              </div>
              {preview.preview.blocksImport && (
                <div className="alert alert-danger" role="alert">
                  {tr.blocked}
                </div>
              )}
              <p className="muted small">
                {locale === 'fr' ? 'Solde d’ouverture déduit' : 'Inferred opening balance'} :{' '}
                {preview.preview.balances.opening ?? '—'} · {locale === 'fr' ? 'Solde final' : 'Closing balance'} :{' '}
                {preview.preview.balances.closing ?? '—'}
              </p>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>{tr.txnDate}</th>
                      <th>{tr.label}</th>
                      <th>{tr.ref}</th>
                      <th>{tr.debit}</th>
                      <th>{tr.credit}</th>
                      <th>{tr.balance}</th>
                      <th>{tr.currencyCol}</th>
                      <th>{tr.status}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.preview.transactions.map((txn) => {
                      const negative = txn.amount.trim().startsWith('-');
                      const absolute = negative ? txn.amount.trim().slice(1) : txn.amount;
                      return (
                        <tr key={`${txn.rowNumber}-${txn.fingerprint}`} className={txn.action === 'skip' ? 'muted-row' : ''}>
                          <td>{txn.txnDate ?? '—'}</td>
                          <td>
                            {txn.label}
                            {txn.suggestion && (
                              <div className="page-sub">
                                {locale === 'fr' ? txn.suggestion.messageFr : txn.suggestion.messageEn}
                              </div>
                            )}
                          </td>
                          <td>{txn.reference ?? '—'}</td>
                          <td className="amount-out">{negative ? absolute : '—'}</td>
                          <td className="amount-in">{negative ? '—' : absolute}</td>
                          <td className="mono">{txn.balance ?? '—'}</td>
                          <td>{txn.currency}</td>
                          <td>
                            <Badge kind={txn.action === 'skip' ? 'warning' : 'info'}>
                              {txn.action === 'skip' ? tr.duplicateRow : tr.toImport}
                            </Badge>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {(blocking.length > 0 || warnings.length > 0) && (
                <details className="bank-details" open>
                  <summary>{tr.details}</summary>
                  <ul>
                    {[...blocking, ...warnings].slice(0, 100).map((f, index) => (
                      <li key={`${f.code}-${f.rowNumber}-${index}`} className={`finding-${f.severity}`}>
                        <code>{f.code}</code> {f.rowNumber ? `#${f.rowNumber}` : ''}{' '}
                        {locale === 'fr' ? f.messageFr : f.messageEn}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              <div className="bank-actions">
                <label className="bank-review">
                  <input type="checkbox" checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} />
                  {tr.confirmHuman}
                </label>
                <Button
                  variant="primary"
                  onClick={() => void confirmImport()}
                  disabled={busy || preview.preview.blocksImport || !reviewed}
                >
                  {tr.confirmImport}
                </Button>
              </div>
            </div>
          )}
        </Card>
      )}

      {tab === 'transactions' && (
        <Card
          title={tr.transactions}
          actions={
            <Link className="btn btn-sm" to={`/accounting/banking/bulk-reconciliation?bankAccountId=${encodeURIComponent(accountId)}`}>
              <AppIcon name="reconciliation" size={15} />{' '}
              {locale === 'fr' ? 'Rapprochement groupé' : 'Bulk reconciliation'}
            </Link>
          }
        >
          <div className="bank-form">
            <Field label={tr.importFor}>
              <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} ({a.currency})
                  </option>
                ))}
              </select>
            </Field>
          </div>
          {txns.length === 0 ? (
            <p className="muted">{tr.noTxns}</p>
          ) : (
            <>
              <div className="table-wrap bank-txn-table">
                <table className="table bank-table">
                  <thead>
                    <tr>
                      <th>{tr.txnDate}</th>
                      <th>{tr.label}</th>
                      <th>{tr.ref}</th>
                      <th>{tr.amount}</th>
                      <th>{tr.status}</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {txns.map((txn) => (
                      <tr key={txn.id}>
                        <td>{txn.txn_date}</td>
                        <td>{txn.label}</td>
                        <td>{txn.reference ?? '—'}</td>
                        <td className={txn.amount.startsWith('-') ? 'amount-out' : 'amount-in'}>
                          {money(txn.amount)} {txn.currency}
                        </td>
                        <td>{statusBadge(txn.status, tr)}</td>
                        <td>
                          <Button variant="ghost" onClick={() => void openTxn(txn.id)}>
                            {tr.open}
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <ul className="bank-txn-cards">
                {txns.map((txn) => (
                  <li key={txn.id} className="bank-txn-card">
                    <div className="bank-txn-card-head">
                      <span className="bank-txn-date">{txn.txn_date}</span>
                      {statusBadge(txn.status, tr)}
                    </div>
                    <p className="bank-txn-label">{txn.label}</p>
                    <p className={txn.amount.startsWith('-') ? 'amount-out' : 'amount-in'}>
                      {money(txn.amount)} {txn.currency}
                    </p>
                    <p className="bank-txn-ref">
                      {tr.ref} : {txn.reference ?? '—'}
                    </p>
                    <Button variant="ghost" onClick={() => void openTxn(txn.id)}>
                      {tr.open}
                    </Button>
                  </li>
                ))}
              </ul>
            </>
          )}

          {detail && (
            <div className="bank-detail">
              <h3>
                {detail.transaction.label} — {money(detail.transaction.amount)} {detail.transaction.currency}
              </h3>
              <p className="muted">
                {detail.bankAccount.name} · {detail.transaction.txn_date} · {tr.matchStatus} :{' '}
                {statusBadge(detail.transaction.status, tr)}
              </p>

              {detail.internalTransfer && (
                <div className="alert alert-warning">{tr.transfer}</div>
              )}

              {Number(detail.transaction.amount) > 0 && (
                <div className="bank-create-payment">
                  <h4>{tr.createPaymentTitle}</h4>
                  <p className="muted small">{tr.createPaymentHint}</p>
                  <div className="bank-form">
                    <Field label={tr.selectCustomer}>
                      <select
                        value={createCustomerId}
                        onChange={(e) => void loadOpenInvoices(e.target.value)}
                        onFocus={() => {
                          if (customers.length === 0) void loadCustomers();
                        }}
                      >
                        <option value="">—</option>
                        {customers.map((c) => (
                          <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                      </select>
                    </Field>
                    {createCustomerId && (
                      <Field label={tr.selectInvoice}>
                        <select
                          value={createInvoiceId}
                          onChange={(e) => {
                            setCreateInvoiceId(e.target.value);
                            const invoice = openInvoices.find((i) => i.id === e.target.value);
                            setCreateAmount(invoice?.outstanding ?? '');
                          }}
                        >
                          <option value="">—</option>
                          {openInvoices.map((i) => (
                            <option key={i.id} value={i.id}>
                              {i.number ?? i.id} · {tr.invoiceOutstanding} {money(i.outstanding)} {i.currency}
                            </option>
                          ))}
                        </select>
                      </Field>
                    )}
                    {createCustomerId && openInvoices.length === 0 && (
                      <p className="muted small">{tr.noOpenInvoice}</p>
                    )}
                    {createInvoiceId && (
                      <Field label={tr.billingAmount}>
                        <input
                          inputMode="decimal"
                          value={createAmount}
                          onChange={(e) => setCreateAmount(e.target.value)}
                          placeholder="0.0000"
                        />
                      </Field>
                    )}
                  </div>
                  <Button
                    variant="primary"
                    onClick={() => void createPaymentFromReceipt()}
                    disabled={busy || !reviewed || !createCustomerId || !createInvoiceId || !createAmount.trim()}
                  >
                    {tr.createPayment}
                  </Button>
                  <p className="muted small">{tr.accountingSeparate}</p>
                </div>
              )}

              <h4>{tr.billingTitle}</h4>
              <p className="muted small">
                {tr.billingRemaining} : {money(detail.billing.transactionRemaining)}{' '}
                {detail.transaction.currency}
              </p>

              {detail.billing.candidates.filter((c) => c.alreadyLinkedToTransaction).map((candidate) => (
                <div key={candidate.paymentId} className="bank-billing-card is-linked">
                  <div className="bank-txn-card-head">
                    <strong>
                      {candidate.paymentNumber} · {money(candidate.amount)} {candidate.currency}
                    </strong>
                    <Badge kind={candidate.accountingPosted ? 'success' : 'warning'}>
                      {candidate.accountingPosted ? tr.billingPosted : tr.billingNotPosted}
                    </Badge>
                  </div>
                  <p>
                    {candidate.customerName} · {tr.billingLinked} : {money(candidate.matchedAmount)} /{' '}
                    {money(candidate.amount)}
                  </p>
                  <p className="muted small">
                    {tr.billingInvoices} :{' '}
                    {candidate.allocations
                      .map(
                        (a) =>
                          `${a.invoiceNumber ?? a.invoiceId} — ${money(a.amount)} (${tr.billingOutstanding} ${money(a.invoiceOutstanding)})`,
                      )
                      .join(' · ')}
                  </p>
                  <div className="bank-actions">
                    {!candidate.accountingPosted && (
                      <Button
                        variant="primary"
                        onClick={() => void postBillingPayment(candidate.paymentId)}
                        disabled={busy || !reviewed}
                      >
                        {tr.billingPost}
                      </Button>
                    )}
                    <Button
                      variant="danger"
                      onClick={() => void unlinkBilling(candidate.paymentId)}
                      disabled={busy || !reviewed}
                    >
                      {tr.billingUnlink}
                    </Button>
                  </div>
                </div>
              ))}

              {detail.billing.candidates.filter((c) => !c.alreadyLinkedToTransaction).length === 0 ? (
                <p className="muted">{tr.billingEmpty}</p>
              ) : (
                <div className="bank-matches">
                  {detail.billing.candidates
                    .filter((c) => !c.alreadyLinkedToTransaction)
                    .map((candidate) => {
                      const blocked = candidate.issues.some((i) => i.blocking);
                      return (
                        <label
                          key={candidate.paymentId}
                          className={`bank-candidate bank-billing-card${blocked ? ' is-blocked' : ''}`}
                        >
                          <input
                            type="radio"
                            name="billing-payment"
                            checked={selectedPayment === candidate.paymentId}
                            disabled={blocked || busy}
                            onChange={() => {
                              setSelectedPayment(candidate.paymentId);
                              setPaymentAmount(candidate.suggestedAmount);
                            }}
                          />
                          <span className="bank-billing-main">
                            <strong>
                              {candidate.paymentNumber} · {money(candidate.amount)} {candidate.currency}
                            </strong>{' '}
                            <span className="muted">
                              {candidate.customerName} · {candidate.paymentDate}
                            </span>
                            <span className="muted small">
                              {tr.billingInvoices} :{' '}
                              {candidate.allocations
                                .map(
                                  (a) =>
                                    `${a.invoiceNumber ?? a.invoiceId} (${tr.billingOutstanding} ${money(a.invoiceOutstanding)})`,
                                )
                                .join(' · ')}
                            </span>
                            <span className="muted small">
                              {candidate.accountingPosted ? tr.billingPosted : tr.billingNotPosted} ·{' '}
                              {locale === 'fr' ? 'Confiance' : 'Confidence'}{' '}
                              {Math.round(candidate.confidence * 100)} %
                            </span>
                            {candidate.issues.map((issue) => (
                              <span
                                key={issue.code}
                                className={`small ${issue.blocking ? 'finding-error' : 'finding-warning'}`}
                              >
                                {issue.blocking ? `${tr.billingBlocked} — ` : ''}
                                {locale === 'fr' ? issue.fr : issue.en}
                              </span>
                            ))}
                          </span>
                        </label>
                      );
                    })}
                </div>
              )}

              {supplierCandidates && (
                <div className="bank-supplier-section">
                  <h4>{tr.supplierTitle}</h4>
                  <p className="muted small">
                    {tr.supplierRemaining} : {money(supplierCandidates.transactionRemaining)}{' '}
                    {detail.transaction.currency} · {tr.supplierSecurity}
                  </p>
                  {supplierCandidates.candidates.filter((c) => c.alreadyLinkedToTransaction).map((candidate) => (
                    <div key={candidate.paymentId} className="bank-billing-card is-linked">
                      <div className="bank-txn-card-head">
                        <strong>
                          {candidate.paymentNumber} · {money(candidate.amount)} {candidate.currency}
                        </strong>
                        <Badge kind={candidate.accountingPosted ? 'success' : 'warning'}>
                          {candidate.accountingPosted ? tr.supplierPosted : tr.supplierNotPosted}
                        </Badge>
                      </div>
                      <p>
                        {candidate.supplierName} · {tr.supplierLinked} : {money(candidate.matchedAmount)} /{' '}
                        {money(candidate.amount)}
                      </p>
                      <p className="muted small">
                        {tr.supplierInvoices} :{' '}
                        {candidate.allocations
                          .map(
                            (a) =>
                              `${a.invoiceNumber ?? a.invoiceId} — ${money(a.amount)} (${tr.supplierOutstanding} ${money(a.invoiceOutstanding)})`,
                          )
                          .join(' · ') || tr.supplierNoAllocation}
                      </p>
                      <div className="bank-actions">
                        <Button
                          variant="danger"
                          onClick={() => void unlinkSupplier(candidate.paymentId)}
                          disabled={busy || !reviewed}
                        >
                          {tr.supplierUnlink}
                        </Button>
                      </div>
                    </div>
                  ))}
                  {supplierCandidates.candidates.filter((c) => !c.alreadyLinkedToTransaction).length === 0 ? (
                    <p className="muted">{tr.supplierEmpty}</p>
                  ) : (
                    <div className="bank-matches">
                      {supplierCandidates.candidates
                        .filter((c) => !c.alreadyLinkedToTransaction)
                        .map((candidate) => {
                          const blocked = candidate.issues.some((i) => i.blocking);
                          return (
                            <label
                              key={candidate.paymentId}
                              className={`bank-candidate bank-billing-card${blocked ? ' is-blocked' : ''}`}
                            >
                              <input
                                type="radio"
                                name="supplier-payment"
                                checked={selectedSupplierPayment === candidate.paymentId}
                                disabled={blocked || busy}
                                onChange={() => {
                                  setSelectedSupplierPayment(candidate.paymentId);
                                  setSupplierAmount(candidate.suggestedAmount);
                                }}
                              />
                              <span className="bank-billing-main">
                                <strong>
                                  {candidate.paymentNumber} · {money(candidate.amount)} {candidate.currency}
                                </strong>{' '}
                                <span className="muted">
                                  {candidate.supplierName} · {candidate.paymentDate}
                                </span>
                                <span className="muted small">
                                  {tr.supplierInvoices} :{' '}
                                  {candidate.allocations
                                    .map(
                                      (a) =>
                                        `${a.invoiceNumber ?? a.invoiceId} (${tr.supplierOutstanding} ${money(a.invoiceOutstanding)})`,
                                    )
                                    .join(' · ') || tr.supplierNoAllocation}
                                </span>
                                <span className="muted small">
                                  {candidate.accountingPosted ? tr.supplierPosted : tr.supplierNotPosted} ·{' '}
                                  {locale === 'fr' ? 'Confiance' : 'Confidence'}{' '}
                                  {Math.round(candidate.confidence * 100)} %
                                </span>
                                {candidate.issues.map((issue) => (
                                  <span
                                    key={issue.code}
                                    className={`small ${issue.blocking ? 'finding-error' : 'finding-warning'}`}
                                  >
                                    {issue.blocking ? `${tr.supplierBlocked} — ` : ''}
                                    {locale === 'fr' ? issue.fr : issue.en}
                                  </span>
                                ))}
                              </span>
                            </label>
                          );
                        })}
                    </div>
                  )}
                  <div className="bank-form">
                    <Field label={tr.supplierAmount}>
                      <input
                        inputMode="decimal"
                        value={supplierAmount}
                        onChange={(e) => setSupplierAmount(e.target.value)}
                        placeholder="0.0000"
                      />
                    </Field>
                    <Button
                      variant="primary"
                      onClick={() => void confirmSupplier()}
                      disabled={busy || !reviewed || !selectedSupplierPayment}
                    >
                      {tr.supplierLink}
                    </Button>
                  </div>
                </div>
              )}

              <div className="bank-form">
                <Field label={tr.billingAmount}>
                  <input
                    inputMode="decimal"
                    value={paymentAmount}
                    onChange={(e) => setPaymentAmount(e.target.value)}
                    placeholder="0.0000"
                  />
                </Field>
                <Button
                  variant="primary"
                  onClick={() => void confirmBilling()}
                  disabled={busy || !reviewed || !selectedPayment || !paymentAmount.trim()}
                >
                  {tr.billingLink}
                </Button>
              </div>
              <p className="muted small">{tr.billingPostHint}</p>
              <label className="bank-review">
                <input type="checkbox" checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} />
                {tr.confirmHuman}
              </label>

              <h4>{tr.suggestions}</h4>
              {detail.match.status === 'none' ? (
                <p className="muted">{tr.noMatch}</p>
              ) : (
                <div className="bank-matches">
                  {detail.match.reasonFr && (
                    <p className="muted">
                      {locale === 'fr' ? detail.match.reasonFr : detail.match.reasonEn}
                    </p>
                  )}
                  {detail.match.split && (
                    <div className="bank-candidate">
                      <strong>
                        {detail.match.split.entryNo} — {detail.match.split.total}
                      </strong>
                      <span>{detail.match.split.reasons.join(' · ')}</span>
                    </div>
                  )}
                  {detail.match.candidates.map((candidate) => (
                    <label key={candidate.lineId} className="bank-candidate">
                      <input
                        type="radio"
                        name="bank-match"
                        checked={selectedLines.includes(candidate.lineId)}
                        onChange={() => setSelectedLines([candidate.lineId])}
                      />
                      <span>
                        <strong>
                          {candidate.entryNo} — {candidate.entryDate}
                        </strong>{' '}
                        {candidate.reference ?? candidate.description ?? ''}
                      </span>
                      <span className="muted small">{candidate.reasons.join(' · ')}</span>
                    </label>
                  ))}
                </div>
              )}
              {(detail.match.candidates.length > 0 || detail.match.split) && (
                <div className="bank-actions">
                  <label className="bank-review">
                    <input type="checkbox" checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} />
                    {tr.confirmHuman}
                  </label>
                  <Button
                    variant="primary"
                    onClick={() => void confirmMatch()}
                    disabled={busy || !reviewed || selectedLines.length === 0}
                  >
                    {tr.confirmMatch}
                  </Button>
                </div>
              )}

              <div className="bank-actions">
                <Button variant="danger" onClick={() => void exclude()} disabled={busy}>
                  {tr.exclude}
                </Button>
              </div>

              <h4>{tr.accountSuggestion}</h4>
              {detail.account.kind === 'salary' && <div className="alert alert-warning">{tr.salary}</div>}
              {detail.account.accountId ? (
                <div className="bank-suggestion">
                  <p>{locale === 'fr' ? detail.account.rationaleFr : detail.account.rationaleEn}</p>
                  <p className="muted small">
                    {detail.account.choices.length > 0
                      ? `${detail.account.choices.length} ${locale === 'fr' ? 'choix possibles' : 'possible choices'}`
                      : `${locale === 'fr' ? 'Confiance' : 'Confidence'} ${Math.round(detail.account.confidence * 100)} %`}
                  </p>
                  {detail.account.choices.map((choice) => (
                    <Button key={choice.accountId} variant="ghost" onClick={() => void createProposal(choice.accountId)}>
                      {choice.code} — {choice.name}
                    </Button>
                  ))}
                  <Button variant="primary" onClick={() => void createProposal()} disabled={busy}>
                    {tr.createProposal}
                  </Button>
                </div>
              ) : (
                <p className="muted">{tr.noAccount}</p>
              )}

              {detail.proposals.some((p) => p.status === 'proposed') && (
                <div className="bank-form">
                  <Field label={tr.exchangeRate}>
                    <input
                      inputMode="decimal"
                      value={exchangeRate}
                      onChange={(e) => setExchangeRate(e.target.value)}
                      placeholder="—"
                    />
                  </Field>
                  <p className="muted small">{tr.exchangeHint}</p>
                </div>
              )}
              {detail.proposals.length > 0 && (
                <div className="bank-proposals">
                  {detail.proposals.map((proposal) => (
                    <div key={proposal.id} className="bank-proposal">
                      <div>
                        <strong>
                          {proposal.account_code ?? '—'} {proposal.account_name ?? ''}
                        </strong>{' '}
                        · {proposal.amount} · {proposal.journal_code ?? '—'} · {proposal.status}
                      </div>
                      {proposal.status === 'proposed' && (
                        <div className="bank-actions">
                          <Button
                            variant="primary"
                            onClick={() => void decideProposal(proposal.id, 'accept')}
                            disabled={busy}
                          >
                            {tr.acceptProposal}
                          </Button>
                          <Button variant="danger" onClick={() => void decideProposal(proposal.id, 'reject')} disabled={busy}>
                            {tr.rejectProposal}
                          </Button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              <details className="bank-details">
                <summary>{tr.ruleHint}</summary>
                <div className="bank-form">
                  <Field label={tr.ruleName}>
                    <input value={newRule.name} onChange={(e) => setNewRule({ ...newRule, name: e.target.value })} />
                  </Field>
                  <Field label={tr.rulePattern}>
                    <input value={newRule.labelPattern} onChange={(e) => setNewRule({ ...newRule, labelPattern: e.target.value })} />
                  </Field>
                  <Field label={tr.ruleAccount}>
                    <select value={newRule.accountId} onChange={(e) => setNewRule({ ...newRule, accountId: e.target.value })}>
                      <option value="">—</option>
                      {chartAccounts.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.code} — {a.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Button onClick={() => void saveRule()} disabled={busy || !newRule.name || !newRule.accountId || !newRule.labelPattern}>
                    {tr.saveRule}
                  </Button>
                </div>
              </details>

              <div className="bank-actions">
                <Button variant="ghost" onClick={() => setDetail(null)}>
                  {tr.back}
                </Button>
              </div>
            </div>
          )}
        </Card>
      )}

      {tab === 'rules' && (
        <Card title={tr.rulesTitle}>
          {rules.length === 0 ? (
            <p className="muted">{tr.noRules}</p>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>{tr.ruleName}</th>
                    <th>{tr.rulePattern}</th>
                    <th>{tr.ruleAccount}</th>
                    <th>{tr.version}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rules.map((rule) => (
                    <tr key={rule.id} className={rule.is_active ? '' : 'muted-row'}>
                      <td>{rule.name}</td>
                      <td>{rule.label_pattern ?? rule.reference_pattern ?? '—'}</td>
                      <td>
                        {rule.account_code} — {rule.account_name}
                      </td>
                      <td>
                        {rule.version} {rule.is_active ? '' : `(${locale === 'fr' ? 'inactive' : 'inactive'})`}
                      </td>
                      <td>
                        {rule.is_active && (
                          <Button
                            variant="ghost"
                            onClick={async () => {
                              await api.del(`/companies/${companyId}/bank/rules/${rule.id}`);
                              await loadRules();
                            }}
                          >
                            {tr.disable}
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {tab === 'report' && (
        <Card title={tr.report}>
          <div className="bank-form">
            <Field label={tr.importFor}>
              <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} ({a.currency})
                  </option>
                ))}
              </select>
            </Field>
            <Field label={tr.from}>
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </Field>
            <Field label={tr.to}>
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </Field>
            <Button onClick={() => void loadReport()}>{tr.report}</Button>
          </div>
          {report && (
            <div className="bank-report">
              <h3>
                {report.bankAccount.name} · {report.bankAccount.bankName} ·{' '}
                {statusBadge(report.status === 'reconciled' ? 'matched' : 'review', tr)}
              </h3>
              <div className="bank-counts">
                <div className="bank-count">
                  <strong>{report.openingBankBalance ?? '—'}</strong>
                  <span>{tr.openingBank}</span>
                </div>
                <div className="bank-count">
                  <strong>{report.bankMovement}</strong>
                  <span>{tr.bankMovement}</span>
                </div>
                <div className="bank-count">
                  <strong>{report.closingBankBalance ?? '—'}</strong>
                  <span>{tr.closingBank}</span>
                </div>
              </div>
              <div className="bank-counts">
                <div className="bank-count">
                  <strong>{report.openingLedgerBalance}</strong>
                  <span>{tr.openingLedger}</span>
                </div>
                <div className="bank-count">
                  <strong>{report.ledgerMovement}</strong>
                  <span>{tr.ledgerMovement}</span>
                </div>
                <div className="bank-count">
                  <strong>{report.closingLedgerBalance}</strong>
                  <span>{tr.closingLedger}</span>
                </div>
                <div className={`bank-count ${report.difference === '0.0000' ? 'ok' : 'danger'}`}>
                  <strong>{report.difference}</strong>
                  <span>{tr.difference}</span>
                </div>
              </div>
              <p className="muted">
                {report.matchedCount} {tr.matched} · {report.partiallyMatchedCount} {tr.partialCount} ·{' '}
                {report.unmatchedCount} {tr.unmatched} · {report.excludedCount} {tr.excludedCount} ·{' '}
                {report.totalCount} {tr.totalCount} · {report.ledgerUnmatchedCount} {tr.ledgerUnmatched}
              </p>
              {report.priorTransactionCount > 0 && (
                <p className="muted small">{report.priorTransactionCount} {tr.priorCount}</p>
              )}
              <p className="muted small">
                {tr.validated} :{' '}
                {report.validatedAt
                  ? `${new Date(report.validatedAt).toLocaleString(locale === 'fr' ? 'fr-FR' : 'en-GB')} — ${report.validatedBy ?? '—'}`
                  : tr.notValidated}
              </p>
              <h4>{tr.explanations}</h4>
              <ul>
                {report.explanations.map((e) => (
                  <li key={e.code}>{locale === 'fr' ? e.fr : e.en}</li>
                ))}
              </ul>
              <div className="bank-periods">
                <h4>{tr.periodsTitle}</h4>
                <p className="muted small">{tr.periodsHint}</p>
                <div className="bank-form">
                  <Button onClick={() => void openPeriod()} disabled={busy || !from || !to}>{tr.openPeriod}</Button>
                </div>
                <Field label={tr.periodNote}>
                  <input value={periodNote} onChange={(e) => setPeriodNote(e.target.value)} maxLength={2000} />
                </Field>
                {periods.length === 0 && <p className="muted">{tr.noPeriod}</p>}
                {periods.map((period) => (
                  <div key={period.id} className="bank-billing-card">
                    <div className="bank-txn-card-head">
                      <strong>{period.period_from} → {period.period_to}</strong>
                      <Badge
                        kind={
                          period.status === 'validated'
                            ? 'success'
                            : period.status === 'reopened'
                              ? 'warning'
                              : 'info'
                        }
                      >
                        {period.status === 'validated'
                          ? tr.periodValidated
                          : period.status === 'reopened'
                            ? tr.periodReopened
                            : tr.periodOpen}
                      </Badge>
                    </div>
                    <p className="muted small">
                      {tr.openingBank} {period.opening_bank ?? '—'} · {tr.closingBank} {period.closing_bank ?? '—'} ·{' '}
                      {tr.openingLedger} {period.opening_ledger} · {tr.closingLedger} {period.closing_ledger}
                    </p>
                    <p className={period.difference === '0.0000' ? 'muted small' : 'small finding-warning'}>
                      {tr.periodDifference} : {period.difference} · {tr.periodAccepted} : {period.accepted_difference}
                      {period.difference !== '0.0000' ? ` · ${tr.periodNote}` : ''}
                    </p>
                    <p className="muted small">
                      {tr.periodHash} : {period.statement_hash}
                    </p>
                    {period.status === 'validated' && (
                      <>
                        <p className="muted small">
                          {tr.validated} : {period.validated_at ?? '—'}
                        </p>
                        <Field label={tr.periodReason}>
                          <input value={periodReason} onChange={(e) => setPeriodReason(e.target.value)} maxLength={2000} />
                        </Field>
                      </>
                    )}
                    {period.difference !== '0.0000' && period.status !== 'validated' && (
                      <Field label={tr.periodAccepted}>
                        <input
                          inputMode="decimal"
                          value={periodAccepted}
                          onChange={(e) => setPeriodAccepted(e.target.value)}
                          placeholder={period.difference}
                        />
                      </Field>
                    )}
                    <div className="bank-actions">
                      {(period.status === 'open' || period.status === 'reopened') && (
                        <Button variant="primary" onClick={() => void validatePeriod(period)} disabled={busy}>
                          {tr.validatePeriod}
                        </Button>
                      )}
                      {period.status === 'validated' && (
                        <Button variant="danger" onClick={() => void reopenPeriod(period)} disabled={busy}>
                          {tr.reopenPeriod}
                        </Button>
                      )}
                      <Button onClick={() => void downloadPeriod(period)}>{tr.periodCsv}</Button>
                    </div>
                    <p className="muted small">{tr.periodHistory} : {period.events.map((e) => `${e.event} (${e.created_at.slice(0, 10)})`).join(' · ')}</p>
                  </div>
                ))}
              </div>
              {advanced && (
                <div className="bank-advanced-report">
                  <h4>{tr.advancedReport}</h4>
                  <div className="bank-counts">
                    <div className="bank-count">
                      <strong>{advanced.summary.matchedCount}</strong>
                      <span>{tr.statusMatched}</span>
                    </div>
                    <div className="bank-count warn">
                      <strong>{advanced.summary.partiallyMatchedCount}</strong>
                      <span>{tr.advancedPartial}</span>
                    </div>
                    <div className="bank-count">
                      <strong>{advanced.summary.openCount}</strong>
                      <span>{tr.advancedOpen}</span>
                    </div>
                    <div className="bank-count">
                      <strong>{advanced.summary.allocatedTotal}</strong>
                      <span>{tr.amount} {tr.allocated}</span>
                    </div>
                    <div className="bank-count">
                      <strong>{advanced.summary.postedPaymentCount}</strong>
                      <span>{tr.billingPosted}</span>
                    </div>
                    <div className="bank-count">
                      <strong>{advanced.summary.unpostedPaymentCount}</strong>
                      <span>{tr.billingNotPosted}</span>
                    </div>
                  </div>
                  {advanced.summary.outstandingByCurrency.map((row) => (
                    <p key={row.currency} className="muted small">
                      {tr.advancedOutstanding} {row.currency} : {money(row.amount)} ({row.count}{' '}
                      {locale === 'fr' ? 'facture(s)' : 'invoice(s)'})
                    </p>
                  ))}

                  <h5>{tr.advancedAllocations}</h5>
                  {advanced.allocations.length === 0 ? (
                    <p className="muted">{tr.noMatch}</p>
                  ) : (
                    <div className="table-wrap">
                      <table className="table">
                        <thead>
                          <tr>
                            <th>{tr.txnDate}</th>
                            <th>{tr.label}</th>
                            <th>{tr.amount}</th>
                            <th>{tr.billingAmount}</th>
                            <th>{tr.billingInvoices}</th>
                            <th>{tr.advancedEntry}</th>
                            <th>{tr.advancedUser}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {advanced.allocations.map((a) => (
                            <tr key={a.matchId}>
                              <td>{a.transactionDate}</td>
                              <td>
                                {a.transactionLabel}
                                <br />
                                <span className="muted small">{a.paymentNumber ?? '—'}</span>
                              </td>
                              <td className="num">{money(a.transactionAmount)}</td>
                              <td className="num">
                                {money(a.allocatedAmount)}
                                <br />
                                <span className="muted small">
                                  {tr.billingRemaining} {money(a.transactionRemaining)}
                                </span>
                              </td>
                              <td>
                                {a.invoices.map((i) => (
                                  <div key={i.invoiceId}>
                                    {i.invoiceNumber ?? i.invoiceId} — {tr.advancedOutstanding}{' '}
                                    {money(i.outstanding)}
                                  </div>
                                ))}
                              </td>
                              <td>
                                {a.accountingEntryNo ?? '—'}
                                <br />
                                <span className={a.accountingPosted ? 'finding-info' : 'finding-warning'}>
                                  {a.accountingPosted ? tr.billingPosted : tr.billingNotPosted}
                                </span>
                              </td>
                              <td>
                                {a.decidedBy ?? '—'}
                                <br />
                                <span className="muted small">
                                  {a.decidedAt
                                    ? new Date(a.decidedAt).toLocaleString(
                                        locale === 'fr' ? 'fr-FR' : 'en-GB',
                                      )
                                    : '—'}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  <h5>{tr.advancedInvoices}</h5>
                  <div className="table-wrap">
                    <table className="table">
                      <thead>
                        <tr>
                          <th>{locale === 'fr' ? 'Numéro' : 'Number'}</th>
                          <th>{locale === 'fr' ? 'Client' : 'Customer'}</th>
                          <th>{tr.amount}</th>
                          <th>{tr.advancedInvoiceStatus}</th>
                          <th>{tr.advancedOutstanding}</th>
                          <th>{tr.advancedEntry}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {advanced.invoices.map((invoice) => (
                          <tr key={invoice.invoiceId}>
                            <td>{invoice.invoiceNumber ?? invoice.invoiceId}</td>
                            <td>{invoice.customerName}</td>
                            <td className="num">
                              {money(invoice.total)} {invoice.currency}
                            </td>
                            <td>{invoice.paymentStatus}</td>
                            <td className="num">
                              {money(invoice.outstanding)} {invoice.currency}
                            </td>
                            <td>{invoice.accountingPosted ? tr.billingPosted : tr.billingNotPosted}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
              <Button onClick={() => void downloadReport()}>{tr.advancedDownload}</Button>
            </div>
          )}
        </Card>
      )}

      {catalogue?.notImplemented?.length ? (
        <details className="bank-details">
          <summary>{locale === 'fr' ? 'Non implémenté (déclaré)' : 'Not implemented (declared)'}</summary>
          <ul>
            {catalogue.notImplemented.map((item) => (
              <li key={item.en}>{locale === 'fr' ? item.fr : item.en}</li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
