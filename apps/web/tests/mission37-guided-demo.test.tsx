/**
 * Mission 37 — the English-first review tour.
 *
 * The browser bootstrap, not a test-only branch, decides the initial locale:
 * English when no preference exists, French when the reviewer already chose it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { HashRouter } from 'react-router-dom';
import App from '../src/App';
import { I18nProvider } from '../src/i18n';
import { SessionProvider } from '../src/store';
import { ensureDemoLocale, resetDemo } from '../src/demo';
import { navLink } from './nav';

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

describe('mission 37 — guided demonstration', () => {
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

  it('opens in English when the reviewer has no saved language', () => {
    expect(localStorage.getItem('mc.locale')).toBeNull();
    ensureDemoLocale();
    expect(localStorage.getItem('mc.locale')).toBe('en');
  });

  it('never overwrites a French preference already chosen by the reviewer', () => {
    localStorage.setItem('mc.locale', 'fr');
    ensureDemoLocale();
    expect(localStorage.getItem('mc.locale')).toBe('fr');
  });

  it('shows the guided route, the fourteen destinations and the sixteen steps without network', async () => {
    ensureDemoLocale();
    renderApp();
    fireEvent.click(await screen.findByRole('button', { name: /Sign in/i }));
    await screen.findByRole('heading', { name: /Cabinet dashboard/i });

    fireEvent.click(navLink(/Guided demo/));
    await screen.findByRole('heading', { name: 'Guided demo' });
    expect((await screen.findAllByText('Island Trading Ltd — DEMO COMPANY')).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole('button', { name: /Reset demo data/i })).toBeTruthy();

    await waitFor(() => expect(document.querySelectorAll('.demo-quick-link')).toHaveLength(14));
    expect(document.querySelectorAll('.demo-step')).toHaveLength(16);
    expect(document.querySelectorAll('.demo-health-row').length).toBe(8);

    expect((await screen.findAllByText(/Balanced/)).length).toBeGreaterThanOrEqual(2);
    expect((await screen.findAllByText(/practice account/i)).length).toBeGreaterThanOrEqual(1);
    expect((await screen.findAllByText(/reconciled subledgers/i)).length).toBeGreaterThanOrEqual(1);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
