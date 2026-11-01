/**
 * Fictional demonstration dataset for the browser-only demo build.
 *
 * Extracted from the API's own demo seed: every name, BRN/VAT number, address and
 * amount is invented. It is embedded in the static bundle so GitHub Pages can run
 * the interface without any backend, database or secret.
 *
 * Never add real client data here.
 */
export interface DemoSeedAccount {
  code: string;
  name: string;
  name_fr?: string | null;
  type: string;
  parent_code: string | null;
  currency: string;
  is_active: boolean;
  fs_mapping: string | null;
  description: string | null;
}
export interface DemoSeedJournal {
  code: string;
  name: string;
  type: string;
}
export interface DemoSeedLine {
  account_code: string;
  description: string | null;
  debit: string;
  credit: string;
  txn_amount: string | null;
  txn_currency: string;
  fx_rate: string | null;
}
export interface DemoSeedEntry {
  entry_no: string;
  journal_code: string;
  entry_date: string;
  reference: string | null;
  description: string;
  currency: string;
  exchange_rate: string;
  status: 'draft' | 'posted';
  source: string;
  reversal_of: string | null;
  lines: DemoSeedLine[];
}
export interface DemoSeed {
  company: Record<string, string | null>;
  accounts: DemoSeedAccount[];
  journals: DemoSeedJournal[];
  entries: DemoSeedEntry[];
}

