/**
 * Mission 42 — subledger ↔ general ledger reconciliation.
 *
 * This is a read-only control. It never adjusts an amount, never "forces" a
 * difference to zero and never creates an entry. It compares:
 *   - the posted general-ledger balance of collective AR/AP accounts;
 *   - the posted subledger net amount;
 *   - the issued documents/payments that are not posted yet.
 *
 * A difference is reported as `explained` only when it is exactly the net of
 * unposted items. Anything else is `unexplained` and must be investigated.
 */
import type { Db } from '../../db/index.js';
import { conflict } from '../../lib/errors.js';
import { formatAmount, parseAmount } from '../../lib/money.js';

type MoneyMap = Map<string, bigint>;

interface AccountRow {
  id: string;
  code: string;
  name: string;
  account_role: string | null;
}

interface Remittance {
  id: string;
  kind?: 'invoice' | 'credit_note';
  number: string | null;
  partyId: string;
  partyName: string;
  date: string;
  currency: string;
  amount: string;
  accountId: string;
  posted?: boolean;
}

export interface ReconciliationRow {
  accountId: string;
  accountCode: string;
  accountName: string;
  currency: string;
  glBalance: string;
  postedSubledger: string;
  unpostedDocuments: string;
  subledgerTotal: string;
  difference: string;
  explainedDifference: string;
  unexplainedDifference: string;
  status: 'reconciled' | 'explained' | 'unexplained';
}

export interface SubledgerControl {
  side: 'receivable' | 'payable';
  asOf: string;
  accounts: { id: string; code: string; name: string }[];
  rows: ReconciliationRow[];
  totalsByCurrency: {
    currency: string;
    glBalance: string;
    postedSubledger: string;
    unpostedDocuments: string;
    subledgerTotal: string;
    difference: string;
    unexplainedDifference: string;
  }[];
  unpostedDocuments: {
    id: string;
    kind: 'invoice' | 'credit_note';
    number: string | null;
    partyId: string;
    partyName: string;
    date: string;
    currency: string;
    amount: string;
    accountId: string;
  }[];
  unpostedPayments: {
    id: string;
    number: string | null;
    partyId: string;
    partyName: string;
    date: string;
    currency: string;
    amount: string;
    accountId: string;
  }[];
  controls: {
    reconciled: boolean;
    hasUnexplainedDifference: boolean;
    notice: string;
  };
}

function key(accountId: string, currency: string): string {
  return `${accountId}|${currency}`;
}

function add(map: MoneyMap, accountId: string, currency: string, value: bigint): void {
  const k = key(accountId, currency);
  map.set(k, (map.get(k) ?? 0n) + value);
}

async function collectiveAccounts(
  db: Db,
  companyId: string,
  side: 'receivable' | 'payable',
): Promise<AccountRow[]> {
  const code = side === 'receivable' ? '1100' : '2000';
  const explicit =
    side === 'receivable'
      ? `SELECT receivable_account_id AS id FROM billing_customers WHERE company_id = $1 AND receivable_account_id IS NOT NULL`
      : `SELECT payable_account_id AS id FROM purchase_suppliers WHERE company_id = $1 AND payable_account_id IS NOT NULL`;
  const res = await db.query<any>(
    `SELECT id, code, name, account_role FROM accounts
      WHERE company_id = $1
        AND (id IN (${explicit}) OR code = $2
             OR account_role IN ($3, $4))
      ORDER BY code`,
    [
      companyId,
      code,
      side === 'receivable' ? 'receivable' : 'payable',
      side === 'receivable' ? 'trade_receivable' : 'trade_payable',
    ],
  );
  const rows = res.rows as AccountRow[];
  if (rows.length === 0) {
    throw conflict(
      side === 'receivable' ? 'RECEIVABLE_ACCOUNT_MISSING' : 'PAYABLE_ACCOUNT_MISSING',
      side === 'receivable'
        ? 'No receivable collective account exists in the chart of accounts'
        : 'No payable collective account exists in the chart of accounts',
    );
  }
  return rows;
}

