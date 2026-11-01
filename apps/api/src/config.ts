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
  // Migration assistant: parsed uploads are purged after this many days.
  MIGRATION_RETENTION_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  MIGRATION_MAX_ROWS: z.coerce.number().int().min(10).max(20000).default(5000),
  DEFAULT_LOCALE: z.enum(['fr', 'en']).default('fr'),

  // ---------------------------------------------------------------- AI engine
  /** Global kill switch: no AI call is made anywhere when false. */
  AI_ENABLED: bool(true),
  AI_CATALOGUE_PATH: z.string().optional(),
  /** Dedicated key for API-key encryption (32 bytes, hex or base64). */
  AI_ENCRYPTION_KEY: z.string().optional(),
  AI_ENCRYPTION_KEY_VERSION: z.string().default('v1'),
  /** Previous keys kept for decryption during a rotation: "v0:<key>,v00:<key>". */
  AI_ENCRYPTION_PREVIOUS_KEYS: z.string().optional(),
  AI_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120_000).default(20_000),
  AI_MAX_RETRIES: z.coerce.number().int().min(0).max(2).default(1),
  AI_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).max(600).default(20),
  AI_MAX_INPUT_CHARS: z.coerce.number().int().min(100).max(200_000).default(12_000),
  AI_ALLOW_SIMULATED: bool(true),
  // Universal assistant (mission 7): bounded history and configurable retention.
  AI_ASSISTANT_MAX_TURNS: z.coerce.number().int().min(4).max(500).default(40),
  AI_CONVERSATION_RETENTION_DAYS: z.coerce.number().int().min(1).max(3650).default(30),
  AI_ALLOW_PRIVATE_BASE_URL: bool(false),

  // ------------------------------------------------------- Backup and restore
  /** Archives live outside STORAGE_DIR and are never served statically. */
  BACKUP_DIR: z.string().min(1).default('./backups'),
  /** Operator passphrase; never logged, never stored in an archive or in the DB. */
  BACKUP_ENCRYPTION_KEY: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.string().min(16).optional(),
  ),
  /** Comma-separated allowlist of system administrators allowed to back up. */
  BACKUP_ADMIN_EMAILS: z.string().optional(),
  BACKUP_MAX_BYTES: z.coerce.number().int().positive().default(256 * 1024 * 1024),
  BACKUP_MAX_UNCOMPRESSED_BYTES: z.coerce.number().int().positive().default(512 * 1024 * 1024),
  /** Off by default: only the offline CLI checks this flag. */
  BACKUP_RESTORE_ENABLED: bool(false),
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
  // The fictional provider never talks to the internet, but it must not be
  // reachable in production unless the operator opts in explicitly.
  if (config.NODE_ENV === 'production' && env.AI_ALLOW_SIMULATED === undefined) {
    config.AI_ALLOW_SIMULATED = false;
  }
  return config;
}

/** Demo seeding is refused in production unless explicitly allowed. */
export function demoSeedAllowed(config: Config, env: NodeJS.ProcessEnv = process.env): boolean {
  if (config.NODE_ENV !== 'production') return true;
  return env.ALLOW_DEMO_SEED === 'true';
}

export const APP_VERSION = '0.1.1';
