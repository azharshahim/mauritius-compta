# Mission 32 — audit fonctionnel COMPTAI et préparation de la recette QuickBooks

**Date : 1er novembre 2026**
**Dépôt audité : `azharshahim/mauritius-compta`**
**Base : `main` = `05a0f53807c79d66368f427b588ebca77c095589` (fusion de la PR nº12)**
**Branche de livraison : `arena/66b27f9b-mauritius-compta`**
**Version applicative : 0.1.1**
**Nature : audit en lecture seule, sans développement fonctionnel, sans donnée réelle, sans accès MRA, sans déploiement.**

> **Conclusion immédiate.** COMPTAI possède un socle comptable réellement exécutable et
> testé : écritures, grand livre, balance, clôture, lettrage, rapprochement bancaire, achats,
> facturation, immobilisations, stocks, charges à payer et provisions. Ce socle n'est
> **pas** un logiciel de production conforme : les états financiers réglementaires complets,
> la fiscalité mauricienne, les déclarations, le paiement de la paie et l'e-invoicing MRA ne
> sont pas opérationnels. Une anomalie de devise de présentation peut produire des états
> financiers matériellement mal libellés. Aucune conformité MRA, IFRS, QuickBooks ou
> « prêt pour la production » n'est affirmée.

**Documents liés :** [couverture fonctionnelle](./comptai-functional-coverage.md) · [matrice QuickBooks](./comptai-quickbooks-test-matrix.md) · [écarts avant production](./comptai-preproduction-gaps.md)

## 1. Périmètre et méthode

L'audit couvre les huit domaines demandés : comptabilité générale, immobilisations et stocks,
facturation, banque et OCR, fiscalité mauricienne, paie et RH, états financiers, gestion du
cabinet. Il a été conduit par :

1. lecture des routes API, services, migrations SQL, écrans React et tests ;
2. lecture critique des audits et rapports antérieurs (M6, M9–M13, M15–M23, M29, M30) ;
3. exécution des suites API et web, du typecheck et du build ;
4. vérification des chemins de calcul et des exports, sans modifier le code.

Les 151 fonctionnalités inventoriées sont classées dans
[`comptai-functional-coverage.md`](comptai-functional-coverage.md). Les priorités de
préproduction sont dans [`comptai-preproduction-gaps.md`](comptai-preproduction-gaps.md). La
matrice QuickBooks est dans [`comptai-quickbooks-test-matrix.md`](comptai-quickbooks-test-matrix.md).

### 1.1 Ce que cet audit ne prouve pas

- Il ne prouve pas la conformité comptable, fiscale, IFRS ou MRA.
- Il ne remplace ni une revue d'expert-comptable mauricien, ni un avis juridique, ni un test
  d'intrusion, ni un test de restauration, ni un test de charge.
- Il n'a traité aucune facture, aucun relevé bancaire et aucune donnée de paie réels.
- Il n'a pas exécuté les tests sur PostgreSQL réel, ni les tests Playwright, ni un appareil
  Android ou Windows physique.
- Il n'a effectué aucun import ou export QuickBooks réel.

## 2. Résultat d'ensemble

### 2.1 Répartition des 151 fonctionnalités

| Statut | Nombre | Part |
|---|---:|---:|
| Implémentée et testée | 91 | 60,3 % |
| Implémentée mais partiellement testée | 10 | 6,6 % |
| Partiellement implémentée | 11 | 7,3 % |
| Simulation uniquement | 5 | 3,3 % |
| Absente | 30 | 19,9 % |
| Bloquée par une validation réglementaire | 4 | 2,6 % |

Cette répartition ne signifie pas que 60 % du logiciel est « prêt pour la production » : une
fonctionnalité correctement testée au niveau API peut manquer d'export, de contrôle de
production, de validation professionnelle ou de test réel.

### 2.2 Modules réellement opérationnels

