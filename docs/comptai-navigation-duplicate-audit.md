# Audit des doublons de navigation — COMPTAI 0.1.1
**Mission :** Arena nº38 — audit de navigation et terminologie EN/FR  
**Date :** 1er novembre 2026  
**Base :** `main` `83cfc9a` (mission 37 fusionnée)  
**Branche :** `arena/ec20d0f3-mauritius-compta`  
**Périmètre :** libellés, menus, sous-menus, onglets et routes de l’application web ; aucun moteur comptable, fiscal ou de paie modifié.

## 1. Méthode
Chaque entrée de `apps/web/src/navigation.ts` a été confrontée à la route réelle de `App.tsx`, aux onglets de l’écran et aux autres liens de l’application (tableaux de bord, fiche dossier, parcours guidé, imports). Une destination est considérée comme **unique** lorsqu’un seul contrôle de la barre latérale ouvre cette fonction. Les onglets d’un même écran sont des **accès alternatifs légitimes** s’ils ouvrent une vue ou une action distincte ; ils deviennent des **doublons réels** lorsqu’ils ne changent que le libellé ou l’entrée de menu.

## 2. Résultats

| Indicateur | Avant M38 | Après M38 |
|---|---:|---:|
| Groupes de navigation | 11 | **10** |
| Entrées hors démonstration | 65 | **59** |
| Entrées avec la démonstration | 66 | **60** |
| Entrées retirées de la barre latérale | — | **6** |
| Doublons réels supprimés | — | **6** |
| Fonctions supprimées | — | **0** |
| Routes supprimées | — | **0** |

Les six entrées retirées sont : `All Journals`, `Purchase Journal`, `Sales Journal`, `Bank Journal`, `General Journal` (regroupés en onglets de **Journal Entries**) et `Opening Balances` (onglet de **Financial Years**). Le groupe **Journaux** disparaît ; ses fonctions restent accessibles par les onglets et par les URL directes.

## 3. Matrice des 66 entrées (60 actuelles + 6 retirées)

