/**
 * Mission 39 — global route context and Guided Demo progress.
 *
 * These are contract tests, not snapshots: every checked route must resolve to
 * an existing module, a valid parent and a breadcrumb that keeps the module
 * context. The Guided Demo marker is clamped and survives a page reload.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { resolveContextualNavigation, groupRoot } from '../src/contextualNavigation';
import { classifyViewport } from '../src/responsive';
import {
  GUIDED_TOUR_LINKS,
  GUIDED_TOUR_STEPS,
  clearGuidedTour,
  guidedTourDemoPath,
  guidedTourStepFromQuery,
  guidedTourStepPath,
  readGuidedTour,
  setGuidedTourStep,
  startGuidedTour,
} from '../src/guidedTour';

describe('mission 39 — contextual navigation', () => {
  it('labels the principal accounting screens with their module', () => {
    const tb = resolveContextualNavigation('/accounting/trial-balance', '');
    expect(tb.groupKey).toBe('accounting');
    expect(tb.crumbs.map((crumb) => crumb.labelKey)).toEqual(['nav.group.accounting', 'nav.trialBalance']);
    expect(tb.crumbs[0]?.to).toBe('/accounting');
    expect(tb.showBack).toBe(true);

    const entries = resolveContextualNavigation('/accounting/entries', '');
    expect(entries.crumbs.map((crumb) => crumb.labelKey)).toEqual(['nav.group.accounting', 'nav.entries']);
    expect(entries.fallbackPath).toBe('/accounting');
  });

  it('keeps Banking, Sales, Purchases, Assets, Payroll and Settings contexts distinct', () => {
    const cases: [string, string, string[]][] = [
      ['/accounting/banking', '', ['nav.group.bank', 'nav.bank.accounts']],
      ['/accounting/banking', '?tab=transactions', ['nav.group.bank', 'nav.bank.reconciliation']],
      ['/billing/invoices', '', ['nav.group.billing', 'nav.billing.invoices']],
      ['/accounting/purchases', '?tab=invoices', ['nav.group.purchases', 'nav.purchases.invoices']],
      ['/accounting/assets', '?tab=reports', ['nav.group.assets', 'nav.accounting.assets', 'fa.tab.reports']],
      ['/payroll', '', ['nav.group.payroll', 'nav.context.dashboard']],
      ['/accounting/settings', '?tab=periods', ['nav.group.settings', 'nav.settings.periods']],
      ['/accounting/financial-years', '?tab=checklist', ['nav.group.accounting', 'nav.accounting.yearEndClosing']],
    ];
    for (const [pathname, search, labels] of cases) {
      const context = resolveContextualNavigation(pathname, search);
      expect(context.crumbs.map((crumb) => crumb.labelKey), `${pathname}${search}`).toEqual(labels);
    }

    const assetReport = resolveContextualNavigation('/accounting/assets', '?tab=reports');
    expect(assetReport.parentPath).toBe('/accounting/assets');
    expect(assetReport.fallbackPath).toBe('/accounting/assets');
    expect(assetReport.showBack).toBe(true);
  });

  it('builds a real parent chain for imports, company files and payslip details', () => {
    const purchaseImport = resolveContextualNavigation('/accounting/journals/purchases/import', '');
    expect(purchaseImport.crumbs.map((crumb) => crumb.labelKey)).toEqual([
      'nav.group.accounting',
      'nav.journals.purchases',
      'nav.context.purchaseImport',
    ]);
    expect(purchaseImport.parentPath).toBe('/accounting/journals/purchases');
    expect(purchaseImport.fallbackPath).toBe('/accounting/journals/purchases');

    const company = resolveContextualNavigation('/cabinet/companies/company-1', '');
    expect(company.crumbs.map((crumb) => crumb.labelKey)).toEqual([
      'nav.group.clients',
      'nav.context.companyFile',
    ]);
    expect(company.parentPath).toBe('/cabinet/companies');

    const settings = resolveContextualNavigation('/cabinet/companies/company-1/settings', '');
    expect(settings.crumbs.map((crumb) => crumb.labelKey)).toEqual([
      'nav.group.clients',
      'nav.context.companyFile',
      'nav.context.companySettings',
    ]);
    expect(settings.parentPath).toBe('/cabinet/companies/company-1');

    const payslip = resolveContextualNavigation('/payroll/payslips/payslip-1', '');
    expect(payslip.crumbs.map((crumb) => crumb.labelKey)).toEqual([
      'nav.group.payroll',
      'nav.payroll.payslips',
      'nav.context.payslip',
    ]);
    expect(payslip.parentPath).toBe('/payroll/payslips');
  });

  it('has a valid fallback for every module and never returns the current page', () => {
    const paths = [
      '/cabinet',
      '/accounting',
      '/accounting/trial-balance',
      '/accounting/assets',
      '/accounting/banking',
      '/billing/invoices',
      '/accounting/purchases',
      '/payroll',
      '/accounting/settings',
      '/accounting/statements',
    ];
    for (const pathname of paths) {
      const context = resolveContextualNavigation(pathname, '');
      if (context.showBack) expect(context.fallbackPath, pathname).not.toBe(pathname);
      expect(context.fallbackPath.startsWith('/'), pathname).toBe(true);
      expect(context.crumbs.length, pathname).toBeGreaterThan(0);
    }
    expect(resolveContextualNavigation('/cabinet').showBack).toBe(false);
    expect(resolveContextualNavigation('/accounting').showBack).toBe(false);
    expect(resolveContextualNavigation('/demo').showBack).toBe(false);
    expect(groupRoot('bank')).toBe('/accounting/banking');
  });

  it('falls back to a prepared-screen context for announced routes', () => {
    const prepared = resolveContextualNavigation('/billing/suppliers', '');
    expect(prepared.groupKey).toBe('billing');
    expect(prepared.currentLabelKey).toBe('nav.context.prepared');
    expect(prepared.fallbackPath).toBe('/billing');
  });
});

describe('mission 39 — responsive breakpoints', () => {
  it('uses 900/1280 px thresholds for phone, compact rail and full sidebar', () => {
    expect(classifyViewport(360)).toBe('mobile');
    expect(classifyViewport(390)).toBe('mobile');
    expect(classifyViewport(768)).toBe('mobile');
    expect(classifyViewport(900)).toBe('mobile');
    expect(classifyViewport(901)).toBe('compact');
    expect(classifyViewport(1024)).toBe('compact');
    expect(classifyViewport(1279)).toBe('compact');
    expect(classifyViewport(1280)).toBe('wide');
    expect(classifyViewport(1920)).toBe('wide');
  });
});

describe('mission 39 — Guided Demo progress', () => {
  beforeEach(() => {
    localStorage.clear();
    clearGuidedTour();
  });

  it('keeps sixteen destinations aligned with the existing sixteen steps', () => {
    expect(GUIDED_TOUR_STEPS).toBe(16);
    expect(GUIDED_TOUR_LINKS).toHaveLength(16);
    expect(GUIDED_TOUR_LINKS[13]).toBe('/accounting/trial-balance');
    expect(guidedTourStepPath(13)).toBe('/accounting/trial-balance');
    expect(guidedTourDemoPath(13)).toBe('/demo?step=14');
  });

  it('stores, clamps and restores the current step without a second router', () => {
    expect(readGuidedTour()).toEqual({ active: false, step: 0, updatedAt: 0 });
    startGuidedTour(13);
    expect(readGuidedTour().active).toBe(true);
    expect(readGuidedTour().step).toBe(13);
    setGuidedTourStep(99);
    expect(readGuidedTour().step).toBe(15);
    setGuidedTourStep(-4);
    expect(readGuidedTour().step).toBe(0);
    expect(guidedTourStepFromQuery('14')).toBe(13);
    expect(guidedTourStepFromQuery('not-a-number')).toBe(0);
    expect(guidedTourStepFromQuery(null, 7)).toBe(7);
    clearGuidedTour();
    expect(readGuidedTour().active).toBe(false);
  });
});
