# Lettrage comptable clients & fournisseurs

> **Périmètre.** Ce document décrit le lettrage du grand livre (mission 12).
> Le lettrage ne modifie **jamais** une écriture comptabilisée, ne crée aucun
> règlement, ne comptabilise rien et ne remplace ni l’affectation commerciale
> d’un règlement à une facture, ni le rapprochement bancaire.

## 1. Les trois opérations distinctes

| Opération | Objet | Table | Effet comptable |
|---|---|---|---|
| Affectation commerciale | Rattacher un règlement à une facture | `billing_payment_allocations`, `purchase_payment_allocations`, `purchase_credit_allocations` | Aucun : suivi du solde commercial |
| **Lettrage comptable** | Rapprocher des lignes **déjà comptabilisées** d’un compte tiers | `ledger_letterings`, `ledger_lettering_lines` | Aucun : lecture/annotation du grand livre |
| Rapprochement bancaire | Rattacher une transaction bancaire à un règlement ou une écriture | `bank_matches` | Aucun : preuve de flux |

Un lettrage peut donc exister sans document commercial. Il reste alors
**purement comptable** et porte un avertissement `LETTERING_WITHOUT_DOCUMENT`.

## 2. Comptes lettrables

Sont lettrables les comptes actifs de type `asset` ou `liability` :

- `1100` Clients et `2000` Fournisseurs du plan de démonstration ;
- le compte fournisseur configuré sur la fiche (`purchase_suppliers.payable_account_id`) ;
- le compte client configuré dans `billing_settings.default_receivable_account_id`.

Les comptes de banque, caisse, TVA, produits et charges ne sont pas lettrables.
Aucun compte n’est inventé : un compte absent ou inactif est refusé.

## 3. Règles de création

1. Toutes les lignes appartiennent à la **même société**, au **même compte
   tiers** et sont issues d’écritures au statut `posted`.
2. Au moins une ligne au débit et une au crédit.
3. Total débit = total crédit, montant strictement positif.
4. Une ligne ne peut apparaître qu’une fois dans un groupe.
5. Le montant lettré d’une ligne ne peut pas dépasser son restant
   (`côté − somme des affectations actives`).
6. Aucun mélange de devises d’origine : un lettrage exige une devise source
   commune. Aucun taux de change n’est inventé.
7. La période comptable des écritures doit être ouverte.
8. Code unique `LET-AAAA-NNNN` attribué par une séquence atomique
   (`ledger_lettering_sequences`), protégé aussi par un index unique.
9. `request_key` (clé d’idempotence) unique par société : un rejeu renvoie le
   groupe existant (HTTP 200) au lieu d’en créer un second.

Les verrous `SELECT … FOR UPDATE` sont pris sur les lignes dans un ordre trié
par identifiant, puis les contrôles sont rejoués dans la transaction. Deux
requêtes concurrentes ne peuvent donc pas sur-lettrer la même ligne.

## 4. Lettrage partiel et multiple

Exemple imposé : facture fournisseur de **80 000 MUR**, règlement de
**30 000 MUR**.

- la ligne de facture (crédit 80 000) reçoit une affectation de 30 000 ;
- la ligne de règlement (débit 30 000) reçoit une affectation de 30 000 ;
- le restant de la facture devient **50 000 MUR** ;
- la facture est dite **partiellement lettrée** ;
- le montant de la facture (`purchase_documents.total_amount`) reste 80 000.

Le même mécanisme couvre 1↔1, 1↔N, N↔1, facture + avoir + solde, acomptes et
contrepassations, dans la limite du restant de chaque ligne.

## 5. Suggestions explicables

`GET /lettering/suggestions` calcule des paires déterministes à partir du grand
livre : même compte, même devise, montants restants, références, dates, tiers.
Chaque proposition contient :

- le montant proposé ;
- une confiance entre 0 et 1 ;
- une justification lisible (`SAME_THIRD_PARTY_ACCOUNT`, `EXACT_AMOUNT`,
  `REFERENCE_MATCH`, `CLOSE_DATE`, `SAME_PARTNER`) ;
- les ambiguïtés détectées (plusieurs lignes au même restant) ;
- les deux allocations proposées.

**Aucune suggestion n’est validée automatiquement.** L’utilisateur prévisualise,
coche une confirmation, puis crée le groupe. La proposition est recalculée côté
serveur au moment de la création.

## 6. Délettrage

Le délettrage :

- exige une **permission administrateur de dossier** (`admin`, `owner`,
  `cabinet_admin`), au-delà de l’accès comptable en écriture ;
- exige un **motif** et une confirmation explicite ;
- passe le groupe de `active` à `reversed` (aucune ligne de lettrage n’est
  supprimée) ;
- conserve les allocations et ajoute un événement `reversed` horodaté ;
- libère immédiatement le restant lettrable ;
- est refusé si la période d’une écriture est clôturée ;
- **n’annule jamais un paiement bancaire** : le lien `bank_matches` est
  indépendant et doit être retiré par une action humaine distincte.

## 7. Traçabilité et navigation

Chaque groupe expose son code, son compte, ses lignes, ses documents liés
(facture, avoir, règlement), son auteur, sa date, son motif de délettrage et ses
événements. Les liens disponibles sont :

- Facture / règlement → écriture (`accounting_entry_id`) ;
- écriture → lignes (`journal_lines`) ;
- ligne → lettrage (`ledger_lettering_lines`) ;
- lettrage → historique (`ledger_lettering_events`).

L’écran affiche côte à côte le restant commercial, le restant comptable et le
montant lettré. Un écart n’est jamais arrondi silencieusement.

## 8. Limites déclarées

- Aucun lettrage automatique, aucune validation en lot sans prévisualisation
  humaine.
- Aucun lettrage d’écriture non comptabilisée : un document validé mais non
  comptabilisé reste « en attente de comptabilisation ».
- Aucun change, aucune réévaluation, aucun lettrage inter-devises.
- Les règles comptables mauriciennes précises (seuils, obligations de
  justification, présentation) restent **À VÉRIFIER** par un expert-comptable.
