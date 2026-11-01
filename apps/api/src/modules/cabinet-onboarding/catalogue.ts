/**
 * Mission 44 — Cabinet onboarding catalogue.
 *
 * One single source of truth shared by the API, the browser demo and the web
 * screens (the demo already imports pure modules from `apps/api/src`, see
 * `apps/web/src/demo/runtime.ts`). It contains **keys only**: every visible
 * label lives in the FR/EN dictionaries of the web application.
 *
 * Design rules enforced here:
 *  - a sector suggests modules, it never imposes an accounting or tax rule;
 *  - an availability status is stated honestly: `available`, `partial` or
 *    `prepared` (announced, not implemented);
 *  - nothing in this file claims regulatory compliance. KYC is a *checklist*,
 *    not a legal validation: see docs/cabinet-onboarding.md.
 */

/** The eight functional domains requested by the Mauritian accountant. */
export const MODULE_CODES = [
  'onboarding_kyc',
  'sector_instances',
  'checks_balances',
  'sales_einvoicing',
  'purchases_ocr',
  'tax_management',
  'reports',
  'knowledge_ai',
] as const;
export type ModuleCode = (typeof MODULE_CODES)[number];

export type Availability = 'available' | 'partial' | 'prepared';

export interface ModuleDefinition {
  code: ModuleCode;
  /** Number shown in the client workspace ("Module 4"). */
  order: number;
  labelKey: string;
  shortKey: string;
  descriptionKey: string;
  availability: Availability;
  /** Application module whose existing permission gates the domain. */
  appModule: 'cabinet' | 'accounting' | 'billing' | 'payroll';
  /** Existing COMPTAI screens reached from the domain (never invented). */
  routes: { path: string; labelKey: string }[];
  /** Selected by default when a sector suggests it. */
  defaultSelected: boolean;
}

/**
 * The catalogue maps each requested domain onto screens that really exist.
 * `prepared` entries open a screen that states the limitation itself; selecting
 * a domain never enables a new accounting engine, an MRA transmission or an AI
 * provider.
 */
