/**
 * Demo engine for Achats & Fournisseurs (mission 11).
 *
 * Everything stays in the browser localStorage. The same exact decimal helpers
 * as the API are used (BigInt scaled by 10^4); no float and no silent rounding.
 * A purchase document never creates an accounting entry here: it only prepares
 * a proposal, which the human validates and posts in the proposals screen.
 */
import { ApiError } from '../errors';
import type {
  DemoAccount,
  DemoEntry,
  DemoEntryProposal,
  DemoJournal,
  DemoProposalLine,
  DemoPurchaseAllocation,
  DemoPurchaseCreditAllocation,
  DemoPurchaseDocument,
  DemoPurchaseEvent,
  DemoPurchaseLine,
  DemoPurchasePayment,
  DemoPurchaseSupplier,
  DemoState,
} from './runtime';
import { formatScaled, parseAmount, parseRate } from '../../../api/src/modules/migration/normalize';

const now = () => new Date().toISOString();
const uid = () => crypto.randomUUID();

type Big = bigint;
const amt = (value: unknown): Big => {
  const parsed = parseAmount(value as never);
  if (parsed === null) throw new ApiError(400, 'VALIDATION_ERROR', 'Montant invalide');
  return parsed;
};
const fmt = (value: Big) => formatScaled(value);
const mul4 = (a: Big, b: Big): Big => {
  const product = a * b;
  const negative = product < 0n;
  const abs = negative ? -product : product;
  const quotient = abs / 10000n;
  const remainder = abs % 10000n;
  const rounded = remainder * 2n >= 10000n ? quotient + 1n : quotient;
  return negative ? -rounded : rounded;
};
const mulRate = (value: Big, rate8: Big): Big => {
  const product = value * rate8;
  const negative = product < 0n;
  const abs = negative ? -product : product;
  const quotient = abs / 100000000n;
  const remainder = abs % 100000000n;
  const rounded = remainder * 2n >= 100000000n ? quotient + 1n : quotient;
  return negative ? -rounded : rounded;
};

const functional = (state: DemoState, companyId: string) =>
  state.companies.find((c) => c.id === companyId)?.functional_currency ?? 'MUR';

const supplierOf = (state: DemoState, companyId: string, supplierId: string) => {
  const supplier = state.purchaseSuppliers.find((s) => s.id === supplierId && s.company_id === companyId);
  if (!supplier) throw new ApiError(404, 'PURCHASE_SUPPLIER_NOT_FOUND', 'Fournisseur introuvable');
  return supplier;
};

const documentOf = (state: DemoState, companyId: string, documentId: string) => {
  const document = state.purchaseDocuments.find((d) => d.id === documentId && d.company_id === companyId);
  if (!document) throw new ApiError(404, 'PURCHASE_DOCUMENT_NOT_FOUND', 'Document d’achat introuvable');
  return document;
};

const paymentOf = (state: DemoState, companyId: string, paymentId: string) => {
  const payment = state.purchasePayments.find((p) => p.id === paymentId && p.company_id === companyId);
  if (!payment) throw new ApiError(404, 'PURCHASE_PAYMENT_NOT_FOUND', 'Règlement fournisseur introuvable');
  return payment;
};

const accountByCode = (state: DemoState, companyId: string, code: string): DemoAccount => {
  const account = state.accounts.find((a) => a.company_id === companyId && a.code === code);
  if (!account || !account.is_active) {
    throw new ApiError(409, 'AI_HUMAN_REQUIRED', `Compte ${code} absent ou inactif du plan comptable actif`);
  }
  return account;
};

const journalByType = (state: DemoState, companyId: string, types: string[]): DemoJournal | undefined =>
  state.journals.find((j) => j.company_id === companyId && j.is_active && types.includes(j.type));

const paidOf = (state: DemoState, documentId: string): Big =>
  state.purchaseAllocations
    .filter((a) => a.invoice_id === documentId && !a.cancelled_at)
    .reduce((total, a) => total + amt(a.amount), 0n);

const creditedOf = (state: DemoState, documentId: string): Big =>
  state.purchaseCreditAllocations
    .filter((a) => a.invoice_id === documentId && !a.cancelled_at)
    .reduce((total, a) => total + amt(a.amount), 0n);

const creditUsedOf = (state: DemoState, creditNoteId: string): Big =>
  state.purchaseCreditAllocations
    .filter((a) => a.credit_note_id === creditNoteId && !a.cancelled_at)
    .reduce((total, a) => total + amt(a.amount), 0n);

const outstandingOf = (state: DemoState, document: DemoPurchaseDocument): Big => {
  if (document.kind !== 'invoice') return 0n;
  const remaining = amt(document.total_amount) - paidOf(state, document.id) - creditedOf(state, document.id);
  return remaining > 0n ? remaining : 0n;
};

const creditAvailableOf = (state: DemoState, document: DemoPurchaseDocument): Big => {
  if (document.kind !== 'credit_note') return 0n;
  const remaining = amt(document.total_amount) - creditUsedOf(state, document.id);
  return remaining > 0n ? remaining : 0n;
};

function refreshDocument(state: DemoState, document: DemoPurchaseDocument): void {
  if (document.kind === 'invoice') {
    const paid = paidOf(state, document.id);
    const credited = creditedOf(state, document.id);
    document.amount_paid = fmt(paid);
    document.credited_amount = fmt(credited);
    const outstanding = amt(document.total_amount) - paid - credited;
    document.payment_status = outstanding <= 0n ? 'paid' : paid + credited > 0n ? 'partial' : 'unpaid';
  } else {
    document.amount_paid = '0.0000';
    document.credited_amount = fmt(creditUsedOf(state, document.id));
    document.payment_status = creditAvailableOf(state, document) <= 0n ? 'paid' : 'unpaid';
  }
  document.updated_at = now();
}

function event(
  state: DemoState,
  companyId: string,
  action: string,
  documentId: string | null,
  paymentId: string | null,
  details: Record<string, unknown> | null,
  actorId: string | null,
): void {
  state.purchaseEvents.push({
    id: uid(),
    company_id: companyId,
    document_id: documentId,
    payment_id: paymentId,
    action,
    details,
    actor_id: actorId,
    created_at: now(),
  });
}

function nextNumber(
  state: DemoState,
  companyId: string,
  kind: 'invoice' | 'credit_note' | 'payment',
  year: number,
): { year: number; no: number; label: string } {
  const key = `${companyId}:${kind}:${year}`;
  const next = (state.purchaseSequences[key] ?? 0) + 1;
  state.purchaseSequences[key] = next;
  const prefix = kind === 'invoice' ? 'ACH' : kind === 'credit_note' ? 'AVF' : 'RF';
  return { year, no: next, label: `${prefix}-${year}-${String(next).padStart(4, '0')}` };
}

function assertCurrency(state: DemoState, companyId: string, currency: string, exchangeRate: unknown): string {
  const code = String(currency ?? '').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) throw new ApiError(400, 'VALIDATION_ERROR', 'Devise invalide (code ISO 3 lettres)');
  if (code === functional(state, companyId)) return '1.00000000';
  const rate = parseRate(exchangeRate);
  if (!rate) throw new ApiError(400, 'PURCHASE_EXCHANGE_RATE_REQUIRED', 'Taux de change obligatoire pour une devise étrangère');
  return rate;
}

function linesPayload(payload: Record<string, any>) {
  if (!Array.isArray(payload.lines) || payload.lines.length === 0) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Au moins une ligne est requise');
  }
  return payload.lines as Record<string, any>[];
}

