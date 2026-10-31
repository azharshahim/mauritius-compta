import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type {
  AICatalogue,
  AIModelDefinition,
  AIPriceRow,
  AIProviderDefinition,
} from './types.js';

/**
 * Provider catalogue loading.
 *
 * The catalogue is data, not code: URLs, model identifiers, capabilities and
 * prices come from `apps/api/config/ai-providers.json` (or `AI_CATALOGUE_PATH`).
 * Nothing in the business logic hard-codes a provider, a model or a price.
 */

const DEFAULT_CATALOGUE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../config/ai-providers.json',
);

const capabilitiesSchema = z.object({
  structured_output: z.enum(['json_schema', 'json_object', 'prompt_only']),
  vision: z.boolean(),
  documents: z.boolean(),
  streaming: z.boolean(),
  token_counting: z.enum(['provider', 'estimated', 'unknown']),
});

const modelSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  context_tokens: z.number().int().positive().nullable().optional(),
  max_output_tokens: z.number().int().positive().nullable().optional(),
});

const providerSchema = z.object({
  key: z.string().regex(/^[a-z0-9_-]+$/),
  label: z.string().min(1),
  adapter: z.enum(['openai', 'gemini', 'simulated']),
  base_url: z.string(),
  base_url_configurable: z.boolean().optional(),
  requires_key: z.boolean(),
  enabled_by_default: z.boolean(),
  docs_url: z.string().optional().default(''),
  notes: z.string().optional().default(''),
  capabilities: capabilitiesSchema,
  models: z.array(modelSchema),
});

const priceSchema = z.object({
  provider: z.string().min(1),
  model: z.string().min(1),
  input_usd_per_mtok: z.string().regex(/^\d+(\.\d+)?$/),
  output_usd_per_mtok: z.string().regex(/^\d+(\.\d+)?$/),
  effective_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  source: z.string().min(1),
  verified: z.boolean(),
  notes: z.string().optional(),
});

const catalogueSchema = z.object({
  version: z.number().int().positive(),
  updated_at: z.string(),
  notice: z.string().optional().default(''),
  providers: z.array(providerSchema),
  pricing: z.array(priceSchema).default([]),
});

function toDefinition(raw: z.infer<typeof providerSchema>): AIProviderDefinition {
  return {
    key: raw.key,
    label: raw.label,
    adapter: raw.adapter,
    baseUrl: raw.base_url,
    baseUrlConfigurable: raw.base_url_configurable ?? false,
    requiresKey: raw.requires_key,
    enabledByDefault: raw.enabled_by_default,
    docsUrl: raw.docs_url,
    notes: raw.notes,
    capabilities: {
      structuredOutput: raw.capabilities.structured_output,
      vision: raw.capabilities.vision,
      documents: raw.capabilities.documents,
      streaming: raw.capabilities.streaming,
      tokenCounting: raw.capabilities.token_counting,
    },
    models: raw.models.map(
      (m): AIModelDefinition => ({
        id: m.id,
        label: m.label,
        contextTokens: m.context_tokens ?? null,
        maxOutputTokens: m.max_output_tokens ?? null,
      }),
    ),
  };
}

function toPrice(raw: z.infer<typeof priceSchema>): AIPriceRow {
  return {
    provider: raw.provider,
    model: raw.model,
    inputUsdPerMTok: raw.input_usd_per_mtok,
    outputUsdPerMTok: raw.output_usd_per_mtok,
    effectiveFrom: raw.effective_from,
    source: raw.source,
    verified: raw.verified,
    notes: raw.notes,
  };
}

let cached: { path: string; mtimeMs: number; catalogue: AICatalogue } | null = null;

/** Loads (and caches by mtime) the provider catalogue. */
export function loadCatalogue(file?: string): AICatalogue {
  const target = file ?? process.env.AI_CATALOGUE_PATH ?? DEFAULT_CATALOGUE;
  const mtimeMs = statSync(target).mtimeMs;
  if (cached && cached.path === target && cached.mtimeMs === mtimeMs) return cached.catalogue;

  const parsed = catalogueSchema.parse(JSON.parse(readFileSync(target, 'utf8')));
  const catalogue: AICatalogue = {
    version: parsed.version,
    updatedAt: parsed.updated_at,
    notice: parsed.notice,
    providers: parsed.providers.map(toDefinition),
    pricing: parsed.pricing.map(toPrice),
  };
  cached = { path: target, mtimeMs, catalogue };
  return catalogue;
}

export function resetCatalogueCache(): void {
  cached = null;
}

export function providerByKey(
  catalogue: AICatalogue,
  key: string | null | undefined,
): AIProviderDefinition | undefined {
  if (!key) return undefined;
  return catalogue.providers.find((p) => p.key === key);
}

export function modelById(
  provider: AIProviderDefinition,
  modelId: string | null | undefined,
): AIModelDefinition | undefined {
  if (!modelId) return undefined;
  return provider.models.find((m) => m.id === modelId);
}

const PRIVATE_HOSTS =
  /^(localhost|127(\.\d+){3}|0\.0\.0\.0|\[?::1\]?|10(\.\d+){3}|192\.168(\.\d+){2}|172\.(1[6-9]|2\d|3[01])(\.\d+){2}|169\.254(\.\d+){2}|.*\.internal|.*\.local)$/i;

export interface BaseUrlCheck {
  ok: boolean;
  reason?: 'invalid' | 'scheme' | 'private_host';
}

/**
 * Validates a provider base URL. The cabinet may point an "OpenAI compatible"
 * provider at its own gateway, but never at an arbitrary internal address
 * unless the operator explicitly allows private hosts (`AI_ALLOW_PRIVATE_BASE_URL`).
 */
export function checkBaseUrl(
  url: string,
  options: { allowPrivateHosts: boolean; allowHttp: boolean },
): BaseUrlCheck {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, reason: 'invalid' };
  }
  if (parsed.protocol !== 'https:' && !(options.allowHttp && parsed.protocol === 'http:')) {
    return { ok: false, reason: 'scheme' };
  }
  if (PRIVATE_HOSTS.test(parsed.hostname) && !options.allowPrivateHosts) {
    return { ok: false, reason: 'private_host' };
  }
  return { ok: true };
}
