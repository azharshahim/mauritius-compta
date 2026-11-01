# COMPTAI — Rapport de mission 42

**Finalisation du cycle Achats, Ventes, OCR et intégrité comptable**

- **Date de clôture technique** : 1er novembre 2026
- **Dernière mise à jour** : mission **42.1** — finalisation des interfaces et de l’ergonomie OCR
- **Dépôt** : `azharshahim/mauritius-compta`
- **Branche** : `arena/e8400c4a-mauritius-compta`
- **Base** : `main` au commit `cc5698457061dc2618a3b9b83967098840bb87ec` (M41 fusionnée, PR nº22)
- **Nature** : mission de correction ciblée des écarts démontrés par M41, sans reprise des modules déjà fonctionnels
- **Statut** : travail M42 et M42.1 implémenté, vérifié localement, **non fusionné et non déployé**

> Ce rapport distingue explicitement ce qui est **implémenté**, **partiel**, **non corrigé** et **non vérifié**.
> Aucune validation de comptable ne constitue une certification réglementaire. Aucune déclaration officielle MRA n’est produite.
> **P0-03 reste ouvert** : COMPTAI n’est pas déclaré prêt pour la production.

---

## 1. Périmètre réellement traité

La mission part des constats P1/P2/P3 de `docs/mission-41-accounting-functional-audit.md` et du plan
`docs/comptai-missions-42-43-implementation-plan.md`. Les modules M40/M41 déjà fonctionnels n’ont pas été réécrits.

Principes conservés :

- **moteur comptable unique** : `prepareEntry` / `postEntryTx` / `postProposal` ; aucune seconde comptabilité ;
- **aucun flottant** : montants `numeric` lus en `bigint`, formatage `formatAmount`, calculs par devises séparées ;
- **aucune comptabilisation automatique** : une affectation ne crée jamais d’écriture ; la validation et la comptabilisation restent deux actions humaines ;
- **aucune validation humaine supprimée** ;
- **aucun écart forcé à zéro** dans les contrôles ;
- **aucune donnée réelle** : tous les tests et exemples utilisent des tiers, références et montants fictifs ;
- **aucune migration destructive** : la migration `0025` est additive, avec reprise explicite des dates existantes.

---

## 2. Fonctionnalités développées

### 2.1 Lot 1 — OCR vers facture fournisseur

**Implémenté.**

- Nouvelle conversion explicite `createPurchaseFromOcr()` dans `apps/api/src/modules/documents/service.ts`.
- Route `POST /companies/:companyId/documents/proposals/:proposalId/purchase-invoice`.
- La conversion exige :
  - une proposition OCR **approuvée** ;
  - un type de document `invoice` ou `credit_note` ;
  - une date, une devise, une référence fournisseur et un fournisseur actif existant ;
  - au moins une ligne d’achat exploitable ;
  - un taux de TVA vérifié reproduisant exactement la TVA extraite ;
  - un total converti identique au total approuvé.
- La facture d’achat est créée **puis validée** (numéro interne), sans être comptabilisée.
- La proposition OCR et le document importé sont liés à cette facture par `purchase_document_id` avec index uniques partiels : **double création empêchée**.
- Aucun fournisseur n’est créé automatiquement par l’OCR.
- L’écriture brouillon OCR existante n’est jamais postée par la conversion.
- Écran OCR `apps/web/src/pages/documents/ScanImport.tsx` : bouton « Créer la facture fournisseur », confirmation humaine, affichage de la facture liée et du message « aucun doublon ».

### 2.2 Lot 2 — Avoirs, acomptes et trop-perçus

**Implémenté côté API ; partiel côté interface.**

- `credit_available` est calculé dans la **liste** des avoirs fournisseurs, plus seulement dans le détail.
- Affectation ultérieure d’un règlement fournisseur :
  `POST /companies/:companyId/purchases/payments/:paymentId/allocations`.
- Affectation ultérieure d’un encaissement client :
  `POST /companies/:companyId/billing/payments/:paymentId/allocations`.
