import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../../db/index.js';
import { clientIp, parse, toCsv } from '../../lib/http.js';
import { requireCompany } from '../../lib/tenant.js';
import {
  approveMovement, approveWriteDown, createCategory, createCount, createItem, createLocation,
  createMovement, createTransfer, createWriteDown, generateCountAdjustments, getCount, getMovement,
  listCategories, listCounts, listItems, listLocations, listMovements, listWriteDowns, postMovement,
  postWriteDown, proposeFromBilling, proposeFromPurchase, reconciliationReport, rejectMovement, rejectWriteDown, updateCategory, updateItem,
  updateLocation, valuationReport, type InventoryActor,
} from './service.js';

const Uuid = z.string().uuid();
const DateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Amount = z.union([z.string().max(30), z.number()]).transform<string>((v) => String(v));
const DecisionSchema = z.object({ confirm: z.boolean(), note: z.string().min(1).max(2000) });

const CategorySchema = z.object({
  code: z.string().trim().min(1).max(30), name: z.string().trim().min(2).max(120),
  valuationMethod: z.enum(['fifo', 'weighted_average']),
  inventoryAccountId: Uuid, cogsAccountId: Uuid,
  adjustmentAccountId: Uuid.nullish(), writeDownAccountId: Uuid.nullish(),
  allowNegativeStock: z.boolean().optional(), isActive: z.boolean().optional(),
});
const LocationSchema = z.object({ code: z.string().trim().min(1).max(30), name: z.string().trim().min(2).max(120), description: z.string().max(500).nullish() });
const ItemSchema = z.object({
  categoryId: Uuid, sku: z.string().trim().min(1).max(60), name: z.string().trim().min(2).max(200),
  unit: z.string().trim().max(20).optional(), reorderLevel: Amount.nullish(), isActive: z.boolean().optional(),
});
const MovementSchema = z.object({
  itemId: Uuid, locationId: Uuid, destinationLocationId: Uuid.nullish(),
  movementDate: DateSchema, direction: z.enum(['in', 'out', 'transfer_out', 'adjustment_in', 'adjustment_out']),
  sourceKind: z.enum(['opening', 'receipt', 'issue', 'adjustment', 'count', 'transfer', 'reversal']),
  quantity: Amount, unitCost: Amount.nullish(), reference: z.string().max(120).nullish(),
  description: z.string().trim().min(3).max(500), documentRef: z.string().max(200).nullish(),
  journalId: Uuid, counterpartAccountId: Uuid.nullish(),
});
const CountSchema = z.object({
  locationId: Uuid, countDate: DateSchema, reference: z.string().max(120).nullish(), notes: z.string().max(2000).nullish(),
  lines: z.array(z.object({ itemId: Uuid, countedQuantity: Amount, unitCost: Amount.nullish() })).min(1).max(500),
});
const WriteDownSchema = z.object({
  itemId: Uuid, locationId: Uuid, writeDownDate: DateSchema, amount: Amount,
  reason: z.string().trim().min(5).max(1000), documentRef: z.string().trim().min(2).max(120),
  journalId: Uuid, kind: z.enum(['write_down', 'reversal']).optional(), reversesId: Uuid.nullish(),
});

