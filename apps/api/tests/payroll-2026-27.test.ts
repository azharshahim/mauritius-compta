import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, closeTestApp, setupCompanyWithChart, type TestContext, type TestUser } from './helpers.js';
import { formatAmount, parseAmount } from '../src/lib/money.js';
import { computeCumulativePaye } from '../src/modules/payroll/statutory.js';

/**
 * Mission 16 — October 2026 payroll under the Finance Act 2026 rates.
 * Daniel Morel and Mauritius Demo Services Ltd are entirely fictional.
 * Passing tests are not a legal opinion and never approve a real payslip.
 */
describe('mission 16 — October 2026 payroll (2026/27 rates)', () => {
  let ctx: TestContext;
  let owner: TestUser;
  let company: { id: string; name: string };
  let calculation: any;
  let period: any;

  const bands2026 = [
    { upto: '500000', rate: '0' },
    { upto: '1000000', rate: '10' },
    { upto: '12000000', rate: '20' },
    { upto: null, rate: '35' },
  ];

  beforeAll(async () => {
    const setup = await setupCompanyWithChart();
    ctx = setup.ctx;
    owner = setup.user;
    company = setup.company;

    const settings = await api(ctx, owner.cookie, 'PATCH', `/api/companies/${company.id}/payroll/settings`, {
      statutoryArEnabled: true,
      notes: 'Fictional Mission 16 test company — October 2026.',
    });
    expect(settings.statusCode, settings.body).toBe(200);

    const employee = await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/payroll/employees`, {
      employeeNumber: 'M016',
      firstName: 'Daniel',
      lastName: 'Morel',
      dateOfBirth: '1988-04-12',
      nationality: 'Mauritian',
      countryOfResidence: 'Mauritius',
      email: 'daniel.morel@demo-fictif.test',
      hireDate: '2026-10-01',
      jobTitle: 'Administrative officer (fictional)',
      department: 'Administration',
      workLocation: 'Port Louis',
      payrollCurrency: 'MUR',
      paymentMethod: 'bank_transfer',
      bankName: 'Banque Fictive de Démonstration',
      bankAccountNumber: 'MU00MISSION160000000000',
      payFrequency: 'monthly',
      workerType: 'full_time',
      payeCategory: 'standard',
      taxResidency: 'resident',
    });
    expect(employee.statusCode, employee.body).toBe(201);
    const employeeId = employee.json().employee.id;

    const contract = await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/payroll/contracts`, {
      employeeId,
      contractType: 'permanent',
      workPattern: 'full_time',
      effectiveFrom: '2026-10-01',
      baseSalary: '30000',
      salaryPeriod: 'monthly',
      currency: 'MUR',
      changeReason: 'Fictional permanent contract — Mission 16',
    });
    expect(contract.statusCode, contract.body).toBe(201);

    const created = await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/payroll/periods`, {
      year: 2026, month: 10, paymentDate: '2026-10-31',
    });
    expect(created.statusCode, created.body).toBe(201);
    period = created.json().period;
    const moved = await api(ctx, owner.cookie, 'PATCH',
      `/api/companies/${company.id}/payroll/periods/${period.id}/status`, { status: 'data_collection' });
    expect(moved.statusCode, moved.body).toBe(200);

    const edf = await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/payroll/edf`, {
      employeeId,
      taxYearStart: '2026-07-01',
      declarationDate: '2026-09-30',
      effectiveFrom: '2026-10-01',
      dependentCount: 0,
      documentRef: 'FICT-EDF-2627-DANIEL',
      sourceReference: 'Fictional EDF, zero dependants',
    });
    expect(edf.statusCode, edf.body).toBe(201);
    expect(edf.json().declaration.total_reliefs).toBe('0.0000');

    const calculated = await api(ctx, owner.cookie, 'POST',
      `/api/companies/${company.id}/payroll/periods/${period.id}/calculate`, {});
    expect(calculated.statusCode, calculated.body).toBe(200);
    calculation = calculated.json().calculations.find((c: any) => c.employee_number === 'M016');
    expect(calculation, calculated.body).toBeTruthy();
  });

  afterAll(async () => { await closeTestApp(ctx); });

  it('uses the enacted 2026/27 35% band above Rs 12 million, without the old FSC', () => {
    const result = computeCumulativePaye({
      cumulativeEmoluments: parseAmount('15000000'),
      cumulativeReliefs: 0n,
      periodsElapsed: 12,
      previousWithheld: 0n,
      bands: bands2026,
    });
    expect(formatAmount(result.value.cumulativeTax)).toBe('3300000.0000');
    expect(result.value.bands.map((b) => b.rate)).toEqual(['0', '10', '20', '35']);
  });

  it('calculates Daniel Morel exactly for October 2026 with the real engine', () => {
    expect(calculation.base_amount).toBe('30000.0000');
    expect(calculation.additional_remuneration).toBe('635.0000');
    expect(calculation.basic_wage).toBe('30635.0000');
    expect(calculation.gross).toBe('30635.0000');
    expect(calculation.paye).toBe('0.0000');
    expect(calculation.paye_basis).toBe('EDF_CUMULATIVE');
    expect(calculation.csg_employee).toBe('459.5250');
    expect(calculation.csg_employer).toBe('919.0500');
    expect(calculation.nsf_employee).toBe('297.1000');
    expect(calculation.nsf_employer).toBe('742.7500');
    expect(calculation.training_levy).toBe('459.5250');
    expect(calculation.net_after_statutory).toBe('29878.3750');
    expect(calculation.employer_cost).toBe('32756.3250');
    expect(calculation.net_payable).toBeNull();
    expect(calculation.status).toBe('expert_review_pending');
    expect(calculation.missing_rules).toEqual([]);
  });

  it('records the dated 2026/27 PAYE rule and the 1 July 2026 NSF table', async () => {
    const rules = await api(ctx, owner.cookie, 'GET', `/api/companies/${company.id}/payroll/rules`);
    const paye = rules.json().rules
      .filter((r: any) => r.rule_code === 'PAYE' && r.effective_from === '2026-07-01')
      .sort((a: any, b: any) => b.version - a.version)[0];
    expect(paye).toBeTruthy();
    expect(paye.effective_to).toBe('2027-06-30');
    expect(paye.parameters.bands.at(-1).rate).toBe('35');
    expect(paye.parameters.monthlyWithholdingTableVerified).toBe(false);
    const prior = rules.json().rules
      .filter((r: any) => r.rule_code === 'PAYE' && r.effective_from === '2025-07-01')[0];
    expect(prior.effective_to).toBe('2026-06-30');
    const limits = rules.json().rules
      .filter((r: any) => r.rule_code === 'NSF_LIMITS' && r.effective_from === '2026-07-01')[0];
    expect(limits.parameters.limitsByFrequency.monthly.max).toBe('29710');
  });

  it('issues a PDF simulation with statutory totals and keeps payment blocked', async () => {
    const payslip = await api(ctx, owner.cookie, 'POST',
      `/api/companies/${company.id}/payroll/calculations/${calculation.id}/payslip`, {});
    expect(payslip.statusCode, payslip.body).toBe(201);
    expect(payslip.json().payslip.snapshot.totals.netPayable).toBeNull();
    expect(payslip.json().payslip.snapshot.disclaimer).toContain('NOT FOR PAYMENT');
    const pdf = await api(ctx, owner.cookie, 'GET',
      `/api/companies/${company.id}/payroll/payslips/${payslip.json().payslip.id}/pdf`);
    expect(pdf.statusCode, pdf.body).toBe(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');
    expect(pdf.body.slice(0, 4)).toBe('%PDF');
    expect(pdf.body.length).toBeGreaterThan(3_000);
  });
});
