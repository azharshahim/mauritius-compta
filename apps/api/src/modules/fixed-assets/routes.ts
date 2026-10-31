import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../../db/index.js';
import { clientIp, parse, toCsv } from '../../lib/http.js';
import { requireCompany } from '../../lib/tenant.js';
import { badRequest } from '../../lib/errors.js';
import { parseIsoDate } from '../../lib/dates.js';
import { formatAmount } from '../../lib/money.js';
import { t, type Locale } from '../../i18n/index.js';
import {
  activateAsset, assetSchedule, createAsset, createCategory, getAsset, listAssets, listCategories,
  resumeAsset, reviseEstimate, suspendAsset, updateAsset, updateCategory, type AssetActor,
} from './service.js';
import {
  approveBatch, approveProposal, createBatch, createProposal, deleteBatch, getBatch, getProposal,
  listBatches, listProposals, postBatch, postProposal, previewDepreciation, rejectProposal,
} from './accounting.js';
import {
  accumulatedReport, additionsDisposalsReport, movementScheduleReport, nbvReport,
  reconciliationReport, registerReport, scheduleReport,
} from './reports.js';
import { fixedAssetPdf } from './pdf.js';

const DateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Amount = z.union([z.string().max(30), z.number()]).transform<string>((value) => String(value));
const Uuid = z.string().uuid();
const Method = z.enum(['straight_line', 'reducing_balance']);

const CategorySchema = z.object({
  code: z.string().min(1).max(20),
  nameEn: z.string().min(2).max(120),
  nameFr: z.string().min(2).max(120),
  isDepreciable: z.boolean().optional(),
  defaultMethod: Method.nullish(),
  defaultUsefulLifeMonths: z.number().int().positive().max(1200).nullish(),
  defaultResidualValue: Amount.nullish(),
  defaultReducingRate: Amount.nullish(),
  assetAccountId: Uuid.nullish(),
  accumulatedDepreciationAccountId: Uuid.nullish(),
  depreciationExpenseAccountId: Uuid.nullish(),
  accumulatedImpairmentAccountId: Uuid.nullish(),
  impairmentLossAccountId: Uuid.nullish(),
  impairmentReversalAccountId: Uuid.nullish(),
  disposalGainAccountId: Uuid.nullish(),
  disposalLossAccountId: Uuid.nullish(),
  cwipAccountId: Uuid.nullish(),
  isActive: z.boolean().optional(),
});

const AssetSchema = z.object({
  assetCode: z.string().max(40).nullish(),
  categoryId: Uuid,
  description: z.string().min(3).max(300),
  serialNumber: z.string().max(120).nullish(),
  location: z.string().max(200).nullish(),
  acquisitionDate: DateSchema,
  inServiceDate: DateSchema.nullish(),
  supplierName: z.string().max(200).nullish(),
  invoiceRef: z.string().max(120).nullish(),
  documentRef: z.string().max(200).nullish(),
  cost: Amount,
  attributableCosts: Amount.nullish(),
  residualValue: Amount.nullish(),
  currency: z.string().length(3).optional(),
  exchangeRate: Amount.nullish(),
  fxNote: z.string().max(500).nullish(),
  method: Method.nullish(),
  usefulLifeMonths: z.number().int().positive().max(1200).nullish(),
  reducingRate: Amount.nullish(),
  depreciationStartDate: DateSchema.nullish(),
  responsibleUserId: Uuid.nullish(),
  notes: z.string().max(2000).nullish(),
});
const AssetPatchSchema = AssetSchema.partial();

const ActivateSchema = z.object({
  inServiceDate: DateSchema,
  depreciationStartDate: DateSchema.nullish(),
  method: Method,
  usefulLifeMonths: z.number().int().positive().max(1200),
  residualValue: Amount.optional(),
  reducingRate: Amount.nullish(),
  reason: z.string().max(500).optional(),
});
const RevisionSchema = z.object({
  effectiveFrom: DateSchema,
  method: Method,
  usefulLifeMonths: z.number().int().positive().max(1200),
  residualValue: Amount,
  reducingRate: Amount.nullish(),
  reason: z.string().min(10).max(1000),
});
const SuspendSchema = z.object({ from: DateSchema, reason: z.string().min(10).max(1000) });
const ResumeSchema = z.object({ from: DateSchema, reason: z.string().max(1000).optional() });
const DecisionSchema = z.object({ confirm: z.boolean(), note: z.string().min(10).max(2000) });
const RejectSchema = z.object({ reason: z.string().min(10).max(2000) });

