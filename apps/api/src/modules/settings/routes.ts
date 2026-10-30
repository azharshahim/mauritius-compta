import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../../db/index.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { clientIp, parse } from '../../lib/http.js';
import { writeAudit } from '../../lib/audit.js';
import { requireCompany } from '../../lib/tenant.js';
import { parseIsoDate } from '../../lib/dates.js';
import { SUPPORTED_CURRENCIES } from '../../types.js';
import { isValidRate, reciprocal } from '../../lib/money.js';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');

export function settingsRoutes(app: FastifyInstance, db: Db) {
  // -------------------------------------------------------------------------
  // Company settings (key/value)
  // -------------------------------------------------------------------------
  app.get('/companies/:companyId/settings', async (req) => {
    const user = req.user!;
    const { companyId } = req.params as { companyId: string };
    await requireCompany(db, user.id, companyId, 'viewer');
    const res = await db.query<{ key: string; value: unknown }>(
      'SELECT key, value FROM company_settings WHERE company_id = $1 ORDER BY key',
      [companyId],
    );
    const settings: Record<string, unknown> = {};
    for (const row of res.rows) settings[row.key] = row.value;
    return { settings };
  });

  app.put('/companies/:companyId/settings', async (req) => {
    const user = req.user!;
    const { companyId } = req.params as { companyId: string };
    await requireCompany(db, user.id, companyId, 'admin');
    const body = parse(z.object({ settings: z.record(z.unknown()) }), req.body);

    await db.transaction(async (tx) => {
      for (const [key, value] of Object.entries(body.settings)) {
        await tx.query(
          `INSERT INTO company_settings (company_id, key, value)
           VALUES ($1, $2, $3::jsonb)
           ON CONFLICT (company_id, key)
           DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
          [companyId, key, JSON.stringify(value)],
        );
      }
      await writeAudit(tx, {
        companyId,
        userId: user.id,
        action: 'settings.update',
        entityType: 'company_settings',
        entityId: companyId,
        details: { keys: Object.keys(body.settings) },
        ip: clientIp(req),
      });
    });
    return { ok: true };
  });

  // -------------------------------------------------------------------------
  // Accounting periods
  // -------------------------------------------------------------------------
  app.get('/companies/:companyId/periods', async (req) => {
    const user = req.user!;
    const { companyId } = req.params as { companyId: string };
    await requireCompany(db, user.id, companyId, 'viewer');
    const res = await db.query(
      `SELECT * FROM accounting_periods WHERE company_id = $1 ORDER BY start_date DESC`,
      [companyId],
    );
    return { periods: res.rows };
  });

  app.post('/companies/:companyId/periods', async (req, reply) => {
    const user = req.user!;
    const { companyId } = req.params as { companyId: string };
    await requireCompany(db, user.id, companyId, 'admin');
    const body = parse(
      z.object({ name: z.string().min(1).max(80), startDate: isoDate, endDate: isoDate }),
      req.body,
    );
    const start = parseIsoDate(body.startDate, 'startDate');
    const end = parseIsoDate(body.endDate, 'endDate');
    if (end < start) {
      throw badRequest('INVALID_DATE_RANGE', 'Period end date must be on or after start date');
    }

    const overlap = await db.query(
      `SELECT 1 FROM accounting_periods
        WHERE company_id = $1 AND start_date <= $3 AND end_date >= $2`,
      [companyId, start, end],
    );
    if (overlap.rowCount > 0) {
      throw conflict('PERIOD_OVERLAP', 'This period overlaps an existing period');
    }

    const created = await db.query(
      `INSERT INTO accounting_periods (company_id, name, start_date, end_date)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [companyId, body.name.trim(), start, end],
    );
    await writeAudit(db, {
      companyId,
      userId: user.id,
      action: 'period.create',
      entityType: 'accounting_period',
      entityId: String((created.rows[0] as { id?: string })?.id ?? ''),
      details: { start, end },
      ip: clientIp(req),
    });
    return reply.code(201).send({ period: created.rows[0] });
  });

  app.post('/companies/:companyId/periods/:periodId/close', async (req) => {
    const user = req.user!;
    const { companyId, periodId } = req.params as { companyId: string; periodId: string };
    await requireCompany(db, user.id, companyId, 'admin');
    const updated = await db.query(
      `UPDATE accounting_periods
          SET status = 'closed', closed_at = now(), closed_by = $3
        WHERE id = $1 AND company_id = $2
    RETURNING *`,
      [periodId, companyId, user.id],
    );
    if (!updated.rows[0]) throw notFound('NOT_FOUND', 'Period not found');
    await writeAudit(db, {
      companyId,
      userId: user.id,
      action: 'period.close',
      entityType: 'accounting_period',
      entityId: periodId,
      ip: clientIp(req),
    });
    return { period: updated.rows[0] };
  });

  app.post('/companies/:companyId/periods/:periodId/reopen', async (req) => {
    const user = req.user!;
    const { companyId, periodId } = req.params as { companyId: string; periodId: string };
    await requireCompany(db, user.id, companyId, 'owner');
    const updated = await db.query(
      `UPDATE accounting_periods
          SET status = 'open', closed_at = NULL, closed_by = NULL
        WHERE id = $1 AND company_id = $2
    RETURNING *`,
      [periodId, companyId],
    );
    if (!updated.rows[0]) throw notFound('NOT_FOUND', 'Period not found');
    await writeAudit(db, {
      companyId,
      userId: user.id,
      action: 'period.reopen',
      entityType: 'accounting_period',
      entityId: periodId,
      ip: clientIp(req),
    });
    return { period: updated.rows[0] };
  });

  // -------------------------------------------------------------------------
  // Exchange rates
  // -------------------------------------------------------------------------
  app.get('/companies/:companyId/exchange-rates', async (req) => {
    const user = req.user!;
    const { companyId } = req.params as { companyId: string };
    await requireCompany(db, user.id, companyId, 'viewer');
    const q = req.query as { from?: string; to?: string; date?: string; limit?: string };
    const where = ['company_id = $1'];
    const params: unknown[] = [companyId];
    if (q.from) {
      params.push(q.from.toUpperCase());
      where.push(`from_currency = $${params.length}`);
    }
    if (q.to) {
      params.push(q.to.toUpperCase());
      where.push(`to_currency = $${params.length}`);
    }
    if (q.date) {
      params.push(parseIsoDate(q.date, 'date'));
      where.push(`rate_date = $${params.length}`);
    }
    const limit = Math.min(Number(q.limit ?? 200) || 200, 500);
    const res = await db.query(
      `SELECT * FROM exchange_rates WHERE ${where.join(' AND ')}
        ORDER BY rate_date DESC, from_currency LIMIT ${limit}`,
      params,
    );
    return { rates: res.rows };
  });

  app.post('/companies/:companyId/exchange-rates', async (req, reply) => {
    const user = req.user!;
    const { companyId } = req.params as { companyId: string };
    const ctx = await requireCompany(db, user.id, companyId, 'accountant');
    const body = parse(
      z.object({
        fromCurrency: z.enum(SUPPORTED_CURRENCIES),
        toCurrency: z.enum(SUPPORTED_CURRENCIES),
        rateDate: isoDate,
        rate: z.union([z.string(), z.number()]),
        source: z.string().max(120).optional(),
      }),
      req.body,
    );
    const rate = String(body.rate).trim().replace(',', '.');
    if (!isValidRate(rate)) {
      throw badRequest('VALIDATION_ERROR', 'Rate must be a positive number with at most 8 decimals');
    }
    if (body.fromCurrency === body.toCurrency) {
      throw badRequest('VALIDATION_ERROR', 'Currencies must differ');
    }
    const date = parseIsoDate(body.rateDate, 'rateDate');

    const created = await db.query(
      `INSERT INTO exchange_rates
         (company_id, from_currency, to_currency, rate_date, rate, source, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (company_id, from_currency, to_currency, rate_date)
       DO UPDATE SET rate = EXCLUDED.rate, source = EXCLUDED.source
       RETURNING *`,
      [
        companyId,
        body.fromCurrency,
        body.toCurrency,
        date,
        rate,
        body.source?.trim() || 'manual',
        user.id,
      ],
    );

    // A rate given as X->functional yields the reverse rate for convenience.
    if (body.toCurrency === ctx.company.functional_currency) {
      // Derived reverse rate computed with integer arithmetic (no floats).
      const reverse = reciprocal(rate);
      await db.query(
        `INSERT INTO exchange_rates
           (company_id, from_currency, to_currency, rate_date, rate, source, created_by)
         VALUES ($1,$2,$3,$4,$5,'derived',$6)
         ON CONFLICT (company_id, from_currency, to_currency, rate_date) DO NOTHING`,
        [companyId, body.toCurrency, body.fromCurrency, date, reverse, user.id],
      );
    }

    await writeAudit(db, {
      companyId,
      userId: user.id,
      action: 'exchange_rate.create',
      entityType: 'exchange_rate',
      entityId: String((created.rows[0] as { id?: string })?.id ?? ''),
      details: { pair: `${body.fromCurrency}/${body.toCurrency}`, rate, date },
      ip: clientIp(req),
    });
    return reply.code(201).send({ rate: created.rows[0] });
  });

  // -------------------------------------------------------------------------
  // Audit trail (sensitive operations)
  // -------------------------------------------------------------------------
  app.get('/companies/:companyId/audit', async (req) => {
    const user = req.user!;
    const { companyId } = req.params as { companyId: string };
    await requireCompany(db, user.id, companyId, 'admin');
    const q = req.query as { limit?: string; offset?: string };
    const limit = Math.min(Number(q.limit ?? 100) || 100, 500);
    const offset = Math.max(Number(q.offset ?? 0) || 0, 0);
    const res = await db.query(
      `SELECT a.*, u.email AS user_email, u.full_name AS user_name
         FROM audit_log a LEFT JOIN app_users u ON u.id = a.user_id
        WHERE a.company_id = $1
        ORDER BY a.created_at DESC, a.id DESC
        LIMIT ${limit} OFFSET ${offset}`,
      [companyId],
    );
    return { events: res.rows };
  });
}
