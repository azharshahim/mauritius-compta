import PDFDocument from 'pdfkit';
import type { Locale } from '../../i18n/index.js';
import { t } from '../../i18n/index.js';
import { formatMoney, parseAmount } from '../../lib/money.js';
import type { LedgerDto, StatementsDto, TrialBalanceDto } from './service.js';

interface PdfCompany {
  name: string;
  brn: string | null;
  vat_number: string | null;
  functional_currency: string;
  presentation_currency: string;
}

const COLORS = {
  text: '#1f2933',
  muted: '#52606d',
  border: '#d9e2ec',
  header: '#102a43',
  warnBg: '#fff3cd',
  warnBorder: '#d9a300',
  accent: '#0b5fff',
};

/** WinAnsi-safe text: replaces typographic characters unsupported by Helvetica. */
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
  options: PDFKit.PDFDocumentOptions = {},
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      layout: 'portrait',
      margin: 40,
      bufferPages: true,
      info: { Title: 'Mauritius Compta', Author: 'Mauritius Compta 0.1.0 — demo' },
      ...options,
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

function header(doc: PDFKit.PDFDocument, company: PdfCompany, title: string, locale: Locale, period: string) {
  const pageW = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  doc.rect(doc.page.margins.left, 40, pageW, 3).fill(COLORS.accent);
  doc.moveDown(0.4);
  doc.fillColor(COLORS.header).font('Helvetica-Bold').fontSize(16).text(sanitize(title));
  doc.moveDown(0.2);
  doc.fillColor(COLORS.text).font('Helvetica-Bold').fontSize(11).text(sanitize(company.name));
  doc.font('Helvetica').fontSize(8).fillColor(COLORS.muted);
  const meta: string[] = [];
  if (company.brn) meta.push(`${t(locale, 'pdf.brn')}: ${sanitize(company.brn)}`);
  if (company.vat_number) meta.push(`${t(locale, 'pdf.vat')}: ${sanitize(company.vat_number)}`);
  meta.push(`${t(locale, 'pdf.period')}: ${period}`);
  meta.push(`${t(locale, 'pdf.currency')}: ${company.functional_currency}`);
  doc.text(meta.join('   |   '));
  doc.moveDown(0.5);

  const warnY = doc.y;
  doc
    .roundedRect(doc.page.margins.left, warnY, pageW, 22, 3)
    .fillAndStroke(COLORS.warnBg, COLORS.warnBorder);
  doc
    .fillColor('#7a5b00')
    .font('Helvetica-Bold')
    .fontSize(7.5)
    .text(sanitize(t(locale, 'pdf.demo')), doc.page.margins.left + 6, warnY + 7, {
      width: pageW - 12,
      align: 'center',
    });
  doc.y = warnY + 32;
  doc.fillColor(COLORS.text);
}

function footer(doc: PDFKit.PDFDocument, locale: Locale) {
  const range = doc.bufferedPageRange();
  const pageW = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const y = doc.page.height - 42;
    doc
      .font('Helvetica')
      .fontSize(7)
      .fillColor(COLORS.muted)
      .text(
        `${t(locale, 'pdf.generated')} ${new Date().toISOString().slice(0, 16).replace('T', ' ')} — Mauritius Compta 0.1.0`,
        doc.page.margins.left,
        y,
        { width: pageW * 0.7, align: 'left' },
      );
    doc.text(
      `${t(locale, 'pdf.page')} ${i - range.start + 1}/${range.count}`,
      doc.page.margins.left + pageW * 0.7,
      y,
      { width: pageW * 0.3, align: 'right' },
    );
  }
}

function tableHeader(doc: PDFKit.PDFDocument, columns: { label: string; width: number; align?: 'left' | 'right' }[], x: number) {
  const y = doc.y;
  const height = 16;
  doc.rect(x, y, columns.reduce((a, c) => a + c.width, 0), height).fill('#e4ebf2');
  let cx = x;
  doc.fillColor(COLORS.header).font('Helvetica-Bold').fontSize(7.5);
  for (const col of columns) {
    doc.text(sanitize(col.label), cx + 3, y + 5, {
      width: col.width - 6,
      align: col.align ?? 'left',
      lineBreak: false,
    });
    cx += col.width;
  }
  doc.y = y + height;
  doc.fillColor(COLORS.text);
}

