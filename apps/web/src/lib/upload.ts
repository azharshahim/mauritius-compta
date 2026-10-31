/**
 * Shared upload policy for accounting files (migration + bank).
 *
 * Android's Storage Access Framework filters files by **MIME type**, not by the
 * file extension. Samsung "My Files" commonly reports a downloaded `.csv` as
 * `text/comma-separated-values`, `text/plain` or `application/octet-stream`
 * instead of `text/csv`, so an `accept` attribute containing only extensions
 * (or only `text/csv`) greys the file out: the provider considers it not
 * allowed. We therefore advertise every MIME family those pickers may return,
 * plus the extensions for desktop browsers.
 *
 * Because `accept` is only a picker hint — never a security control — the
 * selected file is validated again here (extension/size), and its content is
 * parsed and validated by the API/demo engine.
 */

export const ACCOUNTING_FILE_EXTENSIONS = ['csv', 'tsv', 'txt', 'xlsx'] as const;

/** MIME types reported by Android providers, Excel and browsers. */
export const ACCOUNTING_FILE_MIME_TYPES = [
  'text/*',
  'text/csv',
  'text/comma-separated-values',
  'text/x-comma-separated-values',
  'text/x-csv',
  'application/csv',
  'application/x-csv',
  'application/x-comma-separated-values',
  'application/tab-separated-values',
  'text/tab-separated-values',
  'text/plain',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/zip',
  'application/x-zip-compressed',
  // Generic type used by some Downloads/My Files providers when the MIME is
  // unknown. The real format is checked after selection.
  'application/octet-stream',
] as const;

export const ACCOUNTING_UPLOAD_ACCEPT = [
  ...ACCOUNTING_FILE_EXTENSIONS.map((extension) => `.${extension}`),
  ...ACCOUNTING_FILE_MIME_TYPES,
].join(',');

export type AccountingUploadRejection = 'empty' | 'too-large' | 'unsupported';

export interface UploadCandidate {
  name: string;
  size: number;
  type?: string;
}

export function fileExtension(name: string): string | null {
  const match = /\.([a-z0-9]+)$/i.exec(name.trim());
  return match ? match[1]!.toLowerCase() : null;
}

/**
 * Returns the detected format, or `null` when the candidate is not a supported
 * accounting file. A file named `.pdf` is rejected even if its MIME is generic;
 * a file without extension is only accepted when its MIME is unambiguous.
 */
export function accountingFileFormat(file: UploadCandidate): 'csv' | 'tsv' | 'txt' | 'xlsx' | null {
  const extension = fileExtension(file.name);
  if (extension) {
    return (ACCOUNTING_FILE_EXTENSIONS as readonly string[]).includes(extension)
      ? (extension as 'csv' | 'tsv' | 'txt' | 'xlsx')
      : null;
  }
  const mime = (file.type ?? '').toLowerCase().split(';')[0]!.trim();
  if (
    mime === 'text/csv' ||
    mime === 'text/comma-separated-values' ||
    mime === 'text/x-comma-separated-values' ||
    mime === 'application/csv' ||
    mime === 'application/x-csv' ||
    mime === 'application/x-comma-separated-values' ||
    mime === 'text/x-csv'
  ) {
    return 'csv';
  }
  if (mime === 'text/tab-separated-values' || mime === 'application/tab-separated-values') {
    return 'tsv';
  }
  if (mime === 'text/plain') return 'txt';
  if (mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') return 'xlsx';
  // `application/octet-stream` / `application/zip` without a filename extension
  // are too ambiguous: the server could not label the report reliably.
  return null;
}

/** Last client-side gate before reading the bytes. `null` means accepted. */
export function validateAccountingUpload(
  file: UploadCandidate,
  maxBytes: number,
): AccountingUploadRejection | null {
  if (file.size === 0) return 'empty';
  if (file.size > maxBytes) return 'too-large';
  if (!accountingFileFormat(file)) return 'unsupported';
  return null;
}
