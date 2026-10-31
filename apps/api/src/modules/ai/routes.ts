import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Config } from '../../config.js';
import type { Db } from '../../db/index.js';
import { clientIp, parse } from '../../lib/http.js';
import { badRequest, forbidden, notImplemented, notFound } from '../../lib/errors.js';
import { requireModuleAccess } from '../../lib/permissions.js';
import { writeAudit } from '../../lib/audit.js';
import {
  cabinetsOfUser,
  cabinetForCompanyUser,
  requireCabinetAdmin,
} from '../../lib/cabinets.js';
import { loadCatalogue } from './catalogue.js';
import { ProviderRegistry } from './registry.js';
import { AIService } from './service.js';
import {
  decideSuggestion,
  deleteRule,
  listRules,
  listSuggestions,
  suggestAccount,
} from './suggestions.js';
import { AI_FEATURES, featureByKey } from './types.js';
import {
  listProposals,
  loadProposal,
  postProposal,
  proposeFromBilling,
  proposeManual,
  proposalDuplicates,
  rejectProposal,
  updateProposal,
  validateProposal,
  viewProposal,
} from './proposals.js';
import {
  assertRuleType,
  disableRule as disableEntryRule,
  listRuleHistory,
  listRules as listEntryRules,
  saveRule,
} from './rules.js';

/**
 * Mauritius AI Engine - HTTP surface.
 *
 * Two families of routes:
 *  - `/cabinet/ai/*`  : cabinet administration (settings, keys, usage, tests)
 *    restricted to cabinet administrators;
 *  - `/companies/:id/ai/*` : company-scoped features, behind the module
 *    permissions of the suite (accounting write for suggestions).
 */

const UUID = /^[0-9a-f-]{36}$/i;

const providerRef = z.object({
  provider: z.string().min(1).max(40),
  model: z.string().min(1).max(120).nullable().optional(),
});

const settingsPatch = z
  .object({
    enabled: z.boolean().optional(),
    routingMode: z.enum(['manual', 'automatic']).optional(),
    primary: providerRef.nullable().optional(),
    fallback: providerRef.nullable().optional(),
    monthlyBudgetUsd: z
      .union([z.number().min(0).max(1_000_000), z.string().regex(/^\d{1,10}(\.\d{1,4})?$/), z.null()])
      .optional(),
    monthlyRequestLimit: z.number().int().min(1).max(1_000_000).nullable().optional(),
    alertThreshold: z.number().int().min(1).max(100).optional(),
    features: z.record(z.boolean()).optional(),
  })
  .strict();

const credentialBody = z.object({
  apiKey: z.string().min(8).max(512),
  baseUrl: z.string().url().max(300).optional(),
});

const testBody = z.object({
  provider: z.string().min(1).max(40),
  model: z.string().min(1).max(120).optional(),
});

const suggestionBody = z.object({
  description: z.string().trim().min(3).max(500),
  amount: z
    .union([z.string().regex(/^\d{1,15}(\.\d{1,4})?$/), z.number().min(0).max(1e15)])
    .optional(),
  currency: z.string().length(3).toUpperCase().optional(),
});

const decisionBody = z.object({
  decision: z.enum(['accepted', 'modified', 'rejected']),
  accountId: z.string().uuid().optional(),
  createRule: z.boolean().optional(),
  keyword: z.string().trim().min(3).max(60).optional(),
});


const entryProposalBody = z
  .object({
    description: z.string().trim().min(5).max(500),
    amount: z
      .union([z.string().regex(/^\d{1,15}(\.\d{1,4})?$/), z.number().min(0).max(1e15)])
      .refine((value) => Number(value) > 0, { message: 'An amount greater than zero is required' }),
    currency: z.string().length(3).toUpperCase().optional(),
    entryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    reference: z.string().trim().max(100).nullable().optional(),
  })
  .strict();

