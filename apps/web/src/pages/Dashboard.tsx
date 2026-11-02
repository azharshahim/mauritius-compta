import { Link } from 'react-router-dom';
import { api } from '../api';
import { useI18n } from '../i18n';
import { useSession } from '../store';
import { useAsync } from '../hooks';
import { Badge, Card, DemoNotice, EmptyState, ErrorBanner, KpiCard, Spinner } from '../components/ui';
import type { KpiTone } from '../components/ui';
import { AppIcon, type IconName } from '../components/AppIcon';
import { date, money } from '../format';

interface DashboardData {
  kpis: {
    accounts: number;
    journals: number;
    draftEntries: number;
    postedEntries: number;
    revenue: string;
    expenses: string;
    profit: string;
    balancedSheet: boolean;
    currency: string;
    totalAssets: string;
  };
  recentEntries: {
    id: string;
    entry_no: string;
    entry_date: string;
    description: string;
    status: 'draft' | 'posted';
    journal_code: string;
    total_debit: string;
  }[];
  range: { from: string; to: string };
}

interface DocumentRow {
  id: string;
  kind: 'purchase' | 'sale' | 'unknown';
  status: string;
  original_name: string;
  party_name: string | null;
  invoice_number: string | null;
  total_amount: string | null;
  currency: string | null;
  duplicate_of: string | null;
  created_at: string;
}

interface BankAccount {
  id: string;
  name: string;
  bank_name: string;
  currency: string;
  unmatched_count?: number;
  is_active: boolean;
}

interface BankImport {
  id: string;
  file_name: string;
  status: string;
  row_count: number;
  imported_count: number;
  duplicate_count: number;
  created_at: string;
}

interface DashboardBundle {
  dashboard: DashboardData;
  documents: DocumentRow[];
  accounts: BankAccount[];
  imports: BankImport[];
}

