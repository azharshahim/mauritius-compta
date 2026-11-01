/**
 * Mission 39 — responsive shell, Back/breadcrumb and Guided Demo return.
 *
 * The demo backend is the in-browser Mission 37 data set: `fetch` is stubbed
 * and asserted unused, so these tests cannot touch a real company. jsdom does
 * not lay out CSS; viewport classes and interaction states are asserted here,
 * while the actual widths/overflow checks require a real browser (documented in
 * docs/comptai-responsive-navigation-tests.md).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { HashRouter } from 'react-router-dom';
import App from '../src/App';
import { I18nProvider } from '../src/i18n';
import { SessionProvider } from '../src/store';
import { resetDemo } from '../src/demo';
import { clearGuidedTour, readGuidedTour } from '../src/guidedTour';
import { navLink } from './nav';

const defaultWidth = window.innerWidth;

function setWidth(width: number) {
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    writable: true,
    value: width,
  });
  fireEvent(window, new Event('resize'));
}

function renderApp(hash = '#/') {
  window.location.hash = hash;
  return render(
    <I18nProvider>
      <SessionProvider>
        <HashRouter>
          <App />
        </HashRouter>
      </SessionProvider>
    </I18nProvider>,
  );
}

async function login(locale: 'fr' | 'en' = 'en', hash = '#/') {
  localStorage.setItem('mc.locale', locale);
  renderApp(hash);
  fireEvent.click(await screen.findByRole('button', { name: /Se connecter|Sign in/i }));
  await waitFor(() => expect(document.querySelector('.page h1')).toBeTruthy());
}

function sidebar(): HTMLElement {
  return document.getElementById('app-sidebar') as HTMLElement;
}

describe('mission 39 — guided tour return', () => {
  const fetchSpy = vi.fn();

  beforeEach(() => {
    setWidth(1280);
    resetDemo();
    localStorage.clear();
    sessionStorage.clear();
    clearGuidedTour();
    fetchSpy.mockReset();
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    cleanup();
    setWidth(defaultWidth);
    vi.unstubAllGlobals();
    document.body.classList.remove('nav-open');
  });

  it('returns from Trial Balance to the exact Guided Demo step', async () => {
    await login('en');
    fireEvent.click(navLink(/^Guided Demo$/));
    await screen.findByRole('heading', { name: 'Guided Demo' });
    await waitFor(() => expect(document.querySelectorAll('.demo-step')).toHaveLength(16));

    const step14 = document.querySelectorAll<HTMLElement>('.demo-step')[13]!;
    const trialBalance = within(step14).getAllByRole('link', { name: /Trial Balance/i })[0]!;
    fireEvent.click(trialBalance);

    await screen.findByRole('heading', { name: /^Trial Balance$/ });
    expect(readGuidedTour()).toMatchObject({ active: true, step: 13 });
    expect(document.querySelector('.tour-progress')?.textContent).toContain('Step 14 of 16');
    expect(within(sidebar()).queryByRole('button', { name: /Back to Guided Demo/i })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Back to Guided Demo/i }));
    await waitFor(() => expect(window.location.hash).toBe('#/demo?step=14'));
    await screen.findByRole('heading', { name: 'Guided Demo' });
    const current = document.querySelector<HTMLElement>('.demo-step[aria-current="step"]');
    expect(current?.textContent).toContain('14. Trial balance');
    expect(readGuidedTour().active).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('moves to the next and previous step, then returns to the same position', async () => {
    await login('en');
    fireEvent.click(navLink(/^Guided Demo$/));
    await screen.findByRole('heading', { name: 'Guided Demo' });
    await waitFor(() => expect(document.querySelectorAll('.demo-step')).toHaveLength(16));

    const step14 = document.querySelectorAll<HTMLElement>('.demo-step')[13]!;
    fireEvent.click(within(step14).getAllByRole('link', { name: /Trial Balance/i })[0]!);
    await screen.findByRole('heading', { name: /^Trial Balance$/ });

    fireEvent.click(await screen.findByRole('button', { name: /Next Step/i }));
    await waitFor(() => expect(window.location.hash).toBe('#/accounting/statements/profit-loss'));
    await waitFor(() =>
      expect(document.querySelector('.tour-progress')?.textContent).toContain('Step 15 of 16'),
    );

    fireEvent.click(await screen.findByRole('button', { name: /Previous Step/i }));
    await waitFor(() => expect(window.location.hash).toBe('#/accounting/trial-balance'));
    await waitFor(() =>
      expect(document.querySelector('.tour-progress')?.textContent).toContain('Step 14 of 16'),
    );
    expect(readGuidedTour()).toMatchObject({ active: true, step: 13 });

    fireEvent.click(screen.getByRole('button', { name: /Back to Guided Demo/i }));
    await waitFor(() => expect(window.location.hash).toBe('#/demo?step=14'));
    const current = document.querySelector<HTMLElement>('.demo-step[aria-current="step"]');
    expect(current?.textContent).toContain('14. Trial balance');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('drops the tour controls when the reviewer leaves the destination another way', async () => {
    await login('en');
    fireEvent.click(navLink(/^Guided Demo$/));
    await screen.findByRole('heading', { name: 'Guided Demo' });
    await waitFor(() => expect(document.querySelectorAll('.demo-step')).toHaveLength(16));

    const step14 = document.querySelectorAll<HTMLElement>('.demo-step')[13]!;
    fireEvent.click(within(step14).getAllByRole('link', { name: /Trial Balance/i })[0]!);
    await screen.findByRole('heading', { name: /^Trial Balance$/ });
    expect(document.querySelector('.tour-nav')).toBeTruthy();

    window.location.hash = '#/accounting/accounts';
    await screen.findByRole('heading', { name: /^Chart of Accounts$/ });
    await waitFor(() => expect(document.querySelector('.tour-nav')).toBeNull());
    expect(readGuidedTour().active).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('mission 39 — Back, breadcrumb and browser history', () => {
  const fetchSpy = vi.fn();

  beforeEach(() => {
    setWidth(1280);
    resetDemo();
    localStorage.clear();
    sessionStorage.clear();
    fetchSpy.mockReset();
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    cleanup();
    setWidth(defaultWidth);
    vi.unstubAllGlobals();
    document.body.classList.remove('nav-open');
  });

  it('shows Accounting > Trial Balance and restores the previous in-app screen', async () => {
    await login('en');
    fireEvent.click(navLink(/^Trial Balance$/));
    await screen.findByRole('heading', { name: /^Trial Balance$/ });
    expect(document.querySelector('.breadcrumbs')?.textContent).toContain('Accounting');
    expect(document.querySelector('.breadcrumbs')?.textContent).toContain('Trial Balance');

    fireEvent.click(navLink(/^Balance Sheet$/));
    await screen.findByRole('heading', { name: /^Balance Sheet$/ });
    fireEvent.click(screen.getByRole('button', { name: /^Back$/ }));
    await waitFor(() => expect(window.location.hash).toBe('#/accounting/trial-balance'));
    await screen.findByRole('heading', { name: /^Trial Balance$/ });
  });

  it('keeps the invoice list context and returns to the billing module', async () => {
    await login('en', '#/billing/invoices');
    await screen.findByRole('heading', { name: /^Sales Invoices$/ });
    expect(document.querySelector('.breadcrumbs')?.textContent).toContain('Sales & Invoicing');
    expect(document.querySelector('.breadcrumbs')?.textContent).toContain('Sales Invoices');

    fireEvent.click(screen.getByRole('button', { name: /^Back$/ }));
    await waitFor(() => expect(window.location.hash).toBe('#/billing'));
  });

  it('turns the fixed-asset report tab into a history entry and returns to the register', async () => {
    await login('en');
    fireEvent.click(navLink(/^Fixed Assets$/));
    await screen.findByRole('heading', { name: /^Fixed assets and depreciation$/ });
    fireEvent.click(screen.getByRole('tab', { name: /^Reports$/ }));
    await waitFor(() => expect(window.location.hash).toContain('tab=reports'));

    fireEvent.click(screen.getByRole('button', { name: /^Back$/ }));
    await waitFor(() => expect(window.location.hash).toBe('#/accounting/assets'));
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: /^Register$/ }).getAttribute('aria-selected')).toBe('true'),
    );
  });

  it('preserves a tab/filter query when the in-app Back returns to the screen', async () => {
    await login('en');
    fireEvent.click(navLink(/^Bills$/));
    await waitFor(() => expect(window.location.hash).toBe('#/accounting/purchases?tab=invoices'));
    fireEvent.click(navLink(/^Sales Invoices$/));
    await screen.findByRole('heading', { name: /^Sales Invoices$/ });
    fireEvent.click(screen.getByRole('button', { name: /^Back$/ }));
    await waitFor(() => expect(window.location.hash).toBe('#/accounting/purchases?tab=invoices'));
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: /Bills|Factures/i }).getAttribute('aria-selected')).toBe('true'),
    );
  });

  it('uses the module parent on a direct URL instead of leaving COMPTAI', async () => {
    await login('en', '#/accounting/trial-balance');
    await screen.findByRole('heading', { name: /^Trial Balance$/ });
    fireEvent.click(screen.getByRole('button', { name: /^Back$/ }));
    await waitFor(() => expect(window.location.hash).toBe('#/accounting'));
  });

  it('leaves the browser Previous/Next buttons working normally', async () => {
    await login('en');
    fireEvent.click(navLink(/^Trial Balance$/));
    await screen.findByRole('heading', { name: /^Trial Balance$/ });
    fireEvent.click(navLink(/^General Ledger$/));
    await screen.findByRole('heading', { name: /^General Ledger$/ });

    window.history.back();
    await waitFor(() => expect(window.location.hash).toBe('#/accounting/trial-balance'));
    window.history.forward();
    await waitFor(() => expect(window.location.hash).toBe('#/accounting/ledger'));
  });
});

describe('mission 39 — responsive sidebar and phone navigation', () => {
  const fetchSpy = vi.fn();

  beforeEach(() => {
    resetDemo();
    localStorage.clear();
    sessionStorage.clear();
    fetchSpy.mockReset();
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    cleanup();
    setWidth(defaultWidth);
    vi.unstubAllGlobals();
    document.body.classList.remove('nav-open');
  });

  it('shows the mobile quick navigation, opens the full menu and moves above the assistant', async () => {
    setWidth(360);
    await login('en');
    const quick = document.querySelector('.mobile-quick-nav') as HTMLElement;
    expect(quick).toBeTruthy();
    expect(within(quick).getByRole('link', { name: 'Accounting' })).toBeTruthy();
    expect(within(quick).getByRole('link', { name: 'Banking' })).toBeTruthy();
    expect(document.querySelector('.assistant-fab')).toBeTruthy();
    expect(screen.getByLabelText('Company')).toBeTruthy();

    fireEvent.click(within(quick).getByRole('link', { name: 'Accounting' }));
    await waitFor(() => expect(window.location.hash).toBe('#/accounting'));
    fireEvent.click(within(quick).getByRole('link', { name: 'Banking' }));
    await waitFor(() => expect(window.location.hash).toBe('#/accounting/banking'));
    expect(sidebar().className).not.toContain('open');

    fireEvent.click(within(quick).getByRole('button', { name: 'Open menu' }));
    expect(sidebar().className).toContain('open');
    expect(document.body.classList.contains('nav-open')).toBe(true);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(sidebar().className).not.toContain('open');
    expect(document.body.classList.contains('nav-open')).toBe(false);

    fireEvent.click(within(quick).getByRole('link', { name: 'Demo' }));
    await waitFor(() => expect(window.location.hash).toBe('#/demo'));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('uses a compact rail on Windows and remembers a manual collapse across resizes', async () => {
    setWidth(1280);
    await login('en');
    const shell = document.querySelector('.app-shell') as HTMLElement;
    expect(shell.className).toContain('view-wide');
    expect(document.querySelector('.mobile-quick-nav')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
    expect(shell.className).toContain('nav-rail');
    expect(sidebar().className).toContain('collapsed');
    expect(localStorage.getItem('mc.nav.collapsed')).toBe('1');

    setWidth(1024);
    await waitFor(() => expect(shell.className).toContain('view-compact'));
    expect(sidebar().className).toContain('compact');
    expect(document.querySelector('.mobile-quick-nav')).toBeNull();

    setWidth(1920);
    await waitFor(() => expect(shell.className).toContain('view-wide'));
    expect(sidebar().className).toContain('collapsed');
    fireEvent.click(screen.getByRole('button', { name: 'Expand sidebar' }));
    expect(localStorage.getItem('mc.nav.collapsed')).toBe('0');
  });

  it('switches between phone, compact and wide layouts while resizing', async () => {
    setWidth(390);
    await login('en');
    const shell = document.querySelector('.app-shell') as HTMLElement;
    expect(shell.className).toContain('view-mobile');
    expect(document.querySelector('.mobile-quick-nav')).toBeTruthy();

    setWidth(768);
    await waitFor(() => expect(shell.className).toContain('view-mobile'));
    expect(document.querySelector('.mobile-quick-nav')).toBeTruthy();

    setWidth(1024);
    await waitFor(() => expect(shell.className).toContain('view-compact'));
    expect(document.querySelector('.mobile-quick-nav')).toBeNull();

    setWidth(1280);
    await waitFor(() => expect(shell.className).toContain('view-wide'));
    setWidth(1920);
    await waitFor(() => expect(shell.className).toContain('view-wide'));
  });

  it('opens the full menu from the compact rail and closes it with the close control', async () => {
    setWidth(1024);
    await login('en');
    expect(sidebar().className).toContain('compact');
    expect(sidebar().className).not.toContain('open');

    fireEvent.click(within(sidebar()).getByRole('button', { name: /^Accounting$/ }));
    expect(sidebar().className).toContain('open');
    fireEvent.click(within(sidebar()).getByRole('button', { name: /^Close$/ }));
    expect(sidebar().className).not.toContain('open');
  });
});

describe('mission 39 — language, dialogs and data safety', () => {
  const fetchSpy = vi.fn();

  beforeEach(() => {
    setWidth(1280);
    resetDemo();
    localStorage.clear();
    sessionStorage.clear();
    fetchSpy.mockReset();
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    cleanup();
    setWidth(defaultWidth);
    vi.unstubAllGlobals();
    document.body.classList.remove('nav-open');
  });

  it('translates Back, breadcrumbs and quick navigation without losing context', async () => {
    await login('en');
    fireEvent.click(navLink(/^Trial Balance$/));
    await screen.findByRole('heading', { name: /^Trial Balance$/ });
    expect(screen.getByRole('button', { name: /^Back$/ })).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Language'), { target: { value: 'fr' } });
    await waitFor(() => expect(screen.getByRole('button', { name: /^Retour$/ })).toBeTruthy());
    expect(document.querySelector('.breadcrumbs')?.textContent).toContain('Comptabilité');
    expect(document.querySelector('.breadcrumbs')?.textContent).toContain('Balance générale');
    expect(document.documentElement.lang).toBe('fr');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('closes dialogs with Escape, restores focus and protects unsaved edits', async () => {
    await login('en');
    fireEvent.click(navLink(/^Chart of Accounts$/));
    await screen.findByRole('heading', { name: /^Chart of Accounts$/ });
    const trigger = screen.getByRole('button', { name: /New account/i });
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = await screen.findByRole('dialog');
    expect(dialog.contains(document.activeElement)).toBe(true);

    const firstField = dialog.querySelector('input') as HTMLInputElement;
    fireEvent.change(firstField, { target: { value: 'Test account' } });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.getByRole('dialog')).toBeTruthy();
    confirm.mockReturnValue(true);
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(trigger);
    confirm.mockRestore();
  });

  it('keeps the selected company and never calls a real backend in the demo', async () => {
    await login('en');
    const company = screen.getByLabelText('Company') as HTMLSelectElement;
    const selected = company.value;
    fireEvent.click(navLink(/^Bank Reconciliation$/));
    await waitFor(() => expect(window.location.hash).toBe('#/accounting/banking?tab=transactions'));
    expect((screen.getByLabelText('Company') as HTMLSelectElement).value).toBe(selected);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
