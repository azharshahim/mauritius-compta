# Mission 22 — Stocks, charges à payer/avances, provisions et clôture

_État au 1er novembre 2026. Branche `arena/ff2ad842-mauritius-compta`, PR en brouillon,
**aucune fusion**, aucun déploiement, aucune donnée réelle, aucun paiement, aucune déclaration
MRA. `main` reste intact._

## 1. Fonctionnalités livrées

### Stocks

- Catégories configurables (FIFO ou coût moyen pondéré), comptes de stock, COGS, ajustement et
  dépréciation choisis explicitement ; aucun compte ni taux imposé.
- Emplacements multiples, articles avec SKU, unité et seuil de réapprovisionnement.
- Stock d’ouverture, réceptions, sorties, ajustements, transferts entre emplacements.
- **Aucun stock négatif** : une sortie est refusée à la comptabilisation lorsque le solde est
  insuffisant, sauf politique explicite `allow_negative_stock` par catégorie.
- FIFO par lots datés (`inventory_lot_allocations`) et coût moyen pondéré par division décimale
  exacte ; quantités et valeurs en `bigint` d’échelle 4, sans flottant.
- Inventaires physiques avec quantités comptées, différence, coût unitaire et génération de
  mouvements d’ajustement **à l’état proposé**.
- Dépréciations et reprises de dépréciation, avec motif, justificatif et validation humaine.
- Rapports : mouvements, valorisation à une date, rapprochement sous-registre ↔ grand livre,
  export CSV et impression navigateur.
- Rapprochement **agrégé par compte de stock** : plusieurs catégories partageant un compte ne
  sont plus comparées séparément au solde entier du compte ; l’écart total reste visible.

### Charges à payer, avances et produits différés

- Quatre natures : charge à payer, produit à recevoir, charge constatée d’avance, produit
  constaté d’avance.
- Échéanciers mensuels, allocation exacte par période, reliquat d’arrondi porté sur la dernière
  période, sans flottant.
- Cycle `DRAFT → APPROVED → ACTIVE → COMPLETED` (ou `CANCELLED`) ; chaque ligne est
  `PENDING → POSTED → REVERSED`.
- Comptabilisation d’une ligne à sa date de fin de période, ou de toutes les échéances dues à une
  date d’arrêté. Refus si l’échéancier n’est pas approuvé ou si la période est clôturée
  (`409 PERIOD_CLOSED`) ; la ligne reste alors `PENDING`.
- Extourne par écriture inverse datée, avec motif ; aucune ligne comptabilisée n’est modifiée.
- Rapport par nature et rapprochement avec les écritures du module (`source='accrual'`).
- Les avances clients/fournisseurs des modules commerciaux ne sont **jamais** confondues avec ces
  ajustements de période.

### Provisions

- Registre documenté : catégorie (litige, garantie, restructuration, autre), description,
  référence de preuve, date de reconnaissance, hypothèses de mesure, part courante et non
  courante, comptes de charge et de dette.
- Mouvements `recognition`, `revision`, `utilisation`, `reversal`, chacun `PROPOSED → APPROVED
  → POSTED` (ou `REJECTED`). Une suggestion ne crée jamais une provision comptabilisée.
- Numérotation `PROV-YYYY-NNNN` et rapports de mouvements par période.
- Rapprochement du registre avec le grand livre, solde recalculé **à la date d’arrêté** à partir
  des seuls mouvements `POSTED`.
- Aucun seuil de probabilité, aucune conformité IAS 37 et aucune règle mauricienne affirmés.

### Intégration fin d’exercice

La checklist de la mission 21 conserve ses contrôles et remplace les trois entrées `unavailable`
par des contrôles réels :

| Contrôle | Ce qui est vérifié | États possibles |
|---|---|---|
| `ACCRUALS_PREPAYMENTS` | échéanciers couvrant la période, rapprochement GL, lignes en attente, brouillons, justificatifs | `pending` (aucun), `block` (écart), `warning`, `ok` |
| `PROVISIONS` | registre vide, rapprochement GL, mouvements en attente, preuves | `pending`, `block`, `warning`, `ok` |
| `INVENTORY` | articles actifs, soldes négatifs, rapprochement GL, mouvements/inventaires/dépréciations en attente, journaux manquants | `pending`, `block`, `warning`, `ok` |

Un registre vide n’est jamais vert : il reste `pending`. Les contrôles des modules réellement
absents restent `unavailable`.

### Interface

- **Comptabilité → Stocks** : onglets Stock, Mouvements, Inventaires physiques, Dépréciations,
  Rapports, Paramètres ; création d’articles/emplacements/catégories ; propositions, décisions
  motivées, comptabilisation ; rapprochement et export.
- **Comptabilité → Charges à payer & avances** : échéanciers, filtres type/statut/période,
  détail des lignes, approbation, annulation, échéances dues, extourne motivée, rapport et
  rapprochement.
- **Comptabilité → Provisions** : registre, filtres, détail, mouvements, approbation/rejet,
  comptabilisation, rapport de mouvements et rapprochement.
