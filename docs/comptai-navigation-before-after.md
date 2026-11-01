# Navigation COMPTAI — avant / après la mission 38

**Date :** 1er novembre 2026  
**Base :** `main` `83cfc9a` (mission 37 fusionnée)  
**Branche :** `arena/ec20d0f3-mauritius-compta`  
**Objet :** comparer la barre latérale, les groupes, les routes et les accès directs avant et après la simplification des menus.

## 1. Chiffres clés

| Indicateur | Avant M38 | Après M38 | Écart |
|---|---:|---:|---:|
| Groupes | 11 | **10** | −1 |
| Entrées hors démonstration | 65 | **59** | −6 |
| Entrées avec la démonstration | 66 | **60** | −6 |
| Entrées de journal dans la barre latérale | 5 | **0** (5 onglets) | −5 |
| Raccourcis d’exercice | 3 | **2** | −1 |
| Doublons réels de barre latérale | 6 | **0** | −6 |
| Routes supprimées | 0 | **0** | 0 |
| Fonctions supprimées | 0 | **0** | 0 |

Le décompte de la mission 36 (65 entrées) comprenait les cinq entrées du groupe **Journaux** et trois raccourcis d’exercice. La mission 38 conserve la démonstration M37 comme soixantième entrée.

## 2. Groupes avant / après

| Ordre | Avant M38 | Entrées | Après M38 | Entrées |
|---:|---|---:|---|---:|
| 1 | Dashboard / Tableau de bord | 3 | Dashboard / Tableau de bord | 3 |
| 2 | Clients & Companies / Clients et sociétés | 3 | Clients & Companies / Clients et sociétés | 3 |
| 3 | Accounting / Comptabilité | 10 | Accounting / Comptabilité | 9 |
| 4 | **Journals / Journaux** | **5** | *groupe supprimé* | **0** |
| 5 | Banking / Banque | 6 | Banking / Banque | 6 |
| 6 | Sales & Invoicing / Ventes et facturation | 10 | Sales & Invoicing / Ventes et facturation | 10 |
| 7 | Purchases & Expenses / Achats et dépenses | 6 | Purchases & Expenses / Achats et dépenses | 6 |
| 8 | Inventory & Fixed Assets / Stocks et immobilisations | 2 | Inventory & Fixed Assets / Stocks et immobilisations | 2 |
| 9 | Payroll / Paie | 8 | Payroll / Paie | 8 |
| 10 | Reports / Rapports | 4 | Reports / Rapports | 4 |
| 11 | Settings / Paramètres | 9 | Settings / Paramètres | 9 |
| **Total** | | **66** | | **60** |

## 3. Groupe Comptabilité avant / après

| Avant | Après | Traitement |
|---|---|---|
| Chart of Accounts | Chart of Accounts | inchangé |
| Journal Entries | Journal Entries | devient le registre unique avec cinq onglets |
| General Ledger | General Ledger | inchangé |
| Trial Balance | Trial Balance | inchangé |
| Accruals & Prepayments | Accruals & Prepayments | libellé anglais professionnalisé |
| Provisions | Provisions | inchangé |
| Multi-currency | Multi-Currency | casse professionnelle |
| Financial Years | Financial Years | page socle |
| Opening Balances | **retiré du menu** | onglet de Financial Years ; URL conservée |
| Year-End Closing | Year-End Closing | raccourci vers l’onglet checklist conservé |

## 4. Groupe Journaux : cinq entrées remplacées par cinq onglets

| Avant (barre latérale) | Route | Après |
|---|---|---|
| All Journals | `/accounting/journals` | onglet **Tous les journaux** de Journal Entries ; route redirigée |
| Purchase Journal | `/accounting/journals/purchases` | onglet **Journal des achats** ; route directe conservée |
| Sales Journal | `/accounting/journals/sales` | onglet **Journal des ventes** ; route directe conservée |
| Bank Journal | `/accounting/journals/bank` | onglet **Journal de banque** ; route directe conservée |
| General Journal | `/accounting/journals/general` | onglet **Journal des opérations diverses** ; route directe conservée |

