import { describe, expect, it } from 'vitest';
import {
  computeSchedule,
  divideRounded,
  parseRate8,
  type DepreciationContext,
} from '../src/modules/fixed-assets/depreciation.js';

/**
 * Mission 20 — pure depreciation arithmetic.
 *
 * Every amount below is fictitious and is checked against a hand calculation.
 * No Mauritian rate, useful life or tax rule is used: the parameters are those
 * of the test only.
 */
const ctx = (overrides: Partial<DepreciationContext> = {}): DepreciationContext => ({
  functionalCost: 12_000_0000n,
  inServiceDate: '2025-01-01',
  depreciationStart: '2025-01-01',
  suspendedFrom: null,
  suspendedTo: null,
  estimates: [
    { effectiveFrom: '2025-01-01', method: 'straight_line', usefulLifeMonths: 12, residualValue: 0n, reducingRate: null },
  ],
  ...overrides,
});

const sum = (lines: { amount: bigint }[]) => lines.reduce((total, line) => total + line.amount, 0n);

describe('depreciation arithmetic', () => {
  it('depreciates twelve equal monthly instalments over a full year', () => {
    const lines = computeSchedule(ctx(), {
      from: '2025-01-01', to: '2025-12-31', accumulatedPosted: 0n, impairmentPosted: 0n,
    });
    expect(lines).toHaveLength(12);
    expect(lines.every((line) => line.amount === 1000_0000n)).toBe(true);
    expect(sum(lines)).toBe(12_000_0000n);
    expect(lines.at(-1)!.closingNbv).toBe(0n);
  });

  it('prorates the first and last months by calendar days and completes the base exactly', () => {
    const lines = computeSchedule(ctx({ inServiceDate: '2025-01-16', depreciationStart: '2025-01-16', functionalCost: 3100_0000n }), {
      from: '2025-01-01', to: '2026-01-31', accumulatedPosted: 0n, impairmentPosted: 0n,
    });
    // 258.3333 monthly; 16 active days out of 31 in January.
    expect(lines[0]!.amount).toBe(133_3333n);
    expect(lines[0]!.daysActive).toBe(16);
    // The last month is completed so that the total equals the depreciable base.
    expect(sum(lines)).toBe(3100_0000n);
    expect(lines.at(-1)!.closingNbv).toBe(0n);
    expect(lines.every((line) => line.daysActive > 0 && line.daysActive <= line.daysInMonth)).toBe(true);
  });

  it('never depreciates more than cost less residual value', () => {
    const lines = computeSchedule(ctx({ functionalCost: 1000_0000n, estimates: [
      { effectiveFrom: '2025-01-01', method: 'straight_line', usefulLifeMonths: 12, residualValue: 100_0000n, reducingRate: null },
    ] }), { from: '2025-01-01', to: '2027-12-31', accumulatedPosted: 0n, impairmentPosted: 0n });
    expect(sum(lines)).toBe(900_0000n);
    expect(lines.at(-1)!.closingNbv).toBe(100_0000n);
  });

  it('applies the reducing-balance method to the opening net book value', () => {
    const rate = parseRate8('0.25');
    const lines = computeSchedule(ctx({
      functionalCost: 100_000_0000n,
      estimates: [{ effectiveFrom: '2025-01-01', method: 'reducing_balance', usefulLifeMonths: 60, residualValue: 0n, reducingRate: rate }],
    }), { from: '2025-01-01', to: '2025-01-31', accumulatedPosted: 0n, impairmentPosted: 0n });
    // 100 000 x 25% / 12 = 2 083.3333
    expect(lines).toHaveLength(1);
    expect(lines[0]!.amount).toBe(2083_3333n);
    expect(lines[0]!.closingNbv).toBe(100_000_0000n - 2083_3333n);
  });

  it('excludes suspended days and completes the base at the end of the useful life', () => {
    const lines = computeSchedule(ctx({
      functionalCost: 1200_0000n,
      suspendedFrom: '2025-01-01', suspendedTo: '2025-01-31',
    }), { from: '2025-01-01', to: '2025-12-31', accumulatedPosted: 0n, impairmentPosted: 0n });
    expect(lines).toHaveLength(11);
    expect(lines[0]!.monthStart).toBe('2025-02-01');
    expect(sum(lines)).toBe(1200_0000n);
  });

  it('starts no depreciation before the in-service date and stops at a disposal date', () => {
    const lines = computeSchedule(ctx({
      inServiceDate: '2025-02-01', depreciationStart: '2025-02-01', functionalCost: 1200_0000n, endDate: '2025-03-15',
    }), { from: '2025-01-01', to: '2025-12-31', accumulatedPosted: 0n, impairmentPosted: 0n });
    expect(lines.map((line) => line.monthStart)).toEqual(['2025-02-01', '2025-03-01']);
    // March: 15 active days out of 31 at 100.0000 per month.
    expect(lines[1]!.amount).toBe(48_3871n);
    expect(lines[1]!.daysActive).toBe(15);
  });

  it('applies a revision prospectively from the first day of a month', () => {
    const revised = ctx({
      estimates: [
        { effectiveFrom: '2025-01-01', method: 'straight_line', usefulLifeMonths: 12, residualValue: 0n, reducingRate: null },
        { effectiveFrom: '2025-07-01', method: 'straight_line', usefulLifeMonths: 18, residualValue: 0n, reducingRate: null },
      ],
    });
    const lines = computeSchedule(revised, {
      from: '2025-07-01', to: '2025-12-31', accumulatedPosted: 6000_0000n, impairmentPosted: 0n,
    });
    // 12 000 / 18 = 666.6667 per month, on the unchanged remaining base.
    expect(lines[0]!.amount).toBe(666_6667n);
    expect(lines.every((line) => line.depreciableBase === 12_000_0000n)).toBe(true);
  });

  it('rounds half up at the fourth decimal and rejects invalid rates', () => {
    expect(divideRounded(1n, 3n)).toBe(0n);
    expect(divideRounded(1n, 2n)).toBe(1n); // half rounds up
    expect(divideRounded(1n, 3n)).toBe(0n);
    expect(() => parseRate8('abc')).toThrow();
    expect(() => parseRate8('1.000000001')).toThrow();
  });
});
