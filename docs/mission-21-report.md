# Mission 21 — Exercices, soldes d’ouverture, ajustements antérieurs et archives

_État au 31 octobre 2026. Branche `arena/fa7ebd6c-mauritius-compta`, PR ouverte en brouillon,
**aucune fusion**, aucun déploiement, aucune donnée réelle, aucun paiement, aucune déclaration
MRA. `main` reste intact._

## 1. Résumé

Cette mission complète le cycle annuel sans reconstruire la clôture de la mission 19. Le grand
livre reste **continu** : le solde d’ouverture d’un exercice est la somme des lignes comptabilisées
avant sa date de début. Aucune écriture de report n’est donc créée en double. La mission ajoute
les contrôles de ce report, un lot d’ouverture externe réservé au premier exercice, un registre
d’ajustements sur exercices antérieurs (PPA) soumis à approbation humaine, une checklist de
clôture honnête sur les modules absents, et des archives annuelles scellées avec manifeste et
empreintes.

L’écran **Comptabilité → Exercices & archives** expose ces fonctions en français et en anglais,
sur bureau et mobile, et la démonstration navigateur (schéma 15) les illustre avec des données
entièrement fictives, sans appel réseau.

## 2. Périmètre livré

| Élément | État |
|---|---|
| A. Soldes d’ouverture et report : comptes de bilan, continuité, open items, banque non rapprochée, emprunts, immobilisations, capitaux propres, absence de produits/charges en ouverture | Livré — grand livre continu, aucun report dupliqué |
| A bis. Mappings de comptes configurables et migration depuis une balance externe | Partiel — reprise externe CSV ligne par ligne liée aux comptes de la société ; pas de table de mapping réutilisable multi-sources |
| B. Ajustements antérieurs : référence d’origine, motif, justificatif, traitement explicite, approbation, retraitement comparatif indicatif, original préservé | Livré |
| C. Archivage annuel : balance, grand livre, journaux, états, rapprochements, immobilisations, capitaux propres, ajustements, justificatifs référencés, approbations, manifeste et empreintes, export JSON/ZIP, lecture seule | Livré pour le snapshot comptable ; documents scannés non inclus |
| C bis. Rétention | Champ facultatif et note libre ; **aucune durée légale inventée** |
| D. Checklist réutilisable à treize contrôles | Livré ; contrôles des modules absents en `unavailable`/`pending` |
| E. Interface FR/EN responsive | Livré (cinq onglets) |
| F. Démonstration fictive | Livré — deux exercices clôturés archivés, exercices ouverts, PPA documenté, preuves de rapprochement |
| G. Tests ciblés | Livré — API 5/5, démo web 5/5, UI web 3/3 |

### Ce qui n’est pas prétendu

- Aucune conformité MRA, IFRS for SMEs ou norme mauricienne n’est affirmée.
- Un paquet scellé n’est **pas** une archive légalement certifiée et ne contient pas les scans.
- En mode démonstration, les empreintes sont des **empreintes de démonstration** (`demo-…`),
  pas du SHA-256, et le bouton d’export télécharge un JSON marqué démo, jamais un ZIP serveur.
- Aucune réouverture d’un exercice clôturé, aucune modification d’une écriture ou d’une archive
  scellée, aucun traitement PPA choisi automatiquement.

## 3. Réutilisé vs nouvellement implémenté

### Réutilisé tel quel

- Moteur d’écritures : `prepareEntry`, `assertOpenPeriod`, `loadJournal`, `loadAccounts`,
  `insertLines`, `nextEntryNo`, `postEntryTx`.
- Clôture annuelle, création de l’exercice suivant et affectation du résultat (mission 19).
- États : `computeTrialBalance`, `computeLedger`, `computeStatements`.
- Rapprochement bancaire : `bankReconciliationReport`.
- Immobilisations : les sept états de `fixed-assets/reports.ts`.
- Composants UI (`Card`, `Field`, `Modal`, `Badge`, `Button`, `EmptyState`, `Spinner`,
  `ErrorBanner`, `DemoNotice`), `useAsync`, `api`, `money`, `today`, `demoEnabled`.
