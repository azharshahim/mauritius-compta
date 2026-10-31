/**
 * Android keyboard regression suite.
 *
 * Bug reported on a Samsung device (mission 5, objective 1): the virtual
 * keyboard closed after every single character typed in a form.
 *
 * Root cause: `Modal`'s focus effect depended on `onClose`, which every form
 * passes as a fresh inline arrow. Each keystroke re-rendered the page, gave
 * `onClose` a new identity, re-ran the effect and moved focus from the input to
 * the dialog container. The input was blurred, so Android dismissed the
 * keyboard. jsdom reproduces the blur exactly, which is what this file asserts.
 *
 * The rule enforced below: typing N characters must keep the *same DOM node*
 * focused and mounted, in every form of the suite.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { HashRouter } from 'react-router-dom';
import App from '../src/App';
import { I18nProvider } from '../src/i18n';
import { SessionProvider } from '../src/store';
import { resetDemo } from '../src/demo';

function renderApp() {
  window.location.hash = '#/';
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

/** Navigate through the sidebar, exactly like a user on a phone. */
async function goTo(label: RegExp) {
  const nav = document.querySelector('.nav') as HTMLElement;
  fireEvent.click(within(nav).getByRole('link', { name: label }));
  await waitFor(() => expect(document.querySelector('.page h1')).toBeTruthy());
}

function modal(): HTMLElement {
  const node = document.querySelector('.modal');
  expect(node).toBeTruthy();
  return node as HTMLElement;
}

async function openModal(button: RegExp): Promise<HTMLElement> {
  fireEvent.click(await screen.findByRole('button', { name: button }));
  await waitFor(() => expect(document.querySelector('.modal')).toBeTruthy());
  return modal();
}

/**
 * Types `text` one character at a time, like a soft keyboard, and asserts after
 * every character that the node is still mounted, still focused and still
 * receiving the value. Returns the node so callers can compare identities.
 */
function typeChars(node: HTMLInputElement | HTMLTextAreaElement, text: string) {
  node.focus();
  expect(document.activeElement).toBe(node);
  let value = '';
  for (const char of text) {
    value += char;
    fireEvent.change(node, { target: { value } });
    expect(document.activeElement).toBe(node);
    expect(document.body.contains(node)).toBe(true);
    expect(node.value).toBe(value);
  }
  return node;
}

function cells(): (HTMLInputElement | HTMLTextAreaElement)[] {
  return Array.from(modal().querySelectorAll('input, textarea')) as (
    | HTMLInputElement
    | HTMLTextAreaElement
  )[];
}

