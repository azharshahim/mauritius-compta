import type { ModuleKey } from './modules';
import type { IconName } from './components/AppIcon';

/**
 * Mission 26 — cabinet-oriented navigation.
 *
 * Eight collapsible groups keep the mobile drawer short. Every destination is
 * an existing screen: no menu entry is invented to fill a group. The legacy
 * module registry in `modules.ts` is still used by the prepared-feature screen.
 */
export interface NavItem {
  to: string;
  key: string;
  icon: IconName;
  /** Module whose access level gates the entry (authorisation stays server-side). */
  module: ModuleKey;
  /** Only match the exact path (used for parent screens). */
  end?: boolean;
  /** Match a specific query string, e.g. a bank tab. */
  search?: Record<string, string>;
  /** Announced but explicitly not implemented. */
  prepared?: boolean;
}

export interface NavGroup {
  key: string;
  labelKey: string;
  icon: IconName;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    key: 'home',
    labelKey: 'nav.group.home',
    icon: 'dashboard',
    items: [
      { to: '/cabinet', key: 'nav.cabinet.dashboard', icon: 'dashboard', module: 'cabinet', end: true },
      { to: '/cabinet/companies', key: 'nav.cabinet.dossiers', icon: 'cabinet', module: 'cabinet' },
      { to: '/cabinet/tasks', key: 'nav.cabinet.tasks', icon: 'tasks', module: 'cabinet' },
    ],
  },
  {
    key: 'accounting',
    labelKey: 'nav.group.accounting',
    icon: 'accounting',
    items: [
      { to: '/accounting', key: 'nav.accounting.dashboard', icon: 'dashboard', module: 'accounting', end: true },
      { to: '/accounting/journals', key: 'nav.journals.all', icon: 'journals', module: 'accounting', end: true },
      { to: '/accounting/journals/purchases', key: 'nav.journals.purchases', icon: 'purchases', module: 'accounting' },
      { to: '/accounting/journals/sales', key: 'nav.journals.sales', icon: 'sales', module: 'accounting' },
      { to: '/accounting/journals/bank', key: 'nav.journals.bank', icon: 'bank', module: 'accounting' },
      { to: '/accounting/journals/general', key: 'nav.journals.general', icon: 'ledger', module: 'accounting' },
      { to: '/accounting/accounts', key: 'nav.accounts', icon: 'accounts', module: 'accounting' },
      { to: '/accounting/ledger', key: 'nav.ledger', icon: 'ledger', module: 'accounting' },
      { to: '/accounting/trial-balance', key: 'nav.trialBalance', icon: 'trial', module: 'accounting' },
      { to: '/accounting/lettering', key: 'nav.accounting.lettering', icon: 'lettering', module: 'accounting' },
      { to: '/documents', key: 'nav.documents.archives', icon: 'documents', module: 'documents', end: true },
    ],
  },
  {
    key: 'billing',
    labelKey: 'nav.group.billing',
    icon: 'sales',
    items: [
      { to: '/billing', key: 'nav.billing.dashboard', icon: 'dashboard', module: 'billing', end: true },
      { to: '/billing/customers', key: 'nav.billing.customers', icon: 'customers', module: 'billing' },
      { to: '/accounting/purchases', key: 'nav.billing.suppliers', icon: 'suppliers', module: 'accounting', search: { tab: 'suppliers' } },
      { to: '/billing/quotes', key: 'nav.billing.quotes', icon: 'quotes', module: 'billing' },
      { to: '/billing/invoices', key: 'nav.billing.invoicesClients', icon: 'invoices', module: 'billing' },
      { to: '/billing/credit-notes', key: 'nav.billing.creditNotes', icon: 'creditNotes', module: 'billing' },
      { to: '/billing/payments', key: 'nav.billing.payments', icon: 'payments', module: 'billing' },
      { to: '/billing/aging', key: 'nav.billing.aging', icon: 'aging', module: 'billing' },
      {
        to: '/billing/e-invoicing',
        key: 'nav.billing.eInvoicing',
        icon: 'eInvoicing',
        module: 'billing',
        prepared: true,
      },
    ],
  },
  {
    key: 'payroll',
    labelKey: 'nav.group.payroll',
    icon: 'payroll',
    items: [
      { to: '/payroll', key: 'nav.payroll.overview', icon: 'gauge', module: 'payroll', end: true },
      { to: '/payroll/employees', key: 'nav.payroll.employees', icon: 'payroll', module: 'payroll' },
      { to: '/payroll/contracts', key: 'nav.payroll.contracts', icon: 'contracts', module: 'payroll' },
      { to: '/payroll/payslips', key: 'nav.payroll.payslips', icon: 'documents', module: 'payroll' },
      { to: '/payroll/declarations', key: 'nav.payroll.declarations', icon: 'declarations', module: 'payroll', prepared: true },
      { to: '/payroll/transfer', key: 'nav.payroll.transfer', icon: 'transfer', module: 'payroll' },
      { to: '/payroll/leave', key: 'nav.payroll.leave', icon: 'leave', module: 'payroll' },
      { to: '/payroll/periods', key: 'nav.payroll.periods', icon: 'periods', module: 'payroll' },
    ],
  },
  {
    key: 'advanced',
    labelKey: 'nav.group.advanced',
    icon: 'settings2',
    items: [
      { to: '/accounting/assets', key: 'nav.accounting.assets', icon: 'assets', module: 'accounting' },
      { to: '/accounting/inventory', key: 'nav.accounting.inventory', icon: 'inventory', module: 'accounting' },
      { to: '/accounting/accruals', key: 'nav.accounting.accruals', icon: 'accruals', module: 'accounting' },
      { to: '/accounting/provisions', key: 'nav.accounting.provisions', icon: 'provisions', module: 'accounting' },
      { to: '/accounting/multi-currency', key: 'nav.accounting.multiCurrency', icon: 'currency', module: 'accounting' },
      { to: '/accounting/equity', key: 'nav.accounting.equity', icon: 'equity', module: 'accounting' },
      { to: '/accounting/financial-years', key: 'nav.accounting.financialYears', icon: 'fiscalYears', module: 'accounting' },
    ],
  },
  {
    key: 'bank',
    labelKey: 'nav.group.bank',
    icon: 'bank',
    items: [
      { to: '/accounting/banking', key: 'nav.bank.accounts', icon: 'bank', module: 'accounting', end: true },
      {
        to: '/accounting/banking',
        key: 'nav.bank.import',
        icon: 'import',
        module: 'accounting',
        search: { tab: 'import' },
      },
      {
        to: '/accounting/banking',
        key: 'nav.bank.reconciliation',
        icon: 'reconciliation',
        module: 'accounting',
        search: { tab: 'transactions' },
      },
      {
        to: '/accounting/banking/bulk-reconciliation',
        key: 'nav.bank.bulkReconciliation',
        icon: 'reconciliation',
        module: 'accounting',
      },
      {
        to: '/accounting/banking',
        key: 'nav.bank.operations',
        icon: 'settings',
        module: 'accounting',
        search: { tab: 'rules' },
      },
      { to: '/accounting/banking/pdf', key: 'nav.bank.pdf', icon: 'documents', module: 'accounting' },
    ],
  },
  {
    key: 'reports',
    labelKey: 'nav.group.reports',
    icon: 'statements',
    items: [
      { to: '/accounting/statements/balance-sheet', key: 'nav.reports.balanceSheet', icon: 'balanceSheet', module: 'accounting' },
      { to: '/accounting/statements/profit-loss', key: 'nav.reports.profitLoss', icon: 'profitLoss', module: 'accounting' },
      { to: '/accounting/statements', key: 'nav.reports.other', icon: 'reports', module: 'accounting', end: true },
    ],
  },
  {
    key: 'administration',
    labelKey: 'nav.group.administration',
    icon: 'settings',
    items: [
      { to: '/cabinet/team', key: 'nav.cabinet.team', icon: 'customers', module: 'cabinet' },
      { to: '/cabinet/ai-assistant', key: 'nav.cabinet.ai', icon: 'assistant', module: 'cabinet' },
      { to: '/cabinet/ai-proposals', key: 'nav.cabinet.aiProposals', icon: 'ai', module: 'cabinet' },
      { to: '/cabinet/settings/ai', key: 'nav.cabinet.aiSettings', icon: 'settings', module: 'cabinet' },
      { to: '/cabinet/migration', key: 'nav.cabinet.migration', icon: 'import', module: 'cabinet' },
      { to: '/accounting/settings', key: 'nav.settings', icon: 'settings', module: 'accounting' },
    ],
  },
];

function searchMatches(current: URLSearchParams, wanted?: Record<string, string>): boolean {
  if (!wanted) return true;
  return Object.entries(wanted).every(([key, value]) => current.get(key) === value);
}

/**
 * Active state that also understands tabs carried by the query string. React
 * Router's `NavLink` ignores `?tab=…`, which would otherwise highlight four
 * bank entries at once.
 */
export function isNavItemActive(
  item: Pick<NavItem, 'to' | 'end' | 'search'>,
  pathname: string,
  search: string,
): boolean {
  const current = new URLSearchParams(search);
  if (item.search) {
    return pathname === item.to && searchMatches(current, item.search);
  }
  if (item.end) {
    // A query-less parent screen is only active when no tab narrows another entry.
    return pathname === item.to && ![...current.keys()].some((key) => key === 'tab');
  }
  return pathname === item.to || pathname.startsWith(`${item.to}/`);
}

export function groupIsActive(group: NavGroup, pathname: string, search: string): boolean {
  return group.items.some((item) => isNavItemActive(item, pathname, search));
}
