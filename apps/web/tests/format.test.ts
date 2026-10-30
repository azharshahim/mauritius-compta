import { describe, expect, it } from 'vitest';
import { defaultEntryDate, toScaled4, addAmounts, sameAmount } from '../src/format';

const iso = (d: Date) => d.toISOString().slice(0, 10);

describe('defaultEntryDate', () => {
  it('keeps today when an open period covers it', () => {
    const today = iso(new Date());
    expect(
      defaultEntryDate([{ start_date: '2000-01-01', end_date: '2100-12-31', status: 'open' }]),
    ).toBe(today);
  });

  it('falls back to the latest open period when today is outside the exercise', () => {
    expect(
      defaultEntryDate([
        { start_date: '2025-07-01', end_date: '2025-12-31', status: 'closed' },
        { start_date: '2026-01-01', end_date: '2026-06-30', status: 'open' },
        { start_date: '2025-01-01', end_date: '2025-06-30', status: 'open' },
      ]),
    ).toBe('2026-06-30');
  });

  it('does not invent a date when no period is open', () => {
    const today = iso(new Date());
    expect(defaultEntryDate([{ start_date: '2020-01-01', end_date: '2020-12-31', status: 'closed' }])).toBe(today);
    expect(defaultEntryDate([])).toBe(today);
  });
});

describe('exact decimal helpers', () => {
  it('adds and compares amounts without floating point', () => {
    const sum = addAmounts(['0.1000', '0.2000', '0.3000']);
    expect(sum).toBe('0.6000');
    expect(sameAmount(sum, '0.6000')).toBe(true);
    expect(toScaled4('1234567.8912')).toBe(12345678912n);
    expect(toScaled4('')).toBeNull();
  });
});
