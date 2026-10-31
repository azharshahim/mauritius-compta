# Matrice des permissions — Mauritius Business Suite

> Source de vérité : `apps/api/src/lib/permissions.ts` (défauts par rôle) et la table
> `company_module_access` (dérogations). Le mode démonstration applique **les mêmes règles**
> dans `apps/web/src/demo/runtime.ts`.

## 1. Rôles

| Rôle | Usage prévu |
|---|---|
| `owner` | créateur historique du dossier (V0.1) — droits complets |
| `admin` | administrateur historique du dossier (V0.1) — droits complets |
| `cabinet_admin` | administrateur cabinet : tous les modules, gestion des collaborateurs |
| `manager` | responsable de dossier : pilotage cabinet + comptabilité + facturation |
| `accountant` | collaborateur comptabilité |
| `billing_clerk` | collaborateur facturation |
| `payroll_manager` | gestionnaire paie (aucun droit d'écriture comptable) |
| `viewer` | lecteur |

## 2. Droits par module (défauts)

`admin` > `write` > `read` > `none`

| Rôle | Cabinet | Comptabilité | Facturation | Paie |
|---|---|---|---|---|
| owner / admin / cabinet_admin | admin | admin | admin | admin |
| manager | write | write | write | **none** |
| accountant | read | write | read | **none** |
| billing_clerk | read | read | write | **none** |
| payroll_manager | read | **read** | read | write |
| viewer | read | read | read | **none** |

Règles structurantes :

1. **Séparation paie / comptabilité** : aucun rôle comptable n'accède à la paie ; le
   gestionnaire paie n'a que la *lecture* en comptabilité (il ne peut pas créer d'écriture).
2. **Dérogations explicites** : `company_module_access` (table) permet d'ajouter `read`,
   `write` ou `admin` sur un module précis pour un membre précis. Une dérogation **élargit**
   les droits, elle ne les restreint pas ; un droit ajouté sur un module n'affecte aucun autre
   module.
