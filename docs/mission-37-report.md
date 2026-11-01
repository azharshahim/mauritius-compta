# RAPPORT DE MISSION ARENA Nº37 — COMPTAI

**Préparation de la démonstration professionnelle pour un expert-comptable mauricien**

**Version :** COMPTAI 0.1.1 — démonstration
**Date :** 1er novembre 2026
**Branche :** `arena/30ab1cd1-mauritius-compta`
**Base :** `main` `87894b1c2d51a768935d05b1014796942adf17a8` (fusion de la PR nº17)
**PR :** nº18 (brouillon) — https://github.com/azharshahim/mauritius-compta/pull/18
**Statut :** implémentation et tests terminés, **non fusionnée**, **non publiée**, en attente de validation explicite
**Données :** fictives uniquement ; aucun compte bancaire réel, aucun numéro d'enregistrement réel, aucun VPS OVH

---

## 1. Résumé exécutif

La mission 37 rend la démonstration COMPTAI immédiatement utilisable par un
expert-comptable mauricien. Une société fictive, **Island Trading Ltd — DEMO
COMPANY**, est livrée avec un plan comptable de **38 comptes**, **59 écritures**
(58 comptabilisées, 1 brouillon), des clients et fournisseurs fictifs, des
factures et achats, deux comptes bancaires, des immobilisations, un article en
stock, **18 salariés** et trois exercices antérieurs/ouverts. Tous les montants
sont stockés dans le navigateur et se réinitialisent sans toucher au serveur.

La démonstration s'ouvre **en anglais** lorsque le relecteur n'a pas encore
choisi de langue ; un choix français déjà enregistré n'est jamais écrasé. Un
nouvel écran **Guided demo** (`/#/demo`) donne accès aux **14 destinations**
demandées et détaille le **scénario en 16 étapes**. Les huit contrôles de santé
affichent les montants calculés en direct depuis les rapports : aucune valeur
n'est codée en dur dans la page.

Deux incohérences réelles ont été trouvées par les tests et corrigées à la
racine : un **numéro d'écriture dupliqué** (`OD-2025-0020`) et un **rattachement
perdu entre le registre des immobilisations et le grand livre** après le
renommage anglais. Le registre et le grand livre concordent désormais à
**0,0000 MUR** ; les codes d'immobilisations sont uniques.

Les résultats reproductibles sont : **web 329 tests / 51 fichiers**, **API 521
tests réussis + 11 ignorés**, **typecheck 0 erreur**, **build de production et
build de démonstration réussis**. La suite PostgreSQL réelle et les migrations
sont vérifiées par les jobs GitHub Actions de la PR ; le résultat final de la CI
est reporté dans la section 10 après exécution.

**La démonstration n'est pas déclarée prête pour la production.** Les points
P0-03, P0-04, P0-05 et P1-16 restent ouverts.

## 2. Périmètre et restrictions respectées

**Dans le périmètre :** données de démonstration existantes, parcours guidé,
libellés anglais, cohérence des montants, documentation de revue, tests
reproductibles, réinitialisation locale.

**Hors périmètre, non modifié :**

- aucune règle fiscale, comptable, TVA, paie ou amortissement fiscal ;
- aucun nouveau moteur de démonstration : le parcours `/demo` appelle les API de
  démonstration existantes ;
- aucune fonctionnalité inventée, aucun bouton fictif ;
- aucune nouvelle intégration IA ; l'assistant de démonstration existant n'a pas
  été étendu ;
- aucune donnée réelle, aucun compte bancaire réel, aucun numéro MRA/BRN réel ;
- aucun accès au VPS OVH, aucun déploiement, aucune publication ;
- aucune édition Lite/Standard/Advanced/Enterprise ;
- aucun rôle inventé, aucun contrôle de sécurité désactivé ;
- les protections M34/M35 sont conservées ;
- aucune conformité IFRS, MRA ou paie n'est affirmée.

Le référentiel comptable est enregistré avec le libellé **`Other`** et l'écran
précise qu'il s'agit d'un libellé informatif. Aucune TVA n'est calculée : la
configuration de facturation a `vat_enabled = false` et le compte 1200 reste un
compte préparatoire.

## 3. Audit préalable — ce qui existait réellement

