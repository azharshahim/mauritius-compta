# COMPTAI — plan d’implémentation M42 et M43

**Établi par la mission 41 — audit fonctionnel du 1er novembre 2026**
**Base :** `main` = `8fd9a2d58aec9147b7530fcb971b3511e5757e16`
**Statut :** plan de travail, **aucune implémentation M42/M43 réalisée pendant M41**
**Documents liés :** [audit général](./mission-41-accounting-functional-audit.md) · [achats/ventes](./comptai-purchases-sales-gap-analysis.md) · [banque](./comptai-banking-reconciliation-gap-analysis.md) · [OCR](./comptai-ocr-posting-gap-analysis.md)

> **Règle directrice.** M42 corrige le cycle achats-ventes et l’OCR ; M43 corrige la banque et le
> rapprochement. Aucune mission ne crée un second moteur comptable, ne modifie un montant ou une
> formule existante sans validation, et ne supprime un contrôle pour faire passer la CI. Toute
> comptabilisation reste soumise à une validation humaine explicite.

---

## 1. Principes non négociables

1. **Un seul moteur** : `prepareEntry`, `postEntryTx`, `postProposal`. Aucun `INSERT` direct dans
   `journal_entries` hors de ces services.
2. **Montants exacts** : `bigint` × 10⁴, jamais de flottant, jamais d’arrondi silencieux.
3. **Devises séparées** : aucune addition inter-devises ; une devise est toujours affichée avec son montant.
4. **Validation humaine** : l’OCR et les suggestions ne postent jamais seuls ; la validation et le
   postage restent deux actions distinctes.
5. **Immuabilité** : pas de suppression d’un document comptabilisé ; avoir, contrepassation ou
   désaffectation historisée.
6. **Traçabilité** : chaque décision écrit un événement métier et `audit_log`.
7. **Idempotence** : une source commerciale ne peut produire qu’une écriture ; les index uniques
   restent la dernière ligne de défense.
8. **Bilinguisme** : FR/EN sans texte codé en dur ; ne pas traduire les noms propres, références ou
   numéros de compte.
9. **Aucune donnée réelle** dans le dépôt, les tests, la démo publique ou les captures.

---

## 2. M42 — Achats, ventes, OCR et intégrité des sous-registres

### 2.1 Objectif de sortie

À la fin de M42, un comptable fictif doit pouvoir démontrer, sans double saisie :

1. une facture fournisseur **issue de l’OCR**, validée, payée, lettrée, âgée et rapprochée ;
2. un acompte fournisseur **réutilisé** sur une facture ultérieure ;
3. une facture client **comptabilisée depuis Facturation**, encaissée partiellement, avec un
   trop-perçu réaffecté ;
4. une balance âgée client **par devise** et **à une date passée** ;
5. un état de rapprochement **clients/fournisseurs ↔ grand livre**, avec écarts expliqués ;
6. un état de contrôle **TVA** (soldes de comptes), sans déclaration officielle inventée.

### 2.2 Lots de travail

