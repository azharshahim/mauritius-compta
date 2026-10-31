# Rapport de tests — Mauritius Compta 0.1.1 (mission 6)

_Date : 31 octobre 2026._

## 1. Comment exécuter

```bash
npm ci
npm run typecheck   # TypeScript strict (API + interface + tests)
npm test            # Vitest : API puis interface
npm run build       # compilation API + interface
npm run build:demo  # bundle GitHub Pages (mode démo, sans réseau)
npm run verify      # typecheck + tests + build
```

Les tests API s'exécutent sur **PGlite** (PostgreSQL compilé en WebAssembly, en mémoire) : les
migrations et les triggers PL/pgSQL sont réellement exécutés, sans service externe. Deux tâches
CI complètent le dispositif :

- `API tests against real PostgreSQL` : la même suite sur PostgreSQL 16, ce qui active les
  4 tests de concurrence ;
- `Migrations against real PostgreSQL` : migrations rejouées deux fois, seed et vérifications.

## 2. Résultat global (exécution locale, 31 octobre 2026)

### API — `npm run test -w @mc/api`

| Fichier | Tests | Résultat |
|---|---|---|
| `tests/money.test.ts` | 9 | ✅ |
| `tests/migrations.test.ts` | 6 | ✅ |
| `tests/auth.test.ts` | 9 | ✅ |
| `tests/companies.test.ts` | 6 | ✅ |
| `tests/accounts.test.ts` | 4 | ✅ |
| `tests/entries.test.ts` | 12 | ✅ |
| `tests/reports.test.ts` | 10 | ✅ |
| `tests/regressions.test.ts` | 17 | ✅ |
| `tests/cabinet.test.ts` | 11 | ✅ |
| `tests/billing.test.ts` | 17 | ✅ |
| `tests/ai.test.ts` | 22 | ✅ |
| `tests/ai-proposals.test.ts` | 16 | ✅ |
| `tests/concurrency.test.ts` | 4 | ⏭️ ignorés sur PGlite |
| **Total** | **143** | **139 ✅ / 4 ⏭️** |

### Interface — `npm run test -w @mc/web`

| Fichier | Tests | Résultat |
|---|---|---|
| `tests/format.test.ts` | 4 | ✅ |
| `tests/demo-engine.test.ts` | 22 | ✅ |
| `tests/demo-app.test.tsx` | 11 | ✅ |
| `tests/demo-billing.test.ts` | 13 | ✅ |
| `tests/input-focus.test.tsx` | 10 | ✅ |
| **Total** | **60** | **60 ✅** |

### Vérifications complémentaires

- `npm run typecheck` : 0 erreur (API, web, tests).
- `npm run build:demo` : succès — 642 kB de JS, 16 kB de CSS.
- CI GitHub Actions : runs `41156378284` (push) et `41156382220` (PR) verts.
- Démo Pages : run `41156378229` vert (build + deploy).

## 3. Couverture fonctionnelle de la mission 6

**Facturation (`tests/billing.test.ts`)** : CRUD clients, doublons certains vs homonymes,
archivage sans suppression, articles, devis, conversion unique, numérotation séquentielle,
verrouillage après émission, avoir partiel et refus d'un avoir excessif, encaissement partiel,
trop-perçu, refus de double affectation et de dépassement, balance âgée, PDF réel généré,
isolation entre sociétés, permissions de lecture/écriture.

**Assistant V2 (`tests/ai-proposals.test.ts`)** : contrat complet, propositions déterministes
(9 scénarios), comptes hors plan refusés, exercice fermé refusé, TVA non configurée,
multidevise, validation humaine obligatoire, comptabilisation distincte, double
comptabilisation refusée, idempotence, règles (priorité, versions, désactivation, conflits,
isolation), absence d'écriture automatique.

**Démo navigateur (`tests/demo-billing.test.ts`)** : mêmes parcours avec `localStorage`
uniquement — listes fictives, conversion de devis, numérotation, verrouillage, avoir borné,
PDF explicitement indisponible, balance âgée et solde client, encaissement partiel avec
trop-perçu, proposition équilibrée, `post` impossible avant validation, comptabilisation unique,
contrepartie hors plan refusée, règles versionnées et désactivables, isolation des dossiers.

