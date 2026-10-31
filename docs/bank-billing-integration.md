# Intégration Banque ↔ Facturation

> Mission 10. Le rapprochement bancaire ne comptabilise jamais. La
> comptabilisation d'un règlement reste une action humaine distincte qui passe
> par le moteur existant `ai_entry_proposals` → `postEntryTx`.

## 1. Flux de bout en bout

```
Relevé bancaire
   │ import (CSV/TSV/XLSX)
   ▼
bank_transactions (non rapprochée)
   │ candidats déterministes : règlements clients de la même devise
   ▼
Règlement client déjà enregistré (billing_payments)
   │ affecté à une ou plusieurs factures (billing_payment_allocations)
   ▼
Confirmation humaine → bank_matches(amount, billing_payment_id)
   │ aucune écriture comptable
   ▼
(option) « Comptabiliser ce règlement »
   │ POST /ai/entry-proposals/from-billing {paymentId}
   │ POST /ai/entry-proposals/:id/validate
   │ POST /ai/entry-proposals/:id/post
   ▼
journal_entries (source billing) + billing_payments.accounting_entry_id
   │ mise à jour de traçabilité, dans la même transaction
   ▼
bank_matches.entry_id = écriture comptable
```

## 2. API

| Méthode | Route | Permission | Rôle |
|---|---|---|---|
| GET | `/companies/:id/bank/transactions/:txnId` | viewer | détail + `billing.candidates` + restant |
| GET | `/companies/:id/bank/transactions/:txnId/billing-candidates` | viewer | candidats seuls |
| POST | `/companies/:id/bank/transactions/:txnId/billing-payments` | accountant | confirmer une affectation |
| DELETE | `/companies/:id/bank/transactions/:txnId/billing-payments/:paymentId` | accountant | rejeter une affectation (historique conservé) |
| GET | `/companies/:id/bank/reconciliation-report` | viewer | rapport détaillé |
| GET | `/companies/:id/bank/reconciliation-report.csv` | viewer | export CSV détaillé |

Corps de confirmation :

```json
{
  "paymentId": "uuid",
  "amount": "30000.0000",
  "confirm": true,
  "note": "Référence vérifiée sur le relevé fictif"
}
```

Retrait :

```json
{ "confirm": true, "reason": "Erreur de saisie fictive" }
```

Aucun corps n'accepte `confirm: false` pour agir : la confirmation explicite
est obligatoire (`confirm: true`).

## 3. Candidats déterministes

Aucun appel IA n'est effectué. Pour chaque règlement enregistré de la même
devise, l'API calcule :

- restant de la transaction et restant du règlement ;
- montant suggéré = minimum des deux ;
- factures concernées, restant dû de chacune ;
- indices : référence de facture, référence de règlement, nom du client,
  proximité de date, montant exact ;
- anomalies bloquantes : sens (débit/crédit), règlement non affecté, plafonds
  atteints, devise ;
- avertissement non bloquant : affectation partielle ;
- état comptable : déjà comptabilisé ou en attente.

Le tri est stable et explicable ; **aucun candidat n'est validé
automatiquement**, même à confiance 1.

## 4. Anti-doublons

Trois niveaux indépendants :

1. **Base** : `billing_payments.accounting_entry_id` est `UNIQUE` ; un règlement
   ne peut pointer qu'une écriture.
2. **Proposition IA** : `proposeFromBilling({ paymentId })` refuse un règlement
   déjà comptabilisé (`ACCOUNTING_ALREADY_POSTED`).
3. **Validation** : `postProposal` verrouille le règlement (`FOR UPDATE`),
   vérifie `accounting_entry_id IS NULL`, publie via `postEntryTx`, puis exécute
   `UPDATE … WHERE accounting_entry_id IS NULL`; si aucune ligne n'est mise à
   jour, toute la transaction est annulée.

En rapprochement bancaire :
- index unique `(transaction_id, billing_payment_id) WHERE status = 'confirmed'` ;
- répétition identique idempotente ;
- double confirmation concurrente → une seule ligne ;
- plafonds calculés sous verrou.

## 5. Pourquoi le chemin `/billing/*` ne comptabilise pas

Il n'existe **aucune** route de comptabilisation dans `/billing/*`, et la
mission 10 n'en ajoute pas. Le seul moteur autorisé reste :

```
POST /companies/:id/ai/entry-proposals/from-billing
POST /companies/:id/ai/entry-proposals/:id/validate
POST /companies/:id/ai/entry-proposals/:id/post
```

L'écran Banque se contente d'enchaîner ces trois appels après une case de
confirmation humaine. Si la validation retourne des avertissements, l'écran
**n'ajoute pas** `acceptWarnings` : aucune comptabilisation forcée. L'utilisateur
doit traiter les avertissements dans l'assistant comptable.

## 6. Après comptabilisation

Dans la même transaction SQL que le posting, `postProposal` met à jour :

```sql
UPDATE bank_matches
   SET entry_id = <entry>,
       updated_at = now()
 WHERE company_id = <company>
   AND billing_payment_id = <payment>
   AND status = 'confirmed'
   AND entry_id IS NULL;
```

Le lien banque → règlement → écriture reste donc cohérent, y compris lorsque
plusieurs transactions financent un même règlement.

## 7. Ce qui est volontairement refusé

- comptabiliser depuis le rapprochement bancaire sans proposition validée ;
- créer un second paiement pour « faire correspondre » un virement ;
- créer une facture pour absorber un écart ;
- rapprocher un règlement non affecté à une facture ;
- rapprocher des devises différentes ou inventer un taux ;
- modifier/supprimer silencieusement une affectation existante ;
- exclure ou proposer une imputation sur une transaction partiellement
  affectée ;
- fusionner deux transactions ou deux règlements.

## 8. Erreurs principales

| Code | Signification |
|---|---|
| `PAYMENT_NOT_FOUND` | règlement inexistant ou d'une autre société |
| `PAYMENT_NOT_ALLOCATED` | aucune facture affectée |
| `PAYMENT_CANCELLED` | règlement annulé |
| `PAYMENT_RECONCILED` | annulation refusée : rapprochement bancaire confirmé |
| `BANK_CURRENCY_MISMATCH` | devises incompatibles |
| `BANK_DIRECTION_MISMATCH` | décaissement face à un encaissement client |
| `BANK_AMOUNT_EXCEEDS_TRANSACTION` | plafond de la transaction dépassé |
| `BANK_AMOUNT_EXCEEDS_PAYMENT` | plafond du règlement dépassé |
| `BANK_LINK_ALREADY_EXISTS` | même couple, autre montant |
| `BANK_TRANSACTION_PARTIALLY_ALLOCATED` | mélange de mécanismes interdit |
| `BANK_TRANSACTION_CLOSED` | transaction exclue/annulée |
| `ACCOUNTING_ALREADY_POSTED` | seconde écriture refusée |

## 9. Limites

Les factures fournisseurs, avoirs fournisseurs et remboursements clients ne
sont pas modélisés dans Facturation (module client uniquement). Ils sont
déclarés `NON IMPLÉMENTÉ` et ne sont pas simulés. Le lettrage de grand livre
n'existe pas ; voir [`advanced-reconciliation.md`](advanced-reconciliation.md).
