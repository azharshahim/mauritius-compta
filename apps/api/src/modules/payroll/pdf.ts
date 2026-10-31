import PDFDocument from 'pdfkit';

/**
 * Simulation payslip PDF. It is watermarked on every page and never presented
 * as an official payslip. No date of birth, full bank account or statutory
 * identifier is included.
 */
export function payrollPdf(input: {
  locale: 'fr' | 'en';
  company: { name?: string; brn?: string | null } | undefined;
  payslipNo: string;
  status: string;
  snapshot: any;
}): Promise<Buffer> {
  const { locale } = input;
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 44, info: { Title: 'Simulation de bulletin de paie', Author: 'Mauritius Business Suite' } });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    const snapshot = input.snapshot ?? {};
    const totals = snapshot.totals ?? {};

    doc.fillColor('#b42318').fontSize(14).text('SIMULATION / DRAFT — NOT FOR PAYMENT', { align: 'center' });
    doc.fillColor('#1c2b3a').fontSize(8).text(
      locale === 'en'
        ? 'This document is not an official payslip and cannot be used to pay wages.'
        : 'Ce document n’est pas un bulletin officiel et ne peut pas être utilisé pour payer un salaire.',
      { align: 'center' },
    );
    doc.moveDown();
    doc.fontSize(16).text(input.company?.name ?? '', { align: 'left' });
    if (input.company?.brn) doc.fontSize(9).fillColor('#5b6b7c').text(`BRN ${input.company.brn}`);
    doc.moveDown(0.5).fillColor('#1c2b3a').fontSize(12).text(
      `${locale === 'en' ? 'Simulation payslip' : 'Bulletin de simulation'} ${input.payslipNo}`,
    );
    doc.fontSize(9).fillColor('#5b6b7c').text(
      `${locale === 'en' ? 'Status' : 'Statut'} : ${input.status} · ${locale === 'en' ? 'Calculation version' : 'Version du calcul'} : ${snapshot.calculationVersion ?? '—'}`,
    );
    doc.moveDown();
    doc.fillColor('#1c2b3a').fontSize(10).text(`${locale === 'en' ? 'Employee' : 'Salarié'} : ${snapshot.employee?.number ?? ''} — ${snapshot.employee?.name ?? ''}`);
    doc.text(`${locale === 'en' ? 'Period' : 'Période'} : ${snapshot.period?.year ?? ''}-${String(snapshot.period?.month ?? '').padStart(2, '0')}`);
    doc.text(`${locale === 'en' ? 'Currency' : 'Devise'} : ${snapshot.currency ?? ''}`);
    doc.moveDown(0.5);

    const left = 44;
    doc.font('Helvetica-Bold').fontSize(9);
    doc.text(locale === 'en' ? 'Code' : 'Code', left, doc.y, { width: 80, continued: true });
    doc.text(locale === 'en' ? 'Description' : 'Libellé', { width: 280, continued: true });
    doc.text(locale === 'en' ? 'Amount' : 'Montant', { width: 100, align: 'right' });
    doc.font('Helvetica').fontSize(9);
    for (const line of snapshot.lines ?? []) {
      if (doc.y > 700) {
        doc.addPage();
        doc.fillColor('#b42318').fontSize(12).text('SIMULATION / DRAFT — NOT FOR PAYMENT', { align: 'center' });
        doc.fillColor('#1c2b3a').fontSize(9);
      }
      doc.text(line.code, left, doc.y, { width: 80, continued: true });
      doc.text(locale === 'en' ? line.label_en : line.label_fr, { width: 280, continued: true });
      doc.text(String(line.amount), { width: 100, align: 'right' });
    }
    doc.moveDown();
    const rows: [string, unknown][] = [
      ['Gross / Brut', totals.gross],
      ['Deductions / Retenues', totals.deductions],
      ['Net arithmetic / Net arithmétique', totals.netArithmetic],
      ['PAYE', '—'],
      ['CSG', '—'],
      ['NSF', '—'],
      ['Net payable / Net à payer', 'NON CALCULÉ'],
    ];
    for (const [label, value] of rows) {
      doc.fontSize(10).text(`${label} : ${value ?? '—'}`, { align: 'right' });
    }
    doc.moveDown();
    doc.fontSize(8).fillColor('#8a6100').text(
      locale === 'en'
        ? 'PAYE, CSG, NSF and employer contributions are not calculated: no Mauritian rule has been expert-validated and the statutory engine is not implemented. The arithmetic net is not a legal net payable.'
        : 'PAYE, CSG, NSF et cotisations employeur ne sont pas calculés : aucune règle mauricienne n’est validée par un expert et le moteur réglementaire n’est pas implémenté. Le net arithmétique n’est pas un net à payer légal.',
      { align: 'left' },
    );
    for (const warning of snapshot.warnings ?? []) {
      doc.text(`• ${warning.code}: ${warning.message}`);
    }
    doc.end();
  });
}
