# Suggestions de comptes et règles (mission 9)

> **Aucun fournisseur IA réel n'est activé dans cette mission.** Les
> suggestions sont **déterministes**, calculées à partir du plan comptable de
> la société active et des règles validées. Aucune clé, aucun crédit et aucun
> appel réseau ne sont nécessaires.

## Ce que fait le moteur de suggestions

Pour une transaction, `suggestAccount` renvoie :

- `status` : `proposed`, `ambiguous` ou `none` ;
- `kind` : `rule`, `fee`, `salary`, `rent`, `energy`, `insurance`, `customer`,
  `supplier`, `bank` ou `manual` ;
- un **compte existant** ou `null` ;
- une confiance et une justification bilingue ;
- éventuellement plusieurs `choices` quand plusieurs règles de même priorité
  visent des comptes différents.

Le compte proposé doit exister, être actif et appartenir à la société. Si aucun
compte ne convient, le moteur renvoie `none` : **la décision reste humaine**.
Aucun numéro de compte n'est inventé, aucun compte n'est créé.

## Indices utilisés

| Type | Indices (FR/EN) | Compte cible |
|---|---|---|
| Frais bancaires | `frais`, `commission`, `bank charge`, `fees` | charge existante contenant « frais bancaire » |
| Salaire | `salaire`, `salary`, `payroll`, `wages`, `paie`, `virement…salaire` | dette salariale existante (ex. `2300`), ou `none` |
| Loyer | `loyer`, `rent` | charge loyer |
| Électricité/eau | `electric`, `énergie`, `ceb`, `eau` | charge énergie |
| Assurance | `assurance`, `insurance` | charge assurance |
| Client | `client`, `customer`, `vente`, `recette` | compte client d'actif |
| Fournisseur | `fournisseur`, `supplier`, `achat` | compte fournisseur de passif |
| Virement interne | `virement interne`, `internal transfer`, `transfer` | compte bancaire existant |

Ces indices ne sont **pas des preuves**. Le libellé « Virement salaires août »
ne prouve pas qu'il s'agit de paie : le moteur exige un compte de dette
existante, affiche une justification et une confiance de 0,65. **Aucun calcul
de paie, aucun salarié, aucune charge n'est créé.** La double comptabilisation
est évitée parce que l'acceptation d'une proposition exige une période ouverte,
un compte existant et passe par le moteur comptable unique ; une écriture déjà
rapprochée ne peut pas l'être à nouveau.

## Règles apprises

- Portée **société** (`company_id`) et cabinet (`cabinet_id`).
- Champs : nom, motif de libellé, motif de référence, compte bancaire, devise,
  sens (`any/in/out`), compte cible, journal, priorité.
- **Versionnées** : une nouvelle version peut remplacer une ancienne
  (`supersedes_id`), l'ancienne est conservée.
- **Désactivables** : `DELETE /bank/rules/:id` passe `is_active = false`, sans
  suppression d'historique.
- **Auditables** : création/désactivation dans `bank_events`.
- Une règle n'est **jamais enregistrée silencieusement** : l'écran propose une
  correction préremplie, l'utilisateur doit cliquer sur « Enregistrer la règle ».
- Conflit : plusieurs règles de même priorité → `ambiguous` et choix humain.

## Rôle de l'AI Engine / assistant V2

L'AI Engine et l'assistant V2 existants restent les seuls composants IA du
dépôt ; aucun second moteur n'a été ajouté. Dans cette mission :

- **NON IMPLÉMENTÉ** : génération de suggestions par un fournisseur IA ;
- **NON ACTIVÉ** : fournisseur, clé, crédit ou modèle ;
- les suggestions bancaires sont **règles + heuristiques déterministes** ;
- l'assistant ne peut ni comptabiliser, ni modifier un montant, ni valider un
  rapprochement (voir `docs/bank-security.md`).

Cette décision privilégie la fiabilité de l'import et la rigueur du
rapprochement sur des automatismes IA approximatifs, conformément à la
consigne de mission.

## Cycle de décision

`Proposition → Vérification déterministe → Validation humaine → Comptabilisation`

- **Proposition** : brouillon `bank_proposals`, aucune écriture.
- **Vérification** : compte actif, période ouverte, taux explicite si devise,
  équilibre par le moteur existant, contrôles indépendants du fournisseur.
- **Validation humaine** : `confirm: true` obligatoire.
- **Comptabilisation** : uniquement via `postEntryTx`, avec audit.
