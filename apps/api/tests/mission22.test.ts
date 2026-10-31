import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  accountByCode, api, closeTestApp, createCompany, getAccounts, getJournals, journalByCode,
  registerUser, setupCompanyWithChart, type TestContext,
} from './helpers.js';

/**
 * Mission 22 — inventory, accruals/prepayments and provisions.
 * All names, amounts and documents are fictitious. No statutory rule is tested
 * because none is asserted by the implementation.
 */
describe('inventory, accruals and provisions', () => {
  let ctx: TestContext;
  let cookie: string;
  let companyA: string;
  let companyB: string;
  let cookieB: string;
  let accounts: any[];
  let journals: any[];
  let categoryId: string;
  let locationA: string;
  let locationB: string;
  let itemId: string;
  const base = (company = companyA) => `/api/companies/${company}`;
  const acc = (code: string) => accountByCode(accounts, code);
  const journal = (code = 'OD') => journalByCode(journals, code);

  async function post(company: string, entryDate: string, lines: any[], description: string) {
    return api(ctx, cookie, 'POST', `${base(company)}/entries`, {
      journalId: journal().id, entryDate, reference: `M22-${Math.random().toString(36).slice(2, 8)}`,
      description, status: 'posted', lines,
    });
  }
  async function move(payload: any) {
    const res = await api(ctx, cookie, 'POST', `${base()}/inventory/movements`, payload);
    if (res.statusCode !== 201) throw new Error(`move failed ${res.statusCode} ${res.body}`);
    return res.json().movement;
  }
  async function decide(path: string, action: 'approve' | 'reject' | 'post', body?: any) {
    return api(ctx, cookie, 'POST', path, action === 'reject'
      ? { reason: body?.reason ?? 'Fictitious rejection reason.' }
      : action === 'approve' ? { confirm: true, note: 'Fictitious approval note for mission 22 test.' } : undefined);
  }
  async function approvedMovement(payload: any) {
    const created = await move(payload);
    expect((await decide(`${base()}/inventory/movements/${created.id}/approve`, 'approve')).statusCode).toBe(200);
    const posted = await decide(`${base()}/inventory/movements/${created.id}/post`, 'post');
    if (posted.statusCode !== 200) throw new Error(`post failed ${posted.statusCode} ${posted.body}`);
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
    const userB = await registerUser(ctx, { email: 'mission22-b@example.test' });
    const b = await createCompany(ctx, userB.cookie, { name: 'Second Mission 22 Company Ltd (fictitious)' });
    companyB = b.id;
    cookieB = userB.cookie;

    const cat = await api(ctx, cookie, 'POST', `${base()}/inventory/categories`, {
      code: 'TRADE', name: 'Fictitious traded goods', valuationMethod: 'fifo',
      inventoryAccountId: acc('1300').id, cogsAccountId: acc('5000').id,
      adjustmentAccountId: acc('5100').id, writeDownAccountId: acc('6200').id,
    });
    expect(cat.statusCode).toBe(201);
    categoryId = cat.json().category.id;
    const locA = await api(ctx, cookie, 'POST', `${base()}/inventory/locations`, { code: 'MAIN', name: 'Fictitious main store' });
    const locB = await api(ctx, cookie, 'POST', `${base()}/inventory/locations`, { code: 'SECOND', name: 'Fictitious second store' });
    expect(locA.statusCode).toBe(201);
    expect(locB.statusCode).toBe(201);
    locationA = locA.json().location.id;
    locationB = locB.json().location.id;
    const item = await api(ctx, cookie, 'POST', `${base()}/inventory/items`, {
      categoryId, sku: 'FICT-001', name: 'Fictitious item', unit: 'unit',
    });
    expect(item.statusCode).toBe(201);
    itemId = item.json().item.id;
  });

  afterAll(async () => { await closeTestApp(ctx); });

  it('values opening stock, purchases and FIFO issues with exact decimals and reconciles the ledger', async () => {
    await approvedMovement({ itemId, locationId: locationA, movementDate: '2025-07-02', direction: 'in',
      sourceKind: 'opening', quantity: '100', unitCost: '10', description: 'Fictitious opening stock',
      documentRef: 'OPEN-FICT-001', journalId: journal().id, counterpartAccountId: acc('3100').id });
    await approvedMovement({ itemId, locationId: locationA, movementDate: '2025-08-01', direction: 'in',
      sourceKind: 'receipt', quantity: '50', unitCost: '12', description: 'Fictitious purchase receipt',
      documentRef: 'GRN-FICT-001', journalId: journal().id, counterpartAccountId: acc('2000').id });
    const issue = await approvedMovement({ itemId, locationId: locationA, movementDate: '2025-09-01', direction: 'out',
      sourceKind: 'issue', quantity: '120', description: 'Fictitious sale issue',
      documentRef: 'ISS-FICT-001', journalId: journal().id });
    expect(issue.entry).toBeTruthy();

    const report = await api(ctx, cookie, 'GET', `${base()}/inventory/report?asOf=2025-09-30`);
    expect(report.statusCode).toBe(200);
    expect(report.json().rows[0].quantity).toBe('30.0000');
    expect(report.json().rows[0].value).toBe('360.0000');
    expect(report.json().rows[0].unitCost).toBe('12.0000');
    const recon = await api(ctx, cookie, 'GET', `${base()}/inventory/reconciliation?asOf=2025-09-30`);
    expect(recon.statusCode).toBe(200);
    expect(recon.json().balanced).toBe(true);
    expect(recon.json().rows[0].difference).toBe('0.0000');
  });

  it('refuses negative stock and keeps companies isolated', async () => {
    const negative = await api(ctx, cookie, 'POST', `${base()}/inventory/movements`, {
      itemId, locationId: locationA, movementDate: '2025-10-01', direction: 'out', sourceKind: 'issue',
      quantity: '9999', description: 'Fictitious impossible issue', documentRef: 'ISS-FICT-NEG',
      journalId: journal().id,
    });
    expect(negative.statusCode).toBe(201);
    const negativeId = negative.json().movement.id;
    await decide(`${base()}/inventory/movements/${negativeId}/approve`, 'approve');
    const refused = await decide(`${base()}/inventory/movements/${negativeId}/post`, 'post');
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error.code).toBe('INVENTORY_NEGATIVE_STOCK');
    expect((await decide(`${base()}/inventory/movements/${negativeId}/reject`, 'reject')).statusCode).toBe(200);

    const other = await api(ctx, cookieB, 'GET', `${base(companyB)}/inventory/items`);
    expect(other.statusCode).toBe(200);
    expect(other.json().items).toHaveLength(0);
    const forbidden = await api(ctx, cookie, 'GET', `${base(companyB)}/inventory/items`);
    expect(forbidden.statusCode).toBe(404);
    const otherMovements = await api(ctx, cookieB, 'GET', `${base(companyB)}/inventory/movements`);
    expect(otherMovements.json().movements).toHaveLength(0);
  });

  it('supports weighted average cost independently from FIFO and reconciles a shared ledger account', async () => {
    const category = await api(ctx, cookie, 'POST', `${base()}/inventory/categories`, {
      code: 'WAVG', name: 'Fictitious weighted-average goods', valuationMethod: 'weighted_average',
      inventoryAccountId: acc('1300').id, cogsAccountId: acc('5000').id,
      adjustmentAccountId: acc('5100').id, writeDownAccountId: acc('6200').id,
    });
    expect(category.statusCode).toBe(201);
    const location = await api(ctx, cookie, 'POST', `${base()}/inventory/locations`, { code: 'WAVG-STORE', name: 'Fictitious average-cost store' });
    expect(location.statusCode).toBe(201);
    const item = await api(ctx, cookie, 'POST', `${base()}/inventory/items`, {
      categoryId: category.json().category.id, sku: 'FICT-WAVG', name: 'Fictitious average-cost item', unit: 'unit',
    });
    expect(item.statusCode).toBe(201);
    const itemId2 = item.json().item.id;
    const locId = location.json().location.id;
    await approvedMovement({ itemId: itemId2, locationId: locId, movementDate: '2025-07-03', direction: 'in',
      sourceKind: 'opening', quantity: '10', unitCost: '10', description: 'Fictitious average-cost opening stock.',
      documentRef: 'OPEN-FICT-WAVG-1', journalId: journal().id, counterpartAccountId: acc('3100').id });
    await approvedMovement({ itemId: itemId2, locationId: locId, movementDate: '2025-08-03', direction: 'in',
      sourceKind: 'receipt', quantity: '10', unitCost: '20', description: 'Fictitious average-cost purchase.',
      documentRef: 'GRN-FICT-WAVG-1', journalId: journal().id, counterpartAccountId: acc('2000').id });
    await approvedMovement({ itemId: itemId2, locationId: locId, movementDate: '2025-09-03', direction: 'out',
      sourceKind: 'issue', quantity: '4', description: 'Fictitious average-cost issue.',
      documentRef: 'ISS-FICT-WAVG-1', journalId: journal().id });
    const report = await api(ctx, cookie, 'GET', `${base()}/inventory/report?asOf=2025-09-30`);
    const row = report.json().rows.find((r: any) => r.sku === 'FICT-WAVG');
    expect(row.quantity).toBe('16.0000');
    expect(row.value).toBe('240.0000');
    expect(row.unitCost).toBe('15.0000');
    const recon = await api(ctx, cookie, 'GET', `${base()}/inventory/reconciliation?asOf=2025-09-30`);
    expect(recon.json().balanced).toBe(true);
    expect(recon.json().rows).toHaveLength(1);
    expect(recon.json().rows[0].categories).toHaveLength(2);
  });

  it('transfers stock between locations and approves a physical-count adjustment', async () => {
    const transfer = await api(ctx, cookie, 'POST', `${base()}/inventory/transfers`, {
      itemId, locationId: locationA, destinationLocationId: locationB, movementDate: '2025-10-02',
      quantity: '10', description: 'Fictitious internal transfer', documentRef: 'TRF-FICT-001',
      journalId: journal().id,
    });
    expect(transfer.statusCode).toBe(201);
    const approved = await decide(`${base()}/inventory/movements/${transfer.json().movement.id}/approve`, 'approve');
    expect(approved.statusCode).toBe(200);
    expect((await decide(`${base()}/inventory/movements/${transfer.json().movement.id}/post`, 'post')).statusCode).toBe(200);

    const count = await api(ctx, cookie, 'POST', `${base()}/inventory/counts`, {
      locationId: locationA, countDate: '2025-10-31', reference: 'COUNT-FICT-001',
      lines: [{ itemId, countedQuantity: '25' }],
    });
    expect(count.statusCode).toBe(201);
    const adjustments = await api(ctx, cookie, 'POST', `${base()}/inventory/counts/${count.json().count.id}/generate-adjustments`);
    expect(adjustments.statusCode).toBe(200);
    expect(adjustments.json().movements).toHaveLength(1);
    const adjustmentId = adjustments.json().movements[0];
    const adjustment = (await api(ctx, cookie, 'GET', `${base()}/inventory/movements/${adjustmentId}`)).json().movement;
    expect(adjustment.status).toBe('PROPOSED');
    await decide(`${base()}/inventory/movements/${adjustmentId}/approve`, 'approve');
    expect((await decide(`${base()}/inventory/movements/${adjustmentId}/post`, 'post')).statusCode).toBe(200);

    const report = await api(ctx, cookie, 'GET', `${base()}/inventory/report?asOf=2025-10-31`);
    const byLocation = new Map(report.json().rows.map((r: any) => [r.location.code, r]));
    expect((byLocation.get('MAIN') as any).quantity).toBe('25.0000');
    expect((byLocation.get('SECOND') as any).quantity).toBe('10.0000');
    expect(report.json().totals.quantity).toBe('51.0000');
  });

  it('proposes a documented inventory write-down and posts it only after approval', async () => {
    const wd = await api(ctx, cookie, 'POST', `${base()}/inventory/write-downs`, {
      itemId, locationId: locationA, writeDownDate: '2025-11-30', amount: '100',
      reason: 'Fictitious obsolescence identified during the physical review.',
      documentRef: 'WD-FICT-001', journalId: journal().id,
    });
    expect(wd.statusCode).toBe(201);
    const id = wd.json().writeDown.id;
    expect((await decide(`${base()}/inventory/write-downs/${id}/post`, 'post')).statusCode).toBe(409);
    expect((await decide(`${base()}/inventory/write-downs/${id}/approve`, 'approve')).statusCode).toBe(200);
    expect((await decide(`${base()}/inventory/write-downs/${id}/post`, 'post')).statusCode).toBe(200);
    const recon = await api(ctx, cookie, 'GET', `${base()}/inventory/reconciliation?asOf=2025-11-30`);
    expect(recon.json().balanced).toBe(true);
  });

  it('allocates accruals and prepayments by period, reverses them, and reconciles the ledger', async () => {
    const schedule = await api(ctx, cookie, 'POST', `${base()}/accruals`, {
      reference: 'ACC-FICT-001', kind: 'accrued_expense', description: 'Fictitious utilities accrual',
      documentRef: 'INV-FICT-UTIL', pnlAccountId: acc('6110').id, balanceAccountId: acc('2100').id,
      journalId: journal().id, totalAmount: '12000', startDate: '2025-07-01', endDate: '2026-06-30', months: 12,
    });
    expect(schedule.statusCode).toBe(201);
    const s = schedule.json().schedule;
    expect(s.lines).toHaveLength(12);
    expect(s.lines[0].amount).toBe('1000.0000');
    expect(s.lines[11].amount).toBe('1000.0000');

    expect((await api(ctx, cookie, 'POST', `${base()}/accruals/${s.id}/post-due`, { asOf: '2025-09-30' })).statusCode).toBe(409);
    expect((await decide(`${base()}/accruals/${s.id}/approve`, 'approve')).statusCode).toBe(200);
    const due = await api(ctx, cookie, 'POST', `${base()}/accruals/${s.id}/post-due`, { asOf: '2025-09-30' });
    expect(due.statusCode).toBe(200);
    expect(due.json().entries).toHaveLength(3);

    const reverse = await api(ctx, cookie, 'POST', `${base()}/accruals/${s.id}/lines/${due.json().schedule.lines[0].id}/reverse`, {
      reversalDate: '2025-10-01', reason: 'Fictitious duplicate accrual reversed.',
    });
    expect(reverse.statusCode).toBe(200);
    expect(reverse.json().schedule.lines[0].status).toBe('REVERSED');

    const prepaid = await api(ctx, cookie, 'POST', `${base()}/accruals`, {
      reference: 'PRE-FICT-001', kind: 'prepaid_expense', description: 'Fictitious insurance paid in advance',
      documentRef: 'POL-FICT-001', pnlAccountId: acc('6150').id, balanceAccountId: acc('1150').id,
      journalId: journal().id, totalAmount: '24000', startDate: '2025-07-01', endDate: '2026-06-30', months: 12,
    });
    expect(prepaid.statusCode).toBe(201);
    const p = prepaid.json().schedule;
    await decide(`${base()}/accruals/${p.id}/approve`, 'approve');
    expect((await api(ctx, cookie, 'POST', `${base()}/accruals/${p.id}/post-due`, { asOf: '2025-07-31' })).statusCode).toBe(200);

    const report = await api(ctx, cookie, 'GET', `${base()}/accruals/report?asOf=2025-10-31`);
    expect(report.statusCode).toBe(200);
    expect(report.json().balanced).toBe(true);
    expect(report.json().reconciliation.every((r: any) => r.difference === '0.0000')).toBe(true);
  });

  it('keeps deferred income separate and requires human approval before posting', async () => {
    const deferred = await api(ctx, cookie, 'POST', `${base()}/accruals`, {
      reference: 'DEF-FICT-001', kind: 'deferred_income', description: 'Fictitious deferred service income',
      documentRef: 'CONTRACT-FICT-001', pnlAccountId: acc('4010').id, balanceAccountId: acc('2100').id,
      journalId: journal().id, totalAmount: '6000', startDate: '2025-07-01', endDate: '2025-09-30', months: 3,
    });
    expect(deferred.statusCode).toBe(201);
    const d = deferred.json().schedule;
    const early = await api(ctx, cookie, 'POST', `${base()}/accruals/${d.id}/post-due`, { asOf: '2025-09-30' });
    expect(early.statusCode).toBe(409);
    await decide(`${base()}/accruals/${d.id}/approve`, 'approve');
    const posted = await api(ctx, cookie, 'POST', `${base()}/accruals/${d.id}/post-due`, { asOf: '2025-09-30' });
    expect(posted.statusCode).toBe(200);
    expect(posted.json().entries).toHaveLength(3);
    expect(posted.json().schedule.totals.posted).toBe('6000.0000');
    const report = await api(ctx, cookie, 'GET', `${base()}/accruals/report?asOf=2025-09-30`);
    const liability = report.json().reconciliation.find((r: any) => r.account.code === '2100');
    expect(liability.difference).toBe('0.0000');
  });

  it('tracks provision recognition, revision, utilisation and reversal without automatic recognition', async () => {
    const draft = await api(ctx, cookie, 'POST', `${base()}/provisions`, {
      category: 'litigation', description: 'Fictitious litigation provision', evidenceRef: 'LEGAL-FICT-001',
      recognitionDate: '2025-08-01', measurementBasis: 'Fictitious management estimate, subject to professional review.',
      expenseAccountId: acc('6130').id, provisionAccountId: acc('2100').id,
    });
    expect(draft.statusCode).toBe(201);
    expect(draft.json().provision.status).toBe('DRAFT');
    expect(draft.json().provision.pendingMovements).toBe(0);

    const created = await api(ctx, cookie, 'POST', `${base()}/provisions`, {
      category: 'warranty', description: 'Fictitious warranty provision', evidenceRef: 'WARRANTY-FICT-001',
      recognitionDate: '2025-08-01', measurementBasis: 'Fictitious management estimate, subject to professional review.',
      expenseAccountId: acc('6130').id, provisionAccountId: acc('2100').id,
      initialAmount: '50000', journalId: journal().id, initialReason: 'Fictitious initial recognition proposal.',
      documentRef: 'WARRANTY-FICT-001',
    });
    expect(created.statusCode).toBe(201);
    const provision = created.json().provision;
    expect(provision.movements).toHaveLength(1);
    expect(provision.movements[0].status).toBe('PROPOSED');
    expect((await decide(`${base()}/provisions/movements/${provision.movements[0].id}/post`, 'post')).statusCode).toBe(409);
    expect((await decide(`${base()}/provisions/movements/${provision.movements[0].id}/approve`, 'approve')).statusCode).toBe(200);
    expect((await decide(`${base()}/provisions/movements/${provision.movements[0].id}/post`, 'post')).statusCode).toBe(200);

    async function addMovement(body: any) {
      const res = await api(ctx, cookie, 'POST', `${base()}/provisions/${provision.id}/movements`, body);
      expect(res.statusCode).toBe(201);
      const movement = res.json().provision.movements.find((m: any) => m.id === res.json().movementId);
      expect((await decide(`${base()}/provisions/movements/${movement.id}/approve`, 'approve')).statusCode).toBe(200);
      expect((await decide(`${base()}/provisions/movements/${movement.id}/post`, 'post')).statusCode).toBe(200);
      return movement;
    }
    await addMovement({ movementType: 'revision', movementDate: '2025-09-01', amount: '10000',
      direction: 'increase', reason: 'Fictitious revision following new evidence.', documentRef: 'REV-FICT-001', journalId: journal().id });
    await addMovement({ movementType: 'utilisation', movementDate: '2025-10-01', amount: '20000',
      reason: 'Fictitious utilisation against the provision.', documentRef: 'USE-FICT-001', journalId: journal().id,
      counterpartAccountId: acc('2000').id });
    await addMovement({ movementType: 'reversal', movementDate: '2025-11-01', amount: '40000',
      reason: 'Fictitious reversal of the remaining provision.', documentRef: 'REVERSAL-FICT-001', journalId: journal().id });

    const detail = await api(ctx, cookie, 'GET', `${base()}/provisions/${provision.id}`);
    expect(detail.statusCode).toBe(200);
    expect(detail.json().provision.totals.carrying).toBe('0.0000');
    expect(detail.json().provision.status).toBe('REVERSED');
    const recon = await api(ctx, cookie, 'GET', `${base()}/provisions/reconciliation?asOf=2025-12-31`);
    expect(recon.statusCode).toBe(200);
    expect(recon.json().balanced).toBe(true);
  });

  it('bridges a validated purchase invoice into proposed receipts without duplicating purchases', async () => {
    const supplier = await ctx.db.query<any>(
      `INSERT INTO purchase_suppliers (company_id, name, reference) VALUES ($1,$2,$3) RETURNING id`,
      [companyA, 'Fictitious bridge supplier', 'SUP-BRIDGE-001']);
    const supplierId = supplier.rows[0].id;
    const doc = await ctx.db.query<any>(
      `INSERT INTO purchase_documents (company_id, supplier_id, kind, doc_no, supplier_reference, issue_date,
         currency, subtotal, total_amount, status, validated_at)
       VALUES ($1,$2,'invoice','PUR-BRIDGE-001','SUP-INV-BRIDGE-001','2025-12-01','MUR',100,100,'validated',now())
       RETURNING id`, [companyA, supplierId]);
    const documentId = doc.rows[0].id;
    const line = await ctx.db.query<any>(
      `INSERT INTO purchase_document_lines (document_id, company_id, line_no, description, quantity,
         unit_price, account_id, vat_treatment, net_amount, line_total)
       VALUES ($1,$2,1,'Fictitious bridge goods',10,10,$3,'zero_rated',100,100) RETURNING id`,
      [documentId, companyA, acc('5000').id]);
    const purchaseLineId = line.rows[0].id;
    const bridgeItem = await api(ctx, cookie, 'POST', `${base()}/inventory/items`, {
      categoryId, sku: 'BRIDGE-001', name: 'Fictitious bridged item', unit: 'unit',
    });
    const bridged = await api(ctx, cookie, 'POST', `${base()}/inventory/movements/from-purchase/${documentId}`, {
      journalId: journal().id,
      lines: [{ purchaseLineId, itemId: bridgeItem.json().item.id, locationId: locationB, quantity: '10' }],
    });
    expect(bridged.statusCode).toBe(201);
    expect(bridged.json().movements).toHaveLength(1);
    expect(bridged.json().movements[0].status).toBe('PROPOSED');
    expect(bridged.json().movements[0].value).toBe('100.0000');
    expect(bridged.json().movements[0].documentRef).toBe('purchase:PUR-BRIDGE-001');
    const movement = bridged.json().movements[0];
    expect((await decide(`${base()}/inventory/movements/${movement.id}/approve`, 'approve')).statusCode).toBe(200);
    const posted = await decide(`${base()}/inventory/movements/${movement.id}/post`, 'post');
    expect(posted.statusCode).toBe(200);
    const recon = await api(ctx, cookie, 'GET', `${base()}/inventory/reconciliation?asOf=2025-12-31`);
    expect(recon.json().balanced).toBe(true);
    const duplicate = await api(ctx, cookie, 'POST', `${base()}/inventory/movements/from-purchase/${documentId}`, {
      journalId: journal().id,
      lines: [{ purchaseLineId, itemId: bridgeItem.json().item.id, locationId: locationB, quantity: '11' }],
    });
    expect(duplicate.statusCode).toBe(400);
    expect(duplicate.json().error.code).toBe('INVENTORY_SOURCE_QUANTITY_INVALID');
  });

  it('refuses to post into a closed period without reopening it', async () => {
    const schedule = await api(ctx, cookie, 'POST', `${base()}/accruals`, {
      reference: 'ACC-CLOSED-001', kind: 'accrued_expense', description: 'Fictitious closed-period accrual.',
      documentRef: 'INV-FICT-CLOSED', pnlAccountId: acc('6110').id, balanceAccountId: acc('2100').id,
      journalId: journal().id, totalAmount: '1000', startDate: '2025-07-01', endDate: '2025-07-31', months: 1,
    });
    expect(schedule.statusCode).toBe(201);
    const s = schedule.json().schedule;
    await decide(`${base()}/accruals/${s.id}/approve`, 'approve');
    const period = (await api(ctx, cookie, 'GET', `${base()}/financial-years/timeline`)).json().currentPeriod;
    await ctx.db.query(`UPDATE accounting_periods SET status='closed' WHERE id=$1 AND company_id=$2`, [period.id, companyA]);
    try {
      const refused = await api(ctx, cookie, 'POST', `${base()}/accruals/${s.id}/post-due`, { asOf: '2025-07-31' });
      expect(refused.statusCode).toBe(409);
      expect(refused.json().error.code).toBe('PERIOD_CLOSED');
      const after = await api(ctx, cookie, 'GET', `${base()}/accruals/${s.id}`);
      expect(after.json().schedule.lines[0].status).toBe('PENDING');
      expect(after.json().schedule.lines[0].entryId).toBeNull();
    } finally {
      await ctx.db.query(`UPDATE accounting_periods SET status='open' WHERE id=$1 AND company_id=$2`, [period.id, companyA]);
    }
  });

  it('reports real year-end checklist controls instead of unavailable placeholders', async () => {
    const timeline = await api(ctx, cookie, 'GET', `${base()}/financial-years/timeline`);
    const period = timeline.json().currentPeriod;
    expect(period).toBeTruthy();
    const checklist = await api(ctx, cookie, 'GET', `${base()}/financial-years/checklist?periodId=${period.id}`);
    expect(checklist.statusCode).toBe(200);
    for (const code of ['INVENTORY', 'ACCRUALS_PREPAYMENTS', 'PROVISIONS']) {
      const item = checklist.json().items.find((i: any) => i.code === code);
      expect(item).toBeTruthy();
      expect(item.state).not.toBe('unavailable');
    }
    const inventory = checklist.json().items.find((i: any) => i.code === 'INVENTORY');
    expect(inventory.state).toBe('ok');
    expect(inventory.detailEn).toMatch(/reconciled with the ledger/i);
  });
});
