/**
 * Browser demonstration of mission 14 payroll preparation.
 *
 * Everything below is fictional. No statutory rate is stored: PAYE, CSG, NSF
 * and employer contributions stay `null`, every calculation is BLOCKED and the
 * only payslip is a simulation. The demo never pretends to be a server.
 */
import { ApiError } from '../errors';
import { scaled4ToString, toScaled4 } from '../format';
import type { DemoState } from './runtime';
import { parseUpload } from '../../../api/src/modules/migration/parse';
import {
  computeCsg, computeCumulativePaye, computeNsf, computePayeWithoutEdf, computeTrainingLevy, percentage,
} from '../../../api/src/modules/payroll/statutory';

const uid = () => crypto.randomUUID();
const now = () => new Date().toISOString();
const DAY = 24*60*60*1000;
const fmt = (v: bigint) => scaled4ToString(v);
const money = (v: unknown): bigint => toScaled4(v as never) ?? 0n;
const roundDiv = (value: bigint, divisor: bigint) => {
  if (divisor === 0n) return 0n;
  const q = value / divisor;
  const r = value % divisor;
  return r * 2n >= divisor ? q + 1n : q;
};
const addDays = (date: string, days: number) =>
  new Date(new Date(`${date}T00:00:00Z`).getTime() + days * DAY).toISOString().slice(0, 10);
const datesBetween = (from: string, to: string) => {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
};

interface DemoEmployee {
  id: string; company_id: string; employee_number: string; employee_ref: string;
  first_name: string; last_name: string; full_name: string; preferred_name: string | null;
  date_of_birth: string | null; nationality: string | null; country_of_residence: string | null;
  address: string | null; email: string | null; phone: string | null;
  employment_status: string; hire_date: string | null; termination_date: string | null;
  department: string | null; job_title: string | null; work_location: string | null;
  manager_employee_id: string | null; cost_centre: string | null; payroll_currency: string;
  payment_method: string | null; bank_name: string | null; bank_account_last4: string | null;
  statutory_id_last4: string | null; statutory_ref_last4: string | null;
  emergency_contact_name: string | null; emergency_contact_phone: string | null;
  emergency_contact_relation: string | null; notes: string | null;
  pay_frequency?: string; worker_type?: string; paye_category?: string; tax_residency?: string;
  is_public_sector?: boolean; is_household_worker?: boolean;
  created_at: string; updated_at: string;
}
interface DemoContract {
  id: string; company_id: string; employee_id: string; contract_type: string; work_pattern: string;
  status: 'active' | 'superseded' | 'terminated'; effective_from: string; effective_to: string | null;
  base_salary: string; salary_period: string; currency: string; weekly_hours: string | null;
  department: string | null; job_title: string | null; work_location: string | null;
  change_reason: string; amendment_of: string | null; created_at: string;
}
interface DemoEvent { id: string; company_id: string; employee_id: string; action: string; reason: string; created_at: string; actor: string }
interface DemoPayItem {
  id: string; company_id: string | null; code: string; label_en: string; label_fr: string;
  category: string; unit: string; calculation_method: string; treatment_status: string;
  effective_from: string; effective_to: string | null; source: string;
}
interface DemoAssignment { id: string; company_id: string; employee_id: string; pay_item_id: string; amount: string; effective_from: string; effective_to: string | null }
interface DemoTime { id: string; company_id: string; employee_id: string; work_date: string; hours_worked: string; overtime_hours: string; lateness_minutes: number; note: string | null; source: string }
interface DemoAbsence {
  id: string; company_id: string; employee_id: string; leave_type: string; start_date: string;
  end_date: string; days: string; status: string; reason: string; decision_reason: string | null;
  document_ref: string | null; created_at: string;
}
interface DemoLeaveRule {
  id: string; company_id: string; leave_type: string; days_per_year: string; accrual_method: string;
  effective_from: string; effective_to: string | null; status: string; source: string | null;
}
interface DemoRule {
  id: string; company_id: string; rule_code: string; name_en: string; name_fr: string;
  legal_source: string | null; source_reference: string | null; effective_from: string | null;
  effective_to: string | null; calculation_basis: string | null; rate: string | null;
  threshold_amount: string | null; cap_amount: string | null; rounding_policy: string | null;
  status: string; required_for_calculation: boolean; version: number; test_cases: unknown[];
  notes: string | null; parameters?: Record<string, unknown>; source_url?: string | null;
  source_fingerprint?: string | null;
}
interface DemoPeriod {
  id: string; company_id: string; period_year: number; period_month: number;
  start_date: string; end_date: string; payment_date: string | null; status: string; version: number;
  calculated_at: string | null;
}
interface DemoVariable {
  id: string; company_id: string; period_id: string; employee_id: string; pay_item_id: string;
  quantity: string; rate: string; amount: string; note: string | null;
  status: 'draft' | 'validated' | 'rejected'; source: string; import_key: string | null; created_at: string;
}
interface DemoLine {
  line_no: number; code: string; label_en: string; label_fr: string; line_type: string;
  quantity: string | null; rate: string | null; amount: string; source: string | null; note: string | null;
}
interface DemoCalculation {
  id: string; company_id: string; period_id: string; employee_id: string; employee_number: string;
  full_name: string; version: number; status: 'blocked' | 'simulated' | 'expert_review_pending' | 'rules_incomplete' | 'approved_for_test'; currency: string;
  contract_id: string | null; base_amount: string; proration_days: string | null; period_days: number;
  earnings: string; gross: string; deductions: string; net_arithmetic: string;
  paye: string | null; csg: string | null; nsf: string | null; employer_contributions: string | null; statutory_complete: boolean;
  taxable_emoluments?: string; basic_wage?: string; paye_basis?: string | null;
  csg_employee?: string | null; csg_employer?: string | null;
  nsf_employee?: string | null; nsf_employer?: string | null;
  training_levy?: string | null; additional_remuneration?: string;
  employer_cost?: string | null; net_after_statutory?: string | null; net_payable?: string | null;
  statutory_status?: string; edf_basis?: string | null; rules_applied?: unknown[]; review_reasons?: unknown[];
  missing_rules: { ruleCode: string; status: string; reason: string }[];
  warnings: { code: string; message: string }[]; input_hash: string; rule_version: string;
  calculated_at: string; lines: DemoLine[]; bankAccountMasked: string | null;
}
interface DemoEdf {
  id: string; company_id: string; employee_id: string; taxYearStart: string;
  declarationDate: string; effectiveFrom: string; dependentCount: number;
  totalReliefs: string; status: 'submitted'; revision: number;
}
interface DemoMraDeclaration {
  id: string; company_id: string; period_id: string; version: number;
  preparedAt: string; preparedBy: string | null; status: string;
  employerIdentifier: string | null; period: any; company: any; currency: string;
  employees: any[]; totals: any; checks: any[]; officialChecks: any[];
  blockers: any[]; warnings: any[]; officialCsv: any;
  internalCsvAvailable: boolean; regulatoryExportBlocked: boolean;
  regulatoryStatus: string; submission: string; employeesActive: number;
  notice: string; noticeEn: string;
}
interface DemoPayslip {
  id: string; company_id: string; calculation_id: string; period_id: string; employee_id: string;
  payslip_no: string; status: 'simulation'; version: number; snapshot: any; generated_at: string;
}

interface DemoPayrollMapping {
  id: string; company_id: string; version: number; status: 'VALIDATED' | 'SUPERSEDED';
  journal_id: string;
  wages_expense_account_id: string;
  employer_csg_expense_account_id: string;
  employer_nsf_expense_account_id: string;
  training_levy_expense_account_id: string;
  paye_payable_account_id: string;
  csg_employee_payable_account_id: string;
  csg_employer_payable_account_id: string;
  nsf_employee_payable_account_id: string;
  nsf_employer_payable_account_id: string;
  training_levy_payable_account_id: string;
  net_payable_account_id: string;
  other_deductions_payable_account_id: string | null;
  reimbursements_account_id: string | null;
  note: string | null; validated_at: string; validated_by_name: string | null;
  superseded_at: string | null;
}

interface DemoAccountingTransfer {
  id: string; company_id: string; period_id: string; version: number;
  status: 'DRAFT' | 'BLOCKED' | 'REVIEW_REQUIRED' | 'APPROVED_FOR_TEST' | 'REJECTED' | 'POSTED';
  mapping_id: string | null; mapping_version: number | null; journal_id: string | null;
  currency: string; calculation_ids: string[]; source_fingerprint: string;
  source_rules: any[]; totals: any; lines: any[]; checks: any[]; blockers: any[];
  warnings: any[]; posting_blockers: any[]; can_post: boolean; note: string | null;
  created_at: string; created_by_name: string | null;
  decided_at: string | null; decided_by_name: string | null;
  decision_note: string | null; rejection_reason: string | null;
  posted_entry_id: string | null; posted_at: string | null;
}

interface DemoPayrollState {
  employees: DemoEmployee[];
  contracts: DemoContract[];
  events: DemoEvent[];
  payItems: DemoPayItem[];
  assignments: DemoAssignment[];
  time: DemoTime[];
  holidays: { id: string; company_id: string; holiday_date: string; name_en: string; name_fr: string; source: string | null }[];
  absences: DemoAbsence[];
  leaveRules: DemoLeaveRule[];
  rules: DemoRule[];
  periods: DemoPeriod[];
  variables: DemoVariable[];
  calculations: DemoCalculation[];
  payslips: DemoPayslip[];
  sequences: Record<string, number>;
  edfDeclarations?: DemoEdf[];
  mraDeclarations?: DemoMraDeclaration[];
  accountMappings?: DemoPayrollMapping[];
  accountingTransfers?: DemoAccountingTransfer[];
}

const people: [string, string, string, string][] = [
  ['A001', 'Aline', 'Fictive', 'Comptable fictive'],
  ['B002', 'Bruno', 'Exemple', 'Technicien fictif'],
  ['C003', 'Chloé', 'Modèle', 'Assistante à temps partiel fictive'],
  ['D004', 'David', 'Test', 'Développeur fictif'],
  ['E005', 'Emma', 'Avenant', 'Analyste fictive'],
  ['F006', 'Farid', 'Absence', 'Chargé de mission fictif'],
  ['G007', 'Gaëlle', 'Heures', 'Opératrice fictive'],
  ['H008', 'Hugo', 'Prime', 'Commercial fictif'],
  ['I009', 'Inès', 'Avance', 'Assistante fictive'],
  ['J010', 'Jean', 'Étranger', 'Consultant fictif (étranger)'],
  ['K011', 'Kavita', 'Échéance', 'Chargée de projet fictive'],
  ['L012', 'Lucas', 'Bloqué', 'Stagiaire fictif'],
  ['M013', 'Mina', 'Partiel', 'Assistante à temps partiel fictive'],
  ['N014', 'Noé', 'Cadre', 'Cadre fictif à haut salaire'],
  ['O015', 'Olga', 'Maison', 'Employée domestique fictive'],
  ['P016', 'Paul', 'Public', 'Agent public fictif'],
  ['Q017', 'Quinn', 'SansDate', 'Salarié fictif sans date de naissance'],
  ['R018', 'Rita', 'Rendement', 'Travailleuse au rendement fictive'],
];

export function seedDemoPayroll(state: DemoState): void {
  const company = state.companies[0];
  if (!company) return;
  const companyId = company.id;
  if ((state as any).payroll) return;
  const created = now();
  const employees: DemoEmployee[] = people.map(([number, first, last, job], index) => ({
    id: uid(), company_id: companyId, employee_number: number, employee_ref: number,
    first_name: first, last_name: last, full_name: `${first} ${last}`, preferred_name: null,
    date_of_birth: number === 'Q017' ? null : `199${index % 9}-0${(index % 9) + 1}-1${index % 9}`,
    nationality: number === 'J010' ? 'French' : 'Mauritian',
    country_of_residence: 'Mauritius',
    address: `${index + 1}, Rue Fictive, Port Louis (fictif)`,
    email: `${number.toLowerCase()}@demo-fictif.test`, phone: '+230 5000 00 00',
    employment_status: 'active', hire_date: number === 'D004' ? '2026-01-16' : '2024-01-15',
    termination_date: null, department: index % 3 === 0 ? 'Administration' : 'Opérations',
    job_title: job, work_location: 'Port Louis', manager_employee_id: null,
    cost_centre: `CC-DEMO-${index + 1}`, payroll_currency: 'MUR',
    payment_method: 'bank_transfer', bank_name: 'Banque Fictive de Démonstration',
    bank_account_last4: String(4000 + index), statutory_id_last4: number === 'J010' ? '9010' : '7000',
    statutory_ref_last4: `00${index}`, emergency_contact_name: 'Contact fictif',
    emergency_contact_phone: '+230 5000 00 01', emergency_contact_relation: 'Famille (fictif)',
    notes: 'Dossier de démonstration entièrement fictif',
    pay_frequency: 'monthly',
    worker_type: number === 'B002' || number === 'C003' || number === 'M013' ? 'part_time'
      : number === 'R018' ? 'piece_rate' : 'full_time',
    paye_category: 'standard', tax_residency: 'resident',
    is_public_sector: number === 'P016', is_household_worker: number === 'O015',
    created_at: created, updated_at: created,
  }));
  const byNumber = new Map(employees.map((e) => [e.employee_number, e]));
  const contractSeed: [string, number, string, string, string, string | null][] = [
    ['A001', 30000, 'monthly', 'permanent', '2024-01-15', null],
    ['B002', 250, 'hourly', 'permanent', '2024-01-15', null],
    ['C003', 12000, 'monthly', 'permanent', '2024-01-15', null],
    ['D004', 30000, 'monthly', 'permanent', '2026-01-16', null],
    ['E005', 20000, 'monthly', 'permanent', '2024-01-15', '2026-01-15'],
    ['F006', 18000, 'monthly', 'permanent', '2024-01-15', null],
    ['G007', 22000, 'monthly', 'permanent', '2024-01-15', null],
    ['H008', 26000, 'monthly', 'permanent', '2024-01-15', null],
    ['I009', 24000, 'monthly', 'permanent', '2024-01-15', null],
    ['J010', 28000, 'monthly', 'permanent', '2024-01-15', null],
    ['K011', 21000, 'monthly', 'fixed_term', '2024-01-15', '2026-12-31'],
    ['L012', 20000, 'monthly', 'permanent', '2026-01-01', null],
    ['M013', 12000, 'monthly', 'permanent', '2024-01-15', null],
    ['N014', 600000, 'monthly', 'permanent', '2024-01-15', null],
    ['O015', 3000, 'monthly', 'permanent', '2024-01-15', null],
    ['P016', 25000, 'monthly', 'permanent', '2024-01-15', null],
    ['Q017', 35000, 'monthly', 'permanent', '2024-01-15', null],
    ['R018', 18000, 'monthly', 'permanent', '2024-01-15', null],
  ];
  const contracts: DemoContract[] = contractSeed.map(([number, salary, period, type, from, to]) => ({
    id: uid(), company_id: companyId, employee_id: byNumber.get(number)!.id,
    contract_type: type, work_pattern: number === 'B002' || number === 'C003' || number === 'M013' ? 'part_time' : 'full_time',
    status: to === '2026-01-15' ? 'superseded' : 'active', effective_from: from, effective_to: to,
    base_salary: `${salary}.0000`, salary_period: period, currency: 'MUR',
    weekly_hours: period === 'hourly' ? '20.00' : '40.00',
    department: byNumber.get(number)!.department, job_title: byNumber.get(number)!.job_title,
    work_location: 'Port Louis', change_reason: 'Contrat initial fictif de démonstration',
    amendment_of: null, created_at: created,
  }));
  // E - dated amendment from 16 July 2026.
  contracts.push({
    id: uid(), company_id: companyId, employee_id: byNumber.get('E005')!.id,
    contract_type: 'permanent', work_pattern: 'full_time', status: 'active',
    effective_from: '2026-01-16', effective_to: null, base_salary: '24000.0000',
    salary_period: 'monthly', currency: 'MUR', weekly_hours: '40.00',
    department: 'Opérations', job_title: 'Analyste fictive', work_location: 'Port Louis',
    change_reason: 'Avenant fictif daté : 20 000 → 24 000', amendment_of: null, created_at: created,
  });
  const payItems: DemoPayItem[] = [
    { id: uid(), company_id: null, code: 'PRIME_DEMO', label_en: 'Fictional bonus', label_fr: 'Prime fictive', category: 'earning', unit: 'money', calculation_method: 'fixed', treatment_status: 'UNVERIFIED', effective_from: '2026-01-01', effective_to: null, source: 'Paramétrage fictif de démonstration' },
    { id: uid(), company_id: null, code: 'IND_DEMO', label_en: 'Fictional allowance', label_fr: 'Indemnité fictive', category: 'earning', unit: 'money', calculation_method: 'fixed', treatment_status: 'UNVERIFIED', effective_from: '2026-01-01', effective_to: null, source: 'Paramétrage fictif de démonstration' },
    { id: uid(), company_id: null, code: 'AVANCE_DEMO', label_en: 'Fictional advance', label_fr: 'Avance fictive', category: 'advance', unit: 'money', calculation_method: 'fixed', treatment_status: 'UNVERIFIED', effective_from: '2026-01-01', effective_to: null, source: 'Paramétrage fictif de démonstration' },
    { id: uid(), company_id: null, code: 'FRAIS_DEMO', label_en: 'Fictional reimbursement', label_fr: 'Remboursement fictif', category: 'reimbursement', unit: 'money', calculation_method: 'fixed', treatment_status: 'UNVERIFIED', effective_from: '2026-01-01', effective_to: null, source: 'Paramétrage fictif de démonstration' },
  ];
  const item = (code: string) => payItems.find((i) => i.code === code)!;
  const period: DemoPeriod = {
    id: uid(), company_id: companyId, period_year: 2026, period_month: 1,
    start_date: '2026-01-01', end_date: '2026-01-31', payment_date: '2026-01-31',
    status: 'data_collection', version: 1, calculated_at: null,
  };
  const time: DemoTime[] = [
    { id: uid(), company_id: companyId, employee_id: byNumber.get('B002')!.id, work_date: '2026-01-06', hours_worked: '8.00', overtime_hours: '2.00', lateness_minutes: 0, note: 'Heures fictives, majoration non paramétrée', source: 'manual' },
    { id: uid(), company_id: companyId, employee_id: byNumber.get('B002')!.id, work_date: '2026-01-07', hours_worked: '8.00', overtime_hours: '0.00', lateness_minutes: 10, note: 'Retard fictif', source: 'manual' },
  ];
  const absences: DemoAbsence[] = [{
    id: uid(), company_id: companyId, employee_id: byNumber.get('F006')!.id,
    leave_type: 'unpaid', start_date: '2026-01-20', end_date: '2026-01-22', days: '3.00',
    status: 'approved', reason: 'Absence non rémunérée fictive', decision_reason: 'Validation fictive de démonstration',
    document_ref: 'FICT-DOC-001', created_at: created,
  }];
  const rules: DemoRule[] = [
    ['PAYE', 'PAYE — progressive cumulative bands', 'PAYE — bandes cumulatives', '20', 'https://www.mra.mu/download/PayeGuide.pdf', 'MRA PAYE Guide Dec 2025 §2'],
    ['PAYE_NO_EDF', 'PAYE — flat 15% without EDF', 'PAYE — forfait 15 % sans EDF', '15', 'https://www.mra.mu/download/PayeGuide.pdf', 'MRA PAYE Guide Dec 2025 §5.9.1'],
    ['CSG_PRIVATE', 'CSG — private-sector rates', 'CSG — taux du secteur privé', '6', 'https://mra.mu/index.php/business/csg', 'MRA CSG page — rate table'],
    ['NSF_RATES', 'NSF contribution rates', 'NSF — taux de cotisation', '2.5', 'https://www.mra.mu/employers/npf-nsf-contributions', 'MRA NPF/NSF page §2'],
    ['NSF_LIMITS', 'NSF dated minimum and maximum', 'NSF — minimum et maximum datés', null, 'https://www.mra.mu/employers/npf-nsf-contributions', 'MRA NPF/NSF page — table 1 July 2026'],
    ['TRAINING_LEVY', 'HRDC Training Levy', 'Levy de formation HRDC', '1.5', 'https://www.mra.mu/employers/npf-nsf-contributions', 'MRA NPF/NSF page §3'],
    ['ADDITIONAL_REMUNERATION', 'Additional Remuneration 2026', 'Rémunération additionnelle 2026', '635', 'https://www.mra.mu/download/GN15WRA.pdf', 'GN No. 7 of 2026, effective 1 January 2026'],
  ].map(([code, en, fr, rate, url, ref]) => ({
    id: uid(), company_id: companyId, rule_code: code as string,
    name_en: en as string, name_fr: fr as string,
    legal_source: 'Mauritius Revenue Authority / Government Gazette (official)',
    source_reference: ref as string, source_url: url as string,
    effective_from: code === 'ADDITIONAL_REMUNERATION' ? '2026-01-01' : code === 'NSF_LIMITS' ? '2026-07-01' : '2025-07-01',
    effective_to: null, calculation_basis: 'basic wage / taxable emoluments',
    rate: rate as string | null, threshold_amount: code === 'PAYE_NO_EDF' ? '38462' : code === 'CSG_PRIVATE' ? '50000' : null,
    cap_amount: null, rounding_policy: 'PAYE rounded down to the rupee; CSG/NSF/levy exact to 4 decimals',
    status: 'RESEARCHED', required_for_calculation: code !== 'ADDITIONAL_REMUNERATION',
    version: 1, test_cases: [], parameters: {}, source_fingerprint: 'demo-fingerprint',
    notes: 'Sourced but not expert-approved. Demonstration only.',
  }));
  const variables: DemoVariable[] = [
    { id: uid(), company_id: companyId, period_id: period.id, employee_id: byNumber.get('H008')!.id, pay_item_id: item('PRIME_DEMO').id, quantity: '1.0000', rate: '0.0000', amount: '5000.0000', note: 'Prime variable fictive validée', status: 'validated', source: 'manual', import_key: null, created_at: created },
    { id: uid(), company_id: companyId, period_id: period.id, employee_id: byNumber.get('I009')!.id, pay_item_id: item('AVANCE_DEMO').id, quantity: '1.0000', rate: '0.0000', amount: '2000.0000', note: 'Avance fictive validée', status: 'validated', source: 'manual', import_key: null, created_at: created },
    { id: uid(), company_id: companyId, period_id: period.id, employee_id: byNumber.get('A001')!.id, pay_item_id: item('FRAIS_DEMO').id, quantity: '1.0000', rate: '0.0000', amount: '1200.0000', note: 'Remboursement fictif en attente de validation', status: 'draft', source: 'manual', import_key: null, created_at: created },
  ];
  const assignments: DemoAssignment[] = [{
    id: uid(), company_id: companyId, employee_id: byNumber.get('H008')!.id,
    pay_item_id: item('IND_DEMO').id, amount: '1500.0000', effective_from: '2026-01-01', effective_to: null,
  }];
  const demo: DemoPayrollState = {
    employees, contracts, events: [], payItems, assignments, time, holidays: [], absences, leaveRules: [],
    rules, periods: [period], variables, calculations: [], payslips: [], sequences: {},
    mraDeclarations: [], accountMappings: [], accountingTransfers: [],
  };
  demo.calculations = calculate(demo, companyId, period);
  demo.payslips = [payslipFor(demo, demo.calculations.find((c) => c.employee_number === 'A001')!, company)];
  demo.periods[0]!.status = demo.calculations.some((c) => c.status === 'rules_incomplete') ? 'blocked' : 'calculated';
  demo.edfDeclarations = [];
  (state as any).payroll = demo;
  seedDemoPayrollAccounting(state, companyId, {
    wages: '6000', employer: '6010', paye: '2300', social: '2400',
    net: '2100', other: '2100', reimbursements: '1150',
  });
  seedMission16Payroll(state);
}

