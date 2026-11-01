/**
 * Mission 34 — full backup, integrity verification and per-company export.
 *
 * Security model:
 *  * archives are encrypted with AES-256-GCM, key derived from an operator
 *    passphrase (BACKUP_ENCRYPTION_KEY) that is never stored;
 *  * archives live outside STORAGE_DIR, are written with mode 0600 and are
 *    never served as static files;
 *  * global backup and restore are restricted to an explicit e-mail allowlist;
 *  * every archive carries a manifest with a SHA-256 per database table and
 *    per file, plus accounting controls checked again after restore.
 */
import { mkdir, readFile, readdir, rename, rm, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Config } from '../config.js';
import { APP_VERSION } from '../config.js';
import type { Db } from '../db/index.js';
import { migrate } from '../db/index.js';
import { AppError, badRequest, forbidden, notFound } from '../lib/errors.js';
import { writeAudit } from '../lib/audit.js';
import { toCsv } from '../lib/http.js';
import { requireCompany } from '../lib/tenant.js';
import { effectiveAccess } from '../lib/permissions.js';
import type { CompanyRole } from '../types.js';
import {
  assertSafeArchivePath,
  canonicalJson,
  jsonEntry,
  packageZip,
  readJsonEntry,
  rowsChecksum,
  textEntry,
  unpackZip,
} from './archive.js';
import { assertPassphrase, decryptArchive, encryptArchive, sha256Hex } from './crypto.js';
import {
  assertEmptyTarget,
  dumpDatabase,
  EXCLUDED_TABLES,
  restoreDatabase,
  sameSchema,
  schemaMigrations,
  type BackupControls,
  type DatabaseSnapshot,
  type MigrationRef,
  type RestoreReport,
  type TableSnapshot,
} from './database.js';

export type BackupKind = 'global_backup' | 'company_export';
export type BackupStatus = 'running' | 'completed' | 'verified' | 'failed';

export interface BackupRunRow {
  id: string;
  kind: BackupKind;
  company_id: string | null;
  status: BackupStatus;
  actor_id: string | null;
  archive_name: string | null;
  archive_sha256: string | null;
  archive_bytes: string | null;
  schema_versions: MigrationRef[] | null;
  manifest: BackupManifest | null;
  error_code: string | null;
  error_message: string | null;
  started_at: string;
  completed_at: string | null;
  verified_at: string | null;
}

interface FileEntry {
  path: string;
  bytes: number;
  sha256: string;
  companyId: string | null;
}

interface TableManifest {
  name: string;
  rowCount: number;
  sha256: string;
}

export interface BackupManifest {
  format: 'comptai-backup';
  formatVersion: 1;
  id: string;
  kind: BackupKind;
  createdAt: string;
  appVersion: string;
  restoreSupported: boolean;
  scope: { companyId: string | null; companyName: string | null };
  schema: { migrations: MigrationRef[]; latestVersion: string | null };
  database: {
    engine: string;
    rowCount: number;
    tables: TableManifest[];
    excludedTables: string[];
  };
  files: FileEntry[];
  /** Additional portable entries (CSV, company, users) with their checksums. */
  extras?: { path: string; bytes: number; sha256: string }[];
  controls: BackupControls & { company?: CompanyExportControls };
  warnings: string[];
  encryption: { algorithm: 'aes-256-gcm'; kdf: 'scrypt'; keyLength: 32 };
}

export interface CompanyExportControls {
  companyId: string;
  tableCount: number;
  rowCount: number;
  userCount: number;
  payrollIncluded: boolean;
  journalDebit: string;
  journalCredit: string;
}

const ARCHIVE_EXT: Record<BackupKind, string> = {
  global_backup: 'mcbackup',
  company_export: 'mcexport',
};

export function backupAdminEmails(config: Config): string[] {
  return (config.BACKUP_ADMIN_EMAILS ?? '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

export function isBackupAdmin(config: Config, email: string | undefined): boolean {
  if (!email) return false;
  return backupAdminEmails(config).includes(email.toLowerCase());
}

export function exportReady(config: Config): { ready: boolean; reason: string | null } {
  if (!config.BACKUP_ENCRYPTION_KEY) {
    return { ready: false, reason: 'BACKUP_KEY_NOT_CONFIGURED' };
  }
  return { ready: true, reason: null };
}

export function backupReady(config: Config): { ready: boolean; reason: string | null } {
  const exportState = exportReady(config);
  if (!exportState.ready) return exportState;
  if (backupAdminEmails(config).length === 0) {
    return { ready: false, reason: 'BACKUP_ADMIN_NOT_CONFIGURED' };
  }
  return { ready: true, reason: null };
}

export function requireBackupAdmin(config: Config, email: string | undefined): void {
  // Authorisation comes first: an ordinary authenticated user must never learn
  // whether the backup subsystem is configured, and must always receive 403.
  if (!isBackupAdmin(config, email)) {
    throw forbidden('Only a designated backup administrator may perform this operation', 'BACKUP_FORBIDDEN');
  }
  const state = backupReady(config);
  if (!state.ready) {
    throw new AppError(
      'BACKUP_ADMIN_NOT_CONFIGURED',
      503,
      'Backup is not enabled on this server: configure BACKUP_ENCRYPTION_KEY and BACKUP_ADMIN_EMAILS',
    );
  }
}

function safeIdentifier(value: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(value)) {
    throw new AppError('BACKUP_ARCHIVE_INVALID', 400, `Unsafe identifier: ${value}`);
  }
  return `"${value}"`;
}

function stamp(date = new Date()): string {
  return date.toISOString().replace(/[:.]/g, '-');
}

function archiveFileName(kind: BackupKind, id: string): string {
  return `comptai-${kind === 'global_backup' ? 'backup' : 'company-export'}-${stamp()}-${id.slice(0, 8)}.${ARCHIVE_EXT[kind]}`;
}

function assertBackupDirOutsideStorage(config: Config): void {
  const storage = path.resolve(config.STORAGE_DIR);
  const backups = path.resolve(config.BACKUP_DIR);
  const relative = path.relative(storage, backups);
  if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) {
    throw new AppError(
      'BACKUP_FAILED',
      500,
      'BACKUP_DIR must be a directory outside STORAGE_DIR',
    );
  }
}

