# RAPPORT DE MISSION ARENA Nº36 — COMPTAI

**Ergonomie comptable professionnelle, terminologie internationale et comparaison des concurrents**

**Version :** COMPTAI 0.1.1 — démonstration
**Date :** 1er novembre 2026
**Branche :** `arena/e834c52f-mauritius-compta`
**Base :** `main` `4fdea3833895a4cb45aea18bd6e5f729e08b9016`
**Statut :** implémentation terminée, **non fusionnée**, **non publiée**, en attente de validation explicite
**Données :** fictives uniquement (`resetDemo`, `DEMO`), aucune donnée réelle, aucun VPS OVH

---

## 1. Résumé exécutif

La mission 36 visait à faire gagner à COMPTAI les repères d'un comptable habitué à
QuickBooks, Sage, Xero, Odoo ou Zoho, **sans copier un concurrent** et **sans modifier
les règles comptables**. Le résultat est une navigation réorganisée en **11 groupes**
(contre 8), **65 entrées** (contre 48), un glossaire canonique de **25 paires FR/EN**,
des écrans comptables directement accessibles et **huit parcours testés en français
et en anglais**.

Trois écrans auparavant difficiles à retrouver sont désormais dans le menu :
**Écritures comptables**, **Piste d'audit** et **Soldes d'ouverture / Clôture
annuelle**. Les onglets `?tab=` sont cliquables et l'état actif est calculé sans
allumer plusieurs entrées à la fois.

La comparaison concurrentielle est documentée dans
`docs/comptai-competitor-ux-matrix.md` : **16 domaines**, des sources officielles
datées, et une distinction explicite entre ce qui est vérifié, ce qui reste une
pratique observée et ce qui n'a pas été vérifié (NetSuite, SAP, éditions, prix).

**Aucune compatibilité officielle QuickBooks/Sage/Xero n'est affirmée.** COMPTAI
n'a ni connecteur ni certification ; les profils Sage restent expérimentaux et les
imports QuickBooks/Xero ne sont que des CSV génériques mappés manuellement.

## 2. Périmètre et limites respectées

**Dans le périmètre :** terminologie, navigation, ergonomie, cohérence FR/EN,
découvrabilité, documentation comparative, tests de parcours.

**Hors périmètre, non modifié :**

- aucune règle de paie, fiscalité, TVA, amortissement fiscal ou clôture ;
- aucun calcul comptable (débit/crédit, balance, états) ;
- aucune nouvelle intégration IA ;
- aucune édition Lite/Standard/Advanced/Enterprise ;
- aucun rôle inventé, aucun contrôle de sécurité désactivé ;
- aucun accès au VPS OVH, aucune donnée réelle ;
- aucune copie de code, d'interface, de logo ou d'identité visuelle concurrente ;
- aucune fonctionnalité concurrente inventée.

Les correctifs de sécurité M34 et M35 sont préservés : la mission ne touche ni aux
routes API, ni aux gardes d'autorisation, ni aux contrôles d'isolation. Aucun fichier
de `apps/api/` n'est modifié.

## 3. Phase A — audit de l'existant

### 3.1 Navigation avant la mission

