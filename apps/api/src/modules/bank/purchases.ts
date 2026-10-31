import type { Db } from '../../db/index.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { formatAmount, parseAmount } from '../../lib/money.js';
import { cabinetOfCompany } from '../../lib/cabinets.js';
import { transactionAllocatedAmount } from './billing.js';

/**
 * Mission 11 - bank statement <-> supplier payments.
 *
 * A confirmed link only records that a bank debit funds an **already recorded**
 * supplier payment. It never creates a second payment, never creates a journal
 * entry and never changes the commercial allocation. Accounting stays a
 * separate human action through the existing proposal engine.
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

interface PurchasePaymentRow {
  id: string;
  company_id: string;
  supplier_id: string;
  payment_no: string | null;
  kind: 'payment' | 'advance';
  payment_date: string;
  amount: string;
  currency: string;
  method: string;
  reference: string | null;
  unallocated_amount: string;
  status: string;
  accounting_entry_id: string | null;
  supplier_name: string;
  matched_amount: string;
}

export interface SupplierAllocationView {
  invoiceId: string;
  invoiceNumber: string | null;
  supplierReference: string;
  amount: string;
  invoiceTotal: string;
  invoicePaid: string;
  invoiceCredited: string;
  invoiceOutstanding: string;
  currency: string;
}

export interface SupplierPaymentCandidate {
  paymentId: string;
  paymentNumber: string | null;
  paymentDate: string;
  kind: string;
  amount: string;
  currency: string;
  method: string;
  reference: string | null;
  supplierId: string;
  supplierName: string;
  unallocatedAmount: string;
  accountingEntryId: string | null;
  accountingPosted: boolean;
  matchedAmount: string;
  availableAmount: string;
  suggestedAmount: string;
  confidence: number;
  reasons: { code: string; fr: string; en: string }[];
  issues: { code: string; fr: string; en: string; blocking: boolean }[];
  allocations: SupplierAllocationView[];
  alreadyLinkedToTransaction: boolean;
}

const value = (raw: string | null | undefined) => parseAmount(raw ?? '0') ?? 0n;
const abs = (raw: bigint) => (raw < 0n ? -raw : raw);

async function loadTransaction(db: Db, companyId: string, transactionId: string, lock = false) {
  const res = await db.query<TxnRow>(
    `SELECT * FROM bank_transactions WHERE id = $1 AND company_id = $2${lock ? ' FOR UPDATE' : ''}`,
    [transactionId, companyId],
  );
  const txn = res.rows[0];
  if (!txn) throw notFound('BANK_TRANSACTION_NOT_FOUND', 'Bank transaction not found');
  return txn;
}

export async function purchasePaymentMatchedAmount(db: Db, paymentId: string): Promise<bigint> {
  const res = await db.query<{ total: string }>(
    `SELECT COALESCE(SUM(amount), 0)::text AS total FROM bank_matches
      WHERE purchase_payment_id = $1 AND status = 'confirmed'`,
    [paymentId],
  );
  return value(res.rows[0]?.total);
}

async function loadAllocations(db: Db, companyId: string, paymentId: string): Promise<SupplierAllocationView[]> {
  const res = await db.query<any>(
    `SELECT a.invoice_id, a.amount::text, d.doc_no, d.supplier_reference, d.total_amount::text,
            d.amount_paid::text, d.credited_amount::text, d.currency
       FROM purchase_payment_allocations a
       JOIN purchase_documents d ON d.id = a.invoice_id AND d.company_id = $2
      WHERE a.payment_id = $1 AND a.cancelled_at IS NULL
      ORDER BY d.issue_date, d.doc_no`,
    [paymentId, companyId],
  );
  return res.rows.map((row) => {
    const outstanding = value(row.total_amount) - value(row.amount_paid) - value(row.credited_amount);
    return {
      invoiceId: row.invoice_id,
      invoiceNumber: row.doc_no,
      supplierReference: row.supplier_reference,
      amount: row.amount,
      invoiceTotal: row.total_amount,
      invoicePaid: row.amount_paid,
      invoiceCredited: row.credited_amount,
      invoiceOutstanding: formatAmount(outstanding > 0n ? outstanding : 0n),
      currency: row.currency,
    };
  });
}

export async function supplierPaymentCandidates(
  db: Db,
  companyId: string,
  transactionId: string,
): Promise<{ transactionRemaining: string; allocatedAmount: string; direction: 'in' | 'out'; candidates: SupplierPaymentCandidate[] }> {
  const txn = await loadTransaction(db, companyId, transactionId);
  const signed = value(txn.amount);
  const direction: 'in' | 'out' = signed < 0n ? 'out' : 'in';
  const txnAmount = abs(signed);
  const allocated = await transactionAllocatedAmount(db, txn.id);
  const remaining = txnAmount - allocated > 0n ? txnAmount - allocated : 0n;

  const rows = await db.query<PurchasePaymentRow>(
    `SELECT p.*, s.name AS supplier_name,
            (SELECT COALESCE(SUM(m.amount), 0)::text FROM bank_matches m
              WHERE m.purchase_payment_id = p.id AND m.status = 'confirmed') AS matched_amount
       FROM purchase_payments p
       JOIN purchase_suppliers s ON s.id = p.supplier_id AND s.company_id = p.company_id
      WHERE p.company_id = $1 AND p.status = 'recorded' AND p.currency = $2
      ORDER BY p.payment_date DESC, p.payment_no DESC
      LIMIT 200`,
    [companyId, txn.currency],
  );

  const candidates: SupplierPaymentCandidate[] = [];
  for (const payment of rows.rows) {
    const allocations = await loadAllocations(db, companyId, payment.id);
    const paymentAmount = value(payment.amount);
    const matched = value(payment.matched_amount);
    const available = paymentAmount - matched > 0n ? paymentAmount - matched : 0n;
    const linked = await db.query<{ id: string; amount: string }>(
      `SELECT id, amount::text FROM bank_matches
        WHERE transaction_id = $1 AND purchase_payment_id = $2 AND status = 'confirmed'`,
      [txn.id, payment.id],
    );
    const alreadyLinkedToTransaction = Boolean(linked.rows[0]);
    const suggested =
      alreadyLinkedToTransaction
        ? value(linked.rows[0]!.amount)
        : available < remaining
          ? available
          : remaining;
    const reasons: SupplierPaymentCandidate['reasons'] = [];
    const issues: SupplierPaymentCandidate['issues'] = [];
    if (direction === 'in') {
      issues.push({
        code: 'DIRECTION_MISMATCH',
        fr: 'Un crédit bancaire ne peut pas financer un paiement fournisseur.',
        en: 'A bank credit cannot fund a supplier payment.',
        blocking: true,
      });
    }
    if (available <= 0n) {
      issues.push({
        code: 'PAYMENT_FULLY_ALLOCATED',
        fr: 'Ce règlement est déjà entièrement rapproché en banque.',
        en: 'This payment is already fully reconciled in the bank.',
        blocking: true,
      });
    }
    if (remaining <= 0n) {
      issues.push({
        code: 'TRANSACTION_FULLY_ALLOCATED',
        fr: 'Cette transaction bancaire est déjà entièrement affectée.',
        en: 'This bank transaction is already fully allocated.',
        blocking: true,
      });
    }
    const haystack = `${payment.reference ?? ''} ${payment.payment_no ?? ''} ${payment.supplier_name}`.toLowerCase();
    if (txn.reference && payment.reference && txn.reference.toLowerCase() === payment.reference.toLowerCase()) {
      reasons.push({
        code: 'REFERENCE_MATCH',
        fr: 'Référence bancaire identique à la référence du règlement.',
        en: 'Bank reference matches the payment reference.',
      });
    }
    if (txn.label && haystack.includes(txn.label.toLowerCase().slice(0, 24))) {
      reasons.push({
        code: 'LABEL_MATCH',
        fr: 'Le libellé bancaire cite le fournisseur ou le règlement.',
        en: 'The bank label cites the supplier or payment.',
      });
    }
    let confidence = 0.2;
    if (reasons.some((r) => r.code === 'REFERENCE_MATCH')) confidence += 0.35;
    if (reasons.some((r) => r.code === 'LABEL_MATCH')) confidence += 0.15;
    if (!alreadyLinkedToTransaction && available === remaining) confidence += 0.2;
    if (payment.kind === 'advance' && allocations.length === 0) {
      issues.push({
        code: 'ADVANCE_NO_INVOICE',
        fr: 'Acompte non affecté : le rapprochement bancaire ne crée pas d’affectation.',
        en: 'Unallocated advance: bank reconciliation creates no invoice allocation.',
        blocking: false,
      });
    }
    if (payment.accounting_entry_id) {
      reasons.push({
        code: 'ALREADY_POSTED',
        fr: 'Le règlement est déjà comptabilisé : aucun second règlement ni seconde écriture.',
        en: 'The payment is already posted: no second payment or entry.',
      });
    }
    candidates.push({
      paymentId: payment.id,
      paymentNumber: payment.payment_no,
      paymentDate: payment.payment_date,
      kind: payment.kind,
      amount: payment.amount,
      currency: payment.currency,
      method: payment.method,
      reference: payment.reference,
      supplierId: payment.supplier_id,
      supplierName: payment.supplier_name,
      unallocatedAmount: payment.unallocated_amount,
      accountingEntryId: payment.accounting_entry_id,
      accountingPosted: Boolean(payment.accounting_entry_id),
      matchedAmount: formatAmount(matched),
      availableAmount: formatAmount(available),
      suggestedAmount: formatAmount(suggested > 0n ? suggested : 0n),
      confidence: Math.min(confidence, 0.95),
      reasons,
      issues,
      allocations,
      alreadyLinkedToTransaction,
    });
  }
  candidates.sort(
    (a, b) =>
      Number(a.issues.some((i) => i.blocking)) - Number(b.issues.some((i) => i.blocking)) ||
      b.confidence - a.confidence,
  );
  return {
    transactionRemaining: formatAmount(remaining),
    allocatedAmount: formatAmount(allocated),
    direction,
    candidates,
  };
}

export async function linkBankSupplierPayment(
  db: Db,
  actor: { userId: string; companyId: string; ip?: string | null },
  transactionId: string,
  input: { paymentId: string; amount: string; confirm: true; note?: string | null },
): Promise<Record<string, unknown>> {
  const requested = parseAmount(input.amount);
  if (requested <= 0n) throw badRequest('VALIDATION_ERROR', 'The allocated amount must be positive');
  const result = await db.transaction(async (tx) => {
    const txn = await loadTransaction(tx, actor.companyId, transactionId, true);
    const signed = value(txn.amount);
    if (signed >= 0n) {
      throw conflict('BANK_DIRECTION_MISMATCH', 'A bank credit cannot fund a supplier payment');
    }
    const paymentRes = await tx.query<PurchasePaymentRow>(
      `SELECT p.*, s.name AS supplier_name
         FROM purchase_payments p
         JOIN purchase_suppliers s ON s.id = p.supplier_id AND s.company_id = p.company_id
        WHERE p.id = $1 AND p.company_id = $2 FOR UPDATE`,
      [input.paymentId, actor.companyId],
    );
    const payment = paymentRes.rows[0];
    if (!payment) throw notFound('PURCHASE_PAYMENT_NOT_FOUND', 'Supplier payment not found');
    if (payment.status !== 'recorded') {
      throw conflict('PURCHASE_PAYMENT_CANCELLED', 'A cancelled supplier payment cannot be reconciled');
    }
    if (payment.currency !== txn.currency) {
      throw conflict(
        'BANK_CURRENCY_MISMATCH',
        `Currency mismatch: bank transaction ${txn.currency}, payment ${payment.currency}`,
      );
    }
    const foreign = await tx.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM bank_matches
        WHERE transaction_id = $1 AND status = 'confirmed'
          AND (billing_payment_id IS NOT NULL OR entry_line_id IS NOT NULL)`,
      [txn.id],
    );
    if (Number(foreign.rows[0]?.count ?? 0) > 0) {
      throw conflict(
        'BANK_TRANSACTION_ALREADY_ALLOCATED',
        'This transaction is already reconciled with a customer receipt or a ledger line',
      );
    }
    const existing = await tx.query<{ id: string; amount: string }>(
      `SELECT id, amount::text FROM bank_matches
        WHERE transaction_id = $1 AND purchase_payment_id = $2 AND status = 'confirmed'`,
      [txn.id, payment.id],
    );
    if (existing.rows[0]) {
      if (value(existing.rows[0].amount) !== requested) {
        throw conflict('BANK_LINK_ALREADY_EXISTS', 'This transaction is already linked to this payment for another amount');
      }
      return { match: existing.rows[0], transaction: txn, payment, idempotent: true };
    }
    const txnAllocated = await transactionAllocatedAmount(tx, txn.id);
    const txnRemaining = abs(signed) - txnAllocated;
    if (requested > txnRemaining) {
      throw conflict(
        'BANK_AMOUNT_EXCEEDS_TRANSACTION',
        `Requested ${formatAmount(requested)}, transaction remaining ${formatAmount(txnRemaining > 0n ? txnRemaining : 0n)}`,
      );
    }
    const paymentMatched = await purchasePaymentMatchedAmount(tx, payment.id);
    const paymentRemaining = value(payment.amount) - paymentMatched;
    if (requested > paymentRemaining) {
      throw conflict(
        'BANK_AMOUNT_EXCEEDS_PAYMENT',
        `Requested ${formatAmount(requested)}, payment remaining ${formatAmount(paymentRemaining > 0n ? paymentRemaining : 0n)}`,
      );
    }
    const cabinetId = await cabinetOfCompany(tx, actor.companyId);
    if (!cabinetId) throw badRequest('BANK_COMPANY_NOT_IN_CABINET', 'This company is not attached to a cabinet');
    const allocations = await loadAllocations(tx, actor.companyId, payment.id);
    const singleInvoice = allocations.length === 1 ? allocations[0]!.invoiceId : null;
    const inserted = await tx.query<Record<string, unknown>>(
      `INSERT INTO bank_matches
         (cabinet_id, company_id, bank_account_id, transaction_id, entry_id, entry_line_id,
          purchase_payment_id, purchase_invoice_id, amount, status, kind, confidence, reasons,
          note, created_by, decided_by, decided_at)
       VALUES ($1,$2,$3,$4,$5,NULL,$6,$7,$8,'confirmed','invoice',$9,$10::jsonb,$11,$12,$12,now())
       RETURNING *`,
      [
        cabinetId,
        actor.companyId,
        txn.bank_account_id,
        txn.id,
        payment.accounting_entry_id ?? null,
        payment.id,
        singleInvoice,
        formatAmount(requested),
        allocations.length > 0 ? 0.9 : 0.7,
        JSON.stringify([
          {
            code: 'HUMAN_CONFIRMATION',
            fr: 'Rapprochement bancaire fournisseur validé explicitement par un humain.',
            en: 'Supplier bank reconciliation explicitly confirmed by a human.',
          },
          {
            code: 'NO_SECOND_PAYMENT',
            fr: 'Le règlement existant est réutilisé : aucun second paiement ni seconde écriture.',
            en: 'The existing payment is reused: no second payment or entry.',
          },
        ]),
        input.note ?? null,
        actor.userId,
      ],
    );
    const total = txnAllocated + requested;
    const status = total >= abs(signed) ? 'matched' : 'partially_matched';
    const updated = await tx.query<TxnRow>(
      'UPDATE bank_transactions SET status = $2, updated_at = now() WHERE id = $1 RETURNING *',
      [txn.id, status],
    );
    return { match: inserted.rows[0]!, transaction: updated.rows[0]!, payment, idempotent: false };
  });

  await db.query(
    `INSERT INTO bank_events (cabinet_id, company_id, entity, entity_id, event, actor_id, ip, metadata)
     VALUES ((SELECT cabinet_id FROM bank_transactions WHERE id = $1), $2, 'bank_transaction', $1,
             $3, $4, $5, $6::jsonb)`,
    [
      transactionId,
      actor.companyId,
      result.idempotent ? 'supplier.link.idempotent' : 'supplier.link.confirmed',
      actor.userId,
      actor.ip ?? null,
      JSON.stringify({
        purchasePaymentId: input.paymentId,
        amount: formatAmount(requested),
        accountingEntryId: result.payment.accounting_entry_id,
      }),
    ],
  );
  return {
    match: result.match,
    transaction: result.transaction,
    paymentId: result.payment.id,
    idempotent: result.idempotent,
  };
}

export async function unlinkBankSupplierPayment(
  db: Db,
  actor: { userId: string; companyId: string; ip?: string | null },
  transactionId: string,
  paymentId: string,
  confirm: boolean,
  reason: string | null,
): Promise<{ match: Record<string, unknown>; transaction: TxnRow }> {
  if (!confirm) throw badRequest('BANK_CONFIRMATION_REQUIRED', 'Explicit human confirmation is required');
  const result = await db.transaction(async (tx) => {
    const txn = await loadTransaction(tx, actor.companyId, transactionId, true);
    const found = await tx.query<{ id: string; amount: string }>(
      `SELECT id, amount::text FROM bank_matches
        WHERE transaction_id = $1 AND purchase_payment_id = $2 AND company_id = $3
          AND status = 'confirmed' FOR UPDATE`,
      [txn.id, paymentId, actor.companyId],
    );
    const match = found.rows[0];
    if (!match) throw notFound('BANK_MATCH_NOT_FOUND', 'No confirmed link for this supplier payment');
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
    const allocated = value(remaining.rows[0]?.total);
    const total = abs(value(txn.amount));
    const status = allocated === 0n ? 'unmatched' : allocated >= total ? 'matched' : 'partially_matched';
    const txnUpdated = await tx.query<TxnRow>(
      'UPDATE bank_transactions SET status = $2, updated_at = now() WHERE id = $1 RETURNING *',
      [txn.id, status],
    );
    return { match: updated.rows[0]!, transaction: txnUpdated.rows[0]! };
  });
  await db.query(
    `INSERT INTO bank_events (cabinet_id, company_id, entity, entity_id, event, actor_id, ip, metadata)
     VALUES ((SELECT cabinet_id FROM bank_transactions WHERE id = $1), $2, 'bank_transaction', $1,
             'supplier.link.rejected', $3, $4, $5::jsonb)`,
    [
      transactionId,
      actor.companyId,
      actor.userId,
      actor.ip ?? null,
      JSON.stringify({ purchasePaymentId: paymentId, reason, amount: result.match.amount }),
    ],
  );
  return result;
}
