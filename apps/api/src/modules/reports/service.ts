import type { Db } from '../../db/index.js';
import { formatAmount, parseAmount } from '../../lib/money.js';

export interface ReportRange {
  from: string;
  to: string;
  accountId?: string;
  search?: string;
  includeInactive?: boolean;
}

export interface LedgerLineDto {
  entryId: string;
  entryNo: string;
  date: string;
  journal: string;
  reference: string | null;
  description: string;
  debit: string;
  credit: string;
  balance: string;
}

export interface LedgerAccountDto {
  accountId: string;
  code: string;
  name: string;
  type: string;
  fsMapping: string | null;
  opening: string;
  lines: LedgerLineDto[];
  totalDebit: string;
  totalCredit: string;
  closing: string;
}

export interface LedgerDto {
  from: string;
  to: string;
  currency: string;
  accounts: LedgerAccountDto[];
  totals: { debit: string; credit: string };
}

export interface TrialBalanceRowDto {
  accountId: string;
  code: string;
  name: string;
  type: string;
  openingDebit: string;
  openingCredit: string;
  movementDebit: string;
  movementCredit: string;
  closingDebit: string;
  closingCredit: string;
}

export interface TrialBalanceDto {
  from: string;
  to: string;
  currency: string;
  rows: TrialBalanceRowDto[];
  totals: {
    openingDebit: string;
    openingCredit: string;
    movementDebit: string;
    movementCredit: string;
    closingDebit: string;
    closingCredit: string;
  };
  balanced: boolean;
}

export interface StatementLineDto {
  accountId: string;
  code: string;
  name: string;
  amount: string;
}

export interface StatementGroupDto {
  key: string;
  lines: StatementLineDto[];
  total: string;
}

export interface StatementsDto {
  from: string;
  to: string;
  currency: string;
  basis: 'posted_entries';
  profitAndLoss: {
    revenue: StatementGroupDto;
    expenses: StatementGroupDto;
    profit: string;
  };
  financialPosition: {
    assets: StatementGroupDto;
    liabilities: StatementGroupDto;
    equity: StatementGroupDto;
    unappropriatedResult: string;
    totalAssets: string;
    totalLiabilitiesAndEquity: string;
    balanced: boolean;
  };
}

const signed = (debit: bigint, credit: bigint) => debit - credit;

