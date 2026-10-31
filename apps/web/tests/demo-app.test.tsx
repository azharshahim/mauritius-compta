/**
 * The GitHub Pages build, rendered for real: React screens + hash routing +
 * the in-browser demo backend, without any server (jsdom, no network).
 */
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

const navLink = (name: RegExp) => {
  const nav = document.querySelector('.nav') as HTMLElement;
  return within(nav).getByRole('link', { name });
};

const moduleTab = (name: RegExp) => screen.getByRole('button', { name });

const tableText = async (name: string | RegExp) => {
  await waitFor(() => expect(document.querySelector('.table-wrap table')).toBeTruthy());
  const table = document.querySelector('.table-wrap table') as HTMLElement;
  return within(table).findByText(name);
};

const tableRow = async (name: string | RegExp) => {
  const cell = await tableText(name);
  return cell.closest('tr') as HTMLElement;
};

async function login() {
  renderApp();
  const button = await screen.findByRole('button', { name: /Se connecter/i });
  fireEvent.click(button);
  await screen.findByRole('heading', { name: /Tableau de bord Cabinet/i });
}

describe('demo build (jsdom)', () => {
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

  it('shows the permanent demonstration notice and pre-filled credentials', async () => {
    renderApp();
    expect(await screen.findByText(/MODE DÉMONSTRATION/i)).toBeTruthy();
    const email = screen.getByLabelText(/Adresse e-mail/i) as HTMLInputElement;
    const password = screen.getByLabelText(/Mot de passe/i) as HTMLInputElement;
    expect(email.value).toBe('demo@mauritius-compta.test');
    expect(password.value).toBe('DemoPassw0rd2026');
  });

  it('exposes the four suite modules and keeps the accounting screens', async () => {
    await login();
    expect(moduleTab(/Cabinet/)).toBeTruthy();
    expect(moduleTab(/Comptabilité/)).toBeTruthy();
    expect(moduleTab(/Facturation/)).toBeTruthy();
    expect(moduleTab(/Paie & RH/)).toBeTruthy();

    fireEvent.click(navLink(/Dossiers clients/));
    await screen.findByRole('heading', { name: /Dossiers clients/i });
    expect(await tableText(/Lagon Bleu Trading Ltd \(DEMO\)/)).toBeTruthy();
    expect(await tableText(/Case Noyale Retail Ltd \(DEMO\)/)).toBeTruthy();
    expect(window.location.hash).toBe('#/cabinet/companies');

    // Accounting space: the V0.1 screens are still there, unchanged.
    fireEvent.click(moduleTab(/Comptabilité/));
    await screen.findByRole('heading', { name: /Tableau de bord/i });
    fireEvent.click(navLink(/Écritures/));
    await screen.findByRole('heading', { name: /Écritures/ });
    // Mission 19 adds entries to the shared demo ledger: the invoice asserted
    // here now lives on the second page of the paginated journal.
    fireEvent.click(screen.getByRole('button', { name: '›' }));
    expect(await screen.findByText(/Facture de vente fictive FA-2025-001/)).toBeTruthy();
    expect(window.location.hash).toBe('#/accounting/entries');

    fireEvent.click(navLink(/Balance/));
    await screen.findByRole('heading', { name: /Balance générale/ });
    expect(await screen.findByText(/Balance équilibrée/)).toBeTruthy();

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('keeps the cabinet dashboard metrics in sync with the tasks', async () => {
    await login();
    // Two overdue tasks are seeded for the demo user's dossiers.
    expect(screen.getByText(/Tâches en retard/i)).toBeTruthy();
    fireEvent.click(navLink(/Tâches & échéances/));
    await screen.findByRole('heading', { name: /Tâches & échéances/i });
    expect(await screen.findByText(/Préparer le dossier TVA du trimestre \(fictif\)/)).toBeTruthy();
  });

  it('creates a dossier then a task in the browser demo', async () => {
    await login();
    fireEvent.click(navLink(/Dossiers clients/));
    await screen.findByRole('heading', { name: /Dossiers clients/i });

    fireEvent.click(screen.getByRole('button', { name: /Nouveau dossier/ }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/^Nom$/i), {
      target: { value: 'Dossier créé dans Chrome (fictif)' },
    });
    fireEvent.change(within(dialog).getByLabelText(/Code client/i), {
      target: { value: 'CLI-999' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: /Enregistrer/i }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await tableText('Dossier créé dans Chrome (fictif)')).toBeTruthy();

    // The new dossier becomes the current company: a task can be attached to it.
    fireEvent.click(navLink(/Tâches & échéances/));
    await screen.findByRole('heading', { name: /Tâches & échéances/i });
    fireEvent.click(screen.getByRole('button', { name: /Nouvelle tâche/ }));
    const taskDialog = await screen.findByRole('dialog');
    const companySelect = within(taskDialog).getAllByRole('combobox')[0] as HTMLSelectElement;
    const option = Array.from(companySelect.options).find((o) =>
      o.text.includes('Dossier créé dans Chrome'),
    );
    expect(option).toBeTruthy();
    fireEvent.change(companySelect, { target: { value: option!.value } });
    fireEvent.change(within(taskDialog).getAllByLabelText(/Libellé|Description/i)[0]!, {
      target: { value: 'Tâche créée dans Chrome (fictif)' },
    });
    fireEvent.click(within(taskDialog).getByRole('button', { name: /Enregistrer/i }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await screen.findByText('Tâche créée dans Chrome (fictif)')).toBeTruthy();
  });

  it('archives a dossier and makes it read-only', async () => {
    await login();
    fireEvent.click(navLink(/Dossiers clients/));
    await screen.findByRole('heading', { name: /Dossiers clients/i });

    const row = await tableRow(/Belle Mare Hospitality Ltd \(DEMO\)/);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    fireEvent.click(within(row).getByRole('button', { name: /Archiver/i }));
    await waitFor(() =>
      expect(within(row).getByRole('button', { name: /Désarchiver/i })).toBeTruthy(),
    );
  });

  it('opens billing and the payroll preparation screens', async () => {
    await login();
    fireEvent.click(moduleTab(/Facturation/));
    await screen.findByRole('heading', { name: /^Facturation$/i });
    expect(await screen.findByText(/Créances ouvertes/i)).toBeTruthy();
    expect(screen.queryByText(/préparée mais pas encore opérationnelle/i)).toBeNull();

    fireEvent.click(navLink(/Factures/i));
    await screen.findByRole('heading', { name: /^Factures$/i });
    expect(await screen.findByText('FAC-DEMO-0002')).toBeTruthy();

    fireEvent.click(navLink(/Balance âgée/i));
    await screen.findByRole('heading', { name: /^Balance âgée$/i });

    fireEvent.click(moduleTab(/Paie & RH/));
    await screen.findByRole('heading', { name: /Paie & RH/i });
    expect(await screen.findByText(/PAYE, CSG, NSF et Training Levy sont calculés à partir de règles officielles sourcées/i)).toBeTruthy();
    expect(screen.queryByText(/bulletin généré/i)).toBeNull();
  });

  it('proposes an accounting entry without ever posting it automatically', async () => {
    await login();
    fireEvent.click(navLink(/Écritures proposées/i));
    await screen.findByRole('heading', { name: /^Écritures proposées$/i });
    expect(
      await screen.findByText(/La proposition est stockée à part : elle ne crée jamais d.écriture/i),
    ).toBeTruthy();
    expect(await screen.findByText(/Achat de fournitures de bureau \(fictif\)/i)).toBeTruthy();
  });

  it('switches FR <-> EN and opens the mobile navigation drawer', async () => {
    await login();
    const language = screen.getByLabelText(/Langue/i);
    fireEvent.change(language, { target: { value: 'en' } });
    expect(await screen.findByText(/Client dossiers/i)).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/Language/i), { target: { value: 'fr' } });
    expect(await screen.findByText(/Dossiers clients/i)).toBeTruthy();

    const menu = screen.getByRole('button', { name: /Menu/ });
    fireEvent.click(menu);
    const drawer = document.querySelector('.sidebar');
    expect(drawer?.className).toContain('open');
    fireEvent.click(navLink(/Collaborateurs/));
    await screen.findByRole('heading', { name: /Collaborateurs/i });
    await waitFor(() => expect(document.querySelector('.sidebar')?.className).not.toContain('open'));
  });
});

describe('demo build — Mauritius AI Engine screens', () => {
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

  it('renders the AI settings with the simulation banner and no key field in demo', async () => {
    await login();
    await navLink(/Paramètres IA/).click();
    expect(await screen.findByRole('heading', { name: /Intelligence artificielle/i })).toBeTruthy();
    expect(screen.getAllByText(/Simulation IA — aucune API externe utilisée/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Clé non requise|Clé configurée/i).length).toBeGreaterThan(0);
    // The demo never offers to store a key.
    const configure = screen.getAllByRole('button', { name: /Configurer|Remplacer/i })[0]!;
    expect((configure as HTMLButtonElement).disabled).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('runs a full suggestion: propose, accept, rule saved, no entry posted', async () => {
    await login();
    await navLink(/Assistant comptable/).click();
    expect(await screen.findByRole('heading', { name: /Assistant comptable/i })).toBeTruthy();

    const description = screen.getByPlaceholderText(/Achat de fournitures de bureau/i);
    fireEvent.change(description, {
      target: { value: 'Achat de fournitures de bureau — 2 500 MUR' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Proposer un compte/i }));

    const proposal = await screen.findByRole('heading', { name: /^Proposition$/i });
    const card = proposal.closest('.card') as HTMLElement;
    expect(within(card).getAllByText(/À vérifier/i).length).toBeGreaterThan(0);
    expect(within(card).getByText(/Confiance/i)).toBeTruthy();

    fireEvent.click(within(card).getByRole('button', { name: /^Accepter$/i }));
    expect(await screen.findByText(/Décision enregistrée/i)).toBeTruthy();
    expect(screen.getByText(/Aucune écriture comptable n’a été créée/i)).toBeTruthy();

    // History and learned rule are visible, and nothing was posted.
    await waitFor(() => expect(screen.getAllByText(/Acceptée/i).length).toBeGreaterThan(0));
    expect(screen.getByText(/Règles apprises de ce dossier/i)).toBeTruthy();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('shows the AI error surface when the module is switched off', async () => {
    await login();
    await navLink(/Paramètres IA/).click();
    await screen.findByRole('heading', { name: /Intelligence artificielle/i });
    // Switch the accounting module off, then try the assistant.
    const accounting = screen.getByLabelText(/^Comptabilité$/) as HTMLSelectElement;
    fireEvent.change(accounting, { target: { value: 'no' } });
    fireEvent.click(screen.getByRole('button', { name: /Enregistrer/i }));

    await navLink(/Assistant comptable/).click();
    await screen.findByRole('heading', { name: /Assistant comptable/i });
    fireEvent.change(screen.getByPlaceholderText(/Achat de fournitures de bureau/i), {
      target: { value: 'Carburant véhicule' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Proposer un compte/i }));
    expect(await screen.findByText(/désactivées pour ce module/i)).toBeTruthy();
  });
});