export const DEMO_SEED: DemoSeed = {
  "company": {
    "name": "Island Trading Ltd — DEMO COMPANY",
    "brn": "DEMO-BRN-0001",
    "vat_number": "DEMO-VAT-0001",
    "registered_address": "12, Royal Road, Port Louis, Mauritius (fictitious address)",
    "business_activity": "Wholesale of household goods (fictitious activity)",
    "financial_year_start": "2025-07-01",
    "financial_year_end": "2026-06-30",
    "functional_currency": "MUR",
    "presentation_currency": "MUR",
    "accounting_standard": "Other",
    "status": "active",
    "locale": "en"
  },
  "accounts": [
    {
      "code": "1000",
      "name": "Cash",
      "name_fr": "Caisse",
      "type": "asset",
      "parent_code": null,
      "currency": "MUR",
      "is_active": true,
      "fs_mapping": "bs.current_assets.cash_and_equivalents",
      "description": "DEMO account — not an official chart of accounts / Compte de démonstration"
    },
    {
      "code": "1010",
      "name": "Bank — MUR current account",
      "name_fr": "Banque — compte courant MUR",
      "type": "asset",
      "parent_code": null,
      "currency": "MUR",
      "is_active": true,
      "fs_mapping": "bs.current_assets.cash_and_equivalents",
      "description": "DEMO account — not an official chart of accounts / Compte de démonstration"
    },
    {
      "code": "1015",
      "name": "Bank — foreign currency account",
      "name_fr": "Banque — compte courant devises",
      "type": "asset",
      "parent_code": null,
      "currency": "MUR",
      "is_active": true,
      "fs_mapping": "bs.current_assets.cash_and_equivalents",
      "description": "DEMO account — not an official chart of accounts / Compte de démonstration"
    },
    {
      "code": "1100",
      "name": "Trade receivables",
      "name_fr": "Clients",
      "type": "asset",
      "parent_code": null,
      "currency": "MUR",
      "is_active": true,
      "fs_mapping": "bs.current_assets.receivables",
      "description": "DEMO account — not an official chart of accounts / Compte de démonstration"
    },
    {
      "code": "1150",
      "name": "Other receivables and prepayments",
      "name_fr": "Autres débiteurs et charges payées d’avance",
      "type": "asset",
      "parent_code": null,
      "currency": "MUR",
      "is_active": true,
      "fs_mapping": "bs.current_assets.receivables",
      "description": "DEMO account — not an official chart of accounts / Compte de démonstration"
    },
    {
      "code": "1200",
      "name": "VAT recoverable (preliminary)",
      "name_fr": "TVA récupérable",
      "type": "asset",
      "parent_code": null,
      "currency": "MUR",
      "is_active": true,
      "fs_mapping": "bs.current_assets.receivables",
      "description": "DEMO account — not an official chart of accounts / Compte de démonstration"
    },
    {
      "code": "1300",
      "name": "Inventory",
      "name_fr": "Stocks",
      "type": "asset",
      "parent_code": null,
      "currency": "MUR",
      "is_active": true,
      "fs_mapping": "bs.current_assets.inventory",
      "description": "DEMO account — not an official chart of accounts / Compte de démonstration"
    },
    {
      "code": "1500",
      "name": "Property, plant and equipment",
      "name_fr": "Immobilisations corporelles",
      "type": "asset",
      "parent_code": null,
      "currency": "MUR",
      "is_active": true,
      "fs_mapping": "bs.non_current_assets.property_plant_equipment",
      "description": "DEMO account — not an official chart of accounts / Compte de démonstration"
    },
    {
      "code": "1510",
      "name": "Accumulated depreciation",
      "name_fr": "Amortissements cumulés",
      "type": "asset",
      "parent_code": null,
      "currency": "MUR",
      "is_active": true,
      "fs_mapping": "bs.non_current_assets.property_plant_equipment",
      "description": "DEMO account — not an official chart of accounts / Compte de démonstration"
    },
    {
      "code": "1600",
      "name": "Intangible assets",
      "name_fr": "Immobilisations incorporelles",
      "type": "asset",
      "parent_code": null,
      "currency": "MUR",
      "is_active": true,
      "fs_mapping": "bs.non_current_assets.intangible",
      "description": "DEMO account — not an official chart of accounts / Compte de démonstration"
    },
    {
      "code": "2000",
      "name": "Trade payables",
      "name_fr": "Fournisseurs",
      "type": "liability",
      "parent_code": null,
      "currency": "MUR",
      "is_active": true,
      "fs_mapping": "bs.current_liabilities.payables",
      "description": "DEMO account — not an official chart of accounts / Compte de démonstration"
    },
    {
      "code": "2100",
      "name": "Accruals and deferred income",
      "name_fr": "Charges à payer et produits constatés d’avance",
      "type": "liability",
      "parent_code": null,
      "currency": "MUR",
      "is_active": true,
      "fs_mapping": "bs.current_liabilities.other",
      "description": "DEMO account — not an official chart of accounts / Compte de démonstration"
    },
    {
      "code": "2200",
      "name": "VAT payable (preliminary)",
      "name_fr": "TVA collectée",
      "type": "liability",
      "parent_code": null,
      "currency": "MUR",
      "is_active": true,
      "fs_mapping": "bs.current_liabilities.tax",
      "description": "DEMO account — not an official chart of accounts / Compte de démonstration"
    },
    {
      "code": "2300",
      "name": "PAYE payable (preliminary)",
      "name_fr": "PAYE à payer (provisoire)",
      "type": "liability",
      "parent_code": null,
      "currency": "MUR",
      "is_active": true,
      "fs_mapping": "bs.current_liabilities.tax",
      "description": "DEMO account — not an official chart of accounts / Compte de démonstration"
    },
    {
      "code": "2400",
      "name": "CSG payable (preliminary)",
      "name_fr": "CSG à payer (provisoire)",
      "type": "liability",
      "parent_code": null,
      "currency": "MUR",
      "is_active": true,
      "fs_mapping": "bs.current_liabilities.tax",
      "description": "DEMO account — not an official chart of accounts / Compte de démonstration"
    },
    {
      "code": "2500",
      "name": "Bank borrowings",
      "name_fr": "Emprunts bancaires",
      "type": "liability",
      "parent_code": null,
      "currency": "MUR",
      "is_active": true,
      "fs_mapping": "bs.non_current_liabilities.borrowings",
      "description": "DEMO account — not an official chart of accounts / Compte de démonstration"
    },
    {
      "code": "3000",
      "name": "Share capital",
      "name_fr": "Capital social",
      "type": "equity",
      "parent_code": null,
      "currency": "MUR",
      "is_active": true,
      "fs_mapping": "bs.equity.share_capital",
      "description": "DEMO account — not an official chart of accounts / Compte de démonstration"
    },
    {
      "code": "3100",
      "name": "Retained earnings",
      "name_fr": "Report à nouveau",
      "type": "equity",
      "parent_code": null,
      "currency": "MUR",
      "is_active": true,
      "fs_mapping": "bs.equity.retained_earnings",
      "description": "DEMO account — not an official chart of accounts / Compte de démonstration"
    },
    {
      "code": "3200",
      "name": "Reserves",
      "name_fr": "Réserves",
      "type": "equity",
      "parent_code": null,
      "currency": "MUR",
      "is_active": true,
      "fs_mapping": "bs.equity.reserves",
      "description": "DEMO account — not an official chart of accounts / Compte de démonstration"
    },
    {
      "code": "4000",
      "name": "Sales of goods",
      "name_fr": "Ventes de marchandises",
      "type": "revenue",
      "parent_code": null,
      "currency": "MUR",
      "is_active": true,
      "fs_mapping": "pl.revenue",
      "description": "DEMO account — not an official chart of accounts / Compte de démonstration"
    },
    {
      "code": "4010",
      "name": "Service revenue",
      "name_fr": "Prestations de services",
      "type": "revenue",
      "parent_code": null,
      "currency": "MUR",
      "is_active": true,
      "fs_mapping": "pl.revenue",
      "description": "DEMO account — not an official chart of accounts / Compte de démonstration"
    },
    {
      "code": "4100",
      "name": "Other income",
      "name_fr": "Autres produits",
      "type": "revenue",
      "parent_code": null,
      "currency": "MUR",
      "is_active": true,
      "fs_mapping": "pl.other_income",
      "description": "DEMO account — not an official chart of accounts / Compte de démonstration"
    },
    {
      "code": "5000",
      "name": "Purchases of goods",
      "name_fr": "Achats de marchandises",
      "type": "expense",
      "parent_code": null,
      "currency": "MUR",
      "is_active": true,
      "fs_mapping": "pl.cost_of_sales",
      "description": "DEMO account — not an official chart of accounts / Compte de démonstration"
    },
    {
      "code": "5100",
      "name": "Change in inventory",
      "name_fr": "Variation de stocks",
      "type": "expense",
      "parent_code": null,
      "currency": "MUR",
      "is_active": true,
      "fs_mapping": "pl.cost_of_sales",
      "description": "DEMO account — not an official chart of accounts / Compte de démonstration"
    },
    {
      "code": "6000",
      "name": "Salaries and wages",
      "name_fr": "Salaires et traitements",
      "type": "expense",
      "parent_code": null,
      "currency": "MUR",
      "is_active": true,
      "fs_mapping": "pl.operating_expenses",
      "description": "DEMO account — not an official chart of accounts / Compte de démonstration"
    },
    {
      "code": "6010",
      "name": "Employer social contributions",
      "name_fr": "Charges sociales patronales",
      "type": "expense",
      "parent_code": null,
      "currency": "MUR",
      "is_active": true,
      "fs_mapping": "pl.operating_expenses",
      "description": "DEMO account — not an official chart of accounts / Compte de démonstration"
    },
    {
      "code": "6100",
      "name": "Rent",
      "name_fr": "Loyers",
      "type": "expense",
      "parent_code": null,
      "currency": "MUR",
      "is_active": true,
      "fs_mapping": "pl.operating_expenses",
      "description": "DEMO account — not an official chart of accounts / Compte de démonstration"
    },
    {
      "code": "6110",
      "name": "Utilities",
      "name_fr": "Eau et électricité",
      "type": "expense",
      "parent_code": null,
      "currency": "MUR",
      "is_active": true,
      "fs_mapping": "pl.operating_expenses",
      "description": "DEMO account — not an official chart of accounts / Compte de démonstration"
    },
    {
      "code": "6120",
      "name": "Telephone and internet",
      "name_fr": "Téléphone et internet",
      "type": "expense",
      "parent_code": null,
      "currency": "MUR",
      "is_active": true,
      "fs_mapping": "pl.operating_expenses",
      "description": "DEMO account — not an official chart of accounts / Compte de démonstration"
    },
    {
      "code": "6130",
      "name": "Professional fees",
      "name_fr": "Honoraires professionnels",
      "type": "expense",
      "parent_code": null,
      "currency": "MUR",
      "is_active": true,
      "fs_mapping": "pl.operating_expenses",
      "description": "DEMO account — not an official chart of accounts / Compte de démonstration"
    },
    {
      "code": "6140",
      "name": "Bank charges",
      "name_fr": "Frais bancaires",
      "type": "expense",
      "parent_code": null,
      "currency": "MUR",
      "is_active": true,
      "fs_mapping": "pl.finance_costs",
      "description": "DEMO account — not an official chart of accounts / Compte de démonstration"
    },
    {
      "code": "6150",
      "name": "Insurance",
      "name_fr": "Assurances",
      "type": "expense",
      "parent_code": null,
      "currency": "MUR",
      "is_active": true,
      "fs_mapping": "pl.operating_expenses",
      "description": "DEMO account — not an official chart of accounts / Compte de démonstration"
    },
    {
      "code": "6200",
      "name": "Depreciation expense",
      "name_fr": "Dotations aux amortissements",
      "type": "expense",
      "parent_code": null,
      "currency": "MUR",
      "is_active": true,
      "fs_mapping": "pl.operating_expenses",
      "description": "DEMO account — not an official chart of accounts / Compte de démonstration"
    },
    {
      "code": "6300",
      "name": "Foreign exchange differences (preliminary)",
      "name_fr": "Écarts de change (provisoire)",
      "type": "expense",
      "parent_code": null,
      "currency": "MUR",
      "is_active": true,
      "fs_mapping": "pl.finance_costs",
      "description": "DEMO account — not an official chart of accounts / Compte de démonstration"
    },
    {
      "code": "7000",
      "name": "Corporate income tax (preliminary)",
      "name_fr": "Impôt sur les sociétés (provisoire)",
      "type": "expense",
      "parent_code": null,
      "currency": "MUR",
      "is_active": true,
      "fs_mapping": "pl.tax_expense",
      "description": "DEMO account — not an official chart of accounts / Compte de démonstration"
    }
  ],
  "journals": [
    {
      "code": "BQ",
      "name": "Bank journal",
      "type": "bank"
    },
    {
      "code": "CA",
      "name": "Cash journal",
      "type": "cash"
    },
    {
      "code": "OD",
      "name": "General journal",
      "type": "general"
    },
    {
      "code": "PUR",
      "name": "Purchases journal",
      "type": "purchases"
    },
    {
      "code": "SAL",
      "name": "Sales journal",
      "type": "sales"
    }
  ],
  "entries": [
    {
      "entry_no": "OD-2025-0001",
      "journal_code": "OD",
      "entry_date": "2025-07-01",
      "reference": "DEMO-CAP-001",
      "description": "Opening capital — fictitious data",
      "currency": "MUR",
      "exchange_rate": "1.00000000",
      "status": "posted",
      "source": "manual",
      "reversal_of": null,
      "lines": [
        {
          "account_code": "1010",
          "description": null,
          "debit": "500000.0000",
          "credit": "0.0000",
          "txn_amount": "500000.0000",
          "txn_currency": "MUR",
          "fx_rate": "1.00000000"
        },
        {
          "account_code": "3000",
          "description": null,
          "debit": "0.0000",
          "credit": "500000.0000",
          "txn_amount": "500000.0000",
          "txn_currency": "MUR",
          "fx_rate": "1.00000000"
        }
      ]
    },
    {
      "entry_no": "BQ-2025-0001",
      "journal_code": "BQ",
      "entry_date": "2025-07-10",
      "reference": "DEMO-EQP-001",
      "description": "Computer equipment purchase — demonstration",
      "currency": "MUR",
      "exchange_rate": "1.00000000",
      "status": "posted",
      "source": "manual",
      "reversal_of": null,
      "lines": [
        {
          "account_code": "1500",
          "description": null,
          "debit": "120000.0000",
          "credit": "0.0000",
          "txn_amount": "120000.0000",
          "txn_currency": "MUR",
          "fx_rate": "1.00000000"
        },
        {
          "account_code": "1010",
          "description": null,
          "debit": "0.0000",
          "credit": "120000.0000",
          "txn_amount": "120000.0000",
          "txn_currency": "MUR",
          "fx_rate": "1.00000000"
        }
      ]
    },
    {
      "entry_no": "SAL-2025-0001",
      "journal_code": "SAL",
      "entry_date": "2025-07-15",
      "reference": "FA-2025-001",
      "description": "Fictitious sales invoice FA-2025-001",
      "currency": "MUR",
      "exchange_rate": "1.00000000",
      "status": "posted",
      "source": "manual",
      "reversal_of": null,
      "lines": [
        {
          "account_code": "1100",
          "description": null,
          "debit": "125000.0000",
          "credit": "0.0000",
          "txn_amount": "125000.0000",
          "txn_currency": "MUR",
          "fx_rate": "1.00000000"
        },
        {
          "account_code": "4000",
          "description": null,
          "debit": "0.0000",
          "credit": "125000.0000",
          "txn_amount": "125000.0000",
          "txn_currency": "MUR",
          "fx_rate": "1.00000000"
        }
      ]
    },
    {
      "entry_no": "PUR-2025-0001",
      "journal_code": "PUR",
      "entry_date": "2025-07-20",
      "reference": "AC-2025-001",
      "description": "Fictitious goods purchase AC-2025-001",
      "currency": "MUR",
      "exchange_rate": "1.00000000",
      "status": "posted",
      "source": "manual",
      "reversal_of": null,
      "lines": [
        {
          "account_code": "5000",
          "description": null,
          "debit": "60000.0000",
          "credit": "0.0000",
          "txn_amount": "60000.0000",
          "txn_currency": "MUR",
          "fx_rate": "1.00000000"
        },
        {
          "account_code": "2000",
          "description": null,
          "debit": "0.0000",
          "credit": "60000.0000",
          "txn_amount": "60000.0000",
          "txn_currency": "MUR",
          "fx_rate": "1.00000000"
        }
      ]
    },
    {
      "entry_no": "BQ-2025-0002",
      "journal_code": "BQ",
      "entry_date": "2025-08-01",
      "reference": "LOY-2025-08",
      "description": "August rent — demonstration",
      "currency": "MUR",
      "exchange_rate": "1.00000000",
      "status": "posted",
      "source": "manual",
      "reversal_of": null,
      "lines": [
        {
          "account_code": "6100",
          "description": null,
          "debit": "15000.0000",
          "credit": "0.0000",
          "txn_amount": "15000.0000",
          "txn_currency": "MUR",
          "fx_rate": "1.00000000"
        },
        {
          "account_code": "1010",
          "description": null,
          "debit": "0.0000",
          "credit": "15000.0000",
          "txn_amount": "15000.0000",
          "txn_currency": "MUR",
          "fx_rate": "1.00000000"
        }
      ]
    },
    {
      "entry_no": "BQ-2025-0003",
      "journal_code": "BQ",
      "entry_date": "2025-08-05",
      "reference": "ENC-2025-001",
      "description": "Receipt from fictitious customer FA-2025-001",
      "currency": "MUR",
      "exchange_rate": "1.00000000",
      "status": "posted",
      "source": "manual",
      "reversal_of": null,
      "lines": [
        {
          "account_code": "1010",
          "description": null,
          "debit": "125000.0000",
          "credit": "0.0000",
          "txn_amount": "125000.0000",
          "txn_currency": "MUR",
          "fx_rate": "1.00000000"
        },
        {
          "account_code": "1100",
          "description": null,
          "debit": "0.0000",
          "credit": "125000.0000",
          "txn_amount": "125000.0000",
          "txn_currency": "MUR",
          "fx_rate": "1.00000000"
        }
      ]
    },
    {
      "entry_no": "SAL-2025-0002",
      "journal_code": "SAL",
      "entry_date": "2025-08-12",
      "reference": "FA-EUR-001",
      "description": "EUR sale — manually entered rate (demo)",
      "currency": "EUR",
      "exchange_rate": "48.50000000",
      "status": "posted",
      "source": "manual",
      "reversal_of": null,
      "lines": [
        {
          "account_code": "1100",
          "description": null,
          "debit": "48500.0000",
          "credit": "0.0000",
          "txn_amount": "1000.0000",
          "txn_currency": "EUR",
          "fx_rate": "48.50000000"
        },
        {
          "account_code": "4010",
          "description": null,
          "debit": "0.0000",
          "credit": "48500.0000",
          "txn_amount": "1000.0000",
          "txn_currency": "EUR",
          "fx_rate": "48.50000000"
        }
      ]
    },
    {
      "entry_no": "OD-2025-0002",
      "journal_code": "OD",
      "entry_date": "2025-08-20",
      "reference": "BROUILLON-001",
      "description": "Draft — bank charges to confirm (not posted)",
      "currency": "MUR",
      "exchange_rate": "1.00000000",
      "status": "draft",
      "source": "manual",
      "reversal_of": null,
      "lines": [
        {
          "account_code": "6140",
          "description": null,
          "debit": "1200.0000",
          "credit": "0.0000",
          "txn_amount": "1200.0000",
          "txn_currency": "MUR",
          "fx_rate": "1.00000000"
        },
        {
          "account_code": "1010",
          "description": null,
          "debit": "0.0000",
          "credit": "1200.0000",
          "txn_amount": "1200.0000",
          "txn_currency": "MUR",
          "fx_rate": "1.00000000"
        }
      ]
    },
    {
      "entry_no": "BQ-2025-0004",
      "journal_code": "BQ",
      "entry_date": "2025-09-01",
      "reference": "LOY-2025-08-ANN",
      "description": "Reversal of August rent (demo)",
      "currency": "MUR",
      "exchange_rate": "1.00000000",
      "status": "posted",
      "source": "reversal",
      "reversal_of": "BQ-2025-0002",
      "lines": [
        {
          "account_code": "6100",
          "description": null,
          "debit": "0.0000",
          "credit": "15000.0000",
          "txn_amount": "15000.0000",
          "txn_currency": "MUR",
          "fx_rate": "1.00000000"
        },
        {
          "account_code": "1010",
          "description": null,
          "debit": "15000.0000",
          "credit": "0.0000",
          "txn_amount": "15000.0000",
          "txn_currency": "MUR",
          "fx_rate": "1.00000000"
        }
      ]
    }
  ]
};
