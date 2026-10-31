/**
 * Ledger lettering (mission 12).
 *
 * Three operations are deliberately kept separate:
 *   1. allocating a customer/supplier payment to a commercial document;
 *   2. lettering already-posted journal lines of one third-party account;
 *   3. reconciling a bank transaction with a payment.
 *
 * This service only implements (2). It never edits a journal entry or a line,
 * never creates a settlement, and never posts anything. Amounts stay exact
 * integers scaled by 10^4.
 */
import type { Db } from '../../db/index.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import type { ErrorCode } from '../../lib/errors.js';
import { formatAmount, parseAmount } from '../../lib/money.js';
import { cabinetOfCompany } from '../../lib/cabinets.js';
import { writeAudit } from '../../lib/audit.js';

type Big = bigint;
const money = (raw: unknown): Big => {
  try {
    return parseAmount(raw);
  } catch {
    throw badRequest('VALIDATION_ERROR', 'Invalid amount');
  }
};
const fmt = (value: Big) => formatAmount(value);
const todayIso = () => new Date().toISOString().slice(0, 10);

export interface LetteringAllocationInput {
  lineId: string;
  amount: string;
}

interface LineRow {
  id: string;
  entry_id: string;
  company_id: string;
  line_no: number;
  account_id: string;
  description: string | null;
  debit: string;
  credit: string;
  txn_currency: string;
  entry_no: string;
  entry_date: string;
  entry_reference: string | null;
  entry_description: string;
  entry_currency: string;
  entry_status: 'draft' | 'posted';
  entry_source: string;
  journal_code: string;
  account_code: string;
  account_name: string;
  account_type: string;
  lettered: string;
  document_kind: string | null;
  document_id: string | null;
  document_no: string | null;
  document_status: string | null;
  partner_name: string | null;
  document_total: string | null;
  document_paid: string | null;
  document_credited: string | null;
  source_kind: 'billing' | 'purchase' | null;
}

export interface LetteringLineView {
  id: string;
  entryId: string;
  entryNo: string;
  entryDate: string;
  entryReference: string | null;
  entryDescription: string;
  entryStatus: string;
  journalCode: string;
  accountId: string;
  accountCode: string;
  accountName: string;
  accountType: string;
  description: string | null;
  debit: string;
  credit: string;
  side: 'debit' | 'credit';
  amount: string;
  lettered: string;
  remaining: string;
  currency: string;
  entryCurrency: string;
  documentId: string | null;
  documentKind: string | null;
  documentNo: string | null;
  documentStatus: string | null;
  partnerName: string | null;
  commercialOutstanding: string | null;
}

export interface LetteringPreview {
  valid: boolean;
  accountId: string;
  accountCode: string | null;
  accountName: string | null;
  currency: string;
  sourceCurrency: string | null;
  totalDebit: string;
  totalCredit: string;
  amount: string;
  lines: LetteringLineView[];
  issues: { code: string; fr: string; en: string; blocking: boolean }[];
  warnings: { code: string; fr: string; en: string }[];
}

const BASE_SELECT = `
  SELECT l.id, l.entry_id, l.company_id, l.line_no, l.account_id, l.description,
         l.debit::text, l.credit::text, l.txn_currency,
         e.entry_no, e.entry_date, e.reference AS entry_reference,
         e.description AS entry_description, e.currency AS entry_currency,
         e.status AS entry_status, e.source AS entry_source,
         j.code AS journal_code,
         a.code AS account_code, a.name AS account_name, a.type AS account_type,
         COALESCE((
           SELECT SUM(ll.amount)
             FROM ledger_lettering_lines ll
             JOIN ledger_letterings lg ON lg.id = ll.lettering_id AND lg.status = 'active'
            WHERE ll.journal_line_id = l.id
         ), 0)::text AS lettered,
         COALESCE(bd.kind, pd.kind, 'payment') AS document_kind,
         COALESCE(bd.id, pd.id, bp.id, pp.id) AS document_id,
         COALESCE(bd.doc_no, pd.doc_no, bp.payment_no, pp.payment_no) AS document_no,
         COALESCE(bd.status, pd.status, bp.status, pp.status) AS document_status,
         COALESCE(bdc.name, pds.name) AS partner_name,
         COALESCE(bd.total_amount, pd.total_amount)::text AS document_total,
         COALESCE(bd.amount_paid, pd.amount_paid)::text AS document_paid,
         COALESCE(bd.credited_amount, pd.credited_amount)::text AS document_credited,
         CASE WHEN pd.id IS NOT NULL OR pp.id IS NOT NULL THEN 'purchase' ELSE 'billing' END AS source_kind
    FROM journal_lines l
    JOIN journal_entries e ON e.id = l.entry_id AND e.company_id = l.company_id
    JOIN journals j ON j.id = e.journal_id AND j.company_id = e.company_id
    JOIN accounts a ON a.id = l.account_id AND a.company_id = l.company_id
    LEFT JOIN billing_documents bd ON bd.accounting_entry_id = e.id AND bd.company_id = e.company_id
    LEFT JOIN billing_customers bdc ON bdc.id = bd.customer_id AND bdc.company_id = bd.company_id
    LEFT JOIN billing_payments bp ON bp.accounting_entry_id = e.id AND bp.company_id = e.company_id
    LEFT JOIN purchase_documents pd ON pd.accounting_entry_id = e.id AND pd.company_id = e.company_id
    LEFT JOIN purchase_suppliers pds ON pds.id = pd.supplier_id AND pds.company_id = pd.company_id
    LEFT JOIN purchase_payments pp ON pp.accounting_entry_id = e.id AND pp.company_id = e.company_id
`;

async function loadLockedLines(tx: Db, companyId: string, lineIds: string[]): Promise<LineRow[]> {
  const unique = [...new Set(lineIds)].sort();
  const locked = await tx.query<{ id: string }>(
    'SELECT id FROM journal_lines WHERE company_id = $1 AND id = ANY($2::uuid[]) ORDER BY id FOR UPDATE',
    [companyId, unique],
  );
  if (locked.rowCount !== unique.length) {
    throw notFound('LETTERING_LINE_NOT_FOUND', 'One or more journal lines were not found');
  }
  const res = await tx.query<LineRow>(`${BASE_SELECT} WHERE l.company_id = $1 AND l.id = ANY($2::uuid[])`, [
    companyId,
    unique,
  ]);
  return res.rows;
}

async function loadLines(tx: Db, companyId: string, lineIds: string[]): Promise<LineRow[]> {
  const unique = [...new Set(lineIds)];
  const res = await tx.query<LineRow>(`${BASE_SELECT} WHERE l.company_id = $1 AND l.id = ANY($2::uuid[])`, [
    companyId,
    unique,
  ]);
  return res.rows;
}

