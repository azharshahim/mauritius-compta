# API — Mauritius Compta 0.1.0

Base URL : `/api` (le front est servi séparément en développement, ou par l'API en production).

## Conventions

- **Format** : JSON UTF-8. Les montants sont des **chaînes décimales** (`"1234.5000"`) ;
  ne jamais les convertir en flottant côté client pour un calcul comptable.
- **Dates** : `YYYY-MM-DD` (date comptable) ; horodatages ISO en UTC.
- **Authentification** : cookie de session `mc_session` (`HttpOnly`). En développement,
  `POST /api/auth/login` puis conserver le cookie.
- **Langue** : en-tête `x-locale: fr|en` (sinon `Accept-Language`, sinon préférence utilisateur).
- **Erreurs** :

```json
{
  "error": {
    "code": "ENTRY_UNBALANCED",
    "message": "Le total des débits doit être égal au total des crédits.",
    "details": { "debitTotal": "500.0000", "creditTotal": "450.0000", "difference": "50.0000" }
  }
}
```

Codes HTTP : `400` validation métier, `401` non authentifié, `403` rôle insuffisant ou CSRF,
`404` ressource inexistante **ou société d'un autre tenant**, `409` conflit (immuabilité,
période clôturée, doublon), `413` fichier trop volumineux, `429` trop de tentatives,
`500` erreur interne.

## Rôles

| Rôle | Lecture | Écritures / comptes / taux | Paramètres société, membres, périodes | Suppression |
|---|---|---|---|---|
| `viewer` | ✅ | ❌ | ❌ | ❌ |
| `accountant` | ✅ | ✅ | ❌ | comptes/écritures brouillon |
| `admin` | ✅ | ✅ | ✅ | ✅ |
| `owner` | ✅ | ✅ | ✅ (+ réouverture de période) | ✅ |

## Authentification

| Méthode | Route | Corps | Réponse |
|---|---|---|---|
| POST | `/auth/register` | `{ email, password, fullName, locale? }` | `201 { user }` + cookie |
| POST | `/auth/login` | `{ email, password, locale? }` | `200 { user }` + cookie |
| POST | `/auth/logout` | — | `{ ok: true }` |
| GET | `/auth/me` | — | `{ user }` |
| PATCH | `/auth/me` | `{ fullName?, locale?, currentPassword?, newPassword? }` | `{ user }` |
| GET | `/auth/sessions` | — | `{ sessions }` |

Mot de passe : minimum 10 caractères, lettres **et** chiffres (configurable via
`PASSWORD_MIN_LENGTH`).

## Sociétés

| Méthode | Route | Description |
|---|---|---|
| GET | `/companies` | Sociétés de l'utilisateur (+ rôle, nombre de comptes) |
| POST | `/companies` | Création (+ plan comptable de démonstration si `withDefaultChart !== false`) |
| GET | `/companies/:companyId` | Détail + périodes comptables |
| PATCH | `/companies/:companyId` | Mise à jour (admin) |
| GET | `/companies/:companyId/members` | Membres (admin) |
| POST | `/companies/:companyId/members` | Ajout d'un membre `{ email, role, temporaryPassword? }` |
| DELETE | `/companies/:companyId/members/:userId` | Retrait d'un membre |

Champs société : `name`, `brn`, `vatNumber`, `registeredAddress`, `businessActivity`,
`financialYearStart`, `financialYearEnd`, `functionalCurrency`, `presentationCurrency`,
`accountingStandard`, `status`, `locale`, `withDefaultChart`.

Devises acceptées : `MUR`, `EUR`, `USD`, `GBP`. Normes : `IFRS`, `IFRS for SMEs`, `Other`.

## Plan comptable

| Méthode | Route | Description |
|---|---|---|
| GET | `/companies/:id/accounts?includeInactive=&type=&search=` | Liste |
| POST | `/companies/:id/accounts` | Création |
| PATCH | `/companies/:id/accounts/:accountId` | Modification / activation |
| DELETE | `/companies/:id/accounts/:accountId` | Suppression (refusée si utilisée → 409 `ACCOUNT_IN_USE`) |

Types : `asset`, `liability`, `equity`, `revenue`, `expense`.
`fsMapping` : `bs.*` ou `pl.*` (voir `apps/api/src/types.ts`), `unmapped` par défaut.

## Journaux

| Méthode | Route | Description |
|---|---|---|
| GET | `/companies/:id/journals` | Liste |
| POST | `/companies/:id/journals` | Création `{ code, name, type }` |
| PATCH | `/companies/:id/journals/:journalId` | Nom / activation |

Types : `sales`, `purchases`, `bank`, `cash`, `general`.

## Écritures

