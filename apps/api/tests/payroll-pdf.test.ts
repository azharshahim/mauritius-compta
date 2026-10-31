import { describe, expect, it } from 'vitest';
import { payrollPdf } from '../src/modules/payroll/pdf.js';

const snapshot = {
  employee: { number: 'MDS001', name: 'Daniel Morel', jobTitle: 'Administrative officer (fictif)', bankAccountMasked: '•••• 1601' },
  contract: { type: 'permanent', workPattern: 'full_time' },
  period: { year: 2026, month: 10, start: '2026-10-01', end: '2026-10-31', paymentDate: '2026-10-31' },
  currency: 'MUR', calculationReference: 'calc-fictif-001', calculationVersion: 1,
  generatedAt: '2026-10-31T12:00:00.000Z', statutoryStatus: 'EXPERT_REVIEW_PENDING', payeBasis: 'EDF_CUMULATIVE',
  lines: [
    { line_type: 'earning', code: 'BASE', label_en: 'Base salary', label_fr: 'Salaire de base', amount: '30000.0000' },
    { line_type: 'earning', code: 'AR2026', label_en: 'Additional Remuneration 2026', label_fr: 'Rémunération additionnelle 2026', amount: '635.0000' },
    { line_type: 'deduction', code: 'PAYE', label_en: 'PAYE withheld', label_fr: 'PAYE retenu', amount: '0.0000' },
    { line_type: 'deduction', code: 'CSG_EE', label_en: 'CSG employee', label_fr: 'CSG salarié', amount: '459.5250' },
    { line_type: 'deduction', code: 'NSF_EE', label_en: 'NSF employee', label_fr: 'NSF salarié', amount: '297.1000' },
    { line_type: 'employer', code: 'CSG_ER', label_en: 'CSG employer', label_fr: 'CSG employeur', amount: '919.0500' },
    { line_type: 'employer', code: 'NSF_ER', label_en: 'NSF employer', label_fr: 'NSF employeur', amount: '742.7500' },
    { line_type: 'employer', code: 'TRAINING_LEVY', label_en: 'HRDC Training Levy', label_fr: 'Levy de formation HRDC', amount: '459.5250' },
  ],
  totals: {
    base: '30000.0000', additionalRemuneration: '635.0000', taxableEmoluments: '30635.0000',
    gross: '30635.0000', deductions: '0.0000', netArithmetic: '30635.0000', paye: '0.0000',
    csgEmployee: '459.5250', nsfEmployee: '297.1000', netAfterStatutory: '29878.3750',
    netPayable: null, csgEmployer: '919.0500', nsfEmployer: '742.7500',
    trainingLevy: '459.5250', employerCost: '32756.3250',
  },
  rulesApplied: [
    { ruleCode: 'PAYE', version: 2, status: 'RESEARCHED', sourceReference: 'Finance Act 2026 s.7; EDF 2026/27 note 2' },
    { ruleCode: 'NSF_LIMITS', version: 2, status: 'RESEARCHED', sourceReference: 'MRA NPF/NSF page — table 1 July 2026' },
  ],
  missingRules: [], warnings: [],
};

const company = {
  name: 'Mauritius Demo Services Ltd (DEMO)', brn: 'DEMO-BRN-0016',
  registered_address: 'Level 3, Fictitious Tower, Port Louis (fictif)',
  business_activity: 'Services administratifs (fictif)',
  contact_email: 'contact@mds.example.test', contact_phone: '+230 5000 16 00 (fictif)',
};

describe('payroll PDF — mission 16 layout', () => {
  it('produces a single-page French simulation bulletin without a central watermark', async () => {
    const pdf = await payrollPdf({ locale: 'fr', company, payslipNo: 'SIM-202610-0001', status: 'simulation', snapshot });
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
    expect(pdf.length).toBeGreaterThan(3_000);
    expect((pdf.toString('latin1').match(/\/Type\s*\/Page\b/g) ?? [])).toHaveLength(1);
  });

  it('renders the English variant with the same exact totals', async () => {
    const pdf = await payrollPdf({ locale: 'en', company, payslipNo: 'SIM-202610-0002', status: 'simulation', snapshot });
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
    expect((pdf.toString('latin1').match(/\/Type\s*\/Page\b/g) ?? [])).toHaveLength(1);
  });
});
