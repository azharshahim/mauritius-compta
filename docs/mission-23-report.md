# Mission 23 — OCR natif, import bancaire MCB et plan comptable bilingue

_État au 1er novembre 2026. Branche `arena/984fcb7c-mauritius-compta`, PR en brouillon,
**aucune fusion**, aucun déploiement, aucune donnée réelle, aucun paiement, aucune déclaration
MRA, aucun accès à ScanPro AI. `main` reste intact._

## 1. Branche et commit

- Base : `main` = `98e430afdda8d0faaa2710bec681230ba3346296` (merge de la PR nº 5).
- Branche de travail : `arena/984fcb7c-mauritius-compta`.
- Aucun commit n’a été créé sur `main` ; la PR sera ouverte **en brouillon** et ne sera ni
  fusionnée ni publiée sans autorisation.
- Migration de cette mission : `0021_documents_charts_mcb.sql` (max = 21) ; schéma de
  démonstration navigateur : **17**.

## 2. Fonctionnalités réellement opérationnelles

### Documents et OCR

- Import de **PDF, JPEG et PNG** par glisser-déposer, sélection de fichier ou photo (un seul
  champ fichier, le sélecteur Android peut proposer l’appareil photo).
- Vérification de la **signature réelle** du fichier, limite de taille (8 Mo), société isolée,
  stockage sous `STORAGE_DIR/documents/<companyId>/`, SHA-256 et endpoint de lecture protégé.
- **Extraction texte PDF native** avec `pdf.js` (`extraction_method = pdf_text`), reconstruction
  des lignes visuelles pour les tableaux de facture.
- **OCR réel** avec Tesseract local et les données d’entraînement `eng` + `fra` :
  - image JPG/PNG → `ocr_image` ;
  - PDF sans texte suffisant → rendu des pages puis OCR → `ocr_pdf`.
  Aucun appel à un service externe, aucune clé API, aucun fournisseur payant.
- Limites annoncées et appliquées : **5 pages** analysées au plus (avertissement explicite),
  pas de reconnaissance manuscrite garantie, qualité dépendante de la photo.
- Champs extraits : tiers (fournisseur ou client), numéro, date d’échéance, devise, HT/TVA/TTC,
  lignes si lisibles, références. Les valeurs absentes restent nulles et sont signalées ; aucune
  TVA ni échéance n’est inventée. Une incohérence HT + TVA ≠ TTC produit un avertissement sans
  correction silencieuse.
- Détection de doublons : empreinte SHA-256 exacte → statut `DUPLICATE` et proposition refusée ;
  même numéro + même tiers → avertissement avant approbation.
- Correction de tous les champs extraits, puis génération d’une **proposition d’écriture** :
  compte de charge/produit, TVA, tiers, débits/crédits, équilibre vérifié, champs incertains
  listés. Les comptes proposés sont **uniquement des comptes actifs** de la société.
- L’approbation humaine crée une **écriture en brouillon** dans un journal actif ; elle reste à
  comptabiliser dans le module Écritures. Aucune validation automatique, aucune double
  comptabilisation.
- Mémorisation des affectations uniquement **après approbation** (société + tiers + mots-clés
  de la ligne). Une proposition refusée n’écrit aucune règle.
- Écran **Documents → Scan & Import** : historique, aperçu du document original, avertissements,
  corrections, proposition éditable, approbation/refus, lien vers les écritures.

### Plan comptable bilingue

- Chaque compte accepte désormais : numéro, libellé anglais, libellé français, libellé historique
  (`name`, conservé comme repli), type, parent, `posting_allowed`, actif/inactif, rôle comptable
  optionnel et code TVA par défaut optionnel.
- Trois profils configurables par société :
  1. **Mauritius Chart of Accounts — Provisional Template** : modèle de démonstration,
     **aucun numéro présenté comme obligatoire**, statut `PENDING PROFESSIONAL VALIDATION` ;
     seuls les codes absents sont ajoutés.
  2. **Accounting Firm Chart of Accounts** : import **CSV/XLSX** via le parseur existant,
     **mapping des colonnes**, aperçu ligne par ligne, détection des doublons (dans le fichier et
     dans le plan existant), confirmation avant import, statut `AWAITING FIRM CONFIRMATION`.
  3. **Custom Company Chart of Accounts** : création/modification/désactivation avec les
     contraintes existantes ; possibilité de partir du modèle provisoire.