/**
 * Mission 16 October 2026 scenario on a dedicated fictional company.
 * Daniel Morel is hired on 1 October 2026, files a zero-dependant EDF and is
 * paid Rs 30,000. The 2026/27 PAYE bands come from Finance Act 2026 and the
 * official MRA EDF 2026/2027. The scenario stays a simulation.
 */
export function seedMission16Payroll(state: DemoState): void {
  const payroll = (state as any).payroll as DemoPayrollState | undefined;
  if (!payroll) return;
  const company = state.companies.find((c) => /Mauritius Demo Services/i.test(c.name));
  if (!company || payroll.employees.some((e) => e.company_id === company.id)) return;
  const created = now();
  const period: DemoPeriod = {
    id: uid(), company_id: company.id, period_year: 2026, period_month: 10,
    start_date: '2026-10-01', end_date: '2026-10-31', payment_date: '2026-10-31',
    status: 'data_collection', version: 1, calculated_at: null,
  };
  const employee: DemoEmployee = {
    id: uid(), company_id: company.id, employee_number: 'MDS001', employee_ref: 'MDS001',
    first_name: 'Daniel', last_name: 'Morel', full_name: 'Daniel Morel', preferred_name: null,
    date_of_birth: '1988-04-12', nationality: 'Mauritian', country_of_residence: 'Mauritius',
    address: '1, Rue Fictive, Port Louis (fictif)', email: 'daniel.morel@demo-fictif.test',
    phone: '+230 5000 16 16', employment_status: 'active', hire_date: '2026-10-01',
    termination_date: null, department: 'Administration', job_title: 'Administrative officer (fictif)',
    work_location: 'Port Louis', manager_employee_id: null, cost_centre: 'CC-MDS-01',
    payroll_currency: 'MUR', payment_method: 'bank_transfer',
    bank_name: 'Banque Fictive de Démonstration', bank_account_last4: '1601',
    statutory_id_last4: '1601', statutory_ref_last4: '0016',
    emergency_contact_name: 'Contact fictif', emergency_contact_phone: '+230 5000 16 17',
    emergency_contact_relation: 'Famille (fictif)',
    notes: 'Scénario fictif Mission 16 — octobre 2026',
    pay_frequency: 'monthly', worker_type: 'full_time', paye_category: 'standard',
    tax_residency: 'resident', is_public_sector: false, is_household_worker: false,
    created_at: created, updated_at: created,
  };
  const contract: DemoContract = {
    id: uid(), company_id: company.id, employee_id: employee.id,
    contract_type: 'permanent', work_pattern: 'full_time', status: 'active',
    effective_from: '2026-10-01', effective_to: null, base_salary: '30000.0000',
    salary_period: 'monthly', currency: 'MUR', weekly_hours: '40.00',
    department: 'Administration', job_title: 'Administrative officer (fictif)',
    work_location: 'Port Louis', change_reason: 'Contrat permanent fictif — Mission 16',
    amendment_of: null, created_at: created,
  };
  const ruleBase = {
    company_id: company.id, legal_source: 'Official Mauritius source (recorded below)',
    effective_to: null as string | null, calculation_basis: 'basic wage / taxable emoluments',
    cap_amount: null as string | null, status: 'RESEARCHED',
    required_for_calculation: true, version: 1, test_cases: [] as unknown[],
    source_fingerprint: 'demo-fingerprint-mission16',
    notes: 'Sourced but not expert-approved. Demonstration only.',
  };
  const rules: DemoRule[] = [
    {
      ...ruleBase, id: uid(), rule_code: 'PAYE',
      name_en: 'PAYE cumulative bands 2026/27', name_fr: 'PAYE — bandes cumulatives 2026/27',
      source_reference: 'Finance Act 2026 s.7; MRA EDF 2026/27 note 2',
      source_url: 'https://www.mra.mu/download/FinanceAct2026.pdf',
      effective_from: '2026-07-01', effective_to: '2027-06-30',
      rate: '35', threshold_amount: '500000', rounding_policy: 'Cumulative tax rounded down to the rupee',
      parameters: {
        bands: [
          { upto: '500000', rate: '0' }, { upto: '1000000', rate: '10' },
          { upto: '12000000', rate: '20' }, { upto: null, rate: '35' },
        ],
        fscApplicable: false, monthlyWithholdingTableVerified: false,
      },
    },
    {
      ...ruleBase, id: uid(), rule_code: 'CSG_PRIVATE',
      name_en: 'CSG — private-sector rates', name_fr: 'CSG — taux du secteur privé',
      source_reference: 'MRA CSG page — rate table', source_url: 'https://mra.mu/index.php/business/csg',
      effective_from: '2021-09-01', rate: '6', threshold_amount: '50000',
      rounding_policy: 'No statutory rounding rule found; exact to 4 decimals',
      parameters: { lowEmployeeRate: '1.5', lowEmployerRate: '3', highEmployeeRate: '3', highEmployerRate: '6' },
    },
    {
      ...ruleBase, id: uid(), rule_code: 'NSF_RATES',
      name_en: 'NSF contribution rates', name_fr: 'NSF — taux de cotisation',
      source_reference: 'MRA NPF/NSF page §2', source_url: 'https://www.mra.mu/employers/npf-nsf-contributions',
      effective_from: '2021-09-01', rate: '2.5', threshold_amount: null,
      rounding_policy: 'No statutory rounding rule found; exact to 4 decimals',
      parameters: { employeeRate: '1', employerRate: '2.5' },
    },
    {
      ...ruleBase, id: uid(), rule_code: 'NSF_LIMITS',
      name_en: 'NSF dated minimum and maximum', name_fr: 'NSF — minimum et maximum datés',
      source_reference: 'MRA NPF/NSF page — table 1 July 2026',
      source_url: 'https://www.mra.mu/employers/npf-nsf-contributions',
      effective_from: '2026-07-01', rate: null, threshold_amount: null,
      rounding_policy: 'Assessable wage table, no rounding',
      parameters: { limitsByFrequency: {
        monthly: { minHousehold: '2910', minOther: '4580', max: '29710' },
      } },
    },
    {
      ...ruleBase, id: uid(), rule_code: 'TRAINING_LEVY',
      name_en: 'HRDC Training Levy', name_fr: 'Levy de formation HRDC',
      source_reference: 'MRA NPF/NSF page §3', source_url: 'https://www.mra.mu/employers/npf-nsf-contributions',
      effective_from: '2021-07-01', rate: '1.5', threshold_amount: null,
      rounding_policy: 'No statutory rounding rule found; exact to 4 decimals', parameters: {},
    },
    {
      ...ruleBase, id: uid(), rule_code: 'ADDITIONAL_REMUNERATION', required_for_calculation: false,
      name_en: 'Additional Remuneration 2026', name_fr: 'Rémunération additionnelle 2026',
      source_reference: 'GN No. 7 of 2026, effective 1 January 2026',
      source_url: 'https://www.mra.mu/download/GN15WRA.pdf',
      effective_from: '2026-01-01', effective_to: '2026-12-31', rate: '635', threshold_amount: '17110',
      rounding_policy: 'Full-time Rs 635; part-time 3.7% rounded up; capped at Rs 635',
      parameters: { fullTimeAmount: '635', globalThreshold: '50000', partTimeThreshold: '17110', partTimeRate: '3.7', maximum: '635' },
    },
  ];
  payroll.employees.push(employee);
  payroll.contracts.push(contract);
  payroll.rules.push(...rules);
  payroll.periods.unshift(period);
  payroll.edfDeclarations = [
    ...(payroll.edfDeclarations ?? []),
    {
      id: uid(), company_id: company.id, employee_id: employee.id,
      taxYearStart: '2026-07-01', declarationDate: '2026-09-30', effectiveFrom: '2026-10-01',
      dependentCount: 0, totalReliefs: '0.0000', status: 'submitted', revision: 1,
    },
  ];
  const calculated = calculate(payroll, company.id, period);
  payroll.calculations.push(...calculated);
  const daniel = calculated.find((c) => c.employee_number === 'MDS001');
  if (daniel) payroll.payslips.push(payslipFor(payroll, daniel, company));
  period.status = calculated.some((c) => c.status === 'rules_incomplete') ? 'blocked' : 'calculated';
  if (!state.periods.some((p) => p.company_id === company.id && p.start_date <= '2026-10-31' && p.end_date >= '2026-10-31')) {
    state.periods.push({
      id: uid(), company_id: company.id, name: 'FY 2026/2027 (fictitious)',
      start_date: '2026-07-01', end_date: '2027-06-30', status: 'open',
    });
  }
  seedDemoPayrollAccounting(state, company.id, {
    wages: '6020', employer: '6030', paye: '2220', social: '2230',
    net: '2210', other: '2210', reimbursements: '6020',
  });
}

function periodBounds(year: number, month: number) {
  return {
    start: new Date(Date.UTC(year, month - 1, 1)).toISOString().slice(0, 10),
    end: new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10),
  };
}

function employeeView(e: DemoEmployee) {
  return {
    ...e, bankAccountMasked: e.bank_account_last4 ? `•••• ${e.bank_account_last4}` : null,
    statutoryIdMasked: e.statutory_id_last4 ? `•••• ${e.statutory_id_last4}` : null,
    statutoryRefMasked: e.statutory_ref_last4 ? `•••• ${e.statutory_ref_last4}` : null,
    hasBankDetails: Boolean(e.bank_account_last4), hasStatutoryId: Boolean(e.statutory_id_last4),
  };
}

function periodView(p: DemoPeriod) {
  return { ...p, calculation_count: 0, payslip_count: 0 };
}