| Lot | Constats | Livrable | Critère d’acceptation |
|---|---|---|---|
| **M42-L1 — Pont OCR → achat** | A-01, D-01, D-04 | Service de conversion document → `purchase_documents`; liens source ; statut comptable dérivé | OCR approuvé → une facture fournisseur validée, une seule fois, totaux/TVA identiques ; paiement et aging possibles |
| **M42-L2 — Avoirs fournisseurs** | A-02 | `credit_available` calculé dans la liste | Avoir 200 visible et affectable ; 0 après affectation totale |
| **M42-L3 — Acomptes et trop-perçus** | A-03, B-02 | Routes d’affectation ultérieure + propositions de reclassement | Acompte 10 000 sur facture 25 000 → solde 15 000 ; trop-perçu 500 → facture 500 → solde 0 ; contrôles de dépassement |
| **M42-L4 — Devises clients** | B-01 | `buildAging` et `customerBalance` par `(client, devise)` | Factures MUR/EUR → deux lignes, aucune addition |
| **M42-L5 — Historique à date** | A-05, B-04 | Aging reconstruit à partir des affectations datées | Paiement/avoir postérieur à `asOf` ignoré ; antérieur pris en compte |
| **M42-L6 — Rapprochement AR/AP ↔ GL** | A-04, B-05, E-02 | État de contrôle clients et fournisseurs | Écart nul sur jeu sain ; documents non comptabilisés explicitement listés |
| **M42-L7 — Parcours de comptabilisation** | A-08, B-03, B-06, E-03 | Boutons et panneaux dans Achats/Facturation + compteurs « en attente » | Facture/avoir/encaissement comptabilisables sans quitter le module ; second clic refusé |
| **M42-L8 — TVA** | E-01 | État de contrôle TVA par période et par compte de rôle | TVA collectée/déductible/nette = soldes GL ; aucune déclaration officielle produite |
| **M42-L9 — Immobilisations** | A-06 | Lien optionnel ligne d’achat → fiche d’immobilisation | Création confirmée, coût/date/fournisseur préremplis, pas de double création |
| **M42-L10 — OCR qualité** | D-02, D-03 | Alertes de rescannage, segmentation multi-factures | Rescannage détecté sans blocage ; PDF 2 factures → 2 propositions après confirmation |
| **M42-L11 — Position fournisseur** | A-07 | Position nette par devise | Avoirs/acomptes non appliqués visibles séparément, jamais fondus dans le dû |
| **M42-L12 — Documentation** | E-04 | Mise à jour/marquage historique des docs contredits | Aucune affirmation « Inventory absent » non datée |

### 2.3 Ordre d’exécution recommandé

1. **M42-L1** (pont OCR) et **M42-L2** (avoir) — impact démonstration immédiat.
2. **M42-L3** (acomptes/trop-perçus) — modèle d’affectation à stabiliser avant l’UI.
3. **M42-L4/L5** (devises et historique) — corrections de calcul, tests avant UI.
4. **M42-L6** (rapprochement AR/AP) — dépend des agrégats corrigés.
5. **M42-L7** (parcours) — UI après stabilisation API.
6. **M42-L8/L9** (TVA, immobilisations) — contrôles et ponts.
7. **M42-L10/L11/L12** — qualité, position nette, documentation.

### 2.4 Modèle de données à prévoir

- `document_imports.purchase_document_id` ou table de lien explicite `document_purchase_links`
  (source OCR → facture d’achat), avec unicité.
- Statut comptable dérivé : `posting_status` (`not_prepared`, `proposed`, `draft`, `posted`) ou
  calcul à la lecture, sans dupliquer l’état de `journal_entries`.
- Table d’affectation des acomptes : réutiliser `purchase_payment_allocations` avec une date
  d’affectation et un statut, ou une table `purchase_payment_reallocations` historisée.
- Table d’affectation des trop-perçus clients : équivalent de `billing_payment_allocations` avec date
  et historique de désaffectation.
- Lien immobilisation : `fixed_assets.purchase_document_line_id` nullable, index unique.
- Aucune colonne monétaire en `float`; `numeric(20,4)` et `bigint` existants conservés.

### 2.5 Contrôles comptables à ajouter

- **Avant affectation** : même tiers, même devise, document ouvert, montant > 0, dépassement refusé
  sous verrou, double affectation refusée.
- **Après affectation** : recalcul des agrégats, contrôle que le total affecté ≤ montant du règlement
  et ≤ reste dû de la facture, audit.
- **Comptabilisation d’une réaffectation** : écriture séparée, jamais de modification de l’écriture
  initiale ; source typée (`purchase_payment_allocation` / `billing_payment_allocation`) et
  idempotence.
- **Aging à date** : ignorer les affectations dont la date est postérieure à `asOf`; ne pas utiliser
  les agrégats courants.
- **Rapprochement AR/AP** : par compte collectif et devise ; documents non comptabilisés listés ;
  écart inexpliqué = échec du contrôle de clôture (après validation du cabinet).
- **TVA** : aucun taux, seuil ou formulaire officiel codé sans texte validé ; l’état se limite aux
  soldes de comptes et à la période.

### 2.6 Tests M42 à ajouter (non-régression à forte valeur)