| Élément audité | Constat | Réutilisation M37 |
|---|---|---|
| Société de démonstration | `Island Trading Ltd — DEMO COMPANY` existait dans `seed-data.ts` | renommée et complétée, même identifiant stable |
| Plan comptable | 38 comptes, types et mappings d'états présents | conservé, libellés anglais |
| Écritures | 59 écritures, numérotation par séquence partagée | conservé, doublon corrigé |
| Facturation | devis, factures, avoir, paiements, aging, détection de doublons | conservé ; documents non comptabilisés signalés |
| Achats | fournisseurs, factures, avoir, paiements, vieillissement multi-devises | conservé |
| Banque | deux comptes, import CSV, rapprochement, rapport d'écarts | conservé ; écart volontaire documenté |
| Immobilisations | registre, amortissements, cession, dépréciation, réconciliation | conservé ; rattachement réparé |
| Stocks | article FIFO, mouvements, sous-registre, réconciliation | conservé |
| Paie | 18 salariés, période bloquée, bulletins de simulation | conservé, aucune règle modifiée |
| Capitaux propres / exercices | clôtures, affectations, archives, soldes d'ouverture | conservé |
| Multi-sociétés | 5 sociétés dont une archivée | conservé, isolement testé |
| Assistant | assistant de démonstration local existant | non modifié fonctionnellement ; recherche de compte rendue compatible EN |
| Export du plan comptable | absent (vérifié en M36) | **non inventé** |
| Flux de trésorerie | absent (vérifié en M36) | **non inventé** |
| Facturation électronique MRA / déclarations TVA | non implémentées | **non inventées** |
| Consolidation / centres de coûts | absents | **non inventés** |

Aucun second moteur de démonstration n'a été créé : `GuidedDemo.tsx` est une
page de liens et de contrôles qui consomme `/dashboard`, `/reports/...`,
`/fixed-assets/reports/reconciliation`, `/inventory/reconciliation`,
`/billing/summary`, `/purchases/aging`, `/bank/report` et `/payroll/periods`.

## 4. Société fictive et jeu de données

| Donnée | Valeur |
|---|---|
| Société | **Island Trading Ltd — DEMO COMPANY** |
| Identifiant technique | UUID stable généré par le moteur de démonstration |
| BRN | `DEMO-BRN-0001` (manifestement fictif) |
| Numéro TVA | `DEMO-VAT-0001` (manifestement fictif) |
| Adresse | `12, Royal Road, Port Louis, Mauritius (fictitious address)` |
| Activité | négoce de biens domestiques (activité fictive) |
| Exercice | `2025-07-01` → `2026-06-30` |
| Devise fonctionnelle / de présentation | **MUR** |
| Référentiel | `Other` — aucun label IFRS |
| Comptes | 38 |
| Journaux | 5 : BQ, CA, OD, PUR, SAL |
| Écritures | 59 : 58 `posted`, 1 brouillon |
| Clients | 2, noms et domaines fictifs |
| Fournisseurs | 2, dont un fournisseur étranger en EUR |
| Immobilisations | 6 enregistrements, dont un cédé et un en construction |
| Stock | 1 article FIFO, 110 unités, valeur 1 080 MUR |
| Salariés | 18, numéros A001 à R018 |
| Sociétés de démonstration | 5, dont 1 archivée |

Aucune valeur ne ressemble à un identifiant réel : les préfixes `DEMO`, les
domaines `example.invalid` / `.test`, l'adresse explicitement fictive et les
noms de salariés tels que « Aline Fictive » rendent la nature fictive visible
sur chaque écran.

### 4.1 Soldes et états vérifiés

| Contrôle | Débit | Crédit | Résultat |
|---|---:|---:|---|
| Balance d'ouverture | 165 000,0000 | 165 000,0000 | équilibrée |
| Mouvements de l'exercice | 3 026 880,0000 | 3 026 880,0000 | équilibrés |
| Balance de clôture | 1 584 480,0000 | 1 584 480,0000 | équilibrée |
| Total actif | 797 080,0000 | — | — |
| Passif + capitaux propres + résultat | — | 133 000 + 662 480 + 1 600 = 797 080 | équilibré |
| Produits | — | 355 500,0000 | — |
| Charges | 353 900,0000 | — | — |
| Résultat | — | — | **1 600,0000** |

Le capital social de clôture est de **650 000 MUR** : 150 000 MUR repris à
l'ouverture et 500 000 MUR apportés pendant l'exercice. Le résumé de balance
d'ouverture de 165 000 MUR correspond aux soldes repris avant cet apport.

