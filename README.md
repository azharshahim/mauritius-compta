# COMPTAI

> **Nom provisoire.** COMPTAI est le nom de travail de l’application, anciennement « Mauritius Compta » / « Mauritius Business Suite ». Sa disponibilité juridique et commerciale reste à vérifier avant toute commercialisation.

**Suite de gestion mauricienne bilingue (FR/EN)** — version **0.1.1** du cœur comptable,
étendue en **COMPTAI** (mission 4) : espaces **Cabinet**, **Comptabilité**,
**Facturation** et **Paie & RH**.

> **État des modules** — Cabinet : opérationnel (dossiers, tâches, collaborateurs,
> permissions). Comptabilité : moteur V0.1.1 conservé, inchangé ; **Banque &
> rapprochement** (missions 9–10) importe des relevés CSV/TSV/XLSX fictifs,
> propose des correspondances, rapproche des règlements clients partiels
> (n↔1, 1↔n) et exige une validation humaine — aucun rapprochement ni aucune
> écriture automatique. **Achats & Fournisseurs** (mission 11) gère les fiches
> fournisseurs, factures d'achat, avoirs, règlements partiels/groupés et soldes
> **par devise** ; la comptabilisation passe par les propositions existantes,
> après validation puis comptabilisation humaines. **Lettrage** (mission 12)
> rapproche des lignes déjà comptabilisées, en partiel ou multiple, avec
> suggestions explicables et délettrage motivé ; il ne modifie aucune écriture
> et ne crée aucun paiement. Facturation (mission 6) :
> **opérationnelle** — clients, devis, factures, avoirs, encaissements, balance âgée et PDF A4
> générés par le serveur ; **aucun taux de TVA n'est fourni** et l'e-invoicing MRA reste
> **désactivé** ; un écran informatif « MRA e-Invoicing — À venir » documente la préparation
> sans aucune connexion ni transmission MRA. Paie & RH : **préparation et moteur statutaire daté** (missions 15–17, règles 2026/27) — dossiers salariés, contrats datés, temps, congés, variables, périodes, PAYE cumulatif, EDF, CSG, NSF, Training Levy et AR 2026 calculés depuis des règles officielles sourcées ; **revue experte en attente**, bulletins de **simulation**, **aucun bulletin final**, **préparation interne de déclarations MRA sans aucune soumission ni export officiel**, aucun virement. L'assistant comptable V2
> propose des écritures équilibrées issues du plan comptable réel, exige une **validation
> humaine** puis une **comptabilisation distincte** : aucune écriture n'est créée
> automatiquement. Le moteur IA est **optionnel**, sans clé par défaut.
> **Multidevises** (mission 13) : taux saisis et validés par un humain (jamais
> officiels, aucun fournisseur externe), factures et règlements en devise, écarts
> réalisés proposés puis comptabilisés une seule fois si les comptes de change sont
> configurés, réévaluations et virements inter-devises **simulés uniquement**.
> Voir [`docs/multi-currency.md`](docs/multi-currency.md).
> **Paie & RH** (missions 15–16) : les taux sont datés et sourcés (MRA, Gazette), jamais
> inventés, et **aucune règle n’est validée par un expert**. Le moteur calcule PAYE,
> CSG, NSF, Training Levy et AR 2026, mais le net payable reste vide et la
> finalisation est bloquée ; les bulletins portent une mention discrète
> « SIMULATION — NOT VALIDATED FOR PAYMENT » en pied de page. Voir
> [`docs/mission-15-report.md`](docs/mission-15-report.md),
> [`docs/regulatory-sources-register.md`](docs/regulatory-sources-register.md) et
> [`docs/mauritius-regulatory-audit-dossier.md`](docs/mauritius-regulatory-audit-dossier.md).
> Voir [`docs/suite-architecture.md`](docs/suite-architecture.md),
> [`docs/cabinet-module.md`](docs/cabinet-module.md) et
> [`docs/bank-import.md`](docs/bank-import.md).

> ⚠️ **Version de démonstration.** L'application **n'est pas** conforme, en l'état, aux
> obligations réglementaires mauriciennes : les règles de paie sont implémentées et sourcées
> mais **non approuvées par un expert**, la TVA et l’impôt sur les sociétés restent hors
> périmètre ; **aucune conformité MRA n’est affirmée**. Tous les états et
> exports portent la mention « DOCUMENT DE DÉMONSTRATION ». Voir
> [`docs/mauritius-regulations/`](docs/mauritius-regulations/) et le
> [registre de conformité](docs/mauritius-regulations/compliance-register.md).

> 🧪 **Aucune donnée réelle.** Société, BRN, numéro de TVA, adresses et montants du jeu de
> démonstration sont inventés. Le dépôt ne contient ni `.env`, ni secret, ni base de données,
> ni sauvegarde, ni `node_modules`.

---

## Sommaire

