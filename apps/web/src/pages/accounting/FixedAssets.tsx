import { useEffect, useMemo, useState } from 'react';
import { api, downloadExport, qs } from '../../api';
import { useI18n } from '../../i18n';
import { useSession } from '../../store';
import { Badge, Button, Card, DemoNotice, EmptyState, ErrorBanner, Field, Modal, Spinner } from '../../components/ui';
import { money, today } from '../../format';

interface Account { id: string; code: string; name: string; type: string; is_active: boolean }
interface Journal { id: string; code: string; name: string; is_active: boolean }
interface CategoryAccount { id: string; code: string; name: string }
interface Category {
  id: string; code: string; nameEn: string; nameFr: string; isDepreciable: boolean; isActive: boolean;
  defaultMethod: string | null; defaultUsefulLifeMonths: number | null; defaultResidualValue: string | null;
  defaultReducingRate: string | null;
  accounts: Record<string, CategoryAccount | null>;
}
interface Asset {
  id: string; assetCode: string; description: string; category: { id: string; code: string; nameEn: string; nameFr: string };
  serialNumber: string | null; location: string | null; acquisitionDate: string; inServiceDate: string | null;
  supplierName: string | null; invoiceRef: string | null; documentRef: string | null;
  cost: string; attributableCosts: string; totalCost: string; residualValue: string;
  currency: string; exchangeRate: string; fxNote: string | null; functionalCost: string;
  method: string | null; usefulLifeMonths: number | null; reducingRate: string | null;
  depreciationStartDate: string | null; depreciationEndDate: string | null;
  status: string; accumulatedDepreciation: string; accumulatedImpairment: string; netBookValue: string;
  disposalDate: string | null; disposalProceeds: string | null;
}
interface AssetDetail { asset: Asset; estimates: any[]; events: any[]; proposals: any[]; impairments: any[] }
interface ScheduleLine {
  monthStart: string; monthEnd: string; amount: string; method: string; openingNbv: string; closingNbv: string;
  daysActive: number; daysInMonth: number;
}
interface BatchLine { assetCode: string; monthStart: string; amount: string; method: string }
interface Batch {
  id: string; reference: string; periodStart: string; periodEnd: string; status: string; totalAmount: string;
  lines: BatchLine[]; approvalNote: string | null; entryNo: string | null;
  checks: { code: string; severity: string; message: string }[];
}
interface Preview {
  from: string; to: string; lines: BatchLine[]; total: string;
  totals: { amount: string; debit: string; credit: string; difference: string };
  checks: { code: string; severity: 'ok' | 'warning' | 'block'; message: string }[];
  blockers: { code: string; message: string }[]; warnings: { code: string; message: string }[];
}
interface ProposalLine { accountId: string; description: string; debit: string; credit: string; account?: Account | null }
interface Proposal {
  id: string; kind: string; eventDate: string; reference: string; description: string; status: string;
  lines: ProposalLine[]; payload: Record<string, any>; entryNo: string | null;
}

type Tab = 'register' | 'depreciation' | 'categories' | 'reports';
const STATUS_KIND: Record<string, 'neutral' | 'success' | 'warning' | 'danger' | 'info'> = {
  draft: 'neutral', in_service: 'success', suspended: 'warning', disposed: 'danger', written_off: 'danger',
};
const KINDS = ['acquisition', 'cwip', 'commissioning', 'impairment', 'impairment_reversal', 'disposal', 'write_off', 'reclassification'];
const REPORTS = ['register', 'schedule', 'accumulated', 'nbv', 'additions-disposals', 'reconciliation', 'movement-schedule'];

function monthStart(value: string) { return `${value.slice(0, 7)}-01`; }
function monthEnd(value: string) {
  const d = new Date(`${value.slice(0, 7)}-01T00:00:00Z`);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
}

const emptyAsset = (categoryId: string) => ({
  categoryId, description: '', serialNumber: '', location: '', acquisitionDate: today(),
  inServiceDate: '', supplierName: '', invoiceRef: '', documentRef: '', cost: '', attributableCosts: '',
  residualValue: '0', currency: 'MUR', exchangeRate: '1', fxNote: '', method: '', usefulLifeMonths: '',
  reducingRate: '', notes: '',
});

