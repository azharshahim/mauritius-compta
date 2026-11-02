import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../../db/index.js';
import type { Config } from '../../config.js';
import { parse } from '../../lib/http.js';
import { badRequest } from '../../lib/errors.js';
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
import {
  billingPaymentCandidates,
  createBillingPaymentFromBankTransaction,
  linkBankBillingPayment,
  unlinkBankBillingPayment,
} from './billing.js';
import { bankReconciliationReport, bankReconciliationReportCsv } from './reports.js';
import {
  getReconciliationPeriod,
  listReconciliationPeriods,
  openReconciliationPeriod,
  reopenReconciliationPeriod,
  validateReconciliationPeriod,
} from './periods.js';
import { MCB_MAPPING, mcbRowsToCsv, parseMcbStatement } from './mcb.js';
import { extractDocument } from '../documents/extract.js';
import {
  linkBankSupplierPayment,
  supplierPaymentCandidates,
  unlinkBankSupplierPayment,
} from './purchases.js';

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

const BillingLinkSchema = z
  .object({
    paymentId: z.string().uuid(),
    amount: z.string().regex(/^\d{1,15}(\.\d{1,4})?$/),
    confirm: z.literal(true),
    note: z.string().max(500).nullish(),
  })
  .strict();

const SupplierLinkSchema = z
  .object({
    paymentId: z.string().uuid(),
    amount: z.string().regex(/^\d{1,15}(\.\d{1,4})?$/),
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
    status: z
      .enum(['unmatched', 'proposed', 'matched', 'partially_matched', 'review', 'excluded', 'cancelled'])
      .optional(),
    from: DateString.optional(),
    to: DateString.optional(),
    limit: z.coerce.number().int().min(1).max(500).optional(),
    lang: z.enum(['fr', 'en']).optional(),
  })
  .strict();

const ReasonSchema = z.object({ reason: z.string().max(500).nullish() }).strict();

