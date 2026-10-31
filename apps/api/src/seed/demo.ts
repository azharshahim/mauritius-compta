/**
 * Demo data — 100% fictitious.
 *
 * Names, BRN/VAT numbers, addresses and amounts below are invented for testing
 * and must never be replaced with real client data in this repository.
 */
import type { Db } from '../db/index.js';
import { hashPassword } from '../lib/password.js';
import { provisionCompanyDefaults } from '../lib/provisioning.js';
import { parseAmount, multiply, formatAmount } from '../lib/money.js';
import type { CompanyRow, EntryRow, UserRow } from '../types.js';

export const DEMO_EMAIL = 'demo@mauritius-compta.test';
export const DEMO_PASSWORD = 'DemoPassw0rd2026';
export const DEMO_COMPANY_NAME = 'Lagon Bleu Trading Ltd (DEMO)';

interface DemoLine {
  code: string;
  debit?: string;
  credit?: string;
}

interface DemoEntry {
  journal: string;
  date: string;
  description: string;
  reference?: string;
  currency?: string;
  rate?: string;
  status?: 'draft' | 'posted';
  lines: DemoLine[];
}

const DEMO_ENTRIES: DemoEntry[] = [
  {
    journal: 'OD',
    date: '2025-07-01',
    description: 'Apport en capital — données fictives / Opening capital — fictitious data',
    reference: 'DEMO-CAP-001',
    lines: [
      { code: '1010', debit: '500000.00' },
      { code: '3000', credit: '500000.00' },
    ],
  },
  {
    journal: 'BQ',
    date: '2025-07-10',
    description: 'Achat de matériel informatique — démonstration',
    reference: 'DEMO-EQP-001',
    lines: [
      { code: '1500', debit: '120000.00' },
      { code: '1010', credit: '120000.00' },
    ],
  },
  {
    journal: 'SAL',
    date: '2025-07-15',
    description: 'Facture de vente fictive FA-2025-001',
    reference: 'FA-2025-001',
    lines: [
      { code: '1100', debit: '125000.00' },
      { code: '4000', credit: '125000.00' },
    ],
  },
  {
    journal: 'PUR',
    date: '2025-07-20',
    description: 'Achat de marchandises fictif AC-2025-001',
    reference: 'AC-2025-001',
    lines: [
      { code: '5000', debit: '60000.00' },
      { code: '2000', credit: '60000.00' },
    ],
  },
  {
    journal: 'BQ',
    date: '2025-08-01',
    description: 'Loyer du mois d’août — démonstration',
    reference: 'LOY-2025-08',
    lines: [
      { code: '6100', debit: '15000.00' },
      { code: '1010', credit: '15000.00' },
    ],
  },
  {
    journal: 'BQ',
    date: '2025-08-05',
    description: 'Encaissement du client fictif FA-2025-001',
    reference: 'ENC-2025-001',
    lines: [
      { code: '1010', debit: '125000.00' },
      { code: '1100', credit: '125000.00' },
    ],
  },
  {
    journal: 'SAL',
    date: '2025-08-12',
    description: 'Vente en EUR — taux saisi manuellement (démo)',
    reference: 'FA-EUR-001',
    currency: 'EUR',
    rate: '48.5000',
    lines: [
      { code: '1100', debit: '1000.00' },
      { code: '4010', credit: '1000.00' },
    ],
  },
  {
    journal: 'OD',
    date: '2025-08-20',
    description: 'Brouillon — frais bancaires à confirmer (non validé)',
    reference: 'BROUILLON-001',
    status: 'draft',
    lines: [
      { code: '6140', debit: '1200.00' },
      { code: '1010', credit: '1200.00' },
    ],
  },
];

