/**
 * Demonstration engine of the migration assistant.
 *
 * It reuses the **exact same pure modules as the API**: the file parser
 * (`parseUpload`: CSV/TSV/XLSX, encodings, delimiters, Excel serials) and the
 * deterministic validation engine (`buildPreview`: amounts, dates, balance per
 * entry, duplicate detection, account correspondence). Only the persistence
 * differs: here the "database" is the demo state in localStorage, and the
 * simulated import writes into the same demo collections the other screens
 * already read. No request leaves the browser, nothing is stored on a server.
 */
import type {
  DemoAccount,
  DemoBillingCustomer,
  DemoCompany,
  DemoEntry,
  DemoJournal,
  DemoLine,
  DemoMember,
  DemoPeriod,
  DemoState,
  DemoUser,
} from './runtime';
import { DEMO_SEED } from './seed-data';
import {
  parseUpload,
  MigrationParseError,
  type SheetData,
} from '../../../api/src/modules/migration/parse';
import {
  autoMapping,
  fieldsForKind,
  suggestMapping,
  type ImportKind,
  type MigrationSource,
} from '../../../api/src/modules/migration/profiles';
import {
  buildPreview,
  detectDateConvention,
  type MigrationOptions,
  type PreviewContext,
  type PreviewResult,
} from '../../../api/src/modules/migration/validate';

export const DEMO_MIGRATION_LIMITS = {
  maxBytes: 5 * 1024 * 1024,
  maxRows: 5_000,
  retentionDays: 30,
} as const;

export interface DemoMigrationJob {
  id: string;
  company_id: string;
  created_by: string;
  source: MigrationSource;
  import_kind: ImportKind;
  status: 'analyzed' | 'mapped' | 'previewed' | 'imported' | 'failed' | 'cancelled';
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
  sheets: SheetData[];
  notes: string[];
  report: DemoImportReport | null;
  created_at: string;
  updated_at: string;
  expires_at: string;
}

export interface DemoMigrationTemplate {
  id: string;
  name: string;
  import_kind: ImportKind;
  source: MigrationSource;
  mapping: Record<string, string>;
  account_mapping: Record<string, string>;
  options: MigrationOptions;
  created_at: string;
}

export interface DemoMigrationRecord {
  id: string;
  company_id: string;
  source: string;
  entity_type: 'account' | 'entry' | 'customer' | 'company';
  external_key: string;
  content_hash: string;
  entity_id: string | null;
  created_at: string;
}

export interface DemoImportReport {
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
  demo: true;
}

export interface DemoJobView {
  job: DemoMigrationJob;
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

/* ------------------------------------------------------------------ helpers */

const uid = () => crypto.randomUUID();
const now = () => new Date().toISOString();

/** FNV-1a 64-bit-ish digest, demonstration only (the API uses SHA-256). */
function digest(parts: (string | number | boolean | null | undefined)[]): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  const text = parts.map((p) => (p === null || p === undefined ? '' : String(p))).join('\u0001');
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619) >>> 0;
    h2 = Math.imul(h2 ^ c, 2246822519) >>> 0;
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}

function activeSheet(job: DemoMigrationJob): SheetData {
  const found = job.sheets.find(
    (s) => (s.name ?? '').toLowerCase() === (job.sheet_name ?? '').toLowerCase(),
  );
  return found ?? job.sheets[0] ?? { name: '', headers: [], rows: [] };
}

