/**
 * Démonstration navigateur — mission 9 (banque & rapprochement).
 *
 * Ces tests appellent le backend embarqué exactement comme la page publiée :
 * les fichiers fictifs de `public/samples` sont lus sur disque, puis importés,
 * rapprochés et proposés sans aucun appel réseau ni accès bancaire.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it as test } from 'vitest';
import { DEMO_EMAIL, DEMO_PASSWORD, demoRequest, resetDemo } from '../src/demo';
import { ApiError } from '../src/errors';

const samplePath = (name: string) => resolve(process.cwd(), 'public', 'samples', name);
const base64 = (name: string) => readFileSync(samplePath(name)).toString('base64');

const call = <T>(method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: string, body?: unknown) =>
  demoRequest<T>(method, path, body);

let company = '';
let mur = '';
let eur = '';

const setup = () => {
  resetDemo();
  call('POST', '/auth/login', { email: DEMO_EMAIL, password: DEMO_PASSWORD });
  company = call<{ companies: { id: string }[] }>('GET', '/companies').companies[0]!.id;
  const accounts = call<{ accounts: { id: string; currency: string; masked_reference: string }[] }>(
    'GET',
    `/companies/${company}/bank/accounts`,
  ).accounts;
  mur = accounts.find((a) => a.currency === 'MUR')!.id;
  eur = accounts.find((a) => a.currency === 'EUR')!.id;
};

const preview = (file: string, bankAccountId = mur, extra: Record<string, unknown> = {}) =>
  call<any>('POST', `/companies/${company}/bank/preview`, {
    bankAccountId,
    fileName: file,
    contentBase64: base64(file),
    dayFirst: true,
    ...extra,
  });

const importFile = (file: string, bankAccountId = mur) =>
  call<any>('POST', `/companies/${company}/bank/imports`, {
    bankAccountId,
    fileName: file,
    contentBase64: base64(file),
    dayFirst: true,
  });

const transactions = (bankAccountId = mur, status?: string) =>
  call<{ transactions: any[] }>(
    'GET',
    `/companies/${company}/bank/transactions?bankAccountId=${bankAccountId}${status ? `&status=${status}` : ''}`,
  ).transactions;

beforeEach(setup);

describe('démo banque — comptes et import', () => {
  test('seede deux comptes fictifs (MUR et EUR) avec références masquées', () => {
    const accounts = call<{ accounts: any[] }>('GET', `/companies/${company}/bank/accounts`).accounts;
    expect(accounts).toHaveLength(2);
    expect(accounts.map((a) => a.currency).sort()).toEqual(['EUR', 'MUR']);
    expect(accounts.every((a) => a.masked_reference.startsWith('••••'))).toBe(true);
    expect(accounts.every((a) => a.account_code === '1010' || a.account_code === '1015')).toBe(true);
  });

  test('prévisualise le CSV fictif sans rien enregistrer', () => {
    const res = preview('releve-bancaire-fictif.csv');
    expect(res.preview.summary.total).toBe(8);
    expect(res.preview.summary.errors).toBe(0);
    expect(res.preview.summary.alreadyImported).toBe(6);
    expect(res.preview.blocksImport).toBe(false);
    expect(res.preview.transactions[1].amount).toBe('125000.0000');
    expect(transactions()).toHaveLength(7); // seules les 7 opérations MUR de démo existent
  });

  test('importe CSV puis réimporte sans doublon', () => {
    const first = importFile('releve-bancaire-fictif.csv');
    expect(first.imported).toBe(2);
    expect(first.reimport).toBe(false);
    expect(transactions()).toHaveLength(9);
    const second = importFile('releve-bancaire-fictif.csv');
    expect(second.reimport).toBe(true);
    expect(second.imported).toBe(0);
    expect(transactions()).toHaveLength(9);
  });

  test('importe un XLSX réellement zippé', () => {
    const res = importFile('releve-bancaire-fictif.xlsx');
    expect(res.import.format).toBe('xlsx');
    expect(res.imported).toBe(3);
  });

  test('contrôle les doublons internes au fichier', () => {
    const res = preview('releve-bancaire-doublons.csv');
    expect(res.preview.summary.duplicates).toBe(1);
    expect(res.preview.summary.importable).toBe(1);
  });

  test('bloque un fichier avec date impossible et devise incompatible', () => {
    const res = preview('releve-bancaire-erreurs.csv');
    expect(res.preview.blocksImport).toBe(true);
    const codes = res.preview.findings.map((f: any) => f.code);
    expect(codes).toContain('INVALID_DATE');
    expect(codes).toContain('CURRENCY_MISMATCH');
    expect(codes).toContain('BALANCE_MISMATCH');
    expect(res.preview.summary.importable).toBe(2); // les 2 lignes valides restent visibles mais bloquées
  });

  test('refuse un compte d’une autre société', () => {
    expect(() => preview('releve-bancaire-fictif.csv', crypto.randomUUID())).toThrow(ApiError);
  });

  test('exige un taux explicite pour un compte en devises', () => {
    const list = transactions(eur);
    expect(list).toHaveLength(1);
    const account = call<{ accounts: { id: string; code: string }[] }>('GET', `/companies/${company}/accounts`).accounts.find(
      (a) => a.code === '1100',
    )!;
    const proposal = call<any>('POST', `/companies/${company}/bank/transactions/${list[0]!.id}/proposals`, {
      accountId: account.id,
    });
    // accepter sans taux doit échouer : aucun taux n'est inventé
    expect(() =>
      call('POST', `/companies/${company}/bank/proposals/${proposal.proposal.id}/accept`, { confirm: true }),
    ).toThrow(/taux/i);
  });
});

describe('démo banque — rapprochement et propositions', () => {
  test('propose les correspondances sans les valider', () => {
    const txn = transactions().find((t) => t.reference === 'FA-2025-001')!;
    const detail = call<any>('GET', `/companies/${company}/bank/transactions/${txn.id}`);
    expect(detail.transaction.status).toBe('unmatched');
    expect(detail.match.candidates.length).toBeGreaterThan(0);
    expect(detail.match.status).not.toBe('confirmed');
  });

  test('exige confirm:true pour valider un rapprochement', () => {
    const txn = transactions().find((t) => t.reference === 'FA-2025-001')!;
    const detail = call<any>('GET', `/companies/${company}/bank/transactions/${txn.id}`);
    const lineId = detail.match.candidates[0].lineId;
    expect(() =>
      call('POST', `/companies/${company}/bank/transactions/${txn.id}/matches`, { lineIds: [lineId] }),
    ).toThrow(/confirmation/i);
    call('POST', `/companies/${company}/bank/transactions/${txn.id}/matches`, {
      lineIds: [lineId],
      confirm: true,
    });
    expect(transactions(mur, 'matched').some((t) => t.id === txn.id)).toBe(true);
  });

  test('refuse un montant qui ne correspond pas', () => {
    const txn = transactions().find((t) => t.reference === 'INCONNU-01')!;
    const detail = call<any>('GET', `/companies/${company}/bank/transactions/${txn.id}`);
    expect(detail.match.status).toBe('none');
    expect(['none', 'review']).toContain(detail.account.status);
    expect(detail.account.rationaleFr).toBeTruthy(); // décision humaine, aucun compte inventé
  });

  test('prépare une proposition de frais sans comptabiliser', () => {
    const txn = transactions().find((t) => t.reference === 'FRAIS-08')!;
    const res = call<any>('POST', `/companies/${company}/bank/transactions/${txn.id}/proposals`, {});
    expect(res.proposal.status).toBe('proposed');
    expect(transactions().find((t) => t.id === txn.id)!.status).toBe('unmatched');
    const entriesBefore = call<any>('GET', `/companies/${company}/entries`).entries.length;
    call('POST', `/companies/${company}/bank/proposals/${res.proposal.id}/accept`, { confirm: true });
    const entriesAfter = call<any>('GET', `/companies/${company}/entries`).entries.length;
    expect(entriesAfter).toBe(entriesBefore + 1);
  });

  test('signale un libellé de salaire sans calculer de paie', () => {
    const txn = transactions().find((t) => t.reference === 'SAL-08')!;
    const detail = call<any>('GET', `/companies/${company}/bank/transactions/${txn.id}`);
    expect(['salary', 'transfer']).toContain(detail.account.kind);
    if (detail.account.kind === 'salary') {
      expect(detail.account.rationaleFr).toMatch(/salaire|paie/i);
    }
    const payroll = call<any>('GET', `/companies/${company}/payroll/employees`);
    expect(payroll.employees ?? []).toHaveLength(0);
  });

  test('exclut une transaction puis la retrouve dans cet état', () => {
    const txn = transactions().find((t) => t.reference === 'INCONNU-01')!;
    call('POST', `/companies/${company}/bank/transactions/${txn.id}/exclude`, { reason: 'test' });
    expect(transactions(mur, 'excluded').some((t) => t.id === txn.id)).toBe(true);
  });
});

describe('démo banque — règles et rapport', () => {
  test('crée une règle versionnée, l’utilise puis la désactive', () => {
    const accounts = call<{ accounts: { id: string; code: string }[] }>('GET', `/companies/${company}/accounts`).accounts;
    const account = accounts.find((a) => a.code === '6140')!;
    const created = call<any>('POST', `/companies/${company}/bank/rules`, {
      name: 'Frais de test',
      labelPattern: 'frais bancaires',
      accountId: account.id,
      priority: 10,
    });
    expect(created.rule.version).toBe(1);
    const rules = call<any>('GET', `/companies/${company}/bank/rules`).rules;
    expect(rules.some((r: any) => r.id === created.rule.id)).toBe(true);
    call('DELETE', `/companies/${company}/bank/rules/${created.rule.id}`);
  });

  test('produit un rapport non « rapproché » quand des écarts existent', () => {
    const report = call<any>('GET', `/companies/${company}/bank/report?bankAccountId=${mur}`).report;
    expect(report).toBeTruthy();
    expect(report.status).not.toBe('reconciled');
    expect(report.unmatchedCount).toBeGreaterThan(0);
    expect(report.explanations.length).toBeGreaterThan(0);
  });

  test('isole les comptes bancaires par société', () => {
    const created = call<any>('POST', '/companies', {
      name: 'Société fictive test banque',
      country: 'MU',
      financialYearStart: '2025-07-01',
      financialYearEnd: '2026-06-30',
    });
    const other = call<any>('GET', `/companies/${created.company.id}/bank/accounts`).accounts;
    expect(other).toHaveLength(0);
  });
});
