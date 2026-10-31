import { useState } from 'react';
import { api, qs } from '../api';
import { useI18n } from '../i18n';
import { errorMessage, useSession } from '../store';
import { useAsync } from '../hooks';
import { Badge, Button, Card, DemoNotice, EmptyState, ErrorBanner, Field, Modal, Spinner } from '../components/ui';

interface Account {
  id: string;
  code: string;
  name: string;
  type: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';
  parent_id: string | null;
  parent_code: string | null;
  currency: string;
  is_active: boolean;
  fs_mapping: string | null;
  description: string | null;
}

const TYPES = ['asset', 'liability', 'equity', 'revenue', 'expense'] as const;
const MAPPINGS = [
  'bs.non_current_assets.property_plant_equipment',
  'bs.non_current_assets.intangible',
  'bs.non_current_assets.investment_property',
  'bs.current_assets.inventory',
  'bs.current_assets.receivables',
  'bs.current_assets.cash_and_equivalents',
  'bs.non_current_liabilities.borrowings',
  'bs.non_current_liabilities.other',
  'bs.current_liabilities.payables',
  'bs.current_liabilities.tax',
  'bs.current_liabilities.other',
  'bs.equity.share_capital',
  'bs.equity.retained_earnings',
  'bs.equity.reserves',
  'pl.revenue',
  'pl.other_income',
  'pl.cost_of_sales',
  'pl.operating_expenses',
  'pl.finance_costs',
  'pl.tax_expense',
  'unmapped',
];

const empty = {
  code: '',
  name: '',
  type: 'asset' as Account['type'],
  parentId: '',
  currency: 'MUR',
  isActive: true,
  fsMapping: 'unmapped',
  description: '',
};

