import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../../db/index.js';
import { clientIp, parse } from '../../lib/http.js';
import { requireCompany } from '../../lib/tenant.js';
import {
  approveMovement, createMovement, createProvision, getProvision, listProvisions, movementReport,
  postMovement, provisionCheck, reconciliationReport, rejectMovement, updateProvision, type ProvisionActor,
} from './service.js';

const Uuid = z.string().uuid();
const DateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Amount = z.union([z.string().max(30), z.number()]).transform<string>((v) => String(v));
const DecisionSchema = z.object({ confirm: z.boolean(), note: z.string().min(1).max(2000) });
const ProvisionBody = z.object({
  category: z.enum(['litigation', 'warranty', 'restructuring', 'other']),
  description: z.string().trim().min(5).max(1000),
  evidenceRef: z.string().trim().min(2).max(200),
  recognitionDate: DateSchema,
  measurementBasis: z.string().trim().min(5).max(2000),
  expenseAccountId: Uuid, provisionAccountId: Uuid,
  currentPortion: Amount.nullish(), nonCurrentPortion: Amount.nullish(),
  initialAmount: Amount.nullish(), journalId: Uuid.nullish(),
  initialReason: z.string().max(1000).nullish(), documentRef: z.string().max(120).nullish(),
});
const MovementBody = z.object({
  movementType: z.enum(['recognition', 'revision', 'utilisation', 'reversal']),
  movementDate: DateSchema, amount: Amount,
  direction: z.enum(['increase', 'decrease']).optional(),
  reason: z.string().trim().min(5).max(1000),
  documentRef: z.string().trim().min(2).max(120),
  journalId: Uuid, counterpartAccountId: Uuid.nullish(),
});

export function provisionRoutes(app: FastifyInstance, db: Db) {
  async function actor(req: any, companyId: string, minRole: 'viewer' | 'accountant' | 'manager'): Promise<ProvisionActor> {
    const user = req.user!;
    await requireCompany(db, user.id, companyId, minRole, 'accounting');
    return { companyId, userId: user.id, ip: clientIp(req) };
  }
  const base = '/companies/:companyId/provisions';

  app.get(base, async (req) => {
    const { companyId } = req.params as any;
    await actor(req, companyId, 'viewer');
    const q = req.query as any;
    return { provisions: await listProvisions(db, companyId, { category: q.category, status: q.status }) };
  });
  app.get(`${base}/report`, async (req) => {
    const { companyId } = req.params as any;
    await actor(req, companyId, 'viewer');
    const q = req.query as any;
    if (!q.from || !q.to) throw new Error('from and to are required');
    return movementReport(db, companyId, q.from, q.to);
  });
  app.get(`${base}/reconciliation`, async (req) => {
    const { companyId } = req.params as any;
    await actor(req, companyId, 'viewer');
    const asOf = (req.query as any).asOf;
    if (!asOf) throw new Error('asOf is required');
    return reconciliationReport(db, companyId, asOf);
  });
  app.get(`${base}/:id`, async (req) => {
    const { companyId, id } = req.params as any;
    await actor(req, companyId, 'viewer');
    return { provision: await getProvision(db, companyId, id) };
  });
  app.post(base, async (req, reply) => {
    const { companyId } = req.params as any;
    const a = await actor(req, companyId, 'accountant');
    return reply.code(201).send({ provision: await createProvision(db, a, parse(ProvisionBody, req.body)) });
  });
  app.put(`${base}/:id`, async (req) => {
    const { companyId, id } = req.params as any;
    const a = await actor(req, companyId, 'accountant');
    return { provision: await updateProvision(db, a, id, parse(ProvisionBody.partial(), req.body)) };
  });
  app.post(`${base}/:id/movements`, async (req, reply) => {
    const { companyId, id } = req.params as any;
    const a = await actor(req, companyId, 'accountant');
    return reply.code(201).send(await createMovement(db, a, id, parse(MovementBody, req.body)));
  });
  app.post(`${base}/movements/:movementId/approve`, async (req) => {
    const { companyId, movementId } = req.params as any;
    const a = await actor(req, companyId, 'manager');
    return { provision: await approveMovement(db, a, movementId, parse(DecisionSchema, req.body)) };
  });
  app.post(`${base}/movements/:movementId/reject`, async (req) => {
    const { companyId, movementId } = req.params as any;
    const a = await actor(req, companyId, 'manager');
    const body = parse(z.object({ reason: z.string().trim().min(1).max(1000) }), req.body);
    return { provision: await rejectMovement(db, a, movementId, body.reason) };
  });
  app.post(`${base}/movements/:movementId/post`, async (req) => {
    const { companyId, movementId } = req.params as any;
    const a = await actor(req, companyId, 'manager');
    return postMovement(db, a, movementId);
  });
}
