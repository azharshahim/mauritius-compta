import type { Db } from '../../db/index.js';
import type { Config } from '../../config.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { postEntryTx } from '../../lib/posting.js';
import { provisionCompanyDefaults } from '../../lib/provisioning.js';
import { toCsv } from '../../lib/http.js';
import { SUPPORTED_CURRENCIES } from '../../types.js';
import type { AccountType } from './normalize.js';
import { parseUpload, type ParsedFile, type SheetData, MAX_ROWS } from './parse.js';
import { normalizeHeader } from './normalize.js';
import {
  IMPORT_KINDS,
  SOURCES,
  autoMapping,
  fieldsForKind,
  profileByKey,
  suggestMapping,
  type ImportKind,
  type MigrationSource,
} from './profiles.js';
import {
  buildPreview,
  detectDateConvention,
  type MigrationOptions,
  type PreviewContext,
  type PreviewResult,
  type RefAccount,
  type RefCompany,
  type RefCustomer,
  type RefJournal,
  type RefPeriod,
} from './validate.js';
import { sha256, sha256Bytes } from './hash.js';

/** A parsed row matrix is kept at most `MIGRATION_MAX_ROWS` rows. */
const MAX_STORED_FINDINGS = 400;

export interface MigrationJobRow {
  id: string;
  cabinet_id: string;
  company_id: string | null;
  created_by: string | null;
  source: MigrationSource;
  import_kind: ImportKind;
  status: 'uploaded' | 'analyzed' | 'mapped' | 'previewed' | 'imported' | 'failed' | 'cancelled';
  file_name: string;
  file_size: number;
  file_hash: string;
  sheet_name: string | null;
  encoding: string | null;
  delimiter: string | null;
  row_count: number;
  idempotency_key: string;
  mapping: Record<string, string>;
  account_mapping: Record<string, string>;
  options: MigrationOptions;
  summary: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface UploadRow {
  job_id: string;
  sheets: SheetData[];
  original_text: string | null;
  created_at: string;
  expires_at: string;
}

export interface JobView {
  job: MigrationJobRow;
  sheets: { name: string; headers: string[]; rowCount: number }[];
  sheet: { name: string; headers: string[]; rows: string[][]; truncated: boolean };
  encoding: string | null;
  delimiter: string | null;
  notes: string[];
  suggestions: ReturnType<typeof suggestMapping>;
  fields: ReturnType<typeof fieldsForKind>;
  preview: PreviewResult | null;
  expiresAt: string | null;
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function toJob(row: Record<string, unknown>): MigrationJobRow {
  return row as unknown as MigrationJobRow;
}

async function loadJob(db: Db, jobId: string): Promise<MigrationJobRow> {
  if (!/^[0-9a-f-]{36}$/i.test(jobId)) throw notFound('MIGRATION_JOB_NOT_FOUND', 'Import job not found');
  const res = await db.query('SELECT * FROM migration_jobs WHERE id = $1', [jobId]);
  const row = res.rows[0];
  if (!row) throw notFound('MIGRATION_JOB_NOT_FOUND', 'Import job not found');
  return toJob(row);
}

export async function jobOfCompany(db: Db, jobId: string, companyId: string): Promise<MigrationJobRow> {
  const job = await loadJob(db, jobId);
  if (job.company_id !== companyId) throw notFound('MIGRATION_JOB_NOT_FOUND', 'Import job not found');
  return job;
}

async function loadUpload(db: Db, jobId: string): Promise<UploadRow | null> {
  const res = await db.query('SELECT * FROM migration_uploads WHERE job_id = $1', [jobId]);
  const row = res.rows[0];
  return row ? (row as unknown as UploadRow) : null;
}

function activeSheet(upload: UploadRow, job: MigrationJobRow): SheetData {
  if (upload.sheets.length === 0) {
    throw badRequest('MIGRATION_INVALID_MAPPING', 'The uploaded file has no sheet');
  }
  if (!job.sheet_name) return upload.sheets[0]!;
  const found = upload.sheets.find(
    (s) => normalizeHeader(s.name) === normalizeHeader(job.sheet_name ?? ''),
  );
  if (!found) throw badRequest('MIGRATION_SHEET_NOT_FOUND', `Sheet "${job.sheet_name}" not found`);
  return found;
}

/* -------------------------------------------------------------------------- */
/* Preview                                                                    */
/* -------------------------------------------------------------------------- */

async function loadContext(db: Db, job: MigrationJobRow, sheet: SheetData): Promise<PreviewContext> {
  const companyId = job.company_id;
  if (!companyId) throw badRequest('MIGRATION_INVALID_MAPPING', 'The job has no company');
  const [accounts, journals, periods, customers, companies, company] = await Promise.all([
    db.query<RefAccount>(
      'SELECT id, code, name, type, currency, is_active FROM accounts WHERE company_id = $1 ORDER BY code',
      [companyId],
    ),
    db.query<RefJournal>('SELECT id, code, name FROM journals WHERE company_id = $1', [companyId]),
    db.query<RefPeriod>(
      'SELECT start_date::text, end_date::text, status FROM accounting_periods WHERE company_id = $1',
      [companyId],
    ),
    db.query<RefCustomer>('SELECT id, name, brn FROM billing_customers WHERE company_id = $1', [
      companyId,
    ]),
    db.query<RefCompany>(
      `SELECT c.id, c.name, c.brn FROM companies c
        WHERE c.id = $1
           OR (c.cabinet_id = (SELECT cabinet_id FROM companies WHERE id = $1))
        ORDER BY c.name`,
      [companyId],
    ),
    db.query<{ functional_currency: string }>(
      'SELECT functional_currency FROM companies WHERE id = $1',
      [companyId],
    ),
  ]);

  const sample = sheet.rows.slice(0, 200).map((row) => row.join(' '));
  const dateColumnIndex = job.mapping.entryDate
    ? sheet.headers.indexOf(job.mapping.entryDate)
    : -1;
  const samples =
    dateColumnIndex >= 0
      ? sheet.rows.slice(0, 200).map((r) => r[dateColumnIndex] ?? '')
      : sample;

  const imported = await db.query<{ external_key: string; content_hash: string }>(
    `SELECT external_key, content_hash FROM migration_records
      WHERE company_id = $1 AND source = $2 AND entity_type IN ('entry', 'account')`,
    [companyId, job.source],
  );

  let hasOpeningEntry = false;
  if (job.import_kind === 'opening_balance') {
    const res = await db.query(
      `SELECT 1 FROM journal_entries WHERE company_id = $1 AND source = 'migration_opening' LIMIT 1`,
      [companyId],
    );
    hasOpeningEntry = (res.rowCount ?? 0) > 0;
  }

  return {
    kind: job.import_kind,
    mapping: job.mapping,
    accountMapping: job.account_mapping,
    options: {
      ...job.options,
      dateDayFirst:
        job.options.dateDayFirst === undefined
          ? detectDateConvention(samples)
          : job.options.dateDayFirst,
    },
    accounts: accounts.rows,
    journals: journals.rows,
    periods: periods.rows,
    customers: customers.rows,
    companies: companies.rows,
    functionalCurrency: company.rows[0]?.functional_currency ?? 'MUR',
    supportedCurrencies: SUPPORTED_CURRENCIES,
    hasOpeningEntry,
    importedFingerprints: new Set(imported.rows.map((r) => r.external_key)),
  };
}

export async function computePreview(db: Db, job: MigrationJobRow): Promise<PreviewResult | null> {
  const upload = await loadUpload(db, job.id);
  if (!upload) return null;
  const sheet = activeSheet(upload, job);
  const ctx = await loadContext(db, job, sheet);
  return buildPreview(sheet.headers, sheet.rows, ctx);
}

/* -------------------------------------------------------------------------- */
/* Jobs                                                                       */
/* -------------------------------------------------------------------------- */

export interface CreateJobInput {
  source: MigrationSource;
  importKind: ImportKind;
  fileName: string;
  contentBase64?: string | null;
  contentText?: string | null;
  sheetName?: string | null;
  mapping?: Record<string, string>;
  options?: MigrationOptions;
}

export function decodeContent(input: CreateJobInput, maxBytes: number): Uint8Array {
  let bytes: Uint8Array;
  if (input.contentText !== undefined && input.contentText !== null) {
    bytes = new TextEncoder().encode(input.contentText);
  } else if (input.contentBase64) {
    const cleaned = input.contentBase64.replace(/^data:[^;]+;base64,/, '').replace(/\s+/g, '');
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(cleaned)) {
      throw badRequest('MIGRATION_IMPORT_FAILED', 'Invalid base64 payload');
    }
    bytes = Uint8Array.from(Buffer.from(cleaned, 'base64'));
  } else {
    throw badRequest('MIGRATION_IMPORT_FAILED', 'No file content was provided');
  }
  if (bytes.length === 0) throw badRequest('MIGRATION_IMPORT_FAILED', 'The file is empty');
  if (bytes.length > maxBytes) {
    throw badRequest('MIGRATION_FILE_TOO_LARGE', `The file exceeds ${maxBytes} bytes`);
  }
  return bytes;
}

export async function purgeExpiredUploads(db: Db): Promise<number> {
  const res = await db.query(
    'DELETE FROM migration_uploads WHERE expires_at < now() RETURNING job_id',
  );
  return res.rowCount ?? 0;
}

export async function createJob(
  db: Db,
  config: Config,
  actor: { userId: string; cabinetId: string; companyId: string },
  input: CreateJobInput,
): Promise<JobView> {
  if (!SOURCES.includes(input.source)) throw badRequest('MIGRATION_IMPORT_FAILED', 'Unknown source');
  if (!IMPORT_KINDS.includes(input.importKind)) {
    throw badRequest('MIGRATION_IMPORT_FAILED', 'Unknown import kind');
  }
  const fileName = input.fileName.trim().slice(0, 200);
  if (!fileName) throw badRequest('MIGRATION_FILE_TOO_LARGE', 'A file name is required');
  const bytes = decodeContent(input, Math.min(config.MAX_UPLOAD_BYTES, 8 * 1024 * 1024));
  const fileHash = sha256Bytes(bytes);

  let parsed: ParsedFile;
  try {
    parsed = parseUpload(fileName, bytes);
  } catch (err) {
    const code = (err as { code?: string }).code;
    const message = (err as Error).message;
    if (code === 'TOO_MANY_ROWS') throw badRequest('MIGRATION_TOO_MANY_ROWS', message);
    if (code === 'UNSUPPORTED_FORMAT') throw badRequest('UNSUPPORTED_FORMAT', message);
    throw badRequest('MIGRATION_IMPORT_FAILED', message);
  }
  if (parsed.truncated) {
    throw badRequest(
      'MIGRATION_TOO_MANY_ROWS',
      `Too many rows: the limit is ${MAX_ROWS} rows per file. Split the export.`,
    );
  }
  const limit = Math.min(config.MIGRATION_MAX_ROWS, MAX_ROWS);
  const tooBig = parsed.sheets.some((s) => s.rows.length > limit);
  if (tooBig) {
    throw badRequest(
      'MIGRATION_TOO_MANY_ROWS',
      `Too many rows: the limit is ${limit} rows per import. Split the export.`,
    );
  }

  const sheet =
    (input.sheetName
      ? parsed.sheets.find((s) => normalizeHeader(s.name) === normalizeHeader(input.sheetName!))
      : parsed.sheets[0]) ?? parsed.sheets[0]!;
  if (!sheet) throw badRequest('MIGRATION_SHEET_NOT_FOUND', 'No sheet found');

  const suggestions = suggestMapping(sheet.headers, input.importKind, input.source);
  const mapping = input.mapping ?? autoMapping(suggestions);
  const options: MigrationOptions = {
    dateDayFirst: detectDateConvention(
      mapping.entryDate
        ? sheet.rows.slice(0, 200).map((r) => r[sheet.headers.indexOf(mapping.entryDate!)] ?? '')
        : [],
    ),
    defaultJournalCode: 'OD',
    ...input.options,
  };
  const idempotencyKey = sha256([
    actor.cabinetId,
    actor.companyId,
    input.importKind,
    input.source,
    fileHash,
  ]);
  const expiresAt = new Date(Date.now() + config.MIGRATION_RETENTION_DAYS * 86_400_000);

  await purgeExpiredUploads(db);

  const jobId = await db.transaction(async (tx) => {
    const inserted = await tx.query<{ id: string }>(
      `INSERT INTO migration_jobs
         (cabinet_id, company_id, created_by, source, import_kind, status, file_name, file_size,
          file_hash, sheet_name, encoding, delimiter, row_count, idempotency_key, mapping,
          account_mapping, options)
       VALUES ($1,$2,$3,$4,$5,'analyzed',$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15::jsonb,$16::jsonb)
       RETURNING id`,
      [
        actor.cabinetId,
        actor.companyId,
        actor.userId,
        input.source,
        input.importKind,
        fileName,
        bytes.length,
        fileHash,
        sheet.name,
        parsed.encoding,
        parsed.delimiter,
        sheet.rows.length,
        idempotencyKey,
        JSON.stringify(mapping),
        JSON.stringify({}),
        JSON.stringify(options),
      ],
    );
    const id = inserted.rows[0]!.id;
    await tx.query(
      `INSERT INTO migration_uploads (job_id, sheets, original_text, expires_at)
       VALUES ($1, $2::jsonb, NULL, $3)`,
      [id, JSON.stringify(parsed.sheets), expiresAt],
    );
    await tx.query(
      `INSERT INTO migration_events (job_id, company_id, actor_id, action, details)
       VALUES ($1, $2, $3, 'job.created', $4::jsonb)`,
      [
        id,
        actor.companyId,
        actor.userId,
        JSON.stringify({
          source: input.source,
          kind: input.importKind,
          fileName,
          bytes: bytes.length,
          sheets: parsed.sheets.length,
          rows: sheet.rows.length,
          format: parsed.format,
          encoding: parsed.encoding,
        }),
      ],
    );
    return id;
  });

  const job = await loadJob(db, jobId);
  const notes = [...parsed.notes];
  if (parsed.sheets.length > 1) {
    notes.push(`${parsed.sheets.length} sheets detected: ${parsed.sheets.map((s) => s.name).join(', ')}.`);
  }
  await savePreview(db, job, notes);
  return getJobView(db, jobId);
}

export async function savePreview(db: Db, job: MigrationJobRow, notes: string[] = []): Promise<PreviewResult | null> {
  const preview = await computePreview(db, job);
  if (!preview) return null;
  const keep = preview.findings.slice(0, MAX_STORED_FINDINGS);
  await db.transaction(async (tx) => {
    await tx.query('DELETE FROM migration_findings WHERE job_id = $1', [job.id]);
    for (const f of keep) {
      await tx.query(
        `INSERT INTO migration_findings (job_id, company_id, severity, code, row_number, message, details)
         VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)`,
        [
          job.id,
          job.company_id,
          f.severity,
          f.code,
          f.rowNumber,
          f.message,
          JSON.stringify(f.details ?? {}),
        ],
      );
    }
    await tx.query(
      `UPDATE migration_jobs
          SET summary = $2::jsonb,
              status = CASE
                WHEN status = 'imported' THEN status
                WHEN $3 THEN 'mapped'
                ELSE 'previewed'
              END,
              updated_at = now()
        WHERE id = $1`,
      [
        job.id,
        JSON.stringify({
          ...preview.summary,
          totals: preview.totals,
          blocksImport: preview.blocksImport,
          notes,
        }),
        preview.blocksImport,
      ],
    );
  });
  return preview;
}

export async function getJobView(db: Db, jobId: string): Promise<JobView> {
  const job = await loadJob(db, jobId);
  const upload = await loadUpload(db, job.id);
  if (!upload) {
    return {
      job,
      sheets: [],
      sheet: { name: '', headers: [], rows: [], truncated: false },
      encoding: job.encoding,
      delimiter: job.delimiter,
      notes: ['The parsed content has expired or was purged. Upload the file again.'],
      suggestions: {},
      fields: fieldsForKind(job.import_kind),
      preview: null,
      expiresAt: null,
    };
  }
  const sheet = activeSheet(upload, job);
  const preview = await computePreview(db, job);
  const summary = (job.summary ?? {}) as { notes?: string[] };
  const profile = profileByKey(job.source) ?? profileByKey('generic_excel');
  return {
    job,
    sheets: upload.sheets.map((s) => ({
      name: s.name,
      headers: s.headers,
      rowCount: s.rows.length,
    })),
    sheet: {
      name: sheet.name,
      headers: sheet.headers,
      rows: sheet.rows.slice(0, 10),
      truncated: sheet.rows.length > 10,
    },
    encoding: job.encoding,
    delimiter: job.delimiter,
    notes: summary.notes ?? (profile ? [profile.notesFr] : []),
    suggestions: suggestMapping(sheet.headers, job.import_kind, job.source),
    fields: fieldsForKind(job.import_kind),
    preview,
    expiresAt: upload.expires_at,
  };
}

export async function listJobs(db: Db, companyId: string): Promise<MigrationJobRow[]> {
  const res = await db.query(
    `SELECT * FROM migration_jobs WHERE company_id = $1 ORDER BY created_at DESC LIMIT 100`,
    [companyId],
  );
  return res.rows.map(toJob);
}

export interface UpdateJobInput {
  mapping?: Record<string, string | null>;
  accountMapping?: Record<string, string | null>;
  options?: MigrationOptions;
  sheetName?: string;
}

export async function updateJob(
  db: Db,
  actor: { userId: string; companyId: string },
  jobId: string,
  input: UpdateJobInput,
): Promise<JobView> {
  const job = await jobOfCompany(db, jobId, actor.companyId);
  if (job.status === 'imported') {
    throw conflict('MIGRATION_ALREADY_IMPORTED', 'An imported job cannot be remapped');
  }
  const upload = await loadUpload(db, job.id);
  if (!upload) throw conflict('MIGRATION_JOB_NOT_FOUND', 'The parsed file has expired, upload it again');

  const knownFields = new Set(fieldsForKind(job.import_kind).map((f) => f.key));
  const mapping: Record<string, string> = { ...job.mapping };
  for (const [field, column] of Object.entries(input.mapping ?? {})) {
    if (!knownFields.has(field)) {
      throw badRequest('MIGRATION_INVALID_MAPPING', `Unknown target field: ${field}`);
    }
    if (column === null || column === '') delete mapping[field];
    else mapping[field] = column;
  }
  const headers = new Set<string>();
  for (const sheet of upload.sheets) sheet.headers.forEach((h) => headers.add(h));
  for (const [field, column] of Object.entries(mapping)) {
    if (!headers.has(column)) {
      throw badRequest('MIGRATION_INVALID_MAPPING', `Column "${column}" for "${field}" does not exist`);
    }
  }

  const accountMapping: Record<string, string> = { ...job.account_mapping };
  for (const [from, to] of Object.entries(input.accountMapping ?? {})) {
    if (!from.trim()) continue;
    if (to === null || to === '') delete accountMapping[from];
    else accountMapping[from] = to.trim();
  }
  if (Object.keys(accountMapping).length > 500) {
    throw badRequest('MIGRATION_INVALID_MAPPING', 'Too many account mappings (max 500)');
  }

  const sheetName = input.sheetName ?? job.sheet_name;
  const nextSheet = upload.sheets.find(
    (s) => normalizeHeader(s.name) === normalizeHeader(sheetName ?? ''),
  );
  if (!nextSheet) throw badRequest('MIGRATION_SHEET_NOT_FOUND', `Sheet "${sheetName}" not found`);

  const updated = await db.transaction(async (tx) => {
    const res = await tx.query<MigrationJobRow>(
      `UPDATE migration_jobs
          SET mapping = $2::jsonb,
              account_mapping = $3::jsonb,
              options = $4::jsonb,
              sheet_name = $5,
              status = 'mapped',
              updated_at = now()
        WHERE id = $1
        RETURNING *`,
      [
        job.id,
        JSON.stringify(mapping),
        JSON.stringify(accountMapping),
        JSON.stringify({ ...job.options, ...(input.options ?? {}) }),
        nextSheet.name,
      ],
    );
    await tx.query(
      `INSERT INTO migration_events (job_id, company_id, actor_id, action, details)
       VALUES ($1, $2, $3, 'job.mapping_updated', $4::jsonb)`,
      [job.id, job.company_id, actor.userId, JSON.stringify({ mapping, accountMapping })],
    );
    return res.rows[0]!;
  });

  await savePreview(db, updated);
  return getJobView(db, jobId);
}

export async function cancelJob(db: Db, actor: { userId: string; companyId: string }, jobId: string): Promise<void> {
  const job = await jobOfCompany(db, jobId, actor.companyId);
  if (job.status === 'imported') {
    throw conflict('MIGRATION_ALREADY_IMPORTED', 'An imported job cannot be cancelled');
  }
  await db.transaction(async (tx) => {
    await tx.query(
      `UPDATE migration_jobs SET status = 'cancelled', updated_at = now() WHERE id = $1`,
      [job.id],
    );
    await tx.query(
      `INSERT INTO migration_events (job_id, company_id, actor_id, action) VALUES ($1,$2,$3,'job.cancelled')`,
      [job.id, job.company_id, actor.userId],
    );
  });
}

/** Deletes the job and its parsed content; accounting data is never touched. */
export async function deleteJob(db: Db, actor: { userId: string; companyId: string }, jobId: string): Promise<void> {
  const job = await jobOfCompany(db, jobId, actor.companyId);
  await db.transaction(async (tx) => {
    await tx.query('DELETE FROM migration_uploads WHERE job_id = $1', [job.id]);
    await tx.query('DELETE FROM migration_findings WHERE job_id = $1', [job.id]);
    await tx.query(
      `INSERT INTO migration_events (job_id, company_id, actor_id, action, details)
       VALUES ($1,$2,$3,'job.purged',$4::jsonb)`,
      [job.id, job.company_id, actor.userId, JSON.stringify({ reason: 'manual' })],
    );
    await tx.query(
      `UPDATE migration_jobs SET status = 'cancelled', row_count = 0, updated_at = now() WHERE id = $1`,
      [job.id],
    );
  });
}

/* -------------------------------------------------------------------------- */
/* Idempotency ledger                                                         */
/* -------------------------------------------------------------------------- */

type ClaimResult = 'new' | 'same' | 'changed';

interface ClaimArgs {
  cabinetId: string;
  companyId: string;
  jobId: string;
  source: string;
  entityType: 'account' | 'entry' | 'customer' | 'company';
  externalKey: string;
  contentHash: string;
  entityId: string | null;
}

async function claimRecord(tx: Db, args: ClaimArgs): Promise<ClaimResult> {
  const prior = await tx.query<{ content_hash: string }>(
    `SELECT content_hash FROM migration_records
      WHERE cabinet_id = $1 AND company_id = $2 AND source = $3 AND entity_type = $4
        AND external_key = $5
      ORDER BY created_at DESC LIMIT 1`,
    [args.cabinetId, args.companyId, args.source, args.entityType, args.externalKey],
  );
  const existing = prior.rows[0];
  if (existing) return existing.content_hash === args.contentHash ? 'same' : 'changed';
  const inserted = await tx.query(
    `INSERT INTO migration_records
       (cabinet_id, company_id, job_id, source, entity_type, external_key, content_hash, entity_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [
      args.cabinetId,
      args.companyId,
      args.jobId,
      args.source,
      args.entityType,
      args.externalKey,
      args.contentHash,
      args.entityId,
    ],
  );
  return (inserted.rowCount ?? 0) > 0 ? 'new' : 'same';
}

/* -------------------------------------------------------------------------- */
/* Import                                                                     */
/* -------------------------------------------------------------------------- */

export interface ImportReport {
  jobId: string;
  importKind: ImportKind;
  source: MigrationSource;
  fileName: string;
  importedAt: string;
  companyId: string;
  idempotencyKey: string;
  counts: {
    created: number;
    skipped: number;
    conflicts: number;
    accounts: number;
    entries: number;
    entryLines: number;
    customers: number;
    companies: number;
    findings: number;
  };
  totals: { debit: string; credit: string; difference: string } | null;
  conflicts: { externalKey: string; rowNumber: number | null; message: string }[];
  createdSamples: string[];
  openingEntryId?: string;
}

interface ImportAccumulator {
  created: number;
  skipped: number;
  conflicts: number;
  accounts: number;
  entries: number;
  entryLines: number;
  customers: number;
  companies: number;
  conflictsList: { externalKey: string; rowNumber: number | null; message: string }[];
  createdSamples: string[];
  openingEntryId?: string;
}

function emptyAcc(): ImportAccumulator {
  return {
    created: 0,
    skipped: 0,
    conflicts: 0,
    accounts: 0,
    entries: 0,
    entryLines: 0,
    customers: 0,
    companies: 0,
    conflictsList: [],
    createdSamples: [],
  };
}

const CONFLICT_MESSAGE =
  'La source a changé depuis le premier import : la ligne est conservée telle quelle, jamais écrasée. / The source changed since the first import: the row is kept as is, never overwritten.';

export async function importJob(
  db: Db,
  actor: { userId: string; companyId: string; cabinetId: string; ip?: string | null },
  jobId: string,
): Promise<ImportReport> {
  const job = await jobOfCompany(db, jobId, actor.companyId);
  if (job.status === 'imported') {
    const existing = await db.query<{ report: ImportReport }>(
      `SELECT report FROM migration_batches WHERE job_id = $1 AND status = 'imported'
        ORDER BY finished_at DESC LIMIT 1`,
      [job.id],
    );
    if (existing.rows[0]) return existing.rows[0].report;
  }

  try {
    return await db.transaction(async (tx) => {
      const upload = await loadUpload(tx, job.id);
      if (!upload) throw conflict('MIGRATION_JOB_NOT_FOUND', 'The parsed file expired, upload it again');
      const sheet = activeSheet(upload, job);
      const ctx = await loadContext(tx, job, sheet);
      const preview = buildPreview(sheet.headers, sheet.rows, ctx);

      // The preview is recomputed server-side: the client cannot skip a control.
      if (preview.missingRequiredColumns.length > 0 || preview.blocksImport) {
        throw badRequest('MIGRATION_BLOCKED', 'The import is blocked by validation errors', {
          summary: preview.summary,
          errors: preview.findings.filter((f) => f.severity === 'error').slice(0, 50),
        });
      }

      const acc = emptyAcc();
      const base = {
        cabinetId: actor.cabinetId,
        companyId: actor.companyId,
        jobId: job.id,
        source: job.source,
      };

      if (job.import_kind === 'chart_of_accounts') {
        await importChart(tx, base, preview, acc);
      } else if (job.import_kind === 'opening_balance') {
        await importOpening(tx, base, job, preview, actor, acc);
      } else if (job.import_kind === 'journal_entries') {
        await importEntries(tx, base, preview, actor, acc);
      } else if (job.import_kind === 'customers') {
        await importCustomers(tx, { ...base, userId: actor.userId }, preview, acc);
      } else {
        await importCompanies(tx, base, preview, actor, acc);
      }

      const finishedAt = new Date().toISOString();
      const report: ImportReport = {
        jobId: job.id,
        importKind: job.import_kind,
        source: job.source,
        fileName: job.file_name,
        importedAt: finishedAt,
        companyId: actor.companyId,
        idempotencyKey: job.idempotency_key,
        counts: {
          created: acc.created,
          skipped: acc.skipped,
          conflicts: acc.conflicts,
          accounts: acc.accounts,
          entries: acc.entries,
          entryLines: acc.entryLines,
          customers: acc.customers,
          companies: acc.companies,
          findings: preview.findings.length,
        },
        totals: preview.totals,
        conflicts: acc.conflictsList.slice(0, 50),
        createdSamples: acc.createdSamples.slice(0, 50),
        ...(acc.openingEntryId ? { openingEntryId: acc.openingEntryId } : {}),
      };

      await tx.query(
        `INSERT INTO migration_batches
           (job_id, company_id, status, created_count, skipped_count, error_count, report, finished_at)
         VALUES ($1,$2,'imported',$3,$4,$5,$6::jsonb,$7)`,
        [
          job.id,
          actor.companyId,
          acc.created,
          acc.skipped,
          acc.conflicts,
          JSON.stringify(report),
          finishedAt,
        ],
      );
      await tx.query(
        `UPDATE migration_jobs
            SET status = 'imported', summary = $2::jsonb, updated_at = now()
          WHERE id = $1`,
        [
          job.id,
          JSON.stringify({
            importedAt: finishedAt,
            counts: report.counts,
            totals: report.totals,
          }),
        ],
      );
      await tx.query(
        `INSERT INTO migration_events (job_id, company_id, actor_id, action, details)
         VALUES ($1,$2,$3,'job.imported',$4::jsonb)`,
        [job.id, actor.companyId, actor.userId, JSON.stringify(report.counts)],
      );
      return report;
    });
  } catch (err) {
    await db.query(
      `UPDATE migration_jobs SET status = 'failed', updated_at = now() WHERE id = $1`,
      [job.id],
    );
    await db.query(
      `INSERT INTO migration_events (job_id, company_id, actor_id, action, details)
       VALUES ($1,$2,$3,'job.failed',$4::jsonb)`,
      [
        job.id,
        actor.companyId,
        actor.userId,
        JSON.stringify({ error: (err as { code?: string }).code ?? 'ERROR' }),
      ],
    );
    throw err;
  }
}

interface BaseArgs {
  cabinetId: string;
  companyId: string;
  jobId: string;
  source: string;
}

async function importChart(
  tx: Db,
  base: BaseArgs,
  preview: PreviewResult,
  acc: ImportAccumulator,
): Promise<void> {
  const rows = (preview.rows.chart ?? []).filter((r) => r.action === 'create');
  for (const row of rows) {
    const contentHash = sha256([
      'account',
      row.name,
      row.type,
      row.currency,
      row.isActive,
      row.description,
    ]);
    const externalKey = `account:${row.code.trim().toLowerCase()}`;
    const claim = await claimRecord(tx, {
      ...base,
      entityType: 'account',
      externalKey,
      contentHash,
      entityId: null,
    });
    if (claim === 'changed') {
      acc.conflicts += 1;
      acc.conflictsList.push({ externalKey, rowNumber: row.rowNumber, message: CONFLICT_MESSAGE });
      continue;
    }
    if (claim === 'same') {
      acc.skipped += 1;
      continue;
    }
    if (!row.type) {
      throw badRequest('MIGRATION_BLOCKED', `Account ${row.code} has no type`);
    }
    const inserted = await tx.query<{ id: string }>(
      `INSERT INTO accounts (company_id, code, name, type, currency, is_active, description)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [
        base.companyId,
        row.code,
        row.name,
        row.type,
        row.currency,
        row.isActive,
        row.description ?? 'Imported from a migration / Importé par migration',
      ],
    );
    const id = inserted.rows[0]?.id;
    if (!id) {
      acc.skipped += 1;
      continue;
    }
    await tx.query(
      `UPDATE migration_records SET entity_id = $1
        WHERE cabinet_id = $2 AND company_id = $3 AND source = $4
          AND entity_type = 'account' AND external_key = $5 AND entity_id IS NULL`,
      [id, base.cabinetId, base.companyId, base.source, externalKey],
    );
    acc.created += 1;
    acc.accounts += 1;
    if (acc.createdSamples.length < 50) acc.createdSamples.push(`Compte ${row.code} — ${row.name}`);
  }
}

