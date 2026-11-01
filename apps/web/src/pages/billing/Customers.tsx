import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../../api';
import { useI18n } from '../../i18n';
import { errorMessage, useSession } from '../../store';
import { Badge, Button, Card, EmptyState, ErrorBanner, Field, Modal, Spinner } from '../../components/ui';
import { money } from '../../format';
import type { Customer } from './types';

interface Balance {
  currency: string;
  invoiced: string;
  paid: string;
  credited: string;
  outstanding: string;
  unallocated: string;
  balance: string;
  asOf?: string;
  /** One entry per currency: amounts are never added across currencies. */
  balances?: Balance[];
}

interface HistoryDocument {
  id: string;
  kind: string;
  number: string | null;
  status: string;
  issueDate: string;
  total: string;
  outstanding: string;
}

export default function BillingCustomersPage() {
  const { t, locale } = useI18n();
  const { company } = useSession();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [includeArchived, setIncludeArchived] = useState(false);

  const [open, setOpen] = useState(false);
  const [duplicate, setDuplicate] = useState(false);
  const [form, setForm] = useState({
    name: '',
    brn: '',
    contactEmail: '',
    city: '',
    paymentTermsDays: '30',
    notes: '',
  });

  const [detail, setDetail] = useState<Customer | null>(null);
  const [balance, setBalance] = useState<Balance | null>(null);
  const [documents, setDocuments] = useState<HistoryDocument[]>([]);

  const load = useCallback(async () => {
    if (!company) return;
    setLoading(true);
    try {
      const res = await api.get<{ customers: Customer[] }>(
        `/companies/${company.id}/billing/customers?includeArchived=${includeArchived ? 'true' : 'false'}${
          search ? `&search=${encodeURIComponent(search)}` : ''
        }`,
      );
      setCustomers(res.customers);
      setError(null);
    } catch (err) {
      setError(errorMessage(err, t('common.error')).message);
    } finally {
      setLoading(false);
    }
  }, [company?.id, includeArchived, search, t]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!company) return <EmptyState title={t('dashboard.noCompanyHelp')} />;

  const openDetail = async (customer: Customer) => {
    setDetail(customer);
    setBalance(null);
    setDocuments([]);
    try {
      const [b, h] = await Promise.all([
        api.get<{ balance: Balance }>(
          `/companies/${company.id}/billing/customers/${customer.id}/balance?asOf=${new Date().toISOString().slice(0, 10)}`,
        ),
        api.get<{ documents: HistoryDocument[] }>(
          `/companies/${company.id}/billing/customers/${customer.id}/history`,
        ),
      ]);
      setBalance(b.balance);
      setDocuments(h.documents);
    } catch (err) {
      setError(errorMessage(err, t('common.error')).message);
    }
  };

  const create = async (confirmDuplicate = false) => {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/companies/${company.id}/billing/customers`, {
        name: form.name,
        ...(form.brn ? { brn: form.brn } : {}),
        ...(form.contactEmail ? { contactEmail: form.contactEmail } : {}),
        ...(form.city ? { city: form.city } : {}),
        ...(form.paymentTermsDays ? { paymentTermsDays: Number(form.paymentTermsDays) } : {}),
        ...(form.notes ? { notes: form.notes } : {}),
        ...(confirmDuplicate ? { confirmDuplicate: true } : {}),
      });
      setOpen(false);
      setDuplicate(false);
      setForm({ name: '', brn: '', contactEmail: '', city: '', paymentTermsDays: '30', notes: '' });
      await load();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'CUSTOMER_DUPLICATE') {
        setDuplicate(true);
        setError(t('billing.customers.duplicate'));
      } else {
        setError(errorMessage(err, t('common.error')).message);
      }
    } finally {
      setBusy(false);
    }
  };

  const archive = async (customer: Customer) => {
    if (!window.confirm(t('billing.customers.archiveConfirm'))) return;
    setBusy(true);
    try {
      await api.del(`/companies/${company.id}/billing/customers/${customer.id}`);
      await load();
    } catch (err) {
      setError(errorMessage(err, t('common.error')).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="page-head">
        <div className="grow">
          <h1>{t('nav.billing.customers')}</h1>
          <div className="page-sub">{t('billing.customers.sub')}</div>
        </div>
        <Button variant="primary" onClick={() => setOpen(true)}>
          {t('common.add')}
        </Button>
      </div>

      <ErrorBanner message={error} />

      <Card>
        <div className="filters">
          <Field label={t('common.search')}>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('billing.customers.searchPlaceholder')} />
          </Field>
          <label className="inline">
            <input
              type="checkbox"
              checked={includeArchived}
              onChange={(e) => setIncludeArchived(e.target.checked)}
            />
            {t('billing.customers.showArchived')}
          </label>
        </div>
        {loading ? (
          <Spinner label={t('common.loading')} />
        ) : customers.length === 0 ? (
          <EmptyState title={t('billing.customers.empty')} />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t('common.name')}</th>
                  <th>BRN</th>
                  <th>{t('billing.customers.terms')}</th>
                  <th className="num">{t('billing.customers.outstanding')}</th>
                  <th>{t('common.status')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {customers.map((c) => (
                  <tr key={c.id}>
                    <td>
                      {c.name}
                      {c.city && <div className="page-sub">{c.city}</div>}
                    </td>
                    <td className="mono">{c.brn ?? '—'}</td>
                    <td>{c.paymentTermsDays === null ? '—' : `${c.paymentTermsDays} j`}</td>
                    <td className="num">—</td>
                    <td>
                      <Badge kind={c.isActive ? 'success' : 'neutral'}>
                        {c.isActive ? t('common.active') : t('billing.customers.archived')}
                      </Badge>
                    </td>
                    <td className="row-actions">
                      <Button variant="ghost" onClick={() => void openDetail(c)}>
                        {t('billing.customers.balance')}
                      </Button>
                      {c.isActive && (
                        <Button variant="ghost" onClick={() => void archive(c)} disabled={busy}>
                          {t('billing.customers.archive')}
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

      <Modal open={open} title={t('billing.customers.new')} onClose={() => setOpen(false)}>
        <div className="form-grid">
          <Field label={t('common.name')}>
            <input
              value={form.name}
              onChange={(e) => {
                setForm({ ...form, name: e.target.value });
                setDuplicate(false);
              }}
              required
            />
          </Field>
          <Field label="BRN">
            <input value={form.brn} onChange={(e) => setForm({ ...form, brn: e.target.value })} />
          </Field>
          <Field label={t('billing.customers.email')}>
            <input
              type="email"
              value={form.contactEmail}
              onChange={(e) => setForm({ ...form, contactEmail: e.target.value })}
            />
          </Field>
          <Field label={t('billing.customers.city')}>
            <input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
          </Field>
          <Field label={t('billing.customers.terms')}>
            <input
              inputMode="numeric"
              value={form.paymentTermsDays}
              onChange={(e) => setForm({ ...form, paymentTermsDays: e.target.value })}
            />
          </Field>
          <Field label={t('billing.customers.notes')}>
            <input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </Field>
        </div>
        <p className="muted">{t('billing.customers.isolation')}</p>
        <div className="modal-actions">
          <Button variant="ghost" onClick={() => setOpen(false)}>
            {t('common.cancel')}
          </Button>
          {duplicate && (
            <Button variant="ghost" onClick={() => void create(true)} disabled={busy}>
              {t('billing.customers.confirmHomonym')}
            </Button>
          )}
          <Button variant="primary" onClick={() => void create(false)} disabled={busy || !form.name.trim()}>
            {t('common.create')}
          </Button>
        </div>
      </Modal>

      <Modal open={detail !== null} title={detail?.name ?? ''} onClose={() => setDetail(null)} wide>
        {balance ? (
          (balance.balances && balance.balances.length > 0 ? balance.balances : [balance]).map((currencyBalance, index) => (
            <div key={`${currencyBalance.currency}-${index}`} style={{ marginBottom: 16 }}>
              {(balance.balances?.length ?? 0) > 1 && (
                <h3 style={{ margin: '0 0 8px' }}>{currencyBalance.currency}</h3>
              )}
              <div className="kpi-grid">
                <div className="kpi">
                  <div className="kpi-label">{t('billing.customers.invoiced')}</div>
                  <div className="kpi-value">{money(currencyBalance.invoiced, locale, currencyBalance.currency)}</div>
                </div>
                <div className="kpi">
                  <div className="kpi-label">{t('billing.customers.paid')}</div>
                  <div className="kpi-value positive">{money(currencyBalance.paid, locale, currencyBalance.currency)}</div>
                </div>
                <div className="kpi">
                  <div className="kpi-label">{t('billing.customers.credited')}</div>
                  <div className="kpi-value">{money(currencyBalance.credited, locale, currencyBalance.currency)}</div>
                </div>
                <div className="kpi">
                  <div className="kpi-label">{t('billing.customers.outstanding')}</div>
                  <div className={`kpi-value ${money(currencyBalance.outstanding, locale, currencyBalance.currency) !== '0,00' ? 'negative' : 'positive'}`}>
                    {money(currencyBalance.outstanding, locale, currencyBalance.currency)}
                  </div>
                </div>
                <div className="kpi">
                  <div className="kpi-label">{t('billing.customers.unallocated')}</div>
                  <div className="kpi-value">{money(currencyBalance.unallocated, locale, currencyBalance.currency)}</div>
                </div>
              </div>
            </div>
          ))
        ) : (
          <Spinner label={t('common.loading')} />
        )}
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t('common.reference')}</th>
                <th>{t('common.date')}</th>
                <th>{t('common.total')}</th>
                <th>{t('billing.customers.outstanding')}</th>
                <th>{t('common.status')}</th>
              </tr>
            </thead>
            <tbody>
              {documents.map((d) => (
                <tr key={d.id}>
                  <td className="mono">{d.number ?? '—'}</td>
                  <td>{d.issueDate}</td>
                  <td className="num">{money(d.total, locale)}</td>
                  <td className="num">{money(d.outstanding, locale)}</td>
                  <td>
                    <Badge>{d.status}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Modal>
    </>
  );
}
