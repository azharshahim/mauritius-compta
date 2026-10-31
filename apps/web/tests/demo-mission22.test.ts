/**
 * Mission 22 — browser demo for inventory, accruals and provisions.
 * Fictitious data only; all figures are produced by the demo engine.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { DEMO_EMAIL, DEMO_PASSWORD, demoCsv, demoRequest, resetDemo } from '../src/demo';

const call = <T>(method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: string, body?: unknown) =>
  demoRequest<T>(method, path, body);

function login() {
  call('POST', '/auth/login', { email: DEMO_EMAIL, password: DEMO_PASSWORD });
  const companies = call<{ companies: { id: string; name: string }[] }>('GET', '/companies').companies;
  const company = companies.find((c) => /Lagon Bleu/i.test(c.name))!;
  const second = companies.find((c) => c.id !== company.id && !/archived/i.test(c.name))!;
  return { company, second, base: `/companies/${company.id}`, baseB: `/companies/${second.id}` };
}

describe('démo mission 22 — stocks, échéanciers et provisions', () => {
  beforeEach(() => { resetDemo(); localStorage.clear(); });

  it('seeds FIFO and weighted-average inventories in two companies and reconciles the ledger', () => {
    const { base, baseB } = login();
    const categories = call<{ categories: any[] }>('GET', `${base}/inventory/categories`).categories;
    expect(categories).toHaveLength(1);
    expect(categories[0].valuationMethod).toBe('fifo');
    const report = call<any>('GET', `${base}/inventory/report?asOf=2026-06-30`);
    expect(report.rows).toHaveLength(1);
    expect(report.totals.quantity).toBe('110.0000');
    expect(report.totals.value).toBe('1080.0000');
    expect(report.rows[0].unitCost).toBe('9.8182');
    expect(call<any>('GET', `${base}/inventory/reconciliation?asOf=2026-06-30`).balanced).toBe(true);

    const categoriesB = call<{ categories: any[] }>('GET', `${baseB}/inventory/categories`).categories;
    expect(categoriesB[0].valuationMethod).toBe('weighted_average');
    const reportB = call<any>('GET', `${baseB}/inventory/report?asOf=2026-06-30`);
    expect(reportB.rows).toHaveLength(1);
    expect(reportB.totals.quantity).toBe('110.0000');
    expect(call<any>('GET', `${baseB}/inventory/reconciliation?asOf=2026-06-30`).balanced).toBe(true);
  });

  it('reports accruals by kind and keeps the schedule reconciliation balanced', () => {
    const { base } = login();
    const schedules = call<{ schedules: any[] }>('GET', `${base}/accruals?from=2025-07-01&to=2026-06-30`).schedules;
    expect(schedules).toHaveLength(3);
    const prepaid = schedules.find((s) => s.kind === 'prepaid_expense')!;
    expect(prepaid.totalAmount).toBe('24000.0000');
    expect(prepaid.lines).toHaveLength(12);
    expect(prepaid.totals.posted).toBe('6000.0000');
    const report = call<any>('GET', `${base}/accruals/report?asOf=2026-06-30`);
    expect(report.byKind.prepaid_expense.posted).toBe('6000.0000');
    expect(report.balanced).toBe(true);
  });

  it('requires a human note before approving and posting a provision movement', () => {
    const { base } = login();
    const accounts = call<{ accounts: any[] }>('GET', `${base}/accounts`).accounts;
    const journals = call<{ journals: any[] }>('GET', `${base}/journals`).journals;
    const created = call<{ provision: any }>('POST', `${base}/provisions`, {
      category: 'litigation', description: 'Litige fictif de démonstration', evidenceRef: 'LIT-DEMO-002',
      recognitionDate: '2025-11-01', measurementBasis: 'Hypothèse fictive à revoir par un professionnel.',
      expenseAccountId: accounts.find((a) => a.code === '6130').id,
      provisionAccountId: accounts.find((a) => a.code === '2100').id,
      currentPortion: '12000', nonCurrentPortion: '0', initialAmount: '12000',
      journalId: journals[0].id, initialReason: 'Reconnaissance fictive documentée.', documentRef: 'LIT-DEMO-002',
    }).provision;
    const movement = created.movements[0];
    expect(movement.status).toBe('PROPOSED');
    expect(() => call('POST', `${base}/provisions/movements/${movement.id}/approve`, { confirm: true, note: 'court' }))
      .toThrow();
    call('POST', `${base}/provisions/movements/${movement.id}/approve`, { confirm: true, note: 'Revue humaine fictive documentée.' });
    call('POST', `${base}/provisions/movements/${movement.id}/post`, {});
    const recon = call<any>('GET', `${base}/provisions/reconciliation?asOf=2026-06-30`);
    expect(recon.balanced).toBe(true);
    const detail = call<{ provision: any }>('GET', `${base}/provisions/${created.id}`).provision;
    expect(detail.totals.carrying).toBe('12000.0000');
  });

  it('exports the valuation as CSV with a fictional-data filename only', () => {
    const { base, company } = login();
    const csv = demoCsv(`${base}/inventory/report.csv?asOf=2026-06-30`, 'csv');
    expect(csv.mode).toBe('download');
    expect(csv.text).toContain('DEMO-FIFO-01');
    expect(csv.text).toContain('110.0000');
    expect(company.name).toContain('DEMO');
  });
});
