/**
 * Écran Achats & Fournisseurs — parcours réel du build de démonstration.
 * Aucun réseau : les données fictives viennent du backend embarqué.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { HashRouter } from 'react-router-dom';
import App from '../src/App';
import { I18nProvider } from '../src/i18n';
import { SessionProvider } from '../src/store';
import { resetDemo } from '../src/demo';

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

describe('achats & fournisseurs (démo)', () => {
  const fetchSpy = vi.fn();

  beforeEach(() => {
    resetDemo();
    localStorage.clear();
    fetchSpy.mockReset();
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('affiche le tableau de bord, les factures et l’échéancier fictifs', async () => {
    await login();
    window.location.hash = '#/accounting/purchases';
    await screen.findByRole('heading', { name: /Achats & Fournisseurs/i });

    expect(screen.getByRole('tab', { name: /Tableau de bord/i })).toBeTruthy();
    expect(screen.getByRole('tab', { name: /Fournisseurs/i })).toBeTruthy();
    expect(screen.getByRole('tab', { name: /Factures d’achat/i })).toBeTruthy();
    expect(screen.getByRole('tab', { name: /Règlements/i })).toBeTruthy();

    expect((await screen.findAllByText(/MUR/)).length).toBeGreaterThan(0);
    expect(fetchSpy).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('tab', { name: /Fournisseurs/i }));
    expect((await screen.findAllByText(/Atelier Rivière Ltda/i)).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Oceanic Supplies SARL/i).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('tab', { name: /Factures d’achat/i }));
    expect((await screen.findAllByText(/FAC-DEMO-1001/i)).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/50 000,00/).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /Nouveau document/i })).toBeTruthy();

    fireEvent.click(screen.getByRole('tab', { name: /Avoirs/i }));
    expect((await screen.findAllByText(/AVOIR-DEMO-3001/i)).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('tab', { name: /Règlements/i }));
    expect((await screen.findAllByText(/RF-2026-0001/i)).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('tab', { name: /Échéancier/i }));
    expect(await screen.findByText(/Échéancier des dettes fournisseurs/i)).toBeTruthy();
    expect(screen.getAllByText(/EUR/).length).toBeGreaterThan(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
