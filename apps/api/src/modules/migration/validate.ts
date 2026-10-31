import {
  formatScaled,
  isCreditIndicator,
  normalizeAccountType,
  normalizeHeader,
  parseAmount,
  parseDate,
  parseRate,
  type AccountType,
} from './normalize.js';
import {
  fieldsForKind,
  requiredFields,
  type ImportKind,
} from './profiles.js';

/**
 * Deterministic validation engine of the migration assistant.
 *
 * It answers one question only: *what exactly would be written if the user
 * confirmed this import?* It creates nothing, never fills a missing amount, and
 * never replaces an account or an entry. Every problem is a finding with a
 * stable code, a row number and a severity: `error` blocks the import,
 * `warning` is shown but does not block, `info` explains a skip.
 */

export type Severity = 'error' | 'warning' | 'info';

export interface Finding {
  severity: Severity;
  code: string;
  rowNumber: number | null;
  message: string;
  details?: Record<string, unknown>;
}

export interface MigrationOptions {
  /** Chart import only: keep importing accounts that already exist? */
  createAccounts?: boolean;
  /** Company import only: explicit consent to create unknown companies. */
  createCompanies?: boolean;
  /** Opening balance: the date to post the opening entry on. */
  openingDate?: string | null;
  /** Default journal code for entries without a journal column. */
  defaultJournalCode?: string | null;
  /** Chart import: type used when the file has no type column. */
  defaultAccountType?: AccountType | null;
  /** Default currency when the file has no currency column. */
  defaultCurrency?: string | null;
  /** `03/04/2026` = 3 April (true, default) or 4 March (false). */
  dateDayFirst?: boolean;
  /** Re-import of a changed row: block instead of reporting a conflict. */
  conflictStrategy?: 'skip' | 'block';
}

export interface RefAccount {
  id: string;
  code: string;
  name: string;
  type: AccountType;
  currency: string;
  is_active: boolean;
}

export interface RefJournal {
  id: string;
  code: string;
  name: string;
}

export interface RefPeriod {
  start_date: string;
  end_date: string;
  status: 'open' | 'closed';
}

export interface RefCustomer {
  id: string;
  name: string;
  brn: string | null;
}

export interface RefCompany {
  id: string;
  name: string;
  brn: string | null;
}

export interface PreviewContext {
  kind: ImportKind;
  mapping: Record<string, string | null | undefined>;
  accountMapping?: Record<string, string>;
  options?: MigrationOptions;
  accounts: RefAccount[];
  journals: RefJournal[];
  periods: RefPeriod[];
  customers?: RefCustomer[];
  companies?: RefCompany[];
  functionalCurrency: string;
  supportedCurrencies: readonly string[];
  /** True when the company already carries a posted opening entry. */
  hasOpeningEntry?: boolean;
  /** Idempotency: fingerprints already imported for this company. */
  importedFingerprints?: Set<string>;
}

export interface RowBase {
  rowNumber: number;
  action: 'create' | 'skip' | 'blocked';
  warnings: number;
}

export interface ChartRow extends RowBase {
  code: string;
  name: string;
  type: AccountType | null;
  currency: string;
  isActive: boolean;
  description: string | null;
  exists: boolean;
}

export interface OpeningRow extends RowBase {
  accountCode: string;
  resolvedAccountId: string | null;
  resolvedCode: string | null;
  debit: string;
  credit: string;
  description: string | null;
  viaMapping: boolean;
}

export interface EntryLinePreview {
  rowNumber: number;
  accountCode: string;
  resolvedAccountId: string | null;
  resolvedCode: string | null;
  description: string | null;
  debit: string;
  credit: string;
  viaMapping: boolean;
}

export interface EntryGroupPreview {
  key: string;
  entryDate: string | null;
  journalCode: string;
  journalId: string | null;
  reference: string | null;
  description: string;
  currency: string;
  exchangeRate: string | null;
  fingerprint: string;
  debitTotal: string;
  creditTotal: string;
  balanced: boolean;
  alreadyImported: boolean;
  action: 'create' | 'skip' | 'blocked';
  lines: EntryLinePreview[];
}

export interface CustomerRow extends RowBase {
  name: string;
  legalName: string | null;
  brn: string | null;
  vatNumber: string | null;
  email: string | null;
  phone: string | null;
  addressLine1: string | null;
  city: string | null;
  postcode: string | null;
  country: string;
  paymentTermsDays: number | null;
  exists: boolean;
}

export interface CompanyRowPreview extends RowBase {
  name: string;
  brn: string | null;
  crn: string | null;
  vatNumber: string | null;
  currency: string;
  financialYearStart: string;
  financialYearEnd: string;
  registeredAddress: string | null;
  businessActivity: string | null;
  matchesCompanyId: string | null;
}

export interface PreviewResult {
  kind: ImportKind;
  mapping: Record<string, string>;
  missingRequiredColumns: { field: string; labelFr: string; labelEn: string }[];
  rows: {
    chart?: ChartRow[];
    opening?: OpeningRow[];
    entries?: EntryGroupPreview[];
    customers?: CustomerRow[];
    companies?: CompanyRowPreview[];
  };
  totals: { debit: string; credit: string; difference: string } | null;
  findings: Finding[];
  summary: {
    rows: number;
    create: number;
    skip: number;
    blocked: number;
    errors: number;
    warnings: number;
    infos: number;
  };
  blocksImport: boolean;
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const COUNTRY = /^[A-Za-z]{2}$/;
const CODE = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,31}$/;
const ZERO = '0.0000';

function headerIndex(headers: string[]): Map<string, number> {
  const map = new Map<string, number>();
  headers.forEach((h, i) => {
    if (!map.has(h)) map.set(h, i);
  });
  return map;
}

function value(row: string[], index: Map<string, number>, column: string | null | undefined): string {
  if (!column) return '';
  const i = index.get(column);
  if (i === undefined) return '';
  return (row[i] ?? '').trim();
}

function has(column: string | null | undefined): boolean {
  return Boolean(column && column.trim());
}

/** Normalised account code used as key of the account mapping. */
export function accountKey(code: string): string {
  return code.trim().toUpperCase();
}

function inOpenPeriod(periods: RefPeriod[], date: string | null): boolean {
  if (!date) return false;
  const covering = periods.filter((p) => p.start_date <= date && p.end_date >= date);
  return covering.some((p) => p.status === 'open');
}

