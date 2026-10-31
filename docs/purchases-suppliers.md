# Achats & Fournisseurs — fournisseurs, factures et avoirs

> Module **Comptabilité → Achats & Fournisseurs** (mission 11). Données
> fictives en démonstration. Aucune conformité fiscale mauricienne n'est
> affirmée.

## 1. Écran et parcours

| Onglet | Contenu |
|---|---|
| Tableau de bord | Nombre de fournisseurs actifs, factures validées, pièces en attente comptable, brouillons, soldes **par devise** |
| Fournisseurs | Fiches, recherche, détail, soldes et avoirs disponibles par devise |
| Factures d’achat | Brouillons, validation, numérotation `ACH-AAAA-NNNN`, restant dû, comptabilisation |
| Avoirs | Avoirs `AVF-AAAA-NNNN`, affectation à une ou plusieurs factures |
| Règlements | Règlements et acomptes, affectations, annulation motivée, proposition comptable |
| Échéancier | Dettes par fournisseur **et par devise**, retards, export CSV |

Desktop : tableaux. Mobile (< 640 px) : cartes empilées, actions pleine largeur,
aucun défilement horizontal imposé, zone sûre préservée. La pastille de
l'assistant reste visible.

## 2. Fiche fournisseur

Champs enregistrés : raison sociale, référence interne, pays (ISO 2 lettres),
adresse/ville, contact, téléphone, e-mail, numéro d'enregistrement, numéro
fiscal/TVA facultatif, devise habituelle, délai de paiement, **compte
fournisseur du plan comptable actif**, actif/inactif, notes.

- Les fournisseurs étrangers sont autorisés ; leur devise est suivie séparément.
- Un doublon de nom exact est **signalé** (`SUPPLIER_POTENTIAL_DUPLICATE`) avec
  les candidats ; **aucune fusion automatique** n'est effectuée.
- `POST /purchases/suppliers/duplicates/check` renvoie les candidats et
  `mergePerformed: false`.
- Le compte fournisseur doit être un passif **actif** de la société.

## 3. Factures d'achat

Champs : numéro fournisseur, dates d'émission/réception/échéance, devise, taux
de change explicite si devise étrangère, lignes (description, quantité, prix
unitaire, compte de charge/actif, traitement TVA), totaux HT/TVA/TTC, statut,
historique.

### Statuts

```text
draft ──validate──> validated ──proposal/post──> accounting_entry_id
  │                       │
  └──cancel──> cancelled  └──cancel (si aucun règlement/avoir)──> cancelled
```

- Un brouillon ne crée aucune écriture et ne porte pas de numéro définitif.
- La validation attribue `ACH-AAAA-NNNN` via
  `purchase_number_sequences` (`ON CONFLICT DO UPDATE`, atomique).
- Un numéro fournisseur déjà utilisé pour le même fournisseur et la même
  société est refusé (`PURCHASE_DOCUMENT_DUPLICATE`), y compris en brouillon.
- Une facture **comptabilisée** ne peut plus être modifiée ni annulée
  (`PURCHASE_ACCOUNTING_POSTED`) : la correction est une contrepassation
  humaine, puis éventuellement un avoir.
- Une facture avec règlement ou avoir affecté ne peut pas être annulée avant
  désaffectation (`PURCHASE_DOCUMENT_HAS_ALLOCATIONS`).
- L'échéance ne peut précéder la date d'émission.

### Avoirs

- Liés ou non à une facture d'origine.
- Motif facultatif mais historisé.
- Affectables à **plusieurs factures**, dans la limite du disponible de l'avoir
  et du restant dû de chaque facture.
- Un avoir ne modifie jamais `purchase_documents.total_amount` d'une facture :
  il incrémente `credited_amount`. Une facture comptabilisée reste intacte.
- L'annulation d'une affectation d'avoir est une désaffectation historisée
  (`cancelled_at`), jamais une suppression.

## 4. TVA et taxes

- Aucun taux n'est codé en dur.
- `standard` exige un `vatRateId` **configuré et vérifié** dans Paramètres
  société (`PURCHASE_VAT_RATE_UNVERIFIED` sinon).
- `vatRecoverable` doit être explicitement `true` ou `false` ; aucune déduction
  automatique.
- Si la TVA n'est pas récupérable, elle est incluse dans le coût de la ligne.
- `exempt`, `zero_rated`, `out_of_scope` n'acceptent aucun taux.
- Aucune règle MRA, reverse charge, autoliquidation ou prorata n'est
  implémentée. Les libellés le disent explicitement.

## 5. API principale

```text
GET    /companies/:id/purchases/dashboard
GET    /companies/:id/purchases/suppliers
POST   /companies/:id/purchases/suppliers
GET    /companies/:id/purchases/suppliers/:supplierId
PATCH  /companies/:id/purchases/suppliers/:supplierId
GET    /companies/:id/purchases/suppliers/:supplierId/balance
GET    /companies/:id/purchases/suppliers/:supplierId/history
POST   /companies/:id/purchases/suppliers/duplicates/check
GET    /companies/:id/purchases/documents?kind=invoice|credit_note
POST   /companies/:id/purchases/documents
GET    /companies/:id/purchases/documents/:documentId
PATCH  /companies/:id/purchases/documents/:documentId
POST   /companies/:id/purchases/documents/:documentId/validate
POST   /companies/:id/purchases/documents/:documentId/cancel
POST   /companies/:id/purchases/documents/:documentId/proposal
GET    /companies/:id/purchases/documents/:documentId/events
POST   /companies/:id/purchases/credit-notes/:creditNoteId/allocations
DELETE /companies/:id/purchases/credit-notes/:creditNoteId/allocations/:allocationId
```

Les lectures exigent `viewer` sur le module `accounting`; les écritures exigent
`accountant`. Toutes les requêtes sont filtrées par `company_id`.

## 6. Import, OCR et pièces jointes

- Aucun import automatique de facture fournisseur (OCR) n'est implémenté.
- Les pièces jointes PDF/JPEG/PNG peuvent être envoyées à
  `POST /companies/:id/purchases/documents/:documentId/attachments` et listées
  via `GET .../attachments` ; contrôle MIME et signature binaire identique aux
  écritures.
- Une pièce jointe ne rend jamais une facture « comptabilisée ».
