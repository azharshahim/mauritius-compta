import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../api';
import { useI18n } from '../../i18n';
import { errorMessage, useSession } from '../../store';
import { Badge, Button, Card, EmptyState, ErrorBanner, Field, Modal, Spinner } from '../../components/ui';
import { money, toScaled4 } from '../../format';

/**
 * Comptabilité → Lettrage (mission 12).
 *
 * Lettering only links *already posted* journal lines. It never edits an entry,
 * never creates a payment and never posts anything. Suggestions are computed
 * deterministically from the ledger and must always be confirmed by a human.
 */

type Tab = 'lettering' | 'history' | 'report';

interface Account {
  id: string;
  code: string;
  name: string;
  type: string;
  currency: string;
  unlettered: string | null;
  line_count: string;
  display_currency: string | null;
  multiple_currencies: boolean;
  unlettered_by_currency: { currency: string; amount: string; lines: string }[];
}

interface Line {
  id: string;
  entryId: string;
  entryNo: string;
  entryDate: string;
  entryReference: string | null;
  entryDescription: string;
  journalCode: string;
  accountCode: string;
  accountName: string;
  debit: string;
  credit: string;
  side: 'debit' | 'credit';
  amount: string;
  lettered: string;
  remaining: string;
  currency: string;
  documentId: string | null;
  documentKind: string | null;
  documentNo: string | null;
  documentStatus: string | null;
  partnerName: string | null;
  commercialOutstanding: string | null;
}

interface Issue {
  code: string;
  fr: string;
  en: string;
  blocking: boolean;
}

interface Preview {
  valid: boolean;
  accountCode: string | null;
  accountName: string | null;
  currency: string;
  sourceCurrency: string | null;
  totalDebit: string;
  totalCredit: string;
  amount: string;
  lines: (Line & { remaining: string })[];
  issues: Issue[];
  warnings: Issue[];
}

interface Suggestion {
  accountId: string;
  accountCode: string;
  accountName: string;
  currency: string;
  amount: string;
  confidence: number;
  rationale: { code: string; fr: string; en: string }[];
  ambiguities: { code: string; fr: string; en: string }[];
  debitLine: Line;
  creditLine: Line;
  suggestedLines: { lineId: string; amount: string }[];
}

interface LetteringRow {
  id: string;
  code: string;
  status: string;
  method: string;
  currency: string;
  source_currency: string;
  amount: string;
  total_debit: string;
  total_credit: string;
  rationale: string | null;
  account_code: string;
  account_name: string;
  created_at: string;
  reversal_reason: string | null;
  line_count?: string;
}

interface HistoryEvent {
  id: string;
  action: string;
  code: string;
  reason: string | null;
  actor_name: string | null;
  created_at: string;
  account_code: string;
}

interface Report {
  unlettered: {
    byCurrency: { currency: string; debit: string; credit: string; balance: string; lines: number }[];
    byAccount: { accountCode: string; accountName: string; currency: string; balance: string; lines: number }[];
  };
  fullyLettered: any[];
  partiallyLettered: any[];
  unletteredDocuments: any[];
  variances: any[];
  unletteredPayments: any[];
  history: HistoryEvent[];
  note: string;
}

