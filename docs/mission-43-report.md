# Mission 43 — Accounting Integrity & Bank Reconciliation

**Date** : 2026-11-01
**Branche** : `arena/e8400c4a-mauritius-compta`
**Base** : empilée sur M42/M42.1 (`2bfa18d`), elle-même issue de `main` `cc56984`
**PR cible** : PR M42 nº23 (jamais une PR M43 vers `main`)
**Statut** : code et tests locaux exécutés ; CI à exécuter après push ; **aucune fusion, aucun déploiement, aucune modification du VPS, aucune donnée réelle**

---

## 1. Périmètre et dépendance M42

M43 dépend de M42/M42.1 pour :

- les affectations datées et annulables (`billing_payment_allocations`, `purchase_payment_allocations`) ;
- le contrôle transverse AR/AP ↔ GL et les états de contrôle ;
- la création de règlements clients via `POST /companies/:companyId/billing/payments` ;
- la migration `0025` (compte `1150`, liens OCR, immobilisations).

La branche M43 est donc **empilée sur la branche M42**. La PR M43 doit cibler la branche `arena/e8400c4a-mauritius-compta` (PR nº23), et non `main`, tant que M42 n’est pas fusionnée avec autorisation.

---

## 2. État initial constaté (C-01 à C-04)

Documents de référence lus : `docs/mission-41-accounting-functional-audit.md` (l. 208-211) et `docs/comptai-missions-42-43-implementation-plan.md` (§3.2 à §3.5).

| Constat | État initial vérifié dans le code | Impact |
| --- | --- | --- |
| **C-01** (P1) | `bankReport` comparait le **dernier solde cumulé du relevé** au **solde comptable calculé sur la seule sous-période**. Aucun solde d’ouverture ni de clôture séparé. | Écart faux, non explicable, pouvait sembler réconcilié ou masquer un vrai écart. |
| **C-02** (P2) | `counts` ne comptait que `matched` et `unmatched|proposed|review` ; `partially_matched` et `excluded` étaient ignorés ; aucun total. | Compteurs incohérents entre l’écran et le CSV. |
| **C-03** (P2) | Aucune table, aucun service, aucune route de validation de période ; seule la dernière décision de rapprochement était affichée. | Impossible de figer un relevé, son ouverture, sa clôture, son empreinte et un écart accepté documenté. |
| **C-04** (P2) | `linkBankBillingPayment` ne reliait qu’un règlement **déjà enregistré**. Aucun parcours banque → règlement. | Un encaissement bancaire ne pouvait pas devenir un règlement client depuis l’écran Banque. |

Autres constats de reconnaissance :

- statuts de transaction : `unmatched|proposed|matched|partially_matched|review|excluded|cancelled` ;
- `bank_matches` porte `entry_line_id`, `billing_payment_id`, `purchase_payment_id`, `amount`, `status`, avec index uniques partiels ;
- l’écran banque est unique (`apps/web/src/pages/accounting/Bank.tsx`), avec les onglets `accounts|import|transactions|rules|report` ;
- aucune connexion bancaire réelle n’existe : l’import est un fichier CSV/XLSX/PDF, les profils MCB sont des analyseurs de relevés.

---

## 3. Corrections apportées

### 3.1 C-01 — rapport par période avec ouverture, mouvements et clôture

`apps/api/src/modules/bank/service.ts` :

- solde bancaire d’ouverture = dernier solde de relevé **strictement avant** la période, sinon reconstruction depuis la première ligne (`solde − mouvement`) ;
- solde bancaire de clôture = dernier solde de relevé **dans** la période ;
- solde comptable d’ouverture = lignes **postées** avant la période ;
- mouvement comptable = lignes postées dans la période ;
- solde comptable de clôture = ouverture + mouvement ;
- `difference = clôture bancaire − clôture comptable`, **jamais forcé à zéro** ;
- `priorTransactionCount` et explication `PRIOR_TRANSACTIONS` pour les opérations antérieures ;
- les transactions `cancelled` sont exclues des mouvements et des compteurs ;
- les écritures brouillon ne sont pas incluses dans le solde comptable (explication implicite : seules les écritures postées sont rapprochables).

