# Migration Sage — ce qui est réellement pris en charge

> **Aucune certification Sage. Aucune connexion Sage. Aucun connecteur.**
> Les profils Sage sont des **formats de fichiers d'export**. Ils sont marqués
> **expérimentaux** dans l'application et dans l'API (`status: 'experimental'`).
> Les seules preuves sont les tests sur des fichiers **fictifs** reproduisant la
> forme d'un export ; aucun fichier client réel n'a été utilisé.

## 1. Profils déclarés

| Profil | Identifiant | Statut | Usage |
|---|---|---|---|
| Générique CSV/Excel | `generic` | pris en charge | tout fichier délimité ou XLSX |
| Sage 50 | `sage50` | expérimental | export de journal / plan comptable |
| Sage 200 | `sage200` | expérimental | export de journal / plan comptable |
| Sage Accounting | `sage_accounting` | expérimental | export de journal |

Un export Sage n'est **jamais** lu par une API ou un pilote : l'utilisateur
téléverse un fichier. Aucun identifiant Sage, mot de passe ou chemin de base
n'est demandé ni stocké.

## 2. Correspondances reconnues (testées)

| Champ Mauritius Business Suite | En-têtes Sage reconnus |
|---|---|
| Code compte | `Compte`, `N° compte`, `Code`, `Account`, `Account number`, `Nominal Code` |
| Intitulé | `Intitulé`, `Libellé`, `Nom`, `Name` |
| Date d'écriture | `Date`, `Date écriture`, `Date comptable` |
| Pièce / document | `N° pièce`, `N° de pièce`, `Pièce`, `Document`, `Réf.` |
| Journal | `Journal`, `Code journal` |
| Débit | `Débit`, `Debit` |
| Crédit | `Crédit`, `Credit` |
| Montant | `Montant`, `Amount` |
| Devise | `Devise`, `Currency` |
| Tiers | `Tiers`, `Client`, `Fournisseur`, `Account name` |

La détection est **proposée**, jamais imposée : chaque colonne peut être
réaffectée manuellement ; le modèle peut être enregistré par cabinet, société et
type d'import.

## 3. Différences de modèle à connaître

| Sujet | Sage (export) | MBS | Traitement |
|---|---|---|---|
| Sens | colonnes Débit/Crédit | débit/crédit par ligne | lu tel quel ; jamais de signe deviné |
| Écriture | plusieurs lignes partageant une pièce | regroupement par clé de pièce | équilibre exigé **par écriture** |
| Journaux | code journal | journaux existants uniquement | journal inconnu = bloquant |
| Analytique | sections analytiques | non implémenté | **NON IMPORTÉ** |
| Tiers | compte de tiers | auxiliaire si compatible | sinon refus explicite |
| Lettrage / règlements | historique de lettrage | non repris | **NON IMPORTÉ** |
| Exercices clôturés | historique | période ouverte exigée | import refusé |

## 4. Exemple fictif fourni

`apps/web/public/samples/export-sage-fictif.csv` (2 écritures, codes 8xxx).
Il est téléchargeable depuis la démo et utilisé par les tests. Toute ressemblance
avec un export réel est fortuite : les montants, comptes et tiers sont inventés.

## 5. Ce qu'il faudrait pour une compatibilité « certifiée »

1. Documentation officielle du format et de ses versions, sous licence compatible.
2. Jeux de fichiers de référence fournis par l'éditeur (ou anonymisés avec accord).
3. Tests automatisés par version, y compris cas d'erreur.
4. Revue de sécurité et validation juridique.

**Aucune de ces étapes n'est réalisée** : la compatibilité annoncée reste donc
limitée à « export CSV/Excel de forme Sage, profil expérimental ».