- Harnais PGlite des tests API et harnais demo local des tests web.

### Nouvellement implémenté

- Migration `0019_financial_years_archives.sql` (7 tables, triggers d’isolation et
  d’immuabilité, source d’écriture `prior_year_adjustment`).
- Module `apps/api/src/modules/financial-years/` : `opening.ts`, `adjustments.ts`,
  `checklist.ts`, `archive.ts`, `timeline.ts`, `routes.ts`, `types.ts`.
- Écran `apps/web/src/pages/accounting/FinancialYears.tsx` et son entrée de navigation.
- Démo `apps/web/src/demo/financial-years.ts`, schéma démo 14 → 15, migration locale
  transparente des états existants.
- Tests `apps/api/tests/financial-years.test.ts`, `apps/web/tests/demo-financial-years.test.ts`
  et `apps/web/tests/financial-years-ui.test.tsx`.

Aucun second moteur comptable, aucun second calcul de clôture, aucun numéro de compte imposé.

## 4. Migration `0019_financial_years_archives.sql`

| Table | Rôle |
|---|---|
| `fiscal_year_settings` | Comptes d’attente, mois de rétention facultatifs, notes de rétention et de sauvegarde |
| `opening_balance_batches` / `opening_balance_lines` | Reprise externe initiale `DRAFT → APPROVED → POSTED` |
| `prior_year_adjustments` / `prior_year_adjustment_lines` | PPA `PROPOSED → APPROVED → POSTED` / `REJECTED` |
| `year_end_checklists` | Checklists versionnées `GENERATED → REVIEWED` |
| `fiscal_archives` | Manifeste, instantané JSONB, empreinte globale, taille, statut `SEALED`, rétention |

Contraintes : `company_id` partout, clés étrangères composites, triggers de cohérence société,
interdiction de mise à jour/suppression d’une archive scellée et des lots/ajustements traités.
La contrainte `journal_entries_source_check` accepte désormais `prior_year_adjustment`.

## 5. Décision d’architecture — report continu

Le report est un **dispositif de contrôle**, pas une écriture. `previewOpening` renvoie :

- `method = 'continuous_ledger'` ;
- les soldes d’ouverture (lignes avant la date de début) ;
- les soldes de clôture de l’exercice précédent ;
- les écarts par compte et les totaux ;
- `OPENING_BALANCED`, `NO_PNL_OPENING`, `CARRY_FORWARD_CONTINUOUS` / `CARRY_FORWARD_GAP` /
  `CARRY_FORWARD_FIRST_PERIOD` ;
- les éléments préservés : factures clients ouvertes, documents fournisseurs ouverts,
  transactions bancaires non rapprochées, immobilisations, soldes de capitaux propres,
  et l’indisponibilité explicite du module emprunts.

Un lot d’ouverture externe n’est autorisé que si **aucune écriture comptabilisée n’existe avant**
la période de destination (`OPENING_ENTRIES_ALREADY_EXIST`). Il ne crée donc jamais un second
report. Une fois comptabilisé, il porte la source `opening`.

## 6. Ajustements sur exercices antérieurs (PPA)

- La période source doit être **clôturée** ; la date de l’ajustement doit être postérieure à sa
  fin. L’écriture d’origine n’est jamais modifiée.
- Champs obligatoires : référence d’origine, motif (≥ 10 caractères), référence du justificatif.
- Traitement choisi **explicitement** : `retained_earnings`, `current_year_result` ou `custom`.
  Aucune règle mauricienne, fiscale ou IFRS n’est appliquée automatiquement.
- Contrôles : équilibre, compte actif, ligne de capitaux propres pour un traitement en report à
  nouveau, ligne de résultat pour un traitement en résultat de l’exercice.