async function glBalances(
  db: Db,
  companyId: string,
  asOf: string,
  accountIds: string[],
  side: 'receivable' | 'payable',
): Promise<MoneyMap> {
  const res = await db.query<any>(
    `SELECT l.account_id, e.currency,
            COALESCE(SUM(l.debit), 0)::text AS debit,
            COALESCE(SUM(l.credit), 0)::text AS credit
       FROM journal_lines l
       JOIN journal_entries e ON e.id = l.entry_id AND e.company_id = $1
      WHERE e.status = 'posted' AND e.entry_date <= $2
        AND l.account_id = ANY($3::uuid[])
      GROUP BY l.account_id, e.currency`,
    [companyId, asOf, accountIds],
  );
  const map: MoneyMap = new Map();
  for (const row of res.rows) {
    // A receivable is a debit balance, a payable a credit balance. Both sides
    // are compared with the same sign as their subledger net amount.
    const signed = side === 'receivable'
      ? parseAmount(row.debit) - parseAmount(row.credit)
      : parseAmount(row.credit) - parseAmount(row.debit);
    add(map, row.account_id, row.currency, signed);
  }
  return map;
}

function buildControl(
  side: 'receivable' | 'payable',
  asOf: string,
  accounts: AccountRow[],
  gl: MoneyMap,
  posted: MoneyMap,
  unposted: MoneyMap,
  documents: Remittance[],
  payments: Remittance[],
): SubledgerControl {
  const keys = new Set<string>([...gl.keys(), ...posted.keys(), ...unposted.keys()]);
  const rows: ReconciliationRow[] = [];
  for (const k of [...keys].sort()) {
    const [accountId, currency] = k.split('|') as [string, string];
    const account = accounts.find((a) => a.id === accountId);
    if (!account) continue;
    const glBalance = gl.get(k) ?? 0n;
    const postedSubledger = posted.get(k) ?? 0n;
    const unpostedNet = unposted.get(k) ?? 0n;
    const subledgerTotal = postedSubledger + unpostedNet;
    const difference = glBalance - subledgerTotal;
    const unexplained = glBalance - postedSubledger;
    const explained = -unpostedNet;
    rows.push({
      accountId,
      accountCode: account.code,
      accountName: account.name,
      currency,
      glBalance: formatAmount(glBalance),
      postedSubledger: formatAmount(postedSubledger),
      unpostedDocuments: formatAmount(unpostedNet),
      subledgerTotal: formatAmount(subledgerTotal),
      difference: formatAmount(difference),
      explainedDifference: formatAmount(explained),
      unexplainedDifference: formatAmount(unexplained),
      status: unexplained !== 0n ? 'unexplained' : unpostedNet !== 0n ? 'explained' : 'reconciled',
    });
  }
  const totals = new Map<string, {
    gl: bigint;
    posted: bigint;
    unposted: bigint;
    total: bigint;
    diff: bigint;
    unexplained: bigint;
  }>();
  for (const row of rows) {
    const current = totals.get(row.currency) ?? {
      gl: 0n,
      posted: 0n,
      unposted: 0n,
      total: 0n,
      diff: 0n,
      unexplained: 0n,
    };
    current.gl += parseAmount(row.glBalance);
    current.posted += parseAmount(row.postedSubledger);
    current.unposted += parseAmount(row.unpostedDocuments);
    current.total += parseAmount(row.subledgerTotal);
    current.diff += parseAmount(row.difference);
    current.unexplained += parseAmount(row.unexplainedDifference);
    totals.set(row.currency, current);
  }
  const hasUnexplained = rows.some((r) => r.status === 'unexplained');
  return {
    side,
    asOf,
    accounts: accounts.map((a) => ({ id: a.id, code: a.code, name: a.name })),
    rows,
    totalsByCurrency: [...totals.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([currency, t]) => ({
        currency,
        glBalance: formatAmount(t.gl),
        postedSubledger: formatAmount(t.posted),
        unpostedDocuments: formatAmount(t.unposted),
        subledgerTotal: formatAmount(t.total),
        difference: formatAmount(t.diff),
        unexplainedDifference: formatAmount(t.unexplained),
      })),
    unpostedDocuments: documents.map((d) => ({
      id: d.id,
      kind: d.kind ?? 'invoice',
      number: d.number,
      partyId: d.partyId,
      partyName: d.partyName,
      date: d.date,
      currency: d.currency,
      amount: formatAmount(parseAmount(d.amount)),
      accountId: d.accountId,
    })),
    unpostedPayments: payments.map((p) => ({
      id: p.id,
      number: p.number,
      partyId: p.partyId,
      partyName: p.partyName,
      date: p.date,
      currency: p.currency,
      amount: formatAmount(-parseAmount(p.amount)),
      accountId: p.accountId,
    })),
    controls: {
      reconciled: rows.every((r) => r.status === 'reconciled'),
      hasUnexplainedDifference: hasUnexplained,
      notice:
        'Aucun écart n’est forcé à zéro. « Expliqué » signifie que l’écart est exactement le net des éléments non comptabilisés listés ; sinon il est « inexpliqué ».',
    },
  };
}

