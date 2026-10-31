import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../../db/index.js';
import { parse } from '../../lib/http.js';
import { requireModuleAccess } from '../../lib/permissions.js';
import { cabinetForCompanyUser } from '../../lib/cabinets.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { payrollPdf } from './pdf.js';
import { MigrationParseError, parseUpload } from '../migration/parse.js';
import {
  calculatePeriod,
  changePeriodStatus,
  checkEmployeeDuplicates,
  createAbsence,
  createContract,
  createEmployee,
  createLeaveRule,
  createPayItem,
  createPeriod,
  createRule,
  createTimeEntry,
  createVariable,
  decideAbsence,
  finalisePayslip,
  generatePayslip,
  getCalculation,
  getEmployee,
  getPayslip,
  importVariables,
  leaveBalances,
  listAbsences,
  listCalculations,
  listContracts,
  listEmployees,
  listLeaveRules,
  listPayItems,
  listPayslips,
  listPeriods,
  listRules,
  listTimeEntries,
  listVariables,
  payrollDashboard,
  requiredRulesStatus,
  updateEmployee,
  validateRule,
  validateVariable,
  assignPayItem,
  terminateContract,
  type PayrollActor,
} from './service.js';

const DateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const AmountSchema = z.union([z.string().max(30), z.number()]);
const EmployeeSchema = z.object({
  employeeNumber: z.string().trim().min(1).max(50),
  firstName: z.string().trim().min(1).max(120),
  lastName: z.string().trim().min(1).max(120),
  preferredName: z.string().trim().max(120).nullish(),
  dateOfBirth: DateSchema.nullish(),
  nationality: z.string().trim().max(80).nullish(),
  countryOfResidence: z.string().trim().max(80).nullish(),
  address: z.string().trim().max(500).nullish(),
  email: z.string().trim().email().max(200).nullish(),
  phone: z.string().trim().max(50).nullish(),
  employmentStatus: z.enum(['active', 'probation', 'suspended', 'terminated']).optional(),
  hireDate: DateSchema.nullish(),
  terminationDate: DateSchema.nullish(),
  department: z.string().trim().max(120).nullish(),
  jobTitle: z.string().trim().max(120).nullish(),
  workLocation: z.string().trim().max(120).nullish(),
  managerEmployeeId: z.string().uuid().nullish(),
  costCentre: z.string().trim().max(80).nullish(),
  payrollCurrency: z.string().length(3).optional(),
  paymentMethod: z.enum(['bank_transfer', 'cheque', 'cash']).nullish(),
  bankName: z.string().trim().max(120).nullish(),
  bankAccountNumber: z.string().trim().max(60).nullish(),
  statutoryId: z.string().trim().max(60).nullish(),
  statutoryRef: z.string().trim().max(60).nullish(),
  emergencyContactName: z.string().trim().max(120).nullish(),
  emergencyContactPhone: z.string().trim().max(50).nullish(),
  emergencyContactRelation: z.string().trim().max(80).nullish(),
  notes: z.string().trim().max(2000).nullish(),
  allowDuplicate: z.boolean().optional(),
}).strict();

const ContractSchema = z.object({
  employeeId: z.string().uuid(),
  contractType: z.enum(['permanent', 'fixed_term']),
  workPattern: z.enum(['full_time', 'part_time']),
  effectiveFrom: DateSchema,
  effectiveTo: DateSchema.nullish(),
  baseSalary: AmountSchema,
  salaryPeriod: z.enum(['monthly', 'hourly', 'daily']),
  currency: z.string().length(3).optional(),
  weeklyHours: z.union([z.string(), z.number()]).nullish(),
  department: z.string().trim().max(120).nullish(),
  jobTitle: z.string().trim().max(120).nullish(),
  workLocation: z.string().trim().max(120).nullish(),
  probationEnd: DateSchema.nullish(),
  changeReason: z.string().trim().min(1).max(1000),
  amendmentOf: z.string().uuid().nullish(),
}).strict();