function lineView(row: LineRow): LetteringLineView {
  const amount = money(row.debit) > 0n ? money(row.debit) : money(row.credit);
  const lettered = money(row.lettered);
  const remaining = amount - lettered;
  const commercial =
    row.document_total !== null
      ? money(row.document_total) - money(row.document_paid) - money(row.document_credited)
      : null;
  return {
    id: row.id,
    entryId: row.entry_id,
    entryNo: row.entry_no,
    entryDate: row.entry_date,
    entryReference: row.entry_reference,
    entryDescription: row.entry_description,
    entryStatus: row.entry_status,
    journalCode: row.journal_code,
    accountId: row.account_id,
    accountCode: row.account_code,
    accountName: row.account_name,
    accountType: row.account_type,
    description: row.description,
    debit: row.debit,
    credit: row.credit,
    side: money(row.debit) > 0n ? 'debit' : 'credit',
    amount: fmt(amount),
    lettered: fmt(lettered > 0n ? lettered : 0n),
    remaining: fmt(remaining > 0n ? remaining : 0n),
    currency: row.entry_currency,
    entryCurrency: row.entry_currency,
    documentId: row.document_id,
    documentKind: row.document_kind,
    documentNo: row.document_no,
    documentStatus: row.document_status,
    partnerName: row.partner_name,
    commercialOutstanding: commercial === null ? null : fmt(commercial > 0n ? commercial : 0n),
  };
}

const LETTRABLE_SQL = `
  a.company_id = $1 AND a.is_active
  AND a.type IN ('asset', 'liability')
  AND (
    a.code IN ('1100', '2000')
    OR EXISTS (
      SELECT 1 FROM purchase_suppliers s
       WHERE s.company_id = a.company_id AND s.payable_account_id = a.id
    )
    OR EXISTS (
      SELECT 1 FROM billing_settings bs
       WHERE bs.company_id = a.company_id AND bs.default_receivable_account_id = a.id
    )
  )
`;

export async function listLettrableAccounts(db: Db, companyId: string) {
  const res = await db.query<any>(
    `SELECT a.id, a.code, a.name, a.type, a.currency, a.is_active
       FROM accounts a
      WHERE ${LETTRABLE_SQL}
      ORDER BY a.code`,
    [companyId],
  );
  if (res.rows.length === 0) return [];
  const ids = res.rows.map((row) => row.id);
  const balances = await db.query<{
    account_id: string;
    currency: string;
    amount: string;
    line_count: string;
  }>(
    `SELECT l.account_id, e.currency,
            COALESCE(SUM(GREATEST(
              CASE WHEN l.debit > 0 THEN l.debit ELSE l.credit END
              - COALESCE((
                  SELECT SUM(ll.amount)
                    FROM ledger_lettering_lines ll
                    JOIN ledger_letterings lg ON lg.id = ll.lettering_id AND lg.status = 'active'
                   WHERE ll.journal_line_id = l.id
                ), 0), 0)), 0)::text AS amount,
            count(*)::text AS line_count
       FROM journal_lines l
       JOIN journal_entries e ON e.id = l.entry_id AND e.company_id = l.company_id
      WHERE l.company_id = $1 AND e.status = 'posted' AND l.account_id = ANY($2::uuid[])
      GROUP BY l.account_id, e.currency
      ORDER BY e.currency`,
    [companyId, ids],
  );
  const byAccount = new Map<string, { currency: string; amount: string; lines: string }[]>();
  for (const row of balances.rows) {
    const list = byAccount.get(row.account_id) ?? [];
    list.push({ currency: row.currency, amount: row.amount, lines: row.line_count });
    byAccount.set(row.account_id, list);
  }
  return res.rows.map((row) => {
    const currencies = byAccount.get(row.id) ?? [];
    const single = currencies.length === 1 ? currencies[0]! : null;
    return {
      ...row,
      // Never add different currencies: expose a breakdown and only provide a
      // scalar total when a single currency is present.
      unlettered_by_currency: currencies,
      unlettered: single ? single.amount : currencies.length === 0 ? '0.0000' : null,
      line_count: String(currencies.reduce((sum, item) => sum + Number(item.lines), 0)),
      display_currency: single ? single.currency : currencies.length === 0 ? row.currency : null,
      multiple_currencies: currencies.length > 1,
    };
  });
}

export async function listLetteringLines(
  db: Db,
  companyId: string,
  filters: {
    accountId?: string;
    search?: string;
    currency?: string;
    from?: string;
    to?: string;
    status?: 'unlettered' | 'partial' | 'lettered' | 'all';
    includeUnposted?: boolean;
    limit?: number;
  },
): Promise<{ lines: LetteringLineView[]; pending: LetteringLineView[]; accounts: any[] }> {
  const accounts = await listLettrableAccounts(db, companyId);
  if (!filters.accountId) {
    return { lines: [], pending: [], accounts };
  }
  const allowed = accounts.some((a) => a.id === filters.accountId);
  if (!allowed) throw badRequest('LETTERING_ACCOUNT_NOT_ALLOWED', 'This account is not a letterable third-party account');

  const clauses = ['l.company_id = $1', 'l.account_id = $2'];
  const params: unknown[] = [companyId, filters.accountId];
  if (filters.status !== 'all') clauses.push(`e.status = 'posted'`);
  if (filters.currency) {
    params.push(filters.currency.toUpperCase());
    clauses.push(`e.currency = $${params.length}`);
  }
  if (filters.from) {
    params.push(filters.from);
    clauses.push(`e.entry_date >= $${params.length}`);
  }
  if (filters.to) {
    params.push(filters.to);
    clauses.push(`e.entry_date <= $${params.length}`);
  }
  if (filters.search?.trim()) {
    params.push(`%${filters.search.trim()}%`);
    clauses.push(
      `(e.entry_no ILIKE $${params.length} OR e.reference ILIKE $${params.length}
        OR e.description ILIKE $${params.length} OR l.description ILIKE $${params.length}
        OR COALESCE(bd.doc_no, pd.doc_no, bp.payment_no, pp.payment_no) ILIKE $${params.length}
        OR COALESCE(bdc.name, pds.name) ILIKE $${params.length})`,
    );
  }
  params.push(Math.min(Math.max(filters.limit ?? 200, 1), 500));
  const res = await db.query<LineRow>(
    `${BASE_SELECT} WHERE ${clauses.join(' AND ')} ORDER BY e.entry_date, e.entry_no, l.line_no LIMIT $${params.length}`,
    params,
  );
  const all = res.rows.map(lineView);
  const visible = all.filter((line) => {
    if (filters.status === 'unlettered') return money(line.remaining) > 0n;
    if (filters.status === 'lettered') return money(line.remaining) === 0n;
    if (filters.status === 'partial') return money(line.lettered) > 0n && money(line.remaining) > 0n;
    return true;
  });
  const pending = filters.includeUnposted
    ? all.filter((line) => line.entryStatus !== 'posted')
    : [];
  return {
    lines: visible,
    pending,
    accounts,
  };
}

function closedPeriod(db: Db, companyId: string, date: string): Promise<boolean> {
  return db
    .query<{ id: string }>(
      `SELECT id FROM accounting_periods
        WHERE company_id = $1 AND status = 'closed' AND start_date <= $2 AND end_date >= $2
        LIMIT 1`,
      [companyId, date],
    )
    .then((res) => res.rowCount > 0);
}

