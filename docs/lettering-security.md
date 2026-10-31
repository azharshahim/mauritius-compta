# Sécurité du lettrage

## Isolation

- Toutes les requêtes filtrent `company_id` côté serveur.
- La société est résolue par adhésion (`requireCompany`) ; une société inconnue
  renvoie 404, jamais 403, pour ne pas divulguer son existence.
- `cabinet_id` est recopié depuis la société et vérifié par des triggers :
  - `mc_guard_ledger_lettering_company` refuse un compte d’un autre dossier ;
  - `mc_guard_ledger_lettering_line_company` refuse une ligne d’une autre
    société, d’un autre compte ou d’une écriture non `posted` ;
  - `mc_guard_ledger_lettering_event_company` refuse un événement rattaché à un
    groupe d’un autre dossier.
- Les identifiants de lignes d’une autre société sont rejetés avant insertion ;
  la base refuse aussi l’insertion si le service était contourné.

## Permissions

| Action | Rôle minimal | Contrôle supplémentaire |
|---|---|---|
| Lire comptes, lignes, rapports, suggestions | `viewer` + module comptabilité `read` | — |
| Prévisualiser | `viewer` + comptabilité `read` | Aucune écriture |
| Créer un lettrage | `accountant` + comptabilité `write` | Confirmation `confirm: true` |
| Délettrer | `accountant` + comptabilité `write` | Rôle `admin`/`owner`/`cabinet_admin` + motif + confirmation |
| Exporter CSV | `viewer` + comptabilité `read` | — |

Un cabinet ou un collaborateur sans accès au module comptabilité est refusé par
`requireCompany`, même si son rôle global est élevé.

## Intégrité et concurrence

- Verrou `SELECT … FOR UPDATE` sur les lignes triées avant tout contrôle.
- Contrôle du restant à l’intérieur de la transaction, pas seulement en aperçu.
- Index unique `(company_id, code)` et `(company_id, request_key)`.
- Clé d’idempotence : rejeu renvoyé sans nouvelle écriture ni nouveau groupe.
- Toute erreur annule la transaction entière (rollback), y compris les
  allocations déjà insérées.
- Les allocations sont immuables : aucun `UPDATE` ni `DELETE` n’est autorisé.
- Seule transition admise : `active → reversed`, avec motif non vide.

## Écritures comptables

Le module ne contient aucun `INSERT`, `UPDATE` ou `DELETE` sur
`journal_entries`, `journal_lines`, `billing_payments` ou `purchase_payments`.
Les triggers `mc_guard_posted_entry` et `mc_guard_posted_line` restent la
dernière barrière : même un appel direct SQL ne peut pas modifier une écriture
comptabilisée.

## Délettrage

- Motif obligatoire (validation Zod + `CHECK` SQL).
- Permission spécifique administrateur, distincte du droit d’écriture.
- Refus si une période est clôturée.
- Aucune suppression : l’historique reste consultable.
- Aucune annulation automatique d’un paiement ou d’un rapprochement bancaire.
- Événement d’audit `lettering.reverse` et événement métier `reversed`.

## Données et démonstration

- Aucune donnée bancaire réelle, aucun identifiant de production.
- La démo est entièrement fictive, en `localStorage`, avec bandeau permanent et
  bouton de réinitialisation.
- Aucune clé d’API, aucun fournisseur IA payant, aucun appel réseau en mode
  démonstration.
- Les exports CSV neutralisent les préfixes de formule (`=`, `+`, `-`, `@`).

## Limites

- Les tests de concurrence PostgreSQL réels ne s’exécutent que dans le job CI
  `postgres-tests` ; l’environnement local PGlite les ignore explicitement.
- Aucun test sur Samsung Android physique n’a été réalisé. Le rendu mobile est
  couvert par les tests DOM et les règles CSS, pas par une mesure matérielle.