function calculate(payroll: DemoPayrollState, companyId: string, period: DemoPeriod): DemoCalculation[] {
  const missing = payroll.rules
    .filter((r) => r.required_for_calculation && !['RESEARCHED', 'REVIEW_REQUIRED', 'EXPERT_VALIDATED'].includes(r.status))
    .map((r) => ({ ruleCode: r.rule_code, status: r.status, reason: 'NOT_SOURCE_VERIFIED' }));
  const allDays = datesBetween(period.start_date, period.end_date);
  return payroll.employees.filter((e) => e.company_id === companyId && e.employment_status !== 'terminated').map((employee) => {
    const contracts = payroll.contracts.filter((c) => c.employee_id === employee.id && c.effective_from <= period.end_date && (!c.effective_to || c.effective_to >= period.start_date));
    const active = allDays.filter((d) => (!employee.hire_date || d >= employee.hire_date) && (!employee.termination_date || d <= employee.termination_date) && contracts.some((c) => c.effective_from <= d && (!c.effective_to || c.effective_to >= d)));
    const currency = contracts[0]?.currency ?? employee.payroll_currency;
    const lines: DemoLine[] = [];
    let base = 0n;
    let lineNo = 1;
    for (const contract of contracts) {
      const days = active.filter((d) => contract.effective_from <= d && (!contract.effective_to || contract.effective_to >= d)).length;
      if (!days) continue;
      const salary = money(contract.base_salary);
      let amount = 0n;
      if (contract.salary_period === 'monthly') {
        amount = days === allDays.length ? salary : roundDiv(salary * BigInt(days), BigInt(allDays.length));
        base += amount;
        lines.push({ line_no: lineNo++, code: 'BASE', label_en: 'Contractual salary', label_fr: 'Salaire contractuel', line_type: 'base', quantity: `${days}.0000`, rate: fmt(salary), amount: fmt(amount), source: 'contract', note: days === allDays.length ? null : `${days} jours actifs sur ${allDays.length}` });
      } else if (contract.salary_period === 'daily') {
        amount = salary * BigInt(days); base += amount;
        lines.push({ line_no: lineNo++, code: 'BASE', label_en: 'Daily wage', label_fr: 'Salaire journalier', line_type: 'base', quantity: `${days}.0000`, rate: fmt(salary), amount: fmt(amount), source: 'contract', note: null });
      }
    }
    const hourly = contracts.find((c) => c.salary_period === 'hourly');
    const warnings: { code: string; message: string }[] = [];
    if (hourly) {
      const entries = payroll.time.filter((t) => t.employee_id === employee.id && t.work_date >= period.start_date && t.work_date <= period.end_date);
      const hours = entries.reduce((sum, t) => sum + money(t.hours_worked), 0n);
      base = roundDiv(hours * money(hourly.base_salary), 10_000n);
      lines.push({ line_no: lineNo++, code: 'BASE', label_en: 'Hours worked', label_fr: 'Heures travaillées', line_type: 'base', quantity: fmt(hours), rate: fmt(money(hourly.base_salary)), amount: fmt(base), source: 'time_entries', note: null });
      const overtime = entries.reduce((sum, t) => sum + money(t.overtime_hours), 0n);
      if (overtime > 0n) warnings.push({ code: 'OVERTIME_PREMIUM_NOT_CONFIGURED', message: 'Heures supplémentaires saisies : aucune majoration légale configurée, elles ne sont pas valorisées.' });
    } else {
      const overtime = payroll.time.filter((t) => t.employee_id === employee.id && t.work_date >= period.start_date && t.work_date <= period.end_date).reduce((sum, t) => sum + money(t.overtime_hours), 0n);
      if (overtime > 0n) warnings.push({ code: 'OVERTIME_PREMIUM_NOT_CONFIGURED', message: 'Heures supplémentaires saisies : aucune base horaire ni majoration configurée.' });
    }
    let earnings = 0n;
    let deductions = 0n;
    let reimbursements = 0n;
    for (const assignment of payroll.assignments.filter((a) => a.employee_id === employee.id)) {
      const item = payroll.payItems.find((i) => i.id === assignment.pay_item_id);
      if (!item) continue;
      const amount = money(assignment.amount);
      if (item.category === 'earning') earnings += amount;
      else if (item.category === 'reimbursement') reimbursements += amount;
      else deductions += amount;
      lines.push({ line_no: lineNo++, code: item.code, label_en: item.label_en, label_fr: item.label_fr, line_type: item.category === 'earning' ? 'earning' : item.category === 'reimbursement' ? 'reimbursement' : item.category === 'advance' ? 'advance' : 'deduction', quantity: null, rate: null, amount: fmt(amount), source: 'employee_pay_item', note: null });
    }
    for (const variable of payroll.variables.filter((v) => v.employee_id === employee.id && v.period_id === period.id && v.status === 'validated')) {
      const item = payroll.payItems.find((i) => i.id === variable.pay_item_id);
      if (!item) continue;
      const amount = money(variable.amount);
      if (item.category === 'earning') earnings += amount;
      else if (item.category === 'reimbursement') reimbursements += amount;
      else deductions += amount;
      lines.push({ line_no: lineNo++, code: item.code, label_en: item.label_en, label_fr: item.label_fr, line_type: item.category === 'earning' ? 'earning' : item.category === 'reimbursement' ? 'reimbursement' : item.category === 'advance' ? 'advance' : 'deduction', quantity: variable.quantity, rate: variable.rate, amount: fmt(amount), source: 'variable', note: variable.note });
    }
    for (const absence of payroll.absences.filter((a) => a.employee_id === employee.id && a.status === 'approved' && a.start_date <= period.end_date && a.end_date >= period.start_date)) {
      warnings.push({ code: absence.leave_type === 'unpaid' ? 'UNPAID_LEAVE_NOT_VALUED' : 'LEAVE_NOT_VALUED', message: `${absence.days} jour(s) de congé ${absence.leave_type} validé(s) ; aucun impact légal n’est paramétré.` });
    }
    let additionalRemuneration = 0n;
    if (period.end_date >= '2026-01-01' && employee.worker_type !== 'piece_rate' && base <= money('50000')!) {
      additionalRemuneration = employee.worker_type === 'part_time'
        ? (base < money('17110')! ? (percentage(base, '3.7') > money('635')! ? money('635')! : ((percentage(base, '3.7') + 9999n) / 10000n) * 10000n) : money('635')!)
        : money('635')!;
    }
    if (additionalRemuneration > 0n) {
      earnings += additionalRemuneration;
      lines.push({ line_no: lineNo++, code: 'AR2026', label_en: 'Additional Remuneration 2026', label_fr: 'Rémunération additionnelle 2026', line_type: 'earning', quantity: null, rate: null, amount: fmt(additionalRemuneration), source: 'statutory_rule', note: 'GN No. 7 of 2026 — sourced, not expert-approved.' });
    }
    const basicWage = base + additionalRemuneration;
    const gross = base + earnings;
    const net = gross + reimbursements - deductions;
    const employeeMissing = [...missing];
    if (!employee.date_of_birth) employeeMissing.push({ ruleCode: 'NSF_AGE', status: 'MISSING', reason: 'DATE_OF_BIRTH_REQUIRED' });
    if (employee.is_public_sector) employeeMissing.push({ ruleCode: 'CSG_PUBLIC_SECTOR', status: 'MISSING', reason: 'PUBLIC_SECTOR_CSG_NOT_IMPLEMENTED' });
    let paye: bigint | null = null;
    let csgEmployee: bigint | null = null;
    let csgEmployer: bigint | null = null;
    let nsfEmployee: bigint | null = null;
    let nsfEmployer: bigint | null = null;
    let trainingLevy: bigint | null = null;
    let payeBasis = 'NO_EDF_FLAT_15';
    if (employeeMissing.length === 0) {
      const effective = (code: string) => payroll.rules
        .filter((r) => r.company_id === companyId && r.rule_code === code &&
          (!r.effective_from || r.effective_from <= period.end_date) &&
          (!r.effective_to || r.effective_to >= period.end_date))
        .sort((a, b) => b.version - a.version)[0];
      const payeRule = effective('PAYE');
      const noEdf = effective('PAYE_NO_EDF');
      const csgRule = effective('CSG_PRIVATE');
      const levyRule = effective('TRAINING_LEVY');
      const edf = (payroll.edfDeclarations ?? []).find((d) => d.company_id === companyId &&
        d.employee_id === employee.id && d.taxYearStart <= period.start_date &&
        d.effectiveFrom <= period.end_date && d.status === 'submitted');
      if (edf && payeRule?.parameters?.bands) {
        const taxYearStart = period.start_date.slice(5) >= '07-01'
          ? `${period.start_date.slice(0, 4)}-07-01`
          : `${Number(period.start_date.slice(0, 4)) - 1}-07-01`;
        const prior = payroll.calculations.filter((c) => c.company_id === companyId &&
          c.employee_id === employee.id && c.period_id !== period.id &&
          (payroll.periods.find((p) => p.id === c.period_id)?.end_date ?? '') >= taxYearStart &&
          (payroll.periods.find((p) => p.id === c.period_id)?.end_date ?? '') < period.start_date &&
          c.status !== 'rules_incomplete');
        const priorGross = prior.reduce((sum, c) => sum + money(c.gross), 0n);
        const previousWithheld = prior.reduce((sum, c) => sum + money(c.paye), 0n);
        const [sy = 0, sm = 1] = taxYearStart.slice(0, 7).split('-').map(Number);
        const [ey = 0, em = 1] = period.end_date.slice(0, 7).split('-').map(Number);
        const periodsElapsed = Math.max(1, (ey - sy) * 12 + (em - sm) + 1);
        const cumulativeReliefs = roundDiv(money(edf.totalReliefs), 13n) * BigInt(periodsElapsed);
        const result = computeCumulativePaye({
          cumulativeEmoluments: priorGross + gross,
          cumulativeReliefs,
          periodsElapsed,
          previousWithheld,
          bands: payeRule.parameters.bands as any,
        });
        paye = result.value.currentPaye;
        payeBasis = 'EDF_CUMULATIVE';
      } else if (noEdf) {
        paye = computePayeWithoutEdf({ periodEmoluments: gross, threshold: noEdf.threshold_amount ?? '38462', rate: noEdf.rate ?? '15' }).value;
      } else {
        employeeMissing.push({ ruleCode: 'PAYE_NO_EDF', status: 'MISSING', reason: 'NO_EDF_RULE_NOT_VERIFIED_FOR_PERIOD' });
      }
      const csg = computeCsg({
        amount: basicWage, threshold: csgRule?.threshold_amount ?? '50000',
        lowEmployeeRate: '1.5', lowEmployerRate: '3', highEmployeeRate: '3', highEmployerRate: '6',
      }).value;
      csgEmployee = csg.employee; csgEmployer = csg.employer;
      const nsf = computeNsf({
        basicWage, frequency: 'monthly',
        limits: { minHousehold: '2910', minOther: '4580', max: '29710' },
        household: Boolean(employee.is_household_worker), employeeRate: '1', employerRate: '2.5',
      }).value;
      nsfEmployee = nsf.employee; nsfEmployer = nsf.employer;
      trainingLevy = computeTrainingLevy({ basicWage, rate: levyRule?.rate ?? '1.5', exempt: false }).value;
      if (paye !== null) {
        lines.push({ line_no: lineNo++, code: 'PAYE', label_en: 'PAYE withheld', label_fr: 'PAYE retenu', line_type: 'deduction', quantity: null, rate: null, amount: fmt(paye), source: 'statutory_rule', note: payeBasis === 'EDF_CUMULATIVE' ? 'Cumulative bands 2026/27, EDF reliefs applied.' : 'Flat 15% — no EDF in the demo.' });
      }
      if (csgEmployee > 0n) lines.push({ line_no: lineNo++, code: 'CSG_EE', label_en: 'CSG employee', label_fr: 'CSG salarié', line_type: 'deduction', quantity: null, rate: null, amount: fmt(csgEmployee), source: 'statutory_rule', note: null });
      if (nsfEmployee > 0n) lines.push({ line_no: lineNo++, code: 'NSF_EE', label_en: 'NSF employee', label_fr: 'NSF salarié', line_type: 'deduction', quantity: null, rate: null, amount: fmt(nsfEmployee), source: 'statutory_rule', note: null });
      if (csgEmployer > 0n) lines.push({ line_no: lineNo++, code: 'CSG_ER', label_en: 'CSG employer', label_fr: 'CSG employeur', line_type: 'employer', quantity: null, rate: null, amount: fmt(csgEmployer), source: 'statutory_rule', note: null });
      if (nsfEmployer > 0n) lines.push({ line_no: lineNo++, code: 'NSF_ER', label_en: 'NSF employer', label_fr: 'NSF employeur', line_type: 'employer', quantity: null, rate: null, amount: fmt(nsfEmployer), source: 'statutory_rule', note: null });
      if (trainingLevy > 0n) lines.push({ line_no: lineNo++, code: 'TRAINING_LEVY', label_en: 'HRDC Training Levy', label_fr: 'Levy de formation HRDC', line_type: 'employer', quantity: null, rate: null, amount: fmt(trainingLevy), source: 'statutory_rule', note: null });
    }
    const blocked = employeeMissing.length > 0;
    const netAfterStatutory = blocked ? null : net - (paye ?? 0n) - (csgEmployee ?? 0n) - (nsfEmployee ?? 0n);
    const employerContributions = (csgEmployer ?? 0n) + (nsfEmployer ?? 0n) + (trainingLevy ?? 0n);
    const rulesApplied = payroll.rules.filter((r) => r.company_id === companyId).map((r) => ({ ruleCode: r.rule_code, version: r.version, status: r.status, effectiveFrom: r.effective_from, sourceUrl: r.source_url ?? null }));
    return {
      id: uid(), company_id: companyId, period_id: period.id, employee_id: employee.id,
      employee_number: employee.employee_number, full_name: employee.full_name, version: 1,
      status: blocked ? 'rules_incomplete' : 'expert_review_pending', currency, contract_id: contracts[0]?.id ?? null,
      base_amount: fmt(base), proration_days: active.length === allDays.length ? null : `${active.length}.0000`,
      period_days: allDays.length, earnings: fmt(earnings), gross: fmt(gross), deductions: fmt(deductions),
      net_arithmetic: fmt(net), paye: blocked ? null : fmt(paye ?? 0n), csg: blocked ? null : fmt(csgEmployee ?? 0n),
      nsf: blocked ? null : fmt(nsfEmployee ?? 0n), employer_contributions: blocked ? null : fmt(employerContributions),
      statutory_complete: false, taxable_emoluments: fmt(gross), basic_wage: fmt(basicWage),
      paye_basis: blocked ? null : payeBasis, csg_employee: blocked ? null : fmt(csgEmployee ?? 0n),
      csg_employer: blocked ? null : fmt(csgEmployer ?? 0n), nsf_employee: blocked ? null : fmt(nsfEmployee ?? 0n),
      nsf_employer: blocked ? null : fmt(nsfEmployer ?? 0n), training_levy: blocked ? null : fmt(trainingLevy ?? 0n),
      additional_remuneration: fmt(additionalRemuneration), employer_cost: blocked ? null : fmt(gross + reimbursements + employerContributions),
      net_after_statutory: netAfterStatutory === null ? null : fmt(netAfterStatutory), net_payable: null,
      statutory_status: blocked ? 'RULES_INCOMPLETE' : 'EXPERT_REVIEW_PENDING', edf_basis: payeBasis === 'EDF_CUMULATIVE' ? 'EDF_CUMULATIVE' : 'NO_EDF',
      rules_applied: rulesApplied, review_reasons: [],
      missing_rules: employeeMissing, warnings, input_hash: `demo-${Date.now()}-${employee.id}`,
      rule_version: 'rules:RESEARCHED;engine=mission15-demo', calculated_at: now(), lines,
      bankAccountMasked: employee.bank_account_last4 ? `•••• ${employee.bank_account_last4}` : null,
    };
  });
}

function payslipFor(payroll: DemoPayrollState, calculation: DemoCalculation, company: { name: string; brn?: string | null; registered_address?: string | null; business_activity?: string | null; contact_email?: string | null; contact_phone?: string | null }): DemoPayslip {
  const employee = payroll.employees.find((e) => e.id === calculation.employee_id)!;
  const period = payroll.periods.find((p) => p.id === calculation.period_id)!;
  const contract = payroll.contracts.find((c) => c.id === calculation.contract_id);
  return {
    id: uid(), company_id: calculation.company_id, calculation_id: calculation.id,
    period_id: calculation.period_id, employee_id: calculation.employee_id,
    payslip_no: `SIM-${period.period_year}${String(period.period_month).padStart(2, '0')}-${String(payroll.payslips.filter((p) => p.company_id === calculation.company_id).length + 1).padStart(4, '0')}`,
    status: 'simulation', version: 1, generated_at: now(),
    snapshot: {
      disclaimer: 'SIMULATION / DRAFT — NOT FOR PAYMENT. Ce bulletin n’est pas officiel.',
      company: {
        name: company.name, brn: company.brn ?? 'BRN-DEMO-FICTIF',
        registered_address: company.registered_address, business_activity: company.business_activity,
        contact_email: company.contact_email, contact_phone: company.contact_phone,
      },
      employee: {
        number: employee.employee_number, name: employee.full_name,
        jobTitle: employee.job_title, bankAccountMasked: calculation.bankAccountMasked,
      },
      contract: { type: contract?.contract_type, workPattern: contract?.work_pattern },
      period: {
        year: period.period_year, month: period.period_month,
        start: period.start_date, end: period.end_date, paymentDate: period.payment_date,
      },
      currency: calculation.currency,
      lines: calculation.lines,
      totals: {
        base: calculation.base_amount, additionalRemuneration: calculation.additional_remuneration,
        taxableEmoluments: calculation.taxable_emoluments, gross: calculation.gross,
        deductions: calculation.deductions, netArithmetic: calculation.net_arithmetic,
        paye: calculation.paye, csgEmployee: calculation.csg_employee, nsfEmployee: calculation.nsf_employee,
        netAfterStatutory: calculation.net_after_statutory, netPayable: null,
        csgEmployer: calculation.csg_employer, nsfEmployer: calculation.nsf_employer,
        trainingLevy: calculation.training_levy, employerCost: calculation.employer_cost,
      },
      status: calculation.status === 'rules_incomplete' ? 'blocked' : 'simulation',
      statutoryStatus: calculation.statutory_status, payeBasis: calculation.paye_basis,
      rulesApplied: calculation.rules_applied, reviewReasons: calculation.review_reasons,
      missingRules: calculation.missing_rules, warnings: calculation.warnings,
      calculationReference: calculation.id,
      calculationVersion: calculation.version, generatedAt: now(),
    },
  };
}

const mappingFields = [
  { key: 'wagesExpense', field: 'wages_expense_account_id', input: 'wagesExpenseAccountId', required: true },
  { key: 'employerCsgExpense', field: 'employer_csg_expense_account_id', input: 'employerCsgExpenseAccountId', required: true },
  { key: 'employerNsfExpense', field: 'employer_nsf_expense_account_id', input: 'employerNsfExpenseAccountId', required: true },
  { key: 'trainingLevyExpense', field: 'training_levy_expense_account_id', input: 'trainingLevyExpenseAccountId', required: true },
  { key: 'payePayable', field: 'paye_payable_account_id', input: 'payePayableAccountId', required: true },
  { key: 'csgEmployeePayable', field: 'csg_employee_payable_account_id', input: 'csgEmployeePayableAccountId', required: true },
  { key: 'csgEmployerPayable', field: 'csg_employer_payable_account_id', input: 'csgEmployerPayableAccountId', required: true },
  { key: 'nsfEmployeePayable', field: 'nsf_employee_payable_account_id', input: 'nsfEmployeePayableAccountId', required: true },
  { key: 'nsfEmployerPayable', field: 'nsf_employer_payable_account_id', input: 'nsfEmployerPayableAccountId', required: true },
  { key: 'trainingLevyPayable', field: 'training_levy_payable_account_id', input: 'trainingLevyPayableAccountId', required: true },
  { key: 'netPayable', field: 'net_payable_account_id', input: 'netPayableAccountId', required: true },
  { key: 'otherDeductionsPayable', field: 'other_deductions_payable_account_id', input: 'otherDeductionsPayableAccountId', required: false },
  { key: 'reimbursements', field: 'reimbursements_account_id', input: 'reimbursementsAccountId', required: false },
] as const;

const mappingLabels = [
  ['wagesExpense', 'Gross remuneration expense', 'Charge de rémunérations brutes'],
  ['employerCsgExpense', 'Employer CSG expense', 'Charge patronale CSG'],
  ['employerNsfExpense', 'Employer NSF expense', 'Charge patronale NSF'],
  ['trainingLevyExpense', 'Training Levy expense', 'Charge Training Levy'],
  ['payePayable', 'PAYE payable', 'PAYE à payer'],
  ['csgEmployeePayable', 'Employee CSG payable', 'CSG salarié à payer'],
  ['csgEmployerPayable', 'Employer CSG payable', 'CSG employeur à payer'],
  ['nsfEmployeePayable', 'Employee NSF payable', 'NSF salarié à payer'],
  ['nsfEmployerPayable', 'Employer NSF payable', 'NSF employeur à payer'],
  ['trainingLevyPayable', 'Training Levy payable', 'Training Levy à payer'],
  ['netPayable', 'Net wages payable', 'Salaires nets à payer'],
  ['otherDeductionsPayable', 'Other deductions payable', 'Autres retenues à payer'],
  ['reimbursements', 'Reimbursements', 'Remboursements'],
] as const;

