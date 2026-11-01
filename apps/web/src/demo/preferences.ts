/**
 * Mission 37 — locale preference of the public demonstration.
 *
 * Kept outside `mode.ts` so that the compile-time demo switch stays free of
 * localStorage access and cannot pull demo data into the real bundle. The
 * helper is called once by `main.tsx`, before React renders.
 */
import { demoEnabled } from './mode';

export function ensureDemoLocale(): void {
  if (!demoEnabled) return;
  try {
    const stored = localStorage.getItem('mc.locale');
    if (stored !== 'fr' && stored !== 'en') localStorage.setItem('mc.locale', 'en');
  } catch {
    // Storage can be blocked in private mode; the UI still renders in French.
  }
}
