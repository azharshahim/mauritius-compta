import { createHash } from 'node:crypto';
import type { Db } from '../../db/index.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { writeAudit } from '../../lib/audit.js';
import { formatAmount, parseAmount } from '../../lib/money.js';
import {
  assertOpenPeriod,
  insertLines,
  loadAccounts,
  loadJournal,
  nextEntryNo,
  prepareEntry,
} from '../entries/service.js';
import type { PayrollActor } from './service.js';

/**
 * Mission 18 — payroll to accounting bridge.
 *
 * The bridge only prepares and snapshots balanced accounting proposals. It
 * never posts automatically: an authorised human must approve the proposal, and
 * the definitive posting remains blocked while the payroll rules and
 * calculations are not validated for real use.
 */

type Severity = 'ok' | 'warning' | 'block';
type Scope = 'internal' | 'posting';

export interface AccountingCheck {
  code: string;
  severity: Severity;
  scope: Scope;
  messageEn: string;
  messageFr: string;
  count?: number;
}

interface AccountInfo {
  id: string;
  code: string;
  name: string;
  type: string;
  isActive: boolean;
}

interface JournalInfo {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
}

export interface MappingInput {
  journalId: string;
  wagesExpenseAccountId: string;
  employerCsgExpenseAccountId: string;
  employerNsfExpenseAccountId: string;
  trainingLevyExpenseAccountId: string;
  payePayableAccountId: string;
  csgEmployeePayableAccountId: string;
  csgEmployerPayableAccountId: string;
  nsfEmployeePayableAccountId: string;
  nsfEmployerPayableAccountId: string;
  trainingLevyPayableAccountId: string;
  netPayableAccountId: string;
  otherDeductionsPayableAccountId?: string | null;
  reimbursementsAccountId?: string | null;
  note?: string | null;
  confirm: boolean;
}

interface MappingRow {
  id: string;
  company_id: string;
  version: number;
  status: 'VALIDATED' | 'SUPERSEDED';
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
  note: string | null;
  validated_by: string | null;
  validated_at: string;
  superseded_at: string | null;
  validated_by_name?: string | null;
}

export const MAPPING_FIELDS = [
  { key: 'wagesExpense', inputKey: 'wagesExpenseAccountId', column: 'wages_expense_account_id', required: true,
    labelEn: 'Gross remuneration expense', labelFr: 'Charge de rémunérations brutes' },
  { key: 'employerCsgExpense', inputKey: 'employerCsgExpenseAccountId', column: 'employer_csg_expense_account_id', required: true,
    labelEn: 'Employer CSG expense', labelFr: 'Charge patronale CSG' },
  { key: 'employerNsfExpense', inputKey: 'employerNsfExpenseAccountId', column: 'employer_nsf_expense_account_id', required: true,
    labelEn: 'Employer NSF expense', labelFr: 'Charge patronale NSF' },
  { key: 'trainingLevyExpense', inputKey: 'trainingLevyExpenseAccountId', column: 'training_levy_expense_account_id', required: true,
    labelEn: 'Training Levy expense', labelFr: 'Charge Training Levy' },
  { key: 'payePayable', inputKey: 'payePayableAccountId', column: 'paye_payable_account_id', required: true,
    labelEn: 'PAYE payable', labelFr: 'PAYE à payer' },
  { key: 'csgEmployeePayable', inputKey: 'csgEmployeePayableAccountId', column: 'csg_employee_payable_account_id', required: true,
    labelEn: 'Employee CSG payable', labelFr: 'CSG salarié à payer' },
  { key: 'csgEmployerPayable', inputKey: 'csgEmployerPayableAccountId', column: 'csg_employer_payable_account_id', required: true,
    labelEn: 'Employer CSG payable', labelFr: 'CSG employeur à payer' },
  { key: 'nsfEmployeePayable', inputKey: 'nsfEmployeePayableAccountId', column: 'nsf_employee_payable_account_id', required: true,
    labelEn: 'Employee NSF payable', labelFr: 'NSF salarié à payer' },
  { key: 'nsfEmployerPayable', inputKey: 'nsfEmployerPayableAccountId', column: 'nsf_employer_payable_account_id', required: true,
    labelEn: 'Employer NSF payable', labelFr: 'NSF employeur à payer' },
  { key: 'trainingLevyPayable', inputKey: 'trainingLevyPayableAccountId', column: 'training_levy_payable_account_id', required: true,
    labelEn: 'Training Levy payable', labelFr: 'Training Levy à payer' },
  { key: 'netPayable', inputKey: 'netPayableAccountId', column: 'net_payable_account_id', required: true,
    labelEn: 'Net wages payable', labelFr: 'Salaires nets à payer' },
  { key: 'otherDeductionsPayable', inputKey: 'otherDeductionsPayableAccountId', column: 'other_deductions_payable_account_id', required: false,
    labelEn: 'Other deductions payable', labelFr: 'Autres retenues à payer' },
  { key: 'reimbursements', inputKey: 'reimbursementsAccountId', column: 'reimbursements_account_id', required: false,
    labelEn: 'Reimbursements', labelFr: 'Remboursements' },
] as const;

type MappingKey = (typeof MAPPING_FIELDS)[number]['key'];
type MappingColumn = (typeof MAPPING_FIELDS)[number]['column'];

const money = (value: unknown): bigint => {
  if (value === null || value === undefined || value === '') return 0n;
  try {
    return parseAmount(value);
  } catch {
    throw badRequest('VALIDATION_ERROR', 'Invalid amount in the payroll calculation');
  }
};
const fmt = (value: bigint) => formatAmount(value);
const nullableAmount = (value: unknown) =>
  value === null || value === undefined || value === '' ? null : money(value);
const sumNullable = (values: (bigint | null)[]): bigint | null =>
  values.some((value) => value === null)
    ? null
    : (values as bigint[]).reduce((total, value) => total + value, 0n);
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

const requireWriter = (actor: PayrollActor) => {
  if (!['owner', 'admin', 'cabinet_admin', 'payroll_manager'].includes(actor.role)) {
    throw conflict('MODULE_FORBIDDEN', 'A payroll manager role is required');
  }
};

const accountView = (row: any): AccountInfo => ({
  id: row.id, code: row.code, name: row.name, type: row.type, isActive: row.is_active,
});

async function logEvent(
  db: Db,
  actor: PayrollActor,
  action: string,
  entityType: string,
  entityId: string | null,
  details: Record<string, unknown>,
) {
  await db.query(
    `INSERT INTO payroll_events (cabinet_id, company_id, entity_type, entity_id, action, details, actor_id)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)`,
    [actor.cabinetId, actor.companyId, entityType, entityId, action, JSON.stringify(details), actor.userId],
  );
}

async function loadMappingRow(db: Db, companyId: string, mappingId?: string | null): Promise<MappingRow | null> {
  const res = await db.query<MappingRow>(
    `SELECT m.*, u.full_name AS validated_by_name
       FROM payroll_account_mappings m
       LEFT JOIN app_users u ON u.id = m.validated_by
      WHERE m.company_id = $1
        AND ${mappingId ? 'm.id = $2' : "m.status = 'VALIDATED'"}
      ORDER BY m.version DESC
      LIMIT 1`,
    mappingId ? [companyId, mappingId] : [companyId],
  );
  return res.rows[0] ?? null;
}

