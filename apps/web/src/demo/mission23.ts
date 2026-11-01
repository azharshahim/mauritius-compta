/**
 * Mission 23 demonstration backend.
 *
 * IMPORTANT: no OCR, PDF parsing or MCB extraction runs in the browser. Every
 * extraction shown here is a pre-recorded fictional fixture; the demo banner and
 * the Scan & Import page say so explicitly. Chart editing and draft creation do
 * mutate localStorage so the workflow can be followed end to end.
 */
import { ApiError } from '../errors';
import type { DemoState, DemoAccount, DemoBankTransaction, DemoBankImport } from './runtime';

export interface DemoDocument {
  id: string; company_id: string; kind: 'purchase' | 'sale'; status: string;
  original_name: string; mime_type: string; size_bytes: number; sha256: string;
  page_count: number; extraction_method: 'pdf_text' | 'ocr_image' | 'ocr_pdf' | 'manual';
  extracted: Record<string, unknown>; warnings: string[]; confidence: string | null;
  party_name: string | null; invoice_number: string | null; invoice_date: string | null;
  due_date: string | null; currency: string | null; subtotal: string | null;
  vat_total: string | null; total_amount: string | null; duplicate_of: string | null;
  document_type?: 'invoice' | 'credit_note' | 'unknown';
  discount_total?: string | null;
  tax_ids?: {
    supplierBrn?: string | null; supplierVat?: string | null;
    customerBrn?: string | null; customerVat?: string | null;
  };
  purchase_order?: string | null;
  payment_terms?: string | null;
  field_confidence?: Record<string, number>;
  uncertain_fields?: string[];
  extraction_quality?: Record<string, unknown>;
  created_at: string; approved_at?: string | null;
}
export interface DemoDocumentLine {
  id: string; document_id: string; company_id: string; line_no: number; description: string;
  net_amount: string; vat_amount: string; total_amount: string; quantity: string | null;
  unit_price: string | null;
}
export interface DemoProposalLine {
  accountId: string | null; accountCode: string | null; accountName: string | null;
  description: string; debit: string; credit: string; needsAccount: boolean;
}
export interface DemoDocProposal {
  id: string; company_id: string; document_id: string; kind: 'purchase' | 'sale';
  status: 'PROPOSED' | 'APPROVED' | 'REJECTED'; party_name: string | null;
  journal_id: string | null; entry_date: string; currency: string; lines: DemoProposalLine[];
  balanced: boolean; uncertain_fields: string[]; rationale: Record<string, unknown>;
  draft_entry_id: string | null; created_at: string;
}
export interface DemoMission23State {
  schema: number;
  seq: number;
  profile: Record<string, { template_type: string; status: string; source_name: string | null;
    imported_at: string | null; notes: string | null }>;
  documents: DemoDocument[];
  documentLines: DemoDocumentLine[];
  proposals: DemoDocProposal[];
  mappings: {
    id: string;
    kind: string;
    party_key: string;
    keyword_key: string;
    account_id: string;
    usage_count: number;
    last_used_at: string;
    is_active: boolean;
  }[];
  mcbImports: string[];
}

const NOW = '2026-10-31T09:00:00.000Z';
const EN: Record<string, string> = {
  '1000': 'Cash', '1010': 'Bank — current account MUR', '1015': 'Bank — current account FX',
  '1100': 'Trade receivables', '1150': 'Other receivables and prepayments',
  '1200': 'VAT recoverable', '1300': 'Inventory', '1500': 'Property, plant and equipment',
  '1510': 'Accumulated depreciation', '1600': 'Intangible assets', '2000': 'Trade payables',
  '2100': 'Accrued liabilities and deferred income', '2200': 'VAT payable',
  '2300': 'PAYE payable (provisional)', '2400': 'CSG payable (provisional)', '2500': 'Bank loans',
  '3000': 'Share capital', '3100': 'Retained earnings', '3200': 'Reserves',
  '4000': 'Sales of goods', '4010': 'Services revenue', '4100': 'Other income',
  '5000': 'Purchases of goods', '5100': 'Inventory movement', '6000': 'Salaries and wages',
  '6010': 'Employer social contributions', '6100': 'Rent', '6110': 'Water and electricity',
  '6120': 'Telephone and internet', '6130': 'Professional fees', '6140': 'Bank charges',
  '6150': 'Insurance', '6200': 'Depreciation expense', '6300': 'Exchange differences (provisional)',
  '7000': 'Corporate tax (provisional)',
};
const ROLES: Record<string, string> = {
  '1010': 'bank', '1100': 'receivable', '1200': 'vat_input', '1300': 'inventory',
  '1500': 'fixed_asset', '1510': 'accumulated_depreciation', '2000': 'payable',
  '2100': 'accrued_liability', '2200': 'vat_output', '2500': 'loan', '3000': 'capital',
  '3100': 'retained_earnings', '4000': 'revenue', '4010': 'service_revenue',
  '4100': 'other_income', '5000': 'purchases', '5100': 'inventory_adjustment',
  '6000': 'payroll', '6100': 'rent', '6110': 'utilities', '6120': 'telecom',
  '6130': 'professional_fees', '6140': 'bank_charges', '6150': 'insurance',
  '6200': 'depreciation', '7000': 'other_expense',
};

