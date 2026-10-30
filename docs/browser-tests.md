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
