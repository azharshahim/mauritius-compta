import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../../db/index.js';
import { notImplemented } from '../../lib/errors.js';
import { parse } from '../../lib/http.js';
import { requireModuleAccess } from '../../lib/permissions.js';

/**
 * Billing module - foundations only (Mauritius Business Suite, mission 4).
 *
 * What exists here: the isolated tables (`billing_documents`, migration 0004),
 * company-scoped read endpoints, module permissions, and the invariant that a
 * document can be linked to at most one accounting entry (`accounting_entry_id`
 * is UNIQUE) which will prevent double posting in the next mission.
 *
 * What does *not* exist: invoice numbering, VAT computation, MRA e-invoicing,
 * PDF generation. Those endpoints answer 501 NOT_IMPLEMENTED on purpose: the
 * interface must never pretend that a regulatory feature is available.
 */
export function billingRoutes(app: FastifyInstance, db: Db) {
  app.get('/companies/:companyId/billing/documents', async (req) => {
    const user = req.user!;
    const { companyId } = req.params as { companyId: string };
    const q = req.query as { kind?: string; status?: string };
    await requireModuleAccess(db, user.id, companyId, 'billing', 'read');
    const filters: string[] = ['company_id = $1'];
    const params: unknown[] = [companyId];
    if (q.kind) {
      params.push(q.kind);
      filters.push(`kind = $${params.length}`);
    }
    if (q.status) {
      params.push(q.status);
      filters.push(`status = $${params.length}`);
    }
    const res = await db.query(
      `SELECT id, kind, doc_no, customer_name, customer_brn, issue_date, due_date,
              currency, total_amount, status, accounting_entry_id, created_at
         FROM billing_documents
        WHERE ${filters.join(' AND ')}
        ORDER BY issue_date DESC, created_at DESC
        LIMIT 200`,
      params,
    );
    return { documents: res.rows, available: false };
  });

  app.get('/companies/:companyId/billing/summary', async (req) => {
    const user = req.user!;
    const { companyId } = req.params as { companyId: string };
    await requireModuleAccess(db, user.id, companyId, 'billing', 'read');
    const res = await db.query<{ kind: string; status: string; count: string }>(
      `SELECT kind, status, count(*)::text AS count
         FROM billing_documents WHERE company_id = $1 GROUP BY kind, status`,
      [companyId],
    );
    return {
      available: false,
      counts: res.rows,
      // Explicitly advertised as not implemented: the UI shows the roadmap.
      capabilities: {
        numbering: false,
        vatComputation: false,
        mraEInvoicing: false,
        postingToAccounting: false,
      },
    };
  });

  // Write endpoints exist only to return a truthful 501 until the engine lands.
  const notYet = async () => {
    throw notImplemented(
      'NOT_IMPLEMENTED',
      'Billing documents are prepared but not implemented in this version',
    );
  };

  app.post('/companies/:companyId/billing/documents', async (req) => {
    const user = req.user!;
    const { companyId } = req.params as { companyId: string };
    await requireModuleAccess(db, user.id, companyId, 'billing', 'write');
    parse(z.object({}).passthrough(), req.body ?? {});
    return notYet();
  });
}
