/**
 * Payroll preparation screen, rendered against the in-browser demo.
 * Every person, amount and rule shown is fictional. No network request is
 * allowed and no statutory value may appear.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
        <HashRouter><App /></HashRouter>
      </SessionProvider>
    </I18nProvider>,
  );
}

async function login() {
  renderApp();
  fireEvent.click(await screen.findByRole('button', { name: /Se connecter/i }));
  await screen.findByRole('heading', { name: /Tableau de bord Cabinet/i });
}

describe('paie & RH (interface démonstration)', () => {
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

  it('affiche 12 dossiers fictifs, les comptes masqués et aucun appel réseau', async () => {
    await login();
    window.location.hash = '#/payroll/employees';
    await screen.findByRole('heading', { name: /Paie & RH/i });
    expect(await screen.findByText('A001')).toBeTruthy();
    expect(await screen.findByText(/Aline Fictive/)).toBeTruthy();
    expect((await screen.findAllByText(/•••• 4000/)).length).toBeGreaterThan(0);
    expect(screen.queryByText(/MU00FICT/)).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('présente un moteur bloqué, des règles sans taux et un net seulement arithmétique', async () => {
    await login();
    window.location.hash = '#/payroll/calculations';
    await screen.findByRole('heading', { name: /Paie & RH/i });
    expect(await screen.findByText(/règles sourcées mais non validées par un expert/i)).toBeTruthy();
    expect((await screen.findAllByText('expert_review_pending')).length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toMatch(/net légal garanti/i);
    window.location.hash = '#/payroll/rules';
    expect(await screen.findByText(/Registre des règles datées/i)).toBeTruthy();
    expect((await screen.findAllByText('RESEARCHED')).length).toBeGreaterThan(0);
    expect(screen.getByText(/MOTEUR IMPLÉMENTÉ, REVUE EXPERTE EN ATTENTE/i)).toBeTruthy();
  });

  it('ne propose que des bulletins de simulation et interdit le bulletin final', async () => {
    await login();
    window.location.hash = '#/payroll/payslips';
    await screen.findByRole('heading', { name: /Paie & RH/i });
    expect(await screen.findByText('SIM-202601-0001')).toBeTruthy();
    expect((await screen.findAllByText(/SIMULATION \/ DRAFT/i)).length).toBeGreaterThan(0);
    expect(screen.getByText(/Aucun bulletin final n’est possible/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Finaliser/i })).toBeNull();
  });

  it('bascule les libellés en anglais sans perdre l’avertissement réglementaire', async () => {
    await login();
    window.location.hash = '#/payroll';
    await screen.findByRole('heading', { name: /Paie & RH/i });
    const language = screen.getByLabelText(/Langue/i) as HTMLSelectElement;
    fireEvent.change(language, { target: { value: 'en' } });
    expect(await screen.findByRole('heading', { name: /^Payroll & HR$/i })).toBeTruthy();
    expect(await screen.findByText(/PAYE, CSG, NSF and Training Levy are computed from sourced official rules/i)).toBeTruthy();
  });

  it('conserve des tableaux contenus et une mise en page mobile sans débordement horizontal', () => {
    const css = readFileSync(resolve(__dirname, '../src/styles.css'), 'utf8');
    expect(css).toMatch(/\.table-wrap[^}]*overflow-x: auto/s);
    expect(css).toMatch(/@media \(max-width: 640px\)[^}]*\.payroll-columns \{ grid-template-columns: 1fr; \}/s);
    expect(css).toMatch(/\.payroll-toolbar[^}]*flex-wrap: wrap/s);
  });
});
