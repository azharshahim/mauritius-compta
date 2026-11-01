import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { HashRouter } from 'react-router-dom';
import App from '../src/App';
import { I18nProvider } from '../src/i18n';
import { SessionProvider } from '../src/store';
import { resetDemo } from '../src/demo';
import { navLink } from './nav';

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

async function login() {
  renderApp();
  fireEvent.click(await screen.findByRole('button', { name: /Se connecter/i }));
  await screen.findByRole('heading', { name: /Tableau de bord Cabinet/i });
}

describe('mission 26 — journal imports and light home (demo)', () => {
  beforeEach(() => {
    resetDemo();
    localStorage.clear();
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('puts the purchase import next to the journal entry action', async () => {
    await login();
    fireEvent.click(navLink(/^Écritures comptables$/));
    await screen.findByRole('heading', { name: /^Écritures comptables$/ });
    fireEvent.click(screen.getByRole('tab', { name: /^Journal des achats$/ }));
    await screen.findByRole('heading', { name: /Journal des achats/i });
    const importLink = screen.getByRole('link', { name: /Importer une facture d’achat/i });
    fireEvent.click(importLink);
    await screen.findByRole('heading', { name: /Importer une facture d’achat/i });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input.accept).toContain('application/pdf');
    expect(input.accept).toContain('image/jpeg');
    expect(input.accept).toContain('image/png');
    expect(screen.getByText(/validation humaine avant tout brouillon/i)).toBeTruthy();
  });

  it('keeps purchase and sales imports reachable from their screens', async () => {
    await login();
    window.location.hash = '#/accounting/purchases?tab=invoices';
    await screen.findByRole('heading', { name: /Factures fournisseurs/i });
    const purchaseLink = screen.getByRole('link', { name: /Importer une facture d’achat/i });
    expect(purchaseLink.getAttribute('href')).toContain('/accounting/journals/purchases/import');

    window.location.hash = '#/billing/invoices';
    await screen.findByRole('heading', { name: /^Factures clients$/i });
    const salesLink = screen.getByRole('link', { name: /Importer une facture de vente/i });
    expect(salesLink.getAttribute('href')).toContain('/accounting/journals/sales/import');
  });

  it('offers a structured, no-OCR path for existing sales invoices', async () => {
    await login();
    window.location.hash = '#/accounting/journals/sales/import';
    await screen.findByRole('heading', { name: /Importer une facture de vente/i });
    expect(screen.getByText(/Facture déjà créée dans la suite/i)).toBeTruthy();
    expect(screen.getByText(/aucun OCR, aucun doublon/i)).toBeTruthy();
    await waitFor(() => expect(screen.getByLabelText(/Choisir une facture client émise/i)).toBeTruthy());
    const select = screen.getByLabelText(/Choisir une facture client émise/i) as HTMLSelectElement;
    // The demo invoices are seeded asynchronously after login: wait for the
    // option list instead of racing the first render.
    await waitFor(() => expect(select.options.length).toBeGreaterThan(1));
    expect(screen.getByRole('button', { name: /Préparer le brouillon \(sans OCR\)/i })).toBeTruthy();
  });

  it('reads a PDF statement with metadata, review checkbox and reconciliation link', async () => {
    await login();
    window.location.hash = '#/accounting/banking/pdf';
    await screen.findByRole('heading', { name: /Importer un relevé bancaire PDF/i });
    const account = await screen.findByLabelText(/Compte bancaire/i);
    fireEvent.change(account, { target: { value: (account as HTMLSelectElement).options[1]!.value } });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input.accept).toContain('application/pdf');
    fireEvent.change(input, {
      target: { file: true, files: [new File(['%PDF-1.4 demo'], 'releve-fictif.pdf', { type: 'application/pdf' })] },
    });
    fireEvent.click(screen.getByRole('button', { name: /Analyser|Analyse/i }));
    await screen.findByText(/Banque détectée/i);
    expect(screen.getByText(/Mauritius Commercial Bank/i)).toBeTruthy();
    expect(screen.getByText(/000123456789/)).toBeTruthy();
    expect(screen.getByText(/2026-01-01/)).toBeTruthy();
    const confirm = screen.getByRole('button', { name: /Confirmer et importer/i }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.click(screen.getByLabelText(/Je vérifie chaque ligne/i));
    expect(confirm.disabled).toBe(false);
  });

  it('closes the mobile drawer after a query-only bank navigation', async () => {
    await login();
    fireEvent.click(screen.getByRole('button', { name: /Menu/i }));
    expect(document.querySelector('.sidebar')?.className).toContain('open');
    fireEvent.click(navLink(/^Importer un relevé$/));
    await waitFor(() => expect(window.location.hash).toContain('tab=import'));
    await waitFor(() => expect(document.querySelector('.sidebar')?.className).not.toContain('open'));
  });

  it('keeps the home screen light and contextual', async () => {
    await login();
    expect(screen.getByText(/Société active/i)).toBeTruthy();
    expect(screen.getByText(/Exercice comptable/i)).toBeTruthy();
    expect(screen.getByText(/Écritures à valider/i)).toBeTruthy();
    expect(screen.getByText(/Documents en attente/i)).toBeTruthy();
    expect(screen.getByText(/Accès rapides/i)).toBeTruthy();
    expect(document.querySelector('.hero-import')).toBeNull();
  });
});
