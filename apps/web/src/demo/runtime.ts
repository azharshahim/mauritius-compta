/**
 * Browser-only demonstration backend.
 *
 * When the bundle is built with VITE_DEMO_MODE=true (GitHub Pages demo), every
 * `/api/*` call is served by this module instead of the Fastify server:
 *
 *   - data lives in localStorage (fictional dataset from the API's own demo seed);
 *   - no network request, no PostgreSQL, no secret, no real customer data;
 *   - the accounting rules of the real engine are reproduced here (exact decimal
 *     arithmetic, numbering, balance control, posted-entry immutability, reversal,
 *     period checks, unique references, trial balance and statements).
 *
 * The interface stays identical: only the transport changes, and a permanent
 * banner states that operations are simulated and never stored on a server.
 */
import { ApiError } from '../errors';
import { toScaled4, scaled4ToString } from '../format';
import { DEMO_SEED } from './seed-data';
import { AI_PROVIDERS, providerByKey } from '../ai/catalogue';
import { chooseAccount, normalise, ruleKeyword } from '../ai/simulation';
import {
  DEMO_MIGRATION_LIMITS,
  cancelDemoJob,
  createDemoJob,
  deleteDemoJob,
  deleteDemoTemplate,
  demoJobView,
  importDemoJob,
  saveDemoTemplate,
  updateDemoJob,
  type DemoMigrationJob,
  type DemoMigrationRecord,
  type DemoMigrationTemplate,
} from './migration';
import { handleDemoBank, seedDemoBank } from './bank';
import { handleDemoPurchases, seedDemoPurchases } from './purchases';
import {
  IMPORT_FIELDS,
  IMPORT_KIND_LABELS,
  PROFILES,
} from '../../../api/src/modules/migration/profiles';

/* ------------------------------------------------------------------ types */

export interface DemoUser {
  id: string;
  email: string;
  password: string;
  full_name: string;
  locale: 'fr' | 'en';
}

export interface DemoCompany {
  id: string;
  name: string;
  brn: string | null;
  crn: string | null;
  client_code: string | null;
  dossier_manager_id: string | null;
  archived_at: string | null;
  vat_number: string | null;
  registered_address: string | null;
  business_activity: string | null;
  financial_year_start: string;
  financial_year_end: string;
  functional_currency: string;
  presentation_currency: string;
  accounting_standard: string;
  status: 'active' | 'inactive' | 'archived';
  locale: 'fr' | 'en';
  created_at: string;
  trade_name?: string | null;
  contact_name?: string | null;
  contact_email?: string | null;
  contact_phone?: string | null;
}

export interface DemoAccount {
  id: string;
  company_id: string;
  code: string;
  name: string;
  type: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';
  parent_id: string | null;
  currency: string;
  is_active: boolean;
  fs_mapping: string | null;
  description: string | null;
}

export interface DemoJournal {
  id: string;
  company_id: string;
  code: string;
  name: string;
  type: string;
  is_active: boolean;
}

export interface DemoEntry {
  id: string;
  company_id: string;
  journal_id: string;
  entry_no: string;
  entry_date: string;
  reference: string | null;
  description: string;
  currency: string;
  exchange_rate: string;
  status: 'draft' | 'posted';
  source: 'manual' | 'reversal' | 'billing' | 'purchase' | 'ai' | 'migration' | 'migration_opening';
  reversal_of_entry_id: string | null;
  posted_at: string | null;
  created_at: string;
}

export interface DemoLine {
  id: string;
  entry_id: string;
  company_id: string;
  account_id: string;
  line_no: number;
  description: string | null;
  debit: string;
  credit: string;
  txn_amount: string | null;
  txn_currency: string;
  fx_rate: string | null;
}

export interface DemoPeriod {
  id: string;
  company_id: string;
  name: string;
  start_date: string;
  end_date: string;
  status: 'open' | 'closed';
}

export interface DemoRate {
  id: string;
  company_id: string;
  from_currency: string;
  to_currency: string;
  rate_date: string;
  rate: string;
  source: string;
}

export interface DemoMember {
  id: string;
  company_id: string;
  user_id: string;
  role: string;
  email: string;
  full_name: string;
}

export interface DemoModuleAccess {
  company_id: string;
  user_id: string;
  module: 'cabinet' | 'accounting' | 'billing' | 'payroll';
  access: 'read' | 'write' | 'admin';
}

export interface DemoTask {
  id: string;
  company_id: string;
  title: string;
  description: string | null;
  category: string;
  priority: string;
  status: string;
  due_date: string | null;
  assigned_to: string | null;
  created_by: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface DemoTaskComment {
  id: string;
  task_id: string;
  company_id: string;
  author_id: string | null;
  body: string;
  created_at: string;
}

export interface DemoAuditEvent {
  id: number;
  company_id: string | null;
  user_id: string | null;
  user_email: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  details: Record<string, unknown>;
  created_at: string;
}

export interface DemoAiSettings {
  enabled: boolean;
  routingMode: 'manual' | 'automatic';
  primaryProvider: string | null;
  primaryModel: string | null;
  fallbackProvider: string | null;
  fallbackModel: string | null;
  monthlyBudgetUsd: string | null;
  monthlyRequestLimit: number | null;
  alertThreshold: number;
  features: Record<string, boolean>;
  /** Only ever a *state*: the demonstration stores no API key of any kind. */
  credentials: Record<string, { configured: boolean; updatedAt: string }>;
}

export interface DemoAiSuggestion {
  id: string;
  company_id: string;
  input_text: string;
  amount: string | null;
  currency: string | null;
  suggested_account_id: string | null;
  suggested_account_code: string | null;
  category: string | null;
  rationale: string | null;
  confidence: number | null;
  status: 'proposed' | 'accepted' | 'modified' | 'rejected';
  decided_account_id: string | null;
  decided_by: string | null;
  decided_at: string | null;
  source: 'provider' | 'rule';
  provider: string | null;
  model: string | null;
  created_by: string | null;
  created_at: string;
  posted_entry_id: string | null;
}

export interface DemoAiRule {
  id: string;
  company_id: string;
  keyword: string;
  account_id: string;
  created_at: string;
}


// ------------------------------------------------- facturation (mission 6)

export interface DemoBillingSettings {
  company_id: string;
  quote_prefix: string;
  invoice_prefix: string;
  credit_prefix: string;
  numbering_policy: 'yearly' | 'continuous';
  default_payment_terms: number;
  default_currency: string;
  vat_enabled: boolean;
  vat_number: string | null;
  legal_footer_fr: string | null;
  legal_footer_en: string | null;
  bank_details: string | null;
  document_language?: 'fr' | 'en';
  logo_url?: string | null;
  default_revenue_account_id?: string | null;
  default_receivable_account_id?: string | null;
  default_bank_account_id?: string | null;
  default_purchase_account_id?: string | null;
  default_vat_input_account_id?: string | null;
  default_vat_output_account_id?: string | null;
}

export interface DemoBillingCustomer {
  id: string;
  company_id: string;
  name: string;
  legal_name: string | null;
  brn: string | null;
  vat_number: string | null;
  address_line1: string | null;
  city: string | null;
  postcode: string | null;
  country: string;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  preferred_currency: string | null;
  payment_terms_days: number | null;
  receivable_account_id: string | null;
  notes: string | null;
  is_active: boolean;
  archived_at: string | null;
  created_at: string;
}

export interface DemoBillingItem {
  id: string;
  company_id: string;
  reference: string;
  label_fr: string;
  label_en: string | null;
  description: string | null;
  unit_price: string;
  currency: string;
  unit: string;
  category: string | null;
  vat_treatment: 'standard' | 'zero_rated' | 'exempt' | 'out_of_scope';
  vat_rate_id: string | null;
  revenue_account_id: string | null;
  is_active: boolean;
  created_at: string;
}

export type DemoTaxTreatment = 'taxable' | 'zero_rated' | 'exempt' | 'out_of_scope';

export interface DemoTaxRate {
  id: string;
  company_id: string;
  code: string;
  label: string;
  rate: string;
  effective_from: string;
  effective_to: string | null;
  verified: boolean;
  source: string | null;
  notes: string | null;
  treatment: DemoTaxTreatment;
  vat_account_id: string | null;
  verified_at: string | null;
  verified_by: string | null;
}

export interface DemoTaxRateEvent {
  id: string;
  company_id: string;
  tax_rate_id: string;
  action: 'created' | 'updated' | 'verified' | 'unverified';
  actor_id: string | null;
  before_state: Record<string, unknown> | null;
  after_state: Record<string, unknown> | null;
  created_at: string;
}

export interface DemoAssistantConversation {
  id: string;
  company_id: string;
  user_id: string;
  module: string;
  screen: string | null;
  locale: 'fr' | 'en';
  title: string | null;
  status: 'open' | 'closed';
  created_at: string;
  updated_at: string;
}

export interface DemoAssistantMessage {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant';
  content: string;
  context: Record<string, unknown>;
  payload: Record<string, unknown>;
  created_at: string;
}

export type DemoDocKind = 'quote' | 'invoice' | 'credit_note';

export interface DemoBillingDocument {
  id: string;
  company_id: string;
  kind: DemoDocKind;
  doc_no: string | null;
  customer_id: string | null;
  customer_name: string;
  customer_brn: string | null;
  issue_date: string;
  due_date: string | null;
  valid_until: string | null;
  currency: string;
  exchange_rate: string;
  subtotal: string;
  discount_total: string;
  tax_total: string;
  total_amount: string;
  amount_paid: string;
  credited_amount: string;
  payment_status: 'unpaid' | 'partial' | 'paid' | 'overpaid';
  status: string;
  source_kind: string | null;
  source_document_id: string | null;
  notes: string | null;
  terms: string | null;
  sequence_year: number | null;
  sequence_no: number | null;
  issued_at: string | null;
  locked_at: string | null;
  accounting_entry_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface DemoBillingLine {
  id: string;
  document_id: string;
  company_id: string;
  line_no: number;
  item_id: string | null;
  description: string;
  quantity: string;
  unit_price: string;
  unit: string;
  discount_pct: string;
  vat_treatment: 'standard' | 'zero_rated' | 'exempt' | 'out_of_scope';
  vat_rate: string | null;
  vat_rate_id: string | null;
  net_amount: string;
  discount_amount: string;
  tax_amount: string;
  line_total: string;
  revenue_account_id: string | null;
}

export interface DemoBillingPayment {
  id: string;
  company_id: string;
  customer_id: string;
  payment_no: string | null;
  payment_date: string;
  value_date: string | null;
  amount: string;
  currency: string;
  exchange_rate: string;
  method: string;
  reference: string | null;
  unallocated_amount: string;
  status: 'recorded' | 'cancelled';
  sequence_year: number | null;
  sequence_no: number | null;
  accounting_entry_id: string | null;
  created_at: string;
}

export interface DemoBillingAllocation {
  id: string;
  payment_id: string;
  invoice_id: string;
  company_id: string;
  amount: string;
}

export interface DemoEntryProposal {
  id: string;
  company_id: string;
  source_kind: 'manual' | 'billing_invoice' | 'billing_credit_note' | 'billing_payment' | 'purchase_invoice' | 'purchase_credit_note' | 'purchase_payment';
  source_id: string | null;
  journal_id: string | null;
  entry_date: string;
  reference: string | null;
  description: string;
  currency: string;
  exchange_rate: string | null;
  status: 'proposed' | 'validated' | 'posted' | 'rejected';
  confidence: number | null;
  rationale: string | null;
  warnings: string[];
  missing: string[];
  rule_trace: string[];
  provider: string | null;
  model: string | null;
  created_at: string;
  updated_at: string;
  validated_by: string | null;
  validated_at: string | null;
  rejected_by: string | null;
  rejected_at: string | null;
  rejection_note: string | null;
  entry_id: string | null;
}

export interface DemoProposalLine {
  id: string;
  proposal_id: string;
  line_no: number;
  account_id: string;
  description: string | null;
  debit: string;
  credit: string;
  rule_id: string | null;
}

export interface DemoEntryRule {
  id: string;
  company_id: string;
  rule_type: 'counterparty' | 'bank_label' | 'expense_category' | 'billing_item' | 'payment_method' | 'journal';
  match_key: string;
  match_label: string | null;
  account_id: string | null;
  counter_account_id: string | null;
  journal_id: string | null;
  account_side: 'debit' | 'credit';
  priority: number;
  version: number;
  is_active: boolean;
  previous_version_id: string | null;
  notes: string | null;
  use_count: number;
  created_at: string;
  validated_by: string | null;
}

export interface DemoBankAccount {
  id: string;
  company_id: string;
  name: string;
  bank_name: string;
  currency: string;
  account_id: string;
  masked_reference: string | null;
  is_active: boolean;
  created_at: string;
}

export interface DemoBankImport {
  id: string;
  company_id: string;
  bank_account_id: string;
  file_name: string;
  file_size: number;
  file_hash: string;
  idempotency_key: string;
  format: string;
  encoding: string;
  status: 'previewed' | 'imported' | 'failed' | 'cancelled';
  row_count: number;
  imported_count: number;
  duplicate_count: number;
  opening_balance: string | null;
  closing_balance: string | null;
  summary: Record<string, unknown>;
  created_at: string;
}

export interface DemoBankTransaction {
  id: string;
  company_id: string;
  bank_account_id: string;
  import_id: string | null;
  txn_date: string;
  value_date: string | null;
  label: string;
  reference: string | null;
  amount: string;
  currency: string;
  balance: string | null;
  external_id: string | null;
  fingerprint: string;
  status:
    | 'unmatched'
    | 'proposed'
    | 'matched'
    | 'partially_matched'
    | 'review'
    | 'excluded'
    | 'cancelled';
  created_at: string;
}

export interface DemoBankMatch {
  id: string;
  company_id: string;
  bank_account_id: string;
  transaction_id: string;
  entry_id: string | null;
  entry_line_id: string | null;
  billing_payment_id: string | null;
  billing_invoice_id?: string | null;
  amount: string;
  note?: string | null;
  status: 'proposed' | 'confirmed' | 'rejected';
  kind: 'entry' | 'invoice' | 'internal_transfer';
  confidence: number;
  reasons: string[];
  created_at: string;
  decided_at: string | null;
  decided_by?: string | null;
}

export interface DemoBankRule {
  id: string;
  company_id: string;
  name: string;
  label_pattern: string | null;
  reference_pattern: string | null;
  bank_account_id: string | null;
  currency: string | null;
  direction: 'any' | 'in' | 'out';
  account_id: string;
  journal_id: string | null;
  priority: number;
  version: number;
  supersedes_id: string | null;
  is_active: boolean;
  notes: string | null;
  created_at: string;
}

export interface DemoBankProposal {
  id: string;
  company_id: string;
  bank_account_id: string;
  transaction_id: string;
  account_id: string | null;
  journal_id: string | null;
  entry_date: string;
  amount: string;
  direction: 'in' | 'out';
  status: 'proposed' | 'accepted' | 'rejected';
  confidence: number;
  rationale: Record<string, unknown>;
  rule_id: string | null;
  created_entry_id: string | null;
  created_at: string;
  decided_at: string | null;
}

/* ----------------------------------------------------- purchases (11) */

export interface DemoPurchaseSupplier {
  id: string;
  company_id: string;
  name: string;
  reference: string | null;
  country: string;
  address_line1: string | null;
  city: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  registration_number: string | null;
  tax_number: string | null;
  preferred_currency: string | null;
  payment_terms_days: number | null;
  payable_account_id: string | null;
  notes: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface DemoPurchaseLine {
  id: string;
  document_id: string;
  company_id: string;
  line_no: number;
  description: string;
  quantity: string;
  unit_price: string;
  account_id: string;
  vat_treatment: 'standard' | 'zero_rated' | 'exempt' | 'out_of_scope';
  vat_rate: string | null;
  vat_rate_id: string | null;
  vat_recoverable: boolean | null;
  net_amount: string;
  tax_amount: string;
  line_total: string;
}

export interface DemoPurchaseDocument {
  id: string;
  company_id: string;
  supplier_id: string;
  kind: 'invoice' | 'credit_note';
  doc_no: string | null;
  supplier_reference: string;
  issue_date: string;
  received_date: string | null;
  due_date: string | null;
  currency: string;
  exchange_rate: string;
  subtotal: string;
  tax_total: string;
  total_amount: string;
  amount_paid: string;
  credited_amount: string;
  status: 'draft' | 'validated' | 'cancelled';
  payment_status: 'unpaid' | 'partial' | 'paid';
  source_document_id: string | null;
  reason: string | null;
  notes: string | null;
  sequence_year: number | null;
  sequence_no: number | null;
  accounting_entry_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface DemoPurchasePayment {
  id: string;
  company_id: string;
  supplier_id: string;
  payment_no: string | null;
  kind: 'payment' | 'advance';
  payment_date: string;
  amount: string;
  currency: string;
  exchange_rate: string;
  method: string;
  reference: string | null;
  unallocated_amount: string;
  status: 'recorded' | 'cancelled';
  sequence_year: number | null;
  sequence_no: number | null;
  accounting_entry_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface DemoPurchaseAllocation {
  id: string;
  company_id: string;
  payment_id: string;
  invoice_id: string;
  amount: string;
  cancelled_at: string | null;
}

export interface DemoPurchaseCreditAllocation {
  id: string;
  company_id: string;
  credit_note_id: string;
  invoice_id: string;
  amount: string;
  reason: string | null;
  cancelled_at: string | null;
  created_at: string;
}

export interface DemoPurchaseEvent {
  id: string;
  company_id: string;
  document_id: string | null;
  payment_id: string | null;
  action: string;
  details: Record<string, unknown> | null;
  actor_id: string | null;
  created_at: string;
}

export interface DemoState {
  schema: number;
  users: DemoUser[];
  session: string | null;
  companies: DemoCompany[];
  accounts: DemoAccount[];
  journals: DemoJournal[];
  entries: DemoEntry[];
  lines: DemoLine[];
  periods: DemoPeriod[];
  rates: DemoRate[];
  members: DemoMember[];
  moduleAccess: DemoModuleAccess[];
  tasks: DemoTask[];
  taskComments: DemoTaskComment[];
  audit: DemoAuditEvent[];
  sequences: Record<string, number>;
  auditSeq: number;
  ai: DemoAiSettings;
  aiSuggestions: DemoAiSuggestion[];
  aiRules: DemoAiRule[];
  billingSettings: DemoBillingSettings[];
  billingCustomers: DemoBillingCustomer[];
  billingItems: DemoBillingItem[];
  taxRates: DemoTaxRate[];
  taxRateEvents: DemoTaxRateEvent[];
  assistantConversations: DemoAssistantConversation[];
  assistantMessages: DemoAssistantMessage[];
  billingDocuments: DemoBillingDocument[];
  billingLines: DemoBillingLine[];
  billingPayments: DemoBillingPayment[];
  billingAllocations: DemoBillingAllocation[];
  billingSequences: Record<string, number>;
  entryProposals: DemoEntryProposal[];
  proposalLines: DemoProposalLine[];
  entryRules: DemoEntryRule[];
  migrationJobs: DemoMigrationJob[];
  migrationTemplates: DemoMigrationTemplate[];
  migrationRecords: DemoMigrationRecord[];
  bankAccounts: DemoBankAccount[];
  bankImports: DemoBankImport[];
  bankTransactions: DemoBankTransaction[];
  bankMatches: DemoBankMatch[];
  bankRules: DemoBankRule[];
  bankProposals: DemoBankProposal[];
  purchaseSuppliers: DemoPurchaseSupplier[];
  purchaseDocuments: DemoPurchaseDocument[];
  purchaseLines: DemoPurchaseLine[];
  purchasePayments: DemoPurchasePayment[];
  purchaseAllocations: DemoPurchaseAllocation[];
  purchaseCreditAllocations: DemoPurchaseCreditAllocation[];
  purchaseEvents: DemoPurchaseEvent[];
  purchaseSequences: Record<string, number>;
}

/* ------------------------------------------------------------------ money */

const RATE_SCALE = 8n;
const RATE_FACTOR = 10n ** RATE_SCALE;

function parseRate(raw: string | number): bigint {
  const text = String(raw).trim().replace(',', '.');
  const match = /^(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match) throw new ApiError(400, 'VALIDATION_ERROR', 'Taux invalide');
  const int = BigInt(match[1]!);
  const frac = (match[2] ?? '').slice(0, 8).padEnd(8, '0');
  const scaled = int * RATE_FACTOR + BigInt(frac);
  if (scaled <= 0n) throw new ApiError(400, 'VALIDATION_ERROR', 'Taux invalide');
  return scaled;
}

function rateToString(scaled: bigint): string {
  const int = scaled / RATE_FACTOR;
  const frac = (scaled % RATE_FACTOR).toString().padStart(8, '0');
  return `${int}.${frac}`;
}

/** Keeps 8 significant decimals of an already computed string (no float). */
function normaliseRate(scaled: bigint): string {
  return rateToString(scaled);
}

const amount = (value: string | number | null | undefined): bigint => toScaled4(value) ?? 0n;

/** Exact multiplication of an amount (scale 4) by a rate (scale 8). */
function multiply(amountScaled: bigint, rateScaled: bigint): bigint {
  const product = amountScaled * rateScaled; // scale 12
  const unit = 10n ** RATE_SCALE; // 1e8
  const negative = product < 0n;
  const abs = negative ? -product : product;
  const quotient = abs / unit;
  const remainder = abs % unit;
  const rounded = remainder * 2n >= unit ? quotient + 1n : quotient;
  return negative ? -rounded : rounded;
}

const fmt = (scaled: bigint): string => scaled4ToString(scaled);

function reciprocal(rateScaled: bigint): string {
  const numerator = RATE_FACTOR * RATE_FACTOR; // 1e16
  const quotient = numerator / rateScaled;
  const remainder = numerator % rateScaled;
  const rounded = remainder * 2n >= rateScaled ? quotient + 1n : quotient;
  return normaliseRate(rounded);
}

/* --------------------------------------------------------------- storage */

const STORAGE_KEY = 'mc.demo.state.v1';
export const DEMO_EMAIL = 'demo@mauritius-compta.test';
export const DEMO_PASSWORD = 'DemoPassw0rd2026';

const uid = () => crypto.randomUUID();
const now = () => new Date().toISOString();
const todayIso = () => new Date().toISOString().slice(0, 10);

function memoryStorage(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const probe = '__mc_probe__';
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
    return localStorage;
  } catch {
    return null; // private mode / disabled storage: demo still works in memory
  }
}

let state: DemoState | null = null;
let volatile = false;

function seedState(): DemoState {
  const created = now();
  const demoUser: DemoUser = {
    id: uid(),
    email: DEMO_EMAIL,
    password: DEMO_PASSWORD,
    full_name: 'Comptable de démonstration',
    locale: 'fr',
  };
  const company: DemoCompany = {
    id: uid(),
    name: DEMO_SEED.company.name ?? 'Lagon Bleu Trading Ltd (DEMO)',
    brn: DEMO_SEED.company.brn ?? null,
    crn: 'CRN-DEMO-0001',
    client_code: 'DEMO-001',
    dossier_manager_id: demoUser.id,
    archived_at: null,
    vat_number: DEMO_SEED.company.vat_number ?? null,
    registered_address: DEMO_SEED.company.registered_address ?? null,
    business_activity: DEMO_SEED.company.business_activity ?? null,
    financial_year_start: DEMO_SEED.company.financial_year_start ?? '2025-07-01',
    financial_year_end: DEMO_SEED.company.financial_year_end ?? '2026-06-30',
    functional_currency: DEMO_SEED.company.functional_currency ?? 'MUR',
    presentation_currency: DEMO_SEED.company.presentation_currency ?? 'MUR',
    accounting_standard: DEMO_SEED.company.accounting_standard ?? 'IFRS',
    status: (DEMO_SEED.company.status as DemoCompany['status']) ?? 'active',
    locale: (DEMO_SEED.company.locale as 'fr' | 'en') ?? 'fr',
    created_at: created,
    trade_name: 'Lagon Bleu (enseigne fictive)',
    contact_name: 'Contact Fictif Démo',
    contact_email: 'contact@lagon-bleu.example.test',
    contact_phone: '+230 0000 0000 (fictif)',
  };

  const accounts: DemoAccount[] = [];
  const accountByCode = new Map<string, DemoAccount>();
  for (const a of DEMO_SEED.accounts) {
    const account: DemoAccount = {
      id: uid(),
      company_id: company.id,
      code: a.code,
      name: a.name,
      type: a.type as DemoAccount['type'],
      parent_id: null,
      currency: a.currency,
      is_active: a.is_active,
      fs_mapping: a.fs_mapping,
      description: a.description,
    };
    accounts.push(account);
    accountByCode.set(a.code, account);
  }
  for (const a of DEMO_SEED.accounts) {
    if (a.parent_code) {
      const child = accountByCode.get(a.code);
      const parent = accountByCode.get(a.parent_code);
      if (child && parent) child.parent_id = parent.id;
    }
  }

  const journals: DemoJournal[] = DEMO_SEED.journals.map((j) => ({
    id: uid(),
    company_id: company.id,
    code: j.code,
    name: j.name,
    type: j.type,
    is_active: true,
  }));
  const journalByCode = new Map(journals.map((j) => [j.code, j]));

  const entries: DemoEntry[] = [];
  const lines: DemoLine[] = [];
  const byNumber = new Map<string, DemoEntry>();

  for (const e of DEMO_SEED.entries) {
    const journal = journalByCode.get(e.journal_code);
    if (!journal) continue;
    const entry: DemoEntry = {
      id: uid(),
      company_id: company.id,
      journal_id: journal.id,
      entry_no: e.entry_no,
      entry_date: e.entry_date,
      reference: e.reference,
      description: e.description,
      currency: e.currency,
      exchange_rate: e.exchange_rate,
      status: e.status,
      source: (e.source as DemoEntry['source']) ?? 'manual',
      reversal_of_entry_id: null,
      posted_at: e.status === 'posted' ? `${e.entry_date}T09:00:00.000Z` : null,
      created_at: `${e.entry_date}T09:00:00.000Z`,
    };
    entries.push(entry);
    byNumber.set(entry.entry_no, entry);
    e.lines.forEach((l, index) => {
      const account = accountByCode.get(l.account_code);
      if (!account) return;
      lines.push({
        id: uid(),
        entry_id: entry.id,
        company_id: company.id,
        account_id: account.id,
        line_no: index + 1,
        description: l.description,
        debit: l.debit ?? '0.0000',
        credit: l.credit ?? '0.0000',
        txn_amount: l.txn_amount,
        txn_currency: l.txn_currency,
        fx_rate: l.fx_rate,
      });
    });
  }
  for (const e of DEMO_SEED.entries) {
    if (e.reversal_of) {
      const child = byNumber.get(e.entry_no);
      const parent = byNumber.get(e.reversal_of);
      if (child && parent) child.reversal_of_entry_id = parent.id;
    }
  }

  const sequences: Record<string, number> = {};
  for (const entry of entries) {
    const year = entry.entry_date.slice(0, 4);
    const journal = journals.find((j) => j.id === entry.journal_id);
    if (!journal) continue;
    const key = `${journal.code}-${year}`;
    const n = Number(entry.entry_no.split('-')[2] ?? '0');
    sequences[key] = Math.max(sequences[key] ?? 0, n);
  }

  const periods: DemoPeriod[] = [
    {
      id: uid(),
      company_id: company.id,
      name: 'FY 2025/2026',
      start_date: company.financial_year_start,
      end_date: company.financial_year_end,
      status: 'open',
    },
  ];

  const rates: DemoRate[] = [
    {
      id: uid(),
      company_id: company.id,
      from_currency: 'EUR',
      to_currency: company.functional_currency,
      rate_date: '2025-08-12',
      rate: '48.50000000',
      source: 'Taux de démonstration (fictif)',
    },
  ];

  const members: DemoMember[] = [
    {
      id: uid(),
      company_id: company.id,
      user_id: demoUser.id,
      role: 'owner',
      email: demoUser.email,
      full_name: demoUser.full_name,
    },
  ];

  // ------------------------------------------------- collaborators (fictifs)
  const collaborators: DemoUser[] = [
    {
      id: uid(),
      email: 'a.ramgoolam@cabinet-demo.test',
      password: 'DemoCollab2026',
      full_name: 'Anjali Ramgoolam (fictif)',
      locale: 'fr',
    },
    {
      id: uid(),
      email: 'j.leclézio@cabinet-demo.test',
      password: 'DemoCollab2026',
      full_name: 'Jean Leclézio (fictif)',
      locale: 'fr',
    },
    {
      id: uid(),
      email: 's.patel@cabinet-demo.test',
      password: 'DemoCollab2026',
      full_name: 'Sonia Patel (fictive)',
      locale: 'en',
    },
  ];

  // --------------------------------------------- additional demo dossiers
  const extraSeed = [
    {
      name: 'Case Noyale Retail Ltd (DEMO)',
      brn: 'DEMO-BRN-0002',
      vat: 'DEMO-VAT-0002',
      crn: 'CRN-DEMO-0002',
      code: 'DEMO-002',
      activity: 'Commerce de détail (fictif)',
      address: '12, Royal Road, Case Noyale (fictif)',
      manager: collaborators[0]!.id,
      status: 'active' as const,
    },
    {
      name: 'Belle Mare Hospitality Ltd (DEMO)',
      brn: 'DEMO-BRN-0003',
      vat: 'DEMO-VAT-0003',
      crn: 'CRN-DEMO-0003',
      code: 'DEMO-003',
      activity: 'Hôtellerie et restauration (fictif)',
      address: '3, Coastal Road, Belle Mare (fictif)',
      manager: collaborators[1]!.id,
      status: 'active' as const,
    },
    {
      name: 'Vieux Grand Port Logistics Ltd (DEMO)',
      brn: 'DEMO-BRN-0004',
      vat: null,
      crn: 'CRN-DEMO-0004',
      code: 'DEMO-004',
      activity: 'Transit et logistique (fictif)',
      address: '8, Harbour Street, Vieux Grand Port (fictif)',
      manager: null as string | null,
      status: 'archived' as const,
    },
  ];

  const minimalChart: [string, string, DemoAccount['type']][] = [
    ['1010', 'Banque (MUR)', 'asset'],
    ['2010', 'Fournisseurs', 'liability'],
    ['3010', 'Capital social', 'equity'],
    ['4000', 'Ventes', 'revenue'],
    ['5000', 'Achats', 'expense'],
    ['6010', 'Charges externes', 'expense'],
  ];

  const extraCompanies: DemoCompany[] = [];
  const extraMembers: DemoMember[] = [];
  for (const seed of extraSeed) {
    const extra: DemoCompany = {
      id: uid(),
      name: seed.name,
      brn: seed.brn,
      crn: seed.crn,
      client_code: seed.code,
      dossier_manager_id: seed.manager,
      archived_at: seed.status === 'archived' ? created : null,
      vat_number: seed.vat,
      registered_address: seed.address,
      business_activity: seed.activity,
      financial_year_start: '2025-07-01',
      financial_year_end: '2026-06-30',
      functional_currency: 'MUR',
      presentation_currency: 'MUR',
      accounting_standard: 'IFRS for SMEs',
      status: seed.status,
      locale: 'fr',
      created_at: created,
    };
    extraCompanies.push(extra);
    for (const [code, name, type] of minimalChart) {
      accounts.push({
        id: uid(),
        company_id: extra.id,
        code,
        name,
        type,
        parent_id: null,
        currency: 'MUR',
        is_active: true,
        fs_mapping: code.startsWith('1') ? 'bs.current_assets.cash_and_equivalents' : null,
        description: null,
      });
    }
    for (const template of DEMO_SEED.journals.filter((j) =>
      ['OD', 'VE', 'AC'].includes(j.code),
    )) {
      journals.push({
        id: uid(),
        company_id: extra.id,
        code: template.code,
        name: template.name,
        type: template.type,
        is_active: true,
      });
    }
    periods.push({
      id: uid(),
      company_id: extra.id,
      name: 'FY 2025/2026',
      start_date: extra.financial_year_start,
      end_date: extra.financial_year_end,
      status: 'open',
    });
    extraMembers.push({
      id: uid(),
      company_id: extra.id,
      user_id: demoUser.id,
      role: 'cabinet_admin',
      email: demoUser.email,
      full_name: demoUser.full_name,
    });
    if (seed.manager) {
      const manager = collaborators.find((c) => c.id === seed.manager)!;
      extraMembers.push({
        id: uid(),
        company_id: extra.id,
        user_id: manager.id,
        role: 'manager',
        email: manager.email,
        full_name: manager.full_name,
      });
    }
  }

  // ------------------------------------------------------ cabinet tasks
  const day = (offset: number) => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + offset);
    return d.toISOString().slice(0, 10);
  };
  const taskSeed: {
    company: string;
    title: string;
    category: string;
    priority: string;
    status: string;
    due: number;
    assignee: string | null;
    description?: string;
  }[] = [
    {
      company: company.id,
      title: 'Réviser la balance au 30 septembre (fictif)',
      category: 'accounting',
      priority: 'high',
      status: 'in_progress',
      due: 3,
      assignee: demoUser.id,
      description: 'Contrôle des comptes d’attente et des comptes bancaires.',
    },
    {
      company: company.id,
      title: 'Préparer le dossier TVA du trimestre (fictif)',
      category: 'vat',
      priority: 'urgent',
      status: 'todo',
      due: -2,
      assignee: collaborators[2]!.id,
    },
    {
      company: company.id,
      title: 'Mettre à jour les états financiers provisoires',
      category: 'financial_statements',
      priority: 'normal',
      status: 'todo',
      due: 12,
      assignee: collaborators[0]!.id,
    },
    {
      company: company.id,
      title: 'Classer les justificatifs fournisseurs',
      category: 'administrative',
      priority: 'low',
      status: 'done',
      due: -12,
      assignee: demoUser.id,
    },
    {
      company: extraCompanies[0]!.id,
      title: 'Rapprochement bancaire de septembre (fictif)',
      category: 'accounting',
      priority: 'high',
      status: 'todo',
      due: 5,
      assignee: collaborators[0]!.id,
    },
    {
      company: extraCompanies[0]!.id,
      title: 'Inventaire de fin d’année',
      category: 'accounting',
      priority: 'normal',
      status: 'blocked',
      due: 21,
      assignee: collaborators[1]!.id,
    },
    {
      company: extraCompanies[1]!.id,
      title: 'Contrôle des notes de restaurant (fictif)',
      category: 'vat',
      priority: 'normal',
      status: 'todo',
      due: -5,
      assignee: collaborators[1]!.id,
    },
    {
      company: extraCompanies[1]!.id,
      title: 'Préparer la revue de paie du mois',
      category: 'payroll',
      priority: 'normal',
      status: 'todo',
      due: 9,
      assignee: null,
    },
    {
      company: extraCompanies[2]!.id,
      title: 'Archiver les liasses 2024 (fictif)',
      category: 'administrative',
      priority: 'low',
      status: 'done',
      due: -30,
      assignee: demoUser.id,
    },
  ];
  const tasks: DemoTask[] = taskSeed.map((task) => ({
    id: uid(),
    company_id: task.company,
    title: task.title,
    description: task.description ?? null,
    category: task.category,
    priority: task.priority,
    status: task.status,
    due_date: day(task.due),
    assigned_to: task.assignee,
    created_by: demoUser.id,
    completed_at: task.status === 'done' ? now() : null,
    created_at: created,
    updated_at: created,
  }));

  const taskComments: DemoTaskComment[] = tasks.slice(0, 2).map((task, i) => ({
    id: uid(),
    task_id: task.id,
    company_id: task.company_id,
    author_id: collaborators[i]!.id,
    body:
      i === 0
        ? 'Premier contrôle effectué, deux comptes restent à justifier (fictif).'
        : 'Pièces reçues du client, vérification en cours (fictif).',
    created_at: now(),
  }));


