# Mission Nº3 — Démonstration publique HTTPS (GitHub Pages)

**Date** : 31 octobre 2026
**Branche** : `arena/b0b62798-mauritius-compta` (aucune fusion, `main` inchangée)
**État** : démo en ligne et vérifiée depuis GitHub ; validation visuelle sur appareils à faire par le propriétaire

---

## 1. URL exacte

```
https://azharshahim.github.io/mauritius-compta/
```

```
E-mail       : demo@mauritius-compta.test   (pré-rempli sur la page de connexion)
Mot de passe : DemoPassw0rd2026             (pré-rempli)
Société      : Lagon Bleu Trading Ltd (DEMO)
```

Le site est servi en HTTPS par GitHub Pages, avec un certificat valide, et fonctionne sans
backend : aucune base PostgreSQL, aucune API, aucun secret.

## 2. Preuves de fonctionnement (exécutées, pas supposées)

| Vérification | Résultat | Où |
|---|---|---|
| Déploiement Pages | ✅ succès | run Actions [41146643105](https://github.com/azharshahim/mauritius-compta/actions/runs/41146643105) |
| Page d'accueil sur l'URL publique | ✅ HTTP **200** | annotation du run : `URL https://azharshahim.github.io/mauritius-compta/ -> index 200` |
| Bundle JavaScript réellement publié | ✅ HTTP 200, **397 702 octets** (`/mauritius-compta/assets/index-NWilYo3Y.js`) | même annotation |
| Mode démo embarqué dans le bundle | ✅ `MODE DÉMONSTRATION` + `mc.demo.state.v1` présents | étape `grep` du workflow |
| `404.html` (repli SPA) | ✅ HTTP **200** | même annotation |
| Lien profond `/mauritius-compta/entries` | ✅ HTTP 404 servi par notre page de redirection vers `#/entries` (comportement normal de Pages, vérifié par `grep`) | étape du workflow |
| Chemin de base des ressources | ✅ `src="/mauritius-compta/assets/…"` | étape `Check bundle references the project base path` |
| CI applicative (qualité, API PostgreSQL, migrations) | ✅ 3/3 verte sur `40a6c1e` | run [41146648619](https://github.com/azharshahim/mauritius-compta/actions/runs/41146648619) |
| Tests web jsdom (moteur + écrans + formatage) | ✅ **19/19** | `npm run test -w @mc/web`, aussi exécuté dans la CI |

Ces vérifications sont exécutées **depuis le réseau de GitHub** (runner Actions), parce que
l'environnement de l'assistant n'a pas accès à `*.github.io` (liste blanche réseau).

## 3. Ce qui est simulé (utilisable dans le navigateur)

Tout passe par le même client API (`apps/web/src/api.ts`) ; en mode démo, les appels sont
traités par `apps/web/src/demo/runtime.ts` :

- connexion / déconnexion / inscription, sélection de société, tableau de bord ;
- plan comptable (création, modification, désactivation, suppression contrôlée) ;
- journaux ; écritures : brouillon, validation, modification/suppression d'un brouillon,
  immutabilité des écritures validées, contrepassation ;
- numérotation par séquence, références uniques, contrôle d'équilibre, devises MUR/EUR/USD/GBP
  avec taux daté, périodes (clôture/réouverture) ;
- grand livre, balance, états financiers, taux de change, membres, audit local ;
- exports **CSV** (BOM UTF-8, `;`, neutralisation des formules).

Données : société fictive, 35 comptes, 5 journaux, 9 écritures (dont un brouillon et une
contrepassation). Tout est stocké dans le `localStorage` du visiteur (clé
`mc.demo.state.v1`), réinitialisable par le bouton du bandeau.

## 4. Ce qui nécessite le backend réel

| Fonction | Raison |
|---|---|
| Pièces jointes | stockage serveur + contrôle binaire → `501 DEMO_UNSUPPORTED` |
| Export PDF officiel | généré par PDFKit côté API ; en démo le bouton ouvre l'impression du navigateur |
| Sessions, mots de passe hachés, verrouillage de compte | Argon2id + cookies `HttpOnly` côté serveur |
| Persistance, sauvegardes, audit inaltérable | PostgreSQL + triggers |
| Concurrence et isolation multi-société en base | contraintes PostgreSQL |
| TVA / MRA / e-invoicing / paie / impôt | non implémentés (voir `docs/mauritius-regulations/`) |

## 5. Sécurité et honnêteté de la démonstration

- **Aucun appel réseau** : un test vérifie que `fetch` n'est jamais invoqué en mode démo.
- **Aucun secret**, aucun `.env`, aucune donnée réelle : données inventées.
- **Bandeau permanent non fermable** : « MODE DÉMONSTRATION — données fictives, stockées
  uniquement dans ce navigateur. Les écritures sont simulées : rien n'est enregistré sur un
  serveur ». Aucune opération simulée n'est présentée comme enregistrée côté serveur.
- **Dépôt = source de vérité** : seuls `apps/web/dist` (HTML/JS/CSS/404) sont publiés ;
  `apps/api`, `.env*`, `apps/api/.data`, `node_modules` ne le sont jamais.
- Avertissement automatique si le stockage local est indisponible (navigation privée) :
  les saisies ne seront pas conservées.

## 6. Corrections trouvées pendant cette mission

1. **Règles des hooks React (bug bloquant)** — `App` déclarait deux `useEffect` après des
   retours anticipés ; au changement d'état de session, React levait « Rendered more hooks
   than during the previous render » et l'écran plantait. Détecté par les tests jsdom,
   corrigé (hooks déplacés avant les retours).
2. **Date d'écriture hors période** — la modale proposait la date du jour (31/10/2026),
   hors de l'exercice 2025-07-01 → 2026-06-30 : impossible d'enregistrer sans changer la
   date (`PERIOD_CLOSED`). Désormais la date proposée est couverte par une période ouverte.
3. **Build GitHub Pages** — base d'URL et routage par hash ; `404.html` de redirection.

## 7. Limites honnêtes

- **Aucun navigateur automatisé n'a pu être exécuté** : Playwright/Chromium n'est pas
  installable dans l'environnement de l'assistant (`cdn.playwright.dev` inaccessible). Les
  scénarios sont donc exécutés en **jsdom** (React réel, routeur réel, moteur réel), pas en
  Chrome. **Le rendu visuel, le tactile et le défilement sur un Samsung réel et sous Windows
  restent à valider par le propriétaire** en ouvrant l'URL ci-dessus.
- Les PDF ne sont pas générés côté navigateur (impression uniquement).
- Les pièces jointes ne sont pas disponibles en démonstration.
- Données de démonstration non persistées côté serveur : par conception.

## 8. Git et GitHub

- Commits ajoutés (8) : `f33d212` → `40a6c1e` sur `arena/b0b62798-mauritius-compta`.
- `main` : **inchangée** (dernier commit `9e46f16`).
- PR #1 : **toujours en brouillon, non fusionnée** ; elle inclut désormais le mode démo.
- Workflow ajouté : `.github/workflows/pages.yml` (build + tests + déploiement + smoke test HTTPS).
- Aucun déploiement OVH, aucun service payant.

## 9. Détail d'exploitation utile

- Le job de déploiement ne déclare **pas** `environment: github-pages` : l'environnement du
  dépôt n'autorise que les branches protégées, et la démo doit partir de la branche de
  développement sans passer par `main`. Les permissions explicites (`pages: write`,
  `id-token: write`) suffisent.
- Pour redéployer : nouveau commit sur la branche (chemins `apps/web/**`, `package*.json` ou
  le workflow), ou `workflow_dispatch` depuis l'onglet Actions.