export async function receivableControl(
  db: Db,
  companyId: string,
  asOf: string,
): Promise<SubledgerControl> {
  const accounts = await collectiveAccounts(db, companyId, 'receivable');
  const customers = await db.query<any>(
    `SELECT id, name, receivable_account_id FROM billing_customers WHERE company_id = $1`,
    [companyId],
  );
  const defaultAccount =
    accounts.find((a) => a.code === '1100') ??
    accounts.find((a) => a.account_role === 'receivable') ??
    accounts[0]!;
  const accountByCustomer = new Map<string, string>(
    customers.rows.map((c) => [c.id, c.receivable_account_id ?? defaultAccount.id]),
  );
  const customerName = new Map<string, string>(customers.rows.map((c) => [c.id, c.name]));

  const docs = await db.query<any>(
    `SELECT id, kind, doc_no, customer_id, customer_name, issue_date, currency, total_amount,
            accounting_entry_id
       FROM billing_documents
      WHERE company_id = $1 AND kind IN ('invoice', 'credit_note')
        AND status NOT IN ('draft', 'cancelled') AND issue_date <= $2`,
    [companyId, asOf],
  );
  const payments = await db.query<any>(
    `SELECT p.id, p.payment_no, p.customer_id, p.payment_date, p.currency, p.accounting_entry_id,
            COALESCE(SUM(a.amount), 0)::text AS allocated
       FROM billing_payments p
       LEFT JOIN billing_payment_allocations a
         ON a.payment_id = p.id AND a.cancelled_at IS NULL
      WHERE p.company_id = $1 AND p.status = 'recorded' AND p.payment_date <= $2
      GROUP BY p.id, p.payment_no, p.customer_id, p.payment_date, p.currency, p.accounting_entry_id`,
    [companyId, asOf],
  );

  const posted: MoneyMap = new Map();
  const unposted: MoneyMap = new Map();
  const unpostedDocs: Remittance[] = [];
  for (const row of docs.rows) {
    const accountId = accountByCustomer.get(row.customer_id) ?? defaultAccount.id;
    const signed = row.kind === 'credit_note' ? -parseAmount(row.total_amount) : parseAmount(row.total_amount);
    add(row.accounting_entry_id ? posted : unposted, accountId, row.currency, signed);
    if (!row.accounting_entry_id) {
      unpostedDocs.push({
        id: row.id,
        number: row.doc_no,
        partyId: row.customer_id,
        partyName: customerName.get(row.customer_id) ?? row.customer_name,
        date: row.issue_date,
        currency: row.currency,
        amount: formatAmount(signed),
        accountId,
      });
    }
  }
  const unpostedPayments: Remittance[] = [];
  for (const row of payments.rows) {
    const allocated = parseAmount(row.allocated);
    if (allocated === 0n) continue;
    const accountId = accountByCustomer.get(row.customer_id) ?? defaultAccount.id;
    add(row.accounting_entry_id ? posted : unposted, accountId, row.currency, -allocated);
    if (!row.accounting_entry_id) {
      unpostedPayments.push({
        id: row.id,
        number: row.payment_no,
        partyId: row.customer_id,
        partyName: customerName.get(row.customer_id) ?? '',
        date: row.payment_date,
        currency: row.currency,
        amount: formatAmount(allocated),
        accountId,
      });
    }
  }
  const gl = await glBalances(db, companyId, asOf, accounts.map((a) => a.id), 'receivable');
  return buildControl('receivable', asOf, accounts, gl, posted, unposted, unpostedDocs, unpostedPayments);
}

