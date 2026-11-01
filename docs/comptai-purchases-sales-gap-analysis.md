# COMPTAI — analyse des écarts Achats & Ventes

**Mission 41 — audit fonctionnel, lecture seule**
**Base :** `main` = `8fd9a2d58aec9147b7530fcb971b3511e5757e16`
**Documents liés :** [audit général](./mission-41-accounting-functional-audit.md) · [banque](./comptai-banking-reconciliation-gap-analysis.md) · [OCR](./comptai-ocr-posting-gap-analysis.md) · [plan M42/M43](./comptai-missions-42-43-implementation-plan.md)

> **Périmètre.** Fournisseur → facture → OCR → suggestion → validation → journal des achats → grand
> livre → règlement → lettrage → banque. Client → facture → journal des ventes → grand livre →
> encaissement → lettrage → banque. Les montants, fournisseurs et clients cités sont fictifs.

## 1. Résumé

| Statut | Achats | Ventes |
|---|---|---|
| **Implémenté** | Fournisseur, facture, avoir, validation, proposition, comptabilisation, règlement, allocation, aging par devise, audit | Client, devis, facture, avoir, encaissement partiel, duplication, comptabilisation API, PDF |
| **Partiel** | OCR → achat, lettrage, historique à date, immobilisations, position nette | Comptabilisation depuis l’UI, historique à date, sous-registre ↔ GL |
| **Manquant** | Réaffectation d’un acompte, rapprochement AP ↔ GL | Réaffectation d’un trop-perçu, rapprochement AR ↔ GL |
| **Démo seulement** | Aucun moteur parallèle détecté dans le périmètre audité | Même conclusion |
| **Non vérifié** | Relevés/pièces réelles, navigateur, PostgreSQL réel en M41 | Idem |

**Verdict.** Le cœur transactionnel est solide et les calculs monétaires sont exacts. Les écarts
portent sur les **ponts entre sous-registres**, la **réutilisation des règlements non affectés**,
les **états historiques** et la **découvrabilité de la comptabilisation**. Aucun nouveau P0.

---

## 2. Achats

### A-01 — L’OCR d’une facture d’achat ne crée aucune facture fournisseur

| Champ | Contenu |
|---|---|
| **Module / workflow** | OCR & import documentaire → Achats & Fournisseurs |
| **Statut** | **Partiel** (extraction + proposition) / **Manquant** (intégration sous-registre) |
| **Sévérité** | **P1** — bloqueur de démonstration de bout en bout |
| **Affectation** | **M42** |
| **Preuve code** | `apps/api/src/modules/documents/service.ts:655-686` : `approveProposal` insère une écriture `status='draft'`, `source='manual'`, puis met à jour `document_proposals` et `document_imports`. Aucune insertion dans `purchase_documents`. Le retour indique explicitement « A draft entry was created ». |
| **Preuve test** | `apps/api/tests/mission23.test.ts` — « uploads a purchase invoice, proposes a balanced draft and learns only after approval » : `draftEntry.status === 'draft'`. `tests/mission29.test.ts` vérifie la proposition, pas la création d’une facture d’achat. |
| **Scénario de reproduction** | 1) Téléverser une facture fournisseur PDF fictive de 17 250 MUR. 2) `POST /documents/:id/proposal`. 3) `POST /documents/proposals/:id/approve` avec `confirm:true`. 4) Ouvrir Achats → Factures, puis `GET /purchases/documents`. |
| **Résultat attendu** | La facture OCR apparaît comme facture fournisseur validée (ou une action explicite « Créer la facture d’achat » produit ce résultat), avec un lien vers l’écriture brouillon et la pièce source. |
| **Résultat réel** | Une écriture brouillon existe dans le journal des achats, mais aucune `purchase_documents` n’est créée. La facture ne peut être ni payée, ni lettrée, ni âgée, ni rapprochée. |
| **Cause racine** | Deux modèles coexistent : `document_imports`/`document_proposals` pour l’OCR et `purchase_documents` pour le sous-registre. Le pont n’existe que pour les propositions comptables, pas pour la donnée commerciale. |
| **Correction recommandée** | Ajouter un service transactionnel `createPurchaseInvoiceFromDocument` (M42) : contrôle de doublon, reprise fournisseur/lignes/TVA, création `purchase_documents` + lignes, lien `source_document_id`/`document_import_id`, puis proposition comptable sur la facture créée. Interdire deux créations pour le même document. |
| **Test de non-régression à ajouter** | OCR → approbation → facture fournisseur visible, une seule fois, avec totaux et TVA identiques ; paiement possible ; second appel refusé. |

