# COMPTAI — matrice de recette QuickBooks

**Mission 32 — préparation de la recette fonctionnelle QuickBooks**
**Date : 1er novembre 2026**
**Base auditée : `main` = `05a0f53807c79d66368f427b588ebca77c095589`, version 0.1.1**
**Statut : document de préparation. Aucun import, export ou test QuickBooks réel n'a été exécuté.**

> **Aucune donnée client réelle.** Les scénarios ci-dessous utilisent une société fictive, un
> plan comptable de démonstration et des montants volontairement omis ou symboliques. Les taux
> de TVA ne sont jamais fournis par COMPTAI : ils doivent être saisis, sourcés et vérifiés par
> le cabinet avant le test. Aucun résultat QuickBooks n'est affirmé sans exécution contradictoire.

**Documents liés :** [rapport d'audit](./mission-32-audit.md) · [couverture fonctionnelle](./comptai-functional-coverage.md) · [écarts avant production](./comptai-preproduction-gaps.md)

## 1. Objet et limites

Cette matrice prépare une recette contradictoire entre COMPTAI et QuickBooks. Elle ne remplace
pas :

- un accord écrit du cabinet sur l'édition et la version de QuickBooks utilisées ;
- un jeu de données fictif validé et figé ;
- une revue d'expert-comptable mauricien ;
- un test de conformité fiscale ou MRA.

Les libellés, emplacements de menus et exports disponibles **varient selon l'édition QuickBooks
(Online, Desktop, pays) et selon la version**. Le cabinet doit confirmer l'édition avant
d'exécuter la matrice. Les mentions « Fixed Asset Register si disponible » et « VAT Reports »
sont donc conditionnelles.

## 2. Jeu de données fictif à construire

| Élément | Contenu fictif | Pourquoi |
|---|---|---|
| Société | `M32 Recette Fictive Ltd`, BRN/TVA fictifs, MUR fonctionnel | Tester le cycle de base sans donnée réelle. |
| Société miroir | Même société dans QuickBooks, plan miroir | Comparaison à périmètre identique. |
| Exercice | Deux exercices consécutifs, mêmes dates | Comparatif N/N-1 et report à nouveau. |
| Plan comptable | Plan de démonstration COMPTAI + mapping documenté vers le plan QuickBooks | Contrôler les correspondances, pas les codes. |
| Clients/fournisseurs | Trois clients, trois fournisseurs fictifs, dont un en devise | Tester AR/AP, devises, doublons. |
| Factures | Facture standard avec TVA configurée, avoir partiel, facture en devise | Tester ventes, avoirs, change. |
| Achats | Facture fournisseur avec TVA récupérable, acompte, avoir | Tester achats et TVA déductible. |
| Banque | Relevé CSV ou XLSX fictif et un PDF fictif non réel | Tester import et rapprochement. |
| Immobilisation | Un actif amortissable, une cession fictive | Tester dotation et plus/moins-value. |
| Stock | Deux articles, entrée, sortie, inventaire | Tester FIFO/coût moyen et coût des ventes. |
| Paie | Une période de simulation complète, sans paiement | Tester le journal de paie, pas un salaire réel. |

**Règle absolue** : aucun nom, BRN, numéro de TVA, IBAN, facture, bulletin ou relevé réel ne doit
entrer dans ce jeu. Les fichiers doivent porter une mention « FICTIF — RECETTE M32 ».

## 3. Exports nécessaires

| # | Export QuickBooks | Emplacement QuickBooks à confirmer | Source COMPTAI | Format disponible dans COMPTAI | Statut de préparation |
|---|---|---|---|---|---|
| 1 | **Chart of Accounts** | Comptabilité → Plan comptable → Export | `GET /companies/:id/accounts`, écran `Accounts.tsx` | JSON API + écran ; **aucun CSV/XLSX d'export** | **À construire** : export tabulaire avec code, libellé, type, sens, actif, mapping. |
| 2 | **Trial Balance** | Rapports → Balance | `GET /reports/trial-balance`, `TrialBalance.tsx` | CSV, PDF, JSON | **Prêt à tester**, à mapper sur le format QuickBooks. |
| 3 | **General Ledger** | Rapports → Grand livre | `GET /reports/ledger`, `Ledger.tsx` | CSV, PDF, JSON | **Prêt à tester**, avec contrôle des comptes et des périodes. |
| 4 | **Journal Report** | Rapports → Journal | `entries/routes.ts`, `Entries.tsx` | JSON/écran ; **aucun export de journal dédié** | **À construire** : lignes date, journal, n° d'écriture, compte, débit, crédit, référence. |
| 5 | **Balance Sheet** | Rapports → Bilan | `GET /reports/statements`, `Statements.tsx` | CSV, PDF, JSON | **Partiel** : pas de comparatif, pas de sous-totaux courant/non courant. |
| 6 | **Profit & Loss** | Rapports → Compte de résultat | même route | CSV, PDF, JSON | **Partiel** : pas de comparatif, pas de sous-total coût des ventes. |
| 7 | **AR Aging** | Rapports → Balance âgée clients | `GET /billing/aging`, `Aging.tsx` | JSON + écran ; **aucun export fichier** | **À construire** : CSV/PDF par client, devise et tranche. |
| 8 | **AP Aging** | Rapports → Balance âgée fournisseurs | `GET /purchases/aging.csv` | CSV + écran | **Prêt à tester**. |
| 9 | **Bank Reconciliation** | Banque → Rapprochement | `GET /bank/reconciliation-report.csv` | CSV + écran | **Prêt à tester** avec un relevé fictif. |
| 10 | **Inventory Valuation** | Rapports → Valorisation du stock | `GET /inventory/report.csv` | CSV + écran | **Prêt à tester** ; PDF serveur absent. |
| 11 | **Fixed Asset Register** (si disponible) | Rapports → Immobilisations | `GET /fixed-assets/reports/register` | CSV, PDF, JSON | **Prêt à tester** ; disponibilité à confirmer dans l'édition QuickBooks. |
| 12 | **VAT Reports** | Taxes → Rapports de TVA | Aucun état de déclaration | **Aucun** | **Non couvrable en l'état** : seuls les taux et les calculs de facture existent. |
| 13 | **Payroll Journal** (optionnel) | Journal / Paie | `payroll/accounting-transfers/:id/csv` | CSV interne | **Bloqué** : paie de simulation, sans bulletin final ni paiement. |
| 14 | **Audit Log** (optionnel) | Historique d'audit QuickBooks | `GET /audit` | JSON | **Partiel** : journal append-only, pas d'export de journal comptable. |

## 4. Matrice à huit colonnes

**Légende des statuts** : `PRÊT À TESTER` = chemin exécutable avec données fictives ;
`PARTIEL` = une partie du résultat ne peut pas être comparée ou exportée ;
`NON COUVRABLE` = fonctionnalité absente ; `BLOQUÉ` = usage réel empêché par une validation
réglementaire ou une finalisation non autorisée.

| Scénario | Données d'entrée | Résultat attendu QuickBooks | Résultat COMPTAI | Écart | Justification | Statut | Validation expert-comptable |
|---|---|---|---|---|---|---|---|
| **QB-01 Plan comptable et balance d'ouverture** | Plan fictif mappé ; balance d'ouverture équilibrée ; deux exercices | Tous les comptes avec le même type et le même classement ; balance d'ouverture équilibrée ; report à nouveau correct | Plan personnalisable, import cabinet, batch d'ouverture avec aperçu/approbation/comptabilisation ; **aucun export de plan** | Export manuel à produire ; classement courant/non courant non présenté | Le plan COMPTAI est volontairement provisoire et non officiel ; le mapping QuickBooks reste à documenter | **PARTIEL** | ☐ valider le mapping ; ☐ valider les soldes d'ouverture ; ☐ signer la correspondance des comptes |
| **QB-02 Écriture manuelle équilibrée** | Écriture fictive à deux ou trois lignes, date, journal, référence | Écriture visible au journal, mêmes comptes, mêmes montants, même date ; balance équilibrée | Écriture brouillon puis validée ; numérotation atomique ; grand livre et balance recalculés ; export GL/TB | Pas d'export **Journal Report** dédié | Les écritures existent, mais le rapport de journal n'est pas exposé en fichier | **PARTIEL** | ☐ vérifier date, journal, référence ; ☐ vérifier l'absence de doublon |
| **QB-03 Facture client avec TVA** | Facture fictive, client fictif, taux de TVA **saisi et vérifié par le cabinet**, aucune valeur par défaut | Facture, ligne de TVA, créance client, compte de TVA ; numéro et date identiques | Facture émise avec numérotation, PDF serveur, calcul TVA, proposition comptable puis validation humaine | Pas de comptabilisation automatique ; PDF de démonstration ; pas d'e-invoicing | La validation humaine est un choix de gouvernance ; le PDF n'est pas certifié MRA | **PARTIEL** | ☐ confirmer le taux et sa date ; ☐ vérifier la base HT/TVA/TTC ; ☐ vérifier le compte de TVA |
| **QB-04 Avoir partiel** | Avoir fictif lié à la facture QB-03, quantité et montant partiels | Avoir appliqué à la facture ; créance et TVA réduites ; historique conservé | Avoir avec facture d'origine obligatoire, contrôle du restant, proposition de contrepassation | Pas de contrepassation automatique ; pas d'export TVA | Le contrôle du restant est réel, la transmission comptable reste humaine | **PARTIEL** | ☐ vérifier le restant créditable ; ☐ vérifier le traitement TVA de l'avoir |
| **QB-05 Paiement partiel et AR Aging** | Facture fictive de 100 unités, paiement partiel de 30 unités, date d'arrêté | QuickBooks affiche 70 restants et la tranche d'âge correcte | Paiement partiel, solde dû, balance âgée par client/devise ; **pas d'export AR Aging** | Export AR Aging absent ; pas de PDF | L'écran existe, mais le fichier de recette manque | **PARTIEL** | ☐ vérifier le solde et la tranche ; ☐ valider le format d'export à construire |
| **QB-06 Facture fournisseur, TVA et AP Aging** | Facture fournisseur fictive avec TVA récupérable explicite ; paiement partiel | Facture, TVA déductible, dette fournisseur, balance âgée fournisseur, paiement partiel | Module achats, TVA explicite, paiement partiel, aging CSV, comptabilisation après validation | Pas de comptabilisation automatique ; pas de PDF fournisseur normalisé | Le cycle achats est réel ; la transmission au grand livre reste une proposition | **PARTIEL** | ☐ vérifier la TVA déductible ; ☐ vérifier le solde fournisseur ; ☐ signer l'aging |
| **QB-07 Rapprochement bancaire** | Relevé fictif CSV/XLSX ; deux règlements dont un partiel ; une opération non rapprochée | QuickBooks présente les opérations rapprochées, le solde banque et l'écart | Import, anti-doublons, contrôle des soldes, propositions, validation humaine, rapport CSV | Aucun relevé réel ; pas de test sur format SBM/Absa/MauBank | Le module est probant sur fixtures, pas certifié par banque | **PARTIEL** | ☐ vérifier le solde de départ et de clôture ; ☐ vérifier chaque rapprochement ; ☐ signer l'écart |
| **QB-08 Immobilisation, dotation et cession** | Actif fictif au coût et à la durée fournis ; cession en cours d'exercice ; **aucun taux fiscal** | QuickBooks présente l'actif, la dotation, l'amortissement cumulé, la VNC et le résultat de cession | Registre, dotation linéaire/dégressive, prorata, cession ; états CSV/PDF ; **capital allowances absentes** | Pas de registre fiscal ni de pool ; export QuickBooks non mappé | Le module est comptable, pas fiscal ; la capital allowance est explicitement hors périmètre | **PARTIEL** | ☐ valider la durée et la méthode ; ☐ vérifier la VNC ; ☐ confirmer que le volet fiscal est hors test |
| **QB-09 Stock, valorisation et coût des ventes** | Stock d'ouverture, achat, vente, inventaire physique fictifs | QuickBooks présente la quantité, la valorisation, le coût des ventes et la variation de stock | FIFO ou coût moyen, mouvements, inventaire, dépréciation, valorisation CSV, rapprochement GL | Pont facture → sortie de stock sans bouton dédié ; pas de PDF serveur | L'API est testée, le parcours utilisateur est incomplet | **PARTIEL** | ☐ valider la méthode ; ☐ vérifier quantité et valeur ; ☐ rapprocher le compte de stock |
| **QB-10 Facture et règlement en devise** | Facture en devise avec taux explicite ; règlement à un taux différent | QuickBooks présente le montant en devise et en devise de base, puis le gain/perte de change réalisé | Facture et règlement multidevises, écart réalisé proposé et comptabilisé une fois ; réévaluation latente bloquée | Réévaluation latente et virements bloqués ; **devise de présentation non convertie** | Les écarts réalisés sont testés ; la présentation multi-devises reste à corriger | **PARTIEL** | ☐ vérifier le taux documenté ; ☐ vérifier le gain/perte ; ☐ confirmer le traitement de la réévaluation |
| **QB-11 Charge à payer et extourne** | Loyer fictif réparti sur trois périodes ; deux échéances comptabilisées | QuickBooks présente la charge, la dette et l'extourne à la période suivante | Échéancier, allocation exacte, comptabilisation à échéance, extourne motivée, rapport | Pas d'export dédié de l'échéancier | Le calcul est testé ; le format de recette reste à construire | **PARTIEL** | ☐ vérifier la période et le montant ; ☐ vérifier l'extourne ; ☐ signer le solde |
| **QB-12 Clôture et affectation du résultat** | Écriture de clôture fictive ; résultat affecté en réserve et report à nouveau | QuickBooks verrouille l'exercice, présente le résultat reporté et le comparatif | Clôture contrôlée, écriture de clôture, ouverture suivante, affectation documentée ; état des capitaux propres | Pas de comparatif N-1 ; pas d'export signé de l'état | Le cycle est réel mais la présentation réglementaire reste incomplète | **PARTIEL** | ☐ vérifier le résultat ; ☐ vérifier l'affectation ; ☐ vérifier l'exercice suivant |
| **QB-13 Bilan et compte de résultat** | Même balance que QuickBooks, même période | Bilan classé courant/non courant ; P&L avec comparatif ; notes | Bilan et P&L provisoires, équilibrés ; exports CSV/PDF ; groupes aplatis | **Écart de présentation** : pas de comparatif, pas de notes, pas de sous-totaux | Le calcul est correct, la présentation n'est pas au niveau d'un état statutaire | **PARTIEL** | ☐ valider chaque ligne ; ☐ exiger le comparatif ; ☐ vérifier la devise affichée |
| **QB-14 Déclaration de TVA** | Ventes et achats fictifs avec taux configurés et vérifiés | QuickBooks produit le résumé et le détail de TVA, la TVA due ou remboursable | Aucun état de déclaration ; seuls les taux et les calculs de documents existent | **Fonctionnalité absente** | Aucune règle de déclaration mauricienne n'est codée ni validée | **NON COUVRABLE** | ☐ décider le périmètre TVA ; ☐ fournir les textes et le format officiel |
| **QB-15 Tableau de flux de trésorerie** | Bilan, P&L et mouvements de trésorerie fictifs | QuickBooks produit un état des flux | Aucun tableau de flux | **Fonctionnalité absente** | Aucun modèle ni test ; le menu n'existe pas | **NON COUVRABLE** | ☐ choisir la méthode (directe/indirecte) ; ☐ valider le format |
| **QB-16 Journal de paie** | Période de paie fictive, calculs complets, mapping de comptes approuvé | QuickBooks présente le journal de paie : charges, retenues, cotisations, net à payer | Paie de simulation ; net payable nul ; bulletin final bloqué ; transfert comptable contrôlé, sous réserve de la validation experte | **Paie non payée, non finalisée, non déclarée** | Les règles ne sont pas validées par un expert ; aucun paiement ne doit être produit | **BLOQUÉ** | ☐ revue experte des règles ; ☐ validation du net payable ; ☐ autorisation écrite avant tout paiement |
| **QB-17 Prévention des doublons de facture** | Même référence, même montant, même fournisseur, saisi deux fois | QuickBooks signale ou bloque le doublon | Détection déterministe à trois niveaux ; confirmation explicite pour un homonyme | Aucun doublon flou ou IA ; rescanner un document peut passer pour un nouveau | La détection est déterministe et testée, mais pas une garantie absolue | **PRÊT À TESTER** | ☐ vérifier les trois niveaux ; ☐ documenter la tolérance |
| **QB-18 Journal, audit et traçabilité** | Série d'actions fictives : création, validation, comptabilisation, rejet | QuickBooks conserve l'historique et permet d'éditer le journal | Journal d'audit append-only ; historique d'événements ; **pas d'export Journal Report** | Export de journal absent ; audit non chaîné cryptographiquement | La traçabilité existe, le format de recette manque | **PARTIEL** | ☐ vérifier l'acteur et l'horodatage ; ☐ vérifier l'impossibilité de modifier ; ☐ signer le journal |

## 5. Protocole de recette

1. **Geler le périmètre** : édition QuickBooks, version, pays, exercice, plan comptable et
   méthode de valorisation.
2. **Créer le jeu fictif** dans COMPTAI et dans QuickBooks à partir de la même liste de pièces.
3. **Exporter** les 12 exports requis listés en section 3 (14 avec les deux optionnels), avec
   la même période et le même statut (écritures validées uniquement).
4. **Comparer d'abord les totaux**, puis les comptes, puis les documents, puis les dates.
5. **Documenter chaque écart** : montant, cause, caractère bloquant ou acceptable, décision.
6. **Ne jamais corriger silencieusement** une donnée pour faire coïncider les résultats.
7. **Faire signer** chaque ligne par le réviseur du cabinet, avec date et commentaire.
8. **Figer la version testée** : commit, version COMPTAI, version QuickBooks, jeu de données et
   empreintes des fichiers.

### 5.1 Tolérances proposées

- Aucune tolérance sur les montants comptables, les dates de comptabilisation, les numéros de
  pièce et l'équilibre.
- Tolérance documentée uniquement sur la présentation (ordre des lignes, libellés, largeur des
  colonnes) et sur les arrondis d'affichage, jamais sur les montants stockés.
- Tout écart de TVA, de change, de stock ou d'immobilisation est bloquant jusqu'à décision
  écrite du cabinet.

### 5.2 Critères de sortie

La recette QuickBooks ne peut être déclarée réussie que si :

- les 12 exports requis sont produits ou leur absence est formellement acceptée ;
- les scénarios QB-01 à QB-18 ont un statut signé ;
- les écarts P0/P1 sont corrigés ou acceptés par écrit ;
- la devise de présentation est identique à la devise fonctionnelle, ou la conversion est
  prouvée ;
- aucune donnée réelle n'a été utilisée ;
- le cabinet a daté et signé la matrice.

## 6. Points à faire trancher par l'expert-comptable

1. Quel plan comptable de référence et quel mapping vers QuickBooks ?
2. Quelles classes de comptes doivent être courantes ou non courantes ?
3. Quel format de balance âgée clients et fournisseurs est accepté ?
4. Quelles tolérances d'arrondi et de présentation sont admissibles ?
5. Quel traitement TVA pour les avoirs, les acomptes et les opérations exonérées ?
6. Quelle méthode de valorisation des stocks est retenue ?
7. Les capital allowances doivent-elles rester hors périmètre de la première recette ?
8. Quel niveau de preuve est exigé pour la paie avant tout paiement ?
9. Quels états doivent être signés et conservés, et pendant combien de temps ?
10. Quelles références MRA doivent être archivées avant d'ouvrir la recette fiscale ?

## 7. Conclusion

COMPTAI peut alimenter une **recette de gestion** crédible sur la comptabilité, les achats, la
facturation, les immobilisations, les stocks et le rapprochement bancaire. Il ne peut pas, en
l'état, produire un **pack QuickBooks complet** : le plan comptable, le journal, l'AR Aging et
les rapports de TVA manquent, le flux de trésorerie est absent et la paie n'est pas finalisable.
La matrice doit être exécutée avec des données fictives, puis signée ; elle ne constitue pas
une preuve de conformité.
