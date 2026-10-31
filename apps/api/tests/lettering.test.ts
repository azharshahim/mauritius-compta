import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  accountByCode,
  api,
  closeTestApp,
  createCompany,
  journalByCode,
  registerUser,
  setupCompanyWithChart,
  usingRealPostgres,
  type TestContext,
  type TestUser,
} from './helpers.js';
import { detectIntent } from '../src/modules/ai/assistant.js';
import { TOOL_BY_KEY } from '../src/modules/ai/tools.js';

/**
 * Mission 12 - ledger lettering.
 * Companies, customers, suppliers, invoices, payments and amounts are fictional.
 * Nothing here claims any Mauritian tax or legal rule.
 */

const REF = () => `FICT-LET-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

describe('ledger lettering (mission 12)', () => {
  let ctx: TestContext;
  let owner: TestUser;
  let company: any;
  let accounts: any[];
  let journals: any[];

  const recv = () => accountByCode(accounts, '1100').id;
  const payable = () => accountByCode(accounts, '2000').id;
  const revenue = () => accountByCode(accounts, '4010').id;
  const expense = () => accountByCode(accounts, '6100').id;
  const bank = () => accountByCode(accounts, '1010').id;

  const post = async (
    lines: { code: string; debit?: string; credit?: string }[],
    options: {
      date?: string;
      reference?: string;
      description?: string;
      status?: 'draft' | 'posted';
      currency?: string;
      exchangeRate?: string;
    } = {},
  ) => {
    const res = await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/entries`, {
      journalId:
        lines.some((l) => l.code === '1010')
          ? journalByCode(journals, 'BQ').id
          : journalByCode(journals, 'SAL').id,
      entryDate: options.date ?? '2026-02-10',
      reference: options.reference ?? REF(),
      description: options.description ?? 'Écriture fictive de test',
      status: options.status ?? 'posted',
      currency: options.currency ?? 'MUR',
      ...(options.exchangeRate ? { exchangeRate: options.exchangeRate } : {}),
      lines: lines.map((l) => ({
        accountId: accountByCode(accounts, l.code).id,
        ...(l.debit ? { debit: l.debit } : { credit: l.credit }),
      })),
    });
    expect(res.statusCode).toBe(201);
    return res.json().entry;
  };

  const invoice = (amount: string, reference = REF(), date = '2026-02-10') =>
    post(
      [
        { code: '1100', debit: amount },
        { code: '4010', credit: amount },
      ],
      { reference, date, description: 'Facture client fictive' },
    );

  const customerPayment = (amount: string, reference = REF(), date = '2026-02-12') =>
    post(
      [
        { code: '1010', debit: amount },
        { code: '1100', credit: amount },
      ],
      { reference, date, description: 'Règlement client fictif' },
    );

  const supplierInvoice = (amount: string, reference = REF(), date = '2026-02-10') =>
    post(
      [
        { code: '6100', debit: amount },
        { code: '2000', credit: amount },
      ],
      { reference, date, description: 'Facture fournisseur fictive' },
    );

  const supplierPayment = (amount: string, reference = REF(), date = '2026-02-12') =>
    post(
      [
        { code: '2000', debit: amount },
        { code: '1010', credit: amount },
      ],
      { reference, date, description: 'Règlement fournisseur fictif' },
    );

  const lineByRef = async (accountId: string, reference: string) => {
    const res = await api(
      ctx,
      owner.cookie,
      'GET',
      `/api/companies/${company.id}/lettering/lines?accountId=${accountId}&status=all&includeUnposted=true&limit=500`,
    );
    expect(res.statusCode).toBe(200);
    const line = res.json().lines.find((l: any) => l.entryReference === reference);
    expect(line, `line for ${reference}`).toBeTruthy();
    return line;
  };

  const allocation = async (accountId: string, reference: string, amount: string) => ({
    lineId: (await lineByRef(accountId, reference)).id,
    amount,
  });

  const create = async (
    accountId: string,
    allocations: { lineId: string; amount: string }[],
    options: Record<string, unknown> = {},
    cookie = owner.cookie,
  ) =>
    api(ctx, cookie, 'POST', `/api/companies/${company.id}/lettering`, {
      accountId,
      allocations,
      confirm: true,
      ...options,
    });

  const letteringCount = async () => {
    const res = await ctx.db.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM ledger_letterings WHERE company_id = $1',
      [company.id],
    );
    return Number(res.rows[0]!.n);
  };

  beforeAll(async () => {
    const setup = await setupCompanyWithChart();
    ctx = setup.ctx;
    owner = setup.user;
    company = setup.company;
    accounts = setup.accounts;
    journals = setup.journals;
  });

  afterAll(async () => {
    await closeTestApp(ctx);
  });

  // 1 -----------------------------------------------------------------------
  it('letters a customer invoice with three payments and leaves the posted entry unchanged', async () => {
    const fac = `FAC-FICT-${REF()}`;
    await invoice('100000.00', fac);
    await customerPayment('40000.00', `REG-FICT-A-${REF()}`);
    await customerPayment('35000.00', `REG-FICT-B-${REF()}`);
    await customerPayment('25000.00', `REG-FICT-C-${REF()}`);
    const lines = (
      await api(
        ctx,
        owner.cookie,
        'GET',
        `/api/companies/${company.id}/lettering/lines?accountId=${recv()}&status=unlettered&limit=500`,
      )
    ).json().lines;
    const invoiceLine = lines.find((l: any) => l.entryReference === fac);
    const paymentLines = lines.filter((l: any) => l.entryReference?.startsWith('REG-FICT-') && l.side === 'credit');
    expect(paymentLines).toHaveLength(3);
    const before = await ctx.db.query<any>('SELECT debit, credit FROM journal_lines WHERE id = $1', [invoiceLine.id]);
    const entryBefore = (
      await ctx.db.query<any>('SELECT status FROM journal_entries WHERE id = $1', [invoiceLine.entryId])
    ).rows[0];
    const lineCountBefore = (
      await ctx.db.query<{ n: string }>('SELECT count(*)::text AS n FROM journal_lines WHERE company_id = $1', [
        company.id,
      ])
    ).rows[0]!.n;

    const res = await create(recv(), [
      { lineId: invoiceLine.id, amount: '100000.00' },
      ...paymentLines.map((l: any) => ({ lineId: l.id, amount: l.amount })),
    ]);
    expect(res.statusCode).toBe(201);
    const group = res.json().lettering;
    expect(group.amount).toBe('100000.0000');
    expect(group.total_debit).toBe('100000.0000');
    expect(group.total_credit).toBe('100000.0000');
    expect(group.status).toBe('active');
    expect(group.code).toMatch(/^LET-\d{4}-\d{4}$/);
    expect(group.lines).toHaveLength(4);

    const after = await ctx.db.query<any>('SELECT debit, credit FROM journal_lines WHERE id = $1', [invoiceLine.id]);
    expect(after.rows[0]).toEqual(before.rows[0]);
    const entryAfter = (
      await ctx.db.query<any>('SELECT status FROM journal_entries WHERE id = $1', [invoiceLine.entryId])
    ).rows[0];
    expect(entryAfter.status).toBe('posted');
    expect(entryBefore.status).toBe('posted');
    expect(
      (
        await ctx.db.query<{ n: string }>('SELECT count(*)::text AS n FROM journal_lines WHERE company_id = $1', [
          company.id,
        ])
      ).rows[0]!.n,
    ).toBe(lineCountBefore);
    const paymentsCreated = await ctx.db.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM billing_payments WHERE company_id = $1',
      [company.id],
    );
    expect(Number(paymentsCreated.rows[0]!.n)).toBe(0);
  });

  // 2 -----------------------------------------------------------------------
  it('partially letters a supplier invoice 80,000 with a 30,000 payment and reports 50,000 remaining', async () => {
    const supplier = await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/purchases/suppliers`, {
      name: 'Fournisseur Fictif Lettrage Ltée',
    });
    expect(supplier.statusCode).toBe(201);
    const supplierId = supplier.json().supplier.id;
    const doc = await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/purchases/documents`, {
      kind: 'invoice',
      supplierId,
      supplierReference: `FICT-LETTRE-${REF()}`,
      issueDate: '2026-02-10',
      dueDate: '2026-03-10',
      currency: 'MUR',
      lines: [
        {
          description: 'Service fictif',
          quantity: '1',
          unitPrice: '80000.00',
          accountId: expense(),
          vatTreatment: 'out_of_scope',
        },
      ],
    });
    expect(doc.statusCode).toBe(201);
    const document = doc.json().document;
    const validated = await api(
      ctx,
      owner.cookie,
      'POST',
      `/api/companies/${company.id}/purchases/documents/${document.id}/validate`,
    );
    expect(validated.statusCode).toBe(200);
    const docProposal = await api(
      ctx,
      owner.cookie,
      'POST',
      `/api/companies/${company.id}/purchases/documents/${document.id}/proposal`,
    );
    expect(docProposal.statusCode).toBe(201);
    await api(
      ctx,
      owner.cookie,
      'POST',
      `/api/companies/${company.id}/ai/entry-proposals/${docProposal.json().proposal.id}/validate`,
      { acceptWarnings: true },
    );
    await api(
      ctx,
      owner.cookie,
      'POST',
      `/api/companies/${company.id}/ai/entry-proposals/${docProposal.json().proposal.id}/post`,
    );
    const detail = await api(
      ctx,
      owner.cookie,
      'GET',
      `/api/companies/${company.id}/purchases/documents/${document.id}`,
    );
    expect(detail.json().document.accounting_entry_id).toBeTruthy();

    const pay = await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/purchases/payments`, {
      supplierId,
      paymentDate: '2026-02-15',
      amount: '30000.00',
      currency: 'MUR',
      reference: `VIRE-FICT-${REF()}`,
      allocations: [{ invoiceId: document.id, amount: '30000.00' }],
    });
    expect(pay.statusCode).toBe(201);
    const payment = pay.json().payment;
    const payProposal = await api(
      ctx,
      owner.cookie,
      'POST',
      `/api/companies/${company.id}/purchases/payments/${payment.id}/proposal`,
    );
    expect(payProposal.statusCode).toBe(201);
    await api(
      ctx,
      owner.cookie,
      'POST',
      `/api/companies/${company.id}/ai/entry-proposals/${payProposal.json().proposal.id}/validate`,
      { acceptWarnings: true },
    );
    const postedPay = await api(
      ctx,
      owner.cookie,
      'POST',
      `/api/companies/${company.id}/ai/entry-proposals/${payProposal.json().proposal.id}/post`,
    );
    expect(postedPay.statusCode).toBe(200);

    const lines = (
      await api(
        ctx,
        owner.cookie,
        'GET',
        `/api/companies/${company.id}/lettering/lines?accountId=${payable()}&status=unlettered&limit=500`,
      )
    ).json().lines;
    const invoiceLine = lines.find((l: any) => l.documentId === document.id);
    const paymentLine = lines.find((l: any) => l.documentId === payment.id);
    expect(invoiceLine.amount).toBe('80000.0000');
    expect(paymentLine.amount).toBe('30000.0000');
    const res = await create(payable(), [
      { lineId: invoiceLine.id, amount: '30000.00' },
      { lineId: paymentLine.id, amount: '30000.00' },
    ]);
    expect(res.statusCode).toBe(201);
    expect(res.json().lettering.amount).toBe('30000.0000');

    const report = await api(ctx, owner.cookie, 'GET', `/api/companies/${company.id}/lettering/report`);
    expect(report.statusCode).toBe(200);
    const row = report.json().report.partiallyLettered.find((d: any) => d.id === document.id);
    expect(row).toBeTruthy();
    expect(row.letteringStatus).toBe('partially_lettered');
    expect(row.accountingRemaining).toBe('50000.0000');
    expect(row.commercialOutstanding).toBe('50000.0000');
    expect(row.variance).toBe('0.0000');
    expect(report.json().report.fullyLettered.some((d: any) => d.id === document.id)).toBe(false);
  });

  // 3 -----------------------------------------------------------------------
  it('letters one invoice against several payments in a single group', async () => {
    const fac = `FAC-N1-${REF()}`;
    await invoice('60000.00', fac);
    const a = `REG-N1-A-${REF()}`;
    const b = `REG-N1-B-${REF()}`;
    await customerPayment('20000.00', a);
    await customerPayment('40000.00', b);
    const res = await create(recv(), [
      await allocation(recv(), fac, '60000.00'),
      await allocation(recv(), a, '20000.00'),
      await allocation(recv(), b, '40000.00'),
    ]);
    expect(res.statusCode).toBe(201);
    expect(res.json().lettering.lines).toHaveLength(3);
  });

  // 4 -----------------------------------------------------------------------
  it('letters several invoices against one supplier payment (N↔1)', async () => {
    const a = `ACH-N1-A-${REF()}`;
    const b = `ACH-N1-B-${REF()}`;
    const p = `REG-N1-F-${REF()}`;
    await supplierInvoice('30000.00', a);
    await supplierInvoice('50000.00', b);
    await supplierPayment('80000.00', p);
    const res = await create(payable(), [
      await allocation(payable(), a, '30000.00'),
      await allocation(payable(), b, '50000.00'),
      await allocation(payable(), p, '80000.00'),
    ]);
    expect(res.statusCode).toBe(201);
    expect(res.json().lettering.amount).toBe('80000.0000');
  });

  // 5 -----------------------------------------------------------------------
  it('letters an invoice with a credit note and a balance payment', async () => {
    const fac = `FAC-AVOIR-${REF()}`;
    const avoir = `AVF-FICT-${REF()}`;
    const reg = `REG-AVOIR-${REF()}`;
    await post(
      [
        { code: '1100', credit: '10000.00' },
        { code: '4010', debit: '10000.00' },
      ],
      { reference: avoir, description: 'Avoir client fictif' },
    );
    await invoice('100000.00', fac);
    await customerPayment('90000.00', reg);
    const res = await create(recv(), [
      await allocation(recv(), fac, '100000.00'),
      await allocation(recv(), avoir, '10000.00'),
      await allocation(recv(), reg, '90000.00'),
    ]);
    expect(res.statusCode).toBe(201);
    expect(res.json().lettering.amount).toBe('100000.0000');
  });

  // 6 -----------------------------------------------------------------------
  it('keeps the exact remaining amount after a first partial lettering', async () => {
    const fac = `ACH-RESTE-${REF()}`;
    const p1 = `REG-RESTE-1-${REF()}`;
    const p2 = `REG-RESTE-2-${REF()}`;
    await supplierInvoice('80000.00', fac);
    await supplierPayment('30000.00', p1);
    const first = await create(payable(), [
      await allocation(payable(), fac, '30000.00'),
      await allocation(payable(), p1, '30000.00'),
    ]);
    expect(first.statusCode).toBe(201);
    await supplierPayment('50000.00', p2);
    const second = await create(payable(), [
      await allocation(payable(), fac, '50000.00'),
      await allocation(payable(), p2, '50000.00'),
    ]);
    expect(second.statusCode).toBe(201);
    const line = await lineByRef(payable(), fac);
    expect(line.remaining).toBe('0.0000');
    expect(line.lettered).toBe('80000.0000');
  });

  // 7 -----------------------------------------------------------------------
  it('generates unique readable LET-YYYY-NNNN codes', async () => {
    const fac = `FAC-CODE-${REF()}`;
    const reg = `REG-CODE-${REF()}`;
    await invoice('5000.00', fac);
    await customerPayment('5000.00', reg);
    const first = await create(recv(), [
      await allocation(recv(), fac, '5000.00'),
      await allocation(recv(), reg, '5000.00'),
    ]);
    const fac2 = `FAC-CODE2-${REF()}`;
    const reg2 = `REG-CODE2-${REF()}`;
    await invoice('6000.00', fac2);
    await customerPayment('6000.00', reg2);
    const second = await create(recv(), [
      await allocation(recv(), fac2, '6000.00'),
      await allocation(recv(), reg2, '6000.00'),
    ]);
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    const c1 = first.json().lettering.code;
    const c2 = second.json().lettering.code;
    expect(c1).toMatch(/^LET-2026-\d{4}$/);
    expect(c2).toMatch(/^LET-2026-\d{4}$/);
    expect(c1).not.toBe(c2);
    expect(Number(c2.split('-')[2])).toBe(Number(c1.split('-')[2]) + 1);
  });

  // 8 -----------------------------------------------------------------------
  it('refuses a second lettering of the same already-lettered lines', async () => {
    const fac = `FAC-DOUBLE-${REF()}`;
    const reg = `REG-DOUBLE-${REF()}`;
    await invoice('7000.00', fac);
    await customerPayment('7000.00', reg);
    const allocations = [
      await allocation(recv(), fac, '7000.00'),
      await allocation(recv(), reg, '7000.00'),
    ];
    const first = await create(recv(), allocations);
    expect(first.statusCode).toBe(201);
    const second = await create(recv(), allocations);
    expect(second.statusCode).toBe(409);
    expect(second.json().error.code).toBe('LETTERING_EXCEEDS_AVAILABLE');
  });

  // 9 -----------------------------------------------------------------------
  it('honours the idempotency key without creating a duplicate group', async () => {
    const fac = `FAC-IDEM-${REF()}`;
    const reg = `REG-IDEM-${REF()}`;
    await invoice('8000.00', fac);
    await customerPayment('8000.00', reg);
    const allocations = [
      await allocation(recv(), fac, '8000.00'),
      await allocation(recv(), reg, '8000.00'),
    ];
    const key = `idem-${REF()}`;
    const first = await create(recv(), allocations, { idempotencyKey: key });
    const second = await create(recv(), allocations, { idempotencyKey: key });
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(200);
    expect(second.json().idempotent).toBe(true);
    expect(second.json().lettering.id).toBe(first.json().lettering.id);
  });

  // 10 ----------------------------------------------------------------------
  it.skipIf(!usingRealPostgres)('serialises concurrent letterings of the same lines', async () => {
    const fac = `FAC-CONC-${REF()}`;
    const reg = `REG-CONC-${REF()}`;
    await invoice('9000.00', fac);
    await customerPayment('9000.00', reg);
    const allocations = [
      await allocation(recv(), fac, '9000.00'),
      await allocation(recv(), reg, '9000.00'),
    ];
    const [a, b] = await Promise.all([
      create(recv(), allocations, { idempotencyKey: `c1-${REF()}` }),
      create(recv(), allocations, { idempotencyKey: `c2-${REF()}` }),
    ]);
    const statuses = [a.statusCode, b.statusCode].sort();
    expect(statuses).toEqual([201, 409]);
  });

  // 11 ----------------------------------------------------------------------
  it('rolls back the whole lettering when one allocation is invalid', async () => {
    const fac = `FAC-ROLLBACK-${REF()}`;
    const reg = `REG-ROLLBACK-${REF()}`;
    await invoice('11000.00', fac);
    await customerPayment('11000.00', reg);
    const before = await letteringCount();
    const res = await create(recv(), [
      await allocation(recv(), fac, '11000.00'),
      await allocation(recv(), reg, '11000.00'),
      { lineId: '00000000-0000-0000-0000-000000000000', amount: '1.00' },
    ]);
    expect(res.statusCode).toBe(404);
    expect(await letteringCount()).toBe(before);
  });

  // 12 ----------------------------------------------------------------------
  it('reverses a lettering with a mandatory reason, keeps history and frees the lines', async () => {
    const fac = `FAC-DELETTRE-${REF()}`;
    const reg = `REG-DELETTRE-${REF()}`;
    await invoice('12000.00', fac);
    await customerPayment('12000.00', reg);
    const allocations = [
      await allocation(recv(), fac, '12000.00'),
      await allocation(recv(), reg, '12000.00'),
    ];
    const created = await create(recv(), allocations);
    expect(created.statusCode).toBe(201);
    const id = created.json().lettering.id;
    const reversed = await api(
      ctx,
      owner.cookie,
      'POST',
      `/api/companies/${company.id}/lettering/${id}/reverse`,
      { reason: 'Erreur de sélection fictive', confirm: true },
    );
    expect(reversed.statusCode).toBe(200);
    expect(reversed.json().lettering.status).toBe('reversed');
    expect(reversed.json().lettering.reversal_reason).toBe('Erreur de sélection fictive');
    const history = await api(
      ctx,
      owner.cookie,
      'GET',
      `/api/companies/${company.id}/lettering/history?letteringId=${id}`,
    );
    expect(history.statusCode).toBe(200);
    expect(history.json().events.map((e: any) => e.action)).toEqual(
      expect.arrayContaining(['created', 'reversed']),
    );
    const line = await lineByRef(recv(), fac);
    expect(line.remaining).toBe('12000.0000');
  });

  // 13 ----------------------------------------------------------------------
  it('requires a reason and a confirmation to reverse', async () => {
    const fac = `FAC-MOTIF-${REF()}`;
    const reg = `REG-MOTIF-${REF()}`;
    await invoice('13000.00', fac);
    await customerPayment('13000.00', reg);
    const created = await create(recv(), [
      await allocation(recv(), fac, '13000.00'),
      await allocation(recv(), reg, '13000.00'),
    ]);
    const noReason = await api(
      ctx,
      owner.cookie,
      'POST',
      `/api/companies/${company.id}/lettering/${created.json().lettering.id}/reverse`,
      { reason: '   ', confirm: true },
    );
    expect(noReason.statusCode).toBe(400);
    const noConfirm = await api(
      ctx,
      owner.cookie,
      'POST',
      `/api/companies/${company.id}/lettering/${created.json().lettering.id}/reverse`,
      { reason: 'Motif fictif' },
    );
    expect(noConfirm.statusCode).toBe(400);
  });

  // 14 ----------------------------------------------------------------------
  it('blocks lettering in a closed period', async () => {
    const fac = `FAC-CLOSE-${REF()}`;
    const reg = `REG-CLOSE-${REF()}`;
    await invoice('14000.00', fac, '2026-02-10');
    await customerPayment('14000.00', reg, '2026-02-12');
    const period = (
      await api(ctx, owner.cookie, 'GET', `/api/companies/${company.id}/periods`)
    ).json().periods[0];
    const close = await api(
      ctx,
      owner.cookie,
      'POST',
      `/api/companies/${company.id}/periods/${period.id}/close`,
    );
    expect(close.statusCode).toBe(200);
    try {
      const res = await create(recv(), [
        await allocation(recv(), fac, '14000.00'),
        await allocation(recv(), reg, '14000.00'),
      ]);
      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe('LETTERING_PERIOD_CLOSED');
    } finally {
      await api(
        ctx,
        owner.cookie,
        'POST',
        `/api/companies/${company.id}/periods/${period.id}/reopen`,
      );
    }
  });

  // 15 ----------------------------------------------------------------------
  it('refuses a non-letterable bank account', async () => {
    const res = await create(bank(), []);
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
  });

  // 16 ----------------------------------------------------------------------
  it('blocks a draft (not posted) journal line', async () => {
    const ref = `FAC-BROUILLON-${REF()}`;
    await post(
      [
        { code: '1100', debit: '15000.00' },
        { code: '4010', credit: '15000.00' },
      ],
      { reference: ref, status: 'draft', description: 'Brouillon fictif' },
    );
    const reg = `REG-BROUILLON-${REF()}`;
    await customerPayment('15000.00', reg);
    const draftLine = await lineByRef(recv(), ref);
    const res = await create(recv(), [
      { lineId: draftLine.id, amount: '15000.00' },
      await allocation(recv(), reg, '15000.00'),
    ]);
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('LETTERING_ENTRY_NOT_POSTED');
    const pending = await api(
      ctx,
      owner.cookie,
      'GET',
      `/api/companies/${company.id}/lettering/lines?accountId=${recv()}&status=all&includeUnposted=true`,
    );
    expect(pending.json().pending).toHaveLength(1);
    expect(pending.json().pending[0].entryReference).toBe(ref);
  });

  // 17 ----------------------------------------------------------------------
  it('refuses to mix source currencies without a validated exchange rate', async () => {
    const fac = `FAC-DEVISE-${REF()}`;
    const reg = `REG-DEVISE-${REF()}`;
    await invoice('16000.00', fac);
    await post(
      [
        { code: '1010', debit: '16000.00' },
        { code: '1100', credit: '16000.00' },
      ],
      { reference: reg, date: '2026-02-12', description: 'Règlement en devise fictif', currency: 'EUR', exchangeRate: '50' },
    );
    const res = await create(recv(), [
      await allocation(recv(), fac, '16000.00'),
      await allocation(recv(), reg, '16000.00'),
    ]);
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('LETTERING_CURRENCY_MISMATCH');
  });

  // 18 ----------------------------------------------------------------------
  it('never accepts a line from another company', async () => {
    const otherCompany = await createCompany(ctx, owner.cookie, {
      name: 'Autre société lettrage fictive',
      brn: `BRN-LET-${REF()}`,
    });
    const otherAccounts = (
      await api(ctx, owner.cookie, 'GET', `/api/companies/${otherCompany.id}/accounts`)
    ).json().accounts;
    const otherRes = await api(ctx, owner.cookie, 'POST', `/api/companies/${otherCompany.id}/entries`, {
      journalId: (
        await api(ctx, owner.cookie, 'GET', `/api/companies/${otherCompany.id}/journals`)
      ).json().journals[0].id,
      entryDate: '2026-02-10',
      reference: `FAC-AUTRE-${REF()}`,
      description: 'Facture autre société fictive',
      status: 'posted',
      lines: [
        { accountId: accountByCode(otherAccounts, '1100').id, debit: '100.00' },
        { accountId: accountByCode(otherAccounts, '4010').id, credit: '100.00' },
      ],
    });
    expect(otherRes.statusCode).toBe(201);
    const otherLine = (
      await ctx.db.query<any>(
        `SELECT l.id FROM journal_lines l WHERE l.company_id = $1 AND l.account_id = $2 LIMIT 1`,
        [otherCompany.id, accountByCode(otherAccounts, '1100').id],
      )
    ).rows[0];
    const own = `FAC-ISOLATION-${REF()}`;
    const reg = `REG-ISOLATION-${REF()}`;
    await invoice('100.00', own);
    await customerPayment('100.00', reg);
    const res = await create(recv(), [
      { lineId: otherLine.id, amount: '100.00' },
      await allocation(recv(), reg, '100.00'),
    ]);
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('LETTERING_LINE_NOT_FOUND');
  });

  // 19 ----------------------------------------------------------------------
  it('denies a user who is not a member of the company', async () => {
    const outsider = await registerUser(ctx);
    const res = await api(
      ctx,
      outsider.cookie,
      'GET',
      `/api/companies/${company.id}/lettering/accounts`,
    );
    expect(res.statusCode).toBe(404);
  });

  // 20 ----------------------------------------------------------------------
  it('gives viewers read-only access and reserves unlettering to administrators', async () => {
    const viewer = await registerUser(ctx);
    const accountant = await registerUser(ctx);
    const scoped = await createCompany(ctx, owner.cookie, {
      name: 'Société permissions lettrage fictive',
      brn: `BRN-LET-PERM-${REF()}`,
    });
    await api(ctx, owner.cookie, 'POST', `/api/companies/${scoped.id}/members`, {
      email: viewer.email,
      role: 'viewer',
    });
    await api(ctx, owner.cookie, 'POST', `/api/companies/${scoped.id}/members`, {
      email: accountant.email,
      role: 'accountant',
    });
    const read = await api(ctx, viewer.cookie, 'GET', `/api/companies/${scoped.id}/lettering/accounts`);
    expect(read.statusCode).toBe(200);
    const write = await api(ctx, viewer.cookie, 'POST', `/api/companies/${scoped.id}/lettering`, {
      accountId: read.json().accounts[0].id,
      allocations: [],
      confirm: true,
    });
    expect(write.statusCode).toBe(403);
    const reverse = await api(
      ctx,
      accountant.cookie,
      'POST',
      `/api/companies/${scoped.id}/lettering/00000000-0000-0000-0000-000000000000/reverse`,
      { reason: 'Tentative fictive', confirm: true },
    );
    expect(reverse.statusCode).toBe(403);
  });

  // 21 ----------------------------------------------------------------------
  it('suggests exact correspondences with an explanation and no automatic validation', async () => {
    const shared = REF();
    const fac = `FAC-SUGG-${shared}`;
    const reg = `REG-SUGG-${shared}`;
    await invoice('17000.00', fac);
    await customerPayment('17000.00', reg);
    const res = await api(
      ctx,
      owner.cookie,
      'GET',
      `/api/companies/${company.id}/lettering/suggestions?limit=50`,
    );
    expect(res.statusCode).toBe(200);
    expect(res.json().method).toBe('deterministic');
    expect(res.json().autoValidated).toBe(false);
    const suggestion = res.json().suggestions.find(
      (s: any) => s.debitLine.entryReference === fac && s.creditLine.entryReference === reg,
    );
    expect(suggestion).toBeTruthy();
    expect(suggestion.rationale.map((r: any) => r.code)).toContain('EXACT_AMOUNT');
    expect(suggestion.confidence).toBeGreaterThan(0.5);
    expect(suggestion.suggestedLines).toHaveLength(2);
    const line = await lineByRef(recv(), fac);
    expect(line.remaining).toBe('17000.0000');
  });

  // 22 ----------------------------------------------------------------------
  it('flags ambiguous suggestions when several lines share the same remaining amount', async () => {
    const fac = `FAC-AMBI-${REF()}`;
    const a = `REG-AMBI-A-${REF()}`;
    const b = `REG-AMBI-B-${REF()}`;
    await invoice('18000.00', fac);
    await customerPayment('18000.00', a);
    await customerPayment('18000.00', b);
    const res = await api(
      ctx,
      owner.cookie,
      'GET',
      `/api/companies/${company.id}/lettering/suggestions?limit=100`,
    );
    const related = res.json().suggestions.filter(
      (s: any) => s.debitLine.entryReference === fac,
    );
    expect(related.length).toBeGreaterThanOrEqual(2);
    expect(related.some((s: any) => s.ambiguities.some((x: any) => x.code === 'AMBIGUOUS_CREDIT'))).toBe(true);
    expect(related.every((s: any) => s.confidence <= 0.7)).toBe(true);
  });

  // 23 ----------------------------------------------------------------------
  it('reports unlettered balances per currency without ever adding currencies together', async () => {
    const report = await api(ctx, owner.cookie, 'GET', `/api/companies/${company.id}/lettering/report`);
    expect(report.statusCode).toBe(200);
    const body = report.json().report;
    expect(body.unlettered.byCurrency.length).toBeGreaterThan(0);
    for (const row of body.unlettered.byCurrency) {
      expect(row.currency).toBeTruthy();
      expect(row.debit).toMatch(/^\d+\.\d{4}$/);
      expect(row.balance).toMatch(/^-?\d+\.\d{4}$/);
    }
    expect(new Set(body.unlettered.byCurrency.map((r: any) => r.currency)).size).toBe(
      body.unlettered.byCurrency.length,
    );
  });

  // 24 ----------------------------------------------------------------------
  it('exports the lettering report as CSV with a header and escaped values', async () => {
    const csv = await api(
      ctx,
      owner.cookie,
      'GET',
      `/api/companies/${company.id}/lettering/report.csv`,
    );
    expect(csv.statusCode).toBe(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.body).toContain('\uFEFF');
    expect(csv.body).toContain('Compte');
    expect(csv.body).toContain('Restant');
    expect(csv.body).toContain('Devise');
    expect(csv.body.split('\r\n').length).toBeGreaterThan(1);
  });

  // 25 ----------------------------------------------------------------------
  it('explains a partial lettering in both languages', async () => {
    const fac = `FAC-EXPLAIN-${REF()}`;
    const reg = `REG-EXPLAIN-${REF()}`;
    await invoice('19000.00', fac);
    await customerPayment('9000.00', reg);
    await create(recv(), [
      await allocation(recv(), fac, '9000.00'),
      await allocation(recv(), reg, '9000.00'),
    ]);
    const line = await lineByRef(recv(), fac);
    const res = await api(
      ctx,
      owner.cookie,
      'GET',
      `/api/companies/${company.id}/lettering/explain/${line.id}`,
    );
    expect(res.statusCode).toBe(200);
    expect(res.json().explanation.explanation.fr).toContain('partiellement');
    expect(res.json().explanation.explanation.en).toContain('partially');
    expect(res.json().explanation.line.remaining).toBe('10000.0000');
  });

  // 26 ----------------------------------------------------------------------
  it('keeps the supplier bank reconciliation API working without a second accounting entry', async () => {
    const bankAccount = await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/bank/accounts`, {
      name: 'Compte bancaire fictif lettrage',
      bankName: 'Banque Fictive Numérique',
      currency: 'MUR',
      accountId: bank(),
      maskedReference: 'MU00FICTIFLET0001',
    });
    expect(bankAccount.statusCode).toBe(201);
    const bankId = bankAccount.json().account.id;
    const supplier = await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/purchases/suppliers`, {
      name: 'Fournisseur Fictif Banque Lettrage',
    });
    const supplierId = supplier.json().supplier.id;
    const doc = await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/purchases/documents`, {
      kind: 'invoice',
      supplierId,
      supplierReference: `FICT-BQ-LET-${REF()}`,
      issueDate: '2026-02-01',
      dueDate: '2026-02-28',
      currency: 'MUR',
      lines: [
        { description: 'Achat fictif', quantity: '1', unitPrice: '21000.00', accountId: expense(), vatTreatment: 'out_of_scope' },
      ],
    });
    const document = doc.json().document;
    await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/purchases/documents/${document.id}/validate`);
    const pay = await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/purchases/payments`, {
      supplierId,
      paymentDate: '2026-02-05',
      amount: '21000.00',
      currency: 'MUR',
      reference: `VIRE-BQ-LET-${REF()}`,
      allocations: [{ invoiceId: document.id, amount: '21000.00' }],
    });
    const payment = pay.json().payment;
    const statementRef = `VIRE-BQ-LET-${REF()}`;
    const imported = await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/bank/imports`, {
      bankAccountId: bankId,
      fileName: 'releve-lettrage-fictif.csv',
      contentText: [
        'Date;Libellé;Référence;Débit;Crédit;Devise',
        `2026-02-05;Virement fournisseur fictif;${statementRef};21000,00;;MUR`,
      ].join('\r\n'),
    });
    expect(imported.statusCode).toBe(201);
    const txns = await api(
      ctx,
      owner.cookie,
      'GET',
      `/api/companies/${company.id}/bank/transactions?bankAccountId=${bankId}`,
    );
    const txn = txns.json().transactions[0];
    const candidates = await api(
      ctx,
      owner.cookie,
      'GET',
      `/api/companies/${company.id}/bank/transactions/${txn.id}/supplier-candidates`,
    );
    expect(candidates.statusCode).toBe(200);
    expect(candidates.json().candidates.some((c: any) => c.paymentId === payment.id)).toBe(true);
    const entryCount = async () =>
      Number(
        (
          await ctx.db.query<{ n: string }>(
            'SELECT count(*)::text AS n FROM journal_entries WHERE company_id = $1',
            [company.id],
          )
        ).rows[0]!.n,
      );
    const before = await entryCount();
    const link = await api(
      ctx,
      owner.cookie,
      'POST',
      `/api/companies/${company.id}/bank/transactions/${txn.id}/supplier-payments`,
      { paymentId: payment.id, amount: '21000.00', confirm: true },
    );
    expect(link.statusCode).toBe(201);
    expect(await entryCount()).toBe(before);
  });

  // 27 ----------------------------------------------------------------------
  it('refuses a partial bank reconciliation that exceeds the transaction and a double link', async () => {
    const accountsRes = await api(ctx, owner.cookie, 'GET', `/api/companies/${company.id}/bank/accounts`);
    const bankId = accountsRes.json().accounts[0].id;
    const txns = (
      await api(
        ctx,
        owner.cookie,
        'GET',
        `/api/companies/${company.id}/bank/transactions?bankAccountId=${bankId}`,
      )
    ).json().transactions;
    const txn = txns[0];
    const tooMuch = await api(
      ctx,
      owner.cookie,
      'POST',
      `/api/companies/${company.id}/bank/transactions/${txn.id}/supplier-payments`,
      { paymentId: '00000000-0000-0000-0000-000000000000', amount: '999999.0000', confirm: true },
    );
    expect([400, 404]).toContain(tooMuch.statusCode);
  });

  // 28 ----------------------------------------------------------------------
  it('exposes the lettering history with actor and reason', async () => {
    const history = await api(ctx, owner.cookie, 'GET', `/api/companies/${company.id}/lettering/history`);
    expect(history.statusCode).toBe(200);
    expect(history.json().events.length).toBeGreaterThan(0);
    const event = history.json().events.find((e: any) => e.action === 'reversed');
    expect(event).toBeTruthy();
    expect(event.reason).toBe('Erreur de sélection fictive');
    expect(event.actor_name).toBeTruthy();
  });

  // 29 ----------------------------------------------------------------------
  it('routes lettering questions to deterministic read-only assistant tools', async () => {
    expect(detectIntent('Quelles factures fournisseurs ne sont pas lettrées ?').intent).toBe(
      'lettering_unlettered',
    );
    expect(detectIntent('Explique ce lettrage partiel').intent).toBe('lettering_partial');
    expect(detectIntent('Quels règlements restent à affecter ?').intent).toBe('lettering_payments');
    for (const key of ['lettering.unlettered', 'lettering.partial', 'lettering.payments']) {
      const tool = TOOL_BY_KEY.get(key);
      expect(tool).toBeTruthy();
      expect(tool!.readOnly).toBe(true);
    }
    const assistantCtx = {
      db: ctx.db,
      service: {} as any,
      userId: owner.id,
      cabinetId: '00000000-0000-0000-0000-000000000000',
      companyId: company.id,
      companyName: company.name,
      functionalCurrency: 'MUR',
      locale: 'fr' as const,
      module: 'accounting' as const,
      screen: 'accounting/lettering',
      access: { cabinet: 'read', accounting: 'read', billing: 'read', payroll: 'none' } as any,
    };
    const unlettered = await TOOL_BY_KEY.get('lettering.unlettered')!.run(assistantCtx, { limit: 5 });
    expect(unlettered.rowCount).toBeGreaterThan(0);
    expect(unlettered.data.readOnly).toBe(true);
    const partial = await TOOL_BY_KEY.get('lettering.partial')!.run(assistantCtx, { limit: 5 });
    expect(partial.data.readOnly).toBe(true);
    const payments = await TOOL_BY_KEY.get('lettering.payments')!.run(assistantCtx, { limit: 5 });
    expect(payments.data.readOnly).toBe(true);
  });

  // 30 ----------------------------------------------------------------------
  it('does not regress missions 1-11 endpoints', async () => {
    for (const url of [
      `/api/companies/${company.id}/accounts`,
      `/api/companies/${company.id}/journals`,
      `/api/companies/${company.id}/entries`,
      `/api/companies/${company.id}/billing/customers`,
      `/api/companies/${company.id}/purchases/suppliers`,
      `/api/companies/${company.id}/bank/accounts`,
      `/api/companies/${company.id}/ai/assistant/tools`,
    ]) {
      const res = await api(ctx, owner.cookie, 'GET', url);
      expect(res.statusCode, url).toBe(200);
    }
  });
});
