import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../../api';
import { useI18n } from '../../i18n';
import { errorMessage, useSession } from '../../store';
import { Badge, Button, Card, EmptyState, ErrorBanner, Field, Spinner } from '../../components/ui';
import { money } from '../../format';

/**
 * Mission 42.1 — accounting controls.
 *
 * Two read-only screens built on the mission 42 API:
 *  - subledger vs general ledger reconciliation (receivable and payable);
 *  - VAT control per account and per currency.
 *
 * Nothing is posted here, no difference is hidden or forced to zero, and the
 * VAT screen is explicitly not an official MRA return.
 */

type Tab = 'subledger' | 'vat';

interface ReconciliationRow {
  accountId: string;
  accountCode: string;
  accountName: string;
  currency: string;
  glBalance: string;
  postedSubledger: string;
  unpostedDocuments: string;
  subledgerTotal: string;
  difference: string;
  explainedDifference: string;
  unexplainedDifference: string;
  status: 'reconciled' | 'explained' | 'unexplained';
}

interface SubledgerSide {
  side: 'receivable' | 'payable';
  asOf: string;
  accounts: { id: string; code: string; name: string }[];
  rows: ReconciliationRow[];
  totalsByCurrency: {
    currency: string;
    glBalance: string;
    postedSubledger: string;
    unpostedDocuments: string;
    subledgerTotal: string;
    difference: string;
    unexplainedDifference: string;
  }[];
  unpostedDocuments: {
    id: string; kind: 'invoice' | 'credit_note'; number: string | null; partyName: string;
    date: string; currency: string; amount: string;
  }[];
  unpostedPayments: {
    id: string; number: string | null; partyName: string; date: string; currency: string; amount: string;
  }[];
  controls: { reconciled: boolean; hasUnexplainedDifference: boolean; notice: string };
}

interface SubledgerReport {
  asOf: string;
  receivable: SubledgerSide;
  payable: SubledgerSide;
}

interface VatRow {
  accountId: string;
  code: string;
  name: string;
  role: 'input' | 'output';
  currency: string;
  debit: string;
  credit: string;
  balance: string;
  signedVat: string;
}

interface VatControl {
  from: string;
  to: string;
  accounts: VatRow[];
  totalsByCurrency: { currency: string; outputVat: string; inputVat: string; netVat: string }[];
  notice: string;
  officialReturn: false;
}

const today = () => new Date().toISOString().slice(0, 10);

