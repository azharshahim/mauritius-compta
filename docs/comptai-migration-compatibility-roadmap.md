# COMPTAI — migration et compatibilité : état réel et feuille de route

**Version :** 0.1.1 — démonstration
**Date :** 1er novembre 2026
**Périmètre :** plan comptable, soldes d'ouverture, journaux, clients/fournisseurs
**Sources internes :** `apps/api/src/modules/migration/`, `apps/api/src/modules/accounts/chart.ts`,
`docs/migration-sage.md`, `docs/migration-excel-csv.md`, `docs/comptai-functional-coverage.md`

> **Aucune compatibilité officielle n'est affirmée.** COMPTAI ne se connecte à aucun
> logiciel concurrent, ne lit aucun fichier propriétaire binaire et n'utilise aucun
> identifiant Sage, QuickBooks ou Xero. Les imports sont des **fichiers CSV/TSV/XLSX
> téléversés par l'utilisateur**. Les profils Sage sont **expérimentaux** et testés
> uniquement sur des fichiers **fictifs**.

---

## 1. Ce qui existe aujourd'hui

### 1.1 Types d'import

| Type | Identifiant API | Contenu attendu | Statut |
|---|---|---|---|
| Plan comptable | `chart_of_accounts` | code, intitulé, type, devise | disponible |
| Soldes d'ouverture | `opening_balance` | compte, débit/crédit d'ouverture | disponible |
| Écritures | `journal_entries` | date, pièce, journal, compte, débit/crédit | disponible |
| Clients | `customers` | nom, référence, coordonnées | disponible |
| Sociétés | `companies` | nom, BRN, TVA, devise | disponible |

### 1.2 Profils de source

| Profil | Identifiant | Statut réel | Preuve |
|---|---|---|---|
| CSV / Excel générique | `csv`, `excel`, `other` | **pris en charge** | alias FR/EN génériques + fixtures de test |
| Sage 50 | `sage50` | **expérimental** | export fictif, aucune certification |
| Sage 200 | `sage200` | **expérimental** | export fictif, aucune certification |
| Sage Accounting | `sage_accounting` | **expérimental** | format d'export fictif, aucune connexion |
| SAP | `sap` | **expérimental** | alias de colonnes, aucun connecteur |
| QuickBooks (QBO/Desktop) | — | **aucun profil dédié** | seul le CSV générique peut être mappé manuellement |
| Xero | — | **aucun profil dédié** | seul le CSV générique peut être mappé manuellement |

Le code le dit explicitement : un profil Sage est un **jeu d'alias d'en-têtes**,
pas un pilote. Les fichiers `.xls` et les classeurs à macros sont refusés ; les
formats acceptés sont `.csv`, `.tsv` et `.xlsx`.

### 1.3 Formats de fichiers

- CSV/TSV : encodage détecté, séparateur détecté, en-têtes normalisés (accents,
  casse, espaces) ; la correspondance proposée reste modifiable colonne par colonne.
- XLSX : première feuille lisible, pas d'exécution de macro, limite de taille et de
  lignes (voir `parse.ts`), message explicite si le fichier est tronqué.
- Exports COMPTAI : CSV UTF-8 avec BOM et séparateur `;` pour les états financiers,
  grand livre, balance, immobilisations, stocks, paie et banque. Certains exports
  spécifiques (relevés, paie) utilisent la virgule : le format est celui du fichier
  téléchargé, pas une norme universelle.

### 1.4 Ce qui n'existe pas

- **Aucun export du plan comptable.** L'écran Plan comptable permet l'import, la
  modification et le modèle provisoire, mais pas l'export CSV/Excel. C'est une lacune
  réelle, alors que Sage publie un export de plan comptable dans son aide officielle
  (voir `docs/comptai-competitor-ux-matrix.md`, source S8).
- **Aucun connecteur** QuickBooks, Xero, Sage, SAP, Odoo ou Zoho.
- **Aucune reprise automatique** du lettrage, des règlements, des sections analytiques
  ou des exercices clôturés.
- **Aucun taux de change inventé** : un import multidevise exige un taux daté fourni
  par l'utilisateur ; sinon la ligne est bloquée.
