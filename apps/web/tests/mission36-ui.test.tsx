/**
 * Mission 36 — accountant navigation in French and English, with direct links
 * to the existing Accounting periods / Audit Trail / Year-End tabs.
 * Mission 38 removed the journals group and renamed the English cabinet labels.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

async function login() {
  renderApp();
  fireEvent.click(await screen.findByRole('button', { name: /Se connecter/i }));
  await screen.findByRole('heading', { name: /Tableau de bord Cabinet/i });
}

describe('mission 36 — accountant navigation and terminology', () => {
  beforeEach(() => {
    resetDemo();
    localStorage.clear();
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('exposes the ten professional groups and opens Journal Entries', async () => {
    await login();
    expect(document.querySelectorAll('.nav-group-toggle')).toHaveLength(10);
    expect(screen.getByRole('button', { name: /Comptabilité/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Ventes et facturation/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Achats et dépenses/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Stocks et immobilisations/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Rapports/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Journaux$/ })).toBeNull();

    fireEvent.click(navLink(/^Écritures comptables$/));
    await screen.findByRole('heading', { name: /Écritures comptables/i });
    expect(window.location.hash).toContain('/accounting/entries');
  });

  it('opens the Year-End Closing and Audit Trail tabs directly from the sidebar', async () => {
    await login();

    fireEvent.click(navLink(/^Clôture annuelle$/));
    await waitFor(() => expect(screen.getByRole('tab', { name: /Contrôles de clôture/i })).toBeTruthy());
    expect(screen.getByRole('tab', { name: /Contrôles de clôture/i }).getAttribute('aria-selected')).toBe('true');

    fireEvent.click(navLink(/^Piste d’audit$/));
    await screen.findByRole('heading', { name: /^Paramètres$/i });
    const auditTab = await screen.findByRole('button', { name: /^Piste d’audit$/ });
    expect(auditTab.className).toContain('active');
  });

  it('switches the whole sidebar to the international English terminology', async () => {
    await login();
    fireEvent.change(screen.getByLabelText(/Langue/i), { target: { value: 'en' } });

    await waitFor(() => expect(navLink(/Chart of Accounts/)).toBeTruthy());
    expect(navLink(/Journal Entries/)).toBeTruthy();
    expect(navLink(/General Ledger/)).toBeTruthy();
    expect(navLink(/Trial Balance/)).toBeTruthy();
    expect(navLink(/Bank Reconciliation/)).toBeTruthy();
    expect(navLink(/Profit & Loss/)).toBeTruthy();
    expect(navLink(/Balance Sheet/)).toBeTruthy();
    expect(navLink(/Year-End Closing/)).toBeTruthy();
    expect(navLink(/Client Portfolios/)).toBeTruthy();
    expect(screen.queryByRole('link', { name: /Client dossiers/ })).toBeNull();
    expect(navLink(/Audit Trail/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Customers & Companies|Clients & Companies/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Sales & Invoicing/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Ventes et facturation/i })).toBeNull();
  });
});
