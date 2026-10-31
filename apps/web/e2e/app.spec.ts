import { expect, test, type Page } from '@playwright/test';

/**
 * End-to-end scenarios (Chromium) covering the critical accounting journey:
 * sign-up, company and account creation, entry capture, posting, general
 * ledger, trial balance, statements, CSV/PDF exports and language switching.
 *
 * Prerequisites and limitations: docs/browser-tests.md
 */

const unique = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
const password = 'E2ePassw0rd2026!';

async function register(page: Page, email: string) {
  await page.goto('/');
  await page.getByRole('button', { name: /Créer un compte|Create an account/ }).first().click();
  await page.getByLabel(/Nom complet|Full name/).fill('Testeur E2E');
  await page.getByLabel(/Adresse e-mail|Email/).fill(email);
  await page.getByLabel(/Mot de passe|Password/).fill(password);
  await page.getByRole('button', { name: /^Créer un compte$|^Create account$/ }).click();
  await expect(page.getByRole('heading', { name: /Tableau de bord|Dashboard/ })).toBeVisible();
}

async function login(page: Page, email: string) {
  await page.goto('/');
  await page.getByLabel(/Adresse e-mail|Email/).fill(email);
  await page.getByLabel(/Mot de passe|Password/).fill(password);
  await page.getByRole('button', { name: /Se connecter|Sign in/ }).click();
  await expect(page.getByRole('heading', { name: /Tableau de bord|Dashboard/ })).toBeVisible();
}

test('sign-up, empty dashboard and navigation', async ({ page }) => {
  await register(page, `e2e-${unique()}@example.test`);
  await expect(page.getByText(/Aucune société|No company/).first()).toBeVisible();

  await page.getByRole('link', { name: /Sociétés|Companies/ }).click();
  await expect(page.getByRole('heading', { name: /Sociétés|Companies/ })).toBeVisible();

  await page.getByRole('link', { name: /Plan comptable|Chart of accounts/ }).click();
  await expect(page.getByRole('heading', { name: /Plan comptable|Chart of accounts/ })).toBeVisible();
});

test('creates a company, captures and posts an entry, then reads the reports', async ({ page }) => {
  const email = `e2e-${unique()}@example.test`;
  await register(page, email);

  // ---------------------------------------------------------------- company
  await page.getByRole('link', { name: /Sociétés|Companies/ }).click();
  await page.getByRole('button', { name: /Nouvelle société|New company/ }).click();
  const companyName = `E2E Lagon ${unique()} Ltd`;
  await page.getByLabel(/^Nom$|^Name$/).fill(companyName);
  await page.getByLabel(/BRN/).fill(`E2E-BRN-${unique()}`);
  await page.getByRole('button', { name: /^(Enregistrer|Save|Créer|Create)$/ }).click();
  await expect(page.getByText(companyName).first()).toBeVisible();

  // ---------------------------------------------------------------- account
  await page.getByRole('link', { name: /Plan comptable|Chart of accounts/ }).click();
  await page.getByRole('button', { name: /Nouveau compte|New account/ }).click();
  await page.getByLabel(/^Code$/).fill('9999');
  await page.getByLabel(/^Nom$|^Name$/).fill('Compte E2E');
  await page.getByLabel(/Type/).selectOption('expense');
  await page.getByRole('button', { name: /^(Enregistrer|Save|Créer|Create)$/ }).click();
  await expect(page.getByText('9999').first()).toBeVisible();

  // ------------------------------------------------------------------ entry
  await page.getByRole('link', { name: /Écritures|Entries/ }).click();
  await page.getByRole('button', { name: /Nouvelle écriture|New entry/ }).click();
  const form = page.locator('.modal');
  await form.getByLabel(/Journal/).selectOption({ index: 0 });
  await form.getByLabel(/Description/).fill('Écriture E2E (fictive)');
  const accountSelects = form.locator('.entry-line select');
  await accountSelects.nth(0).selectOption({ label: /1010/ });
  await accountSelects.nth(1).selectOption({ label: /4000/ });
  await form.locator('.entry-line input[aria-label="Débit"], .entry-line input[aria-label="Debit"]').nth(0).fill('1000.00');
  await form.locator('.entry-line input[aria-label="Crédit"], .entry-line input[aria-label="Credit"]').nth(0).fill('1000.00');
  await expect(form.getByText(/Équilibrée|Balanced/)).toBeVisible();
  await form.getByRole('button', { name: /Enregistrer et valider|Save and post/ }).click();

  // The posted entry appears in the list and cannot be edited any more.
  await expect(page.getByText('Écriture E2E (fictive)')).toBeVisible();
  await page.getByText('Écriture E2E (fictive)').click();
  await expect(page.getByText(/Écriture validée|Posted entries are locked|ne peut plus être modifiée/).first()).toBeVisible();
  await page.keyboard.press('Escape');

  // --------------------------------------------------------------- reports
  await page.getByRole('link', { name: /Grand livre|General ledger/ }).click();
  await expect(page.getByText(/1010/).first()).toBeVisible();

  await page.getByRole('link', { name: /Balance|Trial balance/ }).click();
  await expect(page.getByText(/Balance équilibrée|Trial balance is balanced/).first()).toBeVisible();

  await page.getByRole('link', { name: /États financiers|Financial statements/ }).click();
  await expect(page.getByText(/Situation financière|Statement of Financial Position/).first()).toBeVisible();
});

test('exports CSV and PDF over the authenticated API', async ({ page, request }) => {
  const email = `e2e-${unique()}@example.test`;
  await register(page, email);

  const companies = await request.get('/api/companies');
  expect(companies.ok()).toBeTruthy();
  const { companies: list } = await companies.json();
  expect(list.length).toBeGreaterThan(0);
  const companyId = list[0].id;

  const csv = await request.get(`/api/companies/${companyId}/reports/trial-balance?format=csv`);
  expect(csv.ok()).toBeTruthy();
  expect(csv.headers()['content-type']).toContain('text/csv');
  expect(await csv.text()).toContain('DÉMONSTRATION');

  const pdf = await request.get(`/api/companies/${companyId}/reports/statements?format=pdf`);
  expect(pdf.ok()).toBeTruthy();
  expect(pdf.headers()['content-type']).toBe('application/pdf');
  expect((await pdf.body()).subarray(0, 5).toString()).toBe('%PDF-');
});

test('switches the interface language FR -> EN', async ({ page }) => {
  const email = `e2e-${unique()}@example.test`;
  await register(page, email);

  await page.getByLabel(/Langue|Language/).selectOption('en');
  await expect(page.getByRole('link', { name: 'Dashboard' })).toBeVisible();
  await page.getByLabel(/Langue|Language/).selectOption('fr');
  await expect(page.getByRole('link', { name: /Tableau de bord/ })).toBeVisible();
});

test('mobile navigation drawer opens and closes', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-chromium', 'mobile project only');
  const email = `e2e-${unique()}@example.test`;
  await register(page, email);

  const menu = page.getByRole('button', { name: /Menu/ });
  await menu.click();
  await expect(page.getByRole('link', { name: /Sociétés|Companies/ })).toBeVisible();
  await page.getByRole('link', { name: /Sociétés|Companies/ }).click();
  await expect(page.getByRole('heading', { name: /Sociétés|Companies/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /Sociétés|Companies/ })).toBeHidden();
});
