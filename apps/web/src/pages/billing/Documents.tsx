import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../../api';
import { useI18n } from '../../i18n';
import { errorMessage, useSession } from '../../store';
import { Badge, Button, Card, EmptyState, ErrorBanner, Field, Modal, Spinner } from '../../components/ui';
import { money, scaled4ToString, toScaled4 } from '../../format';
import type { BillingDocument, BillingKind, Customer, DocumentLine, Item } from './types';
import { emptyLine } from './types';

interface StockItem { id: string; sku: string; name: string; isActive: boolean }
interface StockLocation { id: string; code: string; name: string; isActive: boolean }
interface StockJournal { id: string; code: string; name: string; is_active: boolean }
interface StockLine {
  billingLineId: string; description: string; invoicedQty: string;
  itemId: string; locationId: string; quantity: string;
}

const TITLES: Record<BillingKind, string> = {
  quote: 'nav.billing.quotes',
  invoice: 'nav.billing.invoices',
  credit_note: 'nav.billing.creditNotes',
};

const SUBTITLES: Record<BillingKind, string> = {
  quote: 'billing.quotes.sub',
  invoice: 'billing.invoices.sub',
  credit_note: 'billing.creditNotes.sub',
};

const statusKind = (status: string): 'neutral' | 'success' | 'warning' | 'danger' | 'info' =>
  status === 'paid'
    ? 'success'
    : status === 'partially_paid'
      ? 'info'
      : status === 'issued' || status === 'sent'
        ? 'warning'
        : status === 'cancelled' || status === 'refused'
          ? 'danger'
          : 'neutral';

