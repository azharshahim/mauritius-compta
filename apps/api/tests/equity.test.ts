import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  accountByCode,
  api,
  closeTestApp,
  createCompany,
  getAccounts,
  journalByCode,
  registerUser,
  setupCompanyWithChart,
  type TestContext,
} from './helpers.js';

/**
 * Mission 19 — equity register, annual closing and result allocation.
 * All data is fictitious. No Mauritian legal, tax or IFRS rule is asserted:
 * every account is taken from the company's own demonstration chart.
 */
describe('equity, annual closing and result allocation', () => {
  let ctx: TestContext;
  let cookie: string;
  let companyId: string;
  let accounts: any[];
  let journals: any[];
  let period: any;
  let closingId: string;

  const acc = (code: string) => accountByCode(accounts, code);
  const journal = (code: string) => journalByCode(journals, code);
  const base = () => `/api/companies/${companyId}/equity`;

  async function postEntry(entryDate: string, lines: any[], description: string, reference: string) {
    const res = await api(ctx, cookie, 'POST', `/api/companies/${companyId}/entries`, {
      journalId: journal('OD').id,
      entryDate,
      reference,
      description,
      status: 'posted',
      lines,
    });
    if (res.statusCode !== 201) throw new Error(`entry failed: ${res.statusCode} ${res.body}`);
    return res.json();
  }

  beforeAll(async () => {
    const setup = await setupCompanyWithChart();
    ctx = setup.ctx;
    cookie = setup.user.cookie;
    companyId = setup.company.id;
    accounts = setup.accounts;
    journals = setup.journals;
    const periods = await api(ctx, cookie, 'GET', `/api/companies/${companyId}/periods`);
    period = periods.json().periods.find((p: any) => p.start_date === '2025-07-01');
  });

  afterAll(async () => {
    await closeTestApp(ctx);
  });

  it('registers, approves and posts an equity movement generated from a supporting document', async () => {
    const created = await api(ctx, cookie, 'POST', `${base()}/movements`, {
      movementDate: '2025-08-05',
      category: 'contribution',
      direction: 'increase',
      amount: '100000.00',
      equityAccountId: acc('3000').id,
      counterpartAccountId: acc('1100').id,
      journalId: journal('OD').id,
      description: 'Apport en capital fictif décidé en assemblée',
      documentRef: 'PV-2025-001',
    });
    expect(created.statusCode).toBe(201);
    const movement = created.json().movement;
    expect(movement.movementNo).toBe('EQ-2025-0001');
    expect(movement.status).toBe('DRAFT');
    expect(movement.amount).toBe('100000.0000');

    const duplicate = await api(ctx, cookie, 'POST', `${base()}/movements`, {
      movementDate: '2025-08-06',
      category: 'capital',
      direction: 'increase',
      amount: '10.00',
      equityAccountId: acc('3000').id,
      counterpartAccountId: acc('1100').id,
      journalId: journal('OD').id,
      description: 'Doublon de justificatif (test)',
      documentRef: 'PV-2025-001',
    });
    expect(duplicate.statusCode).toBe(409);

    const noNote = await api(ctx, cookie, 'POST', `${base()}/movements/${movement.id}/approve`, {
      confirm: true,
      note: 'court',
    });
    expect(noNote.statusCode).toBe(400);
    expect(noNote.json().error.code).toBe('EQUITY_DECISION_REQUIRED');

    const approved = await api(ctx, cookie, 'POST', `${base()}/movements/${movement.id}/approve`, {
      confirm: true,
      note: 'Approuvé sur la base du procès-verbal fictif PV-2025-001.',
    });
    expect(approved.statusCode).toBe(200);
    expect(approved.json().movement.status).toBe('APPROVED');

    const edit = await api(ctx, cookie, 'PATCH', `${base()}/movements/${movement.id}`, {
      movementDate: '2025-08-05',
      category: 'contribution',
      direction: 'increase',
      amount: '999.00',
      equityAccountId: acc('3000').id,
      counterpartAccountId: acc('1100').id,
      journalId: journal('OD').id,
      description: 'Modification interdite après approbation',
      documentRef: 'PV-2025-001',
    });
    expect(edit.statusCode).toBe(409);

    const posted = await api(ctx, cookie, 'POST', `${base()}/movements/${movement.id}/post`);
    expect(posted.statusCode).toBe(200);
    const postedBody = posted.json();
    expect(postedBody.movement.status).toBe('POSTED');
    expect(postedBody.movement.entryNo).toMatch(/^OD-2025-\d{4}$/);
    expect(postedBody.entry.source).toBe('equity');
    expect(postedBody.entry.status).toBe('posted');

    const lines = await ctx.db.query<any>(
      `SELECT a.code, l.debit::text, l.credit::text FROM journal_lines l
        JOIN accounts a ON a.id = l.account_id WHERE l.entry_id = $1 ORDER BY l.line_no`,
      [postedBody.entry.id],
    );
    expect(lines.rows).toHaveLength(2);
    expect(lines.rows.find((l: any) => l.code === '3000').credit).toBe('100000.0000');
    expect(lines.rows.find((l: any) => l.code === '1100').debit).toBe('100000.0000');

    const again = await api(ctx, cookie, 'POST', `${base()}/movements/${movement.id}/post`);
    expect(again.statusCode).toBe(409);
    const stillApproved = await api(ctx, cookie, 'POST', `${base()}/movements/${movement.id}/approve`, {
      confirm: true,
      note: 'Deuxième approbation interdite sur un mouvement comptabilisé.',
    });
    expect(stillApproved.statusCode).toBe(409);
    expect(stillApproved.json().error.code).toBe('EQUITY_MOVEMENT_POSTED_IMMUTABLE');
  });

  it('refuses an account or a company that belongs to another company', async () => {
    const other = await createCompany(ctx, cookie, { name: 'Other Fictitious Ltd' });
    const otherAccounts = await getAccounts(ctx, cookie, other.id);
    const foreign = await api(ctx, cookie, 'POST', `${base()}/movements`, {
      movementDate: '2025-08-07',
      category: 'capital',
      direction: 'increase',
      amount: '500.00',
      equityAccountId: accountByCode(otherAccounts, '3000').id,
      counterpartAccountId: acc('1100').id,
      journalId: journal('OD').id,
      description: 'Compte d’une autre société (test)',
      documentRef: 'PV-X-001',
    });
    expect(foreign.statusCode).toBe(404);
    expect(foreign.json().error.code).toBe('ACCOUNT_NOT_FOUND');

    const outsider = await registerUser(ctx);
    const denied = await api(ctx, outsider.cookie, 'GET', `${base()}/overview`);
    expect(denied.statusCode).toBe(404);
    expect(denied.json().error.code).toBe('COMPANY_NOT_FOUND');
  });

  it('blocks a closing while a draft entry remains in the period', async () => {
    const draft = await api(ctx, cookie, 'POST', `/api/companies/${companyId}/entries`, {
      journalId: journal('OD').id,
      entryDate: '2025-09-01',
      description: 'Brouillon fictif à supprimer avant clôture',
      status: 'draft',
      lines: [
        { accountId: acc('1100').id, debit: '50.00' },
        { accountId: acc('4000').id, credit: '50.00' },
      ],
    });
    expect(draft.statusCode).toBe(201);

    const blocked = await api(ctx, cookie, 'POST', `${base()}/closings`, {
      periodId: period.id,
      journalId: journal('OD').id,
      resultAccountId: acc('3100').id,
    });
    expect(blocked.statusCode).toBe(201);
    expect(blocked.json().closing.status).toBe('BLOCKED');
    expect(blocked.json().closing.blockers.map((b: any) => b.code)).toContain('DRAFT_ENTRIES_PRESENT');

    const approve = await api(ctx, cookie, 'POST', `${base()}/closings/${blocked.json().closing.id}/approve`, {
      confirm: true,
      note: 'Tentative d’approbation alors que des brouillons existent.',
    });
    expect(approve.statusCode).toBe(409);
    expect(approve.json().error.code).toBe('CLOSING_BLOCKED');

    const del = await api(ctx, cookie, 'DELETE', `/api/companies/${companyId}/entries/${draft.json().entry.id}`);
    expect(del.statusCode).toBe(200);
  });

  it('computes an exact closing preview and detects a stale source', async () => {
    await postEntry('2025-10-01', [
      { accountId: acc('1100').id, debit: '50000.00' },
      { accountId: acc('4000').id, credit: '50000.00' },
    ], 'Vente fictive 2025', 'FICT-VENTE-01');
    await postEntry('2025-10-02', [
      { accountId: acc('6100').id, debit: '20000.00' },
      { accountId: acc('1100').id, credit: '20000.00' },
    ], 'Charge fictive 2025', 'FICT-CHARGE-01');

    const preview = await api(ctx, cookie, 'POST', `${base()}/closings`, {
      periodId: period.id,
      journalId: journal('OD').id,
      resultAccountId: acc('3100').id,
    });
    expect(preview.statusCode).toBe(201);
    const closing = preview.json().closing;
    closingId = closing.id;
    expect(closing.status).toBe('REVIEW_REQUIRED');
    expect(closing.blockers).toHaveLength(0);
    expect(closing.resultAmount).toBe('30000.0000');
    expect(closing.nextStartDate).toBe('2026-07-01');
    expect(closing.nextEndDate).toBe('2027-06-30');
    expect(closing.lines.reduce((s: number, l: any) => s + Number(l.debit), 0))
      .toBe(closing.lines.reduce((s: number, l: any) => s + Number(l.credit), 0));

    await postEntry('2025-10-03', [
      { accountId: acc('1100').id, debit: '1000.00' },
      { accountId: acc('4000').id, credit: '1000.00' },
    ], 'Vente fictive ajoutée après préparation', 'FICT-VENTE-02');

    const stale = await api(ctx, cookie, 'POST', `${base()}/closings/${closingId}/approve`, {
      confirm: true,
      note: 'Approbation demandée après modification de la source.',
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.code).toBe('CLOSING_STALE');

    const refreshed = await api(ctx, cookie, 'POST', `${base()}/closings`, {
      periodId: period.id,
      journalId: journal('OD').id,
      resultAccountId: acc('3100').id,
    });
    expect(refreshed.json().closing.id).toBe(closingId);
    expect(refreshed.json().closing.resultAmount).toBe('31000.0000');
  });

  it('posts the closing entry, locks the period and opens the next exercise', async () => {
    const approved = await api(ctx, cookie, 'POST', `${base()}/closings/${closingId}/approve`, {
      confirm: true,
      note: 'Clôture approuvée après contrôle humain des comptes fictifs.',
    });
    expect(approved.statusCode).toBe(200);
    expect(approved.json().closing.status).toBe('APPROVED');

    const posted = await api(ctx, cookie, 'POST', `${base()}/closings/${closingId}/post`);
    expect(posted.statusCode).toBe(200);
    const body = posted.json();
    expect(body.closing.status).toBe('POSTED');
    expect(body.entry.source).toBe('closing');
    expect(body.closing.nextPeriodId).toBeTruthy();

    const periods = (await api(ctx, cookie, 'GET', `/api/companies/${companyId}/periods`)).json().periods;
    const source = periods.find((p: any) => p.id === period.id);
    expect(source.status).toBe('closed');
    const next = periods.find((p: any) => p.id === body.closing.nextPeriodId);
    expect(next.start_date).toBe('2026-07-01');
    expect(next.end_date).toBe('2027-06-30');
    expect(next.status).toBe('open');

    const balances = await ctx.db.query<any>(
      `SELECT a.code, COALESCE(SUM(l.debit - l.credit),0)::text AS net FROM accounts a
         JOIN journal_lines l ON l.account_id = a.id JOIN journal_entries e ON e.id = l.entry_id
        WHERE a.company_id = $1 AND e.status = 'posted' AND a.code IN ('4000','6100')
        GROUP BY a.code ORDER BY a.code`, [companyId]);
    for (const row of balances.rows) expect(Number(row.net)).toBe(0);

    const locked = await api(ctx, cookie, 'POST', `/api/companies/${companyId}/entries`, {
      journalId: journal('OD').id,
      entryDate: '2026-01-15',
      description: 'Écriture fictive après clôture (doit être refusée)',
      status: 'posted',
      lines: [
        { accountId: acc('1100').id, debit: '10.00' },
        { accountId: acc('4000').id, credit: '10.00' },
      ],
    });
    expect(locked.statusCode).toBe(409);
    expect(locked.json().error.code).toBe('PERIOD_CLOSED');

    const repost = await api(ctx, cookie, 'POST', `${base()}/closings/${closingId}/post`);
    expect(repost.statusCode).toBe(409);
    expect(repost.json().error.code).toBe('CLOSING_ALREADY_POSTED');
  });

  it('allocates the result only through a documented decision that sums exactly', async () => {
    const mismatch = await api(ctx, cookie, 'PUT', `${base()}/closings/${closingId}/allocation`, {
      allocationDate: '2026-07-15',
      journalId: journal('OD').id,
      documentRef: 'PV-AFF-2026-001',
      decisionDate: '2026-07-10',
      note: 'Affectation fictive décidée en assemblée générale.',
      lines: [{ nature: 'reserves', accountId: acc('3200').id, amount: '30000.00' }],
    });
    expect(mismatch.statusCode).toBe(400);
    expect(mismatch.json().error.code).toBe('ALLOCATION_AMOUNT_MISMATCH');

    const saved = await api(ctx, cookie, 'PUT', `${base()}/closings/${closingId}/allocation`, {
      allocationDate: '2026-07-15',
      journalId: journal('OD').id,
      documentRef: 'PV-AFF-2026-001',
      decisionDate: '2026-07-10',
      note: 'Affectation fictive décidée en assemblée générale.',
      lines: [{ nature: 'reserves', accountId: acc('3200').id, amount: '31000.00' }],
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().allocation.status).toBe('DRAFT');

    const cannotPost = await api(ctx, cookie, 'POST', `${base()}/closings/${closingId}/allocation/post`);
    expect(cannotPost.statusCode).toBe(409);
    expect(cannotPost.json().error.code).toBe('ALLOCATION_NOT_APPROVED');

    await api(ctx, cookie, 'POST', `${base()}/closings/${closingId}/allocation/approve`, {
      confirm: true,
      note: 'Affectation approuvée sur la base du PV fictif PV-AFF-2026-001.',
    });
    const posted = await api(ctx, cookie, 'POST', `${base()}/closings/${closingId}/allocation/post`);
    expect(posted.statusCode).toBe(200);
    expect(posted.json().allocation.status).toBe('POSTED');
    expect(posted.json().entry.source).toBe('equity_allocation');

    const postAgain = await api(ctx, cookie, 'POST', `${base()}/closings/${closingId}/allocation/post`);
    expect(postAgain.statusCode).toBe(409);
    expect(postAgain.json().error.code).toBe('ALLOCATION_ALREADY_POSTED');
  });

  it('reconciles the equity statement with the trial balance and keeps the history', async () => {
    const statement = await api(ctx, cookie, 'GET', `${base()}/statement?from=2025-07-01&to=2026-08-31`);
    expect(statement.statusCode).toBe(200);
    const body = statement.json();
    expect(body.reconciliation.balanced).toBe(true);
    expect(body.reconciliation.trialBalanceBalanced).toBe(true);
    expect(Number(body.reconciliation.difference)).toBe(0);
    expect(body.closedThrough).toBe('2026-06-30');
    for (const row of body.rows) expect(Number(row.difference)).toBe(0);

    const capital = body.rows.find((r: any) => r.code === '3000');
    const reserves = body.rows.find((r: any) => r.code === '3200');
    expect(Number(capital.closing)).toBe(100000);
    expect(Number(reserves.closing)).toBe(31000);
    expect(Number(body.totals.closing)).toBe(131000);
    expect(body.note).toMatch(/No dividend/i);

    const trial = await api(ctx, cookie, 'GET', `/api/companies/${companyId}/reports/trial-balance?from=2025-07-01&to=2026-08-31`);
    expect(trial.statusCode).toBe(200);
    expect(trial.json().balanced).toBe(true);

    const movements = await api(ctx, cookie, 'GET', `${base()}/movements`);
    expect(movements.json().movements).toHaveLength(1);
    const entryId = movements.json().movements[0].entryId;
    const entry = await api(ctx, cookie, 'GET', `/api/companies/${companyId}/entries/${entryId}`);
    expect(entry.statusCode).toBe(200);
    expect(entry.json().lines).toHaveLength(2);

    const closings = await api(ctx, cookie, 'GET', `${base()}/closings`);
    expect(closings.json().closings[0].status).toBe('POSTED');
  });
});
