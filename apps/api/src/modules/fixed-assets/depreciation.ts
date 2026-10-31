/**
 * Depreciation arithmetic (mission 20).
 *
 * All amounts are exact BigInt scaled by 10^4 (numeric(20,4)); percentages are
 * scaled by 10^8. No binary floating point is used. No statutory rate or
 * useful life is embedded: they are configured per company and per asset.
 *
 * Convention (documented in docs/mission-20-report.md):
 * - a full month is depreciated with one twelfth of the annual charge;
 * - a partial month (start, disposal, suspension, revision) is prorated by
 *   active calendar days over the days of that month;
 * - the charge never exceeds the depreciable base (cost less residual value)
 *   and never starts before the in-service date;
 * - the last month is capped so the total exactly equals the base.
 */
import { formatAmount, parseAmount } from '../../lib/money.js';

export const RATE_SCALE = 8n;
const RATE_FACTOR = 10n ** RATE_SCALE;

export type DepreciationMethod = 'straight_line' | 'reducing_balance';

export interface EstimateParams {
  effectiveFrom: string;
  method: DepreciationMethod;
  usefulLifeMonths: number;
  residualValue: bigint;
  reducingRate: bigint | null;
}

export interface DepreciationContext {
  functionalCost: bigint;
  inServiceDate: string | null;
  depreciationStart: string | null;
  suspendedFrom: string | null;
  suspendedTo: string | null;
  /** Last day on which depreciation may accrue (disposal or write-off). */
  endDate?: string | null;
  estimates: EstimateParams[];
}

export interface ScheduleLine {
  monthStart: string;
  monthEnd: string;
  amount: bigint;
  method: DepreciationMethod;
  openingNbv: bigint;
  depreciableBase: bigint;
  closingNbv: bigint;
  daysActive: number;
  daysInMonth: number;
  usefulLifeMonths: number;
  residualValue: bigint;
}

/** Parses a decimal rate into BigInt scaled by 10^8. */
export function parseRate8(value: string | number): bigint {
  const raw = String(value).trim().replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(raw)) throw new Error('Invalid rate');
  const [int, dec = ''] = raw.split('.');
  if (dec.length > 8) throw new Error('Rate has more than 8 decimals');
  return BigInt(int!) * RATE_FACTOR + BigInt(dec.padEnd(8, '0'));
}

export function rateToString8(value: bigint): string {
  const int = value / RATE_FACTOR;
  const dec = (value % RATE_FACTOR).toString().padStart(8, '0');
  return `${int}.${dec}`;
}

export const iso = (date: Date): string => date.toISOString().slice(0, 10);
export const parseDate = (value: string): Date => new Date(`${value}T00:00:00.000Z`);
export const addDays = (value: string, days: number): string => {
  const d = parseDate(value);
  d.setUTCDate(d.getUTCDate() + days);
  return iso(d);
};
export const addMonths = (value: string, months: number): string => {
  const d = parseDate(value);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return iso(d);
};
export const monthStart = (value: string): string => `${value.slice(0, 7)}-01`;
export const monthEnd = (value: string): string => {
  const d = parseDate(value);
  return iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)));
};
export const daysInMonth = (value: string): number => Number(monthEnd(value).slice(8, 10));
export const daysInclusive = (from: string, to: string): number => {
  if (to < from) return 0;
  let days = 0;
  let current = from;
  while (current <= to) {
    days += 1;
    current = addDays(current, 1);
  }
  return days;
};
export const min = (a: string, b: string) => (a < b ? a : b);
export const max = (a: string, b: string) => (a > b ? a : b);

/** Rounds a non-negative rational to the nearest 10^-4 (half up). */
export function divideRounded(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) return 0n;
  if (numerator <= 0n) return 0n;
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  return remainder * 2n >= denominator ? quotient + 1n : quotient;
}