export default function BillingDocumentsPage({ kind }: { kind: BillingKind }) {
  const { t, locale } = useI18n();
  const { company } = useSession();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const targetDocument = searchParams.get('document');
  const targetOpened = useRef(false);
  const [documents, setDocuments] = useState<BillingDocument[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<BillingDocument | null>(null);
  const [form, setForm] = useState({
    customerId: '',
    issueDate: new Date().toISOString().slice(0, 10),
    dueDate: '',
    currency: 'MUR',
    exchangeRate: '',
    notes: '',
  });
  const [lines, setLines] = useState<DocumentLine[]>([emptyLine()]);
  const [stockOpen, setStockOpen] = useState(false);
  const [stockBusy, setStockBusy] = useState(false);
  const [stockItems, setStockItems] = useState<StockItem[]>([]);
  const [stockLocations, setStockLocations] = useState<StockLocation[]>([]);
  const [stockJournals, setStockJournals] = useState<StockJournal[]>([]);
  const [stockJournalId, setStockJournalId] = useState('');
  const [stockLines, setStockLines] = useState<StockLine[]>([]);
  const [stockNotice, setStockNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!company) return;
    setLoading(true);
    try {
      const [docRes, customerRes, itemRes] = await Promise.all([
        api.get<{ documents: BillingDocument[] }>(`/companies/${company.id}/billing/documents?kind=${kind}`),
        api.get<{ customers: Customer[] }>(`/companies/${company.id}/billing/customers`),
        api.get<{ items: Item[] }>(`/companies/${company.id}/billing/items`),
      ]);
      setDocuments(docRes.documents);
      setCustomers(customerRes.customers);
      setItems(itemRes.items.filter((i) => i.isActive));
      if (targetDocument && !targetOpened.current) {
        const found = docRes.documents.find((d) => d.number === targetDocument);
        if (found) {
          const detailRes = await api.get<{ document: BillingDocument }>(
            `/companies/${company.id}/billing/documents/${found.id}`,
          );
          setDetail(detailRes.document);
          targetOpened.current = true;
        }
      }
      setError(null);
    } catch (err) {
      setError(errorMessage(err, t('common.error')).message);
    } finally {
      setLoading(false);
    }
  }, [company?.id, kind, t, targetDocument]);

  useEffect(() => {
    void load();
  }, [load]);

  const openInvoices = useMemo(
    () => documents.filter((d) => d.kind === 'invoice' && ['issued', 'partially_paid'].includes(d.status)),
    [documents],
  );

  const openStockBridge = async (doc: BillingDocument) => {
    if (!company) return;
    setStockBusy(true);
    setError(null);
    setStockNotice(null);
    try {
      const [invItems, invLocations, invJournals] = await Promise.all([
        api.get<{ items: StockItem[] }>(`/companies/${company.id}/inventory/items`),
        api.get<{ locations: StockLocation[] }>(`/companies/${company.id}/inventory/locations`),
        api.get<{ journals: StockJournal[] }>(`/companies/${company.id}/journals`),
      ]);
      const activeItems = invItems.items.filter((i) => i.isActive);
      const activeLocations = invLocations.locations.filter((l) => l.isActive);
      const activeJournals = invJournals.journals.filter((j) => j.is_active);
      if (activeItems.length === 0 || activeLocations.length === 0 || activeJournals.length === 0) {
        setError(t('inventory.noStockMaster'));
        return;
      }
      setStockItems(activeItems);
      setStockLocations(activeLocations);
      setStockJournals(activeJournals);
      setStockJournalId(activeJournals[0]!.id);
      setStockLines(doc.lines.filter((l) => l.id).map((l) => {
        const billingItem = l.itemId ? items.find((i) => i.id === l.itemId) : undefined;
        const reference = billingItem?.reference?.trim().toLowerCase();
        const candidate = reference
          ? activeItems.find((i) => i.sku.trim().toLowerCase() === reference)
          : activeItems.find((i) => i.name.trim().toLowerCase() === l.description.trim().toLowerCase());
        return {
          billingLineId: l.id!,
          description: l.description,
          invoicedQty: l.quantity,
          itemId: candidate?.id ?? '',
          locationId: activeLocations[0]!.id,
          quantity: l.quantity,
        };
      }));
      setStockOpen(true);
    } catch (err) {
      setError(errorMessage(err, t('common.error')).message);
    } finally {
      setStockBusy(false);
    }
  };

  const submitStockBridge = async () => {
    if (!company || !detail) return;
    const mapped = stockLines.filter((l) => l.itemId && l.locationId && Number(l.quantity) > 0);
    if (mapped.length === 0 || !stockJournalId) return;
    setStockBusy(true);
    setError(null);
    try {
      const result = await api.post<{ movements: unknown[] }>(
        `/companies/${company.id}/inventory/movements/from-billing/${detail.id}`,
        {
          journalId: stockJournalId,
          lines: mapped.map((l) => ({
            billingLineId: l.billingLineId,
            itemId: l.itemId,
            locationId: l.locationId,
            quantity: l.quantity,
          })),
        },
      );
      setStockOpen(false);
      setStockNotice(t('inventory.stockBridgeCreated').replace('{n}', String(result.movements.length)));
    } catch (err) {
      setError(errorMessage(err, t('common.error')).message);
    } finally {
      setStockBusy(false);
    }
  };

  if (!company) return <EmptyState title={t('dashboard.noCompanyHelp')} />;

  const resetForm = () => {
    setForm({
      customerId: customers[0]?.id ?? '',
      issueDate: new Date().toISOString().slice(0, 10),
      dueDate: '',
      currency: company.functional_currency,
      exchangeRate: '',
      notes: '',
    });
    setLines([emptyLine()]);
  };

  const startCreate = () => {
    resetForm();
    setError(null);
    setNotice(null);
    setOpen(true);
  };

  const subtotalFor = (line: DocumentLine) => {
    const qty = toScaled4(line.quantity) ?? 0n;
    const price = toScaled4(line.unitPrice) ?? 0n;
    const pct = toScaled4(line.discountPct) ?? 0n;
    const net = (qty * price) / 10_000n;
    const discount = (net * pct) / 1_000_000n;
    return net - discount;
  };

  const formTotal = lines.reduce((acc, line) => acc + subtotalFor(line), 0n);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ document: BillingDocument; warnings: string[]; duplicates: { level: string } }>(
        `/companies/${company.id}/billing/documents`,
        {
          kind,
          customerId: form.customerId,
          issueDate: form.issueDate,
          ...(form.dueDate ? { dueDate: form.dueDate } : {}),
          currency: form.currency,
          ...(form.currency !== company.functional_currency && form.exchangeRate
            ? { exchangeRate: form.exchangeRate }
            : {}),
          ...(form.notes ? { notes: form.notes } : {}),
          lines: lines.map((l) => ({
            ...(l.itemId ? { itemId: l.itemId } : {}),
            description: l.description,
            quantity: l.quantity,
            unitPrice: l.unitPrice,
            discountPct: l.discountPct,
            vatTreatment: l.vatTreatment,
            ...(l.vatRateId ? { vatRateId: l.vatRateId } : {}),
            ...(l.revenueAccountId ? { revenueAccountId: l.revenueAccountId } : {}),
          })),
        },
      );
      setOpen(false);
      setDetail(res.document);
      setNotice(
        res.warnings && res.warnings.length > 0
          ? `${t('billing.documents.warnings')} : ${res.warnings.join(' · ')}`
          : t('billing.documents.created'),
      );
      await load();
    } catch (err) {
      const info = errorMessage(err, t('common.error'));
      setError(info.message);
    } finally {
      setBusy(false);
    }
  };

  const issue = async (doc: BillingDocument) => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ document: BillingDocument }>(
        `/companies/${company.id}/billing/documents/${doc.id}/issue`,
      );
      setNotice(`${t('billing.documents.issued')} : ${res.document.number}`);
      setDetail(res.document);
      await load();
    } catch (err) {
      setError(errorMessage(err, t('common.error')).message);
    } finally {
      setBusy(false);
    }
  };

  const convert = async (doc: BillingDocument) => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ document: BillingDocument }>(
        `/companies/${company.id}/billing/documents/${doc.id}/convert`,
        { issueDate: new Date().toISOString().slice(0, 10) },
      );
      setNotice(`${t('billing.documents.converted')} : ${res.document.number ?? t('billing.documents.draft')}`);
      setOpen(false);
      setDetail(res.document);
      await load();
    } catch (err) {
      setError(errorMessage(err, t('common.error')).message);
    } finally {
      setBusy(false);
    }
  };

  const creditNote = async (doc: BillingDocument) => {
    if (!window.confirm(t('billing.documents.creditConfirm'))) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ document: BillingDocument }>(
        `/companies/${company.id}/billing/documents/${doc.id}/credit-note`,
        {
          issueDate: new Date().toISOString().slice(0, 10),
          lines: [
            {
              description: `${t('billing.documents.creditLine')} ${doc.number ?? ''}`.trim(),
              quantity: '1.0000',
              unitPrice: doc.outstanding,
              vatTreatment: 'zero_rated',
            },
          ],
        },
      );
      setNotice(`${t('billing.documents.creditCreated')} : ${res.document.number ?? t('billing.documents.draft')}`);
      setDetail(res.document);
      await load();
    } catch (err) {
      setError(errorMessage(err, t('common.error')).message);
    } finally {
      setBusy(false);
    }
  };

  const view = async (doc: BillingDocument) => {
    try {
      const res = await api.get<{ document: BillingDocument }>(
        `/companies/${company.id}/billing/documents/${doc.id}`,
      );
      setDetail(res.document);
    } catch (err) {
      setError(errorMessage(err, t('common.error')).message);
    }
  };

  const pdf = async (doc: BillingDocument) => {
    try {
      await api.get(`/companies/${company.id}/billing/documents/${doc.id}/pdf`);
      setNotice(t('billing.documents.pdfOpened'));
    } catch (err) {
      setError(errorMessage(err, t('common.error')).message);
    }
  };

  const pickItem = (index: number, itemId: string) => {
    const item = items.find((i) => i.id === itemId);
    const next = [...lines];
    if (!item) {
      next[index] = { ...next[index]!, itemId: null };
    } else {
      next[index] = {
        ...next[index]!,
        itemId: item.id,
        description: item.labelFr,
        unitPrice: item.unitPrice,
        unit: item.unit,
        vatTreatment: item.vatTreatment,
        vatRateId: item.vatRateId,
        revenueAccountId: item.revenueAccountId,
      };
    }
    setLines(next);
  };

  return (
    <>
      <div className="page-head">
        <div className="grow">
          <h1>{t(TITLES[kind])}</h1>
          <div className="page-sub">{t(SUBTITLES[kind])}</div>
        </div>
        {kind === 'invoice' && (
          <Link className="btn" to="/accounting/journals/sales/import">
            ⇪ {t('journal.importSale')}
          </Link>
        )}
        <Button variant="primary" onClick={startCreate}>
          {t('common.add')}
        </Button>
      </div>

      {notice && <div className="alert alert-info">{notice}</div>}
      <ErrorBanner message={error} />
      {stockNotice && (
        <div className="alert alert-info">
          {stockNotice}{' '}
          <Button variant="link" onClick={() => navigate('/accounting/inventory?tab=movements')}>
            {t('inventory.openMovements')}
          </Button>
        </div>
      )}

      <Card>
        {loading ? (
          <Spinner label={t('common.loading')} />
        ) : documents.length === 0 ? (
          <EmptyState title={t('billing.documents.empty')} />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t('billing.documents.number')}</th>
                  <th>{t('common.date')}</th>
                  <th>{t('billing.documents.customer')}</th>
                  <th className="num">{t('common.total')}</th>
                  <th className="num">{t('billing.documents.outstanding')}</th>
                  <th>{t('common.status')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {documents.map((doc) => (
                  <tr key={doc.id}>
                    <td className="mono">{doc.number ?? t('billing.documents.draft')}</td>
                    <td>{doc.issueDate}</td>
                    <td>{doc.customerName}</td>
                    <td className="num">{money(doc.total, locale, doc.currency)}</td>
                    <td className="num">{money(doc.outstanding, locale, doc.currency)}</td>
                    <td>
                      <Badge kind={statusKind(doc.status)}>{doc.status}</Badge>
                      {doc.accountingEntryId && (
                        <div className="page-sub">{t('billing.documents.posted')}</div>
                      )}
                    </td>
                    <td className="row-actions">
                      <Button variant="ghost" onClick={() => void view(doc)}>
                        {t('common.edit')}
                      </Button>
                      {doc.status === 'draft' && (
                        <Button variant="ghost" onClick={() => void issue(doc)} disabled={busy}>
                          {t('billing.documents.issue')}
                        </Button>
                      )}
                      {doc.kind === 'quote' && ['sent', 'accepted'].includes(doc.status) && (
                        <Button variant="ghost" onClick={() => void convert(doc)} disabled={busy}>
                          {t('billing.documents.convert')}
                        </Button>
                      )}
                      {doc.kind === 'invoice' && ['issued', 'partially_paid'].includes(doc.status) && (
                        <Button variant="ghost" onClick={() => void creditNote(doc)} disabled={busy}>
                          {t('billing.documents.creditNote')}
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {openInvoices.length > 0 && kind === 'credit_note' && (
          <p className="muted">{t('billing.creditNotes.hint')}</p>
        )}
      </Card>

      <Modal open={open} title={t(TITLES[kind])} onClose={() => setOpen(false)} wide>
        <div className="form-grid">
          <Field label={t('billing.documents.customer')}>
            <select
              value={form.customerId}
              onChange={(e) => setForm({ ...form, customerId: e.target.value })}
            >
              <option value="">{t('billing.documents.chooseCustomer')}</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('billing.documents.issueDate')}>
            <input
              type="date"
              value={form.issueDate}
              onChange={(e) => setForm({ ...form, issueDate: e.target.value })}
            />
          </Field>
          <Field label={t('billing.documents.dueDate')}>
            <input
              type="date"
              value={form.dueDate}
              onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
            />
          </Field>
          <Field label={t('common.currency')}>
            <input
              value={form.currency}
              maxLength={3}
              onChange={(e) => setForm({ ...form, currency: e.target.value.toUpperCase() })}
            />
          </Field>
          {form.currency !== company.functional_currency && (
            <Field label={t('billing.documents.exchangeRate')} hint={t('billing.documents.exchangeHint')}>
              <input
                inputMode="decimal"
                value={form.exchangeRate}
                onChange={(e) => setForm({ ...form, exchangeRate: e.target.value })}
              />
            </Field>
          )}
          <Field label={t('billing.documents.notes')}>
            <input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </Field>
        </div>

        <div className="entry-lines">
          {lines.map((line, index) => (
            <div className="entry-line" key={index}>
              <select value={line.itemId ?? ''} onChange={(e) => pickItem(index, e.target.value)}>
                <option value="">{t('billing.documents.freeLine')}</option>
                {items.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.reference} — {i.labelFr}
                  </option>
                ))}
              </select>
              <input
                value={line.description}
                placeholder={t('common.description')}
                onChange={(e) => {
                  const next = [...lines];
                  next[index] = { ...next[index]!, description: e.target.value };
                  setLines(next);
                }}
              />
              <input
                inputMode="decimal"
                value={line.quantity}
                placeholder={t('billing.documents.qty')}
                onChange={(e) => {
                  const next = [...lines];
                  next[index] = { ...next[index]!, quantity: e.target.value };
                  setLines(next);
                }}
              />
              <input
                inputMode="decimal"
                value={line.unitPrice}
                placeholder={t('billing.documents.unitPrice')}
                onChange={(e) => {
                  const next = [...lines];
                  next[index] = { ...next[index]!, unitPrice: e.target.value };
                  setLines(next);
                }}
              />
              <input
                inputMode="decimal"
                value={line.discountPct}
                placeholder={t('billing.documents.discount')}
                onChange={(e) => {
                  const next = [...lines];
                  next[index] = { ...next[index]!, discountPct: e.target.value };
                  setLines(next);
                }}
              />
              <select
                value={line.vatTreatment}
                onChange={(e) => {
                  const next = [...lines];
                  next[index] = {
                    ...next[index]!,
                    vatTreatment: e.target.value as DocumentLine['vatTreatment'],
                    vatRateId: null,
                  };
                  setLines(next);
                }}
              >
                <option value="zero_rated">{t('billing.vat.zero_rated')}</option>
                <option value="exempt">{t('billing.vat.exempt')}</option>
                <option value="out_of_scope">{t('billing.vat.out_of_scope')}</option>
                <option value="standard">{t('billing.vat.standard')}</option>
              </select>
              <Button
                variant="ghost"
                onClick={() => setLines(lines.length === 1 ? [emptyLine()] : lines.filter((_, i) => i !== index))}
              >
                ✕
              </Button>
            </div>
          ))}
        </div>
        <div className="row-actions">
          <Button variant="ghost" onClick={() => setLines([...lines, emptyLine()])}>
            {t('billing.documents.addLine')}
          </Button>
          <span className="entry-totals">
            <strong>{t('common.total')}</strong> {scaled4ToString(formTotal)} {form.currency}
          </span>
        </div>
        <p className="muted">{t('billing.vat.noRate')}</p>

        <div className="modal-actions">
          <Button variant="ghost" onClick={() => setOpen(false)}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            onClick={() => void create()}
            disabled={busy || !form.customerId || lines.some((l) => !l.description.trim() || !l.unitPrice)}
          >
            {t('common.create')}
          </Button>
        </div>
      </Modal>

      <Modal
        open={detail !== null}
        title={`${detail?.number ?? t('billing.documents.draft')} — ${detail?.customerName ?? ''}`}
        onClose={() => setDetail(null)}
        wide
      >
        {detail && (
          <>
            <div className="kpi-grid">
              <div className="kpi">
                <div className="kpi-label">{t('common.total')}</div>
                <div className="kpi-value">{money(detail.total, locale, detail.currency)}</div>
              </div>
              <div className="kpi">
                <div className="kpi-label">{t('billing.documents.outstanding')}</div>
                <div className="kpi-value">{money(detail.outstanding, locale, detail.currency)}</div>
              </div>
              <div className="kpi">
                <div className="kpi-label">{t('billing.documents.vat')}</div>
                <div className="kpi-value">{money(detail.taxTotal, locale, detail.currency)}</div>
              </div>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{t('common.description')}</th>
                    <th className="num">{t('billing.documents.qty')}</th>
                    <th className="num">{t('billing.documents.unitPrice')}</th>
                    <th>{t('billing.documents.vat')}</th>
                    <th className="num">{t('common.total')}</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.lines.map((l) => (
                    <tr key={l.id ?? `${l.lineNo}`}>
                      <td>{l.description}</td>
                      <td className="num">{l.quantity}</td>
                      <td className="num">{money(l.unitPrice, locale)}</td>
                      <td>{l.vatTreatment === 'standard' ? (l.vatRate ?? '—') : l.vatTreatment}</td>
                      <td className="num">{money(l.lineTotal, locale)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {detail.warnings && detail.warnings.length > 0 && (
              <div className="alert alert-warn">{detail.warnings.join(' · ')}</div>
            )}
            {detail.accountingEntryId && (
              <p className="muted">{t('billing.documents.postedEntry')}</p>
            )}
            <p className="muted">{t('billing.documents.pdfDemo')}</p>
            <div className="modal-actions">
              {detail.number && (
                <Link
                  className="btn btn-ghost"
                  to={`/accounting/lettering?search=${encodeURIComponent(detail.number)}`}
                >
                  {t('lettering.open')}
                </Link>
              )}
              {detail.kind === 'invoice' && detail.status === 'issued' && detail.lines.some((l) => l.id) && (
                <Button variant="ghost" onClick={() => void openStockBridge(detail)} disabled={stockBusy}>
                  {t('inventory.stockBridge')}
                </Button>
              )}
              <Button variant="ghost" onClick={() => void pdf(detail)}>
                {t('billing.documents.pdfButton')}
              </Button>
              {detail.status === 'draft' && (
                <Button variant="primary" onClick={() => void issue(detail)} disabled={busy}>
                  {t('billing.documents.issue')}
                </Button>
              )}
            </div>
          </>
        )}
      </Modal>

      <Modal open={stockOpen} title={t('inventory.stockBridge')} onClose={() => setStockOpen(false)} wide>
        <p className="page-sub">{t('inventory.stockBridgeHint')}</p>
        <Field label={t('docs.journal')}>
          <select value={stockJournalId} onChange={(e) => setStockJournalId(e.target.value)}>
            {stockJournals.map((j) => <option key={j.id} value={j.id}>{j.code} — {j.name}</option>)}
          </select>
        </Field>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t('inventory.billingLine')}</th>
                <th className="num">{t('inventory.invoicedQty')}</th>
                <th>{t('inventory.inventoryItem')}</th>
                <th>{t('inventory.location')}</th>
                <th className="num">{t('inventory.quantityToIssue')}</th>
              </tr>
            </thead>
            <tbody>
              {stockLines.map((l, index) => (
                <tr key={l.billingLineId}>
                  <td>{l.description}</td>
                  <td className="num">{l.invoicedQty}</td>
                  <td>
                    <select value={l.itemId} onChange={(e) => {
                      const next = [...stockLines]; next[index] = { ...next[index]!, itemId: e.target.value }; setStockLines(next);
                    }}>
                      <option value="">{t('inventory.chooseItem')}</option>
                      {stockItems.map((i) => <option key={i.id} value={i.id}>{i.sku} — {i.name}</option>)}
                    </select>
                  </td>
                  <td>
                    <select value={l.locationId} onChange={(e) => {
                      const next = [...stockLines]; next[index] = { ...next[index]!, locationId: e.target.value }; setStockLines(next);
                    }}>
                      {stockLocations.map((loc) => <option key={loc.id} value={loc.id}>{loc.code} — {loc.name}</option>)}
                    </select>
                  </td>
                  <td className="num">
                    <input inputMode="decimal" value={l.quantity} onChange={(e) => {
                      const next = [...stockLines]; next[index] = { ...next[index]!, quantity: e.target.value }; setStockLines(next);
                    }} style={{ maxWidth: 100 }} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="modal-actions">
          <Button variant="ghost" onClick={() => setStockOpen(false)}>{t('common.cancel')}</Button>
          <Button variant="primary" disabled={stockBusy || !stockJournalId || !stockLines.some((l) => l.itemId && Number(l.quantity) > 0)} onClick={() => void submitStockBridge()}>
            {t('inventory.stockBridge')}
          </Button>
        </div>
      </Modal>
    </>
  );
}
