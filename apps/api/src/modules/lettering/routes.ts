import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../../db/index.js';
import { parse } from '../../lib/http.js';
import { requireCompany } from '../../lib/tenant.js';
import { forbidden } from '../../lib/errors.js';
import {
  createLettering,
  explainLineLettering,
  getLettering,
  getLetteringHistory,
  letteringCsv,
  letteringReport,
} from './service.js';
import {
  listLettrableAccounts,
  listLetteringLines,
  listLetterings,
  previewLettering,
  reverseLettering,
  suggestLetterings,
} from './service.js';

const AmountSchema = z.union([z.string().min(1).max(30), z.number()]);
const DateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const AllocationSchema = z
  .object({ lineId: z.string().uuid(), amount: AmountSchema })
  .strict();

const PreviewSchema = z
  .object({
    accountId: z.string().uuid(),
    allocations: z.array(AllocationSchema).min(1).max(200),
  })
  .strict();

const CreateSchema = z
  .object({
    accountId: z.string().uuid(),
    allocations: z.array(AllocationSchema).min(2).max(200),
    rationale: z.string().trim().max(2000).nullish(),
    method: z.enum(['manual', 'suggested']).optional(),
    idempotencyKey: z.string().trim().min(1).max(120).nullish(),
    confirm: z.literal(true),
  })
  .strict();

const ReverseSchema = z
  .object({
    reason: z.string().trim().min(1).max(1000),
    confirm: z.literal(true),
  })
  .strict();

async function requireReversePermission(
  db: Db,
  userId: string,
  companyId: string,
): Promise<void> {
  // Unlettering changes the interpretation of already-posted accounts. It is
  // deliberately reserved to dossier administrators, beyond accounting write
  // access: an accountant can letter, but cannot erase a lettering alone.
  const ctx = await requireCompany(db, userId, companyId, 'accountant', 'accounting');
  if (!['admin', 'owner', 'cabinet_admin'].includes(ctx.role)) {
    throw forbidden(
      'Unlettering requires a dossier administrator permission',
      'FORBIDDEN',
    );
  }
}

