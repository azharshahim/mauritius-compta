/** Mission 24 — démonstration : mappings, FR/EN, version, édition stock et pont facture. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
  const option = [...select.options].find((item) => /Lagon Bleu/i.test(item.textContent ?? ''))!;
  fireEvent.change(select, { target: { value: option.value } });
}

describe('mission 24 — démonstration finale', () => {
  const fetchSpy = vi.fn();
  beforeEach(() => { resetDemo(); localStorage.clear(); fetchSpy.mockReset(); vi.stubGlobal('fetch', fetchSpy); });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it('affiche la version, le commit, les mappings comptables et bascule FR/EN', async () => {
    await loginAndSelect();
    expect((await screen.findAllByText(/Version \d+\.\d+\.\d+/)).length).toBeGreaterThanOrEqual(1);
    expect((await screen.findAllByText(/commit (local|[0-9a-f]{7})/i)).length).toBeGreaterThanOrEqual(1);

    window.location.hash = '#/accounting/accounts';
    expect(await screen.findByRole('heading', { name: /^Plan comptable$/ })).toBeTruthy();
    expect(await screen.findByText(/Mappings comptables/i)).toBeTruthy();

    const language = screen.getByRole('combobox', { name: /Langue/i });
    fireEvent.change(language, { target: { value: 'en' } });
    expect(await screen.findByRole('heading', { name: /Chart of Accounts/ })).toBeTruthy();
    expect(await screen.findByText(/Accounting mappings/i)).toBeTruthy();
    expect((await screen.findAllByText(/Bank — current account MUR/)).length).toBeGreaterThanOrEqual(1);

    window.location.hash = '#/accounting/inventory';
    expect(await screen.findByRole('heading', { name: /^Inventory$/ })).toBeTruthy();
    expect((await screen.findAllByText(/FIFO-COMM/)).length).toBeGreaterThanOrEqual(1);

    fireEvent.change(screen.getByRole('combobox', { name: /Language/i }), { target: { value: 'fr' } });
    expect(await screen.findByRole('heading', { name: /^Stocks$/ })).toBeTruthy();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('respecte un lien profond avec paramètre après un rechargement simulé', async () => {
    renderApp('#/accounting/inventory?tab=movements');
    fireEvent.click(await screen.findByRole('button', { name: /Se connecter/i }));
    expect(await screen.findByRole('heading', { name: /^Stocks$/ })).toBeTruthy();
    expect(screen.getByRole('tab', { name: /^Mouvements$/ }).getAttribute('aria-selected')).toBe('true');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('modifie un article de stock fictif par un formulaire prérempli', async () => {
    await loginAndSelect();
    window.location.hash = '#/accounting/inventory?tab=settings';
    expect(await screen.findByRole('heading', { name: /^Stocks$/ })).toBeTruthy();
    expect(screen.getByRole('tab', { name: /^Paramètres$/ }).getAttribute('aria-selected')).toBe('true');

    const sku = await screen.findByText('DEMO-FIFO-01');
    const row = sku.closest('tr')!;
    fireEvent.click(within(row).getByRole('button', { name: /^Modifier$/ }));
    const dialog = await screen.findByRole('dialog', { name: /Modifier l’article/i });
    const name = within(dialog).getByLabelText('Nom') as HTMLInputElement;
    expect(name.value).toBe('Article FIFO fictif');
    fireEvent.change(name, { target: { value: 'Article FIFO fictif modifié' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /^Enregistrer$/ }));

    await waitFor(() => expect(screen.queryByRole('dialog', { name: /Modifier l’article/i })).toBeNull());
    expect((await screen.findAllByText('Article FIFO fictif modifié')).length).toBeGreaterThanOrEqual(1);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('propose des mouvements de stock depuis une facture émise puis ouvre les mouvements', async () => {
    await loginAndSelect();
    window.location.hash = '#/billing/invoices';
    expect(await screen.findByRole('heading', { name: /^Factures clients$/ })).toBeTruthy();

    const number = await screen.findByText('FAC-DEMO-0002');
    const row = number.closest('tr')!;
    fireEvent.click(within(row).getByRole('button', { name: /^Modifier$/ }));
    const detail = await screen.findByRole('dialog', { name: /FAC-DEMO-0002/ });
    fireEvent.click(within(detail).getByRole('button', { name: /Proposer les mouvements de stock/i }));

    const stockDialog = await screen.findByRole('dialog', { name: /^Proposer les mouvements de stock$/ });
    const selects = within(stockDialog).getAllByRole('combobox') as HTMLSelectElement[];
    const itemSelect = selects[1]!;
    const option = [...itemSelect.options].find((o) => /DEMO-FIFO-01/.test(o.textContent ?? ''))!;
    expect(option).toBeTruthy();
    fireEvent.change(itemSelect, { target: { value: option.value } });
    fireEvent.click(within(stockDialog).getByRole('button', { name: /^Proposer les mouvements de stock$/ }));

    expect(await screen.findByText(/1 mouvement\(s\) de stock proposé\(s\)/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Voir les mouvements proposés/i }));
    expect(await screen.findByRole('heading', { name: /^Stocks$/ })).toBeTruthy();
    expect(screen.getByRole('tab', { name: /^Mouvements$/ }).getAttribute('aria-selected')).toBe('true');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('refuse une quantité supérieure à la quantité facturée dans la démonstration', async () => {
    await loginAndSelect();
    window.location.hash = '#/billing/invoices';
    const number = await screen.findByText('FAC-DEMO-0002');
    fireEvent.click(within(number.closest('tr')!).getByRole('button', { name: /^Modifier$/ }));
    const detail = await screen.findByRole('dialog', { name: /FAC-DEMO-0002/ });
    fireEvent.click(within(detail).getByRole('button', { name: /Proposer les mouvements de stock/i }));
    const stockDialog = await screen.findByRole('dialog', { name: /^Proposer les mouvements de stock$/ });
    const selects = within(stockDialog).getAllByRole('combobox') as HTMLSelectElement[];
    const itemSelect = selects[1]!;
    const option = [...itemSelect.options].find((o) => /DEMO-FIFO-01/.test(o.textContent ?? ''))!;
    fireEvent.change(itemSelect, { target: { value: option.value } });
    const qty = stockDialog.querySelector('input[inputmode="decimal"]') as HTMLInputElement;
    fireEvent.change(qty, { target: { value: '99' } });
    fireEvent.click(within(stockDialog).getByRole('button', { name: /^Proposer les mouvements de stock$/ }));
    expect(await screen.findByText(/quantité sortie dépasse la quantité facturée/i)).toBeTruthy();
    expect(screen.queryByText(/mouvement\(s\) de stock proposé/i)).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
