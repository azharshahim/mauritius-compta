# Rapport de mission 18 — intégration Paie → Comptabilité et propositions d’écritures

Date : 31 octobre 2026. Branche `arena/b0b62798-mauritius-compta`, PR nº1 **ouverte en brouillon**, `main` intacte (`9e46f16`). **Aucune fusion, aucun déploiement OVH, aucune donnée réelle, aucun paiement, aucune déclaration MRA, aucun fournisseur payant.** La comptabilisation définitive d’une paie non validée reste **impossible**.

## 1. Objectif et décision d’architecture

La mission relie le moteur de paie au moteur comptable **sans le reconstruire** :

- les calculs de paie sont lus depuis `payroll_calculations` ;
- les comptes et le journal viennent du plan comptable et des journaux **de la société** ;
- les propositions sont des instantanés versionnés, contrôlés et décidés par un humain ;
- une approbation « pour test » **ne crée aucune écriture** ;
- la comptabilisation passe uniquement par le service comptable existant (`prepareEntry`, `assertOpenPeriod`, `nextEntryNo`, `loadJournal`, `loadAccounts`, `insertLines`).

Aucun numéro français (421, 431, 641, 645) n’est imposé et aucun plan comptable mauricien n’a été inventé. Les 13 rôles de correspondance sont configurés par l’utilisateur avec les comptes de sa société.

## 2. Audit initial et réutilisation

| Élément existant | Réutilisation |
|---|---|
| `journal_entries`, `entry_lines`, `entry_sequences` | Écriture de paie éventuelle, source `payroll`, numérotation `CODE-YYYY-0001` |
| `prepareEntry` | Validation 2 à 200 lignes, société, comptes actifs, débit XOR crédit, exactitude décimale |
| `assertOpenPeriod` | Refus si aucune période comptable ouverte à la date d’écriture |
| `loadJournal` / `loadAccounts` | Journal et comptes de la société uniquement |
| `insertLines` | Insertion atomique des lignes préparées |
| `journal_entries.status = posted` | Une écriture comptabilisée reste immuable |
| `writeAudit` / événements paie | Traçabilité de la validation, du rejet et de la comptabilisation |
| Permissions `requireModuleAccess` | Lecture paie, écriture paie et écriture comptable restent distinctes |
| `apps/api/tests/helpers.ts` | PGlite, migrations, isolation société, charte de test |

Aucun module comptable, aucune numérotation et aucun contrôle réglementaire n’ont été supprimés ou affaiblis.

## 3. Migration `0016_payroll_accounting_transfer.sql`

Migration additive et idempotente. Prochaine migration libre : `0017`.

### `payroll_account_mappings`

Versionnée par société, avec :

- 13 rôles : rémunérations brutes, charges CSG/NSF/levy, PAYE, CSG salarié, CSG employeur, NSF salarié, NSF employeur, levy à payer, net à payer, autres retenues, remboursements ;
- `journal_id` obligatoire ;
- statut `VALIDATED` ou `SUPERSEDED` ;
- un seul mapping `VALIDATED` par société (index unique partiel) ;
- validateur, horodatage, note, historique conservé ;
- trigger PostgreSQL vérifiant que **tous** les comptes et le journal appartiennent à la même société.

### `payroll_accounting_transfers`

Instantané immuable contenant :

- société, période, version, statut ;
- version et identifiant du mapping ;
- identifiants des calculs source, empreinte `source_fingerprint`, règles source ;
- lignes, totaux, contrôles, avertissements, blocages de comptabilisation ;
- auteur, date, décision, motif de rejet, référence de l’écriture comptable ;
- contraintes : un seul `POSTED` par période, une seule approbation/posted par empreinte, lignes non modifiables après décision, motifs obligatoires pour rejet.

### Journal

La contrainte `journal_entries_source_check` accepte désormais `payroll`, sans retirer les sources existantes.

## 4. Statuts et transitions

| Statut | Signification | Crée une écriture ? |
|---|---|---|
| `DRAFT` | Proposition complète mais non revue | Non |
| `REVIEW_REQUIRED` | Contrôles bloquants absents, avertissements présents (règles non validées par un expert) | Non |
| `BLOCKED` | Au moins un contrôle bloquant | Non |
| `APPROVED_FOR_TEST` | Décision humaine explicite, préparation de test uniquement | **Non** |
| `REJECTED` | Décision humaine motivée ; une nouvelle proposition peut être générée | Non |
| `POSTED` | Comptabilisation définitive, réservée aux conditions réelles | Oui, via le service comptable |

`APPROVED_FOR_TEST`, `REJECTED` et `POSTED` ne sont **pas interchangeables**. Une proposition approuvée pour test ne peut pas être rejetée puis réutilisée : un rejet exige une nouvelle proposition. Une proposition devenue obsolète après recalcul ou changement de mapping renvoie `PAYROLL_TRANSFER_STALE` ou `PAYROLL_TRANSFER_MAPPING_STALE`.

