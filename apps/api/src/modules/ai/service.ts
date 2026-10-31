import type { Config } from '../../config.js';
import type { Db } from '../../db/index.js';
import { writeAudit } from '../../lib/audit.js';
import { AppError, badRequest, forbidden, notFound } from '../../lib/errors.js';
import {
  buildKeyring,
  decryptSecret,
  encryptSecret,
  type EncryptionKeyring,
} from './crypto.js';
import { checkBaseUrl, modelById, providerByKey } from './catalogue.js';
import { estimateCost } from './cost.js';
import type { ProviderRegistry } from './registry.js';
import {
  AIProviderError,
  type AICatalogue,
  type AIModule,
  type AIProviderDefinition,
  type AIResponseSchema,
  type AIUsage,
} from './types.js';

export interface AISettingsRow {
  cabinet_id: string;
  enabled: boolean;
  primary_provider: string | null;
  primary_model: string | null;
  fallback_provider: string | null;
  fallback_model: string | null;
  routing_mode: 'manual' | 'automatic';
  monthly_budget_usd: string | null;
  monthly_request_limit: number | null;
  alert_threshold: number;
  features: Record<string, boolean>;
  provider_options: Record<string, { baseUrl?: string }>;
  shared_pool_enabled: boolean;
  updated_by: string | null;
  updated_at: string;
}

export interface UsageSummary {
  month: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: string | null;
  costKnown: boolean;
  byProvider: { provider: string; model: string; requests: number; estimatedCostUsd: string | null }[];
  byModule: { module: string; requests: number }[];
  budget: {
    limitUsd: string | null;
    requestLimit: number | null;
    usedUsd: string | null;
    percent: number | null;
    state: 'ok' | 'warning' | 'exceeded' | 'unknown';
  };
}

export interface ProviderView {
  key: string;
  label: string;
  adapter: string;
  requiresKey: boolean;
  docsUrl: string;
  notes: string;
  baseUrlConfigurable: boolean;
  baseUrl: string | null;
  models: { id: string; label: string }[];
  capabilities: AIProviderDefinition['capabilities'];
  configured: boolean;
  available: boolean;
  priceVerified: boolean;
}

export interface CabinetSettingsView {
  cabinetId: string;
  enabled: boolean;
  routingMode: 'manual' | 'automatic';
  primary: { provider: string | null; model: string | null };
  fallback: { provider: string | null; model: string | null };
  monthlyBudgetUsd: string | null;
  monthlyRequestLimit: number | null;
  alertThreshold: number;
  features: Record<string, boolean>;
  sharedPoolEnabled: false;
  encryptionReady: boolean;
  simulatedAvailable: boolean;
  providers: ProviderView[];
  usage: UsageSummary;
}

export interface CompleteParams {
  cabinetId: string;
  companyId: string | null;
  module: AIModule;
  feature: string;
  userId: string | null;
  system: string;
  user: string;
  responseSchema: AIResponseSchema | null;
  maxOutputTokens?: number;
  temperature?: number;
  /** Cabinet-selected provider, used instead of the default when permitted. */
  provider?: { provider: string; model: string } | null;
}

export interface CompleteResult {
  text: string;
  provider: string;
  model: string;
  usage: AIUsage;
  latencyMs: number;
  estimatedCostUsd: string | null;
}

const FEATURE_MODULES: AIModule[] = ['accounting', 'billing', 'payroll', 'cabinet'];

function monthStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Mauritius AI Engine.
 *
 * Single entry point for every AI feature of the suite. It owns:
 * provider selection (manual or constrained automatic), credential decryption,
 * budget and request caps, rate limiting, timeouts and limited retries, usage
 * accounting and audit. Business modules only describe *what* they need.
 */
export class AIService {
  private readonly keyring: EncryptionKeyring | null;
  /** Sliding window of request timestamps, per cabinet (in-process limiter). */
  private readonly windows = new Map<string, number[]>();

