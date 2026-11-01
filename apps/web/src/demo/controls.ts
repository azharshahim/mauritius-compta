/**
 * Mission 42.1 — demonstration data for the two accounting control screens.
 *
 * The figures are computed from the browser demo ledger only. They follow the
 * same rules as the API: no cross-currency addition, no forced zero difference,
 * and a difference is "explained" only when it is exactly the net of the listed
 * unposted items. Nothing here claims to be an official MRA return.
 */
import { formatScaled, parseAmount } from '../../../api/src/modules/migration/normalize';
import type { DemoState } from './runtime';

type Big = bigint;
const amt = (value: unknown): Big => parseAmount(value as never) ?? 0n;
const fmt = (value: Big) => formatScaled(value);

interface ControlAccount {
  id: string;
  code: string;
  name: string;
  role: string | null;
}

const accountRole = (account: any): string | null => account.account_role ?? null;

function collectiveAccounts(state: DemoState, companyId: string, side: 'receivable' | 'payable'): ControlAccount[] {
  const code = side === 'receivable' ? '1100' : '2000';
  const explicit = new Set<string>();
  if (side === 'receivable') {
    for (const customer of state.billingCustomers) {
      if (customer.company_id === companyId && customer.receivable_account_id) explicit.add(customer.receivable_account_id);
    }
  } else {
    for (const supplier of state.purchaseSuppliers) {
      if (supplier.company_id === companyId && supplier.payable_account_id) explicit.add(supplier.payable_account_id);
    }
  }
  const roles = side === 'receivable' ? ['receivable', 'trade_receivable'] : ['payable', 'trade_payable'];
  const accounts = state.accounts
    .filter((account) => account.company_id === companyId)
    .filter(
      (account) =>
        explicit.has(account.id) ||
        account.code === code ||
        roles.includes(accountRole(account) ?? ''),
    )
    .sort((a, b) => a.code.localeCompare(b.code));
  if (accounts.length === 0) {
    throw new Error(
      side === 'receivable'
        ? 'Aucun compte collectif client dans le plan comptable de démonstration'
        : 'Aucun compte collectif fournisseur dans le plan comptable de démonstration',
    );
  }
  return accounts.map((account) => ({
    id: account.id,
    code: account.code,
    name: account.name,
    role: accountRole(account),
  }));
}

function postedLines(state: DemoState, companyId: string, from: string, to: string) {
  const entries = new Map(
    state.entries
      .filter((entry) => entry.company_id === companyId && entry.status === 'posted' && entry.entry_date >= from && entry.entry_date <= to)
      .map((entry) => [entry.id, entry]),
  );
  return state.lines
    .filter((line) => entries.has(line.entry_id) && line.company_id === companyId)
    .map((line) => ({ line, entry: entries.get(line.entry_id)! }));
}

interface Movement {
  id: string;
  kind: 'invoice' | 'credit_note' | 'payment';
  number: string | null;
  partyId: string;
  partyName: string;
  date: string;
  currency: string;
  amount: Big;
  accountId: string;
  posted: boolean;
}

