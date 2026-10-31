import type { Db } from '../db/index.js';
import { forbidden, notFound } from './errors.js';
import type { CompanyRole, ModuleName, AccessLevel } from '../types.js';

export const ACCESS_WEIGHT: Record<AccessLevel, number> = {
  none: 0,
  read: 1,
  write: 2,
  admin: 3,
};

/**
 * Default module permissions attached to each company role.
 *
 * The accounting and payroll grants are deliberately disjoint: a payroll
 * manager can work on payroll but only *read* accounting, and an accounting
 * collaborator has no payroll access at all. Per-company overrides live in
 * `company_module_access` (migration 0004) and can only widen these defaults.
 */
export const ROLE_MODULE_DEFAULTS: Record<CompanyRole, Record<ModuleName, AccessLevel>> = {
  owner: { cabinet: 'admin', accounting: 'admin', billing: 'admin', payroll: 'admin' },
  admin: { cabinet: 'admin', accounting: 'admin', billing: 'admin', payroll: 'admin' },
  cabinet_admin: { cabinet: 'admin', accounting: 'admin', billing: 'admin', payroll: 'admin' },
  manager: { cabinet: 'write', accounting: 'write', billing: 'write', payroll: 'none' },
  accountant: { cabinet: 'read', accounting: 'write', billing: 'read', payroll: 'none' },
  billing_clerk: { cabinet: 'read', accounting: 'read', billing: 'write', payroll: 'none' },
  payroll_manager: { cabinet: 'read', accounting: 'read', billing: 'read', payroll: 'write' },
  viewer: { cabinet: 'read', accounting: 'read', billing: 'read', payroll: 'none' },
};

export const MODULES: ModuleName[] = ['cabinet', 'accounting', 'billing', 'payroll'];

/** Structural (TypeScript) view for the UI: never trust it for authorisation. */
export function roleModules(role: CompanyRole): Record<ModuleName, AccessLevel> {
  return { ...ROLE_MODULE_DEFAULTS[role] };
}

function atLeast(access: AccessLevel, min: AccessLevel): boolean {
  return ACCESS_WEIGHT[access] >= ACCESS_WEIGHT[min];
}

/**
 * Effective access = role default, widened by an explicit grant for the module.
 * An explicit grant can never remove a right: administration remains explicit.
 */
export async function effectiveAccess(
  db: Db,
  companyId: string,
  userId: string,
  role: CompanyRole,
  module: ModuleName,
): Promise<AccessLevel> {
  const base = ROLE_MODULE_DEFAULTS[role][module];
  const res = await db.query<{ access: AccessLevel }>(
    `SELECT access FROM company_module_access
      WHERE company_id = $1 AND user_id = $2 AND module = $3`,
    [companyId, userId, module],
  );
  const granted = res.rows[0]?.access;
  if (!granted) return base;
  return ACCESS_WEIGHT[granted] > ACCESS_WEIGHT[base] ? granted : base;
}

/** All module permissions of a user for one company (used by the UI and tests). */
export async function effectiveModules(
  db: Db,
  companyId: string,
  userId: string,
  role: CompanyRole,
): Promise<Record<ModuleName, AccessLevel>> {
  const res = await db.query<{ module: ModuleName; access: AccessLevel }>(
    `SELECT module, access FROM company_module_access WHERE company_id = $1 AND user_id = $2`,
    [companyId, userId],
  );
  const out = roleModules(role);
  for (const row of res.rows) {
    if (ACCESS_WEIGHT[row.access] > ACCESS_WEIGHT[out[row.module]]) out[row.module] = row.access;
  }
  return out;
}

export interface ModuleContext {
  companyId: string;
  userId: string;
  role: CompanyRole;
  access: AccessLevel;
}

/**
 * Authorises a module operation for a company the user belongs to.
 *
 * A user who is not a member gets 404 (the API never discloses other tenants);
 * a member without the required access gets 403 MODULE_FORBIDDEN.
 */
export async function requireModuleAccess(
  db: Db,
  userId: string,
  companyId: string,
  module: ModuleName,
  min: AccessLevel = 'read',
): Promise<ModuleContext> {
  if (!/^[0-9a-f-]{36}$/i.test(companyId)) {
    throw notFound('COMPANY_NOT_FOUND', 'Company not found');
  }
  const res = await db.query<{ role: CompanyRole }>(
    'SELECT role FROM company_members WHERE company_id = $1 AND user_id = $2',
    [companyId, userId],
  );
  const role = res.rows[0]?.role;
  if (!role) throw notFound('COMPANY_NOT_FOUND', 'Company not found');

  const access = await effectiveAccess(db, companyId, userId, role, module);
  if (!atLeast(access, min)) {
    throw forbidden(`The "${module}" module requires ${min} access`, 'MODULE_FORBIDDEN');
  }
  return { companyId, userId, role, access };
}

/** True when the user administers the cabinet (needed for cross-company screens). */
export async function isCabinetAdmin(db: Db, userId: string): Promise<boolean> {
  const res = await db.query<{ role: CompanyRole }>(
    `SELECT role FROM company_members
      WHERE user_id = $1 AND role IN ('cabinet_admin', 'owner', 'admin') LIMIT 1`,
    [userId],
  );
  return res.rowCount > 0;
}