export const MODULE_CATALOGUE: ModuleDefinition[] = [
  {
    code: 'onboarding_kyc',
    order: 1,
    labelKey: 'm44.module.kyc.label',
    shortKey: 'm44.module.kyc.short',
    descriptionKey: 'm44.module.kyc.desc',
    availability: 'partial',
    appModule: 'cabinet',
    routes: [],
    defaultSelected: true,
  },
  {
    code: 'sector_instances',
    order: 2,
    labelKey: 'm44.module.sector.label',
    shortKey: 'm44.module.sector.short',
    descriptionKey: 'm44.module.sector.desc',
    availability: 'partial',
    appModule: 'cabinet',
    routes: [],
    defaultSelected: true,
  },
  {
    code: 'checks_balances',
    order: 3,
    labelKey: 'm44.module.checks.label',
    shortKey: 'm44.module.checks.short',
    descriptionKey: 'm44.module.checks.desc',
    availability: 'partial',
    appModule: 'accounting',
    routes: [
      { path: '/accounting/trial-balance', labelKey: 'm44.module.checks.link.tb' },
      { path: '/accounting/entries', labelKey: 'm44.module.checks.link.entries' },
      { path: '/accounting/financial-years?tab=opening', labelKey: 'm44.module.checks.link.opening' },
      { path: '/accounting/banking', labelKey: 'm44.module.checks.link.bank' },
    ],
    defaultSelected: true,
  },
  {
    code: 'sales_einvoicing',
    order: 4,
    labelKey: 'm44.module.sales.label',
    shortKey: 'm44.module.sales.short',
    descriptionKey: 'm44.module.sales.desc',
    availability: 'available',
    appModule: 'billing',
    routes: [
      { path: '/billing/customers', labelKey: 'm44.module.sales.link.customers' },
      { path: '/billing/quotes', labelKey: 'm44.module.sales.link.quotes' },
      { path: '/billing/invoices', labelKey: 'm44.module.sales.link.invoices' },
      { path: '/billing/credit-notes', labelKey: 'm44.module.sales.link.creditNotes' },
      { path: '/billing/payments', labelKey: 'm44.module.sales.link.payments' },
      { path: '/billing/aging', labelKey: 'm44.module.sales.link.aging' },
      { path: '/billing/e-invoicing', labelKey: 'm44.module.sales.link.eInvoicing' },
    ],
    defaultSelected: true,
  },
  {
    code: 'purchases_ocr',
    order: 5,
    labelKey: 'm44.module.purchases.label',
    shortKey: 'm44.module.purchases.short',
    descriptionKey: 'm44.module.purchases.desc',
    availability: 'available',
    appModule: 'accounting',
    routes: [
      { path: '/accounting/purchases', labelKey: 'm44.module.purchases.link.suppliers' },
      { path: '/accounting/purchases?tab=invoices', labelKey: 'm44.module.purchases.link.invoices' },
      { path: '/accounting/purchases?tab=payments', labelKey: 'm44.module.purchases.link.payments' },
      { path: '/documents', labelKey: 'm44.module.purchases.link.ocr' },
      { path: '/cabinet/ai-proposals', labelKey: 'm44.module.purchases.link.review' },
    ],
    defaultSelected: true,
  },
  {
    code: 'tax_management',
    order: 6,
    labelKey: 'm44.module.tax.label',
    shortKey: 'm44.module.tax.short',
    descriptionKey: 'm44.module.tax.desc',
    availability: 'partial',
    appModule: 'accounting',
    routes: [
      { path: '/accounting/settings', labelKey: 'm44.module.tax.link.settings' },
      { path: '/cabinet/tasks', labelKey: 'm44.module.tax.link.tasks' },
      { path: '/accounting/statements?tab=vat', labelKey: 'm44.module.tax.link.vat' },
    ],
    defaultSelected: true,
  },
  {
    code: 'reports',
    order: 7,
    labelKey: 'm44.module.reports.label',
    shortKey: 'm44.module.reports.short',
    descriptionKey: 'm44.module.reports.desc',
    availability: 'available',
    appModule: 'accounting',
    routes: [
      { path: '/accounting/trial-balance', labelKey: 'm44.module.reports.link.tb' },
      { path: '/accounting/ledger', labelKey: 'm44.module.reports.link.gl' },
      { path: '/accounting/statements/profit-loss', labelKey: 'm44.module.reports.link.pl' },
      { path: '/accounting/statements/balance-sheet', labelKey: 'm44.module.reports.link.bs' },
      { path: '/billing/aging', labelKey: 'm44.module.reports.link.ar' },
      { path: '/accounting/purchases?tab=aging', labelKey: 'm44.module.reports.link.ap' },
      { path: '/accounting/assets', labelKey: 'm44.module.reports.link.fa' },
      { path: '/accounting/inventory', labelKey: 'm44.module.reports.link.inv' },
    ],
    defaultSelected: true,
  },
  {
    code: 'knowledge_ai',
    order: 8,
    labelKey: 'm44.module.knowledge.label',
    shortKey: 'm44.module.knowledge.short',
    descriptionKey: 'm44.module.knowledge.desc',
    availability: 'partial',
    appModule: 'cabinet',
    routes: [
      { path: '/cabinet/ai-assistant', labelKey: 'm44.module.knowledge.link.assistant' },
      { path: '/cabinet/ai-settings', labelKey: 'm44.module.knowledge.link.settings' },
    ],
    defaultSelected: false,
  },
];

export function moduleDefinition(code: string): ModuleDefinition | undefined {
  return MODULE_CATALOGUE.find((m) => m.code === code);
}

export function isModuleCode(value: unknown): value is ModuleCode {
  return typeof value === 'string' && (MODULE_CODES as readonly string[]).includes(value);
}

/* ------------------------------------------------------------------ sectors */

export const SECTOR_KEYS = [
  'trading_retail',
  'professional_services',
  'hospitality_tourism',
  'construction',
  'manufacturing',
  'property_real_estate',
  'transport_logistics',
  'agriculture',
  'other',
] as const;
export type SectorKey = (typeof SECTOR_KEYS)[number];

export interface SectorDefinition {
  key: SectorKey;
  labelKey: string;
  descriptionKey: string;
  /** Domains proposed by default for this sector (still editable). */
  suggestedModules: ModuleCode[];
  /** Points to verify by a human. Never presented as a legal requirement. */
  attentionKeys: string[];
}

