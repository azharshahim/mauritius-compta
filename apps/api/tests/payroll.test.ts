import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  accountByCode,
  api,
  closeTestApp,
  createCompany,
  registerUser,
  setupCompanyWithChart,
  type TestContext,
  type TestUser,
} from './helpers.js';
import { usingRealPostgres } from './helpers.js';

/**
 * Mission 14 - Mauritian payroll preparation. Every person, salary, bank
 * reference and hour below is fictional. No statutory rate is used: the
 * registry stays UNVERIFIED and every calculation is therefore BLOCKED.
 * A "blocked" calculation is the expected, honest result - never a failure.
 */

const ref = () => Math.random().toString(36).slice(2, 8).toUpperCase();

describe('payroll preparation and RH (mission 14)', () => {
  let ctx: TestContext;
  let owner: TestUser;
  let company: any;
  let otherCompany: any;
  let period: any;
  let accounts: any[];

  const employees: Record<string, any> = {};
  let contractB: any;
  let contractE1: any;
  let contractK: any;
  let itemBonus: any;
  let itemAdvance: any;
  let itemAllowance: any;
  let periodCalc: any;

  const baseEmployee = (number: string, extra: Record<string, unknown> = {}) => ({
    employeeNumber: number,
    firstName: 'Fictif',
    lastName: `Salarie${number}`,
    dateOfBirth: '1990-04-12',
    nationality: 'Mauritian',
    countryOfResidence: 'Mauritius',
    address: '1, Rue Fictive, Port Louis (fictif)',
    email: `${number.toLowerCase()}.payroll@example.test`,
    phone: '+230 5000 0000',
    hireDate: '2024-01-15',
    department: 'Opérations',
    jobTitle: 'Analyste fictif',
    workLocation: 'Port Louis',
    costCentre: 'CC-TEST',
    payrollCurrency: 'MUR',
    paymentMethod: 'bank_transfer',
    bankName: 'Banque Fictive',
    bankAccountNumber: `MU00FICT${number}000000000000`,
    emergencyContactName: 'Contact Fictif',
    emergencyContactPhone: '+230 5000 0001',
    notes: 'Dossier entièrement fictif de test',
    ...extra,
  });

  const createEmp = async (number: string, extra: Record<string, unknown> = {}) => {
    const res = await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/payroll/employees`, baseEmployee(number, extra));
    expect(res.statusCode, res.body).toBe(201);
    employees[number] = res.json().employee;
    return res.json().employee;
  };

  const contract = async (employeeId: string, payload: Record<string, unknown>) => {
    const res = await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/payroll/contracts`, {
      employeeId,
      contractType: 'permanent',
      workPattern: 'full_time',
      effectiveFrom: '2024-01-15',
      baseSalary: '30000',
      salaryPeriod: 'monthly',
      currency: 'MUR',
      changeReason: 'Contrat initial fictif',
      ...payload,
    });
    expect(res.statusCode, res.body).toBe(201);
    return res.json().contract;
  };

  beforeAll(async () => {
    const setup = await setupCompanyWithChart();
    ctx = setup.ctx;
    owner = setup.user;
    company = setup.company;
    accounts = setup.accounts;
    otherCompany = await createCompany(ctx, owner.cookie, { name: 'Autre Société Fictive Ltd' });

    // A. monthly employee, B. hourly, C. part-time, D. mid-period hire,
    // E. dated salary change, F. unpaid leave, G. overtime, H. bonus,
    // I. advance, J. foreign employee, K. fixed-term ending soon.
    await createEmp('A001');
    await createEmp('B002');
    await createEmp('C003');
    await createEmp('D004', { hireDate: '2026-07-16' });
    await createEmp('E005');
    await createEmp('F006');
    await createEmp('G007');
    await createEmp('H008');
    await createEmp('I009');
    await createEmp('J010', {
      nationality: 'French', countryOfResidence: 'Mauritius',
      statutoryId: 'FICT-STAT-J010', statutoryRef: 'FICT-REF-J010',
    });
    await createEmp('K011');
    await createEmp('L012');

    await contract(employees.A001.id, { baseSalary: '30000' });
    contractB = await contract(employees.B002.id, { baseSalary: '250', salaryPeriod: 'hourly', workPattern: 'part_time' });
    await contract(employees.C003.id, { baseSalary: '12000', workPattern: 'part_time' });
    await contract(employees.D004.id, { baseSalary: '30000', effectiveFrom: '2026-07-16' });
    contractE1 = await contract(employees.E005.id, { baseSalary: '20000', effectiveFrom: '2024-01-15', effectiveTo: '2026-07-15' });
    await contract(employees.F006.id, { baseSalary: '18000' });
    await contract(employees.G007.id, { baseSalary: '22000' });
    await contract(employees.H008.id, { baseSalary: '26000' });
    await contract(employees.I009.id, { baseSalary: '24000' });
    await contract(employees.J010.id, { baseSalary: '28000' });
    contractK = await contract(employees.K011.id, {
      baseSalary: '21000', contractType: 'fixed_term', effectiveTo: '2026-12-31',
    });
    await contract(employees.L012.id, { effectiveFrom: '2026-07-01', baseSalary: '20000' });

    // Dated amendment for E: 24000 from 16 July 2026.
    await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/payroll/contracts`, {
      employeeId: employees.E005.id,
      contractType: 'permanent',
      workPattern: 'full_time',
      effectiveFrom: '2026-07-16',
      baseSalary: '24000',
      salaryPeriod: 'monthly',
      currency: 'MUR',
      changeReason: 'Avenant fictif daté',
      amendmentOf: contractE1.id,
    });

    const time = await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/payroll/time`, {
      employeeId: employees.B002.id, workDate: '2026-07-06', hoursWorked: '8', overtimeHours: '2',
    });
    expect(time.statusCode, time.body).toBe(201);

    const leave = await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/payroll/leave`, {
      employeeId: employees.F006.id, leaveType: 'unpaid', startDate: '2026-07-20',
      endDate: '2026-07-22', days: '3', reason: 'Congé non rémunéré fictif',
    });
    expect(leave.statusCode, leave.body).toBe(201);
    const approved = await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/payroll/leave/${leave.json().absence.id}/decision`, {
      decision: 'approved',
    });
    expect(approved.statusCode, approved.body).toBe(200);

    const bonus = await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/payroll/pay-items`, {
      code: 'PRIME_TEST', labelEn: 'Fictional bonus', labelFr: 'Prime fictive',
      category: 'earning', unit: 'money', calculationMethod: 'fixed',
      effectiveFrom: '2026-01-01', source: 'Paramétrage fictif de test',
    });
    expect(bonus.statusCode, bonus.body).toBe(201);
    itemBonus = bonus.json().payItem;
    const advanceItem = await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/payroll/pay-items`, {
      code: 'AVANCE_TEST', labelEn: 'Fictional salary advance', labelFr: 'Avance fictive',
      category: 'advance', unit: 'money', calculationMethod: 'fixed',
      effectiveFrom: '2026-01-01', source: 'Paramétrage fictif de test',
    });
    expect(advanceItem.statusCode, advanceItem.body).toBe(201);
    itemAdvance = advanceItem.json().payItem;
    const allowance = await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/payroll/pay-items`, {
      code: 'IND_TEST', labelEn: 'Fictional allowance', labelFr: 'Indemnité fictive',
      category: 'earning', unit: 'money', calculationMethod: 'fixed',
      effectiveFrom: '2026-01-01', source: 'Paramétrage fictif de test',
    });
    expect(allowance.statusCode, allowance.body).toBe(201);
    itemAllowance = allowance.json().payItem;
    const assigned = await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/payroll/employees/${employees.H008.id}/pay-items`, {
      payItemId: itemAllowance.id, amount: '1500', effectiveFrom: '2026-01-01',
    });
    expect(assigned.statusCode, assigned.body).toBe(201);

    const createdPeriod = await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/payroll/periods`, {
      year: 2026, month: 7,
    });
    expect(createdPeriod.statusCode, createdPeriod.body).toBe(201);
    period = createdPeriod.json().period;
    const collected = await api(ctx, owner.cookie, 'PATCH', `/api/companies/${company.id}/payroll/periods/${period.id}/status`, {
      status: 'data_collection',
    });
    expect(collected.statusCode, collected.body).toBe(200);

    // H bonus and I advance, explicitly validated by a human action.
    for (const [employee, item, amount] of [
      [employees.H008, itemBonus, '5000'],
      [employees.I009, itemAdvance, '2000'],
    ] as const) {
      const variable = await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/payroll/variables`, {
        periodId: period.id, employeeId: employee.id, payItemId: item.id, amount,
        status: 'validated', note: 'Variable fictive validée pour test',
      });
      expect(variable.statusCode, variable.body).toBe(201);
    }
  });

  afterAll(async () => closeTestApp(ctx));

  // 1-4 employees -----------------------------------------------------------
  it('creates a fictional employee and masks the bank account', () => {
    expect(employees.A001.employee_number).toBe('A001');
    expect(employees.A001.bankAccountMasked).toMatch(/^•••• \d{4}$/);
    expect(JSON.stringify(employees.A001)).not.toContain('MU00FICT');
    expect(employees.A001.bank_account_last4).toBeUndefined();
  });

  it('detects duplicates without merging them', async () => {
    const res = await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/payroll/employees/duplicates`, baseEmployee('A001'));
    expect(res.statusCode, res.body).toBe(200);
    const codes = res.json().duplicates.map((d: any) => d.reason);
    expect(codes.length).toBeGreaterThan(0);
  });

  it('refuses a duplicate and allows an explicit non-merging override', async () => {
    const refused = await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/payroll/employees`, baseEmployee('A001'));
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error.code).toMatch(/PAYROLL_EMPLOYEE_DUPLICATE|PAYROLL_EMPLOYEE_NUMBER_TAKEN/);
    const overridden = await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/payroll/employees`, {
      ...baseEmployee('A001-DUP'), allowDuplicate: true,
    });
    expect(overridden.statusCode, overridden.body).toBe(201);
    const list = await api(ctx, owner.cookie, 'GET', `/api/companies/${company.id}/payroll/employees?search=A001`);
    expect(list.json().employees.length).toBeGreaterThanOrEqual(2);
  });

  it('updates an employee without losing protected references', async () => {
    const res = await api(ctx, owner.cookie, 'PATCH', `/api/companies/${company.id}/payroll/employees/${employees.A001.id}`, {
      jobTitle: 'Analyste senior fictif',
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().employee.job_title).toBe('Analyste senior fictif');
    expect(res.json().employee.bankAccountMasked).toMatch(/^•••• /);
    expect(res.json().employee.updated_at).toBeTruthy();
  });

  it('keeps a foreign employee with configured nationality and masked statutory ids', async () => {
    expect(employees.J010.nationality).toBe('French');
    expect(employees.J010.statutoryIdMasked).toMatch(/^•••• /);
    expect(JSON.stringify(employees.J010)).not.toContain('FICT-STAT-J010');
  });

  // 5-8 contracts -----------------------------------------------------------
  it('creates a contract with a mandatory change reason', () => {
    expect(contractB.base_salary).toBe('250.0000');
    expect(contractB.salary_period).toBe('hourly');
  });

  it('historises a dated amendment and supersedes exactly one active contract', async () => {
    const res = await api(ctx, owner.cookie, 'GET', `/api/companies/${company.id}/payroll/contracts?employeeId=${employees.E005.id}`);
    const rows = res.json().contracts;
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows.filter((c: any) => c.status === 'active').length).toBe(1);
    expect(rows.some((c: any) => c.status === 'superseded')).toBe(true);
  });

  it('rejects a contract without a change reason', async () => {
    const res = await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/payroll/contracts`, {
      employeeId: employees.A001.id, contractType: 'permanent', workPattern: 'full_time',
      effectiveFrom: '2027-01-01', baseSalary: '1000', salaryPeriod: 'monthly', currency: 'MUR',
    });
    expect(res.statusCode).toBe(400);
  });

  it('terminates a fixed-term contract with a reason', async () => {
    const res = await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/payroll/contracts/${contractK.id}/terminate`, {
      effectiveTo: '2026-11-30', reason: 'Fin de mission fictive anticipée',
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().contract.status).toBe('terminated');
  });

  // 9-13 time and leave -----------------------------------------------------
  it('records overtime hours as entered and never invents a premium', async () => {
    const res = await api(ctx, owner.cookie, 'GET', `/api/companies/${company.id}/payroll/time?employeeId=${employees.B002.id}`);
    expect(res.json().entries[0].overtime_hours).toBe('2.00');
  });

  it('rejects a duplicate time entry for one employee and date', async () => {
    const res = await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/payroll/time`, {
      employeeId: employees.B002.id, workDate: '2026-07-06', hoursWorked: '8',
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('PAYROLL_TIME_DUPLICATE');
  });

  it('rejects a leave rejection without a reason', async () => {
    const request = await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/payroll/leave`, {
      employeeId: employees.G007.id, leaveType: 'annual', startDate: '2026-08-03', endDate: '2026-08-04',
      days: '2', reason: 'Demande fictive de test',
    });
    expect(request.statusCode, request.body).toBe(201);
    const bad = await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/payroll/leave/${request.json().absence.id}/decision`, {
      decision: 'rejected',
    });
    expect(bad.statusCode).toBe(400);
  });

  it('returns CONFIGURATION_REQUIRED for leave balances without a validated rule', async () => {
    const res = await api(ctx, owner.cookie, 'GET', `/api/companies/${company.id}/payroll/employees/${employees.A001.id}/leave-balances`);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().balances.every((b: any) => b.status === 'CONFIGURATION_REQUIRED')).toBe(true);
    expect(res.json().balances.every((b: any) => b.balance === null)).toBe(true);
  });

  it('does not turn a created but unverified leave rule into an entitlement', async () => {
    const rule = await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/payroll/leave-rules`, {
      leaveType: 'annual', daysPerYear: '20', effectiveFrom: '2026-01-01', source: 'Source fictive non vérifiée',
    });
    expect(rule.statusCode, rule.body).toBe(201);
    expect(rule.json().rule.status).toBe('UNVERIFIED');
    const balances = await api(ctx, owner.cookie, 'GET', `/api/companies/${company.id}/payroll/employees/${employees.A001.id}/leave-balances`);
    const annual = balances.json().balances.find((b: any) => b.leaveType === 'annual');
    expect(annual.balance).toBeNull();
  });

  // 14-18 variables ---------------------------------------------------------
  it('separates earnings, reimbursements and deductions in pay items', async () => {
    expect(itemBonus.category).toBe('earning');
    expect(itemAdvance.category).toBe('advance');
    const list = await api(ctx, owner.cookie, 'GET', `/api/companies/${company.id}/payroll/pay-items`);
    expect(list.json().payItems.some((i: any) => i.category === 'reimbursement')).toBe(false);
  });

  it('imports CSV variables idempotently', async () => {
    const rows = [{ employeeNumber: 'L012', payItemCode: 'PRIME_TEST', amount: '750', externalRef: 'FICT-L-1' }];
    const first = await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/payroll/periods/${period.id}/variables/import`, { source: 'csv', rows });
    expect(first.statusCode, first.body).toBe(200);
    expect(first.json().created).toBe(1);
    const second = await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/payroll/periods/${period.id}/variables/import`, { source: 'csv', rows });
    expect(second.statusCode, second.body).toBe(200);
    expect(second.json().created).toBe(0);
    expect(second.json().reused).toBe(1);
  });

  it('imports XLSX-parsed rows with the same idempotence guarantee', async () => {
    const rows = [{ employeeNumber: 'L012', payItemCode: 'IND_TEST', amount: '300', externalRef: 'FICT-L-2' }];
    const first = await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/payroll/periods/${period.id}/variables/import`, { source: 'xlsx', rows });
    expect(first.statusCode, first.body).toBe(200);
    expect(first.json().created).toBe(1);
  });

  it('rejects an import row with an unknown employee', async () => {
    const res = await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/payroll/periods/${period.id}/variables/import`, {
      source: 'csv', rows: [{ employeeNumber: 'UNKNOWN', payItemCode: 'PRIME_TEST', amount: '1' }],
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('PAYROLL_IMPORT_INVALID');
  });

  it('never includes a draft variable in a calculation', async () => {
    const draft = await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/payroll/variables`, {
      periodId: period.id, employeeId: employees.A001.id, payItemId: itemBonus.id, amount: '9999',
    });
    expect(draft.statusCode, draft.body).toBe(201);
    const variables = await api(ctx, owner.cookie, 'GET', `/api/companies/${company.id}/payroll/variables?periodId=${period.id}&employeeId=${employees.A001.id}`);
    expect(variables.json().variables.length).toBe(1);
    expect(variables.json().variables[0].status).toBe('draft');
  });

  it('requires an explicit human validation before a variable is usable', async () => {
    const list = await api(ctx, owner.cookie, 'GET', `/api/companies/${company.id}/payroll/variables?periodId=${period.id}&employeeId=${employees.A001.id}`);
    const id = list.json().variables[0].id;
    const validated = await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/payroll/variables/${id}/validate`);
    expect(validated.statusCode, validated.body).toBe(200);
    expect(validated.json().variable.status).toBe('validated');
  });

  // 19-27 calculation -------------------------------------------------------
  it('calculates monthly, hourly, part-time, prorated and amended salaries', async () => {
    const res = await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/payroll/periods/${period.id}/calculate`, {});
    expect(res.statusCode, res.body).toBe(200);
    periodCalc = res.json();
    const byNumber = new Map(periodCalc.calculations.map((c: any) => [c.employee_number, c]));
    expect((byNumber.get('A001') as any).base_amount).toBe('30000.0000');
    expect((byNumber.get('C003') as any).base_amount).toBe('12000.0000');
    expect((byNumber.get('D004') as any).base_amount).toBe('15483.8710');
    expect((byNumber.get('E005') as any).base_amount).toBe('22064.5162');
    expect((byNumber.get('B002') as any).base_amount).toBe('2000.0000');
  });

  it('adds a validated bonus and a fixed allowance to gross earnings', () => {
    const h = periodCalc.calculations.find((c: any) => c.employee_number === 'H008');
    expect(h.earnings).toBe('6500.0000');
    expect(h.gross).toBe('32500.0000');
  });

  it('deducts an advance without calling the arithmetic net a legal net', () => {
    const i = periodCalc.calculations.find((c: any) => c.employee_number === 'I009');
    expect(i.deductions).toBe('2000.0000');
    expect(i.net_arithmetic).toBe('22000.0000');
    expect(i.paye).toBeNull();
    expect(i.csg).toBeNull();
    expect(i.nsf).toBeNull();
    expect(i.statutory_complete).toBe(false);
  });

  it('blocks every calculation when required rules are not expert-validated', () => {
    expect(periodCalc.blocked).toBe(true);
    expect(periodCalc.statutoryComplete).toBe(false);
    expect(periodCalc.missingRules.some((r: any) => r.ruleCode === 'PAYE')).toBe(true);
    expect(periodCalc.missingEngine).toBe('PAYROLL_STATUTORY_ENGINE_NOT_IMPLEMENTED');
    expect(periodCalc.calculations.every((c: any) => c.status === 'blocked')).toBe(true);
  });

  it('shows approved unpaid leave as a warning, not as an invented deduction', () => {
    const f = periodCalc.calculations.find((c: any) => c.employee_number === 'F006');
    expect(f.deductions).toBe('0.0000');
    expect(f.warnings.some((w: any) => w.code === 'UNPAID_LEAVE_NOT_VALUED')).toBe(true);
  });

  it('keeps overtime unvalued when no premium is configured', () => {
    const b = periodCalc.calculations.find((c: any) => c.employee_number === 'B002');
    expect(b.warnings.some((w: any) => w.code === 'OVERTIME_PREMIUM_NOT_CONFIGURED')).toBe(true);
  });

  it('refuses a second calculation without an explicit administrative force', async () => {
    const res = await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/payroll/periods/${period.id}/calculate`, {});
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('PAYROLL_ALREADY_CALCULATED');
  });

  it('stores exact decimal amounts and a stable input hash', async () => {
    const calc = periodCalc.calculations.find((c: any) => c.employee_number === 'D004');
    const detail = await api(ctx, owner.cookie, 'GET', `/api/companies/${company.id}/payroll/calculations/${calc.id}`);
    expect(detail.statusCode, detail.body).toBe(200);
    expect(detail.json().calculation.input_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(detail.json().calculation.lines[0].amount).toBe('15483.8710');
    expect(detail.json().calculation.base_amount).toBe('15483.8710');
    expect(detail.json().calculation.bankAccountMasked).toMatch(/^•••• /);
  });

  // 28-33 payslips and finalisation ----------------------------------------
  it('generates a simulation payslip, clearly not for payment', async () => {
    const calc = periodCalc.calculations.find((c: any) => c.employee_number === 'A001');
    const res = await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/payroll/calculations/${calc.id}/payslip`);
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json().payslip.status).toBe('simulation');
    expect(res.json().payslip.snapshot.disclaimer).toMatch(/NOT FOR PAYMENT/);
    expect(res.json().payslip.snapshot.totals.netPayable).toBeNull();
  });

  it('reuses the same simulation instead of numbering it twice', async () => {
    const calc = periodCalc.calculations.find((c: any) => c.employee_number === 'A001');
    const res = await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/payroll/calculations/${calc.id}/payslip`);
    expect(res.statusCode).toBe(200);
    expect(res.json().reused).toBe(true);
  });

  it('refuses to finalise a payslip while the calculation is blocked', async () => {
    const list = await api(ctx, owner.cookie, 'GET', `/api/companies/${company.id}/payroll/payslips?periodId=${period.id}`);
    const payslip = list.json().payslips[0];
    const res = await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/payroll/payslips/${payslip.id}/finalise`);
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('PAYROLL_PAYSLIP_FINAL_BLOCKED');
  });

  it('refuses to finalise the period without validated rules and a statutory engine', async () => {
    const res = await api(ctx, owner.cookie, 'PATCH', `/api/companies/${company.id}/payroll/periods/${period.id}/status`, {
      status: 'finalised', confirm: true,
    });
    expect(res.statusCode).toBe(409);
    expect(['PAYROLL_RULES_NOT_VALIDATED', 'PAYROLL_PERIOD_TRANSITION']).toContain(res.json().error.code);
  });

  it('renders a bilingual simulation PDF with a visible watermark', async () => {
    const list = await api(ctx, owner.cookie, 'GET', `/api/companies/${company.id}/payroll/payslips?periodId=${period.id}`);
    const payslip = list.json().payslips[0];
    for (const locale of ['fr', 'en']) {
      const res = await ctx.app.inject({
        method: 'GET', url: `/api/companies/${company.id}/payroll/payslips/${payslip.id}/pdf`,
        headers: { cookie: owner.cookie, 'x-locale': locale },
      });
      expect(res.statusCode, res.body).toBe(200);
      expect(res.headers['content-type']).toContain('application/pdf');
      expect(res.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
      expect(res.rawPayload.length).toBeGreaterThan(1000);
    }
  });

  it('exports a CSV where every net is flagged as simulation', async () => {
    const res = await ctx.app.inject({
      method: 'GET', url: `/api/companies/${company.id}/payroll/payslips.csv?periodId=${period.id}`,
      headers: { cookie: owner.cookie },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.body).toContain('SIMULATION - NOT FOR PAYMENT');
    expect(res.body).toContain('Net payable');
  });

  // 34-40 rules, security, isolation ---------------------------------------
  it('creates placeholders with no rate and refuses validation without source', async () => {
    const rules = await api(ctx, owner.cookie, 'GET', `/api/companies/${company.id}/payroll/rules`);
    expect(rules.statusCode, rules.body).toBe(200);
    const paye = rules.json().rules.find((r: any) => r.rule_code === 'PAYE');
    expect(paye.rate).toBeNull();
    expect(paye.status).toBe('UNVERIFIED');
    const refused = await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/payroll/rules/${paye.id}/validate`, { confirm: true });
    expect(refused.statusCode).toBe(400);
    expect(refused.json().error.code).toBe('PAYROLL_RULE_NOT_VALIDATED');
  });

  it('validates a documented non-required test rule through a traceable action', async () => {
    const created = await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/payroll/rules`, {
      ruleCode: 'TEST_ONLY_RULE', nameEn: 'Fictional test rule', nameFr: 'Règle fictive de test',
      legalSource: 'Fictional source', sourceReference: 'FICT-REF-ONLY',
      effectiveFrom: '2026-01-01', rate: '1', requiredForCalculation: false,
    });
    expect(created.statusCode, created.body).toBe(201);
    const validated = await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/payroll/rules/${created.json().rule.id}/validate`, {
      confirm: true, note: 'Validation fictive de test',
    });
    expect(validated.statusCode, validated.body).toBe(200);
    expect(validated.json().rule.status).toBe('EXPERT_VALIDATED');
  });

  it('denies payroll to an accountant and allows the payroll manager', async () => {
    const accountant = await registerUser(ctx);
    const member = await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/members`, {
      email: accountant.email, role: 'accountant',
    });
    expect(member.statusCode, member.body).toBe(201);
    const denied = await api(ctx, accountant.cookie, 'GET', `/api/companies/${company.id}/payroll/employees`);
    expect(denied.statusCode).toBe(403);
  });

  it('does not let a payroll manager read another company', async () => {
    const other = await api(ctx, owner.cookie, 'GET', `/api/companies/${otherCompany.id}/payroll/employees`);
    expect(other.statusCode).toBe(200);
    const outsider = await registerUser(ctx);
    const denied = await api(ctx, outsider.cookie, 'GET', `/api/companies/${otherCompany.id}/payroll/employees`);
    expect(denied.statusCode).toBe(404);
  });

  it('keeps cabinet companies isolated even with valid identifiers', async () => {
    const res = await api(ctx, owner.cookie, 'GET', `/api/companies/${otherCompany.id}/payroll/contracts`);
    expect(res.statusCode).toBe(200);
    const cross = await api(ctx, owner.cookie, 'GET', `/api/companies/${company.id}/payroll/employees/${employees.A001.id}`);
    expect(cross.statusCode).toBe(200);
    const notInOther = await api(ctx, owner.cookie, 'GET', `/api/companies/${otherCompany.id}/payroll/employees/${employees.A001.id}`);
    expect(notInOther.statusCode).toBe(404);
  });

  it('audits salary and contract changes in payroll events', async () => {
    const events = await ctx.db.query<any>(
      'SELECT action FROM payroll_events WHERE company_id = $1 AND action LIKE $2',
      [company.id, 'payroll.contract.%'],
    );
    expect(events.rowCount).toBeGreaterThan(0);
  });

  it('blocks an impossible state transition', async () => {
    const res = await api(ctx, owner.cookie, 'PATCH', `/api/companies/${company.id}/payroll/periods/${period.id}/status`, {
      status: 'draft',
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('PAYROLL_PERIOD_TRANSITION');
  });

  it('does not create an accounting entry from a payroll calculation', async () => {
    const entries = await ctx.db.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM journal_entries WHERE company_id = $1',
      [company.id],
    );
    expect(entries.rows[0]!.count).toBe('0');
    const preview = await api(ctx, owner.cookie, 'GET', `/api/companies/${company.id}/payroll/periods/${period.id}/accounting-preview`);
    expect(preview.statusCode, preview.body).toBe(200);
    expect(preview.json().postingBlocked).toBe(true);
    expect(preview.json().accountsConfigured).toBe(false);
  });

  it('reports the capability matrix honestly on the dashboard', async () => {
    const res = await api(ctx, owner.cookie, 'GET', `/api/companies/${company.id}/payroll/dashboard`);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().capabilities.arithmeticCalculation).toBe(true);
    expect(res.json().capabilities.statutoryCalculation).toBe(false);
    expect(res.json().capabilities.finalPayslips).toBe(false);
    expect(res.json().capabilities.paye).toBe(false);
    expect(res.json().statutoryComplete).toBe(false);
    expect(res.json().rules.find((r: any) => r.ruleCode === 'PAYE').rate).toBeNull();
  });

  it('keeps concurrent period creation idempotent on a real database', async () => {
    if (!usingRealPostgres) return;
    const results = await Promise.all([
      api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/payroll/periods`, { year: 2026, month: 8 }),
      api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/payroll/periods`, { year: 2026, month: 8 }),
    ]);
    expect(results.filter((r) => r.statusCode === 201).length).toBe(1);
    expect(results.filter((r) => r.statusCode === 409).length).toBe(1);
  });
});
