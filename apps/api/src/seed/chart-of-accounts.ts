/**
 * DEMONSTRATION chart of accounts — NOT an official Mauritian chart.
 *
 * Mauritius does not prescribe a single mandatory chart of accounts for private
 * companies; the IFRS presentation structure is used here only as a starting
 * template. The user is free to create, edit and deactivate accounts.
 * Codes are a 4-digit numbering convention chosen for this application.
 */
export interface SeedAccount {
  code: string;
  name: string;
  nameEn: string;
  type: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';
  fsMapping: string;
}

export const DEMO_CHART_OF_ACCOUNTS: SeedAccount[] = [
  // Assets
  { code: '1000', name: 'Caisse', nameEn: 'Cash on hand', type: 'asset', fsMapping: 'bs.current_assets.cash_and_equivalents' },
  { code: '1010', name: 'Banque — compte courant MUR', nameEn: 'Bank — MUR current account', type: 'asset', fsMapping: 'bs.current_assets.cash_and_equivalents' },
  { code: '1015', name: 'Banque — compte courant devises', nameEn: 'Bank — foreign currency account', type: 'asset', fsMapping: 'bs.current_assets.cash_and_equivalents' },
  { code: '1100', name: 'Clients', nameEn: 'Trade receivables', type: 'asset', fsMapping: 'bs.current_assets.receivables' },
  { code: '1150', name: 'Autres débiteurs et charges payées d’avance', nameEn: 'Other receivables and prepayments', type: 'asset', fsMapping: 'bs.current_assets.receivables' },
  { code: '1200', name: 'TVA récupérable', nameEn: 'VAT recoverable (input)', type: 'asset', fsMapping: 'bs.current_assets.receivables' },
  { code: '1300', name: 'Stocks', nameEn: 'Inventory', type: 'asset', fsMapping: 'bs.current_assets.inventory' },
  { code: '1500', name: 'Immobilisations corporelles', nameEn: 'Property, plant and equipment', type: 'asset', fsMapping: 'bs.non_current_assets.property_plant_equipment' },
  { code: '1510', name: 'Amortissements cumulés', nameEn: 'Accumulated depreciation', type: 'asset', fsMapping: 'bs.non_current_assets.property_plant_equipment' },
  { code: '1600', name: 'Immobilisations incorporelles', nameEn: 'Intangible assets', type: 'asset', fsMapping: 'bs.non_current_assets.intangible' },

  // Liabilities
  { code: '2000', name: 'Fournisseurs', nameEn: 'Trade payables', type: 'liability', fsMapping: 'bs.current_liabilities.payables' },
  { code: '2100', name: 'Charges à payer et produits constatés d’avance', nameEn: 'Accruals and deferred income', type: 'liability', fsMapping: 'bs.current_liabilities.other' },
  { code: '2200', name: 'TVA collectée', nameEn: 'VAT payable (output)', type: 'liability', fsMapping: 'bs.current_liabilities.tax' },
  { code: '2300', name: 'PAYE à payer (provisoire)', nameEn: 'PAYE payable (provisional)', type: 'liability', fsMapping: 'bs.current_liabilities.tax' },
  { code: '2400', name: 'CSG à payer (provisoire)', nameEn: 'CSG payable (provisional)', type: 'liability', fsMapping: 'bs.current_liabilities.tax' },
  { code: '2500', name: 'Emprunts bancaires', nameEn: 'Bank borrowings', type: 'liability', fsMapping: 'bs.non_current_liabilities.borrowings' },

  // Equity
  { code: '3000', name: 'Capital social', nameEn: 'Share capital', type: 'equity', fsMapping: 'bs.equity.share_capital' },
  { code: '3100', name: 'Report à nouveau', nameEn: 'Retained earnings', type: 'equity', fsMapping: 'bs.equity.retained_earnings' },
  { code: '3200', name: 'Réserves', nameEn: 'Reserves', type: 'equity', fsMapping: 'bs.equity.reserves' },

  // Revenue
  { code: '4000', name: 'Ventes de marchandises', nameEn: 'Revenue — sale of goods', type: 'revenue', fsMapping: 'pl.revenue' },
  { code: '4010', name: 'Prestations de services', nameEn: 'Revenue — services', type: 'revenue', fsMapping: 'pl.revenue' },
  { code: '4100', name: 'Autres produits', nameEn: 'Other income', type: 'revenue', fsMapping: 'pl.other_income' },

  // Expenses
  { code: '5000', name: 'Achats de marchandises', nameEn: 'Purchases of goods', type: 'expense', fsMapping: 'pl.cost_of_sales' },
  { code: '5100', name: 'Variation de stocks', nameEn: 'Change in inventory', type: 'expense', fsMapping: 'pl.cost_of_sales' },
  { code: '6000', name: 'Salaires et traitements', nameEn: 'Salaries and wages', type: 'expense', fsMapping: 'pl.operating_expenses' },
  { code: '6010', name: 'Charges sociales patronales', nameEn: 'Employer social contributions', type: 'expense', fsMapping: 'pl.operating_expenses' },
  { code: '6100', name: 'Loyers', nameEn: 'Rent', type: 'expense', fsMapping: 'pl.operating_expenses' },
  { code: '6110', name: 'Eau et électricité', nameEn: 'Utilities', type: 'expense', fsMapping: 'pl.operating_expenses' },
  { code: '6120', name: 'Téléphone et internet', nameEn: 'Telephone and internet', type: 'expense', fsMapping: 'pl.operating_expenses' },
  { code: '6130', name: 'Honoraires professionnels', nameEn: 'Professional fees', type: 'expense', fsMapping: 'pl.operating_expenses' },
  { code: '6140', name: 'Frais bancaires', nameEn: 'Bank charges', type: 'expense', fsMapping: 'pl.finance_costs' },
  { code: '6150', name: 'Assurances', nameEn: 'Insurance', type: 'expense', fsMapping: 'pl.operating_expenses' },
  { code: '6200', name: 'Dotations aux amortissements', nameEn: 'Depreciation expense', type: 'expense', fsMapping: 'pl.operating_expenses' },
  { code: '6300', name: 'Écarts de change (provisoire)', nameEn: 'Exchange differences (provisional)', type: 'expense', fsMapping: 'pl.finance_costs' },
  { code: '7000', name: 'Impôt sur les sociétés (provisoire)', nameEn: 'Income tax expense (provisional)', type: 'expense', fsMapping: 'pl.tax_expense' },
];

export interface SeedJournal {
  code: string;
  name: string;
  nameEn: string;
  type: 'sales' | 'purchases' | 'bank' | 'cash' | 'general';
}

export const DEFAULT_JOURNALS: SeedJournal[] = [
  { code: 'SAL', name: 'Journal des ventes', nameEn: 'Sales journal', type: 'sales' },
  { code: 'PUR', name: 'Journal des achats', nameEn: 'Purchases journal', type: 'purchases' },
  { code: 'BQ', name: 'Journal de banque', nameEn: 'Bank journal', type: 'bank' },
  { code: 'CA', name: 'Journal de caisse', nameEn: 'Cash journal', type: 'cash' },
  { code: 'OD', name: 'Opérations diverses', nameEn: 'General journal', type: 'general' },
];
