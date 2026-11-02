import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  accountByCode,
  api,
  closeTestApp,
  setupCompanyWithChart,
  type TestContext,
  type TestUser,
} from './helpers.js';
import { accountForRole } from '../src/modules/billing/service.js';

/**
 * Mission 43 - accounting integrity & bank reconciliation.
 * Every customer, invoice, bank and statement below is fictional.
 */

const S = ';';

function statement(rows: string[]): string {
  return ['Date;Libellé;Référence;Débit;Crédit;Devise;Solde', ...rows].join('\r\n');
}

describe('mission 43 - bank period reports, counters and receipt-to-payment', () => {
  let ctx: TestContext;
  let owner: TestUser;
  let company: any;
  let accounts: any[];
  let customer: any;
  let item: any;
  let seq = 0;

  const bankAccount = async (currency = 'MUR', name = 'Compte fictif M43') => {
    const res = await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/bank/accounts`, {
      name: `${name} ${++seq}`,
      bankName: 'Banque Fictive M43',
      currency,
      accountId: accountByCode(accounts, currency === 'MUR' ? '1010' : '1010').id,
      maskedReference: `MU00FICTIF43${String(seq).padStart(4, '0')}`,
    });
    expect(res.statusCode).toBe(201);
    return res.json().account;
  };

  const importStatement = async (bankId: string, rows: string[], fileName = `m43-${++seq}.csv`) => {
    const res = await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/bank/imports`, {
      bankAccountId: bankId,
      fileName,
      contentText: statement(rows),
    });
    expect(res.statusCode).toBe(201);
    const list = await api(
      ctx,
      owner.cookie,
      'GET',
      `/api/companies/${company.id}/bank/transactions?bankAccountId=${bankId}`,
    );
    return list.json().transactions;
  };

  const report = async (bankId: string, from?: string, to?: string) => {
    const q = new URLSearchParams({ bankAccountId: bankId });
    if (from) q.set('from', from);
    if (to) q.set('to', to);
    const res = await api(ctx, owner.cookie, 'GET', `/api/companies/${company.id}/bank/report?${q}`);
    expect(res.statusCode).toBe(200);
    return res.json().report;
  };

  const invoice = async (quantity = '1') => {
    const created = await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/billing/documents`, {
      kind: 'invoice',
      customerId: customer.id,
      issueDate: '2025-08-01',
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

  const docView = async (documentId: string) =>
    (
      await api(ctx, owner.cookie, 'GET', `/api/companies/${company.id}/billing/documents/${documentId}`)
    ).json().document;

  const entryCount = async () => {
    const res = await ctx.db.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM journal_entries WHERE company_id = $1',
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
    vi.stubGlobal('fetch', vi.fn(() => {
      throw new Error('No external provider may be called by mission 43 tests');
    }));
    const customerRes = await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/billing/customers`, {
      name: 'Client Banque Fictif M43',
      brn: 'BRN-M43-0001',
      paymentTermsDays: 0,
    });
    expect(customerRes.statusCode).toBe(201);
    customer = customerRes.json().customer;
    const itemRes = await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/billing/items`, {
      reference: 'SRV-M43-01',
      labelFr: 'Prestation bancaire fictive M43',
      unitPrice: '1000.00',
      vatTreatment: 'zero_rated',
      revenueAccountId: accountByCode(accounts, '4000').id,
    });
    expect(itemRes.statusCode).toBe(201);
    item = itemRes.json().item;
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    await closeTestApp(ctx);
  });

  it('C-01 reports opening, movement and closing balances on both sides (no false difference)', async () => {
    const bank = await bankAccount();
    await importStatement(bank.id, [
      `31/07/2025${S}Solde fictif d’ouverture${S}OUV-M43-01${S}${S}100000,00${S}MUR${S}100000,00`,
      `05/08/2025${S}Encaissement fictif M43${S}ENC-M43-01${S}${S}50000,00${S}MUR${S}150000,00`,
    ]);
    const r = await report(bank.id, '2025-08-01', '2025-08-31');
    expect(r.openingBankBalance).toBe('100000.0000');
    expect(r.closingBankBalance).toBe('150000.0000');
    expect(r.bankMovement).toBe('50000.0000');
    expect(r.openingLedgerBalance).toBe('0.0000');
    expect(r.ledgerMovement).toBe('0.0000');
    expect(r.closingLedgerBalance).toBe('0.0000');
    // The old report compared 150 000 (statement) with 50 000 (period ledger
    // movement) and produced a bogus 50 000 difference. The real closing
    // difference is 150 000 and must never be forced to zero.
    expect(r.difference).toBe('150000.0000');
    expect(r.priorTransactionCount).toBe(1);
    expect(r.status).toBe('differences');
    expect(r.explanations.some((e: any) => e.code === 'PRIOR_TRANSACTIONS')).toBe(true);
    const whole = await report(bank.id);
    expect(whole.openingBankBalance).toBe('0.0000');
    expect(whole.closingBankBalance).toBe('150000.0000');
    expect(whole.priorTransactionCount).toBe(0);
    expect(whole.difference).toBe('150000.0000');
    const csv = await api(
      ctx,
      owner.cookie,
      'GET',
      `/api/companies/${company.id}/bank/report.csv?bankAccountId=${bank.id}&from=2025-08-01&to=2025-08-31&lang=en`,
    );
    expect(csv.statusCode).toBe(200);
    expect(csv.body).toContain('Opening bank balance');
    expect(csv.body).toContain('Closing bank balance');
    expect(csv.body).toContain('Partially matched transactions');
  });

  it('C-02 counts matched, partially matched, excluded, unmatched and total without omission', async () => {
    const bank = await bankAccount('MUR', 'Compteurs fictifs M43');
    const rows = [
      `01/09/2025${S}Rapproché${S}M43-C2-1${S}${S}100,00${S}MUR${S}100,00`,
      `02/09/2025${S}Partiel${S}M43-C2-2${S}${S}200,00${S}MUR${S}300,00`,
      `03/09/2025${S}Exclu${S}M43-C2-3${S}${S}300,00${S}MUR${S}600,00`,
      `04/09/2025${S}Non rapproché${S}M43-C2-4${S}${S}400,00${S}MUR${S}1000,00`,
    ];
    const txns = await importStatement(bank.id, rows);
    const byRef = (ref: string) => txns.find((t: any) => t.reference === ref).id;
    await ctx.db.query(`UPDATE bank_transactions SET status = 'matched' WHERE id = $1`, [byRef('M43-C2-1')]);
    await ctx.db.query(`UPDATE bank_transactions SET status = 'partially_matched' WHERE id = $1`, [byRef('M43-C2-2')]);
    await ctx.db.query(`UPDATE bank_transactions SET status = 'excluded' WHERE id = $1`, [byRef('M43-C2-3')]);
    const r = await report(bank.id, '2025-09-01', '2025-09-30');
    expect(r.matchedCount).toBe(1);
    expect(r.partiallyMatchedCount).toBe(1);
    expect(r.excludedCount).toBe(1);
    expect(r.unmatchedCount).toBe(1);
    expect(r.totalCount).toBe(4);
    expect(r.explanation).toBeUndefined();
    expect(r.explanations.some((e: any) => e.code === 'PARTIALLY_MATCHED_BANK_TRANSACTIONS')).toBe(true);
  });

  it('C-03 validates a documented period, never creates an entry and reopens on a new statement row', async () => {
    const bank = await bankAccount('MUR', 'Période fictive M43');
    const first = await importStatement(bank.id, [
      `31/07/2025${S}Solde fictif d’ouverture${S}OUV-M43-03${S}${S}500,00${S}MUR${S}500,00`,
      `10/08/2025${S}Frais bancaires fictifs${S}FRAIS-M43-03${S}500,00${S}${S}MUR${S}0,00`,
    ]);
    const periodTxn = first.find((t: any) => t.reference === 'FRAIS-M43-03');
    const excluded = await api(
      ctx,
      owner.cookie,
      'POST',
      `/api/companies/${company.id}/bank/transactions/${periodTxn.id}/exclude`,
      { reason: 'Frais fictifs explicitement exclus du rapprochement M43' },
    );
    expect(excluded.statusCode).toBe(200);
    const beforeEntries = await entryCount();
    const opened = await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/bank/periods`, {
      bankAccountId: bank.id,
      from: '2025-08-01',
      to: '2025-08-31',
      note: 'Période fictive M43',
    });
    expect(opened.statusCode).toBe(201);
    const period = opened.json().period;
    expect(period.opening_bank).toBe('500.0000');
    expect(period.closing_bank).toBe('0.0000');
    expect(period.difference).toBe('0.0000');
    expect(period.unmatched_count).toBe(0);
    expect(period.excluded_count).toBe(1);

    const validated = await api(
      ctx,
      owner.cookie,
      'POST',
      `/api/companies/${company.id}/bank/periods/${period.id}/validate`,
      { confirm: true, note: 'Aucun écart sur la période fictive M43' },
    );
    expect(validated.statusCode).toBe(200);
    expect(validated.json().period.status).toBe('validated');
    expect(validated.json().period.statement_hash).toMatch(/^[0-9a-f]{32}$/);
    expect(await entryCount()).toBe(beforeEntries); // no automatic posting

    // A new statement row inside the validated period makes it stale.
    const more = await importStatement(bank.id, [
      `20/08/2025${S}Nouvel encaissement fictif${S}NEW-M43-03${S}${S}100,00${S}MUR${S}100,00`,
    ]);
    const newTxn = more.find((t: any) => t.reference === 'NEW-M43-03');
    const reread = await api(
      ctx,
      owner.cookie,
      'GET',
      `/api/companies/${company.id}/bank/periods/${period.id}`,
    );
    expect(reread.statusCode).toBe(200);
    expect(reread.json().period.status).toBe('reopened');
    expect(reread.json().period.difference).toBe('0.0000'); // stored, not rewritten

    // Reopening the same dates refreshes the snapshot, then validation is
    // blocked by the unmatched transaction: incompleteness is never hidden.
    const reopened = await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/bank/periods`, {
      bankAccountId: bank.id,
      from: '2025-08-01',
      to: '2025-08-31',
    });
    expect(reopened.statusCode).toBe(201);
    expect(reopened.json().period.closing_bank).toBe('100.0000');
    expect(reopened.json().period.difference).toBe('100.0000');
    const blocked = await api(
      ctx,
      owner.cookie,
      'POST',
      `/api/companies/${company.id}/bank/periods/${period.id}/validate`,
      { confirm: true },
    );
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().error.code).toBe('BANK_PERIOD_UNMATCHED_TRANSACTIONS');

    await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/bank/transactions/${newTxn.id}/exclude`, {
      reason: 'Encaissement fictif exclu pour le test M43',
    });
    const unresolved = await api(
      ctx,
      owner.cookie,
      'POST',
      `/api/companies/${company.id}/bank/periods/${period.id}/validate`,
      { confirm: true },
    );
    expect(unresolved.statusCode).toBe(400);
    expect(unresolved.json().error.code).toBe('BANK_PERIOD_DIFFERENCE_UNEXPLAINED');

    const accepted = await api(
      ctx,
      owner.cookie,
      'POST',
      `/api/companies/${company.id}/bank/periods/${period.id}/validate`,
      {
        confirm: true,
        note: 'Écart de 100 MUR accepté et documenté pour le test fictif M43',
        acceptedDifference: '100.0000',
      },
    );
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json().period.status).toBe('validated');
    expect(accepted.json().period.difference).toBe('100.0000');
    expect(accepted.json().period.accepted_difference).toBe('100.0000');
    expect(accepted.json().period.events.some((e: any) => e.event === 'period.reopened')).toBe(true);

    const csv = await api(
      ctx,
      owner.cookie,
      'GET',
      `/api/companies/${company.id}/bank/periods/${period.id}/report.csv?lang=fr`,
    );
    expect(csv.statusCode).toBe(200);
    expect(csv.body).toContain('Écart accepté');
    expect(csv.body).toContain('100.0000');
  });

  it('C-04 turns a bank receipt into a customer payment without automatic posting and without duplicates', async () => {
    const bank = await bankAccount();
    const inv = await invoice('1');
    expect(inv.status).not.toBe('paid');
    const txns = await importStatement(bank.id, [
      `05/08/2025${S}Encaissement client fictif M43${S}ENC-M43-04${S}${S}1000,00${S}MUR${S}1000,00`,
    ]);
    const txn = txns.find((t: any) => t.reference === 'ENC-M43-04');
    const beforeEntries = await entryCount();
    const created = await api(
      ctx,
      owner.cookie,
      'POST',
      `/api/companies/${company.id}/bank/transactions/${txn.id}/billing-payment`,
      {
        confirm: true,
        customerId: customer.id,
        allocations: [{ invoiceId: inv.id, amount: '1000.00' }],
        reference: 'REC-M43-FICTIF',
        note: 'Encaissement fictif M43 confirmé par un humain',
      },
    );
    expect(created.statusCode).toBe(201);
    const body = created.json();
    expect(body.entryCreated).toBe(false);
    expect(body.accountingNotice.code).toBe('POSTING_SEPARATE');
    expect(body.transaction.status).toBe('matched');
    expect(body.payment.accountingPosted).toBe(false);
    expect(await entryCount()).toBe(beforeEntries); // accounting stays separate
    const doc = await docView(inv.id);
    expect(doc.status).toBe('paid');
    expect(doc.outstanding).toBe('0.0000');

    const again = await api(
      ctx,
      owner.cookie,
      'POST',
      `/api/companies/${company.id}/bank/transactions/${txn.id}/billing-payment`,
      {
        confirm: true,
        customerId: customer.id,
        allocations: [{ invoiceId: inv.id, amount: '1000.00' }],
      },
    );
    expect(again.statusCode).toBe(200);
    expect(again.json().idempotent).toBe(true);
    expect(again.json().payment.paymentId).toBe(body.payment.paymentId);
    const payments = await ctx.db.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM billing_payments WHERE company_id = $1',
      [company.id],
    );
    expect(Number(payments.rows[0]!.n)).toBe(1);
    const matches = await ctx.db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM bank_matches
        WHERE transaction_id = $1 AND status = 'confirmed' AND billing_payment_id IS NOT NULL`,
      [txn.id],
    );
    expect(Number(matches.rows[0]!.n)).toBe(1);

    // No invoice can be found for another currency: refused, nothing created.
    const eurBank = await bankAccount('EUR', 'Compte EUR fictif M43');
    const eurTxns = await importStatement(eurBank.id, [
      `06/08/2025${S}Encaissement EUR fictif${S}ENC-M43-EUR${S}${S}500,00${S}EUR${S}500,00`,
    ]);
    const eurTxn = eurTxns.find((t: any) => t.reference === 'ENC-M43-EUR');
    const inv2 = await invoice('1');
    const mismatch = await api(
      ctx,
      owner.cookie,
      'POST',
      `/api/companies/${company.id}/bank/transactions/${eurTxn.id}/billing-payment`,
      {
        confirm: true,
        customerId: customer.id,
        allocations: [{ invoiceId: inv2.id, amount: '500.00' }],
      },
    );
    expect(mismatch.statusCode).toBe(400);
    expect(mismatch.json().error.code).toBe('CURRENCY_MISMATCH');
    expect((await docView(inv2.id)).status).not.toBe('paid');
  });


  it('Phase A — supplier advance account is configurable and never falls back to another asset', () => {
    const dynamic = {
      settings: { advance_to_supplier_account_id: 'asset-2' },
      accounts: [
        { id: 'asset-1', code: '1150', name: 'Advances to suppliers', type: 'asset', is_active: true },
        { id: 'asset-2', code: '1155', name: 'Supplier advances — configured', type: 'asset', is_active: true },
      ],
      accountsByCode: new Map([
        ['1150', { id: 'asset-1', code: '1150', name: 'Advances to suppliers', type: 'asset', is_active: true }],
      ]),
    } as any;
    expect(accountForRole(dynamic, 'prepayment')?.id).toBe('asset-2');
    const inactive = {
      ...dynamic,
      accounts: [{ ...dynamic.accounts[1], is_active: false }],
    } as any;
    expect(accountForRole(inactive, 'prepayment')).toBeNull();
    const legacy = {
      settings: {},
      accounts: dynamic.accounts,
      accountsByCode: dynamic.accountsByCode,
    } as any;
    expect(accountForRole(legacy, 'prepayment')?.id).toBe('asset-1');
  });
});
