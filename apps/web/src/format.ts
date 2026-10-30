import type { Locale } from './i18n';

/** Formats a decimal string amount (e.g. "1234.5000") for display. */
export function money(amount: string | number | undefined | null, locale: Locale, currency?: string): string {
  if (amount === undefined || amount === null || amount === '') return '—';
  const value = typeof amount === 'number' ? amount : Number(amount);
  if (!Number.isFinite(value)) return String(amount);
  const formatted = new Intl.NumberFormat(locale === 'fr' ? 'fr-FR' : 'en-GB', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
  return currency ? `${formatted} ${currency}` : formatted;
}

export function shortMoney(amount: string | number | undefined | null, locale: Locale): string {
  if (amount === undefined || amount === null || amount === '') return '—';
  const value = typeof amount === 'number' ? amount : Number(amount);
  if (!Number.isFinite(value)) return String(amount);
  return new Intl.NumberFormat(locale === 'fr' ? 'fr-FR' : 'en-GB', {
    maximumFractionDigits: 0,
  }).format(value);
}

export function date(value: string | undefined | null, locale: Locale): string {
  if (!value) return '—';
  const iso = value.slice(0, 10);
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return value;
  return locale === 'fr' ? `${d}/${m}/${y}` : `${d}/${m}/${y}`;
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

export function yearStart(year: number): string {
  return `${year}-01-01`;
}
