import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api';
import { useI18n } from '../../i18n';
import { errorMessage, useSession } from '../../store';
import { Badge, Card, EmptyState, ErrorBanner, Spinner } from '../../components/ui';
import { money } from '../../format';
import type { BillingSettings } from './types';

interface Summary {
  counts: { kind: string; status: string; count: number }[];
  openReceivables: string;
  aging: Record<'current' | 'days1to30' | 'days31to60' | 'days61to90' | 'over90' | 'total', string>;
  postedDocuments: number;
  payments: { count: number; unallocated: string };
  capabilities: BillingSettings['capabilities'];
  currency: string;
}

export default function BillingOverviewPage() {
  const { t, locale } = useI18n();
  const { company } = useSession();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!company) return;
    setLoading(true);
    try {
      const res = await api.get<Summary>(`/companies/${company.id}/billing/summary`);
      setSummary(res);
      setError(null);
    } catch (err) {
      setError(errorMessage(err, t('common.error')).message);
    } finally {
      setLoading(false);
    }
  }, [company?.id, t]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!company) return <EmptyState title={t('dashboard.noCompanyHelp')} />;
  if (loading && !summary) return <Spinner label={t('common.loading')} />;

  return (
    <>
      <div className="page-head">
        <div className="grow">
          <h1>{t('module.billing')}</h1>
          <div className="page-sub">{t('billing.sub')}</div>
        </div>
      </div>
      <ErrorBanner message={error} />
      {summary && (
        <>
          <div className="kpi-grid">
            <div className="kpi">
              <div className="kpi-label">{t('billing.summary.openReceivables')}</div>
              <div className={`kpi-value ${Number(summary.openReceivables) > 0 ? 'negative' : 'positive'}`}>
                {money(summary.openReceivables, locale, summary.currency)}
              </div>
            </div>
            <div className="kpi">
              <div className="kpi-label">{t('billing.summary.posted')}</div>
              <div className="kpi-value">{summary.postedDocuments}</div>
            </div>
            <div className="kpi">
              <div className="kpi-label">{t('billing.summary.payments')}</div>
              <div className="kpi-value">{summary.payments.count}</div>
            </div>
            <div className="kpi">
              <div className="kpi-label">{t('billing.payments.unallocated')}</div>
              <div className="kpi-value">{money(summary.payments.unallocated, locale, summary.currency)}</div>
            </div>
          </div>

          <Card title={t('billing.aging.title')}>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{t('billing.aging.current')}</th>
                    <th className="num">1–30</th>
                    <th className="num">31–60</th>
                    <th className="num">61–90</th>
                    <th className="num">90+</th>
                    <th className="num">{t('common.total')}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="num">{money(summary.aging.current, locale)}</td>
                    <td className="num">{money(summary.aging.days1to30, locale)}</td>
                    <td className="num">{money(summary.aging.days31to60, locale)}</td>
                    <td className="num">{money(summary.aging.days61to90, locale)}</td>
                    <td className="num">{money(summary.aging.over90, locale)}</td>
                    <td className="num">
                      <strong>{money(summary.aging.total, locale)}</strong>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </Card>

          <div className="grid grid-2">
            <Card title={t('billing.summary.counts')}>
              <ul className="plain-list">
                {summary.counts.map((c) => (
                  <li key={`${c.kind}-${c.status}`}>
                    <span className="mono">{c.kind}</span> · {c.status} — <strong>{c.count}</strong>
                  </li>
                ))}
              </ul>
            </Card>
            <Card title={t('billing.summary.capabilities')}>
              <ul className="capability-list">
                <li>
                  <Badge kind={summary.capabilities.sequentialNumbering ? 'success' : 'warning'}>
                    {t('billing.cap.numbering')}
                  </Badge>
                </li>
                <li>
                  <Badge kind={summary.capabilities.postingToAccounting ? 'success' : 'warning'}>
                    {t('billing.cap.posting')}
                  </Badge>
                </li>
                <li>
                  <Badge kind="warning">{t('billing.cap.vat')}</Badge>
                  <span className="page-sub">
                    {summary.capabilities.vatComputation
                      ? t('billing.cap.vatOn')
                      : t('billing.cap.vatOff')}
                  </span>
                </li>
                <li>
                  <Badge kind="danger">{t('billing.cap.eInvoicing')}</Badge>
                  <span className="page-sub">{summary.capabilities.eInvoicingNotice}</span>
                </li>
                <li>
                  <Badge>{t('billing.cap.pdf')}</Badge>
                  <span className="page-sub">
                    {summary.capabilities.pdf ? t('billing.cap.pdfOn') : t('billing.cap.pdfOff')}
                  </span>
                </li>
              </ul>
            </Card>
          </div>
        </>
      )}
    </>
  );
}
