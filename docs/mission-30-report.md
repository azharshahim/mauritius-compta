# Mission 30 — COMPTAI : identité, navigation Android, banque et démonstration

Date : 2026-11-01  
Branche : `arena/bc5969d1-mauritius-compta`  
PR : [nº 11 — brouillon](https://github.com/azharshahim/mauritius-compta/pull/11)  
Statut : **livré en brouillon, non fusionné, non publié sur le site permanent.**

## 1. Résumé exécutif

La mission 30 regroupe six travaux visibles :

1. **COMPTAI** remplace « Mauritius Business Suite » / « Mauritius Compta » partout où il s’agit de la marque : barre latérale, en-tête, connexion, onglet, README, description du paquet et écran 404 de démonstration.
2. Le **menu latéral Android** a été corrigé : voile réellement affiché, fermeture explicite, défilement interne du menu, blocage du défilement de la page derrière le tiroir, largeur et zones sûres (`safe-area-inset-*`).
3. **Banque et trésorerie** est désormais le groupe placé **immédiatement après Comptabilité**.
4. La **séparation démonstration / application réelle** est explicite : un module de bascule sans données, un chargement différé du moteur fictif et des identifiants de démonstration injectés uniquement dans le build de démonstration.
5. La **démonstration** intègre les champs de vérification de la mission 29 (confiance par champ, champs incertains, identifiants fiscaux, remises, qualité d’extraction) et met à niveau les états déjà stockés dans le navigateur, **sans changer le schéma 17 ni les identifiants de stockage**.
6. Une **identité PWA provisoire** est fournie : logo, favicon, icônes 192/512, icône maskable, icônes Apple/Windows, manifeste, raccourcis et service worker d’installabilité sans cache.

Aucun calcul comptable, taux, règle fiscale, migration de base ou moteur OCR n’a été modifié.

## 2. Périmètre et fichiers

| Travail | Fichiers principaux | État |
|---|---|---|
| Marque COMPTAI | `src/i18n.tsx`, `src/App.tsx`, `src/pages/Login.tsx`, `src/modules.ts`, `index.html`, `public/404.html`, `README.md`, `package.json` | livré |
| Logo applicatif | `public/comptai-mark.svg`, `public/comptai-mark.png`, `src/components/BrandMark.tsx`, `src/styles.css` | livré |
| Icônes et manifeste | `public/icons/*`, `public/favicon.ico`, `public/manifest.webmanifest`, `public/browserconfig.xml`, `public/sw.js`, `index.html` | livré |
| Menu Android | `src/App.tsx`, `src/styles.css` | livré, testé en jsdom ; **non testé sur appareil physique** |
| Navigation | `src/navigation.ts`, `tests/mission26-navigation.test.ts` | livré |
| Séparation démo/réel | `src/demo/mode.ts`, `src/api.ts`, `src/components/DemoBanner.tsx`, `src/pages/Login.tsx`, `vite.config.ts`, `vitest.config.ts` | livré |
| Démo actualisée | `src/demo/mission23.ts`, `src/demo/runtime.ts`, `src/demo/index.ts` | livré |
| Tests M30 | `tests/mission30-*.test.*` | 12 tests |

Les pages qui importaient `demoEnabled` depuis le barrel `src/demo` importent maintenant le module léger `src/demo/mode`. Cela évite de charger le moteur fictif dans l’application réelle.

## 3. Identité COMPTAI (provisoire)

### 3.1 Marque

- `app.name`, `suite.name`, `migration.targetField` et `document.title` valent **COMPTAI** en français et en anglais.
- Les textes légaux MRA disent désormais « COMPTAI n’est ni enregistré, ni certifié… ».
- Le README et la description du paquet utilisent COMPTAI ; **les identifiants techniques ne changent pas** (`name` du paquet, `appId`, clés `mc.*`, schéma de démonstration).
- Une note en tête du README précise que **le nom est provisoire** et que sa disponibilité juridique/commerciale reste à vérifier.

### 3.2 Logo

Monogramme « C » blanc, courbe ascendante turquoise et point doré, sur fond dégradé bleu nuit (`#0b2545 → #16436f`). Le même fichier `public/comptai-mark.svg` est utilisé par :

- l’en-tête et la barre latérale via `BrandMark` ;
- la page de connexion ;
- le favicon SVG prioritaire ;
- le manifeste PWA.

Le PNG est généré par ImageMagick (le SVG n’est pas rasterisé : `rsvg-convert` n’est pas disponible dans l’environnement). Le logo est **provisoire** et remplaçable avant commercialisation.

### 3.3 Icônes

| Fichier | Taille | Usage |
|---|---|---|
| `icons/comptai-32.png`, `icons/comptai-48.png` | 32, 48 | favicons PNG |
| `favicon.ico` | 16/32/48/64 | navigateurs de bureau |
| `icons/comptai-192.png` | 192 | manifeste, raccourcis |
| `icons/comptai-512.png` | 512 | manifeste, écran de lancement Android |
| `icons/comptai-maskable-192.png` | 192 | icône maskable Android |
| `icons/comptai-maskable-512.png` | 512 | icône maskable Android, splash |
| `icons/apple-touch-icon.png` | 180 | iOS/iPadOS, **opaque** |
| `icons/mstile-150.png` | 150 | raccourci Windows, **opaque** |

L’icône maskable a été réduite à **80 %** de la zone de dessin pour rester dans le cercle de sécurité de 40 % de rayon. Les versions Apple et Windows sont **opaques** (pas de transparence noire sur iOS).

### 3.4 Manifeste et installation

`public/manifest.webmanifest` déclare :

- `id`, `start_url`, `scope` relatifs (`./`) pour rester valides sous `base=/mauritius-compta/` (GitHub Pages) comme à la racine ;
- `name` et `short_name` = **COMPTAI** ;
- `display: standalone`, `theme_color`/`background_color` = `#0b2545` ;
- quatre icônes (`any` ×2, `maskable` ×2) ;
- deux raccourcis : `./#/accounting` et `./#/accounting/banking`, avec l’icône 192.

`public/sw.js` est un **service worker d’installabilité sans cache** : il ne répond à aucune requête et ne conserve aucune donnée. Il permet l’installation comme application sans risquer de servir une donnée comptable périmée ni les données fictives à la place d’une API en échec. Il est enregistré uniquement en build de production (`import.meta.env.PROD`), jamais en développement.

### 3.5 Écran de lancement

- **Android** : splash généré par le système à partir de `background_color` et de l’icône 512 maskable. Aucune image de splash personnalisée n’est déclarée (le manifeste standard n’en prévoit pas).
- **Windows** : tuile fournie par `browserconfig.xml` (`mstile-150.png`) et installation via le manifeste.
- **iOS** : `apple-touch-icon` fourni ; **aucune `apple-touch-startup-image` n’est configurée** dans cette mission. iOS affiche donc son écran de lancement par défaut. Ce point est une limite connue, pas une conformité revendiquée.

## 4. Menu latéral Android

Cause principale : le voile `.drawer-backdrop` était bien rendu dans le DOM, mais la largeur du tiroir et l’empilement pouvaient le rendre inopérant ; le menu n’avait pas de bouton de fermeture propre et la page derrière pouvait continuer à défiler.

Corrections :

- voile au-dessus du contenu (`z-index: 45`) et tiroir au-dessus (`z-index: 50`) ;
- bouton **Fermer** explicite dans l’en-tête du tiroir, en plus du voile et de la touche Échap ;
- `aria-controls="app-sidebar"` sur le bouton Menu ;
- `body.nav-open { overflow: hidden; }` pendant l’ouverture, retiré à la fermeture ;
- défilement interne de `.sidebar .nav` (`min-height: 0`, `overflow-y: auto`, `overscroll-behavior: contain`) ;
- largeur `min(320px, 92vw)` au lieu de 300/88 ;
- hauteur `100dvh` et marges `env(safe-area-inset-top/bottom)` pour les encoches et barres système ;
- cibles tactiles de 44 px minimum ;
- règles mobiles finales placées après les blocs de thème pour éviter qu’un `padding-top` desktop tardif n’écrase les zones sûres.

Limite : la validation est faite par tests jsdom et revue CSS ; **aucun test sur appareil Android physique** n’a été exécuté dans cet environnement.

## 5. Navigation

Ordre cible et livré :

`Accueil → Comptabilité → Banque et trésorerie → Facturation → Paie et RH → Gestion avancée → États financiers → Cabinet et administration`

`tests/mission26-navigation.test.ts` vérifie désormais que `bank` est exactement à `accounting + 1`, et non plus seulement « après Facturation ».

## 6. Séparation démonstration / application réelle

### 6.1 Bascule

`src/demo/mode.ts` ne contient **aucune donnée métier** :

```ts
export const demoEnabled: boolean = import.meta.env.VITE_DEMO_MODE === 'true';
export const appMode: 'demo' | 'production' = demoEnabled ? 'demo' : 'production';
```

La comparaison est stricte : une variable absente, vide ou mal orthographiée vaut **production**. Aucun repli automatique vers les données fictives n’existe si l’API échoue.

### 6.2 Chargement différé

- `api.ts` importe `demoEnabled` depuis `mode`, puis charge `./demo/runtime` **uniquement** dans la branche démo (`await import`).
- `DemoBanner` fait de même pour `isDemoVolatile` et `resetDemo`.
- Les pages n’importent plus le barrel `src/demo` ; elles n’embarquent pas le moteur fictif.
- `src/demo/index.ts` reste le point d’entrée des tests, pas des écrans de production.

### 6.3 Identifiants de démonstration

Les identifiants fictifs sont injectés par `define` dans `vite.config.ts` :

- build démo (`VITE_DEMO_MODE=true`) : valeurs réelles de démonstration ;
- build réel : **chaînes vides**.

Ainsi la connexion peut pré-remplir les champs de façon synchrone en démonstration, sans qu’aucun mot de passe fictif ne soit présent dans le bundle réel. Vérification effectuée sur le build réel :

```text
DemoPassw0rd2026          : 0 occurrence
demo@mauritius-compta.test: 0 occurrence
Mauritius Demo Services   : 0 occurrence
000123456789              : 0 occurrence
aucun chunk runtime-*.js
```

Le build démo produit au contraire un chunk `runtime-*.js` séparé, chargé à la demande.

### 6.4 Ce que cela garantit — et ne garantit pas

Garanti par les tests et le build :

- le mode réel ne contient ni identifiants, ni fixtures, ni moteur de démonstration ;
- le mode démo est explicite et visible ;
- le schéma 17 et les clés `mc.*` sont conservés.

Non garanti :

- qu’un futur déploiement ne mette pas `VITE_DEMO_MODE=true` par erreur — la revue de configuration reste nécessaire ;
- une séparation cryptographique ou multi-tenant : elle relève du serveur et des tests API existants.

## 7. Démonstration actualisée

- Les six documents fictifs exposent maintenant `document_type`, `discount_total`, `tax_ids`, `purchase_order`, `payment_terms`, `field_confidence`, `uncertain_fields` et `extraction_quality`.
- Le document OCR a des champs réellement incertains (`invoiceNumber`, `invoiceDate`) ; une correction humaine les retire de la liste.
- Les identifiants fiscaux et le bon de commande restent **fictifs** et signalés comme tels.
- Le profil MCB fictif expose `profileKey` / `detectedBankKey = mcb`, un numéro de compte fictif `000123456789` et la mention « Mauritius Commercial Bank (fictif) ».
- `upgradeDemoMission23` met à niveau un état déjà stocké **sans dupliquer les documents** ; le schéma reste **17**.
- Les écrans de la mission 28 (import multifichiers, vérification groupée, rapprochement groupé) restent inchangés et utilisent les routes existantes.

## 8. Validation

| Contrôle | Résultat |
|---|---|
| `npm run typecheck` | ✅ 0 erreur (API + web) |
| Tests API | ✅ **492 passés**, 11 ignorés (503) |
| Tests web | ✅ **287 passés**, 44 fichiers |
| Nouveaux tests M30 | ✅ 12 (marque/icônes, séparation démo, démo actualisée, menu Android) |
| `npm run build` | ✅ 1 237,89 kB (306,99 kB gzip) pour le chunk principal ; aucun chunk runtime |
| `npm run build:demo` | ✅ chunk principal 1 240,48 kB (307,54 kB gzip) + `runtime-*.js` 716,30 kB (198,88 kB gzip) |
| Manifeste sous `base=/mauritius-compta/` | ✅ chemins relatifs, icônes et `sw.js` servis en 200 |
| CI GitHub Actions (commit `01af5b8`) | ✅ 4 contrôles verts (typecheck/tests/build, API PostgreSQL, migrations, build démo) ; **Deploy Pages ignoré** |
| Test sur Android physique | ❌ non réalisé dans cet environnement |

Le lien de prévisualisation HTTPS de la démonstration est fourni dans la conversation et rappelé dans la PR. Il sert le build `build:demo` sous le préfixe `/mauritius-compta/`, avec redirection depuis la racine. Lien temporaire lié à l’environnement de session : <https://4173-iun6s3rfpj5o1xox1vafx.e2b.app>.

## 9. Procédure de rafraîchissement des icônes et du nom déjà installés

Les icônes et le nom peuvent rester en cache **dans le système**, indépendamment du serveur. Pour une installation existante, la procédure fiable est **désinstaller puis réinstaller**.

### Android (Chrome / Edge / Samsung Internet)

1. Appui long sur l’icône COMPTAI → **Désinstaller** (ou Paramètres → Applications → COMPTAI → Désinstaller).
2. Ouvrir Chrome → Paramètres → Paramètres des sites → Tous les sites → chercher le domaine → **Effacer et réinitialiser** (ou stockage/cache du site).
3. Fermer tous les onglets du site, puis rouvrir l’URL HTTPS.
4. Menu ⋮ → **Installer l’application** / **Ajouter à l’écran d’accueil**.
5. Vérifier le nom et l’icône. Un système peut conserver un ancien raccourci : supprimer aussi l’ancien raccourci de l’écran d’accueil avant de réinstaller.

### Windows (Chrome / Edge)

1. Désépingler l’ancienne application de la barre des tâches et du menu Démarrer.
2. Paramètres Windows → Applications → COMPTAI → **Désinstaller**.
3. Dans le navigateur : Paramètres → Confidentialité → Effacer les données de navigation → cookies et données de sites pour ce domaine.
4. Fermer complètement le navigateur, le rouvrir, charger l’URL, puis **Installer COMPTAI** depuis la barre d’adresse.
5. Si l’ancienne icône persiste dans l’Explorateur : `ie4uinit.exe -show` reconstruit le cache d’icônes Windows (commande standard, sans suppression de données), puis se déconnecter/reconnecter si nécessaire.

### iOS / iPadOS (Safari)

1. Appui long sur l’icône → **Supprimer l’app** → Supprimer.
2. Réglages → Safari → Avancé → Données des sites web → supprimer le site.
3. Rouvrir l’URL dans Safari → Partager → **Sur l’écran d’accueil**.

### Navigateur de bureau, sans installation

1. Rechargement forcé : `Ctrl+Shift+R` (Windows/Linux) ou `Cmd+Shift+R` (macOS).
2. Outils de développement → Application → Stockage → **Clear site data**.
3. Recharger et vérifier l’onglet, le favicon et le manifeste (Application → Manifest).

### Procédure éditeur pour une future version du logo

1. Produire les nouveaux fichiers avec un **nouveau nom** (par exemple `comptai-192-v2.png`) : l’URL change et contourne les caches d’images.
2. Mettre à jour `manifest.webmanifest`, `index.html`, `browserconfig.xml` et le cas échéant `comptai-mark.svg`.
3. **Ne pas changer** `id`, `start_url`, `scope`, le nom du paquet, `appId` ni les clés `mc.*` : cela créerait une nouvelle identité d’installation ou casserait les données locales.
4. Déployer, puis incrémenter `CACHE_VERSION` dans `sw.js` (même si ce worker ne cache rien, cela documente la version).
5. Demander aux utilisateurs déjà installés de suivre la procédure de désinstallation/réinstallation ci-dessus : aucune application ne peut forcer un système à remplacer une icône déjà épinglée.

## 10. Limites et décisions à conserver

- Logo et nom **provisoires** ; aucune disponibilité juridique de « COMPTAI » n’est affirmée.
- Aucun test sur Android, iOS ou Windows physiques ; les tests jsdom ne prouvent pas le rendu natif.
- Aucun mode hors-ligne : le service worker ne cache rien, volontairement.
- Aucune capture d’écran de splash iOS : `apple-touch-startup-image` non configurée.
- La démonstration reste fictive et ne doit pas servir à des déclarations officielles.
- **PR nº 11 maintenue en brouillon** ; aucune fusion, aucun déploiement sur le site permanent sans autorisation expresse.
