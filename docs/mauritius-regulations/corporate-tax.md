# Impôt sur les sociétés — Corporate Tax (Mauritius)

> **Statut : NON IMPLÉMENTÉ dans la version 0.1.0.**
> Aucune base imposable, aucun taux, aucun crédit d'impôt et aucune déclaration ne sont
> calculés par l'application. Le compte de démonstration « Impôt sur les sociétés
> (provisoire) » (7000) n'est qu'un emplacement comptable, sans automatisation.

## 1. Principe retenu

La fiscalité mauricienne comporte de nombreux régimes particuliers (régimes préférentiels,
crédits d'impôt, exonérations, sociétés agréées, activités de promotion, etc.). Ces règles
évoluent chaque année avec les lois de finances. **Aucune règle fiscale ne sera codée avant
d'avoir été vérifiée et archivée** (voir le registre de conformité, section « Règles
confirmées »).

## 2. Questions à documenter

| # | Sujet | Statut | Où vérifier |
|---|---|---|---|
| CIT-01 | Taux standard de l'impôt sur les sociétés et date d'effet | **À VÉRIFIER** | MRA — Income Tax Act 1995 et Finance Acts |
| CIT-02 | Régimes préférentiels / taux réduits (conditions d'éligibilité) | **À VÉRIFIER** | MRA, FSC, Economic Development Board |
| CIT-03 | Crédits d'impôt, exonérations, déductions spécifiques | **À VÉRIFIER** | MRA |
| CIT-04 | Période d'imposition, année d'imposition (year of assessment) | **À VÉRIFIER** | MRA |
| CIT-05 | Dates de dépôt et de paiement (acomptes, solde) | **À VÉRIFIER** | MRA — communiqués annuels |
| CIT-06 | Report en avant des pertes, changements de contrôle | **À VÉRIFIER** | MRA |
| CIT-07 | Prix de transfert et documentation | **À VÉRIFIER** | MRA |
| CIT-08 | Retenue à la source (TDS) sur paiements spécifiques | **À VÉRIFIER** | MRA |
| CIT-09 | Impôt minimum alternatif (le cas échéant) | **À VÉRIFIER** | MRA |
| CIT-10 | Traitement des écarts de change et des instruments financiers | **À VÉRIFIER** | MRA |
| CIT-11 | Régime TVA / douanes à l'importation | **À VÉRIFIER** | MRA Customs |

## 3. Ce qui est réellement possible en V0.1.0

L'application peut **produire un résultat comptable provisoire** (Statement of Profit or
Loss) à partir des écritures validées. Ce résultat :

- n'est **pas** une base imposable ;
- n'intègre **aucun** retraitement fiscal (amortissements fiscaux, charges non déductibles,
  provisions, etc.) ;
- ne comporte **aucun** calcul d'impôt.

L'affectation du compte 7000 est laissée à l'utilisateur, qui saisit l'écriture d'impôt
manuellement, avec son justificatif, sous sa responsabilité.

## 4. Architecture prévue (non développée)

```text
tax_years (company_id, label, start_date, end_date, due_date, legal_reference)
tax_adjustments (company_id, tax_year_id, account_id, direction[add|deduct], amount, justification, reference)
tax_computations (company_id, tax_year_id, accounting_profit, taxable_profit, rate_applied, tax_due, snapshot_json, computed_at, computed_by)
tax_filings (company_id, tax_year_id, channel, reference, filed_at, status)
```

Chaque calcul devra être un **snapshot immuable** avec : taux appliqué, référence légale,
date d'entrée en vigueur, version du moteur de calcul, et empreinte des écritures utilisées.

## 5. Interdits

- ❌ Afficher un « impôt estimé » sans base légale vérifiée.
- ❌ Réutiliser les règles françaises (IS, intégration fiscale, déficits reportables).
- ❌ Automatiser un crédit d'impôt ou un taux préférentiel sans validation explicite de
  l'utilisateur et traçabilité de la règle.