  constructor(
    private readonly db: Db,
    private readonly config: Config,
    private readonly catalogue: AICatalogue,
    private readonly registry: ProviderRegistry,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.keyring = buildKeyring(
      config.AI_ENCRYPTION_KEY,
      config.AI_ENCRYPTION_KEY_VERSION,
      config.AI_ENCRYPTION_PREVIOUS_KEYS,
    );
  }

  // ------------------------------------------------------------------ settings
  async rawSettings(cabinetId: string): Promise<AISettingsRow> {
    const existing = await this.db.query<AISettingsRow>(
      'SELECT * FROM ai_settings WHERE cabinet_id = $1',
      [cabinetId],
    );
    if (existing.rows[0]) return existing.rows[0];
    const inserted = await this.db.query<AISettingsRow>(
      `INSERT INTO ai_settings (cabinet_id) VALUES ($1)
       ON CONFLICT (cabinet_id) DO UPDATE SET cabinet_id = EXCLUDED.cabinet_id
       RETURNING *`,
      [cabinetId],
    );
    return inserted.rows[0]!;
  }

  async credentialProviders(cabinetId: string): Promise<Set<string>> {
    const res = await this.db.query<{ provider: string }>(
      'SELECT provider FROM ai_credentials WHERE cabinet_id = $1 AND revoked_at IS NULL',
      [cabinetId],
    );
    return new Set(res.rows.map((r) => r.provider));
  }

  async settingsView(cabinetId: string): Promise<CabinetSettingsView> {
    const settings = await this.rawSettings(cabinetId);
    const configured = await this.credentialProviders(cabinetId);
    const usage = await this.usageSummary(cabinetId);

    const verified = new Set(
      (
        await this.db.query<{ provider: string; model: string }>(
          'SELECT DISTINCT provider, model FROM ai_prices WHERE verified = true',
        )
      ).rows.map((r) => `${r.provider}:${r.model}`),
    );

    const providers: ProviderView[] = this.catalogue.providers
      .filter((p) => p.key !== 'simulated' || this.config.AI_ALLOW_SIMULATED)
      .map((definition) => {
        const override = settings.provider_options[definition.key]?.baseUrl;
        return {
          key: definition.key,
          label: definition.label,
          adapter: definition.adapter,
          requiresKey: definition.requiresKey,
          docsUrl: definition.docsUrl,
          notes: definition.notes,
          baseUrlConfigurable: definition.baseUrlConfigurable,
          baseUrl: definition.baseUrlConfigurable
            ? (override ?? definition.baseUrl ?? null)
            : definition.baseUrl,
          models: definition.models.map((m) => ({ id: m.id, label: m.label })),
          capabilities: definition.capabilities,
          configured: configured.has(definition.key) || !definition.requiresKey,
          available: this.registry.available(definition.key),
          priceVerified: definition.models.some((m) => verified.has(`${definition.key}:${m.id}`)),
        };
      });

    return {
      cabinetId,
      enabled: settings.enabled && this.config.AI_ENABLED,
      routingMode: settings.routing_mode,
      primary: { provider: settings.primary_provider, model: settings.primary_model },
      fallback: { provider: settings.fallback_provider, model: settings.fallback_model },
      monthlyBudgetUsd: settings.monthly_budget_usd,
      monthlyRequestLimit: settings.monthly_request_limit,
      alertThreshold: settings.alert_threshold,
      features: settings.features,
      sharedPoolEnabled: false,
      encryptionReady: this.keyring !== null,
      simulatedAvailable: this.config.AI_ALLOW_SIMULATED,
      providers,
      usage,
    };
  }