  /* ---------------------------------------------------- facturation (démo) */
  const idByCode = new Map(accounts.filter((a) => a.company_id === company.id).map((a) => [a.code, a.id]));
  const journalOfType = (type: string) => journals.find((j) => j.company_id === company.id && j.type === type);
  const billingSettings: DemoBillingSettings = {
    company_id: company.id,
    quote_prefix: 'DEV',
    invoice_prefix: 'FAC',
    credit_prefix: 'AV',
    numbering_policy: 'yearly',
    default_payment_terms: 30,
    default_currency: 'MUR',
    vat_enabled: false,
    vat_number: null,
    legal_footer_fr:
      'Document de démonstration — données fictives. Aucune valeur fiscale. E-invoicing MRA désactivé.',
    legal_footer_en:
      'Demonstration document — fictitious data. No tax value. MRA e-invoicing disabled.',
    bank_details: 'Demo Bank — compte fictif 000000000 (MUR)',
  };
  const billingCustomers: DemoBillingCustomer[] = [
    {
      id: uid(),
      company_id: company.id,
      name: 'Rivière Noire Supplies Ltd (fictif)',
      legal_name: 'Rivière Noire Supplies Ltd',
      brn: 'DEMO-CL-0001',
      vat_number: null,
      address_line1: '4, Fictitious Road',
      city: 'Port Louis',
      postcode: '00000',
      country: 'MU',
      contact_name: 'Contact fictif A',
      contact_email: 'contact.a@example.invalid',
      contact_phone: null,
      preferred_currency: 'MUR',
      payment_terms_days: 15,
      receivable_account_id: idByCode.get('1100') ?? null,
      notes: 'Client de démonstration — toute ressemblance serait fortuite.',
      is_active: true,
      archived_at: null,
      created_at: now(),
    },
    {
      id: uid(),
      company_id: company.id,
      name: 'Mahébourg Consulting Ltd (fictif)',
      legal_name: 'Mahébourg Consulting Ltd',
      brn: 'DEMO-CL-0002',
      vat_number: null,
      address_line1: '9, Imaginary Avenue',
      city: 'Mahébourg',
      postcode: '00000',
      country: 'MU',
      contact_name: 'Contact fictif B',
      contact_email: 'contact.b@example.invalid',
      contact_phone: null,
      preferred_currency: 'MUR',
      payment_terms_days: 30,
      receivable_account_id: idByCode.get('1100') ?? null,
      notes: null,
      is_active: true,
      archived_at: null,
      created_at: now(),
    },
  ];
  const billingItems: DemoBillingItem[] = [
    {
      id: uid(),
      company_id: company.id,
      reference: 'SRV-CONS',
      label_fr: 'Prestation de conseil (fictive)',
      label_en: 'Consulting service (fictitious)',
      description: 'Prestation fictive de conseil',
      unit_price: '2500.0000',
      currency: 'MUR',
      unit: 'day',
      category: 'services',
      vat_treatment: 'zero_rated',
      vat_rate_id: null,
      revenue_account_id: idByCode.get('4000') ?? null,
      is_active: true,
      created_at: now(),
    },
    {
      id: uid(),
      company_id: company.id,
      reference: 'SRV-SUPPORT',
      label_fr: 'Support mensuel (fictif)',
      label_en: 'Monthly support (fictitious)',
      description: 'Support mensuel fictif',
      unit_price: '8000.0000',
      currency: 'MUR',
      unit: 'month',
      category: 'services',
      vat_treatment: 'zero_rated',
      vat_rate_id: null,
      revenue_account_id: idByCode.get('4010') ?? null,
      is_active: true,
      created_at: now(),
    },
    {
      id: uid(),
      company_id: company.id,
      reference: 'GOODS-FICT',
      label_fr: 'Marchandise fictive',
      label_en: 'Fictitious goods',
      description: 'Article de démonstration',
      unit_price: '1200.0000',
      currency: 'MUR',
      unit: 'unit',
      category: 'goods',
      vat_treatment: 'zero_rated',
      vat_rate_id: null,
      revenue_account_id: idByCode.get('4010') ?? null,
      is_active: true,
      created_at: now(),
    },
  ];
  const taxRates: DemoTaxRate[] = [];
  const seq: Record<string, number> = {};
  const makeLine = (
    documentId: string,
    lineNo: number,
    item: DemoBillingItem,
    quantity: string,
    description?: string,
  ): DemoBillingLine => {
    const net = mulMoney(amount(quantity), amount(item.unit_price));
    return {
      id: uid(),
      document_id: documentId,
      company_id: company.id,
      line_no: lineNo,
      item_id: item.id,
      description: description ?? item.label_fr,
      quantity,
      unit_price: item.unit_price,
      unit: item.unit,
      discount_pct: '0.0000',
      vat_treatment: item.vat_treatment,
      vat_rate: null,
      vat_rate_id: null,
      net_amount: fmt(net),
      discount_amount: '0.0000',
      tax_amount: '0.0000',
      line_total: fmt(net),
      revenue_account_id: item.revenue_account_id,
    };
  };
  const invoiceAId = uid();
  const invoiceBId = uid();
  const creditId = uid();
  const quoteId = uid();
  const paymentId = uid();
  const billingLines: DemoBillingLine[] = [
    makeLine(invoiceAId, 1, billingItems[1]!, '3.0000'),
    makeLine(invoiceBId, 1, billingItems[0]!, '2.0000'),
    makeLine(creditId, 1, billingItems[1]!, '1.0000'),
    makeLine(quoteId, 1, billingItems[0]!, '4.0000'),
  ];
  const docTotals = (documentId: string) => {
    const rows = billingLines.filter((l) => l.document_id === documentId);
    const sum = (key: 'net_amount' | 'tax_amount' | 'line_total') =>
      rows.reduce((acc, l) => acc + amount(l[key]), 0n);
    return { subtotal: fmt(sum('net_amount')), tax: fmt(sum('tax_amount')), total: fmt(sum('line_total')) };
  };
  const billingDocuments: DemoBillingDocument[] = [
    {
      id: quoteId,
      company_id: company.id,
      kind: 'quote',
      doc_no: 'DEV-DEMO-0001',
      customer_id: billingCustomers[1]!.id,
      customer_name: billingCustomers[1]!.name,
      customer_brn: billingCustomers[1]!.brn,
      issue_date: day(-5),
      due_date: null,
      valid_until: day(25),
      currency: 'MUR',
      exchange_rate: '1.00000000',
      subtotal: docTotals(quoteId).subtotal,
      discount_total: '0.0000',
      tax_total: docTotals(quoteId).tax,
      total_amount: docTotals(quoteId).total,
      amount_paid: '0.0000',
      credited_amount: '0.0000',
      payment_status: 'unpaid',
      status: 'sent',
      source_kind: null,
      source_document_id: null,
      notes: 'Devis de démonstration (fictif).',
      terms: 'Validité indicative — aucune condition réelle.',
      sequence_year: Number(day(-5).slice(0, 4)),
      sequence_no: 1,
      issued_at: now(),
      locked_at: now(),
      accounting_entry_id: null,
      created_at: now(),
      updated_at: now(),
    },
    {
      id: invoiceAId,
      company_id: company.id,
      kind: 'invoice',
      doc_no: 'FAC-DEMO-0001',
      customer_id: billingCustomers[0]!.id,
      customer_name: billingCustomers[0]!.name,
      customer_brn: billingCustomers[0]!.brn,
      issue_date: day(-100),
      due_date: day(-85),
      valid_until: null,
      currency: 'MUR',
      exchange_rate: '1.00000000',
      subtotal: docTotals(invoiceAId).subtotal,
      discount_total: '0.0000',
      tax_total: docTotals(invoiceAId).tax,
      total_amount: docTotals(invoiceAId).total,
      amount_paid: '10000.0000',
      credited_amount: '8000.0000',
      payment_status: 'partial',
      status: 'partially_paid',
      source_kind: null,
      source_document_id: null,
      notes: 'Facture émise, partiellement réglée puis partiellement créditée (fictif).',
      terms: null,
      sequence_year: Number(day(-100).slice(0, 4)),
      sequence_no: 1,
      issued_at: now(),
      locked_at: now(),
      accounting_entry_id: null,
      created_at: now(),
      updated_at: now(),
    },
    {
      id: invoiceBId,
      company_id: company.id,
      kind: 'invoice',
      doc_no: 'FAC-DEMO-0002',
      customer_id: billingCustomers[1]!.id,
      customer_name: billingCustomers[1]!.name,
      customer_brn: billingCustomers[1]!.brn,
      issue_date: day(-40),
      due_date: day(10),
      valid_until: null,
      currency: 'MUR',
      exchange_rate: '1.00000000',
      subtotal: docTotals(invoiceBId).subtotal,
      discount_total: '0.0000',
      tax_total: docTotals(invoiceBId).tax,
      total_amount: docTotals(invoiceBId).total,
      amount_paid: '0.0000',
      credited_amount: '0.0000',
      payment_status: 'unpaid',
      status: 'issued',
      source_kind: null,
      source_document_id: null,
      notes: 'Facture non comptabilisée : la démonstration passe par une proposition validée par un humain.',
      terms: null,
      sequence_year: Number(day(-40).slice(0, 4)),
      sequence_no: 2,
      issued_at: now(),
      locked_at: now(),
      accounting_entry_id: null,
      created_at: now(),
      updated_at: now(),
    },
    {
      id: creditId,
      company_id: company.id,
      kind: 'credit_note',
      doc_no: 'AV-DEMO-0001',
      customer_id: billingCustomers[0]!.id,
      customer_name: billingCustomers[0]!.name,
      customer_brn: billingCustomers[0]!.brn,
      issue_date: day(-95),
      due_date: null,
      valid_until: null,
      currency: 'MUR',
      exchange_rate: '1.00000000',
      subtotal: docTotals(creditId).subtotal,
      discount_total: '0.0000',
      tax_total: docTotals(creditId).tax,
      total_amount: docTotals(creditId).total,
      amount_paid: '0.0000',
      credited_amount: '0.0000',
      payment_status: 'unpaid',
      status: 'issued',
      source_kind: 'invoice',
      source_document_id: invoiceAId,
      notes: 'Avoir partiel sur FAC-DEMO-0001 (fictif).',
      terms: null,
      sequence_year: Number(day(-95).slice(0, 4)),
      sequence_no: 1,
      issued_at: now(),
      locked_at: now(),
      accounting_entry_id: null,
      created_at: now(),
      updated_at: now(),
    },
  ];
  seq[`BILL-quote-${Number(day(-5).slice(0, 4))}`] = 1;
  seq[`BILL-invoice-${Number(day(-100).slice(0, 4))}`] = 2;
  seq[`BILL-credit_note-${Number(day(-95).slice(0, 4))}`] = 1;
  seq[`BILL-payment-${Number(day(-90).slice(0, 4))}`] = 1;
  const billingPayments: DemoBillingPayment[] = [
    {
      id: paymentId,
      company_id: company.id,
      customer_id: billingCustomers[0]!.id,
      payment_no: 'REC-DEMO-0001',
      payment_date: day(-90),
      value_date: day(-90),
      amount: '10000.0000',
      currency: 'MUR',
      exchange_rate: '1.00000000',
      method: 'bank_transfer',
      reference: 'DEMO-REF-0001',
      unallocated_amount: '0.0000',
      status: 'recorded',
      sequence_year: Number(day(-90).slice(0, 4)),
      sequence_no: 1,
      accounting_entry_id: null,
      created_at: now(),
    },
  ];
  const billingAllocations: DemoBillingAllocation[] = [
    { id: uid(), payment_id: paymentId, invoice_id: invoiceAId, company_id: company.id, amount: '10000.0000' },
  ];
  const entryRules: DemoEntryRule[] = [
    {
      id: uid(),
      company_id: company.id,
      rule_type: 'counterparty',
      match_key: 'Fournitures Fictives SARL',
      match_label: 'Fournitures Fictives SARL',
      account_id: idByCode.get('5000') ?? null,
      counter_account_id: idByCode.get('2000') ?? null,
      journal_id: journalOfType('purchases')?.id ?? null,
      account_side: 'debit',
      priority: 10,
      version: 1,
      is_active: true,
      previous_version_id: null,
      notes: 'Règle créée lors d’une correction humaine de démonstration.',
      use_count: 1,
      created_at: now(),
      validated_by: demoUser.id,
    },
    {
      id: uid(),
      company_id: company.id,
      rule_type: 'bank_label',
      match_key: 'FRAIS BANCAIRES DEMO',
      match_label: 'Frais bancaires (relevé fictif)',
      account_id: idByCode.get('6140') ?? null,
      counter_account_id: idByCode.get('1010') ?? null,
      journal_id: journalOfType('bank')?.id ?? null,
      account_side: 'debit',
      priority: 20,
      version: 1,
      is_active: true,
      previous_version_id: null,
      notes: null,
      use_count: 0,
      created_at: now(),
      validated_by: demoUser.id,
    },
  ];
  const seedProposalId = uid();
  const entryProposals: DemoEntryProposal[] = [
    {
      id: seedProposalId,
      company_id: company.id,
      source_kind: 'manual',
      source_id: null,
      journal_id: journalOfType('purchases')?.id ?? null,
      entry_date: day(-3),
      reference: 'DEMO-ACHAT-0001',
      description: 'Achat de fournitures de bureau (fictif)',
      currency: 'MUR',
      exchange_rate: '1.00000000',
      status: 'proposed',
      confidence: 0.72,
      rationale: 'Charge au débit, dette fournisseur au crédit — proposition simulée, à vérifier humainement.',
      warnings: [],
      missing: ['Justificatif fictif non joint'],
      rule_trace: ['Aucune règle validée ne correspondait initialement.'],
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
    },
  ];
  const proposalLines: DemoProposalLine[] = [
    {
      id: uid(),
      proposal_id: seedProposalId,
      line_no: 1,
      account_id: idByCode.get('5000')!,
      description: 'Fournitures de bureau',
      debit: '2500.0000',
      credit: '0.0000',
      rule_id: null,
    },
    {
      id: uid(),
      proposal_id: seedProposalId,
      line_no: 2,
      account_id: idByCode.get('2000')!,
      description: 'Dette fournisseur',
      debit: '0.0000',
      credit: '2500.0000',
      rule_id: null,
    },
  ];
  const todayIsoDate = day(0);
  const todayDate = new Date(`${todayIsoDate}T00:00:00Z`);
  const fyStartYear = todayDate.getUTCMonth() >= 6 ? todayDate.getUTCFullYear() : todayDate.getUTCFullYear() - 1;
  const coversToday = periods.some(
    (p) => p.company_id === company.id && p.status === 'open' && p.start_date <= todayIsoDate && p.end_date >= todayIsoDate,
  );
  if (!coversToday) {
    periods.push({
      id: uid(),
      company_id: company.id,
      name: `Exercice ${fyStartYear}/${fyStartYear + 1} (démo)`,
      start_date: `${fyStartYear}-07-01`,
      end_date: `${fyStartYear + 1}-06-30`,
      status: 'open',
    });
  }

  // Demonstration parameter only: 15 % is *not* presented as a Mauritian rule
  // and stays unverified until a human documents the source.
  taxRates.push({
    id: uid(),
    company_id: company.id,
    code: 'DEMO-15',
    label: 'Taux de démonstration 15 % (fictif, non vérifié)',
    rate: '15.0000',
    effective_from: company.financial_year_start,
    effective_to: null,
    verified: false,
    source: 'Paramètre de démonstration fictif — aucune valeur légale',
    notes: 'Saisi pour illustrer la configuration TVA. Ne pas présenter comme un taux officiel.',
    treatment: 'taxable',
    vat_account_id: idByCode.get('4000') ?? null,
    verified_at: null,
    verified_by: null,
  });

  const seeded: DemoState = {
    schema: 9,
    users: [demoUser, ...collaborators],
    session: null,
    companies: [company, ...extraCompanies],
    accounts,
    journals,
    entries,
    lines,
    periods,
    rates,
    members: [...members, ...extraMembers],
    moduleAccess: [],
    tasks,
    taskComments,
    audit: [
      {
        id: 1,
        company_id: company.id,
        user_id: demoUser.id,
        user_email: demoUser.email,
        action: 'demo.seed',
        entity_type: 'company',
        entity_id: company.id,
        details: { note: 'Données fictives chargées dans le navigateur' },
        created_at: now(),
      },
    ],
    sequences,
    auditSeq: 1,
    ai: {
      enabled: true,
      routingMode: 'manual',
      primaryProvider: 'simulated',
      primaryModel: 'simulated-fictif',
      fallbackProvider: null,
      fallbackModel: null,
      monthlyBudgetUsd: null,
      monthlyRequestLimit: 50,
      alertThreshold: 80,
      features: { accounting: true, cabinet: true, billing: false, payroll: false },
      credentials: {},
    },
    aiSuggestions: [],
    aiRules: [],
    billingSettings: [billingSettings],
    billingCustomers,
    billingItems,
    taxRates,
    taxRateEvents: [],
    assistantConversations: [],
    assistantMessages: [],
    billingDocuments,
    billingLines,
    billingPayments,
    billingAllocations,
    billingSequences: seq,
    entryProposals,
    proposalLines,
    entryRules,
    migrationJobs: [],
    migrationTemplates: [],
    migrationRecords: [],
    bankAccounts: [],
    bankImports: [],
    bankTransactions: [],
    bankMatches: [],
    bankRules: [],
    bankProposals: [],
    purchaseSuppliers: [],
    purchaseDocuments: [],
    purchaseLines: [],
    purchasePayments: [],
    purchaseAllocations: [],
    purchaseCreditAllocations: [],
    purchaseEvents: [],
    purchaseSequences: {},
  };
  seedDemoBank(seeded);
  seedDemoPurchases(seeded);
  return seeded;
}

function persist(): void {
  if (volatile || !state) return;
  const storage = memoryStorage();
  if (!storage) {
    volatile = true;
    return;
  }
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    volatile = true; // quota exceeded: keep working in memory
  }
}

export function loadState(): DemoState {
  if (state) return state;
  const storage = memoryStorage();
  if (storage) {
    const raw = storage.getItem(STORAGE_KEY);
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as DemoState;
        if (parsed && parsed.schema === 9) {
          state = parsed;
          return state;
        }
      } catch {
        /* corrupted payload: reseed below */
      }
    }
  }
  state = seedState();
  persist();
  return state;
}

export function resetDemo(): void {
  state = seedState();
  volatile = false;
  persist();
}

export const isDemoVolatile = () => volatile;

/* ---------------------------------------------------------------- engine */

function audit(
  companyId: string | null,
  action: string,
  entityType: string,
  entityId: string | null,
  details: Record<string, unknown> = {},
): void {
  const s = loadState();
  const user = currentUser();
  s.auditSeq += 1;
  s.audit.push({
    id: s.auditSeq,
    company_id: companyId,
    user_id: user?.id ?? null,
    user_email: user?.email ?? null,
    action,
    entity_type: entityType,
    entity_id: entityId,
    details,
    created_at: now(),
  });
}

export function currentUser(): DemoUser | null {
  const s = loadState();
  if (!s.session) return null;
  return s.users.find((u) => u.id === s.session) ?? null;
}

function publicUser(user: DemoUser) {
  return { id: user.id, email: user.email, fullName: user.full_name, locale: user.locale };
}

function requireUser(): DemoUser {
  const user = currentUser();
  if (!user) throw new ApiError(401, 'UNAUTHORIZED', 'Authentification requise');
  return user;
}

function requireCompany(companyId: string): {
  company: DemoCompany;
  role: DemoMember['role'];
  user: DemoUser;
} {
  const s = loadState();
  const user = requireUser();
  const company = s.companies.find((c) => c.id === companyId);
  const member = s.members.find((m) => m.company_id === companyId && m.user_id === user.id);
  if (!company || !member) throw new ApiError(404, 'COMPANY_NOT_FOUND', 'Société introuvable');
  return { company, role: member.role, user };
}

function accountsOf(companyId: string): DemoAccount[] {
  return loadState().accounts.filter((a) => a.company_id === companyId);
}

function journalTotals(entryId: string) {
  const s = loadState();
  const lines = s.lines.filter((l) => l.entry_id === entryId);
  const debit = lines.reduce((acc, l) => acc + amount(l.debit), 0n);
  const credit = lines.reduce((acc, l) => acc + amount(l.credit), 0n);
  return { debit, credit, lines };
}

function nextEntryNo(companyId: string, journalCode: string, entryDate: string): string {
  const s = loadState();
  const year = entryDate.slice(0, 4);
  const key = `${journalCode}-${year}`;
  const next = (s.sequences[key] ?? 0) + 1;
  s.sequences[key] = next;
  const company = s.companies.find((c) => c.id === companyId);
  const prefix = company ? `${journalCode}-${year}-` : '';
  return `${prefix}${String(next).padStart(4, '0')}`;
}

function assertReferenceFree(companyId: string, reference: string | null | undefined, excludeId?: string) {
  const value = reference?.trim();
  if (!value) return;
  const s = loadState();
  const clash = s.entries.some(
    (e) =>
      e.company_id === companyId &&
      e.source === 'manual' &&
      e.id !== excludeId &&
      (e.reference ?? '').trim().toLowerCase() === value.toLowerCase(),
  );
  if (clash) throw new ApiError(409, 'REFERENCE_TAKEN', `Référence « ${value} » déjà utilisée`);
}

const SUPPORTED_CURRENCIES = ['MUR', 'EUR', 'USD', 'GBP'];

interface PreparedLine {
  accountId: string;
  description: string | null;
  debit: string;
  credit: string;
  txnAmount: string;
  txnCurrency: string;
  fxRate: string;
}

function prepareLines(
  company: DemoCompany,
  payload: { currency?: string; exchangeRate?: string | number | null; lines: any[] },
): { currency: string; fxRate: string; lines: PreparedLine[]; balanced: boolean } {
  const currency = (payload.currency ?? company.functional_currency).toUpperCase();
  if (!SUPPORTED_CURRENCIES.includes(currency)) {
    throw new ApiError(400, 'INVALID_CURRENCY', `Devise non supportée : ${currency}`);
  }
  const foreign = currency !== company.functional_currency;
  let rateScaled = RATE_FACTOR; // 1.00000000
  if (foreign) {
    if (payload.exchangeRate === undefined || payload.exchangeRate === null || payload.exchangeRate === '') {
      throw new ApiError(400, 'EXCHANGE_RATE_REQUIRED', `Un taux est requis pour ${currency}`);
    }
    rateScaled = parseRate(payload.exchangeRate);
  }

  const accounts = accountsOf(company.id);
  const byId = new Map(accounts.map((a) => [a.id, a]));

  const prepared: PreparedLine[] = [];
  let totalDebit = 0n;
  let totalCredit = 0n;

  payload.lines.forEach((line, index) => {
    const account = byId.get(String(line.accountId));
    if (!account) {
      throw new ApiError(400, 'VALIDATION_ERROR', `Compte inconnu (ligne ${index + 1})`);
    }
    if (!account.is_active) {
      throw new ApiError(400, 'VALIDATION_ERROR', `Compte inactif : ${account.code}`);
    }
    const hasDebit = line.debit !== undefined && line.debit !== null && String(line.debit).trim() !== '';
    const hasCredit =
      line.credit !== undefined && line.credit !== null && String(line.credit).trim() !== '';
    if (hasDebit === hasCredit) {
      throw new ApiError(
        400,
        'VALIDATION_ERROR',
        `Ligne ${index + 1} : indiquez un débit ou un crédit, pas les deux`,
      );
    }
    const raw = hasDebit ? line.debit : line.credit;
    if (decimalPlaces(raw) > 4) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Montants limités à 4 décimales');
    }
    const scaled = amount(raw);
    if (scaled <= 0n) {
      throw new ApiError(400, 'VALIDATION_ERROR', `Ligne ${index + 1} : montant invalide`);
    }
    const functional = multiply(scaled, rateScaled);
    if (functional === 0n) {
      throw new ApiError(400, 'AMOUNT_TOO_SMALL', 'Montant nul après conversion');
    }
    const debit = hasDebit ? fmt(functional) : '0.0000';
    const credit = hasDebit ? '0.0000' : fmt(functional);
    if (hasDebit) totalDebit += functional;
    else totalCredit += functional;
    prepared.push({
      accountId: account.id,
      description: line.description ?? null,
      debit,
      credit,
      txnAmount: fmt(scaled),
      txnCurrency: currency,
      fxRate: rateToString(rateScaled),
    });
  });

  return {
    currency,
    fxRate: rateToString(rateScaled),
    lines: prepared,
    balanced: totalDebit === totalCredit && totalDebit > 0n,
  };
}

function decimalPlaces(value: unknown): number {
  const text = String(value ?? '').trim().replace(',', '.');
  const decimals = text.split('.')[1];
  return decimals ? decimals.length : 0;
}

function assertOpenPeriod(companyId: string, date: string): void {
  const s = loadState();
  const period = s.periods.find(
    (p) => p.company_id === companyId && p.status === 'open' && p.start_date <= date && p.end_date >= date,
  );
  if (!period) {
    throw new ApiError(409, 'PERIOD_CLOSED', `Aucune période ouverte ne couvre le ${date}`);
  }
}

function entryTotals(entry: DemoEntry): string {
  const { debit } = journalTotals(entry.id);
  return fmt(debit);
}

function listEntries(companyId: string, query: URLSearchParams) {
  const s = loadState();
  const status = query.get('status') ?? '';
  const journalId = query.get('journalId') ?? '';
  const search = (query.get('search') ?? '').toLowerCase();
  const from = query.get('from') ?? '';
  const to = query.get('to') ?? '';
  const limit = Number(query.get('limit') ?? 50);
  const offset = Number(query.get('offset') ?? 0);

  const journals = new Map(s.journals.map((j) => [j.id, j]));
  const filtered = s.entries
    .filter((e) => e.company_id === companyId)
    .filter((e) => (status ? e.status === status : true))
    .filter((e) => (journalId ? e.journal_id === journalId : true))
    .filter((e) => (from ? e.entry_date >= from : true))
    .filter((e) => (to ? e.entry_date <= to : true))
    .filter((e) =>
      search
        ? `${e.entry_no} ${e.description} ${e.reference ?? ''}`.toLowerCase().includes(search)
        : true,
    )
    .sort((a, b) => (a.entry_date === b.entry_date ? b.entry_no.localeCompare(a.entry_no) : b.entry_date.localeCompare(a.entry_date)));

  const page = filtered.slice(offset, offset + limit).map((e) => {
    const journal = journals.get(e.journal_id);
    return {
      id: e.id,
      entry_no: e.entry_no,
      entry_date: e.entry_date,
      reference: e.reference,
      description: e.description,
      status: e.status,
      currency: e.currency,
      source: e.source,
      journal_code: journal?.code ?? '',
      journal_name: journal?.name ?? '',
      total_debit: entryTotals(e),
      reversal_entry_id:
        s.entries.find((r) => r.reversal_of_entry_id === e.id && r.company_id === companyId)?.id ?? null,
    };
  });

  return { entries: page, total: filtered.length };
}

function entryDetail(companyId: string, entryId: string) {
  const s = loadState();
  const entry = s.entries.find((e) => e.id === entryId && e.company_id === companyId);
  if (!entry) throw new ApiError(404, 'ENTRY_NOT_FOUND', 'Écriture introuvable');
  const journal = s.journals.find((j) => j.id === entry.journal_id);
  const accounts = new Map(accountsOf(companyId).map((a) => [a.id, a]));
  const reversed = entry.reversal_of_entry_id
    ? s.entries.find((e) => e.id === entry.reversal_of_entry_id)
    : null;
  const reversal = s.entries.find(
    (e) => e.reversal_of_entry_id === entry.id && e.company_id === companyId,
  );
  const lines = s.lines
    .filter((l) => l.entry_id === entry.id)
    .sort((a, b) => a.line_no - b.line_no)
    .map((l) => {
      const account = accounts.get(l.account_id);
      return {
        id: l.id,
        account_id: l.account_id,
        account_code: account?.code ?? '',
        account_name: account?.name ?? '',
        description: l.description,
        debit: l.debit,
        credit: l.credit,
        txn_amount: l.txn_amount,
        txn_currency: l.txn_currency,
        fx_rate: l.fx_rate,
      };
    });

  return {
    entry: {
      id: entry.id,
      entry_no: entry.entry_no,
      entry_date: entry.entry_date,
      reference: entry.reference,
      description: entry.description,
      status: entry.status,
      currency: entry.currency,
      exchange_rate: entry.exchange_rate,
      source: entry.source,
      posted_at: entry.posted_at,
      journal_code: journal?.code ?? '',
      journal_name: journal?.name ?? '',
      journal_type: journal?.type ?? '',
      reversal_of_entry_id: entry.reversal_of_entry_id,
      reversed_entry_no: reversed?.entry_no ?? null,
      reversal_entry_id: reversal?.id ?? null,
      reversal_entry_no: reversal?.entry_no ?? null,
      total_debit: entryTotals(entry),
    },
    lines,
    attachments: [] as { id: string; original_name: string; mime_type: string; size_bytes: number }[],
  };
}

/* --------------------------------------------------------------- reports */

function postedLines(companyId: string, from: string, to: string) {
  const s = loadState();
  const accountById = new Map(accountsOf(companyId).map((a) => [a.id, a]));
  const entries = new Map(
    s.entries.filter((e) => e.company_id === companyId && e.status === 'posted').map((e) => [e.id, e]),
  );
  return s.lines
    .filter((l) => l.company_id === companyId)
    .map((l) => ({ line: l, entry: entries.get(l.entry_id), account: accountById.get(l.account_id) }))
    .filter((x) => x.entry && x.account && x.entry.entry_date <= to)
    .map((x) => ({
      ...x,
      inRange: x.entry!.entry_date >= from,
      before: x.entry!.entry_date < from,
    }));
}

function computeTrialBalance(companyId: string, currency: string, from: string, to: string) {
  const rows = new Map<
    string,
    {
      account: DemoAccount;
      openingDebit: bigint;
      openingCredit: bigint;
      movementDebit: bigint;
      movementCredit: bigint;
    }
  >();

  for (const item of postedLines(companyId, from, to)) {
    const key = item.account!.id;
    const row =
      rows.get(key) ??
      {
        account: item.account!,
        openingDebit: 0n,
        openingCredit: 0n,
        movementDebit: 0n,
        movementCredit: 0n,
      };
    const debit = amount(item.line.debit);
    const credit = amount(item.line.credit);
    if (item.before) {
      row.openingDebit += debit;
      row.openingCredit += credit;
    } else {
      row.movementDebit += debit;
      row.movementCredit += credit;
    }
    rows.set(key, row);
  }

  const out: any[] = [];
  const totals = {
    openingDebit: 0n,
    openingCredit: 0n,
    movementDebit: 0n,
    movementCredit: 0n,
    closingDebit: 0n,
    closingCredit: 0n,
  };

  for (const row of [...rows.values()].sort((a, b) => a.account.code.localeCompare(b.account.code))) {
    const openNet = row.openingDebit - row.openingCredit;
    const closingNet = openNet + row.movementDebit - row.movementCredit;
    const openingDebit = openNet > 0n ? openNet : 0n;
    const openingCredit = openNet < 0n ? -openNet : 0n;
    const closingDebit = closingNet > 0n ? closingNet : 0n;
    const closingCredit = closingNet < 0n ? -closingNet : 0n;
    if (openNet === 0n && row.movementDebit === 0n && row.movementCredit === 0n && closingNet === 0n) {
      continue;
    }
    out.push({
      accountId: row.account.id,
      code: row.account.code,
      name: row.account.name,
      type: row.account.type,
      openingDebit: fmt(openingDebit),
      openingCredit: fmt(openingCredit),
      movementDebit: fmt(row.movementDebit),
      movementCredit: fmt(row.movementCredit),
      closingDebit: fmt(closingDebit),
      closingCredit: fmt(closingCredit),
    });
    totals.openingDebit += openingDebit;
    totals.openingCredit += openingCredit;
    totals.movementDebit += row.movementDebit;
    totals.movementCredit += row.movementCredit;
    totals.closingDebit += closingDebit;
    totals.closingCredit += closingCredit;
  }

  return {
    from,
    to,
    currency,
    balanced: totals.movementDebit === totals.movementCredit && totals.closingDebit === totals.closingCredit,
    rows: out,
    totals: {
      openingDebit: fmt(totals.openingDebit),
      openingCredit: fmt(totals.openingCredit),
      movementDebit: fmt(totals.movementDebit),
      movementCredit: fmt(totals.movementCredit),
      closingDebit: fmt(totals.closingDebit),
      closingCredit: fmt(totals.closingCredit),
    },
  };
}

function computeLedger(companyId: string, currency: string, from: string, to: string, query: URLSearchParams) {
  const search = (query.get('search') ?? '').toLowerCase();
  const accountId = query.get('accountId') ?? '';
  const includeInactive = query.get('includeInactive') === 'true';
  const accounts = accountsOf(companyId)
    .filter((a) => (accountId ? a.id === accountId : true))
    .sort((a, b) => a.code.localeCompare(b.code));

  const items = postedLines(companyId, from, to);
  const journals = new Map(loadState().journals.map((j) => [j.id, j]));

  const result = accounts.map((account) => {
    const own = items.filter((i) => i.account!.id === account.id);
    const opening = own
      .filter((i) => i.before)
      .reduce((acc, i) => acc + amount(i.line.debit) - amount(i.line.credit), 0n);
    let running = opening;
    let totalDebit = 0n;
    let totalCredit = 0n;
    const lines = own
      .filter((i) => i.inRange)
      .sort((a, b) => {
        const byDate = a.entry!.entry_date.localeCompare(b.entry!.entry_date);
        return byDate !== 0 ? byDate : a.entry!.entry_no.localeCompare(b.entry!.entry_no);
      })
      .map((i) => {
        const debit = amount(i.line.debit);
        const credit = amount(i.line.credit);
        totalDebit += debit;
        totalCredit += credit;
        running += debit - credit;
        return {
          entryId: i.entry!.id,
          entryNo: i.entry!.entry_no,
          date: i.entry!.entry_date,
          journal: journals.get(i.entry!.journal_id)?.code ?? '',
          reference: i.entry!.reference,
          description: i.line.description ?? i.entry!.description,
          debit: fmt(debit),
          credit: fmt(credit),
          balance: fmt(running),
        };
      });
    return {
      accountId: account.id,
      code: account.code,
      name: account.name,
      opening: fmt(opening),
      totalDebit: fmt(totalDebit),
      totalCredit: fmt(totalCredit),
      closing: fmt(opening + totalDebit - totalCredit),
      lines,
      isActive: account.is_active,
    };
  });

  const hasActivity = (a: (typeof result)[number]) =>
    a.lines.length > 0 || amount(a.opening) !== 0n || amount(a.closing) !== 0n;
  const visible = includeInactive ? result : result.filter(hasActivity);
  const filtered = search
    ? visible.filter((a) => hasActivity(a) && `${a.code} ${a.name}`.toLowerCase().includes(search))
    : visible;

  const totals = filtered.reduce(
    (acc, a) => ({
      debit: acc.debit + amount(a.totalDebit),
      credit: acc.credit + amount(a.totalCredit),
    }),
    { debit: 0n, credit: 0n },
  );

  return {
    from,
    to,
    currency,
    accounts: filtered.map(({ isActive: _isActive, ...rest }) => rest),
    totals: { debit: fmt(totals.debit), credit: fmt(totals.credit) },
  };
}

function computeStatements(companyId: string, currency: string, from: string, to: string) {
  const balances = computeTrialBalance(companyId, currency, '1900-01-01', to);
  const period = computeTrialBalance(companyId, currency, from, to);

  const periodByAccount = new Map(period.rows.map((r) => [r.code, r]));
  const accounts = accountsOf(companyId);
  const byCode = new Map(accounts.map((a) => [a.code, a]));

  const pl = { revenue: [] as any[], expenses: [] as any[] };
  const bs = { assets: [] as any[], liabilities: [] as any[], equity: [] as any[] };
  let cumulativeRevenue = 0n;
  let cumulativeExpenses = 0n;

  for (const row of balances.rows) {
    const account = byCode.get(row.code);
    if (!account) continue;
    const cumulativeNet =
      amount(row.closingDebit) - amount(row.closingCredit);
    const p = periodByAccount.get(row.code);
    const periodNet = p ? amount(p.movementDebit) - amount(p.movementCredit) : 0n;

    if (account.type === 'revenue') {
      cumulativeRevenue += -cumulativeNet;
      if (periodNet !== 0n) {
        pl.revenue.push({ accountId: account.id, code: account.code, name: account.name, amount: fmt(-periodNet) });
      }
    } else if (account.type === 'expense') {
      cumulativeExpenses += cumulativeNet;
      if (periodNet !== 0n) {
        pl.expenses.push({ accountId: account.id, code: account.code, name: account.name, amount: fmt(periodNet) });
      }
    } else {
      const value = account.type === 'asset' ? cumulativeNet : -cumulativeNet;
      if (value !== 0n) {
        const bucket = account.type === 'asset' ? 'assets' : account.type === 'liability' ? 'liabilities' : 'equity';
        bs[bucket].push({ accountId: account.id, code: account.code, name: account.name, amount: fmt(value) });
      }
    }
  }

  const group = (lines: any[]) => ({
    key: 'total',
    lines,
    total: fmt(lines.reduce((acc, l) => acc + amount(l.amount), 0n)),
  });

  const revenue = group(pl.revenue);
  const expenses = group(pl.expenses);
  const profit = amount(revenue.total) - amount(expenses.total);
  const cumulativeResult = cumulativeRevenue - cumulativeExpenses;
  const totalAssets = amount(group(bs.assets).total);
  const totalLiabilitiesAndEquity =
    amount(group(bs.liabilities).total) + amount(group(bs.equity).total) + cumulativeResult;

  return {
    from,
    to,
    currency,
    profitAndLoss: {
      revenue,
      expenses,
      profit: fmt(profit),
      totalRevenue: revenue.total,
      totalExpenses: expenses.total,
    },
    financialPosition: {
      assets: group(bs.assets),
      liabilities: group(bs.liabilities),
      equity: group(bs.equity),
      unappropriatedResult: fmt(cumulativeResult),
      totalAssets: fmt(totalAssets),
      totalLiabilitiesAndEquity: fmt(totalLiabilitiesAndEquity),
      balanced: totalAssets === totalLiabilitiesAndEquity,
    },
  };
}

function dashboard(companyId: string) {
  const s = loadState();
  const { company } = requireCompany(companyId);
  const accounts = accountsOf(companyId);
  const journals = s.journals.filter((j) => j.company_id === companyId);
  const entries = s.entries.filter((e) => e.company_id === companyId);
  const statements = computeStatements(
    companyId,
    company.presentation_currency,
    company.financial_year_start,
    company.financial_year_end,
  );
  const recent = [...entries]
    .sort((a, b) => (a.entry_date === b.entry_date ? b.entry_no.localeCompare(a.entry_no) : b.entry_date.localeCompare(a.entry_date)))
    .slice(0, 6)
    .map((e) => ({
      id: e.id,
      entry_no: e.entry_no,
      entry_date: e.entry_date,
      description: e.description,
      status: e.status,
      journal_code: s.journals.find((j) => j.id === e.journal_id)?.code ?? '',
      total_debit: entryTotals(e),
    }));

  return {
    kpis: {
      accounts: accounts.length,
      journals: journals.length,
      draftEntries: entries.filter((e) => e.status === 'draft').length,
      postedEntries: entries.filter((e) => e.status === 'posted').length,
      revenue: statements.profitAndLoss.revenue.total,
      expenses: statements.profitAndLoss.expenses.total,
      profit: statements.profitAndLoss.profit,
      balancedSheet: statements.financialPosition.balanced,
      currency: company.presentation_currency,
      totalAssets: statements.financialPosition.totalAssets,
    },
    recentEntries: recent,
    range: { from: company.financial_year_start, to: company.financial_year_end },
  };
}

/* ------------------------------------------------------------------- CSV */

const CSV_LABELS = {
  fr: {
    account: 'Compte',
    date: 'Date',
    journal: 'Journal',
    entryNo: "N° d'écriture",
    reference: 'Référence',
    description: 'Libellé',
    debit: 'Débit',
    credit: 'Crédit',
    code: 'Code',
    balance: 'Solde',
    total: 'TOTAL',
    note: 'EXPORT DE DÉMONSTRATION — calculé dans le navigateur, non réglementaire',
  },
  en: {
    account: 'Account',
    date: 'Date',
    journal: 'Journal',
    entryNo: 'Entry no',
    reference: 'Reference',
    description: 'Description',
    debit: 'Debit',
    credit: 'Credit',
    code: 'Code',
    balance: 'Balance',
    total: 'TOTAL',
    note: 'DEMONSTRATION EXPORT — computed in the browser, not a regulatory document',
  },
};

