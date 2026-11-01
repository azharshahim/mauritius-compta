/**
 * Mission 39 — progress marker for the Mission 37 Guided Demo.
 *
 * This is deliberately not a second navigation engine: it only remembers which
 * of the sixteen existing steps launched the current screen. The router remains
 * the single owner of the URL; the marker lets the contextual bar offer a safe
 * return to the same step after a reviewer opens Trial Balance or another
 * destination.
 */
export const GUIDED_TOUR_STEPS = 16;

/** Primary destination of every step, in the same order as GuidedDemo.tsx. */
export const GUIDED_TOUR_LINKS = [
  '/accounting',
  '/accounting/financial-years?tab=opening',
  '/billing/customers',
  '/billing/invoices',
  '/accounting/purchases?tab=invoices',
  '/billing/payments',
  '/accounting/purchases?tab=payments',
  '/accounting/banking',
  '/accounting/banking?tab=transactions',
  '/accounting/assets',
  '/accounting/inventory',
  '/payroll',
  '/accounting/ledger',
  '/accounting/trial-balance',
  '/accounting/statements/profit-loss',
  '/accounting/financial-years?tab=checklist',
] as const;

const STORAGE_KEY = 'mc.guidedTour.v1';

export interface GuidedTourState {
  active: boolean;
  /** Zero-based step index. The UI displays step + 1. */
  step: number;
  updatedAt: number;
}

function clampStep(step: number): number {
  if (!Number.isFinite(step)) return 0;
  return Math.min(GUIDED_TOUR_STEPS - 1, Math.max(0, Math.trunc(step)));
}

export function readGuidedTour(): GuidedTourState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { active: false, step: 0, updatedAt: 0 };
    const parsed = JSON.parse(raw) as Partial<GuidedTourState>;
    return {
      active: parsed.active === true,
      step: clampStep(Number(parsed.step ?? 0)),
      updatedAt: Number(parsed.updatedAt ?? 0),
    };
  } catch {
    return { active: false, step: 0, updatedAt: 0 };
  }
}

export function writeGuidedTour(active: boolean, step: number): GuidedTourState {
  const state: GuidedTourState = {
    active,
    step: clampStep(step),
    updatedAt: Date.now(),
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage can be unavailable in private browsing; navigation still works
    // for the current render and simply loses its progress marker on reload.
  }
  return state;
}

export function startGuidedTour(step: number): GuidedTourState {
  return writeGuidedTour(true, step);
}

export function setGuidedTourStep(step: number): GuidedTourState {
  return writeGuidedTour(true, step);
}

/** Leaves tour mode but keeps the selected step for a later return. */
export function deactivateGuidedTour(): GuidedTourState {
  const current = readGuidedTour();
  return writeGuidedTour(false, current.step);
}

export function clearGuidedTour(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to clear.
  }
}

export function guidedTourStepPath(step: number): string {
  return GUIDED_TOUR_LINKS[clampStep(step)] ?? GUIDED_TOUR_LINKS[0];
}

export function guidedTourDemoPath(step: number): string {
  return `/demo?step=${clampStep(step) + 1}`;
}

/** Reads a 1-based `?step=` value from the Guided Demo URL. */
export function guidedTourStepFromQuery(value: string | null, fallback = 0): number {
  if (value === null || value.trim() === '') return clampStep(fallback);
  return clampStep(Number(value) - 1);
}
