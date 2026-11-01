/**
 * Mission 34 — ZIP packaging and canonical JSON helpers.
 *
 * Archives are only ever read back after authenticated decryption. Every entry
 * name is still validated before extraction: a malicious or corrupted archive
 * must never be able to write outside the target directory.
 */
import path from 'node:path';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { AppError } from '../lib/errors.js';
import { sha256Hex } from './crypto.js';

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

/** Order-independent checksum of a set of rows. */
export function rowsChecksum(rows: Record<string, unknown>[]): string {
  const serialised = rows.map(canonicalJson).sort();
  return sha256Hex(`[${serialised.join(',')}]`);
}

export function packageZip(entries: Record<string, Uint8Array>): Uint8Array {
  for (const name of Object.keys(entries)) assertSafeArchivePath(name);
  return zipSync(entries, { level: 6 });
}

export interface UnpackedArchive {
  files: Map<string, Uint8Array>;
  totalBytes: number;
}

/**
 * Rejects absolute paths, backslashes, NUL bytes, `.`/`..` segments and names
 * that would normalise differently from their literal form.
 */
export function assertSafeArchivePath(name: string): void {
  if (!name || name.length > 400) {
    throw new AppError('BACKUP_ARCHIVE_INVALID', 400, 'An archive entry has an invalid name');
  }
  if (name.includes('\0') || name.includes('\\') || name.startsWith('/')) {
    throw new AppError('BACKUP_ARCHIVE_INVALID', 400, `Unsafe archive path: ${name}`);
  }
  if (name.split('/').some((part) => part === '..' || part === '.' || part === '')) {
    throw new AppError('BACKUP_ARCHIVE_INVALID', 400, `Unsafe archive path: ${name}`);
  }
  const normalised = path.posix.normalize(name);
  if (normalised !== name || normalised.startsWith('../')) {
    throw new AppError('BACKUP_ARCHIVE_INVALID', 400, `Unsafe archive path: ${name}`);
  }
}

export function unpackZip(data: Uint8Array, maxUncompressedBytes: number): UnpackedArchive {
  let totalBytes = 0;
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(data, {
      filter: (file) => {
        assertSafeArchivePath(file.name);
        totalBytes += file.originalSize;
        if (totalBytes > maxUncompressedBytes) {
          throw new AppError(
            'BACKUP_TOO_LARGE',
            413,
            'The backup expands beyond the configured size limit',
          );
        }
        return true;
      },
    });
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError('BACKUP_ARCHIVE_INVALID', 400, 'The ZIP payload is invalid or corrupted');
  }
  return { files: new Map(Object.entries(files)), totalBytes };
}

export function jsonEntry(value: unknown): Uint8Array {
  return strToU8(JSON.stringify(value, null, 2));
}

export function textEntry(value: string): Uint8Array {
  return strToU8(value);
}

export function readJsonEntry<T>(files: Map<string, Uint8Array>, name: string): T {
  const entry = files.get(name);
  if (!entry) throw new AppError('BACKUP_ARCHIVE_INVALID', 400, `Missing archive entry: ${name}`);
  try {
    return JSON.parse(strFromU8(entry)) as T;
  } catch {
    throw new AppError('BACKUP_ARCHIVE_INVALID', 400, `Invalid JSON entry: ${name}`);
  }
}
