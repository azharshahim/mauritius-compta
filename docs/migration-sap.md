# Migration SAP — ce qui est réellement pris en charge

> **Aucune certification SAP. Aucune connexion SAP (ni RFC, ni OData, ni
> BAPI). Aucun connecteur.** Le profil SAP lit un **fichier d'export** plat
> (CSV/TSV/XLSX) et il est marqué **expérimental**.

## 1. Champs SAP reconnus

| Champ SAP | En-tête reconnu | Champ MBS | Import |
|---|---|---|---|
| Company Code | `Company Code`, `Société` | — | lu mais non mappé : la société est choisie explicitement, jamais déduite |
| G/L Account | `G/L Account`, `GL Account`, `Compte général` | code compte | ✔ |
| Posting Date | `Posting Date`, `Date comptable` | date d'écriture | ✔ |
| Document Date | `Document Date`, `Date pièce` | — | non mappé ; seule la date de comptabilisation fait foi |
| Document Number | `Document Number`, `N° pièce` | clé d'écriture | ✔ |
| Debit/Credit Indicator | `Debit/Credit Indicator`, `S/H`, `D/C` | sens | ✔ (lu **par ligne**) |
| Amount | `Amount`, `Montant` | montant | ✔ |
| Currency | `Currency`, `Devise`, `WAERS` | devise | ✔ |
| Cost Center | `Cost Center`, `Centre de coûts` | — | **NON IMPORTÉ** (aucun axe analytique dans le modèle) |

Autres champs fréquents (Text, Assignment, Tax Code, Profit Center, Company
Code name) sont ignorés sans être inventés et signalés comme colonnes non
mappées (`UNMAPPED_COLUMN`, avertissement).

## 2. Indicateur débit/crédit

Valeurs acceptées : `D`, `Dr`, `Debit`, `Débit`, `S`, `Soll` (débit) et
`C`, `Cr`, `Credit`, `Crédit`, `H`, `Haben` (crédit), insensible à la casse
(convention SAP `SHKZG` : S = Soll = débit, H = Haben = crédit). Une valeur inconnue est **bloquante**
(`INVALID_DC_INDICATOR`). L'indicateur est relu **pour chaque ligne** : un bug
historique qui appliquait la valeur de la première ligne est couvert par un test
dédié (ligne 1 à 36 000 au débit, ligne 2 à 36 000 au crédit).

## 3. Différences de modèle

| Sujet | SAP | MBS | Traitement |
|---|---|---|---|
| Société | Company Code | société MBS avec BRN/CRN | correspondance **explicite** exigée |
| Écriture | Document Number | clé d'idempotence | regroupement par document |
| Équilibre | par document | exigé par écriture | déséquilibre = import refusé |
| Devises | devise document + devise locale | montant + taux explicite | taux manquant = bloquant |
| Axes analytiques | Cost Center, Profit Center | non implémenté | **NON IMPORTÉ** |
| Périodes | exercice SAP | période MBS ouverte | période fermée = refus |

## 4. Exemple fictif fourni

`apps/web/public/samples/export-sap-fictif.csv` : 2 écritures fictives,
`G/L Account`, `Document Number`, `Debit/Credit Indicator`, devise EUR avec taux
explicite. Il ne provient d'aucun système SAP et ne prétend pas en reproduire
toutes les variantes.

## 5. Limites explicites

- Pas de lecture de fichiers SAP propriétaires (`.txt` IDoc, archives) ;
- pas d'extraction de tables SAP (RFC/BAPI/OData) ;
- pas de gestion des substitutions, validation rules, taxes SAP ;
- pas de reprise des pièces jointes ;
- aucune compatibilité annoncée au-delà des colonnes testées ci-dessus.

Toute demande de « compatibilité SAP » au sens éditeur exigerait un partenariat,
des spécifications contractuelles et des tests de conformité : **hors périmètre**.
