/** Browser demo payroll engine: arithmetic only, statutory engine blocked. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEMO_EMAIL, DEMO_PASSWORD, demoCsv, demoRequest, resetDemo } from '../src/demo';

const call = <T>(method: 'GET' | 'POST' | 'PATCH', path: string, body?: unknown) =>
  demoRequest<T>(method, path, body);

function companyId(): string {
  return call<{ companies: { id: string }[] }>('GET', '/companies').companies[0]!.id;
}

function loginAndCompany(): string {
  call('POST', '/auth/login', { email: DEMO_EMAIL, password: DEMO_PASSWORD });
  return companyId();
}

describe('démo paie — moteur déterministe bloqué', () => {
  beforeEach(() => {
    resetDemo();
    localStorage.clear();
  });

  it('sert 18 salariés fictifs A→R et masque les coordonnées bancaires', () => {
    const company = loginAndCompany();
    const employees = call<any>('GET', `/companies/${company}/payroll/employees`).employees;
    expect(employees).toHaveLength(18);
    expect(employees.map((e: any) => e.employee_number)).toContain('R018');
    expect(employees.every((e: any) => e.bankAccountMasked?.startsWith('•••• '))).toBe(true);
    expect(JSON.stringify(employees)).not.toContain('MU00FICT');
  });

  it('présente les contrats historisés et l’avenant daté de E005', () => {
    const company = loginAndCompany();
    const contracts = call<any>('GET', `/companies/${company}/payroll/contracts`).contracts;
    expect(contracts.filter((c: any) => c.status === 'superseded')).toHaveLength(1);
    expect(contracts.some((c: any) => c.base_salary === '24000.0000')).toBe(true);
    expect(contracts.some((c: any) => c.contract_type === 'fixed_term')).toBe(true);
  });

  it('calcule l’arithmétique exacte, ajoute la rémunération additionnelle puis les cotisations sourcées', () => {
    const company = loginAndCompany();
    const periods = call<any>('GET', `/companies/${company}/payroll/periods`).periods;
    const calculations = call<any>('GET', `/companies/${company}/payroll/periods/${periods[0].id}/calculations`).calculations;
    const a = calculations.find((c: any) => c.employee_number === 'A001');
    expect(a.base_amount).toBe('30000.0000');
    expect(a.paye).toBe('0.0000');
    expect(a.csg).toBe('459.5250');
    expect(a.nsf).toBe('297.1000');
    expect(a.status).toBe('expert_review_pending');
    expect(a.net_payable).toBeNull();
    const h = calculations.find((c: any) => c.employee_number === 'H008');
    expect(h.gross).toBe('33135.0000');
    const i = calculations.find((c: any) => c.employee_number === 'I009');
    expect(i.net_arithmetic).toBe('22635.0000');
    const d = calculations.find((c: any) => c.employee_number === 'D004');
    expect(d.base_amount).toBe('15483.8710');
    const e = calculations.find((c: any) => c.employee_number === 'E005');
    expect(e.base_amount).toBe('22064.5162');
  });

  it('présente 18 cas A→R, dont secteur public et date de naissance manquante bloqués', () => {
    const company = loginAndCompany();
    const periods = call<any>('GET', `/companies/${company}/payroll/periods`).periods;
    const calculations = call<any>('GET', `/companies/${company}/payroll/periods/${periods[0].id}/calculations`).calculations;
    expect(calculations).toHaveLength(18);
    const publicSector = calculations.find((c: any) => c.employee_number === 'P016');
    expect(publicSector.status).toBe('rules_incomplete');
    expect(publicSector.missing_rules.some((r: any) => r.ruleCode === 'CSG_PUBLIC_SECTOR')).toBe(true);
    const noDob = calculations.find((c: any) => c.employee_number === 'Q017');
    expect(noDob.status).toBe('rules_incomplete');
    expect(noDob.missing_rules.some((r: any) => r.reason === 'DATE_OF_BIRTH_REQUIRED')).toBe(true);
    expect(calculations.find((c: any) => c.employee_number === 'R018').additional_remuneration).toBe('0.0000');
  });

  it('refuse un second calcul sans réouverture, et refuse toute finalisation', () => {
    const company = loginAndCompany();
    const period = call<any>('GET', `/companies/${company}/payroll/periods`).periods[0];
    expect(() => call('POST', `/companies/${company}/payroll/periods/${period.id}/calculate`, {})).toThrow(/déjà calculée/i);
    expect(() => call('PATCH', `/companies/${company}/payroll/periods/${period.id}/status`, { status: 'finalised' })).toThrow(/finalisation impossible/i);
    const payslip = call<any>('GET', `/companies/${company}/payroll/payslips?periodId=${period.id}`).payslips[0];
    expect(() => call('POST', `/companies/${company}/payroll/payslips/${payslip.id}/finalise`)).toThrow(/bloqué/i);
  });

  it('importe des variables de façon idempotente', () => {
    const company = loginAndCompany();
    const periods = call<any>('GET', `/companies/${company}/payroll/periods`).periods;
    const period = periods[0];
    // The seeded period is calculated but imports remain preparation-only.
    const rows = [{ employeeNumber: 'L012', payItemCode: 'PRIME_DEMO', amount: '750', externalRef: 'FICT-IMP-1' }];
    const first = call<any>('POST', `/companies/${company}/payroll/periods/${period.id}/variables/import`, { source: 'csv', rows });
    expect(first.created).toBe(1);
    const second = call<any>('POST', `/companies/${company}/payroll/periods/${period.id}/variables/import`, { source: 'xlsx', rows });
    expect(second.reused).toBe(1);
  });

  it('importe un fichier CSV tabulaire avec les mêmes garanties', () => {
    const company = loginAndCompany();
    const period = call<any>('GET', `/companies/${company}/payroll/periods`).periods[0];
    const contentText = 'employeeNumber;payItemCode;amount;externalRef\nL012;PRIME_DEMO;640;FICT-FILE-1';
    const first = call<any>('POST', `/companies/${company}/payroll/periods/${period.id}/variables/import-file`, {
      fileName: 'variables.csv', contentText,
    });
    expect(first.created).toBe(1);
    const second = call<any>('POST', `/companies/${company}/payroll/periods/${period.id}/variables/import-file`, {
      fileName: 'variables.csv', contentText,
    });
    expect(second.reused).toBe(1);
  });

  it('configure un jour férié sourcé et importe des temps sans doublon', () => {
    const company = loginAndCompany();
    const holiday = call<any>('POST', `/companies/${company}/payroll/holidays`, {
      holidayDate: '2026-08-15', nameEn: 'Fictive holiday', nameFr: 'Jour férié fictif', source: 'Fictif',
    });
    expect(holiday.holiday.holiday_date).toBe('2026-08-15');
    expect(() => call('POST', `/companies/${company}/payroll/holidays`, {
      holidayDate: '2026-08-15', nameEn: 'Doublon', nameFr: 'Doublon', source: 'Fictif',
    })).toThrow(/existe déjà/);
    const contentText = 'employeeNumber;workDate;hoursWorked;overtimeHours\nB002;06/01/2026;8;0\nG007;2026-01-08;7;1';
    const first = call<any>('POST', `/companies/${company}/payroll/time/import-file`, { fileName: 'temps.csv', contentText });
    expect(first).toMatchObject({ created: 1, skipped: 1 });
  });

  it('exporte un CSV de simulation avec net payable vide', () => {
    const company = loginAndCompany();
    const { text, mode } = demoCsv(`/companies/${company}/payroll/payslips.csv`, 'csv');
    expect(mode).toBe('download');
    expect(text).toContain('SIMULATION - NOT FOR PAYMENT');
    expect(text).toContain('"Net payable"');
    expect(text).toContain('"SIM-202601-0001"');
  });

  it('ne demande aucun réseau et ne persiste que dans le navigateur', () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const company = loginAndCompany();
    call('GET', `/companies/${company}/payroll/dashboard`);
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

describe('démo mission 16 — octobre 2026 sur Mauritius Demo Services Ltd', () => {
  beforeEach(() => {
    resetDemo();
    localStorage.clear();
  });

  it('calcule Daniel Morel avec les règles 2026/27 et garde le paiement bloqué', () => {
    call('POST', '/auth/login', { email: DEMO_EMAIL, password: DEMO_PASSWORD });
    const companies = call<{ companies: { id: string; name: string }[] }>('GET', '/companies').companies;
    const company = companies.find((c) => /Mauritius Demo Services/i.test(c.name));
    expect(company).toBeTruthy();
    const periods = call<any>('GET', `/companies/${company!.id}/payroll/periods`).periods;
    expect(periods).toHaveLength(1);
    expect(periods[0]).toMatchObject({ period_year: 2026, period_month: 10 });
    const calculations = call<any>('GET', `/companies/${company!.id}/payroll/periods/${periods[0].id}/calculations`).calculations;
    expect(calculations).toHaveLength(1);
    const daniel = calculations[0];
    expect(daniel.full_name).toBe('Daniel Morel');
    expect(daniel.base_amount).toBe('30000.0000');
    expect(daniel.additional_remuneration).toBe('635.0000');
    expect(daniel.gross).toBe('30635.0000');
    expect(daniel.paye).toBe('0.0000');
    expect(daniel.paye_basis).toBe('EDF_CUMULATIVE');
    expect(daniel.csg_employee).toBe('459.5250');
    expect(daniel.csg_employer).toBe('919.0500');
    expect(daniel.nsf_employee).toBe('297.1000');
    expect(daniel.nsf_employer).toBe('742.7500');
    expect(daniel.training_levy).toBe('459.5250');
    expect(daniel.net_after_statutory).toBe('29878.3750');
    expect(daniel.employer_cost).toBe('32756.3250');
    expect(daniel.net_payable).toBeNull();
    expect(daniel.status).toBe('expert_review_pending');
    expect(daniel.missing_rules).toEqual([]);
    expect(daniel.rules_applied.some((r: any) => r.ruleCode === 'PAYE' && r.effectiveFrom === '2026-07-01')).toBe(true);
  });

  it('génère un bulletin de simulation octobre 2026 sans net payable', () => {
    call('POST', '/auth/login', { email: DEMO_EMAIL, password: DEMO_PASSWORD });
    const companies = call<{ companies: { id: string; name: string }[] }>('GET', '/companies').companies;
    const company = companies.find((c) => /Mauritius Demo Services/i.test(c.name))!;
    const periods = call<any>('GET', `/companies/${company.id}/payroll/periods`).periods;
    const payslips = call<any>('GET', `/companies/${company.id}/payroll/payslips?periodId=${periods[0].id}`).payslips;
    expect(payslips).toHaveLength(1);
    expect(payslips[0].payslip_no).toBe('SIM-202610-0001');
    expect(payslips[0].snapshot.period).toMatchObject({ year: 2026, month: 10, start: '2026-10-01', end: '2026-10-31' });
    expect(payslips[0].snapshot.employee.jobTitle).toContain('Administrative');
    expect(payslips[0].snapshot.totals.netPayable).toBeNull();
    expect(payslips[0].snapshot.disclaimer).toContain('NOT FOR PAYMENT');
  });
});