const COPY = {
  fr: {
    title: 'Lettrage clients & fournisseurs',
    subtitle:
      'Rapprochement comptable de lignes déjà comptabilisées. Aucune écriture n’est créée, modifiée ou supprimée ; aucune validation n’est automatique.',
    tabLettering: 'Lettrage',
    tabHistory: 'Historique & délettrage',
    tabReport: 'Rapports',
    account: 'Compte tiers',
    status: 'Statut',
    all: 'Toutes',
    unlettered: 'Non lettrées',
    partial: 'Partiellement lettrées',
    lettered: 'Entièrement lettrées',
    search: 'Rechercher (écriture, référence, tiers, document)',
    refresh: 'Actualiser',
    selectAccount: 'Choisissez un compte de tiers pour commencer.',
    noLines: 'Aucune ligne ne correspond aux filtres.',
    columns: ['Sélection', 'Écriture', 'Date', 'Référence / tiers', 'Débit', 'Crédit', 'Restant', 'Statut', 'Montant à lettrer'],
    debit: 'Débit',
    credit: 'Crédit',
    remaining: 'Restant',
    initial: 'Initial',
    letteredAmount: 'Lettrage',
    preview: 'Prévisualiser',
    create: 'Confirmer le lettrage',
    suggestions: 'Suggestions explicables',
    noSuggestions: 'Aucune suggestion déterministe pour le moment.',
    deterministic: 'Calcul déterministe — confirmation humaine obligatoire',
    confidence: 'Confiance',
    ambiguity: 'Ambiguïté',
    useSuggestion: 'Prévisualiser cette suggestion',
    previewTitle: 'Aperçu avant confirmation',
    balanced: 'Équilibré',
    valid: 'Aucun blocage',
    warnings: 'Avertissements',
    confirmHint: 'Je confirme avoir vérifié les lignes et les montants.',
    cancel: 'Annuler',
    created: 'Lettrage confirmé',
    emptyHistory: 'Aucun lettrage enregistré.',
    reverse: 'Délettrer',
    reverseTitle: 'Délettrage sécurisé',
    reverseHint:
      'Le lettrage n’est pas effacé : il passe au statut « contrepassé », son motif et son historique sont conservés. Aucun paiement bancaire n’est annulé.',
    reason: 'Motif obligatoire',
    reverseConfirm: 'Je confirme le délettrage de ce groupe.',
    reversed: 'Lettrage contrepassé',
    active: 'Actif',
    reversedStatus: 'Contrepassé',
    code: 'Code',
    amount: 'Montant',
    date: 'Date',
    action: 'Action',
    unknownError: 'Impossible de charger le lettrage.',
    reportCurrency: 'Soldes non lettrés par devise (jamais additionnés entre devises)',
    reportDocs: 'Factures totalement ou partiellement lettrées',
    reportVariance: 'Écarts commercial / comptable',
    reportPayments: 'Règlements non lettrés',
    csv: 'Exporter le rapport CSV',
    csvLines: 'Exporter les lignes CSV',
    currency: 'Devise',
    from: 'Du',
    to: 'Au',
    noVariance: 'Aucun écart détecté.',
    doc: 'Document',
    partner: 'Tiers',
    commercial: 'Restant commercial',
    accounting: 'Restant comptable',
    variance: 'Écart',
    docStatus: 'Statut de lettrage',
    fully: 'Totalement lettré',
    partially: 'Partiellement lettré',
    none: 'Non lettré',
    noticeUnposted: 'Les écritures non comptabilisées ne sont jamais lettrées.',
    assistant: 'Assistant IA en lecture seule : il explique et propose, il ne valide jamais.',
  },
  en: {
    title: 'Customer & supplier lettering',
    subtitle:
      'Accounting matching of already posted lines. No entry is created, edited or deleted; nothing is validated automatically.',
    tabLettering: 'Lettering',
    tabHistory: 'History & unlettering',
    tabReport: 'Reports',
    account: 'Third-party account',
    status: 'Status',
    all: 'All',
    unlettered: 'Unlettered',
    partial: 'Partially lettered',
    lettered: 'Fully lettered',
    search: 'Search (entry, reference, third party, document)',
    refresh: 'Refresh',
    selectAccount: 'Choose a third-party account to start.',
    noLines: 'No line matches the filters.',
    columns: ['Select', 'Entry', 'Date', 'Reference / third party', 'Debit', 'Credit', 'Remaining', 'Status', 'Amount to letter'],
    debit: 'Debit',
    credit: 'Credit',
    remaining: 'Remaining',
    initial: 'Initial',
    letteredAmount: 'Lettering',
    preview: 'Preview',
    create: 'Confirm lettering',
    suggestions: 'Explainable suggestions',
    noSuggestions: 'No deterministic suggestion at the moment.',
    deterministic: 'Deterministic calculation — human confirmation required',
    confidence: 'Confidence',
    ambiguity: 'Ambiguity',
    useSuggestion: 'Preview this suggestion',
    previewTitle: 'Preview before confirmation',
    balanced: 'Balanced',
    valid: 'No blocker',
    warnings: 'Warnings',
    confirmHint: 'I confirm that I reviewed the lines and amounts.',
    cancel: 'Cancel',
    created: 'Lettering confirmed',
    emptyHistory: 'No lettering recorded.',
    reverse: 'Unletter',
    reverseTitle: 'Secure unlettering',
    reverseHint:
      'The lettering is not deleted: it becomes “reversed”, with its reason and history kept. No bank payment is cancelled.',
    reason: 'Mandatory reason',
    reverseConfirm: 'I confirm the reversal of this group.',
    reversed: 'Lettering reversed',
    active: 'Active',
    reversedStatus: 'Reversed',
    code: 'Code',
    amount: 'Amount',
    date: 'Date',
    action: 'Action',
    unknownError: 'Unable to load lettering.',
    reportCurrency: 'Unlettered balances by currency (never added across currencies)',
    reportDocs: 'Fully or partially lettered invoices',
    reportVariance: 'Commercial / accounting variances',
    reportPayments: 'Unlettered payments',
    csv: 'Export report CSV',
    csvLines: 'Export lines CSV',
    currency: 'Currency',
    from: 'From',
    to: 'To',
    noVariance: 'No variance detected.',
    doc: 'Document',
    partner: 'Third party',
    commercial: 'Commercial remaining',
    accounting: 'Accounting remaining',
    variance: 'Variance',
    docStatus: 'Lettering status',
    fully: 'Fully lettered',
    partially: 'Partially lettered',
    none: 'Unlettered',
    noticeUnposted: 'Unposted entries are never lettered.',
    assistant: 'Read-only AI assistant: it explains and suggests, it never validates.',
  },
} as const;