function inClosedPeriod(periods: RefPeriod[], date: string | null): boolean {
  if (!date) return false;
  return periods.some((p) => p.status === 'closed' && p.start_date <= date && p.end_date >= date);
}

/** Detects the DD/MM vs MM/DD convention from an unambiguous sample. */
export function detectDateConvention(samples: string[]): boolean {
  let dayFirstVotes = 0;
  let monthFirstVotes = 0;
  for (const sample of samples) {
    const m = /^(\d{1,2})[./-](\d{1,2})[./-]\d{2,4}$/.exec(sample.trim());
    if (!m) continue;
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a > 12 && b <= 12) dayFirstVotes += 1;
    else if (b > 12 && a <= 12) monthFirstVotes += 1;
  }
  if (monthFirstVotes > dayFirstVotes) return false;
  return true;
}

function amountOrNull(raw: string, findings: Finding[], rowNumber: number, code: string, label: string): bigint | null {
  if (!raw.trim()) return 0n;
  const parsed = parseAmount(raw);
  if (parsed === null) {
    findings.push({
      severity: 'error',
      code: 'INVALID_AMOUNT',
      rowNumber,
      message: `Ligne ${rowNumber} : montant illisible dans « ${label} » (${raw}). / Row ${rowNumber}: unreadable amount in "${label}".`,
      details: { raw },
    });
    return null;
  }
  if (parsed < 0n) {
    findings.push({
      severity: 'error',
      code,
      rowNumber,
      message: `Ligne ${rowNumber} : montant négatif refusé dans « ${label} » (${raw}). Utilisez la colonne débit ou crédit appropriée. / Row ${rowNumber}: negative amount rejected in "${label}". Use the debit or credit column instead.`,
      details: { raw },
    });
    return null;
  }
  return parsed;
}

interface MappingCheck {
  mapping: Record<string, string>;
  missing: { field: string; labelFr: string; labelEn: string }[];
  invalid: { field: string; column: string }[];
}

function checkMapping(kind: ImportKind, headers: string[], raw: Record<string, string | null | undefined>): MappingCheck {
  const mapping: Record<string, string> = {};
  const invalid: { field: string; column: string }[] = [];
  const available = new Set(headers);
  const known = new Set(fieldsForKind(kind).map((f) => f.key));
  for (const [field, column] of Object.entries(raw)) {
    if (!known.has(field)) continue;
    if (column && available.has(column)) mapping[field] = column;
    else if (column) invalid.push({ field, column });
  }
  const missing = requiredFields(kind)
    .filter((f) => !mapping[f.key])
    .map((f) => ({ field: f.key, labelFr: f.labelFr, labelEn: f.labelEn }));
  return { mapping, missing, invalid };
}

function fingerprint(parts: unknown[]): string {
  return JSON.stringify(parts);
}

/* -------------------------------------------------------------------------- */
/* Main entry                                                                 */
/* -------------------------------------------------------------------------- */

export function buildPreview(
  headers: string[],
  rows: string[][],
  ctx: PreviewContext,
): PreviewResult {
  const findings: Finding[] = [];
  const { mapping, missing, invalid } = checkMapping(ctx.kind, headers, ctx.mapping);
  const index = headerIndex(headers);
  const options = ctx.options ?? {};

  for (const item of invalid) {
    findings.push({
      severity: 'error',
      code: 'MAPPING_COLUMN_MISSING',
      rowNumber: null,
      message: `Colonne mappée « ${item.column} » absente du fichier. / Mapped column "${item.column}" is missing from the file.`,
      details: item,
    });
  }
  for (const item of missing) {
    findings.push({
      severity: 'error',
      code: 'MISSING_REQUIRED_COLUMN',
      rowNumber: null,
      message: `Correspondance obligatoire absente : ${item.labelFr} / ${item.labelEn}.`,
      details: item,
    });
  }

  // Unknown columns are informational only (exports often carry extras).
  const mappedColumns = new Set(Object.values(mapping));
  for (const header of headers) {
    if (!mappedColumns.has(header)) {
      findings.push({
        severity: 'info',
        code: 'UNMAPPED_COLUMN',
        rowNumber: null,
        message: `Colonne « ${header} » non utilisée. / Column "${header}" is not used.`,
        details: { column: header },
      });
    }
  }

  const base: Omit<PreviewResult, 'rows' | 'totals' | 'summary' | 'blocksImport'> = {
    kind: ctx.kind,
    mapping,
    missingRequiredColumns: missing,
    findings,
  };

  let result: PreviewResult;
  if (ctx.kind === 'chart_of_accounts') {
    result = { ...base, rows: { chart: previewChart(rows, index, mapping, ctx, findings) }, totals: null, summary: emptySummary(), blocksImport: false };
  } else if (ctx.kind === 'opening_balance') {
    result = { ...base, rows: {}, totals: null, summary: emptySummary(), blocksImport: false };
    const opening = previewOpening(rows, index, mapping, ctx, findings);
    result.rows.opening = opening.rows;
    result.totals = opening.totals;
  } else if (ctx.kind === 'journal_entries') {
    result = { ...base, rows: {}, totals: null, summary: emptySummary(), blocksImport: false };
    const entries = previewEntries(rows, index, mapping, ctx, findings);
    result.rows.entries = entries.groups;
    result.totals = entries.totals;
  } else if (ctx.kind === 'customers') {
    result = { ...base, rows: { customers: previewCustomers(rows, index, mapping, ctx, findings) }, totals: null, summary: emptySummary(), blocksImport: false };
  } else {
    result = { ...base, rows: { companies: previewCompanies(rows, index, mapping, ctx, findings) }, totals: null, summary: emptySummary(), blocksImport: false };
  }

  if (missing.length > 0) {
    // Nothing can be imported without the mandatory columns.
    const unit = result.rows.chart ?? result.rows.customers ?? result.rows.companies;
    if (unit) unit.forEach((r) => (r.action = 'blocked'));
    result.rows.opening?.forEach((r) => (r.action = 'blocked'));
    result.rows.entries?.forEach((r) => {
      r.action = 'blocked';
      r.lines.forEach(() => undefined);
    });
  }

  const units: RowBase[] =
    result.rows.chart ??
    result.rows.opening ??
    result.rows.customers ??
    result.rows.companies ??
    (result.rows.entries ?? []).map((g) => ({
      rowNumber: g.lines[0]?.rowNumber ?? 0,
      action: g.action,
      warnings: 0,
    }));
  result.summary = {
    rows: ctx.kind === 'journal_entries' ? (result.rows.entries ?? []).reduce((n, g) => n + g.lines.length, 0) : units.length,
    create: units.filter((r) => r.action === 'create').length,
    skip: units.filter((r) => r.action === 'skip').length,
    blocked: units.filter((r) => r.action === 'blocked').length,
    errors: findings.filter((f) => f.severity === 'error').length,
    warnings: findings.filter((f) => f.severity === 'warning').length,
    infos: findings.filter((f) => f.severity === 'info').length,
  };
  // A fully skipped batch is a legitimate idempotent no-op (re-import of an
  // already imported file); only errors or an empty batch block the import.
  result.blocksImport =
    result.summary.errors > 0 || (result.summary.create === 0 && result.summary.skip === 0);
  return result;
}