**Non-régression** : les 10 tests de focus (`input-focus.test.tsx`, correctif clavier Android)
et les 22 tests de la démo historique restent verts.

## 4. Tests ignorés et limites

- `tests/concurrency.test.ts` (4 cas) : **ignorés** sans `TEST_DATABASE_URL` (PGlite ne
  reproduit pas deux transactions concurrentes). Ils s'exécutent dans la CI PostgreSQL.
- Tests Playwright (`apps/web/e2e`) : non exécutés ici (pas de Chromium dans l'environnement de
  travail). La démo est donc validée par jsdom et par le workflow de publication, pas par une
  session Chrome/Android réelle.
- Le PDF n'est pas testé en mode démo : il est explicitement refusé (501) et le backend le
  génère ; le contenu du PDF est vérifié par le test API (en-tête `%PDF`, taille > 1 ko).
- Aucun fournisseur IA réel n'est testé : seul l'adaptateur simulé est actif, sans clé ni coût.

## 5. Reproductibilité

```bash
npm ci
npm run typecheck
npm test
npm run build:demo
```

Aucun secret, aucune base externe, aucun accès réseau ne sont nécessaires : les tests utilisent
des données fictives et PGlite.

## Mission 7 — assistant universel, paramètres société, TVA

| Suite | Commande | Résultat |
| --- | --- | --- |
| API | `npm test -w @mc/api` | 162 réussis, 4 ignorés (concurrence PostgreSQL réel) |
| Web | `npm test -w @mc/web` | 81 réussis (8 fichiers) |
| Typecheck | `npm run typecheck` | 0 erreur |
| Build démo | `npm run build:demo` | OK, panneau assistant en chunk séparé (3,27 kB) |

Nouveaux fichiers : `apps/api/tests/assistant.test.ts` (23 cas),
`apps/web/tests/demo-assistant.test.ts` (13), `apps/web/tests/assistant-ui.test.tsx`
(5), `apps/web/tests/company-settings-ui.test.tsx` (3).

Couverture mission 7 : contexte serveur et rejet d'une société non autorisée,
permissions d'outils (refus `denied`), factures impayées et tâches réelles,
recherche de compte et balance, indisponibilité de la paie, préparation d'écriture
sans comptabilisation, exemple 3 250 / 487,50 / 3 737,50, paramètres société et
verrou d'exercice, TVA (source obligatoire, traitements distincts, historique,
refus d'un taux non vérifié, gel après émission), démonstration sans appel réseau,
pastille dans les quatre modules, `Échap`, conservation de la conversation après
navigation, focus jamais volé.

**Non réalisé** (et non revendiqué) : aucune session navigateur réelle
(Chrome/Android), aucun appareil physique, aucun test de charge.

## Mission 8 — migration comptable

| Suite | Commande | Résultat |
| --- | --- | --- |
| API | `npm test -w @mc/api` | **185 réussis, 4 ignorés** (concurrence PostgreSQL réel) |
| Migrations | `apps/api/tests/migration.test.ts` | **23 réussis** |
| Web | `npm test -w @mc/web` | **97 réussis** (10 fichiers) |
| Typecheck | `npm run typecheck` | 0 erreur (API + web, strict) |
| Build API | `npm run build -w @mc/api` | OK |
| Build démo | `npm run build:demo` | OK (base `/mauritius-compta/`) |

Nouveaux fichiers de test : `apps/api/tests/migration.test.ts` (23),
`apps/web/tests/demo-migration.test.ts` (12), `apps/web/tests/migration-ui.test.tsx` (3).

Les 20 scénarios obligatoires de la mission sont couverts numérotés 1 à 20 dans
`migration.test.ts` : CSV FR, CSV EN (virgule et montants internationaux), XLSX
multi-feuilles, colonnes obligatoires manquantes, dates invalides, montants
négatifs, écriture déséquilibrée, compte inconnu puis correspondance explicite,
doublon de compte, doublon d'écriture, réimport identique, reprise après
interruption, balance d'ouverture via le moteur, multi-devises, société non
autorisée, isolation des modèles par cabinet, lot multi-sociétés sans affectation
automatique, import sans confirmation refusé, aucune écriture pendant l'aperçu,
non-régression de la saisie manuelle. Trois cas supplémentaires couvrent les
macros/extension refusées, le rapport CSV inerte et la convention SAP `S/H`.

