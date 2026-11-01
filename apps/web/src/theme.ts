/**
 * Mission 40 — single entry point for the existing light/dark preference.
 *
 * This does not introduce a second theme architecture: the colours remain the
 * semantic CSS variables in styles.css (`--bg`, `--surface`, `--text`, etc.).
 * This module only reads/writes the existing `mc.theme` preference and applies
 * the `data-theme` attribute before the first paint.
 */
export const THEME_STORAGE_KEY = 'mc.theme';
export const LIGHT_THEME_COLOR = '#0b2545';
export const DARK_THEME_COLOR = '#08101d';

export type Theme = 'light' | 'dark';

/** Reads the stored preference and falls back to light on any storage error. */
export function readStoredTheme(): Theme {
  try {
    return localStorage.getItem(THEME_STORAGE_KEY) === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

/** Applies the theme to the document, including the mobile browser chrome. */
export function applyTheme(theme: Theme): void {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.theme = theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  meta?.setAttribute('content', theme === 'dark' ? DARK_THEME_COLOR : LIGHT_THEME_COLOR);
}

/** Persists the explicit user choice. Storage may be unavailable in private mode. */
export function storeTheme(theme: Theme): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // The current session still keeps the React state.
  }
}

export function nextTheme(theme: Theme): Theme {
  return theme === 'dark' ? 'light' : 'dark';
}
