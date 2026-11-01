# Mission 40 — audit et correction des thèmes Light / Dark

**COMPTAI · branche `arena/e1f93b22-mauritius-compta` · 1er novembre 2026**

## 1. Résumé

La Mission 40 rend lisibles les deux thèmes sur l’ensemble des modules sans modifier le métier. Le travail a consisté à :

- inventorier et mesurer la palette existante avant toute correction ;
- consolider la palette sémantique dans **un seul** bloc `:root` et son bloc `[data-theme='dark']` ;
- corriger les contrastes insuffisants (texte secondaire, texte blanc sur accent en Dark, bordures de champs, focus) ;
- supprimer les couleurs littérales qui ne fonctionnaient que dans un thème, notamment dans les tableaux comptables, les onglets, les badges, les alertes, les bulletins de paie, la banque, les achats, le lettrage, la migration, l’assistant et les écrans MRA ;
- préserver l’identité visuelle, les libellés, les routes et les composants validés en M39 ;
- livrer des tests de contraste, de parité des tokens et de persistance du thème.

Aucun calcul comptable, aucune écriture, aucun état financier, aucune règle TVA/paie/stock/immobilisation, aucune donnée fictive, aucun mécanisme de sécurité, aucune intégration IA et aucune route validée en M39 n’a été modifié. Aucune dépendance n’a été ajoutée. Aucun déploiement, aucune fusion et aucune publication GitHub Pages.

## 2. Référence et synchronisation

- Dépôt : `azharshahim/mauritius-compta`
- Base : `main` = `0a365d286483eb734c7c54cb3dc15c5e879f981d` (Mission 39, PR nº20 fusionnée)
- Branche : `arena/e1f93b22-mauritius-compta`
- Vérification initiale : branche à 0 commit d’avance / 0 commit de retard sur `origin/main`, working tree propre.
- Les améliorations M39 (navigation contextuelle, rail compact, barre rapide mobile, Guided Demo) sont conservées.

## 3. Audit préalable

L’audit complet se trouve dans `docs/comptai-light-dark-accessibility-audit.md`. Il a été réalisé avant correction sur `styles.css` et les composants `.tsx`.

Points saillants vérifiés sur la base `0a365d2` :

| Constat | Mesure avant |
|---|---:|
| `--muted` sur `--bg` (Light) | 4,35:1 |
| `--muted` sur `--surface-3` (Light) | 4,24:1 |
| Texte blanc sur `--accent` (Dark) | 2,58:1 |
| Bordure de champ (Light) | 1,23:1 |
| Bordure de champ sur `--surface-3` (Dark) | 1,17:1 |
| Focus sur la barre latérale navy | 2,47:1 |
| `#647684` sur `#f3f7f8` (bulletin) | 4,36:1 |

Deux sources de vérité coexistaient (`:root` en tête de fichier et `:root` « mission 28 »). Des surcharges Dark trop spécifiques écrasaient les états actifs des onglets et les boutons danger/secondaire. Deux écrans portaient encore des couleurs en ligne (`#eef4fb`, `#f2f8ff`).

## 4. Corrections apportées

### 4.1 Architecture

- **Un seul** bloc `:root` de tokens, complété par **un seul** bloc `[data-theme='dark']`.
- Nouveaux tokens sémantiques, dans la continuité des noms existants :
  - `--danger-border`, `--success-border`, `--warning-border`, `--info`, `--info-bg`, `--info-border` ;
  - `--text-on-accent`, `--text-on-danger` ;
  - `--border-control`, `--focus-ring`, `--focus-ring-on-dark` ;
  - `--overlay`, `--selection-bg`, `--selection-border`, `--row-overdue-bg` ;
  - `--paper-bg`, `--paper-text`, `--paper-heading`, `--paper-muted`, `--paper-subtle`, `--paper-border`, `--paper-rule`, `--paper-warning`.
- `--muted` Light passe de `#64748b` à `#55657a` ; il atteint 5,45:1 sur `--bg`.
- Les valeurs de secours littérales des `var(...)` ont été supprimées ; les déclarations de couleur littérale passent de 177 à 38 (toutes intentionnelles).
- `theme.ts` centralise la lecture, l’écriture et l’application de `mc.theme` ; **aucune nouvelle clé de stockage**, aucun second mécanisme de thème. `main.tsx` et `App.tsx` l’utilisent ; l’application du thème se fait avant peinture via `useLayoutEffect`, avec mise à jour de `meta[name="theme-color"]`.

