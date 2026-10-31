import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  api,
  closeTestApp,
  setupCompanyWithChart,
  type TestContext,
  type TestUser,
} from './helpers.js';
import { formatAmount, parseAmount } from '../src/lib/money.js';
import {
  computeAdditionalRemuneration,
  computeCsg,
  computeCumulativePaye,
  computeEndOfYearBonus,
  computeNsf,
  computePayeWithoutEdf,
  computeTrainingLevy,
  percentage,
  roundDownRupee,
  roundUpRupee,
  scaleBandThreshold,
} from '../src/modules/payroll/statutory.js';

/**
 * Mission 15 — statutory engine. All people, wages and identifiers are
 * fictional. These tests verify the implemented formula against the official
 * 2025/26 and 2026/27 tables recorded in the regulatory register. Passing
 * tests never constitute legal or expert approval.
 */

const rupees = (value: string) => formatAmount(parseAmount(value));
const whole = (value: bigint) => formatAmount(value);
const bands = [
  { upto: '500000', rate: '0' },
  { upto: '1000000', rate: '10' },
  { upto: null, rate: '20' },
];

describe('statutory formulas (pure, deterministic)', () => {
  it('scales the official monthly PAYE bands from 38,462 to 461,544 and 500,000 in June', () => {
    expect(whole((scaleBandThreshold(parseAmount('500000'), 1)))).toBe('38462.0000');
    expect(whole((scaleBandThreshold(parseAmount('500000'), 6)))).toBe('230772.0000');
    expect(whole((scaleBandThreshold(parseAmount('500000'), 11)))).toBe('423082.0000');
    expect(whole((scaleBandThreshold(parseAmount('500000'), 12)))).toBe('500000.0000');
    expect(whole((scaleBandThreshold(parseAmount('500000'), 13)))).toBe('500000.0000');
  });

  it('computes July PAYE exactly as the official 38,462 / 38,462 / remainder table', () => {
    const result = computeCumulativePaye({
      cumulativeEmoluments: parseAmount('100000'),
      cumulativeReliefs: 0n,
      periodsElapsed: 1,
      previousWithheld: 0n,
      bands,
    });
    expect(whole((result.value.cumulativeTax))).toBe('8461.0000');
    expect(whole((result.value.currentPaye))).toBe('8461.0000');
  });

  it('never refunds a negative PAYE difference: the excess is carried forward', () => {
    const result = computeCumulativePaye({
      cumulativeEmoluments: parseAmount('60000'),
      cumulativeReliefs: 0n,
      periodsElapsed: 1,
      previousWithheld: parseAmount('9999'),
      bands,
    });
    expect(result.value.currentPaye).toBe(0n);
  });

  it('applies the no-EDF flat 15% only above 38,462', () => {
    const below = computePayeWithoutEdf({ periodEmoluments: parseAmount('38462'), threshold: '38462', rate: '15' });
    expect(below.value).toBe(0n);
    const above = computePayeWithoutEdf({ periodEmoluments: parseAmount('40000'), threshold: '38462', rate: '15' });
    expect(whole((above.value))).toBe('6000.0000');
  });

  it('selects CSG rates at the 50,000 threshold for employee and employer', () => {
    const low = computeCsg({
      amount: parseAmount('50000'), threshold: '50000',
      lowEmployeeRate: '1.5', lowEmployerRate: '3', highEmployeeRate: '3', highEmployerRate: '6',
    });
    expect(whole((low.value.employee))).toBe('750.0000');
    expect(whole((low.value.employer))).toBe('1500.0000');
    const high = computeCsg({
      amount: parseAmount('50001'), threshold: '50000',
      lowEmployeeRate: '1.5', lowEmployerRate: '3', highEmployeeRate: '3', highEmployerRate: '6',
    });
    expect(high.value.category).toBe('high');
    expect(whole((high.value.employee))).toBe('1500.0300');
    expect(whole((high.value.employer))).toBe('3000.0600');
  });

  it('uses dated NSF minimum and maximum per frequency, never a universal monthly cap', () => {
    const monthly = computeNsf({
      basicWage: parseAmount('100000'), frequency: 'monthly',
      limits: { minHousehold: '2910', minOther: '4580', max: '29710' },
      household: false, employeeRate: '1', employerRate: '2.5',
    });
    expect(whole((monthly.value.assessable))).toBe('29710.0000');
    expect(monthly.value.capped).toBe(true);
    const weekly = computeNsf({
      basicWage: parseAmount('30000'), frequency: 'weekly',
      limits: { minHousehold: '672', minOther: '1057', max: '6856' },
      household: false, employeeRate: '1', employerRate: '2.5',
    });
    expect(whole((weekly.value.assessable))).toBe('6856.0000');
    const daily = computeNsf({
      basicWage: parseAmount('1500'), frequency: 'daily',
      limits: { minHousehold: '112', minOther: '176', max: '1143' },
      household: false, employeeRate: '1', employerRate: '2.5',
    });
    expect(whole((daily.value.assessable))).toBe('1143.0000');
    const floored = computeNsf({
      basicWage: parseAmount('1000'), frequency: 'monthly',
      limits: { minHousehold: '2910', minOther: '4580', max: '29710' },
      household: true, employeeRate: '1', employerRate: '2.5',
    });
    expect(whole((floored.value.assessable))).toBe('2910.0000');
  });

  it('applies the Training Levy to the full basic wage with no cap and employer share only', () => {
    const result = computeTrainingLevy({ basicWage: parseAmount('1000000'), rate: '1.5', exempt: false });
    expect(whole((result.value))).toBe('15000.0000');
    expect(computeTrainingLevy({ basicWage: parseAmount('1000000'), rate: '1.5', exempt: true }).value).toBe(0n);
  });

  it('applies Additional Remuneration 2026 by category and effective date', () => {
    const base = {
      effectiveFrom: '2026-01-01', periodEnd: '2026-01-31', monthlyBasicWage: parseAmount('30000'),
      excluded: false, enabled: true, fullTimeAmount: '635', partTimeThreshold: '17110',
      partTimeRate: '3.7', maximum: '635', globalThreshold: '50000',
    };
    expect(computeAdditionalRemuneration({ ...base, workerType: 'full_time' }).value).toBe(parseAmount('635'));
    expect(computeAdditionalRemuneration({ ...base, workerType: 'part_time', monthlyBasicWage: parseAmount('10000') }).value)
      .toBe(parseAmount('370'));
    expect(computeAdditionalRemuneration({ ...base, workerType: 'part_time', monthlyBasicWage: parseAmount('20000') }).value)
      .toBe(parseAmount('635'));
    expect(computeAdditionalRemuneration({ ...base, workerType: 'part_time', monthlyBasicWage: parseAmount('10000'), periodEnd: '2025-12-31' }).value)
      .toBe(0n);
    expect(computeAdditionalRemuneration({ ...base, workerType: 'piece_rate' }).value).toBe(0n);
  });

  it('keeps the end-of-year bonus as 1/12 of earnings without inventing a month of salary', () => {
    const result = computeEndOfYearBonus(parseAmount('120000'));
    expect(whole((result.value))).toBe('10000.0000');
    expect(computeEndOfYearBonus(0n).value).toBe(0n);
  });

  it('rounds strictly down or up at the rupee, with no float arithmetic', () => {
    expect(roundDownRupee(parseAmount('12.9999'))).toBe(parseAmount('12'));
    expect(roundUpRupee(parseAmount('12.0001'))).toBe(parseAmount('13'));
    expect(percentage(parseAmount('33333'), '1.5')).toBe(parseAmount('499.9950'));
  });
});

