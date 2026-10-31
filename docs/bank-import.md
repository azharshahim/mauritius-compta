# Import de relevés bancaires (mission 9)

> **Données fictives uniquement.** Aucun fichier réel n'est versionné, aucune
> connexion bancaire n'est établie et aucun prestataire externe n'est appelé.
> Les quatre fichiers de `apps/web/public/samples/` sont inventés.

## Périmètre livré

| Élément | État |
|---|---|
| Comptes bancaires par société (banque, devise, référence **masquée**, compte comptable associé) | Livré, 20 comptes maximum par société |
| Historique des imports (fichier, format, lignes, créés, doublons, date) | Livré |
| CSV, TSV/TXT et XLSX | Livré via le parseur de la mission 8 |
| OFX/QFX | **NON IMPLÉMENTÉ** (déclaré dans l'API et l'écran) |
| PDF bancaire / OCR | **NON IMPLÉMENTÉ** |
| Connexion bancaire directe ou agrégateur | **NON IMPLÉMENTÉ** |
| Écriture comptable automatique à l'import | **Non, jamais** |

Le compte bancaire physique est distinct du compte du plan comptable : un
compte `bank_accounts` porte un nom, une banque, une devise et une référence
masquée ; il est relié à **un compte d'actif existant** (`1010`, `1015`, …).
Aucun compte comptable n'est créé par l'import.

## Assistant en 7 étapes

1. **Société et compte bancaire** : la société active est imposée par l'API
   (`requireCompany`). Le compte doit appartenir à cette société.
2. **Fichier** : téléversement local, 8 Mo maximum (ou `MAX_UPLOAD_BYTES` s'il
   est plus petit) ; 5 000 lignes au plus ; 80 colonnes; 20 feuilles au plus.
3. **Colonnes** : détection automatique des en-têtes FR/EN avec seuil 0,6. Une
   correspondance manuelle peut toujours être imposée.
4. **Prévisualisation** : `POST /bank/preview` **n'écrit rien** en base. Il
   renvoie les transactions normalisées, les anomalies et les soldes déduits.
5. **Doublons et incohérences** : voir les codes ci-dessous. Les erreurs
   bloquent l'import ; les avertissements sont conservés dans le rapport.
6. **Confirmation humaine** : `POST /bank/imports` ne crée que des
   `bank_transactions`. Aucun `journal_entry` n'est produit.
7. **Rapport** : synthèse (total, importables, doublons, déjà importés,
   avertissements, erreurs), puis historique consultable.

## Champs reconnus

`txnDate`, `valueDate`, `label`, `reference`, `debit`, `credit`, `amount`,
`currency`, `balance`, `externalId`, `direction`.

- `amount` est **signé** : positif = entrée d'argent, négatif = sortie.
- `debit`/`credit` du relevé sont convertis dans cette convention : un débit
  bancaire (sortie) devient négatif.
- Un indicateur `D/DR/Débit/Soll/S` vaut débit ; `C/CR/Crédit/Haben/H` vaut
  crédit. Il est relu **par ligne**.
- Dates FR (`JJ/MM/AAAA`) et EN (`MM/DD/YYYY`) selon `dayFirst` ; une date
  impossible telle que `31/02/2025` est refusée.
- Devise : si le relevé ne la contient pas, la devise du compte bancaire est
  utilisée. Si elle est présente et différente, `CURRENCY_MISMATCH` bloque.
- Aucun taux de change n'est déduit ni inventé. Une opération en devise
  étrangère exigera un taux explicite au moment de la proposition comptable
  (`BANK_EXCHANGE_RATE_REQUIRED`).

## Contrôles et codes

Bloquants (`blocksImport: true`) : `MISSING_REQUIRED_COLUMN`,
`MISSING_AMOUNT_COLUMN`, `INVALID_DATE`, `INVALID_VALUE_DATE`,
`INVALID_AMOUNT`, `BOTH_DEBIT_CREDIT`, `ZERO_AMOUNT`, `INVALID_INDICATOR`,
`CURRENCY_MISMATCH`, `INVALID_BALANCE`, `REFERENCE_CONFLICT`,
`BALANCE_MISMATCH`, `CLOSING_BALANCE_MISMATCH`, `OPENING_BALANCE_MISMATCH`.

Avertissements/informations : `MISSING_LABEL`, `DUPLICATE_IN_FILE`,
`ALREADY_IMPORTED`, `NO_BALANCE_COLUMN`, `NO_OPEN_PERIOD`.

Un solde incohérent produit une **anomalie explicite** : les montants du
fichier restent intacts, aucune correction n'est appliquée. La succession
solde d'ouverture → soldes de lignes → solde de clôture est vérifiée en
arithmétique décimale exacte (`numeric(20,4)` + BigInt).

## Idempotence et réimports

Deux niveaux indépendants :

1. **Fichier** : clé `sha256('bank-import', bankAccountId, fileHash)`. Réimporter
   exactement le même fichier sur le même compte renvoie `reimport: true`,
   `imported: 0` et ne crée rien.
2. **Transaction** : `fingerprint` calculée sur identifiant externe, date,
   libellé normalisé, montant, devise et solde ; contrainte
   `UNIQUE (bank_account_id, fingerprint)`. Un fichier différent contenant une
   opération déjà importée est ignoré (`ALREADY_IMPORTED`), et l'insertion
   utilise `ON CONFLICT DO NOTHING`.

Le doublon **dans le fichier** (`DUPLICATE_IN_FILE`) est signalé et ignoré. Le
fichier `releve-bancaire-doublons.csv` le démontre.

## Fichiers de démonstration

| Fichier | Contenu fictif |
|---|---|
| `releve-bancaire-fictif.csv` | 8 opérations MUR ; 6 déjà présentes dans la démo, 2 nouvelles |
| `releve-bancaire-fictif.xlsx` | 3 opérations, vrai classeur XLSX (sans macro) |
| `releve-bancaire-doublons.csv` | deux lignes identiques → 1 doublon |
| `releve-bancaire-erreurs.csv` | date impossible, devise USD sur compte MUR, solde incohérent |

Régénération : `npm run samples:bank`.

## Limites assumées

- Le fichier téléversé n'est **pas conservé** : seules les métadonnées et les
  transactions normalisées sont stockées.
- Les feuilles multiples XLSX sont exposées ; la page importe la première
  feuille contenant un tableau, ou celle choisie explicitement.
- Aucun format propriétaire bancaire mauricien spécifique n'est certifié.
- Aucun rapprochement automatique n'est effectué à l'import.
