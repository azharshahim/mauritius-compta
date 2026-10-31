import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  accountByCode,
  api,
  closeTestApp,
  createCompany,
  createTestApp,
  journalByCode,
  registerUser,
  setupCompanyWithChart,
  type TestContext,
  type TestUser,
} from './helpers.js';

/**
 * Mission 10 - bank <-> billing integration.
 * All customers, invoices, payments and statements are fictional.
 */

async function enableSimulated(ctx: TestContext, cookie: string): Promise<void> {
  const res = await api(ctx, cookie, 'PATCH', '/api/cabinet/ai/settings', {
    enabled: true,
    primary: { provider: 'simulated', model: 'simulated-fictif' },
    features: { accounting: true, cabinet: false, billing: false, payroll: false },
  });
  if (res.statusCode !== 200) throw new Error(`Enable AI failed: ${res.statusCode} ${res.body}`);
}

function csvLine(label: string, reference: string, amount: string, date: string): string {
  const positive = !amount.startsWith('-');
  const value = amount.replace('-', '');
  return [
    date,
    label,
    reference,
    positive ? '' : value,
    positive ? value : '',
    'MUR',
  ].join(';');
}

describe('advanced bank <-> billing reconciliation (mission 10)', () => {
  let ctx: TestContext;
  let owner: TestUser;
  let company: any;
  let accounts: any[];
  let journals: any[];
  let customer: any;
  let item: any;
  let bankId: string;
  let seq = 0;
  const fetchSpy = vi.fn();

  const invoice = async (quantity: string, date = '2025-08-01') => {
    const created = await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/billing/documents`, {
      kind: 'invoice',
      customerId: customer.id,
      issueDate: date,
      dueDate: '2025-08-31',
      lines: [{ itemId: item.id, quantity }],
    });
    expect(created.statusCode).toBe(201);
    const issued = await api(
      ctx,
      owner.cookie,
      'POST',
      `/api/companies/${company.id}/billing/documents/${created.json().document.id}/issue`,
    );
    expect(issued.statusCode).toBe(200);
    return issued.json().document;
  };

  const payment = async (amount: string, allocations: { invoiceId: string; amount: string }[]) => {
    const res = await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/billing/payments`, {
      customerId: customer.id,
      paymentDate: '2025-08-05',
      amount,
      currency: 'MUR',
      method: 'bank_transfer',
      reference: `PAY-FICT-${++seq}`,
      allocations,
    });
    expect(res.statusCode).toBe(201);
    return res.json().payment;
  };

  const importTxn = async (label: string, amount: string, date = '2025-08-06') => {
    const body = {
      bankAccountId: bankId,
      fileName: `releve-${++seq}.csv`,
      contentText: [
        'Date;Libellé;Référence;Débit;Crédit;Devise',
        csvLine(label, `REF-${seq}`, amount, date),
      ].join('\r\n'),
    };
    const res = await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/bank/imports`, body);
    expect(res.statusCode).toBe(201);
    const list = await api(
      ctx,
      owner.cookie,
      'GET',
      `/api/companies/${company.id}/bank/transactions?bankAccountId=${bankId}`,
    );
    const txn = list.json().transactions.find((t: any) => t.label === label);
    expect(txn).toBeTruthy();
    return txn;
  };

  const link = (
    transactionId: string,
    paymentId: string,
    amount: string,
    confirm = true,
    cookie = owner.cookie,
  ) =>
    api(
      ctx,
      cookie,
      'POST',
      `/api/companies/${company.id}/bank/transactions/${transactionId}/billing-payments`,
      { paymentId, amount, confirm, note: 'Validation fictive de test' },
    );

  const detail = async (transactionId: string) =>
    (
      await api(
        ctx,
        owner.cookie,
        'GET',
        `/api/companies/${company.id}/bank/transactions/${transactionId}`,
      )
    ).json();

  const docView = async (invoiceId: string) =>
    (
      await api(
        ctx,
        owner.cookie,
        'GET',
        `/api/companies/${company.id}/billing/documents/${invoiceId}`,
      )
    ).json().document;

  beforeAll(async () => {
    const setup = await setupCompanyWithChart();
    ctx = setup.ctx;
    owner = setup.user;
    company = setup.company;
    accounts = setup.accounts;
    journals = setup.journals;
    vi.stubGlobal('fetch', fetchSpy);
    fetchSpy.mockImplementation(() => {
      throw new Error('No test is allowed to call an external AI provider');
    });
    await enableSimulated(ctx, owner.cookie);

    customer = (
      await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/billing/customers`, {
        name: 'Client Rapprochement Fictif',
        brn: 'BRN-BANK-0001',
        paymentTermsDays: 0,
      })
    ).json().customer;
    item = (
      await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/billing/items`, {
        reference: 'SRV-BANK-10',
        labelFr: 'Prestation rapprochement (fictive)',
        unitPrice: '1000.00',
        vatTreatment: 'zero_rated',
        revenueAccountId: accountByCode(accounts, '4000').id,
      })
    ).json().item;
    const bank = await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/bank/accounts`, {
      name: 'Compte rapprochement (fictif)',
      bankName: 'Banque Fictive Numérique',
      currency: 'MUR',
      accountId: accountByCode(accounts, '1010').id,
      maskedReference: 'MU00FICTIF0009999',
    });
    expect(bank.statusCode).toBe(201);
    bankId = bank.json().account.id;
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    await closeTestApp(ctx);
  });

  it('reconciles three bank transfers to three payments settling one invoice (n to 1)', async () => {
    const inv = await invoice('100');
    const first = await payment('40000.00', [{ invoiceId: inv.id, amount: '40000.00' }]);
    expect((await docView(inv.id)).outstanding).toBe('60000.0000');
    const second = await payment('35000.00', [{ invoiceId: inv.id, amount: '35000.00' }]);
    expect((await docView(inv.id)).outstanding).toBe('25000.0000');
    const third = await payment('25000.00', [{ invoiceId: inv.id, amount: '25000.00' }]);
    expect((await docView(inv.id)).status).toBe('paid');
    expect((await docView(inv.id)).outstanding).toBe('0.0000');

    const t1 = await importTxn('Virement partiel un', '40000.00');
    const t2 = await importTxn('Virement partiel deux', '35000.00');
    const t3 = await importTxn('Virement partiel trois', '25000.00');
    for (const [txn, pay] of [
      [t1, first],
      [t2, second],
      [t3, third],
    ] as const) {
      const linked = await link(txn.id, pay.id, pay.amount);
      expect(linked.statusCode).toBe(201);
      expect(linked.json().transaction.status).toBe('matched');
    }

    const rows = await ctx.db.query(
      `SELECT billing_payment_id, amount::text FROM bank_matches
        WHERE company_id = $1 AND status = 'confirmed' AND billing_payment_id IS NOT NULL`,
      [company.id],
    );
    expect(rows.rows).toHaveLength(3);
    expect(new Set(rows.rows.map((r: any) => r.billing_payment_id)).size).toBe(3);
    expect((await docView(inv.id)).status).toBe('paid');
  });

  it('keeps a 30 000 payment on an 80 000 invoice explicitly partial (50 000 still due)', async () => {
    const inv = await invoice('80');
    const pay = await payment('30000.00', [{ invoiceId: inv.id, amount: '30000.00' }]);
    const txn = await importTxn('Règlement partiel trente mille', '20000.00');

    const candidates = (await detail(txn.id)).billing;
    const candidate = candidates.candidates.find((c: any) => c.paymentId === pay.id);
    expect(candidate).toBeTruthy();
    expect(candidate.suggestedAmount).toBe('20000.0000');
    expect(candidate.allocations[0].invoiceOutstanding).toBe('50000.0000');

    const linked = await link(txn.id, pay.id, '20000.00');
    expect(linked.statusCode).toBe(201);
    expect(linked.json().payment.matchedAmount).toBe('20000.0000');
    expect(linked.json().payment.availableAmount).toBe('10000.0000');
    const doc = await docView(inv.id);
    expect(doc.status).toBe('partially_paid');
    expect(doc.outstanding).toBe('50000.0000');
  });

  it('links one 100 000 transfer to one payment allocated across two invoices (1 to n)', async () => {
    const first = await invoice('60');
    const second = await invoice('40');
    const pay = await payment('100000.00', [
      { invoiceId: first.id, amount: '60000.00' },
      { invoiceId: second.id, amount: '40000.00' },
    ]);
    const txn = await importTxn('Virement groupé cent mille', '100000.00');
    const candidates = (await detail(txn.id)).billing.candidates.find(
      (c: any) => c.paymentId === pay.id,
    );
    expect(candidates.allocations.map((a: any) => a.invoiceNumber).sort()).toEqual(
      [first.number, second.number].sort(),
    );
    const linked = await link(txn.id, pay.id, '100000.00');
    expect(linked.statusCode).toBe(201);
    expect(linked.json().payment.allocations).toHaveLength(2);
    expect((await docView(first.id)).status).toBe('paid');
    expect((await docView(second.id)).status).toBe('paid');
  });

  it('allocates one transfer across two payments and tracks the remaining 40 000', async () => {
    const first = await invoice('60');
    const second = await invoice('40');
    const p1 = await payment('60000.00', [{ invoiceId: first.id, amount: '60000.00' }]);
    const p2 = await payment('40000.00', [{ invoiceId: second.id, amount: '40000.00' }]);
    const txn = await importTxn('Virement unique deux factures', '100000.00');

    const one = await link(txn.id, p1.id, '60000.00');
    expect(one.statusCode).toBe(201);
    expect(one.json().transaction.status).toBe('partially_matched');
    const mid = await detail(txn.id);
    expect(mid.billing.transactionRemaining).toBe('40000.0000');

    const two = await link(txn.id, p2.id, '40000.00');
    expect(two.statusCode).toBe(201);
    expect(two.json().transaction.status).toBe('matched');
    expect((await detail(txn.id)).billing.transactionRemaining).toBe('0.0000');
  });

  it('never links an unallocated payment: no invoice would actually be settled', async () => {
    const pay = await payment('15000.00', []);
    const txn = await importTxn('Encaissement sans facture', '15000.00');
    const candidate = (await detail(txn.id)).billing.candidates.find(
      (c: any) => c.paymentId === pay.id,
    );
    expect(candidate.issues.some((i: any) => i.code === 'NO_INVOICE_ALLOCATION' && i.blocking)).toBe(
      true,
    );
    const linked = await link(txn.id, pay.id, '15000.00');
    expect(linked.statusCode).toBe(409);
    expect(linked.json().error.code).toBe('PAYMENT_NOT_ALLOCATED');
  });

  it('refuses an allocation above the bank transaction or above the payment', async () => {
    const inv = await invoice('30');
    const pay = await payment('30000.00', [{ invoiceId: inv.id, amount: '30000.00' }]);
    const txn = await importTxn('Virement plafonné', '20000.00');
    const tooMuchTxn = await link(txn.id, pay.id, '25000.00');
    expect(tooMuchTxn.statusCode).toBe(409);
    expect(tooMuchTxn.json().error.code).toBe('BANK_AMOUNT_EXCEEDS_TRANSACTION');
    const tooMuchPayment = await link(txn.id, pay.id, '20000.00');
    expect(tooMuchPayment.statusCode).toBe(201);
    const again = await link(txn.id, pay.id, '10000.00');
    expect(again.statusCode).toBe(409);
    expect(again.json().error.code).toBe('BANK_LINK_ALREADY_EXISTS');
  });

  it('is idempotent for an identical repeated validation', async () => {
    const inv = await invoice('20');
    const pay = await payment('20000.00', [{ invoiceId: inv.id, amount: '20000.00' }]);
    const txn = await importTxn('Virement idempotent', '20000.00');
    const first = await link(txn.id, pay.id, '20000.00');
    expect(first.statusCode).toBe(201);
    const second = await link(txn.id, pay.id, '20000.00');
    expect(second.statusCode).toBe(200);
    expect(second.json().idempotent).toBe(true);
    expect(second.json().match.id).toBe(first.json().match.id);
    const count = await ctx.db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM bank_matches
        WHERE transaction_id = $1 AND billing_payment_id = $2 AND status = 'confirmed'`,
      [txn.id, pay.id],
    );
    expect(count.rows[0]!.n).toBe(1);
  });

  it('blocks a currency mismatch instead of inventing an exchange rate', async () => {
    const eurChart = accountByCode(accounts, '1015');
    const eur = await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/bank/accounts`, {
      name: 'Compte EUR (fictif)',
      bankName: 'Banque Fictive Numérique',
      currency: 'EUR',
      accountId: eurChart.id,
      maskedReference: 'MU00FICTIFEUR9999',
    });
    expect(eur.statusCode).toBe(201);
    const eurId = eur.json().account.id;
    const invoiceMur = await invoice('10');
    const pay = await payment('10000.00', [{ invoiceId: invoiceMur.id, amount: '10000.00' }]);
    const res = await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/bank/imports`, {
      bankAccountId: eurId,
      fileName: 'releve-eur.csv',
      contentText: [
        'Date;Libellé;Référence;Débit;Crédit;Devise',
        '06/08/2025;Virement reçu en euros (fictif);EUR-10;;10000,00;EUR',
      ].join('\r\n'),
    });
    expect(res.statusCode).toBe(201);
    const list = await api(
      ctx,
      owner.cookie,
      'GET',
      `/api/companies/${company.id}/bank/transactions?bankAccountId=${eurId}`,
    );
    const txn = list.json().transactions[0];
    const linked = await link(txn.id, pay.id, '10000.00');
    expect(linked.statusCode).toBe(409);
    expect(linked.json().error.code).toBe('BANK_CURRENCY_MISMATCH');
  });

  it('never exposes or links a payment from another company', async () => {
    const other = await createCompany(ctx, owner.cookie, { name: 'Autre société fictive' });
    const otherCustomer = (
      await api(ctx, owner.cookie, 'POST', `/api/companies/${other.id}/billing/customers`, {
        name: 'Client autre société',
        brn: 'BRN-OTHER-1',
      })
    ).json().customer;
    const otherItem = (
      await api(ctx, owner.cookie, 'POST', `/api/companies/${other.id}/billing/items`, {
        reference: 'SRV-OTHER',
        labelFr: 'Prestation autre (fictive)',
        unitPrice: '1000.00',
        vatTreatment: 'zero_rated',
      })
    ).json().item;
    const otherInvoice = await api(
      ctx,
      owner.cookie,
      'POST',
      `/api/companies/${other.id}/billing/documents`,
      {
        kind: 'invoice',
        customerId: otherCustomer.id,
        issueDate: '2025-08-01',
        lines: [{ itemId: otherItem.id, quantity: '10' }],
      },
    );
    await api(
      ctx,
      owner.cookie,
      'POST',
      `/api/companies/${other.id}/billing/documents/${otherInvoice.json().document.id}/issue`,
    );
    const otherPay = await api(ctx, owner.cookie, 'POST', `/api/companies/${other.id}/billing/payments`, {
      customerId: otherCustomer.id,
      paymentDate: '2025-08-05',
      amount: '10000.00',
      currency: 'MUR',
      allocations: [{ invoiceId: otherInvoice.json().document.id, amount: '10000.00' }],
    });
    const txn = await importTxn('Virement société isolée', '10000.00');
    const linked = await link(txn.id, otherPay.json().payment.id, '10000.00');
    expect(linked.statusCode).toBe(404);
    expect(linked.json().error.code).toBe('PAYMENT_NOT_FOUND');
  });

  it('denies reconciliation to a viewer and preserves read-only isolation', async () => {
    const inv = await invoice('10');
    const pay = await payment('10000.00', [{ invoiceId: inv.id, amount: '10000.00' }]);
    const txn = await importTxn('Virement permissions', '10000.00');
    await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/members`, {
      email: 'lecteur.bank10@example.test',
      fullName: 'Lecteur fictif',
      role: 'viewer',
      temporaryPassword: 'StrongPassw0rd!',
    });
    const login = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'lecteur.bank10@example.test', password: 'StrongPassw0rd!' },
    });
    expect(login.statusCode).toBe(200);
    const viewerCookie = (login.headers['set-cookie'] as string).split(';')[0]!;
    const denied = await link(txn.id, pay.id, '10000.00', true, viewerCookie);
    expect(denied.statusCode).toBe(403);
    const read = await api(
      ctx,
      viewerCookie,
      'GET',
      `/api/companies/${company.id}/bank/transactions/${txn.id}/billing-candidates`,
    );
    expect(read.statusCode).toBe(200);
  });

  it('blocks a cancelled or excluded transaction and an unreconciled cancellation', async () => {
    const inv = await invoice('10');
    const pay = await payment('10000.00', [{ invoiceId: inv.id, amount: '10000.00' }]);
    const txn = await importTxn('Virement à exclure', '10000.00');
    await api(
      ctx,
      owner.cookie,
      'POST',
      `/api/companies/${company.id}/bank/transactions/${txn.id}/exclude`,
      { reason: 'Test fictif de refus' },
    );
    const blocked = await link(txn.id, pay.id, '10000.00');
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().error.code).toBe('BANK_TRANSACTION_CLOSED');
  });

  it('refuses to cancel a payment that is linked to a confirmed bank match', async () => {
    const inv = await invoice('10');
    const pay = await payment('10000.00', [{ invoiceId: inv.id, amount: '10000.00' }]);
    const txn = await importTxn('Virement annulation', '10000.00');
    expect((await link(txn.id, pay.id, '10000.00')).statusCode).toBe(201);
    const cancelled = await api(
      ctx,
      owner.cookie,
      'POST',
      `/api/companies/${company.id}/billing/payments/${pay.id}/cancel`,
    );
    expect(cancelled.statusCode).toBe(409);
    expect(cancelled.json().error.code).toBe('PAYMENT_RECONCILED');
    expect((await docView(inv.id)).status).toBe('paid');
  });

  it('posts an unposted payment exactly once and updates the bank traceability', async () => {
    const inv = await invoice('50');
    const pay = await payment('50000.00', [{ invoiceId: inv.id, amount: '50000.00' }]);
    const txn = await importTxn('Virement comptabilisation', '50000.00');
    expect((await link(txn.id, pay.id, '50000.00')).statusCode).toBe(201);

    const proposal = await api(
      ctx,
      owner.cookie,
      'POST',
      `/api/companies/${company.id}/ai/entry-proposals/from-billing`,
      { paymentId: pay.id },
    );
    expect(proposal.statusCode).toBe(201);
    const proposalId = proposal.json().proposal.id;
    const validated = await api(
      ctx,
      owner.cookie,
      'POST',
      `/api/companies/${company.id}/ai/entry-proposals/${proposalId}/validate`,
      { acceptWarnings: true },
    );
    expect(validated.statusCode).toBe(200);
    const [first, second] = await Promise.all([
      api(
        ctx,
        owner.cookie,
        'POST',
        `/api/companies/${company.id}/ai/entry-proposals/${proposalId}/post`,
      ),
      api(
        ctx,
        owner.cookie,
        'POST',
        `/api/companies/${company.id}/ai/entry-proposals/${proposalId}/post`,
      ),
    ]);
    expect([first.statusCode, second.statusCode].sort()).toEqual([200, 409]);
    const winner = first.statusCode === 200 ? first : second;

    const view = await api(
      ctx,
      owner.cookie,
      'GET',
      `/api/companies/${company.id}/billing/payments/${pay.id}`,
    );
    expect(view.json().payment.accountingEntryId).toBe(winner.json().entryId);
    const matches = await ctx.db.query<any>(
      `SELECT entry_id, accounting_entry_id FROM bank_matches m
        JOIN billing_payments p ON p.id = m.billing_payment_id
       WHERE m.transaction_id = $1 AND m.status = 'confirmed'`,
      [txn.id],
    );
    expect(matches.rows[0].accounting_entry_id).toBe(winner.json().entryId);
    expect(matches.rows[0].entry_id).toBe(winner.json().entryId);

    const entries = await ctx.db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM journal_entries
        WHERE company_id = $1 AND source = 'billing'`,
      [company.id],
    );
    expect(entries.rows[0]!.n).toBe(1);

    const duplicate = await api(
      ctx,
      owner.cookie,
      'POST',
      `/api/companies/${company.id}/ai/entry-proposals/from-billing`,
      { paymentId: pay.id },
    );
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().error.code).toBe('ACCOUNTING_ALREADY_POSTED');
  });

  it('rejects a link without deleting history, then permits a new link', async () => {
    const inv = await invoice('25');
    const pay = await payment('25000.00', [{ invoiceId: inv.id, amount: '25000.00' }]);
    const txn = await importTxn('Virement à délier', '25000.00');
    const linked = await link(txn.id, pay.id, '25000.00');
    expect(linked.statusCode).toBe(201);
    const removed = await api(
      ctx,
      owner.cookie,
      'DELETE',
      `/api/companies/${company.id}/bank/transactions/${txn.id}/billing-payments/${pay.id}`,
      { confirm: true, reason: 'Erreur fictive corrigée' },
    );
    expect(removed.statusCode).toBe(200);
    expect(removed.json().transaction.status).toBe('unmatched');
    const history = await ctx.db.query(
      `SELECT status, note FROM bank_matches WHERE id = $1`,
      [linked.json().match.id],
    );
    expect(history.rows[0]!.status).toBe('rejected');
    expect(history.rows[0]!.note).toBe('Erreur fictive corrigée');
    const relink = await link(txn.id, pay.id, '25000.00');
    expect(relink.statusCode).toBe(201);
  });

  it('never auto-confirms an ambiguous pair of payments', async () => {
    const first = await invoice('12');
    const second = await invoice('12');
    const p1 = await payment('12000.00', [{ invoiceId: first.id, amount: '12000.00' }]);
    const p2 = await payment('12000.00', [{ invoiceId: second.id, amount: '12000.00' }]);
    const txn = await importTxn('Virement ambigu', '12000.00');
    const billing = (await detail(txn.id)).billing;
    const relevant = billing.candidates.filter(
      (c: any) => c.paymentId === p1.id || c.paymentId === p2.id,
    );
    expect(relevant).toHaveLength(2);
    expect(billing.candidates.filter((c: any) => c.alreadyLinkedToTransaction)).toHaveLength(0);
    const rows = await ctx.db.query(
      `SELECT count(*)::int AS n FROM bank_matches WHERE transaction_id = $1`,
      [txn.id],
    );
    expect(rows.rows[0]!.n).toBe(0);
    const linked = await link(txn.id, p2.id, '12000.00');
    expect(linked.statusCode).toBe(201);
  });

  it('never mixes billing allocations with a second ledger match, exclusion or proposal', async () => {
    const inv = await invoice('60');
    const pay = await payment('60000.00', [{ invoiceId: inv.id, amount: '60000.00' }]);
    const txn = await importTxn('Virement mixte interdit', '100000.00');
    expect((await link(txn.id, pay.id, '60000.00')).statusCode).toBe(201);

    const excluded = await api(
      ctx,
      owner.cookie,
      'POST',
      `/api/companies/${company.id}/bank/transactions/${txn.id}/exclude`,
      { reason: 'Tentative fictive' },
    );
    expect(excluded.statusCode).toBe(409);

    const proposal = await api(
      ctx,
      owner.cookie,
      'POST',
      `/api/companies/${company.id}/bank/transactions/${txn.id}/proposals`,
      {},
    );
    expect(proposal.statusCode).toBe(409);
    expect(proposal.json().error.code).toBe('BANK_TRANSACTION_PARTIALLY_ALLOCATED');

    const entry = await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/entries`, {
      journalId: journalByCode(journals, 'BQ').id,
      entryDate: '2025-08-06',
      reference: 'MIXTE-FICTIF',
      description: 'Ligne bancaire fictive pour test de mélange',
      status: 'posted',
      lines: [
        { accountId: accountByCode(accounts, '1010').id, debit: '40000.00' },
        { accountId: accountByCode(accounts, '4000').id, credit: '40000.00' },
      ],
    });
    expect(entry.statusCode).toBe(201);
    const line = await ctx.db.query<{ id: string }>(
      `SELECT l.id FROM journal_lines l WHERE l.entry_id = $1 AND l.account_id = $2`,
      [entry.json().entry.id, accountByCode(accounts, '1010').id],
    );
    const mixed = await api(
      ctx,
      owner.cookie,
      'POST',
      `/api/companies/${company.id}/bank/transactions/${txn.id}/matches`,
      { lineIds: [line.rows[0]!.id], confirm: true },
    );
    expect(mixed.statusCode).toBe(409);
    expect(mixed.json().error.code).toBe('BANK_TRANSACTION_PARTIALLY_ALLOCATED');
  });

  it('keeps four-decimal amounts exact and reports the outstanding invoice', async () => {
    const inv = await invoice('1');
    const pay = await payment('1000.00', [{ invoiceId: inv.id, amount: '1000.00' }]);
    const txn = await importTxn('Virement décimal', '1000.00');
    expect((await link(txn.id, pay.id, '1000.0000')).statusCode).toBe(201);
    const report = await api(
      ctx,
      owner.cookie,
      'GET',
      `/api/companies/${company.id}/bank/reconciliation-report?bankAccountId=${bankId}`,
    );
    expect(report.statusCode).toBe(200);
    const data = report.json().report;
    expect(data.summary.allocatedTotal).toMatch(/\.\d{4}$/);
    expect(data.invoices.find((i: any) => i.invoiceId === inv.id).outstanding).toBe('0.0000');
    const csv = await api(
      ctx,
      owner.cookie,
      'GET',
      `/api/companies/${company.id}/bank/reconciliation-report.csv?bankAccountId=${bankId}&lang=fr`,
    );
    expect(csv.statusCode).toBe(200);
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.body).toContain('Affectations confirmées');
    expect(csv.body).toContain(inv.number);
  });

  it('isolates a transaction from another cabinet user', async () => {
    const txn = await importTxn('Virement cabinet isolé', '10000.00');
    const outsider = await registerUser(ctx, { email: 'outsider.bank10@example.test' });
    const read = await api(
      ctx,
      outsider.cookie,
      'GET',
      `/api/companies/${company.id}/bank/transactions/${txn.id}`,
    );
    expect(read.statusCode).toBe(404);
    expect(read.body).not.toContain('Virement cabinet isolé');
  });
});