function createDocumentLines(
  state: DemoState,
  companyId: string,
  document: DemoPurchaseDocument,
  payloadLines: Record<string, any>[],
): { subtotal: Big; tax: Big; total: Big } {
  let subtotal = 0n;
  let tax = 0n;
  payloadLines.forEach((raw, index) => {
    const description = String(raw.description ?? '').trim();
    if (description === '') throw new ApiError(400, 'VALIDATION_ERROR', 'Description de ligne requise');
    const account = state.accounts.find((a) => a.id === raw.accountId && a.company_id === companyId);
    if (!account) throw new ApiError(400, 'PURCHASE_ACCOUNT_NOT_IN_CHART', 'Compte hors plan comptable');
    if (!account.is_active) throw new ApiError(400, 'ACCOUNT_INACTIVE', 'Compte comptable inactif');
    if (account.type !== 'expense' && account.type !== 'asset') {
      throw new ApiError(400, 'PURCHASE_ACCOUNT_NOT_CHARGE', 'Une ligne d’achat doit viser une charge ou un actif');
    }
    const quantity = amt(raw.quantity ?? '1');
    const unitPrice = amt(raw.unitPrice);
    if (quantity <= 0n) throw new ApiError(400, 'VALIDATION_ERROR', 'Quantité strictement positive requise');
    if (unitPrice < 0n) throw new ApiError(400, 'VALIDATION_ERROR', 'Prix unitaire négatif interdit');
    const net = mul4(quantity, unitPrice);
    const treatment = String(raw.vatTreatment ?? 'out_of_scope');
    if (!['standard', 'zero_rated', 'exempt', 'out_of_scope'].includes(treatment)) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Traitement de TVA invalide');
    }
    let rate: string | null = null;
    let taxLine = 0n;
    let recoverable: boolean | null = null;
    if (treatment === 'standard') {
      if (!raw.vatRateId) throw new ApiError(400, 'PURCHASE_VAT_RATE_REQUIRED', 'Taux de TVA configuré requis');
      const configured = state.taxRates.find((r) => r.id === raw.vatRateId && r.company_id === companyId);
      if (!configured) throw new ApiError(400, 'PURCHASE_VAT_RATE_NOT_FOUND', 'Taux de TVA introuvable');
      if (!configured.verified) {
        throw new ApiError(409, 'PURCHASE_VAT_RATE_UNVERIFIED', 'Le taux de TVA doit être vérifié par un humain');
      }
      if (typeof raw.vatRecoverable !== 'boolean') {
        throw new ApiError(400, 'PURCHASE_VAT_RECOVERABILITY_REQUIRED', 'Indiquez si la TVA est récupérable');
      }
      rate = configured.rate;
      recoverable = raw.vatRecoverable;
      const rate8 = BigInt(parseRate(configured.rate)?.replace('.', '') ?? '0');
      taxLine = mulRate(net, rate8);
    } else if (raw.vatRateId) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Aucun taux ne doit être fourni pour ce traitement');
    }
    const line: DemoPurchaseLine = {
      id: uid(),
      document_id: document.id,
      company_id: companyId,
      line_no: index + 1,
      description,
      quantity: fmt(quantity),
      unit_price: fmt(unitPrice),
      account_id: account.id,
      vat_treatment: treatment as DemoPurchaseLine['vat_treatment'],
      vat_rate: rate,
      vat_rate_id: treatment === 'standard' ? String(raw.vatRateId) : null,
      vat_recoverable: recoverable,
      net_amount: fmt(net),
      tax_amount: fmt(taxLine),
      line_total: fmt(net + taxLine),
    };
    state.purchaseLines.push(line);
    subtotal += net;
    tax += taxLine;
  });
  return { subtotal, tax, total: subtotal + tax };
}

function documentView(state: DemoState, document: DemoPurchaseDocument) {
  const supplier = state.purchaseSuppliers.find((s) => s.id === document.supplier_id);
  const lines = state.purchaseLines
    .filter((l) => l.document_id === document.id)
    .sort((a, b) => a.line_no - b.line_no)
    .map((l) => {
      const account = state.accounts.find((a) => a.id === l.account_id);
      return {
        ...l,
        accountCode: account?.code ?? '',
        accountName: account?.name ?? '',
        netAmount: l.net_amount,
        taxAmount: l.tax_amount,
        lineTotal: l.line_total,
        vatRate: l.vat_rate,
        vatRecoverable: l.vat_recoverable,
      };
    });
  return {
    ...document,
    supplier_name: supplier?.name ?? '',
    supplier_country: supplier?.country ?? '',
    outstanding_amount: fmt(outstandingOf(state, document)),
    credit_available: fmt(creditAvailableOf(state, document)),
    lines,
  };
}

function paymentView(state: DemoState, payment: DemoPurchasePayment) {
  const supplier = state.purchaseSuppliers.find((s) => s.id === payment.supplier_id);
  const allocations = state.purchaseAllocations
    .filter((a) => a.payment_id === payment.id)
    .map((a) => {
      const invoice = state.purchaseDocuments.find((d) => d.id === a.invoice_id);
      return {
        id: a.id,
        invoiceId: a.invoice_id,
        invoiceNumber: invoice?.doc_no ?? null,
        supplierReference: invoice?.supplier_reference ?? '',
        amount: a.amount,
        invoiceTotal: invoice?.total_amount ?? '0.0000',
        invoiceOutstanding: invoice ? fmt(outstandingOf(state, invoice)) : '0.0000',
        currency: invoice?.currency ?? payment.currency,
        cancelledAt: a.cancelled_at,
      };
    });
  return { ...payment, supplier_name: supplier?.name ?? '', allocations };
}

/* -------------------------------------------------------------------------- */
/* Seed                                                                       */
/* -------------------------------------------------------------------------- */