function emptySummary(): PreviewResult['summary'] {
  return { rows: 0, create: 0, skip: 0, blocked: 0, errors: 0, warnings: 0, infos: 0 };
}

/* -------------------------------------------------------------------------- */
/* Chart of accounts                                                          */
/* -------------------------------------------------------------------------- */

function previewChart(
  rows: string[][],
  index: Map<string, number>,
  mapping: Record<string, string>,
  ctx: PreviewContext,
  findings: Finding[],
): ChartRow[] {
  if (!mapping.code || !mapping.name) return [];
  const existing = new Map(ctx.accounts.map((a) => [accountKey(a.code), a]));
  const seen = new Map<string, { name: string; row: number }>();
  const out: ChartRow[] = [];

  rows.forEach((row, i) => {
    const rowNumber = i + 2; // header is line 1
    const code = value(row, index, mapping.code);
    if (!code) {
      findings.push({ severity: 'warning', code: 'EMPTY_ROW', rowNumber, message: `Ligne ${rowNumber} ignorée : code compte vide. / Row ${rowNumber} skipped: empty account code.` });
      return;
    }
    if (!CODE.test(code)) {
      findings.push({ severity: 'error', code: 'INVALID_ACCOUNT_CODE', rowNumber, message: `Ligne ${rowNumber} : code compte invalide « ${code} ». / Row ${rowNumber}: invalid account code "${code}".`, details: { code } });
      out.push({ rowNumber, action: 'blocked', warnings: 0, code, name: value(row, index, mapping.name), type: null, currency: ctx.functionalCurrency, isActive: true, description: null, exists: false });
      return;
    }
    const name = value(row, index, mapping.name).slice(0, 160);
    if (!name) {
      findings.push({ severity: 'error', code: 'MISSING_ACCOUNT_NAME', rowNumber, message: `Ligne ${rowNumber} : intitulé de compte manquant. / Row ${rowNumber}: account name is missing.`, details: { code } });
      out.push({ rowNumber, action: 'blocked', warnings: 0, code, name: '', type: null, currency: ctx.functionalCurrency, isActive: true, description: null, exists: false });
      return;
    }
    const rawType = value(row, index, mapping.type);
    const type = (rawType ? normalizeAccountType(rawType) : null) ?? optionsType(ctx);
    if (!type) {
      findings.push({ severity: 'error', code: 'INVALID_ACCOUNT_TYPE', rowNumber, message: `Ligne ${rowNumber} : type de compte absent ou inconnu (« ${rawType || '—'} »). Choisissez un type par défaut dans les options. / Row ${rowNumber}: missing or unknown account type. Set a default type in the options.`, details: { code, rawType } });
    }
    const currency = (value(row, index, mapping.currency) || ctx.options?.defaultCurrency || ctx.functionalCurrency).toUpperCase();
    if (!ctx.supportedCurrencies.includes(currency)) {
      findings.push({ severity: 'error', code: 'UNSUPPORTED_CURRENCY', rowNumber, message: `Ligne ${rowNumber} : devise « ${currency} » non prise en charge. / Row ${rowNumber}: currency "${currency}" is not supported.`, details: { code, currency } });
    }
    const activeRaw = normalizeHeader(value(row, index, mapping.isActive));
    const isActive = !['non', 'no', 'false', '0', 'inactif', 'inactive'].includes(activeRaw);
    const key = accountKey(code);
    const duplicate = seen.get(key);
    const prior = existing.get(key);
    let action: ChartRow['action'] = type && ctx.supportedCurrencies.includes(currency) ? 'create' : 'blocked';

    if (prior) {
      action = 'skip';
      findings.push({ severity: 'info', code: 'ACCOUNT_EXISTS', rowNumber, message: `Ligne ${rowNumber} : le compte ${code} existe déjà, il n'est pas modifié. / Row ${rowNumber}: account ${code} already exists and is left untouched.`, details: { code } });
    } else if (duplicate) {
      action = 'blocked';
      findings.push({ severity: 'error', code: 'DUPLICATE_ACCOUNT_CODE', rowNumber, message: `Ligne ${rowNumber} : le code compte ${code} apparaît aussi ligne ${duplicate.row}. / Row ${rowNumber}: account code ${code} already appears on row ${duplicate.row}.`, details: { code, firstRow: duplicate.row } });
    }
    if (!duplicate) seen.set(key, { name, row: rowNumber });

    out.push({
      rowNumber,
      action,
      warnings: 0,
      code,
      name,
      type,
      currency,
      isActive,
      description: value(row, index, mapping.description).slice(0, 400) || null,
      exists: Boolean(prior),
    });
  });
  return out;
}

function optionsType(ctx: PreviewContext): AccountType | null {
  const value = ctx.options?.defaultAccountType;
  if (!value) return null;
  return normalizeAccountType(value);
}

/* -------------------------------------------------------------------------- */
/* Opening balance                                                            */
/* -------------------------------------------------------------------------- */

interface AccountResolver {
  resolve: (code: string) => { account: RefAccount | null; viaMapping: boolean };
  mappedCode: (code: string) => string | null;
}