Le CSV (`bankReportCsv`) expose désormais ouverture, mouvements, clôtures, compteurs partiels/exclus/total et opérations antérieures.

**Parité démo** : `buildDemoReport` (`apps/web/src/demo/bank.ts`) applique la même définition, avec les mêmes explications.

### 3.2 C-02 — compteurs complets

Le rapport expose désormais :

`matchedCount`, `partiallyMatchedCount`, `unmatchedCount`, `excludedCount`, `totalCount`, `ledgerUnmatchedCount`, `unmatchedAmount`, `ledgerUnmatchedAmount`, `priorTransactionCount`.

`totalCount` = transactions non annulées de la période. Une transaction partiellement rapprochée déclenche l’explication `PARTIALLY_MATCHED_BANK_TRANSACTIONS` et empêche le statut `reconciled`.

### 3.3 C-03 — validation de période de relevé

**Migration additive** `apps/api/sql/migrations/0026_mission43_bank_reconciliation_periods.sql` :

- `bank_reconciliation_periods` : société, compte bancaire, dates, devise, ouverture/clôture bancaire, ouverture/clôture comptable, écart, écart accepté, statut (`open|validated|reopened`), empreinte du relevé, compteurs, note, validateur, dates, motif de réouverture ;
- `bank_reconciliation_period_events` : historique append-only des décisions ;
- index unique par société/compte/période ;
- **aucune validation ne crée d’écriture** ; aucun montant existant n’est modifié.

**Service** `apps/api/src/modules/bank/periods.ts` :

- ouverture/actualisation d’une période avec empreinte déterministe (`stableDigest`) du relevé ;
- validation humaine explicite (`confirm: true`) ;
- refus si une transaction est `unmatched`/`proposed`/`review` ou `partially_matched` ;
- refus si une ligne comptable postée n’est pas rapprochée ;
- refus si le solde de clôture bancaire est absent ;
- si l’écart n’est pas nul : note documentée d’au moins 10 caractères **et** écart accepté strictement égal à l’écart observé ;
- réouverture contrôlée avec motif et journalisation ;
- réouverture automatique au prochain lecture si l’empreinte ou les soldes changent après validation ; l’écart stocké n’est **pas** réécrit ;
- journal d’audit (`audit_log`) et événements métier.

**Routes** :

- `GET /companies/:companyId/bank/periods`
- `POST /companies/:companyId/bank/periods`
- `GET /companies/:companyId/bank/periods/:periodId`
- `POST /companies/:companyId/bank/periods/:periodId/validate`
- `POST /companies/:companyId/bank/periods/:periodId/reopen`
- `GET /companies/:companyId/bank/periods/:periodId/report.csv` : export des **montants figés** à la validation, sans recalcul.

### 3.4 C-04 — encaissement bancaire → règlement client

`apps/api/src/modules/bank/billing.ts` :

- `createBillingPaymentFromBankTransaction` crée le règlement client dans les tables de facturation existantes et le lien `bank_matches` **dans une seule transaction SQL** ;
- contrôle du sens (un débit ne peut pas devenir un encaissement), de la devise, du client, de la facture ouverte, du restant dû, du restant de la transaction ;
- numérotation via `nextBillingNumber` / `formatDocumentNumber` ;
- taux de change explicite obligatoire si la devise de la banque diffère de la devise fonctionnelle ;
- mise à jour du solde de facture via `refreshInvoiceBalance` ;
- `entryCreated: false` et message `POSTING_SEPARATE` : **aucune comptabilisation automatique** ;
- double appel : `idempotent: true`, aucun second règlement ;
- audit et événement bancaire.

**Route** : `POST /companies/:companyId/bank/transactions/:transactionId/billing-payment`.

**Interface** (`apps/web/src/pages/accounting/Bank.tsx`) : sélection du client, chargement des factures ouvertes dans la devise de la transaction, montant proposé = restant dû, confirmation humaine obligatoire, message explicite d’absence de comptabilisation.

