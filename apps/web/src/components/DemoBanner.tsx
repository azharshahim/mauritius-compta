import { useState } from 'react';
import { useI18n } from '../i18n';
import { demoEnabled, isDemoVolatile, resetDemo } from '../demo';

/**
 * Permanent, non-dismissible notice: the GitHub Pages build is a simulation.
 * It must never be possible to mistake it for a server-backed instance.
 */
export function DemoBanner() {
  const { t } = useI18n();
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
    <aside className="demo-banner" role="status" aria-live="polite">
      <strong className="demo-badge">{t('demo.badge')}</strong>
      <span className="demo-text">
        {t('demo.text')}
        {isDemoVolatile() && <strong> {t('demo.volatile')}</strong>}
      </span>
      <button type="button" className="demo-reset" onClick={reset} disabled={busy}>
        {t('demo.reset')}
      </button>
    </aside>
  );
}
