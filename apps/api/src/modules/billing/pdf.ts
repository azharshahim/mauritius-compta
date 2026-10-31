import PDFDocument from 'pdfkit';
import { formatAmount, formatMoney, parseAmount } from '../../lib/money.js';

/**
 * Real A4 PDF generation for quotes, invoices, credit notes and receipts.
 *
 * Scope and honesty of the output:
 *  - the company block only prints information the cabinet entered (BRN, VAT
 *    number, address, bank details); nothing is invented;
 *  - a VAT line shows the stored treatment and rate; "0%" is never displayed in
 *    place of an unknown or exempt situation;
 *  - the document carries a permanent notice stating that MRA e-invoicing is
 *    not implemented and that the PDF is not an MRA-compliant e-invoice;
 *  - metadata is limited to a title and the product name: no author, no client
 *    contact details, no technical identifiers.
 */

type Locale = 'fr' | 'en';

interface PdfCompany {
  name: string;
  brn: string | null;
  vat_number: string | null;
  registered_address: string | null;
  functional_currency: string;
}

interface PdfSettings {
  vat_number: string | null;
  legal_footer_fr: string | null;
  legal_footer_en: string | null;
  bank_details: string | null;
}

interface PdfCustomer {
  name: string;
  brn: string | null;
  vat_number: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  postcode: string | null;
  country: string | null;
  contact_email: string | null;
}

interface PdfDocumentRow {
  kind: string;
  doc_no: string | null;
  status: string;
  issue_date: string;
  due_date: string | null;
  valid_until: string | null;
  currency: string;
  subtotal: string;
  discount_total: string;
  tax_total: string;
  total_amount: string;
  amount_paid: string;
  credited_amount: string;
  notes: string | null;
  terms: string | null;
  source_document_id: string | null;
}

interface PdfLine {
  line_no: number;
  description: string;
  quantity: string;
  unit_price: string;
  unit: string;
  discount_pct: string;
  vat_treatment: string;
  vat_rate: string | null;
  line_total: string;
}

interface PdfPayment {
  payment_no: string | null;
  payment_date: string;
  value_date: string | null;
  amount: string;
  currency: string;
  method: string;
  reference: string | null;
  unallocated_amount: string;
}

const COLORS = {
  text: '#1f2933',
  muted: '#52606d',
  border: '#d9e2ec',
  header: '#102a43',
  accent: '#0b5fff',
  noticeBg: '#fff3cd',
  noticeBorder: '#d9a300',
  noticeText: '#7a5b00',
};

function sanitize(input: string): string {
  return input
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\u2013/g, '-')
    .replace(/\u2014/g, '-')
    .replace(/\u2026/g, '...')
    .replace(/\u00a0/g, ' ')
    .replace(/[^\x00-\xFF]/g, '?');
}