const zero = (value: string) => (toScaled4(value) ?? 0n) === 0n;

export default function LetteringPage() {
  const { locale } = useI18n();
  const { company } = useSession();
  const tr = COPY[locale];
  const companyId = company?.id ?? '';

  const [tab, setTab] = useState<Tab>('lettering');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountId, setAccountId] = useState('');
  const [status, setStatus] = useState<'unlettered' | 'partial' | 'lettered' | 'all'>('unlettered');
  const [search, setSearch] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [pending, setPending] = useState<Line[]>([]);
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<Preview | null>(null);
  const [reviewed, setReviewed] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [letterings, setLetterings] = useState<LetteringRow[]>([]);
  const [events, setEvents] = useState<HistoryEvent[]>([]);
  const [report, setReport] = useState<Report | null>(null);
  const [reportCurrency, setReportCurrency] = useState('');
  const [reportFrom, setReportFrom] = useState('');
  const [reportTo, setReportTo] = useState('');
  const [reverseTarget, setReverseTarget] = useState<LetteringRow | null>(null);
  const [reason, setReason] = useState('');
  const [reverseReviewed, setReverseReviewed] = useState(false);

  const account = useMemo(() => accounts.find((a) => a.id === accountId), [accounts, accountId]);
  const fmtMoney = (value: string | number | null | undefined, currency?: string) =>
    money(value, locale, currency);

  const loadAccounts = useCallback(async () => {
    if (!companyId) return;
    const res = await api.get<{ accounts: Account[] }>(`/companies/${companyId}/lettering/accounts`);
    setAccounts(res.accounts);
    setAccountId((current) => current || res.accounts[0]?.id || '');
  }, [companyId]);

  const loadLines = useCallback(async () => {
    if (!companyId || !accountId) {
      setLines([]);
      return;
    }
    const params = new URLSearchParams({ accountId, status, includeUnposted: 'true' });
    if (search.trim()) params.set('search', search.trim());
    const res = await api.get<{ lines: Line[]; pending: Line[] }>(
      `/companies/${companyId}/lettering/lines?${params.toString()}`,
    );
    setLines(res.lines);
    setPending(res.pending);
    setSelected((current) => {
      const next: Record<string, string> = {};
      for (const line of res.lines) if (current[line.id]) next[line.id] = current[line.id]!;
      return next;
    });
  }, [companyId, accountId, status, search]);

  const loadSuggestions = useCallback(async () => {
    if (!companyId || !accountId) {
      setSuggestions([]);
      return;
    }
    const res = await api.get<{ suggestions: Suggestion[] }>(
      `/companies/${companyId}/lettering/suggestions?accountId=${accountId}&limit=20`,
    );
    setSuggestions(res.suggestions);
  }, [companyId, accountId]);

  const loadHistory = useCallback(async () => {
    if (!companyId) return;
    const [groups, history] = await Promise.all([
      api.get<{ letterings: LetteringRow[] }>(`/companies/${companyId}/lettering?status=all&limit=200`),
      api.get<{ events: HistoryEvent[] }>(`/companies/${companyId}/lettering/history`),
    ]);
    setLetterings(groups.letterings);
    setEvents(history.events);
  }, [companyId]);

  const loadReport = useCallback(async () => {
    if (!companyId) return;
    const params = new URLSearchParams();
    if (reportCurrency.trim()) params.set('currency', reportCurrency.trim().toUpperCase());
    if (reportFrom) params.set('from', reportFrom);
    if (reportTo) params.set('to', reportTo);
    const suffix = params.toString() ? `?${params.toString()}` : '';
    const res = await api.get<{ report: Report }>(`/companies/${companyId}/lettering/report${suffix}`);
    setReport(res.report);
  }, [companyId, reportCurrency, reportFrom, reportTo]);

  useEffect(() => {
    if (!companyId) return;
    setLoading(true);
    setError(null);
    void loadAccounts()
      .catch((err) => setError(errorMessage(err, tr.unknownError).message))
      .finally(() => setLoading(false));
  }, [companyId, loadAccounts, tr.unknownError]);

  useEffect(() => {
    if (!accountId) return;
    void Promise.all([loadLines(), loadSuggestions()]).catch((err) =>
      setError(errorMessage(err, tr.unknownError).message),
    );
  }, [accountId, loadLines, loadSuggestions, tr.unknownError]);

  useEffect(() => {
    if (tab === 'history') void loadHistory().catch((err) => setError(errorMessage(err, tr.unknownError).message));
    if (tab === 'report') void loadReport().catch((err) => setError(errorMessage(err, tr.unknownError).message));
  }, [tab, loadHistory, loadReport, tr.unknownError]);

  const toggle = (line: Line) => {
    setSelected((current) => {
      const next = { ...current };
      if (next[line.id]) delete next[line.id];
      else next[line.id] = line.remaining;
      return next;
    });
  };

  const amountOf = (lineId: string) => selected[lineId] ?? '';

  const allocations = () =>
    Object.entries(selected).map(([lineId, amount]) => ({ lineId, amount: amount.trim() }));

  const openPreview = async () => {
    if (!accountId || Object.keys(selected).length < 2) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await api.post<{ preview: Preview }>(`/companies/${companyId}/lettering/preview`, {
        accountId,
        allocations: allocations(),
      });
      setPreview(res.preview);
      setReviewed(false);
    } catch (err) {
      setError(errorMessage(err, tr.unknownError).message);
    } finally {
      setBusy(false);
    }
  };

  const useSuggestion = async (suggestion: Suggestion) => {
    const next: Record<string, string> = {};
    for (const line of suggestion.suggestedLines) next[line.lineId] = line.amount;
    setSelected(next);
    await openPreviewWith(next);
  };

  const openPreviewWith = async (selection: Record<string, string>) => {
    if (!accountId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ preview: Preview }>(`/companies/${companyId}/lettering/preview`, {
        accountId,
        allocations: Object.entries(selection).map(([lineId, amount]) => ({ lineId, amount })),
      });
      setPreview(res.preview);
      setReviewed(false);
    } catch (err) {
      setError(errorMessage(err, tr.unknownError).message);
    } finally {
      setBusy(false);
    }
  };

  const confirmPreview = async () => {
    if (!preview || !reviewed || !accountId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ lettering: LetteringRow; idempotent: boolean }>(
        `/companies/${companyId}/lettering`,
        {
          accountId,
          allocations: allocations(),
          confirm: true,
          method: 'manual',
          idempotencyKey: crypto.randomUUID(),
        },
      );
      setNotice(`${tr.created} : ${res.lettering.code}`);
      setPreview(null);
      setSelected({});
      await Promise.all([loadLines(), loadSuggestions(), loadHistory()]);
    } catch (err) {
      setError(errorMessage(err, tr.unknownError).message);
    } finally {
      setBusy(false);
    }
  };

  const reverse = async () => {
    if (!reverseTarget || !reason.trim() || !reverseReviewed) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/companies/${companyId}/lettering/${reverseTarget.id}/reverse`, {
        reason: reason.trim(),
        confirm: true,
      });
      setNotice(`${tr.reversed} : ${reverseTarget.code}`);
      setReverseTarget(null);
      setReason('');
      setReverseReviewed(false);
      await Promise.all([loadHistory(), loadLines()]);
    } catch (err) {
      setError(errorMessage(err, tr.unknownError).message);
    } finally {
      setBusy(false);
    }
  };

  const downloadCsv = async (path: string, filename: string) => {
    setBusy(true);
    setError(null);
    try {
      const text = await api.get<string>(path);
      const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (err) {
      setError(errorMessage(err, tr.unknownError).message);
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <Spinner label={tr.title} />;

  const selectedCount = Object.keys(selected).length;

  return (
    <div className="lettering-page">
      <div className="page-head">
        <div>
          <h1>{tr.title}</h1>
          <p className="muted">{tr.subtitle}</p>
        </div>
        <div className="lettering-head-actions">
          <Badge kind="info">{tr.deterministic}</Badge>
          <span className="muted small">{tr.assistant}</span>
        </div>
      </div>

      <ErrorBanner message={error} />
      {notice && <div className="alert alert-success">{notice}</div>}

      <div className="purchase-tabs" role="tablist">
        {(['lettering', 'history', 'report'] as Tab[]).map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={tab === value}
            className={`purchase-tab${tab === value ? ' active' : ''}`}
            onClick={() => setTab(value)}
          >
            {value === 'lettering' ? tr.tabLettering : value === 'history' ? tr.tabHistory : tr.tabReport}
          </button>
        ))}
      </div>

      {tab === 'lettering' && (
        <>
          <Card>
            <div className="lettering-filters">
              <Field label={tr.account}>
                <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                  {accounts.map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.code} — {row.name} · {fmtMoney(row.unlettered)} {row.display_currency}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={tr.status}>
                <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
                  <option value="unlettered">{tr.unlettered}</option>
                  <option value="partial">{tr.partial}</option>
                  <option value="lettered">{tr.lettered}</option>
                  <option value="all">{tr.all}</option>
                </select>
              </Field>
              <Field label={`${tr.search}`}>
                <input value={search} onChange={(e) => setSearch(e.target.value)} />
              </Field>
              <Button variant="ghost" onClick={() => void loadLines()} disabled={busy}>
                {tr.refresh}
              </Button>
            </div>
            {account && (
              <p className="muted small">
                {account.code} — {account.name} · {tr.remaining} : {fmtMoney(account.unlettered)}{' '}
                {account.display_currency} · {tr.noticeUnposted}
              </p>
            )}
          </Card>

          <Card>
            <div className="section-head">
              <h2>{tr.suggestions}</h2>
              <span className="muted small">{tr.deterministic}</span>
            </div>
            {suggestions.length === 0 ? (
              <p className="muted">{tr.noSuggestions}</p>
            ) : (
              <ul className="lettering-suggestions">
                {suggestions.slice(0, 8).map((suggestion, index) => (
                  <li key={`${suggestion.debitLine.id}-${suggestion.creditLine.id}-${index}`}>
                    <div className="lettering-suggestion-head">
                      <strong>
                        {suggestion.debitLine.entryNo} ↔ {suggestion.creditLine.entryNo} ·{' '}
                        {fmtMoney(suggestion.amount)} {suggestion.currency}
                      </strong>
                      <Badge kind={suggestion.ambiguities.length ? 'warning' : 'success'}>
                        {tr.confidence} {Math.round(suggestion.confidence * 100)} %
                      </Badge>
                    </div>
                    <p className="muted small">
                      {suggestion.debitLine.entryReference ?? suggestion.debitLine.entryDescription} ·{' '}
                      {suggestion.creditLine.entryReference ?? suggestion.creditLine.entryDescription}
                    </p>
                    <ul className="lettering-reasons">
                      {suggestion.rationale.map((r) => (
                        <li key={r.code}>{locale === 'fr' ? r.fr : r.en}</li>
                      ))}
                      {suggestion.ambiguities.map((a) => (
                        <li key={a.code} className="finding-warning">
                          {tr.ambiguity} — {locale === 'fr' ? a.fr : a.en}
                        </li>
                      ))}
                    </ul>
                    <Button variant="ghost" onClick={() => void useSuggestion(suggestion)} disabled={busy}>
                      {tr.useSuggestion}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            {!accountId ? (
              <EmptyState title={tr.selectAccount} />
            ) : lines.length === 0 ? (
              <EmptyState title={tr.noLines} />
            ) : (
              <>
                <div className="table-wrap lettering-table">
                  <table className="table">
                    <thead>
                      <tr>
                        {tr.columns.map((column) => (
                          <th key={column}>{column}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {lines.map((line) => {
                        const checked = Boolean(selected[line.id]);
                        return (
                          <tr key={line.id} className={checked ? 'is-selected' : undefined}>
                            <td>
                              <input
                                type="checkbox"
                                aria-label={`${tr.columns[0]} ${line.entryNo}`}
                                checked={checked}
                                onChange={() => toggle(line)}
                              />
                            </td>
                            <td>
                              <strong>{line.entryNo}</strong>
                              <div className="muted small">{line.journalCode}</div>
                            </td>
                            <td>{line.entryDate}</td>
                            <td>
                              <div>{line.entryReference ?? line.entryDescription}</div>
                              <div className="muted small">
                                {line.partnerName ?? line.accountName}
                                {line.documentNo ? ` · ${line.documentNo}` : ''}
                              </div>
                            </td>
                            <td className="amount-in">{zero(line.debit) ? '—' : fmtMoney(line.debit)}</td>
                            <td className="amount-out">{zero(line.credit) ? '—' : fmtMoney(line.credit)}</td>
                            <td>
                              <strong>{fmtMoney(line.remaining)}</strong>{' '}
                              <span className="muted small">{line.currency}</span>
                              {line.commercialOutstanding !== null && (
                                <div className="muted small">
                                  {tr.commercial} : {fmtMoney(line.commercialOutstanding)}
                                </div>
                              )}
                            </td>
                            <td>
                              <Badge kind={zero(line.lettered) ? 'warning' : zero(line.remaining) ? 'success' : 'info'}>
                                {zero(line.remaining) ? tr.lettered : zero(line.lettered) ? tr.unlettered : tr.partial}
                              </Badge>
                            </td>
                            <td>
                              <input
                                className="lettering-amount"
                                inputMode="decimal"
                                aria-label={`${tr.letteredAmount} ${line.entryNo}`}
                                value={amountOf(line.id)}
                                onChange={(e) =>
                                  setSelected((current) => ({ ...current, [line.id]: e.target.value }))
                                }
                                disabled={!checked}
                              />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <ul className="lettering-cards">
                  {lines.map((line) => {
                    const checked = Boolean(selected[line.id]);
                    return (
                      <li key={line.id} className={checked ? 'is-selected' : undefined}>
                        <div className="lettering-card-head">
                          <label>
                            <input type="checkbox" checked={checked} onChange={() => toggle(line)} />{' '}
                            <strong>{line.entryNo}</strong>
                          </label>
                          <Badge kind={zero(line.remaining) ? 'success' : zero(line.lettered) ? 'warning' : 'info'}>
                            {zero(line.remaining) ? tr.lettered : zero(line.lettered) ? tr.unlettered : tr.partial}
                          </Badge>
                        </div>
                        <p className="muted small">
                          {line.entryDate} · {line.accountCode} · {line.entryReference ?? line.entryDescription}
                        </p>
                        <div className="lettering-card-grid">
                          <span>
                            {tr.debit} <strong>{zero(line.debit) ? '—' : fmtMoney(line.debit)}</strong>
                          </span>
                          <span>
                            {tr.credit} <strong>{zero(line.credit) ? '—' : fmtMoney(line.credit)}</strong>
                          </span>
                          <span>
                            {tr.remaining}{' '}
                            <strong>
                              {fmtMoney(line.remaining)} {line.currency}
                            </strong>
                          </span>
                        </div>
                        {checked && (
                          <Field label={tr.letteredAmount}>
                            <input
                              inputMode="decimal"
                              value={amountOf(line.id)}
                              onChange={(e) =>
                                setSelected((current) => ({ ...current, [line.id]: e.target.value }))
                              }
                            />
                          </Field>
                        )}
                      </li>
                    );
                  })}
                </ul>

                {pending.length > 0 && (
                  <div className="alert alert-warning">
                    {tr.noticeUnposted} {pending.length} ·{' '}
                    {pending.map((p) => p.entryNo).join(', ')}
                  </div>
                )}

                <div className="lettering-actions">
                  <Button
                    variant="primary"
                    onClick={() => void openPreview()}
                    disabled={busy || selectedCount < 2}
                  >
                    {tr.preview} ({selectedCount})
                  </Button>
                  <Button variant="ghost" onClick={() => setSelected({})} disabled={busy || selectedCount === 0}>
                    {tr.cancel}
                  </Button>
                </div>
              </>
            )}
          </Card>
        </>
      )}

      {tab === 'history' && (
        <Card>
          {letterings.length === 0 ? (
            <EmptyState title={tr.emptyHistory} />
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>{tr.code}</th>
                    <th>{tr.account}</th>
                    <th>{tr.amount}</th>
                    <th>{tr.status}</th>
                    <th>{tr.date}</th>
                    <th>{tr.action}</th>
                  </tr>
                </thead>
                <tbody>
                  {letterings.map((row) => (
                    <tr key={row.id}>
                      <td>
                        <strong>{row.code}</strong>
                      </td>
                      <td>
                        {row.account_code} — {row.account_name}
                      </td>
                      <td>
                        {fmtMoney(row.amount)} {row.currency}
                      </td>
                      <td>
                        <Badge kind={row.status === 'active' ? 'success' : 'warning'}>
                          {row.status === 'active' ? tr.active : tr.reversedStatus}
                        </Badge>
                        {row.reversal_reason && <div className="muted small">{row.reversal_reason}</div>}
                      </td>
                      <td>{row.created_at?.slice(0, 10)}</td>
                      <td>
                        {row.status === 'active' && (
                          <Button variant="danger" onClick={() => setReverseTarget(row)}>
                            {tr.reverse}
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <h3>{tr.tabHistory}</h3>
          <ul className="lettering-events">
            {events.map((event) => (
              <li key={event.id}>
                <strong>{event.code}</strong> · {event.action === 'created' ? tr.created : tr.reversed} ·{' '}
                {event.account_code}
                {event.reason ? ` · ${event.reason}` : ''}
                <span className="muted small">
                  {' '}
                  — {event.actor_name ?? '—'} · {event.created_at?.slice(0, 16).replace('T', ' ')}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {tab === 'report' && (
        <Card>
          <div className="section-head">
            <h2>{tr.tabReport}</h2>
            <div className="lettering-actions">
              <Button
                variant="ghost"
                onClick={() => void downloadCsv(`/companies/${companyId}/lettering/report.csv`, 'lettrage-rapport.csv')}
                disabled={busy}
              >
                {tr.csv}
              </Button>
              <Button
                variant="ghost"
                onClick={() => void downloadCsv(`/companies/${companyId}/lettering/lines.csv`, 'lettrage-lignes.csv')}
                disabled={busy}
              >
                {tr.csvLines}
              </Button>
            </div>
          </div>
          <div className="lettering-filters">
            <Field label={tr.currency}>
              <input
                value={reportCurrency}
                onChange={(e) => setReportCurrency(e.target.value.toUpperCase().slice(0, 3))}
                placeholder="MUR"
              />
            </Field>
            <Field label={tr.from}>
              <input type="date" value={reportFrom} onChange={(e) => setReportFrom(e.target.value)} />
            </Field>
            <Field label={tr.to}>
              <input type="date" value={reportTo} onChange={(e) => setReportTo(e.target.value)} />
            </Field>
            <Button variant="ghost" onClick={() => void loadReport()} disabled={busy}>
              {tr.refresh}
            </Button>
          </div>
          {!report ? (
            <Spinner label={tr.tabReport} />
          ) : (
            <>
              <h3>{tr.reportCurrency}</h3>
              <div className="lettering-currency-grid">
                {report.unlettered.byCurrency.map((row) => (
                  <div key={row.currency} className="lettering-currency">
                    <strong>{row.currency}</strong>
                    <span>
                      {tr.debit} : {fmtMoney(row.debit)}
                    </span>
                    <span>
                      {tr.credit} : {fmtMoney(row.credit)}
                    </span>
                    <span>
                      {tr.remaining} : {fmtMoney(row.balance)}
                    </span>
                    <span className="muted small">
                      {row.lines} {locale === 'fr' ? 'lignes' : 'lines'}
                    </span>
                  </div>
                ))}
              </div>

              <h3>{tr.reportDocs}</h3>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>{tr.doc}</th>
                      <th>{tr.partner}</th>
                      <th>{tr.commercial}</th>
                      <th>{tr.accounting}</th>
                      <th>{tr.variance}</th>
                      <th>{tr.docStatus}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...report.fullyLettered, ...report.partiallyLettered].map((row) => (
                      <tr key={`${row.source}-${row.id}`}>
                        <td>{row.number}</td>
                        <td>{row.partnerName}</td>
                        <td>
                          {fmtMoney(row.commercialOutstanding)} {row.currency}
                        </td>
                        <td>
                          {fmtMoney(row.accountingRemaining)} {row.currency}
                        </td>
                        <td>{fmtMoney(row.variance)}</td>
                        <td>
                          <Badge kind={row.letteringStatus === 'fully_lettered' ? 'success' : 'warning'}>
                            {row.letteringStatus === 'fully_lettered' ? tr.fully : tr.partially}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <h3>{tr.reportVariance}</h3>
              {report.variances.length === 0 ? (
                <p className="muted">{tr.noVariance}</p>
              ) : (
                <ul>
                  {report.variances.map((row) => (
                    <li key={`${row.source}-${row.id}-v`}>
                      {row.number} · {tr.commercial} {fmtMoney(row.commercialOutstanding)} · {tr.accounting}{' '}
                      {fmtMoney(row.accountingRemaining)} · {tr.variance} {fmtMoney(row.variance)} {row.currency}
                    </li>
                  ))}
                </ul>
              )}

              <h3>{tr.reportPayments}</h3>
              <ul className="lettering-events">
                {report.unletteredPayments.map((row) => (
                  <li key={`${row.source}-${row.id}`}>
                    {row.number ?? row.id} · {row.paymentDate} · {row.partnerName} · {fmtMoney(row.remaining)}{' '}
                    {row.currency} ·{' '}
                    {row.status === 'awaiting_accounting'
                      ? locale === 'fr'
                        ? 'en attente de comptabilisation'
                        : 'awaiting accounting'
                      : tr.partially}
                  </li>
                ))}
              </ul>
              <p className="muted small">{report.note}</p>
            </>
          )}
        </Card>
      )}

      <Modal open={Boolean(preview)} title={tr.previewTitle} onClose={() => setPreview(null)}>
        {preview && (
          <div className="lettering-preview">
            <p>
              {preview.accountCode} — {preview.accountName} · {preview.sourceCurrency ?? preview.currency}
            </p>
            <div className="lettering-summary">
              <span>
                {tr.debit} : <strong>{fmtMoney(preview.totalDebit)}</strong>
              </span>
              <span>
                {tr.credit} : <strong>{fmtMoney(preview.totalCredit)}</strong>
              </span>
              <Badge kind={preview.valid ? 'success' : 'danger'}>{preview.valid ? tr.valid : tr.preview}</Badge>
            </div>
            <ul className="lettering-preview-lines">
              {preview.lines.map((line) => (
                <li key={line.id}>
                  <strong>{line.entryNo}</strong> · {line.entryDate} · {line.entryReference ?? line.entryDescription}
                  <span>
                    {line.side === 'debit' ? tr.debit : tr.credit} {fmtMoney(line.remaining)}
                  </span>
                </li>
              ))}
            </ul>
            {preview.issues.map((issue) => (
              <div key={issue.code} className={`alert ${issue.blocking ? 'alert-error' : 'alert-warning'}`}>
                {locale === 'fr' ? issue.fr : issue.en}
              </div>
            ))}
            {preview.warnings.map((warning) => (
              <div key={warning.code} className="alert alert-warning">
                {locale === 'fr' ? warning.fr : warning.en}
              </div>
            ))}
            {preview.valid && (
              <label className="checkbox-row">
                <input type="checkbox" checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} />{' '}
                {tr.confirmHint}
              </label>
            )}
            <div className="lettering-actions">
              <Button variant="ghost" onClick={() => setPreview(null)}>
                {tr.cancel}
              </Button>
              <Button
                variant="primary"
                onClick={() => void confirmPreview()}
                disabled={busy || !preview.valid || !reviewed}
              >
                {tr.create}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={Boolean(reverseTarget)} title={tr.reverseTitle} onClose={() => setReverseTarget(null)}>
        {reverseTarget && (
          <div className="lettering-preview">
            <p>
              <strong>{reverseTarget.code}</strong> · {fmtMoney(reverseTarget.amount)} {reverseTarget.currency}
            </p>
            <div className="alert alert-warning">{tr.reverseHint}</div>
            <Field label={tr.reason}>
              <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} />
            </Field>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={reverseReviewed}
                onChange={(e) => setReverseReviewed(e.target.checked)}
              />{' '}
              {tr.reverseConfirm}
            </label>
            <div className="lettering-actions">
              <Button variant="ghost" onClick={() => setReverseTarget(null)}>
                {tr.cancel}
              </Button>
              <Button
                variant="danger"
                onClick={() => void reverse()}
                disabled={busy || !reason.trim() || !reverseReviewed}
              >
                {tr.reverse}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