function row(
  doc: PDFKit.PDFDocument,
  columns: { label: string; width: number; align?: 'left' | 'right'; bold?: boolean }[],
  x: number,
) {
  const needed = 12;
  if (doc.y + needed > doc.page.height - 60) {
    doc.addPage();
    tableHeader(doc, columns, x);
  }
  const y = doc.y;
  let cx = x;
  doc.fontSize(7.5);
  for (const col of columns) {
    doc.font(col.bold ? 'Helvetica-Bold' : 'Helvetica');
    doc.text(sanitize(col.label), cx + 3, y + 3, {
      width: col.width - 6,
      align: col.align ?? 'left',
      lineBreak: false,
      ellipsis: true,
    });
    cx += col.width;
  }
  doc
    .moveTo(x, y + needed)
    .lineTo(x + columns.reduce((a, c) => a + c.width, 0), y + needed)
    .lineWidth(0.3)
    .strokeColor(COLORS.border)
    .stroke();
  doc.y = y + needed;
}

export function ledgerPdf(
  company: PdfCompany,
  ledger: LedgerDto,
  locale: Locale,
): Promise<Buffer> {
  return render(
    (doc) => {
      const x = doc.page.margins.left;
      const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
      header(doc, company, t(locale, 'pdf.title.ledger'), locale, `${ledger.from} — ${ledger.to}`);

      const cols = [
        { label: t(locale, 'pdf.date'), width: width * 0.09 },
        { label: t(locale, 'pdf.journal'), width: width * 0.06 },
        { label: t(locale, 'pdf.reference'), width: width * 0.13 },
        { label: t(locale, 'pdf.description'), width: width * 0.32 },
        { label: t(locale, 'pdf.debit'), width: width * 0.13, align: 'right' as const },
        { label: t(locale, 'pdf.credit'), width: width * 0.13, align: 'right' as const },
        { label: t(locale, 'pdf.balance'), width: width * 0.14, align: 'right' as const },
      ];

      if (ledger.accounts.length === 0) {
        doc.font('Helvetica').fontSize(9).fillColor(COLORS.muted).text(t(locale, 'pdf.noEntries'));
      }

      for (const account of ledger.accounts) {
        doc.moveDown(0.4);
        doc
          .font('Helvetica-Bold')
          .fontSize(9)
          .fillColor(COLORS.header)
          .text(sanitize(`${account.code} — ${account.name}`));
        doc.fontSize(7.5).fillColor(COLORS.muted);
        doc.text(
          sanitize(
            `${t(locale, 'pdf.opening')}: ${formatMoney(account.opening, locale, ledger.currency)}`,
          ),
        );
        doc.fillColor(COLORS.text);
        tableHeader(doc, cols, x);
        row(
          doc,
          [
            { label: '', width: cols[0]!.width },
            { label: '', width: cols[1]!.width },
            { label: '', width: cols[2]!.width },
            { label: t(locale, 'pdf.opening'), width: cols[3]!.width, bold: true },
            { label: '', width: cols[4]!.width },
            { label: '', width: cols[5]!.width },
            { label: formatMoney(account.opening, locale), width: cols[6]!.width, align: 'right', bold: true },
          ],
          x,
        );
        for (const line of account.lines) {
          row(
            doc,
            [
              { label: line.date, width: cols[0]!.width },
              { label: line.journal, width: cols[1]!.width },
              { label: line.reference ?? line.entryNo, width: cols[2]!.width },
              { label: line.description, width: cols[3]!.width },
              { label: formatMoney(line.debit, locale), width: cols[4]!.width, align: 'right' },
              { label: formatMoney(line.credit, locale), width: cols[5]!.width, align: 'right' },
              { label: formatMoney(line.balance, locale), width: cols[6]!.width, align: 'right' },
            ],
            x,
          );
        }
        row(
          doc,
          [
            { label: '', width: cols[0]!.width },
            { label: '', width: cols[1]!.width },
            { label: '', width: cols[2]!.width },
            { label: t(locale, 'pdf.totals'), width: cols[3]!.width, bold: true },
            { label: formatMoney(account.totalDebit, locale), width: cols[4]!.width, align: 'right', bold: true },
            { label: formatMoney(account.totalCredit, locale), width: cols[5]!.width, align: 'right', bold: true },
            { label: formatMoney(account.closing, locale), width: cols[6]!.width, align: 'right', bold: true },
          ],
          x,
        );
      }
      footer(doc, locale);
    },
    { layout: 'landscape' },
  );
}