async function findJournalId(tx: Db, companyId: string, code: string): Promise<{ id: string; code: string }> {
  const res = await tx.query<{ id: string; code: string }>(
    'SELECT id, code FROM journals WHERE company_id = $1',
    [companyId],
  );
  const found = res.rows.find((j) => normalizeHeader(j.code) === normalizeHeader(code));
  if (!found) throw badRequest('JOURNAL_NOT_FOUND', `Journal ${code} does not exist`);
  return found;
}

function postingLines(rows: { resolvedAccountId: string | null; debit: string; credit: string; description: string | null }[]) {
  const lines = [];
  for (const row of rows) {
    if (!row.resolvedAccountId) continue;
    const debit = BigInt(row.debit.replace('.', ''));
    const credit = BigInt(row.credit.replace('.', ''));
    if (debit > 0n) {
      lines.push({ accountId: row.resolvedAccountId, description: row.description, debit: row.debit, credit: null });
    } else if (credit > 0n) {
      lines.push({ accountId: row.resolvedAccountId, description: row.description, debit: null, credit: row.credit });
    }
  }
  return lines;
}

async function importOpening(
  tx: Db,
  base: BaseArgs,
  job: MigrationJobRow,
  preview: PreviewResult,
  actor: { userId: string; ip?: string | null },
  acc: ImportAccumulator,
): Promise<void> {
  const rows = (preview.rows.opening ?? []).filter((r) => r.action === 'create' && r.resolvedAccountId);
  if (rows.length === 0) return;
  const openingDate = job.options.openingDate!;
  const journal = await findJournalId(tx, base.companyId, job.options.defaultJournalCode ?? 'OD');

  let newLines = 0;
  for (const row of rows) {
    const contentHash = sha256(['opening', row.debit, row.credit]);
    const externalKey = `opening:${(row.resolvedCode ?? row.accountCode).trim().toLowerCase()}`;
    const claim = await claimRecord(tx, {
      ...base,
      entityType: 'entry',
      externalKey,
      contentHash,
      entityId: null,
    });
    if (claim === 'same') acc.skipped += 1;
    else if (claim === 'changed') {
      acc.conflicts += 1;
      acc.conflictsList.push({ externalKey, rowNumber: row.rowNumber, message: CONFLICT_MESSAGE });
    } else newLines += 1;
  }
  if (newLines === 0) return;
  if (newLines !== rows.length) {
    throw conflict(
      'MIGRATION_IMPORT_FAILED',
      'Only part of the opening balance was already imported; the batch is blocked, never blended.',
    );
  }

  const totals = preview.totals!;
  const result = await postEntryTx(tx, {
    companyId: base.companyId,
    userId: actor.userId,
    journalId: journal.id,
    entryDate: openingDate,
    description: 'Reprise des soldes d’ouverture / Opening balance carry-forward',
    reference: `MIG-OPENING-${openingDate}`,
    lines: postingLines(rows),
    source: 'migration_opening',
  });
  acc.created += 1;
  acc.entries += 1;
  acc.entryLines += result.entry ? rows.length : 0;
  acc.openingEntryId = result.entry.id;
  if (acc.createdSamples.length < 50) {
    acc.createdSamples.push(
      `Balance d'ouverture ${openingDate} — débit ${totals.debit} / crédit ${totals.credit}`,
    );
  }
}

