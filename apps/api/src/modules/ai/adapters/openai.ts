import { AIProviderError, type AIAdapter, type AICompletion, type AICompletionRequest } from '../types.js';

/**
 * OpenAI-compatible adapter.
 *
 * Used by OpenAI itself, and by providers that clone the `chat/completions`
 * contract (DeepSeek, Mistral, self-hosted gateways). The providers are *not*
 * assumed to be identical:
 *
 *  - `json_schema` (strict) is only sent when the catalogue declares it; other
 *    providers only receive `json_object`, and some receive no `response_format`
 *    at all (the answer is then validated server side);
 *  - refusal / moderation fields are surfaced as provider errors;
 *  - token counts come from `usage` when present, never invented.
 */
export interface OpenAIAdapterOptions {
  /** Injected for tests: no real network is ever required. */
  fetchImpl?: typeof fetch;
}

interface ChatCompletionResponse {
  id?: string;
  model?: string;
  choices?: {
    message?: { content?: string | null; refusal?: string | null };
    finish_reason?: string;
  }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string; type?: string; code?: string };
}

export function createOpenAIAdapter(
  options: OpenAIAdapterOptions = {},
  structured: 'json_schema' | 'json_object' | 'prompt_only' = 'json_object',
): AIAdapter {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;

  return {
    key: 'openai',
    async complete(request: AICompletionRequest): Promise<AICompletion> {
      if (request.apiKey === null) {
        throw new AIProviderError('AI_KEY_MISSING', 'No API key configured for this provider');
      }

      const body: Record<string, unknown> = {
        model: request.model,
        messages: [
          { role: 'system', content: request.system },
          { role: 'user', content: request.user },
        ],
        temperature: request.temperature,
        max_tokens: request.maxOutputTokens,
        stream: false,
      };
      if (request.responseSchema && structured === 'json_schema') {
        body.response_format = {
          type: 'json_schema',
          json_schema: {
            name: request.responseSchema.name,
            strict: true,
            schema: request.responseSchema.schema,
          },
        };
      } else if (request.responseSchema && structured === 'json_object') {
        body.response_format = { type: 'json_object' };
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), request.timeoutMs);
      const onAbort = () => controller.abort();
      request.signal?.addEventListener('abort', onAbort);
      try {
        const response = await fetchImpl(`${request.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${request.apiKey}`,
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        if (!response.ok) {
          // The body is discarded on purpose: it can echo the submitted prompt
          // and the API never logs provider payloads.
          await response.text().catch(() => '');
          throw new AIProviderError(
            response.status === 429 ? 'AI_RATE_LIMITED' : 'AI_PROVIDER_ERROR',
            `Provider returned ${response.status}`,
            { status: response.status, retryable: response.status === 429 || response.status >= 500 },
          );
        }

        const payload = (await response.json()) as ChatCompletionResponse;
        if (payload.error) {
          throw new AIProviderError('AI_PROVIDER_ERROR', payload.error.message ?? 'Provider error', {
            retryable: false,
          });
        }
        const choice = payload.choices?.[0];
        const text = choice?.message?.content;
        if (typeof text !== 'string' || text.trim() === '') {
          throw new AIProviderError('AI_INVALID_RESPONSE', 'Empty completion', { retryable: true });
        }
        return {
          text,
          model: payload.model ?? request.model,
          providerRequestId: payload.id ?? null,
          usage: {
            inputTokens: payload.usage?.prompt_tokens ?? null,
            outputTokens: payload.usage?.completion_tokens ?? null,
          },
        };
      } catch (err) {
        if (err instanceof AIProviderError) throw err;
        if ((err as { name?: string }).name === 'AbortError') {
          throw new AIProviderError('AI_TIMEOUT', 'Provider timed out', { retryable: true });
        }
        throw new AIProviderError('AI_PROVIDER_ERROR', 'Network error', { retryable: true });
      } finally {
        clearTimeout(timer);
        request.signal?.removeEventListener('abort', onAbort);
      }
    },
  };
}
