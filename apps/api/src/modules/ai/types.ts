/**
 * Mauritius AI Engine - shared types.
 *
 * Everything the business code is allowed to know about a provider lives in
 * this file. Adapters implement `AIAdapter`; the rest of the suite never sees a
 * provider-specific payload.
 */

/** How a provider accepts a machine-readable answer. */
export type StructuredOutputMode = 'json_schema' | 'json_object' | 'prompt_only';

/** Where the token counts come from: the provider, a local estimate, or nowhere. */
export type TokenCounting = 'provider' | 'estimated' | 'unknown';

export type AIAdapterKey = 'openai' | 'gemini' | 'simulated';

export interface AIModelDefinition {
  id: string;
  label: string;
  contextTokens: number | null;
  maxOutputTokens: number | null;
}

export interface AICapabilities {
  structuredOutput: StructuredOutputMode;
  vision: boolean;
  documents: boolean;
  streaming: boolean;
  tokenCounting: TokenCounting;
}

export interface AIProviderDefinition {
  key: string;
  label: string;
  adapter: AIAdapterKey;
  baseUrl: string;
  baseUrlConfigurable: boolean;
  requiresKey: boolean;
  enabledByDefault: boolean;
  docsUrl: string;
  notes: string;
  capabilities: AICapabilities;
  models: AIModelDefinition[];
}

export interface AIPriceRow {
  provider: string;
  model: string;
  /** Dated, sourced price. `verified` gates automatic routing. */
  inputUsdPerMTok: string;
  outputUsdPerMTok: string;
  effectiveFrom: string;
  source: string;
  verified: boolean;
  notes?: string;
}

export interface AICatalogue {
  version: number;
  updatedAt: string;
  notice: string;
  providers: AIProviderDefinition[];
  pricing: AIPriceRow[];
}

/** JSON object schema (subset of JSON Schema) sent to providers that support it. */
export interface AIResponseSchema {
  name: string;
  schema: Record<string, unknown>;
}

export interface AICompletionRequest {
  provider: string;
  model: string;
  apiKey: string | null;
  baseUrl: string;
  system: string;
  user: string;
  maxOutputTokens: number;
  temperature: number;
  responseSchema: AIResponseSchema | null;
  timeoutMs: number;
  signal?: AbortSignal;
}

export interface AIUsage {
  /** null when the provider returned no count: never estimated unless stated. */
  inputTokens: number | null;
  outputTokens: number | null;
}

export interface AICompletion {
  text: string;
  usage: AIUsage;
  model: string;
  providerRequestId?: string | null;
}

export interface AIAdapter {
  readonly key: AIAdapterKey;
  complete(request: AICompletionRequest): Promise<AICompletion>;
}

/** Error raised by an adapter, already classified for the orchestrator. */
export class AIProviderError extends Error {
  readonly code:
    | 'AI_TIMEOUT'
    | 'AI_RATE_LIMITED'
    | 'AI_PROVIDER_ERROR'
    | 'AI_INVALID_RESPONSE'
    | 'AI_KEY_MISSING'
    | 'AI_PROVIDER_NOT_ALLOWED';
  /** HTTP status returned by the provider, when there was one. */
  readonly status: number | null;
  readonly retryable: boolean;

  constructor(
    code: AIProviderError['code'],
    message: string,
    options: { status?: number | null; retryable?: boolean } = {},
  ) {
    super(message);
    this.code = code;
    this.status = options.status ?? null;
    this.retryable = options.retryable ?? false;
  }
}

/** Modules that may request AI features. */
export type AIModule = 'accounting' | 'billing' | 'payroll' | 'cabinet';

/**
 * Feature catalogue. `implemented: false` means the engine exposes the contract
 * but refuses to run it: nothing is simulated silently.
 */
export interface AIFeatureDefinition {
  key: string;
  module: AIModule;
  label: { fr: string; en: string };
  implemented: boolean;
  requiresDocument: boolean;
  /** Human validation is always required; kept explicit for documentation. */
  humanValidation: true;
}

export const AI_FEATURES: AIFeatureDefinition[] = [
  {
    key: 'account_suggestion',
    module: 'accounting',
    label: { fr: 'Suggestion de compte comptable', en: 'Account suggestion' },
    implemented: true,
    requiresDocument: false,
    humanValidation: true,
  },
  {
    key: 'journal_proposal',
    module: 'accounting',
    label: { fr: 'Écriture comptable complète', en: 'Full journal entry proposal' },
    implemented: true,
    requiresDocument: false,
    humanValidation: true,
  },
  {
    key: 'purchase_invoice_extraction',
    module: 'accounting',
    label: { fr: 'OCR de factures fournisseurs', en: 'Purchase invoice OCR' },
    implemented: false,
    requiresDocument: true,
    humanValidation: true,
  },
  {
    key: 'duplicate_detection',
    module: 'accounting',
    label: { fr: 'Détection de doublons', en: 'Duplicate detection' },
    // Deterministic comparison first (mission 6): no provider call is needed.
    implemented: true,
    requiresDocument: false,
    humanValidation: true,
  },
  {
    key: 'bank_statement_import',
    module: 'accounting',
    label: { fr: 'Lecture de relevés bancaires', en: 'Bank statement parsing' },
    implemented: false,
    requiresDocument: true,
    humanValidation: true,
  },
  {
    key: 'bank_reconciliation',
    module: 'accounting',
    label: { fr: 'Rapprochement bancaire assisté', en: 'Assisted bank reconciliation' },
    implemented: false,
    requiresDocument: false,
    humanValidation: true,
  },
  {
    key: 'document_classification',
    module: 'cabinet',
    label: { fr: 'Classement documentaire', en: 'Document classification' },
    implemented: false,
    requiresDocument: true,
    humanValidation: true,
  },
  {
    key: 'task_suggestions',
    module: 'cabinet',
    label: { fr: 'Suggestions de tâches', en: 'Task suggestions' },
    implemented: false,
    requiresDocument: false,
    humanValidation: true,
  },
  {
    key: 'billing_anomalies',
    module: 'billing',
    label: { fr: 'Détection d’anomalies de facturation', en: 'Billing anomaly detection' },
    implemented: false,
    requiresDocument: true,
    humanValidation: true,
  },
  {
    key: 'payroll_variance',
    module: 'payroll',
    label: { fr: 'Analyse des variables de paie', en: 'Payroll variable analysis' },
    implemented: false,
    requiresDocument: false,
    humanValidation: true,
  },
];

export function featureByKey(key: string): AIFeatureDefinition | undefined {
  return AI_FEATURES.find((f) => f.key === key);
}