| Constat | Preuve |
|---|---|
| 8 groupes, 48 entrées | `git show main:apps/web/src/navigation.ts` |
| Groupe **Gestion avancée** fourre-tout : immobilisations, stocks, régularisations, provisions, multidevises, capitaux propres, exercices | libellé `nav.group.advanced` |
| Écran `/accounting/entries` existant mais **absent du menu** | route dans `App.tsx`, aucune entrée dans `navigation.ts` |
| **Piste d'audit** présente dans Paramètres, mais aucun lien direct | `Settings.tsx` avec `useState` local |
| **Soldes d'ouverture** et **Clôture annuelle** dans des onglets non adressables par URL | `FinancialYears.tsx`, `useState('timeline')` |
| Fournisseurs rangés dans le groupe **Facturation** | `nav.billing.suppliers` → `/accounting/purchases?tab=suppliers` |
| Libellés ambigus : « Factures », « Factures clients », « Factures d'achat » | `i18n.tsx`, `Purchases.tsx`, `Documents.tsx` |
| « États financiers » désignait à la fois un groupe et un écran | `nav.group.reports` + `nav.statements` |
| Fuite de registre : `nav.accounting.provisions` FR pointait vers `GLOSSARY.provisions.en` (inversé) | `i18n.tsx` avant correction |
| Doublon de clé `nav.billing.invoicesClients` / `nav.billing.invoices` | `i18n.tsx` |
| Pas de recherche transverse | aucune route de recherche globale |
| Pas d'export du plan comptable | `accounts/chart.ts` : import, modèle, confirmation ; aucun CSV |
| Pas d'état de flux de trésorerie | 0 occurrence API/UI (hors glossaire M36) |
| Pas de centres de coûts | 0 occurrence API/UI |

### 3.2 Fonctions présentes mais peu visibles (vérifiées, pas supposées)

- `/accounting/entries` existait et fonctionnait ; il n'était simplement pas dans le
  menu. Il est désormais **Écritures comptables**.
- L'onglet **Piste d'audit** de Paramètres existe et charge les événements ; il était
  seulement impossible à lier directement. Il est désormais `?tab=audit`.
- Les onglets **Soldes d'ouverture** (`?tab=opening`) et **Clôture annuelle**
  (`?tab=checklist`) existent dans `FinancialYears.tsx` ; ils sont désormais
  adressables et liés depuis le menu.
- L'écran Banque possède un onglet **Rapport** (`?tab=report`) fonctionnel ; il n'est
  **pas** ajouté au menu dans cette mission, faute de validation de son usage cabinet.
  Ce n'est pas un oubli : c'est une décision documentée.
- Le plan comptable accepte un import CSV/Excel, un modèle provisoire et une
  confirmation de cabinet. L'export, lui, n'existe pas : aucun bouton n'a été ajouté.

### 3.3 Ce qui n'a pas été déclaré absent à tort

- Les **écritures**, la **piste d'audit**, les **soldes d'ouverture**, la
  **clôture annuelle**, le **rapprochement bancaire**, les **états financiers**,
  les **immobilisations**, les **stocks** et la **paie** existent et sont testés.
- Les **exports** existent pour le grand livre, la balance, les états, les stocks,
  les immobilisations, la paie et la banque. La lacune est limitée au **plan comptable**
  et au **flux de trésorerie**.

## 4. Phase B — comparaison concurrentielle

Le détail (16 domaines, vocabulaire, pratique observée, situation COMPTAI, priorité,
sources) est dans **`docs/comptai-competitor-ux-matrix.md`**.

Synthèse :

| Enseignement | Conséquence COMPTAI |
|---|---|
| Les concurrents placent le plan comptable dans la **configuration** (Odoo), **Settings** (Sage Accounting), **Accountant** (Zoho), **General Ledger** (Intacct) ou **Accounting** (QBO/Xero, partiel) | Le groupe **Comptabilité** de COMPTAI est défendable ; il faut rendre l'import/export identifiable. |
| Le rapprochement est une **opération** et un **rapport** (Xero *Bank Reconciliation Detail*, Sage *Unreconciled Bank Transactions*) | COMPTAI expose l'opération et son onglet Rapport, sans ajouter de faux lien au menu. |
| Les états sont regroupés sous **Reports / Reporting** (QBO, Sage) | Groupe **Rapports** avec Bilan, Compte de résultat, Tous les états, Capitaux propres. |
| Les libellés varient selon le type de société (QBO : *Statement of Activity*, *Statement of Financial Position*) | Un **glossaire interne** est nécessaire ; COMPTAI ne prétend pas à un libellé universel. |
| Sage publie un **export du plan comptable** et un **Audit Trail** dans son catalogue | L'export du plan comptable est une proposition P2 ; la piste d'audit est désormais visible. |

