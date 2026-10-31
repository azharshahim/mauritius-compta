# Guide utilisateur — Lettrage

## Accéder au module

`Comptabilité → Lettrage`. Le compte tiers (Clients `1100` ou Fournisseurs
`2000`, ou le compte configuré sur la fiche) se choisit en haut de l’écran.

## Lettrer manuellement

1. Filtrer sur **Non lettrées**.
2. Cocher au moins une ligne au débit et une au crédit.
3. Vérifier ou ajuster le montant à lettrer (le restant est proposé).
4. Cliquer **Prévisualiser**.
5. Lire les blocages et avertissements ; cocher la confirmation.
6. Cliquer **Confirmer le lettrage**. Le code `LET-AAAA-NNNN` est attribué.

Le lettrage ne modifie ni la facture, ni le règlement, ni l’écriture.

## Utiliser une suggestion

La section **Suggestions explicables** affiche les correspondances calculées :
montant, confiance, raisons et ambiguïtés. Cliquer **Prévisualiser cette
suggestion**, vérifier, puis confirmer. Rien n’est validé automatiquement.

## Comprendre un lettrage partiel

Une facture de 80 000 avec un règlement de 30 000 reste à 50 000. L’écran
affiche le restant commercial et le restant comptable ; un écart éventuel est
montré, jamais arrondi silencieusement.

## Délettrer

Dans **Historique & délettrage**, cliquer **Délettrer** sur un groupe actif.
Saisir un **motif**, cocher la confirmation, valider. Le groupe devient
« Contrepassé » et reste dans l’historique. Les lignes redeviennent lettrables.
Un paiement bancaire n’est jamais annulé par cette action.

## Rapports

L’onglet **Rapports** présente les soldes non lettrés **par devise**, les
factures totalement/partiellement lettrées, les écarts et les règlements non
lettrés. Les boutons exportent des CSV.

## Bonnes pratiques

- Ne lettrer que des écritures comptabilisées.
- Traiter d’abord les documents « en attente de comptabilisation ».
- Une suggestion ambiguë doit être vérifiée manuellement.
- Le lettrage comptable ne remplace pas le rapprochement bancaire.
