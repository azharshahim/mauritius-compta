import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../../db/index.js';
import { clientIp, parse } from '../../lib/http.js';
import { requireCompany } from '../../lib/tenant.js';
import {
  accrualReport, approveSchedule, cancelSchedule, createSchedule, getSchedule, listSchedules,
  postDueLines, postLine, reverseLine, updateSchedule, type AccrualActor,
} from './service.js';

const Uuid = z.string().uuid();
const DateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Amount = z.union([z.string().max(30), z.number()]).transform<string>((v) => String(v));
const DecisionSchema = z.object({ confirm: z.boolean(), note: z.string().min(1).max(2000) });
const ScheduleBody = z.object({
  reference: z.string().trim().min(2).max(60),
  kind: z.enum(['accrued_expense', 'accrued_income', 'prepaid_expense', 'deferred_income']),
  description: z.string().trim().min(3).max(500),
  counterparty: z.string().max(200).nullish(),
  documentRef: z.string().trim().min(2).max(120),
  pnlAccountId: Uuid, balanceAccountId: Uuid, journalId: Uuid,
  totalAmount: Amount, startDate: DateSchema, endDate: DateSchema,
  months: z.number().int().min(1).max(120), notes: z.string().max(2000).nullish(),
});

export function accrualRoutes(app: FastifyInstance, db: Db) {
  async function actor(req: any, companyId: string, minRole: 'viewer' | 'accountant' | 'manager'): Promise<AccrualActor> {
    const user = req.user!;
    await requireCompany(db, user.id, companyId, minRole, 'accounting');
    return { companyId, userId: user.id, ip: clientIp(req) };
  }
  const base = '/companies/:companyId/accruals';

  app.get(base, async (req) => {
    const { companyId } = req.params as any;
    await actor(req, companyId, 'viewer');
    const q = req.query as any;
    return { schedules: await listSchedules(db, companyId, { from: q.from, to: q.to, kind: q.kind, status: q.status }) };
  });
  app.get(`${base}/report`, async (req) => {
    const { companyId } = req.params as any;
    await actor(req, companyId, 'viewer');
    const asOf = (req.query as any).asOf;
    if (!asOf) throw new Error('asOf is required');
    return accrualReport(db, companyId, asOf);
  });
  app.get(`${base}/:id`, async (req) => {
    const { companyId, id } = req.params as any;
    await actor(req, companyId, 'viewer');
    return { schedule: await getSchedule(db, companyId, id) };
  });
  app.post(base, async (req, reply) => {
    const { companyId } = req.params as any;
    const a = await actor(req, companyId, 'accountant');
    return reply.code(201).send({ schedule: await createSchedule(db, a, parse(ScheduleBody, req.body)) });
  });
  app.put(`${base}/:id`, async (req) => {
    const { companyId, id } = req.params as any;
    const a = await actor(req, companyId, 'accountant');
    return { schedule: await updateSchedule(db, a, id, parse(ScheduleBody.partial(), req.body)) };
  });
  app.post(`${base}/:id/approve`, async (req) => {
    const { companyId, id } = req.params as any;
    const a = await actor(req, companyId, 'manager');
    return { schedule: await approveSchedule(db, a, id, parse(DecisionSchema, req.body)) };
  });
  app.post(`${base}/:id/cancel`, async (req) => {
    const { companyId, id } = req.params as any;
    const a = await actor(req, companyId, 'manager');
    return { schedule: await cancelSchedule(db, a, id) };
  });
  app.post(`${base}/:id/lines/:lineId/post`, async (req) => {
    const { companyId, id, lineId } = req.params as any;
    const a = await actor(req, companyId, 'manager');
    return postLine(db, a, id, lineId);
  });
  app.post(`${base}/:id/post-due`, async (req) => {
    const { companyId, id } = req.params as any;
    const a = await actor(req, companyId, 'manager');
    const body = parse(z.object({ asOf: DateSchema }), req.body);
    return postDueLines(db, a, id, body.asOf);
  });
  app.post(`${base}/:id/lines/:lineId/reverse`, async (req) => {
    const { companyId, id, lineId } = req.params as any;
    const a = await actor(req, companyId, 'manager');
    const body = parse(z.object({ reversalDate: DateSchema, reason: z.string().trim().min(3).max(1000) }), req.body);
    return reverseLine(db, a, id, lineId, body);
  });
}
