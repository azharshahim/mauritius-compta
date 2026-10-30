import Fastify from 'fastify';
import { buildApp } from './app.js';
import { APP_VERSION, loadConfig } from './config.js';
import { createPgDb, createPgliteDb, migrate } from './db/index.js';

// Load .env when present (Node >= 20.12 built-in loader, no dependency).
// Load .env from the current directory or from the repository root.
for (const candidate of ['.env', '../../.env']) {
  try {
    process.loadEnvFile?.(candidate);
    break;
  } catch {
    /* file not found: try the next candidate */
  }
}

const config = loadConfig();
const log = Fastify().log;

const db = config.DATABASE_URL
  ? await createPgDb(config.DATABASE_URL, { ssl: config.DATABASE_SSL, max: config.DATABASE_POOL_MAX })
  : await createPgliteDb(process.env.PGLITE_DIR ?? './.data/pglite');

if (!config.DATABASE_URL) {
  log.warn(
    'DATABASE_URL is not set: using embedded PGlite storage (development/demo only). ' +
      'Set DATABASE_URL to a PostgreSQL server for production.',
  );
}

const applied = await migrate(db);
if (applied.length > 0) log.info({ migrations: applied }, 'database migrations applied');

const app = await buildApp({ db, config });

async function shutdown(signal: string) {
  log.info({ signal }, 'shutting down');
  try {
    await app.close();
    await db.close();
  } finally {
    process.exit(0);
  }
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

try {
  await app.listen({ port: config.PORT, host: config.HOST });
  log.info(
    {
      version: APP_VERSION,
      database: db.kind,
      env: config.NODE_ENV,
    },
    `Mauritius Compta API listening on http://${config.HOST}:${config.PORT}`,
  );
} catch (err) {
  log.error({ err }, 'failed to start');
  process.exit(1);
}
