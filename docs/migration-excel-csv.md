# Import Excel / CSV — formats réellement pris en charge

> Toutes les affirmations ci-dessous sont couvertes par des tests
> (`apps/api/tests/migration.test.ts`, `apps/web/tests/demo-migration.test.ts`).
> Les fichiers d'exemple sont **fictifs** et se trouvent dans
> `apps/web/public/samples/` (téléchargeables depuis la démo).

## 1. Extensions et conteneurs

| Extension | Lecture | Remarques |
|---|---|---|
| `.csv` | ✔ | délimiteur détecté parmi `,` `;` `\t` |
| `.tsv` | ✔ | tabulation |
| `.txt` | ✔ (délimiteur détecté) | traité comme texte délimité |
| `.xlsx` | ✔ | ZIP + XML lus par `fflate` ; **multi-feuilles** |
| `.xls` (BIFF), `.ods`, `.xlsm` | ✘ | refus explicite, message FR/EN |
| macros / `vbaProject.bin` | ✘ | classeur refusé (`UNSUPPORTED_FORMAT`) |

Aucune formule n'est évaluée : la valeur mise en cache par Excel est lue, jamais
recalculée. Aucun contenu actif (macro, lien externe, objet OLE) n'est exécuté.

## 2. Encodages

- UTF-8 (avec ou sans BOM) ;
- UTF-16 LE/BE (BOM détecté) ;
- Windows-1252 / Latin-1 (repli automatique si l'UTF-8 est invalide) ;
- le BOM est retiré avant l'analyse des en-têtes.

## 3. En-têtes

Détection FR/EN insensible à la casse et aux accents : `Code`, `Code du compte`,
`Compte`, `N° de compte`, `Account`, `G/L Account` ; `Intitulé`, `Libellé`,
`Nom`, `Description`, `Name` ; `Débit` / `Debit`, `Crédit` / `Credit`,
`Montant` / `Amount`, `Date`, `Pièce` / `Journal`, `Devise` / `Currency`,
`Taux` / `Rate`, `Tiers`, `Référence`.

Le score est **borné** : un préfixe/suffixe de mot vaut 0,85/0,80, une inclusion
0,68, et un en-tête d'indicateur (`Debit/Credit Indicator`) ne peut jamais être
pris pour une colonne de montant. Les alias sont ordonnés : le premier alias
gagne à score égal.

Quand un fichier contient à la fois `Débit` et `Crédit`, chaque ligne utilise la
colonne renseignée (une seule des deux). Un montant **négatif** est refusé
(`NEGATIVE_AMOUNT`) : le sens est déterminé par la colonne, jamais deviné.

## 4. Montants et dates

- montants : `1 234,56`, `1.234,56`, `1,234.56`, `1234.56`, `(1 234,56)`,
  `1 234,56-`, espaces insécables, symboles `MUR`/`Rs` ignorés ;
- **arithmétique décimale exacte** (jamais de flottant JS) ;
- dates : `JJ/MM/AAAA`, `JJ-MM-AAAA`, `AAAA-MM-JJ`, `MM/DD/YYYY` (désambiguïsé
  par le profil), plus les dates Excel (numéro de série) ;
- devise : code ISO ou vide → devise de la société ; devise inconnue
  (`UNSUPPORTED_CURRENCY`) ou taux manquant (`EXCHANGE_RATE_REQUIRED`) = bloquant.

## 5. Multi-feuilles

Le classeur expose toutes les feuilles (nom, lignes, colonnes détectées).
L'utilisateur choisit la feuille à importer ; un fichier `Lisez-moi` est ignoré
par défaut. Les autres feuilles ne sont jamais importées implicitement.

## 6. Contrôles bloquants les plus fréquents

| Code | Situation |
|---|---|
| `MISSING_REQUIRED_COLUMN` | colonne obligatoire absente du fichier |
| `INVALID_DATE` | date illisible |
| `INVALID_AMOUNT` / `NEGATIVE_AMOUNT` / `ZERO_LINE` | montant inutilisable |
| `DEBIT_AND_CREDIT` | débit et crédit sur la même ligne |
| `UNBALANCED_ENTRY` | écriture déséquilibrée (aucune contrepartie fabriquée) |
| `ACCOUNT_NOT_FOUND` | compte absent, sans correspondance explicite |
| `DUPLICATE_ACCOUNT_CODE` / `DUPLICATE_ENTRY_IN_FILE` | doublon dans le fichier |
| `ENTRY_ALREADY_IMPORTED` | écriture déjà reprise (idempotence) |
| `PERIOD_CLOSED` / `NO_OPEN_PERIOD` | période comptable non ouverte |
| `OPENING_ALREADY_EXISTS` | soldes d'ouverture déjà repris |

## 7. Fichiers d'exemple

| Fichier | Contenu | Résultat attendu |
|---|---|---|
| `plan-comptable-fictif.csv` | plan comptable FR (8 comptes) | 8 créations |
| `plan-comptable-fictif.xlsx` | 2 feuilles, 4 comptes | 4 créations |
| `balance-ouverture-fictive.csv` | balance équilibrée 370 000 / 370 000 | 1 écriture d'ouverture |
| `journal-fictif.csv` | 3 écritures équilibrées, dont une en EUR avec taux explicite | 3 écritures |
| `clients-fictifs.csv` | 2 clients fictifs (nom, BRN, courriel, délais) | import clients si le modèle est compatible |
| `export-sage-fictif.csv` | colonnes Sage (`Compte`, `N° pièce`) | 2 écritures |
| `export-sap-fictif.csv` | colonnes SAP + indicateur D/C | 2 écritures |
| `export-sap-fictif-semicolon.csv` | même export SAP, séparateur `;` et BOM | 2 écritures |
| `fichier-incorrect.csv` | date invalide, écriture déséquilibrée, compte inconnu | **import bloqué, 0 écriture** |

Génération reproductible : `node scripts/generate-migration-samples.mjs`
(les codes commencent à 8100 pour ne pas entrer en collision avec le dossier de démo).

## 8. Ce qui n'est pas importé

- paie, bulletins, déclarations ;
- factures historiques et règlements : uniquement si le modèle cible est
  strictement compatible ; sinon refus explicite, aucune facture partielle ;
- axes analytiques / cost centers : `NON IMPLÉMENTÉ` ;
- pièces jointes binaires et images.