async function writeArchiveFile(
  config: Config,
  id: string,
  kind: BackupKind,
  entries: Record<string, Uint8Array>,
): Promise<{ name: string; fullPath: string; bytes: number; sha256: string }> {
  assertBackupDirOutsideStorage(config);
  const passphrase = assertPassphrase(config.BACKUP_ENCRYPTION_KEY);
  const uncompressedBytes = Object.values(entries).reduce((total, entry) => total + entry.byteLength, 0);
  if (uncompressedBytes > config.BACKUP_MAX_UNCOMPRESSED_BYTES) {
    throw new AppError('BACKUP_TOO_LARGE', 413, 'The backup payload exceeds the configured size limit');
  }
  const zip = packageZip(entries);
  const envelope = encryptArchive(zip, passphrase);
  if (envelope.byteLength > config.BACKUP_MAX_BYTES) {
    throw new AppError('BACKUP_TOO_LARGE', 413, 'The encrypted backup exceeds the configured size limit');
  }
  await mkdir(path.resolve(config.BACKUP_DIR), { recursive: true, mode: 0o700 });
  const name = archiveFileName(kind, id);
  const fullPath = path.join(path.resolve(config.BACKUP_DIR), name);
  const temp = `${fullPath}.tmp`;
  try {
    await writeFile(temp, envelope, { mode: 0o600 });
    await rename(temp, fullPath);
  } catch (error) {
    await unlink(temp).catch(() => undefined);
    throw error;
  }
  return { name, fullPath, bytes: envelope.byteLength, sha256: sha256Hex(envelope) };
}

function storageRoot(config: Config): string {
  return path.resolve(config.STORAGE_DIR);
}

function resolveStorageKey(config: Config, key: string): string {
  if (!key || key.includes('\0') || key.includes('\\') || path.isAbsolute(key)) {
    throw new AppError('BACKUP_FILE_PATH_INVALID', 409, 'A stored document path is invalid');
  }
  const root = storageRoot(config);
  const resolved = path.resolve(root, key);
  if (!resolved.startsWith(`${root}${path.sep}`)) {
    throw new AppError('BACKUP_FILE_PATH_INVALID', 409, 'A stored document escapes the storage directory');
  }
  return resolved;
}