const FIXTURE_DOCS: Omit<DemoDocument, 'company_id' | 'id' | 'created_at'>[] = [
  {
    kind: 'purchase', status: 'APPROVED', original_name: 'facture-acme-2026-101.pdf',
    mime_type: 'application/pdf', size_bytes: 48210,
    sha256: 'd3a1f1c0a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c',
    page_count: 1, extraction_method: 'pdf_text',
    extracted: { supplierName: 'ACME OFFICE SUPPLIES LTD', invoiceNumber: 'INV-2026-101',
      invoiceDate: '2026-02-12', dueDate: '2026-03-11', currency: 'MUR',
      subtotal: '15000.0000', vatTotal: '2250.0000', total: '17250.0000',
      lines: [{ description: 'A4 paper box', netAmount: '10000.0000', vatAmount: '1500.0000', totalAmount: '11500.0000' },
        { description: 'Printer toner', netAmount: '5000.0000', vatAmount: '750.0000', totalAmount: '5750.0000' }],
      warnings: [] },
    warnings: ['Extraction fictive préenregistrée pour la démonstration.'],
    confidence: '0.9000', party_name: 'ACME OFFICE SUPPLIES LTD', invoice_number: 'INV-2026-101',
    invoice_date: '2026-02-12', due_date: '2026-03-11', currency: 'MUR',
    subtotal: '15000.0000', vat_total: '2250.0000', total_amount: '17250.0000',
    duplicate_of: null, approved_at: NOW,
  },
  {
    kind: 'purchase', status: 'PROPOSED', original_name: 'facture-indian-ocean-8842.pdf',
    mime_type: 'application/pdf', size_bytes: 31200,
    sha256: 'e4b2a2d1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c',
    page_count: 1, extraction_method: 'pdf_text',
    extracted: { supplierName: 'INDIAN OCEAN UTILITIES LTD', invoiceNumber: 'IOU-8842',
      invoiceDate: '2026-02-18', dueDate: '2026-03-17', currency: 'MUR',
      subtotal: '5000.0000', vatTotal: '750.0000', total: '5750.0000',
      lines: [{ description: 'Electricity — September 2026', netAmount: '5000.0000', vatAmount: '750.0000', totalAmount: '5750.0000' }],
      warnings: [] },
    warnings: ['Extraction fictive préenregistrée pour la démonstration.'],
    confidence: '1.0000', party_name: 'INDIAN OCEAN UTILITIES LTD', invoice_number: 'IOU-8842',
    invoice_date: '2026-02-18', due_date: '2026-03-17', currency: 'MUR',
    subtotal: '5000.0000', vat_total: '750.0000', total_amount: '5750.0000',
    duplicate_of: null,
  },
  {
    kind: 'sale', status: 'APPROVED', original_name: 'facture-vente-lagon-2026-044.pdf',
    mime_type: 'application/pdf', size_bytes: 51900,
    sha256: 'f5c3b3e2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d',
    page_count: 1, extraction_method: 'pdf_text',
    extracted: { customerName: 'LAGON TRADING LTD', invoiceNumber: 'FAC-2026-044',
      invoiceDate: '2026-02-20', dueDate: '2026-03-19', currency: 'MUR',
      subtotal: '20000.0000', vatTotal: '3000.0000', total: '23000.0000',
      lines: [{ description: 'Office furniture — order 7781', netAmount: '20000.0000', vatAmount: '3000.0000', totalAmount: '23000.0000' }],
      warnings: [] },
    warnings: ['Extraction fictive préenregistrée pour la démonstration.'],
    confidence: '0.9000', party_name: 'LAGON TRADING LTD', invoice_number: 'FAC-2026-044',
    invoice_date: '2026-02-20', due_date: '2026-03-19', currency: 'MUR',
    subtotal: '20000.0000', vat_total: '3000.0000', total_amount: '23000.0000',
    duplicate_of: null, approved_at: NOW,
  },
  {
    kind: 'sale', status: 'EXTRACTED', original_name: 'facture-vente-blue-bay-2026-045.pdf',
    mime_type: 'application/pdf', size_bytes: 40120,
    sha256: 'a6d4c4f3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e',
    page_count: 1, extraction_method: 'pdf_text',
    extracted: { customerName: 'BLUE BAY HOTELS LTD', invoiceNumber: 'FAC-2026-045',
      invoiceDate: '2026-02-22', dueDate: '2026-03-21', currency: 'MUR',
      subtotal: '10000.0000', vatTotal: '1500.0000', total: '11500.0000',
      lines: [{ description: 'Maintenance services', netAmount: '10000.0000', vatAmount: '1500.0000', totalAmount: '11500.0000' }],
      warnings: [] },
    warnings: ['Extraction fictive préenregistrée pour la démonstration.'],
    confidence: '0.9000', party_name: 'BLUE BAY HOTELS LTD', invoice_number: 'FAC-2026-045',
    invoice_date: '2026-02-22', due_date: '2026-03-21', currency: 'MUR',
    subtotal: '10000.0000', vat_total: '1500.0000', total_amount: '11500.0000',
    duplicate_of: null,
  },
  {
    kind: 'purchase', status: 'EXTRACTED', original_name: 'photo-recue-site.jpg',
    mime_type: 'image/jpeg', size_bytes: 1284000,
    sha256: 'b7e5d5a4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f',
    page_count: 1, extraction_method: 'ocr_image',
    extracted: { supplierName: 'PORT LOUIS HARDWARE LTD', invoiceNumber: 'PLH-2210',
      invoiceDate: '2026-02-24', dueDate: null, currency: 'MUR',
      subtotal: '2850.0000', vatTotal: '427.5000', total: '3277.5000',
      lines: [], warnings: ['OCR fictif : numéro de facture et date à confirmer.'] },
    warnings: ['OCR fictif préenregistré — aucun moteur OCR ne tourne dans la démonstration.',
      'Le numéro de facture et la date restent à confirmer.'],
    confidence: '0.5800', party_name: 'PORT LOUIS HARDWARE LTD', invoice_number: 'PLH-2210',
    invoice_date: '2026-02-24', due_date: null, currency: 'MUR',
    subtotal: '2850.0000', vat_total: '427.5000', total_amount: '3277.5000',
    duplicate_of: null,
  },
  {
    kind: 'purchase', status: 'DUPLICATE', original_name: 'facture-acme-2026-101-copie.pdf',
    mime_type: 'application/pdf', size_bytes: 48210,
    sha256: 'd3a1f1c0a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c',
    page_count: 1, extraction_method: 'pdf_text',
    extracted: { supplierName: 'ACME OFFICE SUPPLIES LTD', invoiceNumber: 'INV-2026-101',
      invoiceDate: '2026-02-12', dueDate: '2026-03-11', currency: 'MUR',
      subtotal: '15000.0000', vatTotal: '2250.0000', total: '17250.0000', lines: [], warnings: [] },
    warnings: ['An identical file was already imported for this company.'],
    confidence: '0.9000', party_name: 'ACME OFFICE SUPPLIES LTD', invoice_number: 'INV-2026-101',
    invoice_date: '2026-02-12', due_date: '2026-03-11', currency: 'MUR',
    subtotal: '15000.0000', vat_total: '2250.0000', total_amount: '17250.0000',
    duplicate_of: null,
  },
];

