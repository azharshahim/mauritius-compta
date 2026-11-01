import PDFDocument from 'pdfkit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  accountByCode, api, createCompany, journalByCode, registerUser, setupCompanyWithChart,
  type TestContext,
} from './helpers.js';
import { parseInvoiceText, type ParsedInvoice } from '../src/modules/documents/parse-invoice.js';
import { parseMcbStatement } from '../src/modules/bank/mcb.js';
import { extractDocument, terminateOcr } from '../src/modules/documents/extract.js';
import { detectSignature as detectDocumentSignature } from '../src/modules/documents/service.js';

/** Every fixture below is fictional. No real person, bank or account is used. */

async function makePdf(pages: string[][], imagePage = false): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  const chunks: Buffer[] = [];
  doc.on('data', (chunk) => chunks.push(chunk as Buffer));
  pages.forEach((lines, pageIndex) => {
    if (pageIndex > 0) doc.addPage();
    lines.forEach((line, index) => {
      doc.fontSize(index === 0 ? 16 : 11).text(line, 50, 50 + index * 22);
    });
  });
  doc.end();
  await new Promise<void>((resolve) => doc.on('end', () => resolve()));
  return Buffer.concat(chunks);
}

const EN_INVOICE = [
  'NORTHSTAR TRADING LTD', 'BRN: C12345678901', 'VAT Reg No: VAT20456789',
  'Royal Road, Port Louis', 'TAX INVOICE', 'Invoice No: INV-2026-201',
  'Invoice Date: 15 March 2026', 'Due Date: 14 April 2026', 'Purchase Order: PO-7788',
  'Bill To: LAGON TRADING LTD', 'BRN: C98765432109',
  'Description Qty Unit Price Net VAT Total',
  'Consulting services 10 2,500.00 25,000.00 3,750.00 28,750.00',
  'Subtotal: MUR 25,000.00', 'VAT (15%): MUR 3,750.00', 'Total Due: MUR 28,750.00',
  'Currency: MUR', 'Payment Terms: Net 30',
];
const FR_INVOICE = [
  'FOURNITURES MAURICE LTEE', 'Facture N° FAC-2026-045', 'Date de facture : 03/02/2026',
  'Échéance : 05/03/2026', 'Client : LAGON TRADING LTD',
  'Designation Quantite Prix unitaire Montant HT TVA Total',
  'Fournitures bureau 4 3 000,00 12 000,00 1 800,00 13 800,00',
  'Total HT : 12 000,00 EUR', 'Remise : 1 000,00 EUR', 'TVA (15%) : 1 650,00 EUR',
  'Total TTC : 12 650,00 EUR', 'Devise : EUR',
];
const VAT_ONLY_INVOICE = [
  'VAT TEST SUPPLIES LTD', 'TAX INVOICE', 'Invoice No: INV-VAT-77',
  'Invoice Date: 20/05/2026', 'Bill To: FICTIONAL CUSTOMER',
  'Description Qty Unit Price Net VAT Total',
  'Goods 1 10,000.00 10,000.00 1,500.00 11,500.00',
  'Subtotal: MUR 10,000.00', 'VAT (15%): MUR 1,500.00', 'Total Due: MUR 11,500.00', 'Currency: MUR',
];
const NO_VAT_INVOICE = [
  'PACIFIC SERVICES LTD', 'INVOICE INV-2026-300', 'Invoice Date: 01 Apr 2026',
  'Bill To: LAGON TRADING LTD', 'Description Qty Unit Price Net Total',
  'Advisory 1 8,000.00 8,000.00 8,000.00', 'Subtotal: MUR 8,000.00',
  'No VAT — exempt service', 'Total: MUR 8,000.00', 'Currency: MUR',
];
const CREDIT_NOTE = [
  'ACME OFFICE SUPPLIES LTD', 'CREDIT NOTE', 'Credit Note No: CN-2026-004',
  'Date: 10/04/2026', 'Bill To: LAGON TRADING LTD',
  'Description Qty Unit Price Net VAT Total',
  'Returned paper 1 5,000.00 5,000.00 750.00 5,750.00',
  'Subtotal: MUR 5,000.00', 'VAT: MUR 750.00', 'Total: MUR 5,750.00', 'Currency: MUR',
];
const USD_INVOICE = [
  'GLOBAL CONSULTING INC', 'INVOICE', 'Invoice No: USD-2026-009',
  'Invoice Date: 12/06/2026', 'Description Qty Unit Price Net VAT Total',
  'Advisory 1 1,000.00 1,000.00 0.00 1,000.00',
  'Subtotal: USD 1,000.00', 'VAT: USD 0.00', 'Total Due: USD 1,000.00', 'Currency: USD',
];
const MULTI_INVOICE = [
  'SUPPLIER A LTD', 'TAX INVOICE', 'Invoice No: INV-A-001', 'Invoice Date: 01/07/2026',
  'Subtotal: MUR 1,000.00', 'VAT: MUR 150.00', 'Total: MUR 1,150.00',
  'SUPPLIER B LTD', 'TAX INVOICE', 'Invoice No: INV-B-002', 'Invoice Date: 02/07/2026',
  'Subtotal: MUR 2,000.00', 'VAT: MUR 300.00', 'Total: MUR 2,300.00', 'Currency: MUR',
];
const MULTIPAGE_INVOICE = [
  'MULTIPAGE SUPPLIES LTD', 'TAX INVOICE', 'Invoice No: INV-MP-001',
  'Invoice Date: 05/08/2026', 'Description Qty Unit Price Net VAT Total',
  'Page one item 1 1,000.00 1,000.00 150.00 1,150.00',
  'Page 1 of 2',
  'Page two continuation', 'Page two item 2 2,000.00 2,000.00 300.00 2,300.00',
  'Subtotal: MUR 3,000.00', 'VAT: MUR 450.00', 'Total: MUR 3,450.00', 'Currency: MUR', 'Page 2 of 2',
];