**Sources :** pages officielles QuickBooks, Xero, Sage, Odoo et Zoho, consultées le
1er novembre 2026, listées avec URL dans la matrice. NetSuite et SAP sont cités comme
concepts seulement, sans chemins de menu vérifiés.

## 5. Phase C — terminologie

Le document **`docs/comptai-accounting-terminology-fr-en.md`** contient les 25 paires,
leur emplacement et les corrections. Points saillants :

- `GLOSSARY` (`apps/web/src/glossary.ts`) porte désormais les **25 paires imposées**,
  dont `cashFlowStatement` et `costCentres` préparés mais **non exposés** (fonctions
  absentes).
- `Écritures` → **Écritures comptables** / **Journal Entries**.
- `Factures d'achat` → **Factures fournisseurs** / **Bills** (onglet et titre Achats).
- `Achats & Fournisseurs` → **Achats et dépenses** / **Purchases & Expenses**.
- `Sales invoices` → **Sales Invoices** ; `Year-end closing` → **Year-End Closing** ;
  `Opening balances` → **Opening Balances** ; `Accounting periods` → **Accounting
  Periods**, conformément aux paires imposées.
- `nav.accounting.provisions` FR/EN corrigé ; clé doublon `invoicesClients` supprimée.
- Les 25 paires sont vérifiées par un test (présence FR/EN, non-identité).

**Conventions mauriciennes :** la navigation garde les formes familières **Bilan**,
**Compte de résultat** ; les écrans États financiers conservent les titres IFRS
(*Statement of Financial Position*, *Statement of Profit or Loss*) et l'avertissement
« non conforme IFRS en l'état ». Les termes MRA (EBS, IFP, IRN) ne sont pas traduits.
Les synonymes britanniques (*Turnover*, *Stock*, *Debtors*, *Creditors*) sont
documentés mais non affichés dans le menu pour éviter deux vocabulaires concurrents.

## 6. Phase D — navigation professionnelle

### 6.1 Les 11 groupes livrés

| Groupe FR / EN | Entrées | Exemples d'écrans |
|---|---|---|
| **Tableau de bord** / **Dashboard** | 2 | Tableau de bord Cabinet, Tableau de bord comptable |
| **Clients et sociétés** / **Clients & Companies** | 3 | Dossiers clients, Tâches & échéances, Collaborateurs |
| **Comptabilité** / **Accounting** | 10 | Plan comptable, Écritures comptables, Grand livre, Balance générale, Régularisations, Provisions, Multidevises, Exercices, Soldes d'ouverture, Clôture annuelle |
| **Journaux** / **Journals** | 5 | Tous les journaux, Achats, Ventes, Banque, Opérations diverses |
| **Banque** / **Banking** | 6 | Rapprochement, Comptes bancaires, Importer un relevé, Rapprochement groupé, Règles, Relevé PDF |
| **Ventes et facturation** / **Sales & Invoicing** | 10 | Tableau de bord Ventes, Clients, Devis, Factures clients, Avoirs, Encaissements, Balance âgée clients, Lettrage, Documents, MRA e-Invoicing (préparé) |
| **Achats et dépenses** / **Purchases & Expenses** | 6 | Tableau de bord Achats, Fournisseurs, Factures fournisseurs, Avoirs, Règlements, Balance âgée fournisseurs |
| **Stocks et immobilisations** / **Inventory & Fixed Assets** | 2 | Stocks, Immobilisations |
| **Paie** / **Payroll** | 8 | Tableau de bord Paie, Employés, Contrats, Bulletins, Déclarations (préparé), Transfert, Congés, Périodes |
| **Rapports** / **Reports** | 4 | Bilan, Compte de résultat, Tous les états financiers, Capitaux propres |
| **Paramètres** / **Settings** | 9 | Paramètres, Société, Périodes, Piste d'audit, Données, Migration, Assistant, Écritures proposées, Paramètres IA |

