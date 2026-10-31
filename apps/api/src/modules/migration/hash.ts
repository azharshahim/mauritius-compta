import { createHash } from 'node:crypto';

/** Stable SHA-256 of a list of ordered parts (no object key ordering issue). */
export function sha256(parts: (string | number | boolean | null | undefined)[]): string {
  const hash = createHash('sha256');
  for (const part of parts) {
    hash.update(part === null || part === undefined ? '\u0000' : String(part));
    hash.update('\u0001');
  }
  return hash.digest('hex');
}

/** Hash of a binary upload, used as the file identity of an import job. */
export function sha256Bytes(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}