function migrationContext(state: DemoState, companyId: string, job: DemoMigrationJob): PreviewContext {
  const company = state.companies.find((c) => c.id === companyId)!;
  const accounts = state.accounts.filter((a) => a.company_id === companyId);
  const journals = state.journals.filter((j) => j.company_id === companyId);
  const periods = state.periods.filter((p) => p.company_id === companyId);
  const customers = state.billingCustomers.filter((c) => c.company_id === companyId);
  const sheet = activeSheet(job);
  const dateColumn = job.mapping.entryDate ? sheet.headers.indexOf(job.mapping.entryDate) : -1;
  const samples =
    dateColumn >= 0
      ? sheet.rows.slice(0, 200).map((r) => r[dateColumn] ?? '')
      : sheet.rows.slice(0, 200).map((r) => r.join(' '));

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
    accounts,
    journals,
    periods,
    customers,
    companies: state.companies.map((c) => ({ id: c.id, name: c.name, brn: c.brn })),
    functionalCurrency: company.functional_currency,
    supportedCurrencies: ['MUR', 'EUR', 'USD', 'GBP'],
    hasOpeningEntry: state.entries.some(
      (e) => e.company_id === companyId && e.source === 'migration_opening',
    ),
    importedFingerprints: new Set(
      state.migrationRecords
        .filter((r) => r.company_id === companyId && r.source === job.source)
        .map((r) => r.external_key),
    ),
  };
}

export function previewOf(state: DemoState, job: DemoMigrationJob): PreviewResult {
  const sheet = activeSheet(job);
  return buildPreview(sheet.headers, sheet.rows, migrationContext(state, job.company_id, job));
}

export function demoJobView(state: DemoState, companyId: string, jobId: string): DemoJobView {
  const job = state.migrationJobs.find((j) => j.id === jobId && j.company_id === companyId);
  if (!job) throw new Error('MIGRATION_JOB_NOT_FOUND');
  const sheet = activeSheet(job);
  const preview = job.sheets.length ? previewOf(state, job) : null;
  return {
    job,
    sheets: job.sheets.map((s) => ({ name: s.name, headers: s.headers, rowCount: s.rows.length })),
    sheet: {
      name: sheet.name,
      headers: sheet.headers,
      rows: sheet.rows.slice(0, 10),
      truncated: sheet.rows.length > 10,
    },
    encoding: job.encoding,
    delimiter: job.delimiter,
    notes: job.notes,
    suggestions: suggestMapping(sheet.headers, job.import_kind, job.source),
    fields: fieldsForKind(job.import_kind),
    preview,
    expiresAt: job.expires_at,
  };
}

/* ----------------------------------------------------------------- creation */

export interface CreateDemoJobInput {
  source: MigrationSource;
  importKind: ImportKind;
  fileName: string;
  contentBase64?: string;
  contentText?: string;
  sheetName?: string | null;
  mapping?: Record<string, string>;
  options?: MigrationOptions;
}

function decode(input: CreateDemoJobInput): Uint8Array {
  if (input.contentText !== undefined && input.contentText !== null) {
    return new TextEncoder().encode(input.contentText);
  }
  if (input.contentBase64) {
    const cleaned = input.contentBase64.replace(/^data:[^;]+;base64,/, '').replace(/\s+/g, '');
    const binary = atob(cleaned);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }
  throw new Error('MIGRATION_EMPTY');
}

