import { createHash } from 'node:crypto';
import type { Db } from '../../db/index.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { formatAmount, parseAmount } from '../../lib/money.js';
import { writeAudit } from '../../lib/audit.js';

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
const REQUIRED_RULE_CODES = ['PAYE', 'CSG', 'NSF'] as const;
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
  const bank = input.bankAccountNumber?.replace(/\s/g, '');
  const statutory = input.statutoryId?.replace(/\s/g, '');
  const fields: string[] = [];
  const values: unknown[] = [];
  const put = (sql: string, value: unknown) => {
    values.push(value);
    fields.push(`${sql} = $${values.length}`);
  };
  if (input.employeeNumber) put('employee_number', input.employeeNumber.trim());
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
  if (input.employmentStatus) put('employment_status', input.employmentStatus);
  if (input.hireDate !== undefined) put('hire_date', input.hireDate || null);
  if (input.terminationDate !== undefined) put('termination_date', input.terminationDate || null);
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
        [old.id, addDays(input.effectiveFrom, -1)],
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
// Dated regulatory rules
// ---------------------------------------------------------------------------

export async function ensureRulePlaceholders(db: Db, actor: PayrollActor) {
  for (const code of REQUIRED_RULE_CODES) {
    const exists = await db.query(
      'SELECT 1 FROM payroll_rules WHERE company_id = $1 AND upper(rule_code) = $2 LIMIT 1',
      [actor.companyId, code],
    );
    if (exists.rowCount) continue;
    await db.query(
      `INSERT INTO payroll_rules
        (cabinet_id, company_id, rule_code, name_en, name_fr, status, required_for_calculation,
         version, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,'UNVERIFIED',true,1,$6,$7)`,
      [
        actor.cabinetId, actor.companyId, code,
        code === 'PAYE' ? 'PAYE (placeholder - no rate)' : code === 'CSG' ? 'CSG (placeholder - no rate)' : 'NSF (placeholder - no rate)',
        code === 'PAYE' ? 'PAYE (paramètre - aucun taux)' : code === 'CSG' ? 'CSG (paramètre - aucun taux)' : 'NSF (paramètre - aucun taux)',
        'Placeholder created by the application. It carries no rate, no threshold and no legal source until an expert validates it.',
        actor.userId,
      ],
    );
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
  const existing = await db.query<{ version: number }>(
    'SELECT version FROM payroll_rules WHERE company_id = $1 AND upper(rule_code) = upper($2) ORDER BY version DESC LIMIT 1',
    [actor.companyId, input.ruleCode.trim()],
  );
  const version = (existing.rows[0]?.version ?? 0) + 1;
  const res = await db.query<any>(
    `INSERT INTO payroll_rules
      (cabinet_id, company_id, rule_code, name_en, name_fr, legal_source, source_reference, source_url,
       effective_from, effective_to, employee_category, employer_category, calculation_basis, rate,
       threshold_amount, cap_amount, exemption_amount, rounding_policy, status,
       required_for_calculation, version, test_cases, notes, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,'UNVERIFIED',$19,$20,$21::jsonb,$22,$23)
     RETURNING *`,
    [
      actor.cabinetId, actor.companyId, input.ruleCode.trim().toUpperCase(), input.nameEn.trim(),
      input.nameFr.trim(), input.legalSource?.trim() || null, input.sourceReference?.trim() || null,
      input.sourceUrl?.trim() || null, input.effectiveFrom || null, input.effectiveTo || null,
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
  await audit(db, actor, 'payroll.rule.create', 'payroll_rule', res.rows[0]!.id, {
    ruleCode: input.ruleCode, version, status: 'UNVERIFIED',
  });
  return res.rows[0];
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
    if (row.required_for_calculation && row.rate === null) {
      throw badRequest('PAYROLL_RULE_NOT_VALIDATED', 'A required rule cannot be validated without an explicit documented rate');
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
            rate, effective_from, validated_at
       FROM payroll_rules
      WHERE company_id = $1 AND required_for_calculation = true
        AND (effective_from IS NULL OR effective_from <= $2::date)
        AND (effective_to IS NULL OR effective_to >= $2::date)
        AND status <> 'DEPRECATED'
      ORDER BY upper(rule_code), version DESC, effective_from DESC NULLS LAST`,
    [companyId, onDate],
  );
  const byCode = new Map(res.rows.map((r) => [r.rule_code, r]));
  return REQUIRED_RULE_CODES.map((code) => {
    const row = byCode.get(code);
    return {
      ruleCode: code,
      found: Boolean(row),
      validated: row?.status === 'EXPERT_VALIDATED',
      status: row?.status ?? 'MISSING',
      rate: row?.rate ?? null,
      effectiveFrom: row?.effective_from ?? null,
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
    const missingRules = rules.filter((r) => !r.validated).map((r) => ({
      ruleCode: r.ruleCode, status: r.status, reason: r.found ? 'NOT_EXPERT_VALIDATED' : 'MISSING',
    }));
    const statutoryEngineMissing = true;
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

      const gross = base + earnings;
      const netArithmetic = gross + reimbursements - deductions;
      const missing = [
        ...missingRules,
        ...(statutoryEngineMissing
          ? [{ ruleCode: 'STATUTORY_ENGINE', status: 'NOT_IMPLEMENTED', reason: 'PAYROLL_STATUTORY_ENGINE_NOT_IMPLEMENTED' }]
          : []),
      ];
      const status = missing.length ? 'blocked' : 'simulated';
      const inputHash = hash(JSON.stringify({
        periodId, employeeId: employee.id, version, contracts: contracts.rows.map((c) => ({
          id: c.id, from: c.effective_from, to: c.effective_to, salary: c.base_salary,
          period: c.salary_period, currency: c.currency,
        })),
        variables: variables.rows.map((v) => ({ id: v.id, amount: v.amount, status: v.status })),
        allowances: allowances.rows.map((a) => ({ id: a.id, amount: a.amount })),
        absences: absences.rows, rules: rules.map((r) => ({ code: r.ruleCode, status: r.status, rate: r.rate })),
      }));
      const calculationRes = await tx.query<any>(
        `INSERT INTO payroll_calculations
          (cabinet_id, company_id, period_id, employee_id, version, status, currency, contract_id,
           base_amount, proration_days, period_days, earnings, gross, deductions, net_arithmetic,
           paye, csg, nsf, employer_contributions, statutory_complete, missing_rules, warnings,
           input_hash, rule_version, calculated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,NULL,NULL,NULL,NULL,false,
                 $16::jsonb,$17::jsonb,$18,$19,$20) RETURNING *`,
        [
          actor.cabinetId, actor.companyId, periodId, employee.id, version, status, currency,
          firstContract?.id ?? null, fmt(base),
          activeDates.length === Number(dayCount) ? null : `${activeDates.length}.0000`, Number(dayCount),
          fmt(earnings), fmt(gross), fmt(deductions), fmt(netArithmetic),
          JSON.stringify(missing), JSON.stringify(warnings), inputHash,
          `rules:${rules.map((r) => `${r.ruleCode}=${r.status}`).join(',')};engine=not_implemented`,
          actor.userId,
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

    const newStatus = calculations.some((c) => c.status === 'blocked') ? 'blocked' : 'calculated';
    await tx.query(
      `UPDATE payroll_periods SET status = $2, calculated_at = now(), version = $3, updated_at = now()
        WHERE id = $1`,
      [periodId, newStatus, version],
    );
    await audit(tx, actor, 'payroll.period.calculate', 'payroll_period', periodId, {
      version, employees: calculations.length, blocked: calculations.filter((c) => c.status === 'blocked').length,
      missingRules: missingRules.map((r) => r.ruleCode),
    });
    return {
      period: (await tx.query<any>('SELECT * FROM payroll_periods WHERE id = $1', [periodId])).rows[0],
      version,
      calculations,
      blocked: calculations.some((c) => c.status === 'blocked'),
      statutoryComplete: false,
      missingRules,
      missingEngine: 'PAYROLL_STATUTORY_ENGINE_NOT_IMPLEMENTED',
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
    `SELECT c.*, e.employee_number, e.full_name, e.bank_name, e.bank_account_last4, p.period_year, p.period_month
       FROM payroll_calculations c
       JOIN payroll_employees e ON e.id = c.employee_id
       JOIN payroll_periods p ON p.id = c.period_id
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
    const company = await tx.query<any>('SELECT name, brn FROM companies WHERE id = $1', [actor.companyId]);
    const sequence = await tx.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM payroll_payslips WHERE company_id = $1',
      [actor.companyId],
    );
    const payslipNo = `SIM-${calculation.period_year}${String(calculation.period_month).padStart(2, '0')}-${String(Number(sequence.rows[0]!.count) + 1).padStart(4, '0')}`;
    const snapshot = {
      disclaimer: 'SIMULATION / DRAFT — NOT FOR PAYMENT. Ce bulletin n’est pas un bulletin officiel et ne peut pas être utilisé pour payer.',
      company: { name: company.rows[0]?.name, brn: company.rows[0]?.brn },
      employee: {
        number: calculation.employee_number, name: calculation.full_name,
        bankAccountMasked: calculation.bankAccountMasked,
      },
      period: { year: calculation.period_year, month: calculation.period_month },
      currency: calculation.currency,
      lines: calculation.lines,
      totals: {
        base: calculation.base_amount, gross: calculation.gross,
        deductions: calculation.deductions, netArithmetic: calculation.net_arithmetic,
        paye: null, csg: null, nsf: null, netPayable: null,
      },
      status: 'blocked',
      missingRules: calculation.missing_rules,
      warnings: calculation.warnings,
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
    statutoryComplete: false,
    capabilities: {
      employees: true, contracts: true, time: true, leave: true, variables: true,
      arithmeticCalculation: true, statutoryCalculation: false, finalPayslips: false,
      statutoryDeclarations: false, accountingTransfer: false,
      paye: false, csg: false, nsf: false, employerContributions: false,
    },
    notice:
      'Les totaux arithmétiques sont calculés. PAYE, CSG, NSF et cotisations employeur restent bloqués : aucune règle mauricienne n’est validée et le moteur réglementaire n’est pas implémenté.',
  };
}
