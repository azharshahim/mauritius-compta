import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../../db/index.js';
import { clientIp, parse } from '../../lib/http.js';
import { requireCompany } from '../../lib/tenant.js';
import { badRequest } from '../../lib/errors.js';
import { financialYearTimeline } from './timeline.js';
import {
  approveOpeningBatch, createOpeningBatch, deleteOpeningBatch, getOpeningBatch,
  listOpeningBatches, postOpeningBatch, previewOpening, updateOpeningBatch,
} from './opening.js';
import {
  approveAdjustment, createAdjustment, deleteAdjustment, getAdjustment, listAdjustments,
  postAdjustment, rejectAdjustment, restatementPreview, updateAdjustment,
} from './adjustments.js';
import {
  buildChecklist, getChecklist, getChecklistSettings, listChecklists, reviewChecklist,
  saveChecklist, updateChecklistSettings,
} from './checklist.js';
import { createArchive, exportArchive, getArchive, getArchiveSection, listArchives, verifyArchive } from './archive.js';
import type { FinancialYearActor } from './types.js';

const Uuid = z.string().uuid();
const AmountSchema = z.union([z.string().max(30), z.number()]);
const Line = z.object({
  accountId: Uuid,
  debit: AmountSchema.nullish(),
  credit: AmountSchema.nullish(),
  description: z.string().max(500).nullish(),
});
const OpeningSchema = z.object({
  periodId: Uuid,
  reference: z.string().trim().min(2).max(80),
  sourceReference: z.string().trim().min(2).max(200),
  journalId: Uuid,
  notes: z.string().max(2000).nullish(),
  lines: z.array(Line).min(2).max(200),
});
const OpeningPreviewSchema = z.object({
  periodId: Uuid,
  lines: z.array(Line).min(2).max(200).nullish(),
});
const DecisionSchema = z.object({ confirm: z.boolean(), note: z.string().min(1).max(2000) });
const RejectSchema = z.object({ reason: z.string().min(1).max(2000) });
const AdjustmentSchema = z.object({
  sourcePeriodId: Uuid,
  adjustmentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  journalId: Uuid,
  treatment: z.enum(['retained_earnings', 'current_year_result', 'custom']),
  originalEntryId: Uuid.nullish(),
  originalReference: z.string().trim().min(1).max(200),
  reason: z.string().trim().min(10).max(2000),
  documentRef: z.string().trim().min(2).max(120),
  restatesComparatives: z.boolean().optional(),
  comparativeNote: z.string().max(2000).nullish(),
  lines: z.array(Line).min(2).max(50),
});
const ChecklistSettingsSchema = z.object({
  suspenseAccountIds: z.array(Uuid).max(50).optional(),
  retentionMonths: z.number().int().positive().nullable().optional(),
  retentionNote: z.string().max(2000).nullish(),
  documentBackupNote: z.string().max(2000).nullish(),
});
const ArchiveSchema = z.object({ periodId: Uuid, note: z.string().max(2000).nullish() });

/**
 * Financial years, opening balances, prior-year adjustments, checklists and
 * immutable archives. Reads require the accounting module; drafting requires
 * accountant; approvals, posting and sealing archives require manager.
 */
