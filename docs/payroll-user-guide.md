# Guide utilisateur — Paie & RH (préparation)

> **Ce module prépare la paie ; il ne produit ni net légal, ni bulletin officiel, ni
> déclaration.** Les calculs PAYE, CSG, NSF et Training Levy sont disponibles mais
> restent `RESEARCHED`, non validés par un expert et **non payables**. La démonstration
> est entièrement fictive et ne contacte aucun serveur.

## 1. Accès

1. Se connecter et choisir la société dans la barre supérieure.
2. Ouvrir **Paie & RH**. Les rôles autorisés sont propriétaire, administrateur,
   administrateur de cabinet et gestionnaire de paie.
3. La démonstration GitHub Pages contient 19 salariés fictifs (A→R sur *Lagon Bleu
   Trading Ltd*, plus Daniel Morel sur *Mauritius Demo Services Ltd*) ; elle ne
   contacte aucun serveur.

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

- **Temps & présences** : saisir heures, heures supplémentaires et retards, ou
  importer un fichier CSV/TSV/XLSX. Les heures supplémentaires sont conservées mais
  **aucune majoration** n’est calculée. Les jours fériés ne sont jamais préchargés :
  ajoutez chaque date avec sa source vérifiée.
- **Congés** : créer une demande avec motif et justificatif éventuel. Approuver ou
  refuser ; un refus exige un motif. Les soldes restent `Configuration required`
  tant qu’aucune règle de congé n’est validée.

## 6. Variables et import

1. **Variables → Nouvelle variable** : choisir période, salarié, rubrique, montant et
   statut (`draft` ou `validated`). Seules les variables validées entrent dans le
   calcul.
2. **Import CSV / TSV / XLSX** : choisir un fichier avec l’en-tête
   `employeeNumber;payItemCode;amount;externalRef`, ou coller un CSV. Le XLSX est lu
   par le lecteur OOXML existant (aucune macro exécutée, valeur mise en cache seulement).
   Réimporter le même lot ne crée pas de doublon : les lignes existantes sont réutilisées.
3. Une ligne inconnue (salarié ou rubrique) bloque l’import avec la liste des erreurs.

## 7. Périodes et calcul

1. **Périodes → Nouvelle période**, puis **Démarrer la collecte**.
2. **Calculer** : le moteur applique les contrats datés, les variables validées,
   les rubriques fixes, puis PAYE cumulatif, CSG, NSF, Training Levy et AR 2026
   depuis les règles datées.
3. L’écran **Calculs & contrôles** montre base, brut, PAYE, CSG/NSF, net après
   cotisations et **net payable non calculé**. Le statut attendu est
   `expert_review_pending` ; il devient `rules_incomplete` si une donnée ou une
   règle manque (par exemple date de naissance ou CSG secteur public).
4. Un second calcul est refusé (`PAYROLL_ALREADY_CALCULATED`) ; une réouverture
   administrative explicite crée une nouvelle version.
5. **Approuver pour test** exige une note de revue de 10 caractères minimum. Le
   statut devient `approved_for_test`, mais **le net payable reste vide**.

## 8. Bulletins de simulation

1. **Bulletins → Générer la simulation** pour un calcul.
2. Le numéro commence par `SIM-`. Le PDF bilingue porte sur chaque page
   **SIMULATION / DRAFT — NOT FOR PAYMENT**, affiche PAYE, CSG/NSF salarié,
   net après cotisations, CSG/NSF employeur, levy et coût employeur, et indique
   `NET PAYABLE : NOT CALCULATED`.
3. Aucun bouton de finalisation n’est proposé. L’API refuserait la finalisation.
4. L’export CSV est également marqué simulation.

## 9. Paramètres et règles

Le registre affiche neuf règles **sourcées** (PAYE, sans EDF, CSG privée, NSF
taux, NSF limites 2025 et 2026, Training Levy, AR 2026, bonus) au statut
`RESEARCHED`, avec URL officielle, article, dates et version. Une règle ne peut
devenir `EXPERT_VALIDATED` que par une action administrateur motivée, avec source,
référence et empreinte. Même validée, la finalisation reste bloquée dans cette
mission.

## 10. Déclarations et transfert comptable

1. Ouvrir **Paie & RH → Déclarations**, choisir la période et saisir un
   **identifiant employeur fictif** (démo : `DEMO-ERN-0016`). Ce n’est pas un ERN
   MRA réel.
2. L’aperçu reprend uniquement les calculs enregistrés : société, période,
   nombre de salariés, totaux rémunérations, PAYE, CSG salarié/employeur, NSF
   salarié/employeur et Training Levy, avec le détail par salarié.
3. Lire les contrôles. Un contrôle bloquant interdit l’archivage et l’export
   interne. Une règle non validée reste un avertissement mais interdit l’export
   officiel, de toute façon indisponible.
