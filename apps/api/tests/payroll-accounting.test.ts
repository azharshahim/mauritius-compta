import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  accountByCode, api, closeTestApp, journalByCode, setupCompanyWithChart,
  type TestContext, type TestUser,
} from './helpers.js';

/**
 * Mission 18 — payroll to accounting proposals.
 * Every company, employee and amount below is fictional. No payroll entry is
 * ever posted by the tests; the simulation stays blocked.
 */
describe('payroll accounting transfer', () => {
  let ctx: TestContext;
  let owner: TestUser;
  let company: any;
  let accounts: any[];
  let journals: any[];
  let period: any;
  let mapping: any;
  let transfer: any;

  const mappingPayload = () => ({
    journalId: journalByCode(journals, 'OD').id,
    wagesExpenseAccountId: accountByCode(accounts, '6000').id,
    employerCsgExpenseAccountId: accountByCode(accounts, '6010').id,
    employerNsfExpenseAccountId: accountByCode(accounts, '6010').id,
    trainingLevyExpenseAccountId: accountByCode(accounts, '6010').id,
    payePayableAccountId: accountByCode(accounts, '2300').id,
    csgEmployeePayableAccountId: accountByCode(accounts, '2400').id,
    csgEmployerPayableAccountId: accountByCode(accounts, '2400').id,
    nsfEmployeePayableAccountId: accountByCode(accounts, '2400').id,
    nsfEmployerPayableAccountId: accountByCode(accounts, '2400').id,
    trainingLevyPayableAccountId: accountByCode(accounts, '2400').id,
    netPayableAccountId: accountByCode(accounts, '2100').id,
    confirm: true,
    note: 'Correspondances fictives de démonstration, validées pour test.',
  });

  async function addDaniel() {
    const employee = await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/payroll/employees`, {
      employeeNumber: 'M1801', firstName: 'Daniel', lastName: 'Morel',
      dateOfBirth: '1988-04-12', nationality: 'Mauritian', countryOfResidence: 'Mauritius',
      email: 'daniel.morel@demo-fictif.test', hireDate: '2026-10-01',
      jobTitle: 'Administrative officer (fictional)', department: 'Administration',
      workLocation: 'Port Louis', payrollCurrency: 'MUR', paymentMethod: 'bank_transfer',
      bankName: 'Banque Fictive de Démonstration', bankAccountNumber: 'MU00MISSION180000000000',
      payFrequency: 'monthly', workerType: 'full_time', payeCategory: 'standard',
      taxResidency: 'resident',
    });
    expect(employee.statusCode, employee.body).toBe(201);
    const employeeId = employee.json().employee.id;
    const contract = await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/payroll/contracts`, {
      employeeId, contractType: 'permanent', workPattern: 'full_time',
      effectiveFrom: '2026-10-01', baseSalary: '30000', salaryPeriod: 'monthly', currency: 'MUR',
      changeReason: 'Fictional permanent contract — Mission 18',
    });
    expect(contract.statusCode, contract.body).toBe(201);
    const edf = await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/payroll/edf`, {
      employeeId, taxYearStart: '2026-07-01', declarationDate: '2026-09-30',
      effectiveFrom: '2026-10-01', dependentCount: 0,
      documentRef: 'FICT-EDF-M1801', sourceReference: 'Fictional EDF, zero dependants',
    });
    expect(edf.statusCode, edf.body).toBe(201);
  }

  beforeAll(async () => {
    const setup = await setupCompanyWithChart();
    ctx = setup.ctx; owner = setup.user; company = setup.company;
    accounts = setup.accounts; journals = setup.journals;
    const settings = await api(ctx, owner.cookie, 'PATCH', `/api/companies/${company.id}/payroll/settings`, {
      statutoryArEnabled: true, notes: 'Fictional Mission 18 accounting company.',
    });
    expect(settings.statusCode, settings.body).toBe(200);
    await addDaniel();
    const created = await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/payroll/periods`, {
      year: 2026, month: 10, paymentDate: '2026-10-31',
    });
    expect(created.statusCode, created.body).toBe(201);
    period = created.json().period;
    await api(ctx, owner.cookie, 'PATCH', `/api/companies/${company.id}/payroll/periods/${period.id}/status`, { status: 'data_collection' });
    const calculated = await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/payroll/periods/${period.id}/calculate`, {});
    expect(calculated.statusCode, calculated.body).toBe(200);
    // October 2026 is outside the default FY 2025/2026: open a fictional accounting period.
    await ctx.db.query(
      `INSERT INTO accounting_periods (company_id, name, start_date, end_date, status)
       VALUES ($1, 'FY 2026/2027 (fictional)', '2026-07-01', '2027-06-30', 'open')`,
      [company.id],
    );
  });

  afterAll(async () => { await closeTestApp(ctx); });

  it('blocks a proposal until a validated account mapping exists', async () => {
    const preview = await api(ctx, owner.cookie, 'GET',
      `/api/companies/${company.id}/payroll/periods/${period.id}/accounting-transfer`);
    expect(preview.statusCode, preview.body).toBe(200);
    const body = preview.json().preview;
    expect(body.employees).toBe(1);
    expect(body.mapping).toBeNull();
    expect(body.blockers.some((check: any) => check.code === 'ACCOUNT_MAPPING_MISSING')).toBe(true);
    expect(body.canApprove).toBe(false);
    expect(body.totals.gross).toBe('30635.0000');
    expect(body.totals.employerCost).toBe('32756.3250');
    expect(body.totals.difference).toBe('0.0000');
    expect(body.notice).toMatch(/Aucune écriture/i);
  });

  it('validates a versioned mapping from the company chart and rejects inactive accounts', async () => {
    await ctx.db.query('UPDATE accounts SET is_active = false WHERE company_id = $1 AND id = $2',
      [company.id, accountByCode(accounts, '1000').id]);
    const inactive = await api(ctx, owner.cookie, 'PUT', `/api/companies/${company.id}/payroll/accounting/mapping`, {
      ...mappingPayload(),
      wagesExpenseAccountId: accountByCode(accounts, '1000').id,
    });
    expect(inactive.statusCode).toBe(400);
    expect(inactive.json().error.code).toBe('PAYROLL_MAPPING_ACCOUNT_INACTIVE');
    await ctx.db.query('UPDATE accounts SET is_active = true WHERE company_id = $1 AND id = $2',
      [company.id, accountByCode(accounts, '1000').id]);

    const missing = await api(ctx, owner.cookie, 'PUT', `/api/companies/${company.id}/payroll/accounting/mapping`, {
      ...mappingPayload(), wagesExpenseAccountId: undefined,
    });
    expect(missing.statusCode).toBe(400);

    const saved = await api(ctx, owner.cookie, 'PUT', `/api/companies/${company.id}/payroll/accounting/mapping`, mappingPayload());
    expect(saved.statusCode, saved.body).toBe(201);
    mapping = saved.json().mapping;
    expect(mapping.version).toBe(1);
    expect(mapping.status).toBe('VALIDATED');
    expect(mapping.accounts.wagesExpense.code).toBe('6000');
    expect(mapping.accounts.netPayable.code).toBe('2100');

    await ctx.db.query('UPDATE accounts SET is_active = false WHERE company_id = $1 AND id = $2',
      [company.id, accountByCode(accounts, '6000').id]);
    const blocked = await api(ctx, owner.cookie, 'GET',
      `/api/companies/${company.id}/payroll/periods/${period.id}/accounting-transfer`);
    expect(blocked.json().preview.blockers.some((check: any) => check.code === 'ACCOUNT_MAPPING_INACTIVE')).toBe(true);
    await ctx.db.query('UPDATE accounts SET is_active = true WHERE company_id = $1 AND id = $2',
      [company.id, accountByCode(accounts, '6000').id]);

    const second = await api(ctx, owner.cookie, 'PUT', `/api/companies/${company.id}/payroll/accounting/mapping`, mappingPayload());
    expect(second.statusCode, second.body).toBe(201);
    mapping = second.json().mapping;
    expect(mapping.version).toBe(2);
    const history = await api(ctx, owner.cookie, 'GET', `/api/companies/${company.id}/payroll/accounting/mapping`);
    expect(history.json().mappingHistory.filter((row: any) => row.status === 'VALIDATED')).toHaveLength(1);
    expect(history.json().mappingHistory.filter((row: any) => row.status === 'SUPERSEDED').length).toBe(1);
  });

  it('builds an exactly balanced proposal with separated payroll components', async () => {
    const preview = await api(ctx, owner.cookie, 'GET',
      `/api/companies/${company.id}/payroll/periods/${period.id}/accounting-transfer`);
    const body = preview.json().preview;
    expect(body.blockers).toEqual([]);
    expect(body.totals.gross).toBe('30635.0000');
    expect(body.totals.paye).toBeUndefined();
    expect(body.totals.employeeStatutoryDeductions).toBe('756.6250');
    expect(body.totals.employerContributions).toBe('2121.3250');
    expect(body.totals.netAfterStatutory).toBe('29878.3750');
    expect(body.totals.employerCost).toBe('32756.3250');
    expect(body.totals.debitTotal).toBe('32756.3250');
    expect(body.totals.creditTotal).toBe('32756.3250');
    expect(body.totals.difference).toBe('0.0000');
    expect(body.checks.some((check: any) => check.code === 'ENTRY_BALANCED')).toBe(true);
    expect(body.lines).toHaveLength(10);
    expect(body.lines.some((line: any) => line.category === 'payePayable')).toBe(false);
    expect(body.lines.find((line: any) => line.category === 'grossWages')).toMatchObject({
      accountCode: '6000', debit: '30635.0000', credit: '0.0000',
    });
    expect(body.lines.find((line: any) => line.category === 'netPayable')).toMatchObject({
      accountCode: '2100', debit: '0.0000', credit: '29878.3750',
    });
    expect(body.canApprove).toBe(true);
    expect(body.canPost).toBe(false);
    expect(body.postingChecks.map((check: any) => check.code)).toContain('PAYROLL_RULES_NOT_EXPERT_VALIDATED');
  });

  it('generates, approves for test and never posts automatically', async () => {
    const before = await ctx.db.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM journal_entries WHERE company_id = $1', [company.id],
    );
    expect(before.rows[0]!.count).toBe('0');

    const generated = await api(ctx, owner.cookie, 'POST',
      `/api/companies/${company.id}/payroll/periods/${period.id}/accounting-transfer`, { note: 'Proposition fictive mission 18' });
    expect(generated.statusCode, generated.body).toBe(201);
    transfer = generated.json().transfer;
    expect(transfer.status).toBe('REVIEW_REQUIRED');
    expect(transfer.version).toBe(1);
    expect(transfer.mappingVersion).toBe(2);
    expect(transfer.canPost).toBe(false);
    expect(transfer.totals.difference).toBe('0.0000');

    const missingNote = await api(ctx, owner.cookie, 'POST',
      `/api/companies/${company.id}/payroll/accounting-transfers/${transfer.id}/approve`, { confirm: true, note: 'court' });
    expect(missingNote.statusCode).toBe(400);

    const approved = await api(ctx, owner.cookie, 'POST',
      `/api/companies/${company.id}/payroll/accounting-transfers/${transfer.id}/approve`,
      { confirm: true, note: 'Approbation de test fictive, sans comptabilisation.' });
    expect(approved.statusCode, approved.body).toBe(200);
    expect(approved.json().transfer.status).toBe('APPROVED_FOR_TEST');
    expect(approved.json().transfer.decidedByName).toBeTruthy();

    const posted = await api(ctx, owner.cookie, 'POST',
      `/api/companies/${company.id}/payroll/accounting-transfers/${transfer.id}/post`, {});
    expect(posted.statusCode).toBe(409);
    expect(posted.json().error.code).toBe('PAYROLL_TRANSFER_POSTING_BLOCKED');
    expect(posted.json().error.details.blockers.map((check: any) => check.code))
      .toContain('PAYROLL_RULES_NOT_EXPERT_VALIDATED');

    const after = await ctx.db.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM journal_entries WHERE company_id = $1', [company.id],
    );
    expect(after.rows[0]!.count).toBe('0');
    const postedTransfer = await api(ctx, owner.cookie, 'GET',
      `/api/companies/${company.id}/payroll/accounting-transfers/${transfer.id}`);
    expect(postedTransfer.json().transfer.status).toBe('APPROVED_FOR_TEST');
    expect(postedTransfer.json().transfer.postedEntryId).toBeNull();
  });

  it('rejects an approved proposal with a reason and allows a new version', async () => {
    const rejected = await api(ctx, owner.cookie, 'POST',
      `/api/companies/${company.id}/payroll/accounting-transfers/${transfer.id}/reject`,
      { reason: 'Rejet de test : montants à revoir avant toute utilisation.' });
    expect(rejected.statusCode, rejected.body).toBe(200);
    expect(rejected.json().transfer.status).toBe('REJECTED');
    expect(rejected.json().transfer.rejectionReason).toMatch(/Rejet de test/);

    const again = await api(ctx, owner.cookie, 'POST',
      `/api/companies/${company.id}/payroll/accounting-transfers/${transfer.id}/approve`,
      { confirm: true, note: 'Tentative de réapprobation après rejet.' });
    expect(again.statusCode).toBe(409);

    const second = await api(ctx, owner.cookie, 'POST',
      `/api/companies/${company.id}/payroll/periods/${period.id}/accounting-transfer`, {});
    expect(second.statusCode, second.body).toBe(201);
    expect(second.json().transfer.version).toBe(2);
    expect(second.json().transfer.status).toBe('REVIEW_REQUIRED');
    transfer = second.json().transfer;
  });

  it('exports only an internal CSV and preserves the source trail', async () => {
    const csv = await api(ctx, owner.cookie, 'GET',
      `/api/companies/${company.id}/payroll/accounting-transfers/${transfer.id}/csv`);
    expect(csv.statusCode, csv.body).toBe(200);
    expect(csv.body.startsWith('\uFEFF')).toBe(true);
    expect(csv.body).toContain('PAYROLL ACCOUNTING TRANSFER - INTERNAL SIMULATION - NOT POSTED AUTOMATICALLY');
    expect(csv.body).toContain('SIMULATION - NOT VALIDATED FOR PAYMENT OR ACCOUNTING');
    expect(csv.body).toContain('30635.0000');
    expect(csv.body).toContain('32756.3250');
    expect(csv.body).toContain('NO JOURNAL ENTRY IS CREATED BY THIS FILE');
    expect(csv.body).toContain(transfer.sourceFingerprint);
    expect(csv.body).toContain(transfer.calculationIds[0]);
    expect(csv.body).not.toContain('MRA,PACO,V1.0');
    expect(csv.headers['content-disposition']).toContain('PAYROLL-ACCOUNTING-INTERNAL');
  });

  it('detects a stale payroll source before approval', async () => {
    const recalculated = await api(ctx, owner.cookie, 'POST',
      `/api/companies/${company.id}/payroll/periods/${period.id}/calculate`, { force: true });
    expect(recalculated.statusCode, recalculated.body).toBe(200);
    const stale = await api(ctx, owner.cookie, 'POST',
      `/api/companies/${company.id}/payroll/accounting-transfers/${transfer.id}/approve`,
      { confirm: true, note: 'Approbation après recalcul, doit être refusée.' });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.code).toBe('PAYROLL_TRANSFER_STALE');
  });

  it('isolates mappings and transfers between companies', async () => {
    const other = await setupCompanyWithChart();
    try {
      const foreign = await api(other.ctx, other.user.cookie, 'GET',
        `/api/companies/${other.company.id}/payroll/accounting-transfers/${transfer.id}`);
      expect(foreign.statusCode).toBe(404);
      const list = await api(other.ctx, other.user.cookie, 'GET',
        `/api/companies/${other.company.id}/payroll/accounting-transfers`);
      expect(list.statusCode, list.body).toBe(200);
      expect(list.json().transfers).toEqual([]);
      const mapping = await api(other.ctx, other.user.cookie, 'GET',
        `/api/companies/${other.company.id}/payroll/accounting/mapping`);
      expect(mapping.json().mapping).toBeNull();
    } finally {
      await closeTestApp(other.ctx);
    }
  });
});
