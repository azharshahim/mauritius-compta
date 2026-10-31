import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../../db/index.js';
import type { Config } from '../../config.js';
import { parse } from '../../lib/http.js';
import { requireCompany } from '../../lib/tenant.js';
import { BANK_FIELDS, BANK_SOURCE_LABELS } from './profiles.js';
import {
  acceptBankProposal,
  bankReport,
  bankReportCsv,
  confirmBankMatch,
  createBankAccount,
  createBankProposal,
  disableBankRule,
  excludeBankTransaction,
  getBankTransactionDetail,
  importBankStatement,
  listBankAccounts,
  listBankImports,
  listBankRules,
  listBankTransactions,
  previewBankImport,
  rejectBankProposal,
  saveBankRule,
} from './service.js';

const AccountSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    bankName: z.string().trim().min(1).max(120),
    currency: z.string().trim().length(3),
    accountId: z.string().uuid(),
    maskedReference: z.string().max(64).nullish(),
  })
  .strict();

const UploadSchema = z
  .object({
    bankAccountId: z.string().uuid(),
    fileName: z.string().trim().min(1).max(200),
    contentBase64: z.string().max(12_000_000).optional(),
    contentText: z.string().max(12_000_000).optional(),
    sheetName: z.string().max(120).nullish(),
    mapping: z.record(z.string().max(40), z.string().max(200)).optional(),
    dayFirst: z.boolean().optional(),
    openingBalance: z.string().max(40).nullish(),
    closingBalance: z.string().max(40).nullish(),
  })
  .strict();

const MatchSchema = z
  .object({
    lineIds: z.array(z.string().uuid()).min(1).max(20),
    confirm: z.literal(true),
    note: z.string().max(500).nullish(),
  })
  .strict();

const ProposalSchema = z
  .object({
    accountId: z.string().uuid().nullish(),
    journalCode: z.string().max(16).nullish(),
  })
  .strict();

const ProposalDecisionSchema = z
  .object({
    confirm: z.literal(true),
    exchangeRate: z.union([z.string(), z.number()]).nullish(),
  })
  .strict();

const RuleSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    labelPattern: z.string().trim().max(120).nullish(),
    referencePattern: z.string().trim().max(120).nullish(),
    bankAccountId: z.string().uuid().nullish(),
    currency: z.string().trim().length(3).nullish(),
    direction: z.enum(['any', 'in', 'out']).optional(),
    accountId: z.string().uuid(),
    journalId: z.string().uuid().nullish(),
    priority: z.number().int().min(1).max(999).optional(),
    notes: z.string().max(500).nullish(),
    supersedesId: z.string().uuid().nullish(),
  })
  .strict();

const DateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const ListQuerySchema = z
  .object({
    bankAccountId: z.string().uuid().optional(),
    status: z.enum(['unmatched', 'proposed', 'matched', 'review', 'excluded', 'cancelled']).optional(),
    from: DateString.optional(),
    to: DateString.optional(),
    limit: z.coerce.number().int().min(1).max(500).optional(),
    lang: z.enum(['fr', 'en']).optional(),
  })
  .strict();

const ReasonSchema = z.object({ reason: z.string().max(500).nullish() }).strict();

