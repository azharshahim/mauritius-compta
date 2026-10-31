import type { Db } from '../../db/index.js';
import { AppError, conflict, notFound } from '../../lib/errors.js';
import { writeAudit } from '../../lib/audit.js';
import { formatAmount, parseAmount, parseRate } from '../../lib/money.js';
import { accountForRole, loadBillingContext } from '../billing/service.js';
import {
  defaultJournal,
  insertProposal,
  loadProposal,
  viewProposal,
  type ProposalRow,
  type ProposalView,
  type SourceKind,
} from '../ai/proposals.js';
import type { PurchaseDocumentRow, PurchasePaymentRow } from './service.js';

/**
 * Deterministic purchase proposals.
 *
 * No AI model is called. Every account comes from the active chart of the
 * company. The function only creates a *draft proposal*: validation and posting
 * remain two separate human actions in the existing engine.
 */
export async function proposeFromPurchase(
  db: Db,
  params: {
    cabinetId: string;
    companyId: string;
    userId: string;
    documentId?: string;
    paymentId?: string;
  },
): Promise<{ proposal: ProposalView; reused: boolean }> {
  const result = await db.transaction(async (tx) => {
    let sourceKind: SourceKind;
    let sourceId: string;
    let reference: string | null;
    let description: string;
    let entryDate: string;
    let currency: string;
    let exchangeRate: string | null;
    let total: bigint;
    let supplierId: string;
    let journalTypes: string[];
    const warnings: string[] = [];
    const missing: string[] = [];
    let lines: { accountId: string; description: string | null; debit: bigint; credit: bigint }[] = [];

    const ctx = await loadBillingContext(tx, params.companyId);

    if (params.paymentId) {
      const loaded = await tx.query<PurchasePaymentRow>(
        'SELECT * FROM purchase_payments WHERE id = $1 AND company_id = $2 FOR UPDATE',
        [params.paymentId, params.companyId],
      );
      const payment = loaded.rows[0];
      if (!payment) throw notFound('PURCHASE_PAYMENT_NOT_FOUND', 'Supplier payment not found');
      if (payment.status !== 'recorded') throw conflict('PURCHASE_PAYMENT_CANCELLED', 'Cancelled payment');
      if (payment.accounting_entry_id) {
        throw conflict('ACCOUNTING_ALREADY_POSTED', 'This supplier payment is already posted');
      }
      if (!payment.payment_no) throw conflict('PURCHASE_PAYMENT_NOT_NUMBERED', 'The payment has no number');
      sourceKind = 'purchase_payment';
      sourceId = payment.id;
      reference = payment.payment_no;
      description =
        payment.kind === 'advance'
          ? `Acompte fournisseur ${payment.payment_no}`
          : `Règlement fournisseur ${payment.payment_no}`;
      entryDate = payment.payment_date;
      currency = payment.currency;
      exchangeRate = payment.exchange_rate;
      total = parseAmount(payment.amount);
      supplierId = payment.supplier_id;
      journalTypes = payment.method === 'cash' ? ['cash', 'bank'] : ['bank', 'cash'];
      const bank = accountForRole(ctx, payment.method === 'cash' ? 'cash' : 'bank');
      if (!bank) missing.push('Aucun compte de banque/caisse actif dans le plan comptable.');
      const debitAccount =
        payment.kind === 'advance'
          ? accountForRole(ctx, 'prepayment')
          : await payableAccount(tx, params.companyId, supplierId, ctx);
      if (!debitAccount) {
        missing.push(
          payment.kind === 'advance'
            ? 'Aucun compte d’acompte/débiteurs (1150) actif dans le plan comptable.'
            : 'Aucun compte fournisseur actif dans le plan comptable.',
        );
      }
      if (missing.length > 0) {
        throw new AppError('AI_HUMAN_REQUIRED', 409, 'The chart of accounts is incomplete for this payment', { missing });
      }
      lines = [
        {
          accountId: debitAccount!.id,
          description: payment.kind === 'advance' ? 'Acompte fournisseur' : 'Dette fournisseur réglée',
          debit: total,
          credit: 0n,
        },
        { accountId: bank!.id, description: 'Décaissement', debit: 0n, credit: total },
      ];
      if (payment.kind === 'advance') {
        warnings.push(
          'ADVANCE: the prepayment is proposed on the prepayment account; it does not settle an invoice until a human allocates it.',
        );
      }
    } else if (params.documentId) {
      const loaded = await tx.query<PurchaseDocumentRow>(
        'SELECT * FROM purchase_documents WHERE id = $1 AND company_id = $2 FOR UPDATE',
        [params.documentId, params.companyId],
      );
      const document = loaded.rows[0];
      if (!document) throw notFound('PURCHASE_DOCUMENT_NOT_FOUND', 'Purchase document not found');
      if (document.status !== 'validated') {
        throw conflict('PURCHASE_DOCUMENT_NOT_VALIDATED', 'Only a validated purchase document can be proposed');
      }
      if (document.accounting_entry_id) {
        throw conflict('ACCOUNTING_ALREADY_POSTED', 'This purchase document is already posted');
      }
      if (!document.doc_no) throw conflict('PURCHASE_DOCUMENT_NOT_NUMBERED', 'The document has no internal number');
      sourceKind = document.kind === 'credit_note' ? 'purchase_credit_note' : 'purchase_invoice';
      sourceId = document.id;
      reference = document.doc_no;
      entryDate = document.issue_date;
      currency = document.currency;
      exchangeRate = document.exchange_rate;
      total = parseAmount(document.total_amount);
      supplierId = document.supplier_id;
      journalTypes = ['purchases', 'general'];
      const supplierRes = await tx.query<{ name: string }>(
        'SELECT name FROM purchase_suppliers WHERE id = $1 AND company_id = $2',
        [supplierId, params.companyId],
      );
      description = `${document.kind === 'credit_note' ? 'Avoir fournisseur' : 'Facture d’achat'} ${document.doc_no} — ${supplierRes.rows[0]?.name ?? 'fournisseur'}`;
      if (parseRate(document.exchange_rate) !== parseRate('1')) {
        warnings.push(
          'FOREIGN_CURRENCY: the entry uses the exchange rate explicitly recorded on the document. No exchange gain/loss is computed.',
        );
      }
      const payable = await payableAccount(tx, params.companyId, supplierId, ctx);
      if (!payable) missing.push('Aucun compte fournisseur actif dans le plan comptable.');
      const vatInput = accountForRole(ctx, 'vatInput');
      const lineRows = await tx.query<any>(
        'SELECT * FROM purchase_document_lines WHERE document_id = $1 ORDER BY line_no',
        [document.id],
      );
      const byAccount = new Map<string, bigint>();
      let recoverableTax = 0n;
      for (const [index, row] of lineRows.rows.entries()) {
        const net = parseAmount(row.net_amount);
        const tax = parseAmount(row.tax_amount);
        byAccount.set(row.account_id, (byAccount.get(row.account_id) ?? 0n) + net);
        if (tax > 0n) {
          if (row.vat_recoverable === true) {
            recoverableTax += tax;
            if (!vatInput) missing.push('Aucun compte de TVA récupérable actif alors que la TVA est récupérable.');
          } else if (row.vat_recoverable === false) {
            byAccount.set(row.account_id, (byAccount.get(row.account_id) ?? 0n) + tax);
            warnings.push(
              `VAT_NON_RECOVERABLE_LINE_${index + 1}: the input VAT is included in the cost account and is not claimed as VAT.`,
            );
          } else {
            missing.push(`Ligne ${index + 1} : la récupération de TVA n’est pas renseignée.`);
          }
        }
      }
      if (missing.length > 0) {
        throw new AppError('AI_HUMAN_REQUIRED', 409, 'The chart of accounts is incomplete for this document', {
          missing,
        });
      }
      const creditNote = document.kind === 'credit_note';
      lines = [];
      if (creditNote) {
        lines.push({ accountId: payable!.id, description: 'Dette fournisseur annulée', debit: total, credit: 0n });
        for (const [accountId, value] of byAccount) {
          if (value > 0n) lines.push({ accountId, description: 'Annulation de charge/immobilisation', debit: 0n, credit: value });
        }
        if (recoverableTax > 0n) {
          lines.push({
            accountId: vatInput!.id,
            description: 'TVA récupérable annulée',
            debit: 0n,
            credit: recoverableTax,
          });
        }
      } else {
        for (const [accountId, value] of byAccount) {
          if (value > 0n) lines.push({ accountId, description: 'Charge, stock ou immobilisation', debit: value, credit: 0n });
        }
        if (recoverableTax > 0n) {
          lines.push({
            accountId: vatInput!.id,
            description: 'TVA récupérable (configuration validée)',
            debit: recoverableTax,
            credit: 0n,
          });
        }
        lines.push({ accountId: payable!.id, description: 'Dette fournisseur', debit: 0n, credit: total });
      }
      const debit = lines.reduce((sum, line) => sum + line.debit, 0n);
      const credit = lines.reduce((sum, line) => sum + line.credit, 0n);
      if (debit !== credit) {
        throw new AppError(
          'AI_PROPOSAL_INVALID',
          409,
          'The deterministic purchase proposal is not balanced',
          { debit: formatAmount(debit), credit: formatAmount(credit) },
        );
      }
    } else {
      throw conflict('VALIDATION_ERROR', 'A purchase document or payment is required');
    }

    const journal = await defaultJournal(tx, params.companyId, journalTypes);
    if (!journal) missing.push('Aucun journal actif dans ce dossier.');
    if (missing.length > 0) {
      throw new AppError('AI_HUMAN_REQUIRED', 409, 'The chart of accounts is incomplete', { missing });
    }

    const existing = await tx.query<ProposalRow>(
      `SELECT * FROM ai_entry_proposals
        WHERE source_kind = $1 AND source_id = $2 AND status <> 'rejected'
        LIMIT 1`,
      [sourceKind, sourceId],
    );
    if (existing.rows[0]) {
      const row = existing.rows[0];
      if (row.status === 'posted') {
        throw conflict('ACCOUNTING_ALREADY_POSTED', 'This source is already posted to accounting');
      }
      return { proposal: row, reused: true, cabinetId: params.cabinetId, companyId: params.companyId };
    }

    const proposal = await insertProposal(tx, {
      cabinetId: params.cabinetId,
      companyId: params.companyId,
      userId: params.userId,
      sourceKind,
      sourceId,
      journalId: journal!.id,
      entryDate,
      reference,
      description,
      currency,
      exchangeRate,
      confidence: 1,
      rationale:
        'Proposition déterministe calculée à partir du cycle fournisseur : comptes du plan comptable réel, TVA issue de la configuration vérifiée, aucune IA.',
      warnings,
      missing,
      ruleTrace: ['Aucune IA : proposition déterministe issue du cycle Achats & Fournisseurs.'],
      provider: 'deterministic',
      model: null,
      lines,
    });
    await writeAudit(tx, {
      companyId: params.companyId,
      userId: params.userId,
      action: 'purchases.proposal.create',
      entityType: 'ai_entry_proposal',
      entityId: proposal.id,
      details: {
        sourceKind,
        sourceId,
        entryDate,
        total: formatAmount(total),
        currency,
      },
    });
    return { proposal, reused: false, cabinetId: params.cabinetId, companyId: params.companyId };
  });
  const stored = await loadProposal(db, result.cabinetId, result.companyId, result.proposal.id);
  return {
    proposal: await viewProposal(db, result.cabinetId, result.companyId, stored.proposal, stored.lines),
    reused: result.reused,
  };
}

async function payableAccount(
  tx: Db,
  companyId: string,
  supplierId: string,
  ctx: Awaited<ReturnType<typeof loadBillingContext>>,
): Promise<{ id: string } | null> {
  const supplier = await tx.query<{ payable_account_id: string | null }>(
    'SELECT payable_account_id FROM purchase_suppliers WHERE id = $1 AND company_id = $2',
    [supplierId, companyId],
  );
  const direct = supplier.rows[0]?.payable_account_id;
  if (direct) {
    const account = await tx.query<{ id: string; is_active: boolean }>(
      'SELECT id, is_active FROM accounts WHERE id = $1 AND company_id = $2',
      [direct, companyId],
    );
    if (account.rows[0]?.is_active) return { id: account.rows[0].id };
  }
  return accountForRole(ctx, 'payable');
}
