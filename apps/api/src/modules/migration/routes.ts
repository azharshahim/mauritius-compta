import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Db } from '../../db/index.js';
import type { Config } from '../../config.js';
import { badRequest } from '../../lib/errors.js';
import { clientIp, parse } from '../../lib/http.js';
import { requireCompany } from '../../lib/tenant.js';
import { cabinetOfCompany } from '../../lib/cabinets.js';
import { IMPORT_FIELDS, IMPORT_KIND_LABELS, PROFILES } from './profiles.js';
import {
  cancelJob,
  createJob,
  deleteJob,
  deleteTemplate,
  getJobView,
  importJob,
  jobOfCompany,
  listJobs,
  listTemplates,
  reportCsv,
  saveTemplate,
  updateJob,
} from './service.js';
import type { MigrationSource } from './profiles.js';

/**
 * Cabinet → Import & migration endpoints.
 *
 * Every route is company-scoped and re-authenticated server side with the
 * `accountant` role: a migration writes real accounting data, so a viewer can
 * never create, preview, confirm or download a migration report of a dossier
 * they are not entitled to.
 */

const SourceSchema = z.enum(['excel', 'csv', 'sage50', 'sage200', 'sage_accounting', 'sap', 'other']);
const KindSchema = z.enum([
  'chart_of_accounts',
  'opening_balance',
  'journal_entries',
  'customers',
  'companies',
]);

const OptionsSchema = z
  .object({
    createAccounts: z.boolean().optional(),
    createCompanies: z.boolean().optional(),
    openingDate: z.string().max(20).nullish(),
    defaultJournalCode: z.string().max(16).nullish(),
    defaultAccountType: z.enum(['asset', 'liability', 'equity', 'revenue', 'expense']).nullish(),
    defaultCurrency: z.string().max(3).nullish(),
    dateDayFirst: z.boolean().optional(),
    conflictStrategy: z.enum(['skip', 'block']).optional(),
  })
  .strict();

const JobBodySchema = z
  .object({
    source: SourceSchema,
    importKind: KindSchema,
    fileName: z.string().min(1).max(200),
    contentBase64: z.string().max(12_000_000).optional(),
    contentText: z.string().max(12_000_000).optional(),
    sheetName: z.string().max(120).nullish(),
    mapping: z.record(z.string().max(40), z.string().max(200)).optional(),
    options: OptionsSchema.optional(),
  })
  .strict();

const UpdateBodySchema = z
  .object({
    mapping: z.record(z.string().max(40), z.string().max(200).nullable()).optional(),
    accountMapping: z.record(z.string().max(64), z.string().max(64).nullable()).optional(),
    options: OptionsSchema.optional(),
    sheetName: z.string().max(120).optional(),
  })
  .strict();

const ImportBodySchema = z
  .object({
    confirm: z.literal(true),
    /** Explicit acknowledgement shown and re-sent by the wizard. */
    acknowledgement: z.string().max(500).optional(),
  })
  .strict();

const TemplateBodySchema = z
  .object({
    name: z.string().min(1).max(120),
    importKind: KindSchema,
    source: SourceSchema,
    mapping: z.record(z.string().max(40), z.string().max(200)),
    accountMapping: z.record(z.string().max(64), z.string().max(64)).default({}),
    options: OptionsSchema.default({}),
  })
  .strict();

async function cabinetFor(db: Db, companyId: string): Promise<string> {
  const cabinetId = await cabinetOfCompany(db, companyId);
  if (!cabinetId) {
    throw badRequest('MIGRATION_IMPORT_FAILED', 'This company is not attached to a cabinet');
  }
  return cabinetId;
}

interface UploadPayload {
  source: MigrationSource;
  importKind: z.infer<typeof KindSchema>;
  fileName: string;
  contentBase64?: string;
  contentText?: string;
  sheetName?: string | null;
  mapping?: Record<string, string>;
  options?: z.infer<typeof OptionsSchema>;
}

/** Accepts either a JSON payload (tests, small files) or a multipart upload. */
async function readUpload(req: FastifyRequest): Promise<UploadPayload> {
  if (req.isMultipart()) {
    const file = await req.file({ limits: { fileSize: 8 * 1024 * 1024, files: 1 } });
    if (!file) throw badRequest('MIGRATION_IMPORT_FAILED', 'No file was uploaded');
    const buffer = await file.toBuffer();
    const field = (name: string): string | undefined => {
      const entry = (file.fields as Record<string, unknown>)[name] as
        | { value?: unknown }
        | { value?: unknown }[]
        | undefined;
      if (!entry) return undefined;
      const first = Array.isArray(entry) ? entry[0] : entry;
      const raw = first?.value;
      return raw === undefined || raw === null ? undefined : String(raw);
    };
    const mappingRaw = field('mapping');
    const optionsRaw = field('options');
    const body = JobBodySchema.partial({ contentBase64: true, contentText: true }).parse({
      source: field('source'),
      importKind: field('importKind'),
      fileName: file.filename,
      sheetName: field('sheetName') ?? null,
      ...(mappingRaw ? { mapping: safeJson(mappingRaw) } : {}),
      ...(optionsRaw ? { options: safeJson(optionsRaw) } : {}),
    });
    return {
      ...body,
      contentBase64: Buffer.from(buffer).toString('base64'),
    };
  }
  return parse(JobBodySchema, req.body);
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    throw badRequest('MIGRATION_IMPORT_FAILED', 'Invalid JSON in a multipart field');
  }
}