### A-02 — L’availabilité des avoirs fournisseurs est nulle dans la liste

| Champ | Contenu |
|---|---|
| **Module / workflow** | Achats → Avoirs → Affectation à une facture |
| **Statut** | **Partiel** (API de détail correcte, liste incorrecte) |
| **Sévérité** | **P1** — l’affectation est impossible depuis l’écran |
| **Affectation** | **M42** |
| **Preuve code** | `apps/api/src/modules/purchases/service.ts:1036` : `credit_available: '0.0000'` en dur dans `listPurchaseDocuments`. Le détail calcule la vraie valeur (`service.ts:961-964`). L’écran `apps/web/src/pages/accounting/Purchases.tsx:1250` filtre `toScaled4(c.credit_available) > 0n`. |
| **Preuve sonde** | Facture 1 000 MUR + avoir 200 MUR validés : liste → `"0.0000"`, détail → `"200.0000"`. |
| **Scénario de reproduction** | Créer et valider une facture et un avoir fournisseur, ouvrir Achats → Avoirs → « Affecter un avoir ». Le sélecteur d’avoir est vide. |
| **Résultat attendu** | L’avoir disponible apparaît avec 200 MUR et peut être affecté. |
| **Résultat réel** | Aucun avoir sélectionnable. L’API d’affectation fonctionne si on l’appelle directement avec l’identifiant. |
| **Cause racine** | Optimisation de liste ayant remplacé le calcul par une constante, sans charger l’agrégat des allocations. |
| **Correction recommandée** | Calculer `credit_available` dans la requête de liste via une sous-requête `SUM(purchase_credit_allocations.amount)` filtrée sur `cancelled_at IS NULL`, ou charger les avoirs via le détail. Ajouter un test API sur la liste. |
| **Test de non-régression** | Liste d’avoirs : 200 disponible, 0 après affectation totale, jamais négatif. |

### A-03 — Un acompte fournisseur ne peut pas être affecté à une facture ultérieure

| Champ | Contenu |
|---|---|
| **Module / workflow** | Achats → Règlements → Acompte → Affectation |
| **Statut** | **Partiel** (enregistrement et comptabilisation) / **Manquant** (affectation) |
| **Sévérité** | **P1** |
| **Affectation** | **M42** |
| **Preuve code** | `purchases/service.ts:1370-1375` : un acompte ne peut pas être alloué à la création ; `purchases/routes.ts` n’expose aucune route `POST /purchases/payments/:id/allocations`. `unallocated_amount` est écrit mais jamais consommé. `proposals.ts:76-110` propose l’acompte sur un compte de prépaiement. |
| **Preuve test** | `tests/purchases.test.ts` — « records a prepayment as an advance that settles no invoice » : l’acompte est accepté, mais aucun test d’affectation ultérieure n’existe. |
| **Scénario de reproduction** | Créer un acompte de 10 000 MUR, le comptabiliser, puis créer une facture de 25 000 MUR. Tenter d’affecter l’acompte. Aucun endpoint ni bouton n’existe. |
| **Résultat attendu** | L’acompte peut être affecté à la facture ; le solde dû devient 15 000 ; une proposition de reclassement débite le compte fournisseur et crédite le compte de prépaiement, avec validation humaine. |
| **Résultat réel** | L’acompte reste indéfiniment non affecté, bien que la ligne de règlement affiche un montant non alloué. |
| **Cause racine** | Le modèle `purchase_payment_allocations` n’accepte que les allocations à la création ; aucune opération de mise à jour n’a été prévue. |
| **Correction recommandée** | Route `POST /purchases/payments/:paymentId/allocations` avec verrou, contrôle de dépassement sur l’acompte et la facture, mise à jour `unallocated_amount`, `refreshPurchaseInvoiceBalance`, audit. Proposition de reclassement prépaiement → dette fournisseur. |
| **Test de non-régression** | Acompte 10 000 + facture 25 000 → affectation 10 000 → solde 15 000 ; > disponible refusé ; double affectation refusée ; écriture de reclassement équilibrée. |