**Non réalisé** (et non revendiqué) : aucun test Chrome/Samsung réel pour cette
mission, aucune compatibilité Sage/SAP certifiée, aucun import de fichier client
réel. Les fichiers d'exemple sont fictifs.

## Mission 9 — banque & rapprochement

| Suite | Commande | Résultat |
| --- | --- | --- |
| API bancaire | `npx vitest run tests/bank.test.ts` | **28 réussis / 28** |
| API complète | `npm test -w @mc/api` | **213 réussis, 4 ignorés** |
| Web complète | `npm test -w @mc/web` | **123 réussis (13 fichiers)** |
| Démo banque | `tests/demo-bank.test.ts` | **17 réussis** |
| UI banque + indicateur démo | `tests/bank-ui.test.tsx` | **3 réussis** |
| Politique d’upload Android | `tests/upload-policy.test.ts` | **6 réussis** |
| Typecheck | `npm run typecheck` | 0 erreur |
| Build démo | `npm run build:demo` | OK, 4 relevés fictifs copiés |

Correspondance avec les 30 scénarios du brief :

| # | Scénario | Test(s) |
|---|---|---|
| 1 | CSV FR | API 1, démo 2, UI 1 |
| 2 | CSV EN / dates EN | API 3 (`dayFirst:false`) |
| 3 | XLSX réel | API 2, démo 4 |
| 4 | TSV/TXT | API 27 |
| 5 | débit/crédit | API 4 |
| 6 | montant signé | API 5 |
| 7 | date FR | API 1, 3 |
| 8 | date EN | API 3 |
| 9 | date impossible | démo 6, `migration.test.ts` |
| 10 | doublon fichier | API 6, démo 5 |
| 11 | réimport | API 7, démo 3 |
| 12 | devise incompatible | API 8, démo 6 |
| 13 | solde incohérent | API 9, démo 6 |
| 14 | autorisations | API 10 (compte d'autrui), 28 (viewer en lecture seule) |
| 15 | isolation sociétés | API 11, démo 17 |
| 16 | isolation cabinets | API 12 |
| 17 | rapprochement exact | API 13, démo 9 |
| 18 | rapprochement ambigu | API 14 |
| 19 | rapprochement refusé/exclu | API 15, démo 15 |
| 20 | rapprochement validé | API 16, démo 10 |
| 21 | 1↔n | API 17 |
| 22 | n↔1 bloqué | API 18 |
| 23 | paiement déjà comptabilisé | API 19 |
| 24 | frais bancaires | API 20, démo 13 |
| 25 | salaire sans paie | API 21, démo 14, UI 1 |
| 26 | compte inexistant | API 22 |
| 27 | proposition non comptabilisée | API 23, démo 12 |
| 28 | idempotence | API 7, 24, démo 3 |
| 29 | rapport d'écart | API 25, démo 16 |
| 30 | régression missions 1–8 + UI Android | API 26 + suite complète 213/123, `bank-ui` indicateur compact |

Notes : les 28 tests API couvrent aussi le TSV (27) et les droits `viewer`
en lecture seule (28). Les cas UI Android restent des tests jsdom : aucun
appareil physique n'a été utilisé.

**Non réalisé** (et non revendiqué) : aucun test Chrome/Samsung/Android réel,
aucune donnée bancaire réelle, aucun fichier client, aucune connexion bancaire,
aucun fournisseur IA. Les fichiers de test sont fictifs.


## Correctif Android — sélection des fichiers (mission 9)

- `tests/upload-policy.test.ts` : `accept` contient les extensions et MIME
  Android ; CSV au MIME `application/octet-stream` ou vide accepté ; PDF,
  `.xls`, `.xlsm` et `.zip` refusés même avec MIME générique ; taille et
  fichier vide contrôlés.
- `tests/bank-ui.test.tsx` : attribut `accept` réellement rendu, sélection du
  CSV fictif, refus d'un PDF après sélection sans appel d'import.
- `tests/migration-ui.test.tsx` : `accept` commun contient `.txt`,
  `text/comma-separated-values` et `application/octet-stream`.
- Aucun téléphone Samsung/Android physique n'a été utilisé : la limite est
  explicite et le parcours manuel reste à rejouer sur l'URL Pages.
