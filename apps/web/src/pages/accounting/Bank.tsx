import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError } from '../../api';
import { demoEnabled } from '../../demo';
import { useI18n } from '../../i18n';
import { errorMessage, useSession } from '../../store';
import { Badge, Button, Card, EmptyState, ErrorBanner, Field, Spinner } from '../../components/ui';
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

interface Detail {
  transaction: BankTxn;
  bankAccount: BankAccount;
  match: MatchSuggestion;
  account: AccountSuggestion;
  internalTransfer: { transactionId: string; bankAccountId: string; days: number } | null;
  existingMatches: { id: string; status: string; reasons: string[] }[];
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
  bankBalance: string | null;
  ledgerBalance: string;
  difference: string;
  matchedCount: number;
  unmatchedCount: number;
  ledgerUnmatchedCount: number;
  status: string;
  explanations: { code: string; fr: string; en: string }[];
  validatedAt: string | null;
  validatedBy: string | null;
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
  tr: { statusMatched: string; statusProposed: string; statusReview: string; statusExcluded: string; statusUnmatched: string },
) {
  const map: Record<string, { kind: 'success' | 'warning' | 'danger' | 'info' | 'neutral'; label: string }> = {
    matched: { kind: 'success', label: tr.statusMatched },
    proposed: { kind: 'info', label: tr.statusProposed },
    review: { kind: 'warning', label: tr.statusReview },
    excluded: { kind: 'danger', label: tr.statusExcluded },
    unmatched: { kind: 'neutral', label: tr.statusUnmatched },
  };
  const item = map[status] ?? map.unmatched!;
  return <Badge kind={item.kind}>{item.label}</Badge>;
}

export default function BankPage() {
  const { locale } = useI18n();
  const tr = L[locale];
  const { company } = useSession();
  const companyId = company?.id ?? '';
  const [tab, setTab] = useState<'accounts' | 'import' | 'transactions' | 'rules' | 'report'>('accounts');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [chartAccounts, setChartAccounts] = useState<{ id: string; code: string; name: string; type: string }[]>([]);
  const [catalogue, setCatalogue] = useState<Catalogue | null>(null);
  const [accountId, setAccountId] = useState('');
  const [txns, setTxns] = useState<BankTxn[]>([]);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [rules, setRules] = useState<Rule[]>([]);
  const [imports, setImports] = useState<BankImportRow[]>([]);
  const [report, setReport] = useState<Report | null>(null);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [exchangeRate, setExchangeRate] = useState('');
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
      setAccountId((current) => current || accountsRes.accounts[0]?.id || '');
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
    } catch (err) {
      setError(errorMessage(err, tr.loadError).message);
    }
  }, [accountId, companyId, from, to, tr.loadError]);

  useEffect(() => {
    void load();
  }, [load]);
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
    setPendingFile(file);
    setPreview(null);
    setImportSummary(null);
    setBusy(true);
    setError(null);
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
    try {
      const res = await api.get<Detail>(`/companies/${companyId}/bank/transactions/${id}`);
      setDetail(res);
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

  const downloadReport = () => {
    if (!report) return;
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
                accept=".csv,.tsv,.txt,.xlsx"
                aria-label={tr.file}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void chooseFile(file);
                }}
              />
            </Field>
          </div>
          <p className="muted small">
            {locale === 'fr' ? 'Formats réels' : 'Supported formats'} : CSV, TSV/TXT, XLSX ·{' '}
            {catalogue?.limits.maxRows ?? 5000} {locale === 'fr' ? 'lignes' : 'rows'}
          </p>
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
                      <th>{tr.amount}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.preview.transactions.map((txn) => (
                      <tr key={`${txn.rowNumber}-${txn.fingerprint}`} className={txn.action === 'skip' ? 'muted-row' : ''}>
                        <td>{txn.txnDate}</td>
                        <td>{txn.label}</td>
                        <td>{txn.reference ?? '—'}</td>
                        <td className={txn.amount.startsWith('-') ? 'amount-out' : 'amount-in'}>{txn.amount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {(blocking.length > 0 || warnings.length > 0) && (
                <details className="bank-details">
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
          {importSummary && <div className="alert alert-success">{importSummary}</div>}
        </Card>
      )}

      {tab === 'transactions' && (
        <Card title={tr.transactions}>
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
            <div className="table-wrap">
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
                      <td className={txn.amount.startsWith('-') ? 'amount-out' : 'amount-in'}>{money(txn.amount)}</td>
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
                  <strong>{report.bankBalance ?? '—'}</strong>
                  <span>{tr.bankBalance}</span>
                </div>
                <div className="bank-count">
                  <strong>{report.ledgerBalance}</strong>
                  <span>{tr.ledgerBalance}</span>
                </div>
                <div className={`bank-count ${report.difference === '0.0000' ? 'ok' : 'danger'}`}>
                  <strong>{report.difference}</strong>
                  <span>{tr.difference}</span>
                </div>
              </div>
              <p className="muted">
                {report.matchedCount} {tr.matched} · {report.unmatchedCount} {tr.unmatched} ·{' '}
                {report.ledgerUnmatchedCount} {tr.ledgerUnmatched}
              </p>
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
              <Button onClick={downloadReport}>{tr.download}</Button>
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