const PayItemSchema = z.object({
  code: z.string().trim().min(1).max(30),
  labelEn: z.string().trim().min(1).max(120),
  labelFr: z.string().trim().min(1).max(120),
  category: z.enum(['earning', 'deduction', 'reimbursement', 'advance', 'loan']),
  unit: z.enum(['money', 'hour', 'day', 'quantity']),
  calculationMethod: z.enum(['fixed', 'quantity_times_rate']),
  effectiveFrom: DateSchema,
  effectiveTo: DateSchema.nullish(),
  accountId: z.string().uuid().nullish(),
  source: z.string().trim().max(300).nullish(),
  parameters: z.record(z.unknown()).optional(),
}).strict();

const VariableSchema = z.object({
  periodId: z.string().uuid(),
  employeeId: z.string().uuid(),
  payItemId: z.string().uuid(),
  quantity: AmountSchema.optional(),
  rate: AmountSchema.optional(),
  amount: AmountSchema.optional(),
  note: z.string().trim().max(1000).nullish(),
  status: z.enum(['draft', 'validated']).optional(),
}).strict();

const RuleSchema = z.object({
  ruleCode: z.string().trim().min(1).max(40),
  nameEn: z.string().trim().min(1).max(200),
  nameFr: z.string().trim().min(1).max(200),
  legalSource: z.string().trim().max(500).nullish(),
  sourceReference: z.string().trim().max(500).nullish(),
  sourceUrl: z.string().trim().url().max(500).nullish(),
  effectiveFrom: DateSchema.nullish(),
  effectiveTo: DateSchema.nullish(),
  employeeCategory: z.string().trim().max(120).nullish(),
  employerCategory: z.string().trim().max(120).nullish(),
  calculationBasis: z.string().trim().max(500).nullish(),
  rate: AmountSchema.nullish(),
  thresholdAmount: AmountSchema.nullish(),
  capAmount: AmountSchema.nullish(),
  exemptionAmount: AmountSchema.nullish(),
  roundingPolicy: z.string().trim().max(120).nullish(),
  requiredForCalculation: z.boolean().optional(),
  testCases: z.array(z.unknown()).max(50).optional(),
  notes: z.string().trim().max(2000).nullish(),
}).strict();

const writer = ['owner', 'admin', 'cabinet_admin', 'payroll_manager'];

