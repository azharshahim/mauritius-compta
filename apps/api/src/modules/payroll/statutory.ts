/**
 * Deterministic Mauritius statutory calculations (Mission 15).
 *
 * Every function is pure and uses the same BigInt fixed-point amounts as the
 * Mission 14 payroll engine. No JavaScript floating point touches money.
 *
 * Status contract: this module implements formulas whose official sources are
 * recorded in `payroll_rules.parameters`. Implementation and source verification
 * are NOT legal applicability approval. The caller must therefore keep the
 * calculation in a review status and keep finalisation blocked until an
 * authorised expert review is recorded.
 */
import { formatAmount, parseAmount, parseRate } from '../../lib/money.js';

const MONEY = 10_000n;
const RATE_FACTOR = 100_000_000n; // parseRate uses 8 decimals

export type PayFrequency = 'daily' | 'weekly' | 'fortnightly' | 'half_monthly' | 'monthly';

export interface PayeBand {
  /** Upper cumulative bound in MUR, null for the remainder. */
  upto: string | null;
  /** Percentage, e.g. "10" for 10%. */
  rate: string;
}

export interface NsfLimits {
  minHousehold: string;
  minOther: string;
  max: string;
}

export interface StatutoryResult<T> {
  value: T;
  trace: string[];
}

export function roundDownRupee(amount: bigint): bigint {
  if (amount <= 0n) return 0n;
  return (amount / MONEY) * MONEY;
}

export function roundUpRupee(amount: bigint): bigint {
  if (amount <= 0n) return 0n;
  return ((amount + MONEY - 1n) / MONEY) * MONEY;
}

/** Exact percentage, truncated to 4 decimals. */
export function percentage(amount: bigint, rate: string): bigint {
  if (amount <= 0n) return 0n;
  const scaled = parseRate(rate);
  return (amount * scaled) / (RATE_FACTOR * 100n);
}

function ceilDiv(value: bigint, divisor: bigint): bigint {
  return (value + divisor - 1n) / divisor;
}

/**
 * Scales an annual band threshold to the elapsed pay periods using the
 * official monthly table: Rs 500,000 / 13 = Rs 38,462 per period, so
 * July = 38,462 and the 12th period is the annual amount (June = 500,000).
 * A bonus paid in a separate pay period would add a 13th period; that path is
 * not implemented and remains subject to expert review.
 */
export function scaleBandThreshold(annual: bigint, periodsElapsed: number): bigint {
  if (periodsElapsed <= 0) return 0n;
  if (periodsElapsed >= 12) return annual;
  const perPeriod = roundUpRupee(ceilDiv(annual, 13n));
  const scaled = perPeriod * BigInt(periodsElapsed);
  return scaled > annual ? annual : scaled;
}

export interface PayeComputation {
  chargeableIncome: bigint;
  cumulativeTax: bigint;
  currentPaye: bigint;
  bands: { upto: string | null; rate: string; taxable: bigint; tax: bigint }[];
}

/**
 * Cumulative PAYE on a monthly (or other) pay period.
 * Tax is rounded down to the rupee once on the cumulative liability, then the
 * tax already withheld is deducted. A negative difference is never refunded.
 */
