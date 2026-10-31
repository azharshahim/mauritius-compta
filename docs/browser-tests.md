# Tests navigateur (Chromium) — limites et procédure reproductible

## 1. Statut : **non exécutés** dans l'environnement d'audit

Les tests navigateur **n'ont pas été exécutés**. Aucun résultat n'est revendiqué.

Constats de l'environnement d'audit (30 octobre 2026) :

| Vérification | Résultat |
|---|---|
| Binaire `chromium` / `google-chrome` / `chrome` dans le `PATH` | absent |
| Cache Playwright (`/root/.cache/ms-playwright`, `~/.cache/ms-playwright`) | absent / accès refusé |
| `npx playwright install chromium` | téléchargement impossible : l'accès réseau est limité à GitHub et aux registres npm/PyPI ; `cdn.playwright.dev` répond `SSL_ERROR_SYSCALL` |
| Paquet `chromium` via apt | « Unable to locate package chromium » |
| `npx playwright test --list` | **fonctionne** : 10 tests découverts (5 scénarios × 2 profils) |

Conséquence : les scénarios sont **écrits et vérifiés syntaxiquement**, mais leur exécution
réelle reste à faire par le propriétaire (ou en CI avec un runner disposant du réseau).

## 2. Ce que couvrent les scénarios fournis

Fichier : `apps/web/e2e/app.spec.ts` (Playwright).

| Scénario | Vérifications |
|---|---|
| `sign-up, empty dashboard and navigation` | inscription, tableau de bord vide, navigation vers Sociétés et Plan comptable |
| `creates a company, captures and posts an entry, then reads the reports` | création de société, création de compte, saisie d'écriture équilibrée, validation, blocage de modification après validation, grand livre, balance, états financiers |
| `exports CSV and PDF over the authenticated API` | export CSV (`text/csv`, mention DÉMONSTRATION) et PDF (`%PDF-`) avec session authentifiée |
| `switches the interface language FR -> EN` | bascule FR/EN et persistance de la préférence |
| `mobile navigation drawer opens and closes` | tiroir de navigation mobile (projet `mobile-chromium` uniquement) |

Deux profils sont configurés dans `playwright.config.ts` :

- `desktop-chromium` — 1440 × 900 (fenêtre type Windows) ;
- `mobile-chromium` — profil **Pixel 7** (412 × 915, Android, Chrome).

## 3. Procédure reproductible (Windows, Linux, macOS)

### 3.1 Préparation (une seule fois)

```bash
npm ci
npm run test:e2e:install -w @mc/web     # playwright install --with-deps chromium
npm run db:seed                          # données fictives
```

> `test:e2e:install` télécharge Chromium (~150 Mo) : une connexion Internet est nécessaire.
> Sous Linux, `--with-deps` installe les bibliothèques système requises (sudo possible).
> Sous Windows, exécuter la commande dans un terminal PowerShell sans restriction d'exécution.

### 3.2 Exécution

```bash
# Terminal 1 : API + interface
npm run dev

# Terminal 2 : tests navigateur
npm run test:e2e -w @mc/web                       # les deux profils
npx playwright test --project=desktop-chromium -w @mc/web
npx playwright test --project=mobile-chromium -w @mc/web
npx playwright test --headed -w @mc/web           # avec interface visible
npx playwright show-report -w @mc/web             # rapport HTML
```

Variables utiles :

```bash
E2E_BASE_URL=http://localhost:5173   # cible (défaut)
```

### 3.3 Intégration en CI (non activée)

Les tests navigateur ne sont **pas** dans la CI actuelle (aucun navigateur n'est préinstallé sur
les runners et le dépôt ne doit pas dépendre d'un téléchargement lourd à chaque exécution).
Pour les activer, ajouter une tâche dédiée :

```yaml
  e2e:
    name: Browser tests (Chromium)
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '22', cache: npm }
      - run: npm ci
      - run: npx playwright install --with-deps chromium
      - run: npm run db:seed
      - run: |
          npm run dev & npx wait-on http://localhost:5173
          npm run test:e2e
```

## 4. Points d'attention lors de la première exécution

Les sélecteurs reposent sur les libellés **français et anglais** (FR par défaut). Si les textes
d'interface changent, ajuster `apps/web/e2e/app.spec.ts`. Le scénario de saisie d'écriture utilise
les comptes `1010` et `4000` du plan de démonstration : si le plan comptable change, adapter les
sélecteurs.

## 5. Ce qu'il reste à vérifier manuellement (en attendant)

Tant que ces tests n'ont pas tourné, les points suivants ne sont **pas** validés :

- rendu et ergonomie sur Android réel (clavier numérique, défilement des tableaux) ;
- comportement du tiroir de navigation sur un écran tactile ;
- téléchargement des exports CSV/PDF depuis un navigateur Windows ;
- accessibilité clavier des modales.

## 6. Suite jsdom exécutée en local et en CI (mode démonstration)

Chromium n'est pas installable dans l'environnement de l'assistant (`cdn.playwright.dev`
inaccessible) : les tests Playwright restent donc **non exécutés**. En remplacement, une
suite **jsdom** (Vitest) exécute réellement le bundle de démonstration, sans réseau :

