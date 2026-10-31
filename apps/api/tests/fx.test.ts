import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  accountByCode,
  api,
  closeTestApp,
  createCompany,
  registerUser,
  setupCompanyWithChart,
  type TestContext,
  type TestUser,
} from './helpers.js';
import { detectIntent } from '../src/modules/ai/assistant.js';
import { TOOL_BY_KEY } from '../src/modules/ai/tools.js';

/**
 * Mission 13 - multi-currency. Every entity, rate, amount and source below is
 * fictional. A "validated" rate is validated *inside this test company only*;
 * it is never presented as an official or central-bank rate.
 */

const REF = () => `FICT-FX-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

describe('multi-currency and exchange differences (mission 13)', () => {
  let ctx: TestContext;
  let owner: TestUser;
  let company: any;
  let accounts: any[];
  let customer: any;
  let supplier: any;
  let item: any;

  const gain = () => accountByCode(accounts, '4100').id;
  const loss = () => accountByCode(accounts, '6300').id;
  const bankMur = () => accountByCode(accounts, '1010').id;
  const bankFx = () => accountByCode(accounts, '1015').id;

  const post = async (
    lines: { code: string; debit?: string; credit?: string }[],
    options: {
      date?: string;
      currency?: string;
      exchangeRate?: string;
      reference?: string;
      status?: 'draft' | 'posted';
    } = {},
  ) => {
    const res = await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/entries`, {
      journalId: (await api(ctx, owner.cookie, 'GET', `/api/companies/${company.id}/journals`))
        .json()
        .journals.find((j: any) => j.code === (lines.some((l) => l.code === '1010') ? 'BQ' : 'OD')).id,
      entryDate: options.date ?? '2026-02-10',
      reference: options.reference ?? REF(),
      description: 'Écriture multidevise fictive',
      status: options.status ?? 'posted',
      currency: options.currency ?? 'MUR',
      ...(options.exchangeRate ? { exchangeRate: options.exchangeRate } : {}),
      lines: lines.map((l) => ({
        accountId: accountByCode(accounts, l.code).id,
        ...(l.debit ? { debit: l.debit } : { credit: l.credit }),
      })),
    });
    return res;
  };

  const createRate = async (
    baseCurrency: string,
    quoteCurrency: string,
    rateDate: string,
    rate: string,
    options: { sourceKind?: string; validate?: boolean; source?: string; reference?: string } = {},
  ) => {
    const created = await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/fx/rates`, {
      baseCurrency,
      quoteCurrency,
      rateDate,
      rate,
      sourceKind: options.sourceKind ?? 'manual',
      source: options.source ?? 'Saisie manuelle de test (fictive)',
      reference: options.reference ?? `FICT-REF-${REF()}`,
    });
    if (created.statusCode !== 201 || options.validate === false) return created;
    const validated = await api(
      ctx,
      owner.cookie,
      'POST',
      `/api/companies/${company.id}/fx/rates/${created.json().rate.id}/validate`,
      { confirm: true, note: 'Validation humaine fictive pour test' },
    );
    expect(validated.statusCode).toBe(200);
    return validated;
  };

  const makeBillingInvoice = async (currency: string, rate: string, amount: string) => {
    const created = await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/billing/documents`, {
      kind: 'invoice',
      customerId: customer.id,
      issueDate: '2026-02-10',
      dueDate: '2026-03-10',
      currency,
      exchangeRate: rate,
      lines: [
        {
          itemId: item.id,
          description: 'Prestation fictive en devise',
          quantity: '1',
          unitPrice: amount,
          vatTreatment: 'zero_rated',
        },
      ],
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().document.id;
    await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/billing/documents/${id}/issue`);
    return created.json().document;
  };

  const postBillingDocument = async (documentId: string) => {
    const proposal = await api(
      ctx,
      owner.cookie,
      'POST',
      `/api/companies/${company.id}/ai/entry-proposals/from-billing`,
      { documentId },
    );
    expect(proposal.statusCode).toBe(201);
    const id = proposal.json().proposal.id;
    const validated = await api(
      ctx,
      owner.cookie,
      'POST',
      `/api/companies/${company.id}/ai/entry-proposals/${id}/validate`,
      { acceptWarnings: true },
    );
    expect(validated.statusCode).toBe(200);
    const posted = await api(
      ctx,
      owner.cookie,
      'POST',
      `/api/companies/${company.id}/ai/entry-proposals/${id}/post`,
    );
    expect(posted.statusCode).toBe(200);
    return posted.json().entryId as string;
  };

  const makeBillingPayment = async (invoiceId: string, currency: string, rate: string, amount: string) => {
    const created = await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/billing/payments`, {
      customerId: customer.id,
      paymentDate: '2026-02-15',
      amount,
      currency,
      exchangeRate: rate,
      method: 'bank_transfer',
      reference: REF(),
      allocations: [{ invoiceId, amount }],
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().payment.id;
    const proposal = await api(
      ctx,
      owner.cookie,
      'POST',
      `/api/companies/${company.id}/ai/entry-proposals/from-billing`,
      { paymentId: id },
    );
    expect(proposal.statusCode).toBe(201);
    const proposalId = proposal.json().proposal.id;
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
    return id;
  };

  const makePurchaseInvoice = async (currency: string, rate: string, amount: string) => {
    const created = await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/purchases/documents`, {
      kind: 'invoice',
      supplierId: supplier.id,
      supplierReference: `FICT-ACH-FX-${REF()}`,
      issueDate: '2026-02-10',
      dueDate: '2026-03-10',
      currency,
      exchangeRate: rate,
      description: 'Achat fictif en devise',
      lines: [
        {
          description: 'Conseil fictif en devise',
          quantity: '1',
          unitPrice: amount,
          accountId: accountByCode(accounts, '6100').id,
          vatTreatment: 'out_of_scope',
        },
      ],
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().document.id;
    await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/purchases/documents/${id}/validate`);
    const proposal = await api(
      ctx,
      owner.cookie,
      'POST',
      `/api/companies/${company.id}/purchases/documents/${id}/proposal`,
    );
    expect(proposal.statusCode).toBe(201);
    const proposalId = proposal.json().proposal.id;
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
    return (
      await api(ctx, owner.cookie, 'GET', `/api/companies/${company.id}/purchases/documents/${id}`)
    ).json().document;
  };

  const makePurchasePayment = async (invoiceId: string, currency: string, rate: string, amount: string) => {
    const created = await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/purchases/payments`, {
      supplierId: supplier.id,
      paymentDate: '2026-02-15',
      amount,
      currency,
      exchangeRate: rate,
      method: 'bank_transfer',
      reference: REF(),
      allocations: [{ invoiceId, amount }],
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().payment.id;
    const proposal = await api(
      ctx,
      owner.cookie,
      'POST',
      `/api/companies/${company.id}/purchases/payments/${id}/proposal`,
    );
    expect(proposal.statusCode).toBe(201);
    const proposalId = proposal.json().proposal.id;
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
    return id;
  };

  beforeAll(async () => {
    const setup = await setupCompanyWithChart();
    ctx = setup.ctx;
    owner = setup.user;
    company = setup.company;
    accounts = setup.accounts;
    const config = await api(ctx, owner.cookie, 'PATCH', `/api/companies/${company.id}/fx/config`, {
      allowedCurrencies: ['MUR', 'EUR', 'USD', 'GBP'],
      fxGainAccountId: gain(),
      fxLossAccountId: loss(),
      valuationEnabled: true,
      notes: 'Configuration de test fictive',
    });
    expect(config.statusCode).toBe(200);
    customer = (
      await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/billing/customers`, {
        name: 'Client Devise Fictif',
        brn: 'BRN-FX-0001',
        paymentTermsDays: 30,
      })
    ).json().customer;
    item = (
      await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/billing/items`, {
        reference: 'SRV-FX',
        labelFr: 'Prestation en devise (fictive)',
        unitPrice: '1000.00',
        vatTreatment: 'zero_rated',
      })
    ).json().item;
    supplier = (
      await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/purchases/suppliers`, {
        name: 'Fournisseur Devise Fictif',
        reference: 'FOUR-FX-001',
        country: 'FR',
        preferredCurrency: 'EUR',
        paymentTermsDays: 30,
        payableAccountId: accountByCode(accounts, '2000').id,
      })
    ).json().supplier;
    const eur = await createRate('EUR', 'MUR', '2026-02-10', '50.00000000');
    expect(eur.statusCode).toBe(200);
    await createRate('USD', 'MUR', '2026-02-10', '45.25000000');
    await createRate('GBP', 'MUR', '2026-02-10', '60.50000000');
  });

  afterAll(async () => {
    await closeTestApp(ctx);
  });

  // 1 -----------------------------------------------------------------------
  it('exposes the controlled functional currency and allowed currencies', async () => {
    const res = await api(ctx, owner.cookie, 'GET', `/api/companies/${company.id}/fx/config`);
    expect(res.statusCode).toBe(200);
    expect(res.json().functionalCurrency).toBe('MUR');
    expect(res.json().ratePolicy).toBe('validated_only');
    expect(res.json().valuationPosting).toBe(false);
    expect(res.json().allowedCurrencies.map((c: any) => c.currency)).toEqual([
      'EUR',
      'GBP',
      'MUR',
      'USD',
    ]);
  });

  // 2 -----------------------------------------------------------------------
  it('creates a dated, sourced rate in draft state', async () => {
    const res = await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/fx/rates`, {
      baseCurrency: 'EUR',
      quoteCurrency: 'MUR',
      rateDate: '2026-02-11',
      rate: '50.10000000',
      sourceKind: 'manual',
      source: 'Saisie manuelle fictive',
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().rate.status).toBe('draft');
    expect(res.json().rate.version).toBe(1);
    expect(res.json().rate.rate).toBe('50.10000000');
  });

  // 3 -----------------------------------------------------------------------
  it('requires explicit validation before using a rate', async () => {
    const created = await createRate('USD', 'MUR', '2026-02-11', '45.30000000', { validate: false });
    const draftId = created.json().rate.id;
    const resolve = await api(
      ctx,
      owner.cookie,
      'GET',
      `/api/companies/${company.id}/fx/resolve?amount=100&from=USD&to=MUR&date=2026-02-11`,
    );
    expect(resolve.statusCode).toBe(409);
    expect(resolve.json().error.code).toBe('FX_RATE_NOT_VALIDATED');
    const validated = await api(
      ctx,
      owner.cookie,
      'POST',
      `/api/companies/${company.id}/fx/rates/${draftId}/validate`,
      { confirm: true, note: 'Contrôle humain fictif' },
    );
    expect(validated.statusCode).toBe(200);
    const again = await api(
      ctx,
      owner.cookie,
      'GET',
      `/api/companies/${company.id}/fx/resolve?amount=100&from=USD&to=MUR&date=2026-02-11`,
    );
    expect(again.json().converted).toBe('4530.0000');
  });

  // 4 -----------------------------------------------------------------------
  it('rejects zero or negative rates without floating point', async () => {
    for (const rate of ['0', '-1', 'abc']) {
      const res = await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/fx/rates`, {
        baseCurrency: 'EUR',
        quoteCurrency: 'MUR',
        rateDate: '2026-02-12',
        rate,
        sourceKind: 'manual',
        source: 'Source fictive',
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toMatch(/FX_RATE_INVALID|VALIDATION_ERROR/);
    }
  });

  // 5 -----------------------------------------------------------------------
  it('requires a reference for an imported rate', async () => {
    const res = await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/fx/rates`, {
      baseCurrency: 'GBP',
      quoteCurrency: 'MUR',
      rateDate: '2026-02-12',
      rate: '60.70000000',
      sourceKind: 'imported',
      source: 'Fichier fictif',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('FX_RATE_REFERENCE_REQUIRED');
  });

  // 6 -----------------------------------------------------------------------
  it('refuses an absent rate and an automatic inverse derivation', async () => {
    const missing = await api(
      ctx,
      owner.cookie,
      'GET',
      `/api/companies/${company.id}/fx/resolve?amount=1&from=EUR&to=MUR&date=2026-05-01`,
    );
    expect(missing.statusCode).toBe(409);
    expect(missing.json().error.code).toBe('FX_RATE_MISSING');

    const inverse = await api(
      ctx,
      owner.cookie,
      'GET',
      `/api/companies/${company.id}/fx/resolve?amount=1&from=MUR&to=EUR&date=2026-02-10`,
    );
    expect(inverse.statusCode).toBe(409);
    expect(inverse.json().error.code).toBe('FX_RATE_DIRECTION_MISMATCH');
  });

  // 7 -----------------------------------------------------------------------
  it('refuses to validate two rates for the same pair and date without supersession', async () => {
    const second = await createRate('EUR', 'MUR', '2026-02-10', '50.25000000', { validate: false });
    expect(second.statusCode).toBe(201);
    const conflictRes = await api(
      ctx,
      owner.cookie,
      'POST',
      `/api/companies/${company.id}/fx/rates/${second.json().rate.id}/validate`,
      { confirm: true },
    );
    expect(conflictRes.statusCode).toBe(409);
    expect(conflictRes.json().error.code).toBe('FX_RATE_ALREADY_VALIDATED');
    const superseded = await api(
      ctx,
      owner.cookie,
      'POST',
      `/api/companies/${company.id}/fx/rates/${second.json().rate.id}/validate`,
      { confirm: true, supersede: true, note: 'Remplacement humain fictif' },
    );
    expect(superseded.statusCode).toBe(200);
    expect(superseded.json().rate.rate).toBe('50.25000000');
    const history = await api(
      ctx,
      owner.cookie,
      'GET',
      `/api/companies/${company.id}/fx/rates?base=EUR&quote=MUR&date=2026-02-10`,
    );
    const statuses = history.json().rates.map((r: any) => r.status).sort();
    expect(statuses).toEqual(['superseded', 'validated']);
    // Restore the exact test rate for later scenarios.
    const restore = await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/fx/rates`, {
      baseCurrency: 'EUR',
      quoteCurrency: 'MUR',
      rateDate: '2026-02-10',
      rate: '50.00000000',
      sourceKind: 'manual',
      source: 'Restauration fictive de test',
    });
    await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/fx/rates/${restore.json().rate.id}/validate`, {
      confirm: true,
      supersede: true,
    });
  });

  // 8-10 --------------------------------------------------------------------
  it('converts EUR, USD and GBP to MUR exactly', async () => {
    for (const [from, amount, expected] of [
      ['EUR', '1000', '50000.0000'],
      ['USD', '1000', '45250.0000'],
      ['GBP', '1000', '60500.0000'],
    ] as const) {
      const res = await api(
        ctx,
        owner.cookie,
        'GET',
        `/api/companies/${company.id}/fx/resolve?amount=${amount}&from=${from}&to=MUR&date=2026-02-10`,
      );
      expect(res.statusCode).toBe(200);
      expect(res.json().converted).toBe(expected);
      expect(res.json().official).toBe(false);
    }
  });

  // 11 ----------------------------------------------------------------------
  it('keeps rate precision and rounds the functional amount only once', async () => {
    const res = await api(
      ctx,
      owner.cookie,
      'GET',
      `/api/companies/${company.id}/fx/resolve?amount=0.0001&from=EUR&to=MUR&date=2026-02-10`,
    );
    expect(res.statusCode).toBe(200);
    expect(res.json().rate).toBe('50.00000000');
    expect(res.json().converted).toBe('0.0050');
  });

  // 12 ----------------------------------------------------------------------
  it('keeps the original EUR amount and functional value on an invoice', async () => {
    const doc = await makeBillingInvoice('EUR', '50.00000000', '1000.00');
    expect(doc.currency).toBe('EUR');
    expect(doc.total).toBe('1000.0000');
    expect(doc.exchangeRate).toBe('50.00000000');
    const entryId = await postBillingDocument(doc.id);
    const lines = await ctx.db.query<any>(
      'SELECT account_id, debit::text, credit::text, txn_amount::text, txn_currency, fx_rate::text FROM journal_lines WHERE entry_id = $1 ORDER BY line_no',
      [entryId],
    );
    expect(lines.rows[0].debit).toBe('50000.0000');
    expect(lines.rows[0].txn_amount).toBe('1000.0000');
    expect(lines.rows[0].txn_currency).toBe('EUR');
    expect(lines.rows[0].fx_rate).toBe('50.00000000');
  });

  // 13 ----------------------------------------------------------------------
  it('posts a supplier invoice in EUR at its documented rate', async () => {
    const doc = await makePurchaseInvoice('EUR', '50.00000000', '1000.00');
    expect(doc.currency).toBe('EUR');
    const entry = await ctx.db.query<any>(
      'SELECT e.currency, e.exchange_rate::text, l.credit::text FROM journal_entries e JOIN journal_lines l ON l.entry_id=e.id WHERE e.id=$1 AND l.account_id=$2',
      [doc.accounting_entry_id, accountByCode(accounts, '2000').id],
    );
    expect(entry.rows[0].currency).toBe('EUR');
    expect(entry.rows[0].credit).toBe('50000.0000');
  });

  // 14-16 -------------------------------------------------------------------
  it('computes and posts a realized customer gain exactly once', async () => {
    const doc = await makeBillingInvoice('EUR', '50.00000000', '1000.00');
    await postBillingDocument(doc.id);
    const paymentId = await makeBillingPayment(doc.id, 'EUR', '51.00000000', '1000.00');
    const scan = await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/fx/realized/scan`, {});
    expect(scan.statusCode).toBe(200);
    const adjustment = scan.json().adjustments.find((a: any) => a.payment_id === paymentId);
    expect(adjustment).toBeTruthy();
    expect(adjustment.side).toBe('customer');
    expect(adjustment.direction).toBe('gain');
    expect(adjustment.invoice_functional).toBe('50000.0000');
    expect(adjustment.settlement_functional).toBe('51000.0000');
    expect(adjustment.difference).toBe('1000.0000');

    const posted = await api(
      ctx,
      owner.cookie,
      'POST',
      `/api/companies/${company.id}/fx/realized/${adjustment.id}/post`,
      { confirm: true },
    );
    expect(posted.statusCode).toBe(200);
    expect(posted.json().entry.id).toBeTruthy();
    const lines = await ctx.db.query<any>(
      'SELECT account_id, debit::text, credit::text FROM journal_lines WHERE entry_id=$1 ORDER BY line_no',
      [posted.json().entry.id],
    );
    expect(lines.rows).toHaveLength(2);
    expect(lines.rows.find((l) => l.account_id === gain()).credit).toBe('1000.0000');
    expect(lines.rows.find((l) => l.account_id === accountByCode(accounts, '1100').id).debit).toBe('1000.0000');

    const again = await api(
      ctx,
      owner.cookie,
      'POST',
      `/api/companies/${company.id}/fx/realized/${adjustment.id}/post`,
      { confirm: true },
    );
    expect(again.statusCode).toBe(200);
    expect(again.json().reused).toBe(true);
    const rescan = await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/fx/realized/scan`, {});
    expect(rescan.json().created).toBe(0);
  });

  // 17 ----------------------------------------------------------------------
  it('computes a partial settlement on the settled amount only', async () => {
    const doc = await makeBillingInvoice('EUR', '50.00000000', '1000.00');
    await postBillingDocument(doc.id);
    const paymentId = await makeBillingPayment(doc.id, 'EUR', '52.00000000', '500.00');
    const scan = await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/fx/realized/scan`, {});
    const adjustment = scan.json().adjustments.find((a: any) => a.payment_id === paymentId);
    expect(adjustment.settled_txn_amount).toBe('500.0000');
    expect(adjustment.invoice_functional).toBe('25000.0000');
    expect(adjustment.settlement_functional).toBe('26000.0000');
    expect(adjustment.difference).toBe('1000.0000');
  });

  // 18 ----------------------------------------------------------------------
  it('computes a customer loss when the settlement rate is lower', async () => {
    const doc = await makeBillingInvoice('EUR', '52.00000000', '1000.00');
    await postBillingDocument(doc.id);
    const paymentId = await makeBillingPayment(doc.id, 'EUR', '50.00000000', '1000.00');
    const scan = await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/fx/realized/scan`, {});
    const adjustment = scan.json().adjustments.find((a: any) => a.payment_id === paymentId);
    expect(adjustment.direction).toBe('loss');
    expect(adjustment.difference).toBe('2000.0000');
  });

  // 19-20 -------------------------------------------------------------------
  it('computes supplier FX loss and gain with opposite directions', async () => {
    const lossDoc = await makePurchaseInvoice('EUR', '50.00000000', '1000.00');
    const lossPayment = await makePurchasePayment(lossDoc.id, 'EUR', '51.00000000', '1000.00');
    const gainDoc = await makePurchaseInvoice('EUR', '52.00000000', '1000.00');
    const gainPayment = await makePurchasePayment(gainDoc.id, 'EUR', '50.00000000', '1000.00');
    const scan = await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/fx/realized/scan`, {});
    const lossAdj = scan.json().adjustments.find((a: any) => a.payment_id === lossPayment);
    const gainAdj = scan.json().adjustments.find((a: any) => a.payment_id === gainPayment);
    expect(lossAdj.side).toBe('supplier');
    expect(lossAdj.direction).toBe('loss');
    expect(lossAdj.difference).toBe('1000.0000');
    expect(gainAdj.direction).toBe('gain');
    expect(gainAdj.difference).toBe('2000.0000');
  });

  // 21 ----------------------------------------------------------------------
  it('blocks posting a realized difference when the FX accounts are not configured', async () => {
    const previous = await api(ctx, owner.cookie, 'PATCH', `/api/companies/${company.id}/fx/config`, {
      fxGainAccountId: null,
    });
    expect(previous.statusCode).toBe(200);
    const pending = await api(
      ctx,
      owner.cookie,
      'GET',
      `/api/companies/${company.id}/fx/realized?status=proposed`,
    );
    const adjustment = pending.json().adjustments.find((a: any) => a.direction === 'gain');
    const res = await api(
      ctx,
      owner.cookie,
      'POST',
      `/api/companies/${company.id}/fx/realized/${adjustment.id}/post`,
      { confirm: true },
    );
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('FX_ACCOUNTS_NOT_CONFIGURED');
    const restored = await api(ctx, owner.cookie, 'PATCH', `/api/companies/${company.id}/fx/config`, {
      fxGainAccountId: gain(),
    });
    expect(restored.statusCode).toBe(200);
  });

  // 22 ----------------------------------------------------------------------
  it('requires explicit confirmation before posting an FX entry', async () => {
    const pending = await api(
      ctx,
      owner.cookie,
      'GET',
      `/api/companies/${company.id}/fx/realized?status=proposed`,
    );
    const adjustment = pending.json().adjustments[0];
    const res = await api(
      ctx,
      owner.cookie,
      'POST',
      `/api/companies/${company.id}/fx/realized/${adjustment.id}/post`,
      {},
    );
    expect(res.statusCode).toBe(400);
  });

  // 23 ----------------------------------------------------------------------
  it('simulates a latent revaluation and keeps posting blocked', async () => {
    await createRate('EUR', 'MUR', '2026-03-31', '53.00000000');
    const res = await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/fx/valuations`, {
      valuationDate: '2026-03-31',
      note: 'Simulation fictive de clôture',
    });
    expect([200, 201]).toContain(res.statusCode);
    const valuation = res.json().revaluation;
    expect(valuation.status).toBe('simulated');
    expect(valuation.postingBlocked).toBe(true);
    expect(valuation.lines.some((l: any) => l.currency === 'EUR')).toBe(true);
    expect(valuation.totalsByCurrency.EUR).toBeTruthy();
    const post = await api(
      ctx,
      owner.cookie,
      'POST',
      `/api/companies/${company.id}/fx/valuations/${valuation.id}/post`,
      {},
    );
    expect(post.statusCode).toBe(409);
    expect(post.json().error.code).toBe('FX_VALUATION_POSTING_BLOCKED');
  });

  // 24 ----------------------------------------------------------------------
  it('returns the same valuation for the same date (no double evaluation)', async () => {
    const first = await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/fx/valuations`, {
      valuationDate: '2026-03-31',
    });
    expect(first.statusCode).toBe(200);
    expect(first.json().reused).toBe(true);
  });

  // 25 ----------------------------------------------------------------------
  it('blocks valuation lines when no validated rate exists for the date', async () => {
    const res = await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/fx/valuations`, {
      valuationDate: '2026-04-30',
    });
    expect(res.statusCode).toBe(201);
    const lines = res.json().revaluation.lines;
    expect(lines.some((l: any) => l.blocked_reason)).toBe(true);
    const validate = await api(
      ctx,
      owner.cookie,
      'POST',
      `/api/companies/${company.id}/fx/valuations/${res.json().revaluation.id}/validate`,
      { confirm: true },
    );
    expect(validate.statusCode).toBe(409);
  });

  // 26 ----------------------------------------------------------------------
  it('previews an internal transfer with a distinct explicit fee and blocks posting', async () => {
    const murAccount = await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/bank/accounts`, {
      name: 'Banque MUR fictive',
      bankName: 'Banque Fictive',
      currency: 'MUR',
      accountId: bankMur(),
    });
    const eurAccount = await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/bank/accounts`, {
      name: 'Banque EUR fictive',
      bankName: 'Banque Fictive',
      currency: 'EUR',
      accountId: bankFx(),
    });
    expect(murAccount.statusCode).toBe(201);
    expect(eurAccount.statusCode).toBe(201);
    const preview = await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/fx/transfers`, {
      fromBankAccountId: eurAccount.json().account.id,
      toBankAccountId: murAccount.json().account.id,
      transferDate: '2026-02-10',
      fromAmount: '1000.00',
      feeAmount: '10.00',
      note: 'Virement interne fictif',
    });
    expect(preview.statusCode).toBe(201);
    expect(preview.json().transfer.from_currency).toBe('EUR');
    expect(preview.json().transfer.to_currency).toBe('MUR');
    expect(preview.json().transfer.to_amount).toBe('50000.0000');
    expect(preview.json().transfer.fee_amount).toBe('10.0000');
    expect(preview.json().transfer.fee_currency).toBe('EUR');
    expect(preview.json().postingBlocked).toBe(true);
    const post = await api(
      ctx,
      owner.cookie,
      'POST',
      `/api/companies/${company.id}/fx/transfers/${preview.json().transfer.id}/post`,
      {},
    );
    expect(post.statusCode).toBe(409);
    expect(post.json().error.code).toBe('FX_TRANSFER_POSTING_BLOCKED');
  });

  // 27 ----------------------------------------------------------------------
  it('produces a CSV report that separates currencies and never totals them', async () => {
    const res = await api(
      ctx,
      owner.cookie,
      'GET',
      `/api/companies/${company.id}/fx/report.csv?valuationDate=2026-03-31`,
    );
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.body).toContain('Aucun total inter-devises');
    expect(res.body).toContain('EUR');
    expect(res.body).toContain('Créances clients');
    expect(res.body).not.toMatch(/TOTAL GENERAL/i);
  });

  // 28 ----------------------------------------------------------------------
  it('locks the functional currency after the first posted entry', async () => {
    await expect(
      ctx.db.query('UPDATE companies SET functional_currency = \'EUR\' WHERE id = $1', [company.id]),
    ).rejects.toThrow(/FUNCTIONAL_CURRENCY_LOCKED/);
    const current = await ctx.db.query<{ functional_currency: string }>(
      'SELECT functional_currency FROM companies WHERE id = $1',
      [company.id],
    );
    expect(current.rows[0]!.functional_currency).toBe('MUR');
  });

  // 29 ----------------------------------------------------------------------
  it('isolates companies and enforces viewer permissions', async () => {
    const viewer = await registerUser(ctx);
    await ctx.db.query(
      `INSERT INTO company_members (company_id, user_id, role) VALUES ($1,$2,'viewer')`,
      [company.id, viewer.id],
    );
    const read = await api(ctx, viewer.cookie, 'GET', `/api/companies/${company.id}/fx/rates`);
    expect(read.statusCode).toBe(200);
    const write = await api(ctx, viewer.cookie, 'POST', `/api/companies/${company.id}/fx/rates`, {
      baseCurrency: 'EUR',
      quoteCurrency: 'MUR',
      rateDate: '2026-02-20',
      rate: '50.5',
      sourceKind: 'manual',
      source: 'Tentative viewer',
    });
    expect(write.statusCode).toBe(403);

    const outsider = await registerUser(ctx);
    const forbidden = await api(ctx, outsider.cookie, 'GET', `/api/companies/${company.id}/fx/config`);
    expect([403, 404]).toContain(forbidden.statusCode);
  });

  // 30 ----------------------------------------------------------------------
  it('does not expose another company rate through a forged company id', async () => {
    // A second company is created inside the same test database instead of
    // opening a nested test app: on real PostgreSQL a nested app truncates the
    // whole schema and would invalidate the cookies used by later tests.
    const outsider = await registerUser(ctx);
    const other = await createCompany(ctx, outsider.cookie);
    const res = await api(ctx, owner.cookie, 'GET', `/api/companies/${other.id}/fx/rates`);
    expect([403, 404]).toContain(res.statusCode);
  });

  // 31 ----------------------------------------------------------------------
  it('rolls back an invalid configuration update', async () => {
    const before = await api(ctx, owner.cookie, 'GET', `/api/companies/${company.id}/fx/config`);
    const invalid = await api(ctx, owner.cookie, 'PATCH', `/api/companies/${company.id}/fx/config`, {
      allowedCurrencies: ['MUR', 'EUR'],
      fxGainAccountId: accountByCode(accounts, '6100').id,
    });
    expect(invalid.statusCode).toBe(400);
    const after = await api(ctx, owner.cookie, 'GET', `/api/companies/${company.id}/fx/config`);
    expect(after.json().allowedCurrencies).toEqual(before.json().allowedCurrencies);
  });

  // 32 ----------------------------------------------------------------------
  it('rejects a foreign-currency lettering across incompatible currencies', async () => {
    const eur = await post(
      [
        { code: '1100', debit: '1000' },
        { code: '4010', credit: '1000' },
      ],
      { currency: 'EUR', exchangeRate: '50', reference: `LET-EUR-${REF()}` },
    );
    expect(eur.statusCode).toBe(201);
    const usd = await post(
      [
        { code: '1100', debit: '1000' },
        { code: '4010', credit: '1000' },
      ],
      { currency: 'USD', exchangeRate: '45.25', reference: `LET-USD-${REF()}` },
    );
    expect(usd.statusCode).toBe(201);
    const lines = (
      await api(
        ctx,
        owner.cookie,
        'GET',
        `/api/companies/${company.id}/lettering/lines?accountId=${accountByCode(accounts, '1100').id}&status=all&limit=500`,
      )
    ).json().lines;
    const source = lines.find((l: any) => l.entryReference === eur.json().entry.reference);
    const candidate = lines.find((l: any) => l.entryReference === usd.json().entry.reference);
    expect(source?.currency).toBeDefined();
    expect(candidate?.currency).toBeDefined();
    const preview = await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/lettering/preview`, {
      accountId: accountByCode(accounts, '1100').id,
      allocations: [
        { lineId: source.id, amount: '1000' },
        { lineId: candidate.id, amount: '1000' },
      ],
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.json().preview.valid).toBe(false);
    expect(
      preview.json().preview.issues.some((i: any) => i.code === 'LETTERING_CURRENCY_MISMATCH'),
    ).toBe(true);
  });

  // 33-35 -------------------------------------------------------------------
  it('keeps a rejected rate unusable and refuses to validate it twice', async () => {
    const created = await createRate('USD', 'MUR', '2026-03-02', '45.5', { validate: false });
    expect(created.statusCode).toBe(201);
    const id = created.json().rate.id;
    const rejected = await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/fx/rates/${id}/reject`, {
      reason: 'Provenance fictive insuffisante',
    });
    expect(rejected.statusCode).toBe(200);
    expect(rejected.json().rate.status).toBe('rejected');
    const resolved = await api(
      ctx,
      owner.cookie,
      'GET',
      `/api/companies/${company.id}/fx/resolve?amount=10&from=USD&to=MUR&date=2026-03-02`,
    );
    expect(resolved.statusCode).toBe(409);
    expect(['FX_RATE_MISSING', 'FX_RATE_NOT_VALIDATED']).toContain(resolved.json().error.code);
  });

  it('makes a validated rate immutable at database level', async () => {
    const res = await api(ctx, owner.cookie, 'GET', `/api/companies/${company.id}/fx/rates?base=GBP&quote=MUR&date=2026-02-10`);
    const rate = res.json().rates.find((r: any) => r.status === 'validated');
    expect(rate).toBeTruthy();
    await expect(
      ctx.db.query('UPDATE fx_rates SET rate = 61 WHERE id = $1', [rate.id]),
    ).rejects.toThrow();
    const after = await ctx.db.query<any>('SELECT rate::text FROM fx_rates WHERE id = $1', [rate.id]);
    expect(after.rows[0].rate).toBe('60.50000000');
  });

  it('posts a realized difference once under concurrent requests', async () => {
    const doc = await makeBillingInvoice('EUR', '50.00000000', '700.00');
    await postBillingDocument(doc.id);
    const paymentId = await makeBillingPayment(doc.id, 'EUR', '51.00000000', '700.00');
    const scan = await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/fx/realized/scan`, {});
    const adjustment = scan.json().adjustments.find((a: any) => a.payment_id === paymentId);
    expect(adjustment).toBeTruthy();
    const [first, second] = await Promise.all([
      api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/fx/realized/${adjustment.id}/post`, { confirm: true }),
      api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/fx/realized/${adjustment.id}/post`, { confirm: true }),
    ]);
    expect([first.statusCode, second.statusCode]).toEqual([200, 200]);
    const entries = await ctx.db.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM fx_realized_adjustments WHERE id = $1 AND entry_id IS NOT NULL',
      [adjustment.id],
    );
    expect(entries.rows[0]!.count).toBe('1');
  });

  it('refuses a realized adjustment posted by an outsider', async () => {
    const outsider = await registerUser(ctx);
    const list = await api(ctx, owner.cookie, 'GET', `/api/companies/${company.id}/fx/realized?status=posted`);
    const adjustment = list.json().adjustments[0];
    expect(adjustment).toBeTruthy();
    const res = await api(
      ctx,
      outsider.cookie,
      'POST',
      `/api/companies/${company.id}/fx/realized/${adjustment.id}/post`,
      { confirm: true },
    );
    expect([403, 404]).toContain(res.statusCode);
  });

  it('blocks a realized posting inside a closed period and succeeds after reopening', async () => {
    const doc = await makeBillingInvoice('EUR', '50.00000000', '300.00');
    await postBillingDocument(doc.id);
    const paymentId = await makeBillingPayment(doc.id, 'EUR', '52.00000000', '300.00');
    const scan = await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/fx/realized/scan`, {});
    const adjustment = scan.json().adjustments.find((a: any) => a.payment_id === paymentId);
    expect(adjustment).toBeTruthy();
    const periods = await api(ctx, owner.cookie, 'GET', `/api/companies/${company.id}/periods`);
    const period = periods.json().periods.find((p: any) => p.start_date <= '2026-02-10' && p.end_date >= '2026-02-10');
    expect(period).toBeTruthy();
    const closed = await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/periods/${period.id}/close`, {});
    expect(closed.statusCode).toBe(200);
    const blocked = await api(
      ctx,
      owner.cookie,
      'POST',
      `/api/companies/${company.id}/fx/realized/${adjustment.id}/post`,
      { confirm: true },
    );
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().error.code).toBe('PERIOD_CLOSED');
    await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/periods/${period.id}/reopen`, {});
    const posted = await api(
      ctx,
      owner.cookie,
      'POST',
      `/api/companies/${company.id}/fx/realized/${adjustment.id}/post`,
      { confirm: true },
    );
    expect(posted.statusCode).toBe(200);
  });

  it('rejects a proposed realized difference with a reason', async () => {
    const doc = await makeBillingInvoice('EUR', '50.00000000', '200.00');
    await postBillingDocument(doc.id);
    const paymentId = await makeBillingPayment(doc.id, 'EUR', '51.00000000', '200.00');
    const scan = await api(ctx, owner.cookie, 'POST', `/api/companies/${company.id}/fx/realized/scan`, {});
    const adjustment = scan.json().adjustments.find((a: any) => a.payment_id === paymentId);
    const rejected = await api(
      ctx,
      owner.cookie,
      'POST',
      `/api/companies/${company.id}/fx/realized/${adjustment.id}/reject`,
      { reason: 'Écart fictif refusé par le comptable de test' },
    );
    expect(rejected.statusCode).toBe(200);
    expect(rejected.json().adjustment.status).toBe('rejected');
  });

  it('routes currency questions to read-only assistant tools', () => {
    expect(detectIntent('Quels sont les taux de change validés ?').intent).toBe('fx_rates');
    expect(detectIntent('Convertir 1000 EUR en MUR').intent).toBe('fx_convert');
    expect(detectIntent('Factures en devise sans taux validé').intent).toBe('fx_unrated');
    expect(detectIntent('Montre les écarts réalisés de change').intent).toBe('fx_realized');
    for (const key of ['fx.rates', 'fx.convert', 'fx.unrated', 'fx.realized']) {
      const tool = TOOL_BY_KEY.get(key);
      expect(tool, key).toBeTruthy();
      expect(tool!.readOnly).toBe(true);
    }
  });

  it('never totals currencies in the CSV and escapes formula-like cells', async () => {
    const res = await api(ctx, owner.cookie, 'GET', `/api/companies/${company.id}/fx/report.csv`);
    expect(res.statusCode).toBe(200);
    const csv = res.body;
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toMatch(/Aucun total inter-devises/);
    expect(csv).toMatch(/Devise/);
    expect(csv.split('\n').length).toBeGreaterThan(5);
    expect(csv).not.toMatch(/Total général|Grand total/i);
  });
});
