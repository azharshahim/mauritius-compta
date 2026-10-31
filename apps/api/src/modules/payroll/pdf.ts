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
    const shown = (value: unknown) => (value === null || value === undefined ? 'NOT CALCULATED' : String(value));
    const rows: [string, unknown][] = [
      ['Additional Remuneration / Rémunération additionnelle', totals.additionalRemuneration],
      ['Taxable emoluments / Émoluments imposables', totals.taxableEmoluments],
      ['Gross / Brut', totals.gross],
      ['PAYE', totals.paye],
      ['CSG employee / CSG salarié', totals.csgEmployee],
      ['NSF employee / NSF salarié', totals.nsfEmployee],
      ['Other deductions / Autres retenues', totals.deductions],
      ['Net after statutory / Net après cotisations', totals.netAfterStatutory],
      ['NET PAYABLE / NET À PAYER', totals.netPayable],
      ['CSG employer / CSG employeur', totals.csgEmployer],
      ['NSF employer / NSF employeur', totals.nsfEmployer],
      ['Training levy / Levy de formation', totals.trainingLevy],
      ['Employer cost / Coût employeur', totals.employerCost],
    ];
    for (const [label, value] of rows) {
      doc.fontSize(9).text(`${label} : ${shown(value)}`, { align: 'right' });
    }
    doc.moveDown();
    doc.fontSize(8).fillColor('#8a6100').text(
      locale === 'en'
        ? `Status ${snapshot.statutoryStatus ?? 'UNKNOWN'} — PAYE basis ${snapshot.payeBasis ?? '—'}. Rules are sourced but not expert-approved; this is a simulation, not a legal payslip, and the net payable is never a payment instruction.`
        : `Statut ${snapshot.statutoryStatus ?? 'INCONNU'} — base PAYE ${snapshot.payeBasis ?? '—'}. Les règles sont sourcées mais non approuvées par un expert ; ceci est une simulation, pas un bulletin légal, et le net à payer n’est jamais un ordre de paiement.`,
      { align: 'left' },
    );
    if (Array.isArray(snapshot.rulesApplied)) {
      doc.fontSize(7).fillColor('#5b6b7c').text(
        snapshot.rulesApplied.map((r: any) => `${r.ruleCode} v${r.version ?? '?'} (${r.status})`).join(' · '),
      );
    }
    for (const warning of snapshot.warnings ?? []) {
      doc.text(`• ${warning.code}: ${warning.message}`);
    }
    doc.end();
  });
}