const demoFingerprint = (value: string): string => {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < value.length; i += 1) {
    const c = value.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x85ebca6b) >>> 0;
  }
  return `${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}`;
};

const demoAccountView = (state: DemoState, companyId: string, id: string | null) => {
  if (!id) return null;
  const account = state.accounts.find((a) => a.id === id && a.company_id === companyId);
  return account
    ? { id: account.id, code: account.code, name: account.name, type: account.type, isActive: account.is_active }
    : null;
};

function seedDemoPayrollAccounting(
  state: DemoState,
  companyId: string,
  codes: { wages: string; employer: string; paye: string; social: string; net: string; other: string; reimbursements: string },
) {
  const payroll = (state as any).payroll as DemoPayrollState | undefined;
  if (!payroll) return;
  if ((payroll.accountMappings ?? []).some((mapping) => mapping.company_id === companyId)) return;
  const byCode = (code: string) => state.accounts.find((a) => a.company_id === companyId && a.code === code)?.id;
  const journal = state.journals.find((j) => j.company_id === companyId && j.code === 'OD')
    ?? state.journals.find((j) => j.company_id === companyId);
  const accounts = {
    wages: byCode(codes.wages), employer: byCode(codes.employer), paye: byCode(codes.paye),
    social: byCode(codes.social), net: byCode(codes.net), other: byCode(codes.other),
    reimbursements: byCode(codes.reimbursements),
  };
  if (!journal || Object.values(accounts).some((id) => !id)) return;
  payroll.accountMappings ??= [];
  payroll.accountingTransfers ??= [];
  payroll.accountMappings.push({
    id: uid(), company_id: companyId, version: 1, status: 'VALIDATED', journal_id: journal.id,
    wages_expense_account_id: accounts.wages!,
    employer_csg_expense_account_id: accounts.employer!,
    employer_nsf_expense_account_id: accounts.employer!,
    training_levy_expense_account_id: accounts.employer!,
    paye_payable_account_id: accounts.paye!,
    csg_employee_payable_account_id: accounts.social!,
    csg_employer_payable_account_id: accounts.social!,
    nsf_employee_payable_account_id: accounts.social!,
    nsf_employer_payable_account_id: accounts.social!,
    training_levy_payable_account_id: accounts.social!,
    net_payable_account_id: accounts.net!,
    other_deductions_payable_account_id: accounts.other!,
    reimbursements_account_id: accounts.reimbursements!,
    note: 'Correspondances fictives de démonstration, validées pour test.',
    validated_at: now(), validated_by_name: state.users[0]?.full_name ?? 'Démonstration',
    superseded_at: null,
  });
}

function demoMappingView(state: DemoState, companyId: string, mapping: DemoPayrollMapping | null) {
  if (!mapping) return null;
  const journal = state.journals.find((j) => j.id === mapping.journal_id && j.company_id === companyId);
  return {
    id: mapping.id, version: mapping.version, status: mapping.status,
    journalId: mapping.journal_id,
    journal: journal ? { id: journal.id, code: journal.code, name: journal.name, isActive: journal.is_active } : null,
    accounts: Object.fromEntries(mappingFields.map((field) => [
      field.key, demoAccountView(state, companyId, (mapping as any)[field.field] ?? null),
    ])),
    note: mapping.note, validatedAt: mapping.validated_at,
    validatedByName: mapping.validated_by_name, supersededAt: mapping.superseded_at,
  };
}

function demoMappingConfig(state: DemoState, companyId: string) {
  const payroll = asState(state, companyId);
  const mappings = payroll.accountMappings ?? [];
  const current = mappings.find((mapping) => mapping.company_id === companyId && mapping.status === 'VALIDATED') ?? null;
  return {
    mapping: demoMappingView(state, companyId, current),
    mappingHistory: mappings.filter((mapping) => mapping.company_id === companyId)
      .sort((a, b) => b.version - a.version)
      .map((mapping) => ({
        id: mapping.id, version: mapping.version, status: mapping.status,
        validated_at: mapping.validated_at, superseded_at: mapping.superseded_at,
        validated_by_name: mapping.validated_by_name,
      })),
    accounts: state.accounts.filter((account) => account.company_id === companyId)
      .map((account) => ({
        id: account.id, code: account.code, name: account.name, type: account.type,
        isActive: account.is_active,
      })),
    journals: state.journals.filter((journal) => journal.company_id === companyId)
      .map((journal) => ({ id: journal.id, code: journal.code, name: journal.name, isActive: journal.is_active })),
    requiredFields: mappingLabels.map(([key, labelEn, labelFr]) => ({
      key, labelEn, labelFr, required: !['otherDeductionsPayable', 'reimbursements'].includes(key),
    })),
    notice: 'Les comptes proviennent du plan comptable de la société. Aucun numéro de compte obligatoire n’est imposé.',
    noticeEn: 'Accounts come from the company chart of accounts. No mandatory account number is imposed.',
  };
}

function demoSaveMapping(state: DemoState, companyId: string, payload: any) {
  if (payload.confirm !== true) throw new ApiError(400, 'PAYROLL_MAPPING_CONFIRMATION_REQUIRED', 'Confirmation explicite requise');
  const payroll = asState(state, companyId);
  const ids: string[] = [];
  for (const field of mappingFields) {
    const value = payload[field.input];
    if (field.required && !value) {
      throw new ApiError(400, 'PAYROLL_MAPPING_INCOMPLETE', `Compte manquant : ${field.key}`);
    }
    if (value) ids.push(String(value));
  }
  const accounts = state.accounts.filter((account) =>
    account.company_id === companyId && ids.includes(account.id));
  if (accounts.length !== new Set(ids).size) {
    throw new ApiError(404, 'ACCOUNT_NOT_FOUND', 'Un compte n’appartient pas à cette société');
  }
  if (accounts.some((account) => !account.is_active)) {
    throw new ApiError(400, 'PAYROLL_MAPPING_ACCOUNT_INACTIVE', 'Un compte inactif ne peut pas être mappé');
  }
  const journal = state.journals.find((j) => j.id === payload.journalId && j.company_id === companyId);
  if (!journal) throw new ApiError(404, 'JOURNAL_NOT_FOUND', 'Journal introuvable');
  if (!journal.is_active) throw new ApiError(400, 'PAYROLL_MAPPING_JOURNAL_INACTIVE', 'Journal inactif');
  payroll.accountMappings ??= [];
  for (const mapping of payroll.accountMappings) {
    if (mapping.company_id === companyId && mapping.status === 'VALIDATED') {
      mapping.status = 'SUPERSEDED';
      mapping.superseded_at = now();
    }
  }
  const version = Math.max(0, ...payroll.accountMappings.filter((m) => m.company_id === companyId).map((m) => m.version)) + 1;
  const mapping: DemoPayrollMapping = {
    id: uid(), company_id: companyId, version, status: 'VALIDATED', journal_id: journal.id,
    wages_expense_account_id: payload.wagesExpenseAccountId,
    employer_csg_expense_account_id: payload.employerCsgExpenseAccountId,
    employer_nsf_expense_account_id: payload.employerNsfExpenseAccountId,
    training_levy_expense_account_id: payload.trainingLevyExpenseAccountId,
    paye_payable_account_id: payload.payePayableAccountId,
    csg_employee_payable_account_id: payload.csgEmployeePayableAccountId,
    csg_employer_payable_account_id: payload.csgEmployerPayableAccountId,
    nsf_employee_payable_account_id: payload.nsfEmployeePayableAccountId,
    nsf_employer_payable_account_id: payload.nsfEmployerPayableAccountId,
    training_levy_payable_account_id: payload.trainingLevyPayableAccountId,
    net_payable_account_id: payload.netPayableAccountId,
    other_deductions_payable_account_id: payload.otherDeductionsPayableAccountId ?? null,
    reimbursements_account_id: payload.reimbursementsAccountId ?? null,
    note: payload.note ?? null, validated_at: now(),
    validated_by_name: state.users[0]?.full_name ?? 'Démonstration', superseded_at: null,
  };
  payroll.accountMappings.push(mapping);
  return demoMappingView(state, companyId, mapping);
}

const transferLineCategories = [
  { category: 'grossWages', mapping: 'wagesExpense', side: 'debit', amount: 'gross', labelEn: 'Gross remuneration', labelFr: 'Rémunérations brutes' },
  { category: 'reimbursements', mapping: 'reimbursements', side: 'debit', amount: 'reimbursements', labelEn: 'Reimbursements', labelFr: 'Remboursements' },
  { category: 'employerCsg', mapping: 'employerCsgExpense', side: 'debit', amount: 'csgEmployer', labelEn: 'Employer CSG', labelFr: 'CSG employeur' },
  { category: 'employerNsf', mapping: 'employerNsfExpense', side: 'debit', amount: 'nsfEmployer', labelEn: 'Employer NSF', labelFr: 'NSF employeur' },
  { category: 'trainingLevyExpense', mapping: 'trainingLevyExpense', side: 'debit', amount: 'trainingLevy', labelEn: 'Training Levy expense', labelFr: 'Charge Training Levy' },
  { category: 'payePayable', mapping: 'payePayable', side: 'credit', amount: 'paye', labelEn: 'PAYE withheld', labelFr: 'PAYE retenu' },
  { category: 'csgEmployeePayable', mapping: 'csgEmployeePayable', side: 'credit', amount: 'csgEmployee', labelEn: 'Employee CSG withheld', labelFr: 'CSG salarié retenue' },
  { category: 'csgEmployerPayable', mapping: 'csgEmployerPayable', side: 'credit', amount: 'csgEmployer', labelEn: 'Employer CSG payable', labelFr: 'CSG employeur à payer' },
  { category: 'nsfEmployeePayable', mapping: 'nsfEmployeePayable', side: 'credit', amount: 'nsfEmployee', labelEn: 'Employee NSF withheld', labelFr: 'NSF salarié retenue' },
  { category: 'nsfEmployerPayable', mapping: 'nsfEmployerPayable', side: 'credit', amount: 'nsfEmployer', labelEn: 'Employer NSF payable', labelFr: 'NSF employeur à payer' },
  { category: 'trainingLevyPayable', mapping: 'trainingLevyPayable', side: 'credit', amount: 'trainingLevy', labelEn: 'Training Levy payable', labelFr: 'Training Levy à payer' },
  { category: 'otherDeductions', mapping: 'otherDeductionsPayable', side: 'credit', amount: 'otherDeductions', labelEn: 'Other deductions payable', labelFr: 'Autres retenues à payer' },
  { category: 'netPayable', mapping: 'netPayable', side: 'credit', amount: 'netAfterStatutory', labelEn: 'Net wages payable', labelFr: 'Salaires nets à payer' },
] as const;

function demoAccountingPreview(state: DemoState, companyId: string, periodId: string) {
  const payroll = asState(state, companyId);
  const company = state.companies.find((c) => c.id === companyId);
  if (!company) throw new ApiError(404, 'COMPANY_NOT_FOUND', 'Société introuvable');
  const period = payroll.periods.find((p) => p.id === periodId && p.company_id === companyId);
  if (!period) throw new ApiError(404, 'PAYROLL_PERIOD_NOT_FOUND', 'Période introuvable');
  const latest = new Map<string, DemoCalculation>();
  for (const calculation of payroll.calculations.filter((c) => c.period_id === period.id && c.company_id === companyId)) {
    const current = latest.get(calculation.employee_id);
    if (!current || calculation.version > current.version) latest.set(calculation.employee_id, calculation);
  }
  const calculations = [...latest.values()].sort((a, b) => a.employee_number.localeCompare(b.employee_number));
  const mappings = payroll.accountMappings ?? [];
  const mappingRow = mappings.find((m) => m.company_id === companyId && m.status === 'VALIDATED') ?? null;
  const mapping = demoMappingView(state, companyId, mappingRow);
  const accounts = (mapping?.accounts ?? {}) as Record<string, any>;
  const rows = calculations.map((calc) => {
    const gross = money(calc.gross);
    const deductions = money(calc.deductions);
    const net = money(calc.net_arithmetic);
    return { calc, gross, deductions, net, reimbursements: net - gross + deductions };
  });
  const sum = (values: bigint[]) => values.reduce((total, value) => total + value, 0n);
  const sumNullable = (values: (bigint | null)[]) =>
    values.some((v) => v === null) ? null : sum(values as bigint[]);
  const gross = sum(rows.map((row) => row.gross));
  const otherDeductions = sum(rows.map((row) => row.deductions));
  const reimbursements = sum(rows.map((row) => row.reimbursements));
  const netArithmetic = sum(rows.map((row) => row.net));
  const paye = sumNullable(calculations.map((c) => c.paye === null ? null : money(c.paye)));
  const csgEmployee = sumNullable(calculations.map((c) => c.csg_employee === null || c.csg_employee === undefined ? null : money(c.csg_employee)));
  const csgEmployer = sumNullable(calculations.map((c) => c.csg_employer === null || c.csg_employer === undefined ? null : money(c.csg_employer)));
  const nsfEmployee = sumNullable(calculations.map((c) => c.nsf_employee === null || c.nsf_employee === undefined ? null : money(c.nsf_employee)));
  const nsfEmployer = sumNullable(calculations.map((c) => c.nsf_employer === null || c.nsf_employer === undefined ? null : money(c.nsf_employer)));
  const trainingLevy = sumNullable(calculations.map((c) => c.training_levy === null || c.training_levy === undefined ? null : money(c.training_levy)));
  const employeeStatutory = sumNullable([paye, csgEmployee, nsfEmployee]);
  const employerContributions = sumNullable([csgEmployer, nsfEmployer, trainingLevy]);
  const netAfterStatutory = employeeStatutory === null ? null : netArithmetic - employeeStatutory;
  const employerCost = employerContributions === null ? null : gross + reimbursements + employerContributions;
  const blocked = calculations.filter((c) => c.status === 'rules_incomplete' || (c.missing_rules?.length ?? 0) > 0);
  const nullStatutory = calculations.filter((c) =>
    [c.paye, c.csg_employee, c.csg_employer, c.nsf_employee, c.nsf_employer, c.training_levy]
      .some((value) => value === null || value === undefined));
  const accountingPeriod = state.periods.find((p) =>
    p.company_id === companyId && p.status === 'open' &&
    p.start_date <= (period.payment_date ?? period.end_date) && p.end_date >= (period.payment_date ?? period.end_date));
  const journal = mapping?.journal;
  const mappingMissing = !mapping;
  const inactive = mapping
    ? mappingFields.flatMap((field) => {
        const account = accounts[field.key];
        if (!account) return field.required ? [field.key] : [];
        return account.isActive ? [] : [field.key];
      })
    : [];
  const needsOther = otherDeductions > 0n;
  const needsReimb = reimbursements > 0n;
  const checks: any[] = [
    { code: 'COMPANY_ISOLATION', severity: 'ok', scope: 'internal', messageEn: 'All rows are restricted to this company.', messageFr: 'Toutes les lignes sont limitées à cette société.' },
    calculations.length > 0
      ? { code: 'CALCULATIONS_PRESENT', severity: 'ok', scope: 'internal', messageEn: `${calculations.length} latest calculation(s) loaded.`, messageFr: `${calculations.length} dernier(s) calcul(s) chargé(s).` }
      : { code: 'CALCULATIONS_MISSING', severity: 'block', scope: 'internal', messageEn: 'No payroll calculation exists for this period.', messageFr: 'Aucun calcul de paie n’existe pour cette période.' },
    calculations.every((c) => c.currency === 'MUR') && company.functional_currency === 'MUR'
      ? { code: 'CURRENCY_MUR', severity: 'ok', scope: 'internal', messageEn: 'Every calculation and the company use MUR.', messageFr: 'Chaque calcul et la société sont en MUR.' }
      : { code: 'CURRENCY_NOT_MUR', severity: 'block', scope: 'internal', messageEn: 'The transfer requires MUR.', messageFr: 'Le transfert exige le MUR.' },
    blocked.length === 0
      ? { code: 'CALCULATIONS_COMPLETE', severity: 'ok', scope: 'internal', messageEn: 'No calculation is blocked.', messageFr: 'Aucun calcul n’est bloqué.' }
      : { code: 'CALCULATIONS_INCOMPLETE', severity: 'block', scope: 'internal', messageEn: 'A calculation is blocked by missing rules.', messageFr: 'Un calcul est bloqué par des règles manquantes.' },
    nullStatutory.length === 0
      ? { code: 'STATUTORY_VALUES_PRESENT', severity: 'ok', scope: 'internal', messageEn: 'PAYE, CSG, NSF and levy are present.', messageFr: 'PAYE, CSG, NSF et levy sont présents.' }
      : { code: 'STATUTORY_VALUES_NULL', severity: 'block', scope: 'internal', messageEn: 'A statutory amount is unknown; zero is never substituted.', messageFr: 'Un montant statutaire est inconnu ; zéro n’est jamais substitué.' },
    rows.every((row) => row.reimbursements >= 0n)
      ? { code: 'REIMBURSEMENTS_NON_NEGATIVE', severity: 'ok', scope: 'internal', messageEn: 'Reimbursements are non-negative.', messageFr: 'Les remboursements sont positifs ou nuls.' }
      : { code: 'REIMBURSEMENTS_NEGATIVE', severity: 'block', scope: 'internal', messageEn: 'A negative reimbursement must be reviewed.', messageFr: 'Un remboursement négatif doit être revu.' },
    mappingMissing
      ? { code: 'ACCOUNT_MAPPING_MISSING', severity: 'block', scope: 'internal', messageEn: 'No validated mapping exists.', messageFr: 'Aucune correspondance validée n’existe.' }
      : { code: 'ACCOUNT_MAPPING_PRESENT', severity: 'ok', scope: 'internal', messageEn: `Mapping version ${mapping!.version} is used.`, messageFr: `La version ${mapping!.version} est utilisée.` },
    inactive.length === 0
      ? { code: 'ACCOUNT_MAPPING_ACTIVE', severity: 'ok', scope: 'internal', messageEn: 'Every mapped account is active.', messageFr: 'Chaque compte mappé est actif.' }
      : { code: 'ACCOUNT_MAPPING_INACTIVE', severity: 'block', scope: 'internal', messageEn: 'A mapped account is inactive or missing.', messageFr: 'Un compte mappé est inactif ou absent.' },
    journal?.isActive
      ? { code: 'JOURNAL_ACTIVE', severity: 'ok', scope: 'internal', messageEn: `Journal ${journal.code} is active.`, messageFr: `Le journal ${journal.code} est actif.` }
      : { code: 'JOURNAL_INACTIVE', severity: 'block', scope: 'internal', messageEn: 'The mapped journal is missing or inactive.', messageFr: 'Le journal mappé est absent ou inactif.' },
    accountingPeriod
      ? { code: 'ACCOUNTING_PERIOD_OPEN', severity: 'ok', scope: 'internal', messageEn: 'An open accounting period covers the payment date.', messageFr: 'Une période comptable ouverte couvre la date de paiement.' }
      : { code: 'ACCOUNTING_PERIOD_CLOSED', severity: 'block', scope: 'internal', messageEn: 'No open accounting period covers the payment date.', messageFr: 'Aucune période comptable ouverte ne couvre la date de paiement.' },
    needsOther && !accounts.otherDeductionsPayable
      ? { code: 'OTHER_DEDUCTIONS_MAPPING_MISSING', severity: 'block', scope: 'internal', messageEn: 'Other deductions have no payable account.', messageFr: 'Les autres retenues n’ont pas de compte de dette.' }
      : { code: 'OTHER_DEDUCTIONS_MAPPED', severity: 'ok', scope: 'internal', messageEn: 'Other deductions are mapped or absent.', messageFr: 'Les autres retenues sont mappées ou absentes.' },
    needsReimb && !accounts.reimbursements
      ? { code: 'REIMBURSEMENTS_MAPPING_MISSING', severity: 'block', scope: 'internal', messageEn: 'Reimbursements have no account.', messageFr: 'Les remboursements n’ont pas de compte.' }
      : { code: 'REIMBURSEMENTS_MAPPED', severity: 'ok', scope: 'internal', messageEn: 'Reimbursements are mapped or absent.', messageFr: 'Les remboursements sont mappés ou absents.' },
  ];
  const amounts: Record<string, bigint | null> = {
    gross, reimbursements, csgEmployer, nsfEmployer, trainingLevy, paye,
    csgEmployee, nsfEmployee, otherDeductions, netAfterStatutory,
  };
  let lineNo = 1;
  const lines = transferLineCategories.flatMap((descriptor) => {
    const amount = amounts[descriptor.amount];
    if (amount === undefined || amount === null || amount <= 0n) return [];
    const account = accounts[descriptor.mapping] ?? null;
    return [{
      lineNo: lineNo++, category: descriptor.category,
      labelEn: descriptor.labelEn, labelFr: descriptor.labelFr,
      accountId: account?.id ?? null, accountCode: account?.code ?? null,
      accountName: account?.name ?? null, description: descriptor.labelEn,
      debit: descriptor.side === 'debit' ? fmt(amount) : '0.0000',
      credit: descriptor.side === 'credit' ? fmt(amount) : '0.0000',
    }];
  });
  const debitTotal = sum(lines.map((line) => money(line.debit)));
  const creditTotal = sum(lines.map((line) => money(line.credit)));
  const difference = debitTotal - creditTotal;
  if (lines.some((line) => !line.accountId)) {
    checks.push({ code: 'ACCOUNT_MISSING_ON_LINE', severity: 'block', scope: 'internal', messageEn: 'A line has no mapped account.', messageFr: 'Une ligne n’a pas de compte mappé.' });
  }
  if (lines.length < 2) {
    checks.push({ code: 'ENTRY_TOO_FEW_LINES', severity: 'block', scope: 'internal', messageEn: 'Fewer than two lines.', messageFr: 'Moins de deux lignes.' });
  }
  if (difference !== 0n) {
    checks.push({ code: 'ENTRY_UNBALANCED', severity: 'block', scope: 'internal', messageEn: 'Debit and credit differ; no adjustment is created.', messageFr: 'Débit et crédit diffèrent ; aucun ajustement n’est créé.' });
  } else {
    checks.push({ code: 'ENTRY_BALANCED', severity: 'ok', scope: 'internal', messageEn: 'Debit equals credit exactly.', messageFr: 'Le débit est exactement égal au crédit.' });
  }
  checks.push({ code: 'RULES_NOT_EXPERT_VALIDATED', severity: 'warning', scope: 'internal', messageEn: 'Source rules are not expert-validated; this is a test preparation.', messageFr: 'Les règles source ne sont pas validées par un expert ; préparation de test.' });
  const blockers = checks.filter((check) => check.severity === 'block');
  const warnings = checks.filter((check) => check.severity === 'warning');
  const postingChecks = [
    { code: 'PAYROLL_RULES_NOT_EXPERT_VALIDATED', severity: 'block', scope: 'posting', messageEn: 'Definitive posting is blocked while payroll rules are not expert-validated.', messageFr: 'La comptabilisation définitive est bloquée tant que les règles de paie ne sont pas validées par un expert.' },
    { code: 'PAYROLL_PERIOD_NOT_FINALISED', severity: 'block', scope: 'posting', messageEn: 'Definitive posting requires a finalised payroll period.', messageFr: 'La comptabilisation définitive exige une période de paie finalisée.' },
    { code: 'PAYROLL_CALCULATIONS_NOT_APPROVED', severity: 'block', scope: 'posting', messageEn: 'Test calculations cannot be posted definitively.', messageFr: 'Des calculs de test ne peuvent pas être comptabilisés définitivement.' },
  ];
  const sourceFingerprint = demoFingerprint(calculations
    .map((c) => `${c.id}:${c.version}:${c.input_hash}:${c.status}`).sort().join('|'));
  return {
    company: { id: company.id, name: company.name, functionalCurrency: company.functional_currency },
    period: {
      id: period.id, year: period.period_year, month: period.period_month,
      start: period.start_date, end: period.end_date, paymentDate: period.payment_date,
      status: period.status, label: `${String(period.period_month).padStart(2, '0')}/${period.period_year}`,
    },
    entryDate: period.payment_date ?? period.end_date,
    employees: calculations.length, employeesActive: payroll.employees.filter((e) => e.company_id === companyId && e.employment_status !== 'terminated').length,
    currency: 'MUR', mapping, calculationIds: calculations.map((c) => c.id),
    sourceFingerprint, sourceRules: calculations.flatMap((c) => c.rules_applied ?? []),
    lines,
    totals: {
      gross: fmt(gross), reimbursements: fmt(reimbursements), otherDeductions: fmt(otherDeductions),
      employeeStatutoryDeductions: employeeStatutory === null ? null : fmt(employeeStatutory),
      employeeDeductions: employeeStatutory === null ? null : fmt(employeeStatutory + otherDeductions),
      employerContributions: employerContributions === null ? null : fmt(employerContributions),
      netArithmetic: fmt(netArithmetic), netAfterStatutory: netAfterStatutory === null ? null : fmt(netAfterStatutory),
      employerCost: employerCost === null ? null : fmt(employerCost),
      debitTotal: fmt(debitTotal), creditTotal: fmt(creditTotal), difference: fmt(difference),
    },
    checks, blockers, warnings, postingChecks,
    canGenerate: true, canApprove: blockers.length === 0, canPost: false, postingAllowed: false,
    regulatoryStatus: 'SIMULATION_ONLY',
    notice: 'Proposition comptable de simulation. Aucune écriture n’est créée avant une décision humaine et la comptabilisation définitive reste bloquée.',
    noticeEn: 'Simulated accounting proposal. No entry is created before a human decision and definitive posting remains blocked.',
  };
}