export const SECTORS: SectorDefinition[] = [
  {
    key: 'trading_retail',
    labelKey: 'm44.sector.trading',
    descriptionKey: 'm44.sector.trading.desc',
    suggestedModules: [
      'onboarding_kyc',
      'sector_instances',
      'checks_balances',
      'sales_einvoicing',
      'purchases_ocr',
      'tax_management',
      'reports',
    ],
    attentionKeys: ['m44.sector.trading.note1', 'm44.sector.trading.note2'],
  },
  {
    key: 'professional_services',
    labelKey: 'm44.sector.professional',
    descriptionKey: 'm44.sector.professional.desc',
    suggestedModules: [
      'onboarding_kyc',
      'sector_instances',
      'checks_balances',
      'sales_einvoicing',
      'purchases_ocr',
      'tax_management',
      'reports',
      'knowledge_ai',
    ],
    attentionKeys: ['m44.sector.professional.note1', 'm44.sector.professional.note2'],
  },
  {
    key: 'hospitality_tourism',
    labelKey: 'm44.sector.hospitality',
    descriptionKey: 'm44.sector.hospitality.desc',
    suggestedModules: [
      'onboarding_kyc',
      'sector_instances',
      'checks_balances',
      'sales_einvoicing',
      'purchases_ocr',
      'tax_management',
      'reports',
    ],
    attentionKeys: ['m44.sector.hospitality.note1', 'm44.sector.hospitality.note2'],
  },
  {
    key: 'construction',
    labelKey: 'm44.sector.construction',
    descriptionKey: 'm44.sector.construction.desc',
    suggestedModules: [
      'onboarding_kyc',
      'sector_instances',
      'checks_balances',
      'purchases_ocr',
      'tax_management',
      'reports',
    ],
    attentionKeys: ['m44.sector.construction.note1', 'm44.sector.construction.note2'],
  },
  {
    key: 'manufacturing',
    labelKey: 'm44.sector.manufacturing',
    descriptionKey: 'm44.sector.manufacturing.desc',
    suggestedModules: [
      'onboarding_kyc',
      'sector_instances',
      'checks_balances',
      'sales_einvoicing',
      'purchases_ocr',
      'tax_management',
      'reports',
    ],
    attentionKeys: ['m44.sector.manufacturing.note1', 'm44.sector.manufacturing.note2'],
  },
  {
    key: 'property_real_estate',
    labelKey: 'm44.sector.property',
    descriptionKey: 'm44.sector.property.desc',
    suggestedModules: [
      'onboarding_kyc',
      'sector_instances',
      'checks_balances',
      'sales_einvoicing',
      'tax_management',
      'reports',
    ],
    attentionKeys: ['m44.sector.property.note1', 'm44.sector.property.note2'],
  },
  {
    key: 'transport_logistics',
    labelKey: 'm44.sector.transport',
    descriptionKey: 'm44.sector.transport.desc',
    suggestedModules: [
      'onboarding_kyc',
      'sector_instances',
      'checks_balances',
      'purchases_ocr',
      'tax_management',
      'reports',
    ],
    attentionKeys: ['m44.sector.transport.note1', 'm44.sector.transport.note2'],
  },
  {
    key: 'agriculture',
    labelKey: 'm44.sector.agriculture',
    descriptionKey: 'm44.sector.agriculture.desc',
    suggestedModules: [
      'onboarding_kyc',
      'sector_instances',
      'checks_balances',
      'purchases_ocr',
      'tax_management',
      'reports',
    ],
    attentionKeys: ['m44.sector.agriculture.note1', 'm44.sector.agriculture.note2'],
  },
  {
    key: 'other',
    labelKey: 'm44.sector.other',
    descriptionKey: 'm44.sector.other.desc',
    suggestedModules: ['onboarding_kyc', 'sector_instances', 'checks_balances', 'reports'],
    attentionKeys: ['m44.sector.other.note1'],
  },
];

export function sectorDefinition(key: string | null | undefined): SectorDefinition | undefined {
  return SECTORS.find((s) => s.key === key);
}

export function isSectorKey(value: unknown): value is SectorKey {
  return typeof value === 'string' && (SECTOR_KEYS as readonly string[]).includes(value);
}

