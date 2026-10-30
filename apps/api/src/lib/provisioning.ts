import type { Db } from '../db/index.js';
import type { Locale } from '../i18n/index.js';
import { DEFAULT_JOURNALS, DEMO_CHART_OF_ACCOUNTS } from '../seed/chart-of-accounts.js';
import type { CompanyRow } from '../types.js';

/**
 * Creates the demonstration chart of accounts, the five standard journals and
 * the first accounting period for a company.
 */
export async function provisionCompanyDefaults(
  tx: Db,
  company: Pick<CompanyRow, 'id' | 'financial_year_start' | 'financial_year_end' | 'functional_currency' | 'name'>,
  locale: Locale = 'fr',
): Promise<{ accounts: number; journals: number }> {
  for (const acc of DEMO_CHART_OF_ACCOUNTS) {
    await tx.query(
      `INSERT INTO accounts (company_id, code, name, type, currency, fs_mapping, description)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        company.id,
        acc.code,
        locale === 'en' ? acc.nameEn : acc.name,
        acc.type,
        company.functional_currency,
        acc.fsMapping,
        'DEMO account — not an official chart of accounts / Compte de démonstration',
      ],
    );
  }

  for (const j of DEFAULT_JOURNALS) {
    await tx.query(
      'INSERT INTO journals (company_id, code, name, type) VALUES ($1, $2, $3, $4)',
      [company.id, j.code, locale === 'en' ? j.nameEn : j.name, j.type],
    );
  }

  await tx.query(
    `INSERT INTO accounting_periods (company_id, name, start_date, end_date, status)
     VALUES ($1, $2, $3, $4, 'open')`,
    [
      company.id,
      `FY ${company.financial_year_start.slice(0, 4)}/${company.financial_year_end.slice(0, 4)}`,
      company.financial_year_start,
      company.financial_year_end,
    ],
  );

  return { accounts: DEMO_CHART_OF_ACCOUNTS.length, journals: DEFAULT_JOURNALS.length };
}

/** Creates an open accounting period covering the given range. */
export async function ensurePeriodForDate(tx: Db, companyId: string, entryDate: string): Promise<void> {
  const res = await tx.query<{ id: string }>(
    `SELECT id FROM accounting_periods
      WHERE company_id = $1 AND start_date <= $2 AND end_date >= $2
      ORDER BY start_date LIMIT 1`,
    [companyId, entryDate],
  );
  if (res.rowCount === 0) {
    // Auto-open a period for the calendar year if none exists, unless the year
    // is fully covered by a closed period (checked by the caller).
    const year = Number(entryDate.slice(0, 4));
    const closed = await tx.query(
      `SELECT 1 FROM accounting_periods
        WHERE company_id = $1 AND status = 'closed' AND start_date <= $2 AND end_date >= $2`,
      [companyId, entryDate],
    );
    if (closed.rowCount > 0) return;
    const start = `${year}-01-01`;
    const end = `${year}-12-31`;
    await tx.query(
      `INSERT INTO accounting_periods (company_id, name, start_date, end_date, status)
       VALUES ($1, $2, $3, $4, 'open')
       ON CONFLICT DO NOTHING`,
      [companyId, `FY ${year}`, start, end],
    );
  }
}
