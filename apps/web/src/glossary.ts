/**
 * Mission 24 — canonical FR/EN accounting glossary.
 *
 * One concept, one pair of labels. The i18n dictionary imports these entries
 * for the main navigation and statement titles, so a label cannot drift
 * between two screens. Account numbers and company-defined account labels are
 * never translated by this file.
 */
export const GLOSSARY = {
  /**
   * The 25 FR/EN pairs required by mission 36. The list is deliberately
   * explicit: navigation, screen titles and future statements consume these
   * entries instead of retyping a translation on each screen. Two entries
   * (cost centres and cash flow) are prepared but not exposed in the sidebar
   * because the corresponding screen/API does not exist yet.
   */
  dashboard: { fr: 'Tableau de bord', en: 'Dashboard' },
  chartOfAccounts: { fr: 'Plan comptable', en: 'Chart of Accounts' },
  generalLedger: { fr: 'Grand livre', en: 'General Ledger' },
  trialBalance: { fr: 'Balance générale', en: 'Trial Balance' },
  journalEntries: { fr: 'Écritures comptables', en: 'Journal Entries' },
  journals: { fr: 'Journaux', en: 'Journals' },
  accountsReceivable: { fr: 'Comptes clients', en: 'Accounts Receivable' },
  accountsPayable: { fr: 'Comptes fournisseurs', en: 'Accounts Payable' },
  customers: { fr: 'Clients', en: 'Customers' },
  suppliers: { fr: 'Fournisseurs', en: 'Suppliers' },
  salesInvoices: { fr: 'Factures clients', en: 'Sales Invoices' },
  bills: { fr: 'Factures fournisseurs', en: 'Bills' },
  bankReconciliation: { fr: 'Rapprochement bancaire', en: 'Bank reconciliation' },
  statementOfProfitOrLoss: { fr: 'Compte de résultat', en: 'Profit & Loss' },
  balanceSheet: { fr: 'Bilan', en: 'Balance Sheet' },
  cashFlowStatement: { fr: 'Tableau des flux de trésorerie', en: 'Cash Flow Statement' },
  fixedAssets: { fr: 'Immobilisations', en: 'Fixed Assets' },
  inventory: { fr: 'Stocks', en: 'Inventory' },
  financialStatements: { fr: 'États financiers', en: 'Financial Statements' },
  yearEndClosing: { fr: 'Clôture annuelle', en: 'Year-End Closing' },
  auditTrail: { fr: 'Piste d’audit', en: 'Audit Trail' },
  accountingPeriods: { fr: 'Périodes comptables', en: 'Accounting Periods' },
  costCentres: { fr: 'Centres de coûts', en: 'Cost Centres' },
  openingBalances: { fr: 'Soldes d’ouverture', en: 'Opening Balances' },
  retainedEarnings: { fr: 'Résultats reportés', en: 'Retained Earnings' },
  // Mission 24 additions kept for the accrual/provision and MRA screens.
  prepayments: { fr: 'Charges constatées d’avance', en: 'Prepayments' },
  accruedExpenses: { fr: 'Charges à payer', en: 'Accrued expenses' },
  provisions: { fr: 'Provisions', en: 'Provisions' },
  payslip: { fr: 'Bulletin de paie', en: 'Payslip' },
  journalEntry: { fr: 'Écriture comptable', en: 'Journal entry' },
  accrualsAndPrepayments: { fr: 'Régularisations', en: 'Accruals & prepayments' },
  electronicBillingSystem: {
    fr: 'Système de facturation électronique (EBS)',
    en: 'Electronic Billing System (EBS)',
  },
  invoiceFiscalisationPlatform: {
    fr: 'Plateforme de fiscalisation des factures (IFP)',
    en: 'Invoice Fiscalisation Platform (IFP)',
  },
  invoiceRegistrationNumber: {
    fr: 'Numéro d’enregistrement de facture (IRN)',
    en: 'Invoice Registration Number (IRN)',
  },
} as const;

export type GlossaryKey = keyof typeof GLOSSARY;
