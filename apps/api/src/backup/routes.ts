/**
 * Mission 34 — administrative backup API.
 *
 * Global backup is restricted to an explicit allowlist. Company export is
 * restricted to a company administrator who also holds payroll administration.
 * There is deliberately NO HTTP restore endpoint: restoration is an offline,
 * double-confirmed CLI operation against an empty database.
 */
import { createReadStream } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import type { Config } from '../config.js';
import type { Db } from '../db/index.js';
import { writeAudit } from '../lib/audit.js';
import { clientIp } from '../lib/http.js';
import { AppError, forbidden, notFound } from '../lib/errors.js';
import { requireCompany } from '../lib/tenant.js';
import { effectiveAccess } from '../lib/permissions.js';
import type { CompanyRole } from '../types.js';
import {
  type BackupRunRow,
  backupReady,
  exportReady,
  createCompanyExport,
  createGlobalBackup,
  downloadBackup,
  getBackupRun,
  isBackupAdmin,
  listBackupRuns,
  requireBackupAdmin,
  verifyStoredBackup,
  verifyCompanyExport,
} from './service.js';

export function backupRoutes(app: FastifyInstance, db: Db, config: Config) {
  app.get('/admin/backup/status', async (req) => {
    const user = req.user!;
    const state = backupReady(config);
    const companyExports = exportReady(config);
    return {
      enabled: companyExports.ready,
      reason: state.reason ?? companyExports.reason,
      globalBackupEnabled: state.ready,
      exportEnabled: companyExports.ready,
      authorized: isBackupAdmin(config, user.email),
      restore: {
        available: false,
        mode: 'offline_cli',
        reason: 'RESTORE_CLI_ONLY',
        enabledByConfiguration: config.BACKUP_RESTORE_ENABLED,
      },
      retention: { scheduledBackups: false, remoteStorage: false },
    };
  });

  app.post('/admin/backups', async (req, reply) => {
    const user = req.user!;
    requireBackupAdmin(config, user.email);
    const result = await createGlobalBackup(db, config, {
      userId: user.id,
      email: user.email,
      ip: clientIp(req),
    });
    return reply.code(201).send({
      backup: publicRun(result.backup),
      manifest: manifestSummary(result.manifest),
      durationMs: result.durationMs,
    });
  });

  app.get('/admin/backups', async (req) => {
    const user = req.user!;
    requireBackupAdmin(config, user.email);
    const rows = await listBackupRuns(db, { kind: 'global_backup', limit: 100 });
    return { backups: rows.map(publicRun) };
  });

  app.get('/admin/backups/:backupId', async (req) => {
    const user = req.user!;
    requireBackupAdmin(config, user.email);
    const { backupId } = req.params as { backupId: string };
    const row = await getBackupRun(db, backupId);
    assertGlobalBackup(row);
    return { backup: publicRun(row) };
  });

  app.get('/admin/backups/:backupId/download', async (req, reply) => {
    const user = req.user!;
    requireBackupAdmin(config, user.email);
    const { backupId } = req.params as { backupId: string };
    const { row, path } = await downloadBackup(db, config, backupId);
    assertGlobalBackup(row);
    await writeAudit(db, {
      userId: user.id,
      action: 'backup.download',
      entityType: 'backup',
      entityId: row.id,
      details: { bytes: row.archive_bytes, sha256: row.archive_sha256 },
      ip: clientIp(req),
    });
    return reply
      .header('content-type', 'application/octet-stream')
      .header('content-disposition', `attachment; filename="${row.archive_name}"`)
      .header('cache-control', 'private, no-store')
      .header('x-content-type-options', 'nosniff')
      .send(createReadStream(path));
  });

  app.post('/admin/backups/:backupId/verify', async (req) => {
    const user = req.user!;
    requireBackupAdmin(config, user.email);
    const { backupId } = req.params as { backupId: string };
    const result = await verifyStoredBackup(db, config, backupId, {
      userId: user.id,
      email: user.email,
      ip: clientIp(req),
    });
    return {
      valid: true,
      schemaCompatible: result.schemaCompatible,
      backupId: result.manifest.id,
      tables: result.manifest.database.tables.length,
      rows: result.manifest.database.rowCount,
      files: result.manifest.files.length,
      totalBytes: result.totalBytes,
      verifiedAt: new Date().toISOString(),
    };
  });

  app.post('/companies/:companyId/exports', async (req, reply) => {
    const user = req.user!;
    const { companyId } = req.params as { companyId: string };
    await requireCompany(db, user.id, companyId, 'admin');
    const state = exportReady(config);
    if (!state.ready) {
      throw new AppError(
        'BACKUP_KEY_NOT_CONFIGURED',
        503,
        'Company export is not enabled on this server: configure BACKUP_ENCRYPTION_KEY',
      );
    }
    const result = await createCompanyExport(db, config, {
      userId: user.id,
      email: user.email,
      ip: clientIp(req),
    }, companyId);
    return reply.code(201).send({
      export: publicRun(result.backup),
      manifest: manifestSummary(result.manifest),
      durationMs: result.durationMs,
      restoreSupported: false,
    });
  });

  app.get('/companies/:companyId/exports', async (req) => {
    const user = req.user!;
    const { companyId } = req.params as { companyId: string };
    await requireCompany(db, user.id, companyId, 'admin');
    const rows = await listBackupRuns(db, { kind: 'company_export', companyId, limit: 100 });
    return { exports: rows.map(publicRun) };
  });

  app.post('/companies/:companyId/exports/:exportId/verify', async (req) => {
    const user = req.user!;
    const { companyId, exportId } = req.params as { companyId: string; exportId: string };
    await requireExportPayrollAdmin(db, companyId, user.id);
    const result = await verifyCompanyExport(db, config, exportId, companyId, {
      userId: user.id,
      ip: clientIp(req),
    });
    return {
      valid: true,
      exportId: result.manifest.id,
      tables: result.manifest.database.tables.length,
      rows: result.manifest.database.rowCount,
      files: result.manifest.files.length,
      totalBytes: result.totalBytes,
      verifiedAt: new Date().toISOString(),
    };
  });

  app.get('/companies/:companyId/exports/:exportId/download', async (req, reply) => {
    const user = req.user!;
    const { companyId, exportId } = req.params as { companyId: string; exportId: string };
    await requireExportPayrollAdmin(db, companyId, user.id);
    const row = await getBackupRun(db, exportId);
    if (row.kind !== 'company_export' || row.company_id !== companyId) {
      throw notFound('BACKUP_NOT_FOUND', 'Company export not found');
    }
    const { path } = await downloadBackup(db, config, exportId);
    await writeAudit(db, {
      companyId,
      userId: user.id,
      action: 'company.export.download',
      entityType: 'company',
      entityId: companyId,
      details: { exportId, bytes: row.archive_bytes, sha256: row.archive_sha256 },
      ip: clientIp(req),
    });
    return reply
      .header('content-type', 'application/octet-stream')
      .header('content-disposition', `attachment; filename="${row.archive_name}"`)
      .header('cache-control', 'private, no-store')
      .header('x-content-type-options', 'nosniff')
      .send(createReadStream(path));
  });
}