## 5. Correspondances configurables

Menu **Paie & RH → Transfert comptable → Configurer les correspondances**.

- Journal unique : tout journal actif de la société.
- Comptes choisis dans le plan de la société, avec code, libellé et état actif.
- Champs obligatoires : 11 rôles ; « autres retenues » et « remboursements » sont facultatifs et ne bloquent que si un montant correspondant existe.
- La validation exige une confirmation explicite, crée une nouvelle version et marque l’ancienne `SUPERSEDED`.
- Un compte inactif, absent ou appartenant à une autre société est refusé.
- La modification d’un mapping validé **n’altère jamais** une proposition existante : celle-ci devient obsolète et doit être régénérée.

La démonstration utilise des comptes fictifs propres à chaque société :

| Société fictive | Rémunérations | Charges patronales | PAYE | CSG/NSF/levy | Net | Journal |
|---|---|---|---|---|---|---|
| Lagon Bleu | 6000 | 6010 | 2300 | 2400 | 2100 | OD |
| Mauritius Demo Services | 6020 | 6030 | 2220 | 2230 | 2210 | OD |

Ces numéros sont **propres à la démonstration** et ne constituent pas une recommandation comptable.

## 6. Contrôles exécutés avant toute décision

Les contrôles sont séparés en trois niveaux :

- **`ok`** : conforme ;
- **`warning`** : à vérifier, n’empêche pas l’approbation pour test ;
- **`block`** : interdit l’approbation et la génération d’un statut autre que `BLOCKED`.

Codes principaux :

`COMPANY_ISOLATION`, `CALCULATIONS_PRESENT`/`MISSING`, `CURRENCY_MUR`/`CURRENCY_NOT_MUR`, `CALCULATIONS_COMPLETE`/`INCOMPLETE`, `STATUTORY_VALUES_PRESENT`/`NULL`, `EMPLOYEE_COVERAGE`, `DUPLICATE_EMPLOYEE`, `PERIOD_MATCH`, `ACCOUNT_MAPPING_PRESENT`/`MISSING`, `ACCOUNT_MAPPING_ACTIVE`/`INACTIVE`, `JOURNAL_ACTIVE`/`INACTIVE`, `ACCOUNTING_PERIOD_OPEN`/`CLOSED`, `OTHER_DEDUCTIONS_MAPPED`/`MISSING`, `REIMBURSEMENTS_MAPPED`/`MISSING`, `REIMBURSEMENTS_NON_NEGATIVE`/`NEGATIVE`, `NET_AFTER_STATUTORY_CONSISTENT`/`MISMATCH`, `EMPLOYER_CONTRIBUTIONS_CONSISTENT`/`MISMATCH`, `EMPLOYER_COST_CONSISTENT`/`MISMATCH`, `ENTRY_BALANCED`/`UNBALANCED`, `ENTRY_TOO_FEW_LINES`, `ACCOUNT_MISSING_ON_LINE`, `RULES_NOT_EXPERT_VALIDATED`, `RULES_EXPERT_VALIDATED`.

Aucun contrôle « bloquant » n’est converti en avertissement. Aucune ligne d’ajustement n’est créée pour forcer l’équilibre.

### Blocages de comptabilisation définitive

Trois contrôles distincts bloquent toujours `POST` dans cette mission :

- `PAYROLL_RULES_NOT_EXPERT_VALIDATED` ;
- `PAYROLL_PERIOD_NOT_FINALISED` ;
- `PAYROLL_CALCULATIONS_NOT_APPROVED`.

Le refus est un **409 `PAYROLL_TRANSFER_POSTING_BLOCKED`** avec le détail des blocages. Le bouton « Comptabiliser » de l’interface est affiché désactivé avec la raison ; aucun faux bouton ne prétend réaliser l’opération.

## 7. Exemple d’écriture équilibrée — octobre 2026

Société fictive **Mauritius Demo Services Ltd**, salarié fictif **Daniel Morel** (`MDS001`), base Rs 30 000, calcul persisté :

- brut : **30 635,0000**
- PAYE : **0,0000**
- CSG salarié : **459,5250**
- NSF salarié : **297,1000**
- CSG employeur : **919,0500**
- NSF employeur : **742,7500**
- Training Levy : **459,5250**
- net arithmétique : **29 878,3750**
- net après statutaires : **29 878,3750**
- coût employeur : **32 756,3250**

Proposition (démo, mapping ci-dessus) :