| Test | Ce qu’il prouve |
|---|---|
| OCR → facture fournisseur → paiement → aging | Le pont complet existe et reste unique |
| Liste d’avoirs avec disponibilité | A-02 corrigé |
| Acompte affecté après coup | A-03 corrigé, contrôles de dépassement |
| Trop-perçu affecté après coup | B-02 corrigé |
| Aging MUR + EUR | B-01 corrigé, aucune addition |
| Aging au 30/09 avec paiement au 01/12 | A-05/B-04 corrigés |
| Rapprochement AP/AR avec document non comptabilisé | Écart expliqué, pas masqué |
| Facture de vente comptabilisée depuis l’UI | B-03 corrigé, idempotence |
| État TVA sur écritures postées | E-01, aucun taux inventé |
| Ligne d’immobilisation → fiche | A-06, pas de double création |

**Interdits de test** : ne pas remplacer un `expect` par un `console.log`, ne pas ignorer un test
existant, ne pas modifier un montant attendu pour faire passer la CI.

---

## 3. M43 — Banque, rapprochement, lettrage et intégration au grand livre

### 3.1 Objectif de sortie

À la fin de M43, un comptable fictif doit pouvoir démontrer :

1. l’import d’un relevé **sur une période** et la lecture des soldes d’ouverture/clôture ;
2. un rapport de rapprochement **juste sur une sous-période**, avec écart expliqué ;
3. le rapprochement partiel/multiple d’un relevé avec des règlements clients et fournisseurs ;
4. la création d’un règlement depuis une opération bancaire, avec affectation à une facture ;
5. la validation d’une **période de rapprochement** signée, réouverte si un élément change ;
6. la preuve que la banque et le grand livre concordent, ou que l’écart est documenté.

### 3.2 Lots de travail

| Lot | Constats | Livrable | Critère d’acceptation |
|---|---|---|---|
| **M43-L1 — Rapport par période** | C-01 | Solde d’ouverture + mouvements + solde de clôture | Sous-période rapprochée → écart nul ; les trois soldes affichés |
| **M43-L2 — Compteurs partiels** | C-02 | Compteurs matched/partial/unmatched/total | 1/1/1 cohérent dans UI et CSV |
| **M43-L3 — Clôture de période** | C-03 | Table et écran de validation de période | Période validée, hash du relevé, écart accepté documenté ; réouverture sur nouvel import |
| **M43-L4 — Règlement depuis la banque** | C-04 | Assistant création règlement + affectation | Transaction → règlement → facture soldée → lien unique |
| **M43-L5 — Banque ↔ GL** | C-01, C-02 | État de rapprochement bancaire complet | Comptes bancaires, soldes, éléments en suspens, écart expliqué |
| **M43-L6 — Lettrage** | A-03, B-02 | Intégration lettrage ↔ affectations | Les lignes lettrées correspondent aux règlements affectés ; pas de double lettrage |
| **M43-L7 — Audit et exports** | C-03 | Export CSV/PDF de la période validée | Historique reproductible, auteur/date, aucun montant recalculé |

### 3.3 Modèle de données à prévoir

- `bank_reconciliation_periods` : `company_id`, `bank_account_id`, `from`, `to`, `opening_bank`,
  `closing_bank`, `opening_ledger`, `closing_ledger`, `difference`, `accepted_difference`,
  `status` (`open`, `validated`, `reopened`), `statement_hash`, `validated_by`, `validated_at`,
  `note`.
- Lien vers les imports et transactions couverts ; aucun doublon de transaction.
- Aucune écriture comptable créée par la validation d’une période : elle atteste un rapprochement.
- Les ajustements éventuels (frais, intérêts) restent des propositions comptables séparées.

### 3.4 Contrôles à ajouter

- **Avant validation** : tous les éléments de la période sont matched/partially matched ou explicitement
  exclus ; écart justifié ; hash du relevé identique ; aucun import en échec.
- **Après validation** : nouvelle transaction dans la période → `reopened`; modification d’un match →
  `reopened`; conservation de l’historique.
- **Rapprochement banque ↔ GL** : solde d’ouverture comptable + mouvements = solde de clôture ;
  différence avec le relevé expliquée par les éléments en suspens.
