# Intégrité du projet GitHub — reconstruction complète

Document de référence : **que contient exactement le dépôt**, comment un développeur qui ne
dispose que de ce dépôt peut installer, migrer, tester, compiler et démarrer l'application, et
**ce qui n'y est volontairement pas**.

- Dépôt : `azharshahim/mauritius-compta`
- Branche auditée (mission 2) : `arena/b0b62798-mauritius-compta`
- Version applicative : **0.1.1**
- Dernière vérification de reconstruction : voir §7 (résultats réels, pas théoriques).

---

## 1. Inventaire du dépôt

### 1.1 Backend (`apps/api`)

| Élément | Emplacement |
|---|---|
| Point d'entrée HTTP | `src/index.ts`, `src/app.ts` |
| Configuration typée (Zod) | `src/config.ts` |
| Accès base + migrations | `src/db/index.ts`, `src/db/migrate-cli.ts` |
| Schéma PostgreSQL | `sql/migrations/0001_core.sql`, `0002_controls.sql`, `0003_hardening.sql` |
| Modules métier | `src/modules/{auth,companies,accounts,journals,entries,reports,settings,attachments}` |
| Bibliothèques | `src/lib/{money,errors,http,dates,audit,tenant,provisioning,password}.ts` |
| Internationalisation serveur | `src/i18n/index.ts` |
| Données fictives | `src/seed/{chart-of-accounts,demo,cli}.ts` |
| Tests | `tests/*.test.ts` (9 fichiers) + `tests/helpers.ts` |
| Configuration TypeScript / Vitest | `tsconfig.json`, `tsconfig.test.json`, `vitest.config.ts` |

### 1.2 Frontend (`apps/web`)

| Élément | Emplacement |
|---|---|
| Entrée Vite + HTML | `index.html`, `vite.config.ts`, `src/main.tsx` |
| Routage et coquille applicative | `src/App.tsx` |
| Pages | `src/pages/{Login,Dashboard,Companies,Accounts,Entries,Ledger,TrialBalance,Statements,Settings}.tsx` |
| Composants | `src/components/ui.tsx` |
| Traductions FR/EN | `src/i18n.tsx` |
| Client API, formatage monétaire exact | `src/api.ts`, `src/format.ts` |
| État de session | `src/store.tsx`, `src/hooks.ts` |
| Styles responsives | `src/styles.css` |
| Tests navigateur (Playwright) | `playwright.config.ts`, `e2e/*.spec.ts` |

### 1.3 Racine, CI et documentation

| Élément | Rôle |
|---|---|
| `package.json`, `package-lock.json` | workspaces npm + dépendances verrouillées |
| `tsconfig.base.json` | règles TypeScript communes (strict) |
| `.env.example` | toutes les variables, **aucun secret** |
| `.gitignore` | exclut `node_modules`, `.env`, `.data`, `storage`, `dist` |
| `.nvmrc`, `.editorconfig` | version Node et conventions de format |
| `docker-compose.yml` | PostgreSQL 16 local |
| `config/company-validation.example.json` | validation optionnelle des sociétés |
| `.github/workflows/ci.yml` | 3 tâches : qualité, tests PostgreSQL, migrations PostgreSQL |
| `docs/` | architecture, API, audit, exploitation, tests, navigateur, réglementation |
| `README.md` | installation Windows/Linux, PostgreSQL, démo, tests, dépannage |

### 1.4 Scripts npm

```text
npm run dev            API (:3000) + interface (:5173)
npm run dev:api        API seule
npm run dev:web        interface seule
npm run build          build interface puis API
npm start              API de production (sert aussi l'interface compilée)
npm run typecheck      TypeScript strict (API + interface)
npm test               77 tests Vitest (dont 4 réservés à PostgreSQL réel)
npm run verify         typecheck + tests + build
npm run db:migrate     migrations avec vérification de checksum
npm run db:seed        données de démonstration fictives
npm run test:e2e       tests navigateur Chromium (installation du navigateur requise)
```

---

## 2. Ce que le dépôt ne contient pas (volontairement)

| Exclu | Raison |
|---|---|
| `.env` | secrets et configuration locale |
| `node_modules/` | reconstruit par `npm ci` |
| `apps/api/.data/` (PGlite) | base locale générée par `db:seed` |
| `storage/` | justificatifs réels éventuels |
| `dist/`, `coverage/`, rapports Playwright | artefacts de build |
| mots de passe, clés, jetons | interdits par la CI |
| données clients, sauvegardes | interdits (données fictives uniquement) |

Contrôles automatiques : la tâche CI `quality` échoue si un fichier `.env` ou une extension de
clé privée (`*.pem`, `*.key`, `*.p12`) est suivi par Git.

---

## 3. Prérequis de reconstruction

- Node.js 20+ (22 recommandé), npm 9+
- Git
- PostgreSQL 14+ **ou** Docker (facultatif : PGlite fonctionne sans serveur)