function assertGlobalBackup(row: BackupRunRow): void {
  if (row.kind !== 'global_backup') {
    throw notFound('BACKUP_NOT_FOUND', 'Global backup not found');
  }
}

/** A full company export contains payroll: downloading or verifying it needs payroll admin. */
async function requireExportPayrollAdmin(db: Db, companyId: string, userId: string): Promise<void> {
  const access = await requireCompany(db, userId, companyId, 'admin');
  const payroll = await effectiveAccess(db, companyId, userId, access.role as CompanyRole, 'payroll');
  if (payroll !== 'admin') {
    throw forbidden('A full company export requires payroll administration access', 'BACKUP_PAYROLL_FORBIDDEN');
  }
}

function publicRun(row: any) {
  return {
    id: row.id,
    kind: row.kind,
    companyId: row.company_id,
    status: row.status,
    archiveName: row.archive_name,
    archiveSha256: row.archive_sha256,
    archiveBytes: row.archive_bytes === null ? null : Number(row.archive_bytes),
    startedAt: row.started_at,
    completedAt: row.completed_at,
    verifiedAt: row.verified_at,
    errorCode: row.error_code,
    errorMessage: row.error_message,
  };
}

function manifestSummary(manifest: any) {
  return {
    id: manifest.id,
    kind: manifest.kind,
    createdAt: manifest.createdAt,
    appVersion: manifest.appVersion,
    restoreSupported: manifest.restoreSupported,
    schema: manifest.schema,
    tables: manifest.database.tables.length,
    rows: manifest.database.rowCount,
    files: manifest.files.length,
    excludedTables: manifest.database.excludedTables,
    controls: manifest.controls,
    warnings: manifest.warnings,
  };
}