function demoTransferView(state: DemoState, companyId: string, transfer: DemoAccountingTransfer) {
  return {
    id: transfer.id, companyId, periodId: transfer.period_id, version: transfer.version,
    status: transfer.status, mappingId: transfer.mapping_id, mappingVersion: transfer.mapping_version,
    journalId: transfer.journal_id, currency: transfer.currency,
    calculationIds: transfer.calculation_ids, sourceFingerprint: transfer.source_fingerprint,
    sourceRules: transfer.source_rules, totals: transfer.totals, lines: transfer.lines,
    checks: transfer.checks, blockers: transfer.blockers, warnings: transfer.warnings,
    postingChecks: transfer.posting_blockers, canPost: transfer.can_post, note: transfer.note,
    createdAt: transfer.created_at, createdByName: transfer.created_by_name,
    decidedAt: transfer.decided_at, decidedByName: transfer.decided_by_name,
    decisionNote: transfer.decision_note, rejectionReason: transfer.rejection_reason,
    rejection_reason: transfer.rejection_reason, postedEntryId: transfer.posted_entry_id,
    postedAt: transfer.posted_at,
    regulatoryStatus: transfer.status === 'POSTED' ? 'POSTED' : 'SIMULATION_ONLY',
  };
}

function demoGenerateTransfer(state: DemoState, companyId: string, periodId: string, note?: string | null) {
  const payroll = asState(state, companyId);
  const preview = demoAccountingPreview(state, companyId, periodId);
  payroll.accountingTransfers ??= [];
  const version = Math.max(0, ...payroll.accountingTransfers
    .filter((t) => t.company_id === companyId && t.period_id === periodId).map((t) => t.version)) + 1;
  const status = preview.blockers.length > 0 ? 'BLOCKED'
    : preview.warnings.length > 0 ? 'REVIEW_REQUIRED' : 'DRAFT';
  const transfer: DemoAccountingTransfer = {
    id: uid(), company_id: companyId, period_id: periodId, version, status,
    mapping_id: preview.mapping?.id ?? null, mapping_version: preview.mapping?.version ?? null,
    journal_id: preview.mapping?.journalId ?? null, currency: preview.currency,
    calculation_ids: preview.calculationIds, source_fingerprint: preview.sourceFingerprint,
    source_rules: preview.sourceRules, totals: preview.totals, lines: preview.lines,
    checks: preview.checks, blockers: preview.blockers, warnings: preview.warnings,
    posting_blockers: preview.postingChecks, can_post: false,
    note: note ?? null, created_at: now(), created_by_name: state.users[0]?.full_name ?? 'Démonstration',
    decided_at: null, decided_by_name: null, decision_note: null, rejection_reason: null,
    posted_entry_id: null, posted_at: null,
  };
  payroll.accountingTransfers.push(transfer);
  return demoTransferView(state, companyId, transfer);
}

function demoApproveTransfer(state: DemoState, companyId: string, id: string, payload: any) {
  const payroll = asState(state, companyId);
  const transfer = (payroll.accountingTransfers ?? []).find((t) => t.id === id && t.company_id === companyId);
  if (!transfer) throw new ApiError(404, 'PAYROLL_TRANSFER_NOT_FOUND', 'Transfert introuvable');
  if (payload.confirm !== true || String(payload.note ?? '').trim().length < 10) {
    throw new ApiError(400, 'PAYROLL_TRANSFER_DECISION_REQUIRED', 'Confirmation et note de 10 caractères minimum requises');
  }
  if (transfer.status === 'POSTED') throw new ApiError(409, 'PAYROLL_TRANSFER_POSTED_IMMUTABLE', 'Transfert comptabilisé');
  if (transfer.status === 'REJECTED') throw new ApiError(409, 'PAYROLL_TRANSFER_REJECTED', 'Transfert rejeté');
  if (transfer.status === 'APPROVED_FOR_TEST') throw new ApiError(409, 'PAYROLL_TRANSFER_ALREADY_APPROVED', 'Déjà approuvé');
  if (transfer.status === 'BLOCKED') throw new ApiError(409, 'PAYROLL_TRANSFER_BLOCKED', 'Transfert bloqué');
  const preview = demoAccountingPreview(state, companyId, transfer.period_id);
  if (preview.sourceFingerprint !== transfer.source_fingerprint ||
      preview.mapping?.id !== transfer.mapping_id) {
    throw new ApiError(409, 'PAYROLL_TRANSFER_STALE', 'Les calculs ou les correspondances ont changé ; générez une nouvelle proposition');
  }
  const duplicate = (payroll.accountingTransfers ?? []).some((t) =>
    t.id !== id && t.company_id === companyId && t.period_id === transfer.period_id &&
    t.source_fingerprint === transfer.source_fingerprint &&
    ['APPROVED_FOR_TEST', 'POSTED'].includes(t.status));
  if (duplicate) throw new ApiError(409, 'PAYROLL_TRANSFER_DUPLICATE_SOURCE', 'Ce jeu de calculs est déjà approuvé');
  transfer.status = 'APPROVED_FOR_TEST';
  transfer.decided_at = now();
  transfer.decided_by_name = state.users[0]?.full_name ?? 'Démonstration';
  transfer.decision_note = String(payload.note).trim();
  return demoTransferView(state, companyId, transfer);
}

function demoRejectTransfer(state: DemoState, companyId: string, id: string, payload: any) {
  const payroll = asState(state, companyId);
  const transfer = (payroll.accountingTransfers ?? []).find((t) => t.id === id && t.company_id === companyId);
  if (!transfer) throw new ApiError(404, 'PAYROLL_TRANSFER_NOT_FOUND', 'Transfert introuvable');
  const reason = String(payload.reason ?? '').trim();
  if (reason.length < 10) throw new ApiError(400, 'PAYROLL_TRANSFER_DECISION_REQUIRED', 'Motif de rejet de 10 caractères minimum requis');
  if (transfer.status === 'POSTED') throw new ApiError(409, 'PAYROLL_TRANSFER_POSTED_IMMUTABLE', 'Transfert comptabilisé');
  if (transfer.status === 'REJECTED') throw new ApiError(409, 'PAYROLL_TRANSFER_ALREADY_REJECTED', 'Déjà rejeté');
  transfer.status = 'REJECTED';
  transfer.decided_at = now();
  transfer.decided_by_name = state.users[0]?.full_name ?? 'Démonstration';
  transfer.rejection_reason = reason;
  return demoTransferView(state, companyId, transfer);
}

export function demoAccountingTransferCsv(transfer: any): string {
  const rows: string[] = [];
  const cell = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const line = (cells: unknown[]) => cells.map(cell).join(',');
  rows.push(line(['PAYROLL ACCOUNTING TRANSFER - INTERNAL SIMULATION - NOT POSTED AUTOMATICALLY']));
  rows.push(line(['SIMULATION - NOT VALIDATED FOR PAYMENT OR ACCOUNTING']));
  rows.push(line(['Transfer ID', transfer.id]));
  rows.push(line(['Period ID', transfer.periodId]));
  rows.push(line(['Version', transfer.version]));
  rows.push(line(['Status', transfer.status]));
  rows.push(line(['Currency', transfer.currency]));
  rows.push(line(['Mapping version', transfer.mappingVersion ?? '']));
  rows.push(line(['Source fingerprint', transfer.sourceFingerprint]));
  rows.push(line(['Source calculation IDs', (transfer.calculationIds ?? []).join(' ')]));
  rows.push(line(['Created at', transfer.createdAt]));
  rows.push(line(['Created by', transfer.createdByName ?? '']));
  rows.push(line(['Decision', transfer.status === 'APPROVED_FOR_TEST' ? 'APPROVED FOR TEST' : transfer.status]));
  rows.push(line(['Decision note', transfer.decisionNote ?? '']));
  rows.push(line(['Rejection reason', transfer.rejectionReason ?? '']));
  rows.push(line(['Posted entry', transfer.postedEntryId ?? 'NOT POSTED']));
  rows.push('');
  rows.push(line(['LINES']));
  rows.push(line(['Line', 'Category', 'Account code', 'Account name', 'Description', 'Debit', 'Credit']));
  for (const entry of transfer.lines ?? []) {
    rows.push(line([entry.lineNo, entry.category, entry.accountCode ?? '', entry.accountName ?? '', entry.labelEn, entry.debit, entry.credit]));
  }
  rows.push('');
  rows.push(line(['TOTALS']));
  for (const [key, value] of Object.entries(transfer.totals ?? {})) rows.push(line([key, value]));
  rows.push('');
  rows.push(line(['CHECKS']));
  rows.push(line(['Code', 'Severity', 'Scope', 'Message EN', 'Message FR']));
  for (const check of transfer.checks ?? []) rows.push(line([check.code, check.severity, check.scope, check.messageEn, check.messageFr]));
  rows.push('');
  rows.push(line(['NO JOURNAL ENTRY IS CREATED BY THIS FILE']));
  return '\uFEFF' + rows.join('\r\n');
}

function asState(state: DemoState, companyId: string): DemoPayrollState {
  if (!(state as any).payroll) seedDemoPayroll(state);
  const payroll = (state as any).payroll as DemoPayrollState;
  if (!payroll || !payroll.periods.some((p) => p.company_id === companyId)) {
    // A second demo company has no seeded payroll: return an honest empty set.
    return { employees: [], contracts: [], events: [], payItems: payroll?.payItems ?? [], assignments: [], time: [], holidays: [], absences: [], leaveRules: [], rules: [], periods: [], variables: [], calculations: [], payslips: [], sequences: {} };
  }
  return payroll;
}

function next(payroll: DemoPayrollState, key: string) {
  payroll.sequences[key] = (payroll.sequences[key] ?? 0) + 1;
  return `${key}-${payroll.sequences[key]}`;
}