export default function FixedAssetsPage() {
  const { t, locale } = useI18n();
  const { company } = useSession();
  const [tab, setTab] = useState<Tab>('register');
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [journals, setJournals] = useState<Journal[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [categoryFilter, setCategoryFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<AssetDetail | null>(null);
  const [schedule, setSchedule] = useState<ScheduleLine[]>([]);

  const [assetModal, setAssetModal] = useState(false);
  const [assetForm, setAssetForm] = useState(emptyAsset(''));
  const [categoryModal, setCategoryModal] = useState<Category | null>(null);
  const [categoryForm, setCategoryForm] = useState<any>({});

  const [from, setFrom] = useState(company?.financial_year_start ?? '');
  const [to, setTo] = useState(company?.financial_year_end ?? '');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [batchJournal, setBatchJournal] = useState('');
  const [batchReference, setBatchReference] = useState('');
  const [decision, setDecision] = useState<{ kind: 'batch' | 'proposal'; id: string; action: 'approve' | 'post' } | null>(null);
  const [note, setNote] = useState('');

  const [proposalModal, setProposalModal] = useState(false);
  const [proposalForm, setProposalForm] = useState<any>({ kind: 'acquisition', eventDate: today(), journalId: '', reference: '' });
  const [proposalPreview, setProposalPreview] = useState<Proposal | null>(null);

  const [report, setReport] = useState('register');
  const [asOf, setAsOf] = useState(company?.financial_year_end ?? '');
  const [reportData, setReportData] = useState<any>(null);

  const activeAccounts = useMemo(() => accounts.filter((a) => a.is_active), [accounts]);
  const activeJournals = useMemo(() => journals.filter((j) => j.is_active), [journals]);
  const filtered = useMemo(
    () => assets.filter((a) => (!categoryFilter || a.category.id === categoryFilter) && (!statusFilter || a.status === statusFilter)),
    [assets, categoryFilter, statusFilter],
  );

  async function loadCore() {
    if (!company) return;
    setLoading(true);
    try {
      const [acc, jrn, cat, ast, bat] = await Promise.all([
        api.get<{ accounts: Account[] }>(`/companies/${company.id}/accounts`),
        api.get<{ journals: Journal[] }>(`/companies/${company.id}/journals`),
        api.get<{ categories: Category[] }>(`/companies/${company.id}/fixed-assets/categories`),
        api.get<{ assets: Asset[] }>(`/companies/${company.id}/fixed-assets`),
        api.get<{ batches: Batch[] }>(`/companies/${company.id}/fixed-assets/depreciation/batches`),
      ]);
      setAccounts(acc.accounts);
      setJournals(jrn.journals);
      setCategories(cat.categories);
      setAssets(ast.assets);
      setBatches(bat.batches);
      setFrom((current) => current || company.financial_year_start);
      setTo((current) => current || company.financial_year_end);
      setAsOf((current) => current || company.financial_year_end);
      setBatchJournal((current) => current || jrn.journals.find((j) => j.code === 'OD')?.id || jrn.journals[0]?.id || '');
      setError(null);
    } catch (err: any) {
      setError(err?.message ?? t('common.error'));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void loadCore(); }, [company?.id]);

  async function openAsset(id: string) {
    if (!company) return;
    setSelected(id);
    setActionError(null);
    try {
      const [d, s] = await Promise.all([
        api.get<AssetDetail>(`/companies/${company.id}/fixed-assets/${id}`),
        api.get<{ lines: ScheduleLine[] }>(`/companies/${company.id}/fixed-assets/${id}/schedule${qs({ from: company.financial_year_start, to: company.financial_year_end })}`),
      ]);
      setDetail(d);
      setSchedule(s.lines);
      setAssetForm({
        ...emptyAsset(d.asset.category.id),
        description: d.asset.description, serialNumber: d.asset.serialNumber ?? '', location: d.asset.location ?? '',
        acquisitionDate: d.asset.acquisitionDate, inServiceDate: d.asset.inServiceDate ?? '',
        supplierName: d.asset.supplierName ?? '', invoiceRef: d.asset.invoiceRef ?? '', documentRef: d.asset.documentRef ?? '',
        cost: d.asset.cost, attributableCosts: d.asset.attributableCosts, residualValue: d.asset.residualValue,
        currency: d.asset.currency, exchangeRate: d.asset.exchangeRate, fxNote: d.asset.fxNote ?? '',
        method: d.asset.method ?? '', usefulLifeMonths: d.asset.usefulLifeMonths ? String(d.asset.usefulLifeMonths) : '',
        reducingRate: d.asset.reducingRate ?? '', notes: '',
      });
    } catch (err: any) { setActionError(err?.message ?? t('common.error')); }
  }

  async function run(action: () => Promise<unknown>) {
    setBusy(true); setActionError(null);
    try { await action(); await loadCore(); if (selected) await openAsset(selected); }
    catch (err: any) { setActionError(err?.message ?? t('common.error')); }
    finally { setBusy(false); }
  }

  function payloadFromAsset() {
    return {
      categoryId: assetForm.categoryId, description: assetForm.description, serialNumber: assetForm.serialNumber || null,
      location: assetForm.location || null, acquisitionDate: assetForm.acquisitionDate,
      inServiceDate: assetForm.inServiceDate || null, supplierName: assetForm.supplierName || null,
      invoiceRef: assetForm.invoiceRef || null, documentRef: assetForm.documentRef || null,
      cost: assetForm.cost, attributableCosts: assetForm.attributableCosts || '0',
      residualValue: assetForm.residualValue || '0', currency: assetForm.currency || 'MUR',
      exchangeRate: assetForm.exchangeRate || '1', fxNote: assetForm.fxNote || null,
      method: assetForm.method || null, usefulLifeMonths: assetForm.usefulLifeMonths ? Number(assetForm.usefulLifeMonths) : null,
      reducingRate: assetForm.reducingRate || null, notes: assetForm.notes || null,
    };
  }

  async function saveAsset() {
    if (!company) return;
    await run(async () => {
      if (selected) await api.patch(`/companies/${company.id}/fixed-assets/${selected}`, payloadFromAsset());
      else await api.post(`/companies/${company.id}/fixed-assets`, payloadFromAsset());
      setAssetModal(false);
    });
  }

  async function saveCategory() {
    if (!company) return;
    await run(async () => {
      const body = { ...categoryForm };
      if (categoryModal?.id) await api.patch(`/companies/${company.id}/fixed-assets/categories/${categoryModal.id}`, body);
      else await api.post(`/companies/${company.id}/fixed-assets/categories`, body);
      setCategoryModal(null);
    });
  }

  async function previewDepreciation() {
    if (!company) return;
    setBusy(true); setActionError(null);
    try {
      const data = await api.get<Preview>(`/companies/${company.id}/fixed-assets/depreciation/preview${qs({ from: monthStart(from), to: monthEnd(to) })}`);
      setPreview(data);
    } catch (err: any) { setActionError(err?.message ?? t('common.error')); }
    finally { setBusy(false); }
  }

  async function createBatch() {
    if (!company) return;
    await run(async () => {
      await api.post(`/companies/${company.id}/fixed-assets/depreciation/batches`, {
        from: monthStart(from), to: monthEnd(to), journalId: batchJournal, reference: batchReference || undefined,
      });
      await previewDepreciation();
    });
  }

  async function submitDecision() {
    if (!company || !decision) return;
    await run(async () => {
      const base = decision.kind === 'batch'
        ? `/companies/${company.id}/fixed-assets/depreciation/batches/${decision.id}`
        : `/companies/${company.id}/fixed-assets/proposals/${decision.id}`;
      if (decision.action === 'approve') await api.post(`${base}/approve`, { confirm: true, note });
      else await api.post(`${base}/post`);
      setDecision(null); setNote('');
    });
  }

  async function createProposal() {
    if (!company || !selected) return;
    setBusy(true); setActionError(null);
    try {
      const data = await api.post<{ proposal: Proposal }>(`/companies/${company.id}/fixed-assets/${selected}/proposals`, proposalForm);
      setProposalPreview(data.proposal);
      setProposalModal(false);
      await openAsset(selected);
    } catch (err: any) { setActionError(err?.message ?? t('common.error')); }
    finally { setBusy(false); }
  }

  async function loadReport() {
    if (!company) return;
    setBusy(true); setActionError(null);
    try {
      setReportData(await api.get(`/companies/${company.id}/fixed-assets/reports/${report}${qs({ from, to, asOf })}`));
    } catch (err: any) { setActionError(err?.message ?? t('common.error')); }
    finally { setBusy(false); }
  }

  if (!company) return <EmptyState title={t('common.selectCompany')} />;
  if (loading) return <Spinner />;

  const categoryName = (c: Category) => (locale === 'fr' ? c.nameFr : c.nameEn);
  const accountOptions = (type?: string) => activeAccounts.filter((a) => !type || a.type === type);

  return (
    <div>
      <div className="page-head">
        <div className="grow">
          <h1>{t('fa.title')}</h1>
          <div className="page-sub">{t('fa.subtitle')}</div>
        </div>
        <Button variant="primary" onClick={() => setAssetModal(true)}>{t('fa.newAsset')}</Button>
      </div>
      <DemoNotice />
      <div className="alert alert-warn">{t('fa.calculationNote')}</div>
      <ErrorBanner message={error ?? actionError} />
      <div className="tabs" role="tablist">
        {(['register', 'depreciation', 'categories', 'reports'] as Tab[]).map((value) => (
          <button key={value} role="tab" aria-selected={tab === value} className={tab === value ? 'tab active' : 'tab'} onClick={() => setTab(value)}>
            {t(`fa.tab.${value}`)}
          </button>
        ))}
      </div>

      {tab === 'register' && (
        <>
          <Card title={t('fa.register')} actions={<Button onClick={() => void loadCore()}>{t('common.refresh')}</Button>}>
            <div className="form-row">
              <Field label={t('fa.category')}>
                <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
                  <option value="">{t('common.all')}</option>
                  {categories.map((c) => <option key={c.id} value={c.id}>{c.code} — {categoryName(c)}</option>)}
                </select>
              </Field>
              <Field label={t('common.status')}>
                <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                  <option value="">{t('common.all')}</option>
                  {['draft', 'in_service', 'suspended', 'disposed', 'written_off'].map((s) => <option key={s} value={s}>{t(`fa.status.${s}`)}</option>)}
                </select>
              </Field>
            </div>
            <div className="table-wrap">
              <table className="table">
                <thead><tr>
                  <th>{t('fa.asset')}</th><th>{t('common.description')}</th><th>{t('fa.category')}</th>
                  <th>{t('fa.inServiceDate')}</th><th>{t('fa.method')}</th>
                  <th className="num">{t('fa.cost')}</th><th className="num">{t('fa.accumulated')}</th>
                  <th className="num">{t('fa.nbv')}</th><th>{t('common.status')}</th>
                </tr></thead>
                <tbody>
                  {filtered.map((a) => (
                    <tr key={a.id} className="clickable" onClick={() => void openAsset(a.id)}>
                      <td className="mono">{a.assetCode}</td><td>{a.description}</td><td>{a.category.code}</td>
                      <td>{a.inServiceDate ?? '—'}</td><td>{a.method ? t(`fa.method.${a.method}`) : '—'}</td>
                      <td className="num">{money(a.functionalCost, locale, company.functional_currency)}</td>
                      <td className="num">{money(a.accumulatedDepreciation, locale, company.functional_currency)}</td>
                      <td className="num">{money(a.netBookValue, locale, company.functional_currency)}</td>
                      <td><Badge kind={STATUS_KIND[a.status]}>{t(`fa.status.${a.status}`)}</Badge></td>
                    </tr>
                  ))}
                  {filtered.length === 0 && <tr><td colSpan={9} className="page-sub">{t('fa.noAsset')}</td></tr>}
                </tbody>
              </table>
            </div>
          </Card>

          {detail && (
            <Card title={`${detail.asset.assetCode} — ${detail.asset.description}`} actions={<Button onClick={() => { setSelected(null); setDetail(null); }}>{t('common.close')}</Button>}>
              <div className="grid grid-2">
                <div>
                  <table className="table">
                    <tbody>
                      <tr><th>{t('fa.category')}</th><td>{detail.asset.category.code}</td></tr>
                      <tr><th>{t('fa.acquisitionDate')}</th><td>{detail.asset.acquisitionDate}</td></tr>
                      <tr><th>{t('fa.inServiceDate')}</th><td>{detail.asset.inServiceDate ?? '—'}</td></tr>
                      <tr><th>{t('fa.cost')}</th><td className="num">{money(detail.asset.functionalCost, locale, company.functional_currency)}</td></tr>
                      <tr><th>{t('fa.residual')}</th><td className="num">{money(detail.asset.residualValue, locale, company.functional_currency)}</td></tr>
                      <tr><th>{t('fa.accumulated')}</th><td className="num">{money(detail.asset.accumulatedDepreciation, locale, company.functional_currency)}</td></tr>
                      <tr><th>{t('fa.impairment')}</th><td className="num">{money(detail.asset.accumulatedImpairment, locale, company.functional_currency)}</td></tr>
                      <tr><th>{t('fa.nbv')}</th><td className="num">{money(detail.asset.netBookValue, locale, company.functional_currency)}</td></tr>
                      <tr><th>{t('fa.method')}</th><td>{detail.asset.method ? t(`fa.method.${detail.asset.method}`) : '—'} {detail.asset.usefulLifeMonths ? `· ${detail.asset.usefulLifeMonths} ${t('fa.months')}` : ''}</td></tr>
                      <tr><th>{t('fa.location')}</th><td>{detail.asset.location ?? '—'}</td></tr>
                      <tr><th>{t('fa.documentRef')}</th><td>{detail.asset.documentRef ?? '—'}</td></tr>
                    </tbody>
                  </table>
                  <div className="form-row" style={{ flexWrap: 'wrap' }}>
                    {detail.asset.status === 'draft' && (
                      <>
                        <Button variant="primary" onClick={() => void run(() => api.post(`/companies/${company.id}/fixed-assets/${detail.asset.id}/activate`, {
                          inServiceDate: assetForm.inServiceDate || detail.asset.acquisitionDate,
                          method: assetForm.method || 'straight_line',
                          usefulLifeMonths: Number(assetForm.usefulLifeMonths || 12),
                          residualValue: assetForm.residualValue || '0',
                          reducingRate: assetForm.reducingRate || null,
                        }))}>{t('fa.activate')}</Button>
                      </>
                    )}
                    {detail.asset.status === 'in_service' && (
                      <Button onClick={() => void run(() => api.post(`/companies/${company.id}/fixed-assets/${detail.asset.id}/suspend`, {
                        from: today(), reason: t('fa.suspendReasonDemo'),
                      }))}>{t('fa.suspend')}</Button>
                    )}
                    {detail.asset.status === 'suspended' && (
                      <Button onClick={() => void run(() => api.post(`/companies/${company.id}/fixed-assets/${detail.asset.id}/resume`, { from: today() }))}>{t('fa.resume')}</Button>
                    )}
                    <Button onClick={() => {
                      setProposalForm({ kind: 'acquisition', eventDate: detail.asset.acquisitionDate, journalId: activeJournals[0]?.id ?? '', reference: `FA-${Date.now().toString().slice(-6)}` });
                      setProposalModal(true);
                    }}>{t('fa.propose')}</Button>
                    <Button onClick={() => setAssetModal(true)}>{t('common.edit')}</Button>
                  </div>
                </div>
                <div>
                  <h3>{t('fa.schedule')}</h3>
                  <div className="table-wrap">
                    <table className="table">
                      <thead><tr><th>{t('fa.month')}</th><th className="num">{t('fa.amount')}</th><th className="num">{t('fa.nbv')}</th><th>{t('fa.days')}</th></tr></thead>
                      <tbody>
                        {schedule.map((l) => (
                          <tr key={l.monthStart}><td>{l.monthStart}</td><td className="num">{money(l.amount, locale, company.functional_currency)}</td><td className="num">{money(l.closingNbv, locale, company.functional_currency)}</td><td>{l.daysActive}/{l.daysInMonth}</td></tr>
                        ))}
                        {schedule.length === 0 && <tr><td colSpan={4} className="page-sub">{t('fa.noSchedule')}</td></tr>}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              <h3>{t('fa.proposals')}</h3>
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>{t('common.date')}</th><th>{t('fa.kind')}</th><th>{t('common.reference')}</th><th className="num">{t('common.amount')}</th><th>{t('common.status')}</th><th>{t('common.actions')}</th></tr></thead>
                  <tbody>
                    {detail.proposals.map((p: any) => (
                      <tr key={p.id}>
                        <td>{p.eventDate}</td><td>{t(`fa.kind.${p.kind}`)}</td><td className="mono">{p.reference}</td>
                        <td className="num">{money(p.total, locale, company.functional_currency)}</td>
                        <td><Badge kind={p.status === 'POSTED' ? 'success' : p.status === 'REJECTED' ? 'danger' : p.status === 'APPROVED' ? 'info' : 'neutral'}>{t(`fa.proposalStatus.${p.status}`)}</Badge></td>
                        <td>
                          {p.status === 'PROPOSED' && <Button variant="link" onClick={() => { setDecision({ kind: 'proposal', id: p.id, action: 'approve' }); setNote(''); }}>{t('fa.approve')}</Button>}
                          {p.status === 'APPROVED' && <Button variant="link" onClick={() => { setDecision({ kind: 'proposal', id: p.id, action: 'post' }); }}>{t('fa.post')}</Button>}
                          {p.entryNo && <span className="page-sub">{p.entryNo}</span>}
                        </td>
                      </tr>
                    ))}
                    {detail.proposals.length === 0 && <tr><td colSpan={6} className="page-sub">{t('common.none')}</td></tr>}
                  </tbody>
                </table>
              </div>

              <h3>{t('fa.history')}</h3>
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>{t('common.date')}</th><th>{t('fa.event')}</th><th>{t('common.reference')}</th></tr></thead>
                  <tbody>
                    {detail.events.map((e: any) => <tr key={e.id}><td>{e.eventDate}</td><td>{e.eventType}</td><td>{e.reason ?? '—'}</td></tr>)}
                    {detail.events.length === 0 && <tr><td colSpan={3} className="page-sub">{t('common.none')}</td></tr>}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </>
      )}

      {tab === 'depreciation' && (
        <>
          <Card title={t('fa.depreciationBatch')}>
            <div className="form-row">
              <Field label={t('common.from')}><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
              <Field label={t('common.to')}><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
              <Field label={t('fa.journal')}>
                <select value={batchJournal} onChange={(e) => setBatchJournal(e.target.value)}>
                  {activeJournals.map((j) => <option key={j.id} value={j.id}>{j.code} — {j.name}</option>)}
                </select>
              </Field>
              <Field label={t('common.reference')}><input value={batchReference} onChange={(e) => setBatchReference(e.target.value)} placeholder="DEP-2025-08" /></Field>
              <Button onClick={() => void previewDepreciation()}>{t('fa.preview')}</Button>
              <Button variant="primary" disabled={!preview || preview.blockers.length > 0} onClick={() => void createBatch()}>{t('fa.createBatch')}</Button>
            </div>
            {preview && (
              <>
                <div className="alert alert-warn">{t('fa.previewHint')}</div>
                <div className="table-wrap">
                  <table className="table">
                    <thead><tr><th>{t('fa.asset')}</th><th>{t('fa.month')}</th><th>{t('fa.method')}</th><th>{t('fa.days')}</th><th className="num">{t('fa.amount')}</th></tr></thead>
                    <tbody>
                      {preview.lines.map((l, index) => (
                        <tr key={`${l.assetCode}-${l.monthStart}-${index}`}><td className="mono">{l.assetCode}</td><td>{l.monthStart}</td><td>{t(`fa.method.${l.method}`)}</td><td>—</td><td className="num">{money(l.amount, locale, company.functional_currency)}</td></tr>
                      ))}
                      {preview.lines.length === 0 && <tr><td colSpan={5} className="page-sub">{t('fa.noDepreciation')}</td></tr>}
                    </tbody>
                  </table>
                </div>
                <p className="page-sub">{t('fa.total')}: <strong>{money(preview.totals.amount, locale, company.functional_currency)}</strong> · {t('fa.debit')} {money(preview.totals.debit, locale, company.functional_currency)} · {t('fa.credit')} {money(preview.totals.credit, locale, company.functional_currency)}</p>
                {preview.checks.map((c, index) => (
                  <p key={`${c.code}-${index}`} className="page-sub"><Badge kind={c.severity === 'block' ? 'danger' : c.severity === 'warning' ? 'warning' : 'success'}>{c.code}</Badge> {c.message}</p>
                ))}
              </>
            )}
          </Card>

          <Card title={t('fa.batches')}>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>{t('common.reference')}</th><th>{t('common.period')}</th><th className="num">{t('common.amount')}</th><th>{t('common.status')}</th><th>{t('common.actions')}</th></tr></thead>
                <tbody>
                  {batches.map((b) => (
                    <tr key={b.id}>
                      <td className="mono">{b.reference}</td><td>{b.periodStart} → {b.periodEnd}</td>
                      <td className="num">{money(b.totalAmount, locale, company.functional_currency)}</td>
                      <td><Badge kind={b.status === 'POSTED' ? 'success' : b.status === 'APPROVED' ? 'info' : 'neutral'}>{t(`fa.batchStatus.${b.status}`)}</Badge></td>
                      <td>
                        {b.status === 'DRAFT' && <Button variant="link" onClick={() => { setDecision({ kind: 'batch', id: b.id, action: 'approve' }); setNote(''); }}>{t('fa.approve')}</Button>}
                        {b.status === 'APPROVED' && <Button variant="link" onClick={() => { setDecision({ kind: 'batch', id: b.id, action: 'post' }); }}>{t('fa.post')}</Button>}
                        {b.entryNo && <span className="page-sub">{b.entryNo}</span>}
                      </td>
                    </tr>
                  ))}
                  {batches.length === 0 && <tr><td colSpan={5} className="page-sub">{t('fa.noBatch')}</td></tr>}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}

      {tab === 'categories' && (
        <Card title={t('fa.categories')} actions={<Button variant="primary" onClick={() => { setCategoryModal({ id: '' } as Category); setCategoryForm({ code: '', nameEn: '', nameFr: '', isDepreciable: true }); }}>{t('fa.newCategory')}</Button>}>
          <p className="page-sub">{t('fa.categoryHint')}</p>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>{t('common.code')}</th><th>{t('common.name')}</th><th>{t('fa.assetAccount')}</th><th>{t('fa.depExpenseAccount')}</th><th>{t('fa.accumAccount')}</th><th>{t('common.actions')}</th></tr></thead>
              <tbody>
                {categories.map((c) => (
                  <tr key={c.id}>
                    <td className="mono">{c.code}</td><td>{categoryName(c)}</td>
                    <td>{c.accounts.asset ? `${c.accounts.asset.code} ${c.accounts.asset.name}` : <Badge kind="warning">{t('fa.configurationRequired')}</Badge>}</td>
                    <td>{c.accounts.depreciationExpense ? `${c.accounts.depreciationExpense.code}` : '—'}</td>
                    <td>{c.accounts.accumulatedDepreciation ? `${c.accounts.accumulatedDepreciation.code}` : '—'}</td>
                    <td><Button variant="link" onClick={() => {
                      setCategoryModal(c);
                      setCategoryForm({
                        code: c.code, nameEn: c.nameEn, nameFr: c.nameFr, isDepreciable: c.isDepreciable,
                        defaultMethod: c.defaultMethod ?? '', defaultUsefulLifeMonths: c.defaultUsefulLifeMonths ?? '',
                        defaultResidualValue: c.defaultResidualValue ?? '0', defaultReducingRate: c.defaultReducingRate ?? '',
                        assetAccountId: c.accounts.asset?.id ?? '', accumulatedDepreciationAccountId: c.accounts.accumulatedDepreciation?.id ?? '',
                        depreciationExpenseAccountId: c.accounts.depreciationExpense?.id ?? '',
                        accumulatedImpairmentAccountId: c.accounts.accumulatedImpairment?.id ?? '',
                        impairmentLossAccountId: c.accounts.impairmentLoss?.id ?? '',
                        impairmentReversalAccountId: c.accounts.impairmentReversal?.id ?? '',
                        disposalGainAccountId: c.accounts.disposalGain?.id ?? '', disposalLossAccountId: c.accounts.disposalLoss?.id ?? '',
                        cwipAccountId: c.accounts.cwip?.id ?? '',
                      });
                    }}>{t('common.edit')}</Button></td>
                  </tr>
                ))}
                {categories.length === 0 && <tr><td colSpan={6} className="page-sub">{t('fa.noCategory')}</td></tr>}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {tab === 'reports' && (
        <Card title={t('fa.reports')}>
          <div className="form-row">
            <Field label={t('fa.report')}>
              <select value={report} onChange={(e) => setReport(e.target.value)}>
                {REPORTS.map((r) => <option key={r} value={r}>{t(`fa.report.${r}`)}</option>)}
              </select>
            </Field>
            <Field label={t('common.from')}><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
            <Field label={t('common.to')}><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
            <Field label={t('fa.asOf')}><input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} /></Field>
            <Button onClick={() => void loadReport()}>{t('fa.generate')}</Button>
            <Button onClick={() => void downloadExport(`/companies/${company.id}/fixed-assets/reports/${report}${qs({ from, to, asOf })}`, `fixed-assets-${report}.csv`, 'csv')}>{t('common.exportCsv')}</Button>
            <Button onClick={() => void downloadExport(`/companies/${company.id}/fixed-assets/reports/${report}${qs({ from, to, asOf })}`, `fixed-assets-${report}.pdf`, 'pdf')}>{t('common.exportPdf')}</Button>
          </div>
          {reportData && <ReportView report={report} data={reportData} currency={company.functional_currency} locale={locale} />}
          {!reportData && <p className="page-sub">{t('fa.generateHint')}</p>}
        </Card>
      )}

      <Modal open={assetModal} title={selected ? t('fa.editAsset') : t('fa.newAsset')} onClose={() => setAssetModal(false)} wide>
        <div className="grid grid-2">
          <Field label={t('fa.category')}>
            <select value={assetForm.categoryId} onChange={(e) => setAssetForm({ ...assetForm, categoryId: e.target.value })}>
              <option value="">—</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.code} — {categoryName(c)}</option>)}
            </select>
          </Field>
          <Field label={t('common.description')}><input value={assetForm.description} onChange={(e) => setAssetForm({ ...assetForm, description: e.target.value })} /></Field>
          <Field label={t('fa.acquisitionDate')}><input type="date" value={assetForm.acquisitionDate} onChange={(e) => setAssetForm({ ...assetForm, acquisitionDate: e.target.value })} /></Field>
          <Field label={t('fa.inServiceDate')}><input type="date" value={assetForm.inServiceDate} onChange={(e) => setAssetForm({ ...assetForm, inServiceDate: e.target.value })} /></Field>
          <Field label={t('fa.cost')}><input value={assetForm.cost} onChange={(e) => setAssetForm({ ...assetForm, cost: e.target.value })} /></Field>
          <Field label={t('fa.attributableCosts')}><input value={assetForm.attributableCosts} onChange={(e) => setAssetForm({ ...assetForm, attributableCosts: e.target.value })} /></Field>
          <Field label={t('fa.residual')}><input value={assetForm.residualValue} onChange={(e) => setAssetForm({ ...assetForm, residualValue: e.target.value })} /></Field>
          <Field label={t('common.currency')}><input maxLength={3} value={assetForm.currency} onChange={(e) => setAssetForm({ ...assetForm, currency: e.target.value.toUpperCase() })} /></Field>
          <Field label={t('fa.exchangeRate')} hint={t('fa.exchangeHint')}><input value={assetForm.exchangeRate} onChange={(e) => setAssetForm({ ...assetForm, exchangeRate: e.target.value })} /></Field>
          <Field label={t('fa.fxNote')}><input value={assetForm.fxNote} onChange={(e) => setAssetForm({ ...assetForm, fxNote: e.target.value })} /></Field>
          <Field label={t('fa.method')}>
            <select value={assetForm.method} onChange={(e) => setAssetForm({ ...assetForm, method: e.target.value })}>
              <option value="">—</option><option value="straight_line">{t('fa.method.straight_line')}</option><option value="reducing_balance">{t('fa.method.reducing_balance')}</option>
            </select>
          </Field>
          <Field label={t('fa.lifeMonths')}><input type="number" min={1} value={assetForm.usefulLifeMonths} onChange={(e) => setAssetForm({ ...assetForm, usefulLifeMonths: e.target.value })} /></Field>
          <Field label={t('fa.reducingRate')}><input value={assetForm.reducingRate} onChange={(e) => setAssetForm({ ...assetForm, reducingRate: e.target.value })} placeholder="0.25" /></Field>
          <Field label={t('fa.supplier')}><input value={assetForm.supplierName} onChange={(e) => setAssetForm({ ...assetForm, supplierName: e.target.value })} /></Field>
          <Field label={t('fa.invoiceRef')}><input value={assetForm.invoiceRef} onChange={(e) => setAssetForm({ ...assetForm, invoiceRef: e.target.value })} /></Field>
          <Field label={t('fa.documentRef')}><input value={assetForm.documentRef} onChange={(e) => setAssetForm({ ...assetForm, documentRef: e.target.value })} /></Field>
          <Field label={t('fa.location')}><input value={assetForm.location} onChange={(e) => setAssetForm({ ...assetForm, location: e.target.value })} /></Field>
          <Field label={t('fa.serialNumber')}><input value={assetForm.serialNumber} onChange={(e) => setAssetForm({ ...assetForm, serialNumber: e.target.value })} /></Field>
        </div>
        <p className="page-sub">{t('fa.noStatutoryRate')}</p>
        <Button variant="primary" disabled={busy || !assetForm.categoryId || !assetForm.description || !assetForm.cost} onClick={() => void saveAsset()}>{t('common.save')}</Button>
      </Modal>

      <Modal open={!!categoryModal} title={t('fa.category')} onClose={() => setCategoryModal(null)} wide>
        <div className="grid grid-2">
          <Field label={t('common.code')}><input value={categoryForm.code ?? ''} onChange={(e) => setCategoryForm({ ...categoryForm, code: e.target.value.toUpperCase() })} /></Field>
          <Field label={t('fa.nameEn')}><input value={categoryForm.nameEn ?? ''} onChange={(e) => setCategoryForm({ ...categoryForm, nameEn: e.target.value })} /></Field>
          <Field label={t('fa.nameFr')}><input value={categoryForm.nameFr ?? ''} onChange={(e) => setCategoryForm({ ...categoryForm, nameFr: e.target.value })} /></Field>
          <Field label={t('fa.defaultLife')}><input type="number" value={categoryForm.defaultUsefulLifeMonths ?? ''} onChange={(e) => setCategoryForm({ ...categoryForm, defaultUsefulLifeMonths: e.target.value })} /></Field>
          {([
            ['assetAccountId', 'fa.assetAccount', 'asset'],
            ['accumulatedDepreciationAccountId', 'fa.accumAccount', 'asset'],
            ['depreciationExpenseAccountId', 'fa.depExpenseAccount', 'expense'],
            ['accumulatedImpairmentAccountId', 'fa.impairmentAccount', 'asset'],
            ['impairmentLossAccountId', 'fa.impairmentLoss', 'expense'],
            ['impairmentReversalAccountId', 'fa.impairmentReversal', 'revenue'],
            ['disposalGainAccountId', 'fa.disposalGain', 'revenue'],
            ['disposalLossAccountId', 'fa.disposalLoss', 'expense'],
            ['cwipAccountId', 'fa.cwipAccount', 'asset'],
          ] as const).map(([key, label, type]) => (
            <Field key={key} label={t(label)}>
              <select value={categoryForm[key] ?? ''} onChange={(e) => setCategoryForm({ ...categoryForm, [key]: e.target.value || null })}>
                <option value="">{t('fa.configurationRequired')}</option>
                {accountOptions(type).map((a) => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
              </select>
            </Field>
          ))}
        </div>
        <p className="page-sub">{t('fa.categoryHint')}</p>
        <Button variant="primary" disabled={busy || !categoryForm.code || !categoryForm.nameEn || !categoryForm.nameFr} onClick={() => void saveCategory()}>{t('common.save')}</Button>
      </Modal>

      <Modal open={proposalModal} title={t('fa.newProposal')} onClose={() => setProposalModal(false)} wide>
        <div className="grid grid-2">
          <Field label={t('fa.kind')}>
            <select value={proposalForm.kind} onChange={(e) => setProposalForm({ ...proposalForm, kind: e.target.value })}>
              {KINDS.map((k) => <option key={k} value={k}>{t(`fa.kind.${k}`)}</option>)}
            </select>
          </Field>
          <Field label={t('common.date')}><input type="date" value={proposalForm.eventDate} onChange={(e) => setProposalForm({ ...proposalForm, eventDate: e.target.value })} /></Field>
          <Field label={t('fa.journal')}>
            <select value={proposalForm.journalId} onChange={(e) => setProposalForm({ ...proposalForm, journalId: e.target.value })}>
              {activeJournals.map((j) => <option key={j.id} value={j.id}>{j.code} — {j.name}</option>)}
            </select>
          </Field>
          <Field label={t('common.reference')}><input value={proposalForm.reference} onChange={(e) => setProposalForm({ ...proposalForm, reference: e.target.value })} /></Field>
          <Field label={t('fa.counterparty')}>
            <select value={proposalForm.counterpartyAccountId ?? ''} onChange={(e) => setProposalForm({ ...proposalForm, counterpartyAccountId: e.target.value })}>
              <option value="">—</option>
              {activeAccounts.map((a) => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
            </select>
          </Field>
          <Field label={t('fa.proceeds')}><input value={proposalForm.proceedsAmount ?? ''} onChange={(e) => setProposalForm({ ...proposalForm, proceedsAmount: e.target.value })} /></Field>
          <Field label={t('fa.proceedsAccount')}>
            <select value={proposalForm.proceedsAccountId ?? ''} onChange={(e) => setProposalForm({ ...proposalForm, proceedsAccountId: e.target.value })}>
              <option value="">—</option>
              {activeAccounts.map((a) => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
            </select>
          </Field>
          <Field label={t('fa.impairmentAmount')}><input value={proposalForm.impairmentAmount ?? ''} onChange={(e) => setProposalForm({ ...proposalForm, impairmentAmount: e.target.value })} /></Field>
          <Field label={t('fa.reason')}><input value={proposalForm.impairmentReason ?? ''} onChange={(e) => setProposalForm({ ...proposalForm, impairmentReason: e.target.value })} /></Field>
          <Field label={t('fa.fromAccount')}>
            <select value={proposalForm.fromAccountId ?? ''} onChange={(e) => setProposalForm({ ...proposalForm, fromAccountId: e.target.value })}>
              <option value="">—</option>
              {activeAccounts.map((a) => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
            </select>
          </Field>
          <Field label={t('fa.toAccount')}>
            <select value={proposalForm.toAccountId ?? ''} onChange={(e) => setProposalForm({ ...proposalForm, toAccountId: e.target.value })}>
              <option value="">—</option>
              {activeAccounts.map((a) => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
            </select>
          </Field>
          <Field label={t('common.amount')}><input value={proposalForm.reclassAmount ?? ''} onChange={(e) => setProposalForm({ ...proposalForm, reclassAmount: e.target.value })} /></Field>
        </div>
        <p className="page-sub">{t('fa.proposalHint')}</p>
        <Button variant="primary" disabled={busy || !proposalForm.journalId || !proposalForm.reference} onClick={() => void createProposal()}>{t('common.create')}</Button>
      </Modal>

      {proposalPreview && (
        <Modal open={!!proposalPreview} title={`${t('fa.proposal')} — ${proposalPreview.reference}`} onClose={() => setProposalPreview(null)} wide>
          <table className="table">
            <thead><tr><th>{t('common.account')}</th><th>{t('common.description')}</th><th className="num">{t('common.debit')}</th><th className="num">{t('common.credit')}</th></tr></thead>
            <tbody>
              {proposalPreview.lines.map((l, index) => (
                <tr key={index}><td className="mono">{l.account ? `${l.account.code} ${l.account.name}` : l.accountId}</td><td>{l.description}</td>
                  <td className="num">{money(l.debit, locale, company.functional_currency)}</td><td className="num">{money(l.credit, locale, company.functional_currency)}</td></tr>
              ))}
            </tbody>
          </table>
          <p className="page-sub">{t('fa.proposalCreated')}</p>
          <Button onClick={() => setProposalPreview(null)}>{t('common.close')}</Button>
        </Modal>
      )}

      <Modal open={!!decision} title={decision?.action === 'approve' ? t('fa.approve') : t('fa.post')} onClose={() => setDecision(null)}>
        {decision?.action === 'post' ? <p>{t('fa.postConfirm')}</p> : (
          <>
            <p>{t('fa.approveConfirm')}</p>
            <Field label={t('fa.note')} hint={t('fa.noteHint')}><textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} /></Field>
          </>
        )}
        <Button variant="primary" disabled={busy || (decision?.action === 'approve' && note.trim().length < 10)} onClick={() => void submitDecision()}>{t('common.save')}</Button>
      </Modal>
    </div>
  );
}

function ReportView({ report, data, currency, locale }: { report: string; data: any; currency: string; locale: 'fr' | 'en' }) {
  const { t } = useI18n();
  const rows: any[] = data.rows ?? [];
  if (report === 'movement-schedule') {
    return (
      <table className="table">
        <tbody>
          {[t('fa.opening'), t('fa.additions'), t('fa.disposals'), t('fa.closing')].map((label, index) => (
            <tr key={label}><th>{label}</th>
              <td className="num">{money([data.cost.opening, data.cost.additions, data.cost.disposals, data.cost.closing][index], locale, currency)}</td>
              <td className="num">{money([data.depreciation.opening, data.depreciation.charge, data.depreciation.disposals, data.depreciation.closing][index], locale, currency)}</td>
            </tr>
          ))}
          <tr><th>{t('fa.check')}</th><td className="num">{money(data.cost.check, locale, currency)}</td><td className="num">{money(data.depreciation.check, locale, currency)}</td></tr>
        </tbody>
      </table>
    );
  }
  if (report === 'additions-disposals') {
    return (
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>{t('fa.kind')}</th><th>{t('fa.asset')}</th><th>{t('fa.category')}</th><th>{t('common.date')}</th><th className="num">{t('fa.cost')}</th></tr></thead>
          <tbody>
            {data.additions.map((r: any) => <tr key={`a-${r.assetId}`}><td>{t('fa.additions')}</td><td className="mono">{r.assetCode}</td><td>{r.categoryCode}</td><td>{r.acquisitionDate}</td><td className="num">{money(r.cost, locale, currency)}</td></tr>)}
            {data.disposals.map((r: any) => <tr key={`d-${r.assetId}`}><td>{t('fa.disposals')}</td><td className="mono">{r.assetCode}</td><td>{r.categoryCode}</td><td>{r.disposalDate}</td><td className="num">{money(r.cost, locale, currency)}</td></tr>)}
          </tbody>
        </table>
      </div>
    );
  }
  if (report === 'reconciliation') {
    return (
      <>
        <p>{t('fa.difference')}: <strong>{money(data.difference, locale, currency)}</strong> {data.balanced ? <Badge kind="success">{t('fa.balanced')}</Badge> : <Badge kind="danger">{t('fa.notBalanced')}</Badge>}</p>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>{t('fa.category')}</th><th className="num">{t('fa.cost')}</th><th className="num">{t('fa.glBalance')}</th><th className="num">{t('fa.difference')}</th><th className="num">{t('fa.accumulated')}</th><th className="num">{t('fa.depreciationGl')}</th></tr></thead>
            <tbody>{rows.map((r) => <tr key={r.categoryId}><td>{r.categoryCode}</td><td className="num">{money(r.registerCost, locale, currency)}</td><td className="num">{money(r.assetGl, locale, currency)}</td><td className="num">{money(r.costDifference, locale, currency)}</td><td className="num">{money(r.registerDepreciation, locale, currency)}</td><td className="num">{money(r.depreciationGl, locale, currency)}</td></tr>)}</tbody>
          </table>
        </div>
      </>
    );
  }
  return (
    <div className="table-wrap">
      <table className="table">
        <thead><tr><th>{t('fa.asset')}</th><th>{t('fa.category')}</th><th>{t('fa.month')}</th><th className="num">{t('fa.amount')}</th><th className="num">{t('fa.cost')}</th><th className="num">{t('fa.accumulated')}</th><th className="num">{t('fa.nbv')}</th></tr></thead>
        <tbody>
          {rows.map((r: any) => (
            <tr key={r.id ?? `${r.assetId}-${r.monthStart}`}>
              <td className="mono">{r.assetCode}</td><td>{r.categoryCode ?? '—'}</td><td>{r.monthStart ?? '—'}</td>
              <td className="num">{money(r.amount ?? '0', locale, currency)}</td><td className="num">{money(r.grossCost ?? r.cost ?? '0', locale, currency)}</td>
              <td className="num">{money(r.accumulatedDepreciation ?? '0', locale, currency)}</td><td className="num">{money(r.netBookValue ?? r.closingNbv ?? '0', locale, currency)}</td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={7} className="page-sub">{t('common.none')}</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
