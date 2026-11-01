# Mission 41 — audit fonctionnel comptable COMPTAI

**Date de l’audit :** 1er novembre 2026
**Base auditée :** `main` = `8fd9a2d58aec9147b7530fcb971b3511e5757e16` (PR nº21 / M40 fusionnée)
**Branche de travail :** `arena/6faf92bd-mauritius-compta`, sans modification fonctionnelle
**Nature :** audit en lecture seule, complété par des tests ciblés et deux sondes temporaires supprimées après exécution
**Périmètre :** achats, ventes, banque/rapprochement, OCR/comptabilisation automatique, intégrité transverse
**Hors périmètre :** implémentation M42/M43, refactorisation large, déploiement, données client réelles

> **Conclusion de lecture.** Les moteurs centraux sont sérieux : un seul moteur d’écriture, des montants
> décimaux exacts, des verrous de concurrence, une validation humaine explicite et une piste d’audit
> réelle. La démonstration comptable **de bout en bout n’est toutefois pas encore fiable sans réserve** :
> l’OCR s’arrête à une écriture brouillon et ne crée pas de facture d’achat ; les encaissements et
> acomptes non affectés ne peuvent pas être affectés plus tard ; la balance âgée client mélange les
> devises ; la comptabilisation des ventes n’est pas exposée dans le parcours Facturation ; le rapport
> bancaire peut produire un faux écart lorsqu’une période est sélectionnée.
>
> **Aucune validation par un comptable mauricien n’a été réalisée dans cette mission.** Une validation
> professionnelle future ne sera ni une certification réglementaire, ni une autorisation de production.

---

## 1. Synthèse exécutive

### 1.1 Ce qui fonctionne réellement

| Workflow | Statut | Preuve principale |
|---|---|---|
| Fournisseur → facture → validation → proposition → validation humaine → comptabilisation | **Implémenté** | `purchases/service.ts`, `purchases/proposals.ts`, `ai/proposals.ts` ; `tests/purchases.test.ts` (31 tests) |
| Avoirs fournisseurs et affectation à une facture | **Implémenté** | `purchase_credit_allocations`, verrous et contrôles de dépassement ; test « credit note without modifying the invoice » |
| Règlements partiels et regroupés | **Implémenté** | 30 000 sur 80 000, paiement de deux factures, refus du dépassement ; `tests/purchases.test.ts` |
| TVA récupérable / non récupérable explicite | **Implémenté** | `vat_recoverable` obligatoire dès qu’une ligne porte de la TVA ; `PURCHASE_VAT_RECOVERABILITY_REQUIRED` |
| Facturation client, avoirs, encaissements partiels, duplication déterministe | **Implémenté** | `billing/service.ts`, `billing/duplicates.ts`, `tests/billing.test.ts` (17 tests) |
| Comptabilisation ventes/achats par le moteur unique, anti-doublon | **Implémenté côté API** | `postProposal`, `postEntryTx`, `accounting_entry_id` et index uniques |
| Import bancaire CSV/TSV/XLSX/PDF, empreinte, doublons, contrôles de soldes | **Implémenté** | `bank/engine.ts`, `bank/profiles.ts`, `bank/mcb.ts`, `tests/bank.test.ts` (28 tests) |
| Rapprochement partiel et multiple banque ↔ règlements | **Implémenté** | `bank/billing.ts`, `tests/bank-billing.test.ts` (18 tests) |
| OCR PDF texte, PDF scanné et image, revue humaine, apprentissage supervisé | **Partiel** | `documents/extract.ts`, `documents/service.ts`, `tests/mission23.test.ts`, `tests/mission29.test.ts` |
| Grand livre, balance, bilan/compte de résultat à partir des écritures comptabilisées | **Implémenté** | `reports/service.ts`, `tests/reports.test.ts`, `tests/mission33-statements-currency.test.ts` |

### 1.2 Ce qui bloque une démonstration comptable convaincante

