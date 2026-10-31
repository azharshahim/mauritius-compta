/**
 * Mauritius Business Suite - module registry.
 *
 * Four spaces share one company repository and one PostgreSQL database, but
 * each keeps its own business code, permissions and tables. This file only
 * drives navigation and labels: authorisation is always enforced by the API
 * (`requireModuleAccess`), never by hiding a tab.
 */
export type ModuleKey = 'cabinet' | 'accounting' | 'billing' | 'payroll';

export interface ModuleItem {
  to: string;
  key: string;
  icon: string;
  end?: boolean;
  /** Feature announced but not implemented: the page must say so explicitly. */
  prepared?: boolean;
}

export interface ModuleDefinition {
  key: ModuleKey;
  icon: string;
  labelKey: string;
  base: string;
  items: ModuleItem[];
}

export const MODULES: ModuleDefinition[] = [
  {
    key: 'cabinet',
    icon: '💼',
    labelKey: 'module.cabinet',
    base: '/cabinet',
    items: [
      { to: '/cabinet', key: 'nav.cabinet.dashboard', icon: '▦', end: true },
      { to: '/cabinet/companies', key: 'nav.cabinet.dossiers', icon: '🗂' },
      { to: '/cabinet/tasks', key: 'nav.cabinet.tasks', icon: '✓' },
      { to: '/cabinet/team', key: 'nav.cabinet.team', icon: '👥' },
    ],
  },
  {
    key: 'accounting',
    icon: '📒',
    labelKey: 'module.accounting',
    base: '/accounting',
    items: [
      { to: '/accounting', key: 'nav.dashboard', icon: '▦', end: true },
      { to: '/accounting/accounts', key: 'nav.accounts', icon: '≡' },
      { to: '/accounting/entries', key: 'nav.entries', icon: '✎' },
      { to: '/accounting/ledger', key: 'nav.ledger', icon: '▤' },
      { to: '/accounting/trial-balance', key: 'nav.trialBalance', icon: '⊞' },
      { to: '/accounting/statements', key: 'nav.statements', icon: '▥' },
      { to: '/accounting/settings', key: 'nav.settings', icon: '⚙' },
      { to: '/accounting/purchases', key: 'nav.accounting.purchases', icon: '🧾', prepared: true },
      { to: '/accounting/banking', key: 'nav.accounting.banking', icon: '🏦', prepared: true },
      { to: '/accounting/assets', key: 'nav.accounting.assets', icon: '🏢', prepared: true },
      { to: '/accounting/ifrs', key: 'nav.accounting.ifrs', icon: '📑', prepared: true },
    ],
  },
  {
    key: 'billing',
    icon: '🧾',
    labelKey: 'module.billing',
    base: '/billing',
    items: [
      { to: '/billing', key: 'nav.dashboard', icon: '▦', end: true },
      { to: '/billing/customers', key: 'nav.billing.customers', icon: '👤', prepared: true },
      { to: '/billing/quotes', key: 'nav.billing.quotes', icon: '📝', prepared: true },
      { to: '/billing/invoices', key: 'nav.billing.invoices', icon: '🧾', prepared: true },
      { to: '/billing/credit-notes', key: 'nav.billing.creditNotes', icon: '↩', prepared: true },
      { to: '/billing/payments', key: 'nav.billing.payments', icon: '💰', prepared: true },
      { to: '/billing/e-invoicing', key: 'nav.billing.eInvoicing', icon: '🔗', prepared: true },
    ],
  },
  {
    key: 'payroll',
    icon: '👥',
    labelKey: 'module.payroll',
    base: '/payroll',
    items: [
      { to: '/payroll', key: 'nav.dashboard', icon: '▦', end: true },
      { to: '/payroll/employees', key: 'nav.payroll.employees', icon: '👤', prepared: true },
      { to: '/payroll/contracts', key: 'nav.payroll.contracts', icon: '📄', prepared: true },
      { to: '/payroll/variables', key: 'nav.payroll.variables', icon: '∑', prepared: true },
      { to: '/payroll/payslips', key: 'nav.payroll.payslips', icon: '🧮', prepared: true },
      { to: '/payroll/leave', key: 'nav.payroll.leave', icon: '🗓', prepared: true },
      { to: '/payroll/declarations', key: 'nav.payroll.declarations', icon: '📤', prepared: true },
      { to: '/payroll/transfer', key: 'nav.payroll.transfer', icon: '➡', prepared: true },
    ],
  },
];

export function moduleByPath(pathname: string): ModuleDefinition {
  return (
    MODULES.find((m) => pathname === m.base || pathname.startsWith(`${m.base}/`)) ?? MODULES[0]!
  );
}

/** Legacy V0.1 routes kept alive so existing links and bookmarks keep working. */
export const LEGACY_REDIRECTS: { from: string; to: string }[] = [
  { from: '/companies', to: '/cabinet/companies' },
  { from: '/accounts', to: '/accounting/accounts' },
  { from: '/entries', to: '/accounting/entries' },
  { from: '/ledger', to: '/accounting/ledger' },
  { from: '/trial-balance', to: '/accounting/trial-balance' },
  { from: '/statements', to: '/accounting/statements' },
  { from: '/settings', to: '/accounting/settings' },
];