| Domaine | Niveau réel | Ce qui fonctionne | Ce qui manque ou bloque |
|---|---|---|---|
| **Comptabilité générale** | **Opérationnel avec réserves** | Plan comptable, journaux, écritures, numérotation, équilibre, verrouillage, contrepassation, grand livre, balance, lettrage, clôture, capitaux propres, ouverture, ajustements antérieurs, charges à payer et provisions | Devise de présentation non convertie ; états financiers incomplets ; comptes d'attente, emprunts, comptes courants et consolidation absents ; exports de production non finalisés. |
| **Immobilisations et stocks** | **Opérationnel avec réserves** | Registre, catégories, acquisition, mise en service, amortissement linéaire/dégressif, prorata, révision, suspension, dépréciation, cession, sept états, FIFO, coût moyen, inventaires, dépréciations, rapprochements | **Capital allowances fiscales absentes** ; composants et réévaluation absents ; ponts achats/facturation sans bouton ; pas de PDF serveur pour les stocks. |
| **Facturation** | **Opérationnel commercialement, non conforme fiscalement** | Clients, articles, devis, factures, avoirs, paiements partiels, trop-perçus, balance âgée, PDF, taux datés et vérifiés, devises, doublons | Transfert comptable non automatique ; pas d'export de balance âgée client ; pas de déclaration TVA ; **e-invoicing MRA non intégré** ; PDF non certifié. |
| **Banque et OCR** | **Opérationnel sur fixtures, non validé en production** | CSV/TSV/XLSX, PDF MCB et PDF générique prudent, OCR réel, anti-doublons, continuité des soldes, propositions explicables, rapprochement n↔1 et 1↔n, validation humaine | Aucun relevé ou facture réels ; OCR non calibré ; PDF scanné de tableau non fiable ; OFX/QFX et connexion directe absents ; multi-factures non séparé. |
| **Fiscalité mauricienne** | **Très partiel** | Taux de TVA configurables, datés, sourcés et vérifiés ; calcul de TVA ventes/achats ; quatre traitements distincts ; garde-fous contre les taux inventés | Déclaration TVA absente ; **impôt sur les sociétés absent** ; régimes particuliers, TDS et calendrier fiscal absents ; e-invoicing uniquement informatif. |
| **Paie et RH** | **Moteur de simulation, pas de paie** | Salariés, contrats, temps, congés, variables, périodes, PAYE, EDF, CSG, NSF, Training Levy, AR 2026, bulletins de simulation, transfert comptable contrôlé | **Net payable vide, bulletin final bloqué, aucun paiement** ; déclarations MRA internes seulement ; secteur public bloqué ; provisions de congés absentes ; validation experte attendue. |
| **États financiers** | **États de gestion seulement** | Bilan provisoire équilibré, compte de résultat provisoire, balance, grand livre, état des capitaux propres, exports CSV/PDF | **Pas de tableau de flux de trésorerie, pas de notes annexes, pas de comparatif N-1**, classement courant/non courant non présenté, pas d'export XLSX, pas de version signée. |
| **Gestion du cabinet** | **Opérationnel** | Multi-sociétés, exercices, collaborateurs, permissions, séparation paie/comptabilité, dossiers, archivage, tâches, échéances, documents, audit append-only | Pas de MFA/SSO, pas de réinitialisation de mot de passe, pas de recherche transverse, pas de sauvegarde/restauration testée, pas de supervision. |

## 3. Constats par domaine

### A. Comptabilité générale

Le cœur est le point fort du produit. Le moteur d'écritures est unique et réutilisé par les
modules ; les contrôles d'équilibre, de période, de compte, de société et de référence sont
présents à l'API et renforcés par des triggers SQL. Les tests `entries.test.ts` (12 cas),
`regressions.test.ts` (17 cas) et `reports.test.ts` (10 cas) couvrent l'essentiel du cycle.

Les fonctions avancées livrées ensuite sont également réelles : lettrage partiel et multiple
(`lettering.test.ts`, 29 passés), charges à payer et provisions (`mission22.test.ts`, 13 cas),
clôture et affectation (`equity.test.ts`, 7 cas), ouverture et ajustements antérieurs
(`financial-years.test.ts`, 5 cas), écarts de change réalisés (`fx.test.ts`, 35 cas).

**Réserves majeures** : la devise de présentation n'est pas convertie (voir P0-01) ; les états
financiers ne présentent pas les regroupements pourtant stockés dans `fs_mapping` ; le
rapprochement des comptes auxiliaires clients/fournisseurs avec les comptes collectifs du grand
livre n'est pas automatisé ; les comptes d'attente, emprunts, comptes courants d'associés et la
consolidation sont absents.

### B. Immobilisations et stocks

Le module immobilisations est complet pour le modèle du coût : registre, catégories,
acquisition, mise en service, amortissement linéaire et dégressif, prorata calendaire, valeur
résiduelle, révision prospective, suspension/reprise, dépréciation, cession et sept états. Les
tests `fixed-assets.test.ts` (9 cas) et `fixed-assets-depreciation.test.ts` (8 cas) couvrent
les calculs et les contrôles de période.