### 4.2 Immobilisations et stocks

| Contrôle | Registre | Grand livre | Écart |
|---|---:|---:|---:|
| Coût des immobilisations (hors en-cours) | 648 000,0000 | 648 000,0000 | **0,0000** |
| Amortissements cumulés | 21 000,0000 | 21 000,0000 | **0,0000** |
| Dépréciations cumulées | 2 000,0000 | 2 000,0000 | **0,0000** |
| Immobilisations en cours | 500 000,0000 | 500 000,0000 | **0,0000** |
| Stock (sous-registre) | 1 080,0000 | 1 080,0000 | **0,0000** |

Les six immobilisations ont des codes uniques `FA-2025-0001` à `FA-2025-0006`.
Le pick-up `FA-2025-0001` a un coût de 480 000 MUR, 8 000 MUR d'amortissements
cumulés et une valeur nette de 472 000 MUR.

### 4.3 Ventes, achats et banque

| Domaine | Montant / état | Explication |
|---|---|---|
| Créances ouvertes | **61 000 MUR** | aging : 5 000 courant, 6 000 à 61–90 jours, 50 000 à plus de 90 jours |
| Documents de vente comptabilisés | **0 sur 12** | les documents sont des données de flux ; la comptabilisation exige une validation humaine |
| Dettes fournisseurs | **95 000 MUR + 1 000 EUR** | aging par devise, jamais additionné entre devises |
| Documents d'achat en attente de comptabilisation | **7** | 1 brouillon, 1 avoir, 1 facture déjà comptabilisée |
| Compte bancaire MUR | banque 787 000 / grand livre −404 500 | statut `differences`, **16 non rapprochés**, 1 rapproché, écart 1 191 500 |
| Compte bancaire EUR | écart 1 000 EUR | devise suivie séparément |

Le rapport bancaire expose trois causes : `UNMATCHED_BANK_TRANSACTIONS`,
`UNMATCHED_LEDGER_LINES` et `BALANCE_DIFFERENCE`. Il ne force pas un écart nul.
Le compte MUR présente un solde comptable négatif ; il doit être lu comme une
position de trésorerie à découvert dans le jeu d'exercice, pas comme une preuve
de rapprochement.

### 4.4 Paie

| Donnée | Valeur |
|---|---|
| Période | janvier 2026 — statut **`blocked`** |
| Salariés | 18 |
| Calculs | 18 |
| Bulletins | 1, numéro `SIM-202601-0001`, statut `simulation` |
| Statut réglementaire | `EXPERT_REVIEW_PENDING` |
| Mention | **NOT FOR PAYMENT** |
| Net payable | `null` — aucun montant présenté comme payable |
| Brut / net arithmétique | 30 635,0000 / 29 878,3750 |
| Coût employeur | 32 756,3250 |

Les règles de paie n'ont pas été modifiées. La démonstration n'affirme aucune
conformité PAYE/CSG/NSF et ne produit aucun bulletin final.

## 5. Parcours guidé — 14 destinations et 16 étapes

La route **`/#/demo`** est ajoutée à la navigation conditionnelle de
démonstration (`nav.demo.guided`). Elle contient :

1. les informations de la société active, l'exercice, la devise, le libellé de
   référentiel et la mention « informative seulement » ;
2. huit contrôles de santé calculés en direct : balance, bilan, immobilisations,
   stocks, ventes, achats, banque, paie ;
3. les **14 liens** : Dashboard, Chart of Accounts, Journal Entries, General
   Ledger, Trial Balance, Bank Reconciliation, Sales Invoices, Bills, Fixed
   Assets, Inventory, Payroll, Profit & Loss, Balance Sheet, Year-End Closing ;
4. le scénario **16 étapes**, avec pour chaque étape l'écran, l'action et le
   résultat attendu ;
5. les limites connues, visibles sans les masquer ;
6. le bouton **Reset demo data**, qui ne supprime que la clé
   `mc.demo.state.v1` et la société sélectionnée dans le navigateur.

Les liens utilisent les routes et libellés harmonisés en mission 36. Le parcours
est bilingue : anglais par défaut, français après bascule explicite.

## 6. Scénario comptable en 16 étapes

Le détail reproductible, avec les identifiants et les montants attendus, est
dans `docs/comptai-demo-accounting-scenarios.md`. Résumé :