export function financialYearRoutes(app: FastifyInstance, db: Db) {
  async function actor(req: any, companyId: string, minRole: 'viewer' | 'accountant' | 'manager'): Promise<FinancialYearActor> {
    const user = req.user!;
    await requireCompany(db, user.id, companyId, minRole, 'accounting');
    return { companyId, userId: user.id, ip: clientIp(req) };
  }
  function periodId(req: any): string {
    const query = req.query as Record<string, string | undefined>;
    if (!query.periodId || !/^[0-9a-f-]{36}$/i.test(query.periodId)) throw badRequest('VALIDATION_ERROR', 'periodId is required');
    return query.periodId;
  }

  app.get('/companies/:companyId/financial-years/timeline', async (req) => {
    const { companyId } = req.params as { companyId: string };
    await actor(req, companyId, 'viewer');
    return financialYearTimeline(db, companyId);
  });

  // ------------------------------------------------------- opening balances
  app.get('/companies/:companyId/financial-years/opening-balances', async (req) => {
    const { companyId } = req.params as { companyId: string };
    await actor(req, companyId, 'viewer');
    return previewOpening(db, companyId, periodId(req));
  });
  app.post('/companies/:companyId/financial-years/opening-balances/preview', async (req) => {
    const { companyId } = req.params as { companyId: string };
    await actor(req, companyId, 'viewer');
    const body = parse(OpeningPreviewSchema, req.body);
    return previewOpening(db, companyId, body.periodId, body.lines ?? undefined);
  });
  app.get('/companies/:companyId/financial-years/opening-balances/batches', async (req) => {
    const { companyId } = req.params as { companyId: string };
    await actor(req, companyId, 'viewer');
    return { batches: await listOpeningBatches(db, companyId) };
  });
  app.get('/companies/:companyId/financial-years/opening-balances/batches/:id', async (req) => {
    const { companyId, id } = req.params as { companyId: string; id: string };
    await actor(req, companyId, 'viewer');
    return { batch: await getOpeningBatch(db, companyId, id) };
  });
  app.post('/companies/:companyId/financial-years/opening-balances/batches', async (req, reply) => {
    const { companyId } = req.params as { companyId: string };
    const a = await actor(req, companyId, 'accountant');
    const body = parse(OpeningSchema, req.body);
    return reply.code(201).send({ batch: await createOpeningBatch(db, a, body) });
  });
  app.put('/companies/:companyId/financial-years/opening-balances/batches/:id', async (req) => {
    const { companyId, id } = req.params as { companyId: string; id: string };
    const a = await actor(req, companyId, 'accountant');
    const body = parse(OpeningSchema.omit({ periodId: true }), req.body);
    return { batch: await updateOpeningBatch(db, a, id, body) };
  });
  app.delete('/companies/:companyId/financial-years/opening-balances/batches/:id', async (req) => {
    const { companyId, id } = req.params as { companyId: string; id: string };
    const a = await actor(req, companyId, 'accountant');
    return deleteOpeningBatch(db, a, id);
  });
  app.post('/companies/:companyId/financial-years/opening-balances/batches/:id/approve', async (req) => {
    const { companyId, id } = req.params as { companyId: string; id: string };
    const a = await actor(req, companyId, 'manager');
    const body = parse(DecisionSchema, req.body);
    return { batch: await approveOpeningBatch(db, a, id, body) };
  });
  app.post('/companies/:companyId/financial-years/opening-balances/batches/:id/post', async (req) => {
    const { companyId, id } = req.params as { companyId: string; id: string };
    const a = await actor(req, companyId, 'manager');
    return postOpeningBatch(db, a, id);
  });

  // -------------------------------------------------- prior-year adjustments
  app.get('/companies/:companyId/financial-years/prior-year-adjustments', async (req) => {
    const { companyId } = req.params as { companyId: string };
    await actor(req, companyId, 'viewer');
    return { adjustments: await listAdjustments(db, companyId) };
  });
  app.get('/companies/:companyId/financial-years/prior-year-adjustments/:id', async (req) => {
    const { companyId, id } = req.params as { companyId: string; id: string };
    await actor(req, companyId, 'viewer');
    return { adjustment: await getAdjustment(db, companyId, id) };
  });
  app.get('/companies/:companyId/financial-years/prior-year-adjustments/:id/restatement', async (req) => {
    const { companyId, id } = req.params as { companyId: string; id: string };
    await actor(req, companyId, 'viewer');
    return { restatement: await restatementPreview(db, companyId, id) };
  });
  app.post('/companies/:companyId/financial-years/prior-year-adjustments', async (req, reply) => {
    const { companyId } = req.params as { companyId: string };
    const a = await actor(req, companyId, 'accountant');
    const body = parse(AdjustmentSchema, req.body);
    return reply.code(201).send({ adjustment: await createAdjustment(db, a, body) });
  });
  app.put('/companies/:companyId/financial-years/prior-year-adjustments/:id', async (req) => {
    const { companyId, id } = req.params as { companyId: string; id: string };
    const a = await actor(req, companyId, 'accountant');
    const body = parse(AdjustmentSchema, req.body);
    return { adjustment: await updateAdjustment(db, a, id, body) };
  });
  app.delete('/companies/:companyId/financial-years/prior-year-adjustments/:id', async (req) => {
    const { companyId, id } = req.params as { companyId: string; id: string };
    const a = await actor(req, companyId, 'accountant');
    return deleteAdjustment(db, a, id);
  });
  app.post('/companies/:companyId/financial-years/prior-year-adjustments/:id/approve', async (req) => {
    const { companyId, id } = req.params as { companyId: string; id: string };
    const a = await actor(req, companyId, 'manager');
    const body = parse(DecisionSchema, req.body);
    return { adjustment: await approveAdjustment(db, a, id, body) };
  });
  app.post('/companies/:companyId/financial-years/prior-year-adjustments/:id/reject', async (req) => {
    const { companyId, id } = req.params as { companyId: string; id: string };
    const a = await actor(req, companyId, 'manager');
    const body = parse(RejectSchema, req.body);
    return { adjustment: await rejectAdjustment(db, a, id, body) };
  });
  app.post('/companies/:companyId/financial-years/prior-year-adjustments/:id/post', async (req) => {
    const { companyId, id } = req.params as { companyId: string; id: string };
    const a = await actor(req, companyId, 'manager');
    return postAdjustment(db, a, id);
  });

  // --------------------------------------------------------------- checklist
  app.get('/companies/:companyId/financial-years/checklist', async (req) => {
    const { companyId } = req.params as { companyId: string };
    await actor(req, companyId, 'viewer');
    return buildChecklist(db, companyId, periodId(req));
  });
  app.get('/companies/:companyId/financial-years/checklists', async (req) => {
    const { companyId } = req.params as { companyId: string };
    await actor(req, companyId, 'viewer');
    const query = req.query as Record<string, string | undefined>;
    return { checklists: await listChecklists(db, companyId, query.periodId) };
  });
  app.get('/companies/:companyId/financial-years/checklists/:id', async (req) => {
    const { companyId, id } = req.params as { companyId: string; id: string };
    await actor(req, companyId, 'viewer');
    return { checklist: await getChecklist(db, companyId, id) };
  });
  app.post('/companies/:companyId/financial-years/checklists', async (req, reply) => {
    const { companyId } = req.params as { companyId: string };
    const a = await actor(req, companyId, 'accountant');
    const body = parse(z.object({ periodId: Uuid }), req.body);
    return reply.code(201).send({ checklist: await saveChecklist(db, a, body.periodId) });
  });
  app.post('/companies/:companyId/financial-years/checklists/:id/review', async (req) => {
    const { companyId, id } = req.params as { companyId: string; id: string };
    const a = await actor(req, companyId, 'manager');
    const body = parse(DecisionSchema, req.body);
    return { checklist: await reviewChecklist(db, a, id, body) };
  });
  app.get('/companies/:companyId/financial-years/settings', async (req) => {
    const { companyId } = req.params as { companyId: string };
    await actor(req, companyId, 'viewer');
    return { settings: await getChecklistSettings(db, companyId) };
  });
  app.put('/companies/:companyId/financial-years/settings', async (req) => {
    const { companyId } = req.params as { companyId: string };
    const a = await actor(req, companyId, 'manager');
    const body = parse(ChecklistSettingsSchema, req.body);
    return { settings: await updateChecklistSettings(db, a, body) };
  });

  // ---------------------------------------------------------------- archives
  app.get('/companies/:companyId/financial-years/archives', async (req) => {
    const { companyId } = req.params as { companyId: string };
    await actor(req, companyId, 'viewer');
    const query = req.query as Record<string, string | undefined>;
    return { archives: await listArchives(db, companyId, query.periodId) };
  });
  app.post('/companies/:companyId/financial-years/archives', async (req, reply) => {
    const { companyId } = req.params as { companyId: string };
    const a = await actor(req, companyId, 'manager');
    const body = parse(ArchiveSchema, req.body);
    return reply.code(201).send({ archive: await createArchive(db, a, body) });
  });
  app.get('/companies/:companyId/financial-years/archives/:id', async (req) => {
    const { companyId, id } = req.params as { companyId: string; id: string };
    await actor(req, companyId, 'viewer');
    return { archive: await getArchive(db, companyId, id) };
  });
  app.get('/companies/:companyId/financial-years/archives/:id/verify', async (req) => {
    const { companyId, id } = req.params as { companyId: string; id: string };
    await actor(req, companyId, 'viewer');
    return { verification: await verifyArchive(db, companyId, id) };
  });
  app.get('/companies/:companyId/financial-years/archives/:id/sections/:section', async (req) => {
    const { companyId, id, section } = req.params as { companyId: string; id: string; section: string };
    await actor(req, companyId, 'viewer');
    return getArchiveSection(db, companyId, id, section);
  });
  app.get('/companies/:companyId/financial-years/archives/:id/download', async (req, reply) => {
    const { companyId, id } = req.params as { companyId: string; id: string };
    await actor(req, companyId, 'viewer');
    const query = req.query as Record<string, string | undefined>;
    const format = query.format === 'json' ? 'json' : 'zip';
    const file = await exportArchive(db, companyId, id, format);
    return reply
      .type(file.contentType)
      .header('Content-Disposition', `attachment; filename="${file.fileName}"`)
      .send(file.body);
  });
}
