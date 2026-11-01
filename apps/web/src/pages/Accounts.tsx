import { useEffect, useMemo, useState } from 'react';
import { api, qs } from '../api';
import { useI18n } from '../i18n';
import { errorMessage, useSession } from '../store';
import { useAsync } from '../hooks';
import { Badge, Button, Card, DemoNotice, EmptyState, ErrorBanner, Field, Modal, Spinner } from '../components/ui';

interface Account {
  id: string;
  code: string;
  name: string;
  name_en: string | null;
  name_fr: string | null;
  type: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';
  parent_id: string | null;
  parent_code: string | null;
  currency: string;
  is_active: boolean;
  posting_allowed: boolean;
  account_role: string | null;
  vat_default: string | null;
  fs_mapping: string | null;
  description: string | null;
}
interface Profile {
  template_type: 'provisional_mauritius' | 'firm_chart' | 'custom_company';
  status: 'PENDING PROFESSIONAL VALIDATION' | 'AWAITING FIRM CONFIRMATION' | 'CONFIRMED BY FIRM';
  source_name: string | null;
  imported_at: string | null;
  notes: string | null;
}
interface ImportRow {
  line: number; code: string; name: string; nameEn: string | null; nameFr: string | null;
  type: Account['type']; parentCode: string | null; postingAllowed: boolean;
  accountRole: string | null; exists: boolean;
}
interface ImportPreview {
  format: string; sheetName: string; headers: string[]; mapping: Record<string, number>;
  rows: ImportRow[]; findings: { line: number; code: string; codeName: string; severity: string }[];
  notes: string[]; profileStatus: string;
}

const TYPES = ['asset', 'liability', 'equity', 'revenue', 'expense'] as const;
const ROLES = ['', 'bank', 'receivable', 'payable', 'vat_input', 'vat_output', 'purchases',
  'revenue', 'service_revenue', 'inventory', 'fixed_asset', 'payroll', 'rent', 'utilities',
  'telecom', 'professional_fees', 'insurance', 'bank_charges', 'external_services',
  'other_income', 'other_expense'] as const;
const MAPPINGS = [
  'bs.non_current_assets.property_plant_equipment', 'bs.non_current_assets.intangible',
  'bs.non_current_assets.investment_property', 'bs.current_assets.inventory',
  'bs.current_assets.receivables', 'bs.current_assets.cash_and_equivalents',
  'bs.non_current_liabilities.borrowings', 'bs.non_current_liabilities.other',
  'bs.current_liabilities.payables', 'bs.current_liabilities.tax',
  'bs.current_liabilities.other', 'bs.equity.share_capital', 'bs.equity.retained_earnings',
  'bs.equity.reserves', 'pl.revenue', 'pl.other_income', 'pl.cost_of_sales',
  'pl.operating_expenses', 'pl.finance_costs', 'pl.tax_expense', 'unmapped',
];

const empty = {
  code: '', name: '', nameEn: '', nameFr: '', type: 'asset' as Account['type'], parentId: '',
  currency: 'MUR', isActive: true, postingAllowed: true, accountRole: '', vatDefault: '',
  fsMapping: 'unmapped', description: '',
};

function readBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^;]+;base64,/, ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export default function AccountsPage() {
  const { t, locale } = useI18n();
  const { company } = useSession();
  const [search, setSearch] = useState('');
  const [type, setType] = useState('');
  const [includeInactive, setIncludeInactive] = useState(false);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Account | null>(null);
  const [form, setForm] = useState({ ...empty });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importFile, setImportFile] = useState<{ name: string; base64: string } | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  const [columnMapping, setColumnMapping] = useState<Record<string, string>>({});

  const { data, loading, error: loadError, reload } = useAsync<{ accounts: Account[] } | null>(
    () => company
      ? api.get<{ accounts: Account[] }>(
        `/companies/${company.id}/accounts${qs({ search, type, includeInactive: includeInactive ? 'true' : '' })}`)
      : Promise.resolve(null),
    [company?.id, search, type, includeInactive],
  );

  useEffect(() => {
    if (!company) return;
    api.get<{ profile: Profile }>(`/companies/${company.id}/chart-of-accounts/profile`)
      .then((r) => setProfile(r.profile)).catch(() => setProfile(null));
  }, [company?.id]);

  const accounts = data?.accounts ?? [];
  const labelOf = (account: { name: string; name_en: string | null; name_fr: string | null }) =>
    locale === 'en' ? account.name_en || account.name : account.name_fr || account.name;
  const missingLabel = (account: { name_en: string | null; name_fr: string | null }) =>
    locale === 'en' ? !account.name_en : !account.name_fr;
  const parentOptions = useMemo(
    () => accounts.filter((a) => a.id !== editing?.id), [accounts, editing?.id]);

  if (!company) return <EmptyState title={t('dashboard.noCompanyHelp')} />;

  const openCreate = () => {
    setEditing(null);
    setForm({ ...empty, currency: company.functional_currency });
    setError(null); setOpen(true);
  };
  const openEdit = (a: Account) => {
    setEditing(a);
    setForm({
      code: a.code, name: a.name, nameEn: a.name_en ?? '', nameFr: a.name_fr ?? '',
      type: a.type, parentId: a.parent_id ?? '', currency: a.currency, isActive: a.is_active,
      postingAllowed: a.posting_allowed, accountRole: a.account_role ?? '',
      vatDefault: a.vat_default ?? '', fsMapping: a.fs_mapping ?? 'unmapped',
      description: a.description ?? '',
    });
    setError(null); setOpen(true);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const payload = {
        code: form.code, name: form.name, nameEn: form.nameEn || null, nameFr: form.nameFr || null,
        type: form.type, parentId: form.parentId || null, currency: form.currency,
        isActive: form.isActive, postingAllowed: form.postingAllowed,
        accountRole: form.accountRole || null, vatDefault: form.vatDefault || null,
        fsMapping: form.fsMapping || null, description: form.description || null,
      };
      if (editing) await api.patch(`/companies/${company.id}/accounts/${editing.id}`, payload);
      else await api.post(`/companies/${company.id}/accounts`, payload);
      await reload(); setOpen(false);
    } catch (err) {
      setError(errorMessage(err, t('common.error')).message);
    } finally { setBusy(false); }
  };

  const toggleActive = async (a: Account) => {
    try {
      await api.patch(`/companies/${company.id}/accounts/${a.id}`, { isActive: !a.is_active });
      await reload();
    } catch (err) { alert(errorMessage(err, t('common.error')).message); }
  };
  const remove = async (a: Account) => {
    if (!confirm(t('common.confirmDelete'))) return;
    try { await api.del(`/companies/${company.id}/accounts/${a.id}`); await reload(); }
    catch (err) { alert(errorMessage(err, t('common.error')).message); }
  };
  const applyTemplate = async () => {
    setBusy(true); setError(null);
    try {
      await api.post(`/companies/${company.id}/chart-of-accounts/template/apply`, { template: 'provisional_mauritius' });
      await reload();
      setProfile((await api.get<{ profile: Profile }>(`/companies/${company.id}/chart-of-accounts/profile`)).profile);
      setTemplateOpen(false);
    } catch (err) { setError(errorMessage(err, t('common.error')).message); }
    finally { setBusy(false); }
  };
  const confirmProfile = async () => {
    const note = prompt(t('chart.confirmPrompt'));
    if (!note || note.trim().length < 10) return;
    try {
      await api.post(`/companies/${company.id}/chart-of-accounts/confirm`, { confirm: true, note: note.trim() });
      setProfile((await api.get<{ profile: Profile }>(`/companies/${company.id}/chart-of-accounts/profile`)).profile);
    } catch (err) { alert(errorMessage(err, t('common.error')).message); }
  };
  const chooseImport = async (file: File | null) => {
    if (!file) return;
    setImportError(null); setPreview(null);
    setImportFile({ name: file.name, base64: await readBase64(file) });
  };
  const runPreview = async (mapping: Record<string, string> = columnMapping) => {
    if (!importFile) return;
    setImportBusy(true); setImportError(null);
    try {
      const result = await api.post<ImportPreview>(`/companies/${company.id}/chart-of-accounts/import/preview`, {
        fileName: importFile.name, contentBase64: importFile.base64,
        ...(Object.values(mapping).some(Boolean) ? { mapping } : {}),
      });
      setPreview(result);
      if (!Object.values(mapping).some(Boolean)) {
        const derived: Record<string, string> = {};
        for (const [field, index] of Object.entries(result.mapping)) {
          if (index >= 0 && result.headers[index]) derived[field] = result.headers[index]!;
        }
        setColumnMapping(derived);
      }
    } catch (err) { setImportError(errorMessage(err, t('common.error')).message); }
    finally { setImportBusy(false); }
  };
  const changeMapping = (field: string, header: string) => {
    const next = { ...columnMapping, [field]: header };
    setColumnMapping(next);
    if (header) void runPreview(next);
  };
  const runImport = async () => {
    if (!importFile || !preview) return;
    setImportBusy(true); setImportError(null);
    try {
      const rows = preview.rows.filter((r) => !r.exists && r.type);
      await api.post(`/companies/${company.id}/chart-of-accounts/import/confirm`, {
        fileName: importFile.name, contentBase64: importFile.base64, confirm: true, rows,
      });
      await reload();
      setProfile((await api.get<{ profile: Profile }>(`/companies/${company.id}/chart-of-accounts/profile`)).profile);
      setImportOpen(false); setPreview(null); setImportFile(null);
    } catch (err) { setImportError(errorMessage(err, t('common.error')).message); }
    finally { setImportBusy(false); }
  };

  const statusKind = profile?.status === 'CONFIRMED BY FIRM' ? 'success'
    : profile?.status === 'AWAITING FIRM CONFIRMATION' ? 'warning' : 'neutral';

  return (
    <>
      <div className="page-head">
        <div className="grow">
          <h1>{t('accounts.title')}</h1>
          <div className="page-sub">{accounts.length} {t('chart.accountsCount')} · {company.functional_currency}</div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Button onClick={() => setTemplateOpen(true)}>{t('chart.useTemplate')}</Button>
          <Button onClick={() => { setImportOpen(true); setPreview(null); setImportFile(null); setColumnMapping({}); }}>
            {t('chart.importFirm')}
          </Button>
          <Button variant="primary" onClick={openCreate}>+ {t('accounts.new')}</Button>
        </div>
      </div>
      <DemoNotice />
      <Card>
        <div className="chart-status">
          <div>
            <strong>{t('chart.profile')} : </strong>
            {profile ? t(`chart.type.${profile.template_type}`) : '…'}
            {profile?.source_name && <span className="page-sub"> · {profile.source_name}</span>}
          </div>
          <Badge kind={statusKind}>{profile?.status ?? '…'}</Badge>
          {profile && profile.status !== 'CONFIRMED BY FIRM' && (
            <Button variant="ghost" onClick={() => void confirmProfile()}>{t('chart.confirm')}</Button>
          )}
        </div>
        <p className="page-sub" style={{ marginTop: 8 }}>
          {t('chart.isolationNote')}
        </p>
      </Card>
      <Card>
        <div className="form-row" style={{ marginBottom: 12 }}>
          <input placeholder={t('accounts.search')} value={search}
            onChange={(e) => setSearch(e.target.value)} style={{ maxWidth: 280 }} />
          <select value={type} onChange={(e) => setType(e.target.value)} style={{ maxWidth: 200 }}>
            <option value="">{t('common.all')}</option>
            {TYPES.map((ty) => <option key={ty} value={ty}>{t(`accountType.${ty}`)}</option>)}
          </select>
          <label className="inline">
            <input type="checkbox" checked={includeInactive}
              onChange={(e) => setIncludeInactive(e.target.checked)} />
            {t('accounts.includeInactive')}
          </label>
        </div>
        <ErrorBanner message={loadError} />
        {loading ? <Spinner /> : accounts.length === 0 ? (
          <EmptyState title={t('accounts.demoNotice')} />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t('common.code')}</th>
                  <th>{t('common.name')} ({locale.toUpperCase()})</th>
                  <th>{t('common.type')}</th>
                  <th>{t('accounts.parent')}</th>
                  <th>{t('chart.accountRole')}</th>
                  <th>{t('chart.postingAllowed')}</th>
                  <th>{t('common.status')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {accounts.map((a) => (
                  <tr key={a.id} style={a.is_active ? undefined : { opacity: 0.55 }}>
                    <td className="mono">{a.code}</td>
                    <td>
                      {labelOf(a)}
                      {missingLabel(a) && <Badge kind="warning">{t('chart.missingLabel')}</Badge>}
                    </td>
                    <td>{t(`accountType.${a.type}`)}</td>
                    <td className="mono">{a.parent_code ?? '—'}</td>
                    <td className="page-sub">{a.account_role ?? '—'}</td>
                    <td>{a.posting_allowed ? t('common.yes') : t('common.no')}</td>
                    <td>
                      <Badge kind={a.is_active ? 'success' : 'neutral'}>
                        {a.is_active ? t('common.active') : t('common.inactive')}
                      </Badge>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                        <Button variant="ghost" onClick={() => openEdit(a)}>{t('common.edit')}</Button>
                        <Button variant="ghost" onClick={() => void toggleActive(a)}>
                          {a.is_active ? t('common.inactive') : t('common.active')}
                        </Button>
                        <Button variant="link" onClick={() => void remove(a)}>{t('common.delete')}</Button>
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
            <Field label={t('chart.nameEn')}>
              <input value={form.nameEn} onChange={(e) => setForm({ ...form, nameEn: e.target.value })} />
            </Field>
            <Field label={t('chart.nameFr')}>
              <input value={form.nameFr} onChange={(e) => setForm({ ...form, nameFr: e.target.value })} />
            </Field>
            <Field label={t('common.type')}>
              <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as Account['type'] })}>
                {TYPES.map((ty) => <option key={ty} value={ty}>{t(`accountType.${ty}`)}</option>)}
              </select>
            </Field>
            <Field label={t('accounts.parent')}>
              <select value={form.parentId} onChange={(e) => setForm({ ...form, parentId: e.target.value })}>
                <option value="">—</option>
                {parentOptions.map((a) => (
                  <option key={a.id} value={a.id}>{a.code} — {labelOf(a)}</option>
                ))}
              </select>
            </Field>
            <Field label={t('chart.accountRole')}>
              <select value={form.accountRole} onChange={(e) => setForm({ ...form, accountRole: e.target.value })}>
                {ROLES.map((r) => <option key={r || 'none'} value={r}>{r || '—'}</option>)}
              </select>
            </Field>
            <Field label={t('chart.vatDefault')}>
              <input value={form.vatDefault} onChange={(e) => setForm({ ...form, vatDefault: e.target.value })}
                placeholder={t('chart.optional')} />
            </Field>
            <Field label={t('accounts.currency')}>
              <select value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}>
                {['MUR', 'EUR', 'USD', 'GBP'].map((c) => <option key={c}>{c}</option>)}
              </select>
            </Field>
            <Field label={t('accounts.fsMapping')}>
              <select value={form.fsMapping} onChange={(e) => setForm({ ...form, fsMapping: e.target.value })}>
                {MAPPINGS.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </Field>
          </div>
          <Field label={t('accounts.description')}>
            <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} maxLength={500} />
          </Field>
          <label className="inline">
            <input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />
            {t('common.active')}
          </label>
          <label className="inline">
            <input type="checkbox" checked={form.postingAllowed}
              onChange={(e) => setForm({ ...form, postingAllowed: e.target.checked })} />
            {t('chart.postingAllowed')}
          </label>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 16 }}>
            <Button onClick={() => setOpen(false)}>{t('common.cancel')}</Button>
            <Button type="submit" variant="primary" disabled={busy}>
              {busy ? t('common.loading') : t('common.save')}
            </Button>
          </div>
        </form>
      </Modal>

      <Modal open={templateOpen} title={t('chart.useTemplate')} onClose={() => setTemplateOpen(false)}>
        <ErrorBanner message={error} />
        <p>{t('chart.templateNote')}</p>
        <p className="page-sub">{t('chart.templateNoRenumber')}</p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 16 }}>
          <Button onClick={() => setTemplateOpen(false)}>{t('common.cancel')}</Button>
          <Button variant="primary" disabled={busy} onClick={() => void applyTemplate()}>
            {t('chart.applyTemplate')}
          </Button>
        </div>
      </Modal>

      <Modal open={importOpen} title={t('chart.importFirm')} onClose={() => setImportOpen(false)}>
        <ErrorBanner message={importError} />
        <p className="page-sub">{t('chart.firmNote')}</p>
        <Field label={t('chart.file')}>
          <input type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={(e) => void chooseImport(e.target.files?.[0] ?? null)} />
        </Field>
        {importFile && (
          <div className="form-row" style={{ marginTop: 10 }}>
            <span className="mono">{importFile.name}</span>
            <Button onClick={() => void runPreview()} disabled={importBusy}>{t('chart.preview')}</Button>
          </div>
        )}
        {preview && (
          <>
            <div className="form-grid" style={{ marginTop: 12 }}>
              {([
                ['code', t('common.code')], ['nameEn', t('chart.nameEn')],
                ['nameFr', t('chart.nameFr')], ['type', t('common.type')],
              ] as const).map(([field, label]) => (
                <Field key={field} label={`${label} — ${t('chart.column')}`}>
                  <select value={columnMapping[field] ?? ''} onChange={(e) => changeMapping(field, e.target.value)}>
                    <option value="">—</option>
                    {preview.headers.map((h) => <option key={h} value={h}>{h}</option>)}
                  </select>
                </Field>
              ))}
            </div>
            <div className="table-wrap" style={{ marginTop: 12, maxHeight: 280, overflow: 'auto' }}>
              <table>
                <thead>
                  <tr>
                    <th>{t('common.code')}</th><th>{t('chart.nameEn')}</th><th>{t('chart.nameFr')}</th>
                    <th>{t('common.type')}</th><th>{t('common.status')}</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((r) => (
                    <tr key={`${r.line}-${r.code}`} style={r.exists ? { opacity: 0.55 } : undefined}>
                      <td className="mono">{r.code}</td>
                      <td>{r.nameEn || r.name}</td>
                      <td>{r.nameFr || '—'}</td>
                      <td>{r.type ? t(`accountType.${r.type}`) : '—'}</td>
                      <td>{r.exists ? t('chart.exists') : t('chart.create')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {preview.findings.length > 0 && (
              <ul className="page-sub">
                {preview.findings.slice(0, 10).map((f) => (
                  <li key={`${f.line}-${f.codeName}`}>{`${t('chart.line')} ${f.line} · ${f.code} · ${f.codeName}`}</li>
                ))}
              </ul>
            )}
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 16 }}>
              <Button onClick={() => setImportOpen(false)}>{t('common.cancel')}</Button>
              <Button variant="primary" disabled={importBusy} onClick={() => void runImport()}>
                {t('chart.confirmImport')}
              </Button>
            </div>
          </>
        )}
      </Modal>
    </>
  );
}
