# COMPTAI — analyse des écarts Banque & rapprochement

**Mission 41 — audit fonctionnel, lecture seule**
**Base :** `main` = `8fd9a2d58aec9147b7530fcb971b3511e5757e16`
**Documents liés :** [audit général](./mission-41-accounting-functional-audit.md) · [achats/ventes](./comptai-purchases-sales-gap-analysis.md) · [plan M42/M43](./comptai-missions-42-43-implementation-plan.md)

> **Distinction fondatrice, vérifiée dans le code.** L’import d’un relevé, la comptabilisation d’une
> opération et le rapprochement bancaire sont trois opérations distinctes. Un import n’écrit aucune
> écriture ; un rapprochement confirmé ne comptabilise rien ; une proposition acceptée passe par le
> moteur comptable. Cette séparation est correctement implémentée et documentée.

## 1. Résumé

| Étape | Statut | Preuve |
|---|---|---|
| Profils d’import et détection des colonnes | **Implémenté** | `bank/profiles.ts`, `BANK_FIELDS`, scores déterministes |
| CSV / TSV / XLSX | **Implémenté** | `migration/parse.ts`, tests 1–3, 27 |
| PDF texte / PDF scanné / OCR bancaire | **Implémenté avec revue** | `bank/routes.ts:466-560` appelle `extractDocument` puis `parseMcbStatement` |
| Profil MCB dédié + profils génériques prudents | **Implémenté** | `bank/mcb.ts`, signatures de banques, blocage si ambigu |
| Débit/crédit, dates, libellés, références | **Implémenté** | `signedAmountOf`, `parseDate`, tests 3–5 |
| Doublons de fichier et de ligne | **Implémenté** | empreinte stable, `ALREADY_IMPORTED`, test 6–7 |
| Soldes d’ouverture / clôture du relevé | **Implémenté à l’import** | `buildBankPreview`, contrôles `OPENING_BALANCE_MISMATCH`, `CLOSING_BALANCE_MISMATCH` |
| Suggestions de comptes et validation humaine | **Implémenté** | `suggestAccount`, `bank_proposals`, `confirm:true` |
| Écritures de banque | **Partiel** | proposition acceptée = écriture postée directement ; pas de brouillon intermédiaire |
| Rapprochement partiel et multiple | **Implémenté** | `bank/billing.ts`, `bank/purchases.ts`, tests n→1, 1→n, refus de dépassement |
| Éléments en suspens | **Implémenté** | statuts `unmatched`, `proposed`, `review`, `partially_matched`, `excluded` |
| Rapport d’écart et historique | **Partiel** | rapport détaillé et `bank_events`, mais erreur de période et compteurs incomplets |
| Validation d’une période de relevé | **Manquant** | aucun objet « reconciliation statement » signé par période |

**Verdict.** L’import et le matching sont parmi les parties les plus matures du produit. Les écarts
M41 sont concentrés sur le **rapport de rapprochement**, la **lecture des statuts partiels** et la
**finalisation d’une période**. Aucun nouveau P0.

---

## 2. Constats détaillés

### C-01 — Le rapport bancaire sur période compare un solde de clôture à une variation comptable

| Champ | Contenu |
|---|---|
| **Module / workflow** | Banque → Rapport de rapprochement (`from` / `to`) |
| **Statut** | **Partiel** |
| **Sévérité** | **P1** — faux écart, risque de refus ou d’acceptation erronée |
| **Affectation** | **M43** |
| **Preuve code** | `bank/service.ts:1140-1154` : le solde comptable est `SUM(debit-credit)` **dans** `[from, to]`. Le solde bancaire est le dernier solde du relevé **dans** `[from, to]`, donc un solde cumulé de clôture. `difference = bankBalance - ledgerBalance` (`:1190-1194`). |
| **Preuve UI** | `apps/web/src/pages/accounting/Bank.tsx:708-720` transmet `from` et `to` au rapport. |
| **Scénario de reproduction** | Importer un relevé du 01/01 au 30/06 avec solde d’ouverture 10 000 et clôture 12 000. Demander le rapport du 01/03 au 30/06. Le grand livre de mars–juin ne contient pas le solde d’ouverture de janvier. |
| **Résultat attendu** | Comparer le solde bancaire de clôture au **solde comptable de clôture** (ouverture + mouvements de la période), et présenter séparément le solde d’ouverture. |
| **Résultat réel** | Le rapport compare 12 000 à la seule variation mars–juin, par exemple 1 500, et affiche un écart de 10 500. |
| **Cause racine** | Absence de solde d’ouverture comptable dans le calcul. |
| **Correction recommandée** | Calculer `openingLedger` avant `from`, `movement` dans la période, `closingLedger = opening + movement`; comparer à `closingBank`. Exposer les trois valeurs et la variation bancaire. |
| **Test de non-régression** | Relevé avec ouverture + mouvements ; rapport sur sous-période → écart nul si tout est rapproché ; rapport sans `from` inchangé. |

### C-02 — Le rapport simple omet les transactions partiellement rapprochées

