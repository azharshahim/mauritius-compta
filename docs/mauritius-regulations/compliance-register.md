# Registre de conformité — Compliance register

> **Outil de travail.** Chaque ligne devra être complétée, validée et archivée avant toute
> automatisation. Une règle sans référence officielle **ne doit pas** être implémentée.
>
> **Légende des statuts**
> - `CONFIRMÉ` — règle vérifiée sur une source officielle archivée, avec date d'entrée en
>   vigueur ; peut être implémentée.
> - `À VÉRIFIER` — règle connue mais non encore validée ; **aucune implémentation**.
> - `NON IMPLÉMENTÉ` — règle identifiée, volontairement hors périmètre de la version en cours.
> - `N/A` — sans objet pour cette version.

_Dernière mise à jour : 2026-10-30 (version 0.1.0)._

## 1. Règles techniques internes (confirmées par construction)

| ID | Règle | Statut | Entrée en vigueur | Référence | Implémentation | Test |
|---|---|---|---|---|---|---|
| TECH-01 | Une écriture validée doit être équilibrée (Σ débits = Σ crédits) | **CONFIRMÉ** | V0.1.0 | Principe de partie double (interne) | API + trigger PostgreSQL `mc_assert_entry_balanced` | `entries.test.ts`, `migrations.test.ts` |
| TECH-02 | Une écriture validée est immuable | **CONFIRMÉ** | V0.1.0 | Contrôle interne (interne) | Triggers `journal_entries_immutable_trg`, `journal_lines_immutable_trg` + API | `entries.test.ts` |
| TECH-03 | Contrôle des périodes clôturées | **CONFIRMÉ** | V0.1.0 | Contrôle interne (interne) | `assertOpenPeriod()` | `entries.test.ts` |
| TECH-04 | Isolation stricte entre sociétés | **CONFIRMÉ** | V0.1.0 | Contrôle interne (interne) | `requireCompany()` + trigger `mc_guard_line_company` | `companies.test.ts`, `migrations.test.ts` |
| TECH-05 | Aucun taux de change inventé | **CONFIRMÉ** | V0.1.0 | Exigence du cahier des charges | Taux daté saisi par l'utilisateur | `entries.test.ts` |
| TECH-06 | Les exports portent la mention « démonstration » | **CONFIRMÉ** | V0.1.0 | Exigence du cahier des charges | PDF/CSV + UI | `reports.test.ts` |

## 2. Comptabilité et états financiers

| ID | Règle | Statut | Date d'entrée en vigueur | Référence officielle | Action requise |
|---|---|---|---|---|---|
| AC-01 | Normes applicables aux entités privées mauriciennes (IFRS / IFRS for SMEs / autres) | **À VÉRIFIER** | — | FSC Maurice, texte à obtenir | Archiver le texte + note FSC |
| AC-02 | Obligation éventuelle d'un plan comptable normalisé | **À VÉRIFIER** | — | MRA / CBRD | Vérifier l'absence d'obligation |
| AC-03 | Format de dépôt des états financiers annuels | **À VÉRIFIER** | — | CBRD (Companies Act 2001) | Obtenir le formulaire officiel |
| AC-04 | Contenu minimal des états financiers (IAS 1) | **NON IMPLÉMENTÉ** | — | IFRS Foundation | Mission 3 |
| AC-05 | Durée de conservation des pièces comptables | **À VÉRIFIER** | — | MRA / CBRD | Ajouter paramètre de conservation |
| AC-06 | Écritures de clôture / à-nouveaux | **NON IMPLÉMENTÉ** | — | Pratique comptable | Mission 3 |
| AC-07 | Traitement des écarts de change | **NON IMPLÉMENTÉ** | — | IAS 21 + règles MRA à vérifier | Ne rien automatiser avant validation |

## 3. TVA