Le module stocks est également réel : FIFO par lots, coût moyen pondéré, emplacements,
mouvements, transferts, inventaires physiques, dépréciations et rapprochement du sous-registre
au grand livre (`mission22.test.ts`).

**Ce qui manque** : aucune **capital allowance** fiscale, aucun pool, aucun taux fiscal ; les
ponts depuis les achats et la facturation existent au niveau API mais pas dans l'écran ; les
coûts accessoires, réceptions partielles, numéros de série et dates de péremption ne sont pas
gérés ; les états de stock ne disposent pas d'un PDF serveur.

### C. Facturation

Le cycle commercial est opérationnel : clients, doublons, articles, devis, conversion,
factures, numérotation atomique, verrouillage à l'émission, avoirs, paiements partiels,
trop-perçus, annulation, balance âgée, retards, PDF serveur et détection de doublons. Les 17
tests de `billing.test.ts` couvrent les contrôles de montants, de quantités, de devises et de
permissions.

La TVA est configurable, jamais inventée : aucun taux n'est seedé, un taux `standard` doit être
vérifié, daté et applicable, et les quatre traitements sont distincts. La « vérification » est
toutefois une confirmation d'administrateur avec une source libre, pas la preuve de
l'intervention d'un expert qualifié.

**Ce qui manque** : le transfert vers la comptabilité n'est pas automatique — c'est une
proposition déterministe, une validation humaine puis une comptabilisation distincte. Il n'y a
ni export de balance âgée client, ni déclaration TVA, ni relance, ni facture récurrente. La
mention de démonstration reste sur tous les PDF.

### D. Banque et OCR

Le module bancaire dépasse le simple import : CSV, TSV, XLSX et PDF (MCB dédié ou générique
prudent), empreinte de fichier, empreinte de ligne, continuité des soldes, contrôle de devise,
propositions explicables, acceptation/rejet humain et rapprochement partiel ou multiple. Les
tests `bank.test.ts` (28 cas) et `bank-billing.test.ts` (18 cas) sont solides.

L'OCR est réel (Tesseract local), pas simulé. Les tests `mission23.test.ts` et
`mission29.test.ts` exercent l'extraction de PDF texte, d'image et de PDF scanné, ainsi que la
confiance par champ et la ré-extraction auditée.

**Ce qui manque pour la production** : aucun corpus réel anonymisé, aucune calibration
statistique, aucune mesure de faux positifs. Le lecteur PDF générique refuse les mises en page
ambiguës, mais aucun format SBM, Absa ou MauBank n'est certifié. Les PDF multi-factures sont
détectés mais non séparés. OFX/QFX et les connexions bancaires directes sont absents.

### E. Fiscalité mauricienne

La seule brique fiscale réellement opérationnelle est la **TVA configurable** : taux datés,
sourcés, vérifiés, historisés, calculés sur les ventes et les achats. Il n'existe en revanche
aucun état de contrôle TVA, aucune déclaration TVA, aucun export officiel, aucun calcul
d'impôt sur les sociétés, aucun acompte, aucun crédit d'impôt, aucun régime préférentiel, aucune
retenue à la source et aucun calendrier fiscal.

L'écran **MRA e-Invoicing** est explicitement informatif : il n'importe même pas le module
`api`, n'appelle aucun service et affiche des paramètres désactivés. Il ne constitue ni une
intégration, ni une simulation de transmission, ni une conformité. Les obligations et jalons
MRA doivent être tranchés avec les textes officiels et l'enregistrement éditeur ; voir la
section 5.

**Aucun taux, seuil, crédit ou règle fiscale n'a été inventé dans cet audit.**

### F. Paie et RH

La paie est le module où l'écart entre la richesse du moteur et l'usage réel est le plus grand.
Le moteur calcule des composantes statutaires datées et sourcées : PAYE cumulatif, EDF, CSG,
NSF, Training Levy, AR 2026 et bonus simulé. Les 92 tests de paie (48 + 22 + 4 + 5 + 11 + 2)
couvrent les formules, les imports, les déclarations internes, le PDF et le transfert comptable.

Mais **le net payable reste nul lorsque les règles ne sont pas validées par un expert**, la
finalisation d'un bulletin renvoie systématiquement `409 PAYROLL_PAYSLIP_FINAL_BLOCKED`, aucun
paiement n'est possible et les déclarations MRA sont des préparations internes, pas des
fichiers officiels. Le secteur public et certaines catégories sont bloqués faute de règles.

