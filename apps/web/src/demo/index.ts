/**
 * Demo entry point used by tests and by the opt-in demo build.
 *
 * Runtime screens import `demoEnabled` from `./mode`; the real application calls
 * `./runtime` only through explicit dynamic imports, so fictional data cannot
 * become a fallback when the API is unreachable.
 */
export { demoEnabled, appMode } from './mode';
export {
  DEMO_EMAIL,
  DEMO_PASSWORD,
  currentUser,
  demoCsv,
  demoRequest,
  isDemoVolatile,
  resetDemo,
} from './runtime';
