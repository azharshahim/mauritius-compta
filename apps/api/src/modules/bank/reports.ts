import type { Db } from '../../db/index.js';
import { formatAmount, parseAmount } from '../../lib/money.js';
import { toCsv } from '../../lib/http.js';
import { notFound } from '../../lib/errors.js';
import { bankReport, type BankReport } from './service.js';

/**
 * Mission 10 - traceable reconciliation report.
 *
 * One row per confirmed allocation, one row per invoice and an explicit split
 * between "reconciled in the bank" and "posted to accounting". No amount is
 * rounded: every figure is a bigint then formatted as decimal(20,4).
 */

export interface ReconciliationAllocation {
  matchId: string;
  transactionId: string;
  transactionDate: string;
  transactionLabel: string;
  transactionReference: string | null;
  transactionAmount: string;
  allocatedAmount: string;
  transactionRemaining: string;
  status: string;
  kind: string;
  paymentId: string | null;
  paymentNumber: string | null;
  paymentDate: string | null;
  paymentAmount: string | null;
  paymentMatchedAmount: string | null;
  paymentAvailableAmount: string | null;
  accountingEntryId: string | null;
  accountingEntryNo: string | null;
  accountingPosted: boolean;
  invoices: {
    invoiceId: string;
    invoiceNumber: string | null;
    amount: string;
    total: string;
    outstanding: string;
    paymentStatus: string;
  }[];
  decidedAt: string | null;
  decidedBy: string | null;
  note: string | null;
}

export interface ReconciliationInvoice {
  invoiceId: string;
  invoiceNumber: string | null;
  customerName: string;
  currency: string;
  issueDate: string;
  dueDate: string | null;
  total: string;
  paid: string;
  credited: string;
  outstanding: string;
  paymentStatus: string;
  documentStatus: string;
  accountingPosted: boolean;
}

export interface BankReconciliationReport {
  generatedAt: string;
  companyId: string;
  bankAccount: { id: string; name: string; bankName: string; currency: string; maskedReference: string | null };
  period: { from: string | null; to: string | null };
  summary: {
    transactionCount: number;
    matchedCount: number;
    partiallyMatchedCount: number;
    openCount: number;
    allocatedTotal: string;
    unallocatedTotal: string;
    allocationCount: number;
    partialAllocationCount: number;
    postedPaymentCount: number;
    unpostedPaymentCount: number;
    invoiceCount: number;
    invoicesPaid: number;
    invoicesPartial: number;
    invoicesUnpaid: number;
    invoicesOverpaid: number;
    outstandingByCurrency: { currency: string; amount: string; count: number }[];
    billingReconciledPaymentTotal: string;
    billingUnreconciledPaymentTotal: string;
  };
  simpleReport: BankReport;
  transactions: {
    id: string;
    date: string;
    label: string;
    reference: string | null;
    amount: string;
    currency: string;
    status: string;
    allocatedAmount: string;
    remainingAmount: string;
    allocationCount: number;
    billingPaymentNumbers: string[];
  }[];
  allocations: ReconciliationAllocation[];
  invoices: ReconciliationInvoice[];
}

function amount(value: string | null | undefined): bigint {
  return parseAmount(value ?? '0') ?? 0n;
}

function abs(value: bigint): bigint {
  return value < 0n ? -value : value;
}