### A-04 — Aucun rapprochement sous-registre fournisseurs ↔ grand livre

| Champ | Contenu |
|---|---|
| **Module / workflow** | Achats → Solde fournisseur / grand livre / clôture |
| **Statut** | **Manquant** |
| **Sévérité** | **P1** — déjà identifié comme P1-11 dans le registre de préproduction |
| **Affectation** | **M42** |
| **Preuve code** | `purchasesAging` et `supplierBalance` lisent `purchase_documents` ; le grand livre lit `journal_lines`. Aucune route de contrôle ne compare le total du compte collectif fournisseur au total des soldes auxiliaires. `accounting-gaps-audit.md` et `comptai-preproduction-gaps.md` P1-11 le confirment. |
| **Scénario de reproduction** | Comptabiliser une facture fournisseur, puis créer une seconde facture validée non comptabilisée. Comparer le solde du compte 2000 au total de `purchasesAging`. |
| **Résultat attendu** | Un état affiche : solde GL du compte collectif, total sous-registre, écart, liste des documents validés non comptabilisés, et statut « rapproché / écart expliqué / écart inexpliqué ». |
| **Résultat réel** | Aucun état. L’écart est visible uniquement par recoupement manuel. |
| **Cause racine** | Absence de contrôle de clôture ; les deux registres sont liés document par document, pas agrégés. |
| **Correction recommandée** | État `GET /purchases/reconciliation` : par société, compte collectif et devise, total sous-registre, total GL, écart, documents non comptabilisés, détail. Contrôle non bloquant en M42, bloquant à la clôture après validation du cabinet. |
| **Test de non-régression** | Facture comptabilisée + facture non comptabilisée → écart égal au document non comptabilisé, statut « expliqué ». |

### A-05 — La balance âgée fournisseur n’est pas reconstruite à la date demandée

| Champ | Contenu |
|---|---|
| **Module / workflow** | Achats → Échéancier / balance âgée (`asOf`) |
| **Statut** | **Partiel** |
| **Sévérité** | **P1** — un état historique est faux |
| **Affectation** | **M42** |
| **Preuve code** | `purchases/service.ts:1848-1866` : `asOf` ne sert qu’au calcul des jours de retard ; `amount_paid` et `credited_amount` sont les agrégats **courants**. Aucune jointure sur la date de paiement ou d’avoir. |
| **Scénario de reproduction** | Facture de 1 000 MUR au 01/09/2025. Paiement de 400 MUR daté du 01/12/2025. Demander l’aging au 30/09/2025. |
| **Résultat attendu** | Restant dû au 30/09 : 1 000 MUR. |
| **Résultat réel** | Restant dû : 600 MUR, car le paiement postérieur est déjà déduit. |
| **Cause racine** | Les agrégats `amount_paid`/`credited_amount` sont des soldes courants, non des soldes à date. |
| **Correction recommandée** | Calculer l’aging à partir des affectations dont `payment_date`/`allocation date` ≤ `asOf`, ou ajouter une table d’historique des soldes. Ne pas modifier les agrégats courants utilisés par les écrans du jour. |
| **Test de non-régression** | Paiement et avoir postérieurs à `asOf` ignorés ; paiement antérieur pris en compte ; multi-devises préservé. |

### A-06 — Une ligne d’immobilisation n’est pas reliée au registre des immobilisations

| Champ | Contenu |
|---|---|
| **Module / workflow** | Achats → Ligne affectée à un compte d’immobilisation → Registre / amortissement |
| **Statut** | **Partiel** |
| **Sévérité** | **P2** |
| **Affectation** | **M42** |
| **Preuve code** | `assertPurchaseAccount` autorise les comptes d’actif ; `purchases/proposals.ts` débite le compte de la ligne. Aucun champ `fixed_asset_id` ni création dans `fixed_assets`. Le registre ne stocke que `supplier_name`, `invoice_ref`, `document_ref` saisis manuellement (`fixed-assets/service.ts:430-438`). |
| **Scénario de reproduction** | Facturer une imprimante fictive sur le compte 1500, la comptabiliser, puis ouvrir Immobilisations. |
| **Résultat attendu** | Proposition de création d’une fiche d’immobilisation liée à la ligne d’achat, ou avertissement explicite que l’amortissement doit être créé manuellement. |
| **Résultat réel** | L’écriture est correcte au grand livre, mais aucune fiche n’existe ; l’amortissement ne démarre pas. Le contrôle de rapprochement immobilisations/GL peut détecter l’écart, mais après coup. |
| **Cause racine** | Absence de pont achat → immobilisation. |
| **Correction recommandée** | Lien optionnel `purchase_document_line_id` dans `fixed_assets`, action « Créer l’immobilisation » depuis la facture, préremplissage coût/date/fournisseur. Aucune création automatique sans confirmation. |
| **Test de non-régression** | Ligne d’actif → fiche liée → amortissement proposé ; pas de double création. |

