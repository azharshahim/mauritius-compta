# Checklist d’audit avant production — Mauritius Business Suite

Date de revue : 2026-11-01  
Périmètre : dépôt `mauritius-compta`, état de la branche de mission 29  
Référence de base : `main` = `512bf26` ; PR nº 11 (mission 28) **non fusionnée** ; travaux mission 29 empilés sur la branche de session  
Nature de la revue : **revue technique interne**, automatisée et documentaire. Aucune revue par un expert-comptable, un juriste, un auditeur de sécurité ou un organisme de certification n’a été réalisée.

## 1. Règles de preuve et de statut

Cette checklist ne remplace ni un audit légal, ni une validation par un professionnel, ni un test de restauration réel.

| Statut | Signification retenue ici |
|---|---|
| **Conforme et vérifié** | Le comportement attendu est couvert par du code **et** par un test reproductible ou une preuve d’exécution, et le contrôle a été revu dans le périmètre concerné. Aucune rubrique ne peut recevoir ce statut uniquement parce qu’un écran existe. |
| **Partiellement conforme** | Une partie du comportement est implémentée et testée, mais il manque une preuve, un cas limite, une validation humaine ou une revue indépendante. |
| **Non conforme** | Le comportement requis est absent, incomplet de façon bloquante, ou contredit une exigence réglementaire connue. |
| **Non testé** | Aucune preuve d’exécution fiable n’est disponible à la date de la revue. |
| **Non applicable** | La rubrique ne concerne pas le périmètre livré. |

**Règle absolue :** une mention « conforme » sans chemin de test, résultat d’exécution ou procédure reproductible est interdite. Les taux d’extraction de la mission 29 portent sur des **fixtures synthétiques**, pas sur des documents clients réels.

## 2. Synthèse

| Statut | Nombre de rubriques |
|---|---:|
| Conforme et vérifié | **0** |
| Partiellement conforme | **15** |
| Non conforme | **2** |
| Non testé | **3** |
| Non applicable | **0** |
| **Total** | **20** |

Aucune rubrique n’est déclarée entièrement conforme. Les deux rubriques **Non conformes** sont la fiscalité MRA et la conformité réglementaire ; les trois rubriques **Non testées** sont la sauvegarde/restauration, la performance/volumétrie et l’exploitation/surveillance.

## 3. Checklist détaillée

### 3.1 Comptabilité générale

- **Statut : Partiellement conforme**
- **Preuves :** `apps/api/tests/entries.test.ts` (12), `apps/api/tests/regressions.test.ts` (17), `apps/api/tests/lettering.test.ts` (30) et `apps/api/tests/reports.test.ts` (10) passent sur la base de test ; écritures équilibrées, partie double, contrôle de période et protections contre les doublons sont exercés.
- **Écarts / actions :** pas de validation par un expert-comptable ; pas de jeu d’essai de clôture annuelle réel ; pas de test de reprise d’un cabinet multi-sociétés avec volumes de production ; les tolérances d’arrondi et les cas de TVA partiellement déductible doivent être revus métier.
- **Preuve manquante bloquante :** jeu de données comptables validé par un professionnel.

### 3.2 Plan comptable

- **Statut : Partiellement conforme**
- **Preuves :** `apps/api/tests/mission23.test.ts` (18) et `apps/api/tests/accounts.test.ts` (4) passent ; les profils de plan comptable, l’import CSV/XLSX, les libellés FR/EN et les statuts `PENDING PROFESSIONAL VALIDATION` / `AWAITING FIRM CONFIRMATION` existent ; `docs/company-settings.md` et `docs/mission-23-report.md` documentent les limites.
- **Écarts / actions :** aucun plan comptable mauricien n’est déclaré validé par un cabinet ; les comptes par défaut doivent être confrontés au plan réel de la société ; les comptes inactifs sont refusés, mais la matrice complète type de compte × journal × opération n’est pas exhaustivement testée.
- **Preuve manquante bloquante :** confirmation écrite du cabinet pour le plan utilisé en production.

### 3.3 Capitaux propres et réserves

