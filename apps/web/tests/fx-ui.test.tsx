/** Écran Comptabilité → Multidevises (démonstration embarquée, aucun réseau). */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

describe('multidevises (interface démo)', () => {
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

  it('présente les six rubriques, les devises et l’avertissement de taux non officiel sans réseau', async () => {
    await login();
    window.location.hash = '#/accounting/multi-currency';
    await screen.findByRole('heading', { name: /^Multidevises$/i });
    for (const name of [/Configuration/i, /Taux & conversion/i, /Écarts réalisés/i, /Évaluations latentes/i, /Virements/i, /Rapports/i]) {
      expect(screen.getByRole('tab', { name })).toBeTruthy();
    }
    expect((await screen.findAllByText(/ne proviennent d’aucune banque centrale/i)).length).toBeGreaterThan(0);
    expect((await screen.findAllByText(/MUR/)).length).toBeGreaterThan(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('affiche les écarts fictifs, leur calcul et bloque la validation sans comptes configurés', async () => {
    await login();
    window.location.hash = '#/accounting/multi-currency';
    await screen.findByRole('heading', { name: /^Multidevises$/i });
    fireEvent.click(screen.getByRole('tab', { name: /Écarts réalisés/i }));
    expect((await screen.findAllByText(/Client européen fictif/i)).length).toBeGreaterThan(0);
    await waitFor(() => expect(document.body.textContent).toMatch(/1000\.0000 EUR ×/));
    const post = screen.getAllByRole('button', { name: /^Comptabiliser$/i })[0]!;
    fireEvent.click(post);
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/Aucun compte n’est inventé/i)).toBeTruthy();
    const confirm = within(dialog).getByRole('button', { name: /^Comptabiliser$/i }) as HTMLButtonElement;
    fireEvent.click(within(dialog).getByLabelText(/Je confirme le calcul/i));
    await waitFor(() => expect(confirm.disabled).toBe(false));
    fireEvent.click(confirm);
    expect(await screen.findByText(/Comptes de gain et de perte de change non configurés/i)).toBeTruthy();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('conserve un indicateur de focus et une zone tactile de 44 px pour les cases du lettrage', () => {
    const css = readFileSync(resolve(__dirname, '../src/styles.css'), 'utf8');
    expect(css).toMatch(/input\[type='checkbox'\][^}]*min-height: 18px/s);
    expect(css).toMatch(/input\[type='checkbox'\]:focus-visible[^}]*outline: 3px/s);
    expect(css).toMatch(/\.lettering-check[^}]*min-width: 44px/s);
    expect(css).toMatch(/\.lettering-check[^}]*min-height: 44px/s);
  });
});