La paie ne doit donc pas être présentée comme « opérationnelle » : elle est un **moteur de
simulation et de préparation**, avec une revue experte en attente.

### G. États financiers

Le bilan provisoire s'équilibre et intègre le résultat cumulé depuis l'origine. Le compte de
résultat provisoire est calculé sur les écritures validées. La balance et le grand livre sont
corrects et exportables.

Les états réglementaires complets ne sont pas là : **aucun tableau de flux de trésorerie,
aucune note annexe, aucune comparaison N/N-1, aucune version signée ou figée**. Le mapping
`fs_mapping` existe dans le plan comptable, mais `groupBS` et `groupPL` aplatissent les groupes :
les sous-totaux courant/non courant et coût des ventes ne sont pas présentés. Les exports sont
estampillés « DOCUMENT DE DÉMONSTRATION ».

### H. Gestion du cabinet

Le cabinet est opérationnel pour un usage interne : portefeuille, dossiers, rôles, dérogations
par module, séparation paie/comptabilité, archivage en lecture seule, tâches, échéances,
commentaires, historique et journal d'audit append-only. Les tests `cabinet.test.ts` couvrent le
cycle de vie des tâches, l'agrégation du tableau de bord et l'isolation.

Les manques sont ceux d'une version 0.1.1 : pas de MFA/SSO, pas de réinitialisation de mot de
passe, pas de recherche transverse, pas de modèles inter-dossiers, pas de sauvegarde/restauration
testée, pas d'export complet d'un dossier, pas de supervision. La révocation d'une dérogation
est possible par l'API mais pas dans l'écran Collaborateurs, et le transfert de propriété
`owner` n'est pas implémenté.

## 4. Anomalies confirmées

Ces points ont été confirmés par lecture du chemin de calcul ou par comparaison code/tests. Ils
ne sont pas de simples « fonctionnalités manquantes ».

| ID | Sévérité | Anomalie | Preuve | Effet |
|---|---|---|---|---|
| **P0-01** | **P0** | **La devise de présentation n'est pas convertie.** Les montants restent en devise fonctionnelle alors que l'API, le CSV et l'écran les étiquettent dans la devise de présentation. | `reports/routes.ts` l. 179 choisit `presentation_currency` ; `computeStatements` additionne les lignes du grand livre sans taux ; `Statements.tsx` affiche `data.currency` ; `reports/pdf.ts` l. 75 affiche au contraire la devise fonctionnelle. | Un bilan ou un compte de résultat peut être lu en EUR alors que les montants sont en MUR. C'est une erreur de présentation matérielle, conditionnée à une devise de présentation différente de la devise fonctionnelle. |
| **P1-01** | P1 | **Les groupes d'états financiers sont calculés puis aplatis.** `fs_mapping` est stocké et utilisé pour étiqueter, mais `groupBS` et `groupPL` renvoient une liste unique. | `reports/service.ts`, fonctions `groupPL`/`groupBS` ; `StatementsDto` ne contient que `assets`, `liabilities`, `equity`, sans sous-groupes. | Pas de sous-totaux courant/non courant ni coût des ventes ; comparaison QuickBooks plus difficile et présentation non conforme à un bilan usuel. |
| **P1-02** | P1 | **Les états et les principaux PDF portent une mention de démonstration** ; le bulletin de paie porte « simulation ». | `apps/api/src/i18n/index.ts` `pdf.demo` et `csv.demoNote` ; `reports/pdf.ts` ; `fixed-assets/pdf.ts` ; `billing/pdf.ts` ; `payroll/pdf.ts`. | Les documents ne peuvent pas être remis à un client comme documents de gestion définitifs, même après validation des comptes. |
| **P2-01** | P2 | **Messages de paie contradictoires.** L'API renvoie `statutoryCalculation: true`, tandis que le backend de démonstration renvoie `statutoryCalculation: false`, `paye: false`, `csg: false`, et l'outil IA affirme que le moteur statutaire « reste non implémenté ». | `payroll/service.ts` (`capabilities`), `apps/web/src/demo/payroll.ts` l. 1254, `apps/web/src/demo/runtime.ts` l. 5028, `ai/tools.ts` l. 1586-1597. | Un utilisateur ou un recetteur peut conclure à tort que la paie n'existe pas, ou inversement ne pas voir les limites réelles. |
| **P2-02** | P2 | **Documentation d'audit obsolète.** Le README annonce 358 tests et une ancienne branche Pages ; `permissions-matrix.md` annonce encore `501 NOT_IMPLEMENTED` pour la facturation et la paie ; `bank-import.md` dit le PDF non implémenté ; `accounting-gaps-audit.md` dit stocks, provisions et charges à payer absents ; `roadmap.md` est daté version 0.1.0. | Fichiers cités ; comparaison avec l'arbre `main` `05a0f53`. | Risque de fausse conclusion pendant la recette et de perte de confiance du cabinet. |
| **P2-03** | P2 | **La balance âgée client n'a pas d'export fichier**, alors que la balance fournisseur a un CSV. | `billing/routes.ts` `/billing/aging` renvoie JSON ; `Aging.tsx` n'appelle aucun `downloadExport` ; `purchases/routes.ts` `/purchases/aging.csv`. | QuickBooks AR Aging ne peut pas être préparé par export direct. |
| **P2-04** | P2 | **La « vérification » d'un taux de TVA est une auto-déclaration admin.** | `billing/routes.ts` `verify` exige `admin`, une source libre et `confirm: true`, puis écrit `verified=true`. | La piste d'audit est bonne, mais elle ne prouve pas qu'un professionnel qualifié a validé le taux. |
| **P3-01** | P3 | **Métadonnées PDF à l'ancienne marque et ancienne version.** | `reports/pdf.ts` « Mauritius Compta 0.1.0 — demo » ; `billing/pdf.ts` « Mauritius Compta » ; `fixed-assets/pdf.ts` idem. | Incohérence de marque COMPTAI et de version dans les documents générés. |