function render(
  build: (doc: PDFKit.PDFDocument) => void,
  title: string,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      layout: 'portrait',
      margin: 40,
      bufferPages: true,
      info: {
        Title: sanitize(title),
        Producer: 'Mauritius Compta',
        Creator: 'Mauritius Compta',
      },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    try {
      build(doc);
      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

const LABELS = {
  fr: {
    quote: 'DEVIS',
    invoice: 'FACTURE',
    credit_note: 'AVOIR',
    receipt: 'REÇU DE PAIEMENT',
    number: 'Numéro',
    date: 'Date',
    dueDate: 'Échéance',
    validUntil: 'Valable jusqu’au',
    customer: 'Client',
    description: 'Désignation',
    qty: 'Qté',
    unitPrice: 'P.U.',
    vat: 'TVA',
    total: 'Total',
    subtotal: 'Sous-total',
    discount: 'Remises',
    vatTotal: 'TVA',
    grandTotal: 'Total',
    paid: 'Encaissé',
    credited: 'Avoirs émis',
    outstanding: 'Solde dû',
    terms: 'Conditions de règlement',
    notes: 'Notes',
    bank: 'Coordonnées bancaires',
    original: 'Facture d’origine',
    notInvoice: 'Devis — ne constitue pas une facture',
    paymentMethod: 'Mode de règlement',
    reference: 'Référence',
    unallocated: 'Trop-perçu / non affecté',
    allocations: 'Factures réglées',
    status: 'Statut',
    notice:
      'Document généré par Mauritius Compta. Démonstration : la facturation électronique MRA n’est pas disponible et ce PDF n’est pas une facture électronique conforme.',
    page: 'Page',
    of: 'sur',
    vatStandard: 'Standard',
    vatZero: 'Taux zéro',
    vatExempt: 'Exonéré',
    vatOut: 'Hors champ',
    noTaxInfo: 'Information fiscale non configurée',
  },
  en: {
    quote: 'QUOTE',
    invoice: 'INVOICE',
    credit_note: 'CREDIT NOTE',
    receipt: 'PAYMENT RECEIPT',
    number: 'Number',
    date: 'Date',
    dueDate: 'Due date',
    validUntil: 'Valid until',
    customer: 'Customer',
    description: 'Description',
    qty: 'Qty',
    unitPrice: 'Unit price',
    vat: 'VAT',
    total: 'Total',
    subtotal: 'Subtotal',
    discount: 'Discounts',
    vatTotal: 'VAT',
    grandTotal: 'Total',
    paid: 'Paid',
    credited: 'Credit notes',
    outstanding: 'Outstanding',
    terms: 'Payment terms',
    notes: 'Notes',
    bank: 'Bank details',
    original: 'Original invoice',
    notInvoice: 'Quote — not an invoice',
    paymentMethod: 'Payment method',
    reference: 'Reference',
    unallocated: 'Over-payment / unallocated',
    allocations: 'Invoices settled',
    status: 'Status',
    notice:
      'Document generated by Mauritius Compta. Demonstration build: MRA e-invoicing is not available and this PDF is not a compliant electronic invoice.',
    page: 'Page',
    of: 'of',
    vatStandard: 'Standard',
    vatZero: 'Zero-rated',
    vatExempt: 'Exempt',
    vatOut: 'Out of scope',
    noTaxInfo: 'Tax information not configured',
  },
} as const;

function money(amount: string, currency: string, locale: Locale): string {
  return formatMoney(parseAmount(amount), locale, currency);
}

function vatLabel(line: PdfLine, locale: Locale): string {
  const l = LABELS[locale];
  if (line.vat_treatment === 'zero_rated') return l.vatZero;
  if (line.vat_treatment === 'exempt') return l.vatExempt;
  if (line.vat_treatment === 'out_of_scope') return l.vatOut;
  return line.vat_rate === null ? l.noTaxInfo : `${formatAmount(parseAmount(line.vat_rate))}%`;
}

function drawNotice(doc: PDFKit.PDFDocument, text: string): void {
  const left = doc.page.margins.left;
  const width = doc.page.width - left - doc.page.margins.right;
  const y = doc.y;
  const height = doc.heightOfString(sanitize(text), { width: width - 12, align: 'center' }) + 12;
  doc.roundedRect(left, y, width, height, 3).fillAndStroke(COLORS.noticeBg, COLORS.noticeBorder);
  doc
    .fillColor(COLORS.noticeText)
    .font('Helvetica-Bold')
    .fontSize(7)
    .text(sanitize(text), left + 6, y + 6, { width: width - 12, align: 'center' });
  doc.y = y + height + 8;
  doc.fillColor(COLORS.text).font('Helvetica');
}

function pageFooter(doc: PDFKit.PDFDocument, locale: Locale): void {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i += 1) {
    doc.switchToPage(i);
    const bottom = doc.page.height - doc.page.margins.bottom + 14;
    doc
      .font('Helvetica')
      .fontSize(7)
      .fillColor(COLORS.muted)
      .text(
        `${LABELS[locale].page} ${i + 1} ${LABELS[locale].of} ${range.count} — Mauritius Compta`,
        doc.page.margins.left,
        bottom,
        { width: doc.page.width - doc.page.margins.left - doc.page.margins.right, align: 'center' },
      );
  }
}

function header(
  doc: PDFKit.PDFDocument,
  options: {
    company: PdfCompany;
    settings: PdfSettings;
    title: string;
    number: string;
    locale: Locale;
    meta: string[];
  },
): void {
  const left = doc.page.margins.left;
  const width = doc.page.width - left - doc.page.margins.right;
  doc.rect(left, 40, width, 3).fill(COLORS.accent);
  doc.moveDown(0.5);
  doc.fillColor(COLORS.header).font('Helvetica-Bold').fontSize(17).text(sanitize(options.title));
  doc
    .fillColor(COLORS.text)
    .font('Helvetica-Bold')
    .fontSize(12)
    .text(sanitize(options.number), { continued: false });
  doc.moveDown(0.4);
  doc.font('Helvetica-Bold').fontSize(10).fillColor(COLORS.header).text(sanitize(options.company.name));
  doc.font('Helvetica').fontSize(8).fillColor(COLORS.muted);
  const companyMeta: string[] = [];
  if (options.company.registered_address) companyMeta.push(sanitize(options.company.registered_address));
  if (options.company.brn) companyMeta.push(`BRN: ${sanitize(options.company.brn)}`);
  const vat = options.settings.vat_number ?? options.company.vat_number;
  if (vat) companyMeta.push(`VAT: ${sanitize(vat)}`);
  if (companyMeta.length > 0) doc.text(companyMeta.join('   |   '), { width });
  doc.moveDown(0.6);
  doc.fillColor(COLORS.text).font('Helvetica').fontSize(9).text(options.meta.join('   |   '), { width });
  doc.moveDown(0.6);
  drawNotice(doc, options.locale === 'fr' ? LABELS.fr.notice : LABELS.en.notice);
}

function partyBlock(doc: PDFKit.PDFDocument, customer: PdfCustomer | null, locale: Locale): void {
  if (!customer) return;
  const left = doc.page.margins.left;
  const width = doc.page.width - left - doc.page.margins.right;
  doc.font('Helvetica-Bold').fontSize(8).fillColor(COLORS.muted).text(LABELS[locale].customer.toUpperCase());
  doc.font('Helvetica-Bold').fontSize(10).fillColor(COLORS.text).text(sanitize(customer.name));
  doc.font('Helvetica').fontSize(8).fillColor(COLORS.muted);
  const lines = [
    customer.address_line1,
    customer.address_line2,
    [customer.postcode, customer.city].filter(Boolean).join(' '),
    customer.country,
    customer.brn ? `BRN: ${customer.brn}` : null,
    customer.vat_number ? `VAT: ${customer.vat_number}` : null,
  ].filter((l): l is string => Boolean(l && l.trim()));
  if (lines.length > 0) doc.text(lines.map(sanitize).join(' — '), { width });
  doc.moveDown(0.5);
}

function lineTable(doc: PDFKit.PDFDocument, lines: PdfLine[], currency: string, locale: Locale): void {
  const l = LABELS[locale];
  const left = doc.page.margins.left;
  const cols = {
    description: { x: left, width: 235 },
    qty: { x: left + 240, width: 40 },
    unitPrice: { x: left + 285, width: 65 },
    vat: { x: left + 355, width: 55 },
    total: { x: left + 415, width: 95 },
  };

  const drawHead = () => {
    const y = doc.y;
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor(COLORS.muted);
    doc.text(l.description.toUpperCase(), cols.description.x, y, { width: cols.description.width });
    doc.text(l.qty, cols.qty.x, y, { width: cols.qty.width, align: 'right' });
    doc.text(`${l.unitPrice} (${currency})`, cols.unitPrice.x, y, { width: cols.unitPrice.width, align: 'right' });
    doc.text(l.vat, cols.vat.x, y, { width: cols.vat.width, align: 'center' });
    doc.text(`${l.total} (${currency})`, cols.total.x, y, { width: cols.total.width, align: 'right' });
    doc.moveDown(0.25);
    doc.moveTo(left, doc.y).lineTo(left + 510, doc.y).strokeColor(COLORS.border).stroke();
    doc.moveDown(0.25);
  };

  drawHead();

  for (const line of lines) {
    const description = sanitize(
      line.quantity === '1.0000' && line.unit ? `${line.description} (${line.unit})` : line.description,
    );
    const height = Math.max(
      doc.heightOfString(description, { width: cols.description.width, align: 'left' }),
      10,
    );
    if (doc.y + height > doc.page.height - doc.page.margins.bottom - 90) {
      doc.addPage();
      drawHead();
    }
    const y = doc.y;
    doc.font('Helvetica').fontSize(8.5).fillColor(COLORS.text);
    doc.text(description, cols.description.x, y, { width: cols.description.width });
    doc.fontSize(8).fillColor(COLORS.muted);
    const qtyText = `${formatAmount(parseAmount(line.quantity))}${line.discount_pct !== '0.0000' ? `  (-${formatAmount(parseAmount(line.discount_pct))}%)` : ''}`;
    doc.text(qtyText, cols.qty.x, y, { width: cols.qty.width, align: 'right' });
    doc.text(money(line.unit_price, currency, locale), cols.unitPrice.x, y, {
      width: cols.unitPrice.width,
      align: 'right',
    });
    doc.text(vatLabel(line, locale), cols.vat.x, y, { width: cols.vat.width, align: 'center' });
    doc.font('Helvetica').fillColor(COLORS.text);
    doc.text(money(line.line_total, currency, locale), cols.total.x, y, {
      width: cols.total.width,
      align: 'right',
    });
    doc.y = y + height + 3;
    doc.moveTo(left, doc.y).lineTo(left + 510, doc.y).strokeColor(COLORS.border).stroke();
    doc.moveDown(0.2);
  }
  doc.y += 4;
}

function totalsBlock(
  doc: PDFKit.PDFDocument,
  document: PdfDocumentRow,
  locale: Locale,
  showSettlement: boolean,
): void {
  const l = LABELS[locale];
  const currency = document.currency;
  const left = doc.page.margins.left;
  const x = left + 300;
  const width = 210;

  const row = (label: string, value: string, bold = false) => {
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 10 : 8.5).fillColor(bold ? COLORS.header : COLORS.muted);
    doc.text(sanitize(label), x, doc.y, { width: 110, align: 'left' });
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fillColor(bold ? COLORS.header : COLORS.text);
    doc.text(value, x + 110, doc.y, { width: width - 110, align: 'right' });
    doc.moveDown(0.2);
  };

  doc.y += 2;
  row(l.subtotal, money(document.subtotal, currency, locale));
  if (parseAmount(document.discount_total) > 0n) row(l.discount, money(document.discount_total, currency, locale));
  if (parseAmount(document.tax_total) > 0n) row(l.vatTotal, money(document.tax_total, currency, locale));
  row(l.grandTotal, money(document.total_amount, currency, locale), true);
  if (showSettlement) {
    if (parseAmount(document.amount_paid) > 0n) row(l.paid, money(document.amount_paid, currency, locale));
    if (parseAmount(document.credited_amount) > 0n) row(l.credited, money(document.credited_amount, currency, locale));
    const outstanding =
      parseAmount(document.total_amount) -
      parseAmount(document.amount_paid) -
      parseAmount(document.credited_amount);
    row(l.outstanding, money(formatAmount(outstanding > 0n ? outstanding : 0n), currency, locale), true);
  }
  doc.moveDown(0.6);
}