export async function payableControl(
  db: Db,
  companyId: string,
  asOf: string,
): Promise<SubledgerControl> {
  const accounts = await collectiveAccounts(db, companyId, 'payable');
  const suppliers = await db.query<any>(
    `SELECT id, name, payable_account_id FROM purchase_suppliers WHERE company_id = $1`,
    [companyId],
  );
  const defaultAccount =
    accounts.find((a) => a.code === '2000') ??
    accounts.find((a) => a.account_role === 'payable') ??
    accounts[0]!;
  const accountBySupplier = new Map<string, string>(
    suppliers.rows.map((s) => [s.id, s.payable_account_id ?? defaultAccount.id]),
  );
  const supplierName = new Map<string, string>(suppliers.rows.map((s) => [s.id, s.name]));

  const docs = await db.query<any>(
    `SELECT id, kind, doc_no, supplier_id, supplier_reference, issue_date, currency, total_amount,
            accounting_entry_id
       FROM purchase_documents
      WHERE company_id = $1 AND status = 'validated' AND issue_date <= $2`,
    [companyId, asOf],
  );
  const payments = await db.query<any>(
    `SELECT id, payment_no, supplier_id, payment_date, currency, amount, accounting_entry_id
       FROM purchase_payments
      WHERE company_id = $1 AND status = 'recorded' AND kind = 'payment' AND payment_date <= $2`,
    [companyId, asOf],
  );

  const posted: MoneyMap = new Map();
  const unposted: MoneyMap = new Map();
  const unpostedDocs: Remittance[] = [];
  for (const row of docs.rows) {
    const accountId = accountBySupplier.get(row.supplier_id) ?? defaultAccount.id;
    const signed = row.kind === 'credit_note' ? -parseAmount(row.total_amount) : parseAmount(row.total_amount);
    add(row.accounting_entry_id ? posted : unposted, accountId, row.currency, signed);
    if (!row.accounting_entry_id) {
      unpostedDocs.push({
        id: row.id,
        number: row.doc_no,
        partyId: row.supplier_id,
        partyName: supplierName.get(row.supplier_id) ?? '',
        date: row.issue_date,
        currency: row.currency,
        amount: formatAmount(signed),
        accountId,
      });
    }
  }
  const unpostedPayments: Remittance[] = [];
  for (const row of payments.rows) {
    const accountId = accountBySupplier.get(row.supplier_id) ?? defaultAccount.id;
    add(row.accounting_entry_id ? posted : unposted, accountId, row.currency, -parseAmount(row.amount));
    if (!row.accounting_entry_id) {
      unpostedPayments.push({
        id: row.id,
        number: row.payment_no,
        partyId: row.supplier_id,
        partyName: supplierName.get(row.supplier_id) ?? '',
        date: row.payment_date,
        currency: row.currency,
        amount: row.amount,
        accountId,
      });
    }
  }
  const gl = await glBalances(db, companyId, asOf, accounts.map((a) => a.id), 'payable');
  return buildControl('payable', asOf, accounts, gl, posted, unposted, unpostedDocs, unpostedPayments);
}

export async function subledgerReconciliation(
  db: Db,
  companyId: string,
  asOf: string,
): Promise<{ asOf: string; receivable: SubledgerControl; payable: SubledgerControl }> {
  return {
    asOf,
    receivable: await receivableControl(db, companyId, asOf),
    payable: await payableControl(db, companyId, asOf),
  };
}
