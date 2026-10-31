/**
 * Demo switch.
 *
 * `VITE_DEMO_MODE=true` is set only by the GitHub Pages workflow. The production
 * build served by the Fastify API keeps `false` and talks to the real backend.
 */
export const demoEnabled = import.meta.env.VITE_DEMO_MODE === 'true';

export {
  DEMO_EMAIL,
  DEMO_PASSWORD,
  currentUser,
  demoCsv,
  demoRequest,
  isDemoVolatile,
  resetDemo,
} from './runtime';
