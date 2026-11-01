/** Mission 22 — inventory, accruals and provisions screens (browser demo). */
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
    <I18nProvider><SessionProvider><HashRouter><App /></HashRouter></SessionProvider></I18nProvider>,
  );
}
async function loginAndSelect() {
  renderApp();
  fireEvent.click(await screen.findByRole('button', { name: /Se connecter/i }));
  await screen.findByRole('heading', { name: /Tableau de bord Cabinet/i });
  const select = screen.getByRole('combobox', { name: /Société/i }) as HTMLSelectElement;
  const option = [...select.options].find((item) => /Island Trading/i.test(item.textContent ?? ''))!;
  fireEvent.change(select, { target: { value: option.value } });
}

describe('mission 22 — écrans stocks, échéanciers et provisions (démo)', () => {
  const fetchSpy = vi.fn();
  beforeEach(() => { resetDemo(); localStorage.clear(); fetchSpy.mockReset(); vi.stubGlobal('fetch', fetchSpy); });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it('affiche le stock FIFO et son rapprochement', async () => {
    await loginAndSelect();
    window.location.hash = '#/accounting/inventory';
    expect(await screen.findByRole('heading', { name: /^Stocks$/ })).toBeTruthy();
    expect((await screen.findAllByText(/FIFO-COMM/)).length).toBeGreaterThanOrEqual(1);
    expect((await screen.findAllByText(/DEMO-FIFO-01/)).length).toBeGreaterThanOrEqual(1);
    expect((await screen.findAllByText(/Équilibré/)).length).toBeGreaterThanOrEqual(1);
    fireEvent.click(await screen.findByRole('tab', { name: /^Rapports$/i }));
    expect(await screen.findByText(/Rapports de stock/i)).toBeTruthy();
    expect((await screen.findAllByText(/Sous-registre/i)).length).toBeGreaterThanOrEqual(1);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('liste les échéanciers approuvés et le rapport par type', async () => {
    await loginAndSelect();
    window.location.hash = '#/accounting/accruals';
    expect(await screen.findByRole('heading', { name: /Charges à payer, avances et produits différés/i })).toBeTruthy();
    expect(await screen.findByText('PRE-DEMO-1')).toBeTruthy();
    expect(await screen.findByText('ACC-DEMO-1')).toBeTruthy();
    expect(await screen.findByText('DEF-DEMO-1')).toBeTruthy();
    fireEvent.click(await screen.findByRole('tab', { name: /Rapport & rapprochement/i }));
    expect(await screen.findByText(/Charge constatée d’avance/i)).toBeTruthy();
    expect((await screen.findAllByText(/Équilibré/)).length).toBeGreaterThanOrEqual(1);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('affiche le registre des provisions, les mouvements et le rapprochement', async () => {
    await loginAndSelect();
    window.location.hash = '#/accounting/provisions';
    expect(await screen.findByRole('heading', { name: /^Provisions$/ })).toBeTruthy();
    expect(await screen.findByText('PROV-2025-0001')).toBeTruthy();
    fireEvent.click(await screen.findByText('PROV-2025-0001'));
    expect((await screen.findAllByText('Reconnaissance')).length).toBeGreaterThanOrEqual(1);
    expect((await screen.findAllByText('Utilisation')).length).toBeGreaterThanOrEqual(1);
    fireEvent.click(await screen.findByRole('tab', { name: /Mouvements & rapprochement/i }));
    expect(screen.getAllByText(/Registre/i).length).toBeGreaterThanOrEqual(1);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
