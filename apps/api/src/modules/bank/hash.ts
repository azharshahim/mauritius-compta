/**
 * Platform-neutral deterministic digest for bank transaction fingerprints.
 *
 * It is used identically by the API and the browser demonstration, so it must
 * not depend on `node:crypto`. Two independent 64-bit FNV-1a passes make an
 * accidental collision between two statement rows practically impossible for
 * the bounded volume of a bank statement (a few thousand rows). It is a
 * de-duplication key, never a password hash or a security boundary.
 */
export function stableDigest(parts: (string | number | null | undefined)[]): string {
  const input = parts.map((p) => (p === null || p === undefined ? '' : String(p))).join('\u0001');
  const pass = (seed: bigint): string => {
    let hash = seed;
    for (let i = 0; i < input.length; i += 1) {
      hash ^= BigInt(input.charCodeAt(i));
      hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn;
    }
    return hash.toString(16).padStart(16, '0');
  };
  return `${pass(0xcbf29ce484222325n)}${pass(0x84222325cbf29ce4n)}`;
}
