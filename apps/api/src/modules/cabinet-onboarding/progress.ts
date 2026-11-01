/**
 * Mission 44 — deterministic client onboarding progress.
 *
 * Pure functions, no I/O, no randomness, no clock: the same input always
 * produces the same output, which is what makes the percentage trustworthy in
 * the demonstration and testable without a database.
 *
 * Rules (documented in docs/cabinet-onboarding.md):
 *  1. Six fixed steps, equal weight. `percent = round(completed / 6 * 100)`.
 *     No "nice looking" weighting, no manual override.
 *  2. A step is `blocked` when a required item is explicitly rejected
 *     (KYC `needs_correction`) or when a previous step is blocked.
 *  3. `pending_review` means the work is done but a human approval is missing.
 *  4. Documents that were never received count as missing; `not_applicable`
 *     items never block.
 *  5. The engine never claims a regulatory validation: `legalValidation` is
 *     always false and the report says so.
 */
import {
  KYC_TEMPLATE,
  MODULE_CATALOGUE,
  SECTORS,
  moduleDefinition,
  normaliseAccountingSetup,
  type AccountingSetup,
  type KycStatus,
  type ModuleCode,
} from './catalogue.js';

export const ONBOARDING_STEPS = [
  'company_information',
  'kyc',
  'sector',
  'accounting_setup',
  'modules',
  'activation',
] as const;
export type OnboardingStepKey = (typeof ONBOARDING_STEPS)[number];

export const STEP_STATUSES = [
  'not_started',
  'in_progress',
  'pending_review',
  'completed',
  'blocked',
] as const;
export type StepStatus = (typeof STEP_STATUSES)[number];

export interface StepResult {
  key: OnboardingStepKey;
  status: StepStatus;
  /** Translation keys explaining the status (first one is shown). */
  reasons: string[];
  completed: boolean;
  blocked: boolean;
}

export interface KycCheckLike {
  key: string;
  status: KycStatus;
  required?: boolean;
}

export interface CompanyInfoLike {
  name?: string | null;
  registered_address?: string | null;
  financial_year_start?: string | null;
  financial_year_end?: string | null;
  functional_currency?: string | null;
  brn?: string | null;
  contact_email?: string | null;
}

export interface OnboardingLike {
  sector: string | null;
  selected_modules: string[];
  accounting_setup: unknown;
  kyc_review_status: string;
  status: string;
  activated_at: string | null;
}

export interface ProgressInput {
  company: CompanyInfoLike;
  onboarding: OnboardingLike;
  kycChecks: KycCheckLike[];
}

export interface ProgressReport {
  steps: StepResult[];
  completedSteps: number;
  totalSteps: number;
  /** Deterministic percentage, 0–100. */
  percent: number;
  blockedSteps: OnboardingStepKey[];
  missingDocuments: string[];
  pendingReviewSteps: OnboardingStepKey[];
  nextStep: OnboardingStepKey | null;
  /** Never true: COMPTAI does not perform a legal KYC validation. */
  legalValidation: false;
}

/** Statuses that still require a document from the client. */
const DOCUMENT_MISSING: KycStatus[] = ['not_started', 'requested', 'missing'];
/** Statuses that satisfy a requirement from the cabinet's point of view. */
const DOCUMENT_OK: KycStatus[] = ['received', 'verified', 'not_applicable'];

export function isKycCheckRequired(check: KycCheckLike): boolean {
  if (check.required !== undefined) return check.required;
  return KYC_TEMPLATE.find((r) => r.key === check.key)?.required ?? true;
}

export function missingKycDocuments(checks: KycCheckLike[]): string[] {
  return checks
    .filter((c) => isKycCheckRequired(c) && DOCUMENT_MISSING.includes(c.status))
    .map((c) => c.key);
}

export function kycBlockers(checks: KycCheckLike[]): string[] {
  return checks.filter((c) => c.status === 'needs_correction').map((c) => c.key);
}

export function normaliseModules(list: unknown): ModuleCode[] {
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const out: ModuleCode[] = [];
  for (const raw of list) {
    const code = String(raw);
    if (moduleDefinition(code) && !seen.has(code)) {
      seen.add(code);
      out.push(code as ModuleCode);
    }
  }
  return MODULE_CATALOGUE.filter((m) => seen.has(m.code)).map((m) => m.code);
}

/** Company information step: only facts COMPTAI genuinely needs to post entries. */
export function companyInformationComplete(company: CompanyInfoLike): boolean {
  const name = (company.name ?? '').trim();
  const address = (company.registered_address ?? '').trim();
  const start = (company.financial_year_start ?? '').trim();
  const end = (company.financial_year_end ?? '').trim();
  const currency = (company.functional_currency ?? '').trim();
  return Boolean(name && address && start && end && start < end && currency.length === 3);
}

export function accountingSetupComplete(setup: AccountingSetup): boolean {
  return Boolean(
    setup.accountingBasis &&
      setup.chartChoice &&
      setup.openingBalanceChoice &&
      setup.taxRegistration &&
      setup.bankAccountsReviewed,
  );
}