3. **Non-membre** : réponse `404 COMPANY_NOT_FOUND`, jamais `403` (pas de fuite d'existence).
4. **Membre sans droit module** : `403 MODULE_FORBIDDEN`.
5. **Dossier archivé** : toute opération d'écriture (`write`/`admin`) répond
   `409 COMPANY_ARCHIVED` ; la lecture reste possible.

## 3. Application côté API

| Contrôle | Implémentation |
|---|---|
| Membre + rôle minimal | `requireCompany()` (`apps/api/src/lib/tenant.ts`) |
| Permission de module | `requireModuleAccess()` (`apps/api/src/lib/permissions.ts`) |
| Isolation en base | triggers `mc_guard_entry_company`, `mc_guard_attachment_company`, `mc_guard_module_access`, `mc_guard_task_member`, `mc_guard_task_comment_company` |
| Archivage lecture seule | contrôle dans `requireCompany()` (rôle ≥ `accountant`) et dans les routes cabinet |
| Journal d'audit | `writeAudit()` (table `audit_log` append-only) |

Toutes les routes comptables existantes passent désormais par `requireCompany()`, qui vérifie
**en plus** l'accès au module `accounting` : le durcissement est global et rétroactif.

## 4. Points de contrôle par endpoint (extraits)

| Endpoint | Module | Droit |
|---|---|---|
| `GET /api/cabinet/dashboard` | cabinet | agrégation limitée aux dossiers visibles |
| `GET /api/cabinet/companies` | cabinet | `read` |
| `GET /api/cabinet/companies/:id` | cabinet | `read` |
| `PATCH /api/cabinet/companies/:id` | cabinet | `admin` |
| `POST /api/cabinet/companies/:id/archive` | cabinet | `admin` |
| `PATCH /api/cabinet/companies/:id/members/:userId` | cabinet | `admin` (rôle + dérogations modules) |
| `GET /api/companies/:id/tasks` | cabinet | `read` |
| `POST /api/companies/:id/tasks` | cabinet | `write` |
| `PATCH /api/companies/:id/tasks/:taskId` | cabinet | `write` |
| `DELETE /api/companies/:id/tasks/:taskId` | cabinet | `write` + (admin ou créateur) |
| `GET /api/companies/:id/billing/*` | billing | `read` |
| `POST /api/companies/:id/billing/documents` | billing | `write` → **501 NOT_IMPLEMENTED** |
| `GET /api/companies/:id/payroll/*` | payroll | `read` |
| `POST /api/companies/:id/payroll/*` | payroll | `write` → **501 NOT_IMPLEMENTED** |
| `GET /api/companies/:id/accounts` (et toutes les routes comptables) | accounting | `read`/`write`/`admin` selon la route |
| `GET /api/companies/:id/migration/profiles` | cabinet | `viewer` |
| `GET/POST/PUT/DELETE /api/companies/:id/migration/*` (lots, modèles, import, rapport) | cabinet | `accountant` (société revérifiée, lot d'une autre société → 404) |
| `GET /api/companies/:id/bank/*` (comptes, imports, transactions, règles, rapport) | accounting | `viewer` |
| `POST /api/companies/:id/bank/*` (compte, prévisualisation, import, match, proposition, règle, exclusion) | accounting | `accountant` ; `confirm: true` obligatoire pour un match ou une acceptation ; société revérifiée → 404 |

## 5. Vérifications automatisées

| Test | Fichier | Ce qui est prouvé |
|---|---|---|
| Comptable → paie refusée | `apps/api/tests/cabinet.test.ts` | `403 MODULE_FORBIDDEN` |
| Banque d'une autre société | `apps/api/tests/bank.test.ts` | `404 BANK_ACCOUNT_NOT_FOUND`, isolation sociétés/cabinets |
| Confirmation absente | `apps/api/tests/bank.test.ts` | `400 BANK_CONFIRMATION_REQUIRED`, aucune écriture |
| Paie → écriture comptable refusée | idem | `403` sur `POST /accounts` |
| Dérogation ciblée | idem | `payroll: read` ajouté sans toucher `accounting: write` |
| Non-membre | idem | `404 COMPANY_NOT_FOUND` sur tâche et dossier |
| Archivage | idem | `409 COMPANY_ARCHIVED` + lecture toujours possible |
| Parité démonstration | `apps/web/tests/demo-engine.test.ts` | mêmes règles sans serveur |

## 6. Limites connues

- Il n'existe pas encore d'interface de **révocation** d'une dérogation dans l'UI (l'API le
  permet avec `modules: { payroll: 'none' }`) ; l'écran Collaborateurs permet de changer le
  rôle, pas la dérogation.
- Le rôle `owner` ne peut pas être attribué depuis l'API membres (transfert de propriété non
  implémenté) : la valeur est conservée pour compatibilité V0.1.
- Pas de MFA, pas de politique de mot de passe par cabinet, pas de SSO.


## Intelligence artificielle (mission 5)

| Opération | Rôle minimal | Contrôle |
|---|---|---|
| Lire/modifier les réglages IA, gérer les clés, tester une connexion, consulter la consommation | `cabinet_admin` (ou `owner`/`admin`) | `requireCabinetAdmin` → `403 AI_FORBIDDEN` ; cabinet étranger → `404 CABINET_NOT_FOUND` |
| Demander une suggestion de compte | `accounting` en écriture sur la société | `requireModuleAccess(..., 'accounting', 'write')` |
| Lire l'historique des suggestions et les règles | `accounting` en lecture | idem, `read` |
| Accepter / corriger / refuser une suggestion, créer ou supprimer une règle | `accounting` en écriture | idem, `write` |
| Fonctionnalités annoncées (OCR, banque, paie, facturation) | — | `501 NOT_IMPLEMENTED` après contrôle du module |

Un comptable peut donc utiliser l'assistant sur ses dossiers sans jamais pouvoir lire ou
modifier une clé API, ni changer le fournisseur, le budget ou les plafonds. Un gestionnaire
paie n'a aucun accès IA sur la paie : les fonctionnalités de paie sont désactivées par défaut
et non implémentées.

## Mission 12 — lettrage

| Action | `viewer` | `accountant` | `admin` / `owner` / `cabinet_admin` |
|---|---|---|---|
| Lire comptes, lignes, suggestions, rapports, exports | Oui (module comptabilité `read`) | Oui | Oui |
| Prévisualiser un lettrage | Oui (aucune écriture) | Oui | Oui |
| Créer un lettrage | Non | Oui (comptabilité `write`) | Oui |
| Délettrer | Non | Non | Oui (permission spécifique + motif) |

Le rôle global ne suffit pas : l’accès au module comptabilité est vérifié à
chaque requête. Un `accountant` peut lettrer mais pas délettrer seul.
