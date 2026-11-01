/**
 * Mission 34 — logical PostgreSQL snapshot, integrity checks and restore.
 *
 * The snapshot is logical: every row is read through the normal SQL interface and
 * written back with `json_populate_recordset(null::table, ...)`. Restoring across
 * engines is not guaranteed because PostgreSQL and PGlite format dates differently.
 * Numeric values stay strings end-to-end, so no accounting amount is ever
 * rounded through a JavaScript float. A single REPEATABLE READ transaction
 * gives the database side of the backup a consistent point in time.
 *
 * Restore is intentionally strict: it refuses a non-empty target, requires the
 * exact same migration history, restores inside one transaction, disables only
 * USER triggers for the duration of the load, and re-verifies every table
 * checksum before committing.
 */
import type { Db } from '../db/index.js';
import { AppError } from '../lib/errors.js';
import { rowsChecksum } from './archive.js';

export interface MigrationRef {
  version: string;
  checksum: string;
}

export interface TableSnapshot {
  name: string;
  rows: Record<string, unknown>[];
  rowCount: number;
  sha256: string;
}

export interface DatabaseSnapshot {
  engine: Db['kind'];
  migrations: MigrationRef[];
  tables: TableSnapshot[];
  rowCount: number;
  controls: BackupControls;
  excludedTables: string[];
}

export interface RestoreReport {
  tables: { name: string; rowCount: number; sha256: string }[];
  rowCount: number;
  migrations: MigrationRef[];
  controls: BackupControls;
}

export interface BackupControls {
  companies: number;
  users: number;
  postedEntries: number;
  journalLines: number;
  debitTotal: string;
  creditTotal: string;
  perCompany: {
    companyId: string;
    debit: string;
    credit: string;
    lines: number;
  }[];
  attachments: { count: number; bytes: number };
}

/** Tables excluded from backups and company exports, with a documented reason. */
export const EXCLUDED_TABLES = [
  'schema_migrations', // represented separately, never restored as data
  'sessions', // ephemeral authentication tokens (hashes)
  'login_attempts', // ephemeral security log, not business data
  'backup_runs', // operational backup history, rebuilt on the target
] as const;

const EXCLUDED = new Set<string>(EXCLUDED_TABLES);

export function quoteIdent(name: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) {
    throw new AppError('BACKUP_ARCHIVE_INVALID', 400, `Unsafe SQL identifier: ${name}`);
  }
  return `"${name}"`;
}

export async function listPublicTables(db: Db): Promise<string[]> {
  const res = await db.query<{ table_name: string }>(
    `SELECT table_name
       FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name`,
  );
  return res.rows.map((row) => row.table_name);
}