async function validateAllocations(
  db: Db,
  companyId: string,
  accountId: string,
  allocations: LetteringAllocationInput[],
  lock: boolean,
): Promise<{ preview: LetteringPreview; rows: Map<string, LineRow> }> {
  const issues: LetteringPreview['issues'] = [];
  const warnings: LetteringPreview['warnings'] = [];
  if (allocations.length < 2) {
    issues.push({
      code: 'LETTERING_TWO_LINES_REQUIRED',
      fr: 'Un lettrage exige au moins une ligne au débit et une au crédit.',
      en: 'A lettering requires at least one debit and one credit line.',
      blocking: true,
    });
  }
  if (new Set(allocations.map((a) => a.lineId)).size !== allocations.length) {
    issues.push({
      code: 'LETTERING_DUPLICATE_LINE',
      fr: 'Une ligne ne peut apparaître qu’une seule fois dans un lettrage.',
      en: 'A line can appear only once in one lettering.',
      blocking: true,
    });
  }
  const rows = lock
    ? await loadLockedLines(
        db,
        companyId,
        allocations.map((a) => a.lineId),
      )
    : await loadLines(
        db,
        companyId,
        allocations.map((a) => a.lineId),
      );
  const byId = new Map(rows.map((r) => [r.id, r]));
  const account = await db.query<any>(
    `SELECT a.id, a.code, a.name FROM accounts a
      WHERE a.id = $1 AND a.company_id = $2 AND a.is_active
        AND a.type IN ('asset', 'liability')
        AND (
          a.code IN ('1100', '2000')
          OR EXISTS (
            SELECT 1 FROM purchase_suppliers s
             WHERE s.company_id = a.company_id AND s.payable_account_id = a.id
          )
          OR EXISTS (
            SELECT 1 FROM billing_settings bs
             WHERE bs.company_id = a.company_id AND bs.default_receivable_account_id = a.id
          )
        )`,
    [accountId, companyId],
  );
  if (!account.rows[0]) {
    issues.push({
      code: 'LETTERING_ACCOUNT_NOT_ALLOWED',
      fr: 'Ce compte n’est pas un compte de tiers lettrable.',
      en: 'This is not a letterable third-party account.',
      blocking: true,
    });
  }
  let debit = 0n;
  let credit = 0n;
  let sourceCurrency: string | null = null;
  const seenEntries = new Set<string>();
  for (const allocation of allocations) {
    const row = byId.get(allocation.lineId);
    if (!row) {
      issues.push({
        code: 'LETTERING_LINE_NOT_FOUND',
        fr: 'Une ligne comptable est introuvable dans cette société.',
        en: 'A journal line was not found in this company.',
        blocking: true,
      });
      continue;
    }
    if (row.account_id !== accountId) {
      issues.push({
        code: 'LETTERING_ACCOUNT_MISMATCH',
        fr: 'Toutes les lignes doivent appartenir au même compte tiers.',
        en: 'All lines must belong to the same third-party account.',
        blocking: true,
      });
    }
    if (row.entry_status !== 'posted') {
      issues.push({
        code: 'LETTERING_ENTRY_NOT_POSTED',
        fr: `Écriture ${row.entry_no} non comptabilisée : aucun lettrage artificiel n’est créé.`,
        en: `Entry ${row.entry_no} is not posted: no artificial lettering is created.`,
        blocking: true,
      });
    }
    const value = money(allocation.amount);
    if (value <= 0n) {
      issues.push({
        code: 'LETTERING_AMOUNT_INVALID',
        fr: 'Chaque montant lettré doit être strictement positif.',
        en: 'Every lettered amount must be positive.',
        blocking: true,
      });
    }
    const sideAmount = money(row.debit) > 0n ? money(row.debit) : money(row.credit);
    const available = sideAmount - money(row.lettered);
    if (value > available) {
      issues.push({
        code: 'LETTERING_EXCEEDS_AVAILABLE',
        fr: `Montant supérieur au restant lettrable de la ligne ${row.entry_no} : ${fmt(available > 0n ? available : 0n)}.`,
        en: `Amount exceeds the remaining letterable amount of line ${row.entry_no}: ${fmt(available > 0n ? available : 0n)}.`,
        blocking: true,
      });
    }
    if (money(row.debit) > 0n) debit += value;
    else credit += value;
    if (sourceCurrency === null) sourceCurrency = row.entry_currency;
    else if (sourceCurrency !== row.entry_currency) {
      issues.push({
        code: 'LETTERING_CURRENCY_MISMATCH',
        fr: 'Les écritures sélectionnées n’ont pas la même devise d’origine ; aucun change n’est inventé.',
        en: 'Selected entries do not share the same source currency; no exchange rate is invented.',
        blocking: true,
      });
    }
    seenEntries.add(row.entry_id);
  }
  if (debit !== credit || debit <= 0n) {
    issues.push({
      code: 'LETTERING_UNBALANCED',
      fr: `Lettrage déséquilibré : débit ${fmt(debit)}, crédit ${fmt(credit)}.`,
      en: `Unbalanced lettering: debit ${fmt(debit)}, credit ${fmt(credit)}.`,
      blocking: true,
    });
  }
  for (const entryId of seenEntries) {
    const row = rows.find((r) => r.entry_id === entryId);
    if (row && (await closedPeriod(db, companyId, row.entry_date))) {
      issues.push({
        code: 'LETTERING_PERIOD_CLOSED',
        fr: `La période de l’écriture ${row.entry_no} est clôturée.`,
        en: `The period of entry ${row.entry_no} is closed.`,
        blocking: true,
      });
    }
  }
  const hasDebit = allocations.some((a) => {
    const row = byId.get(a.lineId);
    return row ? money(row.debit) > 0n : false;
  });
  const hasCredit = allocations.some((a) => {
    const row = byId.get(a.lineId);
    return row ? money(row.credit) > 0n : false;
  });
  if (allocations.length >= 2 && (!hasDebit || !hasCredit)) {
    issues.push({
      code: 'LETTERING_TWO_SIDES_REQUIRED',
      fr: 'Il faut au moins une ligne au débit et une au crédit.',
      en: 'At least one debit line and one credit line are required.',
      blocking: true,
    });
  }
  if (allocations.length >= 2 && rows.some((r) => !r.document_id)) {
    warnings.push({
      code: 'LETTERING_WITHOUT_DOCUMENT',
      fr: 'Certaines lignes ne sont liées à aucune facture ou règlement : le lettrage reste comptable.',
      en: 'Some lines are not linked to an invoice or payment: lettering stays purely accounting.',
    });
  }
  const currency = await db
    .query<{ functional_currency: string }>('SELECT functional_currency FROM companies WHERE id = $1', [companyId])
    .then((r) => r.rows[0]?.functional_currency ?? 'MUR');
  return {
    rows: byId,
    preview: {
      valid: issues.every((i) => !i.blocking),
      accountId,
      accountCode: account.rows[0]?.code ?? null,
      accountName: account.rows[0]?.name ?? null,
      currency,
      sourceCurrency,
      totalDebit: fmt(debit),
      totalCredit: fmt(credit),
      amount: fmt(debit < credit ? debit : credit),
      lines: allocations.flatMap((a) => {
        const row = byId.get(a.lineId);
        return row ? [{ ...lineView(row), remaining: fmt(money(a.amount)) }] : [];
      }),
      issues,
      warnings,
    },
  };
}