/* --------------------------------------------------------- legal forms, etc. */

/**
 * Legal forms are descriptive only: COMPTAI records what the firm enters.
 * Nothing here asserts a Mauritian classification or a filing obligation.
 */
export const LEGAL_FORMS = [
  'private_company',
  'public_company',
  'sole_trader',
  'partnership',
  'societe',
  'trust',
  'foundation',
  'branch_foreign',
  'other',
] as const;
export type LegalForm = (typeof LEGAL_FORMS)[number];
export function isLegalForm(value: unknown): value is LegalForm {
  return typeof value === 'string' && (LEGAL_FORMS as readonly string[]).includes(value);
}

/** Currencies the engine already supports (see `company_currencies`). */
export const SUPPORTED_CURRENCIES = ['MUR', 'USD', 'EUR', 'GBP', 'ZAR', 'INR', 'AUD', 'CAD', 'CHF', 'JPY', 'SGD', 'AED', 'CNY'] as const;

/* --------------------------------------------------------------------- KYC */

export const KYC_CATEGORIES = [
  'company_identity',
  'directors',
  'beneficial_owners',
  'identity_documents',
  'registration_documents',
  'proof_of_address',
  'supporting_documents',
] as const;
export type KycCategory = (typeof KYC_CATEGORIES)[number];

/**
 * Checklist statuses. `requested`, `received` and `verified` describe the
 * cabinet's own follow-up; they are **not** a legal verification and the API
 * always returns `legalValidation: false` with the checklist.
 */
export const KYC_STATUSES = [
  'not_started',
  'requested',
  'received',
  'verified',
  'missing',
  'needs_correction',
  'not_applicable',
] as const;
export type KycStatus = (typeof KYC_STATUSES)[number];

export const KYC_REVIEW_STATUSES = [
  'not_started',
  'in_progress',
  'pending_review',
  'approved',
  'rejected',
] as const;
export type KycReviewStatus = (typeof KYC_REVIEW_STATUSES)[number];

export interface KycRequirement {
  key: string;
  category: KycCategory;
  required: boolean;
  /** Category of the document expected; never uploaded by this mission. */
  labelKey: string;
  hintKey: string;
}

/**
 * Baseline checklist. It is deliberately generic and configurable: the firm can
 * mark an item `not_applicable`. It is **not** an official CDD/AML requirement
 * list and must be reviewed by the firm before production use.
 */
export const KYC_TEMPLATE: KycRequirement[] = [
  {
    key: 'company_registration_certificate',
    category: 'company_identity',
    required: true,
    labelKey: 'm44.kyc.item.registration',
    hintKey: 'm44.kyc.item.registration.hint',
  },
  {
    key: 'business_registration_number_proof',
    category: 'company_identity',
    required: true,
    labelKey: 'm44.kyc.item.brn',
    hintKey: 'm44.kyc.item.brn.hint',
  },
  {
    key: 'company_constitution',
    category: 'company_identity',
    required: false,
    labelKey: 'm44.kyc.item.constitution',
    hintKey: 'm44.kyc.item.constitution.hint',
  },
  {
    key: 'directors_register',
    category: 'directors',
    required: true,
    labelKey: 'm44.kyc.item.directors',
    hintKey: 'm44.kyc.item.directors.hint',
  },
  {
    key: 'authorised_representatives',
    category: 'directors',
    required: true,
    labelKey: 'm44.kyc.item.representatives',
    hintKey: 'm44.kyc.item.representatives.hint',
  },
  {
    key: 'beneficial_owners_register',
    category: 'beneficial_owners',
    required: true,
    labelKey: 'm44.kyc.item.bo',
    hintKey: 'm44.kyc.item.bo.hint',
  },
  {
    key: 'ownership_structure',
    category: 'beneficial_owners',
    required: false,
    labelKey: 'm44.kyc.item.ownership',
    hintKey: 'm44.kyc.item.ownership.hint',
  },
  {
    key: 'director_identity_documents',
    category: 'identity_documents',
    required: true,
    labelKey: 'm44.kyc.item.idDirectors',
    hintKey: 'm44.kyc.item.idDirectors.hint',
  },
  {
    key: 'beneficial_owner_identity_documents',
    category: 'identity_documents',
    required: true,
    labelKey: 'm44.kyc.item.idBo',
    hintKey: 'm44.kyc.item.idBo.hint',
  },
  {
    key: 'brn_certificate',
    category: 'registration_documents',
    required: true,
    labelKey: 'm44.kyc.item.brnCertificate',
    hintKey: 'm44.kyc.item.brnCertificate.hint',
  },
  {
    key: 'vat_registration_certificate',
    category: 'registration_documents',
    required: false,
    labelKey: 'm44.kyc.item.vatCertificate',
    hintKey: 'm44.kyc.item.vatCertificate.hint',
  },
  {
    key: 'business_address_proof',
    category: 'proof_of_address',
    required: true,
    labelKey: 'm44.kyc.item.address',
    hintKey: 'm44.kyc.item.address.hint',
  },
  {
    key: 'bank_details_letter',
    category: 'supporting_documents',
    required: false,
    labelKey: 'm44.kyc.item.bankLetter',
    hintKey: 'm44.kyc.item.bankLetter.hint',
  },
  {
    key: 'latest_financial_statements',
    category: 'supporting_documents',
    required: false,
    labelKey: 'm44.kyc.item.statements',
    hintKey: 'm44.kyc.item.statements.hint',
  },
];

