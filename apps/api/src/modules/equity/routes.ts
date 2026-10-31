import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../../db/index.js';
import { clientIp, parse } from '../../lib/http.js';
import { requireCompany } from '../../lib/tenant.js';
import { badRequest } from '../../lib/errors.js';
import { parseIsoDate } from '../../lib/dates.js';
import {
  approveAllocation,
  approveClosing,
  approveEquityMovement,
  createEquityMovement,
  deleteEquityMovement,
  equityOverview,
  equityStatement,
  getClosing,
  getAllocation,
  getEquityMovement,
  listClosings,
  listEquityMovements,
  postAllocation,
  postClosing,
  postEquityMovement,
  prepareClosing,
  rejectClosing,
  saveAllocation,
  updateEquityMovement,
  type EquityActor,
} from './service.js';

const DateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const AmountSchema = z.union([z.string().max(30), z.number()]);
const CategorySchema = z.enum(['capital', 'contribution', 'reserve', 'retained_earnings', 'dividend', 'adjustment']);
const DirectionSchema = z.enum(['increase', 'decrease']);
const NatureSchema = z.enum(['retained_earnings', 'reserves', 'dividends', 'other']);
const Uuid = z.string().uuid();

const MovementSchema = z.object({
  movementDate: DateSchema,
  category: CategorySchema,
  direction: DirectionSchema,
  amount: AmountSchema,
  equityAccountId: Uuid,
  counterpartAccountId: Uuid,
  journalId: Uuid,
  description: z.string().min(3).max(500),
  documentRef: z.string().min(2).max(120),
});
const ClosingSchema = z.object({
  periodId: Uuid,
  journalId: Uuid,
  resultAccountId: Uuid,
  nextStartDate: DateSchema.nullish(),
  nextEndDate: DateSchema.nullish(),
});
const DecisionSchema = z.object({
  confirm: z.boolean(),
  note: z.string().min(1).max(2000),
});
const RejectSchema = z.object({ reason: z.string().min(1).max(2000) });
const AllocationSchema = z.object({
  allocationDate: DateSchema,
  journalId: Uuid,
  documentRef: z.string().min(2).max(120),
  decisionDate: DateSchema,
  note: z.string().min(5).max(2000),
  lines: z
    .array(z.object({ nature: NatureSchema, accountId: Uuid, amount: AmountSchema }))
    .min(1)
    .max(20),
});

/**
 * Equity, annual closing and result allocation.
 *
 * Reads need the accounting module at read level. Preparing and drafting needs
 * write level. Approving and posting — which create irreversible accounting
 * entries — require the "manager" role as a second human control.
 */
