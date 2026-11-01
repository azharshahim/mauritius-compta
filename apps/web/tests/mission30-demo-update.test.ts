/** Mission 30 — the demo exposes the mission 28/29 verification fields. */
import { beforeEach, describe, expect, it } from 'vitest';
import { DEMO_EMAIL, DEMO_PASSWORD, demoRequest, resetDemo } from '../src/demo';
import { upgradeDemoMission23 } from '../src/demo/mission23';

const call = <T>(method: 'GET' | 'POST' | 'PATCH', path: string, body?: unknown) =>
  demoRequest<T>(method, path, body);
let company = '';

beforeEach(() => {
  resetDemo();
  call('POST', '/auth/login', { email: DEMO_EMAIL, password: DEMO_PASSWORD });
  company = call<{ companies: { id: string }[] }>('GET', '/companies').companies[0]!.id;
});

describe('mission 30 — updated demonstration', () => {
  it('exposes verification metadata on every seeded document', () => {
    const documents = call<any>('GET', `/companies/${company}/documents`).documents;
    expect(documents).toHaveLength(6);
    for (const document of documents) {
      expect(document.document_type).toBeTruthy();
      expect(document.field_confidence).toBeTruthy();
      expect(Array.isArray(document.uncertain_fields)).toBe(true);
      expect(document.extraction_quality).toBeTruthy();
    }
    const first = documents[0];
    expect(first.tax_ids.supplierBrn).toBe('C12345678901');
    expect(first.purchase_order).toBe('PO-7788');
    const scanned = documents.find((document: any) => document.extraction_method === 'ocr_image');
    expect(scanned.uncertain_fields).toContain('invoiceNumber');
    expect(scanned.field_confidence.invoiceNumber).toBeLessThan(0.8);
  });

  it('removes a corrected field from the uncertainty list', () => {
    const documents = call<any>('GET', `/companies/${company}/documents`).documents;
    const scanned = documents.find((document: any) => document.extraction_method === 'ocr_image');
    call('PATCH', `/companies/${company}/documents/${scanned.id}`, { invoice_number: 'INV-2026-999', tax_ids: { supplierBrn: 'C00000000001' } });
    const updated = call<any>('GET', `/companies/${company}/documents/${scanned.id}`).document;
    expect(updated.invoice_number).toBe('INV-2026-999');
    expect(updated.tax_ids.supplierBrn).toBe('C00000000001');
    expect(updated.uncertain_fields).not.toContain('invoiceNumber');
  });

  it('upgrades a previously stored demo state in place', () => {
    const state = { mission23: { documents: [{
      id: 'demo-doc-1', confidence: 0.58, extraction_method: 'ocr_image', page_count: 1,
      warnings: [], field_confidence: undefined, uncertain_fields: undefined,
    }] } } as any;
    upgradeDemoMission23(state);
    const document = state.mission23.documents[0];
    expect(document.field_confidence.invoiceNumber).toBeLessThan(0.8);
    expect(document.uncertain_fields).toContain('invoiceNumber');
    expect(document.extraction_quality.demoFixture).toBe(true);
    expect(document.document_type).toBe('invoice');
  });

  it('declares the demo MCB profile with a clearly fictional account number', () => {
    const account = call<{ accounts: any[] }>('GET', `/companies/${company}/bank/accounts`).accounts[0];
    const preview = call<any>('POST', `/companies/${company}/bank/mcb/preview`, { fileName: 'mcb-demo.pdf', bankAccountId: account.id });
    expect(preview.mcb.profileKey).toBe('mcb');
    expect(preview.mcb.detectedBankKey).toBe('mcb');
    expect(preview.mcb.accountNumber).toBe('000123456789');
    expect(preview.mcb.bankName).toContain('fictif');
  });
});