- Annulation d’une affectation client avec conservation de l’historique :
  `DELETE /companies/:companyId/billing/payments/:paymentId/allocations/:allocationId`.
- Contrôles : même tiers, même devise, montant disponible du règlement, restant dû de la facture, date d’affectation non antérieure au règlement, concurrence par verrouillage de lignes.
- Réactivation de la même ligne d’affectation après annulation, au lieu de créer un doublon.
- Acompte fournisseur déjà comptabilisé : l’affectation renseigne `reclass_amount`, `reclassRequired = true` et exige une **écriture de reclassement séparée**.
- Trop-perçu client déjà comptabilisé : même logique, avec proposition `billing_allocation`.
- Routes de proposition de reclassement :
  - `POST /purchases/payments/:paymentId/allocations/:allocationId/reclass-proposal` ;
  - `POST /billing/payments/:paymentId/allocations/:allocationId/reclass-proposal`.
- Ces routes créent uniquement une proposition déterministe (`entryCreated: false`) ; la comptabilisation passe ensuite par le moteur unique.
- Compte d’avances fournisseurs `1150` ajouté au plan comptable provisoire et repris de façon additive pour les sociétés existantes.
- Le repli « n’importe quel compte d’actif » a été supprimé pour les acomptes : si `1150` manque, la proposition est refusée (`AI_HUMAN_REQUIRED`) au lieu de risquer une écriture sur la banque.

**Limite** : les écrans Achats et Facturation ne proposent pas encore un bouton « affecter plus tard » pour tous les acomptes/trop-perçus. Les routes et contrôles existent et sont testés, mais le parcours visuel reste à compléter.

### 2.3 Lot 3 — Devises, soldes et balances âgées

**Implémenté.**

- `buildAging` calcule par couple **(client, devise)** et par **date réelle d’affectation** (`allocated_date`), avec les dates réelles des règlements.
- `totalsByCurrency` expose un total par devise.
- `totals` vaut `null` dès que plusieurs devises sont présentes : **aucune addition MUR + EUR**.
- `customerBalance` retourne `balances[]`, une position par devise, reconstituée à la date demandée.
- Le tableau de bord ventes expose `openReceivablesByCurrency`, `agingByCurrency` et `payments.byCurrency` ; `openReceivables` vaut `null` si plusieurs devises sont ouvertes.
- Les écrans `Aging.tsx`, `Customers.tsx` et `Overview.tsx` affichent une ligne ou un bloc par devise.
- Le moteur de démonstration (`apps/web/src/demo/runtime.ts`) applique la même séparation par devise.

**Testé explicitement** : facture MUR 1 000 et facture EUR 1 000, encaissements datés de novembre, aging au 31/10 puis au 31/12 ; aucun total inter-devises.

### 2.4 Lot 4 — Rapprochement AR/AP vers grand livre

**Implémenté côté API ; partiel côté interface.**

- `apps/api/src/modules/reconciliation/service.ts` : contrôle en lecture seule des comptes collectifs clients et fournisseurs.
- Route `GET /companies/:companyId/reports/subledger-reconciliation?asOf=YYYY-MM-DD`.
- Pour chaque couple `(compte, devise)` :
  - solde GL des écritures **postées** ;
  - sous-registre posté ;
  - documents et règlements **non comptabilisés**, présentés séparément ;
  - différence totale ;
  - part expliquée par les éléments non comptabilisés ;
  - part **inexpliquée**.
- Statuts : `reconciled`, `explained`, `unexplained`.
- `controls.hasUnexplainedDifference` signale explicitement tout écart réel. **Aucun écart n’est ramené à zéro.**
- Correction de signe : les créances sont comparées en débit-crédit, les dettes en crédit-débit.

**Limite** : aucun écran dédié n’a été livré ; le contrôle est disponible par l’API et couvert par un test d’intégration.

### 2.5 Lot 5 — Comptabilisation depuis les écrans métier

**Implémenté.**

