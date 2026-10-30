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
| GET | `/health` (hors `/api` en production : `/api/health`) | `{ status: "ok", version: "0.1.0" }` |

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