export function trialBalancePdf(
  company: PdfCompany,
  tb: TrialBalanceDto,
  locale: Locale,
): Promise<Buffer> {
  return render(
    (doc) => {
      const x = doc.page.margins.left;
      const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
      header(doc, company, t(locale, 'pdf.title.trialBalance'), locale, `${tb.from} — ${tb.to}`);

      const cols = [
        { label: t(locale, 'pdf.account'), width: width * 0.34 },
        { label: `${t(locale, 'pdf.opening')} D`, width: width * 0.11, align: 'right' as const },
        { label: `${t(locale, 'pdf.opening')} C`, width: width * 0.11, align: 'right' as const },
        { label: `${t(locale, 'pdf.debit')}`, width: width * 0.11, align: 'right' as const },
        { label: `${t(locale, 'pdf.credit')}`, width: width * 0.11, align: 'right' as const },
        { label: `${t(locale, 'pdf.balance')} D`, width: width * 0.11, align: 'right' as const },
        { label: `${t(locale, 'pdf.balance')} C`, width: width * 0.11, align: 'right' as const },
      ];
      tableHeader(doc, cols, x);
      for (const r of tb.rows) {
        row(
          doc,
          [
            { label: `${r.code} — ${r.name}`, width: cols[0]!.width },
            { label: formatMoney(r.openingDebit, locale), width: cols[1]!.width, align: 'right' },
            { label: formatMoney(r.openingCredit, locale), width: cols[2]!.width, align: 'right' },
            { label: formatMoney(r.movementDebit, locale), width: cols[3]!.width, align: 'right' },
            { label: formatMoney(r.movementCredit, locale), width: cols[4]!.width, align: 'right' },
            { label: formatMoney(r.closingDebit, locale), width: cols[5]!.width, align: 'right' },
            { label: formatMoney(r.closingCredit, locale), width: cols[6]!.width, align: 'right' },
          ],
          x,
        );
      }
      row(
        doc,
        [
          { label: t(locale, 'pdf.totals'), width: cols[0]!.width, bold: true },
          { label: formatMoney(tb.totals.openingDebit, locale), width: cols[1]!.width, align: 'right', bold: true },
          { label: formatMoney(tb.totals.openingCredit, locale), width: cols[2]!.width, align: 'right', bold: true },
          { label: formatMoney(tb.totals.movementDebit, locale), width: cols[3]!.width, align: 'right', bold: true },
          { label: formatMoney(tb.totals.movementCredit, locale), width: cols[4]!.width, align: 'right', bold: true },
          { label: formatMoney(tb.totals.closingDebit, locale), width: cols[5]!.width, align: 'right', bold: true },
          { label: formatMoney(tb.totals.closingCredit, locale), width: cols[6]!.width, align: 'right', bold: true },
        ],
        x,
      );
      doc.moveDown(0.8);
      doc
        .font('Helvetica-Bold')
        .fontSize(8)
        .fillColor(tb.balanced ? '#1b7f3b' : '#b42318')
        .text(
          sanitize(
            tb.balanced
              ? 'Debit = Credit ✔'
              : `UNBALANCED: ${formatMoney(parseAmount(tb.totals.closingDebit) - parseAmount(tb.totals.closingCredit), locale)}`,
          ),
        );
      footer(doc, locale);
    },
    { layout: 'landscape' },
  );
}

