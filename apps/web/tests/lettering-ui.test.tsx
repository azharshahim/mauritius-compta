/**
 * Écran Comptabilité → Lettrage (démonstration embarquée, aucun réseau).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

describe('lettrage (interface démo)', () => {
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

  it('affiche les comptes, les suggestions explicables, le tableau et les cartes Android', async () => {
    await login();
    window.location.hash = '#/accounting/lettering';
    await screen.findByRole('heading', { name: /Lettrage clients & fournisseurs/i });

    expect(screen.getByRole('tab', { name: /^Lettrage$/i })).toBeTruthy();
    expect(screen.getByRole('tab', { name: /Historique & délettrage/i })).toBeTruthy();
    expect(screen.getByRole('tab', { name: /Rapports/i })).toBeTruthy();
    expect(await screen.findByText(/Suggestions explicables/i)).toBeTruthy();
    expect((await screen.findAllByText(/Même compte tiers/i)).length).toBeGreaterThan(0);
    expect(document.querySelector('.lettering-cards')).toBeTruthy();
    expect(document.querySelector('.lettering-table')).toBeTruthy();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('prévisualise puis confirme un lettrage après vérification humaine', async () => {
    await login();
    window.location.hash = '#/accounting/lettering';
    await screen.findByRole('heading', { name: /Lettrage clients & fournisseurs/i });
    const buttons = await screen.findAllByRole('button', { name: /Prévisualiser cette suggestion/i });
    fireEvent.click(buttons[0]!);
    await screen.findByText(/Aperçu avant confirmation/i);
    expect(screen.getByText(/Équilibré|Aucun blocage/i)).toBeTruthy();
    const confirm = screen.getByRole('button', { name: /Confirmer le lettrage/i }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.click(screen.getByLabelText(/Je confirme avoir vérifié/i));
    await waitFor(() => expect(confirm.disabled).toBe(false));
    fireEvent.click(confirm);
    await screen.findByText(/Lettrage confirmé/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('remplace le tableau par des cartes sous 640 px sans débordement horizontal', () => {
    const css = readFileSync(resolve(process.cwd(), 'src', 'styles.css'), 'utf8');
    expect(css).toMatch(/\.lettering-table \.table \{ min-width: 860px; \}/);
    expect(css).toMatch(/\.lettering-cards \{ display: none;/);
    expect(css).toMatch(
      /@media \(max-width: 640px\)[\s\S]*\.lettering-table \{ display: none; \}[\s\S]*\.lettering-cards \{ display: flex;/,
    );
    expect(css).toMatch(/\.lettering-card-grid[\s\S]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  });

  it('affiche l’historique, le délettrage sécurisé et les rapports par devise', async () => {
    await login();
    window.location.hash = '#/accounting/lettering';
    await screen.findByRole('heading', { name: /Lettrage clients & fournisseurs/i });
    fireEvent.click(screen.getByRole('tab', { name: /Historique & délettrage/i }));
    expect((await screen.findAllByText(/Erreur de sélection fictive/i)).length).toBeGreaterThan(0);
    expect((await screen.findAllByText(/LET-2026-/)).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('tab', { name: /Rapports/i }));
    expect(await screen.findByText(/Soldes non lettrés par devise/i)).toBeTruthy();
    expect((await screen.findAllByText(/MUR/)).length).toBeGreaterThan(0);
    expect(screen.getByText(/Factures totalement ou partiellement lettrées/i)).toBeTruthy();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