- Confirmation finale du plan par un rôle administrateur, avec motif obligatoire.
- Le changement de langue ne modifie **que les libellés** : les numéros et les écritures
  historiques ne sont jamais touchés. Un libellé manquant est affiché avec un badge
  « libellé manquant » ; aucune traduction n’est inventée.
- Aucune renumérotation : un import ignore un code déjà présent, même si son libellé diffère.

### Import MCB

- Importeur PDF natif greffé sur le module bancaire existant :
  `POST /companies/:id/bank/mcb/preview` et `POST /companies/:id/bank/mcb/import`.
- Extraction du texte PDF (ou OCR si le PDF est scanné), puis lecture des colonnes
  `Transaction Date`, `Value Date`, `Transaction Details`, `Debit`, `Credit`, `Balance` et des
  soldes d’ouverture/clôture.
- Descriptions sur plusieurs lignes (ex. `Debit Card Purchase` puis le commerçant),
  libellés `JUICE`, `Cash Deposit`, `Credit Interest`, `Charges`, `Refill Amount`,
  `VAT on Refill` conservés.
- **Signe et montant déduits du mouvement du solde** : le débit/crédit imprimé est contrôlé
  contre ce mouvement ; une divergence produit un avertissement, le montant n’est pas corrigé.
- Aperçu avant import avec nombre d’opérations, doublons déjà importés (empreinte), soldes
  calculé/comparé et continuité. L’import réutilise le moteur bancaire existant, donc les
  contrôles, empreintes, journaux, périodes et rapprochements restent ceux de la mission 9.
- Validation humaine obligatoire (`confirm: true`) ; le libellé bancaire n’est jamais traité
  comme une preuve de la nature comptable.

### Interface

- **Documents → Scan & Import**, **Comptabilité → Plan comptable**, **Comptabilité → Banque →
  Importer un relevé MCB**. Textes nouveaux en français et en anglais professionnel.
- Mise en page responsive, zones de dépôt, tableaux à défilement horizontal contenu, aucun
  forçage du focus ni réouverture du clavier.

## 3. Fonctionnalités simulées ou incomplètes

- **Démonstration GitHub Pages** : aucun OCR, aucun parsing PDF, aucun import MCB réel n’est
  exécuté dans le navigateur. Les documents et le relevé MCB sont des fixtures **préenregistrées**
  et l’écran l’écrit explicitement. Le backend démo (localStorage) simule les décisions et crée
  un brouillon local ; rien n’est envoyé ni stocké sur un serveur.
- **OCR** : moteur réel côté API, mais les essais sont faits sur des PDF/images **synthétiques**.
  Aucune photo réelle de facture mauricienne, aucun reçu froissé, aucun manuscrit n’a été testé.
  La précision n’est pas mesurée statistiquement.
- **MCB** : le lecteur est conçu pour la mise en page initiale d’un relevé **Savings Regular
  Account** ; aucun relevé MCB réel n’a été fourni ni testé. Les autres comptes (courant, devises,
  prêts) et les mises en page différentes ne sont pas annoncés comme compatibles.
- Le PDF bancaire **générique** n’est toujours pas pris en charge ; seul l’importeur MCB dédié
  l’est. Les relevés CSV/TSV/XLSX continuent d’utiliser le module existant.
- Import MCB multipage : le texte des 5 premières pages est lu et concaténé ; aucune pagination
  réelle n’a été validée au-delà.
- Les propositions de contrepartie bancaire ne sont pas créées par l’écran MCB : après import,
  l’utilisateur ouvre l’écran Banque existant pour les propositions et le rapprochement.
- Aucune création automatique de fiche fournisseur/client : les correspondances sont proposées,
  le nom est éditable, mais la fiche doit exister dans les modules Achats/Facturation.
- Aucune comptabilisation automatique : l’approbation d’une proposition documentaire crée un
  **brouillon**, pas une écriture validée.
- Pas de génération PDF de facture à partir d’un scan, pas de reconnaissance de codes-barres,
  pas d’apprentissage statistique : uniquement des affectations explicites approuvées.
- **Non vérifié physiquement** : rendu sur Samsung Android réel et Chrome Windows. Les tests
  jsdom ne remplacent pas un essai appareil.
- Aucune conformité MRA/PAYE/CSG/NSF/IAS 37/IFRS n’est affirmée par cette mission.

## 4. Tests et CI

Exécutions locales du 1er novembre 2026 :