async function importEntries(
  tx: Db,
  base: BaseArgs,
  preview: PreviewResult,
  actor: { userId: string; ip?: string | null },
  acc: ImportAccumulator,
): Promise<void> {
  for (const group of preview.rows.entries ?? []) {
    if (group.action !== 'create') {
      if (group.action === 'skip') acc.skipped += 1;
      continue;
    }
    const externalKey = `entry:${group.key}`;
    const claim = await claimRecord(tx, {
      ...base,
      entityType: 'entry',
      externalKey,
      contentHash: sha256([group.fingerprint]),
      entityId: null,
    });
    if (claim === 'same') {
      acc.skipped += 1;
      continue;
    }
    if (claim === 'changed') {
      acc.conflicts += 1;
      acc.conflictsList.push({ externalKey, rowNumber: group.lines[0]?.rowNumber ?? null, message: CONFLICT_MESSAGE });
      continue;
    }
    if (!group.entryDate || !group.journalId) {
      throw badRequest('MIGRATION_BLOCKED', `Entry ${group.key} is incomplete`);
    }
    const result = await postEntryTx(tx, {
      companyId: base.companyId,
      userId: actor.userId,
      journalId: group.journalId,
      entryDate: group.entryDate,
      description: group.description,
      reference: group.reference,
      currency: group.currency,
      exchangeRate: group.exchangeRate,
      lines: postingLines(
        group.lines.map((l) => ({
          resolvedAccountId: l.resolvedAccountId,
          debit: l.debit,
          credit: l.credit,
          description: l.description,
        })),
      ),
      source: 'migration',
    });
    await tx.query(
      `UPDATE migration_records SET entity_id = $1
        WHERE cabinet_id = $2 AND company_id = $3 AND source = $4
          AND entity_type = 'entry' AND external_key = $5 AND entity_id IS NULL`,
      [result.entry.id, base.cabinetId, base.companyId, base.source, externalKey],
    );
    acc.created += 1;
    acc.entries += 1;
    acc.entryLines += group.lines.length;
    if (acc.createdSamples.length < 50) {
      acc.createdSamples.push(
        `Écriture ${group.key} ${group.entryDate} — ${group.journalCode} ${group.debitTotal}`,
      );
    }
  }
}

