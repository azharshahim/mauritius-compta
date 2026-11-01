/** Mission 29 — side-by-side document verification (demo fixtures). */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { HashRouter } from 'react-router-dom';
import App from '../src/App';
import { I18nProvider } from '../src/i18n';
import { SessionProvider } from '../src/store';
import { resetDemo } from '../src/demo';

function renderApp() {
  window.location.hash = '#/';
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

describe('mission 29 — vérification documentaire (démo)', () => {
  beforeEach(() => {
    resetDemo();
    localStorage.clear();
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('affiche le document original à côté des données extraites', async () => {
    await loginAndSelect();
    window.location.hash = '#/documents?doc=demo-doc-1';
    expect(await screen.findByText(/Données extraites et corrections/i)).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /INV-2026-101/ }).length).toBeGreaterThan(0);
    expect(screen.getByText(/Document original/i)).toBeTruthy();
    expect(document.querySelector('.doc-review-grid')).toBeTruthy();
    expect(screen.getByRole('combobox', { name: /Type de document/i })).toBeTruthy();
    expect(screen.getAllByText(/N° TVA/i).length).toBeGreaterThan(0);
  });

  it('reste lisible en anglais avec les nouveaux champs', async () => {
    await loginAndSelect();
    fireEvent.change(screen.getByLabelText(/Langue/i), { target: { value: 'en' } });
    window.location.hash = '#/documents';
    const buttons = await screen.findAllByRole('button', { name: /INV-2026-101/ });
    fireEvent.click(buttons[0]!);
    expect(await screen.findByText(/Extracted data and corrections/i)).toBeTruthy();
    expect(screen.getByText(/Original document/i)).toBeTruthy();
    expect(screen.getByRole('combobox', { name: /Document type/i })).toBeTruthy();
  });
});