function csv(rows: (string | number | null)[][]): string {
  const escape = (value: string | number | null): string => {
    if (value === null) return '';
    let text = String(value);
    const numeric = /^-?\d+(\.\d+)?$/.test(text);
    if (!numeric && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
    return /[";,\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return `\uFEFF${rows.map((r) => r.map(escape).join(';')).join('\r\n')}\r\n`;
}

function exportCsv(path: string, query: URLSearchParams, locale: 'fr' | 'en'): string {
  const s = loadState();
  const user = currentUser();
  const companyMatch = /^\/companies\/([^/]+)\/reports\/([a-z-]+)/.exec(path.split('?')[0]!);
  if (!companyMatch) throw new ApiError(404, 'NOT_FOUND', 'Rapport inconnu');
  const companyId = companyMatch[1]!;
  const report = companyMatch[2] as 'ledger' | 'trial-balance' | 'statements';
  const { company } = requireCompany(companyId);
  const from = query.get('from') || company.financial_year_start;
  const to = query.get('to') || company.financial_year_end;
  const labels = CSV_LABELS[user?.locale ?? locale];

  if (report === 'ledger') {
    const ledger = computeLedger(companyId, company.functional_currency, from, to, query);
    const rows: (string | number | null)[][] = [
      [labels.account, labels.date, labels.journal, labels.entryNo, labels.reference, labels.description, labels.debit, labels.credit],
    ];
    for (const account of ledger.accounts) {
      for (const line of account.lines) {
        rows.push([
          `${account.code} ${account.name}`,
          line.date,
          line.journal,
          line.entryNo,
          line.reference ?? '',
          line.description,
          line.debit,
          line.credit,
        ]);
      }
    }
    rows.push([]);
    rows.push([labels.note]);
    return csv(rows);
  }

  if (report === 'trial-balance') {
    const tb = computeTrialBalance(companyId, company.functional_currency, from, to);
    const rows: (string | number | null)[][] = [
      [labels.code, labels.account, `${labels.balance} D`, `${labels.balance} C`],
    ];
    for (const r of tb.rows) {
      rows.push([r.code, r.name, r.closingDebit, r.closingCredit]);
    }
    rows.push([]);
    rows.push([labels.note]);
    return csv(rows);
  }

  const statements = computeStatements(companyId, company.presentation_currency, from, to);
  const rows: (string | number | null)[][] = [[labels.account, labels.balance]];
  for (const line of statements.financialPosition.assets.lines) rows.push([line.name, line.amount]);
  rows.push([labels.total, statements.financialPosition.totalAssets]);
  for (const line of statements.financialPosition.liabilities.lines) rows.push([line.name, line.amount]);
  for (const line of statements.financialPosition.equity.lines) rows.push([line.name, line.amount]);
  rows.push([labels.total, statements.financialPosition.totalLiabilitiesAndEquity]);
  for (const line of statements.profitAndLoss.revenue.lines) rows.push([line.name, line.amount]);
  for (const line of statements.profitAndLoss.expenses.lines) rows.push([line.name, line.amount]);
  rows.push([labels.total, statements.profitAndLoss.profit]);
  rows.push([]);
  rows.push([labels.note]);
  return csv(rows);
}

/* --------------------------------------------------------------- dispatch */

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';


/* ------------------------------------------------------- module security */

type ModuleKey = 'cabinet' | 'accounting' | 'billing' | 'payroll';
type Access = 'none' | 'read' | 'write' | 'admin';

const ACCESS_WEIGHT: Record<Access, number> = { none: 0, read: 1, write: 2, admin: 3 };

/**
 * Same defaults as the API (apps/api/src/lib/permissions.ts). Payroll and
 * accounting stay disjoint on purpose: the browser demo must not suggest that
 * an accounting collaborator can read payroll data.
 */
const ROLE_MODULES: Record<string, Record<ModuleKey, Access>> = {
  owner: { cabinet: 'admin', accounting: 'admin', billing: 'admin', payroll: 'admin' },
  admin: { cabinet: 'admin', accounting: 'admin', billing: 'admin', payroll: 'admin' },
  cabinet_admin: { cabinet: 'admin', accounting: 'admin', billing: 'admin', payroll: 'admin' },
  manager: { cabinet: 'write', accounting: 'write', billing: 'write', payroll: 'none' },
  accountant: { cabinet: 'read', accounting: 'write', billing: 'read', payroll: 'none' },
  billing_clerk: { cabinet: 'read', accounting: 'read', billing: 'write', payroll: 'none' },
  payroll_manager: { cabinet: 'read', accounting: 'read', billing: 'read', payroll: 'write' },
  viewer: { cabinet: 'read', accounting: 'read', billing: 'read', payroll: 'none' },
};

function effectiveModulesFor(companyId: string, userId: string, role: string): Record<ModuleKey, Access> {
  const s = loadState();
  const out = { ...(ROLE_MODULES[role] ?? ROLE_MODULES.viewer!) };
  for (const grant of s.moduleAccess ?? []) {
    if (grant.company_id !== companyId || grant.user_id !== userId) continue;
    if (ACCESS_WEIGHT[grant.access] > ACCESS_WEIGHT[out[grant.module]]) out[grant.module] = grant.access;
  }
  return out;
}

function requireModule(
  companyId: string,
  module: ModuleKey,
  min: Access = 'read',
  allowArchived = false,
) {
  const ctx = requireCompany(companyId);
  const level = effectiveModulesFor(companyId, ctx.user.id, ctx.role)[module];
  if (ACCESS_WEIGHT[level] < ACCESS_WEIGHT[min]) {
    throw new ApiError(403, 'MODULE_FORBIDDEN', "Ce module n'est pas accessible avec vos droits");
  }
  if (min !== 'read' && ctx.company.status === 'archived' && !allowArchived) {
    throw new ApiError(409, 'COMPANY_ARCHIVED', 'Ce dossier est archivé : lecture seule');
  }
  return { company: ctx.company, role: ctx.role, access: level, user: ctx.user };
}

function taskView(s: DemoState, task: DemoTask) {
  const company = s.companies.find((c) => c.id === task.company_id);
  const assignee = s.users.find((u) => u.id === task.assigned_to);
  return {
    ...task,
    company_name: company?.name ?? null,
    assignee_name: assignee?.full_name ?? null,
  };
}

const OPEN_TASK_STATUSES = ['todo', 'in_progress', 'blocked'];

/* -------------------------------------------------- cabinet (demo) routes */

function cabinetDashboard(s: DemoState, user: DemoUser) {
  const companies = s.members
    .filter((m) => m.user_id === user.id)
    .map((m) => s.companies.find((c) => c.id === m.company_id))
    .filter((c): c is DemoCompany => !!c)
    .filter((c) => effectiveModulesFor(c.id, user.id, s.members.find((m) => m.company_id === c.id && m.user_id === user.id)!.role).cabinet !== 'none');
  const ids = new Set(companies.map((c) => c.id));
  const tasks = s.tasks.filter((t) => ids.has(t.company_id));
  const open = tasks.filter((t) => OPEN_TASK_STATUSES.includes(t.status));
  const today = todayIso();
  const soon = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
  const byCategory = new Map<string, number>();
  for (const task of open) byCategory.set(task.category, (byCategory.get(task.category) ?? 0) + 1);
  const companiesWithOpenTasks = new Set(open.map((t) => t.company_id));
  const collaborators = new Set(s.members.filter((m) => ids.has(m.company_id)).map((m) => m.user_id));

  return {
    metrics: {
      clients: companies.length,
      active: companies.filter((c) => c.status === 'active').length,
      archived: companies.filter((c) => c.status === 'archived').length,
      toReview: companiesWithOpenTasks.size,
      openTasks: open.length,
      overdueTasks: open.filter((t) => t.due_date && t.due_date < today).length,
      dueSoon: open.filter((t) => t.due_date && t.due_date >= today && t.due_date <= soon).length,
      collaborators: collaborators.size,
    },
    tasksByCategory: [...byCategory.entries()].map(([category, count]) => ({ category, count })),
    upcoming: open
      .filter((t) => !!t.due_date)
      .sort((a, b) => String(a.due_date).localeCompare(String(b.due_date)))
      .slice(0, 10)
      .map((t) => taskView(s, t)),
    recentActivity: s.audit
      .filter((a) => a.company_id && ids.has(a.company_id))
      .slice(-12)
      .reverse()
      .map((a) => ({
        id: a.id,
        action: a.action,
        entity_type: a.entity_type,
        created_at: a.created_at,
        company_name: s.companies.find((c) => c.id === a.company_id)?.name ?? null,
        user_name: a.user_email,
      })),
    dossiers: companies.map((c) => ({
      id: c.id,
      name: c.name,
      status: c.status,
      client_code: c.client_code,
      financial_year_end: c.financial_year_end,
      open_tasks: open.filter((t) => t.company_id === c.id).length,
    })),
  };
}


/* --------------------------------------------------------- AI (demo only) */

/**
 * Simulated AI engine for the GitHub Pages demonstration.
 *
 * Rules enforced here, mirroring the server:
 *  - no network call of any kind, no cost, no real API key is ever accepted;
 *  - the proposal can only reference an account of the selected company;
 *  - a decision never creates a journal entry;
 *  - the module must be enabled and the user must have the required access.
 */
function requireCabinetAdminDemo(s: DemoState): DemoUser {
  const user = requireUser();
  const admin = s.members.some(
    (m) => m.user_id === user.id && ['owner', 'admin', 'cabinet_admin'].includes(m.role),
  );
  if (admin) return user;
  if (s.members.some((m) => m.user_id === user.id)) {
    throw new ApiError(403, 'AI_FORBIDDEN', "Droits d'administration du cabinet requis");
  }
  throw new ApiError(404, 'CABINET_NOT_FOUND', 'Cabinet introuvable');
}

function aiProviderViews(s: DemoState) {
  return AI_PROVIDERS.map((p) => ({
    key: p.key,
    label: p.label,
    adapter: p.key === 'simulated' ? 'simulated' : p.key === 'gemini' ? 'gemini' : 'openai',
    requiresKey: p.requiresKey,
    docsUrl: '',
    notes: p.notes.fr,
    baseUrlConfigurable: p.baseUrlConfigurable ?? false,
    baseUrl: null,
    models: p.models,
    capabilities: p.capabilities,
    configured: p.key === 'simulated' ? true : Boolean(s.ai.credentials[p.key]?.configured),
    available: p.key !== 'simulated',
    priceVerified: false,
  }));
}

function aiUsageSummary(s: DemoState) {
  const calls = s.aiSuggestions.filter((x) => x.source === 'provider');
  const byProvider = new Map<string, number>();
  const byModule = new Map<string, number>();
  for (const call of calls) {
    const key = `${call.provider ?? 'simulated'}|${call.model ?? ''}`;
    byProvider.set(key, (byProvider.get(key) ?? 0) + 1);
    byModule.set('accounting', (byModule.get('accounting') ?? 0) + 1);
  }
  const requests = calls.length;
  const limit = s.ai.monthlyRequestLimit;
  const state =
    limit !== null && requests >= limit ? 'exceeded' : s.ai.monthlyBudgetUsd ? 'unknown' : 'ok';
  return {
    month: new Date().toISOString().slice(0, 7),
    requests,
    inputTokens: 0,
    outputTokens: 0,
    estimatedCostUsd: null,
    costKnown: false,
    byProvider: [...byProvider.entries()].map(([key, count]) => {
      const [provider = 'simulated', model = ''] = key.split('|');
      return { provider, model, requests: count, estimatedCostUsd: null };
    }),
    byModule: [...byModule.entries()].map(([module, count]) => ({ module, requests: count })),
    budget: {
      limitUsd: s.ai.monthlyBudgetUsd,
      requestLimit: limit,
      usedUsd: null,
      percent: null,
      state,
    },
  };
}

function aiSettingsView(s: DemoState) {
  return {
    cabinetId: 'demo-cabinet',
    enabled: s.ai.enabled,
    routingMode: s.ai.routingMode,
    primary: { provider: s.ai.primaryProvider, model: s.ai.primaryModel },
    fallback: { provider: s.ai.fallbackProvider, model: s.ai.fallbackModel },
    monthlyBudgetUsd: s.ai.monthlyBudgetUsd,
    monthlyRequestLimit: s.ai.monthlyRequestLimit,
    alertThreshold: s.ai.alertThreshold,
    features: s.ai.features,
    sharedPoolEnabled: false,
    // The browser demonstration has no server-side encryption: it states so
    // and accepts no key at all.
    encryptionReady: false,
    simulatedAvailable: true,
    providers: aiProviderViews(s),
    usage: aiUsageSummary(s),
    catalogue: {
      version: 1,
      updatedAt: '2026-10-31',
      notice:
        'Simulation IA — aucune API externe utilisée. Aucun tarif vérifié n’est fourni : aucun coût n’est affiché.',
      priceRows: 0,
      verifiedPriceModels: [],
    },
  };
}

function aiRequireEnabled(s: DemoState, module: ModuleKey) {
  if (!s.ai.enabled) throw new ApiError(403, 'AI_DISABLED', 'IA désactivée pour ce cabinet');
  if (s.ai.features[module] !== true) {
    throw new ApiError(403, 'AI_FEATURE_DISABLED', "Fonctionnalités IA désactivées pour ce module");
  }
}

function aiSuggestInDemo(s: DemoState, companyId: string, payload: Record<string, any>) {
  aiRequireEnabled(s, 'accounting');
  const description = String(payload.description ?? '').trim();
  if (description.length < 3) throw new ApiError(400, 'VALIDATION_ERROR', 'Description trop courte');

  const limit = s.ai.monthlyRequestLimit;
  const used = s.aiSuggestions.filter((x) => x.source === 'provider').length;
  if (limit !== null && used >= limit) {
    throw new ApiError(402, 'AI_BUDGET_EXCEEDED', 'Plafond de requêtes IA atteint (démonstration)');
  }

  const accounts = accountsOf(companyId).filter((a) => a.is_active);
  if (accounts.length === 0) throw new ApiError(409, 'AI_NOT_CONFIGURED', 'Plan comptable vide');

  const normalized = normalise(description);
  const rule = s.aiRules.find((r) => r.company_id === companyId && normalized.includes(normalise(r.keyword)));
  if (rule) {
    const account = accounts.find((a) => a.id === rule.account_id);
    if (account) {
      const suggestion: DemoAiSuggestion = {
        id: uid(),
        company_id: companyId,
        input_text: description,
        amount: payload.amount === undefined || payload.amount === null ? null : String(payload.amount),
        currency: payload.currency ? String(payload.currency).toUpperCase() : null,
        suggested_account_id: account.id,
        suggested_account_code: account.code,
        category: 'rule',
        rationale: `Règle validée par le cabinet : « ${rule.keyword} » → ${account.code} ${account.name}.`,
        confidence: 1,
        status: 'proposed',
        decided_account_id: null,
        decided_by: null,
        decided_at: null,
        source: 'rule',
        provider: 'rule',
        model: null,
        created_by: requireUser().id,
        created_at: now(),
        posted_entry_id: null,
      };
      s.aiSuggestions.unshift(suggestion);
      audit(companyId, 'ai.suggestion.propose', 'ai_suggestion', suggestion.id, { source: 'rule' });
      persist();
      return { suggestion: suggestionView(s, suggestion), entryCreated: false };
    }
  }

  const accountsForSim = accounts.map((a) => ({ code: a.code, name: a.name, type: a.type }));
  const match = chooseAccount(description, accountsForSim);
  const confidence = match ? Math.min(0.9, Math.max(0.2, match.score)) : 0.1;
  const suggestion: DemoAiSuggestion = {
    id: uid(),
    company_id: companyId,
    input_text: description,
    amount: payload.amount === undefined || payload.amount === null ? null : String(payload.amount),
    currency: payload.currency ? String(payload.currency).toUpperCase() : null,
    suggested_account_id: match ? (accounts.find((a) => a.code === match.code)?.id ?? null) : null,
    suggested_account_code: match?.code ?? null,
    category: match?.matched ? 'compte correspondant' : 'à vérifier',
    rationale: match
      ? match.matched
        ? `Le libellé « ${description} » correspond au compte ${match.code} (${match.name}). Proposition à vérifier par un collaborateur.`
        : `Proposition par défaut : compte ${match.code} (${match.name}). Aucune correspondance fiable, vérification requise.`
      : 'Aucun compte du plan comptable ne correspond à cette description.',
    confidence,
    status: 'proposed',
    decided_account_id: null,
    decided_by: null,
    decided_at: null,
    source: 'provider',
    provider: 'simulated',
    model: 'simulated-fictif',
    created_by: requireUser().id,
    created_at: now(),
    posted_entry_id: null,
  };
  s.aiSuggestions.unshift(suggestion);
  audit(companyId, 'ai.suggestion.propose', 'ai_suggestion', suggestion.id, {
    provider: 'simulated',
    accountCode: suggestion.suggested_account_code,
  });
  persist();
  return { suggestion: suggestionView(s, suggestion), entryCreated: false };
}

function suggestionView(s: DemoState, suggestion: DemoAiSuggestion) {
  const account = suggestion.suggested_account_id
    ? s.accounts.find((a) => a.id === suggestion.suggested_account_id) ?? null
    : null;
  const decided = suggestion.decided_account_id
    ? s.accounts.find((a) => a.id === suggestion.decided_account_id) ?? null
    : null;
  return {
    ...suggestion,
    account: account ? { id: account.id, code: account.code, name: account.name } : null,
    decidedAccount: decided ? { id: decided.id, code: decided.code, name: decided.name } : null,
  };
}

function aiDecideInDemo(
  s: DemoState,
  companyId: string,
  suggestionId: string,
  payload: Record<string, any>,
) {
  aiRequireEnabled(s, 'accounting');
  const suggestion = s.aiSuggestions.find((x) => x.id === suggestionId && x.company_id === companyId);
  if (!suggestion) throw new ApiError(404, 'AI_SUGGESTION_NOT_FOUND', 'Suggestion introuvable');
  if (suggestion.status !== 'proposed') {
    throw new ApiError(409, 'AI_SUGGESTION_DECIDED', 'Suggestion déjà traitée');
  }
  const decision = String(payload.decision ?? '');
  if (!['accepted', 'modified', 'rejected'].includes(decision)) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Décision invalide');
  }
  let decidedId: string | null = null;
  if (decision !== 'rejected') {
    const wanted = decision === 'accepted' ? suggestion.suggested_account_id : payload.accountId;
    if (!wanted) {
      throw new ApiError(400, 'AI_ACCOUNT_NOT_IN_CHART', 'Choisissez un compte du plan comptable');
    }
    const account = accountsOf(companyId).find((a) => a.id === wanted && a.is_active);
    if (!account) {
      throw new ApiError(
        400,
        'AI_ACCOUNT_NOT_IN_CHART',
        "Le compte choisi n'appartient pas au plan comptable de cette société",
      );
    }
    decidedId = account.id;
  }
  const user = requireUser();
  suggestion.status = decision as DemoAiSuggestion['status'];
  suggestion.decided_account_id = decidedId;
  suggestion.decided_by = user.id;
  suggestion.decided_at = now();

  let ruleCreated: { keyword: string; accountId: string } | null = null;
  if (payload.createRule && decidedId) {
    const keyword = String(payload.keyword ?? ruleKeyword(suggestion.input_text)).trim();
    if (keyword.length >= 3) {
      const existing = s.aiRules.find(
        (r) => r.company_id === companyId && normalise(r.keyword) === normalise(keyword),
      );
      if (existing) existing.account_id = decidedId;
      else {
        s.aiRules.push({ id: uid(), company_id: companyId, keyword, account_id: decidedId, created_at: now() });
      }
      ruleCreated = { keyword, accountId: decidedId };
    }
  }
  audit(companyId, `ai.suggestion.${decision}`, 'ai_suggestion', suggestion.id, {
    accountId: decidedId,
    ruleCreated: ruleCreated !== null,
  });
  persist();
  return { suggestion: suggestionView(s, suggestion), entryCreated: false, ruleCreated };
}


/* ------------------------------------------------------ facturation (démo)
 *
 * Ces fonctions reproduisent, dans le navigateur, les règles du backend :
 * arithmétique décimale exacte, TVA jamais inventée, numérotation atomique
 * (une seule page, donc séquentielle), verrouillage après émission, contrôle des
 * avoirs et des affectations, et surtout : une proposition d'écriture n'est
 * JAMAIS comptabilisée sans une action humaine distincte.
 */

function divRoundMoney(numerator: bigint, denominator: bigint): bigint {
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  const absRemainder = remainder < 0n ? -remainder : remainder;
  if (absRemainder * 2n >= denominator) return quotient + (numerator < 0n ? -1n : 1n);
  return quotient;
}

const PERCENT_FACTOR = 100n * 10_000n; // 100 x scale 4

function applyPct(base: bigint, pctScaled4: bigint): bigint {
  return divRoundMoney(base * pctScaled4, PERCENT_FACTOR);
}

function mulMoney(a: bigint, b: bigint): bigint {
  return divRoundMoney(a * b, 10_000n);
}

function billingDates(offset: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

function billingSettingsOf(companyId: string): DemoBillingSettings {
  const s = loadState();
  const settings = s.billingSettings.find((x) => x.company_id === companyId);
  if (settings) return settings;
  const fresh: DemoBillingSettings = {
    company_id: companyId,
    quote_prefix: 'DEV',
    invoice_prefix: 'FAC',
    credit_prefix: 'AV',
    numbering_policy: 'yearly',
    default_payment_terms: 30,
    default_currency: s.companies.find((c) => c.id === companyId)?.functional_currency ?? 'MUR',
    vat_enabled: false,
    vat_number: null,
    legal_footer_fr: null,
    legal_footer_en: null,
    bank_details: null,
  };
  s.billingSettings.push(fresh);
  return fresh;
}

function billingCustomerOf(companyId: string, customerId: string): DemoBillingCustomer {
  const customer = loadState().billingCustomers.find(
    (c) => c.id === customerId && c.company_id === companyId,
  );
  if (!customer) throw new ApiError(404, 'CUSTOMER_NOT_FOUND', 'Client introuvable');
  return customer;
}

function billingCustomerView(c: DemoBillingCustomer) {
  return {
    id: c.id,
    name: c.name,
    legalName: c.legal_name,
    brn: c.brn,
    vatNumber: c.vat_number,
    addressLine1: c.address_line1,
    city: c.city,
    postcode: c.postcode,
    country: c.country,
    contactName: c.contact_name,
    contactEmail: c.contact_email,
    contactPhone: c.contact_phone,
    preferredCurrency: c.preferred_currency,
    paymentTermsDays: c.payment_terms_days,
    receivableAccountId: c.receivable_account_id,
    notes: c.notes,
    isActive: c.is_active,
    archivedAt: c.archived_at,
    createdAt: c.created_at,
  };
}

function billingItemView(i: DemoBillingItem) {
  return {
    id: i.id,
    reference: i.reference,
    labelFr: i.label_fr,
    labelEn: i.label_en,
    description: i.description,
    unitPrice: i.unit_price,
    currency: i.currency,
    unit: i.unit,
    category: i.category,
    vatTreatment: i.vat_treatment,
    vatRateId: i.vat_rate_id,
    revenueAccountId: i.revenue_account_id,
    isActive: i.is_active,
  };
}

function billingLineView(l: DemoBillingLine) {
  return {
    id: l.id,
    lineNo: l.line_no,
    itemId: l.item_id,
    description: l.description,
    quantity: l.quantity,
    unitPrice: l.unit_price,
    unit: l.unit,
    discountPct: l.discount_pct,
    vatTreatment: l.vat_treatment,
    vatRate: l.vat_rate,
    vatRateId: l.vat_rate_id,
    netAmount: l.net_amount,
    discountAmount: l.discount_amount,
    taxAmount: l.tax_amount,
    lineTotal: l.line_total,
    revenueAccountId: l.revenue_account_id,
  };
}

function billingOutstanding(doc: DemoBillingDocument): bigint {
  const value = amount(doc.total_amount) - amount(doc.amount_paid) - amount(doc.credited_amount);
  return value > 0n ? value : 0n;
}

function billingDocView(doc: DemoBillingDocument) {
  const s = loadState();
  const lines = s.billingLines
    .filter((l) => l.document_id === doc.id && l.company_id === doc.company_id)
    .sort((a, b) => a.line_no - b.line_no);
  return {
    id: doc.id,
    kind: doc.kind,
    number: doc.doc_no,
    status: doc.status,
    paymentStatus: doc.payment_status,
    customerId: doc.customer_id,
    customerName: doc.customer_name,
    customerBrn: doc.customer_brn,
    issueDate: doc.issue_date,
    dueDate: doc.due_date,
    validUntil: doc.valid_until,
    currency: doc.currency,
    exchangeRate: doc.exchange_rate,
    subtotal: doc.subtotal,
    discountTotal: doc.discount_total,
    taxTotal: doc.tax_total,
    total: doc.total_amount,
    amountPaid: doc.amount_paid,
    creditedAmount: doc.credited_amount,
    outstanding: fmt(billingOutstanding(doc)),
    sourceKind: doc.source_kind,
    sourceDocumentId: doc.source_document_id,
    notes: doc.notes,
    terms: doc.terms,
    issuedAt: doc.issued_at,
    lockedAt: doc.locked_at,
    accountingEntryId: doc.accounting_entry_id,
    sequence: doc.sequence_no === null ? null : { year: doc.sequence_year, no: doc.sequence_no },
    lines: lines.map(billingLineView),
    createdAt: doc.created_at,
    updatedAt: doc.updated_at,
  };
}

function billingPaymentView(p: DemoBillingPayment) {
  const s = loadState();
  const allocations = s.billingAllocations
    .filter((a) => a.payment_id === p.id)
    .map((a) => {
      const invoice = s.billingDocuments.find((d) => d.id === a.invoice_id);
      return {
        id: a.id,
        invoiceId: a.invoice_id,
        amount: a.amount,
        invoiceNumber: invoice?.doc_no ?? null,
        customerName: invoice?.customer_name ?? null,
      };
    });
  return {
    id: p.id,
    number: p.payment_no,
    customerId: p.customer_id,
    paymentDate: p.payment_date,
    valueDate: p.value_date,
    amount: p.amount,
    currency: p.currency,
    exchangeRate: p.exchange_rate,
    method: p.method,
    reference: p.reference,
    unallocatedAmount: p.unallocated_amount,
    status: p.status,
    accountingEntryId: p.accounting_entry_id,
    allocations,
    createdAt: p.created_at,
  };
}

interface ComputedBillingLine {
  itemId: string | null;
  description: string;
  quantity: bigint;
  unitPrice: bigint;
  unit: string;
  discountPct: bigint;
  vatTreatment: DemoBillingLine['vat_treatment'];
  vatRate: bigint | null;
  vatRateId: string | null;
  netAmount: bigint;
  discountAmount: bigint;
  taxAmount: bigint;
  lineTotal: bigint;
  revenueAccountId: string | null;
}

function computeBillingDocument(
  companyId: string,
  issueDate: string,
  rawLines: any[],
  vatEnabled: boolean,
): { lines: ComputedBillingLine[]; subtotal: bigint; discountTotal: bigint; taxTotal: bigint; total: bigint; warnings: string[] } {
  const s = loadState();
  if (!Array.isArray(rawLines) || rawLines.length === 0) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Un document doit comporter au moins une ligne');
  }
  const items = s.billingItems.filter((i) => i.company_id === companyId);
  const rates = s.taxRates.filter((r) => r.company_id === companyId);
  const accounts = accountsOf(companyId);
  const defaultRevenue = accounts.find((a) => a.code === '4010') ?? accounts.find((a) => a.type === 'revenue');
  const warnings = new Set<string>();

  const lines: ComputedBillingLine[] = rawLines.map((raw, index) => {
    const item = raw.itemId ? items.find((i) => i.id === raw.itemId) : undefined;
    if (raw.itemId && !item) {
      throw new ApiError(400, 'VALIDATION_ERROR', `Article inconnu (ligne ${index + 1})`);
    }
    const description = String(raw.description ?? item?.label_fr ?? '').trim();
    if (!description) {
      throw new ApiError(400, 'VALIDATION_ERROR', `Description requise (ligne ${index + 1})`);
    }
    const quantity = amount(raw.quantity);
    if (quantity <= 0n) throw new ApiError(400, 'VALIDATION_ERROR', 'Quantité strictement positive');
    const rawPrice = raw.unitPrice ?? item?.unit_price;
    if (rawPrice === undefined || rawPrice === null || rawPrice === '') {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Prix unitaire requis');
    }
    const unitPrice = amount(rawPrice);
    if (unitPrice < 0n) throw new ApiError(400, 'VALIDATION_ERROR', 'Prix unitaire positif');
    const discountPct = raw.discountPct === undefined || raw.discountPct === null ? 0n : amount(raw.discountPct);
    if (discountPct > 10_000n) throw new ApiError(400, 'VALIDATION_ERROR', 'Remise maximale 100 %');

    const treatment: DemoBillingLine['vat_treatment'] =
      (raw.vatTreatment as DemoBillingLine['vat_treatment']) ?? item?.vat_treatment ?? 'standard';
    const rateId: string | null = raw.vatRateId ?? item?.vat_rate_id ?? null;
    let vatRate: bigint | null = null;

    if (treatment === 'standard') {
      if (!vatEnabled) {
        throw new ApiError(
          409,
          'VAT_NOT_CONFIGURED',
          'TVA non activée pour ce dossier : configurez un taux vérifié ou choisissez une qualification explicite',
        );
      }
      if (!rateId) {
        throw new ApiError(409, 'VAT_NOT_CONFIGURED', 'Aucun taux de TVA configuré : aucun taux n’est supposé');
      }
      const rate = rates.find((r) => r.id === rateId);
      if (!rate) throw new ApiError(400, 'VAT_RATE_NOT_FOUND', 'Taux de TVA hors dossier');
      if (!rate.verified) {
        throw new ApiError(
          409,
          'VAT_RATE_NOT_VERIFIED',
          `Le taux « ${rate.code} » n’est pas vérifié : un professionnel doit le confirmer`,
        );
      }
      if (issueDate < rate.effective_from || (rate.effective_to && issueDate > rate.effective_to)) {
        throw new ApiError(409, 'VAT_RATE_NOT_APPLICABLE', `Le taux « ${rate.code} » n’est pas applicable à cette date`);
      }
      vatRate = amount(rate.rate);
    } else {
      if (rateId) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Une qualification non standard ne porte pas de taux');
      }
      warnings.add(
        treatment === 'zero_rated'
          ? 'VAT_ZERO_RATED: taux zéro — qualification à confirmer par le cabinet.'
          : treatment === 'exempt'
            ? 'VAT_EXEMPT: exonération — qualification à confirmer par le cabinet.'
            : 'VAT_OUT_OF_SCOPE: hors champ — qualification à confirmer par le cabinet.',
      );
    }

    const netAmount = mulMoney(quantity, unitPrice);
    const discountAmount = applyPct(netAmount, discountPct);
    const taxable = netAmount - discountAmount;
    const taxAmount = vatRate === null ? 0n : applyPct(taxable, vatRate);
    const revenueAccountId = raw.revenueAccountId ?? item?.revenue_account_id ?? defaultRevenue?.id ?? null;
    if (!revenueAccountId) {
      warnings.add('REVENUE_ACCOUNT_MISSING: aucun compte de produits associé à cette ligne.');
    }
    return {
      itemId: raw.itemId ?? null,
      description,
      quantity,
      unitPrice,
      unit: String(raw.unit ?? item?.unit ?? 'unit'),
      discountPct,
      vatTreatment: treatment,
      vatRate,
      vatRateId: rateId,
      netAmount,
      discountAmount,
      taxAmount,
      lineTotal: taxable + taxAmount,
      revenueAccountId,
    };
  });

  return {
    lines,
    subtotal: lines.reduce((acc, l) => acc + l.netAmount, 0n),
    discountTotal: lines.reduce((acc, l) => acc + l.discountAmount, 0n),
    taxTotal: lines.reduce((acc, l) => acc + l.taxAmount, 0n),
    total: lines.reduce((acc, l) => acc + l.lineTotal, 0n),
    warnings: [...warnings],
  };
}

function nextBillingNumber(companyId: string, kind: DemoDocKind | 'payment', year: number): { no: number; number: string; year: number } {
  const s = loadState();
  const settings = billingSettingsOf(companyId);
  const key = `BILL-${kind}-${year}`;
  const no = (s.billingSequences[key] ?? 0) + 1;
  s.billingSequences[key] = no;
  const prefix =
    kind === 'quote'
      ? settings.quote_prefix
      : kind === 'credit_note'
        ? settings.credit_prefix
        : kind === 'payment'
          ? 'REC'
          : settings.invoice_prefix;
  const number =
    settings.numbering_policy === 'continuous'
      ? `${prefix}-${String(no).padStart(4, '0')}`
      : `${prefix}-${year}-${String(no).padStart(4, '0')}`;
  return { no, number, year };
}

function billingYear(companyId: string, date: string): number {
  return billingSettingsOf(companyId).numbering_policy === 'continuous' ? 0 : Number(date.slice(0, 4));
}

function refreshInvoiceBalance(companyId: string, invoiceId: string): void {
  const s = loadState();
  const invoice = s.billingDocuments.find((d) => d.id === invoiceId && d.company_id === companyId);
  if (!invoice) return;
  const paid = s.billingAllocations
    .filter((a) => a.invoice_id === invoiceId)
    .filter((a) => s.billingPayments.find((p) => p.id === a.payment_id && p.status === 'recorded'))
    .reduce((acc, a) => acc + amount(a.amount), 0n);
  const credited = s.billingDocuments
    .filter(
      (d) =>
        d.company_id === companyId &&
        d.kind === 'credit_note' &&
        d.source_document_id === invoiceId &&
        d.status === 'issued',
    )
    .reduce((acc, d) => acc + amount(d.total_amount), 0n);
  const total = amount(invoice.total_amount);
  const settled = paid + credited;
  invoice.amount_paid = fmt(paid);
  invoice.credited_amount = fmt(credited);
  invoice.payment_status = settled >= total ? (settled > total ? 'overpaid' : 'paid') : settled > 0n ? 'partial' : 'unpaid';
  if (!['draft', 'cancelled'].includes(invoice.status)) {
    invoice.status = settled >= total ? 'paid' : settled > 0n ? 'partially_paid' : 'issued';
  }
  invoice.updated_at = now();
}

function billingDuplicateCheck(
  companyId: string,
  input: {
    kind: DemoDocKind;
    customerId?: string | null;
    customerName?: string | null;
    docNo?: string | null;
    issueDate: string;
    totalAmount: string;
    currency: string;
    sourceDocumentId?: string | null;
    excludeDocumentId?: string | null;
  },
) {
  const s = loadState();
  const normaliseDoc = (v: string | null | undefined) => (v ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  const days = (a: string, b: string) =>
    Math.abs(Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000));
  const matches: {
    documentId: string;
    docNo: string | null;
    status: string;
    issueDate: string;
    totalAmount: string;
    currency: string;
    customerName: string;
    level: 'similar' | 'probable' | 'certain';
    reasons: string[];
  }[] = [];
  for (const doc of s.billingDocuments.filter(
    (d) => d.company_id === companyId && d.kind === input.kind && d.status !== 'cancelled' && d.id !== input.excludeDocumentId,
  )) {
    const reasons: string[] = [];
    let level: 'similar' | 'probable' | 'certain' | null = null;
    if (normaliseDoc(doc.doc_no) && normaliseDoc(doc.doc_no) === normaliseDoc(input.docNo)) {
      level = 'certain';
      reasons.push('SAME_DOC_NUMBER: même numéro de document');
    }
    if (input.sourceDocumentId && doc.source_document_id === input.sourceDocumentId) {
      if (level !== 'certain') level = 'probable';
      reasons.push('SAME_SOURCE_DOCUMENT: même document source');
    }
    const sameAmount = amount(doc.total_amount) === amount(input.totalAmount);
    const sameCustomer =
      (input.customerId && doc.customer_id === input.customerId) ||
      (input.customerName ?? '').toLowerCase() === doc.customer_name.toLowerCase();
    const gap = days(doc.issue_date, input.issueDate);
    if (sameAmount && doc.currency === input.currency && sameCustomer && gap <= 3) {
      if (level !== 'certain') level = 'probable';
      reasons.push('SAME_CUSTOMER_SAME_AMOUNT_CLOSE_DATE');
    } else if (sameAmount && doc.currency === input.currency && gap <= 31) {
      if (!level) level = 'similar';
      reasons.push('SAME_AMOUNT_SAME_MONTH');
    }
    if (!level) continue;
    matches.push({
      documentId: doc.id,
      docNo: doc.doc_no,
      status: doc.status,
      issueDate: doc.issue_date,
      totalAmount: doc.total_amount,
      currency: doc.currency,
      customerName: doc.customer_name,
      level,
      reasons,
    });
  }
  const weight = { similar: 1, probable: 2, certain: 3 } as const;
  matches.sort((a, b) => weight[b.level] - weight[a.level]);
  const level = matches.reduce<'none' | 'similar' | 'probable' | 'certain'>(
    (worst, m) => (weight[m.level] > (worst === 'none' ? 0 : weight[worst]) ? m.level : worst),
    'none',
  );
  return { level, matches, compared: { ...input } };
}

function createBillingDocumentDemo(
  companyId: string,
  payload: Record<string, any>,
): Record<string, unknown> {
  const s = loadState();
  const company = s.companies.find((c) => c.id === companyId)!;
  const settings = billingSettingsOf(companyId);
  const kind = payload.kind as DemoDocKind;
  if (!['quote', 'invoice', 'credit_note'].includes(kind)) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Type de document invalide');
  }
  const customer = billingCustomerOf(companyId, String(payload.customerId));
  if (!customer.is_active) throw new ApiError(409, 'DOCUMENT_STATUS_INVALID', 'Client archivé');
  const issueDate = String(payload.issueDate ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(issueDate)) throw new ApiError(400, 'VALIDATION_ERROR', 'Date invalide');

  let source: DemoBillingDocument | null = null;
  let sourceLines: DemoBillingLine[] = [];
  if (payload.sourceDocumentId) {
    source = s.billingDocuments.find(
      (d) => d.id === payload.sourceDocumentId && d.company_id === companyId,
    ) ?? null;
    if (!source) throw new ApiError(404, 'DOCUMENT_NOT_FOUND', 'Document source introuvable');
    sourceLines = s.billingLines.filter((l) => l.document_id === source!.id);
    if (kind === 'invoice') {
      if (source.kind !== 'quote') throw new ApiError(400, 'VALIDATION_ERROR', 'Seul un devis peut être converti');
      if (['refused', 'expired', 'cancelled'].includes(source.status)) {
        throw new ApiError(409, 'DOCUMENT_STATUS_INVALID', `Devis ${source.status}`);
      }
      const already = s.billingDocuments.some(
        (d) => d.company_id === companyId && d.kind === 'invoice' && d.source_document_id === source!.id && d.status !== 'cancelled',
      );
      if (already) throw new ApiError(409, 'QUOTE_ALREADY_CONVERTED', 'Devis déjà converti en facture');
    } else if (kind === 'credit_note') {
      if (source.kind !== 'invoice') throw new ApiError(400, 'VALIDATION_ERROR', 'Un avoir référence une facture');
      if (!['issued', 'partially_paid', 'paid'].includes(source.status)) {
        throw new ApiError(409, 'DOCUMENT_NOT_ISSUED', 'La facture doit être émise');
      }
    } else {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Un devis ne se crée pas depuis un document');
    }
  } else if (kind === 'credit_note') {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Un avoir doit référencer sa facture d’origine');
  }

  const currency = String(payload.currency ?? source?.currency ?? customer.preferred_currency ?? settings.default_currency ?? company.functional_currency).toUpperCase();
  if (source && currency !== source.currency) {
    throw new ApiError(400, 'CURRENCY_MISMATCH', 'La devise doit être celle du document source');
  }
  let exchangeRate: string = '1.00000000';
  if (currency !== company.functional_currency) {
    const rate = payload.exchangeRate ?? source?.exchange_rate;
    if (rate === undefined || rate === null || rate === '') {
      throw new ApiError(400, 'EXCHANGE_RATE_REQUIRED', `Un taux est requis pour ${currency}`);
    }
    exchangeRate = rateToString(parseRate(rate));
  }

  const rawLines: any[] =
    Array.isArray(payload.lines) && payload.lines.length > 0
      ? payload.lines
      : sourceLines.map((l) => ({
          itemId: l.item_id,
          description: l.description,
          quantity: l.quantity,
          unitPrice: l.unit_price,
          unit: l.unit,
          discountPct: l.discount_pct,
          vatTreatment: l.vat_treatment,
          vatRateId: l.vat_rate_id,
          revenueAccountId: l.revenue_account_id,
        }));
  const computed = computeBillingDocument(companyId, issueDate, rawLines, settings.vat_enabled);

  if (kind === 'credit_note' && source) {
    const alreadyCredited = amount(source.credited_amount);
    if (alreadyCredited + computed.total > amount(source.total_amount)) {
      throw new ApiError(409, 'CREDIT_EXCEEDS_INVOICE', 'L’avoir dépasse le montant restant créditable', {
        invoiceTotal: source.total_amount,
        alreadyCredited: fmt(alreadyCredited),
        requested: fmt(computed.total),
      });
    }
    for (const line of computed.lines) {
      if (!line.itemId) continue;
      const credited = s.billingLines
        .filter((l) => l.item_id === line.itemId)
        .filter((l) => {
          const doc = s.billingDocuments.find((d) => d.id === l.document_id);
          return (
            doc &&
            doc.company_id === companyId &&
            doc.kind === 'credit_note' &&
            doc.source_document_id === source!.id &&
            doc.status === 'issued'
          );
        })
        .reduce((acc, l) => acc + amount(l.quantity), 0n);
      const invoiced = sourceLines
        .filter((l) => l.item_id === line.itemId)
        .reduce((acc, l) => acc + amount(l.quantity), 0n);
      if (invoiced > 0n && credited + line.quantity > invoiced) {
        throw new ApiError(409, 'CREDIT_EXCEEDS_INVOICE', 'Quantité créditée supérieure à la quantité facturée');
      }
    }
  }

  const duplicates = billingDuplicateCheck(companyId, {
    kind,
    customerId: customer.id,
    customerName: customer.name,
    docNo: null,
    issueDate,
    totalAmount: fmt(computed.total),
    currency,
    sourceDocumentId: source?.id ?? null,
  });
  if (!payload.confirmDuplicate && duplicates.level === 'certain') {
    throw new ApiError(409, 'CUSTOMER_DUPLICATE', 'Doublon certain détecté : confirmez explicitement', { duplicates });
  }

  const dueDate =
    kind === 'invoice'
      ? String(payload.dueDate ?? billingDatesFrom(issueDate, customer.payment_terms_days ?? settings.default_payment_terms))
      : (payload.dueDate ?? null);

  const document: DemoBillingDocument = {
    id: uid(),
    company_id: companyId,
    kind,
    doc_no: null,
    customer_id: customer.id,
    customer_name: customer.name,
    customer_brn: customer.brn,
    issue_date: issueDate,
    due_date: dueDate,
    valid_until: payload.validUntil ?? null,
    currency,
    exchange_rate: exchangeRate,
    subtotal: fmt(computed.subtotal),
    discount_total: fmt(computed.discountTotal),
    tax_total: fmt(computed.taxTotal),
    total_amount: fmt(computed.total),
    amount_paid: '0.0000',
    credited_amount: '0.0000',
    payment_status: 'unpaid',
    status: 'draft',
    source_kind: source?.kind ?? null,
    source_document_id: source?.id ?? null,
    notes: payload.notes ?? null,
    terms: payload.terms ?? null,
    sequence_year: null,
    sequence_no: null,
    issued_at: null,
    locked_at: null,
    accounting_entry_id: null,
    created_at: now(),
    updated_at: now(),
  };
  s.billingDocuments.push(document);
  computed.lines.forEach((line, index) => {
    s.billingLines.push({
      id: uid(),
      document_id: document.id,
      company_id: companyId,
      line_no: index + 1,
      item_id: line.itemId,
      description: line.description,
      quantity: fmt(line.quantity),
      unit_price: fmt(line.unitPrice),
      unit: line.unit,
      discount_pct: fmt(line.discountPct),
      vat_treatment: line.vatTreatment,
      vat_rate: line.vatRate === null ? null : fmt(line.vatRate),
      vat_rate_id: line.vatRateId,
      net_amount: fmt(line.netAmount),
      discount_amount: fmt(line.discountAmount),
      tax_amount: fmt(line.taxAmount),
      line_total: fmt(line.lineTotal),
      revenue_account_id: line.revenueAccountId,
    });
  });
  audit(companyId, 'billing.document.create', 'billing_document', document.id, {
    kind,
    total: document.total_amount,
    currency,
  });
  persist();
  return {
    document: billingDocView(document),
    duplicates,
    warnings: computed.warnings,
  };
}