const fromBillingBody = z
  .object({ documentId: z.string().uuid().optional(), paymentId: z.string().uuid().optional() })
  .strict()
  .refine((v) => Boolean(v.documentId) !== Boolean(v.paymentId), {
    message: 'Exactly one of documentId / paymentId is required',
  });

const proposalUpdateBody = z
  .object({
    journalId: z.string().uuid().optional(),
    entryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    reference: z.string().trim().max(100).nullable().optional(),
    description: z.string().trim().min(3).max(300).optional(),
    currency: z.string().length(3).toUpperCase().optional(),
    exchangeRate: z
      .union([z.string().regex(/^\d{1,6}(\.\d{1,8})?$/), z.number().positive()])
      .nullable()
      .optional(),
    lines: z
      .array(
        z
          .object({
            accountId: z.string().uuid(),
            description: z.string().trim().max(300).nullable().optional(),
            debit: z.union([z.string(), z.number()]).nullable().optional(),
            credit: z.union([z.string(), z.number()]).nullable().optional(),
          })
          .strict(),
      )
      .min(2)
      .max(200)
      .optional(),
  })
  .strict();

const validateBody = z.object({ acceptWarnings: z.boolean().optional() }).strict();
const rejectBody = z.object({ note: z.string().trim().max(500).nullable().optional() }).strict();

const ruleBody = z
  .object({
    ruleType: z.enum(['counterparty', 'bank_label', 'expense_category', 'billing_item', 'payment_method', 'journal']),
    matchKey: z.string().trim().min(2).max(120),
    matchLabel: z.string().trim().max(120).nullable().optional(),
    accountId: z.string().uuid().nullable().optional(),
    counterAccountId: z.string().uuid().nullable().optional(),
    journalId: z.string().uuid().nullable().optional(),
    accountSide: z.enum(['debit', 'credit']).optional(),
    priority: z.number().int().min(1).max(1000).optional(),
    notes: z.string().trim().max(500).nullable().optional(),
  })
  .strict();

function dec(value: string | number | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  return typeof value === 'number' ? value.toFixed(4) : value;
}

function amountToDecimal(value: string | number | undefined): string | null {
  if (value === undefined) return null;
  const raw = typeof value === 'number' ? value.toFixed(4) : value;
  return raw;
}

/** Resolves the cabinet of the request: explicit id, or the first administered. */
async function cabinetForRequest(db: Db, req: FastifyRequest): Promise<string> {
  const user = req.user!;
  const query = req.query as { cabinetId?: string } | undefined;
  const requested = query?.cabinetId;
  if (requested) {
    if (!UUID.test(requested)) throw notFound('CABINET_NOT_FOUND', 'Cabinet not found');
    await requireCabinetAdmin(db, user.id, requested);
    return requested;
  }
  const cabinets = await cabinetsOfUser(db, user.id);
  const first = cabinets[0];
  if (first) return first.id;

  // The user belongs to a cabinet but does not administer any of its dossiers:
  // 403 (not 404) so the UI can explain *why* the screen is unavailable.
  const linked = await db.query(
    `SELECT 1 FROM company_members m
       JOIN companies c ON c.id = m.company_id
      WHERE m.user_id = $1 AND c.cabinet_id IS NOT NULL LIMIT 1`,
    [user.id],
  );
  if (linked.rowCount > 0) {
    throw forbidden('Cabinet administration rights are required', 'AI_FORBIDDEN');
  }
  throw notFound('CABINET_NOT_FOUND', 'No cabinet administrated by this user');
}