- **Statut : Partiellement conforme**
- **Preuves :** `apps/api/tests/equity.test.ts` (7) et `apps/api/tests/equity-ui.test.tsx` (4) passent ; l’état des capitaux, les contrôles de clôture et l’absence de comptabilisation automatique sont exercés.
- **Écarts / actions :** les règles mauriciennes de réserves, dividendes et affectation du résultat n’ont pas été validées par un expert ; aucun test avec historique pluriannuel réel ; dépendance à la qualité des écritures antérieures.
- **Preuve manquante bloquante :** validation métier des affectations et des reports à nouveau.

### 3.4 Stocks

- **Statut : Partiellement conforme**
- **Preuves :** `apps/api/tests/mission22.test.ts` (13) et `apps/web/tests/mission22-ui.test.tsx` (3) passent ; FIFO, rapprochement et pont facture → mouvements sont couverts sur des fixtures.
- **Écarts / actions :** pas de test de valorisation à grande échelle, de stock négatif, de retour fournisseur complexe, ni d’inventaire physique ; aucune validation par un expert en gestion de stocks.
- **Preuve manquante bloquante :** recette métier sur un cycle achat → stock → vente → inventaire.

### 3.5 Immobilisations et amortissements

- **Statut : Partiellement conforme**
- **Preuves :** `apps/api/tests/fixed-assets.test.ts` (9), `apps/api/tests/fixed-assets-depreciation.test.ts` (8) et les tests de paie associés passent ; calculs d’amortissement et cessions sont exercés.
- **Écarts / actions :** les durées, méthodes et règles fiscales mauriciennes doivent être confirmées ; pas de test de réévaluation, de composants ni de changement de méthode en cours d’exercice ; pas de revue d’expert.
- **Preuve manquante bloquante :** validation des taux et des méthodes par le cabinet.

### 3.6 Provisions

- **Statut : Partiellement conforme**
- **Preuves :** `apps/api/tests/mission22.test.ts` (13) et `apps/web/tests/mission22-ui.test.tsx` (3) passent ; les provisions et échéanciers sont couverts par des fixtures.
- **Écarts / actions :** pas de scénario de reprise, d’ajustement ou de provision fiscalement non déductible validé ; pas de test de clôture réelle.
- **Preuve manquante bloquante :** revue métier des règles de provisionnement.

### 3.7 TVA et fiscalité mauricienne

- **Statut : Non conforme**
- **Preuves :** la configuration TVA, les taux et les contrôles de cohérence sont partiellement testés (`apps/api/tests/mission23.test.ts`, `apps/api/tests/reports.test.ts`) ; l’écran MRA e-Invoicing est explicitement **informatif**, sans connexion MRA (`docs/mra-e-invoicing-roadmap.md`).
- **Écarts / actions :** **aucune intégration de facturation électronique MRA** (émission d’IRN/QR, transmission, certification EBS) n’est livrée ; aucun test avec le sandbox MRA ; pas de validation du traitement des exonérations, autoliquidations, notes de crédit et déclarations TVA ; pas de revue fiscale.
- **Blocage production :** ne pas présenter le module comme conforme MRA e-Invoicing. Une intégration certifiée et une validation fiscale sont nécessaires avant toute facturation réglementée.

### 3.8 Multidevises

- **Statut : Partiellement conforme**
- **Preuves :** `apps/api/tests/fx.test.ts` (35), `apps/api/tests/money.test.ts` (9) et `apps/web/tests/fx-ui.test.tsx` (3) passent ; montants en `numeric(20,4)`, taux explicites, écarts de change et absence de taux inventé sont exercés.
- **Écarts / actions :** aucun taux officiel n’est intégré ; les tests utilisent des taux saisis ; les arrondis légaux et la conversion MUR des états financiers ne sont pas validés par un expert ; pas de test avec volatilité réelle.
- **Preuve manquante bloquante :** politique de change et de conversion validée.

### 3.9 Rapprochement bancaire

- **Statut : Partiellement conforme**
- **Preuves :** `apps/api/tests/bank.test.ts` (28), `apps/api/tests/bank-billing.test.ts` (18), `apps/web/tests/bank-ui.test.tsx` et les tests de rapprochement groupé passent ; import CSV/TSV/XLSX, matching, anti-doublons et confirmation humaine sont couverts.
- **Écarts / actions :** les formats PDF bancaires ne sont validés que sur des **fixtures synthétiques** ; aucun échantillon officiel SBM, Absa Mauritius ou MauBank n’a été testé ; le profil dédié reste MCB ; pas de test de relevé scanné complexe ni de colonnes décalées.
- **Preuve manquante bloquante :** jeux de relevés réels anonymisés par banque, avec validation de chaque ligne.