function billingDatesFrom(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function issueBillingDocumentDemo(companyId: string, documentId: string): Record<string, unknown> {
  const s = loadState();
  const settings = billingSettingsOf(companyId);
  const doc = s.billingDocuments.find((d) => d.id === documentId && d.company_id === companyId);
  if (!doc) throw new ApiError(404, 'DOCUMENT_NOT_FOUND', 'Document introuvable');
  if (doc.status !== 'draft') throw new ApiError(409, 'DOCUMENT_STATUS_INVALID', `Document déjà ${doc.status}`);
  if (!doc.customer_id) throw new ApiError(400, 'VALIDATION_ERROR', 'Client requis avant émission');

  if (doc.kind === 'credit_note') {
    const invoice = s.billingDocuments.find((d) => d.id === doc.source_document_id && d.company_id === companyId);
    if (!invoice) throw new ApiError(404, 'DOCUMENT_NOT_FOUND', 'Facture d’origine introuvable');
    if (amount(invoice.credited_amount) + amount(doc.total_amount) > amount(invoice.total_amount)) {
      throw new ApiError(409, 'CREDIT_EXCEEDS_INVOICE', 'Avoir supérieur au restant créditable');
    }
  }

  const year = billingYear(companyId, doc.issue_date);
  const allocated = nextBillingNumber(companyId, doc.kind, year);
  doc.doc_no = allocated.number;
  doc.sequence_year = allocated.year;
  doc.sequence_no = allocated.no;
  doc.status = doc.kind === 'quote' ? 'sent' : 'issued';
  doc.issued_at = now();
  doc.locked_at = now();
  doc.updated_at = now();
  if (doc.kind === 'credit_note' && doc.source_document_id) {
    refreshInvoiceBalance(companyId, doc.source_document_id);
  }
  audit(companyId, 'billing.document.issue', 'billing_document', doc.id, {
    number: doc.doc_no,
    kind: doc.kind,
  });
  persist();
  return { document: billingDocView(doc), entryCreated: false };
}

function billingAgingDemo(companyId: string, asOf: string, customerId?: string | null) {
  const s = loadState();
  const buckets = { current: 0n, days1to30: 0n, days31to60: 0n, days61to90: 0n, over90: 0n, total: 0n };
  const rows = new Map<string, { customerId: string; customerName: string; currency: string; raw: typeof buckets; invoiceCount: number }>();
  for (const doc of s.billingDocuments.filter(
    (d) => d.company_id === companyId && d.kind === 'invoice' && ['issued', 'partially_paid'].includes(d.status) && d.issue_date <= asOf,
  )) {
    if (customerId && doc.customer_id !== customerId) continue;
    const outstanding = billingOutstanding(doc);
    if (outstanding === 0n) continue;
    const key = doc.customer_id ?? 'unknown';
    const entry = rows.get(key) ?? {
      customerId: key,
      customerName: doc.customer_name,
      currency: doc.currency,
      raw: { current: 0n, days1to30: 0n, days31to60: 0n, days61to90: 0n, over90: 0n, total: 0n },
      invoiceCount: 0,
    };
    const late = Math.floor(
      (Date.parse(`${asOf}T00:00:00Z`) - Date.parse(`${doc.due_date ?? doc.issue_date}T00:00:00Z`)) / 86_400_000,
    );
    const bucket: keyof typeof buckets =
      late <= 0 ? 'current' : late <= 30 ? 'days1to30' : late <= 60 ? 'days31to60' : late <= 90 ? 'days61to90' : 'over90';
    entry.raw[bucket] += outstanding;
    entry.raw.total += outstanding;
    entry.invoiceCount += 1;
    buckets[bucket] += outstanding;
    buckets.total += outstanding;
    rows.set(key, entry);
  }
  return {
    asOf,
    rows: [...rows.values()]
      .sort((a, b) => a.customerName.localeCompare(b.customerName))
      .map((r) => ({
        customerId: r.customerId,
        customerName: r.customerName,
        currency: r.currency,
        invoiceCount: r.invoiceCount,
        buckets: {
          current: fmt(r.raw.current),
          days1to30: fmt(r.raw.days1to30),
          days31to60: fmt(r.raw.days31to60),
          days61to90: fmt(r.raw.days61to90),
          over90: fmt(r.raw.over90),
          total: fmt(r.raw.total),
        },
      })),
    totals: {
      current: fmt(buckets.current),
      days1to30: fmt(buckets.days1to30),
      days31to60: fmt(buckets.days31to60),
      days61to90: fmt(buckets.days61to90),
      over90: fmt(buckets.over90),
      total: fmt(buckets.total),
    },
  };
}

function billingCustomerBalanceDemo(companyId: string, customerId: string, asOf: string) {
  const s = loadState();
  const invoices = s.billingDocuments.filter(
    (d) =>
      d.company_id === companyId &&
      d.customer_id === customerId &&
      d.kind === 'invoice' &&
      !['draft', 'cancelled'].includes(d.status) &&
      d.issue_date <= asOf,
  );
  const invoiced = invoices.reduce((acc, d) => acc + amount(d.total_amount), 0n);
  const paid = invoices.reduce((acc, d) => acc + amount(d.amount_paid), 0n);
  const credited = invoices.reduce((acc, d) => acc + amount(d.credited_amount), 0n);
  const unallocated = s.billingPayments
    .filter((p) => p.company_id === companyId && p.customer_id === customerId && p.status === 'recorded' && p.payment_date <= asOf)
    .reduce((acc, p) => acc + amount(p.unallocated_amount), 0n);
  const outstanding = invoiced - paid - credited;
  return {
    currency: invoices[0]?.currency ?? 'MUR',
    invoiced: fmt(invoiced),
    paid: fmt(paid),
    credited: fmt(credited),
    outstanding: fmt(outstanding > 0n ? outstanding : 0n),
    unallocated: fmt(unallocated),
    balance: fmt(outstanding - unallocated),
  };
}

/* --------------------------------------- assistant comptable V2 (démo) */

function demandAccount(companyId: string, code: string): DemoAccount | null {
  return accountsOf(companyId).find((a) => a.code === code && a.is_active) ?? null;
}

function demandJournal(companyId: string, preferred: string[]): DemoJournal | null {
  const journals = loadState().journals.filter((j) => j.company_id === companyId && j.is_active);
  for (const type of preferred) {
    const found = journals.find((j) => j.type === type);
    if (found) return found;
  }
  return journals[0] ?? null;
}

function proposalLinesOf(proposalId: string): DemoProposalLine[] {
  return loadState()
    .proposalLines.filter((l) => l.proposal_id === proposalId)
    .sort((a, b) => a.line_no - b.line_no);
}

function demoProposalChecks(p: DemoEntryProposal): {
  key: string;
  label: string;
  ok: boolean;
  severity: 'error' | 'warning';
  message: string;
}[] {
  const s = loadState();
  const accounts = accountsOf(p.company_id);
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const lines = proposalLinesOf(p.id);
  const debit = lines.reduce((acc, l) => acc + amount(l.debit), 0n);
  const credit = lines.reduce((acc, l) => acc + amount(l.credit), 0n);
  const unknown = lines.filter((l) => !byId.has(l.account_id));
  const inactive = lines.filter((l) => byId.get(l.account_id)?.is_active === false);
  const journal = s.journals.find((j) => j.id === p.journal_id && j.company_id === p.company_id);
  const period = s.periods.find(
    (x) => x.company_id === p.company_id && x.status === 'open' && x.start_date <= p.entry_date && x.end_date >= p.entry_date,
  );
  const company = s.companies.find((c) => c.id === p.company_id);
  const functional = company?.functional_currency ?? 'MUR';
  const supported = SUPPORTED_CURRENCIES.includes(p.currency);
  const foreign = supported && p.currency !== functional;
  const rateOk = supported && (!foreign || (p.exchange_rate !== null && /^\d+(\.\d+)?$/.test(p.exchange_rate)));
  const vatLine = lines.some((l) => {
    const account = byId.get(l.account_id);
    return account ? /tva|vat/i.test(`${account.code} ${account.name}`) : false;
  });
  const rates = s.taxRates.filter((r) => r.company_id === p.company_id && r.verified);
  const vatOk = !vatLine || rates.length > 0;
  const source = demoProposalSource(s, p.source_kind, p.source_id);
  const alreadyPosted = Boolean(p.entry_id) || Boolean((source as any)?.accounting_entry_id);
  const todayIso = new Date().toISOString().slice(0, 10);

  return [
    {
      key: 'balanced',
      label: 'Débit = crédit',
      ok: lines.length >= 2 && debit === credit && debit > 0n,
      severity: 'error',
      message:
        debit === credit
          ? `Équilibrée : ${fmt(debit)} au débit et au crédit.`
          : `Écart de ${fmt(debit - credit)} entre débit et crédit.`,
    },
    {
      key: 'accounts_exist',
      label: 'Comptes existants et actifs',
      ok: unknown.length === 0 && inactive.length === 0,
      severity: 'error',
      message:
        unknown.length > 0
          ? `${unknown.length} compte(s) hors plan comptable.`
          : inactive.length > 0
            ? `${inactive.length} compte(s) inactif(s).`
            : 'Comptes du plan comptable, actifs.',
    },
    {
      key: 'journal',
      label: 'Journal existant et autorisé',
      ok: Boolean(journal?.is_active),
      severity: 'error',
      message: journal ? `Journal ${journal.code}.` : 'Aucun journal valide.',
    },
    {
      key: 'period_open',
      label: 'Exercice / période ouverte',
      ok: Boolean(period),
      severity: 'error',
      message: period ? `Période ouverte : ${period.name}.` : 'Aucune période ouverte pour cette date.',
    },
    {
      key: 'date_allowed',
      label: 'Date autorisée',
      ok: Boolean(p.entry_date) && p.entry_date <= todayIso,
      severity: 'error',
      message:
        p.entry_date <= todayIso
          ? `Date comptable ${p.entry_date}.`
          : `La date ${p.entry_date} est dans le futur.`,
    },
    {
      key: 'currency',
      label: 'Devise et taux de change',
      ok: rateOk,
      severity: 'error',
      message: !supported
        ? `Devise non prise en charge : ${p.currency}.`
        : foreign
          ? rateOk
            ? `Devise ${p.currency}, taux ${p.exchange_rate}.`
            : `Taux documenté requis pour ${p.currency}.`
          : `Devise fonctionnelle ${functional}.`,
    },
    {
      key: 'vat_verified',
      label: 'TVA vérifiée et applicable',
      ok: vatOk,
      severity: 'warning',
      message: !vatLine
        ? 'Aucune ligne de TVA dans la proposition.'
        : vatOk
          ? 'Un taux vérifié existe ; le montant reste à confirmer.'
          : 'Aucun taux de TVA vérifié : montant à confirmer.',
    },
    { key: 'permissions', label: 'Droits suffisants', ok: true, severity: 'error', message: 'Contrôlé par les permissions Comptabilité.' },
    {
      key: 'no_duplicate',
      label: 'Absence de doublon',
      ok: !alreadyPosted,
      severity: 'error',
      message: alreadyPosted ? 'Cette source est déjà comptabilisée.' : 'Aucune comptabilisation antérieure.',
    },
    {
      key: 'company_scope',
      label: 'Bonne société',
      ok: unknown.length === 0,
      severity: 'error',
      message: 'Comptes vérifiés dans le périmètre de la société.',
    },
    {
      key: 'source_attached',
      label: 'Document source rattaché',
      ok: p.source_kind === 'manual' ? p.description.trim().length >= 3 : Boolean(source),
      severity: p.source_kind === 'manual' ? 'warning' : 'error',
      message:
        p.source_kind === 'manual'
          ? 'Proposition manuelle : justificatif à joindre.'
          : source
            ? `Document ${(source as any).doc_no ?? (source as any).payment_no ?? ''} rattaché.`
            : 'Document source introuvable.',
    },
    {
      key: 'not_posted_twice',
      label: 'Protection contre la double comptabilisation',
      ok: p.status !== 'posted',
      severity: 'error',
      message: p.status === 'posted' ? 'Déjà comptabilisée.' : 'Comptabilisation = action distincte et unique.',
    },
  ];
}

function demoProposalSource(
  s: DemoState,
  kind: DemoEntryProposal['source_kind'],
  sourceId: string | null,
): { id: string; accounting_entry_id: string | null; doc_no?: string | null; payment_no?: string | null; status?: string } | null {
  if (kind === 'manual') return null;
  if (kind === 'billing_payment') return s.billingPayments.find((x) => x.id === sourceId) ?? null;
  if (kind === 'purchase_invoice' || kind === 'purchase_credit_note') {
    return s.purchaseDocuments.find((x) => x.id === sourceId) ?? null;
  }
  if (kind === 'purchase_payment') return s.purchasePayments.find((x) => x.id === sourceId) ?? null;
  return s.billingDocuments.find((x) => x.id === sourceId) ?? null;
}

function demoProposalView(p: DemoEntryProposal) {
  const s = loadState();
  const lines = proposalLinesOf(p.id).map((l) => {
    const account = s.accounts.find((a) => a.id === l.account_id);
    return {
      id: l.id,
      lineNo: l.line_no,
      accountId: l.account_id,
      accountCode: account?.code ?? '',
      accountName: account?.name ?? '',
      description: l.description,
      debit: l.debit,
      credit: l.credit,
      ruleId: l.rule_id,
    };
  });
  const debit = lines.reduce((acc, l) => acc + amount(l.debit), 0n);
  const credit = lines.reduce((acc, l) => acc + amount(l.credit), 0n);
  const journal = s.journals.find((j) => j.id === p.journal_id);
  const source = demoProposalSource(s, p.source_kind, p.source_id);
  return {
    id: p.id,
    sourceKind: p.source_kind,
    sourceId: p.source_id,
    status: p.status,
    journalId: p.journal_id,
    journalCode: journal?.code ?? null,
    entryDate: p.entry_date,
    reference: p.reference,
    description: p.description,
    currency: p.currency,
    exchangeRate: p.exchange_rate,
    confidence: p.confidence,
    rationale: p.rationale,
    warnings: p.warnings,
    missing: p.missing,
    ruleTrace: p.rule_trace,
    provider: p.provider,
    model: p.model,
    createdAt: p.created_at,
    updatedAt: p.updated_at,
    validatedBy: p.validated_by,
    validatedAt: p.validated_at,
    rejectedBy: p.rejected_by,
    rejectedAt: p.rejected_at,
    rejectionNote: p.rejection_note,
    entryId: p.entry_id,
    lines,
    totals: {
      debit: fmt(debit),
      credit: fmt(credit),
      difference: fmt(debit - credit),
      balanced: debit === credit && debit > 0n,
    },
    checks: demoProposalChecks(p),
    source: source
      ? {
          kind: p.source_kind,
          id: source.id,
          number: (source as any).doc_no ?? (source as any).payment_no ?? null,
          status: (source as any).status,
        }
      : null,
  };
}

function demoCreateProposal(
  s: DemoState,
  companyId: string,
  data: {
    source_kind: DemoEntryProposal['source_kind'];
    source_id: string | null;
    journal_id: string | null;
    entry_date: string;
    reference: string | null;
    description: string;
    currency: string;
    exchange_rate: string | null;
    confidence: number | null;
    rationale: string | null;
    warnings: string[];
    missing: string[];
    rule_trace: string[];
    provider: string | null;
    model: string | null;
    lines: { account_id: string; description: string | null; debit: bigint; credit: bigint; rule_id?: string | null }[];
  },
): DemoEntryProposal {
  const user = requireUser();
  const proposal: DemoEntryProposal = {
    id: uid(),
    company_id: companyId,
    source_kind: data.source_kind,
    source_id: data.source_id,
    journal_id: data.journal_id,
    entry_date: data.entry_date,
    reference: data.reference,
    description: data.description,
    currency: data.currency,
    exchange_rate: data.exchange_rate,
    status: 'proposed',
    confidence: data.confidence,
    rationale: data.rationale,
    warnings: data.warnings,
    missing: data.missing,
    rule_trace: data.rule_trace,
    provider: data.provider,
    model: data.model,
    created_at: now(),
    updated_at: now(),
    validated_by: null,
    validated_at: null,
    rejected_by: null,
    rejected_at: null,
    rejection_note: null,
    entry_id: null,
  };
  s.entryProposals.push(proposal);
  data.lines.forEach((line, index) => {
    s.proposalLines.push({
      id: uid(),
      proposal_id: proposal.id,
      line_no: index + 1,
      account_id: line.account_id,
      description: line.description,
      debit: fmt(line.debit),
      credit: fmt(line.credit),
      rule_id: line.rule_id ?? null,
    });
  });
  audit(companyId, 'ai.proposal.create', 'ai_entry_proposal', proposal.id, {
    sourceKind: data.source_kind,
    provider: data.provider,
    lines: data.lines.length,
  });
  persist();
  void user;
  return proposal;
}

function demoProposeFromBilling(
  companyId: string,
  input: { documentId?: string; paymentId?: string },
): Record<string, unknown> {
  const s = loadState();
  let sourceKind: DemoEntryProposal['source_kind'];
  let sourceId: string;
  let description: string;
  let reference: string | null;
  let entryDate: string;
  let currency: string;
  let exchangeRate: string | null;
  let journalTypes: string[];
  let total: bigint;
  const warnings: string[] = [];
  const missing: string[] = [];
  const lines: { account_id: string; description: string | null; debit: bigint; credit: bigint }[] = [];

  if (input.paymentId) {
    const payment = s.billingPayments.find((p) => p.id === input.paymentId && p.company_id === companyId);
    if (!payment) throw new ApiError(404, 'PAYMENT_NOT_FOUND', 'Encaissement introuvable');
    if (payment.status !== 'recorded') throw new ApiError(409, 'DOCUMENT_STATUS_INVALID', 'Encaissement annulé');
    if (payment.accounting_entry_id) throw new ApiError(409, 'ACCOUNTING_ALREADY_POSTED', 'Encaissement déjà comptabilisé');
    sourceKind = 'billing_payment';
    sourceId = payment.id;
    reference = payment.payment_no;
    description = `Encaissement ${payment.payment_no ?? ''} — client`;
    entryDate = payment.payment_date;
    currency = payment.currency;
    exchangeRate = payment.exchange_rate;
    total = amount(payment.amount);
    journalTypes = payment.method === 'cash' ? ['cash', 'bank'] : ['bank', 'cash'];
    const bank = demandAccount(companyId, payment.method === 'cash' ? '1000' : '1010');
    const receivable = demandAccount(companyId, '1100');
    const otherLiabilities = demandAccount(companyId, '2100');
    if (!bank) missing.push('Aucun compte de banque/caisse actif.');
    if (!receivable) missing.push('Aucun compte client actif.');
    if (missing.length > 0) throw new ApiError(409, 'AI_HUMAN_REQUIRED', 'Plan comptable incomplet', { missing });
    const unallocated = amount(payment.unallocated_amount);
    lines.push({ account_id: bank!.id, description: 'Encaissement', debit: total, credit: 0n });
    lines.push({ account_id: receivable!.id, description: 'Règlement facture(s)', debit: 0n, credit: total - unallocated });
    if (unallocated > 0n) {
      if (!otherLiabilities) throw new ApiError(409, 'AI_HUMAN_REQUIRED', 'Compte de passif requis pour le trop-perçu');
      lines.push({ account_id: otherLiabilities.id, description: 'Trop-perçu client', debit: 0n, credit: unallocated });
      warnings.push('OVERPAYMENT: le trop-perçu est proposé sur un compte de passif générique — à vérifier.');
    }
  } else if (input.documentId) {
    const doc = s.billingDocuments.find((d) => d.id === input.documentId && d.company_id === companyId);
    if (!doc) throw new ApiError(404, 'DOCUMENT_NOT_FOUND', 'Document introuvable');
    if (!['issued', 'partially_paid', 'paid'].includes(doc.status)) {
      throw new ApiError(409, 'DOCUMENT_NOT_ISSUED', 'Le document doit être émis avant toute proposition');
    }
    if (doc.accounting_entry_id) throw new ApiError(409, 'ACCOUNTING_ALREADY_POSTED', 'Document déjà comptabilisé');
    sourceKind = doc.kind === 'credit_note' ? 'billing_credit_note' : 'billing_invoice';
    sourceId = doc.id;
    reference = doc.doc_no;
    entryDate = doc.issue_date;
    currency = doc.currency;
    exchangeRate = doc.exchange_rate;
    total = amount(doc.total_amount);
    journalTypes = ['sales', 'general'];
    const receivable = demandAccount(companyId, '1100');
    const vatOutput = demandAccount(companyId, '2200');
    const defaultRevenue = demandAccount(companyId, '4010') ?? accountsOf(companyId).find((a) => a.type === 'revenue') ?? null;
    const docLines = s.billingLines.filter((l) => l.document_id === doc.id);
    const revenue = new Map<string, bigint>();
    for (const line of docLines) {
      const accountId = line.revenue_account_id ?? defaultRevenue?.id ?? null;
      if (!accountId) {
        missing.push(`Ligne ${line.line_no} : aucun compte de produits.`);
        continue;
      }
      const net = amount(line.net_amount) - amount(line.discount_amount);
      revenue.set(accountId, (revenue.get(accountId) ?? 0n) + net);
    }
    if (!receivable) missing.push('Aucun compte client actif.');
    if (amount(doc.tax_total) > 0n && !vatOutput) missing.push('Aucun compte de TVA collectée.');
    if (missing.length > 0) throw new ApiError(409, 'AI_HUMAN_REQUIRED', 'Plan comptable incomplet', { missing });
    description = `${doc.kind === 'credit_note' ? 'Avoir' : 'Facture'} ${doc.doc_no} — ${doc.customer_name}`;
    if (doc.kind === 'credit_note') {
      for (const [accountId, value] of revenue) {
        if (value > 0n) lines.push({ account_id: accountId, description: 'Annulation de produit', debit: value, credit: 0n });
      }
      if (amount(doc.tax_total) > 0n) {
        lines.push({ account_id: vatOutput!.id, description: 'TVA à annuler', debit: amount(doc.tax_total), credit: 0n });
      }
      lines.push({ account_id: receivable!.id, description: 'Créance annulée', debit: 0n, credit: total });
    } else {
      lines.push({ account_id: receivable!.id, description: 'Créance client', debit: total, credit: 0n });
      for (const [accountId, value] of revenue) {
        if (value > 0n) lines.push({ account_id: accountId, description: 'Chiffre d’affaires', debit: 0n, credit: value });
      }
      if (amount(doc.tax_total) > 0n) {
        lines.push({ account_id: vatOutput!.id, description: 'TVA collectée', debit: 0n, credit: amount(doc.tax_total) });
      }
    }
  } else {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Un document ou un encaissement est requis');
  }

  const existing = s.entryProposals.find(
    (p) => p.source_kind === sourceKind && p.source_id === sourceId && p.status !== 'rejected',
  );
  if (existing) {
    if (existing.status === 'posted') {
      throw new ApiError(409, 'ACCOUNTING_ALREADY_POSTED', 'Cette source est déjà comptabilisée');
    }
    return { proposal: demoProposalView(existing), reused: true, entryCreated: false };
  }

  const journal = demandJournal(companyId, journalTypes);
  const proposal = demoCreateProposal(s, companyId, {
    source_kind: sourceKind,
    source_id: sourceId,
    journal_id: journal?.id ?? null,
    entry_date: entryDate,
    reference,
    description,
    currency,
    exchange_rate: exchangeRate,
    confidence: 1,
    rationale:
      'Proposition déterministe calculée depuis le document : comptes du plan comptable réel, aucune donnée fiscale inventée.',
    warnings,
    missing,
    rule_trace: ['Aucune IA : proposition déterministe issue de la facturation.'],
    provider: 'deterministic',
    model: null,
    lines,
  });
  return { proposal: demoProposalView(proposal), reused: false, entryCreated: false };
}

function demoRuleMatch(companyId: string, text: string) {
  const s = loadState();
  const haystack = normalise(text);
  const candidates = s.entryRules
    .filter((r) => r.company_id === companyId && r.is_active)
    .filter((r) => haystack.includes(normalise(r.match_key)))
    .sort((a, b) => a.priority - b.priority || b.match_key.length - a.match_key.length)
    .map((rule) => {
      const account = s.accounts.find((a) => a.id === rule.account_id);
      const journal = s.journals.find((j) => j.id === rule.journal_id);
      return {
        rule,
        account,
        journal,
        explanation: `Règle ${rule.rule_type} v${rule.version} « ${rule.match_key} » (priorité ${rule.priority}) → ${account?.code ?? journal?.code ?? ''}`,
      };
    });
  const trace: string[] = [];
  if (candidates.length === 0) {
    trace.push('Aucune règle validée ne correspond à ce libellé.');
    return { applied: null, candidates, ambiguous: false, trace };
  }
  const best = candidates[0]!;
  const competing = candidates.filter(
    (c) => c !== best && c.rule.priority === best.rule.priority && c.rule.account_id !== best.rule.account_id,
  );
  if (competing.length > 0) {
    trace.push('Conflit : plusieurs règles de même priorité proposent des comptes différents — aucune n’est appliquée.');
    return { applied: null, candidates, ambiguous: true, trace };
  }
  trace.push(best.explanation);
  return { applied: best, candidates, ambiguous: false, trace };
}

function demoManualProposal(companyId: string, payload: Record<string, any>): Record<string, unknown> {
  const s = loadState();
  const user = requireUser();
  if (!s.ai.enabled) throw new ApiError(403, 'AI_DISABLED', 'Intelligence artificielle désactivée pour ce cabinet');
  if (s.ai.features.accounting !== true) {
    throw new ApiError(403, 'AI_FEATURE_DISABLED', 'Fonctions IA désactivées pour la Comptabilité');
  }
  const description = String(payload.description ?? '').trim();
  if (description.length < 5) throw new ApiError(400, 'VALIDATION_ERROR', 'Description trop courte');
  const total = amount(payload.amount);
  if (total <= 0n) throw new ApiError(400, 'VALIDATION_ERROR', 'Un montant supérieur à zéro est requis');
  const company = s.companies.find((c) => c.id === companyId)!;
  const currency = String(payload.currency ?? company.functional_currency).toUpperCase();
  if (!SUPPORTED_CURRENCIES.includes(currency)) throw new ApiError(400, 'INVALID_CURRENCY', 'Devise non supportée');
  const entryDate = String(payload.entryDate ?? todayIso());
  const rules = demoRuleMatch(companyId, description);

  if (rules.applied && rules.applied.rule.account_id && rules.applied.rule.counter_account_id) {
    const journal =
      (rules.applied.journal ??
        demandJournal(companyId, ['purchases', 'bank', 'general'])) ?? null;
    if (journal) {
      const rule = rules.applied.rule;
      const debitFirst = rule.account_side === 'debit';
      const proposal = demoCreateProposal(s, companyId, {
        source_kind: 'manual',
        source_id: null,
        journal_id: journal.id,
        entry_date: entryDate,
        reference: payload.reference ?? null,
        description,
        currency,
        exchange_rate: currency === company.functional_currency ? '1.00000000' : null,
        confidence: 0.95,
        rationale: `Règle validée appliquée : ${rules.applied.explanation}`,
        warnings: [],
        missing: [],
        rule_trace: rules.trace,
        provider: 'rule',
        model: null,
        lines: [
          {
            account_id: rule.account_id!,
            description,
            debit: debitFirst ? total : 0n,
            credit: debitFirst ? 0n : total,
            rule_id: rule.id,
          },
          {
            account_id: rule.counter_account_id!,
            description,
            debit: debitFirst ? 0n : total,
            credit: debitFirst ? total : 0n,
            rule_id: rule.id,
          },
        ],
      });
      rule.use_count += 1;
      persist();
      return {
        proposal: demoProposalView(proposal),
        ruleApplied: {
          rule: { id: rule.id, type: rule.rule_type, key: rule.match_key, version: rule.version, priority: rule.priority },
        },
        entryCreated: false,
      };
    }
  }

  // Deterministic, offline "provider": never invents an account or a rate.
  const accounts = accountsOf(companyId).filter((a) => a.is_active);
  const roles: Record<string, string> = {
    client: '1100',
    fournisseur: '2000',
    banque: '1010',
    caisse: '1000',
    produits: '4010',
    tva_collectee: '2200',
    autres_passifs: '2100',
  };
  const roleAccount = (role: string) => demandAccount(companyId, roles[role] ?? '');
  const expenseAccounts = accounts.filter((a) => a.type === 'expense');
  const expenseMatch = chooseAccount(
    description,
    (expenseAccounts.length > 0 ? expenseAccounts : accounts).map((a) => ({ code: a.code, name: a.name, type: a.type })),
  );
  const expenseAccount = expenseMatch ? accounts.find((a) => a.code === expenseMatch.code) ?? null : null;
  const warnings: string[] = [];
  const missing: string[] = [];
  if (/tva|vat|taxe/i.test(description)) {
    warnings.push('TVA mentionnée : aucun taux n’est configuré ni fourni. Aucun montant de taxe n’est calculé.');
    missing.push('Taux de TVA vérifié (configuration absente) et montant de taxe à confirmer.');
  }
  const text = description.toLowerCase();
  let journalTypes: string[] = ['purchases', 'general'];
  let debitAccount: DemoAccount | null = null;
  let creditAccount: DemoAccount | null = null;
  let rationale = '';

  if (/avoir/.test(text)) {
    debitAccount = roleAccount('produits');
    creditAccount = roleAccount('client');
    journalTypes = ['sales', 'general'];
    rationale = 'Avoir : annulation de produit au débit, créance client réduite au crédit.';
  } else if (/encaissement|r[èe]glement client|re[çc]u client/.test(text)) {
    debitAccount = roleAccount('banque');
    creditAccount = roleAccount('client');
    journalTypes = ['bank', 'general'];
    rationale = 'Encaissement : banque au débit, créance client au crédit.';
  } else if (/frais bancaire|commission|agios/.test(text)) {
    debitAccount = expenseAccount;
    creditAccount = roleAccount('banque');
    journalTypes = ['bank', 'general'];
    rationale = 'Frais bancaires : charge au débit, banque au crédit.';
  } else if (/facture client|vente|prestation/.test(text)) {
    debitAccount = roleAccount('client');
    creditAccount = roleAccount('produits');
    journalTypes = ['sales', 'general'];
    rationale = 'Facture client : créance au débit, produit au crédit.';
  } else {
    debitAccount = expenseAccount;
    creditAccount = /pay[ée]|r[ée]gl[ée]/.test(text) ? roleAccount('banque') : roleAccount('fournisseur');
    rationale = 'Achat / charge : compte de charge au débit, dette fournisseur (ou banque si réglé) au crédit.';
  }

  if (!debitAccount || !creditAccount || debitAccount.id === creditAccount.id) {
    throw new ApiError(
      422,
      'AI_INVALID_RESPONSE',
      'Le plan comptable fourni ne permet pas une écriture équilibrée : intervention humaine nécessaire.',
      { missing: ['Comptes requis absents du plan comptable.'] },
    );
  }

  const journal = demandJournal(companyId, journalTypes);
  const proposal = demoCreateProposal(s, companyId, {
    source_kind: 'manual',
    source_id: null,
    journal_id: journal?.id ?? null,
    entry_date: entryDate,
    reference: payload.reference ?? null,
    description,
    currency,
    exchange_rate: currency === company.functional_currency ? '1.00000000' : null,
    confidence: 0.72,
    rationale,
    warnings,
    missing,
    rule_trace: rules.trace,
    provider: 'simulated',
    model: 'simulated-fictif',
    lines: [
      { account_id: debitAccount.id, description, debit: total, credit: 0n },
      { account_id: creditAccount.id, description, debit: 0n, credit: total },
    ],
  });
  void user;
  return {
    proposal: demoProposalView(proposal),
    ruleApplied: null,
    duplicates: { level: 'none', matches: [] },
    entryCreated: false,
  };
}

function demoPostProposal(companyId: string, proposalId: string): Record<string, unknown> {
  const s = loadState();
  const user = requireUser();
  const proposal = s.entryProposals.find((p) => p.id === proposalId && p.company_id === companyId);
  if (!proposal) throw new ApiError(404, 'AI_PROPOSAL_NOT_FOUND', 'Proposition introuvable');
  if (proposal.status === 'posted') throw new ApiError(409, 'ACCOUNTING_ALREADY_POSTED', 'Déjà comptabilisée');
  if (proposal.status !== 'validated') {
    throw new ApiError(409, 'AI_PROPOSAL_NOT_VALIDATED', 'Une validation humaine est requise avant la comptabilisation');
  }
  const company = s.companies.find((c) => c.id === companyId)!;
  const lines = proposalLinesOf(proposal.id);
  const errors = demoProposalChecks(proposal).filter((c) => !c.ok && c.severity === 'error');
  if (errors.length > 0) {
    throw new ApiError(400, 'AI_PROPOSAL_INVALID', 'Contrôles comptables non satisfaits', {
      errors: errors.map((e) => e.key),
    });
  }
  if (!proposal.journal_id) throw new ApiError(400, 'AI_PROPOSAL_INVALID', 'Aucun journal');
  const journal = s.journals.find((j) => j.id === proposal.journal_id && j.company_id === companyId);
  if (!journal) throw new ApiError(400, 'AI_PROPOSAL_INVALID', 'Journal invalide');

  const source = demoProposalSource(s, proposal.source_kind, proposal.source_id);
  if (proposal.source_kind !== 'manual') {
    if (!source) throw new ApiError(409, 'AI_PROPOSAL_INVALID', 'Document source introuvable');
    if ((source as any).accounting_entry_id) {
      throw new ApiError(409, 'ACCOUNTING_ALREADY_POSTED', 'Source déjà comptabilisée');
    }
  }

  const prepared = prepareLines(company, {
    currency: proposal.currency,
    exchangeRate: proposal.exchange_rate,
    lines: lines.map((l) => ({
      accountId: l.account_id,
      description: l.description,
      debit: amount(l.debit) > 0n ? l.debit : null,
      credit: amount(l.credit) > 0n ? l.credit : null,
    })),
  });
  if (!prepared.balanced) throw new ApiError(400, 'ENTRY_UNBALANCED', 'Débit et crédit doivent être égaux');
  assertOpenPeriod(companyId, proposal.entry_date);
  if (proposal.source_kind !== 'manual' && proposal.reference) {
    const clash = s.entries.some(
      (e) => e.company_id === companyId && ['billing', 'purchase'].includes(e.source) && (e.reference ?? '').toLowerCase() === proposal.reference!.toLowerCase(),
    );
    if (clash) throw new ApiError(409, 'ACCOUNTING_ALREADY_POSTED', 'Référence déjà comptabilisée');
  }

  const entry: DemoEntry = {
    id: uid(),
    company_id: companyId,
    journal_id: journal.id,
    entry_no: nextEntryNo(companyId, journal.code, proposal.entry_date),
    entry_date: proposal.entry_date,
    reference: proposal.reference,
    description: proposal.description,
    currency: prepared.currency,
    exchange_rate: prepared.fxRate,
    status: 'posted',
    source: proposal.source_kind === 'manual'
      ? 'ai'
      : proposal.source_kind.startsWith('purchase_')
        ? 'purchase'
        : 'billing',
    reversal_of_entry_id: null,
    posted_at: now(),
    created_at: now(),
  };
  s.entries.push(entry);
  prepared.lines.forEach((line, index) => {
    s.lines.push({
      id: uid(),
      entry_id: entry.id,
      company_id: companyId,
      account_id: line.accountId,
      line_no: index + 1,
      description: line.description,
      debit: line.debit,
      credit: line.credit,
      txn_amount: line.txnAmount,
      txn_currency: line.txnCurrency,
      fx_rate: line.fxRate,
    });
  });
  proposal.status = 'posted';
  proposal.entry_id = entry.id;
  proposal.updated_at = now();
  if (source) (source as any).accounting_entry_id = entry.id;
  audit(companyId, 'ai.proposal.post', 'ai_entry_proposal', proposal.id, {
    entryNo: entry.entry_no,
    user: user.email,
    sourceKind: proposal.source_kind,
  });
  persist();
  return {
    proposal: demoProposalView(proposal),
    entryId: entry.id,
    entryNo: entry.entry_no,
    entryCreated: true,
  };
}

function entryRuleView(rule: DemoEntryRule) {
  const s = loadState();
  const account = s.accounts.find((a) => a.id === rule.account_id);
  const counter = s.accounts.find((a) => a.id === rule.counter_account_id);
  const journal = s.journals.find((j) => j.id === rule.journal_id);
  return {
    id: rule.id,
    ruleType: rule.rule_type,
    matchKey: rule.match_key,
    matchLabel: rule.match_label,
    accountId: rule.account_id,
    accountCode: account?.code ?? null,
    accountName: account?.name ?? null,
    counterAccountId: rule.counter_account_id,
    counterAccountCode: counter?.code ?? null,
    counterAccountName: counter?.name ?? null,
    journalId: rule.journal_id,
    journalCode: journal?.code ?? null,
    priority: rule.priority,
    version: rule.version,
    isActive: rule.is_active,
    accountSide: rule.account_side,
    notes: rule.notes,
    useCount: rule.use_count,
    createdBy: rule.validated_by,
    validatedBy: rule.validated_by,
    createdAt: rule.created_at,
    lastUsedAt: null,
  };
}

/* -------------------------------------------------------------------------
 * Mission 7 - company settings, VAT configuration and universal assistant.
 * Everything below runs in the browser on the *fictional* demo dataset: no
 * network call, no provider, no real data. The answers are computed from the
 * same records the demo screens display, never from hard-coded figures.
 * ---------------------------------------------------------------------- */

const DEMO_ASSISTANT_TOOLS = [
  { key: 'billing.invoices.unpaid', module: 'billing', readOnly: true },
  { key: 'billing.invoices.search', module: 'billing', readOnly: true },
  { key: 'billing.customers.balance', module: 'billing', readOnly: true },
  { key: 'billing.payments.recent', module: 'billing', readOnly: true },
  { key: 'billing.approvals.pending', module: 'billing', readOnly: true },
  { key: 'cabinet.tasks.open', module: 'cabinet', readOnly: true },
  { key: 'cabinet.tasks.overdue', module: 'cabinet', readOnly: true },
  { key: 'cabinet.deadlines', module: 'cabinet', readOnly: true },
  { key: 'cabinet.companies', module: 'cabinet', readOnly: true },
  { key: 'migration.jobs.summary', module: 'cabinet', readOnly: true },
  { key: 'accounting.accounts.search', module: 'accounting', readOnly: true },
  { key: 'accounting.trialBalance', module: 'accounting', readOnly: true },
  { key: 'accounting.proposal.prepare', module: 'accounting', readOnly: true },
  { key: 'accounting.proposal.check', module: 'accounting', readOnly: true },
  { key: 'payroll.status', module: 'payroll', readOnly: true },
];

function demoTaxRateView(rate: DemoTaxRate) {
  return {
    ...rate,
    effectiveFrom: rate.effective_from,
    effectiveTo: rate.effective_to,
    verifiedAt: rate.verified_at,
    verifiedBy: rate.verified_by,
    vatAccountId: rate.vat_account_id,
  };
}

function demoRateSnapshot(rate: DemoTaxRate | null | undefined) {
  if (!rate) return null;
  return {
    code: rate.code,
    label: rate.label,
    rate: rate.rate,
    treatment: rate.treatment,
    effectiveFrom: rate.effective_from,
    effectiveTo: rate.effective_to,
    verified: rate.verified,
    source: rate.source,
    vatAccountId: rate.vat_account_id,
  };
}

function demoLogRateEvent(
  companyId: string,
  rateId: string,
  action: DemoTaxRateEvent['action'],
  before: DemoTaxRate | null,
  after: DemoTaxRate | null,
): void {
  const s = loadState();
  s.taxRateEvents.push({
    id: uid(),
    company_id: companyId,
    tax_rate_id: rateId,
    action,
    actor_id: requireUser().id,
    before_state: demoRateSnapshot(before),
    after_state: demoRateSnapshot(after),
    created_at: now(),
  });
}

function demoCompanySettingsView(companyId: string) {
  const s = loadState();
  const ctx = requireCompany(companyId);
  const company = ctx.company;
  const settings = billingSettingsOf(companyId);
  const accounts = accountsOf(companyId);
  const journals = s.journals.filter((j) => j.company_id === companyId);
  const periods = s.periods
    .filter((p) => p.company_id === companyId)
    .sort((a, b) => b.start_date.localeCompare(a.start_date));
  const rates = s.taxRates
    .filter((r) => r.company_id === companyId)
    .sort((a, b) => b.effective_from.localeCompare(a.effective_from));
  const modules = effectiveModulesFor(companyId, ctx.user.id, ctx.role);
  const canEdit = modules.cabinet === 'admin';
  return {
    company: { id: company.id, status: company.status, locale: company.locale, createdAt: company.created_at },
    identification: {
      name: company.name,
      tradeName: company.trade_name ?? null,
      brn: company.brn,
      vatNumber: company.vat_number,
      registeredAddress: company.registered_address,
      businessActivity: company.business_activity,
      contactName: company.contact_name ?? null,
      contactEmail: company.contact_email ?? null,
      contactPhone: company.contact_phone ?? null,
      locale: company.locale,
    },
    accounting: {
      functionalCurrency: company.functional_currency,
      presentationCurrency: company.presentation_currency,
      accountingStandard: company.accounting_standard,
      financialYearStart: company.financial_year_start,
      financialYearEnd: company.financial_year_end,
      journals: journals.map((j) => ({ id: j.id, code: j.code, name: j.name, type: j.type, is_active: j.is_active })),
      periods: periods.map((p) => ({ id: p.id, name: p.name, start_date: p.start_date, end_date: p.end_date, status: p.status })),
      defaultAccounts: {
        revenue: settings.default_revenue_account_id ?? null,
        receivable: settings.default_receivable_account_id ?? null,
        bank: settings.default_bank_account_id ?? null,
        purchase: settings.default_purchase_account_id ?? null,
        vatInput: settings.default_vat_input_account_id ?? null,
        vatOutput: settings.default_vat_output_account_id ?? null,
      },
    },
    billing: {
      quotePrefix: settings.quote_prefix,
      invoicePrefix: settings.invoice_prefix,
      creditPrefix: settings.credit_prefix,
      numberingPolicy: settings.numbering_policy,
      defaultPaymentTerms: settings.default_payment_terms,
      defaultCurrency: settings.default_currency,
      documentLanguage: settings.document_language ?? 'fr',
      logoUrl: settings.logo_url ?? null,
      legalFooterFr: settings.legal_footer_fr,
      legalFooterEn: settings.legal_footer_en,
      bankDetails: settings.bank_details,
      defaultRevenueAccountId: settings.default_revenue_account_id ?? null,
      defaultReceivableAccountId: settings.default_receivable_account_id ?? null,
      defaultBankAccountId: settings.default_bank_account_id ?? null,
      defaultPurchaseAccountId: settings.default_purchase_account_id ?? null,
      defaultVatInputAccountId: settings.default_vat_input_account_id ?? null,
      defaultVatOutputAccountId: settings.default_vat_output_account_id ?? null,
    },
    tax: {
      vatEnabled: settings.vat_enabled,
      vatNumber: settings.vat_number,
      rates: rates.map(demoTaxRateView),
      verifiedCount: rates.filter((r) => r.verified).length,
      unverifiedCount: rates.filter((r) => !r.verified).length,
      notice:
        'Aucun taux n’est prérempli. Un taux non vérifié ne peut pas servir à émettre une facture fiscale ; le statut « vérifié » exige une source documentée et une validation humaine.',
    },
    chartOfAccounts: accounts.map((a) => ({
      id: a.id,
      code: a.code,
      name: a.name,
      type: a.type,
      is_active: a.is_active,
    })),
    history: s.audit
      .filter(
        (e) =>
          e.company_id === companyId &&
          (e.action.startsWith('settings.') || e.action.startsWith('billing.tax_rate.')),
      )
      .slice(0, 50)
      .map((e) => ({ id: e.id, action: e.action, userId: e.user_id, details: e.details, createdAt: e.created_at })),
    permissions: {
      canEditIdentification: canEdit,
      canEditAccounting: modules.accounting === 'admin',
      canEditBilling: modules.billing === 'admin',
      canEditTax: modules.billing === 'admin',
    },
    demo: true,
  };
}

interface DemoAssistantReply {
  content: string;
  toolKey: string | null;
  toolStatus: 'ok' | 'error' | 'denied' | 'none';
  data: Record<string, unknown>;
  actions: Record<string, unknown>[];
}

function demoAssistantContext(companyId: string, module: string, screen: string | null, locale: 'fr' | 'en') {
  const s = loadState();
  const ctx = requireCompany(companyId);
  return {
    module,
    screen,
    companyId,
    companyName: ctx.company.name,
    locale,
    permissions: effectiveModulesFor(companyId, ctx.user.id, ctx.role),
    objectRef: null,
  };
}

function demoExtractAmount(text: string): string | null {
  const match = /(\d{1,3}(?:[ \u00a0]\d{3})+|\d+)(?:[.,](\d{1,4}))?/.exec(text);
  if (!match) return null;
  const integer = match[1]!.replace(/[ \u00a0]/g, '');
  const fraction = (match[2] ?? '').padEnd(4, '0');
  const value = `${integer}.${fraction}`;
  return /^0+\.0*$/.test(value) ? null : value;
}

function demoOutstanding(doc: DemoBillingDocument): bigint {
  const due = amount(doc.total_amount) - amount(doc.amount_paid) - amount(doc.credited_amount);
  return due > 0n ? due : 0n;
}

/**
 * Deterministic demo router: one read-only tool per question, answered from the
 * demo records. Unsupported requests are refused explicitly.
 */
function demoAssistantAnswer(companyId: string, text: string, locale: 'fr' | 'en'): DemoAssistantReply {
  const s = loadState();
  const fr = locale === 'fr';
  const t = text.toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, ' ').trim();
  const no = (content: string): DemoAssistantReply => ({
    content,
    toolKey: null,
    toolStatus: 'none',
    data: {},
    actions: [],
  });

  if (/\b(migration|importer|import|excel|csv|sage|sap|xlsx)\b/.test(t)) {
    const jobs = s.migrationJobs.filter((j) => j.company_id === companyId);
    const open = jobs.filter((j) => !['imported', 'failed', 'cancelled'].includes(j.status));
    return {
      content: fr
        ? [
            `Lots de migration dans ce dossier : ${jobs.length} (dont ${open.length} en préparation).`,
            ...jobs.slice(0, 5).map(
              (j) => `• ${j.file_name} — ${j.import_kind} / ${j.status} — ${j.row_count} ligne(s)`,
            ),
            'Formats réellement pris en charge : CSV, TSV et XLSX (aucune macro ni formule exécutée). Les profils Sage 50/200/Accounting et SAP sont expérimentaux : fichiers d’export uniquement, aucune connexion directe et aucune certification.',
            'Les contrôles obligatoires (équilibre par écriture, comptes existants, dates, devises, doublons) sont déterministes et ne peuvent pas être contournés par une suggestion IA.',
            'L’assistant ne peut ni confirmer ni exécuter un import : seule la validation humaine dans « Importation & migration » le permet. Aucune donnée n’a été créée par cette réponse.',
          ].join('\n')
        : [
            `Migration jobs in this dossier: ${jobs.length} (${open.length} being prepared).`,
            ...jobs.slice(0, 5).map(
              (j) => `• ${j.file_name} — ${j.import_kind} / ${j.status} — ${j.row_count} row(s)`,
            ),
            'Formats actually supported: CSV, TSV and XLSX (no macro or formula is ever executed). Sage 50/200/Accounting and SAP profiles are experimental: export files only, no direct connection and no certification.',
            'Mandatory controls (balance per entry, existing accounts, dates, currencies, duplicates) are deterministic and can never be bypassed by an AI suggestion.',
            'The assistant can neither confirm nor run an import: only human validation in “Import & migration” can. No data was created by this answer.',
          ].join('\n'),
      toolKey: 'migration.jobs.summary',
      toolStatus: 'ok',
      data: { jobs: jobs.length, open: open.length },
      actions: [
        {
          kind: 'navigation',
          title: fr ? 'Ouvrir l’assistant de migration' : 'Open the migration assistant',
          description: fr
            ? 'Contrôler le fichier puis confirmer l’import manuellement.'
            : 'Review the file then confirm the import manually.',
          dataUsed: ['migration_jobs'],
          expected: fr ? 'Aucun changement sans validation humaine.' : 'No change without human validation.',
          risks: [],
          examineHref: '/cabinet/migration',
        },
      ],
    };
  }

  if (/\b(paie|payroll|bulletin|payslip|paye|csg|nsf)\b/.test(t)) {
    return {
      content: fr
        ? 'Le module Paie & RH est préparé mais non implémenté : aucun bulletin, aucun taux PAYE/CSG/NSF et aucune déclaration ne sont calculés. Aucune donnée de paie n’est lue ni inventée.'
        : 'The Payroll & HR module is prepared but not implemented: no payslip, PAYE/CSG/NSF rate or statutory declaration is computed. No payroll data is read or invented.',
      toolKey: 'payroll.status',
      toolStatus: 'ok',
      data: { implemented: false },
      actions: [],
    };
  }

  const prepare = /(pr[ée]pare|prepare|propose|proposer)/.test(t) && /([ée]criture|entry|achat|purchase)/.test(t);
  if (prepare) {
    const raw = demoExtractAmount(text);
    if (!raw) {
      return {
        content: fr
          ? 'Il manque une information pour préparer cette écriture : le montant (et sa devise) est obligatoire.\nAucune écriture n’a été créée. Exemple : « Prépare une écriture pour un achat de 3 250 MUR ».'
          : 'One piece of information is missing: the amount (and its currency).\nNo entry was created. Example: “Prepare an entry for a purchase of 3 250 MUR”.',
        toolKey: 'accounting.proposal.prepare',
        toolStatus: 'error',
        data: {},
        actions: [],
      };
    }
    const net = amount(raw);
    const accounts = accountsOf(companyId);
    const purchase =
      accounts.find((a) => a.type === 'expense' && /achat|marchandise/i.test(a.name)) ??
      accounts.find((a) => a.type === 'expense');
    const vat = accounts.find((a) => /tva r[ée]cup[ée]rable/i.test(a.name));
    const bank = accounts.find((a) => /banque/i.test(a.name) && a.type === 'asset');
    const vatRate = s.taxRates.find((r) => r.company_id === companyId && r.treatment === 'taxable');
    if (!purchase || !vat || !bank || !vatRate) {
      return {
        content: fr
          ? 'Des comptes nécessaires manquent dans le plan comptable (achat, TVA récupérable ou banque). Aucun compte n’a été inventé : choisissez les comptes avant de préparer l’écriture.'
          : 'Required accounts are missing (purchase, input VAT or bank). No account was invented: choose the accounts before preparing the entry.',
        toolKey: 'accounting.proposal.prepare',
        toolStatus: 'error',
        data: {},
        actions: [],
      };
    }
    const vatAmount = applyPct(net, amount(vatRate.rate));
    const total = net + vatAmount;
    const journal = demandJournal(companyId, ['purchases', 'general']);
    const proposal = demoCreateProposal(s, companyId, {
      source_kind: 'manual',
      source_id: null,
      journal_id: journal?.id ?? null,
      entry_date: todayIso(),
      reference: null,
      description: text.slice(0, 300),
      currency: 'MUR',
      exchange_rate: null,
      confidence: null,
      rationale: 'Démonstration : montants et comptes issus du dossier fictif.',
      warnings: [
        `TVA de démonstration ${fmt(amount(vatRate.rate))} % — paramètre fictif NON vérifié, sans valeur fiscale.`,
      ],
      missing: [],
      rule_trace: ['demo-assistant', 'chart-of-accounts'],
      provider: null,
      model: null,
      lines: [
        { account_id: purchase.id, description: 'Achat de marchandises (démo)', debit: net, credit: 0n },
        { account_id: vat.id, description: 'TVA récupérable (démo, non vérifiée)', debit: vatAmount, credit: 0n },
        { account_id: bank.id, description: 'Règlement banque (démo)', debit: 0n, credit: total },
      ],
    });
    const view = demoProposalView(proposal);
    return {
      content: [
        fr ? `Proposition préparée : « ${proposal.description} ».` : `Proposal prepared: "${proposal.description}".`,
        ...view.lines.map(
          (l: any) =>
            `• ${l.accountCode} ${l.accountName} — ${fr ? 'débit' : 'debit'} ${l.debit}, ${fr ? 'crédit' : 'credit'} ${l.credit}`,
        ),
        fr
          ? `Équilibrée : ${view.totals.debit} au débit et au crédit.`
          : `Balanced: ${view.totals.debit} debit and credit.`,
        fr
          ? 'TVA de démonstration NON vérifiée : ce taux fictif ne peut pas servir à émettre une facture fiscale.'
          : 'Demonstration VAT rate NOT verified: this fictional rate cannot be used to issue a fiscal invoice.',
        fr
          ? 'Aucune écriture comptable n’a été créée : validation puis comptabilisation humaines requises.'
          : 'No accounting entry was created: human validation then posting are required.',
      ].join('\n'),
      toolKey: 'accounting.proposal.prepare',
      toolStatus: 'ok',
      data: { proposal: view, entryCreated: false },
      actions: [
        {
          kind: 'proposal',
          id: proposal.id,
          title: { fr: 'Examiner la proposition d’écriture', en: 'Review the entry proposal' },
          description: { fr: proposal.description, en: proposal.description },
          dataUsed: ['plan comptable fictif', 'taux de démonstration'],
          expected: {
            fr: 'Proposition éditable, sans impact comptable tant qu’elle n’est pas comptabilisée.',
            en: 'Editable proposal, with no accounting impact until it is posted.',
          },
          risks: view.warnings,
          examineHref: `/cabinet/ai-proposals?proposal=${proposal.id}`,
        },
      ],
    };
  }

  if (/(v[ée]rifie|check|pourquoi|why|[ée]quilibr|balanc)/.test(t) && /(proposition|proposal|[ée]criture|entry)/.test(t)) {
    const proposal = s.entryProposals
      .filter((p) => p.company_id === companyId && (p.status === 'proposed' || p.status === 'validated'))
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0];
    if (!proposal) {
      return no(
        fr
          ? 'Aucune proposition d’écriture à vérifier pour ce dossier.'
          : 'No entry proposal to check for this dossier.',
      );
    }
    const view = demoProposalView(proposal);
    const blocking = view.checks.filter((c: any) => !c.ok && c.severity === 'error');
    return {
      content: [
        fr
          ? `Proposition « ${view.description} » : ${view.totals.balanced ? 'équilibrée' : 'déséquilibrée'} (${view.totals.debit} au débit).`
          : `Proposal "${view.description}": ${view.totals.balanced ? 'balanced' : 'unbalanced'} (${view.totals.debit} debit).`,
        blocking.length === 0
          ? fr
            ? 'Aucun contrôle bloquant.'
            : 'No blocking check.'
          : `${fr ? 'Contrôles bloquants' : 'Blocking checks'} : ${blocking.map((c: any) => c.label).join(', ')}.`,
        fr
          ? 'Aucune écriture n’a été créée : la validation et la comptabilisation restent des actions humaines séparées.'
          : 'No entry was created: validation and posting remain separate human actions.',
      ].join('\n'),
      toolKey: 'accounting.proposal.check',
      toolStatus: 'ok',
      data: { proposal: view },
      actions: [
        {
          kind: 'proposal',
          id: proposal.id,
          title: { fr: 'Examiner la proposition', en: 'Review the proposal' },
          description: { fr: proposal.description, en: proposal.description },
          dataUsed: ['propositions de démonstration'],
          expected: {
            fr: 'Aucune écriture tant que vous ne validez pas puis ne comptabilisez pas explicitement.',
            en: 'No entry until you explicitly validate and then post.',
          },
          risks: view.warnings,
          examineHref: `/cabinet/ai-proposals?proposal=${proposal.id}`,
        },
      ],
    };
  }

  if (/(impay[ée]|unpaid|outstanding|reste d[ûu])/.test(t) && /(facture|invoice)/.test(t)) {
    const invoices = s.billingDocuments
      .filter(
        (d) =>
          d.company_id === companyId &&
          d.kind === 'invoice' &&
          d.status !== 'draft' &&
          d.status !== 'cancelled' &&
          demoOutstanding(d) > 0n,
      )
      .sort((a, b) => b.issue_date.localeCompare(a.issue_date));
    const total = invoices.reduce((acc, d) => acc + demoOutstanding(d), 0n);
    return {
      content:
        invoices.length === 0
          ? fr
            ? 'Aucune facture impayée : tous les soldes sont à zéro.'
            : 'No unpaid invoice: every balance is zero.'
          : [
              fr
                ? `${invoices.length} facture(s) impayée(s), total dû ${fmt(total)} :`
                : `${invoices.length} unpaid invoice(s), total due ${fmt(total)}:`,
              ...invoices.map(
                (d) =>
                  `• ${d.doc_no ?? (fr ? '(brouillon)' : '(draft)')} — ${d.customer_name ?? ''} — ${d.total_amount} ${d.currency}, ${fr ? 'reste dû' : 'outstanding'} ${fmt(demoOutstanding(d))}`,
              ),
              fr
                ? 'Données lues dans le dossier fictif. Aucune écriture comptable n’a été créée.'
                : 'Data read from the fictional dossier. No accounting entry was created.',
            ].join('\n'),
      toolKey: 'billing.invoices.unpaid',
      toolStatus: 'ok',
      data: { invoices: invoices.map((d) => ({ id: d.id, number: d.doc_no, outstanding: fmt(demoOutstanding(d)) })), totalOutstanding: fmt(total) },
      actions: [
        {
          kind: 'navigation',
          title: { fr: 'Ouvrir les factures', en: 'Open the invoices' },
          description: { fr: 'Voir ces factures dans la Facturation.', en: 'See these invoices in Billing.' },
          dataUsed: ['billing_documents'],
          expected: { fr: 'Aucun changement de données.', en: 'No data change.' },
          risks: [],
          examineHref: '/billing/invoices',
        },
      ],
    };
  }

  if (/(facture|invoice)/.test(t) && /(recherch|search|trouv|find|retrouv|montre|affiche|show)/.test(t)) {
    const term = text.replace(/[^A-Za-z0-9- ]/g, ' ').split(/\s+/).find((w) => /^FAC|^DEV|^AV|^\w{4,}$/i.test(w) && /[0-9-]/.test(w));
    const found = s.billingDocuments
      .filter((d) => d.company_id === companyId && d.kind === 'invoice')
      .filter((d) => (term ? `${d.doc_no ?? ''} ${d.customer_name ?? ''}`.toLowerCase().includes(term.toLowerCase()) : true))
      .slice(0, 10);
    return {
      content:
        found.length === 0
          ? fr
            ? 'Aucune facture ne correspond à cette recherche dans ce dossier fictif.'
            : 'No invoice matches this search in this fictional dossier.'
          : found
              .map(
                (d) =>
                  `• ${d.doc_no ?? (fr ? '(brouillon)' : '(draft)')} — ${d.customer_name ?? ''} — ${d.total_amount} ${d.currency} (${d.status})`,
              )
              .join('\n'),
      toolKey: 'billing.invoices.search',
      toolStatus: 'ok',
      data: { invoices: found.map((d) => ({ id: d.id, number: d.doc_no, status: d.status })) },
      actions: [],
    };
  }

  if (/(solde|balance)/.test(t) && /(client|customer)/.test(t)) {
    const customers = s.billingCustomers.filter((c) => c.company_id === companyId);
    const rows = customers.map((c) => {
      const docs = s.billingDocuments.filter(
        (d) => d.company_id === companyId && d.kind === 'invoice' && d.customer_id === c.id && d.status !== 'draft' && d.status !== 'cancelled',
      );
      const due = docs.reduce((acc, d) => acc + demoOutstanding(d), 0n);
      return { name: c.name, outstanding: due };
    });
    return {
      content: rows.length === 0
        ? fr ? 'Aucun client dans ce dossier.' : 'No customer in this dossier.'
        : rows.map((r) => `• ${r.name} — ${fr ? 'solde dû' : 'outstanding'} ${fmt(r.outstanding)}`).join('\n'),
      toolKey: 'billing.customers.balance',
      toolStatus: 'ok',
      data: { customers: rows.map((r) => ({ name: r.name, outstanding: fmt(r.outstanding) })) },
      actions: [],
    };
  }

  if (/(encaissement|payment|r[èe]glement|received)/.test(t)) {
    const payments = s.billingPayments
      .filter((p) => p.company_id === companyId)
      .sort((a, b) => b.payment_date.localeCompare(a.payment_date))
      .slice(0, 10);
    return {
      content: payments.length === 0
        ? fr ? 'Aucun encaissement enregistré pour ce dossier.' : 'No payment recorded for this dossier.'
        : payments.map((p) => `• ${p.payment_date} — ${p.payment_no} — ${p.amount} ${p.currency}`).join('\n'),
      toolKey: 'billing.payments.recent',
      toolStatus: 'ok',
      data: { payments: payments.map((p) => ({ id: p.id, number: p.payment_no, amount: p.amount })) },
      actions: [],
    };
  }

  if (/(attente|pending|validation|approval)/.test(t)) {
    const drafts = s.billingDocuments.filter((d) => d.company_id === companyId && d.status === 'draft').length;
    const proposals = s.entryProposals.filter((p) => p.company_id === companyId && (p.status === 'proposed' || p.status === 'validated')).length;
    return {
      content: [
        fr ? `Brouillons de documents : ${drafts}.` : `Draft documents: ${drafts}.`,
        fr ? `Propositions d’écriture à examiner : ${proposals}.` : `Entry proposals awaiting review: ${proposals}.`,
        fr ? 'Aucune écriture créée automatiquement.' : 'No entry created automatically.',
      ].join('\n'),
      toolKey: 'billing.approvals.pending',
      toolStatus: 'ok',
      data: { drafts, proposals },
      actions: [
        {
          kind: 'navigation',
          title: { fr: 'Examiner les propositions', en: 'Review the proposals' },
          description: { fr: 'Ouvrir l’écran des propositions d’écriture.', en: 'Open the entry proposals screen.' },
          dataUsed: ['ai_entry_proposals'],
          expected: { fr: 'Aucune écriture créée automatiquement.', en: 'No entry created automatically.' },
          risks: [],
          examineHref: '/cabinet/ai-proposals',
        },
      ],
    };
  }

  if (/(retard|overdue|late)/.test(t) && /(t[âa]che|task|todo)/.test(t)) {
    const open = s.tasks.filter(
      (x) => x.company_id === companyId && ['todo', 'in_progress', 'blocked'].includes(x.status),
    );
    const late = open.filter((x) => x.due_date && x.due_date < todayIso());
    return {
      content:
        late.length === 0
          ? fr ? 'Aucune tâche en retard pour ce dossier fictif.' : 'No overdue task in this fictional dossier.'
          : [
              fr ? `${late.length} tâche(s) en retard :` : `${late.length} overdue task(s):`,
              ...late.map((x) => `• ${x.title} — ${fr ? 'échéance' : 'due'} ${x.due_date}`),
            ].join('\n'),
      toolKey: 'cabinet.tasks.overdue',
      toolStatus: 'ok',
      data: { tasks: late.map((x) => ({ id: x.id, title: x.title, dueDate: x.due_date })) },
      actions: [
        {
          kind: 'navigation',
          title: { fr: 'Ouvrir les tâches', en: 'Open the tasks' },
          description: { fr: 'Retrouver ces tâches dans l’écran Tâches.', en: 'Find these tasks in the Tasks screen.' },
          dataUsed: ['cabinet_tasks'],
          expected: { fr: 'Aucun changement de données.', en: 'No data change.' },
          risks: [],
          examineHref: '/cabinet/tasks',
        },
      ],
    };
  }

  if (/([ée]ch[ée]ance|deadline|agenda|due date)/.test(t)) {
    const tasks = s.tasks.filter((x) => x.company_id === companyId && x.due_date && x.status !== 'done' && x.status !== 'cancelled');
    const periods = s.periods.filter((p) => p.company_id === companyId && p.status === 'open');
    return {
      content: [
        ...tasks.map((x) => `• ${x.due_date} — ${x.title}`),
        ...periods.map((p) => `${fr ? 'Exercice ouvert' : 'Open period'} : ${p.name} (${p.start_date} → ${p.end_date}).`),
      ].join('\n') || (fr ? 'Aucune échéance enregistrée.' : 'No recorded deadline.'),
      toolKey: 'cabinet.deadlines',
      toolStatus: 'ok',
      data: { tasks: tasks.length, periods: periods.length },
      actions: [],
    };
  }

  if (/(t[âa]che|task|todo|à faire|a faire)/.test(t)) {
    const open = s.tasks.filter((x) => x.company_id === companyId && ['todo', 'in_progress', 'blocked'].includes(x.status));
    return {
      content:
        open.length === 0
          ? fr ? 'Aucune tâche ouverte pour ce dossier.' : 'No open task for this dossier.'
          : [
              fr ? `${open.length} tâche(s) ouverte(s) :` : `${open.length} open task(s):`,
              ...open.map((x) => `• ${x.title} — ${x.status}${x.due_date ? `, ${fr ? 'échéance' : 'due'} ${x.due_date}` : ''}`),
            ].join('\n'),
      toolKey: 'cabinet.tasks.open',
      toolStatus: 'ok',
      data: { tasks: open.map((x) => ({ id: x.id, title: x.title, status: x.status })) },
      actions: [],
    };
  }

  if (/(soci[ée]t[ée]s|companies|dossiers)/.test(t) && /(liste|list|recherch|search|accessible|mes)/.test(t)) {
    const rows = s.companies.filter((c) => s.members.some((m) => m.company_id === c.id && m.user_id === requireUser().id));
    return {
      content: rows.map((c) => `• ${c.name}${c.brn ? ` (BRN ${c.brn})` : ''}`).join('\n'),
      toolKey: 'cabinet.companies',
      toolStatus: 'ok',
      data: { companies: rows.map((c) => ({ id: c.id, name: c.name })) },
      actions: [],
    };
  }

  if (/(compte|account)/.test(t) && /(recherch|search|trouv|find|cherch|quel|which)/.test(t)) {
    const code = /\b\d{3,10}\b/.exec(t)?.[0];
    const term = (code ?? t.replace(/[^a-zA-Zà-ÿ ]/g, ' ').split(/\s+/).filter((w) => w.length > 3).pop() ?? '').toLowerCase();
    const rows = accountsOf(companyId).filter((a) =>
      code ? a.code === code : `${a.code} ${a.name}`.toLowerCase().includes(term),
    );
    return {
      content:
        rows.length === 0
          ? fr ? 'Aucun compte ne correspond dans ce plan comptable fictif.' : 'No account matches in this fictional chart.'
          : rows.map((a) => `${a.code} — ${a.name} (${a.type})`).join('\n'),
      toolKey: 'accounting.accounts.search',
      toolStatus: 'ok',
      data: { accounts: rows.map((a) => ({ code: a.code, name: a.name })) },
      actions: [],
    };
  }

  if (/balance|trial balance/.test(t)) {
    let debit = 0n;
    let credit = 0n;
    for (const entry of s.entries.filter((e) => e.company_id === companyId && e.status === 'posted')) {
      for (const line of s.lines.filter((l) => l.entry_id === entry.id)) {
        debit += amount(line.debit);
        credit += amount(line.credit);
      }
    }
    return {
      content: [
        fr ? `Balance : débit ${fmt(debit)}, crédit ${fmt(credit)} MUR.` : `Trial balance: debit ${fmt(debit)}, credit ${fmt(credit)} MUR.`,
        debit === credit ? (fr ? 'La balance est équilibrée.' : 'The trial balance is balanced.') : fr ? 'La balance n’est pas équilibrée.' : 'The trial balance is not balanced.',
      ].join('\n'),
      toolKey: 'accounting.trialBalance',
      toolStatus: 'ok',
      data: { debit: fmt(debit), credit: fmt(credit), balanced: debit === credit },
      actions: [],
    };
  }

  return no(
    fr
      ? [
          'Cette demande n’est pas encore prise en charge par l’assistant de démonstration.',
          'Demandes disponibles : factures impayées, recherche de facture, solde client, encaissements récents, tâches (dont retards), échéances, sociétés accessibles, recherche de compte, balance, vérification d’une proposition, préparation d’une écriture, état de la paie.',
          'Aucune donnée n’a été inventée et aucune opération n’a été exécutée.',
        ].join('\n')
      : [
          'This request is not supported by the demonstration assistant yet.',
          'Supported requests: unpaid invoices, invoice search, customer balance, recent payments, tasks (including overdue), deadlines, accessible companies, account search, trial balance, proposal check, entry preparation, payroll status.',
          'No data was invented and no operation was executed.',
        ].join('\n'),
  );
}