| Méthode | Route | Description |
|---|---|---|
| GET | `/companies/:id/entries?status=&journalId=&from=&to=&search=&limit=&offset=` | Liste paginée |
| GET | `/companies/:id/entries/:entryId` | Détail (lignes + justificatifs) |
| POST | `/companies/:id/entries` | Création (brouillon ou validée) |
| PATCH | `/companies/:id/entries/:entryId` | Modification **brouillon uniquement** |
| DELETE | `/companies/:id/entries/:entryId` | Suppression **brouillon uniquement** |
| POST | `/companies/:id/entries/:entryId/post` | Validation |
| POST | `/companies/:id/entries/:entryId/reverse` | Contrepassation `{ entryDate?, description? }` |
| POST | `/companies/:id/entries/:entryId/attachments` | Justificatif (multipart `file`) |
| GET | `/companies/:id/attachments/:attachmentId` | Téléchargement authentifié |

### Corps de création

```json
{
  "journalId": "uuid",
  "entryDate": "2025-08-01",
  "reference": "FA-2025-001",
  "description": "Facture de vente fictive",
  "currency": "EUR",
  "exchangeRate": "48.5000",
  "status": "posted",
  "lines": [
    { "accountId": "uuid-client", "debit": "1000.00", "description": "Créance" },
    { "accountId": "uuid-ventes", "credit": "1000.00" }
  ]
}
```

Règles appliquées :

1. `lines.length ≥ 2`, chaque ligne avec **soit** un débit **soit** un crédit > 0.
2. Comptes de la société et **actifs** ; sinon `400`.
3. Devise ≠ devise fonctionnelle ⇒ `exchangeRate` **obligatoire** et positif
   (`EXCHANGE_RATE_REQUIRED`). Aucun taux n'est déduit automatiquement.
4. `status: "posted"` ⇒ `Σ débits = Σ crédits` (`ENTRY_UNBALANCED`), et période ouverte
   (`PERIOD_CLOSED`).
5. Un brouillon peut être déséquilibré, mais ne pourra pas être validé.
6. Numérotation automatique `JRN-AAAA-0001` par société, journal et année.

## Périodes, taux, paramètres, audit

| Méthode | Route | Description |
|---|---|---|
| GET | `/companies/:id/periods` | Périodes |
| POST | `/companies/:id/periods` | Création `{ name, startDate, endDate }` |
| POST | `/companies/:id/periods/:periodId/close` | Clôture (admin) |
| POST | `/companies/:id/periods/:periodId/reopen` | Réouverture (owner) |
| GET | `/companies/:id/exchange-rates?from=&to=&date=` | Taux |
| POST | `/companies/:id/exchange-rates` | `{ fromCurrency, toCurrency, rateDate, rate, source? }` |
| GET | `/companies/:id/settings` | Paramètres clé/valeur |
| PUT | `/companies/:id/settings` | `{ settings: { … } }` |
| GET | `/companies/:id/audit?limit=&offset=` | Journal des opérations (admin) |

## Migration comptable (mission 8)

Toutes les routes sont limitées au dossier `:id` et exigent au moins le rôle
`accountant` (le catalogue `profiles` accepte `viewer`). Aucune écriture
comptable n'est produite avant `POST …/import` avec `confirm: true`.

| Méthode | Route | Description |
|---|---|---|
| GET | `/companies/:id/migration/profiles` | Profils, champs, types d'import, limites (taille, lignes, rétention) |
| POST | `/companies/:id/migration/jobs` | Créer un lot : `{ source, importKind, fileName, contentBase64 | contentText, sheetName?, mapping?, options? }` |
| GET | `/companies/:id/migration/jobs` | Historique des lots du dossier |
| GET | `/companies/:id/migration/jobs/:jobId` | Vue complète : lot, feuilles, preview, findings, lignes groupées |
| PUT | `/companies/:id/migration/jobs/:jobId/mapping` | `{ mapping?, accountMapping?, options?, sheetName? }` puis recalcul |
| POST | `/companies/:id/migration/jobs/:jobId/import` | **Validation humaine** `{ confirm: true, note? }` ; sinon refus |
| POST | `/companies/:id/migration/jobs/:jobId/cancel` | Annuler un lot non importé (204) |
| DELETE | `/companies/:id/migration/jobs/:jobId` | Supprimer le lot et ses contenus (204) |
| GET | `/companies/:id/migration/jobs/:jobId/report.csv` | Rapport CSV échappé (BOM UTF-8, séparateur `;`) |
| GET/POST | `/companies/:id/migration/templates` | Modèles de correspondance du cabinet |
| DELETE | `/companies/:id/migration/templates/:templateId` | Supprimer un modèle (204) |

