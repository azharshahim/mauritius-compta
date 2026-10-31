/**
 * Écran Banque & rapprochement — parcours réel du build de démonstration.
 *
 * Aucun réseau : le fichier fictif est lu depuis `public/samples`, importé par
 * le backend embarqué, puis les transactions sont affichées et ouvertes. Le
 * bandeau de démonstration est vérifié comme un petit indicateur d'en-tête,
 * jamais comme une barre fixe masquant les commandes Android.
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

describe('banque & rapprochement (démo)', () => {
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

  it('importe le relevé fictif et ouvre une transaction sans réseau', async () => {
    await login();
    window.location.hash = '#/accounting/banking';
    await screen.findByRole('heading', { name: /Banque & rapprochement/i });

    expect(await screen.findByText(/Compte courant principal \(démo\)/i)).toBeTruthy();
    expect(screen.getByText(/Compte devises \(démo\)/i)).toBeTruthy();
    expect(screen.getAllByText(/•••• 1234/).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('tab', { name: /Importer un relevé/i }));
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    // Samsung My Files filtre par MIME : le CSV doit rester sélectionnable même
    // lorsqu'Android annonce text/comma-separated-values ou octet-stream.
    expect(input.accept).toContain('.csv');
    expect(input.accept).toContain('.txt');
    expect(input.accept).toContain('text/comma-separated-values');
    expect(input.accept).toContain('application/octet-stream');
    fireEvent.change(input, {
      target: { files: [makeFile(sample, 'releve-bancaire-fictif.csv')] },
    });

    await screen.findByRole('heading', { name: /Synthèse/i });
    expect(await screen.findByText(/125000\.0000/)).toBeTruthy();
    expect(screen.queryByText(/Import bloqué/i)).toBeNull();
    const confirm = screen.getByRole('button', { name: /Confirmer l’import/i }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.click(screen.getByLabelText(/Je vérifie la proposition/i));
    expect(confirm.disabled).toBe(false);
    fireEvent.click(confirm);

    await waitFor(() =>
      expect(screen.getByRole('tab', { name: /Transactions/i }).getAttribute('aria-selected')).toBe(
        'true',
      ),
    );
    expect((await screen.findAllByText(/Virement salaires août/i)).length).toBeGreaterThanOrEqual(1);
    expect(document.querySelectorAll('.bank-txn-card').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/Rapproché|Non rapproché|Partiellement affectée/).length).toBeGreaterThan(0);
    expect((await screen.findAllByText(/Frais de tenue de compte/i)).length).toBeGreaterThanOrEqual(1);

    const rows = screen.getAllByRole('row');
    const salaryRow = rows.find((row) => row.textContent?.includes('Virement salaires août'))!;
    fireEvent.click(withinRow(salaryRow, /Ouvrir/i));
    expect((await screen.findAllByText(/Libellé de paie détecté/i)).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/aucune paie (n’est )?calculée/i).length).toBeGreaterThan(0);

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('refuse un faux format après sélection sans appeler l’import', async () => {
    await login();
    window.location.hash = '#/accounting/banking';
    await screen.findByRole('heading', { name: /Banque & rapprochement/i });
    fireEvent.click(screen.getByRole('tab', { name: /Importer un relevé/i }));
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const pdf = new File(['%PDF-1.4 fictif'], 'facture.pdf', { type: 'application/pdf' });
    fireEvent.change(input, { target: { files: [pdf] } });
    expect(await screen.findByText(/Format non pris en charge/i)).toBeTruthy();
    expect(screen.queryByRole('heading', { name: /Synthèse/i })).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('associe un règlement client depuis le panneau de détail (scénario B)', async () => {
    await login();
    window.location.hash = '#/accounting/banking';
    await screen.findByRole('heading', { name: /Banque & rapprochement/i });
    fireEvent.click(screen.getByRole('tab', { name: /Transactions/i }));
    await screen.findAllByText(/Scénario B — règlement partiel/i);

    const row = screen
      .getAllByRole('row')
      .find((candidate) => candidate.textContent?.includes('Scénario B — règlement partiel'))!;
    fireEvent.click(withinRow(row, /Ouvrir/i));
    expect(await screen.findByText(/Règlements clients liés/i)).toBeTruthy();
    expect(screen.getByText(/Restant à affecter sur la transaction/i)).toBeTruthy();

    const paymentNumber = await screen.findByText(/REC-DEMO-B1/);
    const label = paymentNumber.closest('label')!;
    const radio = label.querySelector('input[type="radio"]') as HTMLInputElement;
    fireEvent.click(radio);
    fireEvent.click(screen.getAllByLabelText(/Je vérifie la proposition/i)[0]!);
    fireEvent.click(screen.getByRole('button', { name: /Associer ce règlement/i }));

    expect((await screen.findAllByText(/Règlement associé/i)).length).toBeGreaterThan(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('affiche des cartes mobiles et masque le tableau étroit sous 640 px', () => {
    const css = readFileSync(resolve(process.cwd(), 'src', 'styles.css'), 'utf8');
    expect(css).toMatch(/\.bank-txn-cards \{ display: none;/);
    expect(css).toMatch(/@media \(max-width: 640px\)[\s\S]*\.bank-txn-table \{ display: none; \}[\s\S]*\.bank-txn-cards \{ display: flex;/);
    expect(css).toMatch(/\.bank-txn-card \.amount-in[\s\S]*white-space: normal/);
  });

  it('garde un indicateur Démo compact et accessible dans l’en-tête', async () => {
    await login();
    const chip = screen.getByRole('button', { name: /MODE DÉMONSTRATION/i });
    expect(chip.closest('.topbar')).toBeTruthy();
    expect(document.querySelector('.demo-banner')).toBeNull();
    fireEvent.click(chip);
    expect(await screen.findByRole('dialog', { name: /MODE DÉMONSTRATION/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Réinitialiser la démo/i })).toBeTruthy();
  });
});

function withinRow(row: HTMLElement, name: RegExp) {
  const button = Array.from(row.querySelectorAll('button')).find((b) => name.test(b.textContent ?? ''));
  if (!button) throw new Error('Button not found in row');
  return button;
}
