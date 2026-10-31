# Registre de revue réglementaire (mission 7)

> **Aucune ligne de ce registre n'a été validée par un professionnel.** Le statut
> par défaut est `À VÉRIFIER` : le logiciel n'affirme aucune règle fiscale ou
> sociale mauricienne et ne revendique **aucune conformité MRA**.
>
> Règle de tenue : une règle ne passe à `VALIDÉE` qu'après (1) copie de la source
> officielle référencée, (2) avis écrit d'un expert-comptable identifié, (3) test
> automatisé associé, (4) date de validation finale. Aucune de ces étapes n'a été
> réalisée à ce stade.

| Domaine | Règle à vérifier | Source officielle | Version / date | Risque | Statut | Avis expert-comptable | Correction demandée | Résultat du test | Date de validation finale |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TVA — taux | Taux standard applicable et périodes d'application | Mauritius Revenue Authority (à fournir) | Non fournie | Critique : facturation erronée | À VÉRIFIER | Non obtenu | Documenter le taux et sa date d'effet, puis vérifier le taux dans l'écran Fiscalité | `VAT_RATE_NOT_VERIFIED` couvert (tests API) ; aucun taux seedé | — |
| TVA — champs d'application | Quelles opérations sont taxables, à taux zéro, exonérées ou hors champ | MRA / textes législatifs (à fournir) | Non fournie | Majeur : qualification d'une ligne | À VÉRIFIER | Non obtenu | Classification explicite par ligne, jamais assimilée à « 0 % » | Traitements distincts testés (API + démo) | — |
| TVA — immatriculation | Seuils et obligations d'immatriculation | MRA (à fournir) | Non fournie | Majeur | À VÉRIFIER | Non obtenu | Ne jamais présumer l'assujettissement d'une société | `vat_enabled` désactivé par défaut | — |
| TVA — déclarations | Périodicité, formulaires et échéances de déclaration | MRA (à fournir) | Non fournie | Critique : pénalités | À VÉRIFIER | Non obtenu | Aucune échéance fiscale générée automatiquement en attendant | Aucune fonction de déclaration livrée | — |
| Facturation électronique | Périmètre et calendrier E-Invoicing MRA | MRA (à fournir) | Non fournie | Critique | À VÉRIFIER | Non obtenu | Rester explicitement désactivé | `mraEInvoicing: false` exposé et testé | — |
| Paie — PAYE | Barème, seuils et abattements | MRA (à fournir) | Non fournie | Critique | À VÉRIFIER | Non obtenu | Ne pas calculer de paie tant que la règle n'est pas validée | Paie non implémentée ; assistant l'explique | — |
| Paie — CSG | Taux et assiette | Autorités sociales (à fournir) | Non fournie | Critique | À VÉRIFIER | Non obtenu | Idem | Aucun calcul de CSG | — |
| Paie — NSF | Taux et assiette | Autorités sociales (à fournir) | Non fournie | Critique | À VÉRIFIER | Non obtenu | Idem | Aucun calcul de NSF | — |
| Paie — déclarations | Formulaires et échéances employeur | MRA / autorités sociales (à fournir) | Non fournie | Critique | À VÉRIFIER | Non obtenu | Ne générer aucune déclaration | Aucune déclaration générée | — |
| Écritures comptables | Plan comptable et présentation des états financiers | Norme IFRS / pratique locale (à fournir) | Non fournie | Majeur | À VÉRIFIER | Non obtenu | Le plan comptable reste une donnée de démo, pas une obligation | Plan comptable modifiable, aucun compte imposé | — |
| Identifiants société | Format et usage du BRN / CRN | Registrar (à fournir) | Non fournie | Mineur | À VÉRIFIER | Non obtenu | Champs libres, aucune validation de format prétendue | Aucun contrôle de format réglementaire | — |
| Conservation | Durée légale de conservation des pièces et écritures | Textes fiscaux/comptables (à fournir) | Non fournie | Majeur | À VÉRIFIER | Non obtenu | Conservation des conversations rendue configurable et effaçable | Rétention 30 jours par défaut, suppression testée | — |
| Retenues à la source (TDS) | Taux et cas d'application | MRA (à fournir) | Non fournie | Majeur | À VÉRIFIER | Non obtenu | Aucun calcul automatique | Non implémenté | — |
| Immobilisations | Règles d'amortissement fiscal | MRA (à fournir) | Non fournie | Majeur | À VÉRIFIER | Non obtenu | Module annoncé, non opérationnel | Écran « préparé » | — |

## Suivi

- Prochaine étape recommandée : obtenir les sources officielles et un avis écrit
  pour les lignes TVA et Paie **avant** toute activation d'un calcul.
- Toute validation ultérieure devra être datée, signée et reliée à un test
  automatisé ; ce registre ne doit jamais contenir de validation inventée.
