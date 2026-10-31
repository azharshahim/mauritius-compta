import { unzipSync } from 'fflate';

/**
 * File parsing of the migration assistant.
 *
 * CSV / TSV are parsed with an RFC 4180 state machine; XLSX is read by
 * unzipping the container and reading the XML parts directly (no macro, no
 * formula, no external link, no embedded object is ever evaluated). Only the
 * cached value of a formula cell is used, exactly like Excel displays it.
 */

export const MAX_ROWS = 20_000;
export const MAX_COLUMNS = 80;
export const MAX_CELL_CHARS = 1_000;
export const MAX_SHEETS = 20;
/** Upper bound for the decompressed OOXML parts we read. */
const MAX_UNZIPPED_BYTES = 60 * 1024 * 1024;

export interface SheetData {
  name: string;
  headers: string[];
  rows: string[][];
}

export interface ParsedFile {
  format: 'csv' | 'tsv' | 'xlsx';
  encoding: string;
  delimiter: string | null;
  sheets: SheetData[];
  /** Non blocking remarks worth showing in the wizard (ignored parts, limits). */
  notes: string[];
  truncated: boolean;
}

export class MigrationParseError extends Error {
  constructor(
    readonly code:
      | 'UNSUPPORTED_FORMAT'
      | 'EMPTY_FILE'
      | 'MALFORMED_FILE'
      | 'TOO_MANY_ROWS'
      | 'NO_TABLE'
      | 'ENCRYPTED_FILE',
    message: string,
  ) {
    super(message);
    this.name = 'MigrationParseError';
  }
}

/* -------------------------------------------------------------------------- */
/* Text decoding                                                              */
/* -------------------------------------------------------------------------- */

const utf8Strict = new TextDecoder('utf-8', { fatal: true });

/**
 * Decodes CSV bytes: UTF-8 (with or without BOM), UTF-16 LE/BE with BOM, and
 * Windows-1252 as the legacy fallback used by older French Excel exports.
 */
export function decodeText(bytes: Uint8Array): { text: string; encoding: string } {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { text: new TextDecoder('utf-8').decode(bytes.subarray(3)), encoding: 'utf-8-bom' };
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return { text: new TextDecoder('utf-16le').decode(bytes.subarray(2)), encoding: 'utf-16le' };
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    const swapped = new Uint8Array(bytes.length - 2);
    for (let i = 2; i + 1 < bytes.length; i += 2) {
      swapped[i - 2] = bytes[i + 1]!;
      swapped[i - 1] = bytes[i]!;
    }
    return { text: new TextDecoder('utf-16le').decode(swapped), encoding: 'utf-16be' };
  }
  try {
    return { text: utf8Strict.decode(bytes), encoding: 'utf-8' };
  } catch {
    try {
      return { text: new TextDecoder('windows-1252').decode(bytes), encoding: 'windows-1252' };
    } catch {
      return { text: new TextDecoder('utf-8').decode(bytes), encoding: 'utf-8-lossy' };
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Delimited text                                                             */
/* -------------------------------------------------------------------------- */

/** Counts candidate separators outside quoted fields in the first lines. */
export function detectDelimiter(text: string): { delimiter: string; confidence: number } {
  const candidates = [',', ';', '\t', '|'];
  const lines = text.split(/\r?\n/).filter((l) => l.trim()).slice(0, 8);
  let best = { delimiter: ',', confidence: 0 };
  for (const candidate of candidates) {
    const counts = lines.map((line) => countOutsideQuotes(line, candidate));
    if (counts.length === 0) continue;
    const first = counts[0]!;
    if (first === 0) continue;
    const consistent = counts.filter((c) => c === first).length;
    const confidence = consistent / counts.length;
    if (first > 0 && (confidence > best.confidence || (confidence === best.confidence && first > 1))) {
      best = { delimiter: candidate, confidence };
    }
  }
  return best;
}

function countOutsideQuotes(line: string, separator: string): number {
  let quoted = false;
  let count = 0;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]!;
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') i += 1;
      else quoted = !quoted;
    } else if (!quoted && ch === separator) count += 1;
  }
  return count;
}

export interface CsvParseResult {
  rows: string[][];
  truncated: boolean;
  notes: string[];
  delimiter: string;
}

/**
 * RFC 4180 parser: quoted fields, doubled quotes, CRLF/LF, trailing newline and
 * embedded line breaks. Never evaluates anything, never trims meaningful inner
 * spaces of a quoted label (only outer padding is removed).
 */
