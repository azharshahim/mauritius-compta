# COMPTAI — tests de contraste et de thèmes (Mission 40)

**Date :** 1er novembre 2026  
**Commande principale :** `npm run test -w @mc/web`  
**Suites dédiées :** `apps/web/tests/mission40-theme-contrast.test.ts`, `apps/web/tests/mission40-theme-ui.test.tsx`

## 1. Objectif

Vérifier automatiquement, sans navigateur graphique :

1. que les deux thèmes déclarent le même jeu de tokens de couleur ;
2. que les combinaisons de texte, de statut, de bordure de contrôle et de focus atteignent les seuils WCAG 2.2 AA ;
3. que les états actifs et les composants critiques ne dépendent pas d’une couleur littérale propre à un seul thème ;
4. que la préférence `mc.theme` survit à une navigation et à un remontage (équivalent jsdom d’un rechargement) ;
5. qu’un panneau déjà ouvert reste ouvert et suit le changement de thème.

## 2. Seuils retenus

| Usage | Seuil |
|---|---:|
| Texte normal | 4,5:1 |
| Grande taille (≥ 18,66 px gras ou ≥ 24 px) | 3:1 |
| Limite de composant interactif (champ, bouton, onglet) | 3:1 |
| Indicateur de focus clavier | 3:1 |
| Information importante | ne jamais reposer sur la couleur seule |

Formule utilisée : luminance relative WCAG, puis `(L1 + 0,05) / (L2 + 0,05)` avec `L1` la luminance la plus claire.

## 3. Tokens mesurés

### Light

| Combinaison | Ratio | Résultat |
|---|---:|---|
| `--text` / `--bg` | 15,20 | AA |
| `--text` / `--surface` | 16,61 | AA |
| `--text` / `--surface-2` | 15,88 | AA |
| `--text` / `--surface-3` | 14,79 | AA |
| `--muted` / `--bg` | 5,45 | AA |
| `--muted` / `--surface` | 5,95 | AA |
| `--muted` / `--surface-2` | 5,69 | AA |
| `--muted` / `--surface-3` | 5,30 | AA |
| `--muted` / `--row-hover` | 5,64 | AA |
| `--accent` / `--surface` | 5,17 | AA |
| `--text-on-accent` / `--accent` | 5,17 | AA |
| `--text-on-accent` / `--accent-dark` | 6,70 | AA |
| `--danger` / `--danger-bg` | 6,05 | AA |
| `--success` / `--success-bg` | 5,37 | AA |
| `--warning` / `--warning-bg` | 5,59 | AA |
| `--info` / `--info-bg` | 8,69 | AA |
| `--border-control` / `--surface` | 3,72 | composant |
| `--border-control` / `--surface-3` | 3,31 | composant |
| `--focus-ring` / `--surface` | 6,70 | focus |
| `--focus-ring-on-dark` / `--navy` | 7,92 | focus |

### Dark

| Combinaison | Ratio | Résultat |
|---|---:|---|
| `--text` / `--bg` | 16,35 | AA |
| `--text` / `--surface` | 14,82 | AA |
| `--text` / `--surface-2` | 13,71 | AA |
| `--text` / `--surface-3` | 12,24 | AA |
| `--muted` / `--bg` | 8,51 | AA |
| `--muted` / `--surface` | 7,72 | AA |
| `--muted` / `--surface-2` | 7,14 | AA |
| `--muted` / `--surface-3` | 6,37 | AA |
| `--muted` / `--row-hover` | 6,82 | AA |
| `--accent` / `--surface` | 6,69 | AA |
| `--text-on-accent` / `--accent` | 7,39 | AA |
| `--text-on-accent` / `--accent-dark` | 5,26 | AA |
| `--danger` / `--danger-bg` | 8,15 | AA |
| `--success` / `--success-bg` | 9,59 | AA |
| `--warning` / `--warning-bg` | 9,26 | AA |
| `--info` / `--info-bg` | 10,83 | AA |
| `--border-control` / `--surface` | 4,03 | composant |
| `--border-control` / `--surface-3` | 3,33 | composant |
| `--focus-ring` / `--surface` | 8,27 | focus |
| `--focus-ring-on-dark` / `--navy` | 7,92 | focus |

### Impression et bulletin de paie

La feuille de paie conserve volontairement une identité « papier » blanche dans les deux thèmes. Ses combinaisons sont mesurées séparément :

| Combinaison | Ratio | Résultat |
|---|---:|---|
| `--paper-text` / `--paper-bg` | 14,12 | AA |
| `--paper-muted` / `--paper-subtle` | 5,48 | AA |
| `--paper-warning` / `--paper-bg` | 5,93 | AA |

## 4. Anomalies avant / après

