/**
 * Non-regression tests for the anomalies found during the V0.1.1 audit.
 * Every fix is covered by at least one test here (see docs/audit-v0.1.1.md).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
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

describe('V0.1.1 regressions', () => {
  let ctx: TestContext;
  let cookie: string;
  let companyId: string;
  let accounts: any[];
  let journals: any[];

  const acc = (code: string) => accountByCode(accounts, code);
  const jnl = (code: string) => journalByCode(journals, code);

  const entry = (overrides: Record<string, unknown> = {}) => ({
    journalId: jnl('OD').id,
    entryDate: '2025-08-01',
    description: 'Écriture de test (fictive)',
    status: 'posted',
    lines: [
      { accountId: acc('1010').id, debit: '100.0000' },
      { accountId: acc('3000').id, credit: '100.0000' },
    ],
    ...overrides,
  });

  const boot = async () => {
    ctx = await createTestApp({ STORAGE_DIR: './.test-storage-regressions' });
    const user = await registerUser(ctx);
    cookie = user.cookie;
    const company = await createCompany(ctx, cookie);
    companyId = company.id;
    accounts = await getAccounts(ctx, cookie, companyId);
    journals = await getJournals(ctx, cookie, companyId);
  };
  beforeAll(async () => {
    await boot();
  });

  afterAll(async () => {
    await closeTestApp(ctx);
  });

  // 1 -------------------------------------------------------------- period
  it('opens an accounting period even when the default chart is skipped', async () => {
    const noChart = await createCompany(ctx, cookie, {
      name: 'Sans plan comptable (fictif)',
      withDefaultChart: false,
    });
    const periods = await api(ctx, cookie, 'GET', `/api/companies/${noChart.id}/periods`);
    expect(periods.statusCode).toBe(200);
    expect(periods.json().periods).toHaveLength(1);

    const journalsWithoutChart = await getJournals(ctx, cookie, noChart.id);
    const created = await api(ctx, cookie, 'POST', `/api/companies/${noChart.id}/accounts`, {
      code: '1010',
      name: 'Banque',
      type: 'asset',
      fsMapping: 'bs.current_assets.cash_and_equivalents',
    });
    const other = await api(ctx, cookie, 'POST', `/api/companies/${noChart.id}/accounts`, {
      code: '3000',
      name: 'Capital',
      type: 'equity',
      fsMapping: 'bs.equity.share_capital',
    });
    expect(created.statusCode).toBe(201);
    expect(other.statusCode).toBe(201);

    const posted = await api(ctx, cookie, 'POST', `/api/companies/${noChart.id}/entries`, {
      journalId: journalByCode(journalsWithoutChart, 'OD').id,
      entryDate: '2025-08-01',
      description: 'Première écriture',
      status: 'posted',
      lines: [
        { accountId: created.json().account.id, debit: '10' },
        { accountId: other.json().account.id, credit: '10' },
      ],
    });
    expect(posted.statusCode).toBe(201);
  });

  // 2 ----------------------------------------------------------- renumbering
  it('renumbers a draft moved to another journal or financial year', async () => {
    const draft = await api(ctx, cookie, 'POST', `/api/companies/${companyId}/entries`, {
      ...entry({ status: 'draft', entryDate: '2025-08-02' }),
    });
    expect(draft.statusCode).toBe(201);
    expect(draft.json().entry.entry_no).toMatch(/^OD-2025-/);

    const moved = await api(
      ctx,
      cookie,
      'PATCH',
      `/api/companies/${companyId}/entries/${draft.json().entry.id}`,
      { journalId: jnl('BQ').id, entryDate: '2026-02-01' },
    );
    expect(moved.statusCode).toBe(200);
    expect(moved.json().entry.entry_no).toMatch(/^BQ-2026-/);
    expect(moved.json().entry.entry_no).not.toBe(draft.json().entry.entry_no);
  });

  // 3/4 ------------------------------------------------------- rate handling
  it('requires a dated rate when switching a draft to a foreign currency', async () => {
    const draft = await api(ctx, cookie, 'POST', `/api/companies/${companyId}/entries`, {
      ...entry({ status: 'draft' }),
    });
    const id = draft.json().entry.id;

    const withoutRate = await api(ctx, cookie, 'PATCH', `/api/companies/${companyId}/entries/${id}`, {
      currency: 'EUR',
      lines: [
        { accountId: acc('1010').id, debit: '1000' },
        { accountId: acc('3000').id, credit: '1000' },
      ],
    });
    expect(withoutRate.statusCode).toBe(400);
    expect(withoutRate.json().error.code).toBe('EXCHANGE_RATE_REQUIRED');

    const withRate = await api(ctx, cookie, 'PATCH', `/api/companies/${companyId}/entries/${id}`, {
      currency: 'EUR',
      exchangeRate: '48.5000',
      lines: [
        { accountId: acc('1010').id, debit: '1000' },
        { accountId: acc('3000').id, credit: '1000' },
      ],
    });
    expect(withRate.statusCode).toBe(200);
    expect(withRate.json().entry.exchange_rate).toBe('48.50000000');
    expect(withRate.json().lines[0].debit).toBe('48500.0000');

    // Switching back to the functional currency needs no new rate.
    const backToFunctional = await api(
      ctx,
      cookie,
      'PATCH',
      `/api/companies/${companyId}/entries/${id}`,
      {
        currency: 'MUR',
        lines: [
          { accountId: acc('1010').id, debit: '1000' },
          { accountId: acc('3000').id, credit: '1000' },
        ],
      },
    );
    expect(backToFunctional.statusCode).toBe(200);
    expect(backToFunctional.json().entry.exchange_rate).toBe('1.00000000');
  });

  // 5/6/7 ------------------------------------------------------- validation
  it('rejects an unsupported currency', async () => {
    const res = await api(ctx, cookie, 'POST', `/api/companies/${companyId}/entries`, {
      ...entry({ currency: 'XXX', exchangeRate: '2' }),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('INVALID_CURRENCY');
  });

  it('rejects amounts with more than four decimals instead of rounding silently', async () => {
    const res = await api(ctx, cookie, 'POST', `/api/companies/${companyId}/entries`, {
      ...entry({
        lines: [
          { accountId: acc('1010').id, debit: '10.12345' },
          { accountId: acc('3000').id, credit: '10.12345' },
        ],
      }),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a foreign amount that rounds to zero in the functional currency', async () => {
    const res = await api(ctx, cookie, 'POST', `/api/companies/${companyId}/entries`, {
      journalId: jnl('OD').id,
      entryDate: '2025-08-03',
      description: 'Micro-montant',
      currency: 'USD',
      exchangeRate: '0.0100',
      lines: [
        { accountId: acc('1010').id, debit: '0.0001' },
        { accountId: acc('3000').id, credit: '0.0001' },
      ],
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
  });

  // 8 -------------------------------------------------------- references
  it('enforces unique references per company (case-insensitive)', async () => {
    const first = await api(ctx, cookie, 'POST', `/api/companies/${companyId}/entries`, {
      ...entry({ reference: 'REF-UNIQUE-1' }),
    });
    expect(first.statusCode).toBe(201);

    const duplicate = await api(ctx, cookie, 'POST', `/api/companies/${companyId}/entries`, {
      ...entry({ reference: 'ref-unique-1', entryDate: '2025-08-04' }),
    });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().error.code).toBe('REFERENCE_TAKEN');

    // Another company may use the same reference.
    const other = await createCompany(ctx, cookie, { name: 'Autre société (fictive)' });
    const otherAccounts = await getAccounts(ctx, cookie, other.id);
    const otherJournals = await getJournals(ctx, cookie, other.id);
    const elsewhere = await api(ctx, cookie, 'POST', `/api/companies/${other.id}/entries`, {
      journalId: journalByCode(otherJournals, 'OD').id,
      entryDate: '2025-08-01',
      description: 'Même référence, autre société',
      reference: 'REF-UNIQUE-1',
      status: 'posted',
      lines: [
        { accountId: accountByCode(otherAccounts, '1010').id, debit: '5' },
        { accountId: accountByCode(otherAccounts, '3000').id, credit: '5' },
      ],
    });
    expect(elsewhere.statusCode).toBe(201);
  });

  // 9 ------------------------------------------------------ balance sheet
  it('balances the statement of financial position when the period starts mid-history', async () => {
    const company = await createCompany(ctx, cookie, { name: 'Balance mi-période (fictive)' });
    const a = await getAccounts(ctx, cookie, company.id);
    const j = await getJournals(ctx, cookie, company.id);
    const post = (date: string, lines: { code: string; debit?: string; credit?: string }[]) =>
      api(ctx, cookie, 'POST', `/api/companies/${company.id}/entries`, {
        journalId: journalByCode(j, 'OD').id,
        entryDate: date,
        description: `Écriture ${date}`,
        status: 'posted',
        lines: lines.map((l) => ({
          accountId: accountByCode(a, l.code).id,
          debit: l.debit,
          credit: l.credit,
        })),
      });

    expect((await post('2025-07-01', [{ code: '1010', debit: '100000' }, { code: '3000', credit: '100000' }])).statusCode).toBe(201);
    expect((await post('2025-07-15', [{ code: '1100', debit: '50000' }, { code: '4000', credit: '50000' }])).statusCode).toBe(201);

    const res = await api(
      ctx,
      cookie,
      'GET',
      `/api/companies/${company.id}/reports/statements?from=2025-08-01&to=2026-06-30`,
    );
    expect(res.statusCode).toBe(200);
    const fp = res.json().financialPosition;
    expect(fp.balanced).toBe(true);
    // Result carried since inception, not only for the selected period.
    expect(fp.unappropriatedResult).toBe('50000.0000');
    expect(fp.totalAssets).toBe('150000.0000');
    expect(fp.totalLiabilitiesAndEquity).toBe('150000.0000');
    // The profit and loss statement still reports the selected period only.
    expect(res.json().profitAndLoss.revenue.total).toBe('0.0000');
  });

  // 10 ------------------------------------------------------------ ledger
  it('keeps deactivated accounts that hold posted movements in the ledger', async () => {
    const company = await createCompany(ctx, cookie, { name: 'Comptes désactivés (fictive)' });
    const a = await getAccounts(ctx, cookie, company.id);
    const j = await getJournals(ctx, cookie, company.id);
    const revenue = accountByCode(a, '4000');
    const cash = accountByCode(a, '1010');

    await api(ctx, cookie, 'POST', `/api/companies/${company.id}/entries`, {
      journalId: journalByCode(j, 'SAL').id,
      entryDate: '2025-08-01',
      description: 'Vente',
      status: 'posted',
      lines: [
        { accountId: cash.id, debit: '1000' },
        { accountId: revenue.id, credit: '1000' },
      ],
    });
    const deactivated = await api(
      ctx,
      cookie,
      'PATCH',
      `/api/companies/${company.id}/accounts/${revenue.id}`,
      { isActive: false },
    );
    expect(deactivated.statusCode).toBe(200);

    const ledger = await api(
      ctx,
      cookie,
      'GET',
      `/api/companies/${company.id}/reports/ledger?from=2025-07-01&to=2026-06-30`,
    );
    expect(ledger.statusCode).toBe(200);
    const lines = ledger.json().accounts;
    expect(lines.some((l: any) => l.code === '4000')).toBe(true);
    expect(lines.every((l: any) => l.lines.length > 0)).toBe(true);
  });

  // 11 --------------------------------------------------------------- CSV
  it('neutralises spreadsheet formulas in CSV exports', async () => {
    const company = await createCompany(ctx, cookie, { name: 'Export CSV (fictive)' });
    const a = await getAccounts(ctx, cookie, company.id);
    const j = await getJournals(ctx, cookie, company.id);
    await api(ctx, cookie, 'POST', `/api/companies/${company.id}/entries`, {
      journalId: journalByCode(j, 'OD').id,
      entryDate: '2025-08-01',
      description: '=HYPERLINK("http://example.invalid","clic")',
      status: 'posted',
      lines: [
        { accountId: accountByCode(a, '1010').id, debit: '1' },
        { accountId: accountByCode(a, '4000').id, credit: '1' },
      ],
    });
    const csv = await api(
      ctx,
      cookie,
      'GET',
      `/api/companies/${company.id}/reports/ledger?format=csv&from=2025-07-01&to=2026-06-30`,
    );
    expect(csv.statusCode).toBe(200);
    expect(csv.body).toContain(`'=HYPERLINK`);
    expect(csv.body).not.toMatch(/;"=HYPERLINK/);
  });

  // 12 ------------------------------------------------------------ reversal
  it('refuses to reverse an entry twice', async () => {
    const posted = await api(ctx, cookie, 'POST', `/api/companies/${companyId}/entries`, {
      ...entry({ entryDate: '2025-08-05' }),
    });
    const id = posted.json().entry.id;
    const first = await api(ctx, cookie, 'POST', `/api/companies/${companyId}/entries/${id}/reverse`, {});
    expect(first.statusCode).toBe(201);
    const second = await api(ctx, cookie, 'POST', `/api/companies/${companyId}/entries/${id}/reverse`, {});
    expect(second.statusCode).toBe(409);
    expect(second.json().error.code).toBe('ENTRY_ALREADY_REVERSED');
  });

  // 13 ---------------------------------------------------- posting controls
  it('refuses to post a draft that references a deactivated account', async () => {
    const company = await createCompany(ctx, cookie, { name: 'Validation brouillon (fictive)' });
    const a = await getAccounts(ctx, cookie, company.id);
    const j = await getJournals(ctx, cookie, company.id);
    const draft = await api(ctx, cookie, 'POST', `/api/companies/${company.id}/entries`, {
      journalId: journalByCode(j, 'OD').id,
      entryDate: '2025-08-01',
      description: 'Brouillon avec compte désactivé',
      lines: [
        { accountId: accountByCode(a, '1010').id, debit: '10' },
        { accountId: accountByCode(a, '4000').id, credit: '10' },
      ],
    });
    expect(draft.statusCode).toBe(201);
    await api(ctx, cookie, 'PATCH', `/api/companies/${company.id}/accounts/${accountByCode(a, '4000').id}`, {
      isActive: false,
    });
    const posted = await api(
      ctx,
      cookie,
      'POST',
      `/api/companies/${company.id}/entries/${draft.json().entry.id}/post`,
      {},
    );
    expect(posted.statusCode).toBe(400);
  });

  // 14 --------------------------------------------------------- attachments
  it('validates the attachment signature, not the declared MIME type', async () => {
    const draft = await api(ctx, cookie, 'POST', `/api/companies/${companyId}/entries`, {
      ...entry({ status: 'draft', entryDate: '2025-08-07' }),
    });
    const entryId = draft.json().entry.id;
    const boundary = '----mc-test-boundary';
    const fakePdf = Buffer.from('<?php echo "not a pdf"; ?>');
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="proof.pdf"\r\nContent-Type: application/pdf\r\n\r\n`),
      fakePdf,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/companies/${companyId}/entries/${entryId}/attachments`,
      headers: { cookie, 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: body,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('ATTACHMENT_TYPE_NOT_ALLOWED');

    const pdf = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n');
    const goodBody = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="proof.pdf"\r\nContent-Type: application/pdf\r\n\r\n`),
      pdf,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const ok = await ctx.app.inject({
      method: 'POST',
      url: `/api/companies/${companyId}/entries/${entryId}/attachments`,
      headers: { cookie, 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: goodBody,
    });
    expect(ok.statusCode).toBe(201);
    const stored = await ctx.db.query<{ stored_name: string; sha256: string }>(
      'SELECT stored_name, sha256 FROM attachments WHERE entry_id = $1',
      [entryId],
    );
    expect(stored.rows[0]!.sha256).toBe(createHash('sha256').update(pdf).digest('hex'));
    const storedPath = path.resolve(ctx.config.STORAGE_DIR, companyId, stored.rows[0]!.stored_name);
    await expect(readFile(storedPath)).resolves.toBeDefined();

    // Deleting the draft also removes the stored file.
    const removed = await api(ctx, cookie, 'DELETE', `/api/companies/${companyId}/entries/${entryId}`);
    expect([200, 204]).toContain(removed.statusCode);
    await expect(readFile(storedPath)).rejects.toThrow();
  });

  // 15 ------------------------------------------------- database isolation
  it('blocks cross-company references at the database level', async () => {
    const other = await createCompany(ctx, cookie, { name: 'Isolation SQL (fictive)' });
    const otherAccounts = await getAccounts(ctx, cookie, other.id);
    const postedEntry = await api(ctx, cookie, 'POST', `/api/companies/${companyId}/entries`, {
      ...entry({ entryDate: '2025-08-09' }),
    });
    expect(postedEntry.statusCode).toBe(201);
    const userId = (await ctx.db.query<{ id: string }>('SELECT id FROM app_users LIMIT 1')).rows[0]!.id;

    // An attachment of company B pointing at an entry of company A is refused
    // by the database itself, even if the API were bypassed.
    await expect(
      ctx.db.query(
        `INSERT INTO attachments (company_id, entry_id, original_name, stored_name, mime_type, size_bytes, sha256, uploaded_by)
         VALUES ($1, $2, 'x.pdf', 'x.pdf', 'application/pdf', 10, 'hash', $3)`,
        [other.id, postedEntry.json().entry.id, userId],
      ),
    ).rejects.toThrow(/CROSS_COMPANY_REFERENCE/);

    // The audit log cannot be modified or deleted.
    await expect(ctx.db.query("UPDATE audit_log SET action = 'tampered'")).rejects.toThrow(
      /AUDIT_LOG_APPEND_ONLY/,
    );
    await expect(ctx.db.query('DELETE FROM audit_log')).rejects.toThrow(/AUDIT_LOG_APPEND_ONLY/);

    // A posted entry cannot be deleted directly either.
    const posted = await api(ctx, cookie, 'POST', `/api/companies/${companyId}/entries`, {
      ...entry({ entryDate: '2025-08-08' }),
    });
    await expect(
      ctx.db.query("DELETE FROM journal_entries WHERE id = $1", [posted.json().entry.id]),
    ).rejects.toThrow(/POSTED_ENTRY_IMMUTABLE/);
    expect(otherAccounts.length).toBeGreaterThan(0);
  });

  // 16 ----------------------------------------------------------- sessions
  it('invalidates every session after a password change', async () => {
    const user = await registerUser(ctx);
    const before = await api(ctx, user.cookie, 'GET', '/api/auth/me');
    expect(before.statusCode).toBe(200);

    const changed = await api(ctx, user.cookie, 'PATCH', '/api/auth/me', {
      currentPassword: 'StrongPassw0rd!',
      newPassword: 'EvenStronger2027!',
    });
    expect(changed.statusCode).toBe(200);
    expect(changed.json().sessionsInvalidated).toBe(true);

    const after = await api(ctx, user.cookie, 'GET', '/api/auth/me');
    expect(after.statusCode).toBe(401);

    const relogin = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: user.email, password: 'EvenStronger2027!' },
    });
    expect(relogin.statusCode).toBe(200);
  });

  // 17 ------------------------------------------------------------- rates
  it('derives the reverse exchange rate with exact arithmetic', async () => {
    const res = await api(ctx, cookie, 'POST', `/api/companies/${companyId}/exchange-rates`, {
      fromCurrency: 'EUR',
      toCurrency: 'MUR',
      rate: '48.5000',
      rateDate: '2025-08-01',
    });
    expect(res.statusCode).toBe(201);
    const list = await api(ctx, cookie, 'GET', `/api/companies/${companyId}/exchange-rates`);
    const reverse = list
      .json()
      .rates.find((r: any) => r.from_currency === 'MUR' && r.to_currency === 'EUR');
    expect(reverse.rate).toBe('0.02061856');
    expect(reverse.rate).toMatch(/^\d+\.\d{8}$/);
  });

  it('rejects an invalid exchange rate with a 400 status', async () => {
    const res = await api(ctx, cookie, 'POST', `/api/companies/${companyId}/exchange-rates`, {
      fromCurrency: 'USD',
      toCurrency: 'MUR',
      rate: '-3',
      rateDate: '2025-08-01',
    });
    expect(res.statusCode).toBe(400);
  });
});
