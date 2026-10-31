# Règlements fournisseurs

> Règlements totaux, partiels, groupés, acomptes, affectation d'avoirs et
> rapprochement bancaire. Aucune écriture n'est créée par un règlement.

## 1. Modèle

```text
purchase_payments              purchase_payment_allocations
  id                             payment_id  -> purchase_payments
  supplier_id                    invoice_id  -> purchase_documents (kind=invoice)
  payment_no  RF-AAAA-NNNN       amount      decimal(19,4) > 0
  amount                         cancelled_at (désaffectation historisée)
  unallocated_amount
  status recorded | cancelled
  accounting_entry_id
```

- `unallocated_amount = amount − somme des affectations actives`.
- Un règlement **doit** affecter au moins une facture, sauf s'il est de type
  `advance` (acompte).
- Un acompte reste au passif/actif approprié et **ne solde aucune facture**
  tant qu'il n'est pas affecté.
- Une affectation ne peut jamais dépasser le restant dû de la facture
  (`PURCHASE_ALLOCATION_EXCEEDS_OUTSTANDING`) ni le montant du règlement
  (`PURCHASE_PAYMENT_ALLOCATION_EXCEEDS_AMOUNT`).
- Devise du règlement = devise de la facture ; tout mélange est refusé.
- L'annulation d'un règlement est **motivée** et n'efface rien : les
  affectations reçoivent `cancelled_at`, le statut passe à `cancelled`.

## 2. Scénario imposé — exact et auditable

| Étape | Montant | Résultat |
|---|---|---|
| Facture `ACH-2026-0001` | 80 000,00 MUR | `total_amount = 80000.0000`, `outstanding = 80000.0000` |
| Règlement partiel `RF-2026-0001` | 30 000,00 MUR | `amount_paid = 30000.0000`, `payment_status = partial` |
| **Solde** | **50 000,00 MUR** | `outstanding_amount = 50000.0000` |
| Second règlement | 50 000,00 MUR | `amount_paid = 80000.0000`, `payment_status = paid`, `outstanding = 0.0000` |

Aucun arrondi silencieux : les montants sont des décimales exactes à 4 chiffres
(`BigInt` côté calcul, `numeric(19,4)` côté PostgreSQL).

Le même scénario est présent dans la démo (facture `FAC-DEMO-1001`,
règlement `RF-2026-0001`) et dans les tests API/web.

## 3. Règlements groupés

Un règlement peut affecter plusieurs factures du **même fournisseur** et de la
**même devise** :

```json
{
  "supplierId": "…",
  "amount": "100000.00",
  "currency": "MUR",
  "allocations": [
    { "invoiceId": "…60 000…", "amount": "60000.00" },
    { "invoiceId": "…40 000…", "amount": "40000.00" }
  ]
}
```

Chaque facture est verrouillée et contrôlée séparément. Le total affecté ne
peut excéder le montant du règlement. Le reliquat reste `unallocated_amount`.

## 4. Affectation d'avoir

`POST /companies/:id/purchases/credit-notes/:creditNoteId/allocations`

```json
{ "invoiceId": "…", "amount": "10000.00", "confirm": true, "reason": "Retour fictif" }
```

- L'avoir et la facture doivent être **validés**, du même fournisseur et de la
  même devise.
- Le montant est plafonné par le disponible de l'avoir **et** le restant dû de
  la facture.
- La confirmation humaine (`confirm: true`) est obligatoire.
- La facture comptabilisée n'est **pas** modifiée : seul `credited_amount`
  change. Aucune suppression, aucun remplacement de ligne.
- `DELETE .../allocations/:allocationId` avec `confirm: true` et un motif
  historise la désaffectation.

## 5. Intégration Banque

Une transaction bancaire **au débit** peut être liée à un règlement fournisseur
existant, sans créer un second paiement ni une seconde écriture.

```text
GET    /companies/:id/bank/transactions/:transactionId/supplier-payments
POST   /companies/:id/bank/transactions/:transactionId/supplier-payments
DELETE /companies/:id/bank/transactions/:transactionId/supplier-payments/:paymentId
```

- Candidats : direction `out`, devise identique, règlement non annulé,
  `availableAmount`, `suggestedAmount`, `confidence`, blocages explicites
  (`DIRECTION_MISMATCH`, `PAYMENT_FULLY_ALLOCATED`, `TRANSACTION_FULLY_ALLOCATED`).
- `POST` exige `confirm: true`. La première confirmation retourne **201**, une
  répétition idempotente **200**.
- Plafonds contrôlés sous `FOR UPDATE` :
  `BANK_AMOUNT_EXCEEDS_TRANSACTION`, `BANK_AMOUNT_EXCEEDS_PAYMENT`.
- La transaction passe `matched` ou `partially_matched`. `bank_matches` porte
  `purchase_payment_id` et `purchase_invoice_id`.
- `DELETE` exige `confirm: true`, conserve la ligne avec statut `rejected` et
  recalcule l'état de la transaction.

L'interface Achats affiche les règlements et leur état de comptabilisation.
Le panneau Banque expose les candidats via l'API ; la démonstration navigateur
présente le scénario fournisseur sans connexion bancaire réelle.

## 6. Concurrence

Tests PostgreSQL réels (`tests/concurrency.test.ts`, job CI `postgres-tests`) :

1. deux règlements simultanés sur une facture de 80 000 → un `201`, un `409` ;
2. deux confirmations simultanées du même lien bancaire → un `201`, un `200`,
   une seule ligne `bank_matches` confirmée ;
3. deux avoirs simultanés sur une facture de 50 000 → un `201`, un `409`.

Ces tests sont **ignorés en local** sans `TEST_DATABASE_URL` et exécutés sur
PostgreSQL réel via GitHub Actions. Aucun test de concurrence n'est simulé.