| Groupe parent | Libellé EN | Libellé FR | URL + paramètres | Fonction réellement accessible | Autres menus menant à cette fonction | Classement | Décision et justification |
|---|---|---|---|---|---|---|---|
| Dashboard | **Cabinet Dashboard** | Tableau de bord Cabinet | `/cabinet` | Indicateurs du cabinet, échéances, activité récente, accès rapides | Racine `/` ; liens du parcours guidé ; cartes KPI | unique | Conserver : porte d’entrée du cabinet |
| Dashboard | **Accounting Dashboard** | Tableau de bord comptable | `/accounting` | Indicateurs comptables et accès rapides | Parcours guidé étape 1 | unique | Conserver |
| Dashboard | **Guided Demo** | Parcours guidé | `/demo` | Visite de revue : 14 liens, 16 étapes, 8 contrôles de santé | Groupe Accueil, build de démonstration uniquement | unique (démo) | Conserver : exigence M37 |
| Clients & Companies | **Client Portfolios** | Dossiers clients | `/cabinet/companies` | Portefeuille de sociétés clientes : recherche, création, archivage | Fiche dossier ; sélecteur de société ; tableau de bord cabinet | unique | Conserver : destination principale |
| Clients & Companies | **Tasks & Deadlines** | Tâches & échéances | `/cabinet/tasks` | Tâches et échéances par dossier et membre d’équipe | Cartes « échéances » du tableau de bord cabinet | accès alternatif légitime | Conserver : vue opérationnelle dédiée |
| Clients & Companies | **Team Members** | Collaborateurs | `/cabinet/team` | Membres de l’équipe, rôles et affectations aux dossiers | Fiche dossier → équipe affectée | accès alternatif légitime | Conserver : administration du cabinet |
| Accounting | **Chart of Accounts** | Plan comptable | `/accounting/accounts` | Plan comptable : consultation, création, modification | Tableau de bord comptable ; parcours guidé | unique | Conserver |
| Accounting | **Journal Entries** | Écritures comptables | `/accounting/entries` | Registre des écritures, éditeur, onglets Tous les journaux / Achats / Ventes / Banque / OD | Liens rapides du tableau de bord ; imports achats/ventes/banque | unique (destination principale) | Conserver ; absorbe l’ancien groupe Journaux |
| Accounting | **General Ledger** | Grand livre | `/accounting/ledger` | Grand livre par compte et par période | Tableau de bord ; parcours guidé étape 13 | unique | Conserver |
| Accounting | **Trial Balance** | Balance générale | `/accounting/trial-balance` | Balance générale équilibrée ou déséquilibrée | Tableau de bord ; parcours guidé étape 14 | unique | Conserver |
| Accounting | **Accruals & Prepayments** | Régularisations | `/accounting/accruals` | Régularisations : charges constatées d’avance et charges à payer | Aucun autre menu | unique | Conserver |
| Accounting | **Provisions** | Provisions | `/accounting/provisions` | Provisions comptables et suivi | Aucun autre menu | unique | Conserver |
| Accounting | **Multi-Currency** | Multidevises | `/accounting/multi-currency` | Opérations en devises et écarts de change | Aucun autre menu | unique | Conserver |
| Accounting | **Financial Years** | Exercices comptables | `/accounting/financial-years` | Exercices : chronologie, soldes d’ouverture, ajustements antérieurs, archives | Parcours guidé étapes 2 et 16 ; onglet direct `?tab=opening` | unique (page socle) | Conserver : les anciens raccourcis sont devenus des onglets |
| Accounting | **Year-End Closing** | Clôture annuelle | `/accounting/financial-years?tab=checklist` | Onglet « Contrôles de clôture » de la page Exercices | Action rapide du tableau de bord cabinet ; parcours guidé étape 16 ; onglet `?tab=checklist` | accès alternatif légitime (raccourci d’onglet) | Conserver : la clôture annuelle reste directement accessible |
| Banking | **Bank Accounts** | Comptes bancaires | `/accounting/banking` | Comptes bancaires, soldes et statut | Racine Banking | unique | Conserver |
| Banking | **Bank Reconciliation** | Rapprochement bancaire | `/accounting/banking?tab=transactions` | Onglet Transactions : rapprochement bancaire et rapport d’écart | Parcours guidé étapes 8 et 9 ; état vide du journal de banque | accès alternatif légitime (onglet) | Conserver : écran principal du rapprochement |
| Banking | **Bank Imports** | Importer un relevé | `/accounting/banking?tab=import` | Onglet Import : relevés CSV, contrôles, doublons | Journal de banque → état vide | accès alternatif légitime (onglet) | Conserver : import opérationnel |
| Banking | **Bulk Reconciliation** | Rapprochement groupé | `/accounting/banking/bulk-reconciliation` | Rapprochement groupé de plusieurs lignes | Aucun autre menu | unique | Conserver : écran distinct |
| Banking | **Bank Rules** | Règles de rapprochement | `/accounting/banking?tab=rules` | Onglet Règles bancaires : règles de correspondance | Aucun autre menu | accès alternatif légitime (onglet) | Conserver |
| Banking | **PDF Statement Import** | Relevé bancaire PDF | `/accounting/banking/pdf` | Import d’un relevé PDF (mode PDF de l’écran MCB) | Route `/accounting/banking/mcb` non exposée au menu | accès alternatif légitime (variante PDF) | Conserver : source d’import distincte |
| Sales & Invoicing | **Sales Dashboard** | Tableau de bord Ventes | `/billing` | Indicateurs de ventes | Aucun autre menu | unique | Conserver |
| Sales & Invoicing | **Customers** | Clients | `/billing/customers` | Clients de facturation | Parcours guidé étape 3 | unique | Conserver |
| Sales & Invoicing | **Quotes** | Devis | `/billing/quotes` | Devis clients | Aucun autre menu | unique | Conserver |
| Sales & Invoicing | **Sales Invoices** | Factures clients | `/billing/invoices` | Factures clients et statut de comptabilisation | Parcours guidé étape 4 ; écran MRA e-Invoicing → factures | unique | Conserver |
| Sales & Invoicing | **Customer Credit Notes** | Avoirs clients | `/billing/credit-notes` | Avoirs clients | Aucun autre menu | unique | Conserver |
| Sales & Invoicing | **Customer Receipts** | Encaissements clients | `/billing/payments` | Encaissements clients et affectations | Parcours guidé étape 6 | unique | Conserver |
| Sales & Invoicing | **Accounts Receivable Aging** | Comptes clients — balance âgée | `/billing/aging` | Balance âgée des comptes clients | Aucun autre menu | unique | Conserver |
| Sales & Invoicing | **Open-Item Matching** | Lettrage | `/accounting/lettering` | Lettrage / matching des factures et règlements déjà comptabilisés | Liens depuis les documents de facturation | accès alternatif légitime (flux AR) | Conserver : fonction comptable existante |
| Sales & Invoicing | **Documents & Archives** | Documents et archives | `/documents` | Consultation, recherche et archivage des documents | Liens depuis les écrans d’import et de scan | accès alternatif légitime (transversal) | Conserver : archive unique |
| Sales & Invoicing | **MRA e-Invoicing — Coming Soon** | MRA e-Invoicing — À venir | `/billing/e-invoicing` | Écran MRA préparé : aucune transmission, aucun IRN | Aucun autre menu | unique (préparé) | Conserver avec badge « À venir » |
| Purchases & Expenses | **Purchases Dashboard** | Tableau de bord Achats | `/accounting/purchases` | Indicateurs achats et dettes | Aucun autre menu | unique | Conserver |
| Purchases & Expenses | **Suppliers** | Fournisseurs | `/accounting/purchases?tab=suppliers` | Onglet Fournisseurs | Parcours guidé étape 3 | accès alternatif légitime (onglet) | Conserver |
| Purchases & Expenses | **Bills** | Factures fournisseurs | `/accounting/purchases?tab=invoices` | Onglet Factures fournisseurs / Bills | Parcours guidé étape 5 | accès alternatif légitime (onglet) | Conserver |
| Purchases & Expenses | **Supplier Credit Notes** | Avoirs fournisseurs | `/accounting/purchases?tab=credit-notes` | Onglet Avoirs fournisseurs | Aucun autre menu | accès alternatif légitime (onglet) | Conserver |
| Purchases & Expenses | **Supplier Payments** | Règlements fournisseurs | `/accounting/purchases?tab=payments` | Onglet Règlements fournisseurs | Parcours guidé étape 7 | accès alternatif légitime (onglet) | Conserver |
| Purchases & Expenses | **Accounts Payable Aging** | Comptes fournisseurs — balance âgée | `/accounting/purchases?tab=aging` | Onglet Balance âgée fournisseurs | Aucun autre menu | accès alternatif légitime (onglet) | Conserver |
| Inventory & Fixed Assets | **Inventory** | Stocks | `/accounting/inventory` | Stocks : articles, mouvements, réconciliation | Parcours guidé étape 11 | unique | Conserver |
| Inventory & Fixed Assets | **Fixed Assets** | Immobilisations | `/accounting/assets` | Immobilisations : registre, amortissements, réconciliation | Parcours guidé étape 10 | unique | Conserver |
| Payroll | **Payroll Dashboard** | Tableau de bord Paie | `/payroll` | Indicateurs de paie | Aucun autre menu | unique | Conserver |
| Payroll | **Employees** | Salariés | `/payroll/employees` | Salariés | Aucun autre menu | unique | Conserver |
| Payroll | **Contracts** | Contrats | `/payroll/contracts` | Contrats de travail | Aucun autre menu | unique | Conserver |
| Payroll | **Payslip** | Bulletin de paie | `/payroll/payslips` | Bulletins de paie | Parcours guidé étape 12 | unique | Conserver |
| Payroll | **Statutory Returns** | Déclarations | `/payroll/declarations` | Déclarations préparées, aucune transmission officielle | Aucun autre menu | unique (préparé) | Conserver avec badge « Préparé » |
| Payroll | **Accounting Transfer** | Transfert comptable | `/payroll/transfer` | Transfert comptable en aperçu, bloqué | Parcours guidé étape 12 | unique | Conserver |
| Payroll | **Leave** | Congés | `/payroll/leave` | Congés et droits | Aucun autre menu | unique | Conserver |
| Payroll | **Pay Periods** | Périodes de paie | `/payroll/periods` | Périodes de paie | Parcours guidé étape 12 | unique | Conserver |
| Reports | **Balance Sheet** | Bilan | `/accounting/statements/balance-sheet` | Bilan | Parcours guidé étape 15 ; hub États financiers | accès alternatif légitime (vue spécifique) | Conserver |
| Reports | **Profit & Loss** | Compte de résultat | `/accounting/statements/profit-loss` | Compte de résultat | Parcours guidé étape 15 ; hub États financiers | accès alternatif légitime (vue spécifique) | Conserver |
| Reports | **Financial Statements** | Tous les états financiers | `/accounting/statements` | Hub des états financiers provisoires | Aucun autre menu | unique (hub) | Conserver |
| Reports | **Equity & Retained Earnings** | Capitaux propres et résultats reportés | `/accounting/equity` | Capitaux propres et résultats reportés | Aucun autre menu | unique | Conserver |
| Settings | **Accounting Settings** | Paramètres comptables | `/accounting/settings` | Paramètres comptables : profil, société, périodes, TVA, membres, audit | Onglets internes | unique | Renommer « Accounting Settings » pour lever l’ambiguïté avec le groupe Paramètres |
| Settings | **Company Settings** | Paramètres société | `/accounting/settings/company` | Paramètres de la société active | Fiche dossier → paramètres ; onglet Société de Paramètres | accès alternatif légitime (contexte dossier) | Conserver : même écran, contexte différent |
| Settings | **Accounting Periods** | Périodes comptables | `/accounting/settings?tab=periods` | Statut des périodes : ouverture et clôture | Chronologie des exercices ; onglet `?tab=periods` | ambiguïté contrôlée | Conserver et documenter : action open/close distincte du parcours de clôture annuelle |
| Settings | **Audit Trail** | Piste d’audit | `/accounting/settings?tab=audit` | Piste d’audit | Aucun autre menu | unique | Conserver |
| Settings | **Data & Backups** | Données et sauvegardes | `/accounting/settings/data` | Données et sauvegardes | Aucun autre menu | unique | Conserver |
| Settings | **Import & Migration** | Importation & migration | `/cabinet/migration` | Importation et migration de données | Aucun autre menu | unique | Conserver |
| Settings | **AI Assistant** | Assistant comptable | `/cabinet/ai-assistant` | Assistant IA contextuel | Pastille flottante sur tous les écrans | accès alternatif légitime | Conserver |
| Settings | **AI Proposals** | Écritures proposées | `/cabinet/ai-proposals` | Propositions IA à vérifier | Assistant IA | unique | Conserver |
| Settings | **AI Settings** | Paramètres IA | `/cabinet/settings/ai` | Paramètres IA du cabinet | Aucun autre menu | unique | Conserver |
| Journaux | ~~All Journals (retiré)~~ | ~~Tous les journaux (retiré)~~ | `/accounting/journals` | Registre de toutes les écritures | Journal Entries + onglet Tous les journaux | **doublon réel** | Retiré : même composant et mêmes données que Journal Entries ; redirection vers `/accounting/entries` |
| Journaux | ~~Purchase Journal (retiré)~~ | ~~Journal des achats (retiré)~~ | `/accounting/journals/purchases` | Liste filtrée sur le type achat | Onglet Journal des achats de Journal Entries ; route directe conservée | **doublon réel** | Retiré du menu : 5 entrées ouvraient le même registre ; route et favori conservés |
| Journaux | ~~Sales Journal (retiré)~~ | ~~Journal des ventes (retiré)~~ | `/accounting/journals/sales` | Liste filtrée sur le type vente | Onglet Journal des ventes ; route directe conservée | **doublon réel** | Retiré du menu ; route conservée |
| Journaux | ~~Bank Journal (retiré)~~ | ~~Journal de banque (retiré)~~ | `/accounting/journals/bank` | Liste filtrée sur le type banque | Onglet Journal de banque ; imports bancaires y renvoient | **doublon réel** | Retiré du menu ; route conservée |
| Journaux | ~~General Journal (retiré)~~ | ~~Journal des opérations diverses (retiré)~~ | `/accounting/journals/general` | Liste filtrée sur les opérations diverses | Onglet Journal des opérations diverses ; route directe conservée | **doublon réel** | Retiré du menu ; route conservée |
| Comptabilité | ~~Opening Balances (retiré)~~ | ~~Soldes d’ouverture (retiré)~~ | `/accounting/financial-years?tab=opening` | Onglet des soldes d’ouverture | Onglet Exercices comptables → Soldes d’ouverture ; parcours guidé étape 2 | **doublon réel** | Retiré du menu : raccourci d’un onglet déjà présent ; URL et favori fonctionnent |

