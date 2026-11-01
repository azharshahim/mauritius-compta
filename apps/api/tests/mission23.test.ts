import PDFDocument from 'pdfkit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  accountByCode, api, createCompany, journalByCode, registerUser, setupCompanyWithChart,
  type TestContext,
} from './helpers.js';
import { parseInvoiceText } from '../src/modules/documents/parse-invoice.js';
import { parseMcbStatement } from '../src/modules/bank/mcb.js';
import { extractDocument, terminateOcr } from '../src/modules/documents/extract.js';

/**
 * Mission 23 — native documents/OCR, bilingual chart and MCB PDF importer.
 * Every invoice, statement and party in this file is fabricated.
 */
async function makePdf(lines: string[]): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  const chunks: Buffer[] = [];
  doc.on('data', (chunk) => chunks.push(chunk as Buffer));
  lines.forEach((line, index) => {
    doc.fontSize(index === 0 ? 16 : 11).text(line, 50, 50 + index * 22);
  });
  doc.end();
  await new Promise<void>((resolve) => doc.on('end', () => resolve()));
  return Buffer.concat(chunks);
}

const INVOICE_LINES = [
  'ACME OFFICE SUPPLIES LTD', 'Royal Road, Port Louis', 'TAX INVOICE',
  'Invoice No: INV-2026-101', 'Invoice Date: 12 Feb 2026', 'Due Date: 11 Mar 2026',
  'Bill To: LAGON TRADING LTD', 'Description Qty Unit Price Net VAT Total',
  'A4 paper box 10 1,000.00 10,000.00 1,500.00 11,500.00',
  'Printer toner 2 2,500.00 5,000.00 750.00 5,750.00',
  'Subtotal: MUR 15,000.00', 'VAT (15%): MUR 2,250.00', 'Total Due: MUR 17,250.00',
  'Currency: MUR',
];
const MCB_TEXT = [
  'MCB', 'Mauritius Commercial Bank', 'Statement of Account', 'Savings Regular Account',
  'Statement Period: 01 Jan 2026 to 31 Jan 2026', 'Opening Balance 15,000.00', '',
  'Transaction Date Value Date Transaction Details Debit Credit Balance',
  '02 Jan 2026 02 Jan 2026 JUICE 1,200.00 13,800.00',
  '05 Jan 2026 05 Jan 2026 Debit Card Purchase',
  "WINNER'S SUPERMARKET 2,450.50 11,349.50",
  '10 Jan 2026 10 Jan 2026 Cash Deposit 5,000.00 16,349.50',
  '15 Jan 2026 15 Jan 2026 Credit Interest 45.25 16,394.75',
  '20 Jan 2026 20 Jan 2026 Charges 125.00 16,269.75',
  '25 Jan 2026 25 Jan 2026 Refill Amount 300.00 15,969.75',
  '25 Jan 2026 25 Jan 2026 VAT on Refill 45.00 15,924.75',
  'Closing Balance 15,924.75',
];

