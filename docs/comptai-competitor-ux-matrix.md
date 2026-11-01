# COMPTAI — matrice comparative d'ergonomie comptable

**Version :** 0.1.1 — démonstration
**Date de consultation des sources :** 1er novembre 2026
**Périmètre :** QuickBooks Online / Advanced, Sage 50, Sage Accounting,
Sage Intacct, Xero, Odoo Accounting, Zoho Books. NetSuite et SAP S/4HANA sont
cités comme références de concepts uniquement.
**But :** retrouver les repères d'un comptable habitué à ces outils, sans copier
de code, d'interface, de logo ni d'identité visuelle.

> **Méthode et limites.** Seules des pages d'aide officielles des éditeurs ont été
> utilisées. Les chemins de menu changent selon le pays, l'édition, la langue et la
> date ; ils sont donc cités comme **pratiques observées**, pas comme une norme.
> Aucun test comparatif n'a été exécuté dans les produits concurrents. Les
> fonctionnalités NetSuite et SAP ne sont pas vérifiées au niveau de l'interface :
> seuls les concepts documentés sont repris. Aucune compatibilité officielle avec un
> concurrent n'est affirmée.

Légende priorités : **P1** = fort impact pour un cabinet, à court terme ;
**P2** = amélioration utile, non bloquante ; **P3** = à étudier plus tard.

---

## 1. Matrice par domaine