| Champ | Contenu |
|---|---|
| **Module / workflow** | Banque → Rapport simple |
| **Statut** | **Partiel** |
| **Sévérité** | **P2** |
| **Affectation** | **M43** |
| **Preuve code** | `bank/service.ts:1161-1168` : `matched` ne compte que `status='matched'`; `unmatched` ne compte que `unmatched`, `proposed`, `review`. `partially_matched` n’est dans aucun compteur. |
| **Preuve test** | `bank-billing.test.ts` produit des transactions `partially_matched` (30 000 sur 80 000), mais aucun test ne vérifie les compteurs du rapport simple. |
| **Scénario de reproduction** | Rapprocher partiellement une transaction de 100 000 à hauteur de 30 000, puis ouvrir le rapport simple. |
| **Résultat attendu** | Compteurs distincts : rapprochées, partiellement rapprochées, non rapprochées, total. |
| **Résultat réel** | La transaction partielle n’apparaît ni dans `matchedCount` ni dans `unmatchedCount`. |
| **Cause racine** | Statut ajouté en M10 sans mise à jour de la requête de comptage. |
| **Correction recommandée** | Ajouter `partiallyMatchedCount`, inclure le statut dans le total, et l’afficher dans l’UI et le CSV. |
| **Test de non-régression** | 1 matched + 1 partially + 1 unmatched → 1/1/1 et total 3. |

### C-03 — Aucune validation formelle d’une période de relevé

| Champ | Contenu |
|---|---|
| **Module / workflow** | Banque → Clôture du rapprochement |
| **Statut** | **Manquant** |
| **Sévérité** | **P2** |
| **Affectation** | **M43** |
| **Preuve code** | `bankReport` expose `validatedAt`/`validatedBy`, mais ils proviennent du **dernier match confirmé** (`bank/service.ts:1179-1189`), pas d’une validation de période. Aucun objet ne stocke : période, solde d’ouverture, solde de clôture, écart accepté, commentaire, signature. |
| **Scénario de reproduction** | Rapprocher toutes les opérations de juin, puis vérifier qu’une « clôture juin » est enregistrée. |
| **Résultat attendu** | Un enregistrement daté par compte et période, avec statut « rapproché / écart accepté », auteur, commentaire et pièce. |
| **Résultat réel** | L’écran affiche la date et l’auteur du dernier match ; aucune période n’est validée. |
| **Cause racine** | Le rapport est calculé à la volée ; il n’a pas de cycle de vie. |
| **Correction recommandée** | Table `bank_reconciliation_periods` (compte, du, au, soldes, statut, écart, validé par/le, note, hash du relevé). Validation humaine explicite ; une nouvelle transaction dans la période rouvre le contrôle. |
| **Test de non-régression** | Validation juin → statut figé ; import juillet ne rouvre pas juin ; import juin après validation rouvre juin. |

### C-04 — Un encaissement bancaire ne peut pas devenir un règlement client depuis l’écran Banque

| Champ | Contenu |
|---|---|
| **Module / workflow** | Banque → Crédit bancaire → Facture client |
| **Statut** | **Partiel** (matching d’un règlement existant) / **Manquant** (création du règlement) |
| **Sévérité** | **P2** |
| **Affectation** | **M43** |
| **Preuve code** | `bank/billing.ts:467-474` exige un paiement **déjà alloué à au moins une facture**. Le panneau Banque liste des candidats et permet de comptabiliser le paiement, mais pas de créer un paiement ni de l’affecter à une facture. |
| **Scénario de reproduction** | Importer un virement client de 5 000 MUR sans avoir créé le paiement dans Facturation ; ouvrir la transaction bancaire. |
| **Résultat attendu** | Action « Créer le règlement et l’affecter à une facture », avec proposition d’affectation, confirmation humaine et comptabilisation séparée. |
| **Résultat réel** | Aucun candidat ; il faut d’abord créer le paiement dans Facturation. |
| **Cause racine** | Le rapprochement banque est conçu comme un lien vers un objet commercial préexistant, pas comme un point d’entrée. |
| **Correction recommandée** | Assistant de création de règlement depuis la transaction, réutilisant `createPayment` + allocation, sans écriture automatique ; validation humaine. |
| **Test de non-régression** | Transaction → paiement créé → facture soldée → lien bancaire unique ; pas de doublon si l’opération est rejouée. |

---

## 3. Points vérifiés sans anomalie

- **Import idempotent** : hash de fichier + empreinte de ligne + `ON CONFLICT DO NOTHING`; réimport testé.
- **Doublons internes** : lignes identiques ignorées et signalées ; conflit d’identifiant externe bloquant.
- **Direction** : débit = sortie, crédit = entrée ; un indicateur débit/crédit inconnu bloque.
- **Devise** : une devise différente du compte est refusée, sans conversion inventée.
- **Soldes** : un solde courant incohérent produit une erreur bloquante ; le montant n’est jamais corrigé.
- **Période comptable** : les opérations hors période ouverte sont signalées ; la comptabilisation reste bloquée.
- **Validation humaine** : `confirm:true` obligatoire pour confirmer un match ou accepter une proposition.
- **Rapprochement partiel** : une transaction peut être allouée à plusieurs paiements et un paiement à plusieurs transactions, dans la limite des montants disponibles.
- **Annulation** : un lien rejeté reste dans l’historique ; un paiement rapproché ne peut pas être annulé sans délier.
- **Isolation** : company/cabinet contrôlés, tests dédiés.
- **Piste d’audit** : `bank_events` et `audit_log` conservent les décisions.

## 4. Ce que M43 ne doit pas casser

- Ne pas fusionner import, comptabilisation et rapprochement.
- Ne pas automatiser un match ambigu : la confiance doit rester une suggestion.
- Ne pas modifier un montant bancaire pour « équilibrer ».
- Ne pas créer une seconde écriture de banque quand une proposition est acceptée.
- Ne pas perdre l’historique des liens rejetés.
- Ne pas désactiver les contrôles de devise, de période ou de dépassement.