## 5. Veille réglementaire utilisée et points à faire vérifier

Les sources ci-dessous proviennent du dossier de veille et des pages publiques MRA consultées
pour les missions 25, 29 et 32. Elles doivent être revérifiées avant toute demande officielle ;
aucune n'a fait l'objet d'une confirmation écrite de la MRA.

| Sujet | Référence / date | Ce qui est retenu | Statut dans COMPTAI |
|---|---|---|---|
| Facturation électronique | *The Value Added Tax (e-Invoicing) Regulations 2023*, Government Notice nº 132 de 2023, faite le 18/09/2023, en vigueur le **02/10/2023** | Obligations des opérateurs EBS, enregistrement éditeur, IFP, IRN/QR, facture fiscale, rôles et sanctions | Écran informatif seulement ; aucune intégration. |
| Spécifications techniques | *Functional Specifications of the Electronic Billing System*, juin 2023 | JSON, certificat/jeton, API IRN+QR, hash chaîné, séquence, mode hors ligne, stockage inviolable | Non implémenté. |
| Guide technique | *Technical Guidelines — MRA e-Invoicing*, 2023 | MRAID, sandbox, deux API, jeton d'un jour, AES-256 | Non implémenté ; aucun compte sandbox. |
| Guide éditeur | *General e-Invoicing Guide for Software Developers*, v1.0, 21/06/2023 | Parcours d'auto-certification ; la MRA n'est pas un organisme de certification | Non commencé. |
| Page MRA e-Invoicing | Page consultée le 01/11/2026 | Quatre jalons LTD/MSTD affichés « Launched » : >100 M au 15/05/2024, >100 M au 01/08/2025, >80 M au 30/06/2026, >40 M au 01/09/2026 ; notification possible au titre de la section 20A(2) VAT Act | Aucune intégration ; applicabilité de chaque client à vérifier. |
| Liste des fournisseurs EBS | Liste « as at 16 September 2026 » | Liste indicative d'éditeurs auto-certifiés ; Mauritius Compta/COMPTAI n'y figure pas | Enregistrement éditeur distinct à obtenir. |
| Modèle de facture | *Standard e-Invoice Template* | Champs obligatoires/conditionnels, B2B/B2G/B2C, MUR pour devises étrangères | Non implémenté. |
| **Contradiction à trancher** | Règlement 10(2)(o) vs note du modèle standard | Le règlement exige IRN et QR sur la facture fiscale ; la note du modèle indique que l'IRN ne doit pas apparaître sur la facture client | **À VÉRIFIER avant toute conception d'impression.** |
| TVA | `docs/mauritius-regulations/vat.md` | Taux, exonérations, seuils et dates restent `À VÉRIFIER` | Aucun taux par défaut ; configuration seulement. |
| Impôt sur les sociétés | `docs/mauritius-regulations/corporate-tax.md` | Taux, régimes, crédits, acomptes, pertes et TDS restent `À VÉRIFIER` | Aucun calcul, aucune déclaration. |
| Paie | `docs/regulatory-sources-register.md`, `payroll/service.ts` | Règles 2026/27 datées et sourcées ; revue experte unique en attente | Moteur de simulation ; finalisation bloquée. |