export function computeCumulativePaye(input: {
  cumulativeEmoluments: bigint;
  cumulativeReliefs: bigint;
  periodsElapsed: number;
  previousWithheld: bigint;
  bands: PayeBand[];
}): StatutoryResult<PayeComputation> {
  const trace: string[] = [];
  const chargeable = input.cumulativeEmoluments > input.cumulativeReliefs
    ? input.cumulativeEmoluments - input.cumulativeReliefs : 0n;
  trace.push(`Cumulative emoluments ${formatAmount(input.cumulativeEmoluments)}`);
  trace.push(`Cumulative reliefs ${formatAmount(input.cumulativeReliefs)}`);
  trace.push(`Cumulative chargeable income ${formatAmount(chargeable)}`);

  let previousBound = 0n;
  let remaining = chargeable;
  let tax = 0n;
  const applied: PayeComputation['bands'] = [];
  for (const band of input.bands) {
    if (remaining <= 0n) break;
    const bound = band.upto === null ? null
      : scaleBandThreshold(parseAmount(band.upto), input.periodsElapsed);
    const width = bound === null ? remaining : (bound > previousBound ? bound - previousBound : 0n);
    const taxable = width < remaining ? width : remaining;
    const bandTax = percentage(taxable, band.rate);
    tax += bandTax;
    applied.push({
      upto: bound === null ? null : formatAmount(bound),
      rate: band.rate,
      taxable,
      tax: bandTax,
    });
    remaining -= taxable;
    if (bound !== null) previousBound = bound;
  }
  const cumulativeTax = roundDownRupee(tax);
  const currentPaye = cumulativeTax > input.previousWithheld
    ? cumulativeTax - input.previousWithheld : 0n;
  trace.push(`Cumulative PAYE ${formatAmount(cumulativeTax)}`);
  trace.push(`PAYE already withheld ${formatAmount(input.previousWithheld)}`);
  trace.push(`PAYE for this period ${formatAmount(currentPaye)} (rounded down to the rupee)`);
  return {
    value: { chargeableIncome: chargeable, cumulativeTax, currentPaye, bands: applied },
    trace,
  };
}

/** Official no-EDF rule: flat rate above the monthly threshold. */
export function computePayeWithoutEdf(input: {
  periodEmoluments: bigint;
  threshold: string;
  rate: string;
}): StatutoryResult<bigint> {
  const threshold = parseAmount(input.threshold);
  if (input.periodEmoluments <= threshold) {
    return { value: 0n, trace: [`No EDF: emoluments do not exceed ${input.threshold}; flat PAYE is zero.`] };
  }
  const value = roundDownRupee(percentage(input.periodEmoluments, input.rate));
  return {
    value,
    trace: [
      `No EDF: flat ${input.rate}% on ${formatAmount(input.periodEmoluments)}.`,
      `PAYE ${formatAmount(value)} (rounded down to the rupee).`,
    ],
  };
}

export interface CsgComputation {
  employee: bigint;
  employer: bigint;
  employeeRate: string;
  employerRate: string;
  category: 'low' | 'high';
}

export function computeCsg(input: {
  amount: bigint;
  threshold: string;
  lowEmployeeRate: string;
  lowEmployerRate: string;
  highEmployeeRate: string;
  highEmployerRate: string;
}): StatutoryResult<CsgComputation> {
  const high = input.amount > parseAmount(input.threshold);
  const employeeRate = high ? input.highEmployeeRate : input.lowEmployeeRate;
  const employerRate = high ? input.highEmployerRate : input.lowEmployerRate;
  const employee = percentage(input.amount, employeeRate);
  const employer = percentage(input.amount, employerRate);
  return {
    value: { employee, employer, employeeRate, employerRate, category: high ? 'high' : 'low' },
    trace: [
      `CSG base ${formatAmount(input.amount)} (${high ? 'above' : 'not above'} Rs ${input.threshold}).`,
      `Employee ${employeeRate}% = ${formatAmount(employee)}; employer ${employerRate}% = ${formatAmount(employer)}.`,
    ],
  };
}

export interface NsfComputation {
  assessable: bigint;
  employee: bigint;
  employer: bigint;
  minimum: bigint;
  maximum: bigint;
  capped: boolean;
  floored: boolean;
}

