import { useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { useI18n } from './i18n';
import { useSession } from './store';
import LoginPage from './pages/Login';
import DashboardPage from './pages/Dashboard';
import AccountsPage from './pages/Accounts';
import EntriesPage from './pages/Entries';
import LedgerPage from './pages/Ledger';
import TrialBalancePage from './pages/TrialBalance';
import StatementsPage from './pages/Statements';
import SettingsPage from './pages/Settings';
import CompanySettingsPage from './pages/company/CompanySettings';
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
import BillingOverviewPage from './pages/billing/Overview';
import BillingCustomersPage from './pages/billing/Customers';
import BillingDocumentsPage from './pages/billing/Documents';
import BillingPaymentsPage from './pages/billing/Payments';
import BillingAgingPage from './pages/billing/Aging';
import PayrollPage from './pages/payroll/Payroll';
import { MODULES, LEGACY_REDIRECTS, moduleByPath, type ModuleKey } from './modules';
import { Spinner } from './components/ui';
import { DemoBanner } from './components/DemoBanner';
import { AssistantLauncher } from './components/AssistantLauncher';

const ACCESS_WEIGHT: Record<string, number> = { none: 0, read: 1, write: 2, admin: 3 };

export default function App() {
  const { t, locale, setLocale } = useI18n();
  const { user, initialized, companies, company, setCompany, logout } = useSession();
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  // Hooks must run before any early return: the drawer is closed on navigation
  // and with the Escape key.
  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
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
  const active = moduleByPath(location.pathname);
  const modules = (company as { modules?: Record<ModuleKey, string> } | null)?.modules;

  const moduleAllowed = (key: ModuleKey) =>
    key === 'cabinet' || !modules || ACCESS_WEIGHT[modules[key] ?? 'read']! > 0;

  return (
    <div className="app-shell">
      <header className="topbar">
        <button
          className="btn btn-ghost mobile-only"
          onClick={() => setMenuOpen((v) => !v)}
          aria-label={t('nav.menu')}
          aria-expanded={menuOpen}
        >
          ☰
        </button>
        <div className="brand-inline">
          <div className="brand-mark">M</div>
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
            void fetch('/api/auth/me', {
              method: 'PATCH',
              credentials: 'include',
              headers: { 'content-type': 'application/json', 'x-locale': next },
              body: JSON.stringify({ locale: next }),
            });
          }}
          style={{ maxWidth: 110 }}
        >
          <option value="fr">FR</option>
          <option value="en">EN</option>
        </select>
        <button className="btn btn-ghost" onClick={() => void logout()}>
          {t('nav.logout')}
        </button>
      </header>

      <nav className="module-tabs" aria-label={t('nav.modules')}>
        {MODULES.map((m) => {
          const allowed = moduleAllowed(m.key);
          return (
            <button
              key={m.key}
              type="button"
              className={`module-tab ${active.key === m.key ? 'active' : ''}`}
              onClick={() => {
                const first = m.items[0];
                if (allowed && first) navigate(first.to);
              }}
              disabled={!allowed}
              title={allowed ? t(m.labelKey) : t('module.locked')}
              aria-current={active.key === m.key ? 'page' : undefined}
            >
              <span aria-hidden="true">{m.icon}</span> {t(m.labelKey)}
            </button>
          );
        })}
      </nav>

      <aside className={`sidebar ${menuOpen ? 'open' : ''}`}>
        <div className="sidebar-title">{t(active.labelKey)}</div>
        <nav className="nav" onClick={closeMenu}>
          {active.items.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end}>
              <span className="nav-icon" aria-hidden="true">
                {item.icon}
              </span>
              <span className="nav-label">{t(item.key)}</span>
              {item.prepared && <span className="pill">{t('module.prepared')}</span>}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-foot">
          {t('app.version')}
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

            {/* Accounting (existing V0.1 screens, unchanged behaviour) */}
            <Route path="/accounting" element={<DashboardPage />} />
            <Route path="/accounting/accounts" element={<AccountsPage />} />
            <Route path="/accounting/entries" element={<EntriesPage />} />
            <Route path="/accounting/ledger" element={<LedgerPage />} />
            <Route path="/accounting/trial-balance" element={<TrialBalancePage />} />
            <Route path="/accounting/statements" element={<StatementsPage />} />
            <Route path="/accounting/settings" element={<SettingsPage />} />
            <Route path="/accounting/settings/company" element={<CompanySettingsPage />} />

            {/* Banking is operational (mission 9); the other routes remain
                explicitly marked as prepared. */}
            <Route path="/accounting/purchases" element={<PurchasesPage />} />
            <Route path="/accounting/lettering" element={<LetteringPage />} />
            <Route path="/accounting/multi-currency" element={<MultiCurrencyPage />} />
            <Route path="/accounting/banking" element={<BankPage />} />
            <Route path="/accounting/assets" element={<PreparedPage module="accounting" />} />
            <Route path="/accounting/ifrs" element={<PreparedPage module="accounting" />} />

            {/* Facturation opérationnelle (mission 6) */}
            <Route path="/billing" element={<BillingOverviewPage />} />
            <Route path="/billing/customers" element={<BillingCustomersPage />} />
            <Route path="/billing/quotes" element={<BillingDocumentsPage kind="quote" />} />
            <Route path="/billing/invoices" element={<BillingDocumentsPage kind="invoice" />} />
            <Route path="/billing/credit-notes" element={<BillingDocumentsPage kind="credit_note" />} />
            <Route path="/billing/payments" element={<BillingPaymentsPage />} />
            <Route path="/billing/aging" element={<BillingAgingPage />} />

            {/* E-invoicing MRA : annoncé, jamais activé. */}
            <Route path="/billing/e-invoicing" element={<PreparedPage module="billing" />} />
            <Route path="/billing/:section" element={<PreparedPage module="billing" />} />

            {/* Paie & RH : préparation vérifiable, moteur réglementaire bloqué. */}
            <Route path="/payroll" element={<PayrollPage />} />
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
