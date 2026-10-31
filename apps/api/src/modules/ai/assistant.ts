import type { Config } from '../../config.js';
import type { Db } from '../../db/index.js';
import { AppError, badRequest, notFound } from '../../lib/errors.js';
import { writeAudit } from '../../lib/audit.js';
import { cabinetForCompanyUser } from '../../lib/cabinets.js';
import { parseAmount } from '../../lib/money.js';
import {
  effectiveAccessFor,
  TOOL_BY_KEY,
  type AssistantAction,
  type AssistantContext,
  type ToolResult,
} from './tools.js';
import type { AIService } from './service.js';
import type { ModuleName } from '../../types.js';

/**
 * Universal contextual assistant - conversation orchestration (mission 7).
 *
 * This layer sits on top of the Mauritius AI Engine (mission 5): same cabinet
 * scope, same kill switch (`ai_settings.enabled`), same module feature flags.
 * It deliberately does **not** create a second AI engine and does **not** call a
 * provider by default: a deterministic intent router selects *one* read-only
 * tool, whose result is rendered from real database rows.
 *
 * Consequences, by design:
 *  - no dossier, no database and no payroll data is ever sent to a provider;
 *  - no figure is invented: every number comes from a SQL row of the active
 *    company, after the server re-checked the user's permissions;
 *  - nothing irreversible can be triggered from a conversation: the only
 *    writing tool creates a *draft proposal* through Assistant V2, and posting
 *    stays a separate human action.
 */

export interface AssistantObjectRef {
  type: 'invoice' | 'proposal' | 'entry' | 'customer' | 'company' | 'task';
  id: string;
}

export interface AssistantContextInput {
  companyId: string;
  module?: ModuleName;
  screen?: string | null;
  locale?: 'fr' | 'en';
  objectRef?: AssistantObjectRef | null;
}

export interface ResolvedContext extends AssistantContext {
  objectRef: AssistantObjectRef | null;
}

const MODULES: ModuleName[] = ['cabinet', 'accounting', 'billing', 'payroll'];
const MAX_TEXT = 600;

export async function resolveAssistantContext(
  db: Db,
  service: AIService,
  userId: string,
  input: AssistantContextInput,
  locale: 'fr' | 'en',
): Promise<ResolvedContext> {
  // The company id comes from the browser but is *never* trusted: membership is
  // re-verified here, then the cabinet scope is re-derived from the database.
  const company = await db.query<{
    id: string;
    name: string;
    functional_currency: string;
    role: string;
  }>(
    `SELECT c.id, c.name, c.functional_currency, m.role
       FROM companies c
       JOIN company_members m ON m.company_id = c.id
      WHERE c.id = $1 AND m.user_id = $2`,
    [input.companyId, userId],
  );
  const row = company.rows[0];
  if (!row) throw notFound('COMPANY_NOT_FOUND', 'Company not found');

  const access = await effectiveAccessFor(db, row.id, userId, row.role as any);
  const requested = input.module && MODULES.includes(input.module) ? input.module : 'cabinet';
  if (access[requested] === 'none') {
    throw new AppError('MODULE_FORBIDDEN', 403, `The "${requested}" module is not accessible`);
  }

  const { cabinetId } = await cabinetForCompanyUser(db, row.id, userId);

  // Explicit kill switch of the existing AI engine: no conversation without it.
  const settings = await service.rawSettings(cabinetId);
  if (!settings.enabled) {
    throw new AppError('AI_DISABLED', 403, 'Artificial intelligence is disabled for this cabinet');
  }

  const objectRef = await validateObjectRef(db, row.id, input.objectRef ?? null);

  return {
    db,
    service,
    userId,
    cabinetId,
    companyId: row.id,
    companyName: row.name,
    functionalCurrency: row.functional_currency,
    locale,
    module: requested,
    screen: sanitizeScreen(input.screen ?? null),
    access,
    objectRef,
  };
}

function sanitizeScreen(screen: string | null): string | null {
  if (!screen) return null;
  const clean = screen.replace(/[^a-zA-Z0-9/_-]/g, '').slice(0, 80);
  return clean || null;
}

