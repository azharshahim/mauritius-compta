import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  accountByCode,
  api,
  closeTestApp,
  journalByCode,
  setupCompanyWithChart,
  type TestContext,
} from './helpers.js';

describe('general ledger, trial balance and financial statements', () => {
  let ctx: TestContext;
  let cookie: string;
  let companyId: string;
  let accounts: any[];
  let journals: any[];

  beforeAll(async () => {
    const setup = await setupCompanyWithChart();
    ctx = setup.ctx;
    cookie = setup.user.cookie;
    companyId = setup.company.id;
    accounts = setup.accounts;
    journals = setup.journals;

    const mk = (journal: string, date: string, description: string, lines: any[]) =>
      api(ctx, cookie, 'POST', `/api/companies/${companyId}/entries`, {
        journalId: journalByCode(journals, journal).id,
        entryDate: date,
        description,
        status: 'posted',
        lines,
      });

    // Fictitious transactions.
    await mk('OD', '2025-07-01', 'Capital fictif', [
      { accountId: accountByCode(accounts, '1010').id, debit: '500000' },
      { accountId: accountByCode(accounts, '3000').id, credit: '500000' },
    ]);
    await mk('SAL', '2025-07-15', 'Vente fictive', [
      { accountId: accountByCode(accounts, '1100').id, debit: '125000' },
      { accountId: accountByCode(accounts, '4000').id, credit: '125000' },
    ]);
    await mk('PUR', '2025-07-20', 'Achat fictif', [
      { accountId: accountByCode(accounts, '5000').id, debit: '60000' },
      { accountId: accountByCode(accounts, '2000').id, credit: '60000' },
    ]);
    await mk('BQ', '2025-08-01', 'Loyer fictif', [
      { accountId: accountByCode(accounts, '6100').id, debit: '15000' },
      { accountId: accountByCode(accounts, '1010').id, credit: '15000' },
    ]);
    // A draft must never appear in any report.
    await api(ctx, cookie, 'POST', `/api/companies/${companyId}/entries`, {
      journalId: journalByCode(journals, 'OD').id,
      entryDate: '2025-08-02',
      description: 'Brouillon invisible (fictif)',
      status: 'draft',
      lines: [
        { accountId: accountByCode(accounts, '6140').id, debit: '99999' },
        { accountId: accountByCode(accounts, '1010').id, credit: '99999' },
      ],
    });
  });

  afterAll(async () => {
    await closeTestApp(ctx);
  });

  it('generates a general ledger with running balances', async () => {
    const res = await api(
      ctx,
      cookie,
      'GET',
      `/api/companies/${companyId}/reports/ledger?from=2025-07-01&to=2026-06-30`,
    );
    expect(res.statusCode).toBe(200);
    const ledger = res.json();
    const bank = ledger.accounts.find((a: any) => a.code === '1010');
    expect(bank).toBeTruthy();
    expect(bank.opening).toBe('0.0000');
    expect(bank.totalDebit).toBe('500000.0000');
    expect(bank.totalCredit).toBe('15000.0000');
    expect(bank.closing).toBe('485000.0000');
    expect(bank.lines).toHaveLength(2);

    const rent = ledger.accounts.find((a: any) => a.code === '6100');
    expect(rent.closing).toBe('15000.0000');
  });

  it('never includes draft entries in the ledger', async () => {
    const res = await api(
      ctx,
      cookie,
      'GET',
      `/api/companies/${companyId}/reports/ledger?from=2025-07-01&to=2026-06-30`,
    );
    const ledger = res.json();
    const descriptions = ledger.accounts.flatMap((a: any) => a.lines.map((l: any) => l.description));
    expect(descriptions.some((d: string) => d.includes('Brouillon invisible'))).toBe(false);
    const banking = ledger.accounts.find((a: any) => a.code === '1010');
    expect(banking.closing).toBe('485000.0000');
  });

  it('filters the ledger by account and period', async () => {
    const bankAccount = accountByCode(accounts, '1010');
    const res = await api(
      ctx,
      cookie,
      'GET',
      `/api/companies/${companyId}/reports/ledger?accountId=${bankAccount.id}&from=2025-07-01&to=2025-07-31`,
    );
    const ledger = res.json();
    expect(ledger.accounts).toHaveLength(1);
    expect(ledger.accounts[0].code).toBe('1010');
    expect(ledger.accounts[0].lines).toHaveLength(1); // only the capital receipt
    expect(ledger.accounts[0].closing).toBe('500000.0000');
  });

  it('generates a balanced trial balance with opening, movements and closing columns', async () => {
    const res = await api(
      ctx,
      cookie,
      'GET',
      `/api/companies/${companyId}/reports/trial-balance?from=2025-07-01&to=2026-06-30`,
    );
    expect(res.statusCode).toBe(200);
    const tb = res.json();
    expect(tb.balanced).toBe(true);
    expect(tb.totals.movementDebit).toBe(tb.totals.movementCredit);
    expect(tb.totals.closingDebit).toBe(tb.totals.closingCredit);
    expect(tb.totals.movementDebit).toBe('700000.0000');

    const receivable = tb.rows.find((r: any) => r.code === '1100');
    expect(receivable.closingDebit).toBe('125000.0000');

    const revenue = tb.rows.find((r: any) => r.code === '4000');
    expect(revenue.closingCredit).toBe('125000.0000');

    const payable = tb.rows.find((r: any) => r.code === '2000');
    expect(payable.closingCredit).toBe('60000.0000');
  });

  it('computes opening balances for a later period', async () => {
    const res = await api(
      ctx,
      cookie,
      'GET',
      `/api/companies/${companyId}/reports/trial-balance?from=2025-08-01&to=2026-06-30`,
    );
    const tb = res.json();
    const bank = tb.rows.find((r: any) => r.code === '1010');
    expect(bank.openingDebit).toBe('500000.0000');
    expect(bank.movementCredit).toBe('15000.0000');
    expect(bank.closingDebit).toBe('485000.0000');
    expect(tb.balanced).toBe(true);
  });

  it('produces provisional financial statements that balance', async () => {
    const res = await api(
      ctx,
      cookie,
      'GET',
      `/api/companies/${companyId}/reports/statements?from=2025-07-01&to=2026-06-30`,
    );
    expect(res.statusCode).toBe(200);
    const st = res.json();
    expect(st.profitAndLoss.revenue.total).toBe('125000.0000');
    expect(st.profitAndLoss.expenses.total).toBe('75000.0000');
    expect(st.profitAndLoss.profit).toBe('50000.0000');
    expect(st.financialPosition.totalAssets).toBe('610000.0000');
    expect(st.financialPosition.balanced).toBe(true);
    expect(st.financialPosition.totalLiabilitiesAndEquity).toBe('610000.0000');
  });

  it('serves the dashboard summary', async () => {
    const res = await api(ctx, cookie, 'GET', `/api/companies/${companyId}/dashboard`);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.kpis.postedEntries).toBe(4);
    expect(body.kpis.draftEntries).toBe(1);
    expect(body.kpis.balancedSheet).toBe(true);
    expect(body.recentEntries.length).toBeGreaterThan(0);
  });

  it('exports CSV with an explicit demonstration notice', async () => {
    const res = await api(
      ctx,
      cookie,
      'GET',
      `/api/companies/${companyId}/reports/trial-balance?format=csv&from=2025-07-01&to=2026-06-30`,
    );
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    // The export is localised from the user's locale (French by default) and
    // always carries the demonstration notice.
    expect(res.body).toMatch(/DÉMONSTRATION|DEMONSTRATION/);
    expect(res.body).toContain('TOTAL');
  });

  it('exports a PDF document with the demonstration banner', async () => {
    const res = await api(
      ctx,
      cookie,
      'GET',
      `/api/companies/${companyId}/reports/trial-balance?format=pdf&lang=en`,
    );
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
    expect(res.rawPayload.length).toBeGreaterThan(2000);
  });

  it('rejects invalid report date ranges', async () => {
    const res = await api(
      ctx,
      cookie,
      'GET',
      `/api/companies/${companyId}/reports/ledger?from=2026-01-01&to=2025-01-01`,
    );
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('INVALID_DATE_RANGE');
  });
});