describe('invoice text extraction and deterministic parsing', () => {
  it('reads exact HT/VAT/TTC, dates, number, lines and quantity', () => {
    const parsed = parseInvoiceText(INVOICE_LINES.join('\n'));
    expect(parsed.supplierName).toBe('ACME OFFICE SUPPLIES LTD');
    expect(parsed.customerName).toBe('LAGON TRADING LTD');
    expect(parsed.invoiceNumber).toBe('INV-2026-101');
    expect(parsed.invoiceDate).toBe('2026-02-12');
    expect(parsed.dueDate).toBe('2026-03-11');
    expect(parsed.currency).toBe('MUR');
    expect(parsed.subtotal).toBe('15000.0000');
    expect(parsed.vatTotal).toBe('2250.0000');
    expect(parsed.total).toBe('17250.0000');
    expect(parsed.lines).toHaveLength(2);
    expect(parsed.lines[0]!.quantity).toBe('10.0000');
    expect(parsed.lines[0]!.unitPrice).toBe('1000.0000');
    expect(parsed.lines[0]!.netAmount).toBe('10000.0000');
  });

  it('flags an inconsistent total instead of correcting it silently', () => {
    const parsed = parseInvoiceText(INVOICE_LINES.join('\n').replace('17,250.00', '17,999.00'));
    expect(parsed.total).toBe('17999.0000');
    expect(parsed.warnings.some((w) => /does not equal/.test(w))).toBe(true);
  });

  it('extracts a native PDF and runs real OCR on a rendered image', async () => {
    const pdf = await makePdf(INVOICE_LINES.slice(0, 8));
    const native = await extractDocument(pdf, 'application/pdf');
    expect(native.method).toBe('pdf_text');
    expect(native.text).toContain('INV-2026-101');
    // Render the same page to PNG, then use the actual Tesseract worker.
    const { pdf: renderPdf } = await import('pdf-to-img');
    const document = await renderPdf(pdf, { scale: 2 });
    const page = await document.getPage(1);
    const ocr = await extractDocument(page, 'image/png');
    expect(ocr.method).toBe('ocr_image');
    expect(ocr.text.toUpperCase()).toContain('ACME');

    // A PDF containing only the rendered page is a scanned PDF: OCR must be used.
    const scanned = new PDFDocument({ size: 'A4', margin: 0 });
    const chunks: Buffer[] = [];
    scanned.on('data', (chunk) => chunks.push(chunk as Buffer));
    scanned.image(page, 0, 0, { width: 595, height: 842 });
    scanned.end();
    await new Promise<void>((resolve) => scanned.on('end', () => resolve()));
    const scannedPdf = Buffer.concat(chunks);
    const scannedResult = await extractDocument(scannedPdf, 'application/pdf');
    expect(scannedResult.method).toBe('ocr_pdf');
    expect(scannedResult.text.toUpperCase()).toContain('ACME');
  }, 60_000);
});

describe('MCB statement parser', () => {
  it('keeps multi-line descriptions and exact signed movements', () => {
    const result = parseMcbStatement(MCB_TEXT.join('\n'));
    expect(result.rows).toHaveLength(7);
    expect(result.openingBalance).toBe('15000.0000');
    expect(result.closingBalance).toBe('15924.7500');
    expect(result.rows[1]!.details).toContain("WINNER'S SUPERMARKET");
    expect(result.rows[1]!.debit).toBe('2450.5000');
    expect(result.rows[2]!.credit).toBe('5000.0000');
    expect(result.warnings).toHaveLength(0);
  });

  it('detects a broken balance continuity without changing amounts', () => {
    const result = parseMcbStatement(MCB_TEXT.join('\n').replace('15,924.75', '15,999.75'));
    expect(result.rows).toHaveLength(7);
    expect(result.warnings.some((w) => w.code === 'MCB_CLOSING_MISMATCH')).toBe(true);
  });
});