function subledgerMovements(
  state: DemoState,
  companyId: string,
  side: 'receivable' | 'payable',
  asOf: string,
  accounts: ControlAccount[],
): Movement[] {
  const byId = new Map(accounts.map((account) => [account.id, account]));
  const fallback = accounts[0]!.id;
  const movements: Movement[] = [];
  if (side === 'receivable') {
    const allocated = (invoiceId: string) =>
      state.billingAllocations
        .filter((allocation) => allocation.invoice_id === invoiceId && !allocation.cancelled_at)
        .filter((allocation) => state.billingPayments.find((payment) => payment.id === allocation.payment_id && payment.status === 'recorded'))
        .reduce((sum, allocation) => sum + amt(allocation.amount), 0n);
    for (const document of state.billingDocuments) {
      if (document.company_id !== companyId || document.kind === 'quote' || document.status === 'cancelled') continue;
      if (document.issue_date > asOf) continue;
      const customer = state.billingCustomers.find((c) => c.id === document.customer_id && c.company_id === companyId);
      const accountId = customer?.receivable_account_id && byId.has(customer.receivable_account_id)
        ? customer.receivable_account_id
        : fallback;
      const gross = amt(document.total_amount) - allocated(document.id);
      if (gross <= 0n) continue;
      movements.push({
        id: document.id,
        kind: document.kind === 'credit_note' ? 'credit_note' : 'invoice',
        number: document.doc_no,
        partyId: document.customer_id ?? '',
        partyName: document.customer_name,
        date: document.issue_date,
        currency: document.currency,
        amount: document.kind === 'credit_note' ? -gross : gross,
        accountId,
        posted: Boolean(document.accounting_entry_id),
      });
    }
    for (const payment of state.billingPayments) {
      if (payment.company_id !== companyId || payment.status !== 'recorded' || payment.payment_date > asOf) continue;
      const customer = state.billingCustomers.find((c) => c.id === payment.customer_id && c.company_id === companyId);
      const accountId = customer?.receivable_account_id && byId.has(customer.receivable_account_id)
        ? customer.receivable_account_id
        : fallback;
      movements.push({
        id: payment.id,
        kind: 'payment',
        number: payment.payment_no,
        partyId: payment.customer_id,
        partyName: customer?.name ?? '',
        date: payment.payment_date,
        currency: payment.currency,
        amount: -amt(payment.amount),
        accountId,
        posted: Boolean(payment.accounting_entry_id),
      });
    }
  } else {
    for (const document of state.purchaseDocuments) {
      if (document.company_id !== companyId || document.status !== 'validated' || document.issue_date > asOf) continue;
      const supplier = state.purchaseSuppliers.find((s) => s.id === document.supplier_id && s.company_id === companyId);
      const accountId = supplier?.payable_account_id && byId.has(supplier.payable_account_id)
        ? supplier.payable_account_id
        : fallback;
      const outstanding = amt(document.total_amount) - amt(document.amount_paid) - amt(document.credited_amount);
      if (outstanding <= 0n) continue;
      movements.push({
        id: document.id,
        kind: document.kind,
        number: document.doc_no,
        partyId: document.supplier_id,
        partyName: supplier?.name ?? '',
        date: document.issue_date,
        currency: document.currency,
        amount: document.kind === 'credit_note' ? -outstanding : outstanding,
        accountId,
        posted: Boolean(document.accounting_entry_id),
      });
    }
    for (const payment of state.purchasePayments) {
      if (payment.company_id !== companyId || payment.status !== 'recorded' || payment.payment_date > asOf) continue;
      const supplier = state.purchaseSuppliers.find((s) => s.id === payment.supplier_id && s.company_id === companyId);
      const accountId = supplier?.payable_account_id && byId.has(supplier.payable_account_id)
        ? supplier.payable_account_id
        : fallback;
      movements.push({
        id: payment.id,
        kind: 'payment',
        number: payment.payment_no,
        partyId: payment.supplier_id,
        partyName: supplier?.name ?? '',
        date: payment.payment_date,
        currency: payment.currency,
        amount: -amt(payment.amount),
        accountId,
        posted: Boolean(payment.accounting_entry_id),
      });
    }
  }
  return movements;
}

