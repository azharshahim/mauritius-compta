/**
 * Mission 40 — theme preference, persistence and open-dialog behaviour.
 *
 * The mission must keep the existing `mc.theme` mechanism. These tests cover
 * light ↔ dark, persistence across a remount (the jsdom equivalent of a reload),
 * navigation between modules, and an already-open dialog while the theme flips.
 * No visual claim is made: jsdom has no layout engine and no real browser is
 * available in this environment.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { HashRouter } from 'react-router-dom';
import App from '../src/App';
import { I18nProvider } from '../src/i18n';
import { SessionProvider } from '../src/store';
import { resetDemo } from '../src/demo';
import { applyTheme, nextTheme, readStoredTheme, storeTheme, THEME_STORAGE_KEY } from '../src/theme';

function renderApp(hash = '#/') {
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

async function login() {
  renderApp();
  fireEvent.click(await screen.findByRole('button', { name: /Se connecter/i }));
  await screen.findByRole('heading', { name: /Tableau de bord Cabinet/i });
}

describe('mission 40 — theme preference', () => {
  beforeEach(() => {
    resetDemo();
    localStorage.clear();
    document.documentElement.dataset.theme = 'light';
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('reads, stores and applies the existing preference', () => {
    expect(readStoredTheme()).toBe('light');
    storeTheme('dark');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(readStoredTheme()).toBe('dark');
    expect(nextTheme('dark')).toBe('light');
    expect(nextTheme('light')).toBe('dark');

    const meta = document.createElement('meta');
    meta.name = 'theme-color';
    document.head.appendChild(meta);
    applyTheme('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(meta.content).toBe('#08101d');
    applyTheme('light');
    expect(meta.content).toBe('#0b2545');
    meta.remove();
  });

  it('keeps the chosen theme across navigation and a remount', async () => {
    await login();
    fireEvent.click(screen.getByRole('button', { name: /Passer en mode sombre/i }));
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('dark'));

    window.location.hash = '#/accounting';
    await screen.findByRole('heading', { level: 1, name: /^Tableau de bord$/i });
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');

    // Simulate a reload: the document starts light, only localStorage survives.
    cleanup();
    document.documentElement.dataset.theme = 'light';
    window.location.hash = '#/';
    renderApp();
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('dark'));
    expect(screen.getByRole('button', { name: /Passer en mode clair/i })).toBeTruthy();
  });

  it('updates an already-open assistant panel without closing it', async () => {
    await login();
    fireEvent.click(document.querySelector('.assistant-fab') as HTMLElement);
    const dialog = await screen.findByRole('dialog', { name: /Assistant IA/i });

    fireEvent.click(screen.getByRole('button', { name: /Passer en mode sombre/i }));
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('dark'));
    expect(dialog.isConnected).toBe(true);
    expect(document.querySelector('.assistant-fab')?.getAttribute('aria-expanded')).toBe('true');
  });
});
