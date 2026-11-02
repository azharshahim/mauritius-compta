/**
 * Mission 37 — guided review tour of the browser demonstration.
 *
 * The page is deliberately a route, not a new engine: every link opens an
 * existing screen and every health figure is computed from the same demo APIs
 * used by the rest of the application. The account balances are never copied
 * into this file, so a reviewer can always trace a figure back to its report.
 */
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { useAsync } from '../hooks';
import { useI18n } from '../i18n';
import { useSession } from '../store';
import { Badge, Card, DemoNotice, EmptyState, ErrorBanner, Spinner } from '../components/ui';
import { money } from '../format';
import {
  GUIDED_TOUR_LINKS,
  GUIDED_TOUR_STEPS,
  clearGuidedTour,
  guidedTourStepFromQuery,
  readGuidedTour,
  startGuidedTour,
  writeGuidedTour,
} from '../guidedTour';

type Locale = 'fr' | 'en';

interface GuidedData {
  dashboard: {
    kpis: { balancedSheet: boolean; profit: string; revenue: string; expenses: string; currency: string };
    range: { from: string; to: string };
  };
  trialBalance: { balanced: boolean; rows: unknown[]; totals: { closingDebit: string; closingCredit: string } };
  statements: {
    financialPosition: { balanced: boolean; totalAssets: string; totalLiabilitiesAndEquity: string };
    profitAndLoss: { profit: string };
  };
  fixedAssets: { balanced: boolean; difference: string };
  inventory: { balanced: boolean; totalDifference: string };
  billing: {
    openReceivables: string | null;
    openReceivablesByCurrency?: { currency: string; amount: string }[];
    postedDocuments: number;
    payments: { count: number; unallocated?: string | null; byCurrency?: { currency: string; count: number; unallocated: string }[] };
  };
  purchases: { totalsByCurrency: { currency: string; outstanding: string }[] };
  bank: { name: string; status: string; unmatched: number; difference: string } | null;
  payroll: { status: string } | null;
}