  /** Validates a provider/model pair against the catalogue. */
  private resolveModel(
    providerKey: string | null,
    modelId: string | null,
    options: { allowEmptyModels?: boolean } = {},
  ): { definition: AIProviderDefinition; model: string } {
    const definition = providerByKey(this.catalogue, providerKey);
    if (!definition) throw badRequest('AI_PROVIDER_NOT_ALLOWED', 'Unknown provider');
    if (definition.key === 'simulated' && !this.config.AI_ALLOW_SIMULATED) {
      throw badRequest('AI_PROVIDER_NOT_ALLOWED', 'Simulated provider is disabled');
    }
    if (definition.models.length === 0 && !options.allowEmptyModels) {
      throw badRequest('AI_MODEL_NOT_ALLOWED', 'This provider requires an explicit model name');
    }
    if (modelId && !modelById(definition, modelId)) {
      throw badRequest('AI_MODEL_NOT_ALLOWED', 'Unknown model for this provider');
    }
    if (!modelId && !options.allowEmptyModels) {
      throw badRequest('AI_MODEL_NOT_ALLOWED', 'Model is required');
    }
    return { definition, model: modelId ?? '' };
  }

  // ---------------------------------------------------------------- credentials
  async putCredential(params: {
    cabinetId: string;
    userId: string;
    provider: string;
    apiKey: string;
    baseUrl?: string | null;
  }): Promise<void> {
    if (!this.keyring) {
      throw new AppError(
        'AI_ENCRYPTION_NOT_CONFIGURED',
        503,
        'API key storage is disabled: AI_ENCRYPTION_KEY is not configured',
      );
    }
    const { definition } = this.resolveModel(params.provider, null, { allowEmptyModels: true });

    const key = params.apiKey.trim();
    if (key.length < 8 || key.length > 512) {
      throw badRequest('VALIDATION_ERROR', 'Invalid API key format');
    }
    // Refuse characters that would break headers or logs.
    if (/[\s\u0000-\u001f\u007f]/.test(key)) {
      throw badRequest('VALIDATION_ERROR', 'Invalid API key format');
    }

    if (params.baseUrl !== undefined && params.baseUrl !== null) {
      if (!definition.baseUrlConfigurable) {
        throw badRequest('AI_PROVIDER_NOT_ALLOWED', 'This provider does not accept a custom base URL');
      }
      const check = checkBaseUrl(params.baseUrl, {
        allowPrivateHosts: this.config.AI_ALLOW_PRIVATE_BASE_URL,
        allowHttp: this.config.NODE_ENV !== 'production',
      });
      if (!check.ok) throw badRequest('AI_BASE_URL_INVALID', `Base URL rejected (${check.reason})`);
    }

    const encrypted = encryptSecret(key, this.keyring, {
      cabinetId: params.cabinetId,
      provider: definition.key,
    });

    await this.db.transaction(async (tx) => {
      await tx.query(
        `UPDATE ai_credentials SET revoked_at = now()
          WHERE cabinet_id = $1 AND provider = $2 AND revoked_at IS NULL`,
        [params.cabinetId, definition.key],
      );
      await tx.query(
        `INSERT INTO ai_credentials (cabinet_id, provider, ciphertext, key_version, created_by)
         VALUES ($1, $2, $3, $4, $5)`,
        [params.cabinetId, definition.key, encrypted.ciphertext, encrypted.keyVersion, params.userId],
      );
      if (params.baseUrl) {
        await tx.query(
          `UPDATE ai_settings
              SET provider_options = jsonb_set(provider_options, ARRAY[$2], jsonb_build_object('baseUrl', $3::text), true),
                  updated_by = $4, updated_at = now()
            WHERE cabinet_id = $1`,
          [params.cabinetId, definition.key, params.baseUrl, params.userId],
        );
      }
      await writeAudit(tx, {
        userId: params.userId,
        action: 'ai.credential.set',
        entityType: 'ai_credential',
        entityId: null,
        details: { cabinetId: params.cabinetId, provider: definition.key, keyVersion: encrypted.keyVersion },
      });
    });
  }