export async function previewLettering(
  db: Db,
  companyId: string,
  accountId: string,
  allocations: LetteringAllocationInput[],
): Promise<LetteringPreview> {
  return (await validateAllocations(db, companyId, accountId, allocations, false)).preview;
}

async function nextCode(tx: Db, companyId: string): Promise<string> {
  const year = Number(todayIso().slice(0, 4));
  const res = await tx.query<{ last_no: number }>(
    `INSERT INTO ledger_lettering_sequences (company_id, year, last_no)
     VALUES ($1, $2, 1)
     ON CONFLICT (company_id, year)
     DO UPDATE SET last_no = ledger_lettering_sequences.last_no + 1
     RETURNING last_no`,
    [companyId, year],
  );
  return `LET-${year}-${String(res.rows[0]!.last_no).padStart(4, '0')}`;
}

export interface LetteringRow {
  id: string;
  cabinet_id: string;
  company_id: string;
  account_id: string;
  code: string;
  status: 'active' | 'reversed';
  method: 'manual' | 'suggested';
  currency: string;
  source_currency: string;
  amount: string;
  total_debit: string;
  total_credit: string;
  rationale: string | null;
  request_key: string | null;
  created_by: string | null;
  created_at: string;
  reversed_by: string | null;
  reversed_at: string | null;
  reversal_reason: string | null;
}

async function letteringView(db: Db, companyId: string, id: string) {
  const res = await db.query<any>(
    `SELECT lg.*, a.code AS account_code, a.name AS account_name,
            u.full_name AS created_by_name, ru.full_name AS reversed_by_name
       FROM ledger_letterings lg
       JOIN accounts a ON a.id = lg.account_id AND a.company_id = lg.company_id
       LEFT JOIN app_users u ON u.id = lg.created_by
       LEFT JOIN app_users ru ON ru.id = lg.reversed_by
      WHERE lg.id = $1 AND lg.company_id = $2`,
    [id, companyId],
  );
  const group = res.rows[0];
  if (!group) throw notFound('LETTERING_NOT_FOUND', 'Lettering group not found');
  const linesRes = await db.query<any>(
    `${BASE_SELECT}
      JOIN ledger_lettering_lines x ON x.journal_line_id = l.id
     WHERE x.lettering_id = $1 AND l.company_id = $2
     ORDER BY e.entry_date, e.entry_no, l.line_no`,
    [id, companyId],
  );
  const allocations = await db.query<any>(
    `SELECT ll.*, e.entry_no, e.entry_date, e.reference AS entry_reference,
            a.code AS account_code, a.name AS account_name
       FROM ledger_lettering_lines ll
       JOIN journal_entries e ON e.id = ll.entry_id
       JOIN accounts a ON a.id = ll.account_id
      WHERE ll.lettering_id = $1
      ORDER BY e.entry_date, e.entry_no`,
    [id],
  );
  const events = await db.query<any>(
    `SELECT ev.*, u.full_name AS actor_name
       FROM ledger_lettering_events ev
       LEFT JOIN app_users u ON u.id = ev.actor_id
      WHERE ev.lettering_id = $1 ORDER BY ev.created_at, ev.id`,
    [id],
  );
  return {
    ...group,
    amount: fmt(money(group.amount)),
    total_debit: fmt(money(group.total_debit)),
    total_credit: fmt(money(group.total_credit)),
    lines: linesRes.rows.map((row) => {
      const view = lineView(row);
      const allocation = allocations.rows.find((a) => a.journal_line_id === row.id);
      return { ...view, allocatedAmount: allocation ? fmt(money(allocation.amount)) : view.remaining };
    }),
    events: events.rows,
    documents: [
      ...new Map(
        linesRes.rows
          .filter((r) => r.document_id)
          .map((r) => [
            r.document_id,
            {
              id: r.document_id,
              kind: r.document_kind,
              number: r.document_no,
              status: r.document_status,
              partnerName: r.partner_name,
              source: r.source_kind,
            },
          ]),
      ).values(),
    ],
  };
}

