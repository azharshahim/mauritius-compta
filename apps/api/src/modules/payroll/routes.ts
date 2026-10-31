import type { FastifyInstance } from 'fastify';
import type { Db } from '../../db/index.js';
import { notImplemented } from '../../lib/errors.js';
import { requireModuleAccess } from '../../lib/permissions.js';

/**
 * Payroll module - foundations only (Mauritius Business Suite, mission 4).
 *
 * Payroll data is protected by its own module permission: an accounting
 * collaborator (`accountant`) has `payroll: none`, a payroll manager has
 * `accounting: read` and `payroll: write`. Nothing here computes PAYE, CSG,
 * NSF contributions or any statutory amount: the Mauritian rules have not been
 * validated yet (see docs/mauritius-regulations/), and inventing them would be
 * a correctness and compliance risk.
 */
export function payrollRoutes(app: FastifyInstance, db: Db) {
  app.get('/companies/:companyId/payroll/employees', async (req) => {
    const user = req.user!;
    const { companyId } = req.params as { companyId: string };
    await requireModuleAccess(db, user.id, companyId, 'payroll', 'read');
    const res = await db.query(
      `SELECT id, employee_ref, full_name, job_title, start_date, end_date, status, created_at
         FROM payroll_employees
        WHERE company_id = $1
        ORDER BY full_name`,
      [companyId],
    );
    return { employees: res.rows, available: false };
  });

  app.get('/companies/:companyId/payroll/summary', async (req) => {
    const user = req.user!;
    const { companyId } = req.params as { companyId: string };
    await requireModuleAccess(db, user.id, companyId, 'payroll', 'read');
    const res = await db.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM payroll_employees
        WHERE company_id = $1 AND status = 'active'`,
      [companyId],
    );
    return {
      available: false,
      activeEmployees: Number(res.rows[0]?.count ?? 0),
      capabilities: {
        paye: false,
        csg: false,
        nsf: false,
        payslips: false,
        leaveManagement: false,
        statutoryDeclarations: false,
        accountingTransfer: false,
      },
      notice:
        'Statutory payroll calculations are not implemented: the Mauritian rules are not validated.',
    };
  });

  app.post('/companies/:companyId/payroll/employees', async (req) => {
    const user = req.user!;
    const { companyId } = req.params as { companyId: string };
    await requireModuleAccess(db, user.id, companyId, 'payroll', 'write');
    throw notImplemented(
      'NOT_IMPLEMENTED',
      'Payroll employee management is prepared but not implemented in this version',
    );
  });

  app.post('/companies/:companyId/payroll/runs', async (req) => {
    const user = req.user!;
    const { companyId } = req.params as { companyId: string };
    await requireModuleAccess(db, user.id, companyId, 'payroll', 'write');
    throw notImplemented('NOT_IMPLEMENTED', 'Payroll calculation is not implemented');
  });
}
