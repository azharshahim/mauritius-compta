import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end configuration (Chromium).
 *
 * The suite expects the API (port 3000) and the Vite dev server (port 5173) to
 * be running. Start them first:
 *
 *   npm run dev            # API + web
 *   npx playwright install --with-deps chromium
 *   npm run test:e2e -w @mc/web
 *
 * See docs/browser-tests.md: these tests could not be executed in the audit
 * sandbox because no Chromium binary and no browser-download network access
 * were available; the procedure is documented so the owner can run them.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    locale: 'fr-FR',
    timezoneId: 'Indian/Mauritius',
  },
  projects: [
    {
      // Representative Windows/FHD browser window.
      name: 'desktop-chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    {
      // Representative Android phone (Chrome).
      name: 'mobile-chromium',
      use: { ...devices['Pixel 7'] },
    },
  ],
});