| Domaine | Vocabulaire professionnel | Pratique observée chez les éditeurs | Situation COMPTAI avant M36 | Décision / action M36 | Proposition restante | Priorité |
|---|---|---|---|---|---|---|
| **Organisation des menus** | Dashboard, Accounting, Banking, Sales, Purchases, Reports, Settings | QBO place les états dans **Reports** [S1] ; Sage Accounting dans **Reporting > More** [S7][S9] ; Odoo dans **Accounting > Configuration** pour le plan comptable [S14] ; Xero dans **Accounting > Bank accounts** pour la banque [S4] | 8 groupes, libellés hérités (`Facturation`, `États financiers`, `Cabinet et administration`), écrans clés peu visibles | **11 groupes** : Tableau de bord, Clients et sociétés, Comptabilité, Journaux, Banque, Ventes et facturation, Achats et dépenses, Stocks et immobilisations, Paie, Rapports, Paramètres | Étudier un regroupement « Accounting » unique si les journaux deviennent nombreux | P2 |
| **Terminologie** | Chart of Accounts, General Ledger, Trial Balance, P&L, Balance Sheet, AR/AP | Les libellés QBO changent selon le type de société : P&L → *Statement of Activity*, bilan → *Statement of Financial Position* [S1] ; Sage 50 parle de *nominal codes* [S13] | Mélange « Écritures », « Factures d'achat », « États financiers » (groupe + écran), « Achats & Fournisseurs » | Glossaire canonique de **25 paires** ; `Écritures comptables`, `Factures fournisseurs` / `Bills`, `Achats et dépenses` ; test de non-fuite FR/EN | Faire valider les choix mauriciens (Turnover, Statement of Profit or Loss, Results reportés) | P1 |
| **Navigation et recherche** | Recherche globale, favoris, accès récent | QBO permet de rechercher un état par son nom dans **Standard Reports** [S1] | Pas de recherche transverse ; 65 liens de navigation | Entrées directes vers les écrans comptables ; onglets `?tab=` cliquables ; accès rapides du tableau de bord cabinet | Recherche globale (écrans + comptes + pièces) | P2 |
| **Plan comptable** | Chart of Accounts, ledger accounts, nominal codes | Odoo : **Accounting ‣ Configuration ‣ Chart of Accounts** [S14] ; Sage Accounting : **Settings > Chart of Accounts**, export CSV/PDF via **Reporting > More > Chart of Accounts** [S8] ; Sage 50 : *nominal codes* [S13] ; Zoho : module **Accountant** [S16] | Groupe Comptabilité, création/modification, import CSV/Excel avec correspondance, modèle provisoire ; **aucun export du plan comptable** | Entrée « Plan comptable » visible ; écran d'import conservé ; export classé en proposition, pas de bouton fictif | Export CSV du plan comptable (précédent Sage) + import Xero/QuickBooks testé | P2 |
| **Journaux et écritures** | Journal Entries, Journals, Draft/Posted | Sage Intacct : **General Ledger > All > Journal entries**, colonne *State* Draft/Posted [S11] ; Sage 50 : *Nominal codes > Journal entry*, balance obligatoirement nulle [S13] | Écran `/accounting/entries` existant mais absent du menu ; journaux dans Comptabilité | Groupe **Journaux** distinct (Tous, Achats, Ventes, Banque, OD) ; **Écritures comptables** direct | Affichage explicite Draft/Posted dans la liste, si les états existent déjà | P2 |
| **Grand livre et balance** | General Ledger, Trial Balance, drill-down | Sage Intacct expose GL, Trial balance, Comparative trial balance comme rapports [S12] ; Sage Accounting : **Reporting > More > General Ledger** [S7] | Grand livre et balance présents, sous « Comptabilité » | Entrées directes **Grand livre** et **Balance générale** | Drill-down compte → écritures → pièce | P2 |
| **Bilan** | Balance Sheet / Statement of Financial Position | QBO : **Reports > Standard Reports**, bilan arrêté à une date [S1][S2] | Écran provisoire, accessible par `/accounting/statements` | Entrée **Bilan** dans Rapports ; aucun calcul modifié | Comparatifs N/N-1 et notes, après validation du référentiel | P3 |
| **Compte de résultat** | Profit & Loss / Statement of Profit or Loss | QBO : P&L sur une période, bilan à une date ; « si le bilan ne balance pas ⇒ erreur » [S2] | Écran provisoire | Entrée **Compte de résultat** ; libellé EN **Profit & Loss** | Présentation statutaire mauricienne et comparatifs | P3 |
| **Clients et fournisseurs** | Customers, Suppliers/Vendors, AR/AP, Aged Debtors/Creditors | Sage Accounting : *Aged Debtors* et *Aged Creditors* dans le catalogue de rapports [S9] ; Xero : *Aged Receivable/Payable Summary* pour la clôture [S6] | Clients dans Facturation ; fournisseurs dans le module Achats, mais entrée mal placée | **Clients** dans Ventes ; **Fournisseurs** dans Achats ; balances âgées explicites « Comptes clients/fournisseurs » | Relances clients et relevés de compte | P3 |
| **Facturation** | Sales Invoices, Quotes, Credit Notes, Payments | Modules ventes et achats séparés chez QBO, Xero, Sage, Zoho [S16][S17] | Factures, devis, avoirs, encaissements mêlés aux fournisseurs | Groupe **Ventes et facturation** ; **Factures clients** / **Sales Invoices** ; MRA e-Invoicing marqué « préparé » | Aucune nouvelle fonction de facturation dans cette mission | — |
| **Banque et rapprochement** | Bank Reconciliation, Reconcile, Match, Rules | Xero : **Accounting > Bank accounts > Reconcile**, étiquettes *Rule / Match / Memory / Prediction / Manual* [S4] ; Sage : **Banking > compte > Reconcile** [S7][S10] ; Xero publie aussi un rapport *Bank Reconciliation Detail* [S5] ; Sage inclut *Unreconciled Bank Transactions* dans ses rapports [S9] | Écran Banque riche mais entrées éclatées ; onglet `report` non exposé | Groupe **Banque** avec Rapprochement (`?tab=transactions`), Comptes, Import, Rapprochement groupé, Règles, Relevé PDF | Exposer l'onglet rapport de rapprochement s'il est déjà fonctionnel ; sinon le laisser hors menu | P2 |
| **Immobilisations** | Fixed Assets, depreciation schedule | Zoho Books : *Fixed Assets* dans le module Accountant [S16] ; les éditeurs publient des rapports de registre et de dotation | Écran unique, sous Comptabilité | Groupe **Stocks et immobilisations** ; libellé **Immobilisations / Fixed Assets** | Aucun nouveau calcul fiscal ; validation des durées mauriciennes | P3 |
| **Stocks** | Inventory, stock valuation | Xero : rapport *Inventory Item list* utilisé pour le stocktake [S6] | Écran unique, sorti du groupe Comptabilité | Même groupe que les immobilisations, assumé car un écran chacun | Valorisation multi-entrepôt, si le besoin est validé | P3 |
| **Multi-sociétés** | Company file, client ledger, practice/accountant workspace | Les offres « cabinet » existent chez les grands éditeurs ; **le détail de leur interface n'a pas été vérifié** dans cette mission | Dossiers clients, société active, rôles, isolation serveur | Groupe **Clients et sociétés** ; changement de dossier sans fuite déjà couvert par les tests d'isolation | Ne pas ajouter d'édition commerciale ni de nouveau rôle | — |
| **Collaboration cabinet-client** | Accountant workspace, tasks, notes, documents | Non vérifié fonctionnellement chez les concurrents dans cette mission | Tâches & échéances, collaborateurs, documents, assistant IA | Entrées regroupées sous **Clients et sociétés** et **Ventes** ; aucun nouvel accès | Portail client documentaire, hors périmètre M36 | P3 |
| **Rapports et exports** | Reports, All reports, Export CSV/PDF | Sage : catalogue avec Trial Balance, Nominal Activity, Aged Debtors/Creditors, **Audit Trail**, **Chart of Accounts**, **Cash Flow Statement**, Unreconciled Bank Transactions [S9] ; Xero : *Bank Reconciliation Summary* et *Detail* [S5][S6] ; Intacct : Financial Report Writer [S12] | CSV pour grand livre, balance, états, stocks, immobilisations, paie, banque ; **pas d'export du plan comptable**, **pas d'état de flux de trésorerie**, pas de pack de clôture | Entrées **Bilan**, **Compte de résultat**, **Tous les états financiers**, **Capitaux propres** ; Piste d'audit dans Paramètres | Export plan comptable ; état de flux ; pack de clôture ; ne pas annoncer de formats concurrents non testés | P2 |

