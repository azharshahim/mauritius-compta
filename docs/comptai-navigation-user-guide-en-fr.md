# COMPTAI — Guide de navigation / Navigation guide

Mission 39 · Windows, Android, tablette / Windows, Android and tablet

---

## Français

### 1. Retour et fil d’Ariane

Chaque écran authentifié affiche une barre contextuelle sous l’en-tête :

- **Retour** revient à l’écran précédent **dans COMPTAI**, avec ses filtres, son onglet et ses paramètres de recherche lorsqu’ils sont portés par l’URL.
- Si COMPTAI a été ouvert directement sur une URL, le bouton revient à la **page parente** (par exemple `Comptabilité` depuis `Balance générale`).
- Le **fil d’Ariane** indique le module et la page : `Comptabilité > Balance générale`, `Banque > Rapprochement bancaire`, `Ventes et facturation > Factures clients`.
- Les tableaux de bord racine (Cabinet, Comptabilité, Ventes, Paie) n’affichent pas de bouton Retour inutile.
- Les autres tableaux de bord de module proposent un Retour vers le module parent.
- Les boutons Précédent/Suivant du navigateur continuent de fonctionner normalement.

Le bouton Retour ne quitte jamais COMPTAI : il n’utilise l’historique du navigateur que lorsque la destination précédente a été visitée dans l’application.

### 2. Fenêtre Windows

Trois présentations s’adaptent automatiquement à la largeur :

| Largeur | Navigation |
|---|---|
| 1 280 px et plus | barre complète de 264 px, groupes développables |
| 901 à 1 279 px | rail compact de 72 px avec icônes et infobulles |
| 900 px et moins | menu hamburger et barre de navigation rapide en bas |

- Sur grand écran, le bouton près du logo permet de **réduire** ou **développer** la barre. Le choix est mémorisé dans ce navigateur.
- Sur le rail compact, cliquez sur l’icône d’un module pour ouvrir temporairement le menu complet sur ce module. Le bouton **Menu** de l’en-tête ouvre aussi le menu complet.
- Fermeture : bouton **Fermer** (infobulle « Fermer le menu »), clic sur le fond ou touche **Échap**.

### 3. Android et tablette

- Le menu n’occupe pas en permanence l’écran : il s’ouvre en tiroir.
- Une barre rapide persistante donne accès à **Tableau de bord**, **Comptabilité**, **Banque**, **Démo** (dans le build de démonstration) et **Menu**.
- Les cibles tactiles font au moins 44 px ; les zones de sécurité Android sont respectées en haut et en bas.
- La pastille de l’assistant IA est placée au-dessus de la barre rapide ; son panneau plein écran la recouvre sans bloquer les formulaires.
- Les tableaux comptables peuvent défiler horizontalement dans leur propre cadre ; la page entière ne doit pas défiler latéralement.
- Le menu reste accessible en portrait comme en paysage.

### 4. Parcours guidé

- Ouvrez **Parcours guidé** depuis le menu ou la barre rapide.
- Choisissez une des **16 étapes** ; le panneau indique l’étape courante et permet **Étape précédente** / **Étape suivante**.
- En ouvrant un écran depuis une étape, une barre de parcours apparaît :
  - **Retour au parcours guidé** ;
  - **Étape précédente** / **Étape suivante** ;
  - numéro de l’étape courante ;
  - bouton pour quitter le mode parcours.
- Le retour rouvre `/demo?step=N` : la progression est conservée après rechargement dans ce navigateur.
- **Réinitialiser la démo** efface aussi la position du parcours. Les 14 destinations, 16 étapes, 8 contrôles de cohérence et données fictives M37 sont inchangés.

### 5. Dialogues et saisies

- **Échap** ferme un dialogue ; le focus revient au bouton qui l’a ouvert.
- La touche **Tab** reste dans le dialogue tant qu’il est ouvert.
- Si un champ a été modifié, une confirmation est demandée avant de fermer le dialogue.
- Le bouton × et le fond du dialogue sont également protégés.

### 6. Langue et société

