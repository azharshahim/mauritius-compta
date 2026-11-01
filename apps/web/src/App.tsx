import { useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useI18n } from './i18n';
import { APP_VERSION, SHORT_COMMIT } from './version';
import { useSession } from './store';
import { api } from './api';
import LoginPage from './pages/Login';
import DashboardPage from './pages/Dashboard';
import AccountsPage from './pages/Accounts';
import EntriesPage from './pages/Entries';
import LedgerPage from './pages/Ledger';
import TrialBalancePage from './pages/TrialBalance';
import StatementsPage from './pages/Statements';
import EquityPage from './pages/accounting/Equity';
import FixedAssetsPage from './pages/accounting/FixedAssets';
import FinancialYearsPage from './pages/accounting/FinancialYears';
import InventoryPage from './pages/accounting/Inventory';
import AccrualsPage from './pages/accounting/Accruals';
import ProvisionsPage from './pages/accounting/Provisions';
import SettingsPage from './pages/Settings';
import CompanySettingsPage from './pages/company/CompanySettings';
import DataManagementPage from './pages/settings/DataManagement';
import CompaniesPage from './pages/Companies';
import DossierPage from './pages/cabinet/Dossier';
import CabinetDashboardPage from './pages/cabinet/CabinetDashboard';
import TasksPage from './pages/cabinet/Tasks';
import TeamPage from './pages/cabinet/Team';
import PreparedPage from './pages/prepared/Prepared';
import PurchasesPage from './pages/accounting/Purchases';
import LetteringPage from './pages/accounting/Lettering';
import MultiCurrencyPage from './pages/accounting/MultiCurrency';
import AiSettingsPage from './pages/cabinet/AiSettings';
import AiAssistantPage from './pages/cabinet/AiAssistant';
import AiProposalsPage from './pages/cabinet/AiProposals';
import MigrationPage from './pages/cabinet/Migration';
import BankPage from './pages/accounting/Bank';
import BankMcbPage from './pages/accounting/BankMcb';
import ScanImportPage from './pages/documents/ScanImport';
import BulkImportPage from './pages/documents/BulkImport';
import BulkReconciliationPage from './pages/accounting/BulkReconciliation';
import BillingOverviewPage from './pages/billing/Overview';
import BillingCustomersPage from './pages/billing/Customers';
import BillingDocumentsPage from './pages/billing/Documents';
import BillingPaymentsPage from './pages/billing/Payments';
import BillingAgingPage from './pages/billing/Aging';
import MraEInvoicingPage from './pages/billing/MraEInvoicing';
import PayrollPage from './pages/payroll/Payroll';
import PayslipViewPage from './pages/payroll/PayslipView';
import { LEGACY_REDIRECTS, type ModuleKey } from './modules';
import { NAV_GROUPS, groupIsActive, isNavItemActive } from './navigation';
import { Spinner } from './components/ui';
import { DemoBanner } from './components/DemoBanner';
import { AssistantLauncher } from './components/AssistantLauncher';
import { AppIcon } from './components/AppIcon';
import { BrandMark } from './components/BrandMark';

const ACCESS_WEIGHT: Record<string, number> = { none: 0, read: 1, write: 2, admin: 3 };

