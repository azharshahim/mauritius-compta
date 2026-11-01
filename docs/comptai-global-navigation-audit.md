# COMPTAI — Audit de la navigation globale et responsive

**Mission 39 · état au 1er novembre 2026**

Périmètre : coque authentifiée de `apps/web`, tous les modules Cabinet, Comptabilité, Ventes, Achats, Banque, Stocks et immobilisations, Paie, Rapports et Paramètres. Aucun moteur comptable, aucune règle TVA/paie, aucune donnée de démonstration et aucun mécanisme de sécurité n’a été modifié.

## 1. Méthode

L’audit a précédé toute modification. Il a porté sur :

- `apps/web/src/App.tsx` : coque, routes, menu latéral, gestion du menu mobile, montage de l’assistant ;
- `apps/web/src/navigation.ts` : dix groupes et soixante destinations existantes ;
- `apps/web/src/i18n.tsx` : libellés FR/EN des groupes, pages et commandes ;
- `apps/web/src/styles.css` : grille de la coque, media queries, `safe-area`, assistant ;
- `apps/web/src/pages/GuidedDemo.tsx` : quatorze liens rapides, seize étapes, contrôles de cohérence ;
- les écrans à onglets : `Entries`, `Bank`, `Settings`, `FinancialYears`, `FixedAssets`, `Inventory`, `Purchases`, `Accruals`, `Provisions`, `Equity`, `Lettering`, `MultiCurrency` ;
- les dialogues (`components/ui.tsx`), le panneau assistant et le panneau de démonstration ;
- les tests de navigation M26, M30, M36, M37 et M38, complétés par les tests M39.

Constats vérifiés avant modification :

| Élément | Comportement observé |
|---|---|
| Menu latéral | 264 px au-dessus de 900 px, hors écran en dessous de 900 px |
| Bouton hamburger | visible uniquement sous 900 px (`.mobile-only`) |
| Réduction Windows | aucun état intermédiaire : le menu disparaît entièrement sous 900 px |
| Mémorisation | seule la préférence de thème est stockée ; aucun état réduit/déployé du menu |
| Fermeture du menu | à chaque changement de `pathname` ou de `search`, et avec Échap |
| Retour | quelques liens internes isolés (`BankMcb`, `BulkReconciliation`, imports) ; aucun composant commun |
| Fil d’Ariane | absent |
| Guided Demo | seize étapes statiques ; les liens ouvrent les écrans sans mémoriser l’étape d’origine |
| Onglets | certains dans l’URL (`Bank`, `Settings`, `FinancialYears`, `Entries`), d’autres en état local (`FixedAssets`, `Inventory`…) |
| Dialogues | fermeture par Échap et bouton ×, focus entrant/sortant, mais pas de piège de focus ni de garde de modifications |
| Assistant IA | pastille fixe en bas à droite, panneau plein écran sous 720 px |
| Droits | le menu est filtré par `moduleAllowed` ; l’API reste l’autorité finale |
| Anciennes URL | `LEGACY_REDIRECTS` conservés depuis la Mission 38 |

## 2. Causes des trois problèmes

### Problème A — retour aux écrans précédents

1. **Aucun composant de navigation contextuelle.** Chaque écran décide seul s’il affiche un retour ; beaucoup n’en affichent aucun.
2. **Aucune notion d’origine.** Les liens de Guided Demo sont de simples `Link` : une fois Trial Balance ouvert, l’information « étape 14 » n’existe plus.
3. **Retour confié au navigateur.** Sans historique interne fiable, un `navigate(-1)` peut sortir de COMPTAI ou revenir à la page de connexion.
4. **Accès direct non traité.** Une URL ouverte directement n’a pas de parent visuel ; l’utilisateur ne sait pas revenir à Comptabilité.
5. **Onglets non homogènes.** Un onglet local (par exemple le rapport d’immobilisations) ne crée aucune entrée d’historique.

### Problème B — barre latérale Windows

1. **Un seul point de rupture (900 px).** En dessous, la barre passe en tiroir hors écran ; au-dessus, elle reste fixe à 264 px.
2. **Aucun mode compact.** Réduire une fenêtre Windows fait donc perdre la navigation permanente d’un coup.
3. **Aucune préférence persistante.** L’état réduit/déployé n’est pas mémorisé.
4. **Bouton hamburger réservé au mobile.** Le bouton n’est pas disponible dans la zone 900–1279 px.

### Problème C — navigation Android

1. **Tiroir refermé à chaque navigation** (`pathname` et `search`), donc réouverture fréquente pour changer de module.
2. **Aucun accès rapide permanent** aux modules principaux.
3. **Risque de chevauchement** entre la pastille de l’assistant, le bas de page et les zones de sécurité Android.
4. **Cibles tactiles et clavier virtuel** traités partiellement : les champs passent à 16 px, mais la navigation n’offrait pas de barre inférieure dédiée.

## 3. Décisions d’architecture

