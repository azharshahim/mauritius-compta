# COMPTAI — terminologie comptable FR/EN

**Version :** 0.1.1 — démonstration
**Date :** 1er novembre 2026
**Périmètre :** mission 36 — ergonomie comptable, navigation et cohérence bilingue
**Base :** `main` `4fdea3833895a4cb45aea18bd6e5f729e08b9016` + branche de mission
**Source canonique :** `apps/web/src/glossary.ts` (`GLOSSARY`)

---

## 1. Principe

Une notion comptable = une paire FR/EN canonique, réutilisée par la navigation, les
titres d'écran et les états financiers. Les libellés ne sont plus retapés écran par
écran : `i18n.tsx` importe `GLOSSARY` pour les 25 paires imposées par la mission.
Cela évite qu'un même concept apparaisse comme « Factures », « Factures clients » et
« Ventes » à trois endroits différents.

Trois règles s'appliquent :

1. **On traduit le concept, pas le mot.** « Bills » ne devient pas « additions » mais
   « Factures fournisseurs » ; « Trial Balance » ne devient pas « balance d'essai »
   mais « Balance générale ».
2. **Les données ne sont jamais traduites.** Numéros de compte, noms de sociétés,
   libellés de comptes personnalisés, numéros de facture et références MRA restent
   dans la langue saisie.
3. **La formulation longue reste dans les textes d'aide.** La navigation utilise la
   forme courte et professionnelle ; l'explication (par exemple « facture d'achat
   reçue d'un fournisseur ») reste dans l'infobulle ou l'écran, pas dans le menu.

## 2. Les 25 paires imposées

