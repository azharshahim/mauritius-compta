# Journal des versions

## Mission 24 — Qualité FR/EN, finitions et préparation de l’agent IA (1er novembre 2026)

> PR en brouillon, aucune fusion, aucun déploiement Pages/OVH, aucune donnée réelle,
> aucun envoi, aucun bulletin réel, aucune déclaration MRA, aucune clé API exposée.
> `main` reste intact.

### Ajouté

- Glossaire comptable centralisé `apps/web/src/glossary.ts` (plan comptable, grand livre,
  balance, compte de résultat, bilan, immobilisations, régularisations, provisions,
  rapprochement bancaire, bulletin de paie, écriture).
- 1 605 clés FR et EN, 64 codes d’erreur traduits, traduction des erreurs serveur dans le
  navigateur avec repli sur le message localisé de l’API.
- Test `i18n-quality.test.ts` : parité des clés, glossaire, absence de fuite de l’autre
  langue, résolution de toutes les clés littérales utilisées.
- Version et commit de build affichés dans l’application et le bandeau de démonstration.
- Édition des catégories, emplacements et articles de stock (`PUT`), avec colonne Actions.
- Pont facture client émise → mouvements de stock proposés, avec pré-mapping SKU/référence,
  choix du journal, quantités et lien vers les mouvements. Aucun mouvement validé sans
  décision humaine.
- Carte des mappings comptables (rôle → compte actif, rôles manquants, compteur).
- Navigation OCR → écritures (`?search=`), MCB → rapprochement (`?bankAccountId=`) et
  onglets Stocks (`?tab=`).
- Gouvernance du catalogue d’outils IA : `mode`, `risk`, `requiredAccess`,
  `humanValidation`, `audit`, `companyScoped` ; bloc `governance` avec exécution désactivée.
- Feuille de route `docs/accounting-ai-agent-roadmap.md` (phases 1 à 4, paie supervisée,
  décisions professionnelles) et rapport `docs/mission-24-report.md`.
- Tests API : édition des données de stock et pont facture → stock, y compris refus d’une
  quantité supérieure à la quantité facturée.

### Modifié

- Workflow Pages : `main` devient la seule source de publication ; les PR et branches Arena
  exécutent tests et builds sans upload ni déploiement. Le build vérifie version, commit et
  écrans des missions 23–24.
- Libellés paie techniques remplacés par des libellés naturels FR/EN ; séparateurs et
  en-têtes de tableaux bancaires/devises traduits.
- Correction de la coquille « La demander » dans l’assistant.

### Non livré

- Aucun appel LLM ajouté à l’assistant (routeur toujours déterministe).
- Aucun connecteur d’envoi de bulletins, contrats ou relances.
- Aucune édition des régularisations/provisions : l’API ne l’expose pas.
- Aucune vérification sur Samsung Android physique ni Chrome Windows.

## Mission 23 — OCR natif, import bancaire MCB et plan comptable bilingue (1er novembre 2026)

> Aucune fusion, aucun déploiement, aucune donnée réelle, aucun paiement, aucune déclaration
> MRA, aucun appel à ScanPro AI. Aucun numéro de compte mauricien n’est présenté comme
> obligatoire. PR en brouillon ; `main` intact.

### Ajouté

- Migration `0021_documents_charts_mcb.sql` : profils de plan comptable, libellés FR/EN,
  `posting_allowed`, rôle comptable et code TVA optionnels, documents importés, lignes,
  propositions, affectations mémorisées. Aucun compte existant n’est renommé ni renuméroté.
- Module `documents` : import PDF/JPEG/PNG, extraction texte PDF (pdf.js), **OCR réel local**
  (Tesseract `eng+fra`, images et PDF scannés), parsing déterministe des factures, corrections,
  détection de doublons par empreinte et par numéro/tiers, propositions d’écriture équilibrées
  limitées aux comptes actifs, validation humaine créant un **brouillon** (jamais une
  comptabilisation), refus motivé, mémorisation des affectations **après approbation seulement**.
- Plan comptable : modèle mauricien provisoire explicitement `PENDING PROFESSIONAL VALIDATION`,
  import du plan du cabinet CSV/XLSX avec mapping, aperçu, détection des doublons et statut
  `AWAITING FIRM CONFIRMATION`, confirmation par le cabinet, profil société personnalisable.
- Banque : importeur MCB PDF natif (`/bank/mcb/preview`, `/bank/mcb/import`) réutilisant le
  moteur bancaire existant, descriptions multi-lignes, signes déduits du mouvement des soldes,
  contrôle d’ouverture/clôture, doublons par empreinte, aperçu et validation humaine.
  Périmètre annoncé : mise en page initiale Savings Regular Account, pas tous les formats MCB.
- Écrans **Documents → Scan & Import**, **Comptabilité → Plan comptable** enrichi et
  **Banque → Importer un relevé MCB**, FR/EN, responsive, avec agitation de fichiers et aperçu.
- Démonstration navigateur schéma 17 : deux profils de plan, six documents fictifs (deux achats,
  deux ventes, une photo, un doublon), une proposition corrigée/approuvée, un relevé MCB fictif
  équilibré. Les résultats d’OCR affichés sont **préenregistrés** et signalés comme tels.
- Tests : 13 tests API mission 23 (dont OCR réel image et PDF scanné) et 10 tests web
  (backend démo et écrans). Documentation [`docs/mission-23-report.md`](docs/mission-23-report.md).

### Dépendances ajoutées

- `pdfjs-dist` (Apache-2.0), `pdf-to-img` (MIT), `tesseract.js` (Apache-2.0) et jeux de données
  `eng`/`fra` (MIT). Aucun service payant, aucune clé API, aucun appel réseau au moment de
  l’extraction. Audit complet des licences/métadonnées toujours reporté.

## Mission 22 — Stocks, charges à payer/avances et provisions (1er novembre 2026)

> Aucune fusion, aucun déploiement, aucune donnée réelle, aucun paiement, aucune déclaration
> MRA. Aucune règle mauricienne, aucun référentiel IAS 37/IFRS, aucun taux ni compte imposé.
> PR ouverte en brouillon ; `main` intact.

### Ajouté

- Migration `0020_inventory_accruals_provisions.sql` : catégories, emplacements, articles,
  soldes, lots FIFO, mouvements et allocations de lots, inventaires physiques, dépréciations,
  échéanciers de charges/produits différés et registre de provisions ; triggers d’isolation
  société et d’immuabilité. Sources d’écriture `inventory`, `accrual`, `provision`.
- Module `inventory` : FIFO et coût moyen pondéré en décimales exactes, stock d’ouverture,
  réceptions, sorties, ajustements, transferts, inventaires physiques, dépréciations/reprises,
  valorisation, rapprochement sous-registre ↔ grand livre agrégé par compte, refus du stock
  négatif, ponts explicites depuis une facture fournisseur validée et une facture client émise.
- Module `accruals` : charges à payer, produits à recevoir, charges constatées d’avance et
  produits constatés d’avance ; allocation mensuelle exacte, approbation humaine, comptabilisation
  des échéances dues, protection des périodes closes, extournes motivées, rapport et rapprochement.
- Module `provisions` : registre documenté, reconnaissance/révision/utilisation/reprise, preuves,
  part courante/non courante, rapports de mouvements et rapprochement à la date d’arrêté.
- Checklist de clôture : `ACCRUALS_PREPAYMENTS`, `PROVISIONS` et `INVENTORY` deviennent des
  contrôles réels ; un registre vide reste `pending`, jamais un faux vert.
- Écrans **Comptabilité → Stocks**, **Charges à payer & avances** et **Provisions**, FR/EN,
  responsive, avec propositions, décisions humaines et rapprochements.
- Démonstration navigateur schéma 16 : deux sociétés fictives, stock FIFO et coût moyen,
  inventaire physique, dépréciation, assurance payée d’avance, charges à payer, revenus différés,
  provision litige avec utilisation et reprise, rapprochements. Aucun appel réseau.