async function validateObjectRef(
  db: Db,
  companyId: string,
  ref: AssistantObjectRef | null,
): Promise<AssistantObjectRef | null> {
  if (!ref) return null;
  if (!/^[0-9a-f-]{36}$/i.test(ref.id)) return null;
  const checks: Record<AssistantObjectRef['type'], string> = {
    invoice: 'SELECT 1 FROM billing_documents WHERE id = $1 AND company_id = $2',
    proposal: 'SELECT 1 FROM ai_entry_proposals WHERE id = $1 AND company_id = $2',
    entry: 'SELECT 1 FROM journal_entries WHERE id = $1 AND company_id = $2',
    customer: 'SELECT 1 FROM billing_customers WHERE id = $1 AND company_id = $2',
    company: 'SELECT 1 FROM companies WHERE id = $1 AND id = $2',
    task: 'SELECT 1 FROM cabinet_tasks WHERE id = $1 AND company_id = $2',
  };
  const sql = checks[ref.type];
  if (!sql) return null;
  const res = await db.query(sql, [ref.id, companyId]);
  return res.rowCount === 0 ? null : ref;
}

// ---------------------------------------------------------------------------
// Deterministic intent router
// ---------------------------------------------------------------------------

export type AssistantIntent =
  | 'payroll_status'
  | 'invoices_unpaid'
  | 'invoice_search'
  | 'customer_balance'
  | 'payments_recent'
  | 'approvals_pending'
  | 'tasks_overdue'
  | 'tasks_open'
  | 'deadlines'
  | 'companies'
  | 'accounts_search'
  | 'trial_balance'
  | 'proposal_check'
  | 'proposal_prepare'
  | 'supplier_invoices'
  | 'supplier_balance'
  | 'supplier_duplicates'
  | 'supplier_payments'
  | 'lettering_unlettered'
  | 'lettering_partial'
  | 'lettering_payments'
  | 'fx_rates'
  | 'fx_convert'
  | 'fx_unrated'
  | 'fx_realized'
  | 'help';

const has = (text: string, pattern: RegExp) => pattern.test(text);