  async deleteCredential(params: {
    cabinetId: string;
    userId: string;
    provider: string;
  }): Promise<boolean> {
    const res = await this.db.query(
      `UPDATE ai_credentials SET revoked_at = now()
        WHERE cabinet_id = $1 AND provider = $2 AND revoked_at IS NULL`,
      [params.cabinetId, params.provider],
    );
    if (res.rowCount > 0) {
      await writeAudit(this.db, {
        userId: params.userId,
        action: 'ai.credential.delete',
        entityType: 'ai_credential',
        details: { cabinetId: params.cabinetId, provider: params.provider },
      });
    }
    return res.rowCount > 0;
  }

  /** Decrypts the key for one provider. Never exposed outside this class. */
  private async keyFor(
    cabinetId: string,
    provider: string,
    requiresKey: boolean,
  ): Promise<string | null> {
    const res = await this.db.query<{ ciphertext: string; key_version: string }>(
      `SELECT ciphertext, key_version FROM ai_credentials
        WHERE cabinet_id = $1 AND provider = $2 AND revoked_at IS NULL
        ORDER BY created_at DESC LIMIT 1`,
      [cabinetId, provider],
    );
    const row = res.rows[0];
    if (!row) {
      if (requiresKey) throw new AppError('AI_KEY_MISSING', 400, 'No API key configured');
      return null;
    }
    if (!this.keyring) {
      throw new AppError('AI_ENCRYPTION_NOT_CONFIGURED', 503, 'Encryption key unavailable');
    }
    try {
      return decryptSecret(
        { ciphertext: row.ciphertext, keyVersion: row.key_version },
        this.keyring,
        { cabinetId, provider },
      );
    } catch {
      throw new AppError('AI_KEY_MISSING', 400, 'Stored API key cannot be decrypted');
    }
  }

  // --------------------------------------------------------------------- usage
  async usageSummary(cabinetId: string): Promise<UsageSummary> {
    const start = monthStart(this.now());
    const month = start.toISOString().slice(0, 7);

    const totals = await this.db.query<{
      requests: string;
      input_tokens: string;
      output_tokens: string;
      cost: string | null;
      cost_known: string;
    }>(
      `SELECT count(*)::text AS requests,
              coalesce(sum(input_tokens), 0)::text AS input_tokens,
              coalesce(sum(output_tokens), 0)::text AS output_tokens,
              sum(estimated_cost_usd)::text AS cost,
              count(estimated_cost_usd)::text AS cost_known
         FROM ai_usage
        WHERE cabinet_id = $1 AND created_at >= $2 AND status = 'ok'`,
      [cabinetId, start.toISOString()],
    );
    const row = totals.rows[0];

    const byProvider = await this.db.query<{
      provider: string;
      model: string;
      requests: string;
      cost: string | null;
    }>(
      `SELECT provider, model, count(*)::text AS requests, sum(estimated_cost_usd)::text AS cost
         FROM ai_usage
        WHERE cabinet_id = $1 AND created_at >= $2 AND status = 'ok'
        GROUP BY provider, model
        ORDER BY count(*) DESC`,
      [cabinetId, start.toISOString()],
    );

    const byModule = await this.db.query<{ module: string; requests: string }>(
      `SELECT module, count(*)::text AS requests
         FROM ai_usage
        WHERE cabinet_id = $1 AND created_at >= $2 AND status = 'ok'
        GROUP BY module ORDER BY count(*) DESC`,
      [cabinetId, start.toISOString()],
    );

    const settings = await this.rawSettings(cabinetId);
    const requests = Number(row?.requests ?? '0');
    const used = row?.cost ?? null;
    const limit = settings.monthly_budget_usd;

    let percent: number | null = null;
    let state: UsageSummary['budget']['state'] = 'unknown';
    if (limit !== null && used !== null) {
      percent = Number(limit) === 0 ? 100 : Math.round((Number(used) / Number(limit)) * 100);
      state = percent >= 100 ? 'exceeded' : percent >= settings.alert_threshold ? 'warning' : 'ok';
    } else if (limit !== null) {
      // A budget exists but no dated price: the request cap (if any) is the
      // only enforceable limit, and the UI must say the cost is unknown.
      state = settings.monthly_request_limit !== null && requests >= settings.monthly_request_limit
        ? 'exceeded'
        : 'unknown';
    }

    return {
      month,
      requests,
      inputTokens: Number(row?.input_tokens ?? '0'),
      outputTokens: Number(row?.output_tokens ?? '0'),
      estimatedCostUsd: used,
      costKnown: used !== null,
      byProvider: byProvider.rows.map((r) => ({
        provider: r.provider,
        model: r.model,
        requests: Number(r.requests),
        estimatedCostUsd: r.cost,
      })),
      byModule: byModule.rows.map((r) => ({ module: r.module, requests: Number(r.requests) })),
      budget: {
        limitUsd: limit,
        requestLimit: settings.monthly_request_limit,
        usedUsd: used,
        percent,
        state,
      },
    };
  }

