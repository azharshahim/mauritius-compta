# Rapport mission nº16 — règles 2026/27, moteur, bulletin et démonstration

Date : 31 octobre 2026. Branche : `arena/b0b62798-mauritius-compta`. PR nº1 : ouverte, **brouillon**, non fusionnée.
**Aucune conformité MRA, PAYE, CSG ou NSF n’est affirmée. Aucun calcul n’est validé pour un paiement réel. Toutes les sociétés, personnes et coordonnées sont fictives.**

## 1. Périmètre livré

| Élément | État |
|---|---|
| Versions datées des règles 2026/27 | Ajoutées, statut `RESEARCHED` |
| Moteur PAYE cumulatif 2026/27 | Étendu sans remplacer l’architecture mission 15 |
| CSG / NSF / Training Levy octobre 2026 | Calculés avec les versions datées 2026/27 |
| AR 2026 | Appliquée jusqu’au 31/12/2026 par le moteur existant |
| Société et salarié de démonstration | *Mauritius Demo Services Ltd (DEMO)* et *Daniel Morel*, données fictives |
| Calcul complet octobre 2026 | Exécuté par le moteur réel, test API et démo |
| Nouveau bulletin PDF | Réécrit : plus de filigrane central, pied de page bilingue discret |
| Démonstration Pages | Scénario ajouté ; **aucun PDF serveur en démo**, vue imprimable uniquement |
| Validation professionnelle | **Toujours en attente** ; net à payer `null`, finalisation bloquée |

## 2. Sources utilisées

Sources primaires :

- **Employee Declaration Form 2026/27** — https://www.mra.mu/download/EDFForm.pdf — période 01/07/2026 → 30/06/2027, barème indicatif 0 % / 10 % / 20 % / 35 %, reliefs annuels.
- **Communiqué MRA du 5 août 2026** — https://www.mra.mu/download/Com_EDF2627.pdf — PAYE 2026/27 calculée sur l’EDF 2026/27.
- **Finance Act 2026 (Act No. 14 of 2026)** — https://www.mra.mu/download/FinanceAct2026.pdf — assent 12/08/2026. Les sections 7, 18 et 28 **n’ont pas été lues verbatim** dans les extraits disponibles ; le barème est donc codé avec une réserve explicite.
- **MRA — NPF/NSF Contributions and Training Levy** — https://www.mra.mu/employers/npf-nsf-contributions — plafonds NSF au 01/07/2026, taux 1 % / 2,5 %, levy 1,5 %.
- **MRA — CSG** — https://mra.mu/index.php/business/csg — taux 1,5 % / 3 % et 3 % / 6 % au seuil de Rs 50 000.
- **Additional Remuneration (2026) Regulations, GN No. 7 of 2026** — AR Rs 635 / 17 110 / 3,7 %, plafond Rs 635.

Sources secondaires de recoupement : communiqué de presse EDF 2026-2027, pages budget 2026/27, KPMG Finance Bill 2026 / TaxNewsFlash 18/08/2026, Ramco (remplacement de la FSC individuelle par la bande 35 %).

**Limites de recherche** :

- aucune table mensuelle cumulative de retenue PAYE 2026/27 localisée ⇒ `monthlyWithholdingTableVerified: false` ;
- aucune circulaire ou page MRA 2026/27 sur le PAYE **sans EDF** localisée ⇒ `noEdfRuleAvailable: false` et blocage `NO_EDF_RULE_NOT_VERIFIED_FOR_PERIOD` ;
- les sections du Finance Act 2026 relatives au barème ne sont pas lues verbatim ⇒ revue professionnelle requise ;
- aucun texte officiel sur l’arrondi CSG/NSF/levy ⇒ calcul exact à 4 décimales, revue requise.

## 3. Règles codées

### PAYE 2026/27

- Version datée `effective_from = 2026-07-01`, `effective_to = 2027-06-30`.
- Bandes annuelles : 0 % jusqu’à 500 000 ; 10 % de 500 000 à 1 000 000 ; 20 % de 1 000 000 à 12 000 000 ; 35 % au-delà de 12 000 000.
- Calcul cumulatif sur les émoluments imposables, moins les reliefs EDF cumulés, avec retenues antérieures et périodes écoulées.
- `fscApplicable: false`, `noEdfRuleAvailable: false`, `monthlyWithholdingTableVerified: false`.
- La version 2025/26 est close au **30/06/2026** ; l’historique n’est pas réécrit.
- Une période après le 30/06/2027 reste bloquée : aucun taux n’est reporté silencieusement.

### Autres règles

- CSG privée inchangée : ≤ 50 000 → 1,5 % salarié / 3 % employeur ; > 50 000 → 3 % / 6 %.
- NSF : 1 % salarié / 2,5 % employeur ; plafond mensuel **29 710** au 01/07/2026.
- Training Levy : 1,5 % employeur, sans plafond.
- AR 2026 : version datée close au 31/12/2026, selon GN No. 7 de 2026.

## 4. Calcul de référence — octobre 2026

Société fictive *Mauritius Demo Services Ltd (DEMO)*, salarié fictif *Daniel Morel* (`MDS001`), contrat permanent à temps plein, Rs 30 000/mois, date de naissance fictive, EDF 0 dépendant, aucune absence, prime, heure supplémentaire ni avance.

