import PDFDocument from 'pdfkit';
import type { Locale } from '../../i18n/index.js';
import { t } from '../../i18n/index.js';

export interface PdfCompany {
  name: string;
  brn: string | null;
  vat_number: string | null;
  functional_currency: string;
}

export interface FixedAssetPdfInput {
  title: string;
  period: string;
  columns: { label: string; width: number; align?: 'left' | 'right' }[];
  rows: string[][];
  totals?: { label: string; values: string[] }[];
  notes?: string[];
  landscape?: boolean;
}

const COLORS = { text: '#1f2933', muted: '#52606d', border: '#d9e2ec', header: '#102a43', accent: '#0b5fff', warn: '#7a5b00', warnBg: '#fff3cd', warnBorder: '#d9a300' };

function sanitize(input: string): string {
  return String(input)
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\u2013/g, '-')
    .replace(/\u2014/g, '-')
    .replace(/\u2026/g, '...')
    .replace(/\u00a0/g, ' ')
    .replace(/[^\x00-\xFF]/g, '?');
}

function render(build: (doc: PDFKit.PDFDocument) => void, options: PDFKit.PDFDocumentOptions = {}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4', layout: 'portrait', margin: 36, bufferPages: true,
      info: { Title: 'Mauritius Compta — Fixed assets', Author: 'Mauritius Compta 0.1.0 — demo' },
      ...options,
    });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    try { build(doc); doc.end(); } catch (err) { reject(err); }
  });
}

export function fixedAssetPdf(company: PdfCompany, locale: Locale, input: FixedAssetPdfInput): Promise<Buffer> {
  return render((doc) => {
    const pageW = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const left = doc.page.margins.left;
    doc.rect(left, 34, pageW, 3).fill(COLORS.accent);
    doc.moveDown(0.5);
    doc.fillColor(COLORS.header).font('Helvetica-Bold').fontSize(15).text(sanitize(input.title));
    doc.moveDown(0.2);
    doc.fillColor(COLORS.text).font('Helvetica-Bold').fontSize(10.5).text(sanitize(company.name));
    doc.font('Helvetica').fontSize(8).fillColor(COLORS.muted);
    const meta: string[] = [];
    if (company.brn) meta.push(`${t(locale, 'pdf.brn')}: ${sanitize(company.brn)}`);
    if (company.vat_number) meta.push(`${t(locale, 'pdf.vat')}: ${sanitize(company.vat_number)}`);
    meta.push(`${t(locale, 'pdf.period')}: ${sanitize(input.period)}`);
    meta.push(`${t(locale, 'pdf.currency')}: ${company.functional_currency}`);
    doc.text(meta.join('   |   '));
    doc.moveDown(0.4);

    const warnY = doc.y;
    doc.roundedRect(left, warnY, pageW, 20, 3).fillAndStroke(COLORS.warnBg, COLORS.warnBorder);
    doc.fillColor(COLORS.warn).font('Helvetica-Bold').fontSize(7)
      .text(sanitize(t(locale, 'pdf.demo')), left + 6, warnY + 6, { width: pageW - 12, align: 'center' });
    doc.y = warnY + 26;

    const drawHeader = () => {
      const y = doc.y;
      doc.rect(left, y, pageW, 16).fill('#eef2f7');
      let x = left + 3;
      for (const column of input.columns) {
        doc.fillColor(COLORS.header).font('Helvetica-Bold').fontSize(7)
          .text(sanitize(column.label), x, y + 5, { width: column.width * pageW - 6, align: column.align ?? 'left', lineBreak: false });
        x += column.width * pageW;
      }
      doc.y = y + 17;
      doc.fillColor(COLORS.text).font('Helvetica').fontSize(7);
    };

    drawHeader();
    for (const row of input.rows) {
      if (doc.y > doc.page.height - doc.page.margins.bottom - 40) {
        doc.addPage();
        drawHeader();
      }
      const y = doc.y;
      let x = left + 3;
      input.columns.forEach((column, index) => {
        const value = row[index] ?? '';
        doc.fillColor(COLORS.text).font('Helvetica').fontSize(7)
          .text(sanitize(value), x, y + 3, { width: column.width * pageW - 6, align: column.align ?? 'left', lineBreak: false });
        x += column.width * pageW;
      });
      doc.moveTo(left, y + 10).lineTo(left + pageW, y + 10).lineWidth(0.3).strokeColor(COLORS.border).stroke();
      doc.y = y + 11;
    }
    if (input.rows.length === 0) {
      doc.fillColor(COLORS.muted).font('Helvetica-Oblique').fontSize(8).text(sanitize(t(locale, 'fixedAssets.pdf.empty')), left, doc.y + 6);
      doc.moveDown(0.8);
    }
    for (const total of input.totals ?? []) {
      const y = doc.y + 4;
      const labelWidth = input.columns[0]!.width * pageW;
      doc.fillColor(COLORS.header).font('Helvetica-Bold').fontSize(7.5)
        .text(sanitize(total.label), left + 3, y, { width: labelWidth - 6, align: total.values.length > 1 ? 'left' : 'right' });
      let x = left + 3 + labelWidth;
      const rest = input.columns.slice(1);
      const restWidth = rest.reduce((sum, c) => sum + c.width, 0) || 1;
      rest.forEach((column, index) => {
        const width = (column.width / restWidth) * (pageW - labelWidth);
        doc.fillColor(COLORS.header).font('Helvetica-Bold').fontSize(7.5)
          .text(sanitize(total.values[index] ?? ''), x, y, { width: width - 6, align: column.align ?? 'right' });
        x += width;
      });
      doc.y = y + 12;
    }
    for (const note of input.notes ?? []) {
      doc.moveDown(0.2);
      doc.fillColor(COLORS.muted).font('Helvetica').fontSize(7).text(sanitize(note), left, doc.y, { width: pageW });
    }
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i += 1) {
      doc.switchToPage(i);
      doc.fillColor(COLORS.muted).font('Helvetica').fontSize(7)
        .text(`${sanitize(company.name)} — ${sanitize(input.title)} — ${i + 1}/${range.count}`,
          left, doc.page.height - doc.page.margins.bottom + 10, { width: pageW, align: 'center' });
    }
  }, input.landscape ? { layout: 'landscape' } : {});
}
