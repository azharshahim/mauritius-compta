import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  accountByCode,
  api,
  closeTestApp,
  createCompany,
  createTestApp,
  getAccounts,
  getJournals,
  journalByCode,
  registerUser,
  setupCompanyWithChart,
  type TestContext,
  type TestUser,
} from './helpers.js';

/**
 * Mission 42 — purchases, sales, OCR and accounting integrity.
 *
 * Every supplier, customer, invoice and payment in this file is fictitious.
 * The scenarios exercise the public HTTP API and the accounting engine; no
 * amount is rewritten and no official MRA return is produced.
 */

async function createSupplier(
  ctx: TestContext,
  cookie: string,
  companyId: string,
  name: string,
): Promise<any> {
  const res = await api(ctx, cookie, 'POST', `/api/companies/${companyId}/purchases/suppliers`, {
    name,
    registrationNumber: `BRN-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
  });
  expect(res.statusCode).toBe(201);
  return res.json().supplier;
}

async function createCustomer(
  ctx: TestContext,
  cookie: string,
  companyId: string,
  name: string,
): Promise<any> {
  const res = await api(ctx, cookie, 'POST', `/api/companies/${companyId}/billing/customers`, {
    name,
    brn: `BRN-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    paymentTermsDays: 30,
  });
  expect(res.statusCode).toBe(201);
  return res.json().customer;
}

async function billingInvoice(
  ctx: TestContext,
  cookie: string,
  companyId: string,
  customerId: string,
  body: Record<string, unknown>,
): Promise<any> {
  const created = await api(ctx, cookie, 'POST', `/api/companies/${companyId}/billing/documents`, {
    kind: 'invoice',
    customerId,
    issueDate: '2025-09-01',
    dueDate: '2025-10-01',
    lines: [
      {
        description: 'Prestation fictive',
        quantity: '1',
        unitPrice: '1000.00',
        vatTreatment: 'zero_rated',
      },
    ],
    ...body,
  });
  expect(created.statusCode).toBe(201);
  const issued = await api(
    ctx,
    cookie,
    'POST',
    `/api/companies/${companyId}/billing/documents/${created.json().document.id}/issue`,
  );
  expect(issued.statusCode).toBe(200);
  return issued.json().document;
}

async function postProposal(
  ctx: TestContext,
  cookie: string,
  companyId: string,
  proposalId: string,
): Promise<any> {
  const validated = await api(
    ctx,
    cookie,
    'POST',
    `/api/companies/${companyId}/ai/entry-proposals/${proposalId}/validate`,
    { acceptWarnings: true },
  );
  expect(validated.statusCode).toBe(200);
  const posted = await api(
    ctx,
    cookie,
    'POST',
    `/api/companies/${companyId}/ai/entry-proposals/${proposalId}/post`,
  );
  expect(posted.statusCode).toBe(200);
  return posted.json();
}