export async function mappingView(db: Db, companyId: string, row: MappingRow | null) {
  if (!row) return null;
  const ids = MAPPING_FIELDS.map((field) => (row as any)[field.column]).filter(Boolean) as string[];
  const accountsRes = await db.query<any>(
    'SELECT id, code, name, type, is_active FROM accounts WHERE company_id = $1 AND id = ANY($2::uuid[])',
    [companyId, [...new Set(ids)]],
  );
  const byId = new Map(accountsRes.rows.map((account) => [account.id, accountView(account)]));
  const journalRes = await db.query<any>(
    'SELECT id, code, name, is_active FROM journals WHERE company_id = $1 AND id = $2',
    [companyId, row.journal_id],
  );
  const journalRow = journalRes.rows[0];
  const accounts = Object.fromEntries(MAPPING_FIELDS.map((field) => {
    const id = (row as any)[field.column] as string | null;
    return [field.key, id ? byId.get(id) ?? null : null];
  }));
  return {
    id: row.id,
    version: row.version,
    status: row.status,
    journalId: row.journal_id,
    journal: journalRow
      ? { id: journalRow.id, code: journalRow.code, name: journalRow.name, isActive: journalRow.is_active } as JournalInfo
      : null,
    accounts,
    note: row.note,
    validatedAt: row.validated_at,
    validatedBy: row.validated_by,
    validatedByName: row.validated_by_name ?? null,
    supersededAt: row.superseded_at,
  };
}

export async function getMappingConfig(db: Db, companyId: string) {
  const current = await loadMappingRow(db, companyId);
  const history = await db.query<any>(
    `SELECT m.id, m.version, m.status, m.validated_at, m.superseded_at, u.full_name AS validated_by_name
       FROM payroll_account_mappings m
       LEFT JOIN app_users u ON u.id = m.validated_by
      WHERE m.company_id = $1 ORDER BY m.version DESC LIMIT 20`,
    [companyId],
  );
  const accounts = await db.query<any>(
    `SELECT id, code, name, type, is_active FROM accounts
      WHERE company_id = $1 ORDER BY code`,
    [companyId],
  );
  const journals = await db.query<any>(
    `SELECT id, code, name, is_active FROM journals
      WHERE company_id = $1 ORDER BY code`,
    [companyId],
  );
  return {
    mapping: await mappingView(db, companyId, current),
    mappingHistory: history.rows,
    accounts: accounts.rows.map(accountView),
    journals: journals.rows.map((row) => ({
      id: row.id, code: row.code, name: row.name, isActive: row.is_active,
    })),
    requiredFields: MAPPING_FIELDS.map((field) => ({
      key: field.key, labelEn: field.labelEn, labelFr: field.labelFr, required: field.required,
    })),
    notice: 'Les comptes proviennent du plan comptable de la société. Aucun numéro de compte obligatoire n’est imposé.',
    noticeEn: 'Accounts come from the company chart of accounts. No mandatory account number is imposed.',
  };
}

export async function saveMapping(db: Db, actor: PayrollActor, input: MappingInput) {
  requireWriter(actor);
  if (!input.confirm) {
    throw badRequest('PAYROLL_MAPPING_CONFIRMATION_REQUIRED', 'Explicit confirmation is required to validate a mapping');
  }
  const values: Record<MappingColumn, string | null> = {} as any;
  for (const field of MAPPING_FIELDS) {
    const value = (input as any)[field.inputKey] as string | null | undefined;
    if (field.required && !value) {
      throw badRequest('PAYROLL_MAPPING_INCOMPLETE', `Missing account mapping: ${field.labelEn}`, {
        field: field.key,
      });
    }
    values[field.column] = value || null;
  }
  const ids = [...new Set(Object.values(values).filter(Boolean) as string[])];
  const accounts = await db.query<any>(
    'SELECT id, is_active FROM accounts WHERE company_id = $1 AND id = ANY($2::uuid[])',
    [actor.companyId, ids],
  );
  if (accounts.rowCount !== ids.length) {
    throw notFound('ACCOUNT_NOT_FOUND', 'An account does not belong to this company');
  }
  if (accounts.rows.some((account) => !account.is_active)) {
    throw badRequest('PAYROLL_MAPPING_ACCOUNT_INACTIVE', 'An inactive account cannot be mapped');
  }
  const journal = await db.query<any>(
    'SELECT id, is_active FROM journals WHERE company_id = $1 AND id = $2',
    [actor.companyId, input.journalId],
  );
  if (!journal.rows[0]) throw notFound('JOURNAL_NOT_FOUND', 'Journal not found in this company');
  if (!journal.rows[0].is_active) {
    throw badRequest('PAYROLL_MAPPING_JOURNAL_INACTIVE', 'An inactive journal cannot be mapped');
  }

  const mappingId = await db.transaction(async (tx) => {
    await tx.query('SELECT id FROM companies WHERE id = $1 FOR UPDATE', [actor.companyId]);
    const next = await tx.query<{ version: number }>(
      'SELECT COALESCE(MAX(version), 0) + 1 AS version FROM payroll_account_mappings WHERE company_id = $1',
      [actor.companyId],
    );
    const version = Number(next.rows[0]!.version);
    await tx.query(
      `UPDATE payroll_account_mappings SET status = 'SUPERSEDED', superseded_at = now()
        WHERE company_id = $1 AND status = 'VALIDATED'`,
      [actor.companyId],
    );
    const inserted = await tx.query<{ id: string }>(
      `INSERT INTO payroll_account_mappings (
         cabinet_id, company_id, version, status, journal_id,
         wages_expense_account_id, employer_csg_expense_account_id,
         employer_nsf_expense_account_id, training_levy_expense_account_id,
         paye_payable_account_id, csg_employee_payable_account_id,
         csg_employer_payable_account_id, nsf_employee_payable_account_id,
         nsf_employer_payable_account_id, training_levy_payable_account_id,
         net_payable_account_id, other_deductions_payable_account_id,
         reimbursements_account_id, note, validated_by, created_by
       ) VALUES ($1,$2,$3,'VALIDATED',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$19)
       RETURNING id`,
      [
        actor.cabinetId, actor.companyId, version, input.journalId,
        values.wages_expense_account_id, values.employer_csg_expense_account_id,
        values.employer_nsf_expense_account_id, values.training_levy_expense_account_id,
        values.paye_payable_account_id, values.csg_employee_payable_account_id,
        values.csg_employer_payable_account_id, values.nsf_employee_payable_account_id,
        values.nsf_employer_payable_account_id, values.training_levy_payable_account_id,
        values.net_payable_account_id, values.other_deductions_payable_account_id,
        values.reimbursements_account_id, input.note?.trim() || null, actor.userId,
      ],
    );
    const id = inserted.rows[0]!.id;
    await logEvent(tx, actor, 'payroll.account_mapping.validate', 'payroll_account_mapping', id, {
      mappingId: id, version, journalId: input.journalId,
    });
    await writeAudit(tx, {
      companyId: actor.companyId, userId: actor.userId,
      action: 'payroll.account_mapping.validate', entityType: 'payroll_account_mapping', entityId: id,
      details: { version, journalId: input.journalId }, ip: actor.ip ?? null,
    });
    return id;
  });
  return mappingView(db, actor.companyId, await loadMappingRow(db, actor.companyId, mappingId));
}

interface SourceCalculation {
  id: string;
  employee_id: string;
  employee_number: string | null;
  full_name: string | null;
  version: number;
  status: string;
  currency: string;
  basic_wage: string | null;
  gross: string;
  deductions: string;
  net_arithmetic: string;
  net_after_statutory: string | null;
  employer_cost: string | null;
  paye: string | null;
  csg_employee: string | null;
  csg_employer: string | null;
  nsf_employee: string | null;
  nsf_employer: string | null;
  training_levy: string | null;
  employer_contributions: string | null;
  statutory_status: string;
  statutory_complete: boolean;
  rules_applied: any;
  missing_rules: any;
  input_hash: string;
  calculated_at: string;
}

export interface AccountingLine {
  lineNo: number;
  category: string;
  labelEn: string;
  labelFr: string;
  accountId: string | null;
  accountCode: string | null;
  accountName: string | null;
  description: string;
  debit: string;
  credit: string;
}