**Total : 65 entrées**, dont **2 marquées « préparées »** (MRA e-Invoicing,
déclarations de paie) : elles mènent à des écrans qui disent explicitement que la
fonction n'est pas opérationnelle, jamais à un bouton fictif.

### 6.2 Décisions assumées

- **Journaux séparés de Comptabilité** : le groupe comptable reste lisible (10 entrées)
  et les journaux forment un groupe de 5, au lieu d'un sous-menu profond.
- **Stocks et immobilisations groupés** : un seul écran chacun ; ce choix évite deux
  groupes presque vides.
- **Achats et dépenses séparé de Ventes** : les fournisseurs ne sont plus dans
  Facturation, ce qui corrige un mélange de modules.
- **Pas d'entrée « Flux de trésorerie »** : la fonction n'existe pas ; le glossaire la
  prépare sans créer de lien.
- **Pas d'entrée « Centres de coûts »** : 0 occurrence dans le code.
- **Pas d'entrée IFRS** : l'écran existe (`/accounting/ifrs`) mais reste un écran
  « préparé » ; il n'est pas dans le menu pour ne pas laisser croire à une couverture
  IFRS.

### 6.3 Liens et état actif

- Chaque `to` du menu correspond à un `<Route path>` déclaré dans `App.tsx`
  (test par regex et correspondance de segments).
- `isNavItemActive` gère les `?tab=`, les routes parentes `end` et les onglets
  inconnus : un onglet non revendiqué par une entrée garde le parent actif.
- `groupIsActive` ouvre le groupe contenant l'écran courant.
- Les accès rapides du tableau de bord cabinet pointent vers Plan comptable, Écritures,
  Grand livre, Balance, Rapprochement, P&L, Bilan et Clôture annuelle.

## 7. Phase E — huit parcours, FR et EN

Le détail est dans **`docs/comptai-accountant-user-journeys.md`** ; les tests sont
`apps/web/tests/mission36-journeys.test.tsx` (**16 exécutions : 8 scénarios × 2
langues**).

| # | Parcours | Ce qui est prouvé |
|---|---|---|
| 1 | Dossier + plan comptable + soldes d'ouverture | Dossier actif, statut provisoire visible, `?tab=opening` sélectionné |
| 2 | Écriture → grand livre → balance | Écriture équilibrée validée, reprise dans le grand livre, balance équilibrée |
| 3 | Facture client → proposition → écriture | Aucune écriture automatique ; validation humaine puis comptabilisation ; facture marquée comptabilisée |
| 4 | Facture fournisseur → proposition → dettes | Document d'achat, proposition séparée, échéancier fournisseur |
| 5 | Rapprochement bancaire et rapport | Onglet Transactions actif, onglet Rapport accessible, aucune écriture implicite |
| 6 | Bilan, P&L, états financiers | Titres, avertissement IFRS, lignes de total |
| 7 | Changement de dossier sans fuite | `mc.companyId` change, la liste du dossier A disparaît, dossier B vide |
| 8 | Immobilisations, stocks, paie | Trois modules atteignables depuis le menu, écrans réels |

Les tests vérifient aussi que **`fetch` n'est jamais appelé** : la démonstration reste
locale et fictive.

## 8. Plan comptable et migration

Le document **`docs/comptai-migration-compatibility-roadmap.md`** détaille l'existant,
la stratégie en six étapes (cadrage, extraction, normalisation, import à blanc, reprise
des soldes, signature, archivage) et la feuille de route.

Points vérifiés :

- imports disponibles : plan comptable, soldes d'ouverture, écritures, clients,
  sociétés ;
- sources : CSV/TSV/XLSX génériques **pris en charge** ; Sage 50/200/Accounting et SAP
  **expérimentaux** ; **aucun profil QuickBooks ni Xero** ;
