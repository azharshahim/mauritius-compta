/**
 * Mission 27 — import direct depuis le Journal de banque (démonstration).
 *
 * Le relevé fictif est lu depuis `public/samples` et importé par le moteur
 * embarqué de la démonstration. Aucun réseau, aucune donnée réelle.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { HashRouter } from 'react-router-dom';
import App from '../src/App';
import { I18nProvider } from '../src/i18n';
import { SessionProvider } from '../src/store';
import { resetDemo } from '../src/demo';

const sample = readFileSync(
  resolve(process.cwd(), 'public', 'samples', 'releve-bancaire-fictif.csv'),
  'utf8',
);

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

function makeFile(content: string, name: string): File {
  const file = new File([content], name, { type: 'text/csv' });
  Object.defineProperty(file, 'arrayBuffer', {
    value: async () => new TextEncoder().encode(content).buffer,
  });
  return file;
}

function demoState(): {
  entries: { status: string }[];
  bankTransactions: unknown[];
} {
  return JSON.parse(localStorage.getItem('mc.demo.state.v1') ?? '{}');
}

async function openBankJournal() {
  window.location.hash = '#/accounting/journals/bank';
  await screen.findByRole('heading', { name: /Journal de banque/i });
}

describe('mission 27 — import depuis le journal de banque (démo)', () => {
  beforeEach(() => {
    resetDemo();
    localStorage.clear();
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('affiche le bouton d’import dans le journal de banque uniquement', async () => {
    await login();
    await openBankJournal();
    const importLink = screen.getByRole('link', { name: /Importer un relevé bancaire/i });
    expect(importLink.getAttribute('href')).toContain('/accounting/banking?tab=import');
    expect(importLink.getAttribute('href')).toContain(
      encodeURIComponent('/accounting/journals/bank'),
    );
    expect(screen.getByRole('button', { name: /Ajouter une écriture/i })).toBeTruthy();

    window.location.hash = '#/accounting/journals/purchases';
    await screen.findByRole('heading', { name: /Journal des achats/i });
    expect(screen.queryByRole('link', { name: /Importer un relevé bancaire/i })).toBeNull();
    expect(screen.getByRole('link', { name: /Importer une facture d’achat/i })).toBeTruthy();

    window.location.hash = '#/accounting/journals/sales';
    await screen.findByRole('heading', { name: /Journal des ventes/i });
    expect(screen.queryByRole('link', { name: /Importer un relevé bancaire/i })).toBeNull();
    expect(screen.getByRole('link', { name: /Importer une facture de vente/i })).toBeTruthy();

    window.location.hash = '#/accounting/journals/general';
    await screen.findByRole('heading', { name: /Opérations diverses/i });
    expect(screen.queryByRole('link', { name: /Importer un relevé bancaire/i })).toBeNull();
  });

  it('ouvre le module bancaire avec les formats réels et conserve la société', async () => {
    await login();
    const companyBefore = localStorage.getItem('mc.companyId');
    await openBankJournal();
    fireEvent.click(screen.getByRole('link', { name: /Importer un relevé bancaire/i }));

    await screen.findByRole('heading', { name: /Banque & rapprochement/i });
    const importTab = screen.getByRole('tab', { name: /Importer un relevé/i });
    expect(importTab.getAttribute('aria-selected')).toBe('true');
    expect(localStorage.getItem('mc.companyId')).toBe(companyBefore);

    const account = (await screen.findByLabelText(/Compte bancaire/i)) as HTMLSelectElement;
    expect(account.value).not.toBe('');

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input.accept).toContain('.csv');
    expect(input.accept).toContain('.tsv');
    expect(input.accept).toContain('.txt');
    expect(input.accept).toContain('.xlsx');
    expect(input.accept).not.toContain('.pdf');
    const pdfLink = screen.getByRole('link', { name: /Importer un relevé PDF/i });
    expect(pdfLink.getAttribute('href')).toContain('/accounting/banking/pdf');
    expect(pdfLink.getAttribute('href')).toContain('bankAccountId=');
    expect(pdfLink.getAttribute('href')).toContain(
      encodeURIComponent('/accounting/journals/bank'),
    );
  });

  it('importe le relevé fictif sans créer d’écriture comptable et propose les retours', async () => {
    await login();
    await openBankJournal();
    const before = demoState();
    expect(before.entries.length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('link', { name: /Importer un relevé bancaire/i }));
    await screen.findByRole('heading', { name: /Banque & rapprochement/i });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, {
      target: { files: [makeFile(sample, 'releve-bancaire-fictif.csv')] },
    });

    await screen.findByRole('heading', { name: /Synthèse/i });
    for (const column of ['Débit', 'Crédit', 'Solde', 'Devise']) {
      expect(screen.getByRole('columnheader', { name: column })).toBeTruthy();
    }
    fireEvent.click(screen.getByLabelText(/Je vérifie la proposition/i));
    fireEvent.click(screen.getByRole('button', { name: /Confirmer l’import/i }));

    const view = await screen.findByRole('link', { name: /Voir les opérations importées/i });
    const prepare = screen.getByRole('link', { name: /Préparer le rapprochement bancaire/i });
    const back = screen.getByRole('link', { name: /Retour au Journal de banque/i });
    expect(view.getAttribute('href')).toContain('tab=transactions');
    expect(view.getAttribute('href')).toContain('bankAccountId=');
    expect(prepare.getAttribute('href')).toContain('tab=report');
    expect(prepare.getAttribute('href')).toContain('bankAccountId=');
    expect(back.getAttribute('href')).toBe('#/accounting/journals/bank');

    await waitFor(() => {
      const after = demoState();
      expect(after.entries.length).toBe(before.entries.length);
      expect(after.bankTransactions.length).toBeGreaterThan(before.bankTransactions.length);
    });

    fireEvent.click(back);
    await screen.findByRole('heading', { name: /Journal de banque/i });
  });

  it('explique un journal vide sans le confondre avec des opérations bancaires', async () => {
    await login();
    await openBankJournal();
    fireEvent.change(screen.getByLabelText('Du'), { target: { value: '2099-01-01' } });

    expect(
      await screen.findByText(/Aucune écriture dans le journal de banque/i),
    ).toBeTruthy();
    expect(screen.getByText(/ne sont pas des écritures comptables/i)).toBeTruthy();
    expect(screen.getByRole('link', { name: /Voir les opérations importées/i })).toBeTruthy();

    window.location.hash = '#/accounting/journals/general';
    await screen.findByRole('heading', { name: /Opérations diverses/i });
    fireEvent.change(screen.getByLabelText('Du'), { target: { value: '2099-01-01' } });
    expect(await screen.findByText(/Aucune écriture validée sur la période/i)).toBeTruthy();
    expect(screen.queryByText(/ne sont pas des écritures comptables/i)).toBeNull();
  });

  it('propose le retour au journal après un import PDF confirmé', async () => {
    await login();
    await openBankJournal();
    fireEvent.click(screen.getByRole('link', { name: /Importer un relevé bancaire/i }));
    await screen.findByRole('heading', { name: /Banque & rapprochement/i });
    fireEvent.click(screen.getByRole('link', { name: /Importer un relevé PDF/i }));

    await screen.findByRole('heading', { name: /Importer un relevé bancaire PDF/i });
    const account = (await screen.findByLabelText(/Compte bancaire/i)) as HTMLSelectElement;
    expect(account.value).not.toBe('');
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, {
      target: {
        files: [
          new File(['%PDF-1.4 fictif'], 'releve-fictif.pdf', { type: 'application/pdf' }),
        ],
      },
    });
    fireEvent.click(screen.getByRole('button', { name: /Analyser/i }));
    await screen.findByText(/Banque détectée/i);
    fireEvent.click(screen.getByLabelText(/Je vérifie chaque ligne/i));
    fireEvent.click(screen.getByRole('button', { name: /Confirmer et importer/i }));

    const back = await screen.findByRole('link', { name: /Retour au Journal de banque/i });
    const view = screen.getByRole('link', { name: /Voir les opérations importées/i });
    const prepare = screen.getByRole('link', { name: /Préparer le rapprochement bancaire/i });
    expect(back.getAttribute('href')).toBe('#/accounting/journals/bank');
    expect(view.getAttribute('href')).toContain('tab=transactions');
    expect(view.getAttribute('href')).toContain('bankAccountId=');
    expect(prepare.getAttribute('href')).toContain('tab=report');
  });

  it('fournit les libellés anglais du bouton et du retour', async () => {
    await login();
    await openBankJournal();
    fireEvent.change(screen.getByLabelText(/Langue/i), { target: { value: 'en' } });
    expect(await screen.findByRole('heading', { name: /Bank journal/i })).toBeTruthy();
    const importLink = screen.getByRole('link', { name: /Import bank statement/i });
    expect(importLink).toBeTruthy();
    expect(screen.getByRole('button', { name: /Add entry/i })).toBeTruthy();

    fireEvent.click(importLink);
    await screen.findByRole('heading', { name: /Bank & reconciliation/i });
    expect(
      screen.getByRole('tab', { name: /Import a statement/i }).getAttribute('aria-selected'),
    ).toBe('true');
  });
});
