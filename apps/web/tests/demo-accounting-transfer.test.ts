/** Mission 18 — browser demo payroll → accounting transfer, entirely fictional. */
import { beforeEach, describe, expect, it } from 'vitest';
import { DEMO_EMAIL, DEMO_PASSWORD, demoCsv, demoRequest, resetDemo } from '../src/demo';

const call = <T>(method: 'GET' | 'POST' | 'PUT' | 'PATCH', path: string, body?: unknown) =>
  demoRequest<T>(method, path, body);

function login() {
  call('POST', '/auth/login', { email: DEMO_EMAIL, password: DEMO_PASSWORD });
  const companies = call<{ companies: { id: string; name: string }[] }>('GET', '/companies').companies;
  const mds = companies.find((company) => /Mauritius Demo Services/i.test(company.name))!;
  const lagon = companies.find((company) => /Island Trading/i.test(company.name))!;
  const period = call<any>('GET', `/companies/${mds.id}/payroll/periods`).periods
    .find((p: any) => p.period_year === 2026 && p.period_month === 10);
  return { companies, mds, lagon, period };
}

const generate = (companyId: string, periodId: string) =>
  call<any>('POST', `/companies/${companyId}/payroll/periods/${periodId}/accounting-transfer`, {
    note: 'Préparation de test fictive',
  }).transfer;

