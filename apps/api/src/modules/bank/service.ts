import type { Db } from '../../db/index.js';
import type { Config } from '../../config.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { formatAmount, parseAmount } from '../../lib/money.js';
import { postEntryTx } from '../../lib/posting.js';
import { toCsv } from '../../lib/http.js';
import { cabinetOfCompany } from '../../lib/cabinets.js';
import { parseUpload, type ParsedFile, type SheetData } from '../migration/parse.js';
import { sha256, sha256Bytes } from '../migration/hash.js';
import { autoBankMapping, suggestBankMapping, type BankColumnSuggestion, type BankFieldKey } from './profiles.js';
import { buildBankPreview, type BankPreview } from './engine.js';
import { billingPaymentCandidates, transactionAllocatedAmount } from './billing.js';
import {
  findInternalTransfer,
  suggestAccount,
  suggestMatches,
  type AccountSuggestion,
  type LedgerBankLine,
  type MatchSuggestion,
  type SuggestionAccount,
  type SuggestionRule,
} from './reconcile.js';

export const MAX_BANK_ACCOUNTS = 20;
const MAX_PREVIEW_FINDINGS = 400;

export interface BankAccountRow {
  id: string;
  cabinet_id: string;
  company_id: string;
  name: string;
  bank_name: string;
  currency: string;
  account_id: string;
  masked_reference: string | null;
  is_active: boolean;
  created_at: string;
  account_code?: string;
  account_name?: string;
  transaction_count?: number;
  unmatched_count?: number;
}

interface CompanyBankContext {
  cabinetId: string;
  companyCurrency: string;
  account: BankAccountRow;
}

export async function cabinetForCompany(db: Db, companyId: string): Promise<string> {
  const cabinetId = await cabinetOfCompany(db, companyId);
  if (!cabinetId) throw badRequest('BANK_COMPANY_NOT_IN_CABINET', 'This company is not attached to a cabinet');
  return cabinetId;
}

export async function bankAccountOfCompany(
  db: Db,
  companyId: string,
  bankAccountId: string,
): Promise<BankAccountRow> {
  const res = await db.query<BankAccountRow>(
    `SELECT b.*, a.code AS account_code, a.name AS account_name
       FROM bank_accounts b JOIN accounts a ON a.id = b.account_id
      WHERE b.id = $1 AND b.company_id = $2`,
    [bankAccountId, companyId],
  );
  const row = res.rows[0];
  if (!row) throw notFound('BANK_ACCOUNT_NOT_FOUND', 'Bank account not found');
  return row;
}

/** Masked reference helper: only the last four characters are ever stored. */
export function maskReference(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleaned = raw.replace(/\s+/g, '');
  if (!cleaned) return null;
  return `•••• ${cleaned.slice(-4)}`;
}

export async function listBankAccounts(db: Db, companyId: string): Promise<BankAccountRow[]> {
  const res = await db.query<BankAccountRow>(
    `SELECT b.*, a.code AS account_code, a.name AS account_name,
            (SELECT count(*)::int FROM bank_transactions t WHERE t.bank_account_id = b.id) AS transaction_count,
            (SELECT count(*)::int FROM bank_transactions t
              WHERE t.bank_account_id = b.id AND t.status IN ('unmatched', 'review', 'proposed')) AS unmatched_count
       FROM bank_accounts b JOIN accounts a ON a.id = b.account_id
      WHERE b.company_id = $1
      ORDER BY b.is_active DESC, b.name`,
    [companyId],
  );
  return res.rows;
}

export async function createBankAccount(
  db: Db,
  actor: { userId: string; companyId: string },
  input: {
    name: string;
    bankName: string;
    currency: string;
    accountId: string;
    maskedReference?: string | null;
  },
): Promise<BankAccountRow> {
  const cabinetId = await cabinetForCompany(db, actor.companyId);
  const account = await db.query<{ id: string; is_active: boolean; type: string }>(
    'SELECT id, is_active, type FROM accounts WHERE id = $1 AND company_id = $2',
    [input.accountId, actor.companyId],
  );
  const chart = account.rows[0];
  if (!chart) throw badRequest('BANK_CHART_ACCOUNT_NOT_FOUND', 'The chart account does not exist in this company');
  if (!chart.is_active) throw badRequest('BANK_CHART_ACCOUNT_INACTIVE', 'The chart account is inactive');
  if (chart.type !== 'asset') throw badRequest('BANK_CHART_ACCOUNT_NOT_ASSET', 'A bank account must be linked to an asset account');
  if (!/^[A-Z]{3}$/.test(input.currency)) throw badRequest('BANK_INVALID_CURRENCY', 'Invalid currency');
  const count = await db.query<{ count: number }>(
    'SELECT count(*)::int AS count FROM bank_accounts WHERE company_id = $1',
    [actor.companyId],
  );
  if ((count.rows[0]?.count ?? 0) >= MAX_BANK_ACCOUNTS) {
    throw badRequest('BANK_TOO_MANY_ACCOUNTS', `At most ${MAX_BANK_ACCOUNTS} bank accounts per company`);
  }
  try {
    const res = await db.query<BankAccountRow>(
      `INSERT INTO bank_accounts
         (cabinet_id, company_id, name, bank_name, currency, account_id, masked_reference, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING *`,
      [
        cabinetId,
        actor.companyId,
        input.name.trim().slice(0, 120),
        input.bankName.trim().slice(0, 120),
        input.currency,
        input.accountId,
        maskReference(input.maskedReference),
        actor.userId,
      ],
    );
    const created = res.rows[0]!;
    await event(db, actor, 'bank_account', created.id, 'account.created', {
      currency: created.currency,
    });
    return created;
  } catch (error) {
    if ((error as { code?: string }).code === '23505') {
      throw conflict('BANK_ACCOUNT_EXISTS', 'A bank account with this name already exists');
    }
    throw error;
  }
}

