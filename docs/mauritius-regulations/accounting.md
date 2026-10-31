# Comptabilité — Maurice / Accounting — Mauritius

> **Statut du document** : documentation initiale de veille réglementaire.
> **Aucune règle fiscale ou comptable n'est appliquée automatiquement dans la version 0.1.0.**
> Les mentions `CONFIRMÉ`, `À VÉRIFIER` et `NON IMPLÉMENTÉ` sont définies dans
> [`compliance-register.md`](./compliance-register.md).

## 1. Périmètre de la version 0.1.0

| Élément | Statut | Commentaire |
|---|---|---|
| Partie double (débit = crédit) | **CONFIRMÉ (principe comptable général)** | Contrôlé en base et dans l'API. |
| Plan de comptes | **NON IMPLÉMENTÉ (au sens réglementaire)** | Un plan de démonstration est fourni, explicitement non officiel. |
| Journaux (ventes, achats, banque, caisse, divers) | **CONFIRMÉ (pratique)** | Paramétrables par société. |
| Grand livre / balance | **CONFIRMÉ (pratique)** | Calculés à partir des écritures validées. |
| États financiers | **NON IMPLÉMENTÉ (au sens IFRS)** | Présentation provisoire, non certifiable. |
| Clôture annuelle / à-nouveaux | **NON IMPLÉMENTÉ** | Les périodes peuvent être clôturées, mais aucune écriture de clôture n'est générée. |
| Consolidation, normes sectorielles | **NON IMPLÉMENTÉ** | Hors périmètre V0.1. |

## 2. Cadre comptable mauricien — points à valider

Les points ci-dessous **doivent être vérifiés auprès des sources officielles** avant toute
utilisation professionnelle. Aucun de ces points n'est aujourd'hui codé en dur dans
l'application.

| # | Sujet | Statut | À vérifier auprès de |
|---|---|---|---|
| AC-01 | Normes applicables aux sociétés privées (IFRS telles qu'adoptées à Maurice, IFRS for SMEs, traitements spécifiques) | **À VÉRIFIER** | FSC Maurice, MRA, Institute of Chartered Accountants (Maurice), textes en vigueur |
| AC-02 | Obligation ou non d'un plan comptable normalisé pour les sociétés privées | **À VÉRIFIER** | MRA / FSC / Companies Act |
| AC-03 | Format de dépôt des états financiers (Companies Act 2001 et textes connexes) | **À VÉRIFIER** | Corporate and Business Registration Department (CBRD) |
| AC-04 | Règles de conversion des comptes annuels et de présentation (entité, périmètre) | **À VÉRIFIER** | IFRS Foundation / FSC |
| AC-05 | Obligations d'archivage comptable et durée de conservation | **À VÉRIFIER** | MRA / CBRD / Data Protection Office |
| AC-06 | Traitement comptable et fiscal des écarts de change | **NON IMPLÉMENTÉ** | MRA (règles non validées : aucune écriture automatique n'est produite) |
| AC-07 | Devise fonctionnelle et devise de présentation (IAS 21) | **À VÉRIFIER** | IFRS Foundation |

> ⚠️ **Aucun taux, seuil ou obligation de dépôt n'est affirmé dans ce document** tant qu'une
> référence officielle datée n'a pas été archivée dans le registre de conformité.

## 3. Ce que l'application fait réellement (V0.1.0)

1. **Saisie en partie double.** Chaque écriture comporte au moins deux lignes, chaque ligne
   portant soit un débit soit un crédit. La validation est refusée si `Σ débits ≠ Σ crédits`,
   y compris par un contrôle au niveau PostgreSQL (trigger différé).
2. **Montants exacts.** Les montants sont stockés en `numeric(20,4)` et manipulés en entiers
   décimaux (BigInt) : aucune arithmétique flottante sur les montants.
3. **Immutabilité des écritures validées.** Une écriture validée ne peut être ni modifiée ni
   supprimée (API **et** triggers PostgreSQL). La correction passe par une **contrepassation**
   tracée (`source = reversal`, lien vers l'écriture d'origine).
4. **Contrôle des périodes.** Une écriture est refusée si la période correspondante est
   clôturée, ou si aucune période ouverte ne couvre la date.
5. **Cloisonnement par société.** Toutes les lignes métier portent `company_id` ; l'accès est
   contrôlé par appartenance (`company_members`). Les triggers vérifient qu'une ligne ne peut
   référencer un compte d'une autre société.
6. **Grand livre** avec solde initial, mouvements et solde progressif ; **balance** avec
   colonnes solde initial / mouvements / solde final.
7. **États provisoires** : Statement of Financial Position et Statement of Profit or Loss,
   calculés uniquement à partir des écritures validées, avec contrôle d'équilibre.

## 4. Travaux restant à réaliser pour une conformité IFRS complète

- [ ] Confirmer les normes applicables (AC-01) et les archiver avec date d'entrée en vigueur.
- [ ] Ajouter les notes annexes (IAS 1 §10, §112 et suivants) : méthodes comptables,
      jugements, estimations, informations qualitatives.
- [ ] Implémenter les ajustements de clôture et la report à nouveau (écritures de clôture
      automatiques ou assistées, avec journal dédié et traçabilité).
- [ ] Gérer les états comparatifs (exercice N-1) et le retraitement.
- [ ] Traiter IAS 21 en totalité : devises fonctionnelles, conversion, écarts de change
      réalisés/non réalisés, présentation.
- [ ] IAS 16 / 38 / 36 : immobilisations, amortissements, dépréciations, composants.
- [ ] IAS 2 : stocks et dépréciations ; IAS 37 : provisions ; IFRS 15 : reconnaissance du
      revenu ; IFRS 9 : instruments financiers ; IFRS 16 : locations.
- [ ] IFRS 18 / IAS 1 révisée : structure des états et catégories (à confirmer selon la date
      d'entrée en vigueur retenue par Maurice).
- [ ] Impôts différés (IAS 12) et rapprochement avec la déclaration fiscale.
- [ ] Contrôle interne : piste d'audit complète, rapprochements bancaires, gestion des
      justificatifs.
- [ ] Validation par un expert-comptable mauricien avant production d'états destinés à des
      tiers.

## 5. Clause de non-conformité

Les états financiers et exports PDF de la V0.1.0 portent la mention
« DOCUMENT DE DÉMONSTRATION — NON CONFORME AUX EXIGENCES RÉGLEMENTAIRES ».
Ils ne doivent pas être utilisés pour un dépôt, un audit, un financement ou une déclaration
fiscale.

## 6. Références

Voir [`official-sources.md`](./official-sources.md) pour les URL officielles et
[`compliance-register.md`](./compliance-register.md) pour le tableau de suivi.
