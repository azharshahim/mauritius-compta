/**
 * Mission 46 — Modern UX/UI Foundation bilingual catalogue (EN / FR).
 *
 * Keeps English primary for Mauritius and full French parity without altering
 * any existing accounting glossary or translation keys.
 */
export const M46_FR: Record<string, string> = {
  'nav.bank.periods': 'Périodes bancaires',
  'm46.shell.openWorkspace': 'Espace client',
  'm46.shell.activeClient': 'Client sélectionné',
  'm46.shell.noCompany': 'Aucune société sélectionnée',
  'm46.dashboard.currencyNote': 'Montants affichés en {currency} (aucune agrégation multidevise)',
  'm46.dashboard.bankAccounts': 'Comptes bancaires par devise',
  'm46.dashboard.noBankAccounts': 'Aucun compte bancaire configuré pour cette société.',
  'm46.dashboard.openBankPeriods': 'Périodes bancaires',
  'm46.dashboard.openControls': 'Contrôles comptables',
  'm46.portfolio.viewTable': 'Tableau',
  'm46.portfolio.viewCards': 'Cartes',
  'm46.portfolio.showing': '{shown} sur {total} fiches clients',
  'm46.portfolio.resetFilters': 'Réinitialiser',
  'm46.portfolio.activeCompanyTag': 'Active',
  'm46.wizard.stepOf': 'Étape {current} sur {total}',
  'm46.wizard.draftUnsaved': 'Brouillon non enregistré',
  'm46.wizard.draftSaving': 'Enregistrement en cours…',
  'm46.wizard.draftSavedAt': 'Brouillon enregistré · {time}',
  'm46.wizard.readinessReadyTitle': 'Prêt pour l’activation de l’espace client',
  'm46.wizard.readinessReadyBody':
    'Les informations obligatoires de société, de secteur et de comptabilité sont renseignées. La revue KYC se poursuivra dans l’espace client.',
  'm46.wizard.readinessPendingTitle': 'Informations obligatoires manquantes avant activation',
  'm46.wizard.readinessPendingBody':
    'Complétez les éléments ci-dessous pour activer l’espace de travail client.',
  'm46.wizard.missingLegalName': 'Raison sociale obligatoire (Étape 1)',
  'm46.wizard.missingAddress': 'Adresse du siège obligatoire (Étape 1)',
  'm46.wizard.missingSector': 'Secteur d’activité obligatoire (Étape 3)',
  'm46.wizard.missingCurrency': 'Devise de comptabilité obligatoire (Étape 4)',
  'm46.wizard.editStep': 'Modifier',
  'm46.wizard.notProvidedRequired': 'Non renseigné — obligatoire',
  'm46.wizard.notProvidedOptional': 'Non renseigné (facultatif)',
  'm46.wizard.backToPortfolio': 'Retour au portefeuille',
};

export const M46_EN: Record<string, string> = {
  'nav.bank.periods': 'Bank Periods',
  'm46.shell.openWorkspace': 'Client Workspace',
  'm46.shell.activeClient': 'Active client',
  'm46.shell.noCompany': 'No company selected',
  'm46.dashboard.currencyNote': 'Amounts displayed in {currency} (never summed across currencies)',
  'm46.dashboard.bankAccounts': 'Bank accounts by currency',
  'm46.dashboard.noBankAccounts': 'No bank account configured for this company.',
  'm46.dashboard.openBankPeriods': 'Bank Periods',
  'm46.dashboard.openControls': 'Accounting Controls',
  'm46.portfolio.viewTable': 'Table',
  'm46.portfolio.viewCards': 'Cards',
  'm46.portfolio.showing': 'Showing {shown} of {total} client files',
  'm46.portfolio.resetFilters': 'Reset filters',
  'm46.portfolio.activeCompanyTag': 'Active',
  'm46.wizard.stepOf': 'Step {current} of {total}',
  'm46.wizard.draftUnsaved': 'Unsaved draft',
  'm46.wizard.draftSaving': 'Saving draft…',
  'm46.wizard.draftSavedAt': 'Draft saved · {time}',
  'm46.wizard.readinessReadyTitle': 'Ready to activate client workspace',
  'm46.wizard.readinessReadyBody':
    'Required company, sector, and accounting fields are complete. KYC review continues inside the client workspace.',
  'm46.wizard.readinessPendingTitle': 'Required information missing before activation',
  'm46.wizard.readinessPendingBody':
    'Complete the items below before activating the client workspace.',
  'm46.wizard.missingLegalName': 'Registered business name required (Step 1)',
  'm46.wizard.missingAddress': 'Registered address required (Step 1)',
  'm46.wizard.missingSector': 'Business sector required (Step 3)',
  'm46.wizard.missingCurrency': 'Accounting currency required (Step 4)',
  'm46.wizard.editStep': 'Edit',
  'm46.wizard.notProvidedRequired': 'Not provided — required',
  'm46.wizard.notProvidedOptional': 'Not provided (optional)',
  'm46.wizard.backToPortfolio': 'Back to portfolio',
};
