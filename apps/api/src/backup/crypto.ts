/**
 * Mission 34 — authenticated encryption for backup archives.
 *
 * The archive envelope is deliberately simple and self-describing:
 *
 *   magic (9 bytes) | scrypt salt (16) | AES-GCM IV (12) | GCM tag (16) | ciphertext
 *
 * Only the passphrase holder can decrypt it. The key is derived with scrypt and
 * never written to disk, to the database, to a manifest or to the logs.
 */
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';
import { AppError } from '../lib/errors.js';

export const ENVELOPE_MAGIC = Buffer.from('MCBACKUP\u0001', 'latin1');
const SALT_BYTES = 16;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;
const HEADER_BYTES = ENVELOPE_MAGIC.length + SALT_BYTES + IV_BYTES + TAG_BYTES;
export const MIN_PASSPHRASE_LENGTH = 16;

export function sha256Hex(data: Buffer | Uint8Array | string): string {
  return createHash('sha256').update(data).digest('hex');
}

function deriveKey(passphrase: string, salt: Buffer): Buffer {
  // N=2^14 keeps the derivation usable in the API process while making an
  // offline guessing attack on a weak passphrase expensive.
  return scryptSync(passphrase, salt, KEY_BYTES, { N: 16_384, r: 8, p: 1 });
}

export function assertPassphrase(passphrase: string | undefined): string {
  if (!passphrase || passphrase.length < MIN_PASSPHRASE_LENGTH) {
    throw new AppError(
      'BACKUP_KEY_NOT_CONFIGURED',
      503,
      `A backup passphrase of at least ${MIN_PASSPHRASE_LENGTH} characters is required`,
    );
  }
  return passphrase;
}

export function encryptArchive(zip: Uint8Array, passphrase: string): Buffer {
  assertPassphrase(passphrase);
  const salt = randomBytes(SALT_BYTES);
  const iv = randomBytes(IV_BYTES);
  const key = deriveKey(passphrase, salt);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.concat([ENVELOPE_MAGIC, salt, iv]));
  const ciphertext = Buffer.concat([cipher.update(zip), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([ENVELOPE_MAGIC, salt, iv, tag, ciphertext]);
}

export function decryptArchive(envelope: Buffer, passphrase: string): Uint8Array {
  assertPassphrase(passphrase);
  if (envelope.length <= HEADER_BYTES) {
    throw new AppError('BACKUP_ARCHIVE_INVALID', 400, 'The backup archive is truncated');
  }
  if (!timingSafeEqual(envelope.subarray(0, ENVELOPE_MAGIC.length), ENVELOPE_MAGIC)) {
    throw new AppError('BACKUP_ARCHIVE_INVALID', 400, 'This file is not a COMPTAI backup archive');
  }
  let offset = ENVELOPE_MAGIC.length;
  const salt = envelope.subarray(offset, offset + SALT_BYTES);
  offset += SALT_BYTES;
  const iv = envelope.subarray(offset, offset + IV_BYTES);
  offset += IV_BYTES;
  const tag = envelope.subarray(offset, offset + TAG_BYTES);
  offset += TAG_BYTES;
  const ciphertext = envelope.subarray(offset);

  try {
    const key = deriveKey(passphrase, salt);
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAAD(Buffer.concat([ENVELOPE_MAGIC, salt, iv]));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    // Wrong passphrase and tampered ciphertext are indistinguishable on
    // purpose: never disclose which one it was.
    throw new AppError(
      'BACKUP_DECRYPTION_FAILED',
      400,
      'The backup cannot be decrypted: wrong passphrase or corrupted archive',
    );
  }
}
