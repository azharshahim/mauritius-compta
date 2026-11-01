#!/usr/bin/env node
/**
 * Mission 34 — offline backup / restore operator CLI.
 *
 * Restore is never exposed through HTTP. It requires:
 *   BACKUP_RESTORE_ENABLED=true
 *   a target database URL different from the source DATABASE_URL
 *   an empty target database and an empty target storage directory
 *   --confirm <backup-id> matching the manifest
 *
 * Usage (from apps/api):
 *   npm run backup -- create-global --actor-email admin@example.test
 *   npm run backup -- export-company --company <uuid> --actor-email admin@example.test
 *   npm run backup -- verify ./backups/xxx.mcbackup
 *   npm run backup -- restore ./backups/xxx.mcbackup \
 *       --target postgresql://.../empty_restore_test --storage /tmp/restore-storage \
 *       --confirm <backup-id>
 */
import path from 'node:path';
import { createPgDb, type Db } from '../db/index.js';
import { migrate } from '../db/index.js';
import { loadConfig } from '../config.js';
import { AppError } from '../lib/errors.js';
import { readFile } from 'node:fs/promises';
import {
  assertRestoreAllowed,
  createCompanyExport,
  createGlobalBackup,
  restoreBackup,
} from './service.js';
import { sha256Hex } from './crypto.js';
import { verifyArchiveFile, type BackupManifest } from './service.js';

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function required(name: string): string {
  const value = arg(name);
  if (!value) throw new Error(`Missing --${name}`);
  return value;
}

/** Archive is accepted positionally (`verify ./backup`) or as `--archive`. */
function archiveArgument(): string {
  const flag = arg('archive');
  if (flag) return flag;
  const positional = process.argv[3];
  if (positional && !positional.startsWith('--')) return positional;
  throw new Error('Missing archive path');
}

async function withDb<T>(url: string, fn: (db: Awaited<ReturnType<typeof createPgDb>>) => Promise<T>): Promise<T> {
  const db = await createPgDb(url, { ssl: process.env.DATABASE_SSL === 'true' });
  try {
    await migrate(db);
    return await fn(db);
  } finally {
    await db.close();
  }
}

async function actorId(db: Db, email: string): Promise<{ id: string; email: string }> {
  const res = await db.query<{ id: string; email: string }>(
    'SELECT id, email FROM app_users WHERE lower(email) = lower($1)',
    [email],
  );
  if (!res.rows[0]) throw new Error(`Unknown user: ${email}`);
  return res.rows[0];
}

async function inspectArchive(config: ReturnType<typeof loadConfig>, archivePath: string): Promise<BackupManifest> {
  return (await verifyArchiveFile(config, archivePath)).manifest;
}

async function main() {
  const command = process.argv[2];
  const config = loadConfig();
  if (!config.DATABASE_URL && command !== 'verify' && command !== 'restore') {
    throw new Error('DATABASE_URL is required for this command');
  }

  if (command === 'create-global') {
    const email = required('actor-email');
    await withDb(config.DATABASE_URL!, async (db) => {
      const actor = await actorId(db, email);
      const result = await createGlobalBackup(db, config, { userId: actor.id, email: actor.email });
      console.log(JSON.stringify({
        backupId: result.backup.id,
        archive: result.backup.archive_name,
        bytes: Number(result.backup.archive_bytes),
        sha256: result.backup.archive_sha256,
        tables: result.manifest.database.tables.length,
        rows: result.manifest.database.rowCount,
        files: result.manifest.files.length,
        durationMs: result.durationMs,
      }, null, 2));
    });
    return;
  }

  if (command === 'export-company') {
    const companyId = required('company');
    const email = required('actor-email');
    await withDb(config.DATABASE_URL!, async (db) => {
      const actor = await actorId(db, email);
      const result = await createCompanyExport(db, config, { userId: actor.id, email: actor.email }, companyId);
      console.log(JSON.stringify({
        exportId: result.backup.id,
        archive: result.backup.archive_name,
        bytes: Number(result.backup.archive_bytes),
        sha256: result.backup.archive_sha256,
        tables: result.manifest.database.tables.length,
        rows: result.manifest.database.rowCount,
        files: result.manifest.files.length,
        restoreSupported: false,
        durationMs: result.durationMs,
      }, null, 2));
    });
    return;
  }

  if (command === 'verify') {
    const archivePath = archiveArgument();
    const verified = await verifyArchiveFile(config, archivePath);
    const manifest = verified.manifest;
    console.log(JSON.stringify({
      valid: true,
      backupId: manifest.id,
      kind: manifest.kind,
      createdAt: manifest.createdAt,
      tables: manifest.database.tables.length,
      rows: manifest.database.rowCount,
      files: manifest.files.length,
      uncompressedBytes: verified.totalBytes,
      archiveSha256: sha256Hex(verified.envelope),
    }, null, 2));
    return;
  }

  if (command === 'restore') {
    const archivePath = path.resolve(archiveArgument());
    const targetUrl = required('target');
    const storageDir = required('storage');
    const confirmation = required('confirm');
    const allowProduction = process.argv.includes('--allow-production');
    if (config.DATABASE_URL && targetUrl === config.DATABASE_URL) {
      throw new AppError('BACKUP_RESTORE_BLOCKED', 403, 'Refusing to restore over the source database');
    }
    await assertRestoreAllowed(config, allowProduction);
    const manifest = await inspectArchive(config, archivePath);
    if (manifest.id !== confirmation) {
      throw new AppError('BACKUP_CONFIRMATION_REQUIRED', 400, '--confirm must equal the backup identifier');
    }
    if (!manifest.restoreSupported) {
      throw new AppError('BACKUP_NOT_RESTORABLE', 409, 'A company export cannot be restored');
    }
    const target = await createPgDb(targetUrl, { ssl: process.env.DATABASE_SSL === 'true' });
    try {
      const result = await restoreBackup({
        targetDb: target,
        config,
        archivePath,
        storageDir,
        confirmationId: confirmation,
        allowProduction,
      });
      await target.query(
        `INSERT INTO audit_log (company_id, user_id, action, entity_type, entity_id, details, ip)
         VALUES (NULL, NULL, 'backup.restore', 'backup', $1, $2::jsonb, NULL)`,
        [manifest.id, JSON.stringify({
          backupId: manifest.id,
          archiveSha256: sha256Hex(await readFile(archivePath)),
          tables: result.tables.length,
          rows: result.rowCount,
          sourceAppVersion: manifest.appVersion,
        })],
      );
      console.log(JSON.stringify({
        restored: true,
        backupId: manifest.id,
        tables: result.tables.length,
        rows: result.rowCount,
        controls: result.controls,
      }, null, 2));
    } finally {
      await target.close();
    }
    return;
  }

  throw new Error('Usage: backup <create-global|export-company|verify|restore> ...');
}

main().catch((error) => {
  const code = error instanceof AppError ? error.code : 'BACKUP_FAILED';
  console.error(JSON.stringify({ error: code, message: error instanceof Error ? error.message : String(error) }));
  process.exitCode = 1;
});