const ProposalSchema = z.object({
  kind: z.enum(['acquisition', 'cwip', 'commissioning', 'impairment', 'impairment_reversal', 'disposal', 'write_off', 'reclassification']),
  eventDate: DateSchema,
  journalId: Uuid,
  reference: z.string().min(2).max(80),
  description: z.string().max(500).optional(),
  counterpartyAccountId: Uuid.optional(),
  proceedsAmount: Amount.optional(),
  proceedsAccountId: Uuid.optional(),
  sellingCosts: Amount.optional(),
  impairmentAmount: Amount.optional(),
  impairmentReason: z.string().max(1000).optional(),
  fromAccountId: Uuid.optional(),
  toAccountId: Uuid.optional(),
  reclassAmount: Amount.optional(),
  targetCategoryId: Uuid.optional(),
  inServiceDate: DateSchema.optional(),
  method: Method.optional(),
  usefulLifeMonths: z.number().int().positive().max(1200).optional(),
  residualValue: Amount.optional(),
  reducingRate: Amount.optional(),
});

const BatchSchema = z.object({
  from: DateSchema,
  to: DateSchema,
  journalId: Uuid,
  reference: z.string().max(80).optional(),
  assetIds: z.array(Uuid).max(500).optional(),
  note: z.string().max(1000).optional(),
});

function pickLocale(query: Record<string, string | undefined>, fallback: Locale): Locale {
  const value = query.lang ?? query.locale;
  return value === 'en' ? 'en' : value === 'fr' ? 'fr' : fallback;
}

