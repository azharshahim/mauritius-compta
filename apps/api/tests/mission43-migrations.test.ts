import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { createPgliteDb, migrate, type Db } from '../src/db/index.js';

/**
 * Mission 42.1 / 43 migration safety on **fictional** legacy data.
 * Applies 0001..0024, inserts data, then applies 0025 and 0026 and checks that
 * every amount and label survives, that the migration is additive and that a
 * second run is a no-op.
 */
describe('mission 42.1 migration 0025 & 43 migration 0026 preserve legacy data', () => {
  let db: Db;
  const dir = path.resolve(process.cwd(), 'sql/migrations');

  beforeAll(async () => {
    db = await createPgliteDb();
    await db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`);
    const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
    for (const file of files.filter((f) => f < '0025')) {
      const sql = await readFile(path.join(dir, file), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      await db.transaction(async (tx) => {
        await tx.exec(sql);
        await tx.query('INSERT INTO schema_migrations (version, checksum) VALUES ($1,$2)', [file, checksum]);
      });
    }
  });

  afterAll(async () => {
    await db.close();
  });

  it('adds 1150 only when absent and keeps a custom 1150 label untouched', async () => {
    const company = await db.query<{ id: string }>(
      `INSERT INTO companies (name, financial_year_start, financial_year_end)
       VALUES ('Legacy Fictive 0025', '2025-01-01', '2025-12-31') RETURNING id`,
    );
    const companyId = company.rows[0]!.id;
    const other = await db.query<{ id: string }>(
      `INSERT INTO companies (name, financial_year_start, financial_year_end)
       VALUES ('Legacy Custom 0025', '2025-01-01', '2025-12-31') RETURNING id`,
    );
    const otherId = other.rows[0]!.id;
    await db.query(
      `INSERT INTO accounts (company_id, code, name, name_en, name_fr, type, currency, is_active, posting_allowed)
       VALUES ($1,'1100','Créances','Trade receivables','Clients','asset','MUR',true,true)`,
      [companyId],
    );
    await db.query(
      `INSERT INTO accounts (company_id, code, name, name_en, name_fr, type, currency, is_active, posting_allowed, account_role)
       VALUES ($1,'1100','Créances','Trade receivables','Clients','asset','MUR',true,true,NULL),
              ($1,'1150','Compte 1150 personnalisé','Custom 1150 label','Libellé personnalisé','asset','MUR',true,true,NULL)`,
      [otherId],
    );
    const customer = await db.query<{ id: string }>(
      `INSERT INTO billing_customers (company_id, name) VALUES ($1,'Client legacy fictif') RETURNING id`,
      [companyId],
    );
    const customerId = customer.rows[0]!.id;
    const payment = await db.query<{ id: string }>(
      `INSERT INTO billing_payments (company_id, customer_id, payment_no, payment_date, amount, currency, reference)
       VALUES ($1,$2,'REC-LEGACY-1','2025-06-15',1234.5678,'MUR','legacy-fictif') RETURNING id`,
      [companyId, customerId],
    );
    const paymentId = payment.rows[0]!.id;

    const applied = await migrate(db);
    expect(applied).toContain('0025_mission42_purchase_sales_integrity.sql');
    expect(applied).toContain('0026_mission43_bank_reconciliation_periods.sql');
    expect(applied.filter((f) => f < '0025')).toEqual([]);

    const newAccount = await db.query<{ name: string; account_role: string }>(
      `SELECT name, account_role FROM accounts WHERE company_id = $1 AND code = '1150'`,
      [companyId],
    );
    expect(newAccount.rows).toHaveLength(1);
    expect(newAccount.rows[0]!.account_role).toBe('prepayment');
    const custom = await db.query<{ name: string }>(
      `SELECT name FROM accounts WHERE company_id = $1 AND code = '1150'`,
      [otherId],
    );
    expect(custom.rows).toHaveLength(1);
    expect(custom.rows[0]!.name).toBe('Compte 1150 personnalisé');

    const kept = await db.query<{ amount: string; reference: string; unallocated_amount: string }>(
      `SELECT amount::text, reference, unallocated_amount::text FROM billing_payments WHERE id = $1`,
      [paymentId],
    );
    expect(kept.rows[0]).toEqual({
      amount: '1234.5678',
      reference: 'legacy-fictif',
      unallocated_amount: '0.0000',
    });
    const cols = await db.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'billing_payment_allocations'`,
    );
    const names = cols.rows.map((r) => r.column_name);
    expect(names).toContain('allocated_date');
    expect(names).toContain('cancelled_at');
    expect(names).toContain('reclass_entry_id');
    expect(names).toContain('reclass_amount');
    const settings = await db.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name = 'billing_settings' AND column_name = 'advance_to_supplier_account_id'`,
    );
    expect(settings.rows).toHaveLength(1);
    const periods = await db.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name IN ('bank_reconciliation_periods','bank_reconciliation_period_events')`,
    );
    expect(periods.rows).toHaveLength(2);
  });

  it('is a no-op when applied a second time (no destructive change)', async () => {
    expect(await migrate(db)).toEqual([]);
  });
});