- Le sélecteur **FR/EN** traduit la barre contextuelle, les groupes, les commandes du parcours et la barre rapide.
- Le sélecteur de société reste disponible sur téléphone ; changer de société ne modifie pas la route ni les droits du module.
- Les libellés professionnels validés en Mission 38 sont conservés.

---

## English

### 1. Back and breadcrumb

Every signed-in screen shows a contextual bar below the header:

- **Back** returns to the previous screen **inside COMPTAI**, preserving URL-backed filters, tab and search parameters.
- When COMPTAI was opened directly on a URL, Back goes to the **parent page** (for example `Accounting` from `Trial Balance`).
- The **breadcrumb** shows the module and page: `Accounting > Trial Balance`, `Banking > Bank Reconciliation`, `Sales & Invoicing > Sales Invoices`.
- Root dashboards (Cabinet, Accounting, Sales, Payroll) do not show a redundant Back button.
- Other module dashboards offer Back to the parent module.
- The browser’s Previous/Next buttons keep working normally.

Back never leaves COMPTAI: browser history is used only when the previous destination was visited inside the application.

### 2. Windows window

Three layouts follow the window width:

| Width | Navigation |
|---|---|
| 1,280 px and above | full 264 px sidebar, expandable groups |
| 901–1,279 px | 72 px icon rail with tooltips |
| 900 px and below | hamburger menu and persistent bottom quick navigation |

- On a wide screen, the control near the logo **collapses** or **expands** the sidebar. The choice is remembered in this browser.
- On the compact rail, click a module icon to open the full menu temporarily on that module. The header **Menu** button also opens the full menu.
- Close with **Close** (tooltip “Close menu”), the backdrop or **Escape**.

### 3. Android and tablet

- The menu no longer occupies the screen permanently: it opens as a drawer.
- A persistent quick bar gives one-tap access to **Dashboard**, **Accounting**, **Banking**, **Demo** (in the demonstration build) and **Menu**.
- Touch targets are at least 44 px; Android safe areas are respected at the top and bottom.
- The AI assistant pill sits above the quick bar; its full-screen panel covers it without blocking forms.
- Accounting tables may scroll horizontally inside their own frame; the page itself must not scroll sideways.
- The menu remains available in portrait and landscape.

### 4. Guided Demo

- Open **Guided Demo** from the menu or the quick bar.
- Choose one of the **16 steps**; the panel shows the current step and offers **Previous Step** / **Next Step**.
- When a screen is opened from a step, a tour bar appears:
  - **Back to Guided Demo**;
  - **Previous Step** / **Next Step**;
  - current step number;
  - a control to leave tour mode.
- Returning opens `/demo?step=N`: progress survives a page reload in this browser.
- **Reset demo data** also clears the tour position. The 14 destinations, 16 steps, 8 coherence checks and Mission 37 fictional data are unchanged.

### 5. Dialogs and data entry

- **Escape** closes a dialog; focus returns to the control that opened it.
- **Tab** stays inside the open dialog.
- If a field was edited, a confirmation is requested before closing.
- The × control and the backdrop follow the same protection.

### 6. Language and company

- The **FR/EN** selector translates the contextual bar, groups, tour controls and quick bar.
- The company selector remains usable on phones; changing company does not change the route or module permissions.
- The professional terminology validated in Mission 38 is preserved.

---

## Raccourcis / Shortcuts

| Action | Commande |
|---|---|
| Fermer le menu ou un dialogue / Close menu or dialog | `Échap` / `Escape` |
| Parcourir le menu / Move through the menu | `Tab`, `Maj+Tab` / `Shift+Tab` |
| Ouvrir le menu complet / Open the full menu | bouton Menu / Menu button |
| Réduire la barre large / Collapse the wide sidebar | bouton près du logo / control near the logo |
| Revenir au parcours / Return to Guided Demo | **Retour au parcours guidé** / **Back to Guided Demo** |

## Limites connues / Known limits

La mise en page réelle (débordements, chevauchements, clavier virtuel Android) n’a pas été vérifiée dans un navigateur graphique ni sur un appareil physique dans cet environnement. Les tests automatisés jsdom vérifient les états et les routes, pas le rendu pixel. Voir `docs/comptai-responsive-navigation-tests.md`.
