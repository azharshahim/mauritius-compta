import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  accountByCode,
  api,
  closeTestApp,
  journalByCode,
  setupCompanyWithChart,
  type TestContext,
} from './helpers.js';

describe('journal entries: controls, immutability and multi-currency', () => {
  let ctx: TestContext;
  let cookie: string;
  let companyId: string;
  let accounts: any[];
  let journals: any[];

  const cash = () => accountByCode(accounts, '1010');
  const revenue = () => accountByCode(accounts, '4000');
  const expense = () => accountByCode(accounts, '6100');

  beforeAll(async () => {
    const setup = await setupCompanyWithChart();
    ctx = setup.ctx;
    cookie = setup.user.cookie;
    companyId = setup.company.id;
    accounts = setup.accounts;
    journals = setup.journals;
  });

  afterAll(async () => {
    await closeTestApp(ctx);
  });

  it('creates a balanced posted entry', async () => {
    const res = await api(ctx, cookie, 'POST', `/api/companies/${companyId}/entries`, {
      journalId: journalByCode(journals, 'SAL').id,
      entryDate: '2025-08-01',
      reference: 'FICT-001',
      description: 'Facture fictive 001',
      status: 'posted',
      lines: [
        { accountId: accountByCode(accounts, '1100').id, debit: '1000.00' },
        { accountId: revenue().id, credit: '1000.00' },
      ],
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.entry.status).toBe('posted');
    expect(body.entry.entry_no).toBe('SAL-2025-0001');
    expect(body.lines).toHaveLength(2);
    expect(body.lines[0].debit).toBe('1000.0000');
  });

  it('rejects an unbalanced posted entry', async () => {
    const res = await api(ctx, cookie, 'POST', `/api/companies/${companyId}/entries`, {
      journalId: journalByCode(journals, 'OD').id,
      entryDate: '2025-08-02',
      description: 'Écriture déséquilibrée (test)',
      status: 'posted',
      lines: [
        { accountId: cash().id, debit: '500.00' },
        { accountId: revenue().id, credit: '450.00' },
      ],
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('ENTRY_UNBALANCED');
    expect(res.json().error.details.difference).toBe('50.0000');
  });

  it('rejects an entry with a single line or with two debits', async () => {
    const oneLine = await api(ctx, cookie, 'POST', `/api/companies/${companyId}/entries`, {
      journalId: journalByCode(journals, 'OD').id,
      entryDate: '2025-08-02',
      description: 'Une seule ligne',
      lines: [{ accountId: cash().id, debit: '10' }],
    });
    expect(oneLine.statusCode).toBe(400);
    expect(oneLine.json().error.code).toBe('ENTRY_TOO_FEW_LINES');

    const twoDebits = await api(ctx, cookie, 'POST', `/api/companies/${companyId}/entries`, {
      journalId: journalByCode(journals, 'OD').id,
      entryDate: '2025-08-02',
      description: 'Deux débits',
      status: 'posted',
      lines: [
        { accountId: cash().id, debit: '10' },
        { accountId: expense().id, debit: '10' },
      ],
    });
    expect(twoDebits.statusCode).toBe(400);
    expect(twoDebits.json().error.code).toBe('ENTRY_UNBALANCED');
  });

  it('allows an unbalanced draft but refuses to post it', async () => {
    const draft = await api(ctx, cookie, 'POST', `/api/companies/${companyId}/entries`, {
      journalId: journalByCode(journals, 'OD').id,
      entryDate: '2025-08-03',
      description: 'Brouillon déséquilibré (test)',
      status: 'draft',
      lines: [
        { accountId: cash().id, debit: '100' },
        { accountId: revenue().id, credit: '90' },
      ],
    });
    expect(draft.statusCode).toBe(201);
    const entryId = draft.json().entry.id;

    const post = await api(
      ctx,
      cookie,
      'POST',
      `/api/companies/${companyId}/entries/${entryId}/post`,
    );
    expect(post.statusCode).toBe(400);
    expect(post.json().error.code).toBe('ENTRY_UNBALANCED');
  });

  it('protects posted entries from modification and deletion', async () => {
    const created = await api(ctx, cookie, 'POST', `/api/companies/${companyId}/entries`, {
      journalId: journalByCode(journals, 'BQ').id,
      entryDate: '2025-08-04',
      description: 'Écriture validée à protéger (test)',
      status: 'posted',
      lines: [
        { accountId: expense().id, debit: '750' },
        { accountId: cash().id, credit: '750' },
      ],
    });
    const entryId = created.json().entry.id;

    const patch = await api(ctx, cookie, 'PATCH', `/api/companies/${companyId}/entries/${entryId}`, {
      description: 'Tentative de modification',
    });
    expect(patch.statusCode).toBe(409);
    expect(patch.json().error.code).toBe('ENTRY_POSTED_IMMUTABLE');

    const del = await api(ctx, cookie, 'DELETE', `/api/companies/${companyId}/entries/${entryId}`);
    expect(del.statusCode).toBe(409);
    expect(del.json().error.code).toBe('ENTRY_POSTED_IMMUTABLE');

    // Direct SQL bypass is blocked too (database trigger).
    await expect(
      ctx.db.query('UPDATE journal_entries SET description = $2 WHERE id = $1', [
        entryId,
        'Bypass',
      ]),
    ).rejects.toThrow(/POSTED_ENTRY_IMMUTABLE/);

    await expect(
      ctx.db.query('DELETE FROM journal_entries WHERE id = $1', [entryId]),
    ).rejects.toThrow(/POSTED_ENTRY_IMMUTABLE/);
  });

  it('reverses a posted entry by contrepassation (traceable)', async () => {
    const created = await api(ctx, cookie, 'POST', `/api/companies/${companyId}/entries`, {
      journalId: journalByCode(journals, 'SAL').id,
      entryDate: '2025-09-01',
      description: 'Facture à contrepasser (test)',
      status: 'posted',
      lines: [
        { accountId: accountByCode(accounts, '1100').id, debit: '2000' },
        { accountId: revenue().id, credit: '2000' },
      ],
    });
    const entryId = created.json().entry.id;

    const reversal = await api(
      ctx,
      cookie,
      'POST',
      `/api/companies/${companyId}/entries/${entryId}/reverse`,
      { entryDate: '2025-09-02', description: 'Contrepassation de test' },
    );
    expect(reversal.statusCode).toBe(201);
    const body = reversal.json();
    expect(body.entry.status).toBe('posted');
    expect(body.entry.source).toBe('reversal');
    expect(body.entry.reversal_of_entry_id).toBe(entryId);
    expect(body.lines[0].credit).toBe('2000.0000');
    expect(body.lines[1].debit).toBe('2000.0000');

    const again = await api(
      ctx,
      cookie,
      'POST',
      `/api/companies/${companyId}/entries/${entryId}/reverse`,
      {},
    );
    expect(again.statusCode).toBe(409);
    expect(again.json().error.code).toBe('ENTRY_ALREADY_REVERSED');

    const original = await api(
      ctx,
      cookie,
      'GET',
      `/api/companies/${companyId}/entries/${entryId}`,
    );
    expect(original.json().entry.reversal_entry_id).toBe(body.entry.id);
  });

  it('requires a dated exchange rate for foreign currency entries', async () => {
    const missing = await api(ctx, cookie, 'POST', `/api/companies/${companyId}/entries`, {
      journalId: journalByCode(journals, 'SAL').id,
      entryDate: '2025-09-03',
      description: 'Vente EUR sans taux (test)',
      currency: 'EUR',
      status: 'posted',
      lines: [
        { accountId: accountByCode(accounts, '1100').id, debit: '1000' },
        { accountId: accountByCode(accounts, '4010').id, credit: '1000' },
      ],
    });
    expect(missing.statusCode).toBe(400);
    expect(missing.json().error.code).toBe('EXCHANGE_RATE_REQUIRED');

    const rate = await api(ctx, cookie, 'POST', `/api/companies/${companyId}/exchange-rates`, {
      fromCurrency: 'EUR',
      toCurrency: 'MUR',
      rateDate: '2025-09-03',
      rate: '48.50',
      source: 'Test manual rate (fictitious)',
    });
    expect(rate.statusCode).toBe(201);

    const entry = await api(ctx, cookie, 'POST', `/api/companies/${companyId}/entries`, {
      journalId: journalByCode(journals, 'SAL').id,
      entryDate: '2025-09-03',
      description: 'Vente EUR avec taux saisi (test)',
      currency: 'EUR',
      exchangeRate: '48.50',
      status: 'posted',
      lines: [
        { accountId: accountByCode(accounts, '1100').id, debit: '1000' },
        { accountId: accountByCode(accounts, '4010').id, credit: '1000' },
      ],
    });
    expect(entry.statusCode).toBe(201);
    const lines = entry.json().lines;
    expect(lines[0].debit).toBe('48500.0000'); // functional currency
    expect(lines[0].txn_amount).toBe('1000.0000'); // original amount preserved
    expect(lines[0].txn_currency).toBe('EUR');
    expect(lines[0].fx_rate).toBe('48.50000000');
  });

  it('numbers entries sequentially per journal and year', async () => {
    const sal = journalByCode(journals, 'SAL');
    const numbers: string[] = [];
    for (let i = 0; i < 3; i++) {
      const res = await api(ctx, cookie, 'POST', `/api/companies/${companyId}/entries`, {
        journalId: sal.id,
        entryDate: '2025-10-0' + (i + 1),
        description: `Numérotation ${i + 1}`,
        lines: [
          { accountId: accountByCode(accounts, '1100').id, debit: '10' },
          { accountId: revenue().id, credit: '10' },
        ],
      });
      numbers.push(res.json().entry.entry_no);
    }
    expect(new Set(numbers).size).toBe(3);
    const suffix = numbers.map((n) => Number(n.split('-')[2]));
    expect(suffix[1]).toBe(suffix[0]! + 1);
    expect(suffix[2]).toBe(suffix[0]! + 2);
    expect(numbers.every((n) => n.startsWith('SAL-2025-'))).toBe(true);
  });

  it('blocks entries in a closed accounting period', async () => {
    const periods = await api(ctx, cookie, 'GET', `/api/companies/${companyId}/periods`);
    const current = periods.json().periods[0];
    await api(
      ctx,
      cookie,
      'POST',
      `/api/companies/${companyId}/periods/${current.id}/close`,
    );

    const created = await api(ctx, cookie, 'POST', `/api/companies/${companyId}/entries`, {
      journalId: journalByCode(journals, 'OD').id,
      entryDate: '2025-11-15',
      description: 'Écriture en période clôturée (test)',
      status: 'posted',
      lines: [
        { accountId: cash().id, debit: '10' },
        { accountId: revenue().id, credit: '10' },
      ],
    });
    expect(created.statusCode).toBe(409);
    expect(created.json().error.code).toBe('PERIOD_CLOSED');

    await api(
      ctx,
      cookie,
      'POST',
      `/api/companies/${companyId}/periods/${current.id}/reopen`,
    );
  });

  it('rejects drafting an entry outside any open accounting period', async () => {
    const res = await api(ctx, cookie, 'POST', `/api/companies/${companyId}/entries`, {
      journalId: journalByCode(journals, 'OD').id,
      entryDate: '2031-01-15',
      description: 'Hors période (test)',
      status: 'posted',
      lines: [
        { accountId: cash().id, debit: '10' },
        { accountId: revenue().id, credit: '10' },
      ],
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('PERIOD_CLOSED');
  });

  it('validates account ownership and entry dates', async () => {
    const badDate = await api(ctx, cookie, 'POST', `/api/companies/${companyId}/entries`, {
      journalId: journalByCode(journals, 'OD').id,
      entryDate: '2025-02-31',
      description: 'Date impossible',
      lines: [
        { accountId: cash().id, debit: '10' },
        { accountId: revenue().id, credit: '10' },
      ],
    });
    expect(badDate.statusCode).toBe(400);

    const foreignAccount = await api(ctx, cookie, 'POST', `/api/companies/${companyId}/entries`, {
      journalId: journalByCode(journals, 'OD').id,
      entryDate: '2025-08-05',
      description: 'Compte étranger',
      lines: [
        { accountId: '00000000-0000-4000-8000-000000000000', debit: '10' },
        { accountId: revenue().id, credit: '10' },
      ],
    });
    expect(foreignAccount.statusCode).toBe(400);
  });

  it('records sensitive operations in the audit log', async () => {
    // Post a valid draft so that entry.post is exercised and audited.
    const draft = await api(ctx, cookie, 'POST', `/api/companies/${companyId}/entries`, {
      journalId: journalByCode(journals, 'OD').id,
      entryDate: '2025-08-06',
      description: 'Brouillon à valider (test)',
      lines: [
        { accountId: cash().id, debit: '42' },
        { accountId: revenue().id, credit: '42' },
      ],
    });
    const posted = await api(
      ctx,
      cookie,
      'POST',
      `/api/companies/${companyId}/entries/${draft.json().entry.id}/post`,
    );
    expect(posted.statusCode).toBe(200);
    expect(posted.json().entry.status).toBe('posted');

    const audit = await api(ctx, cookie, 'GET', `/api/companies/${companyId}/audit?limit=200`);
    const actions = audit.json().events.map((e: any) => e.action);
    expect(actions).toContain('entry.create_posted');
    expect(actions).toContain('entry.post');
    expect(actions).toContain('entry.reverse');
    expect(actions).toContain('period.close');
    expect(actions).toContain('exchange_rate.create');
  });
});
