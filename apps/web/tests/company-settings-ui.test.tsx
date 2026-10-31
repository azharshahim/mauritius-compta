/**
 * Paramètres société (mission 7) — écran réel du build de démonstration.
 *
 * Accès : Cabinet → Sociétés → Fiche société → Paramètres, et
 * Comptabilité → Paramètres → Paramètres société (même référence).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { HashRouter } from 'react-router-dom';
import App from '../src/App';
import { I18nProvider } from '../src/i18n';
import { SessionProvider } from '../src/store';
import { resetDemo } from '../src/demo';

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

async function openSettings() {
  renderApp();
  fireEvent.click(await screen.findByRole('button', { name: /Se connecter/i }));
  await screen.findByRole('heading', { name: /Tableau de bord Cabinet/i });

  fireEvent.click(screen.getByRole('button', { name: /Cabinet/i }));
  const nav = document.querySelector('.nav') as HTMLElement;
  const companiesLink = Array.from(nav.querySelectorAll('a')).find((a) =>
    /Dossiers/i.test(a.textContent ?? ''),
  )!;
  fireEvent.click(companiesLink);

  const dossier = await screen.findByRole('link', { name: /Lagon Bleu/i });
  fireEvent.click(dossier);
  fireEvent.click(await screen.findByRole('link', { name: /Paramètres société/i }));
  await screen.findByRole('heading', { name: /Paramètres société/i });
}

describe('paramètres société (démo)', () => {
  beforeEach(() => {
    resetDemo();
    localStorage.clear();
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('est accessible depuis la fiche société et présente les quatre sections', async () => {
    await openSettings();
    for (const label of [/Identification/i, /Comptabilité/i, /Facturation/i, /Fiscalité/i]) {
      expect(screen.getAllByRole('button', { name: label }).length).toBeGreaterThan(0);
    }
    const name = screen.getByLabelText(/Raison sociale/i) as HTMLInputElement;
    expect(name.value).toContain('Lagon Bleu');
  });

  it('affiche le taux de démonstration 15 % comme non vérifié et exige une source', async () => {
    await openSettings();
    fireEvent.click(screen.getAllByRole('button', { name: /Fiscalité/i })[0]!);
    await screen.findByText(/Taux de démonstration 15 %/);
    expect(screen.getAllByText(/Non vérifié/i).length).toBeGreaterThan(0);

    const verifyButtons = screen.getAllByRole('button', { name: 'Vérifier' });
    fireEvent.click(verifyButtons[verifyButtons.length - 1]!);
    const box = document.querySelector('.verify-box') as HTMLElement;
    await waitFor(() => expect(box).toBeTruthy());
    const confirm = Array.from(box.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Vérifier',
    ) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);

    // La confirmation explicite est obligatoire : sans elle, la vérification
    // reste impossible même avec une source renseignée.
    const source = box.querySelector('input:not([type="checkbox"])') as HTMLInputElement;
    fireEvent.change(source, { target: { value: 'Document fictif de démonstration' } });
    expect(confirm.disabled).toBe(true);
  });

  it('est aussi accessible depuis Comptabilité → Paramètres société', async () => {
    renderApp();
    fireEvent.click(await screen.findByRole('button', { name: /Se connecter/i }));
    await screen.findByRole('heading', { name: /Tableau de bord Cabinet/i });

    fireEvent.click(screen.getByRole('button', { name: /Comptabilité/i }));
    const nav = document.querySelector('.nav') as HTMLElement;
    fireEvent.click(
      Array.from(nav.querySelectorAll('a')).find((a) => /Paramètres/i.test(a.textContent ?? ''))!,
    );
    const link = await screen.findByRole('link', {
      name: /Ouvrir les paramètres de la société/i,
    });
    fireEvent.click(link);
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /Paramètres société/i })).toBeTruthy(),
    );
  });
});
