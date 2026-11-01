# COMPTAI — audit des thèmes Light / Dark (Mission 40)

**Date :** 1er novembre 2026  
**Base :** `main` = `0a365d286483eb734c7c54cb3dc15c5e879f981d` (Mission 39, PR nº20 fusionnée)  
**Branche de travail :** `arena/e1f93b22-mauritius-compta`  
**Périmètre :** interface web de démonstration et de production ; aucun calcul, aucune écriture, aucun état financier, aucune règle TVA/paie/stock/immobilisation et aucune donnée fictive n’a été modifié.

## 1. Méthode

L’audit a été réalisé **avant** toute correction, sur le fichier `apps/web/src/styles.css` de la base `0a365d2`, puis sur les composants `.tsx` qui portent des styles en ligne.

Contrôles effectués :

1. lecture de l’architecture existante (`styles.css`, `App.tsx`, `main.tsx`, `index.html`, `components/ui.tsx`) ;
2. inventaire des variables `:root` et `[data-theme='dark']` ;
3. comptage des couleurs littérales et des déclarations `color` / `background` / `border` ;
4. calcul des rapports de contraste WCAG 2.x (luminance relative) pour les combinaisons réellement utilisées ;
5. recherche des styles en ligne et des couleurs codées en dur dans les fichiers `.tsx` ;
6. vérification des sélecteurs d’état : `:hover`, `:focus-visible`, `.active`, `.selected`, `:disabled`, `.row-overdue`, `.total-row`, `.badge-*`, `.alert-*`, `.banner-*` ;
7. contrôle de non-régression des contrats M39 (`NAV_GROUPS`, routes, `mc.theme`, `mc.guidedTour.v1`).

### Volumétrie mesurée

| Indicateur | Avant | Après |
|---|---:|---:|
| Occurrences de couleurs hexadécimales dans `styles.css` | 254 | 116 |
| Couleurs hexadécimales distinctes | 131 | 87 |
| Déclarations `color` / `background` / `border` avec une couleur littérale | 177 | 38 |
| Blocs `:root` | 2 | 1 |
| Tokens déclarés light / dark | 19 / 16 | 47 / 36 (dont 11 invariants typographie/impression) |

Les 38 déclarations littérales restantes sont **intentionnelles** : texte de la barre latérale toujours sombre, héros d’authentification, héro MRA, bouton blanc du héro, feuille de paie imprimée, styles d’impression et valeurs de secours du document. Elles ne dépendent pas du thème.

> Le comptage est une mesure statique du fichier CSS, pas un nombre de composants visuels.

## 2. Architecture constatée avant correction

- Deux blocs `:root` : un bloc hérité en tête de fichier et le bloc « mission 28 » plus loin. Le second écrasait le premier ; le premier ne servait plus qu’à définir `--font`.
- Un bloc `[data-theme='dark']` unique, complété par des « rustines » `[data-theme='dark'] .sélecteur` en fin de fichier.
- Des couleurs littérales répétées dans les modules (`.bank-*`, `.purchase-*`, `.lettering-*`, `.migration-*`, `.mra-*`, `.payslip-*`, `.assistant-*`).
- Le thème était appliqué par `App.tsx` dans un `useEffect`, et une seconde fois dans `main.tsx` avant le rendu React (anti-flash). La préférence existante est `localStorage['mc.theme']`.
- Aucune option de préférence système (`prefers-color-scheme`) n’existe : le choix explicite Light/Dark est le seul mécanisme. Il a été conservé.

## 3. Anomalies globales

