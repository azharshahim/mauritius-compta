# TVA — Value Added Tax (Mauritius)

> **Statut : NON IMPLÉMENTÉ dans la version 0.1.0.**
> Le module TVA n'existe pas encore. Aucun taux, seuil d'assujettissement, régime ou
> échéance n'est codé, calculé ou affiché par l'application.
> Les comptes de démonstration « TVA récupérable » (1200) et « TVA collectée » (2200)
> existent uniquement comme emplacements comptables : **aucun calcul de TVA n'y est associé**.

## 1. Pourquoi aucun taux n'est présent dans le code

La règle du projet est explicite : **ne jamais inventer de taux, de plafond ou d'obligation
légale**. Tant que les exigences officielles n'ont pas été vérifiées et archivées avec leur
date d'entrée en vigueur, l'application :

- ne propose aucun taux par défaut ;
- ne calcule aucune TVA sur les factures ;
- n'imprime aucune mention TVA sur les documents.

Toute future implémentation devra s'appuyer sur une ligne du
[`compliance-register.md`](./compliance-register.md) comportant : règle, statut, date
d'entrée en vigueur, référence officielle (texte, note de pratique, communiqué MRA) et URL
archivée.

## 2. Questions à documenter avant implémentation

| # | Sujet | Statut | Où vérifier |
|---|---|---|---|
| VAT-01 | Taux standard en vigueur et date d'effet | **À VÉRIFIER** | MRA — Value Added Tax Act 1998 et textes modificatifs, communiqués MRA |
| VAT-02 | Taux réduits / taux zéro / exonérations, par catégorie de biens et services | **À VÉRIFIER** | MRA — First Schedule et notes de pratique |
| VAT-03 | Seuil d'assujettissement obligatoire (chiffre d'affaires) | **À VÉRIFIER** | MRA — VAT Act / practice notes |
| VAT-04 | Périodicité des déclarations (mensuelle / trimestrielle) et échéances | **À VÉRIFIER** | MRA — communiqués de dépôt |
| VAT-05 | Format et canal de déclaration (portail MRA / MNS) | **À VÉRIFIER** | MRA |
| VAT-06 | Règles de facturation (mentions obligatoires, numérotation, avoirs) | **À VÉRIFIER** | MRA — VAT Act, règlements |
| VAT-07 | Autoliquidation / prestations de services étrangères / commerce international | **À VÉRIFIER** | MRA |
| VAT-08 | e-Invoicing : périmètre, format, calendrier | **À VÉRIFIER** | MRA (sources à archiver, ne pas se fier à des blogs) |
| VAT-09 | TVA sur acquisitions intra-groupe / importations | **À VÉRIFIER** | MRA |
| VAT-10 | Intérêts, pénalités et régularisations | **À VÉRIFIER** | MRA — textes en vigueur |

## 3. Architecture prévue (non développée)

Le module TVA devra être **paramétrable et multi-périodes** :

```text
vat_codes (company_id, code, label_fr, label_en, rate, kind[sales|purchase], effective_from, effective_to, legal_reference, status)
vat_transactions (company_id, entry_id, line_id, vat_code_id, base_amount, vat_amount, direction[output|input])
vat_returns (company_id, period_start, period_end, due_date, status, computed_output, computed_input, payable, filed_at, reference)
```

Exigences de conception :

1. **Versionner les taux** (`effective_from` / `effective_to`) : un taux historique ne doit
   jamais être réécrit rétroactivement.
2. **Tracer la source officielle** de chaque taux dans la base (champ `legal_reference`) et
   dans le journal d'audit.
3. **Ne jamais recalculer** une déclaration déjà déposée : snapshot immuable.
4. **Séparer** le calcul (déterministe, testé) de la déclaration (workflow).
5. Prévoir la **déclaration en langue anglaise** (documents officiels) tout en gardant l'UI
   bilingue.
6. Tests obligatoires : arrondis, exonérations, taux historiques, périodes à cheval,
   avoirs/notes de crédit, exports.

## 4. Ce qu'il ne faut pas faire

- ❌ Insérer un taux « par défaut » dans le code ou dans le plan de comptes de démonstration.
- ❌ Copier les règles françaises (CGI, taux français, mentions obligatoires françaises).
- ❌ Utiliser un blog ou un site commercial comme source réglementaire.
- ❌ Générer une déclaration MRA au format non validé.

## 5. Statut des exports

Les exports CSV/PDF actuels affichent explicitement
« EXPORT DE DÉMONSTRATION / DEMONSTRATION EXPORT ». Aucun de ces fichiers ne constitue une
déclaration de TVA.
