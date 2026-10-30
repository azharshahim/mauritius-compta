# Rapport de tests — Mauritius Compta 0.1.1

_Date : 30 octobre 2026._

## 1. Comment exécuter

```bash
npm ci
npm run typecheck   # TypeScript strict (API + interface)
npm test            # Vitest, 77 tests
npm run build       # compilation API + interface
npm run verify      # les trois ci-dessus
```

Les tests s'exécutent par défaut sur **PGlite** : le véritable moteur PostgreSQL compilé en
WebAssembly, exécuté en mémoire. Aucun service externe, aucun conteneur, aucune installation de
PostgreSQL n'est nécessaire. Les migrations et les triggers PL/pgSQL sont réellement exécutés.

Deux tâches CI complètent ce dispositif :

- `API tests against real PostgreSQL` : la **même** suite tourne sur PostgreSQL 16, ce qui
  active en plus les 4 tests de concurrence (`TEST_DATABASE_URL`) ;
- `Migrations against real PostgreSQL` : migrations rejouées deux fois (idempotence), seed,
  vérifications `psql`.

## 2. Résultat global (exécution locale, PGlite)

| Suite | Fichier | Tests | Résultat |
|---|---|---|---|
| Arithmétique monétaire, taux inverses, dates | `tests/money.test.ts` | 9 | ✅ |
| Migrations PostgreSQL | `tests/migrations.test.ts` | 6 | ✅ |
| Authentification / autorisation / langue | `tests/auth.test.ts` | 9 | ✅ |
| Sociétés et isolation | `tests/companies.test.ts` | 6 | ✅ |
| Plan comptable | `tests/accounts.test.ts` | 4 | ✅ |
| Écritures, contrôles, multidevise | `tests/entries.test.ts` | 12 | ✅ |
| Grand livre, balance, états financiers | `tests/reports.test.ts` | 10 | ✅ |
| **Non-régressions V0.1.1** | `tests/regressions.test.ts` | **17** | ✅ |
| Concurrence (PostgreSQL requis) | `tests/concurrency.test.ts` | 4 | ⏭️ ignorés sur PGlite |
| **Total** | | **77** | **73 ✅ / 4 ⏭️** |

Durée observée : ~12 s (PGlite), sur un environnement de CI standard.

Sur PostgreSQL réel (tâche CI `API tests against real PostgreSQL`, commit `93a7b90`) :
**77/77**, dont les 4 tests de concurrence — tâche verte en 30 s.

## 3. Couverture des priorités du cahier des charges

| # | Priorité demandée | Test(s) |
|---|---|---|
| 1 | Équilibre débit/crédit | `entries.test.ts` (rejet d'écriture déséquilibrée), contrainte différée |
| 2 | Précision et arrondi des montants | `money.test.ts`, `regressions.test.ts` (4 décimales max, arrondi à zéro refusé) |
| 3 | Numérotation | `entries.test.ts`, `regressions.test.ts` (renumérotation), `concurrency.test.ts` (8 créations parallèles) |
| 4 | Unicité des références | `regressions.test.ts` (doublon, casse, autre société), `concurrency.test.ts` |
| 5 | Modification des brouillons | `regressions.test.ts` (devise, journal, exercice) |
| 6 | Immutabilité des écritures validées | `entries.test.ts`, `regressions.test.ts` (DELETE SQL direct refusé) |
| 7 | Contrepassations | `entries.test.ts`, `regressions.test.ts` (double contrepassation), `concurrency.test.ts` |
| 8 | Périodes, clôture, réouverture | `entries.test.ts`, `regressions.test.ts` (société sans plan comptable) |
| 9 | Soldes, grand livre, balance, états | `reports.test.ts`, `regressions.test.ts` (bilan équilibré en milieu d'historique, comptes désactivés) |
| 10 | Devises | `entries.test.ts`, `regressions.test.ts` (devise inconnue, taux obligatoire, taux inverse exact) |
| 11 | Traçabilité | `entries.test.ts` (audit), `regressions.test.ts` (journal append-only) |
| 12 | Isolation multi-société | `companies.test.ts`, `regressions.test.ts` (trigger société sur pièces jointes) |
| 13 | Migrations PostgreSQL | `migrations.test.ts`, CI « migrations » (double exécution) |
| 14 | Sécurité | `auth.test.ts` (401/403, rôles, langue), `regressions.test.ts` (sessions invalidées, signature de fichier) |
| 15 | Interface / langue / exports | `reports.test.ts` (CSV, PDF, langue), tests navigateur **fournis mais non exécutés** |

## 4. Tests de non-régression V0.1.1 (17)

1. période comptable créée même sans plan comptable de démonstration ;
2. renumérotation d'un brouillon changeant de journal/exercice ;
3. taux obligatoire lors d'un passage en devise étrangère ;
4. retour à la devise fonctionnelle sans taux ;
5. devise non supportée refusée ;
6. plus de 4 décimales refusées ;
7. montant converti s'arrondissant à zéro refusé ;
8. références uniques (insensible à la casse, par société) ;
9. bilan équilibré lorsque la période commence en milieu d'historique ;
10. comptes désactivés conservés dans le grand livre ;
11. neutralisation des formules dans les CSV ;
12. double contrepassation refusée ;
13. validation d'un brouillon avec compte désactivé refusée ;
14. signature binaire des pièces jointes vérifiée + suppression du fichier avec le brouillon ;
15. isolation société et append-only vérifiés directement en SQL ;
16. invalidation des sessions après changement de mot de passe ;
17. taux inverse exact (8 décimales) et taux invalide en HTTP 400.

## 5. Tests de concurrence (PostgreSQL réel)

| Test | Attendu |
|---|---|
| 8 écritures simultanées dans le même journal | 8 numéros distincts, format `SAL-AAAA-0001` |
| 2 contrepassations simultanées | exactement une réussite (201), une en conflit (409), une seule ligne en base |
| 2 écritures simultanées avec la même référence | une seule acceptée |
| Balance après écritures parallèles | équilibrée |

Ces tests sont **ignorés** lorsque `TEST_DATABASE_URL` n'est pas défini (PGlite est mono-connexion)
et s'exécutent dans la tâche CI `postgres-tests`.

## 6. Ce qui n'est PAS testé (limites assumées)

- **Aucun test navigateur exécuté** : environnement sans Chromium (voir `docs/browser-tests.md`).
  Les 10 scénarios Playwright sont fournis, non exécutés, donc **non validés**.
- Pas de test de charge ni de test de montée en charge.
- Pas de test d'accessibilité automatisé (WCAG) — seule une revue manuelle des modales/navigation.
- Pas de test de restitution après sinistre (sauvegarde/restauration) : procédure documentée
  seulement.