export function payrollRoutes(app: FastifyInstance, db: Db) {

  async function actor(req: any, companyId: string, min: 'read' | 'write' = 'read'): Promise<PayrollActor> {
    const ctx = await requireModuleAccess(db, req.user!.id, companyId, 'payroll', min);
    const { cabinetId } = await cabinetForCompanyUser(db, companyId, req.user!.id);
    if (min === 'write' && !writer.includes(ctx.role)) {
      throw badRequest('MODULE_FORBIDDEN', 'A payroll manager role is required');
    }
    return { companyId, cabinetId, userId: req.user!.id, role: ctx.role, ip: req.ip };
  }

  // ---------------------------------------------------------------- dashboard
  app.get('/companies/:companyId/payroll/dashboard', async (req) => {
    const { companyId } = req.params as { companyId: string };
    return payrollDashboard(db, await actor(req, companyId));
  });

  app.get('/companies/:companyId/payroll/summary', async (req) => {
    const { companyId } = req.params as { companyId: string };
    return payrollDashboard(db, await actor(req, companyId));
  });

  // ---------------------------------------------------------------- employees
  app.get('/companies/:companyId/payroll/employees', async (req) => {
    const { companyId } = req.params as { companyId: string };
    await actor(req, companyId);
    const q = req.query as Record<string, string | undefined>;
    return { employees: await listEmployees(db, companyId, { search: q.search, status: q.status, department: q.department }) };
  });

  app.post('/companies/:companyId/payroll/employees/duplicates', async (req) => {
    const { companyId } = req.params as { companyId: string };
    await actor(req, companyId, 'write');
    const input = parse(EmployeeSchema, req.body);
    return { duplicates: await checkEmployeeDuplicates(db, companyId, input) };
  });

  app.get('/companies/:companyId/payroll/employees/:employeeId', async (req) => {
    const { companyId, employeeId } = req.params as { companyId: string; employeeId: string };
    await actor(req, companyId);
    return { employee: await getEmployee(db, companyId, employeeId) };
  });

  app.post('/companies/:companyId/payroll/employees', async (req, reply) => {
    const { companyId } = req.params as { companyId: string };
    const input = parse(EmployeeSchema, req.body);
    const employee = await createEmployee(db, await actor(req, companyId, 'write'), input);
    return reply.code(201).send({ employee });
  });

  app.patch('/companies/:companyId/payroll/employees/:employeeId', async (req) => {
    const { companyId, employeeId } = req.params as { companyId: string; employeeId: string };
    const input = parse(EmployeeSchema.partial().strict(), req.body);
    return { employee: await updateEmployee(db, await actor(req, companyId, 'write'), employeeId, input) };
  });

  // ---------------------------------------------------------------- contracts
  app.get('/companies/:companyId/payroll/contracts', async (req) => {
    const { companyId } = req.params as { companyId: string };
    await actor(req, companyId);
    const q = req.query as Record<string, string | undefined>;
    return { contracts: await listContracts(db, companyId, q.employeeId) };
  });

  app.post('/companies/:companyId/payroll/contracts', async (req, reply) => {
    const { companyId } = req.params as { companyId: string };
    const input = parse(ContractSchema, req.body);
    const contract = await createContract(db, await actor(req, companyId, 'write'), input);
    return reply.code(201).send({ contract });
  });

  app.post('/companies/:companyId/payroll/contracts/:contractId/terminate', async (req) => {
    const { companyId, contractId } = req.params as { companyId: string; contractId: string };
    const input = parse(z.object({ effectiveTo: DateSchema, reason: z.string().trim().min(1).max(1000) }).strict(), req.body);
    return { contract: await terminateContract(db, await actor(req, companyId, 'write'), contractId, input) };
  });

  // ---------------------------------------------------------------- pay items
  app.get('/companies/:companyId/payroll/pay-items', async (req) => {
    const { companyId } = req.params as { companyId: string };
    await actor(req, companyId);
    return { payItems: await listPayItems(db, companyId) };
  });

  app.post('/companies/:companyId/payroll/pay-items', async (req, reply) => {
    const { companyId } = req.params as { companyId: string };
    const input = parse(PayItemSchema, req.body);
    const item = await createPayItem(db, await actor(req, companyId, 'write'), input);
    return reply.code(201).send({ payItem: item });
  });

  app.post('/companies/:companyId/payroll/employees/:employeeId/pay-items', async (req, reply) => {
    const { companyId, employeeId } = req.params as { companyId: string; employeeId: string };
    const input = parse(z.object({
      payItemId: z.string().uuid(),
      amount: AmountSchema,
      effectiveFrom: DateSchema,
      effectiveTo: DateSchema.nullish(),
    }).strict(), req.body);
    const assignment = await assignPayItem(db, await actor(req, companyId, 'write'), employeeId, input);
    return reply.code(201).send({ assignment });
  });

  // --------------------------------------------------------------- time & leave
  app.get('/companies/:companyId/payroll/time', async (req) => {
    const { companyId } = req.params as { companyId: string };
    await actor(req, companyId);
    const q = req.query as Record<string, string | undefined>;
    return { entries: await listTimeEntries(db, companyId, { employeeId: q.employeeId, from: q.from, to: q.to }) };
  });

  app.post('/companies/:companyId/payroll/time', async (req, reply) => {
    const { companyId } = req.params as { companyId: string };
    const input = parse(z.object({
      employeeId: z.string().uuid(),
      workDate: DateSchema,
      hoursWorked: AmountSchema,
      overtimeHours: AmountSchema.optional(),
      latenessMinutes: z.number().int().min(0).max(1440).optional(),
      note: z.string().trim().max(1000).nullish(),
      source: z.enum(['manual', 'import', 'timesheet']).optional(),
    }).strict(), req.body);
    const entry = await createTimeEntry(db, await actor(req, companyId, 'write'), input);
    return reply.code(201).send({ entry });
  });

  app.get('/companies/:companyId/payroll/leave', async (req) => {
    const { companyId } = req.params as { companyId: string };
    await actor(req, companyId);
    const q = req.query as Record<string, string | undefined>;
    return {
      absences: await listAbsences(db, companyId, {
        employeeId: q.employeeId, status: q.status, year: q.year ? Number(q.year) : undefined,
      }),
      rules: await listLeaveRules(db, companyId),
    };
  });

  app.post('/companies/:companyId/payroll/leave', async (req, reply) => {
    const { companyId } = req.params as { companyId: string };
    const input = parse(z.object({
      employeeId: z.string().uuid(),
      leaveType: z.enum(['annual', 'sick', 'unpaid', 'maternity', 'paternity', 'other']),
      startDate: DateSchema,
      endDate: DateSchema,
      days: AmountSchema,
      reason: z.string().trim().min(1).max(1000),
      documentRef: z.string().trim().max(300).nullish(),
    }).strict(), req.body);
    const absence = await createAbsence(db, await actor(req, companyId, 'write'), input);
    return reply.code(201).send({ absence });
  });

  app.post('/companies/:companyId/payroll/leave/:absenceId/decision', async (req) => {
    const { companyId, absenceId } = req.params as { companyId: string; absenceId: string };
    const input = parse(z.object({
      decision: z.enum(['approved', 'rejected', 'cancelled']),
      reason: z.string().trim().max(1000).nullish(),
    }).strict(), req.body);
    return { absence: await decideAbsence(db, await actor(req, companyId, 'write'), absenceId, input) };
  });

  app.get('/companies/:companyId/payroll/employees/:employeeId/leave-balances', async (req) => {
    const { companyId, employeeId } = req.params as { companyId: string; employeeId: string };
    await actor(req, companyId);
    const q = req.query as Record<string, string | undefined>;
    return leaveBalances(db, companyId, employeeId, q.year ? Number(q.year) : new Date().getUTCFullYear());
  });

  app.get('/companies/:companyId/payroll/leave-rules', async (req) => {
    const { companyId } = req.params as { companyId: string };
    await actor(req, companyId);
    return { rules: await listLeaveRules(db, companyId) };
  });

  app.post('/companies/:companyId/payroll/leave-rules', async (req, reply) => {
    const { companyId } = req.params as { companyId: string };
    const input = parse(z.object({
      leaveType: z.enum(['annual', 'sick', 'unpaid', 'maternity', 'paternity', 'other']),
      daysPerYear: AmountSchema,
      accrualMethod: z.enum(['configured_annual', 'configured_monthly']).optional(),
      effectiveFrom: DateSchema,
      effectiveTo: DateSchema.nullish(),
      source: z.string().trim().max(500).nullish(),
    }).strict(), req.body);
    const rule = await createLeaveRule(db, await actor(req, companyId, 'write'), input);
    return reply.code(201).send({ rule });
  });

  // -------------------------------------------------------------------- rules
  app.get('/companies/:companyId/payroll/rules', async (req) => {
    const { companyId } = req.params as { companyId: string };
    const a = await actor(req, companyId);
    await payrollDashboard(db, a); // creates the unverified placeholders
    const q = req.query as Record<string, string | undefined>;
    return {
      rules: await listRules(db, companyId),
      required: await requiredRulesStatus(db, companyId, q.date ?? new Date().toISOString().slice(0, 10)),
      statutoryEngineImplemented: false,
    };
  });

  app.post('/companies/:companyId/payroll/rules', async (req, reply) => {
    const { companyId } = req.params as { companyId: string };
    const input = parse(RuleSchema, req.body);
    const rule = await createRule(db, await actor(req, companyId, 'write'), input);
    return reply.code(201).send({ rule });
  });

  app.post('/companies/:companyId/payroll/rules/:ruleId/validate', async (req) => {
    const { companyId, ruleId } = req.params as { companyId: string; ruleId: string };
    const input = parse(z.object({
      confirm: z.literal(true),
      note: z.string().trim().max(2000).nullish(),
      legalSource: z.string().trim().max(500).nullish(),
      sourceReference: z.string().trim().max(500).nullish(),
    }).strict(), req.body);
    return { rule: await validateRule(db, await actor(req, companyId, 'write'), ruleId, input) };
  });

  // ------------------------------------------------------------------ periods
  app.get('/companies/:companyId/payroll/periods', async (req) => {
    const { companyId } = req.params as { companyId: string };
    await actor(req, companyId);
    return { periods: await listPeriods(db, companyId) };
  });

  app.post('/companies/:companyId/payroll/periods', async (req, reply) => {
    const { companyId } = req.params as { companyId: string };
    const input = parse(z.object({
      year: z.number().int().min(2000).max(2100),
      month: z.number().int().min(1).max(12),
      paymentDate: DateSchema.nullish(),
    }).strict(), req.body);
    const period = await createPeriod(db, await actor(req, companyId, 'write'), input);
    return reply.code(201).send({ period });
  });

  app.patch('/companies/:companyId/payroll/periods/:periodId/status', async (req) => {
    const { companyId, periodId } = req.params as { companyId: string; periodId: string };
    const input = parse(z.object({
      status: z.enum(['draft', 'data_collection', 'ready_for_review', 'blocked', 'calculated', 'approved', 'finalised']),
      reason: z.string().trim().max(1000).nullish(),
      confirm: z.boolean().optional(),
    }).strict(), req.body);
    return { period: await changePeriodStatus(db, await actor(req, companyId, 'write'), periodId, input) };
  });

  app.post('/companies/:companyId/payroll/periods/:periodId/calculate', async (req) => {
    const { companyId, periodId } = req.params as { companyId: string; periodId: string };
    const input = parse(z.object({ force: z.boolean().optional() }).strict(), req.body ?? {});
    return calculatePeriod(db, await actor(req, companyId, 'write'), periodId, input);
  });

  app.get('/companies/:companyId/payroll/periods/:periodId/calculations', async (req) => {
    const { companyId, periodId } = req.params as { companyId: string; periodId: string };
    await actor(req, companyId);
    return { calculations: await listCalculations(db, companyId, periodId) };
  });

  // ---------------------------------------------------------------- variables
  app.get('/companies/:companyId/payroll/variables', async (req) => {
    const { companyId } = req.params as { companyId: string };
    await actor(req, companyId);
    const q = req.query as Record<string, string | undefined>;
    return { variables: await listVariables(db, companyId, { periodId: q.periodId, employeeId: q.employeeId, status: q.status }) };
  });

  app.post('/companies/:companyId/payroll/variables', async (req, reply) => {
    const { companyId } = req.params as { companyId: string };
    const input = parse(VariableSchema, req.body);
    const variable = await createVariable(db, await actor(req, companyId, 'write'), input);
    return reply.code(201).send({ variable });
  });

  app.post('/companies/:companyId/payroll/variables/:variableId/validate', async (req) => {
    const { companyId, variableId } = req.params as { companyId: string; variableId: string };
    return { variable: await validateVariable(db, await actor(req, companyId, 'write'), variableId) };
  });

  app.post('/companies/:companyId/payroll/periods/:periodId/variables/import-file', async (req) => {
    const { companyId, periodId } = req.params as { companyId: string; periodId: string };
    const a = await actor(req, companyId, 'write');
    const input = parse(z.object({
      fileName: z.string().trim().min(1).max(200),
      contentBase64: z.string().max(12_000_000).optional(),
      contentText: z.string().max(12_000_000).optional(),
      sheetName: z.string().max(120).nullish(),
    }).strict(), req.body);
    if (!input.contentBase64 && !input.contentText) {
      throw badRequest('PAYROLL_IMPORT_INVALID', 'A file content is required');
    }
    try {
      const bytes = input.contentBase64
        ? new Uint8Array(Buffer.from(input.contentBase64, 'base64'))
        : new Uint8Array(Buffer.from(input.contentText!, 'utf8'));
      const parsed = parseUpload(input.fileName, bytes);
      const sheet = (input.sheetName && parsed.sheets.find((sh) => sh.name === input.sheetName)) || parsed.sheets[0];
      if (!sheet) throw badRequest('PAYROLL_IMPORT_INVALID', 'No readable sheet');
      const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');
      const aliases: Record<string, string> = {
        employeenumber: 'employeeNumber', employeeno: 'employeeNumber', matricule: 'employeeNumber',
        employeenumberref: 'employeeNumber', payitemcode: 'payItemCode', payitem: 'payItemCode',
        rubrique: 'payItemCode', code: 'payItemCode', quantity: 'quantity', quantite: 'quantity',
        rate: 'rate', taux: 'rate', amount: 'amount', montant: 'amount',
        externalref: 'externalRef', reference: 'externalRef', note: 'note',
      };
      const headerMap = sheet.headers.map((h) => aliases[normalize(h)] ?? null);
      if (!headerMap.includes('employeeNumber') || !headerMap.includes('payItemCode')) {
        throw badRequest('PAYROLL_IMPORT_INVALID',
          'The file must contain employeeNumber and payItemCode columns');
      }
      if (sheet.rows.length === 0) throw badRequest('PAYROLL_IMPORT_INVALID', 'No row to import');
      if (sheet.rows.length > 1000) throw badRequest('PAYROLL_IMPORT_INVALID', 'At most 1000 rows per import');
      const rows = sheet.rows.map((values) => {
        const row: Record<string, string | undefined> = {};
        headerMap.forEach((key, index) => {
          if (key) row[key] = values[index]?.trim() || undefined;
        });
        return {
          employeeNumber: row.employeeNumber ?? '',
          payItemCode: row.payItemCode ?? '',
          ...(row.quantity ? { quantity: row.quantity } : {}),
          ...(row.rate ? { rate: row.rate } : {}),
          ...(row.amount ? { amount: row.amount } : {}),
          externalRef: row.externalRef ?? undefined,
          note: row.note ?? undefined,
        };
      });
      return importVariables(db, a, periodId, rows, parsed.format === 'xlsx' ? 'xlsx' : 'csv');
    } catch (error) {
      if (error instanceof MigrationParseError) {
        throw badRequest('PAYROLL_IMPORT_INVALID', error.message, { code: error.code });
      }
      throw error;
    }
  });

  app.post('/companies/:companyId/payroll/periods/:periodId/variables/import', async (req) => {
    const { companyId, periodId } = req.params as { companyId: string; periodId: string };
    const input = parse(z.object({
      source: z.enum(['csv', 'xlsx']).optional(),
      rows: z.array(z.object({
        employeeNumber: z.string().trim().min(1),
        payItemCode: z.string().trim().min(1),
        quantity: AmountSchema.optional(),
        rate: AmountSchema.optional(),
        amount: AmountSchema.optional(),
        externalRef: z.string().trim().max(100).nullish(),
        note: z.string().trim().max(500).nullish(),
      }).strict()).min(1).max(1000),
    }).strict(), req.body);
    return importVariables(db, await actor(req, companyId, 'write'), periodId, input.rows, input.source ?? 'csv');
  });

  // -------------------------------------------------------- calculations/payslips
  app.get('/companies/:companyId/payroll/calculations/:calculationId', async (req) => {
    const { companyId, calculationId } = req.params as { companyId: string; calculationId: string };
    await actor(req, companyId);
    return { calculation: await getCalculation(db, companyId, calculationId) };
  });

  app.get('/companies/:companyId/payroll/payslips', async (req) => {
    const { companyId } = req.params as { companyId: string };
    await actor(req, companyId);
    const q = req.query as Record<string, string | undefined>;
    return { payslips: await listPayslips(db, companyId, q.periodId) };
  });

  app.post('/companies/:companyId/payroll/calculations/:calculationId/payslip', async (req, reply) => {
    const { companyId, calculationId } = req.params as { companyId: string; calculationId: string };
    const result = await generatePayslip(db, await actor(req, companyId, 'write'), calculationId);
    return reply.code(result.reused ? 200 : 201).send(result);
  });

  app.get('/companies/:companyId/payroll/payslips/:payslipId', async (req) => {
    const { companyId, payslipId } = req.params as { companyId: string; payslipId: string };
    await actor(req, companyId);
    return { payslip: await getPayslip(db, companyId, payslipId) };
  });

  app.post('/companies/:companyId/payroll/payslips/:payslipId/finalise', async (req) => {
    const { companyId, payslipId } = req.params as { companyId: string; payslipId: string };
    return { payslip: await finalisePayslip(db, await actor(req, companyId, 'write'), payslipId) };
  });

  app.get('/companies/:companyId/payroll/payslips/:payslipId/pdf', async (req, reply) => {
    const { companyId, payslipId } = req.params as { companyId: string; payslipId: string };
    await actor(req, companyId);
    const payslip = await getPayslip(db, companyId, payslipId);
    const company = await db.query<any>('SELECT name, brn FROM companies WHERE id = $1', [companyId]);
    const locale = String((req.headers['x-locale'] ?? 'fr')).toLowerCase().startsWith('en') ? 'en' : 'fr';
    const pdf = await payrollPdf({
      locale, company: company.rows[0], payslipNo: payslip.payslip_no,
      status: payslip.status, snapshot: payslip.snapshot,
    });
    reply.header('content-type', 'application/pdf');
    reply.header('content-disposition', `inline; filename="${payslip.payslip_no}-simulation.pdf"`);
    return reply.send(pdf);
  });

  app.get('/companies/:companyId/payroll/payslips.csv', async (req, reply) => {
    const { companyId } = req.params as { companyId: string };
    await actor(req, companyId);
    const q = req.query as Record<string, string | undefined>;
    const payslips = await listPayslips(db, companyId, q.periodId);
    const rows = [
      ['Payslip', 'Status', 'Period', 'Employee number', 'Employee', 'Currency', 'Gross', 'Deductions', 'Net arithmetic', 'Net payable', 'Disclaimer'],
      ...payslips.map((p) => [
        p.payslip_no, p.status, `${p.period_year}-${String(p.period_month).padStart(2, '0')}`,
        p.employee_number, p.full_name, p.snapshot?.currency ?? '',
        p.snapshot?.totals?.gross ?? '', p.snapshot?.totals?.deductions ?? '',
        p.snapshot?.totals?.netArithmetic ?? '', '', 'SIMULATION - NOT FOR PAYMENT',
      ]),
    ];
    const csv = rows.map((row) => row.map((cell) => {
      const text = String(cell ?? '');
      const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
      return `"${safe.replace(/"/g, '""')}"`;
    }).join(';')).join('\r\n');
    reply.header('content-type', 'text/csv; charset=utf-8');
    reply.header('content-disposition', 'attachment; filename="payroll-simulation.csv"');
    return `\uFEFF${csv}`;
  });

  // ------------------------------------------------------- accounting bridge
  app.get('/companies/:companyId/payroll/settings', async (req) => {
    const { companyId } = req.params as { companyId: string };
    await actor(req, companyId);
    const settings = await db.query<any>('SELECT * FROM payroll_settings WHERE company_id = $1', [companyId]);
    const accounts = await db.query<any>(
      `SELECT id, code, name, type FROM accounts WHERE company_id = $1 AND is_active = true
        ORDER BY code`,
      [companyId],
    );
    return { settings: settings.rows[0] ?? null, accounts: accounts.rows, accountingTransferImplemented: false };
  });

  app.patch('/companies/:companyId/payroll/settings', async (req) => {
    const { companyId } = req.params as { companyId: string };
    const a = await actor(req, companyId, 'write');
    const input = parse(z.object({
      salaryExpenseAccountId: z.string().uuid().nullish(),
      salaryPayableAccountId: z.string().uuid().nullish(),
      payePayableAccountId: z.string().uuid().nullish(),
      csgPayableAccountId: z.string().uuid().nullish(),
      nsfPayableAccountId: z.string().uuid().nullish(),
      notes: z.string().trim().max(2000).nullish(),
    }).strict(), req.body);
    for (const accountId of [
      input.salaryExpenseAccountId, input.salaryPayableAccountId,
      input.payePayableAccountId, input.csgPayableAccountId, input.nsfPayableAccountId,
    ]) {
      if (!accountId) continue;
      const account = await db.query('SELECT 1 FROM accounts WHERE id = $1 AND company_id = $2', [accountId, companyId]);
      if (!account.rowCount) throw notFound('ACCOUNT_NOT_FOUND', 'Account not found in this company');
    }
    const res = await db.query<any>(
      `INSERT INTO payroll_settings
        (company_id, cabinet_id, salary_expense_account_id, salary_payable_account_id,
         paye_payable_account_id, csg_payable_account_id, nsf_payable_account_id, notes, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (company_id) DO UPDATE SET
         salary_expense_account_id = EXCLUDED.salary_expense_account_id,
         salary_payable_account_id = EXCLUDED.salary_payable_account_id,
         paye_payable_account_id = EXCLUDED.paye_payable_account_id,
         csg_payable_account_id = EXCLUDED.csg_payable_account_id,
         nsf_payable_account_id = EXCLUDED.nsf_payable_account_id,
         notes = EXCLUDED.notes, updated_by = EXCLUDED.updated_by, updated_at = now()
       RETURNING *`,
      [companyId, a.cabinetId, input.salaryExpenseAccountId || null, input.salaryPayableAccountId || null,
        input.payePayableAccountId || null, input.csgPayableAccountId || null, input.nsfPayableAccountId || null,
        input.notes || null, a.userId],
    );
    return { settings: res.rows[0], accountingTransferImplemented: false };
  });

  app.get('/companies/:companyId/payroll/periods/:periodId/accounting-preview', async (req) => {
    const { companyId, periodId } = req.params as { companyId: string; periodId: string };
    await actor(req, companyId);
    const period = await db.query<any>('SELECT * FROM payroll_periods WHERE id = $1 AND company_id = $2', [periodId, companyId]);
    if (!period.rows[0]) throw notFound('PAYROLL_PERIOD_NOT_FOUND', 'Payroll period not found');
    const totals = await db.query<any>(
      `SELECT currency, SUM(gross)::text AS gross, SUM(deductions)::text AS deductions,
              SUM(net_arithmetic)::text AS net_arithmetic, COUNT(*)::int AS employees
         FROM payroll_calculations WHERE company_id = $1 AND period_id = $2
        GROUP BY currency ORDER BY currency`,
      [companyId, periodId],
    );
    const settings = await db.query<any>('SELECT * FROM payroll_settings WHERE company_id = $1', [companyId]);
    return {
      period: period.rows[0],
      totalsByCurrency: totals.rows,
      accountsConfigured: Boolean(settings.rows[0]?.salary_expense_account_id && settings.rows[0]?.salary_payable_account_id),
      postingBlocked: true,
      reason: 'PAYROLL_ACCOUNTING_NOT_IMPLEMENTED',
      note: 'Aucune écriture comptable n’est créée. Les comptes doivent être configurés et la politique de paie validée.',
    };
  });
}
