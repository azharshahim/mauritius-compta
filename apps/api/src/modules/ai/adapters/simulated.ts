import {
  AIProviderError,
  type AIAdapter,
  type AICompletion,
  type AICompletionRequest,
} from '../types.js';
import {
  categoryForDescription,
  chooseAccount,
  parseAccountBlock,
  simulateJournalProposal,
} from '../simulation.js';

/**
 * Deterministic fictional provider.
 *
 * It performs **no network call whatsoever** and produces no cost. It exists so
 * that the account-suggestion workflow can be demonstrated (GitHub Pages) and
 * tested end to end without any API key. Its answers are computed from
 * keywords and from the real chart of accounts passed in the prompt, therefore
 * it can never invent an account code.
 *
 * It is disabled unless the operator enables it (`AI_ALLOW_SIMULATED`), which
 * is the default outside production.
 */
export function createSimulatedAdapter(options: { enabled: boolean }): AIAdapter {
  return {
    key: 'simulated',
    async complete(request: AICompletionRequest): Promise<AICompletion> {
      if (!options.enabled) {
        throw new AIProviderError('AI_PROVIDER_NOT_ALLOWED', 'Simulated provider is disabled');
      }

      if (request.responseSchema?.name === 'journal_entry_proposal') {
        return simulateJournalAnswer(request);
      }

      const accounts = parseAccountBlock(request.user);
      if (accounts.length === 0) {
        // No chart of accounts in the prompt: the answer cannot be grounded,
        // so the engine must reject it rather than guess.
        throw new AIProviderError('AI_INVALID_RESPONSE', 'No account list supplied');
      }

      const description = extractDescription(request.user);
      const account = chooseAccount(description, accounts);
      if (!account) {
        return {
          text: JSON.stringify({
            accountCode: null,
            category: categoryForDescription(description),
            rationale: 'Aucun compte du plan comptable ne correspond à cette description.',
            confidence: 0.1,
          }),
          model: request.model,
          providerRequestId: 'simulated',
          usage: {
            inputTokens: Math.ceil(request.user.length / 4),
            outputTokens: 60,
          },
        };
      }

      const confidence = account.matched ? 0.82 : 0.35;
      return {
        text: JSON.stringify({
          accountCode: account.code,
          category: categoryForDescription(description),
          rationale: account.matched
            ? `Le libellé « ${description} » correspond au compte ${account.code} (${account.name}).`
            : `Proposition par défaut : compte de charge ${account.code} (${account.name}). À vérifier.`,
          confidence,
        }),
        model: request.model,
        providerRequestId: 'simulated',
        usage: {
          inputTokens: Math.ceil(request.user.length / 4),
          outputTokens: 80,
        },
      };
    },
  };
}

/** Deterministic full-entry answer: balanced, grounded, never a rate. */
function simulateJournalAnswer(request: AICompletionRequest): AICompletion {
  const answer = simulateJournalProposal(request.user);
  if (answer.lines.length === 0) {
    // An explicitly incomplete answer: the engine surfaces `missing` instead of
    // inventing accounts or amounts.
    answer.confidence = 0.1;
  }
  return {
    text: JSON.stringify(answer),
    model: request.model,
    providerRequestId: 'simulated',
    usage: {
      inputTokens: Math.ceil(request.user.length / 4),
      outputTokens: 140,
    },
  };
}

/** The description is the first "OPÉRATION:" line of the user prompt. */
export function extractDescription(prompt: string): string {
  const match = /OP[ÉE]RATION\s*:\s*(.+)/i.exec(prompt);
  return (match?.[1] ?? '').trim().slice(0, 300);
}