async function importCustomers(
  tx: Db,
  base: BaseArgs & { userId: string },
  preview: PreviewResult,
  acc: ImportAccumulator,
): Promise<void> {
  for (const row of (preview.rows.customers ?? []).filter((r) => r.action === 'create')) {
    const externalKey = `customer:${normalizeHeader(row.name)}`;
    const contentHash = sha256([
      'customer',
      row.name,
      row.legalName,
      row.brn,
      row.vatNumber,
      row.email,
      row.phone,
      row.addressLine1,
      row.city,
      row.postcode,
      row.country,
      row.paymentTermsDays,
    ]);
    const claim = await claimRecord(tx, {
      ...base,
      entityType: 'customer',
      externalKey,
      contentHash,
      entityId: null,
    });
    if (claim === 'same') {
      acc.skipped += 1;
      continue;
    }
    if (claim === 'changed') {
      acc.conflicts += 1;
      acc.conflictsList.push({ externalKey, rowNumber: row.rowNumber, message: CONFLICT_MESSAGE });
      continue;
    }
    const inserted = await tx.query<{ id: string }>(
      `INSERT INTO billing_customers
         (company_id, name, legal_name, brn, vat_number, address_line1, city, postcode,
          country, contact_email, contact_phone, payment_terms_days, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING id`,
      [
        base.companyId,
        row.name,
        row.legalName,
        row.brn,
        row.vatNumber,
        row.addressLine1,
        row.city,
        row.postcode,
        row.country,
        row.email,
        row.phone,
        row.paymentTermsDays,
        base.userId,
      ],
    );
    await tx.query(
      `UPDATE migration_records SET entity_id = $1
        WHERE cabinet_id = $2 AND company_id = $3 AND source = $4
          AND entity_type = 'customer' AND external_key = $5 AND entity_id IS NULL`,
      [inserted.rows[0]!.id, base.cabinetId, base.companyId, base.source, externalKey],
    );
    acc.created += 1;
    acc.customers += 1;
    if (acc.createdSamples.length < 50) acc.createdSamples.push(`Client ${row.name}`);
  }
}

