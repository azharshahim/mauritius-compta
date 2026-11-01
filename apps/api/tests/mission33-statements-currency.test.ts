/**
 * Mission 33 — P0-01: financial statements must never be labelled in a
 * presentation currency that differs from the currency of the computed amounts.
 *
 * The regression is reproduced with a company whose functional currency is MUR
 * and whose presentation currency is EUR. Before the correction the API
 * returned `currency: "EUR"` while every amount was still in MUR.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import {
  accountByCode,
  api,
  closeTestApp,
  createCompany,
  createTestApp,
  getAccounts,
  getJournals,
  journalByCode,
  registerUser,
  type TestContext,
} from './helpers.js';

let ctx: TestContext;
let sequence = 0;

interface Scenario {
  user: { cookie: string; id: string };
  company: any;
  accounts: any[];
  journals: any[];
}

async function post(
  scenario: Scenario,
  date: string,
  description: string,
  lines: { code: string; debit?: string; credit?: string }[],
) {
  const res = await api(ctx, scenario.user.cookie, 'POST', `/api/companies/${scenario.company.id}/entries`, {
    journalId: journalByCode(scenario.journals, 'OD').id,
    entryDate: date,
    description,
    status: 'posted',
    lines: lines.map((line) => ({
      accountId: accountByCode(scenario.accounts, line.code).id,
      debit: line.debit,
      credit: line.credit,
    })),
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().entry;
}

async function scenario(
  functionalCurrency: string,
  presentationCurrency: string,
  options: { secondYear?: boolean } = {},
): Promise<Scenario> {
  sequence += 1;
  const user = await registerUser(ctx);
  const company = await createCompany(ctx, user.cookie, {
    name: `Mission 33 société ${sequence} (fictive)`,
    brn: `M33-BRN-${sequence}`,
    functionalCurrency,
    presentationCurrency,
  });
  const accounts = await getAccounts(ctx, user.cookie, company.id);
  const journals = await getJournals(ctx, user.cookie, company.id);
  const s: Scenario = { user, company, accounts, journals };

  await post(s, '2025-07-01', 'Capital fictif', [
    { code: '1010', debit: '100000' },
    { code: '3000', credit: '100000' },
  ]);
  await post(s, '2025-07-15', 'Vente fictive', [
    { code: '1100', debit: '50000' },
    { code: '4000', credit: '50000' },
  ]);
  await post(s, '2025-07-20', 'Charge fictive', [
    { code: '6000', debit: '15000' },
    { code: '1010', credit: '15000' },
  ]);

  if (options.secondYear) {
    const period = await api(ctx, user.cookie, 'POST', `/api/companies/${company.id}/periods`, {
      name: 'Exercice 2026/27 (fictif)',
      startDate: '2026-07-01',
      endDate: '2027-06-30',
    });
    expect(period.statusCode, period.body).toBe(201);
    await post(s, '2026-07-05', 'Vente exercice suivant (fictive)', [
      { code: '1010', debit: '10000' },
      { code: '4000', credit: '10000' },
    ]);
  }

  return s;
}

async function statements(s: Scenario, from = '2025-07-01', to = '2026-06-30') {
  const res = await api(
    ctx,
    s.user.cookie,
    'GET',
    `/api/companies/${s.company.id}/reports/statements?from=${from}&to=${to}`,
  );
  expect(res.statusCode, res.body).toBe(200);
  return res.json();
}

async function pdfText(bytes: Uint8Array): Promise<string> {
  const doc = await getDocument({
    data: bytes,
    useWorkerFetch: false,
    disableFontFace: true,
    verbosity: 0,
  }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i += 1) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    pages.push(content.items.map((item: any) => item.str ?? '').join(' '));
  }
  await doc.cleanup();
  return pages.join('\n');
}

describe('mission 33 — devise des états financiers', () => {
  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await closeTestApp(ctx);
  });

  it('reproduces the anomaly then keeps MUR amounts when presentation is EUR', async () => {
    const same = await scenario('MUR', 'MUR');
    const different = await scenario('MUR', 'EUR');

    const sameStatements = await statements(same);
    const differentStatements = await statements(different);

    // The amounts are identical: no invented conversion rate is applied.
    expect(differentStatements.profitAndLoss.revenue.total).toBe(sameStatements.profitAndLoss.revenue.total);
    expect(differentStatements.profitAndLoss.expenses.total).toBe(sameStatements.profitAndLoss.expenses.total);
    expect(differentStatements.profitAndLoss.profit).toBe('35000.0000');
    expect(differentStatements.financialPosition.totalAssets).toBe('135000.0000');

    // The currency label now follows the amounts, not the configuration.
    expect(differentStatements.currency).toBe('MUR');
    expect(differentStatements.functionalCurrency).toBe('MUR');
    expect(differentStatements.presentationCurrency).toBe('EUR');
    expect(differentStatements.presentationCurrencyApplied).toBe(false);
    expect(differentStatements.currencyBasis).toBe('functional_currency');

    expect(sameStatements.currency).toBe('MUR');
    expect(sameStatements.presentationCurrency).toBe('MUR');
    expect(sameStatements.presentationCurrencyApplied).toBe(true);

    // The configured presentation currency is preserved, not silently replaced.
    const company = await api(ctx, different.user.cookie, 'GET', `/api/companies/${different.company.id}`);
    expect(company.json().company.presentation_currency).toBe('EUR');
  });

  it('keeps EUR amounts when the functional currency is EUR and presentation is MUR', async () => {
    const s = await scenario('EUR', 'MUR');
    const st = await statements(s);
    expect(st.currency).toBe('EUR');
    expect(st.functionalCurrency).toBe('EUR');
    expect(st.presentationCurrency).toBe('MUR');
    expect(st.presentationCurrencyApplied).toBe(false);
    expect(st.profitAndLoss.profit).toBe('35000.0000');
    expect(st.financialPosition.balanced).toBe(true);
  });

  it('handles a presentation-currency change made after company creation', async () => {
    const s = await scenario('MUR', 'MUR');
    const patch = await api(ctx, s.user.cookie, 'PATCH', `/api/companies/${s.company.id}`, {
      presentationCurrency: 'EUR',
    });
    expect(patch.statusCode, patch.body).toBe(200);
    expect(patch.json().company.presentation_currency).toBe('EUR');

    const st = await statements(s);
    expect(st.currency).toBe('MUR');
    expect(st.presentationCurrency).toBe('EUR');
    expect(st.presentationCurrencyApplied).toBe(false);
    expect(st.financialPosition.balanced).toBe(true);
  });

  it('keeps both exercises and the result identical across periods', async () => {
    const s = await scenario('MUR', 'EUR', { secondYear: true });
    const st = await statements(s, '2025-07-01', '2027-06-30');
    expect(st.currency).toBe('MUR');
    expect(st.profitAndLoss.revenue.total).toBe('60000.0000');
    expect(st.profitAndLoss.expenses.total).toBe('15000.0000');
    expect(st.profitAndLoss.profit).toBe('45000.0000');
    expect(st.financialPosition.totalAssets).toBe('145000.0000');
    expect(st.financialPosition.balanced).toBe(true);
  });

  it('does not modify journal lines or break the trial balance', async () => {
    const s = await scenario('MUR', 'EUR');
    const before = await ctx.db.query<{ count: string; debit: string; credit: string }>(
      `SELECT count(*)::text AS count,
              COALESCE(SUM(l.debit), 0)::text AS debit,
              COALESCE(SUM(l.credit), 0)::text AS credit
         FROM journal_lines l
         JOIN journal_entries e ON e.id = l.entry_id
        WHERE e.company_id = $1`,
      [s.company.id],
    );

    const st = await statements(s);
    expect(st.financialPosition.balanced).toBe(true);

    const tb = await api(
      ctx,
      s.user.cookie,
      'GET',
      `/api/companies/${s.company.id}/reports/trial-balance?from=2025-07-01&to=2026-06-30`,
    );
    expect(tb.statusCode, tb.body).toBe(200);
    expect(tb.json().balanced).toBe(true);
    expect(tb.json().currency).toBe('MUR');

    const after = await ctx.db.query<{ count: string; debit: string; credit: string }>(
      `SELECT count(*)::text AS count,
              COALESCE(SUM(l.debit), 0)::text AS debit,
              COALESCE(SUM(l.credit), 0)::text AS credit
         FROM journal_lines l
         JOIN journal_entries e ON e.id = l.entry_id
        WHERE e.company_id = $1`,
      [s.company.id],
    );
    expect(after.rows[0]).toEqual(before.rows[0]);
  });

  it('states the functional currency explicitly in the CSV export', async () => {
    const s = await scenario('MUR', 'EUR');
    const res = await api(
      ctx,
      s.user.cookie,
      'GET',
      `/api/companies/${s.company.id}/reports/statements?format=csv&lang=en&from=2025-07-01&to=2026-06-30`,
    );
    expect(res.statusCode, res.body).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.body).toContain('Currency;MUR');
    expect(res.body).toContain('50000.0000');
    expect(res.body).not.toContain('Currency;EUR');
  });

  it('prints the functional currency and the not-applied notice in the PDF', async () => {
    const s = await scenario('MUR', 'EUR');
    const res = await api(
      ctx,
      s.user.cookie,
      'GET',
      `/api/companies/${s.company.id}/reports/statements?format=pdf&lang=en&from=2025-07-01&to=2026-06-30`,
    );
    expect(res.statusCode, res.body).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    const text = await pdfText(new Uint8Array(res.rawPayload));
    expect(text).toContain('Currency: MUR');
    expect(text).toContain('Amounts in MUR');
    expect(text).toContain('Presentation currency not applied to this report: EUR');
    expect(text).not.toContain('Currency: EUR');
    expect(text).not.toContain('Amounts in EUR');
  });
});