### 3.10 Clôture et ouverture des exercices

- **Statut : Partiellement conforme**
- **Preuves :** `apps/api/tests/financial-years.test.ts` (5), `apps/api/tests/financial-years-ui.test.tsx` (3), `apps/api/tests/equity.test.ts` (7) passent ; contrôles de clôture, écritures antérieures et archives scellées sont exercés sur fixtures.
- **Écarts / actions :** pas de test de clôture multi-exercices à volume réel ; pas de test de restauration d’archive ; pas de validation par un expert ; les dépendances entre clôture, à-nouveaux et fiscalité ne sont pas exhaustivement couvertes.
- **Preuve manquante bloquante :** recette de clôture annuelle complète et restauration vérifiée.

### 3.11 Bilan, compte de résultat et balance

- **Statut : Partiellement conforme**
- **Preuves :** `apps/api/tests/reports.test.ts` (10), `apps/api/tests/entries.test.ts` (12) et les tests d’états financiers passent ; équilibre, contrôle de balance et génération d’états sont exercés.
- **Écarts / actions :** pas de comparaison avec des états financiers audités ; pas de validation des regroupements de postes mauriciens ; pas de test de performance sur un exercice complet chargé.
- **Preuve manquante bloquante :** rapprochement avec un jeu d’états validés.

### 3.12 Sécurité des données

- **Statut : Partiellement conforme**
- **Preuves :** `apps/api/tests/auth.test.ts` (9), `apps/api/tests/cabinet.test.ts` (11), les contrôles d’isolation et le stockage privé des documents existent ; les secrets ne sont pas versionnés et la configuration en refuse certains.
- **Écarts / actions :** **aucun test d’intrusion**, aucune revue de sécurité indépendante, pas de preuve de chiffrement au repos des documents, pas de test de rotation des secrets, pas de test de fuite dans les journaux ; les quotas et la limitation de débit doivent être revus pour la production.
- **Preuve manquante bloquante :** revue de sécurité et test d’intrusion avant mise en ligne.

### 3.13 Isolation entre sociétés

- **Statut : Partiellement conforme**
- **Preuves :** plusieurs suites vérifient l’isolation par société, notamment `payroll-accounting.test.ts`, `bank.test.ts`, `mission29.test.ts` et `cabinet.test.ts` ; toutes passent.
- **Écarts / actions :** l’isolation n’est pas testée sur la totalité des routes et des objets ; pas de test automatisé systématique « société A ne peut jamais lire la société B » sur chaque endpoint ; risque résiduel en cas de nouvelle route non couverte.
- **Preuve manquante bloquante :** test transversal d’autorisation par route et revue de code.

### 3.14 Droits utilisateurs

- **Statut : Partiellement conforme**
- **Preuves :** `apps/api/tests/auth.test.ts`, `apps/api/tests/cabinet.test.ts` et `docs/permissions-matrix.md` ; les rôles et plusieurs refus sont testés.
- **Écarts / actions :** la matrice complète rôle × permission × route n’est pas couverte ; les tests ne prouvent pas l’absence d’élévation de privilèges ; pas de revue par un administrateur sécurité ; pas de test d’écran pour chaque rôle.
- **Preuve manquante bloquante :** recette des permissions avec comptes réels de chaque rôle.

### 3.15 Sauvegarde et restauration

- **Statut : Non testé**
- **Preuves :** `docs/deployment.md` décrit une procédure `pg_dump` + GPG et exige un test de restauration ; **aucun test de restauration n’a été exécuté dans cette mission**, et aucun résultat de restauration n’est archivé.
- **Écarts / actions :** tester une restauration complète sur une base vierge, vérifier les documents binaires et les secrets, mesurer le RPO/RTO, documenter la procédure de reprise.
- **Blocage production :** la case « sauvegardes chiffrées + restauration testée » de `docs/deployment.md` reste **non cochée**.

### 3.16 Traçabilité et audit

- **Statut : Partiellement conforme**
- **Preuves :** `apps/api/tests/mission29.test.ts` vérifie deux entrées d’audit pour une ré-extraction (prévisualisation puis application) ; les approbations, règles, rapprochements et imports écrivent des événements ; les tests de régression passent.
- **Écarts / actions :** pas de test d’immuabilité ou de conservation à long terme ; pas de preuve d’export/intégrité des journaux ; pas de couverture de tous les événements sensibles ; pas de revue légale de la rétention.
- **Preuve manquante bloquante :** politique de conservation et test d’intégrité des journaux.