const DEMO_TAX_IDS = {
  supplierBrn: 'C12345678901',
  supplierVat: 'VAT20345678',
  customerBrn: 'C98765432109',
  customerVat: 'VAT20987654',
};

/**
 * Mission 29/30 — add the verification fields expected by the current screens.
 * Idempotent so an existing browser demo state can be upgraded in place without
 * changing its accounting data.
 */
function withVerificationFields(doc: DemoDocument, index: number): DemoDocument {
  const confidence = Number(doc.confidence ?? 0);
  const lowConfidence = confidence > 0 && confidence < 0.8;
  return {
    ...doc,
    document_type: doc.document_type ?? 'invoice',
    discount_total: doc.discount_total ?? null,
    tax_ids: doc.tax_ids ?? (index === 0 || index === 5 ? DEMO_TAX_IDS : {}),
    purchase_order: doc.purchase_order ?? (index === 0 ? 'PO-7788' : null),
    payment_terms: doc.payment_terms ?? (index === 0 ? 'Net 30 days' : null),
    field_confidence: doc.field_confidence ?? {
      supplierName: confidence || 0.9,
      invoiceNumber: lowConfidence ? 0.58 : 0.92,
      invoiceDate: lowConfidence ? 0.62 : 0.9,
      currency: confidence || 0.9,
      total: confidence || 0.9,
      vatTotal: confidence || 0.9,
    },
    uncertain_fields: doc.uncertain_fields
      ?? (lowConfidence ? ['invoiceNumber', 'invoiceDate'] : []),
    extraction_quality: doc.extraction_quality ?? {
      method: doc.extraction_method,
      confidence: Number(confidence.toFixed(4)),
      pageCount: doc.page_count,
      demoFixture: true,
      warnings: doc.warnings,
    },
  };
}

export function upgradeDemoMission23(state: DemoState): void {
  if (!state.mission23) return;
  state.mission23.documents = state.mission23.documents.map(withVerificationFields);
}

