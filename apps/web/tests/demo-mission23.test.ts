/** Mission 23 demo backend — documents, bilingual chart and MCB fixture. */
import { beforeEach, describe, expect, it } from 'vitest';
import { DEMO_EMAIL, DEMO_PASSWORD, demoRequest, resetDemo } from '../src/demo';

const call = <T>(method: 'GET' | 'POST' | 'PATCH', path: string, body?: unknown) =>
  demoRequest<T>(method, path, body);

let company = '';
let bankId = '';

beforeEach(() => {
  resetDemo();
  call('POST', '/auth/login', { email: DEMO_EMAIL, password: DEMO_PASSWORD });
  company = call<{ companies: { id: string }[] }>('GET', '/companies').companies[0]!.id;
  bankId = call<{ accounts: { id: string }[] }>('GET', `/companies/${company}/bank/accounts`).accounts[0]!.id;
});

describe('mission 23 demo — bilingual chart', () => {
  it('seeds two distinct chart profiles and distinct FR/EN labels', () => {
    const companies = call<{ companies: { id: string }[] }>('GET', '/companies').companies;
    const first = call<{ profile: any }>('GET', `/companies/${companies[0]!.id}/chart-of-accounts/profile`).profile;
    const second = call<{ profile: any }>('GET', `/companies/${companies[1]!.id}/chart-of-accounts/profile`).profile;
    expect(first.template_type).toBe('provisional_mauritius');
    expect(second.template_type).toBe('firm_chart');
    expect(second.status).toBe('AWAITING FIRM CONFIRMATION');
    const accounts = call<{ accounts: any[] }>('GET', `/companies/${company}/accounts`).accounts;
    const cash = accounts.find((a) => a.code === '1010');
    expect(cash.name_fr).toBe('Banque — compte courant MUR');
    expect(cash.name_en).toBe('Bank — current account MUR');
    expect(cash.code).toBe('1010');
  });

  it('never changes a code when labels are edited', () => {
    const accounts = call<{ accounts: any[] }>('GET', `/companies/${company}/accounts`).accounts;
    const account = accounts.find((a) => a.code === '6100');
    call('PATCH', `/companies/${company}/accounts/${account.id}`, { nameEn: 'Rent expense (demo)' });
    const updated = call<{ accounts: any[] }>('GET', `/companies/${company}/accounts`).accounts
      .find((a) => a.id === account.id);
    expect(updated.code).toBe('6100');
    expect(updated.name_en).toBe('Rent expense (demo)');
    expect(updated.name_fr).toBe(account.name_fr);
  });

  it('previews and confirms an import without overwriting an existing code', () => {
    const preview = call<any>('POST', `/companies/${company}/chart-of-accounts/import/preview`, {
      fileName: 'plan-cabinet-demo.xlsx', contentBase64: 'ZmljdGl2ZQ==',
    });
    expect(preview.rows.some((r: any) => r.code === '4000' && r.exists)).toBe(true);
    const before = call<{ accounts: any[] }>('GET', `/companies/${company}/accounts`).accounts
      .find((a) => a.code === '4000');
    const result = call<any>('POST', `/companies/${company}/chart-of-accounts/import/confirm`, {
      fileName: 'plan-cabinet-demo.xlsx', contentBase64: 'ZmljdGl2ZQ==', confirm: true,
      rows: preview.rows.filter((r: any) => !r.exists),
    });
    expect(result.created).toBe(2);
    expect(result.status).toBe('AWAITING FIRM CONFIRMATION');
    const after = call<{ accounts: any[] }>('GET', `/companies/${company}/accounts`).accounts
      .find((a) => a.code === '4000');
    expect(after.id).toBe(before.id);
  });
});

describe('mission 23 demo — documents', () => {
  it('seeds purchase, sale, scanned and duplicate documents', () => {
    const documents = call<{ documents: any[] }>('GET', `/companies/${company}/documents`).documents;
    expect(documents).toHaveLength(6);
    expect(documents.filter((d) => d.kind === 'purchase').length).toBe(4);
    expect(documents.filter((d) => d.kind === 'sale').length).toBe(2);
    expect(documents.some((d) => d.status === 'DUPLICATE')).toBe(true);
    expect(documents.some((d) => d.extraction_method === 'ocr_image')).toBe(true);
    expect(documents.some((d) => d.status === 'APPROVED')).toBe(true);
  });

  it('proposes, rejects and never learns from a rejected proposal', () => {
    const documents = call<{ documents: any[] }>('GET', `/companies/${company}/documents`).documents;
    const scanned = documents.find((d) => d.extraction_method === 'ocr_image');
    const proposed = call<any>('POST', `/companies/${company}/documents/${scanned.id}/proposal`).proposal;
    expect(proposed.balanced).toBe(true);
    call('POST', `/companies/${company}/documents/proposals/${proposed.id}/reject`, { reason: 'Pièce illisible (fictif)' });
    const detail = call<any>('GET', `/companies/${company}/documents/${scanned.id}`);
    expect(detail.document.status).toBe('REJECTED');
    const again = () => call<any>('POST', `/companies/${company}/documents/${scanned.id}/proposal`);
    expect(again).toThrow();
  });

  it('adds a pre-recorded demo document on upload and marks it clearly', () => {
    const result = call<any>('POST', `/companies/${company}/documents`, {
      fileName: 'photo-demo.jpg', contentBase64: 'ZmljdGlm', declaredMime: 'image/jpeg', kind: 'purchase',
    });
    expect(result.document.id).toBeTruthy();
    expect(result.document.status).toBe('EXTRACTED');
    expect(result.document.warnings.join(' ')).toMatch(/préenregistr|OCR/i);
  });
});

describe('mission 23 demo — MCB statement', () => {
  it('previews a balanced fictional statement and imports once', () => {
    const body = { bankAccountId: bankId, fileName: 'mcb-demo.pdf', contentBase64: 'JVBERi0=' };
    const preview = call<any>('POST', `/companies/${company}/bank/mcb/preview`, body);
    expect(preview.preview.preview.transactions).toHaveLength(7);
    expect(preview.preview.preview.balances.consistent).toBe(true);
    expect(preview.mcb.openingBalance).toBe('15000.0000');
    expect(preview.mcb.closingBalance).toBe('15924.7500');
    expect(preview.mcb.warnings[0].code).toBe('MCB_DEMO_FIXTURE');
    const first = call<any>('POST', `/companies/${company}/bank/mcb/import`, { ...body, confirm: true });
    expect(first.imported + first.duplicates).toBe(7);
    const second = call<any>('POST', `/companies/${company}/bank/mcb/import`, { ...body, confirm: true });
    expect(second.imported).toBe(0);
  });
});
