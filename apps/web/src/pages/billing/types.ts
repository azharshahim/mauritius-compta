/** Types partagés par les écrans de facturation. */
export interface BillingSettings {
  settings: {
    quotePrefix: string;
    invoicePrefix: string;
    creditPrefix: string;
    numberingPolicy: 'yearly' | 'continuous';
    defaultPaymentTerms: number;
    defaultCurrency: string;
    vatEnabled: boolean;
    legalFooterFr: string | null;
    legalFooterEn: string | null;
    bankDetails: string | null;
  };
  capabilities: {
    numbering: boolean;
    sequentialNumbering: boolean;
    vatComputation: boolean;
    vatRatesConfigured: number;
    mraEInvoicing: boolean;
    eInvoicingNotice: string;
    postingToAccounting: boolean;
    postingMode: string;
    pdf: boolean;
    pdfDemoNotice?: string;
    multiCurrency: boolean;
    duplicateDetection: string;
  };
}

export interface Customer {
  id: string;
  name: string;
  legalName: string | null;
  brn: string | null;
  vatNumber: string | null;
  addressLine1: string | null;
  city: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  preferredCurrency: string | null;
  paymentTermsDays: number | null;
  notes: string | null;
  isActive: boolean;
  archivedAt: string | null;
}

export interface DocumentLine {
  id?: string;
  lineNo?: number;
  itemId: string | null;
  description: string;
  quantity: string;
  unitPrice: string;
  unit?: string;
  discountPct: string;
  vatTreatment: 'standard' | 'zero_rated' | 'exempt' | 'out_of_scope';
  vatRateId: string | null;
  vatRate?: string | null;
  taxAmount?: string;
  lineTotal?: string;
  revenueAccountId?: string | null;
}

export type BillingKind = 'quote' | 'invoice' | 'credit_note';

export interface BillingDocument {
  id: string;
  kind: BillingKind;
  number: string | null;
  status: string;
  paymentStatus: 'unpaid' | 'partial' | 'paid' | 'overpaid';
  customerId: string;
  customerName: string;
  customerBrn: string | null;
  issueDate: string;
  dueDate: string | null;
  validUntil: string | null;
  currency: string;
  exchangeRate: string;
  subtotal: string;
  discountTotal: string;
  taxTotal: string;
  total: string;
  amountPaid: string;
  creditedAmount: string;
  outstanding: string;
  sourceDocumentId: string | null;
  notes: string | null;
  terms: string | null;
  accountingEntryId: string | null;
  lines: DocumentLine[];
  warnings?: string[];
}

export interface Item {
  id: string;
  reference: string;
  labelFr: string;
  labelEn: string | null;
  description: string | null;
  unitPrice: string;
  currency: string;
  unit: string;
  vatTreatment: 'standard' | 'zero_rated' | 'exempt' | 'out_of_scope';
  vatRateId: string | null;
  revenueAccountId: string | null;
  isActive: boolean;
}

export interface PaymentAllocation {
  id?: string;
  invoiceId: string;
  amount: string;
  invoiceNumber?: string | null;
  customerName?: string | null;
  allocatedDate?: string | null;
  cancelledAt?: string | null;
  cancellationReason?: string | null;
  reclassEntryId?: string | null;
  reclassAmount?: string;
}

export interface Payment {
  id: string;
  number: string | null;
  customerId: string;
  paymentDate: string;
  valueDate: string | null;
  amount: string;
  currency: string;
  method: string;
  reference: string | null;
  unallocatedAmount: string;
  status: string;
  accountingEntryId: string | null;
  allocations: PaymentAllocation[];
}

export const PAYMENT_METHODS = ['bank_transfer', 'cheque', 'cash', 'card', 'other'] as const;

export const emptyLine = (): DocumentLine => ({
  itemId: null,
  description: '',
  quantity: '1.0000',
  unitPrice: '',
  discountPct: '0.0000',
  vatTreatment: 'zero_rated',
  vatRateId: null,
});