const LINE_CATEGORIES = [
  { category: 'grossWages', mapping: 'wagesExpense', side: 'debit', amount: 'gross',
    labelEn: 'Gross remuneration', labelFr: 'Rémunérations brutes' },
  { category: 'reimbursements', mapping: 'reimbursements', side: 'debit', amount: 'reimbursements',
    labelEn: 'Reimbursements', labelFr: 'Remboursements' },
  { category: 'employerCsg', mapping: 'employerCsgExpense', side: 'debit', amount: 'csgEmployer',
    labelEn: 'Employer CSG', labelFr: 'CSG employeur' },
  { category: 'employerNsf', mapping: 'employerNsfExpense', side: 'debit', amount: 'nsfEmployer',
    labelEn: 'Employer NSF', labelFr: 'NSF employeur' },
  { category: 'trainingLevyExpense', mapping: 'trainingLevyExpense', side: 'debit', amount: 'trainingLevy',
    labelEn: 'Training Levy expense', labelFr: 'Charge Training Levy' },
  { category: 'payePayable', mapping: 'payePayable', side: 'credit', amount: 'paye',
    labelEn: 'PAYE withheld', labelFr: 'PAYE retenu' },
  { category: 'csgEmployeePayable', mapping: 'csgEmployeePayable', side: 'credit', amount: 'csgEmployee',
    labelEn: 'Employee CSG withheld', labelFr: 'CSG salarié retenue' },
  { category: 'csgEmployerPayable', mapping: 'csgEmployerPayable', side: 'credit', amount: 'csgEmployer',
    labelEn: 'Employer CSG payable', labelFr: 'CSG employeur à payer' },
  { category: 'nsfEmployeePayable', mapping: 'nsfEmployeePayable', side: 'credit', amount: 'nsfEmployee',
    labelEn: 'Employee NSF withheld', labelFr: 'NSF salarié retenue' },
  { category: 'nsfEmployerPayable', mapping: 'nsfEmployerPayable', side: 'credit', amount: 'nsfEmployer',
    labelEn: 'Employer NSF payable', labelFr: 'NSF employeur à payer' },
  { category: 'trainingLevyPayable', mapping: 'trainingLevyPayable', side: 'credit', amount: 'trainingLevy',
    labelEn: 'Training Levy payable', labelFr: 'Training Levy à payer' },
  { category: 'otherDeductions', mapping: 'otherDeductionsPayable', side: 'credit', amount: 'otherDeductions',
    labelEn: 'Other deductions payable', labelFr: 'Autres retenues à payer' },
  { category: 'netPayable', mapping: 'netPayable', side: 'credit', amount: 'netAfterStatutory',
    labelEn: 'Net wages payable', labelFr: 'Salaires nets à payer' },
] as const;

const mappingAccountKey: Record<string, MappingKey> = Object.fromEntries(
  MAPPING_FIELDS.map((field) => [field.key, field.key]),
) as Record<string, MappingKey>;

