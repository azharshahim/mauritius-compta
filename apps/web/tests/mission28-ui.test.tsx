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

function pdf(name: string) {
  return new File(['%PDF-1.4 fictif'], name, { type: 'application/pdf' });
}

describe('mission 28 — bulk accounting and premium UI (demo)', () => {
  beforeEach(() => {
    resetDemo();
    localStorage.clear();
    document.documentElement.dataset.theme = 'light';
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('renders the new accounting dashboard from real available APIs', async () => {
    await login();
    window.location.hash = '#/accounting';
    await screen.findByRole('heading', { level: 1, name: /^Tableau de bord$/i });
    expect(screen.getByRole('link', { name: /Import groupé/i }).getAttribute('href')).toContain(
      '/accounting/journals/purchases/import/bulk',
    );
    expect(screen.getByRole('link', { name: /Rapprochement groupé/i })).toBeTruthy();
    expect(screen.getByText(/Produits/i)).toBeTruthy();
    expect(screen.getAllByText(/Documents à traiter/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Importations bancaires récentes/i)).toBeTruthy();
    expect(screen.getByText(/Toutes les valeurs proviennent des APIs/i)).toBeTruthy();
  });

  it('switches between light and dark themes and remembers the choice', async () => {
    await login();
    const toggle = screen.getByRole('button', { name: /Passer en mode sombre/i });
    fireEvent.click(toggle);
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('dark'));
    expect(localStorage.getItem('mc.theme')).toBe('dark');
    fireEvent.click(screen.getByRole('button', { name: /Passer en mode clair/i }));
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('light'));
  });

  it('imports several invoices, prepares proposals and creates drafts only after explicit confirmation', async () => {
    await login();
    window.location.hash = '#/accounting/journals/purchases/import/bulk';
    await screen.findByRole('heading', { level: 1, name: /Import groupé/i });

    const input = document.querySelector('.bulk-dropzone input[type="file"]') as HTMLInputElement;
    expect(input.multiple).toBe(true);
    expect(input.accept).toContain('application/pdf');
    expect(input.accept).toContain('image/jpeg');
    fireEvent.change(input, { target: { files: [pdf('facture-a.pdf'), pdf('facture-b.pdf')] } });

    await waitFor(() => expect(document.querySelectorAll('.invoice-table tbody tr').length).toBe(2), { timeout: 5000 });
    await waitFor(() => expect(document.querySelectorAll('.invoice-table tbody tr .badge').length).toBeGreaterThanOrEqual(2));
    await waitFor(() => {
      const party = document.querySelector('input[aria-label="Fournisseur / client facture-a.pdf"]') as HTMLInputElement;
      expect(party.value).toBe('FOURNISSEUR DÉMO SARL');
    }, { timeout: 5000 });

    fireEvent.click(screen.getByRole('button', { name: /Préparer les propositions/i }));
    await waitFor(() => expect(screen.getAllByText(/Proposition prête/).length).toBe(2), { timeout: 5000 });

    const validate = screen.getByRole('button', { name: /Créer les brouillons sélectionnés/i }) as HTMLButtonElement;
    expect(validate.disabled).toBe(false);
    fireEvent.click(validate);

    const modal = await screen.findByRole('dialog', { name: /Confirmer les brouillons/i });
    const confirm = within(modal).getByRole('button', { name: /Confirmer la création des brouillons/i }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.click(within(modal).getByRole('checkbox'));
    expect(confirm.disabled).toBe(false);
    fireEvent.click(confirm);

    await waitFor(() => expect(screen.getAllByText(/Brouillon créé/).length).toBeGreaterThanOrEqual(2), {
      timeout: 5000,
    });
    // Approval created drafts, never posted entries.
    const state = JSON.parse(localStorage.getItem('mc.demo.state.v1') ?? '{}') as {
      entries?: { status: string; description?: string }[];
    };
    expect((state.entries ?? []).some((entry) => entry.status === 'draft' && /Document import/.test(entry.description ?? ''))).toBe(true);
    expect((state.entries ?? []).some((entry) => entry.status === 'posted' && /Document import/.test(entry.description ?? ''))).toBe(false);
  });

  it('shows supervised classification rules with evidence and lets an accountant disable one', async () => {
    await login();
    window.location.hash = '#/accounting/journals/purchases/import/bulk';
    await screen.findByRole('heading', { level: 1, name: /Import groupé/i });
    expect(screen.getByText(/Une correction isolée ne devient jamais une règle appliquée/i)).toBeTruthy();
    const toggle = await screen.findByRole('checkbox', { name: /Active acme office supplies paper box/i });
    expect((toggle as HTMLInputElement).checked).toBe(true);
    fireEvent.click(toggle);
    await waitFor(() => {
      const state = JSON.parse(localStorage.getItem('mc.demo.state.v1') ?? '{}') as {
        mission23?: { mappings?: { id: string; is_active: boolean }[] };
      };
      expect(state.mission23?.mappings?.find((rule) => rule.id === 'demo-rule-1')?.is_active).toBe(false);
    });
  });

  it('renders the new screens and navigation icons in English', async () => {
    await login();
    fireEvent.change(screen.getByLabelText(/Langue/i), { target: { value: 'en' } });
    await waitFor(() => expect(document.documentElement.lang).toBe('en'));

    window.location.hash = '#/accounting';
    await screen.findByRole('heading', { level: 1, name: /^Dashboard$/i });
    expect(screen.getByText(/Accounting overview/i)).toBeTruthy();
    expect(document.querySelector('.nav-icon svg')).toBeTruthy();

    window.location.hash = '#/accounting/journals/sales/import/bulk';
    await screen.findByRole('heading', { level: 1, name: /Bulk invoice import/i });
    expect(screen.getByText(/Drop invoices here or choose several files/i)).toBeTruthy();
    expect(screen.getByText(/Every document keeps its own result/i)).toBeTruthy();

    window.location.hash = '#/accounting/banking/bulk-reconciliation';
    await screen.findByRole('heading', { level: 1, name: /Bulk bank reconciliation/i });
    expect(screen.getByText(/Only unique exact suggestions can be selected/i)).toBeTruthy();
  });

  it('shows grouped reconciliation suggestions and never preselects a bank match', async () => {
    await login();
    window.location.hash = '#/accounting/banking/bulk-reconciliation';
    await screen.findByRole('heading', { name: /Rapprochement bancaire groupé/i });
    expect(screen.getByText(/Paiements partiels/i)).toBeTruthy();
    const analyze = await screen.findByRole('button', { name: /Analyser les transactions/i }) as HTMLButtonElement;
    await waitFor(() => expect(analyze.disabled).toBe(false));
    fireEvent.click(analyze);
    await waitFor(() => expect(document.querySelectorAll('.bulk-table tbody tr').length).toBeGreaterThan(0), { timeout: 10000 });
    const boxes = [...document.querySelectorAll('.bulk-table tbody input[type="checkbox"]')] as HTMLInputElement[];
    expect(boxes.length).toBeGreaterThan(0);
    expect(boxes.every((box) => !box.checked)).toBe(true);
    expect(screen.getByText(/Seules les suggestions uniques et exactes/i)).toBeTruthy();
    expect(screen.getByText(/relevé importé dans le compte sélectionné/i)).toBeTruthy();
  });
});
