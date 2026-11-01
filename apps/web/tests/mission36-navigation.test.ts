/**
 * Mission 36 — professional accounting navigation.
 *
 * These tests protect the discoverability gains: the professional groups, the
 * mandatory accounting vocabulary, direct links to existing screens and the
 * absence of invented destinations (cash-flow statement, cost centres).
 * Mission 38 folded the five journal entries into tabs of Journal Entries and
 * removed the duplicate Opening Balances sidebar shortcut.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { NAV_GROUPS, groupIsActive, isNavItemActive } from '../src/navigation';
import { GLOSSARY, type GlossaryKey } from '../src/glossary';
import { dictionaries } from '../src/i18n';

const fr = dictionaries.fr;
const en = dictionaries.en;

function item(key: string) {
  return NAV_GROUPS.flatMap((group) => group.items).find((entry) => entry.key === key);
}

/** Static route patterns declared in App.tsx, excluding the catch-all. */
function appRoutes(): string[] {
  const source = readFileSync(path.resolve('src/App.tsx'), 'utf8');
  return [...source.matchAll(/<Route\s+path="([^"]+)"/g)]
    .map((match) => match[1]!)
    .filter((route) => route !== '*');
}

function routeMatches(pattern: string, destination: string): boolean {
  const pathname = new URL(destination, 'https://comptai.invalid').pathname;
  const patternParts = pattern.split('/').filter(Boolean);
  const pathParts = pathname.split('/').filter(Boolean);
  return (
    patternParts.length === pathParts.length &&
    patternParts.every((part, index) => part.startsWith(':') || part === pathParts[index])
  );
}

