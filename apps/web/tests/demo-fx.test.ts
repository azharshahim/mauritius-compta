/**
 * Démonstration navigateur — mission 13 (multidevises).
 * Tous les taux sont fictifs et restent dans localStorage.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { DEMO_EMAIL, DEMO_PASSWORD, demoRequest, resetDemo } from '../src/demo';

const call = <T>(method: 'GET' | 'POST' | 'PATCH', path: string, body?: unknown) =>
  demoRequest<T>(method, path, body);

let company = '';

const setup = () => {
  resetDemo();
  call('POST', '/auth/login', { email: DEMO_EMAIL, password: DEMO_PASSWORD });
  company = call<{ companies: { id: string }[] }>('GET', '/companies').companies[0]!.id;
};

const today = () => new Date().toISOString().slice(0, 10);

describe('multidevises (démo)', () => {
  beforeEach(setup);

  it('affiche la configuration, les devises autorisées et le verrou fonctionnel', () => {
    const config = call<any>('GET', `/companies/${company}/fx/config`);
    expect(config.functionalCurrency).toBe('MUR');
    expect(config.allowedCurrencies.map((c: any) => c.currency)).toEqual(['MUR', 'EUR', 'USD', 'GBP']);
    expect(config.valuationPosting).toBe(false);
    expect(config.ratePolicy).toBe('validated_only');
  });

  it('refuse un taux nul ou négatif et exige une référence pour un taux importé', () => {
    expect(() =>
      call('POST', `/companies/${company}/fx/rates`, {
        baseCurrency: 'EUR', quoteCurrency: 'MUR', rateDate: today(), rate: '0',
        sourceKind: 'manual', source: 'Test fictif',
      }),
    ).toThrowError(/taux|rate|montant/i);
    expect(() =>
      call('POST', `/companies/${company}/fx/rates`, {
        baseCurrency: 'EUR', quoteCurrency: 'MUR', rateDate: today(), rate: '50.5',
        sourceKind: 'imported', source: 'Import fictif',
      }),
    ).toThrowError(/référence/i);
  });

  it('ne résout qu’un taux validé, jamais un brouillon, et bloque une date sans taux', () => {
    const rates = call<{ rates: any[] }>('GET', `/companies/${company}/fx/rates`).rates;
    const draft = rates.find((r) => r.status === 'draft')!;
    expect(draft).toBeTruthy();
    expect(() =>
      call('GET', `/companies/${company}/fx/resolve?amount=1000&from=EUR&to=MUR&date=${draft.rate_date}`),
    ).toThrowError(/validé/i);
    expect(() =>
      call('GET', `/companies/${company}/fx/resolve?amount=1000&from=EUR&to=MUR&date=2025-07-17`),
    ).toThrowError(/aucun taux/i);
    const ok = call<any>('GET', `/companies/${company}/fx/resolve?amount=1000&from=EUR&to=MUR&date=${today()}`);
    expect(ok.converted).toBe('50000.0000');
    expect(ok.official).toBe(false);
  });

  it('valide un taux après confirmation humaine seulement', () => {
    const rates = call<{ rates: any[] }>('GET', `/companies/${company}/fx/rates`).rates;
    const draft = rates.find((r) => r.status === 'draft')!;
    expect(() => call('POST', `/companies/${company}/fx/rates/${draft.id}/validate`, {})).toThrowError(/confirmation/i);
    const validated = call<any>('POST', `/companies/${company}/fx/rates/${draft.id}/validate`, { confirm: true, supersede: true });
    expect(validated.rate.status).toBe('validated');
  });

  it('propose les écarts réalisés mais bloque la comptabilisation sans comptes configurés', () => {
    const adjustments = call<{ adjustments: any[] }>('GET', `/companies/${company}/fx/realized`).adjustments;
    expect(adjustments.length).toBeGreaterThanOrEqual(3);
    const gain = adjustments.find((a) => a.direction === 'gain')!;
    expect(gain.settled_txn_amount).toBe('1000.0000');
    expect(gain.difference).toBe('1000.0000');
    expect(() =>
      call('POST', `/companies/${company}/fx/realized/${gain.id}/post`, { confirm: true }),
    ).toThrowError(/comptes/i);
  });

  it('simule une évaluation sans double évaluation et bloque la comptabilisation', () => {
    const first = call<any>('POST', `/companies/${company}/fx/valuations`, { valuationDate: today() });
    expect(first.valuation.postingBlocked).toBe(true);
    const second = call<any>('POST', `/companies/${company}/fx/valuations`, { valuationDate: today() });
    expect(second.reused).toBe(true);
    expect(second.valuation.id).toBe(first.valuation.id);
    expect(() =>
      call('POST', `/companies/${company}/fx/valuations/${first.valuation.id}/post`, {}),
    ).toThrowError(/bloqu/i);
  });

  it('prévisualise un virement inter-devises avec des frais distincts, sans produit ni charge', () => {
    const banks = call<{ accounts: any[] }>('GET', `/companies/${company}/bank/accounts`).accounts;
    const mur = banks.find((b) => b.currency === 'MUR')!;
    const eur = banks.find((b) => b.currency === 'EUR')!;
    const preview = call<any>('POST', `/companies/${company}/fx/transfers`, {
      fromBankAccountId: eur.id, toBankAccountId: mur.id, transferDate: today(),
      fromAmount: '100', feeAmount: '5',
    });
    expect(preview.transfer.from_currency).toBe('EUR');
    expect(preview.transfer.to_currency).toBe('MUR');
    expect(preview.transfer.rate).toBe('50.00000000');
    expect(preview.transfer.to_amount).toBe('5000.0000');
    expect(preview.transfer.fee_amount).toBe('5.0000');
    expect(preview.transfer.fee_currency).toBe('EUR');
    expect(preview.postingBlocked).toBe(true);
    expect(() => call('POST', `/companies/${company}/fx/transfers/${preview.transfer.id}/post`, {})).toThrowError(/bloqu/i);
  });

  it('produit un rapport par devise sans total inter-devises', () => {
    const report = call<any>('GET', `/companies/${company}/fx/report`).report;
    expect(report.functionalCurrency).toBe('MUR');
    expect(report.note).toMatch(/Aucun total inter-devises/i);
    expect(report.blockedOperations.length).toBeGreaterThan(0);
  });
});
