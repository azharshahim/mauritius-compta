/** Mission 19 — equity screens rendered against the browser demo (fictitious). */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
        <HashRouter><App /></HashRouter>
      </SessionProvider>
    </I18nProvider>,
  );
}

async function loginAndSelect() {
  renderApp();
  fireEvent.click(await screen.findByRole('button', { name: /Se connecter/i }));
  await screen.findByRole('heading', { name: /Tableau de bord Cabinet/i });
  const companySelect = screen.getByRole('combobox', { name: /Société/i }) as HTMLSelectElement;
  const option = [...companySelect.options].find((item) => /Lagon Bleu/i.test(item.textContent ?? ''));
  expect(option).toBeTruthy();
  fireEvent.change(companySelect, { target: { value: option!.value } });
}

describe('capitaux propres & clôture (interface démonstration)', () => {
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

  it('affiche l’état des capitaux propres et son rapprochement, sans appel réseau', async () => {
    await loginAndSelect();
    window.location.hash = '#/accounting/equity';
    expect(await screen.findByRole('heading', { name: /Capitaux propres, clôture et report à nouveau/i })).toBeTruthy();
    expect(await screen.findByText(/Aucun traitement juridique, fiscal ou IFRS n’est imposé/i)).toBeTruthy();
    expect(await screen.findByText(/Capital social/)).toBeTruthy();
    expect(await screen.findByText(/Réserves/)).toBeTruthy();
    expect(await screen.findByText(/Conforme à la balance/i)).toBeTruthy();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('présente le registre avec un mouvement comptabilisé et un brouillon justifié', async () => {
    await loginAndSelect();
    window.location.hash = '#/accounting/equity';
    await screen.findByRole('heading', { name: /Capitaux propres, clôture et report à nouveau/i });
    fireEvent.click(await screen.findByRole('tab', { name: /Registre des mouvements/i }));
    expect(await screen.findByText('EQ-2023-0001')).toBeTruthy();
    expect(await screen.findByText('EQ-2025-0001')).toBeTruthy();
    expect(await screen.findByText('Brouillon')).toBeTruthy();
    expect(await screen.findByText('PV-2023-001')).toBeTruthy();
    expect(await screen.findByRole('button', { name: /Enregistrer le brouillon/i })).toBeTruthy();
  });

  it('prépare une clôture, montre les contrôles bloquants et n’offre aucune comptabilisation', async () => {
    await loginAndSelect();
    window.location.hash = '#/accounting/equity';
    await screen.findByRole('heading', { name: /Capitaux propres, clôture et report à nouveau/i });
    fireEvent.click(await screen.findByRole('tab', { name: /Clôture annuelle/i }));
    fireEvent.click(await screen.findByRole('button', { name: /Préparer et contrôler/i }));
    expect(await screen.findByText(/écriture\(s\) en brouillon existent dans la période/i)).toBeTruthy();
    expect((await screen.findAllByText('Bloqué')).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: /Approuver la clôture/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /Comptabiliser la clôture/i })).toBeNull();
  });

  it('bascule en anglais et conserve les avertissements', async () => {
    await loginAndSelect();
    window.location.hash = '#/accounting/equity';
    await screen.findByRole('heading', { name: /Capitaux propres, clôture et report à nouveau/i });
    const language = screen.getByLabelText(/Langue/i) as HTMLSelectElement;
    fireEvent.change(language, { target: { value: 'en' } });
    await waitFor(() => expect(screen.getByRole('heading', { name: /^Equity, annual closing and retained earnings$/i })).toBeTruthy());
    expect(screen.getByText(/No legal, tax or IFRS treatment is imposed/i)).toBeTruthy();
    expect(screen.getByRole('tab', { name: /Movement register/i })).toBeTruthy();
    expect(screen.getByRole('tab', { name: /Result allocation/i })).toBeTruthy();
  });
});