const D = {
  en: {
    eyebrow: 'Reviewer workspace · fictional company',
    title: 'Guided Demo',
    intro:
      'A five-minute route through the accounting records of a Mauritian trading company. Every screen below is a real screen of this build; every amount is fictitious and stored only in this browser.',
    fictional: 'Fictional data',
    reset: 'Reset demo data',
    resetConfirm:
      'Reset every demonstration company file in this browser? Other environments and the server are not touched.',
    resetDone: 'Demo data reset. Reloading…',
    company: 'Active company',
    financialYear: 'Financial year',
    currency: 'Functional currency',
    standard: 'Accounting standard label',
    standardNote: 'Informational label only — no IFRS or MRA compliance is claimed.',
    brn: 'BRN',
    vat: 'VAT',
    health: 'Demo data health',
    healthIntro: 'Computed live from the demo reports. A warning is shown as a warning, never hidden.',
    trialBalance: 'Trial balance',
    balanceSheet: 'Balance sheet',
    fixedAssets: 'Fixed-asset register vs ledger',
    inventory: 'Inventory subledger vs ledger',
    salesLedger: 'Sales ledger',
    purchaseLedger: 'Purchases ledger',
    bank: 'Bank reconciliation (practice account)',
    payroll: 'Payroll period',
    balanced: 'Balanced',
    notBalanced: 'Not balanced',
    openReceivables: 'open receivables',
    noOpenReceivables: 'no open receivable',
    unallocatedPayments: 'unallocated payments',
    postedDocs: 'posted documents',
    outstanding: 'outstanding',
    unreconciled: 'unreconciled items',
    difference: 'reported difference',
    blocked: 'blocked — simulation only',
    workflowOnly: 'Workflow data — not a reconciled subledger',
    loading: 'Reading the demonstration reports…',
    noCompany: 'No demonstration company is selected.',
    quickTitle: 'Fourteen destinations requested for the review',
    quickIntro: 'Direct links to the screens named in the accountant review questionnaire.',
    scenarioTitle: 'The 16-step accounting scenario',
    scenarioIntro:
      'Follow the steps in order. Each step names the screen, the action and the result to expect. Amounts are in MUR unless stated otherwise.',
    expected: 'Expected',
    open: 'Open',
    limitsTitle: 'Known limitations to test explicitly',
    limitsIntro:
      'These are deliberate limits of the demonstration, not hidden defects. Record them as “Not Available” or “Not Tested” where appropriate.',
    limits: [
      'MRA e-invoicing, VAT returns and statutory filings are not implemented.',
      'Payroll is a simulation with a blocked period; it is not a statutory payroll product and no PAYE/CSG/NSF compliance is claimed.',
      'The bank practice account intentionally contains unreconciled transactions so that matching can be tested; the report explains the difference.',
      'Sales and purchase documents include unposted workflow records; they are not presented as reconciled subledgers.',
      'There is no cash-flow statement, no cost-centre accounting and no consolidation.',
      'The demonstration runs entirely in localStorage; it never contacts a bank, the MRA or an AI provider.',
      'A manual review on a physical phone or tablet was not performed as part of this mission.',
    ],
    resetHelp:
      'Reset only the fictional browser data. The signed-in preference, the French/English choice and other environments are preserved.',
    sourceNote: 'Open any figure in its report to verify it; no KPI on this page is hard-coded.',
  },
  fr: {
    eyebrow: 'Espace de revue · société fictive',
    title: 'Parcours guidé',
    intro:
      'Un parcours de cinq minutes dans la comptabilité d’une société mauricienne fictive. Chaque écran ci-dessous existe réellement dans ce build ; chaque montant est fictif et stocké uniquement dans ce navigateur.',
    fictional: 'Données fictives',
    reset: 'Réinitialiser la démo',
    resetConfirm:
      'Réinitialiser tous les dossiers de démonstration de ce navigateur ? Les autres environnements et le serveur ne sont pas touchés.',
    resetDone: 'Données réinitialisées. Rechargement…',
    company: 'Société active',
    financialYear: 'Exercice',
    currency: 'Devise fonctionnelle',
    standard: 'Libellé de référentiel',
    standardNote: 'Libellé informatif uniquement — aucune conformité IFRS ou MRA n’est affirmée.',
    brn: 'BRN',
    vat: 'TVA',
    health: 'Santé des données de démonstration',
    healthIntro: 'Calculée en direct depuis les rapports de démo. Un avertissement reste visible, jamais masqué.',
    trialBalance: 'Balance générale',
    balanceSheet: 'Bilan',
    fixedAssets: 'Registre des immobilisations vs grand livre',
    inventory: 'Sous-registre des stocks vs grand livre',
    salesLedger: 'Registre des ventes',
    purchaseLedger: 'Registre des achats',
    bank: 'Rapprochement bancaire (compte d’exercice)',
    payroll: 'Période de paie',
    balanced: 'Équilibré',
    notBalanced: 'Déséquilibré',
    openReceivables: 'créances ouvertes',
    noOpenReceivables: 'aucune créance ouverte',
    unallocatedPayments: 'règlements non affectés',
    postedDocs: 'documents comptabilisés',
    outstanding: 'restant dû',
    unreconciled: 'opérations non rapprochées',
    difference: 'écart signalé',
    blocked: 'bloquée — simulation',
    workflowOnly: 'Données de flux — pas un sous-registre rapproché',
    loading: 'Lecture des rapports de démonstration…',
    noCompany: 'Aucune société de démonstration sélectionnée.',
    quickTitle: 'Les quatorze destinations demandées pour la revue',
    quickIntro: 'Liens directs vers les écrans nommés dans le questionnaire de revue comptable.',
    scenarioTitle: 'Le scénario comptable en 16 étapes',
    scenarioIntro:
      'Suivez les étapes dans l’ordre. Chaque étape indique l’écran, l’action et le résultat attendu. Les montants sont en MUR sauf mention contraire.',
    expected: 'Attendu',
    open: 'Ouvrir',
    limitsTitle: 'Limites connues à tester explicitement',
    limitsIntro:
      'Ce sont des limites assumées de la démonstration, pas des défauts masqués. Notez-les « Not Available » ou « Not Tested » selon le cas.',
    limits: [
      'La facturation électronique MRA, les déclarations de TVA et les obligations fiscales ne sont pas implémentées.',
      'La paie est une simulation avec une période bloquée ; ce n’est pas un produit de paie légal et aucune conformité PAYE/CSG/NSF n’est affirmée.',
      'Le compte bancaire d’exercice contient volontairement des opérations non rapprochées pour tester le lettrage ; le rapport explique l’écart.',
      'Les documents de vente et d’achat comprennent des documents non comptabilisés : ce ne sont pas des sous-registres rapprochés.',
      'Il n’y a ni tableau de flux de trésorerie, ni comptabilité analytique, ni consolidation.',
      'La démonstration fonctionne entièrement en localStorage ; elle ne contacte ni banque, ni MRA, ni fournisseur d’IA.',
      'Aucune revue manuelle sur téléphone ou tablette physique n’a été effectuée pendant cette mission.',
    ],
    resetHelp:
      'Réinitialise uniquement les données fictives du navigateur. La préférence de connexion, le choix français/anglais et les autres environnements sont conservés.',
    sourceNote: 'Ouvrez chaque montant dans son rapport pour le vérifier ; aucun indicateur de cette page n’est codé en dur.',
  },
} as const;

