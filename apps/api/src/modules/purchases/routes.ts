import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../../db/index.js';
import { parse } from '../../lib/http.js';
import { requireCompany } from '../../lib/tenant.js';
import { cabinetForCompanyUser } from '../../lib/cabinets.js';
import {
  allocatePurchasePayment,
  allocateSupplierCredit,
  cancelPurchaseDocument,
  cancelPurchasePayment,
  cancelSupplierCreditAllocation,
  createFixedAssetFromPurchaseLine,
  createPurchaseDocument,
  createPurchasePayment,
  createSupplier,
  getPurchaseDocument,
  getPurchasePayment,
  getSupplier,
  listPurchaseDocumentEvents,
  listPurchaseDocuments,
  listPurchasePayments,
  listSupplierCreditAllocations,
  listSuppliers,
  purchaseDocumentDuplicateCheck,
  purchasesAging,
  purchasesAgingCsv,
  purchasesDashboard,
  supplierBalance,
  supplierDuplicateCheck,
  updatePurchaseDocument,
  updateSupplier,
  validatePurchaseDocument,
} from './service.js';
import { proposeFromPurchase } from './proposals.js';
import { proposePurchaseAllocationReclass } from '../ai/proposals.js';

const DateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const AmountSchema = z.union([z.string().min(1).max(30), z.number()]);
const CurrencySchema = z.string().regex(/^[A-Za-z]{3}$/);
const TaxTreatment = z.enum(['standard', 'zero_rated', 'exempt', 'out_of_scope']);

const SupplierSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    reference: z.string().trim().max(80).nullish(),
    country: z.string().trim().min(2).max(2).optional(),
    addressLine1: z.string().trim().max(300).nullish(),
    addressLine2: z.string().trim().max(300).nullish(),
    city: z.string().trim().max(120).nullish(),
    postcode: z.string().trim().max(20).nullish(),
    contactName: z.string().trim().max(120).nullish(),
    contactPhone: z.string().trim().max(40).nullish(),
    contactEmail: z.string().trim().email().max(180).nullish(),
    registrationNumber: z.string().trim().max(80).nullish(),
    taxNumber: z.string().trim().max(80).nullish(),
    preferredCurrency: CurrencySchema.nullish(),
    paymentTermsDays: z.number().int().min(0).max(365).nullish(),
    payableAccountId: z.string().uuid().nullish(),
    notes: z.string().trim().max(2000).nullish(),
    isActive: z.boolean().optional(),
  })
  .strict();

const SupplierPatchSchema = SupplierSchema.partial().strict();

const LineSchema = z
  .object({
    description: z.string().trim().min(1).max(500),
    quantity: AmountSchema,
    unitPrice: AmountSchema,
    accountId: z.string().uuid(),
    vatTreatment: TaxTreatment.optional(),
    vatRateId: z.string().uuid().nullish(),
    vatRecoverable: z.boolean().nullish(),
  })
  .strict();

const DocumentSchema = z
  .object({
    kind: z.enum(['invoice', 'credit_note']),
    supplierId: z.string().uuid(),
    supplierReference: z.string().trim().min(1).max(120),
    issueDate: DateSchema,
    receivedDate: DateSchema.nullish(),
    dueDate: DateSchema.nullish(),
    currency: CurrencySchema,
    exchangeRate: AmountSchema.nullish(),
    description: z.string().trim().max(2000).nullish(),
    reason: z.string().trim().max(1000).nullish(),
    sourceDocumentId: z.string().uuid().nullish(),
    lines: z.array(LineSchema).min(1).max(200),
  })
  .strict();

const PaymentSchema = z
  .object({
    supplierId: z.string().uuid(),
    kind: z.enum(['payment', 'advance']).optional(),
    paymentDate: DateSchema,
    valueDate: DateSchema.nullish(),
    amount: AmountSchema,
    currency: CurrencySchema,
    exchangeRate: AmountSchema.nullish(),
    method: z.enum(['bank_transfer', 'cheque', 'cash', 'card', 'other']).optional(),
    reference: z.string().trim().max(120).nullish(),
    allocations: z
      .array(z.object({ invoiceId: z.string().uuid(), amount: AmountSchema }).strict())
      .max(100)
      .optional(),
  })
  .strict();

