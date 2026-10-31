/**
 * Pure normalisation helpers of the migration assistant.
 *
 * Everything here is deterministic, dependency free and side-effect free: the
 * same rules run in the API (authoritative import) and in the demonstration
 * engine (client side preview). Money never goes through a JavaScript float:
 * amounts are parsed into a `bigint` scaled by 10^4, exactly like the
 * `numeric(20,4)` columns of the accounting engine.
 */

export const AMOUNT_SCALE = 4;
const SCALE_FACTOR = 10_000n;
/** `numeric(20,4)` accepts at most 16 integer digits. */
const MAX_INTEGER_DIGITS = 16;

/* -------------------------------------------------------------------------- */
/* Money                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Parses an amount written with international conventions:
 *   `1 234,56`  `1,234.56`  `1.234,56`  `-12,50`  `(12,50)`  `12,50-`
 *   `Rs 1 234.56`  `1'234.50`  `12.5 Cr` (credit suffix is handled by callers)
 * Returns the value scaled by 10^4 (half away from zero), or `null` when the
 * cell cannot be understood. Never rounds a valid amount silently.
 */
export function parseAmount(raw: unknown): bigint | null {
  return parseDecimal(raw, AMOUNT_SCALE);
}

/**
 * Same parser with a configurable scale, used by exchange rates (8 decimals,
 * like the `numeric(20,8)` columns of the accounting engine).
 */
export function parseDecimal(raw: unknown, scale: number): bigint | null {
  if (raw === null || raw === undefined) return null;
  const factor = 10n ** BigInt(scale);
  if (typeof raw === 'bigint') return raw * factor;
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) return null;
    raw = String(raw);
  }
  let text = String(raw).replace(/\u00a0|\u202f|\u2007/g, ' ').trim();
  if (!text) return null;

  // Currency symbols / ISO codes are decoration, not information.
  text = text
    .replace(/\b(MUR|EUR|USD|GBP|Rs\.?|R\$|EUR|USD)\b/gi, ' ')
    .replace(/[€$£₹]/g, ' ')
    .trim();

  let negative = false;
  if (/^\(.*\)$/.test(text)) {
    negative = true;
    text = text.slice(1, -1);
  }
  if (/-\s*$/.test(text)) {
    negative = true;
    text = text.replace(/-\s*$/, '');
  }
  if (/^[-−–]/.test(text)) {
    negative = true;
    text = text.slice(1);
  }
  text = text.replace(/^\+/, '');

  // Keep digits and separators only (spaces, apostrophes, letters are grouping).
  text = text.replace(/[^0-9.,]/g, '');
  if (!text || !/[0-9]/.test(text)) return null;

  const lastDot = text.lastIndexOf('.');
  const lastComma = text.lastIndexOf(',');

  let integerPart: string;
  let fractionPart: string;

  const dots = (text.match(/\./g) ?? []).length;
  const commas = (text.match(/,/g) ?? []).length;

  if (dots > 0 && commas > 0) {
    const decimalSep = lastDot > lastComma ? '.' : ',';
    const groupingSep = decimalSep === '.' ? ',' : '.';
    const cut = text.lastIndexOf(decimalSep);
    integerPart = text.slice(0, cut).split(groupingSep).join('');
    fractionPart = text.slice(cut + 1);
  } else if (dots > 0 || commas > 0) {
    const sep = dots > 0 ? '.' : ',';
    const count = dots > 0 ? dots : commas;
    const parts = text.split(sep);
    const tail = parts[parts.length - 1] ?? '';
    const head = parts[0] ?? '';
    // `1.234.567` and `1,234,567`: repeated separator is always grouping.
    if (count > 1) {
      integerPart = parts.join('');
      fractionPart = '';
    } else if (tail.length === 3 && head.length >= 1 && head.length <= 3) {
      // `1.234` / `1,234` are read as thousands (accounting convention).
      integerPart = head + tail;
      fractionPart = '';
    } else {
      integerPart = head;
      fractionPart = tail;
    }
  } else {
    integerPart = text;
    fractionPart = '';
  }

  integerPart = integerPart.replace(/^0+(?=\d)/, '');
  if (!integerPart) integerPart = '0';
  if (!/^\d+$/.test(integerPart) || !/^\d*$/.test(fractionPart)) return null;
  if (integerPart.length > MAX_INTEGER_DIGITS) return null;

  const fraction = (fractionPart + '0'.repeat(scale)).slice(0, scale);
  // Half away from zero on the first discarded digit.
  let scaled = BigInt(integerPart) * factor + BigInt(fraction || '0');
  const discarded = fractionPart.slice(scale);
  if (discarded && Number(discarded[0]) >= 5) scaled += 1n;
  return negative ? -scaled : scaled;
}

