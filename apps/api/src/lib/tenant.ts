import type { Db } from '../db/index.js';
import { notFound, forbidden, conflict } from './errors.js';
import { ACCESS_WEIGHT, effectiveAccess } from './permissions.js';
import {
  ROLE_WEIGHT,
  type AccessLevel,
  type CompanyContext,
  type CompanyRole,
  type CompanyRow,
  type ModuleName,
} from '../types.js';

/** A legacy role threshold maps onto the module access it must imply. */
const ROLE_TO_ACCESS: Record<CompanyRole, AccessLevel> = {
  viewer: 'read',
  accountant: 'write',
  billing_clerk: 'write',
  payroll_manager: 'write',
  manager: 'write',
  admin: 'admin',
  owner: 'admin',
  cabinet_admin: 'admin',
};

/**
 * Resolves a company for a user and enforces the minimum role *and* the module
 * permission that goes with it.
 *
 * A company the user is not a member of is reported as NOT_FOUND (404) rather
 * than FORBIDDEN (403) so that the API never discloses the existence of other
 * tenants' companies.
 */
export async function requireCompany(
  db: Db,
  userId: string,
  companyId: string,
  minRole: CompanyRole = 'viewer',
  module: ModuleName = 'accounting',
): Promise<CompanyContext> {
  if (!/^[0-9a-f-]{36}$/i.test(companyId)) {
    throw notFound('COMPANY_NOT_FOUND', 'Company not found');
  }
  const res = await db.query<CompanyRow & { role: CompanyRole }>(
    `SELECT c.*, m.role
       FROM companies c
       JOIN company_members m ON m.company_id = c.id
      WHERE c.id = $1 AND m.user_id = $2`,
    [companyId, userId],
  );
  const row = res.rows[0];
  if (!row) throw notFound('COMPANY_NOT_FOUND', 'Company not found');

  if (ROLE_WEIGHT[row.role] < ROLE_WEIGHT[minRole]) {
    throw forbidden(`This operation requires the "${minRole}" role or higher`);
  }

  // An archived dossier is read-only: its accounting history stays visible but
  // no new entry, account, journal or setting can be written into it.
  if (row.status === 'archived' && ROLE_WEIGHT[minRole] >= ROLE_WEIGHT.accountant) {
    throw conflict('COMPANY_ARCHIVED', 'Archived dossier is read-only');
  }

  // Defence in depth: the role is not enough, the module must be granted too.
  // For instance a payroll manager has the weight of an accountant but only
  // *read* access to accounting.
  const needed = ROLE_TO_ACCESS[minRole];
  const access = await effectiveAccess(db, companyId, userId, row.role, module);
  if (ACCESS_WEIGHT[access] < ACCESS_WEIGHT[needed]) {
    throw forbidden(
      `The "${module}" module requires ${needed} access`,
      'MODULE_FORBIDDEN',
    );
  }

  const { role, ...company } = row;
  return { company: company as CompanyRow, role };
}

export const COMPANY_NOT_ARCHIVED = (ctx: CompanyContext) => ctx.company.status !== 'archived';
