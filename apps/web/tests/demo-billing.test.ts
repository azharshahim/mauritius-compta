/**
 * Démonstration navigateur — facturation et assistant comptable V2.
 *
 * Ces tests exercent exactement le code exécuté dans Chrome sur GitHub Pages :
 * aucun serveur, aucun appel externe, données fictives en localStorage.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { DEMO_EMAIL, DEMO_PASSWORD, demoRequest, resetDemo } from '../src/demo';

const call = <T>(method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: string, body?: unknown) =>
  demoRequest<T>(method, path, body);

const login = () =>
  call<{ user: { id: string } }>('POST', '/auth/login', {
    email: DEMO_EMAIL,
    password: DEMO_PASSWORD,
  });

const companyId = () => call<{ companies: { id: string }[] }>('GET', '/companies').companies[0]!.id;

const accountId = (company: string, code: string) =>
  call<{ accounts: { id: string; code: string }[] }>('GET', `/companies/${company}/accounts`).accounts.find(
    (a) => a.code === code,
  )!.id;

const journalId = (company: string, code: string) =>
  call<{ journals: { id: string; code: string }[] }>('GET', `/companies/${company}/journals`).journals.find(
    (j) => j.code === code,
  )!.id;

const entryCount = (company: string) =>
  call<{ total: number }>('GET', `/companies/${company}/entries?limit=1`).total;

interface Doc {
  id: string;
  kind: string;
  number: string | null;
  status: string;
  customerId: string;
  total: string;
  outstanding: string;
  paymentStatus: string;
  lines: { description: string; quantity: string }[];
}

interface Proposal {
  id: string;
  status: string;
  totals: { balanced: boolean; debit: string };
  checks: { key: string; ok: boolean; severity: string }[];
  reference: string | null;
  entryId: string | null;
  sourceId: string | null;
}

beforeEach(() => {
  resetDemo();
  login();
});

describe('démo — facturation', () => {
  it('expose les données fictives et des capacités honnêtes', () => {
    const company = companyId();
    const docs = call<{ documents: Doc[]; available: boolean; capabilities: { pdf: boolean } }>(
      'GET',
      `/companies/${company}/billing/documents`,
    );
    expect(docs.available).toBe(true);
    expect(docs.documents.length).toBeGreaterThan(0);
    expect(docs.capabilities.pdf).toBe(false);

    const settings = call<{ capabilities: { mraEInvoicing: boolean; postingToAccounting: boolean } }>(
      'GET',
      `/companies/${company}/billing/settings`,
    );
    expect(settings.capabilities.mraEInvoicing).toBe(false);
    expect(settings.capabilities.postingToAccounting).toBe(true);

    const customers = call<{ customers: { id: string; name: string }[] }>(
      'GET',
      `/companies/${company}/billing/customers`,
    ).customers;
    expect(customers.length).toBeGreaterThanOrEqual(2);

    const items = call<{ items: { id: string; reference: string }[] }>(
      'GET',
      `/companies/${company}/billing/items`,
    ).items;
    expect(items.map((i) => i.reference)).toContain('SRV-CONS');
  });

  it('convertit un devis une seule fois et trace la facture', () => {
    const company = companyId();
    const quote = call<{ documents: Doc[] }>('GET', `/companies/${company}/billing/documents?kind=quote`).documents[0]!;
    const created = call<{ document: Doc; duplicates: { level: string } }>(
      'POST',
      `/companies/${company}/billing/documents`,
      {
        kind: 'invoice',
        customerId: quote.customerId,
        issueDate: new Date().toISOString().slice(0, 10),
        sourceDocumentId: quote.id,
      },
    );
    expect(created.document.status).toBe('draft');
    expect(created.document.number).toBeNull();
    expect(created.document.total).toBe(quote.total);

    expect(() =>
      call('POST', `/companies/${company}/billing/documents`, {
        kind: 'invoice',
        customerId: quote.customerId,
        issueDate: new Date().toISOString().slice(0, 10),
        sourceDocumentId: quote.id,
      }),
    ).toThrowError(/déjà converti|Doublon/);

    const issued = call<{ document: Doc }>(
      'POST',
      `/companies/${company}/billing/documents/${created.document.id}/issue`,
    ).document;
    expect(issued.number).toMatch(/^FAC-/);
    expect(issued.status).toBe('issued');
  });

  it('numérote de façon séquentielle et verrouille après émission', () => {
    const company = companyId();
    const docs = call<{ documents: Doc[] }>('GET', `/companies/${company}/billing/documents?kind=invoice`).documents;
    const numbers = docs.map((d) => d.number).filter((n): n is string => Boolean(n));
    expect(numbers.length).toBe(docs.length);
    expect(new Set(numbers).size).toBe(numbers.length);
    expect(docs.some((d) => ['issued', 'partially_paid'].includes(d.status))).toBe(true);

    const draft = call<{ document: Doc }>('POST', `/companies/${company}/billing/documents`, {
      kind: 'invoice',
      customerId: docs[0]!.customerId,
      issueDate: new Date().toISOString().slice(0, 10),
      lines: [{ description: 'Prestation fictive', quantity: '1.0000', unitPrice: '100.0000', vatTreatment: 'zero_rated' }],
    }).document;
    call('POST', `/companies/${company}/billing/documents/${draft.id}/issue`);
    expect(() =>
      call('PATCH', `/companies/${company}/billing/documents/${draft.id}`, { notes: 'modification interdite' }),
    ).toThrowError(/verrouillé/);
  });

  it('limite un avoir au montant restant créditable', () => {
    const company = companyId();
    const invoice = call<{ documents: Doc[] }>('GET', `/companies/${company}/billing/documents?kind=invoice`).documents.find(
      (d) => d.paymentStatus === 'partial',
    )!;
    expect(() =>
      call('POST', `/companies/${company}/billing/documents/${invoice.id}/credit-note`, {
        lines: [{ description: 'Avoir trop élevé', quantity: '100.0000', unitPrice: '8000.0000', vatTreatment: 'zero_rated' }],
      }),
    ).toThrowError(/dépasse/);
  });

  it('refuse de présenter un PDF simulé comme réel', () => {
    const company = companyId();
    const doc = call<{ documents: Doc[] }>('GET', `/companies/${company}/billing/documents`).documents[0]!;
    expect(() => call('GET', `/companies/${company}/billing/documents/${doc.id}/pdf`)).toThrowError(/aucun PDF/);
  });

  it('calcule une balance âgée et un solde client cohérents', () => {
    const company = companyId();
    const aging = call<{ rows: { customerName: string }[]; totals: { total: string } }>(
      'GET',
      `/companies/${company}/billing/aging`,
    );
    expect(aging.rows.length).toBeGreaterThan(0);
    expect(Number(aging.totals.total)).toBeGreaterThan(0);

    const customer = call<{ customers: { id: string }[] }>('GET', `/companies/${company}/billing/customers`).customers[0]!;
    const balance = call<{ balance: { invoiced: string; paid: string; credited: string; outstanding: string } }>(
      'GET',
      `/companies/${company}/billing/customers/${customer.id}/balance`,
    ).balance;
    expect(Number(balance.invoiced)).toBeGreaterThan(0);
    expect(Number(balance.outstanding)).toBeGreaterThanOrEqual(0);
  });

  it('refuse une affectation supérieure au solde dû', () => {
    const company = companyId();
    const invoice = call<{ documents: Doc[] }>('GET', `/companies/${company}/billing/documents?kind=invoice`).documents.find(
      (d) => d.status === 'issued',
    )!;
    expect(() =>
      call('POST', `/companies/${company}/billing/payments`, {
        customerId: invoice.customerId,
        paymentDate: new Date().toISOString().slice(0, 10),
        amount: '999999.0000',
        currency: 'MUR',
        allocations: [{ invoiceId: invoice.id, amount: '999999.0000' }],
      }),
    ).toThrowError(/dépasse le solde/);
  });

  it('encaisse partiellement puis laisse un trop-perçu non affecté', () => {
    const company = companyId();
    const invoice = call<{ documents: Doc[] }>('GET', `/companies/${company}/billing/documents?kind=invoice`).documents.find(
      (d) => d.status === 'issued',
    )!;
    const payment = call<{
      payment: { id: string; unallocatedAmount: string; allocations: { invoiceId: string }[] };
      entryCreated: boolean;
    }>('POST', `/companies/${company}/billing/payments`, {
      customerId: invoice.customerId,
      paymentDate: new Date().toISOString().slice(0, 10),
      amount: `${Number(invoice.total) + 100}`,
      currency: invoice.number ? 'MUR' : 'MUR',
      allocations: [{ invoiceId: invoice.id, amount: invoice.total }],
    });
    expect(payment.entryCreated).toBe(false);
    expect(Number(payment.payment.unallocatedAmount)).toBeCloseTo(100, 2);
    expect(payment.payment.allocations[0]!.invoiceId).toBe(invoice.id);

    const refreshed = call<{ document: Doc }>(
      'GET',
      `/companies/${company}/billing/documents/${invoice.id}`,
    ).document;
    expect(refreshed.status).toBe('paid');
    expect(Number(refreshed.outstanding)).toBe(0);
  });
});

describe('démo — assistant comptable V2', () => {
  it('propose une écriture équilibrée sans comptabiliser', () => {
    const company = companyId();
    const before = entryCount(company);
    const res = call<{ proposal: Proposal; entryCreated: boolean }>(
      'POST',
      `/companies/${company}/ai/entry-proposals`,
      {
        description: 'Frais bancaires sur relevé fictif',
        amount: '150.0000',
        currency: 'MUR',
        entryDate: new Date().toISOString().slice(0, 10),
      },
    );
    expect(res.entryCreated).toBe(false);
    expect(res.proposal.totals.balanced).toBe(true);
    expect(res.proposal.status).toBe('proposed');
    expect(res.proposal.checks.find((c) => c.key === 'balanced')!.ok).toBe(true);
    expect(entryCount(company)).toBe(before);
  });

  it('exige validation humaine puis comptabilisation distincte, une seule fois', () => {
    const company = companyId();
    const invoice = call<{ documents: Doc[] }>('GET', `/companies/${company}/billing/documents?kind=invoice`).documents.find(
      (d) => d.status === 'issued',
    )!;
    const before = entryCount(company);

    const created = call<{ proposal: Proposal; entryCreated: boolean }>(
      'POST',
      `/companies/${company}/ai/entry-proposals/from-billing`,
      { documentId: invoice.id },
    );
    expect(created.entryCreated).toBe(false);
    expect(created.proposal.reference).toBe(invoice.number);
    expect(entryCount(company)).toBe(before);

    expect(() => call('POST', `/companies/${company}/ai/entry-proposals/${created.proposal.id}/post`)).toThrowError(
      /validation humaine/,
    );

    const validated = call<{ proposal: Proposal; entryCreated: boolean }>(
      'POST',
      `/companies/${company}/ai/entry-proposals/${created.proposal.id}/validate`,
      { acceptWarnings: true },
    );
    expect(validated.entryCreated).toBe(false);
    expect(validated.proposal.status).toBe('validated');
    expect(entryCount(company)).toBe(before);

    const posted = call<{ proposal: Proposal; entryId: string; entryNo: string; entryCreated: boolean }>(
      'POST',
      `/companies/${company}/ai/entry-proposals/${created.proposal.id}/post`,
    );
    expect(posted.entryCreated).toBe(true);
    expect(posted.entryId).toBeTruthy();
    expect(posted.proposal.status).toBe('posted');
    expect(entryCount(company)).toBe(before + 1);

    const detail = call<{ entry: { id: string; source: string }; lines: unknown[] }>(
      'GET',
      `/companies/${company}/entries/${posted.entryId}`,
    );
    expect(detail.entry.source).toBe('billing');
    expect(detail.lines.length).toBeGreaterThanOrEqual(2);

    expect(() => call('POST', `/companies/${company}/ai/entry-proposals/${created.proposal.id}/post`)).toThrowError(
      /Déjà comptabilisée/,
    );
    expect(() =>
      call('POST', `/companies/${company}/ai/entry-proposals/from-billing`, { documentId: invoice.id }),
    ).toThrowError(/déjà comptabilisé/);
  });

  it('refuse une contrepartie hors plan comptable', () => {
    const company = companyId();
    const other = call<{ companies: { id: string }[] }>('GET', '/companies').companies[1]!.id;
    const res = call<{ proposal: Proposal }>('POST', `/companies/${company}/ai/entry-proposals`, {
      description: 'Achat de fournitures fictives',
      amount: '80.0000',
      currency: 'MUR',
      entryDate: new Date().toISOString().slice(0, 10),
    });
    expect(() =>
      call('PUT', `/companies/${company}/ai/entry-proposals/${res.proposal.id}`, {
        lines: [
          { accountId: accountId(other, '5000'), debit: '80.0000', credit: null },
          { accountId: accountId(company, '2000'), debit: null, credit: '80.0000' },
        ],
      }),
    ).toThrowError(/hors plan comptable/);
  });

  it('apprend une règle explicite et l’explique au lieu de l’appliquer en silence', () => {
    const company = companyId();
    const saved = call<{ rule: { id: string; version: number; matchKey: string } }>(
      'POST',
      `/companies/${company}/ai/entry-rules`,
      {
        ruleType: 'counterparty',
        matchKey: 'Papeterie Fictive Ltée',
        accountId: accountId(company, '5000'),
        counterAccountId: accountId(company, '2000'),
        journalId: journalId(company, 'PUR'),
        accountSide: 'debit',
        priority: 5,
      },
    );
    expect(saved.rule.version).toBe(1);

    const res = call<{
      proposal: Proposal;
      ruleApplied: { rule: { id: string; key: string } } | null;
      entryCreated: boolean;
    }>('POST', `/companies/${company}/ai/entry-proposals`, {
      description: 'Facture Papeterie Fictive Ltée',
      amount: '300.0000',
      currency: 'MUR',
      entryDate: new Date().toISOString().slice(0, 10),
    });
    expect(res.entryCreated).toBe(false);
    expect(res.ruleApplied?.rule.id).toBe(saved.rule.id);
    expect(res.proposal.totals.balanced).toBe(true);
    expect(res.proposal.checks.find((c) => c.key === 'accounts_exist')!.ok).toBe(true);

    const updated = call<{ rule: { id: string; version: number } }>('POST', `/companies/${company}/ai/entry-rules`, {
      ruleType: 'counterparty',
      matchKey: 'Papeterie Fictive Ltée',
      accountId: accountId(company, '6010'),
      counterAccountId: accountId(company, '2000'),
      journalId: journalId(company, 'PUR'),
      accountSide: 'debit',
      priority: 5,
    });
    expect(updated.rule.version).toBe(2);

    const history = call<{ history: { version: number; isActive: boolean }[] }>(
      'GET',
      `/companies/${company}/ai/entry-rules/history?ruleType=counterparty&matchKey=${encodeURIComponent(
        'Papeterie Fictive Ltée',
      )}`,
    ).history;
    expect(history).toHaveLength(2);
    const active = history.filter((r) => r.isActive);
    expect(active).toHaveLength(1);
    expect(active[0]!.version).toBe(2);

    call('POST', `/companies/${company}/ai/entry-rules/${updated.rule.id}/disable`);
    const after = call<{ rules: { matchKey: string }[] }>('GET', `/companies/${company}/ai/entry-rules`).rules;
    expect(after.some((r) => r.matchKey === 'Papeterie Fictive Ltée')).toBe(false);
    const withInactive = call<{ rules: { matchKey: string; isActive: boolean }[] }>(
      'GET',
      `/companies/${company}/ai/entry-rules?includeInactive=true`,
    ).rules.filter((r) => r.matchKey === 'Papeterie Fictive Ltée');
    expect(withInactive).toHaveLength(2);
    expect(withInactive.every((r) => !r.isActive)).toBe(true);
  });

  it('isole les règles et propositions par société', () => {
    const first = companyId();
    const second = call<{ companies: { id: string }[] }>('GET', '/companies').companies[1]!.id;
    call('POST', `/companies/${first}/ai/entry-rules`, {
      ruleType: 'counterparty',
      matchKey: 'Isolée Fictive SARL',
      accountId: accountId(first, '5000'),
      counterAccountId: accountId(first, '2000'),
      accountSide: 'debit',
    });
    expect(call<{ rules: unknown[] }>('GET', `/companies/${second}/ai/entry-rules`).rules).toHaveLength(0);
    expect(call<{ proposals: unknown[] }>('GET', `/companies/${second}/ai/entry-proposals`).proposals).toHaveLength(0);
  });
});
