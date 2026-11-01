/**
 * Mission 44 — pure progress engine.
 *
 * These tests are the specification of the percentage displayed in the
 * Accountant Workspace: six fixed steps, equal weight, no invented data.
 */
import { describe, expect, it } from 'vitest';
import {
  accountingSetupComplete,
  companyInformationComplete,
  computeOnboardingProgress,
  defaultKycChecks,
  missingKycDocuments,
  normaliseModules,
  suggestedModulesForSector,
} from '../src/modules/cabinet-onboarding/progress.js';
import {
  KYC_TEMPLATE,
  MODULE_CATALOGUE,
  SECTORS,
  normaliseAccountingSetup,
} from '../src/modules/cabinet-onboarding/catalogue.js';

const company = {
  name: 'Fictitious Client Ltd',
  registered_address: '1, Fictitious Road, Port Louis',
  financial_year_start: '2025-07-01',
  financial_year_end: '2026-06-30',
  functional_currency: 'MUR',
  brn: 'FICT-BRN-1',
};

const completeOnboarding = {
  sector: 'trading_retail',
  selected_modules: ['onboarding_kyc', 'reports'],
  accounting_setup: {
    accountingBasis: 'accrual',
    chartChoice: 'provisional_template',
    openingBalanceChoice: 'later',
    taxRegistration: 'to_confirm',
    bankAccountsReviewed: true,
    vatRegistered: false,
  },
  kyc_review_status: 'approved',
  status: 'approved',
  activated_at: '2026-01-15T10:00:00.000Z',
};

const verifiedChecks = defaultKycChecks().map((c) => ({ ...c, status: 'verified' as const }));

describe('onboarding progress engine', () => {
  it('starts at 0 % for an empty file', () => {
    const report = computeOnboardingProgress({
      company: {},
      onboarding: {
        sector: null,
        selected_modules: [],
        accounting_setup: {},
        kyc_review_status: 'not_started',
        status: 'not_started',
        activated_at: null,
      },
      kycChecks: [],
    });
    expect(report.percent).toBe(0);
    expect(report.totalSteps).toBe(6);
    expect(report.completedSteps).toBe(0);
    expect(report.legalValidation).toBe(false);
  });

  it('reaches 100 % only when every step is completed', () => {
    const report = computeOnboardingProgress({
      company,
      onboarding: completeOnboarding,
      kycChecks: verifiedChecks,
    });
    expect(report.percent).toBe(100);
    expect(report.completedSteps).toBe(6);
    expect(report.nextStep).toBeNull();
    expect(report.blockedSteps).toEqual([]);
  });

  it('is deterministic: same input, same output', () => {
    const input = {
      company,
      onboarding: { ...completeOnboarding, sector: null },
      kycChecks: verifiedChecks,
    };
    expect(computeOnboardingProgress(input)).toEqual(computeOnboardingProgress(input));
  });

  it('uses equal weights: five completed steps out of six is 83 %', () => {
    const checks = verifiedChecks.map((c) =>
      c.key === 'business_address_proof' ? { ...c, status: 'missing' as const } : c,
    );
    const report = computeOnboardingProgress({
      company,
      onboarding: completeOnboarding,
      kycChecks: checks,
    });
    expect(report.completedSteps).toBe(5);
    expect(report.percent).toBe(83);
    expect(report.missingDocuments).toEqual(['business_address_proof']);
  });

  it('blocks the file when a required document needs correction', () => {
    const checks = verifiedChecks.map((c) =>
      c.key === 'directors_register' ? { ...c, status: 'needs_correction' as const } : c,
    );
    const report = computeOnboardingProgress({
      company,
      onboarding: completeOnboarding,
      kycChecks: checks,
    });
    expect(report.blockedSteps).toContain('kyc');
    expect(report.percent).toBeLessThan(100);
  });

  it('never blocks on an optional missing document', () => {
    const optional = KYC_TEMPLATE.find((t) => !t.required)!;
    const checks = verifiedChecks.map((c) =>
      c.key === optional.key ? { ...c, status: 'missing' as const } : c,
    );
    const report = computeOnboardingProgress({
      company,
      onboarding: completeOnboarding,
      kycChecks: checks,
    });
    expect(report.missingDocuments).not.toContain(optional.key);
    expect(report.percent).toBe(100);
  });

  it('keeps KYC in pending_review when every document is received but not approved', () => {
    const report = computeOnboardingProgress({
      company,
      onboarding: { ...completeOnboarding, kyc_review_status: 'pending_review', status: 'in_progress', activated_at: null },
      kycChecks: verifiedChecks,
    });
    const kyc = report.steps.find((s) => s.key === 'kyc')!;
    expect(kyc.status).toBe('pending_review');
    const activation = report.steps.find((s) => s.key === 'activation')!;
    expect(activation.status).toBe('pending_review');
  });

  it('validates the company information step on real accounting prerequisites', () => {
    expect(companyInformationComplete(company)).toBe(true);
    expect(companyInformationComplete({ ...company, registered_address: null })).toBe(false);
    expect(
      companyInformationComplete({ ...company, financial_year_start: '2026-06-30', financial_year_end: '2025-07-01' }),
    ).toBe(false);
    expect(companyInformationComplete({ ...company, functional_currency: 'MU' })).toBe(false);
  });

  it('requires every accounting setup decision', () => {
    const setup = normaliseAccountingSetup(completeOnboarding.accounting_setup);
    expect(accountingSetupComplete(setup)).toBe(true);
    expect(accountingSetupComplete({ ...setup, taxRegistration: null })).toBe(false);
    expect(accountingSetupComplete({ ...setup, bankAccountsReviewed: false })).toBe(false);
    // An unknown basis is discarded rather than silently accepted.
    expect(normaliseAccountingSetup({ accountingBasis: 'cash' }).accountingBasis).toBeNull();
  });

  it('deduplicates and orders selected modules', () => {
    expect(normaliseModules(['reports', 'reports', 'unknown', 'onboarding_kyc'])).toEqual([
      'onboarding_kyc',
      'reports',
    ]);
    expect(normaliseModules('not-an-array')).toEqual([]);
  });

  it('suggests sector modules without imposing them', () => {
    for (const sector of SECTORS) {
      const suggested = suggestedModulesForSector(sector.key);
      expect(suggested.length).toBeGreaterThan(0);
      expect(suggested.every((code) => MODULE_CATALOGUE.some((m) => m.code === code))).toBe(true);
      expect(suggested).toContain('onboarding_kyc');
    }
    expect(suggestedModulesForSector('unknown-sector')).toEqual(
      MODULE_CATALOGUE.filter((m) => m.defaultSelected).map((m) => m.code),
    );
  });

  it('reports missing documents for required items only', () => {
    const checks = defaultKycChecks();
    const missing = missingKycDocuments(checks);
    expect(missing.sort()).toEqual(
      KYC_TEMPLATE.filter((t) => t.required).map((t) => t.key).sort(),
    );
  });
});