| Élément | Montant (MUR) | Base / règle |
|---|---:|---|
| Salaire de base | 30 000,0000 | Contrat |
| Rémunération additionnelle 2026 | 635,0000 | GN No. 7 de 2026, version AR 2026 |
| **Salaire brut** | **30 635,0000** | Base + AR |
| PAYE retenu | 0,0000 | Cumul EDF 2026/27, 1 période écoulée |
| CSG salarié | 459,5250 | 1,5 % de l’assiette AR incluse |
| NSF salarié | 297,1000 | 1 % sous plafond |
| **Net après cotisations statutaires** | **29 878,3750** | Arithmétique exacte |
| CSG employeur | 919,0500 | 3 % de l’assiette |
| NSF employeur | 742,7500 | 2,5 % sous plafond |
| Training Levy | 459,5250 | 1,5 % sans plafond |
| **Coût employeur** | **32 756,3250** | Brut + contributions |
| **Net à payer** | **NON CALCULÉ** | Règles non approuvées |

Statut : `expert_review_pending`. `missing_rules: []`. Le calcul est complet au sens des règles disponibles, mais **non approuvé**.

Contrôle cumulatif : 12 périodes à 15 000 000 de cumul donnent 3 300 000 de taxe avec les bandes 0/10/20/35.

## 5. Bulletin PDF

`apps/api/src/modules/payroll/pdf.ts` a été réécrit :

- **suppression du grand filigrane central** ;
- en-tête société avec adresse, activité, contacts et BRN fictifs ;
- cartes identité salarié (matricule, fonction, contrat, compte masqué) et période (début, fin, paiement, devise, référence de calcul) ;
- tableaux Rémunérations, Retenues, Position nette, Contributions employeur, Règles et traçabilité ;
- montants calculés en BigInt, sans conversion flottante ; affichage exact avec au moins deux décimales (trois ou quatre lorsqu’un demi-centime existe) ;
- « NON CALCULÉ / NOT CALCULATED » quand une valeur est nulle ;
- pied de page discret bilingue sur chaque page :
  **« SIMULATION — NON VALIDÉ POUR PAIEMENT » / « SIMULATION — NOT VALIDATED FOR PAYMENT »** ;
- mention « Document de démonstration fictif… » ;
- pagination et référence du bulletin.

Vérifié par rendu réel : une page pour le scénario Daniel Morel, texte français et anglais, totaux exacts. Le test `payroll-pdf.test.ts` vérifie aussi une seule page.

## 6. Démonstration GitHub Pages

- La société *Mauritius Demo Services Ltd (DEMO)* est ajoutée aux sociétés fictives, avec adresse et activité fictives.
- Un salarié `MDS001` Daniel Morel, un contrat, une EDF, six règles datées et la période 10/2026 sont ajoutés à l’état de démonstration.
- Le calcul est effectué par la logique du moteur de démonstration, avec les mêmes règles datées et le même cumul EDF.
- Le bulletin est généré dans l’état de démonstration (`SIM-202610-0001`), avec les montants du tableau ci-dessus et `netPayable: null`.
- Le bouton **Vue imprimable / PDF navigateur** ouvre l’impression ; un message explicite indique qu’**aucun PDF n’est généré par un serveur** et que le document reste une simulation.
- Le bandeau de démonstration et l’identification « DEMO » ne sont jamais masqués.

## 7. Tests exécutés

| Suite | Résultat |
|---|---|
| `apps/api/tests/payroll.test.ts` | 48 ✅ |
| `apps/api/tests/payroll-statutory.test.ts` | 22 ✅ |
| `apps/api/tests/payroll-2026-27.test.ts` | 4 ✅ |
| `apps/api/tests/payroll-pdf.test.ts` | 2 ✅ |
| `apps/web/tests/demo-payroll.test.ts` | 12 ✅ |
| Suite web complète | 184 ✅ après mise à jour du compteur de dossiers fictifs |
| `tsc` API et web | ✅ |

Non exécuté localement : PostgreSQL réel (couvert par la CI `postgres-tests`), Samsung Android physique, Chrome réel, lecteur d’écran. Aucun de ces points n’est présenté comme vérifié.

## 8. Points ouverts pour la revue professionnelle unique

1. Lire verbatim les sections 7, 18 et 28 du Finance Act 2026 et confirmer le barème 2026/27.
2. Obtenir la table mensuelle cumulative de retenue PAYE 2026/27 (`monthlyWithholdingTableVerified` reste `false`).
3. Confirmer le traitement du 13e mois / bonus dans le cumul et l’interaction avec la bande 35 %.
4. Confirmer le remplacement de la FSC individuelle par la bande 35 % en 2026/27.
5. Confirmer qu’aucune règle PAYE sans EDF n’est publiée pour 2026/27 ; à défaut, le moteur continue de bloquer.
6. Confirmer l’arrondi légal CSG / NSF / Training Levy (aucun texte trouvé).
7. Confirmer l’applicabilité de l’AR 2026 aux cas atypiques et le barème au rendement.
8. Confirmer la spécification du Joint Monthly Return avant toute génération « prête à soumettre ».

## 9. Conclusion

La mission 16 ajoute les règles datées 2026/27, un calcul complet octobre 2026 par le moteur réel, un bulletin professionnel sans filigrane central et un parcours de démonstration testable sur Windows et Android. **Les calculs et documents restent des simulations non validées pour paiement.** La PR nº1 reste ouverte en brouillon et `main` n’est pas modifiée.
