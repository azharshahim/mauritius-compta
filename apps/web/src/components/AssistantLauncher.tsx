import { Suspense, lazy, useCallback, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useI18n } from '../i18n';
import { errorMessage, useSession } from '../store';
import type { AssistantActionView, AssistantChatMessage } from './AssistantPanel';

/**
 * Universal floating AI pill (mission 7).
 *
 * Rendered once, outside the routes, so:
 *  - it exists on every authenticated screen of the four modules;
 *  - the conversation and the current draft survive module navigation,
 *    re-opening and closing the panel;
 *  - it never re-mounts a form, so an unsaved edit is never lost.
 *
 * The panel itself is code-split (`lazy`): the pill costs a few bytes, the
 * conversation UI is downloaded only when needed.
 */
const AssistantPanel = lazy(() => import('./AssistantPanel'));

const MODULE_LABEL: Record<string, { fr: string; en: string }> = {
  cabinet: { fr: 'Cabinet', en: 'Practice' },
  accounting: { fr: 'Comptabilité', en: 'Accounting' },
  billing: { fr: 'Facturation', en: 'Billing' },
  payroll: { fr: 'Paie & RH', en: 'Payroll & HR' },
};

function moduleOfPath(path: string): 'cabinet' | 'accounting' | 'billing' | 'payroll' {
  if (path.startsWith('/billing')) return 'billing';
  if (path.startsWith('/payroll')) return 'payroll';
  if (path.startsWith('/accounting')) return 'accounting';
  return 'cabinet';
}

interface ConversationResponse {
  conversation: { id: string };
}

interface MessageResponse {
  messages: {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    payload?: { actions?: AssistantActionView[] };
  }[];
}

export function AssistantLauncher() {
  const { t, locale } = useI18n();
  const { company } = useSession();
  const location = useLocation();
  const navigate = useNavigate();

  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<AssistantChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);

  // The conversation belongs to one company: switching dossier starts a new one.
  useEffect(() => {
    setConversationId(null);
    setMessages([]);
    setDraft('');
    setError(null);
  }, [company?.id]);

  const companyId = company?.id ?? null;
  const module = moduleOfPath(location.pathname);
  const contextLabel = company
    ? `${company.name} · ${MODULE_LABEL[module]?.[locale] ?? module} · ${location.pathname}`
    : '';

  const send = useCallback(async () => {
    const text = draft.trim();
    if (!companyId || text.length < 2 || busy) return;
    setBusy(true);
    setError(null);
    setMessages((current) => [
      ...current,
      { id: `local-${Date.now()}`, role: 'user', content: text },
    ]);
    setDraft('');
    try {
      let id = conversationId;
      if (!id) {
        const created = await api.post<ConversationResponse>(
          `/companies/${companyId}/ai/assistant/conversations`,
          {
            companyId,
            module,
            screen: location.pathname,
            locale,
          },
        );
        id = created.conversation.id;
        setConversationId(id);
      }
      const res = await api.post<MessageResponse>(
        `/companies/${companyId}/ai/assistant/conversations/${id}/messages`,
        { companyId, text },
      );
      // Only the assistant answer is appended: the user message is already
      // displayed locally, so the list is never duplicated.
      const answer = res.messages.find((m) => m.role === 'assistant');
      setMessages((current) => [
        ...current,
        ...(answer
          ? [
              {
                id: answer.id,
                role: 'assistant' as const,
                content: answer.content,
                actions: answer.payload?.actions ?? [],
              },
            ]
          : []),
      ]);
    } catch (err) {
      const info = errorMessage(err, t('common.error'));
      setError(info.message);
    } finally {
      setBusy(false);
    }
  }, [busy, companyId, conversationId, draft, locale, location.pathname, module, t]);

  const reset = useCallback(() => {
    setConversationId(null);
    setMessages([]);
    setDraft('');
    setError(null);
  }, []);

  if (!company) return null;

  return (
    <>
      <button
        type="button"
        className="assistant-fab"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls="assistant-panel"
        title={t('assistant.open')}
      >
        <span aria-hidden="true">✨</span>
        <span className="assistant-fab-label">{t('assistant.pill')}</span>
      </button>

      {open && (
        <div id="assistant-panel">
          <Suspense fallback={null}>
            <AssistantPanel
              contextLabel={contextLabel}
              messages={messages}
              draft={draft}
              busy={busy}
              error={error}
              onDraft={setDraft}
              onSend={() => void send()}
              onClose={() => setOpen(false)}
              onReset={reset}
              onExamine={(href) => {
                // Navigation keeps the company (same session) and the
                // conversation. The panel closes so the target screen, its
                // tables and its validation buttons stay visible.
                navigate(href);
                setOpen(false);
              }}
            />
          </Suspense>
        </div>
      )}
    </>
  );
}
