import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
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
  type TestContext,
  type TestUser,
} from './helpers.js';

/**
 * Mission 6 - assistant comptable V2 and billing -> accounting integration.
 *
 * The simulated provider is used throughout: no key, no network, no cost. A
 * spy on `fetch` fails the test if any external call is attempted.
 */

const ISSUE_DATE = '2025-09-15';

async function enableSimulated(ctx: TestContext, cookie: string): Promise<void> {
  const res = await api(ctx, cookie, 'PATCH', '/api/cabinet/ai/settings', {
    enabled: true,
    primary: { provider: 'simulated', model: 'simulated-fictif' },
    features: { accounting: true, cabinet: false, billing: false, payroll: false },
  });
  if (res.statusCode !== 200) throw new Error(`Enable AI failed: ${res.statusCode} ${res.body}`);
}

describe('assistant comptable V2 - proposals, validation and posting', () => {
  let ctx: TestContext;
  let owner: TestUser;
  let company: any;
  let accounts: any[];
  let journals: any[];
  const fetchSpy = vi.fn();

  const propose = (body: Record<string, unknown>) =>
    api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/ai/entry-proposals`, body);

  beforeAll(async () => {
    ctx = await createTestApp();
    owner = await registerUser(ctx);
    company = await createCompany(ctx, owner.cookie, { name: 'Assistant V2 Fictif Ltée' });
    accounts = await getAccounts(ctx, owner.cookie, company.id);
    journals = await getJournals(ctx, owner.cookie, company.id);
    vi.stubGlobal('fetch', fetchSpy);
    fetchSpy.mockImplementation(() => {
      throw new Error('No test is allowed to call an external AI provider');
    });
    await enableSimulated(ctx, owner.cookie);
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    await closeTestApp(ctx);
  });

  it('proposes a complete balanced entry and never writes it before the human action', async () => {
    const before = await ctx.db.query<{ count: number }>(
      'SELECT COUNT(*)::int AS count FROM journal_entries WHERE company_id = $1',
      [company.id],
    );

    const created = await propose({
      description: 'Fournitures de bureau fictives — achat à crédit fournisseur',
      amount: '2500.00',
      currency: 'MUR',
      entryDate: ISSUE_DATE,
    });
    expect(created.statusCode).toBe(201);
    const proposal = created.json().proposal;
    expect(created.json().entryCreated).toBe(false);
    expect(proposal.status).toBe('proposed');
    expect(proposal.totals.balanced).toBe(true);
    expect(proposal.totals.debit).toBe('2500.0000');
    expect(proposal.totals.credit).toBe('2500.0000');
    expect(proposal.lines).toHaveLength(2);
    expect(proposal.journalCode).toBe('PUR');
    // Accounts always come from the real chart.
    const chartIds = new Set(accounts.map((a) => a.id));
    for (const line of proposal.lines) expect(chartIds.has(line.accountId)).toBe(true);
    expect(proposal.checks.every((c: any) => c.severity !== 'error' || typeof c.ok === 'boolean')).toBe(true);

    const stillNothing = await ctx.db.query<{ count: number }>(
      'SELECT COUNT(*)::int AS count FROM journal_entries WHERE company_id = $1',
      [company.id],
    );
    expect(stillNothing.rows[0]!.count).toBe(before.rows[0]!.count);

    const validated = await api(
      ctx,
      owner.cookie,
      'POST',
      `/api/companies/${company.id}/ai/entry-proposals/${proposal.id}/validate`,
      { acceptWarnings: true },
    );
    expect(validated.statusCode).toBe(200);
    expect(validated.json().entryCreated).toBe(false);
    expect(validated.json().proposal.status).toBe('validated');

    const afterValidation = await ctx.db.query<{ count: number }>(
      'SELECT COUNT(*)::int AS count FROM journal_entries WHERE company_id = $1',
      [company.id],
    );
    expect(afterValidation.rows[0]!.count).toBe(before.rows[0]!.count);

    const posted = await api(
      ctx,
      owner.cookie,
      'POST',
      `/api/companies/${company.id}/ai/entry-proposals/${proposal.id}/post`,
    );
    expect(posted.statusCode).toBe(200);
    expect(posted.json().entryCreated).toBe(true);
    expect(posted.json().proposal.status).toBe('posted');
    expect(posted.json().entryNo).toMatch(/^PUR-2025-\d{4}$/);

    const entry = await api(
      ctx,
      owner.cookie,
      'GET',
      `/api/companies/${company.id}/entries/${posted.json().entryId}`,
    );
    expect(entry.statusCode).toBe(200);
    const lines = entry.json().lines;
    expect(lines).toHaveLength(2);
    const debit = lines.reduce((acc: number, l: any) => acc + Number(l.debit), 0);
    const credit = lines.reduce((acc: number, l: any) => acc + Number(l.credit), 0);
    expect(debit).toBeCloseTo(2500, 4);
    expect(credit).toBeCloseTo(2500, 4);

    const again = await api(
      ctx,
      owner.cookie,
      'POST',
      `/api/companies/${company.id}/ai/entry-proposals/${proposal.id}/post`,
    );
    expect(again.statusCode).toBe(409);
    expect(again.json().error.code).toBe('ACCOUNTING_ALREADY_POSTED');
  });

  it('requires validation before posting and rejects a proposal explicitly', async () => {
    const created = await propose({
      description: 'Frais bancaires fictifs du mois',
      amount: '150.00',
      currency: 'MUR',
      entryDate: ISSUE_DATE,
    });
    const proposal = created.json().proposal;
    expect(proposal.journalCode).toBe('BQ');

    const early = await api(
      ctx,
      owner.cookie,
      'POST',
      `/api/companies/${company.id}/ai/entry-proposals/${proposal.id}/post`,
    );
    expect(early.statusCode).toBe(409);
    expect(early.json().error.code).toBe('AI_PROPOSAL_NOT_VALIDATED');

    const rejected = await api(
      ctx,
      owner.cookie,
      'POST',
      `/api/companies/${company.id}/ai/entry-proposals/${proposal.id}/reject`,
      { note: 'Montant à vérifier (fictif)' },
    );
    expect(rejected.statusCode).toBe(200);
    expect(rejected.json().proposal.status).toBe('rejected');
    expect(rejected.json().entryCreated).toBe(false);

    const cannotValidate = await api(
      ctx,
      owner.cookie,
      'POST',
      `/api/companies/${company.id}/ai/entry-proposals/${proposal.id}/validate`,
      {},
    );
    expect(cannotValidate.statusCode).toBe(409);
  });

  it('lets a human change a counterparty, refuses an account outside the company', async () => {
    const created = await propose({
      description: 'Achat de matériel informatique fictif',
      amount: '1200.00',
      currency: 'MUR',
      entryDate: ISSUE_DATE,
    });
    const proposal = created.json().proposal;
    const machinery = accountByCode(accounts, '1500');
    const payable = accountByCode(accounts, '2000');
    const other = await registerUser(ctx);
    const otherCompany = await createCompany(ctx, other.cookie, { name: 'Société hors périmètre' });
    const otherAccounts = await getAccounts(ctx, other.cookie, otherCompany.id);

    const foreign = await api(
      ctx,
      owner.cookie,
      'PUT',
      `/api/companies/${company.id}/ai/entry-proposals/${proposal.id}`,
      {
        lines: [
          { accountId: machinery.id, debit: '1200.00', credit: null },
          { accountId: otherAccounts[0].id, debit: null, credit: '1200.00' },
        ],
      },
    );
    expect(foreign.statusCode).toBe(400);
    expect(foreign.json().error.code).toBe('AI_ACCOUNT_NOT_IN_CHART');

    const updated = await api(
      ctx,
      owner.cookie,
      'PUT',
      `/api/companies/${company.id}/ai/entry-proposals/${proposal.id}`,
      {
        lines: [
          { accountId: machinery.id, description: 'Matériel', debit: '1200.00', credit: null },
          { accountId: payable.id, description: 'Dette fournisseur', debit: null, credit: '1200.00' },
        ],
      },
    );
    expect(updated.statusCode).toBe(200);
    expect(updated.json().entryCreated).toBe(false);
    const lineAccounts = updated.json().proposal.lines.map((l: any) => l.accountCode).sort();
    expect(lineAccounts).toEqual(['1500', '2000']);
    expect(updated.json().proposal.totals.balanced).toBe(true);
  });

  it('blocks validation when the accounting period is closed', async () => {
    await ctx.db.query(
      `UPDATE accounting_periods SET status = 'closed' WHERE company_id = $1`,
      [company.id],
    );
    const created = await propose({
      description: 'Charge fictive sur période fermée',
      amount: '300.00',
      currency: 'MUR',
      entryDate: ISSUE_DATE,
    });
    const proposal = created.json().proposal;
    const periodCheck = proposal.checks.find((c: any) => c.key === 'period_open');
    expect(periodCheck.ok).toBe(false);
    const blocked = await api(
      ctx,
      owner.cookie,
      'POST',
      `/api/companies/${company.id}/ai/entry-proposals/${proposal.id}/validate`,
      { acceptWarnings: true },
    );
    expect(blocked.statusCode).toBe(400);
    expect(blocked.json().error.code).toBe('AI_PROPOSAL_INVALID');
    expect(blocked.json().error.details.errors).toContain('period_open');

    await ctx.db.query(`UPDATE accounting_periods SET status = 'open' WHERE company_id = $1`, [company.id]);
  });

  it('requires a documented exchange rate for a foreign currency entry', async () => {
    const created = await propose({
      description: 'Prestation facturée en dollars fictifs',
      amount: '100.00',
      currency: 'USD',
      entryDate: ISSUE_DATE,
    });
    const proposal = created.json().proposal;
    const currencyCheck = proposal.checks.find((c: any) => c.key === 'currency');
    expect(currencyCheck.ok).toBe(false);
    const blocked = await api(
      ctx,
      owner.cookie,
      'POST',
      `/api/companies/${company.id}/ai/entry-proposals/${proposal.id}/validate`,
      { acceptWarnings: true },
    );
    expect(blocked.statusCode).toBe(400);

    const updated = await api(
      ctx,
      owner.cookie,
      'PUT',
      `/api/companies/${company.id}/ai/entry-proposals/${proposal.id}`,
      { exchangeRate: '48.5000' },
    );
    expect(updated.statusCode).toBe(200);
    const validated = await api(
      ctx,
      owner.cookie,
      'POST',
      `/api/companies/${company.id}/ai/entry-proposals/${proposal.id}/validate`,
      { acceptWarnings: true },
    );
    expect(validated.statusCode).toBe(200);
    const posted = await api(
      ctx,
      owner.cookie,
      'POST',
      `/api/companies/${company.id}/ai/entry-proposals/${proposal.id}/post`,
    );
    expect(posted.statusCode).toBe(200);
    const entry = await api(
      ctx,
      owner.cookie,
      'GET',
      `/api/companies/${company.id}/entries/${posted.json().entryId}`,
    );
    expect(entry.json().entry.currency).toBe('USD');
    expect(entry.json().entry.exchange_rate).toBe('48.50000000');
    const debit = entry.json().lines.reduce((acc: number, l: any) => acc + Number(l.debit), 0);
    expect(debit).toBeCloseTo(4850, 4);
  });

  it('never invents a VAT rate when the description mentions VAT', async () => {
    const created = await propose({
      description: 'Achat de fournitures fictives avec TVA non configurée',
      amount: '1150.00',
      currency: 'MUR',
      entryDate: ISSUE_DATE,
    });
    expect(created.statusCode).toBe(201);
    const proposal = created.json().proposal;
    expect(proposal.lines).toHaveLength(2);
    expect(proposal.lines.every((l: any) => Number(l.debit) === 0 || Number(l.credit) === 0)).toBe(true);
    expect(proposal.warnings.join(' ')).toMatch(/TVA mentionnée/);
    const vatLine = proposal.lines.find((l: any) => /tva|vat/i.test(l.accountName));
    expect(vatLine).toBeUndefined();
  });

  it('refuses AI features when the cabinet has not enabled them', async () => {
    const disabled = await api(ctx, owner.cookie, 'PATCH', '/api/cabinet/ai/settings', {
      features: { accounting: false },
    });
    expect(disabled.statusCode).toBe(200);
    const res = await propose({
      description: 'Opération sur IA désactivée',
      amount: '100.00',
      currency: 'MUR',
      entryDate: ISSUE_DATE,
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('AI_FEATURE_DISABLED');
    await enableSimulated(ctx, owner.cookie);
  });
});

describe('billing -> accounting integration', () => {
  let ctx: TestContext;
  let owner: TestUser;
  let company: any;
  let customer: any;
  let item: any;
  let invoice: any;
  const fetchSpy = vi.fn();

  const proposalFor = (body: Record<string, unknown>) =>
    api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/ai/entry-proposals/from-billing`, body);

  beforeAll(async () => {
    ctx = await createTestApp();
    owner = await registerUser(ctx);
    company = await createCompany(ctx, owner.cookie, { name: 'Intégration Facturation Comptabilité' });
    vi.stubGlobal('fetch', fetchSpy);
    fetchSpy.mockImplementation(() => {
      throw new Error('No test is allowed to call an external AI provider');
    });
    await enableSimulated(ctx, owner.cookie);

    customer = (
      await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/billing/customers`, {
        name: 'Client Intégration Fictif',
        brn: 'BRN-INT-0001',
        paymentTermsDays: 30,
      })
    ).json().customer;
    item = (
      await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/billing/items`, {
        reference: 'SRV-INT',
        labelFr: 'Prestation d’intégration (fictive)',
        unitPrice: '2000.00',
        vatTreatment: 'zero_rated',
        revenueAccountId: accountByCode(await getAccounts(ctx, owner.cookie, company.id), '4000').id,
      })
    ).json().item;
    invoice = (
      await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/billing/documents`, {
        kind: 'invoice',
        customerId: customer.id,
        issueDate: ISSUE_DATE,
        dueDate: '2025-10-15',
        lines: [{ itemId: item.id, quantity: '3' }],
      })
    ).json().document;
    const issued = await api(
      ctx,
      owner.cookie,
      'POST',
      `/api/companies/${company.id}/billing/documents/${invoice.id}/issue`,
    );
    invoice = issued.json().document;
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    await closeTestApp(ctx);
  });

  it('does not propose accounting for a draft invoice', async () => {
    const draft = await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/billing/documents`, {
      kind: 'invoice',
      customerId: customer.id,
      issueDate: '2025-09-20',
      lines: [{ itemId: item.id, quantity: '1' }],
    });
    const result = await proposalFor({ documentId: draft.json().document.id });
    expect(result.statusCode).toBe(409);
    expect(result.json().error.code).toBe('DOCUMENT_NOT_ISSUED');
  });

  it('builds a balanced deterministic proposal from the real chart and posts it exactly once', async () => {
    const created = await proposalFor({ documentId: invoice.id });
    expect(created.statusCode).toBe(201);
    const proposal = created.json().proposal;
    expect(created.json().entryCreated).toBe(false);
    expect(proposal.provider).toBe('deterministic');
    expect(proposal.sourceKind).toBe('billing_invoice');
    expect(proposal.journalCode).toBe('SAL');
    expect(proposal.reference).toBe(invoice.number);
    expect(proposal.totals.balanced).toBe(true);
    expect(proposal.totals.debit).toBe('6000.0000');
    const codes = proposal.lines.map((l: any) => l.accountCode).sort();
    expect(codes).toEqual(['1100', '4000']);

    // Requesting again reuses the live proposal instead of creating a second.
    const again = await proposalFor({ documentId: invoice.id });
    expect(again.statusCode).toBe(200);
    expect(again.json().reused).toBe(true);
    expect(again.json().proposal.id).toBe(proposal.id);

    const validated = await api(
      ctx,
      owner.cookie,
      'POST',
      `/api/companies/${company.id}/ai/entry-proposals/${proposal.id}/validate`,
      { acceptWarnings: true },
    );
    expect(validated.statusCode).toBe(200);

    const docBefore = await api(
      ctx,
      owner.cookie,
      'GET',
      `/api/companies/${company.id}/billing/documents/${invoice.id}`,
    );
    expect(docBefore.json().document.accountingEntryId).toBeNull();

    const [first, second] = await Promise.all([
      api(
        ctx,
        owner.cookie,
        'POST',
        `/api/companies/${company.id}/ai/entry-proposals/${proposal.id}/post`,
      ),
      api(
        ctx,
        owner.cookie,
        'POST',
        `/api/companies/${company.id}/ai/entry-proposals/${proposal.id}/post`,
      ),
    ]);
    const statuses = [first.statusCode, second.statusCode].sort();
    expect(statuses).toEqual([200, 409]);
    const winner = first.statusCode === 200 ? first : second;
    expect(winner.json().entryCreated).toBe(true);

    const docAfter = await api(
      ctx,
      owner.cookie,
      'GET',
      `/api/companies/${company.id}/billing/documents/${invoice.id}`,
    );
    expect(docAfter.json().document.accountingEntryId).toBe(winner.json().entryId);

    const entries = await api(
      ctx,
      owner.cookie,
      'GET',
      `/api/companies/${company.id}/entries?status=posted`,
    );
    const billingEntries = entries.json().entries.filter((e: any) => e.source === 'billing');
    expect(billingEntries).toHaveLength(1);
    expect(billingEntries[0].reference).toBe(invoice.number);

    const duplicate = await proposalFor({ documentId: invoice.id });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().error.code).toBe('ACCOUNTING_ALREADY_POSTED');
  });

  it('proposes and posts a customer payment without confusing settlement and allocation', async () => {
    const payment = await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/billing/payments`, {
      customerId: customer.id,
      paymentDate: '2025-09-25',
      amount: '2000.00',
      currency: 'MUR',
      method: 'bank_transfer',
      reference: 'TRX-INT-0001',
      allocations: [{ invoiceId: invoice.id, amount: '2000.00' }],
    });
    expect(payment.statusCode).toBe(201);
    expect(payment.json().entryCreated).toBe(false);

    const proposal = await proposalFor({ paymentId: payment.json().payment.id });
    expect(proposal.statusCode).toBe(201);
    const codes = proposal.json().proposal.lines.map((l: any) => l.accountCode).sort();
    expect(codes).toEqual(['1010', '1100']);
    expect(proposal.json().proposal.totals.debit).toBe('2000.0000');

    const proposalId = proposal.json().proposal.id;
    const validated = await api(
      ctx,
      owner.cookie,
      'POST',
      `/api/companies/${company.id}/ai/entry-proposals/${proposalId}/validate`,
      { acceptWarnings: true },
    );
    expect(validated.statusCode).toBe(200);
    const posted = await api(
      ctx,
      owner.cookie,
      'POST',
      `/api/companies/${company.id}/ai/entry-proposals/${proposalId}/post`,
    );
    expect(posted.statusCode).toBe(200);

    const view = await api(
      ctx,
      owner.cookie,
      'GET',
      `/api/companies/${company.id}/billing/payments/${payment.json().payment.id}`,
    );
    expect(view.json().payment.accountingEntryId).toBe(posted.json().entryId);

    // The invoice remains partially paid: posting an encashment does not
    // "pay" anything by itself.
    const doc = await api(
      ctx,
      owner.cookie,
      'GET',
      `/api/companies/${company.id}/billing/documents/${invoice.id}`,
    );
    expect(doc.json().document.status).toBe('partially_paid');
    expect(doc.json().document.amountPaid).toBe('2000.0000');
  });

  it('proposes a credit note with a reverse entry and updates the invoice balance', async () => {
    const credit = await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/billing/documents`, {
      kind: 'credit_note',
      customerId: customer.id,
      issueDate: '2025-09-26',
      sourceDocumentId: invoice.id,
      lines: [{ itemId: item.id, quantity: '1' }],
    });
    expect(credit.statusCode).toBe(201);
    const issued = await api(
      ctx,
      owner.cookie,
      'POST',
      `/api/companies/${company.id}/billing/documents/${credit.json().document.id}/issue`,
    );
    expect(issued.statusCode).toBe(200);

    const proposal = await proposalFor({ documentId: issued.json().document.id });
    expect(proposal.statusCode).toBe(201);
    const lines = proposal.json().proposal.lines;
    const receivable = lines.find((l: any) => l.accountCode === '1100');
    expect(Number(receivable.credit)).toBeCloseTo(2000, 4);
    expect(proposal.json().proposal.totals.balanced).toBe(true);

    const proposalId = proposal.json().proposal.id;
    await api(
      ctx,
      owner.cookie,
      'POST',
      `/api/companies/${company.id}/ai/entry-proposals/${proposalId}/validate`,
      { acceptWarnings: true },
    );
    const posted = await api(
      ctx,
      owner.cookie,
      'POST',
      `/api/companies/${company.id}/ai/entry-proposals/${proposalId}/post`,
    );
    expect(posted.statusCode).toBe(200);

    const doc = await api(
      ctx,
      owner.cookie,
      'GET',
      `/api/companies/${company.id}/billing/documents/${invoice.id}`,
    );
    expect(doc.json().document.creditedAmount).toBe('2000.0000');
    expect(doc.json().document.outstanding).toBe('2000.0000');
  });

  it('keeps billing and accounting isolated between companies', async () => {
    const other = await registerUser(ctx);
    const otherCompany = await createCompany(ctx, other.cookie, { name: 'Autre dossier fictif' });
    const cross = await api(
      ctx,
      other.cookie,
      'POST',
      `/api/companies/${otherCompany.id}/ai/entry-proposals/from-billing`,
      { documentId: invoice.id },
    );
    expect(cross.statusCode).toBe(404);
  });
});