export function detectIntent(raw: string): { intent: AssistantIntent; query?: string } {
  const text = raw.toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, ' ').trim();

  if (has(text, /\b(paie|payroll|bulletin|payslip|paye|csg|nsf)\b/)) return { intent: 'payroll_status' };

  // Multi-currency (mission 13). The assistant may read rates and explain a
  // conversion, but it never selects a non-validated rate or posts anything.
  if (
    has(text, /(sans taux|no rate|taux absent|missing rate|non valid|not validated)/) &&
    has(text, /(devise|currency|eur|usd|gbp|change|fx)/)
  ) {
    return { intent: 'fx_unrated' };
  }
  if (has(text, /(taux de change|exchange rate|taux valid|validated rate|taux enregistr)/)) {
    return { intent: 'fx_rates' };
  }
  if (has(text, /(écart réalisé|ecart realise|realized|réalisé|realised)/) && has(text, /(change|fx|devise|currency)/)) {
    return { intent: 'fx_realized' };
  }
  if (
    has(text, /(convert|conversion|équivalent|equivalent|combien.*(eur|usd|gbp|mur)|how much.*(eur|usd|gbp|mur))/)
  ) {
    return { intent: 'fx_convert' };
  }

  // Ledger lettering (mission 12). The assistant only explains and lists:
  // it can never validate, reverse or alter a lettering.
  if (has(text, /(lettr|lettering)/)) {
    if (has(text, /(partiel|partial|explique|explain|pourquoi|why|d[ée]tail)/)) {
      return { intent: 'lettering_partial' };
    }
    if (has(text, /(r[èe]glement|payment|affecter|allocate)/)) {
      return { intent: 'lettering_payments' };
    }
    return { intent: 'lettering_unlettered' };
  }
  if (has(text, /(affecter|unapplied|non affect[ée]|not allocated)/)) {
    return { intent: 'lettering_payments' };
  }

  // Supplier cycle (mission 11). These intents win over generic "facture" or
  // "règlement" wording so the assistant never answers a purchase question with
  // customer data.
  if (has(text, /(doublon|duplicate|deux fois)/) && has(text, /(fournisseur|supplier|achat|purchase)/)) {
    return { intent: 'supplier_duplicates' };
  }
  if (
    has(text, /(solde|balance|dette|dettes|outstanding|aging|[ée]ch[ée]ance)/) &&
    has(text, /(fournisseur|supplier|achat|purchase)/)
  ) {
    return { intent: 'supplier_balance' };
  }
  if (
    has(text, /(r[èe]glement|paiement|payment|virement|acompte)/) &&
    has(text, /(fournisseur|supplier|achat|purchase)/)
  ) {
    return { intent: 'supplier_payments' };
  }
  if (has(text, /(facture|invoice|avoir|credit note)/) && has(text, /(fournisseur|supplier|achat|purchase)/)) {
    return { intent: 'supplier_invoices', query: extractQuery(raw) };
  }

  // "Prepare an entry for this purchase" must win over generic invoice search.
  if (
    has(text, /(pr[ée]pare|prepare|propose|proposer|cr[ée]e|create)/) &&
    has(text, /([ée]criture|entry|achat|purchase|facture d'achat|journal)/)
  ) {
    return { intent: 'proposal_prepare' };
  }
  if (has(text, /(v[ée]rifie|vérifie|check|pourquoi|why|explique|explain)/) &&
      has(text, /([ée]criture|entry|proposition|proposal|[ée]quilibr|balanc)/)) {
    return { intent: 'proposal_check' };
  }
  if (has(text, /(impay[ée]|unpaid|not paid|overdue invoice|reste d[ûu]|outstanding)/) &&
      has(text, /(facture|invoice|client)/)) {
    return { intent: 'invoices_unpaid' };
  }
  if (has(text, /(solde|balance|outstanding)/) && has(text, /(client|customer)/)) {
    return { intent: 'customer_balance', query: extractQuery(raw) };
  }
  if (has(text, /(encaissement|encaissements|payment|payments|r[èe]glement|received)/)) {
    return { intent: 'payments_recent' };
  }
  if (has(text, /(attente|pending|awaiting|validation|approval)/)) {
    return { intent: 'approvals_pending' };
  }
  if (has(text, /(retard|overdue|late|en retard)/) && has(text, /(t[âa]che|task|todo)/)) {
    return { intent: 'tasks_overdue' };
  }
  if (has(text, /([ée]ch[ée]ance|deadline|agenda|calendar|due date)/)) {
    return { intent: 'deadlines' };
  }
  if (has(text, /(t[âa]che|task|todo|to-do|à faire|a faire)/)) {
    return { intent: 'tasks_open' };
  }
  if (has(text, /(facture|invoice)/) &&
      has(text, /(recherch|search|trouv|find|retrouv|look|montre|affiche|show|o[ùu] est|which)/)) {
    return { intent: 'invoice_search', query: extractQuery(raw) };
  }
  if (has(text, /(balance|trial balance|balance g[ée]n[ée]rale)/)) return { intent: 'trial_balance' };
  if (has(text, /(soci[ée]t[ée]s|societe|companies|dossiers|dossier)/) &&
      has(text, /(liste|list|recherch|search|accessible|mes)/)) {
    return { intent: 'companies', query: extractQuery(raw) };
  }
  if (has(text, /(compte|account|comptes)/) &&
      has(text, /(recherch|search|trouv|find|cherch|quel|which|o[ùu])/)) {
    return { intent: 'accounts_search', query: extractQuery(raw) };
  }
  if (has(text, /(facture|invoice)/) && has(text, /(impay|unpaid|due)/)) return { intent: 'invoices_unpaid' };
  return { intent: 'help' };
}

/** Removes the instruction words so only a search term remains (never a number). */
export function extractQuery(raw: string): string | undefined {
  const cleaned = raw
    .replace(/[’']/g, "'")
    .replace(
      /\b(montre|montrer|affiche|afficher|liste|list|recherche|rechercher|cherche|chercher|trouve|trouver|retrouve|retrouver|show|find|search|quelles?|quels?|which|what|les?|la|le|des?|de|du|d'|pour|for|soci[ée]t[ée]|societe|company|dossier|factures?|invoices?|client|clients?|customers?|compte|comptes?|accounts?)\b/gi,
      ' ',
    )
    .replace(/\d+/g, ' ')
    .replace(/[?!.,;:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.length >= 2 ? cleaned.slice(0, 60) : undefined;
}

export function extractAmount(raw: string): { amount: string; currency?: string } | null {
  const pattern = /(\d{1,3}(?:[ \u00a0]\d{3})+|\d+)(?:[.,](\d{1,4}))?/g;
  let best: { amount: string; currency?: string } | null = null;
  for (const match of raw.matchAll(pattern)) {
    const integer = match[1]!.replace(/[ \u00a0]/g, '');
    const fraction = (match[2] ?? '').padEnd(4, '0');
    const value = `${integer}.${fraction || '0000'}`;
    if (parseAmount(value) <= 0n) continue;
    const currencyMatch = raw
      .slice((match.index ?? 0) + match[0].length)
      .match(/\s*(MUR|EUR|USD|GBP)\b/i);
    best = { amount: value, ...(currencyMatch ? { currency: currencyMatch[1]!.toUpperCase() } : {}) };
  }
  return best;
}

/**
 * Account searches keep their numeric codes: "cherche le compte 6000" must
 * query the chart of accounts, never fall back to a trial balance.
 */
export function extractAccountQuery(raw: string): string | undefined {
  const code = raw.match(/\b\d{3,10}\b/);
  if (code) return code[0]!.slice(0, 20);
  const cleaned = raw
    .replace(/[’']/g, "'")
    .replace(
      /\b(recherche|rechercher|cherche|chercher|trouve|trouver|montre|afficher|affiche|search|find|show|quel|quelle|which|le|la|les|un|une|du|de|des|compte|comptes|account|accounts|dans|in|plan|comptable|chart|of)\b/gi,
      ' ',
    )
    .replace(/[?!.,;:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.length >= 2 ? cleaned.slice(0, 40) : undefined;
}

function prepareDescription(raw: string): string {
  const cleaned = raw
    .replace(/[’']/g, "'")
    .replace(
      /\b(pr[ée]pare|prepare|propose|proposer|cr[ée]e|create|une?|[ée]criture|entry|comptable|accounting|pour|for|moi|please|s'il te pla[îi]t)\b/gi,
      ' ',
    )
    .replace(/\b\d{1,3}(?:[ \u00a0]\d{3})*(?:[.,]\d{1,4})?\s*(MUR|EUR|USD|GBP)?\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const description = cleaned.length >= 5 ? cleaned.slice(0, 300) : raw.trim().slice(0, 300);
  return description.length >= 5 ? description : `Écriture demandée : ${raw.trim().slice(0, 120)}`;
}

// ---------------------------------------------------------------------------
// Conversations
// ---------------------------------------------------------------------------

export interface ConversationRow {
  id: string;
  cabinet_id: string;
  company_id: string;
  user_id: string;
  module: ModuleName;
  screen: string | null;
  locale: 'fr' | 'en';
  title: string | null;
  status: 'open' | 'closed';
  expires_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface MessageRow {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  context: Record<string, unknown>;
  payload: Record<string, unknown>;
  created_at: string;
}

export interface ToolRunRow {
  id: string;
  tool_key: string;
  module: string;
  status: 'ok' | 'denied' | 'error';
  error_code: string | null;
  row_count: number | null;
  duration_ms: number | null;
  created_at: string;
}

const conversationView = (row: ConversationRow) => ({
  id: row.id,
  companyId: row.company_id,
  module: row.module,
  screen: row.screen,
  locale: row.locale,
  title: row.title,
  status: row.status,
  expiresAt: row.expires_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const messageView = (row: MessageRow) => ({
  id: row.id,
  role: row.role,
  content: row.content,
  context: row.context,
  payload: row.payload,
  createdAt: row.created_at,
});

export async function createConversation(
  db: Db,
  service: AIService,
  userId: string,
  input: AssistantContextInput,
  locale: 'fr' | 'en',
  config: Config,
): Promise<{ conversation: ReturnType<typeof conversationView>; context: Record<string, unknown> }> {
  const ctx = await resolveAssistantContext(db, service, userId, input, locale);
  await purgeExpired(db, ctx.companyId);

  const active = await db.query<ConversationRow>(
    `SELECT * FROM ai_conversations
      WHERE company_id = $1 AND user_id = $2 AND status = 'open'
        AND updated_at > now() - interval '12 hours'
      ORDER BY updated_at DESC LIMIT 1`,
    [ctx.companyId, userId],
  );

  const expiresAt = new Date(Date.now() + config.AI_CONVERSATION_RETENTION_DAYS * 86_400_000).toISOString();
  const conversation =
    active.rows[0] ??
    (
      await db.query<ConversationRow>(
        `INSERT INTO ai_conversations
           (cabinet_id, company_id, user_id, module, screen, locale, title, expires_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         RETURNING *`,
        [
          ctx.cabinetId,
          ctx.companyId,
          userId,
          ctx.module,
          ctx.screen,
          locale,
          null,
          expiresAt,
        ],
      )
    ).rows[0]!;

  await writeAudit(db, {
    companyId: ctx.companyId,
    userId,
    action: 'ai.conversation.open',
    entityType: 'ai_conversation',
    entityId: conversation.id,
    details: { module: ctx.module, screen: ctx.screen },
  });

  return {
    conversation: conversationView(conversation),
    context: contextPayload(ctx),
  };
}

export function contextPayload(ctx: ResolvedContext): Record<string, unknown> {
  return {
    module: ctx.module,
    screen: ctx.screen,
    companyId: ctx.companyId,
    companyName: ctx.companyName,
    locale: ctx.locale,
    permissions: ctx.access,
    objectRef: ctx.objectRef,
  };
}

export async function listConversations(
  db: Db,
  companyId: string,
  userId: string,
  limit = 20,
): Promise<ReturnType<typeof conversationView>[]> {
  const res = await db.query<ConversationRow>(
    `SELECT * FROM ai_conversations
      WHERE company_id = $1 AND user_id = $2 AND status = 'open'
      ORDER BY updated_at DESC LIMIT $3`,
    [companyId, userId, Math.min(Math.max(limit, 1), 50)],
  );
  return res.rows.map(conversationView);
}

export async function loadConversation(
  db: Db,
  companyId: string,
  userId: string,
  conversationId: string,
): Promise<{ conversation: ConversationRow; messages: MessageRow[]; toolRuns: ToolRunRow[] }> {
  if (!/^[0-9a-f-]{36}$/i.test(conversationId)) {
    throw notFound('AI_CONVERSATION_NOT_FOUND', 'Conversation not found');
  }
  const res = await db.query<ConversationRow>(
    `SELECT * FROM ai_conversations WHERE id = $1 AND company_id = $2 AND user_id = $3`,
    [conversationId, companyId, userId],
  );
  const conversation = res.rows[0];
  if (!conversation) throw notFound('AI_CONVERSATION_NOT_FOUND', 'Conversation not found');
  const messages = await db.query<MessageRow>(
    `SELECT * FROM ai_messages WHERE conversation_id = $1 ORDER BY created_at LIMIT 200`,
    [conversationId],
  );
  const runs = await db.query<ToolRunRow>(
    `SELECT id, tool_key, module, status, error_code, row_count, duration_ms, created_at
       FROM ai_tool_runs WHERE conversation_id = $1 ORDER BY created_at DESC LIMIT 50`,
    [conversationId],
  );
  return { conversation, messages: messages.rows, toolRuns: runs.rows };
}

async function purgeExpired(db: Db, companyId: string): Promise<void> {
  await db.query(
    `DELETE FROM ai_conversations
      WHERE company_id = $1 AND expires_at IS NOT NULL AND expires_at < now()`,
    [companyId],
  );
}

export interface TurnResult {
  conversation: ReturnType<typeof conversationView>;
  messages: ReturnType<typeof messageView>[];
  context: Record<string, unknown>;
  toolRuns: { tool: string; status: string; rowCount: number | null }[];
  actions: AssistantAction[];
}

export async function runAssistantTurn(
  db: Db,
  service: AIService,
  userId: string,
  conversationId: string,
  companyId: string,
  rawText: string,
  config: Config,
): Promise<TurnResult> {
  const text = normalizeText(rawText);
  if (text.length < 2) throw badRequest('AI_INPUT_TOO_LONG', 'Message too short');

  const loaded = await loadConversation(db, companyId, userId, conversationId);
  const conversation = loaded.conversation;
  if (conversation.status !== 'open') throw badRequest('AI_CONVERSATION_CLOSED', 'Conversation closed');

  const userTurns = await db.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM ai_messages
      WHERE conversation_id = $1 AND role = 'user'`,
    [conversation.id],
  );
  if (Number(userTurns.rows[0]?.count ?? 0) >= config.AI_ASSISTANT_MAX_TURNS) {
    throw new AppError(
      'AI_ASSISTANT_TURN_LIMIT',
      429,
      'This conversation reached its message limit: open a new conversation',
    );
  }
  const recent = await db.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM ai_messages m
       JOIN ai_conversations c ON c.id = m.conversation_id
      WHERE c.user_id = $1 AND m.role = 'user' AND m.created_at > now() - interval '1 hour'`,
    [userId],
  );
  if (Number(recent.rows[0]?.count ?? 0) >= 120) {
    throw new AppError('AI_RATE_LIMITED', 429, 'Too many assistant messages in one hour');
  }

  const ctx = await resolveAssistantContext(
    db,
    service,
    userId,
    {
      companyId,
      module: conversation.module,
      screen: conversation.screen,
      locale: conversation.locale,
    },
    conversation.locale,
  );
  if (ctx.cabinetId !== conversation.cabinet_id) {
    throw notFound('AI_CONVERSATION_NOT_FOUND', 'Conversation not found');
  }

  const userMessage = (
    await db.query<MessageRow>(
      `INSERT INTO ai_messages (conversation_id, role, content, context, payload)
       VALUES ($1, 'user', $2, $3::jsonb, '{}'::jsonb) RETURNING *`,
      [conversation.id, text, JSON.stringify(contextPayload(ctx))],
    )
  ).rows[0]!;

  const { intent, ...rest } = detectIntent(text);

  // Without an explicit object reference, a check request targets the most
  // recent proposal of the active company — never a proposal of another one.
  if (intent === 'proposal_check' && !ctx.objectRef) {
    const latest = await db.query<{ id: string }>(
      `SELECT id FROM ai_entry_proposals
        WHERE company_id = $1 AND status IN ('proposed', 'validated')
        ORDER BY created_at DESC LIMIT 1`,
      [companyId],
    );
    if (latest.rows[0]) ctx.objectRef = { type: 'proposal', id: latest.rows[0].id };
  }
  const started = Date.now();
  let toolKey: string | null = null;
  let toolArgs: Record<string, unknown> = {};
  let toolResult: ToolResult | null = null;
  let errorCode: string | null = null;
  let denial: string | null = null;

  try {
    const plan = planTool(intent, text, ctx, rest.query);
    if (plan) {
      toolKey = plan.key;
      toolArgs = plan.args;
      const tool = TOOL_BY_KEY.get(plan.key)!;
      const parsed = tool.args.safeParse(plan.args);
      if (!parsed.success) {
        throw badRequest('AI_TOOL_ARGUMENTS_INVALID', 'The tool arguments are invalid');
      }
      toolResult = await tool.run(ctx, parsed.data);
    }
  } catch (err) {
    if (err instanceof AppError && (err.code === 'MODULE_FORBIDDEN' || err.code === 'COMPANY_NOT_FOUND')) {
      denial = err.code;
      errorCode = err.code;
    } else if (err instanceof AppError) {
      errorCode = err.code;
    } else {
      errorCode = 'AI_TOOL_ERROR';
    }
  }
  const duration = Date.now() - started;

  if (toolKey) {
    await db.query(
      `INSERT INTO ai_tool_runs
         (conversation_id, message_id, company_id, user_id, tool_key, module, args, status, error_code, row_count, duration_ms)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11)`,
      [
        conversation.id,
        userMessage.id,
        companyId,
        userId,
        toolKey,
        TOOL_BY_KEY.get(toolKey)?.module ?? ctx.module,
        JSON.stringify(toolArgs),
        toolResult ? 'ok' : denial ? 'denied' : 'error',
        errorCode,
        toolResult?.rowCount ?? null,
        duration,
      ],
    );
  }

  const content = composeReply(ctx, intent, toolResult, errorCode, denial);
  const actions = toolResult?.actions ?? [];
  const payload = {
    intent,
    toolKey,
    toolStatus: toolResult ? 'ok' : errorCode ? 'error' : 'none',
    actions,
    context: contextPayload(ctx),
    ...(toolResult ? { data: toolResult.data } : {}),
  };

  const assistantMessage = (
    await db.query<MessageRow>(
      `INSERT INTO ai_messages (conversation_id, role, content, context, payload)
       VALUES ($1, 'assistant', $2, $3::jsonb, $4::jsonb) RETURNING *`,
      [conversation.id, content, JSON.stringify(contextPayload(ctx)), JSON.stringify(payload)],
    )
  ).rows[0]!;

  await db.query(
    `UPDATE ai_conversations
        SET updated_at = now(),
            title = COALESCE(title, $2),
            module = $3,
            screen = $4
      WHERE id = $1`,
    [conversation.id, text.slice(0, 80), ctx.module, ctx.screen],
  );

  await writeAudit(db, {
    companyId,
    userId,
    action: 'ai.conversation.message',
    entityType: 'ai_conversation',
    entityId: conversation.id,
    details: { intent, tool: toolKey, status: toolResult ? 'ok' : (errorCode ?? 'none') },
  });

  const refreshed = await db.query<ConversationRow>('SELECT * FROM ai_conversations WHERE id = $1', [
    conversation.id,
  ]);

  return {
    conversation: conversationView(refreshed.rows[0]!),
    messages: [messageView(userMessage), messageView(assistantMessage)],
    context: contextPayload(ctx),
    toolRuns: toolKey
      ? [
          {
            tool: toolKey,
            status: toolResult ? 'ok' : denial ? 'denied' : 'error',
            rowCount: toolResult?.rowCount ?? null,
          },
        ]
      : [],
    actions,
  };
}

function normalizeText(raw: string): string {
  // Control characters are stripped; the length is bounded. The text is never
  // concatenated into an SQL string nor trusted as an instruction.
  return raw
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_TEXT);
}

function planTool(
  intent: AssistantIntent,
  text: string,
  ctx: ResolvedContext,
  query?: string,
): { key: string; args: Record<string, unknown> } | null {
  switch (intent) {
    case 'payroll_status':
      return { key: 'payroll.status', args: {} };
    case 'invoices_unpaid':
      return { key: 'billing.invoices.unpaid', args: { limit: 10 } };
    case 'invoice_search':
      return { key: 'billing.invoices.search', args: { ...(query ? { query } : {}), limit: 10 } };
    case 'customer_balance':
      return { key: 'billing.customers.balance', args: query ? { customerName: query } : {} };
    case 'payments_recent':
      return { key: 'billing.payments.recent', args: { limit: 10 } };
    case 'approvals_pending':
      return { key: 'billing.approvals.pending', args: {} };
    case 'tasks_overdue':
      return { key: 'cabinet.tasks.overdue', args: {} };
    case 'tasks_open':
      return { key: 'cabinet.tasks.open', args: { limit: 20 } };
    case 'deadlines':
      return { key: 'cabinet.deadlines', args: { days: 30 } };
    case 'companies':
      return { key: 'cabinet.companies', args: query ? { query } : {} };
    case 'accounts_search': {
      const accountQuery = extractAccountQuery(text);
      return accountQuery
        ? { key: 'accounting.accounts.search', args: { query: accountQuery } }
        : { key: 'accounting.trialBalance', args: {} };
    }
    case 'trial_balance':
      return { key: 'accounting.trialBalance', args: {} };
    case 'proposal_check':
      return ctx.objectRef?.type === 'proposal'
        ? { key: 'accounting.proposal.check', args: { proposalId: ctx.objectRef.id } }
        : { key: 'billing.approvals.pending', args: {} };
    case 'supplier_invoices':
      return { key: 'purchases.invoices.search', args: { ...(query ? { query } : {}), limit: 10 } };
    case 'supplier_balance':
      return { key: 'purchases.aging', args: { days: 30 } };
    case 'supplier_duplicates':
      return { key: 'purchases.duplicates', args: {} };
    case 'supplier_payments':
      return { key: 'purchases.payments.recent', args: { limit: 10 } };
    case 'lettering_unlettered':
      return { key: 'lettering.unlettered', args: { limit: 20 } };
    case 'lettering_partial':
      return ctx.objectRef?.type === 'entry'
        ? { key: 'lettering.partial', args: { limit: 10 } }
        : { key: 'lettering.partial', args: { limit: 10 } };
    case 'lettering_payments':
      return { key: 'lettering.payments', args: { limit: 10 } };
    case 'fx_rates':
      return { key: 'fx.rates', args: { limit: 20 } };
    case 'fx_unrated':
      return { key: 'fx.unrated', args: { limit: 20 } };
    case 'fx_realized':
      return { key: 'fx.realized', args: { limit: 20 } };
    case 'fx_convert': {
      const amount = extractAmount(text);
      if (!amount) return null;
      const currencies = [...text.matchAll(/\b(MUR|EUR|USD|GBP)\b/gi)].map((m) =>
        m[1]!.toUpperCase(),
      );
      const unique = [...new Set(currencies)];
      const from = unique[0] ?? amount.currency ?? ctx.functionalCurrency;
      const to = unique.find((c) => c !== from) ?? ctx.functionalCurrency;
      if (from === to) return null;
      return {
        key: 'fx.convert',
        args: {
          amount: amount.amount,
          from,
          to,
          date: new Date().toISOString().slice(0, 10),
        },
      };
    }
    case 'proposal_prepare': {
      const amount = extractAmount(text);
      return {
        key: 'accounting.proposal.prepare',
        args: {
          description: prepareDescription(text),
          ...(amount ? { amount: amount.amount } : {}),
          ...(amount?.currency ? { currency: amount.currency } : {}),
        },
      };
    }
    default:
      return null;
  }
}

function composeReply(
  ctx: ResolvedContext,
  intent: AssistantIntent,
  toolResult: ToolResult | null,
  errorCode: string | null,
  denial: string | null,
): string {
  const fr = ctx.locale === 'fr';
  if (denial === 'MODULE_FORBIDDEN') {
    return fr
      ? 'Votre rôle ne donne pas accès aux données nécessaires pour cette demande. Aucune donnée n’a été lue.'
      : 'Your role does not grant access to the data required for this request. No data was read.';
  }
  if (errorCode === 'AI_INPUT_INCOMPLETE') {
    return fr
      ? [
          'Il manque une information pour préparer cette écriture : le montant (et sa devise) est obligatoire.',
          'Aucune écriture n’a été créée. Précisez le montant hors taxes, par exemple : « Prépare une écriture pour un achat de 3 250 MUR ».',
        ].join('\n')
      : [
          'One piece of information is missing to prepare this entry: the amount (and its currency) is required.',
          'No entry was created. State the net amount, for example: “Prepare an entry for a purchase of 3 250 MUR”.',
        ].join('\n');
  }
  if (errorCode === 'AI_PROPOSAL_INVALID' || errorCode === 'AI_INVALID_RESPONSE') {
    return fr
      ? 'La proposition n’a pas pu être préparée avec les comptes réellement disponibles. Aucun compte n’a été inventé. Vérifiez le plan comptable ou précisez la contrepartie.'
      : 'The proposal could not be prepared from the accounts actually available. No account was invented. Check the chart of accounts or specify the counter account.';
  }
  if (errorCode && !toolResult) {
    return fr
      ? `La demander n’a pas pu être exécutée (${errorCode}). Aucune donnée n’a été modifiée.`
      : `The request could not be executed (${errorCode}). No data was changed.`;
  }
  if (toolResult) {
    const lines = fr ? toolResult.lines.fr : toolResult.lines.en;
    const footer = fr
      ? '\nDonnées lues dans le dossier actif, selon vos permissions. Aucune écriture comptable n’a été créée.'
      : '\nData read from the active dossier, within your permissions. No accounting entry was created.';
    return `${lines.join('\n')}${intent === 'payroll_status' ? '' : footer}`;
  }
  return fr
    ? [
        'Cette demande n’est pas encore prise en charge par l’assistant.',
        'Demandes disponibles : factures impayées, recherche de facture, solde client, encaissements récents, tâches du cabinet (dont retards), échéances, sociétés accessibles, recherche de compte, balance, vérification d’une proposition, préparation d’une écriture, état de la paie.',
        'Aucune donnée n’a été inventée et aucune opération n’a été exécutée.',
      ].join('\n')
    : [
        'This request is not supported by the assistant yet.',
        'Supported requests: unpaid invoices, invoice search, customer balance, recent payments, supplier invoices and payments, supplier debt by currency, potential supplier duplicates, cabinet tasks (including overdue), deadlines, accessible companies, account search, trial balance, proposal check, entry preparation, payroll status.',
        'No data was invented and no operation was executed.',
      ].join('\n');
}

export async function closeConversation(
  db: Db,
  companyId: string,
  userId: string,
  conversationId: string,
): Promise<{ closed: true }> {
  const res = await db.query(
    `UPDATE ai_conversations SET status = 'closed', updated_at = now()
      WHERE id = $1 AND company_id = $2 AND user_id = $3 RETURNING id`,
    [conversationId, companyId, userId],
  );
  if (res.rowCount === 0) throw notFound('AI_CONVERSATION_NOT_FOUND', 'Conversation not found');
  return { closed: true };
}