export function statementsPdf(
  company: PdfCompany,
  st: StatementsDto,
  locale: Locale,
): Promise<Buffer> {
  return render((doc) => {
    const x = doc.page.margins.left;
    const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    header(doc, company, t(locale, 'pdf.title.statements'), locale, `${st.from} — ${st.to}`);

    const line = (label: string, amount: string, bold = false) => {
      const y = doc.y;
      if (y > doc.page.height - 80) doc.addPage();
      doc
        .font(bold ? 'Helvetica-Bold' : 'Helvetica')
        .fontSize(8.5)
        .fillColor(COLORS.text)
        .text(sanitize(label), x + 4, y, { width: width * 0.72, lineBreak: false });
      doc.text(sanitize(formatMoney(amount, locale, st.currency)), x + width * 0.72, y, {
        width: width * 0.28 - 4,
        align: 'right',
      });
      doc.y = y + 13;
    };

    const sectionTitle = (label: string) => {
      doc.moveDown(0.5);
      doc.font('Helvetica-Bold').fontSize(10).fillColor(COLORS.header).text(sanitize(label));
      doc
        .moveTo(x, doc.y + 2)
        .lineTo(x + width, doc.y + 2)
        .lineWidth(0.5)
        .strokeColor(COLORS.border)
        .stroke();
      doc.moveDown(0.4);
      doc.fillColor(COLORS.text);
    };

    sectionTitle(t(locale, 'pdf.title.statements'));
    sectionTitle(t(locale, 'pdf.assets'));
    for (const l of st.financialPosition.assets.lines) line(`${l.code} ${l.name}`, l.amount);
    line(t(locale, 'pdf.totalAssets'), st.financialPosition.totalAssets, true);

    sectionTitle(t(locale, 'pdf.liabilities'));
    for (const l of st.financialPosition.liabilities.lines) line(`${l.code} ${l.name}`, l.amount);
    line(t(locale, 'pdf.liabilities'), st.financialPosition.liabilities.total, true);

    sectionTitle(t(locale, 'pdf.equity'));
    for (const l of st.financialPosition.equity.lines) line(`${l.code} ${l.name}`, l.amount);
    line(
      locale === 'en' ? 'Result not yet appropriated' : 'Résultat non affecté',
      st.financialPosition.unappropriatedResult,
    );
    line(t(locale, 'pdf.totalLiabilitiesAndEquity'), st.financialPosition.totalLiabilitiesAndEquity, true);

    doc.moveDown(0.5);
    doc
      .font('Helvetica-Bold')
      .fontSize(8)
      .fillColor(st.financialPosition.balanced ? '#1b7f3b' : '#b42318')
      .text(
        sanitize(
          st.financialPosition.balanced
            ? locale === 'en'
              ? 'Balance sheet balances (provisional)'
              : 'Bilan équilibré (provisoire)'
            : locale === 'en'
              ? 'WARNING: balance sheet does not balance'
              : 'ATTENTION : le bilan ne s’équilibre pas',
        ),
      );

    doc.addPage();
    header(doc, company, locale === 'en' ? 'Statement of Profit or Loss' : 'Compte de résultat', locale, `${st.from} — ${st.to}`);
    sectionTitle(t(locale, 'pdf.revenue'));
    for (const l of st.profitAndLoss.revenue.lines) line(`${l.code} ${l.name}`, l.amount);
    line(t(locale, 'pdf.revenue'), st.profitAndLoss.revenue.total, true);
    sectionTitle(t(locale, 'pdf.expenses'));
    for (const l of st.profitAndLoss.expenses.lines) line(`${l.code} ${l.name}`, l.amount);
    line(t(locale, 'pdf.expenses'), st.profitAndLoss.expenses.total, true);
    doc.moveDown(0.4);
    line(t(locale, 'pdf.profit'), st.profitAndLoss.profit, true);

    footer(doc, locale);
  });
}