interface Step {
  title: string;
  action: string;
  expected: string;
  links: { label: string; to: string }[];
}

const STEPS: Record<Locale, Step[]> = {
  en: [
    {
      title: '1. Open the demonstration company',
      action: 'Use the company selector and confirm Island Trading Ltd — DEMO COMPANY is active.',
      expected: 'Financial year 2025/2026, MUR, a DEMO BRN/VAT and no real registration number.',
      links: [{ label: 'Dashboard', to: '/accounting' }],
    },
    {
      title: '2. Share capital and opening balances',
      action: 'Open the opening balances tab and the trial balance.',
      expected: 'Opening debit = opening credit; share capital is visible; no unresolved opening difference.',
      links: [
        { label: 'Opening Balances', to: '/accounting/financial-years?tab=opening' },
        { label: 'Trial Balance', to: '/accounting/trial-balance' },
      ],
    },
    {
      title: '3. Customer and supplier',
      action: 'Open the customer list and the supplier tab; inspect the fictional records.',
      expected: 'Fictitious names, example.invalid contact domains, no real bank details.',
      links: [
        { label: 'Customers', to: '/billing/customers' },
        { label: 'Suppliers', to: '/accounting/purchases?tab=suppliers' },
      ],
    },
    {
      title: '4. Sales invoice',
      action: 'Open FAC-DEMO-0002 and its lines; check totals and the posting state.',
      expected: 'Line arithmetic is exact; the document shows whether it is posted or awaiting human validation.',
      links: [{ label: 'Sales Invoices', to: '/billing/invoices' }],
    },
    {
      title: '5. Supplier bill',
      action: 'Open the bills tab and inspect FAC-DEMO-1001.',
      expected: '80,000 − 30,000 = 50,000 MUR outstanding; the payment allocation is visible.',
      links: [{ label: 'Bills', to: '/accounting/purchases?tab=invoices' }],
    },
    {
      title: '6. Customer receipt',
      action: 'Open the payments tab and trace the receipt allocated to an invoice.',
      expected: 'The allocation never exceeds the invoice total and the outstanding amount updates.',
      links: [{ label: 'Customer payments', to: '/billing/payments' }],
    },
    {
      title: '7. Supplier payment',
      action: 'Open the supplier payments tab and inspect RF-2026-0001.',
      expected: '30,000 MUR allocated to FAC-DEMO-1001; no double payment is accepted.',
      links: [{ label: 'Supplier payments', to: '/accounting/purchases?tab=payments' }],
    },
    {
      title: '8. Fictitious bank statement',
      action: 'Import one of the sample statements in the bank screen; preview before importing.',
      expected: 'Errors and duplicates are flagged; nothing is posted by the import itself.',
      links: [{ label: 'Bank Reconciliation', to: '/accounting/banking' }],
    },
    {
      title: '9. Bank reconciliation',
      action: 'Match the FA-2025-001 receipt or exclude an unexplained line; reopen the report.',
      expected: 'The match requires confirmation; the report lists every remaining difference and never forces zero.',
      links: [{ label: 'Bank Reconciliation', to: '/accounting/banking' }],
    },
    {
      title: '10. Fixed-asset acquisition',
      action: 'Inspect FA-2025-0001 and the register/reconciliation report.',
      expected: 'Cost, accumulated depreciation and net book value agree with the ledger.',
      links: [{ label: 'Fixed Assets', to: '/accounting/assets' }],
    },
    {
      title: '11. Inventory movement',
      action: 'Open the inventory item and its movement history.',
      expected: 'Quantity and value changes are traceable; the subledger reconciles to the inventory account.',
      links: [{ label: 'Inventory', to: '/accounting/inventory' }],
    },
    {
      title: '12. Payroll simulation',
      action: 'Open the payroll period and a payslip; then inspect the accounting-transfer preview.',
      expected: 'The period is blocked and the transfer is a preview requiring a human decision — no statutory compliance claim.',
      links: [
        { label: 'Payroll', to: '/payroll' },
        { label: 'Accounting transfer', to: '/payroll/transfer' },
      ],
    },
    {
      title: '13. General ledger',
      action: 'Filter the ledger over the full financial year and open a posted entry.',
      expected: 'Every movement is tied to a journal, an entry number and balanced debit/credit lines.',
      links: [{ label: 'General Ledger', to: '/accounting/ledger' }],
    },
    {
      title: '14. Trial balance',
      action: 'Compare closing debit and closing credit.',
      expected: 'Closing debit = closing credit; the screen states that the trial balance is balanced.',
      links: [{ label: 'Trial Balance', to: '/accounting/trial-balance' }],
    },
    {
      title: '15. Profit & Loss and Balance Sheet',
      action: 'Open both statements and compare totals with the trial balance.',
      expected: 'Assets = liabilities + equity; profit agrees with the P&L and the dashboard.',
      links: [
        { label: 'Profit & Loss', to: '/accounting/statements/profit-loss' },
        { label: 'Balance Sheet', to: '/accounting/statements/balance-sheet' },
      ],
    },
    {
      title: '16. Coherence control and year-end closing',
      action: 'Return to the trial balance, then open Year-End Closing and its checklist.',
      expected: 'The control agrees with this page; closing steps remain explicit and no rule is applied automatically.',
      links: [
        { label: 'Trial Balance', to: '/accounting/trial-balance' },
        { label: 'Year-End Closing', to: '/accounting/financial-years' },
      ],
    },
  ],
  fr: [
    {
      title: '1. Ouvrir la société de démonstration',
      action: 'Utilisez le sélecteur de société et confirmez qu’Island Trading Ltd — DEMO COMPANY est active.',
      expected: 'Exercice 2025/2026, MUR, BRN/TVA DEMO et aucun numéro d’enregistrement réel.',
      links: [{ label: 'Tableau de bord', to: '/accounting' }],
    },
    {
      title: '2. Capital social et soldes d’ouverture',
      action: 'Ouvrez l’onglet des soldes d’ouverture puis la balance générale.',
      expected: 'Débit d’ouverture = crédit d’ouverture ; le capital est visible ; aucun écart d’ouverture non expliqué.',
      links: [
        { label: 'Soldes d’ouverture', to: '/accounting/financial-years?tab=opening' },
        { label: 'Balance générale', to: '/accounting/trial-balance' },
      ],
    },
    {
      title: '3. Client et fournisseur',
      action: 'Ouvrez la liste des clients et l’onglet fournisseurs ; inspectez les fiches fictives.',
      expected: 'Noms fictifs, domaines example.invalid, aucune coordonnée bancaire réelle.',
      links: [
        { label: 'Clients', to: '/billing/customers' },
        { label: 'Fournisseurs', to: '/accounting/purchases?tab=suppliers' },
      ],
    },
    {
      title: '4. Facture de vente',
      action: 'Ouvrez FAC-DEMO-0002 et ses lignes ; vérifiez les totaux et l’état de comptabilisation.',
      expected: 'L’arithmétique des lignes est exacte ; le document indique s’il est comptabilisé ou en attente de validation humaine.',
      links: [{ label: 'Factures clients', to: '/billing/invoices' }],
    },
    {
      title: '5. Facture fournisseur',
      action: 'Ouvrez l’onglet des factures fournisseurs et inspectez FAC-DEMO-1001.',
      expected: '80 000 − 30 000 = 50 000 MUR restant dus ; l’affectation du règlement est visible.',
      links: [{ label: 'Factures fournisseurs', to: '/accounting/purchases?tab=invoices' }],
    },
    {
      title: '6. Encaissement client',
      action: 'Ouvrez l’onglet des règlements et retrouvez l’affectation à une facture.',
      expected: 'L’affectation ne dépasse jamais le total facturé et le restant dû est mis à jour.',
      links: [{ label: 'Encaissements', to: '/billing/payments' }],
    },
    {
      title: '7. Paiement fournisseur',
      action: 'Ouvrez l’onglet des paiements fournisseurs et inspectez RF-2026-0001.',
      expected: '30 000 MUR affectés à FAC-DEMO-1001 ; aucun double paiement n’est accepté.',
      links: [{ label: 'Paiements fournisseurs', to: '/accounting/purchases?tab=payments' }],
    },
    {
      title: '8. Relevé bancaire fictif',
      action: 'Importez un relevé d’exemple dans l’écran banque ; prévisualisez avant d’importer.',
      expected: 'Les erreurs et doublons sont signalés ; l’import ne comptabilise rien.',
      links: [{ label: 'Rapprochement bancaire', to: '/accounting/banking' }],
    },
    {
      title: '9. Rapprochement bancaire',
      action: 'Rapprochez l’encaissement FA-2025-001 ou excluez une ligne inexpliquée ; rouvrez le rapport.',
      expected: 'Le rapprochement exige une confirmation ; le rapport liste chaque écart restant et ne force jamais zéro.',
      links: [{ label: 'Rapprochement bancaire', to: '/accounting/banking' }],
    },
    {
      title: '10. Acquisition d’immobilisation',
      action: 'Inspectez FA-2025-0001 et le rapport registre/grand livre.',
      expected: 'Coût, amortissements cumulés et valeur nette concordent avec le grand livre.',
      links: [{ label: 'Immobilisations', to: '/accounting/assets' }],
    },
    {
      title: '11. Mouvement de stock',
      action: 'Ouvrez l’article et son historique de mouvements.',
      expected: 'Les variations de quantité et de valeur sont traçables ; le sous-registre se rapproche du compte de stocks.',
      links: [{ label: 'Stocks', to: '/accounting/inventory' }],
    },
    {
      title: '12. Simulation de paie',
      action: 'Ouvrez la période de paie et un bulletin ; inspectez ensuite l’aperçu de transfert comptable.',
      expected: 'La période est bloquée et le transfert est un aperçu nécessitant une décision humaine — aucune conformité légale affirmée.',
      links: [
        { label: 'Paie', to: '/payroll' },
        { label: 'Transfert comptable', to: '/payroll/transfer' },
      ],
    },
    {
      title: '13. Grand livre',
      action: 'Filtrez le grand livre sur l’exercice complet et ouvrez une écriture validée.',
      expected: 'Chaque mouvement est rattaché à un journal, un numéro d’écriture et des lignes équilibrées.',
      links: [{ label: 'Grand livre', to: '/accounting/ledger' }],
    },
    {
      title: '14. Balance générale',
      action: 'Comparez le total débit et le total crédit de clôture.',
      expected: 'Débit = crédit ; l’écran indique que la balance est équilibrée.',
      links: [{ label: 'Balance générale', to: '/accounting/trial-balance' }],
    },
    {
      title: '15. Compte de résultat et bilan',
      action: 'Ouvrez les deux états et comparez les totaux avec la balance.',
      expected: 'Actif = passif + capitaux propres ; le résultat concorde avec le compte de résultat et le tableau de bord.',
      links: [
        { label: 'Compte de résultat', to: '/accounting/statements/profit-loss' },
        { label: 'Bilan', to: '/accounting/statements/balance-sheet' },
      ],
    },
    {
      title: '16. Contrôle de cohérence et clôture',
      action: 'Revenez à la balance, puis ouvrez la clôture annuelle et sa checklist.',
      expected: 'Le contrôle concorde avec cette page ; les étapes de clôture restent explicites et aucune règle n’est appliquée automatiquement.',
      links: [
        { label: 'Balance générale', to: '/accounting/trial-balance' },
        { label: 'Clôture annuelle', to: '/accounting/financial-years' },
      ],
    },
  ],
};

