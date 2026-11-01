# COMPTAI — Tests de navigation responsive

**Mission 39 · 1er novembre 2026**

## 1. Ce qui est vérifié

Les tests automatisés de cette mission couvrent deux niveaux :

1. **Contrat de navigation** (`apps/web/tests/mission39-navigation.test.ts`) : résolution du module, du parent, du fil d’Ariane, de la route de secours, seuils responsive et persistance de l’étape Guided Demo.
2. **Interface et parcours** (`apps/web/tests/mission39-ui.test.tsx`) : rendu réel de la coque avec `HashRouter`, authentification de démonstration, menu compact, tiroir mobile, barre rapide, boutons Retour, onglets, dialogues et changement de langue.

Les tests existants M26/M30/M36/M37/M38 restent la garde de non-régression de la navigation, du menu mobile, des anciennes URL et des libellés professionnels.

## 2. Largeurs demandées

| Largeur | Mode attendu | Ce qui est vérifié |
|---:|---|---|
| 360 px | téléphone | barre rapide, tiroir, assistant, société, changement de module |
| 390 px | téléphone | classe `view-mobile`, barre rapide |
| 768 px | tablette portrait | classe `view-mobile`, barre rapide maintenue |
| 1 024 px | fenêtre Windows réduite | rail compact, menu complet temporaire, pas de barre rapide |
| 1 280 px | bureau | barre complète, réduction manuelle |
| 1 920 px | grand écran | barre complète, état réduit mémorisé |

Seuils testés : `900 → mobile`, `901 → compact`, `1279 → compact`, `1280 → wide`.

## 3. Scénarios obligatoires

| # | Scénario | Preuve automatisée |
|---:|---|---|
| 1 | Trial Balance depuis Guided Demo, puis retour | `mission39-ui` : étape 14 conservée, `/demo?step=14`, étape courante |
| 2 | Trial Balance ↔ Balance Sheet | `mission39-ui` : bouton Back revient à la balance |
| 3 | Facture puis liste | contexte `Sales & Invoicing > Sales Invoices` et retour au tableau de bord Ventes sur accès direct |
| 4 | Rapport d’immobilisations puis registre | onglet `?tab=reports`, fil `Inventory & Fixed Assets > Fixed Assets > Reports`, Back vers `/accounting/assets` |
| 5 | Changer de module sur Android | barre rapide Comptabilité → Banque → Démo |
| 6 | Réduire/agrandir la fenêtre Windows | 1280 → 1024 → 1920, préférence conservée |
| 7 | Barre latérale compacte | rail 1024, ouverture depuis une icône, fermeture explicite |
| 8 | Recharger une URL directe | `/accounting/trial-balance` → parent `/accounting` |
| 9 | Précédent/Suivant du navigateur | `history.back()` / `history.forward()` entre deux écrans |
| 10 | Changer de société | valeur du sélecteur conservée après navigation, aucun appel réseau |
| 11 | Changer EN/FR | Back → Retour, fil d’Ariane traduit, `lang=fr` |
| 12 | Navigation clavier | Échap ferme tiroir/dialogue, focus rendu au déclencheur, Tab piégé dans le dialogue |
| 13 | Dialogues et panneaux | Échap, focus, confirmation de saisie non enregistrée |
| 14 | Assistant IA | pastille montée avec la barre rapide ; règle CSS de décalage vérifiée par lecture, sans calcul visuel |
| 15 | Aucune donnée comptable altérée | `fetch` espionné et non appelé dans toute la démonstration |

## 4. Tests ajoutés

### `mission39-navigation.test.ts` — 8 tests

- fil d’Ariane Comptabilité / Balance générale ;
- contextes Banque, Ventes, Achats, Immobilisations, Paie, Paramètres, Clôture ;
- chaîne parente des imports, dossiers société et bulletins ;
- route de secours valide pour chaque module, jamais la page courante ;
- écran préparé ;
- seuils responsive ;
- seize étapes alignées sur les seize liens primaires ;
- persistance, bornage et restauration de l’étape.

### `mission39-ui.test.tsx` — 16 tests

- retour exact depuis Trial Balance vers l’étape 14 ;
- Back vers l’écran précédent (balance, factures) ;
- onglet rapport d’immobilisations et retour au registre ;
- accès direct avec parent de module ;
- boutons Précédent/Suivant du navigateur ;
- étapes précédente/suivante depuis un écran ouvert par le parcours, puis retour à la même position ;
- sortie du parcours par un autre menu : les commandes guidées disparaissent ;
- barre rapide 360 px, ouverture du tiroir, Échap, Assistant, société ;
- rail compact, réduction large mémorisée, redimensionnements 1024/1920 ;
- matrice 390/768/1024/1280/1920 ;
- ouverture/fermeture du menu compact ;
- traduction EN/FR ;
- dialogue, focus, protection de saisie ;
- société conservée et absence d’appel réseau ;
- conservation d’un onglet/recherche dans l’URL au retour.

## 5. Commandes exécutées

```bash
npm ci
npm run typecheck
npm run test -w @mc/web
npm run test -w @mc/api
npm run build
npm run build:demo
node scripts/verify-demo.mjs --dist apps/web/dist --base /mauritius-compta/
node scripts/verify-demo.mjs --real-dist apps/web/dist --base /mauritius-compta/
```

## 6. Résultats locaux

| Contrôle | Résultat |
|---|---|
| Typecheck web | succès |
| Tests web | **55 fichiers / 370 tests réussis** |
| Tests API | **521 réussis + 11 ignorés** |
| Build production | succès (sortie détaillée dans le rapport M39) |
| Build démonstration | succès |
| `verify-demo` démonstration | **50/50** |
| `verify-demo --real-dist` | **5/5** |

## 7. Limites de la vérification

- **Aucun test Playwright sur navigateur réel n’a été exécuté.** Le paquet `@playwright/test` est présent, mais aucun navigateur n’est installé (`~/.cache/ms-playwright` est absent) et le téléchargement des navigateurs n’est pas autorisé dans cet environnement. `npx playwright --version` répond `1.64.1`, sans binaire Chromium.
- **Aucun appareil Android physique** n’a été utilisé.
- jsdom ne calcule pas les styles : les largeurs de colonnes, le débordement horizontal, la position exacte de l’assistant et les zones de sécurité doivent être confirmés visuellement sur Windows et Android.
- Aucune capture d’écran n’est fournie : aucun navigateur graphique n’est disponible dans la session.
- Les onglets locaux autres qu’Immobilisations ne créent pas d’entrée d’historique.
- La confirmation de saisie non enregistrée est appliquée aux dialogues ; les formulaires de page sans dialogue ne sont pas interceptés génériquement.

## 8. Ce qu’il reste à valider manuellement

1. 360 px et 390 px sur Chrome Android : clavier virtuel, barre rapide, tiroir, sélecteur société.
2. 768 px sur tablette portrait : tableaux, menu, assistant.
3. 1 024 px sur Windows : rail, infobulles, ouverture temporaire.
4. 1 280 px et 1 920 px : réduction, persistance après rechargement.
5. Mode paysage Android : hauteur du tiroir et de la barre rapide.
6. Absence de défilement horizontal de la page sur les écrans comptables larges.
7. Contraste et focus visibles sur les trois thèmes/tailles.
