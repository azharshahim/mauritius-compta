/**
 * Mission 21 — browser demo for financial years, opening balances, prior-year
 * adjustments, checklists and archives (fictitious data, localStorage only).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { DEMO_EMAIL, DEMO_PASSWORD, demoRequest, resetDemo } from '../src/demo';

const call = <T>(method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown) =>
  demoRequest<T>(method, path, body);

function login() {
  call('POST', '/auth/login', { email: DEMO_EMAIL, password: DEMO_PASSWORD });
  const companies = call<{ companies: { id: string; name: string }[] }>('GET', '/companies').companies;
  const company = companies.find((c) => /Island Trading/i.test(c.name))!;
  const second = companies.find((c) => c.id !== company.id && !/archived/i.test(c.name))!;
  const base = `/companies/${company.id}`;
  const accounts = call<{ accounts: any[] }>('GET', `${base}/accounts`).accounts;
  const journals = call<{ journals: any[] }>('GET', `${base}/journals`).journals;
  return { company, second, base, baseB: `/companies/${second.id}`, accounts, journals };
}
const account = (accounts: any[], code: string) => accounts.find((a) => a.code === code)!;
const journal = (journals: any[], code: string) => journals.find((j) => j.code === code)!;

describe('démo exercices, soldes d’ouverture, ajustements et archives', () => {
  beforeEach(() => {
    resetDemo();
    localStorage.clear();
  });

  it('presents two closed exercises and one open exercise with sealed demo archives', () => {
    const { base } = login();
    const timeline = call<any>('GET', `${base}/financial-years/timeline`);
    expect(timeline.periods).toHaveLength(4);
    expect(timeline.periods.filter((p: any) => p.status === 'closed')).toHaveLength(2);
    expect(timeline.periods.filter((p: any) => p.status === 'open')).toHaveLength(2);
    expect(timeline.periods.filter((p: any) => p.status === 'open' && p.startDate === '2025-07-01')).toHaveLength(1);
    expect(timeline.counts.archives).toBe(2);
    expect(timeline.periods.every((p: any) => p.status === 'open' || p.archives.length >= 1)).toBe(true);

    const archives = call<any>('GET', `${base}/financial-years/archives`).archives;
    expect(archives).toHaveLength(2);
    expect(archives.every((a: any) => a.status === 'SEALED')).toBe(true);
    expect(archives.every((a: any) => /^demo-/.test(a.checksum))).toBe(true);
    expect(archives[0].limitationsEn).toMatch(/not SHA-256/i);
    const verified = call<any>('GET', `${base}/financial-years/archives/${archives[0].id}/verify`).verification;
    expect(verified.ok).toBe(true);
    expect(verified.algorithm).toBe('demo-fingerprint');
    expect(verified.sections.length).toBeGreaterThanOrEqual(10);
  });

  it('carries balances forward without duplicating opening entries', () => {
    const { base } = login();
    const timeline = call<any>('GET', `${base}/financial-years/timeline`);
    const current = timeline.currentPeriod!;
    const first = call<any>('GET', `${base}/financial-years/opening-balances?periodId=${current.id}`);
    expect(current.startDate).toBe('2025-07-01');
    expect(first.method).toBe('continuous_ledger');
    expect(first.balanced).toBe(true);
    expect(first.continuity).toBe(true);
    expect(first.differences).toHaveLength(0);
    expect(first.totals.openingDebit).toBe(first.totals.openingCredit);
    // Mission 22 correction: opening balances are NET balances. The prior
    // demonstration closing zeroed profit or loss, so no residual remains.
    expect(first.profitAndLossOpening).toHaveLength(0);
    expect(first.checks.find((c: any) => c.code === 'NO_PNL_OPENING').severity).toBe('ok');
    expect(first.checks.some((c: any) => c.code === 'PNL_OPENING_PRESENT')).toBe(false);
    expect(first.checks.find((c: any) => c.code === 'OPENING_BALANCED').severity).toBe('ok');
    expect(first.preserved.customerOpenItems).toHaveProperty('count');
    expect(first.preserved.loans.status).toBe('UNAVAILABLE');

    // A later open exercise follows a still-open exercise: net P&L balances
    // are current-year accumulations and must be a warning, never a false block.
    const later = timeline.periods.find((p: any) => p.status === 'open' && p.startDate === '2026-07-01')!;
    const laterOpening = call<any>('GET', `${base}/financial-years/opening-balances?periodId=${later.id}`);
    expect(laterOpening.profitAndLossOpening.length).toBeGreaterThan(0);
    expect(laterOpening.checks.find((c: any) => c.code === 'PNL_OPENING_PENDING_CLOSE').severity).toBe('warning');
    expect(laterOpening.checks.some((c: any) => c.code === 'PNL_OPENING_PRESENT')).toBe(false);
    expect(laterOpening.preserved.fixedAssets.count).toBeGreaterThan(0);

    const before = call<any>('GET', `${base}/entries?limit=500`).entries.length;
    const second = call<any>('GET', `${base}/financial-years/opening-balances?periodId=${current.id}`);
    const after = call<any>('GET', `${base}/entries?limit=500`).entries.length;
    expect(second.totals).toEqual(first.totals);
    expect(after).toBe(before);
  });

  it('requires an explicit approval before posting a prior-year adjustment and never touches the closed period', () => {
    const { base } = login();
    const adjustments = call<{ adjustments: any[] }>('GET', `${base}/financial-years/prior-year-adjustments`).adjustments;
    const proposed = adjustments.find((a) => a.status === 'PROPOSED')!;
    expect(proposed).toBeTruthy();
    expect(adjustments.some((a) => a.status === 'POSTED' && a.entryNo)).toBe(true);
    expect(() => call('POST', `${base}/financial-years/prior-year-adjustments/${proposed.id}/post`)).toThrow(/approuvé/i);
    expect(() => call('POST', `${base}/financial-years/prior-year-adjustments/${proposed.id}/approve`, { confirm: true, note: 'court' }))
      .toThrow();
    const approved = call<any>('POST', `${base}/financial-years/prior-year-adjustments/${proposed.id}/approve`, {
      confirm: true, note: 'Approbation fictive documentée pour le test de démonstration.',
    }).adjustment;
    expect(approved.status).toBe('APPROVED');
    const posted = call<any>('POST', `${base}/financial-years/prior-year-adjustments/${proposed.id}/post`).adjustment;
    expect(posted.status).toBe('POSTED');
    expect(posted.entryNo).toMatch(/^OD-/);
    expect(() => call('POST', `${base}/financial-years/prior-year-adjustments/${proposed.id}/post`)).toThrow();

    const restatement = call<any>('GET', `${base}/financial-years/prior-year-adjustments/${proposed.id}/restatement`).restatement;
    expect(restatement.rows.length).toBeGreaterThan(0);
    expect(restatement.sourcePeriod.status).toBe('closed');

    const open = call<any>('GET', `${base}/financial-years/timeline`).periods.find((p: any) => p.status === 'open')!;
    expect(() => call('POST', `${base}/financial-years/prior-year-adjustments`, {
      sourcePeriodId: open.id, adjustmentDate: '2026-01-10', journalId: journal(login().journals, 'OD').id,
      treatment: 'retained_earnings', originalReference: 'X', reason: 'Motif fictif suffisamment long',
      documentRef: 'JUSTIF-X', lines: [
        { accountId: account(login().accounts, '3100').id, debit: '10.00' },
        { accountId: account(login().accounts, '2100').id, credit: '10.00' },
      ],
    })).toThrow(/clôturée/i);
  });

  it('never reports unavailable or unconfigured checks as passed', () => {
    const { base } = login();
    const open = call<any>('GET', `${base}/financial-years/timeline`).periods.find((p: any) => p.status === 'open')!;
    const checklist = call<any>('GET', `${base}/financial-years/checklist?periodId=${open.id}`);
    const byCode = (code: string) => checklist.items.find((i: any) => i.code === code);
    // Mission 22 delivers these controls in the demo too: none is unavailable,
    // and none is a false green while period lines remain unposted.
    for (const code of ['PROVISIONS', 'INVENTORY', 'ACCRUALS_PREPAYMENTS']) {
      expect(byCode(code).state).not.toBe('unavailable');
    }
    expect(byCode('ACCRUALS_PREPAYMENTS').state).toBe('warning');
    expect(byCode('INVENTORY').state).toBe('ok');
    expect(byCode('PROVISIONS').state).toBe('ok');
    expect(byCode('SUSPENSE_ACCOUNTS').state).toBe('pending');
    expect(byCode('MISSING_SUPPORTING_DOCUMENTS').state).toBe('pending');
    expect(checklist.ready).toBe(false);
    expect(checklist.items.some((i: any) => i.state === 'block')).toBe(false);
    const saved = call<any>('POST', `${base}/financial-years/checklists`, { periodId: open.id }).checklist;
    expect(saved.status).toBe('GENERATED');
    const reviewed = call<any>('POST', `${base}/financial-years/checklists/${saved.id}/review`, {
      confirm: true, note: 'Revue fictive documentée pour le test de démonstration.',
    });
    expect(reviewed.status).toBe('REVIEWED');
    const settings = call<any>('PUT', `${base}/financial-years/settings`, {
      suspenseAccountIds: [account(login().accounts, '1015').id],
      retentionMonths: 84, retentionNote: 'Politique de démonstration, aucune durée légale affirmée.',
    }).settings;
    expect(settings.retention_months).toBe(84);
  });

  it('seals a new archive version, verifies it and keeps companies isolated', () => {
    const { base, baseB } = login();
    const closed = call<any>('GET', `${base}/financial-years/timeline`).periods.find((p: any) => p.status === 'closed')!;
    const created = call<any>('POST', `${base}/financial-years/archives`, { periodId: closed.id, note: 'Archive fictive de test.' }).archive;
    expect(created.version).toBe(2);
    expect(created.status).toBe('SEALED');
    const list = call<any>('GET', `${base}/financial-years/archives?periodId=${closed.id}`).archives;
    expect(list).toHaveLength(2);
    const verification = call<any>('GET', `${base}/financial-years/archives/${created.id}/verify`).verification;
    expect(verification.ok).toBe(true);
    const section = call<any>('GET', `${base}/financial-years/archives/${created.id}/sections/trialBalance`);
    expect(section.section).toBe('trialBalance');
    expect(section.data.rows.length).toBeGreaterThan(0);
    expect(() => call('GET', `${baseB}/financial-years/archives/${created.id}/verify`)).toThrow(/introuvable/i);
    expect(call<{ archives: any[] }>('GET', `${baseB}/financial-years/archives`).archives).toHaveLength(0);

    const open = call<any>('GET', `${base}/financial-years/timeline`).periods.find((p: any) => p.status === 'open')!;
    expect(() => call('POST', `${base}/financial-years/archives`, { periodId: open.id })).toThrow(/clôturé/i);
  });
});