describe('démo transfert paie → comptabilité — simulation', () => {
  beforeEach(() => {
    resetDemo();
    localStorage.clear();
  });

  it('présente les correspondances fictives de la société et le journal OD', () => {
    const { mds } = login();
    const config = call<any>('GET', `/companies/${mds.id}/payroll/accounting/mapping`);
    expect(config.mapping.status).toBe('VALIDATED');
    expect(config.mapping.version).toBe(1);
    expect(config.mapping.accounts.wagesExpense.code).toBe('6020');
    expect(config.mapping.accounts.netPayable.code).toBe('2210');
    expect(config.mapping.accounts.payePayable.code).toBe('2220');
    expect(config.mapping.accounts.csgEmployeePayable.code).toBe('2230');
    expect(config.mapping.journal.code).toBe('OD');
    expect(config.requiredFields.filter((field: any) => field.required)).toHaveLength(11);
    expect(config.notice).toMatch(/Aucun numéro de compte obligatoire/);
  });

  it('génère une proposition équilibrée avec les montants d’octobre 2026', () => {
    const { mds, period } = login();
    const preview = call<any>('GET', `/companies/${mds.id}/payroll/periods/${period.id}/accounting-transfer`);
    expect(preview.period.label).toBe('10/2026');
    expect(preview.employees).toBe(1);
    expect(preview.currency).toBe('MUR');
    expect(preview.totals.gross).toBe('30635.0000');
    expect(preview.totals.employeeStatutoryDeductions).toBe('756.6250');
    expect(preview.totals.employerContributions).toBe('2121.3250');
    expect(preview.totals.netAfterStatutory).toBe('29878.3750');
    expect(preview.totals.employerCost).toBe('32756.3250');
    expect(preview.totals.debitTotal).toBe('32756.3250');
    expect(preview.totals.creditTotal).toBe('32756.3250');
    expect(preview.totals.difference).toBe('0.0000');
    expect(preview.lines).toHaveLength(10);
    expect(preview.checks.some((check: any) => check.code === 'ENTRY_BALANCED')).toBe(true);
    expect(preview.canApprove).toBe(true);
    expect(preview.canPost).toBe(false);
    expect(preview.postingChecks.every((check: any) => check.severity === 'block')).toBe(true);
    expect(preview.regulatoryStatus).toBe('SIMULATION_ONLY');

    const transfer = generate(mds.id, period.id);
    expect(transfer.status).toBe('REVIEW_REQUIRED');
    expect(transfer.version).toBe(1);
    expect(transfer.mappingVersion).toBe(1);
    expect(transfer.calculationIds).toHaveLength(1);
    expect(transfer.sourceFingerprint).toMatch(/^[0-9a-f]{16}$/);
    const history = call<any>('GET', `/companies/${mds.id}/payroll/accounting-transfers?periodId=${period.id}`);
    expect(history.transfers).toHaveLength(1);
    expect(history.transfers[0].id).toBe(transfer.id);
  });

  it('approuve uniquement pour test, sans créer d’écriture, puis bloque la comptabilisation', () => {
    const { mds, period } = login();
    const transfer = generate(mds.id, period.id);
    const before = call<any>('GET', `/companies/${mds.id}/entries`).entries.length;
    const approved = call<any>('POST', `/companies/${mds.id}/payroll/accounting-transfers/${transfer.id}/approve`, {
      confirm: true,
      note: 'Approbation pour test fictive, aucune écriture attendue.',
    }).transfer;
    expect(approved.status).toBe('APPROVED_FOR_TEST');
    expect(approved.decidedByName).toBeTruthy();
    expect(approved.postedEntryId).toBeNull();
    const after = call<any>('GET', `/companies/${mds.id}/entries`).entries.length;
    expect(after).toBe(before);
    expect(() => call('POST', `/companies/${mds.id}/payroll/accounting-transfers/${transfer.id}/post`, {}))
      .toThrowError(/Comptabilisation définitive bloquée/);
    expect(call<any>('GET', `/companies/${mds.id}/payroll/accounting-transfers/${transfer.id}`).transfer.status)
      .toBe('APPROVED_FOR_TEST');
  });

  it('rejette avec motif puis permet une nouvelle version', () => {
    const { mds, period } = login();
    const first = generate(mds.id, period.id);
    expect(() => call('POST', `/companies/${mds.id}/payroll/accounting-transfers/${first.id}/reject`, { reason: 'court' }))
      .toThrowError(/Motif de rejet/);
    const rejected = call<any>('POST', `/companies/${mds.id}/payroll/accounting-transfers/${first.id}/reject`, {
      reason: 'Correspondances fictives à revoir avant toute utilisation.',
    }).transfer;
    expect(rejected.status).toBe('REJECTED');
    expect(rejected.rejectionReason).toMatch(/Correspondances/);
    expect(() => call('POST', `/companies/${mds.id}/payroll/accounting-transfers/${first.id}/approve`, {
      confirm: true, note: 'Tentative après rejet.',
    })).toThrowError(/rejeté/);
    const second = generate(mds.id, period.id);
    expect(second.version).toBe(2);
    expect(second.status).toBe('REVIEW_REQUIRED');
  });

  it('refuse un jeu de calculs déjà approuvé et une proposition devenue obsolète', () => {
    const { mds, period } = login();
    const first = generate(mds.id, period.id);
    call('POST', `/companies/${mds.id}/payroll/accounting-transfers/${first.id}/approve`, {
      confirm: true, note: 'Première approbation de test fictive.',
    });
    const duplicate = generate(mds.id, period.id);
    expect(() => call('POST', `/companies/${mds.id}/payroll/accounting-transfers/${duplicate.id}/approve`, {
      confirm: true, note: 'Doublon de la même empreinte.',
    })).toThrowError(/déjà approuvé/);

    const stale = generate(mds.id, period.id);
    call('POST', `/companies/${mds.id}/payroll/periods/${period.id}/calculate`, { force: true });
    expect(() => call('POST', `/companies/${mds.id}/payroll/accounting-transfers/${stale.id}/approve`, {
      confirm: true, note: 'Approbation après recalcul des montants.',
    })).toThrowError(/changé/);
  });

  it('versionne les correspondances et rejette un compte hors société ou inactif', () => {
    const { mds, lagon } = login();
    const config = call<any>('GET', `/companies/${mds.id}/payroll/accounting/mapping`);
    const foreignAccount = call<any>('GET', `/companies/${lagon.id}/accounts`).accounts[0];
    expect(() => call('PUT', `/companies/${mds.id}/payroll/accounting/mapping`, {
      confirm: true,
      journalId: config.mapping.journalId,
      wagesExpenseAccountId: config.mapping.accounts.wagesExpense.id,
      employerCsgExpenseAccountId: config.mapping.accounts.employerCsgExpense.id,
      employerNsfExpenseAccountId: config.mapping.accounts.employerNsfExpense.id,
      trainingLevyExpenseAccountId: config.mapping.accounts.trainingLevyExpense.id,
      payePayableAccountId: config.mapping.accounts.payePayable.id,
      csgEmployeePayableAccountId: config.mapping.accounts.csgEmployeePayable.id,
      csgEmployerPayableAccountId: config.mapping.accounts.csgEmployerPayable.id,
      nsfEmployeePayableAccountId: config.mapping.accounts.nsfEmployeePayable.id,
      nsfEmployerPayableAccountId: config.mapping.accounts.nsfEmployerPayable.id,
      trainingLevyPayableAccountId: config.mapping.accounts.trainingLevyPayable.id,
      netPayableAccountId: foreignAccount.id,
    })).toThrowError(/appartient/);
    const payload = {
      confirm: true,
      journalId: config.mapping.journalId,
      wagesExpenseAccountId: config.mapping.accounts.wagesExpense.id,
      employerCsgExpenseAccountId: config.mapping.accounts.employerCsgExpense.id,
      employerNsfExpenseAccountId: config.mapping.accounts.employerNsfExpense.id,
      trainingLevyExpenseAccountId: config.mapping.accounts.trainingLevyExpense.id,
      payePayableAccountId: config.mapping.accounts.payePayable.id,
      csgEmployeePayableAccountId: config.mapping.accounts.csgEmployeePayable.id,
      csgEmployerPayableAccountId: config.mapping.accounts.csgEmployerPayable.id,
      nsfEmployeePayableAccountId: config.mapping.accounts.nsfEmployeePayable.id,
      nsfEmployerPayableAccountId: config.mapping.accounts.nsfEmployerPayable.id,
      trainingLevyPayableAccountId: config.mapping.accounts.trainingLevyPayable.id,
      netPayableAccountId: config.mapping.accounts.netPayable.id,
      otherDeductionsPayableAccountId: config.mapping.accounts.otherDeductionsPayable.id,
      reimbursementsAccountId: config.mapping.accounts.reimbursements.id,
      note: 'Version 2 des correspondances fictives.',
    };
    expect(() => call('PUT', `/companies/${mds.id}/payroll/accounting/mapping`, { ...payload, confirm: false }))
      .toThrowError(/Confirmation explicite/);
    const saved = call<any>('PUT', `/companies/${mds.id}/payroll/accounting/mapping`, payload).mapping;
    expect(saved.version).toBe(2);
    expect(saved.status).toBe('VALIDATED');
    const after = call<any>('GET', `/companies/${mds.id}/payroll/accounting/mapping`);
    expect(after.mappingHistory).toHaveLength(2);
    expect(after.mappingHistory.filter((m: any) => m.status === 'SUPERSEDED')).toHaveLength(1);
  });

  it('exporte un CSV interne sans écriture et isole les sociétés', () => {
    const { mds, lagon, period } = login();
    const transfer = generate(mds.id, period.id);
    const csv = demoCsv(`/companies/${mds.id}/payroll/accounting-transfers/${transfer.id}/csv`, 'csv');
    expect(csv.mode).toBe('download');
    const text = csv.text!;
    expect(text.startsWith('\uFEFF')).toBe(true);
    expect(text).toContain('INTERNAL SIMULATION');
    expect(text).toContain('NO JOURNAL ENTRY IS CREATED BY THIS FILE');
    expect(text).toContain(transfer.sourceFingerprint);
    expect(text).toContain(transfer.calculationIds[0]);
    expect(text).toContain('30635.0000');
    expect(text).not.toContain('PACO');
    expect(() => call('GET', `/companies/${lagon.id}/payroll/accounting-transfers/${transfer.id}`))
      .toThrowError(/introuvable/);
    const lagonTransfers = call<any>('GET', `/companies/${lagon.id}/payroll/accounting-transfers`);
    expect(lagonTransfers.transfers).toHaveLength(0);
  });
});
