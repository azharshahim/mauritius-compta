import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual, createHmac } from 'node:crypto';

/**
 * API key encryption at rest.
 *
 * - AES-256-GCM, random 96-bit IV per secret, authentication tag verified on
 *   decryption (a tampered ciphertext is rejected, not returned).
 * - The key comes from `AI_ENCRYPTION_KEY`, **distinct** from the database
 *   credentials and from any other secret. It must be 32 bytes, hex or base64.
 * - `AI_ENCRYPTION_KEY_VERSION` labels the key so a rotation can re-encrypt
 *   rows progressively: a ciphertext records which version produced it.
 * - The additional authenticated data binds a ciphertext to its cabinet and
 *   provider: copying a blob to another cabinet makes decryption fail.
 */

const AAD_SEPARATOR = '\u0000';

export interface EncryptionKeyring {
  key: Buffer;
  version: string;
  /** Optional previous keys, accepted for decryption during a rotation. */
  previous: { key: Buffer; version: string }[];
}

export interface EncryptedSecret {
  ciphertext: string;
  keyVersion: string;
}

export class EncryptionError extends Error {}

/** Parses a 32-byte key from hex (64 chars) or base64 (44 chars). */
export function parseEncryptionKey(raw: string): Buffer {
  const value = raw.trim();
  let key: Buffer | null = null;
  if (/^[0-9a-fA-F]{64}$/.test(value)) {
    key = Buffer.from(value, 'hex');
  } else if (/^[A-Za-z0-9+/=]{40,48}$/.test(value)) {
    const decoded = Buffer.from(value, 'base64');
    if (decoded.length === 32) key = decoded;
  }
  if (!key || key.length !== 32) {
    throw new EncryptionError('AI_ENCRYPTION_KEY must be 32 bytes (64 hex chars or base64)');
  }
  return key;
}

/**
 * Builds the keyring from the environment. Returns `null` when no key is
 * configured, in which case the API refuses to store credentials instead of
 * falling back to clear text.
 */
export function buildKeyring(
  rawKey: string | undefined,
  version = 'v1',
  rawPrevious?: string,
): EncryptionKeyring | null {
  if (!rawKey || rawKey.trim() === '') return null;
  const keyring: EncryptionKeyring = { key: parseEncryptionKey(rawKey), version, previous: [] };
  if (rawPrevious && rawPrevious.trim() !== '') {
    // `previous` accepts a comma separated "v0:key" list during a rotation.
    for (const entry of rawPrevious.split(',')) {
      const [ver, ...rest] = entry.trim().split(':');
      const material = rest.join(':');
      if (!ver || !material) continue;
      keyring.previous.push({ key: parseEncryptionKey(material), version: ver });
    }
  }
  return keyring;
}

function aad(cabinetId: string, provider: string, keyVersion: string): Buffer {
  return Buffer.from([cabinetId, provider, keyVersion].join(AAD_SEPARATOR), 'utf8');
}

export function encryptSecret(
  secret: string,
  keyring: EncryptionKeyring,
  scope: { cabinetId: string; provider: string },
): EncryptedSecret {
  if (secret.trim() === '') throw new EncryptionError('Empty secret');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyring.key, iv);
  cipher.setAAD(aad(scope.cabinetId, scope.provider, keyring.version));
  const payload = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Format: iv.tag.payload, base64url-safe enough for a text column.
  const ciphertext = [iv, tag, payload].map((b) => b.toString('base64')).join('.');
  return { ciphertext, keyVersion: keyring.version };
}

export function decryptSecret(
  encrypted: EncryptedSecret,
  keyring: EncryptionKeyring,
  scope: { cabinetId: string; provider: string },
): string {
  const parts = encrypted.ciphertext.split('.');
  if (parts.length !== 3) throw new EncryptionError('Malformed ciphertext');
  const [ivB64, tagB64, payloadB64] = parts as [string, string, string];

  const key =
    encrypted.keyVersion === keyring.version
      ? keyring.key
      : keyring.previous.find((p) => p.version === encrypted.keyVersion)?.key;
  if (!key) throw new EncryptionError(`Unknown key version ${encrypted.keyVersion}`);

  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
    decipher.setAAD(aad(scope.cabinetId, scope.provider, encrypted.keyVersion));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    const clear = Buffer.concat([
      decipher.update(Buffer.from(payloadB64, 'base64')),
      decipher.final(),
    ]);
    return clear.toString('utf8');
  } catch {
    // Wrong key, wrong cabinet/provider (AAD) or tampered payload.
    throw new EncryptionError('Unable to decrypt secret (authentication failed)');
  }
}

/** Stable fingerprint of a secret, used to spot a key that did not change. */
export function secretFingerprint(secret: string, keyring: EncryptionKeyring): string {
  return createHmac('sha256', keyring.key).update(secret).digest('hex').slice(0, 16);
}

/** Constant-time comparison helper (used when comparing fingerprints). */
export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}
