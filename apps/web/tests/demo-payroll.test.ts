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

  it('sert 12 salariés fictifs A→L et masque les coordonnées bancaires', () => {
    const company = loginAndCompany();
    const employees = call<any>('GET', `/companies/${company}/payroll/employees`).employees;
    expect(employees).toHaveLength(12);
    expect(employees.map((e: any) => e.employee_number)).toContain('L012');
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

  it('calcule l’arithmétique exacte, ajoute prime et avance, puis bloque les contributions', () => {
    const company = loginAndCompany();
    const periods = call<any>('GET', `/companies/${company}/payroll/periods`).periods;
    const calculations = call<any>('GET', `/companies/${company}/payroll/periods/${periods[0].id}/calculations`).calculations;
    const a = calculations.find((c: any) => c.employee_number === 'A001');
    expect(a.base_amount).toBe('30000.0000');
    expect(a.paye).toBeNull();
    expect(a.csg).toBeNull();
    expect(a.nsf).toBeNull();
    expect(a.status).toBe('blocked');
    const h = calculations.find((c: any) => c.employee_number === 'H008');
    expect(h.gross).toBe('32500.0000');
    const i = calculations.find((c: any) => c.employee_number === 'I009');
    expect(i.net_arithmetic).toBe('22000.0000');
    const d = calculations.find((c: any) => c.employee_number === 'D004');
    expect(d.base_amount).toBe('15483.8710');
    const e = calculations.find((c: any) => c.employee_number === 'E005');
    expect(e.base_amount).toBe('22064.5162');
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
    // The seeded period is blocked but imports remain preparation-only.
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

  it('exporte un CSV de simulation avec net payable vide', () => {
    const company = loginAndCompany();
    const { text, mode } = demoCsv(`/companies/${company}/payroll/payslips.csv`, 'csv');
    expect(mode).toBe('download');
    expect(text).toContain('SIMULATION - NOT FOR PAYMENT');
    expect(text).toContain('"Net payable"');
    expect(text).toContain('"SIM-202607-0001"');
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
