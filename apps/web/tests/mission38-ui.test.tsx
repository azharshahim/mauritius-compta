/**
 * Mission 38 — journal tabs, legacy bookmarks, mobile drawer and the guided tour.
 *
 * These tests use the fictional in-browser demo only: `fetch` stays stubbed and
 * is asserted unused, exactly like the mission 36 journeys.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { HashRouter } from 'react-router-dom';
import App from '../src/App';
import { I18nProvider } from '../src/i18n';
import { SessionProvider } from '../src/store';
import { resetDemo } from '../src/demo';
import { navLink } from './nav';

function renderApp() {
  window.location.hash = '#/';
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

async function login(locale: 'fr' | 'en' = 'fr') {
  localStorage.setItem('mc.locale', locale);
  renderApp();
  fireEvent.click(await screen.findByRole('button', { name: /Se connecter|Sign in/i }));
  await screen.findByRole('heading', { name: /Tableau de bord Cabinet|Cabinet Dashboard/i });
}

describe('mission 38 — journal register and legacies', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    resetDemo();
    localStorage.clear();
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('shows five journal tabs inside Journal Entries and navigates between them', async () => {
    await login('fr');
    fireEvent.click(navLink(/^Écritures comptables$/));
    await screen.findByRole('heading', { name: /^Écritures comptables$/ });

    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(5);
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      'Tous les journaux',
      'Journal des achats',
      'Journal des ventes',
      'Journal de banque',
      'Journal des opérations diverses',
    ]);
    expect(screen.getByRole('tab', { name: /^Tous les journaux$/ }).getAttribute('aria-selected')).toBe('true');

    fireEvent.click(screen.getByRole('tab', { name: /^Journal des achats$/ }));
    await screen.findByRole('heading', { name: /^Journal des achats$/ });
    expect(window.location.hash).toBe('#/accounting/journals/purchases');
    expect(screen.getByRole('tab', { name: /^Journal des achats$/ }).getAttribute('aria-selected')).toBe('true');

    fireEvent.click(screen.getByRole('tab', { name: /^Journal de banque$/ }));
    await screen.findByRole('heading', { name: /^Journal de banque$/ });
    expect(window.location.hash).toBe('#/accounting/journals/bank');

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('redirects the old All Journals bookmark to the register without losing its query', async () => {
    await login('fr');
    window.location.hash = '#/accounting/journals?search=FAC';
    await waitFor(() => expect(window.location.hash).toBe('#/accounting/entries?search=FAC'));
    await screen.findByRole('heading', { name: /^Écritures comptables$/ });
    expect(screen.getByRole('tab', { name: /^Tous les journaux$/ }).getAttribute('aria-selected')).toBe('true');
  });

  it('resolves the pre-mission-38 bookmarks to the right existing screens', async () => {
    await login('fr');

    window.location.hash = '#/journals';
    await waitFor(() => expect(window.location.hash).toBe('#/accounting/entries'));
    await screen.findByRole('heading', { name: /^Écritures comptables$/ });

    window.location.hash = '#/year-end-closing';
    await waitFor(() => expect(window.location.hash).toBe('#/accounting/financial-years?tab=checklist'));
    await screen.findByRole('heading', { name: /Exercices & archives/ });
    expect(screen.getByRole('tab', { name: /Contrôles de clôture/ }).getAttribute('aria-selected')).toBe('true');
  });

  it('keeps the mobile drawer and the ten collapsible groups usable', async () => {
    await login('fr');
    expect(document.querySelectorAll('.nav-group-toggle')).toHaveLength(10);

    const menu = screen.getByRole('button', { name: /Menu/ });
    fireEvent.click(menu);
    const drawer = document.querySelector('.sidebar') as HTMLElement;
    expect(drawer.className).toContain('open');

    const accounting = within(drawer).getByRole('button', { name: /^Comptabilité$/ });
    expect(accounting.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(accounting);
    expect(accounting.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(accounting);
    expect(accounting.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(navLink(/^Écritures comptables$/));
    await waitFor(() => expect(drawer.className).not.toContain('open'));
  });

  it('keeps the fourteen quick links and sixteen steps of the mission 37 tour', async () => {
    await login('fr');
    fireEvent.click(navLink(/^Parcours guidé$/));
    await screen.findByRole('heading', { name: 'Parcours guidé' });

    await waitFor(() => expect(document.querySelectorAll('.demo-quick-link')).toHaveLength(14));
    expect(document.querySelectorAll('.demo-step')).toHaveLength(16);

    const closing = Array.from(document.querySelectorAll('.demo-quick-link')).find((link) =>
      /Year-End Closing/i.test(link.textContent ?? ''),
    );
    expect(closing?.getAttribute('href')).toBe('#/accounting/financial-years?tab=checklist');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('mission 38 — English interface terminology', () => {
  beforeEach(() => {
    resetDemo();
    localStorage.clear();
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('shows Client Portfolios, Company File and Team Members, never Client dossiers', async () => {
    await login('en');
    expect(navLink(/Client Portfolios/)).toBeTruthy();
    expect(navLink(/Team Members/)).toBeTruthy();
    expect(screen.queryByRole('link', { name: /Client dossiers/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Journals$/ })).toBeNull();
    expect(navLink(/Journal Entries/)).toBeTruthy();
    expect(navLink(/Bank Reconciliation/)).toBeTruthy();

    fireEvent.click(navLink(/Client Portfolios/));
    await screen.findByRole('heading', { name: /^Client Portfolios$/ });
    expect(screen.queryByText(/Client dossiers/i)).toBeNull();
    expect(screen.getAllByText(/Company File/).length).toBeGreaterThanOrEqual(1);
  });
});