- Documentation : [`docs/mission-22-report.md`](docs/mission-22-report.md).

### Corrigé

- `PNL_OPENING_PRESENT` : la fixture comparait des mouvements bruts au lieu des soldes nets de
  balance. Les soldes d’ouverture sont désormais nets, sans disparition de solde ni écriture
  dupliquée ; un exercice précédent encore ouvert produit un avertissement
  `PNL_OPENING_PENDING_CLOSE`, pas un blocage.

### Sécurité et limites

- Toute comptabilisation de stock, d’échéancier ou de provision exige une approbation humaine
  motivée ; aucune suggestion automatique n’est comptabilisée.
- Les périodes closes restent protégées et les lignes comptabilisées ne sont jamais modifiées.
- Aucune conformité IAS 37, IFRS ou MRA n’est affirmée ; aucun seuil, taux ou compte mauricien
  n’est inventé.
- Le pont achats/facturation est manuel et explicite ; il ne recrée pas les modules existants.
- Aucun test sur appareil Android physique ni Chrome Windows réel ; limites détaillées dans le
  rapport de mission.

## Mission 21 — Exercices, soldes d’ouverture, ajustements antérieurs et archives (31 octobre 2026)

> Aucune fusion, aucun déploiement, aucune donnée réelle, aucun paiement, aucune déclaration
> MRA. Aucune règle mauricienne, aucun référentiel IFRS, aucune durée légale de conservation
> n’est inventé. PR ouverte en brouillon ; `main` intact.

### Ajouté

- Migration `0019_financial_years_archives.sql` : paramètres annuels (comptes d’attente,
  politique de rétention facultative), lots d’ouverture externe, ajustements sur exercices
  antérieurs, checklists versionnées et archives annuelles scellées avec manifeste et empreintes ;
  triggers d’isolation société et d’immuabilité. Source d’écriture `prior_year_adjustment`.
- Module `financial-years` réutilisant le moteur d’écritures et la clôture existants :
  aperçu des soldes d’ouverture en grand livre continu (aucune écriture de report dupliquée),
  contrôles d’équilibre, de continuité et d’absence de comptes de résultat en ouverture,
  reprise externe limitée au premier exercice, registre des ajustements antérieurs avec
  approbation humaine, checklist de clôture à treize contrôles et archives JSON/ZIP.
- Écran **Comptabilité → Exercices & archives** en cinq onglets, FR/EN, responsive : chronologie,
  soldes d’ouverture, ajustements, contrôles et paramètres, archives en lecture seule.
- Démonstration navigateur schéma 15 : deux exercices clôturés et archivés, exercices ouverts
  (dont l’exercice de paie existant), ajustement antérieur comptabilisé et ajustement proposé,
  preuves de rapprochement reprises des modules existants. Empreintes de démonstration
  explicitement non cryptographiques, aucun appel réseau.
- Documentation : [`docs/mission-21-report.md`](docs/mission-21-report.md).

### Sécurité et limites

- Les exercices clôturés ne sont jamais rouverts ni modifiés ; un ajustement antérieur crée une
  nouvelle écriture datée dans l’exercice courant, avec référence d’origine, motif et justificatif.
- Aucun traitement comptable automatique : le traitement PPA et les comptes sont choisis
  explicitement, sans règle mauricienne ou IFRS appliquée en silence.
- Les contrôles des modules absents (provisions, stocks, charges constatées d’avance, pièces
  jointes en démonstration) restent `unavailable` ou `pending`, jamais `ok`.
- Aucune durée légale de conservation affirmée ; la rétention est une décision humaine.
- Un paquet d’archive reste un instantané comptable avec empreintes : ni certification légale,
  ni sauvegarde des documents scannés, ni ZIP serveur en mode démonstration.

## Mission 20 — Immobilisations et amortissements (31 octobre 2026)

> Aucune fusion, aucun déploiement, aucune donnée réelle, aucun paiement, aucune déclaration
> MRA, aucun fournisseur payant. Aucun compte officiel, taux fiscal ou règle mauricienne
> d'amortissement n'est inventé. PR ouverte en brouillon ; `main` intact.

### Ajouté

- Migration `0018_fixed_assets.sql` : catégories par société, registre, estimations datées,
  événements, lots de dotation, lignes mensuelles, dépréciations, propositions, séquences,
  triggers d'isolation et d'immutabilité.
- Moteur exact `fixed-assets/depreciation.ts` : linéaire, dégressif, prorata des jours, valeur
  résiduelle, plafond, complément du dernier mois, révision prospective, suspension.
- Service et comptabilisation réutilisant le moteur existant : propositions d'acquisition,
  en-cours, mise en service, dotation, dépréciation/reprise, cession, rebut, transfert ;
  approbation humaine et comptabilisation explicite uniquement.
- Sept états (`register`, `schedule`, `accumulated`, `nbv`, `additions-disposals`,
  `reconciliation`, `movement-schedule`) avec CSV et PDF, réconciliation par triplet de comptes.
- Écran **Comptabilité → Immobilisations** en quatre onglets, FR/EN, filtres catégorie,
  statut et exercice ; API documentée et permissions par rôle.
- Démonstration schéma 14 : deux sociétés, deux méthodes, acquisition en cours d'année,
  ordinateur pluriannuel, cession avant fin de vie, actif totalement amorti, en-cours,
  dépréciation justifiée, réconciliation équilibrée.
- Documentation : [`docs/mission-20-report.md`](docs/mission-20-report.md),
  [`docs/accounting-gaps-audit.md`](docs/accounting-gaps-audit.md),
  [`docs/company-incorporation-corporate-services.md`](docs/company-incorporation-corporate-services.md).

### Sécurité et limites

- Aucun amortissement fiscal ni capital allowance calculé ; aucun taux inventé.
- Aucune réévaluation, aucun composant, aucune consolidation.
- Un lot ou une proposition ne comptabilise qu'après approbation humaine explicite.
- Les questions ouvertes sont regroupées pour une revue professionnelle unique en anglais
  (section 12 du rapport de mission).

## Mission 19 — Capitaux propres, clôture et report à nouveau (31 octobre 2026)

> Aucune fusion, aucun déploiement, aucune donnée réelle, aucun paiement, aucune déclaration
> MRA. Aucun numéro de compte mauricien, taux, pourcentage de réserve ou traitement IFRS n’est
> inventé. PR ouverte en brouillon ; `main` intact.

### Ajouté

- Migration `0017_equity_closing.sql` : registre `equity_movements`, `fiscal_closings`
  versionnés avec empreinte de source, `equity_allocations` et lignes, sources d’écriture
  `equity`, `closing`, `equity_allocation`, triggers d’isolation société et d’immutabilité.
- Service `equity/service.ts` réutilisant le moteur comptable existant : registre justifié,
  contrôles de clôture (brouillons, équilibre, comptes inactifs, chevauchement d’exercice,
  source périmée), comptabilisation après approbation humaine, affectation exacte du résultat,
  état des capitaux propres rapproché de la balance générale.
- API `/equity/*` derrière le module comptabilité ; approbations et comptabilisations
  réservées au rôle `manager` avec note et confirmation explicites.
- Écran **Comptabilité → Capitaux propres & clôture** en quatre onglets, FR/EN, responsive.
- Démonstration navigateur schéma 13 : deux exercices clôturés (perte puis bénéfice), apport
  en capital, affectation documentée, brouillon à approuver ; aucune écriture réseau.
- Documentation : [`docs/mission-19-report.md`](docs/mission-19-report.md).

### Sécurité et limites

- Une clôture comptabilisée est verrouillée ; aucune réouverture n’est proposée.
- Une préparation de clôture ne crée aucune écriture et ne corrige jamais un déséquilibre.
- L’affectation doit totaliser exactement le résultat ; aucune règle légale n’est appliquée.
- Les points ouverts sont regroupés pour une revue professionnelle unique (section 12 du
  rapport).

