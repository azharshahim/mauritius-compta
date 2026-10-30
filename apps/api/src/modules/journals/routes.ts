import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../../db/index.js';
import { JOURNAL_TYPES, type JournalRow } from '../../types.js';
import { conflict, notFound } from '../../lib/errors.js';
import { clientIp, parse } from '../../lib/http.js';
import { writeAudit } from '../../lib/audit.js';
import { requireCompany } from '../../lib/tenant.js';

const journalBody = z.object({
  code: z.string().min(1).max(10),
  name: z.string().min(1).max(120),
  type: z.enum(JOURNAL_TYPES),
  isActive: z.boolean().optional(),
});

export function journalRoutes(app: FastifyInstance, db: Db) {
  app.get('/companies/:companyId/journals', async (req) => {
    const user = req.user!;
    const { companyId } = req.params as { companyId: string };
    await requireCompany(db, user.id, companyId, 'viewer');
    const res = await db.query<JournalRow>(
      'SELECT * FROM journals WHERE company_id = $1 ORDER BY code',
      [companyId],
    );
    return { journals: res.rows };
  });

  app.post('/companies/:companyId/journals', async (req, reply) => {
    const user = req.user!;
    const { companyId } = req.params as { companyId: string };
    await requireCompany(db, user.id, companyId, 'accountant');
    const body = parse(journalBody, req.body);

    const dup = await db.query(
      'SELECT 1 FROM journals WHERE company_id = $1 AND lower(btrim(code)) = lower(btrim($2))',
      [companyId, body.code],
    );
    if (dup.rowCount > 0) throw conflict('CONFLICT', 'Journal code already exists');

    const created = await db.query<JournalRow>(
      `INSERT INTO journals (company_id, code, name, type, is_active)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [companyId, body.code.trim().toUpperCase(), body.name.trim(), body.type, body.isActive ?? true],
    );
    await writeAudit(db, {
      companyId,
      userId: user.id,
      action: 'journal.create',
      entityType: 'journal',
      entityId: created.rows[0]!.id,
      details: { code: body.code },
      ip: clientIp(req),
    });
    return reply.code(201).send({ journal: created.rows[0] });
  });

  app.patch('/companies/:companyId/journals/:journalId', async (req) => {
    const user = req.user!;
    const { companyId, journalId } = req.params as { companyId: string; journalId: string };
    await requireCompany(db, user.id, companyId, 'accountant');
    const body = parse(
      z.object({ name: z.string().min(1).max(120).optional(), isActive: z.boolean().optional() }),
      req.body,
    );
    const updated = await db.query<JournalRow>(
      `UPDATE journals SET
         name = COALESCE($3, name),
         is_active = COALESCE($4, is_active)
       WHERE id = $1 AND company_id = $2
   RETURNING *`,
      [journalId, companyId, body.name?.trim() ?? null, body.isActive ?? null],
    );
    if (!updated.rows[0]) throw notFound('JOURNAL_NOT_FOUND', 'Journal not found');
    await writeAudit(db, {
      companyId,
      userId: user.id,
      action: 'journal.update',
      entityType: 'journal',
      entityId: journalId,
      ip: clientIp(req),
    });
    return { journal: updated.rows[0] };
  });
}