Réponse d'un lot : `{ job: { id, mapping, status, idempotency_key, report }, sheets,
preview: { mapping, summary: { create, skip, errors, warnings }, blocksImport,
totals, findings, rows: { entries } } }`.

Erreurs stables : `MIGRATION_FILE_TOO_LARGE`, `MIGRATION_TOO_MANY_ROWS`,
`UNSUPPORTED_FORMAT`, `MALFORMED_FILE`, `EMPTY_FILE`, `NO_TABLE`,
`MIGRATION_INVALID_MAPPING`, `MIGRATION_SHEET_NOT_FOUND`, `MIGRATION_BLOCKED`
(contrôles bloquants), `MIGRATION_ALREADY_IMPORTED`, `MIGRATION_JOB_NOT_FOUND`,
`MIGRATION_TEMPLATE_EXISTS`, `MIGRATION_TEMPLATE_NOT_FOUND`.

## Rapports

Toutes les routes de rapport acceptent `from`, `to` (défaut : exercice de la société) et
`format=json|csv|pdf`. `lang=fr|en` localise les PDF.

| Route | Contenu |
|---|---|
| `/companies/:id/reports/ledger?accountId=&search=` | Grand livre : solde initial, lignes, totaux, solde final |
| `/companies/:id/reports/trial-balance` | Balance : initial / mouvements / final, D et C, contrôle d'équilibre |
| `/companies/:id/reports/statements` | Bilan + compte de résultat provisoires |
| `/companies/:id/dashboard` | Indicateurs, dernières écritures, contrôle d'équilibre |

Les exports portent la mention **« DOCUMENT DE DÉMONSTRATION »**. Les CSV sont encodés en
UTF-8 avec BOM et séparateur `;` (ouverture directe dans Excel FR/EN).

## Santé

| Méthode | Route | Réponse |
|---|---|---|
| GET | `/health` (hors `/api` en production : `/api/health`) | `{ status: "ok", version: "0.1.1" }` |

## Règles métier ajoutées en V0.1.1

| Règle | Comportement API |
|---|---|
| Devises autorisées | `MUR`, `EUR`, `USD`, `GBP` uniquement → `400 INVALID_CURRENCY` |
| Précision des montants | 4 décimales maximum ; au-delà → `400 VALIDATION_ERROR` (aucun arrondi silencieux) |
| Conversion à zéro | un montant étranger qui s'arrondit à `0.0000` en devise fonctionnelle → `400 VALIDATION_ERROR` |
| Changement de devise d'un brouillon | exige un `exchangeRate` explicite si la devise cible est étrangère → sinon `400 EXCHANGE_RATE_REQUIRED` |
| Référence | unique par société (insensible à la casse) pour les écritures manuelles → `409 REFERENCE_TAKEN` |
| Numérotation | recalculée si un brouillon change de journal ou d'exercice |
| Validation d'un brouillon | les comptes sont revérifiés (société + activation) → `400 VALIDATION_ERROR` |
| Contrepassation | une seule par écriture → `409 ENTRY_ALREADY_REVERSED` (garanti aussi par un index unique) |
| Pièces jointes | signature binaire contrôlée → `400 ATTACHMENT_TYPE_NOT_ALLOWED` ; fichier vide refusé |
| Taux de change invalide | `400 VALIDATION_ERROR` (auparavant 409) ; taux inverse calculé en arithmétique entière |
| Changement de mot de passe | `{ user, sessionsInvalidated: true }` : toutes les sessions sont supprimées |
| Journal d'audit | append-only : toute modification directe en base échoue |
| Inscription | fermée par défaut lorsque `NODE_ENV=production` (`403 REGISTRATION_DISABLED`) |
| Connexion | limitation par compte **et** par adresse IP (`429 LAST_LOGIN_TOO_MANY`) |

### Codes d'erreur ajoutés

| Code | HTTP | Sens |
|---|---|---|
| `REFERENCE_TAKEN` | 409 | référence déjà utilisée dans la société |
| `INVALID_CURRENCY` | 400 | devise hors liste blanche |
| `ATTACHMENT_TYPE_NOT_ALLOWED` | 400 | type MIME ou signature binaire non autorisé |
| `ENTRY_ALREADY_REVERSED` | 409 | écriture déjà contrepassée |
| `PERIOD_CLOSED` | 409 | aucune période ouverte pour la date demandée |
| `REGISTRATION_DISABLED` | 403 | inscription fermée sur cette instance |

## Exemple complet (curl)

```bash
# 1. Connexion
curl -c cookies.txt -X POST http://localhost:3000/api/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"demo@mauritius-compta.test","password":"DemoPassw0rd2026"}'

# 2. Sociétés
curl -b cookies.txt http://localhost:3000/api/companies

# 3. Balance au format CSV
curl -b cookies.txt "http://localhost:3000/api/companies/<id>/reports/trial-balance?format=csv" -o balance.csv

# 4. Balance au format PDF
curl -b cookies.txt "http://localhost:3000/api/companies/<id>/reports/trial-balance?format=pdf&lang=en" -o balance.pdf
```