- **Aucun import de pièces jointes** ni de PDF de factures dans le cadre de la reprise.

## 2. Stratégie de migration recommandée

La migration est un **projet de cabinet**, pas un bouton. Elle suit six étapes et
chaque étape produit une preuve vérifiable.

### Étape 0 — Cadrage et gel

1. Identifier la société, la date de bascule, la devise fonctionnelle et l'exercice
   ouvert dans COMPTAI.
2. Geler les saisies dans l'ancien outil à la date de bascule (ou documenter les
   écritures postées après l'extraction).
3. Sauvegarder l'ancien outil et conserver les exports bruts, horodatés et hashés.

### Étape 1 — Extraction depuis la source

| Source | Exports à demander | Remarques |
|---|---|---|
| **QuickBooks Online** | Plan comptable, balance générale à la date de bascule, journal des écritures, liste clients/fournisseurs, factures et bills ouverts | Export CSV/Excel depuis les écrans de rapports ; aucune API n'est utilisée par COMPTAI. Le libellé du bilan peut varier (Statement of Financial Position). |
| **Xero** | Chart of Accounts, Trial Balance, General Ledger / journal, contacts, aged receivables/payables | Export CSV ; les rapports d'ancienneté servent à contrôler les soldes clients/fournisseurs. Aucune connexion OAuth. |
| **Sage 50** | Plan comptable (nominal codes), journal, balance, soldes tiers | Profil `sage50` expérimental : vérifier les en-têtes et les codes journaux. |
| **Sage Accounting** | Plan comptable, journal, balance, balances âgées | Profil `sage_accounting` expérimental ; l'export du plan comptable est documenté par Sage. |
| **Sage 200 / SAP** | Journal et plan comptable | Profils expérimentaux, alias de colonnes seulement. |
| **Excel / CSV maison** | Une feuille par type d'import | Format le plus sûr pour un premier essai. |

Aucun de ces exports n'est déclaré « pris en charge » sans un test sur un fichier
fictif reproduisant sa forme. Un export réel client ne doit jamais être commité.

### Étape 2 — Normalisation

