import { demoSeedAllowed, loadConfig } from '../config.js';
import { createPgDb, createPgliteDb, migrate } from '../db/index.js';
import { seedDemo } from './demo.js';

for (const candidate of ['.env', '../../.env']) {
  try {
    process.loadEnvFile?.(candidate);
    break;
  } catch {
    /* file not found: try the next candidate */
  }
}

const config = loadConfig();

if (!demoSeedAllowed(config)) {
  console.error(
    'Refusing to load demonstration data with NODE_ENV=production.\n' +
      'Set ALLOW_DEMO_SEED=true only on a dedicated, non-production demo instance.',
  );
  process.exit(1);
}
const db = config.DATABASE_URL
  ? await createPgDb(config.DATABASE_URL, { ssl: config.DATABASE_SSL, max: config.DATABASE_POOL_MAX })
  : await createPgliteDb(process.env.PGLITE_DIR ?? './.data/pglite');

try {
  await migrate(db);
  const result = await seedDemo(db, { force: process.argv.includes('--force') });
  if (!result.created) {
    console.log('Demo data already present (use --force to recreate).');
  }
  console.log(`
Mauritius Compta — démonstration / demo
---------------------------------------
Company  : ${result.companyName}
CompanyId: ${result.companyId}
Login    : ${result.email}
Password : ${result.password}

ATTENTION: these credentials are for local demonstration only and all data is
fictitious. Never use them on a public deployment.
`);
} finally {
  await db.close();
}
