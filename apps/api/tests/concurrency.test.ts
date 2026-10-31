/**
 * Concurrency tests.
 *
 * They need a real PostgreSQL server (several connections issuing statements at
 * the same time); PGlite runs single-connection, so the suite is skipped unless
 * TEST_DATABASE_URL is set (see the `postgres-tests` GitHub Actions job).
 */
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
  usingRealPostgres,
  type TestContext,
} from './helpers.js';

const suite = usingRealPostgres ? describe : describe.skip;

suite('concurrency (real PostgreSQL)', () => {
  let ctx: TestContext;
  let cookie: string;
  let companyId: string;
  let accounts: any[];
  let journals: any[];
  let bankId = '';
  let scenarioSeq = 0;

  beforeAll(async () => {
    ctx = await createTestApp({ STORAGE_DIR: './.test-storage-concurrency' });
    const user = await registerUser(ctx);
    cookie = user.cookie;
    const company = await createCompany(ctx, cookie, { name: 'Concurrence (fictive)' });
    companyId = company.id;
    accounts = await getAccounts(ctx, cookie, companyId);
    journals = await getJournals(ctx, cookie, companyId);
  });

  afterAll(async () => {
    await closeTestApp(ctx);
  });

  const payload = (date: string, reference?: string) => ({
    journalId: journalByCode(journals, 'SAL').id,
    entryDate: date,
    description: 'Écriture concurrente (fictive)',
    reference,
    status: 'posted',
    lines: [
      { accountId: accountByCode(accounts, '1100').id, debit: '100' },
      { accountId: accountByCode(accounts, '4000').id, credit: '100' },
    ],
  });

  it('allocates unique sequential entry numbers in parallel', async () => {
    const responses = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        api(ctx, cookie, 'POST', `/api/companies/${companyId}/entries`, payload(`2025-09-0${(i % 8) + 1}`)),
      ),
    );
    for (const res of responses) expect(res.statusCode).toBe(201);
    const numbers = responses.map((r) => r.json().entry.entry_no);
    expect(new Set(numbers).size).toBe(numbers.length);
    expect(numbers.every((n) => /^SAL-\d{4}-\d{4}$/.test(n))).toBe(true);
  });

  it('reverses an entry only once when two reversals race', async () => {
    const created = await api(ctx, cookie, 'POST', `/api/companies/${companyId}/entries`, payload('2025-09-15'));
    expect(created.statusCode).toBe(201);
    const entryId = created.json().entry.id;

    const results = await Promise.all([
      api(ctx, cookie, 'POST', `/api/companies/${companyId}/entries/${entryId}/reverse`, {}),
      api(ctx, cookie, 'POST', `/api/companies/${companyId}/entries/${entryId}/reverse`, {}),
    ]);
    const codes = results.map((r) => r.statusCode).sort();
    expect(codes).toEqual([201, 409]);

    const reversals = await ctx.db.query(
      'SELECT id FROM journal_entries WHERE reversal_of_entry_id = $1',
      [entryId],
    );
    expect(reversals.rowCount).toBe(1);
  });

  it('accepts a reference only once when two entries race', async () => {
    const results = await Promise.all([
      api(ctx, cookie, 'POST', `/api/companies/${companyId}/entries`, payload('2025-09-20', 'RACE-REF-1')),
      api(ctx, cookie, 'POST', `/api/companies/${companyId}/entries`, payload('2025-09-21', 'RACE-REF-1')),
    ]);
    const codes = results.map((r) => r.statusCode).sort();
    expect(codes).toEqual([201, 409]);
  });

  const ensureBank = async () => {
    if (bankId) return bankId;
    const created = await api(ctx, cookie, 'POST', `/api/companies/${companyId}/bank/accounts`, {
      name: 'Compte concurrence (fictif)',
      bankName: 'Banque Fictive Concurrence',
      currency: 'MUR',
      accountId: accountByCode(accounts, '1010').id,
    });
    expect(created.statusCode).toBe(201);
    bankId = created.json().account.id;
    return bankId;
  };

  const createInvoice = async (total: string) => {
    const suffix = ++scenarioSeq;
    const customer = (
      await api(ctx, cookie, 'POST', `/api/companies/${companyId}/billing/customers`, {
        name: `Client concurrence ${suffix} (fictif)`,
        brn: `BRN-RACE-${suffix}`,
      })
    ).json().customer;
    const item = (
      await api(ctx, cookie, 'POST', `/api/companies/${companyId}/billing/items`, {
        reference: `SRV-RACE-${suffix}`,
        labelFr: 'Prestation concurrence (fictive)',
        unitPrice: total,
        vatTreatment: 'zero_rated',
      })
    ).json().item;
    const draft = await api(ctx, cookie, 'POST', `/api/companies/${companyId}/billing/documents`, {
      kind: 'invoice',
      customerId: customer.id,
      issueDate: '2025-09-01',
      lines: [{ itemId: item.id, quantity: '1' }],
    });
    expect(draft.statusCode).toBe(201);
    const issued = await api(
      ctx,
      cookie,
      'POST',
      `/api/companies/${companyId}/billing/documents/${draft.json().document.id}/issue`,
    );
    expect(issued.statusCode).toBe(200);
    return { customer, invoice: issued.json().document };
  };

  const createPayment = async (customerId: string, invoiceId: string, total: string) => {
    const res = await api(ctx, cookie, 'POST', `/api/companies/${companyId}/billing/payments`, {
      customerId,
      paymentDate: '2025-09-02',
      amount: total,
      currency: 'MUR',
      method: 'bank_transfer',
      reference: `RACE-PAY-${++scenarioSeq}`,
      allocations: [{ invoiceId, amount: total }],
    });
    expect(res.statusCode).toBe(201);
    return res.json().payment;
  };

  const importTxn = async (amount: string, label: string) => {
    const id = await ensureBank();
    const positive = !amount.startsWith('-');
    const res = await api(ctx, cookie, 'POST', `/api/companies/${companyId}/bank/imports`, {
      bankAccountId: id,
      fileName: `race-${++scenarioSeq}.csv`,
      contentText: [
        'Date;Libellé;Référence;Débit;Crédit;Devise',
        ['2025-09-03', label, `RACE-${scenarioSeq}`, positive ? '' : amount.replace('-', ''), positive ? amount : '', 'MUR'].join(';'),
      ].join('\r\n'),
    });
    expect(res.statusCode).toBe(201);
    const list = await api(
      ctx,
      cookie,
      'GET',
      `/api/companies/${companyId}/bank/transactions?bankAccountId=${id}`,
    );
    return list.json().transactions.find((t: any) => t.label === label);
  };

  it('links one payment to one transaction only once when two humans confirm at the same time', async () => {
    const { customer, invoice } = await createInvoice('20000.00');
    const payment = await createPayment(customer.id, invoice.id, '20000.00');
    const txn = await importTxn('20000.00', 'Concurrence un seul lien');
    const results = await Promise.all([
      api(ctx, cookie, 'POST', `/api/companies/${companyId}/bank/transactions/${txn.id}/billing-payments`, {
        paymentId: payment.id,
        amount: '20000.00',
        confirm: true,
      }),
      api(ctx, cookie, 'POST', `/api/companies/${companyId}/bank/transactions/${txn.id}/billing-payments`, {
        paymentId: payment.id,
        amount: '20000.00',
        confirm: true,
      }),
    ]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 201]);
    const rows = await ctx.db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM bank_matches
        WHERE transaction_id = $1 AND billing_payment_id = $2 AND status = 'confirmed'`,
      [txn.id, payment.id],
    );
    expect(rows.rows[0]!.n).toBe(1);
  });

  it('never allocates two racing payments beyond the bank transaction amount', async () => {
    const first = await createInvoice('60000.00');
    const second = await createInvoice('60000.00');
    const p1 = await createPayment(first.customer.id, first.invoice.id, '60000.00');
    const p2 = await createPayment(second.customer.id, second.invoice.id, '60000.00');
    const txn = await importTxn('100000.00', 'Concurrence plafond transaction');
    const results = await Promise.all([
      api(ctx, cookie, 'POST', `/api/companies/${companyId}/bank/transactions/${txn.id}/billing-payments`, {
        paymentId: p1.id,
        amount: '60000.00',
        confirm: true,
      }),
      api(ctx, cookie, 'POST', `/api/companies/${companyId}/bank/transactions/${txn.id}/billing-payments`, {
        paymentId: p2.id,
        amount: '60000.00',
        confirm: true,
      }),
    ]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([201, 409]);
    const total = await ctx.db.query<{ total: string }>(
      `SELECT COALESCE(SUM(amount), 0)::text AS total FROM bank_matches
        WHERE transaction_id = $1 AND status = 'confirmed'`,
      [txn.id],
    );
    expect(Number(total.rows[0]!.total)).toBeLessThanOrEqual(100000);
  });

  it('never allocates two racing bank transactions beyond the payment amount', async () => {
    const { customer, invoice } = await createInvoice('60000.00');
    const payment = await createPayment(customer.id, invoice.id, '60000.00');
    const t1 = await importTxn('60000.00', 'Concurrence plafond règlement un');
    const t2 = await importTxn('60000.00', 'Concurrence plafond règlement deux');
    const results = await Promise.all([
      api(ctx, cookie, 'POST', `/api/companies/${companyId}/bank/transactions/${t1.id}/billing-payments`, {
        paymentId: payment.id,
        amount: '60000.00',
        confirm: true,
      }),
      api(ctx, cookie, 'POST', `/api/companies/${companyId}/bank/transactions/${t2.id}/billing-payments`, {
        paymentId: payment.id,
        amount: '60000.00',
        confirm: true,
      }),
    ]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([201, 409]);
    const total = await ctx.db.query<{ total: string }>(
      `SELECT COALESCE(SUM(amount), 0)::text AS total FROM bank_matches
        WHERE billing_payment_id = $1 AND status = 'confirmed'`,
      [payment.id],
    );
    expect(Number(total.rows[0]!.total)).toBeLessThanOrEqual(60000);
  });

  const createSupplierInvoice = async (amount: string) => {
    const supplier = await api(ctx, cookie, 'POST', `/api/companies/${companyId}/purchases/suppliers`, {
      name: `Fournisseur concurrence ${++scenarioSeq} (fictif)`,
      reference: `FOUR-RACE-${scenarioSeq}`,
      country: 'MU',
    });
    expect(supplier.statusCode).toBe(201);
    const doc = await api(ctx, cookie, 'POST', `/api/companies/${companyId}/purchases/documents`, {
      kind: 'invoice',
      supplierId: supplier.json().supplier.id,
      supplierReference: `FACT-RACE-${scenarioSeq}`,
      issueDate: '2025-09-03',
      dueDate: '2025-09-30',
      currency: 'MUR',
      lines: [
        {
          description: 'Charge concurrente fictive',
          quantity: '1',
          unitPrice: amount,
          accountId: accountByCode(accounts, '6100').id,
          vatTreatment: 'out_of_scope',
        },
      ],
    });
    expect(doc.statusCode).toBe(201);
    const validated = await api(
      ctx,
      cookie,
      'POST',
      `/api/companies/${companyId}/purchases/documents/${doc.json().document.id}/validate`,
    );
    expect(validated.statusCode).toBe(200);
    return { supplierId: supplier.json().supplier.id, invoice: validated.json().document };
  };

  it('never allocates two racing supplier payments beyond the invoice amount', async () => {
    const { supplierId, invoice } = await createSupplierInvoice('80000.00');
    const makePayment = () =>
      api(ctx, cookie, 'POST', `/api/companies/${companyId}/purchases/payments`, {
        supplierId,
        paymentDate: '2025-09-04',
        amount: '80000.00',
        currency: 'MUR',
        method: 'bank_transfer',
        reference: `RACE-SUP-${++scenarioSeq}`,
        allocations: [{ invoiceId: invoice.id, amount: '80000.00' }],
      });
    const results = await Promise.all([makePayment(), makePayment()]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([201, 409]);
    const paid = await ctx.db.query<{ total: string }>(
      `SELECT COALESCE(SUM(amount), 0)::text AS total FROM purchase_payment_allocations
        WHERE invoice_id = $1 AND cancelled_at IS NULL`,
      [invoice.id],
    );
    expect(Number(paid.rows[0]!.total)).toBeLessThanOrEqual(80000);
  });

  it('links one supplier payment to one bank transaction only once', async () => {
    const { supplierId, invoice } = await createSupplierInvoice('30000.00');
    const pay = await api(ctx, cookie, 'POST', `/api/companies/${companyId}/purchases/payments`, {
      supplierId,
      paymentDate: '2025-09-05',
      amount: '30000.00',
      currency: 'MUR',
      method: 'bank_transfer',
      reference: `RACE-LINK-${++scenarioSeq}`,
      allocations: [{ invoiceId: invoice.id, amount: '30000.00' }],
    });
    expect(pay.statusCode).toBe(201);
    const txn = await importTxn('-30000.00', 'Concurrence fournisseur lien');
    const link = () =>
      api(ctx, cookie, 'POST', `/api/companies/${companyId}/bank/transactions/${txn.id}/supplier-payments`, {
        paymentId: pay.json().payment.id,
        amount: '30000.00',
        confirm: true,
      });
    const results = await Promise.all([link(), link()]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 201]);
    const rows = await ctx.db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM bank_matches
        WHERE transaction_id = $1 AND purchase_payment_id = $2 AND status = 'confirmed'`,
      [txn.id, pay.json().payment.id],
    );
    expect(rows.rows[0]!.n).toBe(1);
  });

  it('never allocates two racing credit notes beyond the invoice amount', async () => {
    const { supplierId, invoice } = await createSupplierInvoice('50000.00');
    const makeCredit = async () => {
      const created = await api(ctx, cookie, 'POST', `/api/companies/${companyId}/purchases/documents`, {
        kind: 'credit_note',
        supplierId,
        supplierReference: `AVOIR-RACE-${++scenarioSeq}`,
        issueDate: '2025-09-06',
        currency: 'MUR',
        sourceDocumentId: invoice.id,
        lines: [
          {
            description: 'Avoir concurrent fictif',
            quantity: '1',
            unitPrice: '50000.00',
            accountId: accountByCode(accounts, '6100').id,
            vatTreatment: 'out_of_scope',
          },
        ],
      });
      expect(created.statusCode).toBe(201);
      const validated = await api(
        ctx,
        cookie,
        'POST',
        `/api/companies/${companyId}/purchases/documents/${created.json().document.id}/validate`,
      );
      expect(validated.statusCode).toBe(200);
      return validated.json().document.id;
    };
    const first = await makeCredit();
    const second = await makeCredit();
    const allocate = (creditNoteId: string) =>
      api(ctx, cookie, 'POST', `/api/companies/${companyId}/purchases/credit-notes/${creditNoteId}/allocations`, {
        invoiceId: invoice.id,
        amount: '50000.00',
        confirm: true,
      });
    const results = await Promise.all([allocate(first), allocate(second)]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([201, 409]);
    const credited = await ctx.db.query<{ total: string }>(
      `SELECT COALESCE(SUM(amount), 0)::text AS total FROM purchase_credit_allocations
        WHERE invoice_id = $1 AND cancelled_at IS NULL`,
      [invoice.id],
    );
    expect(Number(credited.rows[0]!.total)).toBeLessThanOrEqual(50000);
  });

  it('keeps the trial balance balanced with parallel postings', async () => {
    const tb = await api(
      ctx,
      cookie,
      'GET',
      `/api/companies/${companyId}/reports/trial-balance?from=2025-07-01&to=2026-06-30`,
    );
    expect(tb.statusCode).toBe(200);
    expect(tb.json().balanced).toBe(true);
  });
});