async function collectFiles(
  db: Db,
  config: Config,
  companyId: string | null,
): Promise<{ files: FileEntry[]; payloads: Map<string, Uint8Array> }> {
  const scoped = companyId ? ' WHERE company_id = $1' : '';
  const params = companyId ? [companyId] : [];
  const refs = new Map<string, string | null>();

  const attachments = await db.query<{ company_id: string; stored_name: string }>(
    `SELECT company_id, stored_name FROM attachments${scoped} ORDER BY id`,
    params,
  );
  for (const row of attachments.rows) {
    refs.set(`${row.company_id}/${row.stored_name}`, row.company_id);
  }

  const documents = await db.query<{ company_id: string; storage_key: string | null }>(
    `SELECT company_id, storage_key FROM document_imports
      WHERE storage_key IS NOT NULL${companyId ? ' AND company_id = $1' : ''} ORDER BY id`,
    params,
  );
  for (const row of documents.rows) {
    if (row.storage_key) refs.set(row.storage_key, row.company_id);
  }

  const bankImports = await db.query<{ company_id: string; summary: Record<string, any> }>(
    `SELECT company_id, summary FROM bank_imports${scoped} ORDER BY id`,
    params,
  );
  for (const row of bankImports.rows) {
    const key = row.summary?.source?.storageKey;
    if (typeof key === 'string' && key.length > 0) refs.set(key, row.company_id);
  }

  const files: FileEntry[] = [];
  const payloads = new Map<string, Uint8Array>();
  for (const [key, owner] of [...refs.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    assertSafeArchivePath(key);
    if (companyId && owner && owner !== companyId) {
      throw new AppError(
        'BACKUP_CROSS_COMPANY_FILE',
        409,
        'A referenced document belongs to another company',
      );
    }
    const full = resolveStorageKey(config, key);
    let data: Buffer;
    try {
      data = await readFile(full);
    } catch {
      throw new AppError(
        'BACKUP_FILE_MISSING',
        409,
        `A referenced document is missing from storage: ${key}`,
      );
    }
    files.push({ path: key, bytes: data.byteLength, sha256: sha256Hex(data), companyId: owner });
    payloads.set(key, data);
  }
  return { files, payloads };
}

function manifestTables(snapshot: DatabaseSnapshot): TableManifest[] {
  return snapshot.tables.map((table) => ({
    name: table.name,
    rowCount: table.rowCount,
    sha256: table.sha256,
  }));
}

function baseManifest(
  id: string,
  kind: BackupKind,
  snapshot: DatabaseSnapshot,
  files: FileEntry[],
  scope: BackupManifest['scope'],
  controls: BackupManifest['controls'],
  warnings: string[],
): BackupManifest {
  return {
    format: 'comptai-backup',
    formatVersion: 1,
    id,
    kind,
    createdAt: new Date().toISOString(),
    appVersion: APP_VERSION,
    restoreSupported: kind === 'global_backup',
    scope,
    schema: {
      migrations: snapshot.migrations,
      latestVersion: snapshot.migrations.at(-1)?.version ?? null,
    },
    database: {
      engine: snapshot.engine,
      rowCount: snapshot.rowCount,
      tables: manifestTables(snapshot),
      excludedTables: snapshot.excludedTables,
    },
    files,
    controls,
    warnings,
    encryption: { algorithm: 'aes-256-gcm', kdf: 'scrypt', keyLength: 32 },
  };
}

async function createRun(
  db: Db,
  kind: BackupKind,
  actorId: string,
  companyId: string | null,
): Promise<BackupRunRow> {
  const res = await db.query<BackupRunRow>(
    `INSERT INTO backup_runs (kind, company_id, actor_id, status)
     VALUES ($1, $2, $3, 'running') RETURNING *`,
    [kind, companyId, actorId],
  );
  return res.rows[0]!;
}

async function completeRun(
  db: Db,
  id: string,
  archive: { name: string; bytes: number; sha256: string },
  manifest: BackupManifest,
): Promise<BackupRunRow> {
  const res = await db.query<BackupRunRow>(
    `UPDATE backup_runs
        SET status = 'completed', archive_name = $2, archive_sha256 = $3,
            archive_bytes = $4, schema_versions = $5::jsonb, manifest = $6::jsonb,
            completed_at = now(), error_code = NULL, error_message = NULL
      WHERE id = $1 RETURNING *`,
    [id, archive.name, archive.sha256, archive.bytes, JSON.stringify(manifest.schema.migrations), JSON.stringify(manifest)],
  );
  return res.rows[0]!;
}

async function failRun(db: Db, id: string, error: unknown): Promise<void> {
  const app = error instanceof AppError ? error : null;
  const code = app?.code ?? 'BACKUP_FAILED';
  // Never persist a stack trace or a raw filesystem path: only the stable code
  // and a short operator-facing message.
  const message = app?.message?.slice(0, 300) ?? 'Backup failed';
  await db.query(
    `UPDATE backup_runs
        SET status = 'failed', error_code = $2, error_message = $3, completed_at = now()
      WHERE id = $1`,
    [id, code, message],
  ).catch(() => undefined);
}

export async function createGlobalBackup(
  db: Db,
  config: Config,
  actor: { userId: string; email: string; ip?: string | null },
): Promise<{ backup: BackupRunRow; manifest: BackupManifest; durationMs: number }> {
  requireBackupAdmin(config, actor.email);
  const started = Date.now();
  const run = await createRun(db, 'global_backup', actor.userId, null);
  try {
    const snapshot = await dumpDatabase(db);
    const { files, payloads } = await collectFiles(db, config, null);
    const warnings = [
      'Sessions and login attempts are intentionally excluded.',
      'Restore is available only through the offline CLI into an empty database.',
    ];
    const manifest = baseManifest(run.id, 'global_backup', snapshot, files, { companyId: null, companyName: null }, snapshot.controls, warnings);
    const entries: Record<string, Uint8Array> = {
      'manifest.json': jsonEntry(manifest),
      'README.md': textEntry(BACKUP_README),
    };
    for (const table of snapshot.tables) {
      entries[`database/${table.name}.json`] = jsonEntry(table.rows);
    }
    for (const [key, data] of payloads) entries[`storage/${key}`] = data;
    const archive = await writeArchiveFile(config, run.id, 'global_backup', entries);
    const backup = await completeRun(db, run.id, archive, manifest);
    await writeAudit(db, {
      userId: actor.userId,
      action: 'backup.create',
      entityType: 'backup',
      entityId: run.id,
      details: {
        kind: 'global_backup', tables: snapshot.tables.length, rows: snapshot.rowCount,
        files: files.length, bytes: archive.bytes, sha256: archive.sha256,
      },
      ip: actor.ip ?? null,
    });
    return { backup, manifest, durationMs: Date.now() - started };
  } catch (error) {
    await failRun(db, run.id, error);
    await writeAudit(db, {
      userId: actor.userId,
      action: 'backup.failed',
      entityType: 'backup',
      entityId: run.id,
      details: { kind: 'global_backup', code: error instanceof AppError ? error.code : 'BACKUP_FAILED' },
      ip: actor.ip ?? null,
    }).catch(() => undefined);
    throw error;
  }
}

const BACKUP_README = `# COMPTAI backup archive

This archive is encrypted with AES-256-GCM. The passphrase is not stored in the
archive. Once decrypted, it contains:

- manifest.json: format version, schema migrations, SHA-256 per table and file;
- database/<table>.json: one JSON array per PostgreSQL table;
- storage/<path>: the original attachments and imported documents.

Restore only with the COMPTAI offline CLI, into an empty database whose
migration history exactly matches the manifest. Never restore over a live
database. Company exports (kind company_export) are portable data extracts and
are not a restorable backup.
`;

export async function createCompanyExport(
  db: Db,
  config: Config,
  actor: { userId: string; email: string; ip?: string | null },
  companyId: string,
): Promise<{ backup: BackupRunRow; manifest: BackupManifest; durationMs: number }> {
  if (!exportReady(config).ready) {
    throw new AppError(
      'BACKUP_KEY_NOT_CONFIGURED',
      503,
      'Company export is not enabled on this server: configure BACKUP_ENCRYPTION_KEY',
    );
  }
  const access = await requireCompany(db, actor.userId, companyId, 'admin');
  // Payroll is a separate module: a company administrator without payroll
  // access must not exfiltrate payroll through a "full export".
  const payroll = await effectiveAccess(db, companyId, actor.userId, access.role as CompanyRole, 'payroll');
  if (payroll !== 'admin') {
    throw forbidden('A full company export requires payroll administration access', 'BACKUP_PAYROLL_FORBIDDEN');
  }
  const started = Date.now();
  const run = await createRun(db, 'company_export', actor.userId, companyId);
  try {
    // One REPEATABLE READ transaction keeps every exported table, the CSV
    // extracts and the file references on the same logical snapshot.
    const snapshot = await db.transaction(async (tx) => {
      await tx.exec('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const company = (await tx.query<{ id: string; name: string }>(
        'SELECT id, name FROM companies WHERE id = $1',
        [companyId],
      )).rows[0];
      if (!company) throw notFound('COMPANY_NOT_FOUND', 'Company not found');

      const tables = await companyScopedTables(tx);
      const tableRows: TableSnapshot[] = [];
      let rowCount = 0;
      for (const name of tables) {
        const res = await tx.query<Record<string, unknown>>(
          `SELECT * FROM ${safeIdentifier(name)} WHERE company_id = $1`,
          [companyId],
        );
        const rows = res.rows;
        tableRows.push({ name, rows, rowCount: rows.length, sha256: rowsChecksum(rows) });
        rowCount += rows.length;
      }
      for (const extra of COMPANY_CHILD_TABLES) {
        const exists = await tx.query<{ exists: boolean }>(
          `SELECT EXISTS (SELECT 1 FROM information_schema.tables
            WHERE table_schema='public' AND table_name=$1) AS exists`,
          [extra.name],
        );
        if (!exists.rows[0]?.exists) continue;
        const res = await tx.query<Record<string, unknown>>(
          `SELECT * FROM ${safeIdentifier(extra.name)} WHERE ${extra.predicate}`,
          [companyId],
        );
        tableRows.push({
          name: extra.name,
          rows: res.rows,
          rowCount: res.rows.length,
          sha256: rowsChecksum(res.rows),
        });
        rowCount += res.rows.length;
      }
      const { files, payloads } = await collectFiles(tx, config, companyId);
      const users = await tx.query<Record<string, unknown>>(
        `SELECT u.id, u.email, u.full_name, u.locale, u.is_active, m.role, m.created_at
           FROM company_members m JOIN app_users u ON u.id = m.user_id
          WHERE m.company_id = $1 ORDER BY u.email`,
        [companyId],
      );
      const totals = await journalTotals(tx, companyId);
      const lineCount = await tx.query<{ lines: string; posted: string }>(
        `SELECT count(*)::text AS lines,
                count(*) FILTER (WHERE e.status = 'posted')::text AS posted
           FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
          WHERE l.company_id = $1`,
        [companyId],
      );
      const attachments = await tx.query<{ count: string; bytes: string | null }>(
        `SELECT count(*)::text AS count, COALESCE(SUM(size_bytes), 0)::text AS bytes
           FROM attachments WHERE company_id = $1`,
        [companyId],
      );
      const csvs = await exportCsvs(tx, companyId);
      return { company, tables, tableRows, rowCount, files, payloads, users, totals, lineCount, attachments, csvs };
    });
    const {
      company, tables, tableRows, rowCount, files, payloads, users, totals, lineCount, attachments, csvs,
    } = snapshot;
    const databaseSnapshot: DatabaseSnapshot = {
      engine: db.kind,
      migrations: await schemaMigrations(db),
      tables: tableRows,
      rowCount,
      controls: {
        companies: 1, users: 0, postedEntries: 0, journalLines: 0,
        debitTotal: '0', creditTotal: '0', perCompany: [], attachments: { count: 0, bytes: 0 },
      },
      excludedTables: [...EXCLUDED_TABLES],
    };
    const controls: BackupManifest['controls'] = {
      companies: 1,
      users: users.rows.length,
      postedEntries: Number(lineCount.rows[0]?.posted ?? 0),
      journalLines: Number(lineCount.rows[0]?.lines ?? 0),
      debitTotal: totals.debit,
      creditTotal: totals.credit,
      perCompany: [{ companyId, debit: totals.debit, credit: totals.credit, lines: Number(lineCount.rows[0]?.lines ?? 0) }],
      attachments: {
        count: Number(attachments.rows[0]?.count ?? 0),
        bytes: Number(attachments.rows[0]?.bytes ?? 0),
      },
      company: {
        companyId,
        tableCount: tableRows.length,
        rowCount,
        userCount: users.rows.length,
        payrollIncluded: tables.some((name) => name.startsWith('payroll_')),
        journalDebit: totals.debit,
        journalCredit: totals.credit,
      } satisfies CompanyExportControls,
    };
    const manifest = baseManifest(
      run.id,
      'company_export',
      databaseSnapshot,
      files,
      { companyId, companyName: company.name },
      controls,
      [
        'Portable data export only: it is not a restorable backup and cannot be re-imported automatically.',
        'Password hashes and sessions are never exported; member accounts are listed with their role only.',
        'Payroll data is included because the exporter holds payroll administration access.',
      ],
    );
    const entries: Record<string, Uint8Array> = {
      'README.md': textEntry(COMPANY_EXPORT_README),
      'data/company.json': jsonEntry(company),
      'data/users.json': jsonEntry(users.rows),
    };
    for (const table of tableRows) entries[`data/${table.name}.json`] = jsonEntry(table.rows);
    for (const [name, rows] of Object.entries(csvs)) {
      entries[`csv/${name}`] = textEntry(rows);
    }
    for (const [key, data] of payloads) entries[`storage/${key}`] = data;
    manifest.extras = Object.entries(entries).map(([name, data]) => ({
      path: name,
      bytes: data.byteLength,
      sha256: sha256Hex(data),
    }));
    entries['manifest.json'] = jsonEntry(manifest);
    const archive = await writeArchiveFile(config, run.id, 'company_export', entries);
    const backup = await completeRun(db, run.id, archive, manifest);
    await writeAudit(db, {
      companyId,
      userId: actor.userId,
      action: 'company.export',
      entityType: 'company',
      entityId: companyId,
      details: { exportId: run.id, tables: tableRows.length, rows: rowCount, files: files.length },
      ip: actor.ip ?? null,
    });
    return { backup, manifest, durationMs: Date.now() - started };
  } catch (error) {
    await failRun(db, run.id, error);
    await writeAudit(db, {
      companyId,
      userId: actor.userId,
      action: 'company.export.failed',
      entityType: 'company',
      entityId: companyId,
      details: { kind: 'company_export', code: error instanceof AppError ? error.code : 'BACKUP_FAILED' },
      ip: actor.ip ?? null,
    }).catch(() => undefined);
    throw error;
  }
}

