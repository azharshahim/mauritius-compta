# Rapprochement bancaire avancé

> Mission 10 — Mauritius Business Suite. Données fictives uniquement, aucune
> connexion bancaire, aucun fournisseur IA payant, aucune écriture automatique.

## 1. Trois notions à ne jamais confondre

| Notion | Question posée | Objet de référence | Preuve enregistrée |
|---|---|---|---|
| **Rapprochement bancaire** | Cette ligne de relevé correspond-elle à un encaissement/décaissement déjà enregistré ? | `bank_transactions` ↔ `bank_matches` | montant affecté, validateur, horodatage, note |
| **Affectation d'un règlement** | Quelle(s) facture(s) ce règlement règle-t-il ? | `billing_payments` ↔ `billing_payment_allocations` | montant par facture, statut recalculé |
| **Lettrage comptable** | Quelles lignes de grand livre se soldent mutuellement ? | lignes d'écriture | **non implémenté** (voir §7) |

Une opération peut être rapprochée en banque sans être comptabilisée, et une
facture peut être soldée par des règlements enregistrés sans que le règlement
bancaire correspondant ait encore été pointé. L'interface et les rapports
affichent séparément ces deux états.

## 2. Modèle de données (migration `0010_bank_billing.sql`)

`bank_matches` devient une **affectation chiffrée** :

- `amount numeric(20,4) NOT NULL CHECK (amount > 0)` : part de la transaction
  affectée à cette cible ;
- `billing_payment_id` : règlement client déjà enregistré ;
- `billing_invoice_id` : facture unique lorsque le règlement n'en concerne
  qu'une (traçabilité directe, `NULL` si le règlement en couvre plusieurs) ;
- `note`, `updated_at` : motif humain et historique ;
- index uniques partiels : une seule affectation **confirmée** par couple
  `(transaction, règlement)` et par couple `(transaction, facture)` ;
- les lignes refusées restent en base avec `status = 'rejected'` : aucun
  historique n'est supprimé ;
- les anciennes lignes sont rétro-remplies depuis le mouvement de la ligne
  comptable, sinon depuis le montant de la transaction.

Les statuts de transaction acceptent désormais `partially_matched`.

## 3. Plusieurs transactions → une facture (n ↔ 1)

Chemin recommandé, celui de la démonstration (scénario A) :

1. trois règlements clients sont enregistrés (40 000 + 35 000 + 25 000) et
   affectés à la même facture de 100 000 ;
2. trois transactions bancaires sont importées ;
3. chaque transaction est rapprochée du règlement correspondant, avec
   confirmation humaine ;
4. la facture n'affiche `paid` que si la somme des affectations de règlements
   atteint son total ; tant que ce n'est pas le cas, `outstanding` reste exact.

La facture n'est jamais créée une seconde fois : le rapprochement ne fait que
relier des objets existants.

## 4. Une transaction → plusieurs factures (1 ↔ n)

Deux variantes :

- **un règlement, plusieurs factures** : le règlement est affecté à chaque
  facture (`billing_payment_allocations`), puis la transaction unique est liée
  à ce règlement ; le candidat affiche toutes les factures et leurs restants ;
- **plusieurs règlements sur une transaction** : la transaction est affectée
  successivement (60 000 puis 40 000), son statut passe de
  `partially_matched` à `matched`. La somme confirmée ne peut pas dépasser son
  montant absolu.

## 5. Paiements partiels

Pour chaque règlement, l'API expose :

- montant initial (`amount`), affecté (`matchedAmount`), disponible
  (`availableAmount`) ;
- total affecté aux factures et `unallocated_amount` (trop-perçu) ;
- factures concernées, total, déjà réglé, crédité et **restant dû exact** ;
- statut de comptabilisation et écriture liée ;
- historique des affectations bancaires, validateur et horodatage.

Aucun arrondi silencieux : les calculs utilisent `numeric(20,4)` côté
PostgreSQL et des `bigint` à l'échelle 10⁴ côté TypeScript. Un montant demandé
avec plus de quatre décimales est refusé par le schéma d'entrée
(`^\d{1,15}(\.\d{1,4})?$`).

## 6. Règles de blocage

L'affectation est refusée si :