### 4.2 Composants et états

- Boutons : primaire (`--text-on-accent`), danger (`--text-on-danger`), secondaire, ghost et link corrigés en Dark.
- Onglets `.tabs`, `.bank-tab`, `.purchase-tab`, `.bulk-filter`, `.module-tab` : états actifs conservés en Dark avec fond, bordure et contraste.
- Champs, selects, textarea, checkboxes/radios, dates : bordure `--border-control`, focus `--focus-ring`, placeholders sur `--muted` avec `opacity: 1` (lisibles dans les deux thèmes).
- Tableaux : en-têtes sur `--muted` corrigé, survol `--row-hover`, totaux `tr.total-row` tokenisés, sélections `--selection-bg` / `--selection-border`.
- Messages : `.alert-danger` / `.alert-error`, `.alert-warning` / `.alert-warn`, `.alert-success`, `.alert-info`, `.banner-info`, `.banner-warning`, `.field-error`.
- Statuts : badges neutre/succès/avertissement/danger/info ; aucune information critique ne repose sur la couleur seule (chaque badge ou ligne en retard porte un libellé ou une valeur textuelle).
- Focus : règle globale 2 px / offset 2 px ; `--focus-ring-on-dark` sur la barre latérale et les héros toujours sombres.
- `Statements.tsx` : en-têtes de section via `.statement-section` (`--surface-3`, `--text`).
- `Companies.tsx` : ligne courante via `.company-row-current` (`--selection-bg`, barre `--selection-border`, badge « current »).
- Bulletins de paie : palette `--paper-*` constante ; le document reste blanc à l’impression et en Dark, avec `--paper-muted` à 5,48:1 sur `--paper-subtle`.

### 4.3 Périmètre métier

Les seuls changements `.tsx` hors thème sont deux attributs `className` (`Statements.tsx`, `Companies.tsx`). Aucun montant, libellé, calcul, format monétaire, itinéraire ou donnée n’a changé.

## 5. Résultats de contraste

Les valeurs complètes et les combinaisons testées sont dans `docs/comptai-theme-contrast-tests.md`.

| Combinaison | Avant | Après |
|---|---:|---:|
| `--muted` / `--bg` (Light) | 4,35 | **5,45** |
| `--muted` / `--surface-3` (Light) | 4,24 | **5,30** |
| Texte sur accent (Dark) | 2,58 | **7,39** |
| Bordure de champ (Light) | 1,23 | **3,72** |
| Bordure de champ / `--surface-3` (Dark) | 1,17 | **3,33** |
| Focus sur navy | 2,47 | **7,92** |
| Bulletin : texte secondaire sur fond teinté | 4,36 | **5,48** |

Tous les couples texte/fond des tokens principaux atteignent 4,5:1 ou mieux ; les limites de composants et le focus atteignent 3:1 ou mieux.

## 6. Tests et validation réels

| Contrôle | Résultat |
|---|---|
| `npm run typecheck` (API + Web) | **0 erreur** |
| `npm run test -w @mc/web` | **382 tests réussis / 382, 57 fichiers** (dont 12 nouveaux tests Mission 40) |
| `npm run test -w @mc/api` | **521 réussis, 11 ignorés** (35 fichiers réussis, 1 ignoré) |
| `npm run build` | succès — JS 1 271,79 kB (316,08 gzip), CSS 77,92 kB (14,86 gzip) |
| `npm run build:demo` | succès — JS 1 300,54 kB, CSS 77,92 kB |
| `verify-demo --dist apps/web/dist --base /mauritius-compta/` | **50/50 contrôles réussis** |
| M39 | `mission36-ui`, `mission37-guided-demo`, `mission38-ui`, `mission39-*` et les contrats de navigation restent verts |

Les tests dédiés sont :

- `apps/web/tests/mission40-theme-contrast.test.ts` (9 tests) : parité des tokens, contrastes, bordures, focus, états actifs ;
- `apps/web/tests/mission40-theme-ui.test.tsx` (3 tests) : préférence, navigation, remontage, panneau ouvert.

Aucune assertion métier n’a été supprimée ou assouplie pour obtenir ces résultats.

## 7. Non-régression M39

Contrats conservés et revérifiés :

