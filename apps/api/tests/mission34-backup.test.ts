/**
 * Mission 34 — P0-02 backup, verified restore and company export.
 *
 * Every scenario uses fictitious companies and documents. The suite runs on
 * PGlite locally and on real PostgreSQL in CI (TEST_DATABASE_URL). Restore is
 * exercised against a separate empty database: no test ever touches a live DB.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { createPgDb, createPgliteDb, migrate, type Db } from '../src/db/index.js';
import {
  api,
  closeTestApp,
  createCompany,
  createTestApp,
  getAccounts,
  getJournals,
  journalByCode,
  accountByCode,
  registerUser,
  type TestContext,
  type TestUser,
} from './helpers.js';
import {
  createCompanyExport,
  createGlobalBackup,
  downloadBackup,
  listBackupRuns,
  restoreBackup,
  verifyStoredBackup,
} from '../src/backup/service.js';
import { assertSafeArchivePath, unpackZip } from '../src/backup/archive.js';
import { decryptArchive, encryptArchive, sha256Hex } from '../src/backup/crypto.js';

const PASS = 'mission34-fictitious-passphrase';
let ctx: TestContext;
let admin: TestUser;
let companyA: any;
let companyB: any;
let backupId = '';
let archivePath = '';
let root = '';
let exportIdA = '';

async function postEntry(user: TestUser, company: any, accounts: any[], journals: any[], description: string) {
  const res = await api(ctx, user.cookie, 'POST', `/api/companies/${company.id}/entries`, {
    journalId: journalByCode(journals, 'OD').id,
    entryDate: '2025-08-01',
    description,
    status: 'posted',
    lines: [
      { accountId: accountByCode(accounts, '1010').id, debit: '1000' },
      { accountId: accountByCode(accounts, '4000').id, credit: '1000' },
    ],
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().entry;
}

async function addFixtureFile(db: Db, user: TestUser, company: any, entryId: string) {
  const dir = path.resolve(ctx.config.STORAGE_DIR, company.id);
  await import('node:fs/promises').then((fs) => fs.mkdir(dir, { recursive: true }));
  const storedName = `fictif-${company.id}.pdf`;
  const content = Buffer.from('%PDF-1.4\nMission 34 fictitious attachment\n');
  await writeFile(path.join(dir, storedName), content, { mode: 0o600 });
  await db.query(
    `INSERT INTO attachments (company_id, entry_id, original_name, stored_name, mime_type,
                              size_bytes, sha256, uploaded_by)
     VALUES ($1,$2,$3,$4,'application/pdf',$5,$6,$7)`,
    [company.id, entryId, 'facture-fictive.pdf', storedName, content.byteLength, sha256Hex(content), user.id],
  );
  return { storedName, sha256: sha256Hex(content) };
}

function flakyDb(target: Db): Db {
  const wrap = (db: Db): Db => ({
    ...db,
    query: async (sql: string, params?: readonly unknown[]) => {
      if (sql.includes('INSERT INTO "journal_entries"')) {
        throw new Error('Simulated interruption during restore');
      }
      return db.query(sql, params);
    },
    transaction: (fn: (tx: Db) => Promise<any>) => db.transaction((tx) => fn(wrap(tx))),
  });
  return wrap(target);
}

describe('mission 34 — sauvegarde, restauration et export', () => {
  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'mc34-'));
    ctx = await createTestApp({
      BACKUP_DIR: path.join(root, 'backups'),
      STORAGE_DIR: path.join(root, 'storage'),
      BACKUP_ENCRYPTION_KEY: PASS,
      BACKUP_ADMIN_EMAILS: 'admin34@example.test',
      BACKUP_RESTORE_ENABLED: 'true',
      BACKUP_MAX_BYTES: String(64 * 1024 * 1024),
    });
    admin = await registerUser(ctx, { email: 'admin34@example.test' });
    companyA = await createCompany(ctx, admin.cookie, { name: 'Alpha Fictive Ltd', brn: 'M34-A' });
    companyB = await createCompany(ctx, admin.cookie, { name: 'Beta Fictive Ltd', brn: 'M34-B' });
    for (const company of [companyA, companyB]) {
      const accounts = await getAccounts(ctx, admin.cookie, company.id);
      const journals = await getJournals(ctx, admin.cookie, company.id);
      const entry = await postEntry(admin, company, accounts, journals, `Vente fictive ${company.name}`);
      await addFixtureFile(ctx.db, admin, company, entry.id);
    }
  }, 120_000);

  afterAll(async () => {
    await closeTestApp(ctx);
    await rm(root, { recursive: true, force: true });
  });

  it('creates an encrypted global backup with a manifest and external files', async () => {
    const started = Date.now();
    const result = await createGlobalBackup(ctx.db, ctx.config, {
      userId: admin.id,
      email: admin.email,
      ip: '127.0.0.1',
    });
    backupId = result.backup.id;
    const row = await ctx.db.query<any>('SELECT * FROM backup_runs WHERE id = $1', [backupId]);
    expect(row.rows[0].status).toBe('completed');
    expect(row.rows[0].archive_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(Number(row.rows[0].archive_bytes)).toBeGreaterThan(0);
    expect(result.manifest.database.tables.length).toBeGreaterThan(100);
    expect(result.manifest.database.excludedTables).toContain('sessions');
    expect(result.manifest.files).toHaveLength(2);
    expect(result.manifest.controls.companies).toBe(2);
    expect(result.manifest.controls.postedEntries).toBe(2);
    expect(result.manifest.controls.debitTotal).toBe('2000.0000');
    expect(result.manifest.controls.creditTotal).toBe('2000.0000');

    const dl = await downloadBackup(ctx.db, ctx.config, backupId);
    archivePath = dl.path;
    const envelope = await readFile(archivePath);
    expect(envelope.subarray(0, 8).toString('latin1')).toBe('MCBACKUP');
    expect(envelope.includes(Buffer.from(PASS))).toBe(false);
    expect(envelope.includes(Buffer.from('admin34@example.test'))).toBe(false);

    const info = await stat(archivePath);
    expect(info.mode & 0o777).toBe(0o600);
    const { readdir } = await import('node:fs/promises');
    const backupFiles = await readdir(ctx.config.BACKUP_DIR);
    expect(backupFiles.some((name) => name.endsWith('.tmp'))).toBe(false);
    const duration = Date.now() - started;
    console.log(`[M34] volume: 2 companies, ${result.manifest.database.rowCount} rows, ${result.manifest.files.length} files; backup ${duration} ms; archive ${envelope.byteLength} bytes`);
  }, 120_000);

  it('verifies the archive and rejects tampering, truncation and unsafe paths', async () => {
    const verified = await verifyStoredBackup(ctx.db, ctx.config, backupId, {
      userId: admin.id,
      email: admin.email,
    });
    expect(verified.valid).toBe(true);
    expect(verified.schemaCompatible).toBe(true);
    expect(verified.manifest.id).toBe(backupId);

    const envelope = await readFile(archivePath);
    const tampered = Buffer.from(envelope);
    const flipAt = tampered.length - 5;
    tampered.writeUInt8(tampered.readUInt8(flipAt) ^ 0xff, flipAt);
    const tamperedPath = path.join(root, 'tampered.mcbackup');
    await writeFile(tamperedPath, tampered);
    await expect(restoreBackup({
      targetDb: await createPgliteDb(),
      config: ctx.config,
      archivePath: tamperedPath,
      storageDir: path.join(root, 'never-created'),
      confirmationId: backupId,
      allowProduction: false,
    })).rejects.toMatchObject({ code: 'BACKUP_DECRYPTION_FAILED' });

    const truncatedPath = path.join(root, 'truncated.mcbackup');
    await writeFile(truncatedPath, envelope.subarray(0, 20));
    await expect(restoreBackup({
      targetDb: await createPgliteDb(),
      config: ctx.config,
      archivePath: truncatedPath,
      storageDir: path.join(root, 'never-created-2'),
      confirmationId: backupId,
      allowProduction: false,
    })).rejects.toMatchObject({ code: 'BACKUP_ARCHIVE_INVALID' });

    // A valid AES envelope is not enough: an altered table must fail its
    // inner SHA-256 and a missing table file must be refused.
    const originalZip = unzipSync(decryptArchive(envelope, PASS));
    const alteredCompanies = JSON.parse(strFromU8(originalZip['database/companies.json']!));
    alteredCompanies[0].name = 'Altered after backup';
    originalZip['database/companies.json'] = strToU8(JSON.stringify(alteredCompanies));
    const alteredPath = path.join(root, 'inner-tampered.mcbackup');
    await writeFile(alteredPath, encryptArchive(zipSync(originalZip), PASS));
    await expect(restoreBackup({
      targetDb: await createPgliteDb(),
      config: ctx.config,
      archivePath: alteredPath,
      storageDir: path.join(root, 'never-created-3'),
      confirmationId: backupId,
      allowProduction: false,
    })).rejects.toMatchObject({ code: 'BACKUP_INTEGRITY_FAILED' });

    const missingZip = unzipSync(decryptArchive(envelope, PASS));
    delete missingZip['database/journal_lines.json'];
    const missingPath = path.join(root, 'missing-table.mcbackup');
    await writeFile(missingPath, encryptArchive(zipSync(missingZip), PASS));
    await expect(restoreBackup({
      targetDb: await createPgliteDb(),
      config: ctx.config,
      archivePath: missingPath,
      storageDir: path.join(root, 'never-created-4'),
      confirmationId: backupId,
      allowProduction: false,
    })).rejects.toMatchObject({ code: 'BACKUP_ARCHIVE_INVALID' });

    const malicious = zipSync({
      'manifest.json': strToU8('{}'),
      '../escape.txt': strToU8('x'),
    });
    const maliciousPath = path.join(root, 'traversal.mcbackup');
    await writeFile(maliciousPath, encryptArchive(malicious, PASS));
    await expect(restoreBackup({
      targetDb: await createPgliteDb(),
      config: ctx.config,
      archivePath: maliciousPath,
      storageDir: path.join(root, 'never-created-5'),
      confirmationId: backupId,
      allowProduction: false,
    })).rejects.toMatchObject({ code: 'BACKUP_ARCHIVE_INVALID' });

    expect(() => unpackZip(zipSync({ 'a.txt': strToU8('12345') }), 2)).toThrow(/size limit/i);

    expect(() => assertSafeArchivePath('../escape.txt')).toThrow();
    expect(() => assertSafeArchivePath('/etc/passwd')).toThrow();
    expect(() => assertSafeArchivePath('storage/a/../../b')).toThrow();
    expect(() => assertSafeArchivePath('storage/ok/file.pdf')).not.toThrow();
  }, 120_000);

  it('restores into an empty database and preserves data, accounting controls and files', async () => {
    // CI additionally points this at a dedicated real PostgreSQL database:
    // the same logical restore is therefore exercised on both engines.
    const target = process.env.TEST_RESTORE_DATABASE_URL
      ? await createPgDb(process.env.TEST_RESTORE_DATABASE_URL, { max: 4 })
      : await createPgliteDb();
    const targetStorage = path.join(root, 'restore-storage');
    const started = Date.now();
    try {
      const report = await restoreBackup({
        targetDb: target,
        config: ctx.config,
        archivePath,
        storageDir: targetStorage,
        confirmationId: backupId,
        allowProduction: false,
      });
      const duration = Date.now() - started;
      expect(report.controls.companies).toBe(2);
      expect(report.controls.postedEntries).toBe(2);
      expect(report.controls.debitTotal).toBe('2000.0000');
      expect(report.controls.creditTotal).toBe('2000.0000');
      expect(report.tables.length).toBeGreaterThan(100);

      const companies = await target.query<any>('SELECT id, name FROM companies ORDER BY name');
      expect(companies.rows.map((c) => c.name)).toEqual(['Alpha Fictive Ltd', 'Beta Fictive Ltd']);
      const totals = await target.query<any>(
        `SELECT company_id, SUM(debit)::text AS debit, SUM(credit)::text AS credit
           FROM journal_lines GROUP BY company_id ORDER BY company_id`,
      );
      for (const row of totals.rows) {
        expect(row.debit).toBe(row.credit);
        expect(row.debit).toBe('1000.0000');
      }
      const users = await target.query<any>('SELECT email FROM app_users');
      expect(users.rows.map((u) => u.email)).toContain('admin34@example.test');
      const sessions = await target.query<any>('SELECT count(*)::int AS n FROM sessions');
      expect(sessions.rows[0].n).toBe(0);
      const history = await target.query<any>('SELECT count(*)::int AS n FROM backup_runs');
      expect(history.rows[0].n).toBe(0);

      for (const company of [companyA, companyB]) {
        const file = path.join(targetStorage, company.id, `fictif-${company.id}.pdf`);
        const content = await readFile(file);
        expect(content.includes(Buffer.from('Mission 34 fictitious attachment'))).toBe(true);
      }
      console.log(`[M34] restored ${report.rowCount} rows and ${report.tables.length} tables in ${duration} ms`);
    } finally {
      await target.close();
    }
  }, 180_000);

  it('refuses a non-empty target, a wrong confirmation and an interrupted restore', async () => {
    const nonEmpty = await createPgliteDb();
    await migrate(nonEmpty);
    await expect(restoreBackup({
      targetDb: nonEmpty,
      config: ctx.config,
      archivePath,
      storageDir: path.join(root, 'unused-a'),
      confirmationId: backupId,
      allowProduction: false,
    })).rejects.toMatchObject({ code: 'BACKUP_TARGET_NOT_EMPTY' });
    await nonEmpty.close();

    const wrongTarget = await createPgliteDb();
    await expect(restoreBackup({
      targetDb: wrongTarget,
      config: ctx.config,
      archivePath,
      storageDir: path.join(root, 'unused-b'),
      confirmationId: '00000000-0000-0000-0000-000000000000',
      allowProduction: false,
    })).rejects.toMatchObject({ code: 'BACKUP_CONFIRMATION_REQUIRED' });
    await wrongTarget.close();

    const flakyTarget = await createPgliteDb();
    const interruptedStorage = path.join(root, 'interrupted-storage');
    await expect(restoreBackup({
      targetDb: flakyDb(flakyTarget),
      config: ctx.config,
      archivePath,
      storageDir: interruptedStorage,
      confirmationId: backupId,
      allowProduction: false,
    })).rejects.toThrow(/Simulated interruption/);
    const companies = await flakyTarget.query<any>('SELECT count(*)::int AS n FROM companies');
    expect(companies.rows[0].n).toBe(0);
    const journals = await flakyTarget.query<any>('SELECT count(*)::int AS n FROM journal_entries');
    expect(journals.rows[0].n).toBe(0);
    await expect(stat(interruptedStorage)).rejects.toBeTruthy();
    await flakyTarget.close();
  }, 180_000);

  it('exports only one company, without password hashes, and refuses accounting roles', async () => {
    const result = await createCompanyExport(ctx.db, ctx.config, {
      userId: admin.id,
      email: admin.email,
    }, companyA.id);
    exportIdA = result.backup.id;
    expect(result.manifest.kind).toBe('company_export');
    expect(result.manifest.restoreSupported).toBe(false);
    expect(result.manifest.scope.companyId).toBe(companyA.id);
    expect(result.manifest.controls.company?.companyId).toBe(companyA.id);

    const { path: exportPath } = await downloadBackup(ctx.db, ctx.config, exportIdA);
    const envelope = await readFile(exportPath);
    const zip = unzipSync(decryptArchive(envelope, PASS));
    const entries = new Set(Object.keys(zip));
    expect(entries.has('manifest.json')).toBe(true);
    expect(entries.has('data/company.json')).toBe(true);
    expect(entries.has('data/users.json')).toBe(true);
    expect(entries.has('csv/trial_balance.csv')).toBe(true);
    expect(entries.has('csv/general_ledger.csv')).toBe(true);
    expect(entries.has('data/sessions.json')).toBe(false);
    expect(entries.has('data/backup_runs.json')).toBe(false);
    expect(strFromU8(zip['data/users.json']!)).not.toContain('password_hash');
    for (const name of entries) {
      if (!name.startsWith('data/') || !name.endsWith('.json') || name === 'data/company.json' || name === 'data/users.json') continue;
      const rows = JSON.parse(strFromU8(zip[name]!)) as any[];
      for (const row of rows) {
        if (row.company_id) expect(row.company_id).toBe(companyA.id);
      }
    }
    const manifest = JSON.parse(strFromU8(zip['manifest.json']!));
    expect(manifest.warnings.join(' ')).toMatch(/not a restorable backup/i);

    const fresh = await createPgliteDb();
    await expect(restoreBackup({
      targetDb: fresh,
      config: ctx.config,
      archivePath: exportPath,
      storageDir: path.join(root, 'export-not-restorable'),
      confirmationId: exportIdA,
      allowProduction: false,
    })).rejects.toMatchObject({ code: 'BACKUP_NOT_RESTORABLE' });
    await fresh.close();

    const accountant = await registerUser(ctx);
    await ctx.db.query(
      `INSERT INTO company_members (company_id, user_id, role) VALUES ($1,$2,'accountant')`,
      [companyA.id, accountant.id],
    );
    await expect(createCompanyExport(ctx.db, ctx.config, {
      userId: accountant.id,
      email: accountant.email,
    }, companyA.id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  }, 120_000);

  it('enforces API authorisation and never exposes an HTTP restore endpoint', async () => {
    const anonymous = await ctx.app.inject({
      method: 'GET',
      url: `/api/admin/backups/${backupId}/download`,
    });
    expect(anonymous.statusCode).toBe(401);

    const statusAdmin = await api(ctx, admin.cookie, 'GET', '/api/admin/backup/status');
    expect(statusAdmin.statusCode).toBe(200);
    expect(statusAdmin.json().authorized).toBe(true);
    expect(statusAdmin.json().restore.available).toBe(false);
    expect(statusAdmin.json().restore.mode).toBe('offline_cli');

    const user = await registerUser(ctx);
    const denied = await api(ctx, user.cookie, 'POST', '/api/admin/backups');
    expect(denied.statusCode).toBe(403);
    expect(denied.json().error.code).toBe('BACKUP_FORBIDDEN');
    const statusUser = await api(ctx, user.cookie, 'GET', '/api/admin/backup/status');
    expect(statusUser.json().authorized).toBe(false);

    const noRestore = await api(ctx, admin.cookie, 'POST', `/api/admin/backups/${backupId}/restore`, {
      confirm: true,
    });
    expect(noRestore.statusCode).toBe(404);

    const created = await api(ctx, admin.cookie, 'POST', '/api/admin/backups');
    expect(created.statusCode, created.body).toBe(201);
    expect(created.json().backup.status).toBe('completed');
    expect(created.json().manifest.tables).toBeGreaterThan(100);
    const backupDownload = await api(ctx, admin.cookie, 'GET',
      `/api/admin/backups/${created.json().backup.id}/download`);
    expect(backupDownload.statusCode).toBe(200);
    expect(backupDownload.headers['cache-control']).toContain('no-store');
    expect(backupDownload.rawPayload.byteLength).toBeGreaterThan(0);

    const list = await api(ctx, admin.cookie, 'GET', '/api/admin/backups');
    expect(list.statusCode).toBe(200);
    expect(list.json().backups.some((b: any) => b.id === backupId)).toBe(true);
    const verify = await api(ctx, admin.cookie, 'POST', `/api/admin/backups/${backupId}/verify`);
    expect(verify.statusCode).toBe(200);
    expect(verify.json().valid).toBe(true);

    const exported = await api(ctx, admin.cookie, 'POST', `/api/companies/${companyA.id}/exports`);
    expect(exported.statusCode).toBe(201);
    expect(exported.json().restoreSupported).toBe(false);
    const exportList = await api(ctx, admin.cookie, 'GET', `/api/companies/${companyA.id}/exports`);
    expect(exportList.statusCode).toBe(200);
    expect(exportList.json().exports.length).toBeGreaterThan(0);

    const outsider = await registerUser(ctx);
    await ctx.db.query(
      `INSERT INTO company_members (company_id, user_id, role) VALUES ($1,$2,'admin')`,
      [companyB.id, outsider.id],
    );
    const crossTenant = await api(ctx, outsider.cookie, 'GET',
      `/api/companies/${companyA.id}/exports/${exported.json().export.id}/download`);
    expect(crossTenant.statusCode).toBe(404);
    const exportDownload = await api(ctx, admin.cookie, 'GET',
      `/api/companies/${companyA.id}/exports/${exported.json().export.id}/download`);
    expect(exportDownload.statusCode).toBe(200);
    // A company export must never be reachable through the global-backup routes.
    const exportAsGlobal = await api(ctx, admin.cookie, 'GET',
      `/api/admin/backups/${exported.json().export.id}/download`);
    expect(exportAsGlobal.statusCode).toBe(404);
    const exportAsGlobalDetail = await api(ctx, admin.cookie, 'GET',
      `/api/admin/backups/${exported.json().export.id}`);
    expect(exportAsGlobalDetail.statusCode).toBe(404);
    expect(exportDownload.headers['cache-control']).toContain('no-store');
    expect(exportDownload.rawPayload.byteLength).toBeGreaterThan(0);
    const verifyExport = await api(ctx, admin.cookie, 'POST',
      `/api/companies/${companyA.id}/exports/${exported.json().export.id}/verify`);
    expect(verifyExport.statusCode).toBe(200);
    expect(verifyExport.json().valid).toBe(true);
  }, 120_000);

  it('keeps backup history and audit records traceable without secrets', async () => {
    const runs = await listBackupRuns(ctx.db, { limit: 100 });
    expect(runs.length).toBeGreaterThanOrEqual(3);
    expect(runs.every((run) => run.archive_sha256 && run.archive_name)).toBe(true);
    const audits = await ctx.db.query<any>(
      `SELECT action, details FROM audit_log
        WHERE action IN ('backup.create','backup.verify','company.export','backup.download','company.export.download')
        ORDER BY id`,
    );
    expect(audits.rows.map((r) => r.action)).toContain('backup.create');
    expect(audits.rows.map((r) => r.action)).toContain('company.export');
    const serialised = JSON.stringify(audits.rows);
    expect(serialised).not.toContain(PASS);
    expect(serialised.toLowerCase()).not.toContain('password_hash');
    const history = await ctx.app.inject({
      method: 'GET',
      url: '/api/admin/backups',
      headers: { cookie: admin.cookie },
    });
    expect(history.body).not.toContain(PASS);
    expect(history.body).not.toContain(root);
  }, 60_000);

  it('refuses an incomplete backup when a referenced document is missing', async () => {
    const { unlink } = await import('node:fs/promises');
    await unlink(path.join(ctx.config.STORAGE_DIR, companyA.id, `fictif-${companyA.id}.pdf`));
    await expect(createGlobalBackup(ctx.db, ctx.config, {
      userId: admin.id,
      email: admin.email,
    })).rejects.toMatchObject({ code: 'BACKUP_FILE_MISSING' });
    const failed = await ctx.db.query<any>(
      `SELECT status, error_code FROM backup_runs ORDER BY started_at DESC LIMIT 1`,
    );
    expect(failed.rows[0].status).toBe('failed');
    expect(failed.rows[0].error_code).toBe('BACKUP_FILE_MISSING');
  }, 60_000);
});
