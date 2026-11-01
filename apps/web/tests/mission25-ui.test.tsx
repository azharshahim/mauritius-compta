/** Mission 25 — écran informatif MRA e-Invoicing : navigation, FR/EN, aucun appel MRA. */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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
  fireEvent.click(await screen.findByRole('button', { name: /Se connecter/i }));
  await screen.findByRole('button', { name: /Facturation/i });
  const select = screen.getByRole('combobox', { name: /Société/i }) as HTMLSelectElement;
  const option = [...select.options].find((item) => /Lagon Bleu/i.test(item.textContent ?? ''))!;
  fireEvent.change(select, { target: { value: option.value } });
}

describe('mission 25 — MRA e-Invoicing, à venir', () => {
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

  it('affiche le statut À venir, les six fonctions indisponibles et les paramètres inactifs', async () => {
    renderApp();
    await loginAndSelect();

    fireEvent.click(screen.getByRole('button', { name: /Facturation/i }));
    const navLink = await screen.findByRole('link', { name: /MRA e-Invoicing — À venir/i });
    fireEvent.click(navLink);

    expect(await screen.findByRole('heading', { name: 'MRA e-Invoicing — À venir' })).toBeTruthy();
    expect(screen.getByText(/Intégration MRA non activée\./)).toBeTruthy();
    expect(screen.getByText(/Aucun appel réseau vers la MRA n’est effectué\./)).toBeTruthy();
    expect(screen.getByText('Non activée')).toBeTruthy();
    expect(screen.getAllByText('Non disponible')).toHaveLength(6);
    expect(screen.getByText('Émission de factures structurées')).toBeTruthy();
    expect(screen.getByText('Transmission à la MRA')).toBeTruthy();
    expect(screen.getByText('Suivi des statuts')).toBeTruthy();
    expect(screen.getByText('Accusés de réception')).toBeTruthy();
    expect(screen.getByText('Gestion des erreurs')).toBeTruthy();
    expect(screen.getByText('Rapprochement comptable')).toBeTruthy();

    const ebsId = screen.getByLabelText('Identifiant EBS MRA') as HTMLInputElement;
    expect(ebsId.disabled).toBe(true);
    expect(ebsId.value).toBe('Non attribué');
    expect((screen.getByLabelText('Certificat numérique') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Tester la connexion' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Enregistrer' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Aucun champ n’est enregistré/)).toBeTruthy();

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('traduit tout l’écran en anglais et conserve le statut Coming Soon', async () => {
    renderApp('#/billing/e-invoicing');
    await loginAndSelect();

    expect(await screen.findByRole('heading', { name: 'MRA e-Invoicing — À venir' })).toBeTruthy();
    fireEvent.change(screen.getByRole('combobox', { name: /Langue/i }), { target: { value: 'en' } });

    expect(await screen.findByRole('heading', { name: 'MRA e-Invoicing — Coming Soon' })).toBeTruthy();
    expect(screen.getByText(/MRA integration is not enabled\./)).toBeTruthy();
    expect(screen.getByText(/No network call is made to the MRA\./)).toBeTruthy();
    expect(screen.getAllByText('Not available')).toHaveLength(6);
    expect(screen.getByText('Structured invoice generation')).toBeTruthy();
    expect(screen.getByText('Accounting reconciliation')).toBeTruthy();
    expect((screen.getByLabelText('MRA EBS identifier') as HTMLInputElement).value).toBe('Not assigned');
    expect((screen.getByRole('button', { name: 'Test connection' }) as HTMLButtonElement).disabled).toBe(true);

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('ouvre la route stable après un rechargement simulé et la facturation reste inchangée', async () => {
    renderApp('#/billing/e-invoicing');
    await loginAndSelect();

    expect(await screen.findByRole('heading', { name: 'MRA e-Invoicing — À venir' })).toBeTruthy();
    expect(
      screen.getByRole('link', { name: /MRA e-Invoicing — À venir/i }).getAttribute('aria-current'),
    ).toBe('page');

    fireEvent.click(screen.getByRole('link', { name: 'Ouvrir la facturation classique' }));
    expect(await screen.findByRole('heading', { name: /^Factures clients$/ })).toBeTruthy();
    expect(await screen.findByText('FAC-DEMO-0002')).toBeTruthy();

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('ne contient ni appel réseau ni adresse externe dans son code source', () => {
    const source = readFileSync(path.resolve('src/pages/billing/MraEInvoicing.tsx'), 'utf8');
    expect(source).not.toMatch(/from '\.\.\/\.\.\/api'/);
    expect(source).not.toMatch(/\bfetch\s*\(/);
    expect(source).not.toMatch(/XMLHttpRequest|axios|WebSocket/);
    expect(source).not.toMatch(/https?:\/\//);
    expect(source).toContain('deliberately');
  });
});