| # | Constat mesuré | Effet | Correction |
|---|---|---|---|
| G1 | `--muted` = `#64748b` : **4,35:1** sur `--bg` (`#f2f5fa`) et **4,24:1** sur `--surface-3` (`#eef2f8`) | textes secondaires, en-têtes de tableaux et libellés de champs sous le seuil AA de 4,5:1 en Light | `--muted` = `#55657a` → **5,45:1** sur `--bg`, **5,30:1** sur `--surface-3` |
| G2 | Texte blanc sur `--accent` dark (`#6ea0ff`) : **2,58:1** ; sur `--accent-dark` (`#4b83ef`) : **3,63:1** | boutons primaires, onglets actifs, bulles de l’assistant, étapes de migration, onglets Banque/Achats illisibles en Dark | token `--text-on-accent` : blanc en Light, `#06101e` en Dark → **7,39:1** sur `--accent`, **5,26:1** sur `--accent-dark` |
| G3 | Bordure des champs `--border` = `#e2e8f0` : **1,23:1** sur blanc ; `#26364e` : **1,42:1** en Dark | champs, listes déroulantes et date pickers sans limite identifiable ; un champ vide se confond avec la surface | token `--border-control` : `#74869d` (**3,72:1** sur blanc) et `#647c9b` (**3,33:1** sur `--surface-3` dark) |
| G4 | Focus clavier basé sur `--accent` : `#2563eb` sur la barre latérale `#0a1f3a` = **2,47:1** | anneau de focus peu visible sur la navigation toujours sombre | `--focus-ring` (Light `#1d4ed8`, Dark `#8ab4ff`) + `--focus-ring-on-dark` `#8ab4ff` → **7,92:1** sur le navy ; anneau 2 px, offset 2 px |
| G5 | Les surcharges dark `[data-theme='dark'] .tabs button`, `.bank-tab`, `.purchase-tab`, `.btn` avaient une spécificité supérieure aux états `.active` / `.btn-danger` / `.btn-secondary` | en Dark, l’onglet actif redevenait gris, le bouton danger perdait son rouge et le bouton secondaire son fond | surcharges dark explicites pour chaque état actif, `.btn-danger`, `.btn-secondary`, `.btn-link` ; vérifié par test |
| G6 | `Statements.tsx` : `style={{ background: '#eef4fb' }}` sur les en-têtes de section ; `Companies.tsx` : ligne courante `#f2f8ff` | surfaces claires imposées en Dark, texte clair sur fond clair | classes `.statement-section` et `.company-row-current` appuyées sur `--surface-3` / `--selection-bg` + barre latérale `--selection-border` |
| G7 | Aucun token pour les états `danger`, `success`, `warning`, `info` avec bordure ; variantes `-danger` / `-warning` utilisées par les pages mais non définies | alertes et badges incohérents ou sans fond | tokens `--danger/-success/-warning/-info` + `-bg` + `-border` ; alias `.alert-danger` / `.alert-warning` |
| G8 | Feuille de paie : `#647684` sur `#f3f7f8` = **4,36:1** | libellés et totaux secondaires de paie sous 4,5:1 | palette papier constante `--paper-*` ; `--paper-muted` `#536773` → **5,48:1** sur `--paper-subtle` |
| G9 | Deux blocs `:root` et des valeurs de secours périmées (`var(--border, #d8dee9)`, `var(--accent, #1f4e79)`) | plusieurs sources de vérité, risque de divergence | un seul `:root`, suppression des valeurs de secours littérales |

## 4. Inventaire par module

