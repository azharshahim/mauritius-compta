/**
 * Configurable company field validation.
 *
 * Mauritian identifiers (BRN, VAT number) formats are NOT yet confirmed against
 * official MRA / Registrar of Companies sources (see
 * docs/mauritius-regulations/compliance-register.md). The defaults below are
 * therefore deliberately permissive and flagged as PROVISIONAL. They can be
 * replaced without code changes by pointing COMPANY_VALIDATION_FILE to a JSON
 * file (see config/company-validation.example.json).
 */
import { readFileSync } from 'node:fs';

export interface FieldRule {
  required: boolean;
  pattern?: string;
  patternHint?: string;
  maxLength?: number;
  /**
   * confirmed | provisional | disabled
   * Documented in the compliance register; "provisional" must not be used to
   * reject real-world data without further validation.
   */
  status: 'confirmed' | 'provisional' | 'disabled';
}

export interface CompanyValidationRules {
  name: FieldRule;
  brn: FieldRule;
  vatNumber: FieldRule;
  registeredAddress: FieldRule;
  businessActivity: FieldRule;
  currencies: string[];
  accountingStandards: string[];
}

export const DEFAULT_COMPANY_RULES: CompanyValidationRules = {
  name: { required: true, maxLength: 200, status: 'confirmed' },
  // PLACEHOLDER: no official BRN format has been confirmed yet.
  brn: { required: false, maxLength: 40, status: 'provisional' },
  // PLACEHOLDER: VAT registration number format to be confirmed with MRA.
  vatNumber: { required: false, maxLength: 40, status: 'provisional' },
  registeredAddress: { required: false, maxLength: 500, status: 'provisional' },
  businessActivity: { required: false, maxLength: 300, status: 'provisional' },
  currencies: ['MUR', 'EUR', 'USD', 'GBP'],
  accountingStandards: ['IFRS', 'IFRS for SMEs', 'Other'],
};

let cached: CompanyValidationRules | null = null;

export function loadCompanyRules(path = process.env.COMPANY_VALIDATION_FILE): CompanyValidationRules {
  if (cached && !path) return cached;
  if (!path) {
    cached = DEFAULT_COMPANY_RULES;
    return cached;
  }
  const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<CompanyValidationRules>;
  const rules: CompanyValidationRules = {
    ...DEFAULT_COMPANY_RULES,
    ...raw,
    name: { ...DEFAULT_COMPANY_RULES.name, ...(raw.name ?? {}) },
    brn: { ...DEFAULT_COMPANY_RULES.brn, ...(raw.brn ?? {}) },
    vatNumber: { ...DEFAULT_COMPANY_RULES.vatNumber, ...(raw.vatNumber ?? {}) },
    registeredAddress: {
      ...DEFAULT_COMPANY_RULES.registeredAddress,
      ...(raw.registeredAddress ?? {}),
    },
    businessActivity: {
      ...DEFAULT_COMPANY_RULES.businessActivity,
      ...(raw.businessActivity ?? {}),
    },
  };
  if (!path) cached = rules;
  return rules;
}

export function validateField(
  rule: FieldRule,
  value: string | null | undefined,
  label: string,
): { path: string; message: string } | null {
  const v = (value ?? '').trim();
  if (!v) {
    return rule.required ? { path: label, message: `${label} is required` } : null;
  }
  if (rule.maxLength && v.length > rule.maxLength) {
    return { path: label, message: `${label} must be at most ${rule.maxLength} characters` };
  }
  if (rule.pattern && !new RegExp(rule.pattern).test(v)) {
    return {
      path: label,
      message: rule.patternHint ?? `${label} has an invalid format`,
    };
  }
  return null;
}
