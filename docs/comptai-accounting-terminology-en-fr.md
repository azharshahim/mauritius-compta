# Terminologie comptable EN/FR — COMPTAI 0.1.1

**Mission :** Arena nº38  
**Date :** 1er novembre 2026  
**Périmètre :** libellés visibles de la navigation, des écrans, des onglets, des boutons, des messages et des tableaux de bord.  
**Hors périmètre :** noms propres, références documentaires, numéros de compte, libellés saisis dans les documents sources, identifiants techniques et clés d’API.

## 1. Règles de traduction retenues

1. **Un concept, un libellé.** Les termes structurants viennent de `apps/web/src/glossary.ts` ; la navigation les importe au lieu de retaper une variante.
2. **Le français reste fonctionnel.** Aucun écran n’est anglais uniquement ; les clés FR/EN sont vérifiées par `tests/i18n-quality.test.ts` et `tests/mission38-navigation.test.ts`.
3. **Les noms propres ne sont pas traduits.** COMPTAI, MRA, MCB, BRN, VAT, EBS, IFP, IRN, les numéros de société et les références de documents restent inchangés.
4. **Les libellés de documents sources ne sont pas traduits.** Un compte nommé par le cabinet, une référence de facture ou un libellé d’écriture importé garde sa valeur d’origine.
5. **Le vocabulaire anglais est celui d’un cabinet mauricien anglophone.** Les calques français (`dossier`, `lettering`, `collaborators`) sont remplacés dans l’interface anglaise ; les champs techniques et les routes ne sont pas renommés.
6. **La casse des menus est homogène.** Les destinations de navigation utilisent la casse de titre (`Bank Reconciliation`, `Purchase Journal`, `Team Members`) ; les phrases et messages restent en casse de phrase.

## 2. Vocabulaire de référence

| Concept | Français | Anglais retenu | À éviter en anglais |
|---|---|---|---|
| Portefeuille de sociétés clientes du cabinet | Dossiers clients / Portefeuilles clients | **Client Portfolios** | `Client dossiers` |
| Dossier comptable d’une société | Dossier comptable / Fiche dossier | **Company File** | `Dossier sheet`, `Client dossier` |
| Société cliente | Société cliente | **Client company** | `Customer` (réservé à la facturation) |
| Client de facturation | Client | **Customer** | `Client` dans les écrans de vente |
| Fournisseur | Fournisseur | **Supplier** | `Vendor` (non utilisé dans COMPTAI) |
| Membre de l’équipe du cabinet | Collaborateur | **Team Member** | `Collaborator` |
| Écriture comptable | Écriture comptable | **Journal Entry** | `Writing`, `Entry line` |
| Registre des écritures | Écritures comptables | **Journal Entries** | `All entries` |
| Journal comptable | Journal | **Journal** | `Book` |
| Journal achats | Journal des achats | **Purchase Journal** | `Purchases journal` |
| Journal ventes | Journal des ventes | **Sales Journal** | `Sales journal` |
| Journal banque | Journal de banque | **Bank Journal** | `Bank book` |
| Journal des opérations diverses | Journal des opérations diverses | **General Journal** | `Miscellaneous journal` |
| Grand livre | Grand livre | **General Ledger** | `Ledger book` |
| Balance générale | Balance générale | **Trial Balance** | `Balance` |
| Rapprochement bancaire | Rapprochement bancaire | **Bank Reconciliation** | `Bank pointage` |
| Imports bancaires | Imports bancaires / Importer un relevé | **Bank Imports** | `Import statement` |
| Règles bancaires | Règles bancaires | **Bank Rules** | `Reconciliation rules` |
| Régularisations | Régularisations | **Accruals & Prepayments** | `Regularisations` |
| Exercices comptables | Exercices comptables | **Financial Years** | `Fiscal years` |
| Soldes d’ouverture | Soldes d’ouverture | **Opening Balances** | `Starting balances` |
| Clôture annuelle | Clôture annuelle | **Year-End Closing** | `Annual closing` |
| Périodes comptables | Périodes comptables | **Accounting Periods** | `Periods` |
| Lettrage / matching | Lettrage | **Open-Item Matching** | `Lettering` |
| Balance âgée clients | Comptes clients — balance âgée | **Accounts Receivable Aging** | `Customer aging` |
| Balance âgée fournisseurs | Comptes fournisseurs — balance âgée | **Accounts Payable Aging** | `Supplier aging` |
| Paramètres comptables | Paramètres comptables | **Accounting Settings** | `Settings` seul |
| Piste d’audit | Piste d’audit | **Audit Trail** | `Audit log` |
| États financiers | États financiers | **Financial Statements** | `Financials` |
| Capitaux propres et résultats reportés | Capitaux propres et résultats reportés | **Equity & Retained Earnings** | `Owner equity` |