async function importCompanies(
  tx: Db,
  base: BaseArgs,
  preview: PreviewResult,
  actor: { userId: string },
  acc: ImportAccumulator,
): Promise<void> {
  for (const row of (preview.rows.companies ?? []).filter((r) => r.action === 'create')) {
    const externalKey = `company:${(row.brn ?? normalizeHeader(row.name)).trim().toLowerCase()}`;
    const contentHash = sha256([
      'company',
      row.name,
      row.brn,
      row.crn,
      row.vatNumber,
      row.currency,
      row.financialYearStart,
      row.financialYearEnd,
    ]);
    const claim = await claimRecord(tx, {
      ...base,
      entityType: 'company',
      externalKey,
      contentHash,
      entityId: null,
    });
    if (claim === 'same') {
      acc.skipped += 1;
      continue;
    }
    if (claim === 'changed') {
      acc.conflicts += 1;
      acc.conflictsList.push({ externalKey, rowNumber: row.rowNumber, message: CONFLICT_MESSAGE });
      continue;
    }
    const inserted = await tx.query<{ id: string }>(
      `INSERT INTO companies
         (name, brn, crn, vat_number, registered_address, business_activity,
          financial_year_start, financial_year_end, functional_currency, presentation_currency,
          created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9,$10)
       RETURNING id`,
      [
        row.name,
        row.brn,
        row.crn,
        row.vatNumber,
        row.registeredAddress,
        row.businessActivity,
        row.financialYearStart,
        row.financialYearEnd,
        row.currency,
        actor.userId,
      ],
    );
    const companyId = inserted.rows[0]!.id;
    await tx.query(
      `INSERT INTO company_members (company_id, user_id, role) VALUES ($1,$2,'owner')`,
      [companyId, actor.userId],
    );
    // The created company belongs to the cabinet that initiated the import,
    // not to the personal cabinet of the operator.
    await tx.query('UPDATE companies SET cabinet_id = $1 WHERE id = $2', [
      base.cabinetId,
      companyId,
    ]);
    // No demonstration chart: an imported company starts with its own file.
    await provisionCompanyDefaults(
      tx,
      {
        id: companyId,
        name: row.name,
        financial_year_start: row.financialYearStart,
        financial_year_end: row.financialYearEnd,
        functional_currency: row.currency,
      },
      'fr',
      { withChart: false },
    );
    await tx.query(
      `UPDATE migration_records SET entity_id = $2
        WHERE cabinet_id = $3 AND company_id = $4 AND source = $5
          AND entity_type = 'company' AND external_key = $1`,
      [externalKey, companyId, base.cabinetId, base.companyId, base.source],
    );
    acc.created += 1;
    acc.companies += 1;
    if (acc.createdSamples.length < 50) acc.createdSamples.push(`Société ${row.name}`);
  }
}

