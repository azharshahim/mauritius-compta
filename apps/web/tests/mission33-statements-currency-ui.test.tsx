/**
 * Mission 33 — P0-01 UI regression.
 *
 * The screen must display the functional currency of the amounts, and must say
 * that a different configured presentation currency is not applied. The demo
 * backend is used so the test exercises the same React screen without a server.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { HashRouter } from 'react-router-dom';
import App from '../src/App';
import { I18nProvider } from '../src/i18n';
import { SessionProvider } from '../src/store';
import {
  DEMO_EMAIL,
  DEMO_PASSWORD,
  demoRequest,
  resetDemo,
} from '../src/demo';

function renderApp(hash: string) {
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

function loginAndFirstCompany() {
  demoRequest('POST', '/auth/login', { email: DEMO_EMAIL, password: DEMO_PASSWORD });
  const list = demoRequest<{ companies: { id: string; name: string }[] }>('GET', '/companies');
  const company = list.companies[0]!;
  localStorage.setItem('mc.companyId', company.id);
  return company;
}

describe('mission 33 — devise affichée dans les états financiers (démo)', () => {
  beforeEach(() => {
    resetDemo();
    localStorage.clear();
    sessionStorage.clear();
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    localStorage.clear();
    sessionStorage.clear();
  });

  it('labels MUR amounts with MUR and explains that EUR is configured but not applied', async () => {
    const company = loginAndFirstCompany();
    demoRequest('PATCH', `/companies/${company.id}`, { presentationCurrency: 'EUR' });

    const statements = demoRequest<{
      currency: string;
      functionalCurrency: string;
      presentationCurrency: string;
      presentationCurrencyApplied: boolean;
      currencyBasis: string;
      financialPosition: { balanced: boolean };
    }>('GET', `/companies/${company.id}/reports/statements`);
    expect(statements.currency).toBe('MUR');
    expect(statements.functionalCurrency).toBe('MUR');
    expect(statements.presentationCurrency).toBe('EUR');
    expect(statements.presentationCurrencyApplied).toBe(false);
    expect(statements.currencyBasis).toBe('functional_currency');
    expect(statements.financialPosition.balanced).toBe(true);

    renderApp('#/accounting/statements');
    await screen.findByRole('heading', { name: /États financiers \(provisoires\)/i });
    expect(
      await screen.findByText(/Montants exprimés en MUR/),
    ).toBeTruthy();
    expect(
      screen.getByText(/Devise de présentation configurée non appliquée à ces états : EUR/),
    ).toBeTruthy();
  });

  it('does not show the notice when functional and presentation currencies are identical', async () => {
    const company = loginAndFirstCompany();
    renderApp('#/accounting/statements');
    await screen.findByRole('heading', { name: /États financiers \(provisoires\)/i });
    expect(screen.queryByText(/Devise de présentation configurée non appliquée/)).toBeNull();
    expect(screen.queryByText(/Montants exprimés en/)).toBeNull();
  });
});