## 2. Ce que la comparaison change réellement

1. **Le plan comptable est chez les concurrents un objet de configuration, pas un
   simple écran de saisie.** Odoo le place sous *Configuration*, Sage sous *Settings*
   et publie un export dédié. COMPTAI le garde dans *Comptabilité* — ce qui est
   défendable — mais doit rendre son import/export identifiable. L'export reste une
   proposition : aucun bouton n'a été ajouté sans API.
2. **Le rapprochement bancaire est à la fois une opération et un rapport.** Xero
   documente un rapport *Bank Reconciliation Detail* et Sage un rapport
   *Unreconciled Bank Transactions*. COMPTAI expose l'opération ; l'onglet rapport
   existant n'est pas encore dans le menu, faute de vérification d'usage.
3. **Les libellés d'états varient selon le référentiel et le type de société.** QBO
   renomme le P&L en *Statement of Activity* pour les organismes à but non lucratif.
   Un glossaire interne est donc nécessaire ; il ne faut pas déduire qu'un libellé
   unique est « le bon » pour tous les dossiers.
4. **Le catalogue de rapports est un repère fort.** Sage regroupe les états dans
   *Reporting > More* et y inclut l'audit trail. COMPTAI a créé un groupe *Rapports*
   et sorti la piste d'audit de l'ombre, sans prétendre à un catalogue exhaustif.
5. **Les menus changent selon l'édition.** Sage 50, Sage Accounting et Sage Intacct
   n'utilisent pas les mêmes chemins, et Sage lui-même publie des comparaisons de
   menus [S7][S10]. La navigation COMPTAI documente ses écarts au lieu de copier un
   chemin unique.

## 3. Sujets non vérifiés / non revendiqués

- **NetSuite** : la page Oracle consultée est un sommaire de domaines (périodes,
  comptabilité, banque, devises, écritures, plan comptable, états, reconnaissance du
  revenu, taxes, immobilisations, multi-livres) [S18]. Aucun chemin de menu n'a été
  vérifié.
- **SAP S/4HANA** : les pages consultées décrivent le *universal journal* et les vues
  analytiques `JournalEntryItem` / `JournalEntryCube` [S19]. Aucune interface n'a été
  testée.
- **Prix, éditions, limites d'utilisateurs** : non comparés.
- **Formats d'export exacts** : seuls les principes CSV/PDF et les noms de rapports
  publiés sont repris ; aucun format propriétaire n'est revendiqué comme compatible.
- **Reprise de données** : aucune compatibilité officielle QuickBooks, Sage ou Xero
  n'est affirmée. Voir `docs/comptai-migration-compatibility-roadmap.md`.

## 4. Sources