## 3. Corrections appliquées dans l’interface anglaise

| Clé / écran | Avant | Après | Motif |
|---|---|---|---|
| `nav.cabinet.dossiers` | Client dossiers | **Client Portfolios** | libellé interdit ; vocabulaire de portefeuille |
| `cabinet.companies.title` | Client dossiers | **Client Portfolios** | cohérence avec la navigation |
| `cabinet.dossier.title` | Dossier sheet | **Company File** | dossier comptable d’une société |
| `cabinet.companies.new` | New dossier | **New Company File** | action réelle : créer une société |
| `cabinet.companies.edit` | Edit dossier | **Edit Company File** | idem |
| `cabinet.companies.open` | Open dossier | **Open Company File** | idem |
| `cabinet.companies.manager` | Dossier manager | **Client Manager** | rôle du cabinet |
| `cabinet.team.title` | Collaborators | **Team Members** | vocabulaire RH professionnel |
| `cabinet.dossier.team` | Assigned collaborators | **Assigned team members** | idem |
| `cabinet.dashboard.sub` | dossiers assigned to you | **client files assigned to you** | suppression du calque |
| `cabinet.kpi.active` / `archived` | Active / Archived dossiers | **Active / Archived client files** | idem |
| `cabinet.kpi.toReview` | Dossiers to review | **Files to review** | idem |
| `cabinet.tasks.sub` | per dossier and collaborator | **by company file and team member** | idem |
| `cabinet.tasks.allCompanies` | All dossiers | **All Company Files** | idem |
| `module.locked` | Module not authorised on this dossier | **… for this company file** | idem |
| `error.MODULE_FORBIDDEN` | … on this dossier | **… for this company file** | idem |
| `error.COMPANY_ARCHIVED` | This dossier is archived | **This company file is archived** | idem |
| `error.MEMBER_NOT_FOUND` | Collaborator not found on this dossier | **Team member not found for this company file** | idem |
| `error.ASSIGNEE_NOT_MEMBER` | not a member of this dossier | **not a member of this company file** | idem |
| `billing.sub` | current dossier only | **current company file only** | idem |
| `billing.customers.empty` | No customer for this dossier | **No customer for this company file** | idem |
| `billing.cap.vatOn` | configured for this dossier | **configured for this company file** | idem |
| `ai.assistant.*` | this dossier | **this company file** | idem |
| `ai.v2.*` | this dossier | **this company file** | idem |
| `assistant.*` | this dossier | **this company file** | idem |
| `nav.journals.all` | All journals | **All Journals** | casse de titre |
| `nav.journals.purchases` | Purchases journal | **Purchase Journal** | singulier + casse |
| `nav.journals.sales` | Sales journal | **Sales Journal** | casse |
| `nav.journals.bank` | Bank journal | **Bank Journal** | casse |
| `nav.journals.general` | General journal | **General Journal** | casse |
| `nav.bank.import` | Import statement | **Bank Imports** | désambiguïse la source |
| `nav.bank.operations` | Reconciliation rules | **Bank Rules** | terme métier court |
| `nav.bank.pdf` | PDF bank statement | **PDF Statement Import** | action réelle (import) |
| `nav.billing.aging` | Accounts Receivable aging | **Accounts Receivable Aging** | casse |
| `nav.purchases.aging` | Accounts Payable aging | **Accounts Payable Aging** | casse |
| `nav.billing.payments` | Customer receipts | **Customer Receipts** | casse |
| `nav.billing.creditNotes` | Customer credit notes | **Customer Credit Notes** | casse |
| `nav.purchases.payments` | Supplier payments | **Supplier Payments** | casse |
| `nav.purchases.creditNotes` | Supplier credit notes | **Supplier Credit Notes** | casse |
| `nav.accounting.lettering` | Lettering | **Open-Item Matching** | calque français non professionnel |
| `lettering.open` | View lettering | **View matching** | idem |
| `lettering.traceability` | … entry → lettering | **… entry → matching** | idem |
| `nav.accounting.multiCurrency` | Multi-currency | **Multi-Currency** | casse |
| `nav.accounting.financialYears` | Financial years | **Financial Years** | casse |
| `nav.accounting.equity` | Equity & retained earnings | **Equity & Retained Earnings** | casse |
| `nav.reports.other` | All financial statements | **Financial Statements** | hub, pas une variante de rapport |
| `nav.settings` | Settings | **Accounting Settings** | lève l’ambiguïté avec le groupe Settings |
| `nav.settings.company` | Company settings | **Company Settings** | casse |
| `nav.settings.data` | Data & backups | **Data & Backups** | casse |
| `nav.cabinet.ai` | Accounting assistant | **AI Assistant** | alignement sur les écrans IA |
| `nav.cabinet.aiProposals` | Proposed entries | **AI Proposals** | alignement sur l’écran de propositions |
| `nav.cabinet.aiSettings` | AI settings | **AI Settings** | casse |
| `nav.cabinet.migration` | Import & migration | **Import & Migration** | casse |
| `nav.documents.archives` | Documents & archive | **Documents & Archives** | pluriel |
| `nav.payroll.declarations` | Statutory returns | **Statutory Returns** | casse |
| `nav.payroll.transfer` | Accounting transfer | **Accounting Transfer** | casse |
| `nav.payroll.periods` | Pay periods | **Pay Periods** | casse |
| `Glossaire` | Bank reconciliation | **Bank Reconciliation** | casse du terme canonique |
| `Glossaire` | Accruals & prepayments | **Accruals & Prepayments** | casse du terme canonique |
| `GuidedDemo` | Guided demo | **Guided Demo** | casse du titre |
| `GuidedDemo` | Reset every demonstration dossier | **Reset every demonstration company file** | suppression du calque |