- aucun connecteur, aucune certification, aucun identifiant concurrent ;
- export du plan comptable **absent** (lacune réelle, proposition P2) ;
- exports existants : grand livre, balance, états, stocks, immobilisations, paie,
  banque, en CSV/PDF selon l'écran ;
- pas de taux de change inventé : un taux daté est exigé pour les devises ;
- pas de reprise du lettrage, des règlements ou des sections analytiques.

## 9. Fichiers modifiés et créés

### 9.1 Code

| Fichier | Nature |
|---|---|
| `apps/web/src/navigation.ts` | réécrit : 11 groupes, 65 entrées, `isNavItemActive`/`groupIsActive` |
| `apps/web/src/glossary.ts` | 25 paires canoniques + entrées M24 conservées |
| `apps/web/src/i18n.tsx` | libellés FR/EN, clés `nav.*`, corrections de doublons et de fuites |
| `apps/web/src/App.tsx` | état actif tenant compte des onglets et du groupe |
| `apps/web/src/pages/Settings.tsx` | onglet piloté par `?tab=` |
| `apps/web/src/pages/accounting/FinancialYears.tsx` | onglet piloté par `?tab=` |
| `apps/web/src/pages/accounting/Purchases.tsx` | libellés Achats/Bills cohérents |
| `apps/web/src/pages/cabinet/CabinetDashboard.tsx` | 8 accès rapides comptables |

### 9.2 Tests

| Fichier | Contenu |
|---|---|
| `apps/web/tests/mission36-navigation.test.ts` | 9 tests : groupes, ≤10 entrées, libellés, 25 paires, routes, écrans clés, absence de faux liens, activation par onglet |
| `apps/web/tests/mission36-ui.test.tsx` | 3 tests : navigation FR, onglets Clôture/Audit, bascule EN |
| `apps/web/tests/mission36-journeys.test.tsx` | 16 tests : 8 parcours × 2 langues |
| Tests M24–M26, `demo-app`, `assistant-ui`, `input-focus`, `purchases-ui` | attentes de libellés alignées sur la nouvelle terminologie |

### 9.3 Documentation

- `docs/mission-36-report.md` (ce rapport)
- `docs/comptai-competitor-ux-matrix.md`
- `docs/comptai-accounting-terminology-fr-en.md`
- `docs/comptai-accountant-user-journeys.md`
- `docs/comptai-migration-compatibility-roadmap.md`

## 10. Résultats des tests

| Vérification | Résultat |
|---|---|
| `npm run typecheck` (API + web, strict) | **0 erreur** |
| `npm run test -w @mc/web` | **49 fichiers, 318 tests réussis, 0 échec** |
| dont mission 36 | **9 + 3 + 16 = 28 tests réussis** |
| `npm run test -w @mc/api` | **35 fichiers réussis, 1 fichier ignoré ; 521 tests réussis, 11 ignorés** |
| `npm run build` | **réussi** (web + API) ; avertissement de taille de bundle Vite (1,25 Mo), non bloquant |
| CI GitHub Actions | à lancer après le commit ; aucun échec lié à la mission 36 n'est attendu |

**Échecs intermédiaires et corrections :**

1. `nav.entries` était encore « Écritures » dans le test de terminologie → corrigé en
   « Écritures comptables ».
2. Les tests M24–M26 et `demo-app` attendaient « Factures », « Factures d'achat »,
   « Journaux comptables », « Tableau de bord Facturation » → attentes alignées sur
   les nouveaux libellés, sans modifier l'application pour « faire passer » un test.
3. Le parcours 2 ne trouvait pas l'écriture dans le grand livre à cause du filtre de
   dates par défaut → le test élargit explicitement la période ; aucun calcul modifié.
4. Les parcours 3/4 avaient des sélecteurs ambigus (`À vérifier`, `FAC-DEMO-1001`,
   actions de ligne) → sélecteurs précisés, sans affaiblir les assertions.