const ReasonSchema = z.object({ reason: z.string().trim().min(1).max(1000) }).strict();
const CreditAllocationSchema = z
  .object({
    invoiceId: z.string().uuid(),
    amount: AmountSchema,
    confirm: z.literal(true),
    reason: z.string().trim().max(1000).nullish(),
  })
  .strict();

function bool(value: unknown): boolean | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  return value === true || value === 'true' || value === '1';
}

export function purchaseRoutes(app: FastifyInstance, db: Db) {
  // ------------------------------------------------------------------ dashboard
  app.get('/companies/:companyId/purchases/dashboard', async (req) => {
    const user = req.user!;
    const { companyId } = req.params as { companyId: string };
    await requireCompany(db, user.id, companyId, 'viewer', 'accounting');
    return { dashboard: await purchasesDashboard(db, companyId) };
  });

  // ------------------------------------------------------------------ suppliers
  app.get('/companies/:companyId/purchases/suppliers', async (req) => {
    const user = req.user!;
    const { companyId } = req.params as { companyId: string };
    await requireCompany(db, user.id, companyId, 'viewer', 'accounting');
    const query = req.query as Record<string, string | undefined>;
    return {
      suppliers: await listSuppliers(db, companyId, {
        search: query.search,
        includeInactive: bool(query.includeInactive) === true,
        limit: query.limit ? Number(query.limit) : undefined,
      }),
    };
  });

  app.post('/companies/:companyId/purchases/suppliers', async (req, reply) => {
    const user = req.user!;
    const { companyId } = req.params as { companyId: string };
    await requireCompany(db, user.id, companyId, 'accountant', 'accounting');
    const input = parse(SupplierSchema, req.body);
    const supplier = await createSupplier(db, companyId, user.id, input);
    return reply.code(201).send({ supplier });
  });

  app.post('/companies/:companyId/purchases/suppliers/duplicates/check', async (req) => {
    const user = req.user!;
    const { companyId } = req.params as { companyId: string };
    await requireCompany(db, user.id, companyId, 'viewer', 'accounting');
    const input = parse(
      z
        .object({
          name: z.string().trim().max(200).optional(),
          reference: z.string().trim().max(80).nullish(),
          registrationNumber: z.string().trim().max(80).nullish(),
          excludeId: z.string().uuid().nullish(),
        })
        .strict(),
      req.body,
    );
    return supplierDuplicateCheck(db, companyId, input);
  });

  app.get('/companies/:companyId/purchases/suppliers/:supplierId', async (req) => {
    const user = req.user!;
    const { companyId, supplierId } = req.params as { companyId: string; supplierId: string };
    await requireCompany(db, user.id, companyId, 'viewer', 'accounting');
    const supplier = await getSupplier(db, companyId, supplierId);
    return { supplier };
  });

  app.patch('/companies/:companyId/purchases/suppliers/:supplierId', async (req) => {
    const user = req.user!;
    const { companyId, supplierId } = req.params as { companyId: string; supplierId: string };
    await requireCompany(db, user.id, companyId, 'accountant', 'accounting');
    const input = parse(SupplierPatchSchema, req.body);
    return { supplier: await updateSupplier(db, companyId, user.id, supplierId, input) };
  });

  app.get('/companies/:companyId/purchases/suppliers/:supplierId/balance', async (req) => {
    const user = req.user!;
    const { companyId, supplierId } = req.params as { companyId: string; supplierId: string };
    await requireCompany(db, user.id, companyId, 'viewer', 'accounting');
    const query = req.query as Record<string, string | undefined>;
    return supplierBalance(db, companyId, supplierId, query.asOf);
  });

  app.get('/companies/:companyId/purchases/suppliers/:supplierId/history', async (req) => {
    const user = req.user!;
    const { companyId, supplierId } = req.params as { companyId: string; supplierId: string };
    await requireCompany(db, user.id, companyId, 'viewer', 'accounting');
    await getSupplier(db, companyId, supplierId);
    const documents = await listPurchaseDocuments(db, companyId, { supplierId, limit: 200 });
    const payments = await listPurchasePayments(db, companyId, { supplierId, limit: 200 });
    return { documents, payments };
  });

  // ------------------------------------------------------------------ documents
  app.get('/companies/:companyId/purchases/documents', async (req) => {
    const user = req.user!;
    const { companyId } = req.params as { companyId: string };
    await requireCompany(db, user.id, companyId, 'viewer', 'accounting');
    const query = req.query as Record<string, string | undefined>;
    return {
      documents: await listPurchaseDocuments(db, companyId, {
        kind: query.kind === 'invoice' || query.kind === 'credit_note' ? query.kind : undefined,
        supplierId: query.supplierId,
        status: query.status,
        from: query.from,
        to: query.to,
        currency: query.currency,
        dueOnly: bool(query.dueOnly) === true,
        limit: query.limit ? Number(query.limit) : undefined,
      }),
    };
  });

  app.post('/companies/:companyId/purchases/documents/duplicates/check', async (req) => {
    const user = req.user!;
    const { companyId } = req.params as { companyId: string };
    await requireCompany(db, user.id, companyId, 'viewer', 'accounting');
    const input = parse(
      z
        .object({
          supplierId: z.string().uuid(),
          supplierReference: z.string().trim().min(1).max(120),
          kind: z.enum(['invoice', 'credit_note']).optional(),
          total: AmountSchema.nullish(),
          issueDate: DateSchema.nullish(),
          excludeId: z.string().uuid().nullish(),
        })
        .strict(),
      req.body,
    );
    return purchaseDocumentDuplicateCheck(db, companyId, {
      ...input,
      total: input.total === null || input.total === undefined ? null : String(input.total),
    });
  });

  app.post('/companies/:companyId/purchases/documents', async (req, reply) => {
    const user = req.user!;
    const { companyId } = req.params as { companyId: string };
    await requireCompany(db, user.id, companyId, 'accountant', 'accounting');
    const input = parse(DocumentSchema, req.body);
    const document = await createPurchaseDocument(db, companyId, user.id, input);
    return reply.code(201).send({ document });
  });

  app.get('/companies/:companyId/purchases/documents/:documentId', async (req) => {
    const user = req.user!;
    const { companyId, documentId } = req.params as { companyId: string; documentId: string };
    await requireCompany(db, user.id, companyId, 'viewer', 'accounting');
    return { document: await getPurchaseDocument(db, companyId, documentId) };
  });

  app.patch('/companies/:companyId/purchases/documents/:documentId', async (req) => {
    const user = req.user!;
    const { companyId, documentId } = req.params as { companyId: string; documentId: string };
    await requireCompany(db, user.id, companyId, 'accountant', 'accounting');
    const input = parse(DocumentSchema, req.body);
    return { document: await updatePurchaseDocument(db, companyId, user.id, documentId, input) };
  });

  app.post('/companies/:companyId/purchases/documents/:documentId/validate', async (req) => {
    const user = req.user!;
    const { companyId, documentId } = req.params as { companyId: string; documentId: string };
    await requireCompany(db, user.id, companyId, 'accountant', 'accounting');
    return { document: await validatePurchaseDocument(db, companyId, user.id, documentId) };
  });

  app.post('/companies/:companyId/purchases/documents/:documentId/cancel', async (req) => {
    const user = req.user!;
    const { companyId, documentId } = req.params as { companyId: string; documentId: string };
    await requireCompany(db, user.id, companyId, 'accountant', 'accounting');
    const input = parse(ReasonSchema, req.body);
    return { document: await cancelPurchaseDocument(db, companyId, user.id, documentId, input.reason) };
  });

  app.get('/companies/:companyId/purchases/documents/:documentId/events', async (req) => {
    const user = req.user!;
    const { companyId, documentId } = req.params as { companyId: string; documentId: string };
    await requireCompany(db, user.id, companyId, 'viewer', 'accounting');
    return { events: await listPurchaseDocumentEvents(db, companyId, documentId) };
  });

  app.post(
    '/companies/:companyId/purchases/documents/:documentId/lines/:lineId/fixed-asset',
    async (req, reply) => {
      const user = req.user!;
      const { companyId, documentId, lineId } = req.params as {
        companyId: string;
        documentId: string;
        lineId: string;
      };
      await requireCompany(db, user.id, companyId, 'accountant', 'accounting');
      const input = parse(
        z
          .object({
            categoryId: z.string().uuid(),
            description: z.string().trim().min(3).max(300).nullish(),
            serialNumber: z.string().trim().max(120).nullish(),
            location: z.string().trim().max(120).nullish(),
            inServiceDate: DateSchema.nullish(),
            usefulLifeMonths: z.number().int().positive().max(1200).nullish(),
            method: z.enum(['straight_line', 'reducing_balance']).nullish(),
            residualValue: AmountSchema.nullish(),
            notes: z.string().trim().max(1000).nullish(),
          })
          .strict(),
        req.body,
      );
      const result = await createFixedAssetFromPurchaseLine(
        db,
        companyId,
        user.id,
        documentId,
        lineId,
        input,
      );
      return reply.code(201).send(result);
    },
  );

  app.get('/companies/:companyId/purchases/documents/:documentId/credit-allocations', async (req) => {
    const user = req.user!;
    const { companyId, documentId } = req.params as { companyId: string; documentId: string };
    await requireCompany(db, user.id, companyId, 'viewer', 'accounting');
    await getPurchaseDocument(db, companyId, documentId);
    return { allocations: await listSupplierCreditAllocations(db, companyId, documentId) };
  });

  app.post('/companies/:companyId/purchases/documents/:documentId/proposal', async (req, reply) => {
    const user = req.user!;
    const { companyId, documentId } = req.params as { companyId: string; documentId: string };
    await requireCompany(db, user.id, companyId, 'accountant', 'accounting');
    const { cabinetId } = await cabinetForCompanyUser(db, companyId, user.id);
    const result = await proposeFromPurchase(db, {
      cabinetId,
      companyId,
      userId: user.id,
      documentId,
    });
    return reply.code(result.reused ? 200 : 201).send(result);
  });

  // ------------------------------------------------------------------ credit allocations
  app.post('/companies/:companyId/purchases/credit-notes/:creditNoteId/allocations', async (req, reply) => {
    const user = req.user!;
    const { companyId, creditNoteId } = req.params as { companyId: string; creditNoteId: string };
    await requireCompany(db, user.id, companyId, 'accountant', 'accounting');
    const input = parse(CreditAllocationSchema, req.body);
    const result = await allocateSupplierCredit(
      db,
      companyId,
      user.id,
      creditNoteId,
      input.invoiceId,
      input.amount,
      input.reason ?? null,
    );
    return reply.code(201).send(result);
  });

  app.delete(
    '/companies/:companyId/purchases/credit-notes/:creditNoteId/allocations/:allocationId',
    async (req) => {
      const user = req.user!;
      const { companyId, allocationId } = req.params as {
        companyId: string;
        creditNoteId: string;
        allocationId: string;
      };
      await requireCompany(db, user.id, companyId, 'accountant', 'accounting');
      const input = parse(ReasonSchema, req.body);
      return cancelSupplierCreditAllocation(db, companyId, user.id, allocationId, input.reason);
    },
  );

  // ------------------------------------------------------------------ payments
  app.get('/companies/:companyId/purchases/payments', async (req) => {
    const user = req.user!;
    const { companyId } = req.params as { companyId: string };
    await requireCompany(db, user.id, companyId, 'viewer', 'accounting');
    const query = req.query as Record<string, string | undefined>;
    return {
      payments: await listPurchasePayments(db, companyId, {
        supplierId: query.supplierId,
        status: query.status,
        from: query.from,
        to: query.to,
        limit: query.limit ? Number(query.limit) : undefined,
      }),
    };
  });

  app.post('/companies/:companyId/purchases/payments', async (req, reply) => {
    const user = req.user!;
    const { companyId } = req.params as { companyId: string };
    await requireCompany(db, user.id, companyId, 'accountant', 'accounting');
    const input = parse(PaymentSchema, req.body);
    const payment = await createPurchasePayment(db, companyId, user.id, input);
    return reply.code(201).send({ payment });
  });

  app.get('/companies/:companyId/purchases/payments/:paymentId', async (req) => {
    const user = req.user!;
    const { companyId, paymentId } = req.params as { companyId: string; paymentId: string };
    await requireCompany(db, user.id, companyId, 'viewer', 'accounting');
    return { payment: await getPurchasePayment(db, companyId, paymentId) };
  });

  app.post('/companies/:companyId/purchases/payments/:paymentId/allocations', async (req, reply) => {
    const user = req.user!;
    const { companyId, paymentId } = req.params as { companyId: string; paymentId: string };
    await requireCompany(db, user.id, companyId, 'accountant', 'accounting');
    const input = parse(
      z
        .object({
          invoiceId: z.string().uuid(),
          amount: AmountSchema,
          allocationDate: DateSchema.optional(),
          reason: z.string().trim().max(1000).nullish(),
          confirm: z.literal(true),
        })
        .strict(),
      req.body,
    );
    const result = await allocatePurchasePayment(db, companyId, user.id, paymentId, input);
    return reply.code(201).send({
      ...result,
      note: result.reclassRequired
        ? 'The payment is already posted: prepare the separate prepayment-to-payable reclassification before closing the period.'
        : 'The payment is allocated; no purchase amount or VAT amount was changed.',
    });
  });

  app.post('/companies/:companyId/purchases/payments/:paymentId/cancel', async (req) => {
    const user = req.user!;
    const { companyId, paymentId } = req.params as { companyId: string; paymentId: string };
    await requireCompany(db, user.id, companyId, 'accountant', 'accounting');
    const input = parse(ReasonSchema, req.body);
    return { payment: await cancelPurchasePayment(db, companyId, user.id, paymentId, input.reason) };
  });

  app.post('/companies/:companyId/purchases/payments/:paymentId/proposal', async (req, reply) => {
    const user = req.user!;
    const { companyId, paymentId } = req.params as { companyId: string; paymentId: string };
    await requireCompany(db, user.id, companyId, 'accountant', 'accounting');
    const { cabinetId } = await cabinetForCompanyUser(db, companyId, user.id);
    const result = await proposeFromPurchase(db, {
      cabinetId,
      companyId,
      userId: user.id,
      paymentId,
    });
    return reply.code(result.reused ? 200 : 201).send(result);
  });

  // ------------------------------------------------------------------ reports
  app.post(
    '/companies/:companyId/purchases/payments/:paymentId/allocations/:allocationId/reclass-proposal',
    async (req, reply) => {
      const user = req.user!;
      const { companyId, allocationId } = req.params as {
        companyId: string;
        paymentId: string;
        allocationId: string;
      };
      await requireCompany(db, user.id, companyId, 'accountant', 'accounting');
      const { cabinetId } = await cabinetForCompanyUser(db, companyId, user.id);
      const result = await proposePurchaseAllocationReclass(db, {
        cabinetId,
        companyId,
        userId: user.id,
        allocationId,
      });
      return reply.code(result.reused ? 200 : 201).send({ ...result, entryCreated: false });
    },
  );

  app.get('/companies/:companyId/purchases/aging', async (req) => {
    const user = req.user!;
    const { companyId } = req.params as { companyId: string };
    await requireCompany(db, user.id, companyId, 'viewer', 'accounting');
    const query = req.query as Record<string, string | undefined>;
    return {
      aging: await purchasesAging(db, companyId, {
        asOf: query.asOf,
        supplierId: query.supplierId,
        currency: query.currency,
        includeDetail: bool(query.detail) !== false,
      }),
    };
  });

  app.get('/companies/:companyId/purchases/aging.csv', async (req, reply) => {
    const user = req.user!;
    const { companyId } = req.params as { companyId: string };
    await requireCompany(db, user.id, companyId, 'viewer', 'accounting');
    const query = req.query as Record<string, string | undefined>;
    const report = await purchasesAging(db, companyId, {
      asOf: query.asOf,
      supplierId: query.supplierId,
      currency: query.currency,
      includeDetail: true,
    });
    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', 'attachment; filename="dettes-fournisseurs.csv"')
      .send(purchasesAgingCsv(report));
  });
}