### 3.17 Performance et volumétrie

- **Statut : Non testé**
- **Preuves :** `apps/api/tests/concurrency.test.ts` est **ignoré** (10 tests *skipped*) ; aucun test de charge, de latence OCR, de mémoire ou de volumétrie documentaire n’a été exécuté.
- **Écarts / actions :** mesurer le temps d’extraction OCR sur 10 pages, la taille mémoire, le débit d’import de 100 fichiers, les temps de réponse des états comptables et le comportement à 10 000 écritures ; définir des seuils.
- **Blocage production :** aucun dimensionnement n’est prouvé.

### 3.18 Tests navigateur et mobile

- **Statut : Partiellement conforme**
- **Preuves :** `apps/web/tests/mission29-ui.test.tsx` (2), la suite web (275 tests) et les tests jsdom passent ; les media queries et la grille responsive sont présentes ; `docs/deployment.md` précise qu’aucun test Chrome/Android réel n’a été exécuté.
- **Écarts / actions :** aucun test physique sur Android/Samsung, aucune vérification Safari/Firefox, pas de test d’accessibilité automatisé ni de lecteur d’écran ; les tests jsdom ne prouvent pas le rendu visuel.
- **Preuve manquante bloquante :** recette sur appareils réels et audit d’accessibilité.

### 3.19 Conformité réglementaire

- **Statut : Non conforme**
- **Preuves :** `docs/regulatory-review-register.md`, `docs/mauritius-regulations/` et `docs/mra-e-invoicing-roadmap.md` documentent les sources et les points à vérifier ; **aucune certification, aucun enregistrement EBS, aucune validation DPO ou juridique** n’est disponible.
- **Écarts / actions :** la facturation électronique MRA n’est pas intégrée ; les mentions obligatoires des factures ne sont pas validées par un juriste ; la conformité Data Protection (rétention, droits des personnes, sous-traitants) n’est pas auditée ; les obligations fiscales et de paie restent à confirmer.
- **Blocage production :** ne pas annoncer de conformité réglementaire. Une revue juridique et fiscale est indispensable.

### 3.20 Exploitation et surveillance

- **Statut : Non testé**
- **Preuves :** `docs/deployment.md` décrit des principes de déploiement et de journalisation ; **aucun tableau de bord de supervision, aucune alerte, aucun test d’incident ou d’astreinte** n’a été vérifié dans cette mission.
- **Écarts / actions :** définir les métriques (erreurs API, files OCR, échecs d’import, latence, espace disque), les alertes, la rotation des journaux, la procédure d’incident et le runbook de restauration.
- **Blocage production :** aucune preuve d’exploitation sous charge ou en incident.

## 4. Portes de sortie avant production

Les points suivants sont **bloquants** et ne peuvent pas être remplacés par une capture d’écran ou une démonstration :

1. **Validation métier et fiscale** du plan comptable, des taux, des états et des mentions de facture par un cabinet mauricien.
2. **Conformité MRA e-Invoicing** : analyse du champ d’application, enregistrement EBS le cas échéant, intégration certifiée et tests sur le sandbox officiel. Aucun raccordement ne doit être simulé.
3. **Jeux de documents réels anonymisés** pour chaque banque et chaque format revendiqué, avec rapprochement ligne à ligne et validation de la protection des données.
4. **Tests de sauvegarde et de restauration** sur une base vierge, avec preuve archivée.
5. **Revue de sécurité indépendante**, test d’intrusion, contrôle des permissions et de l’isolation, analyse des dépendances.
6. **Tests de charge et de disponibilité**, avec seuils et plan de reprise.
7. **Recette navigateur et mobile réelle**, accessibilité incluse.
8. **Procédure d’exploitation** : supervision, alertes, astreinte, gestion des incidents, rétention.

## 5. Conclusion

Le logiciel **n’est pas déclaré prêt pour la production**. Cette checklist constate un socle technique partiellement couvert par des tests, mais aucune rubrique ne réunit à ce jour l’ensemble des preuves nécessaires à une mise en production comptable et réglementée.
