import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../../api';
import { useI18n } from '../../i18n';
import { errorMessage, useSession } from '../../store';
import { Badge, Button, Card, EmptyState, ErrorBanner, Field, Modal, Spinner } from '../../components/ui';
import { money, scaled4ToString, toScaled4 } from '../../format';
import type { BillingDocument, Customer, Payment } from './types';
import { PAYMENT_METHODS } from './types';

export default function BillingPaymentsPage() {
  const { t, locale } = useI18n();
  const { company } = useSession();
  const [searchParams] = useSearchParams();
  const [search, setSearch] = useState(() => searchParams.get('search') ?? '');
  const [payments, setPayments] = useState<Payment[]>([]);
  const [documents, setDocuments] = useState<BillingDocument[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    customerId: '',
    paymentDate: new Date().toISOString().slice(0, 10),
    amount: '',
    method: 'bank_transfer',
    reference: '',
  });
  const [allocations, setAllocations] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    if (!company) return;
    setLoading(true);
    try {
      const [paymentRes, docRes, customerRes] = await Promise.all([
        api.get<{ payments: Payment[] }>(`/companies/${company.id}/billing/payments`),
        api.get<{ documents: BillingDocument[] }>(
          `/companies/${company.id}/billing/documents?kind=invoice`,
        ),
        api.get<{ customers: Customer[] }>(`/companies/${company.id}/billing/customers`),
      ]);
      setPayments(paymentRes.payments);
      setDocuments(docRes.documents.filter((d) => ['issued', 'partially_paid'].includes(d.status)));
      setCustomers(customerRes.customers.filter((c) => c.isActive));
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

  const customerInvoices = useMemo(
    () => documents.filter((d) => d.customerId === form.customerId),
    [documents, form.customerId],
  );

  const visiblePayments = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return payments;
    return payments.filter((p) =>
      [p.number, p.reference, p.paymentDate, p.method, ...p.allocations.map((a) => a.invoiceNumber)]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle)),
    );
  }, [payments, search]);

  const allocatedTotal = Object.entries(allocations).reduce((acc, [, value]) => acc + (toScaled4(value) ?? 0n), 0n);
  const received = toScaled4(form.amount) ?? 0n;
  const unallocated = received - allocatedTotal;

  if (!company) return <EmptyState title={t('dashboard.noCompanyHelp')} />;

  const startCreate = () => {
    setForm({
      customerId: customers[0]?.id ?? '',
      paymentDate: new Date().toISOString().slice(0, 10),
      amount: '',
      method: 'bank_transfer',
      reference: '',
    });
    setAllocations({});
    setError(null);
    setNotice(null);
    setOpen(true);
  };

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ payment: Payment; warnings: string[]; entryCreated: boolean }>(
        `/companies/${company.id}/billing/payments`,
        {
          customerId: form.customerId,
          paymentDate: form.paymentDate,
          amount: form.amount,
          method: form.method,
          ...(form.reference ? { reference: form.reference } : {}),
          allocations: Object.entries(allocations)
            .filter(([, value]) => (toScaled4(value) ?? 0n) > 0n)
            .map(([invoiceId, value]) => ({ invoiceId, amount: value })),
        },
      );
      setOpen(false);
      setNotice(
        `${t('billing.payments.created')} ${res.payment.number ?? ''} — ${t('billing.payments.unallocated')} ${money(
          res.payment.unallocatedAmount,
          locale,
          res.payment.currency,
        )}`,
      );
      await load();
    } catch (err) {
      setError(errorMessage(err, t('common.error')).message);
    } finally {
      setBusy(false);
    }
  };

  const cancel = async (payment: Payment) => {
    if (!window.confirm(t('billing.payments.cancelConfirm'))) return;
    setBusy(true);
    try {
      await api.post(`/companies/${company.id}/billing/payments/${payment.id}/cancel`);
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
          <h1>{t('nav.billing.payments')}</h1>
          <div className="page-sub">{t('billing.payments.sub')}</div>
        </div>
        <Button variant="primary" onClick={startCreate}>
          {t('common.add')}
        </Button>
      </div>

      {notice && <div className="alert alert-info">{notice}</div>}
      <ErrorBanner message={error} />

      <Card>
        <div className="lettering-filters">
          <Field label={t('common.search')}>
            <input value={search} onChange={(e) => setSearch(e.target.value)} />
          </Field>
        </div>
        {loading ? (
          <Spinner label={t('common.loading')} />
        ) : visiblePayments.length === 0 ? (
          <EmptyState title={t('billing.payments.empty')} />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t('common.reference')}</th>
                  <th>{t('billing.payments.date')}</th>
                  <th>{t('billing.payments.method')}</th>
                  <th className="num">{t('common.amount')}</th>
                  <th className="num">{t('billing.payments.unallocated')}</th>
                  <th>{t('billing.payments.allocatedTo')}</th>
                  <th>{t('common.status')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {visiblePayments.map((p) => (
                  <tr key={p.id}>
                    <td className="mono">{p.number ?? '—'}</td>
                    <td>{p.paymentDate}</td>
                    <td>{p.method}</td>
                    <td className="num">{money(p.amount, locale, p.currency)}</td>
                    <td className="num">{money(p.unallocatedAmount, locale, p.currency)}</td>
                    <td className="page-sub">
                      {p.allocations.length === 0
                        ? t('billing.payments.none')
                        : p.allocations
                            .map((a) => a.invoiceNumber ?? (a as { doc_no?: string }).doc_no ?? '—')
                            .join(', ')}
                    </td>
                    <td>
                      <Badge kind={p.status === 'recorded' ? 'success' : 'neutral'}>{p.status}</Badge>
                      {p.accountingEntryId && <div className="page-sub">{t('billing.documents.posted')}</div>}
                    </td>
                    <td className="row-actions">
                      <Link
                        className="btn btn-ghost"
                        to={`/accounting/lettering?search=${encodeURIComponent(p.number ?? p.reference ?? '')}`}
                      >
                        {t('lettering.open')}
                      </Link>
                      {p.status === 'recorded' && !p.accountingEntryId && (
                        <Button variant="ghost" onClick={() => void cancel(p)} disabled={busy}>
                          {t('common.delete')}
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

      <Modal open={open} title={t('billing.payments.new')} onClose={() => setOpen(false)} wide>
        <div className="form-grid">
          <Field label={t('billing.documents.customer')}>
            <select
              value={form.customerId}
              onChange={(e) => {
                setForm({ ...form, customerId: e.target.value });
                setAllocations({});
              }}
            >
              <option value="">{t('billing.documents.chooseCustomer')}</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('billing.payments.date')}>
            <input
              type="date"
              value={form.paymentDate}
              onChange={(e) => setForm({ ...form, paymentDate: e.target.value })}
            />
          </Field>
          <Field label={t('common.amount')}>
            <input
              inputMode="decimal"
              value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })}
              placeholder="10000.00"
            />
          </Field>
          <Field label={t('billing.payments.method')}>
            <select value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })}>
              {PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>
                  {t(`billing.method.${m}`)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('common.reference')}>
            <input value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} />
          </Field>
        </div>

        <h3>{t('billing.payments.allocations')}</h3>
        {form.customerId === '' ? (
          <p className="muted">{t('billing.documents.chooseCustomer')}</p>
        ) : customerInvoices.length === 0 ? (
          <p className="muted">{t('billing.payments.noOpenInvoice')}</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t('billing.documents.number')}</th>
                  <th>{t('common.date')}</th>
                  <th className="num">{t('billing.documents.outstanding')}</th>
                  <th>{t('common.amount')}</th>
                </tr>
              </thead>
              <tbody>
                {customerInvoices.map((invoice) => (
                  <tr key={invoice.id}>
                    <td className="mono">{invoice.number}</td>
                    <td>{invoice.issueDate}</td>
                    <td className="num">{money(invoice.outstanding, locale, invoice.currency)}</td>
                    <td>
                      <input
                        inputMode="decimal"
                        value={allocations[invoice.id] ?? ''}
                        placeholder="0.00"
                        onChange={(e) => setAllocations({ ...allocations, [invoice.id]: e.target.value })}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="entry-totals">
          <strong>{t('billing.payments.unallocated')}</strong> {scaled4ToString(unallocated < 0n ? 0n : unallocated)}
          {unallocated < 0n && <span className="field-error"> {t('billing.payments.exceeds')}</span>}
        </p>
        <p className="muted">{t('billing.payments.noPosting')}</p>

        <div className="modal-actions">
          <Button variant="ghost" onClick={() => setOpen(false)}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            onClick={() => void create()}
            disabled={busy || !form.customerId || received <= 0n || unallocated < 0n}
          >
            {t('common.create')}
          </Button>
        </div>
      </Modal>
    </>
  );
}
