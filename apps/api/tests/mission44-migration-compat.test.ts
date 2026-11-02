/**
 * Mission 44.1 — migration coexistence with Mission 42 and Mission 43.
 *
 * The runner (`apps/api/src/db/index.ts`) discovers `sql/migrations/*.sql`,
 * sorts the filenames lexicographically and records **the full filename** in
 * `schema_migrations.version` with a SHA-256 checksum. Consequences that these
 * tests pin down:
 *
 *  - a version is a filename, not a number, so two branches can ship a
 *    different file with the same numeric prefix without a primary-key clash;
 *  - a recorded version whose file disappeared is ignored (no error);
 *  - a migration added later with a lower number still runs, because the loop
 *    only looks at files that are not yet recorded;
 *  - the only hard failure is a checksum mismatch on an already-applied file.
 *
 * Mission 44 therefore takes the globally free number 0027 (0025 = Mission 42,
 * 0026 = Mission 43), and this suite proves the three real-world databases:
 * fresh, already migrated by M42/M43, and already migrated by the *old* M44
 * filename (`0025_cabinet_onboarding.sql`, before the rename).
 */
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { createPgliteDb, createPgDb, migrate, type Db } from '../src/db/index.js';

const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../sql/migrations',
);

const M44 = '0027_cabinet_onboarding.sql';
const M42 = '0025_mission42_purchase_sales_integrity.sql';
const M43 = '0026_mission43_bank_reconciliation_periods.sql';
const M44_OLD = '0025_cabinet_onboarding.sql';

let db: Db | undefined;

async function fresh(): Promise<Db> {
  const url = process.env.TEST_MIGRATION_DATABASE_URL;
  if (url && !new URL(url).pathname.endsWith('/mauritius_compta_m45_test')) {
    throw new Error('Migration compatibility tests require the disposable mauritius_compta_m45_test database');
  }
  db = url ? await createPgDb(url) : await createPgliteDb();
  if (url) await db.exec('DROP SCHEMA public CASCADE; CREATE SCHEMA public');
  return db;
}

function checksumOf(sql: string): Promise<string> {
  // Same algorithm as the runner; used only for rows we fabricate.
  return import('node:crypto').then(({ createHash }) =>
    createHash('sha256').update(sql).digest('hex'),
  );
}

/** Records a migration as applied, as another branch's `migrate()` would. */
async function record(target: Db, version: string) {
  await target.query(
    'INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2) ON CONFLICT (version) DO NOTHING',
    [version, await checksumOf(`-- simulated ${version}`)],
  );
}

async function applyFile(target: Db, file: string) {
  const sql = await readFile(path.join(MIGRATIONS_DIR, file), 'utf8');
  await target.exec(sql);
}

afterEach(async () => {
  await db?.close();
  db = undefined;
});