### A-07 — La position fournisseur nette omet les acomptes et avoirs non appliqués

| Champ | Contenu |
|---|---|
| **Module / workflow** | Achats → Fiche fournisseur / solde |
| **Statut** | **Partiel** |
| **Sévérité** | **P2** |
| **Affectation** | **M42** |
| **Preuve code** | `supplierBalance` (`purchases/service.ts:1735-1800`) ne somme que les factures validées ; les avoirs disponibles sont retournés séparément (`creditAvailable`) et les acomptes ne sont pas inclus. |
| **Scénario de reproduction** | Facture 10 000, avoir 2 000 non affecté, acompte 3 000. La fiche affiche 10 000 dus, 2 000 d’avoir disponible ; la position nette n’est pas calculée. |
| **Résultat attendu** | Position nette = factures − avoirs appliqués − acomptes affectés, avec lignes séparées pour les éléments non appliqués. |
| **Résultat réel** | La fiche ne présente pas de position nette unique ; l’utilisateur doit interpréter plusieurs blocs. |
| **Cause racine** | Absence d’agrégat de position nette. |
| **Correction recommandée** | Ajouter `netPosition` par devise, sans addition inter-devises, et libellés explicites. |
| **Test de non-régression** | Avoir non appliqué et acompte non appliqué visibles séparément, jamais fondus dans le dû. |

### A-08 — La comptabilisation des achats n’est accessible que par l’écran des propositions

| Champ | Contenu |
|---|---|
| **Module / workflow** | Achats → Facture/Règlement → Comptabilisation |
| **Statut** | **Partiel** (fonctionnel) / **Manquant** (parcours) |
| **Sévérité** | **P2** |
| **Affectation** | **M42** |
| **Preuve code** | `apps/web/src/pages/accounting/Purchases.tsx:759-763` prépare la proposition puis renvoie vers `/cabinet/ai-proposals?proposal=...`. Le module fonctionne, mais l’action finale est hors du parcours Achats. |
| **Scénario de reproduction** | Préparer une proposition de facture d’achat, puis tenter de la valider et de la comptabiliser sans quitter Achats. |
| **Résultat attendu** | Action « Vérifier et comptabiliser » avec confirmation explicite, réutilisant le même moteur. |
| **Résultat réel** | Navigation externe obligatoire. |
| **Cause racine** | Séparation historique entre propositions IA et modules métier. |
| **Correction recommandée** | Intégrer un panneau de validation/comptabilisation dans Achats, sans dupliquer le moteur. |
| **Test de non-régression** | Même proposition, même contrôle d’accès, même idempotence. |

---

## 3. Ventes

### B-01 — La balance âgée et le solde client mélangent les devises

| Champ | Contenu |
|---|---|
| **Module / workflow** | Ventes → Balance âgée / Fiche client |
| **Statut** | **Implémenté mais incorrect en multi-devises** |
| **Sévérité** | **P1** — état comptable faux |
| **Affectation** | **M42** |
| **Preuve code** | `billing/service.ts:586-610` groupe uniquement par `customer_id`, pas par devise. `billing/service.ts:680-711` additionne toutes les factures et tous les trop-perçus, puis retourne `currency = invoices.rows[0]?.currency`. |
| **Preuve sonde** | Factures 1 000 MUR + 100 EUR (taux 50) : aging → une ligne MUR de 900 ; balance → `currency: EUR`, `invoiced: 1100`. |
| **Scénario de reproduction** | Créer un client, une facture MUR et une facture EUR, puis consulter l’aging et la fiche client. |
| **Résultat attendu** | Une ligne par client **et par devise** : MUR 1 000 et EUR 100, avec avoir MUR séparé. |
| **Résultat réel** | Une seule ligne, devise de la première facture, montants additionnés sans conversion. |
| **Cause racine** | Clé d’agrégation incomplète et agrégation avant séparation des devises. |
| **Correction recommandée** | Clé `(customerId, currency)` ; retourner un tableau par devise pour `customerBalance`. Ne jamais additionner des devises. Aligner le modèle sur `purchasesAging`, qui le fait correctement. |
| **Test de non-régression** | Factures MUR/EUR + avoir MUR : deux lignes, totaux exacts, aucune addition inter-devises. |