const QUICK_LINKS: { key: string; to: string }[] = [
  { key: 'Dashboard', to: '/accounting' },
  { key: 'Chart of Accounts', to: '/accounting/accounts' },
  { key: 'Journal Entries', to: '/accounting/entries' },
  { key: 'General Ledger', to: '/accounting/ledger' },
  { key: 'Trial Balance', to: '/accounting/trial-balance' },
  { key: 'Bank Reconciliation', to: '/accounting/banking' },
  { key: 'Sales Invoices', to: '/billing/invoices' },
  { key: 'Bills', to: '/accounting/purchases?tab=invoices' },
  { key: 'Fixed Assets', to: '/accounting/assets' },
  { key: 'Inventory', to: '/accounting/inventory' },
  { key: 'Payroll', to: '/payroll' },
  { key: 'Profit & Loss', to: '/accounting/statements/profit-loss' },
  { key: 'Balance Sheet', to: '/accounting/statements/balance-sheet' },
  { key: 'Year-End Closing', to: '/accounting/financial-years?tab=checklist' },
];

export default function GuidedDemoPage() {
  const { locale, t } = useI18n();
  const tr = D[locale];
  const { company } = useSession();
  const [searchParams, setSearchParams] = useSearchParams();
  const stepParam = searchParams.get('step');
  const [currentStep, setCurrentStep] = useState(() =>
    guidedTourStepFromQuery(stepParam, readGuidedTour().step),
  );

  // `?step=` is the only external input. The effect must not depend on the
  // selected step itself: opening a step link writes `active=true` just before
  // the route changes, and a state-driven effect would immediately clear it.
  useEffect(() => {
    if (stepParam === null) return;
    const next = guidedTourStepFromQuery(stepParam, currentStep);
    setCurrentStep(next);
    // Back on the tour page means "not navigating a destination": keep the
    // position, but hide the contextual tour controls.
    writeGuidedTour(false, next);
    const target = document.getElementById(`demo-step-${next}`);
    target?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
    // currentStep is intentionally not a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepParam]);

  const selectStep = (next: number) => {
    const clamped = Math.min(GUIDED_TOUR_STEPS - 1, Math.max(0, next));
    setCurrentStep(clamped);
    writeGuidedTour(false, clamped);
    const params = new URLSearchParams(searchParams);
    params.set('step', String(clamped + 1));
    setSearchParams(params, { replace: true });
    const target = document.getElementById(`demo-step-${clamped}`);
    target?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
  };
  const { data, loading, error } = useAsync<GuidedData | null>(async () => {
    if (!company) return null;
    const base = `/companies/${company.id}`;
    const [dashboard, trialBalance, statements, fixedAssets, inventory, billing, purchases, bankAccounts, payrollPeriods] =
      await Promise.all([
        api.get<GuidedData['dashboard']>(`${base}/dashboard`),
        api.get<GuidedData['trialBalance']>(`${base}/reports/trial-balance`),
        api.get<GuidedData['statements']>(`${base}/reports/statements`),
        api.get<GuidedData['fixedAssets']>(`${base}/fixed-assets/reports/reconciliation?asOf=${company.financial_year_end}`),
        api.get<GuidedData['inventory']>(`${base}/inventory/reconciliation?asOf=${company.financial_year_end}`),
        api.get<GuidedData['billing']>(`${base}/billing/summary`),
        api.get<{ aging: { totalsByCurrency: GuidedData['purchases']['totalsByCurrency'] } }>(`${base}/purchases/aging`),
        api.get<{ accounts: { id: string; name: string; currency: string }[] }>(`${base}/bank/accounts`),
        api.get<{ periods: { status: string }[] }>(`${base}/payroll/periods`),
      ]);

    const murAccount = bankAccounts.accounts.find((a) => a.currency === 'MUR') ?? bankAccounts.accounts[0] ?? null;
    const bankReport = murAccount
      ? await api.get<{ report: { status: string; unmatchedCount: number; difference: string } }>(
          `${base}/bank/report?bankAccountId=${murAccount.id}`,
        )
      : null;

    return {
      dashboard,
      trialBalance,
      statements,
      fixedAssets,
      inventory,
      billing,
      purchases: purchases.aging,
      bank: murAccount && bankReport
        ? {
            name: murAccount.name,
            status: bankReport.report.status,
            unmatched: bankReport.report.unmatchedCount,
            difference: bankReport.report.difference,
          }
        : null,
      payroll: payrollPeriods.periods[0] ?? null,
    };
  }, [company?.id]);

  if (!company) {
    return <EmptyState title={tr.noCompany} />;
  }

  const reset = async () => {
    if (!window.confirm(tr.resetConfirm)) return;
    // Keep the demo runtime in its own lazy chunk: importing `../demo`
    // statically would pull the whole fictional backend into the main bundle.
    const { resetDemo } = await import('../demo/runtime');
    resetDemo();
    clearGuidedTour();
    localStorage.removeItem('mc.companyId');
    window.location.hash = '#/demo';
    window.location.reload();
  };

  const healthRows: { label: string; state: 'ok' | 'warn' | 'info'; detail: string }[] = data
    ? [
        {
          label: tr.trialBalance,
          state: data.trialBalance.balanced ? 'ok' : 'warn',
          detail: data.trialBalance.balanced
            ? `${tr.balanced} · ${data.trialBalance.totals.closingDebit} = ${data.trialBalance.totals.closingCredit}`
            : tr.notBalanced,
        },
        {
          label: tr.balanceSheet,
          state: data.statements.financialPosition.balanced ? 'ok' : 'warn',
          detail: data.statements.financialPosition.balanced
            ? `${tr.balanced} · ${money(data.statements.financialPosition.totalAssets, locale, company.functional_currency)}`
            : tr.notBalanced,
        },
        {
          label: tr.fixedAssets,
          state: data.fixedAssets.balanced ? 'ok' : 'warn',
          detail: data.fixedAssets.balanced ? tr.balanced : `${tr.difference}: ${data.fixedAssets.difference}`,
        },
        {
          label: tr.inventory,
          state: data.inventory.balanced ? 'ok' : 'warn',
          detail: data.inventory.balanced ? tr.balanced : `${tr.difference}: ${data.inventory.totalDifference}`,
        },
        {
          label: tr.salesLedger,
          state: 'info',
          detail: `${
            (data.billing.openReceivablesByCurrency ?? []).length
              ? data.billing.openReceivablesByCurrency!
                  .map((row) => `${money(row.amount, locale, row.currency)} (${row.currency})`)
                  .join(' · ')
              : tr.noOpenReceivables
          } ${tr.openReceivables} · ${data.billing.postedDocuments} ${tr.postedDocs} · ${tr.workflowOnly}`,
        },
        {
          label: tr.purchaseLedger,
          state: 'info',
          detail: data.purchases.totalsByCurrency
            .map((row) => `${money(row.outstanding, locale, row.currency)} ${tr.outstanding} (${row.currency})`)
            .join(' · ') + ` · ${tr.workflowOnly}`,
        },
        {
          label: tr.bank,
          state: data.bank?.status === 'reconciled' ? 'ok' : 'warn',
          detail: data.bank
            ? `${data.bank.name} · ${data.bank.status} · ${data.bank.unmatched} ${tr.unreconciled} · ${data.bank.difference} ${tr.difference}`
            : tr.workflowOnly,
        },
        {
          label: tr.payroll,
          state: 'warn',
          detail: data.payroll ? `${data.payroll.status} · ${tr.blocked}` : tr.workflowOnly,
        },
      ]
    : [];

  return (
    <>
      <DemoNotice />
      <div className="page-head">
        <div className="grow">
          <div className="page-sub">{tr.eyebrow}</div>
          <h1>{tr.title}</h1>
          <p className="page-sub">{tr.intro}</p>
        </div>
        <div className="page-head-actions">
          <Badge kind="warning">{tr.fictional}</Badge>
          <button type="button" className="btn btn-danger" onClick={reset}>
            {tr.reset}
          </button>
        </div>
      </div>
      <ErrorBanner message={error} />

      <Card title={tr.company}>
        <div className="demo-tour-facts">
          <div><span>{tr.company}</span><strong>{company.name}</strong></div>
          <div><span>{tr.financialYear}</span><strong>{company.financial_year_start} → {company.financial_year_end}</strong></div>
          <div><span>{tr.currency}</span><strong>{company.functional_currency}</strong></div>
          <div><span>{tr.brn}</span><strong>{company.brn ?? '—'}</strong></div>
          <div><span>{tr.vat}</span><strong>{company.vat_number ?? '—'}</strong></div>
          <div><span>{tr.standard}</span><strong>{company.accounting_standard}</strong></div>
        </div>
        <p className="muted small">{tr.standardNote}</p>
        <p className="muted small">{tr.resetHelp}</p>
      </Card>

      <div className="grid grid-2" style={{ marginTop: 16 }}>
        <Card title={tr.health}>
          <p className="muted small">{tr.healthIntro}</p>
          {loading ? (
            <Spinner label={tr.loading} />
          ) : (
            <ul className="demo-health">
              {healthRows.map((row) => (
                <li key={row.label} className={`demo-health-row demo-health-${row.state}`}>
                  <Badge kind={row.state === 'ok' ? 'success' : row.state === 'warn' ? 'warning' : 'info'}>
                    {row.state === 'ok' ? '✓' : row.state === 'warn' ? '!' : 'i'}
                  </Badge>
                  <div>
                    <strong>{row.label}</strong>
                    <div className="muted small">{row.detail}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <p className="muted small">{tr.sourceNote}</p>
        </Card>

        <Card title={tr.quickTitle}>
          <p className="muted small">{tr.quickIntro}</p>
          <div className="demo-quick-links">
            {QUICK_LINKS.map((link) => (
              <Link
                key={link.key}
                to={link.to}
                className="demo-quick-link"
                onClick={() => {
                  const index = GUIDED_TOUR_LINKS.indexOf(link.to as (typeof GUIDED_TOUR_LINKS)[number]);
                  startGuidedTour(index >= 0 ? index : currentStep);
                }}
              >
                {link.key}
              </Link>
            ))}
          </div>
        </Card>
      </div>

      <Card title={tr.scenarioTitle} >
        <p className="muted small">{tr.scenarioIntro}</p>
        <div className="demo-tour-controls">
          <div className="demo-tour-position">
            <strong>
              {t('demo.tour.current')} · {t('demo.tour.step')} {currentStep + 1} {t('demo.tour.of')}{' '}
              {GUIDED_TOUR_STEPS}
            </strong>
            <span className="muted small">{t('demo.tour.saved')}</span>
          </div>
          <div className="demo-tour-buttons">
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => selectStep(currentStep - 1)}
              disabled={currentStep <= 0}
            >
              {t('demo.tour.previous')}
            </button>
            <span className="muted small">
              {currentStep + 1} / {GUIDED_TOUR_STEPS}
            </span>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => selectStep(currentStep + 1)}
              disabled={currentStep >= GUIDED_TOUR_STEPS - 1}
            >
              {t('demo.tour.next')}
            </button>
          </div>
        </div>
        <ol className="demo-steps">
          {STEPS[locale].map((stepData, index) => (
            <li
              key={stepData.title}
              id={`demo-step-${index}`}
              className={`demo-step ${index === currentStep ? 'is-current' : ''}`}
              aria-current={index === currentStep ? 'step' : undefined}
            >
              <div className="demo-step-body">
                <strong>{stepData.title}</strong>
                <p>{stepData.action}</p>
                <p className="muted small"><b>{tr.expected}:</b> {stepData.expected}</p>
                <div className="demo-step-links">
                  {stepData.links.map((link) => (
                    <Link
                      key={link.to + link.label}
                      to={link.to}
                      className="btn btn-ghost btn-sm"
                      onClick={() => {
                        setCurrentStep(index);
                        startGuidedTour(index);
                      }}
                    >
                      {link.label}
                    </Link>
                  ))}
                </div>
              </div>
            </li>
          ))}
        </ol>
      </Card>

      <Card title={tr.limitsTitle} >
        <p className="muted small">{tr.limitsIntro}</p>
        <ul className="demo-limits">
          {tr.limits.map((limit) => <li key={limit}>{limit}</li>)}
        </ul>
      </Card>
    </>
  );
}