export async function bankReconciliationReport(
  db: Db,
  companyId: string,
  bankAccountId: string,
  from?: string | null,
  to?: string | null,
): Promise<BankReconciliationReport> {
  const accountRes = await db.query<any>(
    `SELECT b.*, a.code AS account_code FROM bank_accounts b
       JOIN accounts a ON a.id = b.account_id
      WHERE b.id = $1 AND b.company_id = $2`,
    [bankAccountId, companyId],
  );
  const account = accountRes.rows[0];
  if (!account) throw notFound('BANK_ACCOUNT_NOT_FOUND', 'Bank account not found');

  const txnsRes = await db.query<any>(
    `SELECT t.*,
            COALESCE((SELECT SUM(m.amount) FROM bank_matches m
                       WHERE m.transaction_id = t.id AND m.status = 'confirmed'), 0)::text AS allocated_amount,
            COALESCE((SELECT count(*) FROM bank_matches m
                       WHERE m.transaction_id = t.id AND m.status = 'confirmed'), 0)::int AS allocation_count
       FROM bank_transactions t
      WHERE t.company_id = $1 AND t.bank_account_id = $2
        AND ($3::date IS NULL OR t.txn_date >= $3)
        AND ($4::date IS NULL OR t.txn_date <= $4)
      ORDER BY t.txn_date DESC, t.created_at DESC
      LIMIT 5000`,
    [companyId, bankAccountId, from ?? null, to ?? null],
  );

  const allocationsRes = await db.query<any>(
    `SELECT m.id, m.amount::text, m.status, m.kind, m.decided_at::text, m.note,
            t.id AS transaction_id, t.txn_date::text, t.label, t.reference,
            t.amount::text AS transaction_amount, t.currency AS transaction_currency,
            p.id AS payment_id, p.payment_no, p.payment_date::text, p.amount::text AS payment_amount,
            p.accounting_entry_id,
            e.entry_no,
            u.full_name AS decided_by_name, u.email AS decided_by_email,
            COALESCE(
              (SELECT json_agg(json_build_object(
                        'invoiceId', d.id,
                        'invoiceNumber', d.doc_no,
                        'amount', a.amount::text,
                        'total', d.total_amount::text,
                        'outstanding', (GREATEST(d.total_amount - d.amount_paid - d.credited_amount, 0))::text,
                        'paymentStatus', d.payment_status
                      ) ORDER BY d.doc_no)
                 FROM billing_payment_allocations a
                 JOIN billing_documents d ON d.id = a.invoice_id
                WHERE a.payment_id = p.id),
              '[]'::json
            ) AS invoices
       FROM bank_matches m
       JOIN bank_transactions t ON t.id = m.transaction_id
       LEFT JOIN billing_payments p ON p.id = m.billing_payment_id
       LEFT JOIN journal_entries e ON e.id = COALESCE(m.entry_id, p.accounting_entry_id)
       LEFT JOIN app_users u ON u.id = m.decided_by
      WHERE m.company_id = $1 AND m.bank_account_id = $2 AND m.status = 'confirmed'
        AND ($3::date IS NULL OR t.txn_date >= $3)
        AND ($4::date IS NULL OR t.txn_date <= $4)
      ORDER BY t.txn_date DESC, m.created_at DESC
      LIMIT 10000`,
    [companyId, bankAccountId, from ?? null, to ?? null],
  );

  const paymentMatchedRes = await db.query<any>(
    `SELECT m.billing_payment_id, COALESCE(SUM(m.amount), 0)::text AS matched
       FROM bank_matches m
      WHERE m.company_id = $1 AND m.status = 'confirmed' AND m.billing_payment_id IS NOT NULL
      GROUP BY m.billing_payment_id`,
    [companyId],
  );
  const paymentMatched = new Map<string, bigint>(
    paymentMatchedRes.rows.map((row) => [row.billing_payment_id, amount(row.matched)]),
  );

  const invoiceRes = await db.query<any>(
    `SELECT d.id, d.doc_no, d.customer_name, d.currency, d.issue_date::text, d.due_date::text,
            d.total_amount::text, d.amount_paid::text, d.credited_amount::text,
            d.payment_status, d.status, (d.accounting_entry_id IS NOT NULL) AS accounting_posted
       FROM billing_documents d
      WHERE d.company_id = $1 AND d.kind = 'invoice'
        AND d.status NOT IN ('draft', 'cancelled')
      ORDER BY d.issue_date DESC, d.doc_no DESC
      LIMIT 5000`,
    [companyId],
  );

  const paymentsRes = await db.query<any>(
    `SELECT p.id, p.amount::text, p.accounting_entry_id
       FROM billing_payments p
      WHERE p.company_id = $1 AND p.status = 'recorded'`,
    [companyId],
  );

  const transactions = txnsRes.rows.map((row) => {
    const total = abs(amount(row.amount));
    const allocated = amount(row.allocated_amount);
    const remaining = total - allocated;
    const paymentNumbers = allocationsRes.rows
      .filter((a) => a.transaction_id === row.id && a.payment_no)
      .map((a) => a.payment_no as string);
    return {
      id: row.id,
      date: row.txn_date,
      label: row.label,
      reference: row.reference,
      amount: row.amount,
      currency: row.currency,
      status: row.status,
      allocatedAmount: formatAmount(allocated),
      remainingAmount: formatAmount(remaining > 0n ? remaining : 0n),
      allocationCount: row.allocation_count,
      billingPaymentNumbers: [...new Set(paymentNumbers)],
    };
  });

  const allocations: ReconciliationAllocation[] = allocationsRes.rows.map((row) => {
    const txnTotal = abs(amount(row.transaction_amount));
    const allocated = amount(row.amount);
    const paymentMatchedAmount = row.payment_id ? paymentMatched.get(row.payment_id) ?? 0n : 0n;
    return {
      matchId: row.id,
      transactionId: row.transaction_id,
      transactionDate: row.txn_date,
      transactionLabel: row.label,
      transactionReference: row.reference,
      transactionAmount: formatAmount(txnTotal),
      allocatedAmount: formatAmount(allocated),
      transactionRemaining: formatAmount(
        txnTotal - allocated > 0n ? txnTotal - allocated : 0n,
      ),
      status: row.status,
      kind: row.kind,
      paymentId: row.payment_id,
      paymentNumber: row.payment_no,
      paymentDate: row.payment_date,
      paymentAmount: row.payment_amount ? formatAmount(amount(row.payment_amount)) : null,
      paymentMatchedAmount: row.payment_id ? formatAmount(paymentMatchedAmount) : null,
      paymentAvailableAmount: row.payment_amount
        ? formatAmount(
            amount(row.payment_amount) - paymentMatchedAmount > 0n
              ? amount(row.payment_amount) - paymentMatchedAmount
              : 0n,
          )
        : null,
      accountingEntryId: row.payment_id ? row.accounting_entry_id : null,
      accountingEntryNo: row.entry_no,
      accountingPosted: Boolean(row.payment_id && row.accounting_entry_id),
      invoices: (row.invoices as any[]).map((invoice) => ({
        invoiceId: invoice.invoiceId,
        invoiceNumber: invoice.invoiceNumber,
        amount: formatAmount(amount(invoice.amount)),
        total: formatAmount(amount(invoice.total)),
        outstanding: formatAmount(amount(invoice.outstanding)),
        paymentStatus: invoice.paymentStatus,
      })),
      decidedAt: row.decided_at,
      decidedBy: row.decided_by_name ?? row.decided_by_email ?? null,
      note: row.note,
    };
  });

  const invoices: ReconciliationInvoice[] = invoiceRes.rows.map((row) => {
    const outstanding = amount(row.total_amount) - amount(row.amount_paid) - amount(row.credited_amount);
    return {
      invoiceId: row.id,
      invoiceNumber: row.doc_no,
      customerName: row.customer_name,
      currency: row.currency,
      issueDate: row.issue_date,
      dueDate: row.due_date,
      total: row.total_amount,
      paid: row.amount_paid,
      credited: row.credited_amount,
      outstanding: formatAmount(outstanding > 0n ? outstanding : 0n),
      paymentStatus: row.payment_status,
      documentStatus: row.status,
      accountingPosted: row.accounting_posted,
    };
  });

  const outstandingMap = new Map<string, { amount: bigint; count: number }>();
  for (const invoice of invoices) {
    if (amount(invoice.outstanding) <= 0n) continue;
    const current = outstandingMap.get(invoice.currency) ?? { amount: 0n, count: 0 };
    current.amount += amount(invoice.outstanding);
    current.count += 1;
    outstandingMap.set(invoice.currency, current);
  }

  let billedReconciled = 0n;
  let billedUnreconciled = 0n;
  let postedPaymentCount = 0;
  for (const payment of paymentsRes.rows) {
    const matched = paymentMatched.get(payment.id) ?? 0n;
    billedReconciled += matched;
    const rest = amount(payment.amount) - matched;
    if (rest > 0n) billedUnreconciled += rest;
    if (payment.accounting_entry_id) postedPaymentCount += 1;
  }

  const matchedCount = transactions.filter((t) => t.status === 'matched').length;
  const partiallyMatchedCount = transactions.filter((t) => t.status === 'partially_matched').length;
  const openCount = transactions.filter((t) =>
    ['unmatched', 'proposed', 'review'].includes(t.status),
  ).length;
  const allocatedTotal = transactions.reduce((acc, t) => acc + amount(t.allocatedAmount), 0n);
  const unallocatedTotal = transactions.reduce((acc, t) => acc + amount(t.remainingAmount), 0n);
  const simpleReport = await bankReport(db, companyId, bankAccountId, from, to);

  return {
    generatedAt: new Date().toISOString(),
    companyId,
    bankAccount: {
      id: account.id,
      name: account.name,
      bankName: account.bank_name,
      currency: account.currency,
      maskedReference: account.masked_reference,
    },
    period: { from: from ?? null, to: to ?? null },
    summary: {
      transactionCount: transactions.length,
      matchedCount,
      partiallyMatchedCount,
      openCount,
      allocatedTotal: formatAmount(allocatedTotal),
      unallocatedTotal: formatAmount(unallocatedTotal),
      allocationCount: allocations.length,
      partialAllocationCount: transactions.filter(
        (t) => t.status === 'partially_matched',
      ).length,
      postedPaymentCount,
      unpostedPaymentCount: paymentsRes.rows.length - postedPaymentCount,
      invoiceCount: invoices.length,
      invoicesPaid: invoices.filter((i) => i.paymentStatus === 'paid').length,
      invoicesPartial: invoices.filter((i) => i.paymentStatus === 'partial').length,
      invoicesUnpaid: invoices.filter((i) => i.paymentStatus === 'unpaid').length,
      invoicesOverpaid: invoices.filter((i) => i.paymentStatus === 'overpaid').length,
      outstandingByCurrency: [...outstandingMap.entries()].map(([currency, value]) => ({
        currency,
        amount: formatAmount(value.amount),
        count: value.count,
      })),
      billingReconciledPaymentTotal: formatAmount(billedReconciled),
      billingUnreconciledPaymentTotal: formatAmount(billedUnreconciled),
    },
    simpleReport,
    transactions,
    allocations,
    invoices,
  };
}