| Fichier | Couverture |
|---|---|
| `apps/web/tests/demo-engine.test.ts` (10) | connexion, absence d'appel réseau, jeu de données équilibré, numérotation, refus d'écriture déséquilibrée, immutabilité, contrepassation unique, référence unique, devise + taux, période fermée, isolation des sociétés, CSV anti-formule, cohérence des indicateurs, audit local |
| `apps/web/tests/demo-app.test.tsx` (5) | bandeau permanent, identifiants pré-remplis, connexion, navigation par hash (`#/entries`, `#/trial-balance`, `#/statements`), saisie d'une écriture via la modale, bascule FR/EN, tiroir mobile, création d'une société |
| `apps/web/tests/format.test.ts` (4) | date d'écriture proposée dans une période ouverte, arithmétique décimale exacte |

Résultat : **19/19** (`npm run test -w @mc/web`), exécuté aussi par la CI.

> jsdom ne rend pas la mise en page : **le rendu visuel, le tactile et le comportement réel
> de Chrome sur Android/Windows ne sont pas validés par cette suite**. Ils doivent être
> vérifiés sur l'URL GitHub Pages depuis les appareils du propriétaire.

## 7. Suite jsdom de la mission 4 (quatre espaces)

Exécutée en local et dans la CI (`npm run test -w @mc/web`) :

| Fichier | Tests | Couverture |
|---|---|---|
| `apps/web/tests/demo-engine.test.ts` | 17 | comptabilité de démonstration (10) + cabinet et permissions de module (7 : indicateurs, cycle de tâche, affectation refusée, archivage lecture seule, séparation paie/comptabilité, facturation non disponible, équipe) |
| `apps/web/tests/demo-app.test.tsx` | 7 | quatre espaces accessibles, dossiers et écrans comptables conservés, tableau de bord, création dossier + tâche, archivage, facturation/paie annoncées, FR/EN + tiroir mobile |
| `apps/web/tests/format.test.ts` | 4 | période par défaut, arithmétique décimale |
| **Total** | **28** | aucun appel réseau (`fetch` espionné) |

Côté API (Vitest + PGlite, et PostgreSQL 16 en CI) : `apps/api/tests/cabinet.test.ts` ajoute
11 tests (dossiers, tâches, dashboard, archivage, permissions, isolation, fondations).

> Rappel : jsdom **ne rend pas** la mise en page. Le rendu visuel, le tactile et le
> comportement réel de Chrome sur Android/Windows restent à vérifier sur l'URL GitHub Pages.

## 8. Clavier Android — non-régression (mission 5)

Bug signalé sur Samsung : le clavier virtuel se refermait après **chaque caractère**.
Cause : l'effet de focus du composant `Modal` dépendait de `onClose`, recréé à chaque rendu
par les formulaires ; chaque frappe relançait l'effet et déplaçait le focus du champ vers la
boîte de dialogue (jsdom reproduisait exactement ce flou).

`apps/web/tests/input-focus.test.tsx` (10 tests) saisit caractère par caractère et vérifie,
après chaque frappe, que :

- `document.activeElement` est toujours le même nœud ;
- le nœud est toujours dans le document (aucun démontage) ;
- la valeur contrôlée suit bien la saisie.

Formulaires couverts : connexion, recherche de dossier (avec rechargement), création et
modification de dossier, création de tâche, éditeur d'écriture, recherche et création de
compte, paramètres comptables, ouverture/fermeture de modale (focus rendu au déclencheur),
tiroir de navigation mobile.

> Limite honnête : ces tests s'exécutent dans **jsdom**, pas sur un appareil Android. Ils
> prouvent l'absence de perte de focus et de démontage, pas le rendu du clavier virtuel.
> Une validation manuelle sur Samsung reste nécessaire (voir rapport de mission 5).

## 9. Écrans IA (mission 5)

| Fichier | Tests | Couverture |
|---|---|---|
| `apps/web/tests/demo-engine.test.ts` | +5 (22 au total) | fournisseur fictif, refus de clé réelle, suggestion issue du plan comptable, absence d'écriture, règle réutilisée, compte hors plan refusé, interrupteur/plafond, réglages inaccessibles aux non-administrateurs |
| `apps/web/tests/demo-app.test.tsx` | +3 (10 au total) | écran Paramètres IA (bandeau de simulation, aucun champ de clé actif), parcours proposition → acceptation → règle, erreur quand le module est désactivé |

Aucun de ces tests n'appelle le réseau : `fetch` est espionné et doit rester inutilisé.
