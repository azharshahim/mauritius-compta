import { useState } from 'react';
import { api } from '../api';
import { useI18n } from '../i18n';
import { errorMessage, useSession, type Company } from '../store';
import { Badge, Button, Card, ErrorBanner, Field, Modal } from '../components/ui';
import { date } from '../format';

const CURRENCIES = ['MUR', 'EUR', 'USD', 'GBP'];
const STANDARDS = ['IFRS', 'IFRS for SMEs', 'Other'];

const emptyForm = {
  name: '',
  brn: '',
  vatNumber: '',
  registeredAddress: '',
  businessActivity: '',
  financialYearStart: `${new Date().getUTCFullYear()}-07-01`,
  financialYearEnd: `${new Date().getUTCFullYear() + 1}-06-30`,
  functionalCurrency: 'MUR',
  presentationCurrency: 'MUR',
  accountingStandard: 'IFRS',
  status: 'active',
  withDefaultChart: true,
};

export default function CompaniesPage() {
  const { t, locale } = useI18n();
  const { companies, company, setCompany, refresh } = useSession();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Company | null>(null);
  const [form, setForm] = useState({ ...emptyForm });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const openCreate = () => {
    setEditing(null);
    setForm({ ...emptyForm });
    setError(null);
    setOpen(true);
  };

  const openEdit = (c: Company) => {
    setEditing(c);
    setForm({
      name: c.name,
      brn: c.brn ?? '',
      vatNumber: c.vat_number ?? '',
      registeredAddress: c.registered_address ?? '',
      businessActivity: c.business_activity ?? '',
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
    try {
      if (editing) {
        await api.patch(`/companies/${editing.id}`, form);
      } else {
        const res = await api.post<{ company: Company }>('/companies', form);
        setCompany(res.company.id);
      }
      await refresh();
      setOpen(false);
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
          <h1>{t('companies.title')}</h1>
          <div className="page-sub">
            BRN · VAT · {t('companies.functionalCurrency')} · {t('companies.standard')}
          </div>
        </div>
        <Button variant="primary" onClick={openCreate}>
          + {t('companies.new')}
        </Button>
      </div>

      <Card>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t('common.name')}</th>
                <th>{t('companies.brn')}</th>
                <th>{t('companies.vat')}</th>
                <th>{t('companies.fyStart')} / {t('companies.fyEnd')}</th>
                <th>{t('common.currency')}</th>
                <th>{t('companies.status')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {companies.map((c) => (
                <tr key={c.id} style={company?.id === c.id ? { background: '#f2f8ff' } : undefined}>
                  <td>
                    <strong>{c.name}</strong>
                    {company?.id === c.id && (
                      <>
                        {' '}
                        <Badge kind="info">{t('companies.current')}</Badge>
                      </>
                    )}
                    <div className="page-sub">{c.business_activity}</div>
                  </td>
                  <td className="mono">{c.brn ?? '—'}</td>
                  <td className="mono">{c.vat_number ?? '—'}</td>
                  <td>
                    {date(c.financial_year_start, locale)} → {date(c.financial_year_end, locale)}
                  </td>
                  <td>{c.functional_currency}</td>
                  <td>
                    <Badge kind={c.status === 'active' ? 'success' : 'neutral'}>
                      {t(`companies.${c.status}`)}
                    </Badge>
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                      {company?.id !== c.id && (
                        <Button variant="ghost" onClick={() => setCompany(c.id)}>
                          {t('companies.select')}
                        </Button>
                      )}
                      <Button variant="ghost" onClick={() => openEdit(c)}>
                        {t('common.edit')}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
              {companies.length === 0 && (
                <tr>
                  <td colSpan={7} className="empty">
                    {t('dashboard.noCompanyHelp')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Modal
        open={open}
        title={editing ? t('companies.edit') : t('companies.new')}
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
            <Field label={t('companies.status')}>
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
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 16 }}>
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