export function seedDemoPurchases(state: DemoState): void {
  const company = state.companies[0];
  if (!company) return;
  const payable = state.accounts.find((a) => a.company_id === company.id && a.code === '2000');
  const rent = state.accounts.find((a) => a.company_id === company.id && a.code === '6100');
  const bank = state.accounts.find((a) => a.company_id === company.id && a.code === '1010');
  const purchaseJournal = state.journals.find((j) => j.company_id === company.id && j.code === 'PUR');
  if (!payable || !rent || !purchaseJournal) return;

  const local: DemoPurchaseSupplier = {
    id: uid(),
    company_id: company.id,
    name: 'Atelier Rivière Ltda (DEMO)',
    reference: 'FOUR-DEMO-001',
    country: 'MU',
    address_line1: 'Zone industrielle fictive, Port-Louis',
    city: 'Port-Louis',
    contact_name: 'Camille Exemple',
    contact_phone: '+230 0000 0000',
    contact_email: 'contact@atelier-riviere.demo',
    registration_number: 'DEMO-BRN-F001',
    tax_number: 'DEMO-VAT-F001',
    preferred_currency: 'MUR',
    payment_terms_days: 30,
    payable_account_id: payable.id,
    notes: 'Fournisseur entièrement fictif pour la démonstration.',
    is_active: true,
    created_at: now(),
    updated_at: now(),
  };
  const foreign: DemoPurchaseSupplier = {
    id: uid(),
    company_id: company.id,
    name: 'Oceanic Supplies SARL (DEMO, foreign)',
    reference: 'FOUR-DEMO-EUR',
    country: 'FR',
    address_line1: '1, rue Fictive, 75000 Paris',
    city: 'Paris',
    contact_name: 'Alex Exemple',
    contact_phone: '+33 0 00 00 00 00',
    contact_email: 'contact@oceanic-supplies.demo',
    registration_number: 'DEMO-RCS-000',
    tax_number: 'DEMO-FR-TVA-000',
    preferred_currency: 'EUR',
    payment_terms_days: 45,
    payable_account_id: payable.id,
    notes: 'Fictitious foreign supplier: its currency is tracked separately.',
    is_active: true,
    created_at: now(),
    updated_at: now(),
  };
  state.purchaseSuppliers.push(local, foreign);

  const makeDoc = (
    supplier: DemoPurchaseSupplier,
    kind: 'invoice' | 'credit_note',
    number: number,
    reference: string,
    issueDate: string,
    dueDate: string | null,
    amount: string,
    currency: string,
    exchangeRate: string,
    status: 'draft' | 'validated',
  ): DemoPurchaseDocument => {
    const total = amt(amount);
    const doc: DemoPurchaseDocument = {
      id: uid(),
      company_id: company.id,
      supplier_id: supplier.id,
      kind,
      doc_no: status === 'validated' ? `${kind === 'invoice' ? 'ACH' : 'AVF'}-2026-${String(number).padStart(4, '0')}` : null,
      supplier_reference: reference,
      issue_date: issueDate,
      received_date: issueDate,
      due_date: dueDate,
      currency,
      exchange_rate: exchangeRate,
      subtotal: fmt(total),
      tax_total: '0.0000',
      total_amount: fmt(total),
      amount_paid: '0.0000',
      credited_amount: '0.0000',
      status,
      payment_status: 'unpaid',
      source_document_id: null,
      reason: kind === 'credit_note' ? 'Retour de marchandise fictif' : null,
      notes: 'Document fictif de démonstration.',
      sequence_year: status === 'validated' ? 2026 : null,
      sequence_no: status === 'validated' ? number : null,
      accounting_entry_id: null,
      created_at: now(),
      updated_at: now(),
    };
    state.purchaseDocuments.push(doc);
    state.purchaseLines.push({
      id: uid(),
      document_id: doc.id,
      company_id: company.id,
      line_no: 1,
      description: kind === 'invoice' ? 'Achat fictif de marchandises' : 'Avoir fictif sur achat',
      quantity: '1.0000',
      unit_price: fmt(total),
      account_id: rent.id,
      vat_treatment: 'out_of_scope',
      vat_rate: null,
      vat_rate_id: null,
      vat_recoverable: null,
      net_amount: fmt(total),
      tax_amount: '0.0000',
      line_total: fmt(total),
    });
    state.purchaseSequences[`${company.id}:${kind}:2026`] = Math.max(
      state.purchaseSequences[`${company.id}:${kind}:2026`] ?? 0,
      number,
    );
    return doc;
  };

  const invoice80 = makeDoc(local, 'invoice', 1, 'FAC-DEMO-1001', '2026-02-05', '2026-03-05', '80000.00', 'MUR', '1.00000000', 'validated');
  const invoice60 = makeDoc(local, 'invoice', 2, 'FAC-DEMO-1002', '2026-05-01', '2026-05-31', '60000.00', 'MUR', '1.00000000', 'validated');
  const invoice40 = makeDoc(local, 'invoice', 3, 'FAC-DEMO-1003', '2026-05-10', '2026-06-09', '40000.00', 'MUR', '1.00000000', 'validated');
  const invoice25 = makeDoc(local, 'invoice', 4, 'FAC-DEMO-1004', '2026-04-01', '2026-04-30', '25000.00', 'MUR', '1.00000000', 'validated');
  const invoice12 = makeDoc(local, 'invoice', 5, 'FAC-DEMO-1005', '2026-03-01', '2026-04-10', '12000.00', 'MUR', '1.00000000', 'validated');
  const invoice18 = makeDoc(local, 'invoice', 6, 'FAC-DEMO-1006', '2026-03-01', '2026-03-31', '18000.00', 'MUR', '1.00000000', 'validated');
  makeDoc(local, 'invoice', 7, 'FAC-DEMO-1007', '2026-06-01', '2026-07-01', '9500.00', 'MUR', '1.00000000', 'draft');
  const foreignInvoice = makeDoc(foreign, 'invoice', 1, 'EUR-DEMO-2001', '2026-05-02', '2026-06-16', '1000.00', 'EUR', '50.00000000', 'validated');
  const credit10 = makeDoc(local, 'credit_note', 1, 'AVOIR-DEMO-3001', '2026-04-15', null, '10000.00', 'MUR', '1.00000000', 'validated');
  credit10.source_document_id = invoice25.id;

  const makePayment = (
    number: number,
    supplier: DemoPurchaseSupplier,
    kind: 'payment' | 'advance',
    date: string,
    amount: string,
    currency: string,
    rate: string,
    allocations: { invoice: DemoPurchaseDocument; amount: string }[],
  ): DemoPurchasePayment => {
    const total = amt(amount);
    const allocated = allocations.reduce((sum, a) => sum + amt(a.amount), 0n);
    if (allocated > total) throw new ApiError(409, 'PURCHASE_PAYMENT_ALLOCATION_EXCEEDS_AMOUNT', 'Affectations supérieures au règlement');
    const payment: DemoPurchasePayment = {
      id: uid(),
      company_id: company.id,
      supplier_id: supplier.id,
      payment_no: `RF-2026-${String(number).padStart(4, '0')}`,
      kind,
      payment_date: date,
      amount: fmt(total),
      currency,
      exchange_rate: rate,
      method: 'bank_transfer',
      reference: `DEMO-RF-${number}`,
      unallocated_amount: fmt(total - allocated),
      status: 'recorded',
      sequence_year: 2026,
      sequence_no: number,
      accounting_entry_id: null,
      created_at: now(),
      updated_at: now(),
    };
    state.purchasePayments.push(payment);
    state.purchaseSequences[`${company.id}:payment:2026`] = Math.max(
      state.purchaseSequences[`${company.id}:payment:2026`] ?? 0,
      number,
    );
    allocations.forEach((a) => {
      state.purchaseAllocations.push({
        id: uid(),
        company_id: company.id,
        payment_id: payment.id,
        invoice_id: a.invoice.id,
        amount: a.amount,
        cancelled_at: null,
      });
    });
    event(state, company.id, 'payment.recorded', null, payment.id, { amount: fmt(total), currency }, state.session);
    return payment;
  };

  // A) 80 000 − 30 000 = 50 000 MUR, exact and auditable.
  makePayment(1, local, 'payment', '2026-02-20', '30000.00', 'MUR', '1.00000000', [{ invoice: invoice80, amount: '30000.00' }]);
  // B) one grouped payment covering two invoices (60 000 + 40 000).
  makePayment(2, local, 'payment', '2026-05-25', '100000.00', 'MUR', '1.00000000', [
    { invoice: invoice60, amount: '60000.00' },
    { invoice: invoice40, amount: '40000.00' },
  ]);
  // C) credit note allocated to one invoice.
  state.purchaseCreditAllocations.push({
    id: uid(),
    company_id: company.id,
    credit_note_id: credit10.id,
    invoice_id: invoice25.id,
    amount: '10000.00',
    reason: 'Retour de marchandises fictif',
    cancelled_at: null,
    created_at: now(),
  });
  // D) unallocated advance, proving it settles no invoice.
  makePayment(3, local, 'advance', '2026-05-30', '5000.00', 'MUR', '1.00000000', []);

  state.purchaseDocuments.forEach((doc) => refreshDocument(state, doc));

  // E) one invoice already posted through a balanced demo entry.
  if (bank) {
    const entryId = uid();
    const entry: DemoEntry = {
      id: entryId,
      company_id: company.id,
      journal_id: purchaseJournal.id,
      entry_no: 'PUR-2026-9001',
      entry_date: '2026-03-01',
      reference: invoice18.doc_no,
      description: 'Fictitious purchase bill already posted (DEMO)',
      currency: 'MUR',
      exchange_rate: '1.00000000',
      status: 'posted',
      source: 'purchase',
      reversal_of_entry_id: null,
      posted_at: now(),
      created_at: now(),
    };
    state.entries.push(entry);
    state.lines.push(
      {
        id: uid(), entry_id: entryId, company_id: company.id, account_id: rent.id, line_no: 1,
        description: 'Charge fictive', debit: '18000.0000', credit: '0.0000', txn_amount: null, txn_currency: 'MUR', fx_rate: null,
      },
      {
        id: uid(), entry_id: entryId, company_id: company.id, account_id: payable.id, line_no: 2,
        description: 'Dette fournisseur fictive', debit: '0.0000', credit: '18000.0000', txn_amount: null, txn_currency: 'MUR', fx_rate: null,
      },
    );
    invoice18.accounting_entry_id = entryId;
  }

  // Foreign supplier invoice: a separate EUR balance, never added to MUR.
  foreignInvoice.notes = 'Facture étrangère fictive : 1 000 EUR, devise distincte.';
  state.purchaseDocuments.forEach((doc) => refreshDocument(state, doc));
  void bank;
}