- **Devise** : un compte bancaire en devise étrangère exige un taux explicite pour l’écriture ; aucune
  conversion inventée.
- **Sécurité** : `confirm:true` pour toute validation ; rôles `accountant` minimum pour les écritures.

### 3.5 Tests M43 à ajouter

| Test | Ce qu’il prouve |
|---|---|
| Rapport janvier–juin puis mars–juin | C-01 corrigé, ouverture prise en compte |
| Transaction partiellement rapprochée | C-02 corrigé |
| Validation de période + nouvel import | C-03 : réouverture, historique |
| Création de règlement depuis la banque | C-04 : pas de double paiement |
| Banque ↔ GL avec éléments en suspens | Écart expliqué, pas forcé à zéro |
| Lettrage après réaffectation | Cohérence lettrage/allocations |
| Export de période validée | Montants et statuts identiques à l’écran |

---

## 4. Dépendances et séquencement

```text
M42-L1/L2  →  M42-L3  →  M42-L4/L5  →  M42-L6  →  M42-L7
                                      ↘ M42-L8/L9
M42 (soldes et documents fiables)
        ↓
M43-L1/L2  →  M43-L3  →  M43-L4  →  M43-L5/L6/L7
```

- M43-L3 dépend de C-01/C-02 : on ne valide pas une période avec un rapport faux.
- M43-L4 dépend de B-02 (affectation) pour éviter un second modèle de paiement.
- M42-L1 doit être terminé avant toute démonstration OCR → paiement.
- Aucune migration destructive : uniquement des colonnes/tables additives, avec backfill explicite.

---

## 5. Portes de qualité et CI

- `npm run typecheck` : 0 erreur, sans désactivation de règle.
- Tests API ciblés puis suite complète avant fusion.
- Tests web ciblés puis suite complète avant fusion.
- Build production et build démo.
- `verify-demo` 50/50.
- Job PostgreSQL réel conservé.
- Aucun test ignoré ajouté ; aucun `skip` nouveau sans justification écrite.
- Revues de sécurité : P0-03 reste un bloqueur indépendant.
- Aucune fusion automatique, aucun déploiement OVH, aucune publication GitHub Pages.

---

## 6. Check-list préliminaire pour l’audit final après M43

> Cette check-list est **préparée**, pas exécutée. Elle servira au dossier de revue professionnelle.
> Elle ne remplace ni la campagne complète de régression, ni la revue indépendante.

| # | Volet | Contenu attendu | État M41 |
|---|---|---|---|
| 1 | **Statut de développement et revue professionnelle** | Périmètre, version, SHA, modules prêts/incomplets, nom et qualifications du comptable mauricien, dates | À préparer |
| 2 | **Guide de démonstration en anglais** | Parcours pas à pas, données fictives, résultats attendus, limites annoncées | À rédiger |
| 3 | **Fonctionnalités développées / incomplètes / prévues** | Tableau par module, statut et preuve | Base M41 disponible |
| 4 | **Limites connues et bloqueurs de production** | P0-03/04/05, P1 M41, limites navigateur, OCR, paie, e-invoicing | Base M41 disponible |
| 5 | **Scénarios de test comptables complets** | Achats, ventes, banque, TVA, immobilisations, clôture, cas d’erreur | À compléter après M43 |
| 6 | **Documents requis avant production** | Voir l’encadré ci-dessous | **À exiger avant toute revue** |
| 7 | **Questionnaire professionnel au comptable** | Plan comptable, TVA, formats, contrôles, seuils, attentes | À rédiger |
| 8 | **Demandes et recommandations du comptable** | Registre daté, propriétaire, décision, échéance | À préparer |
| 9 | **Formulaire de revue et de validation** | Périmètre, qualifications, résultats, réserves, date, signature | À préparer |
| 10 | **Check-list de préparation à la production** | Sauvegarde, sécurité, performance, exploitation, support, conformité | À préparer |

### 6.1 Documents requis avant production — encadré à rendre visible

