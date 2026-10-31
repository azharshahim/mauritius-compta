import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useI18n } from '../i18n';
import { errorMessage, useSession, type Company } from '../store';
import { Badge, Button, Card, ErrorBanner, EmptyState, Field, Modal, Spinner } from '../components/ui';
import { useAsync } from '../hooks';
import { date } from '../format';

const CURRENCIES = ['MUR', 'EUR', 'USD', 'GBP'];
const STANDARDS = ['IFRS', 'IFRS for SMEs', 'Other'];

const emptyForm = {
  name: '',
  clientCode: '',
  crn: '',
  brn: '',
  vatNumber: '',
  registeredAddress: '',
  businessActivity: '',
  dossierManagerId: '',
  financialYearStart: `${new Date().getUTCFullYear()}-07-01`,
  financialYearEnd: `${new Date().getUTCFullYear() + 1}-06-30`,
  functionalCurrency: 'MUR',
  presentationCurrency: 'MUR',
  accountingStandard: 'IFRS',
  status: 'active',
  withDefaultChart: true,
};

type DossierRow = Company & {
  crn: string | null;
  client_code: string | null;
  dossier_manager_id: string | null;
  dossier_manager_name?: string | null;
  open_tasks?: number;
};

export default function CompaniesPage() {
  const { t, locale } = useI18n();
  const { company, setCompany, refresh } = useSession();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<DossierRow | null>(null);
  const [form, setForm] = useState({ ...emptyForm });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const query = useMemo(() => {
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    if (status !== 'all') params.set('status', status);
    return params.toString();
  }, [search, status]);

  const { data, loading, error: loadError, reload } = useAsync<{ companies: DossierRow[] } | null>(
    () => api.get<{ companies: DossierRow[] }>(`/cabinet/companies${query ? `?${query}` : ''}`),
    [query],
  );

  const { data: team } = useAsync<{ collaborators: { userId: string; fullName: string }[] } | null>(
    () => api.get<{ collaborators: { userId: string; fullName: string }[] }>('/cabinet/team'),
    [],
  );

  const openCreate = () => {
    setEditing(null);
    setForm({ ...emptyForm });
    setError(null);
    setOpen(true);
  };

  const openEdit = (c: DossierRow) => {
    setEditing(c);
    setForm({
      name: c.name,
      clientCode: c.client_code ?? '',
      crn: c.crn ?? '',
      brn: c.brn ?? '',
      vatNumber: c.vat_number ?? '',
      registeredAddress: c.registered_address ?? '',
      businessActivity: c.business_activity ?? '',
      dossierManagerId: c.dossier_manager_id ?? '',
      financialYearStart: c.financial_year_start,
      financialYearEnd: c.financial_year_end,
      functionalCurrency: c.functional_currency,
      presentationCurrency: c.presentation_currency,
      accountingStandard: c.accounting_standard,
      status: c.status,
      withDefaultChart: false,
    });
    setError(null);
    setOpen(true);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const payload = {
      ...form,
      clientCode: form.clientCode || null,
      crn: form.crn || null,
      dossierManagerId: form.dossierManagerId || null,
    };
    try {
      if (editing) {
        await api.patch(`/companies/${editing.id}`, payload);
      } else {
        const res = await api.post<{ company: Company }>('/companies', payload);
        setCompany(res.company.id);
      }
      await Promise.all([refresh(), reload()]);
      setOpen(false);
    } catch (err) {
      setError(errorMessage(err, t('common.error')).message);
    } finally {
      setBusy(false);
    }
  };

  const toggleArchive = async (row: DossierRow) => {
    const archived = row.status === 'archived';
    if (!archived && !window.confirm(t('cabinet.companies.archiveConfirm'))) return;
    setBusy(true);
    try {
      await api.post(`/cabinet/companies/${row.id}/${archived ? 'unarchive' : 'archive'}`);
      await Promise.all([refresh(), reload()]);
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
          <h1>{t('cabinet.companies.title')}</h1>
          <div className="page-sub">{t('cabinet.companies.sub')}</div>
        </div>
        <Button variant="primary" onClick={openCreate}>
          + {t('cabinet.companies.new')}
        </Button>
      </div>

      <ErrorBanner message={loadError ?? error} />

      <Card>
        <div className="filters">
          <Field label={t('cabinet.companies.search')}>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('cabinet.companies.search')}
            />
          </Field>
          <Field label={t('cabinet.status')}>
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="all">{t('cabinet.companies.allStatuses')}</option>
              <option value="active">{t('companies.active')}</option>
              <option value="inactive">{t('companies.inactive')}</option>
              <option value="archived">{t('companies.archived')}</option>
            </select>
          </Field>
        </div>

        {loading && <Spinner label={t('common.loading')} />}
        {!loading && (data?.companies.length ?? 0) === 0 && (
          <EmptyState title={t('cabinet.companies.empty')} />
        )}
        {!loading && (data?.companies.length ?? 0) > 0 && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t('common.name')}</th>
                  <th>{t('cabinet.companies.clientCode')}</th>
                  <th>{t('cabinet.companies.crn')}</th>
                  <th>{t('cabinet.companies.manager')}</th>
                  <th>{t('companies.fyEnd')}</th>
                  <th>{t('cabinet.status')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data?.companies.map((c) => (
                  <tr key={c.id} style={company?.id === c.id ? { background: '#f2f8ff' } : undefined}>
                    <td>
                      <Link to={`/cabinet/companies/${c.id}`}>
                        <strong>{c.name}</strong>
                      </Link>
                      {company?.id === c.id && (
                        <>
                          {' '}
                          <Badge kind="info">{t('cabinet.companies.current')}</Badge>
                        </>
                      )}
                      <div className="page-sub">{c.business_activity ?? c.brn ?? '—'}</div>
                    </td>
                    <td className="mono">{c.client_code ?? '—'}</td>
                    <td className="mono">{c.crn ?? '—'}</td>
                    <td>{c.dossier_manager_name ?? t('cabinet.companies.managerNone')}</td>
                    <td>{date(c.financial_year_end, locale)}</td>
                    <td>
                      <Badge kind={c.status === 'active' ? 'success' : 'neutral'}>
                        {t(`companies.${c.status}`)}
                      </Badge>
                      {c.open_tasks ? (
                        <div className="page-sub">
                          {c.open_tasks} {t('cabinet.openTasksShort')}
                        </div>
                      ) : null}
                    </td>
                    <td>
                      <div className="row-actions">
                        {company?.id !== c.id && (
                          <Button variant="ghost" onClick={() => setCompany(c.id)}>
                            {t('cabinet.companies.select')}
                          </Button>
                        )}
                        <Link className="btn btn-ghost" to={`/cabinet/companies/${c.id}`}>
                          {t('cabinet.companies.open')}
                        </Link>
                        <Button variant="ghost" onClick={() => openEdit(c)}>
                          {t('common.edit')}
                        </Button>
                        <Button
                          variant="ghost"
                          onClick={() => void toggleArchive(c)}
                          disabled={busy}
                        >
                          {c.status === 'archived'
                            ? t('cabinet.companies.unarchive')
                            : t('cabinet.companies.archive')}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal
        open={open}
        title={editing ? t('cabinet.companies.edit') : t('cabinet.companies.new')}
        onClose={() => setOpen(false)}
        wide
      >
        <ErrorBanner message={error} />
        <form onSubmit={submit}>
          <div className="form-grid">
            <Field label={t('common.name')}>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
                maxLength={200}
              />
            </Field>
            <Field label={t('cabinet.companies.clientCode')}>
              <input
                value={form.clientCode}
                onChange={(e) => setForm({ ...form, clientCode: e.target.value })}
                maxLength={24}
              />
            </Field>
            <Field label={t('cabinet.companies.crn')}>
              <input
                value={form.crn}
                onChange={(e) => setForm({ ...form, crn: e.target.value })}
                maxLength={40}
              />
            </Field>
            <Field label={t('companies.brn')}>
              <input
                value={form.brn}
                onChange={(e) => setForm({ ...form, brn: e.target.value })}
                maxLength={40}
              />
            </Field>
            <Field label={t('companies.vat')}>
              <input
                value={form.vatNumber}
                onChange={(e) => setForm({ ...form, vatNumber: e.target.value })}
                maxLength={40}
              />
            </Field>
            <Field label={t('cabinet.companies.manager')}>
              <select
                value={form.dossierManagerId}
                onChange={(e) => setForm({ ...form, dossierManagerId: e.target.value })}
              >
                <option value="">{t('cabinet.companies.managerNone')}</option>
                {(team?.collaborators ?? []).map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.fullName}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t('companies.activity')}>
              <input
                value={form.businessActivity}
                onChange={(e) => setForm({ ...form, businessActivity: e.target.value })}
                maxLength={300}
              />
            </Field>
            <Field label={t('companies.address')}>
              <input
                value={form.registeredAddress}
                onChange={(e) => setForm({ ...form, registeredAddress: e.target.value })}
                maxLength={500}
              />
            </Field>
            <Field label={t('companies.fyStart')}>
              <input
                type="date"
                value={form.financialYearStart}
                onChange={(e) => setForm({ ...form, financialYearStart: e.target.value })}
                required
              />
            </Field>
            <Field label={t('companies.fyEnd')}>
              <input
                type="date"
                value={form.financialYearEnd}
                onChange={(e) => setForm({ ...form, financialYearEnd: e.target.value })}
                required
              />
            </Field>
            <Field label={t('companies.functionalCurrency')}>
              <select
                value={form.functionalCurrency}
                onChange={(e) => setForm({ ...form, functionalCurrency: e.target.value })}
              >
                {CURRENCIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </Field>
            <Field label={t('companies.presentationCurrency')}>
              <select
                value={form.presentationCurrency}
                onChange={(e) => setForm({ ...form, presentationCurrency: e.target.value })}
              >
                {CURRENCIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </Field>
            <Field label={t('companies.standard')}>
              <select
                value={form.accountingStandard}
                onChange={(e) => setForm({ ...form, accountingStandard: e.target.value })}
              >
                {STANDARDS.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </Field>
            <Field label={t('cabinet.status')}>
              <select
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value })}
              >
                <option value="active">{t('companies.active')}</option>
                <option value="inactive">{t('companies.inactive')}</option>
                <option value="archived">{t('companies.archived')}</option>
              </select>
            </Field>
          </div>
          {!editing && (
            <label className="inline" style={{ marginTop: 8 }}>
              <input
                type="checkbox"
                checked={form.withDefaultChart}
                onChange={(e) => setForm({ ...form, withDefaultChart: e.target.checked })}
              />
              {t('companies.demoChart')}
            </label>
          )}
          <div className="modal-actions">
            <Button onClick={() => setOpen(false)}>{t('common.cancel')}</Button>
            <Button type="submit" variant="primary" disabled={busy}>
              {busy ? t('common.loading') : t('common.save')}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