/** Maps the stable codes thrown by the demo migration engine to API errors. */
const MIGRATION_ERRORS: Record<string, [number, string]> = {
  MIGRATION_JOB_NOT_FOUND: [404, 'Lot de migration introuvable.'],
  MIGRATION_BLOCKED: [400, 'Des erreurs bloquent cet import : rien n’a été créé.'],
  MIGRATION_ALREADY_IMPORTED: [409, 'Ce lot a déjà été importé.'],
  MIGRATION_INVALID_MAPPING: [400, 'Correspondance de colonnes invalide.'],
  MIGRATION_SHEET_NOT_FOUND: [400, 'Feuille Excel introuvable.'],
  MIGRATION_FILE_TOO_LARGE: [400, 'Fichier trop volumineux (5 Mo maximum en démonstration).'],
  MIGRATION_TOO_MANY_ROWS: [400, 'Trop de lignes (5 000 maximum en démonstration).'],
  MIGRATION_EMPTY: [400, 'Le fichier est vide.'],
  MIGRATION_IMPORT_FAILED: [409, 'Import interrompu : aucune donnée partielle n’a été conservée.'],
  MIGRATION_TEMPLATE_NOT_FOUND: [404, 'Modèle introuvable.'],
  UNSUPPORTED_FORMAT: [400, 'Format non pris en charge. Utilisez .csv, .tsv ou .xlsx.'],
  MALFORMED_FILE: [400, 'Fichier illisible ou corrompu.'],
  EMPTY_FILE: [400, 'Le fichier est vide.'],
  NO_TABLE: [400, 'Aucun tableau exploitable dans ce fichier.'],
  ENCRYPTED_FILE: [400, 'Classeur protégé ou illisible.'],
  JOURNAL_NOT_FOUND: [400, 'Journal inexistant dans cette société.'],
};

function migrationGuard<T>(fn: () => T): T {
  try {
    return fn();
  } catch (err) {
    const code = (err as Error).message;
    const mapped = MIGRATION_ERRORS[code];
    if (mapped) throw new ApiError(mapped[0], code, mapped[1]);
    throw err;
  }
}

/** The demo import already mutates state; this keeps the persistence explicit. */
function persistAfterImport(): void {
  persist();
}