export function inventoryRoutes(app: FastifyInstance, db: Db) {
  async function actor(req: any, companyId: string, minRole: 'viewer' | 'accountant' | 'manager'): Promise<InventoryActor> {
    const user = req.user!;
    await requireCompany(db, user.id, companyId, minRole, 'accounting');
    return { companyId, userId: user.id, ip: clientIp(req) };
  }
  const base = '/companies/:companyId/inventory';

  // ------------------------------------------------------------- categories
  app.get(`${base}/categories`, async (req) => {
    const { companyId } = req.params as any;
    await actor(req, companyId, 'viewer');
    return { categories: await listCategories(db, companyId) };
  });
  app.post(`${base}/categories`, async (req, reply) => {
    const { companyId } = req.params as any;
    const a = await actor(req, companyId, 'accountant');
    return reply.code(201).send({ category: await createCategory(db, a, parse(CategorySchema, req.body)) });
  });
  app.put(`${base}/categories/:id`, async (req) => {
    const { companyId, id } = req.params as any;
    const a = await actor(req, companyId, 'accountant');
    return { category: await updateCategory(db, a, id, parse(CategorySchema.partial(), req.body)) };
  });

  // -------------------------------------------------------------- locations
  app.get(`${base}/locations`, async (req) => {
    const { companyId } = req.params as any;
    await actor(req, companyId, 'viewer');
    return { locations: await listLocations(db, companyId) };
  });
  app.post(`${base}/locations`, async (req, reply) => {
    const { companyId } = req.params as any;
    const a = await actor(req, companyId, 'accountant');
    return reply.code(201).send({ location: await createLocation(db, a, parse(LocationSchema, req.body)) });
  });
  app.put(`${base}/locations/:id`, async (req) => {
    const { companyId, id } = req.params as any;
    const a = await actor(req, companyId, 'accountant');
    return { location: await updateLocation(db, a, id, parse(LocationSchema.partial().extend({ isActive: z.boolean().optional() }), req.body)) };
  });

  // ------------------------------------------------------------------ items
  app.get(`${base}/items`, async (req) => {
    const { companyId } = req.params as any;
    await actor(req, companyId, 'viewer');
    return { items: await listItems(db, companyId) };
  });
  app.post(`${base}/items`, async (req, reply) => {
    const { companyId } = req.params as any;
    const a = await actor(req, companyId, 'accountant');
    return reply.code(201).send({ item: await createItem(db, a, parse(ItemSchema, req.body)) });
  });
  app.put(`${base}/items/:id`, async (req) => {
    const { companyId, id } = req.params as any;
    const a = await actor(req, companyId, 'accountant');
    return { item: await updateItem(db, a, id, parse(ItemSchema.partial(), req.body)) };
  });

  // -------------------------------------------------------------- movements
  app.get(`${base}/movements`, async (req) => {
    const { companyId } = req.params as any;
    await actor(req, companyId, 'viewer');
    const q = req.query as any;
    return { movements: await listMovements(db, companyId, { from: q.from, to: q.to, itemId: q.itemId, status: q.status }) };
  });
  app.get(`${base}/movements/:id`, async (req) => {
    const { companyId, id } = req.params as any;
    await actor(req, companyId, 'viewer');
    return { movement: await getMovement(db, companyId, id) };
  });
  app.post(`${base}/movements`, async (req, reply) => {
    const { companyId } = req.params as any;
    const a = await actor(req, companyId, 'accountant');
    return reply.code(201).send({ movement: await createMovement(db, a, parse(MovementSchema, req.body)) });
  });
  app.post(`${base}/transfers`, async (req, reply) => {
    const { companyId } = req.params as any;
    const a = await actor(req, companyId, 'accountant');
    const body = parse(MovementSchema.omit({ direction: true, sourceKind: true }).extend({ destinationLocationId: Uuid }), req.body);
    return reply.code(201).send({ movement: await createTransfer(db, a, body as any) });
  });
  const SourceLine = z.object({ itemId: Uuid, locationId: Uuid, quantity: Amount });
  app.post(`${base}/movements/from-purchase/:documentId`, async (req, reply) => {
    const { companyId, documentId } = req.params as any;
    const a = await actor(req, companyId, 'accountant');
    const body = parse(z.object({
      journalId: Uuid,
      lines: z.array(SourceLine.extend({ purchaseLineId: Uuid, unitCost: Amount.nullish() })).min(1).max(200),
    }), req.body);
    return reply.code(201).send(await proposeFromPurchase(db, a, documentId, body));
  });
  app.post(`${base}/movements/from-billing/:documentId`, async (req, reply) => {
    const { companyId, documentId } = req.params as any;
    const a = await actor(req, companyId, 'accountant');
    const body = parse(z.object({ journalId: Uuid,
      lines: z.array(SourceLine.extend({ billingLineId: Uuid })).min(1).max(200) }), req.body);
    return reply.code(201).send(await proposeFromBilling(db, a, documentId, body));
  });
  app.post(`${base}/movements/:id/approve`, async (req) => {
    const { companyId, id } = req.params as any;
    const a = await actor(req, companyId, 'manager');
    return { movement: await approveMovement(db, a, id, parse(DecisionSchema, req.body)) };
  });
  app.post(`${base}/movements/:id/reject`, async (req) => {
    const { companyId, id } = req.params as any;
    const a = await actor(req, companyId, 'manager');
    const body = parse(z.object({ reason: z.string().trim().min(1).max(1000) }), req.body);
    return { movement: await rejectMovement(db, a, id, body.reason) };
  });
  app.post(`${base}/movements/:id/post`, async (req) => {
    const { companyId, id } = req.params as any;
    const a = await actor(req, companyId, 'manager');
    return postMovement(db, a, id);
  });

  // ----------------------------------------------------------------- counts
  app.get(`${base}/counts`, async (req) => {
    const { companyId } = req.params as any;
    await actor(req, companyId, 'viewer');
    return { counts: await listCounts(db, companyId) };
  });
  app.get(`${base}/counts/:id`, async (req) => {
    const { companyId, id } = req.params as any;
    await actor(req, companyId, 'viewer');
    return { count: await getCount(db, companyId, id) };
  });
  app.post(`${base}/counts`, async (req, reply) => {
    const { companyId } = req.params as any;
    const a = await actor(req, companyId, 'accountant');
    return reply.code(201).send({ count: await createCount(db, a, parse(CountSchema, req.body)) });
  });
  app.post(`${base}/counts/:id/generate-adjustments`, async (req) => {
    const { companyId, id } = req.params as any;
    const a = await actor(req, companyId, 'accountant');
    return generateCountAdjustments(db, a, id);
  });

  // ------------------------------------------------------------ write-downs
  app.get(`${base}/write-downs`, async (req) => {
    const { companyId } = req.params as any;
    await actor(req, companyId, 'viewer');
    return { writeDowns: await listWriteDowns(db, companyId) };
  });
  app.post(`${base}/write-downs`, async (req, reply) => {
    const { companyId } = req.params as any;
    const a = await actor(req, companyId, 'accountant');
    return reply.code(201).send({ writeDown: await createWriteDown(db, a, parse(WriteDownSchema, req.body)) });
  });
  app.post(`${base}/write-downs/:id/approve`, async (req) => {
    const { companyId, id } = req.params as any;
    const a = await actor(req, companyId, 'manager');
    return { writeDown: await approveWriteDown(db, a, id, parse(DecisionSchema, req.body)) };
  });
  app.post(`${base}/write-downs/:id/reject`, async (req) => {
    const { companyId, id } = req.params as any;
    const a = await actor(req, companyId, 'manager');
    const body = parse(z.object({ reason: z.string().trim().min(1).max(1000) }), req.body);
    return { writeDown: await rejectWriteDown(db, a, id, body.reason) };
  });
  app.post(`${base}/write-downs/:id/post`, async (req) => {
    const { companyId, id } = req.params as any;
    const a = await actor(req, companyId, 'manager');
    return postWriteDown(db, a, id);
  });

  // ---------------------------------------------------------------- reports
  app.get(`${base}/report`, async (req) => {
    const { companyId } = req.params as any;
    await actor(req, companyId, 'viewer');
    return valuationReport(db, companyId, (req.query as any).asOf);
  });
  app.get(`${base}/reconciliation`, async (req) => {
    const { companyId } = req.params as any;
    await actor(req, companyId, 'viewer');
    const asOf = (req.query as any).asOf;
    if (!asOf) throw new Error('asOf is required');
    return reconciliationReport(db, companyId, asOf);
  });
  app.get(`${base}/report.csv`, async (req, reply) => {
    const { companyId } = req.params as any;
    await actor(req, companyId, 'viewer');
    const report = await valuationReport(db, companyId, (req.query as any).asOf);
    const csv = toCsv([
      ['SKU', 'Item', 'Category', 'Method', 'Location', 'Quantity', 'Value', 'Unit cost'],
      ...report.rows.map((r) => [r.sku, r.name, r.category.name, r.category.valuationMethod,
        r.location.code, r.quantity, r.value, r.unitCost]),
    ]);
    reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', 'attachment; filename="inventory.csv"');
    return csv;
  });
}