- **Un seul moteur de navigation** : `NAV_GROUPS` reste l’unique définition du menu. Aucun second arbre de navigation n’a été créé.
- **Un résolveur de contexte** (`contextualNavigation.ts`) traduit une URL en module, parent, fil d’Ariane et route de secours. Il ne duplique pas les destinations : il s’appuie sur `NAV_GROUPS` et complète uniquement les routes de détail/import.
- **Un marqueur de parcours** (`guidedTour.ts`) mémorise l’étape et l’activité du parcours dans `localStorage`. Le routeur reste seul propriétaire de l’URL.
- **Trois modes visuels avec le même DOM** : téléphone, rail compact, barre complète. Aucune destination ne disparaît d’un mode à l’autre.
- **Points de rupture : 900 px et 1280 px.**
  - ≤ 900 px : téléphone/tablette portrait, tiroir complet + barre rapide ;
  - 901–1279 px : rail d’icônes de 72 px, menu complet temporaire ;
  - ≥ 1280 px : barre de 264 px, réduction manuelle mémorisée.
  - Justification : 264 px de menu + 16 px de gouttières laissent 1 000 px de contenu à 1280 px ; sous 901 px, une barre de 264 px laisserait moins de 640 px au contenu comptable. Le rail de 72 px préserve l’orientation du module sans écraser les tableaux.

## 4. Couverture des modules

| Famille | Routes vérifiées | Contexte parent |
|---|---|---|
| Cabinet | `/cabinet`, `/cabinet/companies`, `/cabinet/companies/:id`, `/cabinet/tasks`, `/cabinet/team` | Cabinet / Client Portfolios |
| Comptabilité | `/accounting`, plan, écritures, grand livre, balance, exercices | Comptabilité |
| Journaux | `/accounting/journals/purchases`, `sales`, `bank`, `general`, imports | Journal Entries → journal concerné |
| Banque | `/accounting/banking`, onglets, MCB, PDF, rapprochement groupé | Banking |
| Ventes | tableau de bord, clients, devis, factures, avoirs, paiements, aging | Sales & Invoicing |
| Achats | tableau de bord et six onglets | Purchases & Expenses |
| Stocks / immobilisations | `/accounting/inventory`, `/accounting/assets` (+ onglets) | Inventory & Fixed Assets |
| Paie | tableau de bord, employés, contrats, bulletins, déclarations, transfert | Payroll |
| Rapports | bilan, compte de résultat, autres états, capitaux propres | Reports |
| Paramètres | comptables, société, périodes, audit, données, migration, IA | Settings |
| Détails | dossier société, paramètres société, bulletin de paie | parent de liste réel |
| Écrans annoncés | `/billing/:section`, `/accounting/ifrs`, `/payroll/:section` | « Prepared screen », parent du module |

Les anciennes URL (`/journals`, `/financial-years`, `/year-end-closing`, etc.) passent toujours par `LEGACY_REDIRECTS`; le composant contextuel s’affiche après la redirection, sur la route canonique.

## 5. Onglets, dialogues et panneaux

- Les onglets déjà portés par l’URL (`Bank`, `Settings`, `FinancialYears`, `Entries`) conservent leur comportement et leurs paramètres.
- Les onglets **Immobilisations** sont désormais portés par `?tab=` : un rapport crée une entrée d’historique et le bouton Retour revient au registre. Les anciens liens sans `?tab=` ouvrent le registre. Le fil d’Ariane d’un rapport affiche `Inventory & Fixed Assets > Fixed Assets > Reports` (`?tab=reports`), avec repli sur le registre en accès direct.
- Les autres onglets locaux (stocks, provisions, etc.) restent accessibles directement par leur barre d’onglets ; leur état n’est pas transformé en URL dans cette mission pour ne pas modifier leur logique métier. Limite documentée.
- `Modal` : piège de focus, Échap, retour du focus au déclencheur, verrou de fermeture en cas de saisie non enregistrée (`window.confirm` traduit).
- L’assistant est un panneau non modal : Échap fonctionne déjà, aucun champ n’est focalisé automatiquement.
- Le panneau d’explication de la démonstration est maintenant fermable par Échap.

## 6. Droits et sécurité

- Le menu continue d’utiliser `moduleAllowed` et `visibleGroups`.
- Les liens du fil d’Ariane sont désactivés si le module cible n’est pas autorisé (`canAccess`).
- Aucune route, aucun rôle, aucun contrôle serveur n’a été ajouté ou désactivé.
- Aucune donnée réelle n’est utilisée : les essais s’appuient sur les données fictives M37 et `fetch` est espionné dans les tests.

## 7. Risques et limites de l’audit

- jsdom ne calcule pas la mise en page : les largeurs, les débordements et les chevauchements visuels doivent être confirmés sur un navigateur réel. Aucun navigateur Playwright n’est installé dans cet environnement et aucun téléphone physique n’a été utilisé.
- Les onglets locaux autres qu’Immobilisations ne créent pas d’entrée d’historique.
- La protection des modifications non enregistrées est appliquée aux dialogues ; les formulaires de page sans dialogue reposent sur la navigation visible et ne déclenchent pas de confirmation générique.
- Les captures d’écran ne sont pas disponibles : aucun navigateur graphique n’est accessible dans la session.

## 8. Fichiers ajoutés ou modifiés

Ajoutés : `contextualNavigation.ts`, `responsive.ts`, `guidedTour.ts`, `components/ContextualNav.tsx`, `components/MobileQuickNav.tsx`, tests `mission39-navigation` et `mission39-ui`.

Modifiés : `App.tsx`, `styles.css`, `i18n.tsx`, `components/ui.tsx`, `components/AppIcon.tsx`, `components/DemoBanner.tsx`, `pages/GuidedDemo.tsx`, `pages/accounting/FixedAssets.tsx`.

Aucun changement dans `apps/api`, les migrations, les moteurs de calcul, les règles TVA/paie, les données de démonstration ou le workflow GitHub Pages.
