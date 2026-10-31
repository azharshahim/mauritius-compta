import { badRequest } from './errors.js';

export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Strict YYYY-MM-DD parsing (rejects 2024-02-31 and other impossible dates). */
export function parseIsoDate(value: unknown, field = 'date'): string {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) {
    throw badRequest('VALIDATION_ERROR', `${field} must be a YYYY-MM-DD date`, { field });
  }
  const [y, m, d] = value.split('-').map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (
    dt.getUTCFullYear() !== y ||
    dt.getUTCMonth() !== m - 1 ||
    dt.getUTCDate() !== d
  ) {
    throw badRequest('VALIDATION_ERROR', `${field} is not a valid calendar date`, { field });
  }
  return value;
}

export function isValidIsoDate(value: unknown): value is string {
  try {
    parseIsoDate(value);
    return true;
  } catch {
    return false;
  }
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function compareIsoDates(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Returns the financial year label, e.g. "FY2025/2026". */
export function financialYearLabel(start: string, end: string): string {
  return `FY${start.slice(0, 4)}/${end.slice(0, 4)}`;
}