export function migrationRoutes(app: FastifyInstance, db: Db, config: Config): void {
  const company = (req: FastifyRequest) =>
    req.params as { companyId: string; jobId?: string; templateId?: string };

  // ---------------------------------------------------------------------- //
  // Catalogue
  // ---------------------------------------------------------------------- //
  app.get('/companies/:companyId/migration/profiles', async (req) => {
    const { companyId } = company(req);
    await requireCompany(db, req.user!.id, companyId, 'viewer');
    return {
      profiles: PROFILES,
      fields: IMPORT_FIELDS,
      kinds: IMPORT_KIND_LABELS,
      limits: {
        maxBytes: Math.min(config.MAX_UPLOAD_BYTES, 8 * 1024 * 1024),
        maxRows: Math.min(config.MIGRATION_MAX_ROWS, 20_000),
        retentionDays: config.MIGRATION_RETENTION_DAYS,
      },
    };
  });

  // ---------------------------------------------------------------------- //
  // Jobs
  // ---------------------------------------------------------------------- //
  app.post(
    '/companies/:companyId/migration/jobs',
    { bodyLimit: 9 * 1024 * 1024 },
    async (req, reply) => {
      const { companyId } = company(req);
      const ctx = await requireCompany(db, req.user!.id, companyId, 'accountant');
      const cabinetId = await cabinetFor(db, companyId);
      const payload = await readUpload(req);
      const view = await createJob(
        db,
        config,
        { userId: req.user!.id, companyId, cabinetId },
        payload,
      );
      void ctx;
      return reply.code(201).send(view);
    },
  );

  app.get('/companies/:companyId/migration/jobs', async (req) => {
    const { companyId } = company(req);
    await requireCompany(db, req.user!.id, companyId, 'accountant');
    const jobs = await listJobs(db, companyId);
    return { jobs };
  });

  app.get('/companies/:companyId/migration/jobs/:jobId', async (req) => {
    const { companyId, jobId } = company(req);
    await requireCompany(db, req.user!.id, companyId, 'accountant');
    await jobOfCompany(db, jobId!, companyId);
    return getJobView(db, jobId!);
  });

  app.put('/companies/:companyId/migration/jobs/:jobId/mapping', async (req) => {
    const { companyId, jobId } = company(req);
    await requireCompany(db, req.user!.id, companyId, 'accountant');
    const body = parse(UpdateBodySchema, req.body);
    await jobOfCompany(db, jobId!, companyId);
    return updateJob(db, { userId: req.user!.id, companyId }, jobId!, body);
  });

  app.post('/companies/:companyId/migration/jobs/:jobId/import', async (req) => {
    const { companyId, jobId } = company(req);
    await requireCompany(db, req.user!.id, companyId, 'accountant');
    // Human validation is mandatory and checked on the server.
    parse(ImportBodySchema, req.body);
    const cabinetId = await cabinetFor(db, companyId);
    await jobOfCompany(db, jobId!, companyId);
    return importJob(
      db,
      { userId: req.user!.id, companyId, cabinetId, ip: clientIp(req) },
      jobId!,
    );
  });

  app.post('/companies/:companyId/migration/jobs/:jobId/cancel', async (req, reply) => {
    const { companyId, jobId } = company(req);
    await requireCompany(db, req.user!.id, companyId, 'accountant');
    await cancelJob(db, { userId: req.user!.id, companyId }, jobId!);
    return reply.code(204).send();
  });

  app.delete('/companies/:companyId/migration/jobs/:jobId', async (req, reply) => {
    const { companyId, jobId } = company(req);
    await requireCompany(db, req.user!.id, companyId, 'accountant');
    await deleteJob(db, { userId: req.user!.id, companyId }, jobId!);
    return reply.code(204).send();
  });

  app.get('/companies/:companyId/migration/jobs/:jobId/report.csv', async (req, reply) => {
    const { companyId, jobId } = company(req);
    await requireCompany(db, req.user!.id, companyId, 'accountant');
    const job = await jobOfCompany(db, jobId!, companyId);
    const csv = await reportCsv(db, job);
    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header(
        'content-disposition',
        `attachment; filename="migration-${job.id.slice(0, 8)}.csv"`,
      )
      .send(csv);
  });

  // ---------------------------------------------------------------------- //
  // Saved mappings (per cabinet and import kind)
  // ---------------------------------------------------------------------- //
  app.get('/companies/:companyId/migration/templates', async (req) => {
    const { companyId } = company(req);
    await requireCompany(db, req.user!.id, companyId, 'accountant');
    const cabinetId = await cabinetFor(db, companyId);
    return { templates: await listTemplates(db, cabinetId) };
  });

  app.post('/companies/:companyId/migration/templates', async (req, reply) => {
    const { companyId } = company(req);
    await requireCompany(db, req.user!.id, companyId, 'accountant');
    const cabinetId = await cabinetFor(db, companyId);
    const body = parse(TemplateBodySchema, req.body);
    const template = await saveTemplate(db, { userId: req.user!.id, cabinetId }, {
      ...body,
      accountMapping: body.accountMapping ?? {},
      options: body.options ?? {},
    });
    return reply.code(201).send({ template });
  });

  app.delete('/companies/:companyId/migration/templates/:templateId', async (req, reply) => {
    const { companyId, templateId } = company(req);
    await requireCompany(db, req.user!.id, companyId, 'accountant');
    const cabinetId = await cabinetFor(db, companyId);
    await deleteTemplate(db, cabinetId, templateId!);
    return reply.code(204).send();
  });
}
