import { describe, expect, it } from 'vitest';
import { NAV_GROUPS, groupIsActive, isNavItemActive } from '../src/navigation';
import { dictionaries } from '../src/i18n';

/**
 * Mission 26 — the collapsible groups replace the five long module tabs.
 * Mission 38 removed the single-item Journals group: journal types are now
 * tabs of Journal Entries. Labels must exist in both languages, destinations
 * must stay on existing screens, and no unimplemented statement may appear.
 */
describe('cabinet navigation (mission 26)', () => {
  it('keeps the ordered groups introduced in mission 26, extended in mission 36', () => {
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

  it('has a French and English label for every group and item', () => {
    for (const group of NAV_GROUPS) {
      expect(dictionaries.fr[group.labelKey], group.labelKey).toBeTruthy();
      expect(dictionaries.en[group.labelKey], group.labelKey).toBeTruthy();
      for (const item of group.items) {
        expect(dictionaries.fr[item.key], item.key).toBeTruthy();
        expect(dictionaries.en[item.key], item.key).toBeTruthy();
      }
    }
  });

  it('keeps accounting, then banking, then billing and reports ordered', () => {
    const keys = NAV_GROUPS.map((group) => group.key);
    const accounting = keys.indexOf('accounting');
    const bank = keys.indexOf('bank');
    const billing = keys.indexOf('billing');
    const reports = keys.indexOf('reports');
    expect(bank).toBe(accounting + 1);
    expect(billing).toBeGreaterThan(bank);
    expect(reports).toBeGreaterThan(billing);
  });

  it('only points at implemented screens (no cash-flow statement)', () => {
    const destinations = NAV_GROUPS.flatMap((group) => group.items.map((item) => item.to));
    for (const destination of destinations) {
      expect(destination.startsWith('/'), destination).toBe(true);
    }
    expect(destinations.some((to) => /cash-?flow|flux/i.test(to))).toBe(false);
    expect(destinations).toContain('/accounting/entries');
    expect(destinations.filter((to) => to.startsWith('/accounting/journals'))).toEqual([]);
    expect(destinations).toContain('/accounting/financial-years');
    expect(destinations).toContain('/accounting/banking/pdf');
    expect(destinations).toContain('/accounting/statements/balance-sheet');
    expect(destinations).toContain('/accounting/statements/profit-loss');
    expect(destinations).not.toContain('/accounting/ifrs');
  });

  it('activates query-string tabs without highlighting every bank entry', () => {
    const importItem = NAV_GROUPS.find((group) => group.key === 'bank')!.items.find(
      (item) => item.key === 'nav.bank.import',
    )!;
    const reconciliation = NAV_GROUPS.find((group) => group.key === 'bank')!.items.find(
      (item) => item.key === 'nav.bank.reconciliation',
    )!;
    expect(isNavItemActive(importItem, '/accounting/banking', '?tab=import')).toBe(true);
    expect(isNavItemActive(importItem, '/accounting/banking', '?tab=transactions')).toBe(false);
    expect(isNavItemActive(reconciliation, '/accounting/banking', '?tab=transactions')).toBe(true);
    expect(groupIsActive(NAV_GROUPS.find((group) => group.key === 'bank')!, '/accounting/banking', '?tab=import')).toBe(true);
  });
});
