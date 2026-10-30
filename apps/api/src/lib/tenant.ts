import type { Db } from '../db/index.js';
import { notFound, forbidden } from './errors.js';
import { ROLE_WEIGHT, type CompanyContext, type CompanyRole, type CompanyRow } from '../types.js';

/**
 * Resolves a company for a user and enforces the minimum role.
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
  const { role, ...company } = row;
  return { company: company as CompanyRow, role };
}

export const COMPANY_NOT_ARCHIVED = (ctx: CompanyContext) => ctx.company.status !== 'archived';