/** Injection-safe CSV of a demo import report (same rule as the API export). */
function migrationReportCsv(job: DemoMigrationJob): string {
  const escape = (value: string | number | null | undefined): string => {
    if (value === null || value === undefined) return '';
    let text = String(value);
    if (!/^-?\d+(\.\d+)?$/.test(text) && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
    return /[",;\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const report = job.report;
  const rows: (string | number | null)[][] = [
    ['Rapport d’importation (démonstration) / Import report (demo)'],
    ['Champ', 'Valeur'],
    ['Fichier / File', job.file_name],
    ['Source', job.source],
    ['Type', job.import_kind],
    ['Statut / Status', job.status],
    ['Clé d’idempotence', job.idempotency_key],
  ];
  if (report) {
    rows.push(['Date / Date', report.importedAt]);
    rows.push(['Créés / Created', report.counts.created]);
    rows.push(['Ignorés / Skipped', report.counts.skipped]);
    rows.push(['Conflits / Conflicts', report.counts.conflicts]);
    if (report.totals) {
      rows.push(['Total débit', report.totals.debit]);
      rows.push(['Total crédit', report.totals.credit]);
      rows.push(['Écart', report.totals.difference]);
    }
    for (const line of report.createdSamples) rows.push(['Créé', line]);
    for (const conflict of report.conflicts) rows.push(['Conflit', conflict.message]);
  }
  return '\uFEFF' + rows.map((r) => r.map(escape).join(';')).join('\r\n') + '\r\n';
}

export function demoRequest<T>(method: Method, rawPath: string, body?: unknown): T {
  const [path, search] = rawPath.split('?');
  const query = new URLSearchParams(search ?? '');
  const s = loadState();
  const p = path ?? '';
  const payload = (body ?? {}) as Record<string, any>;

  // ---------------------------------------------------------------- auth
  if (p === '/auth/login' && method === 'POST') {
    const user = s.users.find(
      (u) => u.email.toLowerCase() === String(payload.email ?? '').trim().toLowerCase(),
    );
    if (!user || user.password !== String(payload.password ?? '')) {
      throw new ApiError(401, 'INVALID_CREDENTIALS', 'Identifiants incorrects');
    }
    s.session = user.id;
    if (payload.locale === 'fr' || payload.locale === 'en') user.locale = payload.locale;
    audit(null, 'user.login', 'user', user.id);
    persist();
    return { user: publicUser(user) } as T;
  }

  if (p === '/auth/register' && method === 'POST') {
    const email = String(payload.email ?? '').trim();
    const password = String(payload.password ?? '');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Adresse e-mail invalide');
    }
    if (password.length < 10) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Mot de passe trop court (10 caractères minimum)');
    }
    if (s.users.some((u) => u.email.toLowerCase() === email.toLowerCase())) {
      throw new ApiError(409, 'CONFLICT', 'Un compte existe déjà avec cette adresse');
    }
    const user: DemoUser = {
      id: uid(),
      email,
      password,
      full_name: String(payload.fullName ?? 'Utilisateur démo'),
      locale: (payload.locale as 'fr' | 'en') ?? 'fr',
    };
    s.users.push(user);
    s.session = user.id;
    audit(null, 'user.register', 'user', user.id);
    persist();
    return { user: publicUser(user) } as T;
  }

  if (p === '/auth/logout' && method === 'POST') {
    const user = currentUser();
    s.session = null;
    if (user) audit(null, 'user.logout', 'user', user.id);
    persist();
    return { ok: true } as T;
  }

  if (p === '/auth/me' && method === 'GET') {
    return { user: publicUser(requireUser()) } as T;
  }

  if (p === '/auth/me' && method === 'PATCH') {
    const user = requireUser();
    if (payload.fullName) user.full_name = String(payload.fullName).trim();
    if (payload.locale === 'fr' || payload.locale === 'en') user.locale = payload.locale;
    let sessionsInvalidated = false;
    if (payload.newPassword) {
      if (user.password !== String(payload.currentPassword ?? '')) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Mot de passe actuel incorrect');
      }
      if (String(payload.newPassword).length < 10) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Mot de passe trop court (10 caractères minimum)');
      }
      user.password = String(payload.newPassword);
      s.session = null;
      sessionsInvalidated = true;
    }
    audit(null, 'user.update', 'user', user.id);
    persist();
    return { user: publicUser(user), sessionsInvalidated } as T;
  }


  // ------------------------------------------------------------- cabinet
  if (p === '/cabinet/dashboard' && method === 'GET') {
    return cabinetDashboard(s, requireUser()) as T;
  }

  if (p === '/cabinet/companies' && method === 'GET') {
    const user = requireUser();
    const status = query.get('status');
    const search = (query.get('search') ?? '').toLowerCase();
    const manager = query.get('manager');
    const rows = s.members
      .filter((m) => m.user_id === user.id)
      .map((m) => {
        const company = s.companies.find((c) => c.id === m.company_id);
        if (!company) return null;
        const modules = effectiveModulesFor(company.id, user.id, m.role);
        if (modules.cabinet === 'none') return null;
        const dossierManager = s.users.find((u) => u.id === company.dossier_manager_id);
        return {
          ...company,
          role: m.role,
          modules,
          dossier_manager_name: dossierManager?.full_name ?? null,
          open_tasks: s.tasks.filter(
            (t) => t.company_id === company.id && OPEN_TASK_STATUSES.includes(t.status),
          ).length,
        };
      })
      .filter((c): c is NonNullable<typeof c> => !!c)
      .filter((c) => (status && status !== 'all' ? c.status === status : true))
      .filter((c) => (manager ? c.dossier_manager_id === manager : true))
      .filter((c) =>
        search
          ? `${c.name} ${c.brn ?? ''} ${c.client_code ?? ''}`.toLowerCase().includes(search)
          : true,
      )
      .sort((a, b) => a.name.localeCompare(b.name));
    return { companies: rows } as T;
  }

  const cabinetMatch = /^\/cabinet\/companies\/([0-9a-f-]{36})(?:\/(archive|unarchive|members))?(?:\/([0-9a-f-]{36}))?$/.exec(p);
  if (cabinetMatch) {
    const companyId = cabinetMatch[1]!;
    const action = cabinetMatch[2];
    const memberId = cabinetMatch[3];

    if (action === 'archive' && method === 'POST') {
      const ctx = requireModule(companyId, 'cabinet', 'admin', true);
      ctx.company.status = 'archived';
      ctx.company.archived_at = now();
      audit(companyId, 'cabinet.archive', 'company', companyId);
      persist();
      return { company: ctx.company } as T;
    }

    if (action === 'unarchive' && method === 'POST') {
      const ctx = requireModule(companyId, 'cabinet', 'admin', true);
      ctx.company.status = 'active';
      ctx.company.archived_at = null;
      audit(companyId, 'cabinet.unarchive', 'company', companyId);
      persist();
      return { company: ctx.company } as T;
    }

    if (action === 'members' && memberId && method === 'PATCH') {
      requireModule(companyId, 'cabinet', 'admin', true);
      const member = s.members.find((m) => m.company_id === companyId && m.user_id === memberId);
      if (!member) throw new ApiError(404, 'MEMBER_NOT_FOUND', 'Collaborateur introuvable');
      if (typeof payload.role === 'string' && member.role !== 'owner') member.role = payload.role;
      if (payload.isActive !== undefined) {
        const target = s.users.find((u) => u.id === memberId);
        if (target) (target as DemoUser & { is_active?: boolean }).is_active = !!payload.isActive;
      }
      if (payload.modules && typeof payload.modules === 'object') {
        for (const [module, access] of Object.entries(payload.modules as Record<string, string>)) {
          s.moduleAccess = (s.moduleAccess ?? []).filter(
            (g) => !(g.company_id === companyId && g.user_id === memberId && g.module === module),
          );
          if (access !== 'none') {
            s.moduleAccess.push({
              company_id: companyId,
              user_id: memberId,
              module: module as ModuleKey,
              access: access as 'read' | 'write' | 'admin',
            });
          }
        }
      }
      audit(companyId, 'cabinet.member.update', 'user', memberId, { role: payload.role });
      persist();
      return {
        member: {
          userId: memberId,
          role: member.role,
          modules: effectiveModulesFor(companyId, memberId, member.role),
        },
      } as T;
    }

    if (!action && method === 'GET') {
      requireModule(companyId, 'cabinet', 'read');
      const company = s.companies.find((c) => c.id === companyId)!;
      const myMember = s.members.find(
        (m) => m.company_id === companyId && m.user_id === requireUser().id,
      )!;
      const manager = s.users.find((u) => u.id === company.dossier_manager_id) ?? null;
      const members = s.members
        .filter((m) => m.company_id === companyId)
        .map((m) => ({
          ...m,
          is_active: true,
          modules: effectiveModulesFor(companyId, m.user_id, m.role),
        }));
      const tasks = s.tasks
        .filter((t) => t.company_id === companyId)
        .sort((a, b) => String(a.due_date ?? '9999').localeCompare(String(b.due_date ?? '9999')))
        .map((t) => taskView(s, t));
      const openTasks = tasks.filter((t) => OPEN_TASK_STATUSES.includes(t.status));
      return {
        company,
        manager: manager
          ? { id: manager.id, full_name: manager.full_name, email: manager.email }
          : null,
        role: myMember.role,
        modules: effectiveModulesFor(companyId, requireUser().id, myMember.role),
        members,
        tasks,
        openTasks,
        recentActivity: s.audit
          .filter((a) => a.company_id === companyId)
          .slice(-15)
          .reverse()
          .map((a) => ({
            id: a.id,
            action: a.action,
            entity_type: a.entity_type,
            entity_id: a.entity_id,
            created_at: a.created_at,
            user_name: a.user_email,
          })),
        counts: {
          entries: s.entries.filter((e) => e.company_id === companyId).length,
          accounts: accountsOf(companyId).length,
          openTasks: openTasks.length,
          collaborators: members.length,
        },
      } as T;
    }

    if (!action && method === 'PATCH') {
      requireModule(companyId, 'cabinet', 'admin');
      const company = s.companies.find((c) => c.id === companyId)!;
      if (payload.dossierManagerId !== undefined) {
        company.dossier_manager_id = payload.dossierManagerId || null;
      }
      if (payload.clientCode !== undefined) company.client_code = payload.clientCode || null;
      if (payload.crn !== undefined) company.crn = payload.crn || null;
      audit(companyId, 'cabinet.dossier.update', 'company', companyId, {
        fields: Object.keys(payload),
      });
      persist();
      return { company } as T;
    }
  }

  if (p === '/cabinet/tasks' && method === 'GET') {
    const user = requireUser();
    const visible = new Set(
      s.members
        .filter((m) => m.user_id === user.id)
        .filter((m) => effectiveModulesFor(m.company_id, user.id, m.role).cabinet !== 'none')
        .map((m) => m.company_id),
    );
    const status = query.get('status');
    const category = query.get('category');
    const companyId = query.get('companyId');
    const assignedTo = query.get('assignedTo');
    const overdue = query.get('overdue') === '1';
    const today = todayIso();
    const rows = s.tasks
      .filter((t) => visible.has(t.company_id))
      .filter((t) => (companyId ? t.company_id === companyId : true))
      .filter((t) => (status && status !== 'all' ? t.status === status : true))
      .filter((t) => (category && category !== 'all' ? t.category === category : true))
      .filter((t) => (assignedTo ? t.assigned_to === assignedTo : true))
      .filter((t) => (overdue ? !!t.due_date && t.due_date < today && OPEN_TASK_STATUSES.includes(t.status) : true))
      .sort((a, b) => {
        const aDone = ['done', 'cancelled'].includes(a.status) ? 1 : 0;
        const bDone = ['done', 'cancelled'].includes(b.status) ? 1 : 0;
        if (aDone !== bDone) return aDone - bDone;
        return String(a.due_date ?? '9999').localeCompare(String(b.due_date ?? '9999'));
      })
      .map((t) => taskView(s, t));
    return { tasks: rows } as T;
  }

  if (p === '/cabinet/team' && method === 'GET') {
    const user = requireUser();
    const visible = new Set(
      s.members
        .filter((m) => m.user_id === user.id)
        .filter((m) => effectiveModulesFor(m.company_id, user.id, m.role).cabinet !== 'none')
        .map((m) => m.company_id),
    );
    const byUser = new Map<
      string,
      {
        userId: string;
        fullName: string;
        email: string;
        isActive: boolean;
        assignments: { companyId: string; companyName: string; role: string }[];
      }
    >();
    for (const member of s.members.filter((m) => visible.has(m.company_id))) {
      const entry = byUser.get(member.user_id) ?? {
        userId: member.user_id,
        fullName: member.full_name,
        email: member.email,
        isActive: true,
        assignments: [],
      };
      entry.assignments.push({
        companyId: member.company_id,
        companyName: s.companies.find((c) => c.id === member.company_id)?.name ?? '',
        role: member.role,
      });
      byUser.set(member.user_id, entry);
    }
    return { collaborators: [...byUser.values()] } as T;
  }


  // --------------------------------------------------------------- AI (demo)
  if (p === '/cabinet/ai/settings' && method === 'GET') {
    requireCabinetAdminDemo(s);
    return aiSettingsView(s) as T;
  }

  if (p === '/cabinet/ai/settings' && method === 'PATCH') {
    requireCabinetAdminDemo(s);
    const patch = payload as Record<string, any>;
    const resolve = (ref: any) => {
      if (ref === undefined) return undefined;
      if (ref === null) return null;
      const definition = providerByKey(String(ref.provider ?? ''));
      if (!definition) throw new ApiError(400, 'AI_PROVIDER_NOT_ALLOWED', 'Fournisseur inconnu');
      const model = ref.model ?? definition.models[0]?.id ?? null;
      if (definition.models.length > 0 && !definition.models.some((mm) => mm.id === model)) {
        throw new ApiError(400, 'AI_MODEL_NOT_ALLOWED', 'Modèle inconnu pour ce fournisseur');
      }
      return { provider: definition.key, model };
    };
    const primary = resolve(patch.primary);
    const fallback = resolve(patch.fallback);
    if (patch.enabled !== undefined) s.ai.enabled = Boolean(patch.enabled);
    if (patch.routingMode !== undefined) {
      if (!['manual', 'automatic'].includes(patch.routingMode)) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Mode de routage invalide');
      }
      s.ai.routingMode = patch.routingMode;
    }
    if (primary !== undefined) {
      s.ai.primaryProvider = primary?.provider ?? null;
      s.ai.primaryModel = primary?.model ?? null;
    }
    if (fallback !== undefined) {
      s.ai.fallbackProvider = fallback?.provider ?? null;
      s.ai.fallbackModel = fallback?.model ?? null;
    }
    if (patch.monthlyBudgetUsd !== undefined) {
      s.ai.monthlyBudgetUsd =
        patch.monthlyBudgetUsd === null ? null : String(patch.monthlyBudgetUsd);
    }
    if (patch.monthlyRequestLimit !== undefined) {
      s.ai.monthlyRequestLimit =
        patch.monthlyRequestLimit === null ? null : Number(patch.monthlyRequestLimit);
    }
    if (patch.alertThreshold !== undefined) s.ai.alertThreshold = Number(patch.alertThreshold);
    if (patch.features) {
      for (const [key, value] of Object.entries(patch.features)) {
        if (!['accounting', 'billing', 'payroll', 'cabinet'].includes(key)) {
          throw new ApiError(400, 'AI_FEATURE_UNKNOWN', 'Module inconnu');
        }
        s.ai.features[key] = Boolean(value);
      }
    }
    audit(null, 'ai.settings.update', 'ai_settings', null, { enabled: s.ai.enabled });
    persist();
    return aiSettingsView(s) as T;
  }

  const aiCredentialMatch = /^\/cabinet\/ai\/credentials\/([a-z0-9_-]+)$/.exec(p);
  if (aiCredentialMatch) {
    requireCabinetAdminDemo(s);
    const provider = aiCredentialMatch[1]!;
    if (method === 'PUT') {
      // Deliberate refusal: the browser demonstration never accepts a key.
      throw new ApiError(
        400,
        'DEMO_KEY_NOT_ACCEPTED',
        'La démonstration n’accepte aucune clé API réelle. Utilisez le fournisseur fictif.',
      );
    }
    if (method === 'DELETE') {
      if (s.ai.credentials[provider]) {
        s.ai.credentials[provider] = { configured: false, updatedAt: now() };
      }
      audit(null, 'ai.credential.delete', 'ai_credential', null, { provider });
      persist();
      return { provider, configured: false } as T;
    }
  }

  if (p === '/cabinet/ai/test-connection' && method === 'POST') {
    requireCabinetAdminDemo(s);
    const provider = String(payload.provider ?? 'simulated');
    if (!providerByKey(provider)) {
      throw new ApiError(400, 'AI_PROVIDER_NOT_ALLOWED', 'Fournisseur inconnu');
    }
    if (provider !== 'simulated') {
      throw new ApiError(
        400,
        'DEMO_KEY_NOT_ACCEPTED',
        'Démonstration : aucun appel externe. Seul le fournisseur fictif peut être testé.',
      );
    }
    return {
      ok: true,
      provider: 'simulated',
      model: 'simulated-fictif',
      latencyMs: 0,
      simulated: true,
    } as T;
  }

  if (p === '/cabinet/ai/usage' && method === 'GET') {
    requireCabinetAdminDemo(s);
    return aiUsageSummary(s) as T;
  }

  if (p === '/cabinet/ai/capabilities' && method === 'GET') {
    requireCabinetAdminDemo(s);
    return {
      providers: AI_PROVIDERS.map((x) => ({
        key: x.key,
        label: x.label,
        adapter: x.key === 'simulated' ? 'simulated' : 'openai',
        requiresKey: x.requiresKey,
        capabilities: x.capabilities,
        models: x.models.map((m) => m.id),
      })),
      demoProvider: 'simulated',
      sharedPoolEnabled: false,
    } as T;
  }

  // ----------------------------------------------------------- companies
  if (p === '/companies' && method === 'GET') {
    const user = requireUser();
    const companies = s.members
      .filter((m) => m.user_id === user.id)
      .map((m) => {
        const company = s.companies.find((c) => c.id === m.company_id);
        if (!company) return null;
        return {
          ...company,
          role: m.role,
          accounts_count: accountsOf(company.id).length,
          open_tasks: s.tasks.filter(
            (t) => t.company_id === company.id && OPEN_TASK_STATUSES.includes(t.status),
          ).length,
          modules: effectiveModulesFor(company.id, user.id, m.role),
        };
      })
      .filter(Boolean);
    return { companies } as T;
  }

  if (p === '/companies' && method === 'POST') {
    const user = requireUser();
    const name = String(payload.name ?? '').trim();
    if (!name) throw new ApiError(400, 'VALIDATION_ERROR', 'Le nom est obligatoire');
    const start = String(payload.financialYearStart ?? '');
    const end = String(payload.financialYearEnd ?? '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || end <= start) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Dates d’exercice invalides');
    }
    if (payload.brn && s.companies.some((c) => (c.brn ?? '').toLowerCase() === String(payload.brn).toLowerCase())) {
      throw new ApiError(409, 'CONFLICT', 'Une société utilise déjà ce BRN');
    }
    const company: DemoCompany = {
      id: uid(),
      name,
      brn: payload.brn?.trim() || null,
      crn: payload.crn?.trim() || null,
      client_code: payload.clientCode?.trim() || null,
      dossier_manager_id: payload.dossierManagerId ?? null,
      archived_at: null,
      vat_number: payload.vatNumber?.trim() || null,
      registered_address: payload.registeredAddress?.trim() || null,
      business_activity: payload.businessActivity?.trim() || null,
      financial_year_start: start,
      financial_year_end: end,
      functional_currency: payload.functionalCurrency ?? 'MUR',
      presentation_currency: payload.presentationCurrency ?? payload.functionalCurrency ?? 'MUR',
      accounting_standard: payload.accountingStandard ?? 'IFRS',
      status: payload.status ?? 'active',
      locale: (user.locale as 'fr' | 'en') ?? 'fr',
      created_at: now(),
    };
    s.companies.push(company);
    s.members.push({
      id: uid(),
      company_id: company.id,
      user_id: user.id,
      role: 'owner',
      email: user.email,
      full_name: user.full_name,
    });
    s.periods.push({
      id: uid(),
      company_id: company.id,
      name: 'FY 1',
      start_date: start,
      end_date: end,
      status: 'open',
    });
    if (payload.withDefaultChart !== false) {
      for (const template of DEMO_SEED.accounts) {
        s.accounts.push({
          id: uid(),
          company_id: company.id,
          code: template.code,
          name: template.name,
          type: template.type as DemoAccount['type'],
          parent_id: null,
          currency: template.currency,
          is_active: true,
          fs_mapping: template.fs_mapping,
          description: template.description,
        });
      }
    }
    for (const template of DEMO_SEED.journals) {
      s.journals.push({
        id: uid(),
        company_id: company.id,
        code: template.code,
        name: template.name,
        type: template.type,
        is_active: true,
      });
    }
    audit(company.id, 'company.create', 'company', company.id, { name });
    persist();
    return { company } as T;
  }

  const companyMatch = /^\/companies\/([0-9a-f-]{36})(\/.*)?$/.exec(p);
  if (companyMatch) {
    const companyId = companyMatch[1]!;
    const rest = companyMatch[2] ?? '';
    const { company } = requireCompany(companyId);

    // An archived dossier is read-only (same rule as the API).
    if (company.status === 'archived' && method !== 'GET') {
      throw new ApiError(409, 'COMPANY_ARCHIVED', 'Ce dossier est archivé : lecture seule');
    }

    // ---------------------------------------------------- import & migration
    if (rest.startsWith('/migration')) {
      const member = s.members.find(
        (m) => m.company_id === companyId && m.user_id === requireUser().id,
      );
      const allowed = ['owner', 'admin', 'accountant', 'manager', 'cabinet_admin'];
      if (!member || !allowed.includes(member.role)) {
        throw new ApiError(403, 'FORBIDDEN', 'Rôle comptable requis pour la migration');
      }
      const guard = <R>(fn: () => R): R => migrationGuard(fn);

      if (rest === '/migration/profiles' && method === 'GET') {
        return {
          profiles: PROFILES,
          fields: IMPORT_FIELDS,
          kinds: IMPORT_KIND_LABELS,
          limits: DEMO_MIGRATION_LIMITS,
          demo: true,
        } as T;
      }

      if (rest === '/migration/jobs' && method === 'GET') {
        return {
          jobs: s.migrationJobs
            .filter((j) => j.company_id === companyId)
            .sort((a, b) => b.created_at.localeCompare(a.created_at)),
        } as T;
      }

      if (rest === '/migration/jobs' && method === 'POST') {
        return guard(() => {
          const view = createDemoJob(s, requireUser(), companyId, payload as any);
          audit(companyId, 'migration.job_created', 'migration_job', view.job.id, {
            file: view.job.file_name,
            kind: view.job.import_kind,
          });
          persistAfterImport();
          return view as T;
        });
      }

      if (rest === '/migration/templates' && method === 'GET') {
        return { templates: s.migrationTemplates } as T;
      }

      if (rest === '/migration/templates' && method === 'POST') {
        const template = saveDemoTemplate(s, payload as any);
        persist();
        return { template } as T;
      }

      const templateMatch = /^\/migration\/templates\/([0-9a-f-]{36})$/.exec(rest);
      if (templateMatch && method === 'DELETE') {
        return guard(() => {
          deleteDemoTemplate(s, templateMatch[1]!);
          persist();
          return undefined as T;
        });
      }

      const jobMatch = /^\/migration\/jobs\/([0-9a-f-]{36})(\/[a-z.]+)?$/.exec(rest);
      if (jobMatch) {
        const jobId = jobMatch[1]!;
        const action = jobMatch[2] ?? '';
        if (action === '' && method === 'GET') {
          return guard(() => demoJobView(s, companyId, jobId) as T);
        }
        if (action === '/mapping' && method === 'PUT') {
          return guard(() => {
            const view = updateDemoJob(s, companyId, jobId, payload as any);
            persist();
            return view as T;
          });
        }
        if (action === '/import' && method === 'POST') {
          if (payload.confirm !== true) {
            throw new ApiError(400, 'VALIDATION_ERROR', 'Confirmation explicite requise');
          }
          return guard(() => {
            const report = importDemoJob(s, requireUser(), companyId, jobId);
            audit(companyId, 'migration.imported', 'migration_job', jobId, report.counts);
            persist();
            return report as T;
          });
        }
        if (action === '/cancel' && method === 'POST') {
          return guard(() => {
            cancelDemoJob(s, companyId, jobId);
            audit(companyId, 'migration.cancelled', 'migration_job', jobId, {});
            persist();
            return undefined as T;
          });
        }
        if (action === '' && method === 'DELETE') {
          return guard(() => {
            deleteDemoJob(s, companyId, jobId);
            audit(companyId, 'migration.purged', 'migration_job', jobId, {});
            persist();
            return undefined as T;
          });
        }
        if (action === '/report.csv' && method === 'GET') {
          const job = s.migrationJobs.find((j) => j.id === jobId && j.company_id === companyId);
          if (!job) throw new ApiError(404, 'MIGRATION_JOB_NOT_FOUND', 'Lot introuvable');
          return migrationReportCsv(job) as T;
        }
      }
      throw new ApiError(404, 'NOT_FOUND', 'Route de migration inconnue');
    }

    // ------------------------------------- purchases & suppliers (11)
    if (rest.startsWith('/purchases')) {
      const member = s.members.find(
        (m) => m.company_id === companyId && m.user_id === requireUser().id,
      );
      const writers = ['owner', 'admin', 'accountant', 'manager', 'cabinet_admin'];
      if (!member) throw new ApiError(404, 'COMPANY_NOT_FOUND', 'Société introuvable');
      if (method !== 'GET' && !writers.includes(member.role)) {
        throw new ApiError(403, 'FORBIDDEN', 'Rôle comptable requis pour les achats');
      }
      const result = handleDemoPurchases(s, companyId, method, rest, query, payload);
      if (result === undefined) throw new ApiError(404, 'NOT_FOUND', 'Route achats inconnue');
      if (method !== 'GET') {
        audit(companyId, 'purchases.request', 'purchase', null, { path: rest, method });
        persist();
      }
      return result as T;
    }

    // ------------------------------------------- bank & reconciliation (9)
    if (rest.startsWith('/bank')) {
      const member = s.members.find(
        (m) => m.company_id === companyId && m.user_id === requireUser().id,
      );
      const writers = ['owner', 'admin', 'accountant', 'manager', 'cabinet_admin'];
      if (method !== 'GET' && (!member || !writers.includes(member.role))) {
        throw new ApiError(403, 'FORBIDDEN', 'Rôle comptable requis pour la banque');
      }
      if (!member) throw new ApiError(404, 'COMPANY_NOT_FOUND', 'Société introuvable');
      const result = handleDemoBank(s, companyId, method, rest, query, payload);
      if (result === undefined) {
        throw new ApiError(404, 'NOT_FOUND', 'Route bancaire inconnue');
      }
      if (method !== 'GET') {
        audit(companyId, 'bank.request', 'bank', null, { path: rest, method });
        persist();
      }
      return result as T;
    }

    if (rest === '' && method === 'GET') {
      return {
        company,
        role: s.members.find((m) => m.company_id === companyId && m.user_id === requireUser().id)?.role,
        periods: s.periods.filter((x) => x.company_id === companyId).sort((a, b) => b.start_date.localeCompare(a.start_date)),
      } as T;
    }

    if (rest === '' && method === 'PATCH') {
      const merged = { ...company, ...sanitiseCompanyPatch(payload) };
      if (merged.brn && s.companies.some((c) => c.id !== companyId && (c.brn ?? '').toLowerCase() === String(merged.brn).toLowerCase())) {
        throw new ApiError(409, 'CONFLICT', 'Une société utilise déjà ce BRN');
      }
      Object.assign(company, merged);
      audit(companyId, 'company.update', 'company', companyId, { fields: Object.keys(payload) });
      persist();
      return { company } as T;
    }


    // --------------------------- mission 7 : paramètres société & TVA
    if (rest === '/settings/company' && method === 'GET') {
      requireModule(companyId, 'cabinet', 'read');
      return demoCompanySettingsView(companyId) as T;
    }

    if (rest === '/settings/identification' && method === 'PATCH') {
      requireModule(companyId, 'cabinet', 'admin');
      const before = { name: company.name, brn: company.brn, vat_number: company.vat_number };
      const map: [string, keyof DemoCompany][] = [
        ['name', 'name'],
        ['tradeName', 'trade_name'],
        ['brn', 'brn'],
        ['vatNumber', 'vat_number'],
        ['registeredAddress', 'registered_address'],
        ['businessActivity', 'business_activity'],
        ['contactName', 'contact_name'],
        ['contactEmail', 'contact_email'],
        ['contactPhone', 'contact_phone'],
        ['locale', 'locale'],
      ];
      for (const [key, column] of map) {
        if (payload[key] !== undefined) (company as any)[column] = payload[key] === '' ? null : payload[key];
      }
      audit(companyId, 'settings.identification.update', 'company', companyId, {
        changed: Object.keys(payload),
        before,
        after: { name: company.name, brn: company.brn, vat_number: company.vat_number },
      });
      persist();
      return { identification: demoCompanySettingsView(companyId).identification } as T;
    }

    if (rest === '/settings/accounting' && method === 'PATCH') {
      requireModule(companyId, 'accounting', 'admin');
      const start = payload.financialYearStart ?? company.financial_year_start;
      const end = payload.financialYearEnd ?? company.financial_year_end;
      if (String(start) >= String(end)) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'La fin de l’exercice doit suivre son début');
      }
      if (payload.financialYearStart || payload.financialYearEnd) {
        const orphan = s.entries.some(
          (e) =>
            e.company_id === companyId &&
            e.status === 'posted' &&
            (e.entry_date < String(start) || e.entry_date > String(end)),
        );
        if (orphan) {
          throw new ApiError(
            409,
            'SETTINGS_FINANCIAL_YEAR_LOCKED',
            'Des écritures comptabilisées existent hors du nouvel exercice : modification refusée',
          );
        }
      }
      if (payload.presentationCurrency && payload.presentationCurrency !== company.presentation_currency) {
        if (s.journals.some((j) => j.company_id === companyId)) {
          throw new ApiError(
            409,
            'SETTINGS_CURRENCY_LOCKED',
            'La devise de présentation ne peut plus changer une fois le plan comptable créé',
          );
        }
      }
      company.financial_year_start = String(start);
      company.financial_year_end = String(end);
      if (payload.presentationCurrency) company.presentation_currency = String(payload.presentationCurrency).toUpperCase();
      if (payload.accountingStandard) company.accounting_standard = String(payload.accountingStandard);
      audit(companyId, 'settings.accounting.update', 'company', companyId, { fields: Object.keys(payload) });
      persist();
      return { accounting: demoCompanySettingsView(companyId).accounting } as T;
    }

    if (rest === '/settings/billing' && method === 'PATCH') {
      requireModule(companyId, 'billing', 'admin');
      const st = billingSettingsOf(companyId);
      const accounts = accountsOf(companyId);
      const accountFields: [string, keyof DemoBillingSettings][] = [
        ['defaultRevenueAccountId', 'default_revenue_account_id'],
        ['defaultReceivableAccountId', 'default_receivable_account_id'],
        ['defaultBankAccountId', 'default_bank_account_id'],
        ['defaultPurchaseAccountId', 'default_purchase_account_id'],
        ['defaultVatInputAccountId', 'default_vat_input_account_id'],
        ['defaultVatOutputAccountId', 'default_vat_output_account_id'],
      ];
      for (const [key, column] of accountFields) {
        if (payload[key] === undefined) continue;
        if (payload[key] !== null && !accounts.some((a) => a.id === payload[key])) {
          throw new ApiError(
            400,
            'SETTINGS_ACCOUNT_NOT_IN_CHART',
            'Le compte choisi n’appartient pas au plan comptable de cette société',
          );
        }
        (st as any)[column] = payload[key];
      }
      const map: [string, keyof DemoBillingSettings][] = [
        ['quotePrefix', 'quote_prefix'],
        ['invoicePrefix', 'invoice_prefix'],
        ['creditPrefix', 'credit_prefix'],
        ['numberingPolicy', 'numbering_policy'],
        ['defaultPaymentTerms', 'default_payment_terms'],
        ['documentLanguage', 'document_language'],
        ['logoUrl', 'logo_url'],
        ['legalFooterFr', 'legal_footer_fr'],
        ['legalFooterEn', 'legal_footer_en'],
        ['bankDetails', 'bank_details'],
        ['vatEnabled', 'vat_enabled'],
        ['vatNumber', 'vat_number'],
      ];
      for (const [key, column] of map) {
        if (payload[key] !== undefined) (st as any)[column] = payload[key];
      }
      audit(companyId, 'settings.billing.update', 'billing_settings', companyId, { fields: Object.keys(payload) });
      persist();
      return { billing: demoCompanySettingsView(companyId).billing } as T;
    }

    const rateMatch = /^\/billing\/tax-rates\/([0-9a-f-]{36})(?:\/(verify|unverify|history))?$/.exec(rest);
    if (rateMatch) {
      const rate = s.taxRates.find((r) => r.id === rateMatch[1] && r.company_id === companyId);
      if (!rate) throw new ApiError(404, 'VAT_RATE_NOT_FOUND', 'Taux de TVA introuvable');
      const action = rateMatch[2] ?? '';

      if (action === '' && method === 'PATCH') {
        requireModule(companyId, 'billing', 'admin');
        const used = s.billingLines.some((line) => {
          if (line.vat_rate_id !== rate.id) return false;
          const doc = s.billingDocuments.find((d) => d.id === line.document_id);
          return Boolean(doc && doc.status !== 'draft');
        });
        if (
          used &&
          (payload.rate !== undefined ||
            payload.treatment !== undefined ||
            payload.effectiveFrom !== undefined ||
            payload.effectiveTo !== undefined)
        ) {
          throw new ApiError(
            409,
            'VAT_RATE_LOCKED',
            'Ce taux est utilisé par un document émis : pourcentage, traitement et période sont figés',
          );
        }
        const before = { ...rate };
        if (payload.code !== undefined) rate.code = String(payload.code);
        if (payload.label !== undefined) rate.label = String(payload.label);
        if (payload.rate !== undefined) rate.rate = fmt(amount(payload.rate));
        if (payload.treatment !== undefined) rate.treatment = payload.treatment as DemoTaxTreatment;
        if (payload.effectiveFrom !== undefined) rate.effective_from = String(payload.effectiveFrom);
        if (payload.effectiveTo !== undefined) rate.effective_to = payload.effectiveTo;
        if (payload.source !== undefined) rate.source = payload.source;
        if (payload.notes !== undefined) rate.notes = payload.notes;
        if (payload.vatAccountId !== undefined) rate.vat_account_id = payload.vatAccountId;
        if (rate.treatment !== 'taxable' && amount(rate.rate) !== 0n) {
          throw new ApiError(400, 'VALIDATION_ERROR', 'Une qualification non taxable ne porte pas de pourcentage');
        }
        if (payload.verified === true) {
          if (!rate.source) throw new ApiError(400, 'VAT_SOURCE_REQUIRED', 'Une source documentée est requise');
          rate.verified = true;
          rate.verified_at = now();
          rate.verified_by = requireUser().id;
        } else if (payload.verified === false) {
          rate.verified = false;
          rate.verified_at = null;
          rate.verified_by = null;
        }
        demoLogRateEvent(companyId, rate.id, payload.verified === true ? 'verified' : payload.verified === false ? 'unverified' : 'updated', before, rate);
        audit(companyId, 'billing.tax_rate.update', 'billing_tax_rate', rate.id, { fields: Object.keys(payload) });
        persist();
        return { rate: demoTaxRateView(rate) } as T;
      }

      if (action === 'verify' && method === 'POST') {
        requireModule(companyId, 'billing', 'admin');
        if (payload.confirm !== true) throw new ApiError(400, 'VALIDATION_ERROR', 'Confirmation explicite requise');
        const source = String(payload.source ?? '').trim();
        if (source.length < 5) throw new ApiError(400, 'VAT_SOURCE_REQUIRED', 'Une source documentée est requise');
        const before = { ...rate };
        rate.source = source;
        if (payload.note) rate.notes = payload.note;
        rate.verified = true;
        rate.verified_at = now();
        rate.verified_by = requireUser().id;
        demoLogRateEvent(companyId, rate.id, 'verified', before, rate);
        audit(companyId, 'billing.tax_rate.verify', 'billing_tax_rate', rate.id, { source });
        persist();
        return { rate: demoTaxRateView(rate) } as T;
      }

      if (action === 'unverify' && method === 'POST') {
        requireModule(companyId, 'billing', 'admin');
        const before = { ...rate };
        rate.verified = false;
        rate.verified_at = null;
        rate.verified_by = null;
        demoLogRateEvent(companyId, rate.id, 'unverified', before, rate);
        audit(companyId, 'billing.tax_rate.unverify', 'billing_tax_rate', rate.id, {});
        persist();
        return { rate: demoTaxRateView(rate) } as T;
      }

      if (action === 'history' && method === 'GET') {
        requireModule(companyId, 'billing', 'read');
        return {
          events: s.taxRateEvents
            .filter((e) => e.company_id === companyId && e.tax_rate_id === rate.id)
            .sort((a, b) => (a.created_at < b.created_at ? 1 : -1)),
        } as T;
      }
    }

    // ------------------------------ mission 7 : assistant universel
    if (rest === '/ai/assistant/tools' && method === 'GET') {
      requireModule(companyId, 'cabinet', 'read');
      return {
        tools: DEMO_ASSISTANT_TOOLS,
        provider: null,
        mode: 'deterministic-read-only',
        demo: true,
        disclaimer: {
          fr: 'Réponses construites à partir des données fictives du dossier actif. Aucune écriture comptable n’est créée par l’assistant.',
          en: 'Answers built from the fictional records of the active dossier. The assistant never creates an accounting entry.',
        },
      } as T;
    }

    if (rest === '/ai/assistant/conversations' && method === 'POST') {
      requireModule(companyId, 'cabinet', 'read');
      const module = String(payload.module ?? 'cabinet');
      const locale = payload.locale === 'en' ? 'en' : 'fr';
      const active = s.assistantConversations
        .filter((c) => c.company_id === companyId && c.user_id === requireUser().id && c.status === 'open')
        .sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1))[0];
      const conversation: DemoAssistantConversation =
        active ?? {
          id: uid(),
          company_id: companyId,
          user_id: requireUser().id,
          module,
          screen: payload.screen ?? null,
          locale,
          title: null,
          status: 'open',
          created_at: now(),
          updated_at: now(),
        };
      if (!active) s.assistantConversations.push(conversation);
      audit(companyId, 'ai.conversation.open', 'ai_conversation', conversation.id, { module });
      persist();
      return {
        conversation: {
          id: conversation.id,
          companyId,
          module: conversation.module,
          screen: conversation.screen,
          locale: conversation.locale,
          title: conversation.title,
          status: conversation.status,
          createdAt: conversation.created_at,
          updatedAt: conversation.updated_at,
        },
        context: demoAssistantContext(companyId, conversation.module, conversation.screen, conversation.locale),
      } as T;
    }

    if (rest === '/ai/assistant/conversations' && method === 'GET') {
      requireModule(companyId, 'cabinet', 'read');
      return {
        conversations: s.assistantConversations
          .filter((c) => c.company_id === companyId && c.user_id === requireUser().id && c.status === 'open')
          .map((c) => ({ id: c.id, module: c.module, title: c.title, updatedAt: c.updated_at })),
      } as T;
    }

    const conversationMatch = /^\/ai\/assistant\/conversations\/([0-9a-f-]{36})(?:\/(messages|close))?$/.exec(rest);
    if (conversationMatch) {
      requireModule(companyId, 'cabinet', 'read');
      const conversation = s.assistantConversations.find(
        (c) => c.id === conversationMatch[1] && c.company_id === companyId && c.user_id === requireUser().id,
      );
      if (!conversation) throw new ApiError(404, 'AI_CONVERSATION_NOT_FOUND', 'Conversation introuvable');
      const action = conversationMatch[2] ?? '';

      if (action === '' && method === 'GET') {
        return {
          conversation: { id: conversation.id, module: conversation.module, locale: conversation.locale, status: conversation.status },
          messages: s.assistantMessages
            .filter((m) => m.conversation_id === conversation.id)
            .sort((a, b) => (a.created_at < b.created_at ? -1 : 1))
            .map((m) => ({ id: m.id, role: m.role, content: m.content, context: m.context, payload: m.payload, createdAt: m.created_at })),
          toolRuns: [],
        } as T;
      }

      if (action === 'messages' && method === 'POST') {
        const text = String(payload.text ?? '').replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 600);
        if (text.length < 2) throw new ApiError(400, 'AI_INPUT_TOO_LONG', 'Message trop court');
        const userMessage: DemoAssistantMessage = {
          id: uid(),
          conversation_id: conversation.id,
          role: 'user',
          content: text,
          context: demoAssistantContext(companyId, conversation.module, conversation.screen, conversation.locale),
          payload: {},
          created_at: now(),
        };
        s.assistantMessages.push(userMessage);
        const reply = demoAssistantAnswer(companyId, text, conversation.locale);
        const assistantMessage: DemoAssistantMessage = {
          id: uid(),
          conversation_id: conversation.id,
          role: 'assistant',
          content: reply.content,
          context: userMessage.context,
          payload: {
            intent: reply.toolKey ?? 'help',
            toolKey: reply.toolKey,
            toolStatus: reply.toolStatus,
            actions: reply.actions,
            context: userMessage.context,
            data: reply.data,
          },
          created_at: now(),
        };
        s.assistantMessages.push(assistantMessage);
        conversation.updated_at = now();
        if (!conversation.title) conversation.title = text.slice(0, 80);
        audit(companyId, 'ai.conversation.message', 'ai_conversation', conversation.id, {
          tool: reply.toolKey,
          status: reply.toolStatus,
        });
        persist();
        return {
          conversation: { id: conversation.id, module: conversation.module, locale: conversation.locale, status: conversation.status },
          messages: [
            { id: userMessage.id, role: 'user', content: userMessage.content, payload: {}, createdAt: userMessage.created_at },
            {
              id: assistantMessage.id,
              role: 'assistant',
              content: assistantMessage.content,
              payload: assistantMessage.payload,
              createdAt: assistantMessage.created_at,
            },
          ],
          context: userMessage.context,
          toolRuns: reply.toolKey
            ? [{ tool: reply.toolKey, status: reply.toolStatus, rowCount: null }]
            : [],
          actions: reply.actions,
        } as T;
      }

      if (action === 'close' && method === 'POST') {
        conversation.status = 'closed';
        conversation.updated_at = now();
        persist();
        return { closed: true } as T;
      }

      if (action === '' && method === 'DELETE') {
        s.assistantMessages = s.assistantMessages.filter((m) => m.conversation_id !== conversation.id);
        s.assistantConversations = s.assistantConversations.filter((c) => c.id !== conversation.id);
        audit(companyId, 'ai.conversation.delete', 'ai_conversation', conversation.id, {});
        persist();
        return { ok: true } as T;
      }
    }

    // ------------------------------------------------------------- AI
    if (rest === '/ai/suggestions/account' && method === 'POST') {
      requireModule(companyId, 'accounting', 'write');
      return aiSuggestInDemo(s, companyId, payload) as T;
    }

    if (rest === '/ai/suggestions' && method === 'GET') {
      requireModule(companyId, 'accounting', 'read');
      return {
        suggestions: s.aiSuggestions
          .filter((x) => x.company_id === companyId)
          .slice(0, 20)
          .map((x) => suggestionView(s, x)),
      } as T;
    }

    const aiDecision = /^\/ai\/suggestions\/([0-9a-f-]{36})\/decision$/.exec(rest);
    if (aiDecision && method === 'POST') {
      requireModule(companyId, 'accounting', 'write');
      return aiDecideInDemo(s, companyId, aiDecision[1]!, payload) as T;
    }

    if (rest === '/ai/rules' && method === 'GET') {
      requireModule(companyId, 'accounting', 'read');
      return {
        rules: s.aiRules
          .filter((r) => r.company_id === companyId)
          .map((r) => {
            const account = s.accounts.find((a) => a.id === r.account_id);
            return {
              id: r.id,
              keyword: r.keyword,
              accountId: r.account_id,
              code: account?.code ?? '',
              name: account?.name ?? '',
              useCount: 0,
            };
          }),
      } as T;
    }

    const aiRule = /^\/ai\/rules\/([0-9a-f-]{36})$/.exec(rest);
    if (aiRule && method === 'DELETE') {
      requireModule(companyId, 'accounting', 'write');
      const index = s.aiRules.findIndex((r) => r.id === aiRule[1] && r.company_id === companyId);
      if (index === -1) throw new ApiError(404, 'NOT_FOUND', 'Règle introuvable');
      s.aiRules.splice(index, 1);
      audit(companyId, 'ai.rule.delete', 'ai_account_rule', aiRule[1]!, {});
      persist();
      return { deleted: true } as T;
    }

    // ---------------------------------------------------------- tasks
    if (rest === '/tasks' && method === 'GET') {
      requireModule(companyId, 'cabinet', 'read');
      const rows = s.tasks
        .filter((t) => t.company_id === companyId)
        .sort((a, b) => String(a.due_date ?? '9999').localeCompare(String(b.due_date ?? '9999')))
        .map((t) => taskView(s, t));
      return { tasks: rows } as T;
    }

    if (rest === '/tasks' && method === 'POST') {
      const ctx = requireModule(companyId, 'cabinet', 'write');
      const title = String(payload.title ?? '').trim();
      if (title.length < 2) throw new ApiError(400, 'VALIDATION_ERROR', 'Titre trop court');
      if (payload.assignedTo) {
        const isMember = s.members.some(
          (m) => m.company_id === companyId && m.user_id === payload.assignedTo,
        );
        if (!isMember) {
          throw new ApiError(400, 'ASSIGNEE_NOT_MEMBER', "Ce collaborateur n'appartient pas au dossier");
        }
      }
      const task: DemoTask = {
        id: uid(),
        company_id: companyId,
        title,
        description: payload.description ? String(payload.description) : null,
        category: String(payload.category ?? 'accounting'),
        priority: String(payload.priority ?? 'normal'),
        status: String(payload.status ?? 'todo'),
        due_date: payload.dueDate || null,
        assigned_to: payload.assignedTo || null,
        created_by: ctx.user.id,
        completed_at: payload.status === 'done' ? now() : null,
        created_at: now(),
        updated_at: now(),
      };
      s.tasks.push(task);
      audit(companyId, 'cabinet.task.create', 'cabinet_task', task.id, { title });
      persist();
      return { task: taskView(s, task) } as T;
    }

    const taskMatch = /^\/tasks\/([0-9a-f-]{36})(\/comments)?$/.exec(rest);
    if (taskMatch) {
      const task = s.tasks.find((t) => t.id === taskMatch[1] && t.company_id === companyId);
      if (!task) throw new ApiError(404, 'TASK_NOT_FOUND', 'Tâche introuvable');

      if (!taskMatch[2] && method === 'GET') {
        requireModule(companyId, 'cabinet', 'read');
        return {
          task: taskView(s, task),
          comments: s.taskComments
            .filter((c) => c.task_id === task.id)
            .map((c) => ({
              ...c,
              author_name: s.users.find((u) => u.id === c.author_id)?.full_name ?? null,
            })),
          history: s.audit
            .filter((a) => a.entity_type === 'cabinet_task' && a.entity_id === task.id)
            .slice()
            .reverse()
            .map((a) => ({
              id: a.id,
              action: a.action,
              created_at: a.created_at,
              user_name: a.user_email,
            })),
        } as T;
      }

      if (!taskMatch[2] && method === 'PATCH') {
        const ctx = requireModule(companyId, 'cabinet', 'write');
        if (payload.assignedTo) {
          const isMember = s.members.some(
            (m) => m.company_id === companyId && m.user_id === payload.assignedTo,
          );
          if (!isMember) {
            throw new ApiError(400, 'ASSIGNEE_NOT_MEMBER', "Ce collaborateur n'appartient pas au dossier");
          }
        }
        const previousStatus = task.status;
        if (payload.title !== undefined) task.title = String(payload.title).trim();
        if (payload.description !== undefined) task.description = payload.description || null;
        if (payload.category !== undefined) task.category = String(payload.category);
        if (payload.priority !== undefined) task.priority = String(payload.priority);
        if (payload.status !== undefined) task.status = String(payload.status);
        if (payload.dueDate !== undefined) task.due_date = payload.dueDate || null;
        if (payload.assignedTo !== undefined) task.assigned_to = payload.assignedTo || null;
        task.updated_at = now();
        task.completed_at = task.status === 'done' ? task.completed_at ?? now() : null;
        if (payload.comment) {
          s.taskComments.push({
            id: uid(),
            task_id: task.id,
            company_id: companyId,
            author_id: ctx.user.id,
            body: String(payload.comment),
            created_at: now(),
          });
        }
        audit(
          companyId,
          payload.status && payload.status !== previousStatus
            ? 'cabinet.task.status'
            : 'cabinet.task.update',
          'cabinet_task',
          task.id,
          { from: previousStatus, to: task.status },
        );
        persist();
        return { task: taskView(s, task) } as T;
      }

      if (taskMatch[2] && method === 'POST') {
        const ctx = requireModule(companyId, 'cabinet', 'write');
        const body = String(payload.body ?? '').trim();
        if (!body) throw new ApiError(400, 'VALIDATION_ERROR', 'Commentaire vide');
        const comment: DemoTaskComment = {
          id: uid(),
          task_id: task.id,
          company_id: companyId,
          author_id: ctx.user.id,
          body,
          created_at: now(),
        };
        s.taskComments.push(comment);
        audit(companyId, 'cabinet.task.comment', 'cabinet_task', task.id);
        persist();
        return { comment } as T;
      }

      if (!taskMatch[2] && method === 'DELETE') {
        const ctx = requireModule(companyId, 'cabinet', 'write');
        if (ACCESS_WEIGHT[ctx.access] < ACCESS_WEIGHT.admin && task.created_by !== ctx.user.id) {
          throw new ApiError(403, 'FORBIDDEN', 'Suppression réservée à un administrateur cabinet');
        }
        s.tasks = s.tasks.filter((t) => t.id !== task.id);
        s.taskComments = s.taskComments.filter((c) => c.task_id !== task.id);
        audit(companyId, 'cabinet.task.delete', 'cabinet_task', task.id);
        persist();
        return { ok: true } as T;
      }
    }


    // ------------------------------------------------------------ facturation
    if (rest === '/billing/settings' && method === 'GET') {
      requireModule(companyId, 'billing', 'read');
      const st = billingSettingsOf(companyId);
      return {
        settings: {
          quotePrefix: st.quote_prefix,
          invoicePrefix: st.invoice_prefix,
          creditPrefix: st.credit_prefix,
          numberingPolicy: st.numbering_policy,
          defaultPaymentTerms: st.default_payment_terms,
          defaultCurrency: st.default_currency,
          vatEnabled: st.vat_enabled,
          vatNumber: st.vat_number,
          legalFooterFr: st.legal_footer_fr,
          legalFooterEn: st.legal_footer_en,
          bankDetails: st.bank_details,
        },
        capabilities: {
          numbering: true,
          sequentialNumbering: true,
          vatComputation: st.vat_enabled,
          vatRatesConfigured: s.taxRates.filter((r) => r.company_id === companyId && r.verified).length,
          mraEInvoicing: false,
          eInvoicingNotice: 'MRA e-invoicing n’est pas implémenté et ne peut pas être activé dans cette version.',
          postingToAccounting: true,
          postingMode: 'human_validation_required',
          pdf: false,
          pdfDemoNotice: 'Démonstration navigateur : aucun PDF n’est généré ici (le PDF réel est produit par le backend).',
          multiCurrency: true,
          duplicateDetection: 'deterministic',
        },
        demo: true,
      } as T;
    }

    if (rest === '/billing/settings' && method === 'PATCH') {
      requireModule(companyId, 'billing', 'admin');
      const st = billingSettingsOf(companyId);
      const map: [string, keyof DemoBillingSettings][] = [
        ['quotePrefix', 'quote_prefix'],
        ['invoicePrefix', 'invoice_prefix'],
        ['creditPrefix', 'credit_prefix'],
        ['numberingPolicy', 'numbering_policy'],
        ['defaultPaymentTerms', 'default_payment_terms'],
        ['defaultCurrency', 'default_currency'],
        ['vatEnabled', 'vat_enabled'],
        ['vatNumber', 'vat_number'],
        ['legalFooterFr', 'legal_footer_fr'],
        ['legalFooterEn', 'legal_footer_en'],
        ['bankDetails', 'bank_details'],
      ];
      for (const [key, column] of map) {
        if (payload[key] !== undefined) (st as any)[column] = payload[key];
      }
      audit(companyId, 'billing.settings.update', 'billing_settings', companyId, { fields: Object.keys(payload) });
      persist();
      return { settings: st } as T;
    }

    if (rest === '/billing/tax-rates' && method === 'GET') {
      requireModule(companyId, 'billing', 'read');
      return { rates: s.taxRates.filter((r) => r.company_id === companyId) } as T;
    }

    if (rest === '/billing/tax-rates' && method === 'POST') {
      requireModule(companyId, 'billing', 'admin');
      const code = String(payload.code ?? '').trim();
      if (!code) throw new ApiError(400, 'VALIDATION_ERROR', 'Code du taux requis');
      const rate = amount(payload.rate);
      if (rate < 0n || rate > 1_000_000n) throw new ApiError(400, 'VALIDATION_ERROR', 'Taux invalide');
      const created: DemoTaxRate = {
        id: uid(),
        company_id: companyId,
        code,
        label: String(payload.label ?? code),
        rate: fmt(rate),
        effective_from: String(payload.effectiveFrom ?? todayIso()),
        effective_to: payload.effectiveTo ?? null,
        verified: payload.verified === true,
        source: payload.source ?? null,
        notes: payload.notes ?? null,
        treatment: (payload.treatment as DemoTaxTreatment) ?? 'taxable',
        vat_account_id: payload.vatAccountId ?? null,
        verified_at: payload.verified === true ? now() : null,
        verified_by: payload.verified === true ? requireUser().id : null,
      };
      if (created.verified && !created.source) {
        throw new ApiError(400, 'VAT_SOURCE_REQUIRED', 'Une source documentée est requise pour vérifier un taux');
      }
      if (created.treatment !== 'taxable' && amount(created.rate) !== 0n) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Une qualification non taxable ne porte pas de pourcentage');
      }
      s.taxRates.push(created);
      demoLogRateEvent(companyId, created.id, 'created', null, created);
      audit(companyId, 'billing.tax_rate.create', 'billing_tax_rate', created.id, { code, rate: created.rate, verified: created.verified });
      persist();
      return { rate: created } as T;
    }

    if (rest === '/billing/customers' && method === 'GET') {
      requireModule(companyId, 'billing', 'read');
      const includeArchived = query.get('includeArchived') === 'true';
      const search = (query.get('search') ?? '').toLowerCase();
      const customers = s.billingCustomers
        .filter((c) => c.company_id === companyId)
        .filter((c) => (includeArchived ? true : c.is_active))
        .filter((c) => (search ? `${c.name} ${c.brn ?? ''}`.toLowerCase().includes(search) : true))
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(billingCustomerView);
      return { customers, available: true } as T;
    }

    if (rest === '/billing/customers' && method === 'POST') {
      requireModule(companyId, 'billing', 'write');
      const name = String(payload.name ?? '').trim();
      if (!name) throw new ApiError(400, 'VALIDATION_ERROR', 'Le nom est obligatoire');
      const brn = payload.brn ? String(payload.brn).trim() : null;
      const duplicate = s.billingCustomers.find(
        (c) =>
          c.company_id === companyId &&
          c.is_active &&
          ((brn && c.brn && c.brn.toLowerCase() === brn.toLowerCase()) || c.name.toLowerCase() === name.toLowerCase()),
      );
      if (duplicate && !payload.confirmDuplicate) {
        throw new ApiError(409, 'CUSTOMER_DUPLICATE', 'Un client actif identique existe déjà', {
          duplicate: billingCustomerView(duplicate),
          homonymAllowed: true,
        });
      }
      const customer: DemoBillingCustomer = {
        id: uid(),
        company_id: companyId,
        name,
        legal_name: payload.legalName ?? null,
        brn,
        vat_number: payload.vatNumber ?? null,
        address_line1: payload.addressLine1 ?? null,
        city: payload.city ?? null,
        postcode: payload.postcode ?? null,
        country: payload.country ?? 'MU',
        contact_name: payload.contactName ?? null,
        contact_email: payload.contactEmail ?? null,
        contact_phone: payload.contactPhone ?? null,
        preferred_currency: payload.preferredCurrency ?? null,
        payment_terms_days: payload.paymentTermsDays ?? null,
        receivable_account_id: payload.receivableAccountId ?? null,
        notes: payload.notes ?? null,
        is_active: true,
        archived_at: null,
        created_at: now(),
      };
      s.billingCustomers.push(customer);
      audit(companyId, 'billing.customer.create', 'billing_customer', customer.id, { name, brn });
      persist();
      return { customer: billingCustomerView(customer) } as T;
    }

    const billingCustomerMatch = /^\/billing\/customers\/([0-9a-f-]{36})(\/[a-z]+)?$/.exec(rest);
    if (billingCustomerMatch) {
      const customer = billingCustomerOf(companyId, billingCustomerMatch[1]!);
      const action = billingCustomerMatch[2] ?? '';
      if (action === '' && method === 'GET') {
        requireModule(companyId, 'billing', 'read');
        const asOf = query.get('asOf') ?? todayIso();
        return {
          customer: billingCustomerView(customer),
          balance: billingCustomerBalanceDemo(companyId, customer.id, asOf),
        } as T;
      }
      if (action === '' && method === 'PATCH') {
        requireModule(companyId, 'billing', 'write');
        const map: [string, keyof DemoBillingCustomer][] = [
          ['name', 'name'],
          ['legalName', 'legal_name'],
          ['brn', 'brn'],
          ['vatNumber', 'vat_number'],
          ['addressLine1', 'address_line1'],
          ['city', 'city'],
          ['postcode', 'postcode'],
          ['country', 'country'],
          ['contactName', 'contact_name'],
          ['contactEmail', 'contact_email'],
          ['contactPhone', 'contact_phone'],
          ['preferredCurrency', 'preferred_currency'],
          ['paymentTermsDays', 'payment_terms_days'],
          ['receivableAccountId', 'receivable_account_id'],
          ['notes', 'notes'],
          ['isActive', 'is_active'],
        ];
        for (const [key, column] of map) {
          if (payload[key] !== undefined) (customer as any)[column] = payload[key];
        }
        audit(companyId, 'billing.customer.update', 'billing_customer', customer.id, { fields: Object.keys(payload) });
        persist();
        return { customer: billingCustomerView(customer) } as T;
      }
      if (action === '' && method === 'DELETE') {
        requireModule(companyId, 'billing', 'write');
        customer.is_active = false;
        customer.archived_at = now();
        audit(companyId, 'billing.customer.archive', 'billing_customer', customer.id, { name: customer.name });
        persist();
        return { archived: true } as T;
      }
      if (action === '/history' && method === 'GET') {
        requireModule(companyId, 'billing', 'read');
        const documents = s.billingDocuments
          .filter((d) => d.company_id === companyId && d.customer_id === customer.id)
          .map((d) => ({
            id: d.id,
            kind: d.kind,
            number: d.doc_no,
            status: d.status,
            paymentStatus: d.payment_status,
            issueDate: d.issue_date,
            dueDate: d.due_date,
            currency: d.currency,
            total: d.total_amount,
            amountPaid: d.amount_paid,
            creditedAmount: d.credited_amount,
            outstanding: fmt(billingOutstanding(d)),
          }));
        const payments = s.billingPayments
          .filter((p) => p.company_id === companyId && p.customer_id === customer.id)
          .map(billingPaymentView);
        return { customer: billingCustomerView(customer), documents, payments } as T;
      }
      if (action === '/balance' && method === 'GET') {
        requireModule(companyId, 'billing', 'read');
        const asOf = query.get('asOf') ?? todayIso();
        return { balance: billingCustomerBalanceDemo(companyId, customer.id, asOf) } as T;
      }
    }

    if (rest === '/billing/items' && method === 'GET') {
      requireModule(companyId, 'billing', 'read');
      const items = s.billingItems
        .filter((i) => i.company_id === companyId)
        .map(billingItemView);
      return { items } as T;
    }

    if (rest === '/billing/items' && method === 'POST') {
      requireModule(companyId, 'billing', 'write');
      const reference = String(payload.reference ?? '').trim();
      if (!reference) throw new ApiError(400, 'VALIDATION_ERROR', 'Référence obligatoire');
      if (s.billingItems.some((i) => i.company_id === companyId && i.reference.toLowerCase() === reference.toLowerCase())) {
        throw new ApiError(409, 'ITEM_REFERENCE_TAKEN', 'Cette référence existe déjà');
      }
      const item: DemoBillingItem = {
        id: uid(),
        company_id: companyId,
        reference,
        label_fr: String(payload.labelFr ?? '').trim() || reference,
        label_en: payload.labelEn ?? null,
        description: payload.description ?? null,
        unit_price: fmt(amount(payload.unitPrice)),
        currency: payload.currency ?? company.functional_currency,
        unit: payload.unit ?? 'unit',
        category: payload.category ?? null,
        vat_treatment: (payload.vatTreatment as DemoBillingItem['vat_treatment']) ?? 'standard',
        vat_rate_id: payload.vatRateId ?? null,
        revenue_account_id: payload.revenueAccountId ?? null,
        is_active: payload.isActive !== false,
        created_at: now(),
      };
      s.billingItems.push(item);
      audit(companyId, 'billing.item.create', 'billing_item', item.id, { reference });
      persist();
      return { item: billingItemView(item) } as T;
    }

    const billingItemMatch = /^\/billing\/items\/([0-9a-f-]{36})$/.exec(rest);
    if (billingItemMatch) {
      const item = s.billingItems.find((i) => i.id === billingItemMatch[1] && i.company_id === companyId);
      if (!item) throw new ApiError(404, 'ITEM_NOT_FOUND', 'Article introuvable');
      requireModule(companyId, 'billing', 'write');
      if (method === 'PATCH') {
        const map: [string, keyof DemoBillingItem][] = [
          ['reference', 'reference'],
          ['labelFr', 'label_fr'],
          ['labelEn', 'label_en'],
          ['description', 'description'],
          ['unit', 'unit'],
          ['category', 'category'],
          ['vatRateId', 'vat_rate_id'],
          ['revenueAccountId', 'revenue_account_id'],
          ['isActive', 'is_active'],
        ];
        for (const [key, column] of map) {
          if (payload[key] !== undefined) (item as any)[column] = payload[key];
        }
        if (payload.unitPrice !== undefined) item.unit_price = fmt(amount(payload.unitPrice));
        if (payload.vatTreatment !== undefined) item.vat_treatment = payload.vatTreatment;
        audit(companyId, 'billing.item.update', 'billing_item', item.id, { fields: Object.keys(payload) });
        persist();
        return { item: billingItemView(item) } as T;
      }
      if (method === 'DELETE') {
        item.is_active = false;
        audit(companyId, 'billing.item.archive', 'billing_item', item.id, { reference: item.reference });
        persist();
        return { archived: true } as T;
      }
    }

    if (rest === '/billing/documents' && method === 'GET') {
      requireModule(companyId, 'billing', 'read');
      const kind = query.get('kind');
      const status = query.get('status');
      const customerId = query.get('customerId');
      const documents = s.billingDocuments
        .filter((d) => d.company_id === companyId)
        .filter((d) => (kind ? d.kind === kind : true))
        .filter((d) => (status ? d.status === status : true))
        .filter((d) => (customerId ? d.customer_id === customerId : true))
        .sort((a, b) => (a.issue_date < b.issue_date ? 1 : a.issue_date > b.issue_date ? -1 : 0))
        .map((d) => billingDocView(d));
      return {
        documents,
        available: true,
        capabilities: { mraEInvoicing: false, postingToAccounting: true, pdf: false },
      } as T;
    }

    if (rest === '/billing/documents' && method === 'POST') {
      requireModule(companyId, 'billing', 'write');
      return createBillingDocumentDemo(companyId, payload) as T;
    }

    if (rest === '/billing/duplicates/check' && method === 'POST') {
      requireModule(companyId, 'billing', 'read');
      const check = billingDuplicateCheck(companyId, {
        kind: payload.kind as DemoDocKind,
        customerId: payload.customerId ?? null,
        customerName: payload.customerName ?? null,
        docNo: payload.docNo ?? null,
        issueDate: String(payload.issueDate ?? todayIso()),
        totalAmount: fmt(amount(payload.totalAmount)),
        currency: String(payload.currency ?? 'MUR'),
        sourceDocumentId: payload.sourceDocumentId ?? null,
        excludeDocumentId: payload.excludeDocumentId ?? null,
      });
      return { check, automaticAction: 'none', humanValidationRequired: true } as T;
    }

    if (rest === '/billing/aging' && method === 'GET') {
      requireModule(companyId, 'billing', 'read');
      const asOf = query.get('asOf') ?? todayIso();
      const customerId = query.get('customerId');
      return billingAgingDemo(companyId, asOf, customerId) as T;
    }

    if (rest === '/billing/overdue' && method === 'GET') {
      requireModule(companyId, 'billing', 'read');
      const asOf = todayIso();
      const invoices = s.billingDocuments
        .filter(
          (d) =>
            d.company_id === companyId &&
            d.kind === 'invoice' &&
            ['issued', 'partially_paid'].includes(d.status) &&
            d.due_date !== null &&
            d.due_date < asOf,
        )
        .map((d) => ({
          ...billingDocView(d),
          daysLate: Math.floor(
            (Date.parse(`${asOf}T00:00:00Z`) - Date.parse(`${d.due_date}T00:00:00Z`)) / 86_400_000,
          ),
        }))
        .filter((d) => amount(d.outstanding) > 0n);
      return {
        asOf,
        invoices,
        totalOverdue: fmt(invoices.reduce((acc, d) => acc + amount(d.outstanding), 0n)),
      } as T;
    }

    if (rest === '/billing/summary' && method === 'GET') {
      requireModule(companyId, 'billing', 'read');
      const st = billingSettingsOf(companyId);
      const countMap = new Map<string, number>();
      for (const doc of s.billingDocuments.filter((d) => d.company_id === companyId)) {
        const key = `${doc.kind}|${doc.status}`;
        countMap.set(key, (countMap.get(key) ?? 0) + 1);
      }
      const aging = billingAgingDemo(companyId, todayIso());
      const payments = s.billingPayments.filter((p) => p.company_id === companyId && p.status === 'recorded');
      return {
        available: true,
        counts: [...countMap.entries()].map(([key, count]) => {
          const [kind, status] = key.split('|');
          return { kind, status, count };
        }),
        openReceivables: aging.totals.total,
        aging: aging.totals,
        postedDocuments: s.billingDocuments.filter((d) => d.company_id === companyId && d.accounting_entry_id).length,
        payments: {
          count: payments.length,
          unallocated: fmt(payments.reduce((acc, p) => acc + amount(p.unallocated_amount), 0n)),
        },
        capabilities: {
          numbering: true,
          vatComputation: st.vat_enabled,
          mraEInvoicing: false,
          postingToAccounting: true,
          postingMode: 'human_validation_required',
          pdf: false,
          multiCurrency: true,
          duplicateDetection: 'deterministic',
          eInvoicingNotice: 'MRA e-invoicing n’est pas implémenté et ne peut pas être activé dans cette version.',
        },
        currency: st.default_currency,
      } as T;
    }

    const billingDocMatch = /^\/billing\/documents\/([0-9a-f-]{36})(\/[a-z-]+(?:\.pdf)?)?$/.exec(rest);
    if (billingDocMatch) {
      const doc = s.billingDocuments.find((d) => d.id === billingDocMatch[1] && d.company_id === companyId);
      if (!doc) throw new ApiError(404, 'DOCUMENT_NOT_FOUND', 'Document introuvable');
      const action = billingDocMatch[2] ?? '';
      if (action === '' && method === 'GET') {
        requireModule(companyId, 'billing', 'read');
        const events = s.audit
          .filter((a) => a.entity_id === doc.id)
          .map((a) => ({ action: a.action, actor_id: a.user_id, details: a.details, created_at: a.created_at }));
        const duplicates = billingDuplicateCheck(companyId, {
          kind: doc.kind,
          customerId: doc.customer_id,
          customerName: doc.customer_name,
          docNo: doc.doc_no,
          issueDate: doc.issue_date,
          totalAmount: doc.total_amount,
          currency: doc.currency,
          sourceDocumentId: doc.source_document_id,
          excludeDocumentId: doc.id,
        });
        return { document: billingDocView(doc), events, duplicates } as T;
      }
      if (action === '' && method === 'PATCH') {
        requireModule(companyId, 'billing', 'write');
        if (doc.status !== 'draft') {
          throw new ApiError(409, 'DOCUMENT_LOCKED', 'Un document émis est verrouillé : utilisez un avoir ou une annulation');
        }
        const editable = ['notes', 'terms', 'dueDate', 'validUntil', 'issueDate', 'customerId', 'currency', 'exchangeRate', 'lines'];
        const accepted = Object.keys(payload).filter((k) => editable.includes(k));
        if (accepted.length === 0) throw new ApiError(400, 'VALIDATION_ERROR', 'Aucun champ modifiable fourni');
        if (payload.customerId) {
          const customer = billingCustomerOf(companyId, String(payload.customerId));
          if (!customer.is_active) throw new ApiError(409, 'DOCUMENT_STATUS_INVALID', 'Client archivé');
          doc.customer_id = customer.id;
          doc.customer_name = customer.name;
          doc.customer_brn = customer.brn;
        }
        if (payload.issueDate) doc.issue_date = String(payload.issueDate);
        if (payload.dueDate !== undefined) doc.due_date = payload.dueDate;
        if (payload.validUntil !== undefined) doc.valid_until = payload.validUntil;
        if (payload.notes !== undefined) doc.notes = payload.notes;
        if (payload.terms !== undefined) doc.terms = payload.terms;
        const currency = String(payload.currency ?? doc.currency).toUpperCase();
        if (payload.currency) doc.currency = currency;
        if (payload.exchangeRate !== undefined && payload.exchangeRate !== null) {
          doc.exchange_rate = rateToString(parseRate(payload.exchangeRate));
        } else if (currency !== company.functional_currency) {
          throw new ApiError(400, 'EXCHANGE_RATE_REQUIRED', `Un taux est requis pour ${currency}`);
        }
        const existingLines = s.billingLines.filter((l) => l.document_id === doc.id);
        const rawLines: any[] =
          Array.isArray(payload.lines) && payload.lines.length > 0
            ? payload.lines
            : existingLines.map((l) => ({
                itemId: l.item_id,
                description: l.description,
                quantity: l.quantity,
                unitPrice: l.unit_price,
                unit: l.unit,
                discountPct: l.discount_pct,
                vatTreatment: l.vat_treatment,
                vatRateId: l.vat_rate_id,
                revenueAccountId: l.revenue_account_id,
              }));
        const computed = computeBillingDocument(companyId, doc.issue_date, rawLines, billingSettingsOf(companyId).vat_enabled);
        doc.subtotal = fmt(computed.subtotal);
        doc.discount_total = fmt(computed.discountTotal);
        doc.tax_total = fmt(computed.taxTotal);
        doc.total_amount = fmt(computed.total);
        doc.updated_at = now();
        s.billingLines = s.billingLines.filter((l) => l.document_id !== doc.id);
        computed.lines.forEach((line, index) => {
          s.billingLines.push({
            id: uid(),
            document_id: doc.id,
            company_id: companyId,
            line_no: index + 1,
            item_id: line.itemId,
            description: line.description,
            quantity: fmt(line.quantity),
            unit_price: fmt(line.unitPrice),
            unit: line.unit,
            discount_pct: fmt(line.discountPct),
            vat_treatment: line.vatTreatment,
            vat_rate: line.vatRate === null ? null : fmt(line.vatRate),
            vat_rate_id: line.vatRateId,
            net_amount: fmt(line.netAmount),
            discount_amount: fmt(line.discountAmount),
            tax_amount: fmt(line.taxAmount),
            line_total: fmt(line.lineTotal),
            revenue_account_id: line.revenueAccountId,
          });
        });
        if (doc.kind === 'credit_note' && doc.source_document_id) {
          const invoice = s.billingDocuments.find((d) => d.id === doc.source_document_id);
          if (invoice && amount(invoice.credited_amount) + amount(doc.total_amount) > amount(invoice.total_amount)) {
            throw new ApiError(409, 'CREDIT_EXCEEDS_INVOICE', 'L’avoir dépasse le montant restant créditable');
          }
        }
        audit(companyId, 'billing.document.update', 'billing_document', doc.id, { fields: accepted });
        persist();
        return { document: billingDocView(doc), warnings: computed.warnings } as T;
      }
      if (action === '/issue' && method === 'POST') {
        requireModule(companyId, 'billing', 'write');
        return issueBillingDocumentDemo(companyId, doc.id) as T;
      }
      if (action === '/convert' && method === 'POST') {
        requireModule(companyId, 'billing', 'write');
        if (doc.kind !== 'quote') throw new ApiError(400, 'VALIDATION_ERROR', 'Seul un devis peut être converti');
        return createBillingDocumentDemo(companyId, {
          kind: 'invoice',
          customerId: doc.customer_id,
          issueDate: payload.issueDate ?? todayIso(),
          sourceDocumentId: doc.id,
          confirmDuplicate: false,
        }) as T;
      }
      if (action === '/credit-note' && method === 'POST') {
        requireModule(companyId, 'billing', 'write');
        if (doc.kind !== 'invoice') throw new ApiError(400, 'VALIDATION_ERROR', 'Un avoir référence une facture');
        return createBillingDocumentDemo(companyId, {
          kind: 'credit_note',
          customerId: doc.customer_id,
          issueDate: payload.issueDate ?? todayIso(),
          sourceDocumentId: doc.id,
          lines: payload.lines,
        }) as T;
      }
      if (action === '/cancel-draft' && method === 'POST') {
        requireModule(companyId, 'billing', 'write');
        if (doc.status !== 'draft') throw new ApiError(409, 'DOCUMENT_STATUS_INVALID', 'Seul un brouillon peut être annulé');
        doc.status = 'cancelled';
        doc.updated_at = now();
        audit(companyId, 'billing.document.cancel_draft', 'billing_document', doc.id, {});
        persist();
        return { cancelled: true, deleted: false } as T;
      }
      if (action === '/events' && method === 'GET') {
        requireModule(companyId, 'billing', 'read');
        return {
          events: s.audit
            .filter((a) => a.entity_id === doc.id)
            .map((a) => ({ action: a.action, actor_id: a.user_id, details: a.details, created_at: a.created_at })),
        } as T;
      }
      if (action === '/pdf' && method === 'GET') {
        requireModule(companyId, 'billing', 'read');
        throw new ApiError(
          501,
          'PDF_NOT_AVAILABLE_IN_DEMO',
          'La démonstration navigateur ne génère aucun PDF : le PDF réel est produit par le backend (pdfkit).',
        );
      }
    }

    if (rest === '/billing/payments' && method === 'GET') {
      requireModule(companyId, 'billing', 'read');
      const customerId = query.get('customerId');
      const payments = s.billingPayments
        .filter((p) => p.company_id === companyId)
        .filter((p) => (customerId ? p.customer_id === customerId : true))
        .sort((a, b) => (a.payment_date < b.payment_date ? 1 : -1))
        .map(billingPaymentView);
      return { payments, methods: ['bank_transfer', 'cheque', 'cash', 'card', 'other'] } as T;
    }

    if (rest === '/billing/payments' && method === 'POST') {
      requireModule(companyId, 'billing', 'write');
      const customer = billingCustomerOf(companyId, String(payload.customerId));
      if (!customer.is_active) throw new ApiError(409, 'DOCUMENT_STATUS_INVALID', 'Client archivé');
      const paymentDate = String(payload.paymentDate ?? todayIso());
      if (!/^\d{4}-\d{2}-\d{2}$/.test(paymentDate)) throw new ApiError(400, 'VALIDATION_ERROR', 'Date invalide');
      const total = amount(payload.amount);
      if (total <= 0n) throw new ApiError(400, 'VALIDATION_ERROR', 'Montant strictement positif');
      const currency = String(payload.currency ?? customer.preferred_currency ?? company.functional_currency).toUpperCase();
      let exchangeRate = '1.00000000';
      if (currency !== company.functional_currency) {
        const rate = payload.exchangeRate;
        if (rate === undefined || rate === null || rate === '') {
          throw new ApiError(400, 'EXCHANGE_RATE_REQUIRED', `Un taux est requis pour ${currency}`);
        }
        exchangeRate = rateToString(parseRate(rate));
      }
      const requested: { invoiceId: string; amount: string }[] = Array.isArray(payload.allocations) ? payload.allocations : [];
      const seen = new Set<string>();
      let allocated = 0n;
      const allocations: DemoBillingAllocation[] = [];
      for (const request of requested) {
        if (seen.has(request.invoiceId)) {
          throw new ApiError(400, 'ALLOCATION_INVALID', 'La même facture est affectée deux fois');
        }
        seen.add(request.invoiceId);
        const invoice = s.billingDocuments.find(
          (d) => d.id === request.invoiceId && d.company_id === companyId && d.kind === 'invoice',
        );
        if (!invoice) throw new ApiError(404, 'DOCUMENT_NOT_FOUND', 'Facture introuvable');
        if (invoice.customer_id !== customer.id) {
          throw new ApiError(400, 'ALLOCATION_INVALID', 'La facture appartient à un autre client');
        }
        if (!['issued', 'partially_paid'].includes(invoice.status)) {
          throw new ApiError(409, 'ALLOCATION_INVALID', `La facture ${invoice.doc_no ?? ''} n’est pas ouverte au règlement`);
        }
        if (invoice.currency !== currency) {
          throw new ApiError(400, 'CURRENCY_MISMATCH', 'La devise de l’encaissement doit être celle de la facture');
        }
        const value = amount(request.amount);
        if (value <= 0n) throw new ApiError(400, 'ALLOCATION_INVALID', 'Affectation strictement positive');
        const outstanding = billingOutstanding(invoice);
        if (value > outstanding) {
          throw new ApiError(409, 'ALLOCATION_EXCEEDS_INVOICE', 'L’affectation dépasse le solde dû', {
            invoiceId: invoice.id,
            outstanding: fmt(outstanding),
            requested: fmt(value),
          });
        }
        allocated += value;
        allocations.push({
          id: uid(),
          payment_id: '',
          invoice_id: invoice.id,
          company_id: companyId,
          amount: fmt(value),
        });
      }
      if (allocated > total) throw new ApiError(400, 'ALLOCATION_INVALID', 'Les affectations dépassent le montant reçu');
      const unallocated = total - allocated;
      const year = billingYear(companyId, paymentDate);
      const number = nextBillingNumber(companyId, 'payment', year);
      const payment: DemoBillingPayment = {
        id: uid(),
        company_id: companyId,
        customer_id: customer.id,
        payment_no: `${billingSettingsOf(companyId).numbering_policy === 'continuous' ? 'REC' : 'REC'}${billingSettingsOf(companyId).numbering_policy === 'continuous' ? `-${String(number.no).padStart(4, '0')}` : `-${year}-${String(number.no).padStart(4, '0')}`}`,
        payment_date: paymentDate,
        value_date: payload.valueDate ?? paymentDate,
        amount: fmt(total),
        currency,
        exchange_rate: exchangeRate,
        method: ['bank_transfer', 'cheque', 'cash', 'card', 'other'].includes(payload.method) ? payload.method : 'bank_transfer',
        reference: payload.reference ?? null,
        unallocated_amount: fmt(unallocated),
        status: 'recorded',
        sequence_year: year,
        sequence_no: number.no,
        accounting_entry_id: null,
        created_at: now(),
      };
      s.billingPayments.push(payment);
      for (const allocation of allocations) {
        allocation.payment_id = payment.id;
        s.billingAllocations.push(allocation);
        refreshInvoiceBalance(companyId, allocation.invoice_id);
      }
      audit(companyId, 'billing.payment.create', 'billing_payment', payment.id, {
        number: payment.payment_no,
        amount: payment.amount,
        unallocated: payment.unallocated_amount,
        currency,
      });
      persist();
      return {
        payment: billingPaymentView(payment),
        warnings: unallocated > 0n ? ['UNALLOCATED_PAYMENT: montant non affecté, à traiter.'] : [],
        duplicates: { level: 'none', matches: [] },
        entryCreated: false,
      } as T;
    }

    const billingPaymentMatch = /^\/billing\/payments\/([0-9a-f-]{36})(\/[a-z.]+)?$/.exec(rest);
    if (billingPaymentMatch) {
      const payment = s.billingPayments.find((p) => p.id === billingPaymentMatch[1] && p.company_id === companyId);
      if (!payment) throw new ApiError(404, 'PAYMENT_NOT_FOUND', 'Encaissement introuvable');
      const action = billingPaymentMatch[2] ?? '';
      if (action === '' && method === 'GET') {
        requireModule(companyId, 'billing', 'read');
        return { payment: billingPaymentView(payment) } as T;
      }
      if (action === '/cancel' && method === 'POST') {
        requireModule(companyId, 'billing', 'write');
        if (payment.accounting_entry_id) {
          throw new ApiError(409, 'ACCOUNTING_ALREADY_POSTED', 'Encaissement comptabilisé : contrepassation requise');
        }
        const touched = s.billingAllocations.filter((a) => a.payment_id === payment.id).map((a) => a.invoice_id);
        s.billingAllocations = s.billingAllocations.filter((a) => a.payment_id !== payment.id);
        payment.status = 'cancelled';
        payment.unallocated_amount = '0.0000';
        for (const invoiceId of touched) refreshInvoiceBalance(companyId, invoiceId);
        audit(companyId, 'billing.payment.cancel', 'billing_payment', payment.id, {});
        persist();
        return { cancelled: true, invoicesRefreshed: touched } as T;
      }
      if ((action === '/receipt.pdf' || action === '/pdf') && method === 'GET') {
        requireModule(companyId, 'billing', 'read');
        throw new ApiError(
          501,
          'PDF_NOT_AVAILABLE_IN_DEMO',
          'La démonstration navigateur ne génère aucun reçu PDF : le PDF réel est produit par le backend.',
        );
      }
    }

    // ------------------------------------------- assistant : propositions V2
    if (rest === '/ai/entry-proposals' && method === 'POST') {
      requireModule(companyId, 'accounting', 'write');
      return demoManualProposal(companyId, payload) as T;
    }

    if (rest === '/ai/entry-proposals/from-billing' && method === 'POST') {
      requireModule(companyId, 'accounting', 'write');
      return demoProposeFromBilling(companyId, {
        documentId: payload.documentId ? String(payload.documentId) : undefined,
        paymentId: payload.paymentId ? String(payload.paymentId) : undefined,
      }) as T;
    }

    if (rest === '/ai/entry-proposals' && method === 'GET') {
      requireModule(companyId, 'accounting', 'read');
      const limit = Math.max(1, Math.min(100, Number(query.get('limit') ?? 30) || 30));
      const proposals = s.entryProposals
        .filter((p) => p.company_id === companyId)
        .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
        .slice(0, limit)
        .map(demoProposalView);
      return { proposals, lifecycle: ['proposed', 'validated', 'posted'], neverPostsAutomatically: true } as T;
    }

    const proposalMatch = /^\/ai\/entry-proposals\/([0-9a-f-]{36})(\/[a-z]+)?$/.exec(rest);
    if (proposalMatch) {
      const proposal = s.entryProposals.find((p) => p.id === proposalMatch[1] && p.company_id === companyId);
      if (!proposal) throw new ApiError(404, 'AI_PROPOSAL_NOT_FOUND', 'Proposition introuvable');
      const action = proposalMatch[2] ?? '';
      if (action === '' && method === 'GET') {
        requireModule(companyId, 'accounting', 'read');
        return { proposal: demoProposalView(proposal) } as T;
      }
      if (action === '' && method === 'PUT') {
        requireModule(companyId, 'accounting', 'write');
        if (proposal.status === 'posted' || proposal.status === 'rejected') {
          throw new ApiError(409, 'AI_PROPOSAL_DECIDED', 'Cette proposition est clôturée');
        }
        if (payload.description !== undefined) proposal.description = String(payload.description);
        if (payload.reference !== undefined) proposal.reference = payload.reference;
        if (payload.entryDate !== undefined) proposal.entry_date = String(payload.entryDate);
        if (payload.journalId !== undefined) {
          const journal = s.journals.find((j) => j.id === payload.journalId && j.company_id === companyId);
          if (!journal) throw new ApiError(400, 'VALIDATION_ERROR', 'Journal invalide');
          proposal.journal_id = journal.id;
        }
        if (payload.currency !== undefined) proposal.currency = String(payload.currency).toUpperCase();
        if (payload.exchangeRate !== undefined) {
          proposal.exchange_rate = payload.exchangeRate === null ? null : rateToString(parseRate(payload.exchangeRate));
        }
        if (Array.isArray(payload.lines)) {
          const accounts = accountsOf(companyId);
          s.proposalLines = s.proposalLines.filter((l) => l.proposal_id !== proposal.id);
          payload.lines.forEach((line: any, index: number) => {
            const account = accounts.find((a) => a.id === line.accountId);
            if (!account) throw new ApiError(400, 'AI_ACCOUNT_NOT_IN_CHART', 'Compte hors plan comptable');
            const debit = line.debit === null || line.debit === undefined || String(line.debit).trim() === '' ? 0n : amount(line.debit);
            const credit = line.credit === null || line.credit === undefined || String(line.credit).trim() === '' ? 0n : amount(line.credit);
            if ((debit > 0n) === (credit > 0n)) {
              throw new ApiError(400, 'VALIDATION_ERROR', 'Chaque ligne porte un débit ou un crédit');
            }
            s.proposalLines.push({
              id: uid(),
              proposal_id: proposal.id,
              line_no: index + 1,
              account_id: account.id,
              description: line.description ?? null,
              debit: fmt(debit),
              credit: fmt(credit),
              rule_id: null,
            });
          });
        }
        proposal.status = 'proposed';
        proposal.validated_by = null;
        proposal.validated_at = null;
        proposal.updated_at = now();
        audit(companyId, 'ai.proposal.update', 'ai_entry_proposal', proposal.id, {
          fields: Object.keys(payload),
        });
        persist();
        return { proposal: demoProposalView(proposal), entryCreated: false } as T;
      }
      if (action === '/validate' && method === 'POST') {
        requireModule(companyId, 'accounting', 'write');
        if (proposal.status === 'posted') throw new ApiError(409, 'AI_PROPOSAL_DECIDED', 'Déjà comptabilisée');
        if (proposal.status === 'validated') throw new ApiError(409, 'AI_PROPOSAL_DECIDED', 'Déjà validée');
        if (proposal.status === 'rejected') throw new ApiError(409, 'AI_PROPOSAL_DECIDED', 'Proposition rejetée');
        const checks = demoProposalChecks(proposal);
        const errors = checks.filter((c) => !c.ok && c.severity === 'error');
        if (errors.length > 0) {
          throw new ApiError(400, 'AI_PROPOSAL_INVALID', 'Des contrôles comptables obligatoires échouent', {
            checks,
            errors: errors.map((e) => e.key),
          });
        }
        const warnings = checks.filter((c) => !c.ok && c.severity === 'warning');
        if (warnings.length > 0 && payload.acceptWarnings !== true) {
          throw new ApiError(400, 'AI_PROPOSAL_INVALID', 'Des avertissements doivent être acceptés explicitement', {
            checks,
            warnings: warnings.map((w) => w.key),
          });
        }
        proposal.status = 'validated';
        proposal.validated_by = requireUser().id;
        proposal.validated_at = now();
        proposal.updated_at = now();
        audit(companyId, 'ai.proposal.validate', 'ai_entry_proposal', proposal.id, { warnings: warnings.length });
        persist();
        return { proposal: demoProposalView(proposal), entryCreated: false } as T;
      }
      if (action === '/reject' && method === 'POST') {
        requireModule(companyId, 'accounting', 'write');
        if (proposal.status === 'posted') throw new ApiError(409, 'AI_PROPOSAL_DECIDED', 'Déjà comptabilisée');
        proposal.status = 'rejected';
        proposal.rejected_by = requireUser().id;
        proposal.rejected_at = now();
        proposal.rejection_note = payload.note ?? null;
        proposal.updated_at = now();
        audit(companyId, 'ai.proposal.reject', 'ai_entry_proposal', proposal.id, { note: payload.note ?? null });
        persist();
        return { proposal: demoProposalView(proposal), entryCreated: false } as T;
      }
      if (action === '/post' && method === 'POST') {
        requireModule(companyId, 'accounting', 'write');
        return demoPostProposal(companyId, proposal.id) as T;
      }
    }

    if (rest === '/ai/entry-rules' && method === 'GET') {
      requireModule(companyId, 'accounting', 'read');
      const includeInactive = query.get('includeInactive') === 'true';
      const rules = s.entryRules
        .filter((r) => r.company_id === companyId)
        .filter((r) => (includeInactive ? true : r.is_active))
        .sort((a, b) => a.rule_type.localeCompare(b.rule_type) || a.priority - b.priority)
        .map((r) => entryRuleView(r));
      return {
        rules,
        notice:
          'Règles déterministes validées par un humain. Aucune donnée d’une autre société n’est utilisée et aucun modèle n’est entraîné.',
      } as T;
    }

    if (rest === '/ai/entry-rules' && method === 'POST') {
      requireModule(companyId, 'accounting', 'write');
      const ruleType = String(payload.ruleType);
      if (!['counterparty', 'bank_label', 'expense_category', 'billing_item', 'payment_method', 'journal'].includes(ruleType)) {
        throw new ApiError(400, 'AI_RULE_INVALID', 'Type de règle inconnu');
      }
      const matchKey = String(payload.matchKey ?? '').trim();
      if (matchKey.length < 2) throw new ApiError(400, 'AI_RULE_INVALID', 'Clé de correspondance trop courte');
      const accountId = payload.accountId ?? null;
      const counterAccountId = payload.counterAccountId ?? null;
      if (!accountId && !payload.journalId) throw new ApiError(400, 'AI_RULE_INVALID', 'Une règle doit viser un compte ou un journal');
      const accounts = accountsOf(companyId);
      for (const id of [accountId, counterAccountId]) {
        if (!id) continue;
        const account = accounts.find((a) => a.id === id);
        if (!account || !account.is_active) throw new ApiError(400, 'AI_ACCOUNT_NOT_IN_CHART', 'Compte hors plan comptable');
      }
      const previous = s.entryRules
        .filter((r) => r.company_id === companyId && r.rule_type === ruleType && r.is_active)
        .filter((r) => r.match_key.toLowerCase() === matchKey.toLowerCase());
      previous.forEach((r) => {
        r.is_active = false;
      });
      const rule: DemoEntryRule = {
        id: uid(),
        company_id: companyId,
        rule_type: ruleType as DemoEntryRule['rule_type'],
        match_key: matchKey,
        match_label: payload.matchLabel ?? null,
        account_id: accountId,
        counter_account_id: counterAccountId,
        journal_id: payload.journalId ?? null,
        account_side: payload.accountSide === 'credit' ? 'credit' : 'debit',
        priority: Number(payload.priority ?? 100),
        version: previous.length > 0 ? Math.max(...previous.map((r) => r.version)) + 1 : 1,
        is_active: true,
        previous_version_id: previous[0]?.id ?? null,
        notes: payload.notes ?? null,
        use_count: 0,
        created_at: now(),
        validated_by: requireUser().id,
      };
      s.entryRules.push(rule);
      audit(companyId, 'ai.rule.create', 'ai_rule', rule.id, {
        ruleType,
        matchKey,
        version: rule.version,
      });
      persist();
      return { rule: entryRuleView(rule) } as T;
    }

    if (rest === '/ai/entry-rules/history' && method === 'GET') {
      requireModule(companyId, 'accounting', 'read');
      const ruleType = query.get('ruleType');
      const matchKey = query.get('matchKey');
      if (!ruleType || !matchKey) throw new ApiError(400, 'AI_RULE_INVALID', 'ruleType et matchKey sont requis');
      const history = s.entryRules
        .filter((r) => r.company_id === companyId && r.rule_type === ruleType)
        .filter((r) => r.match_key.toLowerCase().trim() === matchKey.toLowerCase().trim())
        .sort((a, b) => b.version - a.version)
        .map((r) => entryRuleView(r));
      return { history } as T;
    }

    const entryRuleMatch = /^\/ai\/entry-rules\/([0-9a-f-]{36})\/disable$/.exec(rest);
    if (entryRuleMatch && method === 'POST') {
      requireModule(companyId, 'accounting', 'write');
      const rule = s.entryRules.find((r) => r.id === entryRuleMatch[1] && r.company_id === companyId && r.is_active);
      if (!rule) throw new ApiError(404, 'AI_RULE_NOT_FOUND', 'Règle introuvable ou déjà inactive');
      rule.is_active = false;
      audit(companyId, 'ai.rule.disable', 'ai_rule', rule.id, { ruleType: rule.rule_type, version: rule.version });
      persist();
      return { disabled: true, deleted: false } as T;
    }

    // ---------------------------------------------- payroll (foundation)
    if (rest === '/payroll/employees' && method === 'GET') {
      requireModule(companyId, 'payroll', 'read');
      return { employees: [], available: false } as T;
    }

    if (rest === '/payroll/summary' && method === 'GET') {
      requireModule(companyId, 'payroll', 'read');
      return {
        available: false,
        activeEmployees: 0,
        capabilities: {
          paye: false,
          csg: false,
          nsf: false,
          payslips: false,
          leaveManagement: false,
          statutoryDeclarations: false,
          accountingTransfer: false,
        },
        notice: 'Les calculs réglementaires ne sont pas implémentés.',
      } as T;
    }

    if ((rest === '/payroll/employees' || rest === '/payroll/runs') && method === 'POST') {
      requireModule(companyId, 'payroll', 'write');
      throw new ApiError(501, 'NOT_IMPLEMENTED', 'Paie préparée mais non implémentée');
    }

    // ------------------------------------------------------------ accounts
    if (rest === '/accounts' && method === 'GET') {
      const includeInactive = query.get('includeInactive') === 'true';
      const search = (query.get('search') ?? '').toLowerCase();
      const list = accountsOf(companyId)
        .filter((a) => (includeInactive ? true : a.is_active))
        .filter((a) => (search ? `${a.code} ${a.name}`.toLowerCase().includes(search) : true))
        .sort((a, b) => a.code.localeCompare(b.code))
        .map((a) => ({
          ...a,
          parent_code: a.parent_id ? accountsOf(companyId).find((x) => x.id === a.parent_id)?.code ?? null : null,
        }));
      return { accounts: list } as T;
    }

    if (rest === '/accounts' && method === 'POST') {
      const code = String(payload.code ?? '').trim();
      if (!code) throw new ApiError(400, 'VALIDATION_ERROR', 'Le code est obligatoire');
      if (accountsOf(companyId).some((a) => a.code.toLowerCase() === code.toLowerCase())) {
        throw new ApiError(409, 'ACCOUNT_CODE_TAKEN', 'Ce code de compte existe déjà');
      }
      const account: DemoAccount = {
        id: uid(),
        company_id: companyId,
        code,
        name: String(payload.name ?? '').trim() || code,
        type: (payload.type as DemoAccount['type']) ?? 'asset',
        parent_id: payload.parentId || null,
        currency: payload.currency ?? company.functional_currency,
        is_active: payload.isActive ?? true,
        fs_mapping: payload.fsMapping ?? null,
        description: payload.description ?? null,
      };
      s.accounts.push(account);
      audit(companyId, 'account.create', 'account', account.id, { code });
      persist();
      return { account } as T;
    }

    const accountMatch = /^\/accounts\/([0-9a-f-]{36})$/.exec(rest);
    if (accountMatch) {
      const accountId = accountMatch[1]!;
      const account = s.accounts.find((a) => a.id === accountId && a.company_id === companyId);
      if (!account) throw new ApiError(404, 'ACCOUNT_NOT_FOUND', 'Compte introuvable');
      if (method === 'PATCH') {
        Object.assign(account, {
          code: payload.code?.trim() ?? account.code,
          name: payload.name?.trim() ?? account.name,
          type: payload.type ?? account.type,
          parent_id: payload.parentId !== undefined ? payload.parentId || null : account.parent_id,
          currency: payload.currency ?? account.currency,
          is_active: payload.isActive ?? account.is_active,
          fs_mapping: payload.fsMapping !== undefined ? payload.fsMapping : account.fs_mapping,
          description: payload.description !== undefined ? payload.description : account.description,
        });
        audit(companyId, 'account.update', 'account', account.id, { fields: Object.keys(payload) });
        persist();
        return { account } as T;
      }
      if (method === 'DELETE') {
        const used = s.lines.some((l) => l.account_id === accountId);
        if (used) throw new ApiError(409, 'ACCOUNT_IN_USE', 'Compte utilisé par des écritures');
        s.accounts = s.accounts.filter((a) => a.id !== accountId);
        audit(companyId, 'account.delete', 'account', accountId, { code: account.code });
        persist();
        return { ok: true } as T;
      }
    }

    // ------------------------------------------------------------ journals
    if (rest === '/journals' && method === 'GET') {
      return {
        journals: s.journals
          .filter((j) => j.company_id === companyId)
          .sort((a, b) => a.code.localeCompare(b.code)),
      } as T;
    }

    // ------------------------------------------------------------- entries
    if (rest === '/entries' && method === 'GET') {
      return listEntries(companyId, query) as T;
    }

    if (rest === '/entries' && method === 'POST') {
      const user = requireUser();
      const journal = s.journals.find((j) => j.id === payload.journalId && j.company_id === companyId);
      if (!journal) throw new ApiError(400, 'VALIDATION_ERROR', 'Journal invalide');
      const entryDate = String(payload.entryDate ?? '');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(entryDate)) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Date invalide (AAAA-MM-JJ)');
      }
      const description = String(payload.description ?? '').trim();
      if (!description) throw new ApiError(400, 'VALIDATION_ERROR', 'Le libellé est obligatoire');
      const status = payload.status === 'posted' ? 'posted' : 'draft';
      const lines: any[] = Array.isArray(payload.lines) ? payload.lines : [];
      if (lines.length === 0) throw new ApiError(400, 'VALIDATION_ERROR', 'Au moins une ligne est requise');

      assertReferenceFree(companyId, payload.reference);
      const prepared = prepareLines(company, { currency: payload.currency, exchangeRate: payload.exchangeRate, lines });
      if (status === 'posted') {
        if (!prepared.balanced) throw new ApiError(400, 'ENTRY_UNBALANCED', 'Débit et crédit doivent être égaux');
        if (lines.length < 2) throw new ApiError(400, 'ENTRY_TOO_FEW_LINES', 'Deux lignes minimum');
        assertOpenPeriod(companyId, entryDate);
      }

      const entry: DemoEntry = {
        id: uid(),
        company_id: companyId,
        journal_id: journal.id,
        entry_no: nextEntryNo(companyId, journal.code, entryDate),
        entry_date: entryDate,
        reference: payload.reference?.trim() || null,
        description,
        currency: prepared.currency,
        exchange_rate: prepared.fxRate,
        status,
        source: 'manual',
        reversal_of_entry_id: null,
        posted_at: status === 'posted' ? now() : null,
        created_at: now(),
      };
      s.entries.push(entry);
      prepared.lines.forEach((line, index) => {
        s.lines.push({
          id: uid(),
          entry_id: entry.id,
          company_id: companyId,
          account_id: line.accountId,
          line_no: index + 1,
          description: line.description,
          debit: line.debit,
          credit: line.credit,
          txn_amount: line.txnAmount,
          txn_currency: line.txnCurrency,
          fx_rate: line.fxRate,
        });
      });
      audit(companyId, status === 'posted' ? 'entry.create_posted' : 'entry.create_draft', 'journal_entry', entry.id, {
        entryNo: entry.entry_no,
        user: user.email,
      });
      persist();
      return entryDetail(companyId, entry.id) as T;
    }

    const entryMatch = /^\/entries\/([0-9a-f-]{36})(\/[a-z]+)?$/.exec(rest);
    if (entryMatch) {
      const entryId = entryMatch[1]!;
      const action = entryMatch[2] ?? '';
      const entry = s.entries.find((e) => e.id === entryId && e.company_id === companyId);
      if (!entry) throw new ApiError(404, 'ENTRY_NOT_FOUND', 'Écriture introuvable');

      if (action === '' && method === 'GET') return entryDetail(companyId, entryId) as T;

      if (action === '' && method === 'PATCH') {
        if (entry.status === 'posted') {
          throw new ApiError(409, 'ENTRY_POSTED_IMMUTABLE', 'Une écriture validée ne peut pas être modifiée');
        }
        if (entry.source === 'reversal') {
          throw new ApiError(409, 'ENTRY_POSTED_IMMUTABLE', 'Une contrepassation ne peut pas être modifiée');
        }
        const journal = payload.journalId
          ? s.journals.find((j) => j.id === payload.journalId && j.company_id === companyId)
          : s.journals.find((j) => j.id === entry.journal_id);
        if (!journal) throw new ApiError(400, 'VALIDATION_ERROR', 'Journal invalide');
        const entryDate = payload.entryDate ? String(payload.entryDate) : entry.entry_date;
        if (payload.reference !== undefined) {
          assertReferenceFree(companyId, payload.reference, entry.id);
        }
        const nextCurrency = String(payload.currency ?? entry.currency).toUpperCase();
        const currencyChanged = nextCurrency !== entry.currency.toUpperCase();
        const targetIsForeign = nextCurrency !== company.functional_currency.toUpperCase();
        if (currencyChanged && targetIsForeign && (payload.exchangeRate === undefined || payload.exchangeRate === null)) {
          throw new ApiError(400, 'EXCHANGE_RATE_REQUIRED', `Un taux est requis pour ${nextCurrency}`);
        }
        const hasLines = Array.isArray(payload.lines) && payload.lines.length > 0;
        if (currencyChanged && targetIsForeign && !hasLines) {
          throw new ApiError(400, 'EXCHANGE_RATE_REQUIRED', 'Resoumettez les lignes avec un taux daté');
        }
        let prepared: ReturnType<typeof prepareLines> | null = null;
        if (hasLines) {
          prepared = prepareLines(company, {
            currency: nextCurrency,
            exchangeRate: currencyChanged ? payload.exchangeRate : (payload.exchangeRate ?? entry.exchange_rate),
            lines: payload.lines,
          });
        }
        if (payload.status === 'posted') {
          const lines = prepared ? prepared.lines : s.lines.filter((l) => l.entry_id === entry.id);
          const balanced = prepared
            ? prepared.balanced
            : journalTotals(entry.id).debit === journalTotals(entry.id).credit &&
              journalTotals(entry.id).debit > 0n;
          if (!balanced) throw new ApiError(400, 'ENTRY_UNBALANCED', 'Débit et crédit doivent être égaux');
          if (lines.length < 2) throw new ApiError(400, 'ENTRY_TOO_FEW_LINES', 'Deux lignes minimum');
          assertOpenPeriod(companyId, entryDate);
        }
        const yearChanged = entryDate.slice(0, 4) !== entry.entry_date.slice(0, 4);
        const journalChanged = journal.id !== entry.journal_id;
        if (yearChanged || journalChanged) {
          entry.entry_no = nextEntryNo(companyId, journal.code, entryDate);
        }
        entry.journal_id = journal.id;
        entry.entry_date = entryDate;
        if (payload.reference !== undefined) entry.reference = payload.reference?.trim() || null;
        if (payload.description) entry.description = String(payload.description).trim();
        if (prepared) {
          entry.currency = prepared.currency;
          entry.exchange_rate = prepared.fxRate;
          s.lines = s.lines.filter((l) => l.entry_id !== entry.id);
          prepared.lines.forEach((line, index) => {
            s.lines.push({
              id: uid(),
              entry_id: entry.id,
              company_id: companyId,
              account_id: line.accountId,
              line_no: index + 1,
              description: line.description,
              debit: line.debit,
              credit: line.credit,
              txn_amount: line.txnAmount,
              txn_currency: line.txnCurrency,
              fx_rate: line.fxRate,
            });
          });
        }
        if (payload.status === 'posted') {
          entry.status = 'posted';
          entry.posted_at = now();
        }
        audit(companyId, 'entry.update_draft', 'journal_entry', entry.id, { fields: Object.keys(payload) });
        persist();
        return entryDetail(companyId, entryId) as T;
      }

      if (action === '' && method === 'DELETE') {
        if (entry.status === 'posted') {
          throw new ApiError(409, 'ENTRY_POSTED_IMMUTABLE', 'Une écriture validée ne peut pas être supprimée');
        }
        if (s.entries.some((e) => e.reversal_of_entry_id === entry.id)) {
          throw new ApiError(409, 'ENTRY_POSTED_IMMUTABLE', 'Cette écriture a été contrepassée');
        }
        s.entries = s.entries.filter((e) => e.id !== entry.id);
        s.lines = s.lines.filter((l) => l.entry_id !== entry.id);
        audit(companyId, 'entry.delete_draft', 'journal_entry', entry.id, { entryNo: entry.entry_no });
        persist();
        return { ok: true } as T;
      }

      if (action === '/post' && method === 'POST') {
        if (entry.status !== 'draft') throw new ApiError(409, 'ENTRY_NOT_DRAFT', 'Déjà validée');
        const { debit, credit, lines } = journalTotals(entry.id);
        if (lines.length < 2) throw new ApiError(400, 'ENTRY_TOO_FEW_LINES', 'Deux lignes minimum');
        if (debit !== credit || debit === 0n) {
          throw new ApiError(400, 'ENTRY_UNBALANCED', 'Débit et crédit doivent être égaux');
        }
        const accounts = new Map(accountsOf(companyId).map((a) => [a.id, a]));
        if (lines.some((l) => !accounts.get(l.account_id)?.is_active)) {
          throw new ApiError(400, 'VALIDATION_ERROR', 'Un compte de cette écriture est désactivé');
        }
        assertOpenPeriod(companyId, entry.entry_date);
        entry.status = 'posted';
        entry.posted_at = now();
        audit(companyId, 'entry.post', 'journal_entry', entry.id, { entryNo: entry.entry_no });
        persist();
        return entryDetail(companyId, entry.id) as T;
      }

      if (action === '/reverse' && method === 'POST') {
        if (entry.status !== 'posted') {
          throw new ApiError(409, 'ENTRY_NOT_POSTED', 'Seule une écriture validée peut être contrepassée');
        }
        if (s.entries.some((e) => e.reversal_of_entry_id === entry.id)) {
          throw new ApiError(409, 'ENTRY_ALREADY_REVERSED', 'Écriture déjà contrepassée');
        }
        const journal = s.journals.find((j) => j.id === entry.journal_id)!;
        const date = payload.entryDate ? String(payload.entryDate) : entry.entry_date;
        assertOpenPeriod(companyId, date);
        const source = s.lines.filter((l) => l.entry_id === entry.id);
        const reversal: DemoEntry = {
          id: uid(),
          company_id: companyId,
          journal_id: entry.journal_id,
          entry_no: nextEntryNo(companyId, journal.code, date),
          entry_date: date,
          reference: entry.reference,
          description: `Contrepassation de ${entry.entry_no}`,
          currency: entry.currency,
          exchange_rate: entry.exchange_rate,
          status: 'posted',
          source: 'reversal',
          reversal_of_entry_id: entry.id,
          posted_at: now(),
          created_at: now(),
        };
        s.entries.push(reversal);
        source.forEach((line, index) => {
          s.lines.push({
            id: uid(),
            entry_id: reversal.id,
            company_id: companyId,
            account_id: line.account_id,
            line_no: index + 1,
            description: line.description,
            debit: line.credit,
            credit: line.debit,
            txn_amount: line.txn_amount,
            txn_currency: line.txn_currency,
            fx_rate: line.fx_rate,
          });
        });
        audit(companyId, 'entry.reverse', 'journal_entry', entry.id, {
          reversalEntryNo: reversal.entry_no,
        });
        persist();
        return entryDetail(companyId, reversal.id) as T;
      }

      if (action === '/attachments' && method === 'POST') {
        throw new ApiError(
          501,
          'DEMO_UNSUPPORTED',
          'Pièces jointes indisponibles en démonstration : elles nécessitent le serveur (aucun fichier n’est envoyé).',
        );
      }
    }

    // -------------------------------------------------------------- reports
    if (rest.startsWith('/reports/') && method === 'GET') {
      const from = query.get('from') || company.financial_year_start;
      const to = query.get('to') || company.financial_year_end;
      if (from > to) throw new ApiError(400, 'INVALID_DATE_RANGE', 'Dates invalides');
      if (rest === '/reports/ledger') {
        return computeLedger(companyId, company.functional_currency, from, to, query) as T;
      }
      if (rest === '/reports/trial-balance') {
        return computeTrialBalance(companyId, company.functional_currency, from, to) as T;
      }
      if (rest === '/reports/statements') {
        return computeStatements(companyId, company.presentation_currency, from, to) as T;
      }
    }

    if (rest === '/dashboard' && method === 'GET') {
      return dashboard(companyId) as T;
    }

    // -------------------------------------------------------------- periods
    if (rest === '/periods' && method === 'POST') {
      const start = String(payload.startDate ?? '');
      const end = String(payload.endDate ?? '');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || end <= start) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Dates de période invalides');
      }
      const overlap = s.periods.some(
        (p) => p.company_id === companyId && start <= p.end_date && end >= p.start_date,
      );
      if (overlap) throw new ApiError(409, 'PERIOD_OVERLAP', 'Cette période en chevauche une autre');
      const period: DemoPeriod = {
        id: uid(),
        company_id: companyId,
        name: String(payload.name ?? 'Période'),
        start_date: start,
        end_date: end,
        status: 'open',
      };
      s.periods.push(period);
      audit(companyId, 'period.create', 'period', period.id, { name: period.name });
      persist();
      return { period } as T;
    }

    const periodMatch = /^\/periods\/([0-9a-f-]{36})\/(close|reopen)$/.exec(rest);
    if (periodMatch) {
      const period = s.periods.find((p) => p.id === periodMatch[1] && p.company_id === companyId);
      if (!period) throw new ApiError(404, 'PERIOD_NOT_FOUND', 'Période introuvable');
      period.status = periodMatch[2] === 'close' ? 'closed' : 'open';
      audit(companyId, `period.${periodMatch[2]}`, 'period', period.id, { name: period.name });
      persist();
      return { period } as T;
    }

    // ---------------------------------------------------------------- rates
    if (rest === '/exchange-rates' && method === 'GET') {
      return { rates: s.rates.filter((r) => r.company_id === companyId) } as T;
    }

    if (rest === '/exchange-rates' && method === 'POST') {
      const rate = parseRate(payload.rate);
      const from = String(payload.fromCurrency ?? '').toUpperCase();
      const to = String(payload.toCurrency ?? '').toUpperCase();
      if (from === to) throw new ApiError(400, 'VALIDATION_ERROR', 'Devises identiques');
      const row: DemoRate = {
        id: uid(),
        company_id: companyId,
        from_currency: from,
        to_currency: to,
        rate_date: String(payload.rateDate ?? todayIso()),
        rate: rateToString(rate),
        source: String(payload.source ?? 'Saisie manuelle (démo)'),
      };
      s.rates.push(row);
      if (to === company.functional_currency && from !== company.functional_currency) {
        s.rates.push({
          id: uid(),
          company_id: companyId,
          from_currency: to,
          to_currency: from,
          rate_date: row.rate_date,
          rate: reciprocal(rate),
          source: 'Taux inverse calculé (démo)',
        });
      }
      audit(companyId, 'exchange_rate.create', 'exchange_rate', row.id, { from, to });
      persist();
      return { rate: row } as T;
    }

    // -------------------------------------------------------------- members
    if (rest === '/members' && method === 'GET') {
      return { members: s.members.filter((m) => m.company_id === companyId) } as T;
    }

    if (rest === '/members' && method === 'POST') {
      const email = String(payload.email ?? '').trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Adresse e-mail invalide');
      }
      if (s.members.some((m) => m.company_id === companyId && m.email.toLowerCase() === email)) {
        throw new ApiError(409, 'CONFLICT', 'Ce membre existe déjà');
      }
      const member: DemoMember = {
        id: uid(),
        company_id: companyId,
        user_id: uid(),
        role: (payload.role as DemoMember['role']) ?? 'accountant',
        email,
        full_name: String(payload.fullName ?? email),
      };
      s.members.push(member);
      audit(companyId, 'member.add', 'member', member.id, { email, role: member.role });
      persist();
      return { member } as T;
    }

    const memberMatch = /^\/members\/([0-9a-f-]{36})$/.exec(rest);
    if (memberMatch && method === 'DELETE') {
      const member = s.members.find((m) => m.id === memberMatch[1] && m.company_id === companyId);
      if (!member) throw new ApiError(404, 'NOT_FOUND', 'Membre introuvable');
      if (member.user_id === requireUser().id) {
        throw new ApiError(409, 'CONFLICT', 'Impossible de retirer le propriétaire');
      }
      s.members = s.members.filter((m) => m.id !== member.id);
      audit(companyId, 'member.remove', 'member', member.id, { email: member.email });
      persist();
      return { ok: true } as T;
    }

    // ---------------------------------------------------------------- audit
    if (rest === '/audit' && method === 'GET') {
      const limit = Number(query.get('limit') ?? 100);
      const events = s.audit
        .filter((a) => a.company_id === companyId)
        .sort((a, b) => b.id - a.id)
        .slice(0, limit);
      return { events } as T;
    }
  }

  throw new ApiError(404, 'NOT_FOUND', `Route de démonstration inconnue : ${method} ${p}`);
}

