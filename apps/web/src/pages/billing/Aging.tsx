import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api';
import { useI18n } from '../../i18n';
import { errorMessage, useSession } from '../../store';
import { Button, Card, EmptyState, ErrorBanner, Field, Spinner } from '../../components/ui';
import { money } from '../../format';

interface AgingRow {
  customerId: string;
  customerName: string;
  currency: string;
  invoiceCount: number;
  buckets: { current: string; days1to30: string; days31to60: string; days61to90: string; over90: string; total: string };
}

interface AgingResponse {
  asOf: string;
  rows: AgingRow[];
  /** Null as soon as two currencies are present: no cross-currency total. */
  totals: AgingRow['buckets'] | null;
  totalsByCurrency: { currency: string; buckets: AgingRow['buckets'] }[];
}

export default function BillingAgingPage() {
  const { t, locale } = useI18n();
  const { company } = useSession();
  const [data, setData] = useState<AgingResponse | null>(null);
  const [asOf, setAsOf] = useState(new Date().toISOString().slice(0, 10));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!company) return;
    setLoading(true);
    try {
      const res = await api.get<AgingResponse>(`/companies/${company.id}/billing/aging?asOf=${asOf}`);
      setData(res);
      setError(null);
    } catch (err) {
      setError(errorMessage(err, t('common.error')).message);
    } finally {
      setLoading(false);
    }
  }, [company?.id, asOf, t]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!company) return <EmptyState title={t('dashboard.noCompanyHelp')} />;

  return (
    <>
      <div className="page-head">
        <div className="grow">
          <h1>{t('billing.aging.title')}</h1>
          <div className="page-sub">{t('billing.aging.sub')}</div>
        </div>
        <Button variant="ghost" onClick={() => void load()}>
          {t('common.refresh')}
        </Button>
      </div>
      <ErrorBanner message={error} />

      <Card>
        <div className="filters">
          <Field label={t('billing.aging.asOf')}>
            <input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} />
          </Field>
        </div>
        {loading && !data ? (
          <Spinner label={t('common.loading')} />
        ) : !data || data.rows.length === 0 ? (
          <EmptyState title={t('billing.aging.empty')} />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t('billing.documents.customer')}</th>
                  <th>{t('common.currency')}</th>
                  <th className="num">{t('billing.aging.current')}</th>
                  <th className="num">1–30</th>
                  <th className="num">31–60</th>
                  <th className="num">61–90</th>
                  <th className="num">90+</th>
                  <th className="num">{t('common.total')}</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row) => (
                  <tr key={row.customerId}>
                    <td>
                      {row.customerName}
                      <div className="page-sub">
                        {row.invoiceCount} {t('billing.aging.invoices')}
                      </div>
                    </td>
                    <td>{row.currency}</td>
                    <td className="num">{money(row.buckets.current, locale, row.currency)}</td>
                    <td className="num">{money(row.buckets.days1to30, locale, row.currency)}</td>
                    <td className="num">{money(row.buckets.days31to60, locale, row.currency)}</td>
                    <td className="num">{money(row.buckets.days61to90, locale, row.currency)}</td>
                    <td className="num">{money(row.buckets.over90, locale, row.currency)}</td>
                    <td className="num">
                      <strong>{money(row.buckets.total, locale, row.currency)}</strong>
                    </td>
                  </tr>
                ))}
                {(data.totalsByCurrency ?? []).map((total) => (
                  <tr key={`total-${total.currency}`}>
                    <td>
                      <strong>{t('common.total')}</strong>
                    </td>
                    <td>{total.currency}</td>
                    <td className="num">{money(total.buckets.current, locale, total.currency)}</td>
                    <td className="num">{money(total.buckets.days1to30, locale, total.currency)}</td>
                    <td className="num">{money(total.buckets.days31to60, locale, total.currency)}</td>
                    <td className="num">{money(total.buckets.days61to90, locale, total.currency)}</td>
                    <td className="num">{money(total.buckets.over90, locale, total.currency)}</td>
                    <td className="num">
                      <strong>{money(total.buckets.total, locale, total.currency)}</strong>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="muted">{t('billing.aging.hint')}</p>
      </Card>
    </>
  );
}
