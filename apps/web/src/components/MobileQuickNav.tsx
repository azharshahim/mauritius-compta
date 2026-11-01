import { NavLink, useLocation } from 'react-router-dom';
import { AppIcon } from './AppIcon';
import { useI18n } from '../i18n';
import { demoEnabled } from '../demo/mode';

/**
 * Mission 39 — persistent phone navigation.
 *
 * Four destinations are always one tap away (Dashboard, Accounting, Banking,
 * Menu); Guided Demo is added only in the demonstration bundle. The component
 * is rendered below 900 px only, so it never steals desktop space. The AI
 * launcher is moved above it by CSS instead of being hidden.
 */
export function MobileQuickNav({
  canAccounting,
  canBanking,
  onOpenMenu,
}: {
  canAccounting: boolean;
  canBanking: boolean;
  onOpenMenu: () => void;
}) {
  const { t } = useI18n();
  const { pathname } = useLocation();
  const bankingActive = pathname.startsWith('/accounting/banking');
  const accountingActive = pathname.startsWith('/accounting') && !bankingActive;
  const dashboardActive = pathname === '/cabinet' || pathname === '/';

  return (
    <nav className="mobile-quick-nav" aria-label={t('nav.quickNav')}>
      <NavLink
        to="/cabinet"
        className={`quick-link ${dashboardActive ? 'active' : ''}`}
        aria-current={dashboardActive ? 'page' : undefined}
        aria-label={t('nav.group.home')}
        title={t('nav.group.home')}
      >
        <AppIcon name="dashboard" size={19} />
        <span>{t('nav.group.home')}</span>
      </NavLink>
      {canAccounting && (
        <NavLink
          to="/accounting"
          className={`quick-link ${accountingActive ? 'active' : ''}`}
          aria-current={accountingActive ? 'page' : undefined}
          aria-label={t('nav.group.accounting')}
          title={t('nav.group.accounting')}
        >
          <AppIcon name="accounting" size={19} />
          <span>{t('nav.group.accounting')}</span>
        </NavLink>
      )}
      {canBanking && (
        <NavLink
          to="/accounting/banking"
          className={`quick-link ${bankingActive ? 'active' : ''}`}
          aria-current={bankingActive ? 'page' : undefined}
          aria-label={t('nav.group.bank')}
          title={t('nav.group.bank')}
        >
          <AppIcon name="bank" size={19} />
          <span>{t('nav.group.bank')}</span>
        </NavLink>
      )}
      {demoEnabled && (
        <NavLink
          to="/demo"
          className={`quick-link ${pathname === '/demo' ? 'active' : ''}`}
          aria-current={pathname === '/demo' ? 'page' : undefined}
          aria-label={t('nav.quick.demo')}
          title={t('nav.quick.demo')}
        >
          <AppIcon name="validate" size={19} />
          <span>{t('nav.quick.demo')}</span>
        </NavLink>
      )}
      <button type="button" className="quick-link quick-menu" onClick={onOpenMenu} aria-label={t('nav.openMenu')} title={t('nav.openMenu')}>
        <AppIcon name="menu" size={19} />
        <span>{t('nav.menu')}</span>
      </button>
    </nav>
  );
}