  /** Enforces budget and request caps. Called before every provider call. */
  private async assertBudget(cabinetId: string, settings: AISettingsRow, usage?: UsageSummary): Promise<void> {
    if (settings.monthly_budget_usd === null && settings.monthly_request_limit === null) return;
    const summary = usage ?? (await this.usageSummary(cabinetId));

    if (settings.monthly_request_limit !== null && summary.requests >= settings.monthly_request_limit) {
      throw new AppError(
        'AI_BUDGET_EXCEEDED',
        402,
        `Monthly request limit reached (${summary.requests}/${settings.monthly_request_limit})`,
      );
    }
    if (settings.monthly_budget_usd !== null && summary.estimatedCostUsd !== null) {
      if (Number(summary.estimatedCostUsd) >= Number(settings.monthly_budget_usd)) {
        throw new AppError(
          'AI_BUDGET_EXCEEDED',
          402,
          `Monthly budget reached (${summary.estimatedCostUsd} / ${settings.monthly_budget_usd} USD)`,
        );
      }
    }
  }

  private checkRateLimit(cabinetId: string): void {
    const limit = this.config.AI_RATE_LIMIT_PER_MINUTE;
    const now = this.now().getTime();
    const windowStart = now - 60_000;
    const hits = (this.windows.get(cabinetId) ?? []).filter((t) => t > windowStart);
    if (hits.length >= limit) {
      this.windows.set(cabinetId, hits);
      throw new AppError('AI_RATE_LIMITED', 429, 'Too many AI requests in the last minute');
    }
    hits.push(now);
    this.windows.set(cabinetId, hits);
  }

  // ------------------------------------------------------------- price lookup
  private async priceFor(provider: string, model: string): Promise<{
    inputUsdPerMTok: string;
    outputUsdPerMTok: string;
    verified: boolean;
  } | null> {
    const res = await this.db.query<{
      input_usd_per_mtok: string;
      output_usd_per_mtok: string;
      verified: boolean;
    }>(
      `SELECT input_usd_per_mtok::text, output_usd_per_mtok::text, verified
         FROM ai_prices
        WHERE provider = $1 AND model = $2 AND effective_from <= $3
        ORDER BY effective_from DESC LIMIT 1`,
      [provider, model, isoDate(this.now())],
    );
    const row = res.rows[0];
    if (!row) return null;
    return {
      inputUsdPerMTok: row.input_usd_per_mtok,
      outputUsdPerMTok: row.output_usd_per_mtok,
      verified: row.verified,
    };
  }

