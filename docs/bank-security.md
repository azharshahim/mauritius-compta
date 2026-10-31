# Sécurité, permissions et audit — banque (mission 9)

## Permissions

Toutes les routes sont préfixées `companies/:companyId/bank` et passent par
`requireCompany(db, userId, companyId, rôle)`.

| Action | Rôle minimum |
|---|---|
| Lister comptes, imports, transactions, règles, rapport | `viewer` |
| Créer un compte bancaire | `accountant` |
| Prévisualiser / importer un relevé | `accountant` |
| Confirmer un rapprochement, exclure une transaction | `accountant` |
| Créer / accepter / refuser une proposition | `accountant` |
| Créer / désactiver une règle | `accountant` |

Un utilisateur hors cabinet reçoit `404` (pas de fuite d'existence) ; un
utilisateur du cabinet sans droit reçoit `403` `MODULE_FORBIDDEN`. La
démonstration applique les mêmes règles de rôle.

## Isolation

- Chaque requête filtre par `company_id` **et** vérifie l'appartenance au
  cabinet. Un `bankAccountId` d'une autre société renvoie
  `BANK_ACCOUNT_NOT_FOUND`.
- Les clés étrangères relient chaque compte, import, transaction, match,
  règle, proposition et événement à `cabinet_id` et `company_id`.
- La ligne comptable sélectionnée doit appartenir au compte d'actif associé et
  à la société (`BANK_LINE_NOT_FOUND`).
- Les tests d'isolation couvrent deux sociétés et deux cabinets.

## Données sensibles

- **Aucune donnée bancaire réelle** dans le dépôt, les tests ou la démo.
- La référence de compte n'est jamais stockée en clair : seuls les quatre
  derniers caractères sont conservés (`•••• 1234`).
- Le fichier téléversé n'est **pas conservé** ; seules les métadonnées
  (nom, taille, empreinte, format, encodage) et les transactions sont stockées.
- Aucun IBAN complet, aucun identifiant bancaire, aucun secret, aucune clé.
- Les exports CSV sont échappés contre l'injection de formules (`=`, `+`, `-`,
  `@`, tabulation, retour chariot).

## Limites anti-abus

- 20 comptes bancaires par société.
- 8 Mo maximum par fichier (`min(MAX_UPLOAD_BYTES, 8 Mo)`).
- 5 000 lignes, 80 colonnes, 1 000 caractères par cellule, 20 feuilles.
- 400 anomalies renvoyées au maximum dans une prévisualisation.
- 1 000 lignes comptables examinées par suggestion.
- Aucune macro ni formule n'est exécutée.

## Validation humaine obligatoire

- `confirm: true` est un littéral Zod : `false` ou absent → `400`.
- Une proposition n'est **jamais** comptabilisée à sa création.
- Un rapprochement n'est jamais `confirmed` sans action explicite.
- Une règle n'est jamais déduite et enregistrée en silence.
- Les cas complexes (partiel, n↔1, écart de change) produisent `review`, pas
  une écriture.

## Audit

Table `bank_events` append-only (aucune route de mise à jour/suppression) :

- `account.created`, `import.confirmed`, `import.replayed`,
  `match.confirmed`, `match.rejected`, `proposal.created`,
  `proposal.accepted`, `proposal.rejected`, `rule.created`,
  `rule.disabled` ;
- acteur, IP, horodatage, métadonnées JSON.

Le rapport expose la date de validation ; l'identité de l'utilisateur est
retrouvée via les événements et `decided_by`.

## Ce que l'IA ne peut pas faire

Même si un fournisseur IA est configuré plus tard, l'architecture bancaire
interdit :

- de comptabiliser une écriture ;
- de modifier un montant bancaire ;
- d'inventer un compte ou un numéro ;
- de valider seule un rapprochement ;
- de créer ou transférer un paiement ;
- de déclencher une déclaration.

Les contrôles sont déterministes et exécutés côté serveur, indépendamment du
fournisseur.

## Démonstration

La démo GitHub Pages :

- est entièrement locale (`localStorage`), sans appel réseau ;
- utilise un compte MUR fictif et un compte EUR fictif ;
- n'accepte aucune donnée réelle ;
- conserve l'identification « MODE DÉMONSTRATION » dans l'en-tête, avec
  explication et réinitialisation ;
- n'est jamais présentée comme une instance serveur.