export function createDemoJob(
  state: DemoState,
  user: DemoUser,
  companyId: string,
  input: CreateDemoJobInput,
): DemoJobView {
  const bytes = decode(input);
  if (bytes.length === 0) throw new Error('MIGRATION_EMPTY');
  if (bytes.length > DEMO_MIGRATION_LIMITS.maxBytes) throw new Error('MIGRATION_FILE_TOO_LARGE');

  let parsed;
  try {
    parsed = parseUpload(input.fileName, bytes);
  } catch (err) {
    if (err instanceof MigrationParseError) throw new Error(err.code);
    throw err;
  }
  if (parsed.truncated || parsed.sheets.some((s) => s.rows.length > DEMO_MIGRATION_LIMITS.maxRows)) {
    throw new Error('MIGRATION_TOO_MANY_ROWS');
  }

  const sheet =
    parsed.sheets.find(
      (s) => (s.name ?? '').toLowerCase() === (input.sheetName ?? '').toLowerCase(),
    ) ?? parsed.sheets[0]!;

  const suggestions = suggestMapping(sheet.headers, input.importKind, input.source);
  const mapping = input.mapping ?? autoMapping(suggestions);
  const dateColumn = mapping.entryDate ? sheet.headers.indexOf(mapping.entryDate) : -1;
  const options: MigrationOptions = {
    dateDayFirst: detectDateConvention(
      dateColumn >= 0 ? sheet.rows.slice(0, 200).map((r) => r[dateColumn] ?? '') : [],
    ),
    defaultJournalCode: 'OD',
    ...input.options,
  };

  // Parsed uploads are purged after the retention window, like the API does.
  const cutoff = Date.now() - DEMO_MIGRATION_LIMITS.retentionDays * 86_400_000;
  state.migrationJobs = state.migrationJobs.filter((j) => Date.parse(j.created_at) > cutoff);

  const job: DemoMigrationJob = {
    id: uid(),
    company_id: companyId,
    created_by: user.id,
    source: input.source,
    import_kind: input.importKind,
    status: 'analyzed',
    file_name: input.fileName.slice(0, 200),
    file_size: bytes.length,
    file_hash: digest([
      bytes.length,
      Array.from(bytes.slice(0, 64)).join(','),
      Array.from(bytes.slice(-64)).join(','),
    ]),
    sheet_name: sheet.name,
    encoding: parsed.encoding,
    delimiter: parsed.delimiter,
    row_count: sheet.rows.length,
    idempotency_key: digest([
      companyId,
      input.importKind,
      input.source,
      bytes.length,
      Array.from(bytes.slice(0, 256)).join(','),
    ]),
    mapping,
    account_mapping: {},
    options,
    summary: {},
    sheets: parsed.sheets,
    notes: parsed.notes,
    report: null,
    created_at: now(),
    updated_at: now(),
    expires_at: new Date(Date.now() + DEMO_MIGRATION_LIMITS.retentionDays * 86_400_000).toISOString(),
  };
  state.migrationJobs.unshift(job);
  const preview = previewOf(state, job);
  job.summary = { ...preview.summary, totals: preview.totals, blocksImport: preview.blocksImport };
  job.status = preview.blocksImport ? 'mapped' : 'previewed';
  return demoJobView(state, companyId, job.id);
}

export interface UpdateDemoJobInput {
  mapping?: Record<string, string | null>;
  accountMapping?: Record<string, string | null>;
  options?: MigrationOptions;
  sheetName?: string;
}

export function updateDemoJob(
  state: DemoState,
  companyId: string,
  jobId: string,
  input: UpdateDemoJobInput,
): DemoJobView {
  const job = state.migrationJobs.find((j) => j.id === jobId && j.company_id === companyId);
  if (!job) throw new Error('MIGRATION_JOB_NOT_FOUND');
  if (job.status === 'imported') throw new Error('MIGRATION_ALREADY_IMPORTED');
  if (job.sheets.length === 0) throw new Error('MIGRATION_JOB_NOT_FOUND');

  const known = new Set(fieldsForKind(job.import_kind).map((f) => f.key));
  for (const [field, column] of Object.entries(input.mapping ?? {})) {
    if (!known.has(field)) throw new Error('MIGRATION_INVALID_MAPPING');
    if (column === null || column === '') delete job.mapping[field];
    else job.mapping[field] = column;
  }
  const headers = new Set(job.sheets.flatMap((s) => s.headers));
  for (const column of Object.values(job.mapping)) {
    if (!headers.has(column)) throw new Error('MIGRATION_INVALID_MAPPING');
  }
  for (const [from, to] of Object.entries(input.accountMapping ?? {})) {
    if (!from.trim()) continue;
    if (to === null || to === '') delete job.account_mapping[from];
    else job.account_mapping[from] = to.trim();
  }
  if (input.sheetName) {
    const sheet = job.sheets.find((s) => s.name.toLowerCase() === input.sheetName!.toLowerCase());
    if (!sheet) throw new Error('MIGRATION_SHEET_NOT_FOUND');
    job.sheet_name = sheet.name;
  }
  job.options = { ...job.options, ...(input.options ?? {}) };
  const preview = previewOf(state, job);
  job.summary = { ...preview.summary, totals: preview.totals, blocksImport: preview.blocksImport };
  job.status = preview.blocksImport ? 'mapped' : 'previewed';
  job.updated_at = now();
  return demoJobView(state, companyId, jobId);
}

