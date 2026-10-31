/**
 * Démonstration navigateur — mission 12 (lettrage).
 * Aucune donnée réelle ; tout est fictif et reste dans localStorage.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { DEMO_EMAIL, DEMO_PASSWORD, demoRequest, resetDemo } from '../src/demo';
import { ApiError } from '../src/errors';

const call = <T>(method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: string, body?: unknown) =>
  demoRequest<T>(method, path, body);

let company = '';
let recv = '';
let payable = '';

const setup = () => {
  resetDemo();
  call('POST', '/auth/login', { email: DEMO_EMAIL, password: DEMO_PASSWORD });
  company = call<{ companies: { id: string }[] }>('GET', '/companies').companies[0]!.id;
  const accounts = call<{ accounts: { id: string; code: string }[] }>(
    'GET',
    `/companies/${company}/accounts`,
  ).accounts;
  recv = accounts.find((a) => a.code === '1100')!.id;
  payable = accounts.find((a) => a.code === '2000')!.id;
};

interface Line {
  id: string;
  entryNo: string;
  entryReference: string | null;
  entryStatus: string;
  side: 'debit' | 'credit';
  debit: string;
  credit: string;
  amount: string;
  lettered: string;
  remaining: string;
  currency: string;
  documentId: string | null;
  documentNo: string | null;
  commercialOutstanding: string | null;
}

const lines = (accountId: string, status = 'all') =>
  call<{ lines: Line[]; pending: Line[] }>(
    'GET',
    `/companies/${company}/lettering/lines?accountId=${accountId}&status=${status}&includeUnposted=true`,
  );

const groupLettering = (accountId: string, allocations: { lineId: string; amount: string }[]) =>
  call<any>('POST', `/companies/${company}/lettering`, {
    accountId,
    allocations,
    confirm: true,
    idempotencyKey: crypto.randomUUID(),
  });

describe('lettrage (démo)', () => {
  beforeEach(setup);

  it('expose les comptes tiers et les scénarios fictifs A à G', () => {
    const accounts = call<{ accounts: { code: string; unlettered: string }[] }>(
      'GET',
      `/companies/${company}/lettering/accounts`,
    ).accounts;
    expect(accounts.map((a) => a.code)).toEqual(expect.arrayContaining(['1100', '2000']));
    const supplierLines = lines(payable).lines;
    const cInvoice = supplierLines.find((l) => l.entryReference === 'ACH-DEMO-C')!;
    const cPayment = supplierLines.find((l) => l.entryReference === 'REG-DEMO-C1')!;
    expect(cInvoice.amount).toBe('80000.0000');
    expect(cInvoice.lettered).toBe('30000.0000');
    expect(cInvoice.remaining).toBe('50000.0000');
    expect(cPayment.remaining).toBe('0.0000');
    const customerLines = lines(recv).lines;
    const aInvoice = customerLines.find((l) => l.entryReference === 'FAC-DEMO-A')!;
    expect(aInvoice.remaining).toBe('0.0000');
    const bInvoice = customerLines.find((l) => l.entryReference === 'FAC-DEMO-B')!;
    expect(bInvoice.remaining).toBe('30000.0000');
    const gInvoice = customerLines.find((l) => l.entryReference === 'FAC-DEMO-G')!;
    expect(gInvoice.remaining).toBe('30000.0000');
  });

  it('refuse un double lettrage et une ligne de brouillon', () => {
    const supplierLines = lines(payable).lines;
    const cInvoice = supplierLines.find((l) => l.entryReference === 'ACH-DEMO-C')!;
    const cPayment = supplierLines.find((l) => l.entryReference === 'REG-DEMO-C1')!;
    expect(() =>
      groupLettering(payable, [
        { lineId: cInvoice.id, amount: '50000' },
        { lineId: cPayment.id, amount: '30000' },
      ]),
    ).toThrow(ApiError);
    const draft = call<{ entry: { id: string } }>('POST', `/companies/${company}/entries`, {
      journalId: call<{ journals: { id: string; code: string }[] }>('GET', `/companies/${company}/journals`).journals.find((j) => j.code === 'SAL')!.id,
      entryDate: '2026-06-01',
      reference: 'BROUILLON-DEMO-LET',
      description: 'Brouillon fictif non comptabilisé',
      status: 'draft',
      lines: [
        { accountId: recv, debit: '1000' },
        { accountId: call<{ accounts: { id: string; code: string }[] }>('GET', `/companies/${company}/accounts`).accounts.find((a) => a.code === '4010')!.id, credit: '1000' },
      ],
    });
    expect(draft.entry.id).toBeTruthy();
    const pending = lines(recv);
    expect(pending.pending.some((l) => l.entryReference === 'BROUILLON-DEMO-LET')).toBe(true);
    expect(() =>
      groupLettering(recv, [
        { lineId: pending.pending.find((l) => l.entryReference === 'BROUILLON-DEMO-LET')!.id, amount: '1000' },
        { lineId: lines(recv).lines.find((l) => l.entryReference === 'REG-DEMO-G')!.id, amount: '1000' },
      ]),
    ).toThrow(/non comptabilisée|not posted/);
  });

  it('produit des suggestions déterministes sans validation automatique', () => {
    const res = call<{ suggestions: any[]; autoValidated: boolean; method: string }>(
      'GET',
      `/companies/${company}/lettering/suggestions`,
    );
    expect(res.method).toBe('deterministic');
    expect(res.autoValidated).toBe(false);
    expect(res.suggestions.length).toBeGreaterThan(0);
    for (const suggestion of res.suggestions) {
      expect(suggestion.rationale.length).toBeGreaterThan(0);
      expect(suggestion.confidence).toBeGreaterThan(0);
      expect(suggestion.suggestedLines).toHaveLength(2);
    }
  });

  it('délettre avec motif, conserve l’historique et libère les lignes', () => {
    const gInvoice = lines(recv).lines.find((l) => l.entryReference === 'FAC-DEMO-G')!;
    const gPayment = lines(recv).lines.find((l) => l.entryReference === 'REG-DEMO-G')!;
    const created = groupLettering(recv, [
      { lineId: gInvoice.id, amount: '30000' },
      { lineId: gPayment.id, amount: '30000' },
    ]);
    expect(created.lettering.amount).toBe('30000.0000');
    const reversed = call<any>('POST', `/companies/${company}/lettering/${created.lettering.id}/reverse`, {
      reason: 'Motif fictif de test',
      confirm: true,
    });
    expect(reversed.lettering.status).toBe('reversed');
    expect(reversed.lettering.reversal_reason).toBe('Motif fictif de test');
    const after = lines(recv).lines.find((l) => l.entryReference === 'FAC-DEMO-G')!;
    expect(after.remaining).toBe('30000.0000');
    const history = call<{ events: any[] }>(
      'GET',
      `/companies/${company}/lettering/history?letteringId=${created.lettering.id}`,
    ).events;
    expect(history.map((e) => e.action)).toEqual(expect.arrayContaining(['created', 'reversed']));
  });

  it('exige un motif et une confirmation pour délettrer', () => {
    const group = call<{ letterings: any[] }>('GET', `/companies/${company}/lettering?status=active`).letterings[0]!;
    expect(() =>
      call('POST', `/companies/${company}/lettering/${group.id}/reverse`, { confirm: true }),
    ).toThrow(/motif|reason/i);
    expect(() =>
      call('POST', `/companies/${company}/lettering/${group.id}/reverse`, { reason: 'X' }),
    ).toThrow();
  });

  it('rapporte les écarts commercial/comptable et exporte un CSV par devise', () => {
    const report = call<{ report: any }>('GET', `/companies/${company}/lettering/report`).report;
    expect(report.unlettered.byCurrency.length).toBeGreaterThan(0);
    expect(report.partiallyLettered.some((d: any) => d.number === 'ACH-DEMO-C')).toBe(true);
    for (const row of report.unlettered.byCurrency) {
      expect(row.currency).toBeTruthy();
      expect(row.balance).toMatch(/^-?\d+\.\d{4}$/);
    }
    const csv = call<string>('GET', `/companies/${company}/lettering/report.csv`);
    expect(csv).toContain('Compte');
    expect(csv).toContain('Restant');
    expect(csv).toContain('ACH-DEMO-C');
  });

  it('rapproche un règlement fournisseur en banque sans créer de paiement ni d’écriture', () => {
    const banks = call<{ accounts: { id: string }[] }>('GET', `/companies/${company}/bank/accounts`).accounts;
    const txns = call<{ transactions: any[] }>(
      'GET',
      `/companies/${company}/bank/transactions?bankAccountId=${banks[0]!.id}`,
    ).transactions;
    const txn = txns.find((t) => t.label.includes('Paiement fournisseur'))!;
    const candidates = call<{ candidates: any[]; direction: string }>(
      'GET',
      `/companies/${company}/bank/transactions/${txn.id}/supplier-candidates`,
    );
    expect(candidates.direction).toBe('out');
    const candidate = candidates.candidates.find((c) => !c.issues.some((i: any) => i.blocking))!;
    expect(candidate).toBeTruthy();
    const entriesBefore = call<{ total: number }>('GET', `/companies/${company}/entries?limit=1`).total;
    const paymentsBefore = call<{ payments: any[] }>('GET', `/companies/${company}/purchases/payments`).payments.length;
    const linked = call<any>('POST', `/companies/${company}/bank/transactions/${txn.id}/supplier-payments`, {
      paymentId: candidate.paymentId,
      amount: candidate.suggestedAmount,
      confirm: true,
    });
    expect(linked.idempotent).toBe(false);
    expect(call<{ total: number }>('GET', `/companies/${company}/entries?limit=1`).total).toBe(entriesBefore);
    expect(call<{ payments: any[] }>('GET', `/companies/${company}/purchases/payments`).payments.length).toBe(paymentsBefore);
    const again = call<any>('POST', `/companies/${company}/bank/transactions/${txn.id}/supplier-payments`, {
      paymentId: candidate.paymentId,
      amount: candidate.suggestedAmount,
      confirm: true,
    });
    expect(again.idempotent).toBe(true);
    call('DELETE', `/companies/${company}/bank/transactions/${txn.id}/supplier-payments/${candidate.paymentId}`, {
      confirm: true,
      reason: 'Retrait fictif de test',
    });
  });

  it('explique un lettrage partiel en français et en anglais', () => {
    const cInvoice = lines(payable).lines.find((l) => l.entryReference === 'ACH-DEMO-C')!;
    const res = call<{ explanation: any }>(
      'GET',
      `/companies/${company}/lettering/explain/${cInvoice.id}`,
    ).explanation;
    expect(res.explanation.fr).toContain('partiellement');
    expect(res.explanation.en).toContain('partially');
    expect(res.line.remaining).toBe('50000.0000');
  });
});
