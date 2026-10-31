import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  accountByCode,
  api,
  closeTestApp,
  journalByCode,
  setupCompanyWithChart,
  type TestContext,
} from './helpers.js';

describe('chart of accounts', () => {
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
  });

  afterAll(async () => {
    await closeTestApp(ctx);
  });

  it('ships a demonstration chart flagged as non-official', () => {
    expect(accounts.length).toBeGreaterThan(20);
    expect(accounts.every((a) => a.description?.includes('DEMO'))).toBe(true);
    const types = new Set(accounts.map((a) => a.type));
    expect([...types].sort()).toEqual(['asset', 'equity', 'expense', 'liability', 'revenue']);
    expect(accounts.every((a) => a.fs_mapping !== null)).toBe(true);
  });

  it('creates, updates and deactivates a custom account', async () => {
    const created = await api(ctx, cookie, 'POST', `/api/companies/${companyId}/accounts`, {
      code: '1999',
      name: 'Compte de test (fictif)',
      type: 'asset',
      fsMapping: 'bs.current_assets.receivables',
    });
    expect(created.statusCode).toBe(201);
    const accountId = created.json().account.id;

    const duplicate = await api(ctx, cookie, 'POST', `/api/companies/${companyId}/accounts`, {
      code: '1999',
      name: 'Duplicate',
      type: 'asset',
    });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().error.code).toBe('ACCOUNT_CODE_TAKEN');

    const renamed = await api(
      ctx,
      cookie,
      'PATCH',
      `/api/companies/${companyId}/accounts/${accountId}`,
      { name: 'Compte renommé (fictif)' },
    );
    expect(renamed.statusCode).toBe(200);
    expect(renamed.json().account.name).toBe('Compte renommé (fictif)');

    const deactivated = await api(
      ctx,
      cookie,
      'PATCH',
      `/api/companies/${companyId}/accounts/${accountId}`,
      { isActive: false },
    );
    expect(deactivated.json().account.is_active).toBe(false);

    const activeOnly = await api(ctx, cookie, 'GET', `/api/companies/${companyId}/accounts`);
    expect(activeOnly.json().accounts.some((a: any) => a.code === '1999')).toBe(false);

    const withInactive = await api(
      ctx,
      cookie,
      'GET',
      `/api/companies/${companyId}/accounts?includeInactive=true`,
    );
    expect(withInactive.json().accounts.some((a: any) => a.code === '1999')).toBe(true);

    // Unused account can be deleted.
    const deleted = await api(
      ctx,
      cookie,
      'DELETE',
      `/api/companies/${companyId}/accounts/${accountId}`,
    );
    expect(deleted.statusCode).toBe(200);
  });

  it('refuses to delete an account used by a journal entry', async () => {
    const cash = accountByCode(accounts, '1000');
    const revenue = accountByCode(accounts, '4000');
    const od = journalByCode(journals, 'OD');
    const entry = await api(ctx, cookie, 'POST', `/api/companies/${companyId}/entries`, {
      journalId: od.id,
      entryDate: '2025-08-01',
      description: 'Écriture de test pour blocage suppression (fictif)',
      lines: [
        { accountId: cash.id, debit: '100' },
        { accountId: revenue.id, credit: '100' },
      ],
    });
    expect(entry.statusCode).toBe(201);

    const res = await api(ctx, cookie, 'DELETE', `/api/companies/${companyId}/accounts/${revenue.id}`);
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('ACCOUNT_IN_USE');

    // Account can be deactivated instead.
    const deactivate = await api(
      ctx,
      cookie,
      'PATCH',
      `/api/companies/${companyId}/accounts/${revenue.id}`,
      { isActive: false },
    );
    expect(deactivate.statusCode).toBe(200);
    await api(ctx, cookie, 'PATCH', `/api/companies/${companyId}/accounts/${revenue.id}`, {
      isActive: true,
    });
  });

  it('validates parent account relationships', async () => {
    const parent = accountByCode(accounts, '1000');
    const created = await api(ctx, cookie, 'POST', `/api/companies/${companyId}/accounts`, {
      code: '1001',
      name: 'Sous-compte caisse (fictif)',
      type: 'asset',
      parentId: parent.id,
    });
    expect(created.statusCode).toBe(201);

    const selfParent = await api(
      ctx,
      cookie,
      'PATCH',
      `/api/companies/${companyId}/accounts/${created.json().account.id}`,
      { parentId: created.json().account.id },
    );
    expect(selfParent.statusCode).toBe(400);
    expect(selfParent.json().error.code).toBe('ACCOUNT_PARENT_INVALID');

    const crossCompany = await api(ctx, cookie, 'POST', `/api/companies/${companyId}/accounts`, {
      code: '1002',
      name: 'Parent inconnu',
      type: 'asset',
      parentId: '00000000-0000-4000-8000-000000000000',
    });
    expect(crossCompany.statusCode).toBe(400);
  });
});
