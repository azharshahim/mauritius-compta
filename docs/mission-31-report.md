# Mission 31 — correction du workflow GitHub Pages

Date : 2026-11-01  
Branche : `arena/56497d31-mauritius-compta` (branche de session dédiée à la mission 31)  
Base : `main` = `803f0580109293536a5da9d80eeb21be16a72512`  
PR : **nº 12 — brouillon** (à confirmer après création)  
Statut : **corrigé localement et poussé en brouillon ; aucune fusion, aucun déploiement manuel.**

## 1. Cause exacte de l’échec du workflow nº 72

Exécution concernée : [run 41302566545](https://github.com/azharshahim/mauritius-compta/actions/runs/41302566545), job `Deploy to GitHub Pages` (`124836758287`).

| Étape | Résultat |
|---|---|
| `Build demo bundle` | ✅ succès |
| `actions/configure-pages@v5` | ✅ succès |
| `actions/deploy-pages@v4` | ✅ succès — déploiement accepté |
| `Verify the published HTTPS URL` | ❌ **échec** |
| `Complete job` | succès technique |

Le déploiement lui-même était donc réussi ; seule la **vérification post-déploiement** échouait.

Le script de vérification téléchargeait **un seul fichier JavaScript**, le premier référencé par `index.html` :

```bash
asset=$(grep -o '/mauritius-compta/assets/[^"]*\.js' /tmp/index.html | head -1)
curl ... -o /tmp/app.js "https://azharshahim.github.io$asset"
```

Or la mission 30 a déplacé le moteur de démonstration dans un **chunk dynamique séparé** `runtime-*.js`. Le premier contrôle qui échoue dans l’ordre du script est donc :

```bash
grep -q 'mc.demo.state.v1' /tmp/app.js
```

`mc.demo.state.v1` n’existe plus que dans `runtime-*.js`, pas dans `index-*.js`. Le script s’arrête ensuite avant les contrôles suivants.

Le contrôle `grep -q 'Mauritius Business Suite' /tmp/app.js` était **également obsolète** : la marque est COMPTAI depuis la mission 30. Il n’était toutefois pas la première cause d’arrêt. Le build, lui, passait parce qu’il cherchait dans `assets/*.js` (tous les chunks) et ne testait pas MBS.

Autres faiblesses du contrôle précédent :

- aucune vérification réelle du manifeste, des icônes 192/512/maskable, du favicon, de `sw.js` ou de `browserconfig.xml` ;
- aucun suivi des imports dynamiques ;
- `grep -q` silencieux : en cas d’échec, seul `exit code 1` apparaissait ;
- vérification des exemples fictifs partielle ;
- aucune preuve que le build **réel** ne contient pas les données de démonstration.

## 2. Contrôles obsolètes corrigés

| Ancien contrôle | Correction |
|---|---|
| Un seul `app.js` supposé contenir tout le bundle | Découverte récursive des imports `./chunk-*.js` depuis le bundle principal, puis téléchargement et analyse de chaque chunk |
| `grep 'Mauritius Business Suite'` | Supprimé ; contrôle explicite de **COMPTAI** et contrôle d’**absence** de l’ancienne marque MBS |
| `grep 'mc.demo.state.v1'` dans le bundle principal | Déplacé vers le corpus complet ; contrôle spécifique du chunk `runtime-*.js` |
| `grep 'Taux de démonstration 15'` dans le bundle principal | Vérifié dans le corpus complet (le marqueur vit dans le runtime) |
| `grep 'ACME OFFICE SUPPLIES LTD'`, `PLH-2210`, `FA-2025-0001`, etc. | Vérifiés dans le corpus complet, y compris le chunk dynamique |
| `grep -q` sans message | Chaque contrôle produit `OK` ou `::error title=<contrôle>::<ressource> — <message>` avec le code HTTP |
| Aucun contrôle PWA | `manifest.webmanifest`, nom/nom court, 192/512, maskable 192/512, favicon SVG/ICO, Apple Touch, `browserconfig.xml`, `mstile-150`, `sw.js` |
| Aucun contrôle des exemples | Les 13 fichiers `samples/*` sont vérifiés (CSV et XLSX, signature ZIP pour XLSX) |
| Aucun contrôle du build réel | Le workflow construit un bundle réel dans `apps/web/dist-real` et vérifie l’absence de `runtime-*.js`, identifiants, état local et fixtures |
| Aucun contrôle des liens profonds | `404.html` et `/entries` sont vérifiés ; le statut 404 du fallback est accepté avec le bon contenu |

Les contrôles de fonctionnalités restent nombreux (marqueurs de démonstration, état local, TVA, migration, banque, documents, missions 24–27) mais sont désormais exécutés sur le **corpus complet**, pas sur un fichier supposé unique.

## 3. Fichiers modifiés

| Fichier | Nature |
|---|---|
| `.github/workflows/pages.yml` | remplacement des deux étapes de vérification, ajout du build réel, ajout de `scripts/**` aux déclencheurs, `contents: read` et checkout dans le job de déploiement |
| `scripts/verify-demo.mjs` | nouveau vérificateur local/HTTPS sans dépendance externe |
| `docs/mission-31-report.md` | ce rapport |

Aucun fichier applicatif, comptable, fiscal, OCR ou de migration n’a été modifié.

## 4. Tests réalisés et résultats

| Test | Résultat |
|---|---|
| Syntaxe du script : `node -c scripts/verify-demo.mjs` | ✅ |
| Syntaxe YAML : `npx js-yaml .github/workflows/pages.yml` | ✅ deux jobs, étapes attendues |
| Conditions de publication parsées | ✅ `upload-pages-artifact` et `deploy` restent limités à `github.ref == 'refs/heads/main'` |
| Build démo : `npm run build:demo` | ✅ `index-*.js` + `runtime-*.js` + `AssistantPanel-*.js` |
| Vérificateur local sur `apps/web/dist` | ✅ **50 contrôles réussis, 0 échec** |
| Vérificateur en mode HTTP contre un miroir local de `dist` | ✅ **50 contrôles réussis, 0 échec** (mêmes chemins `/mauritius-compta/`, y compris `/entries` en 404) |
| Build réel : `npx vite build --outDir dist-real` | ✅ 2 fichiers JS, aucun chunk runtime |
| Vérificateur `--real-dist` | ✅ **5 contrôles réussis** : aucun identifiant, état local, fixture ou chunk de démonstration |
| Test négatif : `runtime-*.js` supprimé + manifeste renommé MBS | ✅ échec attendu (`exit 1`) avec **8 erreurs nommées**, dont `Chunk JavaScript dynamique runtime-*.js — HTTP 404` et `Nom du manifeste — name="Mauritius Business Suite"` |
| `npm run typecheck -w @mc/web` | ✅ 0 erreur |

La suite comptable complète n’a **pas** été relancée inutilement : cette mission ne touche aucun code applicatif. La CI de la PR exécute néanmoins les tests web et les vérifications de build.

## 5. Vérifications de sécurité conservées

- `permissions` du workflow : `contents: read` global ; le job de déploiement ajoute uniquement `pages: write` et `id-token: write`, avec `contents: read` pour le checkout du vérificateur.
- Publication toujours limitée à `main` et à un `push`/`workflow_dispatch` sur `refs/heads/main`. Une PR ou une branche Arena construit et teste, mais **n’upload jamais l’artefact et ne déploie jamais**.
- Le scan de secrets existant est conservé (`sk-…`, `AIza…`, clés privées) sur `apps/web/dist`.
- Le nouveau vérificateur effectue en plus un scan de motifs de secrets sur le HTML et tous les chunks JS publiés (jetons GitHub/Slack inclus), avec valeur masquée en cas d’échec.
- Aucun secret réel, aucune donnée client, aucun identifiant bancaire réel n’a été introduit.
- Aucun backend réel n’est déployé : le site reste une démonstration 100 % navigateur.

## 6. Numéro de la nouvelle PR

**PR nº 12**, ouverte en **brouillon** vers `main` : à confirmer par l’URL GitHub après création.

## 7. Statut des contrôles GitHub Actions

| Contrôle | Statut attendu |
|---|---|
| `Build demo bundle` | à vérifier après le push de la PR |
| `Verify the demo bundle` | à vérifier |
| `Build real bundle for demo/real separation check` | à vérifier |
| `Verify the real bundle excludes demo data` | à vérifier |
| `Scan the demo bundle for secrets` | à vérifier |
| `Deploy to GitHub Pages` | **ignoré** sur PR/branche Arena |
| `API tests against real PostgreSQL` | hors périmètre de cette PR (workflow séparé) ; ne doit pas être relancé inutilement |

Le job de déploiement ne sera réellement vérifié qu’après fusion autorisée dans `main`. D’ici là, le contrôle HTTPS distant n’est pas exécuté par la PR, conformément à la restriction « seule `main` publie ».

## 8. Limitations restantes

- L’environnement de l’assistant ne peut pas atteindre `*.github.io` en sortie ; le mode `--url` a donc été testé contre un **miroir HTTP local** qui sert exactement `apps/web/dist` sous `/mauritius-compta/`. La CI GitHub, elle, exécutera le mode `--url` sur le site réel.
- GitHub Pages peut mettre quelques secondes à propager le nouvel artefact ; le vérificateur attend jusqu’à **180 s** pour `index.html`, puis réessaie les ressources manquantes. Il ne masque pas une erreur définitive : chaque échec reste nommé et code HTTP inclus.
- Le workflow ne peut pas prouver l’absence de secret dans des ressources qui ne sont pas référencées par `index.html` et ne sont pas dans les 13 exemples connus ; le scan local `grep -RIlE` conserve une couverture de tout `apps/web/dist`.
- Le contrôle du build réel dépend de la capacité de Vite à produire `dist-real` dans le runner ; c’est le même build que `npm run build`, déjà vérifié en mission 30.
- Aucune fusion ni publication automatique : la vérification du run Pages définitif aura lieu après autorisation et fusion dans `main`.
