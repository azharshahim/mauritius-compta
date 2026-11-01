import { expect, test, type Page } from '@playwright/test';

/**
 * Mission 44 — Accountant Workspace, real browser journeys.
 *
 * These scenarios are written for the **demo build** (client-side simulation,
 * no API, no database): the fictional cabinet, its three seeded clients and the
 * draft list are the only data they touch, so nothing can reach a real company.
 *
 * Execution status: **not executed in the assistant sandbox**. No Chromium
 * binary and no browser-download network access were available there
 * (`docs/mission-44-report.md`, section 8). To run them:
 *
 *   npm run build:demo -w @mc/web
 *   npx vite preview -w @mc/web --port 4173      # serves dist/ under /mauritius-compta/
 *   E2E_BASE_URL=http://localhost:4173/mauritius-compta/ npm run test:e2e -w @mc/web
 *
 * Both projects declared in `playwright.config.ts` (desktop 1440×900 and the
 * Android Pixel 7 profile) run the file; the mobile project additionally checks
 * that no horizontal overflow appears on the dashboard or in the wizard.
 */

const base = process.env.E2E_BASE_URL ?? 'http://localhost:4173/mauritius-compta/';

async function openCabinet(page: Page, locale: 'fr' | 'en' = 'fr') {
  await page.addInitScript((lang) => localStorage.setItem('mc.locale', lang), locale);
  await page.goto(base);
  await page.getByRole('button', { name: /Se connecter|Sign in/ }).click();
  await expect(page.getByRole('heading', { name: /Tableau de bord Cabinet|Cabinet dashboard/ })).toBeVisible();
}

test.describe('mission 44 — cabinet portfolio and guided creation', () => {
  test('portfolio, filters and the seven indicators', async ({ page }) => {
    await openCabinet(page);
    await expect(page.getByText(/Clients au total|Total clients/)).toBeVisible();
    await expect(page.getByText(/Case Noyale Retail Ltd \(DEMO\)/).filter({ visible: true })).toBeVisible();
    await page.getByLabel(/Rechercher un client|Search a client/).fill('Belle Mare');
    await expect(page.getByText(/Belle Mare Hospitality Ltd \(DEMO\)/).filter({ visible: true })).toBeVisible();
    await expect(page.getByText(/Case Noyale Retail Ltd \(DEMO\)/).filter({ visible: true })).toHaveCount(0);
    await page.getByLabel(/Rechercher un client|Search a client/).fill('');
    await page.getByLabel(/Secteur d’activité|Business sector/).selectOption('trading_retail');
    await expect(page.getByText(/Case Noyale Retail Ltd \(DEMO\)/).filter({ visible: true })).toBeVisible();
  });

  test('six steps, draft save and resume', async ({ page }) => {
    await openCabinet(page);
    await page.getByRole('link', { name: /Nouveau client|Create New Client/ }).click();
    await expect(page.getByRole('heading', { name: /Créer un nouveau client|Create New Client/ })).toBeVisible();

    await page.getByLabel(/Raison sociale enregistrée|Registered business name/).fill('E2E Fictional Ltd');
    await page.getByLabel(/Adresse du siège|Registered address/).fill('12, E2E Street (fictional)');
    await page.getByRole('button', { name: /Enregistrer le brouillon|Save draft/ }).first().click();
    await expect(page.getByText(/Brouillon enregistré|Draft saved/)).toBeVisible();
    await page.getByRole('button', { name: /Annuler|Cancel/ }).click();
    await expect(page.getByRole('heading', { name: /Tableau de bord Cabinet|Cabinet dashboard/ })).toBeVisible();
    await page.getByRole('link', { name: /Reprendre|Resume/ }).first().click();
    await expect(page.getByLabel(/Raison sociale enregistrée|Registered business name/)).toHaveValue(
      'E2E Fictional Ltd',
    );
  });

  test('full activation opens the client workspace with its eight domains', async ({ page }) => {
    await openCabinet(page);
    await page.getByRole('link', { name: /Nouveau client|Create New Client/ }).click();
    await page.getByLabel(/Raison sociale enregistrée|Registered business name/).fill('E2E Workspace Ltd');
    await page.getByLabel(/Adresse du siège|Registered address/).fill('7, Workspace Road (fictional)');
    await page.getByRole('button', { name: /Étape suivante|Next step/ }).click();
    // KYC — checklist only, never a legal validation.
    await expect(page.getByText(/Liste de contrôle uniquement|Checklist only/)).toBeVisible();
    await page.getByRole('button', { name: /Étape suivante|Next step/ }).click();
    await page.getByRole('button', { name: /Commerce et distribution|Trading & Retail/ }).click();
    await page.getByRole('button', { name: /Étape suivante|Next step/ }).click();
    await expect(page.getByText(/Seule la comptabilité d’engagement|Accrual basis only/)).toBeVisible();
    await page.getByRole('button', { name: /Étape suivante|Next step/ }).click();
    await expect(page.getByText(/Partiel|Partial/).first()).toBeVisible();
    await expect(page.getByText(/Disponible|Available/).first()).toBeVisible();
    await page.getByRole('button', { name: /Étape suivante|Next step/ }).click();
    await page.getByRole('button', { name: /Activer le dossier client|Activate client file/ }).click();
    await expect(page.getByRole('heading', { name: 'E2E Workspace Ltd' })).toBeVisible();
    await expect(page.getByText(/Les huit domaines fonctionnels|The eight functional domains/)).toBeVisible();
  });

  test('no horizontal overflow on a phone', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-chromium', 'mobile-only layout check');
    await openCabinet(page);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
    await page.getByRole('link', { name: /Nouveau client|Create New Client/ }).click();
    const wizardOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(wizardOverflow).toBeLessThanOrEqual(1);
  });
});