/** General ledger: movements plus opening/closing balances per account. */
export async function computeLedger(
  db: Db,
  companyId: string,
  functionalCurrency: string,
  range: ReportRange,
): Promise<LedgerDto> {
  const accountParams: unknown[] = [companyId];
  if (range.accountId) accountParams.push(range.accountId);
  const accountFilter = range.accountId ? 'AND a.id = $2' : '';
  const lineFilter = range.accountId ? 'AND l.account_id = $4' : '';

  // All accounts are fetched: an account that was deactivated after being used
  // must still appear in the ledger (otherwise balances would silently vanish).
  // The account list is narrowed afterwards (movements, or includeInactive).
  const accountsRes = await db.query<{
    id: string;
    code: string;
    name: string;
    type: string;
    fs_mapping: string | null;
    is_active: boolean;
  }>(
    `SELECT a.id, a.code, a.name, a.type, a.fs_mapping, a.is_active
       FROM accounts a
      WHERE a.company_id = $1
        ${accountFilter}
      ORDER BY a.code`,
    accountParams,
  );

  const movementParams: unknown[] = [companyId, range.from, range.to];
  if (range.accountId) movementParams.push(range.accountId);

  const movements = await db.query<{
    account_id: string;
    entry_id: string;
    entry_no: string;
    entry_date: string;
    journal_code: string;
    reference: string | null;
    description: string;
    debit: string;
    credit: string;
  }>(
    `SELECT l.account_id, e.id AS entry_id, e.entry_no, e.entry_date::text AS entry_date,
            j.code AS journal_code, e.reference,
            COALESCE(l.description, e.description) AS description,
            l.debit::text AS debit, l.credit::text AS credit
       FROM journal_lines l
       JOIN journal_entries e ON e.id = l.entry_id
       JOIN journals j ON j.id = e.journal_id
      WHERE e.company_id = $1 AND e.status = 'posted'
        AND e.entry_date >= $2 AND e.entry_date <= $3
        ${lineFilter}
      ORDER BY e.entry_date, e.entry_no, l.line_no`,
    movementParams,
  );

  const openings = await db.query<{ account_id: string; opening: string }>(
    `SELECT l.account_id, (COALESCE(SUM(l.debit),0) - COALESCE(SUM(l.credit),0))::text AS opening
       FROM journal_lines l
       JOIN journal_entries e ON e.id = l.entry_id
      WHERE e.company_id = $1 AND e.status = 'posted' AND e.entry_date < $2
        ${range.accountId ? 'AND l.account_id = $3' : ''}
      GROUP BY l.account_id`,
    [companyId, range.from, ...(range.accountId ? [range.accountId] : [])],
  );

  const openingByAccount = new Map(openings.rows.map((r) => [r.account_id, parseAmount(r.opening)]));
  const byAccount = new Map<string, LedgerAccountDto>();
  const search = range.search?.trim().toLowerCase();

  for (const acc of accountsRes.rows) {
    byAccount.set(acc.id, {
      accountId: acc.id,
      code: acc.code,
      name: acc.name,
      type: acc.type,
      fsMapping: acc.fs_mapping,
      opening: formatAmount(openingByAccount.get(acc.id) ?? 0n),
      lines: [],
      totalDebit: formatAmount(0n),
      totalCredit: formatAmount(0n),
      closing: formatAmount(0n),
    });
  }

  let grandDebit = 0n;
  let grandCredit = 0n;

  for (const m of movements.rows) {
    const account = byAccount.get(m.account_id);
    if (!account) continue;
    const debit = parseAmount(m.debit);
    const credit = parseAmount(m.credit);
    const previous = account.lines.length
      ? parseAmount(account.lines[account.lines.length - 1]!.balance)
      : parseAmount(account.opening);
    const balance = previous + signed(debit, credit);
    account.lines.push({
      entryId: m.entry_id,
      entryNo: m.entry_no,
      date: m.entry_date,
      journal: m.journal_code,
      reference: m.reference,
      description: m.description,
      debit: formatAmount(debit),
      credit: formatAmount(credit),
      balance: formatAmount(balance),
    });
  }

  const result = [...byAccount.values()].map((account) => {
    let debit = 0n;
    let credit = 0n;
    for (const line of account.lines) {
      debit += parseAmount(line.debit);
      credit += parseAmount(line.credit);
    }
    account.totalDebit = formatAmount(debit);
    account.totalCredit = formatAmount(credit);
    account.closing = formatAmount(parseAmount(account.opening) + debit - credit);
    grandDebit += debit;
    grandCredit += credit;
    return account;
  });

  const hasActivity = (a: LedgerAccountDto) =>
    a.lines.length > 0 || parseAmount(a.opening) !== 0n || parseAmount(a.closing) !== 0n;
  const visible = range.includeInactive ? result : result.filter(hasActivity);
  const filtered = search
    ? visible.filter(
        (a) =>
          hasActivity(a) &&
          (a.code.toLowerCase().includes(search) || a.name.toLowerCase().includes(search)),
      )
    : visible;

  return {
    from: range.from,
    to: range.to,
    currency: functionalCurrency,
    accounts: filtered,
    totals: { debit: formatAmount(grandDebit), credit: formatAmount(grandCredit) },
  };
}