/* -------------------------------------------------------------------------- */
/* Proposal                                                                   */
/* -------------------------------------------------------------------------- */

function addProposal(
  state: DemoState,
  companyId: string,
  data: {
    source_kind: DemoEntryProposal['source_kind'];
    source_id: string;
    reference: string | null;
    description: string;
    currency: string;
    exchangeRate: string;
    journalId: string;
    lines: { accountId: string; description: string; debit: Big; credit: Big }[];
    warnings: string[];
  },
): DemoEntryProposal {
  const existing = state.entryProposals.find(
    (p) => p.company_id === companyId && p.source_kind === data.source_kind && p.source_id === data.source_id && p.status !== 'rejected',
  );
  if (existing) return existing;
  const proposal: DemoEntryProposal = {
    id: uid(),
    company_id: companyId,
    source_kind: data.source_kind,
    source_id: data.source_id,
    journal_id: data.journalId,
    entry_date: new Date().toISOString().slice(0, 10),
    reference: data.reference,
    description: data.description,
    currency: data.currency,
    exchange_rate: data.exchangeRate,
    status: 'proposed',
    confidence: 1,
    rationale: 'Proposition déterministe construite à partir des comptes du plan comptable actif ; aucune validation automatique.',
    warnings: data.warnings,
    missing: [],
    rule_trace: ['Compte de charge de la ligne', 'Compte fournisseur 2000', 'TVA récupérable 1200 si applicable'],
    provider: 'simulated',
    model: 'simulated-fictif',
    created_at: now(),
    updated_at: now(),
    validated_by: null,
    validated_at: null,
    rejected_by: null,
    rejected_at: null,
    rejection_note: null,
    entry_id: null,
  };
  state.entryProposals.push(proposal);
  data.lines.forEach((line, index) => {
    const row: DemoProposalLine = {
      id: uid(),
      proposal_id: proposal.id,
      line_no: index + 1,
      account_id: line.accountId,
      description: line.description,
      debit: fmt(line.debit),
      credit: fmt(line.credit),
      rule_id: null,
    };
    state.proposalLines.push(row);
  });
  return proposal;
}

function proposeDocument(state: DemoState, companyId: string, document: DemoPurchaseDocument): DemoEntryProposal {
  if (document.status !== 'validated') throw new ApiError(409, 'PURCHASE_DOCUMENT_NOT_VALIDATED', 'Le document doit être validé');
  if (document.accounting_entry_id) throw new ApiError(409, 'ACCOUNTING_ALREADY_POSTED', 'Document déjà comptabilisé');
  const payable = accountByCode(state, companyId, '2000');
  const vatInput = accountByCode(state, companyId, '1200');
  const journal = journalByType(state, companyId, ['purchases', 'general']);
  if (!journal) throw new ApiError(409, 'AI_HUMAN_REQUIRED', 'Aucun journal d’achats actif');
  const lines = state.purchaseLines.filter((l) => l.document_id === document.id).sort((a, b) => a.line_no - b.line_no);
  if (lines.length === 0) throw new ApiError(409, 'PURCHASE_DOCUMENT_NO_LINES', 'Document sans ligne');
  const proposalLines: { accountId: string; description: string; debit: Big; credit: Big }[] = [];
  for (const line of lines) {
    const net = amt(line.net_amount);
    const tax = amt(line.tax_amount);
    if (document.kind === 'invoice') {
      proposalLines.push({ accountId: line.account_id, description: line.description, debit: net, credit: 0n });
      if (tax > 0n) {
        if (line.vat_recoverable === true) {
          proposalLines.push({ accountId: vatInput.id, description: `TVA récupérable — ${line.description}`, debit: tax, credit: 0n });
        } else {
          proposalLines.push({ accountId: line.account_id, description: `TVA non récupérable — ${line.description}`, debit: tax, credit: 0n });
        }
      }
    } else {
      proposalLines.push({ accountId: line.account_id, description: line.description, debit: 0n, credit: net });
      if (tax > 0n) {
        proposalLines.push({
          accountId: line.vat_recoverable === true ? vatInput.id : line.account_id,
          description: `TVA — ${line.description}`,
          debit: 0n,
          credit: tax,
        });
      }
    }
  }
  const total = amt(document.total_amount);
  if (document.kind === 'invoice') {
    proposalLines.push({ accountId: payable.id, description: 'Dette fournisseur', debit: 0n, credit: total });
  } else {
    proposalLines.push({ accountId: payable.id, description: 'Réduction de dette fournisseur', debit: total, credit: 0n });
  }
  return addProposal(state, companyId, {
    source_kind: document.kind === 'invoice' ? 'purchase_invoice' : 'purchase_credit_note',
    source_id: document.id,
    reference: document.doc_no,
    description: `${document.kind === 'invoice' ? 'Facture d’achat' : 'Avoir fournisseur'} ${document.doc_no ?? document.supplier_reference}`,
    currency: document.currency,
    exchangeRate: document.exchange_rate,
    journalId: journal.id,
    lines: proposalLines,
    warnings: ['Proposition non comptabilisée : validation puis comptabilisation humaines requises.'],
  });
}

function proposePayment(state: DemoState, companyId: string, payment: DemoPurchasePayment): DemoEntryProposal {
  if (payment.status !== 'recorded') throw new ApiError(409, 'PURCHASE_PAYMENT_CANCELLED', 'Règlement annulé');
  if (payment.accounting_entry_id) throw new ApiError(409, 'ACCOUNTING_ALREADY_POSTED', 'Règlement déjà comptabilisé');
  const payable = accountByCode(state, companyId, '2000');
  const advance = accountByCode(state, companyId, '1150');
  const bank = accountByCode(state, companyId, payment.method === 'cash' ? '1000' : '1010');
  const journal = journalByType(state, companyId, ['bank', 'cash', 'general']);
  if (!journal) throw new ApiError(409, 'AI_HUMAN_REQUIRED', 'Aucun journal de trésorerie actif');
  const total = amt(payment.amount);
  const allocated = state.purchaseAllocations
    .filter((a) => a.payment_id === payment.id && !a.cancelled_at)
    .reduce((sum, a) => sum + amt(a.amount), 0n);
  const unallocated = total - allocated;
  const lines: { accountId: string; description: string; debit: Big; credit: Big }[] = [];
  if (allocated > 0n) lines.push({ accountId: payable.id, description: 'Règlement fournisseur', debit: allocated, credit: 0n });
  if (unallocated > 0n) lines.push({ accountId: advance.id, description: 'Acompte fournisseur non affecté', debit: unallocated, credit: 0n });
  lines.push({ accountId: bank.id, description: 'Décaissement fournisseur', debit: 0n, credit: total });
  return addProposal(state, companyId, {
    source_kind: 'purchase_payment',
    source_id: payment.id,
    reference: payment.payment_no,
    description: `Règlement fournisseur ${payment.payment_no ?? ''}`.trim(),
    currency: payment.currency,
    exchangeRate: payment.exchange_rate,
    journalId: journal.id,
    lines,
    warnings: [
      'Un acompte non affecté reste au compte 1150 et ne solde aucune facture.',
      'Aucune écriture n’est créée avant validation et comptabilisation humaines.',
    ],
  });
}

/* -------------------------------------------------------------------------- */
/* Router                                                                     */
/* -------------------------------------------------------------------------- */

