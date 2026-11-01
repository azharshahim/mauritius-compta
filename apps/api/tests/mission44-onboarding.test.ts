/**
 * Mission 44 — Accountant Workspace API.
 *
 * Covers: portfolio aggregation, guided onboarding (drafts + activation), KYC
 * checklist permissions, multi-tenant isolation and the controlled activation
 * rules. Real HTTP injection against PGlite/PostgreSQL: no mocked service.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  api,
  closeTestApp,
  createCompany,
  createTestApp,
  registerUser,
  type TestContext,
  type TestUser,
} from './helpers.js';

const VALID_DRAFT = {
  company: {
    name: 'Fictitious Lagoon Trading Ltd',
    tradeName: 'Lagoon Trading',
    brn: 'FICT-LAGOON-001',
    crn: 'FICT-CRN-001',
    legalForm: 'private_company',
    incorporationDate: '2020-03-01',
    address: '1, Fictitious Quay, Port Louis (fictional address)',
    country: 'Mauritius (fictional)',
    contactName: 'Fictitious Contact',
    contactEmail: 'contact@fictitious-lagoon.test',
    contactPhone: '+230 5000 0000',
    businessDescription: 'Fictional wholesale trading company used for tests.',
    clientCode: 'FICT-001',
  },
  financial: {
    financialYearStart: '2025-07-01',
    financialYearEnd: '2026-06-30',
    functionalCurrency: 'MUR',
    presentationCurrency: 'MUR',
    accountingStandard: 'IFRS',
    vatNumber: 'FICT-VAT-001',
  },
  sector: 'trading_retail',
  accountingSetup: {
    accountingBasis: 'accrual',
    chartChoice: 'provisional_template',
    openingBalanceChoice: 'later',
    taxRegistration: 'to_confirm',
    bankAccountsReviewed: true,
    vatRegistered: false,
  },
  modules: ['onboarding_kyc', 'checks_balances', 'sales_einvoicing', 'reports'],
  kyc: { checks: [{ key: 'company_registration_certificate', status: 'received' }] },
};

const COMPLETE_SETUP = {
  accountingBasis: 'accrual',
  chartChoice: 'provisional_template',
  openingBalanceChoice: 'later',
  taxRegistration: 'to_confirm',
  bankAccountsReviewed: true,
};

describe('mission 44 — accountant workspace', () => {
  let ctx: TestContext;
  let owner: TestUser;
  let companyId: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    owner = await registerUser(ctx, { email: 'm44-owner@example.test', locale: 'en' });
    const company = await createCompany(ctx, owner.cookie, {
      name: 'Mission 44 Client Ltd (fictitious)',
      brn: 'M44-BRN-0001',
    });
    companyId = company.id;
  });

  afterAll(async () => {
    await closeTestApp(ctx);
  });

  it('shows the cabinet portfolio with an honest default onboarding state', async () => {
    const res = await api(ctx, owner.cookie, 'GET', '/api/cabinet/workspace');
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.metrics.totalClients).toBe(1);
    expect(body.metrics.activeClients).toBe(1);
    expect(body.clients).toHaveLength(1);
    const client = body.clients[0];
    expect(client.id).toBe(companyId);
    expect(client.onboarding_status).toBe('not_started');
    expect(client.progress_percent).toBeLessThan(100);
    // No KYC row exists yet: nothing is claimed on behalf of the client.
    expect(client.missing_documents).toBe(0);
    expect(body.user.email).toBe(owner.email);
    expect(Array.isArray(body.drafts)).toBe(true);
  });

  it('refuses to activate a client file that is not configured', async () => {
    const res = await api(ctx, owner.cookie, 'PATCH', `/api/cabinet/workspace/clients/${companyId}/onboarding`, {
      status: 'approved',
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('ONBOARDING_INCOMPLETE');
  });

  it('configures sector, modules and accounting setup, then computes progress', async () => {
    const patch = await api(ctx, owner.cookie, 'PATCH', `/api/cabinet/workspace/clients/${companyId}/onboarding`, {
      sector: 'professional_services',
      selectedModules: ['onboarding_kyc', 'checks_balances', 'reports'],
      accountingSetup: COMPLETE_SETUP,
    });
    expect(patch.statusCode).toBe(200);
    const body = patch.json();
    expect(body.onboarding.sector).toBe('professional_services');
    expect(body.onboarding.selected_modules).toEqual(['onboarding_kyc', 'checks_balances', 'reports']);
    expect(body.progress.percent).toBeGreaterThan(0);
    expect(body.progress.percent).toBeLessThan(100);

    const detail = await api(ctx, owner.cookie, 'GET', `/api/cabinet/workspace/clients/${companyId}`);
    expect(detail.statusCode).toBe(200);
    const d = detail.json();
    expect(d.progress.steps.map((s: any) => s.key)).toEqual([
      'company_information',
      'kyc',
      'sector',
      'accounting_setup',
      'modules',
      'activation',
    ]);
    expect(d.progress.steps.find((s: any) => s.key === 'sector').status).toBe('completed');
    expect(d.moduleAvailability).toHaveLength(8);
    expect(d.checks.trialBalance.balanced).toBe(true);
    expect(d.catalogue.sectors.length).toBe(9);
  });

  it('rejects an unknown sector and an unknown module', async () => {
    const badSector = await api(ctx, owner.cookie, 'PATCH', `/api/cabinet/workspace/clients/${companyId}/onboarding`, {
      sector: 'not_a_sector',
    });
    expect(badSector.statusCode).toBe(400);
    const badModule = await api(ctx, owner.cookie, 'PATCH', `/api/cabinet/workspace/clients/${companyId}/onboarding`, {
      selectedModules: ['not_a_module'],
    });
    expect(badModule.statusCode).toBe(400);
  });

  it('tracks KYC documents as a checklist and derives the review status', async () => {
    const initial = await api(ctx, owner.cookie, 'GET', `/api/cabinet/workspace/clients/${companyId}`);
    const checks = initial.json().kycChecks;
    expect(checks.length).toBeGreaterThan(10);
    expect(checks.every((c: any) => c.status === 'not_started')).toBe(true);

    // Receiving a document keeps the review in progress.
    const received = await api(
      ctx,
      owner.cookie,
      'PATCH',
      `/api/cabinet/workspace/clients/${companyId}/onboarding/kyc/company_registration_certificate`,
      { status: 'received', documentRef: 'fictional-folder/registration.pdf' },
    );
    expect(received.statusCode).toBe(200);
    expect(received.json().onboarding.kyc_review_status).toBe('in_progress');

    // A correction request blocks the file.
    const correction = await api(
      ctx,
      owner.cookie,
      'PATCH',
      `/api/cabinet/workspace/clients/${companyId}/onboarding/kyc/directors_register`,
      { status: 'needs_correction', note: 'Fictional test note' },
    );
    expect(correction.statusCode).toBe(200);
    expect(correction.json().progress.blockedSteps).toContain('kyc');

    const unknown = await api(
      ctx,
      owner.cookie,
      'PATCH',
      `/api/cabinet/workspace/clients/${companyId}/onboarding/kyc/not_a_check`,
      { status: 'received' },
    );
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json().error.code).toBe('KYC_ITEM_NOT_FOUND');

    // Verify everything: the review becomes "pending review", never "approved".
    const required = correction.json().kycChecks.filter((c: any) => c.required);
    for (const check of required) {
      await api(
        ctx,
        owner.cookie,
        'PATCH',
        `/api/cabinet/workspace/clients/${companyId}/onboarding/kyc/${check.key}`,
        { status: 'verified' },
      );
    }
    const final = await api(ctx, owner.cookie, 'GET', `/api/cabinet/workspace/clients/${companyId}`);
    expect(final.json().onboarding.kyc_review_status).toBe('pending_review');
    expect(final.json().progress.missingDocuments).toEqual([]);
  });

  it('activates the configured file and audits the decision', async () => {
    const res = await api(ctx, owner.cookie, 'PATCH', `/api/cabinet/workspace/clients/${companyId}/onboarding`, {
      status: 'approved',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().onboarding.activated_at).toBeTruthy();
    expect(res.json().progress.steps.find((s: any) => s.key === 'activation').status).toBe('completed');

    const activity = await api(ctx, owner.cookie, 'GET', `/api/cabinet/workspace/clients/${companyId}`);
    expect(activity.json().recentActivity.some((a: any) => a.action === 'cabinet.onboarding.activate')).toBe(true);
  });

  it('saves, resumes and activates a draft through the guided assistant', async () => {
    const created = await api(ctx, owner.cookie, 'POST', '/api/cabinet/workspace/drafts', {
      currentStep: 1,
      payload: { company: { name: 'Draft Fictitious Ltd' } },
    });
    expect(created.statusCode).toBe(201);
    const draftId = created.json().draft.id;

    const saved = await api(ctx, owner.cookie, 'PATCH', `/api/cabinet/workspace/drafts/${draftId}`, {
      currentStep: 6,
      payload: VALID_DRAFT,
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().draft.current_step).toBe(6);

    const list = await api(ctx, owner.cookie, 'GET', '/api/cabinet/workspace/drafts');
    expect(list.json().drafts.map((d: any) => d.id)).toContain(draftId);

    const activated = await api(ctx, owner.cookie, 'POST', `/api/cabinet/workspace/drafts/${draftId}/activate`);
    expect(activated.statusCode).toBe(201);
    const body = activated.json();
    expect(body.company.name).toBe('Fictitious Lagoon Trading Ltd');
    expect(body.company.trade_name).toBe('Lagoon Trading');
    expect(body.company.client_code).toBe('FICT-001');
    expect(body.onboarding.sector).toBe('trading_retail');
    expect(body.onboarding.selected_modules).toContain('sales_einvoicing');
    expect(body.onboarding.activated_at).toBeTruthy();
    expect(body.kycChecks.length).toBeGreaterThan(10);

    // The draft is consumed and the new dossier is a first-class company.
    const after = await api(ctx, owner.cookie, 'GET', '/api/cabinet/workspace/drafts');
    expect(after.json().drafts.map((d: any) => d.id)).not.toContain(draftId);
    const companies = await api(ctx, owner.cookie, 'GET', '/api/companies');
    expect(companies.json().companies.some((c: any) => c.id === body.company.id)).toBe(true);

    // The new dossier has its own chart and journals: no second engine.
    const accounts = await api(ctx, owner.cookie, 'GET', `/api/companies/${body.company.id}/accounts`);
    expect(accounts.json().accounts.length).toBeGreaterThan(10);
  });

  it('rejects a draft activation without a sector, a module or a valid year', async () => {
    const draft = await api(ctx, owner.cookie, 'POST', '/api/cabinet/workspace/drafts', {
      payload: {
        company: { name: 'Incomplete Fictitious Ltd' },
        financial: VALID_DRAFT.financial,
        modules: ['reports'],
      },
    });
    const draftId = draft.json().draft.id;
    const res = await api(ctx, owner.cookie, 'POST', `/api/cabinet/workspace/drafts/${draftId}/activate`);
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');

    const draft2 = await api(ctx, owner.cookie, 'POST', '/api/cabinet/workspace/drafts', {
      payload: {
        ...VALID_DRAFT,
        company: { ...VALID_DRAFT.company, brn: 'M44-BRN-0001' },
        financial: { ...VALID_DRAFT.financial, financialYearEnd: '2020-01-01' },
      },
    });
    const res2 = await api(
      ctx,
      owner.cookie,
      'POST',
      `/api/cabinet/workspace/drafts/${draft2.json().draft.id}/activate`,
    );
    expect(res2.statusCode).toBe(400);
  });

  it('detects a duplicate BRN on activation', async () => {
    const draft = await api(ctx, owner.cookie, 'POST', '/api/cabinet/workspace/drafts', {
      payload: {
        ...VALID_DRAFT,
        company: { ...VALID_DRAFT.company, name: 'Duplicate BRN Fictitious Ltd' },
      },
    });
    const res = await api(
      ctx,
      owner.cookie,
      'POST',
      `/api/cabinet/workspace/drafts/${draft.json().draft.id}/activate`,
    );
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('CONFLICT');
  });

  it('isolates clients between two cabinets', async () => {
    const outsider = await registerUser(ctx, { email: 'm44-outsider@example.test' });
    const read = await api(ctx, outsider.cookie, 'GET', `/api/cabinet/workspace/clients/${companyId}`);
    expect(read.statusCode).toBe(404);
    const patch = await api(ctx, outsider.cookie, 'PATCH', `/api/cabinet/workspace/clients/${companyId}/onboarding`, {
      sector: 'other',
    });
    expect(patch.statusCode).toBe(404);
    const kyc = await api(
      ctx,
      outsider.cookie,
      'PATCH',
      `/api/cabinet/workspace/clients/${companyId}/onboarding/kyc/directors_register`,
      { status: 'received' },
    );
    expect(kyc.statusCode).toBe(404);
    // The outsider's own workspace is empty: no portfolio leak.
    const workspace = await api(ctx, outsider.cookie, 'GET', '/api/cabinet/workspace');
    expect(workspace.json().metrics.totalClients).toBe(0);
    expect(workspace.json().clients).toEqual([]);
  });

  it('keeps drafts private to their author', async () => {
    const author = await registerUser(ctx, { email: 'm44-author@example.test' });
    const other = await registerUser(ctx, { email: 'm44-other@example.test' });
    const draft = await api(ctx, author.cookie, 'POST', '/api/cabinet/workspace/drafts', {
      payload: { company: { name: 'Private Draft Fictitious Ltd' } },
    });
    const draftId = draft.json().draft.id;

    const otherList = await api(ctx, other.cookie, 'GET', '/api/cabinet/workspace/drafts');
    expect(otherList.json().drafts).toEqual([]);
    const otherPatch = await api(ctx, other.cookie, 'PATCH', `/api/cabinet/workspace/drafts/${draftId}`, {
      currentStep: 3,
    });
    expect(otherPatch.statusCode).toBe(404);
    const otherDelete = await api(ctx, other.cookie, 'DELETE', `/api/cabinet/workspace/drafts/${draftId}`);
    expect(otherDelete.statusCode).toBe(404);
    const otherActivate = await api(
      ctx,
      other.cookie,
      'POST',
      `/api/cabinet/workspace/drafts/${draftId}/activate`,
    );
    expect(otherActivate.statusCode).toBe(404);
  });

  it('enforces cabinet write and admin permissions on an onboarding', async () => {
    const admin = await registerUser(ctx, { email: 'm44-admin@example.test' });
    const target = await createCompany(ctx, admin.cookie, {
      name: 'Permissions Fictitious Ltd',
      brn: 'M44-BRN-PERM',
    });
    const viewer = await registerUser(ctx, { email: 'm44-viewer@example.test' });
    const invited = await api(ctx, admin.cookie, 'POST', `/api/companies/${target.id}/members`, {
      email: viewer.email,
      password: 'StrongPassw0rd!',
      fullName: 'Viewer Fictitious',
      role: 'accountant',
    });
    expect([200, 201]).toContain(invited.statusCode);
    // An accountant has cabinet read + accounting write: configuration is
    // refused, reading stays allowed.
    const read = await api(ctx, viewer.cookie, 'GET', `/api/cabinet/workspace/clients/${target.id}`);
    expect(read.statusCode).toBe(200);
    const write = await api(ctx, viewer.cookie, 'PATCH', `/api/cabinet/workspace/clients/${target.id}/onboarding`, {
      sector: 'other',
    });
    expect(write.statusCode).toBe(403);
  });

  it('exposes the onboarding catalogue in both languages through keys only', async () => {
    const res = await api(ctx, owner.cookie, 'GET', '/api/cabinet/workspace/options');
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.legalValidation).toBe(false);
    expect(body.modules).toHaveLength(8);
    expect(body.sectors).toHaveLength(9);
    expect(body.steps).toHaveLength(6);
    // No hard-coded English prose in the catalogue: only translation keys.
    for (const module of body.modules) {
      expect(module.labelKey).toMatch(/^m44\./);
      expect(module.availability).toMatch(/^(available|partial|prepared)$/);
    }
  });
});
