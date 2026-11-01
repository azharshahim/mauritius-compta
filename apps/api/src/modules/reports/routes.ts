import type { FastifyInstance } from 'fastify';
import type { Db } from '../../db/index.js';
import { requireCompany } from '../../lib/tenant.js';
import { parseIsoDate } from '../../lib/dates.js';
import { toCsv } from '../../lib/http.js';
import { badRequest } from '../../lib/errors.js';
import { formatMoney, parseAmount } from '../../lib/money.js';
import { t, type Locale } from '../../i18n/index.js';
import { computeLedger, computeStatements, computeTrialBalance, type ReportRange } from './service.js';
import { ledgerPdf, statementsPdf, trialBalancePdf } from './pdf.js';
import { subledgerReconciliation } from '../reconciliation/service.js';
import { vatControl } from '../reconciliation/vat.js';

function parseRange(
  query: Record<string, string | undefined>,
  company: { financial_year_start: string; financial_year_end: string },
): ReportRange {
  const from = query.from ? parseIsoDate(query.from, 'from') : company.financial_year_start;
  const to = query.to ? parseIsoDate(query.to, 'to') : company.financial_year_end;
  if (from > to) throw badRequest('INVALID_DATE_RANGE', 'The start date must be before the end date');
  return {
    from,
    to,
    accountId: query.accountId || undefined,
    search: query.search || undefined,
    includeInactive: query.includeInactive === 'true',
  };
}

function pickLocale(query: Record<string, string | undefined>, fallback: Locale): Locale {
  const l = query.lang ?? query.locale;
  return l === 'en' ? 'en' : l === 'fr' ? 'fr' : fallback;
}

