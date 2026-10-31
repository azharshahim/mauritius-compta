/**
 * Exact decimal arithmetic for monetary amounts.
 *
 * Amounts are handled as BigInt scaled by 10^4 (four decimal places, matching
 * numeric(20,4) in PostgreSQL). No binary floating point is ever used for
 * money, so debit/credit equality checks are exact.
 */

export const MONEY_SCALE = 4;
const FACTOR = 10n ** BigInt(MONEY_SCALE);

export class MoneyError extends Error {}

export function parseAmount(input: unknown): bigint {
  if (input === null || input === undefined || input === '') {
    throw new MoneyError('Amount is required');
  }
  if (typeof input === 'bigint') return input;
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) throw new MoneyError('Invalid amount');
    input = input.toString();
  }
  const raw = String(input).trim().replace(/\s/g, '').replace(',', '.');
  if (!/^-?\d+(\.\d+)?$/.test(raw)) throw new MoneyError(`Invalid amount: ${raw}`);
  const negative = raw.startsWith('-');
  const [intPart, decPart = ''] = raw.replace('-', '').split('.');
  if (decPart.length > MONEY_SCALE) {
    // Round half away from zero to 4 decimals (as PostgreSQL numeric would).
    const keep = decPart.slice(0, MONEY_SCALE);
    const next = Number(decPart[MONEY_SCALE]);
    let value = BigInt(intPart + keep);
    if (next >= 5) value += 1n;
    return negative ? -value : value;
  }
  const value = BigInt(intPart + decPart.padEnd(MONEY_SCALE, '0'));
  return negative ? -value : value;
}

export function formatAmount(value: bigint): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const int = (abs / FACTOR).toString();
  const dec = (abs % FACTOR).toString().padStart(MONEY_SCALE, '0');
  return `${negative ? '-' : ''}${int}.${dec}`;
}

/** Formats a BigInt scaled by 10^scale as a plain decimal string. */
export function formatScaled(value: bigint, scale: number): string {
  const factor = 10n ** BigInt(scale);
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const int = (abs / factor).toString();
  const dec = (abs % factor).toString().padStart(scale, '0');
  return `${negative ? '-' : ''}${int}${scale > 0 ? `.${dec}` : ''}`;
}

/** Number of decimal places in a user-supplied amount (no rounding applied). */
export function decimalPlaces(input: unknown): number {
  if (typeof input === 'number') input = input.toString();
  const raw = String(input ?? '').trim().replace(/\s/g, '').replace(',', '.');
  const decimals = raw.split('.')[1];
  return decimals ? decimals.length : 0;
}

/**
 * Reciprocal of a rate with a fixed number of decimals, computed with integer
 * arithmetic (never with floating point).
 * Example: reciprocal('48.5000') -> '0.02061856'
 */
export function reciprocal(rate: string, scale = 8): string {
  const scaled = parseRate(rate); // scale 8
  if (scaled <= 0n) throw new MoneyError('Rate must be positive');
  const numerator = 10n ** BigInt(RATE_SCALE + scale);
  const quotient = numerator / scaled;
  const remainder = numerator % scaled;
  const rounded = remainder * 2n >= scaled ? quotient + 1n : quotient;
  return formatScaled(rounded, scale);
}

export const zero = 0n;
export const add = (a: bigint, b: bigint) => a + b;
export const sub = (a: bigint, b: bigint) => a - b;
export const isZero = (a: bigint) => a === 0n;

export function sum(values: bigint[]): bigint {
  return values.reduce((acc, v) => acc + v, 0n);
}

const RATE_SCALE = 8;
const RATE_FACTOR = 10n ** BigInt(RATE_SCALE);

/** Parses an exchange rate keeping 8 decimals of precision. */
export function parseRate(rate: string): bigint {
  const raw = String(rate).trim().replace(',', '.');
  if (!/^-?\d+(\.\d+)?$/.test(raw)) throw new MoneyError(`Invalid rate: ${raw}`);
  const negative = raw.startsWith('-');
  const [intPart, decPart = ''] = raw.replace('-', '').split('.');
  if (decPart.length > RATE_SCALE) {
    const keep = decPart.slice(0, RATE_SCALE);
    const next = Number(decPart[RATE_SCALE]);
    let value = BigInt(intPart + keep);
    if (next >= 5) value += 1n;
    return negative ? -value : value;
  }
  const value = BigInt(intPart + decPart.padEnd(RATE_SCALE, '0'));
  return negative ? -value : value;
}

/**
 * Multiplies an amount (scale 4) by an exchange rate (scale 8) and returns the
 * result rounded to scale 4, half away from zero.
 */
export function multiply(amount: bigint, rate: string): bigint {
  const scaledRate = parseRate(rate);
  const product = amount * scaledRate; // scale 12
  const divisor = RATE_FACTOR;
  const quotient = product / divisor;
  const remainder = product % divisor;
  const absRemainder = remainder < 0n ? -remainder : remainder;
  if (absRemainder * 2n >= divisor) {
    return quotient + (product < 0n ? -1n : 1n);
  }
  return quotient;
}

/** Validates a rate string: positive, up to 8 decimals. */
export function isValidRate(rate: string): boolean {
  if (!/^\d+(\.\d{1,8})?$/.test(rate)) return false;
  return parseAmount(rate) > 0n;
}

/**
 * Human formatting with grouping. `locale` only affects the separators.
 */
export function formatMoney(
  amount: bigint | string | number,
  locale: string,
  currency?: string,
): string {
  const value =
    typeof amount === 'bigint'
      ? amount
      : typeof amount === 'number'
        ? parseAmount(amount)
        : /^-?\d+$/.test(amount)
          ? BigInt(amount)
          : parseAmount(amount);
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const intPart = (abs / FACTOR).toString();
  const decPart = (abs % FACTOR).toString().padStart(MONEY_SCALE, '0').slice(0, 2);
  const sep = locale === 'en' ? ',' : ' ';
  const decSep = locale === 'en' ? '.' : ',';
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, sep);
  const base = `${negative ? '-' : ''}${grouped}${decSep}${decPart}`;
  return currency ? `${base} ${currency}` : base;
}