| Ligne | Compte | Libellé | Débit | Crédit |
|---:|---|---|---:|---:|
| 1 | 6020 | Rémunérations brutes | 30 635,0000 | — |
| 2 | 6030 | CSG employeur | 919,0500 | — |
| 3 | 6030 | NSF employeur | 742,7500 | — |
| 4 | 6030 | Training Levy | 459,5250 | — |
| 5 | 2230 | CSG salarié retenue | — | 459,5250 |
| 6 | 2230 | CSG employeur à payer | — | 919,0500 |
| 7 | 2230 | NSF salarié retenue | — | 297,1000 |
| 8 | 2230 | NSF employeur à payer | — | 742,7500 |
| 9 | 2230 | Training Levy à payer | — | 459,5250 |
| 10 | 2210 | Salaires nets à payer | — | 29 878,3750 |
| | | **Totaux** | **32 756,3250** | **32 756,3250** |

- Écart : **0,0000**.
- La PAYE nulle ne produit aucune ligne artificielle.
- Aucune ligne d’arrondi ou d’ajustement n’est ajoutée.
- Les quatre décimales sont conservées dans les montants internes et le CSV. L’interface utilise l’affichage exact existant (`moneyExact`), sans arrondi silencieux.
- L’approbation pour test **ne crée aucune ligne** dans `journal_entries` (vérifié par test).

## 8. API

Toutes les routes sont sous `/api/companies/:companyId/payroll`.

| Méthode | Route | Permission |
|---|---|---|
| `GET` | `/accounting/mapping` | lecture paie |
| `PUT` | `/accounting/mapping` | écriture paie + confirmation |
| `GET` | `/periods/:periodId/accounting-transfer` | lecture paie |
| `POST` | `/periods/:periodId/accounting-transfer` | écriture paie |
| `GET` | `/accounting-transfers?periodId=` | lecture paie |
| `GET` | `/accounting-transfers/:transferId` | lecture paie |
| `POST` | `/accounting-transfers/:transferId/approve` | écriture paie |
| `POST` | `/accounting-transfers/:transferId/reject` | écriture paie |
| `POST` | `/accounting-transfers/:transferId/post` | écriture paie **et** écriture comptable |
| `GET` | `/accounting-transfers/:transferId/csv` | lecture paie |

L’ancienne route `GET /periods/:periodId/accounting-preview` reste compatible et renvoie désormais la vraie prévisualisation, avec `postingBlocked: true` et `reason: PAYROLL_ACCOUNTING_SIMULATION_ONLY`.

### Anti-doublons et immuabilité

- Index unique : un seul transfert `POSTED` par `(company_id, period_id)`.
- Index unique : une seule approbation/posted par `(company_id, period_id, source_fingerprint)`.
- Garde applicative supplémentaire `PAYROLL_TRANSFER_DUPLICATE_SOURCE` : un second jeu identique ne peut pas être approuvé.
- Les calculs source sont les **derniers calculs par salarié**, avec leur version et leur empreinte.
- Toute modification des calculs, du mapping ou de la période rend la proposition obsolète.
- Les transferts sont filtrés par société à chaque lecture et à chaque décision.

## 9. Interface

`apps/web/src/pages/payroll/AccountingTransfer.tsx`, onglet **Paie & RH → Transfert comptable**.

Affiche :

- société, période, nombre de salariés, devise ;
- total brut, retenues salariales, charges patronales, net arithmétique, coût employeur ;
- état des correspondances (version, journal, validateur, comptes, compte inactif ou absent) ;
- prévisualisation des lignes débit/crédit avec compte et description ;
- totaux débit/crédit et écart ;
- contrôles `ok` / `warning` / `block` ;
- bouton de génération (désactivé si des blocages existent) ;
- historique versionné avec statut, date, coût employeur et détail ;
- détail d’une proposition : empreinte, calculs source, décision, motif de rejet ;
- approbation pour test et rejet motivé, chacun avec confirmation explicite ;
- export CSV interne ;
- bouton de comptabilisation **désactivé** avec explication, sans action factice.

Aucun appel réseau n’est effectué en mode démonstration (vérifié par test).

## 10. Démonstration GitHub Pages

Parcours :

1. ouvrir `https://azharshahim.github.io/mauritius-compta/` ;
2. se connecter avec le compte fictif de démonstration ;
3. choisir **Mauritius Demo Services Ltd** ;
4. **Paie & RH → Transfert comptable** ;
5. vérifier la période **10/2026**, les totaux et les correspondances fictives ;
6. générer une proposition ;
7. vérifier l’équilibre 32 756,3250 = 32 756,3250 ;
8. approuver pour test ou rejeter avec motif ;
9. exporter le CSV interne.

Le CSV porte `INTERNAL SIMULATION`, l’empreinte des calculs, les identifiants source, les décisions et la mention `NO JOURNAL ENTRY IS CREATED BY THIS FILE`. Il ne contient aucun gabarit PACO, aucune référence MRA officielle et ne peut pas être confondu avec un export réglementaire.