export function reportRoutes(app: FastifyInstance, db: Db) {
  // Mission 42 — AR/AP subledger <-> general ledger control. Read-only: no
  // amount is adjusted and an unexplained difference is never hidden.
  app.get('/companies/:companyId/reports/vat-control', async (req) => {
    const user = req.user!;
    const { companyId } = req.params as { companyId: string };
    const ctx = await requireCompany(db, user.id, companyId, 'viewer', 'accounting');
    const query = req.query as Record<string, string | undefined>;
    const from = query.from ? parseIsoDate(query.from, 'from') : ctx.company.financial_year_start;
    const to = query.to ? parseIsoDate(query.to, 'to') : ctx.company.financial_year_end;
    if (from > to) throw badRequest('INVALID_DATE_RANGE', 'The start date must be before the end date');
    return vatControl(db, companyId, from, to);
  });

  app.get('/companies/:companyId/reports/subledger-reconciliation', async (req) => {
    const user = req.user!;
    const { companyId } = req.params as { companyId: string };
    await requireCompany(db, user.id, companyId, 'viewer', 'accounting');
    const query = req.query as Record<string, string | undefined>;
    const asOf = query.asOf ? parseIsoDate(query.asOf, 'asOf') : new Date().toISOString().slice(0, 10);
    return subledgerReconciliation(db, companyId, asOf);
  });

  // -------------------------------------------------------------------------
  // General ledger
  // -------------------------------------------------------------------------
  app.get('/companies/:companyId/reports/ledger', async (req, reply) => {
    const user = req.user!;
    const { companyId } = req.params as { companyId: string };
    const ctx = await requireCompany(db, user.id, companyId, 'viewer');
    const query = req.query as Record<string, string | undefined>;
    const range = parseRange(query, ctx.company);
    const format = query.format ?? 'json';
    const csvLocale = pickLocale(query, user.locale);

    const ledger = await computeLedger(db, companyId, ctx.company.functional_currency, range);

    if (format === 'csv') {
      const rows: (string | number)[][] = [
        [
          t(csvLocale, 'pdf.account'),
          t(csvLocale, 'pdf.date'),
          t(csvLocale, 'pdf.journal'),
          t(csvLocale, 'csv.entryNo'),
          t(csvLocale, 'pdf.reference'),
          t(csvLocale, 'pdf.description'),
          t(csvLocale, 'pdf.debit'),
          t(csvLocale, 'pdf.credit'),
        ],
      ];
      for (const account of ledger.accounts) {
        for (const l of account.lines) {
          rows.push([
            `${account.code} ${account.name}`,
            l.date,
            l.journal,
            l.entryNo,
            l.reference ?? '',
            l.description,
            l.debit,
            l.credit,
          ]);
        }
      }
      rows.push([]);
      rows.push([t(csvLocale, 'csv.demoNote')]);
      reply
        .header('content-type', 'text/csv; charset=utf-8')
        .header(
          'content-disposition',
          `attachment; filename="ledger-${ctx.company.name.replace(/[^\w-]+/g, '_')}-${range.from}_${range.to}.csv"`,
        );
      return reply.send(toCsv(rows));
    }

    if (format === 'pdf') {
      const locale = pickLocale(query, user.locale);
      const buffer = await ledgerPdf(ctx.company, ledger, locale);
      reply.header('content-type', 'application/pdf');
      reply.header(
        'content-disposition',
        `inline; filename="general-ledger-${range.from}_${range.to}.pdf"`,
      );
      return reply.send(buffer);
    }

    return { ...ledger, company: ctx.company };
  });

  // -------------------------------------------------------------------------
  // Trial balance
  // -------------------------------------------------------------------------
  app.get('/companies/:companyId/reports/trial-balance', async (req, reply) => {
    const user = req.user!;
    const { companyId } = req.params as { companyId: string };
    const ctx = await requireCompany(db, user.id, companyId, 'viewer');
    const query = req.query as Record<string, string | undefined>;
    const range = parseRange(query, ctx.company);
    const format = query.format ?? 'json';
    const locale = pickLocale(query, user.locale);
    const currency = ctx.company.functional_currency;

    const tb = await computeTrialBalance(db, companyId, currency, range);

    if (format === 'csv') {
      const rows: (string | number)[][] = [
        [
          t(locale, 'csv.code'),
          t(locale, 'pdf.account'),
          t(locale, 'csv.openingDebit'),
          t(locale, 'csv.openingCredit'),
          t(locale, 'csv.movementDebit'),
          t(locale, 'csv.movementCredit'),
          t(locale, 'csv.closingDebit'),
          t(locale, 'csv.closingCredit'),
        ],
      ];
      for (const r of tb.rows) {
        rows.push([
          r.code,
          r.name,
          r.openingDebit,
          r.openingCredit,
          r.movementDebit,
          r.movementCredit,
          r.closingDebit,
          r.closingCredit,
        ]);
      }
      rows.push([
        '',
        t(locale, 'csv.total'),
        tb.totals.openingDebit,
        tb.totals.openingCredit,
        tb.totals.movementDebit,
        tb.totals.movementCredit,
        tb.totals.closingDebit,
        tb.totals.closingCredit,
      ]);
      rows.push([]);
      rows.push([t(locale, 'csv.demoNote')]);
      reply
        .header('content-type', 'text/csv; charset=utf-8')
        .header('content-disposition', `attachment; filename="trial-balance-${range.from}_${range.to}.csv"`);
      return reply.send(toCsv(rows));
    }

    if (format === 'pdf') {
      const buffer = await trialBalancePdf(ctx.company, tb, locale);
      reply.header('content-type', 'application/pdf');
      reply.header('content-disposition', `inline; filename="trial-balance-${range.from}_${range.to}.pdf"`);
      return reply.send(buffer);
    }

    return { ...tb, company: ctx.company };
  });

  // -------------------------------------------------------------------------
  // Financial statements
  // -------------------------------------------------------------------------
  app.get('/companies/:companyId/reports/statements', async (req, reply) => {
    const user = req.user!;
    const { companyId } = req.params as { companyId: string };
    const ctx = await requireCompany(db, user.id, companyId, 'viewer');
    const query = req.query as Record<string, string | undefined>;
    const range = parseRange(query, ctx.company);
    const format = query.format ?? 'json';
    const locale = pickLocale(query, user.locale);
    // P0-01: amounts are always computed in the functional currency. The
    // configured presentation currency is returned as metadata but is not
    // applied until a validated historical-rate conversion exists. Never pass
    // presentation_currency as the currency of the amounts.
    const currency = ctx.company.functional_currency;
    const presentationCurrency =
      ctx.company.presentation_currency || ctx.company.functional_currency;

    const statements = await computeStatements(
      db,
      companyId,
      currency,
      range,
      presentationCurrency,
    );

    if (format === 'csv') {
      const rows: (string | number)[][] = [
        [
          t(locale, 'csv.section'),
          t(locale, 'csv.code'),
          t(locale, 'pdf.account'),
          t(locale, 'csv.amount'),
        ],
      ];
      for (const l of statements.financialPosition.assets.lines)
        rows.push([t(locale, 'csv.assets'), l.code, l.name, l.amount]);
      rows.push([
        t(locale, 'csv.assets'),
        '',
        t(locale, 'csv.totalAssets'),
        statements.financialPosition.totalAssets,
      ]);
      for (const l of statements.financialPosition.liabilities.lines)
        rows.push([t(locale, 'csv.liabilities'), l.code, l.name, l.amount]);
      for (const l of statements.financialPosition.equity.lines)
        rows.push([t(locale, 'csv.equity'), l.code, l.name, l.amount]);
      rows.push([
        t(locale, 'csv.equity'),
        '',
        t(locale, 'csv.result'),
        statements.financialPosition.unappropriatedResult,
      ]);
      rows.push([
        t(locale, 'csv.equity'),
        '',
        t(locale, 'csv.totalLiabilitiesEquity'),
        statements.financialPosition.totalLiabilitiesAndEquity,
      ]);
      for (const l of statements.profitAndLoss.revenue.lines)
        rows.push([t(locale, 'csv.revenue'), l.code, l.name, l.amount]);
      rows.push([
        t(locale, 'csv.revenue'),
        '',
        t(locale, 'csv.totalRevenue'),
        statements.profitAndLoss.revenue.total,
      ]);
      for (const l of statements.profitAndLoss.expenses.lines)
        rows.push([t(locale, 'csv.expenses'), l.code, l.name, l.amount]);
      rows.push([
        t(locale, 'csv.expenses'),
        '',
        t(locale, 'csv.totalExpenses'),
        statements.profitAndLoss.expenses.total,
      ]);
      rows.push(['', '', t(locale, 'csv.profitForPeriod'), statements.profitAndLoss.profit]);
      rows.push([]);
      // Make the export self-describing: the amounts above are in the
      // functional currency, even when a different presentation currency is
      // configured on the company.
      rows.push([t(locale, 'pdf.currency'), statements.currency]);
      rows.push([t(locale, 'csv.demoNote')]);
      reply
        .header('content-type', 'text/csv; charset=utf-8')
        .header('content-disposition', `attachment; filename="statements-${range.from}_${range.to}.csv"`);
      return reply.send(toCsv(rows));
    }

    if (format === 'pdf') {
      const buffer = await statementsPdf(ctx.company, statements, locale);
      reply.header('content-type', 'application/pdf');
      reply.header('content-disposition', `inline; filename="statements-${range.from}_${range.to}.pdf"`);
      return reply.send(buffer);
    }

    return { ...statements, company: ctx.company };
  });

  // -------------------------------------------------------------------------
  // Dashboard summary
  // -------------------------------------------------------------------------
  app.get('/companies/:companyId/dashboard', async (req) => {
    const user = req.user!;
    const { companyId } = req.params as { companyId: string };
    const ctx = await requireCompany(db, user.id, companyId, 'viewer');
    const query = req.query as { from?: string; to?: string };
    const range = parseRange(query, ctx.company);

    const counts = await db.query<{
      accounts: string;
      journals: string;
      drafts: string;
      posted: string;
    }>(
      `SELECT
         (SELECT count(*)::text FROM accounts WHERE company_id = $1 AND is_active) AS accounts,
         (SELECT count(*)::text FROM journals WHERE company_id = $1) AS journals,
         (SELECT count(*)::text FROM journal_entries WHERE company_id = $1 AND status = 'draft') AS drafts,
         (SELECT count(*)::text FROM journal_entries WHERE company_id = $1 AND status = 'posted') AS posted`,
      [companyId],
    );

    const statements = await computeStatements(
      db,
      companyId,
      ctx.company.functional_currency,
      range,
    );

    const recent = await db.query(
      `SELECT e.id, e.entry_no, e.entry_date::text, e.description, e.status, j.code AS journal_code,
              COALESCE(SUM(l.debit),0)::text AS total_debit
         FROM journal_entries e
         JOIN journals j ON j.id = e.journal_id
         LEFT JOIN journal_lines l ON l.entry_id = e.id
        WHERE e.company_id = $1
        GROUP BY e.id, j.code
        ORDER BY e.entry_date DESC, e.created_at DESC
        LIMIT 6`,
      [companyId],
    );

    const openPeriods = await db.query(
      `SELECT id, name, start_date::text, end_date::text, status
         FROM accounting_periods WHERE company_id = $1 ORDER BY start_date DESC LIMIT 3`,
      [companyId],
    );

    const row = counts.rows[0]!;
    return {
      company: ctx.company,
      role: ctx.role,
      range,
      kpis: {
        accounts: Number(row.accounts),
        journals: Number(row.journals),
        draftEntries: Number(row.drafts),
        postedEntries: Number(row.posted),
        revenue: statements.profitAndLoss.revenue.total,
        expenses: statements.profitAndLoss.expenses.total,
        profit: statements.profitAndLoss.profit,
        revenueFormatted: formatMoney(statements.profitAndLoss.revenue.total, user.locale, ctx.company.functional_currency),
        expensesFormatted: formatMoney(statements.profitAndLoss.expenses.total, user.locale, ctx.company.functional_currency),
        profitFormatted: formatMoney(statements.profitAndLoss.profit, user.locale, ctx.company.functional_currency),
        balancedSheet: statements.financialPosition.balanced,
        currency: ctx.company.functional_currency,
        totalAssets: statements.financialPosition.totalAssets,
      },
      recentEntries: recent.rows,
      periods: openPeriods.rows,
      totalsCheck: {
        difference: formatMoney(
          parseAmount(statements.financialPosition.totalAssets) -
            parseAmount(statements.financialPosition.totalLiabilitiesAndEquity),
          user.locale,
        ),
      },
    };
  });
}