  /**
   * Automatic routing: only among providers with a *verified*, dated price and
   * the required capabilities. Disabled until the catalogue is verified, and
   * never across cabinets.
   */
  private async chooseAutomatically(
    settings: AISettingsRow,
    required: { vision: boolean; documents: boolean },
    candidates: string[],
  ): Promise<{ provider: string; model: string }> {
    const rows: { provider: string; model: string; cost: number }[] = [];
    for (const key of candidates) {
      const definition = providerByKey(this.catalogue, key);
      if (!definition) continue;
      if (definition.key === 'simulated') continue;
      if (required.vision && !definition.capabilities.vision) continue;
      if (required.documents && !definition.capabilities.documents) continue;
      for (const model of definition.models) {
        const price = await this.priceFor(definition.key, model.id);
        if (!price?.verified) continue;
        rows.push({
          provider: definition.key,
          model: model.id,
          cost: Number(price.inputUsdPerMTok) + Number(price.outputUsdPerMTok),
        });
      }
    }
    if (rows.length === 0) {
      throw new AppError(
        'AI_ROUTING_DISABLED',
        409,
        'Automatic routing requires verified, dated prices: none are configured',
      );
    }
    rows.sort((a, b) => a.cost - b.cost);
    const best = rows[0]!;
    void settings;
    return { provider: best.provider, model: best.model };
  }

  // ---------------------------------------------------------------- execution
  async complete(params: CompleteParams): Promise<CompleteResult> {
    if (!this.config.AI_ENABLED) {
      throw forbidden('The AI engine is disabled on this instance', 'AI_DISABLED');
    }
    const settings = await this.rawSettings(params.cabinetId);
    if (!settings.enabled) {
      throw forbidden('Artificial intelligence is disabled for this cabinet', 'AI_DISABLED');
    }
    if (!FEATURE_MODULES.includes(params.module)) {
      throw badRequest('AI_FEATURE_UNKNOWN', 'Unknown module');
    }
    if (settings.features[params.module] !== true) {
      throw forbidden(
        `AI features are disabled for the "${params.module}" module`,
        'AI_FEATURE_DISABLED',
      );
    }
    if (params.user.length > this.config.AI_MAX_INPUT_CHARS) {
      throw badRequest('AI_INPUT_TOO_LONG', 'Input too long');
    }

    await this.assertBudget(params.cabinetId, settings);
    this.checkRateLimit(params.cabinetId);

    // ---- provider selection
    let chosen: { provider: string; model: string };
    if (params.provider) {
      const { definition } = this.resolveModel(params.provider.provider, params.provider.model, {
        allowEmptyModels: true,
      });
      chosen = { provider: definition.key, model: params.provider.model };
    } else if (settings.routing_mode === 'automatic') {
      const candidates = [settings.primary_provider, settings.fallback_provider].filter(
        (k): k is string => Boolean(k),
      );
      chosen = await this.chooseAutomatically(settings, { vision: false, documents: false }, candidates);
    } else {
      const { definition, model } = this.resolveModel(
        settings.primary_provider,
        settings.primary_model,
        { allowEmptyModels: true },
      );
      chosen = { provider: definition.key, model: model || (definition.models[0]?.id ?? '') };
    }

    const attempts = [
      chosen,
      settings.fallback_provider
        ? { provider: settings.fallback_provider, model: settings.fallback_model ?? '' }
        : null,
    ].filter((a): a is { provider: string; model: string } => a !== null);

    let lastError: unknown = null;
    for (const attempt of attempts) {
      try {
        return await this.callProvider(params, settings, attempt);
      } catch (err) {
        lastError = err;
        const code = err instanceof AIProviderError ? err.code : (err as AppError)?.code;
        // Only a provider-side failure may fall back; an authorisation or a
        // budget error must surface immediately.
        if (!(err instanceof AIProviderError)) throw err;
        if (!err.retryable && code !== 'AI_PROVIDER_ERROR') throw err;
      }
    }
    throw lastError;
  }