async function event(
  db: Db,
  actor: { userId: string; companyId: string; cabinetId?: string; ip?: string },
  entity: string,
  entityId: string | null,
  name: string,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  const cabinetId = actor.cabinetId ?? (await cabinetForCompany(db, actor.companyId));
  await db.query(
    `INSERT INTO bank_events (cabinet_id, company_id, entity, entity_id, event, actor_id, ip, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
    [cabinetId, actor.companyId, entity, entityId, name, actor.userId, actor.ip ?? null, JSON.stringify(metadata)],
  );
}

function decodeContent(input: BankUploadInput, maxBytes: number): Uint8Array {
  if (input.contentBase64) {
    const bytes = Buffer.from(input.contentBase64, 'base64');
    if (bytes.length > maxBytes) throw badRequest('BANK_FILE_TOO_LARGE', `The file exceeds ${maxBytes} bytes`);
    return bytes;
  }
  if (input.contentText !== undefined) {
    const bytes = Buffer.from(input.contentText, 'utf8');
    if (bytes.length > maxBytes) throw badRequest('BANK_FILE_TOO_LARGE', `The file exceeds ${maxBytes} bytes`);
    return bytes;
  }
  throw badRequest('BANK_FILE_REQUIRED', 'A file content is required');
}

export interface BankUploadInput {
  bankAccountId: string;
  fileName: string;
  contentBase64?: string;
  contentText?: string;
  sheetName?: string | null;
  mapping?: Record<string, string>;
  dayFirst?: boolean;
  openingBalance?: string | null;
  closingBalance?: string | null;
}

interface ParsedBankUpload {
  file: ParsedFile;
  sheet: SheetData;
  mapping: Record<string, string>;
  suggestions: Record<BankFieldKey, BankColumnSuggestion>;
  preview: BankPreview;
  bytes: Uint8Array;
  fileHash: string;
}

async function openPeriods(db: Db, companyId: string) {
  const res = await db.query<{ start_date: string; end_date: string }>(
    `SELECT start_date::text, end_date::text FROM accounting_periods
      WHERE company_id = $1 AND status = 'open' ORDER BY start_date`,
    [companyId],
  );
  return res.rows.map((r) => ({ startDate: r.start_date, endDate: r.end_date }));
}

async function contextOf(
  db: Db,
  companyId: string,
  bankAccountId: string,
): Promise<CompanyBankContext> {
  const company = await db.query<{ functional_currency: string }>(
    'SELECT functional_currency FROM companies WHERE id = $1',
    [companyId],
  );
  const account = await bankAccountOfCompany(db, companyId, bankAccountId);
  return {
    cabinetId: account.cabinet_id,
    companyCurrency: company.rows[0]?.functional_currency ?? 'MUR',
    account,
  };
}

async function parseAndPreview(
  db: Db,
  config: Config,
  companyId: string,
  input: BankUploadInput,
): Promise<ParsedBankUpload> {
  const { account, companyCurrency } = await contextOf(db, companyId, input.bankAccountId);
  if (!account.is_active) throw badRequest('BANK_ACCOUNT_INACTIVE', 'This bank account is inactive');
  const bytes = decodeContent(input, Math.min(config.MAX_UPLOAD_BYTES, 8 * 1024 * 1024));
  let file: ParsedFile;
  try {
    file = parseUpload(input.fileName, bytes);
  } catch (error) {
    const code = (error as { code?: string }).code ?? 'BANK_FILE_INVALID';
    throw badRequest('BANK_FILE_INVALID', `${code}: ${(error as Error).message}`);
  }
  const sheet =
    (input.sheetName ? file.sheets.find((s) => s.name === input.sheetName) : null) ??
    file.sheets.find((s) => s.rows.length > 0 && s.headers.length >= 2) ??
    file.sheets[0];
  if (!sheet) throw badRequest('BANK_NO_TABLE', 'No table was found in the file');
  const suggestions = suggestBankMapping(sheet.headers);
  const mapping = input.mapping && Object.keys(input.mapping).length > 0
    ? input.mapping
    : autoBankMapping(suggestions);
  const existing = await db.query<{ fingerprint: string }>(
    'SELECT fingerprint FROM bank_transactions WHERE bank_account_id = $1',
    [account.id],
  );
  const preview = buildBankPreview(sheet, mapping, {
    accountId: account.id,
    accountCurrency: account.currency,
    companyCurrency,
    dayFirst: input.dayFirst ?? true,
    existingFingerprints: existing.rows.map((r) => r.fingerprint),
    openPeriods: await openPeriods(db, companyId),
    openingBalance: input.openingBalance,
    closingBalance: input.closingBalance,
  });
  return { file, sheet, mapping, suggestions, preview, bytes, fileHash: sha256Bytes(bytes) };
}

export interface BankPreviewResponse {
  bankAccount: BankAccountRow;
  sheets: { name: string; headers: string[]; rows: number }[];
  sheetName: string;
  format: string;
  encoding: string;
  delimiter: string | null;
  suggestions: Record<BankFieldKey, BankColumnSuggestion>;
  mapping: Record<string, string>;
  preview: BankPreview;
  idempotencyKey: string;
  limits: { maxBytes: number; maxRows: number };
}

export async function previewBankImport(
  db: Db,
  config: Config,
  companyId: string,
  input: BankUploadInput,
): Promise<BankPreviewResponse> {
  const parsed = await parseAndPreview(db, config, companyId, input);
  const account = await bankAccountOfCompany(db, companyId, input.bankAccountId);
  return {
    bankAccount: account,
    sheets: parsed.file.sheets.map((s) => ({ name: s.name, headers: s.headers, rows: s.rows.length })),
    sheetName: parsed.sheet.name,
    format: parsed.file.format,
    encoding: parsed.file.encoding,
    delimiter: parsed.file.delimiter,
    suggestions: parsed.suggestions,
    mapping: parsed.mapping,
    preview: {
      ...parsed.preview,
      findings: parsed.preview.findings.slice(0, MAX_PREVIEW_FINDINGS),
    },
    idempotencyKey: sha256(['bank-import', input.bankAccountId, parsed.fileHash]),
    limits: { maxBytes: Math.min(config.MAX_UPLOAD_BYTES, 8 * 1024 * 1024), maxRows: 5000 },
  };
}

export interface BankImportRow {
  id: string;
  bank_account_id: string;
  file_name: string;
  file_hash: string;
  idempotency_key: string;
  status: string;
  row_count: number;
  imported_count: number;
  duplicate_count: number;
  opening_balance: string | null;
  closing_balance: string | null;
  summary: Record<string, unknown>;
  created_at: string;
}

export async function importBankStatement(
  db: Db,
  config: Config,
  actor: { userId: string; companyId: string; ip?: string },
  input: BankUploadInput,
): Promise<{
  import: BankImportRow;
  imported: number;
  duplicates: number;
  reimport: boolean;
  preview: BankPreview;
  bankAccount: BankAccountRow;
}> {
  const parsed = await parseAndPreview(db, config, actor.companyId, input);
  if (parsed.preview.blocksImport) {
    throw badRequest('BANK_IMPORT_BLOCKED', 'Blocking findings must be fixed before importing');
  }
  const account = await bankAccountOfCompany(db, actor.companyId, input.bankAccountId);
  const cabinetId = account.cabinet_id;
  const idempotencyKey = sha256(['bank-import', account.id, parsed.fileHash]);

  const existing = await db.query<BankImportRow>(
    'SELECT * FROM bank_imports WHERE bank_account_id = $1 AND idempotency_key = $2',
    [account.id, idempotencyKey],
  );
  if (existing.rows[0]) {
    await event(db, { ...actor, cabinetId }, 'bank_import', existing.rows[0].id, 'import.replayed', {
      fileHash: parsed.fileHash,
    });
    return {
      import: existing.rows[0],
      imported: 0,
      duplicates: parsed.preview.summary.total,
      reimport: true,
      preview: parsed.preview,
      bankAccount: account,
    };
  }

  const result = await db.transaction(async (tx) => {
    const inserted = await tx.query<BankImportRow>(
      `INSERT INTO bank_imports
         (cabinet_id, company_id, bank_account_id, created_by, file_name, file_size, file_hash,
          idempotency_key, format, encoding, status, row_count, imported_count, duplicate_count,
          opening_balance, closing_balance, summary)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'imported',$11,0,0,$12,$13,$14::jsonb)
       RETURNING *`,
      [
        cabinetId,
        actor.companyId,
        account.id,
        actor.userId,
        input.fileName.slice(0, 200),
        parsed.bytes.length,
        parsed.fileHash,
        idempotencyKey,
        parsed.file.format,
        parsed.file.encoding,
        parsed.preview.summary.total,
        parsed.preview.balances.opening,
        parsed.preview.balances.closing,
        JSON.stringify(parsed.preview.summary),
      ],
    );
    const row = inserted.rows[0]!;
    let imported = 0;
    let duplicates = 0;
    for (const txn of parsed.preview.transactions) {
      if (txn.action === 'skip') {
        duplicates += 1;
        continue;
      }
      const res = await tx.query(
        `INSERT INTO bank_transactions
           (cabinet_id, company_id, bank_account_id, import_id, txn_date, value_date, label, reference,
            amount, currency, balance, external_id, fingerprint)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         ON CONFLICT (bank_account_id, fingerprint) DO NOTHING`,
        [
          cabinetId,
          actor.companyId,
          account.id,
          row.id,
          txn.txnDate,
          txn.valueDate,
          txn.label,
          txn.reference,
          txn.amount,
          txn.currency,
          txn.balance,
          txn.externalId,
          txn.fingerprint,
        ],
      );
      if ((res.rowCount ?? 0) > 0) imported += 1;
      else duplicates += 1;
    }
    await tx.query(
      `UPDATE bank_imports SET imported_count = $2, duplicate_count = $3, summary = $4::jsonb
        WHERE id = $1`,
      [row.id, imported, duplicates, JSON.stringify({ ...parsed.preview.summary, imported, duplicates })],
    );
    return { ...row, imported_count: imported, duplicate_count: duplicates };
  });

  await event(db, { ...actor, cabinetId }, 'bank_import', result.id, 'import.confirmed', {
    imported: result.imported_count,
    duplicates: result.duplicate_count,
    fileHash: parsed.fileHash,
  });
  return {
    import: result,
    imported: result.imported_count,
    duplicates: result.duplicate_count,
    reimport: false,
    preview: parsed.preview,
    bankAccount: account,
  };
}

export async function listBankImports(db: Db, companyId: string, bankAccountId?: string) {
  const res = await db.query<BankImportRow>(
    `SELECT * FROM bank_imports
      WHERE company_id = $1 AND ($2::uuid IS NULL OR bank_account_id = $2)
      ORDER BY created_at DESC LIMIT 100`,
    [companyId, bankAccountId ?? null],
  );
  return res.rows;
}

export interface BankTransactionRow {
  id: string;
  bank_account_id: string;
  import_id: string | null;
  txn_date: string;
  value_date: string | null;
  label: string;
  reference: string | null;
  amount: string;
  currency: string;
  balance: string | null;
  external_id: string | null;
  status: string;
  created_at: string;
}

export async function listBankTransactions(
  db: Db,
  companyId: string,
  filters: { bankAccountId?: string; status?: string; from?: string; to?: string; limit?: number },
) {
  const res = await db.query<BankTransactionRow & { bank_name: string }>(
    `SELECT t.*, b.name AS bank_name FROM bank_transactions t
       JOIN bank_accounts b ON b.id = t.bank_account_id
      WHERE t.company_id = $1
        AND ($2::uuid IS NULL OR t.bank_account_id = $2)
        AND ($3::text IS NULL OR t.status = $3)
        AND ($4::date IS NULL OR t.txn_date >= $4)
        AND ($5::date IS NULL OR t.txn_date <= $5)
      ORDER BY t.txn_date DESC, t.created_at DESC
      LIMIT $6`,
    [companyId, filters.bankAccountId ?? null, filters.status ?? null, filters.from ?? null, filters.to ?? null, Math.min(filters.limit ?? 100, 200)],
  );
  return res.rows;
}

async function loadLedgerLines(
  db: Db,
  companyId: string,
  accountId: string,
): Promise<LedgerBankLine[]> {
  const res = await db.query<LedgerBankLine>(
    `SELECT e.id AS "entryId", l.id AS "lineId", e.entry_no AS "entryNo", e.entry_date::text AS "entryDate",
            e.reference, l.description, l.account_id AS "accountId",
            l.debit::text, l.credit::text, e.currency,
            l.txn_currency AS "txnCurrency", l.txn_amount::text AS "txnAmount",
            EXISTS (SELECT 1 FROM bank_matches m
                     WHERE m.entry_line_id = l.id AND m.status = 'confirmed') AS matched
       FROM journal_lines l
       JOIN journal_entries e ON e.id = l.entry_id
      WHERE l.company_id = $1 AND l.account_id = $2 AND e.status = 'posted'
      ORDER BY e.entry_date DESC, e.entry_no DESC
      LIMIT 1000`,
    [companyId, accountId],
  );
  return res.rows;
}

async function invoiceRefsFor(db: Db, companyId: string, label: string): Promise<string[]> {
  const res = await db.query<{ doc_no: string | null }>(
    `SELECT doc_no FROM billing_documents
      WHERE company_id = $1 AND kind = 'invoice' AND doc_no IS NOT NULL
      ORDER BY issue_date DESC LIMIT 200`,
    [companyId],
  );
  const haystack = label.toLowerCase();
  return res.rows
    .map((r) => r.doc_no)
    .filter((no): no is string => Boolean(no && haystack.includes(no.toLowerCase())));
}

async function suggestionPayload(
  db: Db,
  companyId: string,
  account: BankAccountRow,
  txn: BankTransactionRow,
): Promise<{
  match: MatchSuggestion;
  account: AccountSuggestion;
  internalTransfer: ReturnType<typeof findInternalTransfer>;
  existingMatches: unknown[];
  proposals: unknown[];
}> {
  const lines = await loadLedgerLines(db, companyId, account.account_id);
  const refs = await invoiceRefsFor(db, companyId, `${txn.label} ${txn.reference ?? ''}`);
  const company = await db.query<{ functional_currency: string }>(
    'SELECT functional_currency FROM companies WHERE id = $1',
    [companyId],
  );
  const match = suggestMatches(
    {
      id: txn.id,
      txnDate: txn.txn_date,
      label: txn.label,
      reference: txn.reference,
      amount: txn.amount,
      currency: txn.currency,
    },
    lines,
    { companyCurrency: company.rows[0]?.functional_currency ?? 'MUR', windowDays: 7 },
    refs,
  );

  const accounts = await db.query<SuggestionAccount>(
    `SELECT id, code, name, type, is_active AS "isActive", currency
       FROM accounts WHERE company_id = $1 AND is_active = true ORDER BY code`,
    [companyId],
  );
  const rules = await db.query<SuggestionRule>(
    `SELECT id, name, label_pattern AS "labelPattern", reference_pattern AS "referencePattern",
            bank_account_id AS "bankAccountId", currency, direction, account_id AS "accountId",
            journal_id AS "journalId", priority, version
       FROM bank_rules WHERE company_id = $1 AND is_active = true ORDER BY priority`,
    [companyId],
  );
  const journals = await db.query<{ id: string; code: string }>(
    'SELECT id, code FROM journals WHERE company_id = $1 AND is_active = true ORDER BY code',
    [companyId],
  );
  const accountSuggestion = suggestAccount(
    {
      id: txn.id,
      txnDate: txn.txn_date,
      label: txn.label,
      reference: txn.reference,
      amount: txn.amount,
      currency: txn.currency,
    },
    account.id,
    accounts.rows,
    rules.rows,
    journals.rows,
  );

  const others = await db.query<{
    id: string;
    bankAccountId: string;
    txnDate: string;
    amount: string;
    currency: string;
    label: string;
  }>(
    `SELECT id, bank_account_id AS "bankAccountId", txn_date::text AS "txnDate",
            amount::text, currency, label
       FROM bank_transactions
      WHERE company_id = $1 AND id <> $2 AND status IN ('unmatched', 'review')`,
    [companyId, txn.id],
  );
  const internalTransfer = findInternalTransfer(
    {
      id: txn.id,
      txnDate: txn.txn_date,
      label: txn.label,
      reference: txn.reference,
      amount: txn.amount,
      currency: txn.currency,
    },
    others.rows,
  );
  const matches = await db.query(
    `SELECT m.*, e.entry_no, e.entry_date::text, e.description
       FROM bank_matches m LEFT JOIN journal_entries e ON e.id = m.entry_id
      WHERE m.transaction_id = $1 ORDER BY m.created_at DESC`,
    [txn.id],
  );
  const proposals = await db.query(
    `SELECT p.*, a.code AS account_code, a.name AS account_name, j.code AS journal_code
       FROM bank_proposals p
       LEFT JOIN accounts a ON a.id = p.account_id
       LEFT JOIN journals j ON j.id = p.journal_id
      WHERE p.transaction_id = $1 ORDER BY p.created_at DESC`,
    [txn.id],
  );
  return { match, account: accountSuggestion, internalTransfer, existingMatches: matches.rows, proposals: proposals.rows };
}

export async function getBankTransactionDetail(db: Db, companyId: string, transactionId: string) {
  const res = await db.query<BankTransactionRow & { bank_account_id: string }>(
    'SELECT * FROM bank_transactions WHERE id = $1 AND company_id = $2',
    [transactionId, companyId],
  );
  const txn = res.rows[0];
  if (!txn) throw notFound('BANK_TRANSACTION_NOT_FOUND', 'Bank transaction not found');
  const account = await bankAccountOfCompany(db, companyId, txn.bank_account_id);
  const suggestion = await suggestionPayload(db, companyId, account, txn);
  const billing = await billingPaymentCandidates(db, companyId, transactionId);
  return { transaction: txn, bankAccount: account, ...suggestion, billing };
}

export async function confirmBankMatch(
  db: Db,
  actor: { userId: string; companyId: string; ip?: string },
  transactionId: string,
  lineIds: string[],
  confirm: boolean,
): Promise<{ matched: number; transaction: BankTransactionRow }> {
  if (!confirm) throw badRequest('BANK_CONFIRMATION_REQUIRED', 'Explicit human confirmation is required');
  if (!Array.isArray(lineIds) || lineIds.length === 0) {
    throw badRequest('BANK_LINES_REQUIRED', 'At least one ledger line must be selected');
  }
  const txnRes = await db.query<BankTransactionRow>(
    'SELECT * FROM bank_transactions WHERE id = $1 AND company_id = $2',
    [transactionId, actor.companyId],
  );
  const txn = txnRes.rows[0];
  if (!txn) throw notFound('BANK_TRANSACTION_NOT_FOUND', 'Bank transaction not found');
  if (txn.status === 'matched') throw conflict('BANK_ALREADY_MATCHED', 'This transaction is already reconciled');
  if (txn.status === 'cancelled' || txn.status === 'excluded') {
    throw conflict('BANK_TRANSACTION_CLOSED', 'This transaction is closed');
  }
  if ((await transactionAllocatedAmount(db, txn.id)) > 0n) {
    throw conflict(
      'BANK_TRANSACTION_PARTIALLY_ALLOCATED',
      'This transaction already has confirmed billing allocations: remove them before matching ledger lines',
    );
  }
  const account = await bankAccountOfCompany(db, actor.companyId, txn.bank_account_id);

  const lines = await db.query<LedgerBankLine & { status: string; matched: boolean }>(
    `SELECT e.id AS "entryId", l.id AS "lineId", e.entry_no AS "entryNo", e.entry_date::text AS "entryDate",
            e.reference, l.description, l.account_id AS "accountId", l.debit::text, l.credit::text,
            e.currency, l.txn_currency AS "txnCurrency", l.txn_amount::text AS "txnAmount",
            e.status,
            EXISTS (SELECT 1 FROM bank_matches m WHERE m.entry_line_id = l.id AND m.status = 'confirmed') AS matched
       FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
      WHERE l.company_id = $1 AND l.account_id = $2 AND l.id = ANY($3::uuid[])`,
    [actor.companyId, account.account_id, lineIds],
  );
  if (lines.rows.length !== new Set(lineIds).size) {
    throw badRequest('BANK_LINE_NOT_FOUND', 'A selected ledger line does not belong to this bank account');
  }
  for (const line of lines.rows) {
    if (line.status !== 'posted') throw badRequest('BANK_ENTRY_NOT_POSTED', 'Only posted entries can be reconciled');
    if (line.matched) throw conflict('BANK_LINE_ALREADY_MATCHED', 'This ledger line is already reconciled');
  }
  const total = lines.rows.reduce((acc, line) => {
    const debit = parseAmount(line.debit) ?? 0n;
    const credit = parseAmount(line.credit) ?? 0n;
    return acc + debit - credit;
  }, 0n);
  const txnAmount = parseAmount(txn.amount) ?? 0n;
  if (total !== txnAmount) {
    throw badRequest(
      'BANK_AMOUNT_MISMATCH',
      `Selected ledger lines total ${formatAmount(total)}, bank transaction is ${formatAmount(txnAmount)}`,
    );
  }

  const result = await db.transaction(async (tx) => {
    for (const line of lines.rows) {
      await tx.query(
        `INSERT INTO bank_matches
           (cabinet_id, company_id, bank_account_id, transaction_id, entry_id, entry_line_id,
            amount, status, kind, confidence, reasons, created_by, decided_by, decided_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'confirmed','entry',1,$8::jsonb,$9,$9,now())`,
        [
          account.cabinet_id,
          actor.companyId,
          account.id,
          txn.id,
          line.entryId,
          line.lineId,
          formatAmount(
            (parseAmount(line.debit) ?? 0n) - (parseAmount(line.credit) ?? 0n) < 0n
              ? (parseAmount(line.credit) ?? 0n) - (parseAmount(line.debit) ?? 0n)
              : (parseAmount(line.debit) ?? 0n) - (parseAmount(line.credit) ?? 0n),
          ),
          JSON.stringify([{ fr: 'Validation humaine explicite', en: 'Explicit human confirmation' }]),
          actor.userId,
        ],
      );
    }
    await tx.query(
      `UPDATE bank_transactions SET status = 'matched', updated_at = now() WHERE id = $1`,
      [txn.id],
    );
    return lines.rows.length;
  });
  await event(db, { ...actor, cabinetId: account.cabinet_id }, 'bank_transaction', txn.id, 'match.confirmed', {
    lines: lineIds.length,
    amount: txn.amount,
  });
  const updated = await db.query<BankTransactionRow>('SELECT * FROM bank_transactions WHERE id = $1', [txn.id]);
  return { matched: result, transaction: updated.rows[0]! };
}

export async function excludeBankTransaction(
  db: Db,
  actor: { userId: string; companyId: string; ip?: string },
  transactionId: string,
  reason: string | null,
): Promise<BankTransactionRow> {
  const existing = await db.query<BankTransactionRow>(
    'SELECT * FROM bank_transactions WHERE id = $1 AND company_id = $2',
    [transactionId, actor.companyId],
  );
  const foundTxn = existing.rows[0];
  if (!foundTxn) throw notFound('BANK_TRANSACTION_NOT_FOUND', 'Transaction not found');
  if (foundTxn.status === 'matched' || foundTxn.status === 'partially_matched') {
    throw conflict('BANK_ALREADY_MATCHED', 'This transaction is already reconciled');
  }
  if ((await transactionAllocatedAmount(db, foundTxn.id)) > 0n) {
    throw conflict(
      'BANK_TRANSACTION_PARTIALLY_ALLOCATED',
      'Confirmed billing allocations must be removed before excluding this transaction',
    );
  }
  const res = await db.query<BankTransactionRow>(
    `UPDATE bank_transactions SET status = 'excluded', updated_at = now()
      WHERE id = $1 AND company_id = $2 RETURNING *`,
    [transactionId, actor.companyId],
  );
  const txn = res.rows[0]!;
  await event(db, actor, 'bank_transaction', txn.id, 'match.rejected', { reason: reason ?? null });
  return txn;
}

export async function createBankProposal(
  db: Db,
  actor: { userId: string; companyId: string },
  transactionId: string,
  input: { accountId?: string | null; journalCode?: string | null },
) {
  const detail = await getBankTransactionDetail(db, actor.companyId, transactionId);
  const txn = detail.transaction;
  if (txn.status === 'matched') throw conflict('BANK_ALREADY_MATCHED', 'Transaction already reconciled');
  if (txn.status === 'partially_matched' || (await transactionAllocatedAmount(db, txn.id)) > 0n) {
    throw conflict(
      'BANK_TRANSACTION_PARTIALLY_ALLOCATED',
      'This transaction is already allocated to a billing payment',
    );
  }
  const accountId = input.accountId ?? detail.account.accountId;
  if (!accountId) {
    throw badRequest('BANK_ACCOUNT_DECISION_REQUIRED', 'No suitable account exists: choose one manually');
  }
  const accountRes = await db.query<{ id: string; is_active: boolean }>(
    'SELECT id, is_active FROM accounts WHERE id = $1 AND company_id = $2',
    [accountId, actor.companyId],
  );
  if (!accountRes.rows[0]) throw badRequest('BANK_CHART_ACCOUNT_NOT_FOUND', 'The chart account does not exist');
  if (!accountRes.rows[0].is_active) throw badRequest('BANK_CHART_ACCOUNT_INACTIVE', 'The chart account is inactive');
  const journal = await db.query<{ id: string; code: string }>(
    `SELECT id, code FROM journals
      WHERE company_id = $1 AND is_active = true
        AND ($2::text IS NULL OR code = $2)
      ORDER BY CASE WHEN code = 'BQ' THEN 0 WHEN code = 'OD' THEN 1 ELSE 2 END
      LIMIT 1`,
    [actor.companyId, input.journalCode ?? null],
  );
  const journalRow = journal.rows[0];
  if (!journalRow) throw badRequest('BANK_JOURNAL_NOT_FOUND', 'No matching journal exists');
  const direction = (parseAmount(txn.amount) ?? 0n) > 0n ? 'in' : 'out';
  const amount = parseAmount(txn.amount) ?? 0n;
  const rationale = {
    fr: detail.account.rationaleFr,
    en: detail.account.rationaleEn,
    kind: detail.account.kind,
    salary: detail.account.kind === 'salary',
    confidence: detail.account.confidence,
    ruleId: detail.account.ruleId,
  };
  const res = await db.query(
    `INSERT INTO bank_proposals
       (cabinet_id, company_id, bank_account_id, transaction_id, account_id, journal_id, entry_date,
        amount, direction, confidence, rationale, rule_id, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13) RETURNING *`,
    [
      detail.bankAccount.cabinet_id,
      actor.companyId,
      detail.bankAccount.id,
      txn.id,
      accountId,
      journalRow.id,
      txn.txn_date,
      formatAmount(amount < 0n ? -amount : amount),
      direction,
      detail.account.confidence,
      JSON.stringify(rationale),
      detail.account.ruleId,
      actor.userId,
    ],
  );
  await event(db, { ...actor, cabinetId: detail.bankAccount.cabinet_id }, 'bank_proposal', res.rows[0]!.id, 'proposal.created', {
    transactionId,
    salary: detail.account.kind === 'salary',
  });
  return res.rows[0];
}

export async function acceptBankProposal(
  db: Db,
  actor: { userId: string; companyId: string; ip?: string },
  proposalId: string,
  confirm: boolean,
  exchangeRate?: string | number | null,
): Promise<{ proposal: unknown; entry: unknown; matched: number }> {
  if (!confirm) throw badRequest('BANK_CONFIRMATION_REQUIRED', 'Explicit human confirmation is required');
  const res = await db.query<{
    id: string;
    transaction_id: string;
    bank_account_id: string;
    account_id: string;
    journal_id: string;
    entry_date: string;
    amount: string;
    direction: 'in' | 'out';
    status: string;
  }>('SELECT * FROM bank_proposals WHERE id = $1 AND company_id = $2', [proposalId, actor.companyId]);
  const proposal = res.rows[0];
  if (!proposal) throw notFound('BANK_PROPOSAL_NOT_FOUND', 'Proposal not found');
  if (proposal.status !== 'proposed') throw conflict('BANK_PROPOSAL_CLOSED', 'This proposal is already decided');

  const txnRes = await db.query<BankTransactionRow>(
    'SELECT * FROM bank_transactions WHERE id = $1 AND company_id = $2',
    [proposal.transaction_id, actor.companyId],
  );
  const txn = txnRes.rows[0];
  if (!txn) throw notFound('BANK_TRANSACTION_NOT_FOUND', 'Transaction not found');
  if (txn.status === 'matched') throw conflict('BANK_ALREADY_MATCHED', 'Transaction already reconciled');
  if ((await transactionAllocatedAmount(db, txn.id)) > 0n) {
    throw conflict(
      'BANK_TRANSACTION_PARTIALLY_ALLOCATED',
      'This transaction is already allocated to a billing payment',
    );
  }
  const account = await bankAccountOfCompany(db, actor.companyId, proposal.bank_account_id);

  const company = await db.query<{ functional_currency: string }>(
    'SELECT functional_currency FROM companies WHERE id = $1',
    [actor.companyId],
  );
  const companyCurrency = company.rows[0]?.functional_currency ?? 'MUR';
  if (txn.currency !== companyCurrency && !exchangeRate) {
    throw badRequest(
      'BANK_EXCHANGE_RATE_REQUIRED',
      'A foreign-currency bank account requires an explicit exchange rate; none is invented',
    );
  }
  const native = parseAmount(txn.amount) ?? 0n;
  const amount = native < 0n ? -native : native;

  const posted = await db.transaction(async (tx) => {
    const result = await postEntryTx(tx, {
      companyId: actor.companyId,
      userId: actor.userId,
      journalId: proposal.journal_id,
      entryDate: txn.txn_date,
      description: txn.label.slice(0, 300),
      reference: txn.reference,
      currency: txn.currency,
      exchangeRate: exchangeRate ?? 1,
      source: 'manual',
      status: 'posted',
      lines: [
        {
          accountId: account.account_id,
          description: txn.label.slice(0, 300),
          ...(txn.amount.startsWith('-')
            ? { credit: formatAmount(amount) }
            : { debit: formatAmount(amount) }),
        },
        {
          accountId: proposal.account_id,
          description: txn.label.slice(0, 300),
          ...(txn.amount.startsWith('-')
            ? { debit: formatAmount(amount) }
            : { credit: formatAmount(amount) }),
        },
      ],
    });
    const line = await tx.query<{ id: string }>(
      `SELECT l.id FROM journal_lines l
        WHERE l.entry_id = $1 AND l.account_id = $2 ORDER BY l.line_no LIMIT 1`,
      [result.entry.id, account.account_id],
    );
    await tx.query(
      `INSERT INTO bank_matches
         (cabinet_id, company_id, bank_account_id, transaction_id, entry_id, entry_line_id,
          amount, status, kind, confidence, reasons, created_by, decided_by, decided_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'confirmed','entry',1,$8::jsonb,$9,$9,now())`,
      [
        account.cabinet_id,
        actor.companyId,
        account.id,
        txn.id,
        result.entry.id,
        line.rows[0]?.id ?? null,
        formatAmount(amount),
        JSON.stringify([{ fr: 'Proposition acceptée par un humain', en: 'Proposal accepted by a human' }]),
        actor.userId,
      ],
    );
    await tx.query(
      `UPDATE bank_transactions SET status = 'matched', updated_at = now() WHERE id = $1`,
      [txn.id],
    );
    await tx.query(
      `UPDATE bank_proposals SET status = 'accepted', created_entry_id = $2, decided_by = $3,
              decided_at = now() WHERE id = $1`,
      [proposal.id, result.entry.id, actor.userId],
    );
    return result.entry;
  });
  await event(db, { ...actor, cabinetId: account.cabinet_id }, 'bank_proposal', proposal.id, 'proposal.accepted', {
    entryId: posted.id,
    amount: txn.amount,
  });
  return { proposal: { ...proposal, status: 'accepted' }, entry: posted, matched: 1 };
}

export async function rejectBankProposal(
  db: Db,
  actor: { userId: string; companyId: string },
  proposalId: string,
) {
  const res = await db.query(
    `UPDATE bank_proposals SET status = 'rejected', decided_by = $3, decided_at = now()
      WHERE id = $1 AND company_id = $2 AND status = 'proposed' RETURNING *`,
    [proposalId, actor.companyId, actor.userId],
  );
  if (!res.rows[0]) throw notFound('BANK_PROPOSAL_NOT_FOUND', 'Proposal not found or already decided');
  await event(db, actor, 'bank_proposal', proposalId, 'proposal.rejected', {});
  return res.rows[0];
}

export async function listBankRules(db: Db, companyId: string) {
  const res = await db.query(
    `SELECT r.*, a.code AS account_code, a.name AS account_name, j.code AS journal_code
       FROM bank_rules r
       LEFT JOIN accounts a ON a.id = r.account_id
       LEFT JOIN journals j ON j.id = r.journal_id
      WHERE r.company_id = $1 ORDER BY r.priority, r.created_at DESC`,
    [companyId],
  );
  return res.rows;
}

export async function saveBankRule(
  db: Db,
  actor: { userId: string; companyId: string },
  input: {
    name: string;
    labelPattern?: string | null;
    referencePattern?: string | null;
    bankAccountId?: string | null;
    currency?: string | null;
    direction?: 'any' | 'in' | 'out';
    accountId: string;
    journalId?: string | null;
    priority?: number;
    notes?: string | null;
    supersedesId?: string | null;
  },
) {
  if (!input.labelPattern && !input.referencePattern) {
    throw badRequest('BANK_RULE_PATTERN_REQUIRED', 'A label or reference pattern is required');
  }
  const account = await db.query('SELECT id FROM accounts WHERE id = $1 AND company_id = $2 AND is_active = true', [
    input.accountId,
    actor.companyId,
  ]);
  if (!account.rows[0]) throw badRequest('BANK_CHART_ACCOUNT_NOT_FOUND', 'Account not found or inactive');
  if (input.bankAccountId) await bankAccountOfCompany(db, actor.companyId, input.bankAccountId);
  if (input.journalId) {
    const journal = await db.query('SELECT id FROM journals WHERE id = $1 AND company_id = $2', [
      input.journalId,
      actor.companyId,
    ]);
    if (!journal.rows[0]) throw badRequest('BANK_JOURNAL_NOT_FOUND', 'Journal not found');
  }
  let version = 1;
  let previous: { account_id: string; journal_id: string | null } | null = null;
  if (input.supersedesId) {
    const old = await db.query<{ id: string; version: number; account_id: string; journal_id: string | null }>(
      'SELECT id, version, account_id, journal_id FROM bank_rules WHERE id = $1 AND company_id = $2',
      [input.supersedesId, actor.companyId],
    );
    if (!old.rows[0]) throw notFound('BANK_RULE_NOT_FOUND', 'Rule not found');
    version = old.rows[0].version + 1;
    previous = old.rows[0];
    await db.query('UPDATE bank_rules SET is_active = false WHERE id = $1', [input.supersedesId]);
  }
  const cabinetId = await cabinetForCompany(db, actor.companyId);
  const res = await db.query(
    `INSERT INTO bank_rules
       (cabinet_id, company_id, name, label_pattern, reference_pattern, bank_account_id, currency,
        direction, account_id, journal_id, priority, version, supersedes_id, notes, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
    [
      cabinetId,
      actor.companyId,
      input.name.trim().slice(0, 120),
      input.labelPattern?.trim() || null,
      input.referencePattern?.trim() || null,
      input.bankAccountId ?? null,
      input.currency ?? null,
      input.direction ?? 'any',
      input.accountId,
      input.journalId ?? previous?.journal_id ?? null,
      input.priority ?? 100,
      version,
      input.supersedesId ?? null,
      input.notes ?? null,
      actor.userId,
    ],
  );
  await event(db, { ...actor, cabinetId }, 'bank_rule', res.rows[0]!.id, input.supersedesId ? 'rule.versioned' : 'rule.created', {
    version,
  });
  return res.rows[0];
}