## 4. Décisions structurantes

### 4.1 Journal Entries, journaux et grand livre

- **Journal Entries** (`/accounting/entries`) est la destination unique pour saisir, consulter et filtrer les écritures. Les cinq onglets sont **Tous les journaux**, **Journal des achats**, **Journal des ventes**, **Journal de banque** et **Journal des opérations diverses**.
- Un **journal comptable** est un regroupement d’écritures (achats, ventes, banque, OD) ; il n’est pas un écran séparé dans la barre latérale. Les routes `/accounting/journals/{purchases,sales,bank,general}` restent valides pour les favoris, les imports et les liens existants.
- Le **General Ledger** (`/accounting/ledger`) reste un écran distinct : il présente les mouvements **par compte**, alors que Journal Entries présente les écritures **par pièce**. La **Trial Balance** agrège les soldes par compte. Aucun de ces trois écrans n’est fusionné.
- `/accounting/journals` redirige vers `/accounting/entries` en conservant la query string ; `/journals` (ancien favori) fait de même.

### 4.2 Exercices, soldes d’ouverture et clôture

- **Financial Years** est la page socle : chronologie, **Opening Balances**, ajustements antérieurs et archives.
- **Year-End Closing** reste une entrée directe vers l’onglet **Contrôles de clôture** : la checklist est un parcours de décision, pas un simple doublon de la chronologie.
- **Opening Balances** n’a plus d’entrée propre : l’onglet est visible sur la page Exercices, le parcours guidé y renvoie et l’URL `?tab=opening` reste valide.

