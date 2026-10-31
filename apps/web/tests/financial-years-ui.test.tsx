/** Mission 21 — financial years screen rendered against the browser demo. */
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

describe('exercices & archives (interface démonstration)', () => {
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

  it('affiche la chronologie, les contrôles et la continuité sans appel réseau', async () => {
    await loginAndSelect();
    window.location.hash = '#/accounting/financial-years';
    expect(await screen.findByRole('heading', { name: /Exercices & archives/i })).toBeTruthy();
    expect(await screen.findByText(/Continuité pluriannuelle/i)).toBeTruthy();
    expect(await screen.findByText(/FY 2024\/2025 \(démo\)/)).toBeTruthy();
    expect(await screen.findByText(/FY 2023\/2024 \(démo\)/)).toBeTruthy();
    expect((await screen.findAllByText(/Clôturé/i)).length).toBeGreaterThanOrEqual(2);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('montre les soldes d’ouverture, les éléments préservés et les contrôles', async () => {
    await loginAndSelect();
    window.location.hash = '#/accounting/financial-years';
    await screen.findByRole('heading', { name: /Exercices & archives/i });
    fireEvent.click(await screen.findByRole('tab', { name: /Soldes d’ouverture/i }));
    expect(await screen.findByText(/Aperçu des soldes d’ouverture/i)).toBeTruthy();
    expect(await screen.findByText(/Éléments préservés/i)).toBeTruthy();
    expect(await screen.findByText(/OPENING_BALANCED/)).toBeTruthy();
    expect(await screen.findByText(/continuous_ledger/)).toBeTruthy();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('liste les ajustements antérieurs, la checklist et les archives scellées', async () => {
    await loginAndSelect();
    window.location.hash = '#/accounting/financial-years';
    await screen.findByRole('heading', { name: /Exercices & archives/i });
    fireEvent.click(await screen.findByRole('tab', { name: /Ajustements antérieurs/i }));
    expect(await screen.findByText('PYA-2025-0001')).toBeTruthy();
    expect(await screen.findByText('PYA-2025-0002')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: /Contrôles de clôture/i }));
    expect(await screen.findByText(/Les contrôles indisponibles ou en attente ne sont jamais présentés comme réussis/i)).toBeTruthy();
    // Mission 22 controls are real: no module is presented as unavailable.
    expect(screen.queryAllByText('unavailable')).toHaveLength(0);
    expect((await screen.findAllByText('warning')).length).toBeGreaterThanOrEqual(1);
    fireEvent.click(screen.getByRole('tab', { name: 'Archives' }));
    expect((await screen.findAllByText(/Archives annuelles/i)).length).toBeGreaterThanOrEqual(1);
    // Select the closed 2024/2025 exercise (two later exercises are open).
    fireEvent.click(screen.getByRole('tab', { name: 'Chronologie' }));
    const selects = await screen.findAllByRole('button', { name: /Sélectionner/i });
    fireEvent.click(selects[1]!);
    fireEvent.click(screen.getByRole('tab', { name: 'Archives' }));
    expect((await screen.findAllByRole('button', { name: /Vérifier/i })).length).toBeGreaterThanOrEqual(1);
    expect((await screen.findAllByText(/2024\/2025 \(démo\)/)).length).toBeGreaterThanOrEqual(1);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
