import { useState } from 'react';
import { api, downloadExport, qs } from '../api';
import { useI18n } from '../i18n';
import { useSession } from '../store';
import { useAsync } from '../hooks';
import { Badge, Button, Card, DemoNotice, EmptyState, ErrorBanner, Spinner } from '../components/ui';
import { money } from '../format';

interface Line {
  accountId: string;
  code: string;
  name: string;
  amount: string;
}

interface Group {
  key: string;
  lines: Line[];
  total: string;
}

interface StatementsResponse {
  from: string;
  to: string;
  currency: string;
  profitAndLoss: { revenue: Group; expenses: Group; profit: string };
  financialPosition: {
    assets: Group;
    liabilities: Group;
    equity: Group;
    unappropriatedResult: string;
    totalAssets: string;
    totalLiabilitiesAndEquity: string;
    balanced: boolean;
  };
}

function Section({
  title,
  group,
  locale,
}: {
  title: string;
  group: Group;
  locale: 'fr' | 'en';
}) {
  return (
    <>
      <tr>
        <th colSpan={2} style={{ background: '#eef4fb' }}>
          {title}
        </th>
      </tr>
      {group.lines.map((l) => (
        <tr key={l.accountId}>
          <td>
            <span className="mono">{l.code}</span> — {l.name}
          </td>
          <td className="num">{money(l.amount, locale)}</td>
        </tr>
      ))}
      {group.lines.length === 0 && (
        <tr>
          <td colSpan={2} className="page-sub">
            —
          </td>
        </tr>
      )}
      <tr className="total-row">
        <td>{title}</td>
        <td className="num">{money(group.total, locale)}</td>
      </tr>
    </>
  );
}

export type StatementsView = 'balance-sheet' | 'profit-loss';

export default function StatementsPage({ view }: { view?: StatementsView } = {}) {
  const { t, locale } = useI18n();
  const { company } = useSession();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const { data, loading, error } = useAsync<StatementsResponse | null>(
    () =>
      company
        ? api.get<StatementsResponse>(`/companies/${company.id}/reports/statements${qs({ from, to })}`)
        : Promise.resolve(null),
    [company?.id, from, to],
  );

  if (!company) return <EmptyState title={t('dashboard.noCompanyHelp')} />;
  const exportPath = `/companies/${company.id}/reports/statements${qs({ from, to })}`;

  return (
    <>
      <div className="page-head">
        <div className="grow">
          <h1>{view === 'balance-sheet' ? t('nav.reports.balanceSheet') : view === 'profit-loss' ? t('nav.reports.profitLoss') : t('st.title')}</h1>
          <div className="page-sub">
            {data?.from ?? company.financial_year_start} → {data?.to ?? company.financial_year_end} ·{' '}
            {company.presentation_currency}
          </div>
        </div>
        <Button onClick={() => void downloadExport(exportPath, 'statements.csv', 'csv')}>
          {t('common.exportCsv')}
        </Button>
        <Button onClick={() => void downloadExport(exportPath, 'statements.pdf', 'pdf')}>
          {t('common.exportPdf')}
        </Button>
      </div>
      <DemoNotice />
      <div className="alert alert-warn">{t('st.disclaimer')}</div>

      <Card>
        <div className="form-row" style={{ marginBottom: 12 }}>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={{ maxWidth: 170 }} aria-label={t('common.from')} />
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={{ maxWidth: 170 }} aria-label={t('common.to')} />
        </div>
        <ErrorBanner message={error} />
        {loading ? (
          <Spinner />
        ) : (
          data && (
            <div className={view ? '' : 'grid grid-2'}>
              {view !== 'balance-sheet' && (
              <div>
                <h2 style={{ marginBottom: 8 }}>{t('st.pl')}</h2>
                <div className="table-wrap">
                  <table>
                    <tbody>
                      <Section title={t('st.revenue')} group={data.profitAndLoss.revenue} locale={locale} />
                      <Section title={t('st.expenses')} group={data.profitAndLoss.expenses} locale={locale} />
                      <tr className="total-row">
                        <td>{t('st.profit')}</td>
                        <td className="num">{money(data.profitAndLoss.profit, locale, data.currency)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
              )}
              {view !== 'profit-loss' && (
              <div>
                <h2 style={{ marginBottom: 8 }}>{t('st.sofp')}</h2>
                <div style={{ marginBottom: 8 }}>
                  <Badge kind={data.financialPosition.balanced ? 'success' : 'danger'}>
                    {data.financialPosition.balanced ? t('st.balanced') : t('st.unbalanced')}
                  </Badge>
                </div>
                <div className="table-wrap">
                  <table>
                    <tbody>
                      <Section title={t('st.assets')} group={data.financialPosition.assets} locale={locale} />
                      <tr className="total-row">
                        <td>{t('st.totalAssets')}</td>
                        <td className="num">{money(data.financialPosition.totalAssets, locale, data.currency)}</td>
                      </tr>
                      <Section
                        title={t('st.liabilities')}
                        group={data.financialPosition.liabilities}
                        locale={locale}
                      />
                      <Section title={t('st.equity')} group={data.financialPosition.equity} locale={locale} />
                      <tr>
                        <td>{t('st.unappropriated')}</td>
                        <td className="num">{money(data.financialPosition.unappropriatedResult, locale)}</td>
                      </tr>
                      <tr className="total-row">
                        <td>{t('st.totalLiabilitiesEquity')}</td>
                        <td className="num">
                          {money(data.financialPosition.totalLiabilitiesAndEquity, locale, data.currency)}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
              )}
            </div>
          )
        )}
      </Card>
    </>
  );
}
