/**
 * Mission 46 — Modern UX/UI Foundation: design tokens, shell navigation,
 * Accountant Workspace portfolio switcher, and 6-step client creation progress
 * non-regression suite.
 *
 * Uses only the in-browser fictional demo state; `fetch` is stubbed and
 * asserted unused.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { HashRouter } from 'react-router-dom';
import App from '../src/App';
import { I18nProvider, dictionaries } from '../src/i18n';
import { SessionProvider } from '../src/store';
import { resetDemo } from '../src/demo';
import { navLink } from './nav';

const defaultWidth = window.innerWidth;

function setWidth(width: number) {
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    writable: true,
    value: width,
  });
  fireEvent(window, new Event('resize'));
}

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

async function login(locale: 'en' | 'fr' = 'en', hash = '#/') {
  localStorage.setItem('mc.locale', locale);
  renderApp(hash);
  fireEvent.click(await screen.findByRole('button', { name: /Sign in|Se connecter/i }));
  await waitFor(() => expect(document.querySelector('.page h1')).toBeTruthy());
}

describe('mission 46 — modern SaaS design tokens and brand preservation', () => {
  it('declares the Mission 46 palette in styles.css while keeping COMPTAI product naming', () => {
    const css = readFileSync(path.resolve('src/styles.css'), 'utf8');
    expect(css).toMatch(/--navy:\s*#101c32/i);
    expect(css).toMatch(/--accent:\s*#3568e8/i);
    expect(css).toMatch(/--teal:\s*#18b8ad/i);
    expect(css).toMatch(/--violet:\s*#8068e8/i);
    expect(css).toMatch(/--bg:\s*#f7f9fc/i);
    expect(css).toMatch(/--surface:\s*#ffffff/i);

    // Product rename to ELNA is explicitly deferred: COMPTAI stays intact.
    expect(dictionaries.en['app.name']).toBe('COMPTAI');
    expect(dictionaries.fr['app.name']).toBe('COMPTAI');
    expect(dictionaries.en['suite.name']).toBe('COMPTAI');
    expect(dictionaries.fr['suite.name']).toBe('COMPTAI');
  });

  it('points every ClientWorkspace section link at an existing route in App.tsx', () => {
    const appSource = readFileSync(path.resolve('src/App.tsx'), 'utf8');
    const wsSource = readFileSync(path.resolve('src/pages/cabinet/ClientWorkspace.tsx'), 'utf8');
    const routes = [...appSource.matchAll(/<Route\s+path="([^"]+)"/g)]
      .map((m) => m[1]!)
      .filter((r) => r !== '*');

    const sectionBlock = wsSource.slice(
      wsSource.indexOf('const SECTION_LINKS'),
      wsSource.indexOf('export default function ClientWorkspacePage'),
    );
    const paths = [...sectionBlock.matchAll(/path:\s*'([^']+)'/g)].map((m) => m[1]!);
    expect(paths.length).toBeGreaterThan(25);
    for (const rawPath of paths) {
      const pathname = new URL(rawPath, 'https://comptai.invalid').pathname;
      const matches = routes.some((pattern) => {
        const patternParts = pattern.split('/').filter(Boolean);
        const pathParts = pathname.split('/').filter(Boolean);
        return (
          patternParts.length === pathParts.length &&
          patternParts.every((part, idx) => part.startsWith(':') || part === pathParts[idx])
        );
      });
      expect(matches, `ClientWorkspace SECTION_LINKS path ${rawPath}`).toBe(true);
    }
  });
});

describe('mission 46 — 6-step client creation progress non-regression', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    setWidth(1440);
    resetDemo();
    localStorage.clear();
    sessionStorage.clear();
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    cleanup();
    setWidth(defaultWidth);
    vi.unstubAllGlobals();
  });

  it('never marks steps 1–5 Completed when jumping to Step 6 on an empty draft, and replaces bare dashes with explicit readiness prompts', async () => {
    await login('en');
    fireEvent.click(screen.getAllByRole('link', { name: /Create new client/i })[0]!);
    await screen.findByRole('heading', { name: /Create New Client/i });

    const rail = document.querySelector('.m44-wizard-rail') as HTMLElement;
    expect(rail).toBeTruthy();

    // Jump straight to Step 6 (Review and Activate) on an untouched draft.
    const step6Button = within(rail).getByRole('button', { name: /Review and Activate/i });
    fireEvent.click(step6Button);

    await screen.findByRole('heading', { name: /Review and Activate/i });
    expect(step6Button.getAttribute('aria-current')).toBe('step');

    // Progress summary reports 1 of 6 steps (only Applicable Modules is pre-selected by default).
    expect(screen.getAllByText(/1 of 6 steps/i).length).toBeGreaterThanOrEqual(1);

    // Non-regression: StepList must show ONLY 1 Completed badge, matching "1 of 6 steps"
    // (never 5 Completed badges from stepIndex cursor position).
    const completedInRail = within(rail).getAllByText(/^Completed$/);
    expect(completedInRail).toHaveLength(1);
    expect(within(rail).getAllByText(/^Not started$/)).toHaveLength(4);
    expect(within(rail).getAllByText(/^In progress$/)).toHaveLength(1);

    // Readiness box & review cards explicitly distinguish missing required vs optional fields,
    // with zero bare "—" placeholders in the review summary.
    expect(screen.getByText(/Required information missing before activation/i)).toBeTruthy();
    expect(screen.getByText(/Registered business name required \(Step 1\)/i)).toBeTruthy();
    expect(screen.getByText(/Registered address required \(Step 1\)/i)).toBeTruthy();
    expect(screen.getByText(/Business sector required \(Step 3\)/i)).toBeTruthy();
    expect(screen.getAllByText(/Not provided — required/i).length).toBeGreaterThanOrEqual(3);
    expect(screen.getAllByText(/Not provided \(optional\)/i).length).toBeGreaterThanOrEqual(2);

    const reviewGrid = document.querySelector('.m44-review') as HTMLElement;
    const bareDashes = Array.from(reviewGrid.querySelectorAll('dd, p')).filter(
      (el) => el.textContent?.trim() === '—',
    );
    expect(bareDashes).toHaveLength(0);

    // Activation remains blocked until required fields are filled (business rules intact).
    fireEvent.click(screen.getByRole('button', { name: /Activate client file/i }));
    await screen.findByText(/Fix the incomplete steps before activation/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('keeps StepList Completed count strictly equal to "X of 6 steps" across every step transition', async () => {
    await login('en');
    fireEvent.click(screen.getAllByRole('link', { name: /Create new client/i })[0]!);
    await screen.findByRole('heading', { name: /Create New Client/i });

    const rail = document.querySelector('.m44-wizard-rail') as HTMLElement;
    const assertCoherentCount = (expectedDone: number) => {
      expect(within(rail).queryAllByText(/^Completed$/)).toHaveLength(expectedDone);
      expect(
        screen.getAllByText(new RegExp(`${expectedDone} of 6 steps`, 'i')).length,
      ).toBeGreaterThanOrEqual(1);
    };

    // Initial state: 1 of 6 steps (Applicable Modules default selection).
    assertCoherentCount(1);

    // Complete Step 1 (Company Information) -> 2 of 6 steps.
    fireEvent.change(screen.getByLabelText(/Registered business name/i), {
      target: { value: 'Moka Modern Advisory Ltd' },
    });
    fireEvent.change(screen.getByLabelText(/Registered address/i), {
      target: { value: '18 Telfair Avenue, Moka, Mauritius' },
    });
    assertCoherentCount(2);

    fireEvent.click(screen.getByRole('button', { name: /Next step/i }));
    await screen.findByText(/Checklist only/i);
    // KYC review approval happens post-activation -> still 2 of 6 completed, never falsely 3.
    assertCoherentCount(2);

    fireEvent.click(screen.getByRole('button', { name: /Next step/i }));
    fireEvent.click(screen.getByRole('button', { name: /Professional services/i }));
    // Business sector selected -> 3 of 6 steps.
    assertCoherentCount(3);

    fireEvent.click(screen.getByRole('button', { name: /Next step/i }));
    // Accounting setup is In progress until bankAccountsReviewed is checked -> still 3 of 6.
    assertCoherentCount(3);
    fireEvent.click(screen.getByLabelText(/Bank accounts were reviewed with the client/i));
    // Now Accounting setup is Completed -> 4 of 6 steps!
    assertCoherentCount(4);

    fireEvent.click(screen.getByRole('button', { name: /Next step/i }));
    assertCoherentCount(4);

    fireEvent.click(screen.getByRole('button', { name: /Next step/i }));
    await screen.findByRole('heading', { name: /Review and Activate/i });
    assertCoherentCount(4);
    expect(screen.getByText(/Ready to activate client workspace/i)).toBeTruthy();
    expect(screen.getByText('Moka Modern Advisory Ltd')).toBeTruthy();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('mission 46 — shell workspace jump, sidebar shortcuts, and portfolio views', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    setWidth(1440);
    resetDemo();
    localStorage.clear();
    sessionStorage.clear();
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    cleanup();
    setWidth(defaultWidth);
    vi.unstubAllGlobals();
  });

  it('switches portfolio between Table and Cards on desktop, resets filters, and opens Accounting Controls & Bank Periods from sidebar', async () => {
    await login('en');
    await screen.findByRole('heading', { name: /Cabinet Dashboard/i });

    // Portfolio table is visible by default on desktop; switch to Cards and back.
    expect(document.querySelector('.m44-table')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^Cards$/i }));
    expect(document.querySelector('.m46-portfolio-grid')).toBeTruthy();
    expect(document.querySelector('.m44-table')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^Table$/i }));
    expect(document.querySelector('.m44-table')).toBeTruthy();

    // Filter and reset filters.
    const searchInput = screen.getByLabelText(/Search client/i);
    fireEvent.change(searchInput, { target: { value: 'Belle Mare' } });
    expect(screen.getByText(/Showing 1 of/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Reset filters/i }));
    expect((searchInput as HTMLInputElement).value).toBe('');

    // Open Accounting Controls and Bank Periods directly from the sidebar.
    fireEvent.click(navLink(/^Accounting Controls$/));
    await screen.findByRole('heading', { name: /Accounting controls/i });
    expect(window.location.hash).toBe('#/accounting/controls');

    fireEvent.click(navLink(/^Bank Periods$/));
    await waitFor(() => expect(window.location.hash).toBe('#/accounting/banking?tab=report'));

    // Topbar Client Workspace shortcut opens the active company's workspace.
    const jump = document.querySelector('.topbar .workspace-jump') as HTMLAnchorElement;
    expect(jump).toBeTruthy();
    fireEvent.click(jump);
    await waitFor(() => expect(window.location.hash).toMatch(/#\/cabinet\/clients\/[^/]+\/workspace$/));

    // Android viewport check: mobile cards + quick nav + assistant launcher coexist cleanly.
    setWidth(390);
    window.location.hash = '#/cabinet';
    await screen.findByRole('heading', { name: /Cabinet Dashboard/i });
    await waitFor(() => expect(document.querySelector('.m44-client-cards')).toBeTruthy());
    expect(document.querySelector('.mobile-quick-nav')).toBeTruthy();
    expect(document.querySelector('.assistant-fab')).toBeTruthy();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