export function computeNsf(input: {
  basicWage: bigint;
  frequency: PayFrequency;
  limits: NsfLimits;
  household: boolean;
  employeeRate: string;
  employerRate: string;
}): StatutoryResult<NsfComputation> {
  const minimum = parseAmount(input.household ? input.limits.minHousehold : input.limits.minOther);
  const maximum = parseAmount(input.limits.max);
  if (input.basicWage <= 0n) {
    return {
      value: { assessable: 0n, employee: 0n, employer: 0n, minimum, maximum, capped: false, floored: false },
      trace: ['NSF: no basic wage, no contribution.'],
    };
  }
  const floored = input.basicWage < minimum;
  const capped = input.basicWage > maximum;
  const assessable = floored ? minimum : capped ? maximum : input.basicWage;
  const employee = percentage(assessable, input.employeeRate);
  const employer = percentage(assessable, input.employerRate);
  return {
    value: { assessable, employee, employer, minimum, maximum, capped, floored },
    trace: [
      `NSF ${input.frequency} assessable base ${formatAmount(assessable)} ` +
        `(min ${formatAmount(minimum)}, max ${formatAmount(maximum)}).`,
      `Employee ${input.employeeRate}% = ${formatAmount(employee)}; employer ${input.employerRate}% = ${formatAmount(employer)}.`,
    ],
  };
}

export function computeTrainingLevy(input: {
  basicWage: bigint;
  rate: string;
  exempt: boolean;
}): StatutoryResult<bigint> {
  if (input.exempt) return { value: 0n, trace: ['Training Levy: employee category exempt.'] };
  const value = percentage(input.basicWage, input.rate);
  return {
    value,
    trace: [`Training Levy ${input.rate}% on full basic wage ${formatAmount(input.basicWage)} = ${formatAmount(value)}.`],
  };
}

export interface AdditionalRemunerationInput {
  effectiveFrom: string;
  periodEnd: string;
  workerType: 'full_time' | 'part_time' | 'piece_rate' | 'atypical';
  monthlyBasicWage: bigint;
  excluded: boolean;
  enabled: boolean;
  fullTimeAmount: string;
  partTimeThreshold: string;
  partTimeRate: string;
  maximum: string;
  globalThreshold: string;
}

export function computeAdditionalRemuneration(input: AdditionalRemunerationInput): StatutoryResult<bigint> {
  if (!input.enabled) return { value: 0n, trace: ['Additional Remuneration: not enabled for this company.'] };
  if (input.periodEnd < input.effectiveFrom) {
    return { value: 0n, trace: [`Additional Remuneration: not effective before ${input.effectiveFrom}.`] };
  }
  if (input.excluded) return { value: 0n, trace: ['Additional Remuneration: employee category excluded by the employer declaration.'] };
  if (input.workerType === 'piece_rate') {
    return { value: 0n, trace: ['Additional Remuneration: piece-rate workers require the relevant rate schedule; not calculated.'] };
  }
  const maximum = parseAmount(input.maximum);
  const global = parseAmount(input.globalThreshold);
  if (input.monthlyBasicWage > global) {
    return { value: 0n, trace: [`Additional Remuneration: basic wage above Rs ${input.globalThreshold}.`] };
  }
  if (input.workerType === 'full_time') {
    return { value: parseAmount(input.fullTimeAmount), trace: [`Additional Remuneration full-time: Rs ${input.fullTimeAmount} per month.`] };
  }
  const partThreshold = parseAmount(input.partTimeThreshold);
  if (input.monthlyBasicWage < partThreshold) {
    const raw = percentage(input.monthlyBasicWage, input.partTimeRate);
    const value = roundUpRupee(raw) > maximum ? maximum : roundUpRupee(raw);
    return {
      value,
      trace: [`Additional Remuneration part-time ${input.partTimeRate}% = ${formatAmount(raw)}, rounded up to the rupee and capped at ${formatAmount(maximum)}.`],
    };
  }
  return { value: parseAmount(input.fullTimeAmount), trace: [`Additional Remuneration part-time: Rs ${input.fullTimeAmount} per month.`] };
}

/** End-of-year bonus: one twelfth of the year's earnings (WRA section 54). */
export function computeEndOfYearBonus(earningsForYear: bigint): StatutoryResult<bigint> {
  return {
    value: earningsForYear > 0n ? earningsForYear / 12n : 0n,
    trace: [`End-of-year bonus = 1/12 × ${formatAmount(earningsForYear)}.`],
  };
}
