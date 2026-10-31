import { describe, expect, it } from 'vitest';
import {
  amountInputValue,
  money,
  defaultEntryDate,
  normalizeDecimalInput,
  toScaled4,
  addAmounts,
  sameAmount,
} from '../src/format';

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

describe('saisie décimale Android (mission 13, correctif Samsung)', () => {
  it('accepte le point et la virgule, y compris un clavier français sur Android', () => {
    expect(normalizeDecimalInput('50000.1234')).toBe('50000.1234');
    expect(normalizeDecimalInput('50000,1234')).toBe('50000.1234');
    expect(normalizeDecimalInput('50 000,12')).toBe('50000.12');
    expect(normalizeDecimalInput('50\u00a0000.12')).toBe('50000.12');
    expect(normalizeDecimalInput('1.234,56')).toBe('1234.56');
    expect(normalizeDecimalInput('1,234.56')).toBe('1234.56');
  });

  it('conserve la précision saisie et ne force pas un arrondi silencieux', () => {
    expect(normalizeDecimalInput('0,0001')).toBe('0.0001');
    expect(toScaled4(normalizeDecimalInput('0,0001'))).toBe(1n);
  });

  it('affiche 50000.0000 comme 50 000,00 en français et 50,000.00 en anglais', () => {
    expect(amountInputValue('50000.0000', 'fr')).toBe('50\u202f000,00');
    expect(amountInputValue('50000.0000', 'en')).toBe('50,000.00');
    expect(money('1234.5678', 'fr')).toBe('1\u202f234,57');
    expect(money('1234.5678', 'en')).toBe('1,234.57');
    expect(amountInputValue('', 'fr')).toBe('');
    expect(amountInputValue('12345.6789', 'fr', true)).toBe('12\u202f345,6789');
    expect(amountInputValue('12345.6700', 'fr', true)).toMatch(/^12\u202f345,67$/);
  });
});