export function handleDemoPurchases(
  state: DemoState,
  companyId: string,
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  rest: string,
  query: URLSearchParams,
  payload: Record<string, any>,
): unknown | undefined {
  if (!rest.startsWith('/purchases')) return undefined;
  const path = rest.slice('/purchases'.length) || '/';
  const company = state.companies.find((c) => c.id === companyId);
  if (!company) throw new ApiError(404, 'COMPANY_NOT_FOUND', 'Société introuvable');
  const actor = state.session;

  if (path === '/suppliers' && method === 'GET') {
    const includeInactive = query.get('includeInactive') === 'true';
    const search = (query.get('query') ?? '').toLowerCase();
    const suppliers = state.purchaseSuppliers
      .filter((s) => s.company_id === companyId && (includeInactive || s.is_active))
      .filter((s) => !search || `${s.name} ${s.reference ?? ''} ${s.tax_number ?? ''}`.toLowerCase().includes(search))
      .sort((a, b) => a.name.localeCompare(b.name));
    return { suppliers };
  }

  if (path === '/suppliers' && method === 'POST') {
    const name = String(payload.name ?? '').trim();
    if (name === '') throw new ApiError(400, 'VALIDATION_ERROR', 'Raison sociale requise');
    const country = String(payload.country ?? 'MU').trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(country)) throw new ApiError(400, 'VALIDATION_ERROR', 'Pays invalide (ISO 2 lettres)');
    const duplicate = state.purchaseSuppliers.find(
      (s) => s.company_id === companyId && s.name.trim().toLowerCase() === name.toLowerCase(),
    );
    if (duplicate) {
      throw new ApiError(409, 'SUPPLIER_POTENTIAL_DUPLICATE', 'Un fournisseur porte déjà ce nom ; aucune fusion automatique', {
        candidates: [{ id: duplicate.id, name: duplicate.name }],
      });
    }
    const supplier: DemoPurchaseSupplier = {
      id: uid(),
      company_id: companyId,
      name,
      reference: payload.reference ? String(payload.reference) : null,
      country,
      address_line1: payload.addressLine1 ? String(payload.addressLine1) : null,
      city: payload.city ? String(payload.city) : null,
      contact_name: payload.contactName ? String(payload.contactName) : null,
      contact_phone: payload.contactPhone ? String(payload.contactPhone) : null,
      contact_email: payload.contactEmail ? String(payload.contactEmail) : null,
      registration_number: payload.registrationNumber ? String(payload.registrationNumber) : null,
      tax_number: payload.taxNumber ? String(payload.taxNumber) : null,
      preferred_currency: payload.preferredCurrency ? String(payload.preferredCurrency).toUpperCase() : null,
      payment_terms_days: payload.paymentTermsDays === undefined || payload.paymentTermsDays === null ? null : Number(payload.paymentTermsDays),
      payable_account_id: payload.payableAccountId ? String(payload.payableAccountId) : null,
      notes: payload.notes ? String(payload.notes) : null,
      is_active: payload.isActive === undefined ? true : Boolean(payload.isActive),
      created_at: now(),
      updated_at: now(),
    };
    if (supplier.payable_account_id) {
      const account = state.accounts.find((a) => a.id === supplier.payable_account_id && a.company_id === companyId);
      if (!account || !account.is_active || account.type !== 'liability') {
        throw new ApiError(400, 'SUPPLIER_PAYABLE_ACCOUNT_INVALID', 'Compte fournisseur invalide ou inactif');
      }
    }
    state.purchaseSuppliers.push(supplier);
    event(state, companyId, 'supplier.created', null, null, { name }, actor);
    return { supplier };
  }

  if (path === '/suppliers/duplicates/check' && method === 'POST') {
    const name = String(payload.name ?? '').trim().toLowerCase();
    const tax = String(payload.taxNumber ?? '').trim().toLowerCase();
    const reference = String(payload.reference ?? '').trim().toLowerCase();
    const candidates = state.purchaseSuppliers.filter(
      (s) =>
        s.company_id === companyId &&
        ((name && s.name.toLowerCase().includes(name)) ||
          (tax && (s.tax_number ?? '').toLowerCase() === tax) ||
          (reference && (s.reference ?? '').toLowerCase() === reference)),
    );
    return { candidates, mergePerformed: false, requiresHumanDecision: true };
  }

  const supplierMatch = /^\/suppliers\/([0-9a-f-]{36})(\/balance|\/history)?$/.exec(path);
  if (supplierMatch) {
    const supplier = supplierOf(state, companyId, supplierMatch[1]!);
    const action = supplierMatch[2];
    if (action === '/balance' && method === 'GET') {
      const currencies = new Map<string, { currency: string; invoiced: Big; paid: Big; credited: Big; outstanding: Big; overdue: Big; dueSoon: Big; invoiceCount: number; overdueCount: number }>();
      state.purchaseDocuments
        .filter((d) => d.company_id === companyId && d.supplier_id === supplier.id && d.kind === 'invoice' && d.status === 'validated')
        .forEach((doc) => {
          const row = currencies.get(doc.currency) ?? {
            currency: doc.currency, invoiced: 0n, paid: 0n, credited: 0n, outstanding: 0n, overdue: 0n, dueSoon: 0n, invoiceCount: 0, overdueCount: 0,
          };
          row.invoiced += amt(doc.total_amount);
          row.paid += amt(doc.amount_paid);
          row.credited += amt(doc.credited_amount);
          const outstanding = outstandingOf(state, doc);
          row.outstanding += outstanding;
          row.invoiceCount += 1;
          if (outstanding > 0n && doc.due_date && doc.due_date < new Date().toISOString().slice(0, 10)) {
            row.overdue += outstanding;
            row.overdueCount += 1;
          }
          currencies.set(doc.currency, row);
        });
      const creditAvailable = [...currencies.keys()].map((currency) => ({
        currency,
        amount: fmt(
          state.purchaseDocuments
            .filter((d) => d.company_id === companyId && d.supplier_id === supplier.id && d.kind === 'credit_note' && d.status === 'validated' && d.currency === currency)
            .reduce((sum, d) => sum + creditAvailableOf(state, d), 0n),
        ),
      }));
      return {
        supplier,
        balances: [...currencies.values()].map((r) => ({
          currency: r.currency, invoiced: fmt(r.invoiced), paid: fmt(r.paid), credited: fmt(r.credited),
          outstanding: fmt(r.outstanding), overdue: fmt(r.overdue), dueSoon: fmt(r.dueSoon),
          invoiceCount: r.invoiceCount, overdueCount: r.overdueCount,
        })),
        creditAvailable,
      };
    }
    if (action === '/history' && method === 'GET') {
      const docs = state.purchaseDocuments
        .filter((d) => d.company_id === companyId && d.supplier_id === supplier.id)
        .map((d) => documentView(state, d));
      const payments = state.purchasePayments
        .filter((p) => p.company_id === companyId && p.supplier_id === supplier.id)
        .map((p) => paymentView(state, p));
      return { events: state.purchaseEvents.filter((e) => e.company_id === companyId), documents: docs, payments };
    }
    if (method === 'GET') return { supplier };
    if (method === 'PATCH') {
      if (payload.name !== undefined) {
        const name = String(payload.name).trim();
        if (!name) throw new ApiError(400, 'VALIDATION_ERROR', 'Raison sociale requise');
        supplier.name = name;
      }
      if (payload.country !== undefined) supplier.country = String(payload.country).toUpperCase();
      if (payload.isActive !== undefined) supplier.is_active = Boolean(payload.isActive);
      if (payload.notes !== undefined) supplier.notes = payload.notes === null ? null : String(payload.notes);
      supplier.updated_at = now();
      event(state, companyId, 'supplier.updated', null, null, { id: supplier.id }, actor);
      return { supplier };
    }
  }

  if (path === '/documents/duplicates/check' && method === 'POST') {
    const supplierId = String(payload.supplierId ?? '');
    const reference = String(payload.supplierReference ?? '').trim().toLowerCase();
    const total = payload.total === undefined ? null : amt(payload.total);
    const candidates = state.purchaseDocuments.filter(
      (d) =>
        d.company_id === companyId &&
        d.supplier_id === supplierId &&
        d.status !== 'cancelled' &&
        ((reference && d.supplier_reference.toLowerCase() === reference) ||
          (total !== null && total > 0n && amt(d.total_amount) === total && d.issue_date === String(payload.issueDate ?? ''))),
    );
    return { candidates: candidates.map((d) => documentView(state, d)), mergePerformed: false };
  }

  if (path === '/documents' && method === 'GET') {
    const kind = query.get('kind');
    const status = query.get('status');
    const supplierId = query.get('supplierId');
    const dueOnly = query.get('dueOnly') === 'true';
    const documents = state.purchaseDocuments
      .filter((d) => d.company_id === companyId)
      .filter((d) => !kind || d.kind === kind)
      .filter((d) => !status || d.status === status)
      .filter((d) => !supplierId || d.supplier_id === supplierId)
      .filter((d) => !dueOnly || (d.kind === 'invoice' && d.status === 'validated' && outstandingOf(state, d) > 0n))
      .sort((a, b) => (a.issue_date < b.issue_date ? 1 : -1))
      .map((d) => documentView(state, d));
    return { documents };
  }

  if (path === '/documents' && method === 'POST') {
    const supplier = supplierOf(state, companyId, String(payload.supplierId ?? ''));
    if (!supplier.is_active) throw new ApiError(409, 'SUPPLIER_INACTIVE', 'Fournisseur inactif');
    const kind = String(payload.kind ?? 'invoice');
    if (kind !== 'invoice' && kind !== 'credit_note') throw new ApiError(400, 'VALIDATION_ERROR', 'Type de document invalide');
    const reference = String(payload.supplierReference ?? '').trim();
    if (!reference) throw new ApiError(400, 'VALIDATION_ERROR', 'Référence fournisseur requise');
    const issueDate = String(payload.issueDate ?? '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(issueDate)) throw new ApiError(400, 'VALIDATION_ERROR', 'Date invalide');
    const dueDate = payload.dueDate ? String(payload.dueDate) : null;
    if (dueDate && dueDate < issueDate) throw new ApiError(400, 'PURCHASE_DUE_DATE_BEFORE_ISSUE', 'Échéance antérieure à la date du document');
    const duplicate = state.purchaseDocuments.find(
      (d) => d.company_id === companyId && d.supplier_id === supplier.id && d.status !== 'cancelled' && d.supplier_reference.toLowerCase() === reference.toLowerCase(),
    );
    if (duplicate) {
      throw new ApiError(409, 'PURCHASE_DOCUMENT_DUPLICATE', 'Numéro fournisseur déjà utilisé pour ce fournisseur', {
        candidates: [documentView(state, duplicate)],
      });
    }
    if (kind === 'credit_note' && payload.sourceDocumentId) {
      const source = documentOf(state, companyId, String(payload.sourceDocumentId));
      if (source.supplier_id !== supplier.id) throw new ApiError(409, 'PURCHASE_CREDIT_SUPPLIER_MISMATCH', 'Avoir lié à un autre fournisseur');
    }
    const document: DemoPurchaseDocument = {
      id: uid(),
      company_id: companyId,
      supplier_id: supplier.id,
      kind,
      doc_no: null,
      supplier_reference: reference,
      issue_date: issueDate,
      received_date: payload.receivedDate ? String(payload.receivedDate) : null,
      due_date: dueDate,
      currency: String(payload.currency ?? functional(state, companyId)).toUpperCase(),
      exchange_rate: assertCurrency(state, companyId, String(payload.currency ?? functional(state, companyId)), payload.exchangeRate),
      subtotal: '0.0000',
      tax_total: '0.0000',
      total_amount: '0.0000',
      amount_paid: '0.0000',
      credited_amount: '0.0000',
      status: 'draft',
      payment_status: 'unpaid',
      source_document_id: kind === 'credit_note' && payload.sourceDocumentId ? String(payload.sourceDocumentId) : null,
      reason: kind === 'credit_note' && payload.reason ? String(payload.reason) : null,
      notes: payload.description ? String(payload.description) : null,
      sequence_year: null,
      sequence_no: null,
      accounting_entry_id: null,
      created_at: now(),
      updated_at: now(),
    };
    state.purchaseDocuments.push(document);
    const totals = createDocumentLines(state, companyId, document, linesPayload(payload));
    document.subtotal = fmt(totals.subtotal);
    document.tax_total = fmt(totals.tax);
    document.total_amount = fmt(totals.total);
    event(state, companyId, 'document.created', document.id, null, { kind, reference }, actor);
    return { document: documentView(state, document) };
  }

  const documentMatch = /^\/documents\/([0-9a-f-]{36})(\/validate|\/cancel|\/proposal|\/events)?$/.exec(path);
  if (documentMatch) {
    const document = documentOf(state, companyId, documentMatch[1]!);
    const action = documentMatch[2];
    if (action === '/events' && method === 'GET') {
      return { events: state.purchaseEvents.filter((e) => e.company_id === companyId && e.document_id === document.id) };
    }
    if (action === '/validate' && method === 'POST') {
      if (document.status !== 'draft') throw new ApiError(409, 'PURCHASE_DOCUMENT_NOT_DRAFT', 'Seul un brouillon peut être validé');
      const supplier = supplierOf(state, companyId, document.supplier_id);
      if (!supplier.is_active) throw new ApiError(409, 'SUPPLIER_INACTIVE', 'Fournisseur inactif');
      const year = Number(document.issue_date.slice(0, 4));
      const number = nextNumber(state, companyId, document.kind, year);
      document.doc_no = number.label;
      document.sequence_year = number.year;
      document.sequence_no = number.no;
      document.status = 'validated';
      document.updated_at = now();
      event(state, companyId, 'document.validated', document.id, null, { docNo: document.doc_no }, actor);
      return { document: documentView(state, document) };
    }
    if (action === '/cancel' && method === 'POST') {
      if (document.accounting_entry_id) {
        throw new ApiError(409, 'PURCHASE_ACCOUNTING_POSTED', 'Une facture comptabilisée ne peut être annulée : contrepassation humaine requise');
      }
      if (document.status === 'cancelled') throw new ApiError(409, 'PURCHASE_DOCUMENT_CANCELLED', 'Document déjà annulé');
      const used = document.kind === 'invoice'
        ? state.purchaseAllocations.some((a) => a.invoice_id === document.id && !a.cancelled_at) ||
          state.purchaseCreditAllocations.some((a) => a.invoice_id === document.id && !a.cancelled_at)
        : creditUsedOf(state, document.id) > 0n;
      if (used) throw new ApiError(409, 'PURCHASE_DOCUMENT_HAS_ALLOCATIONS', 'Désaffectez d’abord les règlements ou avoirs');
      document.status = 'cancelled';
      document.updated_at = now();
      event(state, companyId, 'document.cancelled', document.id, null, { reason: payload.reason ?? null }, actor);
      return { document: documentView(state, document) };
    }
    if (action === '/proposal' && method === 'POST') {
      const proposal = proposeDocument(state, companyId, document);
      return { proposal, reused: false };
    }
    if (action === '' && method === 'GET') return { document: documentView(state, document) };
    if (action === '' && method === 'PATCH') {
      if (document.status !== 'draft') throw new ApiError(409, 'PURCHASE_DOCUMENT_LOCKED', 'Document validé non modifiable');
      if (payload.supplierReference !== undefined) document.supplier_reference = String(payload.supplierReference);
      if (payload.dueDate !== undefined) document.due_date = payload.dueDate ? String(payload.dueDate) : null;
      if (payload.description !== undefined) document.notes = payload.description ? String(payload.description) : null;
      if (Array.isArray(payload.lines)) {
        state.purchaseLines = state.purchaseLines.filter((l) => l.document_id !== document.id);
        const totals = createDocumentLines(state, companyId, document, linesPayload(payload));
        document.subtotal = fmt(totals.subtotal);
        document.tax_total = fmt(totals.tax);
        document.total_amount = fmt(totals.total);
      }
      document.updated_at = now();
      return { document: documentView(state, document) };
    }
  }

  if (path === '/payments' && method === 'GET') {
    const supplierId = query.get('supplierId');
    const payments = state.purchasePayments
      .filter((p) => p.company_id === companyId)
      .filter((p) => !supplierId || p.supplier_id === supplierId)
      .sort((a, b) => (a.payment_date < b.payment_date ? 1 : -1))
      .map((p) => paymentView(state, p));
    return { payments };
  }

  if (path === '/payments' && method === 'POST') {
    const supplier = supplierOf(state, companyId, String(payload.supplierId ?? ''));
    if (!supplier.is_active) throw new ApiError(409, 'SUPPLIER_INACTIVE', 'Fournisseur inactif');
    const amount = amt(payload.amount);
    if (amount <= 0n) throw new ApiError(400, 'VALIDATION_ERROR', 'Montant strictement positif requis');
    const kind = payload.kind === 'advance' ? 'advance' : 'payment';
    const currency = String(payload.currency ?? functional(state, companyId)).toUpperCase();
    const rate = assertCurrency(state, companyId, currency, payload.exchangeRate);
    const allocationsPayload = Array.isArray(payload.allocations) ? (payload.allocations as Record<string, any>[]) : [];
    if (kind === 'advance' && allocationsPayload.length > 0) {
      throw new ApiError(409, 'PURCHASE_ADVANCE_ALLOCATION_FORBIDDEN', 'Un acompte ne s’affecte pas à la création');
    }
    if (kind === 'payment' && allocationsPayload.length === 0) {
      throw new ApiError(409, 'PURCHASE_PAYMENT_WITHOUT_ALLOCATION', 'Un règlement doit cibler au moins une facture (ou être un acompte)');
    }
    let allocatedTotal = 0n;
    const prepared = allocationsPayload.map((row) => {
      const invoice = documentOf(state, companyId, String(row.invoiceId ?? ''));
      if (invoice.kind !== 'invoice') throw new ApiError(409, 'PURCHASE_NOT_AN_INVOICE', 'Seule une facture peut être réglée');
      if (invoice.status !== 'validated') throw new ApiError(409, 'PURCHASE_DOCUMENT_NOT_VALIDATED', 'Facture non validée');
      if (invoice.supplier_id !== supplier.id) throw new ApiError(409, 'PURCHASE_SUPPLIER_MISMATCH', 'Facture d’un autre fournisseur');
      if (invoice.currency !== currency) throw new ApiError(409, 'PURCHASE_CURRENCY_MISMATCH', 'Devise du règlement différente de la facture');
      const value = amt(row.amount);
      if (value <= 0n) throw new ApiError(400, 'VALIDATION_ERROR', 'Affectation strictement positive requise');
      const outstanding = outstandingOf(state, invoice);
      if (value > outstanding) throw new ApiError(409, 'PURCHASE_ALLOCATION_EXCEEDS_OUTSTANDING', 'Affectation supérieure au restant dû');
      allocatedTotal += value;
      return { invoice, value };
    });
    if (allocatedTotal > amount) throw new ApiError(409, 'PURCHASE_PAYMENT_ALLOCATION_EXCEEDS_AMOUNT', 'Affectations supérieures au règlement');
    const year = Number(String(payload.paymentDate ?? '').slice(0, 4)) || new Date().getFullYear();
    const number = nextNumber(state, companyId, 'payment', year);
    const payment: DemoPurchasePayment = {
      id: uid(),
      company_id: companyId,
      supplier_id: supplier.id,
      payment_no: number.label,
      kind,
      payment_date: String(payload.paymentDate ?? new Date().toISOString().slice(0, 10)),
      amount: fmt(amount),
      currency,
      exchange_rate: rate,
      method: String(payload.method ?? 'bank_transfer'),
      reference: payload.reference ? String(payload.reference) : null,
      unallocated_amount: fmt(amount - allocatedTotal),
      status: 'recorded',
      sequence_year: number.year,
      sequence_no: number.no,
      accounting_entry_id: null,
      created_at: now(),
      updated_at: now(),
    };
    state.purchasePayments.push(payment);
    prepared.forEach(({ invoice, value }) => {
      const allocation: DemoPurchaseAllocation = {
        id: uid(),
        company_id: companyId,
        payment_id: payment.id,
        invoice_id: invoice.id,
        amount: fmt(value),
        cancelled_at: null,
      };
      state.purchaseAllocations.push(allocation);
      refreshDocument(state, invoice);
    });
    event(state, companyId, 'payment.recorded', null, payment.id, { amount: fmt(amount), currency, allocations: prepared.length }, actor);
    return { payment: paymentView(state, payment) };
  }

  const paymentMatch = /^\/payments\/([0-9a-f-]{36})(\/cancel|\/proposal)?$/.exec(path);
  if (paymentMatch) {
    const payment = paymentOf(state, companyId, paymentMatch[1]!);
    const action = paymentMatch[2];
    if (action === '/cancel' && method === 'POST') {
      if (payment.accounting_entry_id) throw new ApiError(409, 'PURCHASE_ACCOUNTING_POSTED', 'Règlement comptabilisé : contrepassation requise');
      if (payment.status === 'cancelled') throw new ApiError(409, 'PURCHASE_PAYMENT_CANCELLED', 'Règlement déjà annulé');
      state.purchaseAllocations
        .filter((a) => a.payment_id === payment.id && !a.cancelled_at)
        .forEach((a) => {
          a.cancelled_at = now();
          const invoice = state.purchaseDocuments.find((d) => d.id === a.invoice_id);
          if (invoice) refreshDocument(state, invoice);
        });
      payment.status = 'cancelled';
      payment.unallocated_amount = '0.0000';
      payment.updated_at = now();
      event(state, companyId, 'payment.cancelled', null, payment.id, { reason: payload.reason ?? null }, actor);
      return { payment: paymentView(state, payment) };
    }
    if (action === '/proposal' && method === 'POST') {
      return { proposal: proposePayment(state, companyId, payment), reused: false };
    }
    if (action === '' && method === 'GET') return { payment: paymentView(state, payment) };
  }

  const creditMatch = /^\/credit-notes\/([0-9a-f-]{36})\/allocations$/.exec(path);
  if (creditMatch && method === 'POST') {
    const credit = documentOf(state, companyId, creditMatch[1]!);
    if (credit.kind !== 'credit_note') throw new ApiError(409, 'PURCHASE_NOT_A_CREDIT_NOTE', 'Document non avoir');
    if (credit.status !== 'validated') throw new ApiError(409, 'PURCHASE_DOCUMENT_NOT_VALIDATED', 'Avoir non validé');
    const invoice = documentOf(state, companyId, String(payload.invoiceId ?? ''));
    if (invoice.kind !== 'invoice' || invoice.status !== 'validated') throw new ApiError(409, 'PURCHASE_NOT_AN_INVOICE', 'Facture cible invalide');
    if (invoice.supplier_id !== credit.supplier_id) throw new ApiError(409, 'PURCHASE_SUPPLIER_MISMATCH', 'Avoir et facture de fournisseurs différents');
    if (invoice.currency !== credit.currency) throw new ApiError(409, 'PURCHASE_CURRENCY_MISMATCH', 'Devises différentes');
    const value = amt(payload.amount);
    if (value <= 0n) throw new ApiError(400, 'VALIDATION_ERROR', 'Montant strictement positif requis');
    if (payload.confirm !== true) throw new ApiError(400, 'PURCHASE_CONFIRMATION_REQUIRED', 'Confirmation humaine requise');
    if (value > creditAvailableOf(state, credit)) throw new ApiError(409, 'PURCHASE_CREDIT_EXCEEDS_AVAILABLE', 'Montant supérieur à l’avoir disponible');
    if (value > outstandingOf(state, invoice)) throw new ApiError(409, 'PURCHASE_ALLOCATION_EXCEEDS_OUTSTANDING', 'Montant supérieur au restant dû');
    const allocation: DemoPurchaseCreditAllocation = {
      id: uid(),
      company_id: companyId,
      credit_note_id: credit.id,
      invoice_id: invoice.id,
      amount: fmt(value),
      reason: payload.reason ? String(payload.reason) : null,
      cancelled_at: null,
      created_at: now(),
    };
    state.purchaseCreditAllocations.push(allocation);
    refreshDocument(state, credit);
    refreshDocument(state, invoice);
    event(state, companyId, 'credit.allocated', invoice.id, null, { creditNoteId: credit.id, amount: fmt(value) }, actor);
    return { allocation, invoice: documentView(state, invoice), creditNote: documentView(state, credit) };
  }
  const creditDelete = /^\/credit-notes\/([0-9a-f-]{36})\/allocations\/([0-9a-f-]{36})$/.exec(path);
  if (creditDelete && method === 'DELETE') {
    const allocation = state.purchaseCreditAllocations.find(
      (a) => a.id === creditDelete[2] && a.credit_note_id === creditDelete[1] && a.company_id === companyId,
    );
    if (!allocation) throw new ApiError(404, 'PURCHASE_ALLOCATION_NOT_FOUND', 'Affectation introuvable');
    if (payload.confirm !== true) throw new ApiError(400, 'PURCHASE_CONFIRMATION_REQUIRED', 'Confirmation humaine requise');
    allocation.cancelled_at = now();
    const credit = documentOf(state, companyId, allocation.credit_note_id);
    const invoice = documentOf(state, companyId, allocation.invoice_id);
    refreshDocument(state, credit);
    refreshDocument(state, invoice);
    event(state, companyId, 'credit.unallocated', invoice.id, null, { allocationId: allocation.id }, actor);
    return { cancelled: true };
  }

  if (creditMatch && method === 'GET') {
    return {
      allocations: state.purchaseCreditAllocations
        .filter((a) => a.company_id === companyId && a.credit_note_id === creditMatch[1])
        .map((a) => ({ ...a, cancelledAt: a.cancelled_at })),
    };
  }

  if (path === '/aging' && method === 'GET') {
    return { aging: buildAging(state, companyId, String(query.get('asOf') ?? new Date().toISOString().slice(0, 10))) };
  }

  if (path === '/aging.csv' && method === 'GET') {
    const aging = buildAging(state, companyId, new Date().toISOString().slice(0, 10));
    const rows = ['Fournisseur;Devise;Facture;Référence;Échéance;Total;Payé;Avoir;Restant;Retard (jours)'];
    aging.groups.forEach((group) => {
      group.invoices.forEach((invoice) => {
        rows.push(
          [
            group.supplierName, group.currency, invoice.docNo ?? '', invoice.supplierReference,
            invoice.dueDate ?? '', invoice.total, invoice.paid, invoice.credited, invoice.outstanding,
            String(invoice.daysOverdue),
          ].join(';'),
        );
      });
    });
    rows.push('');
    rows.push('Totaux par devise (jamais additionnés entre devises)');
    aging.totalsByCurrency.forEach((total) => {
      rows.push(`${total.currency};${total.outstanding};${total.overdue};${total.invoices}`);
    });
    return rows.join('\r\n');
  }

  if (path === '/dashboard' && method === 'GET') {
    const documents = state.purchaseDocuments.filter((d) => d.company_id === companyId);
    const payments = state.purchasePayments.filter((p) => p.company_id === companyId);
    const aging = buildAging(state, companyId, new Date().toISOString().slice(0, 10));
    return {
      dashboard: {
        suppliers: {
          total: state.purchaseSuppliers.filter((s) => s.company_id === companyId).length,
          active: state.purchaseSuppliers.filter((s) => s.company_id === companyId && s.is_active).length,
        },
        documents: {
          total: documents.length,
          invoices: documents.filter((d) => d.kind === 'invoice' && d.status === 'validated').length,
          creditNotes: documents.filter((d) => d.kind === 'credit_note' && d.status === 'validated').length,
          drafts: documents.filter((d) => d.status === 'draft').length,
          cancelled: documents.filter((d) => d.status === 'cancelled').length,
          awaitingAccounting: documents.filter((d) => d.status === 'validated' && !d.accounting_entry_id).length,
        },
        payments: {
          total: payments.filter((p) => p.status === 'recorded').length,
          awaitingAccounting: payments.filter((p) => p.status === 'recorded' && !p.accounting_entry_id).length,
          advances: payments.filter((p) => p.kind === 'advance' && p.status === 'recorded').length,
        },
        aging: { summary: aging.summary, totalsByCurrency: aging.totalsByCurrency },
      },
    };
  }

  return undefined;
}

