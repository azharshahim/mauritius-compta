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
    expect((await screen.findAllByText(/SIMULATION — NON VALIDÉ POUR PAIEMENT/i)).length).toBeGreaterThan(0);
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

  it('isole le bulletin individuel et n’imprime que ce document', async () => {
    await login();
    const companySelect = screen.getByRole('combobox', { name: /Société/i }) as HTMLSelectElement;
    const option = [...companySelect.options].find((item) => /Mauritius Demo Services/i.test(item.textContent ?? ''));
    expect(option).toBeTruthy();
    fireEvent.change(companySelect, { target: { value: option!.value } });
    window.location.hash = '#/payroll/payslips';
    expect(await screen.findByText('SIM-202610-0001')).toBeTruthy();
    fireEvent.click(await screen.findByRole('link', { name: /Ouvrir \/ Imprimer/i }));
    expect(await screen.findByText('Daniel Morel')).toBeTruthy();
    expect(document.body.classList.contains('payslip-print-mode')).toBe(true);
    expect(screen.getByRole('button', { name: /Imprimer ce bulletin/i })).toBeTruthy();
    expect(screen.queryByText(/SIMULATION \/ DRAFT/i)).toBeNull();
    expect(document.querySelector('.topbar')).toBeTruthy();
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    fireEvent.click(screen.getByRole('button', { name: /Imprimer ce bulletin/i }));
    expect(print).toHaveBeenCalledTimes(1);
    print.mockRestore();
  });

  it('prépare et archive une déclaration mensuelle fictive avec export interne', async () => {
    await login();
    const companySelect = screen.getByRole('combobox', { name: /Société/i }) as HTMLSelectElement;
    const option = [...companySelect.options].find((item) => /Mauritius Demo Services/i.test(item.textContent ?? ''));
    fireEvent.change(companySelect, { target: { value: option!.value } });
    window.location.hash = '#/payroll/declarations';
    await screen.findByRole('heading', { name: /Paie & RH/i });
    expect(await screen.findByText(/Export officiel non disponible/i)).toBeTruthy();
    expect((await screen.findAllByText(/30[\s\u00a0\u202f]635,00/)).length).toBeGreaterThan(0);
    const archive = await screen.findByRole('button', { name: /Archiver la préparation/i });
    expect((archive as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(archive);
    expect(await screen.findByText(/Préparation archivée/i)).toBeTruthy();
    expect((await screen.findAllByRole('button', { name: /Télécharger l’export interne/i })).length).toBeGreaterThan(0);
    expect(await screen.findByText('DEMO-ERN-0016')).toBeTruthy();
  });

  it('prépare un transfert comptable équilibré, l’approuve pour test et n’affiche aucun bouton de comptabilisation actif', async () => {
    await login();
    const companySelect = screen.getByRole('combobox', { name: /Société/i }) as HTMLSelectElement;
    const option = [...companySelect.options].find((item) => /Mauritius Demo Services/i.test(item.textContent ?? ''));
    fireEvent.change(companySelect, { target: { value: option!.value } });
    window.location.hash = '#/payroll/transfer';
    await screen.findByRole('heading', { name: /Paie & RH/i });
    expect(await screen.findByText(/Proposition comptable préparée depuis/i)).toBeTruthy();
    expect((await screen.findAllByText(/6020 — Staff costs/)).length).toBeGreaterThan(0);
    expect((await screen.findAllByText(/32[\s\u00a0\u202f]756,325 MUR/)).length).toBeGreaterThan(0);
    expect(await screen.findByText(/Le débit est exactement égal au crédit/)).toBeTruthy();
    const generate = screen.getByRole('button', { name: /Générer une proposition/i }) as HTMLButtonElement;
    expect(generate.disabled).toBe(false);
    fireEvent.click(generate);
    expect(await screen.findByText(/Proposition générée/i)).toBeTruthy();
    expect(await screen.findByText('v1')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Détail/i }));
    expect(await screen.findByText(/Aucune écriture n’est créée par cette interface/i)).toBeTruthy();
    expect(screen.getAllByText(/Comptabilisation définitive bloquée/i).length).toBeGreaterThan(0);
    const post = screen.getByRole('button', { name: /Comptabiliser/i }) as HTMLButtonElement;
    expect(post.disabled).toBe(true);
    const approve = await screen.findByRole('button', { name: /Approuver pour test/i }) as HTMLButtonElement;
    expect(approve.disabled).toBe(false);
    fireEvent.click(approve);
    const note = await screen.findByLabelText(/Note de décision/i);
    const confirm = screen.getByLabelText(/Je confirme cette décision humaine/i);
    fireEvent.change(note, { target: { value: 'Vérification fictive des totaux et des comptes.' } });
    fireEvent.click(confirm);
    const send = screen.getByRole('button', { name: /^Confirmer$/i }) as HTMLButtonElement;
    expect(send.disabled).toBe(false);
    fireEvent.click(send);
    expect(await screen.findByText(/Proposition approuvée pour test\. Aucune écriture comptable/i)).toBeTruthy();
    expect((await screen.findAllByText('Approuvé pour test')).length).toBeGreaterThan(0);
    const exportButton = screen.getByRole('button', { name: /Exporter le CSV interne/i });
    expect((exportButton as HTMLButtonElement).disabled).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('conserve des tableaux contenus et une mise en page mobile sans débordement horizontal', () => {
    const css = readFileSync(resolve(__dirname, '../src/styles.css'), 'utf8');
    expect(css).toMatch(/\.table-wrap[^}]*overflow-x: auto/s);
    expect(css).toMatch(/@media \(max-width: 640px\)[^}]*\.payroll-columns \{ grid-template-columns: 1fr; \}/s);
    expect(css).toMatch(/\.payroll-toolbar[^}]*flex-wrap: wrap/s);
    expect(css).toMatch(/@page \{ size: A4 portrait; margin: 10mm; \}/);
    expect(css).toMatch(/body\.payslip-print-mode #root \.payslip-print-root/);
    expect(css).toMatch(/body\.payslip-print-mode \.payslip-actions[^}]*display: none !important/s);
    expect(css).toMatch(/body\.payslip-print-mode \.payslip-sheet[^}]*font-size: 8\.8pt/s);
  });
});