export function accountResolver(ctx: PreviewContext): AccountResolver {
  const byCode = new Map(ctx.accounts.map((a) => [accountKey(a.code), a]));
  const mapping = new Map(
    Object.entries(ctx.accountMapping ?? {}).map(([from, to]) => [accountKey(from), to]),
  );
  return {
    mappedCode(code: string) {
      const target = mapping.get(accountKey(code));
      return target ? target.trim() : null;
    },
    resolve(code: string) {
      const target = this.mappedCode(code);
      if (target) {
        const account = byCode.get(accountKey(target)) ?? null;
        return { account, viaMapping: true };
      }
      return { account: byCode.get(accountKey(code)) ?? null, viaMapping: false };
    },
  };
}

function previewOpening(
  rows: string[][],
  index: Map<string, number>,
  mapping: Record<string, string>,
  ctx: PreviewContext,
  findings: Finding[],
): { rows: OpeningRow[]; totals: PreviewResult['totals'] } {
  const out: OpeningRow[] = [];
  if (!mapping.accountCode) return { rows: out, totals: null };
  const resolver = accountResolver(ctx);
  if (!mapping.debit && !mapping.credit) {
    findings.push({ severity: 'error', code: 'MISSING_AMOUNT_COLUMN', rowNumber: null, message: "Aucune colonne débit ou crédit n'est associée. / No debit or credit column is mapped." });
    return { rows: out, totals: null };
  }
  const journalCode = ctx.options?.defaultJournalCode ?? 'OD';
  if (!findJournal(ctx, journalCode)) {
    findings.push({ severity: 'error', code: 'JOURNAL_NOT_FOUND', rowNumber: null, message: `Journal « ${journalCode} » inexistant : choisissez un journal pour la reprise d'ouverture. / Journal "${journalCode}" does not exist: choose one for the opening balance.`, details: { journalCode } });
  }
  const openingDate = ctx.options?.openingDate ?? null;
  const parsedDate = openingDate ? parseDate(openingDate) : null;
  if (!openingDate || !parsedDate) {
    findings.push({ severity: 'error', code: 'OPENING_DATE_REQUIRED', rowNumber: null, message: "La date d'ouverture est obligatoire. / The opening date is required." });
  } else if (inClosedPeriod(ctx.periods, parsedDate)) {
    findings.push({ severity: 'error', code: 'PERIOD_CLOSED', rowNumber: null, message: `L'exercice contenant le ${parsedDate} est clôturé. / The period containing ${parsedDate} is closed.`, details: { date: parsedDate } });
  } else if (!inOpenPeriod(ctx.periods, parsedDate)) {
    findings.push({ severity: 'error', code: 'NO_OPEN_PERIOD', rowNumber: null, message: `Aucun exercice ouvert ne couvre le ${parsedDate}. / No open accounting period covers ${parsedDate}.`, details: { date: parsedDate } });
  }
  if (ctx.hasOpeningEntry) {
    findings.push({ severity: 'error', code: 'OPENING_ALREADY_EXISTS', rowNumber: null, message: "Une reprise d'ouverture existe déjà pour cette société ; elle n'est jamais écrasée. / An opening entry already exists for this company; it is never overwritten." });
  }

  let totalDebit = 0n;
  let totalCredit = 0n;
  const seen = new Map<string, number>();

  rows.forEach((row, i) => {
    const rowNumber = i + 2;
    const accountCode = value(row, index, mapping.accountCode);
    if (!accountCode) {
      findings.push({ severity: 'warning', code: 'EMPTY_ROW', rowNumber, message: `Ligne ${rowNumber} ignorée : compte vide. / Row ${rowNumber} skipped: empty account.` });
      return;
    }
    const debit = amountOrNull(value(row, index, mapping.debit), findings, rowNumber, 'NEGATIVE_AMOUNT', 'débit');
    const credit = amountOrNull(value(row, index, mapping.credit), findings, rowNumber, 'NEGATIVE_AMOUNT', 'crédit');
    if (debit === null || credit === null) {
      out.push({ rowNumber, action: 'blocked', warnings: 0, accountCode, resolvedAccountId: null, resolvedCode: null, debit: ZERO, credit: ZERO, description: null, viaMapping: false });
      return;
    }
    if (debit > 0n && credit > 0n) {
      findings.push({ severity: 'error', code: 'DEBIT_AND_CREDIT', rowNumber, message: `Ligne ${rowNumber} : débit et crédit renseignés en même temps. / Row ${rowNumber}: both debit and credit are filled.` });
    }
    if (debit === 0n && credit === 0n) {
      findings.push({ severity: 'warning', code: 'ZERO_LINE', rowNumber, message: `Ligne ${rowNumber} ignorée : montant nul. / Row ${rowNumber} skipped: zero amount.` });
      out.push({ rowNumber, action: 'skip', warnings: 1, accountCode, resolvedAccountId: null, resolvedCode: null, debit: ZERO, credit: ZERO, description: null, viaMapping: false });
      return;
    }
    const { account, viaMapping } = resolver.resolve(accountCode);
    let action: OpeningRow['action'] = 'create';
    if (!account) {
      action = 'blocked';
      findings.push({ severity: 'error', code: 'ACCOUNT_NOT_FOUND', rowNumber, message: `Ligne ${rowNumber} : compte « ${accountCode} » inconnu dans la société ; associez-le ou importez le plan comptable d'abord. / Row ${rowNumber}: account "${accountCode}" is unknown; map it or import the chart first.`, details: { accountCode, suggestion: resolver.mappedCode(accountCode) } });
    } else if (!account.is_active) {
      action = 'blocked';
      findings.push({ severity: 'error', code: 'ACCOUNT_INACTIVE', rowNumber, message: `Ligne ${rowNumber} : le compte ${account.code} est inactif. / Row ${rowNumber}: account ${account.code} is inactive.`, details: { accountCode } });
    }
    if (debit > 0n && credit > 0n) action = 'blocked';
    const dupKey = accountKey(account?.code ?? accountCode);
    if (seen.has(dupKey)) {
      findings.push({ severity: 'error', code: 'DUPLICATE_ACCOUNT_LINE', rowNumber, message: `Ligne ${rowNumber} : compte ${accountCode} déjà présent ligne ${seen.get(dupKey)}. / Row ${rowNumber}: account ${accountCode} already appears on row ${seen.get(dupKey)}.`, details: { accountCode } });
      action = 'blocked';
    } else {
      seen.set(dupKey, rowNumber);
    }
    totalDebit += debit;
    totalCredit += credit;
    out.push({
      rowNumber,
      action,
      warnings: 0,
      accountCode,
      resolvedAccountId: account?.id ?? null,
      resolvedCode: account?.code ?? null,
      debit: formatScaled(debit),
      credit: formatScaled(credit),
      description: value(row, index, mapping.description).slice(0, 240) || null,
      viaMapping,
    });
  });

  const difference = totalDebit - totalCredit;
  if (out.some((r) => r.action !== 'skip') && difference !== 0n) {
    findings.push({
      severity: 'error',
      code: 'OPENING_UNBALANCED',
      rowNumber: null,
      message: `Balance d'ouverture déséquilibrée : débit ${formatScaled(totalDebit)} / crédit ${formatScaled(totalCredit)} (écart ${formatScaled(difference)}). / Opening balance is not balanced (difference ${formatScaled(difference)}).`,
      details: { debit: formatScaled(totalDebit), credit: formatScaled(totalCredit), difference: formatScaled(difference) },
    });
  }
  if (difference !== 0n) out.forEach((r) => { if (r.action === 'create') r.action = 'blocked'; });

  return {
    rows: out,
    totals: {
      debit: formatScaled(totalDebit),
      credit: formatScaled(totalCredit),
      difference: formatScaled(difference),
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Journal entries                                                            */
/* -------------------------------------------------------------------------- */

function findJournal(ctx: PreviewContext, code: string): RefJournal | null {
  const key = normalizeHeader(code);
  return ctx.journals.find((j) => normalizeHeader(j.code) === key) ?? null;
}

function previewEntries(
  rows: string[][],
  index: Map<string, number>,
  mapping: Record<string, string>,
  ctx: PreviewContext,
  findings: Finding[],
): { groups: EntryGroupPreview[]; totals: PreviewResult['totals'] } {
  const groups: EntryGroupPreview[] = [];
  if (!mapping.entryKey || !mapping.entryDate || !mapping.accountCode) {
    return { groups, totals: null };
  }
  if (!mapping.debit && !mapping.credit && !mapping.amount) {
    findings.push({ severity: 'error', code: 'MISSING_AMOUNT_COLUMN', rowNumber: null, message: "Aucune colonne de montant n'est associée. / No amount column is mapped." });
    return { groups, totals: null };
  }
  const resolver = accountResolver(ctx);
  const dayFirst = ctx.options?.dateDayFirst !== false;
  const defaultJournal = ctx.options?.defaultJournalCode ?? 'OD';
  const grouped = new Map<string, { rows: { rowNumber: number; row: string[] }[] }>();

  rows.forEach((row, i) => {
    const key = value(row, index, mapping.entryKey);
    if (!key) {
      findings.push({ severity: 'error', code: 'MISSING_ENTRY_KEY', rowNumber: i + 2, message: `Ligne ${i + 2} : numéro de pièce manquant, impossible de regrouper les lignes. / Row ${i + 2}: missing document number, lines cannot be grouped.` });
      return;
    }
    const bucket = grouped.get(key) ?? { rows: [] };
    bucket.rows.push({ rowNumber: i + 2, row });
    grouped.set(key, bucket);
  });

  const fingerprints = new Set<string>();
  let totalDebit = 0n;
  let totalCredit = 0n;

  for (const [key, bucket] of grouped) {
    const firstRow = bucket.rows[0]!.row;
    const firstNumber = bucket.rows[0]!.rowNumber;
    const rawDate = value(firstRow, index, mapping.entryDate);
    const entryDate = parseDate(rawDate, { dayFirst, excelSerial: true });
    if (!entryDate) {
      findings.push({ severity: 'error', code: 'INVALID_DATE', rowNumber: firstNumber, message: `Pièce ${key} : date « ${rawDate} » invalide ou illisible. / Document ${key}: invalid or unreadable date "${rawDate}".`, details: { key, rawDate } });
    } else if (inClosedPeriod(ctx.periods, entryDate)) {
      findings.push({ severity: 'error', code: 'PERIOD_CLOSED', rowNumber: firstNumber, message: `Pièce ${key} : l'exercice contenant le ${entryDate} est clôturé. / Document ${key}: the period containing ${entryDate} is closed.`, details: { key, entryDate } });
    } else if (!inOpenPeriod(ctx.periods, entryDate)) {
      findings.push({ severity: 'error', code: 'NO_OPEN_PERIOD', rowNumber: firstNumber, message: `Pièce ${key} : aucun exercice ouvert ne couvre le ${entryDate}. / Document ${key}: no open period covers ${entryDate}.`, details: { key, entryDate } });
    }

    // Every line of a document must share the same date and journal.
    for (const { rowNumber, row } of bucket.rows.slice(1)) {
      const other = parseDate(value(row, index, mapping.entryDate), { dayFirst, excelSerial: true });
      if (other && entryDate && other !== entryDate) {
        findings.push({ severity: 'error', code: 'ENTRY_DATE_MISMATCH', rowNumber, message: `Pièce ${key} : dates différentes au sein de la même écriture (${entryDate} / ${other}). / Document ${key}: inconsistent dates inside one entry.`, details: { key, entryDate, other } });
      }
    }

    const journalCodeRaw = (mapping.journalCode ? value(firstRow, index, mapping.journalCode) : '') || defaultJournal;
    const journal = findJournal(ctx, journalCodeRaw);
    if (!journal) {
      findings.push({ severity: 'error', code: 'JOURNAL_NOT_FOUND', rowNumber: firstNumber, message: `Pièce ${key} : journal « ${journalCodeRaw} » inexistant dans la société. / Document ${key}: journal "${journalCodeRaw}" does not exist.`, details: { key, journalCode: journalCodeRaw } });
    }

    const currencyRaw = (mapping.currency ? value(firstRow, index, mapping.currency) : '') || ctx.options?.defaultCurrency || ctx.functionalCurrency;
    const currency = currencyRaw.toUpperCase();
    if (!ctx.supportedCurrencies.includes(currency)) {
      findings.push({ severity: 'error', code: 'UNSUPPORTED_CURRENCY', rowNumber: firstNumber, message: `Pièce ${key} : devise « ${currency} » non prise en charge. / Document ${key}: currency "${currency}" is not supported.`, details: { key, currency } });
    }
    const rateRaw = mapping.exchangeRate ? value(firstRow, index, mapping.exchangeRate) : '';
    const rate = rateRaw ? parseRate(rateRaw) : null;
    if (rateRaw && !rate) {
      findings.push({ severity: 'error', code: 'INVALID_EXCHANGE_RATE', rowNumber: firstNumber, message: `Pièce ${key} : taux de change « ${rateRaw} » invalide. / Document ${key}: invalid exchange rate "${rateRaw}".`, details: { key, rateRaw } });
    }
    if (currency !== ctx.functionalCurrency && !rate) {
      findings.push({ severity: 'error', code: 'EXCHANGE_RATE_REQUIRED', rowNumber: firstNumber, message: `Pièce ${key} : devise ${currency} sans taux de change. / Document ${key}: currency ${currency} without an exchange rate.`, details: { key, currency } });
    }

    const lines: EntryLinePreview[] = [];
    let debitTotal = 0n;
    let creditTotal = 0n;
    for (const { rowNumber, row } of bucket.rows) {
      const accountCode = value(row, index, mapping.accountCode);
      if (!accountCode) {
        findings.push({ severity: 'error', code: 'MISSING_ACCOUNT', rowNumber, message: `Ligne ${rowNumber} : compte manquant. / Row ${rowNumber}: missing account.` });
        continue;
      }
      let debit = mapping.debit ? amountOrNull(value(row, index, mapping.debit), findings, rowNumber, 'NEGATIVE_AMOUNT', 'débit') : 0n;
      let credit = mapping.credit ? amountOrNull(value(row, index, mapping.credit), findings, rowNumber, 'NEGATIVE_AMOUNT', 'crédit') : 0n;
      const signedRaw = mapping.amount ? value(row, index, mapping.amount) : '';
      if (debit === null || credit === null) {
        lines.push({ rowNumber, accountCode, resolvedAccountId: null, resolvedCode: null, description: null, debit: ZERO, credit: ZERO, viaMapping: false });
        continue;
      }
      if (debit === 0n && credit === 0n && signedRaw) {
        // SAP-style: one signed amount plus a debit/credit indicator.
        const amount = parseAmount(signedRaw);
        if (amount === null) {
          findings.push({ severity: 'error', code: 'INVALID_AMOUNT', rowNumber, message: `Ligne ${rowNumber} : montant illisible (${signedRaw}). / Row ${rowNumber}: unreadable amount (${signedRaw}).`, details: { raw: signedRaw } });
          continue;
        }
        // The indicator is read on *each* line: an SAP document carries both
        // a debit line (S/D) and a credit line (H/C).
        const indicator = mapping.dcIndicator ? value(row, index, mapping.dcIndicator) : '';
        const isCredit = mapping.dcIndicator
          ? isCreditIndicator(indicator)
          : amount < 0n;
        if (isCredit === null) {
          findings.push({ severity: 'error', code: 'INVALID_DC_INDICATOR', rowNumber, message: `Ligne ${rowNumber} : sens débit/crédit « ${indicator} » invalide. / Row ${rowNumber}: invalid debit/credit indicator "${indicator}".`, details: { raw: indicator } });
          continue;
        }
        const abs = amount < 0n ? -amount : amount;
        if (isCredit) credit = abs;
        else debit = abs;
      }
      if (debit > 0n && credit > 0n) {
        findings.push({ severity: 'error', code: 'DEBIT_AND_CREDIT', rowNumber, message: `Ligne ${rowNumber} : débit et crédit renseignés en même temps. / Row ${rowNumber}: both debit and credit are filled.` });
      }
      if (debit === 0n && credit === 0n) {
        findings.push({ severity: 'error', code: 'ZERO_LINE', rowNumber, message: `Ligne ${rowNumber} : montant nul, aucune contrepartie n'est inventée. / Row ${rowNumber}: zero amount, no counterpart is invented.` });
      }
      const { account, viaMapping } = resolver.resolve(accountCode);
      if (!account) {
        findings.push({ severity: 'error', code: 'ACCOUNT_NOT_FOUND', rowNumber, message: `Ligne ${rowNumber} : compte « ${accountCode} » inconnu ; la ligne est bloquée. / Row ${rowNumber}: unknown account "${accountCode}"; the line is blocked.`, details: { key, accountCode } });
      } else if (!account.is_active) {
        findings.push({ severity: 'error', code: 'ACCOUNT_INACTIVE', rowNumber, message: `Ligne ${rowNumber} : le compte ${account.code} est inactif. / Row ${rowNumber}: account ${account.code} is inactive.` });
      }
      debitTotal += debit;
      creditTotal += credit;
      lines.push({
        rowNumber,
        accountCode,
        resolvedAccountId: account?.id ?? null,
        resolvedCode: account?.code ?? null,
        description: (mapping.description ? value(row, index, mapping.description) : '').slice(0, 240) || null,
        debit: formatScaled(debit),
        credit: formatScaled(credit),
        viaMapping,
      });
    }

    if (lines.length < 2) {
      findings.push({ severity: 'error', code: 'ENTRY_TOO_FEW_LINES', rowNumber: firstNumber, message: `Pièce ${key} : une écriture doit comporter au moins deux lignes. / Document ${key}: an entry needs at least two lines.` });
    }
    const balanced = debitTotal === creditTotal && debitTotal > 0n && lines.length >= 2;
    if (debitTotal !== creditTotal) {
      findings.push({
        severity: 'error',
        code: 'UNBALANCED_ENTRY',
        rowNumber: firstNumber,
        message: `Pièce ${key} déséquilibrée : débit ${formatScaled(debitTotal)} / crédit ${formatScaled(creditTotal)}. Aucune contrepartie n'est générée automatiquement. / Document ${key} is unbalanced; no balancing line is created.`,
        details: { key, debit: formatScaled(debitTotal), credit: formatScaled(creditTotal) },
      });
    }

    const reference = (mapping.reference ? value(firstRow, index, mapping.reference) : '') || key;
    // Duplicate detection ignores the document number on purpose: two
    // different numbers carrying the same date, journal, currency and lines are
    // a duplicated export, not two entries.
    const fp = fingerprint([
      'entry',
      entryDate,
      journalCodeRaw,
      currency,
      formatScaled(debitTotal),
      formatScaled(creditTotal),
      lines.map((l) => [l.resolvedCode ?? l.accountCode, l.debit, l.credit]),
    ]);
    const alreadyImported = ctx.importedFingerprints?.has(`entry:${key}`) ?? false;
    if (alreadyImported) {
      findings.push({ severity: 'info', code: 'ENTRY_ALREADY_IMPORTED', rowNumber: firstNumber, message: `Pièce ${key} déjà importée : elle sera ignorée. / Document ${key} already imported: it will be skipped.`, details: { key } });
    }
    if (fingerprints.has(fp)) {
      findings.push({ severity: 'warning', code: 'DUPLICATE_ENTRY_IN_FILE', rowNumber: firstNumber, message: `Pièce ${key} : contenu identique à une autre écriture du fichier. / Document ${key}: identical to another entry of the file.`, details: { key } });
    }
    fingerprints.add(fp);

    totalDebit += debitTotal;
    totalCredit += creditTotal;
    groups.push({
      key,
      entryDate,
      journalCode: journal?.code ?? journalCodeRaw,
      journalId: journal?.id ?? null,
      reference,
      description: (mapping.description ? value(firstRow, index, mapping.description) : '').slice(0, 240) || `Import ${key}`,
      currency,
      exchangeRate: rate,
      fingerprint: fp,
      debitTotal: formatScaled(debitTotal),
      creditTotal: formatScaled(creditTotal),
      balanced,
      alreadyImported,
      action: balanced && journal && entryDate && !alreadyImported && inOpenPeriod(ctx.periods, entryDate) ? 'create' : alreadyImported ? 'skip' : 'blocked',
      lines,
    });
  }

  return {
    groups,
    totals: {
      debit: formatScaled(totalDebit),
      credit: formatScaled(totalCredit),
      difference: formatScaled(totalDebit - totalCredit),
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Customers                                                                  */
/* -------------------------------------------------------------------------- */

function previewCustomers(
  rows: string[][],
  index: Map<string, number>,
  mapping: Record<string, string>,
  ctx: PreviewContext,
  findings: Finding[],
): CustomerRow[] {
  const out: CustomerRow[] = [];
  if (!mapping.name) return out;
  const existingNames = new Set((ctx.customers ?? []).map((c) => normalizeHeader(c.name)));
  const existingBrn = new Set(
    (ctx.customers ?? []).map((c) => (c.brn ?? '').trim().toLowerCase()).filter(Boolean),
  );
  const seen = new Map<string, number>();

  rows.forEach((row, i) => {
    const rowNumber = i + 2;
    const name = value(row, index, mapping.name).slice(0, 160);
    if (!name) {
      findings.push({ severity: 'warning', code: 'EMPTY_ROW', rowNumber, message: `Ligne ${rowNumber} ignorée : nom de client vide. / Row ${rowNumber} skipped: empty customer name.` });
      return;
    }
    const brn = (value(row, index, mapping.brn) || '').slice(0, 32) || null;
    const email = (value(row, index, mapping.email) || '').slice(0, 160) || null;
    if (email && !EMAIL.test(email)) {
      findings.push({ severity: 'warning', code: 'INVALID_EMAIL', rowNumber, message: `Ligne ${rowNumber} : courriel « ${email} » douteux, il sera conservé tel quel. / Row ${rowNumber}: suspicious email "${email}" is kept as is.`, details: { email } });
    }
    const countryRaw = (value(row, index, mapping.country) || 'MU').toUpperCase();
    const country = COUNTRY.test(countryRaw) ? countryRaw : 'MU';
    if (countryRaw !== country) {
      findings.push({ severity: 'warning', code: 'INVALID_COUNTRY', rowNumber, message: `Ligne ${rowNumber} : pays « ${countryRaw} » remplacé par MU (code ISO à deux lettres requis). / Row ${rowNumber}: country "${countryRaw}" replaced by MU (ISO two-letter code required).`, details: { countryRaw } });
    }
    const termsRaw = value(row, index, mapping.paymentTermsDays);
    let paymentTermsDays: number | null = null;
    if (termsRaw) {
      const parsed = Number(termsRaw.replace(/[^0-9-]/g, ''));
      if (!Number.isInteger(parsed) || parsed < 0 || parsed > 365) {
        findings.push({ severity: 'warning', code: 'INVALID_PAYMENT_TERMS', rowNumber, message: `Ligne ${rowNumber} : délai de paiement « ${termsRaw} » ignoré (0-365 jours). / Row ${rowNumber}: payment terms "${termsRaw}" ignored (0-365 days).`, details: { termsRaw } });
      } else paymentTermsDays = parsed;
    }
    const exists =
      existingNames.has(normalizeHeader(name)) || (brn ? existingBrn.has(brn.toLowerCase()) : false);
    const duplicate = seen.get(normalizeHeader(name));
    let action: CustomerRow['action'] = 'create';
    if (exists) {
      action = 'skip';
      findings.push({ severity: 'info', code: 'CUSTOMER_EXISTS', rowNumber, message: `Ligne ${rowNumber} : le client « ${name} » existe déjà, il n'est pas modifié. / Row ${rowNumber}: customer "${name}" already exists and is left untouched.`, details: { name } });
    } else if (duplicate) {
      action = 'skip';
      findings.push({ severity: 'warning', code: 'DUPLICATE_CUSTOMER_IN_FILE', rowNumber, message: `Ligne ${rowNumber} : client « ${name} » déjà présent ligne ${duplicate}. / Row ${rowNumber}: customer "${name}" already appears on row ${duplicate}.`, details: { name, firstRow: duplicate } });
    } else {
      seen.set(normalizeHeader(name), rowNumber);
    }
    out.push({
      rowNumber,
      action,
      warnings: 0,
      name,
      legalName: (value(row, index, mapping.legalName) || '').slice(0, 160) || null,
      brn,
      vatNumber: (value(row, index, mapping.vatNumber) || '').slice(0, 32) || null,
      email,
      phone: (value(row, index, mapping.phone) || '').slice(0, 40) || null,
      addressLine1: (value(row, index, mapping.addressLine1) || '').slice(0, 160) || null,
      city: (value(row, index, mapping.city) || '').slice(0, 80) || null,
      postcode: (value(row, index, mapping.postcode) || '').slice(0, 20) || null,
      country,
      paymentTermsDays,
      exists,
    });
  });
  return out;
}

/* -------------------------------------------------------------------------- */
/* Companies                                                                  */
/* -------------------------------------------------------------------------- */

function previewCompanies(
  rows: string[][],
  index: Map<string, number>,
  mapping: Record<string, string>,
  ctx: PreviewContext,
  findings: Finding[],
): CompanyRowPreview[] {
  const out: CompanyRowPreview[] = [];
  if (!mapping.name) return out;
  const existingByName = new Map((ctx.companies ?? []).map((c) => [normalizeHeader(c.name), c]));
  const existingByBrn = new Map(
    (ctx.companies ?? [])
      .filter((c) => c.brn)
      .map((c) => [(c.brn ?? '').trim().toLowerCase(), c]),
  );
  const seen = new Set<string>();
  const currentYear = Number(new Date().toISOString().slice(0, 4));
  const dayFirst = ctx.options?.dateDayFirst !== false;
  const createAllowed = ctx.options?.createCompanies === true;

  rows.forEach((row, i) => {
    const rowNumber = i + 2;
    const name = value(row, index, mapping.name).slice(0, 160);
    if (!name) {
      findings.push({ severity: 'warning', code: 'EMPTY_ROW', rowNumber, message: `Ligne ${rowNumber} ignorée : nom de société vide. / Row ${rowNumber} skipped: empty company name.` });
      return;
    }
    const brn = (value(row, index, mapping.brn) || '').slice(0, 32) || null;
    const crn = (value(row, index, mapping.crn) || '').slice(0, 32) || null;
    const matchedByName = existingByName.get(normalizeHeader(name));
    const matchedByBrn = brn ? existingByBrn.get(brn.toLowerCase()) : undefined;
    // A name similarity is NEVER an identification: only an explicit BRN match
    // can point at an existing dossier, and even then the user must confirm.
    const match = matchedByBrn ?? null;
    let action: CompanyRowPreview['action'] = 'create';

    if (brn && matchedByBrn) {
      action = 'skip';
      findings.push({ severity: 'info', code: 'COMPANY_ALREADY_EXISTS', rowNumber, message: `Ligne ${rowNumber} : une société avec le BRN ${brn} existe déjà (${matchedByBrn.name}) ; aucune affectation automatique. / Row ${rowNumber}: a company with BRN ${brn} already exists; no automatic assignment.`, details: { brn, companyId: matchedByBrn.id } });
    } else if (matchedByName) {
      action = 'blocked';
      findings.push({ severity: 'error', code: 'COMPANY_NAME_CONFLICT', rowNumber, message: `Ligne ${rowNumber} : « ${name} » ressemble à la société existante « ${matchedByName.name} ». Une ressemblance de nom n'est jamais une identification : vérifiez le BRN ou renommez. / Row ${rowNumber}: name similarity is never an identification; check the BRN.`, details: { name, companyId: matchedByName.id } });
    } else if (!createAllowed) {
      action = 'blocked';
      findings.push({ severity: 'error', code: 'COMPANY_CREATION_NOT_ALLOWED', rowNumber, message: `Ligne ${rowNumber} : la création de sociétés n'est pas autorisée pour ce lot. / Row ${rowNumber}: company creation is not allowed for this batch.` });
    } else if (seen.has(normalizeHeader(name))) {
      action = 'blocked';
      findings.push({ severity: 'error', code: 'DUPLICATE_COMPANY_IN_FILE', rowNumber, message: `Ligne ${rowNumber} : société « ${name} » déjà présente dans le fichier. / Row ${rowNumber}: company "${name}" already appears in the file.` });
    } else {
      seen.add(normalizeHeader(name));
    }

    const currency = (value(row, index, mapping.currency) || ctx.functionalCurrency || 'MUR').toUpperCase();
    if (!ctx.supportedCurrencies.includes(currency)) {
      findings.push({ severity: 'error', code: 'UNSUPPORTED_CURRENCY', rowNumber, message: `Ligne ${rowNumber} : devise « ${currency} » non prise en charge. / Row ${rowNumber}: currency "${currency}" is not supported.`, details: { currency } });
      action = 'blocked';
    }
    const startRaw = value(row, index, mapping.financialYearStart);
    const endRaw = value(row, index, mapping.financialYearEnd);
    const financialYearStart = parseDate(startRaw, { dayFirst }) ?? `${currentYear}-01-01`;
    const financialYearEnd = parseDate(endRaw, { dayFirst }) ?? `${currentYear}-12-31`;
    if (startRaw && !parseDate(startRaw, { dayFirst })) {
      findings.push({ severity: 'error', code: 'INVALID_DATE', rowNumber, message: `Ligne ${rowNumber} : début d'exercice « ${startRaw} » invalide. / Row ${rowNumber}: invalid financial year start "${startRaw}".` });
      action = 'blocked';
    }
    if (endRaw && !parseDate(endRaw, { dayFirst })) {
      findings.push({ severity: 'error', code: 'INVALID_DATE', rowNumber, message: `Ligne ${rowNumber} : fin d'exercice « ${endRaw} » invalide. / Row ${rowNumber}: invalid financial year end "${endRaw}".` });
      action = 'blocked';
    }
    if (financialYearEnd <= financialYearStart) {
      findings.push({ severity: 'error', code: 'INVALID_FINANCIAL_YEAR', rowNumber, message: `Ligne ${rowNumber} : la fin d'exercice doit suivre son début. / Row ${rowNumber}: financial year end must be after its start.` });
      action = 'blocked';
    }

    out.push({
      rowNumber,
      action,
      warnings: 0,
      name,
      brn,
      crn,
      vatNumber: (value(row, index, mapping.vatNumber) || '').slice(0, 32) || null,
      currency,
      financialYearStart,
      financialYearEnd,
      registeredAddress: (value(row, index, mapping.registeredAddress) || '').slice(0, 240) || null,
      businessActivity: (value(row, index, mapping.businessActivity) || '').slice(0, 240) || null,
      matchesCompanyId: match?.id ?? null,
    });
  });
  return out;
}