| ID | Règle | Statut | Date d'entrée en vigueur | Référence officielle | Action requise |
|---|---|---|---|---|---|
| VAT-01 | Taux standard de TVA | **À VÉRIFIER** | — | MRA — VAT Act 1998 + communiqués | Obtenir le texte et la date d'effet |
| VAT-02 | Taux réduits / zéro / exonérations | **À VÉRIFIER** | — | MRA — First Schedule | Archiver la liste officielle |
| VAT-03 | Seuil d'assujettissement | **À VÉRIFIER** | — | MRA | Obtenir la règle et la période de référence |
| VAT-04 | Périodicité et échéances déclaratives | **À VÉRIFIER** | — | MRA — communiqués annuels | Calendrier à paramétrer |
| VAT-05 | Mentions obligatoires des factures | **À VÉRIFIER** | — | MRA — règlements | Mission facturation |
| VAT-06 | e-Invoicing (périmètre, format, calendrier) | **À VÉRIFIER** | — | MRA | Ne rien développer avant publication officielle |
| VAT-07 | Autoliquidation / services étrangers | **À VÉRIFIER** | — | MRA | Mission 3 |

## 4. Impôt sur les sociétés

| ID | Règle | Statut | Date d'entrée en vigueur | Référence officielle | Action requise |
|---|---|---|---|---|---|
| CIT-01 | Taux de l'impôt sur les sociétés | **À VÉRIFIER** | — | MRA — Income Tax Act / Finance Act | Archiver le texte |
| CIT-02 | Régimes préférentiels et conditions | **À VÉRIFIER** | — | MRA / FSC / EDB | Ne pas implémenter sans validation |
| CIT-03 | Crédits d'impôt et déductions | **À VÉRIFIER** | — | MRA | Mission 3 |
| CIT-04 | Dates de dépôt et d'acomptes | **À VÉRIFIER** | — | MRA — communiqués | Calendrier |
| CIT-05 | Prix de transfert | **À VÉRIFIER** | — | MRA | Hors périmètre V0.1 |

## 5. Paie et social

| ID | Règle | Statut | Date d'entrée en vigueur | Référence officielle | Action requise |
|---|---|---|---|---|---|
| PAY-01 → PAY-12 | Barèmes, cotisations, déclarations, conditions de travail | **NON IMPLÉMENTÉ** | — | MRA / Ministry of Labour | Voir `payroll.md` ; mission dédiée |

## 6. Protection des données

| ID | Règle | Statut | Date d'entrée en vigueur | Référence officielle | Action requise |
|---|---|---|---|---|---|
| DP-01 | Enregistrement du contrôleur auprès du DPO | **À VÉRIFIER** | — | Data Protection Office | Vérifier l'obligation applicable |
| DP-02 | Durées de conservation | **À VÉRIFIER** | — | DPA 2017 (texte à archiver) | Politique de rétention |
| DP-03 | Droits des personnes | **À VÉRIFIER** | — | DPA 2017 | Procédure d'accès/effacement |
| DP-04 | Notification de violation | **À VÉRIFIER** | — | DPA 2017 / DPO | Procédure interne |
| DP-05 | Transferts transfrontaliers | **À VÉRIFIER** | — | DPA 2017 | Localisation de l'hébergement |
| DP-06 | Chiffrement au repos | **NON IMPLÉMENTÉ** | — | Bonne pratique | Chiffrement disque VPS |

## 7. Gouvernance de la validation

| Rôle | Responsabilité | Nom |
|---|---|---|
| Propriétaire du produit | Valide les priorités et les mises en production | _à compléter_ |
| Expert-comptable (Maurice) | Valide les règles comptables et fiscales | _à nommer_ |
| Conseiller juridique / DPO | Valide la protection des données | _à nommer_ |
| Développement | Implémente uniquement les règles `CONFIRMÉ` | Arena / propriétaire |

**Aucune règle passée en `CONFIRMÉ` sans :** texte officiel archivé, date d'entrée en vigueur,
référence précise, tests associés, relecture par un professionnel.

## 8. Historique des décisions

| Date | Décision | Auteur |
|---|---|---|
| 2026-10-30 | Création du registre ; toutes les règles fiscales restent `À VÉRIFIER` ou `NON IMPLÉMENTÉ` | Mission V0.1.0 |
| 2026-10-30 | Aucun taux de TVA / IS / paie n'est codé en dur dans l'application | Mission V0.1.0 |