- Achats : après préparation d’une proposition, l’écran permet de la **valider**, puis de la **comptabiliser** avec confirmation humaine explicite.
- Facturation : pour une facture ou un avoir émis, l’écran permet de **préparer** la proposition comptable, de la **valider**, puis de la **comptabiliser**.
- Les actions utilisent uniquement les routes existantes `ai/entry-proposals/...`, donc le moteur unique.
- Le compteur « en attente de comptabilisation » est exposé par `billing/summary` et par le tableau de bord achats.
- Une facture déjà liée à une écriture n’affiche plus d’action de comptabilisation : double écriture empêchée par l’interface et par les verrous serveur.

### 2.6 Lot 6 — TVA et immobilisations

**Implémenté côté API ; partiel côté interface.**

- `apps/api/src/modules/reconciliation/vat.ts` : état de contrôle TVA fondé **uniquement sur les écritures postées**.
- Route `GET /companies/:companyId/reports/vat-control?from=&to=`.
- Sortie : comptes TVA, totaux par devise, TVA collectée, TVA déductible, TVA nette, notice.
- `officialReturn: false` : **aucune déclaration MRA n’est produite ni simulée**.
- Lien contrôlé entre une ligne d’achat immobilisée et le registre :
  `POST /companies/:companyId/purchases/documents/:documentId/lines/:lineId/fixed-asset`.
- Conditions : facture validée, ligne sur un compte de type `asset`, une seule immobilisation par ligne (`fixed_assets.purchase_document_line_id` + index unique partiel), idempotence et audit.
- La création renvoie une fiche plate et non un objet imbriqué.

**Limites** : pas d’écran de contrôle TVA ; pas de bouton « créer l’immobilisation » dans l’écran Achats.

### 2.7 Lot 7 — Qualité OCR et documentation

**Partiel.**

- `posting_status` (`not_ready`, `ready`, `linked`, `posted`), `purchase_document_no` et `draft_entry_status` sont exposés par l’API des documents.
- Détection de rescannage déterministe existante (`similarDocuments`, `POSSIBLE_RESCAN`) conservée.
- Garde multi-factures conservée ; la séparation automatique de plusieurs factures **n’est pas** implémentée.
- Le présent rapport remplace l’absence de rapport M42 et documente les statuts.
- Les documents historiques contredisant l’arbre courant (`docs/accounting-gaps-audit.md`, constat E-04) **n’ont pas été réécrits**.

---

### 2.8 Mission 42.1 — finalisation des interfaces

La mission 42.1 ne réécrit aucun moteur : elle branche les écrans sur les services M42 déjà testés et corrige les contrats de lecture nécessaires à l’affichage.

| Écran / parcours | État | Détail |
|---|---|---|
| Achats — affectation tardive d’un acompte ou règlement | **Implémenté** | Bouton `Affecter` sur un règlement non soldé, choix d’une facture validée ouverte du même fournisseur **et de la même devise**, montant plafonné par le restant à affecter et par le restant dû, date d’affectation contrôlée (`>=` date du règlement), confirmation humaine explicite. |
| Achats — reclassement nécessitant une validation humaine | **Implémenté** | Les affectations d’un règlement déjà comptabilisé affichent `Reclassement` ; la proposition séparée est créée avec `entryCreated: false`, un bandeau renvoie vers l’écran des propositions. Aucune écriture n’est créée par l’affectation. |
| Achats — immobilisation depuis une ligne | **Implémenté** | Bouton `Immobilisation` sur une facture validée ; la fenêtre liste les lignes, marque les lignes déjà liées et ne permet la création que sur un compte de type `asset`. Catégorie, description, série, emplacement, mise en service, durée et valeur résiduelle sont saisies. |
| Facturation — affectation des trop-perçus | **Implémenté** | Bouton `Affecter` sur un encaissement avec restant non affecté ; factures filtrées par client et devise ; montant plafonné ; date d’affectation contrôlée. |
| Facturation — annulation / réactivation | **Implémenté** | Annulation logique avec motif obligatoire, ligne conservée et badgée, réactivation par nouvelle affectation du même montant sur la même facture. La liste des encaissements renvoie désormais les affectations, y compris annulées, avec `allocatedDate`, `cancelledAt`, `reclassEntryId`. |
| Rapprochement comptable | **Implémenté** | Nouvel écran `/#/accounting/controls?tab=subledger`, accessible depuis le menu Comptabilité (`Contrôles comptables`). Il affiche, par compte collectif et par devise : solde comptabilisé, sous-ledger comptabilisé, éléments non comptabilisés, total sous-ledger, écart, part expliquée et part inexpliquée. Les documents et règlements non comptabilisés sont listés. Aucun écart n’est arrondi, masqué ou ramené à zéro. |
| Contrôle TVA | **Implémenté** | Onglet `Contrôle TVA` du même écran, avec période sélectionnable, totaux **par devise**, détail par compte et par devise, TVA signée. Le bandeau indique explicitement qu’il ne s’agit **pas d’une déclaration officielle MRA** et qu’aucun taux, seuil ou case fiscale n’est inventé. |
| OCR — statuts et factures liées | **Implémenté** | La liste des documents affiche le statut OCR de comptabilisation (`OCR à compléter`, `Prêt à comptabiliser`, `Facture fournisseur liée`, `Comptabilisé`) et le numéro de la facture fournisseur liée. La fiche document affiche le lien vers la facture et vers l’écran Achats. Le backend de démonstration expose les mêmes champs et la conversion OCR → facture fournisseur. |
| Confirmations humaines | **Implémenté** | Messages explicites avant affectation, annulation et création d’immobilisation ; aucun de ces parcours ne comptabilise automatiquement. |

