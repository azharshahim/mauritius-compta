# Architecture technique — Mauritius Compta 0.1.0

## 1. Vue d'ensemble

```text
┌───────────────────────────────────────────────────────────────────────┐
│ Navigateur Android / Windows                                         │
│ React 19 + Vite (SPA bilingue FR/EN, responsive)                     │
└───────────────────────────────┬───────────────────────────────────────┘
                                │ HTTPS (cookies HttpOnly, SameSite=Lax)
┌───────────────────────────────▼───────────────────────────────────────┐
│ Fastify 5 (TypeScript, Node 20+)                                      │
│  • /api/auth (sessions, rôles)                                        │
│  • /api/companies (multi-société, membres, périodes, taux)            │
│  • /api/companies/:id/accounts | journals | entries | reports …        │
│  • validation Zod, erreurs typées et localisées FR/EN                  │
│  • audit_log sur toutes les opérations sensibles                       │
│  • exports CSV + PDF (PDFKit) marqués « démonstration »                │
└───────────────────────────────┬───────────────────────────────────────┘
                                │ SQL paramétré (pg / PGlite)
┌───────────────────────────────▼───────────────────────────────────────┐
│ PostgreSQL 14+                                                        │
│  • migrations versionnées (checksums)                                 │
│  • contraintes + triggers (équilibre, immutabilité, isolation)         │
│  • numeric(20,4) pour tous les montants                                │
└───────────────────────────────────────────────────────────────────────┘
```

### Choix techniques et justification

| Choix | Justification |
|---|---|
| **TypeScript** partout | Sécurité de typage, contrats d'API explicites, maintenance. |
| **Fastify** | Léger, rapide, validation/erreurs maîtrisées, injection de requêtes pour les tests. |
| **React + Vite** | Interface moderne, build simple, très bon support mobile, pas de SSR nécessaire. |
| **PostgreSQL** | Transactions, contraintes, `numeric` exact, triggers — indispensables en comptabilité. |
| **PGlite pour les tests/démo** | **Vrai moteur PostgreSQL** compilé en WASM : les tests de migrations et de SQL sont réels, sans service externe. En production, `pg` se connecte à un serveur PostgreSQL. |
| **Sessions cookie plutôt que JWT** | Révocation immédiate, pas de jeton en `localStorage` (XSS), `HttpOnly` + `SameSite`. |
| **scrypt (Node natif)** | Aucune dépendance native, paramètres conformes aux recommandations OWASP. |
| **BigInt décimal (échelle 4)** | Zéro erreur d'arrondi flottant sur les montants. |
| **PDFKit serveur** | Pas de Chromium/headless lourd ; sortie déterministe. |

### Non-choix volontaires

- Pas de microservices, pas de message broker, pas de Kubernetes : complexité inutile pour une
  V0.1 mono-tenant logique et multi-société.
- Pas d'ORM : SQL explicite, paramétré, auditable, portable (`pg` et PGlite).
- Pas de service cloud pour les PDF ou l'OCR : aucune donnée comptable ne sort du serveur.

## 2. Structure du dépôt

```text
mauritius-compta/
├── apps/
│   ├── api/                    # Fastify + PostgreSQL
│   │   ├── sql/migrations/     # 0001_core.sql, 0002_controls.sql
│   │   ├── src/
│   │   │   ├── app.ts          # assemblage Fastify, sécurité, erreurs
│   │   │   ├── config.ts       # configuration typée (env)
│   │   │   ├── db/             # abstraction pg / pglite + runner de migrations
│   │   │   ├── lib/            # money, dates, password, audit, tenant, http
│   │   │   ├── i18n/           # messages serveur FR/EN
│   │   │   ├── modules/        # auth, companies, accounts, journals, entries,
│   │   │   │                   # settings, reports (+ pdf), attachments
│   │   │   └── seed/           # plan de démonstration + données fictives
│   │   └── tests/              # Vitest (54 tests)
│   └── web/                    # React + Vite
│       ├── src/pages/          # Dashboard, Companies, Accounts, Entries, Ledger,
│       │                       # TrialBalance, Statements, Settings, Login
│       ├── src/components/     # UI réutilisable
│       ├── src/i18n.tsx        # dictionnaires FR/EN
│       └── src/styles.css      # design responsive (mobile-first)
├── docs/
│   ├── mauritius-regulations/  # veille réglementaire (7 documents)
│   ├── architecture.md         # ce document
│   ├── api.md                  # référence de l'API
│   ├── audit-existing-apps.md
│   ├── deployment.md           # préparation VPS Ubuntu + Nginx (non déployé)
│   ├── roadmap.md
│   └── test-report.md
├── .github/workflows/ci.yml
├── docker-compose.yml          # PostgreSQL local
└── .env.example
```

