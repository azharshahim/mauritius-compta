/**
 * Client-side mirror of the provider catalogue.
 *
 * The **server** catalogue (`apps/api/config/ai-providers.json`) is authoritative.
 * This copy exists only to render the settings screen and to serve the
 * GitHub Pages demonstration, where no backend is reachable. It declares no
 * price: the demonstration never displays a cost.
 */

export interface AiModel {
  id: string;
  label: string;
}

export interface AiProvider {
  key: string;
  label: string;
  requiresKey: boolean;
  baseUrlConfigurable?: boolean;
  models: AiModel[];
  capabilities: {
    structuredOutput: 'json_schema' | 'json_object' | 'prompt_only';
    vision: boolean;
    documents: boolean;
  };
  notes: { fr: string; en: string };
}

export const AI_PROVIDERS: AiProvider[] = [
  {
    key: 'deepseek',
    label: 'DeepSeek',
    requiresKey: true,
    models: [
      { id: 'deepseek-chat', label: 'DeepSeek Chat' },
      { id: 'deepseek-reasoner', label: 'DeepSeek Reasoner' },
    ],
    capabilities: { structuredOutput: 'json_object', vision: false, documents: false },
    notes: {
      fr: 'API compatible OpenAI. Réponse structurée contrainte par le prompt.',
      en: 'OpenAI-compatible API. Structured answer constrained by the prompt.',
    },
  },
  {
    key: 'openai',
    label: 'OpenAI',
    requiresKey: true,
    models: [
      { id: 'gpt-4o-mini', label: 'GPT-4o mini' },
      { id: 'gpt-4o', label: 'GPT-4o' },
    ],
    capabilities: { structuredOutput: 'json_schema', vision: true, documents: false },
    notes: { fr: 'Sortie structurée native (json_schema strict).', en: 'Native structured output (strict json_schema).' },
  },
  {
    key: 'gemini',
    label: 'Google Gemini',
    requiresKey: true,
    models: [
      { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
      { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
    ],
    capabilities: { structuredOutput: 'json_schema', vision: true, documents: true },
    notes: {
      fr: 'API generateContent : schéma de réponse spécifique, comptage via usageMetadata.',
      en: 'generateContent API: provider-specific response schema and usageMetadata counting.',
    },
  },
  {
    key: 'mistral',
    label: 'Mistral AI',
    requiresKey: true,
    models: [
      { id: 'mistral-small-latest', label: 'Mistral Small' },
      { id: 'mistral-large-latest', label: 'Mistral Large' },
    ],
    capabilities: { structuredOutput: 'json_object', vision: false, documents: false },
    notes: { fr: 'Compatible OpenAI, JSON mode uniquement.', en: 'OpenAI-compatible, JSON mode only.' },
  },
  {
    key: 'openai_compatible',
    label: 'Compatible OpenAI (configurable)',
    requiresKey: true,
    baseUrlConfigurable: true,
    models: [],
    capabilities: { structuredOutput: 'json_object', vision: false, documents: false },
    notes: { fr: 'URL de base et modèle saisis par le cabinet.', en: 'Base URL and model entered by the cabinet.' },
  },
  {
    key: 'local',
    label: 'Auto-hébergé (phase ultérieure)',
    requiresKey: false,
    baseUrlConfigurable: true,
    models: [],
    capabilities: { structuredOutput: 'json_object', vision: false, documents: false },
    notes: { fr: 'Serveur local compatible OpenAI. Désactivé par défaut.', en: 'Local OpenAI-compatible server. Disabled by default.' },
  },
  {
    key: 'simulated',
    label: 'Simulateur fictif (démonstration)',
    requiresKey: false,
    models: [{ id: 'simulated-fictif', label: 'Simulateur déterministe' }],
    capabilities: { structuredOutput: 'json_schema', vision: false, documents: false },
    notes: {
      fr: 'Aucune requête réseau, aucun coût. Utilisé par cette démonstration.',
      en: 'No network request, no cost. Used by this demonstration.',
    },
  },
];

export function providerByKey(key: string | null | undefined): AiProvider | undefined {
  if (!key) return undefined;
  return AI_PROVIDERS.find((p) => p.key === key);
}

export function modelLabel(provider: string | null, model: string | null): string {
  const def = providerByKey(provider);
  if (!def) return model ?? '—';
  return def.models.find((m) => m.id === model)?.label ?? model ?? '—';
}
