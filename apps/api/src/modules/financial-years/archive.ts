/**
 * Mission 21 — immutable annual archives.
 *
 * An archive is a sealed JSON snapshot of the accounting evidence, not a copy of
 * the underlying scanned documents and not a legally certified archive. Every
 * section has a SHA-256 checksum; the overall checksum covers the manifest.
 * A sealed archive can never be updated or deleted by the application.
 */
import { createHash } from 'node:crypto';
import { zipSync, strToU8 } from 'fflate';
import type { Db } from '../../db/index.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { writeAudit } from '../../lib/audit.js';
import { computeLedger, computeStatements, computeTrialBalance } from '../reports/service.js';
import { bankReconciliationReport } from '../bank/reports.js';
import { registerReport, scheduleReport, accumulatedReport, nbvReport, additionsDisposalsReport, reconciliationReport, movementScheduleReport } from '../fixed-assets/reports.js';
import { previewOpening } from './opening.js';
import type { FinancialYearActor } from './types.js';

function stable(value: any): string {
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (typeof value === 'object') return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
function sha(value: string): string { return createHash('sha256').update(value).digest('hex'); }
function bytes(value: string): number { return Buffer.byteLength(value, 'utf8'); }

async function buildSections(db: Db, companyId: string, period: any, currency: string, generatedAt: string) {
  const trials = await computeTrialBalance(db, companyId, currency, { from: period.start_date, to: period.end_date });
  const ledger = await computeLedger(db, companyId, currency, { from: period.start_date, to: period.end_date });
  const statements = await computeStatements(db, companyId, currency, { from: period.start_date, to: period.end_date });

  const entries = await db.query<any>(
    `SELECT e.id, e.entry_no, e.entry_date, e.reference, e.description, e.currency, e.exchange_rate, e.status, e.source, e.posted_at,
            j.code AS journal_code, j.name AS journal_name
       FROM journal_entries e JOIN journals j ON j.id = e.journal_id
      WHERE e.company_id = $1 AND e.entry_date BETWEEN $2 AND $3 AND e.status = 'posted'
      ORDER BY e.entry_date, e.entry_no`, [companyId, period.start_date, period.end_date]);
  const lines = await db.query<any>(
    `SELECT l.entry_id, l.line_no, a.code AS account_code, a.name AS account_name, a.type AS account_type,
            l.description, l.debit::text, l.credit::text
       FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id JOIN accounts a ON a.id = l.account_id
      WHERE e.company_id = $1 AND e.entry_date BETWEEN $2 AND $3 AND e.status = 'posted'
      ORDER BY e.entry_date, e.entry_no, l.line_no`, [companyId, period.start_date, period.end_date]);
  const byEntry = new Map<string, any[]>();
  for (const line of lines.rows) {
    const list = byEntry.get(line.entry_id) ?? [];
    list.push(line); byEntry.set(line.entry_id, list);
  }
  const journals = { entries: entries.rows.map((e: any) => ({ ...e, lines: byEntry.get(e.id) ?? [] })) };

  const bankAccounts = await db.query<any>(`SELECT id, name, bank_name, currency, account_id FROM bank_accounts WHERE company_id = $1 ORDER BY name`, [companyId]);
  const bank = [] as any[];
  for (const account of bankAccounts.rows) {
    const report = await bankReconciliationReport(db, companyId, account.id, period.start_date, period.end_date);
    bank.push({ account: { id: account.id, name: account.name, bankName: account.bank_name, currency: account.currency }, summary: {
      transactionCount: report.transactions.length, allocationCount: report.allocations.length,
      invoiceCount: report.invoices.length,
    }, report });
  }

  const fixedAssets = {
    register: await registerReport(db, companyId, period.end_date),
    schedule: await scheduleReport(db, companyId, period.start_date, period.end_date),
    accumulated: await accumulatedReport(db, companyId, period.end_date),
    netBookValue: await nbvReport(db, companyId, period.end_date),
    additionsDisposals: await additionsDisposalsReport(db, companyId, period.start_date, period.end_date),
    reconciliation: await reconciliationReport(db, companyId, period.end_date),
    movementSchedule: await movementScheduleReport(db, companyId, period.start_date, period.end_date),
  };

  const equity = await db.query<any>(
    `SELECT m.id, m.movement_no, m.movement_date, m.category, m.direction, m.amount::text, m.description, m.document_ref,
            m.status, a.code AS equity_account_code, a.name AS equity_account_name
       FROM equity_movements m JOIN accounts a ON a.id = m.equity_account_id
      WHERE m.company_id = $1 AND m.movement_date BETWEEN $2 AND $3 ORDER BY m.movement_date, m.movement_no`,
    [companyId, period.start_date, period.end_date]);
  const closings = await db.query<any>(`SELECT * FROM fiscal_closings WHERE company_id = $1 AND source_period_id = $2 ORDER BY version`, [companyId, period.id]);
  const allocations = await db.query<any>(
    `SELECT al.*, (SELECT json_agg(json_build_object('nature', l.nature, 'accountId', l.account_id, 'amount', l.amount::text)) FROM equity_allocation_lines l WHERE l.allocation_id = al.id) AS lines
       FROM equity_allocations al WHERE al.company_id = $1 AND al.closing_id = ANY($2::uuid[]) ORDER BY al.created_at`,
    [companyId, closings.rows.map((c: any) => c.id)]);

  const documents = await db.query<any>(
    `SELECT a.id, a.original_name, a.mime_type, a.size_bytes, a.sha256, a.created_at, e.entry_no, e.entry_date
       FROM attachments a JOIN journal_entries e ON e.id = a.entry_id
      WHERE a.company_id = $1 AND e.entry_date BETWEEN $2 AND $3 ORDER BY e.entry_date, a.created_at`,
    [companyId, period.start_date, period.end_date]);

  const approvals = await db.query<any>(
    `SELECT id, action, entity_type, entity_id, details, user_id, created_at FROM audit_log
      WHERE company_id = $1 AND (action LIKE 'closing.%' OR action LIKE 'equity.%' OR action LIKE 'adjustment.%'
         OR action LIKE 'opening_batch.%' OR action LIKE 'checklist.%' OR action LIKE 'archive.%'
         OR action LIKE 'fixed_asset.%')
        AND created_at <= $2::timestamptz
      ORDER BY created_at DESC LIMIT 5000`, [companyId, generatedAt]);

  const adjustments = await db.query<any>(
    `SELECT a.*, (SELECT json_agg(json_build_object('lineNo', l.line_no, 'accountId', l.account_id, 'debit', l.debit::text, 'credit', l.credit::text, 'description', l.description) ORDER BY l.line_no)
                   FROM prior_year_adjustment_lines l WHERE l.adjustment_id = a.id) AS lines
       FROM prior_year_adjustments a
      WHERE a.company_id = $1 AND (a.source_period_id = $2 OR a.adjustment_date BETWEEN $3 AND $4)
      ORDER BY a.created_at`, [companyId, period.id, period.start_date, period.end_date]);

  const opening = await previewOpening(db, companyId, period.id);
  const retention = await db.query<any>('SELECT * FROM fiscal_year_settings WHERE company_id = $1', [companyId]);

  return {
    trialBalance: trials,
    generalLedger: ledger,
    statements,
    journals,
    bankReconciliations: bank,
    fixedAssets,
    equity: { movements: equity.rows, closings: closings.rows, allocations: allocations.rows },
    adjustments: adjustments.rows,
    openingBalances: { period: opening.period, previousPeriod: opening.previousPeriod, method: opening.method,
      totals: opening.totals, checks: opening.checks, balanced: opening.balanced, continuity: opening.continuity,
      noteEn: opening.noteEn, noteFr: opening.noteFr },
    supportingDocuments: documents.rows,
    approvals: approvals.rows,
    retention: retention.rows[0] ?? null,
  };
}

export async function createArchive(db: Db, actor: FinancialYearActor, input: { periodId: string; note?: string | null }) {
  const periodRes = await db.query<any>('SELECT * FROM accounting_periods WHERE id = $1 AND company_id = $2', [input.periodId, actor.companyId]);
  const period = periodRes.rows[0];
  if (!period) throw notFound('PERIOD_NOT_FOUND', 'Accounting period not found');
  if (period.status !== 'closed') throw conflict('ARCHIVE_PERIOD_NOT_CLOSED', 'Only a closed period can be archived');
  const company = await db.query<any>('SELECT name, cabinet_id, functional_currency FROM companies WHERE id = $1', [actor.companyId]);
  const c = company.rows[0]!;
  const versionRes = await db.query<any>('SELECT COALESCE(MAX(version),0)::int AS v FROM fiscal_archives WHERE company_id = $1 AND period_id = $2', [actor.companyId, input.periodId]);
  const version = Number(versionRes.rows[0]!.v) + 1;
  const generatedAt = new Date().toISOString();
  const rawSections = await buildSections(db, actor.companyId, period, c.functional_currency, generatedAt);
  // Round-trip through JSON before hashing so that undefined object keys, which
  // JSONB will omit, cannot make a valid archive fail its own verification.
  const sections = JSON.parse(JSON.stringify(rawSections));
  const sectionManifest = Object.keys(sections).sort().map((name) => {
    const value = sections[name];
    const text = stable(value);
    return { name, sha256: sha(text), sizeBytes: bytes(text) };
  });
  const overall = sha(stable(sectionManifest));
  const manifest = {
    format: 'mauritius-compta-archive/v1',
    version, algorithm: 'sha256', generatedAt,
    company: { id: actor.companyId, name: c.name, functionalCurrency: c.functional_currency },
    period: { id: period.id, name: period.name, startDate: period.start_date, endDate: period.end_date },
    sections: sectionManifest, overall,
    limitationsEn: 'This package is an immutable accounting snapshot with checksums. It is not a legally certified archive and does not contain the underlying scanned documents.',
    limitationsFr: 'Ce paquet est un instantané comptable immuable avec empreintes. Il ne constitue pas une archive légalement certifiée et ne contient pas les documents scannés sous-jacents.',
    documentStorageEn: 'Supporting documents are referenced by name, size and SHA-256; their storage backup is external to this archive.',
    documentStorageFr: 'Les justificatifs sont référencés par nom, taille et SHA-256 ; leur sauvegarde de stockage est externe à cette archive.',
  };
  const retention = await db.query<any>('SELECT retention_months, retention_note, document_backup_note FROM fiscal_year_settings WHERE company_id = $1', [actor.companyId]);
  const settingsRow = retention.rows[0] ?? null;
  const snapshot = { metadata: manifest, sections };
  const snapshotText = JSON.stringify(snapshot);
  const res = await db.query<any>(
    `INSERT INTO fiscal_archives (cabinet_id, company_id, period_id, version, status, manifest, snapshot, checksum, size_bytes, note, retention_months, retention_note, created_by)
     VALUES ($1,$2,$3,$4,'SEALED',$5::jsonb,$6::jsonb,$7,$8,$9,$10,$11,$12) RETURNING id`,
    [c.cabinet_id, actor.companyId, input.periodId, version, JSON.stringify(manifest), snapshotText,
      overall, bytes(snapshotText), input.note ? String(input.note).trim().slice(0, 2000) : null,
      settingsRow?.retention_months ?? null,
      settingsRow?.retention_note ?? (settingsRow?.document_backup_note ?? null), actor.userId],
  );
  await writeAudit(db, { companyId: actor.companyId, userId: actor.userId, action: 'archive.create', entityType: 'fiscal_archive', entityId: res.rows[0].id, details: { periodId: input.periodId, version, checksum: overall, sizeBytes: bytes(snapshotText) }, ip: actor.ip ?? null });
  return getArchive(db, actor.companyId, res.rows[0].id);
}

function manifestView(row: any) {
  const m = row.manifest;
  return { id: row.id, version: row.version, status: row.status, periodId: row.period_id,
    periodName: m.period?.name, periodStart: m.period?.startDate, periodEnd: m.period?.endDate,
    generatedAt: m.generatedAt, checksum: row.checksum, sizeBytes: row.size_bytes, note: row.note,
    retentionMonths: row.retention_months, retentionNote: row.retention_note,
    createdBy: row.created_by, createdAt: row.created_at,
    sectionNames: (m.sections ?? []).map((s: any) => s.name),
    sections: m.sections, overall: m.overall,
    limitationsEn: m.limitationsEn, limitationsFr: m.limitationsFr,
    documentStorageEn: m.documentStorageEn, documentStorageFr: m.documentStorageFr };
}
export async function listArchives(db: Db, companyIdValue: string, periodId?: string) {
  const res = await db.query<any>(`SELECT * FROM fiscal_archives WHERE company_id = $1 AND ($2::uuid IS NULL OR period_id = $2) ORDER BY created_at DESC`, [companyIdValue, periodId ?? null]);
  return res.rows.map(manifestView);
}
export async function getArchive(db: Db, companyIdValue: string, id: string) {
  const res = await db.query<any>('SELECT * FROM fiscal_archives WHERE company_id = $1 AND id = $2', [companyIdValue, id]);
  if (!res.rows[0]) throw notFound('ARCHIVE_NOT_FOUND', 'Annual archive not found');
  return manifestView(res.rows[0]);
}
export async function getArchiveSection(db: Db, companyIdValue: string, id: string, section: string) {
  const res = await db.query<any>('SELECT snapshot FROM fiscal_archives WHERE company_id = $1 AND id = $2', [companyIdValue, id]);
  if (!res.rows[0]) throw notFound('ARCHIVE_NOT_FOUND', 'Annual archive not found');
  const sections = res.rows[0].snapshot.sections ?? {};
  if (!(section in sections)) throw notFound('ARCHIVE_SECTION_NOT_FOUND', 'Archive section not found');
  return { section, data: sections[section] };
}
export async function verifyArchive(db: Db, companyIdValue: string, id: string) {
  const res = await db.query<any>('SELECT * FROM fiscal_archives WHERE company_id = $1 AND id = $2', [companyIdValue, id]);
  const row = res.rows[0];
  if (!row) throw notFound('ARCHIVE_NOT_FOUND', 'Annual archive not found');
  const sections = row.snapshot.sections ?? {};
  const expected = new Map<string, any>((row.manifest.sections ?? []).map((s: any) => [s.name, s]));
  const results = Object.keys(sections).sort().map((name) => {
    const checksum = sha(stable(sections[name]));
    return { name, checksum, expected: expected.get(name)?.sha256 ?? null, ok: checksum === expected.get(name)?.sha256 };
  });
  const manifestSection = Object.keys(sections).sort().map((name) => ({ name, sha256: sha(stable(sections[name])), sizeBytes: bytes(stable(sections[name])) }));
  const overall = sha(stable(manifestSection));
  const allSectionsOk = results.every((r) => r.ok);
  return { archiveId: id, version: row.version, algorithm: 'sha256', sections: results,
    overall, expectedOverall: row.manifest.overall, overallOk: overall === row.manifest.overall,
    ok: allSectionsOk && overall === row.manifest.overall && results.length === expected.size,
    noteEn: 'Verification recomputes hashes from the stored snapshot. It does not prove legal certification.',
    noteFr: 'La vérification recalcule les empreintes depuis l’instantané stocké. Elle ne prouve pas une certification légale.' };
}
export async function exportArchive(db: Db, companyIdValue: string, id: string, format: 'json' | 'zip') {
  const res = await db.query<any>('SELECT * FROM fiscal_archives WHERE company_id = $1 AND id = $2', [companyIdValue, id]);
  const row = res.rows[0];
  if (!row) throw notFound('ARCHIVE_NOT_FOUND', 'Annual archive not found');
  if (format === 'json') {
    const text = JSON.stringify({ manifest: row.manifest, snapshot: row.snapshot }, null, 2);
    return { fileName: `archive-${row.period_id}-v${row.version}.json`, contentType: 'application/json', body: Buffer.from(text, 'utf8') };
  }
  const files: Record<string, Uint8Array> = {};
  files['manifest.json'] = strToU8(JSON.stringify(row.manifest, null, 2));
  for (const [name, section] of Object.entries(row.snapshot.sections ?? {})) files[`sections/${name}.json`] = strToU8(JSON.stringify(section, null, 2));
  files['README.txt'] = strToU8([
    'Mauritius Business Suite — annual archive',
    `Period: ${row.manifest.period?.name ?? row.period_id}`,
    `Version: ${row.version}`,
    `Overall SHA-256: ${row.checksum}`,
    '',
    'This ZIP is an immutable accounting snapshot with checksums. It is not a legally certified archive.',
    'Supporting scanned documents are not included; their storage backup is separate.',
    'Retention is a human policy decision and is not inferred by the software.',
    '',
  ].join('\n'));
  const zipped = zipSync(files, { level: 6 });
  return { fileName: `archive-${row.period_id}-v${row.version}.zip`, contentType: 'application/zip', body: Buffer.from(zipped) };
}
