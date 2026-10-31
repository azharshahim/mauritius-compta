import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  api,
  closeTestApp,
  createCompany,
  createTestApp,
  registerUser,
  type TestContext,
  type TestUser,
} from './helpers.js';

/**
 * Mission 6 - billing chain.
 *
 * Every customer, item, rate and document here is fictional. The VAT rate used
 * in the tests is a *test configuration* explicitly flagged as unverified data
 * in its source, never a claim about Mauritian tax law.
 */

const ISSUE_DATE = '2025-09-15';

describe('billing module - customers, items and VAT configuration', () => {
  let ctx: TestContext;
  let owner: TestUser;
  let company: any;

  const createCustomer = (body: Record<string, unknown> = {}) =>
    api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/billing/customers`, {
      name: 'Client Fictif Ltée',
      brn: 'BRN-FICT-0001',
      vatNumber: 'VAT-FICT-0001',
      addressLine1: '1, rue Fictive',
      city: 'Port-Louis',
      country: 'MU',
      contactEmail: 'client.fictif@example.test',
      paymentTermsDays: 30,
      ...body,
    });

  const createItem = (body: Record<string, unknown> = {}) =>
    api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/billing/items`, {
      reference: 'SRV-001',
      labelFr: 'Prestation de conseil (fictive)',
      labelEn: 'Consulting service (fictional)',
      unitPrice: '2500.00',
      unit: 'hour',
      category: 'services',
      vatTreatment: 'zero_rated',
      ...body,
    });

  beforeAll(async () => {
    ctx = await createTestApp();
    owner = await registerUser(ctx);
    company = await createCompany(ctx, owner.cookie, { name: 'Facturation Fictive Ltée' });
  });

  afterAll(async () => {
    await closeTestApp(ctx);
  });

  it('creates a customer, detects an exact homonym and lets a legitimate one through explicitly', async () => {
    const created = await createCustomer();
    expect(created.statusCode).toBe(201);
    const customer = created.json().customer;
    expect(customer.name).toBe('Client Fictif Ltée');
    expect(customer.paymentTermsDays).toBe(30);

    const duplicate = await createCustomer({ brn: 'BRN-FICT-0001' });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().error.code).toBe('CUSTOMER_DUPLICATE');

    const homonym = await createCustomer({
      name: 'Client Fictif Ltée',
      brn: 'BRN-FICT-0002',
      confirmDuplicate: true,
    });
    expect(homonym.statusCode).toBe(201);
    expect(homonym.json().customer.brn).toBe('BRN-FICT-0002');
  });

  it('archives a customer instead of deleting it', async () => {
    const created = await createCustomer({ name: 'Client À Archiver', brn: 'BRN-ARCH-0001' });
    const id = created.json().customer.id;
    const archived = await api(
      ctx,
      owner.cookie,
      'DELETE',
      `/api/companies/${company.id}/billing/customers/${id}`,
    );
    expect(archived.statusCode).toBe(200);
    expect(archived.json()).toEqual({ archived: true });

    const list = await api(ctx, owner.cookie, 'GET', `/api/companies/${company.id}/billing/customers`);
    expect(list.json().customers.map((c: any) => c.id)).not.toContain(id);
    const all = await api(
      ctx,
      owner.cookie,
      'GET',
      `/api/companies/${company.id}/billing/customers?includeArchived=true`,
    );
    expect(all.json().customers.map((c: any) => c.id)).toContain(id);
  });

  it('starts with no VAT rate at all: nothing is seeded or assumed', async () => {
    const rates = await api(ctx, owner.cookie, 'GET', `/api/companies/${company.id}/billing/tax-rates`);
    expect(rates.statusCode).toBe(200);
    expect(rates.json().rates).toEqual([]);
    expect(rates.json().notice).toMatch(/No rate is pre-filled/i);

    await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/billing/items`, {
      reference: 'SRV-VAT',
      labelFr: 'Prestation standard (fictive)',
      unitPrice: '100.00',
      vatTreatment: 'standard',
    });
    const customer = (await createCustomer({ name: 'Client TVA', brn: 'BRN-TVA-0001' })).json().customer;
    const item = (
      await api(ctx, owner.cookie, 'GET', `/api/companies/${company.id}/billing/items?search=SRV-VAT`)
    ).json().items[0];

    const invoice = await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/billing/documents`, {
      kind: 'invoice',
      customerId: customer.id,
      issueDate: ISSUE_DATE,
      lines: [{ itemId: item.id, quantity: '1' }],
    });
    expect(invoice.statusCode).toBe(409);
    expect(invoice.json().error.code).toBe('VAT_NOT_CONFIGURED');
  });

  it('refuses an unverified VAT rate and computes only with a verified, dated configuration', async () => {
    const unverified = await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/billing/tax-rates`, {
      code: 'TEST-UNVERIFIED',
      label: 'Taux de test non vérifié',
      rate: '15',
      effectiveFrom: '2025-07-01',
      verified: false,
      source: 'Configuration de test fictive',
    });
    expect(unverified.statusCode).toBe(201);

    const verified = await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/billing/tax-rates`, {
      code: 'TEST-VERIFIED',
      label: 'Taux de test vérifié (fictif)',
      rate: '15',
      effectiveFrom: '2025-07-01',
      verified: true,
      source: 'Configuration de test fictive, non une règle fiscale',
    });
    expect(verified.statusCode).toBe(201);
    const verifiedRate = verified.json().rate;

    await api(ctx, owner.cookie, 'PATCH', `/api/companies/${company.id}/billing/settings`, {
      vatEnabled: true,
    });

    const customer = (await createCustomer({ name: 'Client TVA Vérifiée', brn: 'BRN-TVA-0002' })).json()
      .customer;
    const base = {
      kind: 'invoice',
      customerId: customer.id,
      issueDate: ISSUE_DATE,
      lines: [{ description: 'Ligne fictive standard', quantity: '1', unitPrice: '100.00' }],
    };

    const refused = await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/billing/documents`, {
      ...base,
      lines: [{ ...base.lines[0], vatRateId: unverified.json().rate.id }],
    });
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error.code).toBe('VAT_RATE_NOT_VERIFIED');

    const computed = await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/billing/documents`, {
      ...base,
      lines: [{ ...base.lines[0], vatRateId: verifiedRate.id }],
    });
    expect(computed.statusCode).toBe(201);
    const document = computed.json().document;
    expect(document.subtotal).toBe('100.0000');
    expect(document.taxTotal).toBe('15.0000');
    expect(document.total).toBe('115.0000');
    expect(document.lines[0].vatTreatment).toBe('standard');
    expect(document.lines[0].vatRate).toBe('15.0000');

    const exempt = await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/billing/documents`, {
      ...base,
      lines: [{ ...base.lines[0], vatTreatment: 'exempt' }],
    });
    expect(exempt.statusCode).toBe(201);
    expect(exempt.json().document.taxTotal).toBe('0.0000');
    expect(exempt.json().document.lines[0].vatTreatment).toBe('exempt');

    // A 0% line and an "unknown" rate stay different: a rate is mandatory for
    // the standard treatment.
    const missingRate = await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/billing/documents`, {
      ...base,
      lines: [{ ...base.lines[0], vatTreatment: 'standard' }],
    });
    expect(missingRate.statusCode).toBe(409);
    expect(missingRate.json().error.code).toBe('VAT_NOT_CONFIGURED');
  });

  it('rejects a rate outside the company and a negative price', async () => {
    const negative = await createItem({ reference: 'NEG-1', unitPrice: '-5' });
    expect(negative.statusCode).toBe(400);

    const otherRate = await createItem({ reference: 'NEG-2', vatRateId: '00000000-0000-0000-0000-000000000000' });
    expect(otherRate.statusCode).toBe(404);
    expect(otherRate.json().error.code).toBe('VAT_RATE_NOT_FOUND');
  });
});

