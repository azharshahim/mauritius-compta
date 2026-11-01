/** Mission 30 — Android drawer opens, closes and blocks the page behind it. */
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
    <I18nProvider>
      <SessionProvider>
        <HashRouter>
          <App />
        </HashRouter>
      </SessionProvider>
    </I18nProvider>,
  );
}

describe('mission 30 — Android side menu', () => {
  beforeEach(() => {
    resetDemo();
    localStorage.clear();
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    cleanup();
    document.body.classList.remove('nav-open');
    vi.unstubAllGlobals();
  });

  it('opens with the close control, locks body scroll and closes again', async () => {
    renderApp();
    fireEvent.click(await screen.findByRole('button', { name: /Se connecter/i }));
    await screen.findByRole('heading', { name: /Tableau de bord Cabinet/i });

    const sidebar = document.getElementById('app-sidebar')!;
    expect(sidebar.className).not.toContain('open');

    fireEvent.click(screen.getByRole('button', { name: /^Menu$/i }));
    expect(sidebar.className).toContain('open');
    expect(document.body.classList.contains('nav-open')).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: /Fermer/i }));
    expect(sidebar.className).not.toContain('open');
    expect(document.body.classList.contains('nav-open')).toBe(false);
  });

  it('shows the COMPTAI mark and name in the sidebar', async () => {
    renderApp();
    fireEvent.click(await screen.findByRole('button', { name: /Se connecter/i }));
    await screen.findByRole('heading', { name: /Tableau de bord Cabinet/i });
    const sidebar = document.getElementById('app-sidebar')!;
    expect(sidebar.querySelector('img.brand-mark')).toBeTruthy();
    expect(sidebar.textContent).toContain('COMPTAI');
  });
});
