# Mission 39 — Navigation globale et ergonomie responsive Windows / Android

**COMPTAI · branche `arena/1f7e6933-mauritius-compta` · 1er novembre 2026**

## 1. Résumé

La Mission 39 ajoute une navigation contextuelle commune à toute l’application, une barre latérale à trois modes (complète, rail compact, tiroir mobile), une barre de navigation rapide sur téléphone et un retour guidé conservant l’étape exacte du parcours de démonstration.

Aucun moteur comptable, aucune écriture, balance, état financier, immobilisation, stock, règle TVA ou paie, aucune donnée fictive M37, aucun mécanisme de sécurité ou de sauvegarde et aucune intégration IA n’a été modifié. Aucune dépendance n’a été ajoutée. Aucun déploiement, aucune fusion, aucune publication.

## 2. Référence et synchronisation

- Dépôt : `azharshahim/mauritius-compta`
- Branche : `arena/1f7e6933-mauritius-compta`
- Base : `main` au commit `06beaf5` (« Merge pull request #19 », Mission 38)
- Vérification avant travaux : `origin/main` = `06beaf5`, branche à 0 commit d’avance/retard, working tree propre.
- PR nº19 (Mission 38) déjà fusionnée par l’utilisateur ; aucune reprise de son périmètre.

## 3. Diagnostic

Le diagnostic complet est dans `docs/comptai-global-navigation-audit.md`.

### Problème A — retour

- aucun composant commun de retour/fil d’Ariane ;
- les liens Guided Demo ne mémorisaient pas l’étape d’origine ;
- risque de `navigate(-1)` hors application ;
- accès direct sans parent ;
- onglets immobilisations sans entrée d’historique.

### Problème B — barre latérale Windows

- un seul seuil à 900 px : disparition complète du menu sous ce seuil ;
- aucun rail compact entre 901 et 1 279 px ;
- aucun état réduit mémorisé ;
- bouton hamburger indisponible sur desktop réduit.

### Problème C — Android

- tiroir refermé à chaque navigation ;
- aucun accès rapide permanent ;
- risque de chevauchement avec l’assistant et les zones de sécurité ;
- cibles tactiles et clavier virtuel traités partiellement.

## 4. Comportements avant / après

| Sujet | Avant | Après |
|---|---|---|
| Retour | liens isolés selon l’écran | composant commun Back + fil d’Ariane sur tous les écrans authentifiés |
| URL directe | aucun retour évident | retour vers la page parente valide |
| Historique | `navigate(-1)` non encadré | retour navigateur seulement si une route interne a été visitée ; sinon parent |
| Guided Demo | perte du parcours | étape mémorisée, `/demo?step=N`, précédente/suivante |
| Windows ≥ 1280 | 264 px fixe | 264 px, réduction manuelle mémorisée |
| Windows 901–1279 | menu hors écran sous 900 seulement ; sinon 264 px | rail 72 px, menu complet temporaire |
| Windows ≤ 900 | tiroir sans barre rapide | tiroir + barre rapide persistante |
| Android | réouverture du tiroir à chaque page | Dashboard / Comptabilité / Banque / Démo / Menu toujours accessibles |
| Assistant | pastille basse | pastille décalée au-dessus de la barre rapide |
| Dialogues | Échap et focus entrant/sortant | piège de focus, Échap, confirmation de saisie, focus rendu |
| Onglets immobilisations | état local | `?tab=`, retour au registre |
| Langue | libellés existants | toutes les nouvelles commandes FR/EN |

## 5. Architecture livrée

### Nouveaux modules

- `apps/web/src/contextualNavigation.ts` : résout module, parent, fil d’Ariane et route de secours à partir de l’URL ; s’appuie sur `NAV_GROUPS`, ne crée pas de second menu.
- `apps/web/src/responsive.ts` : seuils 900/1280 px et écoute du redimensionnement.
- `apps/web/src/guidedTour.ts` : étape 0–15, 16 liens primaires, persistance `mc.guidedTour.v1`, bornage, chemin `/demo?step=N`.
- `apps/web/src/components/ContextualNav.tsx` : Back, fil d’Ariane, commandes Guided Demo, garde de dialogue modifié.
- `apps/web/src/components/MobileQuickNav.tsx` : barre rapide téléphone.

### Fichiers modifiés

`App.tsx` (trois modes de barre, rail, tiroir, barre rapide), `styles.css` (344 lignes de styles responsive), `i18n.tsx` (28 clés FR + 28 EN), `components/ui.tsx` (piège de focus et garde de saisie), `components/AppIcon.tsx` (icône Retour), `components/DemoBanner.tsx` (Échap + nettoyage du parcours), `pages/GuidedDemo.tsx` (position, précédente/suivante, retour), `pages/accounting/FixedAssets.tsx` (onglets `?tab=`).

## 6. Points de rupture retenus

| Plage | Mode | Justification |
|---|---|---|
| ≤ 900 px | téléphone / tablette portrait | 264 px de menu laisseraient moins de 640 px au contenu ; tiroir + barre rapide |
| 901–1 279 px | rail compact 72 px | conserve l’orientation du module et laisse ≥ 829 px au contenu |
| ≥ 1 280 px | barre complète 264 px | 1 016 px de contenu, groupes lisibles, réduction manuelle possible |

Le rail est visible par défaut dans la plage intermédiaire : la navigation n’est jamais totalement masquée quand l’espace permet une barre compacte.

## 7. Guided Demo

Conservés sans modification :

- 14 destinations (`QUICK_LINKS`) ;
- 16 étapes ;
- 8 contrôles de cohérence ;
- données fictives M37 ;
- Reset demo data.

Ajouts :

- étape courante affichée (1–16) et surlignée ;
- **Previous Step** / **Next Step** sur la page ;
- liens d’étape qui enregistrent l’étape d’origine ;
- barre de parcours sur l’écran ouvert : **Back to Guided Demo**, **Previous Step**, **Next Step**, étape courante, sortie du mode ;
- retour vers `/demo?step=N`, étape restaurée après rechargement ;
- Reset efface la position du parcours.

## 8. Dialogues, panneaux et accessibilité

- `Modal` : focus entrant, piège de Tab, Échap, focus rendu au déclencheur, confirmation si un champ a changé.
- Panneau de démonstration : Échap.
- Boutons Retour : libellé accessible même lorsque son texte est masqué à 360 px.
- Groupes du rail : libellé accessible (`sr-only`), `title`, `aria-expanded`, `aria-controls`.
- Barre rapide : `aria-label` sur chaque destination et bouton Menu, `aria-current="page"`.
- Fil d’Ariane : `aria-label`, `aria-current="page"`.
- Focus visible conservé sur les commandes ajoutées.
- Liens du fil d’Ariane filtrés par les droits du module.

## 9. Tests et résultats réels

### Local

| Contrôle | Résultat |
|---|---|
| `npm run typecheck` | succès (web + API) |
| Tests web | **55 fichiers / 370 tests réussis** |
| Tests API | **521 réussis + 11 ignorés** |
| `npm run build` | succès — JS 1 271,60 kB (315,95 gzip), CSS 75,48 kB (14,88 gzip) |
| `npm run build:demo` | succès — JS 1 300,35 kB (325,08 gzip), CSS 75,48 kB (14,88 gzip) + runtime 717,98 kB (199,42 gzip) |
| `verify-demo --dist` | **50/50** |
| `verify-demo --real-dist` | **5/5** |

### Nouveaux tests

- `mission39-navigation.test.ts` : 8 tests (contexte, parents, fallback, seuils, étape).
- `mission39-ui.test.tsx` : 16 tests (15 scénarios, dont dialogues, langue, étapes précédente/suivante et sortie du parcours).
- Les suites M26/M30/M36/M37/M38 restent vertes.
- Stabilisation d’un test M23 préexistant : il attend désormais le chargement asynchrone des comptes bancaires (`findByRole` au lieu de `getByRole`). L’assertion métier est inchangée ; aucun défaut de l’application n’est masqué.
- Stabilisation d’un test M39 : après le retour vers le registre, il attend le rendu de l’onglet (`waitFor`) avant de vérifier `aria-selected`. Aucune assertion n’a été supprimée ou affaiblie.

### Limite de navigateur réel

**Aucun test Playwright sur navigateur réel et aucun appareil Android physique n’a été exécuté.** `@playwright/test` est présent mais aucun binaire Chromium n’est installé et aucun navigateur graphique n’est disponible. jsdom vérifie les routes et les états, pas le rendu pixel. Les largeurs 360/390/768/1024/1280/1920 sont vérifiées par classes et interactions, pas par capture visuelle. Aucune capture d’écran n’est donc fournie.

## 10. Limites restantes

- Les onglets locaux autres qu’Immobilisations conservent leur état local et ne créent pas d’entrée d’historique.
- Les formulaires de page sans dialogue ne déclenchent pas de confirmation générique de perte de saisie.
- Les infobulles du rail reposent sur `title` et le libellé accessible, sans mesure visuelle réelle.
- Les tableaux conservent leur défilement horizontal interne ; l’absence de débordement global doit être confirmée sur appareil.
- Les détails de facture restent des dialogues sur la liste ; le fil d’Ariane affiche la liste, pas une route de détail inexistante.

## 11. Contraintes respectées

- Aucune modification des calculs comptables, écritures, journaux, états, immobilisations, stocks, TVA, paie.
- Aucune modification des données fictives M37.
- Aucune modification des mécanismes de sécurité, sauvegardes ou intégrations IA.
- Aucune nouvelle dépendance.
- Aucune donnée réelle.
- Aucun déploiement OVH, aucune publication GitHub Pages.
- Aucune fusion de PR.
- Anciennes URL et favoris conservés.
- Bilinguisme FR/EN sans texte codé en dur dans les nouveaux composants.
- Aucune affirmation de conformité IFRS/MRA/paie.

## 12. Livraison GitHub

- Branche : `arena/1f7e6933-mauritius-compta`
- PR : **nº20**, en **brouillon** — https://github.com/azharshahim/mauritius-compta/pull/20
- Commit de contenu initial : **`a689c96`** (`feat(web): add global contextual navigation and responsive shell (M39)`)
- Correctif de test : **`5e95fef`** (`test(m39): await the tab render after Back navigation`)
- CI de référence : **run `41342324960` vert** sur `5e95fef` — typecheck/tests/build, migrations PostgreSQL, tests API PostgreSQL
- Démo : **run `41342324964` vert** — build du bundle ; déploiement GitHub Pages ignoré
- Un run intermédiaire (`41341963031`) a échoué sur une attente de rendu d’onglet dans `mission39-ui` ; l’assertion est inchangée, le test attend désormais le cycle de rendu. La CI ci-dessus est la référence.
- Les éventuels commits documentaires suivants ne modifient ni le code ni les tests validés ci-dessus.

La PR reste **en brouillon** : aucune fusion, aucune publication, aucun déploiement.

## 13. Critères d’acceptation

| Critère | État |
|---|---|
| Back dans les principaux modules | vérifié par tests |
| Retour Guided Demo avec étape | vérifié `/demo?step=14` |
| Navigation Windows réduite | rail 1024, préférence 1280/1920 |
| Accès rapide Android | barre Dashboard/Comptabilité/Banque/Menu |
| Menus sans masquer les formulaires | rail sans recouvrement; tiroir fermable |
| Anciennes URL | redirections M38 inchangées, tests verts |
| Société, filtres, préférences | société + `?tab=` conservés ; réduction mémorisée |
| Tests automatiques verts | 370 web, 521 API |
| Aucun calcul comptable modifié | aucun fichier de calcul touché |

**COMPTAI n’est pas déclaré prêt pour la production.** Les points P0-03/P0-04/P0-05/P1-16 restent ouverts.