**Corrections de contrat nécessaires aux écrans :**

- `GET /billing/payments` renvoie désormais les affectations (auparavant toujours vide dans la liste) avec leurs dates et statuts d’annulation ;
- `GET /purchases/documents/:id` renvoie `accountType` et le lien `fixedAssetId` / `fixedAssetCode` par ligne ;
- le backend de démonstration applique les mêmes contrôles de devise, date, plafond, doublon et confirmation ;
- correction d’un défaut de démonstration : la fiche d’un document d’achat retombait sur « route inconnue » à cause d’un groupe de capture optionnel non normalisé (`undefined` au lieu de `''`).

---

## 3. Fichiers principaux modifiés ou créés

### API

| Fichier | Rôle |
|---|---|
| `apps/api/sql/migrations/0025_mission42_purchase_sales_integrity.sql` | Migration additive : dates d’affectation, annulation, reclassement, lien OCR→achat, lien ligne→immobilisation, compte `1150`, contrainte des sources de proposition |
| `apps/api/src/modules/documents/service.ts` | Conversion OCR→facture fournisseur, statuts de comptabilisation, garde de double création |
| `apps/api/src/modules/documents/routes.ts` | Route de conversion OCR |
| `apps/api/src/modules/purchases/service.ts` | Avoirs disponibles en liste, affectations, aging à date, soldes par devise, immobilisation depuis ligne, correctifs SQL |
| `apps/api/src/modules/purchases/routes.ts` | Affectation, reclassement, immobilisation |
| `apps/api/src/modules/billing/service.ts` | Aging par devise et date, solde client par devise, affectation/annulation, reclassement, signe des acomptes |
| `apps/api/src/modules/billing/routes.ts` | Affectations, soldes, résumé par devise, actions de comptabilisation |
| `apps/api/src/modules/ai/proposals.ts` | Sources `billing_allocation` / `purchase_allocation`, verrouillage, liaison `reclass_entry_id`, propositions de reclassement |
| `apps/api/src/modules/reconciliation/service.ts` | Contrôle sous-registres ↔ grand livre |
| `apps/api/src/modules/reconciliation/vat.ts` | Contrôle TVA sur écritures postées |
| `apps/api/src/modules/reports/routes.ts` | Routes des deux contrôles |
| `apps/api/src/modules/accounts/chart.ts` | Compte `1150` — avances aux fournisseurs |
| `apps/api/src/lib/errors.ts` | Codes d’erreur M42 |
| `apps/api/tests/mission42.test.ts` | 10 scénarios d’intégration M42 / M42.1 |

### Web