describe('documents, chart and MCB API', () => {
  let ctx: TestContext;
  let cookie: string;
  let company: string;
  let otherCompany: string;
  let otherCookie: string;
  let accounts: any[];
  let journals: any[];
  let bankAccountId: string;
  let documentId: string;
  let invoicePdf: Buffer;

  const base = (id = company) => `/api/companies/${id}`;

  beforeAll(async () => {
    const setup = await setupCompanyWithChart();
    ctx = setup.ctx; cookie = setup.user.cookie; company = setup.company.id;
    accounts = setup.accounts; journals = setup.journals;
    const other = await registerUser(ctx, { email: 'mission23-other@example.test' });
    otherCookie = other.cookie;
    const b = await createCompany(ctx, otherCookie, { name: 'Other Mission 23 Company Ltd (fictitious)' });
    otherCompany = b.id;
    // Give existing accounts explicit roles so proposals choose the active chart.
    const roles: Record<string, string> = {
      '5000': 'purchases', '6100': 'rent', '1200': 'vat_input', '2200': 'vat_output',
      '2000': 'payable', '1100': 'receivable', '4000': 'revenue',
    };
    for (const [code, accountRole] of Object.entries(roles)) {
      const res = await api(ctx, cookie, 'PATCH', `${base()}/accounts/${accountByCode(accounts, code).id}`,
        { accountRole, postingAllowed: true });
      expect(res.statusCode).toBe(200);
    }
    const bank = await api(ctx, cookie, 'POST', `${base()}/bank/accounts`, {
      name: 'Compte MCB fictif', bankName: 'MCB (fictif)', currency: 'MUR',
      accountId: accountByCode(accounts, '1010').id, maskedReference: 'MU00FICTIF00001234',
    });
    expect(bank.statusCode).toBe(201);
    bankAccountId = bank.json().account.id;
    invoicePdf = await makePdf(INVOICE_LINES);
  });

  afterAll(async () => {
    await terminateOcr();
  });

  it('defaults to a provisional chart and never overwrites an existing code', async () => {
    const profile = await api(ctx, cookie, 'GET', `${base()}/chart-of-accounts/profile`);
    expect(profile.statusCode).toBe(200);
    expect(profile.json().profile.status).toBe('PENDING PROFESSIONAL VALIDATION');
    const before = (await api(ctx, cookie, 'GET', `${base()}/accounts`)).json().accounts
      .find((a: any) => a.code === '1010');
    const applied = await api(ctx, cookie, 'POST', `${base()}/chart-of-accounts/template/apply`,
      { template: 'provisional_mauritius' });
    expect(applied.statusCode).toBe(200);
    expect(applied.json().status).toBe('PENDING PROFESSIONAL VALIDATION');
    const after = (await api(ctx, cookie, 'GET', `${base()}/accounts`)).json().accounts
      .find((a: any) => a.code === '1010');
    expect(after.id).toBe(before.id);
    expect(after.code).toBe('1010');
    expect(after.name).toBe(before.name);
  });

  it('stores distinct English and French labels without touching the code', async () => {
    const created = await api(ctx, cookie, 'POST', `${base()}/accounts`, {
      code: 'M23-001', name: 'Frais de test', nameEn: 'Test expense', nameFr: 'Frais de test',
      type: 'expense', postingAllowed: true, accountRole: 'other_expense',
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().account.code).toBe('M23-001');
    expect(created.json().account.name_en).toBe('Test expense');
    expect(created.json().account.name_fr).toBe('Frais de test');
    const patched = await api(ctx, cookie, 'PATCH', `${base()}/accounts/${created.json().account.id}`,
      { nameEn: 'Updated test expense' });
    expect(patched.json().account.code).toBe('M23-001');
    expect(patched.json().account.name_fr).toBe('Frais de test');
  });

  it('previews and confirms a firm chart import with duplicate detection', async () => {
    const csv = 'Code,Label EN,Label FR,Type\n8000,Administration costs,Frais administratifs,expense\n4000,Sales of goods,Ventes de marchandises,revenue\n';
    const preview = await api(ctx, cookie, 'POST', `${base()}/chart-of-accounts/import/preview`, {
      fileName: 'firm-chart.csv', contentBase64: Buffer.from(csv).toString('base64'),
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.json().rows).toHaveLength(2);
    expect(preview.json().findings.some((f: any) => f.codeName === 'CHART_DUPLICATE_EXISTING')).toBe(true);
    const rows = preview.json().rows.filter((r: any) => !r.exists);
    const confirmed = await api(ctx, cookie, 'POST', `${base()}/chart-of-accounts/import/confirm`, {
      fileName: 'firm-chart.csv', contentBase64: Buffer.from(csv).toString('base64'),
      confirm: true, rows,
    });
    expect(confirmed.statusCode).toBe(200);
    expect(confirmed.json().created).toBe(1);
    expect(confirmed.json().status).toBe('AWAITING FIRM CONFIRMATION');
    const profile = await api(ctx, cookie, 'GET', `${base()}/chart-of-accounts/profile`);
    expect(profile.json().profile.status).toBe('AWAITING FIRM CONFIRMATION');
  });

  it('uploads a purchase invoice, proposes a balanced draft and learns only after approval', async () => {
    const uploaded = await api(ctx, cookie, 'POST', `${base()}/documents`, {
      fileName: 'fictitious-acme.pdf', contentBase64: invoicePdf.toString('base64'),
      declaredMime: 'application/pdf', kind: 'purchase',
    });
    expect(uploaded.statusCode).toBe(201);
    const document = uploaded.json().document;
    documentId = document.id;
    expect(document.extraction_method).toBe('pdf_text');
    expect(document.status).toBe('EXTRACTED');
    expect(document.total_amount).toBe('17250.0000');
    expect(document.subtotal).toBe('15000.0000');
    expect(document.vat_total).toBe('2250.0000');

    const proposed = await api(ctx, cookie, 'POST', `${base()}/documents/${documentId}/proposal`);
    expect(proposed.statusCode).toBe(201);
    const proposal = proposed.json().proposal;
    expect(proposal.balanced).toBe(true);
    const lines = proposal.lines as any[];
    expect(lines.every((l) => l.accountId)).toBe(true);
    expect(lines.reduce((sum, l) => sum + Math.round(Number(l.debit) * 10000), 0))
      .toBe(lines.reduce((sum, l) => sum + Math.round(Number(l.credit) * 10000), 0));

    const approved = await api(ctx, cookie, 'POST', `${base()}/documents/proposals/${proposal.id}/approve`, {
      confirm: true, journalId: journals.find((j) => j.type === 'purchases').id,
      lines: lines.map((l) => ({ accountId: l.accountId, description: l.description,
        debit: l.debit === '0.0000' ? null : l.debit, credit: l.credit === '0.0000' ? null : l.credit })),
    });
    expect(approved.statusCode).toBe(200);
    expect(approved.json().status).toBe('APPROVED');
    expect(approved.json().draftEntry.status).toBe('draft');
    const detail = await api(ctx, cookie, 'GET', `${base()}/documents/${documentId}`);
    expect(detail.json().document.status).toBe('APPROVED');
  });

  it('marks an identical upload as duplicate and refuses a proposal', async () => {
    const duplicate = await api(ctx, cookie, 'POST', `${base()}/documents`, {
      fileName: 'fictitious-acme-copy.pdf', contentBase64: invoicePdf.toString('base64'),
      declaredMime: 'application/pdf', kind: 'purchase',
    });
    expect(duplicate.statusCode).toBe(201);
    expect(duplicate.json().document.status).toBe('DUPLICATE');
    expect(duplicate.json().document.duplicate_of).toBe(documentId);
    const refused = await api(ctx, cookie, 'POST', `${base()}/documents/${duplicate.json().document.id}/proposal`);
    expect(refused.statusCode).toBe(409);
  });

  it('isolates documents between companies', async () => {
    const other = await api(ctx, otherCookie, 'GET', `${base(otherCompany)}/documents`);
    expect(other.statusCode).toBe(200);
    expect(other.json().documents).toHaveLength(0);
    const forbidden = await api(ctx, otherCookie, 'GET', `${base(otherCompany)}/documents/${documentId}`);
    expect(forbidden.statusCode).toBe(404);
  });

  it('previews and imports an MCB PDF, then ignores a re-import', async () => {
    const pdf = await makePdf(MCB_TEXT);
    const body = { bankAccountId, fileName: 'mcb-fictif.pdf', contentBase64: pdf.toString('base64') };
    const preview = await api(ctx, cookie, 'POST', `${base()}/bank/mcb/preview`, body);
    expect(preview.statusCode).toBe(200);
    expect(preview.json().preview.preview.transactions).toHaveLength(7);
    expect(preview.json().preview.preview.balances.consistent).toBe(true);
    expect(preview.json().mcb.openingBalance).toBe('15000.0000');
    expect(preview.json().mcb.closingBalance).toBe('15924.7500');
    expect(preview.json().mcb.warnings.some((w: any) => w.code === 'MCB_DEMO_FIXTURE')).toBe(false);
    const imported = await api(ctx, cookie, 'POST', `${base()}/bank/mcb/import`, { ...body, confirm: true });
    expect(imported.statusCode).toBe(201);
    expect(imported.json().imported).toBe(7);
    const again = await api(ctx, cookie, 'POST', `${base()}/bank/mcb/import`, { ...body, confirm: true });
    expect(again.statusCode).toBe(200);
    expect(again.json().imported).toBe(0);
    expect(again.json().reimport).toBe(true);
  }, 30_000);
});
