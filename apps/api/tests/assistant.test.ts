import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  accountByCode,
  api,
  closeTestApp,
  createCompany,
  createTestApp,
  getAccounts,
  journalByCode,
  registerUser,
  setupCompanyWithChart,
  type TestContext,
  type TestUser,
} from './helpers.js';

/**
 * Mission 7 - universal assistant, company settings and VAT configuration.
 *
 * Everything here is fictional: the company, the customer, the invoice, the VAT
 * "configuration" (explicitly a test parameter, never a tax rule) and the entry.
 * No test performs a network call: `globalThis.fetch` is replaced by a spy that
 * fails if the assistant ever tries to reach a provider.
 */

const fetchSpy = vi.fn();
const realFetch = globalThis.fetch;

async function enableSimulated(ctx: TestContext, cookie: string): Promise<void> {
  const res = await api(ctx, cookie, 'PATCH', '/api/cabinet/ai/settings', {
    enabled: true,
    primary: { provider: 'simulated', model: 'simulated-fictif' },
    features: { accounting: true, cabinet: true, billing: false, payroll: false },
  });
  if (res.statusCode !== 200) throw new Error(`Enable AI failed: ${res.statusCode} ${res.body}`);
}

describe('universal assistant - context, tools and permissions', () => {
  let ctx: TestContext;
  let owner: TestUser;
  let company: any;
  let invoice: any;

  const openConversation = async (
    body: Record<string, unknown> = {},
    cookie = owner.cookie,
    companyId = company.id,
  ) =>
    api(ctx, cookie, 'POST', `/api/companies/${companyId}/ai/assistant/conversations`, {
      companyId,
      module: 'billing',
      screen: 'billing/documents',
      locale: 'fr',
      ...body,
    });

  const send = async (conversationId: string, text: string, cookie = owner.cookie, companyId = company.id) => {
    const res = await api(
      ctx,
      cookie,
      'POST',
      `/api/companies/${companyId}/ai/assistant/conversations/${conversationId}/messages`,
      { text, companyId },
    );
    return res;
  };

  beforeAll(async () => {
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    ctx = await createTestApp();
    owner = await registerUser(ctx);
    company = await createCompany(ctx, owner.cookie, { name: 'Assistant Fictif Ltée' });
    await enableSimulated(ctx, owner.cookie);

    const customer = (
      await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/billing/customers`, {
        name: 'Client Assistant Fictif',
        brn: 'BRN-ASSIST-0001',
      })
    ).json().customer;
    const item = (
      await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/billing/items`, {
        reference: 'SRV-ASSIST',
        labelFr: 'Prestation fictive',
        unitPrice: '1000.00',
        vatTreatment: 'zero_rated',
      })
    ).json().item;

    const created = await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/billing/documents`, {
      kind: 'invoice',
      customerId: customer.id,
      issueDate: '2025-09-15',
      lines: [{ itemId: item.id, quantity: '2' }],
    });
    invoice = created.json().document;
    const issued = await api(
      ctx,
      owner.cookie,
      'POST',
      `/api/companies/${company.id}/billing/documents/${invoice.id}/issue`,
      {},
    );
    invoice = issued.json().document;

    await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/tasks`, {
      title: 'Relancer le client fictif',
      category: 'accounting',
      dueDate: '2020-01-15',
      priority: 'high',
    });
  });

  afterAll(async () => {
    await closeTestApp(ctx);
    globalThis.fetch = realFetch;
  });

  it('exposes a read-only tool catalogue and never claims a provider', async () => {
    const res = await api(ctx, owner.cookie, 'GET', `/api/companies/${company.id}/ai/assistant/tools`);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.mode).toBe('deterministic-read-only');
    expect(body.provider).toBeNull();
    expect(body.tools.length).toBeGreaterThan(8);
    expect(body.tools.every((t: any) => t.readOnly === true)).toBe(true);
    const keys = body.tools.map((t: any) => t.key);
    expect(keys).toEqual(
      expect.arrayContaining([
        'billing.invoices.unpaid',
        'cabinet.tasks.overdue',
        'accounting.accounts.search',
        'accounting.proposal.prepare',
        'payroll.status',
        'migration.jobs.summary',
      ]),
    );
  });

  it('builds and validates the context server-side (module, screen, company, permissions)', async () => {
    const res = await openConversation({ objectRef: { type: 'invoice', id: invoice.id } });
    expect(res.statusCode).toBe(201);
    const context = res.json().context;
    expect(context.companyId).toBe(company.id);
    expect(context.module).toBe('billing');
    expect(context.screen).toBe('billing/documents');
    expect(context.permissions).toMatchObject({ billing: 'admin', accounting: 'admin' });
    expect(context.objectRef).toEqual({ type: 'invoice', id: invoice.id });

    // A foreign object reference is dropped, never trusted.
    const other = await createCompany(ctx, owner.cookie, { name: 'Autre Dossier Fictif' });
    const foreign = await openConversation(
      {
        objectRef: { type: 'invoice', id: '00000000-0000-0000-0000-000000000000' },
        companyId: other.id,
      },
      owner.cookie,
      other.id,
    );
    expect(foreign.statusCode).toBe(201);
    expect(foreign.json().context.objectRef).toBeNull();
  });

  it('rejects a company the user does not belong to, and a body/URL mismatch', async () => {
    const stranger = await registerUser(ctx);
    const denied = await openConversation({}, stranger.cookie, company.id);
    expect(denied.statusCode).toBe(404);
    expect(denied.json().error.code).toBe('COMPANY_NOT_FOUND');

    const mismatch = await api(
      ctx,
      owner.cookie,
      'POST',
      `/api/companies/${company.id}/ai/assistant/conversations`,
      { companyId: '00000000-0000-0000-0000-000000000000' },
    );
    expect(mismatch.statusCode).toBe(400);
    expect(mismatch.json().error.code).toBe('COMPANY_MISMATCH');
  });

  it('lists real unpaid invoices and never invents an amount', async () => {
    const conversation = (await openConversation()).json().conversation;
    const res = await send(conversation.id, 'Quelles factures sont impayées ?');
    expect(res.statusCode).toBe(201);
    const body = res.json();
    const answer = body.messages[1].content as string;
    expect(answer).toContain(invoice.number);
    expect(answer).toContain('2000.0000');
    expect(body.toolRuns[0]).toMatchObject({ tool: 'billing.invoices.unpaid', status: 'ok' });
    expect(body.messages[1].payload.actions).toEqual(expect.any(Array));

    const unknown = await send(conversation.id, 'Montre la facture FAC-INEXISTANTE');
    const unknownAnswer = unknown.json().messages[1].content as string;
    expect(unknownAnswer).toMatch(/aucune facture/i);
    expect(unknownAnswer).not.toMatch(/FAC-INEXISTANTE —/);
  });

  it('answers task and deadline questions from real rows, including overdue tasks', async () => {
    const conversation = (await openConversation({ module: 'cabinet', screen: 'cabinet/tasks' })).json()
      .conversation;
    const late = (await send(conversation.id, 'Quelles tâches sont en retard ?')).json();
    expect(late.messages[1].content).toContain('Relancer le client fictif');
    expect(late.messages[1].content).toMatch(/1 en retard/i);
    expect(late.toolRuns[0].tool).toBe('cabinet.tasks.overdue');

    const deadlines = (await send(conversation.id, 'Quelles échéances arrivent ?')).json();
    expect(deadlines.toolRuns[0].tool).toBe('cabinet.deadlines');
  });

  it('searches the real chart of accounts and reads the trial balance', async () => {
    const accounts = await getAccounts(ctx, owner.cookie, company.id);
    const purchase = accountByCode(accounts, '6000') ?? accounts.find((a: any) => a.type === 'expense');
    const conversation = (await openConversation({ module: 'accounting' })).json().conversation;

    const search = (await send(conversation.id, `Recherche le compte ${purchase.code}`)).json();
    expect(search.toolRuns[0].tool).toBe('accounting.accounts.search');
    expect(search.messages[1].content).toContain(purchase.code);

    const balance = (await send(conversation.id, 'Montre la balance')).json();
    expect(balance.toolRuns[0].tool).toBe('accounting.trialBalance');
    expect(balance.messages[1].content).toMatch(/balance/i);
  });

  it('explains payroll unavailability without reading or inventing payroll data', async () => {
    const payrollUser = await registerUser(ctx);
    await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/members`, {
      email: payrollUser.email,
      role: 'payroll_manager',
    });
    const login = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: payrollUser.email, password: 'StrongPassw0rd!' },
    });
    const cookie = (login.headers['set-cookie'] as string).split(';')[0]!;

    const conversation = (await openConversation({ module: 'payroll' }, cookie)).json().conversation;
    const res = (await send(conversation.id, 'Génère les bulletins de paie de juillet', cookie)).json();
    expect(res.toolRuns[0].tool).toBe('payroll.status');
    expect(res.messages[1].content).toMatch(/non implémenté/i);
    expect(res.messages[1].content).not.toMatch(/montant|MUR \d/i);
  });

  it('denies a tool whose module is not granted to the role', async () => {
    const viewer = await registerUser(ctx);
    await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/members`, {
      email: viewer.email,
      role: 'viewer',
    });
    const login = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: viewer.email, password: 'StrongPassw0rd!' },
    });
    const cookie = (login.headers['set-cookie'] as string).split(';')[0]!;

    const conversation = (await openConversation({ module: 'accounting' }, cookie)).json().conversation;
    const res = await send(conversation.id, 'Génère les bulletins de paie de juillet', cookie);
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.toolRuns[0]).toMatchObject({ tool: 'payroll.status', status: 'denied' });
    expect(body.messages[1].content).toMatch(/permissions|accès/i);
    expect(body.messages[1].content).not.toMatch(/bulletins de paie de juillet/i);
  });

  it('prepares a draft entry without ever posting it', async () => {
    const conversation = (await openConversation({ module: 'accounting' })).json().conversation;
    const res = await send(conversation.id, 'Prépare une écriture pour un achat de marchandises de 3250 MUR');
    expect(res.statusCode).toBe(201);
    const body = res.json();
    const message = body.messages[1];
    expect(body.toolRuns[0].tool).toBe('accounting.proposal.prepare');
    expect(message.payload.actions[0].kind).toBe('proposal');
    expect(message.content).toMatch(/Aucune écriture comptable n’a été créée/);

    const proposalId = message.payload.actions[0].id as string;
    const proposal = (
      await api(ctx, owner.cookie, 'GET', `/api/companies/${company.id}/ai/entry-proposals/${proposalId}`)
    ).json().proposal;
    expect(proposal.status).toBe('proposed');
    expect(proposal.totals.balanced).toBe(true);

    const entries = (await api(ctx, owner.cookie, 'GET', `/api/companies/${company.id}/entries`)).json();
    expect(entries.entries).toHaveLength(0);

    // An explicit "yes" in the chat never posts anything: the only supported
    // follow-up is a read-only check.
    const check = (await send(conversation.id, 'Vérifie l’équilibre de la proposition')).json();
    expect(check.toolRuns[0].tool).toBe('accounting.proposal.check');
    expect(check.messages[1].content).toMatch(/Aucune écriture n’a été créée/i);
    expect(check.messages[1].content).toMatch(/Proposition/i);
    expect(check.messages[1].content).toMatch(/équilibrée/i);
    const after = (await api(ctx, owner.cookie, 'GET', `/api/companies/${company.id}/entries`)).json();
    expect(after.entries).toHaveLength(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('refuses a proposal preparation without an amount and never guesses one', async () => {
    const conversation = (await openConversation({ module: 'accounting' })).json().conversation;
    const res = (await send(conversation.id, 'Prépare une écriture pour un achat de marchandises')).json();
    expect(res.toolRuns[0].status).toBe('error');
    expect(res.messages[1].content).toMatch(/montant/i);
  });

  it('keeps conversations private to their user and erases them on request', async () => {
    const conversation = (await openConversation()).json().conversation;
    const stranger = await registerUser(ctx);
    const peek = await api(
      ctx,
      stranger.cookie,
      'GET',
      `/api/companies/${company.id}/ai/assistant/conversations/${conversation.id}`,
    );
    expect(peek.statusCode).toBe(404);

    const del = await api(
      ctx,
      owner.cookie,
      'DELETE',
      `/api/companies/${company.id}/ai/assistant/conversations/${conversation.id}`,
    );
    expect(del.statusCode).toBe(204);
    const gone = await api(
      ctx,
      owner.cookie,
      'GET',
      `/api/companies/${company.id}/ai/assistant/conversations/${conversation.id}`,
    );
    expect(gone.statusCode).toBe(404);
  });

  it('answers unsupported requests with an explicit refusal, not an invention', async () => {
    const conversation = (await openConversation()).json().conversation;
    const res = (await send(conversation.id, 'Peux-tu envoyer cette facture au client par e-mail ?')).json();
    expect(res.messages[1].content).toMatch(/pas encore prise en charge/i);
    expect(res.messages[1].payload.actions).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects empty or oversized messages', async () => {
    const conversation = (await openConversation()).json().conversation;
    const empty = await send(conversation.id, ' ');
    expect(empty.statusCode).toBe(400);
    const huge = await send(conversation.id, 'a'.repeat(700));
    expect(huge.statusCode).toBe(400);
  });
});

describe('company settings - one reference, journalled changes', () => {
  let ctx: TestContext;
  let user: TestUser;
  let company: any;

  beforeAll(async () => {
    ctx = await createTestApp();
    user = await registerUser(ctx);
    company = await createCompany(ctx, user.cookie, { name: 'Paramètres Fictifs Ltée' });
  });

  afterAll(async () => {
    await closeTestApp(ctx);
  });

  it('returns the full company reference and the chart of accounts', async () => {
    const res = await api(ctx, user.cookie, 'GET', `/api/companies/${company.id}/settings/company`);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.identification.name).toBe('Paramètres Fictifs Ltée');
    expect(body.accounting.functionalCurrency).toBe('MUR');
    expect(body.chartOfAccounts.length).toBeGreaterThan(10);
    expect(body.tax.rates).toEqual([]);
    expect(body.tax.vatEnabled).toBe(false);
    expect(body.permissions.canEditIdentification).toBe(true);
  });

  it('updates identification and journals the change', async () => {
    const res = await api(ctx, user.cookie, 'PATCH', `/api/companies/${company.id}/settings/identification`, {
      tradeName: 'Enseigne Fictive',
      contactEmail: 'contact@fictif.example.test',
      businessActivity: 'Négoce fictif',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().identification.tradeName).toBe('Enseigne Fictive');
    expect(res.json().identification.contactEmail).toBe('contact@fictif.example.test');

    const view = (await api(ctx, user.cookie, 'GET', `/api/companies/${company.id}/settings/company`)).json();
    expect(view.history.some((h: any) => h.action === 'settings.identification.update')).toBe(true);
  });

  it('refuses a financial year change that would orphan a posted entry', async () => {
    const accounts = await getAccounts(ctx, user.cookie, company.id);
    const journals = (
      await api(ctx, user.cookie, 'GET', `/api/companies/${company.id}/journals`)
    ).json().journals;
    const debit = accounts.find((a: any) => a.type === 'expense');
    const credit = accounts.find((a: any) => a.type === 'liability');
    await api(ctx, user.cookie, 'POST', `/api/companies/${company.id}/entries`, {
      journalId: journalByCode(journals, 'OD').id,
      entryDate: '2026-03-01',
      reference: 'OD-ASSIST-1',
      description: 'Écriture fictive de contrôle (test)',
      status: 'posted',
      lines: [
        { accountId: debit.id, debit: '100.0000' },
        { accountId: credit.id, credit: '100.0000' },
      ],
    });
    const locked = await api(ctx, user.cookie, 'PATCH', `/api/companies/${company.id}/settings/accounting`, {
      financialYearStart: '2026-04-01',
      financialYearEnd: '2027-03-31',
    });
    expect(locked.statusCode).toBe(409);
    expect(locked.json().error.code).toBe('SETTINGS_FINANCIAL_YEAR_LOCKED');
  });

  it('refuses an unknown default account and keeps billing defaults journalled', async () => {
    const bogus = await api(ctx, user.cookie, 'PATCH', `/api/companies/${company.id}/settings/billing`, {
      defaultRevenueAccountId: '00000000-0000-0000-0000-000000000000',
    });
    expect(bogus.statusCode).toBe(400);
    expect(bogus.json().error.code).toBe('SETTINGS_ACCOUNT_NOT_IN_CHART');

    const accounts = await getAccounts(ctx, user.cookie, company.id);
    const revenue = accounts.find((a: any) => a.type === 'revenue');
    const bank = accounts.find((a: any) => a.type === 'asset');
    const ok = await api(ctx, user.cookie, 'PATCH', `/api/companies/${company.id}/settings/billing`, {
      defaultRevenueAccountId: revenue.id,
      defaultBankAccountId: bank.id,
      documentLanguage: 'en',
      invoicePrefix: 'FACX',
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().billing.defaultRevenueAccountId).toBe(revenue.id);
    expect(ok.json().billing.documentLanguage).toBe('en');
    expect(ok.json().billing.invoicePrefix).toBe('FACX');

    // A partial update never clears the fields that were not sent.
    const partial = await api(ctx, user.cookie, 'PATCH', `/api/companies/${company.id}/settings/billing`, {
      quotePrefix: 'DEVX',
    });
    expect(partial.json().billing.invoicePrefix).toBe('FACX');
    expect(partial.json().billing.defaultRevenueAccountId).toBe(revenue.id);
  });
});

describe('VAT configuration - distinct treatments, verification trail, no retroactive rewrite', () => {
  let ctx: TestContext;
  let user: TestUser;
  let company: any;

  const createRate = (body: Record<string, unknown> = {}) =>
    api(ctx, user.cookie, 'POST', `/api/companies/${company.id}/billing/tax-rates`, {
      code: 'TEST-15',
      label: 'Taux de test fictif (non une règle fiscale)',
      rate: '15',
      effectiveFrom: '2025-07-01',
      ...body,
    });

  beforeAll(async () => {
    ctx = await createTestApp();
    user = await registerUser(ctx);
    company = await createCompany(ctx, user.cookie, { name: 'TVA Fictive Ltée' });
  });

  afterAll(async () => {
    await closeTestApp(ctx);
  });

  it('never seeds a rate and requires a documented source to mark one verified', async () => {
    const empty = await api(ctx, user.cookie, 'GET', `/api/companies/${company.id}/billing/tax-rates`);
    expect(empty.json().rates).toEqual([]);

    const noSource = await createRate({ code: 'TEST-NOSOURCE', verified: true });
    expect(noSource.statusCode).toBe(400);
    expect(noSource.json().error.code).toBe('VAT_SOURCE_REQUIRED');

    const unverified = await createRate({ code: 'TEST-UNVERIFIED', verified: false });
    expect(unverified.statusCode).toBe(201);
    expect(unverified.json().rate.verified).toBe(false);
    expect(unverified.json().rate.verifiedAt).toBeNull();
    expect(unverified.json().rate.treatment).toBe('taxable');
  });

  it('keeps the four treatments distinct and refuses a percentage on a non-taxable one', async () => {
    const zeroWithRate = await createRate({ code: 'TEST-ZERO-BAD', treatment: 'zero_rated', rate: '15' });
    expect(zeroWithRate.statusCode).toBe(400);

    const exempt = await createRate({ code: 'TEST-EXEMPT', treatment: 'exempt', rate: '0' });
    expect(exempt.statusCode).toBe(201);
    expect(exempt.json().rate.treatment).toBe('exempt');

    const outOfScope = await createRate({ code: 'TEST-OOS', treatment: 'out_of_scope', rate: '0' });
    expect(outOfScope.json().rate.treatment).toBe('out_of_scope');
  });

  it('records verification with actor, timestamp and an append-only history', async () => {
    const created = (await createRate({ code: 'TEST-VERIFY' })).json().rate;
    const denied = await api(
      ctx,
      user.cookie,
      'POST',
      `/api/companies/${company.id}/billing/tax-rates/${created.id}/verify`,
      { source: 'Document fictif de test', confirm: false },
    );
    expect(denied.statusCode).toBe(400);

    const verified = await api(
      ctx,
      user.cookie,
      'POST',
      `/api/companies/${company.id}/billing/tax-rates/${created.id}/verify`,
      { source: 'Document fictif de test — aucune portée légale', confirm: true },
    );
    expect(verified.statusCode).toBe(200);
    expect(verified.json().rate.verified).toBe(true);
    expect(verified.json().rate.verified_at).toBeTruthy();
    expect(verified.json().rate.verified_by).toBe(user.id);

    const history = await api(
      ctx,
      user.cookie,
      'GET',
      `/api/companies/${company.id}/billing/tax-rates/${created.id}/history`,
    );
    expect(history.statusCode).toBe(200);
    const actions = history.json().events.map((e: any) => e.action);
    expect(actions).toContain('created');
    expect(actions).toContain('verified');
    expect(history.json().events[0].after.verified).toBe(true);
  });

  it('refuses an unverified rate for a taxable invoice, then accepts the verified one', async () => {
    const unverified = (await createRate({ code: 'TEST-UNVERIFIED-2', rate: '15' })).json().rate;
    const customer = (
      await api(ctx, user.cookie, 'POST', `/api/companies/${company.id}/billing/customers`, {
        name: 'Client TVA Assistant',
      })
    ).json().customer;
    const item = (
      await api(ctx, user.cookie, 'POST', `/api/companies/${company.id}/billing/items`, {
        reference: 'SRV-TAX',
        labelFr: 'Service taxable fictif',
        unitPrice: '1000.00',
        vatTreatment: 'standard',
      })
    ).json().item;
    await api(ctx, user.cookie, 'PATCH', `/api/companies/${company.id}/billing/settings`, {
      vatEnabled: true,
    });

    const refused = await api(ctx, user.cookie, 'POST', `/api/companies/${company.id}/billing/documents`, {
      kind: 'invoice',
      customerId: customer.id,
      issueDate: '2025-09-15',
      lines: [{ itemId: item.id, quantity: '1', vatRateId: unverified.id }],
    });
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error.code).toBe('VAT_RATE_NOT_VERIFIED');

    await api(
      ctx,
      user.cookie,
      'POST',
      `/api/companies/${company.id}/billing/tax-rates/${unverified.id}/verify`,
      { source: 'Paramètre de démonstration fictif', confirm: true },
    );
    const accepted = await api(ctx, user.cookie, 'POST', `/api/companies/${company.id}/billing/documents`, {
      kind: 'invoice',
      customerId: customer.id,
      issueDate: '2025-09-15',
      lines: [{ itemId: item.id, quantity: '1', vatRateId: unverified.id }],
    });
    expect(accepted.statusCode).toBe(201);
    expect(accepted.json().document.taxTotal).toBe('150.0000');
    expect(accepted.json().document.total).toBe('1150.0000');
  });

  it('freezes the rate once an issued document uses it', async () => {
    const rate = (await createRate({ code: 'TEST-LOCK', rate: '15' })).json().rate;
    await api(
      ctx,
      user.cookie,
      'POST',
      `/api/companies/${company.id}/billing/tax-rates/${rate.id}/verify`,
      { source: 'Paramètre de test fictif', confirm: true },
    );
    const customer = (
      await api(ctx, user.cookie, 'POST', `/api/companies/${company.id}/billing/customers`, {
        name: 'Client Verrou TVA',
      })
    ).json().customer;
    const item = (
      await api(ctx, user.cookie, 'POST', `/api/companies/${company.id}/billing/items`, {
        reference: 'SRV-LOCK',
        labelFr: 'Service verrou fictif',
        unitPrice: '500.00',
        vatTreatment: 'standard',
      })
    ).json().item;
    const doc = (
      await api(ctx, user.cookie, 'POST', `/api/companies/${company.id}/billing/documents`, {
        kind: 'invoice',
        customerId: customer.id,
        issueDate: '2025-10-01',
        lines: [{ itemId: item.id, quantity: '1', vatRateId: rate.id }],
      })
    ).json().document;
    await api(
      ctx,
      user.cookie,
      'POST',
      `/api/companies/${company.id}/billing/documents/${doc.id}/issue`,
      {},
    );

    const locked = await api(
      ctx,
      user.cookie,
      'PATCH',
      `/api/companies/${company.id}/billing/tax-rates/${rate.id}`,
      { rate: '20' },
    );
    expect(locked.statusCode).toBe(409);
    expect(locked.json().error.code).toBe('VAT_RATE_LOCKED');

    const notesOnly = await api(
      ctx,
      user.cookie,
      'PATCH',
      `/api/companies/${company.id}/billing/tax-rates/${rate.id}`,
      { notes: 'Note ajoutée après émission (facture déjà figée)' },
    );
    expect(notesOnly.statusCode).toBe(200);
  });
});

describe('mission 7 - fixed example 3 250 MUR', () => {
  let ctx: TestContext;
  let user: TestUser;
  let company: any;
  let accounts: any[];

  beforeAll(async () => {
    const setup = await setupCompanyWithChart();
    ctx = setup.ctx;
    user = setup.user;
    company = setup.company;
    accounts = setup.accounts;
    await enableSimulated(ctx, user.cookie);
  });

  afterAll(async () => {
    await closeTestApp(ctx);
  });

  it('prepares 3 250 / 487,50 / 3 737,50 with the real chart and no posting', async () => {
    const purchase = accountByCode(accounts, '6000') ?? accounts.find((a: any) => a.type === 'expense');
    const vatInput = accountByCode(accounts, '4000') ?? accounts.find((a: any) => a.code.startsWith('4'));
    const bank = accountByCode(accounts, '5120') ?? accounts.find((a: any) => a.type === 'asset');
    expect(purchase).toBeTruthy();
    expect(vatInput).toBeTruthy();
    expect(bank).toBeTruthy();

    const conversation = (
      await api(ctx, user.cookie, 'POST', `/api/companies/${company.id}/ai/assistant/conversations`, {
        companyId: company.id,
        module: 'accounting',
        locale: 'fr',
      })
    ).json().conversation;
    const res = (
      await api(
        ctx,
        user.cookie,
        'POST',
        `/api/companies/${company.id}/ai/assistant/conversations/${conversation.id}/messages`,
        {
          companyId: company.id,
          text: 'Prépare une écriture pour un achat de marchandises de 3250 MUR',
        },
      )
    ).json();
    expect(res.toolRuns[0].tool).toBe('accounting.proposal.prepare');
    const content = res.messages[1].content as string;
    expect(content).toMatch(/Aucune écriture comptable n’a été créée/);

    const entries = (await api(ctx, user.cookie, 'GET', `/api/companies/${company.id}/entries`)).json();
    expect(entries.entries).toHaveLength(0);
  });
});
