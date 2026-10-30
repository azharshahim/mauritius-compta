import { z } from 'zod';

const bool = (d: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? d : v.toLowerCase() === 'true'));

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default('0.0.0.0'),
  APP_URL: z.string().default('http://localhost:5173'),
  DATABASE_URL: z.string().optional(),
  DATABASE_SSL: bool(false),
  DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),
  SESSION_COOKIE_NAME: z.string().default('mc_session'),
  SESSION_TTL_HOURS: z.coerce.number().int().positive().default(168),
  COOKIE_SECURE: bool(false),
  PASSWORD_MIN_LENGTH: z.coerce.number().int().min(8).default(10),
  LOGIN_MAX_ATTEMPTS: z.coerce.number().int().positive().default(10),
  LOGIN_MAX_ATTEMPTS_PER_IP: z.coerce.number().int().positive().default(30),
  LOGIN_WINDOW_MINUTES: z.coerce.number().int().positive().default(15),
  SESSION_PURGE_ON_LOGIN: bool(true),
  ALLOW_REGISTRATION: bool(true),
  STORAGE_DIR: z.string().default('./storage'),
  MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(10 * 1024 * 1024),
  DEFAULT_LOCALE: z.enum(['fr', 'en']).default('fr'),
});

export type Config = z.infer<typeof EnvSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  const config = parsed.data;

  // Safe defaults for production: never open self-registration unless the
  // operator explicitly opts in, and never serve the demo seed by accident.
  if (env.ALLOW_REGISTRATION === undefined && config.NODE_ENV === 'production') {
    config.ALLOW_REGISTRATION = false;
  }
  return config;
}

/** Demo seeding is refused in production unless explicitly allowed. */
export function demoSeedAllowed(config: Config, env: NodeJS.ProcessEnv = process.env): boolean {
  if (config.NODE_ENV !== 'production') return true;
  return env.ALLOW_DEMO_SEED === 'true';
}

export const APP_VERSION = '0.1.1';
