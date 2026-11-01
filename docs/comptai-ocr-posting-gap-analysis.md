# COMPTAI — analyse des écarts OCR & comptabilisation automatique

**Mission 41 — audit fonctionnel, lecture seule**
**Base :** `main` = `8fd9a2d58aec9147b7530fcb971b3511e5757e16`
**Documents liés :** [audit général](./mission-41-accounting-functional-audit.md) · [achats/ventes](./comptai-purchases-sales-gap-analysis.md) · [plan M42/M43](./comptai-missions-42-43-implementation-plan.md)

> **Règle de sécurité respectée.** Aucune comptabilisation automatique silencieuse n’a été trouvée.
> L’OCR produit une proposition ; un humain doit l’approuver ; l’approbation crée un **brouillon**,
> pas une écriture postée. Cette exigence est correcte pour un pilote professionnel et doit être
> conservée.

## 1. Verdict : opérationnel ou partiel ?

**Le workflow OCR est partiel, pas opérationnel de bout en bout.**

| Segment | Statut | Précision |
|---|---|---|
| Dépôt PDF / JPG / PNG | **Implémenté** | Signature binaire vérifiée, MIME déclaré contrôlé, taille limitée |
| Extraction texte PDF | **Implémenté** | `pdfjs-dist` |
| OCR image et PDF scanné | **Implémenté** | `tesseract.js`, langues `fra`/`eng`, confiance par page |
| Reconnaissance fournisseur, date, numéro, montants, TVA | **Implémenté avec incertitude explicite** | Parseur déterministe, `field_confidence`, `uncertain_fields` |
| Détection de doublons | **Partiel** | Hash exact bloquant ; même numéro+fournisseur en alerte ; rescannage différent non détecté |
| Suggestion de comptes | **Implémenté** | Règles déterministes, comptes réels, apprentissage après deux approbations |
| Revue et correction humaines | **Implémenté** | Écran Scan & Import, proposition éditable |
| Création d’une facture fournisseur | **Manquant** | Aucune `purchase_documents` créée |
| Comptabilisation | **Partiel** | Une écriture `draft` est créée ; le postage manuel dans Journaux est possible, mais aucun postage depuis l’OCR |
| Traçabilité pièce ↔ écriture | **Partiel** | `document_proposals.draft_entry_id` ; pas de lien au sous-registre achat |
| PDF multi-factures | **Partiel** | Détection, pas de séparation |
| Validation sur documents réels | **Non vérifié** | Fixtures fictives uniquement |

**Conclusion.** La démonstration peut montrer : téléversement, OCR, champs extraits, confiance,
correction, proposition équilibrée, approbation et création d’un brouillon. Elle **ne peut pas**
montrer : facture fournisseur créée, paiement, lettrage, aging, rapprochement bancaire à partir de
cette facture, ni comptabilisation finale depuis l’écran OCR. Il faut une double saisie manuelle.

---

## 2. Constats détaillés

### D-01 — Le parcours OCR s’arrête à une écriture brouillon et ne crée aucune facture d’achat

| Champ | Contenu |
|---|---|
| **Module / workflow** | Scan & Import → Proposition → Approbation → Achats / Comptabilité |
| **Statut** | **Partiel** (OCR + proposition + brouillon) / **Manquant** (facture fournisseur et postage depuis l’OCR) |
| **Sévérité** | **P1** — bloqueur de démonstration |
| **Affectation** | **M42** |
| **Preuve code** | `documents/service.ts:655-686` : `prepareEntry`, puis `INSERT INTO journal_entries ... 'draft','manual'`; mise à jour `document_imports.status='APPROVED'`. Aucune insertion `purchase_documents`. Retour : « A draft entry was created. It is not posted until an accountant posts it in Journals. » |
| **Preuve UI** | `ScanImport.tsx:660-665` : après approbation, seul un bouton « Ouvrir les écritures » est proposé. Aucun bouton « Comptabiliser ». |
| **Preuve test** | `mission23.test.ts` vérifie `draftEntry.status === 'draft'`; `mission29.test.ts` vérifie la proposition et les métriques, pas la création d’une facture fournisseur. |
| **Scénario de reproduction** | Téléverser une facture fournisseur fictive de 17 250 MUR, générer la proposition, approuver avec `confirm:true`, puis ouvrir Achats → Factures et le grand livre. |
| **Résultat attendu** | Après approbation : une facture fournisseur validée (ou une action explicite de conversion), liée à la pièce et à la proposition ; l’écriture reste en brouillon jusqu’à une action de comptabilisation distincte. |
| **Résultat réel** | Une écriture brouillon `source='manual'`; aucune facture fournisseur ; aucune possibilité de paiement/lettrage/aging. |
| **Cause racine** | Le module OCR est un module de propositions comptables autonome, non un point d’entrée du sous-registre achats. |
| **Correction recommandée** | 1) Enrichir l’approbation avec une action distincte « Créer la facture d’achat ». 2) Réutiliser la validation, la numérotation et les contrôles de doublon de `purchases`. 3) Lier `document_imports` ↔ `purchase_documents` ↔ proposition ↔ écriture. 4) Ajouter « Comptabiliser » depuis Scan & Import, avec confirmation explicite et passage par `postProposal`. |
| **Test de non-régression** | OCR → facture fournisseur → paiement → aging → comptabilisation ; un seul document, une seule écriture, aucun doublon au second clic. |

### D-02 — Un rescannage légèrement différent n’est pas détecté comme doublon