function notesBlock(doc: PDFKit.PDFDocument, document: PdfDocumentRow, settings: PdfSettings, locale: Locale): void {
  const l = LABELS[locale];
  const left = doc.page.margins.left;
  const width = doc.page.width - left - doc.page.margins.right;
  const footer = locale === 'fr' ? settings.legal_footer_fr : settings.legal_footer_en;
  const parts: { title: string; body: string }[] = [];
  if (document.terms) parts.push({ title: l.terms, body: document.terms });
  if (document.notes) parts.push({ title: l.notes, body: document.notes });
  if (settings.bank_details) parts.push({ title: l.bank, body: settings.bank_details });
  if (footer) parts.push({ title: l.notes, body: footer });
  for (const part of parts) {
    if (doc.y > doc.page.height - doc.page.margins.bottom - 90) doc.addPage();
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor(COLORS.muted).text(part.title.toUpperCase(), left, doc.y, {
      width,
    });
    doc.font('Helvetica').fontSize(8).fillColor(COLORS.text).text(sanitize(part.body), left, doc.y, { width });
    doc.moveDown(0.5);
  }
}

export async function billingDocumentPdf(options: {
  company: PdfCompany;
  settings: PdfSettings;
  document: PdfDocumentRow;
  lines: PdfLine[];
  customer: PdfCustomer | null;
  locale: Locale;
}): Promise<Buffer> {
  const { company, settings, document, lines, customer, locale } = options;
  const l = LABELS[locale];
  const title =
    document.kind === 'credit_note' ? l.credit_note : document.kind === 'quote' ? l.quote : l.invoice;
  const meta = [
    `${l.date}: ${document.issue_date}`,
    document.due_date ? `${l.dueDate}: ${document.due_date}` : null,
    document.valid_until ? `${l.validUntil}: ${document.valid_until}` : null,
    `${l.status}: ${document.status}`,
  ].filter((m): m is string => m !== null);

  return render((doc) => {
    header(doc, {
      company,
      settings,
      title: `${title}${document.kind === 'quote' ? ` — ${l.notInvoice}` : ''}`,
      number: `${l.number}: ${document.doc_no ?? '-'}`,
      locale,
      meta,
    });
    partyBlock(doc, customer, locale);
    if (document.kind === 'credit_note') {
      doc
        .font('Helvetica-Bold')
        .fontSize(8)
        .fillColor(COLORS.muted)
        .text(`${l.original}: ${document.source_document_id ?? '-'}`)
        .moveDown(0.4);
    }
    lineTable(doc, lines, document.currency, locale);
    totalsBlock(doc, document, locale, document.kind === 'invoice');
    notesBlock(doc, document, settings, locale);
    pageFooter(doc, locale);
  }, `${title} ${document.doc_no ?? ''}`.trim());
}

