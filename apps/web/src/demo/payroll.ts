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
  notes: string | null;
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
  full_name: string; version: number; status: 'blocked' | 'simulated'; currency: string;
  contract_id: string | null; base_amount: string; proration_days: string | null; period_days: number;
  earnings: string; gross: string; deductions: string; net_arithmetic: string;
  paye: null; csg: null; nsf: null; employer_contributions: null; statutory_complete: false;
  missing_rules: { ruleCode: string; status: string; reason: string }[];
  warnings: { code: string; message: string }[]; input_hash: string; rule_version: string;
  calculated_at: string; lines: DemoLine[]; bankAccountMasked: string | null;
}
interface DemoPayslip {
  id: string; company_id: string; calculation_id: string; period_id: string; employee_id: string;
  payslip_no: string; status: 'simulation'; version: number; snapshot: any; generated_at: string;
}

interface DemoPayrollState {
  employees: DemoEmployee[];
  contracts: DemoContract[];
  events: DemoEvent[];
  payItems: DemoPayItem[];
  assignments: DemoAssignment[];
  time: DemoTime[];
  absences: DemoAbsence[];
  leaveRules: DemoLeaveRule[];
  rules: DemoRule[];
  periods: DemoPeriod[];
  variables: DemoVariable[];
  calculations: DemoCalculation[];
  payslips: DemoPayslip[];
  sequences: Record<string, number>;
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
    date_of_birth: `199${index % 9}-0${(index % 9) + 1}-1${index % 9}`,
    nationality: number === 'J010' ? 'French' : 'Mauritian',
    country_of_residence: 'Mauritius',
    address: `${index + 1}, Rue Fictive, Port Louis (fictif)`,
    email: `${number.toLowerCase()}@demo-fictif.test`, phone: '+230 5000 00 00',
    employment_status: 'active', hire_date: number === 'D004' ? '2026-07-16' : '2024-01-15',
    termination_date: null, department: index % 3 === 0 ? 'Administration' : 'Opérations',
    job_title: job, work_location: 'Port Louis', manager_employee_id: null,
    cost_centre: `CC-DEMO-${index + 1}`, payroll_currency: 'MUR',
    payment_method: 'bank_transfer', bank_name: 'Banque Fictive de Démonstration',
    bank_account_last4: String(4000 + index), statutory_id_last4: number === 'J010' ? '9010' : '7000',
    statutory_ref_last4: `00${index}`, emergency_contact_name: 'Contact fictif',
    emergency_contact_phone: '+230 5000 00 01', emergency_contact_relation: 'Famille (fictif)',
    notes: 'Dossier de démonstration entièrement fictif', created_at: created, updated_at: created,
  }));
  const byNumber = new Map(employees.map((e) => [e.employee_number, e]));
  const contractSeed: [string, number, string, string, string, string | null][] = [
    ['A001', 30000, 'monthly', 'permanent', '2024-01-15', null],
    ['B002', 250, 'hourly', 'permanent', '2024-01-15', null],
    ['C003', 12000, 'monthly', 'permanent', '2024-01-15', null],
    ['D004', 30000, 'monthly', 'permanent', '2026-07-16', null],
    ['E005', 20000, 'monthly', 'permanent', '2024-01-15', '2026-07-15'],
    ['F006', 18000, 'monthly', 'permanent', '2024-01-15', null],
    ['G007', 22000, 'monthly', 'permanent', '2024-01-15', null],
    ['H008', 26000, 'monthly', 'permanent', '2024-01-15', null],
    ['I009', 24000, 'monthly', 'permanent', '2024-01-15', null],
    ['J010', 28000, 'monthly', 'permanent', '2024-01-15', null],
    ['K011', 21000, 'monthly', 'fixed_term', '2024-01-15', '2026-12-31'],
    ['L012', 20000, 'monthly', 'permanent', '2026-07-01', null],
  ];
  const contracts: DemoContract[] = contractSeed.map(([number, salary, period, type, from, to]) => ({
    id: uid(), company_id: companyId, employee_id: byNumber.get(number)!.id,
    contract_type: type, work_pattern: number === 'B002' || number === 'C003' ? 'part_time' : 'full_time',
    status: to === '2026-07-15' ? 'superseded' : 'active', effective_from: from, effective_to: to,
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
    effective_from: '2026-07-16', effective_to: null, base_salary: '24000.0000',
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
    id: uid(), company_id: companyId, period_year: 2026, period_month: 7,
    start_date: '2026-07-01', end_date: '2026-07-31', payment_date: '2026-07-31',
    status: 'data_collection', version: 1, calculated_at: null,
  };
  const time: DemoTime[] = [
    { id: uid(), company_id: companyId, employee_id: byNumber.get('B002')!.id, work_date: '2026-07-06', hours_worked: '8.00', overtime_hours: '2.00', lateness_minutes: 0, note: 'Heures fictives, majoration non paramétrée', source: 'manual' },
    { id: uid(), company_id: companyId, employee_id: byNumber.get('B002')!.id, work_date: '2026-07-07', hours_worked: '8.00', overtime_hours: '0.00', lateness_minutes: 10, note: 'Retard fictif', source: 'manual' },
  ];
  const absences: DemoAbsence[] = [{
    id: uid(), company_id: companyId, employee_id: byNumber.get('F006')!.id,
    leave_type: 'unpaid', start_date: '2026-07-20', end_date: '2026-07-22', days: '3.00',
    status: 'approved', reason: 'Absence non rémunérée fictive', decision_reason: 'Validation fictive de démonstration',
    document_ref: 'FICT-DOC-001', created_at: created,
  }];
  const rules: DemoRule[] = ['PAYE', 'CSG', 'NSF'].map((code) => ({
    id: uid(), company_id: companyId, rule_code: code,
    name_en: `${code} (placeholder - no rate)`, name_fr: `${code} (paramètre - aucun taux)`,
    legal_source: null, source_reference: null, effective_from: null, effective_to: null,
    calculation_basis: null, rate: null, threshold_amount: null, cap_amount: null,
    rounding_policy: null, status: 'UNVERIFIED', required_for_calculation: true, version: 1,
    test_cases: [], notes: 'Aucun taux, aucun seuil, aucune source légale. Revue experte requise.',
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
    employees, contracts, events: [], payItems, assignments, time, absences, leaveRules: [],
    rules, periods: [period], variables, calculations: [], payslips: [], sequences: {},
  };
  demo.calculations = calculate(demo, companyId, period);
  demo.payslips = [payslipFor(demo, demo.calculations.find((c) => c.employee_number === 'A001')!, `${company.name}`)];
  demo.periods[0]!.status = 'blocked';
  (state as any).payroll = demo;
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
    .filter((r) => r.required_for_calculation && r.status !== 'EXPERT_VALIDATED')
    .map((r) => ({ ruleCode: r.rule_code, status: r.status, reason: 'NOT_EXPERT_VALIDATED' }));
  missing.push({ ruleCode: 'STATUTORY_ENGINE', status: 'NOT_IMPLEMENTED', reason: 'PAYROLL_STATUTORY_ENGINE_NOT_IMPLEMENTED' });
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
    const gross = base + earnings;
    const net = gross + reimbursements - deductions;
    return {
      id: uid(), company_id: companyId, period_id: period.id, employee_id: employee.id,
      employee_number: employee.employee_number, full_name: employee.full_name, version: 1,
      status: 'blocked', currency, contract_id: contracts[0]?.id ?? null, base_amount: fmt(base),
      proration_days: active.length === allDays.length ? null : `${active.length}.0000`, period_days: allDays.length,
      earnings: fmt(earnings), gross: fmt(gross), deductions: fmt(deductions), net_arithmetic: fmt(net),
      paye: null, csg: null, nsf: null, employer_contributions: null, statutory_complete: false,
      missing_rules: missing, warnings, input_hash: `demo-${Date.now()}-${employee.id}`,
      rule_version: 'rules:PAYE=UNVERIFIED,CSG=UNVERIFIED,NSF=UNVERIFIED;engine=not_implemented',
      calculated_at: now(), lines, bankAccountMasked: employee.bank_account_last4 ? `•••• ${employee.bank_account_last4}` : null,
    };
  });
}

function payslipFor(payroll: DemoPayrollState, calculation: DemoCalculation, companyName: string): DemoPayslip {
  const employee = payroll.employees.find((e) => e.id === calculation.employee_id)!;
  return {
    id: uid(), company_id: calculation.company_id, calculation_id: calculation.id,
    period_id: calculation.period_id, employee_id: calculation.employee_id,
    payslip_no: `SIM-202607-${String(payroll.payslips.length + 1).padStart(4, '0')}`,
    status: 'simulation', version: 1, generated_at: now(),
    snapshot: {
      disclaimer: 'SIMULATION / DRAFT — NOT FOR PAYMENT. Ce bulletin n’est pas officiel.',
      company: { name: companyName, brn: 'BRN-DEMO-FICTIF' },
      employee: { number: employee.employee_number, name: employee.full_name, bankAccountMasked: calculation.bankAccountMasked },
      period: { year: 2026, month: 7 }, currency: calculation.currency,
      lines: calculation.lines,
      totals: {
        base: calculation.base_amount, gross: calculation.gross, deductions: calculation.deductions,
        netArithmetic: calculation.net_arithmetic, paye: null, csg: null, nsf: null, netPayable: null,
      },
      status: 'blocked', missingRules: calculation.missing_rules, warnings: calculation.warnings,
      calculationVersion: 1, generatedAt: now(),
    },
  };
}

function asState(state: DemoState, companyId: string): DemoPayrollState {
  if (!(state as any).payroll) seedDemoPayroll(state);
  const payroll = (state as any).payroll as DemoPayrollState;
  if (!payroll || !payroll.periods.some((p) => p.company_id === companyId)) {
    // A second demo company has no seeded payroll: return an honest empty set.
    return { employees: [], contracts: [], events: [], payItems: payroll?.payItems ?? [], assignments: [], time: [], absences: [], leaveRules: [], rules: [], periods: [], variables: [], calculations: [], payslips: [], sequences: {} };
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
    rules: payroll.rules.filter((r) => r.company_id === companyId && r.required_for_calculation).map((r) => ({ ruleCode: r.rule_code, found: true, validated: r.status === 'EXPERT_VALIDATED', status: r.status, rate: r.rate, effectiveFrom: r.effective_from })),
    calculationAvailable: true, statutoryComplete: false,
    capabilities: { employees: true, contracts: true, time: true, leave: true, variables: true, arithmeticCalculation: true, statutoryCalculation: false, finalPayslips: false, statutoryDeclarations: false, accountingTransfer: false, paye: false, csg: false, nsf: false, employerContributions: false },
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
    return { rules: payroll.rules.filter((r) => r.company_id === companyId), required: payroll.rules.filter((r) => r.company_id === companyId && r.required_for_calculation).map((r) => ({ ruleCode: r.rule_code, found: true, validated: r.status === 'EXPERT_VALIDATED', status: r.status, rate: r.rate, effectiveFrom: r.effective_from })), statutoryEngineImplemented: false };
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
      period.status = 'blocked'; period.calculated_at = now();
      return { period: periodView(period), version: period.version, calculations, blocked: true, statutoryComplete: false, missingRules: calculations[0]?.missing_rules ?? [], missingEngine: 'PAYROLL_STATUTORY_ENGINE_NOT_IMPLEMENTED' };
    }
    if (tail === '/calculations' && method === 'GET') return { calculations: payroll.calculations.filter((c) => c.period_id === period.id && c.company_id === companyId) };
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
      return { period: periodView(period), totalsByCurrency: [], accountsConfigured: false, postingBlocked: true, reason: 'PAYROLL_ACCOUNTING_NOT_IMPLEMENTED', note: 'Aucune écriture comptable n’est créée.' };
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
  const calculationMatch = /^\/calculations\/([^/]+)(\/payslip)?$/.exec(rest);
  if (calculationMatch) {
    const calculation = payroll.calculations.find((c) => c.id === calculationMatch[1] && c.company_id === companyId);
    if (!calculation) throw new ApiError(404, 'PAYROLL_CALCULATION_NOT_FOUND', 'Calcul introuvable');
    if (!calculationMatch[2] && method === 'GET') return { calculation };
    if (calculationMatch[2] && method === 'POST') {
      const existing = payroll.payslips.find((p) => p.calculation_id === calculationMatch[1]);
      if (existing) return { payslip: existing, reused: true };
      const payslip = payslipFor(payroll, calculation, company.name);
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
  if (rest === '/settings' && method === 'GET') return { settings: { company_id: companyId, salary_expense_account_id: null, salary_payable_account_id: null }, accounts: state.accounts.filter((a) => a.company_id === companyId), accountingTransferImplemented: false };
  if (rest === '/settings' && method === 'PATCH') return { settings: { company_id: companyId, ...payload }, accountingTransferImplemented: false };
  return undefined;
}

export function payrollCsv(state: DemoState, companyId: string): string {
  const payroll = asState(state, companyId);
  const rows: string[][] = [['Payslip', 'Status', 'Period', 'Employee number', 'Employee', 'Currency', 'Gross', 'Deductions', 'Net arithmetic', 'Net payable', 'Disclaimer']];
  for (const payslip of payroll.payslips.filter((p) => p.company_id === companyId)) {
    const employee = payroll.employees.find((e) => e.id === payslip.employee_id);
    const snap = payslip.snapshot;
    rows.push([payslip.payslip_no, payslip.status, '2026-07', employee?.employee_number ?? '', employee?.full_name ?? '', snap.currency, snap.totals.gross, snap.totals.deductions, snap.totals.netArithmetic, '', 'SIMULATION - NOT FOR PAYMENT']);
  }
  return '\uFEFF' + rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(';')).join('\r\n');
}
