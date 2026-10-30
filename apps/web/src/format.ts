import type { Locale } from './i18n';

/**
 * Money formatting.
 *
 * The API sends decimal strings (4 decimals) computed with exact integer
 * arithmetic on the server. The UI never converts them with `Number()` for
 * display or for the debit/credit balance check: amounts are parsed into a
 * BigInt scaled by 10^4 (exactly the storage scale) and rounded half-up only
 * at the very end, when grouping digits for display.
 */
const SCALE = 4n;
const SCALE_FACTOR = 10n ** SCALE;

/** Parses "1234.5678" / 1234.5 into a BigInt scaled by 10^4, rounding half-up. */
export function toScaled4(value: string | number | undefined | null): bigint | null {
  if (value === undefined || value === null || value === '') return null;
  const raw = typeof value === 'number' ? value.toFixed(4) : String(value).trim().replace(',', '.');
  const match = /^([+-]?)(\d*)(?:\.(\d*))?$/.exec(raw);
  if (!match) return null;
  const [, sign, intPartRaw, decPartRaw = ''] = match;
  if (!intPartRaw && !decPartRaw) return null;
  const intPart = BigInt(intPartRaw || '0');
  const frac = (decPartRaw + '00000').slice(0, 5);
  let scaled = intPart * SCALE_FACTOR + BigInt(frac.slice(0, 4));
  if (BigInt(frac[4] ?? '0') >= 5n) scaled += 1n;
  return sign === '-' ? -scaled : scaled;
}

function roundToDigits(scaled: bigint, digits: number): bigint {
  const unit = 10n ** (SCALE - BigInt(digits));
  const negative = scaled < 0n;
  const abs = negative ? -scaled : scaled;
  const quotient = abs / unit;
  const remainder = abs % unit;
  const rounded = remainder * 2n >= unit ? quotient + 1n : quotient;
  return negative ? -rounded : rounded;
}

function formatScaled(scaled: bigint, digits: number, locale: Locale): string {
  const rounded = roundToDigits(scaled, digits);
  const negative = rounded < 0n;
  const abs = negative ? -rounded : rounded;
  const unit = 10n ** (SCALE - BigInt(digits));
  const intPart = (abs / unit).toString();
  const decPart = digits > 0 ? (abs % unit).toString().padStart(digits, '0') : '';
  const grouped = new Intl.NumberFormat(locale === 'fr' ? 'fr-FR' : 'en-GB').format(BigInt(intPart));
  const separator = locale === 'fr' ? ',' : '.';
  return `${negative ? '-' : ''}${grouped}${digits > 0 ? `${separator}${decPart}` : ''}`;
}

/** Formats a decimal string amount (e.g. "1234.5000") for display. */
export function money(
  amount: string | number | undefined | null,
  locale: Locale,
  currency?: string,
): string {
  const scaled = toScaled4(amount);
  if (scaled === null) return '—';
  const text = formatScaled(scaled, 2, locale);
  return currency ? `${text} ${currency}` : text;
}

export function shortMoney(amount: string | number | undefined | null, locale: Locale): string {
  const scaled = toScaled4(amount);
  if (scaled === null) return '—';
  return formatScaled(scaled, 0, locale);
}

/** Exact sum of decimal strings (no floating point). */
export function addAmounts(values: (string | number | undefined | null)[]): string {
  let total = 0n;
  for (const value of values) total += toScaled4(value) ?? 0n;
  return scaled4ToString(total);
}

/** Exact equality of two decimal amounts, at 4 decimals. */
export function sameAmount(a: string | number | undefined | null, b: string | number | undefined | null): boolean {
  return (toScaled4(a) ?? 0n) === (toScaled4(b) ?? 0n);
}

export function scaled4ToString(scaled: bigint): string {
  const negative = scaled < 0n;
  const abs = negative ? -scaled : scaled;
  const intPart = (abs / SCALE_FACTOR).toString();
  const decPart = (abs % SCALE_FACTOR).toString().padStart(4, '0');
  return `${negative ? '-' : ''}${intPart}.${decPart}`;
}

export function date(value: string | undefined | null, _locale: Locale): string {
  if (!value) return '—';
  const iso = value.slice(0, 10);
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return value;
  return `${d}/${m}/${y}`;
}

export function dateTime(value: string | undefined | null, locale: Locale): string {
  if (!value) return '—';
  const dt = new Date(value.replace(' ', 'T'));
  if (Number.isNaN(dt.getTime())) return value;
  return new Intl.DateTimeFormat(locale === 'fr' ? 'fr-FR' : 'en-GB', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(dt);
}

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Suggests an entry date the server will accept: today when an open period
 * covers it, otherwise the end of the latest open period. Without this, a user
 * opening the editor outside the financial year gets a PERIOD_CLOSED error.
 */
export function defaultEntryDate(
  periods: { start_date: string; end_date: string; status: string }[],
): string {
  const iso = today();
  const open = periods
    .filter((p) => p.status === 'open')
    .map((p) => ({ start: p.start_date.slice(0, 10), end: p.end_date.slice(0, 10) }))
    .sort((a, b) => a.end.localeCompare(b.end));
  if (open.length === 0) return iso;
  if (open.some((p) => iso >= p.start && iso <= p.end)) return iso;
  return open[open.length - 1]!.end;
}

export function yearStart(year: number): string {
  return `${year}-01-01`;
}
