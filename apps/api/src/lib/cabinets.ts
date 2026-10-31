import type { Db } from '../db/index.js';
import { forbidden, notFound } from './errors.js';

/**
 * Cabinet (accounting firm) helpers.
 *
 * A cabinet owns the client dossiers stored in `companies`. It is the scope of
 * AI configuration, of API keys and of usage budgets: two cabinets can never
 * see, decrypt or bill each other's secrets.
 */

const UUID = /^[0-9a-f-]{36}$/i;
const ADMIN_ROLES = ['owner', 'admin', 'cabinet_admin'] as const;

export interface CabinetRow {
  id: string;
  name: string;
  owner_user_id: string;
  created_at: string;
}

/** Creates (once) the cabinet of a user, named after them by default. */
export async function ensureCabinetForUser(
  db: Db,
  userId: string,
  fallbackName = 'Cabinet',
): Promise<string> {
  const existing = await db.query<{ id: string }>(
    'SELECT id FROM cabinets WHERE owner_user_id = $1 ORDER BY created_at ASC LIMIT 1',
    [userId],
  );
  if (existing.rows[0]) return existing.rows[0].id;

  const user = await db.query<{ email: string; full_name: string | null }>(
    'SELECT email, full_name FROM app_users WHERE id = $1',
    [userId],
  );
  const row = user.rows[0];
  const name = row?.full_name?.trim() ? `Cabinet ${row.full_name.trim()}` : `Cabinet ${fallbackName}`;
  const created = await db.query<{ id: string }>(
    `INSERT INTO cabinets (name, owner_user_id) VALUES ($1, $2) RETURNING id`,
    [name.slice(0, 120), userId],
  );
  return created.rows[0]!.id;
}

/**
 * Attaches a newly created company to the cabinet of its creator (or creates
 * that cabinet). Called inside the company-creation transaction.
 */
export async function attachCompanyToCabinet(
  db: Db,
  companyId: string,
  userId: string,
): Promise<string> {
  const cabinetId = await ensureCabinetForUser(db, userId);
  await db.query('UPDATE companies SET cabinet_id = $1 WHERE id = $2 AND cabinet_id IS NULL', [
    cabinetId,
    companyId,
  ]);
  return cabinetId;
}

export async function cabinetOfCompany(db: Db, companyId: string): Promise<string | null> {
  const res = await db.query<{ cabinet_id: string | null }>(
    'SELECT cabinet_id FROM companies WHERE id = $1',
    [companyId],
  );
  return res.rows[0]?.cabinet_id ?? null;
}

/** Cabinets a user administers (owner of the cabinet or admin of a dossier). */
export async function cabinetsOfUser(db: Db, userId: string): Promise<CabinetRow[]> {
  const res = await db.query<CabinetRow>(
    `SELECT DISTINCT cb.*
       FROM cabinets cb
       JOIN companies c ON c.cabinet_id = cb.id
       JOIN company_members m ON m.company_id = c.id AND m.user_id = $1
      WHERE cb.owner_user_id = $1 OR m.role IN ('owner', 'admin', 'cabinet_admin')
      ORDER BY cb.created_at ASC`,
    [userId],
  );
  return res.rows;
}

/**
 * Authorises cabinet-level AI operations.
 *
 * - unknown cabinet, or a cabinet the user has no link with -> 404, so the API
 *   never discloses that another cabinet exists;
 * - a member without administration rights -> 403 AI_FORBIDDEN.
 */
export async function requireCabinetAdmin(
  db: Db,
  userId: string,
  cabinetId: string | null,
): Promise<CabinetRow> {
  if (!cabinetId || !UUID.test(cabinetId)) {
    throw notFound('CABINET_NOT_FOUND', 'Cabinet not found');
  }
  const cabinet = await db.query<CabinetRow>('SELECT * FROM cabinets WHERE id = $1', [cabinetId]);
  const row = cabinet.rows[0];
  if (!row) throw notFound('CABINET_NOT_FOUND', 'Cabinet not found');

  if (row.owner_user_id === userId) return row;

  const admin = await db.query<{ role: string }>(
    `SELECT m.role
       FROM companies c
       JOIN company_members m ON m.company_id = c.id
      WHERE c.cabinet_id = $1 AND m.user_id = $2
        AND m.role IN (${ADMIN_ROLES.map((_, i) => `$${i + 3}`).join(',')})
      LIMIT 1`,
    [cabinetId, userId, ...ADMIN_ROLES],
  );
  if (admin.rowCount === 0) {
    const linked = await db.query(
      `SELECT 1 FROM company_members m JOIN companies c ON c.id = m.company_id
        WHERE c.cabinet_id = $1 AND m.user_id = $2 LIMIT 1`,
      [cabinetId, userId],
    );
    if (linked.rowCount === 0) throw notFound('CABINET_NOT_FOUND', 'Cabinet not found');
    throw forbidden('Cabinet administration rights are required', 'AI_FORBIDDEN');
  }
  return row;
}

/** The cabinet context used by the company-scoped AI routes. */
export async function cabinetForCompanyUser(
  db: Db,
  companyId: string,
  userId: string,
): Promise<{ cabinetId: string; isCabinetAdmin: boolean }> {
  const cabinetId = await cabinetOfCompany(db, companyId);
  if (!cabinetId) throw notFound('CABINET_NOT_FOUND', 'Cabinet not found');
  const res = await db.query<{ role: string }>(
    `SELECT m.role FROM companies c
       JOIN company_members m ON m.company_id = c.id
      WHERE c.id = $1 AND m.user_id = $2`,
    [companyId, userId],
  );
  const role = res.rows[0]?.role;
  return {
    cabinetId,
    isCabinetAdmin: role !== undefined && (ADMIN_ROLES as readonly string[]).includes(role),
  };
}