export function seedDemoMission23(state: DemoState): void {
  for (const account of state.accounts as (DemoAccount & {
    name_en?: string | null; name_fr?: string | null; posting_allowed?: boolean;
    account_role?: string | null; vat_default?: string | null;
  })[]) {
    account.name_fr = account.name_fr ?? account.name;
    account.name_en = account.name_en ?? EN[account.code] ?? null;
    account.posting_allowed = account.posting_allowed ?? true;
    account.account_role = account.account_role ?? ROLES[account.code] ?? null;
    account.vat_default = account.vat_default ?? null;
  }
  if (state.mission23) {
    // Upgrade an existing mission 23 state without duplicating documents.
    state.mission23.mappings = (state.mission23.mappings ?? []).map((mapping, index) => ({
      ...mapping,
      id: mapping.id ?? `demo-rule-upgrade-${index + 1}`,
      usage_count: mapping.usage_count ?? 2,
      last_used_at: mapping.last_used_at ?? NOW,
      is_active: mapping.is_active ?? true,
    }));
    upgradeDemoMission23(state);
    return;
  }
  const company = state.companies[0];
  const other = state.companies[1];
  if (!company) return;
  const documents: DemoDocument[] = FIXTURE_DOCS.map((doc, index) => withVerificationFields({
    ...doc, id: `demo-doc-${index + 1}`, company_id: company.id, created_at: NOW,
    duplicate_of: index === 5 ? 'demo-doc-1' : null,
  }, index));
  const account = (code: string) => state.accounts.find((a) => a.company_id === company.id && a.code === code);
  const journal = (type: string) => state.journals.find((j) => j.company_id === company.id && j.type === type);
  const line = (code: string, description: string, debit: string, credit: string): DemoProposalLine => {
    const acc = account(code) ?? null;
    return { accountId: acc?.id ?? null, accountCode: code, accountName: acc?.name ?? null,
      description, debit, credit, needsAccount: false };
  };
  const proposals: DemoDocProposal[] = [
    {
      id: 'demo-proposal-1', company_id: company.id, document_id: 'demo-doc-1', kind: 'purchase',
      status: 'APPROVED', party_name: 'ACME OFFICE SUPPLIES LTD', journal_id: journal('purchases')?.id ?? null,
      entry_date: '2026-02-12', currency: 'MUR',
      lines: [line('5000', 'A4 paper box', '10000.0000', '0.0000'),
        line('5000', 'Printer toner', '5000.0000', '0.0000'),
        line('1200', 'VAT stated on document', '2250.0000', '0.0000'),
        line('2000', 'ACME OFFICE SUPPLIES LTD', '0.0000', '17250.0000')],
      balanced: true, uncertain_fields: [], rationale: { corrected: true, note: 'Proposition corrigée puis approuvée (fictif).' },
      draft_entry_id: null, created_at: NOW,
    },
    {
      id: 'demo-proposal-2', company_id: company.id, document_id: 'demo-doc-2', kind: 'purchase',
      status: 'PROPOSED', party_name: 'INDIAN OCEAN UTILITIES LTD', journal_id: journal('purchases')?.id ?? null,
      entry_date: '2026-02-18', currency: 'MUR',
      lines: [line('6100', 'Electricity — September 2026', '5000.0000', '0.0000'),
        line('1200', 'VAT stated on document', '750.0000', '0.0000'),
        line('2000', 'INDIAN OCEAN UTILITIES LTD', '0.0000', '5750.0000')],
      balanced: true, uncertain_fields: ['party'],
      rationale: { candidates: [{ id: 'demo-supplier-iou', name: 'Indian Ocean Utilities Ltd', score: 0.82 }] },
      draft_entry_id: null, created_at: NOW,
    },
    {
      id: 'demo-proposal-3', company_id: company.id, document_id: 'demo-doc-3', kind: 'sale',
      status: 'APPROVED', party_name: 'LAGON TRADING LTD', journal_id: journal('sales')?.id ?? null,
      entry_date: '2026-02-20', currency: 'MUR',
      lines: [line('1100', 'LAGON TRADING LTD', '23000.0000', '0.0000'),
        line('4000', 'Office furniture — order 7781', '0.0000', '20000.0000'),
        line('2200', 'VAT stated on document', '0.0000', '3000.0000')],
      balanced: true, uncertain_fields: [], rationale: {}, draft_entry_id: null, created_at: NOW,
    },
  ];
  const lines: DemoDocumentLine[] = [];
  for (const doc of documents) {
    const extracted = doc.extracted as { lines?: { description: string; netAmount: string; vatAmount: string; totalAmount: string }[] };
    (extracted.lines ?? []).forEach((l, i) => lines.push({
      id: `demo-doc-line-${doc.id}-${i + 1}`, document_id: doc.id, company_id: company.id,
      line_no: i + 1, description: l.description, net_amount: l.netAmount, vat_amount: l.vatAmount,
      total_amount: l.totalAmount, quantity: null, unit_price: null,
    }));
  }
  const expenseAccount = account('5000');
  const mappings: DemoMission23State['mappings'] = expenseAccount ? [
    {
      id: 'demo-rule-1', kind: 'purchase', party_key: 'acme office supplies',
      keyword_key: 'paper box', account_id: expenseAccount.id, usage_count: 2,
      last_used_at: NOW, is_active: true,
    },
    {
      id: 'demo-rule-2', kind: 'purchase', party_key: 'acme office supplies',
      keyword_key: 'printer toner', account_id: expenseAccount.id, usage_count: 1,
      last_used_at: NOW, is_active: true,
    },
  ] : [];
  state.mission23 = {
    schema: 1, seq: documents.length,
    profile: {
      [company.id]: { template_type: 'provisional_mauritius', status: 'PENDING PROFESSIONAL VALIDATION',
        source_name: null, imported_at: null, notes: 'Modèle de démonstration — validation professionnelle requise.' },
      ...(other ? { [other.id]: { template_type: 'firm_chart', status: 'AWAITING FIRM CONFIRMATION',
        source_name: 'plan-cabinet-demo.xlsx (fictif)', imported_at: NOW, notes: 'Plan importé du cabinet fictif.' } } : {}),
    },
    documents, documentLines: lines, proposals, mappings, mcbImports: [],
  } as DemoMission23State;
}

function stateOf(s: DemoState): DemoMission23State {
  if (!s.mission23) seedDemoMission23(s);
  return s.mission23!;
}
function companyOf(s: DemoState, id: string) {
  const company = s.companies.find((c) => c.id === id);
  if (!company) throw new ApiError(404, 'COMPANY_NOT_FOUND', 'Société introuvable');
  return company;
}
function accountOf(s: DemoState, companyId: string, code: string) {
  return s.accounts.find((a) => a.company_id === companyId && a.code === code);
}
function docView(state: DemoMission23State, s: DemoState, doc: DemoDocument) {
  return {
    document: doc,
    lines: state.documentLines.filter((l) => l.document_id === doc.id),
    proposals: state.proposals.filter((p) => p.document_id === doc.id)
      .sort((a, b) => b.created_at.localeCompare(a.created_at)),
  };
}
function demoNormalise(value: string): string {
  return value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\b(ltd|limited|ltée|sarl|sas|sa|inc|co|company)\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim();
}
function demoKeyword(value: string): string {
  return demoNormalise(value).split(' ').filter((word) => word.length > 2).slice(0, 3).join(' ');
}

function proposalFor(s: DemoState, state: DemoMission23State, doc: DemoDocument): DemoDocProposal {
  const account = (code: string) => accountOf(s, doc.company_id, code);
  const make = (code: string, description: string, debit: string, credit: string): DemoProposalLine => {
    const acc = account(code);
    return { accountId: acc?.id ?? null, accountCode: code, accountName: acc?.name ?? null,
      description, debit, credit, needsAccount: !acc };
  };
  const total = doc.total_amount ?? '0.0000';
  const net = doc.subtotal ?? total;
  const vat = doc.vat_total ?? '0.0000';
  const lines = doc.kind === 'purchase'
    ? [make('5000', 'Document total', net, '0.0000'), ...(Number(vat) > 0 ? [make('1200', 'VAT stated on document', vat, '0.0000')] : []),
      make('2000', doc.party_name ?? 'Supplier', '0.0000', total)]
    : [make('1100', doc.party_name ?? 'Customer', total, '0.0000'), make('4000', 'Document total', '0.0000', net),
      ...(Number(vat) > 0 ? [make('2200', 'VAT stated on document', '0.0000', vat)] : [])];
  const debit = lines.reduce((sum, l) => sum + Math.round(Number(l.debit) * 10000), 0);
  const credit = lines.reduce((sum, l) => sum + Math.round(Number(l.credit) * 10000), 0);
  const proposal: DemoDocProposal = {
    id: `demo-proposal-${++state.seq}`, company_id: doc.company_id, document_id: doc.id,
    kind: doc.kind, status: 'PROPOSED', party_name: doc.party_name,
    journal_id: s.journals.find((j) => j.company_id === doc.company_id && j.type === (doc.kind === 'purchase' ? 'purchases' : 'sales'))?.id ?? null,
    entry_date: doc.invoice_date ?? '2026-10-31', currency: doc.currency ?? 'MUR',
    lines, balanced: debit === credit, uncertain_fields: debit === credit ? [] : ['imbalance'],
    rationale: { preRecorded: true }, draft_entry_id: null, created_at: NOW,
  };
  state.proposals = state.proposals.filter((p) => p.document_id !== doc.id);
  state.proposals.push(proposal);
  doc.status = 'PROPOSED';
  return proposal;
}

