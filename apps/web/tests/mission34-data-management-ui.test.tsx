/** Mission 34 — Settings → Data Management must never simulate a backup. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { HashRouter } from 'react-router-dom';
import App from '../src/App';
import { I18nProvider } from '../src/i18n';
import { SessionProvider } from '../src/store';
import { DEMO_EMAIL, DEMO_PASSWORD, demoRequest, resetDemo } from '../src/demo';

function renderDataPage() {
  window.location.hash = '#/accounting/settings/data';
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

describe('mission 34 — gestion des données (démo)', () => {
  beforeEach(() => {
    resetDemo();
    localStorage.clear();
    sessionStorage.clear();
    demoRequest('POST', '/auth/login', { email: DEMO_EMAIL, password: DEMO_PASSWORD });
    const companies = demoRequest<{ companies: { id: string }[] }>('GET', '/companies').companies;
    localStorage.setItem('mc.companyId', companies[0]!.id);
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    localStorage.clear();
    sessionStorage.clear();
  });

  it('explains that no real backup is available and disables every action', async () => {
    renderDataPage();
    expect(await screen.findByRole('heading', { name: /Gestion des données/i })).toBeTruthy();
    expect(screen.getByText(/aucune sauvegarde réelle n’est créée/i)).toBeTruthy();
    expect(screen.getByText(/chiffrées \(AES-256-GCM\)/i)).toBeTruthy();

    expect((screen.getByRole('button', { name: /Créer une sauvegarde/i }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: /Créer l’export/i }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: /^Restauration$/i }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTitle(/Restauration désactivée dans l’interface/i)).toBeTruthy();
    expect(fetch).not.toHaveBeenCalled();
  });
});