const COMPANY_CHILD_TABLES: { name: string; predicate: string }[] = [
  {
    name: 'ai_entry_proposal_lines',
    predicate: 'proposal_id IN (SELECT id FROM ai_entry_proposals WHERE company_id = $1)',
  },
  {
    name: 'ai_messages',
    predicate: 'conversation_id IN (SELECT id FROM ai_conversations WHERE company_id = $1)',
  },
  {
    name: 'migration_uploads',
    predicate: 'job_id IN (SELECT id FROM migration_jobs WHERE company_id = $1)',
  },
  {
    name: 'payroll_calculation_lines',
    predicate: 'calculation_id IN (SELECT id FROM payroll_calculations WHERE company_id = $1)',
  },
];

async function companyScopedTables(db: Db): Promise<string[]> {
  const res = await db.query<{ table_name: string }>(
    `SELECT c.table_name FROM information_schema.columns c
       JOIN information_schema.tables t
         ON t.table_schema = c.table_schema AND t.table_name = c.table_name
      WHERE c.table_schema = 'public' AND c.column_name = 'company_id'
        AND t.table_type = 'BASE TABLE'
      ORDER BY c.table_name`,
  );
  const excluded = new Set<string>(EXCLUDED_TABLES);
  return res.rows.map((row) => row.table_name).filter((name) => !excluded.has(name));
}