function dashboard(payroll: DemoPayrollState, companyId: string) {
  const employees = payroll.employees.filter((e) => e.company_id === companyId);
  const active = employees.filter((e) => ['active', 'probation'].includes(e.employment_status));
  const periods = payroll.periods.filter((p) => p.company_id === companyId).sort((a, b) => b.start_date.localeCompare(a.start_date));
  const missing = payroll.rules.filter((r) => r.required_for_calculation && r.status !== 'EXPERT_VALIDATED');
  return {
    available: true, activeEmployees: active.length, totalEmployees: employees.length,
    terminatedEmployees: employees.filter((e) => e.employment_status === 'terminated').length,
    expiringContracts: payroll.contracts.filter((c) => c.company_id === companyId && c.contract_type === 'fixed_term' && c.status === 'active' && c.effective_to && c.effective_to <= '2026-12-31').length,
    recentPeriods: periods.slice(0, 3).map(periodView),
    variables: {
      draft: payroll.variables.filter((v) => v.company_id === companyId && v.status === 'draft').length,
      validated: payroll.variables.filter((v) => v.company_id === companyId && v.status === 'validated').length,
    },
    pendingLeave: payroll.absences.filter((a) => a.company_id === companyId && a.status === 'requested').length,
    missingContracts: active.filter((e) => !payroll.contracts.some((c) => c.employee_id === e.id && c.status === 'active')).map((e) => ({ id: e.id, employee_number: e.employee_number, full_name: e.full_name })),
    rules: payroll.rules.filter((r) => r.company_id === companyId && r.required_for_calculation).map((r) => ({ ruleCode: r.rule_code, found: true, validated: r.status === 'EXPERT_VALIDATED', expertValidated: r.status === 'EXPERT_VALIDATED', usable: ['RESEARCHED','REVIEW_REQUIRED','EXPERT_VALIDATED'].includes(r.status), status: r.status, rate: r.rate, effectiveFrom: r.effective_from })),
    calculationAvailable: true, statutoryComplete: false,
    capabilities: { employees: true, contracts: true, time: true, leave: true, variables: true, arithmeticCalculation: true, statutoryCalculation: false, finalPayslips: false, statutoryDeclarations: true, accountingTransfer: true, paye: false, csg: false, nsf: false, employerContributions: false },
    notice: 'Totaux arithmétiques uniquement. PAYE, CSG, NSF et cotisations employeur sont bloqués : aucune règle mauricienne validée, moteur réglementaire non implémenté.',
  };
}

