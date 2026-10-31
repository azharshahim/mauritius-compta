import { Link } from 'react-router-dom';
import { api } from '../api';
import { useI18n } from '../i18n';
import { useSession } from '../store';
import { useAsync } from '../hooks';
import { Badge, Card, DemoNotice, EmptyState, ErrorBanner, Spinner } from '../components/ui';
import { date, money } from '../format';

interface DashboardData {
  kpis: {
    accounts: number;
    journals: number;
    draftEntries: number;
    postedEntries: number;
    revenue: string;
    expenses: string;
    profit: string;
    balancedSheet: boolean;
    currency: string;
    totalAssets: string;
  };
  recentEntries: {
    id: string;
    entry_no: string;
    entry_date: string;
    description: string;
    status: 'draft' | 'posted';
    journal_code: string;
    total_debit: string;
  }[];
  range: { from: string; to: string };
}

export default function DashboardPage() {
  const { t, locale } = useI18n();
  const { company } = useSession();
  const { data, loading, error } = useAsync<DashboardData | null>(
    () => (company ? api.get<DashboardData>(`/companies/${company.id}/dashboard`) : Promise.resolve(null)),
    [company?.id],
  );

  if (!company) {
    return (
      <Card title={t('dashboard.noCompany')}>
        <EmptyState title={t('dashboard.noCompanyHelp')}>
          <Link className="btn btn-primary" to="/companies" style={{ display: 'inline-block', marginTop: 12 }}>
            {t('dashboard.createCompany')}
          </Link>
        </EmptyState>
      </Card>
    );
  }

  if (loading) return <Spinner label={t('common.loading')} />;

  return (
    <>
      <div className="page-head">
        <div className="grow">
          <h1>{t('dashboard.title')}</h1>
          <div className="page-sub">
            {company.name} · {data?.range.from} → {data?.range.to} · {company.functional_currency}
          </div>
        </div>
      </div>
      <DemoNotice />
      <ErrorBanner message={error} />
      {data && (
        <>
          <div className={`alert ${data.kpis.balancedSheet ? 'alert-success' : 'alert-error'}`}>
            {data.kpis.balancedSheet ? t('dashboard.balanceOk') : t('dashboard.balanceKo')}
          </div>
          <div className="grid grid-4" style={{ marginBottom: 16 }}>
            <div className="kpi">
              <div className="kpi-label">{t('dashboard.revenue')}</div>
              <div className="kpi-value positive">
                {money(data.kpis.revenue, locale, data.kpis.currency)}
              </div>
            </div>
            <div className="kpi">
              <div className="kpi-label">{t('dashboard.expenses')}</div>
              <div className="kpi-value negative">
                {money(data.kpis.expenses, locale, data.kpis.currency)}
              </div>
            </div>
            <div className="kpi">
              <div className="kpi-label">{t('dashboard.profit')}</div>
              <div className="kpi-value">{money(data.kpis.profit, locale, data.kpis.currency)}</div>
            </div>
            <div className="kpi">
              <div className="kpi-label">{t('st.totalAssets')}</div>
              <div className="kpi-value">{money(data.kpis.totalAssets, locale, data.kpis.currency)}</div>
            </div>
            <div className="kpi">
              <div className="kpi-label">{t('dashboard.posted')}</div>
              <div className="kpi-value">{data.kpis.postedEntries}</div>
            </div>
            <div className="kpi">
              <div className="kpi-label">{t('dashboard.drafts')}</div>
              <div className="kpi-value">{data.kpis.draftEntries}</div>
            </div>
            <div className="kpi">
              <div className="kpi-label">{t('dashboard.accounts')}</div>
              <div className="kpi-value">{data.kpis.accounts}</div>
            </div>
            <div className="kpi">
              <div className="kpi-label">{t('entries.journal')}</div>
              <div className="kpi-value">{data.kpis.journals}</div>
            </div>
          </div>

          <Card
            title={t('dashboard.recent')}
            actions={
              <Link className="btn" to="/entries">
                {t('entries.title')}
              </Link>
            }
          >
            {data.recentEntries.length === 0 ? (
              <EmptyState title={t('tb.empty')} />
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>{t('entries.entryNo')}</th>
                      <th>{t('common.date')}</th>
                      <th>{t('common.description')}</th>
                      <th>{t('entries.journal')}</th>
                      <th className="num">{t('common.amount')}</th>
                      <th>{t('entries.status')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.recentEntries.map((e) => (
                      <tr key={e.id}>
                        <td className="mono">{e.entry_no}</td>
                        <td>{date(e.entry_date, locale)}</td>
                        <td>{e.description}</td>
                        <td>{e.journal_code}</td>
                        <td className="num">{money(e.total_debit, locale, company.functional_currency)}</td>
                        <td>
                          <Badge kind={e.status === 'posted' ? 'success' : 'warning'}>
                            {e.status === 'posted' ? t('entries.posted') : t('entries.draft')}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </>
  );
}
