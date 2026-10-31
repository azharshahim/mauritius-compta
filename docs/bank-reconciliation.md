# Rapprochement bancaire (mission 9)

## Principe

Le rapprochement relie une **transaction bancaire** à une ou plusieurs
**lignes d'écriture déjà comptabilisées** sur le compte comptable associé au
compte bancaire. Il ne crée aucune écriture. Quand aucune écriture n'existe,
une **proposition** peut être préparée puis acceptée humainement ; c'est
l'acceptation — jamais le rapprochement — qui passe par `postEntryTx`.

## Statuts

| Statut transaction | Signification |
|---|---|
| `unmatched` | non rapprochée, aucune décision |
| `proposed` | une correspondance a été proposée, pas validée |
| `matched` | rapprochement **confirmé par un humain**, montant entièrement affecté |
| `partially_matched` | une partie du montant est affectée à un ou plusieurs règlements (mission 10) |
| `review` | cas ambigu ou complexe, décision humaine requise |
| `excluded` | écarté par un humain (écart, doublon externe, opération ignorée) |
| `cancelled` | annulé (réservé) |

| Statut `bank_matches` | Signification |
|---|---|
| `proposed` | proposition technique (jamais comptée comme rapprochée) |
| `confirmed` | rapprochement validé, avec `decided_by` et `decided_at` |
| `rejected` | proposition refusée |

## Critères et score

- Fenêtre de dates configurable (7 jours par défaut) autour de la date
  d'opération.
- Montant **exact** dans la devise du compte, signe inclus.
- Référence d'écriture ou numéro de facture présent dans le libellé/référence
  bancaire.
- Similarité de libellé, identifiant de paiement et compte.
- Une correspondance exacte, dans la fenêtre et avec référence concordante,
  reçoit `proposed` avec une confiance élevée.
- **Deux** correspondances exactes à ±0,03 → `ambiguous`. L'humain doit choisir
  une ligne ; aucune sélection n'est faite à sa place.

## Cas pris en charge

| Cas | Traitement |
|---|---|
| 1 transaction ↔ 1 ligne | proposition puis confirmation explicite |
| 1 transaction ↔ n lignes | `SPLIT_MATCH` : l'utilisateur sélectionne plusieurs lignes dont le total égale exactement le montant |
| n transactions ↔ 1 ligne | **bloqué** (`MULTI_TRANSACTION_V1`, `review`) : hors périmètre V1 |
| Paiement partiel | `PARTIAL_PAYMENT` → `review`, aucune comptabilisation |
| Frais bancaires | suggestion de compte de charges existant, proposition à valider |
| Virement interne | détection par montant opposé et date proche ; alerte, rapprochement humain |
| Écart de change | `FX_REVIEW` → revue humaine, aucun taux inventé |
| Facture / règlement existant | la ligne d'écriture du règlement est rapprochée ; aucune facture payée deux fois, aucun encaissement créé |

## Validation d'un rapprochement

`POST /companies/:id/bank/transactions/:txnId/matches` exige :

1. `confirm: true` (Zod `z.literal(true)`) — pas de valeur par défaut ;
2. au moins une ligne ;
3. des lignes appartenant au compte bancaire, en statut `posted` ;
4. aucune ligne déjà rapprochée (`BANK_LINE_ALREADY_MATCHED`) ;
5. un total débit − crédit **strictement égal** au montant bancaire
   (`BANK_AMOUNT_MISMATCH`).

Le serveur insère les `bank_matches` confirmés et met la transaction à
`matched` dans **une** transaction PostgreSQL. L'action est auditée
(`match.confirmed`, utilisateur, IP, raisons).

## Propositions comptables

`POST /bank/transactions/:id/proposals` crée un **brouillon** `proposed` avec
compte, journal, date, montant et justification. Aucune écriture n'existe
encore. `POST /bank/proposals/:id/accept` exige `confirm: true` et :

- vérifie une période comptable **ouverte** couvrant la date ;
- exige un taux explicite pour une devise différente de la devise
  fonctionnelle ;
- construit deux lignes équilibrées et appelle le **moteur comptable unique**
  (`postEntryTx`) ;
- marque la proposition `accepted`, enregistre `created_entry_id`, crée le
  rapprochement confirmé et met la transaction à `matched`.

`POST /bank/proposals/:id/reject` clôt la proposition sans écriture.

## Rapport de rapprochement

`GET /bank/report?bankAccountId=…&from=…&to=…` renvoie :

- société, banque, compte, période et devise ;
- soldes bancaires initial/final (déduits des soldes de lignes) et solde
  comptable ;
- transactions rapprochées / non rapprochées, lignes comptables non rapprochées ;
- écarts et explications ;
- date et utilisateur de validation (dans l'audit `bank_events`).

Le statut n'est **`reconciled`** que si l'écart de solde est nul, qu'aucune
transaction non rapprochée ne reste et qu'aucune ligne comptable du compte
n'est orpheline. Sinon, le statut est `differences`.

Export CSV disponible (`GET /bank/report.csv`). **Aucun PDF bancaire n'est
généré** : la génération PDF reste serveur uniquement et n'a pas été
implémentée pour ce rapport, plutôt que de produire un faux PDF.

## Cas volontairement bloqués en V1

- une ligne comptable couvrant plusieurs transactions bancaires ;
- les rapprochements partiels et les écarts de change automatiques ;
- les virements internes entre deux comptes d'une même société : détectés,
  jamais comptabilisés automatiquement ;
- les opérations dont le libellé ne permet aucune suggestion : décision humaine
  obligatoire, aucun compte inventé.

Ces limitations sont affichées dans l'interface (`notImplemented`) et ne sont
pas présentées comme des fonctions de production.


## Mission 10 — rapprochement d'un règlement client

Depuis la mission 10, une transaction peut être affectée à un **règlement
client déjà enregistré**, partiellement ou totalement. Le montant est stocké
dans `bank_matches.amount` ; `billing_payment_id` et éventuellement
`billing_invoice_id` portent la traçabilité. Une transaction peut financer
plusieurs règlements (statut `partially_matched` jusqu'au total) et un
règlement peut être financé par plusieurs transactions (n ↔ 1).

Le rapprochement **ne comptabilise pas** : la comptabilisation du règlement
reste l'action distincte `from-billing → validate → post`. Voir
[`bank-billing-integration.md`](bank-billing-integration.md) et
[`advanced-reconciliation.md`](advanced-reconciliation.md).

Limites : les lignes comptables restent rapprochées en totalité, les devises
différentes sont refusées, et le lettrage de grand livre n'existe pas.

## Endpoints mission 10

| Méthode | Route | Permission |
|---|---|---|
| GET | `/companies/:id/bank/transactions/:txnId/billing-candidates` | viewer |
| POST | `/companies/:id/bank/transactions/:txnId/billing-payments` | accountant |
| DELETE | `/companies/:id/bank/transactions/:txnId/billing-payments/:paymentId` | accountant |
| GET | `/companies/:id/bank/reconciliation-report` | viewer |
| GET | `/companies/:id/bank/reconciliation-report.csv` | viewer |

Les corps et codes d'erreur sont détaillés dans
[`bank-billing-integration.md`](bank-billing-integration.md).