### B-02 — Un trop-perçu client ne peut pas être affecté ultérieurement

| Champ | Contenu |
|---|---|
| **Module / workflow** | Ventes → Encaissement → Affectation |
| **Statut** | **Partiel** |
| **Sévérité** | **P1** |
| **Affectation** | **M42** |
| **Preuve code** | `billing/routes.ts:2077` calcule `unallocated`, stocké dans `billing_payments.unallocated_amount` (`:2105`). Aucune route `POST /billing/payments/:id/allocations`. Le rapprochement bancaire exige un paiement déjà alloué (`bank/billing.ts:467-474`). |
| **Preuve test** | `tests/billing.test.ts` — paiement de 3 500 sur 3 000 : `unallocatedAmount = 500`, solde client `-500`, mais aucun test de réaffectation. |
| **Scénario de reproduction** | Encaisser 3 500 sur une facture de 3 000, puis créer une facture de 500 et tenter d’affecter le trop-perçu. |
| **Résultat attendu** | Affectation du trop-perçu à la nouvelle facture, avec proposition de reclassement du passif « avances clients » vers le compte client. |
| **Résultat réel** | Le trop-perçu reste non affecté ; le solde client reste négatif. |
| **Cause racine** | Même absence que côté achats : allocations figées à la création. |
| **Correction recommandée** | Route d’affectation, verrou, contrôle de dépassement, mise à jour `unallocated_amount`, rafraîchissement de la facture, audit, proposition de reclassement. |
| **Test de non-régression** | Trop-perçu 500 → facture 500 → solde 0 ; > disponible refusé ; annulation de l’affectation historisée. |

### B-03 — La comptabilisation des ventes n’est pas exposée dans Facturation

| Champ | Contenu |
|---|---|
| **Module / workflow** | Ventes → Facture / Avoir / Encaissement → Journal des ventes |
| **Statut** | **Manquant dans l’UI** (API opérationnelle) |
| **Sévérité** | **P1** — parcours de démonstration incomplet |
| **Affectation** | **M42** |
| **Preuve code** | `apps/web/src/pages/billing/Documents.tsx:662-690` affiche seulement `accountingEntryId` et le PDF ; aucun bouton de proposition/comptabilisation. `apps/web/src/pages/billing/Payments.tsx:198-210` affiche « posted » mais ne propose que « delete » avant comptabilisation. Seuls `cabinet/AiProposals.tsx:227` et `accounting/Bank.tsx:978` appellent `/ai/entry-proposals/from-billing`. |
| **Scénario de reproduction** | Émettre une facture, ouvrir sa fiche dans Facturation, chercher « Comptabiliser ». |
| **Résultat attendu** | Bouton explicite « Préparer la proposition », puis validation humaine, puis comptabilisation — sans quitter Facturation. |
| **Résultat réel** | Aucune action. L’utilisateur doit connaître l’écran Cabinet. |
| **Cause racine** | Le module Facturation est antérieur au moteur de propositions ; le pont n’a jamais été exposé. |
| **Correction recommandée** | Actions dans la fiche facture/avoir/encaissement, avec les mêmes contrôles et la même piste d’audit. |
| **Test de non-régression** | Facture → proposition → validation → comptabilisation → `accountingEntryId` renseigné ; second clic refusé. |

### B-04 — La balance âgée client n’est pas reconstruite à la date demandée