| # | Concept | Français retenu | English retained | Où le libellé est utilisé | État |
|---|---|---|---|---|---|
| 1 | Dashboard | **Tableau de bord** | **Dashboard** | `nav.group.home`, tableau de bord cabinet / comptable | aligné |
| 2 | Chart of Accounts | **Plan comptable** | **Chart of Accounts** | `nav.accounts`, `accounts.title` | aligné |
| 3 | General Ledger | **Grand livre** | **General Ledger** | `nav.ledger`, `ledger.title` | aligné |
| 4 | Trial Balance | **Balance générale** | **Trial Balance** | `nav.trialBalance`, `tb.title` | aligné |
| 5 | Journal Entries | **Écritures comptables** | **Journal Entries** | `nav.entries`, écran `/accounting/entries` | corrigé M36 (« Écritures » → « Écritures comptables ») |
| 6 | Journals | **Journaux** | **Journals** | `nav.group.journals` ; entrée « Tous les journaux » / « All journals » | aligné |
| 7 | Accounts Receivable | **Comptes clients** | **Accounts Receivable** | `nav.billing.aging` : « Comptes clients — balance âgée » | aligné |
| 8 | Accounts Payable | **Comptes fournisseurs** | **Accounts Payable** | `nav.purchases.aging` : « Comptes fournisseurs — balance âgée » | aligné |
| 9 | Customers | **Clients** | **Customers** | `nav.billing.customers` | aligné |
| 10 | Suppliers / Vendors | **Fournisseurs** | **Suppliers** | `nav.purchases.suppliers` | aligné (forme « Vendors » non utilisée en UI) |
| 11 | Sales Invoices | **Factures clients** | **Sales Invoices** | `nav.billing.invoices`, titre de l'écran factures | aligné ; « Sales invoices » en minuscule corrigé en « Sales Invoices » |
| 12 | Bills | **Factures fournisseurs** | **Bills** | `nav.purchases.invoices`, onglet Achats | corrigé M36 (« Factures d'achat » → « Factures fournisseurs ») |
| 13 | Bank Reconciliation | **Rapprochement bancaire** | **Bank reconciliation** | `nav.bank.reconciliation` | aligné |
| 14 | Profit & Loss | **Compte de résultat** | **Profit & Loss** | `nav.reports.profitLoss`, `st.pl` | aligné ; le titre IFRS complet reste « Statement of Profit or Loss » dans les textes |
| 15 | Balance Sheet | **Bilan** | **Balance Sheet** | `nav.reports.balanceSheet` | aligné ; « Statement of Financial Position » reste le titre IFRS dans l'écran États financiers |
| 16 | Cash Flow Statement | **Tableau des flux de trésorerie** | **Cash Flow Statement** | `GLOSSARY.cashFlowStatement` uniquement | **préparé, non exposé** : aucun écran ni API |
| 17 | Fixed Assets | **Immobilisations** | **Fixed Assets** | `nav.accounting.assets` | aligné |
| 18 | Inventory | **Stocks** | **Inventory** | `nav.accounting.inventory` | aligné |
| 19 | Financial Statements | **États financiers** | **Financial Statements** | `nav.statements`, groupe Rapports | aligné |
| 20 | Year-End Closing | **Clôture annuelle** | **Year-End Closing** | `nav.accounting.yearEndClosing` | capitalisation EN harmonisée |
| 21 | Audit Trail | **Piste d’audit** | **Audit Trail** | `nav.settings.audit` | aligné |
| 22 | Accounting Periods | **Périodes comptables** | **Accounting Periods** | `nav.settings.periods` | aligné |
| 23 | Cost Centres | **Centres de coûts** | **Cost Centres** | `GLOSSARY.costCentres` uniquement | **préparé, non exposé** : fonction absente (audit M36) |
| 24 | Opening Balances | **Soldes d’ouverture** | **Opening Balances** | `nav.accounting.openingBalances` (`?tab=opening`) | aligné et désormais cliquable |
| 25 | Retained Earnings | **Résultats reportés** | **Retained Earnings** | `nav.accounting.equity` : « Capitaux propres et résultats reportés » | aligné |

Le test `apps/web/tests/mission36-navigation.test.ts` vérifie que les 25 clés existent,
que le français et l'anglais sont renseignés et que les deux libellés diffèrent. Les
deux entrées non exposées (16 et 23) sont volontairement présentes dans le glossaire
pour éviter qu'un futur écran invente une troisième traduction ; elles ne créent aucun
lien de navigation.

## 3. Corrections réellement appliquées en M36

| Avant | Après | Raison |
|---|---|---|
| `Écritures` | `Écritures comptables` | paire imposée n°5 ; le mot seul est ambigu avec « écritures » d'un journal |
| `Factures d’achat` (onglet et titre Achats) | `Factures fournisseurs` / `Bills` | paire imposée n°12 ; cohérence avec le menu |
| `Achats & Fournisseurs` (titre d'écran) | `Achats et dépenses` / `Purchases & Expenses` | cohérence avec le groupe de navigation |
| `Sales invoices` | `Sales Invoices` | capitalisation de la paire imposée |
| `Year-end closing` | `Year-End Closing` | capitalisation de la paire imposée |
| `Piste d’audit` inaccessible | `Piste d’audit` dans Paramètres + `?tab=audit` | découvrabilité |
| `nav.accounting.provisions` FR/EN inversés | `GLOSSARY.provisions.fr` côté FR, `.en` côté EN | fuite de registre corrigée (les deux libellés étaient identiques, la faille était logique) |
| `nav.billing.invoicesClients` doublon de `nav.billing.invoices` | clé unique `nav.billing.invoices` | un concept, une clé |

## 4. Conventions mauriciennes et choix assumés

- **IFRS / Companies Act.** Les états financiers statutaires mauriciens utilisent
  généralement « Statement of Financial Position », « Statement of Profit or Loss and
  Other Comprehensive Income » et « Statement of Cash Flows ». COMPTAI reste en
  démonstration : la navigation emploie les formes familières **Bilan**, **Compte de
  résultat**, **Tableau des flux de trésorerie**. Les écrans États financiers portent
  la mention « provisoire » et n'affirment pas être conformes à un référentiel.
- **Usage britannique encore présent à Maurice.** « Turnover », « Stock », « Debtors »
  et « Creditors » restent compris par les professionnels. Les libellés imposés par la
  mission privilégient « Revenue », « Inventory », « Accounts Receivable » et
  « Accounts Payable ». Ces synonymes ne sont pas affichés dans la navigation pour
  éviter deux vocabulaires concurrents ; ils peuvent être rappelés dans une aide.
- **Devise et arrondis.** Les montants restent en MUR par défaut, sans taux fictif.
  Le libellé « Montants exprimés en » / « Amounts expressed in » ne traduit pas le
  code devise.
- **Termes MRA non traduits.** « MRA e-Invoicing », « EBS », « IFP » et « IRN » sont
  des termes réglementaires mauriciens : ils restent identiques en FR et EN, avec une
  glose dans l'écran dédié.
- **Termes comptables non traduits.** « IFRS for SMEs » reste « IFRS for SMEs » en
  français ; « journal » au sens d'un livre comptable reste « journal » (pas
  « revue »), et « journal entry » devient « écriture comptable », jamais « entrée de
  journal ».

## 5. Points à valider par l'expert-comptable mauricien

1. « Bills / Factures fournisseurs » est-il le terme attendu dans un cabinet
   mauricien, ou faut-il conserver « Purchase invoices » en anglais et « Factures
   d'achat » en français comme synonyme d'aide ?
2. Les états financiers doivent-ils afficher « Turnover » plutôt que « Revenue » pour
   la première ligne du compte de résultat ?
3. « Résultats reportés » est-il préféré à « Bénéfices non distribués » /
   « Accumulated profits » dans le contexte mauricien ?
4. « Périodes comptables » (Accounting Periods) doit-il couvrir les exercices
   (« Financial years ») ou rester un concept distinct ? COMPTAI conserve les deux
   écrans/onglets, avec « Exercices comptables » pour la timeline et « Périodes
   comptables » pour les verrous de période.
5. La mention « Statement of Profit or Loss » doit-elle remplacer « Profit & Loss »
   dans l'écran États financiers, la navigation gardant la forme courte ?

## 6. Limites

- La traduction est vérifiée par des tests de présence et de non-fuite, pas par un
  expert-comptable : aucune conformité statutaire n'est affirmée.
- Les textes d'aide, les messages d'erreur métier et les exports PDF n'ont pas tous
  été relus dans cette mission ; seuls les libellés de navigation, les titres d'écran
  et les 25 paires canoniques ont été harmonisés.
- Les écrans « préparés » (MRA e-Invoicing, IFRS) conservent leurs libellés
  volontairement explicites : ils ne doivent pas laisser croire que la fonction
  existe.