export function bankReconciliationReportCsv(
  report: BankReconciliationReport,
  locale: 'fr' | 'en',
): string {
  const fr = locale === 'fr';
  const rows: (string | number | null)[][] = [
    [fr ? 'Rapport de rapprochement avancé' : 'Advanced reconciliation report'],
    [fr ? 'Généré le' : 'Generated at', report.generatedAt],
    [fr ? 'Société' : 'Company', report.companyId],
    [fr ? 'Compte' : 'Account', `${report.bankAccount.name} (${report.bankAccount.bankName})`],
    [fr ? 'Devise' : 'Currency', report.bankAccount.currency],
    [fr ? 'Du' : 'From', report.period.from],
    [fr ? 'Au' : 'To', report.period.to],
    [],
    [fr ? 'Synthèse' : 'Summary'],
    [fr ? 'Transactions' : 'Transactions', report.summary.transactionCount],
    [fr ? 'Rapprochées' : 'Matched', report.summary.matchedCount],
    [fr ? 'Partiellement affectées' : 'Partially allocated', report.summary.partiallyMatchedCount],
    [fr ? 'Ouvertes' : 'Open', report.summary.openCount],
    [fr ? 'Total affecté' : 'Allocated total', report.summary.allocatedTotal],
    [fr ? 'Total non affecté' : 'Unallocated total', report.summary.unallocatedTotal],
    [fr ? 'Règlements comptabilisés' : 'Posted payments', report.summary.postedPaymentCount],
    [fr ? 'Règlements non comptabilisés' : 'Unposted payments', report.summary.unpostedPaymentCount],
    [fr ? 'Factures soldées' : 'Paid invoices', report.summary.invoicesPaid],
    [fr ? 'Factures partiellement réglées' : 'Partially paid invoices', report.summary.invoicesPartial],
    [fr ? 'Factures non réglées' : 'Unpaid invoices', report.summary.invoicesUnpaid],
    [],
    [fr ? 'Affectations confirmées' : 'Confirmed allocations'],
    [
      fr ? 'Date' : 'Date',
      fr ? 'Transaction' : 'Transaction',
      fr ? 'Référence' : 'Reference',
      fr ? 'Montant transaction' : 'Transaction amount',
      fr ? 'Montant affecté' : 'Allocated amount',
      fr ? 'Restant' : 'Remaining',
      fr ? 'Règlement' : 'Payment',
      fr ? 'Client' : 'Customer',
      fr ? 'Factures' : 'Invoices',
      fr ? 'Écriture' : 'Entry',
      fr ? 'Comptabilisé' : 'Posted',
      fr ? 'Validé par' : 'Confirmed by',
      fr ? 'Validé le' : 'Confirmed at',
    ],
    ...report.allocations.map((a) => [
      a.transactionDate,
      a.transactionLabel,
      a.transactionReference,
      a.transactionAmount,
      a.allocatedAmount,
      a.transactionRemaining,
      a.paymentNumber,
      a.invoices.map((i) => i.invoiceNumber ?? i.invoiceId).join(' | '),
      a.accountingEntryNo,
      a.accountingPosted ? (fr ? 'Oui' : 'Yes') : (fr ? 'Non' : 'No'),
      a.decidedBy,
      a.decidedAt,
    ]),
    [],
    [fr ? 'Factures' : 'Invoices'],
    [
      fr ? 'Numéro' : 'Number',
      fr ? 'Client' : 'Customer',
      fr ? 'Devise' : 'Currency',
      fr ? 'Total' : 'Total',
      fr ? 'Réglé' : 'Paid',
      fr ? 'Crédité' : 'Credited',
      fr ? 'Restant dû' : 'Outstanding',
      fr ? 'Statut paiement' : 'Payment status',
      fr ? 'Écriture comptable' : 'Accounting entry',
    ],
    ...report.invoices.map((i) => [
      i.invoiceNumber,
      i.customerName,
      i.currency,
      i.total,
      i.paid,
      i.credited,
      i.outstanding,
      i.paymentStatus,
      i.accountingPosted ? (fr ? 'Oui' : 'Yes') : (fr ? 'Non' : 'No'),
    ]),
  ];
  return toCsv(rows);
}