export default function AccountingControlsPage() {
  const { t, locale } = useI18n();
  const { company } = useSession();
  const L = (fr: string, en: string) => (locale === 'fr' ? fr : en);
  const [params, setParams] = useSearchParams();
  const tab: Tab = params.get('tab') === 'vat' ? 'vat' : 'subledger';
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [asOf, setAsOf] = useState(today());
  const [from, setFrom] = useState(company?.financial_year_start ?? `${new Date().getFullYear()}-01-01`);
  const [to, setTo] = useState(company?.financial_year_end ?? today());
  const [subledger, setSubledger] = useState<SubledgerReport | null>(null);
  const [vat, setVat] = useState<VatControl | null>(null);

  const setTab = (next: Tab) => {
    const copy = new URLSearchParams(params);
    copy.set('tab', next);
    setParams(copy, { replace: true });
  };

  const load = useCallback(async () => {
    if (!company) return;
    setLoading(true);
    setError(null);
    try {
      if (tab === 'subledger') {
        const res = await api.get<SubledgerReport>(
          `/companies/${company.id}/reports/subledger-reconciliation?asOf=${encodeURIComponent(asOf)}`,
        );
        setSubledger(res);
      } else {
        const res = await api.get<VatControl>(
          `/companies/${company.id}/reports/vat-control?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
        );
        setVat(res);
      }
    } catch (err) {
      setError(errorMessage(err, t('common.error')).message);
    } finally {
      setLoading(false);
    }
  }, [company?.id, tab, asOf, from, to, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const statusBadge = (status: ReconciliationRow['status']) => {
    if (status === 'reconciled') return <Badge kind="success">{L('Rapproché', 'Reconciled')}</Badge>;
    if (status === 'explained') return <Badge kind="warning">{L('Écart expliqué', 'Explained difference')}</Badge>;
    return <Badge kind="danger">{L('Écart inexpliqué', 'Unexplained difference')}</Badge>;
  };

  const renderSide = (side: SubledgerSide) => (
    <Card
      key={side.side}
      title={side.side === 'receivable' ? L('Clients (comptes collectifs)', 'Customers (control accounts)') : L('Fournisseurs (comptes collectifs)', 'Suppliers (control accounts)')}
      actions={
        side.controls.hasUnexplainedDifference
          ? <Badge kind="danger">{L('Écart inexpliqué à investiguer', 'Unexplained difference to investigate')}</Badge>
          : side.controls.reconciled
            ? <Badge kind="success">{L('Rapproché', 'Reconciled')}</Badge>
            : <Badge kind="warning">{L('Écart expliqué', 'Explained difference')}</Badge>
      }
    >
      {side.rows.length === 0 ? (
        <EmptyState title={L('Aucun mouvement sur comptes collectifs.', 'No movement on control accounts.')} />
      ) : (
        <>
          <div className="metric-grid">
            {side.totalsByCurrency.map((total) => (
              <div className="metric" key={total.currency}>
                <span className="muted">{total.currency}</span>
                <strong>{money(total.glBalance, locale, total.currency)}</strong>
                <small>{L('Solde grand livre', 'General ledger balance')}</small>
                <small>{L('Écart inexpliqué', 'Unexplained difference')} : {money(total.unexplainedDifference, locale, total.currency)}</small>
              </div>
            ))}
          </div>
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>{L('Compte', 'Account')}</th>
                  <th>{L('Devise', 'Currency')}</th>
                  <th>{L('Solde comptabilisé', 'Posted balance')}</th>
                  <th>{L('Sous-ledger comptabilisé', 'Posted subledger')}</th>
                  <th>{L('Non comptabilisé', 'Unposted')}</th>
                  <th>{L('Sous-ledger total', 'Subledger total')}</th>
                  <th>{L('Écart', 'Difference')}</th>
                  <th>{L('Écart expliqué', 'Explained')}</th>
                  <th>{L('Écart inexpliqué', 'Unexplained')}</th>
                  <th>{t('common.status')}</th>
                </tr>
              </thead>
              <tbody>
                {side.rows.map((row) => (
                  <tr key={`${row.accountId}-${row.currency}`}>
                    <td>{row.accountCode} — {row.accountName}</td>
                    <td>{row.currency}</td>
                    <td>{money(row.glBalance, locale, row.currency)}</td>
                    <td>{money(row.postedSubledger, locale, row.currency)}</td>
                    <td>{money(row.unpostedDocuments, locale, row.currency)}</td>
                    <td>{money(row.subledgerTotal, locale, row.currency)}</td>
                    <td>{money(row.difference, locale, row.currency)}</td>
                    <td>{money(row.explainedDifference, locale, row.currency)}</td>
                    <td><strong>{money(row.unexplainedDifference, locale, row.currency)}</strong></td>
                    <td>{statusBadge(row.status)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted">{side.controls.notice}</p>
          <div className="form-grid">
            <div>
              <h3>{L('Documents non comptabilisés', 'Unposted documents')}</h3>
              {side.unpostedDocuments.length === 0 ? (
                <p className="muted">{L('Aucun document non comptabilisé à cette date.', 'No unposted document at this date.')}</p>
              ) : (
                <ul className="simple-list">
                  {side.unpostedDocuments.map((document) => (
                    <li key={document.id}>
                      {document.number ?? document.id.slice(0, 8)} · {document.partyName} · {document.date} ·{' '}
                      {money(document.amount, locale, document.currency)}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <h3>{L('Règlements non comptabilisés', 'Unposted payments')}</h3>
              {side.unpostedPayments.length === 0 ? (
                <p className="muted">{L('Aucun règlement non comptabilisé à cette date.', 'No unposted payment at this date.')}</p>
              ) : (
                <ul className="simple-list">
                  {side.unpostedPayments.map((payment) => (
                    <li key={payment.id}>
                      {payment.number ?? payment.id.slice(0, 8)} · {payment.partyName} · {payment.date} ·{' '}
                      {money(payment.amount, locale, payment.currency)}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </>
      )}
    </Card>
  );

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>{L('Contrôles comptables', 'Accounting controls')}</h1>
          <p className="muted">
            {L(
              'Rapprochement des comptes collectifs avec le grand livre et contrôle de la TVA comptabilisée. Lecture seule : aucune écriture n’est créée ici.',
              'Control-account reconciliation against the general ledger and review of posted VAT. Read-only: no entry is created here.',
            )}
          </p>
        </div>
      </header>

      {error && <ErrorBanner message={error} />}

      <div className="tabs">
        <button className={tab === 'subledger' ? 'tab active' : 'tab'} onClick={() => setTab('subledger')}>
          {L('Rapprochement clients / fournisseurs ↔ grand livre', 'Customer / supplier reconciliation ↔ general ledger')}
        </button>
        <button className={tab === 'vat' ? 'tab active' : 'tab'} onClick={() => setTab('vat')}>
          {L('Contrôle TVA', 'VAT control')}
        </button>
      </div>

      {tab === 'subledger' && (
        <>
          <div className="page-actions">
            <Field label={L('À la date du', 'As of')}>
              <input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} />
            </Field>
            <Button onClick={() => void load()} disabled={loading}>{t('common.refresh')}</Button>
          </div>
          {loading ? (
            <Spinner label={t('common.loading')} />
          ) : subledger ? (
            <>
              <div className="alert alert-info">
                {L(
                  'Chaque ligne compare le solde comptabilisé du grand livre au sous-ledger. Les éléments non comptabilisés sont listés ; aucun écart n’est forcé à zéro ni masqué.',
                  'Each line compares the posted general-ledger balance with the subledger. Unposted items are listed; no difference is forced to zero or hidden.',
                )}
              </div>
              {subledger.receivable.controls.hasUnexplainedDifference || subledger.payable.controls.hasUnexplainedDifference ? (
                <div className="alert alert-warn">
                  {L(
                    'Au moins un écart inexpliqué subsiste. Il doit être investigué avant la clôture ; il n’est ni arrondi ni neutralisé.',
                    'At least one unexplained difference remains. It must be investigated before closing; it is neither rounded away nor neutralised.',
                  )}
                </div>
              ) : null}
              {renderSide(subledger.receivable)}
              {renderSide(subledger.payable)}
            </>
          ) : null}
        </>
      )}

      {tab === 'vat' && (
        <>
          <div className="page-actions">
            <Field label={L('Du', 'From')}>
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </Field>
            <Field label={L('Au', 'To')}>
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </Field>
            <Button onClick={() => void load()} disabled={loading}>{t('common.refresh')}</Button>
          </div>
          {loading ? (
            <Spinner label={t('common.loading')} />
          ) : vat ? (
            <>
              <div className="alert alert-warn">
                <strong>{L('Ce n’est pas une déclaration officielle MRA.', 'This is not an official MRA return.')}</strong>{' '}
                {vat.notice} {L('Aucun taux, seuil ni case fiscale n’est inventé.', 'No rate, threshold or tax box is invented.')}
              </div>
              {vat.totalsByCurrency.length === 0 ? (
                <EmptyState title={L('Aucun mouvement de TVA comptabilisé sur la période.', 'No posted VAT movement in the period.')} />
              ) : (
                <>
                  <div className="metric-grid">
                    {vat.totalsByCurrency.map((total) => (
                      <div className="metric" key={total.currency}>
                        <span className="muted">{total.currency}</span>
                        <strong>{money(total.netVat, locale, total.currency)}</strong>
                        <small>{L('TVA nette (sortie − entrée)', 'Net VAT (output − input)')}</small>
                        <small>{L('TVA collectée', 'Output VAT')} : {money(total.outputVat, locale, total.currency)}</small>
                        <small>{L('TVA déductible', 'Input VAT')} : {money(total.inputVat, locale, total.currency)}</small>
                      </div>
                    ))}
                  </div>
                  <Card title={L('Détail par compte et par devise', 'Detail by account and currency')}>
                    <div className="table-scroll">
                      <table className="table">
                        <thead>
                          <tr>
                            <th>{L('Compte', 'Account')}</th>
                            <th>{L('Rôle', 'Role')}</th>
                            <th>{L('Devise', 'Currency')}</th>
                            <th>{L('Débit', 'Debit')}</th>
                            <th>{L('Crédit', 'Credit')}</th>
                            <th>{L('Solde', 'Balance')}</th>
                            <th>{L('TVA signée', 'Signed VAT')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {vat.accounts.map((row) => (
                            <tr key={`${row.accountId}-${row.currency}`}>
                              <td>{row.code} — {row.name}</td>
                              <td>{row.role === 'input' ? L('Déductible', 'Input') : L('Collectée', 'Output')}</td>
                              <td>{row.currency}</td>
                              <td>{money(row.debit, locale, row.currency)}</td>
                              <td>{money(row.credit, locale, row.currency)}</td>
                              <td>{money(row.balance, locale, row.currency)}</td>
                              <td>{money(row.signedVat, locale, row.currency)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <p className="muted">
                      {L(
                        'Les montants ne sont jamais additionnés entre devises. La TVA signée est positive lorsque la société doit de la TVA collectée et négative lorsqu’elle dispose d’un solde déductible.',
                        'Amounts are never added across currencies. Signed VAT is positive when output VAT is owed and negative when an input balance is recoverable.',
                      )}
                    </p>
                  </Card>
                </>
              )}
            </>
          ) : null}
        </>
      )}
    </div>
  );
}
