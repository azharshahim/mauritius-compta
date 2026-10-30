/**
 * Database abstraction.
 *
 * Production uses `pg` against a real PostgreSQL server. Tests and the
 * zero-install demo mode use PGlite (the actual PostgreSQL engine compiled to
 * WASM) so that migrations and SQL are exercised against real PostgreSQL
 * semantics.
 */
import { mkdir, readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export type SqlValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | Date
  | SqlValue[]
  | Record<string, unknown>;
export type Row = Record<string, any>;

export interface QueryResult<T = Row> {
  rows: T[];
  rowCount: number;
}

export interface Db {
  query<T = Row>(sql: string, params?: readonly unknown[]): Promise<QueryResult<T>>;
  /** Runs `fn` inside a transaction; rolls back on any thrown error. */
  transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T>;
  exec(sql: string): Promise<void>;
  close(): Promise<void>;
  readonly kind: 'postgres' | 'pglite';
}

const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../sql/migrations',
);

export async function migrate(db: Db): Promise<string[]> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    text PRIMARY KEY,
      checksum   text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    );
  `);

  const files = (await readdir(MIGRATIONS_DIR))
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const applied = new Map<string, string>(
    (await db.query<{ version: string; checksum: string }>(
      'SELECT version, checksum FROM schema_migrations',
    )).rows.map((r) => [r.version, r.checksum]),
  );

  const newlyApplied: string[] = [];
  for (const file of files) {
    const sql = await readFile(path.join(MIGRATIONS_DIR, file), 'utf8');
    const checksum = createHash('sha256').update(sql).digest('hex');
    const already = applied.get(file);

    if (already) {
      if (already !== checksum) {
        throw new Error(
          `Migration ${file} was modified after being applied (checksum mismatch). ` +
            'Create a new migration instead of editing an applied one.',
        );
      }
      continue;
    }

    await db.transaction(async (tx) => {
      await tx.exec(sql);
      await tx.query(
        'INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)',
        [file, checksum],
      );
    });
    newlyApplied.push(file);
  }

  return newlyApplied;
}

export async function createPgDb(connectionString: string, opts: { ssl?: boolean; max?: number } = {}): Promise<Db> {
  const { default: pg } = await import('pg');
  // Return DATE / TIMESTAMPTZ as ISO strings: predictable JSON output, dates
  // usable directly in <input type="date"> without timezone shifts.
  pg.types.setTypeParser(1082, (v: string) => v);
  pg.types.setTypeParser(1184, (v: string) => v);
  const pool = new pg.Pool({
    connectionString,
    max: opts.max ?? 10,
    ssl: opts.ssl ? { rejectUnauthorized: false } : undefined,
  });

  // Keep numeric/decimal as strings to avoid precision loss.
  const client: Db = {
    kind: 'postgres',
    async query<T = Row>(sql: string, params: readonly unknown[] = []) {
      const res = await pool.query(sql, params as any[]);
      return { rows: res.rows as T[], rowCount: res.rowCount ?? 0 };
    },
    async exec(sql: string) {
      await pool.query(sql);
    },
    async transaction<T>(fn: (tx: Db) => Promise<T>) {
      const conn = await pool.connect();
      try {
        await conn.query('BEGIN');
        const tx: Db = {
          kind: 'postgres',
          async query<U = Row>(sql: string, params: readonly unknown[] = []) {
            const res = await conn.query(sql, params as any[]);
            return { rows: res.rows as U[], rowCount: res.rowCount ?? 0 };
          },
          async exec(s: string) {
            await conn.query(s);
          },
          transaction: (inner) => inner(tx),
          close: async () => {},
        };
        const out = await fn(tx);
        await conn.query('COMMIT');
        return out;
      } catch (err) {
        await conn.query('ROLLBACK');
        throw err;
      } finally {
        conn.release();
      }
    },
    async close() {
      await pool.end();
    },
  };
  return client;
}

export async function createPgliteDb(dataDir?: string): Promise<Db> {
  const { PGlite } = await import('@electric-sql/pglite');
  const options = { parsers: { 1082: (v: string) => v, 1184: (v: string) => v } };
  if (dataDir) await mkdir(path.dirname(path.resolve(dataDir)), { recursive: true });
  const lite = dataDir ? new PGlite(dataDir, options) : new PGlite(options);
  await lite.waitReady;

  const wrap = (queryFn: (sql: string, params?: any[]) => Promise<any>): Db => ({
    kind: 'pglite',
    async query<T = Row>(sql: string, params: readonly unknown[] = []) {
      const res = await queryFn(sql, params as any[]);
      const rows = (res.rows ?? []) as T[];
      // PGlite reports affectedRows only for DML; SELECT results are in rows.
      const rowCount = rows.length > 0 ? rows.length : (res.affectedRows ?? 0);
      return { rows, rowCount };
    },
    async exec(sql: string) {
      await lite.exec(sql);
    },
    async transaction<T>(fn: (tx: Db) => Promise<T>) {
      return lite.transaction(async (t: any) => {
        const tx = wrap((sql, params) => t.query(sql, params));
        if (typeof t.exec === 'function') tx.exec = (sql: string) => t.exec(sql);
        return fn(tx);
      });
    },
    async close() {
      await lite.close();
    },
  });

  return wrap((sql, params) => lite.query(sql, params));
}