| Fichier | Rôle |
|---|---|
| `apps/web/src/pages/accounting/Controls.tsx` | **Nouveau** — rapprochement comptes collectifs ↔ grand livre et contrôle TVA |
| `apps/web/src/demo/controls.ts` | **Nouveau** — calcul de démonstration des deux contrôles, par devise et sans écart forcé |
| `apps/web/src/pages/documents/ScanImport.tsx` | Bouton de création de la facture fournisseur, statuts OCR et facture liée |
| `apps/web/src/pages/accounting/Purchases.tsx` | Affectation tardive, reclassement proposé, immobilisation depuis une ligne |
| `apps/web/src/pages/billing/Payments.tsx` | Affectation tardive, annulation motivée et réactivation d’une affectation |
| `apps/web/src/demo/purchases.ts` | Mêmes contrôles d’affectation et de création d’immobilisation en démonstration |
| `apps/web/src/demo/mission23.ts` | Conversion OCR → facture fournisseur et statuts de comptabilisation en démonstration |
| `apps/web/tests/mission42-ui.test.tsx` | **Nouveau** — 3 tests de rendu des nouveaux écrans et parcours |
| `apps/web/src/pages/billing/Documents.tsx` | Préparation, validation et comptabilisation depuis Facturation |
| `apps/web/src/pages/billing/Aging.tsx` | Balance âgée par devise |
| `apps/web/src/pages/billing/Customers.tsx` | Solde client par devise |
| `apps/web/src/pages/billing/Overview.tsx` | Créances et aging par devise |
| `apps/web/src/demo/runtime.ts` | Même séparation par devise en mode démonstration |
| `apps/web/src/i18n.tsx` | Libellés FR/EN des nouveaux parcours |

---

## 4. Tests réellement exécutés

Tous les tests ci-dessous ont été exécutés le 1er novembre 2026, dans cet ordre final.

| Commande | Résultat exact |
|---|---|
| `npm ci` | **exit 0** |
| `npm run typecheck` | **exit 0** — API et Web, aucune erreur TypeScript |
| `npm run test -w @mc/api` | **531 tests réussis, 11 ignorés**, 36 fichiers réussis, 1 fichier ignoré (concurrence) |
| `npm run test -w @mc/web` | **385 tests réussis sur 385**, 58 fichiers |
| `npm run test -w @mc/api -- tests/mission42.test.ts` | **10 tests réussis sur 10** |
| `npm run test -w @mc/web -- tests/mission42-ui.test.tsx` | **3 tests réussis sur 3** |
| `npm run build` | **exit 0** — build Web et API |
| `npm run build:demo` | **exit 0** |
| `node scripts/verify-demo.mjs --dist apps/web/dist --base /mauritius-compta/` | **50 contrôles réussis, 0 échec** |
| CI GitHub Actions — `Typecheck, tests and build` | **succès** — 2 min 57 s |
| CI GitHub Actions — `API tests against real PostgreSQL` | **succès** — 2 min 7 s |
| CI GitHub Actions — `Migrations against real PostgreSQL` | **succès** — 28 s, migrations réappliquées pour l’idempotence |
| CI GitHub Actions — `Build demo bundle` | **succès** — 1 min 32 s |
| CI GitHub Actions — `Deploy to GitHub Pages` | **ignoré** (brouillon, aucun déploiement) |

Exécutions CI du commit `b4f505f` :
- CI : https://github.com/azharshahim/mauritius-compta/actions/runs/41354118075
- Démo : https://github.com/azharshahim/mauritius-compta/actions/runs/41354117900

Exécutions CI du commit de code M42.1 `77484d7` (toutes vertes) :
- CI : https://github.com/azharshahim/mauritius-compta/actions/runs/41357484438
- Démo : https://github.com/azharshahim/mauritius-compta/actions/runs/41357484353
- `gh pr checks 23` : Typecheck/tests/build **pass**, API PostgreSQL **pass**, Migrations PostgreSQL **pass**, Build demo bundle **pass**, Deploy Pages **skipping**.

### Scénarios du fichier `apps/api/tests/mission42.test.ts`