const D = {
  fr: {
    title: 'Tableau de bord',
    greeting: 'Vue d’ensemble de la comptabilité',
    range: 'Exercice',
    importBulk: 'Import groupé',
    reconcile: 'Rapprochement groupé',
    revenue: 'Produits',
    expenses: 'Charges',
    profit: 'Résultat',
    assets: 'Total actif',
    drafts: 'Écritures à vérifier',
    pendingDocs: 'Documents à traiter',
    balanceOk: 'Bilan équilibré',
    balanceKo: 'Bilan déséquilibré : vérifiez les écritures.',
    toProcess: 'À traiter maintenant',
    documents: 'Documents à traiter',
    documentsEmpty: 'Aucun document en attente. Les imports récents apparaîtront ici.',
    duplicate: 'Doublon détecté',
    extracted: 'Extrait',
    proposed: 'Proposition prête',
    imports: 'Importations bancaires récentes',
    importsEmpty: 'Aucun relevé importé pour cette société.',
    importMeta: 'lignes · importées',
    duplicates: 'doublons',
    reconciliation: 'Rapprochements en attente',
    reconciliationHelp: 'Transactions non rapprochées sur les comptes bancaires.',
    openReconciliation: 'Ouvrir le rapprochement',
    noAccounts: 'Aucun compte bancaire actif.',
    recent: 'Activité récente',
    recentHelp: 'Dernières écritures enregistrées, brouillons compris.',
    recentEmpty: 'Aucune écriture récente.',
    quick: 'Accès rapides',
    quickPurchases: 'Achats',
    quickSales: 'Ventes',
    quickBank: 'Banque',
    quickDocuments: 'Documents',
    quickReports: 'États financiers',
    quickAccounts: 'Plan comptable',
    quickEntries: 'Écritures',
    quickSettings: 'Paramètres',
    documentsCount: 'document(s) en attente',
    pendingRecon: 'transaction(s) à rapprocher',
    verifyDrafts: 'écriture(s) à vérifier',
    seeAll: 'Tout voir',
    view: 'Ouvrir',
    statusDraft: 'Brouillon',
    statusPosted: 'Validée',
    noCompany: 'Aucune société active',
    noCompanyHelp: 'Sélectionnez ou créez une société pour voir le tableau de bord.',
    createCompany: 'Gérer les sociétés',
    importDate: 'Importé le',
    pagesTitle: 'Périmètre',
    realData: 'Toutes les valeurs proviennent des APIs de la société active ; aucun indicateur n’est simulé.',
  },
  en: {
    title: 'Dashboard',
    greeting: 'Accounting overview',
    range: 'Financial year',
    importBulk: 'Bulk import',
    reconcile: 'Bulk reconciliation',
    revenue: 'Revenue',
    expenses: 'Expenses',
    profit: 'Profit',
    assets: 'Total assets',
    drafts: 'Entries to review',
    pendingDocs: 'Documents to process',
    balanceOk: 'Balance sheet is balanced',
    balanceKo: 'Balance sheet is unbalanced: review the entries.',
    toProcess: 'To process now',
    documents: 'Documents to process',
    documentsEmpty: 'No pending document. Recent imports will appear here.',
    duplicate: 'Duplicate detected',
    extracted: 'Extracted',
    proposed: 'Proposal ready',
    imports: 'Recent bank imports',
    importsEmpty: 'No statement imported for this company.',
    importMeta: 'rows · imported',
    duplicates: 'duplicates',
    reconciliation: 'Pending reconciliations',
    reconciliationHelp: 'Unmatched transactions across bank accounts.',
    openReconciliation: 'Open reconciliation',
    noAccounts: 'No active bank account.',
    recent: 'Recent activity',
    recentHelp: 'Latest recorded entries, drafts included.',
    recentEmpty: 'No recent entry.',
    quick: 'Quick access',
    quickPurchases: 'Purchases',
    quickSales: 'Sales',
    quickBank: 'Banking',
    quickDocuments: 'Documents',
    quickReports: 'Financial statements',
    quickAccounts: 'Chart of accounts',
    quickEntries: 'Entries',
    quickSettings: 'Settings',
    documentsCount: 'pending document(s)',
    pendingRecon: 'transaction(s) to reconcile',
    verifyDrafts: 'entr(ies) to review',
    seeAll: 'See all',
    view: 'Open',
    statusDraft: 'Draft',
    statusPosted: 'Posted',
    noCompany: 'No active company',
    noCompanyHelp: 'Select or create a company to see the dashboard.',
    createCompany: 'Manage companies',
    importDate: 'Imported on',
    pagesTitle: 'Scope',
    realData: 'Every value comes from the active company’s APIs; no indicator is simulated.',
  },
} as const;