1. **OCR → achat incomplet** : un document OCR approuvé crée une écriture **brouillon** `source='manual'`
   et ne crée aucune `purchase_documents`. Il ne peut donc pas être payé, lettré, âgé ni rapproché
   dans le cycle Fournisseurs.
2. **Acomptes fournisseurs et trop-perçus clients non réaffectables** : ils sont enregistrés et
   comptabilisés, mais aucune route ne permet de les affecter ultérieurement à une facture.
3. **Balance âgée client multi-devises fausse** : une facture MUR et une facture EUR sont additionnées,
   avec une seule devise affichée. Une sonde l’a reproduit : le solde client affiche 1 100 en EUR
   (1 000 MUR + 100 EUR) et l’aging ajoute 100 EUR au total présenté en MUR.
4. **Comptabilisation des ventes invisible dans le parcours de facturation** : elle n’existe que dans
   l’écran Cabinet des propositions IA, sans bouton dans Facturation.
5. **Rapport bancaire sur période faux** : il compare le solde bancaire de clôture à la **seule
   variation comptable de la période**, sans solde d’ouverture comptable.
6. **Absence de contrôle de rapprochement sous-registre ↔ grand livre** : aucune preuve automatisée
   que le total des factures clients/fournisseurs égale le compte collectif.
7. **Affectation d’une ligne d’achat à une immobilisation non reliée au registre** : l’écriture peut
   débiter un compte d’immobilisation, mais aucune fiche d’immobilisation ni amortissement n’est créée.

### 1.3 P0 / P1 / P2

| Niveau | Nombre de constats M41 | Observation |
|---|---:|---|
| **P0 nouveaux** | **0** | Aucune erreur comptable silencieuse ni perte de données constatée dans les workflows audités. |
| **P1** | **14** | 13 constats distincts + le recoupement transverse E-02 (A-04/B-05) ; blocages de démonstration et états trompeurs. |
| **P2** | **11** | Finition, observabilité, contrôles secondaires et cohérence d’interface. |
| **P3** | **1** | Documentation historique à marquer comme telle. |

Les P0 existants du registre de préproduction restent ouverts et ne sont pas rouverts par cet audit :
**P0-03** (pas de revue de sécurité indépendante), **P0-04** (MRA e-Invoicing non intégré),
**P0-05** (paie non finalisable/non payable). Voir [`comptai-preproduction-gaps.md`](./comptai-preproduction-gaps.md).

---

## 2. Méthode, preuves et limites

### 2.1 Lectures de code

- Achats : `apps/api/sql/migrations/0011_purchases.sql`, `apps/api/src/modules/purchases/{service,proposals,routes}.ts`,
  `apps/api/src/modules/ai/proposals.ts`, `apps/api/src/lib/posting.ts`.
- Ventes : `apps/api/sql/migrations/0006_billing.sql`, `apps/api/src/modules/billing/{service,routes,duplicates,pdf}.ts`.
- Banque : `apps/api/src/modules/bank/{service,engine,reconcile,mcb,profiles,purchases,billing,reports,routes}.ts`,
  migrations `0009_bank.sql`, `0010_bank_billing.sql`, `0012_reconciliation_lettering.sql`, `0021_documents_charts_mcb.sql`.
- OCR : `apps/api/src/modules/documents/{service,extract,parse-invoice,routes}.ts`, migrations `0021`–`0023`,
  `apps/web/src/pages/documents/{ScanImport,BulkImport}.tsx`.
- États : `apps/api/src/modules/reports/{service,routes}.ts`.
- Interfaces : `apps/web/src/pages/accounting/Purchases.tsx`, `apps/web/src/pages/billing/*.tsx`,
  `apps/web/src/pages/accounting/{Bank,Lettering}.tsx`, `apps/web/src/pages/documents/ScanImport.tsx`.

### 2.2 Tests réellement exécutés

