/**
 * Pastille IA universelle (mission 7) — rendu réel du build de démonstration.
 *
 * Vérifie : présence dans les quatre modules, ouverture/fermeture au clavier,
 * conservation de la conversation lors d'une navigation, et surtout que
 * l'ouverture du panneau ne vole jamais le focus (règle Android/Samsung).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { HashRouter } from 'react-router-dom';
import App from '../src/App';
import { I18nProvider } from '../src/i18n';
import { SessionProvider } from '../src/store';
import { resetDemo } from '../src/demo';
import { clickNavLink } from './nav';

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

const openPanel = async () => {
  fireEvent.click(screen.getByRole('button', { name: /Assistant IA/i }));
  return screen.findByTestId('assistant-panel');
};

describe('assistant IA universel (démo)', () => {
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

  it('affiche la pastille sur les écrans des quatre modules', async () => {
    await login();
    const pill = screen.getByRole('button', { name: /Assistant IA/i });
    expect(pill).toBeTruthy();

    for (const label of [
      /Journaux comptables/,
      /Tableau de bord Facturation/,
      /Tableau de bord Paie/,
      /^Tableau de bord Cabinet$/,
    ]) {
      clickNavLink(label);
      await waitFor(() =>
        expect(screen.getByRole('button', { name: /Assistant IA/i })).toBeTruthy(),
      );
    }
  });

  it('ouvre le panneau et répond avec les données fictives du dossier', async () => {
    await login();
    await openPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Quelles factures sont impayées ?' }));
    fireEvent.click(screen.getByRole('button', { name: /Envoyer/i }));
    await waitFor(() =>
      expect(screen.getByText(/FAC-DEMO-0001/)).toBeTruthy(),
      { timeout: 4000 },
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('ferme le panneau avec Échap sans recharger la page', async () => {
    await login();
    await openPanel();
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('assistant-panel')).toBeNull());
    expect(screen.getByRole('heading', { name: /Tableau de bord Cabinet/i })).toBeTruthy();
  });

  it('conserve la conversation lors d’une navigation entre modules', async () => {
    await login();
    await openPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Quelles factures sont impayées ?' }));
    fireEvent.click(screen.getByRole('button', { name: /Envoyer/i }));
    await waitFor(() => expect(screen.getByText(/FAC-DEMO-0001/)).toBeTruthy(), { timeout: 4000 });

    // L'action « Ouvrir les factures » navigue et ferme le panneau.
    const panelBefore = screen.getByTestId('assistant-panel');
    const examine = Array.from(panelBefore.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Examiner',
    )!;
    fireEvent.click(examine);
    await waitFor(() => expect(screen.queryByTestId('assistant-panel')).toBeNull());
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Assistant IA/i })).toBeTruthy(),
    );
    const panel = await openPanel();
    expect(panel.textContent).toContain('FAC-DEMO-0001');
  });

  it('ne vole jamais le focus à une saisie en cours (règle Android/Samsung)', async () => {
    await login();
    clickNavLink(/^Paramètres$/);

    const titleInput = (await screen.findByLabelText(/Nom complet/i)) as HTMLInputElement;
    titleInput.focus();
    fireEvent.change(titleInput, { target: { value: 'Saisie en cours (démo)' } });
    expect(document.activeElement).toBe(titleInput);

    await openPanel();
    expect(document.activeElement).toBe(titleInput);
    expect(titleInput.value).toBe('Saisie en cours (démo)');
    const composer = document.getElementById('assistant-input') as HTMLInputElement;
    expect(document.activeElement).not.toBe(composer);
  });
});