**Parité démo** : le handler de démonstration crée le règlement dans l’état navigateur, met à jour la facture, confirme le lien, et retourne `entryCreated: false`.

### 3.5 Interface et période

- Carte rapport étendue : ouverture/mouvement/clôture bancaire et comptable, écart, tous les compteurs, opérations antérieures, explications.
- Section « Validation de période de relevé » : ouverture/actualisation, validation avec note et écart accepté, réouverture motivée, empreinte, historique, export CSV figé.
- Libellés FR et EN ajoutés ; l’écran existant est étendu, aucun module parallèle, aucun bouton fictif.

---

## 4. Réalisé / partiel / non réalisé

| Élément | Statut |
| --- | --- |
| C-01 rapport ouverture/mouvement/clôture (API + démo + CSV) | **Réalisé et testé** |
| C-02 compteurs matched/partial/unmatched/excluded/total | **Réalisé et testé** |
| C-03 table, service, routes, écran de validation, réouverture, CSV figé | **Réalisé et testé** (API + démo) |
| C-04 encaissement → règlement client, sans posting, idempotent | **Réalisé et testé** (API + démo) |
| C-04 règlement **fournisseur** créé depuis la banque | **Partiel** : le lien vers un paiement fournisseur **existant** reste disponible (`linkBankSupplierPayment`) ; la création d’un paiement fournisseur depuis un débit bancaire n’est pas implémentée. Le parcours UI actuel ne le propose pas. |
| Rapprochement avancé 1↔1, n↔1, 1↔n, partiel | **Déjà existant, conservé et re-testé** (M10) |
| Frais bancaires / virements internes | **Existant**, non modifié ; les frais restent une proposition ou une exclusion documentée |
| Import MCB, doublons, profils | **Existant**, non modifié ; tests M9/M23 conservés |
| Multi-devises | **Réalisé côté contrôle** : devise de la transaction imposée à la facture ; aucune addition inter-devises dans le rapport |
| Concurrence | **Partiel** : verrous `FOR UPDATE` et index uniques ; pas de test de charge concurrente réel (suite `concurrency` ignorée dans l’environnement) |
| E2E navigateur | **Non exécuté** : Playwright absent de l’environnement |
| PDF de période validée | **Non réalisé** : seul le CSV est exposé ; aucun PDF n’a été inventé |
| Export CSV de période validée | **Réalisé** (montants stockés, pas recalculés) |

---

## 5. Fichiers principaux

**API**

- `apps/api/src/modules/bank/service.ts` — rapport de période C-01/C-02, CSV.
- `apps/api/src/modules/bank/periods.ts` — **nouveau** service de périodes.
- `apps/api/src/modules/bank/routes.ts` — routes périodes et création de règlement.
- `apps/api/src/modules/bank/billing.ts` — C-04.
- `apps/api/src/lib/errors.ts` — codes `BANK_PERIOD_*`.
- `apps/api/src/modules/billing/service.ts` — compte d’avance fournisseur configurable (Phase A).
- `apps/api/src/modules/billing/routes.ts` — réglage `advanceToSupplierAccountId` (Phase A).
- `apps/api/sql/migrations/0026_mission43_bank_reconciliation_periods.sql` — **nouvelle** migration additive.

**Web**

- `apps/web/src/pages/accounting/Bank.tsx` — rapport étendu, périodes, assistant C-04.
- `apps/web/src/pages/GuidedDemo.tsx` — `openReceivables` nullable et détail par devise (Phase A).
- `apps/web/src/demo/bank.ts` — parité rapport/périodes/C-04.

**Tests**

- `apps/api/tests/mission43.test.ts` — C-01, C-02, C-03, C-04, compte d’avance configurable.
- `apps/api/tests/mission43-migrations.test.ts` — migration `0025` sur données fictives + `0026` + idempotence.
- `apps/web/tests/mission43-demo.test.ts` — parité démo rapport/période/C-04.

**Documentation**

- `docs/mission-42-report.md` §10 — Final Accounting & Technical Review (Phase A).
- `docs/mission-43-report.md` — le présent rapport.