export function cancelDemoJob(state: DemoState, companyId: string, jobId: string): void {
  const job = state.migrationJobs.find((j) => j.id === jobId && j.company_id === companyId);
  if (!job) throw new Error('MIGRATION_JOB_NOT_FOUND');
  if (job.status === 'imported') throw new Error('MIGRATION_ALREADY_IMPORTED');
  job.status = 'cancelled';
  job.sheets = [];
  job.updated_at = now();
}

export function deleteDemoJob(state: DemoState, companyId: string, jobId: string): void {
  const job = state.migrationJobs.find((j) => j.id === jobId && j.company_id === companyId);
  if (!job) throw new Error('MIGRATION_JOB_NOT_FOUND');
  job.sheets = [];
  job.status = 'cancelled';
  job.row_count = 0;
  job.updated_at = now();
}

/* ---------------------------------------------------------------- templates */

export function saveDemoTemplate(
  state: DemoState,
  input: {
    name: string;
    importKind: ImportKind;
    source: MigrationSource;
    mapping: Record<string, string>;
    accountMapping?: Record<string, string>;
    options?: MigrationOptions;
  },
): DemoMigrationTemplate {
  const existing = state.migrationTemplates.find(
    (t) => t.name.toLowerCase() === input.name.trim().toLowerCase() && t.import_kind === input.importKind,
  );
  if (existing) {
    existing.mapping = input.mapping;
    existing.account_mapping = input.accountMapping ?? {};
    existing.options = input.options ?? {};
    existing.source = input.source;
    return existing;
  }
  const template: DemoMigrationTemplate = {
    id: uid(),
    name: input.name.trim().slice(0, 120),
    import_kind: input.importKind,
    source: input.source,
    mapping: input.mapping,
    account_mapping: input.accountMapping ?? {},
    options: input.options ?? {},
    created_at: now(),
  };
  state.migrationTemplates.push(template);
  return template;
}

export function deleteDemoTemplate(state: DemoState, templateId: string): void {
  const before = state.migrationTemplates.length;
  state.migrationTemplates = state.migrationTemplates.filter((t) => t.id !== templateId);
  if (state.migrationTemplates.length === before) throw new Error('MIGRATION_TEMPLATE_NOT_FOUND');
}

/* ------------------------------------------------------------------- import */

type Claim = 'new' | 'same' | 'changed';

function claim(
  state: DemoState,
  base: { companyId: string; source: string },
  entityType: DemoMigrationRecord['entity_type'],
  externalKey: string,
  contentHash: string,
): Claim {
  const prior = state.migrationRecords.find(
    (r) =>
      r.company_id === base.companyId &&
      r.source === base.source &&
      r.entity_type === entityType &&
      r.external_key === externalKey,
  );
  if (prior) return prior.content_hash === contentHash ? 'same' : 'changed';
  state.migrationRecords.push({
    id: uid(),
    company_id: base.companyId,
    source: base.source,
    entity_type: entityType,
    external_key: externalKey,
    content_hash: contentHash,
    entity_id: null,
    created_at: now(),
  });
  return 'new';
}

function linkRecord(
  state: DemoState,
  companyId: string,
  source: string,
  entityType: DemoMigrationRecord['entity_type'],
  externalKey: string,
  entityId: string,
): void {
  const record = state.migrationRecords.find(
    (r) =>
      r.company_id === companyId &&
      r.source === source &&
      r.entity_type === entityType &&
      r.external_key === externalKey,
  );
  if (record) record.entity_id = entityId;
}

function nextEntryNo(state: DemoState, journalCode: string, entryDate: string): string {
  const year = entryDate.slice(0, 4);
  const key = `${journalCode}-${year}`;
  const next = (state.sequences[key] ?? 0) + 1;
  state.sequences[key] = next;
  return `${journalCode}-${year}-${String(next).padStart(4, '0')}`;
}

