import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPgliteDb, migrate, type Db } from '../src/db/index.js';

describe('PostgreSQL migrations', () => {
  let db: Db;

  beforeAll(async () => {
    db = await createPgliteDb();
  });

  afterAll(async () => {
    await db.close();
  });

  it('applies all migrations on a fresh database', async () => {
    const applied = await migrate(db);
    expect(applied.length).toBeGreaterThanOrEqual(2);
    expect(applied[0]).toBe('0001_core.sql');
  });

  it('is idempotent (second run does nothing)', async () => {
    const applied = await migrate(db);
    expect(applied).toEqual([]);
  });

  it('records checksums for every migration', async () => {
    const rows = await db.query<{ version: string; checksum: string }>(
      'SELECT version, checksum FROM schema_migrations ORDER BY version',
    );
    expect(rows.rows.length).toBeGreaterThanOrEqual(2);
    for (const row of rows.rows) {
      expect(row.checksum).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('creates the expected tables and constraints', async () => {
    const tables = await db.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' ORDER BY table_name`,
    );
    const names = tables.rows.map((r) => r.table_name);
    for (const expected of [
      'app_users',
      'sessions',
      'companies',
      'company_members',
      'accounts',
      'journals',
      'journal_entries',
      'journal_lines',
      'accounting_periods',
      'exchange_rates',
      'audit_log',
      'attachments',
      'schema_migrations',
    ]) {
      expect(names).toContain(expected);
    }
  });

  it('rejects a posted entry that is not balanced at the database level', async () => {
    const company = await db.query<{ id: string }>(
      `INSERT INTO companies (name, financial_year_start, financial_year_end)
       VALUES ('DB control test (fictitious)', '2025-01-01', '2025-12-31') RETURNING id`,
    );
    const companyId = company.rows[0]!.id;
    const journal = await db.query<{ id: string }>(
      `INSERT INTO journals (company_id, code, name, type) VALUES ($1,'OD','General','general') RETURNING id`,
      [companyId],
    );
    const acc1 = await db.query<{ id: string }>(
      `INSERT INTO accounts (company_id, code, name, type) VALUES ($1,'1000','Cash','asset') RETURNING id`,
      [companyId],
    );
    const acc2 = await db.query<{ id: string }>(
      `INSERT INTO accounts (company_id, code, name, type) VALUES ($1,'4000','Revenue','revenue') RETURNING id`,
      [companyId],
    );

    await expect(
      db.transaction(async (tx) => {
        const entry = await tx.query<{ id: string }>(
          `INSERT INTO journal_entries
             (company_id, journal_id, entry_no, entry_date, description, currency, status)
           VALUES ($1,$2,'OD-2025-0001','2025-03-01','Unbalanced','MUR','posted') RETURNING id`,
          [companyId, journal.rows[0]!.id],
        );
        await tx.query(
          `INSERT INTO journal_lines (entry_id, company_id, line_no, account_id, debit, credit)
           VALUES ($1,$2,1,$3,100.0000,0.0000), ($1,$2,2,$4,0.0000,50.0000)`,
          [entry.rows[0]!.id, companyId, acc1.rows[0]!.id, acc2.rows[0]!.id],
        );
      }),
    ).rejects.toThrow(/ENTRY_UNBALANCED/);
  });

  it('prevents cross-company account references at the database level', async () => {
    const a = await db.query<{ id: string }>(
      `INSERT INTO companies (name, financial_year_start, financial_year_end)
       VALUES ('Isolation A (fictitious)', '2025-01-01', '2025-12-31') RETURNING id`,
    );
    const b = await db.query<{ id: string }>(
      `INSERT INTO companies (name, financial_year_start, financial_year_end)
       VALUES ('Isolation B (fictitious)', '2025-01-01', '2025-12-31') RETURNING id`,
    );
    const journal = await db.query<{ id: string }>(
      `INSERT INTO journals (company_id, code, name, type) VALUES ($1,'OD','General','general') RETURNING id`,
      [a.rows[0]!.id],
    );
    const foreignAccount = await db.query<{ id: string }>(
      `INSERT INTO accounts (company_id, code, name, type) VALUES ($1,'1000','Cash','asset') RETURNING id`,
      [b.rows[0]!.id],
    );

    await expect(
      db.transaction(async (tx) => {
        const entry = await tx.query<{ id: string }>(
          `INSERT INTO journal_entries
             (company_id, journal_id, entry_no, entry_date, description, currency, status)
           VALUES ($1,$2,'OD-2025-0001','2025-03-01','Cross company','MUR','draft') RETURNING id`,
          [a.rows[0]!.id, journal.rows[0]!.id],
        );
        await tx.query(
          `INSERT INTO journal_lines (entry_id, company_id, line_no, account_id, debit, credit)
           VALUES ($1,$2,1,$3,10.0000,0.0000)`,
          [entry.rows[0]!.id, a.rows[0]!.id, foreignAccount.rows[0]!.id],
        );
      }),
    ).rejects.toThrow(/CROSS_COMPANY_REFERENCE/);
  });
});