export function equityRoutes(app: FastifyInstance, db: Db) {
  async function actor(req: any, companyId: string, minRole: 'viewer' | 'accountant' | 'manager'): Promise<EquityActor> {
    const user = req.user!;
    await requireCompany(db, user.id, companyId, minRole, 'accounting');
    return { companyId, userId: user.id, ip: clientIp(req) };
  }

  app.get('/companies/:companyId/equity/overview', async (req) => {
    const { companyId } = req.params as { companyId: string };
    const a = await actor(req, companyId, 'viewer');
    const ctx = await requireCompany(db, a.userId, companyId, 'viewer', 'accounting');
    const query = req.query as Record<string, string | undefined>;
    const from = parseIsoDate(query.from ?? ctx.company.financial_year_start, 'from');
    const to = parseIsoDate(query.to ?? ctx.company.financial_year_end, 'to');
    if (from > to) throw badRequest('INVALID_DATE_RANGE', 'The start date must be before the end date');
    return equityOverview(db, companyId, from, to);
  });

  app.get('/companies/:companyId/equity/statement', async (req) => {
    const { companyId } = req.params as { companyId: string };
    const a = await actor(req, companyId, 'viewer');
    const ctx = await requireCompany(db, a.userId, companyId, 'viewer', 'accounting');
    const query = req.query as Record<string, string | undefined>;
    const from = parseIsoDate(query.from ?? ctx.company.financial_year_start, 'from');
    const to = parseIsoDate(query.to ?? ctx.company.financial_year_end, 'to');
    return equityStatement(db, companyId, from, to);
  });

  // ------------------------------------------------------------ movements
  app.get('/companies/:companyId/equity/movements', async (req) => {
    const { companyId } = req.params as { companyId: string };
    await actor(req, companyId, 'viewer');
    return { movements: await listEquityMovements(db, companyId) };
  });

  app.get('/companies/:companyId/equity/movements/:id', async (req) => {
    const { companyId, id } = req.params as { companyId: string; id: string };
    await actor(req, companyId, 'viewer');
    return { movement: await getEquityMovement(db, companyId, id) };
  });

  app.post('/companies/:companyId/equity/movements', async (req, reply) => {
    const { companyId } = req.params as { companyId: string };
    const a = await actor(req, companyId, 'accountant');
    const body = parse(MovementSchema, req.body);
    const movement = await createEquityMovement(db, a, body);
    return reply.code(201).send({ movement });
  });

  app.patch('/companies/:companyId/equity/movements/:id', async (req) => {
    const { companyId, id } = req.params as { companyId: string; id: string };
    const a = await actor(req, companyId, 'accountant');
    const body = parse(MovementSchema, req.body);
    return { movement: await updateEquityMovement(db, a, id, body) };
  });

  app.delete('/companies/:companyId/equity/movements/:id', async (req) => {
    const { companyId, id } = req.params as { companyId: string; id: string };
    const a = await actor(req, companyId, 'accountant');
    return deleteEquityMovement(db, a, id);
  });

  app.post('/companies/:companyId/equity/movements/:id/approve', async (req) => {
    const { companyId, id } = req.params as { companyId: string; id: string };
    const a = await actor(req, companyId, 'manager');
    const body = parse(DecisionSchema, req.body);
    return { movement: await approveEquityMovement(db, a, id, body) };
  });

  app.post('/companies/:companyId/equity/movements/:id/post', async (req) => {
    const { companyId, id } = req.params as { companyId: string; id: string };
    const a = await actor(req, companyId, 'manager');
    return postEquityMovement(db, a, id);
  });

  // -------------------------------------------------------------- closings
  app.get('/companies/:companyId/equity/closings', async (req) => {
    const { companyId } = req.params as { companyId: string };
    await actor(req, companyId, 'viewer');
    return { closings: await listClosings(db, companyId) };
  });

  app.get('/companies/:companyId/equity/closings/:id', async (req) => {
    const { companyId, id } = req.params as { companyId: string; id: string };
    await actor(req, companyId, 'viewer');
    return { closing: await getClosing(db, companyId, id) };
  });

  app.post('/companies/:companyId/equity/closings', async (req, reply) => {
    const { companyId } = req.params as { companyId: string };
    const a = await actor(req, companyId, 'accountant');
    const body = parse(ClosingSchema, req.body);
    const closing = await prepareClosing(db, a, body.periodId, body);
    return reply.code(201).send({ closing });
  });

  app.post('/companies/:companyId/equity/closings/:id/approve', async (req) => {
    const { companyId, id } = req.params as { companyId: string; id: string };
    const a = await actor(req, companyId, 'manager');
    const body = parse(DecisionSchema, req.body);
    return { closing: await approveClosing(db, a, id, body) };
  });

  app.post('/companies/:companyId/equity/closings/:id/reject', async (req) => {
    const { companyId, id } = req.params as { companyId: string; id: string };
    const a = await actor(req, companyId, 'manager');
    const body = parse(RejectSchema, req.body);
    return { closing: await rejectClosing(db, a, id, body) };
  });

  app.post('/companies/:companyId/equity/closings/:id/post', async (req) => {
    const { companyId, id } = req.params as { companyId: string; id: string };
    const a = await actor(req, companyId, 'manager');
    return postClosing(db, a, id);
  });

  // ------------------------------------------------------------ allocation
  app.get('/companies/:companyId/equity/closings/:id/allocation', async (req) => {
    const { companyId, id } = req.params as { companyId: string; id: string };
    await actor(req, companyId, 'viewer');
    return { allocation: await getAllocation(db, companyId, id) };
  });

  app.put('/companies/:companyId/equity/closings/:id/allocation', async (req) => {
    const { companyId, id } = req.params as { companyId: string; id: string };
    const a = await actor(req, companyId, 'accountant');
    const body = parse(AllocationSchema, req.body);
    return { allocation: await saveAllocation(db, a, id, body) };
  });

  app.post('/companies/:companyId/equity/closings/:id/allocation/approve', async (req) => {
    const { companyId, id } = req.params as { companyId: string; id: string };
    const a = await actor(req, companyId, 'manager');
    const body = parse(DecisionSchema, req.body);
    return { allocation: await approveAllocation(db, a, id, body) };
  });

  app.post('/companies/:companyId/equity/closings/:id/allocation/post', async (req) => {
    const { companyId, id } = req.params as { companyId: string; id: string };
    const a = await actor(req, companyId, 'manager');
    return postAllocation(db, a, id);
  });
}