export function handleDemoPayroll(
  state: DemoState, companyId: string, method: string, rest: string,
  query: Record<string, string>, payload: any,
): unknown {
  const payroll = asState(state, companyId);
  const employees = payroll.employees.filter((e) => e.company_id === companyId);
  const company = state.companies.find((c) => c.id === companyId);
  if (!company) throw new ApiError(404, 'COMPANY_NOT_FOUND', 'Société introuvable');

  if (rest === '/accounting/mapping' && method === 'GET') return demoMappingConfig(state, companyId);
  if (rest === '/accounting/mapping' && method === 'PUT') return { mapping: demoSaveMapping(state, companyId, payload) };
  const accountingTransferCsv = /^\/accounting-transfers\/([^/]+)\/csv$/.exec(rest);
  if (accountingTransferCsv && method === 'GET') {
    const transfer = (payroll.accountingTransfers ?? []).find((t) => t.id === accountingTransferCsv[1] && t.company_id === companyId);
    if (!transfer) throw new ApiError(404, 'PAYROLL_TRANSFER_NOT_FOUND', 'Transfert introuvable');
    return { csv: demoAccountingTransferCsv(demoTransferView(state, companyId, transfer)) };
  }
  const accountingTransferAction = /^\/accounting-transfers\/([^/]+)\/(approve|reject|post)$/.exec(rest);
  if (accountingTransferAction && method === 'POST') {
    const transferId = accountingTransferAction[1]!;
    const action = accountingTransferAction[2]!;
    if (action === 'approve') return { transfer: demoApproveTransfer(state, companyId, transferId, payload) };
    if (action === 'reject') return { transfer: demoRejectTransfer(state, companyId, transferId, payload) };
    const transfer = (payroll.accountingTransfers ?? []).find((t) => t.id === transferId && t.company_id === companyId);
    if (!transfer) throw new ApiError(404, 'PAYROLL_TRANSFER_NOT_FOUND', 'Transfert introuvable');
    if (transfer.status === 'POSTED') throw new ApiError(409, 'PAYROLL_TRANSFER_POSTING_BLOCKED', 'Déjà comptabilisé');
    throw new ApiError(409, 'PAYROLL_TRANSFER_POSTING_BLOCKED', 'Comptabilisation définitive bloquée : règles de paie non validées par un expert et période non finalisée.');
  }
  const accountingTransfer = /^\/accounting-transfers\/([^/]+)$/.exec(rest);
  if (accountingTransfer && method === 'GET') {
    const transfer = (payroll.accountingTransfers ?? []).find((t) => t.id === accountingTransfer[1] && t.company_id === companyId);
    if (!transfer) throw new ApiError(404, 'PAYROLL_TRANSFER_NOT_FOUND', 'Transfert introuvable');
    return { transfer: demoTransferView(state, companyId, transfer) };
  }
  if (rest === '/accounting-transfers' && method === 'GET') {
    return {
      transfers: (payroll.accountingTransfers ?? [])
        .filter((t) => t.company_id === companyId && (!query.periodId || t.period_id === query.periodId))
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .map((t) => demoTransferView(state, companyId, t)),
    };
  }

  if (rest === '/dashboard' || rest === '/summary') return dashboard(payroll, companyId);
  if (rest === '/employees' && method === 'GET') {
    let list = employees;
    if (query.search) {
      const q = query.search.toLowerCase();
      list = list.filter((e) => `${e.employee_number} ${e.full_name} ${e.email ?? ''}`.toLowerCase().includes(q));
    }
    if (query.status) list = list.filter((e) => e.employment_status === query.status);
    return { employees: list.map(employeeView) };
  }
  if (rest === '/employees/duplicates' && method === 'POST') {
    const duplicates = employees.filter((e) => e.employee_number.toLowerCase() === String(payload.employeeNumber ?? '').toLowerCase() || e.full_name.toLowerCase() === `${payload.firstName} ${payload.lastName}`.toLowerCase()).map((e) => ({ id: e.id, employeeNumber: e.employee_number, reason: 'EMPLOYEE_NUMBER_OR_NAME' }));
    return { duplicates };
  }
  if (rest === '/employees' && method === 'POST') {
    if (employees.some((e) => e.employee_number.toLowerCase() === String(payload.employeeNumber).toLowerCase())) {
      throw new ApiError(409, 'PAYROLL_EMPLOYEE_DUPLICATE', 'Numéro de salarié déjà utilisé ; aucune fusion automatique');
    }
    const created = now();
    const employee: DemoEmployee = {
      id: uid(), company_id: companyId, employee_number: payload.employeeNumber, employee_ref: payload.employeeNumber,
      first_name: payload.firstName, last_name: payload.lastName, full_name: `${payload.firstName} ${payload.lastName}`,
      preferred_name: payload.preferredName ?? null, date_of_birth: payload.dateOfBirth ?? null,
      nationality: payload.nationality ?? 'Mauritian', country_of_residence: payload.countryOfResidence ?? 'Mauritius',
      address: payload.address ?? null, email: payload.email ?? null, phone: payload.phone ?? null,
      employment_status: payload.employmentStatus ?? 'active', hire_date: payload.hireDate ?? null,
      termination_date: payload.terminationDate ?? null, department: payload.department ?? null,
      job_title: payload.jobTitle ?? null, work_location: payload.workLocation ?? null,
      manager_employee_id: payload.managerEmployeeId ?? null, cost_centre: payload.costCentre ?? null,
      payroll_currency: payload.payrollCurrency ?? 'MUR', payment_method: payload.paymentMethod ?? null,
      bank_name: payload.bankName ?? null,
      bank_account_last4: payload.bankAccountNumber ? String(payload.bankAccountNumber).replace(/\s/g, '').slice(-4) : null,
      statutory_id_last4: payload.statutoryId ? String(payload.statutoryId).replace(/\s/g, '').slice(-4) : null,
      statutory_ref_last4: payload.statutoryRef ? String(payload.statutoryRef).replace(/\s/g, '').slice(-4) : null,
      emergency_contact_name: payload.emergencyContactName ?? null, emergency_contact_phone: payload.emergencyContactPhone ?? null,
      emergency_contact_relation: payload.emergencyContactRelation ?? null, notes: payload.notes ?? null,
      created_at: created, updated_at: created,
    };
    payroll.employees.push(employee);
    return { employee: employeeView(employee) };
  }
  const employeeMatch = /^\/employees\/([^/]+)(\/.*)?$/.exec(rest);
  if (employeeMatch) {
    const employee = employees.find((e) => e.id === employeeMatch[1]);
    if (!employee) throw new ApiError(404, 'PAYROLL_EMPLOYEE_NOT_FOUND', 'Salarié introuvable');
    const tail = employeeMatch[2] ?? '';
    if (tail === '' && method === 'GET') return { employee: { ...employeeView(employee), contracts: payroll.contracts.filter((c) => c.employee_id === employee.id) } };
    if (tail === '' && method === 'PATCH') {
      const map: Record<string, string> = { jobTitle: 'job_title', department: 'department', workLocation: 'work_location', costCentre: 'cost_centre', notes: 'notes', employmentStatus: 'employment_status', terminationDate: 'termination_date', preferredName: 'preferred_name', phone: 'phone', email: 'email', address: 'address' };
      for (const [key, column] of Object.entries(map)) if (payload[key] !== undefined) (employee as any)[column] = payload[key];
      employee.updated_at = now();
      return { employee: employeeView(employee) };
    }
    if (tail === '/leave-balances' && method === 'GET') {
      return {
        year: Number(query.year ?? 2026), employeeId: employee.id,
        balances: ['annual', 'sick', 'unpaid', 'maternity', 'paternity', 'other'].map((type) => {
          const rule = payroll.leaveRules.find((r) => r.company_id === companyId && r.leave_type === type);
          const consumed = payroll.absences.filter((a) => a.employee_id === employee.id && a.leave_type === type && a.status === 'approved').reduce((s, a) => s + money(a.days), 0n);
          return rule ? { leaveType: type, status: rule.status, configured: true, validated: rule.status === 'EXPERT_VALIDATED', entitlement: rule.status === 'EXPERT_VALIDATED' ? fmt(money(rule.days_per_year)) : null, consumed: fmt(consumed), balance: rule.status === 'EXPERT_VALIDATED' ? fmt(money(rule.days_per_year) - consumed) : null, note: rule.status === 'EXPERT_VALIDATED' ? 'Règle validée.' : 'Règle non validée : solde non acquis.' } : { leaveType: type, status: 'CONFIGURATION_REQUIRED', configured: false, entitlement: null, consumed: fmt(consumed), balance: null, note: 'Aucune règle de congé validée. Le solde n’est pas calculé.' };
        }),
      };
    }
    if (tail === '/pay-items' && method === 'POST') {
      const item = payroll.payItems.find((i) => i.id === payload.payItemId);
      if (!item) throw new ApiError(404, 'PAYROLL_PAY_ITEM_NOT_FOUND', 'Rubrique introuvable');
      const assignment: DemoAssignment = { id: uid(), company_id: companyId, employee_id: employee.id, pay_item_id: item.id, amount: fmt(money(payload.amount)), effective_from: payload.effectiveFrom, effective_to: payload.effectiveTo ?? null };
      payroll.assignments.push(assignment);
      return { assignment };
    }
  }
  if (rest === '/contracts' && method === 'GET') {
    return { contracts: payroll.contracts.filter((c) => c.company_id === companyId && (!query.employeeId || c.employee_id === query.employeeId)) };
  }
  if (rest === '/contracts' && method === 'POST') {
    if (!payload.changeReason) throw new ApiError(400, 'VALIDATION_ERROR', 'Motif obligatoire');
    const employee = employees.find((e) => e.id === payload.employeeId);
    if (!employee) throw new ApiError(404, 'PAYROLL_EMPLOYEE_NOT_FOUND', 'Salarié introuvable');
    for (const previous of payroll.contracts.filter((c) => c.employee_id === employee.id && c.status === 'active')) {
      previous.status = 'superseded';
      previous.effective_to = addDays(payload.effectiveFrom, -1);
    }
    const contract: DemoContract = {
      id: uid(), company_id: companyId, employee_id: employee.id, contract_type: payload.contractType,
      work_pattern: payload.workPattern, status: 'active', effective_from: payload.effectiveFrom,
      effective_to: payload.effectiveTo ?? null, base_salary: fmt(money(payload.baseSalary)),
      salary_period: payload.salaryPeriod, currency: payload.currency ?? 'MUR', weekly_hours: payload.weeklyHours ?? null,
      department: payload.department ?? employee.department, job_title: payload.jobTitle ?? employee.job_title,
      work_location: payload.workLocation ?? employee.work_location, change_reason: payload.changeReason,
      amendment_of: payload.amendmentOf ?? null, created_at: now(),
    };
    payroll.contracts.push(contract);
    payroll.events.push({ id: uid(), company_id: companyId, employee_id: employee.id, action: 'payroll.contract.create', reason: payload.changeReason, created_at: now(), actor: 'demo' });
    return { contract };
  }
  const terminate = /^\/contracts\/([^/]+)\/terminate$/.exec(rest);
  if (terminate && method === 'POST') {
    const contract = payroll.contracts.find((c) => c.id === terminate[1] && c.company_id === companyId);
    if (!contract) throw new ApiError(404, 'PAYROLL_CONTRACT_NOT_FOUND', 'Contrat introuvable');
    contract.status = 'terminated'; contract.effective_to = payload.effectiveTo;
    return { contract };
  }
  if (rest === '/pay-items' && method === 'GET') return { payItems: payroll.payItems };
  if (rest === '/pay-items' && method === 'POST') {
    if (payroll.payItems.some((i) => i.code.toLowerCase() === String(payload.code).toLowerCase())) throw new ApiError(409, 'PAYROLL_PAY_ITEM_CODE_TAKEN', 'Code déjà utilisé');
    const item: DemoPayItem = { id: uid(), company_id: companyId, code: String(payload.code).toUpperCase(), label_en: payload.labelEn, label_fr: payload.labelFr, category: payload.category, unit: payload.unit, calculation_method: payload.calculationMethod, treatment_status: 'UNVERIFIED', effective_from: payload.effectiveFrom, effective_to: payload.effectiveTo ?? null, source: payload.source ?? 'Démonstration' };
    payroll.payItems.push(item);
    return { payItem: item };
  }
  if (rest === '/time' && method === 'GET') {
    return { entries: payroll.time.filter((t) => t.company_id === companyId && (!query.employeeId || t.employee_id === query.employeeId)) };
  }
  if (rest === '/time' && method === 'POST') {
    if (payroll.time.some((t) => t.employee_id === payload.employeeId && t.work_date === payload.workDate)) throw new ApiError(409, 'PAYROLL_TIME_DUPLICATE', 'Une saisie existe déjà pour ce salarié et cette date');
    const entry: DemoTime = { id: uid(), company_id: companyId, employee_id: payload.employeeId, work_date: payload.workDate, hours_worked: fmt(money(payload.hoursWorked)), overtime_hours: fmt(money(payload.overtimeHours ?? 0)), lateness_minutes: payload.latenessMinutes ?? 0, note: payload.note ?? null, source: 'manual' };
    payroll.time.push(entry);
    return { entry };
  }
  if (rest === '/holidays' && method === 'GET') return { holidays: (payroll.holidays ?? []).filter((h) => h.company_id === companyId) };
  if (rest === '/holidays' && method === 'POST') {
    payroll.holidays ??= [];
    if (!payload.source) throw new ApiError(400, 'VALIDATION_ERROR', 'La source est obligatoire');
    if (payroll.holidays.some((h) => h.holiday_date === payload.holidayDate)) throw new ApiError(409, 'PAYROLL_HOLIDAY_DUPLICATE', 'Ce jour férié existe déjà');
    const holiday = { id: uid(), company_id: companyId, holiday_date: payload.holidayDate, name_en: payload.nameEn, name_fr: payload.nameFr, source: payload.source ?? null };
    payroll.holidays.push(holiday);
    return { holiday };
  }
  if (rest === '/time/import-file' && method === 'POST') {
    let headers: string[] = [];
    let sheetRows: string[][] = [];
    try {
      const bytes = payload.contentBase64
        ? Uint8Array.from(atob(String(payload.contentBase64)), (ch) => ch.charCodeAt(0))
        : new TextEncoder().encode(String(payload.contentText ?? ''));
      const parsed = parseUpload(String(payload.fileName ?? 'time.csv'), bytes);
      headers = parsed.sheets[0]?.headers ?? [];
      sheetRows = parsed.sheets[0]?.rows ?? [];
    } catch {
      throw new ApiError(400, 'PAYROLL_IMPORT_INVALID', 'Fichier illisible : utilisez CSV, TSV ou XLSX');
    }
    const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');
    const keys = headers.map((h) => {
      const n = normalize(h);
      if (n.includes('employee') || n.includes('matricule')) return 'employeeNumber';
      if (n.includes('workdate') || n === 'date') return 'workDate';
      if (n.includes('overtime') || n.includes('heuressup')) return 'overtimeHours';
      if (n.includes('lateness') || n.includes('retard')) return 'latenessMinutes';
      if (n.includes('hour') || n.includes('heure')) return 'hoursWorked';
      if (n.includes('note')) return 'note';
      return '';
    });
    let created = 0;
    let skipped = 0;
    sheetRows.forEach((values) => {
      const row: Record<string, string> = {};
      keys.forEach((key, i) => { if (key) row[key] = values[i] ?? ''; });
      const employee = employees.find((e) => e.employee_number === row.employeeNumber);
      if (!employee || !row.workDate) throw new ApiError(400, 'PAYROLL_IMPORT_INVALID', 'Ligne invalide : salarié ou date inconnue');
      const frenchDate = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(row.workDate);
      const workDate = frenchDate ? `${frenchDate[3]}-${frenchDate[2]}-${frenchDate[1]}` : row.workDate;
      if (payroll.time.some((t) => t.employee_id === employee.id && t.work_date === workDate)) { skipped += 1; return; }
      payroll.time.push({ id: uid(), company_id: companyId, employee_id: employee.id, work_date: workDate, hours_worked: fmt(money(row.hoursWorked ?? 0)), overtime_hours: fmt(money(row.overtimeHours ?? 0)), lateness_minutes: Number(row.latenessMinutes ?? 0), note: row.note ?? null, source: 'import' });
      created += 1;
    });
    return { created, skipped, rows: sheetRows.length };
  }
  if (rest === '/leave' && method === 'GET') return { absences: payroll.absences.filter((a) => a.company_id === companyId), rules: payroll.leaveRules.filter((r) => r.company_id === companyId) };
  if (rest === '/leave' && method === 'POST') {
    if (!payload.reason) throw new ApiError(400, 'VALIDATION_ERROR', 'Motif obligatoire');
    const absence: DemoAbsence = { id: uid(), company_id: companyId, employee_id: payload.employeeId, leave_type: payload.leaveType, start_date: payload.startDate, end_date: payload.endDate, days: fmt(money(payload.days)), status: 'requested', reason: payload.reason, decision_reason: null, document_ref: payload.documentRef ?? null, created_at: now() };
    payroll.absences.push(absence);
    return { absence };
  }
  const decision = /^\/leave\/([^/]+)\/decision$/.exec(rest);
  if (decision && method === 'POST') {
    if (payload.decision === 'rejected' && !payload.reason) throw new ApiError(400, 'VALIDATION_ERROR', 'Motif de refus obligatoire');
    const absence = payroll.absences.find((a) => a.id === decision[1]);
    if (!absence) throw new ApiError(404, 'PAYROLL_ABSENCE_NOT_FOUND', 'Demande introuvable');
    absence.status = payload.decision; absence.decision_reason = payload.reason ?? null;
    return { absence };
  }
  if (rest === '/leave-rules' && method === 'GET') return { rules: payroll.leaveRules.filter((r) => r.company_id === companyId) };
  if (rest === '/leave-rules' && method === 'POST') {
    const rule: DemoLeaveRule = { id: uid(), company_id: companyId, leave_type: payload.leaveType, days_per_year: fmt(money(payload.daysPerYear)), accrual_method: payload.accrualMethod ?? 'configured_annual', effective_from: payload.effectiveFrom, effective_to: payload.effectiveTo ?? null, status: 'UNVERIFIED', source: payload.source ?? null };
    payroll.leaveRules.push(rule);
    return { rule };
  }
  if (rest === '/rules' && method === 'GET') {
    return { rules: payroll.rules.filter((r) => r.company_id === companyId), required: payroll.rules.filter((r) => r.company_id === companyId && r.required_for_calculation).map((r) => ({ ruleCode: r.rule_code, found: true, validated: r.status === 'EXPERT_VALIDATED', expertValidated: r.status === 'EXPERT_VALIDATED', usable: ['RESEARCHED','REVIEW_REQUIRED','EXPERT_VALIDATED'].includes(r.status), status: r.status, rate: r.rate, effectiveFrom: r.effective_from })), statutoryEngineImplemented: true, statutoryFinalisationEnabled: false };
  }
  if (rest === '/rules' && method === 'POST') {
    const rule: DemoRule = { id: uid(), company_id: companyId, rule_code: String(payload.ruleCode).toUpperCase(), name_en: payload.nameEn, name_fr: payload.nameFr, legal_source: payload.legalSource ?? null, source_reference: payload.sourceReference ?? null, effective_from: payload.effectiveFrom ?? null, effective_to: payload.effectiveTo ?? null, calculation_basis: payload.calculationBasis ?? null, rate: payload.rate !== undefined && payload.rate !== null ? fmt(money(payload.rate)) : null, threshold_amount: null, cap_amount: null, rounding_policy: payload.roundingPolicy ?? null, status: 'UNVERIFIED', required_for_calculation: payload.requiredForCalculation ?? true, version: 1, test_cases: [], notes: payload.notes ?? null };
    payroll.rules.push(rule);
    return { rule };
  }
  const validateRule = /^\/rules\/([^/]+)\/validate$/.exec(rest);
  if (validateRule && method === 'POST') {
    if (!payload.confirm) throw new ApiError(400, 'PAYROLL_RULE_NOT_VALIDATED', 'Confirmation explicite requise');
    const rule = payroll.rules.find((r) => r.id === validateRule[1]);
    if (!rule) throw new ApiError(404, 'PAYROLL_RULE_NOT_FOUND', 'Règle introuvable');
    if (!(payload.legalSource || rule.legal_source) || !(payload.sourceReference || rule.source_reference) || !rule.effective_from) throw new ApiError(400, 'PAYROLL_RULE_NOT_VALIDATED', 'Source, référence et date d’effet requises');
    rule.status = 'EXPERT_VALIDATED';
    return { rule };
  }
  if (rest === '/periods' && method === 'GET') return { periods: payroll.periods.filter((p) => p.company_id === companyId).map(periodView) };
  if (rest === '/periods' && method === 'POST') {
    if (payroll.periods.some((p) => p.company_id === companyId && p.period_year === payload.year && p.period_month === payload.month)) throw new ApiError(409, 'PAYROLL_PERIOD_EXISTS', 'Cette période existe déjà');
    const bounds = periodBounds(payload.year, payload.month);
    const period: DemoPeriod = { id: uid(), company_id: companyId, period_year: payload.year, period_month: payload.month, start_date: bounds.start, end_date: bounds.end, payment_date: payload.paymentDate ?? bounds.end, status: 'draft', version: 1, calculated_at: null };
    payroll.periods.push(period);
    return { period };
  }
  if (rest === '/declarations' && method === 'GET') {
    const declarations = (payroll.mraDeclarations ?? [])
      .filter((d) => d.company_id === companyId && (!query.periodId || d.period_id === query.periodId))
      .sort((a, b) => b.preparedAt.localeCompare(a.preparedAt));
    return { declarations };
  }
  const declarationMatch = /^\/declarations\/([^/]+)(\/csv)?$/.exec(rest);
  if (declarationMatch && method === 'GET') {
    const declaration = (payroll.mraDeclarations ?? []).find((d) => d.id === declarationMatch[1] && d.company_id === companyId);
    if (!declaration) throw new ApiError(404, 'PAYROLL_DECLARATION_NOT_FOUND', 'Préparation introuvable');
    if (declarationMatch[2]) return { csv: demoDeclarationCsv(declaration) };
    return { declaration };
  }
  const periodMatch = /^\/periods\/([^/]+)(\/.*)?$/.exec(rest);
  if (periodMatch) {
    const period = payroll.periods.find((p) => p.id === periodMatch[1] && p.company_id === companyId);
    if (!period) throw new ApiError(404, 'PAYROLL_PERIOD_NOT_FOUND', 'Période introuvable');
    const tail = periodMatch[2] ?? '';
    if (tail === '/status' && method === 'PATCH') {
      if (payload.status === 'finalised') throw new ApiError(409, 'PAYROLL_RULES_NOT_VALIDATED', 'Règles obligatoires non validées : finalisation impossible');
      period.status = payload.status;
      return { period: periodView(period) };
    }
    if (tail === '/calculate' && method === 'POST') {
      if (period.status === 'draft') throw new ApiError(409, 'PAYROLL_PERIOD_TRANSITION', 'Passez en collecte de données avant de calculer');
      if (payroll.calculations.some((c) => c.period_id === period.id) && !payload.force) throw new ApiError(409, 'PAYROLL_ALREADY_CALCULATED', 'Période déjà calculée ; réouverture administrative explicite requise');
      payroll.calculations = payroll.calculations.filter((c) => c.period_id !== period.id);
      const calculations = calculate(payroll, companyId, period);
      payroll.calculations.push(...calculations);
      const blocked = calculations.some((c) => c.status === 'rules_incomplete');
      period.status = blocked ? 'blocked' : 'calculated'; period.calculated_at = now();
      return { period: periodView(period), version: period.version, calculations, blocked, expertReviewPending: !blocked, statutoryComplete: false, missingRules: calculations.flatMap((c) => c.missing_rules), engine: 'mission15-demo', finalisationBlocked: true };
    }
    if (tail === '/calculations' && method === 'GET') return { calculations: payroll.calculations.filter((c) => c.period_id === period.id && c.company_id === companyId) };
    if (tail === '/mra-return' && method === 'GET') {
      return demoDeclarationSummary(state, companyId, period.id, query.employerIdentifier ?? null);
    }
    if (tail === '/mra-return' && method === 'POST') {
      const summary = demoDeclarationSummary(state, companyId, period.id, payload.employerIdentifier ?? null);
      if (summary.blockers.length > 0) throw new ApiError(409, 'PAYROLL_DECLARATION_BLOCKED', 'Préparation bloquée par les contrôles de paie');
      const history = payroll.mraDeclarations ?? (payroll.mraDeclarations = []);
      const version = history.filter((d) => d.period_id === period.id && d.company_id === companyId).length + 1;
      const declaration: DemoMraDeclaration = {
        ...summary, id: uid(), company_id: companyId, period_id: period.id,
        version, preparedAt: now(), preparedBy: 'Démonstration',
      };
      history.push(declaration);
      return { declaration };
    }
    if (tail === '/variables/import-file' && method === 'POST') {
      let sheetRows: string[][] = [];
      let headers: string[] = [];
      try {
        const bytes = payload.contentBase64
          ? Uint8Array.from(atob(String(payload.contentBase64)), (ch) => ch.charCodeAt(0))
          : new TextEncoder().encode(String(payload.contentText ?? ''));
        const parsed = parseUpload(String(payload.fileName ?? 'variables.csv'), bytes);
        const sheet = parsed.sheets[0];
        headers = sheet?.headers ?? [];
        sheetRows = sheet?.rows ?? [];
      } catch {
        throw new ApiError(400, 'PAYROLL_IMPORT_INVALID', 'Fichier illisible : utilisez CSV, TSV ou XLSX');
      }
      const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');
      const keys = headers.map((h) => {
        const n = normalize(h);
        if (n.includes('employee') || n.includes('matricule')) return 'employeeNumber';
        if (n.includes('payitem') || n.includes('rubrique')) return 'payItemCode';
        if (n.includes('amount') || n.includes('montant')) return 'amount';
        if (n.includes('quantity') || n.includes('quantit')) return 'quantity';
        if (n.includes('rate') || n.includes('taux')) return 'rate';
        if (n.includes('ref')) return 'externalRef';
        return '';
      });
      let created = 0;
      let reused = 0;
      sheetRows.forEach((values) => {
        const row: Record<string, string> = {};
        keys.forEach((key, i) => { if (key) row[key] = values[i] ?? ''; });
        const employee = employees.find((e) => e.employee_number === row.employeeNumber);
        const item = payroll.payItems.find((i) => i.code === row.payItemCode);
        if (!employee || !item) throw new ApiError(400, 'PAYROLL_IMPORT_INVALID', 'Ligne invalide : salarié ou rubrique inconnue');
        const importKey = `${row.externalRef ?? row.employeeNumber}-${row.payItemCode}-${period.id}`;
        if (payroll.variables.some((v) => v.import_key === importKey)) { reused += 1; return; }
        payroll.variables.push({ id: uid(), company_id: companyId, period_id: period.id, employee_id: employee.id, pay_item_id: item.id, quantity: '1.0000', rate: '0.0000', amount: fmt(money(row.amount ?? 0)), note: null, status: 'draft', source: String(payload.fileName ?? '').endsWith('.xlsx') ? 'xlsx' : 'csv', import_key: importKey, created_at: now() });
        created += 1;
      });
      return { created, reused, skipped: 0, rows: created };
    }
    if (tail === '/variables/import' && method === 'POST') {
      const rows = Array.isArray(payload.rows) ? payload.rows : [];
      let created = 0; let reused = 0;
      rows.forEach((row: any, index: number) => {
        const employee = employees.find((e) => e.employee_number === row.employeeNumber);
        const item = payroll.payItems.find((i) => i.code === row.payItemCode);
        if (!employee || !item) throw new ApiError(400, 'PAYROLL_IMPORT_INVALID', `Ligne ${index + 1} invalide`);
        const importKey = `${row.externalRef ?? row.employeeNumber}-${row.payItemCode}-${period.id}`;
        if (payroll.variables.some((v) => v.import_key === importKey)) { reused += 1; return; }
        payroll.variables.push({ id: uid(), company_id: companyId, period_id: period.id, employee_id: employee.id, pay_item_id: item.id, quantity: '1.0000', rate: '0.0000', amount: fmt(money(row.amount ?? 0)), note: row.note ?? null, status: 'draft', source: payload.source ?? 'csv', import_key: importKey, created_at: now() });
        created += 1;
      });
      return { created, reused, skipped: 0, rows: created };
    }
    if (tail === '/accounting-preview' && method === 'GET') {
      return demoAccountingPreview(state, companyId, period.id);
    }
    if (tail === '/accounting-transfer' && method === 'GET') {
      return demoAccountingPreview(state, companyId, period.id);
    }
    if (tail === '/accounting-transfer' && method === 'POST') {
      return { transfer: demoGenerateTransfer(state, companyId, period.id, payload.note ?? null) };
    }
  }
  if (rest === '/variables' && method === 'GET') {
    return { variables: payroll.variables.filter((v) => v.company_id === companyId && (!query.periodId || v.period_id === query.periodId) && (!query.employeeId || v.employee_id === query.employeeId) && (!query.status || v.status === query.status)).map((v) => { const item = payroll.payItems.find((i) => i.id === v.pay_item_id)!; const employee = payroll.employees.find((e) => e.id === v.employee_id)!; return { ...v, pay_item_code: item.code, label_en: item.label_en, label_fr: item.label_fr, category: item.category, employee_number: employee.employee_number, full_name: employee.full_name }; }) };
  }
  if (rest === '/variables' && method === 'POST') {
    const item = payroll.payItems.find((i) => i.id === payload.payItemId);
    if (!item) throw new ApiError(404, 'PAYROLL_PAY_ITEM_NOT_FOUND', 'Rubrique introuvable');
    const quantity = money(payload.quantity ?? 1); const rate = money(payload.rate ?? 0);
    const amount = payload.amount !== undefined && payload.amount !== null ? money(payload.amount) : roundDiv(quantity * rate, 10_000n);
    const variable: DemoVariable = { id: uid(), company_id: companyId, period_id: payload.periodId, employee_id: payload.employeeId, pay_item_id: item.id, quantity: fmt(quantity), rate: fmt(rate), amount: fmt(amount), note: payload.note ?? null, status: payload.status === 'validated' ? 'validated' : 'draft', source: 'manual', import_key: null, created_at: now() };
    payroll.variables.push(variable);
    return { variable };
  }
  const validateVariable = /^\/variables\/([^/]+)\/validate$/.exec(rest);
  if (validateVariable && method === 'POST') {
    const variable = payroll.variables.find((v) => v.id === validateVariable[1]);
    if (!variable) throw new ApiError(404, 'PAYROLL_VARIABLE_NOT_FOUND', 'Variable introuvable');
    variable.status = 'validated';
    return { variable };
  }
  if (rest === '/payslips' && method === 'GET') return { payslips: payroll.payslips.filter((p) => p.company_id === companyId && (!query.periodId || p.period_id === query.periodId)).map((p) => { const employee = payroll.employees.find((e) => e.id === p.employee_id)!; const period = payroll.periods.find((x) => x.id === p.period_id)!; return { ...p, employee_number: employee.employee_number, full_name: employee.full_name, period_year: period.period_year, period_month: period.period_month }; }) };
  const reviewMatch = /^\/calculations\/([^/]+)\/(approve-for-test|request-review)$/.exec(rest);
  if (reviewMatch && method === 'POST') {
    const calculation = payroll.calculations.find((c) => c.id === reviewMatch[1] && c.company_id === companyId);
    if (!calculation) throw new ApiError(404, 'PAYROLL_CALCULATION_NOT_FOUND', 'Calcul introuvable');
    if (calculation.status === 'rules_incomplete') throw new ApiError(409, 'PAYROLL_RULES_NOT_VALIDATED', 'Règles incomplètes : approbation impossible');
    if (reviewMatch[2] === 'approve-for-test') {
      if (!payload.confirm || String(payload.note ?? '').trim().length < 10) throw new ApiError(400, 'PAYROLL_REVIEW_REQUIRED', 'Note de revue de 10 caractères minimum requise');
      calculation.status = 'approved_for_test'; calculation.statutory_status = 'APPROVED_FOR_TEST';
    } else {
      calculation.status = 'expert_review_pending'; calculation.statutory_status = 'EXPERT_REVIEW_PENDING';
    }
    return { calculation };
  }
  const calculationMatch = /^\/calculations\/([^/]+)(\/payslip)?$/.exec(rest);
  if (calculationMatch) {
    const calculation = payroll.calculations.find((c) => c.id === calculationMatch[1] && c.company_id === companyId);
    if (!calculation) throw new ApiError(404, 'PAYROLL_CALCULATION_NOT_FOUND', 'Calcul introuvable');
    if (!calculationMatch[2] && method === 'GET') return { calculation };
    if (calculationMatch[2] && method === 'POST') {
      const existing = payroll.payslips.find((p) => p.calculation_id === calculationMatch[1]);
      if (existing) return { payslip: existing, reused: true };
      const payslip = payslipFor(payroll, calculation, company);
      payroll.payslips.push(payslip);
      return { payslip, reused: false };
    }
  }
  const payslipMatch = /^\/payslips\/([^/]+)(\/.*)?$/.exec(rest);
  if (payslipMatch) {
    const payslip = payroll.payslips.find((p) => p.id === payslipMatch[1] && p.company_id === companyId);
    if (!payslip) throw new ApiError(404, 'PAYROLL_PAYSLIP_NOT_FOUND', 'Bulletin introuvable');
    if ((payslipMatch[2] ?? '') === '' && method === 'GET') return { payslip };
    if ((payslipMatch[2] ?? '') === '/finalise' && method === 'POST') throw new ApiError(409, 'PAYROLL_PAYSLIP_FINAL_BLOCKED', 'Bulletin final bloqué : règles et moteur réglementaire non validés');
  }
  if (rest === '/settings' && method === 'GET') return { settings: { company_id: companyId, salary_expense_account_id: null, salary_payable_account_id: null }, accounts: state.accounts.filter((a) => a.company_id === companyId), accountingTransferImplemented: true };
  if (rest === '/settings' && method === 'PATCH') return { settings: { company_id: companyId, ...payload }, accountingTransferImplemented: true };
  return undefined;
}

const declarationAmount = (value: unknown): string | null =>
  value === null || value === undefined || value === '' ? null : fmt(money(value));
const joinedAmounts = (values: (string | null)[]): string | null =>
  values.some((value) => value === null) ? null : fmt(values.reduce((sum, value) => sum + money(value), 0n));