interface Expected {
  supplierName?: string | null;
  invoiceNumber?: string | null;
  invoiceDate?: string | null;
  dueDate?: string | null;
  currency?: string | null;
  subtotal?: string | null;
  vatTotal?: string | null;
  total?: string | null;
  discountTotal?: string | null;
  documentType?: ParsedInvoice['documentType'];
  supplierBrn?: string | null;
  supplierVat?: string | null;
  customerBrn?: string | null;
  purchaseOrder?: string | null;
}
interface Case { name: string; lines: string[]; expected: Expected; options?: { pageCount?: number }; codes?: string[] }

const CASES: Case[] = [
  { name: 'Facture mauricienne en anglais', lines: EN_INVOICE, expected: {
    supplierName: 'NORTHSTAR TRADING LTD', invoiceNumber: 'INV-2026-201', invoiceDate: '2026-03-15',
    dueDate: '2026-04-14', currency: 'MUR', subtotal: '25000.0000', vatTotal: '3750.0000', total: '28750.0000',
    documentType: 'invoice', supplierBrn: 'C12345678901', supplierVat: 'VAT20456789',
    customerBrn: 'C98765432109', purchaseOrder: 'PO-7788' } },
  { name: 'Facture en français avec remise', lines: FR_INVOICE, expected: {
    supplierName: 'FOURNITURES MAURICE LTEE', invoiceNumber: 'FAC-2026-045', invoiceDate: '2026-02-03',
    currency: 'EUR', subtotal: '12000.0000', vatTotal: '1650.0000', total: '12650.0000',
    discountTotal: '1000.0000', documentType: 'invoice' } },
  { name: 'Facture avec TVA', lines: VAT_ONLY_INVOICE, expected: {
    invoiceNumber: 'INV-VAT-77', invoiceDate: '2026-05-20', currency: 'MUR',
    subtotal: '10000.0000', vatTotal: '1500.0000', total: '11500.0000', documentType: 'invoice' } },
  { name: 'Facture sans TVA', lines: NO_VAT_INVOICE, expected: {
    invoiceNumber: 'INV-2026-300', invoiceDate: '2026-04-01', currency: 'MUR',
    subtotal: '8000.0000', vatTotal: '0.0000', total: '8000.0000', documentType: 'invoice' }, codes: ['VAT_ZERO_STATED'] },
  { name: 'Avoir fournisseur', lines: CREDIT_NOTE, expected: {
    invoiceNumber: 'CN-2026-004', invoiceDate: '2026-04-10', currency: 'MUR',
    subtotal: '5000.0000', vatTotal: '750.0000', total: '5750.0000', documentType: 'credit_note' } },
  { name: 'Facture multipage', lines: MULTIPAGE_INVOICE, expected: {
    invoiceNumber: 'INV-MP-001', invoiceDate: '2026-08-05', currency: 'MUR',
    subtotal: '3000.0000', vatTotal: '450.0000', total: '3450.0000', documentType: 'invoice' },
    options: { pageCount: 2 }, codes: ['MULTIPAGE_SOURCE'] },
  { name: 'PDF contenant plusieurs factures', lines: MULTI_INVOICE, expected: {
    invoiceNumber: 'INV-A-001', currency: 'MUR', documentType: 'invoice' }, codes: ['MULTIPLE_INVOICES_SUSPECTED'] },
  { name: 'Facture en devise étrangère', lines: USD_INVOICE, expected: {
    invoiceNumber: 'USD-2026-009', invoiceDate: '2026-06-12', currency: 'USD',
    subtotal: '1000.0000', vatTotal: '0.0000', total: '1000.0000', documentType: 'invoice' } },
];