| Id | Éditeur | Document | URL |
|---|---|---|---|
| S1 | Intuit QuickBooks Online | *Do all versions of QBO have balance sheet reports?* (Reports > Standard Reports ; libellés variables) | https://quickbooks.intuit.com/community/reports-and-accounting-5/do-all-versions-of-qbo-have-balance-sheet-reports-60732 |
| S2 | Intuit QuickBooks Online | *How to run and read financial reports in QuickBooks Online* (P&L sur période, bilan à une date) | page d'aide Intuit, article « how to run and read financial reports in quickbooks online » (URL non conservée) |
| S3 | Intuit QuickBooks Online | *I cannot find the balance sheet* (libellés selon le type de société) | page d'aide Intuit, article 73242 (URL non conservée) |
| S4 | Xero | *How to use automatic bank reconciliation (UK)* | https://central.xero.com/s/article/How-to-use-automatic-bank-reconciliation-UK |
| S5 | Xero | *Bank Reconciliation Detail report* | https://central.xero.com/0/article/Bank-Reconciliation-Detail-report |
| S6 | Xero Learning | *Tips to prepare for an efficient year end* (Aged Receivable/Payable Summary, Bank Reconciliation Summary, Inventory Item list) | https://learning.central.xero.com/student/page/2629-tips-to-prepare-for-an-efficient-year-end |
| S7 | Sage | *Switching from Sage 50 Accounting — Feature comparison* (Banking > Reconcile ; Reporting > More) | https://help.accounting.sage.com/en-ca/accounting/importing/migration/sage50_feature_comparison.html |
| S8 | Sage | *After moving to Accounting from Sage 50* (Chart of Accounts export CSV/PDF ; Settings > Chart of Accounts) | https://help.accounting.sage.com/en-ca/accounting/importing/migration/after_moving_accounting.html |
| S9 | Sage | *Reports in Sage Accounting* (Trial Balance, Audit Trail, Chart of Accounts, Cash Flow Statement, Unreconciled Bank Transactions) | https://help.accounting.sage.com/en-gb/accounting/reporting/extra-reports-index.html |
| S10 | Sage | *Reconcile your bank account* (Banking > compte > Reconcile) | https://help.accounting.sage.com/en-gb/accounting/banking/bank-reconciliation-how-to.html |
| S11 | Sage Intacct | *Journal entries list* (General Ledger > All > Journal entries ; Draft/Posted) | documentation Sage Intacct, `Journal_Entries/journal-entries-list.htm` (URL de base non conservée) |
| S12 | Sage Intacct | *GL reports overview* (Account balances, Trial balance, GL, Financial Report Writer) | documentation Sage Intacct, `gl-reports-overview.htm` (URL de base non conservée) |
| S13 | Sage 50 | *Nominal codes > Journal entry* (balance nulle obligatoire) | https://my.sage.co.uk (aide Sage 50, article consulté via recherche) |
| S14 | Odoo | *Chart of accounts* — Accounting ‣ Configuration ‣ Chart of Accounts | https://www.odoo.com/documentation/18.0/applications/finance/accounting/get_started/chart_of_accounts.html |
| S15 | Odoo | *Finance* — arborescence Chart of accounts, Journals, Reconciliation, Bank Reconciliation, Multi-currency, Taxes, Reporting | https://www.odoo.com/documentation/20.0/applications/finance.html |
| S16 | Zoho Books | *Accountant* — Manual/Recurring Journals, Chart of Accounts, Sub Accounts, Transaction Locking, Fixed Assets | https://www.zoho.com/books/help/accountant/accountant.html |
| S17 | Zoho Books | *Getting started with Zoho Books* — module Reports | https://www.zoho.com/books/help/getting-started/zoho-books.html |
| S18 | Oracle NetSuite | *NetSuite ERP — accounting topics* (sommaire de domaines, chemins non vérifiés) | https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N129046.html |
| S19 | SAP | *S/4HANA Finance* — universal journal, `JournalEntryItem`, `JournalEntryCube` (concepts, pas d'UI) | https://help.sap.com/doc/saphelp_hba_sfin_300/ (documentation consultée) |

Les URL non conservées sont citées avec leur titre exact pour rester retrouvables
dans l'aide officielle ; elles ne sont pas utilisées comme preuve d'un chemin de menu
précis. Les pages S2, S3 et S13 ont servi à confirmer des principes (états standards,
libellés variables, balance nulle) et non à recopier une interface.
