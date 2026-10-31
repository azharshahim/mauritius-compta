import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  accountByCode, api, closeTestApp, createCompany, getAccounts, getJournals, journalByCode,
  setupCompanyWithChart, type TestContext,
} from './helpers.js';

/**
 * Mission 21 — financial years, opening balances, prior-year adjustments,
 * year-end checklist and immutable archives. All data is fictitious.
 */
describe('financial years, carry-forward, adjustments and archives', () => {
  let ctx: TestContext;
  let cookie: string;
  let companyA: string;
  let companyB: string;
  let accounts: any[];
  let journals: any[];
  let periodA: any;
  let nextPeriod: any;
  let adjustmentId: string;
  let archiveId: string;

  const acc = (code: string, list = accounts) => accountByCode(list, code);
  const journal = (code: string, list = journals) => journalByCode(list, code);
  const base = (company = companyA) => `/api/companies/${company}/financial-years`;

  async function postEntry(company: string, entryDate: string, lines: any[], description: string, reference: string) {
    const res = await api(ctx, cookie, 'POST', `/api/companies/${company}/entries`, {
      journalId: journal('OD').id, entryDate, reference, description, status: 'posted', lines,
    });
    if (res.statusCode !== 201) throw new Error(`entry failed: ${res.statusCode} ${res.body}`);
    return res.json();
  }

  async function closePeriod(company: string, period: any, resultAccountCode = '3100') {
    const prepared = await api(ctx, cookie, 'POST', `/api/companies/${company}/equity/closings`, {
      periodId: period.id, journalId: journal('OD').id, resultAccountId: acc(resultAccountCode).id,
    });
    expect(prepared.statusCode).toBe(201);
    const closing = prepared.json().closing;
    expect(closing.blockers).toHaveLength(0);
    const approved = await api(ctx, cookie, 'POST', `/api/companies/${company}/equity/closings/${closing.id}/approve`, {
      confirm: true, note: 'Fictitious closing approved for the mission 21 test.',
    });
    expect(approved.statusCode).toBe(200);
    const posted = await api(ctx, cookie, 'POST', `/api/companies/${company}/equity/closings/${closing.id}/post`);
    expect(posted.statusCode).toBe(200);
    return posted.json();
  }

  beforeAll(async () => {
    const setup = await setupCompanyWithChart();
    ctx = setup.ctx;
    cookie = setup.user.cookie;
    companyA = setup.company.id;
    accounts = setup.accounts;
    journals = setup.journals;
    periodA = (await api(ctx, cookie, 'GET', `/api/companies/${companyA}/periods`)).json().periods
      .find((p: any) => p.start_date === '2025-07-01');

    await postEntry(companyA, '2025-10-01', [
      { accountId: acc('1100').id, debit: '50000.00' },
      { accountId: acc('4000').id, credit: '50000.00' },
    ], 'Fictitious sale 2025/2026', 'FY21-SALE-001');
    await postEntry(companyA, '2025-10-02', [
      { accountId: acc('6100').id, debit: '20000.00' },
      { accountId: acc('1100').id, credit: '20000.00' },
    ], 'Fictitious expense 2025/2026', 'FY21-EXP-001');
    await closePeriod(companyA, periodA);
    nextPeriod = (await api(ctx, cookie, 'GET', `/api/companies/${companyA}/periods`)).json().periods
      .find((p: any) => p.start_date === '2026-07-01');
    expect(nextPeriod).toBeTruthy();

    const other = await createCompany(ctx, cookie, { name: 'Second Financial Year Test Ltd (fictitious)' });
    companyB = other.id;
  });

  afterAll(async () => {
    await closeTestApp(ctx);
  });

  it('shows a balanced, continuous carry-forward with no duplicate opening entry', async () => {
    const timeline = await api(ctx, cookie, 'GET', `${base()}/timeline`);
    expect(timeline.statusCode).toBe(200);
    expect(timeline.json().periods.length).toBeGreaterThanOrEqual(2);
    expect(timeline.json().currentPeriod.startDate).toBe('2026-07-01');

    const opening = await api(ctx, cookie, 'GET', `${base()}/opening-balances?periodId=${nextPeriod.id}`);
    expect(opening.statusCode).toBe(200);
    const body = opening.json();
    expect(body.method).toBe('continuous_ledger');
    expect(body.previousPeriod.id).toBe(periodA.id);
    expect(body.balanced).toBe(true);
    expect(body.continuity).toBe(true);
    expect(body.differences).toHaveLength(0);
    expect(body.profitAndLossOpening).toHaveLength(0);
    expect(body.totals.openingDebit).toBe(body.totals.openingCredit);
    expect(body.totals.openingDebit).toBe('30000.0000');
    expect(body.preserved.loans.status).toBe('UNAVAILABLE');

    const refused = await api(ctx, cookie, 'POST', `${base()}/opening-balances/batches`, {
      periodId: nextPeriod.id, reference: 'OPEN-2026', sourceReference: 'External trial balance (fictitious)',
      journalId: journal('OD').id,
      lines: [
        { accountId: acc('1100').id, debit: '1000.00' },
        { accountId: acc('3000').id, credit: '1000.00' },
      ],
    });
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error.code).toBe('OPENING_ENTRIES_ALREADY_EXIST');
  });

  it('imports a balanced external opening batch only for an initial period', async () => {
    const third = await createCompany(ctx, cookie, { name: 'Initial Opening Test Ltd (fictitious)' });
    const accounts3 = await getAccounts(ctx, cookie, third.id);
    const journals3 = await getJournals(ctx, cookie, third.id);
    const period3 = (await api(ctx, cookie, 'GET', `/api/companies/${third.id}/periods`)).json().periods[0];

    const pnl = await api(ctx, cookie, 'POST', `${base(third.id)}/opening-balances/preview`, {
      periodId: period3.id,
      lines: [
        { accountId: acc('6100', accounts3).id, debit: '100.00' },
        { accountId: acc('3000', accounts3).id, credit: '100.00' },
      ],
    });
    expect(pnl.statusCode).toBe(200);
    expect(pnl.json().externalPreview.blocks.some((b: any) => b.code === 'OPENING_PROFIT_LOSS_ACCOUNT')).toBe(true);

    const created = await api(ctx, cookie, 'POST', `${base(third.id)}/opening-balances/batches`, {
      periodId: period3.id, reference: 'EXT-OPEN-001', sourceReference: 'Fictitious external opening balance',
      journalId: journal('OD', journals3).id,
      lines: [
        { accountId: acc('1100', accounts3).id, debit: '25000.00' },
        { accountId: acc('3000', accounts3).id, credit: '25000.00' },
      ],
    });
    expect(created.statusCode).toBe(201);
    const batch = created.json().batch;
    expect(batch.status).toBe('DRAFT');
    expect(batch.totalDebit).toBe('25000.0000');
    expect(batch.sourceReference).toContain('Fictitious');

    const duplicate = await api(ctx, cookie, 'POST', `${base(third.id)}/opening-balances/batches`, {
      periodId: period3.id, reference: 'EXT-OPEN-002', sourceReference: 'Duplicate fictitious opening',
      journalId: journal('OD', journals3).id,
      lines: [
        { accountId: acc('1100', accounts3).id, debit: '1.00' },
        { accountId: acc('3000', accounts3).id, credit: '1.00' },
      ],
    });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().error.code).toBe('OPENING_BATCH_EXISTS');

    const beforeApproval = await api(ctx, cookie, 'POST', `${base(third.id)}/opening-balances/batches/${batch.id}/post`);
    expect(beforeApproval.statusCode).toBe(409);
    const approved = await api(ctx, cookie, 'POST', `${base(third.id)}/opening-balances/batches/${batch.id}/approve`, {
      confirm: true, note: 'Fictitious approval of the external opening balance.',
    });
    expect(approved.statusCode).toBe(200);
    const posted = await api(ctx, cookie, 'POST', `${base(third.id)}/opening-balances/batches/${batch.id}/post`);
    expect(posted.statusCode).toBe(200);
    expect(posted.json().batch.status).toBe('POSTED');
    expect(posted.json().batch.entryNo).toBeTruthy();
    expect(posted.json().entry.source).toBe('opening');

    const view = await api(ctx, cookie, 'GET', `${base(third.id)}/opening-balances?periodId=${period3.id}`);
    expect(view.json().externalBatch.status).toBe('POSTED');
    const immutable = await api(ctx, cookie, 'POST', `${base(third.id)}/opening-balances/batches/${batch.id}/post`);
    expect(immutable.statusCode).toBe(409);
  });

  it('records and posts a prior-year adjustment without reopening the closed period', async () => {
    const created = await api(ctx, cookie, 'POST', `${base()}/prior-year-adjustments`, {
      sourcePeriodId: periodA.id,
      adjustmentDate: '2026-08-15',
      journalId: journal('OD').id,
      treatment: 'retained_earnings',
      originalReference: 'FY21-EXP-001',
      reason: 'Fictitious correction of an expense recorded in the closed year.',
      documentRef: 'DOC-PYA-001',
      restatesComparatives: true,
      comparativeNote: 'Fictitious comparative note proposed for professional review.',
      lines: [
        { accountId: acc('3100').id, debit: '1000.00' },
        { accountId: acc('1100').id, credit: '1000.00' },
      ],
    });
    expect(created.statusCode).toBe(201);
    const adjustment = created.json().adjustment;
    adjustmentId = adjustment.id;
    expect(adjustment.adjustmentNo).toMatch(/^PYA-2026-/);
    expect(adjustment.status).toBe('PROPOSED');
    expect(adjustment.treatment).toBe('retained_earnings');
    expect(adjustment.balanced).toBe(true);

    const early = await api(ctx, cookie, 'POST', `${base()}/prior-year-adjustments/${adjustmentId}/post`);
   
    expect(early.statusCode).toBe(409);
    const notClosed = await api(ctx, cookie, 'POST', `${base()}/prior-year-adjustments`, {
      sourcePeriodId: nextPeriod.id,
      adjustmentDate: '2026-09-01',
      journalId: journal('OD').id,
      treatment: 'custom',
      originalReference: 'ANY',
      reason: 'Fictitious invalid source period for the test.',
      documentRef: 'DOC-PYA-002',
      lines: [
        { accountId: acc('1100').id, debit: '10.00' },
        { accountId: acc('3000').id, credit: '10.00' },
      ],
    });
    expect(notClosed.statusCode).toBe(409);
    expect(notClosed.json().error.code).toBe('ADJUSTMENT_SOURCE_NOT_CLOSED');

    const approved = await api(ctx, cookie, 'POST', `${base()}/prior-year-adjustments/${adjustmentId}/approve`, {
      confirm: true, note: 'Fictitious approval on a fictitious supporting document.',
    });
    expect(approved.statusCode).toBe(200);
    const posted = await api(ctx, cookie, 'POST', `${base()}/prior-year-adjustments/${adjustmentId}/post`);
    expect(posted.statusCode).toBe(200);
    expect(posted.json().adjustment.status).toBe('POSTED');
    expect(posted.json().entry.source).toBe('prior_year_adjustment');

    const again = await api(ctx, cookie, 'POST', `${base()}/prior-year-adjustments/${adjustmentId}/post`);
    expect(again.statusCode).toBe(409);

    const periods = await api(ctx, cookie, 'GET', `/api/companies/${companyA}/periods`);
    expect(periods.json().periods.find((p: any) => p.id === periodA.id).status).toBe('closed');
    const closedAttempt = await api(ctx, cookie, 'POST', `/api/companies/${companyA}/entries`, {
      journalId: journal('OD').id, entryDate: '2026-06-15', reference: 'SHOULD-FAIL',
      description: 'Fictitious attempt to write in a closed period', status: 'posted',
      lines: [{ accountId: acc('1100').id, debit: '1.00' }, { accountId: acc('3000').id, credit: '1.00' }],
    });
    expect(closedAttempt.statusCode).toBe(409);
    expect(closedAttempt.json().error.code).toBe('PERIOD_CLOSED');

    const restatement = await api(ctx, cookie, 'GET', `${base()}/prior-year-adjustments/${adjustmentId}/restatement`);
    expect(restatement.statusCode).toBe(200);
    expect(restatement.json().restatement.sourcePeriod.status).toBe('closed');
    expect(restatement.json().restatement.originalResult).toBe('30000.0000');
  });

  it('seals an immutable archive with checksums and isolates it by company', async () => {
    const openArchive = await api(ctx, cookie, 'POST', `${base()}/archives`, { periodId: nextPeriod.id });
    expect(openArchive.statusCode).toBe(409);
    expect(openArchive.json().error.code).toBe('ARCHIVE_PERIOD_NOT_CLOSED');

    const created = await api(ctx, cookie, 'POST', `${base()}/archives`, {
      periodId: periodA.id, note: 'Fictitious annual archive for the mission 21 test.',
    });
    expect(created.statusCode).toBe(201);
    const archive = created.json().archive;
    archiveId = archive.id;
    expect(archive.version).toBe(1);
    expect(archive.status).toBe('SEALED');
    expect(archive.checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(archive.sectionNames).toContain('trialBalance');
    expect(archive.sectionNames).toContain('fixedAssets');
    expect(archive.sectionNames).toContain('adjustments');
    expect(archive.sectionNames).toContain('supportingDocuments');

    const verified = await api(ctx, cookie, 'GET', `${base()}/archives/${archiveId}/verify`);
    expect(verified.statusCode).toBe(200);
    expect(verified.json().verification.ok).toBe(true);
    expect(verified.json().verification.overallOk).toBe(true);

    const section = await api(ctx, cookie, 'GET', `${base()}/archives/${archiveId}/sections/trialBalance`);
    expect(section.statusCode).toBe(200);
    expect(section.json().data.rows.length).toBeGreaterThan(0);

    const download = await api(ctx, cookie, 'GET', `${base()}/archives/${archiveId}/download?format=zip`);
    expect(download.statusCode).toBe(200);
    expect(download.headers['content-type']).toContain('zip');

    const isolation = await api(ctx, cookie, 'GET', `${base(companyB)}/archives/${archiveId}`);
    expect(isolation.statusCode).toBe(404);

    await expect(ctx.db.query(`UPDATE fiscal_archives SET note = 'tampered' WHERE id = $1`, [archiveId]))
      .rejects.toThrow(/immutable/i);
    const stillValid = await api(ctx, cookie, 'GET', `${base()}/archives/${archiveId}/verify`);
    expect(stillValid.json().verification.ok).toBe(true);

    const second = await api(ctx, cookie, 'POST', `${base()}/archives`, { periodId: periodA.id, note: 'Fictitious second sealed version.' });
    expect(second.statusCode).toBe(201);
    expect(second.json().archive.version).toBe(2);
  });

  it('generates a reusable checklist and never passes an unavailable module', async () => {
    const preview = await api(ctx, cookie, 'GET', `${base()}/checklist?periodId=${periodA.id}`);
    expect(preview.statusCode).toBe(200);
    const items = preview.json().items;
    // Mission 22 delivers real controls for these three modules: an empty
    // register is "pending", never "unavailable", and never a false green.
    for (const code of ['ACCRUALS_PREPAYMENTS', 'PROVISIONS', 'INVENTORY']) {
      expect(items.find((i: any) => i.code === code).state).not.toBe('unavailable');
    }
    expect(items.find((i: any) => i.code === 'SUSPENSE_ACCOUNTS').state).toBe('pending');
    expect(items.find((i: any) => i.code === 'TRIAL_BALANCE_INTEGRITY').state).toBe('ok');
    expect(preview.json().counts.unavailable).toBe(0);

    const settings = await api(ctx, cookie, 'PUT', `${base()}/settings`, {
      suspenseAccountIds: [acc('1100').id], retentionMonths: 60,
      retentionNote: 'Fictitious retention policy to be validated by the professional reviewer.',
      documentBackupNote: 'Fictitious document-storage backup note.',
    });
    expect(settings.statusCode).toBe(200);
    expect(settings.json().settings.retention_months).toBe(60);

    const saved = await api(ctx, cookie, 'POST', `${base()}/checklists`, { periodId: periodA.id });
    expect(saved.statusCode).toBe(201);
    const checklist = saved.json().checklist;
    expect(checklist.version).toBe(1);
    expect(checklist.items.find((i: any) => i.code === 'SUSPENSE_ACCOUNTS').state).not.toBe('pending');

    const reviewed = await api(ctx, cookie, 'POST', `${base()}/checklists/${checklist.id}/review`, {
      confirm: true, note: 'Fictitious review note for the mission 21 checklist.',
    });
    expect(reviewed.statusCode).toBe(200);
    expect(reviewed.json().checklist.status).toBe('REVIEWED');

    const isolation = await api(ctx, cookie, 'GET', `${base(companyB)}/checklists/${checklist.id}`);
    expect(isolation.statusCode).toBe(404);
  });
});
