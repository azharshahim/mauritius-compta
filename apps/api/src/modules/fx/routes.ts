import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../../db/index.js';
import { parse } from '../../lib/http.js';
import { requireCompany } from '../../lib/tenant.js';
import { forbidden } from '../../lib/errors.js';
import {
  createFxRate,
  explainConversion,
  fxReport,
  fxReportCsv,
  getFxConfiguration,
  getRevaluation,
  listFxRates,
  listRealizedAdjustments,
  listRevaluations,
  listTransfers,
  postRealizedAdjustment,
  postRevaluation,
  postTransfer,
  previewTransfer,
  rejectFxRate,
  rejectRealizedAdjustment,
  resolveFxRate,
  scanRealizedAdjustments,
  simulateRevaluation,
  updateFxConfiguration,
  validateFxRate,
  validateRevaluation,
} from './service.js';

const AmountSchema = z.union([z.string().min(1).max(30), z.number()]);
const DateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const CurrencySchema = z.string().length(3).transform((v) => v.toUpperCase());

export function fxRoutes(app: FastifyInstance, db: Db) {
  // ------------------------------------------------------------- configuration
  app.get('/companies/:companyId/fx/config', async (req) => {
    const user = req.user!;
    const { companyId } = req.params as { companyId: string };
    await requireCompany(db, user.id, companyId, 'viewer', 'accounting');
    return getFxConfiguration(db, companyId);
  });

  app.patch('/companies/:companyId/fx/config', async (req) => {
    const user = req.user!;
    const { companyId } = req.params as { companyId: string };
    const ctx = await requireCompany(db, user.id, companyId, 'accountant', 'accounting');
    if (!['admin', 'owner', 'cabinet_admin', 'accountant'].includes(ctx.role)) {
      throw forbidden('FX configuration requires an accounting role', 'FORBIDDEN');
    }
    // Allowed currencies and the functional lock are dossier-admin actions.
    const body = parse(
      z
        .object({
          allowedCurrencies: z.array(CurrencySchema).max(20).optional(),
          fxGainAccountId: z.string().uuid().nullable().optional(),
          fxLossAccountId: z.string().uuid().nullable().optional(),
          valuationEnabled: z.boolean().optional(),
          notes: z.string().max(2000).nullable().optional(),
          lockFunctional: z.boolean().optional(),
        })
        .strict(),
      req.body,
    );
    if ((body.allowedCurrencies !== undefined || body.lockFunctional) &&
        !['admin', 'owner', 'cabinet_admin'].includes(ctx.role)) {
      throw forbidden('Only a dossier administrator can change allowed currencies or lock the functional currency', 'FORBIDDEN');
    }
    return {
      settings: await updateFxConfiguration(db, { companyId, userId: user.id, ip: req.ip }, body),
    };
  });

  // --------------------------------------------------------------------- rates
  app.get('/companies/:companyId/fx/rates', async (req) => {
    const user = req.user!;
    const { companyId } = req.params as { companyId: string };
    await requireCompany(db, user.id, companyId, 'viewer', 'accounting');
    const q = req.query as Record<string, string | undefined>;
    return {
      rates: await listFxRates(db, companyId, {
        base: q.base,
        quote: q.quote,
        date: q.date,
        status: q.status,
        limit: q.limit ? Number(q.limit) : undefined,
      }),
    };
  });

  app.post('/companies/:companyId/fx/rates', async (req, reply) => {
    const user = req.user!;
    const { companyId } = req.params as { companyId: string };
    await requireCompany(db, user.id, companyId, 'accountant', 'accounting');
    const body = parse(
      z
        .object({
          baseCurrency: CurrencySchema,
          quoteCurrency: CurrencySchema,
          rateDate: DateSchema,
          rate: AmountSchema,
          sourceKind: z.enum(['manual', 'imported', 'demo']),
          source: z.string().trim().min(1).max(200),
          reference: z.string().trim().max(200).nullish(),
        })
        .strict(),
      req.body,
    );
    const rate = await createFxRate(db, { companyId, userId: user.id, ip: req.ip }, body);
    return reply.code(201).send({ rate });
  });

  app.post('/companies/:companyId/fx/rates/:rateId/validate', async (req) => {
    const user = req.user!;
    const { companyId, rateId } = req.params as { companyId: string; rateId: string };
    await requireCompany(db, user.id, companyId, 'accountant', 'accounting');
    const body = parse(
      z
        .object({
          note: z.string().trim().max(1000).nullish(),
          supersede: z.boolean().optional(),
          confirm: z.literal(true),
        })
        .strict(),
      req.body,
    );
    return {
      rate: await validateFxRate(db, { companyId, userId: user.id, ip: req.ip }, rateId, body),
    };
  });

  app.post('/companies/:companyId/fx/rates/:rateId/reject', async (req) => {
    const user = req.user!;
    const { companyId, rateId } = req.params as { companyId: string; rateId: string };
    await requireCompany(db, user.id, companyId, 'accountant', 'accounting');
    const body = parse(z.object({ reason: z.string().trim().min(1).max(1000) }).strict(), req.body);
    return {
      rate: await rejectFxRate(db, { companyId, userId: user.id, ip: req.ip }, rateId, body.reason),
    };
  });

  app.get('/companies/:companyId/fx/resolve', async (req) => {
    const user = req.user!;
    const { companyId } = req.params as { companyId: string };
    await requireCompany(db, user.id, companyId, 'viewer', 'accounting');
    const q = req.query as Record<string, string | undefined>;
    const body = parse(
      z
        .object({
          amount: AmountSchema,
          from: CurrencySchema,
          to: CurrencySchema,
          date: DateSchema,
        })
        .strict(),
      q,
    );
    // `resolveFxRate` is called inside explainConversion: a missing/validated
    // distinction is therefore visible to the UI instead of a silent 1:1.
    return explainConversion(db, companyId, body);
  });

  // ------------------------------------------------------- realized differences
  app.get('/companies/:companyId/fx/realized', async (req) => {
    const user = req.user!;
    const { companyId } = req.params as { companyId: string };
    await requireCompany(db, user.id, companyId, 'viewer', 'accounting');
    const q = req.query as Record<string, string | undefined>;
    return {
      adjustments: await listRealizedAdjustments(db, companyId, {
        status: q.status,
        currency: q.currency,
        limit: q.limit ? Number(q.limit) : undefined,
      }),
    };
  });

  app.post('/companies/:companyId/fx/realized/scan', async (req) => {
    const user = req.user!;
    const { companyId } = req.params as { companyId: string };
    await requireCompany(db, user.id, companyId, 'accountant', 'accounting');
    return scanRealizedAdjustments(db, { companyId, userId: user.id, ip: req.ip });
  });

  app.post('/companies/:companyId/fx/realized/:adjustmentId/post', async (req) => {
    const user = req.user!;
    const { companyId, adjustmentId } = req.params as { companyId: string; adjustmentId: string };
    await requireCompany(db, user.id, companyId, 'accountant', 'accounting');
    const body = parse(z.object({ confirm: z.literal(true) }).strict(), req.body);
    return postRealizedAdjustment(
      db,
      { companyId, userId: user.id, ip: req.ip },
      adjustmentId,
      body.confirm,
    );
  });

  app.post('/companies/:companyId/fx/realized/:adjustmentId/reject', async (req) => {
    const user = req.user!;
    const { companyId, adjustmentId } = req.params as { companyId: string; adjustmentId: string };
    await requireCompany(db, user.id, companyId, 'accountant', 'accounting');
    const body = parse(z.object({ reason: z.string().trim().min(1).max(1000) }).strict(), req.body);
    return {
      adjustment: await rejectRealizedAdjustment(
        db,
        { companyId, userId: user.id, ip: req.ip },
        adjustmentId,
        body.reason,
      ),
    };
  });

  // ------------------------------------------------------- latent revaluations
  app.get('/companies/:companyId/fx/valuations', async (req) => {
    const user = req.user!;
    const { companyId } = req.params as { companyId: string };
    await requireCompany(db, user.id, companyId, 'viewer', 'accounting');
    return { valuations: await listRevaluations(db, companyId) };
  });

  app.get('/companies/:companyId/fx/valuations/:valuationId', async (req) => {
    const user = req.user!;
    const { companyId, valuationId } = req.params as { companyId: string; valuationId: string };
    await requireCompany(db, user.id, companyId, 'viewer', 'accounting');
    return { valuation: await getRevaluation(db, companyId, valuationId) };
  });

  app.post('/companies/:companyId/fx/valuations', async (req, reply) => {
    const user = req.user!;
    const { companyId } = req.params as { companyId: string };
    await requireCompany(db, user.id, companyId, 'accountant', 'accounting');
    const body = parse(
      z
        .object({ valuationDate: DateSchema, note: z.string().trim().max(2000).nullish() })
        .strict(),
      req.body,
    );
    const result = await simulateRevaluation(db, { companyId, userId: user.id, ip: req.ip }, body);
    return reply.code(result.reused ? 200 : 201).send(result);
  });

  app.post('/companies/:companyId/fx/valuations/:valuationId/validate', async (req) => {
    const user = req.user!;
    const { companyId, valuationId } = req.params as { companyId: string; valuationId: string };
    const ctx = await requireCompany(db, user.id, companyId, 'admin', 'accounting');
    if (!['admin', 'owner', 'cabinet_admin'].includes(ctx.role)) {
      throw forbidden('Valuation validation requires a dossier administrator', 'FORBIDDEN');
    }
    const body = parse(
      z.object({ note: z.string().trim().max(2000).nullish(), confirm: z.literal(true) }).strict(),
      req.body,
    );
    return {
      valuation: await validateRevaluation(
        db,
        { companyId, userId: user.id, ip: req.ip },
        valuationId,
        body.note,
      ),
      postingBlocked: true,
    };
  });

  app.post('/companies/:companyId/fx/valuations/:valuationId/post', async (req) => {
    const user = req.user!;
    const { companyId } = req.params as { companyId: string };
    await requireCompany(db, user.id, companyId, 'accountant', 'accounting');
    return postRevaluation();
  });

  // -------------------------------------------------------- internal transfers
  app.get('/companies/:companyId/fx/transfers', async (req) => {
    const user = req.user!;
    const { companyId } = req.params as { companyId: string };
    await requireCompany(db, user.id, companyId, 'viewer', 'accounting');
    return { transfers: await listTransfers(db, companyId) };
  });

  app.post('/companies/:companyId/fx/transfers', async (req, reply) => {
    const user = req.user!;
    const { companyId } = req.params as { companyId: string };
    await requireCompany(db, user.id, companyId, 'accountant', 'accounting');
    const body = parse(
      z
        .object({
          fromBankAccountId: z.string().uuid(),
          toBankAccountId: z.string().uuid(),
          transferDate: DateSchema,
          fromAmount: AmountSchema,
          feeAmount: AmountSchema.nullish(),
          note: z.string().trim().max(2000).nullish(),
        })
        .strict(),
      req.body,
    );
    const result = await previewTransfer(
      db,
      { companyId, userId: user.id, ip: req.ip },
      {
        ...body,
        fromAmount: String(body.fromAmount),
        feeAmount: body.feeAmount === null || body.feeAmount === undefined ? null : String(body.feeAmount),
      },
    );
    return reply.code(201).send(result);
  });

  app.post('/companies/:companyId/fx/transfers/:transferId/post', async (req) => {
    const user = req.user!;
    const { companyId } = req.params as { companyId: string };
    await requireCompany(db, user.id, companyId, 'accountant', 'accounting');
    return postTransfer();
  });

  // ------------------------------------------------------------------- reports
  app.get('/companies/:companyId/fx/report', async (req) => {
    const user = req.user!;
    const { companyId } = req.params as { companyId: string };
    await requireCompany(db, user.id, companyId, 'viewer', 'accounting');
    const q = req.query as Record<string, string | undefined>;
    return {
      report: await fxReport(db, companyId, { valuationDate: q.valuationDate, currency: q.currency }),
    };
  });

  app.get('/companies/:companyId/fx/report.csv', async (req, reply) => {
    const user = req.user!;
    const { companyId } = req.params as { companyId: string };
    await requireCompany(db, user.id, companyId, 'viewer', 'accounting');
    const q = req.query as Record<string, string | undefined>;
    const csv = await fxReportCsv(db, companyId, { valuationDate: q.valuationDate, currency: q.currency });
    reply.header('content-type', 'text/csv; charset=utf-8');
    reply.header('content-disposition', 'attachment; filename="multidevise-rapport.csv"');
    return `\uFEFF${csv}`;
  });
}
