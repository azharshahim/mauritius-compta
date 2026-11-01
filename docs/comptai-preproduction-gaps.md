# COMPTAI — écarts avant production

**Mission 32 — audit fonctionnel**
**Mise à jour mission 33 — statut de P0-01 : 1er novembre 2026**
**Base auditée : `main` = `c9d20cf7a9e664b30b7e9bdd81fccdda0548acd0`, version 0.1.1**
**Nature : constats d'audit et statut de la correction P0-01. La conversion multidevise complète n'est pas implémentée.**

> **Règle de lecture.** Un P0 n'est pas une opinion de priorité : c'est un point qui bloque une
> mise en production, peut produire une erreur comptable ou fiscale, ou expose à un risque de
> sécurité ou de perte de données. Les P1 sont nécessaires avant une recette réelle ; les P2
> améliorent l'exploitabilité ; les P3 sont du confort. Aucun P0 ne doit rester ouvert au moment
> d'une décision de mise en service.

**Documents liés :** [rapport d'audit](./mission-32-audit.md) · [couverture fonctionnelle](./comptai-functional-coverage.md) · [matrice QuickBooks](./comptai-quickbooks-test-matrix.md) · [rapport mission 33](./mission-33-report.md)

## 1. Définitions

| Priorité | Définition | Décision attendue |
|---|---|---|
| **P0** | Blocage de production, erreur comptable/fiscale, sécurité critique ou perte de données. | Corriger, désactiver la fonction concernée, ou refuser la mise en production. |
| **P1** | Fonctionnalité essentielle incomplète, preuve de production absente ou dépendance réglementaire non tranchée. | Planifier avant la recette ou la mise en service. |
| **P2** | Amélioration importante d'usage, de traçabilité ou de couverture fonctionnelle. | Planifier après les P0/P1, avec un propriétaire et une échéance. |
| **P3** | Confort, finition, documentation secondaire. | Traiter au fil de l'eau. |

## 2. Synthèse

| Priorité | Nombre | Objet dominant |
|---|---:|---|
| P0 | 4 | Perte de données, sécurité, conformité MRA, paie non payable |
| P1 | 15 | États financiers, fiscalité, exports QuickBooks, preuves de production, exploitation |
| P2 | 13 | Conversion multidevise, sous-registres, parcours utilisateur, cohérence, métadonnées, accessibilité |
| P3 | 5 | Finition, documentation secondaire, impression |
| **Total** | **37** | — |

### 2.1 Correspondance avec les anomalies du rapport d'audit

Les identifiants ci-dessous sont ceux du registre des écarts. Le rapport d'audit possède sa
propre numérotation ; la correspondance est donnée pour éviter toute confusion.

| Registre des écarts | Anomalie du rapport d'audit | Remarque |
|---|---|---|
| P0-01 (historique) | P0-01 | **Neutralisé en mission 33** pour le risque d'affichage ; la conversion complète devient P2-13. |
| P1-01 | P1-01 | Le registre ajoute l'absence de flux, de notes et de comparatif à l'aplatissement des groupes. |
| P1-03 | P2-03 (AR Aging) | La priorité du registre est plus élevée car l'export bloque la recette QuickBooks. |
| P1-05 | P2-04 | La priorité du registre est plus élevée car le contrôle conditionne des factures réelles. |
| P1-12 | P1-02 | Mention de démonstration sur les états et principaux PDF. |
| P1-15 | P2-02 | Documentation d'audit obsolète. |
| P2-01 | P2-01 | Messages de paie contradictoires. |
| P2-08 | P3-01 | Métadonnées PDF à l'ancienne marque. |

Les écarts P0-02, P0-03, P0-04, P0-05, P1-02, P1-04, P1-06 à P1-11, P1-13, P1-14 et
l'ensemble des P2/P3 non listés ci-dessus sont des **constats de préparation** qui ne
correspondent pas à une anomalie de calcul isolée dans le rapport.

## 3. P0 — blocages de production

### 3.1 P0-01 — risque d'affichage neutralisé, conversion non implémentée

La mission 33 a fermé le risque d'affichage trompeur : les états financiers, les exports CSV,
les PDF et l'écran affichent désormais la **devise fonctionnelle** dans laquelle les montants sont
réellement calculés. La devise de présentation configurée est conservée et signalée comme **non
appliquée**. Aucun taux de change, aucune méthode de conversion et aucun arrondi n'ont été
inventés. La conversion multidevise complète reste absente : elle est suivie en **P2-13**, et non
plus comme un P0 d'affichage.

| ID | Écart | Impact | Preuve | Recommandation | Porte de sortie |
|---|---|---|---|---|---|
| **P0-02** | **Aucune sauvegarde/restauration testée et aucun export complet d'un dossier.** | Perte de données irréversible en cas d'incident ; impossibilité de migrer ou d'archiver un client. | `roadmap.md` D-11 ; aucun test de `pg_dump`/`pg_restore` ; aucun export complet par société | Mettre en place une sauvegarde chiffrée, une restauration testée sur une base vierge, un export complet par société et un registre des restaurations. | Test de restauration réussi, documenté et daté. |
| **P0-03** | **Pas de revue de sécurité indépendante ni de test d'intrusion ; isolation multi-société non exhaustivement testée route par route.** | Risque de fuite entre dossiers clients, d'élévation de privilèges ou de compromission de données comptables. | `preproduction-audit-checklist.md` ; `permissions-matrix.md` ; tests ciblés mais pas d'audit exhaustif | Faire réaliser une revue indépendante, un test d'autorisation par route, un test d'intrusion et une revue de la journalisation. | Rapport de pentest et plan de remédiation clos ou accepté formellement. |
| **P0-04** | **MRA e-Invoicing non intégré** alors que des jalons réglementaires sont publiés comme lancés. | Une société assujettie ne peut pas émettre de facture fiscale conforme par COMPTAI ; l'écran informatif ne doit pas être confondu avec une intégration. | `MraEInvoicing.tsx` ; `mra-e-invoicing-roadmap.md` ; textes MRA cités dans le rapport d'audit, section 5 | Trancher le périmètre clients, obtenir l'enregistrement éditeur EBS, les spécifications à jour et un environnement de test ; ne pas commercialiser l'e-invoicing avant auto-certification. | Décision écrite : hors périmètre pour un client donné, ou intégration testée et auto-certifiée. |
| **P0-05** | **Paie non finalisable et non payable** : net payable nul, bulletin final bloqué, aucun paiement, déclarations internes. | Si la paie est vendue comme opérationnelle, risque de paiement erroné, de retard déclaratif et de responsabilité employeur. | `payroll/service.ts` (`netPayable`, `finalisePayslip`) ; `payroll-declarations.test.ts` ; `mission-15-report.md` | Soit exclure formellement la paie du périmètre de production, soit faire valider les règles par un expert, activer le net payable et les contrôles de paiement/déclaration. | Revue experte signée ; tests de finalisation et de déclaration officielle ; autorisation de paiement. |

## 4. P1 — essentiels avant recette réelle

| ID | Écart | Impact | Preuve | Recommandation | Porte de sortie |
|---|---|---|---|---|---|
| **P1-01** | **États financiers incomplets** : pas de flux de trésorerie, pas de notes, pas de comparatif N-1, classement courant/non courant aplati, pas de version signée. | Impossible de produire un jeu d'états statutaires complet ou de le comparer à QuickBooks. | `reports/service.ts` ; `Statements.tsx` ; `mission-26-report.md` ; `roadmap.md` | Prioriser le flux de trésorerie, les comparatifs, les notes et les sous-totaux ; figer une version par période. | États validés par le cabinet et export de recette signé. |
| **P1-02** | **Aucune déclaration TVA, aucun impôt sur les sociétés, aucun calendrier fiscal, aucun régime particulier/TDS.** | La conformité fiscale reste entièrement hors application ; risque de retards et d'erreurs de déclaration. | Absence de routes ; `docs/mauritius-regulations/vat.md`, `docs/mauritius-regulations/corporate-tax.md` en `À VÉRIFIER` | Ne pas coder de taux avant validation ; cadrer un module de préparation de déclarations avec textes et formats officiels. | Textes archivés, format validé, recette avec le cabinet. |
| **P1-03** | **Pack d'exports QuickBooks incomplet** : pas d'export du plan comptable, pas de Journal Report, pas d'AR Aging fichier, pas de XLSX. | Recette QuickBooks partielle et ressaisie manuelle. | `accounts/routes.ts` ; `entries/routes.ts` ; `billing/aging` ; aucun export XLSX | Construire les quatre exports manquants avec tests de format et documentation de mapping. | Pack d'exports produit et accepté par le cabinet. |
| **P1-04** | **Aucun corpus réel anonymisé de factures/relevés ; OCR non calibré.** | Risque de faux montants, de colonnes décalées ou de doublons non détectés chez un client. | `mission-29-report.md` ; fixtures synthétiques uniquement | Constituer 30 à 50 factures et des relevés MCB/SBM/Absa/MauBank anonymisés ; mesurer par champ ; bloquer sous un seuil. | Protocole de mesure et seuils signés. |
| **P1-05** | **La vérification d'un taux de TVA est une auto-déclaration admin avec source libre.** | Un taux erroné peut être marqué « vérifié » et utilisé sur des factures. | `billing/routes.ts` `verify` | Ajouter l'identité/qualité du réviseur, une pièce justificative, une date de revue et une séparation des rôles ; interdire l'auto-vérification en production. | Procédure de validation TVA signée par le cabinet. |
| **P1-06** | **Revue experte de la paie en attente ; règles secteur public/PRB absentes.** | Le moteur peut calculer des montants non validés ou bloquer des salariés. | `mission-15-report.md`, `payroll/service.ts`, `payroll-statutory.test.ts` | Revue experte unique avant toute finalisation ; documenter les règles non couvertes. | Rapport de revue et décision d'activation. |
| **P1-07** | **Pas de MFA, pas de réinitialisation de mot de passe, pas de SSO.** | Comptes administrateurs exposés ; support utilisateur impossible sans intervention manuelle. | `roadmap.md` D-01/D-02 ; `permissions-matrix.md` | Ajouter TOTP pour les rôles sensibles, jetons de réinitialisation à usage unique, politique de mot de passe. | Tests d'authentification et procédure de support. |
| **P1-08** | **Supervision, alertes et procédure d'exploitation absentes.** | Incident non détecté, sauvegarde non surveillée, temps d'arrêt prolongé. | `preproduction-audit-checklist.md` (rubrique non testée) | Définir journaux, métriques, alertes, astreinte, procédure d'incident et plan de reprise. | Revue d'exploitation et exercice de reprise. |
| **P1-09** | **Aucun test de charge ou de volumétrie ; grand livre non paginé.** | Dégradation sur plusieurs milliers d'écritures ou lors d'imports massifs. | `roadmap.md` D-07 ; aucun test de charge | Définir un profil de charge, paginer les rapports, tester imports et rapports volumineux. | Rapport de performance avec seuils acceptés. |
| **P1-10** | **Aucun test navigateur réel.** | Régressions d'interface, de clavier Android ou d'impression non détectées. | `browser-tests.md` ; tests jsdom uniquement | Exécuter Playwright sur Chromium desktop et mobile, puis un essai physique Android/Windows. | Campagne navigateur signée. |
| **P1-11** | **Pas de rapprochement automatisé comptes clients/fournisseurs ↔ comptes collectifs.** | Écart entre sous-registre et grand livre non détecté avant clôture. | `billing/aging`, `purchases/aging`, aucun contrôle de compte collectif | Ajouter un état de rapprochement signé et un contrôle bloquant/warning dans la checklist de clôture. | État de rapprochement accepté. |
| **P1-12** | **Les états et les principaux PDF portent une mention de démonstration** ; le bulletin de paie porte « simulation ». | Documents non remettables au client, même après validation des comptes. | `apps/api/src/i18n/index.ts` `pdf.demo`/`csv.demoNote` ; `reports/pdf.ts` ; `fixed-assets/pdf.ts` ; `billing/pdf.ts` ; `payroll/pdf.ts` | Rendre la mention configurable et conditionnée à un statut de production validé ; conserver une mention de version. | Décision écrite sur les mentions légales et tests d'impression. |
| **P1-13** | **Capital allowances et amortissement fiscal absents.** | Le registre comptable ne permet pas de préparer la déduction fiscale mauricienne. | `mission-20-report.md` ; `i18n.tsx` `fa.calculationNote` | Attendre les règles officielles ; prévoir un registre fiscal séparé, sans pooling inventé. | Règles fournies et validées par le cabinet. |
| **P1-14** | **Journal d'audit append-only mais non chaîné cryptographiquement et sans WORM.** | Altération locale par un administrateur base non détectable. | `0003_hardening.sql` ; `roadmap.md` D-12 | Ajouter un chaînage de hash et une exportation périodique vers un stockage immuable. | Preuve de vérification d'intégrité. |
| **P1-15** | **Documentation d'audit obsolète.** | Fausses conclusions pendant la recette, perte de confiance, efforts gaspillés. | README, `permissions-matrix.md`, `bank-import.md`, `accounting-gaps-audit.md`, `roadmap.md` | Mettre à jour ou marquer « historique » les documents contredits par l'arbre courant. | Revue documentaire signée. |

## 5. P2 — améliorations importantes

| ID | Écart | Impact | Preuve | Recommandation |
|---|---|---|---|---|
| **P2-01** | Messages de paie contradictoires entre API, démo, assistant et écran préparé. | Incompréhension du périmètre réel. | `payroll/service.ts` ; `demo/payroll.ts` ; `demo/runtime.ts` ; `ai/tools.ts` ; `Prepared.tsx` | Une seule source de capacités, alimentée par l'API, avec tests de cohérence. |
| **P2-02** | Stocks : pas de PDF serveur, pas de landed cost, réceptions partielles, séries, péremption. | Usage limité aux cas simples. | `mission-22-report.md` | Prioriser le PDF serveur et le pont achat/facture dans l'UI ; les autres selon les besoins clients. |
| **P2-03** | PDF multi-factures détecté mais non séparé. | Saisie manuelle ou blocage. | `mission-29-report.md` | Segmentation avec confirmation humaine, sans création automatique. |
| **P2-04** | Rescannage légèrement différent non détecté comme doublon. | Double comptabilisation potentielle. | `mission-29-report.md` | Ajouter une similarité contrôlée, avec décision humaine. |
| **P2-05** | Comptes d'attente, emprunts et comptes courants d'associés absents. | Contournement par écritures manuelles, sans subledger. | `accounting-gaps-audit.md` | Créer des sous-registres dédiés après validation des besoins. |
| **P2-06** | Révocation de dérogation absente de l'UI ; transfert `owner` non implémenté. | Administration des droits incomplète. | `permissions-matrix.md` | Ajouter l'écran et la procédure de transfert. |
| **P2-07** | Pas de recherche transverse ni de modèles inter-dossiers. | Productivité cabinet limitée. | `navigation.ts`, `cabinet/routes.ts` | Recherche globale et modèles versionnés. |
| **P2-08** | Métadonnées PDF à l'ancienne marque/version. | Incohérence COMPTAI. | `reports/pdf.ts`, `billing/pdf.ts`, `fixed-assets/pdf.ts` | Centraliser l'identité et la version dans un module unique. |
| **P2-09** | Pas d'OpenAPI ni d'audit d'accessibilité. | Intégration et conformité UI plus difficiles. | `roadmap.md` D-08/D-10 | Générer OpenAPI ; audit WCAG 2.1 AA. |
| **P2-10** | Chunk web de 1 238 kB. | Chargement mobile lent. | Build `vite` | Découpage par route, mesure réseau. |
| **P2-11** | Registre de sources fiscales encore majoritairement `À VÉRIFIER`. | Risque de fausse assurance. | `docs/mauritius-regulations/*` | Archiver les textes, dater les vérifications, identifier le réviseur. |
| **P2-12** | Politique de conservation/archivage non validée. | Risque de purge ou de conservation non conforme. | `financial-years/archive`, `checklist settings` | Faire fixer les durées par le cabinet et les appliquer. |
| **P2-13** | **Conversion multidevise complète des états financiers non implémentée** : une société dont la devise de présentation diffère de la devise fonctionnelle voit ses états en devise fonctionnelle, avec une mention explicite. | La présentation demandée par l'utilisateur n'est pas produite ; aucune conversion historique validée n'existe. Le risque d'affichage trompeur est toutefois neutralisé. | `reports/service.ts` (`currencyBasis`, `presentationCurrencyApplied`) ; `reports/routes.ts` ; `reports/pdf.ts` ; `Statements.tsx` ; `mission33-statements-currency.test.ts` | Ne pas convertir tant que les taux historiques, la méthode (clôture, moyenne, transaction), les arrondis et les écarts de conversion ne sont pas validés par un expert. Conserver la devise de présentation comme préférence non appliquée. Porte de sortie : règles écrites, jeu de taux historiques, tests de conversion et validation du cabinet. |

## 6. P3 — confort et finition

| ID | Écart | Impact | Preuve | Recommandation |
|---|---|---|---|---|
| **P3-01** | Écran de lancement iOS non configuré. | Rendu par défaut sur iPhone/iPad. | `mission-30-report.md` | Ajouter les images de lancement si iOS est supporté. |
| **P3-02** | Écran `Prepared` et textes hérités encore présents pour des modules désormais implémentés. | Confusion résiduelle. | `apps/web/src/pages/prepared/Prepared.tsx`, `modules.ts` | Retirer ou rediriger les routes obsolètes. |
| **P3-03** | Libellés d'export CSV et mise en page à harmoniser. | Confort de lecture. | `reports/routes.ts`, exports | Revue de libellés FR/EN. |
| **P3-04** | README : ancienne branche Pages et ancien nombre de tests. | Documentation trompeuse. | `README.md` | Mettre à jour les chiffres et la procédure de démonstration. |
| **P3-05** | Mise en page d'impression à vérifier sur formats réels. | Rendus PDF/print variables. | tests jsdom | Campagne d'impression navigateur. |

## 7. Portes de sortie avant production

Les huit portes de sortie de la mission 29 restent valables. Elles sont rattachées aux écarts
ci-dessous.

| # | Porte de sortie | Écarts liés | Preuve attendue |
|---|---|---|---|
| 1 | Validation par un cabinet mauricien | P0-05, P1-01, P1-05, P1-06, P1-13 | Rapport de revue signé, périmètre accepté. |
| 2 | Conformité MRA e-Invoicing | P0-04 | Décision de périmètre ou auto-certification et test sandbox. |
| 3 | Relevés réels anonymisés par banque | P1-04 | Corpus, taux de reconnaissance, cas bloqués documentés. |
| 4 | Test de restauration | P0-02 | Restauration complète sur base vierge, durée et intégrité. |
| 5 | Revue de sécurité indépendante | P0-03, P1-07, P1-14 | Pentest, revue d'autorisation, remédiations. |
| 6 | Test de charge | P1-09 | Volumétrie, temps de réponse, limites. |
| 7 | Recette navigateur/mobile | P1-10 | Playwright + essai physique Android/Windows. |
| 8 | Procédure d'exploitation | P1-08 | Supervision, alertes, incident, reprise. |

## 8. Décision recommandée

1. **Ne pas mettre en production** tant que P0-02 et P0-03 sont ouverts. P0-01 est neutralisé pour l'affichage, mais la conversion complète reste P2-13.
2. **Ne pas vendre la paie comme opérationnelle** tant que P0-05 et P1-06 ne sont pas clos.
3. **Ne pas vendre l'e-invoicing** tant que P0-04 n'est pas tranché ; l'écran actuel doit rester
   explicitement informatif.
4. **Ne pas présenter les états financiers comme statutaires** avant P1-01.
5. **Exécuter la recette QuickBooks** seulement après P1-03 et avec des données fictives.
6. **Faire signer les acceptations de risque** par le responsable du cabinet, avec date,
   périmètre et durée ; une acceptation de risque P0 ne doit pas être implicite.

## 9. Ce que cet audit ne demande pas

Il ne demande pas de modifier les règles métier, les taux fiscaux ou les calculs de paie dans
le cadre de la mission 32. Il demande de **décider**, **documenter** et **prioriser** avant toute
modification fonctionnelle. Toute correction devra faire l'objet d'une mission distincte, avec
tests, revue et autorisation explicite.
