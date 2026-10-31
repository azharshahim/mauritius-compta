/** Mission 17 — browser demo monthly MRA preparation, entirely fictional. */
import { beforeEach, describe, expect, it } from 'vitest';
import { DEMO_EMAIL, DEMO_PASSWORD, demoCsv, demoRequest, resetDemo } from '../src/demo';

const call = <T>(method: 'GET' | 'POST' | 'PATCH', path: string, body?: unknown) =>
  demoRequest<T>(method, path, body);

function login() {
  call('POST', '/auth/login', { email: DEMO_EMAIL, password: DEMO_PASSWORD });
  const companies = call<{ companies: { id: string; name: string }[] }>('GET', '/companies').companies;
  return {
    companies,
    mds: companies.find((company) => /Mauritius Demo Services/i.test(company.name))!,
    lagon: companies.find((company) => /Lagon Bleu/i.test(company.name))!,
  };
}

describe('démo déclarations MRA — préparation interne', () => {
  beforeEach(() => {
    resetDemo();
    localStorage.clear();
  });

  it('prépare octobre 2026 depuis les calculs et n’offre aucun CSV officiel', () => {
    const { mds } = login();
    const period = call<any>('GET', `/companies/${mds.id}/payroll/periods`).periods[0];
    const preview = call<any>('GET',
      `/companies/${mds.id}/payroll/periods/${period.id}/mra-return?employerIdentifier=DEMO-ERN-0016`);
    expect(preview.employees).toHaveLength(1);
    expect(preview.totals.gross).toBe('30635.0000');
    expect(preview.totals.paye).toBe('0.0000');
    expect(preview.totals.csgEmployee).toBe('459.5250');
    expect(preview.totals.csgEmployer).toBe('919.0500');
    expect(preview.totals.nsfEmployee).toBe('297.1000');
    expect(preview.totals.nsfEmployer).toBe('742.7500');
    expect(preview.totals.trainingLevy).toBe('459.5250');
    expect(preview.blockers).toEqual([]);
    expect(preview.canPrepare).toBe(true);
    expect(preview.status).toBe('PREPARATION_ONLY');
    expect(preview.submission).toBe('NOT_SUBMITTED');
    expect(preview.officialCsv.available).toBe(false);
    expect(preview.officialCsv.reasons.map((reason: any) => reason.code)).toContain('EMPLOYEE_FULL_NIC_MISSING');
    expect(preview.checks.some((check: any) => check.code === 'RULES_NOT_VALIDATED')).toBe(true);
  });

  it('archive des versions et exporte uniquement un fichier interne', () => {
    const { mds } = login();
    const period = call<any>('GET', `/companies/${mds.id}/payroll/periods`).periods[0];
    const first = call<any>('POST',
      `/companies/${mds.id}/payroll/periods/${period.id}/mra-return`,
      { employerIdentifier: 'DEMO-ERN-0016' });
    expect(first.declaration.version).toBe(1);
    expect(first.declaration.status).toBe('PREPARATION_ONLY');
    const second = call<any>('POST',
      `/companies/${mds.id}/payroll/periods/${period.id}/mra-return`,
      { employerIdentifier: 'DEMO-ERN-0016' });
    expect(second.declaration.version).toBe(2);
    const history = call<any>('GET', `/companies/${mds.id}/payroll/declarations?periodId=${period.id}`);
    expect(history.declarations).toHaveLength(2);
    expect(history.declarations[0].version).toBe(2);
    const csv = demoCsv(`/companies/${mds.id}/payroll/declarations/${second.declaration.id}/csv`, 'csv');
    expect(csv.mode).toBe('download');
    expect(csv.text!.startsWith('\uFEFF')).toBe(true);
    expect(csv.text).toContain('PAYROLL DECLARATION - INTERNAL PREPARATION - NOT SUBMITTED TO MRA');
    expect(csv.text).toContain('SIMULATION - NOT VALIDATED FOR PAYMENT');
    expect(csv.text).toContain('30635.0000');
    expect(csv.text).not.toContain('MRA,PACO,V1.0');
    expect(csv.text).toContain('OFFICIAL MRA CSV');
  });

  it('bloque une période contenant des calculs incomplets', () => {
    const { lagon } = login();
    const period = call<any>('GET', `/companies/${lagon.id}/payroll/periods`).periods[0];
    const preview = call<any>('GET',
      `/companies/${lagon.id}/payroll/periods/${period.id}/mra-return?employerIdentifier=DEMO-ERN-0016`);
    expect(preview.blockers.some((check: any) => check.code === 'CALCULATIONS_INCOMPLETE')).toBe(true);
    expect(preview.canPrepare).toBe(false);
    expect(() => call('POST', `/companies/${lagon.id}/payroll/periods/${period.id}/mra-return`,
      { employerIdentifier: 'DEMO-ERN-0016' })).toThrow();
  });

  it('isole les préparations entre sociétés', () => {
    const { mds, lagon } = login();
    const period = call<any>('GET', `/companies/${mds.id}/payroll/periods`).periods[0];
    const prepared = call<any>('POST',
      `/companies/${mds.id}/payroll/periods/${period.id}/mra-return`,
      { employerIdentifier: 'DEMO-ERN-0016' });
    expect(() => call('GET',
      `/companies/${lagon.id}/payroll/declarations/${prepared.declaration.id}`)).toThrow();
    const lagonHistory = call<any>('GET', `/companies/${lagon.id}/payroll/declarations`);
    expect(lagonHistory.declarations).toEqual([]);
  });
});