1. **Ventes MUR + EUR, aging et solde à date** : deux factures, deux encaissements datés, affectations au 01/12 ; au 31/10 les deux devises restent à 1 000 chacune, au 31/12 elles valent 800 MUR et 900 EUR ; `totals` et `openReceivables` sont `null`, les tableaux par devise contiennent deux lignes.
2. **Trop-perçu client** : encaissement de 800 sur facture de 500, affectation tardive de 300, annulation, réactivation de la même ligne ; le restant dû et le montant payé sont vérifiés après chaque étape.
3. **Acompte fournisseur** : acompte de 600 comptabilisé, facture de 400, affectation tardive ; `reclassRequired = true`, proposition de reclassement `purchase_allocation` équilibrée sur `1150` et `2000`, date et devise réelles, comptabilisation séparée, deuxième appel idempotent.
4. **Immobilisation** : facture d’achat sur compte `1500`, création de la fiche, second appel idempotent, une seule ligne dans `fixed_assets`.
5. **OCR** : document et proposition insérés en base avec un statut approuvé, conversion en facture fournisseur validée, second appel `alreadyCreated = true` sans doublon, aucune écriture comptabilisée.
6. **TVA** : trois écritures postées dont une hors période ; état limité à septembre, TVA collectée 150, déductible 75, nette 75, `officialReturn: false`.
7. **Rapprochement AR** : facture non comptabilisée classée `explained`, puis écriture manuelle sans pièce classée `unexplained` à −400 ; `hasUnexplainedDifference = true`.
8. **Avoirs fournisseurs en liste** : avoir de 200, `credit_available = 200.0000` dans la liste.
9. **Contrôles inaccessibles à un non-membre** : les routes `reports/subledger-reconciliation` et `reports/vat-control` renvoient 403/404 à un utilisateur qui n’appartient pas à la société, ce qui vérifie l’autorisation côté serveur.
10. **Contrat de liste des encaissements** : après annulation puis réactivation, la liste renvoie l’affectation avec `allocatedDate`, `cancelledAt` nul et le numéro de facture ; après affectation d’un acompte fournisseur comptabilisé, `reclassEntryId` est renseigné.
11. **Ligne d’achat immobilisée** : la fiche du document renvoie `fixedAssetId`, `fixedAssetCode` et `accountType = asset` pour la ligne concernée.
12. **Double soumission** : une seconde affectation identique sur la même facture renvoie 409, sans doublon.
13. **Changement de devise** : un encaissement EUR ne peut pas être affecté à une facture MUR ; l’API répond `CURRENCY_MISMATCH` (400).

### Tests non exécutés ou non disponibles

- **Navigateur réel / Playwright** : aucun navigateur n’est disponible dans l’environnement ; les écrans sont couverts par les tests de rendu Web et le build, pas par un parcours E2E visuel.
- **Tests UI dédiés M42.1** : 3 tests de rendu couvrent les contrôles comptables, l’affectation/annulation d’un encaissement et l’ouverture de la fenêtre d’immobilisation. Les créations effectives d’immobilisation et de reclassement depuis l’interface restent couvertes par les tests API, pas par un test de bout en bout.
- **Tests navigateur réels** : absence signalée explicitement ; les tests utilisent jsdom, pas un navigateur.
- **Performance de charge** : non mesurée.

---

## 5. Erreurs rencontrées et corrigées pendant la mission

| Problème | Correction |
|---|---|
| Codes `ErrorCode` manquants | 25 codes M42 ajoutés à l’union fermée |
| `createAsset` renvoie une vue et non une ligne | utilisation de `created.asset` puis retour d’une fiche plate |
| Comparaisons `source_kind` impossibles | `SourceKind` élargi et `sourceRow` complété pour les allocations |
| `Remittance` sans `kind` / `posted` | interface corrigée, pas les littéraux |
| Aging SQL `text - text` | colonnes numériques conservées dans le CTE, cast en texte seulement à la sortie |
| Transaction imbriquée OCR → validation achat | extraction de `validatePurchaseDocumentTx` pour rester dans la transaction existante |
| Signe GL inversé côté créances | débit-crédit pour l’actif, crédit-débit pour le passif |
| Compte d’avance fournisseur absent | compte `1150` ajouté au plan provisoire et repris de façon additive |
| Addition de devises dans le résumé ventes | totaux et compteurs par devise, valeur unique seulement si une seule devise |