## Mission 18 — Transfert Paie → Comptabilité (31 octobre 2026)

> Aucune fusion, aucun déploiement OVH, aucune donnée réelle, aucun paiement,
> aucune déclaration MRA, aucun fournisseur payant. La comptabilisation définitive
> d’une paie non validée reste bloquée. PR nº1 ouverte en brouillon ; `main` intact.

### Ajouté

- Migration `0016_payroll_accounting_transfer.sql` : correspondances versionnées
  à 13 rôles configurables, un seul mapping `VALIDATED` par société, instantanés
  de transfert avec 6 statuts, empreinte des calculs, décisions humaines et
  anti-doublons (un `POSTED` par période, une approbation par empreinte).
- Service `payroll/accounting.ts` réutilisant `prepareEntry`, `assertOpenPeriod`,
  `nextEntryNo`, `loadJournal`, `loadAccounts` et `insertLines`.
- API de correspondances, prévisualisation, génération, historique, approbation
  pour test, rejet motivé, comptabilisation contrôlée et CSV interne.
- Onglet **Paie & RH → Transfert comptable** : totaux, comptes, contrôles, lignes
  débit/crédit, historique, décision humaine et export interne.
- Démonstration octobre 2026 fictive avec mapping propre à chaque société.
- Documentation : [`docs/mission-18-report.md`](docs/mission-18-report.md).

### Sécurité et limites

- Aucun compte comptable obligatoire n’est imposé ; aucun plan comptable
  mauricien n’est inventé.
- Une approbation `APPROVED_FOR_TEST` ne crée aucune écriture.
- `POST` renvoie `PAYROLL_TRANSFER_POSTING_BLOCKED` tant que les règles ne sont
  pas validées par un expert, la paie approuvée pour usage réel et la période
  finalisée.
- Aucune ligne d’ajustement n’est créée pour équilibrer une proposition.

### Tests

- API : `payroll-accounting.test.ts` (11), migrations (6) ; suite 418 réussis,
  11 ignorés.
- Web : `demo-accounting-transfer.test.ts` (7), interface de transfert (1) ;
  suite 198 réussis.


## Mission 17 — Bulletins individuels et préparation des déclarations MRA (31 octobre 2026)

> Aucune fusion, aucun déploiement OVH, aucune donnée réelle, aucune soumission MRA,
> aucun identifiant MRA réel, aucun virement, aucun fichier PACO officiel. PR nº1
> ouverte en brouillon ; `main` intact. Aucune conformité légale affirmée.

### Ajouté

- Vue de bulletin **isolée** `/payroll/payslips/:id` : bouton « Imprimer ce
  bulletin » qui n’imprime que ce bulletin, masque navigation, menus, boutons et
  pastille IA, et force une page A4 (`@page size A4`, `payslip-print-mode`).
- Module **Déclarations** dans Paie & RH : société, période, identifiant employeur
  fictif, nombre de salariés, totaux rémunérations/PAYE/CSG/NSF/levy calculés
  depuis les bulletins enregistrés, détail par salarié et historique versionné.
- API `POST /companies/:id/payroll/declarations`, `GET …/declarations`,
  `GET …/declarations/:declarationId`, `GET …/declarations/:declarationId/internal-csv`
  et `GET …/periods/:periodId/mra-return` (préparation interne).
- Contrôles de déclaration : couverture salariés, calculs bloqués, valeurs
  statutaires nulles, doublons de matricule, devises mixtes, règles non validées,
  isolation société, identifiant employeur.
- Export **interne** `MRA-INTERNAL-PREPARATION-…csv` (UTF-8 BOM, CRLF),
  explicitement non transmissible ; export officiel **indisponible** et expliqué
  (NIC/NCID complet, ERN, modèle de décembre 2024, règle d’arrondi).
- Historisation par `payroll_events` (`payroll.mra.prepare`) et `audit_log`,
  versions incrémentales sous verrou de période.
- Démonstration : déclarations fictives de octobre 2026, société bloquée
  `Lagon Bleu`, isolation des sociétés, export interne.
- Documentation : [`docs/mra-declarations.md`](docs/mra-declarations.md),
  [`docs/mission-17-report.md`](docs/mission-17-report.md).

### Modifié

- Filigranes centraux et bandeaux supprimés des bulletins ; seul demeure le pied
  de page discret `SIMULATION — NON VALIDÉ POUR PAIEMENT`.
- `EMPLOYER_IDENTIFIER_REQUIRED` devient un avertissement d’archivage ; les
  contrôles bloquants de l’export officiel restent inchangés.
- Montants affichés via `moneyExact` pour ne perdre aucune décimale.

### Tests

- API : `payroll-declarations.test.ts` (5) ; suite 407 réussis, 11 ignorés.
- Web : `demo-declarations.test.ts` (4), `payroll-ui.test.tsx` (7) ; suite 190 réussis.

## Mission 16 — Règles 2026/27, bulletin professionnel et démonstration (31 octobre 2026)

> Aucune fusion, aucun déploiement OVH, aucune donnée réelle, aucune soumission MRA,
> aucun identifiant MRA, aucun virement. PR nº1 ouverte en brouillon ; `main` intact.
> Aucune conformité légale affirmée ; les calculs restent non validés pour paiement.

### Ajouté

- Version datée PAYE 2026/27 (`2026-07-01` → `2027-06-30`) : bandes 0/10/20/35 %,
  `fscApplicable: false`, `noEdfRuleAvailable: false`,
  `monthlyWithholdingTableVerified: false` ; PAYE 2025/26 close au 30/06/2026 ;
  AR 2026 close au 31/12/2026.
- Blocage explicite d’un salarié sans EDF en 2026/27
  (`NO_EDF_RULE_NOT_VERIFIED_FOR_PERIOD`) au lieu de réutiliser le seuil 2025/26.
- Scénario fictif *Mauritius Demo Services Ltd* / *Daniel Morel*, octobre 2026 :
  calcul complet par le moteur réel (AR 635, PAYE 0, CSG 459,525/919,05,
  NSF 297,10/742,75, levy 459,525, net 29 878,375, coût 32 756,325).
- Bulletin PDF réécrit : plus de filigrane central, en-tête société, identité,
  période, tableaux, traçabilité, pied de page bilingue discret.
- Démonstration Pages : société et scénario 2026/27, bulletin simulé
  `SIM-202610-0001`, bouton « Vue imprimable / PDF navigateur » explicite.
- Tests `payroll-2026-27.test.ts` (4) et `payroll-pdf.test.ts` (2).

### Modifié

- Snapshot de calcul enrichi (fonction, contrat, dates de période, référence) et
  sociétés chargées avec adresse, activité et contacts pour le PDF.
- Affichage des montants PDF sans perte de décimale ; totaux en BigInt.
- Registres de sources et de règles, guide utilisateur Windows/Android et
  documentation de démonstration mis à jour pour 2026/27.

### Non fait volontairement

- Aucune déclaration MRA, aucun paiement, aucun bulletin final.
- Aucun PDF généré en mode démonstration ; seule l’impression navigateur est proposée.
- Les sections 7/18/28 du Finance Act 2026 et la table mensuelle cumulative n’étant
  pas vérifiées verbatim, la revue professionnelle reste obligatoire.

## Mission 15 — Moteur de paie mauricien sourcé et audit réglementaire (31 octobre 2026)

> Aucune fusion, aucun déploiement OVH, aucune donnée personnelle réelle, aucune
> soumission MRA, aucun identifiant MRA, aucun virement. PR nº1 laissée ouverte en
> brouillon ; `main` intact. Aucune conformité légale affirmée.

### Ajouté