describe('learned rules', () => {
  let ctx: TestContext;
  let owner: TestUser;
  let company: any;
  let accounts: any[];
  let journals: any[];
  const fetchSpy = vi.fn();

  beforeAll(async () => {
    ctx = await createTestApp();
    owner = await registerUser(ctx);
    company = await createCompany(ctx, owner.cookie, { name: 'Règles Apprises Fictives' });
    accounts = await getAccounts(ctx, owner.cookie, company.id);
    journals = await getJournals(ctx, owner.cookie, company.id);
    vi.stubGlobal('fetch', fetchSpy);
    fetchSpy.mockImplementation(() => {
      throw new Error('No test is allowed to call an external AI provider');
    });
    await enableSimulated(ctx, owner.cookie);
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    await closeTestApp(ctx);
  });

  const saveRule = (body: Record<string, unknown>) =>
    api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/ai/entry-rules`, body);

  it('applies a validated rule deterministically and versions it', async () => {
    const supplies = accountByCode(accounts, '5000');
    const payable = accountByCode(accounts, '2000');
    const first = await saveRule({
      ruleType: 'counterparty',
      matchKey: 'Fournisseur Fictif Alpha',
      accountId: supplies.id,
      counterAccountId: payable.id,
      journalId: journalByCode(journals, 'PUR').id,
      priority: 10,
      notes: 'Règle validée par un humain (test)',
    });
    expect(first.statusCode).toBe(201);
    expect(first.json().rule.version).toBe(1);

    const proposal = await api(
      ctx,
      owner.cookie,
      'POST',
      `/api/companies/${company.id}/ai/entry-proposals`,
      {
        description: 'Fournisseur Fictif Alpha — facture de fournitures',
        amount: '900.00',
        currency: 'MUR',
        entryDate: '2025-09-15',
      },
    );
    expect(proposal.statusCode).toBe(201);
    expect(proposal.json().proposal.provider).toBe('rule');
    expect(proposal.json().ruleApplied.rule.version).toBe(1);
    const codes = proposal.json().proposal.lines.map((l: any) => l.accountCode).sort();
    expect(codes).toEqual(['2000', '5000']);
    expect(fetchSpy).not.toHaveBeenCalled();

    const second = await saveRule({
      ruleType: 'counterparty',
      matchKey: 'Fournisseur Fictif Alpha',
      accountId: accountByCode(accounts, '6100').id,
      counterAccountId: payable.id,
      journalId: journalByCode(journals, 'PUR').id,
      priority: 10,
    });
    expect(second.statusCode).toBe(201);
    expect(second.json().rule.version).toBe(2);
    expect(second.json().rule.id).not.toBe(first.json().rule.id);

    const list = await api(ctx, owner.cookie, 'GET', `/api/companies/${company.id}/ai/entry-rules`);
    const active = list.json().rules.filter((r: any) => r.matchKey === 'Fournisseur Fictif Alpha');
    expect(active).toHaveLength(1);
    expect(active[0].version).toBe(2);

    const history = await api(
      ctx,
      owner.cookie,
      'GET',
      `/api/companies/${company.id}/ai/entry-rules/history?ruleType=counterparty&matchKey=Fournisseur%20Fictif%20Alpha`,
    );
    expect(history.statusCode).toBe(200);
    expect(history.json().history).toHaveLength(2);
    expect(history.json().history[0].version).toBe(2);
    expect(history.json().history[1].isActive).toBe(false);
  });

  it('never applies an ambiguous rule silently', async () => {
    const petty = accountByCode(accounts, '6120');
    const rent = accountByCode(accounts, '6100');
    const bank = accountByCode(accounts, '1010');
    for (const [key, account] of [
      ['virement ambigu', petty],
      ['Virement ambigu fictif', rent],
    ] as const) {
      const saved = await saveRule({
        ruleType: 'bank_label',
        matchKey: key,
        accountId: account.id,
        counterAccountId: bank.id,
        journalId: journalByCode(journals, 'BQ').id,
        priority: 50,
        accountSide: 'debit',
      });
      expect(saved.statusCode).toBe(201);
    }

    const proposal = await api(
      ctx,
      owner.cookie,
      'POST',
      `/api/companies/${company.id}/ai/entry-proposals`,
      {
        description: 'Virement ambigu fictif du mois',
        amount: '75.00',
        currency: 'MUR',
        entryDate: '2025-09-15',
      },
    );
    expect(proposal.statusCode).toBe(201);
    expect(proposal.json().ruleApplied).toBeNull();
    expect(proposal.json().proposal.provider).toBe('simulated');
    expect(proposal.json().proposal.ruleTrace.join(' ')).toMatch(/Conflit/);
  });

  it('disables a rule without deleting its history', async () => {
    const supplies = accountByCode(accounts, '6110');
    const payable = accountByCode(accounts, '2000');
    const rule = await saveRule({
      ruleType: 'counterparty',
      matchKey: 'Fournisseur À Désactiver',
      accountId: supplies.id,
      counterAccountId: payable.id,
    });
    const disabled = await api(
      ctx,
      owner.cookie,
      'POST',
      `/api/companies/${company.id}/ai/entry-rules/${rule.json().rule.id}/disable`,
    );
    expect(disabled.statusCode).toBe(200);
    const list = await api(
      ctx,
      owner.cookie,
      'GET',
      `/api/companies/${company.id}/ai/entry-rules?includeInactive=true`,
    );
    const found = list.json().rules.find((r: any) => r.matchKey === 'Fournisseur À Désactiver');
    expect(found.isActive).toBe(false);

    const proposal = await api(
      ctx,
      owner.cookie,
      'POST',
      `/api/companies/${company.id}/ai/entry-proposals`,
      {
        description: 'Fournisseur À Désactiver — facture',
        amount: '45.00',
        currency: 'MUR',
        entryDate: '2025-09-15',
      },
    );
    expect(proposal.json().ruleApplied).toBeNull();
  });

  it('refuses a rule pointing at an account of another company', async () => {
    const other = await registerUser(ctx);
    const otherCompany = await createCompany(ctx, other.cookie, { name: 'Société règle externe' });
    const otherAccounts = await getAccounts(ctx, other.cookie, otherCompany.id);
    const rejected = await saveRule({
      ruleType: 'counterparty',
      matchKey: 'Compte Externe',
      accountId: otherAccounts[0].id,
    });
    expect(rejected.statusCode).toBe(400);
    expect(rejected.json().error.code).toBe('AI_ACCOUNT_NOT_IN_CHART');
  });
});