### 4.3 Onglets partageant une URL

Les écrans **Banking**, **Purchases**, **Financial Years** et **Accounting Settings** utilisent des onglets portés par `?tab=`. Chaque entrée de la barre latérale ouvre un onglet différent ; l’état actif est calculé par `isNavItemActive` avec priorité au `?tab=` frère. Aucune URL d’onglet n’a été supprimée.

### 4.4 Accès alternatifs conservés

| Accès | Pourquoi il est conservé |
|---|---|
| Year-End Closing → onglet checklist | Raccourci vers un parcours de clôture utilisé au quotidien |
| Company Settings depuis la fiche dossier et depuis Settings | Même écran, mais contexte de navigation différent (société active vs paramètres) |
| Bank Accounts / Reconciliation / Imports / Rules | Quatre onglets réellement distincts du même écran bancaire |
| Purchases Dashboard + cinq onglets | Chaque onglet est une fonction achats distincte (fournisseurs, bills, avoirs, règlements, aging) |
| Accounting Periods dans Settings | Action d’ouverture/clôture du statut, distincte du parcours annuel ; un texte explique la différence |
| Assistant IA (entrée + pastille flottante) | La pastille est un accès transversal, pas un doublon de menu |
| Documents & Archives | Archive transversale référencée par les imports et le scan |

