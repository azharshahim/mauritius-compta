import PDFDocument from 'pdfkit';

/**
 * Simulation payslip PDF.
 *
 * There is no large diagonal watermark: the document stays readable like a
 * cabinet payslip. The non-payment status is carried by a small header label,
 * a status panel and a discreet footer on every page. No date of birth, full
 * bank account or statutory identifier is included.
 */
export function payrollPdf(input: {
  locale: 'fr' | 'en';
  company: {
    name?: string; brn?: string | null; registered_address?: string | null;
    business_activity?: string | null; contact_email?: string | null; contact_phone?: string | null;
  } | undefined;
  payslipNo: string;
  status: string;
  snapshot: any;
}): Promise<Buffer> {
  const { locale } = input;
  const snapshot = input.snapshot ?? {};
  const totals = snapshot.totals ?? {};
  const company = input.company ?? snapshot.company ?? {};

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4', margin: 46,
      info: {
        Title: `${locale === 'en' ? 'Simulation payslip' : 'Bulletin de paie (simulation)'} ${input.payslipNo}`,
        Author: company.name || 'Mauritius Business Suite',
        Subject: 'SIMULATION — NOT VALIDATED FOR PAYMENT',
      },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const LEFT = 46;
    const WIDTH = 503;
    const RIGHT = LEFT + WIDTH;
    const TEAL = '#124E5A';
    const INK = '#1E2D38';
    const MUTED = '#647684';
    const LINE = '#D7E0E5';
    const SOFT = '#F3F7F8';
    const AMBER = '#8A5A00';
    let pageNo = 1;

    const tr = (en: string, fr: string) => (locale === 'en' ? en : fr);
    const amount = (value: unknown): string => {
      if (value === null || value === undefined || value === '') return '—';
      const raw = String(value).replace(/\s/g, '');
      const negative = raw.startsWith('-');
      const [intPart = '0', decPart = ''] = raw.replace('-', '').split('.');
      const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
      const trimmed = decPart.replace(/0+$/, '');
      const decimals = trimmed.length < 2 ? (trimmed + '00').slice(0, 2) : trimmed.slice(0, 4);
      return `${negative ? '-' : ''}${grouped}.${decimals}`;
    };
    const shown = (value: unknown) =>
      value === null || value === undefined ? tr('NOT CALCULATED', 'NON CALCULÉ') : amount(value);
    const units = (value: unknown): bigint => {
      if (value === null || value === undefined || value === '') return 0n;
      const raw = String(value).trim();
      const negative = raw.startsWith('-');
      const [intPart = '0', decPart = ''] = raw.replace(/^[+-]/, '').split('.');
      const unitsValue = BigInt(intPart || '0') * 10_000n +
        BigInt((decPart + '0000').slice(0, 4) || '0');
      return negative ? -unitsValue : unitsValue;
    };
    const fromUnits = (value: bigint): string => {
      const negative = value < 0n;
      const abs = negative ? -value : value;
      const intPart = abs / 10_000n;
      const decPart = String(abs % 10_000n).padStart(4, '0');
      return amount(`${negative ? '-' : ''}${intPart}.${decPart}`);
    };
    const text = (value: unknown, fallback = '—') =>
      value === null || value === undefined || value === '' ? fallback : String(value);
    const date = (value: unknown) => {
      if (!value) return '—';
      const raw = String(value).slice(0, 10);
      return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw.split('-').reverse().join('/') : raw;
    };

    const footer = () => {
      const y = doc.page.height - 74;
      doc.moveTo(LEFT, y).lineTo(RIGHT, y).strokeColor(LINE).lineWidth(0.6).stroke();
      doc.font('Helvetica-Bold').fontSize(6.5).fillColor(AMBER)
        .text(tr('SIMULATION — NOT VALIDATED FOR PAYMENT', 'SIMULATION — NON VALIDÉ POUR PAIEMENT'), LEFT, y + 7, {
          width: 250, lineBreak: false,
        });
      doc.font('Helvetica').fontSize(6.5).fillColor(MUTED)
        .text(`${text(input.payslipNo)} · ${tr('Page', 'Page')} ${pageNo}`, LEFT + 250, y + 7, {
          width: WIDTH - 250, align: 'right', lineBreak: false,
        });
    };

    const newPage = () => {
      footer();
      doc.addPage();
      pageNo += 1;
      doc.rect(0, 0, doc.page.width, 5).fill(TEAL);
      doc.font('Helvetica-Bold').fontSize(8).fillColor(TEAL).text(text(company.name), LEFT, 34, { width: 300 });
      doc.font('Helvetica').fontSize(7).fillColor(MUTED)
        .text(`${text(input.payslipNo)} — ${tr('payslip (continued)', 'bulletin (suite)')}`, LEFT, 34, {
          width: WIDTH, align: 'right',
        });
      doc.moveTo(LEFT, 48).lineTo(RIGHT, 48).strokeColor(LINE).stroke();
      doc.y = 60;
    };

    const ensure = (height: number) => {
      if (doc.y + height > doc.page.height - 78) newPage();
    };

    const sectionTitle = (title: string) => {
      ensure(34);
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor(TEAL).text(title.toUpperCase(), LEFT, doc.y, {
        characterSpacing: 0.5,
      });
      doc.moveDown(0.35);
      doc.moveTo(LEFT, doc.y).lineTo(RIGHT, doc.y).strokeColor(LINE).lineWidth(0.5).stroke();
      doc.moveDown(0.45);
    };

    const tableHeader = (columns: { label: string; x: number; width: number; align?: 'left' | 'right' }[]) => {
      const y = doc.y;
      doc.rect(LEFT, y, WIDTH, 17).fill(SOFT);
      doc.font('Helvetica-Bold').fontSize(7).fillColor(MUTED);
      for (const column of columns) {
        doc.text(column.label, column.x, y + 5, {
          width: column.width, align: column.align ?? 'left', lineBreak: false,
        });
      }
      doc.y = y + 18;
    };

    const tableRow = (
      columns: { value: string; x: number; width: number; align?: 'left' | 'right'; bold?: boolean }[],
      shade = false,
    ) => {
      ensure(18);
      const y = doc.y;
      const height = 17;
      if (shade) doc.rect(LEFT, y, WIDTH, height).fill('#FAFCFC');
      doc.font('Helvetica').fontSize(7.6).fillColor(INK);
      for (const column of columns) {
        doc.font(column.bold ? 'Helvetica-Bold' : 'Helvetica');
        doc.text(column.value, column.x, y + 4.7, {
          width: column.width, align: column.align ?? 'left', lineBreak: false, ellipsis: true,
        });
      }
      doc.moveTo(LEFT, y + height).lineTo(RIGHT, y + height).strokeColor('#E9EFF2').lineWidth(0.4).stroke();
      doc.y = y + height + 1;
    };

    const summaryRow = (label: string, value: unknown, strong = false, warn = false) => {
      ensure(20);
      const y = doc.y;
      if (strong) doc.rect(LEFT + 300, y - 1, WIDTH - 300, 20).fill(SOFT);
      doc.font(strong ? 'Helvetica-Bold' : 'Helvetica').fontSize(strong ? 8.6 : 7.8)
        .fillColor(warn ? AMBER : INK);
      doc.text(label, LEFT + 300, y + 4, { width: 120, lineBreak: false, ellipsis: true });
      doc.text(shown(value), RIGHT - 82, y + 4, { width: 82, align: 'right', lineBreak: false });
      doc.y = y + (strong ? 21 : 16);
    };

    // ---------------------------------------------------------------- header
    doc.rect(0, 0, doc.page.width, 6).fill(TEAL);
    doc.font('Helvetica-Bold').fontSize(16).fillColor(INK)
      .text(text(company.name, tr('Company', 'Société')), LEFT, 42, { width: 330 });
    doc.font('Helvetica').fontSize(7.5).fillColor(MUTED)
      .text(text(company.registered_address, tr('Address not configured', 'Adresse non configurée')), LEFT, 64, {
        width: 320,
      });
    const contact = [company.contact_phone, company.contact_email].filter(Boolean).join(' · ');
    if (contact) {
      doc.fontSize(7.2).fillColor(MUTED).text(contact, LEFT, doc.y + 1, { width: 320 });
    }
    doc.fontSize(7.2).fillColor(MUTED).text(
      [company.brn ? `BRN ${company.brn}` : null, company.business_activity].filter(Boolean).join(' · '),
      LEFT, doc.y + 1, { width: 320 },
    );

    doc.font('Helvetica-Bold').fontSize(14).fillColor(TEAL)
      .text(tr('PAYSLIP', 'BULLETIN DE PAIE'), 330, 42, { width: 219, align: 'right' });
    doc.font('Helvetica').fontSize(7.3).fillColor(MUTED)
      .text(tr('Simulation — not validated for payment', 'Simulation — non validé pour paiement'), 330, 62, {
        width: 219, align: 'right',
      });
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(INK)
      .text(text(input.payslipNo), 330, 78, { width: 219, align: 'right' });
    doc.font('Helvetica').fontSize(7.2).fillColor(MUTED)
      .text(`${tr('Status', 'Statut')}: ${text(input.status).toUpperCase()}`, 330, 91, {
        width: 219, align: 'right',
      });

    doc.moveTo(LEFT, 112).lineTo(RIGHT, 112).strokeColor(TEAL).lineWidth(1.2).stroke();

    // ------------------------------------------------------------ identity
    let y = 126;
    doc.roundedRect(LEFT, y, 246, 94, 5).fill(SOFT);
    doc.roundedRect(LEFT + 257, y, 246, 94, 5).fill(SOFT);
    doc.font('Helvetica-Bold').fontSize(7).fillColor(TEAL)
      .text(tr('EMPLOYEE', 'SALARIÉ'), LEFT + 12, y + 10);
    doc.font('Helvetica-Bold').fontSize(11).fillColor(INK)
      .text(text(snapshot.employee?.name), LEFT + 12, y + 23, { width: 222 });
    doc.font('Helvetica').fontSize(7.6).fillColor(MUTED)
      .text(`${tr('Employee no.', 'Matricule')} ${text(snapshot.employee?.number)}`, LEFT + 12, y + 41, { width: 222 });
    doc.text(`${tr('Job title', 'Fonction')}: ${text(snapshot.employee?.jobTitle)}`, LEFT + 12, y + 54, {
      width: 222, ellipsis: true,
    });
    doc.text(`${tr('Contract', 'Contrat')}: ${text(snapshot.contract?.type)} · ${text(snapshot.contract?.workPattern)}`,
      LEFT + 12, y + 67, { width: 222, ellipsis: true });
    doc.text(`${tr('Bank account', 'Compte bancaire')}: ${text(snapshot.employee?.bankAccountMasked)}`,
      LEFT + 12, y + 80, { width: 222, ellipsis: true });

    doc.font('Helvetica-Bold').fontSize(7).fillColor(TEAL)
      .text(tr('PAY PERIOD', 'PÉRIODE DE PAIE'), LEFT + 269, y + 10);
    doc.font('Helvetica-Bold').fontSize(11).fillColor(INK)
      .text(snapshot.period?.year && snapshot.period?.month
        ? `${String(snapshot.period.month).padStart(2, '0')}/${snapshot.period.year}`
        : '—', LEFT + 269, y + 23);
    doc.font('Helvetica').fontSize(7.6).fillColor(MUTED)
      .text(`${date(snapshot.period?.start)} - ${date(snapshot.period?.end)}`, LEFT + 269, y + 41);
    doc.text(`${tr('Payment date', 'Date de paiement')}: ${date(snapshot.period?.paymentDate)}`, LEFT + 269, y + 54);
    doc.text(`${tr('Currency', 'Devise')}: ${text(snapshot.currency, 'MUR')}`, LEFT + 269, y + 67);
    doc.text(`${tr('Calculation ref.', 'Réf. calcul')}: ${text(snapshot.calculationReference)}`, LEFT + 269, y + 80, {
      width: 222, ellipsis: true,
    });

    doc.y = y + 112;

    // ------------------------------------------------------------- earnings
    const lines: any[] = Array.isArray(snapshot.lines) ? snapshot.lines : [];
    const earnings = lines.filter((line) => line.line_type === 'earning');
    const reimbursements = lines.filter((line) => line.line_type === 'reimbursement');
    const deductions = lines.filter((line) => ['deduction', 'advance', 'loan'].includes(line.line_type));
    const employerLines = lines.filter((line) => line.line_type === 'employer');

    sectionTitle(tr('Earnings', 'Rémunérations'));
    tableHeader([
      { label: tr('CODE', 'CODE'), x: LEFT + 7, width: 62 },
      { label: tr('DESCRIPTION', 'LIBELLÉ'), x: LEFT + 75, width: 320 },
      { label: tr('AMOUNT (MUR)', 'MONTANT (MUR)'), x: RIGHT - 102, width: 95, align: 'right' },
    ]);
    if (earnings.length === 0) {
      tableRow([
        { value: 'BASE', x: LEFT + 7, width: 62 },
        { value: tr('Base salary', 'Salaire de base'), x: LEFT + 75, width: 320 },
        { value: amount(totals.base), x: RIGHT - 102, width: 95, align: 'right' },
      ]);
    }
    earnings.forEach((line, index) => {
      tableRow([
        { value: text(line.code), x: LEFT + 7, width: 62 },
        { value: text(locale === 'en' ? line.label_en : line.label_fr), x: LEFT + 75, width: 320 },
        { value: amount(line.amount), x: RIGHT - 102, width: 95, align: 'right' },
      ], index % 2 === 1);
    });
    tableRow([
      { value: '', x: LEFT + 7, width: 62 },
      { value: tr('GROSS SALARY', 'SALAIRE BRUT'), x: LEFT + 75, width: 320, bold: true },
      { value: amount(totals.gross), x: RIGHT - 102, width: 95, align: 'right', bold: true },
    ]);
    if (reimbursements.length > 0) {
      reimbursements.forEach((line) => {
        tableRow([
          { value: text(line.code), x: LEFT + 7, width: 62 },
          { value: `${text(locale === 'en' ? line.label_en : line.label_fr)} (${tr('not taxable', 'non imposable')})`,
            x: LEFT + 75, width: 320 },
          { value: amount(line.amount), x: RIGHT - 102, width: 95, align: 'right' },
        ]);
      });
    }
    doc.moveDown(0.5);

    // ----------------------------------------------------------- deductions
    sectionTitle(tr('Deductions', 'Retenues'));
    tableHeader([
      { label: tr('CODE', 'CODE'), x: LEFT + 7, width: 62 },
      { label: tr('DESCRIPTION', 'LIBELLÉ'), x: LEFT + 75, width: 320 },
      { label: tr('AMOUNT (MUR)', 'MONTANT (MUR)'), x: RIGHT - 102, width: 95, align: 'right' },
    ]);
    if (deductions.length === 0) {
      tableRow([
        { value: '', x: LEFT + 7, width: 62 },
        { value: tr('No statutory deduction calculated', 'Aucune retenue statutaire calculée'), x: LEFT + 75, width: 320 },
        { value: '0.00', x: RIGHT - 102, width: 95, align: 'right' },
      ]);
    }
    deductions.forEach((line, index) => {
      tableRow([
        { value: text(line.code), x: LEFT + 7, width: 62 },
        { value: text(locale === 'en' ? line.label_en : line.label_fr), x: LEFT + 75, width: 320 },
        { value: amount(line.amount), x: RIGHT - 102, width: 95, align: 'right' },
      ], index % 2 === 1);
    });
    tableRow([
      { value: '', x: LEFT + 7, width: 62 },
      { value: tr('TOTAL DEDUCTIONS', 'TOTAL DES RETENUES'), x: LEFT + 75, width: 320, bold: true },
      { value: fromUnits(
        units(totals.deductions) + units(totals.paye) +
        units(totals.csgEmployee) + units(totals.nsfEmployee),
      ), x: RIGHT - 102, width: 95, align: 'right', bold: true },
    ]);
    doc.moveDown(1);

    // --------------------------------------------------------------- totals
    ensure(120);
    const summaryTop = doc.y;
    doc.roundedRect(LEFT, summaryTop, WIDTH, 108, 5).fill('#F8FAFB');
    doc.font('Helvetica-Bold').fontSize(7).fillColor(TEAL)
      .text(tr('NET POSITION', 'POSITION NETTE'), LEFT + 12, summaryTop + 10);
    doc.y = summaryTop + 20;
    summaryRow(tr('Taxable emoluments', 'Émoluments imposables'), totals.taxableEmoluments);
    summaryRow(tr('Arithmetic net after deductions', 'Net arithmétique après retenues'), totals.netArithmetic);
    summaryRow(tr('Net after statutory deductions', 'Net après cotisations statutaires'), totals.netAfterStatutory);
    summaryRow(tr('NET PAYABLE', 'NET À PAYER'), totals.netPayable, true, true);
    doc.font('Helvetica').fontSize(6.8).fillColor(MUTED)
      .text(tr('Net payable is never calculated while the rules are not expert-approved.',
        'Le net à payer n’est jamais calculé tant que les règles ne sont pas approuvées par un expert.'),
      LEFT + 300, summaryTop + 88, { width: WIDTH - 312, align: 'right' });
    doc.y = summaryTop + 118;

    // ------------------------------------------------------ employer costs
    sectionTitle(tr('Employer contributions', 'Contributions employeur'));
    summaryRow(tr('CSG employer', 'CSG employeur'), totals.csgEmployer);
    summaryRow(tr('NSF employer', 'NSF employeur'), totals.nsfEmployer);
    summaryRow(tr('HRDC Training Levy', 'Levy de formation HRDC'), totals.trainingLevy);
    if (employerLines.length > 0) {
      const shownCodes = new Set(['CSG_ER', 'NSF_ER', 'TRAINING_LEVY']);
      for (const line of employerLines.filter((item) => !shownCodes.has(String(item.code)))) {
        summaryRow(text(locale === 'en' ? line.label_en : line.label_fr), line.amount);
      }
    }
    summaryRow(tr('TOTAL EMPLOYER COST', 'COÛT TOTAL EMPLOYEUR'), totals.employerCost, true);
    doc.moveDown(0.6);

    // ------------------------------------------------------- rules and audit
    sectionTitle(tr('Rules and traceability', 'Règles et traçabilité'));
    doc.font('Helvetica').fontSize(7).fillColor(INK);
    const statusLabel = `${tr('Calculation status', 'Statut du calcul')}: ${text(snapshot.statutoryStatus)}`;
    const basisLabel = `${tr('PAYE basis', 'Base PAYE')}: ${text(snapshot.payeBasis)}`;
    const versionLabel = `${tr('Version', 'Version')}: ${text(snapshot.calculationVersion)}`;
    const generatedLabel = `${tr('Generated on', 'Généré le')}: ${text(snapshot.generatedAt)}`;
    doc.text(`${statusLabel} · ${basisLabel} · ${versionLabel}`, LEFT, doc.y, { width: WIDTH });
    doc.text(generatedLabel, LEFT, doc.y + 1, { width: WIDTH });
    if (Array.isArray(snapshot.rulesApplied) && snapshot.rulesApplied.length > 0) {
      doc.moveDown(0.25);
      for (const rule of snapshot.rulesApplied) {
        ensure(12);
        doc.font('Helvetica').fontSize(6.6).fillColor(MUTED)
          .text(`${text(rule.ruleCode)} · v${text(rule.version)} · ${text(rule.status)} · ${text(rule.sourceReference)}`,
            LEFT, doc.y, { width: WIDTH, ellipsis: true });
      }
    }
    if (Array.isArray(snapshot.missingRules) && snapshot.missingRules.length > 0) {
      doc.moveDown(0.2);
      doc.font('Helvetica-Bold').fontSize(6.8).fillColor(AMBER).text(
        `${tr('Blocking items', 'Points bloquants')}: ${snapshot.missingRules
          .map((item: any) => `${text(item.ruleCode)} (${text(item.reason)})`).join(', ')}`,
        LEFT, doc.y, { width: WIDTH },
      );
    }
    if (Array.isArray(snapshot.warnings) && snapshot.warnings.length > 0) {
      doc.font('Helvetica').fontSize(6.6).fillColor(MUTED).text(
        snapshot.warnings.map((warning: any) => `${text(warning.code)}: ${text(warning.message)}`).join(' · '),
        LEFT, doc.y + 1, { width: WIDTH },
      );
    }

    footer();
    doc.end();
  });
}
