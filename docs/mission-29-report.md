# Mission 29 — OCR comptable fiable, extraction bancaire et préparation à l’audit de production

Date : 2026-11-01  
Branche de session : `arena/bc5969d1-mauritius-compta`  
Base : `main` = `512bf26` ; PR nº 11 (mission 28) **toujours en brouillon et non fusionnée**  
Commit de code M29 : `66ac1f9`  
PR : [nº 11 — brouillon](https://github.com/azharshahim/mauritius-compta/pull/11)

> **Statut : travail de mission, pas une validation de production.** Les taux de la section 4 portent uniquement sur des **fixtures synthétiques**. Ils ne constituent ni une mesure de fiabilité générale, ni une garantie sur des factures ou relevés clients réels. Le logiciel n’est pas déclaré prêt pour la production.

## 1. Audit du moteur existant

### 1.1 Chaîne réellement exécutée

Le flux documentaire existant a été conservé et instrumenté, sans second moteur :

1. envoi du fichier et contrôle de taille, d’extension et de **signature binaire** ;
2. calcul du SHA-256 et stockage privé ;
3. extraction du texte : PDF natif via `pdfjs-dist`, sinon rendu des pages via `pdf-to-img` puis OCR local **Tesseract** (`eng` + `fra`) ;
4. parsing déterministe des champs par `parse-invoice.ts` ;
5. détection exacte de doublon par empreinte ;
6. proposition d’imputation par les règles et l’historique existants ;
7. correction humaine, approbation ou rejet ;
8. création d’un **brouillon** uniquement après confirmation ; aucune comptabilisation automatique.

### 1.2 Ce qui était réellement opérationnel avant M29

| Domaine | Constat |
|---|---|
| Import PDF/JPG/PNG | Opérationnel ; validation par signature, taille limitée à 8 Mo, stockage privé. |
| PDF texte | Opérationnel avec `pdfjs-dist` ; reconstruction de lignes sensible aux colonnes. |
| PDF image / scan | Opérationnel avec rendu `pdf-to-img` et OCR Tesseract local ; aucune dépendance à un service externe. |
| Factures | Fournisseur, numéro, dates, devise, HT, TVA, TTC, lignes et doublons déjà extraits sur les cas simples. |
| Relevés bancaires | CSV/TSV/XLSX via le moteur existant ; **un seul profil PDF dédié : MCB**. |
| SBM / Absa Mauritius / MauBank | Seule une détection de nom existait ; **aucun parseur dédié, aucun échantillon officiel**. |
| Doublons | Empreinte exacte du fichier, pas de détection sémantique de quasi-doublon. |
| Propositions | Règles + historique + type de compte ; validation humaine obligatoire. |
| Corrections | Enregistrement des champs et audit ; pas de ré-extraction à la demande. |
| Traçabilité | Journal d’audit existant ; pas de confiance par champ ni de qualité d’extraction structurée. |
| Démo | Documents préenregistrés ; les écrans de démonstration ne prouvent pas le moteur réel. |

### 1.3 Erreurs, angles morts et améliorations identifiés

1. **Faux total de TVA** : un libellé non ancré pouvait lire `VAT TEST SUPPLIES LTD` comme une ligne de TVA et produire un total négatif ; un taux imprimé (`VAT 15%`) pouvait aussi être lu comme un montant. Les libellés de totaux sont désormais ancrés en début de ligne et les pourcentages sont exclus des montants.
2. **Champs fiscaux ignorés** : BRN et numéros de TVA fournisseur/client n’étaient ni extraits ni stockés.
3. **Avoirs non distingués** : une note de crédit pouvait être traitée comme une facture d’achat normale, avec un sens de proposition incorrect.
4. **Remise et référence de commande absentes** : la remise n’était pas conservée comme donnée distincte et le bon de commande n’était pas extrait.
5. **Confiance uniforme** : la confiance globale ne permettait pas de savoir **quel champ** vérifier ; aucune liste de champs incertains n’était persistée.
6. **Multipage limité à 5 pages** et aucun décompte des pages vides ou non lues.
7. **PDF à plusieurs factures** : aucun avertissement ; le texte était concaténé et pouvait produire une proposition unique et fausse.
8. **Pas de ré-extraction** : après amélioration du parser ou correction du scan, il fallait réimporter le fichier.
9. **Relevé PDF** : le numéro de compte était renvoyé en clair ; les lignes de solde et les doublons de lignes n’étaient pas suffisamment signalés.
10. **Libellés longs tronqués** : la limite de 240 caractères pouvait couper une référence bancaire utile.
11. **Banques non MCB** : le moteur pouvait laisser croire à un support dédié alors qu’il n’utilisait qu’un profil générique.
12. **Devise supposée** : une proposition pouvait retomber sur `MUR` alors que la devise n’avait pas été extraite. La proposition est désormais bloquée (`DOCUMENT_CURRENCY_MISSING`) jusqu’à correction humaine.
13. **Interface** : le document original et les données extraites n’étaient pas présentés côte à côte, les champs incertains n’étaient pas distingués et l’import groupé ne remontait pas l’incertitude documentaire.

### 1.4 Cas non couverts après M29

- tableaux complexes, cellules fusionnées, colonnes décalées et factures multi-colonnes ;
- écriture manuscrite, scans très inclinés, taches, fax, faible résolution ;
- découpage automatique d’un PDF contenant plusieurs factures (un avertissement est émis, **aucune séparation automatique**) ;
- rattachement page par page des factures d’un lot ;
- quasi-doublons (même facture rescannée avec une autre empreinte) ;
- relevés bancaires scannés en colonnes, multi-comptes dans un même PDF, IBAN complet ;
- conversion de devises et taux officiels ;
- signature électronique, facture PDF/A, XML Factur-X.

## 2. Modifications réellement réalisées

### 2.1 Extraction et parsing des factures

| Fichier | Modification |
|---|---|
| `apps/api/src/modules/documents/extract.ts` | Limite portée de 5 à **10 pages** ; confiance OCR moyenne, texte et confiance **par page** ; avertissements sur pages vides et pages non lues. |
| `apps/api/src/modules/documents/parse-invoice.ts` | Réécriture du parsing : type de document (`invoice`, `credit_note`, `unknown`), remise, bon de commande, conditions de paiement, identifiants BRN/TVA fournisseur et client, références, confiance par champ, champs incertains, codes d’avertissement, détection d’un PDF multipage et de plusieurs factures suspectées. |
| `apps/api/sql/migrations/0023_document_extraction_quality.sql` | Colonnes additives : `document_type`, `discount_total`, `tax_ids`, `purchase_order`, `payment_terms`, `field_confidence`, `uncertain_fields`, `extraction_quality`, avec index par société et type. Aucune donnée n’est inventée par la base. |
| `apps/api/src/modules/documents/service.ts` | Persistance des nouveaux champs ; confiance sur les champs critiques ; avertissement OCR faible ; objet `extraction_quality` ; **ré-extraction** avec prévisualisation (`apply: false`) ou application (`apply: true`) ; audit ; proposition adaptée aux avoirs et remises, valeurs absolues ; **refus de toute proposition sans devise** (`DOCUMENT_CURRENCY_MISSING`). |
| `apps/api/src/modules/documents/routes.ts` | `POST /companies/:companyId/documents/:documentId/reextract` et exposition des nouveaux champs. |
| `apps/api/src/lib/errors.ts` | Nouveau code `DOCUMENT_NOT_REEXTRACTABLE`. |

Règles conservées :

- jamais de champ inventé : un champ absent reste vide et devient incertain ;
- montants en `numeric(20,4)` et calculs en `BigInt` via `lib/money.ts` ;
- une remise n’est soustraite que si elle est imprimée ;
- une note de crédit est conservée avec les montants **tels qu’imprimés** et inversée uniquement dans la proposition ;
- aucune proposition n’est approuvée automatiquement ;
- aucune écriture n’est postée par le moteur documentaire.

### 2.2 Relevés bancaires

| Fichier | Modification |
|---|---|
| `apps/api/src/modules/bank/mcb.ts` | `profileKey = 'mcb' \| 'generic'` distinct de `detectedBankKey = 'mcb' \| 'sbm' \| 'absa' \| 'maubank' \| 'generic'` ; numéro de compte **masqué** (`****8901`) ; colonne `Reference` ; conservation de `directionVerified`, `duplicateOfLine`, `sourceLine` ; avertissements `BANK_PDF_DUPLICATE_ROW`, `BANK_PDF_GENERIC_PROFILE`, `BANK_PDF_OPENING_MISSING`. |
| `apps/api/src/modules/bank/engine.ts` | Libellés jusqu’à 2 000 caractères et références jusqu’à 240 caractères, sans troncature silencieuse avant revue. |
| `apps/api/src/modules/bank/routes.ts` | `detectedBankKey` exposé dans la prévisualisation et la construction. |

**Ce qui n’a pas été fait, volontairement :** aucun parseur dédié n’a été inventé pour SBM, Absa ou MauBank. Ces noms sont détectés et signalés comme **profil générique**, avec un avertissement explicite. Aucun format n’est présenté comme certifié.

### 2.3 Interface de vérification

| Fichier | Modification |
|---|---|
| `apps/web/src/pages/documents/ScanImport.tsx` | Grille `document original \| données extraites` ; champs incertains surlignés ; bandeau « champs à vérifier » ; champs type de document, remise, bon de commande, conditions de paiement, BRN/TVA fournisseur et client ; bouton de ré-extraction (masqué en démo) ; lecture de `?doc=<id>` pour ouvrir directement une fiche. |
| `apps/web/src/pages/documents/BulkImport.tsx` | Badge avoir, avertissement de champs incertains, nouveaux champs dans la ligne et la fiche. |
| `apps/web/src/components/ui.tsx` | `Field` accepte `className` pour le surlignage. |
| `apps/web/src/pages/accounting/BankMcb.tsx` | Affichage du profil de banque détecté à côté du nom et du compte masqué. |
| `apps/web/src/styles.css` | `.doc-review-grid`, `.doc-tax-ids`, `.field-uncertain`, adaptation une colonne sur écran étroit. |
| `apps/web/src/i18n.tsx` | 16 clés FR + EN pour les nouveaux libellés ; aucun texte visible codé en dur. |

L’aperçu du document original utilise un blob local pour un fichier choisi pendant la session, ou l’URL privée du document en mode réel. En mode démonstration, les fixtures n’ont pas de binaire : un message explicite l’indique, plutôt que d’afficher un faux document.

### 2.4 Tests ajoutés

- `apps/api/tests/mission29.test.ts` : 14 tests, fixtures synthétiques et **OCR réel** via `pdf-to-img` + Tesseract.
- `apps/web/tests/mission29-ui.test.tsx` : 2 tests jsdom, ouverture directe par `?doc=`, grille côte à côte, champs fiscaux, bascule FR/EN.
- `apps/api/tests/mission23.test.ts` : deux attentes ajustées au **masquage volontaire** du numéro de compte (`****8901`).

## 3. Formats et banques effectivement testés

| Élément | Testé réellement ? | Preuve / limite |
|---|---|---|
| PDF texte (facture EN) | Oui | `extractDocument` + `pdf_text` dans `mission29.test.ts`. |
| PDF multipage (2 pages) | Oui | `pageCount = 2`, `pages` de longueur 2, `MULTIPAGE_SOURCE`. |
| PDF rendu en image → OCR | Oui | Rendu `pdf-to-img` puis `ocr_image` ; texte contient `NORTHSTAR`. |
| Facture française avec remise | Oui | Fixture `FR_DISCOUNT_INVOICE` ; remise et total vérifiés. |
| Facture sans TVA | Oui | Fixture `NO_VAT_INVOICE` ; TVA absente sans invention. |
| Avoir fournisseur | Oui | `documentType = credit_note`, proposition équilibrée avec `payable` au débit. |
| PDF contenant deux factures | Oui, avertissement seulement | `MULTIPLE_INVOICES_SUSPECTED` ; **aucun découpage automatique**. |
| Devise étrangère (USD) | Oui | Symbole `$` et code `USD`, fixturé. |
| Document corrompu | Oui | Signature refusée ; jamais interprété comme PDF. |
| Relevé MCB synthétique | Oui | Profil `mcb`, soldes, débits/crédits, doublons, libellés longs. |
| Relevé SBM synthétique | Détection seulement | `detectedBankKey = sbm`, profil `generic`, avertissement. |
| Relevé Absa Mauritius synthétique | Détection seulement | `detectedBankKey = absa`, profil `generic`, avertissement. |
| Relevé MauBank synthétique | Détection seulement | `detectedBankKey = maubank`, profil `generic`, avertissement. |
| Échantillon bancaire officiel | **Non** | Aucun document officiel ou réel n’a été utilisé. |
| Facture client réelle anonymisée | **Non** | Aucune donnée client réelle dans le dépôt. |
| Relevé scanné en colonnes | **Non** | Non couvert par un test représentatif. |

## 4. Résultats détaillés des tests

### 4.1 Métriques d’extraction des factures

Les métriques sont produites par `MISSION29_INVOICE_METRICS` sur **8 documents synthétiques**, soit **60 champs attendus**. Le taux affiché est un taux **sur ces fixtures**, sans intervalle de confiance et sans extrapolation.

| Champ | Testés | Corrects | Taux |
|---|---:|---:|---:|
| `supplierName` | 2 | 2 | 100 % |
| `invoiceNumber` | 8 | 8 | 100 % |
| `invoiceDate` | 7 | 7 | 100 % |
| `dueDate` | 1 | 1 | 100 % |
| `currency` | 8 | 8 | 100 % |
| `subtotal` | 7 | 7 | 100 % |
| `vatTotal` | 7 | 7 | 100 % |
| `total` | 7 | 7 | 100 % |
| `documentType` | 8 | 8 | 100 % |
| `supplierBrn` | 1 | 1 | 100 % |
| `supplierVat` | 1 | 1 | 100 % |
| `customerBrn` | 1 | 1 | 100 % |
| `purchaseOrder` | 1 | 1 | 100 % |
| `discountTotal` | 1 | 1 | 100 % |
| **Total** | **60** | **60** | **100 % sur ces fixtures uniquement** |

**Lecture correcte :** ces chiffres prouvent que le parser reconnaît les 14 types de champs sur les 8 documents construits pour le tester. Ils ne prouvent pas qu’il reconnaîtra 100 % des factures mauriciennes réelles. Aucun taux de fiabilité général n’est annoncé.

### 4.2 Couverture des 15 scénarios demandés

| nº | Scénario | Résultat |
|---:|---|---|
| 1 | Facture en anglais | ✅ champs principaux et lignes, `pdf_text`. |
| 2 | Facture en français | ✅ fournisseur, dates, remise et totaux. |
| 3 | Facture avec TVA | ✅ TVA et TTC cohérents. |
| 4 | Facture sans TVA | ✅ aucune TVA inventée, avertissement approprié. |
| 5 | Avoir fournisseur | ✅ type `credit_note`, montants imprimés conservés, proposition inversée. |
| 6 | Facture multipage | ✅ 2 pages lues, avertissement `MULTIPAGE_SOURCE` ; pas de fusion de deux factures distinctes. |
| 7 | PDF image / OCR | ✅ OCR réel, confiance > 0, méthode `ocr_image` ; qualité non calibrée. |
| 8 | Plusieurs factures dans un PDF | ✅ détection `MULTIPLE_INVOICES_SUSPECTED` ; **traitement non automatisé**. |
| 9 | Devise étrangère | ✅ USD reconnu, aucun taux inventé. |
| 10 | Relevé débits/crédits | ✅ sens conservé, montants signés, soldes contrôlés. |
| 11 | Relevé multipage | ✅ lignes de deux pages conservées, en-têtes ignorés. |
| 12 | Libellés longs | ✅ libellé > 100 caractères conservé, référence `REF-2026-0001`. |
| 13 | Lignes de solde | ✅ lignes `Opening/Closing Balance` exclues des transactions. |
| 14 | Doublon bancaire | ✅ `BANK_PDF_DUPLICATE_ROW`, `duplicateOfLine` pointe la première ligne. |
| 15 | Document illisible/corrompu | ✅ signature refusée, jamais traité comme un PDF. |

### 4.3 Contrôles bancaires vérifiés

- quatre noms de banques détectés : MCB, SBM, Absa Mauritius, MauBank ;
- MCB : profil dédié ; SBM/Absa/MauBank : **profil générique** + avertissement explicite ;
- débit/crédit jamais inversés sur les fixtures ; `directionVerified` vrai lorsque le solde d’ouverture permet le contrôle ;
- sans solde d’ouverture : `BANK_PDF_OPENING_MISSING` et direction non vérifiée ;
- numéro de compte masqué (`****8901`) ;
- lignes de solde exclues ;
- doublons signalés, sans suppression automatique ;
- libellés et références longs conservés.

### 4.4 Traçabilité API

- `field_confidence`, `tax_ids`, `purchase_order` et `extraction_quality.method` sont persistés et relus ;
- `POST …/reextract` avec `apply: false` ne modifie rien et renvoie `changedFields` ;
- avec `apply: true`, les champs sont mis à jour et **deux entrées d’audit** sont écrites ;
- un avoir fournisseur produit une proposition équilibrée avec le compte fournisseur au **débit** ;
- une remise imprimée produit une ligne distincte « Discount stated on document » et la proposition reste équilibrée ;
- la proposition reste au statut brouillon ;
- une facture sans devise ne produit **aucune** proposition : le serveur exige une correction humaine.

### 4.5 Suites complètes

| Suite | Résultat |
|---|---|
| API `npm test -w @mc/api` | **492 tests passés, 11 ignorés** (503), 32 fichiers passés + 1 fichier ignoré. |
| Web `npm test -w @mc/web` | **275 tests passés** (40 fichiers), après correction du test M29. |
| Typecheck (`npm run typecheck`) | **Passé** : API et web, 0 erreur. |
| Build API + Web (`npm run build`) | **Passé** ; avertissement Vite de bundle web > 500 kB (1 238 kB, 307 kB gzip), sans erreur. |
| `build:demo` (`VITE_DEMO_MODE=true`) | **Passé**. |
| Tests navigateur réels | **Non exécutés** ; jsdom uniquement. |

## 5. Régressions

- **Aucune régression fonctionnelle détectée** par les suites API (492/492 actifs) et web (275/275) après les modifications.
- Deux attentes de `mission23.test.ts` ont été modifiées **volontairement** : le numéro de compte bancaire est désormais masqué (`****8901` au lieu du numéro complet). Ce n’est pas une régression, c’est une exigence de protection des données.
- `bank.test.ts` (28) reste vert avec la colonne `Reference` ajoutée.
- La migration `0023` est additive ; `migrations.test.ts` et `migration.test.ts` passent.
- La suite `mission23.test.ts` (18) reste verte après l’ancrage des libellés de TVA et les nouveaux champs.
- **Non vérifié :** parcours Playwright, navigateur réel, mobile physique, restauration de base, charge.

## 6. Limites connues

1. **Fixtures synthétiques uniquement** : aucune facture ou relevé client réel n’a été traité. Les taux de la section 4 ne sont pas transposables.
2. **Pas de calibration statistique** : 8 factures et 4 banques ne constituent pas un échantillon représentatif de la diversité mauricienne.
3. **OCR non calibré** : Tesseract local, `eng` + `fra` ; pas d’évaluation sur scans dégradés, manuscrits, rotatifs ou fax.
4. **Tableaux complexes non fiables** : les lignes sont extraites par reconstruction visuelle simple ; les cellules fusionnées et colonnes irrégulières peuvent produire des montants erronés.
5. **Plusieurs factures dans un PDF** : détectées mais **non séparées**. La vérification humaine doit bloquer le document.
6. **Plus de 10 pages** : les pages suivantes ne sont pas lues ; avertissement explicite.
7. **Doublons** : empreinte exacte seulement ; un rescannage du même document peut passer pour un nouveau document.
8. **Banques** : seul MCB dispose d’un profil dédié ; SBM, Absa et MauBank sont **génériques** et ne doivent pas être annoncés comme supportés au sens d’un format certifié.
9. **Relevés scannés** : le parser bancaire attend du texte ; l’OCR d’un tableau peut décaler les colonnes. Aucun test représentatif.
10. **Devises** : aucun taux de change officiel n’est intégré ; toute conversion exige une saisie humaine.
11. **Ré-extraction** : refusée si le document n’est plus au statut `EXTRACTED` ; pas de versioning complet des anciennes extractions dans l’interface.
12. **Démo** : les fixtures n’ont pas de fichier binaire ; l’aperçu original n’est donc pas une preuve du rendu PDF réel.
13. **Interface** : tests jsdom uniquement ; aucun test physique Android/Samsung, Safari ou Firefox ; accessibilité non auditée.
14. **Sécurité et exploitation** : pas de test d’intrusion, de restauration, de charge ni de supervision.
15. **Bundle web** : le build signale un chunk principal de 1 238 kB (307 kB gzip) ; la découpe n’est pas optimisée pour un réseau mobile lent.

## 7. Checklist d’audit avant production

La checklist complète est publiée dans [`docs/preproduction-audit-checklist.md`](preproduction-audit-checklist.md).

Synthèse : **0 rubrique « Conforme et vérifié »**, **15 partiellement conformes**, **2 non conformes** (TVA/fiscalité MRA et conformité réglementaire), **3 non testées** (sauvegarde/restauration, performance/volumétrie, exploitation/surveillance).

Les portes de sortie comprennent : validation par un cabinet mauricien, conformité MRA e-Invoicing, jeux de relevés réels anonymisés par banque, test de restauration, revue de sécurité indépendante, test de charge, recette navigateur/mobile et procédure d’exploitation.

## 8. Commits et PR

| Élément | Référence |
|---|---|
| Base | `main` = `512bf26` |
| Commit de code M29 | `66ac1f9` — `feat: harden invoice extraction and bank statement controls` |
| Commit de documentation M29 | dernier commit de la branche (rapport et checklist) ; voir l’historique de la PR |
| PR | [nº 11 — brouillon](https://github.com/azharshahim/mauritius-compta/pull/11) |

**Note sur la branche :** Arena impose une branche de session unique (`arena/bc5969d1-mauritius-compta`). La mission 29 est donc empilée sur cette branche, au-dessus du commit `63550c3` de la mission 28. La PR nº 11 reste en brouillon et **n’a pas été fusionnée**. Aucun déploiement n’a été effectué.

## 9. Prochaines corrections prioritaires

1. **Constituer un corpus réel anonymisé** : 30 à 50 factures mauriciennes (FR/EN, avec/sans TVA, avoirs, multipages, scans) et des relevés officiels MCB, SBM, Absa et MauBank, avec un protocole de mesure par champ.
2. **Calibrer la confiance** : comparer `field_confidence` aux corrections humaines réelles, mesurer les faux positifs et les faux négatifs, définir un seuil de blocage.
3. **Traiter les PDF multi-factures** : segmentation page par page et création de documents distincts, uniquement après confirmation humaine.
4. **Renforcer les tableaux** : détection de colonnes, gestion des cellules fusionnées, test de lignes multi-lignes.
5. **Banques** : parseurs dédiés uniquement après obtention d’échantillons représentatifs et de tests de non-régression par banque ; sinon conserver le profil générique et le blocage.
6. **Relevés scannés** : tester l’OCR de tableaux, mesurer les décalages de colonnes et bloquer les lignes ambiguës.
7. **Sécurité** : revue indépendante, tests d’autorisation par route, chiffrement au repos, rotation des secrets, test d’intrusion.
8. **Exploitation** : test de restauration, supervision, alertes et test de charge avant toute mise en production.
9. **MRA e-Invoicing** : analyse du champ d’application et intégration certifiée ; ne pas présenter l’écran informatif actuel comme une conformité.
10. **Recette métier** : faire valider par un cabinet mauricien les plans, taux, états, avoirs, remises et mentions de facture.

## Conclusion

La mission 29 rend l’extraction **plus contrôlable et plus traçable** : champs fiscaux, remises, avoirs, confiance par champ, ré-extraction auditée, profil bancaire explicite, compte masqué et interface de vérification côte à côte. Elle ne transforme pas ces améliorations en garantie de production. Les mesures obtenues sont strictement limitées aux fixtures synthétiques décrites, et les rubriques non prouvées restent explicitement non conformes ou non testées.