/** Formats a scaled `bigint` as the canonical `1234.5600` string. */
export function formatScaled(value: bigint): string {
  return formatScaledWith(value, AMOUNT_SCALE);
}

export function formatScaledWith(value: bigint, scale: number): string {
  const factor = 10n ** BigInt(scale);
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const integer = abs / factor;
  const fraction = abs % factor;
  return `${negative ? '-' : ''}${integer}.${fraction.toString().padStart(scale, '0')}`;
}

/** Parses an exchange rate (up to 8 decimals) into its canonical string. */
export function parseRate(raw: unknown): string | null {
  const value = parseDecimal(raw, 8);
  if (value === null || value <= 0n) return null;
  return formatScaledWith(value, 8);
}

/** True when the value is a canonical positive-or-zero money string. */
export function isZeroAmount(value: string | null | undefined): boolean {
  if (!value) return true;
  const scaled = parseAmount(value);
  return scaled === null || scaled === 0n;
}

/* -------------------------------------------------------------------------- */
/* Dates                                                                      */
/* -------------------------------------------------------------------------- */

const MONTHS: Record<string, number> = {
  jan: 1, janv: 1, january: 1, janvier: 1,
  feb: 2, fev: 2, fevr: 2, february: 2, fevrier: 2, février: 2,
  mar: 3, mars: 3, march: 3,
  apr: 4, avr: 4, april: 4, avril: 4,
  may: 5, mai: 5,
  jun: 6, juin: 6, june: 6,
  jul: 7, juil: 7, july: 7, juillet: 7,
  aug: 8, aou: 8, aout: 8, août: 8, august: 8,
  sep: 9, sept: 9, september: 9, septembre: 9,
  oct: 10, october: 10, octobre: 10,
  nov: 11, november: 11, novembre: 11,
  dec: 12, december: 12, decembre: 12, décembre: 12,
};

export interface DateOptions {
  /**
   * `eu` (default) reads `03/04/2026` as 3 April; `us` reads it as 4 March.
   * The wizard always shows the detected convention and lets the user pick.
   */
  dayFirst?: boolean;
  /** Excel serial numbers are honoured only when the cell was numeric. */
  excelSerial?: boolean;
}