**Conséquence** : COMPTAI ne doit pas être présenté comme certifié, homologué ou conforme. Les
seuls éléments fiscaux que le produit peut revendiquer sont des **garde-fous** : aucun taux
n'est prérempli, un taux standard non vérifié bloque l'émission, les quatre traitements TVA sont
distincts, et l'e-invoicing est explicitement désactivé.

## 6. Tests exécutés et résultats

| Vérification | Résultat |
|---|---|
| API — `npm run test -w @mc/api` | **503 tests : 492 réussis, 11 ignorés, 0 échec**, 33 fichiers |
| Web — `npm run test -w @mc/web` | **287 réussis, 0 échec**, 44 fichiers |
| Total | **779 réussis, 11 ignorés, 0 échec** sur 790 |
| Typecheck — `npm run typecheck` | **0 erreur** (API + web + tests) |
| Build — `npm run build` | **succès** ; chunk web 1 238 kB (307 kB gzip) |
| PostgreSQL réel | **non exécuté** : 10 tests de concurrence et 1 test de lettrage ignorés faute de `TEST_DATABASE_URL` |
| Playwright / navigateur | **non exécuté** : aucun binaire Chromium ni appareil physique |

Les 11 tests ignorés ne sont pas des réussites. Ils portent notamment sur la numérotation
parallèle, la double contrepassation, deux rapprochements bancaires concurrents et le lettrage
concurrent.

## 7. Écarts de préparation QuickBooks

Le détail des 12 exports et des scénarios est dans
[`comptai-quickbooks-test-matrix.md`](comptai-quickbooks-test-matrix.md). Les écarts structurants
sont :

1. **Plan comptable** : personnalisable, mais aucun export CSV/XLSX au format d'import
   QuickBooks.
2. **Journal Report** : les écritures existent, mais aucun état de journal exportable n'est
   exposé.
3. **AR Aging** : calculé et affiché, mais sans export fichier.
4. **Balance âgée fournisseur** : export CSV disponible.
5. **Bilan et compte de résultat** : exports CSV/PDF, mais sans comparatif N-1, notes ni
   sous-totaux de classement.
6. **Flux de trésorerie** : absent.
7. **Registre des immobilisations** : export CSV/PDF disponible.
8. **Valorisation des stocks** : export CSV disponible.
9. **Rapprochement bancaire** : rapport CSV disponible.
10. **TVA** : aucun état de déclaration ; seuls des taux et des calculs de facture.
11. **Paie** : journal de paie interne possible, mais aucune paie finale ni paiement.
12. **Devise** : les états multi-devises ne sont pas convertis en devise de présentation.

## 8. Priorités recommandées

Les priorités détaillées, impacts et portes de sortie sont dans
[`comptai-preproduction-gaps.md`](comptai-preproduction-gaps.md). Ordre recommandé :

1. **Corriger ou bloquer la devise de présentation** avant toute utilisation réelle (P0-01).
2. **Décider le périmètre réglementaire** : TVA, CIT, e-invoicing, paie. Tant que la décision
   n'est pas prise, ne pas vendre ces modules comme conformes.
3. **Sécuriser l'exploitation** : sauvegarde/restauration testée, supervision, revue de
   sécurité indépendante, MFA, rotation des secrets.
4. **Compléter les états financiers** : flux de trésorerie, notes, comparatifs, classement
   courant/non courant, version signée.
5. **Préparer les exports QuickBooks** : plan comptable, journal, AR Aging, XLSX, pack de
   recette.
6. **Valider les corpus réels** : factures et relevés bancaires anonymisés, calibration OCR,
   tests par banque.
7. **Faire valider la paie** par un expert avant toute finalisation ou paiement.
8. **Rafraîchir la documentation** pour supprimer les affirmations obsolètes.

## 9. Livraison et décision demandée

La branche `arena/66b27f9b-mauritius-compta` contient uniquement les quatre documents d'audit.
Aucun code fonctionnel, aucune règle métier, aucun taux fiscal, aucun calcul de paie n'a été
modifié. Aucune fusion, aucun déploiement, aucune publication et aucune donnée réelle ne sont
inclus.

**Décision demandée avant toute suite** : autoriser la revue des quatre livrables, puis
prioriser les corrections P0/P1. Toute modification fonctionnelle, tout enregistrement MRA et
toute fusion restent soumis à un accord explicite.
