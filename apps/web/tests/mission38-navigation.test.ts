/**
 * Mission 38 — menu simplification and professional EN/FR terminology.
 *
 * The checks below protect the deliberate decisions, not a snapshot of the old
 * menu: journal types are tabs of one register, Opening Balances stays a tab,
 * Year-End Closing keeps a direct shortcut, and every removed route still has a
 * working replacement.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { NAV_GROUPS, isNavItemActive } from '../src/navigation';
import { LEGACY_REDIRECTS } from '../src/modules';
import { GLOSSARY } from '../src/glossary';
import { dictionaries } from '../src/i18n';

const fr = dictionaries.fr;
const en = dictionaries.en;
const items = NAV_GROUPS.flatMap((group) => group.items);

function destination(item: (typeof items)[number]): string {
  const query = item.search ? new URLSearchParams(item.search).toString() : '';
  return query ? `${item.to}?${query}` : item.to;
}

function item(key: string) {
  return items.find((entry) => entry.key === key);
}

function appSource(): string {
  return readFileSync(path.resolve('src/App.tsx'), 'utf8');
}

function entriesSource(): string {
  return readFileSync(path.resolve('src/pages/Entries.tsx'), 'utf8');
}

describe('mission 38 — navigation without duplicates', () => {
  it('keeps ten groups and removes the single-item Journals group', () => {
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
    // Mission 44 adds the Accountant Workspace entry "Create New Client" to the
    // clients group: 60 → 61 destinations, same ten groups, no duplicate route.
    expect(items).toHaveLength(61);
    expect(items.filter((entry) => entry.to === '/accounting/journals')).toEqual([]);
    expect(items.filter((entry) => entry.to === '/cabinet/clients/new')).toHaveLength(1);
  });

  it('has no two sidebar entries pointing at the exact same destination', () => {
    const destinations = items.map(destination);
    expect(new Set(destinations).size).toBe(destinations.length);
    expect(new Set(items.map((entry) => entry.key)).size).toBe(items.length);
  });

  it('allows several entries on one screen only through distinct tabs', () => {
    const groups = new Map<string, string[]>();
    for (const entry of items) {
      const list = groups.get(entry.to) ?? [];
      list.push(entry.search ? new URLSearchParams(entry.search).toString() : '');
      groups.set(entry.to, list);
    }
    for (const [route, queries] of groups) {
      if (queries.length === 1) continue;
      expect(new Set(queries).size, route).toBe(queries.length);
    }

    // Explicitly classified shared screens.
    expect(groups.get('/accounting/banking')).toHaveLength(4);
    expect(groups.get('/accounting/purchases')).toHaveLength(6);
    expect(groups.get('/accounting/financial-years')).toEqual(['', 'tab=checklist']);
    expect(groups.get('/accounting/settings')).toHaveLength(3);
  });

  it('keeps Journal Entries, journal tabs and the General Ledger distinct', () => {
    expect(item('nav.entries')?.to).toBe('/accounting/entries');
    expect(item('nav.ledger')?.to).toBe('/accounting/ledger');
    expect(item('nav.trialBalance')?.to).toBe('/accounting/trial-balance');
    expect(item('nav.journals.general')).toBeUndefined();

    const source = entriesSource();
    for (const key of [
      'nav.journals.all',
      'nav.journals.purchases',
      'nav.journals.sales',
      'nav.journals.bank',
      'nav.journals.general',
    ]) {
      expect(source, key).toContain(key);
    }
    expect(source).toContain("role=\"tablist\"");
    expect(item('nav.entries')?.to).not.toBe(item('nav.ledger')?.to);
  });

  it('keeps Year-End Closing reachable while Opening Balances is a tab', () => {
    const financialYears = item('nav.accounting.financialYears')!;
    const closing = item('nav.accounting.yearEndClosing')!;
    expect(item('nav.accounting.openingBalances')).toBeUndefined();
    expect(financialYears.to).toBe('/accounting/financial-years');
    expect(closing.search).toEqual({ tab: 'checklist' });
    expect(isNavItemActive(financialYears, '/accounting/financial-years', '?tab=opening')).toBe(true);
    expect(isNavItemActive(closing, '/accounting/financial-years', '?tab=checklist')).toBe(true);
    expect(isNavItemActive(financialYears, '/accounting/financial-years', '?tab=checklist', [financialYears, closing])).toBe(false);
  });
});

describe('mission 38 — professional English and functional French', () => {
  it('uses the required firm, client and accounting vocabulary', () => {
    const pairs: Record<string, [string, string]> = {
      'nav.cabinet.dossiers': ['Dossiers clients', 'Client Portfolios'],
      'nav.cabinet.team': ['Collaborateurs', 'Team Members'],
      'nav.entries': ['Écritures comptables', 'Journal Entries'],
      'nav.ledger': ['Grand livre', 'General Ledger'],
      'nav.trialBalance': ['Balance générale', 'Trial Balance'],
      'nav.journals.all': ['Tous les journaux', 'All Journals'],
      'nav.journals.purchases': ['Journal des achats', 'Purchase Journal'],
      'nav.journals.sales': ['Journal des ventes', 'Sales Journal'],
      'nav.journals.bank': ['Journal de banque', 'Bank Journal'],
      'nav.journals.general': ['Journal des opérations diverses', 'General Journal'],
      'nav.accounting.yearEndClosing': ['Clôture annuelle', 'Year-End Closing'],
      'nav.billing.customers': ['Clients', 'Customers'],
      'nav.purchases.suppliers': ['Fournisseurs', 'Suppliers'],
    };
    for (const [key, [french, english]] of Object.entries(pairs)) {
      expect(fr[key], `${key} (fr)`).toBe(french);
      expect(en[key], `${key} (en)`).toBe(english);
    }
    expect(GLOSSARY.bankReconciliation.en).toBe('Bank Reconciliation');
    expect(GLOSSARY.openingBalances.en).toBe('Opening Balances');
    expect(GLOSSARY.yearEndClosing.en).toBe('Year-End Closing');
    expect(GLOSSARY.accrualsAndPrepayments.en).toBe('Accruals & Prepayments');
  });

  it('never shows the forbidden English label or an untranslated dossier term', () => {
    expect(Object.values(en).some((value) => /client dossiers?/i.test(value))).toBe(false);
    expect(Object.values(en).some((value) => /\bdossiers?\b/i.test(value))).toBe(false);
    expect(Object.values(en).some((value) => /\bcollaborators?\b/i.test(value))).toBe(false);
    expect(Object.values(fr).some((value) => /client portfolios?/i.test(value))).toBe(false);
    expect(en['cabinet.companies.title']).toBe('Client Portfolios');
    expect(en['cabinet.dossier.title']).toBe('Company File');
    expect(en['cabinet.team.title']).toBe('Team Members');
  });

  it('keeps a complete FR/EN pair for every visible group and item and no dead group key', () => {
    for (const group of NAV_GROUPS) {
      expect(fr[group.labelKey], group.labelKey).toBeTruthy();
      expect(en[group.labelKey], group.labelKey).toBeTruthy();
    }
    for (const entry of items) {
      expect(fr[entry.key], entry.key).toBeTruthy();
      expect(en[entry.key], entry.key).toBeTruthy();
    }
    for (const dead of ['nav.group.journals', 'nav.group.advanced', 'nav.group.administration']) {
      expect(fr[dead], dead).toBeUndefined();
      expect(en[dead], dead).toBeUndefined();
    }
  });
});

describe('mission 38 — routes, bookmarks, permissions and the guided tour', () => {
  it('keeps every removed screen reachable and redirects old bookmarks', () => {
    const source = appSource();
    for (const route of [
      '/accounting/entries',
      '/accounting/journals/purchases',
      '/accounting/journals/sales',
      '/accounting/journals/bank',
      '/accounting/journals/general',
      '/accounting/financial-years',
      '/accounting/settings',
    ]) {
      expect(source, route).toContain(`path="${route}"`);
    }
    expect(source).toContain('JournalRegisterRedirect');

    const redirects = new Map(LEGACY_REDIRECTS.map((entry) => [entry.from, entry.to]));
    expect(redirects.get('/journals')).toBe('/accounting/entries');
    expect(redirects.get('/financial-years')).toBe('/accounting/financial-years');
    expect(redirects.get('/year-end-closing')).toBe('/accounting/financial-years?tab=checklist');
    expect(redirects.get('/companies')).toBe('/cabinet/companies');
    expect(redirects.get('/entries')).toBe('/accounting/entries');
  });

  it('keeps every sidebar destination gated by an existing module', () => {
    const allowed = new Set(['cabinet', 'documents', 'accounting', 'billing', 'payroll']);
    for (const entry of items) {
      expect(allowed.has(entry.module), `${entry.key} → ${entry.module}`).toBe(true);
    }
    expect(item('nav.entries')?.module).toBe('accounting');
    expect(item('nav.ledger')?.module).toBe('accounting');
    expect(item('nav.payroll.overview')?.module).toBe('payroll');
    expect(item('nav.cabinet.dossiers')?.module).toBe('cabinet');
  });

  it('keeps the fourteen guided destinations and the sixteen-step scenario', () => {
    const guided = readFileSync(path.resolve('src/pages/GuidedDemo.tsx'), 'utf8');
    const quickLinks = guided.slice(guided.indexOf('const QUICK_LINKS'), guided.indexOf('export default function GuidedDemoPage'));
    expect([...quickLinks.matchAll(/\n  \{ key: '/g)]).toHaveLength(14);
    expect([...guided.matchAll(/title: '\d+\./g)]).toHaveLength(32); // 16 steps × two locales
    expect(guided).toContain("to: '/accounting/financial-years?tab=checklist'");
  });
});