describe('mission 36 — accountant navigation', () => {
  it('exposes the ten ordered professional groups', () => {
    expect(NAV_GROUPS.map((group) => group.key)).toEqual([
      'home',
      'clients',
      'accounting',
      'bank',
      'billing',
      'purchases',
      'assets',
      'payroll',
      'reports',
      'settings',
    ]);
    expect(NAV_GROUPS).toHaveLength(10);
  });

  it('keeps every group readable: ten destinations maximum', () => {
    for (const group of NAV_GROUPS) {
      expect(group.items.length, group.key).toBeGreaterThan(0);
      expect(group.items.length, group.key).toBeLessThanOrEqual(10);
    }
  });

  it('has a French and English label for every group and item', () => {
    for (const group of NAV_GROUPS) {
      expect(fr[group.labelKey], group.labelKey).toBeTruthy();
      expect(en[group.labelKey], group.labelKey).toBeTruthy();
      for (const entry of group.items) {
        expect(fr[entry.key], entry.key).toBeTruthy();
        expect(en[entry.key], entry.key).toBeTruthy();
      }
    }
  });

  it('follows the mandatory FR/EN accounting terminology', () => {
    const pairs: Record<string, [string, string]> = {
      'nav.group.home': ['Tableau de bord', 'Dashboard'],
      'nav.accounts': ['Plan comptable', 'Chart of Accounts'],
      'nav.ledger': ['Grand livre', 'General Ledger'],
      'nav.trialBalance': ['Balance générale', 'Trial Balance'],
      'nav.entries': ['Écritures comptables', 'Journal Entries'],
      'nav.journals.all': ['Tous les journaux', 'All Journals'],
      'nav.billing.customers': ['Clients', 'Customers'],
      'nav.purchases.suppliers': ['Fournisseurs', 'Suppliers'],
      'nav.billing.invoices': ['Factures clients', 'Sales Invoices'],
      'nav.purchases.invoices': ['Factures fournisseurs', 'Bills'],
      'nav.bank.reconciliation': ['Rapprochement bancaire', 'Bank Reconciliation'],
      'nav.reports.profitLoss': ['Compte de résultat', 'Profit & Loss'],
      'nav.reports.balanceSheet': ['Bilan', 'Balance Sheet'],
      'nav.accounting.assets': ['Immobilisations', 'Fixed Assets'],
      'nav.accounting.inventory': ['Stocks', 'Inventory'],
      'nav.statements': ['États financiers', 'Financial Statements'],
      'nav.accounting.yearEndClosing': ['Clôture annuelle', 'Year-End Closing'],
      'nav.settings.audit': ['Piste d’audit', 'Audit Trail'],
      'nav.settings.periods': ['Périodes comptables', 'Accounting Periods'],
      'nav.accounting.equity': ['Capitaux propres et résultats reportés', 'Equity & Retained Earnings'],
    };
    for (const [key, [french, english]] of Object.entries(pairs)) {
      expect(fr[key], key).toBe(french);
      expect(en[key], key).toBe(english);
    }
  });

  it('keeps all twenty-five mandatory pairs in the canonical glossary', () => {
    const required: GlossaryKey[] = [
      'dashboard',
      'chartOfAccounts',
      'generalLedger',
      'trialBalance',
      'journalEntries',
      'journals',
      'accountsReceivable',
      'accountsPayable',
      'customers',
      'suppliers',
      'salesInvoices',
      'bills',
      'bankReconciliation',
      'statementOfProfitOrLoss',
      'balanceSheet',
      'cashFlowStatement',
      'fixedAssets',
      'inventory',
      'financialStatements',
      'yearEndClosing',
      'auditTrail',
      'accountingPeriods',
      'costCentres',
      'openingBalances',
      'retainedEarnings',
    ];
    expect(required).toHaveLength(25);
    for (const key of required) {
      expect(GLOSSARY[key].fr, key).toBeTruthy();
      expect(GLOSSARY[key].en, key).toBeTruthy();
      expect(GLOSSARY[key].en, key).not.toBe(GLOSSARY[key].fr);
    }
  });

  it('points every destination at a route declared in App.tsx', () => {
    const routes = appRoutes();
    for (const entry of NAV_GROUPS.flatMap((group) => group.items)) {
      expect(
        routes.some((route) => routeMatches(route, entry.to)),
        `${entry.key} → ${entry.to}`,
      ).toBe(true);
    }
  });

  it('makes the accountant’s core screens reachable from the sidebar', () => {
    const required: [string, string][] = [
      ['nav.accounts', '/accounting/accounts'],
      ['nav.entries', '/accounting/entries'],
      ['nav.ledger', '/accounting/ledger'],
      ['nav.trialBalance', '/accounting/trial-balance'],
      ['nav.bank.reconciliation', '/accounting/banking'],
      ['nav.accounting.yearEndClosing', '/accounting/financial-years'],
      ['nav.reports.profitLoss', '/accounting/statements/profit-loss'],
      ['nav.reports.balanceSheet', '/accounting/statements/balance-sheet'],
      ['nav.settings.audit', '/accounting/settings'],
    ];
    for (const [key, destination] of required) {
      expect(item(key)?.to, key).toBe(destination);
    }
  });

  it('does not invent absent features in the sidebar', () => {
    const destinations = NAV_GROUPS.flatMap((group) => group.items.map((entry) => entry.to));
    for (const destination of destinations) {
      expect(destination).not.toMatch(/cash-?flow|flux|cost-?cent(er|re)s?/i);
    }
    expect(destinations).not.toContain('/accounting/ifrs');
  });

  it('activates one entry per query-string tab', () => {
    const financialYears = item('nav.accounting.financialYears')!;
    const closing = item('nav.accounting.yearEndClosing')!;
    expect(isNavItemActive(financialYears, '/accounting/financial-years', '')).toBe(true);
    expect(isNavItemActive(financialYears, '/accounting/financial-years', '?tab=opening', [financialYears, closing])).toBe(true);
    expect(isNavItemActive(financialYears, '/accounting/financial-years', '?tab=timeline', [financialYears, closing])).toBe(true);
    expect(isNavItemActive(closing, '/accounting/financial-years', '?tab=checklist')).toBe(true);
    expect(isNavItemActive(closing, '/accounting/financial-years', '?tab=opening')).toBe(false);

    const sales = item('nav.billing.dashboard')!;
    const bills = item('nav.purchases.invoices')!;
    expect(isNavItemActive(sales, '/billing', '')).toBe(true);
    expect(isNavItemActive(bills, '/accounting/purchases', '?tab=invoices')).toBe(true);
    expect(isNavItemActive(bills, '/accounting/purchases', '?tab=payments')).toBe(false);

    const settings = item('nav.settings')!;
    const audit = item('nav.settings.audit')!;
    expect(isNavItemActive(settings, '/accounting/settings', '')).toBe(true);
    expect(isNavItemActive(settings, '/accounting/settings', '?tab=audit', [settings, audit])).toBe(false);
    expect(isNavItemActive(settings, '/accounting/settings', '?tab=vat', [settings, audit])).toBe(true);
    expect(isNavItemActive(audit, '/accounting/settings', '?tab=audit')).toBe(true);
    expect(groupIsActive(NAV_GROUPS.find((group) => group.key === 'settings')!, '/accounting/settings', '?tab=audit')).toBe(true);
  });
});
