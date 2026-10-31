# Guide utilisateur — Paie & RH (préparation)

> **Ce module prépare la paie ; il ne produit ni net légal, ni bulletin officiel, ni
> déclaration.** PAYE, CSG, NSF et cotisations employeur sont bloqués. Les montants
> affichés sont arithmétiques et fictifs dans la démonstration.

## 1. Accès

1. Se connecter et choisir la société dans la barre supérieure.
2. Ouvrir **Paie & RH**. Les rôles autorisés sont propriétaire, administrateur,
   administrateur de cabinet et gestionnaire de paie.
3. La démonstration GitHub Pages contient 12 salariés fictifs A→L ; elle ne contacte
   aucun serveur.

## 2. Tableau de bord

Affiche les salariés actifs, la dernière période, les variables en brouillon et les
règles obligatoires non validées. Les contrôles signalent les salariés sans contrat
et les échéances proches. Les capacités sont explicites : arithmétique disponible,
réglementaire et bulletin final indisponibles.

## 3. Créer un salarié

1. **Salariés → Nouveau salarié**.
2. Renseigner numéro, prénom, nom, dates, nationalité, contacts et affectation.
3. Le numéro de compte bancaire peut être saisi : seuls les 4 derniers chiffres et
   une empreinte sont conservés. L’écran n’affichera que `•••• 1234`.
4. En cas de doublon (numéro, e-mail, nom + naissance), l’application refuse et
   propose les fiches existantes. Aucune fusion n’est automatique ; créez une fiche
   distincte avec un numéro différent si nécessaire.
5. **Détail** affiche les contrats et l’historique, jamais le compte complet.

## 4. Contrats et avenants

1. **Contrats → Nouveau contrat / avenant**.
2. Choisir le salarié, le type, le temps de travail, les dates, le salaire, la
   périodicité et la devise.
3. Le **motif** est obligatoire. Un nouveau contrat actif remplace l’ancien à sa date
   d’effet ; l’ancien passe `superseded` et reste visible.
4. Une augmentation au 16 du mois produit deux lignes proratisées dans le calcul.

## 5. Temps, absences et congés

- **Temps & présences** : saisir heures, heures supplémentaires et retards. Les heures
  supplémentaires sont conservées mais **aucune majoration** n’est calculée.
- **Congés** : créer une demande avec motif et justificatif éventuel. Approuver ou
  refuser ; un refus exige un motif. Les soldes restent `Configuration required`
  tant qu’aucune règle de congé n’est validée.

## 6. Variables et import

1. **Variables → Nouvelle variable** : choisir période, salarié, rubrique, montant et
   statut (`draft` ou `validated`). Seules les variables validées entrent dans le
   calcul.
2. **Import CSV / XLSX** : coller un CSV avec l’en-tête
   `employeeNumber;payItemCode;amount;externalRef`. Un XLSX doit d’abord être converti
   en CSV. Réimporter le même lot ne crée pas de doublon : les lignes existantes sont
   réutilisées.
3. Une ligne inconnue (salarié ou rubrique) bloque l’import avec la liste des erreurs.

## 7. Périodes et calcul

1. **Périodes → Nouvelle période**, puis **Démarrer la collecte**.
2. **Calculer** : le moteur applique les contrats datés, les variables validées et
   les rubriques fixes. Le résultat est **blocked** car les règles réglementaires ne
   sont pas validées.
3. L’écran **Calculs & contrôles** montre base, brut, retenues, net arithmétique,
   PAYE/CSG/NSF vides et les avertissements (heures supp., congé non valorisé).
4. Un second calcul est refusé (`PAYROLL_ALREADY_CALCULATED`) ; une réouverture
   administrative explicite crée une nouvelle version.

## 8. Bulletins de simulation

1. **Bulletins → Générer la simulation** pour un calcul.
2. Le numéro commence par `SIM-`. Le PDF porte sur chaque page
   **SIMULATION / DRAFT — NOT FOR PAYMENT** et indique `Net payable : NON CALCULÉ`.
3. Aucun bouton de finalisation n’est proposé. L’API refuserait la finalisation.
4. L’export CSV est également marqué simulation.

## 9. Paramètres et règles

Le registre affiche des placeholders PAYE/CSG/NSF sans taux, sans source, au statut
`UNVERIFIED`. Une règle ne peut devenir `EXPERT_VALIDATED` que par une action
administrateur motivée, avec source, référence, date d’effet et taux documenté.
Même validée, elle ne débloque pas le calcul : le moteur réglementaire n’est pas
implémenté.

## 10. Déclarations et transfert comptable

Ces écrans sont volontairement non opérationnels. Aucune déclaration MRA/PAYE/CSG/NSF
n’est créée, aucun virement n’est émis, aucune écriture n’est générée. L’aperçu
comptable indique `postingBlocked: true` et les comptes à configurer.

## 11. Mobilité

Les tableaux défilent dans leur propre conteneur, les cartes passent en une colonne
sous 640 px et la pastille d’assistant reste visible. Aucun clavier n’est forcé et
la sélection de fichiers conserve le correctif Samsung. Tests sur appareil physique
non réalisés.
