import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../../api';
import { useI18n } from '../../i18n';
import { errorMessage, useSession } from '../../store';
import { money } from '../../format';
import { AppIcon } from '../../components/AppIcon';
import { Badge, Button, Card, DemoNotice, EmptyState, ErrorBanner, Modal, Spinner } from '../../components/ui';

/**
 * Mission 28 — grouped bank reconciliation.
 *
 * This is a review layer, not a second reconciliation engine. Suggestions come
 * from the existing `suggestMatches` implementation through
 * `GET /bank/transactions/:id`; confirmation is the existing
 * `POST /bank/transactions/:id/matches` with `confirm: true`, called once per
 * transaction. Partial payments, split payments and foreign-currency cases are
 * deliberately left to the individual review screen.
 */

interface BankAccount {
  id: string;
  name: string;
  bank_name: string;
  currency: string;
  unmatched_count?: number;
}

interface BankTxn {
  id: string;
  txn_date: string;
  label: string;
  reference: string | null;
  amount: string;
  currency: string;
  status: string;
}

interface MatchCandidate {
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

interface MatchSuggestion {
  status: 'none' | 'proposed' | 'ambiguous' | 'review';
  candidates: MatchCandidate[];
  split: { entryNo: string; lineIds: string[]; total: string } | null;
  reasonCode: string | null;
  reasonFr: string | null;
  reasonEn: string | null;
}

interface Detail {
  transaction: BankTxn;
  match: MatchSuggestion;
  existingMatches: unknown[];
}

type Category = 'exact' | 'ambiguous' | 'absent' | 'review';
type RowState = 'suggested' | 'confirming' | 'confirmed' | 'error';

interface ReconRow {
  key: string;
  txn: BankTxn;
  match: MatchSuggestion;
  category: Category;
  candidate: MatchCandidate | null;
  selected: boolean;
  state: RowState;
  error?: string;
}

type Filter = 'all' | Category;

const REASONS_EN: Record<string, string> = {
  'Montant exact': 'Exact amount',
  'Montant différent (paiement partiel probable)': 'Different amount (possible partial payment)',
  'Libellé proche': 'Similar label',
  'Référence concordante': 'Matching reference',
  'Somme de deux lignes = montant bancaire': 'Two lines add up to the bank amount',
};

function displayReason(reason: string, locale: 'fr' | 'en'): string {
  return locale === 'en' ? REASONS_EN[reason] ?? reason : reason;
}

const L = {
  fr: {
    title: 'Rapprochement bancaire groupé',
    subtitle: 'Analysez les transactions d’un relevé importé, vérifiez les suggestions puis confirmez chaque rapprochement explicitement.',
    back: 'Retour à la banque',
    account: 'Compte bancaire',
    analyze: 'Analyser les transactions',
    analyzing: 'Analyse des transactions…',
    analyzed: 'transactions analysées',
    reload: 'Relancer l’analyse',
    filter: 'Filtrer',
    all: 'Toutes',
    exact: 'Correspondances exactes',
    ambiguous: 'Ambiguës',
    absent: 'Absentes',
    review: 'À vérifier',
    date: 'Date',
    label: 'Libellé',
    amount: 'Montant',
    category: 'Catégorie',
    proposal: 'Écriture suggérée',
    reasons: 'Motifs',
    state: 'État',
    actions: 'Actions',
    select: 'Sélectionner',
    selectAll: 'Tout sélectionner',
    clear: 'Tout désélectionner',
    suggested: 'Suggestion',
    confirmed: 'Rapprochement confirmé',
    confirming: 'Confirmation…',
    error: 'Échec',
    noEntry: '—',
    open: 'Ouvrir dans la banque',
    confirm: 'Confirmer les rapprochements',
    confirmTitle: 'Confirmer les rapprochements sélectionnés',
    confirmIntro: 'Chaque ligne ci-dessous sera confirmée par un appel distinct au moteur existant. Une suggestion n’est pas un rapprochement tant que vous n’avez pas confirmé.',
    confirmCount: 'Transactions concernées',
    confirmTotal: 'Total des mouvements sélectionnés',
    confirmCheck: 'Je vérifie les montants, les écritures et les dates avant de confirmer.',
    cancel: 'Annuler',
    processing: 'Traitement…',
    selected: 'sélectionnée(s)',
    resultTitle: 'Résultat de la confirmation groupée',
    resultOk: 'Rapprochement confirmé',
    resultKo: 'Non confirmé',
    empty: 'Aucune transaction ne correspond à ce filtre.',
    noRows: 'Choisissez un compte puis lancez l’analyse. Aucun rapprochement n’est automatique.',
    noAccounts: 'Aucun compte bancaire actif.',
    noCompany: 'Aucune société active.',
    limit: 'Analyse limitée aux 100 transactions non rapprochées les plus récentes du compte. Utilisez l’écran Banque pour l’historique complet.',
    limitTitle: 'Périmètre et limites',
    limitAmbiguous: 'Les correspondances ambiguës restent à vérifier individuellement : l’application ne choisit pas à votre place.',
    limitPartial: 'Paiements partiels, plusieurs factures pour un règlement, virements internes et devises étrangères ne sont pas confirmés en masse. Ouvrez la fiche dans Banque.',
    limitSplit: 'Une ventilation trouvée par le moteur reste indicative. Aucune écriture de ventilation n’est créée ici.',
    limitExact: 'Seules les suggestions uniques et exactes sont sélectionnables. La confirmation vérifie encore les conflits, doublons et montants côté serveur.',
    countExact: 'exactes',
    countAmbiguous: 'ambiguës',
    countAbsent: 'absentes',
    countReview: 'à vérifier',
    exactHelp: 'Suggestion unique dont le montant et la date concordent avec l’écriture.',
    ambiguousHelp: 'Plusieurs écritures candidates : décision humaine requise.',
    absentHelp: 'Aucune écriture de trésorerie correspondante dans la fenêtre analysée.',
    reviewHelp: 'Paiement partiel, ventilation ou devise : vérification individuelle.',
    source: 'Source : relevé importé dans le compte sélectionné. Aucun fichier n’est réimporté ni dupliqué par cet écran.',
    noSelection: 'Sélectionnez au moins une correspondance exacte.',
    loadError: 'Impossible de charger les transactions.',
  },
  en: {
    title: 'Bulk bank reconciliation',
    subtitle: 'Analyse transactions from an imported statement, review suggestions and explicitly confirm each match.',
    back: 'Back to banking',
    account: 'Bank account',
    analyze: 'Analyse transactions',
    analyzing: 'Analysing transactions…',
    analyzed: 'transactions analysed',
    reload: 'Run the analysis again',
    filter: 'Filter',
    all: 'All',
    exact: 'Exact matches',
    ambiguous: 'Ambiguous',
    absent: 'No match',
    review: 'To review',
    date: 'Date',
    label: 'Label',
    amount: 'Amount',
    category: 'Category',
    proposal: 'Suggested entry',
    reasons: 'Reasons',
    state: 'State',
    actions: 'Actions',
    select: 'Select',
    selectAll: 'Select all',
    clear: 'Clear selection',
    suggested: 'Suggestion',
    confirmed: 'Match confirmed',
    confirming: 'Confirming…',
    error: 'Failed',
    noEntry: '—',
    open: 'Open in banking',
    confirm: 'Confirm matches',
    confirmTitle: 'Confirm selected matches',
    confirmIntro: 'Each line below is confirmed by a separate call to the existing engine. A suggestion is not a match until you confirm it.',
    confirmCount: 'Transactions concerned',
    confirmTotal: 'Total of selected movements',
    confirmCheck: 'I reviewed the amounts, entries and dates before confirming.',
    cancel: 'Cancel',
    processing: 'Processing…',
    selected: 'selected',
    resultTitle: 'Bulk confirmation result',
    resultOk: 'Match confirmed',
    resultKo: 'Not confirmed',
    empty: 'No transaction matches this filter.',
    noRows: 'Choose an account and run the analysis. Nothing is matched automatically.',
    noAccounts: 'No active bank account.',
    noCompany: 'No active company.',
    limit: 'Analysis is limited to the 100 most recent unmatched transactions of the account. Use the Banking screen for the full history.',
    limitTitle: 'Scope and limitations',
    limitAmbiguous: 'Ambiguous matches remain individually reviewed: the application does not choose on your behalf.',
    limitPartial: 'Partial payments, multiple invoices for one payment, internal transfers and foreign currencies are not bulk-confirmed. Open the transaction in Banking.',
    limitSplit: 'A split found by the engine remains indicative. No split entry is created here.',
    limitExact: 'Only unique exact suggestions can be selected. Confirmation still checks conflicts, duplicates and amounts server-side.',
    countExact: 'exact',
    countAmbiguous: 'ambiguous',
    countAbsent: 'without match',
    countReview: 'to review',
    exactHelp: 'Single suggestion whose amount and date agree with the ledger entry.',
    ambiguousHelp: 'Several candidate entries: human decision required.',
    absentHelp: 'No matching treasury entry in the analysed window.',
    reviewHelp: 'Partial payment, split or currency: individual review.',
    source: 'Source: statement imported into the selected account. No file is re-imported or duplicated by this screen.',
    noSelection: 'Select at least one exact match.',
    loadError: 'Could not load transactions.',
  },
} as const;

async function pool<T>(items: T[], limit: number, work: (item: T) => Promise<void>) {
  let index = 0;
  async function worker() {
    while (index < items.length) {
      const current = items[index++]!;
      await work(current);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

function categorise(match: MatchSuggestion): { category: Category; candidate: MatchCandidate | null } {
  const exact =
    match.status === 'proposed' &&
    !match.split &&
    match.candidates.length === 1 &&
    match.candidates[0]?.kind === 'exact'
      ? match.candidates[0]
      : null;
  if (exact) return { category: 'exact', candidate: exact };
  if (match.status === 'review' || match.split) return { category: 'review', candidate: null };
  if (match.status === 'ambiguous' || match.candidates.length > 1) return { category: 'ambiguous', candidate: null };
  return { category: 'absent', candidate: null };
}

export default function BulkReconciliationPage() {
  const { locale } = useI18n();
  const tr = L[locale];
  const { company } = useSession();
  const [searchParams] = useSearchParams();
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [accountId, setAccountId] = useState(searchParams.get('bankAccountId') ?? '');
  const [rows, setRows] = useState<ReconRow[]>([]);
  const [filter, setFilter] = useState<Filter>('all');
  const [loadingAccounts, setLoadingAccounts] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyseProgress, setAnalyseProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<{ key: string; ok: boolean; message: string }[]>([]);

  useEffect(() => {
    if (!company) return;
    setLoadingAccounts(true);
    api
      .get<{ accounts: BankAccount[] }>(`/companies/${company.id}/bank/accounts`)
      .then((res) => {
        setAccounts(res.accounts);
        setAccountId((current) => current || res.accounts[0]?.id || '');
      })
      .catch((err) => setError(errorMessage(err, tr.loadError).message))
      .finally(() => setLoadingAccounts(false));
  }, [company?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setRows([]);
    setResults([]);
    setFilter('all');
  }, [accountId]);

  const analyse = async () => {
    if (!company || !accountId) return;
    setAnalyzing(true);
    setError(null);
    setRows([]);
    setResults([]);
    setAnalyseProgress(0);
    try {
      const [unmatched, review] = await Promise.all([
        api.get<{ transactions: BankTxn[] }>(
          `/companies/${company.id}/bank/transactions?bankAccountId=${accountId}&status=unmatched&limit=100`,
        ),
        api.get<{ transactions: BankTxn[] }>(
          `/companies/${company.id}/bank/transactions?bankAccountId=${accountId}&status=review&limit=100`,
        ),
      ]);
      const unique = new Map<string, BankTxn>();
      for (const txn of [...unmatched.transactions, ...review.transactions]) unique.set(txn.id, txn);
      const transactions = [...unique.values()].slice(0, 100);
      let done = 0;
      await pool(transactions, 4, async (txn) => {
        try {
          const detail = await api.get<Detail>(`/companies/${company.id}/bank/transactions/${txn.id}`);
          const { category, candidate } = categorise(detail.match);
          setRows((previous) => [
            ...previous,
            {
              key: txn.id,
              txn,
              match: detail.match,
              category,
              candidate,
              selected: false,
              state: 'suggested',
            },
          ]);
        } catch (err) {
          setRows((previous) => [
            ...previous,
            {
              key: txn.id,
              txn,
              match: {
                status: 'review',
                candidates: [],
                split: null,
                reasonCode: 'DETAIL_UNAVAILABLE',
                reasonFr: 'Détail indisponible',
                reasonEn: 'Detail unavailable',
              },
              category: 'review',
              candidate: null,
              selected: false,
              state: 'error',
              error: errorMessage(err, tr.loadError).message,
            },
          ]);
        } finally {
          done += 1;
          setAnalyseProgress(done);
        }
      });
    } catch (err) {
      setError(errorMessage(err, tr.loadError).message);
    } finally {
      setAnalyzing(false);
    }
  };

  const counts = useMemo(
    () => ({
      all: rows.length,
      exact: rows.filter((row) => row.category === 'exact').length,
      ambiguous: rows.filter((row) => row.category === 'ambiguous').length,
      absent: rows.filter((row) => row.category === 'absent').length,
      review: rows.filter((row) => row.category === 'review').length,
    }),
    [rows],
  );
  const visible = useMemo(
    () => (filter === 'all' ? rows : rows.filter((row) => row.category === filter)),
    [filter, rows],
  );
  const selected = rows.filter((row) => row.selected && row.candidate && row.state === 'suggested');
  const totalSelected = selected.reduce((sum, row) => sum + Math.abs(Number(row.txn.amount)), 0);

  const confirm = async () => {
    if (!company || selected.length === 0) {
      setError(tr.noSelection);
      return;
    }
    setBusy(true);
    setError(null);
    const collected: { key: string; ok: boolean; message: string }[] = [];
    await pool(selected, 2, async (row) => {
      setRows((previous) => previous.map((item) => (item.key === row.key ? { ...item, state: 'confirming' } : item)));
      try {
        await api.post(`/companies/${company.id}/bank/transactions/${row.txn.id}/matches`, {
          lineIds: [row.candidate!.lineId],
          confirm: true,
        });
        collected.push({ key: row.key, ok: true, message: `${tr.resultOk} — ${row.candidate!.entryNo}` });
        setRows((previous) =>
          previous.map((item) =>
            item.key === row.key ? { ...item, state: 'confirmed', selected: false } : item,
          ),
        );
      } catch (err) {
        const message = errorMessage(err, tr.resultKo).message;
        collected.push({ key: row.key, ok: false, message });
        setRows((previous) =>
          previous.map((item) =>
            item.key === row.key ? { ...item, state: 'error', selected: false, error: message } : item,
          ),
        );
      }
    });
    setResults(collected);
    setBusy(false);
    setConfirmOpen(false);
    setConfirmed(false);
  };

  if (!company) return <EmptyState title={tr.noCompany} />;

  const categoryBadge = (category: Category) => {
    if (category === 'exact') return <Badge kind="success">{tr.exact}</Badge>;
    if (category === 'ambiguous') return <Badge kind="warning">{tr.ambiguous}</Badge>;
    if (category === 'review') return <Badge kind="warning">{tr.review}</Badge>;
    return <Badge kind="neutral">{tr.absent}</Badge>;
  };

  const selectAllExact = (checked: boolean) => {
    setRows((previous) =>
      previous.map((row) =>
        row.category === 'exact' && row.state === 'suggested' && row.candidate
          ? { ...row, selected: checked }
          : row,
      ),
    );
  };

  return (
    <div className="recon-page">
      <DemoNotice />
      <div className="page-head">
        <div className="grow">
          <Link className="page-sub" to="/accounting/banking?tab=transactions">← {tr.back}</Link>
          <h1>{tr.title}</h1>
          <div className="page-sub">{tr.subtitle}</div>
        </div>
      </div>

      <ErrorBanner message={error} />

      <Card title={tr.account}>
        {loadingAccounts ? (
          <Spinner />
        ) : accounts.length === 0 ? (
          <EmptyState title={tr.noAccounts} />
        ) : (
          <>
            <div className="form-row">
              <select value={accountId} onChange={(event) => setAccountId(event.target.value)} aria-label={tr.account}>
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name} — {account.bank_name} ({account.currency}) · {account.unmatched_count ?? 0} {tr.absent.toLowerCase()}
                  </option>
                ))}
              </select>
              <Button variant="primary" onClick={() => void analyse()} disabled={!accountId || analyzing}>
                <AppIcon name={analyzing ? 'refresh' : 'reconciliation'} />
                {analyzing ? `${tr.analyzing} ${analyseProgress}` : rows.length ? tr.reload : tr.analyze}
              </Button>
            </div>
            <p className="page-sub">{tr.source}</p>
          </>
        )}
      </Card>

      <div className="recon-limit">
        <strong>{tr.limitTitle}</strong>
        <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
          <li>{tr.limitExact}</li>
          <li>{tr.limitAmbiguous}</li>
          <li>{tr.limitPartial}</li>
          <li>{tr.limitSplit}</li>
          <li>{tr.limit}</li>
        </ul>
      </div>

      {rows.length > 0 && (
        <Card title={tr.filter}>
          <div className="bulk-summary">
            <Badge kind="success">{counts.exact} {tr.countExact}</Badge>
            <Badge kind="warning">{counts.ambiguous} {tr.countAmbiguous}</Badge>
            <Badge kind="neutral">{counts.absent} {tr.countAbsent}</Badge>
            <Badge kind="warning">{counts.review} {tr.countReview}</Badge>
          </div>
          <div className="bulk-filters" role="tablist" aria-label={tr.filter}>
            {([
              ['all', tr.all], ['exact', tr.exact], ['ambiguous', tr.ambiguous], ['absent', tr.absent], ['review', tr.review],
            ] as [Filter, string][]).map(([key, label]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={filter === key}
                className={`bulk-filter ${filter === key ? 'active' : ''}`}
                onClick={() => setFilter(key)}
              >
                {label} <span aria-hidden="true">({counts[key]})</span>
              </button>
            ))}
          </div>

          {visible.length === 0 ? (
            <EmptyState title={tr.empty} />
          ) : (
            <div className="table-wrap">
              <table className="bulk-table recon-table">
                <thead>
                  <tr>
                    <th>
                      <input
                        type="checkbox"
                        aria-label={tr.selectAll}
                        checked={visible.some((row) => row.category === 'exact') && visible.filter((row) => row.category === 'exact').every((row) => row.selected)}
                        onChange={(event) => selectAllExact(event.target.checked)}
                      />
                    </th>
                    <th>{tr.date}</th>
                    <th>{tr.label}</th>
                    <th>{tr.amount}</th>
                    <th>{tr.category}</th>
                    <th>{tr.proposal}</th>
                    <th>{tr.reasons}</th>
                    <th>{tr.state}</th>
                    <th>{tr.actions}</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((row) => (
                    <tr key={row.key}>
                      <td>
                        <input
                          type="checkbox"
                          checked={row.selected}
                          disabled={row.category !== 'exact' || row.state !== 'suggested'}
                          aria-label={`${tr.select} ${row.txn.label}`}
                          onChange={(event) =>
                            setRows((previous) =>
                              previous.map((item) => (item.key === row.key ? { ...item, selected: event.target.checked } : item)),
                            )
                          }
                        />
                      </td>
                      <td data-label={tr.date}>{row.txn.txn_date}</td>
                      <td data-label={tr.label}>
                        <strong>{row.txn.label}</strong>
                        {row.txn.reference && <div className="page-sub">{row.txn.reference}</div>}
                      </td>
                      <td data-label={tr.amount}>{money(row.txn.amount, locale, row.txn.currency)}</td>
                      <td data-label={tr.category}>
                        {categoryBadge(row.category)}
                        <div className="recon-candidate">
                          {row.category === 'exact' ? tr.exactHelp : row.category === 'ambiguous' ? tr.ambiguousHelp : row.category === 'review' ? tr.reviewHelp : tr.absentHelp}
                        </div>
                      </td>
                      <td data-label={tr.proposal}>
                        {row.candidate ? (
                          <>
                            <strong>{row.candidate.entryNo}</strong>
                            <div className="page-sub">
                              {row.candidate.entryDate} · {money(row.candidate.amount, locale, row.txn.currency)}
                            </div>
                            {row.match.candidates.length > 1 && (
                              <div className="recon-candidate">
                                +{row.match.candidates.length - 1} {locale === 'fr' ? 'autre(s)' : 'other(s)'}
                              </div>
                            )}
                          </>
                        ) : row.match.candidates.length > 0 ? (
                          <>
                            <strong>{row.match.candidates[0]?.entryNo}</strong>
                            <div className="recon-candidate">
                              {row.match.candidates.slice(0, 3).map((candidate) => candidate.entryNo).join(' · ')}
                            </div>
                          </>
                        ) : (
                          <span className="page-sub">{tr.noEntry}</span>
                        )}
                        {row.match.split && (
                          <div className="page-sub">
                            {locale === 'fr' ? 'Ventilation possible' : 'Possible split'}: {row.match.split.entryNo} · {money(row.match.split.total, locale, row.txn.currency)}
                          </div>
                        )}
                      </td>
                      <td data-label={tr.reasons}>
                        <div className="recon-candidate">
                          {(row.candidate?.reasons ?? []).slice(0, 2).map((reason) => <div key={reason}>{displayReason(reason, locale)}</div>)}
                          {row.match.reasonCode && <div>{locale === 'fr' ? row.match.reasonFr : row.match.reasonEn}</div>}
                        </div>
                      </td>
                      <td data-label={tr.state}>
                        {row.state === 'confirmed' ? (
                          <Badge kind="success">{tr.confirmed}</Badge>
                        ) : row.state === 'confirming' ? (
                          <Badge kind="info">{tr.confirming}</Badge>
                        ) : row.state === 'error' ? (
                          <Badge kind="danger">{tr.error}</Badge>
                        ) : (
                          <Badge kind="neutral">{tr.suggested}</Badge>
                        )}
                        {row.error && <div className="bulk-row-error">{row.error}</div>}
                      </td>
                      <td data-label={tr.actions}>
                        <Link
                          className="btn btn-sm"
                          to={`/accounting/banking?tab=transactions&bankAccountId=${encodeURIComponent(accountId)}&transactionId=${encodeURIComponent(row.txn.id)}`}
                        >
                          <AppIcon name="view" size={15} /> <span className="btn-label">{tr.open}</span>
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="bulk-actions-bar" style={{ marginTop: 12 }}>
            <div className="grow">
              <strong>{selected.length}</strong> {tr.selected}
              {selected.length > 0 && <span className="page-sub"> · {money(totalSelected, locale, accounts.find((account) => account.id === accountId)?.currency ?? 'MUR')}</span>}
            </div>
            <Button className="btn-sm" onClick={() => selectAllExact(true)}>
              {tr.selectAll}
            </Button>
            <Button className="btn-sm" onClick={() => selectAllExact(false)} disabled={!rows.some((row) => row.selected)}>
              {tr.clear}
            </Button>
            <Button variant="primary" disabled={!selected.length || busy} onClick={() => { setConfirmed(false); setConfirmOpen(true); }}>
              <AppIcon name="validate" /> {tr.confirm}
            </Button>
          </div>
        </Card>
      )}

      {rows.length === 0 && !analyzing && <Card><EmptyState title={tr.noRows} /></Card>}

      {results.length > 0 && (
        <Card title={tr.resultTitle}>
          <div className="bulk-results" role="status">
            {results.map((result) => (
              <div className={`bulk-result ${result.ok ? 'ok' : 'ko'}`} key={result.key}>
                <AppIcon name={result.ok ? 'validate' : 'alert'} size={16} />
                <span>{result.message}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Modal open={confirmOpen} title={tr.confirmTitle} onClose={() => { setConfirmOpen(false); setConfirmed(false); }} wide>
        <p>{tr.confirmIntro}</p>
        <div className="bulk-summary" style={{ margin: '12px 0' }}>
          <Badge kind="info">{tr.confirmCount}: {selected.length}</Badge>
          <Badge kind="neutral">
            {tr.confirmTotal}: {money(totalSelected, locale, accounts.find((account) => account.id === accountId)?.currency ?? 'MUR')}
          </Badge>
        </div>
        <ul className="bulk-results">
          {selected.map((row) => (
            <li key={row.key} className="bulk-result ok">
              <AppIcon name="reconciliation" size={16} />
              <span>{row.txn.txn_date} · {row.txn.label} · {money(row.txn.amount, locale, row.txn.currency)} → {row.candidate?.entryNo}</span>
            </li>
          ))}
        </ul>
        <label className="bulk-confirm-box" style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginTop: 12 }}>
          <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
          <span>{tr.confirmCheck}</span>
        </label>
        <p className="page-sub">{tr.limitPartial}</p>
        <div className="page-head-actions" style={{ justifyContent: 'flex-end' }}>
          <Button onClick={() => { setConfirmOpen(false); setConfirmed(false); }}>{tr.cancel}</Button>
          <Button variant="primary" disabled={!confirmed || busy} onClick={() => void confirm()}>
            <AppIcon name="validate" /> {busy ? tr.processing : tr.confirm}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
