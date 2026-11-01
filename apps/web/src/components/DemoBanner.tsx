import { useEffect, useState } from 'react';
import { useI18n } from '../i18n';
import { demoEnabled } from '../demo/mode';
import { APP_VERSION, SHORT_COMMIT } from '../version';

/**
 * Permanent demonstration marker (mission 9, point L).
 *
 * It is a compact chip inside the header — never a fixed bottom bar that could
 * cover Android buttons, the AI launcher or the safe area. Clicking it opens
 * the full explanation and the reset action. It can never be dismissed for
 * good: as long as `demoEnabled` is true, the chip is rendered.
 */
export function DemoBanner({ login = false }: { login?: boolean }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [volatile, setVolatile] = useState(false);

  // Runtime is loaded only in an opt-in demo build; the real application has
  // no import path that can execute fictional data.
  useEffect(() => {
    if (!demoEnabled) return;
    let active = true;
    void import('../demo/runtime').then(({ isDemoVolatile }) => {
      if (active) setVolatile(isDemoVolatile());
    }).catch(() => undefined);
    return () => { active = false; };
  }, []);

  if (!demoEnabled) return null;

  const reset = async () => {
    if (!window.confirm(t('demo.resetConfirm'))) return;
    setBusy(true);
    const { resetDemo } = await import('../demo/runtime');
    resetDemo();
    window.location.hash = '#/';
    window.location.reload();
  };

  return (
    <div className={`demo-indicator ${login ? 'login' : ''}`}>
      <button
        type="button"
        className="demo-chip"
        aria-label={login ? t('demo.badge') : `${t('demo.badge')} — ${t('demo.explain')}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="demo-dot" aria-hidden="true" />
        <span className="demo-chip-label">{login ? t('demo.badge') : t('demo.short')}</span>
        {login && <span className="demo-chip-extra">{t('demo.text')}</span>}
      </button>

      {open && (
        <div className="demo-popover" role="dialog" aria-label={t('demo.badge')}>
          <div className="demo-popover-head">
            <strong>{t('demo.badge')}</strong>
            <button
              type="button"
              className="icon-btn"
              aria-label={t('common.close')}
              onClick={() => setOpen(false)}
            >
              ×
            </button>
          </div>
          <p>{t('demo.text')}</p>
          {volatile && <p className="muted small">{t('demo.volatile')}</p>}
          <p className="muted small">{t('demo.noNetwork')}</p>
          <p className="muted small mono">
            {t('app.version')} {APP_VERSION} · {t('app.commit')} {SHORT_COMMIT}
          </p>
          <div className="demo-popover-actions">
            <button type="button" className="btn btn-danger" onClick={reset} disabled={busy}>
              {t('demo.reset')}
            </button>
            <button type="button" className="btn" onClick={() => setOpen(false)}>
              {t('common.close')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
