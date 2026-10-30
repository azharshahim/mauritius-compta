# Journal des versions

## 0.1.1 — 30 octobre 2026 (audit, fiabilisation)

### Corrigé — comptabilité

- **Bilan équilibré en cours d'historique** : le Statement of Financial Position utilisait le
  résultat de la période au lieu du résultat cumulé depuis l'origine (bilan faux dès que la
  période analysée commençait après les premières écritures).
- **Changement de devise d'un brouillon** : un taux daté est désormais exigé ; l'ancien taux
  (souvent 1) n'est plus réutilisé silencieusement.
- **Devises** : seules MUR, EUR, USD et GBP sont acceptées (`INVALID_CURRENCY`).
- **Précision** : les montants à plus de 4 décimales sont refusés au lieu d'être arrondis.
- **Montants convertis** : un montant qui s'arrondit à zéro en devise fonctionnelle est refusé.
- **Numérotation** : un brouillon déplacé vers un autre journal ou exercice est renuméroté.
- **Références** : unicité par société, insensible à la casse (`REFERENCE_TAKEN`).
- **Validation** : les comptes sont revérifiés (société + activation) au moment de la validation.
- **Grand livre** : les comptes désactivés conservant des mouvements restent visibles.
- **Sociétés** : une période comptable est toujours créée, même sans plan comptable de
  démonstration (auparavant aucune écriture n'était possible).
- **Taux de change** : validation en HTTP 400 (au lieu de 409) ; taux inverse calculé en
  arithmétique entière (8 décimales).

### Corrigé — sécurité et intégrité

- **Pièces jointes** : vérification de la signature binaire (PDF/JPEG/PNG) et rejet des fichiers
  vides ; suppression des fichiers lorsqu'un brouillon est supprimé.
- **Injection de formules CSV** : les cellules commençant par `=`, `+`, `-`, `@` sont neutralisées.
- **Contrepassation unique** : index unique partiel (protection contre une course).
- **Isolation société en base** : triggers sur les écritures, contrepassations, pièces jointes et
  comptes parents.
- **Journal d'audit append-only** : modifications et suppressions refusées par PostgreSQL.
- **Sessions** : purge des sessions expirées et des anciennes tentatives, limitation par adresse
  IP en plus du compte, comparaison de hachage systématique à la connexion (anti-énumération).
- **Changement de mot de passe** : toutes les sessions sont invalidées et l'interface invite à se
  reconnecter.
- **Production** : inscription fermée par défaut, `db:seed` refusé (sauf `ALLOW_DEMO_SEED=true`).

### Amélioré — interface

- Édition des brouillons depuis l'interface (bouton « Modifier le brouillon »).
- Formatage monétaire exact (BigInt) et contrôle d'équilibre sans virgule flottante.
- Modales : fermeture par Échap, gestion du focus, bouton de fermeture traduit.
- Navigation mobile : tiroir refermé à la navigation, par Échap ou clic extérieur.
- Messages d'erreur supplémentaires traduits FR/EN.

### Ajouté

- `apps/api/sql/migrations/0003_hardening.sql` (intégrité et index).
- `tests/regressions.test.ts` (17 tests de non-régression).
- `tests/concurrency.test.ts` (4 tests, PostgreSQL réel).
- Tâche CI `API tests against real PostgreSQL`.
- Tests navigateur Playwright + `docs/browser-tests.md` (**non exécutés** dans l'environnement
  d'audit).
- `docs/audit-v0.1.1.md`, `docs/github-project-integrity.md`, `CHANGELOG.md`, `.nvmrc`,
  `.editorconfig`.
- README réécrit : installation Windows/Linux, PostgreSQL, mode démonstration, tests,
  reconstruction, limites réglementaires, dépannage.

### Notes

- Aucun déploiement, aucune fusion de PR : le propriétaire conserve la décision.
- Les règles réglementaires restent marquées « À VÉRIFIER » / « NON IMPLÉMENTÉ ».

## 0.1.0 — 30 octobre 2026

- Première version : sociétés, plan comptable, journaux, écritures, grand livre, balance, états
  financiers provisoires, exports CSV/PDF, FR/EN, migrations PostgreSQL, CI.