export function fixedAssetRoutes(app: FastifyInstance, db: Db) {
  async function actor(req: any, companyId: string, minRole: 'viewer' | 'accountant' | 'manager'): Promise<AssetActor> {
    const user = req.user!;
    await requireCompany(db, user.id, companyId, minRole, 'accounting');
    return { companyId, userId: user.id, ip: clientIp(req), locale: user.locale === 'en' ? 'en' : 'fr' };
  }

  // ------------------------------------------------------------- categories
  app.get('/companies/:companyId/fixed-assets/categories', async (req) => {
    const { companyId } = req.params as { companyId: string };
    await actor(req, companyId, 'viewer');
    return { categories: await listCategories(db, companyId) };
  });

  app.post('/companies/:companyId/fixed-assets/categories', async (req, reply) => {
    const { companyId } = req.params as { companyId: string };
    const a = await actor(req, companyId, 'accountant');
    const category = await createCategory(db, a, parse(CategorySchema, req.body));
    reply.code(201);
    return { category };
  });

  app.patch('/companies/:companyId/fixed-assets/categories/:categoryId', async (req) => {
    const { companyId, categoryId } = req.params as { companyId: string; categoryId: string };
    const a = await actor(req, companyId, 'accountant');
    return { category: await updateCategory(db, a, categoryId, parse(CategorySchema, req.body)) };
  });

  // ---------------------------------------------------------------- reports
  app.get('/companies/:companyId/fixed-assets/reports/:report', async (req, reply) => {
    const { companyId, report } = req.params as { companyId: string; report: string };
    const a = await actor(req, companyId, 'viewer');
    const ctx = await requireCompany(db, a.userId, companyId, 'viewer', 'accounting');
    const query = req.query as Record<string, string | undefined>;
    const from = parseIsoDate(query.from ?? ctx.company.financial_year_start, 'from');
    const to = parseIsoDate(query.to ?? ctx.company.financial_year_end, 'to');
    const asOf = parseIsoDate(query.asOf ?? to, 'asOf');
    const locale = pickLocale(query, a.locale === 'en' ? 'en' : 'fr');
    const format = query.format ?? 'json';

    const data = await (async () => {
      switch (report) {
        case 'register': return registerReport(db, companyId, asOf);
        case 'schedule': return scheduleReport(db, companyId, from, to, query.assetId || undefined);
        case 'accumulated': return accumulatedReport(db, companyId, asOf);
        case 'nbv': return nbvReport(db, companyId, asOf);
        case 'additions-disposals': return additionsDisposalsReport(db, companyId, from, to);
        case 'reconciliation': return reconciliationReport(db, companyId, asOf);
        case 'movement-schedule': return movementScheduleReport(db, companyId, from, to);
        default: throw badRequest('FIXED_ASSET_REPORT_UNKNOWN', 'Unknown fixed asset report');
      }
    })();

    if (format === 'json') return data;

    const spec = reportTables(data as any, locale, report);
    const company = {
      name: ctx.company.name, brn: ctx.company.brn, vat_number: ctx.company.vat_number,
      functional_currency: ctx.company.functional_currency,
    };
    const period = report === 'schedule' || report === 'additions-disposals' || report === 'movement-schedule'
      ? `${from} → ${to}` : locale === 'en' ? `As at ${asOf}` : `Au ${asOf}`;

    if (format === 'csv') {
      const rows: (string | number)[][] = [...spec.csv];
      rows.push([]);
      rows.push([t(locale, 'csv.demoNote')]);
      reply.header('content-type', 'text/csv; charset=utf-8').header(
        'content-disposition',
        `attachment; filename="fixed-assets-${report}-${company.name.replace(/[^\w-]+/g, '_')}-${asOf}.csv"`,
      );
      return reply.send(toCsv(rows));
    }
    if (format === 'pdf') {
      const buffer = await fixedAssetPdf(company, locale, {
        title: t(locale, `fa.report.${reportKey(report)}`),
        period, columns: spec.columns, rows: spec.rows, totals: spec.totals, notes: spec.notes,
        landscape: report !== 'reconciliation',
      });
      reply.header('content-type', 'application/pdf').header(
        'content-disposition',
        `attachment; filename="fixed-assets-${report}-${company.name.replace(/[^\w-]+/g, '_')}-${asOf}.pdf"`,
      );
      return reply.send(buffer);
    }
    throw badRequest('REPORT_FORMAT_INVALID', 'Unsupported format');
  });

  // ---------------------------------------------------------------- batches
  app.get('/companies/:companyId/fixed-assets/depreciation/preview', async (req) => {
    const { companyId } = req.params as { companyId: string };
    const a = await actor(req, companyId, 'viewer');
    const query = req.query as Record<string, string | undefined>;
    const ctx = await requireCompany(db, a.userId, companyId, 'viewer', 'accounting');
    const from = parseIsoDate(query.from ?? ctx.company.financial_year_start, 'from');
    const to = parseIsoDate(query.to ?? ctx.company.financial_year_end, 'to');
    return previewDepreciation(db, companyId, from, to, query.assetId ? [query.assetId] : undefined);
  });

  app.get('/companies/:companyId/fixed-assets/depreciation/batches', async (req) => {
    const { companyId } = req.params as { companyId: string };
    await actor(req, companyId, 'viewer');
    return { batches: await listBatches(db, companyId) };
  });

  app.post('/companies/:companyId/fixed-assets/depreciation/batches', async (req, reply) => {
    const { companyId } = req.params as { companyId: string };
    const a = await actor(req, companyId, 'accountant');
    const batch = await createBatch(db, a, parse(BatchSchema, req.body));
    reply.code(201);
    return { batch };
  });

  app.get('/companies/:companyId/fixed-assets/depreciation/batches/:batchId', async (req) => {
    const { companyId, batchId } = req.params as { companyId: string; batchId: string };
    await actor(req, companyId, 'viewer');
    return { batch: await getBatch(db, companyId, batchId) };
  });

  app.post('/companies/:companyId/fixed-assets/depreciation/batches/:batchId/approve', async (req) => {
    const { companyId, batchId } = req.params as { companyId: string; batchId: string };
    const a = await actor(req, companyId, 'manager');
    return { batch: await approveBatch(db, a, batchId, parse(DecisionSchema, req.body)) };
  });

  app.post('/companies/:companyId/fixed-assets/depreciation/batches/:batchId/post', async (req) => {
    const { companyId, batchId } = req.params as { companyId: string; batchId: string };
    const a = await actor(req, companyId, 'manager');
    return postBatch(db, a, batchId);
  });

  app.delete('/companies/:companyId/fixed-assets/depreciation/batches/:batchId', async (req) => {
    const { companyId, batchId } = req.params as { companyId: string; batchId: string };
    const a = await actor(req, companyId, 'accountant');
    return deleteBatch(db, a, batchId);
  });

  // -------------------------------------------------------------- proposals
  app.get('/companies/:companyId/fixed-assets/proposals', async (req) => {
    const { companyId } = req.params as { companyId: string };
    await actor(req, companyId, 'viewer');
    const query = req.query as Record<string, string | undefined>;
    return { proposals: await listProposals(db, companyId, { assetId: query.assetId, kind: query.kind, status: query.status }) };
  });

  app.get('/companies/:companyId/fixed-assets/proposals/:proposalId', async (req) => {
    const { companyId, proposalId } = req.params as { companyId: string; proposalId: string };
    await actor(req, companyId, 'viewer');
    return { proposal: await getProposal(db, companyId, proposalId) };
  });

  app.post('/companies/:companyId/fixed-assets/proposals/:proposalId/approve', async (req) => {
    const { companyId, proposalId } = req.params as { companyId: string; proposalId: string };
    const a = await actor(req, companyId, 'manager');
    return { proposal: await approveProposal(db, a, proposalId, parse(DecisionSchema, req.body)) };
  });

  app.post('/companies/:companyId/fixed-assets/proposals/:proposalId/reject', async (req) => {
    const { companyId, proposalId } = req.params as { companyId: string; proposalId: string };
    const a = await actor(req, companyId, 'manager');
    return { proposal: await rejectProposal(db, a, proposalId, parse(RejectSchema, req.body)) };
  });

  app.post('/companies/:companyId/fixed-assets/proposals/:proposalId/post', async (req) => {
    const { companyId, proposalId } = req.params as { companyId: string; proposalId: string };
    const a = await actor(req, companyId, 'manager');
    return postProposal(db, a, proposalId);
  });

  // ----------------------------------------------------------------- assets
  app.get('/companies/:companyId/fixed-assets', async (req) => {
    const { companyId } = req.params as { companyId: string };
    await actor(req, companyId, 'viewer');
    const query = req.query as Record<string, string | undefined>;
    return { assets: await listAssets(db, companyId, { categoryId: query.categoryId, status: query.status, asOf: query.asOf }) };
  });

  app.post('/companies/:companyId/fixed-assets', async (req, reply) => {
    const { companyId } = req.params as { companyId: string };
    const a = await actor(req, companyId, 'accountant');
    reply.code(201);
    return createAsset(db, a, parse(AssetSchema, req.body));
  });

  app.get('/companies/:companyId/fixed-assets/:assetId', async (req) => {
    const { companyId, assetId } = req.params as { companyId: string; assetId: string };
    await actor(req, companyId, 'viewer');
    return getAsset(db, companyId, assetId);
  });

  app.patch('/companies/:companyId/fixed-assets/:assetId', async (req) => {
    const { companyId, assetId } = req.params as { companyId: string; assetId: string };
    const a = await actor(req, companyId, 'accountant');
    return updateAsset(db, a, assetId, parse(AssetPatchSchema, req.body));
  });

  app.post('/companies/:companyId/fixed-assets/:assetId/activate', async (req) => {
    const { companyId, assetId } = req.params as { companyId: string; assetId: string };
    const a = await actor(req, companyId, 'accountant');
    return activateAsset(db, a, assetId, parse(ActivateSchema, req.body));
  });

  app.post('/companies/:companyId/fixed-assets/:assetId/revise-estimate', async (req) => {
    const { companyId, assetId } = req.params as { companyId: string; assetId: string };
    const a = await actor(req, companyId, 'accountant');
    return reviseEstimate(db, a, assetId, parse(RevisionSchema, req.body));
  });

  app.post('/companies/:companyId/fixed-assets/:assetId/suspend', async (req) => {
    const { companyId, assetId } = req.params as { companyId: string; assetId: string };
    const a = await actor(req, companyId, 'accountant');
    return suspendAsset(db, a, assetId, parse(SuspendSchema, req.body));
  });

  app.post('/companies/:companyId/fixed-assets/:assetId/resume', async (req) => {
    const { companyId, assetId } = req.params as { companyId: string; assetId: string };
    const a = await actor(req, companyId, 'accountant');
    return resumeAsset(db, a, assetId, parse(ResumeSchema, req.body));
  });

  app.get('/companies/:companyId/fixed-assets/:assetId/schedule', async (req) => {
    const { companyId, assetId } = req.params as { companyId: string; assetId: string };
    const a = await actor(req, companyId, 'viewer');
    const ctx = await requireCompany(db, a.userId, companyId, 'viewer', 'accounting');
    const query = req.query as Record<string, string | undefined>;
    const from = parseIsoDate(query.from ?? ctx.company.financial_year_start, 'from');
    const to = parseIsoDate(query.to ?? ctx.company.financial_year_end, 'to');
    const lines = await assetSchedule(db, companyId, assetId, from, to);
    return {
      from, to,
      lines: lines.map((l) => ({
        monthStart: l.monthStart, monthEnd: l.monthEnd, amount: formatAmount(l.amount),
        method: l.method, openingNbv: formatAmount(l.openingNbv), closingNbv: formatAmount(l.closingNbv),
        depreciableBase: formatAmount(l.depreciableBase), residualValue: formatAmount(l.residualValue),
        daysActive: l.daysActive, daysInMonth: l.daysInMonth, usefulLifeMonths: l.usefulLifeMonths,
      })),
    };
  });

  app.post('/companies/:companyId/fixed-assets/:assetId/proposals', async (req, reply) => {
    const { companyId, assetId } = req.params as { companyId: string; assetId: string };
    const a = await actor(req, companyId, 'accountant');
    const proposal = await createProposal(db, a, assetId, parse(ProposalSchema, req.body));
    reply.code(201);
    return { proposal };
  });
}