function sanitiseCompanyPatch(payload: Record<string, any>) {
  const patch: Partial<DemoCompany> = {};
  if (payload.name !== undefined) patch.name = String(payload.name).trim();
  if (payload.brn !== undefined) patch.brn = payload.brn?.trim() || null;
  if (payload.vatNumber !== undefined) patch.vat_number = payload.vatNumber?.trim() || null;
  if (payload.registeredAddress !== undefined) {
    patch.registered_address = payload.registeredAddress?.trim() || null;
  }
  if (payload.businessActivity !== undefined) {
    patch.business_activity = payload.businessActivity?.trim() || null;
  }
  if (payload.financialYearStart !== undefined) patch.financial_year_start = payload.financialYearStart;
  if (payload.financialYearEnd !== undefined) patch.financial_year_end = payload.financialYearEnd;
  if (payload.functionalCurrency !== undefined) patch.functional_currency = payload.functionalCurrency;
  if (payload.presentationCurrency !== undefined) patch.presentation_currency = payload.presentationCurrency;
  if (payload.accountingStandard !== undefined) patch.accounting_standard = payload.accountingStandard;
  if (payload.status !== undefined) patch.status = payload.status;
  if (payload.locale !== undefined) patch.locale = payload.locale;
  if (payload.crn !== undefined) patch.crn = payload.crn?.trim() || null;
  if (payload.clientCode !== undefined) patch.client_code = payload.clientCode?.trim() || null;
  if (payload.dossierManagerId !== undefined) {
    patch.dossier_manager_id = payload.dossierManagerId || null;
  }
  if (patch.status !== undefined) {
    patch.archived_at = patch.status === 'archived' ? now() : null;
  }
  return patch;
}

/** CSV export (returns the text). PDF is not generated in the browser. */
export function demoCsv(path: string, format: 'csv' | 'pdf'): { text?: string; mode: 'download' | 'print' } {
  if (format === 'pdf') return { mode: 'print' };
  const [base, search] = path.split('?');
  const query = new URLSearchParams(search ?? '');
  const user = currentUser();
  return { text: exportCsv(base ?? '', query, user?.locale ?? 'fr'), mode: 'download' };
}