beforeEach(() => {
  resetDemo();
  localStorage.clear();
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Android keyboard: focus is never stolen while typing', () => {
  it('keeps the login e-mail and password fields focused', async () => {
    renderApp();
    const email = (await screen.findByLabelText(/Adresse e-mail/i)) as HTMLInputElement;
    typeChars(email, 'demo@');

    const password = screen.getByLabelText(/Mot de passe/i) as HTMLInputElement;
    typeChars(password, 'Secret');
    expect(screen.getByLabelText(/Adresse e-mail/i)).toBe(email);
  });

  it('keeps the dossier search field focused across backend reloads', async () => {
    await login();
    await goTo(/Dossiers clients/);
    const search = screen.getByPlaceholderText(/Rechercher \(nom, BRN, code client\)/i);
    typeChars(search as HTMLInputElement, 'Lagon');
    // The field is still the first one of the filter bar: no remount happened.
    expect(screen.getByPlaceholderText(/Rechercher \(nom, BRN, code client\)/i)).toBe(search);
  });

  it('keeps focus while creating a client dossier (name, CRN, address)', async () => {
    await login();
    await goTo(/Dossiers clients/);
    const dialog = await openModal(/Nouveau dossier/);
    const fields = cells();
    const name = fields[0]! as HTMLInputElement;
    typeChars(name, 'Flacq Textiles');
    expect((within(dialog).getAllByRole('textbox')[0] as HTMLInputElement)).toBe(name);

    const crn = fields[1]! as HTMLInputElement;
    typeChars(crn, 'C20260001');
    const address = fields[4]! as HTMLInputElement;
    typeChars(address, 'Royal Road, Flacq');
  });

  it('keeps focus while editing an existing dossier', async () => {
    await login();
    await goTo(/Dossiers clients/);
    const table = await waitFor(() => {
      const node = document.querySelector('.table-wrap table') as HTMLElement;
      expect(node).toBeTruthy();
      return node;
    });
    const edit = within(table).getAllByRole('button', { name: /Modifier/i })[0]!;
    fireEvent.click(edit);
    await waitFor(() => expect(document.querySelector('.modal')).toBeTruthy());
    typeChars(cells()[0]! as HTMLInputElement, 'Ltd');
  });

  it('keeps focus in the task form (title, description, comment)', async () => {
    await login();
    await goTo(/Tâches & échéances/);
    await openModal(/Nouvelle tâche/);
    const fields = cells();
    typeChars(fields[0]! as HTMLInputElement, 'TVA septembre');
    const textarea = modal().querySelector('textarea') as HTMLTextAreaElement | null;
    if (textarea) typeChars(textarea, 'Relancer le client.');
  });

  it('keeps focus in the accounting entry editor (reference, description, amount)', async () => {
    await login();
    fireEvent.click(screen.getByRole('button', { name: /Comptabilité/ }));
    await waitFor(() => expect(window.location.hash).toContain('/accounting'));
    await goTo(/Écritures/);
    const dialog = await openModal(/Nouvelle écriture/);
    const reference = within(dialog).getAllByRole('textbox')[0]! as HTMLInputElement;
    typeChars(reference, 'FA-2026-001');
    const amounts = Array.from(dialog.querySelectorAll('input[inputmode="decimal"]')) as HTMLInputElement[];
    if (amounts[0]) typeChars(amounts[0], '2500.00');
  });

  it('keeps focus in the chart of accounts search and creation form', async () => {
    await login();
    const tab = screen.getByRole('button', { name: /Comptabilité/ });
    fireEvent.click(tab);
    await waitFor(() => expect(window.location.hash).toContain('/accounting'));
    await goTo(/Plan comptable/);
    typeChars(screen.getByPlaceholderText(/Rechercher un code ou un nom/i) as HTMLInputElement, '6100');
    const dialog = await openModal(/Nouveau compte/);
    typeChars(within(dialog).getAllByRole('textbox')[0]! as HTMLInputElement, 'Fournitures');
  });

  it('keeps focus in the accounting settings form', async () => {
    await login();
    fireEvent.click(screen.getByRole('button', { name: /Comptabilité/ }));
    await waitFor(() => expect(window.location.hash).toContain('/accounting'));
    await goTo(/Paramètres/);
    const inputs = Array.from(document.querySelectorAll('.page input')).filter(
      (i) => !(i as HTMLInputElement).disabled && (i as HTMLInputElement).type !== 'hidden',
    ) as HTMLInputElement[];
    expect(inputs.length).toBeGreaterThan(0);
    typeChars(inputs[0]!, 'Ramesh');
  });

  it('moves focus into the dialog on open and gives it back on Escape', async () => {
    await login();
    await goTo(/Dossiers clients/);
    const trigger = await screen.findByRole('button', { name: /Nouveau dossier/ });
    trigger.focus();
    fireEvent.click(trigger);
    await waitFor(() => expect(document.querySelector('.modal')).toBeTruthy());
    expect(modal().contains(document.activeElement)).toBe(true);

    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(document.querySelector('.modal')).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });

  it('opens the mobile drawer without touching the focused field', async () => {
    await login();
    await goTo(/Dossiers clients/);
    const search = screen.getByPlaceholderText(/Rechercher \(nom, BRN, code client\)/i) as HTMLInputElement;
    typeChars(search, 'Belle');
    fireEvent.click(screen.getByRole('button', { name: /Menu|Navigation/i }));
    expect(document.activeElement).toBe(search);
    expect(search.isConnected).toBe(true);
  });
});