| Commande | Résultat |
|---|---|
| `npm run test -w @mc/api -- tests/purchases.test.ts tests/billing.test.ts tests/bank.test.ts tests/bank-billing.test.ts tests/lettering.test.ts tests/mission23.test.ts tests/mission29.test.ts tests/regressions.test.ts tests/money.test.ts` | **181 réussis, 1 ignoré** |
| `npm run test -w @mc/api -- tests/ai-proposals.test.ts tests/reports.test.ts tests/mission33-statements-currency.test.ts tests/fx.test.ts` | **68 réussis** |
| `npm run test -w @mc/web -- tests/purchases-ui.test.tsx tests/bank-ui.test.tsx tests/mission23-ui.test.tsx tests/mission28-ui.test.tsx tests/mission29-ui.test.tsx tests/demo-purchases.test.ts tests/demo-billing.test.ts tests/demo-bank.test.ts` | **61 réussis** |
| **Total des tests existants exécutés** | **310 réussis, 1 ignoré** |
| Deux sondes temporaires (`tmp-m41-probe*.test.ts`) | Exécutées, résultats consignés ci-dessous, **fichiers supprimés** ; aucun test laissé dans le dépôt |

### 2.3 Sondes de reproduction

**Sonde 1 — multi-devises client.** Facture de 1 000 MUR, facture de 100 EUR au taux 50, avoir de
200 MUR sur la facture MUR, puis `GET /billing/aging?asOf=2025-12-15` et
`GET /billing/customers/:id`.

```text
agingRows: une seule ligne, currency = MUR, invoiceCount = 2, total = 900.0000
customerBalance: currency = EUR, invoiced = 1100.0000, credited = 200.0000,
                 outstanding = 900.0000
```

**Sonde 2 — avoir fournisseur.** Facture de 1 000 MUR, avoir de 200 MUR, tous deux validés.

```text
GET /purchases/documents?kind=credit_note → credit_available = "0.0000"
GET /purchases/documents/:id              → credit_available = "200.0000"
```

### 2.4 Limites explicites

- **Aucun test navigateur réel, ni appareil physique** n’a été exécuté pendant M41. Les tests web sont
  des tests jsdom ; l’évidence M40 (382/382) est réutilisée sans être rejouée.
- **Aucun relevé bancaire réel** ni facture client réelle n’a été utilisé. Les formats MCB restent
  vérifiés sur des fixtures fictives.
- **Aucun test PostgreSQL réel** n’a été relancé dans M41 ; les tests ciblés ont tourné sur PGlite.
  Le job CI PostgreSQL de M40 reste l’évidence disponible.
- **Aucune revue par un comptable mauricien** n’a eu lieu.
- **P0-03 reste ouvert** : l’audit interne M35 ne remplace pas un test d’intrusion indépendant.
- La suite complète n’a pas été relancée : M41 est un audit ciblé, la campagne complète est prévue
  après M43.

---

## 3. Matrice de statut par workflow

Légende : **I** = implémenté ; **P** = partiellement implémenté ; **D** = démo seulement ;
**M** = manquant ; **NV** = non vérifié dans M41.