async function insertEntry(
  tx: Db,
  companyId: string,
  userId: string,
  journal: { id: string; code: string },
  accounts: Map<string, string>,
  entry: DemoEntry,
  status: 'draft' | 'posted',
  options: { source?: 'manual' | 'reversal'; reversalOf?: string; description?: string } = {},
): Promise<EntryRow> {
  const year = Number(entry.date.slice(0, 4));
  const seq = await tx.query<{ last_no: number }>(
    `INSERT INTO entry_sequences (company_id, journal_id, year, last_no)
     VALUES ($1,$2,$3,1)
     ON CONFLICT (company_id, journal_id, year)
     DO UPDATE SET last_no = entry_sequences.last_no + 1
     RETURNING last_no`,
    [companyId, journal.id, year],
  );
  const entryNo = `${journal.code}-${year}-${String(seq.rows[0]!.last_no).padStart(4, '0')}`;
  const currency = entry.currency ?? 'MUR';
  const rate = entry.rate ?? '1';

  const inserted = await tx.query<EntryRow>(
    `INSERT INTO journal_entries
       (company_id, journal_id, entry_no, entry_date, reference, description, currency,
        exchange_rate, status, source, reversal_of_entry_id, created_by, posted_at, posted_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$12)
     RETURNING *`,
    [
      companyId,
      journal.id,
      entryNo,
      entry.date,
      entry.reference ?? null,
      options.description ?? entry.description,
      currency,
      rate,
      status,
      options.source ?? 'manual',
      options.reversalOf ?? null,
      userId,
      status === 'posted' ? new Date() : null,
    ],
  );

  let lineNo = 1;
  for (const line of entry.lines) {
    const accountId = accounts.get(line.code);
    if (!accountId) throw new Error(`Demo chart is missing account ${line.code}`);
    const txn = parseAmount(line.debit ?? line.credit ?? '0');
    const functional = currency === 'MUR' ? txn : multiply(txn, rate);
    await tx.query(
      `INSERT INTO journal_lines
         (entry_id, company_id, line_no, account_id, description, debit, credit,
          txn_currency, txn_amount, fx_rate)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        inserted.rows[0]!.id,
        companyId,
        lineNo++,
        accountId,
        null,
        line.debit ? formatAmount(functional) : '0.0000',
        line.credit ? formatAmount(functional) : '0.0000',
        currency,
        formatAmount(txn),
        rate,
      ],
    );
  }
  return inserted.rows[0]!;
}

export interface SeedResult {
  created: boolean;
  email: string;
  password: string;
  companyId: string;
  companyName: string;
}

export async function seedDemo(db: Db, options: { force?: boolean } = {}): Promise<SeedResult> {
  const existing = await db.query<UserRow>('SELECT * FROM app_users WHERE lower(email) = lower($1)', [
    DEMO_EMAIL,
  ]);

  if (existing.rows[0] && !options.force) {
    const company = await db.query<CompanyRow>(
      `SELECT c.* FROM companies c JOIN company_members m ON m.company_id = c.id
        WHERE m.user_id = $1 ORDER BY c.created_at LIMIT 1`,
      [existing.rows[0].id],
    );
    return {
      created: false,
      email: DEMO_EMAIL,
      password: DEMO_PASSWORD,
      companyId: company.rows[0]?.id ?? '',
      companyName: company.rows[0]?.name ?? '',
    };
  }

  return db.transaction(async (tx) => {
    if (existing.rows[0] && options.force) {
      await tx.query('DELETE FROM companies WHERE created_by = $1', [existing.rows[0].id]);
      await tx.query('DELETE FROM app_users WHERE id = $1', [existing.rows[0].id]);
    }

    const user = (
      await tx.query<UserRow>(
        `INSERT INTO app_users (email, password_hash, full_name, locale)
         VALUES ($1,$2,$3,'fr') RETURNING *`,
        [DEMO_EMAIL, await hashPassword(DEMO_PASSWORD), 'Comptable de démonstration'],
      )
    ).rows[0]!;

    const company = (
      await tx.query<CompanyRow>(
        `INSERT INTO companies
           (name, brn, vat_number, registered_address, business_activity,
            financial_year_start, financial_year_end, functional_currency, presentation_currency,
            accounting_standard, status, locale, created_by)
         VALUES ($1,'DEMO-BRN-0001','DEMO-VAT-0001',
                 '12, Royal Road, Port Louis, Mauritius (fictitious address)',
                 'Wholesale of household goods (fictitious activity)',
                 '2025-07-01','2026-06-30','MUR','MUR','IFRS','active','fr',$2)
         RETURNING *`,
        [DEMO_COMPANY_NAME, user.id],
      )
    ).rows[0]!;

    await tx.query('INSERT INTO company_members (company_id, user_id, role) VALUES ($1,$2,$3)', [
      company.id,
      user.id,
      'owner',
    ]);
    await provisionCompanyDefaults(tx, company, 'fr');

    // A second, open financial year so that today's dated entries are accepted.
    await tx.query(
      `INSERT INTO accounting_periods (company_id, name, start_date, end_date)
       VALUES ($1, 'FY 2026/2027', '2026-07-01', '2027-06-30')`,
      [company.id],
    );

    const accountRows = await tx.query<{ id: string; code: string }>(
      'SELECT id, code FROM accounts WHERE company_id = $1',
      [company.id],
    );
    const accounts = new Map(accountRows.rows.map((r) => [r.code, r.id]));
    const journalRows = await tx.query<{ id: string; code: string }>(
      'SELECT id, code FROM journals WHERE company_id = $1',
      [company.id],
    );
    const journals = new Map(journalRows.rows.map((r) => [r.code, r]));
    const journal = (code: string) => {
      const j = journals.get(code);
      if (!j) throw new Error(`Missing journal ${code}`);
      return j;
    };

    let rentEntry: EntryRow | null = null;
    for (const entry of DEMO_ENTRIES) {
      const created = await insertEntry(
        tx,
        company.id,
        user.id,
        journal(entry.journal),
        accounts,
        entry,
        entry.status ?? 'posted',
      );
      if (entry.reference === 'LOY-2025-08') rentEntry = created;
    }

    // Demonstrate the reversal (contrepassation) mechanism on the rent entry.
    if (rentEntry) {
      const rent = DEMO_ENTRIES.find((e) => e.reference === 'LOY-2025-08')!;
      const swapped: DemoEntry = {
        ...rent,
        date: '2025-09-01',
        reference: 'LOY-2025-08-ANN',
        lines: rent.lines.map((l) => ({
          code: l.code,
          debit: l.credit,
          credit: l.debit,
        })),
      };
      await insertEntry(tx, company.id, user.id, journal('BQ'), accounts, swapped, 'posted', {
        source: 'reversal',
        reversalOf: rentEntry.id,
        description: 'Contrepassation du loyer d’août (démo)',
      });
    }

    return {
      created: true,
      email: DEMO_EMAIL,
      password: DEMO_PASSWORD,
      companyId: company.id,
      companyName: company.name,
    };
  });
}