### 4.5 Ambiguïtés restantes et traitement

| Ambiguïté | Traitement M38 |
|---|---|
| « Settings » ouvrait les paramètres comptables tout en étant le nom du groupe | Entrée renommée **Accounting Settings** / **Paramètres comptables** ; le groupe reste **Settings** |
| « Accounting Periods » vs « Financial Years » | Libellé conservé ; texte d’aide ajouté dans l’onglet : il gère l’ouverture/clôture du statut, la clôture annuelle reste dans Exercices → Clôture annuelle |
| « Company Settings » accessible depuis trois chemins | Un seul écran, trois contextes : menu Settings, URL directe, fiche dossier. Aucun doublon de barre latérale ; décision de conservation documentée |
| `dossier` anglais | Remplacé par **client file** / **company file** dans les libellés visibles ; les noms de champs techniques (`dossier_manager_id`) restent inchangés |

## 5. Limites de l’audit

- L’audit est statique et couvert par des tests jsdom ; aucun test manuel sur téléphone ou tablette physique n’a été réalisé pendant cette mission.
- Les droits sont vérifiés côté API ; la barre latérale masque les modules non autorisés mais ne constitue pas une barrière de sécurité.
- Les écrans marqués **Prepared** ou **Coming Soon** ne sont pas rendus opérationnels par cette mission.
- Les routes `/accounting/banking/mcb` et `/accounting/banking/pdf` partagent le même composant avec deux modes d’import ; cette variante est conservée et documentée, pas fusionnée.