| Chaîne | Étape | Statut | Commentaire |
|---|---|---|---|
| Achats | Fournisseur | I | Doublons durs/alertes, isolation, compte auxiliaire |
| Achats | Facture/avoir | I | Numérotation, validation, immuabilité après comptabilisation |
| Achats | OCR → facture d’achat | **M** | L’OCR ne crée pas de `purchase_documents` |
| Achats | Suggestion de compte | P | Déterministe, pas d’IA, mais l’OCR utilise des heuristiques distinctes |
| Achats | Validation humaine | I | Propositions + validation explicite |
| Achats | Journal des achats → grand livre | I | Moteur unique, partie double contrôlée |
| Achats | Règlement | I | Partiel, groupé, devise verrouillée |
| Achats | Lettrage | P | Lettrage de lignes comptables séparé de l’affectation commerciale |
| Achats | Rapprochement bancaire | I | Règlement fournisseur ↔ débit bancaire, partiel/multiple |
| Achats | Solde fournisseur / en attente | P | Par devise, mais non historisé à une date passée |
| Ventes | Client | I | Doublons, archivage, compte auxiliaire |
| Ventes | Devis → facture → avoir | I | Conversion traçable, avoir lié à la facture |
| Ventes | Journal des ventes → grand livre | **P** | API prête, action absente de l’écran Facturation |
| Ventes | Encaissement partiel | I | Allocation multiple, trop-perçu stocké |
| Ventes | Réaffectation d’un trop-perçu | **M** | Aucune route d’affectation ultérieure |
| Ventes | Balance âgée / solde client | **P** | Mélange les devises, non historisé |
| Ventes | Rapprochement bancaire | I | Encaissement existant ↔ crédit bancaire |
| Banque | Import CSV/XLSX/PDF | I | Profils, soldes, doublons, OCR PDF |
| Banque | Écritures de banque | P | Proposition acceptée = écriture comptabilisée ; pas de brouillon intermédiaire |
| Banque | Rapprochement partiel/multiple | I | Plusieurs transactions ↔ plusieurs règlements |
| Banque | Éléments en suspens | I | Statuts et rapport détaillé |
| Banque | Écarts / historique | **P** | Rapport faux sur période ; compteurs partiels incomplets |
| OCR | PDF/JPG/PNG | I | Extraction texte + OCR réel testé |
| OCR | Suggestions comptables | P | Règles déterministes, comptes du plan réel |
| OCR | Comptabilisation | **P** | Écriture brouillon créée ; postage manuel dans Journaux, aucun postage depuis l’OCR |
| Intégrité | Balance, grand livre, états | I | Écritures postées uniquement, équilibre contrôlé |
| Intégrité | Sous-registres ↔ grand livre | **M** | Aucun état de rapprochement AR/AP |
| Intégrité | TVA | **P** | Comptes alimentés ; aucune déclaration TVA |
| Intégrité | Piste d’audit | P | Append-only, non chaînée cryptographiquement (P1-14 existant) |

### 3.5 Intégrité transverse

| Objet | Statut | Constat M41 |
|---|---|---|
| Écritures | **Implémenté** | Partie double, période ouverte, comptes actifs, idempotence de source, audit |
| Grand livre | **Implémenté** | Écritures `posted` uniquement, ouvertures et mouvements exacts |
| Balance | **Implémenté** | Balance équilibrée, comptes inactifs conservés |
| Comptes clients / fournisseurs | **Partiel** | Sous-registres corrects au jour le jour ; devises client, historique et réaffectation à corriger |
| Bilan / compte de résultat | **Implémenté avec limites** | Résultat non clôturé reporté depuis l’origine ; pas de flux de trésorerie ni de notes (P1-01 existant) |
| Soldes de TVA | **Partiel** | Comptes de TVA alimentés ; aucun état de contrôle ni déclaration (E-01) |
| Piste d’audit | **Partiel** | Append-only et complet ; non chaîné cryptographiquement (P1-14 existant) |
| Persistance | **Implémenté** | PostgreSQL/PGlite, migrations, stockage privé des pièces, sauvegarde M34 |
| Documents non comptabilisés | **Partiel** | Compteur côté achats ; absent côté ventes (E-03) |

---

## 4. Registre consolidé des constats

Les détails complets figurent dans les trois analyses spécialisées. Chaque constat suit la même
structure : module, workflow, statut, preuve, reproduction, attendu, réel, cause, sévérité, correction,
affectation.