| Module / écran | Sélecteurs ou composants inspectés | Anomalie constatée en Light ou Dark | Traitement |
|---|---|---|---|
| Dashboard, KPI, barre supérieure | `.kpi-*`, `.topbar`, `.page-sub` | `--muted` à 4,24–4,35:1 ; bordure de barre supérieure très faible | `--muted` corrigé, `--border` conservée pour les séparations décoratives |
| Barre latérale complète / rail / tiroir | `.sidebar`, `.nav a`, `.nav-group-toggle`, `.sidebar-close`, `.sidebar-foot` | focus à 2,47:1 sur le navy ; textes clairs volontaires sur fond sombre | `--focus-ring-on-dark` ; aucune inversion du navy, identité conservée |
| Navigation rapide mobile, breadcrumbs, Back | `.quick-link`, `.context-back` | anneau de focus en `--accent` | anneaux ramenés à `--focus-ring`, offset conservé |
| Chart of Accounts | `th`, `tbody tr:hover`, `tr.total-row`, `.badge-*` | en-têtes à 4,24–4,55:1 en Light | `th` sur `--muted` corrigé, `--surface-2` et `--row-hover` tokenisés |
| Journal Entries | champs, selects, dates, `.field-error`, statuts | bordure de champ 1,23:1 ; erreurs sans variable dédiée | `--border-control`, `--danger`, focus 2 px |
| General Ledger, Trial Balance | `th`, `.num`, `.mono`, lignes de total | mêmes en-têtes ; alignement numérique à préserver | aucune modification de largeur, de police ou de format ; seules les couleurs changent |
| Balance Sheet, Profit & Loss, Equity | `.statement-section`, `tr.total-row` | fond `#eef4fb` codé en dur dans le TSX | classe tokenisée, texte de section en `--text` |
| Accounting Periods, Settings | formulaires, tableaux, boutons | bordure et focus globaux | tokens globaux |
| Sales & Invoicing | tableaux, badges, boutons, onglets | texte blanc sur accent en Dark | `--text-on-accent`, états actifs dark |
| Purchases | `.purchase-tab`, `.purchase-card`, `.row-overdue`, `.amount-in/out` | onglet actif blanc sur accent ; lignes en retard signalées par fond + texte | tokens d’état ; le badge et le nombre de jours restent des indications textuelles |
| Banking, Bank Reconciliation, Bank Imports | `.bank-tab`, `.bank-count`, `.bank-*card`, `.doc-view`, `.amount-in/out` | onglet actif illisible en Dark ; cartes avec bordure littérale ; `.doc-view` dark dupliqué | tokens, surcharge active, doublon supprimé |
| Inventory | tableaux, badges, formulaires | états partagés | tokens globaux |
| Fixed Assets | onglets `?tab=`, tableaux, badges M39 | contrats M39 à préserver | routes et onglets inchangés ; couleurs tokenisées |
| Payroll / bulletins | `.payslip-sheet`, `.payslip-*` | `#647684` sur `#f3f7f8` = 4,36:1 ; palette papier mélangée à des littéraux | palette `--paper-*` constante (le bulletin reste un document papier blanc dans les deux thèmes) |
| Cabinet / dossiers clients | tableau des sociétés, badges, sélection | ligne courante `#f2f8ff` non thémée | `.company-row-current` avec `--selection-bg` et barre `--selection-border` |
| Import & Migration | `.migration-*`, étapes, compteurs, filtres | étapes terminées `#f2f9f3`, textes blancs sur accent, compteurs littéraux | tokens sémantiques et états actifs dark |
| OCR Scan & Import | `.doc-view`, `.doc-review-grid`, aperçus | fond clair dark corrigé ponctuellement | `.doc-view` sur `--surface-2` en Dark |
| AI Assistant / propositions | `.assistant-fab`, `.assistant-bubble`, composer, focus | bulle utilisateur blanche sur accent à 2,58:1 en Dark | `--text-on-accent`, focus `--focus-ring` |
| Guided Demo | cartes, tableaux, panneau | aucun défaut propre ; composants partagés | conservé, aucune route ni étape modifiée |
| MRA / déclarations | `.mra-hero`, `.mra-dot`, `.mra-roadmap`, `.mra-feature`, `.mra-limitation` | héro volontairement sombre ; puces sans fond tokenisé | `--info`, `--warning`, `--border-control` ; héro conservé |
| Login / authentification | `.auth-hero`, messages, notices démo | héro toujours sombre ; textes clairs | conservé ; notice démo tokenisée |
| États transverses | `.alert-*`, `.banner-*`, `.badge-*`, `.field-error`, `.empty`, `.spinner-*` | variantes manquantes, couleurs littérales | tokens + alias, états documentés |

## 5. Contraste avant / après (mesures)

Les rapports sont calculés avec la formule WCAG 2.x. « Avant » désigne les valeurs du commit `0a365d2`.