const MCB_ROWS = [
  { date: '2026-01-02', details: 'JUICE', amount: '-1200.00', balance: '13800.00' },
  { date: '2026-01-05', details: "Debit Card Purchase WINNER'S SUPERMARKET", amount: '-2450.50', balance: '11349.50' },
  { date: '2026-01-10', details: 'Cash Deposit', amount: '5000.00', balance: '16349.50' },
  { date: '2026-01-15', details: 'Credit Interest', amount: '45.25', balance: '16394.75' },
  { date: '2026-01-20', details: 'Charges', amount: '-125.00', balance: '16269.75' },
  { date: '2026-01-25', details: 'Refill Amount', amount: '-300.00', balance: '15969.75' },
  { date: '2026-01-25', details: 'VAT on Refill', amount: '-45.00', balance: '15924.75' },
];

function mcbPreview(s: DemoState, companyId: string, payload: Record<string, any>) {
  const account = s.bankAccounts.find((b) => b.id === payload.bankAccountId && b.company_id === companyId);
  if (!account) throw new ApiError(404, 'BANK_ACCOUNT_NOT_FOUND', 'Compte bancaire introuvable');
  const existing = new Set(s.bankTransactions.filter((t) => t.bank_account_id === account.id).map((t) => t.fingerprint));
  const transactions = MCB_ROWS.map((row, i) => ({
    rowNumber: i + 2, txnDate: row.date, valueDate: row.date, label: row.details,
    amount: row.amount, balance: row.balance, action: existing.has(`${row.date}|${row.details}|${row.amount}`) ? 'skip' : 'import',
    duplicate: existing.has(`${row.date}|${row.details}|${row.amount}`),
    suggestion: /charge|frais|commission/i.test(row.details)
      ? { kind: 'fees', messageFr: 'Suggestion : frais bancaires — à vérifier',
          messageEn: 'Suggestion: bank charges — verify' }
      : null,
  }));
  return {
    bankAccount: account,
    preview: {
      transactions,
      summary: { total: transactions.length, importable: transactions.filter((t) => t.action === 'import').length,
        duplicates: transactions.filter((t) => t.action === 'skip').length, errors: 0, warnings: 0 },
      blocksImport: false,
      totals: { in: '5045.2500', out: '4120.5000', net: '924.7500' },
      balances: { opening: '15000.0000', closing: '15924.7500', computedClosing: '15924.7500', consistent: true },
      findings: [],
    },
    mcb: {
      openingBalance: '15000.0000', closingBalance: '15924.7500',
      warnings: [{ code: 'MCB_DEMO_FIXTURE', line: null, message: 'Relevé fictif préenregistré — aucun PDF réel n’est analysé dans la démonstration.' }],
      unparsedLines: [],
      profile: 'MCB Savings Regular Account — fictional demonstration extract',
      compatibilityNote: 'Demonstration fixture only. Compatibility with real MCB statements is not asserted.',
      bankName: 'Mauritius Commercial Bank (fictif)',
      // Fictional MCB account used by the demo only (never a real customer account).
      accountNumber: '000123456789',
      periodStart: '2026-01-01', periodEnd: '2026-01-31', currency: account.currency,
      profileKey: 'mcb',
      detectedBankKey: 'mcb',
    },
    extraction: { method: 'pdf_text', pageCount: 2,
      warnings: ['MODE DÉMONSTRATION : extraction préenregistrée, aucun OCR réel exécuté.'] },
  };
}