export async function paymentReceiptPdf(options: {
  company: PdfCompany;
  settings: PdfSettings;
  payment: PdfPayment;
  allocations: { amount: string; doc_no: string | null; issue_date: string; total_amount: string; currency: string }[];
  customer: PdfCustomer;
  locale: Locale;
}): Promise<Buffer> {
  const { company, settings, payment, allocations, customer, locale } = options;
  const l = LABELS[locale];

  return render((doc) => {
    header(doc, {
      company,
      settings,
      title: l.receipt,
      number: `${l.number}: ${payment.payment_no ?? '-'}`,
      locale,
      meta: [
        `${l.date}: ${payment.payment_date}`,
        payment.value_date ? `Value date: ${payment.value_date}` : null,
        `${l.paymentMethod}: ${payment.method}`,
        payment.reference ? `${l.reference}: ${payment.reference}` : null,
      ].filter((m): m is string => m !== null),
    });
    partyBlock(doc, customer, locale);

    doc.font('Helvetica-Bold').fontSize(9).fillColor(COLORS.text);
    doc.text(
      `${l.paid}: ${money(payment.amount, payment.currency, locale)}`,
      doc.page.margins.left,
      doc.y,
      { width: 300 },
    );
    if (parseAmount(payment.unallocated_amount) > 0n) {
      doc
        .font('Helvetica')
        .fontSize(8)
        .fillColor(COLORS.muted)
        .text(`${l.unallocated}: ${money(payment.unallocated_amount, payment.currency, locale)}`);
    }
    doc.moveDown(0.8);
    doc.font('Helvetica-Bold').fontSize(8).fillColor(COLORS.muted).text(l.allocations.toUpperCase());
    doc.moveDown(0.3);

    if (allocations.length === 0) {
      doc.font('Helvetica').fontSize(8).fillColor(COLORS.muted).text('—');
    }
    for (const allocation of allocations) {
      doc
        .font('Helvetica')
        .fontSize(8.5)
        .fillColor(COLORS.text)
        .text(
          `${allocation.doc_no ?? '-'}   ${allocation.issue_date}   ${money(allocation.amount, payment.currency, locale)}`,
          doc.page.margins.left,
          doc.y,
          { width: 400 },
        );
    }
    doc.moveDown(0.6);
    notesBlock(
      doc,
      {
        kind: 'receipt',
        doc_no: payment.payment_no,
        status: 'recorded',
        issue_date: payment.payment_date,
        due_date: null,
        valid_until: null,
        currency: payment.currency,
        subtotal: payment.amount,
        discount_total: '0.0000',
        tax_total: '0.0000',
        total_amount: payment.amount,
        amount_paid: payment.amount,
        credited_amount: '0.0000',
        notes: null,
        terms: null,
        source_document_id: null,
      },
      settings,
      locale,
    );
    pageFooter(doc, locale);
  }, `${l.receipt} ${payment.payment_no ?? ''}`.trim());
}
