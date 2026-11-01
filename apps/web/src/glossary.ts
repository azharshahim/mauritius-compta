/**
 * Mission 24 — canonical FR/EN accounting glossary.
 *
 * One concept, one pair of labels. The i18n dictionary imports these entries
 * for the main navigation and statement titles, so a label cannot drift
 * between two screens. Account numbers and company-defined account labels are
 * never translated by this file.
 */
export const GLOSSARY = {
  chartOfAccounts: { fr: 'Plan comptable', en: 'Chart of Accounts' },
  generalLedger: { fr: 'Grand livre', en: 'General Ledger' },
  trialBalance: { fr: 'Balance générale', en: 'Trial Balance' },
  statementOfProfitOrLoss: { fr: 'Compte de résultat', en: 'Statement of Profit or Loss' },
  fixedAssets: { fr: 'Immobilisations', en: 'Fixed assets' },
  prepayments: { fr: 'Charges constatées d’avance', en: 'Prepayments' },
  accruedExpenses: { fr: 'Charges à payer', en: 'Accrued expenses' },
  provisions: { fr: 'Provisions', en: 'Provisions' },
  bankReconciliation: { fr: 'Rapprochement bancaire', en: 'Bank reconciliation' },
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