5. `vitest: not found` après restauration de l'environnement → `npm ci` exécuté une
   fois ; les dépendances sont présentes.

Aucun test n'a été marqué `skip` ou supprimé pour faire passer la mission.

## 11. Limites et points bloquants

- **P0-03 reste ouvert** : l'audit M35 est interne, il ne remplace pas une revue
  indépendante ni un test d'intrusion. La mission 36 ne le déclare pas résolu.
- **Pas de production** : P0-03, P0-04, P0-05 et P1-16 doivent être clos ou acceptés
  par écrit avant toute mise en production (voir `docs/mission-35-security-report.md`).
- **Pas de flux de trésorerie**, pas de centres de coûts, pas de notes annexes, pas de
  comparatifs N/N-1, pas de présentation statutaire mauricienne validée.
- **Pas d'export du plan comptable** : lacune P2, aucun bouton fictif ajouté.
- **Pas de recherche globale** : proposition P2.
- **Deux registres de libellés** subsistent (`navigation.ts` et `modules.ts` utilisé par
  les écrans « préparés » et les anciens favoris). La mission les a rendus cohérents
  sur les 25 paires, sans fusionner les registres.
- **Benchmark non exhaustif** : NetSuite et SAP ne sont pas vérifiés au niveau de
  l'interface ; les chemins de menu des concurrents changent selon l'édition et la
  région. Aucun test comparatif n'a été exécuté dans les produits concurrents.
- **Pas de test sur appareil réel** : les parcours mobiles sont couverts par les tests
  jsdom existants (drawer, cibles 44 px), pas par un navigateur mobile physique.
- **Pas de validation par un expert-comptable mauricien** : les choix de terminologie
  et de présentation restent à valider.

## 12. Propositions futures (non implémentées)

| Priorité | Proposition | Condition |
|---|---|---|
| P2 | Export CSV du plan comptable | API + test de round-trip + aucun format concurrent revendiqué |
| P2 | Recherche globale (écrans, comptes, pièces) | index et autorisations par société |
| P2 | Exposer l'onglet Rapport bancaire dans le menu | validation de l'usage cabinet |
| P2 | Fixtures fictives QuickBooks et Xero | tests de mapping, pas de certification |
| P3 | État de flux de trésorerie | méthode et référentiel validés |
| P3 | Centres de coûts | modèle de données et TVA/paie inchangés |
| P3 | Comparatifs N/N-1 et notes annexes | présentation statutaire validée |
| P3 | Fusion des registres `navigation.ts` / `modules.ts` | migration des écrans « préparés » |

## 13. Points à valider par l'expert-comptable mauricien

1. « Bills / Factures fournisseurs » est-il le terme attendu, ou faut-il garder
   « Purchase invoices / Factures d'achat » comme synonyme d'aide ?
2. Faut-il afficher « Turnover » plutôt que « Revenue » dans le compte de résultat ?
3. « Résultats reportés » est-il préféré à « Bénéfices non distribués » ?
4. « Périodes comptables » doit-il absorber les « Exercices comptables » ?
5. Faut-il remplacer « Profit & Loss » par « Statement of Profit or Loss » dans les
   états financiers, la navigation gardant la forme courte ?
6. La place des journaux dans un groupe séparé est-elle naturelle pour un cabinet
   mauricien, ou faut-il un seul groupe « Comptabilité » ?
7. L'onglet Rapport bancaire doit-il être dans le menu Banque ?
8. Les 11 groupes sont-ils trop nombreux pour un usage quotidien sur mobile ?

## 14. Livraison

- Branche créée depuis `main`, **aucune fusion**.
- **PR en brouillon** à ouvrir ; Actions à lancer ; échecs liés à corriger.
- **Aucune publication, aucun déploiement, aucun accès au VPS.**
- **Attente de validation explicite** avant toute fusion.

**État final :** implémentation et documentation terminées, tests locaux verts,
validation professionnelle et revue indépendante encore requises.