| ID | Constat | Sévérité | Affectation |
|---|---|---|---|
| **A-01** | OCR achat → aucune facture fournisseur, seulement une écriture brouillon | **P1** | M42 |
| **A-02** | `credit_available` toujours nul dans la liste des avoirs fournisseurs | **P1** | M42 |
| **A-03** | Acompte fournisseur non affectable après enregistrement | **P1** | M42 |
| **A-04** | Aucun rapprochement sous-registre fournisseurs ↔ grand livre | **P1** | M42 |
| **A-05** | Balance âgée fournisseur non reconstruite à la date demandée | **P1** | M42 |
| **A-06** | Ligne d’immobilisation non reliée au registre des immobilisations | **P2** | M42 |
| **A-07** | Position fournisseur nette incomplète (acomptes/avoirs non appliqués) | **P2** | M42 |
| **A-08** | Comptabilisation achats accessible seulement via l’écran des propositions | **P2** | M42 |
| **B-01** | Balance âgée et solde client mélangent les devises | **P1** | M42 |
| **B-02** | Trop-perçu client non affectable après enregistrement | **P1** | M42 |
| **B-03** | Aucune action de comptabilisation dans le parcours Facturation | **P1** | M42 |
| **B-04** | Balance âgée client non reconstruite à la date demandée | **P1** | M42 |
| **B-05** | Aucun rapprochement sous-registre clients ↔ grand livre | **P1** | M42 |
| **B-06** | Tableau de bord ventes sans compteur « en attente de comptabilisation » | **P2** | M42 |
| **C-01** | Rapport bancaire sur période : solde de clôture contre variation seule | **P1** | M43 |
| **C-02** | Compteurs du rapport simple : transactions partiellement rapprochées omises | **P2** | M43 |
| **C-03** | Pas de validation de période de relevé (ouverture/clôture/écarts) | **P2** | M43 |
| **C-04** | Un encaissement bancaire ne peut pas être transformé en règlement client depuis la Banque | **P2** | M43 |
| **D-01** | Parcours OCR non opérationnel jusqu’à la comptabilisation | **P1** | M42 |
| **D-02** | Rescannage légèrement différent non détecté | **P2** | M42 |
| **D-03** | PDF multi-factures détecté mais non séparé | **P2** | M42 |
| **D-04** | Statut « APPROVED » pouvant être lu comme « comptabilisé » | **P2** | M42 |
| **E-01** | Aucune déclaration ou état de contrôle TVA | **P1** | M42 |
| **E-02** | Contrôle transverse AR/AP ↔ grand livre (même constat que A-04/B-05) | **P1** | M42 |
| **E-03** | Documents validés non comptabilisés non exposés côté ventes | **P2** | M42 |
| **E-04** | Documentation d’audit historique contredisant l’arbre courant | **P3** | M42 |

---

## 5. Constats P0/P1/P2 — lecture rapide

### 5.1 P0

**Aucun nouveau P0 M41.** Les P0 de production existants restent : P0-03, P0-04, P0-05.
Ne pas déduire de cet audit qu’une mise en production est autorisée.

### 5.2 P1 — à traiter avant la démonstration professionnelle

Les 14 constats P1 se regroupent en 9 chantiers de correction :

1. **A-01/D-01** : intégrer l’OCR au cycle achats, ou interdire explicitement la comptabilisation
   automatique d’un achat OCR sans création de facture fournisseur.
2. **A-02** : corriger la disponibilité des avoirs fournisseurs dans la liste.
3. **A-03/B-02** : permettre l’affectation ultérieure des acomptes/trop-perçus.
4. **A-04/B-05/E-02** : ajouter un état de rapprochement AR/AP ↔ grand livre.
5. **A-05/B-04** : reconstruire les balances âgées à la date demandée.
6. **B-01** : séparer les devises dans la balance âgée et le solde client.
7. **B-03** : exposer la comptabilisation dans Facturation.
8. **C-01** : corriger le rapport bancaire sur période.
9. **E-01** : produire un état de contrôle TVA (soldes de comptes), sans déclaration officielle inventée.

### 5.3 P2 — après les P1

Voir le registre consolidé. Les P2 ne doivent pas être présentés comme des blocages de production,
mais plusieurs sont nécessaires à une démonstration fluide (C-02, C-03, D-04, E-03).

---

## 6. Faux positifs écartés et points vérifiés sans anomalie

- **TVA récupérable** : la crainte initiale d’une TVA non qualifiée était infondée. Le code refuse
  explicitement une ligne taxée sans `vat_recoverable` (`PURCHASE_VAT_RECOVERABILITY_REQUIRED`) et
  refuse une ligne non taxée marquée récupérable.
