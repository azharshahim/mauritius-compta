import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { AppIcon } from './AppIcon';
import { useI18n } from '../i18n';
import { resolveContextualNavigation } from '../contextualNavigation';
import { demoEnabled } from '../demo/mode';
import {
  GUIDED_TOUR_STEPS,
  deactivateGuidedTour,
  guidedTourDemoPath,
  guidedTourStepPath,
  readGuidedTour,
  setGuidedTourStep,
  type GuidedTourState,
} from '../guidedTour';

const TRAIL_KEY = 'mc.nav.trail.v1';

interface TrailEntry {
  key: string;
  url: string;
}

interface Trail {
  entries: TrailEntry[];
  index: number;
}

function readTrail(): Trail {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(TRAIL_KEY) ?? '') as Partial<Trail>;
    const entries = Array.isArray(parsed.entries)
      ? parsed.entries.filter(
          (entry): entry is TrailEntry =>
            !!entry && typeof entry.key === 'string' && typeof entry.url === 'string',
        )
      : [];
    const index = Number.isInteger(parsed.index) ? Number(parsed.index) : entries.length - 1;
    return { entries: entries.slice(-30), index: Math.min(index, entries.length - 1) };
  } catch {
    return { entries: [], index: -1 };
  }
}

/**
 * Records only routes rendered by the authenticated application. A direct URL
 * therefore has no internal predecessor and Back falls back to a parent page
 * instead of leaving COMPTAI.
 */
function remember(key: string, url: string): Trail {
  const trail = readTrail();
  let index = trail.entries.findIndex((entry) => entry.key === key);
  if (index < 0) {
    const last = trail.entries[trail.entries.length - 1];
    if (last && last.url === url) {
      last.key = key;
      index = trail.entries.length - 1;
    } else {
      const kept = trail.entries.slice(0, Math.max(0, trail.index + 1));
      kept.push({ key, url });
      trail.entries = kept.slice(-30);
      index = trail.entries.length - 1;
    }
  }
  trail.index = index;
  try {
    sessionStorage.setItem(TRAIL_KEY, JSON.stringify(trail));
  } catch {
    // Navigation still works without the progress marker.
  }
  return trail;
}

function isSafeInternalUrl(url: string | undefined): url is string {
  if (!url || !url.startsWith('/')) return false;
  return url !== '/' && !url.startsWith('/login');
}

function hasDirtyDialog(): boolean {
  return Boolean(document.querySelector('.modal[data-nav-dirty="true"], [data-nav-dirty="true"]'));
}

export function ContextualNav({ canAccess }: { canAccess?: (to: string) => boolean }) {
  const { t } = useI18n();
  const location = useLocation();
  const navigate = useNavigate();
  const navigation = resolveContextualNavigation(location.pathname, location.search);
  const [canGoBack, setCanGoBack] = useState(false);
  const [tour, setTour] = useState<GuidedTourState>(() =>
    demoEnabled ? readGuidedTour() : { active: false, step: 0, updatedAt: 0 },
  );

  const url = `${location.pathname}${location.search}`;

  useEffect(() => {
    const trail = remember(location.key, url);
    const previous = trail.entries[trail.index - 1];
    // `idx > 0` is the browser's own guarantee that a predecessor exists. In
    // environments without that history state, the in-app trail is sufficient:
    // it is only populated by routes rendered inside the authenticated shell.
    const stackIndex = (window.history.state as { idx?: number } | null)?.idx;
    setCanGoBack(
      isSafeInternalUrl(previous?.url) &&
        previous.url !== url &&
        (typeof stackIndex !== 'number' || stackIndex > 0),
    );
  }, [location.key, url]);

  useEffect(() => {
    const stored = demoEnabled
      ? readGuidedTour()
      : { active: false, step: 0, updatedAt: 0 };
    if (!demoEnabled || !stored.active) {
      setTour(stored);
      return;
    }
    if (location.pathname === '/demo') {
      setTour(deactivateGuidedTour());
      return;
    }
    // The controls claim that the current screen was opened from the tour.
    // Leaving that destination through another menu must drop the claim rather
    // than showing a misleading "Back to Guided Demo" on an unrelated screen.
    const stepPath = guidedTourStepPath(stored.step).split('?')[0];
    if (location.pathname !== stepPath) {
      setTour(deactivateGuidedTour());
      return;
    }
    setTour(stored);
  }, [location.key, location.pathname, location.search]);

  const confirmLeave = (): boolean => {
    if (!hasDirtyDialog()) return true;
    if (typeof window.confirm !== 'function') return false;
    return window.confirm(t('nav.unsavedConfirm'));
  };

  const back = () => {
    if (!confirmLeave()) return;
    if (canGoBack) {
      navigate(-1);
      return;
    }
    navigate(navigation.fallbackPath);
  };

  const tourActive = demoEnabled && tour.active && location.pathname !== '/demo';

  const goToStep = (step: number) => {
    if (!confirmLeave()) return;
    setTour(setGuidedTourStep(step));
    navigate(guidedTourStepPath(step));
  };

  const backToDemo = () => {
    if (!confirmLeave()) return;
    setTour(deactivateGuidedTour());
    navigate(guidedTourDemoPath(tour.step));
  };

  const exitTour = () => {
    setTour(deactivateGuidedTour());
  };

  return (
    <div className={`context-nav ${tourActive ? 'has-tour' : ''}`} data-group={navigation.groupKey}>
      <div className="context-nav-main">
        {navigation.showBack && !tourActive && (
          <button
            type="button"
            className="context-back"
            onClick={back}
            aria-label={t('common.back')}
            title={t('common.back')}
          >
            <AppIcon name="back" size={16} />
            <span>{t('common.back')}</span>
          </button>
        )}
        <nav className="breadcrumbs" aria-label={t('nav.breadcrumb')}>
          <ol>
            {navigation.crumbs.map((crumb, index) => {
              const current = index === navigation.crumbs.length - 1;
              return (
                <li key={`${crumb.labelKey}-${index}`}>
                  {crumb.to && !current && (!canAccess || canAccess(crumb.to)) ? (
                    <Link to={crumb.to}>{t(crumb.labelKey)}</Link>
                  ) : (
                    <span aria-current={current ? 'page' : undefined}>{t(crumb.labelKey)}</span>
                  )}
                </li>
              );
            })}
          </ol>
        </nav>
      </div>

      {tourActive && (
        <div className="tour-nav" role="group" aria-label={t('nav.guidedControls')}>
          <span className="tour-progress">
            <strong>{t('nav.demo.guided')}</strong>{' '}
            <span>
              {t('demo.tour.step')} {tour.step + 1} {t('demo.tour.of')} {GUIDED_TOUR_STEPS}
            </span>
          </span>
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={() => goToStep(tour.step - 1)}
            disabled={tour.step <= 0}
          >
            {t('demo.tour.previous')}
          </button>
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={() => goToStep(tour.step + 1)}
            disabled={tour.step >= GUIDED_TOUR_STEPS - 1}
          >
            {t('demo.tour.next')}
          </button>
          <button type="button" className="btn btn-sm" onClick={backToDemo}>
            {t('demo.tour.back')}
          </button>
          <button
            type="button"
            className="icon-btn tour-exit"
            onClick={exitTour}
            aria-label={t('demo.tour.exit')}
            title={t('demo.tour.exit')}
          >
            <AppIcon name="close" size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