export default function DashboardPage() {
  const { t, locale } = useI18n();
  const tr = D[locale];
  const { company } = useSession();
  const { data, loading, error } = useAsync<DashboardBundle | null>(async () => {
    if (!company) return null;
    const [dashboard, documents, accounts, imports] = await Promise.all([
      api.get<DashboardData>(`/companies/${company.id}/dashboard`),
      api.get<{ documents: DocumentRow[] }>(`/companies/${company.id}/documents`),
      api.get<{ accounts: BankAccount[] }>(`/companies/${company.id}/bank/accounts`),
      api.get<{ imports: BankImport[] }>(`/companies/${company.id}/bank/imports`),
    ]);
    return { dashboard, documents: documents.documents, accounts: accounts.accounts, imports: imports.imports };
  }, [company?.id]);

  if (!company) {
    return (
      <Card title={tr.noCompany}>
        <EmptyState title={tr.noCompanyHelp}>
          <Link className="btn btn-primary" to="/companies" style={{ display: 'inline-block', marginTop: 12 }}>
            {tr.createCompany}
          </Link>
        </EmptyState>
      </Card>
    );
  }

  if (loading) return <Spinner label={t('common.loading')} />;

  const dashboard = data?.dashboard;
  const documents = (data?.documents ?? []).filter((doc) => ['EXTRACTED', 'PROPOSED', 'DUPLICATE'].includes(doc.status));
  const pendingDocuments = documents.filter((doc) => doc.status !== 'DUPLICATE').length;
  const accounts = (data?.accounts ?? []).filter((account) => account.is_active);
  const unmatched = accounts.reduce((sum, account) => sum + (account.unmatched_count ?? 0), 0);
  const imports = (data?.imports ?? []).slice(0, 5);
  const draftEntries = dashboard?.kpis.draftEntries ?? 0;

  const kpis: { key: string; label: string; value: string; detail: string; icon: IconName; tone: KpiTone }[] = dashboard
    ? [
        {
          key: 'revenue',
          label: tr.revenue,
          value: money(dashboard.kpis.revenue, locale, dashboard.kpis.currency),
          detail: `${dashboard.kpis.currency} · ${dashboard.range.from} → ${dashboard.range.to}`,
          icon: 'sales',
          tone: 'primary',
        },
        {
          key: 'expenses',
          label: tr.expenses,
          value: money(dashboard.kpis.expenses, locale, dashboard.kpis.currency),
          detail: `${dashboard.kpis.currency} · ${dashboard.range.from} → ${dashboard.range.to}`,
          icon: 'purchases',
          tone: 'violet',
        },
        {
          key: 'profit',
          label: tr.profit,
          value: money(dashboard.kpis.profit, locale, dashboard.kpis.currency),
          detail: `${dashboard.kpis.postedEntries} ${tr.statusPosted.toLowerCase()}`,
          icon: 'profitLoss',
          tone: 'teal',
        },
        {
          key: 'assets',
          label: tr.assets,
          value: money(dashboard.kpis.totalAssets, locale, dashboard.kpis.currency),
          detail: `${dashboard.kpis.accounts} ${tr.quickAccounts.toLowerCase()}`,
          icon: 'balanceSheet',
          tone: dashboard.kpis.balancedSheet ? 'success' : 'danger',
        },
        {
          key: 'drafts',
          label: tr.drafts,
          value: String(draftEntries),
          detail: tr.verifyDrafts,
          icon: 'tasks',
          tone: draftEntries > 0 ? 'warning' : 'primary',
        },
        {
          key: 'documents',
          label: tr.pendingDocs,
          value: String(pendingDocuments),
          detail: tr.documentsCount,
          icon: 'ocr',
          tone: pendingDocuments > 0 ? 'warning' : 'teal',
        },
      ]
    : [];

  const quickLinks: { icon: IconName; label: string; to: string }[] = [
    { icon: 'purchases', label: tr.quickPurchases, to: '/accounting/journals/purchases' },
    { icon: 'sales', label: tr.quickSales, to: '/accounting/journals/sales' },
    { icon: 'bank', label: tr.quickBank, to: '/accounting/banking' },
    { icon: 'periods', label: t('m46.dashboard.openBankPeriods'), to: '/accounting/banking?tab=report' },
    { icon: 'audit', label: t('m46.dashboard.openControls'), to: '/accounting/controls' },
    { icon: 'documents', label: tr.quickDocuments, to: '/documents' },
    { icon: 'statements', label: tr.quickReports, to: '/accounting/statements' },
    { icon: 'accounts', label: tr.quickAccounts, to: '/accounting/accounts' },
    { icon: 'ledger', label: tr.quickEntries, to: '/accounting/entries' },
    { icon: 'settings', label: tr.quickSettings, to: '/accounting/settings' },
  ];

  const docStatus = (doc: DocumentRow) => {
    if (doc.status === 'DUPLICATE') return <Badge kind="warning">{tr.duplicate}</Badge>;
    if (doc.status === 'PROPOSED') return <Badge kind="info">{tr.proposed}</Badge>;
    return <Badge kind="neutral">{tr.extracted}</Badge>;
  };

  return (
    <>
      <DemoNotice />
      <ErrorBanner message={error} />
      {!dashboard ? (
        <EmptyState title={t('common.error')} />
      ) : (
        <>
          <section className="dashboard-hero">
            <div>
              <div className="m44-kicker">{tr.greeting}</div>
              <h1>{tr.title}</h1>
              <div className="page-sub">
                {company.name} · {t('m46.dashboard.currencyNote').replace('{currency}', dashboard.kpis.currency)}
              </div>
              <div className="m46-context-pills">
                <Badge kind="teal">{company.functional_currency}</Badge>
                <Badge kind="info">
                  <AppIcon name="periods" size={13} /> {tr.range} {dashboard.range.from} → {dashboard.range.to}
                </Badge>
                <Badge kind={dashboard.kpis.balancedSheet ? 'success' : 'danger'}>
                  <AppIcon name={dashboard.kpis.balancedSheet ? 'validate' : 'alert'} size={13} />{' '}
                  {dashboard.kpis.balancedSheet ? tr.balanceOk : tr.balanceKo}
                </Badge>
              </div>
            </div>
            <div className="dashboard-hero-actions">
              <Link className="btn btn-primary" to="/accounting/journals/purchases/import/bulk">
                <AppIcon name="importCloud" /> {tr.importBulk}
              </Link>
              <Link className="btn" to="/accounting/banking/bulk-reconciliation">
                <AppIcon name="reconciliation" /> {tr.reconcile}
              </Link>
              <Link className="btn" to={`/cabinet/clients/${company.id}/workspace`}>
                <AppIcon name="cabinet" /> {t('m46.shell.openWorkspace')}
              </Link>
            </div>
          </section>

          <div className="dashboard-kpis">
            {kpis.map((kpi) => (
              <KpiCard
                key={kpi.key}
                label={kpi.label}
                value={kpi.value}
                detail={kpi.detail}
                icon={kpi.icon}
                tone={kpi.tone}
              />
            ))}
          </div>

          <section className="dashboard-columns">
            <div className="dashboard-stack">
              <Card
                title={tr.documents}
                actions={<Link className="btn btn-sm" to="/accounting/journals/purchases/import/bulk">{tr.seeAll}</Link>}
              >
                {documents.length === 0 ? (
                  <EmptyState title={tr.documentsEmpty} />
                ) : (
                  <ul className="dashboard-list">
                    {documents.slice(0, 6).map((doc) => (
                      <li key={doc.id}>
                        <span className="kpi-icon"><AppIcon name="documents" size={16} /></span>
                        <div className="dashboard-list-main">
                          <strong>{doc.party_name || doc.original_name}</strong>
                          <span className="dashboard-list-meta">
                            {doc.invoice_number ?? '—'} · {money(doc.total_amount, locale, doc.currency ?? company.functional_currency)}
                          </span>
                        </div>
                        {docStatus(doc)}
                        <Link className="btn btn-sm" to={`/documents?doc=${encodeURIComponent(doc.id)}`}>
                          <AppIcon name="view" size={15} /> {tr.view}
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>

              <Card title={tr.recent} actions={<Link className="btn btn-sm" to="/entries">{tr.seeAll}</Link>}>
                <p className="page-sub">{tr.recentHelp}</p>
                {dashboard.recentEntries.length === 0 ? (
                  <EmptyState title={tr.recentEmpty} />
                ) : (
                  <ul className="dashboard-list">
                    {dashboard.recentEntries.slice(0, 6).map((entry) => (
                      <li key={entry.id}>
                        <span className="kpi-icon"><AppIcon name="ledger" size={16} /></span>
                        <div className="dashboard-list-main">
                          <strong>{entry.description}</strong>
                          <span className="dashboard-list-meta">{entry.entry_no} · {date(entry.entry_date, locale)} · {entry.journal_code}</span>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <div className="mono">{money(entry.total_debit, locale, company.functional_currency)}</div>
                          <Badge kind={entry.status === 'posted' ? 'success' : 'warning'}>
                            {entry.status === 'posted' ? tr.statusPosted : tr.statusDraft}
                          </Badge>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </div>

            <div className="dashboard-stack">
              <Card title={tr.toProcess}>
                <ul className="dashboard-list">
                  <li>
                    <span className="kpi-icon"><AppIcon name="ocr" size={16} /></span>
                    <div className="dashboard-list-main">
                      <strong>{pendingDocuments}</strong>
                      <span className="dashboard-list-meta">{tr.documentsCount}</span>
                    </div>
                    <Link className="btn btn-sm" to="/accounting/journals/purchases/import/bulk">{tr.view}</Link>
                  </li>
                  <li>
                    <span className="kpi-icon"><AppIcon name="reconciliation" size={16} /></span>
                    <div className="dashboard-list-main">
                      <strong>{unmatched}</strong>
                      <span className="dashboard-list-meta">{tr.pendingRecon}</span>
                    </div>
                    <Link className="btn btn-sm" to="/accounting/banking/bulk-reconciliation">{tr.view}</Link>
                  </li>
                  <li>
                    <span className="kpi-icon"><AppIcon name="tasks" size={16} /></span>
                    <div className="dashboard-list-main">
                      <strong>{draftEntries}</strong>
                      <span className="dashboard-list-meta">{tr.verifyDrafts}</span>
                    </div>
                    <Link className="btn btn-sm" to="/entries?status=draft">{tr.view}</Link>
                  </li>
                </ul>
              </Card>

              <Card title={tr.reconciliation} subtitle={tr.reconciliationHelp}>
                {accounts.length === 0 ? (
                  <EmptyState icon="bank" title={tr.noAccounts} />
                ) : (
                  <ul className="dashboard-list">
                    {accounts.slice(0, 5).map((account) => (
                      <li key={account.id}>
                        <span className="kpi-icon"><AppIcon name="bank" size={16} /></span>
                        <div className="dashboard-list-main">
                          <strong>{account.name}</strong>
                          <span className="dashboard-list-meta">{account.bank_name}</span>
                        </div>
                        <Badge kind="teal">{account.currency}</Badge>
                        <Badge kind={(account.unmatched_count ?? 0) > 0 ? 'warning' : 'success'}>
                          {account.unmatched_count ?? 0}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                )}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
                  <Link className="btn btn-sm" to="/accounting/banking/bulk-reconciliation">
                    <AppIcon name="reconciliation" size={15} /> {tr.openReconciliation}
                  </Link>
                  <Link className="btn btn-sm" to="/accounting/banking?tab=report">
                    <AppIcon name="periods" size={15} /> {t('m46.dashboard.openBankPeriods')}
                  </Link>
                </div>
              </Card>

              <Card title={tr.imports}>
                {imports.length === 0 ? (
                  <EmptyState title={tr.importsEmpty} />
                ) : (
                  <ul className="dashboard-list">
                    {imports.map((item) => (
                      <li key={item.id}>
                        <span className="kpi-icon"><AppIcon name="import" size={16} /></span>
                        <div className="dashboard-list-main">
                          <strong>{item.file_name}</strong>
                          <span className="dashboard-list-meta">
                            {item.row_count} {tr.importMeta} {item.imported_count}
                            {item.duplicate_count > 0 ? ` · ${item.duplicate_count} ${tr.duplicates}` : ''}
                          </span>
                          <span className="dashboard-list-meta">{tr.importDate} {date(item.created_at, locale)}</span>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>

              <Card title={tr.quick}>
                <div className="dashboard-quick-grid">
                  {quickLinks.map((link) => (
                    <Link className="dashboard-quick" to={link.to} key={link.to}>
                      <AppIcon name={link.icon} size={17} />
                      <span>{link.label}</span>
                    </Link>
                  ))}
                </div>
              </Card>
            </div>
          </section>

          <p className="page-sub" style={{ marginTop: 12 }}>{tr.realData}</p>
        </>
      )}
    </>
  );
}