/* -------------------------------------------------------------------------- */
/* Templates                                                                  */
/* -------------------------------------------------------------------------- */

export interface TemplateRow {
  id: string;
  name: string;
  import_kind: ImportKind;
  source: MigrationSource;
  mapping: Record<string, string>;
  account_mapping: Record<string, string>;
  options: MigrationOptions;
  created_at: string;
}

export async function listTemplates(db: Db, cabinetId: string): Promise<TemplateRow[]> {
  const res = await db.query(
    'SELECT * FROM migration_templates WHERE cabinet_id = $1 ORDER BY import_kind, name',
    [cabinetId],
  );
  return res.rows as unknown as TemplateRow[];
}

export async function saveTemplate(
  db: Db,
  actor: { userId: string; cabinetId: string },
  input: {
    id?: string | null;
    name: string;
    importKind: ImportKind;
    source: MigrationSource;
    mapping: Record<string, string>;
    accountMapping: Record<string, string>;
    options: MigrationOptions;
  },
): Promise<TemplateRow> {
  if (Object.keys(input.mapping).length > 100) {
    throw badRequest('MIGRATION_INVALID_MAPPING', 'Too many mapped columns');
  }
  try {
    const res = await db.query<TemplateRow>(
      `INSERT INTO migration_templates
         (cabinet_id, name, import_kind, source, mapping, account_mapping, options, created_by)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb,$8)
       ON CONFLICT (cabinet_id, import_kind, lower(btrim(name))) DO UPDATE
         SET mapping = EXCLUDED.mapping,
             account_mapping = EXCLUDED.account_mapping,
             options = EXCLUDED.options,
             source = EXCLUDED.source,
             updated_at = now()
       RETURNING *`,
      [
        actor.cabinetId,
        input.name.trim().slice(0, 120),
        input.importKind,
        input.source,
        JSON.stringify(input.mapping),
        JSON.stringify(input.accountMapping),
        JSON.stringify(input.options),
        actor.userId,
      ],
    );
    return res.rows[0]!;
  } catch (err) {
    if ((err as { code?: string }).code === '23505') {
      throw conflict('MIGRATION_TEMPLATE_EXISTS', 'A template with this name already exists');
    }
    throw err;
  }
}

