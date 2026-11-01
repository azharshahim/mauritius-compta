/**
 * Mission 44 — Accountant Workspace, browser demo.
 *
 * The full journey is exercised against the in-browser backend: portfolio,
 * guided creation, KYC checklist, sector, modules, review, activation, client
 * workspace and its eight domains. No network call is allowed.
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

async function loginFr() {
  localStorage.setItem('mc.locale', 'fr');
  renderApp();
  fireEvent.click(await screen.findByRole('button', { name: /Se connecter/i }));
  await screen.findByRole('heading', { name: /Tableau de bord Cabinet/i });
}

function setWidth(width: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width });
  fireEvent(window, new Event('resize'));
}

const defaultWidth = window.innerWidth;

const next = () => fireEvent.click(screen.getByRole('button', { name: /Étape suivante/i }));

/** The desktop portfolio table; the mobile card list is not mounted in jsdom. */
function portfolio() {
  const table = document.querySelector('.m44-table table') as HTMLElement;
  return within(table);
}

function rowOf(name: RegExp) {
  return portfolio().getByText(name).closest('tr') as HTMLElement;
}

describe('mission 44 — accountant workspace (demo)', () => {
  const fetchSpy = vi.fn();

  beforeEach(() => {
    resetDemo();
    localStorage.clear();
    fetchSpy.mockReset();
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    cleanup();
    setWidth(defaultWidth);
    vi.unstubAllGlobals();
  });

  it('shows the seven workspace indicators and the client portfolio', async () => {
    await loginFr();
    expect(screen.getByText(/Clients au total/i)).toBeTruthy();
    expect(screen.getByText(/Onboarding en cours/i)).toBeTruthy();
    expect(screen.getByText(/Revues en attente/i)).toBeTruthy();
    expect(screen.getByText(/Documents manquants/i)).toBeTruthy();
    expect(screen.getAllByText(/Exceptions comptables/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Échéances fiscales à venir/i)).toBeTruthy();
    // Seeded fictional clients appear with their onboarding status.
    expect(await portfolio().findByText(/Case Noyale Retail Ltd \(DEMO\)/i)).toBeTruthy();
    expect(portfolio().getAllByText(/du parcours/i).length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: /Nouveau client/i })).toBeTruthy();
    expect(screen.getAllByRole('link', { name: /Reprendre/i }).length).toBeGreaterThan(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('filters the portfolio by search and sector', async () => {
    await loginFr();
    const search = screen.getByLabelText(/Rechercher un client/i);
    fireEvent.change(search, { target: { value: 'Belle Mare' } });
    expect(await portfolio().findByText(/Belle Mare Hospitality Ltd \(DEMO\)/i)).toBeTruthy();
    expect(portfolio().queryByText(/Case Noyale Retail Ltd \(DEMO\)/i)).toBeNull();

    fireEvent.change(search, { target: { value: '' } });
    fireEvent.change(screen.getByLabelText(/Secteur d’activité/i), {
      target: { value: 'hospitality_tourism' },
    });
    await waitFor(() => expect(portfolio().getByText(/Belle Mare Hospitality Ltd \(DEMO\)/i)).toBeTruthy());
    expect(portfolio().queryByText(/Case Noyale Retail Ltd \(DEMO\)/i)).toBeNull();
  });

  it('runs the six-step assistant end to end and opens the new client workspace', async () => {
    await loginFr();
    fireEvent.click(screen.getByRole('link', { name: /Nouveau client/i }));
    await screen.findByRole('heading', { name: /Créer un nouveau client/i });

    // Step 1 — validation blocks an empty name.
    next();
    expect((await screen.findAllByText(/Ce champ est obligatoire/i)).length).toBeGreaterThan(0);
    fireEvent.change(screen.getByLabelText(/Raison sociale enregistrée/i), {
      target: { value: 'Fictional Test Trading Ltd' },
    });
    fireEvent.change(screen.getByLabelText(/Adresse du siège/i), {
      target: { value: '9, Fictional Street, Port Louis (fictional)' },
    });
    fireEvent.change(screen.getByLabelText(/E-mail de contact/i), {
      target: { value: 'contact@fictional-test.test' },
    });
    next();

    // Step 2 — KYC checklist, explicitly not a legal validation.
    await screen.findByText(/Liste de contrôle uniquement/i);
    expect(screen.getAllByText(/Identité de la société/i).length).toBeGreaterThan(0);
    const registrationSelect = screen.getByLabelText(
      /Certificat d’enregistrement de la société — Statut/i,
    );
    fireEvent.change(registrationSelect, { target: { value: 'received' } });
    next();

    // Step 3 — sector.
    fireEvent.click(await screen.findByRole('button', { name: /Commerce et distribution/i }));
    next();

    // Step 4 — accounting setup already carries honest defaults.
    await screen.findByText(/Seule la comptabilité d’engagement/i);
    expect(screen.getByText(/La comptabilité de trésorerie n’est pas implémentée/i)).toBeTruthy();
    next();

    // Step 5 — modules.
    await screen.findByText(/Sélectionnez les domaines applicables au client/i);
    expect(screen.getAllByText(/Disponible|Partiel/i).length).toBeGreaterThan(0);
    next();

    // Step 6 — review then activation.
    await screen.findByRole('heading', { name: /Revue et activation/i });
    expect(screen.getByText(/Fictional Test Trading Ltd/i)).toBeTruthy();
    expect(screen.getByText(/Aucune donnée à la MRA|ne transmet aucune donnée/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Activer le dossier client/i }));

    await screen.findByRole('heading', { name: /Fictional Test Trading Ltd/i });
    expect(window.location.hash).toContain('/workspace');
    // The eight domains are visible in the new workspace.
    expect(await screen.findByText(/Les huit domaines fonctionnels/i)).toBeTruthy();
    expect(screen.getAllByText(/Contrôles et équilibres/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Ventes et facturation électronique/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Base de connaissances et assistant IA/i).length).toBeGreaterThan(0);

    // Back to the portfolio: the new client is listed and the draft is gone.
    fireEvent.click(screen.getByRole('link', { name: /Retour au cabinet/i }));
    await screen.findByRole('heading', { name: /Tableau de bord Cabinet/i });
    expect(await portfolio().findByText(/Fictional Test Trading Ltd/i)).toBeTruthy();
    expect(document.querySelector('.m44-draft-list')?.textContent ?? '').not.toMatch(
      /Fictional Test Trading Ltd/,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('saves and resumes a draft', async () => {
    await loginFr();
    fireEvent.click(screen.getByRole('link', { name: /Nouveau client/i }));
    await screen.findByRole('heading', { name: /Créer un nouveau client/i });
    fireEvent.change(screen.getByLabelText(/Raison sociale enregistrée/i), {
      target: { value: 'Draft Fictional Services Ltd' },
    });
    fireEvent.change(screen.getByLabelText(/Adresse du siège/i), {
      target: { value: '1, Draft Street (fictional)' },
    });
    fireEvent.click(screen.getAllByRole('button', { name: /Enregistrer le brouillon/i })[0]!);
    await screen.findByText(/Brouillon enregistré/i);

    // Cancelling returns to the cabinet where the draft can be resumed.
    fireEvent.click(screen.getByRole('button', { name: /Annuler/i }));
    await screen.findByRole('heading', { name: /Tableau de bord Cabinet/i });
    expect(await screen.findByText(/Draft Fictional Services Ltd/i)).toBeTruthy();
    fireEvent.click(screen.getAllByRole('link', { name: /Reprendre/i })[0]!);
    await screen.findByRole('heading', { name: /Créer un nouveau client/i });
    await waitFor(() =>
      expect((screen.getByLabelText(/Raison sociale enregistrée/i) as HTMLInputElement).value).toBe(
        'Draft Fictional Services Ltd',
      ),
    );
  });

  it('opens a client workspace and updates its KYC checklist', async () => {
    await loginFr();
    await portfolio().findByText(/Belle Mare Hospitality Ltd \(DEMO\)/i);
    fireEvent.click(within(rowOf(/Belle Mare Hospitality Ltd \(DEMO\)/i)).getByRole('link', { name: /Ouvrir le client/i }));

    await screen.findByRole('heading', { name: /Belle Mare Hospitality Ltd \(DEMO\)/i });
    expect(screen.getAllByText(/Partiel/i).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('link', { name: /Onboarding et KYC/i }));

    await screen.findByText(/Liste de contrôle KYC/i);
    const select = screen.getByLabelText(/Registre des administrateurs/i);
    fireEvent.change(select, { target: { value: 'verified' } });
    await waitFor(() =>
      expect((screen.getByLabelText(/Registre des administrateurs/i) as HTMLSelectElement).value).toBe(
        'verified',
      ),
    );
    expect(screen.getByText(/Liste de contrôle uniquement/i)).toBeTruthy();
  });

  it('renders the workspace navigation with the requested sections', async () => {
    await loginFr();
    await portfolio().findByText(/Case Noyale Retail Ltd \(DEMO\)/i);
    fireEvent.click(within(rowOf(/Case Noyale Retail Ltd \(DEMO\)/i)).getByRole('link', { name: /Ouvrir le client/i }));
    await screen.findByRole('heading', { name: /Case Noyale Retail Ltd \(DEMO\)/i });
    const nav = screen.getByRole('navigation', { name: /Navigation du dossier client/i });
    for (const label of [
      'Vue d’ensemble',
      'Tâches',
      'Onboarding et KYC',
      'Comptabilité',
      'Ventes',
      'Achats',
      'Banque',
      'Paie',
      'Immobilisations',
      'Stocks',
      'Fiscalité',
      'Rapports',
      'Documents',
      'Assistant IA',
    ]) {
      expect(within(nav).getByRole('link', { name: label })).toBeTruthy();
    }
  });

  it('switches the active company before opening accounting from another client workspace', async () => {
    await loginFr();
    const previous = localStorage.getItem('mc.companyId');
    await portfolio().findByText(/Belle Mare Hospitality Ltd \(DEMO\)/i);
    fireEvent.click(within(rowOf(/Belle Mare Hospitality Ltd \(DEMO\)/i)).getByRole('link', { name: /Ouvrir le client/i }));
    await screen.findByRole('heading', { name: /Belle Mare Hospitality Ltd/i });
    const targetId = window.location.hash.split('/clients/')[1]!.split('/')[0]!;
    expect(targetId).not.toBe(previous);
    fireEvent.click(within(screen.getByRole('navigation', { name: /Navigation du dossier client/i })).getByRole('link', { name: 'Comptabilité' }));
    await screen.findByRole('button', { name: 'Plan comptable' });
    fireEvent.click(screen.getByRole('button', { name: 'Plan comptable' }));
    await waitFor(() => expect(window.location.hash).toContain('/accounting/accounts'));
    expect(localStorage.getItem('mc.companyId')).toBe(targetId);
  });

  it('switches the whole journey to English', async () => {
    await loginFr();
    fireEvent.change(screen.getByRole('combobox', { name: /Langue|Language/i }), {
      target: { value: 'en' },
    });
    expect(await screen.findByText(/Total clients/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('link', { name: /Create New Client/i }));
    await screen.findByRole('heading', { name: /^Create New Client$/i });
    expect(screen.getByText(/Six-step guided journey/i)).toBeTruthy();
    expect(screen.getByLabelText(/Registered business name/i)).toBeTruthy();
    expect(screen.getAllByText(/Optional/i).length).toBeGreaterThan(0);
  });

  it('renders the mobile card list instead of the wide table', async () => {
    setWidth(390);
    await loginFr();
    await screen.findByRole('heading', { name: /Tableau de bord Cabinet/i });
    expect(document.querySelector('.m44-table')).toBeNull();
    const cards = document.querySelector('.m44-client-cards') as HTMLElement;
    expect(cards).toBeTruthy();
    expect(within(cards).getByText(/Case Noyale Retail Ltd \(DEMO\)/i)).toBeTruthy();
    expect(within(cards).getAllByRole('link', { name: /Ouvrir le client/i }).length).toBeGreaterThan(0);

    // The wizard keeps its single-column layout on a phone.
    fireEvent.click(screen.getByRole('link', { name: /Nouveau client/i }));
    await screen.findByRole('heading', { name: /Créer un nouveau client/i });
    expect(document.querySelector('.m44-wizard')).toBeTruthy();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