- Cycle : `PROPOSED → APPROVED → POSTED` (ou `REJECTED`), avec confirmation et note managériales.
  La comptabilisation exige une période **ouverte** à la date de l’ajustement.
- L’aperçu de retraitement compare le résultat d’origine de l’exercice source (hors écriture de
  clôture) et le résultat retraité. Il est **indicatif** : aucune décision de présentation n’est
  imposée et les archives scellées restent inchangées.

## 7. Checklist de clôture (13 contrôles)

`UNPOSTED_JOURNALS`, `TRIAL_BALANCE_INTEGRITY`, `BANK_RECONCILIATION`,
`SUSPENSE_ACCOUNTS`, `FIXED_ASSET_DEPRECIATION`, `ACCRUALS_PREPAYMENTS`, `PROVISIONS`,
`INVENTORY`, `CUSTOMER_BALANCES`, `SUPPLIER_BALANCES`, `PROFIT_ALLOCATION`,
`PRIOR_YEAR_ADJUSTMENTS`, `MISSING_SUPPORTING_DOCUMENTS`.

- `ACCRUALS_PREPAYMENTS`, `PROVISIONS` et `INVENTORY` restent **`unavailable`** tant que les
  modules dédiés n’existent pas.
- `SUSPENSE_ACCOUNTS` reste **`pending`** tant qu’aucun compte d’attente n’est configuré.
- `ready` n’est vrai que si aucun contrôle n’est bloquant, en alerte ou en attente.
- Aucun contrôle ne comptabilise ni ne clôture quoi que ce soit.

## 8. Archives annuelles

Sections du snapshot : `trialBalance`, `generalLedger`, `statements`, `journals`,
`bankReconciliations`, `fixedAssets` (sept états), `equity`, `adjustments`, `openingBalances`,
`supportingDocuments` (nom, taille, SHA-256), `approvals` (journal d’audit) et `retention`.

Le manifeste (`mauritius-compta-archive/v1`) contient pour chaque section son empreinte SHA-256
et sa taille, puis une empreinte globale du manifeste. L’export serveur propose JSON ou ZIP
(`manifest.json`, `sections/*.json`, `README.txt`). La vérification recalcule les empreintes
depuis l’instantané stocké. Une archive scellée est en lecture seule et ne peut être ni modifiée
ni supprimée par l’application.

Limites inscrites dans le manifeste : ce n’est **pas** une archive légalement certifiée, les
documents scannés ne sont pas inclus et la rétention est une décision humaine.

## 9. Interface et démonstration

- Onglets : chronologie, soldes d’ouverture, ajustements antérieurs, contrôles de clôture et
  paramètres annuels, archives.
- Actions de démonstration : import CSV d’une balance d’ouverture, approbation d’un ajustement,
  génération et revue d’une checklist, scellement et vérification d’une archive, lecture d’une
  section, modification de la politique de rétention.
- La démonstration contient **deux exercices clôturés et archivés**, un ajustement antérieur
  comptabilisé, un ajustement proposé, et des exercices ouverts (l’exercice courant et
  l’exercice de paie 2026/2027 créé par la mission 14). Ce second exercice ouvert est réel et
  visible ; il n’est pas masqué pour « faire joli ».
- La clôture de démonstration héritée de la mission 19 est **partielle** au regard de toute
  l’activité fictive : des soldes de résultat subsistent à l’ouverture suivante. Le contrôle
  `PNL_OPENING_PRESENT` les signale comme bloquants au lieu de les masquer ; c’est une limite
  de la démonstration, pas une règle de production.
- Empreintes de démonstration : `demo-…`, explicitement non cryptographiques. Le téléchargement
  en mode démo est un JSON, jamais présenté comme un ZIP serveur.

## 10. Tests et CI

Exécuté localement le 31 octobre 2026 :

