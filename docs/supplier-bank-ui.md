# Interface Banque ↔ Fournisseurs

## Objectif

Finaliser, dans l’écran **Banque & rapprochement**, l’affichage et la
confirmation des liens entre une transaction bancaire et un **règlement
fournisseur déjà enregistré** (API de la mission 11). Aucun second règlement,
aucune écriture et aucun lettrage ne sont créés par ce lien.

## Parcours

1. Ouvrir `Comptabilité → Banque & rapprochement`.
2. Onglet **Transactions**, puis **Ouvrir** une transaction.
3. Le panneau de détail conserve le bloc **Règlements clients liés** (mission
   10) et ajoute le bloc **Règlements fournisseurs liés**.
4. Les candidats sont calculés par
   `GET /bank/transactions/:id/supplier-candidates` : sens, devise, montant
   disponible, restant de la transaction, référence, confiance, anomalies.
5. Cocher **Je vérifie la proposition**, saisir le montant, puis
   **Associer ce règlement fournisseur**.
6. Le retrait utilise `DELETE …/supplier-payments/:paymentId` avec confirmation
   et motif ; l’historique est conservé.

## Garanties

- Idempotence : un second envoi identique renvoie 200, sans doublon.
- Contrôles serveur : sens (décaissement), devise, plafond de la transaction,
  plafond du règlement, double lien, transaction déjà affectée.
- Les erreurs sont traduites et affichées ; aucun succès n’est simulé.
- Aucune comptabilisation : le bouton de comptabilisation d’un règlement client
  reste une action distincte, et le rapprochement fournisseur n’en propose pas.
- Le lettrage comptable est un écran séparé : `Comptabilité → Lettrage`.

## Affichage

- Tableau desktop lisible, montants et devises complets.
- Sous 640 px, le tableau des transactions est remplacé par des cartes ; le
  panneau de détail passe en une colonne et les boutons occupent la largeur.
- Aucun débordement horizontal de page, aucune safe-area modifiée, aucun focus
  forcé ni réouverture du clavier.
- La pastille Démo reste discrète dans l’en-tête ; l’assistant IA flottant reste
  accessible.

## Tests

- `apps/web/tests/bank-ui.test.tsx` vérifie le bloc fournisseur, les candidats,
  l’absence d’appel réseau et les règles CSS mobiles.
- `apps/web/tests/demo-lettering.test.ts` vérifie le lien idempotent, l’absence
  de nouvelle écriture ou de nouveau paiement, puis le retrait.
- La non-régression API est couverte par `tests/purchases.test.ts` et
  `tests/concurrency.test.ts` (PostgreSQL réel en CI).

## Non réalisé / à vérifier

- Aucun test sur un Samsung Android physique.
- Aucune connexion bancaire réelle, aucun OFX/QFX, aucun OCR de relevé PDF.
- Les règles de rapprochement propres à un cabinet mauricien restent à valider.
