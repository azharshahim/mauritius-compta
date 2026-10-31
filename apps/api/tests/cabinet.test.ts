import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  api,
  closeTestApp,
  createCompany,
  createTestApp,
  journalByCode,
  accountByCode,
  getAccounts,
  getJournals,
  registerUser,
  type TestContext,
  type TestUser,
} from './helpers.js';

/**
 * Mission 4 — Cabinet module and module permissions.
 * Every company, user and task created here is fictional.
 */
describe('cabinet module', () => {
  let ctx: TestContext;
  let owner: TestUser;
  let company: any;

  const cookieFor = async (email: string): Promise<string> => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email, password: 'StrongPassw0rd!' },
    });
    const raw = res.headers['set-cookie'];
    const value = Array.isArray(raw) ? raw[0] : (raw as string);
    return value!.split(';')[0]!;
  };

  const addMember = async (
    companyId: string,
    body: { email: string; role: string; fullName?: string; temporaryPassword?: string },
  ): Promise<{ cookie: string; userId: string }> => {
    const res = await api(ctx, owner.cookie, 'POST', `/api/companies/${companyId}/members`, {
      fullName: body.fullName ?? 'Collaborateur fictif',
      temporaryPassword: body.temporaryPassword ?? 'StrongPassw0rd!',
      ...body,
    });
    expect(res.statusCode).toBe(201);
    return { cookie: await cookieFor(body.email), userId: res.json().member.userId };
  };

  beforeAll(async () => {
    ctx = await createTestApp();
    owner = await registerUser(ctx);
    company = await createCompany(ctx, owner.cookie, {
      name: 'Dossier Cabinet Fictif Ltée',
      crn: 'CRN-FICT-0001',
      clientCode: 'CLI-001',
    });
  });

  afterAll(async () => {
    await closeTestApp(ctx);
  });

  it('creates a dossier with cabinet fields and lists it', async () => {
    expect(company.crn).toBe('CRN-FICT-0001');
    expect(company.client_code).toBe('CLI-001');

    const list = await api(ctx, owner.cookie, 'GET', '/api/cabinet/companies');
    expect(list.statusCode).toBe(200);
    expect(list.json().companies.map((c: any) => c.name)).toContain('Dossier Cabinet Fictif Ltée');

    const patched = await api(ctx, owner.cookie, 'PATCH', `/api/cabinet/companies/${company.id}`, {
      dossierManagerId: owner.id,
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().company.dossier_manager_id).toBe(owner.id);
  });

  it('runs the full task lifecycle with history and comments', async () => {
    const created = await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/tasks`, {
      title: 'Réviser les comptes annuels (fictif)',
      category: 'financial_statements',
      priority: 'high',
      dueDate: '2026-11-30',
      assignedTo: owner.id,
      description: 'Tâche de démonstration',
    });
    expect(created.statusCode).toBe(201);
    const task = created.json().task;
    expect(task.status).toBe('todo');
    expect(task.assigned_to).toBe(owner.id);

    const updated = await api(
      ctx,
      owner.cookie,
      'PATCH',
      `/api/companies/${company.id}/tasks/${task.id}`,
      { status: 'done', comment: 'Contrôle terminé (fictif)' },
    );
    expect(updated.statusCode).toBe(200);
    expect(updated.json().task.status).toBe('done');
    expect(updated.json().task.completed_at).toBeTruthy();

    const detail = await api(
      ctx,
      owner.cookie,
      'GET',
      `/api/companies/${company.id}/tasks/${task.id}`,
    );
    expect(detail.statusCode).toBe(200);
    expect(detail.json().comments).toHaveLength(1);
    expect(detail.json().history.length).toBeGreaterThanOrEqual(2);
    expect(detail.json().history.map((h: any) => h.action)).toContain('cabinet.task.status');
  });

  it('refuses to assign a task to a non-member', async () => {
    const outsider = await registerUser(ctx);
    const res = await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/tasks`, {
      title: 'Affectation invalide',
      category: 'accounting',
      assignedTo: outsider.id,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('ASSIGNEE_NOT_MEMBER');
  });

  it('aggregates the dashboard from real data', async () => {
    await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/tasks`, {
      title: 'Tâche en retard (fictive)',
      category: 'vat',
      dueDate: '2020-01-31',
    });
    const res = await api(ctx, owner.cookie, 'GET', '/api/cabinet/dashboard');
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.metrics.clients).toBeGreaterThanOrEqual(1);
    expect(body.metrics.overdueTasks).toBeGreaterThanOrEqual(1);
    expect(body.metrics.openTasks).toBeGreaterThanOrEqual(1);
    expect(body.recentActivity.length).toBeGreaterThan(0);
    expect(body.dossiers.map((d: any) => d.id)).toContain(company.id);
  });

  it('archives a dossier read-only and restores it', async () => {
    const accounts = await getAccounts(ctx, owner.cookie, company.id);
    const journals = await getJournals(ctx, owner.cookie, company.id);
    const archived = await api(ctx, owner.cookie, 'POST', `/api/cabinet/companies/${company.id}/archive`);
    expect(archived.statusCode).toBe(200);
    expect(archived.json().company.status).toBe('archived');
    expect(archived.json().company.archived_at).toBeTruthy();

    const blocked = await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/entries`, {
      journalId: journalByCode(journals, 'OD').id,
      entryDate: '2025-08-01',
      description: 'Écriture dans un dossier archivé',
      lines: [
        { accountId: accountByCode(accounts, '1010').id, debit: '10' },
        { accountId: accountByCode(accounts, '4000').id, credit: '10' },
      ],
    });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().error.code).toBe('COMPANY_ARCHIVED');

    // Reads stay possible: the accounting history is preserved.
    const ledger = await api(
      ctx,
      owner.cookie,
      'GET',
      `/api/companies/${company.id}/reports/trial-balance`,
    );
    expect(ledger.statusCode).toBe(200);

    const restored = await api(
      ctx,
      owner.cookie,
      'POST',
      `/api/cabinet/companies/${company.id}/unarchive`,
    );
    expect(restored.json().company.status).toBe('active');
    expect(restored.json().company.archived_at).toBeNull();
  });

  it('separates accounting and payroll permissions', async () => {
    const accountant = await addMember(company.id, {
      email: 'accountant.cabinet@example.test',
      role: 'accountant',
    });
    const payroll = await addMember(company.id, {
      email: 'payroll.cabinet@example.test',
      role: 'payroll_manager',
    });

    const accountingRead = await api(
      ctx,
      accountant.cookie,
      'GET',
      `/api/companies/${company.id}/accounts`,
    );
    expect(accountingRead.statusCode).toBe(200);

    const payrollDenied = await api(
      ctx,
      accountant.cookie,
      'GET',
      `/api/companies/${company.id}/payroll/summary`,
    );
    expect(payrollDenied.statusCode).toBe(403);
    expect(payrollDenied.json().error.code).toBe('MODULE_FORBIDDEN');

    const payrollAllowed = await api(
      ctx,
      payroll.cookie,
      'GET',
      `/api/companies/${company.id}/payroll/summary`,
    );
    expect(payrollAllowed.statusCode).toBe(200);
    expect(payrollAllowed.json().capabilities.paye).toBe(false);

    // A payroll manager can read accounting but must not write in it.
    const accountingReadOnly = await api(
      ctx,
      payroll.cookie,
      'GET',
      `/api/companies/${company.id}/accounts`,
    );
    expect(accountingReadOnly.statusCode).toBe(200);
    const accountingWriteDenied = await api(
      ctx,
      payroll.cookie,
      'POST',
      `/api/companies/${company.id}/accounts`,
      { code: '9999', name: 'Compte interdit', type: 'expense' },
    );
    expect(accountingWriteDenied.statusCode).toBe(403);
  });

  it('lets a cabinet administrator widen one module without the other', async () => {
    const accountantCookie = await cookieFor('accountant.cabinet@example.test');
    const me = await api(ctx, accountantCookie, 'GET', '/api/auth/me');
    const accountantId = me.json().user.id;

    const grant = await api(
      ctx,
      owner.cookie,
      'PATCH',
      `/api/cabinet/companies/${company.id}/members/${accountantId}`,
      { modules: { payroll: 'read' } },
    );
    expect(grant.statusCode).toBe(200);
    expect(grant.json().member.modules.payroll).toBe('read');
    expect(grant.json().member.modules.accounting).toBe('write');

    const payrollNowAllowed = await api(
      ctx,
      accountantCookie,
      'GET',
      `/api/companies/${company.id}/payroll/summary`,
    );
    expect(payrollNowAllowed.statusCode).toBe(200);
  });

  it('never exposes another tenant, even with a valid id', async () => {
    const outsider = await registerUser(ctx);
    const task = await api(ctx, owner.cookie, 'GET', `/api/companies/${company.id}/tasks`);
    const taskId = task.json().tasks[0].id;

    const denied = await api(
      ctx,
      outsider.cookie,
      'GET',
      `/api/companies/${company.id}/tasks/${taskId}`,
    );
    expect(denied.statusCode).toBe(404);
    expect(denied.json().error.code).toBe('COMPANY_NOT_FOUND');

    const dashboard = await api(ctx, outsider.cookie, 'GET', '/api/cabinet/dashboard');
    expect(dashboard.statusCode).toBe(200);
    expect(dashboard.json().metrics.clients).toBe(0);
  });

  it('exposes the dossier sheet with members, tasks and modules', async () => {
    const res = await api(ctx, owner.cookie, 'GET', `/api/cabinet/companies/${company.id}`);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.company.id).toBe(company.id);
    expect(body.members.length).toBeGreaterThanOrEqual(2);
    expect(body.modules.accounting).toBe('admin');
    expect(body.counts.collaborators).toBe(body.members.length);
    expect(Array.isArray(body.openTasks)).toBe(true);
  });

  it('exposes an operational billing module without claiming MRA e-invoicing', async () => {
    // Mission 6 replaced the mission-4 foundation: the chain is live, while
    // MRA e-invoicing stays explicitly unavailable and nothing is posted to
    // accounting automatically.
    const documents = await api(
      ctx,
      owner.cookie,
      'GET',
      `/api/companies/${company.id}/billing/documents`,
    );
    expect(documents.statusCode).toBe(200);
    expect(documents.json().available).toBe(true);

    const summary = await api(
      ctx,
      owner.cookie,
      'GET',
      `/api/companies/${company.id}/billing/summary`,
    );
    expect(summary.json().capabilities.vatComputation).toBe(false);
    expect(summary.json().capabilities.mraEInvoicing).toBe(false);
    expect(summary.json().capabilities.postingToAccounting).toBe(true);

    const customer = await api(
      ctx,
      owner.cookie,
      'POST',
      `/api/companies/${company.id}/billing/customers`,
      { name: 'Client fictif', brn: 'BRN-CAB-0001' },
    );
    expect(customer.statusCode).toBe(201);

    const created = await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/billing/documents`, {
      kind: 'quote',
      customerId: customer.json().customer.id,
      issueDate: '2025-09-15',
      lines: [{ description: 'Ligne fictive', quantity: '1', unitPrice: '100.00', vatTreatment: 'exempt' }],
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().document.number).toBeNull();
    expect(created.json().document.status).toBe('draft');
  });

  it('lists the team across dossiers', async () => {
    const res = await api(ctx, owner.cookie, 'GET', '/api/cabinet/team');
    expect(res.statusCode).toBe(200);
    const emails = res.json().collaborators.map((c: any) => c.email);
    expect(emails).toContain(owner.email);
    expect(emails).toContain('accountant.cabinet@example.test');
    const accountant = res.json().collaborators.find(
      (c: any) => c.email === 'accountant.cabinet@example.test',
    );
    expect(accountant.assignments[0].role).toBe('accountant');
  });
});