- FR/EN, design system existant, tableaux scrollables sans débordement horizontal, aucun
  indicateur de focus supprimé, aucune ouverture forcée du clavier.

## 2. Réutilisé des missions précédentes

- Moteur unique d’écritures : `postEntryTx`, `assertOpenPeriod`, numérotation, audit.
- Plans comptables, journaux, périodes et isolation société existants.
- Missions 11 (achats) et 4 (facturation) : **aucun moteur recréé**. Un pont explicite transforme
  une facture fournisseur validée en réceptions proposées et une facture client émise en sorties
  proposées ; le mapping ligne ↔ article est fourni par l’utilisateur.
- Mission 19 : clôture, ouverture et affectation du résultat inchangées.
- Mission 20 : catégories, propositions et validation humaine comme modèle de gouvernance.
- Mission 21 : checklist, continuité d’ouverture et archives.
- Composants UI, `api`, `qs`, `money`, `downloadExport`, harnais de tests API PGlite et démo
  navigateur.

## 3. `PNL_OPENING_PRESENT` — cause racine et résultat

**Symptôme** : la démonstration de la mission 19 affichait un blocage `PNL_OPENING_PRESENT`
alors que l’exercice précédent n’avait pas de solde de résultat erroné.

**Cause racine** : la fixture d’ouverture comparait des **mouvements bruts cumulés** (débits et
crédits historiques) au lieu des **soldes nets** présentés par la balance. Un compte de résultat
clôturé peut avoir des débits et crédits historiques égaux sans porter de solde d’ouverture ; la
fixture le traitait à tort comme un solde présent.

**Correction** : `buildOpening` calcule désormais le net d’ouverture et le net de clôture
(`débit − crédit`) et n’expose que ce net en débit ou crédit. Aucun montant n’est supprimé, aucune
écriture d’ouverture n’est dupliquée, aucune affectation automatique du résultat n’est faite.

**Nuance métier ajoutée** dans l’aperçu API et la démo : si l’exercice précédent est encore
**ouvert**, des soldes de résultat sont normaux (accumulation de l’exercice en cours) et le
contrôle renvoie `PNL_OPENING_PENDING_CLOSE` (`warning`) au lieu de bloquer. `PNL_OPENING_PRESENT`
(`block`) n’apparaît qu’après clôture effective de l’exercice précédent.

**Résultat vérifié** : pour l’exercice 2025/26 de la démo, `profitAndLossOpening = []` et le
contrôle est `NO_PNL_OPENING` ; pour 2026/27, avertissement `PNL_OPENING_PENDING_CLOSE` ; le
blocage n’apparaît qu’après clôture. Tests démo mission 21 : **5/5**.

## 4. Migration `0020_inventory_accruals_provisions.sql`

| Table | Rôle |
|---|---|
| `inventory_categories` | Méthode de valorisation et comptes par catégorie |
| `inventory_locations` | Entrepôts et emplacements |
| `inventory_items` | Articles, SKU, unité, seuil |
| `inventory_balances` | Soldes quantité/valeur par article et emplacement |
| `inventory_lots` | Lots FIFO datés et quantité restante |
| `inventory_movements` | Mouvements proposés/approuvés/comptabilisés, source et écriture |
| `inventory_lot_allocations` | Consommation FIFO détaillée par lot |
| `inventory_counts` / `inventory_count_lines` | Inventaires physiques et différences |
| `inventory_write_downs` | Dépréciations et reprises, avec preuve et décision |
| `accrual_schedules` / `accrual_schedule_lines` | Échéanciers et allocation par période |
| `provisions` / `provision_movements` | Registre et mouvements de provisions |

Triggers : cohérence société des enfants (`mission22_child_company_check`), immuabilité des
enregistrements comptabilisés (`mission22_block_posted_change`), garde des lignes d’échéancier
(`accrual_lines_guard`). Nouvelles sources d’écriture autorisées : `inventory`, `accrual`,
`provision`.

## 5. Exemples de rapprochement comptable

### FIFO

Stock d’ouverture 100 unités à 10,00 ; achat 40 unités à 12,00 ; sortie de 30 unités.
La sortie consomme 30 unités du premier lot. Il reste 70 × 10,00 + 40 × 12,00 = **1 180,00**
pour 110 unités. Après dépréciation fictive de 100,00 : **1 080,00**, coût unitaire
**9,8182**. Le sous-registre et le compte de stock sont égaux ; `balanced: true`.

### Coût moyen pondéré

Même stock : 100 × 10,00 + 40 × 12,00 = 1 480,00 pour 140 unités, soit 10,5714 l’unité.
Une sortie de 30 unités vaut 317,14 ; il reste 1 162,86 pour 110 unités. La méthode est
indépendante du FIFO et partage le même compte de stock sans double comptage.

### Charges à payer

Loyer fictif de 6 000,00 sur 3 périodes : Dr charge / Cr dette 2 000,00 par échéance. Après deux
échéances comptabilisées, le solde de dette est 4 000,00 et la troisième ligne reste en attente ;
le rapprochement compare ce solde aux écritures `source='accrual'`.