/** Active calendar days of a month, excluding the current suspension. */
export function activeDays(
  mStart: string,
  mEnd: string,
  ctx: Pick<DepreciationContext, 'suspendedFrom' | 'suspendedTo'>,
  start: string,
  end: string,
): { days: number; from: string | null; to: string | null } {
  const from = max(mStart, start);
  const to = min(mEnd, end);
  if (to < from) return { days: 0, from: null, to: null };
  let days = daysInclusive(from, to);
  if (ctx.suspendedFrom && ctx.suspendedFrom <= to && (ctx.suspendedTo === null || ctx.suspendedTo >= from)) {
    const sFrom = max(from, ctx.suspendedFrom);
    const sTo = min(to, ctx.suspendedTo ?? to);
    if (sTo >= sFrom) days -= daysInclusive(sFrom, sTo);
  }
  return { days, from, to };
}

function paramsFor(estimates: EstimateParams[], monthStartDate: string): EstimateParams {
  const sorted = [...estimates].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
  let chosen = sorted[0]!;
  for (const estimate of sorted) {
    if (estimate.effectiveFrom <= monthStartDate) chosen = estimate;
  }
  return chosen;
}

export interface ComputeOptions {
  from: string;
  to: string;
  /** Depreciation already posted before `from`. */
  accumulatedPosted: bigint;
  /** Accumulated impairment already posted before `from`. */
  impairmentPosted: bigint;
}

/**
 * Computes a monthly depreciation schedule between two dates.
 * The function is pure: it never reads the database.
 */
export function computeSchedule(ctx: DepreciationContext, options: ComputeOptions): ScheduleLine[] {
  const lines: ScheduleLine[] = [];
  const start = ctx.depreciationStart ?? ctx.inServiceDate;
  if (!start) return lines;
  const from = monthStart(options.from);
  const to = monthEnd(options.to);
  let accumulated = options.accumulatedPosted;
  let cursor = from;
  while (cursor <= to) {
    const mStart = cursor;
    const mEnd = monthEnd(cursor);
    const estimate = paramsFor(ctx.estimates, mStart);
    const lifeStart = max(start, estimate.effectiveFrom);
    const lifeEnd = addDays(addMonths(lifeStart, estimate.usefulLifeMonths), -1);
    const base = ctx.functionalCost - estimate.residualValue;
    const end = ctx.endDate ? min(lifeEnd, ctx.endDate) : lifeEnd;
    const window = activeDays(mStart, mEnd, ctx, start, end);
    if (window.days > 0 && base > accumulated) {
      const dim = daysInMonth(mStart);
      let amount = 0n;
      if (estimate.method === 'straight_line') {
        const monthly = divideRounded(base, BigInt(estimate.usefulLifeMonths));
        amount = divideRounded(monthly * BigInt(window.days), BigInt(dim));
      } else {
        const rate = estimate.reducingRate ?? 0n;
        const openingNbv = ctx.functionalCost - accumulated - options.impairmentPosted;
        if (openingNbv > 0n && rate > 0n) {
          // openingNbv * rate / 12 / daysInMonth * daysActive, all exact.
          amount = divideRounded(
            openingNbv * rate * BigInt(window.days),
            RATE_FACTOR * 12n * BigInt(dim),
          );
        }
      }
      const remaining = base - accumulated;
      // The useful life ends inside this month: depreciate the exact residual
      // base so that the total charge equals the depreciable amount.
      if (lifeEnd <= mEnd && remaining > 0n) amount = remaining;
      if (amount > remaining) amount = remaining;
      if (amount > 0n) {
        const openingNbv = ctx.functionalCost - accumulated - options.impairmentPosted;
        accumulated += amount;
        lines.push({
          monthStart: mStart,
          monthEnd: mEnd,
          amount,
          method: estimate.method,
          openingNbv,
          depreciableBase: base,
          closingNbv: ctx.functionalCost - accumulated - options.impairmentPosted,
          daysActive: window.days,
          daysInMonth: dim,
          usefulLifeMonths: estimate.usefulLifeMonths,
          residualValue: estimate.residualValue,
        });
      }
    }
    cursor = addDays(mEnd, 1);
  }
  return lines;
}

export const amount = (value: string | number | bigint | null | undefined): bigint =>
  value === null || value === undefined ? 0n : parseAmount(value);
export const money = (value: bigint): string => formatAmount(value);