- la transaction ou le règlement est annulé/exclu ;
- les devises diffèrent (**aucun taux n'est inventé**) ;
- la transaction est un décaissement et le règlement un encaissement client ;
- le règlement n'est affecté à aucune facture ;
- le montant demandé dépasse le restant de la transaction **ou** du règlement ;
- le règlement est déjà lié à cette transaction pour un autre montant ;
- une transaction déjà partiellement affectée tente un second type de
  rapprochement (ligne comptable, proposition, exclusion).

Une répétition **identique** est idempotente : elle renvoie l'affectation
existante avec `idempotent: true` et ne crée aucune ligne.

## 7. Lettrage comptable — état réel

Il n'existe **aucun moteur de lettrage de grand livre** dans le dépôt :

- pas de table `journal_line_letterings`, pas de statut lettré sur
  `journal_lines` ;
- le module Facturation fournit l'affectation de règlements aux factures, qui
  joue le rôle d'open-item pour les créances clients ;
- le rapprochement bancaire confirmé est stocké dans `bank_matches`.

La mission 10 n'a **pas** créé un second grand livre ni un second moteur de
lettrage. Une facture soldée est déduite de ses allocations, pas d'un lettrage
de lignes. Le lettrage manuel de comptes fournisseurs/généraux reste
`NON IMPLÉMENTÉ` et devra faire l'objet d'une mission dédiée (voir §11).

## 8. Cas complexes

| Cas | Comportement actuel |
|---|---|
| Plusieurs virements pour une facture | pris en charge via plusieurs règlements (n ↔ 1) |
| Un virement pour plusieurs factures | pris en charge via un règlement multi-factures (1 ↔ n) |
| Paiement partiel | pris en charge, restant dû visible, statut `partial` |
| Frais bancaires | **non nets** : ils restent une proposition de charge séparée (mission 9), jamais déduits d'un règlement |
| Remboursement client | `NON IMPLÉMENTÉ` : aucun règlement négatif/remboursement dans Facturation ; ne pas détourner un avoir |
| Avoir fournisseur | `NON IMPLÉMENTÉ` : Facturation ne gère que les clients |
| Virement interne | détecté de façon déterministe (`internalTransfer`), aucune confirmation automatique ; le rapprochement de la paire reste manuel |
| Annulation / contrepassation | retrait d'une affectation = ligne `rejected` conservée ; la contrepassation d'écriture reste l'action comptable existante, non automatique |
| Référence ambiguë | plusieurs candidats classés, aucun choix automatique |
| Écart de change | bloqué : devise différente refusée, aucun taux implicite |

## 9. Concurrence et intégrité

Chaque confirmation verrouille la transaction puis le règlement
(`SELECT … FOR UPDATE`), calcule les restants **dans la transaction SQL**, puis
insère l'affectation et recalcule le statut. Les index uniques partiels
empêchent un doublon confirmé. Les scénarios concurrents sont couverts par
`tests/concurrency.test.ts` sur PostgreSQL réel.

## 10. Export et traçabilité

`GET /bank/reconciliation-report` et
`GET /bank/reconciliation-report.csv` fournissent :

- synthèse : rapprochées, partiellement affectées, ouvertes, total affecté et
  non affecté ;
- une ligne par affectation : transaction, montant affecté, restant, règlement,
  factures, écriture, comptabilisation, validateur, date ;
- une ligne par facture : total, réglé, crédité, restant dû, statut, écriture.

Le CSV est généré par l'API sur les mêmes montants exacts. Le navigateur ne
recalcule pas les soldes pour l'export.

## 11. Limites assumées et recommandations mission 11

- `NON IMPLÉMENTÉ` : factures fournisseurs, avoirs fournisseurs, remboursements
  clients, lettrage général, appariement automatique de virements internes,
  OCR bancaire, connexion bancaire.
- Les lignes comptables restent rapprochées en totalité (comportement mission
  9) : le partiel concerne les règlements clients, pas les lignes de grand
  livre.
- Les devises étrangères et écarts de change ne sont pas rapprochés tant qu'un
  traitement comptable sécurisé n'existe pas.
- Un appareil Samsung physique n'étant pas disponible dans l'environnement,
  l'ergonomie mobile est vérifiée par styles et tests DOM, pas sur matériel.