- Migration `0015_statutory_engine.sql` : profil statutaire salarié, déclarations
  EDF révisionnées, paramètres et métadonnées de sources des règles, colonnes de
  résultat statutaire, statuts de calcul étendus, interrupteurs AR/bonus.
- Moteur pur BigInt `statutory.ts` : PAYE cumulatif, sans EDF, CSG, NSF par
  fréquence et date, Training Levy, AR 2026, bonus simulé, arrondis au rupee.
- Seed de 9 règles officielles (`RESEARCHED`) avec URL, article, date de
  publication, date d’accès, empreinte SHA-256, paramètres et version.
- Pipeline de calcul complet (PAYE, CSG, NSF, levy, AR, coût employeur, net après
  cotisations), traçabilité des versions et blocage si une règle manque.
- EDF : historique, remplacements, refus d’antidatage, table dépendants
  0/110/190/275/355 k, reliefs 1/13, 1/28, 1/56.
- Statuts séparés : `rules_incomplete`, `review_required`, `expert_review_pending`,
  `approved_for_test`, `finalisation_blocked` ; `net_payable` reste nul.
- Boutons « approuver pour test », « valider la règle », préparation MRA CSV
  explicitement `PREPARATION_ONLY` / `NOT_SUBMITTED`.
- Démonstration navigateur utilisant le même module de formules : valeurs
  statutaires, AR 2026, règles sourcées, aucun appel réseau.
- 22 tests API mission 15 (dont le blocage de toute période postérieure au
  30/06/2026), cas A→R documentés, migration testée ; suites complètes locales :
  API 396 réussis / 11 ignorés (PostgreSQL CI), web 182 réussis.
- Documentation : rapport mission 15, registre des sources, dossier d’audit
  anglais 18 chapitres, spécification PAYE, CSG/NSF/levy, AR 2026, cas de test,
  index comptable séparé.

### Modifié

- Les bulletins de simulation affichent les montants statutaires, le coût
  employeur et les versions de règles, toujours avec « NOT FOR PAYMENT ».
- Le tableau de bord expose le moteur comme implémenté mais non approuvé.
- Les tests mission 14 sont alignés sur les statuts de revue (plus de faux
  « moteur non implémenté »).

### Sécurité et limites

- Aucune soumission MRA, aucun identifiant réel, aucune donnée salarié réelle.
- FSC, CSG public/PRB, PAYE administrateurs, AR au rendement, bonus s.54 et
  déclarations MRA restent bloqués ou documentés comme non implémentés.
- Validation physique Android/Chrome/lecteur d’écran non réalisée.

## Mission 14 — Paie & RH mauricienne : préparation et simulation (31 octobre 2026)

> Aucune fusion, aucun déploiement OVH, aucune donnée personnelle réelle, aucun
> taux mauricien inventé, aucune déclaration officielle, aucun virement. PR nº1
> laissée en brouillon ; `main` intact.

### Ajouté

- Migration additive `0014_payroll_foundation.sql` : extension des salariés,
  contrats et événements datés, rubriques, temps, absences, règles de congé,
  registre de règles versionnées, périodes, variables, calculs et bulletins ;
  triggers de garde et isolation société.
- Service et routes paie : dossiers salariés avec banque masquée (`last4` +
  empreinte), doublons sans fusion, contrats historisés, temps, congés, variables
  et import fichier CSV/TSV/XLSX idempotent, jours fériés sourcés, périodes, calcul arithmétique déterministe,
  bulletins de simulation, PDF filigrané, export CSV, aperçu comptable bloqué.
- Calcul BigInt sur `numeric(20,4)`, prorata calendaire documenté et `input_hash`.
- Statut `blocked` systématique : PAYE, CSG, NSF et employeur `NULL`, aucun zéro de
  contournement ; finalisation refusée par l’API et la base.
- Écran `Paie & RH` FR/EN en 12 sections, tableaux contenus, cartes mobile,
  indicateur de démonstration conservé.
- Démonstration 12 salariés fictifs A→L (mensuel, horaire, temps partiel, entrée
  en cours de mois, avenant daté, absence non rémunérée, heures supp., prime,
  avance, étranger, échéance, calcul bloqué), 100 % localStorage.
- Assistant lecture seule : agrégats de préparation, règles manquantes et
  explication d’un calcul stocké ; aucune invention, aucune action.
- 48 tests API paie, 9 tests moteur de démonstration, 5 tests d’interface,
  migration 0014 ; documentation complète en 7 documents.

### Limites

- Moteur réglementaire PAYE/CSG/NSF/employeur non implémenté.
- Aucun bulletin final, aucune déclaration, aucun virement, aucune écriture
  comptable automatique.
- Aucun droit à congé ni majoration d’heures supplémentaires présumé.
- Appareil Samsung physique non vérifié.

## Mission 13 — Multidevises, taux de change et écarts (31 octobre 2026)

> Aucune fusion, aucun déploiement OVH, aucune donnée réelle, aucun fournisseur de
> taux externe, aucune dépense. PR nº1 laissée en brouillon ; `main` intact.

### Ajouté

- Migration additive `0013_multi_currency.sql` : devises autorisées, réglages FX,
  registre de taux versionné, événements, écarts réalisés, réévaluations simulées,
  virements inter-devises, triggers d’immuabilité et verrou de devise fonctionnelle.
- API `/fx` : configuration, taux (brouillon → validation humaine → rejet /
  remplacement versionné), résolution exacte paire + date, écarts réalisés
  proposés puis comptabilisés une seule fois, simulations latentes, aperçus de
  virements, rapports et CSV par devise.
- Écran `Comptabilité → Multidevises` FR/EN (configuration, taux & conversion,
  écarts réalisés, évaluations, virements, rapports), cartes mobile et tableaux
  desktop, avertissement permanent « taux non officiel ».
- Démonstration A→J fictive (`demo/fx.ts`, localStorage schéma 11), taux tous
  marqués `demo`.
- Assistant lecture seule : `fx.rates`, `fx.convert`, `fx.unrated`, `fx.realized`.
- 35 tests API mission 13, 8 tests de démonstration, 3 tests d’interface,
  tests de saisie décimale Android.
- Documentation : rapport 16 points, architecture multidevise, politique de taux,
  écarts réalisés/latents, registre de validation expert-comptable, guide.

### Corrigé — ergonomie Samsung

- Cases de sélection du lettrage : dimensions rétablies, zone tactile 44 px,
  focus clavier conservé.
- Montants éditables : `50 000,00` / `50,000.00`, saisie point ou virgule sans
  perte de précision.
- Marge basse mobile pour que la pastille de l’assistant ne masque plus les
  boutons et champs, safe-areas conservées.

### Limites

- Changement de devise fonctionnelle après comptabilisation : interdit, procédure
  non implémentée.
- Comptabilisation des réévaluations et des virements inter-devises : bloquée.
- Aucune conformité MRA, aucune règle fiscale mauricienne inventée.

## Mission 12 — Lettrage comptable & finalisation Banque ↔ Fournisseurs (31 octobre 2026)

> Aucune fusion, aucun déploiement OVH, aucune donnée réelle, aucun fournisseur
> IA payant. PR nº1 laissée en brouillon ; `main` intact.

### Ajouté

- Migration additive `0012_reconciliation_lettering.sql` : groupes de lettrage,
  lignes affectées, événements, séquences, index uniques, triggers d’isolation
  société/cabinet et d’immuabilité.
- Lettrage de lignes **déjà comptabilisées** : client complet
  (100 000 = 40 000 + 35 000 + 25 000), fournisseur partiel
  (80 000/30 000 → 50 000 restants), 1↔N, N↔1, facture + avoir + solde.
- Codes uniques `LET-AAAA-NNNN`, verrous PostgreSQL, anti-double lettrage,
  idempotence par `request_key`, rollback complet.
- Suggestions déterministes explicables (montant, raisons, confiance,
  ambiguïtés), sans validation automatique.