describe('billing module - quotes, invoices, credit notes and numbering', () => {
  let ctx: TestContext;
  let owner: TestUser;
  let company: any;
  let customer: any;
  let item: any;

  const create = (body: Record<string, unknown>) =>
    api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/billing/documents`, body);

  beforeAll(async () => {
    ctx = await createTestApp();
    owner = await registerUser(ctx);
    company = await createCompany(ctx, owner.cookie, { name: 'Chaîne Facturation Fictive' });
    customer = (
      await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/billing/customers`, {
        name: 'Client Chaîne Fictif',
        brn: 'BRN-CHAIN-0001',
        paymentTermsDays: 15,
      })
    ).json().customer;
    item = (
      await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/billing/items`, {
        reference: 'SRV-CHAIN',
        labelFr: 'Journée de conseil (fictive)',
        unitPrice: '2500.00',
        vatTreatment: 'zero_rated',
      })
    ).json().item;
  });

  afterAll(async () => {
    await closeTestApp(ctx);
  });

  it('creates a quote, issues it with a sequential number and converts it once', async () => {
    const quote = await create({
      kind: 'quote',
      customerId: customer.id,
      issueDate: ISSUE_DATE,
      validUntil: '2025-10-15',
      lines: [{ itemId: item.id, quantity: '2' }],
    });
    expect(quote.statusCode).toBe(201);
    const quoteDoc = quote.json().document;
    expect(quoteDoc.number).toBeNull();
    expect(quoteDoc.total).toBe('5000.0000');
    expect(quoteDoc.status).toBe('draft');

    const issued = await api(
      ctx,
      owner.cookie,
      'POST',
      `/api/companies/${company.id}/billing/documents/${quoteDoc.id}/issue`,
    );
    expect(issued.statusCode).toBe(200);
    expect(issued.json().document.number).toBe('DEV-2025-0001');
    expect(issued.json().document.status).toBe('sent');

    const invoice = await api(
      ctx,
      owner.cookie,
      'POST',
      `/api/companies/${company.id}/billing/documents/${quoteDoc.id}/convert`,
      {},
    );
    expect(invoice.statusCode).toBe(201);
    const invoiceDoc = invoice.json().document;
    expect(invoiceDoc.kind).toBe('invoice');
    expect(invoiceDoc.sourceDocumentId).toBe(quoteDoc.id);
    expect(invoiceDoc.total).toBe('5000.0000');

    const second = await api(
      ctx,
      owner.cookie,
      'POST',
      `/api/companies/${company.id}/billing/documents/${quoteDoc.id}/convert`,
      {},
    );
    expect(second.statusCode).toBe(409);
    expect(second.json().error.code).toBe('QUOTE_ALREADY_CONVERTED');
  });

  it('numbers concurrently without duplicates and locks an issued invoice', async () => {
    const drafts = await Promise.all(
      Array.from({ length: 5 }, (_, index) =>
        create({
          kind: 'invoice',
          customerId: customer.id,
          issueDate: '2025-10-0' + (index + 1),
          lines: [{ itemId: item.id, quantity: '1' }],
        }),
      ),
    );
    for (const draft of drafts) expect(draft.statusCode).toBe(201);

    const issued = await Promise.all(
      drafts.map((draft) =>
        api(
          ctx,
          owner.cookie,
          'POST',
          `/api/companies/${company.id}/billing/documents/${draft.json().document.id}/issue`,
        ),
      ),
    );
    const numbers = issued.map((res) => res.json().document.number);
    expect(issued.every((res) => res.statusCode === 200)).toBe(true);
    expect(new Set(numbers).size).toBe(5);
    expect(numbers.every((n) => /^FAC-2025-\d{4}$/.test(n))).toBe(true);

    const first = issued[0]!.json().document;
    const patch = await api(
      ctx,
      owner.cookie,
      'PATCH',
      `/api/companies/${company.id}/billing/documents/${first.id}`,
      { notes: 'modification interdite' },
    );
    expect(patch.statusCode).toBe(409);
    expect(patch.json().error.code).toBe('DOCUMENT_LOCKED');

    const cancel = await api(
      ctx,
      owner.cookie,
      'POST',
      `/api/companies/${company.id}/billing/documents/${first.id}/cancel-draft`,
    );
    expect(cancel.statusCode).toBe(409);
  });

  it('supports partial credit notes with quantity and amount controls', async () => {
    const invoice = await create({
      kind: 'invoice',
      customerId: customer.id,
      issueDate: '2025-11-03',
      lines: [{ itemId: item.id, quantity: '2' }],
    });
    const invoiceId = invoice.json().document.id;
    const issuedInvoice = await api(
      ctx,
      owner.cookie,
      'POST',
      `/api/companies/${company.id}/billing/documents/${invoiceId}/issue`,
    );
    expect(issuedInvoice.statusCode).toBe(200);

    const credit = await create({
      kind: 'credit_note',
      customerId: customer.id,
      issueDate: '2025-11-05',
      sourceDocumentId: invoiceId,
      lines: [{ itemId: item.id, quantity: '1' }],
    });
    expect(credit.statusCode).toBe(201);
    expect(credit.json().document.total).toBe('2500.0000');

    const tooMuch = await create({
      kind: 'credit_note',
      customerId: customer.id,
      issueDate: '2025-11-06',
      sourceDocumentId: invoiceId,
      lines: [{ description: 'Avoir fictif trop élevé', quantity: '6', unitPrice: '1000.00', vatTreatment: 'exempt' }],
    });
    expect(tooMuch.statusCode).toBe(409);
    expect(tooMuch.json().error.code).toBe('CREDIT_EXCEEDS_INVOICE');

    const creditId = credit.json().document.id;
    const credited = await api(
      ctx,
      owner.cookie,
      'POST',
      `/api/companies/${company.id}/billing/documents/${creditId}/issue`,
    );
    expect(credited.statusCode).toBe(200);
    expect(credited.json().document.number).toBe('AV-2025-0001');

    const view = await api(
      ctx,
      owner.cookie,
      'GET',
      `/api/companies/${company.id}/billing/documents/${invoiceId}`,
    );
    expect(view.json().document.creditedAmount).toBe('2500.0000');
    expect(view.json().document.outstanding).toBe('2500.0000');
    expect(view.json().document.status).toBe('partially_paid');
  });

  it('exposes sequential numbering per company and year without gaps', async () => {
    const list = await api(
      ctx,
      owner.cookie,
      'GET',
      `/api/companies/${company.id}/billing/documents?kind=invoice`,
    );
    const numbers = list
      .json()
      .documents.map((d: any) => d.number)
      .filter(Boolean)
      .sort();
    expect(numbers[0]).toBe('FAC-2025-0001');
    const sequences = numbers.map((n: string) => Number(n.split('-')[2]));
    for (let i = 1; i < sequences.length; i += 1) {
      expect(sequences[i]).toBe(sequences[i - 1]! + 1);
    }
  });

  it('produces a real PDF and refuses to export a draft', async () => {
    const draft = await create({
      kind: 'invoice',
      customerId: customer.id,
      issueDate: '2025-11-20',
      lines: [{ itemId: item.id, quantity: '1' }],
    });
    const draftId = draft.json().document.id;
    const refused = await api(
      ctx,
      owner.cookie,
      'GET',
      `/api/companies/${company.id}/billing/documents/${draftId}/pdf`,
    );
    expect(refused.statusCode).toBe(409);

    await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/billing/documents/${draftId}/issue`);
    const pdf = await api(
      ctx,
      owner.cookie,
      'GET',
      `/api/companies/${company.id}/billing/documents/${draftId}/pdf`,
    );
    expect(pdf.statusCode).toBe(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');
    const buffer = pdf.rawPayload;
    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
    expect(buffer.length).toBeGreaterThan(1500);

    const en = await api(
      ctx,
      owner.cookie,
      'GET',
      `/api/companies/${company.id}/billing/documents/${draftId}/pdf?lang=en`,
    );
    expect(en.statusCode).toBe(200);
    expect(en.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('detects duplicates deterministically at three levels', async () => {
    const first = await create({
      kind: 'invoice',
      customerId: customer.id,
      issueDate: '2025-12-01',
      lines: [{ itemId: item.id, quantity: '4' }],
    });
    const firstId = first.json().document.id;
    await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/billing/documents/${firstId}/issue`);

    const second = await create({
      kind: 'invoice',
      customerId: customer.id,
      issueDate: '2025-12-02',
      lines: [{ itemId: item.id, quantity: '4' }],
    });
    expect(second.statusCode).toBe(201);
    expect(second.json().duplicates.level).toBe('probable');

    const sameNumber = await api(
      ctx,
      owner.cookie,
      'POST',
      `/api/companies/${company.id}/billing/duplicates/check`,
      {
        kind: 'invoice',
        customerId: customer.id,
        docNo: first.json().document.number ?? 'FAC-2025-0001',
        issueDate: '2025-12-03',
        totalAmount: '10000.00',
        currency: 'MUR',
      },
    );
    expect(sameNumber.statusCode).toBe(200);
    expect(sameNumber.json().check.level).toBe('certain');
    expect(sameNumber.json().automaticAction).toBe('none');
  });
});

describe('billing module - payments, aging and permissions', () => {
  let ctx: TestContext;
  let owner: TestUser;
  let company: any;
  let customer: any;
  let item: any;
  let invoice: any;

  const pay = (body: Record<string, unknown>) =>
    api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/billing/payments`, body);

  beforeAll(async () => {
    ctx = await createTestApp();
    owner = await registerUser(ctx);
    company = await createCompany(ctx, owner.cookie, { name: 'Encaissements Fictifs Ltée' });
    customer = (
      await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/billing/customers`, {
        name: 'Client Encaissement Fictif',
        brn: 'BRN-PAY-0001',
        paymentTermsDays: 0,
      })
    ).json().customer;
    item = (
      await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/billing/items`, {
        reference: 'SRV-PAY',
        labelFr: 'Prestation facturable (fictive)',
        unitPrice: '1000.00',
        vatTreatment: 'zero_rated',
      })
    ).json().item;
    const created = await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/billing/documents`, {
      kind: 'invoice',
      customerId: customer.id,
      issueDate: '2025-09-01',
      dueDate: '2025-09-01',
      lines: [{ itemId: item.id, quantity: '5' }],
    });
    invoice = created.json().document;
    await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/billing/documents/${invoice.id}/issue`);
  });

  afterAll(async () => {
    await closeTestApp(ctx);
  });

  it('records a partial payment, then a full payment, and keeps the balance exact', async () => {
    const partial = await pay({
      customerId: customer.id,
      paymentDate: '2025-09-10',
      amount: '2000.00',
      method: 'bank_transfer',
      reference: 'TRX-FICT-001',
      allocations: [{ invoiceId: invoice.id, amount: '2000.00' }],
    });
    expect(partial.statusCode).toBe(201);
    expect(partial.json().payment.unallocatedAmount).toBe('0.0000');
    expect(partial.json().entryCreated).toBe(false);

    let view = await api(
      ctx,
      owner.cookie,
      'GET',
      `/api/companies/${company.id}/billing/documents/${invoice.id}`,
    );
    expect(view.json().document.status).toBe('partially_paid');
    expect(view.json().document.outstanding).toBe('3000.0000');

    const over = await pay({
      customerId: customer.id,
      paymentDate: '2025-09-11',
      amount: '3500.00',
      method: 'cash',
      reference: 'TRX-FICT-002',
      allocations: [{ invoiceId: invoice.id, amount: '3000.00' }],
    });
    expect(over.statusCode).toBe(201);
    expect(over.json().payment.unallocatedAmount).toBe('500.0000');
    expect(over.json().payment.allocations[0].amount).toBe('3000.0000');

    view = await api(
      ctx,
      owner.cookie,
      'GET',
      `/api/companies/${company.id}/billing/documents/${invoice.id}`,
    );
    expect(view.json().document.status).toBe('paid');
    expect(view.json().document.outstanding).toBe('0.0000');

    const balance = await api(
      ctx,
      owner.cookie,
      'GET',
      `/api/companies/${company.id}/billing/customers/${customer.id}`,
    );
    expect(balance.json().balance.invoiced).toBe('5000.0000');
    expect(balance.json().balance.unallocated).toBe('500.0000');
    expect(balance.json().balance.balance).toBe('-500.0000');
  });

  it('refuses to allocate more than the outstanding amount or twice the same invoice', async () => {
    const second = await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/billing/documents`, {
      kind: 'invoice',
      customerId: customer.id,
      issueDate: '2025-10-01',
      lines: [{ itemId: item.id, quantity: '2' }],
    });
    const secondId = second.json().document.id;
    await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/billing/documents/${secondId}/issue`);

    const tooMuch = await pay({
      customerId: customer.id,
      paymentDate: '2025-10-02',
      amount: '5000.00',
      allocations: [{ invoiceId: secondId, amount: '5000.00' }],
    });
    expect(tooMuch.statusCode).toBe(409);
    expect(tooMuch.json().error.code).toBe('ALLOCATION_EXCEEDS_INVOICE');

    const twice = await pay({
      customerId: customer.id,
      paymentDate: '2025-10-02',
      amount: '1000.00',
      allocations: [
        { invoiceId: secondId, amount: '500.00' },
        { invoiceId: secondId, amount: '500.00' },
      ],
    });
    expect(twice.statusCode).toBe(400);
    expect(twice.json().error.code).toBe('ALLOCATION_INVALID');
  });

  it('builds the aging balance and lists overdue invoices', async () => {
    const aging = await api(
      ctx,
      owner.cookie,
      'GET',
      `/api/companies/${company.id}/billing/aging?asOf=2025-12-15&customerId=${customer.id}`,
    );
    expect(aging.statusCode).toBe(200);
    expect(aging.json().rows).toHaveLength(1);
    const buckets = aging.json().rows[0].buckets;
    expect(buckets.days61to90).toBe('2000.0000');
    expect(buckets.total).toBe('2000.0000');

    const overdue = await api(ctx, owner.cookie, 'GET', `/api/companies/${company.id}/billing/overdue`);
    expect(overdue.statusCode).toBe(200);
    expect(overdue.json().invoices.length).toBeGreaterThanOrEqual(1);
  });

  it('cancels an unposted payment and restores the invoice balance', async () => {
    const third = await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/billing/documents`, {
      kind: 'invoice',
      customerId: customer.id,
      issueDate: '2025-10-10',
      lines: [{ itemId: item.id, quantity: '1' }],
    });
    const thirdId = third.json().document.id;
    await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/billing/documents/${thirdId}/issue`);
    const payment = await pay({
      customerId: customer.id,
      paymentDate: '2025-10-11',
      amount: '1000.00',
      allocations: [{ invoiceId: thirdId, amount: '1000.00' }],
    });
    const paymentId = payment.json().payment.id;
    const cancelled = await api(
      ctx,
      owner.cookie,
      'POST',
      `/api/companies/${company.id}/billing/payments/${paymentId}/cancel`,
    );
    expect(cancelled.statusCode).toBe(200);
    const view = await api(
      ctx,
      owner.cookie,
      'GET',
      `/api/companies/${company.id}/billing/documents/${thirdId}`,
    );
    expect(view.json().document.amountPaid).toBe('0.0000');
    expect(view.json().document.status).toBe('issued');
  });

  it('enforces billing permissions and keeps companies isolated', async () => {
    const accountant = await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/members`, {
      email: 'accountant.billing@example.test',
      fullName: 'Comptable fictif',
      role: 'accountant',
      temporaryPassword: 'StrongPassw0rd!',
    });
    expect(accountant.statusCode).toBe(201);
    const login = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'accountant.billing@example.test', password: 'StrongPassw0rd!' },
    });
    const raw = login.headers['set-cookie'];
    const accountantCookie = (Array.isArray(raw) ? raw[0] : raw)!.split(';')[0]!;

    const readable = await api(
      ctx,
      accountantCookie,
      'GET',
      `/api/companies/${company.id}/billing/documents`,
    );
    expect(readable.statusCode).toBe(200);
    const forbidden = await api(
      ctx,
      accountantCookie,
      'POST',
      `/api/companies/${company.id}/billing/customers`,
      { name: 'Client interdit', brn: 'BRN-X-1' },
    );
    expect(forbidden.statusCode).toBe(403);
    expect(forbidden.json().error.code).toBe('MODULE_FORBIDDEN');

    const outsider = await registerUser(ctx);
    const other = await createCompany(ctx, outsider.cookie, { name: 'Autre société fictive' });
    const leaked = await api(ctx, outsider.cookie, 'GET', `/api/companies/${company.id}/billing/customers`);
    expect(leaked.statusCode).toBe(404);
    const own = await api(ctx, outsider.cookie, 'GET', `/api/companies/${other.id}/billing/customers`);
    expect(own.statusCode).toBe(200);
    expect(own.json().customers).toEqual([]);
  });

  it('summarises the module without claiming MRA e-invoicing', async () => {
    const summary = await api(ctx, owner.cookie, 'GET', `/api/companies/${company.id}/billing/summary`);
    expect(summary.statusCode).toBe(200);
    const body = summary.json();
    expect(body.available).toBe(true);
    expect(body.capabilities.numbering).toBe(true);
    expect(body.capabilities.postingToAccounting).toBe(true);
    expect(body.capabilities.mraEInvoicing).toBe(false);
    expect(body.capabilities.postingMode).toBe('human_validation_required');
    // No document is posted to accounting just because it was issued.
    expect(body.postedDocuments).toBe(0);
  });
});
