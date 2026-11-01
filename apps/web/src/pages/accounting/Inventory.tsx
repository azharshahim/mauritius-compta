import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, downloadExport, qs } from '../../api';
import { useI18n } from '../../i18n';
import { useSession } from '../../store';
import { Badge, Button, Card, DemoNotice, EmptyState, ErrorBanner, Field, Modal, Spinner } from '../../components/ui';
import { money, today } from '../../format';

interface Account { id: string; code: string; name: string; type: string; is_active: boolean }
interface Journal { id: string; code: string; name: string; is_active: boolean }
interface Category {
  id: string; code: string; name: string; valuationMethod: 'fifo' | 'weighted_average';
  inventoryAccountId: string; cogsAccountId: string; adjustmentAccountId: string | null;
  writeDownAccountId: string | null; allowNegativeStock: boolean; isActive: boolean;
}
interface Location { id: string; code: string; name: string; description: string | null; isActive: boolean }
interface Item { id: string; categoryId: string; sku: string; name: string; unit: string; reorderLevel: string | null; isActive: boolean }
interface Movement {
  id: string; movementNo: string; movementDate: string; direction: string; sourceKind: string;
  item: { sku: string; name: string }; location: { code: string; name: string };
  destination: { code: string; name: string } | null; quantity: string; unitCost: string | null;
  value: string | null; status: string; description: string; documentRef: string | null;
  journal: { code: string; name: string } | null; entryNo: string | null; approvalNote: string | null;
  rejectionReason: string | null; counterpartAccountId: string | null;
}
interface Count {
  id: string; countNo: string; countDate: string; location: { code: string; name: string };
  status: string; reference: string | null; lineCount: number;
}
interface WriteDown {
  id: string; writeDownNo: string; writeDownDate: string; kind: string; item: { sku: string; name: string };
  location: { code: string; name: string }; amount: string; reason: string; documentRef: string;
  status: string; entryNo: string | null;
}
interface ReportRow {
  sku: string; name: string; quantity: string; value: string; unitCost: string;
  category: { code: string; name: string; valuationMethod: string }; location: { code: string; name: string };
}
interface Report { asOf: string; rows: ReportRow[]; totals: { quantity: string; value: string }; note: string }
interface ReconRow {
  account: { code: string; name: string }; categories: { code: string; name: string }[];
  subledgerValue: string; ledgerBalance: string; difference: string; balanced: boolean;
}
interface Recon { asOf: string; rows: ReconRow[]; balanced: boolean; totalDifference: string; note: string }

type Tab = 'stock' | 'movements' | 'counts' | 'writeDowns' | 'reports' | 'settings';
const statusKind = (status: string) => status === 'POSTED' ? 'success' : status === 'PROPOSED' ? 'warning'
  : status === 'APPROVED' ? 'info' : status === 'REJECTED' ? 'danger' : 'neutral';
const directionLabel = (value: string) => (({
  in: 'Entrée', out: 'Sortie', transfer_out: 'Transfert', adjustment_in: 'Ajustement +', adjustment_out: 'Ajustement −',
} as Record<string, string>)[value] ?? value);

