# Mission 2 — V0.1.1 : audit, fiabilisation, publication intégrale

Rapport final — 30 octobre 2026. Dépôt : `azharshahim/mauritius-compta`.

> Aucun déploiement, aucune fusion de PR, aucune donnée réelle, aucun secret publié.
> Le propriétaire décide seul de la fusion et de la mise en ligne.

## 1. Pull request

- **PR #1** (brouillon, non fusionnée) — <https://github.com/azharshahim/mauritius-compta/pull/1>
  → base `main`, tête `arena/b0b62798-mauritius-compta`.
- **PR #2 demandée par la mission (base = branche de la PR #1) : impossible.**
  La branche de travail imposée par l'environnement *est* celle de la PR #1 ; GitHub refuse une
  PR dont la base et la tête sont identiques :
  `GraphQL: No commits between arena/b0b62798-mauritius-compta and arena/b0b62798-mauritius-compta`.
  Solution proposée (sans toucher `main`) : lorsque le propriétaire aura fusionné ou fermé la
  PR #1, créer `feature/v0.1.1-hardening` depuis ce commit et ouvrir la PR #2 vers la branche de
  la PR #1 ; en attendant, les commits sont isolés par message (`fix`, `test`, `feat`, `ci`, `docs`).

## 2. Branche de travail

`arena/b0b62798-mauritius-compta` — branche imposée par l'environnement (impossible de créer une
branche distincte). Tous les commits de la mission y sont poussés.

## 3. Dernier commit

Voir `git log -1` sur la branche (dernier commit de documentation de ce rapport).

## 4. Synthèse de l'audit

| Domaine | Conclusions |
|---|---|
| Moteur comptable (15 points) | 1 anomalie bloquante, 6 anomalies comptables, toutes corrigées et couvertes par un test |
| Isolation multi-société | correcte côté API ; renforcée par 4 triggers SQL (journal, contrepassation, pièce jointe, compte parent) |
| PostgreSQL | FK/unicité/atomicité conformes ; ajout d'index uniques (référence, contrepassation), d'index de reporting et d'un journal d'audit append-only ; migrations rejouables (checksums) |
| Sécurité | sessions, CSRF, rôles serveur et validation solides ; faiblesses corrigées (signature des fichiers, injection CSV, purge des sessions, limitation par IP, valeurs par défaut de production) |
| Interface | 4 défauts corrigés (édition des brouillons absente, montants en flottant, modales non accessibles, tiroir mobile persistant) |
| Reproductibilité | clone vierge → installation → migrations → seed → tests → build → démarrage : **vérifié** |

Détail complet : `docs/audit-v0.1.1.md`.

## 5. Anomalies identifiées

28 anomalies (A1–A28) documentées avec gravité, cause, correctif et test dans
`docs/audit-v0.1.1.md` §3. Les plus significatives :

1. société sans période comptable → aucune écriture possible (bloquante) ;
2. bilan déséquilibré dès que la période analysée commence après les premières écritures ;
3. changement de devise d'un brouillon réutilisant silencieusement le taux précédent ;
4. type de fichier des pièces jointes fondé sur le MIME déclaré ;
5. journal d'audit modifiable et supprimable ;
6. double contrepassation possible en concurrence ;
7. formules CSV actives (injection) ;
8. comptes désactivés disparaissant du grand livre.

## 6. Corrections apportées

- Code : 20 fichiers API, 8 fichiers interface, migration `0003_hardening.sql`.
- Tests : `tests/regressions.test.ts` (17) et `tests/concurrency.test.ts` (4), harnais
  `TEST_DATABASE_URL`.
- CI : 3 tâches (qualité, tests PostgreSQL, migrations PostgreSQL).
- Documentation : README, `docs/audit-v0.1.1.md`, `docs/github-project-integrity.md`,
  `docs/browser-tests.md`, `docs/test-report.md`, `CHANGELOG.md`, `docs/api.md`,
  `docs/architecture.md`, `docs/roadmap.md`.

## 7. Résultats des tests

| Exécution | Résultat |
|---|---|
| `npm test` (PGlite, local) | **73 réussis / 4 ignorés** (concurrence) |
| `npm test` (PostgreSQL 16, CI) | **77/77** |
| `npm run typecheck` | ✅ |
| `npm run build` | ✅ |
| CI à 3 tâches | ✅ vertes |

## 8. État GitHub Actions

Trois tâches : `Typecheck, tests and build`, `API tests against real PostgreSQL`,
`Migrations against real PostgreSQL` — **toutes vertes** sur la branche.

## 9. Reconstruction depuis GitHub : confirmée

Clone vierge du dépôt public → `npm ci` → `db:migrate` (3 migrations) → `db:seed` → `typecheck`
→ `npm test` (73 réussis) → `npm run build` → démarrage de l'API depuis le clone
(`/api/health` = `ok`, version `0.1.1`, connexion de démonstration 200). Voir
`docs/github-project-integrity.md` §7.

## 10. Tester dans Chrome

1. `npm ci` puis `npm run db:seed` puis `npm run dev`.
2. Ouvrir <http://localhost:5173>, se connecter avec `demo@mauritius-compta.test` /
   `DemoPassw0rd2026`.
3. Créer une société, ouvrir le plan comptable, saisir une écriture (bouton « Nouvelle écriture »),
   l'enregistrer en brouillon, la rouvrir, cliquer « Modifier le brouillon », puis « Enregistrer
   et valider ».
4. Consulter Grand livre, Balance, États financiers ; exporter en CSV et PDF.
5. Basculer FR ⇄ EN ; tester la largeur mobile (outils de développement → 412 × 915).
6. Tests automatisés navigateur (facultatif) : `npm run test:e2e:install -w @mc/web` puis
   `npm run test:e2e -w @mc/web` (procédure complète : `docs/browser-tests.md`).

## 11. Limites restantes

- **Tests navigateur non exécutés** : aucun binaire Chromium dans l'environnement d'audit ; les
  scénarios sont fournis et documentés mais **non validés**.
- Pas d'écritures de clôture / report à nouveau :
  le résultat cumulé est affiché en « résultat non affecté ».
- Pas de piste d'audit certifiée (append-only applicatif, sans horodatage cryptographique).
- Export CSV uniquement (pas de XLSX).
- Pas de 2FA ni de réinitialisation de mot de passe par e-mail.
- Aucune conformité réglementaire revendiquée : TVA, MRA, e-invoicing, paie et impôt restent hors
  périmètre et marqués « À VÉRIFIER » / « NON IMPLÉMENTÉ ».

## 12. Recommandation pour la mission 3

1. Exécuter réellement les tests Chromium (desktop + Android) et les intégrer à la CI.
2. Implémenter les écritures de clôture et le report à nouveau (résultat affecté).
3. Sauvegardes automatisées, supervision et procédure de restauration testée.
4. Export XLSX et import de relevés bancaires.
5. TVA / MRA **uniquement après validation juridique** des taux et obligations.
6. Double authentification et réinitialisation de mot de passe.