/** Trial balance with opening / movement / closing columns. */
export async function computeTrialBalance(
  db: Db,
  companyId: string,
  functionalCurrency: string,
  range: ReportRange,
): Promise<TrialBalanceDto> {
  const params: unknown[] = [companyId, range.from, range.to];
  let accountFilter = '';
  if (range.accountId) {
    params.push(range.accountId);
    accountFilter = `AND a.id = $${params.length}`;
  }

  const res = await db.query<{
    id: string;
    code: string;
    name: string;
    type: string;
    opening_debit: string;
    opening_credit: string;
    movement_debit: string;
    movement_credit: string;
  }>(
    `SELECT a.id, a.code, a.name, a.type,
            COALESCE(SUM(CASE WHEN e.entry_date < $2 THEN l.debit ELSE 0 END),0)::text  AS opening_debit,
            COALESCE(SUM(CASE WHEN e.entry_date < $2 THEN l.credit ELSE 0 END),0)::text AS opening_credit,
            COALESCE(SUM(CASE WHEN e.entry_date >= $2 THEN l.debit ELSE 0 END),0)::text  AS movement_debit,
            COALESCE(SUM(CASE WHEN e.entry_date >= $2 THEN l.credit ELSE 0 END),0)::text AS movement_credit
       FROM accounts a
       JOIN journal_lines l ON l.account_id = a.id
       JOIN journal_entries e ON e.id = l.entry_id
      WHERE a.company_id = $1 AND e.company_id = $1 AND e.status = 'posted'
        AND e.entry_date <= $3
        ${accountFilter}
      GROUP BY a.id, a.code, a.name, a.type
      ORDER BY a.code`,
    params,
  );

  const rows: TrialBalanceRowDto[] = [];
  const tot = {
    openingDebit: 0n,
    openingCredit: 0n,
    movementDebit: 0n,
    movementCredit: 0n,
    closingDebit: 0n,
    closingCredit: 0n,
  };

  for (const r of res.rows) {
    const openNet = signed(parseAmount(r.opening_debit), parseAmount(r.opening_credit));
    const movementDebit = parseAmount(r.movement_debit);
    const movementCredit = parseAmount(r.movement_credit);
    const closingNet = openNet + movementDebit - movementCredit;

    const openingDebit = openNet > 0n ? openNet : 0n;
    const openingCredit = openNet < 0n ? -openNet : 0n;
    const closingDebit = closingNet > 0n ? closingNet : 0n;
    const closingCredit = closingNet < 0n ? -closingNet : 0n;

    if (
      openNet === 0n &&
      movementDebit === 0n &&
      movementCredit === 0n &&
      closingNet === 0n
    ) {
      continue;
    }

    rows.push({
      accountId: r.id,
      code: r.code,
      name: r.name,
      type: r.type,
      openingDebit: formatAmount(openingDebit),
      openingCredit: formatAmount(openingCredit),
      movementDebit: formatAmount(movementDebit),
      movementCredit: formatAmount(movementCredit),
      closingDebit: formatAmount(closingDebit),
      closingCredit: formatAmount(closingCredit),
    });

    tot.openingDebit += openingDebit;
    tot.openingCredit += openingCredit;
    tot.movementDebit += movementDebit;
    tot.movementCredit += movementCredit;
    tot.closingDebit += closingDebit;
    tot.closingCredit += closingCredit;
  }

  return {
    from: range.from,
    to: range.to,
    currency: functionalCurrency,
    rows,
    totals: {
      openingDebit: formatAmount(tot.openingDebit),
      openingCredit: formatAmount(tot.openingCredit),
      movementDebit: formatAmount(tot.movementDebit),
      movementCredit: formatAmount(tot.movementCredit),
      closingDebit: formatAmount(tot.closingDebit),
      closingCredit: formatAmount(tot.closingCredit),
    },
    balanced: tot.closingDebit === tot.closingCredit,
  };
}

const PL_GROUP_LABELS: Record<string, string> = {
  'pl.revenue': 'Revenue',
  'pl.other_income': 'Other income',
  'pl.cost_of_sales': 'Cost of sales',
  'pl.operating_expenses': 'Operating expenses',
  'pl.finance_costs': 'Finance costs',
  'pl.tax_expense': 'Income tax expense',
  unmapped: 'Unmapped',
};

const BS_PREFIX_LABELS: Record<string, string> = {
  'bs.non_current_assets': 'Non-current assets',
  'bs.current_assets': 'Current assets',
  'bs.non_current_liabilities': 'Non-current liabilities',
  'bs.current_liabilities': 'Current liabilities',
  'bs.equity': 'Equity',
};

/**
 * Provisional Statement of Financial Position and Statement of Profit or Loss
 * built exclusively from posted journal entries.
 *
 * IMPORTANT: this is a demonstration presentation. No year-end closing entries
 * are automated, so the accumulated result is shown separately in equity. See
 * docs/mauritius-regulations/accounting.md for the outstanding work required
 * for IFRS-compliant statements.
 */