- Délettrage sécurisé : permission administrateur, motif obligatoire,
  confirmation, historique conservé, période clôturée bloquée, aucun impact
  bancaire.
- Rapports par devise et exports CSV : lignes non lettrées, factures
  totalement/partiellement lettrées, règlements non lettrés, écarts
  commercial/comptable.
- Écran `Comptabilité → Lettrage` FR/EN, tableau desktop et cartes Android,
  onglets lettrage / historique / rapports.
- Panneau Banque : bloc **Règlements fournisseurs liés** avec candidats,
  confirmation, retrait motivé et idempotence, sans nouvel écriture ni paiement.
- Assistant : outils lecture seule `lettering.unlettered`, `lettering.partial`,
  `lettering.payments`.
- Démo schéma **10**, scénarios A→I entièrement fictifs.
- Tests : API 30 (dont concurrence PostgreSQL), démo 8, interface 3,
  Banque fournisseur 1.
- Documentation : rapport de mission 12, lettrage, sécurité, interface Banque,
  guide utilisateur, README, tests.

### Limites déclarées

- Concurrence réelle exécutée uniquement dans le job PostgreSQL de la CI.
- Aucun test sur Samsung Android physique ni Chrome réel.
- Aucun lettrage automatique, aucun change, aucune réouverture de période.
- Règles comptables/fiscales mauriciennes détaillées : `À VÉRIFIER`.

## Mission 11 — Achats & Fournisseurs (31 octobre 2026)

> Aucune fusion, aucun déploiement OVH, aucune donnée réelle, aucun fournisseur
> IA payant. PR nº1 laissée en brouillon ; `main` intact.

### Ajouté

- Migration `0011_purchases.sql` : fournisseurs, documents d'achat, lignes,
  règlements, affectations de règlements et d'avoirs, événements, séquences de
  numérotation, colonnes `bank_matches.purchase_payment_id|purchase_invoice_id`
  et `attachments.purchase_document_id`.
- Sous-ledger fournisseur : fiches, factures d'achat, avoirs, règlements
  totaux/partiels/groupés, acomptes, soldes et échéancier **par devise**.
- Numérotation atomique `ACH-AAAA-NNNN`, `AVF-AAAA-NNNN`, `RF-AAAA-NNNN`.
- Propositions comptables via le moteur existant, cycle
  Préparer → Vérifier → Valider → Comptabiliser, sans second grand livre.
- TVA issue uniquement des taux configurés et vérifiés ; récupérabilité
  explicite ; aucun taux ni règle MRA en dur.
- Rapprochement bancaire fournisseur : candidats déterministes, lien idempotent
  201/200, retrait confirmé, plafonds sous verrou.
- Assistant : outils lecture seule pour fournisseurs, factures, dettes,
  doublons et règlements.
- Écran `/accounting/purchases` avec tableaux desktop et cartes mobiles,
  export CSV, i18n FR/EN.
- Démo schéma 9 : scénario A→H (80 000 ; partiel 30 000/50 000 ; groupé ;
  avoir ; retard ; facture comptabilisée ; double règlement refusé ; EUR
  distinct).
- Tests : `purchases.test.ts` 31, démo 11, écran 1, concurrence PostgreSQL 3.
- Documentation : audit, fournisseurs, règlements, comptabilisation, rapport
  de mission 11.

### Corrigé

- La contrainte `journal_entries.source` conserve désormais `migration` et
  `migration_opening` en plus de `purchase` (régression détectée par les tests
  de migration existants).
- Le libellé de navigation « Achats & OCR » devient « Achats & Fournisseurs ».
- La route `/accounting/purchases` n'est plus une page « préparée ».

### Limites déclarées

- Interface Banque fournisseur partielle : liens disponibles par API, pas
  encore exposés dans le panneau Banque.
- Écarts de change, réévaluation, lettrage automatique : `NON IMPLÉMENTÉ`.
- Conformité fiscale mauricienne, e-invoicing MRA et reverse charge :
  `À VÉRIFIER` / `NON IMPLÉMENTÉ`.
- Aucun test sur Samsung Android physique ; CI PostgreSQL réel verte sur `b06eacd`.

## Mission 10 — rapprochement bancaire avancé & intégration Facturation (31 octobre 2026)

> Aucune fusion, aucune connexion bancaire réelle, aucune dépense, aucun
> fournisseur IA payant. PR nº1 laissée en brouillon.

### Ajouté

- Migration `0010_bank_billing.sql` : montant par affectation bancaire,
  facture liée, note, horodatage, index uniques partiels, statut
  `partially_matched`.
- Rapprochement d'une transaction avec un **règlement client existant**,
  partiel ou total ; plusieurs transactions pour une facture (n↔1) et une
  transaction pour plusieurs règlements/factures (1↔n).
- Candidats déterministes : restants exacts, factures, confiance, anomalies,
  état comptable.
- Confirmation idempotente, plafonds sous verrou, refus des mélanges
  règlement/ligne comptable/proposition/exclusion.
- Retrait d'une affectation sans suppression d'historique (`rejected`).
- Rapport détaillé et CSV : affectations, règlements, factures, restants dus,
  validateurs, écritures.
- Mise à jour de `bank_matches.entry_id` dans la transaction de
  comptabilisation existante.
- Écran Transactions : tableau desktop complet, cartes mobiles sans débordement,
  montants/devise/statuts entiers, panneau de détail et actions de
  rapprochement.
- Démo A→G : trois virements, partiel 30 000/80 000, virement groupé, règlement
  déjà comptabilisé, double tentative, ambiguïté, virement interne.
- Tests : API +18, web +4, démo +2, concurrence PostgreSQL +3.
- Documentation : `mission-10-report.md`, `advanced-reconciliation.md`,
  `bank-billing-integration.md`, mises à jour banque/README/tests.

### Corrigé

- `bank_matches.billing_payment_id` est désormais réellement écrit.
- Une transaction partiellement affectée ne peut plus être exclue, rapprochée
  une seconde fois sur une ligne comptable ni faire l'objet d'une proposition
  concurrente.
- L'annulation d'un règlement déjà rapproché en banque est refusée
  (`PAYMENT_RECONCILED`).
- Les montants de rapprochement ne sont plus implicites : `amount` est
  obligatoire et contrôlé en décimal exact.

### Limites déclarées

- Factures/avoirs fournisseurs, remboursements clients et lettrage de grand
  livre : `NON IMPLÉMENTÉ`.
- Devises différentes et écarts de change : refusés, aucun taux inventé.
- Frais bancaires non nets d'un règlement.
- Aucun test sur Samsung Android physique ; vérification par styles/DOM.
- CI PostgreSQL réel exécutée après push ; voir le rapport final.


## Correctif mission 9 — sélection des fichiers sur Samsung Android (31 octobre 2026)

> Corrige le grisement des CSV/TSV/TXT/XLSX dans le sélecteur Android des
> modules Banque et Migration. Aucune modification du moteur comptable, du
> rapprochement ou des règles IA.

### Corrigé

- Politique d'upload commune `apps/web/src/lib/upload.ts` (Banque + Migration).
- `accept` élargi : `.csv`, `.tsv`, `.txt`, `.xlsx` et MIME Android
  `text/*`, `text/csv`, `text/comma-separated-values`,
  `text/plain`, `application/vnd.ms-excel`, XLSX OOXML, ZIP,
  `application/octet-stream`.
- Validation après sélection conservée : extension insensible à la casse,
  fichier vide/plafond, puis validation du contenu par le moteur d'import.
- Message explicite pour un format refusé ; input réinitialisé pour permettre
  la resélection du même fichier.