| Combinaison | Contexte | Avant | Après | Seuil |
|---|---|---:|---:|---:|
| `--muted` / `--bg` | Light, texte secondaire | 4,35 | **5,45** | 4,5 |
| `--muted` / `--surface-2` | Light, en-têtes de tableaux | 4,55 | **5,69** | 4,5 |
| `--muted` / `--surface-3` | Light, badges neutres | 4,24 | **5,30** | 4,5 |
| Texte primaire / `--surface` | Light | 16,61 | 16,61 | 4,5 |
| `--muted` / `--surface-3` | Dark | 6,37 | 6,37 | 4,5 |
| Blanc / `--accent` | Dark, boutons et onglets actifs | 2,58 | **7,39** avec `--text-on-accent` | 4,5 |
| Blanc / `--accent-dark` | Dark, survol primaire | 3,63 | **5,26** avec `--text-on-accent` | 4,5 |
| Bordure de champ / blanc | Light | 1,23 | **3,72** avec `--border-control` | 3 |
| Bordure de champ / `--surface-3` | Light | 1,10 | **3,31** | 3 |
| Bordure de champ / `--surface-3` | Dark | 1,17 | **3,33** | 3 |
| Focus / `--surface` | Light | 5,17 (accent) | **6,70** | 3 |
| Focus / navy | Light, barre latérale | 2,47 | **7,92** | 3 |
| `#647684` / `#f3f7f8` | Bulletins avant | 4,36 | **5,48** (`--paper-muted`) | 4,5 |
| `--danger` / `--danger-bg` | Alertes | 6,05 | 6,05 | 4,5 |
| `--success` / `--success-bg` | Alertes | 5,37 | 5,37 | 4,5 |
| `--warning` / `--warning-bg` | Alertes | 5,59 | 5,59 | 4,5 |

Détail des combinaisons et exécution automatisée : `docs/comptai-theme-contrast-tests.md`.

## 6. États et accessibilité

- **Hover** : `--row-hover`, `--surface-2`, `color-mix` sur les puces de démonstration ; jamais seul indicateur d’une information.
- **Focus** : règle globale `:focus-visible` à 2 px, offset 2 px, couleur `--focus-ring` ; anneau spécifique `--focus-ring-on-dark` sur la barre latérale, le héro d’authentification et le héro MRA.
- **Active / selected** : fond + bordure ou barre latérale + texte ; les onglets actifs conservent un fond, une bordure et un libellé en gras.
- **Disabled** : opacité et `cursor: not-allowed` conservés ; champs désactivés sur `--surface-3` avec `--muted`, donc encore identifiables. L’exemption WCAG des contrôles désactivés est documentée, sans les rendre trompeurs.
- **Loading** : spinner sur `--accent` / `--muted`.
- **Error / warning / success** : texte + fond + bordure ; les messages de formulaire utilisent `--danger` et restent lisibles sur toutes les surfaces.
- **Empty** : `.empty` en `--muted`, titre en `--text`.
- **Information jamais portée par la couleur seule** : les badges, statuts, lignes en retard et propositions portent tous un libellé textuel ; les sélections combinent fond, bordure et, pour les sociétés, badge « current ».

## 7. Ce qui n’a pas été modifié

- calculs, formules, arrondis, montants, devises et formats monétaires ;
- journaux, écritures, balance, grand livre, états financiers, TVA, paie, immobilisations, stocks ;
- données fictives M37 et jeu de démonstration ;
- OCR, assistant IA, sécurité, sauvegardes ;
- routes, groupes de navigation, libellés professionnels et contrats M39 ;
- mécanisme de préférence `mc.theme` (seulement centralisé dans `theme.ts`, sans nouvelle clé ni nouveau stockage) ;
- workflow GitHub Pages, déploiement OVH et publication.

## 8. Limites de l’audit

- Aucun navigateur Playwright n’est installé dans cet environnement : **aucune capture réelle, aucun test Safari iPhone ou Chrome Android physique n’a été réalisé**.
- Les contrastes sont calculés sur les valeurs CSS déclarées, pas sur des pixels rendus. Les dégradés (`body`, héros) sont vérifiés sur leur couleur de base, pas sur chaque point du dégradé.
- Les couleurs `color-mix(...)` des badges sont estimées par leur composition déclarée ; le test automatisé couvre les tokens opaques.
- jsdom ne calcule ni la mise en page ni les couleurs effectives : les tests d’interface prouvent le comportement du thème, pas le rendu visuel.