function reportKey(report: string) {
  switch (report) {
    case 'additions-disposals': return 'additions';
    case 'movement-schedule': return 'movement';
    default: return report;
  }
}

interface TableSpec {
  columns: { label: string; width: number; align?: 'left' | 'right' }[];
  rows: string[][];
  totals?: { label: string; values: string[] }[];
  notes?: string[];
  csv: (string | number)[][];
}

const col = (label: string, width: number, align: 'left' | 'right' = 'left') => ({ label, width, align });

function reportTables(data: any, locale: Locale, report: string): TableSpec {
  const L = (key: string) => t(locale, key);
  const money = (value: string) => value;
  const statusLabel = (status: string) => {
    const key = `fa.status.${status}`;
    const label = t(locale, key);
    return label === key ? status : label;
  };

  switch (report) {
    case 'register': {
      const columns = [
        col(L('fa.asset'), 0.12), col(L('fa.category'), 0.12), col(L('fa.acquisitionDate'), 0.1),
        col(L('fa.inServiceDate'), 0.1), col(L('fa.method'), 0.09), col(L('fa.lifeMonths'), 0.07, 'right'),
        col(L('fa.cost'), 0.11, 'right'), col(L('fa.accumulated'), 0.11, 'right'),
        col(L('fa.impairment'), 0.08, 'right'), col(L('fa.nbv'), 0.1, 'right'),
      ];
      const rows = data.rows.map((r: any) => [r.assetCode, r.categoryCode, r.acquisitionDate, r.inServiceDate ?? '',
        r.method ?? '', String(r.usefulLifeMonths ?? ''), money(r.grossCost), money(r.historicalAccumulatedDepreciation),
        money(r.accumulatedImpairment), money(r.netBookValue)]);
      return {
        columns, rows,
        totals: [
          { label: L('fa.total'), values: [money(data.totals.cost), money(data.totals.accumulatedDepreciation), money(data.totals.accumulatedImpairment), money(data.totals.netBookValue)] },
        ],
        csv: [[L('fa.asset'), L('fa.category'), L('fa.description'), L('fa.acquisitionDate'), L('fa.inServiceDate'),
          L('fa.method'), L('fa.lifeMonths'), L('fa.status'), L('fa.cost'), L('fa.accumulated'), L('fa.impairment'), L('fa.nbv')],
        ...data.rows.map((r: any) => [r.assetCode, r.categoryCode, r.description, r.acquisitionDate, r.inServiceDate ?? '',
          r.method ?? '', r.usefulLifeMonths ?? '', r.status, r.grossCost, r.historicalAccumulatedDepreciation,
          r.accumulatedImpairment, r.netBookValue])],
      };
    }
    case 'schedule': {
      const columns = [
        col(L('fa.asset'), 0.18), col(L('fa.month'), 0.12), col(L('fa.method'), 0.11),
        col(L('fa.days'), 0.09, 'right'), col(L('fa.amount'), 0.13, 'right'),
        col(L('fa.nbv'), 0.14, 'right'), col(L('fa.status'), 0.13),
      ];
      const rows = data.rows.map((r: any) => [r.assetCode, r.monthStart, r.method, `${r.daysActive}/${r.daysInMonth}`,
        money(r.amount), money(r.closingNbv), statusLabel(r.batchStatus === 'POSTED' ? 'posted' : 'draft')]);
      return {
        columns, rows,
        totals: [{ label: L('fa.total'), values: [money(data.totals.amount), '', ''] }],
        csv: [[L('fa.asset'), L('fa.month'), L('fa.method'), L('fa.days'), L('fa.amount'),
          L('fa.nbv'), L('fa.status'), L('fa.reference')],
        ...data.rows.map((r: any) => [r.assetCode, r.monthStart, r.method, `${r.daysActive}/${r.daysInMonth}`,
          r.amount, r.closingNbv, r.batchStatus, r.batchReference])],
      };
    }
    case 'accumulated': {
      const columns = [
        col(L('fa.asset'), 0.22), col(L('fa.category'), 0.16), col(L('fa.cost'), 0.16, 'right'),
        col(L('fa.accumulated'), 0.16, 'right'), col(L('fa.impairment'), 0.14, 'right'), col(L('fa.nbv'), 0.16, 'right'),
      ];
      return {
        columns,
        rows: data.rows.map((r: any) => [r.assetCode, r.categoryCode, money(r.cost), money(r.accumulatedDepreciation),
          money(r.accumulatedImpairment), money(r.netBookValue)]),
        totals: [{ label: L('fa.total'), values: [money(data.totals.cost), money(data.totals.accumulatedDepreciation), money(data.totals.accumulatedImpairment), money(data.totals.netBookValue)] }],
        csv: [[L('fa.asset'), L('fa.category'), L('fa.cost'), L('fa.accumulated'), L('fa.impairment'), L('fa.nbv')],
        ...data.rows.map((r: any) => [r.assetCode, r.categoryCode, r.cost, r.accumulatedDepreciation, r.accumulatedImpairment, r.netBookValue])],
      };
    }
    case 'nbv': {
      const columns = [
        col(L('fa.asset'), 0.22), col(L('fa.category'), 0.16), col(L('fa.cost'), 0.15, 'right'),
        col(L('fa.accumulated'), 0.15, 'right'), col(L('fa.impairment'), 0.14, 'right'),
        col(L('fa.nbv'), 0.18, 'right'),
      ];
      return {
        columns,
        rows: data.rows.map((r: any) => [r.assetCode, r.categoryCode, money(r.cost), money(r.accumulatedDepreciation),
          money(r.accumulatedImpairment), money(r.netBookValue)]),
        totals: [{ label: L('fa.total'), values: [money(data.totals.accumulatedDepreciation), money(data.totals.netBookValue)] }],
        csv: [[L('fa.asset'), L('fa.category'), L('fa.cost'), L('fa.residual'), L('fa.accumulated'), L('fa.impairment'), L('fa.nbv'), L('fa.status')],
        ...data.rows.map((r: any) => [r.assetCode, r.categoryCode, r.cost, r.residualValue, r.accumulatedDepreciation,
          r.accumulatedImpairment, r.netBookValue, r.status])],
      };
    }
    case 'additions-disposals': {
      const columns = [
        col(L('fa.asset'), 0.2), col(L('fa.category'), 0.15), col(L('fa.acquisitionDate'), 0.14),
        col(L('fa.disposalDate'), 0.14), col(L('fa.cost'), 0.19, 'right'), col(L('fa.nbv'), 0.18, 'right'),
      ];
      const rows = [
        ...data.additions.map((r: any) => [`+ ${r.assetCode}`, r.categoryCode, r.acquisitionDate, '', money(r.cost), '']),
        ...data.disposals.map((r: any) => [`- ${r.assetCode}`, r.categoryCode, '', r.disposalDate, money(r.cost), money(r.netBookValue)]),
      ];
      return {
        columns, rows,
        totals: [
          { label: L('fa.additions'), values: [money(data.totals.additions)] },
          { label: L('fa.disposals'), values: [money(data.totals.disposalsCost)] },
        ],
        csv: [[L(locale === 'en' ? 'fa.additions' : 'fa.additions')],
          [L('fa.asset'), L('fa.category'), L('fa.acquisitionDate'), L('fa.cost')],
          ...data.additions.map((r: any) => [r.assetCode, r.categoryCode, r.acquisitionDate, r.cost]),
          [],
          [L('fa.disposals')],
          [L('fa.asset'), L('fa.category'), L('fa.disposalDate'), L('fa.cost'), L('fa.nbv')],
          ...data.disposals.map((r: any) => [r.assetCode, r.categoryCode, r.disposalDate, r.cost, r.netBookValue])],
      };
    }
    case 'reconciliation': {
      const columns = [
        col(L('fa.category'), 0.17), col(L('fa.registerAccount'), 0.15),
        col(L('fa.cost'), 0.12, 'right'), col(L('fa.glBalance'), 0.12, 'right'), col(L('fa.difference'), 0.1, 'right'),
        col(L('fa.accumulated'), 0.12, 'right'), col(L('fa.depreciationGl'), 0.12, 'right'),
      ];
      return {
        columns,
        rows: data.rows.map((r: any) => [r.categoryCode, r.assetAccountId ? 'GL' : '—', money(r.registerCost), money(r.assetGl),
          money(r.costDifference), money(r.registerDepreciation), money(r.depreciationGl)]),
        totals: [{ label: L('fa.check'), values: [money(data.difference)] }],
        csv: [[L('fa.category'), L('fa.cost'), L('fa.glBalance'), L('fa.difference'),
          L('fa.accumulated'), L('fa.depreciationGl'), L('fa.impairment'), L('fa.impairment') + ' GL'],
        ...data.rows.map((r: any) => [r.categoryCode, r.registerCost, r.assetGl, r.costDifference,
          r.registerDepreciation, r.depreciationGl, r.registerImpairment, r.impairmentGl])],
      };
    }
    case 'movement-schedule': {
      const columns = [
        col(L('fa.category'), 0.24), col(L('fa.opening'), 0.19, 'right'), col(L('fa.additions'), 0.19, 'right'),
        col(L('fa.disposals'), 0.19, 'right'), col(L('fa.closing'), 0.19, 'right'),
      ];
      return {
        columns,
        rows: [
          [`${L('fa.cost')} — ${L('fa.opening')}`, money(data.cost.opening), '', '', ''],
          [`${L('fa.cost')} — ${L('fa.additions')}`, '', money(data.cost.additions), '', ''],
          [`${L('fa.cost')} — ${L('fa.disposals')}`, '', '', money(data.cost.disposals), ''],
          [`${L('fa.cost')} — ${L('fa.closing')}`, '', '', ``, money(data.cost.closing)],
          [`${L('fa.accumulated')} — ${L('fa.opening')}`, money(data.depreciation.opening), '', '', ''],
          [`${L('fa.accumulated')} — ${L('fa.charge')}`, '', money(data.depreciation.charge), '', ''],
          [`${L('fa.accumulated')} — ${L('fa.disposals')}`, '', '', money(data.depreciation.disposals), ''],
          [`${L('fa.accumulated')} — ${L('fa.closing')}`, '', '', '', money(data.depreciation.closing)],
          [L('fa.nbv'), money(data.netBookValue.opening), '', '', money(data.netBookValue.closing)],
        ],
        notes: [`${L('fa.check')}: ${money(data.cost.check)} / ${money(data.depreciation.check)}`],
        csv: [[L('fa.category'), L('fa.cost'), L('fa.accumulated'), L('fa.nbv')],
          [L('fa.opening'), data.cost.opening, data.depreciation.opening, data.netBookValue.opening],
          [L('fa.additions'), data.cost.additions, data.depreciation.charge, ''],
          [L('fa.disposals'), data.cost.disposals, data.depreciation.disposals, ''],
          [L('fa.closing'), data.cost.closing, data.depreciation.closing, data.netBookValue.closing],
          [], [L('fa.check'), data.cost.check, data.depreciation.check, '']],
      };
    }
    default:
      throw badRequest('FIXED_ASSET_REPORT_UNKNOWN', 'Unknown fixed asset report');
  }
}