function valueOf(parsed: ParsedInvoice, field: keyof Expected): string | null {
  if (field === 'supplierBrn') return parsed.taxIds.supplierBrn;
  if (field === 'supplierVat') return parsed.taxIds.supplierVat;
  if (field === 'customerBrn') return parsed.taxIds.customerBrn;
  if (field === 'purchaseOrder') return parsed.purchaseOrder;
  return (parsed[field as keyof ParsedInvoice] as string | null | undefined) ?? null;
}

describe('mission 29 — invoice extraction metrics', () => {
  it('compares every expected field with the parser output', () => {
    const byField: Record<string, { tested: number; correct: number; errors: string[] }> = {};
    let documents = 0;
    for (const testCase of CASES) {
      documents += 1;
      const parsed = parseInvoiceText(testCase.lines.join('\n'), {
        extractionMethod: 'pdf_text',
        pageCount: testCase.options?.pageCount,
      });
      for (const [field, expected] of Object.entries(testCase.expected) as [keyof Expected, string][]) {
        const bucket = byField[field] ?? (byField[field] = { tested: 0, correct: 0, errors: [] });
        bucket.tested += 1;
        const actual = valueOf(parsed, field);
        if (actual === expected) bucket.correct += 1;
        else bucket.errors.push(`${testCase.name}: expected ${expected}, got ${actual ?? 'null'}`);
      }
      for (const code of testCase.codes ?? []) {
        expect(parsed.warningCodes, `${testCase.name} should flag ${code}`).toContain(code);
      }
    }
    const metrics = Object.fromEntries(Object.entries(byField).map(([field, value]) => [
      field, { tested: value.tested, correct: value.correct,
        rate: Math.round((value.correct / value.tested) * 1000) / 10, errors: value.errors },
    ]));
    console.log('MISSION29_INVOICE_METRICS', JSON.stringify({ documents, fields: metrics }));
    for (const [field, value] of Object.entries(metrics)) {
      expect(value.correct, `${field} extraction errors: ${value.errors.join(' | ')}`).toBe(value.tested);
    }
  });

  it('never turns a printed VAT rate into a VAT amount', () => {
    const parsed = parseInvoiceText([
      'ACME OFFICE SUPPLIES LTD',
      'Invoice No: INV-RATE-1',
      'Invoice Date: 12 Feb 2026',
      'Subtotal 1,000.00',
      'VAT 15%',
      'Total 1,000.00',
    ].join('\n'), { extractionMethod: 'pdf_text' });
    expect(parsed.vatTotal).toBeNull();
    expect(parsed.warningCodes).toContain('VAT_AMBIGUOUS');
    expect(parsed.total).toBe('1000.0000');
  });

  it('does not treat a subtotal label as the document total', () => {
    const parsed = parseInvoiceText([
      'ACME OFFICE SUPPLIES LTD',
      'Invoice No: INV-HT-1',
      'Invoice Date: 12 Feb 2026',
      'Total HT 1,000.00',
      'VAT 15%',
    ].join('\n'), { extractionMethod: 'pdf_text' });
    expect(parsed.subtotal).toBe('1000.0000');
    expect(parsed.total).toBeNull();
  });

  it('marks uncertain fields instead of inventing missing values', () => {
    const parsed = parseInvoiceText('SUPPLIER WITHOUT DETAILS\nSome text only');
    expect(parsed.invoiceNumber).toBeNull();
    expect(parsed.total).toBeNull();
    expect(parsed.uncertainFields).toContain('invoiceNumber');
    expect(parsed.warningCodes).toContain('TOTAL_MISSING');
    expect(parsed.fieldConfidence.total).toBe(0);
  });

  it('extracts a text PDF, a two-page PDF and a scanned image without upgrading the method', async () => {
    const native = await extractDocument(await makePdf([EN_INVOICE]), 'application/pdf');
    expect(native.method).toBe('pdf_text');
    expect(native.pageCount).toBe(1);
    expect(native.pages).toHaveLength(1);
    const multipage = await extractDocument(await makePdf([MULTIPAGE_INVOICE.slice(0, 7), MULTIPAGE_INVOICE.slice(7)]), 'application/pdf');
    expect(multipage.method).toBe('pdf_text');
    expect(multipage.pageCount).toBe(2);
    expect(multipage.pages).toHaveLength(2);
    const { pdf: renderPdf } = await import('pdf-to-img');
    const document = await renderPdf(await makePdf([EN_INVOICE.slice(0, 8)]), { scale: 2 });
    const page = await document.getPage(1);
    const ocr = await extractDocument(page, 'image/png');
    expect(ocr.method).toBe('ocr_image');
    expect(ocr.confidence).toBeGreaterThan(0);
    expect(ocr.text.toUpperCase()).toContain('NORTHSTAR');
    expect(ocr.warnings.some((warning) => /OCR confidence/i.test(warning))).toBe(true);
  }, 60_000);

  it('rejects a corrupt document by signature and never treats it as a PDF', () => {
    expect(detectDocumentSignature(Buffer.from('not a pdf'))).toBeNull();
  });
});

