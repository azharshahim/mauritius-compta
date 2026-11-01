/**
 * Compile-time switch between the real application and the browser demo.
 *
 * `VITE_DEMO_MODE` is injected by Vite at build time. It must be exactly the
 * string `"true"`; anything else is treated as the real application, so a
 * missing or malformed variable can never silently enable fictional data.
 *
 * This module deliberately has no import from `./runtime`: the real bundle can
 * reference the flag without pulling the entire demo backend into its graph.
 */
export const demoEnabled: boolean = import.meta.env.VITE_DEMO_MODE === 'true';

export const appMode: 'demo' | 'production' = demoEnabled ? 'demo' : 'production';

/**
 * Injected by Vite `define` (see `vite.config.ts`): real values only in the
 * opt-in demo build, empty strings in the production bundle. Login can prefill
 * synchronously without shipping a static credential in the real application.
 */
declare const __DEMO_EMAIL__: string;
declare const __DEMO_PASSWORD__: string;
export const DEMO_EMAIL = __DEMO_EMAIL__;
export const DEMO_PASSWORD = __DEMO_PASSWORD__;
