import { useState } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useI18n } from './i18n';
import { useSession } from './store';
import LoginPage from './pages/Login';
import DashboardPage from './pages/Dashboard';
import CompaniesPage from './pages/Companies';
import AccountsPage from './pages/Accounts';
import EntriesPage from './pages/Entries';
import LedgerPage from './pages/Ledger';
import TrialBalancePage from './pages/TrialBalance';
import StatementsPage from './pages/Statements';
import SettingsPage from './pages/Settings';
import { Spinner } from './components/ui';

const NAV = [
  { to: '/', key: 'nav.dashboard', icon: '▦', end: true },
  { to: '/companies', key: 'nav.companies', icon: '⌂' },
  { to: '/accounts', key: 'nav.accounts', icon: '≡' },
  { to: '/entries', key: 'nav.entries', icon: '✎' },
  { to: '/ledger', key: 'nav.ledger', icon: '▤' },
  { to: '/trial-balance', key: 'nav.trialBalance', icon: '⊞' },
  { to: '/statements', key: 'nav.statements', icon: '▥' },
  { to: '/settings', key: 'nav.settings', icon: '⚙' },
];

export default function App() {
  const { t, locale, setLocale } = useI18n();
  const { user, initialized, companies, company, setCompany, logout } = useSession();
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();

  if (!initialized) {
    return <Spinner label={t('common.loading')} />;
  }

  if (!user) {
    return (
      <Routes>
        <Route path="*" element={<LoginPage />} />
      </Routes>
    );
  }

  const closeMenu = () => setMenuOpen(false);

  return (
    <div className="app-shell">
      <aside className={`sidebar ${menuOpen ? 'open' : ''}`}>
        <div className="brand">
          <div className="brand-mark">M</div>
          <div>
            <div className="brand-name">{t('app.name')}</div>
            <div className="brand-tag">{t('app.tagline')}</div>
          </div>
        </div>
        <nav className="nav" onClick={closeMenu}>
          {NAV.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end}>
              <span className="nav-icon" aria-hidden="true">
                {item.icon}
              </span>
              {t(item.key)}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-foot">
          {t('app.version')}
          <br />
          {user.email}
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <button
            className="btn btn-ghost mobile-only"
            onClick={() => setMenuOpen((v) => !v)}
            aria-label={t('nav.menu')}
          >
            ☰
          </button>
          <select
            aria-label={t('common.company')}
            value={company?.id ?? ''}
            onChange={(e) => setCompany(e.target.value)}
            disabled={companies.length === 0}
          >
            {companies.length === 0 && <option value="">{t('common.none')}</option>}
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <span className="grow" />
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

        <main className="page" key={location.pathname}>
          <Routes>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/companies" element={<CompaniesPage />} />
            <Route path="/accounts" element={<AccountsPage />} />
            <Route path="/entries" element={<EntriesPage />} />
            <Route path="/ledger" element={<LedgerPage />} />
            <Route path="/trial-balance" element={<TrialBalancePage />} />
            <Route path="/statements" element={<StatementsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}
