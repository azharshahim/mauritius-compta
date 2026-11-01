import type { Db } from '../../db/index.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { formatAmount, parseAmount } from '../../lib/money.js';
import { cabinetOfCompany } from '../../lib/cabinets.js';
import { writeAudit } from '../../lib/audit.js';
import {
  formatDocumentNumber,
  nextBillingNumber,
  refreshInvoiceBalance,
} from '../billing/service.js';

/**
 * Mission 10 - bank statement <-> billing payments.
 *
 * This module links a bank transaction to an **already recorded** customer
 * payment. It never creates an invoice, never creates a second payment and
 * never posts to the ledger: accounting stays a separate, human-triggered
 * action through the existing AI proposal engine.
 *
 * All amounts are exact decimals (numeric(20,4) in PostgreSQL, bigint in JS).
 * A bank transaction can fund several payments (1 <-> n) and a payment can be
 * funded by several bank transactions (n <-> 1), but the sum of confirmed
 * allocations can never exceed either side.
 */

interface TxnRow {
  id: string;
  cabinet_id: string;
  company_id: string;
  bank_account_id: string;
  txn_date: string;
  label: string;
  reference: string | null;
  amount: string;
  currency: string;
  status: string;
}

interface PaymentRow {
  matched_amount?: string;
  id: string;
  company_id: string;
  customer_id: string;
  payment_no: string;
  payment_date: string;
  value_date: string | null;
  amount: string;
  currency: string;
  method: string;
  reference: string | null;
  unallocated_amount: string;
  status: string;
  accounting_entry_id: string | null;
  customer_name?: string;
}

export interface BillingAllocationView {
  invoiceId: string;
  invoiceNumber: string | null;
  amount: string;
  invoiceTotal: string;
  invoicePaid: string;
  invoiceCredited: string;
  invoiceOutstanding: string;
  invoiceStatus: string;
  invoicePaymentStatus: string;
  currency: string;
}

export interface BillingPaymentCandidate {
  paymentId: string;
  paymentNumber: string;
  paymentDate: string;
  amount: string;
  currency: string;
  method: string;
  reference: string | null;
  customerId: string;
  customerName: string;
  unallocatedAmount: string;
  accountingEntryId: string | null;
  accountingPosted: boolean;
  matchedAmount: string;
  availableAmount: string;
  suggestedAmount: string;
  confidence: number;
  reasons: { code: string; fr: string; en: string }[];
  issues: { code: string; fr: string; en: string; blocking: boolean }[];
  allocations: BillingAllocationView[];
  alreadyLinkedToTransaction: boolean;
}

function amountOf(value: string | null | undefined): bigint {
  return parseAmount(value ?? '0') ?? 0n;
}

function min(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}

function abs(value: bigint): bigint {
  return value < 0n ? -value : value;
}