export async function disableBankRule(db: Db, actor: { userId: string; companyId: string }, ruleId: string) {
  const res = await db.query(
    'UPDATE bank_rules SET is_active = false WHERE id = $1 AND company_id = $2 RETURNING *',
    [ruleId, actor.companyId],
  );
  if (!res.rows[0]) throw notFound('BANK_RULE_NOT_FOUND', 'Rule not found');
  await event(db, actor, 'bank_rule', ruleId, 'rule.disabled', {});
  return res.rows[0];
}

export interface BankReport {
  companyId: string;
  bankAccount: { id: string; name: string; bankName: string; currency: string; maskedReference: string | null };
  period: { from: string | null; to: string | null };
  bankBalance: string | null;
  ledgerBalance: string;
  bankMovement: string;
  matchedCount: number;
  unmatchedCount: number;
  ledgerUnmatchedCount: number;
  difference: string;
  status: 'reconciled' | 'differences';
  explanations: { code: string; fr: string; en: string }[];
  validatedAt: string | null;
  validatedBy: string | null;
}

export async function bankReport(
  db: Db,
  companyId: string,
  bankAccountId: string,
  from?: string | null,
  to?: string | null,
): Promise<BankReport> {
  const account = await bankAccountOfCompany(db, companyId, bankAccountId);
  const ledger = await db.query<{ balance: string }>(
    `SELECT COALESCE(SUM(l.debit - l.credit), 0)::text AS balance
       FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
      WHERE l.company_id = $1 AND l.account_id = $2 AND e.status = 'posted'
        AND ($3::date IS NULL OR e.entry_date >= $3)
        AND ($4::date IS NULL OR e.entry_date <= $4)`,
    [companyId, account.account_id, from ?? null, to ?? null],
  );
  const last = await db.query<{ balance: string | null }>(
    `SELECT balance::text FROM bank_transactions
      WHERE bank_account_id = $1 AND balance IS NOT NULL
        AND ($2::date IS NULL OR txn_date >= $2) AND ($3::date IS NULL OR txn_date <= $3)
      ORDER BY txn_date DESC, created_at DESC LIMIT 1`,
    [account.id, from ?? null, to ?? null],
  );
  const movement = await db.query<{ total: string }>(
    `SELECT COALESCE(SUM(amount), 0)::text AS total FROM bank_transactions
      WHERE bank_account_id = $1
        AND ($2::date IS NULL OR txn_date >= $2) AND ($3::date IS NULL OR txn_date <= $3)`,
    [account.id, from ?? null, to ?? null],
  );
  const counts = await db.query<{ matched: number; unmatched: number }>(
    `SELECT
       count(*) FILTER (WHERE status = 'matched')::int AS matched,
       count(*) FILTER (WHERE status IN ('unmatched', 'proposed', 'review'))::int AS unmatched
     FROM bank_transactions
      WHERE bank_account_id = $1
        AND ($2::date IS NULL OR txn_date >= $2) AND ($3::date IS NULL OR txn_date <= $3)`,
    [account.id, from ?? null, to ?? null],
  );
  const ledgerUnmatched = await db.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM journal_lines l
       JOIN journal_entries e ON e.id = l.entry_id
      WHERE l.company_id = $1 AND l.account_id = $2 AND e.status = 'posted'
        AND ($3::date IS NULL OR e.entry_date >= $3)
        AND ($4::date IS NULL OR e.entry_date <= $4)
        AND NOT EXISTS (SELECT 1 FROM bank_matches m WHERE m.entry_line_id = l.id AND m.status = 'confirmed')`,
    [companyId, account.account_id, from ?? null, to ?? null],
  );
  const validation = await db.query<{ decided_at: string | null; decided_by: string | null }>(
    `SELECT max(m.decided_at)::text AS decided_at,
            (array_agg(COALESCE(u.full_name, u.email) ORDER BY m.decided_at DESC))[1] AS decided_by
       FROM bank_matches m
       JOIN bank_transactions t ON t.id = m.transaction_id
       LEFT JOIN app_users u ON u.id = m.decided_by
      WHERE m.bank_account_id = $1 AND m.status = 'confirmed'
        AND ($2::date IS NULL OR t.txn_date >= $2) AND ($3::date IS NULL OR t.txn_date <= $3)`,
    [account.id, from ?? null, to ?? null],
  );
  const ledgerBalance = formatAmount(parseAmount(ledger.rows[0]?.balance ?? '0') ?? 0n);
  const bankBalance = last.rows[0]?.balance ?? null;
  const difference = formatAmount(
    (parseAmount(bankBalance ?? '0') ?? 0n) - (parseAmount(ledgerBalance) ?? 0n),
  );
  const unmatched = counts.rows[0]?.unmatched ?? 0;
  const ledgerUnmatchedCount = ledgerUnmatched.rows[0]?.count ?? 0;
  const status: 'reconciled' | 'differences' =
    bankBalance !== null && unmatched === 0 && ledgerUnmatchedCount === 0 && difference === '0.0000'
      ? 'reconciled'
      : 'differences';
  const explanations: BankReport['explanations'] = [];
  if (!bankBalance) {
    explanations.push({
      code: 'NO_BANK_BALANCE',
      fr: 'Aucun solde bancaire n’est fourni : le rapport ne peut pas conclure à un rapprochement.',
      en: 'No bank balance is available: the report cannot conclude a reconciliation.',
    });
  }
  if (unmatched > 0) {
    explanations.push({
      code: 'UNMATCHED_BANK_TRANSACTIONS',
      fr: `${unmatched} opération(s) bancaire(s) non rapprochée(s) expliquent tout ou partie de l’écart.`,
      en: `${unmatched} unreconciled bank transaction(s) explain all or part of the difference.`,
    });
  }
  if (ledgerUnmatchedCount > 0) {
    explanations.push({
      code: 'UNMATCHED_LEDGER_LINES',
      fr: `${ledgerUnmatchedCount} ligne(s) comptable(s) du compte bancaire ne sont pas rapprochées : le rapport ne peut pas conclure.`,
      en: `${ledgerUnmatchedCount} ledger line(s) of the bank account are not reconciled: the report cannot conclude.`,
    });
  }
  if (difference !== '0.0000') {
    explanations.push({
      code: 'BALANCE_DIFFERENCE',
      fr: 'Le solde bancaire et le solde comptable diffèrent : un rapprochement complet reste à faire.',
      en: 'The bank balance and the ledger balance differ: reconciliation is not complete.',
    });
  }
  if (status === 'reconciled') {
    explanations.push({
      code: 'RECONCILED',
      fr: 'Aucun écart inexpliqué sur la période sélectionnée.',
      en: 'No unexplained difference over the selected period.',
    });
  }
  return {
    companyId,
    bankAccount: {
      id: account.id,
      name: account.name,
      bankName: account.bank_name,
      currency: account.currency,
      maskedReference: account.masked_reference,
    },
    period: { from: from ?? null, to: to ?? null },
    bankBalance,
    ledgerBalance,
    bankMovement: formatAmount(parseAmount(movement.rows[0]?.total ?? '0') ?? 0n),
    matchedCount: counts.rows[0]?.matched ?? 0,
    unmatchedCount: unmatched,
    ledgerUnmatchedCount,
    difference,
    status,
    explanations,
    validatedAt: validation.rows[0]?.decided_at ?? null,
    validatedBy: validation.rows[0]?.decided_by ?? null,
  };
}

export function bankReportCsv(report: BankReport, locale: 'fr' | 'en'): string {
  const fr = locale === 'fr';
  return toCsv([
    [fr ? 'Rapport de rapprochement bancaire' : 'Bank reconciliation report'],
    [fr ? 'Société' : 'Company', report.companyId],
    [fr ? 'Banque' : 'Bank', report.bankAccount.bankName],
    [fr ? 'Compte' : 'Account', report.bankAccount.name],
    [fr ? 'Référence masquée' : 'Masked reference', report.bankAccount.maskedReference],
    [fr ? 'Devise' : 'Currency', report.bankAccount.currency],
    [fr ? 'Du' : 'From', report.period.from],
    [fr ? 'Au' : 'To', report.period.to],
    [fr ? 'Solde bancaire' : 'Bank balance', report.bankBalance],
    [fr ? 'Solde comptable' : 'Ledger balance', report.ledgerBalance],
    [fr ? 'Mouvement bancaire' : 'Bank movement', report.bankMovement],
    [fr ? 'Transactions rapprochées' : 'Matched transactions', report.matchedCount],
    [fr ? 'Transactions non rapprochées' : 'Unmatched transactions', report.unmatchedCount],
    [fr ? 'Lignes comptables non rapprochées' : 'Unmatched ledger lines', report.ledgerUnmatchedCount],
    [fr ? 'Écart' : 'Difference', report.difference],
    [fr ? 'Statut' : 'Status', report.status],
    [],
    ...report.explanations.map((e) => [fr ? e.fr : e.en]),
  ]);
}
