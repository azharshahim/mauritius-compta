import { useEffect, useRef } from 'react';
import { useI18n } from '../i18n';
import { Spinner } from './ui';

/**
 * Universal AI assistant panel (mission 7).
 *
 * This component is lazily loaded: the floating pill is always available, the
 * panel code is only downloaded when the user first opens it.
 *
 * Mobile rules honoured here:
 *  - the panel is a full-screen sheet on small screens, placed above the safe
 *    areas, with its own scrolling message list;
 *  - the composer stays inside the visual viewport (the message list scrolls,
 *    the input does not move under the virtual keyboard);
 *  - no field is ever auto-focused: opening the panel never re-opens the
 *    Samsung keyboard or steals focus from the current form (same rule as the
 *    keyboard fix of mission 5);
 *  - nothing important is covered: the pill sits bottom-right, above the
 *    content, and the panel can always be closed with the visible × button or
 *    Escape.
 */

export interface AssistantActionView {
  kind: 'proposal' | 'navigation';
  id?: string;
  title: { fr: string; en: string };
  description: { fr: string; en: string };
  dataUsed?: string[];
  expected?: { fr: string; en: string };
  risks?: string[];
  examineHref?: string;
}

export interface AssistantChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  actions?: AssistantActionView[];
}

export interface AssistantPanelProps {
  contextLabel: string;
  messages: AssistantChatMessage[];
  draft: string;
  busy: boolean;
  error: string | null;
  onDraft: (value: string) => void;
  onSend: () => void;
  onClose: () => void;
  onExamine: (href: string) => void;
  onReset: () => void;
}

export default function AssistantPanel({
  contextLabel,
  messages,
  draft,
  busy,
  error,
  onDraft,
  onSend,
  onClose,
  onExamine,
  onReset,
}: AssistantPanelProps) {
  const { t, locale } = useI18n();
  const listRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);

  // Escape closes the panel and returns the focus to the close button of the
  // launcher: no focus is ever pushed into a form field.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    const node = listRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [messages.length, busy]);

  return (
    <section
      className="assistant-panel"
      role="dialog"
      aria-label={t('assistant.title')}
      aria-modal="false"
      data-testid="assistant-panel"
    >
      <header className="assistant-head">
        <div>
          <strong>✨ {t('assistant.title')}</strong>
          <div className="assistant-context">{contextLabel}</div>
        </div>
        <div className="assistant-head-actions">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={onReset}
            title={t('assistant.newConversation')}
          >
            {t('assistant.newConversation')}
          </button>
          <button
            ref={closeRef}
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={onClose}
            aria-label={t('assistant.close')}
            title={t('assistant.close')}
          >
            ✕
          </button>
        </div>
      </header>

      <div className="assistant-messages" ref={listRef} aria-live="polite">
        {messages.length === 0 && (
          <div className="assistant-intro">
            <p>{t('assistant.intro')}</p>
            <div className="assistant-suggestions">
              {['assistant.suggestion.unpaid', 'assistant.suggestion.tasks', 'assistant.suggestion.balance', 'assistant.suggestion.entry'].map(
                (key) => {
                  const text = t(key);
                  return (
                    <button
                      key={key}
                      type="button"
                      className="assistant-chip"
                      onClick={() => onDraft(text)}
                    >
                      {text}
                    </button>
                  );
                },
              )}
            </div>
          </div>
        )}

        {messages.map((message) => (
          <article key={message.id} className={`assistant-message ${message.role}`}>
            <div className="assistant-bubble">{message.content}</div>
            {message.actions && message.actions.length > 0 && (
              <div className="assistant-actions">
                {message.actions.map((action, index) => (
                  <div key={`${message.id}-${index}`} className="assistant-action">
                    <strong>{action.title[locale]}</strong>
                    <p>{action.description[locale]}</p>
                    {action.dataUsed && action.dataUsed.length > 0 && (
                      <p className="assistant-meta">
                        {t('assistant.dataUsed')}: {action.dataUsed.join(', ')}
                      </p>
                    )}
                    {action.expected && (
                      <p className="assistant-meta">{action.expected[locale]}</p>
                    )}
                    {action.risks && action.risks.length > 0 && (
                      <ul className="assistant-risks">
                        {action.risks.map((risk) => (
                          <li key={risk}>{risk}</li>
                        ))}
                      </ul>
                    )}
                    {action.examineHref && (
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => onExamine(action.examineHref!)}
                      >
                        {t('assistant.examine')}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </article>
        ))}

        {busy && <Spinner label={t('assistant.thinking')} />}
        {error && <div className="alert alert-error">{error}</div>}
      </div>

      <form
        className="assistant-composer"
        onSubmit={(event) => {
          event.preventDefault();
          onSend();
        }}
      >
        <label className="sr-only" htmlFor="assistant-input">
          {t('assistant.placeholder')}
        </label>
        <input
          id="assistant-input"
          type="text"
          value={draft}
          onChange={(event) => onDraft(event.target.value)}
          placeholder={t('assistant.placeholder')}
          maxLength={600}
          autoComplete="off"
          enterKeyHint="send"
        />
        <button type="submit" className="btn btn-primary btn-sm" disabled={busy || draft.trim().length < 2}>
          {t('assistant.send')}
        </button>
      </form>
      <p className="assistant-foot">{t('assistant.disclaimer')}</p>
    </section>
  );
}