export function parseDelimited(text: string, delimiter: string, maxRows = MAX_ROWS): CsvParseResult {
  const rows: string[][] = [];
  const notes: string[] = [];
  let field = '';
  let row: string[] = [];
  let quoted = false;
  let truncated = false;
  let i = 0;
  let endedWithQuote = false;

  const pushField = () => {
    row.push(field.length > MAX_CELL_CHARS ? field.slice(0, MAX_CELL_CHARS) : field);
    field = '';
  };
  const pushRow = () => {
    pushField();
    const trimmed = row.map((c) => c.trim());
    const isEmpty = trimmed.every((c) => c === '');
    if (!isEmpty) {
      if (rows.length >= maxRows) {
        truncated = true;
        return false;
      }
      rows.push(trimmed.slice(0, MAX_COLUMNS));
      if (trimmed.length > MAX_COLUMNS && notes.length === 0) {
        notes.push(`Only the first ${MAX_COLUMNS} columns are imported.`);
      }
    }
    row = [];
    return true;
  };

  while (i < text.length) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        endedWithQuote = true;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"' && field.trim() === '') {
      quoted = true;
      field = '';
      endedWithQuote = true;
      i += 1;
      continue;
    }
    if (ch === delimiter) {
      pushField();
      endedWithQuote = false;
      i += 1;
      continue;
    }
    if (ch === '\r' || ch === '\n') {
      const keepGoing = pushRow();
      endedWithQuote = false;
      i += ch === '\r' && text[i + 1] === '\n' ? 2 : 1;
      if (!keepGoing) break;
      continue;
    }
    field += ch;
    endedWithQuote = false;
    i += 1;
  }
  if (quoted) {
    notes.push('The file ends inside a quoted field; the last cell was repaired.');
  }
  if (field !== '' || row.length > 0) pushRow();
  if (endedWithQuote) notes.push('Quoted fields were detected and decoded.');
  if (truncated) notes.push(`Only the first ${maxRows} rows are analysed.`);

  return { rows, truncated, notes, delimiter };
}

/** Splits a raw matrix into a header row plus data rows, de-duplicating headers. */
export function toSheet(name: string, rows: string[][]): SheetData {
  const headerIndex = rows.findIndex((r) => r.filter((c) => c !== '').length >= 2);
  if (headerIndex < 0) return { name, headers: [], rows: [] };
  const rawHeaders = rows[headerIndex]!;
  const seen = new Map<string, number>();
  const headers = rawHeaders.map((h, index) => {
    const base = h.trim() || `Column ${index + 1}`;
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    return count > 1 ? `${base} (${count})` : base;
  });
  // Drop columns whose header is empty *and* whose cells are all empty.
  const data = rows.slice(headerIndex + 1).filter((r) => r.some((c) => c !== ''));
  const width = Math.max(headers.length, ...data.map((r) => r.length));
  const keep: number[] = [];
  for (let c = 0; c < width; c += 1) {
    const header = (headers[c] ?? '').trim();
    const hasData = data.some((r) => (r[c] ?? '').trim() !== '');
    if (header || hasData) keep.push(c);
  }
  return {
    name,
    headers: keep.map((c) => headers[c] ?? `Column ${c + 1}`),
    rows: data.map((r) => keep.map((c) => (r[c] ?? '').trim())),
  };
}

/* -------------------------------------------------------------------------- */
/* XLSX                                                                       */
/* -------------------------------------------------------------------------- */

