import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, closeTestApp, setupCompanyWithChart, type TestContext, type TestUser } from './helpers.js';

/**
 * Mission 17 — monthly PAYE/CSG/NSF preparation.
 * All companies and people are fictional. No MRA submission or credential exists.
 */
describe('monthly MRA preparation', () => {
  let ctx: TestContext;
  let owner: TestUser;
  let company: { id: string; name: string };
  let period: any;
  let declaration: any;

  async function addEmployee(number: string, salary: string, firstName: string, lastName: string) {
    const employee = await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/payroll/employees`, {
      employeeNumber: number, firstName, lastName,
      dateOfBirth: '1988-04-12', nationality: 'Mauritian', countryOfResidence: 'Mauritius',
      email: `${number.toLowerCase()}@demo-fictif.test`, hireDate: '2026-10-01',
      jobTitle: 'Administrative officer (fictional)', department: 'Administration',
      workLocation: 'Port Louis', payrollCurrency: 'MUR', paymentMethod: 'bank_transfer',
      bankName: 'Banque Fictive de Démonstration', bankAccountNumber: 'MU00MISSION170000000000',
      payFrequency: 'monthly', workerType: 'full_time', payeCategory: 'standard', taxResidency: 'resident',
    });
    expect(employee.statusCode, employee.body).toBe(201);
    const employeeId = employee.json().employee.id;
    const contract = await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/payroll/contracts`, {
      employeeId, contractType: 'permanent', workPattern: 'full_time',
      effectiveFrom: '2026-10-01', baseSalary: salary, salaryPeriod: 'monthly', currency: 'MUR',
      changeReason: 'Fictional permanent contract — Mission 17',
    });
    expect(contract.statusCode, contract.body).toBe(201);
    const edf = await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/payroll/edf`, {
      employeeId, taxYearStart: '2026-07-01', declarationDate: '2026-09-30',
      effectiveFrom: '2026-10-01', dependentCount: 0,
      documentRef: `FICT-EDF-${number}`, sourceReference: 'Fictional EDF, zero dependants',
    });
    expect(edf.statusCode, edf.body).toBe(201);
    return employeeId;
  }

  beforeAll(async () => {
    const setup = await setupCompanyWithChart();
    ctx = setup.ctx; owner = setup.user; company = setup.company;
    const settings = await api(ctx, owner.cookie, 'PATCH', `/api/companies/${company.id}/payroll/settings`, {
      statutoryArEnabled: true, notes: 'Fictional Mission 17 declaration company.',
    });
    expect(settings.statusCode, settings.body).toBe(200);
    await addEmployee('M1701', '30000', 'Daniel', 'Morel');
    await addEmployee('M1702', '45000', 'Amina', 'Fictive');
    const created = await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/payroll/periods`, {
      year: 2026, month: 10, paymentDate: '2026-10-31',
    });
    expect(created.statusCode, created.body).toBe(201);
    period = created.json().period;
    await api(ctx, owner.cookie, 'PATCH', `/api/companies/${company.id}/payroll/periods/${period.id}/status`, { status: 'data_collection' });
    const calculated = await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/payroll/periods/${period.id}/calculate`, {});
    expect(calculated.statusCode, calculated.body).toBe(200);
    expect(calculated.json().calculations).toHaveLength(2);
  });

  afterAll(async () => { await closeTestApp(ctx); });

  it('previews totals from persisted calculations and blocks the official export', async () => {
    const preview = await api(ctx, owner.cookie, 'GET', `/api/companies/${company.id}/payroll/periods/${period.id}/mra-return`);
    expect(preview.statusCode, preview.body).toBe(200);
    const body = preview.json();
    expect(body.employees).toHaveLength(2);
    expect(body.totals.gross).toBe('76270.0000');
    expect(body.totals.csgEmployee).toBe('1144.0500');
    expect(body.totals.csgEmployer).toBe('2288.1000');
    expect(body.totals.nsfEmployee).toBe('594.2000');
    expect(body.totals.nsfEmployer).toBe('1485.5000');
    expect(body.totals.trainingLevy).toBe('1144.0500');
    expect(body.checks.some((check: any) => check.code === 'COMPANY_ISOLATION')).toBe(true);
    expect(body.checks.some((check: any) => check.code === 'RULES_NOT_VALIDATED')).toBe(true);
    expect(body.officialCsv.available).toBe(false);
    expect(body.officialCsv.reasons.map((reason: any) => reason.code)).toContain('EMPLOYEE_FULL_NIC_MISSING');
    expect(body.regulatoryStatus).toBe('NOT_SUBMITTED');
    expect(body.canPrepare).toBe(false);
    expect(body.status).toBe('PREPARATION_ONLY');
  });

  it('requires a fictitious employer identifier and archives versions', async () => {
    const missing = await api(ctx, owner.cookie, 'POST',
      `/api/companies/${company.id}/payroll/periods/${period.id}/mra-return`, { employerIdentifier: '' });
    expect(missing.statusCode).toBe(400);

    const first = await api(ctx, owner.cookie, 'POST',
      `/api/companies/${company.id}/payroll/periods/${period.id}/mra-return`,
      { employerIdentifier: 'DEMO-ERN-1701' });
    expect(first.statusCode, first.body).toBe(201);
    declaration = first.json().declaration;
    expect(declaration.version).toBe(1);
    expect(declaration.status).toBe('PREPARATION_ONLY');
    expect(declaration.regulatoryStatus).toBe('NOT_SUBMITTED');
    expect(declaration.employerIdentifier).toBe('DEMO-ERN-1701');

    const second = await api(ctx, owner.cookie, 'POST',
      `/api/companies/${company.id}/payroll/periods/${period.id}/mra-return`,
      { employerIdentifier: 'DEMO-ERN-1701' });
    expect(second.statusCode, second.body).toBe(201);
    expect(second.json().declaration.version).toBe(2);

    const history = await api(ctx, owner.cookie, 'GET',
      `/api/companies/${company.id}/payroll/declarations?periodId=${period.id}`);
    expect(history.statusCode, history.body).toBe(200);
    expect(history.json().declarations).toHaveLength(2);
    expect(history.json().declarations[0].version).toBe(2);
  });

  it('keeps the individual payslip totals aligned with the declaration', async () => {
    const calculations = await api(ctx, owner.cookie, 'GET',
      `/api/companies/${company.id}/payroll/periods/${period.id}/calculations`);
    const daniel = calculations.json().calculations.find((item: any) => item.employee_number === 'M1701');
    const payslip = await api(ctx, owner.cookie, 'POST',
      `/api/companies/${company.id}/payroll/calculations/${daniel.id}/payslip`, {});
    expect(payslip.statusCode, payslip.body).toBe(201);
    const snapshot = payslip.json().payslip.snapshot;
    const preview = await api(ctx, owner.cookie, 'GET',
      `/api/companies/${company.id}/payroll/periods/${period.id}/mra-return?employerIdentifier=DEMO-ERN-1701`);
    const row = preview.json().employees.find((item: any) => item.employeeNumber === 'M1701');
    expect(row.gross).toBe(snapshot.totals.gross);
    expect(row.paye).toBe(snapshot.totals.paye);
    expect(row.csgEmployee).toBe(snapshot.totals.csgEmployee);
    expect(row.csgEmployer).toBe(snapshot.totals.csgEmployer);
    expect(row.nsfEmployee).toBe(snapshot.totals.nsfEmployee);
    expect(row.nsfEmployer).toBe(snapshot.totals.nsfEmployer);
    expect(row.trainingLevy).toBe(snapshot.totals.trainingLevy);
  });

  it('exports an internal CSV that is explicitly not an MRA file', async () => {
    const csv = await api(ctx, owner.cookie, 'GET',
      `/api/companies/${company.id}/payroll/declarations/${declaration.id}/csv`);
    expect(csv.statusCode, csv.body).toBe(200);
    expect(csv.body.startsWith('\uFEFF')).toBe(true);
    expect(csv.body).toContain('PAYROLL DECLARATION - INTERNAL PREPARATION - NOT SUBMITTED TO MRA');
    expect(csv.body).toContain('SIMULATION - NOT VALIDATED FOR PAYMENT');
    expect(csv.body).toContain('OFFICIAL MRA CSV');
    expect(csv.body).toContain('76270.0000');
    expect(csv.body).not.toContain('MRA,PACO,V1.0');
    expect(csv.headers['content-disposition']).toContain('MRA-INTERNAL-PREPARATION');
  });

  it('isolates declarations by company', async () => {
    const other = await setupCompanyWithChart();
    try {
      const forbidden = await api(other.ctx, other.user.cookie, 'GET',
        `/api/companies/${other.company.id}/payroll/declarations/${declaration.id}`);
      expect(forbidden.statusCode).toBe(404);
      const list = await api(other.ctx, other.user.cookie, 'GET',
        `/api/companies/${other.company.id}/payroll/declarations`);
      expect(list.statusCode, list.body).toBe(200);
      expect(list.json().declarations).toHaveLength(0);
    } finally {
      await closeTestApp(other.ctx);
    }
  });
});