export function aiRoutes(app: FastifyInstance, db: Db, config: Config): void {
  const catalogue = loadCatalogue();
  const registry = new ProviderRegistry(catalogue, {
    simulatedEnabled: config.AI_ALLOW_SIMULATED,
  });
  const service = new AIService(db, config, catalogue, registry);

  // ------------------------------------------------------------- settings view
  app.get('/cabinet/ai/settings', async (req) => {
    const cabinetId = await cabinetForRequest(db, req);
    const view = await service.settingsView(cabinetId);
    return {
      ...view,
      catalogue: {
        version: catalogue.version,
        updatedAt: catalogue.updatedAt,
        notice: catalogue.notice,
        priceRows: catalogue.pricing.length,
        verifiedPriceModels: [...new Set(catalogue.pricing.filter((p) => p.verified).map((p) => `${p.provider}:${p.model}`))],
      },
    };
  });

  app.patch('/cabinet/ai/settings', async (req) => {
    const user = req.user!;
    const cabinetId = await cabinetForRequest(db, req);
    const body = parse(settingsPatch, req.body);

    const current = await service.rawSettings(cabinetId);

    // Validate every provider/model reference against the catalogue before it
    // reaches the database.
    const resolve = (ref: z.infer<typeof providerRef> | null | undefined) => {
      if (ref === undefined) return undefined;
      if (ref === null) return null;
      const definition = catalogue.providers.find((p) => p.key === ref.provider);
      if (!definition) throw badRequest('AI_PROVIDER_NOT_ALLOWED', 'Unknown provider');
      if (definition.key === 'simulated' && !config.AI_ALLOW_SIMULATED) {
        throw badRequest('AI_PROVIDER_NOT_ALLOWED', 'Simulated provider is disabled');
      }
      if (definition.models.length > 0) {
        const model = ref.model ?? definition.models[0]!.id;
        if (!definition.models.some((m) => m.id === model)) {
          throw badRequest('AI_MODEL_NOT_ALLOWED', 'Unknown model for this provider');
        }
        return { provider: definition.key, model };
      }
      // Providers with a free-form model list require an explicit model name.
      if (!ref.model) throw badRequest('AI_MODEL_NOT_ALLOWED', 'Model is required');
      return { provider: definition.key, model: ref.model };
    };

    const primary = resolve(body.primary);
    const fallback = resolve(body.fallback);

    let features = current.features;
    if (body.features) {
      for (const key of Object.keys(body.features)) {
        if (!['accounting', 'billing', 'payroll', 'cabinet'].includes(key)) {
          throw badRequest('AI_FEATURE_UNKNOWN', `Unknown module ${key}`);
        }
      }
      features = { ...features, ...body.features };
    }

    const updated = await db.query(
      `UPDATE ai_settings SET
         enabled = COALESCE($2, enabled),
         routing_mode = COALESCE($3, routing_mode),
         primary_provider = CASE WHEN $4::boolean THEN $5 ELSE primary_provider END,
         primary_model = CASE WHEN $4::boolean THEN $6 ELSE primary_model END,
         fallback_provider = CASE WHEN $7::boolean THEN $8 ELSE fallback_provider END,
         fallback_model = CASE WHEN $7::boolean THEN $9 ELSE fallback_model END,
         monthly_budget_usd = CASE WHEN $10::boolean THEN $11::numeric ELSE monthly_budget_usd END,
         monthly_request_limit = CASE WHEN $12::boolean THEN $13::int ELSE monthly_request_limit END,
         alert_threshold = COALESCE($14, alert_threshold),
         features = $15::jsonb,
         updated_by = $16,
         updated_at = now()
       WHERE cabinet_id = $1`,
      [
        cabinetId,
        body.enabled ?? null,
        body.routingMode ?? null,
        primary !== undefined,
        primary?.provider ?? null,
        primary?.model ?? null,
        fallback !== undefined,
        fallback?.provider ?? null,
        fallback?.model ?? null,
        body.monthlyBudgetUsd !== undefined,
        body.monthlyBudgetUsd === null || body.monthlyBudgetUsd === undefined
          ? null
          : String(body.monthlyBudgetUsd),
        body.monthlyRequestLimit !== undefined,
        body.monthlyRequestLimit ?? null,
        body.alertThreshold ?? null,
        JSON.stringify(features),
        user.id,
      ],
    );
    void updated;

    await writeAudit(db, {
      userId: user.id,
      action: 'ai.settings.update',
      entityType: 'ai_settings',
      entityId: cabinetId,
      details: {
        cabinetId,
        enabled: body.enabled,
        routingMode: body.routingMode,
        primary: primary ?? undefined,
        fallback: fallback ?? undefined,
        budget: body.monthlyBudgetUsd,
        requestLimit: body.monthlyRequestLimit,
        features: body.features ?? undefined,
      },
      ip: clientIp(req),
    });

    return service.settingsView(cabinetId);
  });

  // --------------------------------------------------------------- credentials
  app.put('/cabinet/ai/credentials/:provider', async (req, reply) => {
    const user = req.user!;
    const cabinetId = await cabinetForRequest(db, req);
    const { provider } = req.params as { provider: string };
    const body = parse(credentialBody, req.body);

    await service.putCredential({
      cabinetId,
      userId: user.id,
      provider,
      apiKey: body.apiKey,
      baseUrl: body.baseUrl ?? null,
    });
    // Only the state is returned: the key never leaves the server.
    return reply.code(200).send({
      provider,
      configured: true,
      message: 'Clé enregistrée (chiffrée). Elle ne sera plus jamais affichée.',
    });
  });

  app.delete('/cabinet/ai/credentials/:provider', async (req) => {
    const user = req.user!;
    const cabinetId = await cabinetForRequest(db, req);
    const { provider } = req.params as { provider: string };
    const removed = await service.deleteCredential({ cabinetId, userId: user.id, provider });
    if (!removed) throw notFound('AI_KEY_MISSING', 'No active key for this provider');
    return { provider, configured: false };
  });

  app.post('/cabinet/ai/test-connection', async (req) => {
    const user = req.user!;
    const cabinetId = await cabinetForRequest(db, req);
    const body = parse(testBody, req.body);
    return service.testConnection({
      cabinetId,
      userId: user.id,
      provider: body.provider,
      model: body.model ?? null,
    });
  });

  app.get('/cabinet/ai/usage', async (req) => {
    const cabinetId = await cabinetForRequest(db, req);
    return service.usageSummary(cabinetId);
  });

  // -------------------------------------------------------------- capabilities
  app.get('/cabinet/ai/capabilities', async (req) => {
    const cabinetId = await cabinetForRequest(db, req);
    void cabinetId;
    return {
      providers: service.catalogueForUi().providers.map((p) => ({
        key: p.key,
        label: p.label,
        adapter: p.adapter,
        requiresKey: p.requiresKey,
        capabilities: p.capabilities,
        models: p.models.map((m) => m.id),
      })),
      features: AI_FEATURES,
      demoProvider: config.AI_ALLOW_SIMULATED ? 'simulated' : null,
      sharedPoolEnabled: false,
    };
  });

  // ---------------------------------------------------- company AI: suggestions
  app.post('/companies/:companyId/ai/suggestions/account', async (req, reply) => {
    const user = req.user!;
    const { companyId } = req.params as { companyId: string };
    const { access } = await requireModuleAccess(db, user.id, companyId, 'accounting', 'write');
    void access;
    const { cabinetId } = await cabinetForCompanyUser(db, companyId, user.id);
    const body = parse(suggestionBody, req.body);

    const feature = featureByKey('account_suggestion');
    if (!feature?.implemented) throw notImplemented('NOT_IMPLEMENTED', 'Feature not available');

    const suggestion = await suggestAccount(db, service, {
      cabinetId,
      companyId,
      userId: user.id,
      description: body.description,
      amount: amountToDecimal(body.amount),
      currency: body.currency ?? null,
    });
    return reply.code(201).send({ suggestion, entryCreated: false });
  });

  app.get('/companies/:companyId/ai/suggestions', async (req) => {
    const user = req.user!;
    const { companyId } = req.params as { companyId: string };
    await requireModuleAccess(db, user.id, companyId, 'accounting', 'read');
    const { cabinetId } = await cabinetForCompanyUser(db, companyId, user.id);
    const query = req.query as { limit?: string } | undefined;
    const limit = Number(query?.limit ?? 20);
    return { suggestions: await listSuggestions(db, cabinetId, companyId, Number.isFinite(limit) ? limit : 20) };
  });

  app.post('/companies/:companyId/ai/suggestions/:suggestionId/decision', async (req) => {
    const user = req.user!;
    const { companyId, suggestionId } = req.params as { companyId: string; suggestionId: string };
    await requireModuleAccess(db, user.id, companyId, 'accounting', 'write');
    const { cabinetId } = await cabinetForCompanyUser(db, companyId, user.id);
    const body = parse(decisionBody, req.body);

    const result = await decideSuggestion(db, {
      cabinetId,
      companyId,
      userId: user.id,
      suggestionId,
      decision: body.decision,
      accountId: body.accountId ?? null,
      createRule: body.createRule ?? false,
      keyword: body.keyword ?? null,
    });
    if (result.entryCreated !== false) {
      // Defensive: the AI engine is not allowed to post entries, ever.
      throw forbidden('The AI engine cannot create accounting entries', 'AI_ENTRY_FORBIDDEN');
    }
    return result;
  });

  app.get('/companies/:companyId/ai/rules', async (req) => {
    const user = req.user!;
    const { companyId } = req.params as { companyId: string };
    await requireModuleAccess(db, user.id, companyId, 'accounting', 'read');
    const { cabinetId } = await cabinetForCompanyUser(db, companyId, user.id);
    return { rules: await listRules(db, cabinetId, companyId) };
  });

  app.delete('/companies/:companyId/ai/rules/:ruleId', async (req) => {
    const user = req.user!;
    const { companyId, ruleId } = req.params as { companyId: string; ruleId: string };
    await requireModuleAccess(db, user.id, companyId, 'accounting', 'write');
    const { cabinetId } = await cabinetForCompanyUser(db, companyId, user.id);
    const removed = await deleteRule(db, cabinetId, companyId, ruleId, user.id);
    if (!removed) throw notFound('NOT_FOUND', 'Rule not found');
    return { deleted: true };
  });


  // ------------------------------------------------- AI journal proposals V2
  // The lifecycle is explicit: propose -> (human) validate -> (human) post.
  // Nothing is ever posted automatically and no provider can write an entry.
  app.post('/companies/:companyId/ai/entry-proposals', async (req, reply) => {
    const user = req.user!;
    const { companyId } = req.params as { companyId: string };
    await requireModuleAccess(db, user.id, companyId, 'accounting', 'write');
    const { cabinetId } = await cabinetForCompanyUser(db, companyId, user.id);
    const body = parse(entryProposalBody, req.body);
    const result = await proposeManual(db, service, {
      cabinetId,
      companyId,
      userId: user.id,
      description: body.description,
      amount: dec(body.amount),
      currency: body.currency ?? null,
      entryDate: body.entryDate ?? null,
      reference: body.reference ?? null,
    });
    const duplicates = await proposalDuplicates(
      db,
      companyId,
      {
        entry_date: result.proposal.entryDate,
        description: result.proposal.description,
        reference: result.proposal.reference,
      },
      result.proposal.totals.debit,
    ).catch(() => ({ level: 'none' as const, matches: [] }));
    return reply.code(201).send({
      proposal: result.proposal,
      ruleApplied: result.ruleApplied,
      duplicates,
      entryCreated: false,
    });
  });

  app.post('/companies/:companyId/ai/entry-proposals/from-billing', async (req, reply) => {
    const user = req.user!;
    const { companyId } = req.params as { companyId: string };
    await requireModuleAccess(db, user.id, companyId, 'accounting', 'write');
    const { cabinetId } = await cabinetForCompanyUser(db, companyId, user.id);
    const body = parse(fromBillingBody, req.body);
    const result = await proposeFromBilling(db, service, {
      cabinetId,
      companyId,
      userId: user.id,
      documentId: body.documentId,
      paymentId: body.paymentId,
    });
    return reply.code(result.reused ? 200 : 201).send({
      proposal: result.proposal,
      reused: result.reused,
      entryCreated: false,
    });
  });

  app.get('/companies/:companyId/ai/entry-proposals', async (req) => {
    const user = req.user!;
    const { companyId } = req.params as { companyId: string };
    await requireModuleAccess(db, user.id, companyId, 'accounting', 'read');
    const { cabinetId } = await cabinetForCompanyUser(db, companyId, user.id);
    const query = req.query as { limit?: string } | undefined;
    const limit = Number(query?.limit ?? 30);
    return {
      proposals: await listProposals(db, cabinetId, companyId, Number.isFinite(limit) ? limit : 30),
      lifecycle: ['proposed', 'validated', 'posted'],
      neverPostsAutomatically: true,
    };
  });

  app.get('/companies/:companyId/ai/entry-proposals/:proposalId', async (req) => {
    const user = req.user!;
    const { companyId, proposalId } = req.params as { companyId: string; proposalId: string };
    await requireModuleAccess(db, user.id, companyId, 'accounting', 'read');
    const { cabinetId } = await cabinetForCompanyUser(db, companyId, user.id);
    const loaded = await loadProposal(db, cabinetId, companyId, proposalId);
    return {
      proposal: await viewProposal(db, cabinetId, companyId, loaded.proposal, loaded.lines),
    };
  });

  app.put('/companies/:companyId/ai/entry-proposals/:proposalId', async (req) => {
    const user = req.user!;
    const { companyId, proposalId } = req.params as { companyId: string; proposalId: string };
    await requireModuleAccess(db, user.id, companyId, 'accounting', 'write');
    const { cabinetId } = await cabinetForCompanyUser(db, companyId, user.id);
    const body = parse(proposalUpdateBody, req.body);
    const proposal = await updateProposal(db, cabinetId, companyId, proposalId, user.id, {
      journalId: body.journalId,
      entryDate: body.entryDate,
      reference: body.reference,
      description: body.description,
      currency: body.currency,
      exchangeRate: body.exchangeRate === undefined || body.exchangeRate === null ? body.exchangeRate : String(body.exchangeRate),
      lines: body.lines?.map((l) => ({
        accountId: l.accountId,
        description: l.description ?? null,
        debit: dec(l.debit),
        credit: dec(l.credit),
      })),
    });
    return { proposal, entryCreated: false };
  });

  app.post('/companies/:companyId/ai/entry-proposals/:proposalId/validate', async (req) => {
    const user = req.user!;
    const { companyId, proposalId } = req.params as { companyId: string; proposalId: string };
    await requireModuleAccess(db, user.id, companyId, 'accounting', 'write');
    const { cabinetId } = await cabinetForCompanyUser(db, companyId, user.id);
    const body = parse(validateBody, req.body ?? {});
    const result = await validateProposal(db, cabinetId, companyId, proposalId, user.id, {
      acceptWarnings: body.acceptWarnings ?? false,
    });
    if (result.entryCreated !== false) {
      throw forbidden('The AI engine cannot create accounting entries', 'AI_ENTRY_FORBIDDEN');
    }
    return result;
  });

  app.post('/companies/:companyId/ai/entry-proposals/:proposalId/reject', async (req) => {
    const user = req.user!;
    const { companyId, proposalId } = req.params as { companyId: string; proposalId: string };
    await requireModuleAccess(db, user.id, companyId, 'accounting', 'write');
    const { cabinetId } = await cabinetForCompanyUser(db, companyId, user.id);
    const body = parse(rejectBody, req.body ?? {});
    return {
      proposal: await rejectProposal(db, cabinetId, companyId, proposalId, user.id, body.note ?? null),
      entryCreated: false,
    };
  });

  /** The distinct action that actually writes the entry, through the engine. */
  app.post('/companies/:companyId/ai/entry-proposals/:proposalId/post', async (req) => {
    const user = req.user!;
    const { companyId, proposalId } = req.params as { companyId: string; proposalId: string };
    await requireModuleAccess(db, user.id, companyId, 'accounting', 'write');
    const { cabinetId } = await cabinetForCompanyUser(db, companyId, user.id);
    const result = await postProposal(db, {
      cabinetId,
      companyId,
      proposalId,
      userId: user.id,
      ip: clientIp(req),
    });
    return result;
  });

  // ---------------------------------------------------- learned entry rules
  app.get('/companies/:companyId/ai/entry-rules', async (req) => {
    const user = req.user!;
    const { companyId } = req.params as { companyId: string };
    await requireModuleAccess(db, user.id, companyId, 'accounting', 'read');
    const { cabinetId } = await cabinetForCompanyUser(db, companyId, user.id);
    const q = req.query as { includeInactive?: string } | undefined;
    return {
      rules: await listEntryRules(db, cabinetId, companyId, {
        includeInactive: q?.includeInactive === 'true',
      }),
      notice:
        'Règles déterministes validées par un humain. Aucune donnée d’une autre société n’est utilisée et aucun modèle n’est entraîné.',
    };
  });

  app.post('/companies/:companyId/ai/entry-rules', async (req, reply) => {
    const user = req.user!;
    const { companyId } = req.params as { companyId: string };
    await requireModuleAccess(db, user.id, companyId, 'accounting', 'write');
    const { cabinetId } = await cabinetForCompanyUser(db, companyId, user.id);
    const body = parse(ruleBody, req.body);
    const rule = await saveRule(db, {
      cabinetId,
      companyId,
      userId: user.id,
      ruleType: assertRuleType(body.ruleType),
      matchKey: body.matchKey,
      matchLabel: body.matchLabel ?? null,
      accountId: body.accountId ?? null,
      counterAccountId: body.counterAccountId ?? null,
      journalId: body.journalId ?? null,
      accountSide: body.accountSide,
      priority: body.priority,
      notes: body.notes ?? null,
    });
    return reply.code(201).send({ rule });
  });

  app.post('/companies/:companyId/ai/entry-rules/:ruleId/disable', async (req) => {
    const user = req.user!;
    const { companyId, ruleId } = req.params as { companyId: string; ruleId: string };
    await requireModuleAccess(db, user.id, companyId, 'accounting', 'write');
    const { cabinetId } = await cabinetForCompanyUser(db, companyId, user.id);
    const disabled = await disableEntryRule(db, cabinetId, companyId, ruleId, user.id);
    if (!disabled) throw notFound('AI_RULE_NOT_FOUND', 'Rule not found or already inactive');
    return { disabled: true, deleted: false };
  });

  app.get('/companies/:companyId/ai/entry-rules/history', async (req) => {
    const user = req.user!;
    const { companyId } = req.params as { companyId: string };
    await requireModuleAccess(db, user.id, companyId, 'accounting', 'read');
    const { cabinetId } = await cabinetForCompanyUser(db, companyId, user.id);
    const q = req.query as { ruleType?: string; matchKey?: string } | undefined;
    if (!q?.ruleType || !q?.matchKey) {
      throw badRequest('AI_RULE_INVALID', 'ruleType and matchKey are required');
    }
    return {
      history: await listRuleHistory(db, cabinetId, companyId, assertRuleType(q.ruleType), q.matchKey),
    };
  });

  // -------------------------------------------------------- future automation
  // The engine exposes the contract of the announced features and refuses to
  // run them: nothing is silently simulated.
  app.post('/companies/:companyId/ai/features/:feature', async (req) => {
    const user = req.user!;
    const { companyId, feature: featureKey } = req.params as { companyId: string; feature: string };
    await requireModuleAccess(db, user.id, companyId, 'accounting', 'read');
    const feature = featureByKey(featureKey);
    if (!feature) throw notFound('NOT_FOUND', 'Unknown feature');
    throw notImplemented('NOT_IMPLEMENTED', `Feature "${feature.key}" is announced but not implemented`);
  });
}