- Tests : `upload-policy.test.ts` (6), UI Banque (3), UI Migration (3
  assertions d'`accept`). Web : **123 réussis / 13 fichiers**.

### Limite

Aucun appareil Samsung/Android physique dans l'environnement : le filtre MIME
natif n'est pas rejoué par jsdom. Le parcours manuel reste à confirmer sur le
téléphone après déploiement Pages.

## Mauritius Business Suite — 31 octobre 2026 (mission 9)

> Import bancaire, rapprochement comptable et ergonomie Android. Aucune
> connexion bancaire réelle, aucune donnée réelle, aucun fournisseur IA activé,
> aucune PR fusionnée.

### Ajouté — Banque & rapprochement

- Comptes bancaires par société (banque, devise, référence masquée, compte
  d'actif associé), historique des imports et transactions.
- Import CSV, TSV/TXT et XLSX via le parseur de la mission 8 ; 20 codes
  d'anomalie explicites, soldes et successions contrôlés en décimal exact.
- Prévisualisation **sans écriture**, confirmation humaine obligatoire,
  idempotence par empreinte fichier et par identifiant métier.
- Rapprochement 1↔1 et 1↔n avec montant exact, fenêtre de dates, référence,
  facture et libellé ; statuts distincts proposition/rapprochement.
- Propositions comptables postées uniquement après acceptation humaine, via le
  moteur `postEntryTx` existant ; aucun second moteur comptable.
- Suggestions déterministes depuis le plan comptable actif, règles versionnées,
  désactivables et auditables ; salaires proposés sans calcul de paie ; aucun
  compte inventé. Aucun second moteur IA et aucun fournisseur activé.
- Rapport de rapprochement (soldes, rapprochés/non rapprochés, écarts,
  explications) et export CSV ; PDF bancaire **non implémenté**.
- Cas complexes bloqués et documentés : n↔1, paiement partiel, écart de change.

### Ajouté — Démonstration et mobile

- Démo Pages : deux comptes fictifs (MUR/EUR), transactions, factures et
  écritures existantes, quatre relevés fictifs (`releve-bancaire-fictif.csv`,
  `.xlsx`, `-doublons.csv`, `-erreurs.csv`), règles et rapport local.
- Le grand bandeau fixe bas est remplacé par un **indicateur Démo compact**
  dans l'en-tête, toujours visible, avec explication et réinitialisation ;
  l'identification complète reste sur l'écran de connexion. Safe-areas et
  pastille IA préservées.
- Schéma localStorage porté à **7**.

### Base de données et tests

- Migration additive `0009_bank.sql` : sept tables, audit append-only.
- API : **213 réussis, 4 ignorés** (dont 28 tests bancaires) ; web :
  **116 réussis** (12 fichiers) ; typecheck 0 erreur ; build démo OK.
- CI PostgreSQL réel : vérification des sept tables `bank_*` après migration
  et ré-application idempotente.
- CI mission 9 : runs `41192173639` (push) et `41192178271` (PR) verts ;
  Pages `41192173531` vert (déploiement + vérifications HTTPS).
- Limites non revendiquées : OFX/QFX, PDF/OCR, connexion bancaire, PDF du
  rapport, tests Chrome/Android réels, conformité MRA.

## Mauritius Business Suite — 31 octobre 2026 (mission 8)

> Assistant de migration comptable (Excel/CSV, profils Sage et SAP expérimentaux).
> Aucune seconde base comptable, aucun moteur comptable réécrit, aucune
> certification Sage/SAP, aucune PR fusionnée.

### Ajouté — Assistant de migration en six étapes

- Cabinet → **Importation & migration** : source, téléversement, correspondances
  de colonnes et de comptes, contrôles, prévisualisation, validation humaine.
- Formats réels : `.csv`, `.tsv`, `.txt`, `.xlsx` multi-feuilles ; encodages
  UTF-8/BOM, UTF-16 et Windows-1252 ; délimiteurs `,` `;` tabulation ; montants
  et dates FR/EN ; **aucune macro ni formule exécutée**.
- Profils **Sage 50 / 200 / Accounting** et **SAP** marqués *expérimental* :
  fichiers d'export uniquement, aucune connexion, aucune compatibilité
  universelle, aucun nom d'éditeur utilisé comme certification.
- Plan comptable, soldes d'ouverture, journaux, écritures, clients, sociétés
  (BRN/CRN) ; factures historiques et paie **non reprises**.
- Contrôles bloquants vs avertissements : dates, montants, équilibre **par
  écriture**, comptes inconnus/doublons, devises et taux, période comptable,
  doublons et réimports. Aucune contrepartie fabriquée, aucun compte inventé.
- Écritures et soldes d'ouverture créés **via le moteur comptable existant** :
  numérotation, période ouverte, audit et balance inchangés.
- Idempotence par clé `cabinet + société + source + document + empreinte` ;
  réimport = tout ignoré, conflit = aucune écriture, jamais d'écrasement.
- Modèles de correspondance par cabinet, société et type d'import.
- Rapport d'import téléchargeable (CSV échappé contre l'injection), audit
  `migration_events`, purge après `MIGRATION_RETENTION_DAYS` (30 jours).
- Assistant IA : outil **lecture seule** `migration.jobs.summary` (API et démo)
  qui explique les formats et l'état des lots sans jamais confirmer un import.

### Ajouté — Démonstration Pages

- Écran complet avec 9 fichiers d'exemple **fictifs** téléchargeables (plan
  comptable CSV/XLSX, balance d'ouverture, journal FR/EN, exports Sage et SAP
  fictifs, fichier volontairement incorrect), stockés dans `localStorage`
  (schéma 6) avec bannière permanente et réinitialisation.
- Parcours jsdom des six étapes, du blocage d'un fichier incorrect et de la
  version anglaise ; aucun appel réseau, aucune donnée réelle.

### Base de données et tests

- Migration additive `0008_migration.sql` : `migration_jobs`, `uploads`,
  `templates`, `findings`, `batches`, `records`, `events`.
- API : **185 réussis, 4 ignorés** (dont 23 tests de migration) ;
  web : **97 réussis** (10 fichiers) ; typecheck strict 0 erreur ; build démo OK.
- CI PostgreSQL réel : les 20 scénarios obligatoires de migration sont exécutés
  (CSV FR/EN, XLSX multi-feuilles, colonnes manquantes, dates invalides,
  négatifs, déséquilibre, compte inconnu, doublons, réimport, reprise,
  ouverture, multi-devises, permissions, lot multi-sociétés, confirmation,
  absence d'écriture en prévisualisation, non-régression).

### Corrigé pendant la mission

- Détection de colonnes : score borné par mot et exclusion des en-têtes
  d'indicateur (évite « Description » au lieu d'« Intitulé »).
- Indicateur débit/crédit SAP : convention `S = Soll = débit`, `H = Haben =
  crédit`, relu **par ligne** (test de non-régression dédié).
- Parité démo/API : la liste des écritures expose la même colonne `source`.

## Mauritius Business Suite — 31 octobre 2026 (mission 7)

> Assistant IA universel, paramètres société et TVA configurable. Aucun module
> existant réécrit, aucune paie mauricienne calculée, aucun second moteur IA,
> aucune PR fusionnée.

### Ajouté — Assistant IA universel

- Pastille « ✨ Assistant IA » sur tous les écrans authentifiés des quatre modules ;
  panneau latéral sur ordinateur, feuille plein écran sur Android (safe-areas,
  composeur visible, chargement différé), survit aux changements de module sans
  perdre une saisie ni rouvrir le clavier.