function pushEntry(
  state: DemoState,
  companyId: string,
  params: {
    journal: DemoJournal;
    entryDate: string;
    reference: string | null;
    description: string;
    currency: string;
    exchangeRate: string | null;
    source: DemoEntry['source'];
    lines: { accountId: string; description: string | null; debit: string; credit: string }[];
  },
): DemoEntry {
  const entry: DemoEntry = {
    id: uid(),
    company_id: companyId,
    journal_id: params.journal.id,
    entry_no: nextEntryNo(state, params.journal.code, params.entryDate),
    entry_date: params.entryDate,
    reference: params.reference,
    description: params.description,
    currency: params.currency,
    exchange_rate: params.exchangeRate ?? '1',
    status: 'posted',
    source: params.source,
    reversal_of_entry_id: null,
    posted_at: now(),
    created_at: now(),
  };
  state.entries.push(entry);
  params.lines.forEach((line, index) => {
    const row: DemoLine = {
      id: uid(),
      entry_id: entry.id,
      company_id: companyId,
      account_id: line.accountId,
      line_no: index + 1,
      description: line.description,
      debit: line.debit,
      credit: line.credit,
      txn_amount: line.debit !== '0.0000' ? line.debit : line.credit,
      txn_currency: params.currency,
      fx_rate: params.exchangeRate ?? '1',
    };
    state.lines.push(row);
  });
  return entry;
}

