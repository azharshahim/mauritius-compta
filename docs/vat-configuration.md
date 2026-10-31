# Configuration de la TVA (mission 7)

> **Aucun taux n'est prérempli par le logiciel.** Aucune valeur de cet écran n'est
> une affirmation sur la législation mauricienne. Les règles fiscales restent à
> faire vérifier par un professionnel (voir `docs/regulatory-review-register.md`).

## 1. Quatre traitements distincts, jamais assimilés

| Traitement | Code | Pourcentage | Remarque |
| --- | --- | --- | --- |
| Taxable | `taxable` | requis (> 0 possible) | calcul de TVA uniquement si le taux est **vérifié** |
| Taux zéro | `zero_rated` | **0** obligatoire | qualification légale à confirmer par le cabinet |
| Exonéré | `exempt` | **0** obligatoire | qualification légale à confirmer |
| Hors champ | `out_of_scope` | **0** obligatoire | qualification légale à confirmer |

Une contrainte SQL (`billing_tax_rates_treatment_chk`,
`billing_tax_rates_treatment_rate_chk`) et une validation applicative refusent un
pourcentage sur un traitement non taxable : `zero_rated`, `exempt` et
`out_of_scope` ne sont jamais convertis en « 0 % taxable ».

## 2. Champs d'un taux

- code, libellé, pourcentage, date de début, date de fin (optionnelle) ;
- **traitement fiscal** ;
- **compte de TVA** (doit appartenir au plan comptable) ;
- statut de vérification, source documentaire, date de vérification, identité du
  validateur ;
- notes.

## 3. Vérification humaine

`POST /companies/:id/billing/tax-rates/:rateId/verify`

```json
{ "source": "Document officiel — référence et date", "confirm": true }
```

- exige le rôle **admin** sur le module Facturation ;
- exige `confirm: true` et une source d'au moins 5 caractères
  (`VAT_SOURCE_REQUIRED`) ;
- enregistre `verified_at` et `verified_by` (utilisateur réel), plus un événement
  `verified` dans `billing_tax_rate_events` ;
- l'IA **ne peut pas** appeler cette route : elle n'existe dans aucun outil de
  l'assistant ;
- retrait : `POST …/unverify`, également journalisé.

## 4. Historique

Chaque création, modification, vérification et retrait de vérification écrit une
ligne dans `billing_tax_rate_events` :

| Champ | Contenu |
| --- | --- |
| `action` | `created`, `updated`, `verified`, `unverified` |
| `actor_id` | utilisateur auteur |
| `before_state` / `after_state` | code, libellé, taux, traitement, période, vérification, source, compte |
| `created_at` | horodatage |

Lecture : `GET /companies/:id/billing/tax-rates/:rateId/history` et section
« Historique » de l'écran Paramètres société → Fiscalité.

## 5. Effet sur la facturation

- Une ligne `standard` exige un taux **explicitement choisi** et **vérifié** ;
  sinon la facture est refusée (`VAT_NOT_CONFIGURED`,
  `VAT_RATE_NOT_VERIFIED`, `VAT_RATE_NOT_APPLICABLE`).
- Dès qu'un document **émis** (statut ≠ brouillon) utilise un taux, son
  pourcentage, son traitement et sa période sont **gelés**
  (`409 VAT_RATE_LOCKED`) : aucun document émis n'est réécrit rétroactivement. Les
  notes et la vérification restent modifiables et journalisées.
- Les documents déjà émis conservent le taux appliqué au moment de l'émission.

## 6. Démonstration GitHub Pages

- Un taux **15 % fictif** (`DEMO-15`) est présent dans la base de démonstration
  au statut **non vérifié**, avec la source « Paramètre de démonstration fictif —
  aucune valeur légale ».
- Il illustre la configuration et l'exemple d'écriture, **jamais** une règle
  fiscale mauricienne.
- Une facture fiscale réelle (backend) ne peut pas être émise avec ce taux tant
  qu'un humain ne l'a pas vérifié.

## 7. Exemple obligatoire (données fictives)

Achat de marchandises **3 250,00 MUR HT**, TVA de démonstration **15 %** :

| Compte | Libellé | Débit | Crédit |
| --- | --- | --- | --- |
| Achats de marchandises | plan comptable réel | 3 250,00 | |
| TVA récupérable | plan comptable réel | 487,50 | |
| Banque | plan comptable réel | | 3 737,50 |

- TVA = 3 250,00 × 15 % = **487,50** ; TTC = **3 737,50**.
- Les comptes proviennent du plan comptable du dossier (aucun code inventé).
- Si le compte de TVA ou de banque manque, l'assistant **signale le manque** et
  demande un choix humain ; aucune écriture n'est créée.
- La démonstration prépare une **proposition** (statut `proposed`) ; aucune
  comptabilisation n'a lieu sans validation puis comptabilisation explicites.
- Le taux utilisé est affiché comme **non vérifié** et sans valeur fiscale.