describe('payroll statutory pipeline and audit gates (API)', () => {
  let ctx: TestContext;
  let owner: TestUser;
  let company: any;
  let period: any;
  let edfEmployee: any;
  let noEdfEmployee: any;
  let missingDobEmployee: any;
  let publicEmployee: any;
  let calculations: any[];

  const employee = (number: string, extra: Record<string, unknown> = {}) => ({
    employeeNumber: number,
    firstName: 'Fictif',
    lastName: `Statutaire${number}`,
    dateOfBirth: '1988-02-29',
    nationality: 'Mauritian',
    countryOfResidence: 'Mauritius',
    address: '1, Rue Fictive, Port Louis (fictif)',
    email: `${number.toLowerCase()}.statutory@example.test`,
    phone: '+230 5000 0099',
    hireDate: '2024-01-15',
    department: 'Test statutaire',
    jobTitle: 'Salarié fictif',
    workLocation: 'Port Louis',
    payrollCurrency: 'MUR',
    paymentMethod: 'bank_transfer',
    bankName: 'Banque Fictive',
    bankAccountNumber: `MU00STAT${number}0000000000`,
    payFrequency: 'monthly',
    workerType: 'full_time',
    payeCategory: 'standard',
    taxResidency: 'resident',
    ...extra,
  });

  const create = async (number: string, extra: Record<string, unknown> = {}) => {
    const res = await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/payroll/employees`, employee(number, extra));
    expect(res.statusCode, res.body).toBe(201);
    const created = res.json().employee;
    const contract = await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/payroll/contracts`, {
      employeeId: created.id,
      contractType: 'permanent',
      workPattern: extra.workerType === 'part_time' ? 'part_time' : 'full_time',
      effectiveFrom: '2024-01-15',
      baseSalary: '40000',
      salaryPeriod: 'monthly',
      currency: 'MUR',
      changeReason: 'Contrat fictif mission 15',
    });
    expect(contract.statusCode, contract.body).toBe(201);
    return created;
  };

  beforeAll(async () => {
    const setup = await setupCompanyWithChart();
    ctx = setup.ctx;
    owner = setup.user;
    company = setup.company;

    edfEmployee = await create('S001');
    noEdfEmployee = await create('S002');
    missingDobEmployee = await create('S003', { dateOfBirth: null });
    publicEmployee = await create('S004', { isPublicSector: true });

    const created = await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/payroll/periods`, {
      year: 2026, month: 3, paymentDate: '2026-03-31',
    });
    expect(created.statusCode, created.body).toBe(201);
    period = created.json().period;
    const moved = await api(ctx, owner.cookie, 'PATCH', `/api/companies/${company.id}/payroll/periods/${period.id}/status`, {
      status: 'data_collection',
    });
    expect(moved.statusCode, moved.body).toBe(200);

    const edf = await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/payroll/edf`, {
      employeeId: edfEmployee.id, taxYearStart: '2025-07-01', declarationDate: '2025-07-01',
      effectiveFrom: '2025-07-01', dependentCount: 1,
      documentRef: 'FICT-EDF-2026', sourceReference: 'Fictional employee declaration',
    });
    expect(edf.statusCode, edf.body).toBe(201);
    expect(edf.json().declaration.total_reliefs).toBe('110000.0000');

    const calculated = await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/payroll/periods/${period.id}/calculate`, {});
    expect(calculated.statusCode, calculated.body).toBe(200);
    calculations = calculated.json().calculations;
  });

  afterAll(async () => { await closeTestApp(ctx); });

  it('calculates PAYE, CSG, NSF and levy from sourced rules but keeps expert review pending', () => {
    const noEdf = calculations.find((c) => c.employee_number === 'S002');
    expect(noEdf.status).toBe('expert_review_pending');
    expect(noEdf.paye_basis).toBe('NO_EDF_FLAT_15');
    expect(noEdf.paye).toBe('6000.0000');
    expect(noEdf.csg_employee).toBe('600.0000');
    expect(noEdf.csg_employer).toBe('1200.0000');
    expect(noEdf.nsf_employee).toBe('285.7000');
    expect(noEdf.nsf_employer).toBe('714.2500');
    expect(noEdf.training_levy).toBe('600.0000');
    expect(noEdf.net_after_statutory).toBe('33114.3000');
    expect(noEdf.net_payable).toBeNull();
    expect(noEdf.statutory_complete).toBe(false);
    expect(noEdf.rules_applied.length).toBeGreaterThanOrEqual(6);
  });

  it('uses the EDF cumulative reliefs and therefore withholds no PAYE at 40,000', () => {
    const edf = calculations.find((c) => c.employee_number === 'S001');
    expect(edf.paye_basis).toBe('EDF_CUMULATIVE');
    expect(edf.paye).toBe('0.0000');
    expect(edf.net_after_statutory).toBe('39114.3000');
    expect(edf.net_payable).toBeNull();
  });

  it('blocks a calculation instead of assuming an age when date of birth is missing', () => {
    const missing = calculations.find((c) => c.employee_number === 'S003');
    expect(missing.status).toBe('rules_incomplete');
    expect(missing.missing_rules.some((r: any) => r.reason === 'DATE_OF_BIRTH_REQUIRED')).toBe(true);
    expect(missing.paye).toBeNull();
  });

  it('blocks public-sector CSG rather than applying private-sector rates', () => {
    const pub = calculations.find((c) => c.employee_number === 'S004');
    expect(pub.status).toBe('rules_incomplete');
    expect(pub.missing_rules.some((r: any) => r.ruleCode === 'CSG_PUBLIC_SECTOR')).toBe(true);
  });

  it('records an EDF amendment by revision and preserves the superseded declaration', async () => {
    const res = await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/payroll/edf`, {
      employeeId: edfEmployee.id, taxYearStart: '2025-07-01', declarationDate: '2025-08-01',
      effectiveFrom: '2025-08-01', dependentCount: 2,
      documentRef: 'FICT-EDF-2026-R2', sourceReference: 'Fictional revised declaration',
    });
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json().declaration.revision).toBe(2);
    expect(res.json().declaration.total_reliefs).toBe('190000.0000');
    const list = await api(ctx, owner.cookie, 'GET', `/api/companies/${company.id}/payroll/edf?employeeId=${edfEmployee.id}`);
    const rows = list.json().declarations;
    expect(rows).toHaveLength(2);
    expect(rows.find((r: any) => r.revision === 1).status).toBe('superseded');
    expect(rows.find((r: any) => r.revision === 2).status).toBe('submitted');
  });

  it('refuses an EDF backdated before the active declaration', async () => {
    const res = await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/payroll/edf`, {
      employeeId: edfEmployee.id, taxYearStart: '2025-07-01', declarationDate: '2025-07-15',
      effectiveFrom: '2025-07-15', dependentCount: 0,
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('PAYROLL_EDF_EFFECTIVE_DATE');
  });

  it('refuses an EDF for a tax year with no verified deduction table', async () => {
    const res = await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/payroll/edf`, {
      employeeId: edfEmployee.id, taxYearStart: '2024-07-01', declarationDate: '2025-07-01',
      effectiveFrom: '2024-07-01', dependentCount: 1,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('PAYROLL_EDF_RULE_NOT_AVAILABLE');
  });

  it('requires a written reviewer note before approving a calculation for test', async () => {
    const target = calculations.find((c) => c.employee_number === 'S002');
    const refused = await api(ctx, owner.cookie, 'POST',
      `/api/companies/${company.id}/payroll/calculations/${target.id}/approve-for-test`,
      { confirm: true, note: 'short' });
    expect(refused.statusCode).toBe(400);
    const approved = await api(ctx, owner.cookie, 'POST',
      `/api/companies/${company.id}/payroll/calculations/${target.id}/approve-for-test`,
      { confirm: true, note: 'Fictional reviewer checked the trace; not a legal approval.' });
    expect(approved.statusCode, approved.body).toBe(200);
    expect(approved.json().calculation.status).toBe('approved_for_test');
    expect(approved.json().calculation.net_payable).toBeNull();
  });

  it('never finalises a period in this mission, even after test approval', async () => {
    for (const status of ['ready_for_review', 'calculated', 'approved']) {
      const res = await api(ctx, owner.cookie, 'PATCH', `/api/companies/${company.id}/payroll/periods/${period.id}/status`, { status });
      if (res.statusCode === 200) continue;
    }
    const res = await api(ctx, owner.cookie, 'PATCH', `/api/companies/${company.id}/payroll/periods/${period.id}/status`, {
      status: 'finalised', confirm: true,
    });
    expect(res.statusCode).toBe(409);
    expect(['PAYROLL_RULES_NOT_VALIDATED', 'PAYROLL_PERIOD_TRANSITION']).toContain(res.json().error.code);
  });

  it('blocks a 2026/27 period instead of silently reusing 2025/26 PAYE rates', async () => {
    const created = await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/payroll/periods`, {
      year: 2026, month: 10, paymentDate: '2026-10-31',
    });
    expect(created.statusCode, created.body).toBe(201);
    const later = created.json().period;
    await api(ctx, owner.cookie, 'PATCH', `/api/companies/${company.id}/payroll/periods/${later.id}/status`, { status: 'data_collection' });
    const res = await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/payroll/periods/${later.id}/calculate`, {});
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().blocked).toBe(true);
    expect(JSON.stringify(res.json().missingRules)).toContain('PAYE');
    expect(res.json().calculations.every((c: any) => c.status === 'rules_incomplete')).toBe(true);
  });

  it('prepares an MRA summary and CSV that are explicitly not submitted', async () => {
    const summary = await api(ctx, owner.cookie, 'GET', `/api/companies/${company.id}/payroll/periods/${period.id}/mra-return`);
    expect(summary.statusCode, summary.body).toBe(200);
    expect(summary.json().submission).toBe('NOT_SUBMITTED');
    expect(summary.json().status).toBe('PREPARATION_ONLY');
    expect(Number(summary.json().paye)).toBeGreaterThan(0);
    const csv = await api(ctx, owner.cookie, 'GET', `/api/companies/${company.id}/payroll/periods/${period.id}/mra-return.csv`);
    expect(csv.statusCode, csv.body).toBe(200);
    expect(csv.body).toContain('PREPARATION ONLY - NOT SUBMITTED TO MRA');
    expect(csv.body).not.toContain('FICT-EDF');
  });

  it('renders a simulation payslip with the statutory values and no payment instruction', async () => {
    const target = calculations.find((c) => c.employee_number === 'S002');
    const payslip = await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/payroll/calculations/${target.id}/payslip`);
    expect(payslip.statusCode, payslip.body).toBe(201);
    const snapshot = payslip.json().payslip.snapshot;
    expect(snapshot.status).toBe('simulation');
    expect(snapshot.totals.paye).toBe('6000.0000');
    expect(snapshot.totals.netPayable).toBeNull();
    expect(snapshot.statutoryStatus).toBe('APPROVED_FOR_TEST');
    expect(snapshot.disclaimer).toContain('NOT FOR PAYMENT');
  });
});