- Contexte construit **côté serveur** (société re-vérifiée, module, écran, langue,
  permissions, référence d'objet) ; un `companyId` du navigateur n'est jamais cru.
- Registre d'outils en lecture seule (cabinet, facturation, comptabilité, paie),
  contrôle de permission à chaque appel, arguments validés, audit et rétention
  configurable (30 jours par défaut).
- Préparation d'écriture uniquement en **proposition brouillon** via l'Assistant V2
  existant : aucune comptabilisation, aucun outil irréversible.

### Ajouté — Paramètres société et TVA

- Écran unique accessible depuis Cabinet → Fiche société → Paramètres et depuis
  Comptabilité → Paramètres société : identification, comptabilité, facturation,
  fiscalité, historique.
- TVA : quatre traitements distincts (taxable / taux zéro / exonéré / hors champ),
  compte de TVA, vérification humaine sourcée et confirmée, historique append-only,
  taux gelé dès qu'un document émis l'utilise, aucun taux seedé.
- Migration additive `0007_assistant_settings_vat.sql` ; verrous d'exercice et de
  devise en présence d'écritures.

### Démonstration

- Schéma de stockage local **5** ; assistant réellement interactif branché sur les
  données fictives existantes, TVA 15 % de démonstration **non vérifiée**, aucun
  appel réseau, bandeau permanent.

### Tests

- API : 162 réussis, 4 ignorés (concurrence PostgreSQL réel). Web : 81 réussis.
  `typecheck` 0 erreur. Build démo : panneau en chunk séparé.

## Mauritius Business Suite — 31 octobre 2026 (mission 6)

> Facturation de bout en bout + assistant comptable V2. Cœur comptable et correctif clavier
> Android conservés ; Paie & RH inchangée.

### Ajouté — Facturation

- Clients (CRUD, archivage, BRN/TVA/adresse/contacts/devise/conditions/compte collectif),
  articles FR/EN, devis convertibles, factures, avoirs partiels, encaissements multi-factures
  avec trop-perçu, solde client, balance âgée, détection déterministe de doublons.
- Numérotation séquentielle atomique par société/type/année (`billing_number_sequences`),
  verrouillage après émission, brouillon modifiable, audit de chaque étape.
- PDF A4 FR/EN réellement générés par le serveur (`pdfkit`) : devis, factures, avoirs, reçus.
- Aucun taux de TVA seedé : un taux daté et vérifié par un professionnel est requis
  (`VAT_NOT_CONFIGURED`, `VAT_RATE_NOT_VERIFIED`, `VAT_RATE_NOT_APPLICABLE`).
- E-invoicing MRA : **désactivé**, aucun envoi, aucune conformité revendiquée.

### Ajouté — Assistant comptable V2

- Proposition d'écriture complète (journal, date, libellé, référence, devise, taux, lignes
  débit/crédit, justification, manques, alertes) sur neuf scénarios, comptes limités au plan
  comptable réel.
- Douze contrôles avant validation (équilibre, comptes, journal, exercice, date, devise/taux,
  TVA, droits, doublon, société, document source, double comptabilisation).
- Cycle strict Proposition → Vérification → Validation humaine → Comptabilisation ;
  `validate` ne crée jamais d'écriture, `post` est une action distincte et unique.
- Règles déterministes (six types) : priorité, versions, désactivation, historique, isolation
  par société, explication de la règle utilisée, aucun conflit appliqué en silence.
- Intégration Facturation → Comptabilité : propositions déterministes depuis les documents,
  comptabilisation via le moteur comptable, traçabilité bidirectionnelle, idempotence garantie
  par la base (référence unique, `accounting_entry_id` unique, verrous `FOR UPDATE`).

### Ajouté — Interface et démonstration

- Écrans `/billing` (tableau de bord, clients, devis, factures, avoirs, encaissements, balance
  âgée) et `/cabinet/ai-proposals` (proposition éditable, contrôles, valider/rejeter/
  comptabiliser, règles).
- Démo GitHub Pages : schéma 4 avec facturation réelle, propositions, règles ; `localStorage`
  uniquement, aucune clé, aucun appel externe, **aucun PDF simulé présenté comme réel**
  (`PDF_NOT_AVAILABLE_IN_DEMO`).

### Tests

- API : 139 réussis / 4 ignorés (PostgreSQL réel). Web : 60 réussis, dont 13 nouveaux cas
  facturation + assistant de la démo et un test d'écran « aucune écriture automatique ».
- CI et publication Pages vertes (`41156378284`, `41156382220`, `41156378229`).

## Mauritius Business Suite — 31 octobre 2026 (mission 5)

> Correctif Android + moteur IA multi-fournisseurs. Cœur comptable 0.1.1 conservé.

### Corrigé — clavier Android (Samsung)

- Le champ de saisie perdait le focus après **chaque caractère**, ce qui refermait le
  clavier virtuel : l'effet de gestion du focus de `Modal` dépendait de `onClose`,
  recréé à chaque rendu par les formulaires. Chaque frappe relançait l'effet et déplaçait
  le focus vers la boîte de dialogue.
- `onClose` est désormais conservé dans une ref : l'effet ne dépend plus que de `open` ;
  le focus n'entre dans le dialogue que s'il est ailleurs, et ne revient à l'élément
  déclencheur qu'à la fermeture.
- Champs à 16 px sur mobile (évite le zoom automatique de Chrome Android) et hauteur de
  modale en `dvh` quand le clavier est ouvert.
- 10 tests de non-régression saisissent caractère par caractère dans tous les formulaires
  (connexion, recherche dossier, création/modification de dossier, tâche, écriture,
  plan comptable, paramètres comptables, tiroir mobile) et vérifient que le nœud garde le
  focus et reste monté.

### Ajouté — Mauritius AI Engine

- Module `apps/api/src/modules/ai/` : interface `AIAdapter`, registre, adaptateurs OpenAI
  (OpenAI, DeepSeek, Mistral, compatible), Gemini et fournisseur fictif déterministe.
- Catalogue `apps/api/config/ai-providers.json` : URL, modèles, capacités et tarifs
  externalisés ; aucun tarif inventé (`pricing: []`).
- Clés API **BYOK** chiffrées en base (AES-256-GCM, clé dédiée, AAD cabinet + fournisseur,
  rotation par version de clé), jamais retournées, jamais journalisées.
- Budgets : consommation par cabinet/fournisseur/modèle/module, budget mensuel, plafond de
  requêtes, seuil d'alerte, blocage serveur, coût exact en arithmétique entière, coût
  « indisponible » sans tarif daté.
- Sélection manuelle ou automatique (refusée sans tarifs vérifiés), fournisseur de secours,
  timeouts, tentatives limitées, limitation de débit, journal d'audit et journal d'appels
  sans contenu.
- Cas d'usage opérationnel : **assistant de suggestion de compte** contraint au plan
  comptable réel de la société, décision humaine (accepter / corriger / refuser), règles
  réutilisables par dossier, **aucune écriture comptable créée**.
- Écrans Cabinet → Paramètres IA et Cabinet → Assistant comptable, bilingues FR/EN.
- Migration `0005_ai.sql` (additive) : `cabinets`, `ai_settings`, `ai_credentials`,
  `ai_usage`, `ai_suggestions`, `ai_account_rules`, `ai_request_log`, `ai_prices`.
- Démonstration GitHub Pages : moteur IA **entièrement simulé**, aucune clé acceptée, aucun
  appel réseau, coût « indisponible », bandeau « Simulation IA — aucune API externe utilisée ».
- Documentation : `docs/ai-architecture.md`, `ai-providers.md`, `ai-security.md`,
  `ai-cost-control.md`, `ai-account-suggestions.md`, `docs/mission-5-report.md`.

### Ajouté — préparé (non opérationnel)

- Contrats des automatisations futures (OCR factures, relevés bancaires, rapprochement,
  classement documentaire, anomalies de facturation, variables de paie, états financiers)
  exposés et renvoyant explicitement `501 NOT_IMPLEMENTED`.
- Mode « IA incluse dans l'abonnement » : colonne présente, contrainte à `false`.

## Mauritius Business Suite — 31 octobre 2026 (mission 4)

> Ajout fonctionnel sans changement de version applicative (cœur comptable 0.1.1 conservé).

### Ajouté — module Cabinet (opérationnel)