export function importDemoJob(
  state: DemoState,
  user: DemoUser,
  companyId: string,
  jobId: string,
): DemoImportReport {
  const job = state.migrationJobs.find((j) => j.id === jobId && j.company_id === companyId);
  if (!job) throw new Error('MIGRATION_JOB_NOT_FOUND');
  if (job.status === 'imported' && job.report) return job.report;

  const preview = previewOf(state, job);
  if (preview.blocksImport) throw new Error('MIGRATION_BLOCKED');

  const base = { companyId, source: job.source };
  const report: DemoImportReport = {
    jobId: job.id,
    importKind: job.import_kind,
    source: job.source,
    fileName: job.file_name,
    importedAt: now(),
    companyId,
    idempotencyKey: job.idempotency_key,
    counts: {
      created: 0,
      skipped: 0,
      conflicts: 0,
      accounts: 0,
      entries: 0,
      entryLines: 0,
      customers: 0,
      companies: 0,
      findings: preview.findings.length,
    },
    totals: preview.totals,
    conflicts: [],
    createdSamples: [],
    demo: true,
  };
  const conflictMessage =
    'La source a changé depuis le premier import : la ligne est conservée telle quelle. / The source changed: the row is kept as is.';

  const accountsOfCompany = () =>
    state.accounts.filter((a) => a.company_id === companyId);
  const journalByCode = (code: string) =>
    state.journals.find(
      (j) => j.company_id === companyId && j.code.toUpperCase() === code.toUpperCase(),
    );

  if (job.import_kind === 'chart_of_accounts') {
    for (const row of (preview.rows.chart ?? []).filter((r) => r.action === 'create')) {
      const externalKey = `account:${row.code.trim().toLowerCase()}`;
      const hash = digest(['account', row.name, row.type, row.currency, row.isActive, row.description]);
      const result = claim(state, base, 'account', externalKey, hash);
      if (result === 'same') {
        report.counts.skipped += 1;
        continue;
      }
      if (result === 'changed') {
        report.counts.conflicts += 1;
        report.conflicts.push({ externalKey, rowNumber: row.rowNumber, message: conflictMessage });
        continue;
      }
      if (accountsOfCompany().some((a) => a.code.toLowerCase() === row.code.toLowerCase())) {
        report.counts.skipped += 1;
        continue;
      }
      const account: DemoAccount = {
        id: uid(),
        company_id: companyId,
        code: row.code,
        name: row.name,
        type: row.type ?? 'asset',
        parent_id: null,
        currency: row.currency,
        is_active: row.isActive,
        fs_mapping: null,
        description: row.description ?? 'Importé par migration / Imported by migration',
      };
      state.accounts.push(account);
      linkRecord(state, companyId, job.source, 'account', externalKey, account.id);
      report.counts.created += 1;
      report.counts.accounts += 1;
      if (report.createdSamples.length < 50) report.createdSamples.push(`Compte ${row.code} — ${row.name}`);
    }
  } else if (job.import_kind === 'opening_balance') {
    const journal = journalByCode(job.options.defaultJournalCode ?? 'OD');
    if (!journal) throw new Error('JOURNAL_NOT_FOUND');
    const rows = (preview.rows.opening ?? []).filter((r) => r.action === 'create' && r.resolvedAccountId);
    let newLines = 0;
    for (const row of rows) {
      const externalKey = `opening:${(row.resolvedCode ?? row.accountCode).trim().toLowerCase()}`;
      const result = claim(state, base, 'entry', externalKey, digest(['opening', row.debit, row.credit]));
      if (result === 'same') report.counts.skipped += 1;
      else if (result === 'changed') {
        report.counts.conflicts += 1;
        report.conflicts.push({ externalKey, rowNumber: row.rowNumber, message: conflictMessage });
      } else newLines += 1;
    }
    if (newLines > 0) {
      if (newLines !== rows.length) throw new Error('MIGRATION_IMPORT_FAILED');
      const entry = pushEntry(state, companyId, {
        journal,
        entryDate: job.options.openingDate!,
        reference: `MIG-OPENING-${job.options.openingDate}`,
        description: 'Reprise des soldes d’ouverture / Opening balance carry-forward',
        currency: 'MUR',
        exchangeRate: null,
        source: 'migration_opening',
        lines: rows.map((r) => ({
          accountId: r.resolvedAccountId!,
          description: r.description,
          debit: r.debit,
          credit: r.credit,
        })),
      });
      for (const row of rows) {
        const externalKey = `opening:${(row.resolvedCode ?? row.accountCode).trim().toLowerCase()}`;
        linkRecord(state, companyId, job.source, 'entry', externalKey, entry.id);
      }
      report.counts.created += 1;
      report.counts.entries += 1;
      report.counts.entryLines += rows.length;
      report.createdSamples.push(
        `Balance d'ouverture ${job.options.openingDate} — ${preview.totals?.debit ?? ''}`,
      );
    }
  } else if (job.import_kind === 'journal_entries') {
    for (const group of preview.rows.entries ?? []) {
      if (group.action !== 'create') {
        if (group.action === 'skip') report.counts.skipped += 1;
        continue;
      }
      const externalKey = `entry:${group.key}`;
      const result = claim(state, base, 'entry', externalKey, digest([group.fingerprint]));
      if (result === 'same') {
        report.counts.skipped += 1;
        continue;
      }
      if (result === 'changed') {
        report.counts.conflicts += 1;
        report.conflicts.push({
          externalKey,
          rowNumber: group.lines[0]?.rowNumber ?? null,
          message: conflictMessage,
        });
        continue;
      }
      const journal = state.journals.find((j) => j.id === group.journalId);
      if (!journal || !group.entryDate) throw new Error('MIGRATION_BLOCKED');
      const entry = pushEntry(state, companyId, {
        journal,
        entryDate: group.entryDate,
        reference: group.reference,
        description: group.description,
        currency: group.currency,
        exchangeRate: group.exchangeRate,
        source: 'migration',
        lines: group.lines
          .filter((l) => l.resolvedAccountId)
          .map((l) => ({
            accountId: l.resolvedAccountId!,
            description: l.description,
            debit: l.debit,
            credit: l.credit,
          })),
      });
      linkRecord(state, companyId, job.source, 'entry', externalKey, entry.id);
      report.counts.created += 1;
      report.counts.entries += 1;
      report.counts.entryLines += group.lines.length;
      if (report.createdSamples.length < 50) {
        report.createdSamples.push(`Écriture ${group.key} ${group.entryDate} — ${group.debitTotal}`);
      }
    }
  } else if (job.import_kind === 'customers') {
    for (const row of (preview.rows.customers ?? []).filter((r) => r.action === 'create')) {
      const externalKey = `customer:${row.name.trim().toLowerCase()}`;
      const hash = digest([
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
      const result = claim(state, base, 'customer', externalKey, hash);
      if (result === 'same') {
        report.counts.skipped += 1;
        continue;
      }
      if (result === 'changed') {
        report.counts.conflicts += 1;
        report.conflicts.push({ externalKey, rowNumber: row.rowNumber, message: conflictMessage });
        continue;
      }
      if (
        state.billingCustomers.some(
          (c) => c.company_id === companyId && c.name.trim().toLowerCase() === row.name.trim().toLowerCase(),
        )
      ) {
        report.counts.skipped += 1;
        continue;
      }
      const customer: DemoBillingCustomer = {
        id: uid(),
        company_id: companyId,
        name: row.name,
        legal_name: row.legalName,
        brn: row.brn,
        vat_number: row.vatNumber,
        address_line1: row.addressLine1,
        city: row.city,
        postcode: row.postcode,
        country: row.country,
        contact_name: null,
        contact_email: row.email,
        contact_phone: row.phone,
        preferred_currency: null,
        payment_terms_days: row.paymentTermsDays,
        receivable_account_id: null,
        notes: 'Importé par migration (démonstration) / Imported by migration (demo)',
        is_active: true,
        archived_at: null,
        created_at: now(),
      };
      state.billingCustomers.push(customer);
      linkRecord(state, companyId, job.source, 'customer', externalKey, customer.id);
      report.counts.created += 1;
      report.counts.customers += 1;
      if (report.createdSamples.length < 50) report.createdSamples.push(`Client ${row.name}`);
    }
  } else {
    for (const row of (preview.rows.companies ?? []).filter((r) => r.action === 'create')) {
      const externalKey = `company:${(row.brn ?? row.name).trim().toLowerCase()}`;
      const hash = digest([
        'company',
        row.name,
        row.brn,
        row.crn,
        row.vatNumber,
        row.currency,
        row.financialYearStart,
        row.financialYearEnd,
      ]);
      const result = claim(state, base, 'company', externalKey, hash);
      if (result === 'same') {
        report.counts.skipped += 1;
        continue;
      }
      if (result === 'changed') {
        report.counts.conflicts += 1;
        report.conflicts.push({ externalKey, rowNumber: row.rowNumber, message: conflictMessage });
        continue;
      }
      const company: DemoCompany = {
        id: uid(),
        name: row.name,
        brn: row.brn,
        crn: row.crn,
        client_code: null,
        dossier_manager_id: null,
        archived_at: null,
        vat_number: row.vatNumber,
        registered_address: row.registeredAddress,
        business_activity: row.businessActivity,
        financial_year_start: row.financialYearStart,
        financial_year_end: row.financialYearEnd,
        functional_currency: row.currency,
        presentation_currency: row.currency,
        accounting_standard: 'IFRS',
        status: 'active',
        locale: user.locale,
        created_at: now(),
      };
      state.companies.push(company);
      const member: DemoMember = {
        id: uid(),
        company_id: company.id,
        user_id: user.id,
        role: 'owner',
        email: user.email,
        full_name: user.full_name,
      };
      state.members.push(member);
      const period: DemoPeriod = {
        id: uid(),
        company_id: company.id,
        name: `FY ${row.financialYearStart.slice(0, 4)}`,
        start_date: row.financialYearStart,
        end_date: row.financialYearEnd,
        status: 'open',
      };
      state.periods.push(period);
      for (const template of DEMO_SEED.journals) {
        state.journals.push({
          id: uid(),
          company_id: company.id,
          code: template.code,
          name: template.name,
          type: template.type,
          is_active: true,
        });
      }
      linkRecord(state, companyId, job.source, 'company', externalKey, company.id);
      report.counts.created += 1;
      report.counts.companies += 1;
      if (report.createdSamples.length < 50) report.createdSamples.push(`Société ${row.name}`);
    }
  }

  job.status = 'imported';
  job.report = report;
  job.summary = { importedAt: report.importedAt, counts: report.counts, totals: report.totals };
  job.updated_at = now();
  return report;
}