export async function buildAccountingPreview(db: Db, companyId: string, periodId: string) {
  const companyRes = await db.query<any>(
    'SELECT id, name, functional_currency FROM companies WHERE id = $1',
    [companyId],
  );
  const company = companyRes.rows[0];
  if (!company) throw notFound('COMPANY_NOT_FOUND', 'Company not found');
  const periodRes = await db.query<any>(
    'SELECT * FROM payroll_periods WHERE id = $1 AND company_id = $2',
    [periodId, companyId],
  );
  const period = periodRes.rows[0];
  if (!period) throw notFound('PAYROLL_PERIOD_NOT_FOUND', 'Payroll period not found');

  const calculationsRes = await db.query<SourceCalculation>(
    `WITH latest AS (
       SELECT DISTINCT ON (c.employee_id) c.*
         FROM payroll_calculations c
        WHERE c.company_id = $1 AND c.period_id = $2
        ORDER BY c.employee_id, c.version DESC, c.calculated_at DESC
     )
     SELECT l.*, e.employee_number, e.full_name
       FROM latest l
       JOIN payroll_employees e ON e.id = l.employee_id AND e.company_id = l.company_id
      ORDER BY e.employee_number`,
    [companyId, periodId],
  );
  const calculations = calculationsRes.rows;
  const mappingRow = await loadMappingRow(db, companyId);
  const mapping = await mappingView(db, companyId, mappingRow);
  const accountInfo = (mapping?.accounts ?? {}) as Record<string, AccountInfo | null>;
  const journal = mapping?.journal ?? null;

  const activeCount = await db.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM payroll_employees
      WHERE company_id = $1 AND employment_status IN ('active', 'probation')
        AND (hire_date IS NULL OR hire_date <= $2::date)
        AND (termination_date IS NULL OR termination_date >= $3::date)`,
    [companyId, period.end_date, period.start_date],
  );
  const accountingPeriod = await db.query(
    `SELECT id FROM accounting_periods
      WHERE company_id = $1 AND start_date <= $2 AND end_date >= $2
        AND status = 'open' LIMIT 1`,
    [companyId, period.payment_date ?? period.end_date],
  );

  const employeeRows = calculations.map((calc) => {
    const gross = money(calc.gross);
    const deductions = money(calc.deductions);
    const netArithmetic = money(calc.net_arithmetic);
    const reimbursements = netArithmetic - gross + deductions;
    return { calc, gross, deductions, netArithmetic, reimbursements };
  });
  const totals = {
    gross: employeeRows.reduce((sum, row) => sum + row.gross, 0n),
    otherDeductions: employeeRows.reduce((sum, row) => sum + row.deductions, 0n),
    reimbursements: employeeRows.reduce((sum, row) => sum + row.reimbursements, 0n),
    netArithmetic: employeeRows.reduce((sum, row) => sum + row.netArithmetic, 0n),
    paye: sumNullable(calculations.map((calc) => nullableAmount(calc.paye))),
    csgEmployee: sumNullable(calculations.map((calc) => nullableAmount(calc.csg_employee))),
    csgEmployer: sumNullable(calculations.map((calc) => nullableAmount(calc.csg_employer))),
    nsfEmployee: sumNullable(calculations.map((calc) => nullableAmount(calc.nsf_employee))),
    nsfEmployer: sumNullable(calculations.map((calc) => nullableAmount(calc.nsf_employer))),
    trainingLevy: sumNullable(calculations.map((calc) => nullableAmount(calc.training_levy))),
  };
  const employeeStatutory = sumNullable([totals.paye, totals.csgEmployee, totals.nsfEmployee]);
  const employerContributions = sumNullable([totals.csgEmployer, totals.nsfEmployer, totals.trainingLevy]);
  const netAfterStatutory = employeeStatutory === null ? null : totals.netArithmetic - employeeStatutory;
  const employerCost = employerContributions === null
    ? null
    : totals.gross + totals.reimbursements + employerContributions;

  const currencies = [...new Set(calculations.map((calc) => calc.currency))];
  const nullStatutory = calculations.filter((calc) =>
    [calc.paye, calc.csg_employee, calc.csg_employer, calc.nsf_employee, calc.nsf_employer, calc.training_levy]
      .some((value) => value === null));
  const blockedCalculations = calculations.filter((calc) =>
    calc.status === 'rules_incomplete' || calc.status === 'blocked' || calc.statutory_status === 'RULES_INCOMPLETE');
  const incompleteRules = calculations.filter((calc) =>
    (Array.isArray(calc.missing_rules) && calc.missing_rules.length > 0));
  const negativeReimbursements = employeeRows.filter((row) => row.reimbursements < 0n);
  const netMismatch = calculations.filter((calc) =>
    calc.net_after_statutory !== null && nullableAmount(calc.net_after_statutory) !== null &&
    employeeRows.find((row) => row.calc.id === calc.id)!.netArithmetic - (
      (nullableAmount(calc.paye) ?? 0n) + (nullableAmount(calc.csg_employee) ?? 0n) +
      (nullableAmount(calc.nsf_employee) ?? 0n)
    ) !== nullableAmount(calc.net_after_statutory));
  const employerContribMismatch = calculations.filter((calc) =>
    calc.employer_contributions !== null &&
    nullableAmount(calc.employer_contributions) !== (
      (nullableAmount(calc.csg_employer) ?? 0n) + (nullableAmount(calc.nsf_employer) ?? 0n) +
      (nullableAmount(calc.training_levy) ?? 0n)
    ));
  const employerCostMismatch = calculations.filter((calc) => {
    if (calc.employer_cost === null) return false;
    const row = employeeRows.find((item) => item.calc.id === calc.id)!;
    const contribution = (nullableAmount(calc.csg_employer) ?? 0n) +
      (nullableAmount(calc.nsf_employer) ?? 0n) + (nullableAmount(calc.training_levy) ?? 0n);
    return nullableAmount(calc.employer_cost) !== row.gross + row.reimbursements + contribution;
  });
  const duplicateNumbers = Object.entries(calculations.reduce<Record<string, number>>((acc, calc) => {
    const key = calc.employee_number ?? '';
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {})).filter(([, count]) => count > 1).map(([number]) => number);
  const missingNumbers = calculations.filter((calc) => !calc.employee_number);

  const mappingMissing = !mapping;
  const inactiveAccounts = mapping
    ? MAPPING_FIELDS.flatMap((field) => {
        const account = accountInfo[field.key];
        if (!account) return field.required ? [field.key] : [];
        return account.isActive ? [] : [field.key];
      })
    : [];
  const needsOther = totals.otherDeductions > 0n;
  const needsReimbursements = totals.reimbursements > 0n;
  const otherMapped = Boolean(mappingRow?.other_deductions_payable_account_id && accountInfo.otherDeductionsPayable?.isActive);
  const reimbMapped = Boolean(mappingRow?.reimbursements_account_id && accountInfo.reimbursements?.isActive);

  const checks: AccountingCheck[] = [
    {
      code: 'COMPANY_ISOLATION', severity: 'ok', scope: 'internal',
      messageEn: 'All calculations, accounts and journals are restricted to this company.',
      messageFr: 'Tous les calculs, comptes et journaux sont limités à cette société.',
    },
    {
      code: 'PERIOD_MATCH', severity: 'ok', scope: 'internal',
      messageEn: 'Only the selected payroll period is used.',
      messageFr: 'Seule la période de paie sélectionnée est utilisée.',
    },
    calculations.length > 0
      ? {
          code: 'CALCULATIONS_PRESENT', severity: 'ok', scope: 'internal',
          messageEn: `${calculations.length} latest calculation(s) loaded.`,
          messageFr: `${calculations.length} dernier(s) calcul(s) chargé(s).`,
        }
      : {
          code: 'CALCULATIONS_MISSING', severity: 'block', scope: 'internal',
          messageEn: 'No payroll calculation exists for this period.',
          messageFr: 'Aucun calcul de paie n’existe pour cette période.',
        },
    ...(Number(activeCount.rows[0]?.count ?? 0) > calculations.length
      ? [{
          code: 'EMPLOYEE_COVERAGE', severity: 'warning' as const, scope: 'internal' as const,
          messageEn: `${Number(activeCount.rows[0]?.count ?? 0) - calculations.length} active employee(s) have no calculation.`,
          messageFr: `${Number(activeCount.rows[0]?.count ?? 0) - calculations.length} salarié(s) actif(s) n’ont pas de calcul.`,
          count: Number(activeCount.rows[0]?.count ?? 0) - calculations.length,
        }]
      : []),
    currencies.length === 1 && currencies[0] === 'MUR' && company.functional_currency === 'MUR'
      ? {
          code: 'CURRENCY_MUR', severity: 'ok', scope: 'internal',
          messageEn: 'Every calculation and the company functional currency use MUR.',
          messageFr: 'Chaque calcul et la devise fonctionnelle de la société sont en MUR.',
        }
      : {
          code: 'CURRENCY_NOT_MUR', severity: 'block', scope: 'internal',
          messageEn: 'The payroll transfer requires MUR calculations in an MUR functional company.',
          messageFr: 'Le transfert de paie exige des calculs en MUR dans une société dont la devise fonctionnelle est le MUR.',
        },
    blockedCalculations.length === 0 && incompleteRules.length === 0
      ? {
          code: 'CALCULATIONS_COMPLETE', severity: 'ok', scope: 'internal',
          messageEn: 'No calculation is blocked by missing rules.',
          messageFr: 'Aucun calcul n’est bloqué par des règles manquantes.',
        }
      : {
          code: 'CALCULATIONS_INCOMPLETE', severity: 'block', scope: 'internal',
          messageEn: 'At least one calculation is blocked or has missing rules.',
          messageFr: 'Au moins un calcul est bloqué ou comporte des règles manquantes.',
          count: Math.max(blockedCalculations.length, incompleteRules.length),
        },
    nullStatutory.length === 0
      ? {
          code: 'STATUTORY_VALUES_PRESENT', severity: 'ok', scope: 'internal',
          messageEn: 'PAYE, CSG, NSF and Training Levy are present for every employee.',
          messageFr: 'PAYE, CSG, NSF et Training Levy sont présents pour chaque salarié.',
        }
      : {
          code: 'STATUTORY_VALUES_NULL', severity: 'block', scope: 'internal',
          messageEn: 'A statutory amount is unknown (null); zero is never substituted.',
          messageFr: 'Un montant statutaire est inconnu (null) ; zéro n’est jamais substitué.',
          count: nullStatutory.length,
        },
    negativeReimbursements.length === 0
      ? {
          code: 'REIMBURSEMENTS_NON_NEGATIVE', severity: 'ok', scope: 'internal',
          messageEn: 'Reimbursements are non-negative.',
          messageFr: 'Les remboursements sont positifs ou nuls.',
        }
      : {
          code: 'REIMBURSEMENTS_NEGATIVE', severity: 'block', scope: 'internal',
          messageEn: 'A calculation implies a negative reimbursement; it must be reviewed.',
          messageFr: 'Un calcul implique un remboursement négatif ; il doit être revu.',
          count: negativeReimbursements.length,
        },
    duplicateNumbers.length === 0
      ? {
          code: 'NO_DUPLICATE_EMPLOYEE', severity: 'ok', scope: 'internal',
          messageEn: 'No employee appears twice in the source set.',
          messageFr: 'Aucun salarié n’apparaît deux fois dans le jeu source.',
        }
      : {
          code: 'DUPLICATE_EMPLOYEE', severity: 'block', scope: 'internal',
          messageEn: `Duplicate employee number(s): ${duplicateNumbers.join(', ')}.`,
          messageFr: `Numéro(s) de salarié en double : ${duplicateNumbers.join(', ')}.`,
          count: duplicateNumbers.length,
        },
    missingNumbers.length === 0
      ? {
          code: 'EMPLOYEE_NUMBER_PRESENT', severity: 'ok', scope: 'internal',
          messageEn: 'Every source employee has a payroll number.',
          messageFr: 'Chaque salarié source possède un matricule.',
        }
      : {
          code: 'EMPLOYEE_NUMBER_MISSING', severity: 'block', scope: 'internal',
          messageEn: 'A source employee has no payroll number.',
          messageFr: 'Un salarié source n’a pas de matricule.',
          count: missingNumbers.length,
        },
    mappingMissing
      ? {
          code: 'ACCOUNT_MAPPING_MISSING', severity: 'block', scope: 'internal',
          messageEn: 'No validated payroll account mapping exists.',
          messageFr: 'Aucune correspondance comptable de paie validée n’existe.',
        }
      : {
          code: 'ACCOUNT_MAPPING_PRESENT', severity: 'ok', scope: 'internal',
          messageEn: `Validated mapping version ${mapping!.version} is used.`,
          messageFr: `La version ${mapping!.version} des correspondances validées est utilisée.`,
        },
    inactiveAccounts.length === 0
      ? {
          code: 'ACCOUNT_MAPPING_ACTIVE', severity: 'ok', scope: 'internal',
          messageEn: 'Every mapped account is active.',
          messageFr: 'Chaque compte mappé est actif.',
        }
      : {
          code: 'ACCOUNT_MAPPING_INACTIVE', severity: 'block', scope: 'internal',
          messageEn: 'A mapped account is inactive or missing; the mapping must be reviewed.',
          messageFr: 'Un compte mappé est inactif ou absent ; la correspondance doit être revue.',
          count: inactiveAccounts.length,
        },
    journal?.isActive
      ? {
          code: 'JOURNAL_ACTIVE', severity: 'ok', scope: 'internal',
          messageEn: `Journal ${journal.code} is active.`,
          messageFr: `Le journal ${journal.code} est actif.`,
        }
      : {
          code: 'JOURNAL_INACTIVE', severity: 'block', scope: 'internal',
          messageEn: 'The mapped journal is missing or inactive.',
          messageFr: 'Le journal mappé est absent ou inactif.',
        },
    accountingPeriod.rowCount > 0
      ? {
          code: 'ACCOUNTING_PERIOD_OPEN', severity: 'ok', scope: 'internal',
          messageEn: 'An open accounting period covers the payment date.',
          messageFr: 'Une période comptable ouverte couvre la date de paiement.',
        }
      : {
          code: 'ACCOUNTING_PERIOD_CLOSED', severity: 'block', scope: 'internal',
          messageEn: 'No open accounting period covers the payment date.',
          messageFr: 'Aucune période comptable ouverte ne couvre la date de paiement.',
        },
    needsOther && !otherMapped
      ? {
          code: 'OTHER_DEDUCTIONS_MAPPING_MISSING', severity: 'block', scope: 'internal',
          messageEn: 'Other deductions exist but no payable account is mapped.',
          messageFr: 'Des retenues existent mais aucun compte de dette n’est mappé.',
        }
      : {
          code: 'OTHER_DEDUCTIONS_MAPPED', severity: 'ok', scope: 'internal',
          messageEn: needsOther ? 'Other deductions have a payable account.' : 'No other deduction to map.',
          messageFr: needsOther ? 'Les autres retenues disposent d’un compte de dette.' : 'Aucune autre retenue à mapper.',
        },
    needsReimbursements && !reimbMapped
      ? {
          code: 'REIMBURSEMENTS_MAPPING_MISSING', severity: 'block', scope: 'internal',
          messageEn: 'Reimbursements exist but no account is mapped.',
          messageFr: 'Des remboursements existent mais aucun compte n’est mappé.',
        }
      : {
          code: 'REIMBURSEMENTS_MAPPED', severity: 'ok', scope: 'internal',
          messageEn: needsReimbursements ? 'Reimbursements have an account.' : 'No reimbursement to map.',
          messageFr: needsReimbursements ? 'Les remboursements disposent d’un compte.' : 'Aucun remboursement à mapper.',
        },
    netMismatch.length === 0
      ? {
          code: 'NET_AFTER_STATUTORY_CONSISTENT', severity: 'ok', scope: 'internal',
          messageEn: 'Stored net-after-statutory amounts match the calculation.',
          messageFr: 'Les nets après cotisations enregistrés concordent avec le calcul.',
        }
      : {
          code: 'NET_AFTER_STATUTORY_MISMATCH', severity: 'block', scope: 'internal',
          messageEn: 'A stored net-after-statutory amount does not match the source calculation.',
          messageFr: 'Un net après cotisations enregistré ne concorde pas avec le calcul source.',
          count: netMismatch.length,
        },
    employerContribMismatch.length === 0
      ? {
          code: 'EMPLOYER_CONTRIBUTIONS_CONSISTENT', severity: 'ok', scope: 'internal',
          messageEn: 'Stored employer contributions match CSG + NSF + Training Levy.',
          messageFr: 'Les charges patronales enregistrées concordent avec CSG + NSF + Training Levy.',
        }
      : {
          code: 'EMPLOYER_CONTRIBUTIONS_MISMATCH', severity: 'block', scope: 'internal',
          messageEn: 'A stored employer contribution total does not match its components.',
          messageFr: 'Un total de charges patronales enregistré ne concorde pas avec ses composantes.',
          count: employerContribMismatch.length,
        },
    employerCostMismatch.length === 0
      ? {
          code: 'EMPLOYER_COST_CONSISTENT', severity: 'ok', scope: 'internal',
          messageEn: 'Stored employer cost matches gross + reimbursements + employer contributions.',
          messageFr: 'Le coût employeur enregistré concorde avec brut + remboursements + charges patronales.',
        }
      : {
          code: 'EMPLOYER_COST_MISMATCH', severity: 'block', scope: 'internal',
          messageEn: 'A stored employer cost disagrees with its components; it is not silently adjusted.',
          messageFr: 'Un coût employeur enregistré diffère de ses composantes ; il n’est pas ajusté en silence.',
          count: employerCostMismatch.length,
        },
  ];

  const lines: AccountingLine[] = [];
  let lineNo = 1;
  const amounts: Record<string, bigint | null> = {
    gross: totals.gross, reimbursements: totals.reimbursements,
    csgEmployer: totals.csgEmployer, nsfEmployer: totals.nsfEmployer,
    trainingLevy: totals.trainingLevy, paye: totals.paye,
    csgEmployee: totals.csgEmployee, nsfEmployee: totals.nsfEmployee,
    otherDeductions: totals.otherDeductions, netAfterStatutory,
  };
  for (const descriptor of LINE_CATEGORIES) {
    const amount = amounts[descriptor.amount];
    if (amount === undefined || amount === null || amount <= 0n) continue;
    const account = accountInfo[descriptor.mapping] ?? null;
    lines.push({
      lineNo: lineNo++,
      category: descriptor.category,
      labelEn: descriptor.labelEn,
      labelFr: descriptor.labelFr,
      accountId: account?.id ?? null,
      accountCode: account?.code ?? null,
      accountName: account?.name ?? null,
      description: descriptor.labelEn,
      debit: descriptor.side === 'debit' ? fmt(amount) : '0.0000',
      credit: descriptor.side === 'credit' ? fmt(amount) : '0.0000',
    });
  }
  const debitTotal = lines.reduce((sum, line) => sum + money(line.debit), 0n);
  const creditTotal = lines.reduce((sum, line) => sum + money(line.credit), 0n);
  const difference = debitTotal - creditTotal;
  const missingLineAccounts = lines.filter((line) => !line.accountId);
  if (missingLineAccounts.length > 0) {
    checks.push({
      code: 'ACCOUNT_MISSING_ON_LINE', severity: 'block', scope: 'internal',
      messageEn: 'A proposal line has no mapped account; the mapping must be configured.',
      messageFr: 'Une ligne de proposition n’a pas de compte mappé ; la correspondance doit être configurée.',
      count: missingLineAccounts.length,
    });
  }
  if (lines.length < 2) {
    checks.push({
      code: 'ENTRY_TOO_FEW_LINES', severity: 'block', scope: 'internal',
      messageEn: 'The proposal has fewer than two lines.',
      messageFr: 'La proposition comporte moins de deux lignes.',
    });
  }
  if (difference !== 0n) {
    checks.push({
      code: 'ENTRY_UNBALANCED', severity: 'block', scope: 'internal',
      messageEn: 'Debit and credit totals differ. No balancing adjustment is ever created.',
      messageFr: 'Les totaux débit et crédit diffèrent. Aucune ligne d’ajustement n’est jamais créée.',
    });
  } else {
    checks.push({
      code: 'ENTRY_BALANCED', severity: 'ok', scope: 'internal',
      messageEn: 'Debit total equals credit total exactly.',
      messageFr: 'Le total débit est exactement égal au total crédit.',
    });
  }

  const unvalidatedRules = calculations.flatMap((calc) =>
    (Array.isArray(calc.rules_applied) ? calc.rules_applied : [])
      .filter((rule: any) => rule?.status !== 'EXPERT_VALIDATED'));
  if (unvalidatedRules.length > 0) {
    checks.push({
      code: 'RULES_NOT_EXPERT_VALIDATED', severity: 'warning', scope: 'internal',
      messageEn: 'Some source rules are not expert-validated. The transfer is a test preparation.',
      messageFr: 'Certaines règles source ne sont pas validées par un expert. Le transfert est une préparation de test.',
      count: unvalidatedRules.length,
    });
  } else {
    checks.push({
      code: 'RULES_EXPERT_VALIDATED', severity: 'ok', scope: 'internal',
      messageEn: 'Every source rule is expert-validated.',
      messageFr: 'Toutes les règles source sont validées par un expert.',
    });
  }
  if (!['calculated', 'approved_for_test', 'finalised'].includes(String(period.status))) {
    checks.push({
      code: 'PERIOD_NOT_FINALISED', severity: 'warning', scope: 'internal',
      messageEn: `The payroll period status is ${period.status}; it is not finalised.`,
      messageFr: `Le statut de la période de paie est ${period.status} ; elle n’est pas finalisée.`,
    });
  }

  const blockers = checks.filter((check) => check.severity === 'block');
  const warnings = checks.filter((check) => check.severity === 'warning');
  const sourceRules = [
    ...new Map(calculations.flatMap((calc) =>
      (Array.isArray(calc.rules_applied) ? calc.rules_applied : []).map((rule: any) => [
        `${rule?.ruleCode}:${rule?.version}`,
        { ruleCode: rule?.ruleCode, version: rule?.version, status: rule?.status },
      ]),
    )).values(),
  ];
  const fingerprint = sha256(calculations
    .map((calc) => `${calc.id}:${calc.version}:${calc.input_hash}:${calc.status}`)
    .sort()
    .join('|'));

  const allRulesExpert = calculations.length > 0 && calculations.every((calc) =>
    calc.statutory_status === 'CALCULATED' &&
    (Array.isArray(calc.rules_applied) ? calc.rules_applied : []).every((rule: any) => rule?.status === 'EXPERT_VALIDATED'));
  const allCalculationsFinal = calculations.every((calc) => ['approved', 'finalised'].includes(calc.status));
  const postingBlockers: AccountingCheck[] = [];
  if (!allRulesExpert) {
    postingBlockers.push({
      code: 'PAYROLL_RULES_NOT_EXPERT_VALIDATED', severity: 'block', scope: 'posting',
      messageEn: 'Definitive posting is blocked while payroll rules are not expert-validated.',
      messageFr: 'La comptabilisation définitive est bloquée tant que les règles de paie ne sont pas validées par un expert.',
    });
  }
  if (period.status !== 'finalised') {
    postingBlockers.push({
      code: 'PAYROLL_PERIOD_NOT_FINALISED', severity: 'block', scope: 'posting',
      messageEn: 'Definitive posting requires a finalised payroll period.',
      messageFr: 'La comptabilisation définitive exige une période de paie finalisée.',
    });
  }
  if (!allCalculationsFinal) {
    postingBlockers.push({
      code: 'PAYROLL_CALCULATIONS_NOT_APPROVED', severity: 'block', scope: 'posting',
      messageEn: 'Definitive posting requires approved or finalised calculations, not a test approval.',
      messageFr: 'La comptabilisation définitive exige des calculs approuvés ou finalisés, pas une approbation de test.',
    });
  }
  const postingAllowed = blockers.length === 0 && postingBlockers.length === 0;

  return {
    company: { id: company.id, name: company.name, functionalCurrency: company.functional_currency },
    period: {
      id: period.id, year: period.period_year, month: period.period_month,
      start: period.start_date, end: period.end_date,
      paymentDate: period.payment_date, status: period.status,
      label: `${String(period.period_month).padStart(2, '0')}/${period.period_year}`,
    },
    entryDate: period.payment_date ?? period.end_date,
    employees: calculations.length,
    employeesActive: Number(activeCount.rows[0]?.count ?? 0),
    currency: currencies[0] ?? company.functional_currency ?? 'MUR',
    mapping,
    calculationIds: calculations.map((calc) => calc.id),
    sourceFingerprint: fingerprint,
    sourceRules,
    lines,
    totals: {
      gross: fmt(totals.gross),
      reimbursements: fmt(totals.reimbursements),
      otherDeductions: fmt(totals.otherDeductions),
      employeeStatutoryDeductions: employeeStatutory === null ? null : fmt(employeeStatutory),
      employeeDeductions: employeeStatutory === null ? null : fmt(employeeStatutory + totals.otherDeductions),
      employerContributions: employerContributions === null ? null : fmt(employerContributions),
      netArithmetic: fmt(totals.netArithmetic),
      netAfterStatutory: netAfterStatutory === null ? null : fmt(netAfterStatutory),
      employerCost: employerCost === null ? null : fmt(employerCost),
      debitTotal: fmt(debitTotal),
      creditTotal: fmt(creditTotal),
      difference: fmt(difference),
    },
    checks,
    blockers,
    warnings,
    postingChecks: postingBlockers,
    canGenerate: true,
    canApprove: blockers.length === 0,
    canPost: postingAllowed,
    postingAllowed,
    regulatoryStatus: 'SIMULATION_ONLY',
    notice: 'Proposition comptable de simulation. Aucune écriture n’est créée avant une décision humaine et la comptabilisation définitive reste bloquée.',
    noticeEn: 'Simulated accounting proposal. No entry is created before a human decision and definitive posting remains blocked.',
  };
}

export type AccountingPreview = Awaited<ReturnType<typeof buildAccountingPreview>>;

function transferStatus(preview: AccountingPreview): 'BLOCKED' | 'REVIEW_REQUIRED' | 'DRAFT' {
  if (preview.blockers.length > 0) return 'BLOCKED';
  if (preview.warnings.length > 0) return 'REVIEW_REQUIRED';
  return 'DRAFT';
}

export async function generateAccountingTransfer(
  db: Db,
  actor: PayrollActor,
  periodId: string,
  input: { note?: string | null },
) {
  requireWriter(actor);
  const created = await db.transaction(async (tx) => {
    await tx.query(
      'SELECT id FROM payroll_periods WHERE id = $1 AND company_id = $2 FOR UPDATE',
      [periodId, actor.companyId],
    );
    const periodCheck = await tx.query(
      'SELECT 1 FROM payroll_periods WHERE id = $1 AND company_id = $2',
      [periodId, actor.companyId],
    );
    if (periodCheck.rowCount === 0) throw notFound('PAYROLL_PERIOD_NOT_FOUND', 'Payroll period not found');
    const preview = await buildAccountingPreview(tx, actor.companyId, periodId);
    const seq = await tx.query<{ version: number }>(
      'SELECT COALESCE(MAX(version), 0) + 1 AS version FROM payroll_accounting_transfers WHERE company_id = $1 AND period_id = $2',
      [actor.companyId, periodId],
    );
    const version = Number(seq.rows[0]!.version);
    const status = transferStatus(preview);
    const inserted = await tx.query<any>(
      `INSERT INTO payroll_accounting_transfers (
         cabinet_id, company_id, period_id, version, status, mapping_id, mapping_version,
         journal_id, currency, calculation_ids, source_fingerprint, source_rules,
         totals, lines, checks, blockers, warnings, posting_blockers, can_post, note, created_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::uuid[],$11,$12::jsonb,$13::jsonb,$14::jsonb,
                 $15::jsonb,$16::jsonb,$17::jsonb,$18::jsonb,false,$19,$20)
       RETURNING *`,
      [
        actor.cabinetId, actor.companyId, periodId, version, status,
        preview.mapping?.id ?? null, preview.mapping?.version ?? null,
        preview.mapping?.journalId ?? null, preview.currency, preview.calculationIds,
        preview.sourceFingerprint, JSON.stringify(preview.sourceRules),
        JSON.stringify(preview.totals), JSON.stringify(preview.lines),
        JSON.stringify(preview.checks), JSON.stringify(preview.blockers),
        JSON.stringify(preview.warnings), JSON.stringify(preview.postingChecks),
        input.note?.trim() || null, actor.userId,
      ],
    );
    const id = inserted.rows[0]!.id;
    await logEvent(tx, actor, 'payroll.transfer.generate', 'payroll_accounting_transfer', id, {
      periodId, version, status, sourceFingerprint: preview.sourceFingerprint,
      employeeCount: preview.employees, totals: preview.totals,
    });
    await writeAudit(tx, {
      companyId: actor.companyId, userId: actor.userId, action: 'payroll.transfer.generate',
      entityType: 'payroll_accounting_transfer', entityId: id,
      details: { periodId, version, status, employeeCount: preview.employees }, ip: actor.ip ?? null,
    });
    return id;
  });
  return getAccountingTransfer(db, actor.companyId, created);
}

export async function listAccountingTransfers(db: Db, companyId: string, periodId?: string) {
  const params: unknown[] = [companyId];
  let filter = '';
  if (periodId) { params.push(periodId); filter = 'AND t.period_id = $2'; }
  const res = await db.query<any>(
    `SELECT t.*, u.full_name AS created_by_name, d.full_name AS decided_by_name
       FROM payroll_accounting_transfers t
       LEFT JOIN app_users u ON u.id = t.created_by
       LEFT JOIN app_users d ON d.id = t.decided_by
      WHERE t.company_id = $1 ${filter}
      ORDER BY t.period_id, t.version DESC`,
    params,
  );
  return res.rows.map(transferView);
}

export async function getAccountingTransfer(db: Db, companyId: string, id: string) {
  const res = await db.query<any>(
    `SELECT t.*, u.full_name AS created_by_name, d.full_name AS decided_by_name
       FROM payroll_accounting_transfers t
       LEFT JOIN app_users u ON u.id = t.created_by
       LEFT JOIN app_users d ON d.id = t.decided_by
      WHERE t.company_id = $1 AND t.id = $2`,
    [companyId, id],
  );
  if (!res.rows[0]) throw notFound('PAYROLL_TRANSFER_NOT_FOUND', 'Payroll accounting transfer not found');
  return transferView(res.rows[0]);
}

function transferView(row: any) {
  return {
    id: row.id,
    companyId: row.company_id,
    periodId: row.period_id,
    version: row.version,
    status: row.status,
    mappingId: row.mapping_id,
    mappingVersion: row.mapping_version,
    journalId: row.journal_id,
    currency: row.currency,
    calculationIds: row.calculation_ids ?? [],
    sourceFingerprint: row.source_fingerprint,
    sourceRules: row.source_rules ?? [],
    totals: row.totals ?? {},
    lines: row.lines ?? [],
    checks: row.checks ?? [],
    blockers: row.blockers ?? [],
    warnings: row.warnings ?? [],
    postingChecks: row.posting_blockers ?? [],
    canPost: Boolean(row.can_post),
    note: row.note,
    createdAt: row.created_at,
    createdBy: row.created_by,
    createdByName: row.created_by_name ?? null,
    decidedAt: row.decided_at,
    decidedBy: row.decided_by,
    decidedByName: row.decided_by_name ?? null,
    decisionNote: row.decision_note,
    rejectionReason: row.rejection_reason,
    rejection_reason: row.rejection_reason,
    postedEntryId: row.posted_entry_id,
    postedAt: row.posted_at,
    regulatoryStatus: row.status === 'POSTED' ? 'POSTED' : 'SIMULATION_ONLY',
  };
}

async function lockAndLoadTransfer(tx: Db, companyId: string, id: string) {
  const res = await tx.query<any>(
    'SELECT * FROM payroll_accounting_transfers WHERE id = $1 AND company_id = $2 FOR UPDATE',
    [id, companyId],
  );
  if (!res.rows[0]) throw notFound('PAYROLL_TRANSFER_NOT_FOUND', 'Payroll accounting transfer not found');
  return res.rows[0];
}

async function assertCurrentSource(
  tx: Db,
  companyId: string,
  transfer: any,
  requireCurrentMapping = true,
) {
  const preview = await buildAccountingPreview(tx, companyId, transfer.period_id);
  if (preview.sourceFingerprint !== transfer.source_fingerprint ||
      JSON.stringify(preview.calculationIds) !== JSON.stringify(transfer.calculation_ids)) {
    throw conflict(
      'PAYROLL_TRANSFER_STALE',
      'The payroll calculations changed since this proposal was generated; generate a new proposal',
    );
  }
  if (requireCurrentMapping && preview.mapping?.id !== transfer.mapping_id) {
    throw conflict(
      'PAYROLL_TRANSFER_MAPPING_STALE',
      'The account mapping changed since this proposal was generated; generate a new proposal',
    );
  }
  return preview;
}

export async function approveAccountingTransfer(
  db: Db,
  actor: PayrollActor,
  id: string,
  input: { confirm: boolean; note: string },
) {
  requireWriter(actor);
  if (!input.confirm || input.note.trim().length < 10) {
    throw badRequest('PAYROLL_TRANSFER_DECISION_REQUIRED', 'A confirmation and a note of at least 10 characters are required');
  }
  await db.transaction(async (tx) => {
    const transfer = await lockAndLoadTransfer(tx, actor.companyId, id);
    if (transfer.status === 'POSTED') throw conflict('PAYROLL_TRANSFER_POSTED_IMMUTABLE', 'A posted transfer cannot be approved again');
    if (transfer.status === 'REJECTED') throw conflict('PAYROLL_TRANSFER_REJECTED', 'A rejected transfer cannot be approved; generate a new proposal');
    if (transfer.status === 'APPROVED_FOR_TEST') throw conflict('PAYROLL_TRANSFER_ALREADY_APPROVED', 'This transfer is already approved for test');
    if (transfer.status === 'BLOCKED') throw conflict('PAYROLL_TRANSFER_BLOCKED', 'A blocked transfer cannot be approved');
    const duplicate = await tx.query(
      `SELECT 1 FROM payroll_accounting_transfers
        WHERE company_id = $1 AND period_id = $2 AND source_fingerprint = $3
          AND id <> $4 AND status IN ('APPROVED_FOR_TEST', 'POSTED')
        LIMIT 1`,
      [actor.companyId, transfer.period_id, transfer.source_fingerprint, id],
    );
    if (duplicate.rowCount > 0) {
      throw conflict('PAYROLL_TRANSFER_DUPLICATE_SOURCE',
        'This exact calculation set is already approved; reject it before approving another proposal');
    }
    const preview = await assertCurrentSource(tx, actor.companyId, transfer);
    if (preview.blockers.length > 0) {
      throw conflict('PAYROLL_TRANSFER_BLOCKED', 'The transfer has blocking controls', { blockers: preview.blockers });
    }
    await tx.query(
      `UPDATE payroll_accounting_transfers
          SET status = 'APPROVED_FOR_TEST', decided_by = $2, decided_at = now(),
              decision_note = $3, updated_at = now()
        WHERE id = $1`,
      [id, actor.userId, input.note.trim()],
    );
    await logEvent(tx, actor, 'payroll.transfer.approve_for_test', 'payroll_accounting_transfer', id, {
      decision: 'APPROVED_FOR_TEST', note: input.note.trim(),
    });
    await writeAudit(tx, {
      companyId: actor.companyId, userId: actor.userId, action: 'payroll.transfer.approve_for_test',
      entityType: 'payroll_accounting_transfer', entityId: id,
      details: { decision: 'APPROVED_FOR_TEST' }, ip: actor.ip ?? null,
    });
  });
  return getAccountingTransfer(db, actor.companyId, id);
}

export async function rejectAccountingTransfer(
  db: Db,
  actor: PayrollActor,
  id: string,
  input: { reason: string },
) {
  requireWriter(actor);
  if (input.reason.trim().length < 10) {
    throw badRequest('PAYROLL_TRANSFER_DECISION_REQUIRED', 'A rejection reason of at least 10 characters is required');
  }
  await db.transaction(async (tx) => {
    const transfer = await lockAndLoadTransfer(tx, actor.companyId, id);
    if (transfer.status === 'POSTED') throw conflict('PAYROLL_TRANSFER_POSTED_IMMUTABLE', 'A posted transfer cannot be rejected');
    if (transfer.status === 'REJECTED') throw conflict('PAYROLL_TRANSFER_ALREADY_REJECTED', 'This transfer is already rejected');
    await tx.query(
      `UPDATE payroll_accounting_transfers
          SET status = 'REJECTED', decided_by = $2, decided_at = now(),
              rejection_reason = $3, updated_at = now()
        WHERE id = $1`,
      [id, actor.userId, input.reason.trim()],
    );
    await logEvent(tx, actor, 'payroll.transfer.reject', 'payroll_accounting_transfer', id, {
      decision: 'REJECTED', reason: input.reason.trim(),
    });
    await writeAudit(tx, {
      companyId: actor.companyId, userId: actor.userId, action: 'payroll.transfer.reject',
      entityType: 'payroll_accounting_transfer', entityId: id,
      details: { decision: 'REJECTED', reason: input.reason.trim() }, ip: actor.ip ?? null,
    });
  });
  return getAccountingTransfer(db, actor.companyId, id);
}

export async function postAccountingTransfer(db: Db, actor: PayrollActor, id: string) {
  requireWriter(actor);
  const entry = await db.transaction(async (tx) => {
    const transfer = await lockAndLoadTransfer(tx, actor.companyId, id);
    if (transfer.status === 'POSTED') throw conflict('PAYROLL_TRANSFER_ALREADY_POSTED', 'This transfer is already posted');
    if (transfer.status !== 'APPROVED_FOR_TEST') {
      throw conflict('PAYROLL_TRANSFER_NOT_APPROVED', 'Only an approved transfer can be posted');
    }
    const preview = await assertCurrentSource(tx, actor.companyId, transfer);
    if (!preview.canPost) {
      throw conflict(
        'PAYROLL_TRANSFER_POSTING_BLOCKED',
        'Definitive posting is blocked until payroll is validated for real use',
        { blockers: preview.postingChecks },
      );
    }
    if (preview.blockers.length > 0) {
      throw conflict('PAYROLL_TRANSFER_BLOCKED', 'The transfer has blocking controls', { blockers: preview.blockers });
    }
    const mapping = preview.mapping;
    if (!mapping?.journal) throw conflict('PAYROLL_TRANSFER_MAPPING_MISSING', 'The mapping journal is missing');
    const journal = await loadJournal(tx, actor.companyId, mapping.journalId);
    if (!journal.is_active) throw conflict('PAYROLL_TRANSFER_JOURNAL_INACTIVE', 'The payroll journal is inactive');
    await assertOpenPeriod(tx, actor.companyId, preview.entryDate);
    const lineInputs = preview.lines.map((line) => ({
      accountId: line.accountId!,
      description: line.description,
      debit: line.debit !== '0.0000' ? line.debit : null,
      credit: line.credit !== '0.0000' ? line.credit : null,
    }));
    const loaded = await loadAccounts(tx, actor.companyId, [...new Set(lineInputs.map((line) => line.accountId))]);
    const prepared = prepareEntry({
      journalId: journal.id,
      entryDate: preview.entryDate,
      reference: `PAY-${preview.period.year}${String(preview.period.month).padStart(2, '0')}-v${transfer.version}`,
      description: `Paie ${preview.period.label} — ${preview.company.name}`,
      currency: preview.currency,
      lines: lineInputs,
    }, preview.company.functionalCurrency, loaded.all, loaded.active);
    if (!prepared.balanced) {
      throw conflict('ENTRY_UNBALANCED', 'The payroll proposal is not balanced; no adjustment is created');
    }
    const entryNo = await nextEntryNo(tx, actor.companyId, journal, preview.entryDate);
    const inserted = await tx.query<any>(
      `INSERT INTO journal_entries
         (company_id, journal_id, entry_no, entry_date, reference, description, currency,
          exchange_rate, status, source, created_by, posted_at, posted_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'posted','payroll',$9,now(),$9)
       RETURNING *`,
      [
        actor.companyId, journal.id, entryNo, preview.entryDate,
        `PAY-${preview.period.year}${String(preview.period.month).padStart(2, '0')}-v${transfer.version}`,
        `Paie ${preview.period.label} — ${preview.company.name}`,
        preview.currency, prepared.fxRate, actor.userId,
      ],
    );
    await insertLines(tx, inserted.rows[0]!.id, actor.companyId, prepared);
    await tx.query(
      `UPDATE payroll_accounting_transfers
          SET status = 'POSTED', posted_entry_id = $2, posted_at = now(), can_post = true, updated_at = now()
        WHERE id = $1`,
      [id, inserted.rows[0]!.id],
    );
    await logEvent(tx, actor, 'payroll.transfer.post', 'payroll_accounting_transfer', id, {
      entryId: inserted.rows[0]!.id, entryNo, debitTotal: preview.totals.debitTotal,
    });
    await writeAudit(tx, {
      companyId: actor.companyId, userId: actor.userId, action: 'payroll.transfer.post',
      entityType: 'payroll_accounting_transfer', entityId: id,
      details: { entryId: inserted.rows[0]!.id, entryNo }, ip: actor.ip ?? null,
    });
    return inserted.rows[0]!;
  });
  return { transfer: await getAccountingTransfer(db, actor.companyId, id), entry };
}

const csvCell = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
const csvLine = (cells: unknown[]) => cells.map(csvCell).join(',');

export function accountingTransferCsv(transfer: any, mapping?: any): string {
  const rows: string[] = [];
  rows.push(csvLine(['PAYROLL ACCOUNTING TRANSFER - INTERNAL SIMULATION - NOT POSTED AUTOMATICALLY']));
  rows.push(csvLine(['SIMULATION - NOT VALIDATED FOR PAYMENT OR ACCOUNTING']));
  rows.push(csvLine(['Transfer ID', transfer.id]));
  rows.push(csvLine(['Company', transfer.companyId]));
  rows.push(csvLine(['Period ID', transfer.periodId]));
  rows.push(csvLine(['Version', transfer.version]));
  rows.push(csvLine(['Status', transfer.status]));
  rows.push(csvLine(['Currency', transfer.currency]));
  rows.push(csvLine(['Mapping version', transfer.mappingVersion ?? '']));
  rows.push(csvLine(['Source fingerprint', transfer.sourceFingerprint]));
  rows.push(csvLine(['Source calculation IDs', (transfer.calculationIds ?? []).join(' ')]));
  rows.push(csvLine(['Created at', transfer.createdAt]));
  rows.push(csvLine(['Created by', transfer.createdByName ?? transfer.createdBy ?? '']));
  rows.push(csvLine(['Decision', transfer.status === 'APPROVED_FOR_TEST' ? 'APPROVED FOR TEST' : transfer.status]));
  rows.push(csvLine(['Decision note', transfer.decisionNote ?? '']));
  rows.push(csvLine(['Rejection reason', transfer.rejectionReason ?? '']));
  rows.push(csvLine(['Posted entry', transfer.postedEntryId ?? 'NOT POSTED']));
  rows.push('');
  rows.push(csvLine(['LINES']));
  rows.push(csvLine(['Line', 'Category', 'Account code', 'Account name', 'Description', 'Debit', 'Credit']));
  for (const line of transfer.lines ?? []) {
    rows.push(csvLine([
      line.lineNo, line.category, line.accountCode ?? '', line.accountName ?? '',
      line.labelEn, line.debit, line.credit,
    ]));
  }
  rows.push('');
  rows.push(csvLine(['TOTALS']));
  for (const [key, value] of Object.entries(transfer.totals ?? {})) {
    rows.push(csvLine([key, value]));
  }
  rows.push('');
  rows.push(csvLine(['CHECKS']));
  rows.push(csvLine(['Code', 'Severity', 'Scope', 'Message EN', 'Message FR']));
  for (const check of transfer.checks ?? []) {
    rows.push(csvLine([check.code, check.severity, check.scope, check.messageEn, check.messageFr]));
  }
  rows.push('');
  rows.push(csvLine(['NO JOURNAL ENTRY IS CREATED BY THIS FILE']));
  if (mapping?.journal) rows.push(csvLine(['Mapped journal (not used by this export)', mapping.journal.code]));
  return '\uFEFF' + rows.join('\r\n');
}
