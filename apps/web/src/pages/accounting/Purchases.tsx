import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../../api';
import { useI18n } from '../../i18n';
import { errorMessage, useSession } from '../../store';
import { Badge, Button, Card, EmptyState, ErrorBanner, Field, Modal, Spinner } from '../../components/ui';
import { money, toScaled4 } from '../../format';
import { AppIcon } from '../../components/AppIcon';

/**
 * Comptabilité → Achats & Fournisseurs (mission 11).
 *
 * This screen is a supplier subledger: it records suppliers, purchase invoices,
 * credit notes and supplier payments, then *prepares* a proposal. Posting is
 * done later in the existing proposals screen. No accounting entry is created
 * here, no tax rule is inferred and no posted invoice is ever deleted.
 */

type Tab = 'dashboard' | 'suppliers' | 'invoices' | 'credit-notes' | 'payments' | 'aging';

interface Supplier {
  id: string;
  name: string;
  reference: string | null;
  country: string;
  address_line1: string | null;
  city: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  registration_number: string | null;
  tax_number: string | null;
  preferred_currency: string | null;
  payment_terms_days: number | null;
  payable_account_id: string | null;
  notes: string | null;
  is_active: boolean;
}

interface PurchaseDoc {
  id: string;
  supplier_id: string;
  supplier_name: string;
  supplier_reference: string;
  kind: 'invoice' | 'credit_note';
  doc_no: string | null;
  issue_date: string;
  due_date: string | null;
  currency: string;
  total_amount: string;
  outstanding_amount: string;
  credit_available: string;
  payment_status: string;
  status: string;
  accounting_entry_id: string | null;
}

interface PaymentAllocation {
  id: string;
  cancelledAt: string | null;
}

interface PurchasePayment {
  id: string;
  supplier_name: string;
  payment_no: string | null;
  kind: 'payment' | 'advance';
  payment_date: string;
  amount: string;
  currency: string;
  reference: string | null;
  status: string;
  accounting_entry_id: string | null;
  allocations: PaymentAllocation[];
}

interface BalanceCurrency {
  currency: string;
  invoiced: string;
  paid: string;
  credited: string;
  outstanding: string;
  overdue: string;
  dueSoon: string;
  invoiceCount: number;
}

interface AgingInvoice {
  id: string;
  docNo: string | null;
  supplierReference: string;
  dueDate: string | null;
  total: string;
  paid: string;
  credited: string;
  outstanding: string;
  daysOverdue: number;
  accountingPosted: boolean;
}

interface AgingGroup {
  supplierId: string;
  supplierName: string;
  currency: string;
  outstanding: string;
  overdue: string;
  invoices: AgingInvoice[];
}

interface Aging {
  asOf: string;
  groups: AgingGroup[];
  totalsByCurrency: { currency: string; outstanding: string; overdue: string; invoices: number }[];
}

interface Account {
  id: string;
  code: string;
  name: string;
  type: string;
  is_active: boolean;
}

interface TaxRate {
  id: string;
  code: string;
  rate: string;
  verified: boolean;
}

interface ProposalRef {
  id: string;
  reference: string | null;
  status: string;
}

const TABS: Tab[] = ['dashboard', 'suppliers', 'invoices', 'credit-notes', 'payments', 'aging'];

const emptyLine = (accountId = '') => ({
  description: '',
  quantity: '1',
  unitPrice: '',
  accountId,
  vatTreatment: 'out_of_scope',
  vatRateId: '',
  vatRecoverable: '',
});