## 4. Ce qui reste volontairement inchangé

| Élément | Raison |
|---|---|
| Champs techniques `dossier_manager_id`, `dossier_manager_name`, routes `/cabinet/companies/:companyId` | identifiants de code et contrats d’API ; les renommer casserait les données et les favoris |
| Route `/accounting/lettering`, champs API `lettering`, `lettered`, `unlettered` | contrat technique existant ; seul l’affichage anglais devient **matching** |
| `Payslip` au singulier dans le menu Paie | terme du glossaire canonique ; l’écran liste des bulletins, le libellé pourra être pluralisé lors d’une mission dédiée |
| `MRA e-Invoicing — Coming Soon` | nom du chantier MRA et statut explicite ; aucune conformité n’est affirmée |
| Noms de comptes, numéros de compte, références `FAC-DEMO-…`, `DEMO-BRN-…`, `DEMO-VAT-…` | données sources fictives, jamais traduites |
| Libellés saisis par l’utilisateur dans une écriture ou un document | contenu métier, pas une chaîne d’interface |

## 5. Vérifications automatisées

- `tests/i18n-quality.test.ts` : mêmes clés FR/EN, paires canoniques du glossaire, aucune fuite de l’autre langue dans les libellés visibles.
- `tests/mission38-navigation.test.ts` : vocabulaire obligatoire, absence de `Client dossiers`, de `dossiers` et de `collaborators` dans les valeurs anglaises, absence de clés de groupe mortes.
- `tests/mission36-journeys.test.tsx` : parcours complets en français et en anglais sur les écrans existants.
- `tests/mission38-ui.test.tsx` : interface anglaise, onglets de journaux, favoris et navigation mobile.

## 6. Limites

- La revue porte sur les libellés de l’application web et les dictionnaires ; les messages renvoyés directement par l’API ne sont pas tous traduits et retombent sur le texte serveur lorsque le code d’erreur est inconnu.
- Les écrans **Prepared** et **Coming Soon** conservent leur statut : la correction terminologique ne les rend pas opérationnels.
- Aucun test manuel sur téléphone ou tablette physique n’a été effectué ; la navigation mobile est vérifiée en jsdom et par les règles CSS existantes.