| Étape | Écran | Preuve attendue |
|---|---|---|
| 1. Ouvrir la société | Dashboard | Island Trading active, exercice 2025/2026, MUR |
| 2. Capital et ouverture | Soldes d'ouverture, Balance | ouverture 165 000 = 165 000 ; capital 650 000 en clôture |
| 3. Client et fournisseur | Clients, Fournisseurs | fiches fictives, aucun numéro réel |
| 4. Facture de vente | Sales Invoices | `FAC-DEMO-0002`, 5 000 MUR, état de comptabilisation visible |
| 5. Achat | Bills | `FAC-DEMO-1001`, 80 000 − 30 000 = 50 000 restant |
| 6. Encaissement client | Payments | allocation ≤ total, restant dû mis à jour |
| 7. Paiement fournisseur | Supplier payments | `RF-2026-0001`, 30 000 affectés |
| 8. Relevé fictif | Bank Reconciliation | import CSV, erreurs et doublons signalés |
| 9. Rapprochement | Bank Reconciliation | `FA-2025-001` ou exclusion ; écart expliqué, jamais forcé à zéro |
| 10. Immobilisation | Fixed Assets | 480 000 / 8 000 / 472 000, réconciliation 0 |
| 11. Stock | Inventory | 110 unités, 1 080 MUR, réconciliation 0 |
| 12. Paie fictive | Payroll, Transfer | période bloquée, transfert en aperçu, aucune conformité |
| 13. Grand livre | General Ledger | chaque ligne a journal, numéro et débit/crédit équilibrés |
| 14. Balance | Trial Balance | 1 584 480 = 1 584 480 |
| 15. Bilan et résultat | P&L, Balance Sheet | actif 797 080 = passif 797 080 ; résultat 1 600 |
| 16. Contrôle et clôture | Year-End Closing | checklist explicite, aucune règle appliquée automatiquement |

## 7. Cohérence — tests et anomalies corrigées

### 7.1 Doublon de numéro d'écriture `OD-2025-0020`

**Symptôme :** deux écritures portaient `OD-2025-0020` — la dépréciation de
stock `WD-2025-0001` (source `inventory`, 15/10/2025) et l'ajustement d'exercice
antérieur `PYA-DEMO-2025-001` (source `prior_year_adjustment`, 20/08/2025).

**Cause racine :** `inventory.ts` calculait le numéro suivant par **comptage**
des écritures du journal et de l'année, alors que les autres moteurs utilisent
la séquence partagée `state.sequences`. Un comptage ne peut pas voir une
écriture d'une autre source.

**Correctif :** `entryNo()` utilise désormais
`max(state.sequences[key], plus haut suffixe existant) + 1` puis met à jour la
séquence partagée. Le test vérifie l'unicité de tous les `entry_no`.

### 7.2 Écart de 120 000 MUR sur les immobilisations

**Symptôme :** registre 528 000 MUR contre grand livre 648 000 MUR après le
renommage anglais.

**Cause racine :** `fixed-assets.ts` retrouvait l'achat de démonstration par le
libellé français `/matériel informatique/i` ; le libellé étant devenu anglais,
le rattachement était silencieusement perdu.

**Correctif :** la recherche accepte désormais
`/computer equipment purchase|matériel informatique/i`. Le test vérifie que le
registre et le grand livre concordent à zéro.

### 7.3 Code d'immobilisation dupliqué

**Symptôme :** `FA-2025-0005` apparaissait deux fois (imprimante et matériel
informatique déjà comptabilisé).

**Cause racine :** le code de l'actif rattaché était calculé après plusieurs
codes explicites et la séquence locale consommait deux numéros (une fois dans
`nextAssetCode`, une fois dans `createAsset`).

**Correctif :** les trois actifs concernés utilisent des codes explicites
`FA-2025-0004`, `FA-2025-0005`, `FA-2025-0006`, et un test vérifie l'unicité.
Aucune future création ne doit appeler `nextAssetCode` puis `createAsset` pour
le même actif sans corriger ce double incrément.

### 7.4 Libellés anglais et couplages cachés

Le renommage anglais a révélé plusieurs dépendances à des libellés français :

- `fixed-assets.ts` (corrigé, voir 7.2) ;
- `demo-assistant.ts` cherchait les comptes par `/TVA récupérable/` et
  `/banque/` : les expressions acceptent désormais `VAT recoverable` et `bank` ;