| Anomalie mesurée avant | Ratio avant | Correction | Ratio après |
|---|---:|---|---:|
| `--muted` `#64748b` sur `--bg` | 4,35 | `--muted` `#55657a` | 5,45 |
| `--muted` `#64748b` sur `--surface-3` | 4,24 | `--muted` `#55657a` | 5,30 |
| Texte blanc sur accent dark | 2,58 | `--text-on-accent` `#06101e` | 7,39 |
| Texte blanc sur accent-dark dark | 3,63 | `--text-on-accent` | 5,26 |
| Bordure de champ light | 1,23 | `--border-control` `#74869d` | 3,72 |
| Bordure de champ dark sur `--surface-3` | 1,17 | `--border-control` `#647c9b` | 3,33 |
| Focus sur la barre latérale navy | 2,47 | `--focus-ring-on-dark` `#8ab4ff` | 7,92 |
| `#647684` sur `#f3f7f8` (bulletin) | 4,36 | `--paper-muted` `#536773` | 5,48 |

## 5. Tests automatisés livrés

### `mission40-theme-contrast.test.ts` (9 tests)

- **Parité des tokens** : tous les tokens de couleur du `:root` sont présents dans `[data-theme='dark']`, et inversement. Les invariants `--paper-*`, `--radius*` et `--font` sont explicitement exclus.
- **Palette papier** : `--paper-bg` reste blanc ; les anciens littéraux `#647684`, `#94a3b8` et `#8b9bb0` ne réapparaissent pas.
- **Texte et texte secondaire** : `--text` et `--muted` sont testés sur `--bg`, `--surface`, `--surface-2`, `--surface-3` et `--row-hover`, dans les deux thèmes (≥ 4,5:1).
- **Statuts** : `danger`, `success`, `warning`, `info` sur leur fond teinté (≥ 4,5:1).
- **Actions et focus** : `--text-on-accent` sur `--accent` et `--accent-dark` ; `--focus-ring` et `--border-control` sur les trois surfaces (≥ 3:1) ; `--focus-ring-on-dark` sur le navy.
- **États non chromatiques** : présence de `:focus-visible` à 2 px avec offset, des états actifs d’onglets et des surcharges dark explicites pour `.btn-danger` et les onglets actifs.

Le test lit `apps/web/src/styles.css` depuis le disque. Il échoue donc si une correction de couleur est retirée lors d’une mission ultérieure.

### `mission40-theme-ui.test.tsx` (3 tests)

1. lecture, stockage et application de `mc.theme`, mise à jour de `meta[name="theme-color"]` (`#0b2545` en Light, `#08101d` en Dark) ;
2. bascule Light → Dark, navigation vers Comptabilité, maintien du thème, puis remontage complet avec `localStorage` conservé et document remis en Light : le thème Dark est réappliqué avant le rendu ;
3. ouverture de l’assistant IA, bascule du thème : le panneau `role="dialog"` reste monté, `aria-expanded` reste à `true` et le thème passe en Dark.

### Suites existantes conservées

- `mission28-ui.test.tsx` vérifie déjà la bascule Light/Dark et `localStorage['mc.theme']`.
- `mission39-*`, `mission36-ui`, `mission38-ui`, `i18n-quality`, `input-focus` restent vertes.
- Aucune assertion métier n’a été supprimée ou affaiblie.

## 6. Résultats d’exécution

| Commande | Résultat |
|---|---|
| `npm run typecheck` | 0 erreur (API + Web) |
| `npm run test -w @mc/web` | **57 fichiers, 382 tests réussis** |
| `npm run test -w @mc/api` | **35 fichiers réussis + 1 ignoré, 521 tests réussis, 11 ignorés** |
| `npm run build` | succès — JS 1 271,79 kB (316,08 gzip), CSS 77,92 kB (14,86 gzip) |
| `npm run build:demo` | succès — JS 1 300,54 kB, CSS 77,92 kB |
| `node scripts/verify-demo.mjs --dist apps/web/dist --base /mauritius-compta/` | **50/50 contrôles** |

## 7. Ce que ces tests ne prouvent pas

- **Aucun navigateur réel n’est disponible** : Playwright n’a pas de navigateur installé dans cet environnement. Aucune capture comparative, aucun test Safari iPhone ou Chrome Android physique n’a été produit.
- jsdom ne calcule pas les couleurs effectives, les dégradés, la taille de police rendue ni la mise en page.
- Les tests de contraste portent sur des tokens opaques. Les couleurs `color-mix(...)` (badges) et les dégradés sont vérifiés par leur composition déclarée, pas au pixel.
- Les tests ne remplacent pas une revue visuelle humaine sur appareil réel ; ils empêchent seulement les régressions mesurables connues.

## 8. Rejouer les contrôles

```bash
npm ci
npm run typecheck
npm run test -w @mc/web -- tests/mission40-theme-contrast.test.ts tests/mission40-theme-ui.test.tsx
npm run test -w @mc/web
npm run test -w @mc/api
npm run build
npm run build:demo
node scripts/verify-demo.mjs --dist apps/web/dist --base /mauritius-compta/
```