export default function AccountsPage() {
  const { t } = useI18n();
  const { company } = useSession();
  const [search, setSearch] = useState('');
  const [type, setType] = useState('');
  const [includeInactive, setIncludeInactive] = useState(false);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Account | null>(null);
  const [form, setForm] = useState({ ...empty });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const { data, loading, error: loadError, reload } = useAsync<{ accounts: Account[] } | null>(
    () =>
      company
        ? api.get<{ accounts: Account[] }>(
            `/companies/${company.id}/accounts${qs({ search, type, includeInactive: includeInactive ? 'true' : '' })}`,
          )
        : Promise.resolve(null),
    [company?.id, search, type, includeInactive],
  );

  if (!company) return <EmptyState title={t('dashboard.noCompanyHelp')} />;

  const accounts = data?.accounts ?? [];

  const openCreate = () => {
    setEditing(null);
    setForm({ ...empty, currency: company.functional_currency });
    setError(null);
    setOpen(true);
  };

  const openEdit = (a: Account) => {
    setEditing(a);
    setForm({
      code: a.code,
      name: a.name,
      type: a.type,
      parentId: a.parent_id ?? '',
      currency: a.currency,
      isActive: a.is_active,
      fsMapping: a.fs_mapping ?? 'unmapped',
      description: a.description ?? '',
    });
    setError(null);
    setOpen(true);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const payload = {
        ...form,
        parentId: form.parentId || null,
        fsMapping: form.fsMapping || null,
        description: form.description || null,
      };
      if (editing) await api.patch(`/companies/${company.id}/accounts/${editing.id}`, payload);
      else await api.post(`/companies/${company.id}/accounts`, payload);
      await reload();
      setOpen(false);
    } catch (err) {
      setError(errorMessage(err, t('common.error')).message);
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async (a: Account) => {
    try {
      await api.patch(`/companies/${company.id}/accounts/${a.id}`, { isActive: !a.is_active });
      await reload();
    } catch (err) {
      alert(errorMessage(err, t('common.error')).message);
    }
  };

  const remove = async (a: Account) => {
    if (!confirm(t('common.confirmDelete'))) return;
    try {
      await api.del(`/companies/${company.id}/accounts/${a.id}`);
      await reload();
    } catch (err) {
      alert(errorMessage(err, t('common.error')).message);
    }
  };

  return (
    <>
      <div className="page-head">
        <div className="grow">
          <h1>{t('accounts.title')}</h1>
          <div className="page-sub">{accounts.length} comptes · {company.functional_currency}</div>
        </div>
        <Button variant="primary" onClick={openCreate}>
          + {t('accounts.new')}
        </Button>
      </div>
      <DemoNotice />
      <Card>
        <div className="form-row" style={{ marginBottom: 12 }}>
          <input
            placeholder={t('accounts.search')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ maxWidth: 280 }}
          />
          <select value={type} onChange={(e) => setType(e.target.value)} style={{ maxWidth: 200 }}>
            <option value="">{t('common.all')}</option>
            {TYPES.map((ty) => (
              <option key={ty} value={ty}>
                {t(`accountType.${ty}`)}
              </option>
            ))}
          </select>
          <label className="inline">
            <input
              type="checkbox"
              checked={includeInactive}
              onChange={(e) => setIncludeInactive(e.target.checked)}
            />
            {t('accounts.includeInactive')}
          </label>
        </div>
        <ErrorBanner message={loadError} />
        {loading ? (
          <Spinner />
        ) : accounts.length === 0 ? (
          <EmptyState title={t('accounts.demoNotice')} />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t('common.code')}</th>
                  <th>{t('common.name')}</th>
                  <th>{t('common.type')}</th>
                  <th>{t('accounts.parent')}</th>
                  <th>{t('accounts.currency')}</th>
                  <th>{t('accounts.fsMapping')}</th>
                  <th>{t('common.status')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {accounts.map((a) => (
                  <tr key={a.id} style={a.is_active ? undefined : { opacity: 0.55 }}>
                    <td className="mono">{a.code}</td>
                    <td>{a.name}</td>
                    <td>{t(`accountType.${a.type}`)}</td>
                    <td className="mono">{a.parent_code ?? '—'}</td>
                    <td>{a.currency}</td>
                    <td className="page-sub">{a.fs_mapping ?? '—'}</td>
                    <td>
                      <Badge kind={a.is_active ? 'success' : 'neutral'}>
                        {a.is_active ? t('common.active') : t('common.inactive')}
                      </Badge>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                        <Button variant="ghost" onClick={() => openEdit(a)}>
                          {t('common.edit')}
                        </Button>
                        <Button variant="ghost" onClick={() => void toggleActive(a)}>
                          {a.is_active ? t('common.inactive') : t('common.active')}
                        </Button>
                        <Button variant="link" onClick={() => void remove(a)}>
                          {t('common.delete')}
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

      <Modal open={open} title={editing ? t('accounts.edit') : t('accounts.new')} onClose={() => setOpen(false)}>
        <ErrorBanner message={error} />
        <form onSubmit={submit}>
          <div className="form-grid">
            <Field label={t('common.code')}>
              <input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} required />
            </Field>
            <Field label={t('common.name')}>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            </Field>
            <Field label={t('common.type')}>
              <select
                value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value as Account['type'] })}
              >
                {TYPES.map((ty) => (
                  <option key={ty} value={ty}>
                    {t(`accountType.${ty}`)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t('accounts.parent')}>
              <select value={form.parentId} onChange={(e) => setForm({ ...form, parentId: e.target.value })}>
                <option value="">—</option>
                {accounts
                  .filter((a) => a.id !== editing?.id)
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.code} — {a.name}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label={t('accounts.currency')}>
              <select value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}>
                {['MUR', 'EUR', 'USD', 'GBP'].map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </Field>
            <Field label={t('accounts.fsMapping')}>
              <select
                value={form.fsMapping}
                onChange={(e) => setForm({ ...form, fsMapping: e.target.value })}
              >
                {MAPPINGS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Field label={t('accounts.description')}>
            <textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              maxLength={500}
            />
          </Field>
          <label className="inline">
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
            />
            {t('common.active')}
          </label>
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