- `/accounting/trial-balance` → `['nav.group.accounting', 'nav.trialBalance']` ;
- `/accounting/assets?tab=reports` → `['nav.group.accounting', 'nav.fixedAssets', 'fa.tab.reports']` ;
- `/accounting/banking?tab=transactions` → `['nav.group.bank', 'nav.bank.reconciliation']` ;
- `/accounting` et `/cabinet` restent sans bouton Back ;
- barre latérale 264 px ≥ 1280 px, rail 72 px entre 901 et 1279 px, tiroir ≤ 900 px ;
- barre rapide mobile : Dashboard / Accounting / Banking / [Guided Demo] / Menu ;
- `mc.guidedTour.v1`, 16 étapes, 14 destinations ;
- libellés professionnels et clés `mc.*` inchangés.

## 8. Limites

- **Aucun navigateur réel** : Playwright n’a pas de navigateur installé dans cet environnement. Aucune capture comparative, aucun test visuel sur Safari iPhone ou Chrome Android physique n’a été réalisé. Le rapport ne prétend pas le contraire.
- jsdom ne calcule pas les couleurs, les dégradés, les polices rendues ni la mise en page. Les validations responsive restent celles de M39 (jsdom) ; aucune nouvelle preuve visuelle n’est revendiquée.
- Les contrastes sont calculés sur les valeurs CSS déclarées. Les dégradés sont évalués sur leur couleur de base.
- Les contrôles désactivés restent volontairement atténués (opacité 0,55) : WCAG exempte les contrôles désactivés, mais ils restent identifiables et non trompeurs.

## 9. Risques de régression et parades

| Risque | Parade |
|---|---|
| Une future couleur littérale réintroduit un thème cassé | test de parité + test des tokens + suppression des valeurs de secours |
| Une surcharge Dark écrase un état actif | test explicite des sélecteurs `.tabs a.active`, `.bank-tab.active`, `.purchase-tab.active`, `.btn-danger` |
| Le thème n’est pas réappliqué au rechargement | test de remontage avec `localStorage` conservé |
| Un panneau ouvert se ferme ou perd son thème | test du panneau assistant pendant la bascule |
| La palette papier du bulletin est thémée par erreur | tokens `--paper-*` invariants + test dédié |
| Les formats monétaires changent | aucun changement de logique ; seules des classes CSS et des variables ont été modifiées |

## 10. Fichiers modifiés

- `apps/web/src/styles.css` — palette unique, tokens d’état, contrastes, focus, palette papier, corrections Dark.
- `apps/web/src/theme.ts` — **nouveau** : lecture/écriture/application de la préférence existante.
- `apps/web/src/App.tsx` — utilisation de `theme.ts`, application avant peinture.
- `apps/web/src/main.tsx` — anti-flash via `theme.ts`.
- `apps/web/src/pages/Statements.tsx` — en-têtes de section tokenisés.
- `apps/web/src/pages/Companies.tsx` — ligne courante tokenisée.
- `apps/web/tests/mission40-theme-contrast.test.ts` — **nouveau**.
- `apps/web/tests/mission40-theme-ui.test.tsx` — **nouveau**.
- `docs/comptai-light-dark-accessibility-audit.md`, `docs/comptai-theme-contrast-tests.md`, `docs/mission-40-report.md`.

## 11. Livraison

- Branche : `arena/e1f93b22-mauritius-compta`, synchronisée avec `main` (`0a365d2`) avant travaux.
- PR : **brouillon**, ouverte depuis cette branche ; lien et numéro consignés dans la conversation et dans la PR.
- Aucune fusion, aucune publication GitHub Pages, aucun déploiement OVH.
- En attente de la vérification par ChatGPT et de l’autorisation explicite de l’utilisateur.

## 12. Critères d’acceptation

| Critère | État |
|---|---|
| Textes utiles lisibles en Light et en Dark | satisfait — contrastes mesurés et testés |
| Tableaux comptables exploitables | satisfait — en-têtes, totaux, sélections, montants alignés |
| Menus, onglets et formulaires contrastés et cohérents | satisfait — tokens + états actifs + focus |
| Statuts et messages compréhensibles | satisfait — texte + fond + bordure, jamais la couleur seule |
| Couleurs gérées centralement | satisfait — un `:root`, littéraux résiduels intentionnels |
| Thème mémorisé | satisfait — `mc.theme`, testé après navigation et remontage |
| M39 préservée | satisfait — contrats et suites M39 vertes |
| Tests verts | satisfait — 382 Web, 521 API, builds et démo |
| Aucun calcul ni donnée modifié | satisfait — seules des classes/couleurs et le helper de thème |
