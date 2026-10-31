import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  accountByCode,
  api,
  closeTestApp,
  createCompany,
  createTestApp,
  registerUser,
  setupCompanyWithChart,
  type TestContext,
  type TestUser,
} from './helpers.js';
import { detectIntent } from '../src/modules/ai/assistant.js';
import { TOOL_BY_KEY } from '../src/modules/ai/tools.js';

/**
 * Mission 11 - purchases & suppliers.
 * Every supplier, invoice, credit note and payment below is fictitious.
 */

describe('purchases & suppliers (mission 11)', () => {
  let ctx: TestContext;
  let owner: TestUser;
  let company: any;
  let accounts: any[];
  let supplier: any;
  let supplierEur: any;
  let seq = 0;

  const expense = () => accountByCode(accounts, '6100').id;
  const asset = () => accountByCode(accounts, '1500').id;

  const createSupplier = async (body: Record<string, unknown>) => {
    const res = await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/purchases/suppliers`, body);
    expect(res.statusCode).toBe(201);
    return res.json().supplier;
  };

  const document = async (
    body: Partial<Record<string, unknown>> & { lines?: any[] } = {},
    cookie = owner.cookie,
  ) => {
    const res = await api(ctx, cookie, 'POST', `/api/companies/${company.id}/purchases/documents`, {
      kind: 'invoice',
      supplierId: supplier.id,
      supplierReference: `FICT-FOUR-${++seq}`,
      issueDate: '2025-08-01',
      dueDate: '2025-08-31',
      currency: 'MUR',
      description: 'Achat fictif de services',
      lines: [
        {
          description: 'Prestation fictive',
          quantity: '1',
          unitPrice: '80000.00',
          accountId: expense(),
          vatTreatment: 'out_of_scope',
        },
      ],
      ...body,
    });
    return res;
  };

  const validated = async (body: Parameters<typeof document>[0] = {}) => {
    const created = await document(body);
    expect(created.statusCode).toBe(201);
    const validatedRes = await api(
      ctx,
      owner.cookie,
      'POST',
      `/api/companies/${company.id}/purchases/documents/${created.json().document.id}/validate`,
    );
    expect(validatedRes.statusCode).toBe(200);
    return validatedRes.json().document;
  };

  const payment = async (body: Record<string, unknown>, cookie = owner.cookie) =>
    api(ctx, cookie, 'POST', `/api/companies/${company.id}/purchases/payments`, {
      supplierId: supplier.id,
      paymentDate: '2025-08-05',
      currency: 'MUR',
      method: 'bank_transfer',
      reference: `REG-FICT-${++seq}`,
      ...body,
    });

  beforeAll(async () => {
    const setup = await setupCompanyWithChart();
    ctx = setup.ctx;
    owner = setup.user;
    company = setup.company;
    accounts = setup.accounts;
    supplier = await createSupplier({
      name: 'Fournisseur Fictif Ltée',
      reference: 'FOUR-FICT-001',
      country: 'MU',
      contactEmail: 'fournisseur@example.test',
      paymentTermsDays: 30,
      payableAccountId: accountByCode(accounts, '2000').id,
    });
    supplierEur = await createSupplier({
      name: 'Foreign Supplier Demo Ltd (fictitious)',
      reference: 'FOUR-FICT-EUR',
      country: 'FR',
      preferredCurrency: 'EUR',
      taxNumber: 'FICT-TAX-EUR-001',
      paymentTermsDays: 15,
    });
  });

  afterAll(async () => {
    await closeTestApp(ctx);
  });

  // 1-2 ---------------------------------------------------------------------
  it('creates a Malian/Mauritian supplier without imposing a French identifier', async () => {
    expect(supplier.country).toBe('MU');
    expect(supplier.registration_number).toBeNull();
    expect(supplier.payable_account_id).toBe(accountByCode(accounts, '2000').id);
  });

  it('rejects a hard supplier duplicate but only warns on an identical name', async () => {
    const hard = await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/purchases/suppliers`, {
      name: 'Autre nom fictif',
      reference: 'four-fict-001',
    });
    expect(hard.statusCode).toBe(409);
    expect(hard.json().error.code).toBe('SUPPLIER_DUPLICATE');

    const warning = await api(
      ctx,
      owner.cookie,
      'POST',
      `/api/companies/${company.id}/purchases/suppliers/duplicates/check`,
      { name: 'Fournisseur Fictif Ltée' },
    );
    expect(warning.statusCode).toBe(200);
    expect(warning.json().duplicates[0].severity).toBe('warning');
  });

  // 3-6 ---------------------------------------------------------------------
  it('records a multi-line purchase invoice and computes exact totals', async () => {
    const res = await document({
      lines: [
        { description: 'Loyer fictif', quantity: '1', unitPrice: '50000.25', accountId: expense(), vatTreatment: 'out_of_scope' },
        { description: 'Matériel fictif', quantity: '2', unitPrice: '15000.1250', accountId: asset(), vatTreatment: 'out_of_scope' },
      ],
    });
    expect(res.statusCode).toBe(201);
    const doc = res.json().document;
    expect(doc.subtotal).toBe('80000.5000');
    expect(doc.tax_total).toBe('0.0000');
    expect(doc.total_amount).toBe('80000.5000');
    expect(doc.lines).toHaveLength(2);
    expect(doc.status).toBe('draft');
    expect(doc.doc_no).toBeNull();
  });

  it('refuses an unverified VAT rate instead of inventing a Mauritian rate', async () => {
    const rate = await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/billing/tax-rates`, {
      code: 'TEST-UNVERIFIED-PURCHASE',
      label: 'Taux fictif non vérifié',
      rate: '15',
      effectiveFrom: '2025-07-01',
      verified: false,
      source: 'Configuration de test fictive',
    });
    expect(rate.statusCode).toBe(201);
    const res = await document({
      lines: [
        {
          description: 'Achat taxé non vérifié',
          quantity: '1',
          unitPrice: '1000',
          accountId: expense(),
          vatTreatment: 'standard',
          vatRateId: rate.json().rate.id,
        },
      ],
    });
    expect(res.statusCode).toBe(409);
    expect(['VAT_NOT_VERIFIED', 'VAT_RATE_NOT_VERIFIED', 'VAT_NOT_CONFIGURED']).toContain(res.json().error.code);
  });

  it('records a tax invoice with explicit recoverability and posts input VAT once', async () => {
    await api(ctx, owner.cookie, 'PATCH', `/api/companies/${company.id}/billing/settings`, { vatEnabled: true });
    const rate = await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/billing/tax-rates`, {
      code: 'TEST-VERIFIED-PURCHASE',
      label: 'Taux fictif vérifié pour test',
      rate: '15',
      effectiveFrom: '2025-07-01',
      verified: true,
      source: 'Configuration de test fictive, aucune règle fiscale',
    });
    expect(rate.statusCode).toBe(201);
    const doc = await validated({
      supplierReference: `FICT-TVA-${++seq}`,
      lines: [
        {
          description: 'Achat taxé récupérable',
          quantity: '1',
          unitPrice: '1000',
          accountId: expense(),
          vatTreatment: 'standard',
          vatRateId: rate.json().rate.id,
          vatRecoverable: true,
        },
      ],
    });
    expect(doc.tax_total).toBe('150.0000');
    expect(doc.total_amount).toBe('1150.0000');
    const proposalRes = await api(
      ctx,
      owner.cookie,
      'POST',
      `/api/companies/${company.id}/purchases/documents/${doc.id}/proposal`,
    );
    expect(proposalRes.statusCode).toBe(201);
    const proposal = proposalRes.json().proposal;
    const vatLine = proposal.lines.find((l: any) => l.accountId === accountByCode(accounts, '1200').id);
    expect(vatLine.debit).toBe('150.0000');
    expect(proposal.lines.reduce((s: number, l: any) => s + Number(l.debit), 0)).toBe(
      proposal.lines.reduce((s: number, l: any) => s + Number(l.credit), 0),
    );
  });

  it('requires an explicit recoverability decision when tax is present', async () => {
    const settings = await api(ctx, owner.cookie, 'GET', `/api/companies/${company.id}/billing/tax-rates`);
    const rate = settings.json().rates.find((r: any) => r.code === 'TEST-VERIFIED-PURCHASE');
    const res = await document({
      lines: [
        {
          description: 'Achat sans décision TVA',
          quantity: '1',
          unitPrice: '100',
          accountId: expense(),
          vatTreatment: 'standard',
          vatRateId: rate.id,
        },
      ],
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('PURCHASE_VAT_RECOVERABILITY_REQUIRED');
  });

  it('accepts an explicitly non-taxable purchase line', async () => {
    const doc = await validated({ supplierReference: `FICT-NOTAX-${++seq}` });
    expect(doc.tax_total).toBe('0.0000');
    expect(doc.total_amount).toBe('80000.0000');
  });

  // 7-9 ---------------------------------------------------------------------
  it('creates and allocates a supplier credit note without modifying the invoice', async () => {
    const invoice = await validated({ supplierReference: `FICT-AVOIR-${++seq}` });
    const creditCreated = await document({
      kind: 'credit_note',
      supplierReference: `AVOIR-FICT-${++seq}`,
      dueDate: null,
      sourceDocumentId: invoice.id,
      reason: 'Retour de matériel fictif',
      total: undefined,
      description: 'Avoir fictif',
      lines: [
        { description: 'Avoir sur achat', quantity: '1', unitPrice: '10000', accountId: expense(), vatTreatment: 'out_of_scope' },
      ],
    });
    expect(creditCreated.statusCode).toBe(201);
    const credit = await api(
      ctx,
      owner.cookie,
      'POST',
      `/api/companies/${company.id}/purchases/documents/${creditCreated.json().document.id}/validate`,
    );
    expect(credit.statusCode).toBe(200);
    const allocation = await api(
      ctx,
      owner.cookie,
      'POST',
      `/api/companies/${company.id}/purchases/credit-notes/${credit.json().document.id}/allocations`,
      { invoiceId: invoice.id, amount: '10000.00', confirm: true, reason: 'Avoir fictif affecté' },
    );
    expect(allocation.statusCode).toBe(201);
    expect(allocation.json().invoice.credited_amount).toBe('10000.0000');
    expect(allocation.json().invoice.outstanding_amount).toBe('70000.0000');
    expect(allocation.json().invoice.total_amount).toBe('80000.0000');
    expect(allocation.json().creditNote.credit_available).toBe('0.0000');
  });

  it('refuses to allocate more than the available credit or the invoice balance', async () => {
    const invoice = await validated({ supplierReference: `FICT-AVOIR2-${++seq}` });
    const created = await document({
      kind: 'credit_note',
      supplierReference: `AVOIR-FICT2-${++seq}`,
      dueDate: null,
      sourceDocumentId: invoice.id,
      lines: [
        { description: 'Petit avoir', quantity: '1', unitPrice: '500', accountId: expense(), vatTreatment: 'out_of_scope' },
      ],
    });
    const credit = await api(
      ctx,
      owner.cookie,
      'POST',
      `/api/companies/${company.id}/purchases/documents/${created.json().document.id}/validate`,
    );
    const res = await api(
      ctx,
      owner.cookie,
      'POST',
      `/api/companies/${company.id}/purchases/credit-notes/${credit.json().document.id}/allocations`,
      { invoiceId: invoice.id, amount: '501.00', confirm: true },
    );
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('PURCHASE_CREDIT_EXCEEDS_AVAILABLE');
  });

  // 10-12 -------------------------------------------------------------------
  it('tracks a 30 000 partial payment on an 80 000 invoice (50 000 remains)', async () => {
    const invoice = await validated({ supplierReference: `FICT-PARTIEL-${++seq}` });
    const res = await payment({
      amount: '30000.00',
      allocations: [{ invoiceId: invoice.id, amount: '30000.00' }],
    });
    expect(res.statusCode).toBe(201);
    const pay = res.json().payment;
    expect(pay.payment_no).toMatch(/^RF-\d{4}-\d{4}$/);
    expect(pay.allocations[0].amount).toBe('30000.0000');
    const detail = await api(
      ctx,
      owner.cookie,
      'GET',
      `/api/companies/${company.id}/purchases/documents/${invoice.id}`,
    );
    expect(detail.json().document.amount_paid).toBe('30000.0000');
    expect(detail.json().document.payment_status).toBe('partial');
    expect(detail.json().document.outstanding_amount).toBe('50000.0000');
  });

  it('settles an invoice only when validated payments cover the full amount', async () => {
    const invoice = await validated({ supplierReference: `FICT-SOLDE-${++seq}` });
    await payment({ amount: '30000.00', allocations: [{ invoiceId: invoice.id, amount: '30000.00' }] });
    const second = await payment({ amount: '50000.00', allocations: [{ invoiceId: invoice.id, amount: '50000.00' }] });
    expect(second.statusCode).toBe(201);
    const detail = await api(
      ctx,
      owner.cookie,
      'GET',
      `/api/companies/${company.id}/purchases/documents/${invoice.id}`,
    );
    expect(detail.json().document.payment_status).toBe('paid');
    expect(detail.json().document.outstanding_amount).toBe('0.0000');
  });

  it('pays two invoices with one grouped payment', async () => {
    const a = await validated({ supplierReference: `FICT-GROUPE-A-${++seq}` });
    const b = await validated({ supplierReference: `FICT-GROUPE-B-${++seq}` });
    const res = await payment({
      amount: '100000.00',
      reference: `REG-GROUPE-${++seq}`,
      allocations: [
        { invoiceId: a.id, amount: '60000.00' },
        { invoiceId: b.id, amount: '40000.00' },
      ],
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().payment.allocations).toHaveLength(2);
  });

  it('records a prepayment as an advance that settles no invoice', async () => {
    const res = await payment({ kind: 'advance', amount: '5000.00', allocations: [] });
    expect(res.statusCode).toBe(201);
    expect(res.json().payment.unallocated_amount).toBe('5000.0000');
    expect(res.json().payment.allocations).toEqual([]);
  });

  it('refuses an allocation above the invoice outstanding', async () => {
    const invoice = await validated({ supplierReference: `FICT-DEPASSEMENT-${++seq}` });
    const res = await payment({ amount: '90000.00', allocations: [{ invoiceId: invoice.id, amount: '90000.00' }] });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('PURCHASE_ALLOCATION_EXCEEDS_INVOICE');
  });

  it('refuses a payment that is not fully allocated and suggests an advance', async () => {
    const invoice = await validated({ supplierReference: `FICT-NONAFFECTE-${++seq}` });
    const res = await payment({ amount: '10000.00', allocations: [{ invoiceId: invoice.id, amount: '8000.00' }] });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('PURCHASE_PAYMENT_UNALLOCATED');
  });

  // 13-16 -------------------------------------------------------------------
  it('rejects a duplicate supplier invoice reference', async () => {
    const reference = `FICT-DOUBLON-${++seq}`;
    const first = await document({ supplierReference: reference });
    expect(first.statusCode).toBe(201);
    const second = await document({ supplierReference: reference });
    expect(second.statusCode).toBe(409);
    expect(second.json().error.code).toBe('PURCHASE_DUPLICATE');
  });

  it('rejects a payment in a different currency instead of converting it', async () => {
    const invoice = await validated({ supplierReference: `FICT-DEVISE-${++seq}` });
    const res = await payment({
      currency: 'EUR',
      exchangeRate: '50.00000000',
      amount: '1000.00',
      allocations: [{ invoiceId: invoice.id, amount: '1000.00' }],
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('PURCHASE_CURRENCY_MISMATCH');
  });

  it('requires an explicit rate for a foreign-currency supplier document', async () => {
    const missing = await document({
      supplierId: supplierEur.id,
      currency: 'EUR',
      exchangeRate: null,
      lines: [
        { description: 'Conseil étranger fictif', quantity: '1', unitPrice: '500', accountId: expense(), vatTreatment: 'out_of_scope' },
      ],
    });
    expect(missing.statusCode).toBe(409);
    expect(missing.json().error.code).toBe('PURCHASE_EXCHANGE_RATE_REQUIRED');
    const explicit = await document({
      supplierId: supplierEur.id,
      currency: 'EUR',
      exchangeRate: '50.00000000',
      lines: [
        { description: 'Conseil étranger fictif', quantity: '1', unitPrice: '500', accountId: expense(), vatTreatment: 'out_of_scope' },
      ],
    });
    expect(explicit.statusCode).toBe(201);
    expect(explicit.json().document.currency).toBe('EUR');
    expect(explicit.json().document.exchange_rate).toBe('50.00000000');
  });

  // 17-19 -------------------------------------------------------------------
  it('posts a purchase invoice exactly once through the existing engine', async () => {
    const doc = await validated({ supplierReference: `FICT-COMPTA-${++seq}` });
    const proposalRes = await api(
      ctx,
      owner.cookie,
      'POST',
      `/api/companies/${company.id}/purchases/documents/${doc.id}/proposal`,
    );
    expect(proposalRes.statusCode).toBe(201);
    const proposalId = proposalRes.json().proposal.id;
    const validatedRes = await api(
      ctx,
      owner.cookie,
      'POST',
      `/api/companies/${company.id}/ai/entry-proposals/${proposalId}/validate`,
      { acceptWarnings: true },
    );
    expect(validatedRes.statusCode).toBe(200);
    const posted = await api(
      ctx,
      owner.cookie,
      'POST',
      `/api/companies/${company.id}/ai/entry-proposals/${proposalId}/post`,
    );
    expect(posted.statusCode).toBe(200);
    const second = await api(
      ctx,
      owner.cookie,
      'POST',
      `/api/companies/${company.id}/ai/entry-proposals/${proposalId}/post`,
    );
    expect(second.statusCode).toBe(409);
    expect(second.json().error.code).toBe('ACCOUNTING_ALREADY_POSTED');
    const detail = await api(
      ctx,
      owner.cookie,
      'GET',
      `/api/companies/${company.id}/purchases/documents/${doc.id}`,
    );
    expect(detail.json().document.accounting_entry_id).toBe(posted.json().entryId);
    const cancel = await api(
      ctx,
      owner.cookie,
      'POST',
      `/api/companies/${company.id}/purchases/documents/${doc.id}/cancel`,
      { reason: 'Tentative fictive' },
    );
    expect(cancel.statusCode).toBe(409);
    expect(cancel.json().error.code).toBe('PURCHASE_ACCOUNTING_POSTED');
  });

  it('posts a supplier payment once and refuses cancellation afterwards', async () => {
    const invoice = await validated({ supplierReference: `FICT-PAIEMENT-COMPTA-${++seq}` });
    const pay = (
      await payment({ amount: '80000.00', allocations: [{ invoiceId: invoice.id, amount: '80000.00' }] })
    ).json().payment;
    const proposalRes = await api(
      ctx,
      owner.cookie,
      'POST',
      `/api/companies/${company.id}/purchases/payments/${pay.id}/proposal`,
    );
    expect(proposalRes.statusCode).toBe(201);
    const proposalId = proposalRes.json().proposal.id;
    await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/ai/entry-proposals/${proposalId}/validate`, {
      acceptWarnings: true,
    });
    const posted = await api(
      ctx,
      owner.cookie,
      'POST',
      `/api/companies/${company.id}/ai/entry-proposals/${proposalId}/post`,
    );
    expect(posted.statusCode).toBe(200);
    const cancel = await api(
      ctx,
      owner.cookie,
      'POST',
      `/api/companies/${company.id}/purchases/payments/${pay.id}/cancel`,
      { reason: 'Tentative fictive' },
    );
    expect(cancel.statusCode).toBe(409);
    expect(cancel.json().error.code).toBe('PURCHASE_ACCOUNTING_POSTED');
  });

  it('cancels an unposted payment without deleting its allocation history', async () => {
    const invoice = await validated({ supplierReference: `FICT-ANNUL-${++seq}` });
    const pay = (
      await payment({ amount: '10000.00', allocations: [{ invoiceId: invoice.id, amount: '10000.00' }] })
    ).json().payment;
    const cancel = await api(
      ctx,
      owner.cookie,
      'POST',
      `/api/companies/${company.id}/purchases/payments/${pay.id}/cancel`,
      { reason: 'Erreur de saisie fictive' },
    );
    expect(cancel.statusCode).toBe(200);
    expect(cancel.json().payment.status).toBe('cancelled');
    expect(cancel.json().payment.allocations[0].cancelledAt).toBeTruthy();
    const detail = await api(
      ctx,
      owner.cookie,
      'GET',
      `/api/companies/${company.id}/purchases/documents/${invoice.id}`,
    );
    expect(detail.json().document.amount_paid).toBe('0.0000');
    expect(detail.json().document.outstanding_amount).toBe('80000.0000');
  });

  // 20-22 -------------------------------------------------------------------
  it('isolates suppliers and documents between companies', async () => {
    const other = await createCompany(ctx, owner.cookie, {
      name: 'Autre société fictive mission 11',
      brn: 'BRN-M11-OTHER',
      functionalCurrency: 'MUR',
    });
    const res = await api(
      ctx,
      owner.cookie,
      'GET',
      `/api/companies/${other.id}/purchases/documents/${(await validated({ supplierReference: `FICT-ISO-${++seq}` })).id}`,
    );
    expect(res.statusCode).toBe(404);
    const list = await api(ctx, owner.cookie, 'GET', `/api/companies/${other.id}/purchases/suppliers`);
    expect(list.statusCode).toBe(200);
    expect(list.json().suppliers).toEqual([]);
  });

  it('denies creation to a read-only viewer', async () => {
    const viewer = await registerUser(ctx);
    const otherCompany = await createCompany(ctx, owner.cookie, {
      name: 'Société permissions fictive',
      brn: 'BRN-M11-PERM',
    });
    await api(ctx, owner.cookie, 'POST', `/api/companies/${otherCompany.id}/members`, {
      email: viewer.email,
      role: 'viewer',
    });
    const res = await api(ctx, viewer.cookie, 'POST', `/api/companies/${otherCompany.id}/purchases/suppliers`, {
      name: 'Tentative lecteur',
    });
    expect(res.statusCode).toBe(403);
  });

  it('denies access to a user who is not a member of the company', async () => {
    const outsider = await registerUser(ctx);
    const otherCompany = await createCompany(ctx, owner.cookie, {
      name: 'Société isolation cabinet fictive',
      brn: 'BRN-M11-ISOCAB',
    });
    const res = await api(
      ctx,
      outsider.cookie,
      'GET',
      `/api/companies/${otherCompany.id}/purchases/suppliers`,
    );
    expect(res.statusCode).toBe(404);
  });

  // 23-25 -------------------------------------------------------------------
  it('produces an aging report per supplier and currency, never mixing currencies', async () => {
    const aging = await api(ctx, owner.cookie, 'GET', `/api/companies/${company.id}/purchases/aging`);
    expect(aging.statusCode).toBe(200);
    expect(Array.isArray(aging.json().aging.summary)).toBe(true);
    for (const group of aging.json().aging.groups) {
      expect(group.currency).toBeTruthy();
      expect(group.outstanding).toMatch(/^\d+\.\d{4}$/);
    }
    const csv = await api(
      ctx,
      owner.cookie,
      'GET',
      `/api/companies/${company.id}/purchases/aging.csv`,
    );
    expect(csv.statusCode).toBe(200);
    expect(csv.body).toContain('Totaux par devise');
  });

  it('flags overdue invoices and computes the supplier balance', async () => {
    const old = await validated({
      supplierReference: `FICT-RETARD-${++seq}`,
      issueDate: '2024-01-01',
      dueDate: '2024-01-31',
    });
    const balance = await api(
      ctx,
      owner.cookie,
      'GET',
      `/api/companies/${company.id}/purchases/suppliers/${supplier.id}/balance?asOf=2025-08-31`,
    );
    expect(balance.statusCode).toBe(200);
    const mur = balance.json().balances.find((b: any) => b.currency === 'MUR');
    expect(mur.overdueCount).toBeGreaterThanOrEqual(1);
    expect(Number(mur.overdue)).toBeGreaterThanOrEqual(80000);
    const detail = await api(
      ctx,
      owner.cookie,
      'GET',
      `/api/companies/${company.id}/purchases/documents/${old.id}`,
    );
    expect(detail.json().document.outstanding_amount).toBe('80000.0000');
  });

  it('keeps an audit trail for supplier, document and payment actions', async () => {
    const doc = await validated({ supplierReference: `FICT-AUDIT-${++seq}` });
    const events = await api(
      ctx,
      owner.cookie,
      'GET',
      `/api/companies/${company.id}/purchases/documents/${doc.id}/events`,
    );
    expect(events.statusCode).toBe(200);
    expect(events.json().events.map((e: any) => e.action)).toContain('document.validated');
    const audit = await ctx.db.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM audit_log WHERE company_id = $1 AND action LIKE 'purchases.%'`,
      [company.id],
    );
    expect(Number(audit.rows[0]!.count)).toBeGreaterThan(0);
  });

  // 26-27 -------------------------------------------------------------------
  it('reconciles a supplier payment with a bank debit without creating a second payment or entry', async () => {
    const bank = await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/bank/accounts`, {
      name: 'Compte fournisseurs fictif',
      bankName: 'Banque Fictive Numérique',
      currency: 'MUR',
      accountId: accountByCode(accounts, '1010').id,
      maskedReference: 'MU00FICTIFSUP0001',
    });
    expect(bank.statusCode).toBe(201);
    const bankId = bank.json().account.id;
    const invoice = await validated({ supplierReference: `FICT-BANQUE-${++seq}` });
    const pay = (
      await payment({ amount: '80000.00', reference: `VIRE-FICT-${++seq}`, allocations: [{ invoiceId: invoice.id, amount: '80000.00' }] })
    ).json().payment;
    const statement = await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/bank/imports`, {
      bankAccountId: bankId,
      fileName: 'releve-fournisseur-fictif.csv',
      contentText: [
        'Date;Libellé;Référence;Débit;Crédit;Devise',
        `2025-08-06;VIRE-FICT-${seq};;80000,00;;MUR`,
      ].join('\r\n'),
    });
    expect(statement.statusCode).toBe(201);
    const transactions = await api(
      ctx,
      owner.cookie,
      'GET',
      `/api/companies/${company.id}/bank/transactions?bankAccountId=${bankId}`,
    );
    const txn = transactions.json().transactions[0];
    const candidates = await api(
      ctx,
      owner.cookie,
      'GET',
      `/api/companies/${company.id}/bank/transactions/${txn.id}/supplier-candidates`,
    );
    expect(candidates.statusCode).toBe(200);
    expect(candidates.json().direction).toBe('out');
    expect(candidates.json().candidates.some((c: any) => c.paymentId === pay.id)).toBe(true);
    const link = await api(
      ctx,
      owner.cookie,
      'POST',
      `/api/companies/${company.id}/bank/transactions/${txn.id}/supplier-payments`,
      { paymentId: pay.id, amount: '80000.00', confirm: true, note: 'Rapprochement fictif' },
    );
    expect(link.statusCode).toBe(201);
    const again = await api(
      ctx,
      owner.cookie,
      'POST',
      `/api/companies/${company.id}/bank/transactions/${txn.id}/supplier-payments`,
      { paymentId: pay.id, amount: '80000.00', confirm: true },
    );
    expect(again.statusCode).toBe(200);
    const payments = await api(
      ctx,
      owner.cookie,
      'GET',
      `/api/companies/${company.id}/purchases/payments?supplierId=${supplier.id}`,
    );
    expect(payments.json().payments.filter((p: any) => p.id === pay.id)).toHaveLength(1);
  });

  it('refuses the bank link when the transaction is a credit, not a debit', async () => {
    const bank = await api(ctx, owner.cookie, 'GET', `/api/companies/${company.id}/bank/accounts`);
    const bankId = bank.json().accounts[0].id;
    const invoice = await validated({ supplierReference: `FICT-CREDIT-BANQUE-${++seq}` });
    const pay = (
      await payment({ amount: '100.00', allocations: [{ invoiceId: invoice.id, amount: '100.00' }] })
    ).json().payment;
    const statement = await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/bank/imports`, {
      bankAccountId: bankId,
      fileName: 'releve-credit-fictif.csv',
      contentText: [
        'Date;Libellé;Référence;Débit;Crédit;Devise',
        `2025-08-07;REMBOURSEMENT;;;100,00;MUR`,
      ].join('\r\n'),
    });
    expect(statement.statusCode).toBe(201);
    const transactions = await api(
      ctx,
      owner.cookie,
      'GET',
      `/api/companies/${company.id}/bank/transactions?bankAccountId=${bankId}`,
    );
    const creditTxn = transactions
      .json()
      .transactions.find((t: any) => t.label === 'REMBOURSEMENT');
    const res = await api(
      ctx,
      owner.cookie,
      'POST',
      `/api/companies/${company.id}/bank/transactions/${creditTxn.id}/supplier-payments`,
      { paymentId: pay.id, amount: '100.00', confirm: true },
    );
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('BANK_DIRECTION_MISMATCH');
  });

  it('keeps read-only users able to consult the supplier ledger', async () => {
    const viewer = await registerUser(ctx);
    const otherCompany = await createCompany(ctx, owner.cookie, {
      name: 'Société lecture fictive',
      brn: 'BRN-M11-READ',
    });
    await api(ctx, owner.cookie, 'POST', `/api/companies/${otherCompany.id}/members`, {
      email: viewer.email,
      role: 'viewer',
    });
    const res = await api(ctx, viewer.cookie, 'GET', `/api/companies/${otherCompany.id}/purchases/aging`);
    expect(res.statusCode).toBe(200);
    expect(res.json().aging.totalsByCurrency).toEqual([]);
  });

  it('routes supplier questions to read-only purchase intents, never to customers', () => {
    expect(detectIntent('Quelles sont les dettes fournisseurs par devise ?').intent).toBe('supplier_balance');
    expect(detectIntent('Montre les factures fournisseurs en retard').intent).toBe('supplier_invoices');
    expect(detectIntent('Y a-t-il des doublons de factures fournisseur ?').intent).toBe('supplier_duplicates');
    expect(detectIntent('Quels règlements fournisseurs récents ?').intent).toBe('supplier_payments');
    const tools = [
      'purchases.suppliers.search',
      'purchases.invoices.search',
      'purchases.aging',
      'purchases.duplicates',
      'purchases.payments.recent',
    ];
    for (const key of tools) {
      expect(TOOL_BY_KEY.get(key)?.readOnly).toBe(true);
      expect(TOOL_BY_KEY.get(key)?.module).toBe('accounting');
    }
  });

});