---

## 6. Matrice des constats M41

Légende : **Corrigé** = comportement démontré par un test ou vérifié directement ; **Partiel** = API ou service livré mais parcours/écran incomplet ; **Non corrigé** = hors périmètre M42 ou non traité.

| Constat | Sujet | Statut M42 | Commentaire |
|---|---|---|---|
| A-01 | OCR achat sans facture fournisseur | **Corrigé** | Conversion API + bouton OCR + test de non-double création |
| A-02 | `credit_available` nul en liste | **Corrigé** | Calcul en liste + test |
| A-03 | Acompte fournisseur non affectable après coup | **Corrigé** | Bouton d’affectation tardive, restant à affecter, devise et date contrôlées |
| A-04 | Pas de rapprochement fournisseurs ↔ GL | **Corrigé** | Écran de rapprochement fournisseurs, écarts expliqués et inexpliqués visibles |
| A-05 | Aging fournisseur non reconstruit à date | **Corrigé** | `allocated_date` + aging à date |
| A-06 | Ligne d’immobilisation non reliée au registre | **Corrigé** | Action depuis la ligne admissible, lien renvoyé par la fiche document |
| A-07 | Position fournisseur nette incomplète | **Corrigé** | Solde par devise, avoirs et acomptes exposés |
| A-08 | Comptabilisation achats seulement via les propositions | **Corrigé** | Actions valider/comptabiliser dans Achats |
| B-01 | Aging et solde client mélangent les devises | **Corrigé** | Séparation API, écrans et démo ; test MUR/EUR |
| B-02 | Trop-perçu client non affectable après coup | **Corrigé** | Affectation, annulation motivée et réactivation dans l’écran Encaissements |
| B-03 | Aucune comptabilisation depuis Facturation | **Corrigé** | Préparer/valider/comptabiliser dans l’écran Documents |
| B-04 | Aging client non reconstruit à date | **Corrigé** | Dates réelles d’affectation, test au 31/10 et 31/12 |
| B-05 | Pas de rapprochement clients ↔ GL | **Corrigé** | Écran de rapprochement clients, aucun écart masqué |
| B-06 | Tableau de bord ventes sans compteur en attente | **Partiel** | Compteur exposé par l’API ; pas de carte dédiée dans l’interface |
| C-01 | Rapport bancaire sur période | **Non corrigé** | Renvoyé à M43 |
| C-02 | Compteurs de transactions partiellement rapprochées | **Non corrigé** | Renvoyé à M43 |
| C-03 | Validation de période de relevé | **Non corrigé** | Renvoyé à M43 |
| C-04 | Encaissement bancaire non transformable en règlement | **Non corrigé** | Renvoyé à M43 |
| D-01 | Parcours OCR non opérationnel | **Corrigé** | Conversion, validation, lien et test |
| D-02 | Rescannage légèrement différent | **Partiel** | Détection existante conservée ; pas de parcours de résolution dédié |
| D-03 | Multi-factures détecté mais non séparé | **Partiel** | Garde et confirmation humaine ; séparation automatique non faite |
| D-04 | `APPROVED` confondu avec comptabilisé | **Corrigé** | Statuts OCR affichés (à compléter / prêt / facture liée / comptabilisé) et numéro de facture liée |
| E-01 | Aucun état de contrôle TVA | **Corrigé** | Écran TVA, périodes, comptes et devises, mention explicite de non-déclaration MRA |
| E-02 | Contrôle transverse AR/AP ↔ GL | **Corrigé** | Écran accessible depuis Comptabilité, écarts expliqués et inexpliqués toujours visibles |
| E-03 | Documents validés non comptabilisés non exposés côté ventes | **Partiel** | `awaitingAccounting` exposé ; pas de carte dédiée |
| E-04 | Documentation historique contradictoire | **Non corrigé** | Le présent rapport est à jour ; les anciens documents n’ont pas été réécrits |