| Suite | Résultat |
|---|---|
| `apps/api/tests/financial-years.test.ts` | **5/5** |
| `apps/api/tests/migrations.test.ts` | **6/6** |
| Suite API complète | **447 réussis, 11 ignorés** |
| `apps/web/tests/demo-financial-years.test.ts` | **5/5** |
| `apps/web/tests/financial-years-ui.test.tsx` | **3/3** |
| Suite web complète | **218/218** |
| `npm run typecheck` (API + web) | 0 erreur |
| `npm run build:demo -w @mc/web` | réussi |

Les tests ciblés couvrent : soldes d’ouverture équilibrés, absence de report en double,
continuité pluriannuelle, immuabilité des périodes clôturées, approbation PPA, intégrité et
vérification des archives, isolation entre sociétés et régression des missions 19/20.
La CI GitHub Actions est déclenchée par la PR brouillon ; son résultat est vérifié après le push
et ne peut pas être affirmé avant son exécution.

## 11. Limites et manques réels

- Pas de table de mapping de comptes réutilisable pour des reprises externes répétées ; le CSV
  de démonstration mappe directement les codes du plan comptable de la société.
- Pas de module emprunts, provisions, stocks ni charges constatées d’avance : contrôles
  explicitement indisponibles.
- Pas de pièces jointes dans l’archive : seules leurs métadonnées et empreintes sont reprises.
- Pas de signature électronique, pas d’horodatage qualifié, pas de certification légale.
- Pas de politique de rétention appliquée automatiquement (purge, gel, restauration).
- Pas d’export PDF des états dans l’archive ; les données sont en JSON.
- Les documents scannés et leur sauvegarde restent hors du périmètre.
- La vérification d’archive prouve l’intégrité du snapshot, pas l’exhaustivité des pièces.
- Aucune validation sur Samsung Android physique ni Chrome Windows réel dans cet environnement ;
  les tests d’interface sont exécutés en jsdom.

## 12. Questions pour la revue professionnelle (anglais)

1. For a Mauritian company using a continuous ledger, should the annual closing entry zero all
   profit-and-loss accounts, including balances arising from modules that were not part of the
   original closing scope? What residual P&L balance is acceptable at the next opening?
2. When a prior-year error is corrected, which presentation is expected locally: restatement of
   the comparative year, adjustment in opening retained earnings only, or disclosure in the notes?
   Please indicate the criteria and the authority relied upon.
3. Does the treatment differ for a correction of a fundamental error versus a change in estimate,
   and should the original statutory accounts be reissued?
4. What evidence should be retained for a prior-year adjustment: original document, approval
   minute, journal reference, revised trial balance, and/or tax correspondence?
5. Is a sealed JSON snapshot with SHA-256 checksums acceptable as supporting evidence for an
   audit, or are signed PDFs / certified electronic archives required?
6. Are there local retention requirements for accounting records, tax records and supporting
   documents that should drive the configurable retention field? Please provide the legal
   references; the software does not assert any duration.
7. Should a sealed archive be re-generated after a subsequent correction, or should it remain
   untouched with the correction documented in a later archive version?
8. Which suspense or clearing accounts are customary in Mauritius, and what ageing policy should
   be applied before closing?
9. For the annual checklist, are there additional mandatory controls (for example MRA return
   reconciliation, TDS/PAYE, CSR, or statutory registers) that should be added once the relevant
   modules exist?
10. Should opening balances for the first year be imported from an externally prepared trial
    balance and approved by the auditor, or reconciled line by line to source documents?

## 13. Fichiers principaux

- `apps/api/sql/migrations/0019_financial_years_archives.sql`
- `apps/api/src/modules/financial-years/{types,opening,adjustments,checklist,archive,timeline,routes}.ts`
- `apps/api/tests/financial-years.test.ts`
- `apps/web/src/pages/accounting/FinancialYears.tsx`
- `apps/web/src/demo/financial-years.ts`, `apps/web/src/demo/runtime.ts`
- `apps/web/tests/demo-financial-years.test.ts`, `apps/web/tests/financial-years-ui.test.tsx`
- `apps/web/src/{App.tsx,modules.ts,i18n.tsx}`