function decodeXml(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function attr(tag: string, name: string): string | null {
  const match = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`).exec(tag);
  if (!match) return null;
  return decodeXml(match[2] ?? match[3] ?? '');
}

function textOf(fragment: string): string {
  const parts = [...fragment.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((m) => decodeXml(m[1]!));
  return parts.join('');
}

function columnIndex(ref: string | null, fallback: number): number {
  if (!ref) return fallback;
  const letters = /^([A-Z]+)/i.exec(ref);
  if (!letters) return fallback;
  let index = 0;
  for (const ch of letters[1]!.toUpperCase()) index = index * 26 + (ch.charCodeAt(0) - 64);
  return index - 1;
}

/** Excel built-in date formats (14-22, 45-47). */
const BUILTIN_DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);

function dateStyles(xml: string | null): Set<number> {
  const result = new Set<number>();
  if (!xml) return result;
  const custom = new Map<number, string>();
  for (const match of xml.matchAll(/<numFmt\b([^>]*)\/?>/g)) {
    const id = Number(attr(match[0], 'numFmtId'));
    const code = attr(match[0], 'formatCode') ?? '';
    if (Number.isFinite(id)) custom.set(id, code);
  }
  const cellXfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(xml);
  if (!cellXfs) return result;
  const xfs = [...cellXfs[1]!.matchAll(/<xf\b([^>]*?)\/?>/g)];
  xfs.forEach((xf, index) => {
    const id = Number(attr(xf[0], 'numFmtId') ?? '0');
    const code = custom.get(id);
    const isDate =
      BUILTIN_DATE_FORMATS.has(id) ||
      (code ? /[dmy]/i.test(code.replace(/\[[^\]]*\]/g, '').replace(/"[^"]*"/g, '')) : false);
    if (isDate) result.add(index);
  });
  return result;
}

const DAY_MS = 86_400_000;
function excelSerialToIso(serial: number): string {
  const dt = new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * DAY_MS);
  return dt.toISOString().slice(0, 10);
}

/**
 * Reads an XLSX workbook. `.xls` (BIFF binary) and `.xlsm` (macros) are
 * rejected with an explicit message: macros are never executed.
 */
export function parseXlsx(bytes: Uint8Array): ParsedFile {
  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    throw new MigrationParseError(
      'UNSUPPORTED_FORMAT',
      'This is not an XLSX file. The legacy .xls format must be saved as .xlsx or .csv first.',
    );
  }
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch {
    throw new MigrationParseError('MALFORMED_FILE', 'The XLSX archive cannot be read.');
  }
  let total = 0;
  for (const entry of Object.values(files)) total += entry.length;
  if (total > MAX_UNZIPPED_BYTES) {
    throw new MigrationParseError('MALFORMED_FILE', 'The XLSX archive expands beyond the allowed size.');
  }
  if (files['xl/vbaProject.bin']) {
    throw new MigrationParseError(
      'UNSUPPORTED_FORMAT',
      'This workbook contains macros. Macros are never executed; save it as .xlsx without macros.',
    );
  }
  if (!files['xl/workbook.xml']) {
    throw new MigrationParseError('ENCRYPTED_FILE', 'Encrypted or invalid workbook: no readable sheet found.');
  }

  const utf8 = new TextDecoder('utf-8');
  const read = (path: string): string | null =>
    files[path] ? utf8.decode(files[path]!) : null;

  const workbook = read('xl/workbook.xml')!;
  const rels = read('xl/_rels/workbook.xml.rels') ?? '';
  const targets = new Map<string, string>();
  for (const rel of rels.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
    const id = attr(rel[1]!, 'Id');
    let target = attr(rel[1]!, 'Target');
    if (!id || !target) continue;
    if (target.startsWith('/')) target = target.slice(1);
    else if (!target.startsWith('xl/')) target = `xl/${target}`;
    targets.set(id, target.replace(/^xl\/\.\.\//, ''));
  }

  const sheetTags = [...workbook.matchAll(/<sheet\b([^>]*)\/?>/g)].slice(0, MAX_SHEETS);
  if (sheetTags.length === 0) throw new MigrationParseError('NO_TABLE', 'The workbook has no sheet.');

  const sharedStringsXml = read('xl/sharedStrings.xml') ?? '';
  const sharedStrings = [...sharedStringsXml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((m) =>
    textOf(m[1]!),
  );
  const styleDate = dateStyles(read('xl/styles.xml'));

  const notes: string[] = [];
  const sheets: SheetData[] = [];
  let truncated = false;

  for (const sheetTag of sheetTags) {
    const name = attr(sheetTag[1]!, 'name') ?? `Sheet ${sheets.length + 1}`;
    const relId = attr(sheetTag[1]!, 'r:id');
    const path = relId ? targets.get(relId) : null;
    const xml = path ? read(path) : null;
    if (!xml) {
      notes.push(`Sheet "${name}" could not be read.`);
      continue;
    }
    if (sheets.length === 0) {
      if (/<f\b/.test(xml)) notes.push('Formulas are never evaluated: only the cached value is used.');
      if (/<externalLink|externalReference/i.test(xml + workbook)) {
        notes.push('External workbook links are ignored, never followed.');
      }
    }
    const matrix: string[][] = [];
    let rowCount = 0;
    for (const rowMatch of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
      rowCount += 1;
      if (rowCount > MAX_ROWS) {
        truncated = true;
        break;
      }
      const cells: string[] = [];
      let position = 0;
      for (const cellMatch of rowMatch[1]!.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const tag = cellMatch[1] ?? '';
        const body = cellMatch[2] ?? '';
        const ref = attr(tag, 'r');
        const type = attr(tag, 't') ?? 'n';
        const style = Number(attr(tag, 's') ?? '-1');
        const index = columnIndex(ref, position);
        position = index + 1;
        if (index >= MAX_COLUMNS) continue;

        let value = '';
        if (type === 's') {
          const raw = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
          value = raw ? (sharedStrings[Number(raw)] ?? '') : '';
        } else if (type === 'inlineStr') {
          value = textOf(body);
        } else if (type === 'b') {
          value = /<v>1<\/v>/.test(body) ? 'TRUE' : 'FALSE';
        } else if (type === 'e') {
          value = '';
        } else {
          const raw = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? '';
          value = raw;
          if (raw && !Number.isNaN(Number(raw)) && styleDate.has(style)) {
            value = excelSerialToIso(Number(raw));
          }
        }
        value = decodeXml(value).replace(/\r?\n/g, ' ').trim();
        if (value.length > MAX_CELL_CHARS) value = value.slice(0, MAX_CELL_CHARS);
        while (cells.length < index) cells.push('');
        cells[index] = value;
      }
      if (cells.some((c) => c !== '')) matrix.push(cells);
    }
    const sheet = toSheet(name, matrix);
    if (sheet.headers.length > 0) sheets.push(sheet);
  }

  if (sheets.length === 0) {
    throw new MigrationParseError('NO_TABLE', 'No readable table was found in this workbook.');
  }
  if (truncated) notes.push(`Only the first ${MAX_ROWS} rows are analysed.`);

  return { format: 'xlsx', encoding: 'utf-8', delimiter: null, sheets, notes, truncated };
}

/* -------------------------------------------------------------------------- */
/* Entry point                                                                */
/* -------------------------------------------------------------------------- */

const XLSX_MAGIC = [0x50, 0x4b, 0x03, 0x04];

export function looksLikeZip(bytes: Uint8Array): boolean {
  return XLSX_MAGIC.every((b, i) => bytes[i] === b);
}

/** Parses any accepted upload. `fileName` only guides the format decision. */
export function parseUpload(fileName: string, bytes: Uint8Array): ParsedFile {
  if (bytes.length === 0) throw new MigrationParseError('EMPTY_FILE', 'The file is empty.');
  const lower = fileName.toLowerCase();
  if (/\.(xlsm|xlsb)$/.test(lower)) {
    throw new MigrationParseError(
      'UNSUPPORTED_FORMAT',
      'Macro-enabled workbooks are not accepted. Save the file as .xlsx or .csv.',
    );
  }
  if (/\.xls$/.test(lower) && !looksLikeZip(bytes)) {
    throw new MigrationParseError(
      'UNSUPPORTED_FORMAT',
      'The legacy .xls format is not read. Save the file as .xlsx or .csv.',
    );
  }
  if (/\.(xlsx|zip)$/.test(lower) || looksLikeZip(bytes)) {
    return parseXlsx(bytes);
  }
  if (/\.(csv|txt|tsv)$/.test(lower) || !lower.includes('.')) {
    const { text, encoding } = decodeText(bytes);
    if (!text.trim()) throw new MigrationParseError('EMPTY_FILE', 'The file contains no text.');
    const detected = detectDelimiter(text);
    const extensionDelimiter = /\.tsv$/.test(lower) ? '\t' : null;
    const delimiter = extensionDelimiter ?? (detected.confidence > 0 ? detected.delimiter : ',');
    const parsed = parseDelimited(text, delimiter);
    const sheet = toSheet('CSV', parsed.rows);
    if (sheet.headers.length < 2) {
      throw new MigrationParseError('NO_TABLE', 'No table with at least two columns was detected.');
    }
    return {
      format: delimiter === '\t' ? 'tsv' : 'csv',
      encoding,
      delimiter,
      sheets: [sheet],
      notes: [...parsed.notes],
      truncated: parsed.truncated,
    };
  }
  throw new MigrationParseError(
    'UNSUPPORTED_FORMAT',
    'Unsupported file type. Accepted: .csv, .tsv, .xlsx.',
  );
}