4. Cliquer **Archiver la préparation** : une version est ajoutée à l’historique
   local et à l’audit.
5. **Télécharger l’export interne** produit uniquement
   `MRA-INTERNAL-PREPARATION-…csv`, marqué
   `INTERNAL PREPARATION - NOT SUBMITTED TO MRA`. Ce n’est pas un fichier PACO,
   il ne doit pas être transmis à la MRA.
6. L’export officiel est explicitement indisponible : NIC/NCID complet, ERN,
   déclarant et coordonnées ne sont pas stockés, le modèle CSV de décembre 2024
   n’a pas pu être vérifié (HTTP 500) et l’arrondi en roupie entière n’est pas
   documenté.

Aucun virement n’est émis, aucune écriture n’est générée. L’aperçu comptable
indique `postingBlocked: true` et les comptes à configurer. Le détail complet est
dans [`mra-declarations.md`](mra-declarations.md).

## 11. Scénario fictif octobre 2026 (mission 16)

1. Choisir **Mauritius Demo Services Ltd (DEMO)** dans la barre supérieure.
2. Ouvrir **Paie & RH → Périodes** : la période `10/2026` est déjà calculée.
3. Ouvrir **Calculs** : Daniel Morel, salaire de base Rs 30 000, AR 2026 Rs 635,
   brut Rs 30 635, PAYE 0 (barème cumulatif avec EDF), CSG salarié 459,525,
   CSG employeur 919,05, NSF 297,10/742,75, levy 459,525, net après cotisations
   29 878,375, coût employeur 32 756,325. Le net à payer reste **non calculé** et le
   statut est `expert_review_pending`.
4. Ouvrir **Bulletins**, puis **Ouvrir / Imprimer** sur le bulletin de Daniel
   Morel. La vue individuelle n’affiche que le bulletin ; les menus, boutons,
   navigation et pastille IA sont masqués à l’impression. Cliquer **Imprimer ce
   bulletin** : le navigateur ouvre son dialogue et produit une page A4 lorsque le
   contenu le permet. La démo **ne génère aucun PDF serveur** ; « Enregistrer en
   PDF » imprime cette vue et reste une simulation.
5. Ouvrir **Déclarations**, vérifier les montants PAYE/CSG/NSF, les contrôles,
   puis archiver la préparation et télécharger l’export interne si les contrôles
   le permettent.

## 12. Windows et Android — parcours de test

### Windows

1. Ouvrir `https://azharshahim.github.io/mauritius-compta/` dans Chrome ou Edge.
2. Se connecter avec le compte de démonstration affiché sur l’écran de connexion.
3. Suivre le scénario de la section 11, vérifier les montants et ouvrir la vue
   individuelle **Ouvrir / Imprimer**. Dans la boîte d’impression Chrome, choisir
   **A4**, marges par défaut, désactiver les en-têtes et pieds de page du
   navigateur ; **Imprimer → Enregistrer en PDF** produit un fichier local qui
   reste une simulation.
4. Vérifier que l’aperçu ne contient **qu’un bulletin** : ni menu, ni onglets, ni
   boutons, ni pastille IA. Le pied de page ne porte que
   `SIMULATION — NON VALIDÉ POUR PAIEMENT`.
5. Revenir à **Déclarations**, archiver une préparation et télécharger l’export
   interne ; vérifier que l’export officiel est annoncé indisponible.
6. Tester aussi le redimensionnement de la fenêtre : les tableaux doivent défiler
   horizontalement dans leur conteneur, sans déborder la page.

### Android

1. Ouvrir la même adresse dans Chrome Android.
2. Même connexion et même scénario ; la sélection de société se fait par le menu.
3. Le clavier ne doit pas s’ouvrir tout seul ; les champs de recherche gardent leur
   focus visible. Aucun bandeau de démonstration n’est masqué.
4. **Bulletins → Ouvrir / Imprimer → Imprimer ce bulletin** : Chrome Android
   propose « Enregistrer en PDF » ou une imprimante. Vérifier une seule page A4,
   l’absence de navigation, et le pied de page de simulation.
5. **Déclarations** : vérifier le tableau des totaux, les contrôles et l’export
   interne ; les tableaux défilent dans leur conteneur.
6. **Non vérifié dans cet environnement** : Samsung physique, Chrome réel et lecteur
   d’écran. Les contrôles restent au niveau CSS/unitaires et sont documentés comme
   non testés sur appareil.

## 13. Mobilité

Les tableaux défilent dans leur propre conteneur, les cartes passent en une colonne
sous 640 px et la pastille d’assistant reste visible. Aucun clavier n’est forcé et
la sélection de fichiers conserve le correctif Samsung. Tests sur appareil physique
non réalisés.