describe('mission 42 — cycle achats/ventes, OCR et intégrité comptable', () => {
  let ctx: TestContext;
  let owner: TestUser;
  let company: any;
  let accounts: any[];
  let journals: any[];
  let cabinetId: string;

  beforeAll(async () => {
    const setup = await setupCompanyWithChart();
    ctx = setup.ctx;
    owner = setup.user;
    company = setup.company;
    accounts = setup.accounts;
    journals = setup.journals;
    const cabinet = await ctx.db.query<{ cabinet_id: string }>(
      'SELECT cabinet_id FROM companies WHERE id = $1',
      [company.id],
    );
    cabinetId = cabinet.rows[0]!.cabinet_id;
  });

  afterAll(async () => {
    await closeTestApp(ctx);
  });

  it('keeps sales balances and aging strictly per currency, at the real allocation date', async () => {
    const customer = await createCustomer(ctx, owner.cookie, company.id, 'Client Devises Fictif');
    const mur = await billingInvoice(ctx, owner.cookie, company.id, customer.id, {
      currency: 'MUR',
      issueDate: '2025-09-01',
      dueDate: '2025-10-01',
    });
    const eur = await billingInvoice(ctx, owner.cookie, company.id, customer.id, {
      currency: 'EUR',
      exchangeRate: '50',
      issueDate: '2025-09-02',
      dueDate: '2025-10-02',
    });
    expect(mur.currency).toBe('MUR');
    expect(eur.currency).toBe('EUR');

    const murPayment = await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/billing/payments`, {
      customerId: customer.id,
      paymentDate: '2025-11-01',
      amount: '200.00',
      currency: 'MUR',
    });
    expect(murPayment.statusCode).toBe(201);
    const eurPayment = await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/billing/payments`, {
      customerId: customer.id,
      paymentDate: '2025-11-01',
      amount: '100.00',
      currency: 'EUR',
      exchangeRate: '50',
    });
    expect(eurPayment.statusCode).toBe(201);

    // Allocated in December, so the October aging must not anticipate them.
    for (const [paymentId, invoiceId, amount] of [
      [murPayment.json().payment.id, mur.id, '200.00'],
      [eurPayment.json().payment.id, eur.id, '100.00'],
    ] as const) {
      const allocated = await api(
        ctx,
        owner.cookie,
        'POST',
        `/api/companies/${company.id}/billing/payments/${paymentId}/allocations`,
        { invoiceId, amount, allocationDate: '2025-12-01', confirm: true },
      );
      expect(allocated.statusCode).toBe(201);
    }

    const october = await api(
      ctx,
      owner.cookie,
      'GET',
      `/api/companies/${company.id}/billing/aging?asOf=2025-10-31&customerId=${customer.id}`,
    );
    expect(october.statusCode).toBe(200);
    const octoberBody = october.json();
    expect(octoberBody.rows).toHaveLength(2);
    expect(octoberBody.rows.map((r: any) => r.currency).sort()).toEqual(['EUR', 'MUR']);
    expect(octoberBody.rows.every((r: any) => r.buckets.total === '1000.0000')).toBe(true);
    // Two currencies: there is no single total, and no cross-currency addition.
    expect(octoberBody.totals).toBeNull();
    expect(octoberBody.totalsByCurrency).toHaveLength(2);

    const december = await api(
      ctx,
      owner.cookie,
      'GET',
      `/api/companies/${company.id}/billing/aging?asOf=2025-12-31&customerId=${customer.id}`,
    );
    const decemberRows = december.json().rows;
    expect(decemberRows.find((r: any) => r.currency === 'MUR').buckets.total).toBe('800.0000');
    expect(decemberRows.find((r: any) => r.currency === 'EUR').buckets.total).toBe('900.0000');

    const balanceOctober = await api(
      ctx,
      owner.cookie,
      'GET',
      `/api/companies/${company.id}/billing/customers/${customer.id}/balance?asOf=2025-10-31`,
    );
    expect(balanceOctober.statusCode).toBe(200);
    const octoberBalances = balanceOctober.json().balance.balances;
    expect(octoberBalances).toHaveLength(2);
    expect(octoberBalances.every((b: any) => b.outstanding === '1000.0000')).toBe(true);

    const balanceDecember = await api(
      ctx,
      owner.cookie,
      'GET',
      `/api/companies/${company.id}/billing/customers/${customer.id}/balance?asOf=2025-12-31`,
    );
    const decemberBalances = balanceDecember.json().balance.balances;
    expect(decemberBalances.find((b: any) => b.currency === 'MUR').outstanding).toBe('800.0000');
    expect(decemberBalances.find((b: any) => b.currency === 'EUR').outstanding).toBe('900.0000');
    expect(decemberBalances.find((b: any) => b.currency === 'MUR').unallocated).toBe('0.0000');

    const summary = await api(
      ctx,
      owner.cookie,
      'GET',
      `/api/companies/${company.id}/billing/summary`,
    );
    expect(summary.statusCode).toBe(200);
    expect(summary.json().openReceivablesByCurrency.map((r: any) => r.currency).sort()).toEqual(['EUR', 'MUR']);
    expect(summary.json().openReceivables).toBeNull();
    expect(summary.json().aging).toBeNull();
    expect(summary.json().agingByCurrency).toHaveLength(2);
  });

  it('allocates an over-payment later and lets the same allocation be cancelled then reactivated', async () => {
    const customer = await createCustomer(ctx, owner.cookie, company.id, 'Client Trop-Perçu Fictif');
    const invoice = await billingInvoice(ctx, owner.cookie, company.id, customer.id, {
      issueDate: '2025-09-10',
      dueDate: '2025-10-10',
      lines: [
        {
          description: 'Prestation fictive 500',
          quantity: '1',
          unitPrice: '500.00',
          vatTreatment: 'zero_rated',
        },
      ],
    });
    const receipt = await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/billing/payments`, {
      customerId: customer.id,
      paymentDate: '2025-09-20',
      amount: '800.00',
      currency: 'MUR',
    });
    expect(receipt.statusCode).toBe(201);

    const allocated = await api(
      ctx,
      owner.cookie,
      'POST',
      `/api/companies/${company.id}/billing/payments/${receipt.json().payment.id}/allocations`,
      { invoiceId: invoice.id, amount: '300.00', allocationDate: '2025-09-21', confirm: true },
    );
    expect(allocated.statusCode).toBe(201);
    const allocationId = allocated.json().allocationId;

    const afterAllocation = await api(
      ctx,
      owner.cookie,
      'GET',
      `/api/companies/${company.id}/billing/documents/${invoice.id}`,
    );
    expect(afterAllocation.json().document.amountPaid).toBe('300.0000');
    expect(afterAllocation.json().document.outstanding).toBe('200.0000');

    const cancelled = await api(
      ctx,
      owner.cookie,
      'DELETE',
      `/api/companies/${company.id}/billing/payments/${receipt.json().payment.id}/allocations/${allocationId}`,
      { reason: 'Affectation fictive annulée pour le test' },
    );
    expect(cancelled.statusCode).toBe(200);
    const afterCancel = await api(
      ctx,
      owner.cookie,
      'GET',
      `/api/companies/${company.id}/billing/documents/${invoice.id}`,
    );
    expect(afterCancel.json().document.amountPaid).toBe('0.0000');

    const reactivated = await api(
      ctx,
      owner.cookie,
      'POST',
      `/api/companies/${company.id}/billing/payments/${receipt.json().payment.id}/allocations`,
      { invoiceId: invoice.id, amount: '300.00', allocationDate: '2025-09-22', confirm: true },
    );
    expect(reactivated.statusCode).toBe(201);
    expect(reactivated.json().allocationId).toBe(allocationId);
    const afterReactivation = await api(
      ctx,
      owner.cookie,
      'GET',
      `/api/companies/${company.id}/billing/documents/${invoice.id}`,
    );
    expect(afterReactivation.json().document.amountPaid).toBe('300.0000');
  });

  it('allocates a posted supplier advance and prepares a separate reclassification entry', async () => {
    const supplier = await createSupplier(ctx, owner.cookie, company.id, 'Fournisseur Acompte Fictif');
    const invoiceRes = await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/purchases/documents`, {
      kind: 'invoice',
      supplierId: supplier.id,
      supplierReference: 'FICT-ACOMPTE-001',
      issueDate: '2025-09-05',
      dueDate: '2025-10-05',
      currency: 'MUR',
      lines: [
        {
          description: 'Achat fictif immobilisé',
          quantity: '1',
          unitPrice: '400.00',
          accountId: accountByCode(accounts, '1500').id,
          vatTreatment: 'out_of_scope',
        },
      ],
    });
    expect(invoiceRes.statusCode).toBe(201);
    const validated = await api(
      ctx,
      owner.cookie,
      'POST',
      `/api/companies/${company.id}/purchases/documents/${invoiceRes.json().document.id}/validate`,
    );
    expect(validated.statusCode).toBe(200);
    const invoice = validated.json().document;

    const advance = await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/purchases/payments`, {
      supplierId: supplier.id,
      kind: 'advance',
      paymentDate: '2025-09-01',
      amount: '600.00',
      currency: 'MUR',
    });
    expect(advance.statusCode).toBe(201);
    const paymentId = advance.json().payment.id;
    const prepared = await api(
      ctx,
      owner.cookie,
      'POST',
      `/api/companies/${company.id}/purchases/payments/${paymentId}/proposal`,
    );
    expect(prepared.statusCode).toBe(201);
    const posted = await postProposal(ctx, owner.cookie, company.id, prepared.json().proposal.id);
    expect(posted.entryCreated).toBe(true);

    const allocated = await api(
      ctx,
      owner.cookie,
      'POST',
      `/api/companies/${company.id}/purchases/payments/${paymentId}/allocations`,
      { invoiceId: invoice.id, amount: '400.00', allocationDate: '2025-09-06', confirm: true },
    );
    expect(allocated.statusCode).toBe(201);
    expect(allocated.json().reclassRequired).toBe(true);

    const reclass = await api(
      ctx,
      owner.cookie,
      'POST',
      `/api/companies/${company.id}/purchases/payments/${paymentId}/allocations/${allocated.json().allocationId}/reclass-proposal`,
    );
    expect(reclass.statusCode).toBe(201);
    expect(reclass.json().entryCreated).toBe(false);
    const reclassProposal = reclass.json().proposal;
    expect(reclassProposal.sourceKind).toBe('purchase_allocation');
    expect(reclassProposal.entryDate).toBe('2025-09-06');
    expect(reclassProposal.currency).toBe('MUR');
    expect(reclassProposal.totals.balanced).toBe(true);
    expect(reclassProposal.lines.map((l: any) => l.accountCode).sort()).toEqual(['1150', '2000']);

    // The proposal is not an entry: posting is the explicit second human action.
    const reclassPosted = await postProposal(ctx, owner.cookie, company.id, reclassProposal.id);
    expect(reclassPosted.entryCreated).toBe(true);
    const secondAttempt = await api(
      ctx,
      owner.cookie,
      'POST',
      `/api/companies/${company.id}/purchases/payments/${paymentId}/allocations/${allocated.json().allocationId}/reclass-proposal`,
    );
    expect(secondAttempt.statusCode).toBe(200);
    expect(secondAttempt.json().reused).toBe(true);
  });

  it('creates at most one fixed asset from a capitalised purchase line', async () => {
    const supplier = await createSupplier(ctx, owner.cookie, company.id, 'Fournisseur Immobilisation Fictif');
    const categoryRes = await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/fixed-assets/categories`, {
      code: 'MAT-42',
      nameEn: 'Mission 42 equipment (fictitious)',
      nameFr: 'Équipement mission 42 (fictif)',
      assetAccountId: accountByCode(accounts, '1500').id,
      accumulatedDepreciationAccountId: accountByCode(accounts, '1510').id,
      depreciationExpenseAccountId: accountByCode(accounts, '6200').id,
    });
    expect(categoryRes.statusCode).toBe(201);
    const categoryId = categoryRes.json().category.id;

    const created = await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/purchases/documents`, {
      kind: 'invoice',
      supplierId: supplier.id,
      supplierReference: 'FICT-IMMO-42',
      issueDate: '2025-09-08',
      dueDate: '2025-10-08',
      currency: 'MUR',
      lines: [
        {
          description: 'Ordinateur fictif',
          quantity: '1',
          unitPrice: '1200.00',
          accountId: accountByCode(accounts, '1500').id,
          vatTreatment: 'out_of_scope',
        },
      ],
    });
    expect(created.statusCode).toBe(201);
    const documentId = created.json().document.id;
    const validated = await api(
      ctx,
      owner.cookie,
      'POST',
      `/api/companies/${company.id}/purchases/documents/${documentId}/validate`,
    );
    expect(validated.statusCode).toBe(200);
    const lineId = validated.json().document.lines[0].id;

    const first = await api(
      ctx,
      owner.cookie,
      'POST',
      `/api/companies/${company.id}/purchases/documents/${documentId}/lines/${lineId}/fixed-asset`,
      { categoryId, usefulLifeMonths: 36 },
    );
    expect(first.statusCode).toBe(201);
    expect(first.json().asset.cost).toBe('1200.0000');
    const assetId = first.json().asset.id;

    const second = await api(
      ctx,
      owner.cookie,
      'POST',
      `/api/companies/${company.id}/purchases/documents/${documentId}/lines/${lineId}/fixed-asset`,
      { categoryId, usefulLifeMonths: 36 },
    );
    expect(second.statusCode).toBe(201);
    expect(second.json().asset.id).toBe(assetId);
    const count = await ctx.db.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM fixed_assets WHERE purchase_document_line_id = $1',
      [lineId],
    );
    expect(count.rows[0]!.count).toBe('1');
  });

  it('converts an approved OCR purchase proposal into a supplier invoice exactly once', async () => {
    const supplier = await createSupplier(ctx, owner.cookie, company.id, 'Fournisseur OCR Fictif');
    const doc = await ctx.db.query<{ id: string }>(
      `INSERT INTO document_imports
         (cabinet_id, company_id, created_by, kind, status, original_name, mime_type, size_bytes,
          sha256, extraction_method, document_type, party_name, invoice_number, invoice_date,
          due_date, currency, subtotal, vat_total, total_amount, approved_at, approved_by)
       VALUES ($1,$2,$3,'purchase','APPROVED','facture-fictive-ocr.pdf','application/pdf',1024,
               'fictitious-sha256-42','ocr_image','invoice',$4,'FICT-OCR-42','2025-09-12',
               '2025-10-12','MUR',1000.00,0,1000.00, now(), $3)
       RETURNING id`,
      [cabinetId, company.id, owner.id, supplier.name],
    );
    const documentId = doc.rows[0]!.id;
    const lines = [
      {
        accountId: accountByCode(accounts, '6100').id,
        accountCode: '6100',
        accountName: 'Loyers',
        description: 'Loyer fictif OCR',
        debit: '1000.0000',
        credit: '0.0000',
        needsAccount: false,
      },
      {
        accountId: accountByCode(accounts, '2000').id,
        accountCode: '2000',
        accountName: 'Fournisseurs',
        description: 'Fournisseur fictif OCR',
        debit: '0.0000',
        credit: '1000.0000',
        needsAccount: false,
      },
    ];
    const proposalRow = await ctx.db.query<{ id: string }>(
      `INSERT INTO document_proposals
         (cabinet_id, company_id, document_id, status, kind, party_id, party_name, journal_id,
          entry_date, currency, lines, balanced, uncertain_fields, rationale, approved_at, approved_by)
       VALUES ($1,$2,$3,'APPROVED','purchase',$4,$5,$6,'2025-09-12','MUR',$7::jsonb,true,'[]'::jsonb,
               '{}'::jsonb, now(), $8)
       RETURNING id`,
      [
        cabinetId,
        company.id,
        documentId,
        supplier.id,
        supplier.name,
        journalByCode(journals, 'PUR').id,
        JSON.stringify(lines),
        owner.id,
      ],
    );
    const proposalId = proposalRow.rows[0]!.id;

    const converted = await api(
      ctx,
      owner.cookie,
      'POST',
      `/api/companies/${company.id}/documents/proposals/${proposalId}/purchase-invoice`,
      { confirm: true, supplierId: supplier.id },
    );
    expect(converted.statusCode).toBe(201);
    expect(converted.json().alreadyCreated).toBe(false);
    expect(converted.json().purchaseDocument.status).toBe('validated');
    expect(converted.json().purchaseDocument.total_amount).toBe('1000.0000');
    const purchaseId = converted.json().purchaseDocument.id;

    const again = await api(
      ctx,
      owner.cookie,
      'POST',
      `/api/companies/${company.id}/documents/proposals/${proposalId}/purchase-invoice`,
      { confirm: true, supplierId: supplier.id },
    );
    expect(again.statusCode).toBe(200);
    expect(again.json().alreadyCreated).toBe(true);
    expect(again.json().purchaseDocument.id).toBe(purchaseId);

    const purchase = await api(
      ctx,
      owner.cookie,
      'GET',
      `/api/companies/${company.id}/purchases/documents/${purchaseId}`,
    );
    expect(purchase.statusCode).toBe(200);
    // The OCR draft entry is never posted by the conversion itself.
    expect(purchase.json().document.accounting_entry_id).toBeNull();
  });

  it('reports VAT control from posted entries only, never as an official return', async () => {
    const companyB = await createCompany(ctx, owner.cookie, { name: 'Contrôles Fictifs Ltée' });
    const accountsB = await getAccounts(ctx, owner.cookie, companyB.id);
    const journalsB = await getJournals(ctx, owner.cookie, companyB.id);
    const od = journalByCode(journalsB, 'OD').id;
    const receivable = accountByCode(accountsB, '1100').id;
    const payable = accountByCode(accountsB, '2000').id;
    const vatInput = accountByCode(accountsB, '1200').id;
    const vatOutput = accountByCode(accountsB, '2200').id;
    const revenue = accountByCode(accountsB, '4000').id;
    const expense = accountByCode(accountsB, '6000').id;

    const entries = [
      {
        entryDate: '2025-09-10',
        description: 'Vente fictive avec TVA',
        lines: [
          { accountId: receivable, debit: '1150.00' },
          { accountId: revenue, credit: '1000.00' },
          { accountId: vatOutput, credit: '150.00' },
        ],
      },
      {
        entryDate: '2025-09-11',
        description: 'Achat fictif avec TVA',
        lines: [
          { accountId: expense, debit: '500.00' },
          { accountId: vatInput, debit: '75.00' },
          { accountId: payable, credit: '575.00' },
        ],
      },
      {
        entryDate: '2025-10-01',
        description: 'Écriture hors période (ne doit pas compter)',
        lines: [
          { accountId: receivable, debit: '230.00' },
          { accountId: vatOutput, credit: '30.00' },
          { accountId: revenue, credit: '200.00' },
        ],
      },
    ];
    for (const entry of entries) {
      const res = await api(ctx, owner.cookie, 'POST', `/api/companies/${companyB.id}/entries`, {
        journalId: od,
        status: 'posted',
        ...entry,
      });
      expect(res.statusCode).toBe(201);
    }

    const control = await api(
      ctx,
      owner.cookie,
      'GET',
      `/api/companies/${companyB.id}/reports/vat-control?from=2025-09-01&to=2025-09-30`,
    );
    expect(control.statusCode).toBe(200);
    const body = control.json();
    expect(body.officialReturn).toBe(false);
    expect(body.totalsByCurrency).toHaveLength(1);
    expect(body.totalsByCurrency[0].currency).toBe('MUR');
    expect(body.totalsByCurrency[0].outputVat).toBe('150.0000');
    expect(body.totalsByCurrency[0].inputVat).toBe('75.0000');
    expect(body.totalsByCurrency[0].netVat).toBe('75.0000');
  });

  it('shows unposted documents separately and never forces the subledger difference to zero', async () => {
    const companyC = await createCompany(ctx, owner.cookie, { name: 'Rapprochement Fictif Ltée' });
    const accountsC = await getAccounts(ctx, owner.cookie, companyC.id);
    const journalsC = await getJournals(ctx, owner.cookie, companyC.id);
    const customer = await createCustomer(ctx, owner.cookie, companyC.id, 'Client Rapprochement Fictif');
    const invoice = await billingInvoice(ctx, owner.cookie, companyC.id, customer.id, {
      issueDate: '2025-09-15',
      dueDate: '2025-10-15',
    });
    expect(invoice.number).toBeTruthy();

    const control = await api(
      ctx,
      owner.cookie,
      'GET',
      `/api/companies/${companyC.id}/reports/subledger-reconciliation?asOf=2025-09-30`,
    );
    expect(control.statusCode).toBe(200);
    const receivable = control.json().receivable;
    const row = receivable.rows.find((r: any) => r.accountCode === '1100' && r.currency === 'MUR');
    expect(row).toBeTruthy();
    expect(row.glBalance).toBe('0.0000');
    expect(row.postedSubledger).toBe('0.0000');
    expect(row.unpostedDocuments).toBe('1000.0000');
    expect(row.difference).toBe('-1000.0000');
    expect(row.unexplainedDifference).toBe('0.0000');
    expect(row.status).toBe('explained');
    expect(receivable.unpostedDocuments.map((d: any) => d.number)).toContain(invoice.number);

    // A posted entry that has no subledger document behind it is an
    // unexplained difference: the control must report it, never hide it.
    const manual = await api(ctx, owner.cookie, 'POST', `/api/companies/${companyC.id}/entries`, {
      journalId: journalByCode(journalsC, 'OD').id,
      entryDate: '2025-09-16',
      description: 'Encaissement fictif sans pièce de vente',
      status: 'posted',
      lines: [
        { accountId: accountByCode(accountsC, '1010').id, debit: '400.00' },
        { accountId: accountByCode(accountsC, '1100').id, credit: '400.00' },
      ],
    });
    expect(manual.statusCode).toBe(201);

    const after = await api(
      ctx,
      owner.cookie,
      'GET',
      `/api/companies/${companyC.id}/reports/subledger-reconciliation?asOf=2025-09-30`,
    );
    const afterRow = after
      .json()
      .receivable.rows.find((r: any) => r.accountCode === '1100' && r.currency === 'MUR');
    expect(afterRow.glBalance).toBe('-400.0000');
    expect(afterRow.unexplainedDifference).toBe('-400.0000');
    expect(afterRow.status).toBe('unexplained');
    expect(after.json().receivable.controls.hasUnexplainedDifference).toBe(true);
  });

  it('exposes the available credit of supplier credit notes in the list', async () => {
    const supplier = await createSupplier(ctx, owner.cookie, company.id, 'Fournisseur Avoir Liste Fictif');
    const invoiceRes = await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/purchases/documents`, {
      kind: 'invoice',
      supplierId: supplier.id,
      supplierReference: 'FICT-LIST-AVOIR-1',
      issueDate: '2025-09-18',
      dueDate: '2025-10-18',
      currency: 'MUR',
      lines: [
        {
          description: 'Achat fictif',
          quantity: '1',
          unitPrice: '1000.00',
          accountId: accountByCode(accounts, '6100').id,
          vatTreatment: 'out_of_scope',
        },
      ],
    });
    expect(invoiceRes.statusCode).toBe(201);
    const invoiceId = invoiceRes.json().document.id;
    await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/purchases/documents/${invoiceId}/validate`);

    const creditRes = await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/purchases/documents`, {
      kind: 'credit_note',
      supplierId: supplier.id,
      supplierReference: 'FICT-LIST-AVOIR-2',
      issueDate: '2025-09-19',
      currency: 'MUR',
      sourceDocumentId: invoiceId,
      lines: [
        {
          description: 'Avoir fictif',
          quantity: '1',
          unitPrice: '200.00',
          accountId: accountByCode(accounts, '6100').id,
          vatTreatment: 'out_of_scope',
        },
      ],
    });
    expect(creditRes.statusCode).toBe(201);
    await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/purchases/documents/${creditRes.json().document.id}/validate`);

    const list = await api(
      ctx,
      owner.cookie,
      'GET',
      `/api/companies/${company.id}/purchases/documents?kind=credit_note`,
    );
    expect(list.statusCode).toBe(200);
    const row = list.json().documents.find((d: any) => d.id === creditRes.json().document.id);
    expect(row.credit_available).toBe('200.0000');
  });
});