const BANK_BASE = [
  'State Bank of Mauritius', 'Statement of Account', 'Account Number: 012345678901',
  'Statement Period: 01 Feb 2026 to 28 Feb 2026', 'Currency: MUR', 'Opening Balance 10,000.00', '',
  'Transaction Date Value Date Transaction Details Debit Credit Balance',
  '02 Feb 2026 02 Feb 2026 Supplier payment 1,000.00 9,000.00',
  '10 Feb 2026 10 Feb 2026 Customer receipt 500.00 9,500.00',
  '28 Feb 2026 28 Feb 2026 Bank charges 200.00 9,300.00', 'Closing Balance 9,300.00',
];

describe('mission 29 — bank statement controls', () => {
  it('detects the four requested bank names without claiming a certified layout', () => {
    for (const [name, bankName, key] of [
      ['State Bank of Mauritius', 'State Bank of Mauritius', 'sbm'],
      ['Absa Bank (Mauritius)', 'Absa Bank (Mauritius)', 'absa'],
      ['MauBank', 'MauBank', 'maubank'],
    ] as const) {
      const result = parseMcbStatement(BANK_BASE.map((line) => line.replace('State Bank of Mauritius', name)).join('\n'));
      expect(result.bankName).toBe(bankName);
      expect(result.detectedBankKey).toBe(key);
      expect(result.profileKey).toBe('generic');
      expect(result.warnings.some((warning) => warning.code === 'BANK_PDF_GENERIC_PROFILE')).toBe(true);
    }
    const mcb = parseMcbStatement([
      'MCB', 'Mauritius Commercial Bank', 'Statement of Account', 'Savings Regular Account',
      'Statement Period: 01 Jan 2026 to 31 Jan 2026', 'Opening Balance 15,000.00', '',
      'Transaction Date Value Date Transaction Details Debit Credit Balance',
      '02 Jan 2026 02 Jan 2026 JUICE 1,200.00 13,800.00', 'Closing Balance 13,800.00',
    ].join('\n'));
    expect(mcb.detectedBankKey).toBe('mcb');
    expect(mcb.profileKey).toBe('mcb');
  });

  it('preserves debit/credit direction, masks the account number and ignores balance lines', () => {
    const result = parseMcbStatement(BANK_BASE.join('\n'));
    expect(result.rows).toHaveLength(3);
    expect(result.rows[0]!.debit).toBe('1000.0000');
    expect(result.rows[1]!.credit).toBe('500.0000');
    expect(result.rows[2]!.debit).toBe('200.0000');
    expect(result.accountNumber).toBe('****8901');
    expect(result.rows.every((row) => row.directionVerified)).toBe(true);
    expect(result.rows.some((row) => /opening|closing|balance/i.test(row.details))).toBe(false);
  });

  it('flags duplicate lines and keeps long labels and references', () => {
    const longLabel = 'Payment to a fictional supplier with a very long narrative reference that must not be truncated before human review';
    const text = [
      'MCB', 'Mauritius Commercial Bank', 'Savings Regular Account', 'Opening Balance 10,000.00',
      'Transaction Date Value Date Transaction Details Debit Credit Balance',
      `02 Jan 2026 02 Jan 2026 ${longLabel} REF: REF-2026-0001 1,000.00 9,000.00`,
      `02 Jan 2026 02 Jan 2026 ${longLabel} REF: REF-2026-0001 1,000.00 9,000.00`,
      'Closing Balance 9,000.00',
    ].join('\n');
    const result = parseMcbStatement(text);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]!.details.length).toBeGreaterThan(100);
    expect(result.rows[0]!.reference).toBe('REF-2026-0001');
    expect(result.warnings.some((warning) => warning.code === 'BANK_PDF_DUPLICATE_ROW')).toBe(true);
    expect(result.rows[1]!.duplicateOfLine).toBe(result.rows[0]!.sourceLine);
  });

  it('keeps a multi-page statement readable and reports an unverified direction without an opening balance', () => {
    const text = [
      'MCB', 'Mauritius Commercial Bank', 'Page 1 of 2', 'Opening Balance 10,000.00',
      'Transaction Date Value Date Transaction Details Debit Credit Balance',
      '02 Jan 2026 02 Jan 2026 Supplier 1,000.00 9,000.00',
      'Page 2 of 2', 'Transaction Date Value Date Transaction Details Debit Credit Balance',
      '03 Jan 2026 03 Jan 2026 Client 500.00 9,500.00', 'Closing Balance 9,500.00',
    ].join('\n');
    const result = parseMcbStatement(text);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[1]!.credit).toBe('500.0000');
    expect(result.warnings.some((warning) => warning.code === 'BANK_PDF_DUPLICATE_ROW')).toBe(false);
    const noOpening = parseMcbStatement(BANK_BASE.filter((line) => !/Opening Balance/.test(line)).join('\n'));
    expect(noOpening.warnings.some((warning) => warning.code === 'BANK_PDF_OPENING_MISSING')).toBe(true);
  });
});