### Provision

Reconnaissance 50 000,00 (Dr charge / Cr provision), utilisation 20 000,00 (Dr provision /
Cr trésorerie), reprise 30 000,00 (Dr provision / Cr charge) ⇒ solde **0,00**. Chaque mouvement
est approuvé puis comptabilisé séparément ; le rapprochement à la date d’arrêté est équilibré.

## 6. Tests réellement exécutés

| Suite | Résultat |
|---|---|
| `npx vitest run apps/api/tests/mission22.test.ts` | **11/11** |
| `npx vitest run apps/api/tests/migrations.test.ts` | **6/6** |
| `npx vitest run apps/api/tests/financial-years.test.ts` | **5/5** |
| Suite API complète `npx vitest run apps/api/tests` | **458 réussis, 11 ignorés** |
| Suite web complète `npx vitest run` depuis `apps/web` | **225/225** |
| dont `demo-mission22.test.ts` | **4/4** |
| dont `mission22-ui.test.tsx` | **3/3** |
| `npx tsc -p apps/api/tsconfig.json --noEmit` | 0 erreur |
| `npx tsc -p apps/web/tsconfig.json --noEmit` | 0 erreur |
| `npm run build -w @mc/web` | réussi |

Cas couverts : quantités et valorisation exactes, FIFO vs coût moyen, rapprochement
stock ↔ GL, allocation de périodes, extourne, mouvements de provisions, approbation obligatoire,
période close, isolation multi-sociétés, pont achat validé → réceptions proposées, checklist réelle,
régression missions 19 à 21. Les tests de concurrence restent ignorés faute de base PostgreSQL
dédiée dans cet environnement.

## 7. Limites fonctionnelles explicites

- **Pas de coûts d’acquisition complexes** : pas de frais de transport, droits, coûts indirects
  ni répartition de coût par ligne au-delà du coût unitaire fourni.
- **Pas de suivi par numéro de série / lot de traçabilité réglementaire** ; les lots internes FIFO
  ne sont pas un registre de traçabilité produit.
- **Pas de réservation de stock**, de stock en transit comptabilisé séparément, ni de réception
  partielle automatisée depuis un bon de commande.
- Le pont achats/facturation est **manuel et explicite** : mapping ligne ↔ article, puis proposition
  de mouvement ; aucune synchronisation automatique rétroactive, aucun mapping permanent. Le pont
  facturation est livré au niveau API et n’a pas encore de bouton dédié dans l’écran.
- **Pas de prorata journalier** des charges constatées d’avance : allocation mensuelle à montant
  égal avec reliquat sur la dernière période.
- **Pas de génération automatique** d’échéanciers à partir des factures fournisseurs ou des
  contrats ; création manuelle ou pont explicite.
- Provisions : pas de calcul de valeur actualisée, pas de taux d’actualisation, pas de matrice de
  probabilité, pas d’IAS 37.
- Rapports PDF : impression navigateur uniquement ; aucun PDF serveur simulé.
- Aucun test sur appareil Android physique ni sur Chrome Windows réel dans cet environnement ;
  les tests DOM ne remplacent pas ces essais.
- Aucun audit complet des licences tierces dans cette mission.

## 8. Manques restants

1. Écran de pont « depuis un achat / une facture » avec mémorisation optionnelle des mappings.
2. Réceptions partielles, rapprochement bon de commande ↔ réception ↔ facture.
3. Coûts accessoires et valorisation à l’entrée (landed cost) avec répartition explicite.
4. Suivi de lots/séries réglementaire et dates de péremption.
5. Génération d’échéanciers récurrents et prorata journalier.
6. Actualisation des provisions et tests de sensibilité (hors IAS 37).
7. États PDF serveur avec police Unicode complète.
8. Tests E2E Playwright sur Android et Windows, et validation par un réviseur.

## 9. Questions consolidées pour le réviseur ACCA/MIPA (en anglais)

1. For a Mauritian SME, which inventory valuation methods should be offered by default, and
   under what circumstances may weighted average be acceptable alongside FIFO?
2. Should opening inventory be valued from supplier invoices only, or do you expect a documented
   physical-count basis for first adoption?
3. What evidence standard do you expect for period-end accruals and prepayments (contract,
   supplier statement, subsequent invoice, or a combination)?
4. For deferred income, which recognition pattern should the tool support when a service is
   delivered unevenly across periods?
5. Should a provision register require a probability or measurement range, even when the tool
   does not assert IAS 37 compliance?
6. Which documents should be mandatory before a provision movement can be approved: legal
   correspondence, management assessment, invoice, or all three?
7. Do you expect reversals of unused provisions in the same period or only at the next reporting
   date?
8. For audit trail purposes, is an explicit approval note plus user identity sufficient, or do you
   require a second reviewer for inventory write-downs and provisions above a threshold?
9. What inventory-to-general-ledger reconciliation format would you accept as audit evidence?
10. Are there any Mauritian disclosure or record-retention requirements we should configure only
    after written confirmation, rather than encoding assumptions now?