La démonstration utilise `localStorage` uniquement ; la réinitialisation de la démo restaure les données fictives. Le schéma local passe de 11 à 12 et les anciens états sont réinitialisés.

## 11. Tests et vérifications

| Vérification | Résultat |
|---|---|
| `apps/api` — `npx vitest run` | **418 réussis, 11 ignorés** (26 fichiers, dont 11 nouveaux tests mission 18) |
| `apps/web` — `npx vitest run` | **198 réussis** (23 fichiers, dont 7 nouveaux tests de démonstration + 1 test d’interface) |
| `tests/migrations.test.ts` | **6/6**, migration `0016` appliquée sur base neuve |
| `npx tsc --noEmit -p apps/api/tsconfig.json` | ✅ |
| `npx tsc --noEmit -p apps/web/tsconfig.json` | ✅ |
| `npx tsc -p apps/api/tsconfig.json` | ✅ |
| `npx tsc -p apps/web/tsconfig.test.json --noEmit` | ✅ |
| `npx vite build` (web) | ✅ (avertissement de taille de chunk, non bloquant) |
| `VITE_DEMO_MODE=true npx vite build` | ✅ (chunk démo 1 343,03 kB, avertissement non bloquant) |

Couverture mission 18 :

- génération depuis calculs persistés ;
- équilibre exact et absence de ligne d’ajustement ;
- retenues salariales et charges employeur ;
- correspondances manquantes ou incomplètes ;
- compte inactif ;
- isolation entre sociétés ;
- approbation pour test **sans écriture** ;
- rejet motivé puis nouvelle version ;
- recalcul rendant la proposition obsolète ;
- doublon d’empreinte ;
- versionnement des correspondances et historique ;
- export CSV interne ;
- absence de comptabilisation automatique ;
- permissions séparées paie / comptabilité ;
- calcul de paie bloqué (`rules_incomplete`) ;
- non-régression des modules existants.

**Non exécuté ou non observable :** suite PostgreSQL réelle (`postgres-tests`), rendu Chrome Windows/Android. Aucun script `lint` n’est défini à la racine. Les tests de concurrence restent ignorés comme avant la mission. Aucun navigateur graphique n’est disponible dans l’environnement.

## 12. Limites honnêtes

- **Aucune comptabilisation définitive n’est possible** : les règles de paie restent `RESEARCHED` et non validées par un expert ; les calculs ne sont pas approuvés pour usage réel ; la période n’est pas finalisée.
- Les correspondances de démonstration sont **fictives** et ne constituent pas un plan comptable mauricien.
- Aucune conformité MRA/PAYE/CSG/NSF n’est affirmée. Aucune déclaration n’est préparée, soumise ou payée ici.
- Le CSV est un fichier interne de simulation, pas un export officiel.
- Le rendu réel des écrans n’a pas été observé sur un appareil Samsung Android physique ; les contraintes de largeur sont couvertes par les tests existants et la mise en page responsive.
- La comptabilisation réelle devra être revue lors d’une **revue professionnelle unique** avec l’expert-comptable (rôles, comptes, TVA éventuelle, arrondis, date de paiement, traitement des avances et remboursements).

## 13. Procédure de vérification locale

### Windows

```powershell
git switch arena/b0b62798-mauritius-compta
git pull
npm ci
npm run build
npm run test
npm run dev
```

Ouvrir l’URL locale affichée, se connecter avec le compte de démonstration fictif, puis suivre le parcours de la section 10. En mode API, vérifier que `POST .../accounting-transfers/:id/post` renvoie bien **409** et qu’aucune ligne n’apparaît dans `journal_entries`.

### Android

1. Ouvrir la démo GitHub Pages dans Chrome Android.
2. Se connecter, choisir la société fictive, ouvrir **Paie & RH → Transfert comptable**.
3. Vérifier l’absence de débordement horizontal, la lisibilité des montants à quatre décimales et l’accessibilité des boutons.
4. Ne pas saisir de données réelles. Le clavier ne doit pas être forcé ni rouvert par la navigation.

## 14. Points à valider lors de la revue professionnelle unique

1. Rôles comptables retenus et comptes réellement attendus par le cabinet.
2. Traitement de la TVA ou de tout autre impôt indirect sur la paie (aucun n’est implémenté ici).
3. Arrondis légaux des cotisations et de la levy, et politique d’affichage à quatre décimales.
4. Date de comptabilisation : date de paie, date de paiement ou date de fin de période.
5. Traitement des avances, remboursements et autres retenues.
6. Conditions exactes permettant un jour de passer au statut `POSTED` (validation experte des règles, finalisation de la paie, droits).
7. Format et statut du CSV interne, hors périmètre MRA.
