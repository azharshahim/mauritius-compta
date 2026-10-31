import { createHash } from 'node:crypto';
import type { Db } from '../../db/index.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { formatAmount, parseAmount } from '../../lib/money.js';
import { writeAudit } from '../../lib/audit.js';
import {
  computeAdditionalRemuneration, computeCsg, computeCumulativePaye, computeNsf, scaleBandThreshold,
  computePayeWithoutEdf, computeTrainingLevy,
  type NsfLimits, type PayFrequency, type PayeBand,
} from './statutory.js';

/**
 * Payroll foundation - mission 14.
 *
 * Arithmetic is exact (BigInt, scale 4). Statutory amounts (PAYE, CSG, NSF,
 * employer contributions) are NEVER computed here: no Mauritian rate or
 * threshold has been expert-validated. A calculation is therefore blocked by
 * default, produces only verifiable arithmetic totals, and can never become a
 * final payslip or a finalised period.
 */

const MONEY_ZERO = 0n;
const REQUIRED_RULE_CODES = [
  'PAYE', 'PAYE_NO_EDF', 'CSG_PRIVATE', 'NSF_RATES', 'NSF_LIMITS', 'TRAINING_LEVY',
] as const;
const AR_RULE_CODE = 'ADDITIONAL_REMUNERATION';
const BONUS_RULE_CODE = 'EOY_BONUS';
const RULE_STATUSES = ['UNVERIFIED', 'RESEARCHED', 'REVIEW_REQUIRED', 'EXPERT_VALIDATED', 'DEPRECATED'] as const;
const LEAVE_TYPES = ['annual', 'sick', 'unpaid', 'maternity', 'paternity', 'other'] as const;
type LeaveType = (typeof LEAVE_TYPES)[number];