> **Aucun document réel, aucune donnée client identifiable, aucune signature et aucun document
> confidentiel ne doivent être déposés dans le dépôt public ou la démo publique.** Le dossier de
> revue doit utiliser un dossier fictif ou anonymisé **irréversiblement**.

- [ ] Références comptables et fiscales mauriciennes **officielles**, datées et archivées.
- [ ] Plan comptable applicable au client, avec comptes collectifs et comptes de TVA.
- [ ] Dossier client **fictif ou anonymisé irréversiblement sur 12 mois**.
- [ ] Journaux, balance, grand livre et états financiers de la période.
- [ ] Relevés bancaires de la période, avec soldes d’ouverture et de clôture.
- [ ] Factures clients et fournisseurs, avoirs, notes de crédit.
- [ ] Justificatifs de paie et exemples fiscaux, si la paie est dans le périmètre.
- [ ] Politique de taux de change, de TVA, d’arrondis et de clôture validée par le cabinet.
- [ ] Attestation de confidentialité et de non-utilisation de données réelles.
- [ ] Décision écrite sur le périmètre : ce qui est démontré, ce qui est exclu, ce qui reste à valider.

### 6.2 Formulaire de revue — champs minimaux

- Identité et qualifications du réviseur, cabinet, date.
- Périmètre examiné et version/SHA.
- Documents et scénarios testés.
- Résultats, anomalies, réserves.
- Recommandations et décisions acceptées/refusées.
- Signature et mention explicite : **« revue professionnelle, non certification réglementaire,
  non autorisation de production »**.

---

## 7. Risques et décisions à obtenir avant de coder

| Risque | Décision nécessaire | Impact si absente |
|---|---|---|
| Pont OCR → facture d’achat | Faut-il créer automatiquement une facture ou exiger une action explicite ? | Risque de doublon ou de perte de contrôle |
| Réaffectation d’un acompte | Écriture de reclassement séparée ou simple mise à jour d’affectation ? | Risque d’écriture non auditée |
| TVA | État de contrôle seulement, ou déclaration ? | Ne pas inventer de formulaire MRA |
| Immobilisations | Création automatique ou confirmation humaine ? | Risque de fiche en double |
| Période de rapprochement | Bloquante à la clôture ou informative ? | Faux sentiment de sécurité |
| Devises | Taux historique, moyenne ou clôture ? | Ne pas convertir sans méthode validée |

**Décision par défaut recommandée** : action humaine explicite, aucun automatisme irréversible,
aucune règle fiscale inventée.

---

## 8. Definition of Done

### M42

- [ ] A-01, A-02, A-03, A-04, A-05 corrigés et testés.
- [ ] B-01, B-02, B-03, B-04, B-05 corrigés et testés.
- [ ] D-01 corrigé ; D-02/D-03/D-04 traités ou explicitement reportés.
- [ ] E-01 état TVA livré, sans déclaration officielle.
- [ ] E-02 rapprochement AR/AP livré.
- [ ] Typecheck, tests ciblés, suite API/web, build, build démo, `verify-demo`.
- [ ] Aucun P0 nouveau ; P0-03/04/05 toujours documentés.
- [ ] Documentation bilingue à jour, limites explicites.

### M43

- [ ] C-01, C-02, C-03, C-04 corrigés et testés.
- [ ] Rapprochement banque ↔ GL démontrable avec éléments en suspens.
- [ ] Période de rapprochement validable et réouvrable.
- [ ] Export de période reproductible.
- [ ] Typecheck, tests ciblés, suite API/web, build, build démo, `verify-demo`.
- [ ] Aucun contournement de contrôle, aucune donnée réelle.
- [ ] Check-list préliminaire des dix volets prête pour l’audit final.

---

## 9. Ce que ce plan ne fait pas

- Il ne corrige rien pendant M41.
- Il ne déclare pas COMPTAI conforme, certifié ou prêt pour la production.
- Il ne remplace pas la revue d’un comptable mauricien qualifié.
- Il ne remplace pas un test d’intrusion indépendant (P0-03).
- Il ne résout pas l’e-invoicing MRA (P0-04) ni la paie (P0-05).
- Il ne planifie aucun déploiement OVH, aucune publication GitHub Pages et aucune fusion automatique.