| Champ | Contenu |
|---|---|
| **Module / workflow** | Scan & Import → Dépôt → Doublons |
| **Statut** | **Partiel** |
| **Sévérité** | **P2** — déjà P2-04 au registre de préproduction |
| **Affectation** | **M42** |
| **Preuve code** | `documents/service.ts:100-105` : doublon exact par `sha256`. `:140-146` : alerte si même numéro + même fournisseur. Aucune similarité floue (image, OCR, montant/date). |
| **Scénario de reproduction** | Téléverser une facture, puis la même facture rescannée avec une rotation ou une compression différente. |
| **Résultat attendu** | Alerte de similarité, sans blocage automatique ; décision humaine. |
| **Résultat réel** | Aucun doublon détecté si le hash et le numéro OCR diffèrent légèrement ; risque de double proposition. |
| **Cause racine** | Détection fondée sur le fichier exact et des champs textuels stricts. |
| **Correction recommandée** | Score de similarité contrôlé (fournisseur normalisé, numéro normalisé, date ±3 jours, montant, total), seuils documentés, jamais de suppression automatique. |
| **Test de non-régression** | Rescannage → alerte ; facture légitime même montant mais numéro différent → simple avertissement. |

### D-03 — Un PDF contenant plusieurs factures est détecté mais non séparé

| Champ | Contenu |
|---|---|
| **Module / workflow** | Scan & Import → PDF multi-factures |
| **Statut** | **Partiel** |
| **Sévérité** | **P2** — déjà P2-03 |
| **Affectation** | **M42** |
| **Preuve code** | `parse-invoice.ts` expose `invoiceCountSuspected` et `MULTIPLE_INVOICES_SUSPECTED`; `documents/service.ts:167-176` stocke le soupçon dans `extraction_quality`. Aucune segmentation. |
| **Scénario de reproduction** | Téléverser un PDF de deux factures distinctes. |
| **Résultat attendu** | Blocage de la proposition ou segmentation assistée avec confirmation humaine. |
| **Résultat réel** | Une seule proposition, potentiellement avec des montants agrégés ou incomplets ; l’utilisateur doit séparer manuellement. |
| **Cause racine** | Absence de segmentation de pages. |
| **Correction recommandée** | Détecter les coupures (nouvel en-tête, nouveau numéro, nouvelle date), proposer des segments, faire confirmer chaque facture. |
| **Test de non-régression** | PDF 2 factures → 2 propositions distinctes après confirmation ; aucun doublon. |

### D-04 — Le statut « APPROVED » peut être lu comme « comptabilisé »

| Champ | Contenu |
|---|---|
| **Module / workflow** | Scan & Import → Statut du document |
| **Statut** | **Partiel** |
| **Sévérité** | **P2** |
| **Affectation** | **M42** |
| **Preuve code** | `documents/service.ts:684-686` met `document_imports.status='APPROVED'` alors que l’écriture est `draft`. L’écran affiche `APPROVED` et un lien vers les écritures, sans badge « brouillon non comptabilisé ». |
| **Scénario de reproduction** | Approuver une proposition, puis consulter la liste Scan & Import et le tableau de bord. |
| **Résultat attendu** | Statut explicite `APPROUVÉ — ÉCRITURE BROUILLON` ou `COMPTABILISÉ` selon l’état réel de l’écriture. |
| **Résultat réel** | « APPROVED » suggère une finalisation comptable alors que rien n’est posté. |
| **Cause racine** | Statut métier du document distinct du statut comptable, sans libellé de jonction. |
| **Correction recommandée** | Ajouter un statut dérivé `postingStatus` (`not_prepared`, `draft`, `posted`) et l’afficher partout. |
| **Test de non-régression** | Approbation → `draft`; postage → `posted`; libellés FR/EN cohérents. |

---

## 3. Ce qui fonctionne et mérite d’être conservé

- **Validation humaine obligatoire** : aucune écriture postée sans approbation explicite.
- **Refus des champs manquants** : devise absente, total absent, document dupliqué, proposition non
  équilibrée ou compte inactif bloquent.
- **Traçabilité OCR** : texte extrait, méthode (`pdf_text`, `ocr_image`, `ocr_pdf`), confiance,
  nombre de pages, avertissements, hash, fichier source conservé.
- **Revue champ par champ** : confiance par champ, champs incertains, correction manuelle auditée.
- **Apprentissage supervisé** : aucune règle n’est apprise avant deux approbations identiques ; une
  proposition rejetée n’apprend rien.
- **Sécurité des fichiers** : contrôle de signature binaire, refus des types non autorisés, stockage
  privé, `nosniff`, pas de contenu exécutable.
- **Bilinguisme** : messages et écrans FR/EN ; les noms propres et numéros ne sont pas traduits.

## 4. Limites de l’évidence

- Les tests OCR utilisent des PDF générés et des images fictives ; **aucune facture mauricienne réelle**
  n’a été testée.
- Les performances OCR sur des lots volumineux ne sont pas mesurées dans M41.
- Aucun test navigateur réel n’a été exécuté ; les écrans sont couverts en jsdom.
- La reconnaissance de certaines mises en page (colonnes, tampons, factures manuscrites) reste
  **non vérifiée** et ne doit pas être présentée comme acquise.

## 5. Recommandation M42

1. Faire de l’approbation OCR une **création de facture fournisseur** avec action explicite.
2. Conserver l’écriture en brouillon et une action de comptabilisation séparée.
3. Ajouter le statut comptable dérivé et le compteur « en attente de comptabilisation ».
4. Ajouter les alertes de rescannage et la segmentation multi-factures sans automatisme.
5. Tester le parcours complet avec des pièces fictives, puis avec un corpus anonymisé fourni par le
   cabinet — jamais avec des données client réelles dans le dépôt public.