function buildAging(state: DemoState, companyId: string, asOf: string) {
  const today = asOf;
  const documents = state.purchaseDocuments.filter(
    (d) => d.company_id === companyId && d.kind === 'invoice' && d.status === 'validated' && outstandingOf(state, d) > 0n,
  );
  const groupsMap = new Map<string, {
    supplierId: string; supplierName: string; currency: string; outstanding: Big; overdue: Big;
    invoices: {
      id: string; docNo: string | null; supplierReference: string; dueDate: string | null;
      total: string; paid: string; credited: string; outstanding: string;
      daysOverdue: number; bucket: string; accountingPosted: boolean;
    }[];
  }>();
  const summaryMap = new Map<string, { currency: string; invoiced: Big; paid: Big; credited: Big; outstanding: Big; overdue: Big; dueSoon: Big; invoiceCount: number; overdueCount: number }>();
  for (const doc of documents) {
    const supplier = state.purchaseSuppliers.find((s) => s.id === doc.supplier_id);
    const outstanding = outstandingOf(state, doc);
    const overdue = doc.due_date && doc.due_date < today ? outstanding : 0n;
    const dueSoon = doc.due_date && doc.due_date >= today && doc.due_date <= addDays(today, 30) ? outstanding : 0n;
    const daysOverdue = doc.due_date && doc.due_date < today
      ? Math.max(0, Math.round((Date.parse(today) - Date.parse(doc.due_date)) / 86_400_000))
      : 0;
    const bucket = daysOverdue === 0 ? 'not_due' : daysOverdue <= 30 ? '1_30' : daysOverdue <= 60 ? '31_60' : daysOverdue <= 90 ? '61_90' : 'over_90';
    const key = `${doc.supplier_id}:${doc.currency}`;
    const group = groupsMap.get(key) ?? {
      supplierId: doc.supplier_id,
      supplierName: supplier?.name ?? '',
      currency: doc.currency,
      outstanding: 0n,
      overdue: 0n,
      invoices: [],
    };
    group.outstanding += outstanding;
    group.overdue += overdue;
    group.invoices.push({
      id: doc.id,
      docNo: doc.doc_no,
      supplierReference: doc.supplier_reference,
      dueDate: doc.due_date,
      total: doc.total_amount,
      paid: doc.amount_paid,
      credited: doc.credited_amount,
      outstanding: fmt(outstanding),
      daysOverdue,
      bucket,
      accountingPosted: Boolean(doc.accounting_entry_id),
    });
    groupsMap.set(key, group);
    const summary = summaryMap.get(doc.currency) ?? {
      currency: doc.currency, invoiced: 0n, paid: 0n, credited: 0n, outstanding: 0n, overdue: 0n, dueSoon: 0n, invoiceCount: 0, overdueCount: 0,
    };
    summary.invoiced += amt(doc.total_amount);
    summary.paid += amt(doc.amount_paid);
    summary.credited += amt(doc.credited_amount);
    summary.outstanding += outstanding;
    summary.overdue += overdue;
    summary.dueSoon += dueSoon;
    summary.invoiceCount += 1;
    if (overdue > 0n) summary.overdueCount += 1;
    summaryMap.set(doc.currency, summary);
  }
  const groups = [...groupsMap.values()]
    .map((g) => ({ ...g, outstanding: fmt(g.outstanding), overdue: fmt(g.overdue) }))
    .sort((a, b) => a.supplierName.localeCompare(b.supplierName) || a.currency.localeCompare(b.currency));
  const summary = [...summaryMap.values()]
    .map((s) => ({
      currency: s.currency, invoiced: fmt(s.invoiced), paid: fmt(s.paid), credited: fmt(s.credited),
      outstanding: fmt(s.outstanding), overdue: fmt(s.overdue), dueSoon: fmt(s.dueSoon),
      invoiceCount: s.invoiceCount, overdueCount: s.overdueCount,
    }))
    .sort((a, b) => a.currency.localeCompare(b.currency));
  return {
    asOf,
    summary,
    groups,
    totalsByCurrency: summary.map((s) => ({
      currency: s.currency, outstanding: s.outstanding, overdue: s.overdue, dueSoon: s.dueSoon, invoices: s.invoiceCount,
    })),
  };
}

function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