| Commande | Résultat |
|---|---|
| `npx vitest run apps/api/tests/mission23.test.ts` | **12/12** |
| `npx vitest run apps/api/tests` | **470 réussis, 11 ignorés** (32 fichiers, 1 ignoré) |
| `npm run test -w @mc/web` | **235/235** après ajout des tests mission 23 |
| `npm run typecheck` | **0 erreur** (API + web, y compris tests) |
| `npm run build` | API et web **OK** |
| `npm run build:demo` | **OK** (démo GitHub Pages, sans réseau) |
| `npx vitest run apps/api/tests/migrations.test.ts` | **6/6** |

Tests mission 23 ajoutés :

- exactitude HT/TVA/TTC, dates, numéro, lignes et quantité d’une facture texte ;
- refus de corriger silencieusement un total incohérent ;
- extraction PDF natif, **OCR réel d’une image**, **OCR réel d’un PDF scanné** ;
- descriptions MCB multi-lignes, débits/crédits signés, soldes d’ouverture/clôture ;
- rupture de continuité détectée sans modification des montants ;
- plan provisoire par défaut, modèle n’écrasant pas un compte existant ;
- libellés FR/EN distincts et code inchangé après modification ;
- aperçu/confirmation d’un import cabinet CSV avec doublon détecté ;
- import de facture, proposition équilibrée, approbation créant un brouillon ;
- doublon exact refusé en proposition ;
- isolation entre sociétés ;
- prévisualisation/import MCB PDF puis réimport sans doublon (7 opérations) ;
- backend démo : deux profils de plan, six documents, doublon, refus sans apprentissage,
  relevé MCB équilibré importé une seule fois ;
- écrans : statut provisoire, bascule FR/EN avec codes inchangés, historique/doublon visible,
  aperçu MCB avec continuité des soldes.

**CI** : exécution `41256479305` sur la branche, **succès** des trois tâches :
« Migrations against real PostgreSQL », « Typecheck, tests and build » et
« API tests against real PostgreSQL ». Aucune branche n’a été ajoutée à
`.github/workflows/pages.yml` et aucune publication n’a été déclenchée.

## 5. Résultats d’extraction OCR et MCB

### Facture texte de test (fictive)

Entrée : `ACME OFFICE SUPPLIES LTD`, `INV-2026-101`, 12/02/2026, échéance 11/03/2026, deux
lignes, HT 15 000,00, TVA 2 250,00, TTC 17 250,00, MUR.

Résultat déterministe :

- fournisseur `ACME OFFICE SUPPLIES LTD`, client `LAGON TRADING LTD` ;
- `INV-2026-101`, `2026-02-12`, `2026-03-11`, `MUR` ;
- `subtotal = 15000.0000`, `vatTotal = 2250.0000`, `total = 17250.0000` ;
- deux lignes avec quantités 10 et 2, prix unitaires 1 000,00 et 2 500,00 ;
- total incohérent (remplacé par 17 999,00) → avertissement `Subtotal + VAT ... does not equal
  the stated total`, aucune correction.

### OCR réel

- Image PNG rendue depuis un PDF synthétique : méthode `ocr_image`, texte reconnu contenant
  `ACME` et `INV-2026-101`, confiance moyenne affichée.
- PDF contenant uniquement cette image : méthode `ocr_pdf`, même reconnaissance.
- Aucun document réel, aucune donnée client, aucun document confidentiel.

### Relevé MCB fictif

- 7 opérations reconnues, soldes d’ouverture 15 000,00 et de clôture 15 924,75 ;
- `JUICE` −1 200,00 ; `Debit Card Purchase WINNER'S SUPERMARKET` −2 450,50 ;
  `Cash Deposit` +5 000,00 ; `Credit Interest` +45,25 ; `Charges` −125,00 ;
  `Refill Amount` −300,00 ; `VAT on Refill` −45,00 ;
- continuité des soldes vérifiée, aucun avertissement d’extraction ;
- aperçu : 7 lignes importables ; import : 7 ; réimport : 0 importé, rejeu détecté ;
- un solde de clôture falsifié produit `MCB_CLOSING_MISMATCH` sans changer les montants.

**Important** : ces résultats portent sur des **fixtures fabriquées** pour les tests et la démo.
Ils ne démontrent pas la reconnaissance d’un vrai relevé MCB ni d’une vraie facture.

## 6. État du plan comptable bilingue

- Migration additive : `accounts.name_en`, `accounts.name_fr`, `posting_allowed` (défaut vrai),
  `account_role`, `vat_default` ; table `chart_profiles` avec les trois types et les trois statuts.