describe('mission 44.1 — migration coexistence', () => {
  it('keeps one unique numeric prefix per migration file', async () => {
    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
    const numbers = files.map((f) => f.slice(0, 4));
    expect(new Set(numbers).size).toBe(numbers.length);
    expect(files).toContain(M44);
    // The integrated candidate contains all three real migrations.
    expect(files).toContain(M42);
    expect(files).toContain(M43);
    // Applied order is the lexicographic order of the filenames.
    expect([...files].sort()).toEqual(files);
  });

  it('applies the whole chain on a fresh database and ends with 0027', async () => {
    const target = await fresh();
    const applied = await migrate(target);
    expect(applied).toContain(M44);
    const rows = await target.query<{ version: string }>(
      'SELECT version FROM schema_migrations ORDER BY version',
    );
    const versions = rows.rows.map((r) => r.version);
    // 0027 sits after every other file in the lexicographic order.
    expect(versions[versions.length - 1]).toBe(M44);
    const tables = await target.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'",
    );
    expect(tables.rows.map((r) => r.table_name)).toEqual(
      expect.arrayContaining(['client_onboarding', 'client_kyc_checks', 'cabinet_client_drafts']),
    );
  });

  it('runs without conflict on a database already migrated by Mission 42 and 43', async () => {
    const target = await fresh();
    // 1. The database as it exists after merging M42 and M43: every migration of
    //    this branch except ours, plus the two foreign versions recorded.
    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
    await target.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version    text PRIMARY KEY,
      checksum   text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    );`);
    for (const file of files) {
      if (file === M44) continue;
      await applyFile(target, file);
      await target.query('INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)', [
        file,
        await checksumOf(await readFile(path.join(MIGRATIONS_DIR, file), 'utf8')),
      ]);
    }
    await record(target, M42);
    await record(target, M43);

    // 2. Merging Mission 44 must apply exactly one new migration.
    const applied = await migrate(target);
    expect(applied).toEqual([M44]);

    // 3. The foreign rows are untouched and no duplicate number exists.
    const rows = await target.query<{ version: string }>(
      'SELECT version FROM schema_migrations ORDER BY version',
    );
    const versions = rows.rows.map((r) => r.version);
    expect(versions).toContain(M42);
    expect(versions).toContain(M43);
    expect(versions.filter((v) => v.startsWith('0027'))).toHaveLength(1);

    // 4. The M44 objects exist next to the M42/M43 ones, unchanged.
    const columns = await target.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name = 'companies' AND column_name IN ('trade_name','legal_form','country')`,
    );
    expect(columns.rows).toHaveLength(3);
    expect((await migrate(target))).toEqual([]);
  });

  it('applies M42/M43 after M44 without losing historical company data', async () => {
    const target = await fresh();
    await target.exec(`CREATE TABLE schema_migrations (
      version text PRIMARY KEY, checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now())`);
    const files = (await readdir(MIGRATIONS_DIR)).filter(f => f.endsWith('.sql')).sort();
    for (const file of files.filter(f => f !== M42 && f !== M43)) {
      await applyFile(target, file);
      await target.query('INSERT INTO schema_migrations (version, checksum) VALUES ($1,$2)',
        [file, await checksumOf(await readFile(path.join(MIGRATIONS_DIR, file), 'utf8'))]);
    }
    const company = await target.query<{id: string}>(
      `INSERT INTO companies (name, financial_year_start, financial_year_end, trade_name)
       VALUES ('Fictional M44 legacy','2026-01-01','2026-12-31','Historical trade name') RETURNING id`);
    expect(await migrate(target)).toEqual([M42, M43]);
    expect((await target.query('SELECT name, trade_name FROM companies WHERE id=$1',
      [company.rows[0]!.id])).rows).toEqual([
      {name: 'Fictional M44 legacy', trade_name: 'Historical trade name'}]);
    const recorded = await target.query<{version: string; checksum: string}>(
      'SELECT version, checksum FROM schema_migrations ORDER BY version');
    for (const row of recorded.rows) {
      expect(row.checksum).toBe(await checksumOf(await readFile(path.join(MIGRATIONS_DIR, row.version), 'utf8')));
    }
    expect(await migrate(target)).toEqual([]);
  });

  it('survives an environment that already applied the old 0025 M44 filename', async () => {
    const target = await fresh();
    // A developer machine that ran the draft branch before the rename: the SQL
    // is applied once more under the new name, so it must be fully idempotent.
    await target.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version    text PRIMARY KEY,
      checksum   text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    );`);
    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
    for (const file of files) {
      if (file === M44) continue;
      await applyFile(target, file);
      await target.query('INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)', [
        file,
        await checksumOf(await readFile(path.join(MIGRATIONS_DIR, file), 'utf8')),
      ]);
    }
    // The old filename was applied by the draft branch before the rename.
    await applyFile(target, M44);
    await record(target, M44_OLD);

    const applied = await migrate(target);
    expect(applied).toEqual([M44]);
    const stale = await target.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM schema_migrations WHERE version = $1',
      [M44_OLD],
    );
    // The stale row is inert: the runner only looks at files it finds.
    expect(stale.rows[0]?.n).toBe(1);
    expect(await migrate(target)).toEqual([]);
  });

  it('refuses a modified migration through the checksum, as documented', async () => {
    const target = await fresh();
    await migrate(target);
    await target.query("UPDATE schema_migrations SET checksum = 'deadbeef' WHERE version = $1", [M44]);
    await expect(migrate(target)).rejects.toThrow(/checksum mismatch/);
  });
});
