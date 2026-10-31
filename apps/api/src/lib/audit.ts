import type { Db } from '../db/index.js';

export interface AuditParams {
  companyId?: string | null;
  userId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  details?: Record<string, unknown>;
  ip?: string | null;
}

/**
 * Appends an immutable audit record. Always call inside the same transaction
 * as the operation it describes.
 */
export async function writeAudit(db: Db, p: AuditParams): Promise<void> {
  await db.query(
    `INSERT INTO audit_log (company_id, user_id, action, entity_type, entity_id, details, ip)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
    [
      p.companyId ?? null,
      p.userId ?? null,
      p.action,
      p.entityType,
      p.entityId ?? null,
      JSON.stringify(p.details ?? {}),
      p.ip ?? null,
    ],
  );
}