async function journalTotals(db: Db, companyId: string): Promise<{ debit: string; credit: string }> {
  const res = await db.query<{ debit: string | null; credit: string | null }>(
    `SELECT SUM(debit)::text AS debit, SUM(credit)::text AS credit
       FROM journal_lines WHERE company_id = $1`,
    [companyId],
  );
  return { debit: res.rows[0]?.debit ?? '0', credit: res.rows[0]?.credit ?? '0' };
}

async function exportCsvs(db: Db, companyId: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const selected = [
    ['accounts', 'accounts', ['code', 'name', 'type', 'currency', 'is_active']],
    ['journals', 'journals', ['code', 'name', 'type', 'is_active']],
    ['journal_entries', 'journal_entries',
      ['entry_no', 'entry_date', 'journal_id', 'reference', 'description', 'currency', 'status']],
    ['journal_lines', 'journal_lines',
      ['entry_id', 'line_no', 'account_id', 'description', 'debit', 'credit', 'txn_currency']],
    ['billing_documents', 'billing_documents',
      ['doc_no', 'kind', 'status', 'issue_date', 'currency', 'total_amount']],
    ['billing_payments', 'billing_payments', ['payment_no', 'payment_date', 'currency', 'amount']],
    ['purchase_documents', 'purchase_documents',
      ['doc_no', 'status', 'issue_date', 'currency', 'total_amount']],
    ['fixed_assets', 'fixed_assets',
      ['asset_code', 'description', 'acquisition_date', 'cost', 'status']],
    ['inventory_items', 'inventory_items', ['sku', 'name', 'unit', 'is_active']],
    ['payroll_employees', 'payroll_employees', ['employee_ref', 'full_name', 'status']],
  ] as const;
  for (const [file, table, columns] of selected) {
    const exists = await db.query<{ exists: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM information_schema.tables
        WHERE table_schema='public' AND table_name=$1) AS exists`,
      [table],
    );
    if (!exists.rows[0]?.exists) continue;
    const res = await db.query<Record<string, unknown>>(
      `SELECT ${columns.map(safeIdentifier).join(', ')} FROM ${safeIdentifier(table)}
        WHERE company_id = $1`,
      [companyId],
    );
    const rows: (string | number | null)[][] = [columns.slice()];
    for (const row of res.rows) {
      rows.push(columns.map((column) => {
        const value = row[column];
        if (value === null || value === undefined) return null;
        if (typeof value === 'object') return JSON.stringify(value);
        return String(value);
      }));
    }
    out[`${file}.csv`] = toCsv(rows);
  }

  const trial = await db.query<{
    code: string; name: string; debit: string; credit: string; balance: string;
  }>(
    `SELECT a.code, a.name,
            COALESCE(SUM(l.debit), 0)::text AS debit,
            COALESCE(SUM(l.credit), 0)::text AS credit,
            COALESCE(SUM(l.debit - l.credit), 0)::text AS balance
       FROM accounts a
       LEFT JOIN journal_lines l ON l.account_id = a.id
        AND EXISTS (SELECT 1 FROM journal_entries e WHERE e.id = l.entry_id AND e.status = 'posted')
      WHERE a.company_id = $1
      GROUP BY a.id, a.code, a.name ORDER BY a.code`,
    [companyId],
  );
  out['trial_balance.csv'] = toCsv([
    ['code', 'name', 'debit', 'credit', 'balance'],
    ...trial.rows.map((row) => [row.code, row.name, row.debit, row.credit, row.balance]),
  ]);

  const ledger = await db.query<Record<string, unknown>>(
    `SELECT e.entry_date, e.entry_no, a.code, a.name, l.description, l.debit, l.credit
       FROM journal_lines l
       JOIN journal_entries e ON e.id = l.entry_id
       JOIN accounts a ON a.id = l.account_id
      WHERE l.company_id = $1 AND e.status = 'posted'
      ORDER BY e.entry_date, e.entry_no, l.line_no`,
    [companyId],
  );
  out['general_ledger.csv'] = toCsv([
    ['entry_date', 'entry_no', 'account_code', 'account_name', 'description', 'debit', 'credit'],
    ...ledger.rows.map((row) => [
      row.entry_date, row.entry_no, row.code, row.name, row.description,
      row.debit, row.credit,
    ] as (string | null)[]),
  ]);
  return out;
}

const COMPANY_EXPORT_README = `# COMPTAI company export

This is a portable, encrypted data extract for one company. Once decrypted it
contains JSON arrays in data/, CSV extracts in csv/ (accounts, journals, entry
lines, trial balance, general ledger, billing, purchases, assets, inventory,
payroll), the original files in storage/, and a manifest with SHA-256 hashes.

It is NOT a restorable backup and there is no automatic import into another
company in COMPTAI 0.1.1. Password hashes and sessions are excluded. Validate
the data with an accountant before importing it anywhere else.
`;

interface OpenedArchive {
  manifest: BackupManifest;
  files: Map<string, Uint8Array>;
  snapshot: DatabaseSnapshot | null;
  totalBytes: number;
}

function assertManifest(value: BackupManifest): BackupManifest {
  if (!value || value.format !== 'comptai-backup' || value.formatVersion !== 1) {
    throw new AppError('BACKUP_MANIFEST_INVALID', 400, 'Unsupported backup manifest');
  }
  if (!['global_backup', 'company_export'].includes(value.kind)) {
    throw new AppError('BACKUP_MANIFEST_INVALID', 400, 'Unsupported backup kind');
  }
  if (!Array.isArray(value.database?.tables) || !Array.isArray(value.files)) {
    throw new AppError('BACKUP_MANIFEST_INVALID', 400, 'Incomplete backup manifest');
  }
  if (typeof value.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(value.id)
    || typeof value.createdAt !== 'string' || Number.isNaN(Date.parse(value.createdAt))
    || typeof value.appVersion !== 'string'
    || typeof value.restoreSupported !== 'boolean'
    || !value.scope || typeof value.scope !== 'object'
    || !value.schema || !Array.isArray(value.schema.migrations)
    || !value.controls || typeof value.controls !== 'object') {
    throw new AppError('BACKUP_MANIFEST_INVALID', 400, 'Invalid backup manifest header');
  }
  for (const migration of value.schema.migrations) {
    if (!migration || typeof migration.version !== 'string' || typeof migration.checksum !== 'string') {
      throw new AppError('BACKUP_MANIFEST_INVALID', 400, 'Invalid migration entry in the manifest');
    }
  }
  if (value.kind === 'company_export' && value.restoreSupported) {
    throw new AppError('BACKUP_MANIFEST_INVALID', 400, 'A company export cannot claim to be restorable');
  }
  const seen = new Set<string>();
  for (const table of value.database.tables) {
    if (!table || typeof table.name !== 'string' || !/^[a-z_][a-z0-9_]*$/.test(table.name)
      || !Number.isInteger(table.rowCount) || table.rowCount < 0
      || typeof table.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(table.sha256)) {
      throw new AppError('BACKUP_MANIFEST_INVALID', 400, 'Invalid table entry in the manifest');
    }
    if (seen.has(table.name)) {
      throw new AppError('BACKUP_MANIFEST_INVALID', 400, `Duplicate table in the manifest: ${table.name}`);
    }
    seen.add(table.name);
  }
  for (const file of value.files) {
    if (!file || typeof file.path !== 'string' || !Number.isInteger(file.bytes) || file.bytes < 0
      || typeof file.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(file.sha256)) {
      throw new AppError('BACKUP_MANIFEST_INVALID', 400, 'Invalid file entry in the manifest');
    }
    assertSafeArchivePath(file.path);
  }
  if (value.extras) {
    if (!Array.isArray(value.extras)) {
      throw new AppError('BACKUP_MANIFEST_INVALID', 400, 'Invalid extra entries in the manifest');
    }
    for (const extra of value.extras) {
      if (!extra || typeof extra.path !== 'string' || !Number.isInteger(extra.bytes)
        || typeof extra.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(extra.sha256)) {
        throw new AppError('BACKUP_MANIFEST_INVALID', 400, 'Invalid extra entry in the manifest');
      }
      assertSafeArchivePath(extra.path);
    }
  }
  return value;
}

async function openArchive(config: Config, envelope: Buffer): Promise<OpenedArchive> {
  const passphrase = assertPassphrase(config.BACKUP_ENCRYPTION_KEY);
  const unpacked = unpackZip(decryptArchive(envelope, passphrase), config.BACKUP_MAX_UNCOMPRESSED_BYTES);
  const manifest = assertManifest(readJsonEntry<BackupManifest>(unpacked.files, 'manifest.json'));
  if (!/^[0-9a-f-]{36}$/i.test(manifest.id)) {
    throw new AppError('BACKUP_MANIFEST_INVALID', 400, 'Invalid backup identifier');
  }

  let totalRows = 0;
  const tables: TableSnapshot[] = [];
  const tablePrefix = manifest.kind === 'company_export' ? 'data' : 'database';
  for (const table of manifest.database.tables) {
    assertSafeArchivePath(`${tablePrefix}/${table.name}.json`);
    const rows = readJsonEntry<Record<string, unknown>[]>(unpacked.files, `${tablePrefix}/${table.name}.json`);
    if (!Array.isArray(rows) || rows.length !== table.rowCount) {
      throw new AppError('BACKUP_INTEGRITY_FAILED', 400, `Row count mismatch for table ${table.name}`);
    }
    const checksum = rowsChecksum(rows);
    if (checksum !== table.sha256) {
      throw new AppError('BACKUP_INTEGRITY_FAILED', 400, `Checksum mismatch for table ${table.name}`);
    }
    tables.push({ name: table.name, rows, rowCount: rows.length, sha256: checksum });
    totalRows += rows.length;
  }

  for (const file of manifest.files) {
    assertSafeArchivePath(file.path);
    const payload = unpacked.files.get(`storage/${file.path}`);
    if (!payload) {
      throw new AppError('BACKUP_INTEGRITY_FAILED', 400, `Missing file in archive: ${file.path}`);
    }
    if (payload.byteLength !== file.bytes || sha256Hex(payload) !== file.sha256) {
      throw new AppError('BACKUP_INTEGRITY_FAILED', 400, `Checksum mismatch for file ${file.path}`);
    }
  }

  if (manifest.extras) {
    for (const extra of manifest.extras) {
      const payload = unpacked.files.get(extra.path);
      if (!payload) {
        throw new AppError('BACKUP_INTEGRITY_FAILED', 400, `Missing archive entry: ${extra.path}`);
      }
      if (payload.byteLength !== extra.bytes || sha256Hex(payload) !== extra.sha256) {
        throw new AppError('BACKUP_INTEGRITY_FAILED', 400, `Checksum mismatch for ${extra.path}`);
      }
    }
  }

  return {
    manifest,
    files: unpacked.files,
    snapshot: {
      engine: manifest.database.engine as Db['kind'],
      migrations: manifest.schema.migrations,
      tables,
      rowCount: totalRows,
      controls: manifest.controls,
      excludedTables: manifest.database.excludedTables,
    },
    totalBytes: unpacked.totalBytes,
  };
}

/** Opens and fully verifies an archive file (manifest, table and file checksums). */
export async function verifyArchiveFile(
  config: Config,
  archivePath: string,
): Promise<{ manifest: BackupManifest; totalBytes: number; envelope: Buffer }> {
  let envelope: Buffer;
  try {
    envelope = await readFile(archivePath);
  } catch {
    throw notFound('BACKUP_FILE_MISSING', 'Backup archive not found on disk');
  }
  const opened = await openArchive(config, envelope);
  return { manifest: opened.manifest, totalBytes: opened.totalBytes, envelope };
}

function archivePath(config: Config, row: BackupRunRow): string {
  if (!row.archive_name) throw notFound('BACKUP_NOT_FOUND', 'Backup archive not found');
  const full = path.join(path.resolve(config.BACKUP_DIR), path.basename(row.archive_name));
  return full;
}

export async function getBackupRun(db: Db, id: string): Promise<BackupRunRow> {
  const res = await db.query<BackupRunRow>('SELECT * FROM backup_runs WHERE id = $1', [id]);
  const row = res.rows[0];
  if (!row) throw notFound('BACKUP_NOT_FOUND', 'Backup not found');
  return row;
}

export async function listBackupRuns(
  db: Db,
  options: { kind?: BackupKind; companyId?: string; limit?: number } = {},
): Promise<BackupRunRow[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (options.kind) {
    params.push(options.kind);
    where.push(`kind = $${params.length}`);
  }
  if (options.companyId) {
    params.push(options.companyId);
    where.push(`company_id = $${params.length}`);
  }
  params.push(Math.min(Math.max(options.limit ?? 50, 1), 200));
  const res = await db.query<BackupRunRow>(
    `SELECT * FROM backup_runs ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY started_at DESC, id DESC LIMIT $${params.length}`,
    params,
  );
  return res.rows;
}

export async function verifyStoredBackup(
  db: Db,
  config: Config,
  id: string,
  actor: { userId: string; email: string; ip?: string | null },
): Promise<{ valid: true; manifest: BackupManifest; schemaCompatible: boolean; totalBytes: number }> {
  requireBackupAdmin(config, actor.email);
  const row = await getBackupRun(db, id);
  if (!['completed', 'verified'].includes(row.status)) {
    throw new AppError('BACKUP_NOT_VERIFIED', 409, 'Only a completed backup can be verified');
  }
  let envelope: Buffer;
  try {
    envelope = await readFile(archivePath(config, row));
  } catch {
    throw notFound('BACKUP_NOT_FOUND', 'Backup archive is missing from disk');
  }
  if (row.archive_sha256 && sha256Hex(envelope) !== row.archive_sha256) {
    throw new AppError('BACKUP_INTEGRITY_FAILED', 409, 'The archive hash does not match the audit record');
  }
  const opened = await openArchive(config, envelope);
  if (opened.manifest.id !== row.id) {
    throw new AppError('BACKUP_INTEGRITY_FAILED', 409, 'The manifest identifier does not match the backup record');
  }
  const local = await schemaMigrations(db);
  const schemaCompatible = opened.manifest.kind === 'global_backup'
    ? sameSchema(opened.manifest.schema.migrations, local)
    : false;
  await db.query(
    `UPDATE backup_runs SET status = 'verified', verified_at = now() WHERE id = $1`,
    [row.id],
  );
  await writeAudit(db, {
    userId: actor.userId,
    action: 'backup.verify',
    entityType: 'backup',
    entityId: row.id,
    details: { valid: true, schemaCompatible, bytes: envelope.byteLength },
    ip: actor.ip ?? null,
  });
  return { valid: true, manifest: opened.manifest, schemaCompatible, totalBytes: opened.totalBytes };
}

/** Verifies a company export without granting the global backup allowlist. */
export async function verifyCompanyExport(
  db: Db,
  config: Config,
  exportId: string,
  companyId: string,
  actor: { userId: string; ip?: string | null },
): Promise<{ valid: true; manifest: BackupManifest; totalBytes: number }> {
  const row = await getBackupRun(db, exportId);
  if (row.kind !== 'company_export' || row.company_id !== companyId) {
    throw notFound('BACKUP_NOT_FOUND', 'Company export not found');
  }
  if (row.status !== 'completed' && row.status !== 'verified') {
    throw new AppError('BACKUP_NOT_VERIFIED', 409, 'Only a completed export can be verified');
  }
  let envelope: Buffer;
  try {
    envelope = await readFile(archivePath(config, row));
  } catch {
    throw notFound('BACKUP_NOT_FOUND', 'Company export archive is missing from disk');
  }
  if (row.archive_sha256 && sha256Hex(envelope) !== row.archive_sha256) {
    throw new AppError('BACKUP_INTEGRITY_FAILED', 409, 'The archive hash does not match the audit record');
  }
  const opened = await openArchive(config, envelope);
  if (opened.manifest.id !== row.id || opened.manifest.kind !== 'company_export') {
    throw new AppError('BACKUP_INTEGRITY_FAILED', 409, 'The manifest does not match the export record');
  }
  await db.query(`UPDATE backup_runs SET status = 'verified', verified_at = now() WHERE id = $1`, [row.id]);
  await writeAudit(db, {
    companyId,
    userId: actor.userId,
    action: 'company.export.verify',
    entityType: 'company',
    entityId: companyId,
    details: { exportId, bytes: envelope.byteLength, files: opened.manifest.files.length },
    ip: actor.ip ?? null,
  });
  return { valid: true, manifest: opened.manifest, totalBytes: opened.totalBytes };
}

export interface RestoreOptions {
  targetDb: Db;
  config: Config;
  archivePath: string;
  storageDir: string;
  confirmationId: string;
  allowProduction: boolean;
}

export async function restoreBackup(options: RestoreOptions): Promise<RestoreReport & { manifest: BackupManifest }> {
  const { config, targetDb, storageDir } = options;
  if (config.NODE_ENV === 'production' && !options.allowProduction) {
    throw new AppError('BACKUP_RESTORE_BLOCKED', 403, 'Restore is blocked in production');
  }
  let envelope: Buffer;
  try {
    envelope = await readFile(options.archivePath);
  } catch {
    throw notFound('BACKUP_NOT_FOUND', 'Backup archive not found');
  }
  if (envelope.byteLength > config.BACKUP_MAX_BYTES) {
    throw new AppError('BACKUP_TOO_LARGE', 413, 'The archive exceeds the configured size limit');
  }
  const opened = await openArchive(config, envelope);
  if (opened.manifest.kind !== 'global_backup' || !opened.manifest.restoreSupported) {
    throw new AppError('BACKUP_NOT_RESTORABLE', 409, 'A company export is not a restorable backup');
  }
  if (options.confirmationId !== opened.manifest.id) {
    throw badRequest('BACKUP_CONFIRMATION_REQUIRED', 'Restore confirmation must equal the backup identifier');
  }

  await assertEmptyTarget(targetDb);
  await migrate(targetDb);
  const local = await schemaMigrations(targetDb);
  if (!sameSchema(local, opened.manifest.schema.migrations)) {
    throw new AppError('BACKUP_SCHEMA_MISMATCH', 409, 'The archive migration history does not match the target');
  }

  const destination = path.resolve(storageDir);
  const existing = await stat(destination).catch(() => null);
  if (existing && (!existing.isDirectory() || (await readdir(destination)).length > 0)) {
    throw new AppError('BACKUP_STORAGE_NOT_EMPTY', 409, 'Restore refused: the target storage directory is not empty');
  }
  const tempStorage = `${destination}.restore-${opened.manifest.id.slice(0, 8)}-${Date.now()}`;
  await mkdir(tempStorage, { recursive: true, mode: 0o700 });
  try {
    for (const file of opened.manifest.files) {
      const payload = opened.files.get(`storage/${file.path}`);
      if (!payload) throw new AppError('BACKUP_INTEGRITY_FAILED', 400, `Missing file ${file.path}`);
      const target = path.resolve(tempStorage, file.path);
      if (!target.startsWith(`${tempStorage}${path.sep}`)) {
        throw new AppError('BACKUP_FILE_PATH_INVALID', 409, 'A file would be extracted outside the storage directory');
      }
      await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
      await writeFile(target, payload, { mode: 0o600, flag: 'wx' });
    }

    // Files go into place first: if the database transaction then fails, it
    // rolls back and the destination is removed, so a committed database can
    // never reference files that were not restored.
    if (existing) {
      await rm(destination, { recursive: true, force: true });
    }
    await rename(tempStorage, destination);
    let report: RestoreReport;
    try {
      report = await restoreDatabase(targetDb, opened.snapshot!, {
        migrations: opened.manifest.schema.migrations,
        controls: opened.manifest.controls,
        tables: opened.snapshot!.tables,
      });
    } catch (error) {
      await rm(destination, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }
    return { ...report, manifest: opened.manifest };
  } catch (error) {
    await rm(tempStorage, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

export async function downloadBackup(
  db: Db,
  config: Config,
  id: string,
): Promise<{ row: BackupRunRow; path: string }> {
  const row = await getBackupRun(db, id);
  if (row.status !== 'completed' && row.status !== 'verified') {
    throw new AppError('BACKUP_NOT_AVAILABLE', 409, 'This backup has no downloadable archive');
  }
  const full = archivePath(config, row);
  const info = await stat(full).catch(() => null);
  if (!info?.isFile()) throw notFound('BACKUP_NOT_FOUND', 'Backup archive is missing from disk');
  return { row, path: full };
}

/** Exposed for the CLI: no HTTP route ever calls a destructive restore. */
export async function assertRestoreAllowed(config: Config, allowProduction: boolean): Promise<void> {
  if (!config.BACKUP_RESTORE_ENABLED) {
    throw new AppError(
      'BACKUP_RESTORE_BLOCKED',
      403,
      'Restore is disabled: set BACKUP_RESTORE_ENABLED=true for an isolated restore',
    );
  }
  if (config.NODE_ENV === 'production' && !allowProduction) {
    throw new AppError('BACKUP_RESTORE_BLOCKED', 403, 'Restore is blocked in production');
  }
  assertPassphrase(config.BACKUP_ENCRYPTION_KEY);
}
