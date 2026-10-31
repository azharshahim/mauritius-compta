/** Mission 21 — fiscal-year timeline used by the accounting screen. */
import type { Db } from '../../db/index.js';
import { notFound } from '../../lib/errors.js';

export async function financialYearTimeline(db: Db, companyId: string) {
  const company = await db.query<any>('SELECT id, name, functional_currency, financial_year_start, financial_year_end FROM companies WHERE id = $1', [companyId]);
  if (!company.rows[0]) throw notFound('COMPANY_NOT_FOUND', 'Company not found');
  const periods = await db.query<any>(
    `SELECT p.*,
            (SELECT count(*)::int FROM journal_entries e WHERE e.company_id = p.company_id AND e.entry_date BETWEEN p.start_date AND p.end_date AND e.status = 'draft') AS draft_count,
            (SELECT count(*)::int FROM journal_entries e WHERE e.company_id = p.company_id AND e.entry_date BETWEEN p.start_date AND p.end_date AND e.status = 'posted') AS posted_count,
            (SELECT count(*)::int FROM fiscal_archives a WHERE a.company_id = p.company_id AND a.period_id = p.id) AS archive_count
       FROM accounting_periods p WHERE p.company_id = $1 ORDER BY p.start_date DESC`, [companyId]);
  const closings = await db.query<any>(`SELECT * FROM fiscal_closings WHERE company_id = $1 ORDER BY version DESC`, [companyId]);
  const archives = await db.query<any>(`SELECT id, period_id, version, checksum, size_bytes, created_at FROM fiscal_archives WHERE company_id = $1 ORDER BY created_at DESC`, [companyId]);
  const allocations = await db.query<any>(`SELECT id, closing_id, status, result_amount::text, allocated_amount::text, entry_id FROM equity_allocations WHERE company_id = $1`, [companyId]);
  const closingByPeriod = new Map<string, any>();
  for (const c of closings.rows) if (!closingByPeriod.has(c.source_period_id)) closingByPeriod.set(c.source_period_id, c);
  const allocationByClosing = new Map<string, any>(allocations.rows.map((a: any) => [a.closing_id, a]));
  const archivedByPeriod = new Map<string, any[]>();
  for (const a of archives.rows) {
    const list = archivedByPeriod.get(a.period_id) ?? [];
    list.push(a); archivedByPeriod.set(a.period_id, list);
  }
  const rows = periods.rows.map((p: any) => {
    const closing = closingByPeriod.get(p.id) ?? null;
    return {
      id: p.id, name: p.name, startDate: p.start_date, endDate: p.end_date, status: p.status,
      closedAt: p.closed_at, draftEntries: p.draft_count, postedEntries: p.posted_count,
      closing: closing ? { id: closing.id, version: closing.version, status: closing.status,
        resultAmount: closing.result_amount, postedAt: closing.posted_at,
        allocation: allocationByClosing.get(closing.id) ?? null } : null,
      archives: archivedByPeriod.get(p.id) ?? [],
    };
  });
  return {
    company: { id: company.rows[0].id, name: company.rows[0].name, functionalCurrency: company.rows[0].functional_currency },
    currentPeriod: rows.find((r: any) => r.status === 'open') ?? null,
    lastClosedPeriod: rows.find((r: any) => r.status === 'closed') ?? null,
    periods: rows,
    counts: { periods: rows.length, open: rows.filter((r: any) => r.status === 'open').length,
      closed: rows.filter((r: any) => r.status === 'closed').length, archives: archives.rows.length },
    noteEn: 'Balances are continuous across periods. Closing entries and later carry-forward do not duplicate each other.',
    noteFr: 'Les soldes sont continus d’une période à l’autre. Les écritures de clôture et le report ne se dupliquent pas.',
  };
}
