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

async function login() {
  renderApp();
  const button = await screen.findByRole('button', { name: /Se connecter/i });
  fireEvent.click(button);
  await screen.findByRole('heading', { name: /Tableau de bord/i });
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

  it('signs in, navigates the hash router and never calls the network', async () => {
    await login();
    expect(navLink(/Écritures/)).toBeTruthy();

    fireEvent.click(navLink(/Écritures/));
    await screen.findByRole('heading', { name: /Écritures/ });
    expect(await screen.findByText(/Facture de vente fictive FA-2025-001/)).toBeTruthy();
    expect(window.location.hash).toBe('#/entries');

    fireEvent.click(navLink(/Balance/));
    await screen.findByRole('heading', { name: /Balance générale/ });
    expect(await screen.findByText(/Balance équilibrée/)).toBeTruthy();

    fireEvent.click(navLink(/États financiers/));
    await screen.findByRole('heading', { name: /États financiers/ });
    expect(await screen.findByText(/Situation financière/)).toBeTruthy();

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('captures a new entry in the browser demo', async () => {
    await login();
    fireEvent.click(navLink(/Écritures/));
    await screen.findByRole('heading', { name: /Écritures/ });

    const newButton = screen.getByRole('button', { name: /Nouvelle écriture/ });
    await waitFor(() => expect((newButton as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(newButton);

    const dialog = await screen.findByRole('dialog');
    const selects = within(dialog).getAllByRole('combobox') as HTMLSelectElement[];
    // selects[0] = journal, selects[1] = currency, selects[2..] = accounts
    fireEvent.change(selects[0]!, { target: { value: selects[0]!.options[0]!.value } });
    const accountSelects = selects.slice(2);
    // Option 0 is the placeholder, option 1 the first real account.
    fireEvent.change(accountSelects[0]!, { target: { value: accountSelects[0]!.options[1]!.value } });
    fireEvent.change(accountSelects[1]!, { target: { value: accountSelects[1]!.options[2]!.value } });

    const description = within(dialog).getByLabelText(/Libellé|Description/i) as HTMLInputElement;
    fireEvent.change(description, { target: { value: 'Écriture saisie dans la démo' } });

    const debits = within(dialog).getAllByLabelText(/^Débit$/i) as HTMLInputElement[];
    const credits = within(dialog).getAllByLabelText(/^Crédit$/i) as HTMLInputElement[];
    fireEvent.change(debits[0]!, { target: { value: '250.50' } });
    fireEvent.change(credits[1]!, { target: { value: '250.50' } });

    fireEvent.click(within(dialog).getByRole('button', { name: /Enregistrer et valider/i }));

    await waitFor(() => {
      const stillOpen = screen.queryByRole('dialog');
      if (stillOpen) {
        const alert = stillOpen.querySelector('.alert-error');
        if (alert) throw new Error(`Erreur affichée : ${alert.textContent}`);
      }
      expect(stillOpen).toBeNull();
    });
    expect(await screen.findByText('Écriture saisie dans la démo')).toBeTruthy();
  });

  it('switches FR <-> EN and opens the mobile navigation drawer', async () => {
    await login();
    const language = screen.getByLabelText(/Langue/i);
    fireEvent.change(language, { target: { value: 'en' } });
    expect(await screen.findByRole('link', { name: 'Dashboard' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/Language/i), { target: { value: 'fr' } });
    expect(await screen.findByRole('link', { name: /Tableau de bord/ })).toBeTruthy();

    const menu = screen.getByRole('button', { name: /Menu/ });
    fireEvent.click(menu);
    const drawer = document.querySelector('.sidebar');
    expect(drawer?.className).toContain('open');
    fireEvent.click(navLink(/Sociétés/));
    await screen.findByRole('heading', { name: /Sociétés/ });
    await waitFor(() => expect(document.querySelector('.sidebar')?.className).not.toContain('open'));
  });

  it('creates a company from the demo build', async () => {
    await login();
    fireEvent.click(navLink(/Sociétés/));
    await screen.findByRole('heading', { name: /Sociétés/ });
    fireEvent.click(screen.getByRole('button', { name: /Nouvelle société/ }));

    const dialog = await screen.findByRole('dialog');
    const name = within(dialog).getByLabelText(/^Nom$/i) as HTMLInputElement;
    fireEvent.change(name, { target: { value: 'Société démo créée dans Chrome' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /Enregistrer/i }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const matches = await screen.findAllByText('Société démo créée dans Chrome');
    expect(matches.length).toBeGreaterThan(0);
  });
});