/** Builds an ISO `YYYY-MM-DD` and rejects impossible calendar dates. */
export function isoFromParts(year: number, month: number, day: number): string | null {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  if (year < 1900 || year > 2199 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const dt = new Date(Date.UTC(year, month - 1, day));
  if (
    dt.getUTCFullYear() !== year ||
    dt.getUTCMonth() !== month - 1 ||
    dt.getUTCDate() !== day
  ) {
    return null;
  }
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Parses the date formats found in Excel, Sage and SAP exports:
 * ISO, `DD/MM/YYYY`, `DD-MM-YYYY`, `DD.MM.YYYY`, `DD/MM/YY`, `DD MMM YYYY`,
 * ISO timestamps and Excel serial numbers (1900 date system).
 */
export function parseDate(raw: unknown, options: DateOptions = {}): string | null {
  if (raw === null || raw === undefined) return null;
  const text = String(raw).replace(/\u00a0/g, ' ').trim();
  if (!text) return null;

  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/.exec(text);
  if (iso) return isoFromParts(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  const slashIso = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(text);
  if (slashIso) return isoFromParts(Number(slashIso[1]), Number(slashIso[2]), Number(slashIso[3]));

  const numeric = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/.exec(text);
  if (numeric) {
    const a = Number(numeric[1]);
    const b = Number(numeric[2]);
    let year = Number(numeric[3]);
    if (year < 100) year += year < 70 ? 2000 : 1900;
    const dayFirst = options.dayFirst !== false;
    const day = dayFirst ? a : b;
    const month = dayFirst ? b : a;
    return isoFromParts(year, month, day);
  }

  const named = /^(\d{1,2})[\s-]+([A-Za-zÀ-ÿ.]+)[\s-]+(\d{2,4})$/.exec(text);
  if (named) {
    const key = named[2]!.toLowerCase().replace(/\.$/, '');
    const month = MONTHS[key];
    let year = Number(named[3]);
    if (year < 100) year += year < 70 ? 2000 : 1900;
    if (month) return isoFromParts(year, month, Number(named[1]));
  }

  // Excel serial: only numeric cells, and only when explicitly allowed.
  if (options.excelSerial && /^\d{5}(\.\d+)?$/.test(text)) {
    const serial = Math.floor(Number(text));
    if (serial > 20_000 && serial < 80_000) {
      const ms = Date.UTC(1899, 11, 30) + serial * 86_400_000;
      const dt = new Date(ms);
      return isoFromParts(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
    }
  }
  return null;
}

/** Adds `days` to an ISO date (UTC, no DST surprise). */
export function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y!, (m ?? 1) - 1, d ?? 1));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

/* -------------------------------------------------------------------------- */
/* Labels and enums                                                          */
/* -------------------------------------------------------------------------- */

/** Lower-cases, strips accents, punctuation and multiple spaces. */
export function normalizeHeader(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export type AccountType = 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';

const ACCOUNT_TYPES: Record<string, AccountType> = {
  asset: 'asset', assets: 'asset', actif: 'asset', immobilisation: 'asset', 'non current asset': 'asset',
  liability: 'liability', liabilities: 'liability', passif: 'liability', dette: 'liability', 'current liability': 'liability',
  equity: 'equity', 'capitaux propres': 'equity', capital: 'equity', 'fonds propres': 'equity',
  revenue: 'revenue', revenues: 'revenue', income: 'revenue', produit: 'revenue', produits: 'revenue', vente: 'revenue', ventes: 'revenue', 'sales': 'revenue',
  expense: 'expense', expenses: 'expense', charge: 'expense', charges: 'expense', achat: 'expense', achats: 'expense', cost: 'expense', 'cout': 'expense',
};

export function normalizeAccountType(raw: unknown): AccountType | null {
  if (!raw) return null;
  const key = normalizeHeader(raw);
  if (!key) return null;
  if (ACCOUNT_TYPES[key]) return ACCOUNT_TYPES[key];
  // Common two-letter prefixes (`A-`, `L-`, `E-`) seen in exported charts.
  const prefix = key.charAt(0);
  if (key.length <= 3) {
    if (prefix === 'a') return 'asset';
    if (prefix === 'l') return 'liability';
    if (prefix === 'e') return 'equity';
    if (prefix === 'r') return 'revenue';
    if (prefix === 'c' || prefix === 'd') return 'expense';
  }
  return null;
}

/**
 * True when a debit/credit indicator cell means "credit".
 *
 * Conventions kept distinct on purpose:
 *  - D/C, Debit/Credit, Dr/Cr (English and French exports);
 *  - S/H: SAP `SHKZG`, where **S = Soll = debit** and **H = Haben = credit**.
 * A wrong mapping here would post every SAP line on the same side, so it is
 * covered by a dedicated test.
 */
export function isCreditIndicator(raw: unknown): boolean | null {
  if (raw === null || raw === undefined) return null;
  const key = normalizeHeader(raw);
  if (!key) return null;
  if (['c', 'cr', 'credit', 'crédit', 'haben', 'h'].includes(key)) return true;
  if (['d', 'dr', 'debit', 'débit', 'soll', 's'].includes(key)) return false;
  return null;
}