export async function computeStatements(
  db: Db,
  companyId: string,
  functionalCurrency: string,
  range: ReportRange,
): Promise<StatementsDto> {
  const movementRows = await db.query<{
    id: string;
    code: string;
    name: string;
    type: string;
    fs_mapping: string | null;
    period_net: string;
    cumulative_net: string;
  }>(
    `SELECT a.id, a.code, a.name, a.type, a.fs_mapping,
            COALESCE(SUM(CASE WHEN e.entry_date >= $2 AND e.entry_date <= $3
                              THEN l.debit - l.credit ELSE 0 END),0)::text AS period_net,
            COALESCE(SUM(CASE WHEN e.entry_date <= $3
                              THEN l.debit - l.credit ELSE 0 END),0)::text AS cumulative_net
       FROM accounts a
       JOIN journal_lines l ON l.account_id = a.id
       JOIN journal_entries e ON e.id = l.entry_id
      WHERE a.company_id = $1 AND e.company_id = $1 AND e.status = 'posted'
      GROUP BY a.id, a.code, a.name, a.type, a.fs_mapping
      ORDER BY a.code`,
    [companyId, range.from, range.to],
  );

  let cumulativeRevenue = 0n;
  let cumulativeExpenses = 0n;

  const plLines: Record<'revenue' | 'expenses', StatementLineDto[]> = {
    revenue: [],
    expenses: [],
  };
  const bsLines: Record<'assets' | 'liabilities' | 'equity', StatementLineDto[]> = {
    assets: [],
    liabilities: [],
    equity: [],
  };

  for (const r of movementRows.rows) {
    const periodNet = parseAmount(r.period_net);
    const cumulativeNet = parseAmount(r.cumulative_net);
    const mapping = r.fs_mapping ?? 'unmapped';

    if (r.type === 'revenue') {
      // Credits increase revenue -> present as positive income.
      cumulativeRevenue += -cumulativeNet;
      if (periodNet !== 0n) {
        plLines.revenue.push({
          accountId: r.id,
          code: r.code,
          name: r.name,
          amount: formatAmount(-periodNet),
        });
      }
    } else if (r.type === 'expense') {
      cumulativeExpenses += cumulativeNet;
      if (periodNet !== 0n) {
        plLines.expenses.push({
          accountId: r.id,
          code: r.code,
          name: r.name,
          amount: formatAmount(periodNet),
        });
      }
    } else {
      // Debit-positive presentation for the balance sheet.
      // Liabilities and equity carry credit balances, so flip the sign.
      const amount =
        r.type === 'asset' ? cumulativeNet : -cumulativeNet;
      if (amount !== 0n) {
        const bucket =
          r.type === 'asset' ? 'assets' : r.type === 'liability' ? 'liabilities' : 'equity';
        bsLines[bucket].push({
          accountId: r.id,
          code: r.code,
          name: r.name,
          amount: formatAmount(amount),
        });
      }
    }
  }

  // Index the movement rows once: statement grouping used to scan the whole
  // result set for every line (O(n²) on large charts of accounts).
  const rowsById = new Map(movementRows.rows.map((r) => [r.id, r]));

  const groupPL = (bucket: 'revenue' | 'expenses'): StatementGroupDto => {
    const lines = plLines[bucket];
    const out = new Map<string, StatementLineDto[]>();
    for (const line of lines) {
      const row = rowsById.get(line.accountId);
      const key = PL_GROUP_LABELS[row?.fs_mapping ?? 'unmapped'] ?? 'Unmapped';
      if (!out.has(key)) out.set(key, []);
      out.get(key)!.push(line);
    }
    const total = lines.reduce((a, l) => a + parseAmount(l.amount), 0n);
    // Keep the grouped presentation available for future statement templates.
    const groups = [...out.entries()].map(([key, groupLines]) => ({
      key,
      lines: groupLines,
      total: formatAmount(groupLines.reduce((a, l) => a + parseAmount(l.amount), 0n)),
    }));
    return {
      key: bucket,
      lines: groups.flatMap((g) => g.lines),
      total: formatAmount(total),
    };
  };

  const revenueGroup = groupPL('revenue');
  const expenseGroup = groupPL('expenses');
  const profit = parseAmount(revenueGroup.total) - parseAmount(expenseGroup.total);

  // No year-end closing entries are generated yet: revenue and expense accounts
  // keep their cumulative balance. The statement of financial position must
  // therefore include the result accumulated SINCE INCEPTION (not only the
  // result of the selected period), otherwise it cannot balance when the
  // reporting period starts after the first transactions.
  const cumulativeResult = cumulativeRevenue - cumulativeExpenses;

  const groupBS = (bucket: 'assets' | 'liabilities' | 'equity'): StatementGroupDto => {
    const lines = bsLines[bucket];
    const out = new Map<string, StatementLineDto[]>();
    for (const line of lines) {
      const row = rowsById.get(line.accountId);
      const prefix = (row?.fs_mapping ?? 'unmapped').split('.').slice(0, 2).join('.');
      const key = BS_PREFIX_LABELS[prefix] ?? 'Other';
      if (!out.has(key)) out.set(key, []);
      out.get(key)!.push(line);
    }
    const total = lines.reduce((a, l) => a + parseAmount(l.amount), 0n);
    return {
      key: bucket,
      lines: [...out.entries()].flatMap(([, groupLines]) => groupLines),
      total: formatAmount(total),
    };
  };

  const assets = groupBS('assets');
  const liabilities = groupBS('liabilities');
  const equity = groupBS('equity');

  const totalAssets = parseAmount(assets.total);
  const totalLiabilitiesAndEquity =
    parseAmount(liabilities.total) + parseAmount(equity.total) + cumulativeResult;

  return {
    from: range.from,
    to: range.to,
    currency: functionalCurrency,
    basis: 'posted_entries',
    profitAndLoss: { revenue: revenueGroup, expenses: expenseGroup, profit: formatAmount(profit) },
    financialPosition: {
      assets,
      liabilities,
      equity,
      unappropriatedResult: formatAmount(cumulativeResult),
      totalAssets: formatAmount(totalAssets),
      totalLiabilitiesAndEquity: formatAmount(totalLiabilitiesAndEquity),
      balanced: totalAssets === totalLiabilitiesAndEquity,
    },
  };
}