- les tests d'interface bancaire, paie, immobilisations et exercices ont été
  alignés sur les libellés anglais réellement rendus.

Le libellé des opérations du relevé bancaire reste en français : il représente
le document source fictif (`releve-bancaire-fictif.csv`) et sert de clé de
déduplication de l'import. Le changer casserait la détection de doublons ; il
est donc documenté comme document source, pas comme libellé d'interface.

## 8. Résultats de tests reproductibles

| Vérification | Commande | Résultat |
|---|---|---|
| Typecheck API + web | `npm run typecheck` | **0 erreur** |
| Tests web | `npm test -w @mc/web` | **329 réussis / 51 fichiers** |
| Tests API | `npm test -w @mc/api` | **521 réussis, 11 ignorés / 36 fichiers** |
| Build production | `npm run build` | **réussi** ; bundle web 1 255,63 kB (311,47 kB gzip) |
| Build démonstration | `npm run build:demo` | **réussi** ; démo 1 280,31 kB (319,36 kB gzip) + chunk runtime 717,98 kB (199,42 kB gzip) |
| Tests M37 dédiés | `mission37-demo-coherence` + `mission37-guided-demo` | **11 réussis / 11** |

Le build signale un chunk supérieur à 500 kB. C'est un avertissement de
performance, pas un échec : aucune conclusion de production n'en est tirée.

Les tests M37 vérifient notamment :

- la société fictive, son exercice, sa devise, le libellé `Other` et ses 38
  comptes ;
- l'équilibre de chaque écriture, l'unicité des numéros, le brouillon unique ;
- la continuité balance → états → tableau de bord, sans valeur de bouclage ;
- la réconciliation des immobilisations et des stocks ;
- l'exactitude arithmétique des documents de vente/achat et l'absence de
  comptabilisation implicite ;
- l'explication des écarts bancaires ;
- le caractère simulé de la paie et l'unicité des salariés ;
- l'isolement des sociétés et la reproductibilité après `resetDemo()` ;
- le parcours `/demo` hors réseau, avec 14 liens, 16 étapes et 8 contrôles.

### 8.1 Ce qui n'a pas été testé manuellement

Aucun test manuel sur téléphone ou tablette physique n'a été effectué : ces
appareils ne sont pas accessibles dans cet environnement. Aucun test manuel
dans un navigateur réel n'est revendiqué. Les tests d'interface sont exécutés
sous jsdom avec React Testing Library ; ils ne remplacent pas une revue
visuelle sur appareil.

## 9. Limites et points non fiables, signalés volontairement

1. **Sous-registres de vente et d'achat non rapprochés du grand livre.**
   Les 12 documents de vente sont des données de flux ; `postedDocuments = 0`.
   Les créances ouvertes (61 000 MUR) et le compte client du grand livre
   (81 500 MUR) ne concordent donc pas. Les dettes fournisseurs (95 000 MUR +
   1 000 EUR) ne concordent pas non plus avec le compte fournisseur
   (128 000 MUR). La page guidée l'affiche comme
   « Workflow data — not a reconciled subledger ».
2. **Rapprochement bancaire volontairement non terminé.** Un seul élément est
   rapproché ; 16 transactions et 22 lignes du grand livre restent non
   rapprochées. L'écart de 1 191 500 MUR est expliqué par le rapport, pas
   supprimé.
3. **Compte bancaire MUR négatif au grand livre (−404 500).** Il représente une
   position à découvert du jeu d'exercice ; ce n'est pas une preuve de
   cohérence bancaire.
4. **Paie non légale.** Période bloquée, règles incomplètes, aucun net payable,
   aucune conformité PAYE/CSG/NSF. Le transfert comptable est un aperçu soumis à
   décision humaine.
5. **TVA non calculée.** `vat_enabled = false`. Les documents ne contiennent
   aucun montant de TVA ; les mentions fiscales ne doivent pas être testées
   comme opérationnelles.
6. **Facturation électronique MRA, déclarations TVA, obligations fiscales :**
   non implémentées, signalées dans les capacités de l'API
   (`mraEInvoicing: false`).
7. **Pas de tableau de flux de trésorerie, pas de comptabilité analytique, pas
   de consolidation.** Absents, non simulés.