export async function schemaMigrations(db: Db): Promise<MigrationRef[]> {
  const exists = await db.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'schema_migrations'
     ) AS exists`,
  );
  if (!exists.rows[0]?.exists) return [];
  const res = await db.query<{ version: string; checksum: string }>(
    'SELECT version, checksum FROM schema_migrations ORDER BY version',
  );
  return res.rows.map((row) => ({ version: row.version, checksum: row.checksum }));
}

export function sameSchema(left: MigrationRef[], right: MigrationRef[]): boolean {
  return left.length === right.length &&
    left.every((item, index) =>
      item.version === right[index]?.version && item.checksum === right[index]?.checksum);
}

export async function dumpDatabase(db: Db): Promise<DatabaseSnapshot> {
  return db.transaction(async (tx) => {
    await tx.exec('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const migrations = await schemaMigrations(tx);
    const names = (await listPublicTables(tx)).filter((name) => !EXCLUDED.has(name));
    const tables: TableSnapshot[] = [];
    let rowCount = 0;
    for (const name of names) {
      const res = await tx.query<Record<string, unknown>>(`SELECT * FROM ${quoteIdent(name)}`);
      const rows = res.rows;
      tables.push({ name, rows, rowCount: rows.length, sha256: rowsChecksum(rows) });
      rowCount += rows.length;
    }
    return {
      engine: db.kind,
      migrations,
      tables,
      rowCount,
      controls: await computeControls(tx),
      excludedTables: [...EXCLUDED_TABLES],
    };
  });
}

/** Foreign-key dependencies, excluding self references (resolved per statement). */
async function foreignKeyGraph(db: Db): Promise<Map<string, Set<string>>> {
  const res = await db.query<{ child: string; parent: string }>(
    `SELECT DISTINCT child.relname AS child, parent.relname AS parent
       FROM pg_constraint c
       JOIN pg_class child ON child.oid = c.conrelid
       JOIN pg_class parent ON parent.oid = c.confrelid
       JOIN pg_namespace ns ON ns.oid = child.relnamespace
      WHERE c.contype = 'f'
        AND ns.nspname = 'public'
        AND child.relname <> parent.relname`,
  );
  const graph = new Map<string, Set<string>>();
  for (const row of res.rows) {
    if (!graph.has(row.child)) graph.set(row.child, new Set());
    graph.get(row.child)!.add(row.parent);
  }
  return graph;
}

export async function restoreOrder(db: Db, names: string[]): Promise<string[]> {
  const wanted = new Set(names);
  const graph = await foreignKeyGraph(db);
  const visiting = new Set<string>();
  const done = new Set<string>();
  const order: string[] = [];

  const visit = (name: string, trail: string[]) => {
    if (done.has(name)) return;
    if (visiting.has(name)) {
      throw new AppError(
        'BACKUP_RESTORE_ORDER_UNSUPPORTED',
        409,
        `Circular foreign-key dependency detected: ${[...trail, name].join(' -> ')}`,
      );
    }
    visiting.add(name);
    for (const parent of graph.get(name) ?? []) {
      if (wanted.has(parent)) visit(parent, [...trail, name]);
    }
    visiting.delete(name);
    done.add(name);
    order.push(name);
  };

  for (const name of [...names].sort()) visit(name, []);
  return order;
}

export async function computeControls(db: Db): Promise<BackupControls> {
  const counts = await db.query<{
    companies: string;
    users: string;
    posted_entries: string;
    journal_lines: string;
  }>(
    `SELECT
       (SELECT count(*) FROM companies)::text AS companies,
       (SELECT count(*) FROM app_users)::text AS users,
       (SELECT count(*) FROM journal_entries WHERE status = 'posted')::text AS posted_entries,
       (SELECT count(*) FROM journal_lines)::text AS journal_lines`,
  );
  const totals = await db.query<{ debit: string | null; credit: string | null }>(
    `SELECT SUM(debit)::text AS debit, SUM(credit)::text AS credit FROM journal_lines`,
  );
  const perCompany = await db.query<{
    company_id: string;
    debit: string | null;
    credit: string | null;
    lines: string;
  }>(
    `SELECT company_id, SUM(debit)::text AS debit, SUM(credit)::text AS credit, count(*)::text AS lines
       FROM journal_lines GROUP BY company_id ORDER BY company_id`,
  );
  const attachments = await db.query<{ count: string; bytes: string | null }>(
    `SELECT count(*)::text AS count, COALESCE(SUM(size_bytes), 0)::text AS bytes FROM attachments`,
  );
  const c = counts.rows[0]!;
  return {
    companies: Number(c.companies),
    users: Number(c.users),
    postedEntries: Number(c.posted_entries),
    journalLines: Number(c.journal_lines),
    debitTotal: totals.rows[0]?.debit ?? '0',
    creditTotal: totals.rows[0]?.credit ?? '0',
    perCompany: perCompany.rows.map((row) => ({
      companyId: row.company_id,
      debit: row.debit ?? '0',
      credit: row.credit ?? '0',
      lines: Number(row.lines),
    })),
    attachments: {
      count: Number(attachments.rows[0]?.count ?? 0),
      bytes: Number(attachments.rows[0]?.bytes ?? 0),
    },
  };
}

export async function assertEmptyTarget(db: Db): Promise<void> {
  const tables = await listPublicTables(db);
  if (tables.length > 0) {
    throw new AppError(
      'BACKUP_TARGET_NOT_EMPTY',
      409,
      'Restore refused: the target database already contains tables',
      { tables: tables.slice(0, 20) },
    );
  }
}

/**
 * Restores a snapshot into an empty, freshly migrated database.
 *
 * Triggers are disabled with `DISABLE TRIGGER USER` (table owner, no superuser
 * required) so that append-only/immutability guards do not reject a legitimate
 * logical restore. Foreign keys and CHECK constraints stay active.
 */
export async function restoreDatabase(
  target: Db,
  snapshot: DatabaseSnapshot,
  expected: { migrations: MigrationRef[]; controls: BackupControls; tables: TableSnapshot[] },
): Promise<RestoreReport> {
  const targetMigrations = await schemaMigrations(target);
  if (!sameSchema(snapshot.migrations, targetMigrations)) {
    throw new AppError(
      'BACKUP_SCHEMA_MISMATCH',
      409,
      'Restore refused: the archive migration history does not match the target database',
      { archive: snapshot.migrations, target: targetMigrations },
    );
  }
  if (!sameSchema(snapshot.migrations, expected.migrations)) {
    throw new AppError('BACKUP_MANIFEST_MISMATCH', 409, 'The manifest schema does not match the snapshot');
  }

  const names = snapshot.tables.map((table) => table.name);
  const order = await restoreOrder(target, names);
  const byName = new Map(snapshot.tables.map((table) => [table.name, table]));

  return target.transaction(async (tx) => {
    for (const name of order) {
      await tx.exec(`ALTER TABLE ${quoteIdent(name)} DISABLE TRIGGER USER`);
    }
    try {
      for (const name of order) {
        const table = byName.get(name)!;
        if (table.rows.length === 0) continue;
        await tx.query(
          `INSERT INTO ${quoteIdent(name)}
           SELECT * FROM json_populate_recordset(null::${quoteIdent(name)}, $1::json)`,
          [JSON.stringify(table.rows)],
        );
      }
    } finally {
      for (const name of order) {
        await tx.exec(`ALTER TABLE ${quoteIdent(name)} ENABLE TRIGGER USER`);
      }
    }

    // Serial/identity sequences are rebuilt from the restored data: never trust
    // a sequence state that would collide with an explicit restored id.
    const owned = await tx.query<{ sequence: string; table: string; column: string }>(
      `SELECT s.relname AS sequence, t.relname AS table, a.attname AS column
         FROM pg_class s
         JOIN pg_depend d ON d.objid = s.oid AND d.deptype IN ('a', 'i')
         JOIN pg_class t ON t.oid = d.refobjid
         JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = d.refobjsubid
        WHERE s.relkind = 'S' AND t.relnamespace = 'public'::regnamespace
        ORDER BY s.relname`,
    );
    for (const seq of owned.rows) {
      await tx.query(
        `SELECT setval($1::regclass,
                       COALESCE((SELECT MAX(${quoteIdent(seq.column)}) FROM ${quoteIdent(seq.table)}), 0) + 1,
                       false)`,
        [seq.sequence],
      );
    }

    const reportTables: RestoreReport['tables'] = [];
    let rowCount = 0;
    for (const table of snapshot.tables) {
      const res = await tx.query<Record<string, unknown>>(
        `SELECT * FROM ${quoteIdent(table.name)}`,
      );
      const checksum = rowsChecksum(res.rows);
      if (res.rows.length !== table.rowCount || checksum !== table.sha256) {
        throw new AppError(
          'BACKUP_RESTORE_VERIFICATION_FAILED',
          500,
          `Restore verification failed for table ${table.name}`,
          { expectedRows: table.rowCount, actualRows: res.rows.length },
        );
      }
      reportTables.push({ name: table.name, rowCount: res.rows.length, sha256: checksum });
      rowCount += res.rows.length;
    }

    const controls = await computeControls(tx);
    if (JSON.stringify(controls) !== JSON.stringify(expected.controls)) {
      throw new AppError(
        'BACKUP_RESTORE_VERIFICATION_FAILED',
        500,
        'Accounting controls differ after restore',
      );
    }

    return {
      tables: reportTables,
      rowCount,
      migrations: targetMigrations,
      controls,
    };
  });
}