- Les comptes existants conservent leur `name` ; `name_en`/`name_fr` restent nuls jusqu’à saisie
  ou import. L’interface affiche alors le libellé historique et un badge explicite. La
  démonstration remplit les deux libellés pour ses comptes fictifs.
- Le formulaire de compte expose les deux libellés, le rôle, le drapeau `posting_allowed` et le
  code TVA optionnel. Le CRUD existant est étendu, pas remplacé.
- Import cabinet : parseur CSV/XLSX existant, alias de colonnes automatiques, mapping manuel
  dans l’écran, aperçu, doublons, confirmation. Aucun code existant n’est écrasé.
- Modèle provisoire : 31 comptes de démonstration, rôles comptables et libellés FR/EN. Aucun
  numéro n’est déclaré obligatoire ; le statut reste visible.
- Confirmation : motif d’au moins 10 caractères, rôle administrateur, horodatage et audit.
- Deux profils différents sont présents dans la démo (modèle provisoire et plan cabinet), et la
  bascule FR/EN conserve les numéros.

## 7. Questions à valider par l’expert-comptable

Une seule revue professionnelle est demandée ; ces questions sont regroupées et formulées en
anglais comme demandé.

1. May the provisional chart template be used by a client company before the firm has reviewed
   it, provided the status remains `PENDING PROFESSIONAL VALIDATION`?
2. Which persons may confirm a chart (`CONFIRMED BY FIRM`), and what evidence should be retained
   for that confirmation?
3. For a firm chart import, should an existing account code with a different label be skipped
   (current behaviour), rejected, or manually reconciled? No silent overwrite is implemented.
4. Are the current separate `name_en` and `name_fr` labels sufficient, or is a third legal/
   statutory label required for filing?
5. Which account roles must the firm configure before document proposals may be approved
   (payable/receivable, VAT input/output, default expense/revenue)?
6. Should approval of a document proposal create a draft only (current behaviour), or may a
   named accountant post it immediately in the same action?
7. What evidence should be stored with an OCR-corrected invoice: original file, corrected
   fields, reviewer, timestamp, or an additional approval note?
8. May supplier/customer master records be created automatically from an OCR match, or must the
   firm create them in the Purchases/Billing modules first?
9. For MCB statements, which layout(s) and account types should be in scope after the initial
   Savings Regular Account layout, and can anonymised sample statements be provided?
10. Are `JUICE`, `Refill Amount` and `VAT on Refill` to be classified by the firm as bank charges,
    telecom expenses or another category? The software deliberately does not decide.
11. What review is required before the first real client document is imported: sample size,
    error tolerance per field, four-eyes approval?
12. Which document retention period and storage location does the firm require? None is
    hard-coded; the current storage path is local and must be backed up by the operator.

## 8. Limites avant essais du cabinet

- **Aucun relevé MCB réel** ni facture réelle n’a été testé : le jeu fictif annoncé n’a pas été
  fourni. Le premier essai doit utiliser des documents anonymisés et une revue manuelle complète.
- L’OCR dépend de la qualité de la photo ; aucune garantie de précision, aucun score par champ
  validé statistiquement. Les champs manquants restent vides et doivent être saisis.
- Le PDF scanné est limité à 5 pages et les PDF volumineux/chiffrés ne sont pas traités.
- L’import MCB ne couvre que la mise en page initiale Savings Regular Account ; multi-comptes,
  devises et colonnes variables non garantis.
- La démonstration GitHub Pages est **préenregistrée** : elle ne prouve pas que l’OCR serveur
  fonctionne sur les documents du cabinet.
- L’isolation par société est contrôlée par l’API et le stockage ; aucune politique de
  sauvegarde/restauration n’est fournie par cette mission.
- Les dépendances ajoutées (`pdfjs-dist`, `pdf-to-img`, `tesseract.js`, données `eng`/`fra`) ont
  des licences permissives déclarées, mais l’**audit complet licences/métadonnées reste reporté**.
  `npm audit` signale des vulnérabilités dans des dépendances existantes (`@fastify/static`,
  `glob`, `minimatch`, `zod`) ; aucune correction n’a été appliquée dans cette mission.
- Rendu Samsung Android physique et Chrome Windows non vérifiés dans cette session.
- Aucun test de charge : taille des fichiers, nombre de documents, concurrence OCR.
- Aucune règle de TVA mauricienne, aucun numéro de compte obligatoire, aucune durée de
  conservation et aucune conformité MRA ne sont affirmés.
- Aucune fusion, aucun déploiement OVH, aucune publication Pages, aucun accès aux autres dépôts.