- Une ligne = un compte ou une ligne d'écriture ; pas de cellules fusionnées.
- Dates au format ISO `AAAA-MM-JJ` après contrôle (le parseur accepte aussi d'autres
  formats, mais l'ISO est la référence de test).
- Débit et crédit dans deux colonnes ; jamais de montant négatif interprété comme un
  sens.
- Devise explicite ; taux daté explicite pour les devises étrangères.
- Codes journaux existants dans COMPTAI, ou création préalable documentée.
- Comptes de tiers : si le modèle auxiliaire n'est pas compatible, l'import doit
  refuser explicitement, pas deviner.

### Étape 3 — Import à blanc et rapport

1. Téléverser dans l'assistant Migration.
2. Lire le **rapport de prévisualisation** : lignes acceptées, rejetées, doublons,
   comptes inconnus, journaux inconnus, déséquilibres.
3. Corriger le fichier ou le mapping, puis recommencer. L'import n'est pas
   « intelligent » : aucune correction comptable n'est inventée.

### Étape 4 — Reprise des soldes d'ouverture

- Utiliser la balance générale à la date de bascule, pas la balance après la première
  écriture de l'ancien outil.
- Vérifier l'égalité débit = crédit et la continuité avec l'exercice précédent.
- Les comptes de résultat ne doivent pas porter de solde d'ouverture ; s'ils en
  portent, l'écran le signale sans appliquer de règle automatique.
- Les créances, dettes, immobilisations et opérations bancaires non rapprochées sont
  contrôlées séparément dans l'onglet Soldes d'ouverture.

### Étape 5 — Rapprochement et signature

| Contrôle | Preuve attendue |
|---|---|
| Balance d'ouverture | total débit = total crédit ; écart nul |
| Balance générale COMPTAI vs source | mêmes comptes, mêmes soldes, mêmes devises |
| Grand livre | somme des mouvements = mouvements de la source |
| Clients / fournisseurs | balance âgée concordante, à la même date |
| Banque | solde comptable et relevé non rapproché documentés |
| Immobilisations / stocks | valeur brute, amortissements et quantités vérifiés ou explicitement hors périmètre |
| Journal | aucune écriture dupliquée ; référence unique |
| Multi-société | chaque dossier ne voit que ses propres lignes |

La migration n'est déclarée terminée qu'après **validation écrite de l'expert-comptable**
et conservation du rapport d'import et des fichiers sources.

### Étape 6 — Archivage

- Conserver les exports bruts, le rapport d'import, la version de COMPTAI et les
  paramètres de mapping.
- Ne pas importer deux fois le même fichier sans contrôle de doublon.
- Ne jamais restaurer une sauvegarde de production dans la démonstration.

## 3. Feuille de route de compatibilité (propositions, non implémentées)

| Priorité | Proposition | Critère d'acceptation | Risque / limite |
|---|---|---|---|
| **P2** | Export CSV du plan comptable | colonnes code, intitulé, type, devise, statut ; test de round-trip import → export → import | aucune donnée réelle ; ne pas prétendre à un format QuickBooks/Sage |
| **P2** | Fixtures fictives QuickBooks et Xero | 3 fichiers par source (plan, balance, journal) + rapport de mapping | les formats publiés changent ; pas de certification |
| **P2** | Rapport de migration téléchargeable | lignes acceptées/rejetées, doublons, contrôles, hash du fichier | ne doit pas contenir de données réelles dans le dépôt |
| **P3** | Profil Xero explicite | alias d'en-têtes testés sur fixtures | pas de connexion OAuth, pas de synchronisation |
| **P3** | Profil QuickBooks explicite | alias d'en-têtes testés sur fixtures | variantes QBO/Desktop à documenter |
| **P3** | Reprise des règlements/lettrage | conservation des liens facture → règlement | modèle de données et tests lourds ; hors M36 |
| **P3** | Import des sections analytiques | centres de coûts inexistants aujourd'hui | nécessite d'abord la fonction Centres de coûts |
| **P3** | Connecteurs API officiels | partenariat éditeur, authentification, audit | hors périmètre, aucun secret ne doit être stocké |

Ces propositions ne sont **pas** des fonctionnalités livrées. Aucun bouton ne doit
être ajouté avant l'API et les tests correspondants.

## 4. Plan de tests de migration

1. **Round-trip plan comptable** : import fictif → contrôle des codes → export (si la
   proposition P2 est réalisée) → réimport → aucun doublon.
2. **Équilibre** : un fichier déséquilibré est refusé ; aucune ligne n'est postée.
3. **Doublons** : même référence ou même clé de pièce → avertissement bloquant.
4. **Comptes/journaux inconnus** : refus explicite, pas de création silencieuse.
5. **Devises** : taux absent → refus ; taux daté → contrôle du montant fonctionnel.
6. **Multi-société** : un import dans le dossier A ne crée aucune ligne dans le dossier B.
7. **Période clôturée** : import refusé, message explicite.
8. **Fichiers hostiles** : macro, `.xls`, zip déguisé, fichier tronqué, CSV à séparateur
   ambigu → refus ou avertissement, jamais d'exécution.
9. **Non-régression** : les règles de paie, TVA, clôture et les calculs comptables ne
   sont pas modifiés par un import.

Les tests existants de migration et de plan comptable restent la référence ; la
mission 36 n'en a supprimé ni affaibli aucun.

## 5. Position à tenir devant un client

- « Nous savons importer un fichier CSV/Excel que **vous** exportez. »
- « Nous avons des profils Sage **expérimentaux**, testés sur des fichiers fictifs ;
  aucun engagement de certification. »
- « QuickBooks et Xero ne sont pas des connecteurs COMPTAI ; un export CSV peut être
  mappé manuellement, après recette. »
- « Aucun fichier client réel n'est utilisé dans la démonstration. »
- « La migration est validée par votre expert-comptable, pas par un bouton. »

Ces formulations sont conformes à l'état du code au 1er novembre 2026. Toute
communication plus forte (« compatible QuickBooks », « migration automatique »,
« certifié Sage ») serait inexacte.
