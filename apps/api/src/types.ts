import type { Locale } from './i18n/index.js';

/**
 * Company role. `owner`, `admin`, `accountant` and `viewer` are the historical
 * V0.1 roles; the cabinet vocabulary is additive (migration 0004).
 */
export type CompanyRole =
  | 'owner'
  | 'admin'
  | 'cabinet_admin'
  | 'manager'
  | 'accountant'
  | 'billing_clerk'
  | 'payroll_manager'
  | 'viewer';

export const COMPANY_ROLES: CompanyRole[] = [
  'owner',
  'admin',
  'cabinet_admin',
  'manager',
  'accountant',
  'billing_clerk',
  'payroll_manager',
  'viewer',
];

export const ROLE_WEIGHT: Record<CompanyRole, number> = {
  viewer: 1,
  accountant: 2,
  billing_clerk: 2,
  payroll_manager: 2,
  manager: 3,
  admin: 4,
  owner: 5,
  cabinet_admin: 5,
};

/** Modules of the Mauritius Business Suite. */
export type ModuleName = 'cabinet' | 'accounting' | 'billing' | 'payroll';
export type AccessLevel = 'none' | 'read' | 'write' | 'admin';

export const TASK_CATEGORIES = [
  'accounting',
  'vat',
  'tax',
  'payroll',
  'financial_statements',
  'administrative',
] as const;
export type TaskCategory = (typeof TASK_CATEGORIES)[number];

export const TASK_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const TASK_STATUSES = ['todo', 'in_progress', 'blocked', 'done', 'cancelled'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  full_name: string;
  locale: Locale;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface PublicUser {
  id: string;
  email: string;
  fullName: string;
  locale: Locale;
}

export interface CompanyRow {
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
  locale: Locale;
  created_at: string;
  updated_at: string;
}

export interface AccountRow {
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

export interface JournalRow {
  id: string;
  company_id: string;
  code: string;
  name: string;
  type: 'sales' | 'purchases' | 'bank' | 'cash' | 'general';
  is_active: boolean;
}

export interface EntryRow {
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
  source: 'manual' | 'reversal' | 'opening';
  reversal_of_entry_id: string | null;
  posted_at: string | null;
  created_at: string;
}

export interface LineRow {
  id: string;
  entry_id: string;
  company_id: string;
  line_no: number;
  account_id: string;
  description: string | null;
  debit: string;
  credit: string;
  txn_currency: string;
  txn_amount: string | null;
  fx_rate: string | null;
}

export interface CompanyContext {
  company: CompanyRow;
  role: CompanyRole;
}

export const SUPPORTED_CURRENCIES = ['MUR', 'EUR', 'USD', 'GBP'] as const;
export type Currency = (typeof SUPPORTED_CURRENCIES)[number];

export const ACCOUNT_TYPES = ['asset', 'liability', 'equity', 'revenue', 'expense'] as const;
export const JOURNAL_TYPES = ['sales', 'purchases', 'bank', 'cash', 'general'] as const;
export const COMPANY_STATUSES = ['active', 'inactive', 'archived'] as const;
export const ACCOUNTING_STANDARDS = ['IFRS', 'IFRS for SMEs', 'Other'] as const;

export const FS_MAPPINGS = [
  'bs.non_current_assets.property_plant_equipment',
  'bs.non_current_assets.intangible',
  'bs.non_current_assets.investment_property',
  'bs.current_assets.inventory',
  'bs.current_assets.receivables',
  'bs.current_assets.cash_and_equivalents',
  'bs.non_current_liabilities.borrowings',
  'bs.non_current_liabilities.other',
  'bs.current_liabilities.payables',
  'bs.current_liabilities.tax',
  'bs.current_liabilities.other',
  'bs.equity.share_capital',
  'bs.equity.retained_earnings',
  'bs.equity.reserves',
  'pl.revenue',
  'pl.other_income',
  'pl.cost_of_sales',
  'pl.operating_expenses',
  'pl.finance_costs',
  'pl.tax_expense',
  'unmapped',
] as const;