const money = (value: unknown): bigint => {
  if (value === null || value === undefined || value === '') return MONEY_ZERO;
  try {
    return parseAmount(value);
  } catch {
    throw badRequest('VALIDATION_ERROR', 'Invalid amount');
  }
};
const fmt = (value: bigint) => formatAmount(value);
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const fingerprint = (value: string) => hash(`payroll-pii:${value}`);
const last4 = (value: string) => value.replace(/\s/g, '').slice(-4);
const nowIso = () => new Date().toISOString();
const isoDate = (value: string, field: string) => {
  const raw = String(value ?? '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) throw badRequest('VALIDATION_ERROR', `${field} must be YYYY-MM-DD`);
  return raw;
};
const addDays = (iso: string, days: number) => {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};
const daysInclusive = (from: string, to: string) =>
  Math.floor((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
const minDate = (a: string | null, b: string) => (!a || b < a ? b : a);
const maxDate = (a: string | null, b: string) => (!a || b > a ? b : a);

export interface PayrollActor {
  companyId: string;
  cabinetId: string;
  userId: string;
  role: string;
  ip?: string;
}

function requireWriter(actor: PayrollActor) {
  if (!['owner', 'admin', 'cabinet_admin', 'payroll_manager'].includes(actor.role)) {
    throw conflict('MODULE_FORBIDDEN', 'A payroll manager role is required');
  }
}
function requireAdmin(actor: PayrollActor) {
  if (!['owner', 'admin', 'cabinet_admin'].includes(actor.role)) {
    throw conflict('MODULE_FORBIDDEN', 'A dossier administrator role is required');
  }
}

async function audit(
  db: Db,
  actor: PayrollActor,
  action: string,
  entityType: string,
  entityId: string | null,
  details: Record<string, unknown> = {},
) {
  await db.query(
    `INSERT INTO payroll_events (cabinet_id, company_id, entity_type, entity_id, action, details, actor_id)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)`,
    [actor.cabinetId, actor.companyId, entityType, entityId, action, JSON.stringify(details), actor.userId],
  );
  await writeAudit(db, {
    companyId: actor.companyId,
    userId: actor.userId,
    action,
    entityType,
    entityId,
    details,
    ip: actor.ip,
  });
}

const employeeSelect = `
  SELECT e.id, e.employee_ref, e.employee_number, e.first_name, e.last_name, e.preferred_name,
         e.full_name, e.date_of_birth, e.nationality, e.country_of_residence, e.address,
         e.email, e.phone, e.employment_status, e.hire_date, e.termination_date,
         e.department, e.job_title, e.work_location, e.manager_employee_id, e.cost_centre,
         e.payroll_currency, e.payment_method, e.bank_name, e.bank_account_last4,
         e.pay_frequency, e.worker_type, e.paye_category, e.tax_residency,
         e.is_public_sector, e.public_sector_prb, e.is_household_worker,
         e.csg_exempt, e.csg_exempt_reason, e.nsf_exempt, e.nsf_exempt_reason,
         e.training_levy_exempt, e.additional_remuneration_excluded,
         e.additional_remuneration_exclusion_reason,
         e.statutory_id_last4, e.statutory_ref_last4,
         e.emergency_contact_name, e.emergency_contact_phone, e.emergency_contact_relation,
         e.notes, e.created_at, e.updated_at,
         m.full_name AS manager_name,
         (SELECT count(*)::int FROM payroll_contracts c
           WHERE c.employee_id = e.id AND c.company_id = e.company_id AND c.status = 'active') AS active_contracts
    FROM payroll_employees e
    LEFT JOIN payroll_employees m ON m.id = e.manager_employee_id AND m.company_id = e.company_id`;

function employeeView(row: any) {
  const { bank_account_fingerprint, statutory_id_fingerprint, ...visible } = row;
  return {
    ...visible,
    bankAccountMasked: row.bank_account_last4 ? `•••• ${row.bank_account_last4}` : null,
    statutoryIdMasked: row.statutory_id_last4 ? `•••• ${row.statutory_id_last4}` : null,
    statutoryRefMasked: row.statutory_ref_last4 ? `•••• ${row.statutory_ref_last4}` : null,
    bank_account_last4: undefined,
    hasBankDetails: Boolean(bank_account_fingerprint),
    hasStatutoryId: Boolean(statutory_id_fingerprint),
  };
}

// ---------------------------------------------------------------------------
// Employees
// ---------------------------------------------------------------------------

export async function listEmployees(
  db: Db,
  companyId: string,
  filters: { search?: string; status?: string; department?: string } = {},
) {
  const where = ['e.company_id = $1'];
  const params: unknown[] = [companyId];
  if (filters.search?.trim()) {
    params.push(`%${filters.search.trim().toLowerCase()}%`);
    where.push(`(lower(e.full_name) LIKE $${params.length} OR lower(COALESCE(e.employee_number,'')) LIKE $${params.length}
      OR lower(COALESCE(e.email,'')) LIKE $${params.length})`);
  }
  if (filters.status) {
    params.push(filters.status);
    where.push(`e.employment_status = $${params.length}`);
  }
  if (filters.department) {
    params.push(filters.department);
    where.push(`e.department = $${params.length}`);
  }
  const res = await db.query<any>(
    `${employeeSelect} WHERE ${where.join(' AND ')} ORDER BY e.last_name, e.first_name, e.employee_ref`,
    params,
  );
  return res.rows.map(employeeView);
}

export async function getEmployee(db: Db, companyId: string, id: string) {
  const res = await db.query<any>(`${employeeSelect} WHERE e.company_id = $1 AND e.id = $2`, [companyId, id]);
  if (!res.rows[0]) throw notFound('PAYROLL_EMPLOYEE_NOT_FOUND', 'Employee not found');
  const contracts = await listContracts(db, companyId, id);
  return { ...employeeView(res.rows[0]), contracts };
}

export interface EmployeeInput {
  employeeNumber: string;
  firstName: string;
  lastName: string;
  preferredName?: string | null;
  dateOfBirth?: string | null;
  nationality?: string | null;
  countryOfResidence?: string | null;
  address?: string | null;
  email?: string | null;
  phone?: string | null;
  employmentStatus?: 'active' | 'probation' | 'suspended' | 'terminated';
  hireDate?: string | null;
  terminationDate?: string | null;
  department?: string | null;
  jobTitle?: string | null;
  workLocation?: string | null;
  managerEmployeeId?: string | null;
  costCentre?: string | null;
  payrollCurrency?: string;
  paymentMethod?: 'bank_transfer' | 'cheque' | 'cash' | null;
  bankName?: string | null;
  bankAccountNumber?: string | null;
  statutoryId?: string | null;
  statutoryRef?: string | null;
  emergencyContactName?: string | null;
  emergencyContactPhone?: string | null;
  emergencyContactRelation?: string | null;
  notes?: string | null;
  payFrequency?: 'daily' | 'weekly' | 'fortnightly' | 'half_monthly' | 'monthly';
  workerType?: 'full_time' | 'part_time' | 'piece_rate' | 'atypical';
  payeCategory?: 'standard' | 'director' | 'board_member' | 'pensioner';
  taxResidency?: 'resident' | 'non_resident';
  isPublicSector?: boolean;
  publicSectorPrb?: boolean;
  isHouseholdWorker?: boolean;
  csgExempt?: boolean;
  csgExemptReason?: string | null;
  nsfExempt?: boolean;
  nsfExemptReason?: string | null;
  trainingLevyExempt?: boolean;
  additionalRemunerationExcluded?: boolean;
  additionalRemunerationExclusionReason?: string | null;
  allowDuplicate?: boolean;
}

async function duplicateEmployees(db: Db, companyId: string, input: EmployeeInput, excludeId?: string) {
  const params: unknown[] = [companyId];
  const clauses: string[] = [];
  params.push(input.employeeNumber.trim());
  clauses.push(`lower(btrim(employee_number)) = lower($${params.length})`);
  if (input.email?.trim()) {
    params.push(input.email.trim().toLowerCase());
    clauses.push(`lower(email) = $${params.length}`);
  }
  const checks: any[] = [];
  if (clauses.length) {
    const res = await db.query<any>(
      `SELECT id, employee_number, full_name, email FROM payroll_employees
        WHERE company_id = $1 AND (${clauses.join(' OR ')}) ${excludeId ? 'AND id <> $' + (params.length + 1) : ''}`,
      excludeId ? [...params, excludeId] : params,
    );
    checks.push(...res.rows);
  }
  if (input.firstName?.trim() && input.lastName?.trim() && input.dateOfBirth) {
    const res = await db.query<any>(
      `SELECT id, employee_number, full_name, email FROM payroll_employees
        WHERE company_id = $1 AND lower(first_name) = lower($2) AND lower(last_name) = lower($3)
          AND date_of_birth = $4 ${excludeId ? 'AND id <> $5' : ''}`,
      excludeId
        ? [companyId, input.firstName.trim(), input.lastName.trim(), input.dateOfBirth, excludeId]
        : [companyId, input.firstName.trim(), input.lastName.trim(), input.dateOfBirth],
    );
    checks.push(...res.rows);
  }
  return [...new Map(checks.map((row) => [row.id, row])).values()];
}

export async function createEmployee(db: Db, actor: PayrollActor, input: EmployeeInput) {
  requireWriter(actor);
  if (!input.employeeNumber?.trim() || !input.firstName?.trim() || !input.lastName?.trim()) {
    throw badRequest('VALIDATION_ERROR', 'Employee number, first name and last name are required');
  }
  const duplicates = await duplicateEmployees(db, actor.companyId, input);
  if (duplicates.length && !input.allowDuplicate) {
    throw conflict('PAYROLL_EMPLOYEE_DUPLICATE', 'A matching employee already exists; no automatic merge', {
      duplicates,
    });
  }
  const fullName = `${input.firstName.trim()} ${input.lastName.trim()}`;
  const bank = input.bankAccountNumber?.replace(/\s/g, '') || null;
  const statutory = input.statutoryId?.replace(/\s/g, '') || null;
  const statutoryRef = input.statutoryRef?.replace(/\s/g, '') || null;
  if (input.managerEmployeeId) {
    const manager = await db.query('SELECT 1 FROM payroll_employees WHERE id = $1 AND company_id = $2', [input.managerEmployeeId, actor.companyId]);
    if (!manager.rowCount) throw notFound('PAYROLL_EMPLOYEE_NOT_FOUND', 'Manager not found in this company');
  }
  const res = await db.query<any>(
    `INSERT INTO payroll_employees
      (company_id, employee_ref, employee_number, first_name, last_name, preferred_name, full_name,
       date_of_birth, nationality, country_of_residence, address, email, phone, employment_status,
       hire_date, termination_date, department, job_title, work_location, manager_employee_id,
       cost_centre, payroll_currency, payment_method, bank_name, bank_account_last4,
       bank_account_fingerprint, statutory_id_last4, statutory_id_fingerprint, statutory_ref_last4,
       emergency_contact_name, emergency_contact_phone, emergency_contact_relation, notes,
       created_by, updated_by, start_date, end_date, status)
     VALUES ($1,(CASE WHEN $34 THEN $2 || '-DUP-' || substr(gen_random_uuid()::text,1,8) ELSE $2 END),
             $2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,
             $23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$33,$14,$15,
             CASE WHEN $13 = 'terminated' THEN 'ended' ELSE 'active' END)
     RETURNING *`,
    [
      actor.companyId, input.employeeNumber.trim(), input.firstName.trim(), input.lastName.trim(),
      input.preferredName?.trim() || null, fullName, input.dateOfBirth || null,
      input.nationality?.trim() || null, input.countryOfResidence?.trim() || null,
      input.address?.trim() || null, input.email?.trim() || null, input.phone?.trim() || null,
      input.employmentStatus ?? 'active', input.hireDate || null, input.terminationDate || null,
      input.department?.trim() || null, input.jobTitle?.trim() || null,
      input.workLocation?.trim() || null, input.managerEmployeeId || null,
      input.costCentre?.trim() || null, input.payrollCurrency?.toUpperCase() || 'MUR',
      input.paymentMethod ?? null, input.bankName?.trim() || null, bank ? last4(bank) : null,
      bank ? fingerprint(bank) : null, statutory ? last4(statutory) : null,
      statutory ? fingerprint(statutory) : null, statutoryRef ? last4(statutoryRef) : null,
      input.emergencyContactName?.trim() || null, input.emergencyContactPhone?.trim() || null,
      input.emergencyContactRelation?.trim() || null, input.notes?.trim() || null, actor.userId,
      Boolean(input.allowDuplicate),
    ],
  );
  const row = res.rows[0]!;
  await audit(db, actor, 'payroll.employee.create', 'payroll_employee', row.id, {
    employeeNumber: row.employee_number,
    duplicateOverride: duplicates.length > 0,
  });
  const profile: Partial<EmployeeInput> = {};
  if (input.payFrequency) profile.payFrequency = input.payFrequency;
  if (input.workerType) profile.workerType = input.workerType;
  if (input.payeCategory) profile.payeCategory = input.payeCategory;
  if (input.taxResidency) profile.taxResidency = input.taxResidency;
  if (input.isPublicSector !== undefined) profile.isPublicSector = input.isPublicSector;
  if (input.publicSectorPrb !== undefined) profile.publicSectorPrb = input.publicSectorPrb;
  if (input.isHouseholdWorker !== undefined) profile.isHouseholdWorker = input.isHouseholdWorker;
  if (input.csgExempt !== undefined) profile.csgExempt = input.csgExempt;
  if (input.csgExemptReason !== undefined) profile.csgExemptReason = input.csgExemptReason;
  if (input.nsfExempt !== undefined) profile.nsfExempt = input.nsfExempt;
  if (input.nsfExemptReason !== undefined) profile.nsfExemptReason = input.nsfExemptReason;
  if (input.trainingLevyExempt !== undefined) profile.trainingLevyExempt = input.trainingLevyExempt;
  if (input.additionalRemunerationExcluded !== undefined) {
    profile.additionalRemunerationExcluded = input.additionalRemunerationExcluded;
  }
  if (input.additionalRemunerationExclusionReason !== undefined) {
    profile.additionalRemunerationExclusionReason = input.additionalRemunerationExclusionReason;
  }
  if (Object.keys(profile).length > 0) return updateEmployee(db, actor, row.id, profile);
  return employeeView(row);
}

export async function checkEmployeeDuplicates(db: Db, companyId: string, input: EmployeeInput) {
  return duplicateEmployees(db, companyId, input);
}

export async function updateEmployee(
  db: Db, actor: PayrollActor, id: string, input: Partial<EmployeeInput>,
) {
  requireWriter(actor);
  const current = await db.query<any>('SELECT * FROM payroll_employees WHERE id = $1 AND company_id = $2', [id, actor.companyId]);
  if (!current.rows[0]) throw notFound('PAYROLL_EMPLOYEE_NOT_FOUND', 'Employee not found');
  if (input.employeeNumber) {
    const duplicates = await duplicateEmployees(db, actor.companyId, { ...input, employeeNumber: input.employeeNumber } as EmployeeInput, id);
    if (duplicates.length) throw conflict('PAYROLL_EMPLOYEE_NUMBER_TAKEN', 'Employee number already used', { duplicates });
  }
  if (input.managerEmployeeId) {
    const manager = await db.query('SELECT 1 FROM payroll_employees WHERE id = $1 AND company_id = $2', [input.managerEmployeeId, actor.companyId]);
    if (!manager.rowCount) throw notFound('PAYROLL_EMPLOYEE_NOT_FOUND', 'Manager not found in this company');
  }
  const bank = input.bankAccountNumber?.replace(/\s/g, '');
  const statutory = input.statutoryId?.replace(/\s/g, '');
  const fields: string[] = [];
  const values: unknown[] = [];
  const put = (sql: string, value: unknown) => {
    values.push(value);
    fields.push(`${sql} = $${values.length}`);
  };
  if (input.employeeNumber) {
    put('employee_number', input.employeeNumber.trim());
    put('employee_ref', input.employeeNumber.trim());
  }
  if (input.firstName) put('first_name', input.firstName.trim());
  if (input.lastName) put('last_name', input.lastName.trim());
  if (input.firstName || input.lastName) {
    put('full_name', `${input.firstName ?? current.rows[0].first_name} ${input.lastName ?? current.rows[0].last_name}`);
  }
  if (input.preferredName !== undefined) put('preferred_name', input.preferredName || null);
  if (input.dateOfBirth !== undefined) put('date_of_birth', input.dateOfBirth || null);
  if (input.nationality !== undefined) put('nationality', input.nationality || null);
  if (input.countryOfResidence !== undefined) put('country_of_residence', input.countryOfResidence || null);
  if (input.address !== undefined) put('address', input.address || null);
  if (input.email !== undefined) put('email', input.email || null);
  if (input.phone !== undefined) put('phone', input.phone || null);
  if (input.employmentStatus) {
    put('employment_status', input.employmentStatus);
    put('status', input.employmentStatus === 'terminated' ? 'ended' : 'active');
  }
  if (input.hireDate !== undefined) {
    put('hire_date', input.hireDate || null);
    put('start_date', input.hireDate || null);
  }
  if (input.terminationDate !== undefined) {
    put('termination_date', input.terminationDate || null);
    put('end_date', input.terminationDate || null);
  }
  if (input.department !== undefined) put('department', input.department || null);
  if (input.jobTitle !== undefined) put('job_title', input.jobTitle || null);
  if (input.workLocation !== undefined) put('work_location', input.workLocation || null);
  if (input.managerEmployeeId !== undefined) put('manager_employee_id', input.managerEmployeeId || null);
  if (input.costCentre !== undefined) put('cost_centre', input.costCentre || null);
  if (input.payrollCurrency) put('payroll_currency', input.payrollCurrency.toUpperCase());
  if (input.paymentMethod !== undefined) put('payment_method', input.paymentMethod || null);
  if (input.bankName !== undefined) put('bank_name', input.bankName || null);
  if (bank) {
    put('bank_account_last4', last4(bank));
    put('bank_account_fingerprint', fingerprint(bank));
  }
  if (statutory) {
    put('statutory_id_last4', last4(statutory));
    put('statutory_id_fingerprint', fingerprint(statutory));
  }
  if (input.statutoryRef !== undefined) put('statutory_ref_last4', input.statutoryRef ? last4(input.statutoryRef) : null);
  if (input.emergencyContactName !== undefined) put('emergency_contact_name', input.emergencyContactName || null);
  if (input.emergencyContactPhone !== undefined) put('emergency_contact_phone', input.emergencyContactPhone || null);
  if (input.emergencyContactRelation !== undefined) put('emergency_contact_relation', input.emergencyContactRelation || null);
  if (input.notes !== undefined) put('notes', input.notes || null);
  if (input.payFrequency !== undefined) put('pay_frequency', input.payFrequency);
  if (input.workerType !== undefined) put('worker_type', input.workerType);
  if (input.payeCategory !== undefined) put('paye_category', input.payeCategory);
  if (input.taxResidency !== undefined) put('tax_residency', input.taxResidency);
  if (input.isPublicSector !== undefined) put('is_public_sector', input.isPublicSector);
  if (input.publicSectorPrb !== undefined) put('public_sector_prb', input.publicSectorPrb);
  if (input.isHouseholdWorker !== undefined) put('is_household_worker', input.isHouseholdWorker);
  if (input.csgExempt !== undefined) put('csg_exempt', input.csgExempt);
  if (input.csgExemptReason !== undefined) put('csg_exempt_reason', input.csgExemptReason || null);
  if (input.nsfExempt !== undefined) put('nsf_exempt', input.nsfExempt);
  if (input.nsfExemptReason !== undefined) put('nsf_exempt_reason', input.nsfExemptReason || null);
  if (input.trainingLevyExempt !== undefined) put('training_levy_exempt', input.trainingLevyExempt);
  if (input.additionalRemunerationExcluded !== undefined) put('additional_remuneration_excluded', input.additionalRemunerationExcluded);
  if (input.additionalRemunerationExclusionReason !== undefined) {
    put('additional_remuneration_exclusion_reason', input.additionalRemunerationExclusionReason || null);
  }
  if (!fields.length) return getEmployee(db, actor.companyId, id);
  put('updated_by', actor.userId);
  put('updated_at', nowIso());
  values.push(id, actor.companyId);
  const res = await db.query<any>(
    `UPDATE payroll_employees SET ${fields.join(', ')}
      WHERE id = $${values.length - 1} AND company_id = $${values.length} RETURNING *`,
    values,
  );
  await audit(db, actor, 'payroll.employee.update', 'payroll_employee', id, {
    fields: fields.filter((f) => !f.startsWith('updated_') && !f.includes('fingerprint') && !f.includes('last4')),
  });
  return employeeView(res.rows[0]!);
}

// ---------------------------------------------------------------------------
// Contracts
// ---------------------------------------------------------------------------

const contractSelect = `
  SELECT c.*, e.employee_number, e.full_name,
         (SELECT count(*)::int FROM payroll_contract_events ev WHERE ev.contract_id = c.id) AS event_count
    FROM payroll_contracts c
    JOIN payroll_employees e ON e.id = c.employee_id AND e.company_id = c.company_id`;

export async function listContracts(db: Db, companyId: string, employeeId?: string) {
  const params: unknown[] = [companyId];
  let where = 'c.company_id = $1';
  if (employeeId) {
    params.push(employeeId);
    where += ` AND c.employee_id = $${params.length}`;
  }
  const res = await db.query<any>(
    `${contractSelect} WHERE ${where} ORDER BY c.effective_from DESC, c.created_at DESC`,
    params,
  );
  return res.rows;
}

export interface ContractInput {
  employeeId: string;
  contractType: 'permanent' | 'fixed_term';
  workPattern: 'full_time' | 'part_time';
  effectiveFrom: string;
  effectiveTo?: string | null;
  baseSalary: string | number;
  salaryPeriod: 'monthly' | 'hourly' | 'daily';
  currency?: string;
  weeklyHours?: string | number | null;
  department?: string | null;
  jobTitle?: string | null;
  workLocation?: string | null;
  probationEnd?: string | null;
  changeReason: string;
  amendmentOf?: string | null;
}

export async function createContract(db: Db, actor: PayrollActor, input: ContractInput) {
  requireWriter(actor);
  const employee = await db.query<any>(
    'SELECT * FROM payroll_employees WHERE id = $1 AND company_id = $2',
    [input.employeeId, actor.companyId],
  );
  if (!employee.rows[0]) throw notFound('PAYROLL_EMPLOYEE_NOT_FOUND', 'Employee not found');
  if (!input.changeReason?.trim()) throw badRequest('VALIDATION_ERROR', 'An explicit change reason is required');
  if (input.amendmentOf) {
    const amended = await db.query(
      'SELECT 1 FROM payroll_contracts WHERE id = $1 AND company_id = $2 AND employee_id = $3',
      [input.amendmentOf, actor.companyId, input.employeeId],
    );
    if (!amended.rowCount) throw notFound('PAYROLL_CONTRACT_NOT_FOUND', 'Amended contract not found for this employee');
  }
  if (input.effectiveTo && input.effectiveTo < input.effectiveFrom) {
    throw badRequest('PAYROLL_CONTRACT_INVALID', 'End date cannot precede the start date');
  }
  const salary = money(input.baseSalary);
  if (salary < 0n) throw badRequest('PAYROLL_CONTRACT_INVALID', 'Salary cannot be negative');
  return db.transaction(async (tx) => {
    const active = await tx.query<any>(
      `SELECT * FROM payroll_contracts
        WHERE company_id = $1 AND employee_id = $2 AND status = 'active' FOR UPDATE`,
      [actor.companyId, input.employeeId],
    );
    let supersedes: string | null = input.amendmentOf ?? null;
    let previous: any = null;
    for (const old of active.rows) {
      const oldFrom = old.effective_from as string;
      if (input.effectiveFrom <= oldFrom) {
        throw conflict('PAYROLL_CONTRACT_OVERLAP', 'A contract already exists from a later or equal date', {
          existingContractId: old.id,
          effectiveFrom: oldFrom,
        });
      }
      previous = old;
      supersedes = supersedes ?? old.id;
      await tx.query(
        `UPDATE payroll_contracts SET status = 'superseded', effective_to = $2, updated_at = now()
          WHERE id = $1`,
        [old.id, old.effective_to && old.effective_to < addDays(input.effectiveFrom, -1)
          ? old.effective_to : addDays(input.effectiveFrom, -1)],
      );
    }
    const res = await tx.query<any>(
      `INSERT INTO payroll_contracts
        (cabinet_id, company_id, employee_id, contract_type, work_pattern, status, effective_from,
         effective_to, base_salary, salary_period, currency, weekly_hours, department, job_title,
         work_location, probation_end, change_reason, amendment_of, created_by)
       VALUES ($1,$2,$3,$4,$5,'active',$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
       RETURNING *`,
      [
        actor.cabinetId, actor.companyId, input.employeeId, input.contractType, input.workPattern,
        isoDate(input.effectiveFrom, 'effectiveFrom'), input.effectiveTo || null, fmt(salary),
        input.salaryPeriod, (input.currency ?? 'MUR').toUpperCase(),
        input.weeklyHours === null || input.weeklyHours === undefined ? null : String(input.weeklyHours),
        input.department || employee.rows[0].department, input.jobTitle || employee.rows[0].job_title,
        input.workLocation || employee.rows[0].work_location, input.probationEnd || null,
        input.changeReason.trim(), supersedes, actor.userId,
      ],
    );
    const contract = res.rows[0]!;
    await tx.query(
      `INSERT INTO payroll_contract_events
        (cabinet_id, company_id, contract_id, employee_id, action, effective_from, change_reason, previous, current, actor_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10)`,
      [
        actor.cabinetId, actor.companyId, contract.id, input.employeeId,
        previous ? 'amendment' : 'creation', contract.effective_from, contract.change_reason,
        JSON.stringify(previous ?? null), JSON.stringify(contract), actor.userId,
      ],
    );
    // Keep the visible employee card aligned with the active contract without
    // ever rewriting the historical rows.
    if (input.jobTitle !== undefined || input.department !== undefined) {
      await tx.query(
        `UPDATE payroll_employees SET job_title = COALESCE($2, job_title),
                department = COALESCE($3, department), employment_status = 'active', updated_at = now()
          WHERE id = $1 AND company_id = $4`,
        [input.employeeId, input.jobTitle ?? null, input.department ?? null, actor.companyId],
      );
    }
    await audit(tx, actor, previous ? 'payroll.contract.amend' : 'payroll.contract.create', 'payroll_contract', contract.id, {
      employeeId: input.employeeId, effectiveFrom: contract.effective_from,
      baseSalary: fmt(salary), salaryPeriod: input.salaryPeriod, changeReason: input.changeReason.trim(),
      previousContractId: previous?.id ?? null,
    });
    return contract;
  });
}

export async function terminateContract(
  db: Db, actor: PayrollActor, id: string, input: { effectiveTo: string; reason: string },
) {
  requireWriter(actor);
  if (!input.reason?.trim()) throw badRequest('VALIDATION_ERROR', 'A termination reason is required');
  return db.transaction(async (tx) => {
    const res = await tx.query<any>(
      'SELECT * FROM payroll_contracts WHERE id = $1 AND company_id = $2 FOR UPDATE',
      [id, actor.companyId],
    );
    const row = res.rows[0];
    if (!row) throw notFound('PAYROLL_CONTRACT_NOT_FOUND', 'Contract not found');
    if (row.status !== 'active') throw conflict('PAYROLL_CONTRACT_INVALID', 'Only an active contract can be terminated');
    if (input.effectiveTo < row.effective_from) throw badRequest('PAYROLL_CONTRACT_INVALID', 'End date precedes the start date');
    const updated = await tx.query<any>(
      `UPDATE payroll_contracts SET status = 'terminated', effective_to = $2, change_reason = $3,
              updated_at = now() WHERE id = $1 RETURNING *`,
      [id, isoDate(input.effectiveTo, 'effectiveTo'), input.reason.trim()],
    );
    await tx.query(
      `INSERT INTO payroll_contract_events
        (cabinet_id, company_id, contract_id, employee_id, action, effective_from, change_reason, previous, current, actor_id)
       VALUES ($1,$2,$3,$4,'termination',$5,$6,$7::jsonb,$8::jsonb,$9)`,
      [actor.cabinetId, actor.companyId, id, row.employee_id, input.effectiveTo, input.reason.trim(),
        JSON.stringify(row), JSON.stringify(updated.rows[0]), actor.userId],
    );
    await audit(tx, actor, 'payroll.contract.terminate', 'payroll_contract', id, { effectiveTo: input.effectiveTo, reason: input.reason.trim() });
    return updated.rows[0];
  });
}

export async function contractAt(db: Db, companyId: string, employeeId: string, onDate: string) {
  const res = await db.query<any>(
    `SELECT * FROM payroll_contracts
      WHERE company_id = $1 AND employee_id = $2
        AND effective_from <= $3 AND (effective_to IS NULL OR effective_to >= $3)
        AND status IN ('active', 'terminated', 'superseded')
      ORDER BY effective_from DESC LIMIT 1`,
    [companyId, employeeId, onDate],
  );
  return res.rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// Pay items and employee assignments
// ---------------------------------------------------------------------------

export async function listPayItems(db: Db, companyId: string) {
  const res = await db.query<any>(
    `SELECT p.*, a.code AS account_code, a.name AS account_name
       FROM payroll_pay_items p
       LEFT JOIN accounts a ON a.id = p.account_id AND a.company_id = p.company_id
      WHERE p.company_id = $1 ORDER BY p.category, p.code`,
    [companyId],
  );
  return res.rows;
}

export interface PayItemInput {
  code: string;
  labelEn: string;
  labelFr: string;
  category: 'earning' | 'deduction' | 'reimbursement' | 'advance' | 'loan';
  unit: 'money' | 'hour' | 'day' | 'quantity';
  calculationMethod: 'fixed' | 'quantity_times_rate';
  effectiveFrom: string;
  effectiveTo?: string | null;
  accountId?: string | null;
  source?: string | null;
  parameters?: Record<string, unknown>;
}

export async function createPayItem(db: Db, actor: PayrollActor, input: PayItemInput) {
  requireWriter(actor);
  if (!input.code?.trim() || !input.labelEn?.trim() || !input.labelFr?.trim()) {
    throw badRequest('VALIDATION_ERROR', 'Code and both labels are required');
  }
  const exists = await db.query(
    'SELECT 1 FROM payroll_pay_items WHERE company_id = $1 AND lower(btrim(code)) = lower($2)',
    [actor.companyId, input.code.trim()],
  );
  if (exists.rowCount) throw conflict('PAYROLL_PAY_ITEM_CODE_TAKEN', 'Pay item code already used');
  if (input.accountId) {
    const account = await db.query('SELECT 1 FROM accounts WHERE id = $1 AND company_id = $2', [input.accountId, actor.companyId]);
    if (!account.rowCount) throw notFound('ACCOUNT_NOT_FOUND', 'Account not found in this company');
  }
  // Treatment is deliberately UNVERIFIED: this task never presumes the fiscal
  // or social treatment of a pay item.
  const res = await db.query<any>(
    `INSERT INTO payroll_pay_items
      (cabinet_id, company_id, code, label_en, label_fr, category, unit, calculation_method,
       treatment_status, account_id, effective_from, effective_to, source, parameters, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'UNVERIFIED',$9,$10,$11,$12,$13::jsonb,$14)
     RETURNING *`,
    [
      actor.cabinetId, actor.companyId, input.code.trim().toUpperCase(), input.labelEn.trim(),
      input.labelFr.trim(), input.category, input.unit, input.calculationMethod,
      input.accountId || null, isoDate(input.effectiveFrom, 'effectiveFrom'),
      input.effectiveTo || null, input.source?.trim() || null,
      JSON.stringify(input.parameters ?? {}), actor.userId,
    ],
  );
  await audit(db, actor, 'payroll.pay_item.create', 'payroll_pay_item', res.rows[0]!.id, {
    code: res.rows[0]!.code, category: input.category,
  });
  return res.rows[0];
}

export async function assignPayItem(
  db: Db, actor: PayrollActor,
  employeeId: string,
  input: { payItemId: string; amount: string | number; effectiveFrom: string; effectiveTo?: string | null },
) {
  requireWriter(actor);
  const employee = await db.query('SELECT 1 FROM payroll_employees WHERE id = $1 AND company_id = $2', [employeeId, actor.companyId]);
  if (!employee.rowCount) throw notFound('PAYROLL_EMPLOYEE_NOT_FOUND', 'Employee not found');
  const item = await db.query('SELECT 1 FROM payroll_pay_items WHERE id = $1 AND company_id = $2', [input.payItemId, actor.companyId]);
  if (!item.rowCount) throw notFound('PAYROLL_PAY_ITEM_NOT_FOUND', 'Pay item not found');
  const res = await db.query<any>(
    `INSERT INTO payroll_employee_pay_items
      (company_id, employee_id, pay_item_id, amount, effective_from, effective_to, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [actor.companyId, employeeId, input.payItemId, fmt(money(input.amount)), isoDate(input.effectiveFrom, 'effectiveFrom'), input.effectiveTo || null, actor.userId],
  );
  await audit(db, actor, 'payroll.pay_item.assign', 'payroll_employee', employeeId, {
    payItemId: input.payItemId, amount: fmt(money(input.amount)), effectiveFrom: input.effectiveFrom,
  });
  return res.rows[0];
}

// ---------------------------------------------------------------------------
// Time and leave
// ---------------------------------------------------------------------------

export async function listTimeEntries(
  db: Db, companyId: string, filters: { employeeId?: string; from?: string; to?: string } = {},
) {
  const params: unknown[] = [companyId];
  const where = ['t.company_id = $1'];
  if (filters.employeeId) { params.push(filters.employeeId); where.push(`t.employee_id = $${params.length}`); }
  if (filters.from) { params.push(filters.from); where.push(`t.work_date >= $${params.length}`); }
  if (filters.to) { params.push(filters.to); where.push(`t.work_date <= $${params.length}`); }
  const res = await db.query<any>(
    `SELECT t.*, e.employee_number, e.full_name FROM payroll_time_entries t
       JOIN payroll_employees e ON e.id = t.employee_id
      WHERE ${where.join(' AND ')} ORDER BY t.work_date DESC, e.full_name LIMIT 1000`,
    params,
  );
  return res.rows;
}

export async function createTimeEntry(
  db: Db, actor: PayrollActor,
  input: { employeeId: string; workDate: string; hoursWorked: string | number; overtimeHours?: string | number; latenessMinutes?: number; note?: string | null; source?: string },
) {
  requireWriter(actor);
  const employee = await db.query('SELECT 1 FROM payroll_employees WHERE id = $1 AND company_id = $2', [input.employeeId, actor.companyId]);
  if (!employee.rowCount) throw notFound('PAYROLL_EMPLOYEE_NOT_FOUND', 'Employee not found');
  try {
    const res = await db.query<any>(
      `INSERT INTO payroll_time_entries
        (cabinet_id, company_id, employee_id, work_date, hours_worked, overtime_hours,
         lateness_minutes, note, source, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [actor.cabinetId, actor.companyId, input.employeeId, isoDate(input.workDate, 'workDate'),
        String(input.hoursWorked ?? 0), String(input.overtimeHours ?? 0), input.latenessMinutes ?? 0,
        input.note || null, input.source ?? 'manual', actor.userId],
    );
    await audit(db, actor, 'payroll.time.create', 'payroll_time_entry', res.rows[0]!.id, {
      employeeId: input.employeeId, workDate: input.workDate,
    });
    return res.rows[0];
  } catch (error: any) {
    if (String(error?.code) === '23505' || /payroll_time_entries_company_id_employee_id_work_date_key/.test(String(error?.message))) {
      throw conflict('PAYROLL_TIME_DUPLICATE', 'A time entry already exists for this employee and date');
    }
    throw error;
  }
}

export async function listHolidays(db: Db, companyId: string, year?: number) {
  const params: unknown[] = [companyId];
  let where = 'company_id = $1';
  if (year) { params.push(year); where += ` AND EXTRACT(YEAR FROM holiday_date) = $${params.length}`; }
  const res = await db.query<any>(
    `SELECT * FROM payroll_holidays WHERE ${where} ORDER BY holiday_date`,
    params,
  );
  return res.rows;
}

export async function createHoliday(
  db: Db, actor: PayrollActor,
  input: { holidayDate: string; nameEn: string; nameFr: string; source: string },
) {
  requireWriter(actor);
  if (!input.nameEn?.trim() || !input.nameFr?.trim() || !input.source?.trim()) {
    throw badRequest('VALIDATION_ERROR', 'Both holiday names and a source are required');
  }
  try {
    const res = await db.query<any>(
      `INSERT INTO payroll_holidays (company_id, holiday_date, name_en, name_fr, source)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [actor.companyId, isoDate(input.holidayDate, 'holidayDate'),
        input.nameEn.trim(), input.nameFr.trim(), input.source.trim()],
    );
    await audit(db, actor, 'payroll.holiday.create', 'payroll_holiday', res.rows[0]!.id, {
      holidayDate: input.holidayDate,
    });
    return res.rows[0];
  } catch (error: any) {
    if (String(error?.code) === '23505') throw conflict('PAYROLL_HOLIDAY_DUPLICATE', 'This holiday date already exists');
    throw error;
  }
}

export interface TimeImportRow {
  employeeNumber: string;
  workDate: string;
  hoursWorked: string | number;
  overtimeHours?: string | number;
  latenessMinutes?: string | number;
  note?: string | null;
}

export async function importTimeEntries(
  db: Db, actor: PayrollActor, rows: TimeImportRow[], source: 'csv' | 'xlsx' = 'csv',
) {
  requireWriter(actor);
  if (!Array.isArray(rows) || rows.length === 0) throw badRequest('PAYROLL_IMPORT_INVALID', 'No row to import');
  if (rows.length > 2000) throw badRequest('PAYROLL_IMPORT_INVALID', 'At most 2000 rows per import');
  const employees = await db.query<any>('SELECT id, employee_number FROM payroll_employees WHERE company_id = $1', [actor.companyId]);
  const byNumber = new Map(employees.rows.map((e) => [String(e.employee_number).toLowerCase(), e]));
  const errors: { row: number; message: string }[] = [];
  const parsed = rows.map((row, index) => {
    const employee = byNumber.get(String(row.employeeNumber ?? '').trim().toLowerCase());
    if (!employee) errors.push({ row: index + 1, message: `Unknown employee ${row.employeeNumber}` });
    let workDate = String(row.workDate ?? '').trim();
    const french = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(workDate);
    if (french) workDate = `${french[3]}-${french[2]}-${french[1]}`;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(workDate)) errors.push({ row: index + 1, message: 'Invalid work date' });
    return { row: index + 1, employeeId: employee?.id, workDate, input: row };
  });
  if (errors.length) throw badRequest('PAYROLL_IMPORT_INVALID', 'The import contains invalid rows', { errors });
  let created = 0;
  let skipped = 0;
  await db.transaction(async (tx) => {
    for (const entry of parsed) {
      const res = await tx.query(
        `INSERT INTO payroll_time_entries
          (cabinet_id, company_id, employee_id, work_date, hours_worked, overtime_hours,
           lateness_minutes, note, source, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (company_id, employee_id, work_date) DO NOTHING RETURNING id`,
        [actor.cabinetId, actor.companyId, entry.employeeId, entry.workDate,
          String(entry.input.hoursWorked ?? 0), String(entry.input.overtimeHours ?? 0),
          Number(entry.input.latenessMinutes ?? 0), entry.input.note?.trim() || null,
          'import', actor.userId],
      );
      if (res.rowCount) created += 1;
      else skipped += 1;
    }
  });
  await audit(db, actor, 'payroll.time.import', 'payroll_time_entry', null, {
    rows: rows.length, created, skipped, source,
  });
  return { created, skipped, rows: rows.length };
}

export async function listAbsences(
  db: Db, companyId: string, filters: { employeeId?: string; status?: string; year?: number } = {},
) {
  const params: unknown[] = [companyId];
  const where = ['a.company_id = $1'];
  if (filters.employeeId) { params.push(filters.employeeId); where.push(`a.employee_id = $${params.length}`); }
  if (filters.status) { params.push(filters.status); where.push(`a.status = $${params.length}`); }
  if (filters.year) { params.push(filters.year); where.push(`EXTRACT(YEAR FROM a.start_date) = $${params.length}`); }
  const res = await db.query<any>(
    `SELECT a.*, e.employee_number, e.full_name FROM payroll_absences a
       JOIN payroll_employees e ON e.id = a.employee_id
      WHERE ${where.join(' AND ')} ORDER BY a.start_date DESC LIMIT 500`,
    params,
  );
  return res.rows;
}

export async function createAbsence(
  db: Db, actor: PayrollActor,
  input: { employeeId: string; leaveType: LeaveType; startDate: string; endDate: string; days: string | number; reason?: string | null; documentRef?: string | null },
) {
  requireWriter(actor);
  if (!LEAVE_TYPES.includes(input.leaveType)) throw badRequest('VALIDATION_ERROR', 'Unknown leave type');
  if (!input.reason?.trim()) throw badRequest('VALIDATION_ERROR', 'A leave request requires a reason');
  if (input.endDate < input.startDate) throw badRequest('VALIDATION_ERROR', 'End date precedes start date');
  const employee = await db.query('SELECT 1 FROM payroll_employees WHERE id = $1 AND company_id = $2', [input.employeeId, actor.companyId]);
  if (!employee.rowCount) throw notFound('PAYROLL_EMPLOYEE_NOT_FOUND', 'Employee not found');
  const res = await db.query<any>(
    `INSERT INTO payroll_absences
      (cabinet_id, company_id, employee_id, leave_type, start_date, end_date, days, reason,
       document_ref, requested_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [actor.cabinetId, actor.companyId, input.employeeId, input.leaveType,
      isoDate(input.startDate, 'startDate'), isoDate(input.endDate, 'endDate'),
      String(input.days), input.reason.trim(), input.documentRef || null, actor.userId],
  );
  await audit(db, actor, 'payroll.leave.request', 'payroll_absence', res.rows[0]!.id, {
    employeeId: input.employeeId, leaveType: input.leaveType, days: String(input.days),
  });
  return res.rows[0];
}

export async function decideAbsence(
  db: Db, actor: PayrollActor, id: string,
  input: { decision: 'approved' | 'rejected' | 'cancelled'; reason?: string | null },
) {
  requireWriter(actor);
  if (input.decision === 'rejected' && !input.reason?.trim()) {
    throw badRequest('VALIDATION_ERROR', 'A rejection reason is required');
  }
  return db.transaction(async (tx) => {
    const current = await tx.query<any>(
      'SELECT * FROM payroll_absences WHERE id = $1 AND company_id = $2 FOR UPDATE',
      [id, actor.companyId],
    );
    const row = current.rows[0];
    if (!row) throw notFound('PAYROLL_ABSENCE_NOT_FOUND', 'Absence not found');
    if (row.status === 'rejected' || row.status === 'cancelled') {
      throw conflict('PAYROLL_ABSENCE_DECIDED', 'This absence is already closed');
    }
    const updated = await tx.query<any>(
      `UPDATE payroll_absences SET status = $2, decision_reason = $3, decided_by = $4,
              decided_at = now(), updated_at = now() WHERE id = $1 RETURNING *`,
      [id, input.decision, input.reason?.trim() || null, actor.userId],
    );
    await audit(tx, actor, `payroll.leave.${input.decision}`, 'payroll_absence', id, {
      employeeId: row.employee_id, leaveType: row.leave_type, days: row.days, reason: input.reason ?? null,
    });
    return updated.rows[0];
  });
}

export async function leaveBalances(db: Db, companyId: string, employeeId: string, year = new Date().getUTCFullYear()) {
  const employee = await db.query<any>('SELECT id, full_name FROM payroll_employees WHERE id = $1 AND company_id = $2', [employeeId, companyId]);
  if (!employee.rows[0]) throw notFound('PAYROLL_EMPLOYEE_NOT_FOUND', 'Employee not found');
  const rules = await db.query<any>(
    `SELECT DISTINCT ON (leave_type) leave_type, days_per_year, status, source, validated_at
       FROM payroll_leave_rules WHERE company_id = $1 AND leave_type = ANY($2::text[])
        AND effective_from <= $3::date AND (effective_to IS NULL OR effective_to >= $3::date)
        AND status <> 'DEPRECATED'
       ORDER BY leave_type, effective_from DESC`,
    [companyId, LEAVE_TYPES, `${year}-12-31`],
  );
  const used = await db.query<any>(
    `SELECT leave_type, COALESCE(SUM(days),0)::text AS days
       FROM payroll_absences WHERE company_id = $1 AND employee_id = $2 AND status = 'approved'
        AND start_date >= $3::date AND start_date <= $4::date
      GROUP BY leave_type`,
    [companyId, employeeId, `${year}-01-01`, `${year}-12-31`],
  );
  const byType = new Map(rules.rows.map((r) => [r.leave_type, r]));
  return {
    year,
    employeeId,
    balances: LEAVE_TYPES.map((type) => {
      const rule = byType.get(type);
      const consumed = used.rows.find((u) => u.leave_type === type)?.days ?? '0.0000';
      if (!rule) {
        return { leaveType: type, status: 'CONFIGURATION_REQUIRED', configured: false, entitlement: null, consumed, balance: null,
          note: 'Aucune règle de congé validée. Le solde n’est pas calculé.' };
      }
      const validated = rule.status === 'EXPERT_VALIDATED';
      return {
        leaveType: type, status: rule.status, configured: true, validated,
        entitlement: validated ? fmt(money(rule.days_per_year)) : null,
        consumed,
        balance: validated ? fmt(money(rule.days_per_year) - money(consumed)) : null,
        note: validated ? 'Règle explicitement validée pour ce dossier.' : 'Règle non validée : le solde n’est pas présenté comme acquis.',
      };
    }),
  };
}

export async function listLeaveRules(db: Db, companyId: string) {
  const res = await db.query<any>(
    `SELECT r.*, u.full_name AS reviewer_name FROM payroll_leave_rules r
       LEFT JOIN app_users u ON u.id = r.reviewer_id
      WHERE r.company_id = $1 ORDER BY r.leave_type, r.effective_from DESC`,
    [companyId],
  );
  return res.rows;
}

export async function createLeaveRule(
  db: Db, actor: PayrollActor,
  input: { leaveType: LeaveType; daysPerYear: string | number; accrualMethod?: string; effectiveFrom: string; effectiveTo?: string | null; source?: string | null },
) {
  requireWriter(actor);
  const res = await db.query<any>(
    `INSERT INTO payroll_leave_rules
      (cabinet_id, company_id, leave_type, days_per_year, accrual_method, effective_from,
       effective_to, status, source, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'UNVERIFIED',$8,$9) RETURNING *`,
    [actor.cabinetId, actor.companyId, input.leaveType, String(input.daysPerYear),
      input.accrualMethod ?? 'configured_annual', isoDate(input.effectiveFrom, 'effectiveFrom'),
      input.effectiveTo || null, input.source?.trim() || null, actor.userId],
  );
  await audit(db, actor, 'payroll.leave_rule.create', 'payroll_leave_rule', res.rows[0]!.id, {
    leaveType: input.leaveType, daysPerYear: String(input.daysPerYear), status: 'UNVERIFIED',
  });
  return res.rows[0];
}

// ---------------------------------------------------------------------------
// Employee Declaration Forms (EDF)
// ---------------------------------------------------------------------------

const DEPENDENT_DEDUCTIONS: Record<number, string> = {
  0: '0', 1: '110000', 2: '190000', 3: '275000', 4: '355000',
};

export function taxYearStartFor(date: string): string {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  return `${month >= 7 ? year : year - 1}-07-01`;
}

export function dependentDeductionFor(count: number): string {
  if (!Number.isInteger(count) || count < 0 || count > 20) {
    throw badRequest('VALIDATION_ERROR', 'Dependent count must be an integer between 0 and 20');
  }
  return DEPENDENT_DEDUCTIONS[Math.min(count, 4)]!;
}

export async function listEdfDeclarations(
  db: Db, companyId: string, employeeId?: string, taxYearStart?: string,
) {
  const params: unknown[] = [companyId];
  let where = 'd.company_id = $1';
  if (employeeId) { params.push(employeeId); where += ` AND d.employee_id = $${params.length}`; }
  if (taxYearStart) { params.push(taxYearStart); where += ` AND d.tax_year_start = $${params.length}`; }
  const res = await db.query<any>(
    `SELECT d.*, e.employee_number, e.full_name
       FROM payroll_edf_declarations d JOIN payroll_employees e ON e.id = d.employee_id
      WHERE ${where} ORDER BY e.employee_number, d.tax_year_start DESC, d.revision DESC`,
    params,
  );
  return res.rows;
}

export async function createEdfDeclaration(
  db: Db, actor: PayrollActor,
  input: {
    employeeId: string; taxYearStart: string; declarationDate: string; effectiveFrom: string;
    dependentCount: number; otherReliefs?: string | number; documentRef?: string | null;
    sourceReference?: string | null; notes?: string | null;
  },
) {
  requireWriter(actor);
  const taxYearStart = isoDate(input.taxYearStart, 'taxYearStart');
  if (taxYearStart.slice(5, 10) !== '07-01') {
    throw badRequest('VALIDATION_ERROR', 'A Mauritius tax year must start on 1 July');
  }
  if (taxYearStart < '2025-07-01') {
    throw badRequest('PAYROLL_EDF_RULE_NOT_AVAILABLE',
      'The verified 2025/26 dependent deduction table does not cover earlier tax years');
  }
  const declarationDate = isoDate(input.declarationDate, 'declarationDate');
  const effectiveFrom = isoDate(input.effectiveFrom, 'effectiveFrom');
  if (effectiveFrom < taxYearStart) {
    throw badRequest('VALIDATION_ERROR', 'The EDF effective date cannot precede the tax year');
  }
  const employee = await db.query<any>(
    'SELECT id FROM payroll_employees WHERE id = $1 AND company_id = $2',
    [input.employeeId, actor.companyId],
  );
  if (!employee.rows[0]) throw notFound('PAYROLL_EMPLOYEE_NOT_FOUND', 'Employee not found');
  return db.transaction(async (tx) => {
    const current = await tx.query<any>(
      `SELECT * FROM payroll_edf_declarations
        WHERE company_id = $1 AND employee_id = $2 AND tax_year_start = $3
        ORDER BY revision DESC FOR UPDATE`,
      [actor.companyId, input.employeeId, taxYearStart],
    );
    const latest = current.rows[0];
    if (latest && effectiveFrom < latest.effective_from) {
      throw conflict('PAYROLL_EDF_EFFECTIVE_DATE',
        'An EDF amendment cannot be backdated before the active declaration; use a new tax year or preserve history');
    }
    const revision = Number(latest?.revision ?? 0) + 1;
    const dependentDeduction = money(dependentDeductionFor(input.dependentCount));
    const other = money(input.otherReliefs ?? 0);
    if (other < 0n) throw badRequest('VALIDATION_ERROR', 'Other reliefs cannot be negative');
    const total = dependentDeduction + other;
    if (latest) {
      await tx.query(
        `UPDATE payroll_edf_declarations SET status = 'superseded', updated_at = now()
          WHERE id = $1 AND company_id = $2`,
        [latest.id, actor.companyId],
      );
    }
    const inserted = await tx.query<any>(
      `INSERT INTO payroll_edf_declarations
        (cabinet_id, company_id, employee_id, tax_year_start, declaration_date, effective_from,
         dependent_count, dependent_deduction, other_reliefs, total_reliefs, status, document_ref,
         source_reference, notes, revision, supersedes_id, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'submitted',$11,$12,$13,$14,$15,$16) RETURNING *`,
      [actor.cabinetId, actor.companyId, input.employeeId, taxYearStart, declarationDate,
        effectiveFrom, input.dependentCount, fmt(dependentDeduction), fmt(other), fmt(total),
        input.documentRef?.trim() || null, input.sourceReference?.trim() || null,
        input.notes?.trim() || null, revision, latest?.id ?? null, actor.userId],
    );
    await audit(tx, actor, 'payroll.edf.create', 'payroll_edf_declaration', inserted.rows[0]!.id, {
      employeeId: input.employeeId, taxYearStart, revision, totalReliefs: fmt(total),
      supersedes: latest?.id ?? null,
    });
    return inserted.rows[0];
  });
}

/**
 * Rebuilds the cumulative EDF reliefs period by period from the applicable
 * version. A fresh EDF only affects subsequent pay periods; history is kept.
 */
export async function cumulativeEdfReliefs(
  db: Db, companyId: string, employeeId: string, taxYearStart: string,
  periodEnd: string, frequency: string,
) {
  const denominator = frequency === 'monthly' ? 13
    : frequency === 'fortnightly' ? 28
    : frequency === 'weekly' ? 56 : null;
  if (!denominator) {
    return {
      hasEdf: false, cumulativeReliefs: 0n, periodsElapsed: 0,
      basis: 'EDF_FREQUENCY_NOT_IMPLEMENTED',
      versions: [] as { id: string; effectiveFrom: string; reliefs: string }[],
    };
  }
  const rows = await db.query<any>(
    `SELECT id, effective_from, total_reliefs, revision FROM payroll_edf_declarations
      WHERE company_id = $1 AND employee_id = $2 AND tax_year_start = $3
        AND status IN ('submitted', 'superseded')
      ORDER BY effective_from, revision`,
    [companyId, employeeId, taxYearStart],
  );
  if (rows.rows.length === 0) {
    return { hasEdf: false, cumulativeReliefs: 0n, periodsElapsed: 0, basis: 'NO_EDF', versions: [] };
  }
  let periods = 0;
  let reliefs = 0n;
  const used = new Map<string, { id: string; effectiveFrom: string; reliefs: string }>();
  const step: number = frequency === 'fortnightly' ? 14 : 7;
  let cursor = taxYearStart;
  let guard = 0;
  while (cursor <= periodEnd && guard++ < 60) {
    const periodEndCursor = frequency === 'monthly'
      ? monthBounds(Number(cursor.slice(0, 4)), Number(cursor.slice(5, 7))).end
      : addDays(cursor, step - 1);
    const applicable = [...rows.rows].reverse().find((row) => row.effective_from <= periodEndCursor);
    if (applicable) {
      const share = divRound(money(applicable.total_reliefs), BigInt(denominator));
      reliefs += share;
      used.set(applicable.id, {
        id: applicable.id, effectiveFrom: applicable.effective_from,
        reliefs: fmt(money(applicable.total_reliefs)),
      });
    }
    periods += 1;
    if (periodEndCursor >= periodEnd) break;
    cursor = frequency === 'monthly'
      ? addDays(monthBounds(Number(periodEndCursor.slice(0, 4)), Number(periodEndCursor.slice(5, 7))).end, 1)
      : addDays(cursor, step);
  }
  return {
    hasEdf: true, cumulativeReliefs: reliefs, periodsElapsed: periods,
    basis: 'EDF_CUMULATIVE',
    versions: [...used.values()],
  };
}

// ---------------------------------------------------------------------------
// Dated regulatory rules
// ---------------------------------------------------------------------------

interface RuleSeed {
  ruleCode: string;
  nameEn: string;
  nameFr: string;
  legalSource: string;
  sourceReference: string;
  sourceUrl: string;
  article: string;
  publicationDate: string;
  effectiveFrom: string;
  effectiveTo?: string | null;
  rate: string | null;
  threshold: string | null;
  cap: string | null;
  rounding: string;
  required: boolean;
  formula: string;
  parameters: Record<string, unknown>;
  notes: string;
}

/**
 * Official-source seeds. A seed is RESEARCHED (source identified and formula
 * implemented), never EXPERT_VALIDATED. The source text values live in
 * `parameters`; changing one requires a new version row, never an update.
 */
const RULE_SEEDS: RuleSeed[] = [
  {
    ruleCode: 'PAYE', nameEn: 'PAYE progressive cumulative bands',
    nameFr: 'PAYE — tranches progressives cumulatives',
    legalSource: 'Mauritius Revenue Authority — Guide on PAYE, December 2025, Table B and Fourteenth Schedule (Income Tax Regulations 1996)',
    sourceReference: 'PAYE Guide Dec 2025 §1 and §6, Table B / Table C',
    sourceUrl: 'https://www.mra.mu/download/PayeGuide.pdf',
    article: 'Finance Act 2025 progressive rates as from July 2025; Fourteenth Schedule',
    publicationDate: '2025-12-01', effectiveFrom: '2025-07-01', effectiveTo: '2026-06-30',
    rate: '20', threshold: '500000', cap: null,
    rounding: 'Cumulative tax rounded down to the nearest rupee',
    required: true,
    formula: 'Cumulative chargeable income = cumulative emoluments − cumulative EDF reliefs; first 500,000 at 0%, next 500,000 at 10%, remainder at 20%; cumulative PAYE less tax already withheld',
    parameters: {
      bands: [{ upto: '500000', rate: '0' }, { upto: '1000000', rate: '10' }, { upto: null, rate: '20' }],
      annualReliefDivisorMonthly: 13,
      fscApplicable: true,
      noEdfRuleAvailable: true,
    },
    notes: 'Bands are annual and scaled by elapsed pay periods with the official 1/13, 1/28 and 1/56 fractions. No Fair Share Contribution is included.',
  },
  {
    ruleCode: 'PAYE', nameEn: 'PAYE progressive cumulative bands from 1 July 2026',
    nameFr: 'PAYE — tranches progressives cumulatives à partir du 1er juillet 2026',
    legalSource: 'Finance Act 2026 (Act No. 14 of 2026), section 7; MRA Employee Declaration Form 2026/2027, note 2 “Income Tax Rates and Bands”',
    sourceReference: 'Finance Act 2026 s.7; EDF 2026/27 note 2; MRA cumulative PAYE method',
    sourceUrl: 'https://www.mra.mu/download/FinanceAct2026.pdf',
    article: 'Income Tax Act — rates for the income year 1 July 2026 to 30 June 2027; individual Fair Share Contribution replaced by the 35% band',
    publicationDate: '2026-08-12', effectiveFrom: '2026-07-01', effectiveTo: '2027-06-30',
    rate: '35', threshold: '500000', cap: null,
    rounding: 'Cumulative tax rounded down to the nearest rupee',
    required: true,
    formula: 'Cumulative chargeable income = cumulative emoluments − cumulative EDF reliefs; first 500,000 at 0%, next 500,000 at 10%, next 11,000,000 at 20%, remainder at 35%; cumulative PAYE less tax already withheld',
    parameters: {
      bands: [
        { upto: '500000', rate: '0' },
        { upto: '1000000', rate: '10' },
        { upto: '12000000', rate: '20' },
        { upto: null, rate: '35' },
      ],
      annualReliefDivisorMonthly: 13,
      fscApplicable: false,
      noEdfRuleAvailable: false,
      monthlyWithholdingTableVerified: false,
    },
    notes: 'Annual bands are verified in the enacted Act and the official 2026/27 EDF. As at 31 October 2026 the MRA 2026/27 monthly cumulative withholding table had not been located; the published cumulative 1/13 method is applied and the calculation stays review_required/expert_review_pending. The individual FSC is not applied. No-EDF employees remain blocked until a 2026/27 no-EDF rule is officially verified.',
  },
  {
    ruleCode: 'PAYE_NO_EDF', nameEn: 'PAYE flat rate where no EDF is furnished',
    nameFr: 'PAYE — taux forfaitaire sans EDF',
    legalSource: 'Mauritius Revenue Authority — Guide on PAYE, December 2025, §5.9.1',
    sourceReference: 'PAYE Guide Dec 2025 §5.9.1',
    sourceUrl: 'https://www.mra.mu/download/PayeGuide.pdf',
    article: 'Employee has not submitted an EDF; emoluments exceed Rs 38,462 per month',
    publicationDate: '2025-12-01', effectiveFrom: '2025-07-01', effectiveTo: '2026-06-30',
    rate: '15', threshold: '38462', cap: null,
    rounding: 'Rounded down to the nearest rupee',
    required: true,
    formula: 'If monthly emoluments exceed 38,462 and no EDF is furnished, withhold 15% flat unless the employee elected 20%',
    parameters: { employeeElectionRate: '20' },
    notes: 'The 20% employee election is implemented as an explicit employee flag; it is never inferred.',
  },
  {
    ruleCode: 'CSG_PRIVATE', nameEn: 'CSG — private-sector employee and employer rates',
    nameFr: 'CSG — taux salarié et employeur du secteur privé',
    legalSource: 'Mauritius Revenue Authority — Contribution Sociale Généralisée page (Social Contribution and Social Benefits Act 2021)',
    sourceReference: 'MRA CSG page §The Contributions, rate table',
    sourceUrl: 'https://mra.mu/index.php/business/csg',
    article: 'Employee other than a Public Sector employee; basic wage/salary or prescribed bonus threshold Rs 50,000',
    publicationDate: '2021-09-01', effectiveFrom: '2021-09-01',
    rate: '6', threshold: '50000', cap: null,
    rounding: 'No statutory rounding rule found; exact percentage to 4 decimals, review required',
    required: true,
    formula: 'Basic wage/salary ≤ 50,000: employee 1.5%, employer 3%. Above 50,000: employee 3%, employer 6%. Public-sector categories are not implemented.',
    parameters: {
      lowEmployeeRate: '1.5', lowEmployerRate: '3',
      highEmployeeRate: '3', highEmployerRate: '6',
    },
    notes: 'Public-sector PRB/non-PRB variants, CSG Income Allowance and prescribed-bonus cumulative rate selection are outside this implemented private-sector rule.',
  },
  {
    ruleCode: 'NSF_RATES', nameEn: 'NSF contribution rates',
    nameFr: 'NSF — taux de cotisation',
    legalSource: 'Mauritius Revenue Authority — NPF/NSF Contributions and Training Levy page',
    sourceReference: 'MRA NPF/NSF page §Contribution Rates 2. NSF Contribution',
    sourceUrl: 'https://www.mra.mu/employers/npf-nsf-contributions',
    article: 'National Savings Fund Act; employee and employer shares',
    publicationDate: '2026-07-01', effectiveFrom: '2021-09-01',
    rate: '2.5', threshold: null, cap: null,
    rounding: 'No statutory rounding rule found; exact percentage to 4 decimals, review required',
    required: true,
    formula: 'Employee 1%, employer 2.5% of the NSF assessable basic wage within the dated minimum/maximum table',
    parameters: { employeeRate: '1', employerRate: '2.5' },
    notes: 'NPF prior to September 2020 is a separate historical domain and is not applied.',
  },
  {
    ruleCode: 'NSF_LIMITS', nameEn: 'NSF minimum and maximum assessable wage (2025-2026)',
    nameFr: 'NSF — salaire cotisable minimum et maximum (2025-2026)',
    legalSource: 'Mauritius Revenue Authority — Guide to Employers on Pension Contributions, October 2025',
    sourceReference: 'MRA NPF/NSF/CSG/Levy Guide Oct 2025 §Wages or salaries, table effective 1 July 2025',
    sourceUrl: 'https://www.mra.mu/download/GuideToEmployersNPFNSF.pdf',
    article: 'NSF minimum and maximum basic wage by pay period',
    publicationDate: '2025-10-01', effectiveFrom: '2025-07-01', effectiveTo: '2026-06-30',
    rate: null, threshold: null, cap: '28570',
    rounding: 'Assessable wage table, no rounding',
    required: true,
    formula: 'Clamp the basic wage between the household/non-household minimum and the maximum for the pay frequency',
    parameters: {
      limitsByFrequency: {
        daily: { minHousehold: '108', minOther: '169', max: '1099' },
        weekly: { minHousehold: '645', minOther: '1015', max: '6593' },
        fortnightly: { minHousehold: '1290', minOther: '2031', max: '13186' },
        half_monthly: { minHousehold: '1398', minOther: '2200', max: '14285' },
        monthly: { minHousehold: '2795', minOther: '4400', max: '28570' },
      },
    },
    notes: 'Table transcribed from the October 2025 official guide. Prior years require separate dated versions.',
  },
  {
    ruleCode: 'NSF_LIMITS', nameEn: 'NSF minimum and maximum assessable wage from 1 July 2026',
    nameFr: 'NSF — salaire cotisable minimum et maximum à partir du 1er juillet 2026',
    legalSource: 'Mauritius Revenue Authority — NPF/NSF Contributions and Training Levy page',
    sourceReference: 'MRA NPF/NSF page §Wages or salaries, table effective 1 July 2026',
    sourceUrl: 'https://www.mra.mu/employers/npf-nsf-contributions',
    article: 'NSF minimum and maximum basic wage by pay period effective 1 July 2026',
    publicationDate: '2026-07-01', effectiveFrom: '2026-07-01',
    rate: null, threshold: null, cap: '29710',
    rounding: 'Assessable wage table, no rounding',
    required: true,
    formula: 'Clamp the basic wage between the household/non-household minimum and the maximum for the pay frequency',
    parameters: {
      limitsByFrequency: {
        daily: { minHousehold: '112', minOther: '176', max: '1143' },
        weekly: { minHousehold: '672', minOther: '1057', max: '6856' },
        fortnightly: { minHousehold: '1343', minOther: '2114', max: '13712' },
        half_monthly: { minHousehold: '1455', minOther: '2290', max: '14855' },
        monthly: { minHousehold: '2910', minOther: '4580', max: '29710' },
      },
    },
    notes: 'Current table transcribed from the MRA page on 31 October 2026. No universal monthly ceiling is applied to other frequencies.',
  },
  {
    ruleCode: 'TRAINING_LEVY', nameEn: 'HRDC Training Levy',
    nameFr: 'Levy de formation HRDC',
    legalSource: 'Mauritius Revenue Authority — NPF/NSF Contributions and Training Levy page',
    sourceReference: 'MRA NPF/NSF page §Contribution Rates 3. HRDC Training Levy',
    sourceUrl: 'https://www.mra.mu/employers/npf-nsf-contributions',
    article: 'Human Resource Development Act; employer-only levy on total basic wage or salary',
    publicationDate: '2021-07-01', effectiveFrom: '2021-07-01',
    rate: '1.5', threshold: null, cap: null,
    rounding: 'No statutory rounding rule found; exact percentage to 4 decimals, review required',
    required: true,
    formula: 'Employer pays 1.5% of the full basic wage/salary; NSF ceilings do not apply; household workers excluded',
    parameters: {},
    notes: 'Historical 1% regimes (2019-2021) require separate dated versions before use.',
  },
  {
    ruleCode: AR_RULE_CODE, nameEn: 'Additional Remuneration 2026',
    nameFr: 'Rémunération additionnelle 2026',
    legalSource: 'Workers’ Rights (Additional Remuneration) (2026) Regulations 2026, GN No. 7 of 2026',
    sourceReference: 'GN No. 7 of 2026, regulations 3, 4 and 5; Government Gazette No. 4 of 17 January 2026',
    sourceUrl: 'https://www.mra.mu/download/GN15WRA.pdf',
    article: 'Regulation 3(2)(a), 3(2)(b), 5',
    publicationDate: '2026-01-17', effectiveFrom: '2026-01-01', effectiveTo: '2026-12-31',
    rate: '3.7', threshold: '17110', cap: '635',
    rounding: 'Part-time percentage rounded up to the next rupee; amount capped at Rs 635',
    required: false,
    formula: 'Full-time ≤ Rs 50,000: Rs 635/month. Part-time < Rs 17,110: 3.7% rounded up. Part-time 17,110–50,000: Rs 635. Piece rates: 3.7% capped at 635, not calculated without the schedule.',
    parameters: {
      fullTimeAmount: '635', globalThreshold: '50000', partTimeThreshold: '17110',
      partTimeRate: '3.7', maximum: '635',
    },
    notes: 'Only enabled when the employer explicitly activates the 2026 switch. Excluded public-officer/PRB categories require an employee declaration.',
  },
  {
    ruleCode: BONUS_RULE_CODE, nameEn: 'Statutory end-of-year bonus',
    nameFr: 'Bonus statutaire de fin d’année',
    legalSource: 'Workers’ Rights Act 2019 (consolidated as at 9 August 2025), section 54',
    sourceReference: 'Section 54(1)(a) — bonus equivalent to one twelfth of earnings for the year',
    sourceUrl: 'https://lawsofmauritius.govmu.org/portal/viewlegislationdocument/web/?doctitle=&docnumber=QWN0IDIwIG9mIDIwMTk%3D&doctype=act',
    article: 'Section 54, End of year bonus',
    publicationDate: '2025-08-09', effectiveFrom: '2019-10-24',
    rate: '8.33333333', threshold: null, cap: null,
    rounding: 'No statutory rounding rule found; exact one-twelfth to 4 decimals',
    required: false,
    formula: 'Bonus = 1/12 of earnings for the year; employee must remain in continuous employment to 31 December (or meet the termination/resignation conditions)',
    parameters: { fraction: '1/12', highEarnerThreshold: '100000' },
    notes: 'Preview only. Payment timing, 75% December rule and high-earner gratuity regime are documented but not automated in Mission 15.',
  },
];

function sourceFingerprint(seed: RuleSeed): string {
  return createHash('sha256').update(JSON.stringify({
    ruleCode: seed.ruleCode, sourceUrl: seed.sourceUrl, sourceReference: seed.sourceReference,
    effectiveFrom: seed.effectiveFrom, effectiveTo: seed.effectiveTo ?? null,
    parameters: seed.parameters,
  })).digest('hex');
}

/** Seeds or refreshes the official-source rule metadata for one company. */
export async function ensureRulePlaceholders(db: Db, actor: PayrollActor) {
  for (const seed of RULE_SEEDS) {
    const fingerprint = sourceFingerprint(seed);
    const existing = await db.query<any>(
      `SELECT * FROM payroll_rules WHERE company_id = $1 AND upper(rule_code) = $2
          AND effective_from = $3::date ORDER BY version DESC LIMIT 1`,
      [actor.companyId, seed.ruleCode, seed.effectiveFrom ?? null],
    );
    const row = existing.rows[0];
    if (row) {
      // Never modify a validated historical version in place. Only refresh an
      // untouched seed whose structured parameters were empty (mission 14 rows).
      if (Object.keys((row.parameters as Record<string, unknown>) ?? {}).length === 0) {
        await db.query(
          `UPDATE payroll_rules SET parameters = $3::jsonb, formula = $4, article = $5,
                  source_url = COALESCE(source_url, $6), source_fingerprint = $7,
                  implementation_status = 'IMPLEMENTED', implemented_at = now(),
                  status = CASE WHEN status = 'UNVERIFIED' THEN 'RESEARCHED' ELSE status END,
                  updated_at = now()
            WHERE id = $1 AND company_id = $2`,
          [row.id, actor.companyId, JSON.stringify(seed.parameters), seed.formula,
            seed.article, seed.sourceUrl, fingerprint],
        );
      }
      continue;
    }
    const versionRes = await db.query<{ version: number }>(
      `SELECT COALESCE(MAX(version),0) AS version FROM payroll_rules
        WHERE company_id = $1 AND upper(rule_code) = $2`,
      [actor.companyId, seed.ruleCode],
    );
    const version = Number(versionRes.rows[0]?.version ?? 0) + 1;
    await db.query(
      `INSERT INTO payroll_rules
        (cabinet_id, company_id, rule_code, name_en, name_fr, legal_source, source_reference,
         source_url, effective_from, effective_to, calculation_basis, rate, threshold_amount,
         cap_amount, rounding_policy, status, required_for_calculation, version, test_cases,
         notes, created_by, parameters, formula, article, publication_date, accessed_at,
         source_fingerprint, implemented_at, implementation_status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'RESEARCHED',$16,$17,
               '[]'::jsonb,$18,$19,$20::jsonb,$21,$22,$23,$24,$25,now(),'IMPLEMENTED')`,
      [actor.cabinetId, actor.companyId, seed.ruleCode, seed.nameEn, seed.nameFr,
        seed.legalSource, seed.sourceReference, seed.sourceUrl, seed.effectiveFrom,
        seed.effectiveTo ?? null, seed.formula, seed.rate, seed.threshold, seed.cap,
        seed.rounding, seed.required, version, seed.notes, actor.userId,
        JSON.stringify(seed.parameters), seed.formula, seed.article, seed.publicationDate,
        '2026-10-31', fingerprint],
    );
    // Close the previous open version the day before a newly seeded version.
    // Only the effective end date is touched: rates and historical calculations
    // are never rewritten. This keeps existing databases consistent with a
    // fresh seed, where the previous version already carries its `effective_to`.
    if (seed.effectiveFrom) {
      await db.query(
        `UPDATE payroll_rules
            SET effective_to = $3::date - 1, updated_at = now()
          WHERE company_id = $1 AND upper(rule_code) = $2
            AND effective_from < $3::date
            AND (effective_to IS NULL OR effective_to >= $3::date)`,
        [actor.companyId, seed.ruleCode, seed.effectiveFrom],
      );
    }
  }
}

export async function listRules(db: Db, companyId: string) {
  const res = await db.query<any>(
    `SELECT r.*, u.full_name AS reviewer_name FROM payroll_rules r
       LEFT JOIN app_users u ON u.id = r.reviewer_id
      WHERE r.company_id = $1 ORDER BY r.required_for_calculation DESC, r.rule_code, r.version DESC`,
    [companyId],
  );
  return res.rows;
}

export interface RuleInput {
  ruleCode: string;
  nameEn: string;
  nameFr: string;
  legalSource?: string | null;
  sourceReference?: string | null;
  sourceUrl?: string | null;
  sourceFingerprint?: string | null;
  article?: string | null;
  publicationDate?: string | null;
  parameters?: unknown;
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
  employeeCategory?: string | null;
  employerCategory?: string | null;
  calculationBasis?: string | null;
  rate?: string | number | null;
  thresholdAmount?: string | number | null;
  capAmount?: string | number | null;
  exemptionAmount?: string | number | null;
  roundingPolicy?: string | null;
  requiredForCalculation?: boolean;
  testCases?: unknown[];
  notes?: string | null;
}

export async function createRule(db: Db, actor: PayrollActor, input: RuleInput) {
  requireWriter(actor);
  if (!input.ruleCode?.trim() || !input.nameEn?.trim() || !input.nameFr?.trim()) {
    throw badRequest('VALIDATION_ERROR', 'Rule code and both names are required');
  }
  if (input.rate !== null && input.rate !== undefined && input.rate !== '' && money(input.rate) < 0n) {
    throw badRequest('VALIDATION_ERROR', 'A rule rate cannot be negative');
  }
  if (!input.effectiveFrom) {
    throw badRequest('VALIDATION_ERROR', 'An explicit effective date is required: rules never apply retroactively by default');
  }
  const effectiveFrom = input.effectiveFrom;
  return db.transaction(async (tx) => {
  const existing = await tx.query<any>(
    'SELECT * FROM payroll_rules WHERE company_id = $1 AND upper(rule_code) = upper($2) ORDER BY version DESC LIMIT 1',
    [actor.companyId, input.ruleCode.trim()],
  );
  const previous = existing.rows[0];
  if (previous && effectiveFrom <= previous.effective_from) {
    throw conflict('PAYROLL_RULE_VERSION_OVERLAP', 'A new rule version must start after the previous version; historical periods are never recalculated silently');
  }
  const version = (previous?.version ?? 0) + 1;
  if (previous) {
    await tx.query(
      `UPDATE payroll_rules SET effective_to = ($3::date - INTERVAL '1 day')::date, updated_at = now()
        WHERE id = $1 AND company_id = $2 AND (effective_to IS NULL OR effective_to > $3::date)`,
      [previous.id, actor.companyId, effectiveFrom],
    );
  }
  const res = await tx.query<any>(
    `INSERT INTO payroll_rules
      (cabinet_id, company_id, rule_code, name_en, name_fr, legal_source, source_reference, source_url,
       source_fingerprint, article, publication_date, parameters,
       effective_from, effective_to, employee_category, employer_category, calculation_basis, rate,
       threshold_amount, cap_amount, exemption_amount, rounding_policy, status,
       required_for_calculation, version, test_cases, notes, created_by, accessed_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,'UNVERIFIED',$23,$24,$25::jsonb,$26,$27,now())
     RETURNING *`,
    [
      actor.cabinetId, actor.companyId, input.ruleCode.trim().toUpperCase(), input.nameEn.trim(),
      input.nameFr.trim(), input.legalSource?.trim() || null, input.sourceReference?.trim() || null,
      input.sourceUrl?.trim() || null, input.sourceFingerprint?.trim() || null,
      input.article?.trim() || null, input.publicationDate || null,
      JSON.stringify(input.parameters ?? {}),
      effectiveFrom, input.effectiveTo || null,
      input.employeeCategory?.trim() || null, input.employerCategory?.trim() || null,
      input.calculationBasis?.trim() || null,
      input.rate === null || input.rate === undefined || input.rate === '' ? null : fmt(money(input.rate)),
      input.thresholdAmount ? fmt(money(input.thresholdAmount)) : null,
      input.capAmount ? fmt(money(input.capAmount)) : null,
      input.exemptionAmount ? fmt(money(input.exemptionAmount)) : null,
      input.roundingPolicy?.trim() || null, input.requiredForCalculation ?? true, version,
      JSON.stringify(input.testCases ?? []), input.notes?.trim() || null, actor.userId,
    ],
  );
  await audit(tx, actor, 'payroll.rule.create', 'payroll_rule', res.rows[0]!.id, {
    ruleCode: input.ruleCode, version, status: 'UNVERIFIED', effectiveFrom,
  });
  return res.rows[0];
  });
}

export async function validateRule(
  db: Db, actor: PayrollActor, id: string,
  input: { confirm: boolean; note?: string | null; legalSource?: string | null; sourceReference?: string | null },
) {
  requireAdmin(actor);
  if (!input.confirm) throw badRequest('PAYROLL_RULE_NOT_VALIDATED', 'Explicit expert confirmation is required');
  return db.transaction(async (tx) => {
    const current = await tx.query<any>(
      'SELECT * FROM payroll_rules WHERE id = $1 AND company_id = $2 FOR UPDATE',
      [id, actor.companyId],
    );
    const row = current.rows[0];
    if (!row) throw notFound('PAYROLL_RULE_NOT_FOUND', 'Rule not found');
    if (row.status === 'DEPRECATED') throw conflict('PAYROLL_RULE_NOT_VALIDATED', 'A deprecated rule cannot be validated');
    const source = input.legalSource?.trim() || row.legal_source;
    const reference = input.sourceReference?.trim() || row.source_reference;
    if (!source || !reference || !row.effective_from) {
      throw badRequest('PAYROLL_RULE_NOT_VALIDATED', 'A legal source, a reference and an effective date are required before validation');
    }
    const hasParameters = row.parameters && Object.keys(row.parameters).length > 0;
    if (row.required_for_calculation && row.rate === null && !hasParameters) {
      throw badRequest('PAYROLL_RULE_NOT_VALIDATED', 'A required rule cannot be validated without an explicit documented rate or structured parameters');
    }
    if (row.required_for_calculation && (!row.source_url || !row.source_fingerprint)) {
      throw badRequest('PAYROLL_RULE_NOT_VALIDATED', 'An official URL and a source fingerprint must be recorded before expert validation');
    }
    const updated = await tx.query<any>(
      `UPDATE payroll_rules SET status = 'EXPERT_VALIDATED', legal_source = $2, source_reference = $3,
              reviewer_id = $4, validated_at = now(), notes = COALESCE($5, notes), updated_at = now()
        WHERE id = $1 RETURNING *`,
      [id, source, reference, actor.userId, input.note?.trim() || null],
    );
    await audit(tx, actor, 'payroll.rule.validate', 'payroll_rule', id, {
      ruleCode: row.rule_code, version: row.version, source, reference,
    });
    return updated.rows[0];
  });
}

export async function requiredRulesStatus(db: Db, companyId: string, onDate: string) {
  const res = await db.query<any>(
    `SELECT DISTINCT ON (upper(rule_code)) upper(rule_code) AS rule_code, id, status, name_en, name_fr,
            rate, effective_from, effective_to, validated_at, parameters, legal_source,
            source_reference, source_url, source_fingerprint, version, rounding_policy
       FROM payroll_rules
      WHERE company_id = $1 AND required_for_calculation = true
        AND (effective_from IS NULL OR effective_from <= $2::date)
        AND (effective_to IS NULL OR effective_to >= $2::date)
        AND status <> 'DEPRECATED'
      ORDER BY upper(rule_code), version DESC, effective_from DESC NULLS LAST`,
    [companyId, onDate],
  );
  const byCode = new Map(res.rows.map((r) => [r.rule_code, r]));
  const effectivePaye = byCode.get('PAYE');
  const requiredCodes = REQUIRED_RULE_CODES.filter((code) =>
    code !== 'PAYE_NO_EDF' || !effectivePaye ||
    effectivePaye.parameters?.noEdfRuleAvailable !== false);
  return requiredCodes.map((code) => {
    const row = byCode.get(code);
    const sourceComplete = Boolean(row?.legal_source && row?.source_reference && row?.source_url);
    const parametersComplete = Boolean(row && ((row.parameters && Object.keys(row.parameters).length > 0) || row.rate !== null));
    const usable = Boolean(row && sourceComplete && parametersComplete &&
      ['RESEARCHED', 'REVIEW_REQUIRED', 'EXPERT_VALIDATED'].includes(row.status));
    return {
      ruleCode: code,
      found: Boolean(row),
      usable,
      validated: row?.status === 'EXPERT_VALIDATED',
      expertValidated: row?.status === 'EXPERT_VALIDATED',
      status: row?.status ?? 'MISSING',
      rate: row?.rate ?? null,
      effectiveFrom: row?.effective_from ?? null,
      effectiveTo: row?.effective_to ?? null,
      version: row?.version ?? null,
      parameters: row?.parameters ?? {},
      sourceComplete,
      parametersComplete,
      rounding: row?.rounding_policy ?? null,
    };
  });
}

// ---------------------------------------------------------------------------
// Periods
// ---------------------------------------------------------------------------

function monthBounds(year: number, month: number) {
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 0));
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

export async function listPeriods(db: Db, companyId: string) {
  const res = await db.query<any>(
    `SELECT p.*, (SELECT count(*)::int FROM payroll_calculations c WHERE c.period_id = p.id) AS calculation_count,
            (SELECT count(*)::int FROM payroll_payslips s WHERE s.period_id = p.id) AS payslip_count
       FROM payroll_periods p WHERE p.company_id = $1
      ORDER BY p.period_year DESC, p.period_month DESC LIMIT 120`,
    [companyId],
  );
  return res.rows;
}

export async function createPeriod(
  db: Db, actor: PayrollActor,
  input: { year: number; month: number; paymentDate?: string | null },
) {
  requireWriter(actor);
  if (!Number.isInteger(input.year) || input.year < 2000 || input.year > 2100 || input.month < 1 || input.month > 12) {
    throw badRequest('VALIDATION_ERROR', 'Invalid payroll period');
  }
  const bounds = monthBounds(input.year, input.month);
  try {
    const res = await db.query<any>(
      `INSERT INTO payroll_periods
        (cabinet_id, company_id, period_year, period_month, start_date, end_date, payment_date, status, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'draft',$8) RETURNING *`,
      [actor.cabinetId, actor.companyId, input.year, input.month, bounds.start, bounds.end, input.paymentDate || bounds.end, actor.userId],
    );
    await audit(db, actor, 'payroll.period.create', 'payroll_period', res.rows[0]!.id, {
      year: input.year, month: input.month,
    });
    return res.rows[0];
  } catch (error: any) {
    if (String(error?.code) === '23505') throw conflict('PAYROLL_PERIOD_EXISTS', 'This payroll period already exists');
    throw error;
  }
}

const PERIOD_TRANSITIONS: Record<string, string[]> = {
  draft: ['data_collection'],
  data_collection: ['ready_for_review', 'blocked'],
  ready_for_review: ['data_collection', 'calculated', 'blocked'],
  blocked: ['data_collection', 'calculated'],
  calculated: ['ready_for_review', 'approved', 'blocked'],
  approved: ['calculated', 'finalised'],
  finalised: [],
};

export async function changePeriodStatus(
  db: Db, actor: PayrollActor, id: string,
  input: { status: string; reason?: string | null; confirm?: boolean },
) {
  requireWriter(actor);
  return db.transaction(async (tx) => {
    const current = await tx.query<any>(
      'SELECT * FROM payroll_periods WHERE id = $1 AND company_id = $2 FOR UPDATE',
      [id, actor.companyId],
    );
    const row = current.rows[0];
    if (!row) throw notFound('PAYROLL_PERIOD_NOT_FOUND', 'Payroll period not found');
    if (!PERIOD_TRANSITIONS[row.status]?.includes(input.status)) {
      throw conflict('PAYROLL_PERIOD_TRANSITION', `Transition ${row.status} -> ${input.status} is not allowed`);
    }
    if ((input.status === 'finalised' || (row.status === 'finalised' && input.status !== 'finalised')) && !input.confirm) {
      throw badRequest('PAYROLL_PERIOD_TRANSITION', 'Explicit confirmation is required');
    }
    if (input.status === 'finalised') {
      requireAdmin(actor);
      const rules = await requiredRulesStatus(tx, actor.companyId, row.end_date);
      if (rules.some((r) => !r.validated)) {
        throw conflict('PAYROLL_RULES_NOT_VALIDATED', 'Required payroll rules are not expert-validated', { rules });
      }
      throw conflict('PAYROLL_STATUTORY_ENGINE_NOT_IMPLEMENTED',
        'No statutory engine is implemented: a payroll period cannot be finalised');
    }
    const updated = await tx.query<any>(
      `UPDATE payroll_periods SET status = $2, updated_at = now(),
              reopened_at = CASE WHEN $2 IN ('data_collection','calculated') THEN now() ELSE reopened_at END,
              reopen_reason = CASE WHEN $2 IN ('data_collection','calculated') THEN $3 ELSE reopen_reason END
        WHERE id = $1 RETURNING *`,
      [id, input.status, input.reason?.trim() || null],
    );
    await audit(tx, actor, 'payroll.period.status', 'payroll_period', id, {
      from: row.status, to: input.status, reason: input.reason ?? null,
    });
    return updated.rows[0];
  });
}

// ---------------------------------------------------------------------------
// Variables
// ---------------------------------------------------------------------------

export async function listVariables(
  db: Db, companyId: string, filters: { periodId?: string; employeeId?: string; status?: string } = {},
) {
  const params: unknown[] = [companyId];
  const where = ['v.company_id = $1'];
  if (filters.periodId) { params.push(filters.periodId); where.push(`v.period_id = $${params.length}`); }
  if (filters.employeeId) { params.push(filters.employeeId); where.push(`v.employee_id = $${params.length}`); }
  if (filters.status) { params.push(filters.status); where.push(`v.status = $${params.length}`); }
  const res = await db.query<any>(
    `SELECT v.*, e.employee_number, e.full_name, p.code AS pay_item_code,
            p.label_en, p.label_fr, p.category
       FROM payroll_variables v
       JOIN payroll_employees e ON e.id = v.employee_id
       JOIN payroll_pay_items p ON p.id = v.pay_item_id
      WHERE ${where.join(' AND ')} ORDER BY e.full_name, v.created_at DESC LIMIT 2000`,
    params,
  );
  return res.rows;
}

export interface VariableInput {
  periodId: string;
  employeeId: string;
  payItemId: string;
  quantity?: string | number;
  rate?: string | number;
  amount?: string | number;
  note?: string | null;
  importKey?: string | null;
  source?: 'manual' | 'csv' | 'xlsx' | 'api';
  status?: 'draft' | 'validated';
}

export async function createVariable(db: Db, actor: PayrollActor, input: VariableInput) {
  requireWriter(actor);
  const period = await db.query<any>(
    'SELECT * FROM payroll_periods WHERE id = $1 AND company_id = $2',
    [input.periodId, actor.companyId],
  );
  if (!period.rows[0]) throw notFound('PAYROLL_PERIOD_NOT_FOUND', 'Payroll period not found');
  if (['approved', 'finalised'].includes(period.rows[0].status)) {
    throw conflict('PAYROLL_PERIOD_CLOSED', 'Variables cannot be added to an approved or finalised period');
  }
  const employee = await db.query('SELECT 1 FROM payroll_employees WHERE id = $1 AND company_id = $2', [input.employeeId, actor.companyId]);
  if (!employee.rowCount) throw notFound('PAYROLL_EMPLOYEE_NOT_FOUND', 'Employee not found');
  const item = await db.query<any>('SELECT * FROM payroll_pay_items WHERE id = $1 AND company_id = $2', [input.payItemId, actor.companyId]);
  if (!item.rows[0]) throw notFound('PAYROLL_PAY_ITEM_NOT_FOUND', 'Pay item not found');
  const quantity = money(input.quantity ?? 1);
  const rate = money(input.rate ?? 0);
  const amount = input.amount !== undefined && input.amount !== null && input.amount !== ''
    ? money(input.amount)
    : divRound(quantity * rate, 10_000n);
  if (amount < 0n) throw badRequest('VALIDATION_ERROR', 'A variable amount cannot be negative');
  try {
    const res = await db.query<any>(
      `INSERT INTO payroll_variables
        (cabinet_id, company_id, period_id, employee_id, pay_item_id, quantity, rate, amount,
         note, status, import_key, source, created_by, validated_by, validated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
      [
        actor.cabinetId, actor.companyId, input.periodId, input.employeeId, input.payItemId,
        fmt(quantity), fmt(rate), fmt(amount), input.note?.trim() || null,
        input.status ?? 'draft', input.importKey ?? null, input.source ?? 'manual', actor.userId,
        input.status === 'validated' ? actor.userId : null,
        input.status === 'validated' ? nowIso() : null,
      ],
    );
    await audit(db, actor, 'payroll.variable.create', 'payroll_variable', res.rows[0]!.id, {
      periodId: input.periodId, employeeId: input.employeeId, payItemId: input.payItemId, amount: fmt(amount),
    });
    return res.rows[0];
  } catch (error: any) {
    if (String(error?.code) === '23505') {
      throw conflict('PAYROLL_VARIABLE_DUPLICATE', 'This variable was already imported');
    }
    throw error;
  }
}

export async function validateVariable(db: Db, actor: PayrollActor, id: string) {
  requireWriter(actor);
  const res = await db.query<any>(
    `UPDATE payroll_variables SET status = 'validated', validated_by = $3, validated_at = now(), updated_at = now()
      WHERE id = $1 AND company_id = $2 AND status = 'draft' RETURNING *`,
    [id, actor.companyId, actor.userId],
  );
  if (!res.rows[0]) throw notFound('PAYROLL_VARIABLE_NOT_FOUND', 'Draft variable not found');
  await audit(db, actor, 'payroll.variable.validate', 'payroll_variable', id, {});
  return res.rows[0];
}

export interface ImportRow {
  employeeNumber: string;
  payItemCode: string;
  quantity?: string | number;
  rate?: string | number;
  amount?: string | number;
  externalRef?: string | null;
  note?: string | null;
}

export async function importVariables(
  db: Db, actor: PayrollActor, periodId: string,
  rows: ImportRow[], source: 'csv' | 'xlsx' = 'csv',
) {
  requireWriter(actor);
  if (!Array.isArray(rows) || rows.length === 0) throw badRequest('PAYROLL_IMPORT_INVALID', 'No row to import');
  if (rows.length > 1000) throw badRequest('PAYROLL_IMPORT_INVALID', 'At most 1000 rows per import');
  const period = await db.query<any>('SELECT * FROM payroll_periods WHERE id = $1 AND company_id = $2', [periodId, actor.companyId]);
  if (!period.rows[0]) throw notFound('PAYROLL_PERIOD_NOT_FOUND', 'Payroll period not found');
  if (['approved', 'finalised'].includes(period.rows[0].status)) {
    throw conflict('PAYROLL_PERIOD_CLOSED', 'Import refused on a closed period');
  }
  const employees = await db.query<any>('SELECT id, employee_number FROM payroll_employees WHERE company_id = $1', [actor.companyId]);
  const items = await db.query<any>('SELECT id, code FROM payroll_pay_items WHERE company_id = $1', [actor.companyId]);
  const employeeByNumber = new Map(employees.rows.map((e) => [String(e.employee_number).toLowerCase(), e]));
  const itemByCode = new Map(items.rows.map((i) => [String(i.code).toLowerCase(), i]));
  const batchHash = hash(JSON.stringify(rows));
  const errors: { row: number; code: string; message: string }[] = [];
  const parsed: (VariableInput & { row: number })[] = [];
  rows.forEach((row, index) => {
    const employee = employeeByNumber.get(String(row.employeeNumber ?? '').trim().toLowerCase());
    const item = itemByCode.get(String(row.payItemCode ?? '').trim().toLowerCase());
    if (!employee) errors.push({ row: index + 1, code: 'PAYROLL_IMPORT_INVALID', message: `Unknown employee ${row.employeeNumber}` });
    else if (!item) errors.push({ row: index + 1, code: 'PAYROLL_IMPORT_INVALID', message: `Unknown pay item ${row.payItemCode}` });
    else if (row.amount === undefined && (row.quantity === undefined || row.rate === undefined)) {
      errors.push({ row: index + 1, code: 'PAYROLL_IMPORT_INVALID', message: 'Amount or quantity+rate is required' });
    } else {
      parsed.push({
        row: index + 1, periodId, employeeId: employee.id, payItemId: item.id,
        quantity: row.quantity, rate: row.rate, amount: row.amount, note: row.note,
        source, importKey: hash(`${batchHash}:${index}:${row.externalRef ?? ''}`),
      });
    }
  });
  if (errors.length) throw badRequest('PAYROLL_IMPORT_INVALID', 'The import contains invalid rows', { errors });
  let created = 0;
  let reused = 0;
  const results: any[] = [];
  for (const row of parsed) {
    try {
      const variable = await createVariable(db, actor, row);
      created += 1;
      results.push(variable);
    } catch (error) {
      if (error instanceof Error && (error as any).code === 'PAYROLL_VARIABLE_DUPLICATE') {
        reused += 1;
      } else {
        throw error;
      }
    }
  }
  await audit(db, actor, 'payroll.variable.import', 'payroll_period', periodId, {
    rows: rows.length, created, reused, source, batchHash,
  });
  return { created, reused, skipped: rows.length - created - reused, rows: results.length };
}

// ---------------------------------------------------------------------------
// Arithmetic helpers
// ---------------------------------------------------------------------------

function divRound(value: bigint, divisor: bigint): bigint {
  if (divisor === 0n) return 0n;
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const quotient = abs / divisor;
  const remainder = abs % divisor;
  const rounded = remainder * 2n >= divisor ? quotient + 1n : quotient;
  return negative ? -rounded : rounded;
}

function eachDate(from: string, to: string): string[] {
  const dates: string[] = [];
  let current = from;
  while (current <= to) {
    dates.push(current);
    current = addDays(current, 1);
  }
  return dates;
}

function pickContract(contracts: any[], date: string) {
  return contracts.find(
    (c) => c.effective_from <= date && (!c.effective_to || c.effective_to >= date),
  ) ?? null;
}

async function loadEffectiveRules(db: Db, companyId: string, onDate: string) {
  const res = await db.query<any>(
    `SELECT DISTINCT ON (upper(rule_code)) *
       FROM payroll_rules
      WHERE company_id = $1 AND status <> 'DEPRECATED'
        AND (effective_from IS NULL OR effective_from <= $2::date)
        AND (effective_to IS NULL OR effective_to >= $2::date)
      ORDER BY upper(rule_code), version DESC, effective_from DESC NULLS LAST`,
    [companyId, onDate],
  );
  return new Map<string, any>(res.rows.map((row) => [String(row.rule_code).toUpperCase(), row]));
}

function ageAt(dateOfBirth: string | null, onDate: string): number | null {
  if (!dateOfBirth) return null;
  const [by, bm, bd] = dateOfBirth.slice(0, 10).split('-').map(Number);
  const [oy, om, od] = onDate.slice(0, 10).split('-').map(Number);
  if (!by || !bm || !bd || !oy || !om || !od) return null;
  let age = oy - by;
  if (om < bm || (om === bm && od < bd)) age -= 1;
  return age;
}

function payPeriodsElapsed(taxYearStart: string, periodEnd: string, frequency: PayFrequency): number {
  if (frequency === 'monthly') {
    const [sy = 0, sm = 1] = taxYearStart.slice(0, 7).split('-').map(Number);
    const [ey = 0, em = 1] = periodEnd.slice(0, 7).split('-').map(Number);
    return Math.max(1, (ey - sy) * 12 + (em - sm) + 1);
  }
  const days = daysInclusive(taxYearStart, periodEnd);
  const step = frequency === 'fortnightly' ? 14 : 7;
  return Math.max(1, Math.ceil(days / step));
}

function rulesSnapshot(rules: Map<string, any>, codes: string[]) {
  return codes.map((code) => {
    const rule = rules.get(code);
    return {
      ruleCode: code,
      version: rule?.version ?? null,
      status: rule?.status ?? 'MISSING',
      effectiveFrom: rule?.effective_from ?? null,
      sourceUrl: rule?.source_url ?? null,
      sourceReference: rule?.source_reference ?? null,
      rounding: rule?.rounding_policy ?? null,
    };
  });
}

// ---------------------------------------------------------------------------
// Calculation
// ---------------------------------------------------------------------------

export async function calculatePeriod(
  db: Db, actor: PayrollActor, periodId: string,
  options: { force?: boolean } = {},
) {
  requireWriter(actor);
  await ensureRulePlaceholders(db, actor);
  return db.transaction(async (tx) => {
    const periodRes = await tx.query<any>(
      'SELECT * FROM payroll_periods WHERE id = $1 AND company_id = $2 FOR UPDATE',
      [periodId, actor.companyId],
    );
    const period = periodRes.rows[0];
    if (!period) throw notFound('PAYROLL_PERIOD_NOT_FOUND', 'Payroll period not found');
    if (period.status === 'finalised') throw conflict('PAYROLL_PERIOD_CLOSED', 'A finalised period cannot be recalculated');
    if (period.status === 'draft') {
      throw conflict('PAYROLL_PERIOD_TRANSITION', 'Move the period to data collection before calculating');
    }
    const existing = await tx.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM payroll_calculations WHERE period_id = $1',
      [periodId],
    );
    if (Number(existing.rows[0]!.count) > 0 && !options.force) {
      throw conflict('PAYROLL_ALREADY_CALCULATED', 'This period was already calculated; reopening requires an explicit administrative action');
    }
    if (Number(existing.rows[0]!.count) > 0) requireAdmin(actor);

    const employees = await tx.query<any>(
      `SELECT * FROM payroll_employees WHERE company_id = $1
        AND employment_status IN ('active', 'probation', 'suspended')
        ORDER BY employee_number`,
      [actor.companyId],
    );
    const versionRes = await tx.query<{ version: number }>(
      'SELECT COALESCE(MAX(version),0) AS version FROM payroll_calculations WHERE period_id = $1',
      [periodId],
    );
    const version = Number(versionRes.rows[0]?.version ?? 0) + 1;
    const rules = await requiredRulesStatus(tx, actor.companyId, period.end_date);
    const missingRules = rules.filter((r) => !r.usable).map((r) => ({
      ruleCode: r.ruleCode, status: r.status,
      reason: !r.found ? 'MISSING' : !r.sourceComplete ? 'SOURCE_INCOMPLETE'
        : !r.parametersComplete ? 'PARAMETERS_MISSING' : 'NOT_SOURCE_VERIFIED',
    }));
    const allRulesExpertValidated = rules.every((r) => r.expertValidated);
    const effectiveRules = await loadEffectiveRules(tx, actor.companyId, period.end_date);
    const settingsRes = await tx.query<any>('SELECT * FROM payroll_settings WHERE company_id = $1', [actor.companyId]);
    const settings = settingsRes.rows[0] ?? {};
    const taxYearStart = taxYearStartFor(period.end_date);
    const dayCount = BigInt(daysInclusive(period.start_date, period.end_date));
    const calculations: any[] = [];

    for (const employee of employees.rows) {
      const contracts = await tx.query<any>(
        `SELECT * FROM payroll_contracts WHERE company_id = $1 AND employee_id = $2
          AND effective_from <= $3 AND (effective_to IS NULL OR effective_to >= $4)
          ORDER BY effective_from`,
        [actor.companyId, employee.id, period.end_date, period.start_date],
      );
      const dates = eachDate(period.start_date, period.end_date);
      const activeDates: { date: string; contract: any }[] = [];
      const hire = employee.hire_date ?? employee.start_date ?? null;
      const end = employee.termination_date ?? employee.end_date ?? null;
      for (const date of dates) {
        if (hire && date < hire) continue;
        if (end && date > end) continue;
        const contract = pickContract(contracts.rows, date);
        if (contract) activeDates.push({ date, contract });
      }
      const currency = activeDates[0]?.contract.currency ?? employee.payroll_currency ?? 'MUR';
      const warnings: { code: string; message: string }[] = [];
      const lines: {
        lineType: string; code: string; labelEn: string; labelFr: string;
        quantity?: string | null; rate?: string | null; amount: bigint; source?: string | null; note?: string | null;
      }[] = [];
      if (activeDates.length === 0) {
        warnings.push({ code: 'PAYROLL_NO_ACTIVE_CONTRACT', message: 'No contract covers this period: base pay is zero.' });
      }

      // Base pay. Monthly contracts are prorated by calendar days only when the
      // employment does not cover the whole period; this is arithmetic, not a
      // legal proration rule, and it is shown line by line.
      let base = 0n;
      let firstContract: any = null;
      const grouped = new Map<string, { contract: any; days: number }>();
      for (const entry of activeDates) {
        firstContract ??= entry.contract;
        const key = entry.contract.id;
        const current = grouped.get(key);
        if (current) current.days += 1;
        else grouped.set(key, { contract: entry.contract, days: 1 });
      }
      for (const { contract, days } of grouped.values()) {
        const salary = money(contract.base_salary);
        if (contract.salary_period === 'monthly') {
          const amount = days === Number(dayCount) ? salary : divRound(salary * BigInt(days), dayCount);
          base += amount;
          lines.push({
            lineType: 'base', code: 'BASE', labelEn: 'Contractual salary', labelFr: 'Salaire contractuel',
            quantity: `${days}.0000`, rate: fmt(salary), amount, source: 'contract',
            note: days === Number(dayCount) ? null : `${days} active day(s) of ${dayCount} calendar days`,
          });
        } else if (contract.salary_period === 'daily') {
          const amount = salary * BigInt(days);
          base += amount;
          lines.push({
            lineType: 'base', code: 'BASE', labelEn: 'Daily wage', labelFr: 'Salaire journalier',
            quantity: `${days}.0000`, rate: fmt(salary), amount, source: 'contract',
          });
        }
      }
      if (firstContract?.salary_period === 'hourly') {
        const times = await tx.query<any>(
          `SELECT COALESCE(SUM(hours_worked),0)::text AS hours, COALESCE(SUM(overtime_hours),0)::text AS overtime
             FROM payroll_time_entries WHERE company_id = $1 AND employee_id = $2
              AND work_date >= $3 AND work_date <= $4`,
          [actor.companyId, employee.id, period.start_date, period.end_date],
        );
        const hours = money(times.rows[0]?.hours ?? 0);
        base = divRound(hours * money(firstContract.base_salary), 10_000n);
        lines.push({
          lineType: 'base', code: 'BASE', labelEn: 'Hours worked', labelFr: 'Heures travaillées',
          quantity: fmt(hours), rate: fmt(money(firstContract.base_salary)), amount: base, source: 'time_entries',
        });
        if (money(times.rows[0]?.overtime ?? 0) > 0n) {
          warnings.push({
            code: 'OVERTIME_PREMIUM_NOT_CONFIGURED',
            message: 'Overtime hours are recorded but no legal premium is configured; they are not valued.',
          });
        }
      } else {
        const overtime = await tx.query<{ hours: string }>(
          `SELECT COALESCE(SUM(overtime_hours),0)::text AS hours FROM payroll_time_entries
            WHERE company_id = $1 AND employee_id = $2 AND work_date >= $3 AND work_date <= $4`,
          [actor.companyId, employee.id, period.start_date, period.end_date],
        );
        if (money(overtime.rows[0]?.hours ?? 0) > 0n) {
          warnings.push({
            code: 'OVERTIME_PREMIUM_NOT_CONFIGURED',
            message: 'Overtime hours are recorded but no legal hourly base or premium is configured.',
          });
        }
      }

      // Fixed allowances attached to the employee and effective during the period.
      const allowances = await tx.query<any>(
        `SELECT i.*, ep.amount FROM payroll_employee_pay_items ep
           JOIN payroll_pay_items i ON i.id = ep.pay_item_id
          WHERE ep.company_id = $1 AND ep.employee_id = $2
            AND ep.effective_from <= $4 AND (ep.effective_to IS NULL OR ep.effective_to >= $3)
            AND i.category IN ('earning','reimbursement','deduction','advance','loan')
          ORDER BY i.code`,
        [actor.companyId, employee.id, period.start_date, period.end_date],
      );
      let earnings = 0n;
      let deductions = 0n;
      let reimbursements = 0n;
      for (const allowance of allowances.rows) {
        const amount = money(allowance.amount);
        if (allowance.category === 'earning') earnings += amount;
        else if (allowance.category === 'reimbursement') reimbursements += amount;
        else deductions += amount;
        lines.push({
          lineType: allowance.category === 'earning' ? 'earning'
            : allowance.category === 'reimbursement' ? 'reimbursement'
            : allowance.category === 'advance' ? 'advance' : 'deduction',
          code: allowance.code, labelEn: allowance.label_en, labelFr: allowance.label_fr,
          amount, source: 'employee_pay_item',
        });
      }

      // Validated monthly variables only: a draft never silently enters payroll.
      const variables = await tx.query<any>(
        `SELECT v.*, i.code, i.label_en, i.label_fr, i.category, i.unit
           FROM payroll_variables v JOIN payroll_pay_items i ON i.id = v.pay_item_id
          WHERE v.company_id = $1 AND v.period_id = $2 AND v.employee_id = $3 AND v.status = 'validated'
          ORDER BY i.code, v.created_at`,
        [actor.companyId, periodId, employee.id],
      );
      for (const variable of variables.rows) {
        const amount = money(variable.amount);
        if (variable.category === 'earning') earnings += amount;
        else if (variable.category === 'reimbursement') reimbursements += amount;
        else deductions += amount;
        lines.push({
          lineType: variable.category === 'earning' ? 'earning'
            : variable.category === 'reimbursement' ? 'reimbursement'
            : variable.category === 'advance' ? 'advance'
            : variable.category === 'loan' ? 'loan' : 'deduction',
          code: variable.code, labelEn: variable.label_en, labelFr: variable.label_fr,
          quantity: variable.quantity, rate: variable.rate, amount, source: 'variable',
          note: variable.note,
        });
      }

      // Approved absences are visible but never turned into a legal deduction.
      const absences = await tx.query<any>(
        `SELECT leave_type, COALESCE(SUM(days),0)::text AS days FROM payroll_absences
          WHERE company_id = $1 AND employee_id = $2 AND status = 'approved'
            AND start_date <= $4 AND end_date >= $3 GROUP BY leave_type`,
        [actor.companyId, employee.id, period.start_date, period.end_date],
      );
      for (const absence of absences.rows) {
        warnings.push({
          code: absence.leave_type === 'unpaid' ? 'UNPAID_LEAVE_NOT_VALUED' : 'LEAVE_NOT_VALUED',
          message: `${absence.days} day(s) of ${absence.leave_type} leave are approved; no legal pay impact is configured.`,
        });
      }

      const employeeMissing: { ruleCode: string; status: string; reason: string }[] = [...missingRules];
      const reviewReasons: { code: string; message: string }[] = [];
      const effectiveCodes: string[] = [...REQUIRED_RULE_CODES];
      if (settings.statutory_ar_enabled) effectiveCodes.push(AR_RULE_CODE);

      if (currency !== 'MUR') {
        employeeMissing.push({ ruleCode: 'CURRENCY', status: 'NOT_IMPLEMENTED', reason: 'NON_MUR_PAYROLL_NOT_IMPLEMENTED' });
      }
      if (employee.paye_category && employee.paye_category !== 'standard') {
        employeeMissing.push({ ruleCode: 'PAYE_CATEGORY', status: 'NOT_IMPLEMENTED', reason: 'DIRECTOR_OR_PENSIONER_PAYE_NOT_IMPLEMENTED' });
      }
      if (employee.is_public_sector) {
        employeeMissing.push({ ruleCode: 'CSG_PUBLIC_SECTOR', status: 'MISSING', reason: 'PUBLIC_SECTOR_CSG_NOT_IMPLEMENTED' });
      }
      if (employee.country_of_residence && employee.country_of_residence !== 'Mauritius') {
        reviewReasons.push({ code: 'NON_RESIDENT_REVIEW', message: 'Non-resident status must be evidenced and reviewed; reliefs are not inferred.' });
      }

      // Additional Remuneration 2026 (opt-in). It is part of the basic wage
      // under the 2026 regulations and is therefore shown before PAYE/CSG/NSF.
      let additionalRemuneration = 0n;
      const arRule = effectiveRules.get(AR_RULE_CODE);
      if (settings.statutory_ar_enabled) {
        if (!arRule || arRule.status === 'UNVERIFIED') {
          employeeMissing.push({ ruleCode: AR_RULE_CODE, status: arRule?.status ?? 'MISSING', reason: 'ADDITIONAL_REMUNERATION_RULE_UNAVAILABLE' });
        } else {
          const p = arRule.parameters ?? {};
          const ar = computeAdditionalRemuneration({
            effectiveFrom: String(p.effectiveFrom ?? arRule.effective_from ?? '2026-01-01'),
            periodEnd: period.end_date,
            workerType: employee.worker_type === 'piece_rate' ? 'piece_rate'
              : firstContract?.work_pattern === 'part_time' ? 'part_time'
              : (employee.worker_type ?? 'full_time'),
            monthlyBasicWage: base,
            excluded: Boolean(employee.additional_remuneration_excluded),
            enabled: true,
            fullTimeAmount: String(p.fullTimeAmount ?? '635'),
            partTimeThreshold: String(p.partTimeThreshold ?? '17110'),
            partTimeRate: String(p.partTimeRate ?? '3.7'),
            maximum: String(p.maximum ?? '635'),
            globalThreshold: String(p.globalThreshold ?? '50000'),
          });
          additionalRemuneration = ar.value;
          if (additionalRemuneration > 0n) {
            lines.push({
              lineType: 'earning', code: 'AR2026',
              labelEn: 'Additional Remuneration 2026', labelFr: 'Rémunération additionnelle 2026',
              amount: additionalRemuneration, source: 'statutory_rule', note: ar.trace.join(' '),
            });
            earnings += additionalRemuneration;
          }
          if (!additionalRemuneration && employee.worker_type === 'piece_rate') {
            reviewReasons.push({ code: 'AR_PIECE_RATE_NOT_CALCULATED', message: 'Piece-rate additional remuneration requires the relevant rate schedule.' });
          }
        }
      }

      const basicWage = base + additionalRemuneration;
      const gross = base + earnings;
      if (earnings - additionalRemuneration > 0n) {
        reviewReasons.push({
          code: 'CSG_BONUS_BASE_REVIEW',
          message: 'Additional earnings are excluded from the CSG base; prescribed-bonus cumulative rate selection is not implemented.',
        });
      }
      const netArithmetic = gross + reimbursements - deductions;
      const statutoryBlocked = employeeMissing.length > 0;

      // Prior pay periods of the same tax year drive cumulative PAYE.
      const prior = await tx.query<any>(
        `SELECT DISTINCT ON (c.period_id) c.gross, c.paye, c.status, p.start_date, p.end_date
           FROM payroll_calculations c JOIN payroll_periods p ON p.id = c.period_id
          WHERE c.company_id = $1 AND c.employee_id = $2
            AND p.start_date >= $3::date AND p.end_date < $4::date
          ORDER BY c.period_id, c.version DESC`,
        [actor.companyId, employee.id, taxYearStart, period.start_date],
      );
      const priorUsable = prior.rows.filter((row) => !['blocked', 'rules_incomplete'].includes(row.status));
      const priorGross = priorUsable.reduce((sum, row) => sum + money(row.gross), 0n);
      const previousWithheld = priorUsable.reduce((sum, row) => sum + money(row.paye), 0n);
      if (prior.rows.some((row) => row.paye === null && !['blocked', 'rules_incomplete'].includes(row.status))) {
        employeeMissing.push({ ruleCode: 'PRIOR_STATUTORY', status: 'MISSING', reason: 'PRIOR_CALCULATION_WITHOUT_STATUTORY_RESULT' });
      }

      let paye: bigint | null = null;
      let csgEmployee: bigint | null = null;
      let csgEmployer: bigint | null = null;
      let nsfEmployee: bigint | null = null;
      let nsfEmployer: bigint | null = null;
      let trainingLevy: bigint | null = null;
      let edfBasis = 'NOT_EVALUATED';

      if (!statutoryBlocked) {
        const frequency = (employee.pay_frequency ?? 'monthly') as PayFrequency;
        const edf = await cumulativeEdfReliefs(
          tx, actor.companyId, employee.id, taxYearStart, period.end_date, frequency,
        );
        const payeRule = effectiveRules.get('PAYE');
        const noEdfRule = effectiveRules.get('PAYE_NO_EDF');
        if (!payeRule) {
          employeeMissing.push({ ruleCode: 'PAYE', status: 'MISSING', reason: 'PAYE_RULE_UNAVAILABLE' });
        } else if (frequency === 'daily') {
          paye = 0n;
          edfBasis = 'DAILY_PAY_EXCLUDED_FROM_PAYE';
          reviewReasons.push({ code: 'DAILY_PAY_EXCLUDED', message: 'Daily-paid workers are excluded from PAYE operation; annual liability remains the employee’s responsibility.' });
        } else if (['monthly', 'weekly', 'fortnightly'].includes(frequency)) {
          const cumulativeEmoluments = priorGross + gross;
          const fscThreshold = scaleBandThreshold(
            12_000_000n * 10_000n,
            payPeriodsElapsed(taxYearStart, period.end_date, frequency),
          );
          const fscApplicable = payeRule.parameters?.fscApplicable !== false;
          if (fscApplicable && cumulativeEmoluments > fscThreshold) {
            employeeMissing.push({ ruleCode: 'FAIR_SHARE_CONTRIBUTION', status: 'MISSING', reason: 'FAIR_SHARE_CONTRIBUTION_NOT_IMPLEMENTED' });
          } else if (edf.hasEdf) {
            const bands = (payeRule.parameters?.bands ?? []) as PayeBand[];
            const cumulativeReliefs = employee.tax_residency === 'non_resident' ? 0n : edf.cumulativeReliefs;
            const computed = computeCumulativePaye({
              cumulativeEmoluments,
              cumulativeReliefs,
              periodsElapsed: edf.periodsElapsed,
              previousWithheld,
              bands,
            });
            paye = computed.value.currentPaye;
            edfBasis = employee.tax_residency === 'non_resident' ? 'NON_RESIDENT_NO_RELIEFS' : edf.basis;
            if (employee.tax_residency === 'non_resident') {
              reviewReasons.push({ code: 'NON_RESIDENT_NO_RELIEFS', message: 'EDF reliefs ignored for a non-resident as required by the PAYE guide.' });
            }
          } else if (!noEdfRule) {
            employeeMissing.push({ ruleCode: 'PAYE_NO_EDF', status: 'MISSING', reason: 'NO_EDF_RULE_NOT_VERIFIED_FOR_PERIOD' });
          } else if (frequency !== 'monthly') {
            employeeMissing.push({ ruleCode: 'PAYE_NO_EDF', status: 'MISSING', reason: 'NO_EDF_NON_MONTHLY_NOT_VERIFIED' });
          } else {
            const computed = computePayeWithoutEdf({
              periodEmoluments: gross,
              threshold: String(noEdfRule.threshold_amount ?? '38462'),
              rate: String(noEdfRule.rate ?? '15'),
            });
            paye = computed.value;
            edfBasis = computed.value > 0n ? 'NO_EDF_FLAT_15' : 'NO_EDF_AT_OR_BELOW_THRESHOLD';
          }
        } else {
          employeeMissing.push({ ruleCode: 'PAYE_FREQUENCY', status: 'NOT_IMPLEMENTED', reason: 'PAYE_HALF_MONTHLY_NOT_VERIFIED' });
        }

        // CSG: private-sector rule only. Public sector, exempt categories and
        // prescribed-bonus cumulative rates require separate verified handling.
        const csgRule = effectiveRules.get('CSG_PRIVATE');
        if (employee.csg_exempt) {
          csgEmployee = 0n; csgEmployer = 0n;
          reviewReasons.push({ code: 'CSG_EXEMPT_DECLARED', message: employee.csg_exempt_reason ?? 'CSG exemption declared by the employer.' });
        } else if (!csgRule) {
          employeeMissing.push({ ruleCode: 'CSG_PRIVATE', status: 'MISSING', reason: 'CSG_RULE_UNAVAILABLE' });
        } else {
          const p = csgRule.parameters ?? {};
          const c = computeCsg({
            amount: basicWage,
            threshold: String(csgRule.threshold_amount ?? '50000'),
            lowEmployeeRate: String(p.lowEmployeeRate ?? '1.5'),
            lowEmployerRate: String(p.lowEmployerRate ?? '3'),
            highEmployeeRate: String(p.highEmployeeRate ?? '3'),
            highEmployerRate: String(p.highEmployerRate ?? '6'),
          });
          csgEmployee = c.value.employee;
          csgEmployer = c.value.employer;
        }

        // NSF: age evidence is mandatory; missing date of birth blocks rather
        // than assuming the employee is over 18 and under 65.
        const age = ageAt(employee.date_of_birth, period.end_date);
        const nsfRates = effectiveRules.get('NSF_RATES');
        const nsfLimitsRule = effectiveRules.get('NSF_LIMITS');
        if (employee.nsf_exempt) {
          nsfEmployee = 0n; nsfEmployer = 0n;
          reviewReasons.push({ code: 'NSF_EXEMPT_DECLARED', message: employee.nsf_exempt_reason ?? 'NSF exemption declared by the employer.' });
        } else if (age === null) {
          employeeMissing.push({ ruleCode: 'NSF_AGE', status: 'MISSING', reason: 'DATE_OF_BIRTH_REQUIRED' });
        } else if (age < 18 || age >= 65) {
          nsfEmployee = 0n; nsfEmployer = 0n;
        } else if (!nsfRates || !nsfLimitsRule) {
          employeeMissing.push({ ruleCode: 'NSF_RATES', status: 'MISSING', reason: 'NSF_RULE_UNAVAILABLE' });
        } else {
          const limits = (nsfLimitsRule.parameters?.limitsByFrequency ?? {})[frequency] as NsfLimits | undefined;
          if (!limits) {
            employeeMissing.push({ ruleCode: 'NSF_LIMITS', status: 'MISSING', reason: `NSF_LIMITS_${frequency.toUpperCase()}_MISSING` });
          } else {
            const n = computeNsf({
              basicWage,
              frequency,
              limits,
              household: Boolean(employee.is_household_worker),
              employeeRate: String(nsfRates.parameters?.employeeRate ?? '1'),
              employerRate: String(nsfRates.parameters?.employerRate ?? '2.5'),
            });
            nsfEmployee = n.value.employee;
            nsfEmployer = n.value.employer;
          }
        }

        // Training Levy is employer-only and uses the full basic wage.
        const levyRule = effectiveRules.get('TRAINING_LEVY');
        if (!levyRule) {
          employeeMissing.push({ ruleCode: 'TRAINING_LEVY', status: 'MISSING', reason: 'TRAINING_LEVY_RULE_UNAVAILABLE' });
        } else {
          const exempt = Boolean(employee.training_levy_exempt || employee.is_household_worker ||
            (age !== null && (age < 18 || age >= 70)));
          trainingLevy = computeTrainingLevy({
            basicWage, rate: String(levyRule.rate ?? '1.5'), exempt,
          }).value;
        }

        if (employeeMissing.length > 0) {
          paye = null; csgEmployee = null; csgEmployer = null;
          nsfEmployee = null; nsfEmployer = null; trainingLevy = null;
        }
      }

      const blockedNow = employeeMissing.length > 0;
      const allExpert = allRulesExpertValidated &&
        (!settings.statutory_ar_enabled || effectiveRules.get(AR_RULE_CODE)?.status === 'EXPERT_VALIDATED');
      const statutoryComplete = !blockedNow && allExpert;
      const employerContributions = (csgEmployer ?? 0n) + (nsfEmployer ?? 0n) + (trainingLevy ?? 0n);
      const netAfterStatutory = paye === null ? null
        : netArithmetic - paye - (csgEmployee ?? 0n) - (nsfEmployee ?? 0n);
      const netPayable = statutoryComplete ? netAfterStatutory : null;
      const status = blockedNow ? 'rules_incomplete'
        : reviewReasons.length > 0 ? 'review_required'
        : allExpert ? 'calculated' : 'expert_review_pending';
      const statutoryStatus = blockedNow ? 'RULES_INCOMPLETE'
        : allExpert ? 'CALCULATED' : 'EXPERT_REVIEW_PENDING';
      if (paye !== null) {
        lines.push({ lineType: 'deduction', code: 'PAYE', labelEn: 'PAYE withheld', labelFr: 'PAYE retenu', amount: paye, source: 'statutory_rule' });
      }
      if (csgEmployee !== null && csgEmployee > 0n) {
        lines.push({ lineType: 'deduction', code: 'CSG_EE', labelEn: 'CSG employee', labelFr: 'CSG salarié', amount: csgEmployee, source: 'statutory_rule' });
      }
      if (nsfEmployee !== null && nsfEmployee > 0n) {
        lines.push({ lineType: 'deduction', code: 'NSF_EE', labelEn: 'NSF employee', labelFr: 'NSF salarié', amount: nsfEmployee, source: 'statutory_rule' });
      }
      if (csgEmployer !== null && csgEmployer > 0n) {
        lines.push({ lineType: 'employer', code: 'CSG_ER', labelEn: 'CSG employer', labelFr: 'CSG employeur', amount: csgEmployer, source: 'statutory_rule' });
      }
      if (nsfEmployer !== null && nsfEmployer > 0n) {
        lines.push({ lineType: 'employer', code: 'NSF_ER', labelEn: 'NSF employer', labelFr: 'NSF employeur', amount: nsfEmployer, source: 'statutory_rule' });
      }
      if (trainingLevy !== null && trainingLevy > 0n) {
        lines.push({ lineType: 'employer', code: 'TRAINING_LEVY', labelEn: 'HRDC Training Levy', labelFr: 'Levy de formation HRDC', amount: trainingLevy, source: 'statutory_rule' });
      }
      const rulesApplied = rulesSnapshot(effectiveRules, effectiveCodes);
      const ruleVersionLabel = rulesApplied.map((r) => `${r.ruleCode}=v${r.version ?? '?'}/${r.status}`).join(',');

      const inputHash = hash(JSON.stringify({
        periodId, employeeId: employee.id, version, contracts: contracts.rows.map((c) => ({
          id: c.id, from: c.effective_from, to: c.effective_to, salary: c.base_salary,
          period: c.salary_period, currency: c.currency,
        })),
        variables: variables.rows.map((v) => ({ id: v.id, amount: v.amount, status: v.status })),
        allowances: allowances.rows.map((a) => ({ id: a.id, amount: a.amount })),
        absences: absences.rows, rules: rulesApplied,
        edfBasis, additionalRemuneration: fmt(additionalRemuneration),
      }));
      const calculationRes = await tx.query<any>(
        `INSERT INTO payroll_calculations
          (cabinet_id, company_id, period_id, employee_id, version, status, currency, contract_id,
           base_amount, proration_days, period_days, earnings, gross, deductions, net_arithmetic,
           paye, csg, nsf, employer_contributions, statutory_complete, missing_rules, warnings,
           input_hash, rule_version, calculated_by, taxable_emoluments, basic_wage, paye_basis,
           csg_employee, csg_employer, nsf_employee, nsf_employer, training_levy,
           additional_remuneration, employer_cost, net_after_statutory, net_payable,
           statutory_status, edf_basis, rules_applied, review_reasons)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
                 $21::jsonb,$22::jsonb,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39,$40::jsonb,$41::jsonb)
         RETURNING *`,
        [
          actor.cabinetId, actor.companyId, periodId, employee.id, version, status, currency,
          firstContract?.id ?? null, fmt(base),
          activeDates.length === Number(dayCount) ? null : `${activeDates.length}.0000`, Number(dayCount),
          fmt(earnings), fmt(gross), fmt(deductions), fmt(netArithmetic),
          paye === null ? null : fmt(paye), csgEmployee === null ? null : fmt(csgEmployee),
          nsfEmployee === null ? null : fmt(nsfEmployee),
          (csgEmployer === null && nsfEmployer === null && trainingLevy === null) ? null : fmt(employerContributions),
          statutoryComplete, JSON.stringify(employeeMissing), JSON.stringify(warnings), inputHash,
          `rules:${ruleVersionLabel};engine=mission15`, actor.userId,
          fmt(gross), fmt(basicWage), edfBasis,
          csgEmployee === null ? null : fmt(csgEmployee), csgEmployer === null ? null : fmt(csgEmployer),
          nsfEmployee === null ? null : fmt(nsfEmployee), nsfEmployer === null ? null : fmt(nsfEmployer),
          trainingLevy === null ? null : fmt(trainingLevy), fmt(additionalRemuneration),
          (csgEmployer === null || nsfEmployer === null || trainingLevy === null) ? null
            : fmt(gross + reimbursements + employerContributions),
          netAfterStatutory === null ? null : fmt(netAfterStatutory),
          netPayable === null ? null : fmt(netPayable),
          statutoryStatus, edfBasis, JSON.stringify(rulesApplied), JSON.stringify(reviewReasons),
        ],
      );
      const calculation = {
        ...calculationRes.rows[0]!,
        employee_number: employee.employee_number,
        full_name: employee.full_name,
      };
      let lineNo = 1;
      for (const line of lines) {
        await tx.query(
          `INSERT INTO payroll_calculation_lines
            (calculation_id, line_no, line_type, code, label_en, label_fr, quantity, rate, amount, source, note)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [calculation.id, lineNo++, line.lineType, line.code, line.labelEn, line.labelFr,
            line.quantity ?? null, line.rate ?? null, fmt(line.amount), line.source ?? null, line.note ?? null],
        );
      }
      calculations.push(calculation);
    }

    const newStatus = calculations.some((c) => c.status === 'rules_incomplete') ? 'blocked' : 'calculated';
    await tx.query(
      `UPDATE payroll_periods SET status = $2, calculated_at = now(), version = $3, updated_at = now()
        WHERE id = $1`,
      [periodId, newStatus, version],
    );
    await audit(tx, actor, 'payroll.period.calculate', 'payroll_period', periodId, {
      version, employees: calculations.length,
      blocked: calculations.filter((c) => c.status === 'rules_incomplete').length,
      expertReviewPending: calculations.filter((c) => c.status === 'expert_review_pending').length,
      missingRules: missingRules.map((r) => r.ruleCode),
    });
    return {
      period: (await tx.query<any>('SELECT * FROM payroll_periods WHERE id = $1', [periodId])).rows[0],
      version,
      calculations,
      blocked: calculations.some((c) => c.status === 'rules_incomplete'),
      statutoryComplete: calculations.length > 0 && calculations.every((c) => c.statutory_complete),
      expertReviewPending: calculations.some((c) => ['expert_review_pending', 'review_required'].includes(c.status)),
      missingRules,
      engine: 'mission15_v1',
      finalisationBlocked: true,
    };
  });
}

export async function listCalculations(db: Db, companyId: string, periodId: string) {
  const res = await db.query<any>(
    `SELECT c.*, e.employee_number, e.full_name,
            (SELECT count(*)::int FROM payroll_payslips s WHERE s.calculation_id = c.id) AS payslip_count
       FROM payroll_calculations c JOIN payroll_employees e ON e.id = c.employee_id
      WHERE c.company_id = $1 AND c.period_id = $2
      ORDER BY e.employee_number, c.version DESC`,
    [companyId, periodId],
  );
  return res.rows;
}

export async function getCalculation(db: Db, companyId: string, id: string) {
  const res = await db.query<any>(
    `SELECT c.*, e.employee_number, e.full_name, e.job_title, e.bank_name, e.bank_account_last4,
            p.period_year, p.period_month, p.start_date, p.end_date, p.payment_date,
            ct.contract_type, ct.work_pattern
       FROM payroll_calculations c
       JOIN payroll_employees e ON e.id = c.employee_id
       JOIN payroll_periods p ON p.id = c.period_id
       LEFT JOIN payroll_contracts ct ON ct.id = c.contract_id
      WHERE c.company_id = $1 AND c.id = $2`,
    [companyId, id],
  );
  const calculation = res.rows[0];
  if (!calculation) throw notFound('PAYROLL_CALCULATION_NOT_FOUND', 'Calculation not found');
  const lines = await db.query<any>(
    'SELECT * FROM payroll_calculation_lines WHERE calculation_id = $1 ORDER BY line_no',
    [id],
  );
  return {
    ...calculation,
    bankAccountMasked: calculation.bank_account_last4 ? `•••• ${calculation.bank_account_last4}` : null,
    bank_account_last4: undefined,
    lines: lines.rows,
  };
}

// ---------------------------------------------------------------------------
// Payslips (simulation only)
// ---------------------------------------------------------------------------

export async function generatePayslip(db: Db, actor: PayrollActor, calculationId: string) {
  requireWriter(actor);
  return db.transaction(async (tx) => {
    const existing = await tx.query<any>(
      'SELECT * FROM payroll_payslips WHERE company_id = $1 AND calculation_id = $2',
      [actor.companyId, calculationId],
    );
    if (existing.rows[0]) return { payslip: existing.rows[0], reused: true };
    const calculation = await getCalculation(tx, actor.companyId, calculationId);
    const company = await tx.query<any>(
      `SELECT name, brn, registered_address, business_activity, contact_email, contact_phone
         FROM companies WHERE id = $1`,
      [actor.companyId],
    );
    const sequence = await tx.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM payroll_payslips WHERE company_id = $1',
      [actor.companyId],
    );
    const payslipNo = `SIM-${calculation.period_year}${String(calculation.period_month).padStart(2, '0')}-${String(Number(sequence.rows[0]!.count) + 1).padStart(4, '0')}`;
    const snapshot = {
      disclaimer: 'SIMULATION / DRAFT — NOT FOR PAYMENT. Ce bulletin n’est pas un bulletin officiel et ne peut pas être utilisé pour payer.',
      company: {
        name: company.rows[0]?.name, brn: company.rows[0]?.brn,
        registered_address: company.rows[0]?.registered_address,
        business_activity: company.rows[0]?.business_activity,
        contact_email: company.rows[0]?.contact_email,
        contact_phone: company.rows[0]?.contact_phone,
      },
      employee: {
        number: calculation.employee_number, name: calculation.full_name,
        jobTitle: calculation.job_title,
        bankAccountMasked: calculation.bankAccountMasked,
      },
      contract: {
        type: calculation.contract_type,
        workPattern: calculation.work_pattern,
      },
      period: {
        year: calculation.period_year, month: calculation.period_month,
        start: calculation.start_date, end: calculation.end_date,
        paymentDate: calculation.payment_date,
      },
      currency: calculation.currency,
      lines: calculation.lines,
      totals: {
        base: calculation.base_amount, additionalRemuneration: calculation.additional_remuneration,
        taxableEmoluments: calculation.taxable_emoluments, gross: calculation.gross,
        deductions: calculation.deductions, netArithmetic: calculation.net_arithmetic,
        paye: calculation.paye, csgEmployee: calculation.csg_employee,
        nsfEmployee: calculation.nsf_employee, netAfterStatutory: calculation.net_after_statutory,
        netPayable: calculation.net_payable,
        csgEmployer: calculation.csg_employer, nsfEmployer: calculation.nsf_employer,
        trainingLevy: calculation.training_levy, employerCost: calculation.employer_cost,
      },
      status: calculation.status === 'rules_incomplete' ? 'blocked' : 'simulation',
      statutoryStatus: calculation.statutory_status,
      payeBasis: calculation.paye_basis,
      rulesApplied: calculation.rules_applied,
      reviewReasons: calculation.review_reasons,
      missingRules: calculation.missing_rules,
      warnings: calculation.warnings,
      calculationReference: calculation.id,
      calculationVersion: calculation.version,
      generatedAt: nowIso(),
    };
    const res = await tx.query<any>(
      `INSERT INTO payroll_payslips
        (cabinet_id, company_id, calculation_id, period_id, employee_id, payslip_no, status,
         version, snapshot, generated_by)
       VALUES ($1,$2,$3,$4,$5,$6,'simulation',1,$7::jsonb,$8) RETURNING *`,
      [actor.cabinetId, actor.companyId, calculationId, calculation.period_id,
        calculation.employee_id, payslipNo, JSON.stringify(snapshot), actor.userId],
    );
    await audit(tx, actor, 'payroll.payslip.generate', 'payroll_payslip', res.rows[0]!.id, {
      calculationId, payslipNo, status: 'simulation',
    });
    return { payslip: res.rows[0], reused: false };
  });
}

export async function listPayslips(db: Db, companyId: string, periodId?: string) {
  const params: unknown[] = [companyId];
  let where = 's.company_id = $1';
  if (periodId) { params.push(periodId); where += ` AND s.period_id = $${params.length}`; }
  const res = await db.query<any>(
    `SELECT s.*, e.employee_number, e.full_name, p.period_year, p.period_month
       FROM payroll_payslips s
       JOIN payroll_employees e ON e.id = s.employee_id
       JOIN payroll_periods p ON p.id = s.period_id
      WHERE ${where} ORDER BY p.period_year DESC, p.period_month DESC, e.employee_number`,
    params,
  );
  return res.rows;
}

export async function getPayslip(db: Db, companyId: string, id: string) {
  const res = await db.query<any>(
    'SELECT * FROM payroll_payslips WHERE company_id = $1 AND id = $2',
    [companyId, id],
  );
  if (!res.rows[0]) throw notFound('PAYROLL_PAYSLIP_NOT_FOUND', 'Payslip not found');
  return res.rows[0];
}

export async function finalisePayslip(db: Db, actor: PayrollActor, id: string) {
  requireAdmin(actor);
  const payslip = await getPayslip(db, actor.companyId, id);
  throw conflict('PAYROLL_PAYSLIP_FINAL_BLOCKED',
    'A final payslip is blocked: required Mauritian rules and the statutory engine are not validated', {
      calculationId: payslip.calculation_id,
      status: payslip.status,
    });
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

export async function payrollDashboard(db: Db, actor: PayrollActor) {
  await ensureRulePlaceholders(db, actor);
  const [employees, contracts, periods, vars, absences, rules] = await Promise.all([
    db.query<any>(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE employment_status IN ('active','probation'))::int AS active,
              count(*) FILTER (WHERE employment_status = 'terminated')::int AS terminated
         FROM payroll_employees WHERE company_id = $1`,
      [actor.companyId],
    ),
    db.query<any>(
      `SELECT count(*)::int AS expiring FROM payroll_contracts
        WHERE company_id = $1 AND status = 'active' AND contract_type = 'fixed_term'
          AND effective_to IS NOT NULL AND effective_to <= (CURRENT_DATE + INTERVAL '60 days')`,
      [actor.companyId],
    ),
    db.query<any>(
      `SELECT * FROM payroll_periods WHERE company_id = $1 ORDER BY period_year DESC, period_month DESC LIMIT 3`,
      [actor.companyId],
    ),
    db.query<any>(
      `SELECT count(*) FILTER (WHERE status = 'draft')::int AS draft,
              count(*) FILTER (WHERE status = 'validated')::int AS validated
         FROM payroll_variables WHERE company_id = $1`,
      [actor.companyId],
    ),
    db.query<any>(
      `SELECT count(*) FILTER (WHERE status = 'requested')::int AS pending
         FROM payroll_absences WHERE company_id = $1`,
      [actor.companyId],
    ),
    requiredRulesStatus(db, actor.companyId, new Date().toISOString().slice(0, 10)),
  ]);
  const missingContracts = await db.query<any>(
    `SELECT e.id, e.employee_number, e.full_name FROM payroll_employees e
      WHERE e.company_id = $1 AND e.employment_status IN ('active','probation')
        AND NOT EXISTS (SELECT 1 FROM payroll_contracts c WHERE c.employee_id = e.id
              AND c.company_id = e.company_id AND c.status = 'active')
      ORDER BY e.employee_number`,
    [actor.companyId],
  );
  return {
    available: true,
    activeEmployees: employees.rows[0]?.active ?? 0,
    totalEmployees: employees.rows[0]?.total ?? 0,
    terminatedEmployees: employees.rows[0]?.terminated ?? 0,
    expiringContracts: contracts.rows[0]?.expiring ?? 0,
    recentPeriods: periods.rows,
    variables: vars.rows[0] ?? { draft: 0, validated: 0 },
    pendingLeave: absences.rows[0]?.pending ?? 0,
    missingContracts: missingContracts.rows,
    rules,
    calculationAvailable: true,
    statutoryComplete: rules.every((r: any) => r.expertValidated),
    capabilities: {
      employees: true, contracts: true, time: true, leave: true, variables: true,
      arithmeticCalculation: true, statutoryCalculation: true, finalPayslips: false,
      statutoryDeclarations: false, accountingTransfer: false,
      paye: true, csg: true, nsf: true, employerContributions: true,
    },
    notice:
      'PAYE, CSG, NSF et Training Levy sont calculés à partir de règles sourcées, mais aucune n’est validée par un expert. Les bulletins restent des simulations et la finalisation est bloquée.',
  };
}

// ---------------------------------------------------------------------------
// Mission 15: review gates and MRA preparation (never submission)
// ---------------------------------------------------------------------------

export async function approveCalculationForTest(
  db: Db, actor: PayrollActor, calculationId: string,
  input: { confirm: true; note: string },
) {
  requireAdmin(actor);
  if (!input.confirm) throw badRequest('PAYROLL_REVIEW_REQUIRED', 'Explicit confirmation is required');
  const note = input.note?.trim();
  if (!note || note.length < 10) {
    throw badRequest('PAYROLL_REVIEW_REQUIRED', 'A review note of at least 10 characters is required');
  }
  return db.transaction(async (tx) => {
    const current = await tx.query<any>(
      `SELECT c.*, p.status AS period_status FROM payroll_calculations c
         JOIN payroll_periods p ON p.id = c.period_id
        WHERE c.company_id = $1 AND c.id = $2 FOR UPDATE`,
      [actor.companyId, calculationId],
    );
    const row = current.rows[0];
    if (!row) throw notFound('PAYROLL_CALCULATION_NOT_FOUND', 'Calculation not found');
    if (row.status === 'rules_incomplete') {
      throw conflict('PAYROLL_RULES_NOT_VALIDATED', 'A calculation with incomplete rules cannot be approved, even for testing');
    }
    if (row.status === 'approved_for_test') {
      return row;
    }
    const updated = await tx.query<any>(
      `UPDATE payroll_calculations SET status = 'approved_for_test', statutory_status = 'APPROVED_FOR_TEST',
              approved_for_test_at = now(), approved_for_test_by = $3, approved_for_test_note = $4,
              updated_at = now()
        WHERE id = $1 AND company_id = $2 RETURNING *`,
      [calculationId, actor.companyId, actor.userId, note],
    );
    await audit(tx, actor, 'payroll.calculation.approve_for_test', 'payroll_calculation', calculationId, {
      from: row.status, note, version: row.version,
    });
    return updated.rows[0];
  });
}

export async function requestExpertReview(
  db: Db, actor: PayrollActor, calculationId: string,
  input: { note: string },
) {
  requireWriter(actor);
  return db.transaction(async (tx) => {
    const current = await tx.query<any>(
      'SELECT * FROM payroll_calculations WHERE company_id = $1 AND id = $2 FOR UPDATE',
      [actor.companyId, calculationId],
    );
    const row = current.rows[0];
    if (!row) throw notFound('PAYROLL_CALCULATION_NOT_FOUND', 'Calculation not found');
    if (row.status === 'rules_incomplete') {
      throw conflict('PAYROLL_RULES_NOT_VALIDATED', 'Rules must be complete before an expert review can be requested');
    }
    const updated = await tx.query<any>(
      `UPDATE payroll_calculations SET status = 'expert_review_pending',
              statutory_status = 'EXPERT_REVIEW_PENDING', updated_at = now()
        WHERE id = $1 AND company_id = $2 RETURNING *`,
      [calculationId, actor.companyId],
    );
    await audit(tx, actor, 'payroll.calculation.review.request', 'payroll_calculation', calculationId, {
      note: input.note?.trim() || null,
    });
    return updated.rows[0];
  });
}

export interface DeclarationCheck {
  code: string;
  severity: 'ok' | 'warning' | 'block';
  scope: 'internal' | 'official';
  messageEn: string;
  messageFr: string;
  count?: number;
}

const declarationAmount = (value: unknown): string | null =>
  value === null || value === undefined || value === '' ? null : fmt(money(value));
const joinedTotal = (values: (string | null)[]): string | null =>
  values.some((value) => value === null) ? null : fmt(values.reduce((sum, value) => sum + money(value), 0n));

/**
 * Computes a monthly PAYE/CSG/NSF preparation from the persisted calculations.
 * It is deliberately not an MRA return: the official CSV template was not fully
 * verified (the December 2024 template file was unavailable), the specification
 * requires a full employee NIC/NCID that this application never stores, and the
 * employer ERN, declarant and contact fields are not collected. Amounts are
 * exact to four decimals, while the official template requires whole rupees.
 */
export async function buildMonthlyDeclaration(
  db: Db, companyId: string, periodId: string, employerIdentifier?: string | null,
) {
  const periodRes = await db.query<any>(
    'SELECT * FROM payroll_periods WHERE company_id = $1 AND id = $2',
    [companyId, periodId],
  );
  const period = periodRes.rows[0];
  if (!period) throw notFound('PAYROLL_PERIOD_NOT_FOUND', 'Payroll period not found');
  const companyRes = await db.query<any>(
    'SELECT name, brn, contact_email, contact_phone FROM companies WHERE id = $1',
    [companyId],
  );
  const company = companyRes.rows[0] ?? {};
  const calculations = await db.query<any>(
    `WITH latest AS (
       SELECT DISTINCT ON (c.employee_id) c.*
         FROM payroll_calculations c
        WHERE c.company_id = $1 AND c.period_id = $2
        ORDER BY c.employee_id, c.version DESC, c.calculated_at DESC
     )
     SELECT l.*, e.employee_number, e.full_name, e.pay_frequency, e.worker_type,
            e.is_household_worker, e.statutory_id_last4, e.employment_status,
            e.hire_date, e.termination_date
       FROM latest l
       JOIN payroll_employees e ON e.id = l.employee_id AND e.company_id = l.company_id
      ORDER BY e.employee_number`,
    [companyId, periodId],
  );
  const activeRes = await db.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM payroll_employees
      WHERE company_id = $1 AND employment_status IN ('active', 'probation')
        AND (hire_date IS NULL OR hire_date <= $2::date)
        AND (termination_date IS NULL OR termination_date >= $3::date)`,
    [companyId, period.end_date, period.start_date],
  );
  const rules = await requiredRulesStatus(db, companyId, period.end_date);

  const employees = calculations.rows.map((row) => ({
    employeeId: row.employee_id,
    employeeNumber: row.employee_number,
    fullName: row.full_name,
    payFrequency: row.pay_frequency,
    workerType: row.worker_type,
    householdWorker: Boolean(row.is_household_worker),
    statutoryIdMasked: row.statutory_id_last4 ? `•••• ${row.statutory_id_last4}` : null,
    hasFullStatutoryId: false,
    currency: row.currency,
    basicWage: declarationAmount(row.basic_wage),
    gross: declarationAmount(row.gross),
    taxableEmoluments: declarationAmount(row.taxable_emoluments),
    paye: declarationAmount(row.paye),
    csgEmployee: declarationAmount(row.csg_employee),
    csgEmployer: declarationAmount(row.csg_employer),
    nsfEmployee: declarationAmount(row.nsf_employee),
    nsfEmployer: declarationAmount(row.nsf_employer),
    trainingLevy: declarationAmount(row.training_levy),
    status: row.status,
    missingRules: row.missing_rules ?? [],
  }));
  const amountFields = [
    'basicWage', 'gross', 'taxableEmoluments', 'paye', 'csgEmployee', 'csgEmployer',
    'nsfEmployee', 'nsfEmployer', 'trainingLevy',
  ] as const;
  const totals = Object.fromEntries(
    amountFields.map((field) => [field, joinedTotal(employees.map((employee) => employee[field]))]),
  ) as Record<(typeof amountFields)[number], string | null>;
  const currencies = [...new Set(employees.map((employee) => employee.currency).filter(Boolean))];
  const incomplete = employees.filter((employee) =>
    employee.status === 'rules_incomplete' || (employee.missingRules?.length ?? 0) > 0);
  const nullStatutory = employees.filter((employee) =>
    [employee.paye, employee.csgEmployee, employee.csgEmployer, employee.nsfEmployee,
      employee.nsfEmployer, employee.trainingLevy].some((value) => value === null));
  const missingNumbers = employees.filter((employee) => !employee.employeeNumber);
  const duplicateNumbers = Object.entries(employees.reduce<Record<string, number>>((acc, employee) => {
    acc[employee.employeeNumber] = (acc[employee.employeeNumber] ?? 0) + 1;
    return acc;
  }, {})).filter(([, count]) => count > 1).map(([number]) => number);
  const unvalidatedRules = rules.filter((rule: any) => rule.status !== 'EXPERT_VALIDATED');
  const employer = String(employerIdentifier ?? '').trim();
  const checks: DeclarationCheck[] = [
    {
      code: 'COMPANY_ISOLATION', severity: 'ok', scope: 'internal',
      messageEn: 'All rows are restricted to the selected company.',
      messageFr: 'Toutes les lignes sont limitées à la société sélectionnée.',
    },
    {
      code: 'PERIOD_MATCH', severity: 'ok' as const,
      scope: 'internal',
      messageEn: 'Calculations are read from the selected payroll period.',
      messageFr: 'Les calculs proviennent de la période de paie sélectionnée.',
    },
    employees.length > 0
      ? {
          code: 'EMPLOYEES_PRESENT', severity: 'ok', scope: 'internal',
          messageEn: `${employees.length} calculation(s) found.`,
          messageFr: `${employees.length} calcul(s) trouvé(s).`,
        }
      : {
          code: 'EMPLOYEES_PRESENT', severity: 'block', scope: 'internal',
          messageEn: 'No payroll calculation exists for this period.',
          messageFr: 'Aucun calcul de paie n’existe pour cette période.',
        },
    ...(activeRes.rows[0] && Number(activeRes.rows[0].count) > employees.length
      ? [{
          code: 'EMPLOYEE_COVERAGE', severity: 'warning' as const, scope: 'internal' as const,
          messageEn: `${Number(activeRes.rows[0].count) - employees.length} active employee(s) have no calculation in this period.`,
          messageFr: `${Number(activeRes.rows[0].count) - employees.length} salarié(s) actif(s) n’ont pas de calcul sur cette période.`,
          count: Number(activeRes.rows[0].count) - employees.length,
        }]
      : []),
    incomplete.length > 0
      ? {
          code: 'CALCULATIONS_INCOMPLETE', severity: 'block', scope: 'internal',
          messageEn: `${incomplete.length} calculation(s) are blocked by missing rules.`,
          messageFr: `${incomplete.length} calcul(s) sont bloqués par des règles manquantes.`,
          count: incomplete.length,
        }
      : {
          code: 'CALCULATIONS_COMPLETE', severity: 'ok', scope: 'internal',
          messageEn: 'Every calculation uses a complete rule set.',
          messageFr: 'Chaque calcul utilise un jeu de règles complet.',
        },
    nullStatutory.length > 0
      ? {
          code: 'STATUTORY_VALUES_NULL', severity: 'block', scope: 'internal',
          messageEn: 'A statutory amount is unknown (null); zero is never substituted.',
          messageFr: 'Un montant statutaire est inconnu (null) ; zéro n’est jamais substitué.',
          count: nullStatutory.length,
        }
      : {
          code: 'STATUTORY_VALUES_PRESENT', severity: 'ok', scope: 'internal',
          messageEn: 'PAYE, CSG, NSF and Training Levy are present for every employee.',
          messageFr: 'PAYE, CSG, NSF et Training Levy sont présents pour chaque salarié.',
        },
    currencies.length > 1
      ? {
          code: 'CURRENCY_MISMATCH', severity: 'block', scope: 'internal',
          messageEn: 'Several currencies are present in one monthly declaration.',
          messageFr: 'Plusieurs devises figurent dans une même déclaration mensuelle.',
          count: currencies.length,
        }
      : {
          code: 'CURRENCY_CONSISTENCY', severity: 'ok', scope: 'internal',
          messageEn: `Single currency: ${currencies[0] ?? 'MUR'}.`,
          messageFr: `Devise unique : ${currencies[0] ?? 'MUR'}.`,
        },
    duplicateNumbers.length > 0
      ? {
          code: 'DUPLICATE_EMPLOYEE_NUMBER', severity: 'block', scope: 'internal',
          messageEn: `Duplicate employee number(s): ${duplicateNumbers.join(', ')}.`,
          messageFr: `Numéro(s) de salarié en doublon : ${duplicateNumbers.join(', ')}.`,
          count: duplicateNumbers.length,
        }
      : {
          code: 'NO_DUPLICATE_EMPLOYEE', severity: 'ok', scope: 'internal',
          messageEn: 'No duplicate employee number in the latest calculation set.',
          messageFr: 'Aucun numéro de salarié en doublon dans les derniers calculs.',
        },
    missingNumbers.length > 0
      ? {
          code: 'EMPLOYEE_NUMBER_MISSING', severity: 'block', scope: 'internal',
          messageEn: 'An employee has no payroll number.',
          messageFr: 'Un salarié n’a pas de matricule.',
          count: missingNumbers.length,
        }
      : {
          code: 'TOTALS_RECOMPUTED', severity: 'ok', scope: 'internal',
          messageEn: 'Company totals are recomputed from every employee amount.',
          messageFr: 'Les totaux société sont recalculés depuis chaque montant salarié.',
        },
    !employer
      ? {
          code: 'EMPLOYER_IDENTIFIER_REQUIRED', severity: 'warning', scope: 'internal',
          messageEn: 'A fictitious employer identifier is required before archiving the preparation.',
          messageFr: 'Un identifiant employeur fictif est requis avant d’archiver la préparation.',
        }
      : {
          code: 'EMPLOYER_IDENTIFIER_PRESENT', severity: 'ok', scope: 'internal',
          messageEn: 'A local employer identifier is recorded. It is not an MRA credential.',
          messageFr: 'Un identifiant employeur local est enregistré. Ce n’est pas un identifiant MRA.',
        },
    unvalidatedRules.length > 0
      ? {
          code: 'RULES_NOT_VALIDATED', severity: 'warning', scope: 'internal',
          messageEn: `${unvalidatedRules.length} required rule(s) are not expert-validated.`,
          messageFr: `${unvalidatedRules.length} règle(s) obligatoire(s) ne sont pas validées par un expert.`,
          count: unvalidatedRules.length,
        }
      : {
          code: 'RULES_VALIDATED', severity: 'ok', scope: 'internal',
          messageEn: 'Every required rule is expert-validated.',
          messageFr: 'Toutes les règles obligatoires sont validées par un expert.',
        },
    ...(!['calculated', 'approved_for_test', 'finalised'].includes(String(period.status))
      ? [{
          code: 'PERIOD_STATUS', severity: 'warning' as const, scope: 'internal' as const,
          messageEn: `The period status is ${period.status}; check that the calculation is final for preparation.`,
          messageFr: `Le statut de la période est ${period.status} ; vérifiez que le calcul est arrêté pour la préparation.`,
        }]
      : []),
  ];
  const officialReasons = [
    {
      code: 'EMPLOYEE_FULL_NIC_MISSING',
      messageEn: 'The official PACO template requires the full 14-character employee NIC/NCID; this application stores only the last four digits and a fingerprint.',
      messageFr: 'Le modèle officiel PACO exige le NIC/NCID complet du salarié (14 caractères) ; cette application ne conserve que les quatre derniers chiffres et une empreinte.',
    },
    {
      code: 'EMPLOYER_ERN_MISSING',
      messageEn: 'The employer ERN, declarant name and mandatory contact fields are not stored.',
      messageFr: 'L’ERN employeur, le nom du déclarant et les coordonnées obligatoires ne sont pas stockés.',
    },
    {
      code: 'TEMPLATE_NOT_FULLY_VERIFIED',
      messageEn: 'The December 2024 MRA specification fields were read, but the official CSV template file was unavailable (HTTP 500), so the complete line layout was not verified.',
      messageFr: 'Les champs de la spécification MRA de décembre 2024 ont été lus, mais le modèle CSV officiel était indisponible (HTTP 500) ; la structure complète des lignes n’a pas été vérifiée.',
    },
    {
      code: 'WHOLE_RUPEE_RULE_UNVERIFIED',
      messageEn: 'The official template requires whole rupees without cents; the law does not state a rounding rule for CSG/NSF/levy, so exact four-decimal values are kept and must not be rounded silently.',
      messageFr: 'Le modèle officiel exige des roupies entières sans centimes ; aucun texte ne fixe l’arrondi CSG/NSF/levy, donc les valeurs exactes à quatre décimales sont conservées et ne doivent pas être arrondies en silence.',
    },
  ];
  const officialChecks: DeclarationCheck[] = officialReasons.map((reason) => ({
    ...reason, severity: 'block', scope: 'official',
  }));
  const blockers = checks.filter((check) => check.severity === 'block');
  const warnings = checks.filter((check) => check.severity === 'warning');
  return {
    id: null as string | null,
    version: null as number | null,
    preparedAt: null as string | null,
    preparedBy: null as string | null,
    company: {
      id: companyId, name: company.name ?? null, brn: company.brn ?? null,
      contactEmail: company.contact_email ?? null, contactPhone: company.contact_phone ?? null,
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
      available: false,
      status: 'NOT_AVAILABLE',
      reasons: officialReasons,
      specificationUrl: 'https://www.mra.mu/download/SpecsMonthlyPACODec2024.pdf',
      templateUrl: 'https://www.mra.mu/download/csvTemplate_paco_Dec2024.csv',
    },
    internalCsvAvailable: blockers.length === 0 && Boolean(employer),
    canPrepare: blockers.length === 0 && Boolean(employer),
    regulatoryExportBlocked: true,
    regulatoryStatus: 'NOT_SUBMITTED',
    status: 'PREPARATION_ONLY',
    preparationStatus: blockers.length > 0 ? 'BLOCKED' : 'PREPARATION_ONLY',
    employeesActive: Number(activeRes.rows[0]?.count ?? 0),
    submission: 'NOT_SUBMITTED',
    notice: 'Préparation locale et fictive. Aucune transmission MRA, aucun identifiant réel, aucun paiement.',
    noticeEn: 'Local, fictional preparation. No MRA transmission, no real credential, no payment.',
    // Legacy fields retained for the mission 15 summary and CSV.
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

export async function payrollReturnSummary(
  db: Db, actor: PayrollActor, periodId: string, employerIdentifier?: string | null,
) {
  return buildMonthlyDeclaration(db, actor.companyId, periodId, employerIdentifier);
}

export async function prepareMraDeclaration(
  db: Db, actor: PayrollActor, periodId: string,
  input: { employerIdentifier: string; note?: string | null },
) {
  requireWriter(actor);
  const employerIdentifier = input.employerIdentifier?.trim();
  if (!employerIdentifier) {
    throw badRequest('PAYROLL_DECLARATION_EMPLOYER_ID_REQUIRED', 'A fictitious employer identifier is required');
  }
  if (employerIdentifier.length > 40) {
    throw badRequest('PAYROLL_DECLARATION_EMPLOYER_ID_INVALID', 'The employer identifier is too long');
  }
  return db.transaction(async (tx) => {
    // Serialise preparations for one period so two versions cannot share a number.
    const locked = await tx.query<any>(
      'SELECT * FROM payroll_periods WHERE company_id = $1 AND id = $2 FOR UPDATE',
      [actor.companyId, periodId],
    );
    if (!locked.rows[0]) throw notFound('PAYROLL_PERIOD_NOT_FOUND', 'Payroll period not found');
    const declaration = await buildMonthlyDeclaration(tx, actor.companyId, periodId, employerIdentifier);
    if (declaration.blockers.length > 0) {
      throw conflict(
        'PAYROLL_DECLARATION_BLOCKED',
        'The declaration preparation is blocked by payroll controls',
        { blockers: declaration.blockers },
      );
    }
    const seq = await tx.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM payroll_events
        WHERE company_id = $1 AND action = 'payroll.mra.prepare'
          AND details->'declaration'->'period'->>'id' = $2`,
      [actor.companyId, periodId],
    );
    const version = Number(seq.rows[0]?.count ?? 0) + 1;
    const stored = { ...declaration, version };
    const event = await tx.query<{ id: string; created_at: string }>(
      `INSERT INTO payroll_events (cabinet_id, company_id, entity_type, entity_id, action, details, actor_id)
       VALUES ($1,$2,'payroll_mra_declaration',NULL,'payroll.mra.prepare',$3::jsonb,$4)
       RETURNING id, created_at`,
      [actor.cabinetId, actor.companyId, JSON.stringify({ declaration: stored }), actor.userId],
    );
    const id = event.rows[0]!.id;
    await writeAudit(tx, {
      companyId: actor.companyId, userId: actor.userId, action: 'payroll.mra.prepare',
      entityType: 'payroll_mra_declaration', entityId: id,
      details: {
        periodId, version, employeeCount: declaration.employees.length,
        totals: declaration.totals, status: declaration.status,
        note: input.note?.trim() || null,
      },
      ip: actor.ip ?? null,
    });
    return {
      ...stored, id, version, preparedAt: event.rows[0]!.created_at,
      preparedBy: null as string | null,
    };
  });
}

export async function listMraDeclarations(db: Db, companyId: string, periodId?: string) {
  const params: unknown[] = [companyId];
  let filter = '';
  if (periodId) { params.push(periodId); filter = `AND e.details->'declaration'->'period'->>'id' = $2`; }
  const res = await db.query<any>(
    `SELECT e.id, e.created_at, e.details->'declaration' AS declaration, u.full_name AS prepared_by_name
       FROM payroll_events e
       LEFT JOIN app_users u ON u.id = e.actor_id
      WHERE e.company_id = $1 AND e.action = 'payroll.mra.prepare' ${filter}
      ORDER BY e.created_at DESC`,
    params,
  );
  return res.rows.map((row) => ({
    ...(row.declaration ?? {}), id: row.id, preparedAt: row.created_at,
    preparedBy: row.prepared_by_name ?? null,
  }));
}

export async function getMraDeclaration(db: Db, companyId: string, id: string) {
  const res = await db.query<any>(
    `SELECT e.id, e.created_at, e.details->'declaration' AS declaration, u.full_name AS prepared_by_name
       FROM payroll_events e
       LEFT JOIN app_users u ON u.id = e.actor_id
      WHERE e.company_id = $1 AND e.action = 'payroll.mra.prepare' AND e.id = $2`,
    [companyId, id],
  );
  if (!res.rows[0]) throw notFound('PAYROLL_DECLARATION_NOT_FOUND', 'Declaration preparation not found');
  return {
    ...(res.rows[0].declaration ?? {}), id: res.rows[0].id,
    preparedAt: res.rows[0].created_at, preparedBy: res.rows[0].prepared_by_name ?? null,
  };
}

const csvCell = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
const csvLine = (cells: unknown[]) => cells.map(csvCell).join(',');

export function mraDeclarationCsv(declaration: any): string {
  const rows: string[] = [];
  rows.push(csvLine(['PAYROLL DECLARATION - INTERNAL PREPARATION - NOT SUBMITTED TO MRA']));
  rows.push(csvLine(['SIMULATION - NOT VALIDATED FOR PAYMENT']));
  rows.push(csvLine(['Declaration ID', declaration.id]));
  rows.push(csvLine(['Prepared at', declaration.preparedAt ?? '']));
  rows.push(csvLine(['Prepared by', declaration.preparedBy ?? '']));
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
  rows.push(csvLine([
    'Employee number', 'Employee', 'Pay frequency', 'Currency', 'Basic wage',
    'Gross emoluments', 'Taxable emoluments', 'PAYE', 'CSG employee', 'CSG employer',
    'NSF employee', 'NSF employer', 'Training Levy', 'Calculation status',
  ]));
  for (const employee of declaration.employees ?? []) {
    rows.push(csvLine([
      employee.employeeNumber, employee.fullName, employee.payFrequency, employee.currency,
      employee.basicWage, employee.gross, employee.taxableEmoluments, employee.paye,
      employee.csgEmployee, employee.csgEmployer, employee.nsfEmployee, employee.nsfEmployer,
      employee.trainingLevy, employee.status,
    ]));
  }
  rows.push('');
  rows.push(csvLine(['CHECKS']));
  rows.push(csvLine(['Code', 'Severity', 'Scope', 'Message EN', 'Message FR']));
  for (const check of declaration.checks ?? []) {
    rows.push(csvLine([check.code, check.severity, check.scope, check.messageEn, check.messageFr]));
  }
  rows.push('');
  rows.push(csvLine(['OFFICIAL MRA CSV', 'NOT GENERATED', 'This file must not be submitted to the MRA']));
  for (const reason of declaration.officialCsv?.reasons ?? []) {
    rows.push(csvLine([reason.code, reason.messageEn, reason.messageFr]));
  }
  return '\uFEFF' + rows.join('\r\n');
}
export function payrollReturnCsv(summary: any): string {
  const rows: string[][] = [
    ['PREPARATION ONLY - NOT SUBMITTED TO MRA'],
    ['Period', `${summary.period.year}-${String(summary.period.month).padStart(2, '0')}`],
    ['Field', 'Amount (MUR)'],
    ['Gross emoluments', summary.gross],
    ['PAYE withheld', summary.paye],
    ['CSG employee', summary.csg_employee],
    ['CSG employer', summary.csg_employer],
    ['NSF employee', summary.nsf_employee],
    ['NSF employer', summary.nsf_employer],
    ['Training levy', summary.training_levy],
    ['Employees', String(summary.employeesCount ?? summary.employees?.length ?? 0)],
    ['Calculations with incomplete rules', String(summary.incomplete)],
    ['Status', summary.status],
  ];
  return rows.map((r) => r.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
}