/* --------------------------------------------------------- accounting setup */

/**
 * Only the accrual double-entry basis is implemented by the COMPTAI engine.
 * The cash basis is listed in the UI as unavailable rather than silently
 * recorded: that would produce statements the engine cannot honour.
 */
export const ACCOUNTING_BASES = ['accrual'] as const;
export type AccountingBasis = (typeof ACCOUNTING_BASES)[number];

export const CHART_CHOICES = ['provisional_template', 'import_later'] as const;
export type ChartChoice = (typeof CHART_CHOICES)[number];

export const OPENING_BALANCE_CHOICES = ['existing_screen', 'later', 'not_applicable'] as const;
export type OpeningBalanceChoice = (typeof OPENING_BALANCE_CHOICES)[number];

export const TAX_REGISTRATION_CHOICES = ['registered', 'not_registered', 'to_confirm'] as const;
export type TaxRegistrationChoice = (typeof TAX_REGISTRATION_CHOICES)[number];

/* ------------------------------------------------------------ shared shapes */

export interface AccountingSetup {
  accountingBasis: AccountingBasis | null;
  chartChoice: ChartChoice | null;
  openingBalanceChoice: OpeningBalanceChoice | null;
  bankAccountsReviewed: boolean;
  taxRegistration: TaxRegistrationChoice | null;
  vatRegistered: boolean;
  notes: string | null;
}

export const EMPTY_ACCOUNTING_SETUP: AccountingSetup = {
  accountingBasis: null,
  chartChoice: null,
  openingBalanceChoice: null,
  bankAccountsReviewed: false,
  taxRegistration: null,
  vatRegistered: false,
  notes: null,
};

export function normaliseAccountingSetup(value: unknown): AccountingSetup {
  const raw = (value ?? {}) as Partial<AccountingSetup>;
  return {
    accountingBasis: (ACCOUNTING_BASES as readonly string[]).includes(String(raw.accountingBasis))
      ? (raw.accountingBasis as AccountingBasis)
      : null,
    chartChoice: (CHART_CHOICES as readonly string[]).includes(String(raw.chartChoice))
      ? (raw.chartChoice as ChartChoice)
      : null,
    openingBalanceChoice: (OPENING_BALANCE_CHOICES as readonly string[]).includes(
      String(raw.openingBalanceChoice),
    )
      ? (raw.openingBalanceChoice as OpeningBalanceChoice)
      : null,
    bankAccountsReviewed: raw.bankAccountsReviewed === true,
    taxRegistration: (TAX_REGISTRATION_CHOICES as readonly string[]).includes(
      String(raw.taxRegistration),
    )
      ? (raw.taxRegistration as TaxRegistrationChoice)
      : null,
    vatRegistered: raw.vatRegistered === true,
    notes: typeof raw.notes === 'string' && raw.notes.trim() ? raw.notes.trim().slice(0, 2000) : null,
  };
}