export async function deleteTemplate(db: Db, cabinetId: string, templateId: string): Promise<void> {
  const res = await db.query(
    'DELETE FROM migration_templates WHERE id = $1 AND cabinet_id = $2 RETURNING id',
    [templateId, cabinetId],
  );
  if ((res.rowCount ?? 0) === 0) throw notFound('MIGRATION_TEMPLATE_NOT_FOUND', 'Template not found');
}

/* -------------------------------------------------------------------------- */
/* Report export                                                              */
/* -------------------------------------------------------------------------- */

export async function reportCsv(db: Db, job: MigrationJobRow): Promise<string> {
  const res = await db.query<{ report: ImportReport }>(
    `SELECT report FROM migration_batches WHERE job_id = $1 AND status = 'imported'
      ORDER BY finished_at DESC LIMIT 1`,
    [job.id],
  );
  const report = res.rows[0]?.report;
  const rows: (string | number | null)[][] = [
    ['Rapport d’importation / Import report'],
    ['Champ', 'Valeur'],
    ['Job', job.id],
    ['Fichier / File', job.file_name],
    ['Source', job.source],
    ['Type', job.import_kind],
    ['Statut / Status', job.status],
    ['Société / Company', job.company_id],
    ['Clé d’idempotence', job.idempotency_key],
  ];
  if (report) {
    rows.push(['Date / Date', report.importedAt]);
    rows.push(['Créés / Created', report.counts.created]);
    rows.push(['Ignorés / Skipped', report.counts.skipped]);
    rows.push(['Conflits / Conflicts', report.counts.conflicts]);
    rows.push(['Comptes / Accounts', report.counts.accounts]);
    rows.push(['Écritures / Entries', report.counts.entries]);
    rows.push(['Lignes / Lines', report.counts.entryLines]);
    rows.push(['Clients / Customers', report.counts.customers]);
    rows.push(['Sociétés / Companies', report.counts.companies]);
    if (report.totals) {
      rows.push(['Total débit', report.totals.debit]);
      rows.push(['Total crédit', report.totals.credit]);
      rows.push(['Écart', report.totals.difference]);
    }
    rows.push([]);
    rows.push(['Détail / Detail']);
    for (const line of report.createdSamples) rows.push(['Créé', line]);
    for (const c of report.conflicts) rows.push(['Conflit', c.message]);
  } else {
    rows.push(['Rapport', 'Aucun import validé pour ce lot / No validated import for this job']);
  }
  return toCsv(rows);
}

/** Account type helper used by the wizard to seed the default type option. */
export const ACCOUNT_TYPE_OPTIONS: AccountType[] = ['asset', 'liability', 'equity', 'revenue', 'expense'];
