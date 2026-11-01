/**
 * Mission 43 — browser demo parity for bank period reporting and C-04.
 * All fixtures are fictional and stored in localStorage only.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { DEMO_EMAIL, DEMO_PASSWORD, demoRequest, resetDemo } from '../src/demo';

const call = <T>(method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: string, body?: unknown) =>
  demoRequest<T>(method, path, body);

let company = '';
let bank = '';

beforeEach(() => {
  resetDemo();
  call('POST', '/auth/login', { email: DEMO_EMAIL, password: DEMO_PASSWORD });
  company = call<{ companies: { id: string }[] }>('GET', '/companies').companies[0]!.id;
  bank = call<{ accounts: { id: string; currency: string }[] }>('GET', `/companies/${company}/bank/accounts`).accounts.find(
    (a) => a.currency === 'MUR',
  )!.id;
});

describe('mission 43 browser demo — bank periods and receipt to payment', () => {
  it('reports opening, movement and closing balances with every counter', () => {
    const report = call<any>(
      'GET',
      `/companies/${company}/bank/report?bankAccountId=${bank}&from=2025-07-01&to=2026-06-30`,
    ).report;
    expect(report.openingBankBalance).not.toBeUndefined();
    expect(report.closingBankBalance).not.toBeUndefined();
    expect(report.bankMovement).toMatch(/^-?\d+\.\d{4}$/);
    expect(report.ledgerMovement).toMatch(/^-?\d+\.\d{4}$/);
    expect(report.closingLedgerBalance).toMatch(/^-?\d+\.\d{4}$/);
    expect(typeof report.partiallyMatchedCount).toBe('number');
    expect(report.totalCount).toBe(
      report.matchedCount + report.partiallyMatchedCount + report.unmatchedCount + report.excludedCount,
    );
    // Never silently forced to zero.
    expect(report.difference).toBe(
      (Number(report.closingBankBalance) - Number(report.closingLedgerBalance)).toFixed(4),
    );
  });

  it('blocks an incomplete period and validates a complete one without creating an entry', () => {
    const charts = call<{ accounts: any[] }>('GET', `/companies/${company}/accounts`).accounts;
    const chart = charts.find((a) => a.code === '1015' && a.type === 'asset');
    const fresh = call<any>('POST', `/companies/${company}/bank/accounts`, {
      name: 'Compte période fictif M43',
      bankName: 'Banque Fictive M43',
      currency: 'MUR',
      accountId: chart.id,
      maskedReference: 'MU00FICTIF43DEMO',
    }).account;
    call('POST', `/companies/${company}/bank/imports`, {
      bankAccountId: fresh.id,
      fileName: 'm43-period.csv',
      contentText: [
        'Date;Libellé;Référence;Débit;Crédit;Devise;Solde',
        '10/08/2025;Frais fictifs M43;FRAIS-M43-DEMO;100,00;;MUR;0,00',
      ].join('\r\n'),
    });
    const txn = call<{ transactions: any[] }>(
      'GET',
      `/companies/${company}/bank/transactions?bankAccountId=${fresh.id}`,
    ).transactions[0]!;
    const opened = call<any>('POST', `/companies/${company}/bank/periods`, {
      bankAccountId: fresh.id,
      from: '2025-08-01',
      to: '2025-08-31',
      note: 'Période fictive M43',
    }).period;
    expect(opened.status).toBe('open');
    expect(opened.statement_hash).toMatch(/^[0-9a-f]{32}$/);
    // An unmatched transaction blocks validation: incompleteness is visible.
    expect(() =>
      call('POST', `/companies/${company}/bank/periods/${opened.id}/validate`, { confirm: true }),
    ).toThrowError(/rapprochées|matched/i);
    call('POST', `/companies/${company}/bank/transactions/${txn.id}/exclude`, {
      reason: 'Frais fictifs exclus du test M43',
    });
    const entriesBefore = call<{ entries: any[] }>('GET', `/companies/${company}/entries`).entries.length;
    const validated = call<any>('POST', `/companies/${company}/bank/periods/${opened.id}/validate`, {
      confirm: true,
      note: 'Frais fictifs explicitement exclus de la période M43',
    }).period;
    expect(validated.status).toBe('validated');
    expect(validated.difference).toBe('0.0000');
    expect(validated.accepted_difference).toBe('0.0000');
    expect(call<{ entries: any[] }>('GET', `/companies/${company}/entries`).entries.length).toBe(entriesBefore);
    const csv = call<string>('GET', `/companies/${company}/bank/periods/${opened.id}/report.csv?lang=en`);
    expect(csv).toContain('Amounts frozen at validation');
    expect(csv).toContain(validated.statement_hash);
  });

  it('turns a receipt into a customer payment without posting an entry and is idempotent', () => {
    const customers = call<{ customers: any[] }>('GET', `/companies/${company}/billing/customers`).customers;
    const customer = customers.find((c) => c.isActive);
    expect(customer).toBeTruthy();
    const items = call<{ items: any[] }>('GET', `/companies/${company}/billing/items`).items;
    const item = items[0];
    const created = call<any>('POST', `/companies/${company}/billing/documents`, {
      kind: 'invoice',
      customerId: customer.id,
      issueDate: '2025-08-01',
      dueDate: '2025-08-31',
      currency: 'MUR',
      lines: [{ itemId: item.id, quantity: '1' }],
    }).document;
    const issued = call<any>('POST', `/companies/${company}/billing/documents/${created.id}/issue`).document;
    const amount = issued.outstanding;
    const imported = call<any>('POST', `/companies/${company}/bank/imports`, {
      bankAccountId: bank,
      fileName: 'm43-demo.csv',
      contentText: [
        'Date;Libellé;Référence;Débit;Crédit;Devise;Solde',
        `05/08/2025;Encaissement fictif M43;ENC-M43-DEMO;;${amount.replace('.', ',')};MUR;${amount.replace('.', ',')}`,
      ].join('\r\n'),
    });
    expect(imported.imported).toBe(1);
    const txn = call<{ transactions: any[] }>(
      'GET',
      `/companies/${company}/bank/transactions?bankAccountId=${bank}`,
    ).transactions.find((t) => t.reference === 'ENC-M43-DEMO');
    const entriesBefore = call<{ entries: any[] }>('GET', `/companies/${company}/entries`).entries.length;
    const payment = call<any>(
      'POST',
      `/companies/${company}/bank/transactions/${txn.id}/billing-payment`,
      {
        confirm: true,
        customerId: customer.id,
        allocations: [{ invoiceId: issued.id, amount }],
        note: 'Encaissement fictif confirmé',
      },
    );
    expect(payment.entryCreated).toBe(false);
    expect(payment.transaction.status).toBe('matched');
    const doc = call<any>('GET', `/companies/${company}/billing/documents/${issued.id}`).document;
    expect(doc.status).toBe('paid');
    expect(call<{ entries: any[] }>('GET', `/companies/${company}/entries`).entries.length).toBe(entriesBefore);
    const again = call<any>(
      'POST',
      `/companies/${company}/bank/transactions/${txn.id}/billing-payment`,
      { confirm: true, customerId: customer.id, allocations: [{ invoiceId: issued.id, amount }] },
    );
    expect(again.idempotent).toBe(true);
  });
});
