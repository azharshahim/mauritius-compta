import { useEffect, useState } from 'react';

/**
 * Mission 39 breakpoints, justified in docs/comptai-responsive-navigation-tests.md:
 *  - up to 900 px: phone/portrait tablet → off-canvas menu + bottom quick nav;
 *  - 901–1279 px: Windows window reduced/tablet landscape → 72 px icon rail;
 *  - 1280 px and above: full 264 px sidebar, optionally collapsed by the user.
 *
 * The sidebar markup is identical in every mode. CSS changes the presentation;
 * React only changes the interaction (drawer, temporary overlay, persisted
 * collapse), so no destination can disappear because of a viewport change.
 */
export type ViewportMode = 'mobile' | 'compact' | 'wide';

export function classifyViewport(width: number): ViewportMode {
  if (width <= 900) return 'mobile';
  if (width < 1280) return 'compact';
  return 'wide';
}

function currentWidth(): number {
  if (typeof window === 'undefined') return 1280;
  const width = window.innerWidth;
  return Number.isFinite(width) && width > 0 ? width : 1280;
}

export function useViewportMode(): ViewportMode {
  const [mode, setMode] = useState<ViewportMode>(() => classifyViewport(currentWidth()));

  useEffect(() => {
    const update = () => setMode(classifyViewport(currentWidth()));
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);
    // Read once after mount too: some embedded webviews resize before React
    // attaches its listener.
    update();
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
    };
  }, []);

  return mode;
}