export function computeSubledgerControl(
  state: DemoState,
  companyId: string,
  asOf: string,
  side: 'receivable' | 'payable',
) {
  const accounts = collectiveAccounts(state, companyId, side);
  const gl = new Map<string, Big>();
  for (const { line, entry } of postedLines(state, companyId, '0000-01-01', asOf)) {
    if (!accounts.some((account) => account.id === line.account_id)) continue;
    const signed = side === 'receivable'
      ? amt(line.debit) - amt(line.credit)
      : amt(line.credit) - amt(line.debit);
    const key = `${line.account_id}|${entry.currency}`;
    gl.set(key, (gl.get(key) ?? 0n) + signed);
  }
  const movements = subledgerMovements(state, companyId, side, asOf, accounts);
  const keys = new Set<string>(gl.keys());
  for (const movement of movements) keys.add(`${movement.accountId}|${movement.currency}`);
  const rows = [...keys].sort().map((key) => {
    const [accountId, currency] = key.split('|') as [string, string];
    const account = accounts.find((candidate) => candidate.id === accountId) ?? accounts[0]!;
    const relevant = movements.filter((m) => m.accountId === accountId && m.currency === currency);
    const glBalance = gl.get(key) ?? 0n;
    const posted = relevant.filter((m) => m.posted).reduce((sum, m) => sum + m.amount, 0n);
    const unposted = relevant.filter((m) => !m.posted).reduce((sum, m) => sum + m.amount, 0n);
    const difference = glBalance - (posted + unposted);
    const unexplained = glBalance - posted;
    return {
      accountId,
      accountCode: account.code,
      accountName: account.name,
      currency,
      glBalance: fmt(glBalance),
      postedSubledger: fmt(posted),
      unpostedDocuments: fmt(unposted),
      subledgerTotal: fmt(posted + unposted),
      difference: fmt(difference),
      explainedDifference: fmt(-unposted),
      unexplainedDifference: fmt(unexplained),
      status: unexplained !== 0n ? 'unexplained' : unposted !== 0n ? 'explained' : 'reconciled',
    };
  });
  const currencies = [...new Set(rows.map((row) => row.currency))].sort();
  const totals = currencies.map((currency) => {
    const subset = rows.filter((row) => row.currency === currency);
    const sum = (field: 'glBalance' | 'postedSubledger' | 'unpostedDocuments' | 'subledgerTotal' | 'difference' | 'unexplainedDifference') =>
      fmt(subset.reduce((total, row) => total + amt(row[field]), 0n));
    return {
      currency,
      glBalance: sum('glBalance'),
      postedSubledger: sum('postedSubledger'),
      unpostedDocuments: sum('unpostedDocuments'),
      subledgerTotal: sum('subledgerTotal'),
      difference: sum('difference'),
      unexplainedDifference: sum('unexplainedDifference'),
    };
  });
  const hasUnexplained = rows.some((row) => row.status === 'unexplained');
  return {
    side,
    asOf,
    accounts,
    rows,
    totalsByCurrency: totals,
    unpostedDocuments: movements
      .filter((m) => !m.posted && m.kind !== 'payment')
      .map((m) => ({
        id: m.id,
        kind: m.kind === 'credit_note' ? 'credit_note' : 'invoice',
        number: m.number,
        partyId: m.partyId,
        partyName: m.partyName,
        date: m.date,
        currency: m.currency,
        amount: fmt(m.amount),
        accountId: m.accountId,
      })),
    unpostedPayments: movements
      .filter((m) => !m.posted && m.kind === 'payment')
      .map((m) => ({
        id: m.id,
        number: m.number,
        partyId: m.partyId,
        partyName: m.partyName,
        date: m.date,
        currency: m.currency,
        amount: fmt(m.amount),
        accountId: m.accountId,
      })),
    controls: {
      reconciled: rows.every((row) => row.status === 'reconciled'),
      hasUnexplainedDifference: hasUnexplained,
      notice:
        'Aucun écart n’est forcé à zéro. « Expliqué » signifie que l’écart est exactement le net des éléments non comptabilisés listés ; sinon il est « inexpliqué ».',
    },
  };
}

export function computeVatControl(state: DemoState, companyId: string, from: string, to: string) {
  const accounts = state.accounts
    .filter((account) => account.company_id === companyId)
    .filter((account) => {
      const role = accountRole(account);
      return (
        role === 'vat_input' ||
        role === 'vat_output' ||
        account.code === '1200' ||
        account.code === '2200' ||
        /tva|vat/i.test(account.name)
      );
    })
    .sort((a, b) => a.code.localeCompare(b.code));
  const byId = new Map(accounts.map((account) => [account.id, account]));
  const sums = new Map<string, { debit: Big; credit: Big }>();
  for (const { line, entry } of postedLines(state, companyId, from, to)) {
    if (!byId.has(line.account_id)) continue;
    const key = `${line.account_id}|${entry.currency}`;
    const current = sums.get(key) ?? { debit: 0n, credit: 0n };
    current.debit += amt(line.debit);
    current.credit += amt(line.credit);
    sums.set(key, current);
  }
  const rows = [...sums.entries()]
    .sort()
    .map(([key, value]) => {
      const [accountId, currency] = key.split('|') as [string, string];
      const account = byId.get(accountId)!;
      const role: 'input' | 'output' =
        accountRole(account) === 'vat_input' || account.code === '1200' ? 'input' : 'output';
      const signed = role === 'output' ? value.credit - value.debit : value.debit - value.credit;
      return {
        accountId,
        code: account.code,
        name: account.name,
        role,
        currency,
        debit: fmt(value.debit),
        credit: fmt(value.credit),
        balance: fmt(signed),
        signedVat: fmt(signed),
      };
    });
  const currencies = [...new Set(rows.map((row) => row.currency))].sort();
  return {
    from,
    to,
    accounts: rows,
    totalsByCurrency: currencies.map((currency) => {
      const output = rows
        .filter((row) => row.currency === currency && row.role === 'output')
        .reduce((sum, row) => sum + amt(row.signedVat), 0n);
      const input = rows
        .filter((row) => row.currency === currency && row.role === 'input')
        .reduce((sum, row) => sum + amt(row.signedVat), 0n);
      return {
        currency,
        outputVat: fmt(output),
        inputVat: fmt(input),
        netVat: fmt(output - input),
      };
    }),
    notice:
      'État de contrôle fondé uniquement sur les écritures comptabilisées. Aucun taux, seuil, formulaire ou délai MRA n’est inventé ; ce document n’est pas une déclaration officielle.',
    officialReturn: false as const,
  };
}