- **Anti-doublon achats** : index unique normalisé sur fournisseur/référence/type hors annulés, plus
  avertissement montant/date. Un test dédié refuse la référence dupliquée.
- **Anti-doublon ventes** : les doublons « certain » bloquent sans `confirmDuplicate`; les autres
  sont des alertes. Le comportement est déterministe et testé.
- **Partie double** : `prepareEntry`/`postEntryTx` contrôlent l’équilibre, les comptes actifs, la
  période ouverte et l’idempotence de la source.
- **Rapprochement partiel** : les scénarios n→1, 1→n, plusieurs paiements sur une transaction et
  refus de sur-affectation sont couverts par `bank-billing.test.ts`.
- **Piste d’audit** : `purchase_events`, `bank_events`, `billing_document_events` et `audit_log`
  enregistrent les décisions humaines ; les annulations sont historisées, pas supprimées.
- **Isolation multi-société** : triggers et contrôles de société sur les tables d’achats, tests dédiés.
- **Conversion des états** : les états multi-devises ne sont pas convertis ; le risque d’affichage
  trompeur est déjà neutralisé par la mention de devise fonctionnelle (P2-13 existant).

---

## 7. Bloqueurs empêchant une démonstration au comptable

Par ordre d’impact :

1. **Montrer une facture fournisseur issue de l’OCR, puis son paiement et son lettrage** : impossible
   aujourd’hui sans double saisie manuelle.
2. **Montrer un acompte fournisseur ou un trop-perçu client réutilisé sur une facture ultérieure** :
   impossible, faute de route d’affectation.
3. **Montrer une balance âgée client en EUR et en MUR** : le résultat est faux.
4. **Montrer la comptabilisation d’une facture de vente depuis l’écran Facturation** : aucun bouton
   n’existe ; il faut passer par le Cabinet.
5. **Montrer un rapprochement bancaire sur un mois donné** : le rapport peut afficher un faux écart.
6. **Prouver que les sous-registres concordent avec le grand livre** : aucun état ne le prouve.
7. **Démontrer la conformité TVA ou e-invoicing MRA** : hors périmètre, à ne pas promettre.

---

## 8. Documentation existante à ne pas contredire

Les documents suivants restent valables et sont cités sans modification :

- [`purchases-audit.md`](./purchases-audit.md) — architecture du sous-registre achats.
- [`accounting-gaps-audit.md`](./accounting-gaps-audit.md) — audit M20 ; certaines lignes sont
  historiques (le stock a été implémenté en M22).
- [`bank-reconciliation.md`](./bank-reconciliation.md), [`advanced-reconciliation.md`](./advanced-reconciliation.md),
  [`bank-import.md`](./bank-import.md) — séparation import / comptabilisation / rapprochement.
- [`comptai-preproduction-gaps.md`](./comptai-preproduction-gaps.md) — P0-03, P0-04, P0-05, P1-11, P1-14.
- [`mission-40-report.md`](./mission-40-report.md) — évidence de régression M40.

**E-04** : `docs/accounting-gaps-audit.md` indique encore « Inventory — Absent » alors que M22 a livré
le stock. Le document doit être daté ou marqué historique. Aucune conclusion de M41 ne s’appuie sur
cette ligne obsolète.

---

## 9. Décision recommandée

1. **Ne pas présenter COMPTAI comme prêt pour la production.** P0-03, P0-04 et P0-05 restent ouverts.
2. **Ne pas présenter l’OCR comme une comptabilisation automatique complète.** Il est opérationnel
   jusqu’à la proposition et au brouillon, pas jusqu’à la facture fournisseur comptabilisée.
3. **Traiter les P1 A-01 à B-05 en M42**, puis C-01 et les contrôles bancaires en M43.
4. **Préparer la revue professionnelle avec des données fictives** et la checklist des dix volets
   décrite dans [`comptai-missions-42-43-implementation-plan.md`](./comptai-missions-42-43-implementation-plan.md).
5. **Conserver la mention** : une revue de comptable n’est ni une certification réglementaire ni une
   autorisation de production.