export default function App() {
  const { t, locale, setLocale } = useI18n();
  const { user, initialized, companies, company, setCompany, logout } = useSession();
  const [menuOpen, setMenuOpen] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark'>(() =>
    localStorage.getItem('mc.theme') === 'dark' ? 'dark' : 'light',
  );
  const location = useLocation();
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => {
    const active = NAV_GROUPS.find((group) => groupIsActive(group, location.pathname, location.search));
    return new Set(active ? [active.key] : ['home']);
  });

  const toggleGroup = (key: string) => {
    setOpenGroups((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // Hooks must run before any early return: the drawer is closed on navigation
  // and with the Escape key.
  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname, location.search]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('mc.theme', theme);
  }, [theme]);

  useEffect(() => {
    const active = NAV_GROUPS.find((group) => groupIsActive(group, location.pathname, location.search));
    if (!active) return;
    setOpenGroups((previous) => (previous.has(active.key) ? previous : new Set(previous).add(active.key)));
  }, [location.pathname, location.search]);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    window.addEventListener('keydown', onKey);
    // Prevent the page behind the Android drawer from scrolling while it is
    // open; the drawer's own navigation remains scrollable.
    document.body.classList.add('nav-open');
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.classList.remove('nav-open');
    };
  }, [menuOpen]);

  if (!initialized) {
    return <Spinner label={t('common.loading')} />;
  }

  if (!user) {
    return (
      <>
        <Routes>
          <Route path="*" element={<LoginPage />} />
        </Routes>
        <DemoBanner login />
      </>
    );
  }

  const closeMenu = () => setMenuOpen(false);
  const modules = (company as { modules?: Record<ModuleKey, string> } | null)?.modules;

  const moduleAllowed = (key: ModuleKey) =>
    key === 'cabinet' || !modules || ACCESS_WEIGHT[modules[key] ?? 'read']! > 0;

  const visibleGroups = NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => moduleAllowed(item.module)),
  })).filter((group) => group.items.length > 0);

  return (
    <div className="app-shell">
      <header className="topbar">
        <button
          className="btn btn-ghost mobile-only"
          onClick={() => setMenuOpen((v) => !v)}
          aria-label={t('nav.menu')}
          aria-expanded={menuOpen}
          aria-controls="app-sidebar"
        >
          <AppIcon name="menu" />
        </button>
        <div className="brand-inline">
          <BrandMark />
          <div>
            <div className="brand-name">{t('suite.name')}</div>
            <div className="brand-tag">{t('suite.tagline')}</div>
          </div>
        </div>
        <select
          aria-label={t('common.company')}
          value={company?.id ?? ''}
          onChange={(e) => setCompany(e.target.value)}
          disabled={companies.length === 0}
          className="company-select"
        >
          {companies.length === 0 && <option value="">{t('common.none')}</option>}
          {companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <span className="grow" />
        <DemoBanner />
        <select
          aria-label={t('common.language')}
          value={locale}
          onChange={(e) => {
            const next = e.target.value as 'fr' | 'en';
            setLocale(next);
            void api.patch('/auth/me', { locale: next }).catch(() => undefined);
          }}
          style={{ maxWidth: 110 }}
        >
          <option value="fr">FR</option>
          <option value="en">EN</option>
        </select>
        <button
          className="btn btn-ghost theme-toggle"
          onClick={() => setTheme((current) => (current === 'dark' ? 'light' : 'dark'))}
          aria-label={t(theme === 'dark' ? 'common.lightMode' : 'common.darkMode')}
          title={t(theme === 'dark' ? 'common.lightMode' : 'common.darkMode')}
        >
          <AppIcon name={theme === 'dark' ? 'sun' : 'moon'} />
        </button>
        <button className="btn btn-ghost" onClick={() => void logout()}>
          <AppIcon name="logout" />
          <span className="btn-label">{t('nav.logout')}</span>
        </button>
      </header>

      <aside
        className={`sidebar ${menuOpen ? 'open' : ''}`}
        id="app-sidebar"
        aria-label={t('nav.menu')}
      >
        <div className="sidebar-brand">
          <BrandMark size={38} />
          <div>
            <div className="brand-name">{t('suite.name')}</div>
            <div className="brand-tag">{t('suite.tagline')}</div>
          </div>
          <button
            type="button"
            className="icon-btn sidebar-close mobile-only"
            onClick={closeMenu}
            aria-label={t('common.close')}
          >
            <AppIcon name="close" size={20} />
          </button>
        </div>
        <div className="sidebar-title">{t('nav.menu')}</div>
        <nav className="nav" onClick={closeMenu}>
          {visibleGroups.map((group) => {
            const activeGroup = groupIsActive(group, location.pathname, location.search);
            const isOpen = openGroups.has(group.key);
            return (
              <div className={`nav-group ${activeGroup ? 'active-group' : ''}`} key={group.key}>
                <button
                  type="button"
                  className="nav-group-toggle"
                  aria-expanded={isOpen}
                  aria-controls={`nav-group-${group.key}`}
                  onClick={() => toggleGroup(group.key)}
                >
                  <span className="nav-group-icon"><AppIcon name={group.icon} size={16} /></span>
                  <span className="nav-label">{t(group.labelKey)}</span>
                  <span className={`nav-chevron ${isOpen ? 'open' : ''}`} aria-hidden="true">
                    <AppIcon name="chevron" size={15} />
                  </span>
                </button>
                {isOpen && (
                  <div className="nav-group-items" id={`nav-group-${group.key}`}>
                    {group.items.map((item) => (
                      <NavLink
                        key={`${item.to}-${item.key}`}
                        to={item.search ? `${item.to}?${new URLSearchParams(item.search).toString()}` : item.to}
                        end={item.end}
                        className={() =>
                          `nav-item ${isNavItemActive(item, location.pathname, location.search, group.items) ? 'active' : ''}`
                        }
                      >
                        <span className="nav-icon"><AppIcon name={item.icon} size={17} /></span>
                        <span className="nav-label">{t(item.key)}</span>
                        {item.prepared && <span className="pill">{t('module.prepared')}</span>}
                      </NavLink>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </nav>
        <div className="sidebar-foot">
          {t('app.version')} {APP_VERSION} · {t('app.commit')} {SHORT_COMMIT}
          <br />
          {user.email}
        </div>
      </aside>

      {menuOpen && <div className="drawer-backdrop" onClick={closeMenu} aria-hidden="true" />}

      <div className="main">
        <main className="page" key={location.pathname}>
          <Routes>
            <Route path="/" element={<Navigate to="/cabinet" replace />} />

            {/* Cabinet */}
            <Route path="/cabinet" element={<CabinetDashboardPage />} />
            <Route path="/cabinet/companies" element={<CompaniesPage />} />
            <Route path="/cabinet/companies/:companyId" element={<DossierPage />} />
            <Route path="/cabinet/companies/:companyId/settings" element={<CompanySettingsPage />} />
            <Route path="/cabinet/tasks" element={<TasksPage />} />
            <Route path="/cabinet/team" element={<TeamPage />} />
            <Route path="/cabinet/migration" element={<MigrationPage />} />
            <Route path="/cabinet/ai-assistant" element={<AiAssistantPage />} />
            <Route path="/cabinet/ai-proposals" element={<AiProposalsPage />} />
            <Route path="/cabinet/settings/ai" element={<AiSettingsPage />} />

            {/* Documents (mission 23): intake stays available for consultation,
                but the accounting journals are now the primary entry points. */}
            <Route path="/documents" element={<ScanImportPage />} />
            <Route path="/accounting/journals/purchases/import" element={<ScanImportPage mode="purchase" />} />
            <Route path="/accounting/journals/sales/import" element={<ScanImportPage mode="sale" />} />
            <Route path="/accounting/journals/purchases/import/bulk" element={<BulkImportPage mode="purchase" />} />
            <Route path="/accounting/banking/bulk-reconciliation" element={<BulkReconciliationPage />} />
            <Route path="/accounting/journals/sales/import/bulk" element={<BulkImportPage mode="sale" />} />

            {/* Accounting (existing V0.1 screens, unchanged behaviour) */}
            <Route path="/accounting" element={<DashboardPage />} />
            <Route path="/accounting/accounts" element={<AccountsPage />} />
            <Route path="/accounting/entries" element={<EntriesPage />} />
            <Route path="/accounting/journals" element={<EntriesPage titleKey="nav.journals.all" />} />
            <Route path="/accounting/journals/purchases" element={<EntriesPage journalType="purchases" titleKey="nav.journals.purchases" />} />
            <Route path="/accounting/journals/sales" element={<EntriesPage journalType="sales" titleKey="nav.journals.sales" />} />
            <Route path="/accounting/journals/bank" element={<EntriesPage journalType="bank" titleKey="nav.journals.bank" />} />
            <Route path="/accounting/journals/general" element={<EntriesPage journalType="general" titleKey="nav.journals.general" />} />
            <Route path="/accounting/ledger" element={<LedgerPage />} />
            <Route path="/accounting/trial-balance" element={<TrialBalancePage />} />
            <Route path="/accounting/statements" element={<StatementsPage />} />
            <Route path="/accounting/statements/balance-sheet" element={<StatementsPage view="balance-sheet" />} />
            <Route path="/accounting/statements/profit-loss" element={<StatementsPage view="profit-loss" />} />
            <Route path="/accounting/equity" element={<EquityPage />} />
            <Route path="/accounting/settings" element={<SettingsPage />} />
            <Route path="/accounting/settings/company" element={<CompanySettingsPage />} />
            <Route path="/accounting/settings/data" element={<DataManagementPage />} />

            {/* Banking is operational (mission 9); the other routes remain
                explicitly marked as prepared. */}
            <Route path="/accounting/purchases" element={<PurchasesPage />} />
            <Route path="/accounting/lettering" element={<LetteringPage />} />
            <Route path="/accounting/multi-currency" element={<MultiCurrencyPage />} />
            <Route path="/accounting/banking" element={<BankPage />} />
            <Route path="/accounting/banking/mcb" element={<BankMcbPage />} />
            <Route path="/accounting/banking/pdf" element={<BankMcbPage />} />
            <Route path="/accounting/assets" element={<FixedAssetsPage />} />
            <Route path="/accounting/financial-years" element={<FinancialYearsPage />} />
            <Route path="/accounting/inventory" element={<InventoryPage />} />
            <Route path="/accounting/accruals" element={<AccrualsPage />} />
            <Route path="/accounting/provisions" element={<ProvisionsPage />} />
            <Route path="/accounting/ifrs" element={<PreparedPage module="accounting" />} />

            {/* Facturation opérationnelle (mission 6) */}
            <Route path="/billing" element={<BillingOverviewPage />} />
            <Route path="/billing/customers" element={<BillingCustomersPage />} />
            <Route path="/billing/quotes" element={<BillingDocumentsPage kind="quote" />} />
            <Route path="/billing/invoices" element={<BillingDocumentsPage kind="invoice" />} />
            <Route path="/billing/credit-notes" element={<BillingDocumentsPage kind="credit_note" />} />
            <Route path="/billing/payments" element={<BillingPaymentsPage />} />
            <Route path="/billing/aging" element={<BillingAgingPage />} />

            {/* Mission 25 : écran informatif MRA e-Invoicing. Aucun appel API,
                aucune transmission, aucun secret — la facturation classique
                ci-dessus reste inchangée. */}
            <Route path="/billing/e-invoicing" element={<MraEInvoicingPage />} />
            <Route path="/billing/:section" element={<PreparedPage module="billing" />} />

            {/* Paie & RH : préparation vérifiable, moteur réglementaire bloqué. */}
            <Route path="/payroll" element={<PayrollPage />} />
            <Route path="/payroll/payslips/:payslipId" element={<PayslipViewPage />} />
            <Route path="/payroll/:section" element={<PayrollPage />} />

            {LEGACY_REDIRECTS.map((r) => (
              <Route key={r.from} path={r.from} element={<Navigate to={r.to} replace />} />
            ))}
            <Route path="*" element={<Navigate to="/cabinet" replace />} />
          </Routes>
        </main>
      </div>

      {/* Assistant IA universel : pastille flottante sur tous les écrans des
          quatre modules, montée hors des routes pour survivre à la navigation
          et ne jamais perdre une saisie en cours. */}
      <AssistantLauncher />
    </div>
  );
}