function normalize(value: string | null | undefined): string {
  return (value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function daysBetween(a: string, b: string): number {
  const left = Date.parse(`${a}T00:00:00Z`);
  const right = Date.parse(`${b}T00:00:00Z`);
  if (Number.isNaN(left) || Number.isNaN(right)) return 9999;
  return Math.round(Math.abs(left - right) / 86_400_000);
}

async function loadTransaction(db: Db, companyId: string, transactionId: string, lock = false) {
  const res = await db.query<TxnRow>(
    `SELECT * FROM bank_transactions WHERE id = $1 AND company_id = $2${lock ? ' FOR UPDATE' : ''}`,
    [transactionId, companyId],
  );
  const txn = res.rows[0];
  if (!txn) throw notFound('BANK_TRANSACTION_NOT_FOUND', 'Bank transaction not found');
  return txn;
}

export async function transactionAllocatedAmount(
  db: Db,
  transactionId: string,
): Promise<bigint> {
  const res = await db.query<{ total: string }>(
    `SELECT COALESCE(SUM(amount), 0)::text AS total
       FROM bank_matches
      WHERE transaction_id = $1 AND status = 'confirmed'`,
    [transactionId],
  );
  return amountOf(res.rows[0]?.total);
}

export async function paymentMatchedAmount(db: Db, paymentId: string): Promise<bigint> {
  const res = await db.query<{ total: string }>(
    `SELECT COALESCE(SUM(amount), 0)::text AS total
       FROM bank_matches
      WHERE billing_payment_id = $1 AND status = 'confirmed'`,
    [paymentId],
  );
  return amountOf(res.rows[0]?.total);
}

async function loadPaymentAllocations(
  db: Db,
  companyId: string,
  paymentId: string,
): Promise<BillingAllocationView[]> {
  const res = await db.query<any>(
    `SELECT a.invoice_id, a.amount::text, d.doc_no, d.total_amount::text, d.amount_paid::text,
            d.credited_amount::text, d.status, d.payment_status, d.currency
       FROM billing_payment_allocations a
       JOIN billing_documents d ON d.id = a.invoice_id AND d.company_id = $2
      WHERE a.payment_id = $1
      ORDER BY d.issue_date, d.doc_no`,
    [paymentId, companyId],
  );
  return res.rows.map((row) => {
    const total = amountOf(row.total_amount);
    const paid = amountOf(row.amount_paid);
    const credited = amountOf(row.credited_amount);
    const outstanding = total - paid - credited;
    return {
      invoiceId: row.invoice_id,
      invoiceNumber: row.doc_no,
      amount: row.amount,
      invoiceTotal: row.total_amount,
      invoicePaid: row.amount_paid,
      invoiceCredited: row.credited_amount,
      invoiceOutstanding: formatAmount(outstanding > 0n ? outstanding : 0n),
      invoiceStatus: row.status,
      invoicePaymentStatus: row.payment_status,
      currency: row.currency,
    };
  });
}

/**
 * Deterministic candidates for a bank transaction. No AI provider is called.
 * The caller decides; nothing is written.
 */
export async function billingPaymentCandidates(
  db: Db,
  companyId: string,
  transactionId: string,
): Promise<{
  transactionRemaining: string;
  allocatedAmount: string;
  candidates: BillingPaymentCandidate[];
}> {
  const txn = await loadTransaction(db, companyId, transactionId);
  const txnAmount = abs(amountOf(txn.amount));
  const allocated = await transactionAllocatedAmount(db, txn.id);
  const remaining = txnAmount - allocated > 0n ? txnAmount - allocated : 0n;

  const res = await db.query<PaymentRow & { customer_name: string }>(
    `SELECT p.*, c.name AS customer_name,
            (SELECT COALESCE(SUM(m.amount), 0)::text FROM bank_matches m
              WHERE m.billing_payment_id = p.id AND m.status = 'confirmed') AS matched_amount
       FROM billing_payments p
       JOIN billing_customers c ON c.id = p.customer_id AND c.company_id = p.company_id
      WHERE p.company_id = $1 AND p.status = 'recorded' AND p.currency = $2
      ORDER BY p.payment_date DESC, p.payment_no DESC
      LIMIT 200`,
    [companyId, txn.currency],
  );

  const candidates: BillingPaymentCandidate[] = [];
  for (const payment of res.rows) {
    const allocations = await loadPaymentAllocations(db, companyId, payment.id);
    const paymentAmount = amountOf(payment.amount);
    const matched = amountOf(payment.matched_amount);
    const available = paymentAmount - matched > 0n ? paymentAmount - matched : 0n;
    const linked = await db.query<{ id: string; amount: string }>(
      `SELECT id, amount::text FROM bank_matches
        WHERE transaction_id = $1 AND billing_payment_id = $2 AND status = 'confirmed'`,
      [txn.id, payment.id],
    );
    const alreadyLinked = Boolean(linked.rows[0]);
    const suggested = min(remaining, available);
    const issues: BillingPaymentCandidate['issues'] = [];
    const reasons: BillingPaymentCandidate['reasons'] = [];
    let confidence = 0.25;

    if (amountOf(txn.amount) < 0n) {
      issues.push({
        code: 'DIRECTION_MISMATCH',
        fr: 'Cette transaction est un décaissement : elle ne peut pas financer un encaissement client.',
        en: 'This transaction is money out: it cannot fund a customer receipt.',
        blocking: true,
      });
    }
    if (allocations.length === 0) {
      issues.push({
        code: 'NO_INVOICE_ALLOCATION',
        fr: 'Ce règlement n’est affecté à aucune facture : le rapprochement ne prouverait aucun règlement de facture.',
        en: 'This payment is not allocated to any invoice: reconciliation would not prove any invoice settlement.',
        blocking: true,
      });
    }
    if (available === 0n) {
      issues.push({
        code: 'PAYMENT_FULLY_ALLOCATED',
        fr: 'Ce règlement est déjà rapproché à hauteur de son montant total.',
        en: 'This payment is already reconciled up to its full amount.',
        blocking: true,
      });
    }
    if (remaining === 0n && !alreadyLinked) {
      issues.push({
        code: 'TRANSACTION_FULLY_ALLOCATED',
        fr: 'Cette transaction est déjà affectée à hauteur de son montant total.',
        en: 'This transaction is already allocated up to its full amount.',
        blocking: true,
      });
    }
    if (suggested > 0n && suggested < remaining) {
      issues.push({
        code: 'PARTIAL_AMOUNT',
        fr: `Affectation partielle proposée : ${formatAmount(suggested)} sur ${formatAmount(remaining)} restants.`,
        en: `Suggested partial allocation: ${formatAmount(suggested)} of ${formatAmount(remaining)} remaining.`,
        blocking: false,
      });
    }

    const haystack = normalize(
      `${txn.label} ${txn.reference ?? ''} ${payment.reference ?? ''} ${allocations
        .map((a) => a.invoiceNumber ?? '')
        .join(' ')}`,
    );
    for (const allocation of allocations) {
      if (allocation.invoiceNumber && haystack.includes(normalize(allocation.invoiceNumber))) {
        confidence += 0.25;
        reasons.push({
          code: 'INVOICE_REFERENCE',
          fr: `Référence de facture ${allocation.invoiceNumber} présente dans le libellé.`,
          en: `Invoice reference ${allocation.invoiceNumber} found in the label.`,
        });
        break;
      }
    }
    if (payment.reference && haystack.includes(normalize(payment.reference))) {
      confidence += 0.15;
      reasons.push({
        code: 'PAYMENT_REFERENCE',
        fr: 'Référence du règlement présente dans le libellé bancaire.',
        en: 'Payment reference found in the bank label.',
      });
    }
    if (payment.customer_name && haystack.includes(normalize(payment.customer_name))) {
      confidence += 0.1;
      reasons.push({
        code: 'CUSTOMER_NAME',
        fr: 'Nom du client présent dans le libellé.',
        en: 'Customer name found in the label.',
      });
    }
    if (suggested > 0n && (suggested === remaining || suggested === available)) {
      confidence += 0.2;
      reasons.push({
        code: 'AMOUNT_MATCH',
        fr: 'Le montant proposé correspond exactement au restant disponible d’un des deux côtés.',
        en: 'The suggested amount exactly matches the remaining amount on one side.',
      });
    }
    const gap = daysBetween(txn.txn_date, payment.payment_date);
    if (gap <= 7) {
      confidence += 0.1;
      reasons.push({
        code: 'DATE_PROXIMITY',
        fr: `Dates à ${gap} jour(s) d’écart.`,
        en: `Dates ${gap} day(s) apart.`,
      });
    } else if (gap <= 45) {
      confidence += 0.05;
    }
    if (allocations.some((a) => a.invoicePaymentStatus !== 'paid')) {
      reasons.push({
        code: 'INVOICE_NOT_SETTLED',
        fr: 'La facture n’est pas intégralement soldée : le restant dû reste visible.',
        en: 'The invoice is not fully settled: the outstanding balance remains visible.',
      });
    }
    if (payment.accounting_entry_id) {
      reasons.push({
        code: 'ACCOUNTING_ALREADY_POSTED',
        fr: 'Le règlement est déjà comptabilisé : le rapprochement ne créera aucune seconde écriture.',
        en: 'The payment is already posted: reconciliation will not create a second entry.',
      });
    } else {
      reasons.push({
        code: 'ACCOUNTING_PENDING',
        fr: 'Le règlement n’est pas comptabilisé : une action humaine distincte restera nécessaire.',
        en: 'The payment is not posted: a separate human action will still be required.',
      });
    }

    candidates.push({
      paymentId: payment.id,
      paymentNumber: payment.payment_no,
      paymentDate: payment.payment_date,
      amount: payment.amount,
      currency: payment.currency,
      method: payment.method,
      reference: payment.reference,
      customerId: payment.customer_id,
      customerName: payment.customer_name,
      unallocatedAmount: payment.unallocated_amount,
      accountingEntryId: payment.accounting_entry_id,
      accountingPosted: Boolean(payment.accounting_entry_id),
      matchedAmount: formatAmount(matched),
      availableAmount: formatAmount(available),
      suggestedAmount: formatAmount(suggested),
      confidence: Math.round(Math.min(1, confidence) * 100) / 100,
      reasons,
      issues,
      allocations,
      alreadyLinkedToTransaction: alreadyLinked,
    });
  }

  candidates.sort((a, b) => {
    if (a.alreadyLinkedToTransaction !== b.alreadyLinkedToTransaction) return a.alreadyLinkedToTransaction ? 1 : -1;
    const aBlocked = a.issues.some((i) => i.blocking);
    const bBlocked = b.issues.some((i) => i.blocking);
    if (aBlocked !== bBlocked) return aBlocked ? 1 : -1;
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    return a.paymentDate < b.paymentDate ? 1 : -1;
  });

  return {
    transactionRemaining: formatAmount(remaining),
    allocatedAmount: formatAmount(allocated),
    candidates,
  };
}

export interface LinkBillingPaymentInput {
  paymentId: string;
  amount: string;
  confirm: boolean;
  note?: string | null;
}

/**
 * Confirms one allocation. Idempotent for an identical repeated request;
 * conflicting amounts or targets are rejected. Rows are locked before any
 * check so two concurrent users cannot over-allocate.
 */
export async function linkBankBillingPayment(
  db: Db,
  actor: { userId: string; companyId: string; ip?: string },
  transactionId: string,
  input: LinkBillingPaymentInput,
): Promise<{
  match: Record<string, unknown>;
  transaction: TxnRow;
  payment: BillingPaymentCandidate;
  idempotent: boolean;
}> {
  if (!input.confirm) {
    throw badRequest('BANK_CONFIRMATION_REQUIRED', 'Explicit human confirmation is required');
  }
  const requested = parseAmount(input.amount);
  if (requested === null || requested <= 0n) {
    throw badRequest('BANK_INVALID_AMOUNT', 'The amount must be a positive decimal');
  }

  const result = await db.transaction(async (tx) => {
    const txn = await loadTransaction(tx, actor.companyId, transactionId, true);
    if (txn.status === 'cancelled' || txn.status === 'excluded') {
      throw conflict('BANK_TRANSACTION_CLOSED', 'This transaction is closed');
    }

    const paymentRes = await tx.query<PaymentRow>(
      `SELECT p.*, c.name AS customer_name
         FROM billing_payments p
         JOIN billing_customers c ON c.id = p.customer_id AND c.company_id = p.company_id
        WHERE p.id = $1 AND p.company_id = $2 FOR UPDATE`,
      [input.paymentId, actor.companyId],
    );
    const payment = paymentRes.rows[0];
    if (!payment) throw notFound('PAYMENT_NOT_FOUND', 'Payment not found');
    if (payment.status !== 'recorded') {
      throw conflict('PAYMENT_CANCELLED', 'A cancelled payment cannot be reconciled');
    }
    if (payment.currency !== txn.currency) {
      throw conflict(
        'BANK_CURRENCY_MISMATCH',
        `Currency mismatch: bank transaction ${txn.currency}, payment ${payment.currency}`,
      );
    }
    if (amountOf(txn.amount) < 0n) {
      throw conflict('BANK_DIRECTION_MISMATCH', 'A debit cannot fund a customer receipt');
    }

    const existing = await tx.query<{ id: string; amount: string }>(
      `SELECT id, amount::text FROM bank_matches
        WHERE transaction_id = $1 AND billing_payment_id = $2 AND status = 'confirmed'`,
      [txn.id, payment.id],
    );
    if (existing.rows[0]) {
      if (amountOf(existing.rows[0].amount) !== requested) {
        throw conflict(
          'BANK_LINK_ALREADY_EXISTS',
          'This transaction is already linked to this payment for another amount',
        );
      }
      const allocations = await loadPaymentAllocations(tx, actor.companyId, payment.id);
      return {
        match: { ...existing.rows[0], status: 'confirmed', idempotent: true },
        transaction: txn,
        payment,
        allocations,
        idempotent: true,
      };
    }

    const allocations = await loadPaymentAllocations(tx, actor.companyId, payment.id);
    if (allocations.length === 0) {
      throw conflict(
        'PAYMENT_NOT_ALLOCATED',
        'This payment is not allocated to any invoice: reconcile the invoice allocation first',
      );
    }

    const txnAllocated = await transactionAllocatedAmount(tx, txn.id);
    const txnRemaining = abs(amountOf(txn.amount)) - txnAllocated;
    if (requested > txnRemaining) {
      throw conflict(
        'BANK_AMOUNT_EXCEEDS_TRANSACTION',
        `Requested ${formatAmount(requested)}, transaction remaining ${formatAmount(txnRemaining > 0n ? txnRemaining : 0n)}`,
      );
    }
    const paymentMatched = await paymentMatchedAmount(tx, payment.id);
    const paymentRemaining = amountOf(payment.amount) - paymentMatched;
    if (requested > paymentRemaining) {
      throw conflict(
        'BANK_AMOUNT_EXCEEDS_PAYMENT',
        `Requested ${formatAmount(requested)}, payment remaining ${formatAmount(paymentRemaining > 0n ? paymentRemaining : 0n)}`,
      );
    }

    const cabinetId = await cabinetOfCompany(tx, actor.companyId);
    if (!cabinetId) throw badRequest('BANK_COMPANY_NOT_IN_CABINET', 'This company is not attached to a cabinet');
    const entryId = payment.accounting_entry_id ?? null;
    const singleInvoice = allocations.length === 1 ? allocations[0]!.invoiceId : null;
    const inserted = await tx.query<Record<string, unknown>>(
      `INSERT INTO bank_matches
         (cabinet_id, company_id, bank_account_id, transaction_id, entry_id, entry_line_id,
          billing_payment_id, billing_invoice_id, amount, status, kind, confidence, reasons,
          note, created_by, decided_by, decided_at)
       VALUES ($1,$2,$3,$4,$5,NULL,$6,$7,$8,'confirmed','invoice',$9,$10::jsonb,$11,$12,$12,now())
       RETURNING *`,
      [
        cabinetId,
        actor.companyId,
        txn.bank_account_id,
        txn.id,
        entryId,
        payment.id,
        singleInvoice,
        formatAmount(requested),
        allocations.some((a) => a.invoicePaymentStatus !== 'paid') ? 0.9 : 1,
        JSON.stringify([
          {
            code: 'HUMAN_CONFIRMATION',
            fr: 'Rapprochement bancaire validé explicitement par un humain.',
            en: 'Bank reconciliation explicitly confirmed by a human.',
          },
          {
            code: 'ACCOUNTING_SEPARATE',
            fr: 'Le rapprochement bancaire ne comptabilise rien : la comptabilisation reste une action distincte.',
            en: 'Bank reconciliation posts nothing: accounting remains a separate action.',
          },
        ]),
        input.note ?? null,
        actor.userId,
      ],
    );

    const total = txnAllocated + requested;
    const txnTotal = abs(amountOf(txn.amount));
    const status = total >= txnTotal ? 'matched' : 'partially_matched';
    const updated = await tx.query<TxnRow>(
      `UPDATE bank_transactions SET status = $2, updated_at = now()
        WHERE id = $1 RETURNING *`,
      [txn.id, status],
    );
    return {
      match: inserted.rows[0]!,
      transaction: updated.rows[0]!,
      payment,
      allocations,
      idempotent: false,
    };
  });

  await db.query(
    `INSERT INTO bank_events (cabinet_id, company_id, entity, entity_id, event, actor_id, ip, metadata)
     VALUES ((SELECT cabinet_id FROM bank_transactions WHERE id = $1), $2, 'bank_transaction', $1,
             $3, $4, $5, $6::jsonb)`,
    [
      transactionId,
      actor.companyId,
      result.idempotent ? 'billing.link.idempotent' : 'billing.link.confirmed',
      actor.userId,
      actor.ip ?? null,
      JSON.stringify({
        paymentId: input.paymentId,
        amount: formatAmount(requested),
        accountingEntryId: result.payment.accounting_entry_id,
      }),
    ],
  );

  const matchedAmount = await paymentMatchedAmount(db, result.payment.id);
  const available = amountOf(result.payment.amount) - matchedAmount;
  const candidate: BillingPaymentCandidate = {
    paymentId: result.payment.id,
    paymentNumber: result.payment.payment_no,
    paymentDate: result.payment.payment_date,
    amount: result.payment.amount,
    currency: result.payment.currency,
    method: result.payment.method,
    reference: result.payment.reference,
    customerId: result.payment.customer_id,
    customerName: result.payment.customer_name ?? '',
    unallocatedAmount: result.payment.unallocated_amount,
    accountingEntryId: result.payment.accounting_entry_id,
    accountingPosted: Boolean(result.payment.accounting_entry_id),
    matchedAmount: formatAmount(matchedAmount),
    availableAmount: formatAmount(available > 0n ? available : 0n),
    suggestedAmount: formatAmount(available > 0n ? available : 0n),
    confidence: 1,
    reasons: [],
    issues: [],
    allocations: result.allocations,
    alreadyLinkedToTransaction: true,
  };

  return {
    match: result.match,
    transaction: result.transaction,
    payment: candidate,
    idempotent: result.idempotent,
  };
}

/**
 * Rejects a confirmed allocation without deleting it. The row stays for audit
 * and the bank transaction status is recomputed from the remaining confirmed
 * allocations. If the payment was already posted, the journal entry is left
 * untouched: reversing it remains a separate accounting action.
 */
export async function unlinkBankBillingPayment(
  db: Db,
  actor: { userId: string; companyId: string; ip?: string },
  transactionId: string,
  paymentId: string,
  confirm: boolean,
  reason: string | null,
): Promise<{ match: Record<string, unknown>; transaction: TxnRow }> {
  if (!confirm) {
    throw badRequest('BANK_CONFIRMATION_REQUIRED', 'Explicit human confirmation is required');
  }
  const result = await db.transaction(async (tx) => {
    const txn = await loadTransaction(tx, actor.companyId, transactionId, true);
    const found = await tx.query<{ id: string; amount: string }>(
      `SELECT id, amount::text FROM bank_matches
        WHERE transaction_id = $1 AND billing_payment_id = $2
          AND company_id = $3 AND status = 'confirmed'
        FOR UPDATE`,
      [txn.id, paymentId, actor.companyId],
    );
    const match = found.rows[0];
    if (!match) throw notFound('BANK_MATCH_NOT_FOUND', 'No confirmed link for this payment');
    const updated = await tx.query(
      `UPDATE bank_matches
          SET status = 'rejected', decided_by = $2, decided_at = now(), note = $3, updated_at = now()
        WHERE id = $1 RETURNING *`,
      [match.id, actor.userId, reason],
    );
    const remaining = await tx.query<{ total: string }>(
      `SELECT COALESCE(SUM(amount), 0)::text AS total FROM bank_matches
        WHERE transaction_id = $1 AND status = 'confirmed'`,
      [txn.id],
    );
    const allocated = amountOf(remaining.rows[0]?.total);
    const total = abs(amountOf(txn.amount));
    const status = allocated === 0n ? 'unmatched' : allocated >= total ? 'matched' : 'partially_matched';
    const txnUpdated = await tx.query<TxnRow>(
      `UPDATE bank_transactions SET status = $2, updated_at = now() WHERE id = $1 RETURNING *`,
      [txn.id, status],
    );
    return { match: updated.rows[0]!, transaction: txnUpdated.rows[0]! };
  });

  await db.query(
    `INSERT INTO bank_events (cabinet_id, company_id, entity, entity_id, event, actor_id, ip, metadata)
     VALUES ((SELECT cabinet_id FROM bank_transactions WHERE id = $1), $2, 'bank_transaction', $1,
             'billing.link.rejected', $3, $4, $5::jsonb)`,
    [
      transactionId,
      actor.companyId,
      actor.userId,
      actor.ip ?? null,
      JSON.stringify({ paymentId, reason, amount: result.match.amount }),
    ],
  );
  return result;
}

// ---------------------------------------------------------------------------
// Mission 43, C-04: turn a bank receipt into a customer payment.
// ---------------------------------------------------------------------------

export interface CreateBillingPaymentFromBankInput {
  confirm: true;
  customerId: string;
  allocations: { invoiceId: string; amount: string }[];
  paymentDate?: string | null;
  reference?: string | null;
  exchangeRate?: string | null;
  note?: string | null;
}

/**
 * Creates a customer payment **from the existing billing tables** and links it
 * to the bank transaction in the same database transaction.
 *
 * - The payment is never posted automatically: accounting stays a separate
 *   human action through the existing proposal engine (`entryCreated: false`).
 * - A transaction already linked to a confirmed customer payment is returned
 *   as an idempotent result, never duplicated.
 * - Allocations are checked against the live invoice outstanding and the
 *   remaining amount of the bank transaction.
 */
export async function createBillingPaymentFromBankTransaction(
  db: Db,
  actor: { userId: string; companyId: string; ip?: string },
  transactionId: string,
  input: CreateBillingPaymentFromBankInput,
): Promise<{
  payment: BillingPaymentCandidate;
  transaction: TxnRow;
  match: Record<string, unknown>;
  allocations: BillingAllocationView[];
  idempotent: boolean;
  entryCreated: false;
}> {
  if (!input.confirm) {
    throw badRequest('BANK_CONFIRMATION_REQUIRED', 'Explicit human confirmation is required');
  }
  const requested = input.allocations ?? [];
  if (requested.length === 0) {
    throw badRequest('PAYMENT_NOT_ALLOCATED', 'At least one invoice allocation is required');
  }
  if (new Set(requested.map((a) => a.invoiceId)).size !== requested.length) {
    throw badRequest('ALLOCATION_INVALID', 'The same invoice is allocated twice in one payment');
  }
  const allocationAmounts = requested.map((a) => {
    const value = parseAmount(a.amount);
    if (value === null || value <= 0n) throw badRequest('ALLOCATION_INVALID', 'An allocation must be greater than zero');
    return { invoiceId: a.invoiceId, amount: value };
  });
  const total = allocationAmounts.reduce((sum, a) => sum + a.amount, 0n);
  const result = await db.transaction(async (tx) => {
    const txn = await loadTransaction(tx, actor.companyId, transactionId, true);
    if (txn.status === 'cancelled' || txn.status === 'excluded') {
      throw conflict('BANK_TRANSACTION_CLOSED', 'This transaction is closed');
    }
    if (amountOf(txn.amount) <= 0n) {
      throw conflict('BANK_DIRECTION_MISMATCH', 'A bank debit cannot become a customer receipt');
    }

    const already = await tx.query<{ payment_id: string }>(
      `SELECT billing_payment_id AS payment_id FROM bank_matches
        WHERE transaction_id = $1 AND status = 'confirmed' AND billing_payment_id IS NOT NULL
        ORDER BY created_at LIMIT 1`,
      [txn.id],
    );
    if (already.rows[0]) {
      const existing = await tx.query<PaymentRow>(
        `SELECT p.*, c.name AS customer_name FROM billing_payments p
           JOIN billing_customers c ON c.id = p.customer_id AND c.company_id = p.company_id
          WHERE p.id = $1 AND p.company_id = $2`,
        [already.rows[0].payment_id, actor.companyId],
      );
      if (!existing.rows[0]) throw conflict('BANK_LINK_ALREADY_EXISTS', 'This transaction is already linked');
      return {
        paymentRow: existing.rows[0]!,
        allocations: await loadPaymentAllocations(tx, actor.companyId, already.rows[0].payment_id),
        transaction: txn,
        idempotent: true,
      };
    }

    const customer = await tx.query<any>(
      `SELECT * FROM billing_customers WHERE id = $1 AND company_id = $2 FOR UPDATE`,
      [input.customerId, actor.companyId],
    );
    const customerRow = customer.rows[0];
    if (!customerRow) throw notFound('CUSTOMER_NOT_FOUND', 'Customer not found');
    if (!customerRow.is_active) throw conflict('DOCUMENT_STATUS_INVALID', 'This customer is archived');

    const currency = txn.currency;
    const company = await tx.query<{ functional_currency: string }>(
      `SELECT functional_currency FROM companies WHERE id = $1`,
      [actor.companyId],
    );
    const functional = company.rows[0]?.functional_currency ?? 'MUR';

    const invoiceLocked: { id: string; docNo: string | null }[] = [];
    for (const allocation of [...allocationAmounts].sort((a, b) => a.invoiceId.localeCompare(b.invoiceId))) {
      const invoice = await tx.query<any>(
        `SELECT * FROM billing_documents
          WHERE id = $1 AND company_id = $2 AND kind = 'invoice' FOR UPDATE`,
        [allocation.invoiceId, actor.companyId],
      );
      const row = invoice.rows[0];
      if (!row) throw notFound('DOCUMENT_NOT_FOUND', 'Invoice not found');
      if (row.customer_id !== customerRow.id) {
        throw badRequest('ALLOCATION_INVALID', 'The invoice belongs to another customer');
      }
      if (!['issued', 'partially_paid'].includes(row.status)) {
        throw conflict('ALLOCATION_INVALID', `Invoice ${row.doc_no ?? ''} is not open for payment`);
      }
      if (row.currency !== currency) {
        throw badRequest('CURRENCY_MISMATCH', 'The payment currency must match the invoice currency');
      }
      const outstanding =
        amountOf(row.total_amount) - amountOf(row.amount_paid) - amountOf(row.credited_amount);
      if (allocation.amount > outstanding) {
        throw conflict('ALLOCATION_EXCEEDS_INVOICE', 'The allocation exceeds the outstanding amount', {
          invoiceId: row.id,
          outstanding: formatAmount(outstanding > 0n ? outstanding : 0n),
          requested: formatAmount(allocation.amount),
        });
      }
      invoiceLocked.push({ id: row.id, docNo: row.doc_no });
    }

    let exchangeRate = '1';
    if (currency !== functional) {
      if (!input.exchangeRate) {
        throw badRequest('EXCHANGE_RATE_REQUIRED', `An exchange rate is required for a payment in ${currency}`);
      }
      const rate = parseAmount(input.exchangeRate);
      if (rate <= 0n) {
        throw badRequest('EXCHANGE_RATE_REQUIRED', `An exchange rate is required for a payment in ${currency}`);
      }
      exchangeRate = input.exchangeRate;
    }

    const txnAllocated = await transactionAllocatedAmount(tx, txn.id);
    const txnRemaining = amountOf(txn.amount) - txnAllocated;
    if (total > txnRemaining) {
      throw conflict(
        'BANK_AMOUNT_EXCEEDS_TRANSACTION',
        `Requested ${formatAmount(total)}, transaction remaining ${formatAmount(txnRemaining > 0n ? txnRemaining : 0n)}`,
      );
    }

    const paymentDate = input.paymentDate ? String(input.paymentDate).slice(0, 10) : txn.txn_date;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(paymentDate)) {
      throw badRequest('VALIDATION_ERROR', 'paymentDate must be an ISO date');
    }
    const settings = await tx.query<any>('SELECT * FROM billing_settings WHERE company_id = $1', [actor.companyId]);
    const policy: 'yearly' | 'continuous' = settings.rows[0]?.numbering_policy ?? 'yearly';
    const year = policy === 'continuous' ? 0 : Number(paymentDate.slice(0, 4));
    const no = await nextBillingNumber(tx, actor.companyId, 'payment', year);
    const paymentNo = formatDocumentNumber('REC', year, no, policy === 'continuous');

    const inserted = await tx.query<PaymentRow>(
      `INSERT INTO billing_payments
         (company_id, customer_id, payment_no, payment_date, value_date, amount, currency,
          exchange_rate, method, reference, unallocated_amount, status, sequence_year, sequence_no, created_by)
       VALUES ($1,$2,$3,$4,NULL,$5,$6,$7,'bank_transfer',$8,'0.0000','recorded',$9,$10,$11)
       RETURNING *`,
      [
        actor.companyId,
        customerRow.id,
        paymentNo,
        paymentDate,
        formatAmount(total),
        currency,
        exchangeRate,
        input.reference?.trim() || txn.reference || txn.label,
        year,
        no,
        actor.userId,
      ],
    );
    const payment = inserted.rows[0]!;
    for (const allocation of allocationAmounts) {
      await tx.query(
        `INSERT INTO billing_payment_allocations (payment_id, invoice_id, company_id, amount, allocated_date)
         VALUES ($1,$2,$3,$4,$5)`,
        [payment.id, allocation.invoiceId, actor.companyId, formatAmount(allocation.amount), paymentDate],
      );
      await refreshInvoiceBalance(tx, actor.companyId, allocation.invoiceId);
    }

    const cabinetId = await cabinetOfCompany(tx, actor.companyId);
    if (!cabinetId) throw badRequest('BANK_COMPANY_NOT_IN_CABINET', 'This company is not attached to a cabinet');
    const singleInvoice = invoiceLocked.length === 1 ? invoiceLocked[0]!.id : null;
    const match = await tx.query<Record<string, unknown>>(
      `INSERT INTO bank_matches
         (cabinet_id, company_id, bank_account_id, transaction_id, entry_id, entry_line_id,
          billing_payment_id, billing_invoice_id, amount, status, kind, confidence, reasons,
          note, created_by, decided_by, decided_at)
       VALUES ($1,$2,$3,$4,NULL,NULL,$5,$6,$7,'confirmed','invoice',1,$8::jsonb,$9,$10,$10,now())
       RETURNING *`,
      [
        cabinetId,
        actor.companyId,
        txn.bank_account_id,
        txn.id,
        payment.id,
        singleInvoice,
        formatAmount(total),
        JSON.stringify([
          {
            code: 'HUMAN_CONFIRMATION',
            fr: 'Règlement créé et rapproché après confirmation humaine explicite.',
            en: 'Payment created and reconciled after explicit human confirmation.',
          },
          {
            code: 'ACCOUNTING_SEPARATE',
            fr: 'Aucune écriture comptable automatique : la comptabilisation reste une action séparée via le moteur existant.',
            en: 'No automatic journal entry: posting remains a separate action through the existing engine.',
          },
        ]),
        input.note ?? null,
        actor.userId,
      ],
    );

    const newAllocated = txnAllocated + total;
    const txnTotal = amountOf(txn.amount);
    const status = newAllocated >= txnTotal ? 'matched' : 'partially_matched';
    const updatedTxn = await tx.query<TxnRow>(
      `UPDATE bank_transactions SET status = $2, updated_at = now() WHERE id = $1 RETURNING *`,
      [txn.id, status],
    );
    return {
      paymentRow: { ...payment, customer_name: customerRow.name },
      allocations: await loadPaymentAllocations(tx, actor.companyId, payment.id),
      transaction: updatedTxn.rows[0]!,
      idempotent: false,
      match: match.rows[0]!,
    };
  });

  await db.query(
    `INSERT INTO bank_events (cabinet_id, company_id, entity, entity_id, event, actor_id, ip, metadata)
     VALUES ((SELECT cabinet_id FROM bank_transactions WHERE id = $1), $2, 'bank_transaction', $1,
             $3, $4, $5, $6::jsonb)`,
    [
      transactionId,
      actor.companyId,
      result.idempotent ? 'billing.payment.idempotent' : 'billing.payment.created',
      actor.userId,
      actor.ip ?? null,
      JSON.stringify({
        paymentId: result.paymentRow.id,
        amount: result.paymentRow.amount,
        entryCreated: false,
      }),
    ],
  );
  await writeAudit(db, {
    companyId: actor.companyId,
    userId: actor.userId,
    action: result.idempotent ? 'bank.billing-payment.idempotent' : 'bank.billing-payment.create',
    entityType: 'billing_payment',
    entityId: result.paymentRow.id,
    details: {
      transactionId,
      amount: result.paymentRow.amount,
      currency: result.paymentRow.currency,
      entryCreated: false,
    },
    ip: actor.ip ?? null,
  });

  const matchedAmount = await paymentMatchedAmount(db, result.paymentRow.id);
  const candidate: BillingPaymentCandidate = {
    paymentId: result.paymentRow.id,
    paymentNumber: result.paymentRow.payment_no,
    paymentDate: result.paymentRow.payment_date,
    amount: result.paymentRow.amount,
    currency: result.paymentRow.currency,
    method: result.paymentRow.method,
    reference: result.paymentRow.reference,
    customerId: result.paymentRow.customer_id,
    customerName: result.paymentRow.customer_name ?? '',
    unallocatedAmount: result.paymentRow.unallocated_amount,
    accountingEntryId: result.paymentRow.accounting_entry_id,
    accountingPosted: false,
    matchedAmount: formatAmount(matchedAmount),
    availableAmount: formatAmount(amountOf(result.paymentRow.amount) - matchedAmount),
    suggestedAmount: formatAmount(matchedAmount),
    confidence: 1,
    reasons: [
      {
        code: 'CREATED_FROM_BANK',
        fr: 'Règlement créé depuis un encaissement bancaire confirmé.',
        en: 'Payment created from a confirmed bank receipt.',
      },
    ],
    issues: [],
    allocations: result.allocations,
    alreadyLinkedToTransaction: true,
  };
  return {
    payment: candidate,
    transaction: result.transaction,
    match: result.idempotent ? ({} as Record<string, unknown>) : (result as any).match,
    allocations: result.allocations,
    idempotent: result.idempotent,
    entryCreated: false,
  };
}