export function letteringRoutes(app: FastifyInstance, db: Db) {
  app.get('/companies/:companyId/lettering/accounts', async (req) => {
    const user = req.user!;
    const { companyId } = req.params as { companyId: string };
    await requireCompany(db, user.id, companyId, 'viewer', 'accounting');
    return { accounts: await listLettrableAccounts(db, companyId) };
  });

  const linesHandler = async (req: any) => {
    const user = req.user!;
    const { companyId } = req.params as { companyId: string };
    await requireCompany(db, user.id, companyId, 'viewer', 'accounting');
    const query = req.query as Record<string, string | undefined>;
    const status =
      query.status === 'unlettered' ||
      query.status === 'partial' ||
      query.status === 'lettered' ||
      query.status === 'all'
        ? query.status
        : 'unlettered';
    return listLetteringLines(db, companyId, {
      accountId: query.accountId,
      search: query.search,
      currency: query.currency,
      from: query.from,
      to: query.to,
      status,
      includeUnposted: query.includeUnposted === 'true',
      limit: query.limit ? Number(query.limit) : undefined,
    });
  };
  app.get('/companies/:companyId/lettering/lines', linesHandler);
  app.get('/companies/:companyId/lettering/lines.csv', async (req, reply) => {
    const user = req.user!;
    const { companyId } = req.params as { companyId: string };
    await requireCompany(db, user.id, companyId, 'viewer', 'accounting');
    const query = req.query as Record<string, string | undefined>;
    const csv = await letteringCsv(db, companyId, {
      accountId: query.accountId,
      search: query.search,
      currency: query.currency,
      from: query.from,
      to: query.to,
    });
    reply.header('content-type', 'text/csv; charset=utf-8');
    reply.header('content-disposition', 'attachment; filename="lettrage-non-lettre.csv"');
    return `\uFEFF${csv}`;
  });

  app.post('/companies/:companyId/lettering/preview', async (req) => {
    const user = req.user!;
    const { companyId } = req.params as { companyId: string };
    await requireCompany(db, user.id, companyId, 'viewer', 'accounting');
    const input = parse(PreviewSchema, req.body);
    return {
      preview: await previewLettering(
        db,
        companyId,
        input.accountId,
        input.allocations.map((a) => ({ lineId: a.lineId, amount: String(a.amount) })),
      ),
    };
  });

  app.get('/companies/:companyId/lettering/suggestions', async (req) => {
    const user = req.user!;
    const { companyId } = req.params as { companyId: string };
    await requireCompany(db, user.id, companyId, 'viewer', 'accounting');
    const query = req.query as Record<string, string | undefined>;
    const limit = query.limit ? Number(query.limit) : 20;
    return {
      ...(await suggestLetterings(
        db,
        companyId,
        query.accountId,
        Number.isFinite(limit) ? limit : 20,
      )),
      distinction:
        'Suggestions déterministes calculées sur le grand livre. L’IA générative ne valide jamais un lettrage.',
    };
  });

  app.get('/companies/:companyId/lettering/report', async (req) => {
    const user = req.user!;
    const { companyId } = req.params as { companyId: string };
    await requireCompany(db, user.id, companyId, 'viewer', 'accounting');
    const query = req.query as Record<string, string | undefined>;
    return {
      report: await letteringReport(db, companyId, {
        accountId: query.accountId,
        search: query.search,
        currency: query.currency,
        from: query.from,
        to: query.to,
      }),
    };
  });

  app.get('/companies/:companyId/lettering/report.csv', async (req, reply) => {
    const user = req.user!;
    const { companyId } = req.params as { companyId: string };
    await requireCompany(db, user.id, companyId, 'viewer', 'accounting');
    const query = req.query as Record<string, string | undefined>;
    const csv = await letteringCsv(db, companyId, {
      accountId: query.accountId,
      search: query.search,
      currency: query.currency,
      from: query.from,
      to: query.to,
    });
    reply.header('content-type', 'text/csv; charset=utf-8');
    reply.header('content-disposition', 'attachment; filename="lettrage-rapport.csv"');
    return `\uFEFF${csv}`;
  });

  app.get('/companies/:companyId/lettering/history', async (req) => {
    const user = req.user!;
    const { companyId } = req.params as { companyId: string };
    await requireCompany(db, user.id, companyId, 'viewer', 'accounting');
    const query = req.query as Record<string, string | undefined>;
    return { events: await getLetteringHistory(db, companyId, query.letteringId) };
  });

  app.get('/companies/:companyId/lettering', async (req) => {
    const user = req.user!;
    const { companyId } = req.params as { companyId: string };
    await requireCompany(db, user.id, companyId, 'viewer', 'accounting');
    const query = req.query as Record<string, string | undefined>;
    return {
      letterings: await listLetterings(db, companyId, {
        accountId: query.accountId,
        status:
          query.status === 'active' || query.status === 'reversed' || query.status === 'all'
            ? query.status
            : 'all',
        from: query.from,
        to: query.to,
        search: query.search,
        limit: query.limit ? Number(query.limit) : undefined,
      }),
    };
  });

  app.get('/companies/:companyId/lettering/:letteringId', async (req) => {
    const user = req.user!;
    const { companyId, letteringId } = req.params as {
      companyId: string;
      letteringId: string;
    };
    await requireCompany(db, user.id, companyId, 'viewer', 'accounting');
    return { lettering: await getLettering(db, companyId, letteringId) };
  });

  app.post('/companies/:companyId/lettering', async (req, reply) => {
    const user = req.user!;
    const { companyId } = req.params as { companyId: string };
    await requireCompany(db, user.id, companyId, 'accountant', 'accounting');
    const input = parse(CreateSchema, req.body);
    const result = await createLettering(db, {
      companyId,
      userId: user.id,
      accountId: input.accountId,
      allocations: input.allocations.map((a) => ({ lineId: a.lineId, amount: String(a.amount) })),
      rationale: input.rationale ?? null,
      method: input.method ?? 'manual',
      idempotencyKey: input.idempotencyKey ?? null,
      ip: req.ip,
    });
    return reply.code(result.idempotent ? 200 : 201).send(result);
  });

  app.post('/companies/:companyId/lettering/:letteringId/reverse', async (req) => {
    const user = req.user!;
    const { companyId, letteringId } = req.params as {
      companyId: string;
      letteringId: string;
    };
    await requireReversePermission(db, user.id, companyId);
    const input = parse(ReverseSchema, req.body);
    return reverseLettering(db, {
      companyId,
      userId: user.id,
      letteringId,
      reason: input.reason,
      ip: req.ip,
    });
  });

  app.get('/companies/:companyId/lettering/explain/:lineId', async (req) => {
    const user = req.user!;
    const { companyId, lineId } = req.params as { companyId: string; lineId: string };
    await requireCompany(db, user.id, companyId, 'viewer', 'accounting');
    return { explanation: await explainLineLettering(db, companyId, lineId) };
  });
}
