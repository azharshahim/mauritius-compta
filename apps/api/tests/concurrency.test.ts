/**
 * Concurrency tests.
 *
 * They need a real PostgreSQL server (several connections issuing statements at
 * the same time); PGlite runs single-connection, so the suite is skipped unless
 * TEST_DATABASE_URL is set (see the `postgres-tests` GitHub Actions job).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
  usingRealPostgres,
  type TestContext,
} from './helpers.js';

const suite = usingRealPostgres ? describe : describe.skip;

suite('concurrency (real PostgreSQL)', () => {
  let ctx: TestContext;
  let cookie: string;
  let companyId: string;
  let accounts: any[];
  let journals: any[];

  beforeAll(async () => {
    ctx = await createTestApp({ STORAGE_DIR: './.test-storage-concurrency' });
    const user = await registerUser(ctx);
    cookie = user.cookie;
    const company = await createCompany(ctx, cookie, { name: 'Concurrence (fictive)' });
    companyId = company.id;
    accounts = await getAccounts(ctx, cookie, companyId);
    journals = await getJournals(ctx, cookie, companyId);
  });

  afterAll(async () => {
    await closeTestApp(ctx);
  });

  const payload = (date: string, reference?: string) => ({
    journalId: journalByCode(journals, 'SAL').id,
    entryDate: date,
    description: 'Écriture concurrente (fictive)',
    reference,
    status: 'posted',
    lines: [
      { accountId: accountByCode(accounts, '1100').id, debit: '100' },
      { accountId: accountByCode(accounts, '4000').id, credit: '100' },
    ],
  });

  it('allocates unique sequential entry numbers in parallel', async () => {
    const responses = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        api(ctx, cookie, 'POST', `/api/companies/${companyId}/entries`, payload(`2025-09-0${(i % 8) + 1}`)),
      ),
    );
    for (const res of responses) expect(res.statusCode).toBe(201);
    const numbers = responses.map((r) => r.json().entry.entry_no);
    expect(new Set(numbers).size).toBe(numbers.length);
    expect(numbers.every((n) => /^SAL-\d{4}-\d{4}$/.test(n))).toBe(true);
  });

  it('reverses an entry only once when two reversals race', async () => {
    const created = await api(ctx, cookie, 'POST', `/api/companies/${companyId}/entries`, payload('2025-09-15'));
    expect(created.statusCode).toBe(201);
    const entryId = created.json().entry.id;

    const results = await Promise.all([
      api(ctx, cookie, 'POST', `/api/companies/${companyId}/entries/${entryId}/reverse`, {}),
      api(ctx, cookie, 'POST', `/api/companies/${companyId}/entries/${entryId}/reverse`, {}),
    ]);
    const codes = results.map((r) => r.statusCode).sort();
    expect(codes).toEqual([201, 409]);

    const reversals = await ctx.db.query(
      'SELECT id FROM journal_entries WHERE reversal_of_entry_id = $1',
      [entryId],
    );
    expect(reversals.rowCount).toBe(1);
  });

  it('accepts a reference only once when two entries race', async () => {
    const results = await Promise.all([
      api(ctx, cookie, 'POST', `/api/companies/${companyId}/entries`, payload('2025-09-20', 'RACE-REF-1')),
      api(ctx, cookie, 'POST', `/api/companies/${companyId}/entries`, payload('2025-09-21', 'RACE-REF-1')),
    ]);
    const codes = results.map((r) => r.statusCode).sort();
    expect(codes).toEqual([201, 409]);
  });

  it('keeps the trial balance balanced with parallel postings', async () => {
    const tb = await api(
      ctx,
      cookie,
      'GET',
      `/api/companies/${companyId}/reports/trial-balance?from=2025-07-01&to=2026-06-30`,
    );
    expect(tb.statusCode).toBe(200);
    expect(tb.json().balanced).toBe(true);
  });
});