export default function InventoryPage() {
  const { locale } = useI18n();
  const { company } = useSession();
  const L = (fr: string, en: string) => (locale === 'en' ? en : fr);
  const [searchParams] = useSearchParams();
  const initialTab = searchParams.get('tab');
  const [tab, setTab] = useState<Tab>(['stock', 'movements', 'counts', 'writeDowns', 'reports', 'settings'].includes(initialTab ?? '') ? initialTab as Tab : 'stock');
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [journals, setJournals] = useState<Journal[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [counts, setCounts] = useState<Count[]>([]);
  const [writeDowns, setWriteDowns] = useState<WriteDown[]>([]);
  const [report, setReport] = useState<Report | null>(null);
  const [recon, setRecon] = useState<Recon | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [asOf, setAsOf] = useState(company?.financial_year_end ?? today());
  const [statusFilter, setStatusFilter] = useState('');

  const [categoryModal, setCategoryModal] = useState(false);
  const [locationModal, setLocationModal] = useState(false);
  const [itemModal, setItemModal] = useState(false);
  const [editingCategory, setEditingCategory] = useState<string | null>(null);
  const [editingLocation, setEditingLocation] = useState<string | null>(null);
  const [editingItem, setEditingItem] = useState<string | null>(null);
  const [movementModal, setMovementModal] = useState(false);
  const [countModal, setCountModal] = useState(false);
  const [writeDownModal, setWriteDownModal] = useState(false);
  const [decision, setDecision] = useState<{ path: string; action: 'approve' | 'reject' | 'post'; title: string } | null>(null);
  const [note, setNote] = useState('');

  const emptyMovement = {
    itemId: '', locationId: '', destinationLocationId: '', movementDate: today(), direction: 'in',
    sourceKind: 'receipt', quantity: '', unitCost: '', description: '', documentRef: '',
    journalId: '', counterpartAccountId: '',
  };
  const [movementForm, setMovementForm] = useState<any>(emptyMovement);
  const [categoryForm, setCategoryForm] = useState<any>({
    code: '', name: '', valuationMethod: 'fifo', inventoryAccountId: '', cogsAccountId: '',
    adjustmentAccountId: '', writeDownAccountId: '', allowNegativeStock: false,
  });
  const [locationForm, setLocationForm] = useState<any>({ code: '', name: '', description: '' });
  const [itemForm, setItemForm] = useState<any>({ categoryId: '', sku: '', name: '', unit: 'unit', reorderLevel: '' });
  const [writeDownForm, setWriteDownForm] = useState<any>({
    itemId: '', locationId: '', writeDownDate: today(), amount: '', reason: '', documentRef: '',
    journalId: '', kind: 'write_down',
  });
  const [countForm, setCountForm] = useState<any>({ locationId: '', countDate: today(), reference: '', notes: '', lines: [] as any[] });
  const [countLine, setCountLine] = useState({ itemId: '', countedQuantity: '', unitCost: '' });

  const activeAccounts = useMemo(() => accounts.filter((a) => a.is_active), [accounts]);
  const activeJournals = useMemo(() => journals.filter((j) => j.is_active), [journals]);
  const filteredMovements = useMemo(
    () => movements.filter((m) => !statusFilter || m.status === statusFilter),
    [movements, statusFilter],
  );
  const accountOptions = (types: string[]) => activeAccounts.filter((a) => types.includes(a.type));
  const categoryName = (id: string) => categories.find((c) => c.id === id)?.name ?? '—';

  async function loadCore() {
    if (!company) return;
    setLoading(true); setError(null);
    try {
      const [a, j, c, l, i] = await Promise.all([
        api.get<{ accounts: Account[] }>(`/companies/${company.id}/accounts`),
        api.get<{ journals: Journal[] }>(`/companies/${company.id}/journals`),
        api.get<{ categories: Category[] }>(`/companies/${company.id}/inventory/categories`),
        api.get<{ locations: Location[] }>(`/companies/${company.id}/inventory/locations`),
        api.get<{ items: Item[] }>(`/companies/${company.id}/inventory/items`),
      ]);
      setAccounts(a.accounts); setJournals(j.journals); setCategories(c.categories);
      setLocations(l.locations); setItems(i.items);
      setMovementForm((f: any) => ({ ...f, journalId: f.journalId || j.journals.find((x) => x.is_active)?.id || '',
        locationId: f.locationId || l.locations[0]?.id || '', itemId: f.itemId || i.items[0]?.id || '' }));
      setWriteDownForm((f: any) => ({ ...f, journalId: f.journalId || j.journals.find((x) => x.is_active)?.id || '',
        locationId: f.locationId || l.locations[0]?.id || '', itemId: f.itemId || i.items[0]?.id || '' }));
      setCountForm((f: any) => ({ ...f, locationId: f.locationId || l.locations[0]?.id || '' }));
      setCategoryForm((f: any) => ({ ...f,
        inventoryAccountId: f.inventoryAccountId || a.accounts.find((x) => x.code === '1300')?.id || '',
        cogsAccountId: f.cogsAccountId || a.accounts.find((x) => x.code === '5000')?.id || '',
        adjustmentAccountId: f.adjustmentAccountId || a.accounts.find((x) => x.code === '5100')?.id || '',
        writeDownAccountId: f.writeDownAccountId || a.accounts.find((x) => x.code === '6200')?.id || '' }));
    } catch (err: any) { setError(err?.message ?? 'Erreur'); }
    finally { setLoading(false); }
  }
  async function loadOperational() {
    if (!company) return;
    try {
      const [m, c, w] = await Promise.all([
        api.get<{ movements: Movement[] }>(`/companies/${company.id}/inventory/movements`),
        api.get<{ counts: Count[] }>(`/companies/${company.id}/inventory/counts`),
        api.get<{ writeDowns: WriteDown[] }>(`/companies/${company.id}/inventory/write-downs`),
      ]);
      setMovements(m.movements); setCounts(c.counts); setWriteDowns(w.writeDowns);
    } catch (err: any) { setError(err?.message ?? 'Erreur'); }
  }
  async function loadReports() {
    if (!company) return;
    setBusy(true); setActionError(null);
    try {
      const [r, rec] = await Promise.all([
        api.get<Report>(`/companies/${company.id}/inventory/report${qs({ asOf })}`),
        api.get<Recon>(`/companies/${company.id}/inventory/reconciliation${qs({ asOf })}`),
      ]);
      setReport(r); setRecon(rec);
    } catch (err: any) { setActionError(err?.message ?? 'Erreur'); }
    finally { setBusy(false); }
  }
  useEffect(() => { void loadCore(); }, [company?.id]);
  useEffect(() => { if (company && !loading) void loadOperational(); }, [company?.id, loading]);
  useEffect(() => { if (company && !loading) void loadReports(); }, [company?.id, loading, asOf]);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true); setActionError(null);
    try { await fn(); await loadOperational(); await loadCore(); }
    catch (err: any) { setActionError(err?.message ?? 'Erreur'); }
    finally { setBusy(false); }
  }
  async function saveCategory() {
    if (!company) return;
    await run(async () => {
      const body = {
        ...categoryForm,
        adjustmentAccountId: categoryForm.adjustmentAccountId || null,
        writeDownAccountId: categoryForm.writeDownAccountId || null,
      };
      if (editingCategory) {
        await api.put(`/companies/${company.id}/inventory/categories/${editingCategory}`, body);
      } else {
        await api.post(`/companies/${company.id}/inventory/categories`, body);
      }
      setCategoryModal(false);
      setEditingCategory(null);
    });
  }
  async function saveLocation() {
    if (!company) return;
    await run(async () => {
      const body = { ...locationForm, description: locationForm.description || null };
      if (editingLocation) {
        await api.put(`/companies/${company.id}/inventory/locations/${editingLocation}`, body);
      } else {
        await api.post(`/companies/${company.id}/inventory/locations`, body);
      }
      setLocationModal(false);
      setEditingLocation(null);
    });
  }
  async function saveItem() {
    if (!company) return;
    await run(async () => {
      const body = { ...itemForm, reorderLevel: itemForm.reorderLevel || null };
      if (editingItem) {
        await api.put(`/companies/${company.id}/inventory/items/${editingItem}`, body);
      } else {
        await api.post(`/companies/${company.id}/inventory/items`, body);
      }
      setItemModal(false);
      setEditingItem(null);
    });
  }

  function openCategory(c?: Category) {
    setEditingCategory(c?.id ?? null);
    setCategoryForm(c ? {
      code: c.code, name: c.name, valuationMethod: c.valuationMethod,
      inventoryAccountId: c.inventoryAccountId, cogsAccountId: c.cogsAccountId,
      adjustmentAccountId: c.adjustmentAccountId ?? '', writeDownAccountId: c.writeDownAccountId ?? '',
      allowNegativeStock: c.allowNegativeStock, isActive: c.isActive,
    } : {
      code: '', name: '', valuationMethod: 'fifo', inventoryAccountId: '',
      cogsAccountId: '', adjustmentAccountId: '', writeDownAccountId: '',
      allowNegativeStock: false, isActive: true,
    });
    setCategoryModal(true);
  }
  function openLocation(l?: Location) {
    setEditingLocation(l?.id ?? null);
    setLocationForm(l ? { code: l.code, name: l.name, description: l.description ?? '', isActive: l.isActive } : { code: '', name: '', description: '', isActive: true });
    setLocationModal(true);
  }
  function openItem(i?: Item) {
    setEditingItem(i?.id ?? null);
    setItemForm(i ? { categoryId: i.categoryId, sku: i.sku, name: i.name, unit: i.unit, reorderLevel: i.reorderLevel ?? '', isActive: i.isActive } : { categoryId: '', sku: '', name: '', unit: 'unit', reorderLevel: '', isActive: true });
    setItemModal(true);
  }
  async function createMovement() {
    if (!company) return;
    const transfer = movementForm.direction === 'transfer_out';
    await run(async () => {
      const path = transfer ? 'transfers' : 'movements';
      const body: any = {
        ...movementForm,
        quantity: movementForm.quantity,
        unitCost: movementForm.unitCost || null,
        counterpartAccountId: movementForm.counterpartAccountId || null,
        destinationLocationId: transfer ? movementForm.destinationLocationId : null,
      };
      if (transfer) { body.sourceKind = 'transfer'; body.unitCost = null; }
      await api.post(`/companies/${company.id}/inventory/${path}`, body);
      setMovementModal(false);
      setMovementForm({ ...emptyMovement, journalId: activeJournals[0]?.id ?? '', itemId: items[0]?.id ?? '', locationId: locations[0]?.id ?? '' });
    });
  }
  async function createWriteDown() {
    if (!company) return;
    await run(async () => {
      await api.post(`/companies/${company.id}/inventory/write-downs`, {
        ...writeDownForm, amount: writeDownForm.amount,
        reversesId: null,
      });
      setWriteDownModal(false);
    });
  }
  async function createCount() {
    if (!company) return;
    if (countForm.lines.length === 0) { setActionError(L('Ajoutez au moins une ligne comptée.', 'Add at least one counted line.')); return; }
    await run(async () => {
      await api.post(`/companies/${company.id}/inventory/counts`, {
        ...countForm, reference: countForm.reference || null, notes: countForm.notes || null,
        lines: countForm.lines.map((l: any) => ({ itemId: l.itemId, countedQuantity: l.countedQuantity, unitCost: l.unitCost || null })),
      });
      setCountModal(false);
      setCountForm({ locationId: locations[0]?.id ?? '', countDate: today(), reference: '', notes: '', lines: [] });
    });
  }
  async function confirmDecision() {
    if (!company || !decision) return;
    setBusy(true); setActionError(null);
    try {
      if (decision.action === 'post') await api.post(decision.path);
      else if (decision.action === 'approve') await api.post(decision.path, { confirm: true, note });
      else await api.post(decision.path, { reason: note });
      setDecision(null); setNote('');
      await loadOperational();
    } catch (err: any) { setActionError(err?.message ?? 'Erreur'); }
    finally { setBusy(false); }
  }

  if (!company) return <EmptyState title={L('Sélectionnez une société', 'Select a company')} />;
  if (loading) return <Spinner />;

  const tabs: [Tab, string][] = [
    ['stock', L('Stock', 'Stock')],
    ['movements', L('Mouvements', 'Movements')],
    ['counts', L('Inventaires physiques', 'Physical counts')],
    ['writeDowns', L('Dépréciations', 'Write-downs')],
    ['reports', L('Rapports', 'Reports')],
    ['settings', L('Paramètres', 'Settings')],
  ];

  return (
    <div>
      <div className="page-head">
        <div className="grow">
          <h1>{L('Stocks', 'Inventory')}</h1>
          <div className="page-sub">{L('Sous-registre FIFO ou coût moyen pondéré, mouvements approuvés par un humain et rapprochement avec le grand livre.', 'FIFO or weighted-average subledger, human-approved movements and reconciliation with the general ledger.')}</div>
        </div>
        <Button variant="primary" onClick={() => setMovementModal(true)}>{L('Nouveau mouvement', 'New movement')}</Button>
      </div>
      <DemoNotice />
      <div className="alert alert-warn">{L('Aucune règle de valorisation statutaire n’est présumée. Toute écriture est proposée puis approuvée et comptabilisée par un humain ; une période clôturée reste protégée.', 'No statutory valuation rule is presumed. Every entry is proposed, then approved and posted by a human; a closed period remains protected.')}</div>
      <ErrorBanner message={error ?? actionError} />
      <div className="tabs" role="tablist">
        {tabs.map(([value, label]) => (
          <button key={value} role="tab" aria-selected={tab === value} className={tab === value ? 'tab active' : 'tab'} onClick={() => setTab(value)}>{label}</button>
        ))}
      </div>

      {tab === 'stock' && (
        <>
          <Card title={L('Valorisation du stock', 'Stock valuation')} actions={<Button onClick={() => void loadReports()}>{L('Calculer', 'Calculate')}</Button>}>
            <div className="form-row">
              <Field label={L('À la date', 'As of')}><input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} /></Field>
              <Field label={L('Devise', 'Currency')}><input value={company.functional_currency} readOnly /></Field>
            </div>
            <div className="kpi-grid">
              <div className="kpi"><div className="kpi-label">{L('Quantité', 'Quantity')}</div><div className="kpi-value">{report?.totals.quantity ?? '—'}</div></div>
              <div className="kpi"><div className="kpi-label">{L('Valeur', 'Value')}</div><div className="kpi-value">{report ? money(report.totals.value, locale, company.functional_currency) : '—'}</div></div>
              <div className={recon && !recon.balanced ? 'kpi kpi-danger' : 'kpi'}><div className="kpi-label">{L('Rapprochement', 'Reconciliation')}</div><div className="kpi-value">{recon ? (recon.balanced ? L('Équilibré', 'Balanced') : L('Écart', 'Difference')) : '—'}</div></div>
            </div>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>SKU</th><th>{L('Article', 'Item')}</th><th>{L('Catégorie', 'Category')}</th><th>{L('Emplacement', 'Location')}</th><th>{L('Méthode', 'Method')}</th><th className="num">{L('Quantité', 'Quantity')}</th><th className="num">{L('Coût unitaire', 'Unit cost')}</th><th className="num">{L('Valeur', 'Value')}</th></tr></thead>
                <tbody>
                  {(report?.rows ?? []).map((r) => (
                    <tr key={`${r.sku}-${r.location.code}`}>
                      <td className="mono">{r.sku}</td><td>{r.name}</td><td>{r.category.code}</td><td>{r.location.code}</td>
                      <td>{r.category.valuationMethod === 'fifo' ? 'FIFO' : L('Coût moyen', 'Weighted average')}</td>
                      <td className="num">{r.quantity}</td><td className="num">{money(r.unitCost, locale, company.functional_currency)}</td>
                      <td className="num">{money(r.value, locale, company.functional_currency)}</td>
                    </tr>
                  ))}
                  {(report?.rows ?? []).length === 0 && <tr><td colSpan={8} className="page-sub">{L('Aucun stock valorisé à cette date.', 'No valued stock at this date.')}</td></tr>}
                </tbody>
              </table>
            </div>
            {report && <p className="page-sub">{report.note}</p>}
          </Card>

          {recon && (
            <Card title={L('Rapprochement sous-registre ↔ grand livre', 'Subledger ↔ general-ledger reconciliation')}>
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>{L('Compte', 'Account')}</th><th>{L('Catégories', 'Categories')}</th><th className="num">{L('Sous-registre', 'Subledger')}</th><th className="num">{L('Grand livre', 'Ledger')}</th><th className="num">{L('Écart', 'Difference')}</th><th>{L('État', 'State')}</th></tr></thead>
                  <tbody>
                    {recon.rows.map((r) => (
                      <tr key={r.account.code}>
                        <td>{r.account.code} — {r.account.name}</td><td>{r.categories.map((c) => c.code).join(', ')}</td>
                        <td className="num">{money(r.subledgerValue, locale, company.functional_currency)}</td>
                        <td className="num">{money(r.ledgerBalance, locale, company.functional_currency)}</td>
                        <td className="num">{money(r.difference, locale, company.functional_currency)}</td>
                        <td><Badge kind={r.balanced ? 'success' : 'danger'}>{r.balanced ? L('Équilibré', 'Balanced') : L('Écart', 'Difference')}</Badge></td>
                      </tr>
                    ))}
                    {recon.rows.length === 0 && <tr><td colSpan={6} className="page-sub">{L('Aucune catégorie configurée.', 'No category configured.')}</td></tr>}
                  </tbody>
                </table>
              </div>
              <p className="page-sub">{recon.note}</p>
              <Button onClick={() => void downloadExport(`/companies/${company.id}/inventory/report.csv${qs({ asOf })}`, 'inventory.csv', 'csv')}>{L('Exporter la valorisation (CSV)', 'Export valuation (CSV)')}</Button>
            </Card>
          )}
        </>
      )}

      {tab === 'movements' && (
        <Card title={L('Mouvements de stock', 'Inventory movements')} actions={<Button onClick={() => void loadOperational()}>{L('Actualiser', 'Refresh')}</Button>}>
          <div className="form-row">
            <Field label={L('Statut', 'Status')}>
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                <option value="">{L('Tous', 'All')}</option>
                {['PROPOSED', 'APPROVED', 'POSTED', 'REJECTED'].map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>{L('N°', 'No.')}</th><th>{L('Date', 'Date')}</th><th>{L('Article', 'Item')}</th><th>{L('Sens', 'Direction')}</th><th>{L('Emplacement', 'Location')}</th><th className="num">{L('Quantité', 'Quantity')}</th><th className="num">{L('Valeur', 'Value')}</th><th>{L('Statut', 'Status')}</th><th>{L('Actions', 'Actions')}</th></tr></thead>
              <tbody>
                {filteredMovements.map((m) => (
                  <tr key={m.id}>
                    <td className="mono">{m.movementNo}</td><td>{m.movementDate}</td><td>{m.item.sku}</td>
                    <td>{directionLabel(m.direction)}</td>
                    <td>{m.location.code}{m.destination ? ` → ${m.destination.code}` : ''}</td>
                    <td className="num">{m.quantity}</td><td className="num">{m.value ? money(m.value, locale, company.functional_currency) : '—'}</td>
                    <td><Badge kind={statusKind(m.status)}>{m.status}</Badge>{m.entryNo && <div className="page-sub mono">{m.entryNo}</div>}</td>
                    <td>
                      {m.status === 'PROPOSED' && <>
                        <Button variant="link" onClick={() => { setDecision({ path: `/companies/${company.id}/inventory/movements/${m.id}/approve`, action: 'approve', title: L('Approuver le mouvement', 'Approve movement') }); setNote(''); }}>{L('Approuver', 'Approve')}</Button>
                        <Button variant="link" onClick={() => { setDecision({ path: `/companies/${company.id}/inventory/movements/${m.id}/reject`, action: 'reject', title: L('Rejeter le mouvement', 'Reject movement') }); setNote(''); }}>{L('Rejeter', 'Reject')}</Button>
                      </>}
                      {m.status === 'APPROVED' && <Button variant="link" onClick={() => { setDecision({ path: `/companies/${company.id}/inventory/movements/${m.id}/post`, action: 'post', title: L('Comptabiliser le mouvement', 'Post movement') }); setNote(''); }}>{L('Comptabiliser', 'Post')}</Button>}
                    </td>
                  </tr>
                ))}
                {filteredMovements.length === 0 && <tr><td colSpan={9} className="page-sub">{L('Aucun mouvement.', 'No movement.')}</td></tr>}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {tab === 'counts' && (
        <Card title={L('Inventaires physiques', 'Physical counts')} actions={<Button onClick={() => setCountModal(true)}>{L('Nouvel inventaire', 'New count')}</Button>}>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>{L('N°', 'No.')}</th><th>{L('Date', 'Date')}</th><th>{L('Emplacement', 'Location')}</th><th>{L('Référence', 'Reference')}</th><th>{L('Lignes', 'Lines')}</th><th>{L('Statut', 'Status')}</th><th>{L('Actions', 'Actions')}</th></tr></thead>
              <tbody>
                {counts.map((c) => (
                  <tr key={c.id}>
                    <td className="mono">{c.countNo}</td><td>{c.countDate}</td><td>{c.location.code}</td>
                    <td>{c.reference ?? '—'}</td><td>{c.lineCount}</td><td><Badge kind={statusKind(c.status)}>{c.status}</Badge></td>
                    <td>{c.status === 'DRAFT' && <Button variant="link" onClick={() => void run(async () => {
                      const result: any = await api.post(`/companies/${company.id}/inventory/counts/${c.id}/generate-adjustments`);
                      for (const id of result.movements ?? []) {
                        await api.post(`/companies/${company.id}/inventory/movements/${id}/approve`, { confirm: true, note: L('Approbation fictive après comptage physique.', 'Fictitious approval after physical count.') });
                      }
                    })}>{L('Générer les ajustements', 'Generate adjustments')}</Button>}</td>
                  </tr>
                ))}
                {counts.length === 0 && <tr><td colSpan={7} className="page-sub">{L('Aucun inventaire physique.', 'No physical count.')}</td></tr>}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {tab === 'writeDowns' && (
        <Card title={L('Dépréciations et reprises', 'Write-downs and reversals')} actions={<Button onClick={() => setWriteDownModal(true)}>{L('Nouvelle dépréciation', 'New write-down')}</Button>}>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>{L('N°', 'No.')}</th><th>{L('Date', 'Date')}</th><th>{L('Article', 'Item')}</th><th>{L('Type', 'Type')}</th><th className="num">{L('Montant', 'Amount')}</th><th>{L('Justificatif', 'Document')}</th><th>{L('Statut', 'Status')}</th><th>{L('Actions', 'Actions')}</th></tr></thead>
              <tbody>
                {writeDowns.map((w) => (
                  <tr key={w.id}>
                    <td className="mono">{w.writeDownNo}</td><td>{w.writeDownDate}</td><td>{w.item.sku}</td>
                    <td>{w.kind === 'reversal' ? L('Reprise', 'Reversal') : L('Dépréciation', 'Write-down')}</td>
                    <td className="num">{money(w.amount, locale, company.functional_currency)}</td><td className="mono">{w.documentRef}</td>
                    <td><Badge kind={statusKind(w.status)}>{w.status}</Badge>{w.entryNo && <div className="page-sub mono">{w.entryNo}</div>}</td>
                    <td>
                      {w.status === 'PROPOSED' && <>
                        <Button variant="link" onClick={() => { setDecision({ path: `/companies/${company.id}/inventory/write-downs/${w.id}/approve`, action: 'approve', title: L('Approuver la dépréciation', 'Approve write-down') }); setNote(''); }}>{L('Approuver', 'Approve')}</Button>
                        <Button variant="link" onClick={() => { setDecision({ path: `/companies/${company.id}/inventory/write-downs/${w.id}/reject`, action: 'reject', title: L('Rejeter la dépréciation', 'Reject write-down') }); setNote(''); }}>{L('Rejeter', 'Reject')}</Button>
                      </>}
                      {w.status === 'APPROVED' && <Button variant="link" onClick={() => { setDecision({ path: `/companies/${company.id}/inventory/write-downs/${w.id}/post`, action: 'post', title: L('Comptabiliser la dépréciation', 'Post write-down') }); setNote(''); }}>{L('Comptabiliser', 'Post')}</Button>}
                    </td>
                  </tr>
                ))}
                {writeDowns.length === 0 && <tr><td colSpan={8} className="page-sub">{L('Aucune dépréciation.', 'No write-down.')}</td></tr>}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {tab === 'reports' && (
        <Card title={L('Rapports de stock', 'Inventory reports')} actions={<Button onClick={() => void loadReports()}>{L('Calculer', 'Calculate')}</Button>}>
          <div className="form-row">
            <Field label={L('À la date', 'As of')}><input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} /></Field>
            <Button onClick={() => void downloadExport(`/companies/${company.id}/inventory/report.csv${qs({ asOf })}`, 'inventory.csv', 'csv')}>{L('CSV', 'CSV')}</Button>
            <Button onClick={() => window.print()}>{L('PDF (impression)', 'PDF (print)')}</Button>
          </div>
          {report && (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>SKU</th><th>{L('Article', 'Item')}</th><th>{L('Emplacement', 'Location')}</th><th className="num">{L('Quantité', 'Quantity')}</th><th className="num">{L('Valeur', 'Value')}</th></tr></thead>
                <tbody>
                  {report.rows.map((r) => <tr key={`${r.sku}-${r.location.code}`}><td className="mono">{r.sku}</td><td>{r.name}</td><td>{r.location.code}</td><td className="num">{r.quantity}</td><td className="num">{money(r.value, locale, company.functional_currency)}</td></tr>)}
                </tbody>
              </table>
            </div>
          )}
          <p className="page-sub">{L('Le PDF de démonstration ouvre la boîte d’impression du navigateur ; aucun PDF serveur n’est simulé.', 'The demonstration PDF opens the browser print dialog; no server PDF is simulated.')}</p>
        </Card>
      )}

      {tab === 'settings' && (
        <>
          <Card title={L('Catégories', 'Categories')} actions={<Button onClick={() => openCategory()}>{L('Nouvelle catégorie', 'New category')}</Button>}>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>{L('Code', 'Code')}</th><th>{L('Nom', 'Name')}</th><th>{L('Méthode', 'Method')}</th><th>{L('Compte stock', 'Stock account')}</th><th>{L('Compte COGS', 'COGS account')}</th><th>{L('Stock négatif', 'Negative stock')}</th><th>{L('Actions', 'Actions')}</th></tr></thead>
                <tbody>{categories.map((c) => <tr key={c.id}><td className="mono">{c.code}</td><td>{c.name}</td><td>{c.valuationMethod === 'fifo' ? 'FIFO' : L('Coût moyen', 'Weighted average')}</td><td>{accounts.find((a) => a.id === c.inventoryAccountId)?.code ?? '—'}</td><td>{accounts.find((a) => a.id === c.cogsAccountId)?.code ?? '—'}</td><td>{c.allowNegativeStock ? L('Autorisé', 'Allowed') : L('Refusé', 'Refused')}</td><td><Button variant="link" onClick={() => openCategory(c)}>{L('Modifier', 'Edit')}</Button></td></tr>)}
              {categories.length === 0 && <tr><td colSpan={7} className="page-sub">{L('Aucune catégorie.', 'No category.')}</td></tr>}</tbody>
              </table>
            </div>
          </Card>
          <Card title={L('Emplacements', 'Locations')} actions={<Button onClick={() => openLocation()}>{L('Nouvel emplacement', 'New location')}</Button>}>
            <div className="table-wrap"><table className="table"><thead><tr><th>{L('Code', 'Code')}</th><th>{L('Nom', 'Name')}</th><th>{L('Description', 'Description')}</th><th>{L('Actions', 'Actions')}</th></tr></thead>
              <tbody>{locations.map((l) => <tr key={l.id}><td className="mono">{l.code}</td><td>{l.name}</td><td>{l.description ?? '—'}</td><td><Button variant="link" onClick={() => openLocation(l)}>{L('Modifier', 'Edit')}</Button></td></tr>)}
              {locations.length === 0 && <tr><td colSpan={4} className="page-sub">{L('Aucun emplacement.', 'No location.')}</td></tr>}</tbody></table></div>
          </Card>
          <Card title={L('Articles', 'Items')} actions={<Button onClick={() => openItem()}>{L('Nouvel article', 'New item')}</Button>}>
            <div className="table-wrap"><table className="table"><thead><tr><th>SKU</th><th>{L('Nom', 'Name')}</th><th>{L('Catégorie', 'Category')}</th><th>{L('Unité', 'Unit')}</th><th className="num">{L('Seuil de réappro.', 'Reorder level')}</th><th>{L('Actions', 'Actions')}</th></tr></thead>
              <tbody>{items.map((i) => <tr key={i.id}><td className="mono">{i.sku}</td><td>{i.name}</td><td>{categoryName(i.categoryId)}</td><td>{i.unit}</td><td className="num">{i.reorderLevel ?? '—'}</td><td><Button variant="link" onClick={() => openItem(i)}>{L('Modifier', 'Edit')}</Button></td></tr>)}
              {items.length === 0 && <tr><td colSpan={6} className="page-sub">{L('Aucun article.', 'No item.')}</td></tr>}</tbody></table></div>
          </Card>
        </>
      )}

      <Modal open={movementModal} title={L('Nouveau mouvement', 'New movement')} onClose={() => setMovementModal(false)} wide>
        <div className="form-row">
          <Field label={L('Article', 'Item')}><select value={movementForm.itemId} onChange={(e) => setMovementForm({ ...movementForm, itemId: e.target.value })}>{items.map((i) => <option key={i.id} value={i.id}>{i.sku} — {i.name}</option>)}</select></Field>
          <Field label={L('Emplacement', 'Location')}><select value={movementForm.locationId} onChange={(e) => setMovementForm({ ...movementForm, locationId: e.target.value })}>{locations.map((l) => <option key={l.id} value={l.id}>{l.code}</option>)}</select></Field>
          <Field label={L('Date', 'Date')}><input type="date" value={movementForm.movementDate} onChange={(e) => setMovementForm({ ...movementForm, movementDate: e.target.value })} /></Field>
        </div>
        <div className="form-row">
          <Field label={L('Sens', 'Direction')}><select value={movementForm.direction} onChange={(e) => setMovementForm({ ...movementForm, direction: e.target.value, sourceKind: e.target.value === 'transfer_out' ? 'transfer' : e.target.value === 'in' ? 'receipt' : 'issue' })}>
            <option value="in">{L('Entrée', 'In')}</option><option value="out">{L('Sortie', 'Out')}</option>
            <option value="adjustment_in">{L('Ajustement +', 'Adjustment +')}</option><option value="adjustment_out">{L('Ajustement −', 'Adjustment −')}</option>
            <option value="transfer_out">{L('Transfert', 'Transfer')}</option>
          </select></Field>
          <Field label={L('Quantité', 'Quantity')}><input type="number" min="0" step="0.0001" value={movementForm.quantity} onChange={(e) => setMovementForm({ ...movementForm, quantity: e.target.value })} /></Field>
          {['in', 'adjustment_in'].includes(movementForm.direction) && <Field label={L('Coût unitaire', 'Unit cost')}><input type="number" min="0" step="0.0001" value={movementForm.unitCost} onChange={(e) => setMovementForm({ ...movementForm, unitCost: e.target.value })} /></Field>}
          {movementForm.direction === 'transfer_out' && <Field label={L('Destination', 'Destination')}><select value={movementForm.destinationLocationId} onChange={(e) => setMovementForm({ ...movementForm, destinationLocationId: e.target.value })}><option value="">—</option>{locations.filter((l) => l.id !== movementForm.locationId).map((l) => <option key={l.id} value={l.id}>{l.code}</option>)}</select></Field>}
        </div>
        <Field label={L('Description', 'Description')}><input value={movementForm.description} onChange={(e) => setMovementForm({ ...movementForm, description: e.target.value })} /></Field>
        <div className="form-row">
          <Field label={L('Justificatif', 'Document reference')}><input value={movementForm.documentRef} onChange={(e) => setMovementForm({ ...movementForm, documentRef: e.target.value })} /></Field>
          <Field label={L('Journal', 'Journal')}><select value={movementForm.journalId} onChange={(e) => setMovementForm({ ...movementForm, journalId: e.target.value })}>{activeJournals.map((j) => <option key={j.id} value={j.id}>{j.code} — {j.name}</option>)}</select></Field>
          <Field label={L('Contrepartie (entrée / ajustement)', 'Counterpart (in / adjustment)')}><select value={movementForm.counterpartAccountId} onChange={(e) => setMovementForm({ ...movementForm, counterpartAccountId: e.target.value })}><option value="">{L('Compte de résultat (sortie)', 'Profit-or-loss account (issue)')}</option>{accountOptions(['asset', 'liability', 'equity', 'expense', 'revenue']).map((a) => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}</select></Field>
        </div>
        <p className="page-sub">{L('Le mouvement est créé à l’état proposé. Il ne modifie ni le stock ni le grand livre avant approbation et comptabilisation.', 'The movement is created as proposed. It changes neither stock nor the ledger before approval and posting.')}</p>
        <Button variant="primary" disabled={busy} onClick={() => void createMovement()}>{L('Créer le mouvement', 'Create movement')}</Button>
      </Modal>

      <Modal open={categoryModal} title={editingCategory ? L('Modifier la catégorie', 'Edit category') : L('Nouvelle catégorie', 'New category')} onClose={() => { setCategoryModal(false); setEditingCategory(null); }}>
        <Field label={L('Code', 'Code')}><input value={categoryForm.code} onChange={(e) => setCategoryForm({ ...categoryForm, code: e.target.value })} /></Field>
        <Field label={L('Nom', 'Name')}><input value={categoryForm.name} onChange={(e) => setCategoryForm({ ...categoryForm, name: e.target.value })} /></Field>
        <Field label={L('Méthode de valorisation', 'Valuation method')}><select value={categoryForm.valuationMethod} onChange={(e) => setCategoryForm({ ...categoryForm, valuationMethod: e.target.value })}><option value="fifo">FIFO</option><option value="weighted_average">{L('Coût moyen pondéré', 'Weighted average')}</option></select></Field>
        <Field label={L('Compte de stock', 'Inventory account')}><select value={categoryForm.inventoryAccountId} onChange={(e) => setCategoryForm({ ...categoryForm, inventoryAccountId: e.target.value })}>{accountOptions(['asset']).map((a) => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}</select></Field>
        <Field label={L('Compte COGS', 'COGS account')}><select value={categoryForm.cogsAccountId} onChange={(e) => setCategoryForm({ ...categoryForm, cogsAccountId: e.target.value })}>{accountOptions(['expense']).map((a) => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}</select></Field>
        <Field label={L('Compte d’ajustement', 'Adjustment account')}><select value={categoryForm.adjustmentAccountId} onChange={(e) => setCategoryForm({ ...categoryForm, adjustmentAccountId: e.target.value })}><option value="">—</option>{accountOptions(['expense', 'revenue']).map((a) => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}</select></Field>
        <Field label={L('Compte de dépréciation', 'Write-down account')}><select value={categoryForm.writeDownAccountId} onChange={(e) => setCategoryForm({ ...categoryForm, writeDownAccountId: e.target.value })}><option value="">—</option>{accountOptions(['expense']).map((a) => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}</select></Field>
        <label className="checkbox"><input type="checkbox" checked={categoryForm.allowNegativeStock} onChange={(e) => setCategoryForm({ ...categoryForm, allowNegativeStock: e.target.checked })} /> {L('Autoriser un stock négatif (déconseillé)', 'Allow negative stock (not recommended)')}</label>
        <Button variant="primary" disabled={busy} onClick={() => void saveCategory()}>{L('Enregistrer', 'Save')}</Button>
      </Modal>

      <Modal open={locationModal} title={editingLocation ? L('Modifier l’emplacement', 'Edit location') : L('Nouvel emplacement', 'New location')} onClose={() => { setLocationModal(false); setEditingLocation(null); }}>
        <Field label={L('Code', 'Code')}><input value={locationForm.code} onChange={(e) => setLocationForm({ ...locationForm, code: e.target.value })} /></Field>
        <Field label={L('Nom', 'Name')}><input value={locationForm.name} onChange={(e) => setLocationForm({ ...locationForm, name: e.target.value })} /></Field>
        <Field label={L('Description', 'Description')}><input value={locationForm.description} onChange={(e) => setLocationForm({ ...locationForm, description: e.target.value })} /></Field>
        <Button variant="primary" disabled={busy} onClick={() => void saveLocation()}>{L('Enregistrer', 'Save')}</Button>
      </Modal>

      <Modal open={itemModal} title={editingItem ? L('Modifier l’article', 'Edit item') : L('Nouvel article', 'New item')} onClose={() => { setItemModal(false); setEditingItem(null); }}>
        <Field label={L('Catégorie', 'Category')}><select value={itemForm.categoryId} onChange={(e) => setItemForm({ ...itemForm, categoryId: e.target.value })}><option value="">—</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}</select></Field>
        <Field label="SKU"><input value={itemForm.sku} onChange={(e) => setItemForm({ ...itemForm, sku: e.target.value })} /></Field>
        <Field label={L('Nom', 'Name')}><input value={itemForm.name} onChange={(e) => setItemForm({ ...itemForm, name: e.target.value })} /></Field>
        <Field label={L('Unité', 'Unit')}><input value={itemForm.unit} onChange={(e) => setItemForm({ ...itemForm, unit: e.target.value })} /></Field>
        <Field label={L('Seuil de réapprovisionnement', 'Reorder level')}><input type="number" min="0" step="0.0001" value={itemForm.reorderLevel} onChange={(e) => setItemForm({ ...itemForm, reorderLevel: e.target.value })} /></Field>
        <Button variant="primary" disabled={busy} onClick={() => void saveItem()}>{L('Enregistrer', 'Save')}</Button>
      </Modal>

      <Modal open={countModal} title={L('Nouvel inventaire physique', 'New physical count')} onClose={() => setCountModal(false)} wide>
        <div className="form-row">
          <Field label={L('Emplacement', 'Location')}><select value={countForm.locationId} onChange={(e) => setCountForm({ ...countForm, locationId: e.target.value })}>{locations.map((l) => <option key={l.id} value={l.id}>{l.code}</option>)}</select></Field>
          <Field label={L('Date', 'Date')}><input type="date" value={countForm.countDate} onChange={(e) => setCountForm({ ...countForm, countDate: e.target.value })} /></Field>
          <Field label={L('Référence', 'Reference')}><input value={countForm.reference} onChange={(e) => setCountForm({ ...countForm, reference: e.target.value })} /></Field>
        </div>
        <div className="form-row">
          <Field label={L('Article compté', 'Counted item')}><select value={countLine.itemId} onChange={(e) => setCountLine({ ...countLine, itemId: e.target.value })}><option value="">—</option>{items.map((i) => <option key={i.id} value={i.id}>{i.sku}</option>)}</select></Field>
          <Field label={L('Quantité comptée', 'Counted quantity')}><input type="number" min="0" step="0.0001" value={countLine.countedQuantity} onChange={(e) => setCountLine({ ...countLine, countedQuantity: e.target.value })} /></Field>
          <Field label={L('Coût unitaire (si stock nouveau)', 'Unit cost (if new stock)')}><input type="number" min="0" step="0.0001" value={countLine.unitCost} onChange={(e) => setCountLine({ ...countLine, unitCost: e.target.value })} /></Field>
          <Button onClick={() => {
            if (!countLine.itemId || !countLine.countedQuantity) return;
            setCountForm({ ...countForm, lines: [...countForm.lines, { ...countLine }] });
            setCountLine({ itemId: '', countedQuantity: '', unitCost: '' });
          }}>{L('Ajouter la ligne', 'Add line')}</Button>
        </div>
        <div className="table-wrap"><table className="table"><thead><tr><th>{L('Article', 'Item')}</th><th className="num">{L('Compté', 'Counted')}</th><th className="num">{L('Coût', 'Cost')}</th><th /></tr></thead>
          <tbody>{countForm.lines.map((l: any, index: number) => <tr key={`${l.itemId}-${index}`}><td>{items.find((i) => i.id === l.itemId)?.sku ?? l.itemId}</td><td className="num">{l.countedQuantity}</td><td className="num">{l.unitCost || '—'}</td><td><Button variant="link" onClick={() => setCountForm({ ...countForm, lines: countForm.lines.filter((_: any, i: number) => i !== index) })}>{L('Retirer', 'Remove')}</Button></td></tr>)}
          {countForm.lines.length === 0 && <tr><td colSpan={4} className="page-sub">{L('Aucune ligne.', 'No line.')}</td></tr>}</tbody></table></div>
        <Button variant="primary" disabled={busy} onClick={() => void createCount()}>{L('Créer l’inventaire', 'Create count')}</Button>
      </Modal>

      <Modal open={writeDownModal} title={L('Nouvelle dépréciation', 'New write-down')} onClose={() => setWriteDownModal(false)}>
        <Field label={L('Article', 'Item')}><select value={writeDownForm.itemId} onChange={(e) => setWriteDownForm({ ...writeDownForm, itemId: e.target.value })}>{items.map((i) => <option key={i.id} value={i.id}>{i.sku}</option>)}</select></Field>
        <Field label={L('Emplacement', 'Location')}><select value={writeDownForm.locationId} onChange={(e) => setWriteDownForm({ ...writeDownForm, locationId: e.target.value })}>{locations.map((l) => <option key={l.id} value={l.id}>{l.code}</option>)}</select></Field>
        <Field label={L('Date', 'Date')}><input type="date" value={writeDownForm.writeDownDate} onChange={(e) => setWriteDownForm({ ...writeDownForm, writeDownDate: e.target.value })} /></Field>
        <Field label={L('Montant', 'Amount')}><input type="number" min="0" step="0.0001" value={writeDownForm.amount} onChange={(e) => setWriteDownForm({ ...writeDownForm, amount: e.target.value })} /></Field>
        <Field label={L('Motif documenté', 'Documented reason')}><textarea rows={2} value={writeDownForm.reason} onChange={(e) => setWriteDownForm({ ...writeDownForm, reason: e.target.value })} /></Field>
        <Field label={L('Justificatif', 'Document reference')}><input value={writeDownForm.documentRef} onChange={(e) => setWriteDownForm({ ...writeDownForm, documentRef: e.target.value })} /></Field>
        <Field label={L('Journal', 'Journal')}><select value={writeDownForm.journalId} onChange={(e) => setWriteDownForm({ ...writeDownForm, journalId: e.target.value })}>{activeJournals.map((j) => <option key={j.id} value={j.id}>{j.code}</option>)}</select></Field>
        <Button variant="primary" disabled={busy} onClick={() => void createWriteDown()}>{L('Proposer', 'Propose')}</Button>
      </Modal>

      <Modal open={!!decision} title={decision?.title ?? ''} onClose={() => setDecision(null)}>
        <p className="page-sub">{decision?.action === 'post'
          ? L('La comptabilisation est définitive et protégée par la période ouverte.', 'Posting is final and protected by the open period.')
          : L('Une note humaine d’au moins 10 caractères est requise.', 'A human note of at least 10 characters is required.')}</p>
        {decision?.action !== 'post' && <Field label={L('Note / motif', 'Note / reason')}><textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} /></Field>}
        <Button variant="primary" disabled={busy} onClick={() => void confirmDecision()}>{L('Confirmer', 'Confirm')}</Button>
      </Modal>
    </div>
  );
}
