import { createGeminiAdapter } from './adapters/gemini.js';
import { createOpenAIAdapter } from './adapters/openai.js';
import { createSimulatedAdapter } from './adapters/simulated.js';
import type { AIAdapter, AICatalogue, AIProviderDefinition } from './types.js';

/**
 * Provider registry.
 *
 * The registry is the only place that maps a catalogue entry to an adapter
 * implementation. Adding a provider therefore means: one adapter (if the wire
 * format is new) + one catalogue entry, never a change in the business modules.
 */
export interface RegistryOptions {
  simulatedEnabled: boolean;
  /** Injected in tests so that no real HTTP call is ever made. */
  fetchImpl?: typeof fetch;
}

export type AdapterFactory = (definition: AIProviderDefinition) => AIAdapter;

const FACTORIES: Record<AIProviderDefinition['adapter'], (def: AIProviderDefinition, o: RegistryOptions) => AIAdapter> = {
  openai: (def, o) => createOpenAIAdapter({ fetchImpl: o.fetchImpl }, def.capabilities.structuredOutput),
  gemini: (_def, o) => createGeminiAdapter({ fetchImpl: o.fetchImpl }),
  simulated: (_def, o) => createSimulatedAdapter({ enabled: o.simulatedEnabled }),
};

export class ProviderRegistry {
  private readonly adapters = new Map<string, AIAdapter>();
  private readonly definitions = new Map<string, AIProviderDefinition>();

  constructor(catalogue: AICatalogue, options: RegistryOptions) {
    for (const definition of catalogue.providers) {
      this.definitions.set(definition.key, definition);
      this.adapters.set(definition.key, FACTORIES[definition.adapter](definition, options));
    }
  }

  list(): AIProviderDefinition[] {
    return [...this.definitions.values()];
  }

  definition(key: string): AIProviderDefinition | undefined {
    return this.definitions.get(key);
  }

  adapter(key: string): AIAdapter | undefined {
    return this.adapters.get(key);
  }

  /** True when the provider is usable in this deployment. */
  available(key: string): boolean {
    const definition = this.definitions.get(key);
    if (!definition) return false;
    if (definition.key === 'simulated') return this.adapters.has(key);
    return true;
  }
}