---

## 6. Tests réellement exécutés (2026-11-01)

| Vérification | Commande | Résultat |
| --- | --- | --- |
| Typecheck racine | `npm run typecheck` | **exit 0** |
| Suite API complète | `npm run test -w @mc/api` | **538 réussis / 11 ignorés** (38 fichiers + 1 ignoré) |
| Tests M43 ciblés | `npm run test -w @mc/api -- tests/mission43.test.ts` | **5/5** |
| Tests migrations M42.1/M43 | `npm run test -w @mc/api -- tests/mission43-migrations.test.ts` | **2/2** |
| Suites banque historiques | `tests/bank.test.ts` + `tests/bank-billing.test.ts` | **46/46** |
| Suite Web complète | `npm run test -w @mc/web` | **388/388** (59 fichiers) |
| Tests démo M43 | `npm run test -w @mc/web -- tests/mission43-demo.test.ts` | **3/3** |
| Build Web + API | `npm run build` | **exit 0** |
| Build démo | `npm run build:demo` | **exit 0** |
| Vérification démo | `node scripts/verify-demo.mjs --dist apps/web/dist --base /mauritius-compta/` | **50/50** |

**Limites** : PGlite et non PostgreSQL réel en local (`psql`/`docker` indisponibles) ; aucun navigateur réel ; aucun test de charge ; aucun test de concurrence multi-processus. Les jobs CI PostgreSQL, migrations, build démo doivent confirmer ces résultats après push. Aucun test n’a été ignoré pour masquer un échec et aucun montant attendu n’a été modifié.

---

## 7. Risques résiduels

1. **C-04 fournisseur** : non implémenté ; seul le lien vers un paiement fournisseur existant fonctionne. Ne pas présenter l’assistant comme couvrant les fournisseurs.
2. **Cohérence des périodes** : une période validée se rouvre automatiquement si le relevé ou le grand livre change. C’est volontaire, mais l’écran doit être relu après tout import.
3. **Écart accepté** : un écart peut être validé avec note et écart accepté égal à l’écart observé. Cela documente une décision humaine ; cela ne corrige pas l’écart et ne crée aucune écriture.
4. **Lignes comptables non rapprochées** : la validation est bloquée. Les utilisateurs doivent d’abord rapprocher ou traiter ces lignes ; aucun contournement n’a été ajouté.
5. **Devises** : la création d’un règlement depuis la banque exige un taux explicite si la devise diffère de la devise fonctionnelle. Aucun taux n’est inventé.
6. **Performance** : les rapports recalculent les soldes à chaque appel ; aucune mesure de charge n’a été faite. Les volumes de relevés restent bornés par les limites d’import existantes.
7. **PDF** : absent ; ne pas annoncer d’export PDF de période.
8. **Playwright** : absent ; les parcours visuels ne sont pas prouvés par un E2E.

---

## 8. Dépendances et suite

- **M42** : la PR nº23 doit être auditée puis fusionnée **avec autorisation** avant toute PR M43 vers `main`.
- **M44** : aucun fichier, aucune branche, aucune PR M44 n’a été consulté ou modifié. Aucune fusion automatique M42/M43 avec M44.
- **Post-M43 possible** : création d’un paiement fournisseur depuis un débit bancaire, export PDF de période, tests de charge/concurrence, E2E navigateur, validation experte du compte `1150` et des règles fiscales.
- **P0-03 reste ouvert** : aucune mise en production.

---

## 9. Recommandation avant fusion

**Recommandation : PR M43 en brouillon, ciblant la branche M42, après CI verte et revue humaine.** Les constats C-01 à C-04 sont corrigés pour le périmètre client et documentés sans masquer les limites (C-04 fournisseur partiel, pas de PDF, pas d’E2E). Aucune fusion, aucun déploiement, aucune modification du VPS, aucune donnée réelle, aucune écriture automatique n’a été effectuée.

La fusion de M42 puis de M43 reste subordonnée à l’autorisation explicite de l’utilisateur et à la validation par un expert-comptable mauricien des points `1150`, TVA et rapprochements.