export async function createLettering(
  db: Db,
  params: {
    companyId: string;
    userId: string;
    accountId: string;
    allocations: LetteringAllocationInput[];
    rationale?: string | null;
    method?: 'manual' | 'suggested';
    idempotencyKey?: string | null;
    ip?: string | null;
  },
) {
  const cabinetId = await cabinetOfCompany(db, params.companyId);
  if (!cabinetId) throw badRequest('CABINET_NOT_FOUND', 'This company is not attached to a cabinet');
  const requestKey = params.idempotencyKey?.trim() || null;
  if (requestKey && requestKey.length > 120) throw badRequest('VALIDATION_ERROR', 'Idempotency key too long');

  let result: { id: string; idempotent: boolean };
  try {
    result = await db.transaction(async (tx) => {
    if (requestKey) {
      const existing = await tx.query<{ id: string }>(
        `SELECT id FROM ledger_letterings
          WHERE company_id = $1 AND request_key = $2`,
        [params.companyId, requestKey],
      );
      if (existing.rows[0]) {
        return { id: existing.rows[0].id, idempotent: true };
      }
    }
    const { preview } = await validateAllocations(
      tx,
      params.companyId,
      params.accountId,
      params.allocations,
      true,
    );
    if (!preview.valid) {
      const blocking = preview.issues.filter((i) => i.blocking);
      throw conflict(
        (blocking[0]?.code as ErrorCode) ?? 'LETTERING_INVALID',
        blocking[0]?.en ?? 'The lettering is invalid',
        { issues: blocking },
      );
    }
    const code = await nextCode(tx, params.companyId);
    const inserted = await tx.query<LetteringRow>(
      `INSERT INTO ledger_letterings
         (cabinet_id, company_id, account_id, code, status, method, currency,
          source_currency, amount, total_debit, total_credit, rationale,
          request_key, created_by)
       VALUES ($1,$2,$3,$4,'active',$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING *`,
      [
        cabinetId,
        params.companyId,
        params.accountId,
        code,
        params.method ?? 'manual',
        preview.currency,
        preview.sourceCurrency ?? preview.currency,
        preview.amount,
        preview.totalDebit,
        preview.totalCredit,
        params.rationale?.trim() || null,
        requestKey,
        params.userId,
      ],
    );
    const group = inserted.rows[0]!;
    for (const allocation of params.allocations) {
      const row = await tx.query<LineRow>(
        `${BASE_SELECT} WHERE l.id = $1 AND l.company_id = $2`,
        [allocation.lineId, params.companyId],
      );
      const line = row.rows[0]!;
      await tx.query(
        `INSERT INTO ledger_lettering_lines
           (lettering_id, cabinet_id, company_id, journal_line_id, entry_id,
            account_id, side, amount)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          group.id,
          cabinetId,
          params.companyId,
          line.id,
          line.entry_id,
          line.account_id,
          money(line.debit) > 0n ? 'debit' : 'credit',
          fmt(money(allocation.amount)),
        ],
      );
    }
    await tx.query(
      `INSERT INTO ledger_lettering_events
         (cabinet_id, company_id, lettering_id, action, actor_id, details)
       VALUES ($1,$2,$3,'created',$4,$5::jsonb)`,
      [
        cabinetId,
        params.companyId,
        group.id,
        params.userId,
        JSON.stringify({
          allocations: params.allocations.length,
          amount: preview.amount,
          currency: preview.currency,
          sourceCurrency: preview.sourceCurrency,
          method: params.method ?? 'manual',
        }),
      ],
    );
    return { id: group.id, idempotent: false };
    });
  } catch (err) {
    // Two concurrent retries with the same idempotency key can both pass the
    // preliminary SELECT; the unique index rejects one of them. Return the
    // winning group instead of surfacing a raw 500.
    if (requestKey) {
      const existing = await db.query<{ id: string }>(
        `SELECT id FROM ledger_letterings WHERE company_id = $1 AND request_key = $2`,
        [params.companyId, requestKey],
      );
      if (existing.rows[0]) return {
        lettering: await letteringView(db, params.companyId, existing.rows[0].id),
        idempotent: true,
      };
    }
    throw err;
  }

  await writeAudit(db, {
    companyId: params.companyId,
    userId: params.userId,
    action: result.idempotent ? 'lettering.create.idempotent' : 'lettering.create',
    entityType: 'ledger_lettering',
    entityId: result.id,
    details: { accountId: params.accountId, allocations: params.allocations, idempotencyKey: requestKey },
    ip: params.ip ?? null,
  });
  return {
    lettering: await letteringView(db, params.companyId, result.id),
    idempotent: result.idempotent,
  };
}

export async function reverseLettering(
  db: Db,
  params: {
    companyId: string;
    userId: string;
    letteringId: string;
    reason: string;
    ip?: string | null;
  },
) {
  const reason = params.reason?.trim();
  if (!reason) throw badRequest('LETTERING_REASON_REQUIRED', 'A reversal reason is required');
  const cabinetId = await cabinetOfCompany(db, params.companyId);
  if (!cabinetId) throw badRequest('CABINET_NOT_FOUND', 'This company is not attached to a cabinet');
  await db.transaction(async (tx) => {
    const found = await tx.query<LetteringRow>(
      `SELECT * FROM ledger_letterings
        WHERE id = $1 AND company_id = $2 AND cabinet_id = $3 FOR UPDATE`,
      [params.letteringId, params.companyId, cabinetId],
    );
    const group = found.rows[0];
    if (!group) throw notFound('LETTERING_NOT_FOUND', 'Lettering group not found');
    if (group.status === 'reversed') {
      throw conflict('LETTERING_ALREADY_REVERSED', 'This lettering is already reversed');
    }
    const dates = await tx.query<{ entry_no: string; entry_date: string }>(
      `SELECT DISTINCT e.entry_no, e.entry_date
         FROM ledger_lettering_lines ll
         JOIN journal_entries e ON e.id = ll.entry_id
        WHERE ll.lettering_id = $1`,
      [group.id],
    );
    for (const row of dates.rows) {
      if (await closedPeriod(tx, params.companyId, row.entry_date)) {
        throw conflict(
          'LETTERING_PERIOD_CLOSED',
          `Cannot reverse: the period of entry ${row.entry_no} is closed`,
          { entryNo: row.entry_no, entryDate: row.entry_date },
        );
      }
    }
    await tx.query(
      `UPDATE ledger_letterings
          SET status = 'reversed', reversed_by = $2, reversed_at = now(), reversal_reason = $3
        WHERE id = $1`,
      [group.id, params.userId, reason],
    );
    await tx.query(
      `INSERT INTO ledger_lettering_events
         (cabinet_id, company_id, lettering_id, action, actor_id, reason, details)
       VALUES ($1,$2,$3,'reversed',$4,$5,$6::jsonb)`,
      [
        cabinetId,
        params.companyId,
        group.id,
        params.userId,
        reason,
        JSON.stringify({ amount: group.amount, code: group.code, allocatorLines: dates.rowCount }),
      ],
    );
  });
  await writeAudit(db, {
    companyId: params.companyId,
    userId: params.userId,
    action: 'lettering.reverse',
    entityType: 'ledger_lettering',
    entityId: params.letteringId,
    details: { reason },
    ip: params.ip ?? null,
  });
  return { lettering: await letteringView(db, params.companyId, params.letteringId), reversed: true };
}

export async function listLetterings(
  db: Db,
  companyId: string,
  filters: {
    accountId?: string;
    status?: 'active' | 'reversed' | 'all';
    from?: string;
    to?: string;
    search?: string;
    limit?: number;
  } = {},
) {
  const clauses = ['lg.company_id = $1'];
  const params: unknown[] = [companyId];
  if (filters.accountId) {
    params.push(filters.accountId);
    clauses.push(`lg.account_id = $${params.length}`);
  }
  if (filters.status && filters.status !== 'all') {
    params.push(filters.status);
    clauses.push(`lg.status = $${params.length}`);
  }
  if (filters.from) {
    params.push(filters.from);
    clauses.push(`lg.created_at::date >= $${params.length}`);
  }
  if (filters.to) {
    params.push(filters.to);
    clauses.push(`lg.created_at::date <= $${params.length}`);
  }
  if (filters.search?.trim()) {
    params.push(`%${filters.search.trim()}%`);
    clauses.push(
      `(lg.code ILIKE $${params.length} OR lg.rationale ILIKE $${params.length}
        OR a.code ILIKE $${params.length} OR a.name ILIKE $${params.length})`,
    );
  }
  params.push(Math.min(Math.max(filters.limit ?? 100, 1), 500));
  const res = await db.query<any>(
    `SELECT lg.*, a.code AS account_code, a.name AS account_name,
            (SELECT count(*)::text FROM ledger_lettering_lines ll WHERE ll.lettering_id = lg.id) AS line_count
       FROM ledger_letterings lg
       JOIN accounts a ON a.id = lg.account_id
      WHERE ${clauses.join(' AND ')}
      ORDER BY lg.created_at DESC, lg.code DESC
      LIMIT $${params.length}`,
    params,
  );
  return res.rows.map((row) => ({
    ...row,
    amount: fmt(money(row.amount)),
    total_debit: fmt(money(row.total_debit)),
    total_credit: fmt(money(row.total_credit)),
  }
  ));
}

export async function getLettering(db: Db, companyId: string, id: string) {
  return letteringView(db, companyId, id);
}

export async function getLetteringHistory(db: Db, companyId: string, letteringId?: string) {
  const params: unknown[] = [companyId];
  const clause = letteringId ? 'AND ev.lettering_id = $2' : '';
  if (letteringId) params.push(letteringId);
  const res = await db.query<any>(
    `SELECT ev.*, lg.code, a.code AS account_code, a.name AS account_name,
            u.full_name AS actor_name
       FROM ledger_lettering_events ev
       JOIN ledger_letterings lg ON lg.id = ev.lettering_id
       JOIN accounts a ON a.id = lg.account_id
       LEFT JOIN app_users u ON u.id = ev.actor_id
      WHERE ev.company_id = $1 ${clause}
      ORDER BY ev.created_at DESC LIMIT 500`,
    params,
  );
  return res.rows;
}

function normaliseRef(value: string | null | undefined): string {
  return (value ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

function referenceAffinity(a: LetteringLineView, b: LetteringLineView): number {
  const ra = normaliseRef(a.entryReference ?? a.documentNo);
  const rb = normaliseRef(b.entryReference ?? b.documentNo);
  if (!ra || !rb) return 0;
  if (ra === rb) return 1;
  if (ra.includes(rb) || rb.includes(ra)) return 0.85;
  const tokens = new Set(ra.split(' ').filter((t) => t.length >= 4));
  return rb.split(' ').some((t) => t.length >= 4 && tokens.has(t)) ? 0.65 : 0;
}

function dayDiff(a: string, b: string): number {
  return Math.abs(Math.round((Date.parse(a) - Date.parse(b)) / 86_400_000));
}

export interface LetteringSuggestion {
  accountId: string;
  accountCode: string;
  accountName: string;
  currency: string;
  amount: string;
  confidence: number;
  rationale: { code: string; fr: string; en: string }[];
  ambiguities: { code: string; fr: string; en: string }[];
  debitLine: LetteringLineView;
  creditLine: LetteringLineView;
  suggestedLines: LetteringAllocationInput[];
}

export async function suggestLetterings(
  db: Db,
  companyId: string,
  accountId?: string,
  limit = 20,
): Promise<{ suggestions: LetteringSuggestion[]; method: 'deterministic'; autoValidated: false }> {
  const accounts = await listLettrableAccounts(db, companyId);
  const targetAccounts = accountId ? accounts.filter((a) => a.id === accountId) : accounts;
  if (accountId && targetAccounts.length === 0) {
    throw badRequest('LETTERING_ACCOUNT_NOT_ALLOWED', 'This account is not a letterable third-party account');
  }
  const suggestions: LetteringSuggestion[] = [];
  for (const account of targetAccounts) {
    const res = await db.query<LineRow>(
      `${BASE_SELECT}
        WHERE l.company_id = $1 AND l.account_id = $2 AND e.status = 'posted'
        ORDER BY e.entry_date, e.entry_no, l.line_no
        LIMIT 1000`,
      [companyId, account.id],
    );
    const open = res.rows
      .map(lineView)
      .filter((line) => money(line.remaining) > 0n);
    const debits = open.filter((l) => l.side === 'debit');
    const credits = open.filter((l) => l.side === 'credit');
    for (const debit of debits) {
      for (const credit of credits) {
        if (debit.entryId === credit.entryId) continue;
        if (debit.currency !== credit.currency) continue;
        const available = money(debit.remaining) < money(credit.remaining) ? money(debit.remaining) : money(credit.remaining);
        if (available <= 0n) continue;
        const affinity = referenceAffinity(debit, credit);
        const exact = money(debit.remaining) === money(credit.remaining);
        const gap = dayDiff(debit.entryDate, credit.entryDate);
        if (!exact && affinity === 0 && gap > 45) continue;
        let confidence = 0.35;
        const rationale: LetteringSuggestion['rationale'] = [
          {
            code: 'SAME_THIRD_PARTY_ACCOUNT',
            fr: `Même compte tiers ${account.code} — ${account.name}.`,
            en: `Same third-party account ${account.code} — ${account.name}.`,
          },
          {
            code: 'SAME_SOURCE_CURRENCY',
            fr: `Même devise d’origine (${debit.currency}).`,
            en: `Same source currency (${debit.currency}).`,
          },
        ];
        if (exact) {
          confidence += 0.25;
          rationale.push({
            code: 'EXACT_AMOUNT',
            fr: 'Montants restants strictement égaux.',
            en: 'Remaining amounts are exactly equal.',
          });
        }
        if (affinity > 0) {
          confidence += 0.2 * affinity;
          rationale.push({
            code: 'REFERENCE_MATCH',
            fr: 'Références ou libellés se correspondent.',
            en: 'References or descriptions match.',
          });
        }
        if (gap <= 15) {
          confidence += 0.1;
          rationale.push({ code: 'CLOSE_DATE', fr: 'Dates proches.', en: 'Dates are close.' });
        }
        if (debit.partnerName && credit.partnerName && debit.partnerName === credit.partnerName) {
          confidence += 0.1;
          rationale.push({ code: 'SAME_PARTNER', fr: 'Même tiers identifié.', en: 'Same identified partner.' });
        }
        const ambiguities: LetteringSuggestion['ambiguities'] = [];
        const sameAmountDebits = open.filter(
          (l) => l.id !== debit.id && l.side === 'debit' && l.remaining === debit.remaining,
        );
        const sameAmountCredits = open.filter(
          (l) => l.id !== credit.id && l.side === 'credit' && l.remaining === credit.remaining,
        );
        if (sameAmountDebits.length > 0) {
          ambiguities.push({
            code: 'AMBIGUOUS_DEBIT',
            fr: `${sameAmountDebits.length} autre(s) ligne(s) au débit ont le même restant.`,
            en: `${sameAmountDebits.length} other debit line(s) have the same remaining amount.`,
          });
        }
        if (sameAmountCredits.length > 0) {
          ambiguities.push({
            code: 'AMBIGUOUS_CREDIT',
            fr: `${sameAmountCredits.length} autre(s) ligne(s) au crédit ont le même restant.`,
            en: `${sameAmountCredits.length} other credit line(s) have the same remaining amount.`,
          });
        }
        if (ambiguities.length > 0) confidence = Math.min(confidence, 0.7);
        suggestions.push({
          accountId: account.id,
          accountCode: account.code,
          accountName: account.name,
          currency: debit.currency,
          amount: fmt(available),
          confidence: Math.min(0.99, Math.max(0.2, confidence)),
          rationale,
          ambiguities,
          debitLine: debit,
          creditLine: credit,
          suggestedLines: [
            { lineId: debit.id, amount: fmt(available) },
            { lineId: credit.id, amount: fmt(available) },
          ],
        });
      }
    }
  }
  suggestions.sort(
    (a, b) =>
      Number(b.ambiguities.length === 0) - Number(a.ambiguities.length === 0) ||
      b.confidence - a.confidence ||
      b.amount.localeCompare(a.amount),
  );
  return {
    suggestions: suggestions.slice(0, Math.min(Math.max(limit, 1), 100)),
    method: 'deterministic',
    autoValidated: false,
  };
}

export interface LetteringFilters {
  accountId?: string;
  search?: string
  currency?: string;
  from?: string;
  to?: string;
}

async function allOpenLines(db: Db, companyId: string, filters: LetteringFilters) {
  const accounts = await listLettrableAccounts(db, companyId);
  const target = filters.accountId ? accounts.filter((a) => a.id === filters.accountId) : accounts;
  const lines: LetteringLineView[] = [];
  for (const account of target) {
    const clauses = ['l.company_id = $1', 'l.account_id = $2', `e.status = 'posted'`];
    const params: unknown[] = [companyId, account.id];
    if (filters.currency) {
      params.push(filters.currency.toUpperCase());
      clauses.push(`e.currency = $${params.length}`);
    }
    if (filters.from) {
      params.push(filters.from);
      clauses.push(`e.entry_date >= $${params.length}`);
    }
    if (filters.to) {
      params.push(filters.to);
      clauses.push(`e.entry_date <= $${params.length}`);
    }
    if (filters.search?.trim()) {
      params.push(`%${filters.search.trim()}%`);
      clauses.push(
        `(e.entry_no ILIKE $${params.length} OR e.reference ILIKE $${params.length}
          OR e.description ILIKE $${params.length} OR l.description ILIKE $${params.length}
          OR COALESCE(bd.doc_no, pd.doc_no, bp.payment_no, pp.payment_no) ILIKE $${params.length})`,
      );
    }
    const res = await db.query<LineRow>(
      `${BASE_SELECT} WHERE ${clauses.join(' AND ')} ORDER BY e.entry_date, e.entry_no, l.line_no LIMIT 5000`,
      params,
    );
    lines.push(...res.rows.map(lineView).filter((l) => money(l.remaining) > 0n));
  }
  return { accounts, lines };
}

export async function letteringReport(
  db: Db,
  companyId: string,
  filters: LetteringFilters = {},
) {
  const { accounts, lines } = await allOpenLines(db, companyId, filters);
  const byCurrency = new Map<string, { currency: string; debit: Big; credit: Big; lines: number }>();
  const byAccount = new Map<
    string,
    {
      accountId: string;
      accountCode: string;
      accountName: string;
      currency: string;
      debit: Big;
      credit: Big;
      lines: number;
    }
  >();
  for (const line of lines) {
    const row = byCurrency.get(line.currency) ?? { currency: line.currency, debit: 0n, credit: 0n, lines: 0 };
    if (line.side === 'debit') row.debit += money(line.remaining);
    else row.credit += money(line.remaining);
    row.lines += 1;
    byCurrency.set(line.currency, row);

    const key = `${line.accountId}:${line.currency}`;
    const account = byAccount.get(key) ?? {
      accountId: line.accountId,
      accountCode: line.accountCode,
      accountName: line.accountName,
      currency: line.currency,
      debit: 0n,
      credit: 0n,
      lines: 0,
    };
    if (line.side === 'debit') account.debit += money(line.remaining);
    else account.credit += money(line.remaining);
    account.lines += 1;
    byAccount.set(key, account);
  }

  const documents = await db.query<any>(
    `SELECT 'billing' AS source, d.id, d.kind, d.doc_no AS number, d.status,
            c.name AS partner_name, d.currency, d.total_amount::text,
            d.amount_paid::text, d.credited_amount::text, d.due_date,
            d.accounting_entry_id, l.id AS line_id, l.debit::text, l.credit::text,
            COALESCE((
              SELECT SUM(ll.amount) FROM ledger_lettering_lines ll
              JOIN ledger_letterings lg ON lg.id = ll.lettering_id AND lg.status = 'active'
              WHERE ll.journal_line_id = l.id
            ), 0)::text AS lettered
       FROM billing_documents d
       JOIN billing_customers c ON c.id = d.customer_id
       LEFT JOIN journal_lines l ON l.entry_id = d.accounting_entry_id AND l.account_id = COALESCE(
         (SELECT bs.default_receivable_account_id FROM billing_settings bs WHERE bs.company_id = d.company_id),
         (SELECT a.id FROM accounts a WHERE a.company_id = d.company_id AND a.code = '1100' LIMIT 1)
       )
      WHERE d.company_id = $1 AND d.kind IN ('invoice','credit_note') AND d.accounting_entry_id IS NOT NULL
      UNION ALL
     SELECT 'purchase', d.id, d.kind, d.doc_no, d.status,
            s.name, d.currency, d.total_amount::text,
            d.amount_paid::text, d.credited_amount::text, d.due_date,
            d.accounting_entry_id, l.id, l.debit::text, l.credit::text,
            COALESCE((
              SELECT SUM(ll.amount) FROM ledger_lettering_lines ll
              JOIN ledger_letterings lg ON lg.id = ll.lettering_id AND lg.status = 'active'
              WHERE ll.journal_line_id = l.id
            ), 0)::text
       FROM purchase_documents d
       JOIN purchase_suppliers s ON s.id = d.supplier_id
       LEFT JOIN journal_lines l ON l.entry_id = d.accounting_entry_id AND l.account_id = COALESCE(
         s.payable_account_id,
         (SELECT a.id FROM accounts a WHERE a.company_id = d.company_id AND a.code = '2000' LIMIT 1)
       )
      WHERE d.company_id = $1 AND d.status = 'validated' AND d.accounting_entry_id IS NOT NULL
      ORDER BY number`,
    [companyId],
  );
  const documentRows = documents.rows.map((row) => {
    const accounting = row.line_id ? money(row.debit) + money(row.credit) : 0n;
    const lettered = row.line_id ? money(row.lettered) : 0n;
    const accountingRemaining = accounting - lettered > 0n ? accounting - lettered : 0n;
    const commercial = money(row.total_amount) - money(row.amount_paid) - money(row.credited_amount);
    const commercialOutstanding = commercial > 0n ? commercial : 0n;
    const variance = commercialOutstanding - accountingRemaining;
    const letteringStatus =
      !row.line_id
        ? 'no_accounting_line'
        : accountingRemaining <= 0n
          ? 'fully_lettered'
          : lettered > 0n
            ? 'partially_lettered'
            : 'unlettered';
    return {
      source: row.source,
      id: row.id,
      kind: row.kind,
      number: row.number,
      status: row.status,
      partnerName: row.partner_name,
      currency: row.currency,
      dueDate: row.due_date,
      total: row.total_amount,
      commercialOutstanding: fmt(commercialOutstanding),
      accountingRemaining: fmt(accountingRemaining),
      lettered: fmt(lettered),
      accountingLineAmount: fmt(accounting),
      variance: fmt(variance),
      letteringStatus,
      accountingEntryId: row.accounting_entry_id,
      lineId: row.line_id,
    };
  });

  const payments = await db.query<any>(
    `SELECT 'billing' AS source, p.id, p.payment_no AS number, p.payment_date,
            p.amount::text, p.currency, c.name AS partner_name,
            p.accounting_entry_id, l.id AS line_id, l.debit::text, l.credit::text,
            COALESCE((
              SELECT SUM(ll.amount) FROM ledger_lettering_lines ll
              JOIN ledger_letterings lg ON lg.id = ll.lettering_id AND lg.status = 'active'
              WHERE ll.journal_line_id = l.id
            ), 0)::text AS lettered
       FROM billing_payments p
       JOIN billing_customers c ON c.id = p.customer_id
       LEFT JOIN journal_lines l ON l.entry_id = p.accounting_entry_id AND l.account_id = COALESCE(
         (SELECT bs.default_receivable_account_id FROM billing_settings bs WHERE bs.company_id = p.company_id),
         (SELECT a.id FROM accounts a WHERE a.company_id = p.company_id AND a.code = '1100' LIMIT 1)
       )
      WHERE p.company_id = $1 AND p.status = 'recorded'
      UNION ALL
     SELECT 'purchase', p.id, p.payment_no, p.payment_date, p.amount::text,
            p.currency, s.name, p.accounting_entry_id, l.id, l.debit::text, l.credit::text,
            COALESCE((
              SELECT SUM(ll.amount) FROM ledger_lettering_lines ll
              JOIN ledger_letterings lg ON lg.id = ll.lettering_id AND lg.status = 'active'
              WHERE ll.journal_line_id = l.id
            ), 0)::text
       FROM purchase_payments p
       JOIN purchase_suppliers s ON s.id = p.supplier_id
       LEFT JOIN journal_lines l ON l.entry_id = p.accounting_entry_id AND l.account_id = COALESCE(
         s.payable_account_id,
         (SELECT a.id FROM accounts a WHERE a.company_id = p.company_id AND a.code = '2000' LIMIT 1)
       )
      WHERE p.company_id = $1 AND p.status = 'recorded'`,
    [companyId],
  );
  const paymentRows = payments.rows.map((row) => {
    const amount = row.line_id ? money(row.debit) + money(row.credit) : 0n;
    const lettered = row.line_id ? money(row.lettered) : 0n;
    const remaining = amount - lettered > 0n ? amount - lettered : 0n;
    return {
      source: row.source,
      id: row.id,
      number: row.number,
      paymentDate: row.payment_date,
      amount: row.amount,
      currency: row.currency,
      partnerName: row.partner_name,
      accountingEntryId: row.accounting_entry_id,
      lettered: fmt(lettered),
      remaining: fmt(remaining),
      status: !row.accounting_entry_id ? 'awaiting_accounting' : remaining <= 0n ? 'fully_lettered' : 'partially_lettered',
    };
  });

  const history = await getLetteringHistory(db, companyId);
  return {
    accounts,
    unlettered: {
      lines: lines.slice(0, 500),
      byCurrency: [...byCurrency.values()]
        .map((row) => ({
          currency: row.currency,
          debit: fmt(row.debit),
          credit: fmt(row.credit),
          balance: fmt(row.debit - row.credit),
          lines: row.lines,
        }))
        .sort((a, b) => a.currency.localeCompare(b.currency)),
      byAccount: [...byAccount.values()]
        .map((row) => ({
          ...row,
          debit: fmt(row.debit),
          credit: fmt(row.credit),
          balance: fmt(row.debit - row.credit),
        }))
        .sort((a, b) => a.accountCode.localeCompare(b.accountCode) || a.currency.localeCompare(b.currency)),
    },
    documents: documentRows,
    fullyLettered: documentRows.filter((d) => d.letteringStatus === 'fully_lettered'),
    partiallyLettered: documentRows.filter((d) => d.letteringStatus === 'partially_lettered'),
    unletteredDocuments: documentRows.filter((d) => d.letteringStatus === 'unlettered'),
    payments: paymentRows,
    unletteredPayments: paymentRows.filter((p) => p.status !== 'fully_lettered'),
    variances: documentRows.filter((d) => money(d.variance) !== 0n),
    history,
    note:
      'Les devises sont présentées séparément. Le lettrage comptable ne modifie ni le solde commercial d’une facture ni le rapprochement bancaire.',
  };
}

export async function letteringCsv(
  db: Db,
  companyId: string,
  filters: LetteringFilters = {},
): Promise<string> {
  const { lines } = await allOpenLines(db, companyId, filters);
  const escape = (value: unknown) => {
    const text = String(value ?? '');
    const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
    return `"${safe.replace(/"/g, '""')}"`;
  };
  const rows = [
    [
      'Compte', 'Intitulé', 'Écriture', 'Date', 'Référence', 'Libellé', 'Tiers',
      'Débit', 'Crédit', 'Restant', 'Devise', 'Document', 'Statut document', 'Lettrage',
    ],
  ];
  for (const line of lines) {
    const group = await db.query<{ code: string }>(
      `SELECT lg.code FROM ledger_lettering_lines ll
        JOIN ledger_letterings lg ON lg.id = ll.lettering_id AND lg.status = 'active'
       WHERE ll.journal_line_id = $1 ORDER BY lg.created_at`,
      [line.id],
    );
    rows.push([
      line.accountCode,
      line.accountName,
      line.entryNo,
      line.entryDate,
      line.entryReference ?? '',
      line.entryDescription,
      line.partnerName ?? '',
      line.debit,
      line.credit,
      line.remaining,
      line.currency,
      line.documentNo ?? '',
      line.documentStatus ?? '',
      group.rows.map((g) => g.code).join(' '),
    ]);
  }
  return rows.map((row) => row.map(escape).join(';')).join('\r\n');
}

export async function explainLineLettering(db: Db, companyId: string, lineId: string) {
  const res = await db.query<LineRow>(`${BASE_SELECT} WHERE l.id = $1 AND l.company_id = $2`, [
    lineId,
    companyId,
  ]);
  const row = res.rows[0];
  if (!row) throw notFound('LETTERING_LINE_NOT_FOUND', 'Journal line not found');
  const groups = await db.query<any>(
    `SELECT lg.id, lg.code, lg.status, lg.amount::text, lg.created_at, lg.reversal_reason,
            ll.amount::text AS allocated_amount
       FROM ledger_lettering_lines ll
       JOIN ledger_letterings lg ON lg.id = ll.lettering_id
      WHERE ll.journal_line_id = $1 AND lg.company_id = $2
      ORDER BY lg.created_at`,
    [lineId, companyId],
  );
  const view = lineView(row);
  return {
    line: view,
    groups: groups.rows,
    explanation: {
      fr:
        money(view.remaining) === 0n
          ? 'Cette ligne est entièrement lettrée.'
          : money(view.lettered) > 0n
            ? `Cette ligne est partiellement lettrée : ${view.lettered} sur ${view.amount}, restant ${view.remaining} ${view.currency}.`
            : `Cette ligne n’est pas lettrée : restant ${view.remaining} ${view.currency}.`,
      en:
        money(view.remaining) === 0n
          ? 'This line is fully lettered.'
          : money(view.lettered) > 0n
            ? `This line is partially lettered: ${view.lettered} of ${view.amount}, remaining ${view.remaining} ${view.currency}.`
            : `This line is not lettered: remaining ${view.remaining} ${view.currency}.`,
    },
  };
}
