import { AIProviderError, type AIAdapter, type AICompletion, type AICompletionRequest } from '../types.js';

/**
 * Google Gemini adapter (`generateContent`).
 *
 * Gemini is *not* OpenAI-compatible: the system prompt is a separate
 * `systemInstruction`, the schema is passed as `generationConfig.responseSchema`
 * and token usage comes from `usageMetadata` (promptTokenCount /
 * candidatesTokenCount). Keeping a dedicated adapter avoids the usual
 * "all providers speak the same dialect" bug.
 */
export interface GeminiAdapterOptions {
  fetchImpl?: typeof fetch;
}

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  promptFeedback?: { blockReason?: string };
  error?: { message?: string; status?: string };
}

/** Converts the subset of JSON Schema we use into Gemini's dialect (UPPERCASE types). */
export function toGeminiSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const convert = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(convert);
    if (node && typeof node === 'object') {
      const out: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
        if (key === 'type' && typeof value === 'string') {
          out.type = value.toUpperCase();
        } else if (key === 'additionalProperties') {
          // Not supported by Gemini; dropped rather than sent incorrectly.
          continue;
        } else {
          out[key] = convert(value);
        }
      }
      return out;
    }
    return node;
  };
  return convert(schema) as Record<string, unknown>;
}

export function createGeminiAdapter(options: GeminiAdapterOptions = {}): AIAdapter {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;

  return {
    key: 'gemini',
    async complete(request: AICompletionRequest): Promise<AICompletion> {
      if (request.apiKey === null) {
        throw new AIProviderError('AI_KEY_MISSING', 'No API key configured for this provider');
      }

      const generationConfig: Record<string, unknown> = {
        temperature: request.temperature,
        maxOutputTokens: request.maxOutputTokens,
      };
      if (request.responseSchema) {
        generationConfig.responseMimeType = 'application/json';
        generationConfig.responseSchema = toGeminiSchema(request.responseSchema.schema);
      }

      const url =
        `${request.baseUrl.replace(/\/+$/, '')}/models/${encodeURIComponent(request.model)}:generateContent`;

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), request.timeoutMs);
      const onAbort = () => controller.abort();
      request.signal?.addEventListener('abort', onAbort);
      try {
        const response = await fetchImpl(url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            // Header instead of ?key= so the secret never lands in an access log.
            'x-goog-api-key': request.apiKey,
          },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: request.system }] },
            contents: [{ role: 'user', parts: [{ text: request.user }] }],
            generationConfig,
          }),
          signal: controller.signal,
        });

        if (!response.ok) {
          await response.text().catch(() => '');
          throw new AIProviderError(
            response.status === 429 ? 'AI_RATE_LIMITED' : 'AI_PROVIDER_ERROR',
            `Provider returned ${response.status}`,
            { status: response.status, retryable: response.status === 429 || response.status >= 500 },
          );
        }

        const payload = (await response.json()) as GeminiResponse;
        if (payload.error) {
          throw new AIProviderError('AI_PROVIDER_ERROR', payload.error.message ?? 'Provider error');
        }
        if (payload.promptFeedback?.blockReason) {
          throw new AIProviderError(
            'AI_PROVIDER_ERROR',
            `Blocked by provider: ${payload.promptFeedback.blockReason}`,
          );
        }
        const text = payload.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
        if (text.trim() === '') {
          throw new AIProviderError('AI_INVALID_RESPONSE', 'Empty completion', { retryable: true });
        }
        return {
          text,
          model: request.model,
          providerRequestId: null,
          usage: {
            inputTokens: payload.usageMetadata?.promptTokenCount ?? null,
            outputTokens: payload.usageMetadata?.candidatesTokenCount ?? null,
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