- Tableau de bord cabinet : sociétés clientes, dossiers actifs/archivés, dossiers à réviser,
  tâches à effectuer, en retard, échéances sous 7 jours, collaborateurs, activité récente.
- Dossiers clients : recherche, filtres, création, modification (BRN, CRN, TVA, adresse,
  activité, devise, exercice, responsable, code client), archivage/désarchivage en lecture
  seule, fiche dossier complète.
- Tâches et échéances : catégories, priorités, statuts, affectation contrôlée à un membre,
  commentaires, historique d'audit, filtres « en retard ».
- Collaborateurs : rôles par dossier, activation, consultation des droits par module.
- Migration `0004_cabinet.sql` (additive) : champs dossier, rôles étendus, table
  `company_module_access`, `cabinet_tasks`, `cabinet_task_comments`, triggers d'isolation.
- Permissions par module (`cabinet`, `accounting`, `billing`, `payroll`) avec séparation
  stricte paie/comptabilité, appliquées côté API **et** dans les requêtes SQL.

### Ajouté — préparé (non opérationnel)

- Espaces **Facturation** et **Paie & RH** : navigation, sous-menus, écrans d'annonce,
  capacités explicitement affichées comme non disponibles.
- Tables de fondation `billing_documents` (avec `accounting_entry_id UNIQUE` empêchant la
  double comptabilisation) et `payroll_employees` (aucune donnée salariale, aucun calcul).
- Contrats d'intégration documentés (`docs/module-integration.md`).

### Modifié

- Interface réorganisée en quatre espaces avec barre de modules, sous-menus contextuels et
  sélecteur de société ; anciennes routes conservées via redirections.
- Mode démonstration : 4 dossiers fictifs, 3 collaborateurs fictifs, 9 tâches, permissions
  par module, archivage lecture seule, écrans Cabinet réellement utilisables.

### Correctifs liés

- Un dossier archivé refuse désormais toute écriture (`COMPANY_ARCHIVED`, 409) tout en restant
  consultable et exportable.

## Mode démonstration — 31 octobre 2026 (GitHub Pages, sans serveur)

> Ajout fonctionnel sans changement de version applicative : le backend et l'API restent en
> 0.1.1, le mode démonstration est un build distinct de la même interface.

### Ajouté

- **Démonstration publique hébergée sur GitHub Pages** depuis la branche de développement,
  sans fusion de la PR ni modification de `main`.
- **Backend simulé dans le navigateur** (`apps/web/src/demo/runtime.ts`) : mêmes appels que
  l'API (auth, sociétés, comptes, journaux, écritures, périodes, taux, rapports, membres,
  audit), servis depuis `localStorage` avec une arithmétique décimale exacte (`BigInt`).
- **Jeu de données fictif reproductible** : société `Lagon Bleu Trading Ltd (DEMO)`,
  35 comptes, 5 journaux, 9 écritures (brouillon + contrepassation incluses).
- **Bandeau permanent « MODE DÉMONSTRATION »** + réinitialisation des données locales, et
  identifiants de démonstration pré-remplis sur la page de connexion.
- **Routage par hash** et base `/mauritius-compta/` en mode démo, `404.html` pour les liens
  profonds.
- **Exports CSV** calculés localement (BOM UTF-8, `;`, neutralisation des formules) ; le PDF
  ouvre l'impression du navigateur.
- **Tests web jsdom** (19) : moteur comptable, parcours React complets, formatage.
- Workflow `.github/workflows/pages.yml` (build + tests + déploiement Pages).

### Corrigé

- **Règles des hooks React** : `App` déclarait des `useEffect` après des retours anticipés ;
  le routeur plantait au changement d'état de session (détecté par les tests jsdom).
- **Date d'écriture proposée** : la modale propose désormais une date couverte par une
  période ouverte, au lieu de la date du jour hors exercice (`PERIOD_CLOSED` évitable).

## 0.1.1 — 30 octobre 2026 (audit, fiabilisation)

### Corrigé — comptabilité

- **Bilan équilibré en cours d'historique** : le Statement of Financial Position utilisait le
  résultat de la période au lieu du résultat cumulé depuis l'origine (bilan faux dès que la
  période analysée commençait après les premières écritures).
- **Changement de devise d'un brouillon** : un taux daté est désormais exigé ; l'ancien taux
  (souvent 1) n'est plus réutilisé silencieusement.
- **Devises** : seules MUR, EUR, USD et GBP sont acceptées (`INVALID_CURRENCY`).
- **Précision** : les montants à plus de 4 décimales sont refusés au lieu d'être arrondis.
- **Montants convertis** : un montant qui s'arrondit à zéro en devise fonctionnelle est refusé.
- **Numérotation** : un brouillon déplacé vers un autre journal ou exercice est renuméroté.
- **Références** : unicité par société, insensible à la casse (`REFERENCE_TAKEN`).
- **Validation** : les comptes sont revérifiés (société + activation) au moment de la validation.
- **Grand livre** : les comptes désactivés conservant des mouvements restent visibles.
- **Sociétés** : une période comptable est toujours créée, même sans plan comptable de
  démonstration (auparavant aucune écriture n'était possible).
- **Taux de change** : validation en HTTP 400 (au lieu de 409) ; taux inverse calculé en
  arithmétique entière (8 décimales).

### Corrigé — sécurité et intégrité

- **Pièces jointes** : vérification de la signature binaire (PDF/JPEG/PNG) et rejet des fichiers
  vides ; suppression des fichiers lorsqu'un brouillon est supprimé.
- **Injection de formules CSV** : les cellules commençant par `=`, `+`, `-`, `@` sont neutralisées.
- **Contrepassation unique** : index unique partiel (protection contre une course).
- **Isolation société en base** : triggers sur les écritures, contrepassations, pièces jointes et
  comptes parents.
- **Journal d'audit append-only** : modifications et suppressions refusées par PostgreSQL.
- **Sessions** : purge des sessions expirées et des anciennes tentatives, limitation par adresse
  IP en plus du compte, comparaison de hachage systématique à la connexion (anti-énumération).
- **Changement de mot de passe** : toutes les sessions sont invalidées et l'interface invite à se
  reconnecter.
- **Production** : inscription fermée par défaut, `db:seed` refusé (sauf `ALLOW_DEMO_SEED=true`).

### Amélioré — interface

- Édition des brouillons depuis l'interface (bouton « Modifier le brouillon »).
- Formatage monétaire exact (BigInt) et contrôle d'équilibre sans virgule flottante.
- Modales : fermeture par Échap, gestion du focus, bouton de fermeture traduit.
- Navigation mobile : tiroir refermé à la navigation, par Échap ou clic extérieur.
- Messages d'erreur supplémentaires traduits FR/EN.

### Ajouté

- `apps/api/sql/migrations/0003_hardening.sql` (intégrité et index).
- `tests/regressions.test.ts` (17 tests de non-régression).
- `tests/concurrency.test.ts` (4 tests, PostgreSQL réel).
- Tâche CI `API tests against real PostgreSQL`.
- Tests navigateur Playwright + `docs/browser-tests.md` (**non exécutés** dans l'environnement
  d'audit).
- `docs/audit-v0.1.1.md`, `docs/github-project-integrity.md`, `CHANGELOG.md`, `.nvmrc`,
  `.editorconfig`.
- README réécrit : installation Windows/Linux, PostgreSQL, mode démonstration, tests,
  reconstruction, limites réglementaires, dépannage.

### Notes

- Aucun déploiement, aucune fusion de PR : le propriétaire conserve la décision.
- Les règles réglementaires restent marquées « À VÉRIFIER » / « NON IMPLÉMENTÉ ».

## 0.1.0 — 30 octobre 2026

- Première version : sociétés, plan comptable, journaux, écritures, grand livre, balance, états
  financiers provisoires, exports CSV/PDF, FR/EN, migrations PostgreSQL, CI.