**Bilan** : 17 constats corrigés, 4 partiels (B-06, D-02, D-03, E-03), 5 non corrigés (C-01 à C-04 renvoyés à M43, plus E-04).

---

## 7. Risques, dépendances et points ouverts

### Risques

1. **Parcours visuels** : les lots 2, 4 et 6 disposent désormais d’écrans dédiés, mais la création effective d’une immobilisation ou d’un reclassement depuis l’interface n’est pas couverte par un test E2E navigateur.
2. **Migration `0025`** : additive, mais elle insère le compte `1150` dans les sociétés existantes ayant un compte `1100`. Une sauvegarde et un test sur copie restent obligatoires avant toute exploitation.
3. **Plan comptable** : `1150` fait partie du plan provisoire de démonstration ; il doit être validé par un comptable avant usage réel.
4. **Résumé ventes** : le contrat `billing/summary` a changé (`openReceivables` et `payments.unallocated` peuvent être `null`). Les écrans internes ont été adaptés ; tout consommateur externe doit être vérifié.
5. **PostgreSQL réel** : les tests locaux utilisent PGlite ; le job CI PostgreSQL a réussi sur le commit `b4f505f`, y compris les migrations et leur réapplication. Une sauvegarde reste obligatoire avant toute exploitation.
6. **TVA** : l’état est un contrôle de comptes, pas une déclaration MRA. Il ne doit jamais être présenté comme un formulaire officiel.
7. **Aucune mesure de performance** sur les nouvelles requêtes d’aging et de rapprochement.

### Dépendances pour M43

- C-01 à C-04 : rapports bancaires sur période, compteurs partiels, validation de période, transformation d’un encaissement bancaire en règlement.
- Résolution guidée des rescannages et séparation multi-factures (D-02, D-03 restent partiels).
- Carte dédiée des documents validés non comptabilisés côté ventes (E-03).
- Tests E2E navigateur des parcours d’affectation, d’immobilisation et de contrôle comptable.
- Mise à jour des documents d’audit historiques (E-04).

---

## 8. Statut Git, fusion et déploiement

- **Aucune fusion** effectuée.
- **Aucun déploiement** effectué.
- **Aucune modification du VPS OVH.**
- **Aucune publication GitHub Pages.**
- Branche poussée : `arena/e8400c4a-mauritius-compta` ; commit de code M42.1 `77484d7`, précédé de `c0491b0` (M42).
- **PR nº23 en brouillon** : https://github.com/azharshahim/mauritius-compta/pull/23
- La fusion reste à la décision de l’utilisateur, après audit.

---

## 9. Recommandation finale

**Statut : prêt pour l’audit final avant fusion ; aucune fusion ni publication effectuée.**

M42 et M42.1 sont implémentés et vérifiés localement : typecheck, 531 tests API, 385 tests Web, 10 scénarios d’intégration M42, 3 tests d’interface M42.1, builds Web/API/démo et 50 contrôles de démonstration. Les points P1 majeurs A-01, A-02, A-05, B-01, B-03, B-04 et D-01 sont corrigés, et les écrans des lots 2, 4 et 6 sont désormais présents.

Limites restantes : D-02 (rescannage), D-03 (séparation multi-factures), E-03 (carte ventes des documents non comptabilisés) et C-01 à C-04 (banque, M43). Aucun test navigateur réel (Playwright) n’a été exécuté. **P0-03 reste ouvert** : aucune mise en production n’est autorisée.

**Recommandation explicite** : effectuer l’**audit final avant fusion** sur les points sensibles — migration `0025`, compte provisoire `1150`, signes et libellés des écarts de rapprochement, contrat `billing/summary`, autorisations serveur et absence de comptabilisation automatique. Après validation de l’audit, la PR nº23 pourra être fusionnée sur autorisation explicite. **Ne pas fusionner et ne pas déployer en l’état sans cette autorisation.**