8. **Pas d'export du plan comptable.** Absent, non inventé.
9. **Démonstration navigateur uniquement.** Les données sont dans
   `localStorage` ; vider le stockage ou cliquer sur Reset les recrée. Aucun
   appel à une banque, à la MRA ou à un fournisseur d'IA.
10. **Avertissement de bundle** supérieur à 500 kB ; aucun impact fonctionnel
    démontré, mais non optimisé.
11. **Pas de test manuel mobile/appareil réel**, comme indiqué en 8.1.

Le détail est dans `docs/comptai-demo-known-limitations.md`.

## 10. Intégration continue et état de publication

- Branche : `arena/30ab1cd1-mauritius-compta`, créée depuis `main` `87894b1`.
- Commit de fusion PR nº17 confirmé ancêtre de la branche.
- PR : **brouillon**, nº18 — https://github.com/azharshahim/mauritius-compta/pull/18.
- CI : à vérifier après le push (jobs typecheck/tests/build, PostgreSQL réel et
  migrations). Le résultat sera reporté ici avant toute demande de fusion.
- **Aucune fusion, aucune publication, aucun déploiement** sans autorisation
  explicite.
- P0-03 reste **ouvert** ; P0-04, P0-05 et P1-16 ne sont pas clos.
- COMPTAI n'est **pas déclaré prêt pour la production**.

## 11. Modules — état réel pour la démonstration

| Module | État | Ce qui est réellement utilisable | Ce qui reste partiel / absent |
|---|---|---|---|
| Tableau de bord | **Prêt** | KPI, résultat, actif, contrôle d'équilibre | — |
| Société et paramètres | **Prêt** | société fictive, exercice, MUR, coordonnées fictives | aucune conformité fiscale |
| Plan comptable | **Prêt** | 38 comptes, recherche, types, mappings | pas d'export |
| Écritures / journaux | **Prêt** | 59 écritures, brouillon, grand livre, piste d'audit | workflows avancés non revus manuellement |
| Balance | **Prêt** | ouverture/mouvements/clôture équilibrés | — |
| Bilan et compte de résultat | **Prêt** | actif = passif, résultat 1 600 | pas de flux de trésorerie |
| Banque et rapprochement | **Partiel** | import, matching, rapport d'écarts | écart volontaire non résolu |
| Facturation | **Partiel** | devis, factures, avoir, paiements, aging | 0 document comptabilisé dans le jeu |
| Achats | **Partiel** | fournisseurs, factures, avoir, paiements, aging multi-devises | documents non comptabilisés |
| Immobilisations | **Prêt / partiel** | registre, réconciliation, cession, dépréciation | exécution d'un nouveau plan d'amortissement non testée manuellement |
| Stocks | **Partiel** | 1 article, mouvements, réconciliation | jeu très réduit (110 unités) |
| Paie | **Préparatoire** | simulation, période bloquée, aperçu de transfert | aucune conformité légale, aucun paiement |
| Capitaux propres / clôture | **Partiel** | clôtures, affectations, archives, checklist | aucune clôture légale automatique |
| Multi-sociétés | **Prêt** | 5 sociétés, isolement, reset | pas de consolidation |
| Fiscalité MRA / TVA | **Non disponible** | mention explicite | e-invoicing, déclarations, TVA |
| Analytique / consolidation | **Non disponible** | — | absent |

## 12. Livrables

- `docs/mission-37-report.md` — le présent rapport ;
- `docs/comptai-expert-demo-guide-en.md` — guide non technique de démonstration ;
- `docs/comptai-accountant-review-40-questions-en.md` — questionnaire de 40 questions ;
- `docs/comptai-demo-accounting-scenarios.md` — scénario détaillé en 16 étapes ;
- `docs/comptai-demo-known-limitations.md` — limites et conduite à tenir.

## 13. Recommandation

La démonstration est **utilisable dès maintenant** pour une revue de prise en
main : elle ne présente pas un logiciel vide, les montants se recoupent là où
les rapports le permettent, et les écarts restants sont visibles plutôt que
masqués. Elle ne doit pas être présentée comme un logiciel de production, comme
un produit de paie conforme, comme une solution de facturation électronique MRA
ou comme un substitut à une revue de dossier réelle.

La prochaine décision appartient au commanditaire : autoriser la fusion de la
PR brouillon après vérification de la CI, ou demander des compléments. Aucune
fusion ne sera effectuée sans cette autorisation.