export default function PurchasesPage() {
  const { t, locale } = useI18n();
  const { company } = useSession();
  const [params, setParams] = useSearchParams();
  const rawTab = params.get('tab') as Tab | null;
  const tab: Tab = rawTab && TABS.includes(rawTab) ? rawTab : 'dashboard';
  const L = (fr: string, en: string) => (locale === 'fr' ? fr : en);

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [taxRates, setTaxRates] = useState<TaxRate[]>([]);
  const [documents, setDocuments] = useState<PurchaseDoc[]>([]);
  const [creditNotes, setCreditNotes] = useState<PurchaseDoc[]>([]);
  const [payments, setPayments] = useState<PurchasePayment[]>([]);
  const [aging, setAging] = useState<Aging | null>(null);
  const [dashboard, setDashboard] = useState<any>(null);

  const [supplierForm, setSupplierForm] = useState({
    name: '',
    reference: '',
    country: 'MU',
    addressLine1: '',
    city: '',
    contactName: '',
    contactEmail: '',
    contactPhone: '',
    registrationNumber: '',
    taxNumber: '',
    preferredCurrency: '',
    paymentTermsDays: '30',
    payableAccountId: '',
    notes: '',
  });
  const [supplierOpen, setSupplierOpen] = useState(false);
  const [supplierDetail, setSupplierDetail] = useState<Supplier | null>(null);
  const [supplierBalance, setSupplierBalance] = useState<{
    balances: BalanceCurrency[];
    creditAvailable: { currency: string; amount: string }[];
  } | null>(null);

  const [docKind, setDocKind] = useState<'invoice' | 'credit_note'>('invoice');
  const [docForm, setDocForm] = useState({
    supplierId: '',
    supplierReference: '',
    issueDate: new Date().toISOString().slice(0, 10),
    dueDate: '',
    receivedDate: '',
    currency: 'MUR',
    exchangeRate: '',
    description: '',
    sourceDocumentId: '',
    reason: '',
  });
  const [docLines, setDocLines] = useState([emptyLine()]);
  const [docOpen, setDocOpen] = useState(false);

  const [payForm, setPayForm] = useState({
    supplierId: '',
    kind: 'payment' as 'payment' | 'advance',
    paymentDate: new Date().toISOString().slice(0, 10),
    amount: '',
    currency: 'MUR',
    exchangeRate: '',
    method: 'bank_transfer',
    reference: '',
  });
  const [payAllocations, setPayAllocations] = useState<Record<string, string>>({});
  const [payOpen, setPayOpen] = useState(false);

  const [creditForm, setCreditForm] = useState({ creditNoteId: '', invoiceId: '', amount: '', reason: '' });
  const [creditOpen, setCreditOpen] = useState(false);

  const [proposal, setProposal] = useState<ProposalRef | null>(null);
  const [cancelDialog, setCancelDialog] = useState<{ type: 'payment' | 'document'; id: string; label: string } | null>(null);
  const [cancelReason, setCancelReason] = useState('');

  const setTab = (next: Tab) => {
    const copy = new URLSearchParams(params);
    copy.set('tab', next);
    setParams(copy, { replace: true });
  };

  const load = useCallback(async () => {
    if (!company) return;
    setLoading(true);
    setError(null);
    try {
      const [supplierRes, accountRes, rateRes, dashboardRes] = await Promise.all([
        api.get<{ suppliers: Supplier[] }>(`/companies/${company.id}/purchases/suppliers?includeInactive=true`),
        api.get<{ accounts: Account[] }>(`/companies/${company.id}/accounts`),
        api.get<{ rates: TaxRate[] }>(`/companies/${company.id}/billing/tax-rates`).catch(() => ({ rates: [] })),
        api.get<{ dashboard: any }>(`/companies/${company.id}/purchases/dashboard`).catch(() => ({ dashboard: null })),
      ]);
      setSuppliers(supplierRes.suppliers);
      setAccounts(accountRes.accounts);
      setTaxRates(rateRes.rates);
      setDashboard(dashboardRes.dashboard);
      if (tab === 'invoices' || tab === 'credit-notes') {
        const kind = tab === 'invoices' ? 'invoice' : 'credit_note';
        const res = await api.get<{ documents: PurchaseDoc[] }>(
          `/companies/${company.id}/purchases/documents?kind=${kind}`,
        );
        if (tab === 'invoices') setDocuments(res.documents);
        else setCreditNotes(res.documents);
        if (tab === 'credit-notes') {
          const invoices = await api.get<{ documents: PurchaseDoc[] }>(
            `/companies/${company.id}/purchases/documents?kind=invoice`,
          );
          setDocuments(invoices.documents);
        }
      }
      if (tab === 'payments') {
        const [payRes, invRes] = await Promise.all([
          api.get<{ payments: PurchasePayment[] }>(`/companies/${company.id}/purchases/payments`),
          api.get<{ documents: PurchaseDoc[] }>(`/companies/${company.id}/purchases/documents?kind=invoice`),
        ]);
        setPayments(payRes.payments);
        setDocuments(invRes.documents);
      }
      if (tab === 'aging') {
        const res = await api.get<{ aging: Aging }>(`/companies/${company.id}/purchases/aging`);
        setAging(res.aging);
      }
    } catch (err) {
      setError(errorMessage(err, t('common.error')).message);
    } finally {
      setLoading(false);
    }
  }, [company?.id, tab, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const activeSuppliers = useMemo(() => suppliers.filter((s) => s.is_active), [suppliers]);
  const expenseAccounts = useMemo(
    () => accounts.filter((a) => a.is_active && a.type !== 'revenue' && a.type !== 'equity'),
    [accounts],
  );

  if (!company) return <EmptyState title={t('dashboard.noCompanyHelp')} />;

  const call = async (fn: () => Promise<void>, success: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await fn();
      setNotice(success);
      await load();
    } catch (err) {
      setError(errorMessage(err, t('common.error')).message);
    } finally {
      setBusy(false);
    }
  };

  const createSupplier = async () => {
    await call(async () => {
      await api.post(`/companies/${company.id}/purchases/suppliers`, {
        name: supplierForm.name,
        reference: supplierForm.reference || null,
        country: supplierForm.country,
        addressLine1: supplierForm.addressLine1 || null,
        city: supplierForm.city || null,
        contactName: supplierForm.contactName || null,
        contactEmail: supplierForm.contactEmail || null,
        contactPhone: supplierForm.contactPhone || null,
        registrationNumber: supplierForm.registrationNumber || null,
        taxNumber: supplierForm.taxNumber || null,
        preferredCurrency: supplierForm.preferredCurrency || null,
        paymentTermsDays: supplierForm.paymentTermsDays ? Number(supplierForm.paymentTermsDays) : null,
        payableAccountId: supplierForm.payableAccountId || null,
        notes: supplierForm.notes || null,
      });
      setSupplierOpen(false);
      setSupplierForm({ ...supplierForm, name: '', reference: '', registrationNumber: '', taxNumber: '' });
    }, L('Fournisseur créé. Aucune fusion automatique de fiches.', 'Supplier created. No automatic merge.'));
  };

  const openSupplier = async (supplier: Supplier) => {
    setSupplierDetail(supplier);
    setSupplierBalance(null);
    try {
      const res = await api.get<{
        balances: BalanceCurrency[];
        creditAvailable: { currency: string; amount: string }[];
      }>(`/companies/${company.id}/purchases/suppliers/${supplier.id}/balance`);
      setSupplierBalance(res);
    } catch (err) {
      setError(errorMessage(err, t('common.error')).message);
    }
  };

  const submitDocument = async () => {
    await call(async () => {
      const payload = {
        kind: docKind,
        supplierId: docForm.supplierId,
        supplierReference: docForm.supplierReference,
        issueDate: docForm.issueDate,
        receivedDate: docForm.receivedDate || null,
        dueDate: docForm.dueDate || null,
        currency: docForm.currency.toUpperCase(),
        exchangeRate: docForm.exchangeRate || null,
        description: docForm.description || null,
        sourceDocumentId: docKind === 'credit_note' && docForm.sourceDocumentId ? docForm.sourceDocumentId : null,
        reason: docKind === 'credit_note' ? docForm.reason || null : null,
        lines: docLines.map((line) => ({
          description: line.description,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          accountId: line.accountId,
          vatTreatment: line.vatTreatment,
          vatRateId: line.vatRateId || null,
          ...(line.vatRecoverable === '' ? {} : { vatRecoverable: line.vatRecoverable === 'true' }),
        })),
      };
      const res = await api.post<{ document: PurchaseDoc }>(`/companies/${company.id}/purchases/documents`, payload);
      setProposal(null);
      setDocOpen(false);
      setDocForm({ ...docForm, supplierReference: '', description: '', sourceDocumentId: '' });
      setDocLines([emptyLine()]);
      setNotice(L(
        `Brouillon ${res.document.id.slice(0, 8)} enregistré. Validez-le avant toute comptabilisation.`,
        `Draft ${res.document.id.slice(0, 8)} saved. Validate it before any posting.`,
      ));
    }, L('Document enregistré en brouillon.', 'Document saved as a draft.'));
  };

  const validateDoc = async (doc: PurchaseDoc) => {
    await call(async () => {
      const res = await api.post<{ document: PurchaseDoc }>(
        `/companies/${company.id}/purchases/documents/${doc.id}/validate`,
      );
      setNotice(L(`Document validé ${res.document.doc_no}.`, `Document validated ${res.document.doc_no}.`));
    }, L('Document validé. La comptabilisation reste une action distincte.', 'Document validated. Posting remains a separate action.'));
  };

  const prepareProposal = async (doc: PurchaseDoc) => {
    await call(async () => {
      const res = await api.post<{ proposal: ProposalRef }>(
        `/companies/${company.id}/purchases/documents/${doc.id}/proposal`,
      );
      setProposal(res.proposal);
      setNotice(L(
        `Proposition préparée (${res.proposal.status}). Aucune écriture créée.`,
        `Proposal prepared (${res.proposal.status}). No entry created.`,
      ));
    }, L('Proposition préparée.', 'Proposal prepared.'));
  };

  const validatePreparedProposal = async () => {
    if (!proposal) return;
    await call(async () => {
      const res = await api.post<{ proposal: { status: string } }>(
        `/companies/${company.id}/ai/entry-proposals/${proposal.id}/validate`,
        { acceptWarnings: true },
      );
      setProposal({ ...proposal, status: res.proposal.status });
      setNotice(L('Proposition validée. Aucune écriture créée.', 'Proposal validated. No entry created.'));
    }, L('Proposition validée.', 'Proposal validated.'));
  };

  const postPreparedProposal = async () => {
    if (!proposal) return;
    if (!window.confirm(L(
      'Comptabiliser cette proposition ? Une écriture équilibrée sera créée dans le grand livre. Cette action est humaine et définitive.',
      'Post this proposal? A balanced entry will be created in the general ledger. This is a human, final action.',
    ))) return;
    await call(async () => {
      const res = await api.post<{ entryNo: string; entryId: string; entryCreated: boolean }>(
        `/companies/${company.id}/ai/entry-proposals/${proposal.id}/post`,
      );
      setProposal({ ...proposal, status: 'posted' });
      setNotice(L(
        `Écriture ${res.entryNo} comptabilisée depuis les Achats.`,
        `Entry ${res.entryNo} posted from Purchases.`,
      ));
      await load();
    }, L('Écriture comptabilisée.', 'Entry posted.'));
  };

  const createPayment = async () => {
    await call(async () => {
      const allocations = payForm.kind === 'payment'
        ? Object.entries(payAllocations)
            .filter(([, amount]) => amount.trim() !== '')
            .map(([invoiceId, amount]) => ({ invoiceId, amount }))
        : [];
      await api.post(`/companies/${company.id}/purchases/payments`, {
        supplierId: payForm.supplierId,
        kind: payForm.kind,
        paymentDate: payForm.paymentDate,
        amount: payForm.amount,
        currency: payForm.currency.toUpperCase(),
        exchangeRate: payForm.exchangeRate || null,
        method: payForm.method,
        reference: payForm.reference || null,
        allocations,
      });
      setPayOpen(false);
      setPayAllocations({});
      setPayForm({ ...payForm, amount: '', reference: '' });
    }, L('Règlement enregistré sans écriture comptable.', 'Supplier payment recorded without an accounting entry.'));
  };

  const preparePaymentProposal = async (payment: PurchasePayment) => {
    await call(async () => {
      const res = await api.post<{ proposal: ProposalRef }>(
        `/companies/${company.id}/purchases/payments/${payment.id}/proposal`,
      );
      setProposal(res.proposal);
      setNotice(L('Proposition de règlement préparée. Validation humaine requise.', 'Payment proposal prepared. Human validation required.'));
    }, L('Proposition préparée.', 'Proposal prepared.'));
  };

  const allocateCredit = async () => {
    await call(async () => {
      await api.post(`/companies/${company.id}/purchases/credit-notes/${creditForm.creditNoteId}/allocations`, {
        invoiceId: creditForm.invoiceId,
        amount: creditForm.amount,
        confirm: true,
        reason: creditForm.reason || null,
      });
      setCreditOpen(false);
      setCreditForm({ creditNoteId: '', invoiceId: '', amount: '', reason: '' });
    }, L('Avoir affecté. Aucune facture comptabilisée n’a été modifiée.', 'Credit note allocated. No posted invoice was modified.'));
  };

  const doCancel = async () => {
    if (!cancelDialog) return;
    await call(async () => {
      const reason = cancelReason || L('Correction demandée', 'Correction requested');
      if (cancelDialog.type === 'payment') {
        await api.post(`/companies/${company.id}/purchases/payments/${cancelDialog.id}/cancel`, { reason });
      } else {
        await api.post(`/companies/${company.id}/purchases/documents/${cancelDialog.id}/cancel`, { reason });
      }
      setCancelDialog(null);
      setCancelReason('');
    }, L('Opération annulée sans suppression d’historique.', 'Operation cancelled without deleting history.'));
  };

  const downloadAging = async () => {
    setError(null);
    try {
      const text = await api.get<string>(`/companies/${company.id}/purchases/aging.csv`);
      const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'dettes-fournisseurs.csv';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (err) {
      setError(errorMessage(err, t('common.error')).message);
    }
  };

  const invoicesForSupplier = documents.filter(
    (doc) => (!payForm.supplierId || doc.supplier_id === payForm.supplierId)
      && doc.status === 'validated'
      && toScaled4(doc.outstanding_amount)! > 0n,
  );

  const statusBadge = (doc: PurchaseDoc) => {
    if (doc.status === 'cancelled') return <Badge kind="neutral">{L('Annulé', 'Cancelled')}</Badge>;
    if (doc.status === 'draft') return <Badge kind="warning">{L('Brouillon', 'Draft')}</Badge>;
    if (doc.accounting_entry_id) return <Badge kind="success">{L('Comptabilisé', 'Posted')}</Badge>;
    if (doc.payment_status === 'paid') return <Badge kind="success">{L('Soldé', 'Paid')}</Badge>;
    if (doc.payment_status === 'partial') return <Badge kind="info">{L('Partiel', 'Partial')}</Badge>;
    return <Badge kind="warning">{L('Non payé', 'Unpaid')}</Badge>;
  };

  return (
    <div className="purchases-page">
      <header className="page-head">
        <div>
          <h1>{L('Achats et dépenses', 'Purchases & Expenses')}</h1>
          <p className="muted">
            {L(
              'Sous-ledger fournisseur : factures, avoirs et règlements. La comptabilisation reste humaine, via le moteur existant.',
              'Supplier subledger: invoices, credit notes and payments. Posting stays human, through the existing engine.',
            )}
          </p>
        </div>
        <div className="page-actions">
          <Button variant="ghost" onClick={() => void load()} disabled={busy}>{t('common.refresh')}</Button>
          <Button variant="ghost" onClick={() => void downloadAging()}>{t('common.exportCsv')}</Button>
        </div>
      </header>

      <div className="purchase-tabs" role="tablist" aria-label={L('Sections Achats', 'Purchases sections')}>
        {([
          ['dashboard', L('Tableau de bord', 'Dashboard')],
          ['suppliers', L('Fournisseurs', 'Suppliers')],
          ['invoices', L('Factures fournisseurs', 'Bills')],
          ['credit-notes', L('Avoirs fournisseurs', 'Supplier credit notes')],
          ['payments', L('Règlements fournisseurs', 'Supplier payments')],
          ['aging', L('Comptes fournisseurs', 'Accounts payable')],
        ] as [Tab, string][]).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            className={`purchase-tab ${tab === key ? 'active' : ''}`}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {error && <ErrorBanner message={error} />}
      {notice && <div className="alert alert-success">{notice}</div>}
      {busy && <Spinner label={L('Traitement…', 'Working…')} />}

      {loading ? (
        <Spinner label={t('common.loading')} />
      ) : (
        <>
          {tab === 'dashboard' && (
            <>
              <div className="metrics-grid">
                <Card title={L('Fournisseurs', 'Suppliers')}>
                  <strong className="metric-value">{dashboard?.suppliers?.active ?? 0}</strong>
                  <span className="muted"> {L('actifs', 'active')} / {dashboard?.suppliers?.total ?? 0}</span>
                </Card>
                <Card title={L('Factures validées', 'Validated invoices')}>
                  <strong className="metric-value">{dashboard?.documents?.invoices ?? 0}</strong>
                </Card>
                <Card title={L('En attente comptable', 'Awaiting accounting')}>
                  <strong className="metric-value">
                    {(dashboard?.documents?.awaitingAccounting ?? 0) + (dashboard?.payments?.awaitingAccounting ?? 0)}
                  </strong>
                </Card>
                <Card title={L('Brouillons', 'Drafts')}>
                  <strong className="metric-value">{dashboard?.documents?.drafts ?? 0}</strong>
                </Card>
              </div>
              <Card title={L('Soldes fournisseurs par devise', 'Supplier balances by currency')}>
                {(dashboard?.aging?.summary ?? []).length === 0 ? (
                  <EmptyState title={L('Aucune dette fournisseur ouverte.', 'No open supplier debt.')} />
                ) : (
                  <div className="table-scroll">
                    <table className="table purchase-table">
                      <thead>
                        <tr>
                          <th>{t('common.currency')}</th>
                          <th>{L('Factures', 'Invoices')}</th>
                          <th>{L('Total', 'Total')}</th>
                          <th>{L('Payé', 'Paid')}</th>
                          <th>{L('Avoirs', 'Credits')}</th>
                          <th>{L('Restant', 'Outstanding')}</th>
                          <th>{L('Échu', 'Overdue')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(dashboard?.aging?.summary ?? []).map((row: BalanceCurrency) => (
                          <tr key={row.currency}>
                            <td>{row.currency}</td>
                            <td>{row.invoiceCount}</td>
                            <td>{money(row.invoiced, locale)}</td>
                            <td>{money(row.paid, locale)}</td>
                            <td>{money(row.credited, locale)}</td>
                            <td><strong>{money(row.outstanding, locale)}</strong></td>
                            <td>{money(row.overdue, locale)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <p className="muted">
                  {L('Les devises sont présentées séparément et ne sont jamais additionnées.', 'Currencies are shown separately and are never added together.')}
                </p>
              </Card>
            </>
          )}

          {tab === 'suppliers' && (
            <Card
              title={L('Fiches fournisseurs', 'Supplier records')}
              actions={<Button onClick={() => setSupplierOpen(true)}>{L('Nouveau fournisseur', 'New supplier')}</Button>}
            >
              {suppliers.length === 0 ? (
                <EmptyState title={L('Aucun fournisseur enregistré.', 'No supplier recorded.')} />
              ) : (
                <>
                  <div className="table-scroll">
                    <table className="table purchase-table">
                      <thead>
                        <tr>
                          <th>{L('Nom', 'Name')}</th>
                          <th>{L('Référence', 'Reference')}</th>
                          <th>{L('Pays', 'Country')}</th>
                          <th>{L('Devise', 'Currency')}</th>
                          <th>{L('Délai', 'Terms')}</th>
                          <th>{t('common.status')}</th>
                          <th>{t('common.actions')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {suppliers.map((supplier) => (
                          <tr key={supplier.id}>
                            <td><strong>{supplier.name}</strong></td>
                            <td>{supplier.reference ?? '—'}</td>
                            <td>{supplier.country}</td>
                            <td>{supplier.preferred_currency ?? '—'}</td>
                            <td>{supplier.payment_terms_days === null ? '—' : `${supplier.payment_terms_days} j`}</td>
                            <td>{supplier.is_active ? <Badge kind="success">{t('common.active')}</Badge> : <Badge>{t('common.inactive')}</Badge>}</td>
                            <td><Button variant="ghost" onClick={() => void openSupplier(supplier)}>{L('Détail', 'Detail')}</Button></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="purchase-cards">
                    {suppliers.map((supplier) => (
                      <article className="purchase-card" key={`card-${supplier.id}`}>
                        <div className="purchase-card-head">
                          <strong>{supplier.name}</strong>
                          {supplier.is_active ? <Badge kind="success">{t('common.active')}</Badge> : <Badge>{t('common.inactive')}</Badge>}
                        </div>
                        <div className="purchase-card-row"><span>{L('Référence', 'Reference')}</span><span>{supplier.reference ?? '—'}</span></div>
                        <div className="purchase-card-row"><span>{L('Pays', 'Country')}</span><span>{supplier.country}</span></div>
                        <div className="purchase-card-row"><span>{L('Devise', 'Currency')}</span><span>{supplier.preferred_currency ?? '—'}</span></div>
                        <div className="purchase-card-row"><span>{L('Délai', 'Terms')}</span><span>{supplier.payment_terms_days ?? '—'} j</span></div>
                        <div className="purchase-card-actions">
                          <Button variant="ghost" onClick={() => void openSupplier(supplier)}>{L('Détail', 'Detail')}</Button>
                        </div>
                      </article>
                    ))}
                  </div>
                </>
              )}
            </Card>
          )}

          {(tab === 'invoices' || tab === 'credit-notes') && (
            <Card
              title={tab === 'invoices' ? L('Factures fournisseurs', 'Bills') : L('Avoirs fournisseurs', 'Supplier credit notes')}
              actions={
                <div className="page-actions">
                  {tab === 'credit-notes' && (
                    <Button variant="ghost" onClick={() => setCreditOpen(true)}>{L('Affecter un avoir', 'Allocate a credit note')}</Button>
                  )}
                  {tab === 'invoices' && (
                    <>
                      <Link className="btn" to="/accounting/journals/purchases/import">
                        <AppIcon name="import" /> {L('Importer une facture d’achat', 'Import purchase invoice')}
                      </Link>
                      <Link className="btn" to="/accounting/journals/purchases/import/bulk">
                        <AppIcon name="importCloud" /> {L('Import groupé', 'Bulk import')}
                      </Link>
                    </>
                  )}
                  <Button onClick={() => { setDocKind(tab === 'invoices' ? 'invoice' : 'credit_note'); setDocOpen(true); }}>
                    {L('Nouveau document', 'New document')}
                  </Button>
                </div>
              }
            >
              {(tab === 'invoices' ? documents : creditNotes).length === 0 ? (
                <EmptyState title={L('Aucun document.', 'No document.')} />
              ) : (
                <>
                  <div className="table-scroll">
                    <table className="table purchase-table">
                      <thead>
                        <tr>
                          <th>{L('Numéro', 'Number')}</th>
                          <th>{L('Fournisseur', 'Supplier')}</th>
                          <th>{L('Référence fournisseur', 'Supplier reference')}</th>
                          <th>{L('Date', 'Date')}</th>
                          <th>{L('Échéance', 'Due')}</th>
                          <th>{L('Total', 'Total')}</th>
                          <th>{L('Restant', 'Outstanding')}</th>
                          <th>{t('common.status')}</th>
                          <th>{t('common.actions')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(tab === 'invoices' ? documents : creditNotes).map((doc) => (
                          <tr key={doc.id}>
                            <td>{doc.doc_no ?? L('Brouillon', 'Draft')}</td>
                            <td>{doc.supplier_name}</td>
                            <td>{doc.supplier_reference}</td>
                            <td>{doc.issue_date}</td>
                            <td>{doc.due_date ?? '—'}</td>
                            <td>{money(doc.total_amount, locale, doc.currency)}</td>
                            <td>{doc.kind === 'credit_note' ? money(doc.credit_available, locale, doc.currency) : money(doc.outstanding_amount, locale, doc.currency)}</td>
                            <td>{statusBadge(doc)}</td>
                            <td>
                              <DocumentActions
                                doc={doc}
                                L={L}
                                onValidate={() => void validateDoc(doc)}
                                onProposal={() => void prepareProposal(doc)}
                                onCancel={() => setCancelDialog({ type: 'document', id: doc.id, label: doc.doc_no ?? doc.supplier_reference })}
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="purchase-cards">
                    {(tab === 'invoices' ? documents : creditNotes).map((doc) => (
                      <article className="purchase-card" key={`card-${doc.id}`}>
                        <div className="purchase-card-head"><strong>{doc.doc_no ?? L('Brouillon', 'Draft')}</strong>{statusBadge(doc)}</div>
                        <div className="purchase-card-row"><span>{L('Fournisseur', 'Supplier')}</span><span>{doc.supplier_name}</span></div>
                        <div className="purchase-card-row"><span>{L('Référence', 'Reference')}</span><span>{doc.supplier_reference}</span></div>
                        <div className="purchase-card-row"><span>{L('Date', 'Date')}</span><span>{doc.issue_date}</span></div>
                        <div className="purchase-card-row"><span>{L('Échéance', 'Due')}</span><span>{doc.due_date ?? '—'}</span></div>
                        <div className="purchase-card-row"><span>{L('Total', 'Total')}</span><span>{money(doc.total_amount, locale, doc.currency)}</span></div>
                        <div className="purchase-card-row">
                          <span>{doc.kind === 'credit_note' ? L('Disponible', 'Available') : L('Restant', 'Outstanding')}</span>
                          <span>{money(doc.kind === 'credit_note' ? doc.credit_available : doc.outstanding_amount, locale, doc.currency)}</span>
                        </div>
                        <div className="purchase-card-actions">
                          <DocumentActions
                            doc={doc}
                            L={L}
                            onValidate={() => void validateDoc(doc)}
                            onProposal={() => void prepareProposal(doc)}
                            onCancel={() => setCancelDialog({ type: 'document', id: doc.id, label: doc.doc_no ?? doc.supplier_reference })}
                          />
                        </div>
                      </article>
                    ))}
                  </div>
                </>
              )}
              {proposal && (
                <div className="alert alert-warn">
                  {L('Proposition', 'Proposal')} <code>{proposal.id.slice(0, 8)}</code> — {proposal.status}.{' '}
                  {L(
                    'La préparation ne crée aucune écriture ; la validation et la comptabilisation restent deux actions humaines distinctes.',
                    'Preparing creates no entry; validation and posting remain two distinct human actions.',
                  )}{' '}
                  <a href={`/cabinet/ai-proposals?proposal=${proposal.id}`}>
                    {L('Ouvrir dans les propositions', 'Open in proposals')}
                  </a>
                  <div className="page-actions" style={{ marginTop: 8 }}>
                    {proposal.status === 'proposed' && (
                      <Button variant="primary" disabled={busy} onClick={() => void validatePreparedProposal()}>
                        {L('Valider la proposition', 'Validate proposal')}
                      </Button>
                    )}
                    {proposal.status === 'validated' && (
                      <Button variant="primary" disabled={busy} onClick={() => void postPreparedProposal()}>
                        {L('Comptabiliser', 'Post entry')}
                      </Button>
                    )}
                    {proposal.status === 'posted' && (
                      <span className="muted">{L('Comptabilisée.', 'Posted.')}</span>
                    )}
                  </div>
                </div>
              )}
            </Card>
          )}

          {tab === 'payments' && (
            <Card
              title={L('Règlements fournisseurs', 'Supplier payments')}
              actions={<Button onClick={() => setPayOpen(true)}>{L('Nouveau règlement', 'New payment')}</Button>}
            >
              {payments.length === 0 ? (
                <EmptyState title={L('Aucun règlement.', 'No payment.')} />
              ) : (
                <>
                  <div className="table-scroll">
                    <table className="table purchase-table">
                      <thead>
                        <tr>
                          <th>{L('Numéro', 'Number')}</th>
                          <th>{L('Fournisseur', 'Supplier')}</th>
                          <th>{L('Date', 'Date')}</th>
                          <th>{L('Montant', 'Amount')}</th>
                          <th>{L('Type', 'Type')}</th>
                          <th>{L('Affectations', 'Allocations')}</th>
                          <th>{t('common.status')}</th>
                          <th>{t('common.actions')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {payments.map((payment) => (
                          <tr key={payment.id}>
                            <td>{payment.payment_no ?? '—'}</td>
                            <td>{payment.supplier_name}</td>
                            <td>{payment.payment_date}</td>
                            <td>{money(payment.amount, locale, payment.currency)}</td>
                            <td>{payment.kind === 'advance' ? L('Acompte', 'Advance') : L('Règlement', 'Payment')}</td>
                            <td>{payment.allocations.filter((a) => !a.cancelledAt).length}</td>
                            <td>
                              {payment.status === 'cancelled'
                                ? <Badge>{L('Annulé', 'Cancelled')}</Badge>
                                : payment.accounting_entry_id
                                  ? <Badge kind="success">{L('Comptabilisé', 'Posted')}</Badge>
                                  : <Badge kind="warning">{L('À comptabiliser', 'To post')}</Badge>}
                            </td>
                            <td>
                              <PaymentActions
                                payment={payment}
                                L={L}
                                onProposal={() => void preparePaymentProposal(payment)}
                                onCancel={() => setCancelDialog({ type: 'payment', id: payment.id, label: payment.payment_no ?? payment.reference ?? '' })}
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="purchase-cards">
                    {payments.map((payment) => (
                      <article className="purchase-card" key={`card-${payment.id}`}>
                        <div className="purchase-card-head">
                          <strong>{payment.payment_no ?? '—'}</strong>
                          {payment.status === 'cancelled'
                            ? <Badge>{L('Annulé', 'Cancelled')}</Badge>
                            : payment.accounting_entry_id
                              ? <Badge kind="success">{L('Comptabilisé', 'Posted')}</Badge>
                              : <Badge kind="warning">{L('À comptabiliser', 'To post')}</Badge>}
                        </div>
                        <div className="purchase-card-row"><span>{L('Fournisseur', 'Supplier')}</span><span>{payment.supplier_name}</span></div>
                        <div className="purchase-card-row"><span>{L('Date', 'Date')}</span><span>{payment.payment_date}</span></div>
                        <div className="purchase-card-row"><span>{L('Montant', 'Amount')}</span><span>{money(payment.amount, locale, payment.currency)}</span></div>
                        <div className="purchase-card-row"><span>{L('Affectations', 'Allocations')}</span><span>{payment.allocations.filter((a) => !a.cancelledAt).length}</span></div>
                        <div className="purchase-card-actions">
                          <PaymentActions
                            payment={payment}
                            L={L}
                            onProposal={() => void preparePaymentProposal(payment)}
                            onCancel={() => setCancelDialog({ type: 'payment', id: payment.id, label: payment.payment_no ?? '' })}
                          />
                        </div>
                      </article>
                    ))}
                  </div>
                </>
              )}
            </Card>
          )}

          {tab === 'aging' && (
            <Card
              title={L('Échéancier des dettes fournisseurs', 'Supplier debt aging')}
              actions={<Button variant="ghost" onClick={() => void downloadAging()}>{t('common.exportCsv')}</Button>}
            >
              {!aging ? (
                <Spinner label={t('common.loading')} />
              ) : aging.groups.length === 0 ? (
                <EmptyState title={L('Aucune facture fournisseur ouverte.', 'No open supplier invoice.')} />
              ) : (
                <>
                  <div className="aging-totals">
                    {aging.totalsByCurrency.map((total) => (
                      <div className="metric" key={total.currency}>
                        <span className="muted">{total.currency}</span>
                        <strong>{money(total.outstanding, locale, total.currency)}</strong>
                        <small>{L('dont échu', 'of which overdue')} {money(total.overdue, locale)}</small>
                      </div>
                    ))}
                  </div>
                  {aging.groups.map((group) => (
                    <section key={`${group.supplierId}-${group.currency}`} className="aging-group">
                      <h3>
                        {group.supplierName} — {group.currency}{' '}
                        <span className="muted">
                          {L('restant', 'outstanding')} {money(group.outstanding, locale, group.currency)}
                          {toScaled4(group.overdue)! > 0n ? ` · ${L('échu', 'overdue')} ${money(group.overdue, locale)}` : ''}
                        </span>
                      </h3>
                      <div className="table-scroll">
                        <table className="table purchase-table">
                          <thead>
                            <tr>
                              <th>{L('Facture', 'Invoice')}</th>
                              <th>{L('Référence', 'Reference')}</th>
                              <th>{L('Échéance', 'Due')}</th>
                              <th>{L('Total', 'Total')}</th>
                              <th>{L('Payé', 'Paid')}</th>
                              <th>{L('Avoir', 'Credit')}</th>
                              <th>{L('Restant', 'Outstanding')}</th>
                              <th>{L('Retard', 'Overdue')}</th>
                              <th>{L('Comptabilisée', 'Posted')}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {group.invoices.map((invoice) => (
                              <tr key={invoice.id} className={invoice.daysOverdue > 0 ? 'row-overdue' : ''}>
                                <td>{invoice.docNo ?? '—'}</td>
                                <td>{invoice.supplierReference}</td>
                                <td>{invoice.dueDate ?? '—'}</td>
                                <td>{money(invoice.total, locale, group.currency)}</td>
                                <td>{money(invoice.paid, locale)}</td>
                                <td>{money(invoice.credited, locale)}</td>
                                <td><strong>{money(invoice.outstanding, locale)}</strong></td>
                                <td>{invoice.daysOverdue > 0 ? `${invoice.daysOverdue} j` : L('À échoir', 'Not due')}</td>
                                <td>{invoice.accountingPosted ? L('Oui', 'Yes') : L('Non', 'No')}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <div className="purchase-cards">
                        {group.invoices.map((invoice) => (
                          <article className="purchase-card" key={`card-${invoice.id}`}>
                            <div className="purchase-card-head">
                              <strong>{invoice.docNo ?? '—'}</strong>
                              {invoice.daysOverdue > 0 ? <Badge kind="danger">{invoice.daysOverdue} j</Badge> : <Badge kind="info">{L('À échoir', 'Not due')}</Badge>}
                            </div>
                            <div className="purchase-card-row"><span>{L('Fournisseur', 'Supplier')}</span><span>{group.supplierName}</span></div>
                            <div className="purchase-card-row"><span>{L('Échéance', 'Due')}</span><span>{invoice.dueDate ?? '—'}</span></div>
                            <div className="purchase-card-row"><span>{L('Restant', 'Outstanding')}</span><span>{money(invoice.outstanding, locale, group.currency)}</span></div>
                          </article>
                        ))}
                      </div>
                    </section>
                  ))}
                  <p className="muted">
                    {L(
                      'Les devises ne sont jamais additionnées. Une facture avec reliquat n’est jamais présentée comme soldée.',
                      'Currencies are never added together. An invoice with an outstanding balance is never shown as paid.',
                    )}
                  </p>
                </>
              )}
            </Card>
          )}
        </>
      )}

      {/* ---------------------------------------------------------- supplier modal */}
      <Modal open={supplierOpen} title={L('Nouveau fournisseur', 'New supplier')} onClose={() => setSupplierOpen(false)} wide>
        <div className="form-grid">
          <Field label={L('Nom ou raison sociale', 'Name or legal name')}>
            <input value={supplierForm.name} onChange={(e) => setSupplierForm({ ...supplierForm, name: e.target.value })} />
          </Field>
          <Field label={L('Référence interne', 'Internal reference')}>
            <input value={supplierForm.reference} onChange={(e) => setSupplierForm({ ...supplierForm, reference: e.target.value })} />
          </Field>
          <Field label={L('Pays', 'Country')} hint={L('Code ISO 2 lettres ; aucun identifiant fiscal étranger imposé.', '2-letter ISO code; no foreign tax ID is imposed.')}>
            <input maxLength={2} value={supplierForm.country} onChange={(e) => setSupplierForm({ ...supplierForm, country: e.target.value.toUpperCase() })} />
          </Field>
          <Field label={L('Devise habituelle', 'Usual currency')}>
            <input maxLength={3} value={supplierForm.preferredCurrency} onChange={(e) => setSupplierForm({ ...supplierForm, preferredCurrency: e.target.value.toUpperCase() })} placeholder="MUR" />
          </Field>
          <Field label={L('Délai de règlement (jours)', 'Payment terms (days)')}>
            <input type="number" min={0} max={365} value={supplierForm.paymentTermsDays} onChange={(e) => setSupplierForm({ ...supplierForm, paymentTermsDays: e.target.value })} />
          </Field>
          <Field label={L('Compte fournisseur', 'Payable account')} hint={L('Plan comptable actif de la société.', 'Active chart of the company.')}>
            <select value={supplierForm.payableAccountId} onChange={(e) => setSupplierForm({ ...supplierForm, payableAccountId: e.target.value })}>
              <option value="">{L('Compte par défaut (2000)', 'Default account (2000)')}</option>
              {accounts.filter((a) => a.is_active && a.type === 'liability').map((a) => (
                <option key={a.id} value={a.id}>{a.code} — {a.name}</option>
              ))}
            </select>
          </Field>
          <Field label={L('Numéro d’enregistrement', 'Registration number')}>
            <input value={supplierForm.registrationNumber} onChange={(e) => setSupplierForm({ ...supplierForm, registrationNumber: e.target.value })} placeholder={L('Selon les données disponibles', 'If available')} />
          </Field>
          <Field label={L('Numéro fiscal / TVA', 'Tax / VAT number')}>
            <input value={supplierForm.taxNumber} onChange={(e) => setSupplierForm({ ...supplierForm, taxNumber: e.target.value })} placeholder={L('Facultatif', 'Optional')} />
          </Field>
          <Field label={L('E-mail', 'Email')}>
            <input type="email" value={supplierForm.contactEmail} onChange={(e) => setSupplierForm({ ...supplierForm, contactEmail: e.target.value })} />
          </Field>
          <Field label={L('Téléphone', 'Phone')}>
            <input value={supplierForm.contactPhone} onChange={(e) => setSupplierForm({ ...supplierForm, contactPhone: e.target.value })} />
          </Field>
          <Field label={L('Adresse', 'Address')}>
            <input value={supplierForm.addressLine1} onChange={(e) => setSupplierForm({ ...supplierForm, addressLine1: e.target.value })} />
          </Field>
          <Field label={L('Ville', 'City')}>
            <input value={supplierForm.city} onChange={(e) => setSupplierForm({ ...supplierForm, city: e.target.value })} />
          </Field>
          <Field label={L('Personne de contact', 'Contact name')}>
            <input value={supplierForm.contactName} onChange={(e) => setSupplierForm({ ...supplierForm, contactName: e.target.value })} />
          </Field>
          <Field label={L('Notes internes', 'Internal notes')}>
            <input value={supplierForm.notes} onChange={(e) => setSupplierForm({ ...supplierForm, notes: e.target.value })} />
          </Field>
        </div>
        <div className="modal-actions">
          <Button variant="ghost" onClick={() => setSupplierOpen(false)}>{t('common.cancel')}</Button>
          <Button onClick={() => void createSupplier()} disabled={busy || supplierForm.name.trim() === ''}>{t('common.create')}</Button>
        </div>
      </Modal>

      <Modal open={supplierDetail !== null} title={supplierDetail?.name ?? ''} onClose={() => setSupplierDetail(null)} wide>
        {supplierDetail && (
          <>
            <div className="detail-grid">
              <div><span className="muted">{L('Référence', 'Reference')}</span><br />{supplierDetail.reference ?? '—'}</div>
              <div><span className="muted">{L('Pays', 'Country')}</span><br />{supplierDetail.country}</div>
              <div><span className="muted">{L('Adresse', 'Address')}</span><br />{supplierDetail.address_line1 ?? '—'}</div>
              <div><span className="muted">{L('Ville', 'City')}</span><br />{supplierDetail.city ?? '—'}</div>
              <div><span className="muted">{L('Enregistrement', 'Registration')}</span><br />{supplierDetail.registration_number ?? '—'}</div>
              <div><span className="muted">{L('Fiscal', 'Tax')}</span><br />{supplierDetail.tax_number ?? '—'}</div>
              <div><span className="muted">{L('E-mail', 'Email')}</span><br />{supplierDetail.contact_email ?? '—'}</div>
              <div><span className="muted">{L('Téléphone', 'Phone')}</span><br />{supplierDetail.contact_phone ?? '—'}</div>
            </div>
            <h3>{L('Soldes par devise', 'Balances by currency')}</h3>
            {!supplierBalance ? (
              <Spinner />
            ) : supplierBalance.balances.length === 0 ? (
              <p className="muted">{L('Aucune facture validée.', 'No validated invoice.')}</p>
            ) : (
              <div className="table-scroll">
                <table className="table">
                  <thead><tr><th>{t('common.currency')}</th><th>{L('Factures', 'Invoices')}</th><th>{L('Restant', 'Outstanding')}</th><th>{L('Échu', 'Overdue')}</th><th>{L('Avoirs disponibles', 'Available credits')}</th></tr></thead>
                  <tbody>
                    {supplierBalance.balances.map((row) => {
                      const credits = supplierBalance.creditAvailable.find((c) => c.currency === row.currency);
                      return (
                        <tr key={row.currency}>
                          <td>{row.currency}</td>
                          <td>{row.invoiceCount}</td>
                          <td>{money(row.outstanding, locale)}</td>
                          <td>{money(row.overdue, locale)}</td>
                          <td>{credits ? money(credits.amount, locale) : '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
        <div className="modal-actions"><Button variant="ghost" onClick={() => setSupplierDetail(null)}>{t('common.close')}</Button></div>
      </Modal>

      {/* ---------------------------------------------------------- document modal */}
      <Modal
        open={docOpen}
        title={docKind === 'invoice' ? L('Nouvelle facture d’achat', 'New purchase invoice') : L('Nouvel avoir fournisseur', 'New supplier credit note')}
        onClose={() => setDocOpen(false)}
        wide
      >
        <div className="form-grid">
          <Field label={L('Fournisseur', 'Supplier')}>
            <select value={docForm.supplierId} onChange={(e) => setDocForm({ ...docForm, supplierId: e.target.value })}>
              <option value="">{L('Sélectionner…', 'Select…')}</option>
              {activeSuppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
          <Field label={L('N° facture / avoir fournisseur', 'Supplier invoice / credit reference')}>
            <input value={docForm.supplierReference} onChange={(e) => setDocForm({ ...docForm, supplierReference: e.target.value })} />
          </Field>
          <Field label={L('Date', 'Date')}>
            <input type="date" value={docForm.issueDate} onChange={(e) => setDocForm({ ...docForm, issueDate: e.target.value })} />
          </Field>
          <Field label={L('Date d’échéance', 'Due date')}>
            <input type="date" value={docForm.dueDate} onChange={(e) => setDocForm({ ...docForm, dueDate: e.target.value })} />
          </Field>
          <Field label={L('Devise', 'Currency')}>
            <input maxLength={3} value={docForm.currency} onChange={(e) => setDocForm({ ...docForm, currency: e.target.value.toUpperCase() })} />
          </Field>
          <Field label={L('Taux de change', 'Exchange rate')} hint={L('Obligatoire si la devise diffère de la devise fonctionnelle ; jamais inventé.', 'Required for a foreign currency; never inferred.')}>
            <input inputMode="decimal" value={docForm.exchangeRate} onChange={(e) => setDocForm({ ...docForm, exchangeRate: e.target.value })} placeholder="1" />
          </Field>
          {docKind === 'credit_note' && (
            <Field label={L('Facture d’origine (facultative)', 'Source invoice (optional)')}>
              <select value={docForm.sourceDocumentId} onChange={(e) => setDocForm({ ...docForm, sourceDocumentId: e.target.value })}>
                <option value="">{L('Aucune', 'None')}</option>
                {documents.filter((d) => d.kind === 'invoice' && (!docForm.supplierId || d.supplier_id === docForm.supplierId)).map((d) => (
                  <option key={d.id} value={d.id}>{d.doc_no ?? L('Brouillon', 'Draft')} — {d.supplier_reference}</option>
                ))}
              </select>
            </Field>
          )}
          {docKind === 'credit_note' && (
            <Field label={L('Motif', 'Reason')}>
              <input value={docForm.reason} onChange={(e) => setDocForm({ ...docForm, reason: e.target.value })} />
            </Field>
          )}
          <Field label={L('Description', 'Description')}>
            <input value={docForm.description} onChange={(e) => setDocForm({ ...docForm, description: e.target.value })} />
          </Field>
        </div>

        <h3>{L('Lignes', 'Lines')}</h3>
        {docLines.map((line, index) => (
          <div className="purchase-line" key={index}>
            <Field label={L('Description', 'Description')}>
              <input value={line.description} onChange={(e) => setDocLines(docLines.map((l, i) => (i === index ? { ...l, description: e.target.value } : l)))} />
            </Field>
            <Field label={L('Quantité', 'Quantity')}>
              <input inputMode="decimal" value={line.quantity} onChange={(e) => setDocLines(docLines.map((l, i) => (i === index ? { ...l, quantity: e.target.value } : l)))} />
            </Field>
            <Field label={L('Prix unitaire HT', 'Unit price (net)')}>
              <input inputMode="decimal" value={line.unitPrice} onChange={(e) => setDocLines(docLines.map((l, i) => (i === index ? { ...l, unitPrice: e.target.value } : l)))} />
            </Field>
            <Field label={L('Compte', 'Account')}>
              <select value={line.accountId} onChange={(e) => setDocLines(docLines.map((l, i) => (i === index ? { ...l, accountId: e.target.value } : l)))}>
                <option value="">{L('Sélectionner…', 'Select…')}</option>
                {expenseAccounts.map((a) => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
              </select>
            </Field>
            <Field label={L('Traitement TVA', 'VAT treatment')} hint={L('Aucune règle mauricienne n’est supposée.', 'No Mauritian rule is assumed.')}>
              <select value={line.vatTreatment} onChange={(e) => setDocLines(docLines.map((l, i) => (i === index ? { ...l, vatTreatment: e.target.value } : l)))}>
                <option value="out_of_scope">{L('Hors champ (à confirmer)', 'Out of scope (to confirm)')}</option>
                <option value="exempt">{L('Exonéré (à confirmer)', 'Exempt (to confirm)')}</option>
                <option value="zero_rated">{L('Taux zéro (à confirmer)', 'Zero-rated (to confirm)')}</option>
                <option value="standard">{L('Standard — taux vérifié', 'Standard — verified rate')}</option>
              </select>
            </Field>
            {line.vatTreatment === 'standard' && (
              <>
                <Field label={L('Taux configuré', 'Configured rate')}>
                  <select value={line.vatRateId} onChange={(e) => setDocLines(docLines.map((l, i) => (i === index ? { ...l, vatRateId: e.target.value } : l)))}>
                    <option value="">{L('Sélectionner…', 'Select…')}</option>
                    {taxRates.filter((r) => r.verified).map((r) => <option key={r.id} value={r.id}>{r.code} — {r.rate}%</option>)}
                  </select>
                </Field>
                <Field label={L('TVA récupérable ?', 'Input VAT recoverable?')} hint={L('Décision explicite, jamais déduite.', 'Explicit decision, never inferred.')}>
                  <select value={line.vatRecoverable} onChange={(e) => setDocLines(docLines.map((l, i) => (i === index ? { ...l, vatRecoverable: e.target.value } : l)))}>
                    <option value="">{L('— choisir —', '— choose —')}</option>
                    <option value="true">{L('Oui', 'Yes')}</option>
                    <option value="false">{L('Non (incluse au coût)', 'No (included in cost)')}</option>
                  </select>
                </Field>
              </>
            )}
            <div className="purchase-line-remove">
              {docLines.length > 1 && (
                <Button variant="ghost" onClick={() => setDocLines(docLines.filter((_, i) => i !== index))}>{L('Retirer', 'Remove')}</Button>
              )}
            </div>
          </div>
        ))}
        <Button variant="ghost" onClick={() => setDocLines([...docLines, emptyLine(expenseAccounts[0]?.id ?? '')])}>{L('Ajouter une ligne', 'Add a line')}</Button>

        <div className="modal-actions">
          <Button variant="ghost" onClick={() => setDocOpen(false)}>{t('common.cancel')}</Button>
          <Button onClick={() => void submitDocument()} disabled={busy || !docForm.supplierId || !docForm.supplierReference}>{L('Enregistrer le brouillon', 'Save draft')}</Button>
        </div>
        <p className="muted">
          {L(
            'Le brouillon ne crée aucune écriture. La validation attribue un numéro interne ; la proposition comptable est préparée séparément.',
            'The draft creates no entry. Validation assigns an internal number; the accounting proposal is prepared separately.',
          )}
        </p>
      </Modal>

      {/* ---------------------------------------------------------- payment modal */}
      <Modal open={payOpen} title={L('Nouveau règlement fournisseur', 'New supplier payment')} onClose={() => setPayOpen(false)} wide>
        <div className="form-grid">
          <Field label={L('Fournisseur', 'Supplier')}>
            <select value={payForm.supplierId} onChange={(e) => { setPayForm({ ...payForm, supplierId: e.target.value }); setPayAllocations({}); }}>
              <option value="">{L('Sélectionner…', 'Select…')}</option>
              {activeSuppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
          <Field label={L('Type', 'Type')}>
            <select value={payForm.kind} onChange={(e) => setPayForm({ ...payForm, kind: e.target.value as 'payment' | 'advance' })}>
              <option value="payment">{L('Règlement', 'Payment')}</option>
              <option value="advance">{L('Acompte', 'Advance')}</option>
            </select>
          </Field>
          <Field label={L('Date', 'Date')}>
            <input type="date" value={payForm.paymentDate} onChange={(e) => setPayForm({ ...payForm, paymentDate: e.target.value })} />
          </Field>
          <Field label={L('Montant', 'Amount')}>
            <input inputMode="decimal" value={payForm.amount} onChange={(e) => setPayForm({ ...payForm, amount: e.target.value })} />
          </Field>
          <Field label={L('Devise', 'Currency')}>
            <input maxLength={3} value={payForm.currency} onChange={(e) => setPayForm({ ...payForm, currency: e.target.value.toUpperCase() })} />
          </Field>
          <Field label={L('Taux de change', 'Exchange rate')}>
            <input inputMode="decimal" value={payForm.exchangeRate} onChange={(e) => setPayForm({ ...payForm, exchangeRate: e.target.value })} placeholder="1" />
          </Field>
          <Field label={L('Mode', 'Method')}>
            <select value={payForm.method} onChange={(e) => setPayForm({ ...payForm, method: e.target.value })}>
              <option value="bank_transfer">{L('Virement', 'Bank transfer')}</option>
              <option value="cheque">{L('Chèque', 'Cheque')}</option>
              <option value="cash">{L('Espèces', 'Cash')}</option>
              <option value="card">{L('Carte', 'Card')}</option>
              <option value="other">{L('Autre', 'Other')}</option>
            </select>
          </Field>
          <Field label={L('Référence', 'Reference')}>
            <input value={payForm.reference} onChange={(e) => setPayForm({ ...payForm, reference: e.target.value })} />
          </Field>
        </div>
        {payForm.kind === 'advance' ? (
          <p className="alert alert-warn">
            {L('Un acompte reste non affecté et ne solde aucune facture tant qu’il n’est pas affecté.', 'An advance remains unallocated and settles no invoice until allocated.')}
          </p>
        ) : (
          <>
            <h3>{L('Affecter aux factures ouvertes', 'Allocate to open invoices')}</h3>
            {!payForm.supplierId ? (
              <p className="muted">{L('Sélectionnez d’abord un fournisseur.', 'Select a supplier first.')}</p>
            ) : invoicesForSupplier.length === 0 ? (
              <p className="muted">{L('Aucune facture ouverte pour ce fournisseur.', 'No open invoice for this supplier.')}</p>
            ) : (
              <div className="allocation-list">
                {invoicesForSupplier.map((invoice) => (
                  <div className="allocation-row" key={invoice.id}>
                    <label>
                      <input
                        type="checkbox"
                        checked={payAllocations[invoice.id] !== undefined}
                        onChange={(e) => setPayAllocations((prev) => {
                          const next = { ...prev };
                          if (e.target.checked) next[invoice.id] = invoice.outstanding_amount;
                          else delete next[invoice.id];
                          return next;
                        })}
                      />{' '}
                      {invoice.doc_no ?? '—'} — {invoice.supplier_reference} ({money(invoice.outstanding_amount, locale, invoice.currency)})
                    </label>
                    {payAllocations[invoice.id] !== undefined && (
                      <input
                        inputMode="decimal"
                        value={payAllocations[invoice.id]}
                        onChange={(e) => setPayAllocations({ ...payAllocations, [invoice.id]: e.target.value })}
                      />
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
        <div className="modal-actions">
          <Button variant="ghost" onClick={() => setPayOpen(false)}>{t('common.cancel')}</Button>
          <Button onClick={() => void createPayment()} disabled={busy || !payForm.supplierId}>{L('Enregistrer le règlement', 'Save payment')}</Button>
        </div>
      </Modal>

      {/* ---------------------------------------------------------- credit allocation modal */}
      <Modal open={creditOpen} title={L('Affecter un avoir fournisseur', 'Allocate a supplier credit note')} onClose={() => setCreditOpen(false)} wide>
        <div className="form-grid">
          <Field label={L('Avoir validé', 'Validated credit note')}>
            <select value={creditForm.creditNoteId} onChange={(e) => setCreditForm({ ...creditForm, creditNoteId: e.target.value })}>
              <option value="">{L('Sélectionner…', 'Select…')}</option>
              {creditNotes.filter((c) => c.status === 'validated' && toScaled4(c.credit_available)! > 0n).map((c) => (
                <option key={c.id} value={c.id}>{c.doc_no} — {c.supplier_name} ({money(c.credit_available, locale, c.currency)})</option>
              ))}
            </select>
          </Field>
          <Field label={L('Facture à réduire', 'Invoice to reduce')}>
            <select value={creditForm.invoiceId} onChange={(e) => setCreditForm({ ...creditForm, invoiceId: e.target.value })}>
              <option value="">{L('Sélectionner…', 'Select…')}</option>
              {documents.filter((d) => d.kind === 'invoice' && d.status === 'validated' && toScaled4(d.outstanding_amount)! > 0n).map((d) => (
                <option key={d.id} value={d.id}>{d.doc_no} — {d.supplier_name} ({money(d.outstanding_amount, locale, d.currency)})</option>
              ))}
            </select>
          </Field>
          <Field label={L('Montant', 'Amount')}>
            <input inputMode="decimal" value={creditForm.amount} onChange={(e) => setCreditForm({ ...creditForm, amount: e.target.value })} />
          </Field>
          <Field label={L('Motif', 'Reason')}>
            <input value={creditForm.reason} onChange={(e) => setCreditForm({ ...creditForm, reason: e.target.value })} />
          </Field>
        </div>
        <p className="alert alert-warn">
          {L(
            'L’affectation réduit le solde commercial. Elle ne modifie ni ne supprime une facture déjà comptabilisée et ne crée aucune écriture.',
            'The allocation reduces the commercial balance. It neither changes nor deletes a posted invoice and creates no entry.',
          )}
        </p>
        <div className="modal-actions">
          <Button variant="ghost" onClick={() => setCreditOpen(false)}>{t('common.cancel')}</Button>
          <Button
            onClick={() => void allocateCredit()}
            disabled={busy || !creditForm.creditNoteId || !creditForm.invoiceId || !creditForm.amount}
          >
            {L('Confirmer l’affectation', 'Confirm allocation')}
          </Button>
        </div>
      </Modal>

      {/* ---------------------------------------------------------- cancellation modal */}
      <Modal open={cancelDialog !== null} title={L('Confirmer l’annulation', 'Confirm cancellation')} onClose={() => setCancelDialog(null)}>
        <p>
          {L('Document ou règlement', 'Document or payment')} <strong>{cancelDialog?.label}</strong>.{' '}
          {L('L’historique est conservé ; aucune ligne n’est supprimée.', 'History is kept; no row is deleted.')}
        </p>
        <Field label={L('Motif', 'Reason')}>
          <input value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} />
        </Field>
        <div className="modal-actions">
          <Button variant="ghost" onClick={() => setCancelDialog(null)}>{t('common.cancel')}</Button>
          <Button onClick={() => void doCancel()} disabled={busy}>{L('Annuler avec motif', 'Cancel with reason')}</Button>
        </div>
      </Modal>
    </div>
  );
}

function DocumentActions({
  doc,
  L,
  onValidate,
  onProposal,
  onCancel,
}: {
  doc: PurchaseDoc;
  L: (fr: string, en: string) => string;
  onValidate: () => void;
  onProposal: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="page-actions">
      {doc.status === 'draft' && <Button variant="ghost" onClick={onValidate}>{L('Valider', 'Validate')}</Button>}
      {doc.status === 'validated' && !doc.accounting_entry_id && (
        <Button variant="ghost" onClick={onProposal}>{L('Proposition', 'Proposal')}</Button>
      )}
      {doc.status !== 'cancelled' && !doc.accounting_entry_id && (
        <Button variant="ghost" onClick={onCancel}>{L('Annuler', 'Cancel')}</Button>
      )}
      {doc.accounting_entry_id && <span className="muted">{L('Écriture liée', 'Entry linked')}</span>}
    </div>
  );
}

function PaymentActions({
  payment,
  L,
  onProposal,
  onCancel,
}: {
  payment: PurchasePayment;
  L: (fr: string, en: string) => string;
  onProposal: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="page-actions">
      {payment.status === 'recorded' && !payment.accounting_entry_id && (
        <Button variant="ghost" onClick={onProposal}>{L('Proposition', 'Proposal')}</Button>
      )}
      {payment.status === 'recorded' && (
        <Button variant="ghost" onClick={onCancel}>{L('Annuler', 'Cancel')}</Button>
      )}
    </div>
  );
}