describe('mission 29 — document API traceability', () => {
  let ctx: TestContext;
  let cookie: string;
  let company: string;
  let accounts: any[];
  let journals: any[];

  beforeAll(async () => {
    const setup = await setupCompanyWithChart();
    ctx = setup.ctx; cookie = setup.user.cookie; company = setup.company.id;
    accounts = setup.accounts; journals = setup.journals;
    const roles: Record<string, string> = {
      '5000': 'purchases', '6100': 'rent', '1200': 'vat_input', '2200': 'vat_output',
      '2000': 'payable', '1100': 'receivable', '4000': 'revenue',
    };
    for (const [code, role] of Object.entries(roles)) {
      const res = await api(ctx, cookie, 'PATCH', `/api/companies/${company}/accounts/${accountByCode(accounts, code).id}`,
        { accountRole: role, postingAllowed: true });
      expect(res.statusCode).toBe(200);
    }
  });

  afterAll(async () => {
    await terminateOcr();
  });

  it('persists field confidence, tax identifiers and a re-extraction audit trail', async () => {
    const pdf = await makePdf([EN_INVOICE]);
    const uploaded = await api(ctx, cookie, 'POST', `/api/companies/${company}/documents`, {
      fileName: 'fictional-northstar.pdf', contentBase64: pdf.toString('base64'),
      declaredMime: 'application/pdf', kind: 'purchase',
    });
    expect(uploaded.statusCode).toBe(201);
    const document = uploaded.json().document;
    expect(document.document_type).toBe('invoice');
    expect(document.tax_ids.supplierBrn).toBe('C12345678901');
    expect(document.purchase_order).toBe('PO-7788');
    expect(Number(document.confidence)).toBeGreaterThan(0.8);
    expect(document.extraction_quality.method).toBe('pdf_text');

    const listed = await api(ctx, cookie, 'GET', `/api/companies/${company}/documents`);
    expect(listed.statusCode).toBe(200);
    expect(listed.json().documents[0].document_type).toBe('invoice');
    expect(listed.json().documents[0].field_confidence.invoiceNumber).toBeGreaterThan(0.8);

    const preview = await api(ctx, cookie, 'POST',
      `/api/companies/${company}/documents/${document.id}/reextract`, { apply: false });
    expect(preview.statusCode).toBe(200);
    expect(preview.json().applied).toBe(false);
    const applied = await api(ctx, cookie, 'POST',
      `/api/companies/${company}/documents/${document.id}/reextract`, { apply: true });
    expect(applied.statusCode).toBe(200);
    expect(applied.json().applied).toBe(true);
    const audit = await ctx.db.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM audit_log
        WHERE company_id=$1 AND action='document.reextract' AND entity_id=$2`,
      [company, document.id]);
    expect(Number(audit.rows[0]!.count)).toBe(2);
  });


  it('never guesses a currency when preparing a proposal', async () => {
    const pdf = await makePdf([[
      'ACME OFFICE SUPPLIES LTD', 'Tax Invoice', 'Invoice No: INV-NOCUR-1',
      'Invoice Date: 12 Feb 2026', 'Subtotal 1,000.00', 'VAT 150.00', 'Total 1,150.00',
    ]]);
    const uploaded = await api(ctx, cookie, 'POST', `/api/companies/${company}/documents`, {
      fileName: 'fictional-no-currency.pdf', contentBase64: pdf.toString('base64'),
      declaredMime: 'application/pdf', kind: 'purchase',
    });
    expect(uploaded.statusCode).toBe(201);
    expect(uploaded.json().document.currency).toBeNull();
    const proposed = await api(ctx, cookie, 'POST', `/api/companies/${company}/documents/${uploaded.json().document.id}/proposal`);
    expect(proposed.statusCode).toBe(400);
    expect(proposed.json().error.code).toBe('DOCUMENT_CURRENCY_MISSING');
  });

  it('proposes a balanced reversal for a supplier credit note', async () => {
    const pdf = await makePdf([CREDIT_NOTE]);
    const uploaded = await api(ctx, cookie, 'POST', `/api/companies/${company}/documents`, {
      fileName: 'fictional-credit-note.pdf', contentBase64: pdf.toString('base64'),
      declaredMime: 'application/pdf', kind: 'purchase',
    });
    expect(uploaded.statusCode).toBe(201);
    const id = uploaded.json().document.id;
    expect(uploaded.json().document.document_type).toBe('credit_note');
    const proposed = await api(ctx, cookie, 'POST', `/api/companies/${company}/documents/${id}/proposal`);
    expect(proposed.statusCode).toBe(201);
    const proposal = proposed.json().proposal;
    expect(proposal.balanced).toBe(true);
    const lines = proposal.lines as any[];
    expect(lines.reduce((sum, line) => sum + Math.round(Number(line.debit) * 10000), 0))
      .toBe(lines.reduce((sum, line) => sum + Math.round(Number(line.credit) * 10000), 0));
    expect(lines.some((line) => line.role === 'payable' && Number(line.debit) > 0)).toBe(true);
    expect(lines.some((line) => Number(line.credit) > 0 && line.role !== 'payable')).toBe(true);
  });

  it('keeps a printed discount as a separate proposal line and stays balanced', async () => {
    const pdf = await makePdf([FR_INVOICE]);
    const uploaded = await api(ctx, cookie, 'POST', `/api/companies/${company}/documents`, {
      fileName: 'fictional-discount.pdf', contentBase64: pdf.toString('base64'),
      declaredMime: 'application/pdf', kind: 'purchase',
    });
    expect(uploaded.statusCode).toBe(201);
    const id = uploaded.json().document.id;
    expect(uploaded.json().document.discount_total).toBe('1000.0000');
    const proposed = await api(ctx, cookie, 'POST', `/api/companies/${company}/documents/${id}/proposal`);
    expect(proposed.statusCode).toBe(201);
    const lines = proposed.json().proposal.lines as any[];
    expect(proposed.json().proposal.balanced).toBe(true);
    expect(lines.some((line) => /discount/i.test(line.description))).toBe(true);
    expect(lines.reduce((sum, line) => sum + Math.round(Number(line.debit) * 10000), 0))
      .toBe(lines.reduce((sum, line) => sum + Math.round(Number(line.credit) * 10000), 0));
  });
});