export function bankRoutes(app: FastifyInstance, db: Db, config: Config): void {
  const params = (req: { params: unknown }) =>
    req.params as { companyId: string; transactionId?: string; proposalId?: string; ruleId?: string };

  app.get('/companies/:companyId/bank/profiles', async (req) => {
    const { companyId } = params(req);
    await requireCompany(db, req.user!.id, companyId, 'viewer');
    return {
      fields: BANK_FIELDS,
      sources: BANK_SOURCE_LABELS,
      features: {
        csv: true,
        xlsx: true,
        tsv: true,
        ofx: false,
        pdfOcr: false,
        directBankConnection: false,
        aiProvider: null,
        suggestions: 'deterministic',
      },
      limits: {
        maxBytes: Math.min(config.MAX_UPLOAD_BYTES, 8 * 1024 * 1024),
        maxRows: 5000,
      },
      notImplemented: [
        {
          fr: 'OFX/QFX : non implémenté, aucun parseur partiel n’est livré.',
          en: 'OFX/QFX: not implemented, no partial parser is shipped.',
        },
        {
          fr: 'PDF bancaire : OCR non implémenté ; l’intégration ScanPro AI reste une architecture future, sans modification de ce dépôt.',
          en: 'Bank PDF: OCR not implemented; ScanPro AI integration remains a future architecture, with no change to that repository.',
        },
        {
          fr: 'Aucune connexion bancaire directe : uniquement des fichiers téléversés.',
          en: 'No direct bank connection: uploaded files only.',
        },
      ],
    };
  });

  app.get('/companies/:companyId/bank/accounts', async (req) => {
    const { companyId } = params(req);
    await requireCompany(db, req.user!.id, companyId, 'viewer');
    return { accounts: await listBankAccounts(db, companyId) };
  });

  app.post('/companies/:companyId/bank/accounts', async (req, reply) => {
    const { companyId } = params(req);
    await requireCompany(db, req.user!.id, companyId, 'accountant');
    const body = parse(AccountSchema, req.body);
    const account = await createBankAccount(db, { userId: req.user!.id, companyId }, body);
    return reply.code(201).send({ account });
  });

  app.post('/companies/:companyId/bank/preview', async (req) => {
    const { companyId } = params(req);
    await requireCompany(db, req.user!.id, companyId, 'accountant');
    const body = parse(UploadSchema, req.body);
    return previewBankImport(db, config, companyId, body);
  });

  app.post('/companies/:companyId/bank/imports', async (req, reply) => {
    const { companyId } = params(req);
    await requireCompany(db, req.user!.id, companyId, 'accountant');
    const body = parse(UploadSchema, req.body);
    const result = await importBankStatement(
      db,
      config,
      { userId: req.user!.id, companyId },
      body,
    );
    return reply.code(result.reimport ? 200 : 201).send(result);
  });

  app.get('/companies/:companyId/bank/imports', async (req) => {
    const { companyId } = params(req);
    await requireCompany(db, req.user!.id, companyId, 'viewer');
    const q = parse(ListQuerySchema, req.query);
    return { imports: await listBankImports(db, companyId, q.bankAccountId) };
  });

  app.get('/companies/:companyId/bank/transactions', async (req) => {
    const { companyId } = params(req);
    await requireCompany(db, req.user!.id, companyId, 'viewer');
    const q = parse(ListQuerySchema, req.query);
    return {
      transactions: await listBankTransactions(db, companyId, {
        bankAccountId: q.bankAccountId,
        status: q.status,
        from: q.from,
        to: q.to,
        limit: q.limit ?? 100,
      }),
    };
  });

  app.get('/companies/:companyId/bank/transactions/:transactionId', async (req) => {
    const { companyId, transactionId } = params(req);
    await requireCompany(db, req.user!.id, companyId, 'viewer');
    return getBankTransactionDetail(db, companyId, transactionId!);
  });

  app.post('/companies/:companyId/bank/transactions/:transactionId/matches', async (req) => {
    const { companyId, transactionId } = params(req);
    await requireCompany(db, req.user!.id, companyId, 'accountant');
    const body = parse(MatchSchema, req.body);
    return confirmBankMatch(
      db,
      { userId: req.user!.id, companyId },
      transactionId!,
      body.lineIds,
      body.confirm,
    );
  });

  app.post('/companies/:companyId/bank/transactions/:transactionId/exclude', async (req) => {
    const { companyId, transactionId } = params(req);
    await requireCompany(db, req.user!.id, companyId, 'accountant');
    const body = parse(ReasonSchema, req.body ?? {});
    return { transaction: await excludeBankTransaction(db, { userId: req.user!.id, companyId }, transactionId!, body.reason ?? null) };
  });

  app.post('/companies/:companyId/bank/transactions/:transactionId/proposals', async (req, reply) => {
    const { companyId, transactionId } = params(req);
    await requireCompany(db, req.user!.id, companyId, 'accountant');
    const body = parse(ProposalSchema, req.body ?? {});
    const proposal = await createBankProposal(
      db,
      { userId: req.user!.id, companyId },
      transactionId!,
      body,
    );
    return reply.code(201).send({ proposal });
  });

  app.post('/companies/:companyId/bank/proposals/:proposalId/accept', async (req) => {
    const { companyId, proposalId } = params(req);
    await requireCompany(db, req.user!.id, companyId, 'accountant');
    const body = parse(ProposalDecisionSchema, req.body);
    return acceptBankProposal(
      db,
      { userId: req.user!.id, companyId },
      proposalId!,
      body.confirm,
      body.exchangeRate,
    );
  });

  app.post('/companies/:companyId/bank/proposals/:proposalId/reject', async (req) => {
    const { companyId, proposalId } = params(req);
    await requireCompany(db, req.user!.id, companyId, 'accountant');
    return { proposal: await rejectBankProposal(db, { userId: req.user!.id, companyId }, proposalId!) };
  });

  app.get('/companies/:companyId/bank/rules', async (req) => {
    const { companyId } = params(req);
    await requireCompany(db, req.user!.id, companyId, 'viewer');
    return { rules: await listBankRules(db, companyId) };
  });

  app.post('/companies/:companyId/bank/rules', async (req, reply) => {
    const { companyId } = params(req);
    await requireCompany(db, req.user!.id, companyId, 'accountant');
    const body = parse(RuleSchema, req.body);
    const rule = await saveBankRule(db, { userId: req.user!.id, companyId }, body);
    return reply.code(201).send({ rule });
  });

  app.delete('/companies/:companyId/bank/rules/:ruleId', async (req, reply) => {
    const { companyId, ruleId } = params(req);
    await requireCompany(db, req.user!.id, companyId, 'accountant');
    await disableBankRule(db, { userId: req.user!.id, companyId }, ruleId!);
    return reply.code(204).send();
  });

  app.get('/companies/:companyId/bank/report', async (req) => {
    const { companyId } = params(req);
    await requireCompany(db, req.user!.id, companyId, 'viewer');
    const q = parse(ListQuerySchema, req.query);
    if (!q.bankAccountId) return { report: null };
    return {
      report: await bankReport(db, companyId, q.bankAccountId, q.from, q.to),
    };
  });

  app.get('/companies/:companyId/bank/report.csv', async (req, reply) => {
    const { companyId } = params(req);
    await requireCompany(db, req.user!.id, companyId, 'viewer');
    const q = parse(ListQuerySchema, req.query);
    if (!q.bankAccountId) return reply.code(400).send({ error: 'bankAccountId is required' });
    const locale = q.lang === 'en' ? 'en' : 'fr';
    const report = await bankReport(db, companyId, q.bankAccountId, q.from, q.to);
    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', 'attachment; filename="bank-reconciliation.csv"')
      .send(bankReportCsv(report, locale));
  });
}
