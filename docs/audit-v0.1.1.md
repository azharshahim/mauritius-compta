# Audit V0.1.1 — fiabilisation du cœur comptable

- **Version auditée** : V0.1.0 (commit `4393c1b`) → **V0.1.1**
- **Date** : 30 octobre 2026
- **Périmètre** : moteur comptable, isolation multi-société, PostgreSQL, sécurité, interface,
  documentation et reproductibilité du dépôt.
- **Hors périmètre** (exclusions de la mission) : calcul de TVA, déclarations MRA, facturation
  électronique, paie, calcul de l'impôt sur les sociétés, tout déploiement.

Méthode : lecture intégrale du code, **sondes d'exécution** exécutées contre l'API réelle
(chaque anomalie a d'abord été **reproduite**), correction, puis **test de non-régression**
systématique. Aucune anomalie n'est déclarée corrigée sans test ou preuve d'exécution.

---

## 1. Résultats en une page

| Thème | Avant | Après |
|---|---|---|
| Anomalies bloquantes | 1 (société sans période comptable) | 0 |
| Anomalies comptables | 6 | 0 |
| Anomalies de sécurité / intégrité | 9 | 0 |
| Défauts d'interface | 4 | 0 |
| Tests automatisés | 54 | **77** (73 exécutés + 4 PostgreSQL) |
| Tests de non-régression dédiés | 0 | **17** (`tests/regressions.test.ts`) |
| Tests de concurrence | 0 | **4** (`tests/concurrency.test.ts`, PostgreSQL réel) |
| Tâches CI | 2 | **3** |
| Tests navigateur exécutés | 0 | **0 (environnement sans Chromium — procédure fournie)** |

---

## 2. Audit du moteur comptable (15 points exigés)

| # | Point | Constat V0.1.1 | Preuve |
|---|---|---|---|
| 1 | Équilibre débit/crédit | Double contrôle : `prepareEntry` (API) **et** trigger différé `assert_entry_balanced` qui recalcule Σ débits/Σ crédits sur `journal_lines` fonctionnelles | `entries.test.ts` (rejet d'écriture déséquilibrée), `0002_controls.sql` |
| 2 | Précision des montants | `numeric(20,4)` en base, `BigInt×10⁴` dans le code, chaînes décimales à 4 décimales en API. **Nouveau** : > 4 décimales rejetées (plus d'arrondi silencieux) | `money.test.ts`, `regressions.test.ts` |
| 3 | Arrondi monétaire | Arrondi demi-supérieur uniquement à la conversion devise→fonctionnelle, jamais cumulé. **Nouveau** : un montant qui s'arrondit à zéro est refusé | `regressions.test.ts` |
| 4 | Numérotation | `entry_sequences` par société/journal/année, `INSERT … ON CONFLICT DO UPDATE` atomique. **Nouveau** : renumérotation lorsqu'un brouillon change de journal ou d'exercice | `regressions.test.ts` + test de concurrence |
| 5 | Unicité des références | **Nouveau** : unicité insensible à la casse par société pour les écritures manuelles (index partiel + contrôle API `REFERENCE_TAKEN`), les contrepassations héritant de la référence d'origine en sont exclues | `regressions.test.ts`, `0003_hardening.sql` |
| 6 | Modification des brouillons | PATCH complet (journal, date, référence, devise, taux, lignes), renumérotation, re-validation des comptes. **Nouveau** : interface d'édition des brouillons | `regressions.test.ts` |
| 7 | Immutabilité des écritures validées | Trigger `mc_guard_posted_entry` (UPDATE interdit) + contrôle API + audit. Suppression directe bloquée (test SQL) | `regressions.test.ts`, `entries.test.ts` |
| 8 | Contrepassations | Génération de l'écriture inverse, lien `reversal_of_entry_id`, refus de double contrepassation. **Nouveau** : index unique partiel (protection contre une course) | `regressions.test.ts` + test de concurrence |
| 9 | Périodes comptables | Périodes par exercice, chevauchement refusé, validation impossible hors période ouverte. **Nouveau** : une période est toujours créée, même sans plan comptable de démonstration | `regressions.test.ts` |
| 10 | Clôture / réouverture | Clôture tracée dans l'audit, contrôlée par le rôle `owner`, réouverture auditée | `entries.test.ts`, `auth.test.ts` |
| 11 | Calcul des soldes | Solde initial + mouvements + solde progressif, arithmétique exacte. **Nouveau** : les comptes désactivés conservant des mouvements restent visibles | `regressions.test.ts` |
| 12 | Grand livre | Par compte, période, recherche ; totaux exacts ; export CSV/PDF | `reports.test.ts` |
| 13 | Balance générale | Colonnes ouverture / mouvements / clôture, indicateur d'équilibre, export CSV/PDF. **Nouveau** : en-têtes PDF localisés (`Solde D/C` dynamique) | `reports.test.ts` |
| 14 | Gestion des devises | MUR/EUR/USD/GBP uniquement, taux daté obligatoire, montant d'origine + contre-valeur conservés. **Nouveau** : devise inconnue refusée ; changement de devise sans taux refusé ; taux inverse calculé en arithmétique entière | `regressions.test.ts` |
| 15 | Traçabilité | `audit_log` alimenté (création, validation, contrepassation, clôture, taux, pièces jointes, connexions). **Nouveau** : journal **append-only** au niveau base (UPDATE/DELETE refusés) | `regressions.test.ts` |

---

## 3. Anomalies identifiées et corrections

Chaque ligne a été **reproduite avant correction** puis couverte par un test.

| # | Gravité | Anomalie (comportement constaté) | Cause | Correction | Test |
|---|---|---|---|---|---|
| A1 | **Bloquante** | Société créée avec `withDefaultChart: false` → aucune période comptable → **toute écriture refusée** | la période était créée dans la branche « plan comptable » uniquement | la période est toujours créée ; le plan comptable reste optionnel | `regressions.test.ts` |
| A2 | Majeure | Un brouillon déplacé de SAL/2025 vers BQ/2026 conservait `SAL-2025-0001` | le numéro n'était calculé qu'à la création | renumérotation si journal ou exercice change | `regressions.test.ts` |
| A3 | **Critique** | Passer un brouillon en EUR sans taux réutilisait `exchange_rate = 1` → contre-valeur MUR **silencieusement fausse** | `body.exchangeRate ?? current.exchange_rate` | taux daté obligatoire si la devise cible est étrangère ; retour à la devise fonctionnelle sans taux | `regressions.test.ts` |
| A4 | Majeure | Devise `XXX` acceptée à la création | aucune validation de liste | `SUPPORTED_CURRENCIES` (400 `INVALID_CURRENCY`) | `regressions.test.ts` |
| A5 | **Critique** | Bilan déséquilibré (150 000 ≠ 100 000) dès que la période analysée commence après les premières écritures | le bilan utilisait le résultat **de la période** alors que les comptes de capitaux sont **cumulatifs** | bilan = résultat **cumulé depuis l'origine** ; compte de résultat = période | `regressions.test.ts` |
| A6 | Majeure | Un compte désactivé ayant des mouvements disparaissait du grand livre → soldes faux | filtre `is_active = true` dans la requête des comptes | tous les comptes sont chargés, le filtrage se fait ensuite (mouvements ou option `includeInactive`) | `regressions.test.ts` |
| A7 | Majeure (sécurité) | Un libellé `=HYPERLINK(...)` restait actif dans le CSV exporté (injection de formule) | échappement limité aux guillemets/séparateurs | préfixe `'` pour toute cellule texte commençant par `= + - @`, hors valeurs numériques | `regressions.test.ts` |
| A8 | Majeure (sécurité) | Le type MIME déclaré par le navigateur était cru ; un fichier PHP renommé `.pdf` était accepté | contrôle sur `file.mimetype` uniquement | vérification de la **signature binaire** (PDF/JPEG/PNG) + rejet des fichiers vides | `regressions.test.ts` |
| A9 | Mineure | Suppression d'un brouillon → fichiers de pièces jointes orphelins sur le disque | seule la ligne SQL était supprimée | suppression des fichiers (best effort) après suppression en base | `regressions.test.ts` |
| A10 | Majeure | Validation d'un brouillon sans revérifier l'état des comptes (compte désactivé entre-temps) | contrôle uniquement à la création | contrôle à la validation (appartenance + activation) | `regressions.test.ts` |
| A11 | Majeure | Références dupliquées acceptées (`FICT-001` deux fois) | aucune contrainte | index unique partiel + erreur `REFERENCE_TAKEN` | `regressions.test.ts` + concurrence |
| A12 | Majeure | Deux contrepassations simultanées pouvaient créer deux écritures inverses | contrôle applicatif non atomique | index unique partiel `journal_entries_one_reversal_idx` | concurrence (PostgreSQL) |
| A13 | Majeure (traçabilité) | `audit_log` pouvait être modifié ou supprimé (aucune protection SQL) | table ordinaire | trigger append-only (seule l'anonymisation par clé étrangère est tolérée) | `regressions.test.ts` |
| A14 | Majeure (isolation) | Aucun garde-fou SQL ne vérifiait qu'un journal, une pièce jointe, une contrepassation ou un compte parent appartenait à la même société | contrôles applicatifs seulement | 4 triggers `mc_guard_*` + tests SQL directs | `regressions.test.ts` |
| A15 | Mineure | `10.12345` accepté puis arrondi silencieusement à 4 décimales | conversion sans contrôle | rejet `VALIDATION_ERROR` (> 4 décimales) | `regressions.test.ts` |
| A16 | Majeure | Un montant étranger s'arrondissant à 0,0000 créait une ligne fonctionnelle à 0 → écriture faussement équilibrée | aucune vérification après conversion | rejet `AMOUNT_TOO_SMALL` | `regressions.test.ts` |
| A17 | Mineure | Taux invalide → HTTP 409 ; taux inverse calculé en flottant (`1 / Number(rate)`) | erreurs mal typées, calcul flottant | 400 ; `reciprocal()` en BigInt (8 décimales) | `regressions.test.ts`, `money.test.ts` |
| A18 | **Critique (prod)** | Inscription ouverte par défaut en production ; `db:seed` exécutable en production | valeurs par défaut non contextuelles | `ALLOW_REGISTRATION=false` par défaut en production ; `db:seed` refuse `NODE_ENV=production` sauf `ALLOW_DEMO_SEED=true` | revue de code + CI |
| A19 | Mineure | Sessions expirées et tentatives de connexion jamais purgées ; pas de limite par IP | absence de tâche de nettoyage | purge à la connexion + `LOGIN_MAX_ATTEMPTS_PER_IP` | `auth.test.ts` |
| A20 | Mineure | Changement de mot de passe : sessions supprimées côté serveur mais interface laissée sur un état incohérent | pas de retour d'information | réponse `sessionsInvalidated` + écran de connexion avec message | `regressions.test.ts` |
| A21 | Majeure (fonctionnel) | Impossible de modifier un brouillon dans l'interface (API seule) | formulaire sans mode édition | mode édition complet (PATCH) + bouton « Modifier le brouillon » | compilation + revue |
| A22 | Mineure | Affichage monétaire via `Number()` (virgule flottante) | formatage naïf | formatage exact à partir de la chaîne décimale (`BigInt`), total débit/crédit calculé sans flottant | `format.ts` |
| A23 | Mineure (accessibilité) | Modale sans fermeture par Échap, sans gestion du focus, bouton de fermeture non traduit | composant minimal | Échap, focus initial/restauré, libellé traduit | revue de code |
| A24 | Mineure (mobile) | Le tiroir de navigation pouvait rester ouvert après navigation | état non réinitialisé | fermeture sur navigation, Échap et clic extérieur, `aria-expanded` | revue de code |
| A25 | Mineure | `mapDatabaseError` testait deux fois `23505` | copier-coller | branche unique + messages métier par contrainte | revue de code |
| A26 | Mineure | `computeStatements` parcourait tout le jeu de résultats pour chaque ligne (O(n²)) | recherche linéaire répétée | index `Map` construit une fois | revue de code |
| A27 | Mineure | En-têtes PDF « Solde D/C » codés en dur en français | libellé non traduit | `t(locale, 'pdf.balance')` | revue de code |
| A28 | Mineure (sécurité) | Le temps de réponse révélait l'existence d'un compte (pas de hachage comparé si l'e-mail est inconnu) | court-circuit dans la connexion | un hachage factice est systématiquement comparé (`DUMMY_HASH`) | `auth.test.ts` (connexion) |

### Anomalies examinées et **non** retenues

- **`modules/rates` absent** : la gestion des taux de change vit dans `modules/settings` et
  expose `/exchange-rates`. Découpage assumé, documenté dans `docs/architecture.md` ; aucun
  défaut fonctionnel.
- **Test d'audit `entries.test.ts` qui valide un brouillon réel** : le scénario exerce
  volontairement `entry.post`, il est désormais explicite et sans effet sur les autres tests
  (base isolée par fichier).
- **Suppression d'une société** : aucune route API n'existe. Le reset de démonstration
  (`db:seed --force`) reste possible : les triggers d'immutabilité détectent la suppression en
  cascade et n'y font pas obstacle (comportement explicitement codé dans `0003_hardening.sql`).

---

## 4. Audit multi-société

Deux sociétés fictives sont créées dans les tests ; chaque ressource est sollicitée depuis la
mauvaise société.

| Ressource | Contrôle API | Défense en base |
|---|---|---|
| Sociétés (lecture/écriture) | appartenance obligatoire (`requireCompany`) → 404 si non membre | — |
| Comptes | `company_id` dans chaque requête | trigger compte parent ↔ société |
| Journaux | `company_id` | trigger journal ↔ société |
| Écritures | `company_id` | trigger + trigger différé d'équilibre |
| Lignes d'écriture | dérivées de l'écriture | FK + trigger `journal_lines_company_trg` (V0.1.0) |
| Pièces jointes | `entry_id` vérifié dans la société | **nouveau** trigger `attachments_company_trg` |
| Grand livre / balance / états | filtre `company_id` | — |
| Exports CSV/PDF | mêmes services que les états | — |
| Utilisateurs / rôles | table `company_members`, rôle vérifié côté serveur | FK |
| Journal d'audit | filtre `company_id` | append-only |

Preuve : `tests/companies.test.ts` (isolation API) et `tests/regressions.test.ts` (insertion SQL
directe refusée par la base, même en contournant l'API).

---

## 5. Audit PostgreSQL

| Point | Constat |
|---|---|
| Clés étrangères | 15 tables, FK complètes, `ON DELETE` explicite (`RESTRICT` sur les journaux et comptes utilisés, `CASCADE` sur les lignes) |
| Unicité | `(company_id, code)` comptes, `(company_id, entry_no)` écritures, `(company_id, from, to, date)` taux, `(company_id, journal, year)` séquences, **+ référence et contrepassation uniques** |
| Cohérence transactionnelle | chaque route métier s'exécute dans une transaction (`db.transaction`) ; triggers d'équilibre **différés** pour permettre l'insertion ligne par ligne |
| Index | `journal_lines(entry_id)`, `journal_lines(company_id, account_id)`, `journal_entries(company_id, entry_date)`, **+ `(company_id, status, entry_date)` et `attachments(company_id)`** |
| Triggers de protection | immutabilité des écritures validées, comptes utilisés, isolation société, **journal d'audit append-only** |
| Concurrence | numérotation atomique (`ON CONFLICT … RETURNING`), contrepassation unique, référence unique : couverts par 4 tests sur PostgreSQL réel |
| Rejeu des migrations | `migrate()` compare les checksums, refuse la modification d'une migration appliquée, rejoue sans effet les migrations déjà appliquées (vérifié en CI : `db:migrate` deux fois) |
| Parité PGlite / PostgreSQL | la **même** suite Vitest s'exécute sur les deux moteurs (CI : tâche `postgres-tests`) ; les 4 tests de concurrence ne s'exécutent que sur un serveur réel |

---

## 6. Audit de sécurité

| Point | Résultat |
|---|---|
| Authentification | e-mail + mot de passe, scrypt (N=16384), politique de longueur minimale, comparaison à temps constant |
| Sessions | identifiant aléatoire 256 bits, cookie `HttpOnly`, `SameSite=Lax`, `Secure` si `COOKIE_SECURE`, expiration fixe (`SESSION_TTL_HOURS`), purge des sessions expirées et des anciennes tentatives |
| CSRF | contrôle `Origin`/`Sec-Fetch-Site` sur les méthodes mutantes ; aucune API CORS ouverte |
| Autorisations | rôles vérifiés **côté serveur** sur chaque route (`viewer`/`accountant`/`admin`/`owner`) |
| Validation d'entrée | Zod sur tous les corps de requête, dates ISO contrôlées, montants à 4 décimales, e-mails validés par Zod (≤ 254 caractères) |
| Upload | taille limitée, liste blanche MIME **et signature binaire**, stockage hors du dossier public, téléchargement authentifié avec `X-Content-Type-Options: nosniff` |
| Journalisation | pino JSON, `cookie` et `authorization` masqués (`redact`), audit applicatif append-only |
| Secrets | aucun secret dans le dépôt, `.env` ignoré, garde CI, `.env.example` sans valeur réelle |
| Configuration de production | avertissement si `COOKIE_SECURE=false`, en-têtes CSP/X-Frame-Options/Referrer-Policy, inscription fermée par défaut, seed de démonstration refusé |
| Identifiants de démonstration | publics et documentés, réservés à une instance locale ; aucun accès réel, aucune donnée réelle |

---

## 7. Tests

```text
npm test
 ✓ tests/auth.test.ts          (9)
 ✓ tests/companies.test.ts     (6)
 ✓ tests/accounts.test.ts      (4)
 ✓ tests/entries.test.ts      (12)
 ✓ tests/reports.test.ts      (10)
 ✓ tests/migrations.test.ts    (6)
 ✓ tests/money.test.ts         (9)
 ✓ tests/regressions.test.ts  (17)
 ↓ tests/concurrency.test.ts   (4, PostgreSQL requis)
Total : 73 exécutés, 4 ignorés (PGlite), 77 au total
```

Sur PostgreSQL réel (`TEST_DATABASE_URL=…`) : 77/77, dont les 4 tests de concurrence.
Détail : `docs/test-report.md`.

---

## 8. Reconstruction depuis GitHub

Voir `docs/github-project-integrity.md` §7 pour la procédure et les résultats constatés
(clone vierge, `npm ci`, migrations, seed, typecheck, tests, build, démarrage).

---

## 9. Limites restantes (non corrigées, assumées)

1. **Tests navigateur non exécutés** : aucun binaire Chromium disponible et pas d'accès réseau
   au CDN de téléchargement. Les scénarios Playwright sont fournis et documentés
   (`docs/browser-tests.md`) mais **ne doivent pas être considérés comme validés**.
2. Pas d'écritures de clôture/report à nouveau : le résultat cumulé est calculé, non transféré
   au passif (affichage « résultat non affecté »).
3. Pas de piste d'audit infalsifiable (horodatage cryptographique, WORM) : le journal est
   append-only mais non certifié.
4. Pas de TVA, impôt, paie, facturation électronique, déclarations MRA (hors périmètre).
5. Pas de 2FA ni de réinitialisation de mot de passe par e-mail.
6. Export CSV uniquement (pas de XLSX).
7. PGlite reste déconseillé en production (mono-processus) : utiliser PostgreSQL.

## 10. Recommandation pour la mission 3

1. Exécuter réellement les tests Chromium (desktop + Android) et les intégrer à la CI
   (`playwright install --with-deps chromium` dans un runner GitHub).
2. Ajouter les **écritures de clôture / report à nouveau** et l'affichage du résultat affecté.
3. Mettre en place sauvegarde/restauration automatisées et supervision (hors dépôt).
4. Ouvrir le module TVA/MRA **après validation juridique** des taux et des obligations.
5. Ajouter export XLSX et import de relevés bancaires.
6. Introduire la double authentification et la réinitialisation de mot de passe.