1. [Ce qui fonctionne en V0.1.1](#1-ce-qui-fonctionne-en-v011)
2. [Architecture et pile technique](#2-architecture-et-pile-technique)
3. [Prérequis](#3-prérequis)
4. [Installation sous Windows](#4-installation-sous-windows)
5. [Installation sous Linux / macOS](#5-installation-sous-linux--macos)
6. [Configuration PostgreSQL](#6-configuration-postgresql)
7. [Mode démonstration (sans PostgreSQL)](#7-mode-démonstration-sans-postgresql)
8. [Démarrage frontend + backend](#8-démarrage-frontend--backend)
9. [Tests](#9-tests)
10. [Reconstruction complète depuis GitHub](#10-reconstruction-complète-depuis-github)
11. [Documentation](#11-documentation)
12. [Sécurité et secrets](#12-sécurité-et-secrets)
13. [Limites réglementaires et fonctionnelles](#13-limites-réglementaires-et-fonctionnelles)
14. [COMPTAI](#14-comptai)
15. [Intelligence artificielle](#15-intelligence-artificielle)
16. [Dépannage](#16-dépannage)
17. [Indépendance et licence](#17-indépendance-et-licence)

---

## 1. Ce qui fonctionne en V0.1.1

| Domaine | Fonctionnalités |
|---|---|
| **Sociétés** | Multi-société, BRN, n° TVA, adresse, activité, exercice comptable, devise fonctionnelle et de présentation, norme comptable, statut ; membres et rôles (owner/admin/accountant/viewer) ; période comptable ouverte dès la création |
| **Plan comptable** | Comptes hiérarchiques (code, nom, type, parent, devise, actif/inactif, mapping états financiers) ; plan de **démonstration** non officiel ; suppression interdite si le compte est utilisé ; comptes désactivés conservés dans le grand livre |
| **Journaux** | Ventes, Achats, Banque, Caisse, Opérations diverses (création possible) |
| **Écritures** | Saisie multi-lignes, brouillon/validée, numérotation `JRN-AAAA-0001`, **renumérotation automatique** si un brouillon change de journal ou d'exercice, justificatifs PDF/JPEG/PNG, validation, contrepassation tracée et unique, verrouillage des écritures validées (API **et** PostgreSQL), **références uniques par société** |
| **Contrôles** | Σ débits = Σ crédits, période clôturée, comptes inactifs au moment de la validation, isolation stricte entre sociétés (API **et** triggers SQL), dates valides, montants exacts (`numeric(20,4)` + BigInt), précision limitée à 4 décimales, rejet des montants qui s'arrondissent à zéro |
| **Multidevise** | MUR, EUR, USD, GBP ; taux **daté saisi par l'utilisateur** (jamais inventé) ; changement de devise d'un brouillon exigeant un nouveau taux ; taux inverse calculé en arithmétique entière |
| **Grand livre** | Par compte, filtres période/recherche, solde initial, mouvements, solde progressif, totaux, export CSV/PDF |
| **Balance** | Colonnes solde initial / mouvements / solde final (D et C), contrôle d'équilibre, export CSV/PDF |
| **États financiers** | Statement of Financial Position et Statement of Profit or Loss provisoires ; le bilan intègre **le résultat cumulé depuis l'origine** (pas seulement la période) et reste équilibré même si la période analysée commence après les premières écritures ; export CSV/PDF |
| **Interface** | React responsive (Android et Windows), FR/EN commutable, tableau de bord avec indicateurs, tiroir de navigation mobile (fermeture par Échap, clic extérieur, navigation), modales accessibles |
| **Sécurité** | Sessions cookie HttpOnly + SameSite, scrypt, rôles serveur, requêtes SQL paramétrées, validation Zod, contrôle CSRF/Origin, CSP, anti-bruteforce **par compte et par adresse IP**, purge des sessions expirées, journal d'audit **append-only**, vérification de la signature réelle des fichiers envoyés |
| **Exploitation** | Migrations versionnées avec checksums, CI GitHub Actions (3 tâches), documentation technique et réglementaire |

## 2. Architecture et pile technique

```text
apps/api   API REST Fastify 5 + TypeScript strict, migrations SQL, seed, tests Vitest
apps/web   SPA React 19 + Vite 6 + React Router 7 (aucun framework CSS lourd)
docs/      documentation technique, audit, procédures, veille réglementaire
```

- **Base de données** : PostgreSQL 14+ en production ; **PGlite** (PostgreSQL compilé en
  WASM) pour la démonstration locale et les tests sans serveur.
- **Montants** : `numeric(20,4)` en base, **BigInt** dans le code (aucun flottant pour les
  calculs monétaires), chaînes décimales à 4 décimales dans l'API et dans l'interface.
- **Exports** : CSV (UTF-8 BOM, séparateur `;`, protection contre l'injection de formules) et
  PDF (PDFKit, bandeau « DÉMONSTRATION »).
- **Tests** : 77 tests (73 exécutés sur PGlite, 4 tests de concurrence sur PostgreSQL réel).

## 3. Prérequis

| Outil | Version minimale | Remarque |
|---|---|---|
| Node.js | **20 LTS** (22 recommandé) | `node -v` ; le dépôt contient `.nvmrc` (`22`) |
| npm | 9+ (livré avec Node) | `npm -v` |
| Git | 2.30+ | `git --version` |
| PostgreSQL | 14+ (16 recommandé) | **facultatif** : PGlite suffit pour la démonstration |
| Docker | 20+ | **facultatif** : `docker compose up -d db` fournit PostgreSQL 16 |

Aucun service payant, aucune clé d'API, aucun compte tiers n'est nécessaire.

## 4. Installation sous Windows

Testé avec Windows 10/11 et PowerShell 7 (ou `cmd.exe`).

```powershell
# 1. Installer Node.js 20+ (https://nodejs.org) et Git pour Windows (https://git-scm.com)
node -v
npm -v

# 2. Récupérer le dépôt
git clone https://github.com/azharshahim/mauritius-compta.git
cd mauritius-compta

# 3. Installer les dépendances (reproductible : utilise package-lock.json)
npm ci

# 4. Configuration locale (facultative : valeurs par défaut sûres)
Copy-Item .env.example .env
notepad .env      # renseigner DATABASE_URL si PostgreSQL est utilisé

# 5. Base de données + jeu de démonstration fictif
npm run db:seed   # crée .data\pglite et les données fictives

# 6. Démarrer API (:3000) + interface (:5173)
npm run dev
```

Ouvrir <http://localhost:5173>.

**PostgreSQL sous Windows** (deux options) :

```powershell
# Option A - Docker Desktop
docker compose up -d db

# Option B - PostgreSQL installé par l'installateur EDB
# 1) ajouter C:\Program Files\PostgreSQL\16\bin au PATH
# 2) créer la base :
createdb -U postgres mauritius_compta
# 3) renseigner dans .env :
#    DATABASE_URL=postgresql://postgres:motdepasse@localhost:5432/mauritius_compta
npm run db:migrate
```

> **PowerShell** : si `npm` est bloqué par la stratégie d'exécution, lancer
> `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`.
> Les chemins contenant des espaces ou des accents ne posent pas de problème, mais évitez
> les dossiers synchronisés (OneDrive) pour `.data\` et `storage\`.

## 5. Installation sous Linux / macOS

```bash
git clone https://github.com/azharshahim/mauritius-compta.git
cd mauritius-compta
npm ci
cp .env.example .env      # facultatif
npm run db:seed           # démonstration PGlite (fictive)
npm run dev
```

PostgreSQL local :

```bash
# Debian / Ubuntu
sudo apt install postgresql postgresql-client
sudo -u postgres createuser --pwprompt mc_user
sudo -u postgres createdb -O mc_user mauritius_compta
# ou, plus simple, avec Docker :
docker compose up -d db

# dans .env
DATABASE_URL=postgresql://mc_user:motdepasse@localhost:5432/mauritius_compta
npm run db:migrate
```

macOS (Homebrew) : `brew install postgresql@16 && brew services start postgresql@16`.

## 6. Configuration PostgreSQL

`.env` à la racine du dépôt (jamais commité) :

```dotenv
NODE_ENV=development
PORT=3000
HOST=0.0.0.0
APP_URL=http://localhost:5173

DATABASE_URL=postgresql://mc_user:motdepasse@localhost:5432/mauritius_compta
DATABASE_SSL=false          # true chez un hébergeur qui impose TLS
DATABASE_POOL_MAX=10

SESSION_COOKIE_NAME=mc_session
SESSION_TTL_HOURS=168
COOKIE_SECURE=false         # OBLIGATOIREMENT true en production (HTTPS)

PASSWORD_MIN_LENGTH=10
LOGIN_MAX_ATTEMPTS=10            # par compte, fenêtre LOGIN_WINDOW_MINUTES
LOGIN_MAX_ATTEMPTS_PER_IP=30     # par adresse IP (anti-pulvérisation de mots de passe)
LOGIN_WINDOW_MINUTES=15
ALLOW_REGISTRATION=true          # forcé à false par défaut si NODE_ENV=production
SESSION_PURGE_ON_LOGIN=true

STORAGE_DIR=./storage
MAX_UPLOAD_BYTES=10485760

DEFAULT_LOCALE=fr
```

Commandes utiles :

```bash
npm run db:migrate      # applique les migrations manquantes (checksums vérifiés)
npm run db:seed         # jeu de démonstration fictif (refusé en production)
npm run db:seed -- --force   # recrée la société de démonstration
```

Sauvegarde / restauration (à la charge de l'exploitation) :

```bash
pg_dump -Fc mauritius_compta > sauvegarde.dump
pg_restore -d mauritius_compta --clean --if-exists sauvegarde.dump
```

## 7. Mode démonstration (sans PostgreSQL)

Sans `DATABASE_URL`, l'API ouvre **PGlite** (PostgreSQL embarqué) dans
`apps/api/.data/pglite`. Aucune installation de PostgreSQL n'est nécessaire.

```bash
npm run db:seed
npm run dev
```

**Identifiants de démonstration (fictifs, locaux uniquement) :**

```text
E-mail       : demo@mauritius-compta.test
Mot de passe : DemoPassw0rd2026
Société      : Lagon Bleu Trading Ltd (DEMO)
BRN / TVA    : DEMO-BRN-0001 / DEMO-VAT-0001
Exercice     : 2025-07-01 → 2026-06-30
```

> Ces identifiants sont publics et documentés : ils ne doivent **jamais** être utilisés sur
> une instance accessible depuis Internet. En production, `ALLOW_REGISTRATION` vaut `false`
> par défaut et `npm run db:seed` refuse de s'exécuter (sauf `ALLOW_DEMO_SEED=true`
> explicitement, réservé à une instance de démonstration dédiée).

### Démonstration publique — GitHub Pages (aucun serveur)

Une démonstration **100 % navigateur** est publiée sur GitHub Pages depuis la branche de
développement (`arena/b0b62798-mauritius-compta`), sans fusion de la PR ni modification de
`main` :

```text
https://azharshahim.github.io/mauritius-compta/
```

> En ligne et vérifiée le 31/10/2026 : page 200, bundle JS 200, repli `404.html` actif,
> **quatre espaces et module Cabinet présents** dans le bundle publié
> (voir [`docs/mission-4-report.md`](docs/mission-4-report.md)).

```text
E-mail       : demo@mauritius-compta.test   (pré-rempli)
Mot de passe : DemoPassw0rd2026             (pré-rempli)
```

| Élément | Comportement |
|---|---|
| Backend simulé | `apps/web/src/demo/runtime.ts` — mêmes appels que l'API, exécutés dans la page |
| Stockage | `localStorage` du navigateur (clé `mc.demo.state.v1`), jamais un serveur |
| Données | Fictives, réinitialisables via le bouton « Réinitialiser la démo » |
| Bandeau | « MODE DÉMONSTRATION » permanent : rien n'est enregistré côté serveur |
| Réseau | Aucun appel à `/api`, aucune base PostgreSQL, aucun secret |
| PDF | Impression du navigateur (le PDF officiel est généré par l'API) |

Fonctionne sans aucune opération simulée présentée comme enregistrée : les écritures créées
dans la démo existent uniquement dans le navigateur de l'utilisateur. Voir
[`docs/deployment.md`](docs/deployment.md#démonstration-github-pages) et
[`docs/demo-mode.md`](docs/demo-mode.md).

## 8. Démarrage frontend + backend

| Commande | Effet |
|---|---|
| `npm run dev` | API `http://localhost:3000` + interface `http://localhost:5173` (proxy `/api`) |
| `npm run dev:api` | API seule |
| `npm run dev:web` | Interface seule (nécessite l'API) |
| `npm run build` | Build de production (interface dans `apps/web/dist`, API dans `apps/api/dist`) |
| `npm start` | API de production ; elle sert aussi l'interface compilée |

Vérification rapide :

```bash
curl http://localhost:3000/api/health      # {"status":"ok","version":"0.1.1"}
```

Sous Windows, les mêmes commandes fonctionnent (PowerShell ou `cmd.exe`).

## 9. Tests

```bash
npm run typecheck   # TypeScript strict, API + interface
npm test            # API + web : 358 tests passés | 7 ignorés (365)
npm run build       # build de production
npm run verify      # les trois ci-dessus, dans l'ordre
```

- **PostgreSQL réel** : `TEST_DATABASE_URL=postgresql://… npm test` exécute la même suite
  **et** les 7 tests de concurrence (numérotation parallèle, double contrepassation,
  référence concurrente, équilibre de la balance, et trois courses de rapprochement
  bancaire mission 10).
- **Navigateur (Chromium)** : `npm run test:e2e:install -w @mc/web` puis
  `npm run test:e2e -w @mc/web` (voir [`docs/browser-tests.md`](docs/browser-tests.md)).
  Ces tests **n'ont pas pu être exécutés dans l'environnement d'audit** (aucun binaire
  Chromium disponible) : ne pas les considérer comme validés tant qu'ils n'ont pas tourné.
- **Tests web (jsdom)** : `npm run test -w @mc/web` → **127 tests** (démo comptable,
  facturation, IA, migration, banque, scénarios A→G, clavier Android, formatage).
  `npm test` exécute l'API **et** le web : **358 tests passés | 7 ignorés (365)** au
  total ; les 7 ignorés sont les tests de concurrence qui exigent un vrai PostgreSQL
  (exécutés en CI). Aucun appareil Samsung physique n'est disponible : la limite est
  déclarée dans les rapports.
- **Clavier Android** : `apps/web/tests/input-focus.test.tsx` saisit caractère par caractère
  dans tous les formulaires et vérifie que le champ garde le focus et n'est jamais démonté.
- Détail des scénarios et des résultats : [`docs/test-report.md`](docs/test-report.md),
  [`docs/mission-4-report.md`](docs/mission-4-report.md) et
  [`docs/mission-5-report.md`](docs/mission-5-report.md).

## 10. Reconstruction complète depuis GitHub

Procédure vérifiée (voir [`docs/github-project-integrity.md`](docs/github-project-integrity.md)) :

```bash
git clone https://github.com/azharshahim/mauritius-compta.git reconstruction
cd reconstruction
git switch arena/b0b62798-mauritius-compta   # branche de travail auditée
npm ci
npm run db:migrate
npm run db:seed
npm run typecheck && npm test && npm run build
npm run dev
```

Le dépôt contient **tout le nécessaire** : code API et interface, migrations SQL, tests,
scripts, configuration d'exemple, CI, documentation technique et réglementaire, données de
démonstration fictives. Il ne contient **ni** `node_modules`, **ni** `.env`, **ni** base de
données, **ni** secret, **ni** donnée réelle.

## 11. Documentation

| Document | Contenu |
|---|---|
| [`docs/architecture.md`](docs/architecture.md) | Architecture, modèle de données, triggers, sécurité, multidevise, i18n |
| [`docs/api.md`](docs/api.md) | Référence de l'API (routes, corps, erreurs, exemples curl) |
| [`docs/audit-v0.1.1.md`](docs/audit-v0.1.1.md) | Audit V0.1.1 : anomalies, corrections, preuves |
| [`docs/github-project-integrity.md`](docs/github-project-integrity.md) | Inventaire du dépôt et reconstruction complète |
| [`docs/browser-tests.md`](docs/browser-tests.md) | Tests navigateur : limites de l'environnement et procédure reproductible |
| [`docs/test-report.md`](docs/test-report.md) | Rapport de tests détaillé |
| [`docs/deployment.md`](docs/deployment.md) | Préparation VPS Ubuntu + Nginx (aucun déploiement effectué) |
| [`docs/roadmap.md`](docs/roadmap.md) | Suite du produit (mission 3 et au-delà) |
| [`docs/suite-architecture.md`](docs/suite-architecture.md) | Quatre espaces, base commune, domaines PostgreSQL |
| [`docs/cabinet-module.md`](docs/cabinet-module.md) | Module Cabinet : fonctions, données, API, démo |
| [`docs/permissions-matrix.md`](docs/permissions-matrix.md) | Rôles × modules, séparation paie/comptabilité |
| [`docs/module-integration.md`](docs/module-integration.md) | Contrats d'intégration OCR/banque/facturation/paie |
| [`docs/mission-4-report.md`](docs/mission-4-report.md) | Rapport de mission 4 |
| [`docs/ai-architecture.md`](docs/ai-architecture.md) | Moteur IA : orchestration, isolations, implémenté vs préparé |
| [`docs/ai-providers.md`](docs/ai-providers.md) | Catalogue de fournisseurs, différences d'API, ajout d'un fournisseur |
| [`docs/ai-security.md`](docs/ai-security.md) | Chiffrement des clés, permissions, injections, données personnelles |
| [`docs/ai-cost-control.md`](docs/ai-cost-control.md) | Consommation, coûts exacts, budgets et plafonds |
| [`docs/ai-account-suggestions.md`](docs/ai-account-suggestions.md) | Assistant de suggestion de compte et validation humaine |
| [`docs/mission-5-report.md`](docs/mission-5-report.md) | Rapport de mission 5 |
| [`docs/mission-6-report.md`](docs/mission-6-report.md) | Rapport de mission 6 (facturation, assistant V2) |
| [`docs/mission-7-report.md`](docs/mission-7-report.md) | Rapport de mission 7 (assistant universel, paramètres société, TVA) |
| [`docs/mission-9-report.md`](docs/mission-9-report.md) | Rapport de mission 9 (banque, rapprochement, Android) |
| [`docs/mission-10-report.md`](docs/mission-10-report.md) | Rapport de mission 10 (rapprochement avancé, intégration Facturation, mobile) |
| [`docs/mission-11-report.md`](docs/mission-11-report.md) | Rapport final de mission 11 (Achats & Fournisseurs, 16 points) |
| [`docs/purchases-audit.md`](docs/purchases-audit.md) | Audit préalable, réutilisation du moteur et décisions |
| [`docs/purchases-suppliers.md`](docs/purchases-suppliers.md) | Fournisseurs, factures d'achat, avoirs, TVA configurée, API |
| [`docs/supplier-payments.md`](docs/supplier-payments.md) | Règlements partiels/groupés, acomptes, avoirs, banque, concurrence |
| [`docs/supplier-accounting.md`](docs/supplier-accounting.md) | Propositions comptables, comptes, contrôles, immutabilité |
| [`docs/mission-12-report.md`](docs/mission-12-report.md) | Rapport final de mission 12 (lettrage, 16 points) |
| [`docs/mission-14-report.md`](docs/mission-14-report.md) | Rapport de mission 14 (fondation paie & RH) |
| [`docs/mission-15-report.md`](docs/mission-15-report.md) | Rapport final de mission 15 (moteur statutaire, 16 points) |
| [`docs/mission-16-report.md`](docs/mission-16-report.md) | Rapport de mission 16 (règles 2026/27, bulletin, démonstration) |
| [`docs/mission-17-report.md`](docs/mission-17-report.md) | Rapport de mission 17 (impression individuelle, déclarations MRA, exports internes) |
| [`docs/mission-18-report.md`](docs/mission-18-report.md) | Rapport de mission 18 (transfert paie → comptabilité, correspondances, proposition équilibrée) |
| [`docs/mission-19-report.md`](docs/mission-19-report.md) | Rapport de mission 19 (capitaux propres, clôture annuelle, affectation du résultat) |
| [`docs/mra-declarations.md`](docs/mra-declarations.md) | Champs MRA vérifiés, contrôles, export interne, raisons du blocage officiel |
| [`docs/regulatory-sources-register.md`](docs/regulatory-sources-register.md) | Registre des sources officielles, statuts et approbation experte |
| [`docs/mauritius-regulatory-audit-dossier.md`](docs/mauritius-regulatory-audit-dossier.md) | Dossier d’audit réglementaire en anglais, 18 chapitres |
| [`docs/paye-calculation-specification.md`](docs/paye-calculation-specification.md) | Spécification PAYE cumulative, EDF et FSC bloquée |
| [`docs/csg-nsf-training-levy.md`](docs/csg-nsf-training-levy.md) | CSG, NSF, Training Levy : taux, plafonds datés et limites |
| [`docs/additional-remuneration-2026.md`](docs/additional-remuneration-2026.md) | AR 2026 (GN nº 7 de 2026), catégories et bases |
| [`docs/payroll-statutory-test-cases.md`](docs/payroll-statutory-test-cases.md) | Cas de test A→R et couverture |
| [`docs/payroll-existing-audit.md`](docs/payroll-existing-audit.md) | Audit du module paie existant et décisions d’extension |
| [`docs/mauritius-payroll-architecture.md`](docs/mauritius-payroll-architecture.md) | Architecture, migration 0014, moteur déterministe et blocage réglementaire |
| [`docs/employee-master-data.md`](docs/employee-master-data.md) | Données salariés, contrats datés, confidentialité bancaire |
| [`docs/payroll-rules-register.md`](docs/payroll-rules-register.md) | Registre des règles, statuts et points ouverts pour revue experte |
| [`docs/payroll-security.md`](docs/payroll-security.md) | Isolation, permissions, masquage, IA et limites de sécurité |
| [`docs/payroll-user-guide.md`](docs/payroll-user-guide.md) | Guide utilisateur paie (préparation et simulation) |
| [`docs/mission-13-report.md`](docs/mission-13-report.md) | Rapport final de mission 13 (multidevises, 16 points) |
| [`docs/multi-currency.md`](docs/multi-currency.md) | Architecture multidevise, schéma, API, rapports |
| [`docs/exchange-rate-policy.md`](docs/exchange-rate-policy.md) | Catégories de taux, validation, absence de taux officiel |
| [`docs/fx-gains-losses.md`](docs/fx-gains-losses.md) | Écarts réalisés, latents, virements et limites |
| [`docs/fx-validation-register.md`](docs/fx-validation-register.md) | Questions ouvertes pour l’expert-comptable |
| [`docs/multi-currency-user-guide.md`](docs/multi-currency-user-guide.md) | Guide utilisateur multidevises |
| [`docs/ledger-lettering.md`](docs/ledger-lettering.md) | Lettrage client/fournisseur, partiels, suggestions, rapports |
| [`docs/lettering-security.md`](docs/lettering-security.md) | Isolation, permissions, verrous, immuabilité, délettrage |
| [`docs/supplier-bank-ui.md`](docs/supplier-bank-ui.md) | Écran Banque ↔ Fournisseurs, confirmation et limites |
| [`docs/lettering-user-guide.md`](docs/lettering-user-guide.md) | Guide utilisateur du lettrage |
| [`docs/advanced-reconciliation.md`](docs/advanced-reconciliation.md) | n↔1, 1↔n, partiels, blocages, lettrage et limites |
| [`docs/bank-billing-integration.md`](docs/bank-billing-integration.md) | Banque ↔ Facturation, anti-doublons, comptabilisation existante |
| [`docs/bank-import.md`](docs/bank-import.md) | Formats, colonnes, contrôles, idempotence, limites |
| [`docs/bank-reconciliation.md`](docs/bank-reconciliation.md) | Rapprochement 1↔1/1↔n, cas bloqués, rapport |
| [`docs/bank-ai-suggestions.md`](docs/bank-ai-suggestions.md) | Suggestions déterministes, règles, salaires, limites IA |
| [`docs/bank-security.md`](docs/bank-security.md) | Permissions, isolation, audit, anti-abus |
| [`docs/bank-user-guide.md`](docs/bank-user-guide.md) | Guide utilisateur de l'import et du rapprochement |
| [`docs/mission-8-report.md`](docs/mission-8-report.md) | Rapport de mission 8 (migration comptable Excel/CSV, Sage, SAP) |
| [`docs/migration-architecture.md`](docs/migration-architecture.md) | Architecture de la migration : flux, tables, idempotence, limites |
| [`docs/migration-excel-csv.md`](docs/migration-excel-csv.md) | Formats, encodages, montants/dates, contrôles, fichiers fictifs |
| [`docs/migration-sage.md`](docs/migration-sage.md) | Profils Sage expérimentaux : colonnes reconnues, limites, non-certification |
| [`docs/migration-sap.md`](docs/migration-sap.md) | Profil SAP expérimental : champs, indicateur S/H, limites |
| [`docs/migration-security.md`](docs/migration-security.md) | Permissions, isolation, limites anti-abus, injection CSV, audit |
| [`docs/migration-user-guide.md`](docs/migration-user-guide.md) | Guide des six étapes et questions fréquentes |
| [`docs/ai-universal-assistant.md`](docs/ai-universal-assistant.md) | Pastille IA, contexte serveur, orchestration, rétention |
| [`docs/accounting-ai-agent-roadmap.md`](docs/accounting-ai-agent-roadmap.md) | Feuille de route de l'agent comptable, modes, risques, paie supervisée |
| [`docs/mra-e-invoicing-roadmap.md`](docs/mra-e-invoicing-roadmap.md) | MRA e-Invoicing : sources officielles, six volets de préparation, points confirmés / à vérifier / hypothèses |
| [`docs/mission-25-report.md`](docs/mission-25-report.md) | Rapport de mission 25 (écran À venir, vérification de publication, tests) |
| [`docs/mission-29-report.md`](docs/mission-29-report.md) | Rapport de mission 29 (OCR, extraction bancaire, tests synthétiques, limites) |
| [`docs/preproduction-audit-checklist.md`](docs/preproduction-audit-checklist.md) | Checklist d’audit avant production (statuts prouvés, portes de sortie) |
| [`docs/ai-tool-permissions.md`](docs/ai-tool-permissions.md) | Matrice outil × module × permission, anti-injection |
| [`docs/company-settings.md`](docs/company-settings.md) | Référentiel unique des paramètres société |
| [`docs/vat-configuration.md`](docs/vat-configuration.md) | Traitements TVA, vérification humaine, historique |
| [`docs/regulatory-review-register.md`](docs/regulatory-review-register.md) | Registre des règles à faire vérifier (aucune validation inventée) |
| [`docs/audit-existing-apps.md`](docs/audit-existing-apps.md) | Audit des applications existantes du propriétaire (aucune modification) |
| [`docs/mauritius-regulations/`](docs/mauritius-regulations/) | Veille réglementaire : comptabilité, TVA, IS, paie, données, sources, registre |

## 12. Sécurité et secrets

- `.env` est ignoré par Git ; `.env.example` ne contient **aucun secret réel**.
- Un contrôle CI échoue si un `.env` ou un fichier de clé (`.pem`, `.key`, `.p12`) est commité.
- Aucune clé d'API, aucun mot de passe de production, aucune donnée client dans le dépôt.
- Toutes les données de démonstration sont **fictives**.
- Signaler toute vulnérabilité au propriétaire du dépôt, sans ouvrir d'issue publique.
- En production : `COOKIE_SECURE=true`, HTTPS obligatoire, `ALLOW_REGISTRATION=false`,
  ne jamais exécuter `db:seed`.

## 13. Limites réglementaires et fonctionnelles

**Réglementaire** (aucune conformité n'est revendiquée) :

- Aucun calcul de TVA/GST, **aucune déclaration MRA transmise, aucun fichier PACO officiel**, aucune facturation électronique ; l’écran **MRA e-Invoicing — À venir** est purement informatif et n’active aucune connexion.
- Aucun impôt sur les sociétés, aucune paie, aucun taux légal codé en dur.
- États financiers **provisoires**, non certifiés IFRS, sans notes annexes ni écritures de
  clôture/report à nouveau.
- Plan comptable de **démonstration** : il ne remplace pas un plan validé par un expert-comptable.
- Toutes les règles listées dans [`docs/mauritius-regulations/compliance-register.md`](docs/mauritius-regulations/compliance-register.md)
  restent marquées **À VÉRIFIER** ou **NON IMPLÉMENTÉ**.

**Fonctionnel** :

- Export Excel au format CSV uniquement (XLSX non implémenté).
- Pas d'authentification à deux facteurs, pas de réinitialisation de mot de passe par e-mail.
- Pas de sauvegarde automatisée intégrée (à organiser côté exploitation).
- Tests navigateur fournis mais **non exécutés** dans l'environnement d'audit.
- Pas d'immutabilité légale horodatée (pas de scellement cryptographique de type piste
  d'audit infalsifiable) : le journal d'audit applicatif n'est pas un dispositif certifié.

## 14. COMPTAI

Cinq espaces partagent un seul référentiel de sociétés et une seule base PostgreSQL, avec
des permissions et des tables séparées par module :

| Espace | Route | État |
|---|---|---|
| Cabinet | `/cabinet` | **opérationnel** : tableau de bord, dossiers clients, fiche dossier, tâches & échéances, collaborateurs |
| Documents | `/documents` | **consultation et archivage** : les imports démarrent désormais depuis le journal concerné ; l’écran garde la recherche, l’historique, les corrections, les propositions équilibrées et la validation humaine. Aucune comptabilisation automatique |
| Comptabilité | `/accounting` | **opérationnel** : journaux dédiés (achats, ventes, banque avec import direct de relevés, opérations diverses), plan comptable bilingue, écritures, grand livre, balance, états financiers, périodes, devises, audit + **Banque & rapprochement** (CSV/TSV/XLSX et **relevés PDF texte/scannés**, MCB prioritaire, autres banques en lecture prudente, rapprochement humain) + **Achats & Fournisseurs** |
| Facturation | `/billing` | **opérationnel** : clients, devis, factures, avoirs, encaissements, balance âgée, PDF serveur ; **MRA e-Invoicing — À venir** : écran informatif, intégration non activée, aucune connexion MRA |
| Paie & RH | `/payroll` | **préparation et simulation** : salariés, contrats, temps, congés, variables, périodes, PAYE/CSG/NSF/levy sourcés, EDF, AR 2026, bulletins de simulation imprimables un par un, déclarations MRA en préparation interne ; revue experte en attente, aucun bulletin final, aucune soumission MRA |

- Rôles : `cabinet_admin`, `manager`, `accountant`, `billing_clerk`, `payroll_manager`,
  `viewer` (+ `owner`/`admin` historiques) — voir
  [`docs/permissions-matrix.md`](docs/permissions-matrix.md).
- Les anciennes URL (`/entries`, `/companies`, …) redirigent : aucun signet n'est cassé.
- **Mission 30** : identité **COMPTAI** provisoire (logo, favicon, icônes PWA 192/512, icône maskable Android, manifeste, raccourcis Windows/Android, écran de lancement généré par le manifeste), **menu latéral Android corrigé** (voile, fermeture explicite, défilement interne, zones sûres), **Banque et trésorerie remontée juste après Comptabilité**, séparation explicite démonstration/réel et démonstration actualisée avec les champs de vérification de la mission 29. Voir [`docs/mission-30-report.md`](docs/mission-30-report.md).
- **Mission 29** : extraction documentaire plus contrôlable — identifiants fiscaux, remises, avoirs, confiance par champ, ré-extraction auditée, détection bancaire explicite et compte masqué, vérification côte à côte. **Aucun taux de fiabilité général n’est annoncé** et aucun format SBM/Absa/MauBank n’est présenté comme certifié. Voir [`docs/mission-29-report.md`](docs/mission-29-report.md) et la [`checklist d’audit avant production`](docs/preproduction-audit-checklist.md).
- **Mission 27** : import direct d’un **relevé bancaire depuis le Journal de banque** (PDF, CSV, TSV, XLSX via les lecteurs existants), compte bancaire conservé, prévisualisation enrichie, retour contextualisé au journal et explication des opérations non comptabilisées. Voir [`docs/mission-27-report.md`](docs/mission-27-report.md).
- **Mission 26** : navigation par **huit groupes repliables** (Accueil, Comptabilité, Banque et trésorerie, Facturation, Paie et RH, Gestion avancée, États financiers, Cabinet et administration ; ordre ajusté en mission 30), imports de factures d’achat et de vente depuis les journaux, lecteur de relevés bancaires PDF, accueil allégé et Documents en consultation. Voir [`docs/mission-26-report.md`](docs/mission-26-report.md).
- **Mission 25** : écran bilingue **MRA e-Invoicing — À venir** (route stable
  `/billing/e-invoicing`, six fonctions annoncées non disponibles, paramètres futurs inactifs,
  aucun appel réseau, aucune inscription ni certification), feuille de route
  [`docs/mra-e-invoicing-roadmap.md`](docs/mra-e-invoicing-roadmap.md), vérification de la
  publication Mission 24 sur GitHub Pages. Voir [`docs/mission-25-report.md`](docs/mission-25-report.md).
- **Mission 23** : plan comptable bilingue avec trois profils (`PENDING PROFESSIONAL VALIDATION`,
  `AWAITING FIRM CONFIRMATION`, plan propre à la société), import CSV/XLSX avec mapping et
  prévisualisation, OCR natif (Tesseract local, sans service externe), importeur MCB
  Savings Regular Account et, depuis la mission 26, lecteur PDF générique prudent pour les
  autres banques. Aucun numéro de compte mauricien n’est présenté comme obligatoire. Voir [`docs/mission-23-report.md`](docs/mission-23-report.md).
- **Mission 24** : audit et correction FR/EN (1 605 clés par langue, glossaire centralisé,
  64 codes d'erreur traduits), édition des stocks et pont facture → mouvements de stock,
  mappings comptables lisibles, navigation OCR → écritures et MCB → rapprochement,
  gouvernance du catalogue d'outils IA et feuille de route de l'agent. Voir
  [`docs/mission-24-report.md`](docs/mission-24-report.md) et
  [`docs/accounting-ai-agent-roadmap.md`](docs/accounting-ai-agent-roadmap.md) et
  [`docs/mission-24-demo-verification.md`](docs/mission-24-demo-verification.md).
- Documentation : [`docs/suite-architecture.md`](docs/suite-architecture.md),
  [`docs/cabinet-module.md`](docs/cabinet-module.md),
  [`docs/module-integration.md`](docs/module-integration.md).

## 15. Intelligence artificielle

Le **Mauritius AI Engine** (mission 5) est un moteur central, indépendant des modules
métier, capable d'utiliser plusieurs fournisseurs sans modifier le code de la suite :

| Fournisseur | Adaptateur | État |
|---|---|---|
| OpenAI | `openai` | configurable (clé du cabinet) |
| DeepSeek | `openai` | configurable (clé du cabinet) |
| Google Gemini | `gemini` | configurable (clé du cabinet) |
| Mistral AI | `openai` | configurable (clé du cabinet) |
| Compatible OpenAI | `openai` | URL et modèle saisis par le cabinet |
| Auto-hébergé | `openai` | désactivé par défaut, phase ultérieure |
| Simulateur fictif | `simulated` | démonstration et tests, hors ligne |

- **Aucune clé API n'est fournie ni requise pour essayer** : la démonstration GitHub Pages
  et les tests utilisent un fournisseur fictif déterministe, sans réseau ni coût.
- **BYOK** : chaque cabinet enregistre sa propre clé, chiffrée en base (AES-256-GCM, clé
  dédiée `AI_ENCRYPTION_KEY`), jamais retournée par l'API ni écrite dans un journal.
- **Budget** : consommation par cabinet, fournisseur, modèle et module ; budget mensuel en
  USD, plafond de requêtes, seuil d'alerte, blocage serveur. Sans tarif daté et vérifié,
  le coût est affiché « indisponible » — aucun montant n'est inventé.
- **Assistant comptable** (Cabinet → Assistant comptable) : propose un compte **du plan
  comptable réel** de la société, avec catégorie, justification, confiance et statut
  « À vérifier ». L'utilisateur accepte, corrige ou refuse ; une règle réutilisable peut
  être mémorisée. **Aucune écriture comptable n'est jamais créée par l'IA.**
- **Gouvernance (mission 24)** : le catalogue expose le mode (`read`/`prepare`), le
  risque, l'accès requis et la validation humaine ; l'exécution reste désactivée
  (`executionEnabled: false`). Aucun appel LLM n'est utilisé par l'assistant pour choisir
  un outil : le routeur est déterministe. Voir
  [`docs/accounting-ai-agent-roadmap.md`](docs/accounting-ai-agent-roadmap.md).
- **Documentation** : [`docs/ai-architecture.md`](docs/ai-architecture.md),
  [`docs/ai-providers.md`](docs/ai-providers.md),
  [`docs/ai-security.md`](docs/ai-security.md),
  [`docs/ai-cost-control.md`](docs/ai-cost-control.md),
  [`docs/ai-account-suggestions.md`](docs/ai-account-suggestions.md).

```bash
# démonstration locale complète (fournisseur fictif, aucune clé)
AI_ALLOW_SIMULATED=true npm run dev
```

> Aucun achat de crédits, aucun paiement et aucun appel externe ne sont effectués par le
> logiciel tant qu'un cabinet n'a pas explicitement activé l'IA et configuré sa clé.

## 16. Dépannage

| Symptôme | Cause probable | Solution |
|---|---|---|
| `EADDRINUSE :3000` / `:5173` | Port déjà utilisé | `PORT=3001 npm run dev:api`, ou arrêter le processus (`npx kill-port 3000`) |
| `Invalid environment configuration: …` | `.env` incomplet ou invalide | comparer avec `.env.example`, corriger la valeur signalée |
| `password authentication failed for user "mc_user"` | `DATABASE_URL` incorrecte | vérifier utilisateur/mot de passe/port ; tester `psql "$DATABASE_URL"` |
| `ECONNREFUSED 127.0.0.1:5432` | PostgreSQL arrêté | `docker compose up -d db` ou `sudo systemctl start postgresql` |
| `relation "…" does not exist` | migrations non appliquées | `npm run db:migrate` |
| `Migration … was modified after being applied` | migration éditée après coup | créer une nouvelle migration au lieu de modifier l'ancienne |
| `Refusing to load demonstration data with NODE_ENV=production` | `db:seed` en production | normal : ne jamais charger la démo en production |
| Écran blanc après build | interface non compilée | `npm run build` puis `npm start` (l'API sert `apps/web/dist`) |
| 401 systématique / déconnexion immédiate | `COOKIE_SECURE=true` sans HTTPS | mettre `COOKIE_SECURE=false` en local |
| `403 Origin not allowed` | appel API depuis un autre domaine | utiliser le proxy `/api` de Vite, ou renseigner `APP_URL` |
| Mot de passe oublié (démo) | — | recréer les données : `npm run db:seed -- --force` |
| `.data/pglite` verrouillé | deux instances API sur le même dossier | arrêter l'autre instance ou changer `PGLITE_DIR` |
| Tests navigateur : `Executable doesn't exist` | Chromium non installé | `npm run test:e2e:install -w @mc/web` (téléchargement réseau requis) |
| Windows : `npm` non reconnu | Node.js absent du PATH | réinstaller Node.js, rouvrir le terminal |
| Windows : erreur `EPERM` sur `.data` | dossier OneDrive/antivirus | déplacer le dépôt hors OneDrive, exclure le dossier de l'antivirus |

Journaux : l'API écrit en JSON structuré (`pino`) sur la sortie standard ; en développement,
`npm run dev:api` affiche chaque requête.

## 17. Indépendance et licence

Ce logiciel est **juridiquement et techniquement indépendant** des applications françaises du
propriétaire (paie, comptabilité, facturation) : code, schéma, base et documentation propres.
Aucune règle fiscale française n'a été copiée ni transposée. Aucun dépôt tiers n'a été modifié.

Projet privé — **tous droits réservés** au propriétaire (`UNLICENSED`). Aucune licence de
réutilisation n'est accordée par ce dépôt.