  private async callProvider(
    params: CompleteParams,
    settings: AISettingsRow,
    attempt: { provider: string; model: string },
  ): Promise<CompleteResult> {
    const definition = providerByKey(this.catalogue, attempt.provider);
    if (!definition) throw badRequest('AI_PROVIDER_NOT_ALLOWED', 'Unknown provider');
    const adapter = this.registry.adapter(definition.key);
    if (!adapter) throw badRequest('AI_PROVIDER_NOT_ALLOWED', 'Provider not available');

    const model = attempt.model || definition.models[0]?.id || '';
    if (definition.models.length > 0 && !modelById(definition, model)) {
      throw badRequest('AI_MODEL_NOT_ALLOWED', 'Unknown model for this provider');
    }

    const override = settings.provider_options[definition.key]?.baseUrl;
    let baseUrl = definition.baseUrl;
    if (definition.baseUrlConfigurable) {
      if (!override && !definition.baseUrl) {
        throw new AppError('AI_NOT_CONFIGURED', 409, 'This provider requires a base URL');
      }
      baseUrl = override ?? definition.baseUrl;
      const check = checkBaseUrl(baseUrl, {
        allowPrivateHosts: this.config.AI_ALLOW_PRIVATE_BASE_URL,
        allowHttp: this.config.NODE_ENV !== 'production',
      });
      if (!check.ok) {
        throw badRequest('AI_BASE_URL_INVALID', `Base URL rejected (${check.reason})`);
      }
    }

    const apiKey = await this.keyFor(params.cabinetId, definition.key, definition.requiresKey);
    const started = Date.now();
    let usage: AIUsage = { inputTokens: null, outputTokens: null };
    let text: string;
    try {
      const maxOutput = Math.min(
        params.maxOutputTokens ?? 512,
        definition.models.find((m) => m.id === model)?.maxOutputTokens ?? 4096,
      );
      const completion = await this.withRetries(() =>
        adapter.complete({
          provider: definition.key,
          model,
          apiKey,
          baseUrl,
          system: params.system,
          user: params.user,
          maxOutputTokens: maxOutput,
          temperature: params.temperature ?? 0,
          responseSchema: params.responseSchema,
          timeoutMs: this.config.AI_TIMEOUT_MS,
        }),
      );
      text = completion.text;
      usage = completion.usage;
    } catch (err) {
      const latencyMs = Date.now() - started;
      const code = err instanceof AIProviderError ? err.code : 'AI_PROVIDER_ERROR';
      await this.recordUsage(params, attempt, model, null, {
        status: code === 'AI_TIMEOUT' ? 'timeout' : 'error',
        errorCode: code,
        latencyMs,
      });
      throw err instanceof AIProviderError
        ? new AppError(code, code === 'AI_TIMEOUT' ? 504 : 502, err.message)
        : new AppError('AI_PROVIDER_ERROR', 502, 'Provider call failed');
    }

    const latencyMs = Date.now() - started;
    const price = definition.key === 'simulated' ? null : await this.priceFor(definition.key, model);
    const cost = estimateCost(usage, price);

    await this.recordUsage(params, attempt, model, cost.decimal, {
      status: 'ok',
      errorCode: null,
      latencyMs,
      usage,
    });

    return {
      text,
      provider: definition.key,
      model,
      usage,
      latencyMs,
      estimatedCostUsd: cost.decimal,
    };
  }

