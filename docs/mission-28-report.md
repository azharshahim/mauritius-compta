# Mission 28 — Automatisation comptable en masse et interface Premium

Date : 2026-11-01  
Branche : `arena/bc5969d1-mauritius-compta`  
PR : [nº 11 — brouillon](https://github.com/azharshahim/mauritius-compta/pull/11)  
Commit de code : `cfe872b` — `feat: add mission 28 bulk accounting and premium workspace`

## 1. Résumé exécutif

La mission 28 est livrée sous forme de trois flux collectifs construits **au-dessus des moteurs existants** :

1. **Import multifichiers** de factures dans les journaux achats et ventes.
2. **Vérification puis validation groupée** de propositions, avec création de **brouillons uniquement** après confirmation humaine explicite.
3. **Rapprochement bancaire groupé** à partir des suggestions du moteur existant, avec confirmation individuelle agrégée.

La refonte visuelle apporte un jeu d'icônes Lucide harmonisées, un thème clair par défaut et un thème sombre persistant, un tableau de bord comptable fondé sur les données réellement disponibles, ainsi que des adaptations mobiles des nouveaux tableaux.

Aucun second moteur OCR, aucun second stockage, aucun second moteur de rapprochement et **aucune comptabilisation automatique** n'ont été ajoutés. Le statut reste une PR en brouillon, sans fusion ni publication.

## 2. Périmètre livré

| Objectif | État | Point d'entrée |
|---|---|---|
| A. Import multifichiers achats/ventes | Livré | `/accounting/journals/{purchases,sales}/import/bulk` |
| B. Tableau de vérification groupée | Livré | même écran, tableau et filtres |
| C. Validation groupée en brouillons | Livré | bouton « Créer les brouillons sélectionnés » + confirmation |
| D. Rapprochement bancaire groupé | Livré, périmètre prudent documenté | `/accounting/banking/bulk-reconciliation` |
| E. Règles supervisées par société | Livré pour les règles documentaires ; règles bancaires existantes conservées | carte « Règles supervisées » et onglet Règles de Banque |
| Interface Premium | Livré sur le socle global, la navigation, le tableau de bord et les nouveaux écrans | `styles.css`, `AppIcon.tsx` |
| Tableau de bord comptable | Livré | `/accounting` |
| Bilingue FR/EN | Livré pour les nouveaux écrans, messages et états | dictionnaire local des deux écrans + clés globales |
| Mobile/tablette | Adaptations CSS et cibles tactiles livrées ; **non testées physiquement** | media queries et tableaux en cartes |

## 3. Architecture et réutilisation

Décision issue de l'audit : **aucun endpoint batch n'a été créé** pour contourner les contrôles existants. L'orchestration est côté client, avec une concurrence limitée à deux requêtes pour ne pas saturer un téléphone.

- Import : `POST /companies/:id/documents` (moteur OCR et stockage existants), `PATCH /documents/:id`.
- Préparation : `POST /documents/:id/proposal`.
- Validation : `POST /documents/proposals/:id/approve` avec `confirm: true`.
- Rapprochement : `GET /bank/transactions/:id` pour la suggestion existante, puis `POST /bank/transactions/:id/matches` avec `confirm: true`.
- Règles : `GET /documents/rules`, `PATCH /documents/rules/:ruleId`, avec audit.

Conséquences volontaires :

- chaque validation reste soumise aux contrôles serveur de période, d'équilibre, de compte actif, de journal, de devise et de permission ;
- `PROPOSAL_ALREADY_APPROVED`, `BANK_ALREADY_MATCHED`, `BANK_LINE_ALREADY_MATCHED` et les allocations existantes restent les protections anti-double traitement ;
- les résultats sont agrégés côté interface, mais restent **individuels** dans l'API et dans l'audit.

## 4. A — Import multifichiers

Fichier principal : `apps/web/src/pages/documents/BulkImport.tsx`.

- sélection multiple et glisser-déposer ;
- formats PDF, JPG, JPEG, PNG, avec validation par extension puis par signature côté serveur ;
- 8 Mo par fichier, 100 fichiers par lot, deux fichiers traités à la fois ;
- progression **par fichier** (envoi/extraction) et progression globale ;
- un échec individuel ne vide pas le lot et n'annule pas les réussites ;
- bouton de reprise des fichiers en échec ;
- chargement de la file des documents déjà extraits pour reprendre un lot ;
- affichage du nombre de pages et avertissement explicite pour un PDF multipage ;
- **aucun découpage automatique** d'un PDF multipage : la vérification humaine reste obligatoire ;
- doublons : statut `DUPLICATE` et `duplicate_of` du serveur repris dans la ligne, avec désactivation de la proposition ;
- conservation des sources par le stockage privé existant, avec lien vers la fiche documentaire ;
- pas de second système d'import.

La progression est une progression d'étapes (lecture locale, envoi, extraction), pas une mesure d'octets du POST : le client `fetch` existant n'expose pas `upload.onprogress`. Cette limite est explicite.

## 5. B — Tableau de vérification groupée

Colonnes livrées : fichier, fournisseur/client, nº facture, date, devise, HT, TVA, TTC, compte proposé, statut, confiance et actions.

- corrections en ligne des champs métier, puis enregistrement via `PATCH /documents/:id` ;
- après correction d'un document déjà proposé, la proposition est marquée **périmée** et la validation groupée est bloquée jusqu'à une nouvelle préparation ;
- filtres : Tous / Prêts à valider / À vérifier / Doublons / Erreurs ;
- « prêt à valider » signifie désormais **proposition serveur équilibrée, journalisée et avec tous les comptes résolus**, et non simple extraction complète ;
- la confiance n'est affichée que si le serveur renvoie une valeur strictement positive ; sinon `—` ;
- les avertissements de proposition (`uncertain_fields`) et les doublons sont visibles ;
- ouverture de la fiche documentaire dans l'archive via `/documents?doc=…` ;
- la sélection multiple ne coche automatiquement que les documents extraits non doublons ; les doublons et erreurs restent non sélectionnables.

## 6. C — Validation groupée

La validation groupée :

1. prépare les propositions sélectionnées et affiche les comptes réellement calculés ;
2. ouvre une fenêtre récapitulative avec le nombre de documents et le total TTC ;
3. exige une case de confirmation humaine ;
4. appelle l'API existante document par document ;
5. affiche un résultat individuel et agrégé, y compris les échecs partiels ;
6. crée uniquement des **écritures brouillon** ; aucune écriture n'est postée.

La devise étrangère est volontairement exclue de la validation groupée : elle est signalée et doit être validée individuellement avec un taux explicite. Aucun taux n'est inventé.

L'audit `document.proposal.approve` reste écrit par l'API pour chaque proposition. L'apprentissage documentaire n'a lieu qu'après approbation humaine, jamais lors d'une simple suggestion.

## 7. D — Rapprochement bancaire groupé

Fichier principal : `apps/web/src/pages/accounting/BulkReconciliation.tsx`.

- choix du compte issu d'un relevé importé ;
- analyse des transactions non rapprochées et en revue (limite de 100) ;
- suggestions lues depuis le moteur existant `suggestMatches` ;
- distinction Exactes / Ambiguës / Absentes / À vérifier ;
- tableau groupé avec montant, écriture candidate, motifs et état ;
- **aucune sélection automatique** : toutes les cases sont décochées à l'analyse ;
- seules les suggestions **uniques et exactes** sont sélectionnables ;
- récapitulatif et confirmation humaine explicite avant appel de l'API existante ;
- résultats individuels, conflits et doublons renvoyés par le serveur affichés ligne par ligne ;
- lien direct vers la transaction dans l'écran Banque (`transactionId`), qui ouvre la fiche de rapprochement.

Limites assumées et affichées dans l'écran :

- paiements partiels, plusieurs factures pour un règlement, virements internes et devises étrangères : **pas de confirmation en masse**, traitement individuel dans Banque ;
- ventilation (`split`) affichée à titre indicatif, aucune écriture de ventilation créée par cet écran ;
- l'ambiguïté n'est jamais tranchée automatiquement ;
- une suggestion n'est jamais présentée comme un rapprochement confirmé ;
- audit `bank_transaction.match.confirmed` conservé par l'API pour chaque confirmation.

## 8. E — Règles supervisées par société

### Règles documentaires

Nouvelle migration `apps/api/sql/migrations/0022_document_mapping_rules.sql` :

- ajout de `is_active` et `updated_at` à `document_mappings` avec `IF NOT EXISTS` ;
- index sur société, type, activation et dernière utilisation.

Nouveau comportement :

- une règle est enregistrée après une approbation humaine, mais **n'est appliquée par le moteur qu'à partir de deux approbations identiques** (`usage_count >= 2`) ;
- une seule correction ne devient donc jamais une règle appliquée ;
- le nom de tiers extrait est utilisé même si le fournisseur n'existe pas encore dans le référentiel, sinon une règle apprise ne pourrait jamais s'appliquer aux nouveaux fournisseurs ;
- l'écran d'import groupé liste les règles du journal avec tiers, libellé appris, compte, nombre de validations et dernière utilisation ;
- le compte peut être changé, la règle peut être désactivée ;
- seuls les comptes actifs du bon type (charge pour achat, produit pour vente) sont acceptés ;
- chaque modification écrit `document.rule.update` dans le journal d'audit.

### Règles bancaires

L'onglet Règles existant de Banque reste l'unique gestionnaire des règles de libellé bancaire (priorité, version, activation). Aucun second système de règles n'a été ajouté.

## 9. Refonte visuelle Premium

- bibliothèque **Lucide React 0.468.0**, importée nommément pour permettre l'élagage par Vite ;
- composant `AppIcon` centralisant les icônes utilisées ;
- remplacement des emojis de navigation, du menu, du thème, de la déconnexion, des liens du tableau de bord Cabinet, des écrans Documents/Scan, du dossier Cabinet, de l'assistant et de l'écran MRA ;
- libellés conservés à côté des icônes ; seules les commandes utilitaires (menu, thème) utilisent un `aria-label` ;
- palette sobre, rayons et ombres harmonisés, transitions légères, états de focus ;
- **mode clair par défaut** ;
- **mode sombre** par redéfinition des variables CSS, persisté dans `localStorage` et appliqué avant le rendu React pour éviter le flash clair ;
- correction des surfaces qui utilisaient auparavant des blancs littéraux dans le thème sombre.

Aucun centre de notifications n'existait dans l'application : la mission n'a donc pas inventé une fonctionnalité de notifications. Les icônes recherche/filtre/paramètres sont disponibles dans le jeu central et utilisées là où les fonctions existent.

## 10. Nouveau tableau de bord

Fichier : `apps/web/src/pages/Dashboard.tsx`, route `/accounting` et nouvelle entrée de navigation « Tableau de bord comptable ».

Données réellement chargées :

- `GET /companies/:id/dashboard` : produits, charges, résultat, total actif, brouillons, écritures récentes, période ;
- `GET /companies/:id/documents` : documents à traiter et doublons ;
- `GET /companies/:id/bank/accounts` : comptes et transactions non rapprochées ;
- `GET /companies/:id/bank/imports` : importations récentes.

Aucune statistique fictive, aucun graphique inventé. L'« activité récente » affiche les dernières **écritures** de l'API dashboard, et non le journal d'audit (réservé aux administrateurs) : le libellé de la carte le précise. Les accès rapides ne dupliquent pas les fonctionnalités ; ils pointent vers les routes existantes et les deux nouveaux flux collectifs.

## 11. Responsive, accessibilité et ergonomie

- menus latéraux groupés et état actif conservés ;
- tableaux d'import/rapprochement transformés en cartes sous 640 px, avec libellés de champs `data-label` ;
- suppressions des largeurs minimales en ligne sur les tableaux mobiles ;
- boutons, filtres, liens de navigation et commandes d'icône à **44 px** minimum sur mobile ;
- actions principales visibles, messages d'erreur par ligne et résultats agrégés ;
- `aria-label`, `role="tab"`, `aria-selected`, `role="progressbar"`, `aria-live` sur les progressions/résultats ;
- vérification par tests DOM et CSS uniquement : **aucun test physique Android/iPhone/Windows/Mac n'a été exécuté**.

## 12. Bilinguisme

- tous les nouveaux libellés des deux écrans collectifs ont une version FR et EN locale ;
- les nouvelles clés globales (`common.darkMode`, `common.lightMode`, `journal.importBulk`, `nav.accounting.dashboard`, `nav.bank.bulkReconciliation`, erreurs de règles) existent dans les deux dictionnaires ;
- les motifs du moteur de rapprochement, historiquement en français, sont traduits à l'affichage pour les cinq motifs connus ;
- un test vérifie le tableau de bord, les deux écrans collectifs et les icônes de navigation en anglais ;
- le test de qualité i18n existant vérifie la parité des clés globales.

## 13. Tests et résultats

Exécutions finales locales :

| Vérification | Résultat |
|---|---|
| API — `npm test -w @mc/api` | **478 réussis**, 11 ignorés, 32 fichiers (31 exécutés, 1 ignoré) |
| Web — `npm test -w @mc/web` | **273 réussis**, 39 fichiers |
| `npm run typecheck` | réussi (API + Web + tests) |
| `npm run build` | réussi (Web + API) |
| `npm run build:demo` | réussi |

Nouveaux tests :

- `apps/web/tests/mission28-ui.test.tsx` — 6 tests :
  - tableau de bord comptable ;
  - bascule clair/sombre et persistance ;
  - import de deux fichiers, préparation, confirmation explicite et création de brouillons ;
  - règles supervisées et désactivation ;
  - écrans et navigation en anglais ;
  - rapprochement groupé sans présélection.
- `apps/api/tests/mission23.test.ts` — test supplémentaire : liste des règles, changement de compte, refus d'un compte incompatible, désactivation, isolation inter-sociétés, audit, seuil de deux validations et application de la règle.

Le build Vite émet un avertissement de taille de chunk (bundle de démonstration supérieur à 500 kB). Ce n'est pas une erreur et aucun découpage de code supplémentaire n'a été introduit dans cette mission.

**Captures/prévisualisations** : aucune capture de navigateur n'a pu être produite dans cet environnement ; les vérifications visuelles automatisées se limitent aux tests DOM. Aucun test de navigateur physique n'est revendiqué.

## 14. Limites et points à vérifier manuellement

### Limites fonctionnelles

- la file d'import et la reprise des échecs vivent dans l'état de la page : un rechargement du navigateur interrompt le lot en cours ; les documents déjà créés restent dans la file serveur et peuvent être rechargés ;
- l'import est limité à 100 fichiers par lot, 8 Mo par fichier et deux envois simultanés ;
- pas de progression d'octets native, pas de reprise réseau au niveau HTTP ;
- aucun découpage automatique de PDF multipage ;
- validation groupée limitée aux devises fonctionnelles ; devise étrangère à traiter individuellement ;
- rapprochement groupé limité aux suggestions exactes uniques ; paiements partiels, ventilations, virements internes et devises restent manuels ;
- analyse de rapprochement limitée aux 100 transactions non rapprochées les plus récentes ;
- règles documentaires : deux validations identiques sont nécessaires avant application ; aucune règle ne peut être créée manuellement depuis l'écran (elles naissent des validations humaines) ;
- l'historique détaillé d'une règle se limite au compteur de validations, à la dernière utilisation et aux événements d'audit ; il n'existe pas d'écran de diff des anciennes valeurs ;
- le mode sombre et le responsive sont vérifiés par CSS/DOM, pas par audit visuel multi-appareils.

### À vérifier manuellement

1. Importer 10 PDF dont un doublon et un fichier corrompu ; vérifier la progression par fichier, le statut du doublon et la reprise des échecs.
2. Corriger un champ après préparation ; vérifier que la proposition devient périmée et que le bouton de validation reste bloqué jusqu'à une nouvelle préparation.
3. Valider trois brouillons et vérifier dans les journaux qu'ils sont en statut `draft`, jamais `posted`, avec trois événements d'audit.
4. Confirmer un rapprochement exact puis retenter la même transaction ; vérifier le conflit serveur.
5. Désactiver une règle documentaire, changer son compte, puis vérifier l'audit `document.rule.update`.
6. Tester le mode sombre, sa persistance après rechargement et le rendu des champs/tableaux.
7. Tester à 360 px et 390 px : absence de débordement horizontal, tableau en cartes, cibles de 44 px.
8. Basculer en anglais et vérifier les deux nouveaux écrans, les messages d'erreur et les motifs de rapprochement.
9. Vérifier les permissions : un lecteur ne peut pas modifier une règle ni valider un brouillon.

## 15. Migrations et dépendances

### Migration

`apps/api/sql/migrations/0022_document_mapping_rules.sql` :

```sql
ALTER TABLE document_mappings
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
```

Aucune donnée existante n'est supprimée. Les règles historiques deviennent actives par défaut mais ne s'appliquent qu'à partir de deux validations.

### Dépendance ajoutée

`lucide-react@0.468.0` est la seule nouvelle dépendance directe. Elle est justifiée par l'objectif d'icônes SVG harmonisées, ne dépend que de React et est importée nommément pour que Vite n'embarque que les icônes utilisées. Aucune bibliothèque OCR, table ou moteur supplémentaire.

## 16. Commits et PR

- `cfe872b` — code, migration, tests : `feat: add mission 28 bulk accounting and premium workspace`.
- Rapport : commit suivant sur la même branche.
- PR nº 11 : <https://github.com/azharshahim/mauritius-compta/pull/11> — **brouillon, sans fusion ni publication**.

## 17. État CI

Au moment de la rédaction, les contrôles de la PR nº 11 comprenaient :

- Migrations PostgreSQL : réussi ;
- Tests API PostgreSQL : réussi ;
- Build demo : réussi ;
- Typecheck/tests/build : à confirmer sur le dernier commit de documentation ;
- Déploiement Pages : ignoré comme prévu pour une PR.

Le résultat final doit être lu dans l'onglet Checks de la PR. Aucune fusion ne sera effectuée sans validation explicite.