| Champ | Contenu |
|---|---|
| **Module / workflow** | Ventes → Aging (`asOf`) |
| **Statut** | **Partiel** |
| **Sévérité** | **P1** |
| **Affectation** | **M42** |
| **Preuve code** | `billing/service.ts:586-595` filtre les factures par `issue_date <= asOf`, mais utilise `amount_paid` et `credited_amount` courants. |
| **Scénario de reproduction** | Facture 1 000 au 01/09, encaissement 400 au 01/12, aging au 30/09. |
| **Résultat attendu** | 1 000 restant dû au 30/09. |
| **Résultat réel** | 600, car l’encaissement postérieur est déjà déduit. |
| **Cause racine** | Même agrégat courant que côté achats. |
| **Correction recommandée** | Reconstruire à partir des affectations et de leurs dates ; tests de non-régression sur plusieurs dates. |
| **Test de non-régression** | Paiement/avoir postérieurs ignorés ; antérieurs pris en compte ; devise préservée. |

### B-05 — Aucun rapprochement sous-registre clients ↔ grand livre

| Champ | Contenu |
|---|---|
| **Module / workflow** | Ventes → Solde client / grand livre / clôture |
| **Statut** | **Manquant** |
| **Sévérité** | **P1** — P1-11 existant |
| **Affectation** | **M42** |
| **Preuve code** | `buildAging`/`customerBalance` lisent `billing_documents` ; le grand livre lit `journal_lines`. Aucun état de contrôle. |
| **Scénario de reproduction** | Facture comptabilisée + facture émise non comptabilisée ; comparer compte 1100 et total client. |
| **Résultat attendu** | Écart égal aux documents non comptabilisés, avec statut explicite. |
| **Résultat réel** | Écart non mesuré. |
| **Cause racine** | Absence de contrôle de clôture. |
| **Correction recommandée** | Même état que A-04, côté clients, par compte collectif et devise. |
| **Test de non-régression** | Écart expliqué par documents non comptabilisés ; aucun écart inexpliqué sur jeu sain. |

### B-06 — Le tableau de bord ventes n’indique pas les documents en attente de comptabilisation

| Champ | Contenu |
|---|---|
| **Module / workflow** | Ventes → Tableau de bord |
| **Statut** | **Partiel** |
| **Sévérité** | **P2** |
| **Affectation** | **M42** |
| **Preuve code** | `billing/routes.ts:2329-2375` expose `postedDocuments` et le nombre de paiements, mais pas le nombre de factures/avoirs émis avec `accounting_entry_id IS NULL`. Les achats le font (`purchasesDashboard`, `awaitingAccounting`). |
| **Scénario de reproduction** | Émettre deux factures sans les comptabiliser, ouvrir le tableau de bord. |
| **Résultat attendu** | Compteur « en attente de comptabilisation » cliquable. |
| **Résultat réel** | Seul le nombre de documents comptabilisés est visible. |
| **Cause racine** | Indicateur non ajouté. |
| **Correction recommandée** | Ajouter le compteur et le lien vers la liste filtrée. |
| **Test de non-régression** | Deux factures non comptabilisées → compteur 2. |

---

## 4. Contrôles et workflows vérifiés sans anomalie

- **Numérotation** : achats `ACH-`, avoirs `AVF-`, règlements `RF-` par séquence annuelle et transaction ;
  ventes par préfixe configuré et politique annuelle/continue.
- **Immuabilité** : une facture d’achat comptabilisée ne peut être annulée ; une facture de vente émise
  ne peut être supprimée ; les corrections passent par avoir/contrepassation.
- **Anti-doublon achat** : index unique normalisé hors annulés ; test de référence dupliquée.
- **Anti-doublon vente** : doublon « certain » bloquant sans confirmation ; niveaux probable/similaire
  en alerte.
- **TVA** : aucun taux codé en dur ; un taux `standard` doit être vérifié et daté ; TVA récupérable
  explicitement qualifiée côté achats.
- **Affectations** : contrôles de dépassement sous verrou `FOR UPDATE` ; pas de double affectation de
  la même facture dans un paiement.
- **Rapprochement bancaire** : les liens partiels/multiples sont testés ; un paiement non alloué est
  refusé ; une annulation de paiement rapproché est refusée.
- **Isolation** : triggers et contrôles de société ; tests multi-société.

## 5. Ce que M42 ne doit pas casser

- Ne pas modifier les montants, taux ou formules existants.
- Ne pas créer un second moteur d’écriture : toute correction passe par `postEntryTx`/`postProposal`.
- Ne pas rendre la comptabilisation automatique sans validation humaine.
- Ne pas fusionner les devises pour « faire joli ».
- Ne pas supprimer d’assertion métier pour verdir la CI.
- Préserver la bilinguisme FR/EN et les libellés existants.