export function handleDemoMission23(
  s: DemoState, companyId: string, method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  rest: string, payload: Record<string, any>,
): unknown | undefined {
  const state = stateOf(s);
  companyOf(s, companyId);

  if (rest === '/chart-of-accounts/profile' && method === 'GET') {
    const profile = state.profile[companyId] ?? {
      template_type: 'provisional_mauritius', status: 'PENDING PROFESSIONAL VALIDATION',
      source_name: null, imported_at: null, notes: null,
    };
    state.profile[companyId] = profile;
    return { profile };
  }
  if (rest === '/chart-of-accounts/template' && method === 'GET') {
    return { template: 'provisional_mauritius', status: 'PENDING PROFESSIONAL VALIDATION',
      note: 'Demonstration template only. Account numbers are not asserted as mandatory.',
      accounts: Object.entries(EN).map(([code, nameEn]) => ({
        code, nameEn, nameFr: s.accounts.find((a) => a.company_id === companyId && a.code === code)?.name ?? nameEn,
        type: code.startsWith('1') ? 'asset' : code.startsWith('2') ? 'liability' : code.startsWith('3') ? 'equity'
          : code.startsWith('4') ? 'revenue' : 'expense', parentCode: null, postingAllowed: true,
        accountRole: ROLES[code] ?? null,
      })) };
  }
  if (rest === '/chart-of-accounts/template/apply' && method === 'POST') {
    let created = 0;
    for (const [code, nameEn] of Object.entries(EN)) {
      if (s.accounts.some((a) => a.company_id === companyId && a.code === code)) continue;
      const name = nameEn;
      s.accounts.push({ id: crypto.randomUUID(), company_id: companyId, code, name,
        name_en: nameEn, name_fr: name, type: code.startsWith('1') ? 'asset' : code.startsWith('2') ? 'liability'
          : code.startsWith('3') ? 'equity' : code.startsWith('4') ? 'revenue' : 'expense',
        parent_id: null, currency: 'MUR', is_active: true, posting_allowed: true,
        account_role: ROLES[code] ?? null, vat_default: null,
        fs_mapping: null, description: null } as DemoAccount);
      created += 1;
    }
    state.profile[companyId] = { ...(state.profile[companyId] ?? {}), template_type: 'provisional_mauritius',
      status: 'PENDING PROFESSIONAL VALIDATION', source_name: null, imported_at: NOW, notes: null } as any;
    return { created, skipped: Object.keys(EN).length - created, status: 'PENDING PROFESSIONAL VALIDATION' };
  }
  if (rest === '/chart-of-accounts/import/preview' && method === 'POST') {
    const fixture = [
      { line: 2, code: '8000', name: 'Firm chart — administration costs', nameEn: 'Administration costs', nameFr: 'Frais administratifs', type: 'expense', parentCode: null, postingAllowed: true, accountRole: 'other_expense', exists: false },
      { line: 3, code: '8010', name: 'Firm chart — IT costs', nameEn: 'IT costs', nameFr: 'Frais informatiques', type: 'expense', parentCode: null, postingAllowed: true, accountRole: 'external_services', exists: false },
      { line: 4, code: '4000', name: 'Existing sales', nameEn: 'Sales of goods', nameFr: 'Ventes de marchandises', type: 'revenue', parentCode: null, postingAllowed: true, accountRole: 'revenue', exists: true },
    ];
    return { format: 'csv', sheetName: 'CSV', headers: ['Code', 'Label EN', 'Label FR', 'Type'],
      mapping: { code: 0, name: 1, nameEn: 1, nameFr: 2, type: 3 }, rows: fixture,
      findings: [{ line: 4, code: '4000', codeName: 'CHART_DUPLICATE_EXISTING', severity: 'warning' }],
      notes: ['Prévisualisation fictive préenregistrée pour la démonstration.'], profileStatus: 'AWAITING FIRM CONFIRMATION' };
  }
  if (rest === '/chart-of-accounts/import/confirm' && method === 'POST') {
    let created = 0; const skipped: string[] = [];
    for (const row of (payload.rows ?? []) as any[]) {
      if (s.accounts.some((a) => a.company_id === companyId && a.code === row.code)) { skipped.push(row.code); continue; }
      s.accounts.push({ id: crypto.randomUUID(), company_id: companyId, code: row.code,
        name: row.nameEn || row.name, name_en: row.nameEn ?? null, name_fr: row.nameFr ?? null,
        type: row.type, parent_id: null, currency: 'MUR', is_active: true,
        posting_allowed: row.postingAllowed ?? true, account_role: row.accountRole ?? null,
        vat_default: null, fs_mapping: null, description: null } as DemoAccount);
      created += 1;
    }
    state.profile[companyId] = { template_type: 'firm_chart', status: 'AWAITING FIRM CONFIRMATION',
      source_name: String(payload.fileName ?? 'plan-cabinet.csv'), imported_at: NOW, notes: null } as any;
    return { created, skipped, status: 'AWAITING FIRM CONFIRMATION' };
  }
  if (rest === '/chart-of-accounts/confirm' && method === 'POST') {
    state.profile[companyId] = { ...(state.profile[companyId] ?? {
      template_type: 'custom_company', source_name: null, imported_at: null,
    }), status: 'CONFIRMED BY FIRM', notes: String(payload.note ?? '') } as any;
    return { profile: state.profile[companyId] };
  }

  if (rest === '/documents/rules' && method === 'GET') {
    return {
      rules: state.mappings.map((mapping) => {
        const chart = s.accounts.find((a) => a.id === mapping.account_id && a.company_id === companyId);
        return { ...mapping, account_code: chart?.code ?? null, account_name: chart?.name ?? null };
      }),
    };
  }
  const ruleMatch = /^\/documents\/rules\/([^/]+)$/.exec(rest);
  if (ruleMatch && method === 'PATCH') {
    const mapping = state.mappings.find((row) => row.id === ruleMatch[1]);
    if (!mapping) throw new ApiError(404, 'DOCUMENT_RULE_NOT_FOUND', 'Règle de classement introuvable');
    if (payload.accountId !== undefined) {
      const account = s.accounts.find((a) => a.id === payload.accountId && a.company_id === companyId && a.is_active);
      const expected = mapping.kind === 'purchase' ? 'expense' : 'revenue';
      if (!account || account.type !== expected) {
        throw new ApiError(400, 'DOCUMENT_RULE_ACCOUNT_INVALID', 'Compte incompatible avec la règle');
      }
      mapping.account_id = String(payload.accountId);
    }
    if (payload.isActive !== undefined) mapping.is_active = Boolean(payload.isActive);
    const chart = s.accounts.find((a) => a.id === mapping.account_id && a.company_id === companyId);
    return { rule: { ...mapping, account_code: chart?.code ?? null, account_name: chart?.name ?? null } };
  }
  if (rest === '/documents' && method === 'GET') {
    return { documents: state.documents.filter((d) => d.company_id === companyId)
      .sort((a, b) => b.created_at.localeCompare(a.created_at)) };
  }
  if (rest === '/documents' && method === 'POST') {
    const seq = ++state.seq;
    const kind = payload.kind === 'sale' ? 'sale' : 'purchase';
    const doc: DemoDocument = {
      id: `demo-doc-new-${seq}`, company_id: companyId, kind, status: 'EXTRACTED',
      original_name: String(payload.fileName ?? 'document.pdf'),
      mime_type: payload.declaredMime === 'image/jpeg' ? 'image/jpeg' : 'application/pdf',
      size_bytes: 24576, sha256: `demo-upload-${seq}`, page_count: 1, extraction_method: 'pdf_text',
      extracted: { supplierName: kind === 'purchase' ? 'FOURNISSEUR DÉMO SARL' : 'CLIENT DÉMO LTD',
        invoiceNumber: `DEMO-${seq}`, invoiceDate: '2026-02-27', dueDate: '2026-03-29',
        currency: 'MUR', subtotal: '4000.0000', vatTotal: '600.0000', total: '4600.0000',
        lines: [{ description: 'Ligne fictive extraite', netAmount: '4000.0000', vatAmount: '600.0000', totalAmount: '4600.0000' }],
        warnings: ['Extraction fictive préenregistrée : aucun OCR réel exécuté.'] },
      warnings: ['MODE DÉMONSTRATION : résultat d’extraction préenregistré, pas un OCR réel.'],
      confidence: '0.7500', party_name: kind === 'purchase' ? 'FOURNISSEUR DÉMO SARL' : 'CLIENT DÉMO LTD',
      invoice_number: `DEMO-${seq}`, invoice_date: '2026-02-27', due_date: '2026-03-29',
      currency: 'MUR', subtotal: '4000.0000', vat_total: '600.0000', total_amount: '4600.0000',
      duplicate_of: null, created_at: NOW,
    };
    state.documents.push(doc);
    state.documentLines.push({ id: `demo-doc-line-new-${seq}`, document_id: doc.id, company_id: companyId,
      line_no: 1, description: 'Ligne fictive extraite', net_amount: '4000.0000', vat_amount: '600.0000',
      total_amount: '4600.0000', quantity: null, unit_price: null });
    return { document: doc };
  }
  const docMatch = /^\/documents\/([^/]+)(\/[^/]+)?$/.exec(rest);
  if (docMatch) {
    const doc = state.documents.find((d) => d.id === docMatch[1] && d.company_id === companyId);
    if (!doc) throw new ApiError(404, 'DOCUMENT_NOT_FOUND', 'Document introuvable');
    const suffix = docMatch[2] ?? '';
    if (suffix === '' && method === 'GET') return docView(state, s, doc);
    if (suffix === '/file' && method === 'GET') throw new ApiError(404, 'DEMO_FILE_UNAVAILABLE', 'Fichier non stocké dans la démonstration');
    if (suffix === '' && method === 'PATCH') {
      for (const key of ["party_name", "invoice_number", "invoice_date", "due_date", "currency", "subtotal", "vat_total", "total_amount", "document_type", "discount_total", "purchase_order", "payment_terms"] as const) {
        if (payload[key] !== undefined) (doc as any)[key] = payload[key] || null;
      }
      if (payload.tax_ids && typeof payload.tax_ids === 'object') {
        doc.tax_ids = { ...(doc.tax_ids ?? {}), ...payload.tax_ids };
      }
      // A human correction removes the field from the uncertainty list.
      if (Array.isArray(doc.uncertain_fields)) {
        const corrected = Object.keys(payload).map((key) =>
          key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase()));
        doc.uncertain_fields = doc.uncertain_fields.filter((field) => !corrected.some((key) =>
          key === field || (key === 'partyName' && field === 'supplierName') ||
          (key === 'vat_total' && field === 'vatTotal') ||
          (key === 'total_amount' && field === 'total') ||
          (key === 'discount_total' && field === 'discountTotal') ||
          (key === 'document_type' && field === 'documentType') ||
          (key === 'purchase_order' && field === 'purchaseOrder')));
      }
      return { document: doc };
    }
    if (suffix === '/proposal' && method === 'POST') {
      if (doc.status === 'DUPLICATE') throw new ApiError(409, 'DOCUMENT_DUPLICATE', 'Un doublon ne peut pas être proposé');
      if (doc.status === 'REJECTED' || doc.status === 'APPROVED') {
        throw new ApiError(409, 'DOCUMENT_FINAL', 'Ce document est déjà finalisé');
      }
      if (!doc.total_amount) throw new ApiError(400, 'DOCUMENT_TOTAL_MISSING', 'Total manquant');
      const proposal = proposalFor(s, state, doc);
      return { proposal, candidates: [] };
    }
    if (suffix === '/party-candidates' && method === 'GET') return { candidates: [] };
  }
  const proposalMatch = /^\/documents\/proposals\/([^/]+)\/(approve|reject)$/.exec(rest);
  if (proposalMatch) {
    const proposal = state.proposals.find((p) => p.id === proposalMatch[1] && p.company_id === companyId);
    if (!proposal) throw new ApiError(404, 'PROPOSAL_NOT_FOUND', 'Proposition introuvable');
    const doc = state.documents.find((d) => d.id === proposal.document_id)!;
    if (proposalMatch[2] === 'reject' && method === 'POST') {
      proposal.status = 'REJECTED'; doc.status = 'REJECTED';
      return { proposalId: proposal.id, status: 'REJECTED' };
    }
    if (proposalMatch[2] === 'approve' && method === 'POST') {
      if (proposal.status === 'APPROVED') throw new ApiError(409, 'PROPOSAL_ALREADY_APPROVED', 'Déjà approuvée');
      if (proposal.status === 'REJECTED') throw new ApiError(409, 'PROPOSAL_REJECTED', 'Proposition refusée');
      const lines = (payload.lines ?? []) as any[];
      const accounts = new Map(s.accounts.filter((a) => a.company_id === companyId).map((a) => [a.id, a]));
      const sumDebit = lines.reduce((sum, l) => sum + Math.round(Number(l.debit || 0) * 10000), 0);
      const sumCredit = lines.reduce((sum, l) => sum + Math.round(Number(l.credit || 0) * 10000), 0);
      if (sumDebit !== sumCredit) throw new ApiError(400, 'PROPOSAL_NOT_BALANCED', 'Débit et crédit doivent être égaux');
      const journal = s.journals.find((j) => j.id === (payload.journalId ?? proposal.journal_id));
      if (!journal) throw new ApiError(400, 'PROPOSAL_JOURNAL_REQUIRED', 'Journal requis');
      const year = String(payload.entryDate ?? proposal.entry_date).slice(0, 4);
      const key = `${journal.code}-${year}`;
      const next = (s.sequences[key] ?? 0) + 1;
      s.sequences[key] = next;
      const entryId = crypto.randomUUID();
      s.entries.push({ id: entryId, company_id: companyId, journal_id: journal.id,
        entry_no: `${journal.code}-${year}-${String(next).padStart(4, '0')}`,
        entry_date: payload.entryDate ?? proposal.entry_date, reference: `DOC:${doc.invoice_number ?? doc.id}`,
        description: `Document import — ${doc.original_name}`, currency: proposal.currency,
        exchange_rate: '1', status: 'draft', source: 'manual', reversal_of_entry_id: null,
        posted_at: null, created_at: NOW });
      lines.forEach((l, i) => {
        const account = accounts.get(l.accountId);
        if (!account) throw new ApiError(400, 'PROPOSAL_ACCOUNT_INVALID', 'Compte inactif ou inconnu');
        s.lines.push({ id: crypto.randomUUID(), company_id: companyId, entry_id: entryId, line_no: i + 1,
          account_id: account.id, description: l.description ?? null,
          debit: String(l.debit ?? '0'), credit: String(l.credit ?? '0'),
          txn_currency: proposal.currency, txn_amount: String(l.debit || l.credit), fx_rate: '1' } as any);
      });
      // Learning is recorded but only applied by the engine from the second
      // identical approval onward. Disabling a rule is always possible.
      const partyKey = demoNormalise(doc.party_name ?? '');
      if (partyKey) {
        for (const l of lines) {
          const account = accounts.get(l.accountId);
          if (!account || !['expense', 'revenue'].includes(account.type)) continue;
          const keyword = demoKeyword(String(l.description ?? ''));
          if (!keyword) continue;
          const existing = state.mappings.find((mapping) =>
            mapping.kind === doc.kind && mapping.party_key === partyKey && mapping.keyword_key === keyword);
          if (existing) {
            existing.account_id = account.id;
            existing.usage_count += 1;
            existing.last_used_at = NOW;
            existing.is_active = true;
          } else {
            state.mappings.push({
              id: `demo-rule-${state.seq}-${state.mappings.length + 1}`,
              kind: doc.kind, party_key: partyKey, keyword_key: keyword,
              account_id: account.id, usage_count: 1, last_used_at: NOW, is_active: true,
            });
          }
        }
      }
      proposal.status = 'APPROVED'; proposal.draft_entry_id = entryId;
      doc.status = 'APPROVED'; doc.approved_at = NOW;
      return { proposalId: proposal.id, status: 'APPROVED',
        draftEntry: s.entries.find((e) => e.id === entryId),
        note: 'Draft entry created in the browser demonstration.' };
    }
  }

  if ((rest === '/bank/mcb/preview' || rest === '/bank/pdf/preview') && method === 'POST') {
    const built = mcbPreview(s, companyId, payload) as any;
    // Mirror the API envelope: BankPreviewResponse.preview is the BankPreview.
    return { ...built, preview: { ...built.preview, preview: built.preview } };
  }
  if ((rest === '/bank/mcb/import' || rest === '/bank/pdf/import') && method === 'POST') {
    const preview = mcbPreview(s, companyId, payload);
    const account = preview.bankAccount;
    let imported = 0; let duplicates = 0;
    const importId = crypto.randomUUID();
    const rows = preview.preview.transactions;
    if (rows.every((r) => r.action === 'skip')) {
      return { imported: 0, duplicates: rows.length, reimport: true, mcb: preview.mcb, extraction: preview.extraction };
    }
    const bankImport: DemoBankImport = { id: importId, company_id: companyId, bank_account_id: account.id,
      file_name: String(payload.fileName ?? 'mcb-demo.pdf'), file_size: 24576, file_hash: `mcb-demo-${importId}`,
      idempotency_key: `mcb-demo-${importId}`, format: 'csv', encoding: 'utf-8', status: 'imported',
      row_count: rows.length, imported_count: 0, duplicate_count: 0,
      opening_balance: '15000.0000', closing_balance: '15924.7500', summary: {}, created_at: NOW };
    for (const row of rows) {
      const fingerprint = `${row.txnDate}|${row.label}|${row.amount}`;
      if (s.bankTransactions.some((t) => t.bank_account_id === account.id && t.fingerprint === fingerprint)) {
        duplicates += 1; continue;
      }
      const txn: DemoBankTransaction = { id: crypto.randomUUID(), company_id: companyId,
        bank_account_id: account.id, import_id: importId, txn_date: row.txnDate!, value_date: row.valueDate,
        label: row.label, reference: null, amount: row.amount, currency: account.currency,
        balance: row.balance, external_id: null, fingerprint, status: 'unmatched', created_at: NOW };
      s.bankTransactions.push(txn); imported += 1;
    }
    bankImport.imported_count = imported; bankImport.duplicate_count = duplicates;
    s.bankImports.push(bankImport);
    state.mcbImports.push(importId);
    return { imported, duplicates, reimport: false, mcb: preview.mcb, extraction: preview.extraction };
  }

  return undefined;
}
