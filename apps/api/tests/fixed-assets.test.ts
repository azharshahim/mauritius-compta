import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  accountByCode, api, closeTestApp, createCompany, getAccounts, getJournals, journalByCode,
  setupCompanyWithChart, type TestContext,
} from './helpers.js';

/**
 * Mission 20 — fixed assets, depreciation batches and asset proposals.
 * Everything is fictitious. Category accounts come from the demonstration
 * chart; no statutory rate, life or account number is asserted.
 */
describe('fixed assets and depreciation', () => {
  let ctx: TestContext;
  let cookie: string;
  let companyA: string;
  let companyB: string;
  let accounts: any[];
  let journals: any[];
  let journalsB: any[];
  let categoryId: string;
  let categoryB: string;
  let vehicle: any;
  let computer: any;
  let machine: any;

  const base = (company = companyA) => `/api/companies/${company}/fixed-assets`;
  const acc = (code: string) => accountByCode(accounts, code);
  const journal = (code: string) => journalByCode(journals, code);

  async function createAccount(code: string, name: string, type: string) {
    const res = await api(ctx, cookie, 'POST', `/api/companies/${companyA}/accounts`, { code, name, type });
    expect(res.statusCode).toBe(201);
    return res.json().account;
  }

  async function createCategory(company: string, code: string, overrides: Record<string, unknown> = {}) {
    const res = await api(ctx, cookie, 'POST', `${base(company)}/categories`, {
      code,
      nameEn: `Test category ${code}`,
      nameFr: `Catégorie de test ${code}`,
      assetAccountId: acc('1500').id,
      accumulatedDepreciationAccountId: acc('1510').id,
      depreciationExpenseAccountId: acc('6200').id,
      accumulatedImpairmentAccountId: acc('1530').id,
      impairmentLossAccountId: acc('6290').id,
      impairmentReversalAccountId: acc('4100').id,
      disposalGainAccountId: acc('4100').id,
      disposalLossAccountId: acc('6290').id,
      cwipAccountId: acc('1520').id,
      ...overrides,
    });
    expect(res.statusCode).toBe(201);
    return res.json().category;
  }

  async function createAsset(company: string, category: string, payload: Record<string, unknown>) {
    const res = await api(ctx, cookie, 'POST', `${base(company)}/assets`.replace('/assets', ''), {
      categoryId: category,
      description: 'Fictitious asset for the mission 20 test',
      currency: 'MUR',
      exchangeRate: '1',
      ...payload,
    });
    expect(res.statusCode).toBe(201);
    return res.json().asset;
  }

  async function proposal(assetId: string, payload: Record<string, unknown>) {
    return api(ctx, cookie, 'POST', `${base()}/${assetId}/proposals`, {
      journalId: journal('OD').id,
      description: 'Fictitious asset proposal for the test',
      ...payload,
    });
  }

  async function approveAndPostProposal(id: string) {
    const approved = await api(ctx, cookie, 'POST', `${base()}/proposals/${id}/approve`, {
      confirm: true, note: 'Approved on fictitious supporting documents for the test.',
    });
    expect(approved.statusCode).toBe(200);
    const posted = await api(ctx, cookie, 'POST', `${base()}/proposals/${id}/post`);
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

    await createAccount('1520', 'Assets under construction (test)', 'asset');
    await createAccount('1530', 'Accumulated impairment (test)', 'asset');
    await createAccount('6290', 'Impairment and disposal loss (test)', 'expense');
    accounts = await getAccounts(ctx, cookie, companyA);

    categoryId = (await createCategory(companyA, 'VEH')).id;

    const other = await createCompany(ctx, cookie, { name: 'Second Test Company Ltd (fictitious)' });
    companyB = other.id;
    const accountsB = await getAccounts(ctx, cookie, companyB);
    journalsB = await getJournals(ctx, cookie, companyB);
    // Second company has its own chart and its own category/accounts.
    const res = await api(ctx, cookie, 'POST', `${base(companyB)}/categories`, {
      code: 'VEH',
      nameEn: 'Vehicles (second company)',
      nameFr: 'Véhicules (seconde société)',
      assetAccountId: accountsB.find((a) => a.code === '1500').id,
      accumulatedDepreciationAccountId: accountsB.find((a) => a.code === '1510').id,
      depreciationExpenseAccountId: accountsB.find((a) => a.code === '6200').id,
    });
    expect(res.statusCode).toBe(201);
    categoryB = res.json().category.id;

    vehicle = await createAsset(companyA, categoryId, {
      description: 'Fictitious delivery vehicle', acquisitionDate: '2025-07-15', cost: '12000.00',
      supplierName: 'Fictitious Motors Ltd', invoiceRef: 'INV-FICT-001', documentRef: 'DOC-FICT-001',
      location: 'Port Louis (fictitious)',
    });
    computer = await createAsset(companyA, categoryId, {
      description: 'Fictitious laptop', acquisitionDate: '2025-07-20', cost: '10000.00',
    });
    machine = await createAsset(companyA, categoryId, {
      description: 'Fictitious machine sold before the end of its life', acquisitionDate: '2025-07-25',
      cost: '5000.00',
    });
  });

  afterAll(async () => {
    await closeTestApp(ctx);
  });

  it('registers an asset with a generated code and keeps the estimate history', async () => {
    expect(vehicle.assetCode).toMatch(/^FA-2025-\d{4}$/);
    expect(vehicle.status).toBe('draft');
    const activated = await api(ctx, cookie, 'POST', `${base()}/${vehicle.id}/activate`, {
      inServiceDate: '2025-08-01', method: 'straight_line', usefulLifeMonths: 12,
      residualValue: '0', reason: 'Fictitious commissioning',
    });
    expect(activated.statusCode).toBe(200);
    expect(activated.json().asset.status).toBe('in_service');
    const detail = await api(ctx, cookie, 'GET', `${base()}/${vehicle.id}`);
    expect(detail.json().estimates.length).toBeGreaterThanOrEqual(1);
    expect(detail.json().asset.depreciationEndDate).toBe('2026-07-31');
  });

  it('creates an acquisition proposal, requires approval, and posts a balanced entry', async () => {
    const created = await proposal(vehicle.id, {
      kind: 'acquisition', eventDate: '2025-07-15', reference: 'FA-ACQ-001',
      counterpartyAccountId: acc('1100').id,
    });
    if (created.statusCode !== 201) console.log('ACQ FAIL', created.body);
    expect(created.statusCode).toBe(201);
    const body = created.json().proposal;
    expect(body.status).toBe('PROPOSED');
    const debit = body.lines.reduce((sum: bigint, line: any) => sum + BigInt(line.debit.replace('.', '')), 0n);
    const credit = body.lines.reduce((sum: bigint, line: any) => sum + BigInt(line.credit.replace('.', '')), 0n);
    expect(debit).toBe(credit);

    const beforeApproval = await api(ctx, cookie, 'POST', `${base()}/proposals/${body.id}/post`);
    expect(beforeApproval.statusCode).toBe(409);
    expect(beforeApproval.json().error.code).toBe('FIXED_ASSET_PROPOSAL_NOT_APPROVED');

    const posted = await approveAndPostProposal(body.id);
    expect(posted.proposal.status).toBe('POSTED');
    expect(posted.entry.status).toBe('posted');

    for (const [asset, reference, date] of [
      [computer, 'FA-ACQ-002', '2025-07-20'],
      [machine, 'FA-ACQ-003', '2025-07-25'],
    ] as const) {
      const other = await proposal(asset.id, {
        kind: 'acquisition', eventDate: date, reference, counterpartyAccountId: acc('1100').id,
      });
      expect(other.statusCode).toBe(201);
      await approveAndPostProposal(other.json().proposal.id);
    }

    const duplicate = await proposal(vehicle.id, {
      kind: 'acquisition', eventDate: '2025-07-16', reference: 'FA-ACQ-001',
      counterpartyAccountId: acc('1100').id,
    });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().error.code).toBe('FIXED_ASSET_PROPOSAL_REFERENCE_TAKEN');
  });

  it('computes a straight-line schedule with prorata and no depreciation before the in-service date', async () => {
    const before = await api(ctx, cookie, 'GET', `${base()}/depreciation/preview?from=2025-07-01&to=2025-07-31`);
    expect(before.statusCode).toBe(200);
    expect(before.json().lines).toHaveLength(0);

    const schedule = await api(ctx, cookie, 'GET', `${base()}/${vehicle.id}/schedule?from=2025-08-01&to=2026-07-31`);
    expect(schedule.statusCode).toBe(200);
    const lines = schedule.json().lines;
    expect(lines).toHaveLength(12);
    expect(lines[0].amount).toBe('1000.0000');
    expect(lines.at(-1).amount).toBe('1000.0000');
    expect(lines.at(-1).closingNbv).toBe('0.0000');
  });

  it('prepares, approves and posts a monthly depreciation batch exactly once', async () => {
    const preview = await api(ctx, cookie, 'GET', `${base()}/depreciation/preview?from=2025-08-01&to=2025-08-31`);
    expect(preview.statusCode).toBe(200);
    expect(preview.json().lines).toHaveLength(1);
    expect(preview.json().lines[0].amount).toBe('1000.0000');
    expect(preview.json().totals.debit).toBe('1000.0000');

    const created = await api(ctx, cookie, 'POST', `${base()}/depreciation/batches`, {
      from: '2025-08-01', to: '2025-08-31', journalId: journal('OD').id, reference: 'DEP-2025-08',
    });
    expect(created.statusCode).toBe(201);
    const batch = created.json().batch;
    expect(batch.status).toBe('DRAFT');
    expect(batch.lines[0].amount).toBe('1000.0000');

    const notApproved = await api(ctx, cookie, 'POST', `${base()}/depreciation/batches/${batch.id}/post`);
    expect(notApproved.statusCode).toBe(409);

    const approved = await api(ctx, cookie, 'POST', `${base()}/depreciation/batches/${batch.id}/approve`, {
      confirm: true, note: 'Approved against the fictitious August depreciation calculation.',
    });
    expect(approved.statusCode).toBe(200);
    const posted = await api(ctx, cookie, 'POST', `${base()}/depreciation/batches/${batch.id}/post`);
    expect(posted.statusCode).toBe(200);
    expect(posted.json().batch.status).toBe('POSTED');
    expect(posted.json().entry.status).toBe('posted');

    const again = await api(ctx, cookie, 'POST', `${base()}/depreciation/batches`, {
      from: '2025-08-01', to: '2025-08-31', journalId: journal('OD').id, reference: 'DEP-2025-08-B',
    });
    expect(again.statusCode).toBe(409);

    const after = await api(ctx, cookie, 'GET', `${base()}/depreciation/preview?from=2025-08-01&to=2025-08-31`);
    expect(after.json().blockers.map((b: any) => b.code)).toContain('DEPRECIATION_ALREADY_POSTED');

    const asset = await api(ctx, cookie, 'GET', `${base()}/${vehicle.id}`);
    expect(asset.json().asset.accumulatedDepreciation).toBe('1000.0000');
    expect(asset.json().asset.netBookValue).toBe('11000.0000');
  });

  it('rejects a period that is not a whole month', async () => {
    const res = await api(ctx, cookie, 'GET', `${base()}/depreciation/preview?from=2025-09-02&to=2025-09-30`);
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('DEPRECIATION_PERIOD_INVALID');
  });

  it('records an impairment and a justified reversal without exceeding the NBV', async () => {
    await api(ctx, cookie, 'POST', `${base()}/${computer.id}/activate`, {
      inServiceDate: '2025-08-01', method: 'straight_line', usefulLifeMonths: 36,
    });
    const tooBig = await proposal(computer.id, {
      kind: 'impairment', eventDate: '2025-09-30', reference: 'FA-IMP-TOO-BIG',
      impairmentAmount: '20000.00', impairmentReason: 'Fictitious impairment above net book value',
    });
    expect(tooBig.statusCode).toBe(400);

    const impairment = await proposal(computer.id, {
      kind: 'impairment', eventDate: '2025-09-30', reference: 'FA-IMP-001',
      impairmentAmount: '2000.00', impairmentReason: 'Fictitious obsolescence documented by the test',
    });
    expect(impairment.statusCode).toBe(201);
    expect(impairment.json().proposal.lines).toHaveLength(2);
    await approveAndPostProposal(impairment.json().proposal.id);

    const asset = await api(ctx, cookie, 'GET', `${base()}/${computer.id}`);
    expect(asset.json().asset.accumulatedImpairment).toBe('2000.0000');
    expect(asset.json().impairments[0].status).toBe('POSTED');

    const reversal = await proposal(computer.id, {
      kind: 'impairment_reversal', eventDate: '2025-10-31', reference: 'FA-IMP-REV-001',
      impairmentAmount: '500.00', impairmentReason: 'Fictitious partial reversal documented by the test',
    });
    expect(reversal.statusCode).toBe(201);
    await approveAndPostProposal(reversal.json().proposal.id);
    const after = await api(ctx, cookie, 'GET', `${base()}/${computer.id}`);
    expect(after.json().asset.accumulatedImpairment).toBe('1500.0000');
  });

  it('disposes an asset with a computed gain or loss and a zero NBV afterwards', async () => {
    await api(ctx, cookie, 'POST', `${base()}/${machine.id}/activate`, {
      inServiceDate: '2025-08-01', method: 'straight_line', usefulLifeMonths: 60,
    });
    const batch = await api(ctx, cookie, 'POST', `${base()}/depreciation/batches`, {
      from: '2025-08-01', to: '2025-11-30', journalId: journal('OD').id, reference: 'DEP-MACHINE-2025',
      assetIds: [machine.id],
    });
    expect(batch.statusCode).toBe(201);
    await api(ctx, cookie, 'POST', `${base()}/depreciation/batches/${batch.json().batch.id}/approve`, {
      confirm: true, note: 'Approved against the fictitious four-month calculation.',
    });
    const posted = await api(ctx, cookie, 'POST', `${base()}/depreciation/batches/${batch.json().batch.id}/post`);
    expect(posted.statusCode).toBe(200);

    const disposal = await proposal(machine.id, {
      kind: 'disposal', eventDate: '2025-12-15', reference: 'FA-DIS-001',
      proceedsAmount: '4000.00', proceedsAccountId: acc('1100').id,
    });
    expect(disposal.statusCode).toBe(201);
    const lines = disposal.json().proposal.lines;
    const totalDebit = lines.reduce((sum: bigint, line: any) => sum + BigInt(line.debit.replace('.', '')), 0n);
    const totalCredit = lines.reduce((sum: bigint, line: any) => sum + BigInt(line.credit.replace('.', '')), 0n);
    expect(totalDebit).toBe(totalCredit);
    expect(disposal.json().proposal.payload.gain).toBe('-666.6668');

    await approveAndPostProposal(disposal.json().proposal.id);
    const detail = await api(ctx, cookie, 'GET', `${base()}/${machine.id}`);
    expect(detail.json().asset.status).toBe('disposed');
    expect(detail.json().asset.netBookValue).toBe('0.0000');

    const again = await proposal(machine.id, {
      kind: 'disposal', eventDate: '2025-12-16', reference: 'FA-DIS-002', proceedsAccountId: acc('1100').id,
    });
    expect(again.statusCode).toBe(400);
    expect(again.json().error.code).toBe('FIXED_ASSET_ALREADY_DISPOSED');
  });

  it('keeps companies isolated and refuses a closed accounting period', async () => {
    const listB = await api(ctx, cookie, 'GET', `${base(companyB)}`);
    expect(listB.statusCode).toBe(200);
    expect(listB.json().assets).toHaveLength(0);

    const cross = await api(ctx, cookie, 'GET', `${base(companyB)}/${vehicle.id}`);
    if (cross.statusCode !== 404) console.log('CROSS FAIL', cross.body);
    expect(cross.statusCode).toBe(404);

    const assetB = await createAsset(companyB, categoryB, {
      description: 'Fictitious second-company asset', acquisitionDate: '2025-09-01', cost: '1000.00',
    });
    const crossProposal = await api(ctx, cookie, 'POST', `${base(companyB)}/${assetB.id}/proposals`, {
      kind: 'acquisition', eventDate: '2025-09-01', reference: 'FA-B-001', journalId: journalByCode(journalsB, 'OD').id,
      counterpartyAccountId: accounts.find((a) => a.code === '1100').id,
    });
    expect(crossProposal.statusCode).toBe(400);
    expect(crossProposal.json().error.code).toBe('FIXED_ASSET_ACCOUNT_INVALID');

    const pending = await proposal(computer.id, {
      kind: 'reclassification', eventDate: '2025-10-31', reference: 'FA-RECL-001',
      fromAccountId: acc('1500').id, toAccountId: acc('1600').id, reclassAmount: '1.00',
    });
    expect(pending.statusCode).toBe(201);
    await api(ctx, cookie, 'POST', `${base()}/proposals/${pending.json().proposal.id}/approve`, {
      confirm: true, note: 'Approved for the closed-period test only.',
    });
    const period = await ctx.db.query(
      `SELECT id FROM accounting_periods WHERE company_id = $1 AND start_date <= $2 AND end_date >= $2 AND status = 'open'`,
      [companyA, '2025-10-31'],
    );
    await ctx.db.query(`UPDATE accounting_periods SET status='closed' WHERE id = $1`, [(period.rows[0] as { id: string }).id]);
    const closed = await api(ctx, cookie, 'POST', `${base()}/proposals/${pending.json().proposal.id}/post`);
    expect(closed.statusCode).toBe(409);
    expect(closed.json().error.code).toBe('PERIOD_CLOSED');
    await ctx.db.query(`UPDATE accounting_periods SET status='open' WHERE id = $1`, [(period.rows[0] as { id: string }).id]);
  });

  it('reports the register, the reconciliation and downloadable CSV/PDF', async () => {
    const register = await api(ctx, cookie, 'GET', `${base()}/reports/register?asOf=2026-06-30`);
    expect(register.statusCode).toBe(200);
    expect(register.json().rows.length).toBeGreaterThanOrEqual(3);
    expect(register.json().totals.netBookValue).toBe('19500.0000');

    const reconciliation = await api(ctx, cookie, 'GET', `${base()}/reports/reconciliation?asOf=2026-06-30`);
    expect(reconciliation.statusCode).toBe(200);
    expect(reconciliation.json().balanced).toBe(true);
    expect(reconciliation.json().difference).toBe('0.0000');

    const csv = await api(ctx, cookie, 'GET', `${base()}/reports/register?asOf=2026-06-30&format=csv&lang=en`);
    expect(csv.statusCode).toBe(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.body).toContain('Asset');
    expect(csv.body).toContain('DEMONSTRATION EXPORT');

    const pdf = await api(ctx, cookie, 'GET', `${base()}/reports/register?asOf=2026-06-30&format=pdf&lang=en`);
    expect(pdf.statusCode).toBe(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');
    expect(pdf.rawPayload.subarray(0, 4).toString()).toBe('%PDF');

    const schedule = await api(ctx, cookie, 'GET', `${base()}/reports/schedule?from=2025-08-01&to=2025-11-30`);
    expect(schedule.statusCode).toBe(200);
    expect(schedule.json().rows.length).toBeGreaterThanOrEqual(5);

    const movement = await api(ctx, cookie, 'GET', `${base()}/reports/movement-schedule?from=2025-07-01&to=2026-06-30`);
    expect(movement.statusCode).toBe(200);
    expect(movement.json().cost.check).toBe('0.0000');
    expect(movement.json().depreciation.check).toBe('0.0000');
  });
});
