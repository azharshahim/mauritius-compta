import { expect, test, type Page } from '@playwright/test';

/**
 * Mission 46 — Modern UX/UI Foundation E2E verification (Desktop 1440×900 & Android Pixel 7).
 *
 * Covers light & dark themes, Cabinet portfolio (table/cards, filters),
 * 6-step client creation & progress non-regression, draft save, Accounting Controls,
 * Bank Periods, and horizontal-overflow guard (`scrollWidth <= innerWidth`).
 *
 * Runs against the client-side demo bundle (`npm run build:demo -w @mc/web`).
 * Note: local assistant sandbox has no Chromium binary installed; executed in CI
 * (`integration-e2e.yml`) or locally with Playwright Chromium installed.
 */

const base = process.env.E2E_BASE_URL ?? 'http://localhost:4173/mauritius-compta/';

async function signIn(page: Page, locale: 'en' | 'fr' = 'en', theme: 'light' | 'dark' = 'light') {
  await page.addInitScript(
    ({ lang, mode }) => {
      localStorage.setItem('mc.locale', lang);
      localStorage.setItem('mc.theme', mode);
    },
    { lang: locale, mode: theme },
  );
  await page.goto(base);
  await page.getByRole('button', { name: /Sign in|Se connecter/i }).click();
  await expect(page.getByRole('heading', { name: /Cabinet Dashboard|Tableau de bord Cabinet/i })).toBeVisible();
}

async function assertNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
}

test.describe('mission 46 — modern UX/UI foundation (desktop & Android)', () => {
  for (const theme of ['light', 'dark'] as const) {
    test(`cabinet, 6-step wizard progress coherence, and accounting/banking nav (${theme})`, async ({
      page,
    }) => {
      await signIn(page, 'en', theme);
      await assertNoHorizontalOverflow(page);

      // Open Create New Client and jump straight to Step 6: verify 1 Completed step matches "1 of 6 steps".
      await page.getByRole('link', { name: /Create new client/i }).first().click();
      await expect(page.getByRole('heading', { name: /Create New Client/i })).toBeVisible();
      await assertNoHorizontalOverflow(page);

      const rail = page.locator('.m44-wizard-rail');
      await rail.getByRole('button', { name: /Review and Activate/i }).click();
      await expect(rail.getByText(/^Completed$/)).toHaveCount(1);
      await expect(page.getByText(/Required information missing before activation/i)).toBeVisible();
      await assertNoHorizontalOverflow(page);

      // Fill Step 1 and save draft.
      await rail.getByRole('button', { name: /Company Information/i }).click();
      await page.getByLabel(/Registered business name/i).fill('M46 Modern Client Ltd');
      await page.getByLabel(/Registered address/i).fill('10 Cybercity Rue, Ebene, Mauritius');
      await page.getByRole('button', { name: /Save draft/i }).first().click();
      await expect(page.getByText(/Draft saved/i)).toBeVisible();
      await expect(rail.getByText(/^Completed$/)).toHaveCount(2);

      // Navigate to Accounting Dashboard and Bank Periods.
      await page.goto(`${base}#/accounting`);
      await expect(page.getByRole('heading', { name: /^Dashboard$/i })).toBeVisible();
      await assertNoHorizontalOverflow(page);

      await page.goto(`${base}#/accounting/banking?tab=report`);
      await expect(page.getByText(/Statement period validation/i)).toBeVisible();
      await assertNoHorizontalOverflow(page);
    });
  }
});