## 3. Modèle de données (résumé)

| Table | Rôle | Clés / contraintes notables |
|---|---|---|
| `app_users` | Comptes utilisateurs | e-mail unique (insensible à la casse), `password_hash` scrypt |
| `sessions` | Sessions serveur | `token_hash` SHA-256 unique, expiration |
| `companies` | Sociétés mauriciennes | BRN unique si renseigné, exercice cohérent, devises |
| `company_members` | Rôles par société | `owner > admin > accountant > viewer` |
| `accounts` | Plan de comptes | unicité `(company, code)`, type, mapping états financiers |
| `journals` | Journaux | types `sales/purchases/bank/cash/general` |
| `accounting_periods` | Périodes | `open` / `closed`, pas de chevauchement applicatif |
| `journal_entries` | Écritures | `draft` / `posted`, numérotation `JRN-AAAA-0001` |
| `journal_lines` | Lignes | débit XOR crédit, devise d'origine + contre-valeur fonctionnelle |
| `entry_sequences` | Compteurs | séquence atomique par société/journal/année |
| `exchange_rates` | Taux datés | unique `(company, from, to, date)`, jamais générés |
| `attachments` | Justificatifs | MIME contrôlé, SHA-256, stockage hors base |
| `audit_log` | Journal d'audit | immuable, horodaté, lié à société/utilisateur |
| `login_attempts` | Anti-bruteforce | fenêtre glissante par e-mail |

### Contrôles au niveau base (defence in depth)

| Trigger | Effet |
|---|---|
| `journal_lines_balance_trg` (différé, au COMMIT) | refuse une écriture validée non équilibrée |
| `journal_entries_balance_trg` (différé) | idem lors du passage `draft → posted` |
| `journal_entries_immutable_trg` | interdit UPDATE/DELETE d'une écriture `posted` |
| `journal_lines_immutable_trg` | interdit toute modification des lignes d'une écriture `posted` |
| `accounts_delete_guard_trg` | interdit la suppression d'un compte utilisé |
| `journal_lines_company_trg` | interdit une ligne pointant vers le compte d'une autre société |

## 4. Flux d'une écriture

```text
POST /api/companies/:id/entries
  → requireCompany(accountant)            # appartenance + rôle
  → validation Zod                        # dates, montants, nombre de lignes
  → chargement des comptes (même société) # isolation
  → prepareEntry()                        # conversion devise, arrondis, équilibre
  → si status = posted : assertOpenPeriod # période clôturée ?
  → ALLOCATION DU NUMÉRO (upsert atomique)
  → INSERT journal_entries + journal_lines (transaction)
  → COMMIT : les triggers vérifient l'équilibre
  → audit_log 'entry.create_posted'
```

Correction d'une écriture validée :

```text
POST /api/companies/:id/entries/:id/reverse
  → vérifie que l'écriture est validée et non déjà contrepassée
  → crée une NOUVELLE écriture (source = reversal, reversal_of_entry_id = origine)
  → lignes débit/crédit inversées, décimales identiques
  → l'écriture d'origine n'est jamais modifiée
```

## 5. Sécurité

