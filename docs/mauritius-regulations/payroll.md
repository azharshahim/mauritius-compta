# Paie et cotisations sociales — Payroll & Social Contributions (Mauritius)

> **Statut : NON IMPLÉMENTÉ dans la version 0.1.0.**
> Le module de paie est prévu pour une mission ultérieure (voir `docs/roadmap.md`).
> Aucun barème, aucune cotisation, aucun plafond et aucune déclaration sociale ne sont
> présents dans le code.

## 1. Pourquoi ce module est repoussé

La paie mauricienne combine plusieurs dispositifs (impôt sur le revenu retenu à la source,
contributions sociales, fonds de pension, assurance-santé, indemnités, heures
supplémentaires, congés, primes) dont les paramètres évoluent **au moins une fois par an**,
souvent avec effet rétroactif. Implémenter un moteur de paie sans vérification officielle
exposerait l'utilisateur à des erreurs de déclaration et de paiement.

## 2. Questions à documenter avant toute implémentation

| # | Sujet | Statut | Où vérifier |
|---|---|---|---|
| PAY-01 | Impôt sur le revenu : barème, tranches, date d'effet | **À VÉRIFIER** | MRA — Income Tax Act, Finance Acts |
| PAY-02 | Retenue à la source (PAYE) : assiette, arrondis, obligations mensuelles | **À VÉRIFIER** | MRA |
| PAY-03 | Cotisations sociales salariales et patronales (CSG et autres) : taux, plafonds, assiette | **À VÉRIFIER** | MRA |
| PAY-04 | Contribution additionnelle / fonds spécifiques (PRGF, training levy, etc.) | **À VÉRIFIER** | MRA |
| PAY-05 | Déclarations mensuelles/annuelles (ROE, TDS statement, EOY) : formats, échéances, canaux | **À VÉRIFIER** | MRA |
| PAY-06 | Salaire minimum et compensations salariales | **À VÉRIFIER** | Ministry of Labour / Wages Council |
| PAY-07 | Heures supplémentaires, travail de nuit, jours fériés, congés | **À VÉRIFIER** | Workers' rights legislation, Wages Council |
| PAY-08 | Indemnités de fin de contrat, préavis | **À VÉRIFIER** | Workers' Rights Act et règlements |
| PAY-09 | Bulletins de paie : mentions obligatoires | **À VÉRIFIER** | Ministry of Labour |
| PAY-10 | Données personnelles des salariés (base légale, conservation, accès) | **À VÉRIFIER** | Data Protection Office — DPA 2017 |
| PAY-11 | Travailleurs étrangers, permis de travail, retenues spécifiques | **À VÉRIFIER** | EDB / MRA / Ministry of Labour |
| PAY-12 | Expatriation, conventions fiscales, expatriés | **À VÉRIFIER** | MRA |

## 3. Exigences de conception (à respecter lors de la mission paie)

1. **Paramétrage daté** : chaque barème/taux porte `effective_from` / `effective_to` et une
   `legal_reference`. Aucune valeur codée en dur.
2. **Versionnage des bulletins** : un bulletin validé est immuable ; correction par
   régularisation traçable.
3. **Calcul déterministe et testé** : jeux de tests figés par année, arrondis documentés,
   absence totale de flottants.
4. **Séparation stricte** des données de paie et de comptabilité par société (isolation +
   chiffrement au repos recommandé).
5. **Minimisation des données** : ne stocker que les données nécessaires ; durées de
   conservation paramétrables et documentées.
6. **Journal d'audit** : toute consultation ou modification de données de paie sensible.
7. **Exports** : les formats officiels MRA ne seront produits qu'après validation de leur
   spécification officielle.

## 4. Rappel

Aucun salarié réel, aucune donnée réelle de paie ne doit être introduite dans les tests ou
dans les jeux de démonstration de ce dépôt. Toute donnée de test est **fictive**.
