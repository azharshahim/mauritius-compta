import { loadConfig } from '../config.js';
import { createPgDb, createPgliteDb, migrate } from './index.js';

for (const candidate of ['.env', '../../.env']) {
  try {
    process.loadEnvFile?.(candidate);
    break;
  } catch {
    /* file not found: try the next candidate */
  }
}

const config = loadConfig();
const db = config.DATABASE_URL
  ? await createPgDb(config.DATABASE_URL, { ssl: config.DATABASE_SSL, max: config.DATABASE_POOL_MAX })
  : await createPgliteDb(process.env.PGLITE_DIR ?? './.data/pglite');

try {
  const applied = await migrate(db);
  if (applied.length === 0) {
    console.log('Database is up to date.');
  } else {
    console.log(`Applied ${applied.length} migration(s):`);
    for (const m of applied) console.log(`  - ${m}`);
  }
} finally {
  await db.close();
}
