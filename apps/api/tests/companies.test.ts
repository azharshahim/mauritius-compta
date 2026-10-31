import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  api,
  closeTestApp,
  createCompany,
  createTestApp,
  registerUser,
  type TestContext,
} from './helpers.js';

describe('company management and multi-company isolation', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await closeTestApp(ctx);
  });

  it('creates a fictitious Mauritius company with a demo chart and journals', async () => {
    const user = await registerUser(ctx);
    const company = await createCompany(ctx, user.cookie, {
      name: 'Alizé Conseil Ltée (fictitious)',
      brn: 'FICT-BRN-0001',
      vatNumber: 'FICT-VAT-0001',
      functionalCurrency: 'MUR',
      presentationCurrency: 'MUR',
      accountingStandard: 'IFRS for SMEs',
    });

    expect(company.id).toBeTruthy();
    expect(company.name).toBe('Alizé Conseil Ltée (fictitious)');
    expect(company.functional_currency).toBe('MUR');

    const accounts = await api(ctx, user.cookie, 'GET', `/api/companies/${company.id}/accounts`);
    expect(accounts.statusCode).toBe(200);
    expect(accounts.json().accounts.length).toBeGreaterThan(20);

    const journals = await api(ctx, user.cookie, 'GET', `/api/companies/${company.id}/journals`);
    const codes = journals.json().journals.map((j: any) => j.code).sort();
    expect(codes).toEqual(['BQ', 'CA', 'OD', 'PUR', 'SAL']);

    const detail = await api(ctx, user.cookie, 'GET', `/api/companies/${company.id}`);
    expect(detail.json().periods.length).toBeGreaterThanOrEqual(1);
    expect(detail.json().role).toBe('owner');
  });

  it('validates company fields and currency configuration', async () => {
    const user = await registerUser(ctx);
    const bad = await ctx.app.inject({
      method: 'POST',
      url: '/api/companies',
      headers: { cookie: user.cookie },
      payload: {
        name: '',
        financialYearStart: '2026-06-30',
        financialYearEnd: '2025-07-01',
        functionalCurrency: 'JPY',
      },
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.code).toBe('VALIDATION_ERROR');

    const missingName = await ctx.app.inject({
      method: 'POST',
      url: '/api/companies',
      headers: { cookie: user.cookie },
      payload: { financialYearStart: '2025-07-01', financialYearEnd: '2026-06-30' },
    });
    expect(missingName.statusCode).toBe(400);
  });

  it('updates a company and records the change in the audit log', async () => {
    const user = await registerUser(ctx);
    const company = await createCompany(ctx, user.cookie);
    const patch = await api(ctx, user.cookie, 'PATCH', `/api/companies/${company.id}`, {
      businessActivity: 'Accounting services (fictitious)',
      status: 'inactive',
    });
    expect(patch.statusCode).toBe(200);
    expect(patch.json().company.business_activity).toBe('Accounting services (fictitious)');
    expect(patch.json().company.status).toBe('inactive');

    const audit = await api(ctx, user.cookie, 'GET', `/api/companies/${company.id}/audit`);
    const actions = audit.json().events.map((e: any) => e.action);
    expect(actions).toContain('company.update');
    expect(actions).toContain('company.create');
  });

  it('strictly isolates two companies', async () => {
    const alice = await registerUser(ctx);
    const bob = await registerUser(ctx);
    const companyA = await createCompany(ctx, alice.cookie, {
      name: 'Alpha Ltd (fictitious)',
      brn: 'FICT-BRN-A',
    });
    const companyB = await createCompany(ctx, bob.cookie, {
      name: 'Beta Ltd (fictitious)',
      brn: 'FICT-BRN-B',
    });

    const aliceList = await api(ctx, alice.cookie, 'GET', '/api/companies');
    const names = aliceList.json().companies.map((c: any) => c.name);
    expect(names).toContain('Alpha Ltd (fictitious)');
    expect(names).not.toContain('Beta Ltd (fictitious)');

    // Accessing another tenant's company must look like "not found".
    const forbiddenDetail = await api(ctx, alice.cookie, 'GET', `/api/companies/${companyB.id}`);
    expect(forbiddenDetail.statusCode).toBe(404);

    const forbiddenAccounts = await api(
      ctx,
      alice.cookie,
      'GET',
      `/api/companies/${companyB.id}/accounts`,
    );
    expect(forbiddenAccounts.statusCode).toBe(404);

    const forbiddenEntry = await api(
      ctx,
      alice.cookie,
      'POST',
      `/api/companies/${companyB.id}/entries`,
      { description: 'should fail' },
    );
    expect(forbiddenEntry.statusCode).toBe(404);

    // Bob's data is intact and separate.
    const aAccounts = await api(ctx, alice.cookie, 'GET', `/api/companies/${companyA.id}/accounts`);
    const bAccounts = await api(ctx, bob.cookie, 'GET', `/api/companies/${companyB.id}/accounts`);
    const aIds = aAccounts.json().accounts.map((a: any) => a.id);
    const bIds = bAccounts.json().accounts.map((a: any) => a.id);
    expect(aIds.some((id: string) => bIds.includes(id))).toBe(false);
  });

  it('prevents duplicate BRN across companies', async () => {
    const user = await registerUser(ctx);
    await createCompany(ctx, user.cookie, { name: 'First Ltd (fictitious)', brn: 'FICT-BRN-DUP' });
    const dup = await ctx.app.inject({
      method: 'POST',
      url: '/api/companies',
      headers: { cookie: user.cookie },
      payload: {
        name: 'Second Ltd (fictitious)',
        brn: 'FICT-BRN-DUP',
        financialYearStart: '2025-07-01',
        financialYearEnd: '2026-06-30',
      },
    });
    expect(dup.statusCode).toBe(409);
  });

  it('does not allow the last owner to be removed', async () => {
    const owner = await registerUser(ctx);
    const company = await createCompany(ctx, owner.cookie);
    const res = await api(
      ctx,
      owner.cookie,
      'DELETE',
      `/api/companies/${company.id}/members/${owner.id}`,
    );
    expect(res.statusCode).toBe(400);
  });
});
