# COMPTAI — parcours de l'expert-comptable

**Version :** 0.1.1 — démonstration
**Date :** 1er novembre 2026
**Périmètre :** mission 36 — huit parcours, exécutés en français **et** en anglais
**Données :** uniquement les données fictives du navigateur (`resetDemo`)
**Tests :** `apps/web/tests/mission36-journeys.test.tsx` (16 exécutions : 8 parcours × 2 langues)

---

## Mode d'emploi de la recette

1. Lancer la démonstration locale, se connecter avec le compte fictif affiché.
2. Vérifier que le bandeau « MODE DÉMONSTRATION » est visible : aucun appel réseau
   réel n'est attendu (`fetch` est espionné et doit rester inutilisé).
3. Chaque parcours repart d'un état remis à zéro. Les tests appellent `resetDemo()`,
   vident `localStorage`, puis posent `mc.locale` à `fr` ou `en` avant le rendu.
4. Les libellés sont vérifiés dans les deux langues. Les montants restent en MUR,
   sans taux inventé.

---

## Parcours 1 — Dossier, plan comptable et soldes d'ouverture

| Étape | Écran / action | Résultat attendu |
|---|---|---|
| 1 | Connexion | Le sélecteur de société est visible dans la barre supérieure ; le tableau de bord cabinet s'affiche. |
| 2 | Menu **Comptabilité → Plan comptable** | Titre **Plan comptable** / **Chart of Accounts** ; statut **PENDING PROFESSIONAL VALIDATION** affiché (le plan n'est pas déclaré validé). |
| 3 | Menu **Comptabilité → Soldes d'ouverture** (`?tab=opening`) | L'onglet **Soldes d'ouverture** est sélectionné et la carte **Aperçu des soldes d'ouverture** s'affiche. |

**Ce que le parcours prouve :** le dossier actif, le plan comptable provisoire et
l'onglet de reprise sont accessibles directement depuis la navigation, sans passer
par un écran parent.

**Limite :** le plan comptable de démonstration n'est pas validé par un expert ;
le statut provisoire doit rester visible.

## Parcours 2 — Écriture → grand livre → balance

| Étape | Écran / action | Résultat attendu |
|---|---|---|
| 1 | Menu **Journaux → Écritures comptables** | Liste des écritures paginée. |
| 2 | **Ajouter une écriture** | Formulaire avec journal, date, référence, libellé, deux lignes. |
| 3 | Saisie de `M36-J2`, d'un libellé, d'un compte au débit (1 234,00) et d'un autre au crédit (1 234,00) | Badge **Équilibrée** ; le bouton **Enregistrer et valider** devient actif. |
| 4 | **Enregistrer et valider** | L'écriture validée est créée ; aucun bouton ne permet de modifier une écriture validée. |
| 5 | Menu **Comptabilité → Grand livre** | Le grand livre affiche la référence `M36-J2` sur les deux comptes mouvementés. |
| 6 | Menu **Comptabilité → Balance générale** | La balance affiche **Balance équilibrée** / **Trial balance is balanced**. |

**Ce que le parcours prouve :** la chaîne écriture → grand livre → balance est
alimentée par la même écriture, et l'équilibre débit/crédit est contrôlé avant
validation. Aucune règle de calcul n'est modifiée par la mission.

**Limite :** les dates par défaut peuvent sortir de la période affichée par le grand
livre ; la recette élargit explicitement la période (2020 → 2030). Cela ne change pas
les données, seulement le filtre d'affichage.

## Parcours 3 — Facture client → proposition → écriture comptable

| Étape | Écran / action | Résultat attendu |
|---|---|---|
| 1 | Menu **Ventes et facturation → Factures clients** | La facture fictive `FAC-DEMO-0002` est listée. |
| 2 | Menu **Paramètres → Écritures proposées** | Sélecteur **Proposer depuis une facture émise**. |
| 3 | Choix de `FAC-DEMO-0002` | Message **Proposition créée. Aucune écriture comptable.** ; statut **À vérifier** / **To review**. |
| 4 | **Valider** | Statut **Validée (non comptabilisée)**. Une confirmation de warnings peut être demandée ; elle est explicite. |
| 5 | **Comptabiliser** | Confirmation, puis statut **Comptabilisée** / **Posted** et message avec le numéro d'écriture créé. |
| 6 | Retour **Factures clients** | La facture porte **Comptabilisé** / **Posted**. |

**Ce que le parcours prouve :** une facture client ne crée jamais d'écriture par
elle-même ; elle passe par une proposition, un contrôle et une validation humaine.
C'est le chemin réel de la démonstration, pas un bouton fictif.

**Limite :** le PDF et la TVA restent hors périmètre ; aucune conformité MRA n'est
affirmée. La proposition peut demander une acceptation explicite des avertissements.

## Parcours 4 — Facture fournisseur → proposition → dettes fournisseurs

| Étape | Écran / action | Résultat attendu |
|---|---|---|
| 1 | Menu **Achats et dépenses** | Tableau de bord Achats. |
| 2 | Onglet **Factures fournisseurs** | `FAC-DEMO-1001` est listée avec son fournisseur. |
| 3 | **Proposition** sur la ligne | Message **Proposition préparée. Aucune écriture créée.** |
| 4 | Menu **Achats et dépenses → Comptes fournisseurs — balance âgée** (`?tab=aging`) | Carte **Échéancier des dettes fournisseurs** / **Supplier debt aging** avec les soldes ouverts. |

**Ce que le parcours prouve :** le document d'achat et la dette fournisseur sont
accessibles dans le même groupe ; la proposition comptable reste séparée de la
validation du document. Aucune dette n'est recalculée par l'ergonomie.

**Limite :** la démonstration ne comptabilise pas la facture fournisseur depuis cet
écran ; il faut passer par la proposition. La TVA récupérable n'est pas recalculée.

## Parcours 5 — Rapprochement bancaire et rapport

| Étape | Écran / action | Résultat attendu |
|---|---|---|
| 1 | Menu **Banque → Rapprochement bancaire** (`?tab=transactions`) | L'onglet **Transactions** est sélectionné ; le titre est **Banque & rapprochement**. |
| 2 | Onglet **Rapport** | L'onglet est sélectionné et la carte **Rapport** s'affiche (soldes, écarts, compteurs de rapprochement si des données existent). |

**Ce que le parcours prouve :** l'opération de rapprochement et son rapport sont
accessibles depuis le même groupe, sans import automatique ni écriture implicite.

**Limite :** l'onglet `report` reste volontairement hors du menu latéral tant que son
usage cabinet n'est pas validé ; il est accessible depuis l'onglet de l'écran Banque.
Aucun export de rapport bancaire n'est affirmé compatible avec un format concurrent.

## Parcours 6 — Bilan, compte de résultat et états financiers

| Étape | Écran / action | Résultat attendu |
|---|---|---|
| 1 | Menu **Rapports → Bilan** | Titre **Bilan** / **Balance Sheet** ; avertissement **Non conforme IFRS en l'état** / **Not IFRS compliant as-is** ; ligne **Total actif**. |
| 2 | Menu **Rapports → Compte de résultat** | Titre **Compte de résultat** / **Profit & Loss** ; sections **Produits** et **Résultat de la période**. |
| 3 | Menu **Rapports → Tous les états financiers** | Titre **États financiers (provisoires)** / **Financial Statements (provisional)**. |

**Ce que le parcours prouve :** les états sont accessibles en un clic depuis le menu
Rapports, et l'avertissement de non-conformité reste visible. Les calculs proviennent
des écritures validées, sans nouvelle règle fiscale.

**Limite :** pas de notes annexes, pas de comparatifs N/N-1, pas d'état de flux de
trésorerie, pas de présentation statutaire mauricienne validée.

## Parcours 7 — Changement de dossier sans fuite de données

| Étape | Écran / action | Résultat attendu |
|---|---|---|
| 1 | Menu **Écritures comptables** | Une écriture de démonstration est visible (page 2 : `FA-2025-001`). |
| 2 | Sélecteur **Société** : choix de **Case Noyale Retail Ltd (DEMO)** | `mc.companyId` change immédiatement. |
| 3 | Retour sur la même liste | La liste est vide pour ce dossier : **Aucune écriture validée sur la période** ; l'écriture du dossier précédent n'apparaît plus. |

**Ce que le parcours prouve :** le changement de dossier recharge les données du
dossier actif et ne laisse pas les lignes du dossier précédent à l'écran. L'isolation
serveur reste couverte par les tests API existants ; ce test UI vérifie l'absence de
fuite visuelle.

**Limite :** ce test ne remplace pas un test d'autorisation par rôle ; il vérifie un
parcours de démonstration avec un utilisateur fictif disposant de plusieurs dossiers.

## Parcours 8 — Immobilisations, stocks et paie depuis la navigation

| Étape | Écran / action | Résultat attendu |
|---|---|---|
| 1 | Menu **Stocks et immobilisations → Immobilisations** | **Immobilisations et amortissements** / **Fixed assets and depreciation**. |
| 2 | Menu **Stocks et immobilisations → Stocks** | **Stocks** / **Inventory**. |
| 3 | Menu **Paie → Tableau de bord Paie** | **Paie & RH** / **Payroll & HR**. |

**Ce que le parcours prouve :** les trois modules opérationnels sont atteignables
depuis les groupes de navigation sans sous-menu profond, et l'écran de paie continue
d'afficher les avertissements métier existants.

**Limite :** aucune règle de paie, de TVA, d'amortissement fiscal ou de clôture n'est
modifiée par ce parcours. Les déclarations de paie restent marquées « préparées »
lorsqu'elles ne sont pas opérationnelles.

---

## Ce qui n'est pas couvert par ces huit parcours

- création d'un dossier **avec** plan comptable et reprise de soldes depuis un fichier
  externe (l'import est couvert par les tests de migration existants, pas par ce
  scénario de navigation) ;
- lettrage complet facture → règlement → écriture ;
- clôture annuelle effective et archivage ;
- paie exécutée, déclarations MRA et TVA ;
- rôles et autorisations par rôle (tests API dédiés) ;
- état de flux de trésorerie et centres de coûts : fonctions absentes, donc volontairement
  absentes de la navigation et des parcours.

Ces limites sont reprises dans `docs/mission-36-report.md`.
