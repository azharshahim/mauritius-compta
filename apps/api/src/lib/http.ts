import type { FastifyRequest } from 'fastify';
import type { ZodSchema } from 'zod';
import { badRequest } from './errors.js';

export function parse<T>(schema: ZodSchema<T>, data: unknown, field = 'body'): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    const details = result.error.issues.map((i) => ({
      path: [field, ...i.path.map(String)].join('.'),
      message: i.message,
    }));
    throw badRequest('VALIDATION_ERROR', details[0]?.message ?? 'Invalid payload', details);
  }
  return result.data;
}

export function clientIp(req: FastifyRequest): string | null {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length > 0) return fwd.split(',')[0]!.trim();
  return req.ip ?? null;
}

/**
 * CSV cell escaping. Besides quotes/separators, formula-leading strings are
 * neutralised (CSV injection): Excel/LibreOffice would otherwise execute
 * user-controlled descriptions such as "=HYPERLINK(...)".
 */
export function toCsv(rows: (string | number | null | undefined)[][]): string {
  const escape = (v: string | number | null | undefined): string => {
    if (v === null || v === undefined) return '';
    let s = String(v);
    const isNumeric = /^-?\d+(\.\d+)?$/.test(s);
    if (!isNumeric && /^[=+\-@\t\r]/.test(s)) {
      s = `'${s}`;
    }
    return /[",;\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  // Semicolon separator + UTF-8 BOM: opens cleanly in Excel (FR/EN).
  return '\uFEFF' + rows.map((r) => r.map(escape).join(';')).join('\r\n') + '\r\n';
}
