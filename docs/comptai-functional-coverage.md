# COMPTAI — couverture fonctionnelle auditée

**Mission 32 — audit fonctionnel et préparation de la recette QuickBooks**
**Date de l'audit : 1er novembre 2026**
**Référentiel : `main` = `05a0f53807c79d66368f427b588ebca77c095589`, version 0.1.1**
**Nature : audit en lecture seule. Aucun code fonctionnel, taux, règle métier ou calcul de paie n'a été modifié.**

> Ce document inventorie ce qui existe réellement dans le dépôt. Il ne certifie ni conformité
> comptable, ni conformité fiscale, ni conformité MRA, ni aptitude à la production. Une
> fonctionnalité n'est jamais déclarée complète parce qu'un menu ou un écran existe.

**Documents liés :** [rapport d'audit](./mission-32-audit.md) · [matrice QuickBooks](./comptai-quickbooks-test-matrix.md) · [écarts avant production](./comptai-preproduction-gaps.md)

## 1. Statuts utilisés

| Code | Statut obligatoire | Signification opérationnelle |
|---|---|---|
| **IT** | Implémentée et testée | Le chemin principal existe (API, persistance, interface lorsqu'elle est requise) et au moins un test exécuté couvre le comportement décrit. Cela ne vaut pas validation par un expert. |
| **IPT** | Implémentée mais partiellement testée | Le code et souvent l'écran existent, mais les tests ne couvrent qu'une partie des formats, des rôles, des cas limites ou du parcours complet. |
| **PI** | Partiellement implémentée | Une partie du cycle manque : export, conversion, classement, interface, rapprochement de contrôle ou automatisation promise. |
| **SIM** | Simulation uniquement | Le calcul ou l'écran est exécutable mais son résultat est explicitement simulé, non validé ou volontairement bloqué avant usage réel. |
| **ABS** | Absente | Aucun service, route, écran ou test opérationnel n'a été trouvé. Une écriture manuelle peut parfois contourner le besoin, sans les contrôles attendus. |
| **BLQ** | Bloquée par une validation réglementaire | La construction ou l'usage est empêché par une règle, un enregistrement, un format officiel ou une validation professionnelle non disponible. |

**Niveau de preuve** : `API` = route et test API exécuté ; `UI` = écran React présent ; `démo` = moteur de démonstration testé ; `doc` = documentation seulement. Un statut IT n'exige pas les quatre niveaux.

## 2. Synthèse

| Domaine | Fonctionnalités inventoriées | IT | IPT | PI | SIM | ABS | BLQ |
|---|---:|---:|---:|---:|---:|---:|---:|
| A. Comptabilité générale | 31 | 23 | 2 | 3 | 1 | 2 | 0 |
| B. Immobilisations et stocks | 19 | 14 | 2 | 0 | 0 | 3 | 0 |
| C. Facturation | 21 | 16 | 1 | 0 | 0 | 3 | 1 |
| D. Banque et OCR | 20 | 12 | 3 | 1 | 1 | 3 | 0 |
| E. Fiscalité mauricienne | 12 | 4 | 0 | 1 | 0 | 6 | 1 |
| F. Paie et RH | 20 | 12 | 1 | 0 | 3 | 2 | 2 |
| G. États financiers | 10 | 1 | 1 | 4 | 0 | 4 | 0 |
| H. Gestion du cabinet | 18 | 9 | 0 | 2 | 0 | 7 | 0 |
| **Total** | **151** | **91** | **10** | **11** | **5** | **30** | **4** |

Les comptes ci-dessus sont recalculés sur les tableaux détaillés. Ils mesurent la **couverture
fonctionnelle documentée**, pas la qualité métier ni la conformité.

## 3. A. Comptabilité générale

| ID | Fonctionnalité | Statut | Preuves techniques | Limite / commentaire |
|---|---|---|---|---|
| A01 | Multi-société et isolation des dossiers | IT | `apps/api/src/lib/tenant.ts`, triggers SQL, `apps/api/tests/companies.test.ts`, `cabinet.test.ts` | Les tests couvrent plusieurs modules, pas chaque route une par une. |
| A02 | Paramètres société : BRN, TVA, adresse, activité, norme, devise | IT | `apps/api/src/modules/companies/routes.ts`, `companies.test.ts` (6 cas) | Aucun identifiant réel n'est fourni ; les champs restent facultatifs. |
| A03 | Devise fonctionnelle et verrouillage après écriture | IT | `companies/settings.ts`, `0013_multi_currency.sql`, `fx.test.ts` | Le verrou est contrôlé par l'API et par trigger. |
| A04 | Devise de présentation avec conversion des états | PI | `reports/routes.ts` (l. 179), `reports/service.ts`, `reports/pdf.ts` (l. 75) | **Anomalie confirmée** : aucun taux de conversion n'est appliqué ; les montants fonctionnels sont seulement étiquetés dans la devise de présentation. Voir P0-01. |
| A05 | Plan comptable personnalisable, hiérarchique, avec rôles et mapping d'états | IT | `accounts/routes.ts`, `accounts/chart.ts`, `accounts.test.ts` (4 cas), `reports.test.ts` | Le plan « mauricien » livré reste provisoire et non officiel. |
| A06 | Libellés de comptes bilingues FR/EN | IT | `accounts/chart.ts`, `mission23.test.ts`, `apps/web/tests/i18n-quality.test.ts` | Le code comptable ne change pas lors d'une traduction. |
| A07 | Modèle de plan comptable provisoire | IT | `accounts/chart.ts`, `mission23.test.ts` | Statut `PENDING PROFESSIONAL VALIDATION` explicite. |
| A08 | Import du plan comptable du cabinet (CSV/XLSX) avec aperçu, hash et confirmation | IPT | `accounts/chart.ts`, `apps/web/src/pages/Accounts.tsx`, `mission23.test.ts` | Le CSV est testé ; le XLSX est annoncé et parsé par le même lecteur mais n'a pas de cas dédié. La confirmation finale n'est pas couverte par un test de bout en bout. |
| A09 | Journaux configurables (ventes, achats, banque, caisse, OD) | IPT | `journals/routes.ts`, `provisioning.ts`, `entries.test.ts` | Les cinq journaux par défaut sont utilisés partout ; la création d'un journal personnalisé n'a pas de test dédié. |
| A10 | Écritures multi-lignes, brouillon puis validée | IT | `entries/routes.ts`, `entries.test.ts` (12 cas), `regressions.test.ts` | Le moteur est un moteur unique réutilisé par les modules. |
| A11 | Numérotation atomique et renumérotation d'un brouillon | IT | `entries/service.ts`, `entries.test.ts`, `concurrency.test.ts` (ignoré sans PostgreSQL réel) | La concurrence est prouvée en CI PostgreSQL, pas dans cette exécution locale. |
| A12 | Contrôles d'équilibre, montants nuls, comptes inactifs, période, société | IT | `entries/service.ts`, `entries.test.ts`, `regressions.test.ts` | Aucun test ne couvre toutes les combinaisons de champs facultatifs. |
| A13 | Verrouillage des écritures validées, API et PostgreSQL | IT | `entries/service.ts`, triggers `0003_hardening.sql`, `regressions.test.ts` | L'immutabilité est technique, pas une piste d'audit signée. |
| A14 | Contrepassation unique, datée et motivée | IT | `entries/routes.ts`, `entries.test.ts`, `concurrency.test.ts` | La contrepassation crée une écriture inverse, elle ne modifie pas l'originale. |
| A15 | Justificatifs PDF/JPEG/PNG avec vérification de signature et SHA-256 | IT | `regressions.test.ts` (signature réelle, hash), `attachments` | L'upload temporaire n'a pas de test d'intégration disque complet. |
| A16 | Références uniques par société | IT | contraintes SQL, `entries.test.ts`, `regressions.test.ts` | — |
| A17 | Grand livre, balance et exports CSV/PDF | IT | `reports/service.ts`, `reports/routes.ts`, `reports.test.ts` (10 cas) | Le grand livre n'est pas paginé au-delà de plusieurs milliers de lignes. |
| A18 | Bilan et compte de résultat provisoires | PI | `reports/service.ts` (`computeStatements`), `Statements.tsx`, `reports.test.ts` | Le bilan s'équilibre, mais les sous-totaux courant/non courant et coût des ventes ne sont pas présentés ; il n'existe ni notes ni comparatif N-1. Voir G01-G02. |
| A19 | Sous-registre clients, historique et solde | IT | `billing/routes.ts`, `billing.test.ts` (17 cas), `Aging.tsx` | Le solde est par client et devise, jamais additionné entre devises. |
| A20 | Sous-registre fournisseurs, historique, balance et échéancier | IT | `purchases/routes.ts`, `purchases.test.ts` (31 cas) | Le sous-registre est indépendant du grand livre ; le rapprochement de contrôle n'est pas automatique. |
| A21 | Rapprochement automatisé comptes auxiliaires ↔ grand livre | PI | `lettering/report`, `billing/aging`, `purchases/aging` | Des balances auxiliaires existent, mais aucun contrôle signé ne compare le total clients/fournisseurs au compte collectif du grand livre. |
| A22 | Lettrage partiel, multiple, N↔1, suggestions et délettrage | IT | `lettering/routes.ts`, `lettering.test.ts` (29 passés, 1 ignoré) | Le test de concurrence est ignoré sans PostgreSQL réel. |
| A23 | Charges à payer, produits à recevoir, charges/produits constatés d'avance | IT | `accruals/routes.ts`, `mission22.test.ts` (13 cas) | Allocation mensuelle à montant égal ; pas de prorata journalier. |
| A24 | Provisions (reconnaissance, révision, utilisation, reprise) | IT | `provisions/routes.ts`, `mission22.test.ts` | Aucun seuil IAS 37, aucune actualisation, aucune conformité affirmée. |
| A25 | Ajustements d'exercices antérieurs et retraitement | IT | `financial-years/routes.ts`, `financial-years.test.ts` (5 cas) | Les écritures d'origine restent conservées ; la période source reste clôturée. |
| A26 | Capitaux propres, clôture annuelle et affectation du résultat | IT | `equity/routes.ts`, `equity.test.ts` (7 cas) | Les modèles légaux de répartition (dividende, impôt) restent à valider. |
| A27 | Soldes d'ouverture, continuité et clôture/réouverture de périodes | IT | `financial-years/opening.ts`, `settings/routes.ts`, `financial-years.test.ts`, `entries.test.ts` | La réouverture est contrôlée, mais l'historique de clôture n'est pas signé électroniquement. |
| A28 | Multidevises : taux datés, factures, règlements et écarts réalisés | IT | `fx/routes.ts`, `fx/service.ts`, `fx.test.ts` (35 cas), `multi-currency.md` | Aucun taux officiel ni fournisseur externe ; toute conversion exige une saisie humaine. |
| A29 | Réévaluation latente et virements inter-devises | SIM | `fx/service.ts`, `fx/routes.ts`, `fx.test.ts` | Comptabilisation volontairement bloquée (`postingBlocked: true`). |
| A30 | Comptes d'attente, emprunts et comptes courants d'associés | ABS | Aucune table ni route dédiée ; `docs/accounting-gaps-audit.md` | Contournement possible par écriture manuelle, sans subledger ni contrôle d'encours. |
| A31 | Consolidation et éliminations intra-groupe | ABS | Aucune route ni table de groupe ; `mission-20-report.md`, `roadmap.md` | L'isolation multi-société n'est pas une consolidation. |

## 4. B. Immobilisations et stocks

| ID | Fonctionnalité | Statut | Preuves techniques | Limite / commentaire |
|---|---|---|---|---|
| B01 | Registre des immobilisations et catégories configurables | IT | `fixed-assets/service.ts`, `fixed-assets.test.ts` (9 cas), `FixedAssets.tsx` | Aucun compte, taux ou durée mauricienne n'est imposé. |
| B02 | Acquisition, mise en service et propositions d'écritures | IT | `fixed-assets/accounting.ts`, `fixed-assets.test.ts` | Approbation humaine puis comptabilisation distincte. |
| B03 | Amortissement linéaire et dégressif, prorata, valeur résiduelle, révision, suspension | IT | `fixed-assets/depreciation.ts`, `fixed-assets-depreciation.test.ts` (8 cas) | Conventions de calcul paramétrables, non certifiées IFRS. |
| B04 | Lots de dotation : aperçu, approbation, comptabilisation | IT | `fixed-assets/accounting.ts`, `fixed-assets.test.ts` | Une période close bloque la comptabilisation. |
| B05 | Dépréciation et reprise justifiées | IT | `fixed-assets/accounting.ts`, `fixed-assets.test.ts` | Ce n'est pas une provision IAS 37. |
| B06 | Cession, mise au rebut et plus/moins-value | IT | `fixed-assets/accounting.ts`, `fixed-assets.test.ts` | La cession est proposée puis approuvée ; aucune suppression physique. |
| B07 | Reclassification et transfert entre catégories | IPT | schéma de proposition `reclassification`, `fixed-assets/routes.ts` | Type présent dans le schéma, mais pas de test dédié au cycle complet. |
| B08 | Sept états immobilisations, CSV et PDF | IT | `fixed-assets/reports.ts`, `fixed-assets/routes.ts`, `fixed-assets.test.ts` | Les PDF portent le bandeau de démonstration. |
| B09 | Rapprochement immobilisations ↔ grand livre | IT | `fixed-assets/reports.ts`, `fixed-assets.test.ts` | Rapprochement agrégé, pas une certification d'audit. |
| B10 | Amortissement fiscal et capital allowances | ABS | `mission-20-report.md`, `0018_fixed_assets.sql`, `i18n.tsx` (`fa.calculationNote`) | Aucun taux, pool ni calcul fiscal ; le module le déclare explicitement. |
| B11 | Composants multiples et réévaluation | ABS | `mission-20-report.md` (limites de périmètre) | Modèle du coût uniquement. |
| B12 | Articles, catégories et emplacements de stock | IT | `inventory/routes.ts`, `mission22.test.ts`, `Inventory.tsx` | Aucun suivi par numéro de série. |
| B13 | Valorisation FIFO et coût moyen pondéré | IT | `inventory/*`, `mission22.test.ts` | Lot FIFO interne, pas un registre de traçabilité réglementaire. |
| B14 | Mouvements, transferts et stock d'ouverture | IT | `inventory/routes.ts`, `mission22.test.ts` | Refus du stock négatif sauf politique explicite. |
| B15 | Inventaire physique et dépréciation/reprise | IT | `inventory/counts`, `inventory/write-downs`, `mission22.test.ts` | Les ajustements restent proposés avant comptabilisation. |
| B16 | État de valorisation à date et export CSV | IT | `inventory/report`, `inventory/report.csv`, `mission22.test.ts` | Impression navigateur pour le PDF, pas de PDF serveur. |
| B17 | Rapprochement stock ↔ grand livre | IT | `inventory/reconciliation`, `mission22.test.ts` | Rapprochement agrégé par compte de stock. |
| B18 | Pont achats/facturation vers mouvements de stock et coût des ventes | IPT | `inventory/from-purchase`, `inventory/from-billing`, `mission22.test.ts` | API testée, mais pas de bouton dédié dans l'écran ; mapping ligne ↔ article manuel. |
| B19 | Coûts accessoires, réceptions partielles, bons de commande et lots/séries | ABS | `mission-22-report.md` (limites) | Pas de landed cost, de réception partielle automatisée ni de péremption. |

## 5. C. Facturation

| ID | Fonctionnalité | Statut | Preuves techniques | Limite / commentaire |
|---|---|---|---|---|
| C01 | Clients, archivage et détection de doublons | IT | `billing/routes.ts`, `billing.test.ts` (17 cas) | Un homonyme légitime exige une confirmation explicite. |
| C02 | Articles, prix, unités, comptes de produits et traitements de TVA | IT | `billing/routes.ts`, `billing.test.ts`, `Documents.tsx` | Aucun taux de TVA n'est seedé. |
| C03 | Devis et conversion unique en facture | IT | `billing/routes.ts`, `billing.test.ts` | La conversion est tracée par `source_document_id`. |
| C04 | Factures directes ou depuis devis, brouillon et verrouillage à l'émission | IT | `billing/routes.ts`, `billing.test.ts` | Un brouillon est modifiable ; une facture émise est verrouillée. |
| C05 | Numérotation séquentielle atomique par société et année | IT | `billing/service.ts`, `billing.test.ts` | Test de concurrence inclus dans la suite billing. |
| C06 | Avoirs partiels/totaux liés à une facture | IT | `billing/routes.ts`, `billing.test.ts` | Contrôle du restant créditable et des quantités. |
| C07 | Paiements partiels, complets, multi-factures et trop-perçus | IT | `billing/routes.ts`, `billing.test.ts` | Aucune double affectation ; devise et taux explicites. |
| C08 | Annulation d'un paiement non comptabilisé | IT | `billing/routes.ts`, `billing.test.ts` | Refus si le paiement est lié à un rapprochement bancaire confirmé. |
| C09 | Balance âgée clients et liste des retards | IT | `billing/aging`, `billing/overdue`, `Aging.tsx`, `billing.test.ts` | Affichage et JSON uniquement ; pas d'export fichier. |
| C10 | PDF serveur facture, avoir et reçu | IT | `billing/pdf.ts`, `billing.test.ts` | Le PDF porte une mention de démonstration et n'est pas une facture électronique MRA. |
| C11 | Taux de TVA datés, sourcés, vérifiés et historisés | IT | `billing/routes.ts` (création, `verify`, `unverify`, `history`), `billing.test.ts` | La « vérification » est une confirmation admin avec source libre, pas l'identité d'un expert qualifié. Voir P1-05. |
| C12 | Calcul de TVA et quatre traitements distincts | IT | `billing/service.ts` (`prepareTax`, `computeDocument`), `billing.test.ts` | Aucun taux par défaut ; `standard` exige un taux vérifié et applicable. |
| C13 | Factures et règlements en devise avec taux documenté | IT | `billing/service.ts`, `fx.test.ts`, `billing.test.ts` | Aucune conversion implicite ; le taux est fourni par l'utilisateur. |
| C14 | Transfert vers la comptabilité | IPT | `ai/entry-proposals/from-billing`, `ai-proposals.test.ts`, `billing.test.ts` | Ce n'est pas un transfert automatique : proposition, validation humaine, puis comptabilisation distincte. |
| C15 | Protection contre la double comptabilisation | IT | index uniques, `ai-proposals.test.ts` (16 cas), `billing.test.ts` | Tests de concurrence réels dépendants de PostgreSQL. |
| C16 | Détection déterministe des doublons de facture | IT | `billing/duplicates.ts`, `billing.test.ts`, `duplicates/check` | Empreinte normative ; pas de détection floue ou IA. |
| C17 | Historique d'événements, acceptation et refus d'un devis | IT | `billing/documents/:id/events`, `accept`, `refuse`, `billing.test.ts` | L'acceptation/refus est un état commercial, pas une signature électronique. |
| C18 | Export de la balance âgée clients (CSV/PDF) | ABS | `billing/aging` renvoie JSON ; `Aging.tsx` n'appelle aucun export | L'échéancier fournisseur possède un CSV, pas le client. |
| C19 | Relances, factures récurrentes et recouvrement | ABS | Aucune route ni écran | Les tâches cabinet peuvent être créées manuellement. |
| C20 | Déclaration de TVA générée depuis la facturation | ABS | Aucune route `vat-return` ; `billing` ne produit que des taux et des documents | Le grand livre permet une préparation manuelle hors application. |
| C21 | MRA e-Invoicing : transmission, IRN, QR, statuts | BLQ | `apps/web/src/pages/billing/MraEInvoicing.tsx` (écran informatif, aucun import de `api`), `billing/routes.ts` (`eInvoicingNotice`) | Écran informatif seulement : aucune connexion, aucun identifiant, aucune transmission. Enregistrement éditeur et spécifications à obtenir. |

## 6. D. Banque et OCR

| ID | Fonctionnalité | Statut | Preuves techniques | Limite / commentaire |
|---|---|---|---|---|
| D01 | Comptes bancaires reliés à un compte du plan comptable | IT | `bank/routes.ts`, `bank.test.ts` (28 cas) | Référence de compte masquée ; aucun identifiant bancaire réel n'est versionné. |
| D02 | Import CSV, TSV/TXT et XLSX | IT | `bank/routes.ts`, `bank.test.ts` (CSV, XLSX, TSV), `profiles.ts` | XLSX réel testé ; pas de macros. |
| D03 | Aperçu sans écriture et confirmation humaine | IT | `bank/preview`, `bank/imports`, `bank.test.ts` | Aucun `journal_entry` n'est créé par l'import. |
| D04 | Anti-doublon fichier et ligne | IT | hash de fichier, `fingerprint`, `bank.test.ts` | L'empreinte exacte ne détecte pas un rescannage légèrement différent. |
| D05 | Contrôle des soldes, dates, devises et colonnes | IT | `bank/service.ts` (`parseAndPreview`), `bank.test.ts` | Une incohérence est signalée, jamais corrigée silencieusement. |
| D06 | Relevé PDF MCB dédié | IPT | `bank/mcb.ts`, `bank/mcb/preview\|import`, `mission23.test.ts` | Uniquement la mise en page Savings Regular Account synthétique ; aucun relevé MCB réel testé. |
| D07 | Relevé PDF bancaire générique prudent | IPT | `bank/pdf/preview\|import`, `mission23.test.ts`, `mission29.test.ts` | Refus si les colonnes ou soldes sont ambigus ; aucune banque mauricienne certifiée. |
| D08 | OCR d'un relevé PDF scanné | IPT | `documents/extract.ts` (Tesseract réel), `pdfPreviewOf` | Le texte PDF est testé ; l'OCR d'un tableau bancaire dégradé n'est pas calibré. |
| D09 | OFX/QFX et connexion bancaire directe | ABS | `bank/profiles` (`ofx: false`, `directBankConnection: false`) | Déclaré non implémenté dans l'API et l'écran. |
| D10 | Propositions d'imputation déterministes | IT | `bank/engine.ts`, `bank/reconcile.ts`, `bank.test.ts` | Suggestions explicables, jamais auto-validées. |
| D11 | Suggestions par fournisseur IA | SIM | adaptateur `simulated`, `bank-ai-suggestions.md` | Aucun fournisseur externe activé par défaut ; aucune clé. |
| D12 | Validation humaine : accepter, rejeter, exclure | IT | `bank/proposals/*`, `bank.test.ts`, `bank-billing.test.ts` | Une proposition acceptée reste un brouillon jusqu'à l'action suivante. |
| D13 | Rapprochement simple, partiel, N↔1 et 1↔n | IT | `bank/reconcile.ts`, `bank-billing.test.ts` (18 cas) | Les cas ambigus restent en revue humaine. |
| D14 | Rapport de rapprochement CSV | IT | `bank/reconciliation-report.csv`, `bank.test.ts`, `bank-billing.test.ts` | Pas de PDF serveur de rapprochement. |
| D15 | Extraction de factures PDF texte et OCR image/PDF scanné | IT | `documents/extract.ts`, `mission23.test.ts`, `mission29.test.ts` | Moteur réel, mais corpus synthétique uniquement. |
| D16 | Confiance par champ, champs incertains et ré-extraction auditée | IT | `mission29.test.ts`, `documents/reextract` | Pas de calibration statistique sur des corrections humaines. |
| D17 | PDF contenant plusieurs factures | PI | `mission-29-report.md` (détection sans séparation) | La vérification humaine doit bloquer le document. |
| D18 | Création automatique de tiers depuis un document | ABS | `mission-23-report.md` (correspondances proposées, fiche à créer) | Aucune création automatique. |
| D19 | Apprentissage de règles après approbation | IT | `mission23.test.ts` (règles, refus sans apprentissage) | Règles déterministes, pas d'apprentissage statistique. |
| D20 | Validation sur corpus réel anonymisé et calibration OCR | ABS | `mission-29-report.md` (fixtures synthétiques) | Preuve de production absente : 0 facture ou relevé réel traité. |

## 7. E. Fiscalité mauricienne

| ID | Fonctionnalité | Statut | Preuves techniques | Limite / commentaire |
|---|---|---|---|---|
| E01 | Taux de TVA datés, sourcés et vérifiés | IT | `billing/routes.ts`, `billing/service.ts`, `billing.test.ts` | Aucun taux n'est prérempli ; un taux standard non vérifié bloque l'émission. |
| E02 | Calcul de TVA sur ventes et achats | IT | `billing/service.ts`, `purchases/service.ts`, `billing.test.ts`, `purchases.test.ts` | Les règles d'exigibilité et de déclaration ne sont pas codées. |
| E03 | Traitements TVA standard, zéro, exonéré et hors champ | IT | `billing/service.ts`, `purchases/routes.ts`, tests billing/purchases | La qualification légale reste à confirmer par le cabinet. |
| E04 | Rapprochement TVA collectée/déductible et déclaration | ABS | Aucune route de déclaration ; seuls des comptes de TVA configurables existent | Aucun état de contrôle TVA, aucune TVA due/remboursable calculée. |
| E05 | Export TVA et télédéclaration MRA | ABS | Aucun format, aucune route | Aucune conformité MRA n'est revendiquée. |
| E06 | Impôt sur les sociétés : calcul, acomptes, déclaration | ABS | `docs/mauritius-regulations/corporate-tax.md` : toutes les règles `À VÉRIFIER` | Le compte 7000 n'est qu'un libellé de plan de démonstration. |
| E07 | Régimes préférentiels, exonérations, TDS et retenues | ABS | `docs/mauritius-regulations/corporate-tax.md`, `docs/regulatory-review-register.md` | Aucun taux, seuil ni condition d'éligibilité n'est codé. |
| E08 | MRA e-Invoicing : intégration EBS/IFP | BLQ | `MraEInvoicing.tsx`, `mra-e-invoicing-roadmap.md` | Écran informatif ; enregistrement éditeur, spécifications et auto-certification non acquis. |
| E09 | Enregistrement EBS, IRN, QR et API MRA | ABS | `mra-e-invoicing-roadmap.md` (hypothèses non implémentées) | Aucun appel réseau, aucun certificat, aucun identifiant. |
| E10 | Calendrier fiscal et échéances réglementaires | ABS | Tâches cabinet génériques seulement | Aucun calendrier TVA/CIT/PAYE paramétré par texte officiel. |
| E11 | Registre des sources et statuts de vérification | PI | `docs/regulatory-sources-register.md`, `docs/mauritius-regulations/*` | Documentation riche mais de nombreux points restent `À VÉRIFIER` ; ce n'est pas une validation officielle. |
| E12 | Garde-fous fiscaux : aucun taux par défaut, aucune conformité affirmée | IT | `billing/service.ts` (`VAT_NOT_CONFIGURED`, `VAT_RATE_NOT_VERIFIED`), textes d'écran | Le produit refuse d'inventer un taux ; il ne remplace pas une validation professionnelle. |

## 8. F. Paie et RH

| ID | Fonctionnalité | Statut | Preuves techniques | Limite / commentaire |
|---|---|---|---|---|
| F01 | Dossiers salariés et masquage des coordonnées bancaires | IT | `payroll/service.ts`, `payroll.test.ts` (48 cas), `demo-payroll.test.ts` | Aucune donnée réelle ; les comptes de démonstration sont masqués. |
| F02 | Contrats datés, avenants, historique et rupture | IT | `payroll/service.ts`, `payroll.test.ts` | La rupture ne produit ni solde de tout compte ni paiement. |
| F03 | Temps de travail, jours fériés et imports CSV/XLSX | IT | `payroll/routes.ts`, `payroll.test.ts` | Imports idempotents ; pas de pointage biométrique. |
| F04 | Congés, absences, décisions, soldes et règles | IT | `payroll/routes.ts`, `payroll.test.ts` | Les règles de congés sont configurées, pas certifiées par un expert. |
| F05 | Rubriques de paie, affectations et variables | IT | `payroll/service.ts`, `payroll.test.ts` | Le traitement fiscal d'une rubrique reste `UNVERIFIED`. |
| F06 | Périodes et calculs de paie | IT | `payroll/routes.ts`, `payroll.test.ts` | Un second calcul exige une réouverture contrôlée. |
| F07 | PAYE cumulatif 2026/27 | IT | `payroll/statutory.ts`, `payroll-statutory.test.ts` (22 cas), `payroll-2026-27.test.ts` (4 cas) | Règles datées et sourcées, mais **non validées par un expert**. |
| F08 | EDF | IT | `payroll/statutory.ts`, `payroll-statutory.test.ts` | Les employés sans EDF restent bloqués. |
| F09 | CSG, NSF et Training Levy | IT | `payroll/statutory.ts`, `payroll-statutory.test.ts` | Le secteur public et certaines catégories restent bloqués. |
| F10 | Additional Remuneration 2026 | IT | `payroll/statutory.ts`, `payroll-statutory.test.ts` | Le bonus de fin d'année reste une simulation distincte. |
| F11 | Bonus / treizième mois | SIM | `payroll/statutory.ts`, `mission-15-report.md` | 1/12 des gains, sans validation de la section 54 ; aucun paiement. |
| F12 | Bulletin de paie PDF | SIM | `payroll/pdf.ts`, `payroll-pdf.test.ts` | Mention « SIMULATION — NOT VALIDATED FOR PAYMENT ». |
| F13 | Net payable et bulletin final | BLQ | `payroll/service.ts` (`netPayable` nul si règles non validées), `finalisePayslip` renvoie 409 | La finalisation est volontairement bloquée. |
| F14 | Déclarations employeur MRA | SIM | `payroll` declarations, `payroll-declarations.test.ts` (5 cas) | Préparation interne uniquement ; le CSV officiel MRA n'est pas généré. |
| F15 | Écritures comptables de paie | IT | `payroll/accounting.ts`, `payroll-accounting.test.ts` (11 cas) | Mapping de comptes humain, approbation puis comptabilisation explicites ; pas de paiement. |
| F16 | Rapprochement paie ↔ comptabilité | IPT | `payroll/accounting-preview`, `accounting-transfers`, tests | Aperçu et contrôle de source existent ; pas de rapprochement périodique automatisé. |
| F17 | Virement ou paiement des salaires | ABS | Aucune route de paiement bancaire | Aucun bulletin final, donc aucun paiement possible. |
| F18 | Provisions pour congés et engagements sociaux | ABS | Aucun calcul ni écriture dédiée | Les soldes de congés sont suivis, pas provisionnés comptablement. |
| F19 | Règles secteur public / PRB | BLQ | `payroll/service.ts` (règles manquantes), `demo-payroll.test.ts` (`P016` bloqué) | Aucune règle inventée ; calcul bloqué. |
| F20 | Séparation des droits paie/comptabilité et audit | IT | `permissions.ts`, `cabinet.test.ts`, `payroll-accounting.test.ts` | Pas de MFA ni de revue d'accès périodique. |

## 9. G. États financiers

| ID | Fonctionnalité | Statut | Preuves techniques | Limite / commentaire |
|---|---|---|---|---|
| G01 | Bilan provisoire | PI | `reports/service.ts` (`computeStatements`), `Statements.tsx`, `reports.test.ts` | Équilibré, mais classement courant/non courant aplati et pas de comparatif. |
| G02 | Compte de résultat provisoire | PI | même chemin | Pas de sous-total coût des ventes ni de comparatif N-1. |
| G03 | Tableau de flux de trésorerie | ABS | Aucune route, aucun écran, aucun test ; `mission-26-report.md` le confirme | Aucun état des flux indirect ou direct. |
| G04 | Tableau de variation des capitaux propres | IPT | `equity/statement`, `equity.test.ts` | L'état est rapproché de la balance, mais pas de format de présentation normé ni d'export dédié. |
| G05 | Notes annexes | ABS | Aucune structure de notes | Seulement un registre de sources et des commentaires libres. |
| G06 | Comparaison N/N-1 | ABS | Aucune colonne comparative dans `StatementsDto` | Le changement de période recharge un état séparé, sans comparaison. |
| G07 | Exports CSV et PDF des états | IT | `reports/routes.ts`, `reports/pdf.ts`, `reports.test.ts` | Export à plat, avec mention de démonstration ; pas de version signée. |
| G08 | Export XLSX des états | ABS | Aucun export XLSX ; XLSX n'est utilisé qu'en import | QuickBooks et Excel exigent un format tabulaire supplémentaire. |
| G09 | Classement courant/non courant et coût des ventes | PI | `fs_mapping` existe dans `accounts`, mais `groupBS`/`groupPL` aplatissent les groupes | Le mapping est stocké mais non présenté dans les états. |
| G10 | Versionnement, horodatage et traçabilité des états | PI | date de génération et bandeau de démonstration dans les PDF | Aucun snapshot immuable, aucune signature, aucun registre des états produits. |

## 10. H. Gestion du cabinet

| ID | Fonctionnalité | Statut | Preuves techniques | Limite / commentaire |
|---|---|---|---|---|
| H01 | Portefeuille multi-sociétés | IT | `cabinet/routes.ts`, `companies.test.ts`, `CabinetDashboard.tsx` | Une seule société active à la fois. |
| H02 | Exercices et périodes par société | IT | `financial-years/routes.ts`, `settings/routes.ts`, `financial-years.test.ts` | Pas de consolidation inter-exercices. |
| H03 | Collaborateurs, rôles et permissions par module | IT | `permissions.ts`, `cabinet/routes.ts`, `cabinet.test.ts` | Pas de MFA, SSO ni politique de mot de passe par cabinet. |
| H04 | Séparation paie / comptabilité | IT | `permissions.ts`, `cabinet.test.ts`, `payroll-accounting.test.ts` | Un gestionnaire paie n'a pas le droit d'écriture comptable. |
| H05 | Séparation des dossiers clients | IT | `company_id`, triggers, `requireCompany`, tests multi-sociétés | Pas de test d'intrusion systématique sur chaque route. |
| H06 | Archivage d'un dossier en lecture seule | IT | `cabinet/routes.ts`, `cabinet.test.ts` | La lecture reste possible ; aucune purge. |
| H07 | Tâches, échéances, priorités, commentaires et historique | IT | `cabinet/routes.ts`, `cabinet.test.ts`, `Tasks.tsx` | Pas de rappel e-mail ou notification externe. |
| H08 | Documents, archives et validation | IT | `documents/*`, `financial-years/archive`, `mission23.test.ts`, `financial-years.test.ts` | Les archives sont scellées par hash, pas signées électroniquement. |
| H09 | Journal d'audit append-only | IT | `audit_log`, trigger `AUDIT_LOG_APPEND_ONLY`, `regressions.test.ts` | Pas de chaînage cryptographique ni de WORM externe. |
| H10 | Tableau de bord cabinet agrégé | PI | `cabinet/routes.ts`, `CabinetDashboard.tsx` | Agrégation des tâches et dossiers, pas de consolidation comptable. |
| H11 | Recherche transverse entre dossiers | ABS | Aucune route de recherche globale | Chaque dossier est consulté séparément. |
| H12 | Modèles réutilisables entre dossiers | ABS | Aucun modèle de dossier, de tâche ou de plan partagé | Le plan du cabinet peut être importé fichier par fichier. |
| H13 | MFA, SSO, réinitialisation de mot de passe | ABS | `roadmap.md` D-01/D-02, `permissions-matrix.md` | Aucun fournisseur SMTP ni TOTP. |
| H14 | Révocation d'une dérogation et transfert de propriété | PI | API `members` permet `none` ; UI non ; aucun transfert `owner` | La matrice des permissions le documente. |
| H15 | Sauvegarde/restauration et export complet d'un dossier | ABS | Procédure `pg_dump`/`pg_restore` seulement, aucun test | Aucun export complet par société, aucune restauration testée. |
| H16 | Supervision, alertes et plan de reprise | ABS | Aucun composant d'exploitation | Hors code applicatif ; porte de sortie M29 non testée. |
| H17 | Revue de sécurité indépendante et test d'intrusion | ABS | Aucun rapport de pentest | L'audit M29 le liste comme porte de sortie. |
| H18 | Tests navigateur réels (Chromium, Android, Windows) | ABS | `browser-tests.md`, tests jsdom seulement | Aucun binaire Chromium ni appareil physique dans cet environnement. |

## 11. Preuves exécutées pendant cet audit

| Vérification | Commande | Résultat exact |
|---|---|---|
| Tests API | `npm run test -w @mc/api` avec rapport JSON | **503 tests : 492 réussis, 11 ignorés, 0 échec**, 33 fichiers |
| Tests web | `npm run test -w @mc/web` avec rapport JSON | **287 réussis, 0 échec**, 44 fichiers |
| Typecheck | `npm run typecheck` | **0 erreur** API + web + tests |
| Build | `npm run build` | **succès** API et web ; avertissement de chunk web 1 238 kB |
| Tests non exécutés | PostgreSQL réel et Playwright | 11 tests ignorés faute de `TEST_DATABASE_URL` ; aucun test navigateur réel |

Les 11 tests ignorés sont 10 tests de concurrence (`concurrency.test.ts`) et 1 test de lettrage
concurrent. Ils ne doivent pas être comptés comme validés dans cette session.

## 12. Limites de cet audit

- Aucune donnée client réelle, aucun accès au VPS, aucun déploiement, aucun identifiant MRA.
- Aucun test manuel sur navigateur, Android, Windows, imprimante ou lecteur d'écran.
- Aucun test de charge, de restauration, de reprise après sinistre ou d'intrusion.
- La lecture du code prouve un chemin d'exécution, pas la conformité comptable, fiscale ou IFRS.
- Les références réglementaires restent celles du registre existant ; les points `À VÉRIFIER`
  doivent être tranchés par la MRA, un conseil juridique ou un expert-comptable mauricien.
- Aucune affirmation de certification, d'homologation MRA ou de conformité QuickBooks.