| Mesure | Détail |
|---|---|
| Authentification | Cookie `mc_session` HttpOnly, SameSite=Lax, Secure en prod ; jeton 256 bits ; hachage SHA-256 côté base |
| Mots de passe | scrypt (N=16384, r=8, p=1), sel aléatoire, comparaison `timingSafeEqual` |
| Autorisation | Rôles vérifiés côté serveur sur **chaque** route protégée, jamais uniquement dans l'UI |
| Isolation | `company_id` sur toutes les tables métier ; 404 (et non 403) pour les sociétés d'autrui |
| Injections SQL | 100 % requêtes paramétrées ; aucun identifiant construit depuis l'entrée utilisateur |
| CSRF | Cookie `SameSite=Lax` + contrôle d'`Origin`/`Sec-Fetch-Site` sur les méthodes mutantes |
| XSS | Aucun `dangerouslySetInnerHTML`, CSP restrictive, `X-Content-Type-Options: nosniff` |
| En-têtes | CSP, `X-Frame-Options: DENY`, `Referrer-Policy: same-origin` |
| Bruteforce | `login_attempts` + verrouillage temporaire configurable |
| Justificatifs | MIME autorisés (PDF/JPEG/PNG), taille plafonnée, nom aléatoire, `nosniff` |
| Secrets | Uniquement en variables d'environnement ; `.env` ignoré par Git ; `.env.example` sans secret |
| Journalisation | `audit_log` + logs applicatifs avec masquage de `cookie`/`authorization` |
| Erreurs | Aucune trace SQL ni stack technique renvoyée au client |

## 6. Multidevise

- Devises supportées : **MUR, EUR, USD, GBP**.
- Une écriture porte une devise et un **taux daté saisi par l'utilisateur** (aucun taux généré).
- Chaque ligne conserve : montant d'origine (`txn_amount`, `txn_currency`), taux (`fx_rate`) et
  **contre-valeur en devise fonctionnelle** (`debit`/`credit`) arrondie à 4 décimales.
- Les taux sont enregistrés dans `exchange_rates` (date, paire, source, auteur).
- **Aucun traitement automatique** des écarts de change (voir registre AC-07).

## 7. Internationalisation

- UI : dictionnaires FR/EN complets (`apps/web/src/i18n.tsx`), préférence persistée en
  `localStorage` **et** en base (`app_users.locale`).
- API : erreurs typées (`code`) + message localisé selon `x-locale` / `Accept-Language` /
  préférence utilisateur. Le client peut retraduire via le code.
- PDF : libellés FR/EN, `?lang=en|fr`.
- Données : chaque société a une langue de création du plan comptable de démonstration.

## 7 bis. Durcissement V0.1.1

Trois couches de défense, du plus tôt au plus tard :

1. **Validation applicative (Zod + métier)** dans les routes : devises autorisées, 4 décimales,
   taux obligatoire lors d'un changement de devise, références uniques, comptes actifs à la
   validation, réponses d'erreur typées.
2. **Transactions** : chaque opération métier s'exécute dans `db.transaction` ; l'équilibre
   débit/crédit est contrôlé par des triggers **différés** (l'insertion ligne à ligne reste
   possible).
3. **Base de données** (`0003_hardening.sql`) : index unique de contrepassation, index unique de
   référence, triggers de cohérence société (journal, contrepassation, pièce jointe, compte
   parent), journal d'audit append-only, index de reporting.

Chaîne monétaire : saisie `string` → `parseAmount` (BigInt ×10⁴) → conversion par
`multiply(amount, rate)` (taux ×10⁸, arrondi demi-supérieur une seule fois) → stockage
`numeric(20,4)` → API en chaîne à 4 décimales → affichage en BigInt côté React. **Aucun flottant
n'intervient** dans un calcul monétaire.

Nouvelles variables d'environnement : `LOGIN_MAX_ATTEMPTS_PER_IP`, `SESSION_PURGE_ON_LOGIN`,
`ALLOW_DEMO_SEED` (démonstration uniquement). En production, `ALLOW_REGISTRATION` vaut `false`
par défaut et `db:seed` refuse de s'exécuter.

## 8. Performances et limites connues (V0.1.1)

- Pagination des écritures (max 200) ; grand livre limité par période (pas de pagination par
  compte).
- Pas de cache : chaque écran interroge l'API.
- Pas de traitement asynchrone : les PDF sont générés en mémoire (volumes faibles).
- Tests sur PGlite : les performances ne préjugent pas de celles de PostgreSQL en production.

## 9. Évolutions prévues (voir `roadmap.md`)

Facturation, TVA, paie, déclarations MRA, consolidation multi-société, OCR, rôles avancés,
MFA, journal d'audit inaltérable, exports XLSX, API documentée OpenAPI.