export function demoDeclarationSummary(
  state: DemoState, companyId: string, periodId: string, employerIdentifier?: string | null,
) {
  const payroll = asState(state, companyId);
  const period = payroll.periods.find((p) => p.id === periodId && p.company_id === companyId);
  if (!period) throw new ApiError(404, 'PAYROLL_PERIOD_NOT_FOUND', 'Période introuvable');
  const company = state.companies.find((c) => c.id === companyId);
  const latest = new Map<string, DemoCalculation>();
  for (const calculation of payroll.calculations.filter((c) => c.period_id === periodId && c.company_id === companyId)) {
    const current = latest.get(calculation.employee_id);
    if (!current || calculation.version > current.version) latest.set(calculation.employee_id, calculation);
  }
  const employees = [...latest.values()]
    .map((calculation) => {
      const employee = payroll.employees.find((e) => e.id === calculation.employee_id && e.company_id === companyId);
      return {
        employeeId: calculation.employee_id,
        employeeNumber: calculation.employee_number,
        fullName: calculation.full_name,
        payFrequency: employee?.pay_frequency ?? 'monthly',
        workerType: employee?.worker_type ?? 'full_time',
        householdWorker: Boolean(employee?.is_household_worker),
        statutoryIdMasked: employee?.bank_account_last4 ? `•••• ${employee.statutory_id_last4 ?? ''}` : null,
        hasFullStatutoryId: false,
        currency: calculation.currency,
        basicWage: declarationAmount(calculation.basic_wage),
        gross: declarationAmount(calculation.gross),
        taxableEmoluments: declarationAmount(calculation.taxable_emoluments),
        paye: declarationAmount(calculation.paye),
        csgEmployee: declarationAmount(calculation.csg_employee),
        csgEmployer: declarationAmount(calculation.csg_employer),
        nsfEmployee: declarationAmount(calculation.nsf_employee),
        nsfEmployer: declarationAmount(calculation.nsf_employer),
        trainingLevy: declarationAmount(calculation.training_levy),
        status: calculation.status,
        missingRules: calculation.missing_rules,
      };
    })
    .sort((a, b) => String(a.employeeNumber).localeCompare(String(b.employeeNumber)));
  const fields = [
    'basicWage', 'gross', 'taxableEmoluments', 'paye', 'csgEmployee', 'csgEmployer',
    'nsfEmployee', 'nsfEmployer', 'trainingLevy',
  ] as const;
  const totals = Object.fromEntries(
    fields.map((field) => [field, joinedAmounts(employees.map((employee) => employee[field]))]),
  ) as Record<(typeof fields)[number], string | null>;
  const currencies = [...new Set(employees.map((employee) => employee.currency).filter(Boolean))];
  const incomplete = employees.filter((employee) => employee.status === 'rules_incomplete' || employee.missingRules.length > 0);
  const nullStatutory = employees.filter((employee) =>
    [employee.paye, employee.csgEmployee, employee.csgEmployer, employee.nsfEmployee,
      employee.nsfEmployer, employee.trainingLevy].some((value) => value === null));
  const active = payroll.employees.filter((employee) => employee.company_id === companyId &&
    ['active', 'probation'].includes(employee.employment_status));
  const missingNumbers = employees.filter((employee) => !employee.employeeNumber);
  const duplicateNumbers = Object.entries(employees.reduce<Record<string, number>>((acc, employee) => {
    acc[employee.employeeNumber] = (acc[employee.employeeNumber] ?? 0) + 1;
    return acc;
  }, {})).filter(([, count]) => count > 1).map(([number]) => number);
  const unvalidatedRules = payroll.rules.filter((rule) => rule.company_id === companyId &&
    rule.required_for_calculation && rule.status !== 'EXPERT_VALIDATED');
  const employer = String(employerIdentifier ?? '').trim();
  const checks: any[] = [
    { code: 'COMPANY_ISOLATION', severity: 'ok', scope: 'internal',
      messageEn: 'All rows are restricted to the selected company.', messageFr: 'Toutes les lignes sont limitées à la société sélectionnée.' },
    employees.length > 0
      ? { code: 'EMPLOYEES_PRESENT', severity: 'ok', scope: 'internal',
          messageEn: `${employees.length} calculation(s) found.`, messageFr: `${employees.length} calcul(s) trouvé(s).` }
      : { code: 'EMPLOYEES_PRESENT', severity: 'block', scope: 'internal',
          messageEn: 'No payroll calculation exists for this period.', messageFr: 'Aucun calcul de paie n’existe pour cette période.' },
    active.length > employees.length
      ? { code: 'EMPLOYEE_COVERAGE', severity: 'warning', scope: 'internal',
          messageEn: `${active.length - employees.length} active employee(s) have no calculation in this period.`,
          messageFr: `${active.length - employees.length} salarié(s) actif(s) n’ont pas de calcul sur cette période.`,
          count: active.length - employees.length }
      : { code: 'EMPLOYEE_COVERAGE', severity: 'ok', scope: 'internal',
          messageEn: 'Every active employee has a calculation.', messageFr: 'Chaque salarié actif possède un calcul.' },
    incomplete.length > 0
      ? { code: 'CALCULATIONS_INCOMPLETE', severity: 'block', scope: 'internal',
          messageEn: `${incomplete.length} calculation(s) are blocked by missing rules.`,
          messageFr: `${incomplete.length} calcul(s) sont bloqués par des règles manquantes.`, count: incomplete.length }
      : { code: 'CALCULATIONS_COMPLETE', severity: 'ok', scope: 'internal',
          messageEn: 'Every calculation uses a complete rule set.', messageFr: 'Chaque calcul utilise un jeu de règles complet.' },
    nullStatutory.length > 0
      ? { code: 'STATUTORY_VALUES_NULL', severity: 'block', scope: 'internal',
          messageEn: 'A statutory amount is unknown (null); zero is never substituted.',
          messageFr: 'Un montant statutaire est inconnu (null) ; zéro n’est jamais substitué.', count: nullStatutory.length }
      : { code: 'STATUTORY_VALUES_PRESENT', severity: 'ok', scope: 'internal',
          messageEn: 'PAYE, CSG, NSF and Training Levy are present for every employee.',
          messageFr: 'PAYE, CSG, NSF et Training Levy sont présents pour chaque salarié.' },
    currencies.length > 1
      ? { code: 'CURRENCY_MISMATCH', severity: 'block', scope: 'internal',
          messageEn: 'Several currencies are present in one monthly declaration.',
          messageFr: 'Plusieurs devises figurent dans une même déclaration mensuelle.', count: currencies.length }
      : { code: 'CURRENCY_CONSISTENCY', severity: 'ok', scope: 'internal',
          messageEn: `Single currency: ${currencies[0] ?? 'MUR'}.`, messageFr: `Devise unique : ${currencies[0] ?? 'MUR'}.` },
    duplicateNumbers.length > 0
      ? { code: 'DUPLICATE_EMPLOYEE_NUMBER', severity: 'block', scope: 'internal',
          messageEn: `Duplicate employee number(s): ${duplicateNumbers.join(', ')}.`,
          messageFr: `Numéro(s) de salarié en doublon : ${duplicateNumbers.join(', ')}.`, count: duplicateNumbers.length }
      : { code: 'NO_DUPLICATE_EMPLOYEE', severity: 'ok', scope: 'internal',
          messageEn: 'No duplicate employee number in the latest calculation set.',
          messageFr: 'Aucun numéro de salarié en doublon dans les derniers calculs.' },
    missingNumbers.length > 0
      ? { code: 'EMPLOYEE_NUMBER_MISSING', severity: 'block', scope: 'internal',
          messageEn: 'An employee has no payroll number.', messageFr: 'Un salarié n’a pas de matricule.', count: missingNumbers.length }
      : { code: 'TOTALS_RECOMPUTED', severity: 'ok', scope: 'internal',
          messageEn: 'Company totals are recomputed from every employee amount.',
          messageFr: 'Les totaux société sont recalculés depuis chaque montant salarié.' },
    employer
      ? { code: 'EMPLOYER_IDENTIFIER_PRESENT', severity: 'ok', scope: 'internal',
          messageEn: 'A local employer identifier is recorded. It is not an MRA credential.',
          messageFr: 'Un identifiant employeur local est enregistré. Ce n’est pas un identifiant MRA.' }
      : { code: 'EMPLOYER_IDENTIFIER_REQUIRED', severity: 'warning', scope: 'internal',
          messageEn: 'A fictitious employer identifier is required before archiving the preparation.',
          messageFr: 'Un identifiant employeur fictif est requis avant d’archiver la préparation.' },
    unvalidatedRules.length > 0
      ? { code: 'RULES_NOT_VALIDATED', severity: 'warning', scope: 'internal',
          messageEn: `${unvalidatedRules.length} required rule(s) are not expert-validated.`,
          messageFr: `${unvalidatedRules.length} règle(s) obligatoire(s) ne sont pas validées par un expert.`, count: unvalidatedRules.length }
      : { code: 'RULES_VALIDATED', severity: 'ok', scope: 'internal',
          messageEn: 'Every required rule is expert-validated.', messageFr: 'Toutes les règles obligatoires sont validées par un expert.' },
  ];
  const officialReasons = [
    { code: 'EMPLOYEE_FULL_NIC_MISSING',
      messageEn: 'The official PACO template requires the full 14-character employee NIC/NCID; this application stores only the last four digits and a fingerprint.',
      messageFr: 'Le modèle officiel PACO exige le NIC/NCID complet du salarié (14 caractères) ; cette application ne conserve que les quatre derniers chiffres et une empreinte.' },
    { code: 'EMPLOYER_ERN_MISSING',
      messageEn: 'The employer ERN, declarant name and mandatory contact fields are not stored.',
      messageFr: 'L’ERN employeur, le nom du déclarant et les coordonnées obligatoires ne sont pas stockés.' },
    { code: 'TEMPLATE_NOT_FULLY_VERIFIED',
      messageEn: 'The December 2024 MRA specification fields were read, but the official CSV template file was unavailable (HTTP 500), so the complete line layout was not verified.',
      messageFr: 'Les champs de la spécification MRA de décembre 2024 ont été lus, mais le modèle CSV officiel était indisponible (HTTP 500) ; la structure complète des lignes n’a pas été vérifiée.' },
    { code: 'WHOLE_RUPEE_RULE_UNVERIFIED',
      messageEn: 'The official template requires whole rupees without cents; no law fixes a rounding rule for CSG/NSF/levy, so exact four-decimal values are kept and never rounded silently.',
      messageFr: 'Le modèle officiel exige des roupies entières sans centimes ; aucun texte ne fixe l’arrondi CSG/NSF/levy, donc les valeurs exactes à quatre décimales sont conservées et jamais arrondies en silence.' },
  ];
  const officialChecks = officialReasons.map((reason) => ({ ...reason, severity: 'block', scope: 'official' }));
  const blockers = checks.filter((check) => check.severity === 'block');
  const warnings = checks.filter((check) => check.severity === 'warning');
  return {
    id: null as string | null,
    version: null as number | null,
    preparedAt: null as string | null,
    preparedBy: null as string | null,
    company: {
      id: companyId, name: company?.name ?? null, brn: company?.brn ?? null,
      contactEmail: (company as any)?.contact_email ?? null,
      contactPhone: (company as any)?.contact_phone ?? null,
    },
    period: {
      id: period.id, year: period.period_year, month: period.period_month,
      start: period.start_date, end: period.end_date, status: period.status,
      label: `${String(period.period_month).padStart(2, '0')}/${period.period_year}`,
    },
    employerIdentifier: employer || null,
    currency: currencies[0] ?? 'MUR',
    employees,
    totals,
    checks,
    officialChecks,
    blockers,
    warnings,
    officialCsv: {
      available: false, status: 'NOT_AVAILABLE', reasons: officialReasons,
      specificationUrl: 'https://www.mra.mu/download/SpecsMonthlyPACODec2024.pdf',
      templateUrl: 'https://www.mra.mu/download/csvTemplate_paco_Dec2024.csv',
    },
    internalCsvAvailable: blockers.length === 0 && Boolean(employer),
    canPrepare: blockers.length === 0 && Boolean(employer),
    regulatoryExportBlocked: true,
    regulatoryStatus: 'NOT_SUBMITTED',
    status: 'PREPARATION_ONLY',
    preparationStatus: blockers.length > 0 ? 'BLOCKED' : 'PREPARATION_ONLY',
    employeesActive: active.length,
    submission: 'NOT_SUBMITTED',
    notice: 'Préparation locale et fictive. Aucune transmission MRA, aucun identifiant réel, aucun paiement.',
    noticeEn: 'Local, fictional preparation. No MRA transmission, no real credential, no payment.',
    gross: fmt(employees.reduce((sum, employee) => sum + money(employee.gross), 0n)),
    paye: fmt(employees.reduce((sum, employee) => sum + money(employee.paye), 0n)),
    csg_employee: fmt(employees.reduce((sum, employee) => sum + money(employee.csgEmployee), 0n)),
    csg_employer: fmt(employees.reduce((sum, employee) => sum + money(employee.csgEmployer), 0n)),
    nsf_employee: fmt(employees.reduce((sum, employee) => sum + money(employee.nsfEmployee), 0n)),
    nsf_employer: fmt(employees.reduce((sum, employee) => sum + money(employee.nsfEmployer), 0n)),
    training_levy: fmt(employees.reduce((sum, employee) => sum + money(employee.trainingLevy), 0n)),
    employeesCount: employees.length,
    employees_count: employees.length,
    approved_for_test: employees.filter((employee) => employee.status === 'approved_for_test').length,
    incomplete: incomplete.length,
  };
}

const csvCell = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
const csvLine = (cells: unknown[]) => cells.map(csvCell).join(',');

export function demoDeclarationCsv(declaration: DemoMraDeclaration): string {
  const rows: string[] = [];
  rows.push(csvLine(['PAYROLL DECLARATION - INTERNAL PREPARATION - NOT SUBMITTED TO MRA']));
  rows.push(csvLine(['SIMULATION - NOT VALIDATED FOR PAYMENT']));
  rows.push(csvLine(['Declaration ID', declaration.id]));
  rows.push(csvLine(['Prepared at', declaration.preparedAt ?? '']));
  rows.push(csvLine(['Company', declaration.company?.name ?? '']));
  rows.push(csvLine(['Employer identifier (local, fictitious)', declaration.employerIdentifier ?? '']));
  rows.push(csvLine(['Period', declaration.period?.label ?? '']));
  rows.push(csvLine(['Currency', declaration.currency ?? '']));
  rows.push(csvLine(['Status', declaration.status ?? 'BLOCKED']));
  rows.push(csvLine(['Submission', 'NOT_SUBMITTED']));
  rows.push('');
  rows.push(csvLine(['TOTALS']));
  rows.push(csvLine(['Employees', declaration.employees?.length ?? 0]));
  rows.push(csvLine(['Gross emoluments', declaration.totals?.gross ?? '']));
  rows.push(csvLine(['Basic wage', declaration.totals?.basicWage ?? '']));
  rows.push(csvLine(['Taxable emoluments', declaration.totals?.taxableEmoluments ?? '']));
  rows.push(csvLine(['PAYE withheld', declaration.totals?.paye ?? '']));
  rows.push(csvLine(['CSG employee', declaration.totals?.csgEmployee ?? '']));
  rows.push(csvLine(['CSG employer', declaration.totals?.csgEmployer ?? '']));
  rows.push(csvLine(['NSF employee', declaration.totals?.nsfEmployee ?? '']));
  rows.push(csvLine(['NSF employer', declaration.totals?.nsfEmployer ?? '']));
  rows.push(csvLine(['Training Levy', declaration.totals?.trainingLevy ?? '']));
  rows.push('');
  rows.push(csvLine(['EMPLOYEE DETAILS']));
  rows.push(csvLine(['Employee number', 'Employee', 'Pay frequency', 'Currency', 'Basic wage',
    'Gross emoluments', 'Taxable emoluments', 'PAYE', 'CSG employee', 'CSG employer',
    'NSF employee', 'NSF employer', 'Training Levy', 'Calculation status']));
  for (const employee of declaration.employees ?? []) {
    rows.push(csvLine([employee.employeeNumber, employee.fullName, employee.payFrequency, employee.currency,
      employee.basicWage, employee.gross, employee.taxableEmoluments, employee.paye,
      employee.csgEmployee, employee.csgEmployer, employee.nsfEmployee, employee.nsfEmployer,
      employee.trainingLevy, employee.status]));
  }
  rows.push('');
  rows.push(csvLine(['OFFICIAL MRA CSV', 'NOT GENERATED', 'This file must not be submitted to the MRA']));
  for (const reason of declaration.officialCsv?.reasons ?? []) {
    rows.push(csvLine([reason.code, reason.messageEn, reason.messageFr]));
  }
  return '\uFEFF' + rows.join('\r\n');
}

export function payrollReturnCsv(state: DemoState, companyId: string, periodId: string): string {
  const payroll = asState(state, companyId);
  const period = payroll.periods.find((p) => p.id === periodId && p.company_id === companyId);
  const rows: string[][] = [['PREPARATION ONLY - NOT SUBMITTED TO MRA'], ['Period', period ? `${period.period_year}-${String(period.period_month).padStart(2, '0')}` : '']];
  rows.push(['Field', 'Amount (MUR)']);
  for (const [label, value] of [
    ['Gross emoluments', 'gross'], ['PAYE withheld', 'paye'], ['CSG employee', 'csg_employee'], ['CSG employer', 'csg_employer'],
    ['NSF employee', 'nsf_employee'], ['NSF employer', 'nsf_employer'], ['Training levy', 'training_levy'],
  ] as [string, keyof DemoCalculation][]) {
    const total = payroll.calculations.filter((c) => c.period_id === periodId && c.company_id === companyId).reduce((acc, c) => acc + money(c[value] as string | null), 0n);
    rows.push([label, fmt(total)]);
  }
  rows.push(['Status', 'PREPARATION_ONLY']);
  return '\uFEFF' + rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\r\n');
}

export function payrollCsv(state: DemoState, companyId: string): string {
  const payroll = asState(state, companyId);
  const rows: string[][] = [['Payslip', 'Status', 'Period', 'Employee number', 'Employee', 'Currency', 'Gross', 'Deductions', 'Net arithmetic', 'Net payable', 'Disclaimer']];
  for (const payslip of payroll.payslips.filter((p) => p.company_id === companyId)) {
    const employee = payroll.employees.find((e) => e.id === payslip.employee_id);
    const snap = payslip.snapshot;
    const period = snap.period?.year
      ? `${snap.period.year}-${String(snap.period.month).padStart(2, '0')}`
      : '';
    rows.push([payslip.payslip_no, payslip.status, period, employee?.employee_number ?? '', employee?.full_name ?? '', snap.currency, snap.totals.gross, snap.totals.deductions, snap.totals.netArithmetic, '', 'SIMULATION - NOT FOR PAYMENT']);
  }
  return '\uFEFF' + rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(';')).join('\r\n');
}