export function computeOnboardingProgress(input: ProgressInput): ProgressReport {
  const { company, onboarding, kycChecks } = input;
  const setup = normaliseAccountingSetup(onboarding.accounting_setup);
  const modules = normaliseModules(onboarding.selected_modules);
  const missingDocuments = missingKycDocuments(kycChecks);
  const corrections = kycBlockers(kycChecks);
  const requiredChecks = kycChecks.filter(isKycCheckRequired);

  const steps: StepResult[] = [];
  const push = (key: OnboardingStepKey, status: StepStatus, reasons: string[]) => {
    steps.push({
      key,
      status,
      reasons,
      completed: status === 'completed',
      blocked: status === 'blocked',
    });
  };

  /* 1. Company information */
  if (companyInformationComplete(company)) {
    push('company_information', 'completed', ['m44.progress.company.done']);
  } else if ((company.name ?? '').trim() || (company.registered_address ?? '').trim()) {
    push('company_information', 'in_progress', ['m44.progress.company.partial']);
  } else {
    push('company_information', 'not_started', ['m44.progress.company.empty']);
  }

  /* 2. KYC */
  if (corrections.length > 0) {
    push('kyc', 'blocked', ['m44.progress.kyc.corrections']);
  } else if (
    requiredChecks.length > 0 &&
    requiredChecks.every((c) => DOCUMENT_OK.includes(c.status))
  ) {
    if (onboarding.kyc_review_status === 'approved') {
      push('kyc', 'completed', ['m44.progress.kyc.approved']);
    } else if (onboarding.kyc_review_status === 'rejected') {
      push('kyc', 'blocked', ['m44.progress.kyc.rejected']);
    } else {
      push('kyc', 'pending_review', ['m44.progress.kyc.pending']);
    }
  } else if (requiredChecks.length === 0) {
    push('kyc', 'in_progress', ['m44.progress.kyc.empty']);
  } else {
    const touched = requiredChecks.some((c) => c.status !== 'not_started');
    push('kyc', touched ? 'in_progress' : 'not_started', [
      touched ? 'm44.progress.kyc.inProgress' : 'm44.progress.kyc.notStarted',
    ]);
  }

  /* 3. Business sector */
  if (onboarding.sector) {
    push('sector', 'completed', ['m44.progress.sector.done']);
  } else {
    push('sector', 'not_started', ['m44.progress.sector.empty']);
  }

  /* 4. Accounting setup */
  if (accountingSetupComplete(setup)) {
    push('accounting_setup', 'completed', ['m44.progress.setup.done']);
  } else if (Object.values(setup).some((v) => v !== null && v !== false)) {
    push('accounting_setup', 'in_progress', ['m44.progress.setup.partial']);
  } else {
    push('accounting_setup', 'not_started', ['m44.progress.setup.empty']);
  }

  /* 5. Modules */
  const preparedOnly =
    modules.length > 0 &&
    modules.every((code) => moduleDefinition(code)?.availability === 'prepared');
  if (preparedOnly) {
    push('modules', 'blocked', ['m44.progress.modules.preparedOnly']);
  } else if (modules.length > 0) {
    push('modules', 'completed', ['m44.progress.modules.done']);
  } else {
    push('modules', 'not_started', ['m44.progress.modules.empty']);
  }

  /* 6. Activation — the review step depends on the five previous ones. */
  const previous = steps.filter((s) => s.key !== 'activation');
  const blockedPrevious = previous.filter((s) => s.status === 'blocked');
  const allPreviousCompleted = previous.every((s) => s.status === 'completed');
  // The review step can be reached as long as nothing is missing: a KYC step
  // waiting for a human approval is a legitimate "pending review", not a gap.
  const readyForReview = previous.every(
    (s) => s.status === 'completed' || s.status === 'pending_review',
  );
  if (onboarding.status === 'approved' && onboarding.activated_at) {
    push('activation', 'completed', ['m44.progress.activation.done']);
  } else if (blockedPrevious.length > 0) {
    push('activation', 'blocked', ['m44.progress.activation.blocked']);
  } else if (allPreviousCompleted || readyForReview) {
    push('activation', 'pending_review', ['m44.progress.activation.pending']);
  } else if (onboarding.status === 'rejected') {
    push('activation', 'blocked', ['m44.progress.activation.rejected']);
  } else {
    push('activation', 'not_started', ['m44.progress.activation.empty']);
  }

  const completedSteps = steps.filter((s) => s.completed).length;
  const totalSteps = steps.length;
  const next = steps.find((s) => !s.completed && !s.blocked) ?? steps.find((s) => !s.completed);

  return {
    steps,
    completedSteps,
    totalSteps,
    percent: Math.round((completedSteps / totalSteps) * 100),
    blockedSteps: steps.filter((s) => s.blocked).map((s) => s.key),
    pendingReviewSteps: steps.filter((s) => s.status === 'pending_review').map((s) => s.key),
    missingDocuments,
    nextStep: next ? next.key : null,
    legalValidation: false,
  };
}

/** Default KYC checklist rows for a newly created client file. */
export function defaultKycChecks(): { key: string; category: string; required: boolean; status: KycStatus }[] {
  return KYC_TEMPLATE.map((item) => ({
    key: item.key,
    category: item.category,
    required: item.required,
    status: 'not_started' as KycStatus,
  }));
}

/** Modules proposed by a sector, restricted to the catalogue. */
export function suggestedModulesForSector(sector: string | null): ModuleCode[] {
  const found = SECTORS.find((s) => s.key === sector);
  const codes = found
    ? found.suggestedModules
    : MODULE_CATALOGUE.filter((m) => m.defaultSelected).map((m) => m.code);
  return normaliseModules(codes);
}
