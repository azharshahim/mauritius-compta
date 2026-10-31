# Guide utilisateur — Importation & migration

> Écran : **Cabinet → Importation & migration** (démo : même écran, données
> fictives). Rien n'est enregistré en comptabilité avant l'étape 6.

## Avant de commencer

1. Choisir le **dossier** (société) cible : la migration n'écrit que dans ce dossier.
2. Vérifier que la **période comptable** de l'exercice concerné est ouverte.
3. Préparer un fichier **sans macro** (`.xlsx`, `.csv`, `.tsv`), une ligne
   d'en-tête, une ligne par compte ou par ligne d'écriture.

Fichiers d'exemple téléchargeables depuis l'écran (démo et tests) :
plan comptable, balance d'ouverture, journal FR/EN, exports Sage et SAP fictifs,
et un fichier volontairement incorrect pour voir les contrôles.

## Étape 1 — Source

Choisir la source (Excel/CSV, Sage 50, Sage 200, Sage Accounting, SAP, autre) et
le type d'import (plan comptable, soldes d'ouverture, écritures, clients,
sociétés). Les profils Sage/SAP sont marqués **expérimental** : fichiers
d'export uniquement, aucune connexion.

## Étape 2 — Téléversement

Déposer le fichier. L'écran affiche : format détecté, encodage, taille, nombre
de lignes, feuilles disponibles, colonnes détectées et un aperçu (10 lignes).
Un fichier trop volumineux ou avec macro est refusé immédiatement.

## Étape 3 — Correspondances

Chaque colonne du fichier est associée à un champ (compte, intitulé, date,
débit, crédit, devise, taux, pièce, journal…). La proposition automatique est
modifiable. Les comptes inconnus peuvent être :

- associés à un compte existant (**recommandé**) ;
- créés si l'option « créer les comptes » est cochée ;
- sinon l'import est bloqué (aucun compte n'est inventé).

Enregistrer un **modèle** réutilise ces correspondances pour ce cabinet, cette
société et ce type d'import.

## Étape 4 — Contrôles

Deux niveaux clairement séparés :

| Niveau | Effet |
|---|---|
| **Bloquant** (rouge) | l'import est impossible tant que ce n'est pas corrigé |
| **Avertissement** (orange) | l'import reste possible, à vérifier |

Exemples bloquants : date invalide, écriture déséquilibrée, compte inconnu,
doublon de compte, doublon d'écriture, période fermée, devise sans taux,
soldes d'ouverture déjà repris. Les suggestions de l'IA sont affichées à part
et ne remplacent jamais ces contrôles.

## Étape 5 — Prévisualisation

Affiche, **sans rien créer**, ce qui serait fait : lignes nouvelles, ignorées,
modifiées, en conflit ; totaux débit/crédit et écart ; nombre de comptes,
écritures et clients. Le bouton d'import reste désactivé si un contrôle bloquant
existe.

## Étape 6 — Validation humaine et import

1. Cocher « Je vérifie les contrôles » ;
2. saisir éventuellement une note ;
3. cliquer sur **Confirmer l'import**.

L'import est transactionnel : tout ou rien. Le rapport final (écran + CSV)
liste les créations, ignorés et conflits. En cas de coupure, relancer le même
fichier ne duplique rien : la clé d'idempotence identifie déjà les lignes.

## Après l'import

- vérifier les écritures dans **Comptabilité → Écritures** (source « Migration ») ;
- vérifier la balance et le journal d'ouverture ;
- conserver le rapport CSV comme justificatif de reprise.

## Questions fréquentes

**Pourquoi mon import est-il bloqué ?** Lire la liste des contrôles : chaque
ligne indique le numéro de ligne, la colonne et le code. Corriger le fichier ou
la correspondance, puis relancer.

**Puis-je importer deux sociétés dans un même lot ?** Un lot = une société cible
explicite. Un lot multi-sociétés n'est accepté que si **chaque** société du
fichier a une correspondance vérifiée (BRN/CRN) ; aucune affectation par nom.

**Les factures et règlements historiques sont-ils repris ?** Seulement si le
modèle cible est strictement compatible. Sinon l'écran le dit et refuse : aucune
facture partielle n'est créée.

**La paie ?** Non. Aucune donnée de paie, aucun bulletin, aucun taux PAYE/CSG/NSF
n'est importé ni calculé.

**Sage / SAP sont-ils certifiés ?** Non. Profils expérimentaux de fichiers
d'export, sans connexion ni certification.
