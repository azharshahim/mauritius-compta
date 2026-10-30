import { useState } from 'react';
import { api, downloadExport, qs } from '../api';
import { useI18n } from '../i18n';
import { useSession } from '../store';
import { useAsync } from '../hooks';
import { Badge, Button, Card, DemoNotice, EmptyState, ErrorBanner, Spinner } from '../components/ui';
import { money } from '../format';

interface TrialBalanceResponse {
  from: string;
  to: string;
  currency: string;
  balanced: boolean;
  rows: {
    accountId: string;
    code: string;
    name: string;
    type: string;
    openingDebit: string;
    openingCredit: string;
    movementDebit: string;
    movementCredit: string;
    closingDebit: string;
    closingCredit: string;
  }[];
  totals: Record<string, string>;
}

export default function TrialBalancePage() {
  const { t, locale } = useI18n();
  const { company } = useSession();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const { data, loading, error } = useAsync<TrialBalanceResponse | null>(
    () =>
      company
        ? api.get<TrialBalanceResponse>(
            `/companies/${company.id}/reports/trial-balance${qs({ from, to })}`,
          )
        : Promise.resolve(null),
    [company?.id, from, to],
  );

  if (!company) return <EmptyState title={t('dashboard.noCompanyHelp')} />;
  const exportPath = `/companies/${company.id}/reports/trial-balance${qs({ from, to })}`;

  return (
    <>
      <div className="page-head">
        <div className="grow">
          <h1>{t('tb.title')}</h1>
          <div className="page-sub">
            {data?.from ?? company.financial_year_start} → {data?.to ?? company.financial_year_end} ·{' '}
            {company.functional_currency}
          </div>
        </div>
        <Button onClick={() => void downloadExport(exportPath, 'trial-balance.csv', 'csv')}>
          {t('common.exportCsv')}
        </Button>
        <Button onClick={() => void downloadExport(exportPath, 'trial-balance.pdf', 'pdf')}>
          {t('common.exportPdf')}
        </Button>
      </div>
      <DemoNotice />

      <Card>
        <div className="form-row" style={{ marginBottom: 12 }}>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={{ maxWidth: 170 }} aria-label={t('common.from')} />
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={{ maxWidth: 170 }} aria-label={t('common.to')} />
        </div>
        <ErrorBanner message={error} />
        {loading ? (
          <Spinner />
        ) : (data?.rows.length ?? 0) === 0 ? (
          <EmptyState title={t('tb.empty')} />
        ) : (
          <>
            <div style={{ marginBottom: 10 }}>
              <Badge kind={data?.balanced ? 'success' : 'danger'}>
                {data?.balanced ? t('tb.balanced') : t('tb.unbalanced')}
              </Badge>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{t('common.code')}</th>
                    <th>{t('common.account')}</th>
                    <th className="num">{t('tb.openingDebit')}</th>
                    <th className="num">{t('tb.openingCredit')}</th>
                    <th className="num">{t('tb.movementDebit')}</th>
                    <th className="num">{t('tb.movementCredit')}</th>
                    <th className="num">{t('tb.closingDebit')}</th>
                    <th className="num">{t('tb.closingCredit')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data?.rows.map((r) => (
                    <tr key={r.accountId}>
                      <td className="mono">{r.code}</td>
                      <td>{r.name}</td>
                      <td className="num">{r.openingDebit !== '0.0000' ? money(r.openingDebit, locale) : ''}</td>
                      <td className="num">{r.openingCredit !== '0.0000' ? money(r.openingCredit, locale) : ''}</td>
                      <td className="num">{money(r.movementDebit, locale)}</td>
                      <td className="num">{money(r.movementCredit, locale)}</td>
                      <td className="num">{money(r.closingDebit, locale)}</td>
                      <td className="num">{money(r.closingCredit, locale)}</td>
                    </tr>
                  ))}
                  <tr className="total-row">
                    <td colSpan={2}>{t('common.total')}</td>
                    <td className="num">{money(data?.totals.openingDebit ?? '0', locale)}</td>
                    <td className="num">{money(data?.totals.openingCredit ?? '0', locale)}</td>
                    <td className="num">{money(data?.totals.movementDebit ?? '0', locale)}</td>
                    <td className="num">{money(data?.totals.movementCredit ?? '0', locale)}</td>
                    <td className="num">{money(data?.totals.closingDebit ?? '0', locale)}</td>
                    <td className="num">{money(data?.totals.closingCredit ?? '0', locale)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>
    </>
  );
}
