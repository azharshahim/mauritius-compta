import { useState } from 'react';
import { useI18n } from '../i18n';
import { demoEnabled, isDemoVolatile, resetDemo } from '../demo';

/**
 * Permanent demonstration marker (mission 9, point L).
 *
 * It is a compact chip inside the header — never a fixed bottom bar that could
 * cover Android buttons, the AI launcher or the safe area. Clicking it opens
 * the full explanation and the reset action. It can never be dismissed for
 * good: as long as `demoEnabled` is true, the chip is rendered.
 */
export function DemoBanner({ login = false }: { login?: boolean }) {
  const { t, locale } = useI18n();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!demoEnabled) return null;

  const reset = () => {
    if (!window.confirm(t('demo.resetConfirm'))) return;
    setBusy(true);
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
          {isDemoVolatile() && <p className="muted small">{t('demo.volatile')}</p>}
          <p className="muted small">
            {locale === 'fr'
              ? 'Aucune donnée réelle, aucune connexion bancaire, aucun appel réseau : tout reste dans ce navigateur.'
              : 'No real data, no bank connection, no network call: everything stays in this browser.'}
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
