/**
 * Mission 44 — shared client-side types and helpers for the Accountant
 * Workspace. Only structural typing and presentation helpers live here: every
 * authorisation decision stays on the server (or in the demo backend).
 */
import type { IconName } from '../components/AppIcon';

export type StepStatus = 'not_started' | 'in_progress' | 'pending_review' | 'completed' | 'blocked';
export type OnboardingStatus = StepStatus | 'approved' | 'rejected';

export interface ProgressStep {
  key: string;
  status: StepStatus;
  reasons: string[];
  completed: boolean;
  blocked: boolean;
}

export interface ProgressReport {
  steps: ProgressStep[];
  completedSteps: number;
  totalSteps: number;
  percent: number;
  blockedSteps: string[];
  missingDocuments: string[];
  pendingReviewSteps: string[];
  nextStep: string | null;
  legalValidation: false;
}

export interface WorkspaceClient {
  id: string;
  name: string;
  trade_name: string | null;
  brn: string | null;
  client_code: string | null;
  status: string;
  sector: string | null;
  sector_label_key: string | null;
  onboarding_status: OnboardingStatus;
  kyc_review_status: string;
  current_step: number;
  assigned_accountant_id: string | null;
  assigned_accountant_name: string | null;
  financial_year_start: string;
  financial_year_end: string;
  functional_currency: string;
  accounting_standard: string | null;
  open_tasks: number;
  tax_tasks: number;
  missing_documents: number;
  progress_percent: number;
  completed_steps: number;
  total_steps: number;
  next_step: string | null;
  blocked_steps: string[];
  accounting_exceptions: number;
  last_activity_at: string | null;
  cabinet_access?: string;
  members?: { id: string; full_name: string }[];
  overdue?: boolean;
}

export interface WorkspacePayload {
  cabinet: { id: string; name: string } | null;
  user: { id: string; fullName: string; email: string };
  sectors: { key: string; labelKey: string }[];
  metrics: {
    totalClients: number;
    activeClients: number;
    onboardingInProgress: number;
    pendingReviews: number;
    missingDocuments: number;
    accountingExceptions: number;
    upcomingTaxTasks: number;
    overdueTasks: number;
  };
  metricDetails: {
    unpostedEntries: number;
    unbalancedEntries: number;
    pendingDocuments: number;
    upcomingTaxTasks: { title: string; due_date: string | null; company_name: string }[];
  };
  clients: WorkspaceClient[];
  drafts: {
    id: string;
    current_step: number;
    updated_at: string;
    registered_name: string | null;
    sector: string | null;
  }[];
  accountants: { id: string; full_name: string }[];
  upcoming: {
    id?: string;
    title: string;
    due_date: string;
    company_id: string;
    company_name: string;
    category?: string;
    priority?: string;
    assignee_name?: string | null;
  }[];
  activity: {
    id: number | string;
    action: string;
    entity_type: string;
    created_at: string;
    company_name?: string | null;
    user_name?: string | null;
  }[];
}

export interface KycCheck {
  id?: string;
  key: string;
  category: string;
  required: boolean;
  status: string;
  document_ref?: string | null;
  note?: string | null;
}

export interface OnboardingRow {
  company_id: string;
  status: string;
  kyc_review_status: string;
  current_step: number;
  sector: string | null;
  sector_notes: string | null;
  accounting_setup: Record<string, unknown>;
  selected_modules: string[];
  assigned_accountant_id: string | null;
  activated_at: string | null;
  last_activity_at: string | null;
  exists: boolean;
}

export interface ModuleAvailability {
  code: string;
  order: number;
  availability: 'available' | 'partial' | 'prepared';
  appModule: string;
  access: string;
  allowed: boolean;
  selected: boolean;
  routes: { path: string; labelKey: string }[];
  labelKey: string;
  shortKey: string;
  descriptionKey: string;
}

export interface ClientWorkspacePayload {
  company: {
    id: string;
    name: string;
    trade_name?: string | null;
    brn: string | null;
    crn?: string | null;
    client_code?: string | null;
    status: string;
    registered_address: string | null;
    business_activity: string | null;
    financial_year_start: string;
    financial_year_end: string;
    functional_currency: string;
    accounting_standard: string;
  };
  role: string;
  access?: Record<string, string>;
  onboarding: OnboardingRow;
  kycChecks: KycCheck[];
  progress: ProgressReport;
  sector: {
    key: string;
    labelKey: string;
    descriptionKey: string;
    attentionKeys: string[];
    suggestedModules: string[];
  } | null;
  checks: {
    unpostedEntries: number;
    postedEntries: number;
    unbalancedEntries: number;
    trialBalance: { debit: number; credit: number; balanced: boolean };
    openingBalanceBatches: number;
    bankAccounts: number;
    unreconciledTransactions: number;
    pendingProposals: number;
    accounts: number;
    missingDocuments: number;
  };
  tasks: {
    id: string;
    title: string;
    category: string;
    status: string;
    priority: string;
    due_date: string | null;
    assignee_name: string | null;
  }[];
  recentActivity: {
    id: number;
    action: string;
    entity_type: string;
    created_at: string;
    user_name: string | null;
  }[];
  members: { user_id: string; full_name: string; role: string }[];
  moduleAvailability: ModuleAvailability[];
  catalogue: { sectors: unknown[]; kycTemplate: unknown[]; supportedCurrencies: string[] };
}

/** Badge tone for a step or onboarding status. */
export function statusKind(status: string): 'neutral' | 'success' | 'warning' | 'danger' | 'info' {
  switch (status) {
    case 'completed':
    case 'approved':
    case 'verified':
      return 'success';
    case 'pending_review':
    case 'received':
    case 'requested':
      return 'info';
    case 'in_progress':
      return 'warning';
    case 'blocked':
    case 'rejected':
    case 'needs_correction':
    case 'missing':
      return 'danger';
    default:
      return 'neutral';
  }
}

export function stepLabelKey(step: string): string {
  return `m44.step.${step}`;
}

export function statusLabelKey(status: string): string {
  return `m44.status.${status}`;
}

export function kycCategoryLabelKey(category: string): string {
  return `m44.kyc.category.${category}`;
}

export function availabilityBadge(
  availability: string,
): { kind: 'success' | 'warning' | 'neutral'; labelKey: string } {
  if (availability === 'available') return { kind: 'success', labelKey: 'm44.availability.available' };
  if (availability === 'partial') return { kind: 'warning', labelKey: 'm44.availability.partial' };
  return { kind: 'neutral', labelKey: 'm44.availability.prepared' };
}

/** Icon of each of the eight functional domains. */
export const MODULE_ICONS: Record<string, IconName> = {
  onboarding_kyc: 'cabinet',
  sector_instances: 'settings',
  checks_balances: 'validate',
  sales_einvoicing: 'invoices',
  purchases_ocr: 'purchases',
  tax_management: 'declarations',
  reports: 'reports',
  knowledge_ai: 'assistant',
};

/** KYC statuses a client can receive from the checklist. */
export const KYC_STATUS_OPTIONS = [
  'not_started',
  'requested',
  'received',
  'verified',
  'missing',
  'needs_correction',
  'not_applicable',
] as const;

/** Storage key of a draft being edited in this browser tab. */
export const DRAFT_STORAGE_KEY = 'mc.m44.draftId';
