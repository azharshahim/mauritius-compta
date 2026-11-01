/**
 * Mission 35 — P0-03 security and multi-company isolation.
 *
 * Three fictitious companies (A, B, C) with distinct users, charts and data.
 * Every test is local and non-destructive: no real company, no external
 * service and no production database is contacted.
 *
 * This suite is an internal regression test. It is NOT an independent
 * penetration test and does not by itself close P0-03.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { loadConfig } from '../src/config.js';
import {
  accountByCode,
  api,
  closeTestApp,
  createCompany,
  createTestApp,
  cookieFrom,
  getAccounts,
  getJournals,
  journalByCode,
  registerUser,
  type TestContext,
  type TestUser,
} from './helpers.js';

let ctx: TestContext;
let ownerA: TestUser;
let ownerB: TestUser;
let ownerC: TestUser;
let adminA: TestUser;
let payrollA: TestUser;
let shared: TestUser;
let A: any;
let B: any;
let C: any;
let accountsA: any[];
let journalsA: any[];
let accountsB: any[];
let journalsB: any[];
let accountsC: any[];
let journalsC: any[];
let entryB: any;
let entryC: any;
let customerB: any;
let employeeB: any;
let assetB: any;
let attachmentB: any;

const path = (companyId: string, suffix: string) => `/api/companies/${companyId}/${suffix}`;

async function addMember(owner: TestUser, companyId: string, user: TestUser, role: string) {
  const res = await api(ctx, owner.cookie, 'POST', `/api/companies/${companyId}/members`, {
    email: user.email,
    role,
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().member.userId as string;
}

async function uploadBEntryAttachment() {
  const boundary = '----mc-mission35-boundary';
  const pdf = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n');
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="b-only.pdf"\r\nContent-Type: application/pdf\r\n\r\n`,
    ),
    pdf,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const res = await ctx.app.inject({
    method: 'POST',
    url: `/api/companies/${B.id}/entries/${entryB.id}/attachments`,
    headers: { cookie: ownerB.cookie, 'content-type': `multipart/form-data; boundary=${boundary}` },
    payload: body,
  });
  expect(res.statusCode, res.body).toBe(201);
  return { attachment: res.json().attachment, sha256: createHash('sha256').update(pdf).digest('hex') };
}

describe('M35 — security and multi-company isolation', () => {
  beforeAll(async () => {
    ctx = await createTestApp();
    ownerA = await registerUser(ctx, { email: 'm35-owner-a@example.test' });
    ownerB = await registerUser(ctx, { email: 'm35-owner-b@example.test' });
    ownerC = await registerUser(ctx, { email: 'm35-owner-c@example.test' });
    adminA = await registerUser(ctx, { email: 'm35-admin-a@example.test' });
    payrollA = await registerUser(ctx, { email: 'm35-payroll-a@example.test' });
    shared = await registerUser(ctx, { email: 'm35-shared@example.test' });

    A = await createCompany(ctx, ownerA.cookie, { name: 'M35 Société A (fictive)', brn: 'M35-BRN-A' });
    B = await createCompany(ctx, ownerB.cookie, { name: 'M35 Société B (fictive)', brn: 'M35-BRN-B' });
    C = await createCompany(ctx, ownerC.cookie, { name: 'M35 Société C (fictive)', brn: 'M35-BRN-C' });

    await addMember(ownerA, A.id, adminA, 'admin');
    await addMember(ownerA, A.id, payrollA, 'payroll_manager');
    await addMember(ownerA, A.id, shared, 'accountant');
    await addMember(ownerC, C.id, shared, 'accountant');

    accountsA = await getAccounts(ctx, ownerA.cookie, A.id);
    journalsA = await getJournals(ctx, ownerA.cookie, A.id);
    accountsB = await getAccounts(ctx, ownerB.cookie, B.id);
    journalsB = await getJournals(ctx, ownerB.cookie, B.id);
    accountsC = await getAccounts(ctx, ownerC.cookie, C.id);
    journalsC = await getJournals(ctx, ownerC.cookie, C.id);

    // C owns its own accounting data: isolation must not rely on C being empty.
    const entryCResponse = await api(ctx, ownerC.cookie, 'POST', path(C.id, 'entries'), {
      journalId: journalByCode(journalsC, 'OD').id,
      entryDate: '2025-08-02',
      description: 'C-only entry (fictitious)',
      status: 'posted',
      lines: [
        { accountId: accountByCode(accountsC, '1010').id, debit: '20' },
        { accountId: accountByCode(accountsC, '4000').id, credit: '20' },
      ],
    });
    expect(entryCResponse.statusCode, entryCResponse.body).toBe(201);
    entryC = entryCResponse.json().entry;

    const createdEntry = await api(ctx, ownerB.cookie, 'POST', path(B.id, 'entries'), {
      journalId: journalByCode(journalsB, 'OD').id,
      entryDate: '2025-08-01',
      description: 'B-only secret entry (fictitious)',
      status: 'posted',
      lines: [
        { accountId: accountByCode(accountsB, '1010').id, debit: '10' },
        { accountId: accountByCode(accountsB, '4000').id, credit: '10' },
      ],
    });
    expect(createdEntry.statusCode, createdEntry.body).toBe(201);
    entryB = createdEntry.json().entry;

    const customer = await api(ctx, ownerB.cookie, 'POST', path(B.id, 'billing/customers'), {
      name: 'B-only customer (fictitious)',
      brn: 'M35-CUST-B',
      paymentTermsDays: 30,
    });
    expect(customer.statusCode, customer.body).toBe(201);
    customerB = customer.json().customer;

    const employee = await api(ctx, ownerB.cookie, 'POST', path(B.id, 'payroll/employees'), {
      employeeNumber: 'M35B001',
      firstName: 'B-only',
      lastName: 'Employee',
      dateOfBirth: '1990-04-12',
      nationality: 'Mauritian',
      countryOfResidence: 'Mauritius',
      address: '1, Fictitious Street, Port Louis',
      email: 'm35.b.employee@example.test',
      phone: '+230 5000 0000',
      hireDate: '2024-01-15',
      department: 'Fictitious',
      jobTitle: 'Fictitious analyst',
      workLocation: 'Port Louis',
      costCentre: 'M35-B',
      payrollCurrency: 'MUR',
      paymentMethod: 'bank_transfer',
      bankName: 'Fictitious Bank',
      bankAccountNumber: 'MU00FICTM35B0000000000',
      emergencyContactName: 'Fictitious contact',
      emergencyContactPhone: '+230 5000 0001',
      notes: 'B-only payroll record (fictitious)',
    });
    expect(employee.statusCode, employee.body).toBe(201);
    employeeB = employee.json().employee;

    const category = await api(ctx, ownerB.cookie, 'POST', path(B.id, 'fixed-assets/categories'), {
      code: 'M35B',
      nameEn: 'M35 B-only category',
      nameFr: 'Catégorie M35 B',
    });
    expect(category.statusCode, category.body).toBe(201);
    const asset = await api(ctx, ownerB.cookie, 'POST', path(B.id, 'fixed-assets'), {
      categoryId: category.json().category.id,
      description: 'B-only asset (fictitious)',
      acquisitionDate: '2025-07-01',
      cost: '100.00',
      currency: 'MUR',
      exchangeRate: '1',
    });
    expect(asset.statusCode, asset.body).toBe(201);
    assetB = asset.json().asset;

    attachmentB = await uploadBEntryAttachment();
  }, 180_000);

  afterAll(async () => {
    await closeTestApp(ctx);
  });

  it('refuses every module at the company boundary for an outsider (A vs B)', async () => {
    const routes = [
      'accounts',
      'journals',
      'entries',
      'reports/trial-balance',
      'billing/documents',
      'purchases/documents',
      'bank/accounts',
      'fixed-assets',
      'inventory/items',
      'payroll/employees',
      'documents',
      'settings',
      'members',
      'exports',
      'tasks',
      'accruals',
      'provisions',
      'fx/rates',
      'lettering',
      'equity/overview',
      'financial-years/timeline',
      'migration/jobs',
    ];
    for (const route of routes) {
      const res = await api(ctx, ownerA.cookie, 'GET', path(B.id, route));
      expect(res.statusCode, `${route}: ${res.body}`).toBe(404);
      expect(res.json()?.error?.code, route).toBe('COMPANY_NOT_FOUND');
    }

    const companyDetail = await api(ctx, ownerA.cookie, 'GET', `/api/companies/${B.id}`);
    expect(companyDetail.statusCode, companyDetail.body).toBe(404);

    const writes = [
      ['POST', 'entries', { journalId: journalByCode(journalsA, 'OD').id }],
      ['POST', 'billing/customers', { name: 'Intrusion (fictitious)' }],
      ['POST', 'payroll/employees', { employeeNumber: 'M35-CROSS', firstName: 'Intrusion', lastName: 'Blocked' }],
      ['PATCH', `fixed-assets/${assetB.id}`, { description: 'Intrusion' }],
      ['DELETE', `entries/${entryB.id}`, undefined],
    ] as const;
    for (const [method, route, payload] of writes) {
      const res = await api(ctx, ownerA.cookie, method, path(B.id, route), payload);
      expect(res.statusCode, `${method} ${route}: ${res.body}`).toBe(404);
      expect(res.json()?.error?.code, `${method} ${route}`).toBe('COMPANY_NOT_FOUND');
    }

    const cabinet = [
      ['GET', `/api/cabinet/companies/${B.id}`, undefined],
      ['PATCH', `/api/cabinet/companies/${B.id}`, { clientCode: 'HACK' }],
      ['POST', `/api/cabinet/companies/${B.id}/archive`, {}],
      ['PATCH', `/api/cabinet/companies/${B.id}/members/${ownerB.id}`, { role: 'admin' }],
    ] as const;
    for (const [method, route, payload] of cabinet) {
      const res = await api(ctx, ownerA.cookie, method, route, payload);
      expect(res.statusCode, `${method} ${route}: ${res.body}`).toBe(404);
    }
  });

  it('isolates all three companies while allowing a deliberately shared member', async () => {
    for (const [cookie, company] of [
      [ownerA.cookie, C],
      [ownerB.cookie, C],
      [ownerC.cookie, A],
      [ownerC.cookie, B],
    ] as const) {
      const res = await api(ctx, cookie, 'GET', path(company.id, 'accounts'));
      expect(res.statusCode, res.body).toBe(404);
    }
    for (const company of [A, C]) {
      const allowed = await api(ctx, shared.cookie, 'GET', path(company.id, 'accounts'));
      expect(allowed.statusCode, allowed.body).toBe(200);
    }
    const sharedC = await api(ctx, shared.cookie, 'GET', path(C.id, `entries/${entryC.id}`));
    expect(sharedC.statusCode, sharedC.body).toBe(200);
    const denied = await api(ctx, shared.cookie, 'GET', path(B.id, 'accounts'));
    expect(denied.statusCode).toBe(404);

    // B cannot use a C identifier, and A cannot use one either.
    for (const cookie of [ownerB.cookie, ownerA.cookie]) {
      const cross = await api(ctx, cookie, 'GET', path(C.id, `entries/${entryC.id}`));
      expect(cross.statusCode, cross.body).toBe(404);
    }
    const cOnA = await api(ctx, ownerC.cookie, 'GET', path(A.id, `entries/${entryC.id}`));
    expect(cOnA.statusCode, cOnA.body).toBe(404);
  });

  it('never lists B or C data in the cabinet views of A', async () => {
    const companies = await api(ctx, ownerA.cookie, 'GET', '/api/cabinet/companies');
    expect(companies.statusCode).toBe(200);
    const ids = companies.json().companies.map((c: any) => c.id);
    expect(ids).toContain(A.id);
    expect(ids).not.toContain(B.id);
    expect(ids).not.toContain(C.id);

    const team = await api(ctx, ownerA.cookie, 'GET', '/api/cabinet/team');
    expect(team.statusCode).toBe(200);
    const serialised = JSON.stringify(team.json());
    expect(serialised).not.toContain(B.name);
    expect(serialised).not.toContain(C.name);
    for (const person of team.json().collaborators) {
      for (const assignment of person.assignments) expect(assignment.companyId).toBe(A.id);
    }

    const dashboard = await api(ctx, ownerA.cookie, 'GET', '/api/cabinet/dashboard');
    expect(dashboard.statusCode).toBe(200);
    expect(dashboard.json().metrics.clients).toBe(1);
  });

  it('filters B object identifiers used under A (IDOR/BOLA)', async () => {
    const objects = [
      ['entries', entryB.id],
      ['billing/customers', customerB.id],
      ['payroll/employees', employeeB.id],
      ['fixed-assets', assetB.id],
      ['attachments', attachmentB.attachment.id],
    ] as const;
    for (const [route, id] of objects) {
      const res = await api(ctx, ownerA.cookie, 'GET', path(A.id, `${route}/${id}`));
      expect(res.statusCode, `${route}/${id}: ${res.body}`).toBe(404);
      expect(res.body).not.toContain('B-only');
    }

    const update = await api(ctx, ownerA.cookie, 'PATCH', path(A.id, `entries/${entryB.id}`), {
      description: 'A cannot rename B',
    });
    expect(update.statusCode, update.body).toBe(404);
    const remove = await api(ctx, ownerA.cookie, 'DELETE', path(A.id, `entries/${entryB.id}`));
    expect(remove.statusCode, remove.body).toBe(404);
    const payrollDelete = await api(ctx, ownerA.cookie, 'DELETE', path(A.id, `payroll/employees/${employeeB.id}`));
    expect(payrollDelete.statusCode, payrollDelete.body).toBe(404);

    const downloadA = await api(ctx, ownerA.cookie, 'GET', path(A.id, `attachments/${attachmentB.attachment.id}`));
    expect(downloadA.statusCode).toBe(404);
    const downloadB = await api(ctx, ownerA.cookie, 'GET', path(B.id, `attachments/${attachmentB.attachment.id}`));
    expect(downloadB.statusCode).toBe(404);
    const hash = await ctx.db.query<{ sha256: string }>('SELECT sha256 FROM attachments WHERE id = $1', [
      attachmentB.attachment.id,
    ]);
    expect(hash.rows[0]!.sha256).toBe(attachmentB.sha256);
  });

  it('stops an admin from promoting themselves to owner and reopening a period', async () => {
    const promote = await api(
      ctx,
      adminA.cookie,
      'PATCH',
      `/api/cabinet/companies/${A.id}/members/${adminA.id}`,
      { role: 'owner' },
    );
    expect(promote.statusCode, promote.body).toBe(400);
    const role = await ctx.db.query<{ role: string }>(
      'SELECT role FROM company_members WHERE company_id = $1 AND user_id = $2',
      [A.id, adminA.id],
    );
    expect(role.rows[0]!.role).toBe('admin');

    const period = (await api(ctx, ownerA.cookie, 'GET', `/api/companies/${A.id}`)).json().periods[0];
    const reopen = await api(ctx, adminA.cookie, 'POST', path(A.id, `periods/${period.id}/reopen`));
    expect(reopen.statusCode).toBe(403);

    const demoteOwner = await api(
      ctx,
      ownerA.cookie,
      'PATCH',
      `/api/cabinet/companies/${A.id}/members/${ownerA.id}`,
      { role: 'admin' },
    );
    expect(demoteOwner.statusCode).toBe(400);

    // Two simultaneous attempts must not create an owner either.
    const attempts = await Promise.all([
      api(ctx, adminA.cookie, 'PATCH', `/api/cabinet/companies/${A.id}/members/${adminA.id}`, { role: 'owner' }),
      api(ctx, adminA.cookie, 'PATCH', `/api/cabinet/companies/${A.id}/members/${adminA.id}`, { role: 'owner' }),
    ]);
    for (const attempt of attempts) expect(attempt.statusCode).toBe(400);
    const owners = await ctx.db.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM company_members WHERE company_id = $1 AND role = 'owner'",
      [A.id],
    );
    expect(Number(owners.rows[0]!.count)).toBe(1);
  });

  it('protects owner and shared accounts from the global is_active flag', async () => {
    const byAdmin = await api(
      ctx,
      adminA.cookie,
      'PATCH',
      `/api/cabinet/companies/${A.id}/members/${payrollA.id}`,
      { isActive: false },
    );
    expect(byAdmin.statusCode, byAdmin.body).toBe(403);

    const self = await api(
      ctx,
      ownerA.cookie,
      'PATCH',
      `/api/cabinet/companies/${A.id}/members/${ownerA.id}`,
      { isActive: false },
    );
    expect(self.statusCode).toBe(400);

    const secondOwner = await registerUser(ctx, { email: 'm35-second-owner-a@example.test' });
    await ctx.db.query(
      "INSERT INTO company_members (company_id, user_id, role) VALUES ($1,$2,'owner')",
      [A.id, secondOwner.id],
    );
    const ownerTarget = await api(
      ctx,
      ownerA.cookie,
      'PATCH',
      `/api/cabinet/companies/${A.id}/members/${secondOwner.id}`,
      { isActive: false },
    );
    expect(ownerTarget.statusCode).toBe(400);

    const sharedTarget = await api(
      ctx,
      ownerA.cookie,
      'PATCH',
      `/api/cabinet/companies/${A.id}/members/${shared.id}`,
      { isActive: false },
    );
    expect(sharedTarget.statusCode, sharedTarget.body).toBe(409);
    const sharedMe = await api(ctx, shared.cookie, 'GET', '/api/auth/me');
    expect(sharedMe.statusCode).toBe(200);

    const deactivate = await api(
      ctx,
      ownerA.cookie,
      'PATCH',
      `/api/cabinet/companies/${A.id}/members/${payrollA.id}`,
      { isActive: false },
    );
    expect(deactivate.statusCode, deactivate.body).toBe(200);
    const lockedSession = await api(ctx, payrollA.cookie, 'GET', '/api/auth/me');
    expect(lockedSession.statusCode).toBe(401);

    const reactivate = await api(
      ctx,
      ownerA.cookie,
      'PATCH',
      `/api/cabinet/companies/${A.id}/members/${payrollA.id}`,
      { isActive: true },
    );
    expect(reactivate.statusCode, reactivate.body).toBe(200);
    const resurrected = await api(ctx, payrollA.cookie, 'GET', '/api/auth/me');
    expect(resurrected.statusCode).toBe(401);
    const relogin = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: payrollA.email, password: 'StrongPassw0rd!' },
    });
    expect(relogin.statusCode, relogin.body).toBe(200);
    payrollA.cookie = cookieFrom(relogin.headers as Record<string, unknown>);
  });

  it('keeps payroll management apart from administrative operations', async () => {
    const employees = await api(ctx, payrollA.cookie, 'GET', path(A.id, 'payroll/employees'));
    expect(employees.statusCode).toBe(200);
    const payslips = await api(ctx, payrollA.cookie, 'GET', path(A.id, 'payroll/payslips'));
    expect(payslips.statusCode).toBe(200);
    const declarations = await api(ctx, payrollA.cookie, 'GET', path(A.id, 'payroll/declarations'));
    expect(declarations.statusCode).toBe(200);

    const members = await api(ctx, payrollA.cookie, 'GET', path(A.id, 'members'));
    expect(members.statusCode).toBe(403);
    const exportCompany = await api(ctx, payrollA.cookie, 'POST', path(A.id, 'exports'));
    expect(exportCompany.statusCode).toBe(403);
    const team = await api(
      ctx,
      payrollA.cookie,
      'PATCH',
      `/api/cabinet/companies/${A.id}/members/${adminA.id}`,
      { role: 'viewer' },
    );
    expect(team.statusCode).toBe(403);
    const entry = await api(ctx, payrollA.cookie, 'POST', path(A.id, 'entries'), {});
    expect(entry.statusCode).toBe(403);
  });

  it('does not let a company admin export or inspect another company', async () => {
    const create = await api(ctx, ownerA.cookie, 'POST', path(B.id, 'exports'));
    expect(create.statusCode).toBe(404);
    const list = await api(ctx, ownerA.cookie, 'GET', path(B.id, 'exports'));
    expect(list.statusCode).toBe(404);
    const download = await api(ctx, ownerA.cookie, 'GET', path(B.id, 'exports/00000000-0000-0000-0000-000000000000/download'));
    expect(download.statusCode).toBe(404);

    const globalList = await api(ctx, ownerA.cookie, 'GET', '/api/admin/backups');
    expect(globalList.statusCode).toBe(403);
    const globalStatus = await api(ctx, ownerA.cookie, 'GET', '/api/admin/backup/status');
    expect(globalStatus.statusCode).toBe(200);
    expect(globalStatus.json().authorized).toBe(false);
    const restore = await api(
      ctx,
      ownerA.cookie,
      'POST',
      '/api/admin/backups/00000000-0000-0000-0000-000000000000/restore',
      { confirm: true },
    );
    expect(restore.statusCode).toBe(404);
  });

  it('rejects a dossier manager who is not a member, and never discloses a legacy outsider', async () => {
    const cabinet = await api(ctx, ownerA.cookie, 'PATCH', `/api/cabinet/companies/${A.id}`, {
      dossierManagerId: ownerC.id,
    });
    expect(cabinet.statusCode, cabinet.body).toBe(400);
    const company = await api(ctx, ownerA.cookie, 'PATCH', `/api/companies/${A.id}`, {
      dossierManagerId: ownerC.id,
    });
    expect(company.statusCode, company.body).toBe(400);
    const created = await api(ctx, ownerA.cookie, 'POST', '/api/companies', {
      name: 'M35 manager attempt (fictitious)',
      brn: 'M35-BRN-MANAGER',
      financialYearStart: '2025-07-01',
      financialYearEnd: '2026-06-30',
      dossierManagerId: ownerC.id,
    });
    expect(created.statusCode, created.body).toBe(400);

    const valid = await api(ctx, ownerA.cookie, 'PATCH', `/api/cabinet/companies/${A.id}`, {
      dossierManagerId: adminA.id,
    });
    expect(valid.statusCode, valid.body).toBe(200);
    expect(valid.json().company.dossier_manager_id).toBe(adminA.id);

    // Simulate a legacy row written before the membership rule existed.
    await ctx.db.query('UPDATE companies SET dossier_manager_id = $2 WHERE id = $1', [A.id, ownerC.id]);
    const sheet = await api(ctx, ownerA.cookie, 'GET', `/api/cabinet/companies/${A.id}`);
    expect(sheet.statusCode).toBe(200);
    expect(sheet.json().manager).toBeNull();
    expect(sheet.body).not.toContain(ownerC.email);
  });

  it('enforces the password policy on an invited member', async () => {
    const weak = await api(ctx, ownerA.cookie, 'POST', `/api/companies/${A.id}/members`, {
      email: 'm35-invited-weak@example.test',
      role: 'viewer',
      temporaryPassword: 'onlyletters',
    });
    expect(weak.statusCode).toBe(400);

    const short = await api(ctx, ownerA.cookie, 'POST', `/api/companies/${A.id}/members`, {
      email: 'm35-invited-short@example.test',
      role: 'viewer',
      temporaryPassword: 'Ab1',
    });
    expect(short.statusCode).toBe(400);

    const strong = await api(ctx, ownerA.cookie, 'POST', `/api/companies/${A.id}/members`, {
      email: 'm35-invited-strong@example.test',
      role: 'viewer',
      temporaryPassword: 'StrongPassw0rd!',
    });
    expect(strong.statusCode, strong.body).toBe(201);
  });

  it('returns a controlled 4xx for manipulated identifiers', async () => {
    for (const route of [
      'entries/not-a-uuid',
      'documents/not-a-uuid',
      'attachments/not-a-uuid',
      'bank/transactions/not-a-uuid',
      'billing/documents/not-a-uuid',
      'payroll/employees/not-a-uuid',
      'provisions/not-a-uuid',
      'accruals/not-a-uuid',
    ]) {
      const res = await api(ctx, ownerA.cookie, 'GET', path(A.id, route));
      expect(res.statusCode, `${route}: ${res.body}`).toBe(400);
      expect(res.json()?.error?.code, route).toBe('VALIDATION_ERROR');
      expect(res.body).not.toContain('invalid input syntax');
      expect(res.body).not.toContain('stack');
    }
  });

  it('requires a live session, rejects cross-site writes and revokes old sessions', async () => {
    const anonymous = await ctx.app.inject({ method: 'GET', url: path(A.id, 'accounts') });
    expect(anonymous.statusCode).toBe(401);

    const csrf = await ctx.app.inject({
      method: 'POST',
      url: path(A.id, 'entries'),
      headers: { cookie: ownerA.cookie, origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' },
      payload: {},
    });
    expect(csrf.statusCode).toBe(403);

    const headers = await ctx.app.inject({ method: 'GET', url: '/api/health' });
    expect(headers.headers['x-frame-options']).toBe('DENY');
    expect(headers.headers['x-content-type-options']).toBe('nosniff');
    expect(String(headers.headers['content-security-policy'])).toContain("default-src 'self'");

    const session = await registerUser(ctx, { email: 'm35-revoked@example.test' });
    expect((await api(ctx, session.cookie, 'GET', '/api/auth/me')).statusCode).toBe(200);
    const logout = await api(ctx, session.cookie, 'POST', '/api/auth/logout');
    expect(logout.statusCode).toBe(200);
    expect((await api(ctx, session.cookie, 'GET', '/api/auth/me')).statusCode).toBe(401);

    await ctx.db.query(
      `UPDATE sessions SET expires_at = now() - interval '1 day'
        WHERE user_id = (SELECT id FROM app_users WHERE email = $1)`,
      [adminA.email],
    );
    expect((await api(ctx, adminA.cookie, 'GET', '/api/auth/me')).statusCode).toBe(401);
  });

  it('throttles repeated failed logins without disabling the control', async () => {
    const victim = await registerUser(ctx, { email: 'm35-lock@example.test' });
    for (let i = 0; i < 5; i += 1) {
      const failed = await ctx.app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email: victim.email, password: 'WrongPassw0rd!' },
      });
      expect([401, 429]).toContain(failed.statusCode);
    }
    const locked = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: victim.email, password: 'StrongPassw0rd!' },
    });
    expect(locked.statusCode).toBe(429);
    const stillValid = await api(ctx, victim.cookie, 'GET', '/api/auth/me');
    expect(stillValid.statusCode).toBe(200);
  });

  it('makes session cookies Secure by default in production', () => {
    const production = loadConfig({ NODE_ENV: 'production' });
    expect(production.COOKIE_SECURE).toBe(true);
    const explicit = loadConfig({ NODE_ENV: 'production', COOKIE_SECURE: 'false' });
    expect(explicit.COOKIE_SECURE).toBe(false);
    const development = loadConfig({ NODE_ENV: 'development' });
    expect(development.COOKIE_SECURE).toBe(false);
  });
});
