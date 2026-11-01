# Mission 24 — Vérification finale de la démonstration GitHub Pages

_État au 1er novembre 2026. Branche `arena/35525a62-mauritius-compta`, PR nº 7 en
brouillon. **Aucune fusion, aucune publication, aucun déploiement OVH, aucune donnée
réelle, aucun envoi.** Le hash HEAD final est celui de la PR après le commit de ce
rapport._

## 1. Objet

Vérifier que la démo publiée après fusion présentera réellement les fonctions fictives
des missions 22, 23 et 24, que la bascule FR/EN et la navigation profonde fonctionnent,
et que le workflow Pages ne peut publier que depuis `main`.

## 2. Fonctionnalités vérifiées dans le build de démonstration

Build exécuté avec `VITE_BUILD_COMMIT=deadbee npm run build:demo`, puis servi avec
`vite preview --base /mauritius-compta/`.

| Domaine | Vérification | Résultat |
| --- | --- | --- |
| Stocks (mission 22) | FIFO-COMM, DEMO-FIFO-01, rapprochement équilibré, onglet Rapports | présent |
| Édition des stocks (mission 24) | formulaire prérempli catégorie/emplacement/article, `PUT` de démonstration | testé par clic |
| Facturation | FAC-DEMO-0002 émise, ouverture de la fiche | présente |
| Pont facture → stock (mission 24) | bouton « Proposer les mouvements de stock », choix article/emplacement/quantité, création de mouvements `PROPOSED` | testé par clic |
| Contrôle du pont | quantité supérieure à la facture refusée avec le message traduit | testé |
| OCR (mission 23) | documents fictifs, avertissement « résultats préenregistrés », doublon, PLH-2210 | présent |
| Import MCB (mission 23) | relevé fictif, continuité des soldes, aperçu avant import | présent |
| Plan comptable bilingue (mission 23) | statut provisoire, libellés FR/EN, numéros inchangés | présent |
| Mappings comptables (mission 24) | carte « Mappings comptables » et rôles traduits | présente |
| Assistant supervisé | `deterministic-supervised`, `executionEnabled: false`, un outil `prepare` seulement | testé |
| FR/EN | bascule sur plan comptable, stocks et navigation ; version/commit inchangés | testé |
| Version et commit | chaîne `Version x.y.z · commit …` rendue dans la barre latérale | testé |
| Données | uniquement les jeux fictifs `DEMO-*`, `FAC-DEMO-*`, `PLH-2210` ; aucun `fetch` dans les nouveaux parcours | testé |
| Lien profond | `#/accounting/inventory?tab=movements` conservé après un rechargement simulé | testé |
| 404 / rechargement | `404.html` présent, redirige `/mauritius-compta/<chemin>` vers `#/<chemin>` | vérifié dans le build |

Le build servi contient bien le commit injecté, la gouvernance de l’assistant, le pont
stock, les mappings et l’import MCB. Le bundle fait environ 1,80 Mo (466 kB gzip) ;
`AssistantPanel` reste un chunk séparé.

## 3. Workflow GitHub Pages

`.github/workflows/pages.yml` a été revu et corrigé :

- **Publication** : uniquement sur `push` vers `main` ou `workflow_dispatch` sur
  `main`, via la condition
  `${{ (github.event_name == 'push' || github.event_name == 'workflow_dispatch') && github.ref == 'refs/heads/main' }}`.
- **Branches Arena** : ajout de `arena/**` au déclencheur `push`. Elles construisent et
  testent la démo, mais l’upload et le déploiement restent ignorés.
- **Pull requests** vers `main` : typecheck, tests web, build de démo, contrôles du
  bundle et scan de secrets, sans publication.
- **Après fusion approuvée** : le push résultant sur `main` déclenche automatiquement
  build puis déploiement.
- **Concurrence** : les builds sont annulables par ref ; le déploiement utilise un
  groupe `pages` non annulable.
- **Permissions** : `contents: read` au niveau du workflow ; `pages: write` et
  `id-token: write` uniquement sur le job de déploiement.
- **Contrôles HTTPS** : après déploiement, le workflow attend la réponse 200 de
  `https://azharshahim.github.io/mauritius-compta/`, vérifie l’asset JS, les écrans des
  missions 6 à 24, les échantillons fictifs, `404.html` et un lien profond `/entries`.
- **Secrets** : le bundle est analysé avant upload (`sk-…`, `AIza…`, clé privée PEM).
  Aucun secret n’a été détecté.
- **Simulation** : le bandeau et les écrans de démonstration restent explicitement
  marqués ; aucune clé, aucun appel API, aucun serveur réel.

Les runs de la PR nº 7 ont montré « Build demo bundle » en succès et
« Deploy to GitHub Pages » en statut `skipping`, ce qui confirme qu’une branche Arena
ne publie pas.

## 4. Corrections effectuées

1. **Pont facture → stock de la démo** : validation alignée sur l’API réelle. Chaque
   `billingLineId` doit appartenir à la facture, la quantité doit être positive et ne
   pas dépasser la quantité facturée ; la description reprend la ligne facturée. Avant
   cette correction, la démo acceptait une quantité que le serveur aurait refusée.
2. **Déclencheur Pages** : les pushes sur les branches `arena/**` construisent et
   testent désormais la démo, sans upload ni déploiement.
3. **Tests de démonstration** : nouveau fichier `apps/web/tests/mission24-ui.test.tsx`
   (5 tests) et gouvernance du catalogue ajoutée à `demo-assistant.test.ts` (1 test).

## 5. Tests exécutés

| Commande | Résultat |
| --- | --- |
| `npm run typecheck` (API + web) | 0 erreur |
| Suites ciblées mission 22, 23, 24, assistant, i18n | **43/43**, 7 fichiers |
| `VITE_BUILD_COMMIT=deadbee npm run build:demo` | succès |
| Contrôles `grep` du bundle | version, commit, OCR, MCB, mappings, pont stock, gouvernance : OK |
| Scan de secrets du bundle | aucun motif détecté |
| CI GitHub complète | exécutée sur la PR nº 7 après push ; résultat dans la PR |

Les suites complètes ne sont pas rejouées localement à chaque itération : la CI de la
PR exécute le typecheck, tous les tests web, les tests API PostgreSQL, les migrations
et le build de démo.

## 6. Limites de vérification

- Aucun navigateur Playwright/Chromium n’est installé dans cet environnement : les
  parcours sont testés en jsdom sur le code de démonstration réel, pas par clic dans un
  navigateur packagé. Aucun test Samsung Android physique ni Chrome Windows.
- L’URL publique n’a pas été interrogée et aucun déploiement n’a été déclenché : la
  vérification HTTPS est intégrée au workflow et s’exécutera après fusion autorisée.
- La redirection `404.html` est vérifiée statiquement ; son exécution réelle sur GitHub
  Pages sera contrôlée par le job de vérification post-déploiement.

## 7. Conclusion

La démo est prête à être fusionnée **après autorisation explicite**. La fusion sur
`main` déclenchera automatiquement la publication GitHub Pages. Aucun blocage technique
connu ne subsiste ; les seules limites sont l’absence de test sur appareil physique et
la vérification de l’URL publique, qui ne peut avoir lieu qu’après le déploiement.