Les onglets sont rendus par `Entries.tsx` avec `role="tablist"`, `role="tab"`, `aria-selected` et des liens focusables. L’onglet actif est déterminé par `journalType` ; l’URL reste le contrat stable pour les favoris et les imports.

## 5. Exercices : trois raccourcis vers une page et deux entrées

| Avant | Après | Justification |
|---|---|---|
| Financial Years `/accounting/financial-years` | Financial Years | page socle (timeline, ajustements, archives) |
| Opening Balances `?tab=opening` | onglet **Soldes d’ouverture** | raccourci d’onglet retiré du menu ; accès direct conservé |
| Year-End Closing `?tab=checklist` | Year-End Closing | conservé : parcours de clôture quotidien, action rapide du tableau de bord |

## 6. Routes et favoris

### 6.1 Redirections ajoutées

| Ancienne URL | Nouvelle destination | Comportement |
|---|---|---|
| `/journals` | `/accounting/entries` | redirection permanente |
| `/accounting/journals` | `/accounting/entries` | redirection en conservant `?search=` et les autres paramètres |
| `/financial-years` | `/accounting/financial-years` | redirection |
| `/accounting/opening-balances` | `/accounting/financial-years?tab=opening` | ouvre directement l’onglet |
| `/accounting/year-end-closing` | `/accounting/financial-years?tab=checklist` | ouvre directement l’onglet |
| `/year-end-closing` | `/accounting/financial-years?tab=checklist` | ouvre directement l’onglet |
| `/companies`, `/accounts`, `/entries`, `/ledger`, `/trial-balance`, `/statements`, `/settings` | routes V0.1 existantes | conservées sans changement |

### 6.2 Routes conservées sans redirection

`/accounting/journals/purchases`, `/accounting/journals/sales`, `/accounting/journals/bank` et `/accounting/journals/general` restent des écrans réels. Les imports `/accounting/journals/{purchases,sales}/import` et `/import/bulk` sont inchangés. Le parcours guidé M37 `/#/demo` reste disponible avec **14 destinations** et **16 étapes**.

## 7. Accès alternatifs conservés

| Accès | Emplacement | Décision |
|---|---|---|
| Year-End Closing | menu Comptabilité + action du tableau de bord cabinet + étape 16 du parcours guidé | conserver : clôture annuelle explicite |
| Opening Balances | onglet Exercices + étape 2 du parcours guidé | conserver l’onglet, retirer le doublon de menu |
| Bank Accounts / Reconciliation / Imports / Rules | une route, quatre onglets | conserver : fonctions distinctes |
| Purchases Dashboard + Suppliers / Bills / Credit Notes / Payments / Aging | une route, cinq onglets | conserver : fonctions distinctes |
| Company Settings | menu Paramètres, URL directe, fiche dossier | conserver : même écran, contextes différents |
| Accounting Periods | Paramètres → onglet Périodes | conserver : ouverture/clôture du statut, avec texte explicatif |
| Assistant IA | menu + pastille flottante | conserver : accès transversal |
| Documents & Archives | menu Ventes + liens des imports | conserver : archive transversale |

## 8. Navigation mobile et accessibilité

- Les **10 groupes** sont rendus par le même composant accordéon ; le groupe actif est ouvert automatiquement.
- Le tiroir mobile se ferme à chaque navigation (`pathname` et `search`), y compris pour les onglets.
- Les nouveaux onglets sont des liens HTML natifs, avec `role="tab"`, `aria-selected`, focus visible et zone tactile conservée.
- Aucun groupe ne dépasse dix entrées ; le groupe Comptabilité en compte neuf.
- Aucun rôle, droit d’accès ou contrôle serveur n’a été modifié.

## 9. Ce qui n’a pas changé

- Les écrans, calculs, moteurs comptables, états financiers, règles TVA et paie sont inchangés.
- Les données fictives M37 et le parcours guidé sont inchangés.
- Les routes métier et les paramètres `?tab=` existants restent valides.
- La marque COMPTAI, les identifiants techniques, le stockage local et le workflow GitHub Pages ne sont pas modifiés.
