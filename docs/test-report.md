# Rapport de tests — Mauritius Compta 0.1.0

_Date : 30 octobre 2026._

## 1. Comment exécuter

```bash
npm install
npm test            # Vitest, API, 54 tests
npm run typecheck   # TypeScript strict (API + front)
npm run build       # compilation API + front
```

Les tests utilisent **PGlite** : le véritable moteur PostgreSQL compilé en WebAssembly,
exécuté en mémoire. Aucun service externe, aucun conteneur, aucune installation de PostgreSQL
n'est nécessaire — les tests sont donc **reproductibles** sur un poste ou en CI.
Les migrations et les triggers PL/pgSQL sont réellement exécutés.

> Un job CI séparé exécute en plus les migrations et le seed contre un **vrai serveur
> PostgreSQL 16** (service container GitHub Actions), pour valider la compatibilité serveur.

## 2. Résultat global

| Suite | Fichier | Tests | Résultat |
|---|---|---|---|
| Arithmétique monétaire et dates | `tests/money.test.ts` | 7 | ✅ |
| Migrations PostgreSQL | `tests/migrations.test.ts` | 6 | ✅ |
| Authentification / autorisation / langue | `tests/auth.test.ts` | 9 | ✅ |
| Sociétés et isolation | `tests/companies.test.ts` | 7 | ✅ |
| Plan comptable | `tests/accounts.test.ts` | 4 | ✅ |
| Écritures, contrôles, multidevise | `tests/entries.test.ts` | 12 | ✅ |
| Grand livre, balance, états financiers | `tests/reports.test.ts` | 11 | ✅ |
| **Total** | | **54** | **✅ 54/54** |

Durée observée : ~13 s sur un environnement de CI standard.

## 3. Couverture des tests prioritaires du cahier des charges

| # | Priorité demandée | Test(s) |
|---|---|---|
| 1 | Création d'une société fictive | `companies > creates a fictitious Mauritius company…` (plan comptable + 5 journaux + période vérifiés) |
| 2 | Isolation entre deux sociétés | `companies > strictly isolates two companies` ; `migrations > prevents cross-company account references` |
| 3 | Création de comptes | `accounts > creates, updates and deactivates a custom account` |
| 4 | Écriture équilibrée | `entries > creates a balanced posted entry` |
| 5 | Rejet d'une écriture déséquilibrée | `entries > rejects an unbalanced posted entry`, `> allows an unbalanced draft but refuses to post it`, `migrations > rejects a posted entry that is not balanced at the database level` |
| 6 | Protection des écritures validées | `entries > protects posted entries from modification and deletion` (API 409 **et** triggers PostgreSQL), `> reverses a posted entry…` |
| 7 | Génération du grand livre | `reports > generates a general ledger with running balances`, `> filters the ledger by account and period` |
| 8 | Génération de la balance | `reports > generates a balanced trial balance…`, `> computes opening balances for a later period` |
| 9 | Contrôle débit/crédit | `reports > …` (égalité des totaux) + `migrations` (trigger) |
| 10 | Changement de langue | `auth > localises API errors in French and English`, `> switches the user locale (FR -> EN)…` |
| 11 | Accès non autorisés | `auth > rejects unauthenticated access…`, `> enforces role based authorisation…`, `> blocks cross-site state changing requests`, `companies > strictly isolates two companies` |
| 12 | Tests de migrations PostgreSQL | `migrations` (application, idempotence, checksums, tables, contraintes) + job CI PostgreSQL |

## 4. Tests complémentaires

- **Multidevise** : taux obligatoire (`EXCHANGE_RATE_REQUIRED`), conversion correcte
  (1 000 EUR × 48,50 = 48 500 MUR), conservation du montant d'origine (`txn_amount`),
  du taux (`fx_rate`) et de la devise.
- **Périodes** : refus d'écriture sur période clôturée, refus hors période ouverte,
  clôture/réouverture (rôle owner).
- **Numérotation** : séquence par société/journal/année, sans doublon.
- **Audit** : présence des actions `company.create`, `entry.create_posted`, `entry.post`,
  `entry.reverse`, `period.close`, `exchange_rate.create`.
- **Exports** : mention « DEMONSTRATION » dans le CSV, en-tête `%PDF-` et taille du PDF.
- **ASI/CSRF** : `Origin` non autorisée ⇒ 403.
- **Monnaie** : `0.1 + 0.2 = 0.3` exact, arrondis half-away-from-zero à 4 décimales,
  taux à 8 décimales.

## 5. Ce qui n'est pas couvert (limites assumées)

| Sujet | Raison | Prévu |
|---|---|---|
| Tests end-to-end navigateur (Playwright) | Hors périmètre V0.1.0 | Mission 2 |
| Tests de charge / performance | Volumes non connus | Mission 2 |
| Tests d'accessibilité (WCAG) | Non instrumentés | Mission 2 |
| Upload de fichier en test | Évité (écriture disque) ; la logique est testée manuellement | Mission 2 |
| Génération de PDF en français | Testé en anglais (encodage WinAnsi) | Mission 2 (police embarquée) |
| PostgreSQL réel | Exécuté en CI (job dédié) | Continu |

## 6. Vérifications manuelles effectuées

1. `npm run db:seed` crée la société fictive et 8 écritures (dont 1 brouillon et 1
   contrepassation).
2. Connexion via `curl` → cookie de session, `/api/companies` renvoie la société.
3. `GET /reports/trial-balance?format=csv` → balance équilibrée, mention de démonstration.
4. `GET /reports/ledger` → soldes progressifs cohérents.
5. Démarrage simultané API (:3000) + interface Vite (:5173), proxy `/api` fonctionnel.
6. Build de production (`npm run build`) sans erreur, TypeScript strict sans erreur.

## 7. Journal des corrections notables pendant la mission

| Problème détecté | Correction |
|---|---|
| `rowCount` incorrect avec PGlite sur les `SELECT` | Comptage basé sur `rows.length` (compatibilité pg + PGlite) |
| Dates PostgreSQL renvoyées comme objets `Date` | Parsers OID 1082/1184 → chaînes `YYYY-MM-DD` |
| Précision des taux limitée à 4 décimales | Parsing des taux à 8 décimales (`parseRate`) |
| Filtre de compte absent dans la requête de mouvements | Filtre appliqué à `journal_lines.account_id`, paramètres séparés |
| Paramètre SQL non typé (`$1 IS NOT NULL`) | Cast explicite `$1::text` |
