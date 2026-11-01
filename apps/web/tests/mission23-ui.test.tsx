/** Mission 23 screens — bilingual chart, document intake and MCB preview (demo). */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

describe('mission 23 — plan comptable bilingue (démo)', () => {
  const fetchSpy = vi.fn();
  beforeEach(() => { resetDemo(); localStorage.clear(); fetchSpy.mockReset(); vi.stubGlobal('fetch', fetchSpy); });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it('affiche le statut provisoire et change les libellés sans changer les numéros', async () => {
    await loginAndSelect();
    window.location.hash = '#/accounting/accounts';
    expect(await screen.findByRole('heading', { name: /^Plan comptable$/ })).toBeTruthy();
    expect((await screen.findAllByText(/PENDING PROFESSIONAL VALIDATION/)).length).toBeGreaterThanOrEqual(1);
    expect((await screen.findAllByText('1010')).length).toBeGreaterThanOrEqual(1);
    expect((await screen.findAllByText(/Banque — compte courant MUR/)).length).toBeGreaterThanOrEqual(1);

    const language = screen.getByRole('combobox', { name: /Langue/i });
    fireEvent.change(language, { target: { value: 'en' } });
    expect(await screen.findByRole('heading', { name: /Chart of Accounts/ })).toBeTruthy();
    expect((await screen.findAllByText(/Bank — current account MUR/)).length).toBeGreaterThanOrEqual(1);
    expect((await screen.findAllByText('1010')).length).toBeGreaterThanOrEqual(1);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('mission 23 — scan et import (démo)', () => {
  const fetchSpy = vi.fn();
  beforeEach(() => { resetDemo(); localStorage.clear(); fetchSpy.mockReset(); vi.stubGlobal('fetch', fetchSpy); });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it('liste les documents fictifs, le doublon et avoue l’extraction préenregistrée', async () => {
    await loginAndSelect();
    window.location.hash = '#/documents';
    expect(await screen.findByRole('heading', { name: /Documents — consultation et archives/i })).toBeTruthy();
    expect(await screen.findByText(/résultats d’extraction affichés sont préenregistrés/i)).toBeTruthy();
    expect((await screen.findAllByText(/INV-2026-101/)).length).toBeGreaterThanOrEqual(1);
    expect((await screen.findAllByText(/Doublon possible/)).length).toBeGreaterThanOrEqual(1);
    expect((await screen.findAllByText(/PLH-2210/)).length).toBeGreaterThanOrEqual(1);

    const buttons = await screen.findAllByRole('button', { name: /INV-2026-101/ });
    fireEvent.click(buttons[0]!);
    expect(await screen.findByText(/Données extraites et corrections/i)).toBeTruthy();
    expect((await screen.findAllByText(/préenregistrée/i)).length).toBeGreaterThanOrEqual(1);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('mission 23 — aperçu du relevé MCB (démo)', () => {
  const fetchSpy = vi.fn();
  beforeEach(() => { resetDemo(); localStorage.clear(); fetchSpy.mockReset(); vi.stubGlobal('fetch', fetchSpy); });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it('analyse le relevé fictif et affiche la continuité des soldes', async () => {
    await loginAndSelect();
    window.location.hash = '#/accounting/banking/mcb';
    expect(await screen.findByRole('heading', { name: /Importer un relevé MCB/i })).toBeTruthy();
    expect(await screen.findByText(/préenregistrés et fictifs/i)).toBeTruthy();
    const account = screen.getByRole('combobox', { name: /Compte bancaire/i }) as HTMLSelectElement;
    fireEvent.change(account, { target: { value: account.options[1]!.value } });
    const file = new File(['%PDF-1.4 fictif'], 'mcb-fictif.pdf', { type: 'application/pdf' });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });
    fireEvent.click(screen.getByRole('button', { name: /Analyser le relevé/i }));
    expect(await screen.findByText(/Aperçu avant import/i)).toBeTruthy();
    expect((await screen.findAllByText(/Continuité des soldes vérifiée/)).length).toBeGreaterThanOrEqual(1);
    expect((await screen.findAllByText(/15 924,75|15,924.75/)).length).toBeGreaterThanOrEqual(1);
    await waitFor(() => expect(fetchSpy).not.toHaveBeenCalled());
  });
});
