/**
 * Démonstration navigateur — mission 11 (achats & fournisseurs).
 *
 * These tests call the embedded backend exactly as the GitHub Pages demo does.
 * They cover the imposed scenario 80 000 − 30 000 = 50 000 MUR, grouped and
 * partial payments, credit notes, currencies kept separate, posting through the
 * existing proposal engine, and the impossibility of cancelling a posted
 * invoice or paying twice.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { DEMO_EMAIL, DEMO_PASSWORD, demoRequest, resetDemo } from '../src/demo';
import { ApiError } from '../src/errors';

const call = <T>(method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: string, body?: unknown) =>
  demoRequest<T>(method, path, body);

let company = '';
let supplier = '';
let payable = '';
let expense = '';

const setup = () => {
  resetDemo();
  call('POST', '/auth/login', { email: DEMO_EMAIL, password: DEMO_PASSWORD });
  company = call<{ companies: { id: string }[] }>('GET', '/companies').companies[0]!.id;
  const suppliers = call<{ suppliers: { id: string; preferred_currency: string | null }[] }>(
    'GET',
    `/companies/${company}/purchases/suppliers`,
  ).suppliers;
  supplier = suppliers.find((s) => s.preferred_currency === 'MUR')!.id;
  const accounts = call<{ accounts: { id: string; code: string }[] }>(
    'GET',
    `/companies/${company}/accounts`,
  ).accounts;
  payable = accounts.find((a) => a.code === '2000')!.id;
  expense = accounts.find((a) => a.code === '6100')!.id;
};

interface Doc {
  id: string;
  kind: 'invoice' | 'credit_note';
  doc_no: string | null;
  supplier_reference: string;
  currency: string;
  total_amount: string;
  amount_paid: string;
  credited_amount: string;
  outstanding_amount: string;
  credit_available: string;
  payment_status: string;
  status: string;
  accounting_entry_id: string | null;
}

interface Payment {
  id: string;
  payment_no: string | null;
  amount: string;
  unallocated_amount: string;
  status: string;
  accounting_entry_id: string | null;
  allocations: { invoiceId: string; amount: string; cancelledAt: string | null }[];
}

const documents = (kind?: string) =>
  call<{ documents: Doc[] }>(
    'GET',
    `/companies/${company}/purchases/documents${kind ? `?kind=${kind}` : ''}`,
  ).documents;

const createInvoice = (
  reference: string,
  amount: string,
  extra: Record<string, unknown> = {},
) =>
  call<{ document: Doc }>('POST', `/companies/${company}/purchases/documents`, {
    kind: 'invoice',
    supplierId: supplier,
    supplierReference: reference,
    issueDate: '2026-06-01',
    dueDate: '2026-07-01',
    currency: 'MUR',
    exchangeRate: '1',
    lines: [
      {
        description: 'Charge fictive de test',
        quantity: '1',
        unitPrice: amount,
        accountId: expense,
        vatTreatment: 'out_of_scope',
      },
    ],
    ...extra,
  }).document;

beforeEach(setup);

describe('démo — achats & fournisseurs', () => {
  it('expose le scénario 80 000 − 30 000 = 50 000 MUR', () => {
    const invoice = documents('invoice').find((d) => d.supplier_reference === 'FAC-DEMO-1001')!;
    expect(invoice.total_amount).toBe('80000.0000');
    expect(invoice.amount_paid).toBe('30000.0000');
    expect(invoice.outstanding_amount).toBe('50000.0000');
    expect(invoice.payment_status).toBe('partial');
    const payment = call<{ payments: Payment[] }>('GET', `/companies/${company}/purchases/payments`).payments.find(
      (p) => p.payment_no === 'RF-2026-0001',
    )!;
    expect(payment.amount).toBe('30000.0000');
    expect(payment.allocations[0]!.invoiceId).toBe(invoice.id);
  });

  it('garde les devises séparées dans l’échéancier', () => {
    const aging = call<any>('GET', `/companies/${company}/purchases/aging`).aging;
    const currencies = aging.totalsByCurrency.map((t: any) => t.currency);
    expect(currencies).toContain('MUR');
    expect(currencies).toContain('EUR');
    for (const total of aging.totalsByCurrency) {
      expect(typeof total.outstanding).toBe('string');
    }
    const eur = aging.groups.find((g: any) => g.currency === 'EUR');
    expect(eur.invoices[0].total).toBe('1000.0000');
    expect(aging.totalsByCurrency.some((t: any) => t.currency === 'MUR' && t.outstanding === '95000.0000')).toBe(true);
  });

  it('crée un fournisseur sans fusion automatique', () => {
    const created = call<{ supplier: { id: string; name: string } }>(
      'POST',
      `/companies/${company}/purchases/suppliers`,
      { name: 'Fournisseur Test Fictif', country: 'MU', preferredCurrency: 'MUR' },
    );
    expect(created.supplier.name).toBe('Fournisseur Test Fictif');
    expect(() =>
      call('POST', `/companies/${company}/purchases/suppliers`, {
        name: 'Fournisseur Test Fictif',
        country: 'MU',
      }),
    ).toThrowError(ApiError);
  });

  it('crée, valide et numérote une facture d’achat', () => {
    const draft = createInvoice('TEST-FAC-001', '1250.00');
    expect(draft.status).toBe('draft');
    expect(draft.doc_no).toBeNull();
    const validated = call<{ document: Doc }>(
      'POST',
      `/companies/${company}/purchases/documents/${draft.id}/validate`,
    ).document;
    expect(validated.status).toBe('validated');
    expect(validated.doc_no).toMatch(/^ACH-\d{4}-\d{4}$/);
    expect(validated.total_amount).toBe('1250.0000');
    expect(validated.outstanding_amount).toBe('1250.0000');
  });

  it('refuse un numéro fournisseur déjà utilisé sans toucher au document existant', () => {
    const first = createInvoice('TEST-DUP-001', '100.00');
    expect(() => createInvoice('TEST-DUP-001', '100.00')).toThrowError(ApiError);
    const stored = documents('invoice').find((d) => d.id === first.id)!;
    expect(stored.total_amount).toBe('100.0000');
  });

  it('refuse un paiement supérieur au restant dû (pas de double règlement)', () => {
    const invoice = documents('invoice').find((d) => d.supplier_reference === 'FAC-DEMO-1001')!;
    expect(() =>
      call('POST', `/companies/${company}/purchases/payments`, {
        supplierId: supplier,
        kind: 'payment',
        paymentDate: '2026-06-02',
        amount: '50000.01',
        currency: 'MUR',
        allocations: [{ invoiceId: invoice.id, amount: '50000.01' }],
      }),
    ).toThrowError(ApiError);
    const unchanged = documents('invoice').find((d) => d.id === invoice.id)!;
    expect(unchanged.outstanding_amount).toBe('50000.0000');
  });

  it('solde une facture avec un second règlement partiel exact', () => {
    const invoice = documents('invoice').find((d) => d.supplier_reference === 'FAC-DEMO-1001')!;
    const paid = call<{ payment: Payment }>('POST', `/companies/${company}/purchases/payments`, {
      supplierId: supplier,
      kind: 'payment',
      paymentDate: '2026-06-03',
      amount: '50000.00',
      currency: 'MUR',
      allocations: [{ invoiceId: invoice.id, amount: '50000.00' }],
    }).payment;
    expect(paid.allocations[0]!.amount).toBe('50000.0000');
    const settled = documents('invoice').find((d) => d.id === invoice.id)!;
    expect(settled.outstanding_amount).toBe('0.0000');
    expect(settled.payment_status).toBe('paid');
    expect(settled.amount_paid).toBe('80000.0000');
  });

  it('affecte un avoir sans modifier le total de la facture', () => {
    const invoice = documents('invoice').find((d) => d.supplier_reference === 'FAC-DEMO-1004')!;
    expect(invoice.credited_amount).toBe('10000.0000');
    expect(invoice.outstanding_amount).toBe('15000.0000');
    expect(invoice.total_amount).toBe('25000.0000');
  });

  it('refuse d’annuler une facture déjà comptabilisée', () => {
    const posted = documents('invoice').find((d) => d.supplier_reference === 'FAC-DEMO-1006')!;
    expect(posted.accounting_entry_id).not.toBeNull();
    expect(() =>
      call('POST', `/companies/${company}/purchases/documents/${posted.id}/cancel`, {
        reason: 'Tentative de suppression silencieuse',
      }),
    ).toThrowError(ApiError);
    const unchanged = documents('invoice').find((d) => d.id === posted.id)!;
    expect(unchanged.status).toBe('validated');
    expect(unchanged.accounting_entry_id).toBe(posted.accounting_entry_id);
  });

  it('prépare une proposition puis la comptabilise via le moteur existant', () => {
    const invoice = documents('invoice').find((d) => d.supplier_reference === 'FAC-DEMO-1005')!;
    const proposal = call<{ proposal: { id: string; status: string; totalDebit: string } }>(
      'POST',
      `/companies/${company}/purchases/documents/${invoice.id}/proposal`,
    ).proposal;
    expect(proposal.status).toBe('proposed');
    const view = call<any>('GET', `/companies/${company}/ai/entry-proposals/${proposal.id}`).proposal;
    expect(view.totals.balanced).toBe(true);
    expect(view.totals.debit).toBe('12000.0000');
    expect(view.entryId).toBeNull();

    call('POST', `/companies/${company}/ai/entry-proposals/${proposal.id}/validate`, {});
    const posted = call<any>('POST', `/companies/${company}/ai/entry-proposals/${proposal.id}/post`, {});
    expect(posted.entryCreated).toBe(true);
    const source = documents('invoice').find((d) => d.id === invoice.id)!;
    expect(source.accounting_entry_id).toBe(posted.entryId);
    expect(() =>
      call('POST', `/companies/${company}/ai/entry-proposals/${proposal.id}/post`, {}),
    ).toThrowError(ApiError);
  });

  it('exige un taux de change pour une devise étrangère', () => {
    expect(() =>
      call('POST', `/companies/${company}/purchases/documents`, {
        kind: 'invoice',
        supplierId: supplier,
        supplierReference: 'TEST-EUR-001',
        issueDate: '2026-06-01',
        currency: 'EUR',
        lines: [
          { description: 'Achat en devises', quantity: '1', unitPrice: '100', accountId: expense, vatTreatment: 'out_of_scope' },
        ],
      }),
    ).toThrowError(ApiError);
  });
});
