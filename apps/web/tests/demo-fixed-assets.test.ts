/**
 * Mission 20 — browser demo for fixed assets (fictitious data, localStorage).
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
const account = (accounts: any[], code: string) => accounts.find((a) => a.code === code)!;
const journal = (journals: any[], code: string) => journals.find((j) => j.code === code)!;

describe('démo immobilisations et amortissements — simulation navigateur', () => {
  beforeEach(() => {
    resetDemo();
    localStorage.clear();
  });

  it('seeds verifiable fictitious assets in two companies with different methods', () => {
    const { base, baseB } = login();
    const assets = call<{ assets: any[] }>('GET', `${base}/fixed-assets`).assets;
    expect(assets.length).toBeGreaterThanOrEqual(5);
    const vehicle = assets.find((a) => a.description.includes('Pick-up'))!;
    expect(vehicle.cost).toBe('480000.0000');
    expect(vehicle.accumulatedDepreciation).toBe('8000.0000');
    expect(vehicle.netBookValue).toBe('472000.0000');
    const disposed = assets.find((a) => a.status === 'disposed')!;
    expect(disposed.netBookValue).toBe('0.0000');
    const fully = assets.find((a) => a.description.includes('totalement amortie'))!;
    expect(fully.netBookValue).toBe('0.0000');
    const cwip = assets.find((a) => a.status === 'draft' && a.description.includes('construction'))!;
    expect(cwip).toBeTruthy();

    const assetsB = call<{ assets: any[] }>('GET', `${baseB}/fixed-assets`).assets;
    expect(assetsB.length).toBe(2);
    expect(assetsB.some((a) => a.method === 'straight_line')).toBe(true);
    expect(assetsB.some((a) => a.method === 'reducing_balance')).toBe(true);

    const report = call<any>('GET', `${base}/fixed-assets/reports/register?asOf=2026-06-30`);
    expect(report.rows.length).toBeGreaterThanOrEqual(5);
    expect(report.totals.netBookValue).toBe('1125000.0000');
    const reconciliation = call<any>('GET', `${base}/fixed-assets/reports/reconciliation?asOf=2026-06-30`);
    expect(reconciliation.balanced).toBe(true);
    expect(reconciliation.difference).toBe('0.0000');
  });

  it('creates, approves and posts a monthly depreciation batch without duplication', () => {
    const { base } = login();
    const accounts = call<{ accounts: any[] }>('GET', `${base}/accounts`).accounts;
    const journals = call<{ journals: any[] }>('GET', `${base}/journals`).journals;
    const preview = call<any>('GET', `${base}/fixed-assets/depreciation/preview?from=2026-07-01&to=2026-07-31`);
    expect(preview.lines.length).toBe(2);
    expect(preview.totals.debit).toBe(preview.totals.credit);
    expect(preview.blockers).toHaveLength(0);

    const created = call<{ batch: any }>('POST', `${base}/fixed-assets/depreciation/batches`, {
      from: '2026-07-01', to: '2026-07-31', journalId: journal(journals, 'OD').id, reference: 'DEP-TEST-2026-07',
    });
    expect(created.batch.status).toBe('DRAFT');
    const id = created.batch.id;

    expect(() => call('POST', `${base}/fixed-assets/depreciation/batches/${id}/post`)).toThrow();
    call('POST', `${base}/fixed-assets/depreciation/batches/${id}/approve`, {
      confirm: true, note: 'Validation fictive de test pour janvier 2026.',
    });
    const posted = call<{ batch: any }>('POST', `${base}/fixed-assets/depreciation/batches/${id}/post`);
    expect(posted.batch.status).toBe('POSTED');
    expect(posted.batch.entryNo).toBeTruthy();
    expect(() => call('POST', `${base}/fixed-assets/depreciation/batches`, {
      from: '2026-07-01', to: '2026-07-31', journalId: journal(journals, 'OD').id, reference: 'DEP-TEST-2026-07-B',
    })).toThrow();
    expect(account(accounts, '6200')).toBeTruthy();
  });

  it('creates an acquisition proposal that a human must approve and post', () => {
    const { base } = login();
    const accounts = call<{ accounts: any[] }>('GET', `${base}/accounts`).accounts;
    const journals = call<{ journals: any[] }>('GET', `${base}/journals`).journals;
    const categories = call<{ categories: any[] }>('GET', `${base}/fixed-assets/categories`).categories;
    const category = categories[0]!;
    const created = call<{ asset: any }>('POST', `${base}/fixed-assets`, {
      categoryId: category.id, description: 'Équipement fictif de test', acquisitionDate: '2026-02-01',
      cost: '45000.00', currency: 'MUR', exchangeRate: '1',
    });
    const proposal = call<{ proposal: any }>('POST', `${base}/fixed-assets/${created.asset.id}/proposals`, {
      kind: 'acquisition', eventDate: '2026-02-01', reference: 'FA-TEST-ACQ-001',
      journalId: journal(journals, 'OD').id, counterpartyAccountId: account(accounts, '1010').id,
    });
    expect(proposal.proposal.status).toBe('PROPOSED');
    expect(() => call('POST', `${base}/fixed-assets/proposals/${proposal.proposal.id}/post`)).toThrow();
    call('POST', `${base}/fixed-assets/proposals/${proposal.proposal.id}/approve`, {
      confirm: true, note: 'Validation fictive de test sur justificatif fictif.',
    });
    const posted = call<{ proposal: any }>('POST', `${base}/fixed-assets/proposals/${proposal.proposal.id}/post`);
    expect(posted.proposal.status).toBe('POSTED');
    expect(posted.proposal.entryNo).toBeTruthy();
  });

  it('exports the demo register as CSV and refuses PDF simulation as a generated file', () => {
    const { base } = login();
    const csv = demoCsv(`${base}/fixed-assets/reports/register?asOf=2026-06-30`, 'csv');
    expect(csv.mode).toBe('download');
    expect(csv.text).toContain('Asset');
    expect(csv.text).toContain('DEMONSTRATION EXPORT');
    expect(demoCsv(`${base}/fixed-assets/reports/register?asOf=2026-06-30`, 'pdf').mode).toBe('print');
  });
});