  private async withRetries<T>(fn: () => Promise<T>): Promise<T> {
    const maxAttempts = 1 + this.config.AI_MAX_RETRIES;
    let lastError: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        return await fn();
      } catch (err) {
        lastError = err;
        const retryable = err instanceof AIProviderError && err.retryable;
        if (!retryable || attempt === maxAttempts) break;
        await new Promise((resolve) => setTimeout(resolve, 150 * attempt));
      }
    }
    throw lastError;
  }

  private async recordUsage(
    params: CompleteParams,
    attempt: { provider: string; model: string },
    model: string,
    costUsd: string | null,
    detail: {
      status: 'ok' | 'error' | 'timeout' | 'blocked' | 'refused';
      errorCode: string | null;
      latencyMs: number;
      usage?: AIUsage;
    },
  ): Promise<void> {
    const usage = detail.usage ?? { inputTokens: null, outputTokens: null };
    await this.db.transaction(async (tx) => {
      await tx.query(
        `INSERT INTO ai_usage
           (cabinet_id, company_id, module, feature, provider, model, request_count,
            input_tokens, output_tokens, estimated_cost_usd, cost_source, status, error_code, latency_ms)
         VALUES ($1,$2,$3,$4,$5,$6,1,$7,$8,$9,$10,$11,$12,$13)`,
        [
          params.cabinetId,
          params.companyId,
          params.module,
          params.feature,
          attempt.provider,
          model || attempt.model,
          usage.inputTokens,
          usage.outputTokens,
          costUsd,
          costUsd === null ? 'unknown' : 'catalogue',
          detail.status,
          detail.errorCode,
          detail.latencyMs,
        ],
      );
      // Metadata only: neither the prompt nor the provider answer is logged.
      await tx.query(
        `INSERT INTO ai_request_log
           (cabinet_id, company_id, user_id, module, feature, provider, model,
            status, error_code, latency_ms, input_tokens, output_tokens)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          params.cabinetId,
          params.companyId,
          params.userId,
          params.module,
          params.feature,
          attempt.provider,
          model || attempt.model,
          detail.status,
          detail.errorCode,
          detail.latencyMs,
          usage.inputTokens,
          usage.outputTokens,
        ],
      );
      await writeAudit(tx, {
        companyId: params.companyId,
        userId: params.userId,
        action: 'ai.request',
        entityType: 'ai_request',
        details: {
          cabinetId: params.cabinetId,
          provider: attempt.provider,
          model: model || attempt.model,
          feature: params.feature,
          status: detail.status,
          errorCode: detail.errorCode,
        },
      });
    });
  }

  /** Test-connection, only on explicit user request. */
  async testConnection(params: {
    cabinetId: string;
    userId: string;
    provider: string;
    model?: string | null;
  }): Promise<{ ok: boolean; provider: string; model: string; latencyMs: number; errorCode?: string }> {
    const { definition, model } = this.resolveModel(
      params.provider,
      params.model ?? null,
      { allowEmptyModels: true },
    );
    const chosenModel = model || definition.models[0]?.id || '';
    const settings = await this.rawSettings(params.cabinetId);
    const started = Date.now();
    try {
      const result = await this.callProvider(
        {
          cabinetId: params.cabinetId,
          companyId: null,
          module: 'cabinet',
          feature: 'connection_test',
          userId: params.userId,
          system: 'Test de connexion. Répondez uniquement par le mot OK.',
          user: 'Répondez par OK.',
          responseSchema: null,
          maxOutputTokens: 16,
        },
        settings,
        { provider: definition.key, model: chosenModel },
      );
      return { ok: true, provider: result.provider, model: result.model, latencyMs: result.latencyMs };
    } catch (err) {
      const code = err instanceof AppError ? err.code : 'AI_PROVIDER_ERROR';
      return {
        ok: false,
        provider: definition.key,
        model: chosenModel,
        latencyMs: Date.now() - started,
        errorCode: code,
      };
    }
  }

  catalogueForUi(): AICatalogue {
    return {
      ...this.catalogue,
      pricing: this.catalogue.pricing.map((p) => ({ ...p })),
    };
  }
}

export function aiErrorCode(err: unknown): string {
  if (err instanceof AppError) return err.code;
  if (err instanceof AIProviderError) return err.code;
  return 'AI_PROVIDER_ERROR';
}

/** Guard used by routes: a company must exist before any AI work. */
export async function assertCompanyLinked(db: Db, companyId: string, cabinetId: string): Promise<void> {
  const res = await db.query('SELECT 1 FROM companies WHERE id = $1 AND cabinet_id = $2', [
    companyId,
    cabinetId,
  ]);
  if (res.rowCount === 0) throw notFound('COMPANY_NOT_FOUND', 'Company not found');
}
