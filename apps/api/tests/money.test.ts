import { describe, expect, it } from 'vitest';
import {
  formatAmount,
  formatMoney,
  isValidRate,
  multiply,
  parseAmount,
} from '../src/lib/money.js';
import { isValidIsoDate, parseIsoDate } from '../src/lib/dates.js';

describe('exact money arithmetic', () => {
  it('parses and formats without floating point drift', () => {
    expect(formatAmount(parseAmount('1234.5'))).toBe('1234.5000');
    expect(formatAmount(parseAmount('0.1'))).toBe('0.1000');
    expect(formatAmount(parseAmount('1234567.89'))).toBe('1234567.8900');
    expect(formatAmount(parseAmount('-45.6789'))).toBe('-45.6789');
  });

  it('adds amounts exactly (0.1 + 0.2 = 0.3)', () => {
    expect(formatAmount(parseAmount('0.1') + parseAmount('0.2'))).toBe('0.3000');
  });

  it('rounds to 4 decimals half away from zero', () => {
    expect(formatAmount(parseAmount('1.00005'))).toBe('1.0001');
    expect(formatAmount(parseAmount('1.00004'))).toBe('1.0000');
  });

  it('multiplies by an exchange rate with rounding', () => {
    expect(formatAmount(multiply(parseAmount('1000'), '48.5'))).toBe('48500.0000');
    expect(formatAmount(multiply(parseAmount('100'), '1.23456789'))).toBe('123.4568');
  });

  it('validates rates', () => {
    expect(isValidRate('48.5')).toBe(true);
    expect(isValidRate('0')).toBe(false);
    expect(isValidRate('-1')).toBe(false);
    expect(isValidRate('abc')).toBe(false);
  });

  it('formats per locale', () => {
    expect(formatMoney('1234567.5', 'fr', 'MUR')).toBe('1 234 567,50 MUR');
    expect(formatMoney('1234567.5', 'en', 'MUR')).toBe('1,234,567.50 MUR');
  });

  it('rejects impossible dates', () => {
    expect(isValidIsoDate('2025-02-31')).toBe(false);
    expect(isValidIsoDate('2025-02-28')).toBe(true);
    expect(() => parseIsoDate('31/12/2025')).toThrow();
  });
});
