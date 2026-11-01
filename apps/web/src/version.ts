/**
 * Build metadata displayed by the application and the public demo.
 * Values are injected by Vite; the fallbacks keep unit tests and local
 * development deterministic. No network call is made to discover a version.
 */
declare const __APP_VERSION__: string | undefined;
declare const __BUILD_COMMIT__: string | undefined;
declare const __BUILD_DATE__: string | undefined;

export const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.1.1';
export const BUILD_COMMIT = typeof __BUILD_COMMIT__ === 'string' ? __BUILD_COMMIT__ : 'local';
export const BUILD_DATE = typeof __BUILD_DATE__ === 'string' ? __BUILD_DATE__ : '';
export const SHORT_COMMIT = BUILD_COMMIT === 'local' ? 'local' : BUILD_COMMIT.slice(0, 7);