export function bankRoutes(app: FastifyInstance, db: Db, config: Config): void {
  const params = (req: { params: unknown }) =>
    req.params as {
      companyId: string;
      transactionId?: string;
      proposalId?: string;
      ruleId?: string;
      periodId?: string;
    };

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
        pdfOcr: true,
        pdfText: true,
        pdfScanned: true,
        pdfMcbPriority: true,
        pdfGenericLayout: true,
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
          fr: 'PDF bancaire : MCB est le profil prioritaire. Les autres banques passent par une lecture générique prudente ; si les soldes ou les colonnes ne sont pas reconnus, l’import est refusé. Aucun format bancaire mauricien universel n’est supposé.',
          en: 'Bank PDF: MCB is the primary profile. Other banks use a cautious generic reader; if balances or columns are not recognised, the import is blocked. No universal Mauritian bank format is assumed.',
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

  app.get(
    '/companies/:companyId/bank/transactions/:transactionId/billing-candidates',
    async (req) => {
      const { companyId, transactionId } = params(req);
      await requireCompany(db, req.user!.id, companyId, 'viewer');
      return billingPaymentCandidates(db, companyId, transactionId!);
    },
  );

  app.post(
    '/companies/:companyId/bank/transactions/:transactionId/billing-payments',
    async (req, reply) => {
      const { companyId, transactionId } = params(req);
      await requireCompany(db, req.user!.id, companyId, 'accountant');
      const body = parse(BillingLinkSchema, req.body);
      const result = await linkBankBillingPayment(
        db,
        { userId: req.user!.id, companyId, ip: req.ip },
        transactionId!,
        body,
      );
      return reply.code(result.idempotent ? 200 : 201).send(result);
    },
  );

  app.delete(
    '/companies/:companyId/bank/transactions/:transactionId/billing-payments/:paymentId',
    async (req) => {
      const { companyId, transactionId } = params(req);
      await requireCompany(db, req.user!.id, companyId, 'accountant');
      const { paymentId } = req.params as { paymentId: string };
      const body = parse(
        z.object({ confirm: z.literal(true), reason: z.string().max(500).nullish() }).strict(),
        req.body ?? {},
      );
      return unlinkBankBillingPayment(
        db,
        { userId: req.user!.id, companyId, ip: req.ip },
        transactionId!,
        paymentId,
        body.confirm,
        body.reason ?? null,
      );
    },
  );

  app.get(
    '/companies/:companyId/bank/transactions/:transactionId/supplier-candidates',
    async (req) => {
      const { companyId, transactionId } = params(req);
      await requireCompany(db, req.user!.id, companyId, 'viewer');
      return supplierPaymentCandidates(db, companyId, transactionId!);
    },
  );

  app.post(
    '/companies/:companyId/bank/transactions/:transactionId/supplier-payments',
    async (req, reply) => {
      const { companyId, transactionId } = params(req);
      await requireCompany(db, req.user!.id, companyId, 'accountant');
      const body = parse(SupplierLinkSchema, req.body);
      const result = await linkBankSupplierPayment(
        db,
        { userId: req.user!.id, companyId, ip: req.ip },
        transactionId!,
        body,
      );
      return reply.code(result.idempotent ? 200 : 201).send(result);
    },
  );

  app.delete(
    '/companies/:companyId/bank/transactions/:transactionId/supplier-payments/:paymentId',
    async (req) => {
      const { companyId, transactionId } = params(req);
      await requireCompany(db, req.user!.id, companyId, 'accountant');
      const { paymentId } = req.params as { paymentId: string };
      const body = parse(
        z.object({ confirm: z.literal(true), reason: z.string().max(500).nullish() }).strict(),
        req.body ?? {},
      );
      return unlinkBankSupplierPayment(
        db,
        { userId: req.user!.id, companyId, ip: req.ip },
        transactionId!,
        paymentId,
        body.confirm,
        body.reason ?? null,
      );
    },
  );

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

  app.get('/companies/:companyId/bank/reconciliation-report', async (req) => {
    const { companyId } = params(req);
    await requireCompany(db, req.user!.id, companyId, 'viewer');
    const q = parse(ListQuerySchema, req.query);
    if (!q.bankAccountId) return { report: null };
    return {
      report: await bankReconciliationReport(db, companyId, q.bankAccountId, q.from, q.to),
    };
  });

  app.get('/companies/:companyId/bank/reconciliation-report.csv', async (req, reply) => {
    const { companyId } = params(req);
    await requireCompany(db, req.user!.id, companyId, 'viewer');
    const q = parse(ListQuerySchema, req.query);
    if (!q.bankAccountId) return reply.code(400).send({ error: 'bankAccountId is required' });
    const locale = q.lang === 'en' ? 'en' : 'fr';
    const report = await bankReconciliationReport(db, companyId, q.bankAccountId, q.from, q.to);
    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', 'attachment; filename="bank-reconciliation-advanced.csv"')
      .send(bankReconciliationReportCsv(report, locale));
  });

  // ------------------------------------------------- Bank receipt -> customer payment (C-04)
  const PaymentFromBankSchema = z
    .object({
      confirm: z.literal(true),
      customerId: z.string().uuid(),
      allocations: z
        .array(
          z
            .object({ invoiceId: z.string().uuid(), amount: z.string().regex(/^\d+(\.\d{1,4})?$/) })
            .strict(),
        )
        .min(1)
        .max(50),
      paymentDate: z.string().trim().min(10).max(10).nullish(),
      reference: z.string().trim().max(120).nullish(),
      exchangeRate: z.string().trim().max(40).nullish(),
      note: z.string().trim().max(2000).nullish(),
    })
    .strict();

  app.post('/companies/:companyId/bank/transactions/:transactionId/billing-payment', async (req, reply) => {
    const { companyId, transactionId } = params(req);
    await requireCompany(db, req.user!.id, companyId, 'accountant');
    const body = parse(PaymentFromBankSchema, req.body);
    const created = await createBillingPaymentFromBankTransaction(
      db,
      { userId: req.user!.id, companyId, ip: req.ip },
      transactionId!,
      body,
    );
    return reply.code(created.idempotent ? 200 : 201).send({
      payment: created.payment,
      transaction: created.transaction,
      match: created.match,
      idempotent: created.idempotent,
      entryCreated: false,
      accountingNotice: {
        code: 'POSTING_SEPARATE',
        fr: 'Le règlement est enregistré mais aucune écriture comptable n’a été créée. Utilisez le moteur comptable existant pour la comptabilisation.',
        en: 'The payment is recorded but no journal entry was created. Use the existing accounting engine to post it.',
      },
    });
  });

  // ------------------------------------------------- Reconciliation periods (Mission 43)
  const PeriodSchema = z
    .object({
      bankAccountId: z.string().uuid(),
      from: z.string().trim().min(10).max(10),
      to: z.string().trim().min(10).max(10),
      note: z.string().trim().max(2000).nullish(),
    })
    .strict();
  const PeriodValidationSchema = z
    .object({
      confirm: z.literal(true),
      note: z.string().trim().max(2000).nullish(),
      acceptedDifference: z.string().trim().max(40).nullish(),
    })
    .strict();
  const PeriodReopenSchema = z
    .object({ confirm: z.literal(true), reason: z.string().trim().min(3).max(2000) })
    .strict();

  app.get('/companies/:companyId/bank/periods', async (req) => {
    const { companyId } = params(req);
    await requireCompany(db, req.user!.id, companyId, 'viewer');
    const q = parse(ListQuerySchema, req.query);
    if (!q.bankAccountId) return { periods: [] };
    return {
      periods: await listReconciliationPeriods(
        db,
        { userId: req.user!.id, companyId, ip: req.ip },
        q.bankAccountId,
        q.from,
        q.to,
      ),
    };
  });

  app.post('/companies/:companyId/bank/periods', async (req, reply) => {
    const { companyId } = params(req);
    await requireCompany(db, req.user!.id, companyId, 'accountant');
    const body = parse(PeriodSchema, req.body);
    const period = await openReconciliationPeriod(db, { userId: req.user!.id, companyId, ip: req.ip }, body);
    return reply.code(201).send({ period });
  });

  app.get('/companies/:companyId/bank/periods/:periodId', async (req) => {
    const { companyId, periodId } = params(req);
    await requireCompany(db, req.user!.id, companyId, 'viewer');
    return {
      period: await getReconciliationPeriod(db, { userId: req.user!.id, companyId, ip: req.ip }, periodId!),
    };
  });

  app.post('/companies/:companyId/bank/periods/:periodId/validate', async (req) => {
    const { companyId, periodId } = params(req);
    await requireCompany(db, req.user!.id, companyId, 'accountant');
    const body = parse(PeriodValidationSchema, req.body);
    return {
      period: await validateReconciliationPeriod(
        db,
        { userId: req.user!.id, companyId, ip: req.ip },
        periodId!,
        body,
      ),
    };
  });

  app.post('/companies/:companyId/bank/periods/:periodId/reopen', async (req) => {
    const { companyId, periodId } = params(req);
    await requireCompany(db, req.user!.id, companyId, 'accountant');
    const body = parse(PeriodReopenSchema, req.body);
    return {
      period: await reopenReconciliationPeriod(
        db,
        { userId: req.user!.id, companyId, ip: req.ip },
        periodId!,
        body,
      ),
    };
  });

  app.get('/companies/:companyId/bank/periods/:periodId/report.csv', async (req, reply) => {
    const { companyId, periodId } = params(req);
    await requireCompany(db, req.user!.id, companyId, 'viewer');
    const period = await getReconciliationPeriod(
      db,
      { userId: req.user!.id, companyId, ip: req.ip },
      periodId!,
    );
    const fr = req.query && (req.query as { lang?: string }).lang === 'fr';
    const stored = [
      [fr ? 'Rapport de période bancaire validée' : 'Validated bank period report'],
      [fr ? 'Période' : 'Period', period.period_from, period.period_to],
      [fr ? 'Statut' : 'Status', period.status],
      [fr ? 'Devise' : 'Currency', period.currency],
      [fr ? 'Solde bancaire d’ouverture' : 'Opening bank balance', period.opening_bank],
      [fr ? 'Solde bancaire de clôture' : 'Closing bank balance', period.closing_bank],
      [fr ? 'Solde comptable d’ouverture' : 'Opening ledger balance', period.opening_ledger],
      [fr ? 'Solde comptable de clôture' : 'Closing ledger balance', period.closing_ledger],
      [fr ? 'Écart' : 'Difference', period.difference],
      [fr ? 'Écart accepté' : 'Accepted difference', period.accepted_difference],
      [fr ? 'Transactions rapprochées' : 'Matched transactions', period.matched_count],
      [fr ? 'Transactions partiellement rapprochées' : 'Partially matched transactions', period.partial_count],
      [fr ? 'Transactions non rapprochées' : 'Unmatched transactions', period.unmatched_count],
      [fr ? 'Transactions exclues' : 'Excluded transactions', period.excluded_count],
      [fr ? 'Empreinte du relevé' : 'Statement hash', period.statement_hash],
      [fr ? 'Validé le' : 'Validated at', period.validated_at],
      [fr ? 'Note' : 'Note', period.note],
      [],
      ...period.events.map((e) => [e.created_at, e.event, e.actor_name ?? '', e.note ?? '']),
      [],
      [fr ? 'Montants figés à la validation : aucun recalcul.' : 'Amounts frozen at validation: no recalculation.'],
    ];
    const csv = stored.map((r) => r.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', 'attachment; filename="bank-period.csv"')
      .send(csv);
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

  // ---------------------------------------------------------------- MCB (Mission 23)
  const McbUploadSchema = z.object({
    bankAccountId: z.string().uuid(),
    fileName: z.string().min(1).max(200),
    contentBase64: z.string().min(1),
    confirm: z.literal(true).optional(),
  }).strict();

  type PdfEndpoint = 'mcb' | 'pdf';
  async function pdfPreviewOf(
    companyId: string,
    body: { bankAccountId: string; fileName: string; contentBase64: string },
    endpoint: PdfEndpoint,
  ) {
    if (!/\.pdf$/i.test(body.fileName)) {
      throw badRequest('BANK_PDF_REQUIRED', 'A bank statement PDF is required');
    }
    const buffer = Buffer.from(body.contentBase64.replace(/^data:[^;]+;base64,/, ''), 'base64');
    if (!buffer.length) throw badRequest('BANK_FILE_REQUIRED', 'The PDF is empty');
    if (buffer.length > Math.min(config.MAX_UPLOAD_BYTES, 8 * 1024 * 1024)) {
      throw badRequest('BANK_FILE_TOO_LARGE', 'The PDF exceeds the upload limit');
    }
    if (buffer.subarray(0, 5).toString('latin1') !== '%PDF-') {
      throw badRequest('BANK_PDF_REQUIRED', 'The file does not have a PDF signature');
    }
    const extraction = await extractDocument(buffer, 'application/pdf');
    const parsed = parseMcbStatement(extraction.text);
    if (endpoint === 'mcb' && parsed.profileKey !== 'mcb') {
      throw badRequest(
        'BANK_MCB_PROFILE_UNRECOGNISED',
        'This PDF does not match the recognised MCB Savings Regular Account layout. Use the generic PDF statement reader.',
      );
    }
    const sourceHash = createHash('sha256').update(buffer).digest('hex');
    const previewInput = {
      bankAccountId: body.bankAccountId,
      fileName: `pdf-${body.fileName.replace(/\.pdf$/i, '').slice(0, 80)}.csv`,
      contentText: mcbRowsToCsv(parsed.rows),
      mapping: MCB_MAPPING,
      dayFirst: false,
      openingBalance: parsed.openingBalance,
      closingBalance: parsed.closingBalance,
      sourceFileName: body.fileName,
      sourceHash,
      sourceSize: buffer.length,
      sourceMeta: {
        extractionMethod: extraction.method,
        pageCount: extraction.pageCount,
        profileKey: parsed.profileKey,
        detectedBankKey: parsed.detectedBankKey,
        bankName: parsed.bankName,
        accountNumber: parsed.accountNumber,
        periodStart: parsed.periodStart,
        periodEnd: parsed.periodEnd,
        currency: parsed.currency,
      },
    } as const;
    const preview = await previewBankImport(db, config, companyId, previewInput);
    if (parsed.profileKey === 'generic') {
      const ambiguous = !parsed.openingBalance
        || parsed.rows.length === 0
        || parsed.warnings.some((warning) =>
          warning.code === 'BANK_PDF_OPENING_MISSING'
          || warning.code === 'BANK_PDF_NO_TRANSACTIONS');
      if (ambiguous) {
        preview.preview.blocksImport = true;
        preview.preview.findings.unshift({
          severity: 'error',
          code: 'BANK_PDF_AMBIGUOUS',
          rowNumber: null,
          messageFr: 'Relevé non MCB ambigu : soldes ou lignes insuffisamment reconnus. L’import automatique est refusé ; corrigez ou utilisez un CSV.',
          messageEn: 'Ambiguous non-MCB statement: balances or lines were not recognised reliably. Automatic import is refused; correct the file or use CSV.',
        });
      }
    }
    return {
      mcb: parsed,
      extraction: {
        method: extraction.method,
        pageCount: extraction.pageCount,
        warnings: extraction.warnings,
      },
      source: {
        fileName: body.fileName,
        sha256: sourceHash,
        sizeBytes: buffer.length,
        storedOnImport: true,
        ...previewInput.sourceMeta,
      },
      preview,
    };
  }

  const pdfImportOf = async (
    companyId: string,
    userId: string,
    body: { bankAccountId: string; fileName: string; contentBase64: string },
    endpoint: PdfEndpoint,
  ) => {
    const built = await pdfPreviewOf(companyId, body, endpoint);
    if (built.preview.preview.blocksImport) {
      throw badRequest('BANK_IMPORT_BLOCKED', 'Blocking findings must be fixed before importing');
    }
    const buffer = Buffer.from(body.contentBase64.replace(/^data:[^;]+;base64,/, ''), 'base64');
    const result = await importBankStatement(db, config,
      { userId, companyId, ip: undefined },
      {
        bankAccountId: body.bankAccountId,
        fileName: `pdf-${body.fileName.replace(/\.pdf$/i, '').slice(0, 80)}.csv`,
        contentText: mcbRowsToCsv(built.mcb.rows),
        mapping: MCB_MAPPING,
        dayFirst: false,
        openingBalance: built.mcb.openingBalance,
        closingBalance: built.mcb.closingBalance,
        sourceFileName: body.fileName,
        sourceHash: built.source.sha256,
        sourceSize: buffer.length,
        sourceBuffer: buffer,
        sourceMeta: built.source,
      });
    return {
      ...result,
      mcb: {
        openingBalance: built.mcb.openingBalance,
        closingBalance: built.mcb.closingBalance,
        warnings: built.mcb.warnings,
        profile: built.mcb.profile,
        compatibilityNote: built.mcb.compatibilityNote,
        bankName: built.mcb.bankName,
        accountNumber: built.mcb.accountNumber,
        periodStart: built.mcb.periodStart,
        periodEnd: built.mcb.periodEnd,
        currency: built.mcb.currency,
        profileKey: built.mcb.profileKey,
        detectedBankKey: built.mcb.detectedBankKey,
      },
      extraction: built.extraction,
      source: built.source,
    };
  };

  app.post('/companies/:companyId/bank/mcb/preview', { bodyLimit: 12_000_000 }, async (req) => {
    const { companyId } = req.params as { companyId: string };
    await requireCompany(db, req.user!.id, companyId, 'accountant');
    const body = parse(McbUploadSchema, req.body);
    return pdfPreviewOf(companyId, body, 'mcb');
  });

  app.post('/companies/:companyId/bank/mcb/import', { bodyLimit: 12_000_000 }, async (req, reply) => {
    const { companyId } = req.params as { companyId: string };
    await requireCompany(db, req.user!.id, companyId, 'accountant');
    const body = parse(McbUploadSchema.extend({ confirm: z.literal(true) }).strict(), req.body);
    const result = await pdfImportOf(companyId, req.user!.id, body, 'mcb');
    return reply.code(result.reimport ? 200 : 201).send(result);
  });

  /**
   * Mission 26 — generic PDF statement reader. MCB remains the primary profile;
   * other layouts are parsed cautiously and blocked when balances/columns are
   * ambiguous. The original PDF is stored and hashed when the import is confirmed.
   */
  app.post('/companies/:companyId/bank/pdf/preview', { bodyLimit: 12_000_000 }, async (req) => {
    const { companyId } = req.params as { companyId: string };
    await requireCompany(db, req.user!.id, companyId, 'accountant');
    const body = parse(McbUploadSchema, req.body);
    return pdfPreviewOf(companyId, body, 'pdf');
  });

  app.post('/companies/:companyId/bank/pdf/import', { bodyLimit: 12_000_000 }, async (req, reply) => {
    const { companyId } = req.params as { companyId: string };
    await requireCompany(db, req.user!.id, companyId, 'accountant');
    const body = parse(McbUploadSchema.extend({ confirm: z.literal(true) }).strict(), req.body);
    const result = await pdfImportOf(companyId, req.user!.id, body, 'pdf');
    return reply.code(result.reimport ? 200 : 201).send(result);
  });
}