## 4. Reconstruction pas à pas

```bash
git clone https://github.com/azharshahim/mauritius-compta.git reconstruction
cd reconstruction
git switch arena/b0b62798-mauritius-compta

npm ci                     # installation reproductible depuis package-lock.json
npm run db:migrate         # schéma PostgreSQL / PGlite
npm run db:seed            # société et écritures fictives
npm run typecheck          # TypeScript strict
npm test                   # suite Vitest
npm run build              # build de production
npm run dev                # http://localhost:5173
```

Avec un serveur PostgreSQL :

```bash
docker compose up -d db
export DATABASE_URL=postgresql://mc_user:change_me_in_env@localhost:5432/mauritius_compta
npm run db:migrate
npm run db:seed
npm test                   # la même suite tourne sur PostgreSQL + tests de concurrence
```

## 5. Ce qu'un développeur doit pouvoir faire sans rien d'autre

| Action | Vérifiée |
|---|---|
| Installer les dépendances | `npm ci` |
| Créer le schéma | `npm run db:migrate` (rejouable : checksums) |
| Charger des données fictives | `npm run db:seed` |
| Démarrer l'application | `npm run dev` |
| Compiler pour la production | `npm run build` puis `npm start` |
| Comprendre le modèle | `docs/api.md`, `docs/architecture.md`, `sql/migrations/*.sql` |
| Comprendre les limites légales | `docs/mauritius-regulations/` |

## 6. Garanties de reproductibilité

- **Dépendances verrouillées** : `package-lock.json` commité ; `npm ci` refuse toute dérive.
- **Migrations immuables** : le checksum SHA-256 de chaque fichier appliqué est stocké dans
  `schema_migrations` ; modifier un fichier déjà appliqué provoque une erreur explicite.
- **Configuration documentée** : chaque variable de `src/config.ts` figure dans `.env.example`.
- **Aucun chemin absolu** en dur : `PGLITE_DIR` et `STORAGE_DIR` sont relatifs et configurables.
- **CI reproductible** : Node 22, `npm ci`, PostgreSQL 16 en service.

## 7. Vérification effective (preuves)

La reconstruction a été exécutée dans un répertoire vierge à partir du dépôt GitHub :

```text
git clone https://github.com/azharshahim/mauritius-compta.git /tmp/reconstruct
cd /tmp/reconstruct && git switch arena/b0b62798-mauritius-compta
npm ci
npm run db:migrate
npm run db:seed
npm run typecheck && npm test && npm run build
```

Résultats réels (30 octobre 2026, commit `93a7b90`) :

| Étape | Attendu | Constaté |
|---|---|---|
| `git clone --branch arena/b0b62798-mauritius-compta` | dépôt complet | ✅ 100 fichiers suivis, aucun `.env`, aucun `node_modules` |
| `npm ci` | installation reproductible | ✅ |
| `npm run db:migrate` | 3 migrations appliquées | ✅ `0001_core.sql`, `0002_controls.sql`, `0003_hardening.sql` |
| `npm run db:seed` | société fictive + écritures | ✅ société `Lagon Bleu Trading Ltd (DEMO)` |
| `npm run typecheck` | TypeScript strict | ✅ |
| `npm test` | suite complète | ✅ **73 réussis, 4 ignorés** (concurrence PGlite) |
| `npm run build` | build API + interface | ✅ |
| démarrage de l'API depuis le clone | serveur opérationnel | ✅ `/api/health` → `{"status":"ok","version":"0.1.1"}`, connexion de démonstration HTTP 200 |

Note de terrain : `PGLITE_DIR` est relatif au répertoire courant. En passant par les scripts npm
(`npm run db:seed`, `npm run dev`, `npm start`), le répertoire est toujours `apps/api`. Le chemin
absolu réel de la base est désormais affiché au démarrage (`[db] PGlite data directory: …`).

État CI du commit `93a7b90` : **3 tâches vertes** — `Typecheck, tests and build` (34 s),
`API tests against real PostgreSQL` (30 s, 77/77 dont les 4 tests de concurrence),
`Migrations against real PostgreSQL` (27 s).

> **Limite honnête** : les tests navigateur Chromium fournis n'ont pas été exécutés dans
> l'environnement d'audit (aucun binaire de navigateur téléchargeable). Voir
> `docs/browser-tests.md`.

## 8. Procédure de contrôle pour un relecteur

1. `git ls-files | wc -l` → doit être proche de 92 (aucun artefact).
2. `git ls-files | grep -E '(^|/)\.env$'` → doit ne rien retourner.
3. `git ls-files -s | awk '$1=="160000"'` → doit ne rien retourner (pas de sous-module).
4. `du -sh .git` et la taille du plus gros fichier suivi → aucun binaire volumineux.
5. `npm ci && npm run verify` dans un clone neuf → doit passer.
6. `gh pr checks` sur la PR de la branche → 3 tâches vertes.
