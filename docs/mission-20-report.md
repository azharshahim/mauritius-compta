# Mission 20 — Immobilisations et amortissements

_État au 31 octobre 2026. Branche `arena/1aa34791-mauritius-compta`, PR ouverte en brouillon,
**aucune fusion**, aucun déploiement, aucune donnée réelle, aucun paiement, aucune déclaration
MRA. `main` reste intact._

## 1. Résumé

Cette mission ajoute un registre d'immobilisations par société, des catégories configurables,
un moteur d'amortissement exact (linéaire et dégressif, prorata temporis, valeur résiduelle,
révision prospective), des propositions d'écritures soumises à validation humaine, sept états
exportables en CSV et PDF, et un écran bilingue **Comptabilité → Immobilisations**.

Le moteur comptable existant est réutilisé : `prepareEntry`, `assertOpenPeriod`, `nextEntryNo`,
`loadJournal`, `loadAccounts`, `insertLines`, `postEntryTx`. Aucun second moteur d'écriture n'a
été créé. Aucun numéro de compte officiel, taux fiscal, durée fiscale ou règle mauricienne
d'amortissement n'est codé en dur.

## 2. Périmètre livré

| Élément | État |
|---|---|
| A. Registre complet (identification, société, catégorie, description, référence, localisation, dates, fournisseur/facture/justificatif, coût + frais, valeur résiduelle, devise et taux documenté, responsable, historique) | Livré |
| B. Catégories configurables par société (8 modèles, comptes choisis par l'utilisateur, aucun compte imposé) | Livré |
| C. Linéaire et dégressif, prorata temporis, durée, valeur résiduelle, dates, calcul mensuel, révision prospective, suspension/reprise justifiée, historique | Livré |
| C bis. Amortissement fiscal / capital allowances | **Non calculé** — champ de suivi séparé et avertissement explicite ; aucun taux inventé |
| D. Propositions d'écritures : acquisition, en-cours, mise en service, dotation, dépréciation/reprise, cession, mise au rebut, plus/moins-value, transfert | Livré |
| D bis. Comptabilisation automatique | **Jamais** : approbation humaine puis comptabilisation explicite |
| E. Contrôles (mise en service, double dotation, VNC, plafond, périodes clôturées, équilibre, isolation, traçabilité, milieu d'exercice) | Livré |
| 7 états + CSV + PDF | Livré |
| Interface FR/EN responsive, filtres catégorie / statut / exercice (via dates) / société (session) | Livré |
| Démonstration fictive, deux sociétés, deux méthodes | Livré |

### Limites de périmètre assumées

- Pas de réévaluation (modèle du coût uniquement) ; la dépréciation est ponctuelle et justifiée.
- Pas d'amortissement fiscal, ni de liasse, ni de déclaration.
- Pas de composants multiples par actif.
- Pas de consolidation, ni d'élimination, ni de conversion d'états.
- Pas de workflow de signature électronique.
- Les filtres de l'écran portent sur la catégorie, le statut et les dates ; la société est celle
  de la session (aucune vue multi-société consolidée).

## 3. Modèle de données — migration `0018_fixed_assets.sql`

| Table | Rôle |
|---|---|
| `fixed_asset_categories` | Catégories par cabinet et société, comptes par rôle, méthode et durée par défaut |
| `fixed_assets` | Fiche actif, coût, devise, taux documenté, valeur résiduelle, statut, cession |
| `fixed_asset_estimates` | Historique daté des estimations (méthode, durée, valeur résiduelle, taux, motif) |
| `fixed_asset_events` | Journal des changements (mise en service, suspension, reprise, révision, cession, rebut) |
| `fixed_asset_depreciation_batches` | Lots de dotation `DRAFT → APPROVED → POSTED` (+ `CANCELLED`) |
| `fixed_asset_depreciation_lines` | Une ligne par actif et par mois, avec jours actifs et VNC |
| `fixed_asset_impairments` | Dépréciation et reprise justifiées, statut `POSTED` |
| `fixed_asset_proposals` | Propositions d'écritures `PROPOSED → APPROVED → POSTED` / `REJECTED` |
| `fixed_asset_sequences` | Numérotation par société et exercice |

Contraintes : `company_id` sur chaque table, clés étrangères composites vers la société,
triggers d'isolation, unicité des lots et des références, statuts contrôlés par `CHECK`,
immutabilité des lots comptabilisés et des propositions traitées.

## 4. Moteur d'amortissement — `depreciation.ts`

### Conventions exactes

- Montants en `bigint` échelle 4 ; taux en `bigint` échelle 8 ; **aucun flottant JS**.
- Base amortissable = coût fonctionnel − valeur résiduelle fonctionnelle.
- **Linéaire** : base / durée en mois, arrondi exact au centime ; le dernier mois est complété
  pour que le cumul atteigne exactement la base.
- **Dégressif** : taux annuel fourni par l'utilisateur (échelle 8) appliqué à la VNC
  d'ouverture, prorata des jours actifs ; plafonnement à la base.
- **Prorata temporis** : un mois entièrement actif vaut 1/12 ; un mois partiel est calculé au
  prorata des jours calendaires actifs (`activeDays`).
- **Début** : jamais avant la mise en service (`in_service_date`).
- **Fin** : `lifeEnd <= monthEnd` — un actif n'est jamais soldé dès le premier mois par
  complément anticipé.
- Valeur résiduelle respectée ; VNC jamais négative ; aucune dotation au-delà de la base.
- Révision prospective : la nouvelle estimation s'applique à la VNC à sa date d'effet, les
  périodes antérieures restent inchangées.
- Suspension : dates et motif obligatoires ; aucune dotation sur les jours suspendus.

### Ce qui n'est pas calculé

- Aucun taux fiscal, aucune *capital allowance*, aucun *pooling*. Le champ de suivi fiscal est
  séparé et l'interface indique explicitement que le calcul fiscal n'est pas effectué.
- Aucune règle IFRS n'est affirmée ; les conventions ci-dessus sont des conventions de calcul
  paramétrables, à valider par un professionnel.

## 5. Propositions d'écritures et contrôles

Fichier `accounting.ts` :

- `previewDepreciation` : simulation sans écriture, contrôle d'équilibre, blocages et
  avertissements.
- `createBatch` / `approveBatch` / `postBatch` : note d'approbation obligatoire, comptabilisation
  dans la période ouverte, anti-doublon par actif et période.
- `buildProposal` : construit les lignes depuis les comptes de la catégorie et un compte de
  contrepartie choisi ; aucune comptabilisation implicite.
- `postProposal` : applique les effets de bord (statut, date de cession, dépréciation) et
  comptabilise via le moteur existant.

Contrôles couverts par les tests : pas de dotation avant mise en service, pas de double dotation,
VNC cohérente, plafond respecté, période clôturée refusée (`PERIOD_CLOSED`), écritures équilibrées,
isolation entre sociétés, traçabilité des corrections, acquisition et sortie en cours d'exercice.

## 6. API et interface

Préfixe `/companies/:companyId/fixed-assets` :

- `GET|POST /categories`, `PATCH /categories/:id`
- `GET|POST /`, `GET|PATCH /:assetId`
- `POST /:assetId/activate|revise-estimate|suspend|resume`
- `GET /:assetId/schedule`, `POST /:assetId/proposals`
- `GET /depreciation/preview`, `GET|POST /depreciation/batches`, `GET /depreciation/batches/:id`,
  `POST .../approve|post`, `DELETE .../:batchId`
- `GET /proposals`, `GET /proposals/:id`, `POST .../approve|reject|post`
- `GET /reports/:report` avec `from`, `to`, `asOf`, `assetId`, `format=csv|pdf|json`, `lang`

Sept états : `register`, `schedule`, `accumulated`, `nbv`, `additions-disposals`,
`reconciliation`, `movement-schedule`. La réconciliation immobilisations / grand livre est
calculée par catégorie sur le triplet de comptes choisi (coût, amortissements cumulés,
dépréciation) et affiche l'écart, sans jamais le corriger automatiquement.

Rôles : lecture et propositions pour `owner|admin|accountant|manager|cabinet_admin` ;
approbation et comptabilisation réservées aux rôles de gestion, avec note et confirmation.

## 7. Démonstration fictive

Fichier `apps/web/src/demo/fixed-assets.ts`, schéma de démonstration **14**. Aucune requête
réseau, stockage `localStorage`, réinitialisation possible, identification du mode démonstration
conservée sans bandeau géant. Les données sont **fictives**.

### Société A — Lagon Bleu (plan comptable fictif)

| Actif | Coût | Méthode / durée | Dotation comptabilisée | Amort. cumulé | Dépréciation | VNC |
|---|---|---|---|---|---|---|
| Pick-up utilitaire | 480 000,00 | linéaire 60 mois, mise en service 01/07/2025 | 8 000,00 (juillet 2025) | 8 000,00 | — | 472 000,00 |
| Ordinateur | 36 000,00 | linéaire 36 mois, 01/07/2025 | 1 000,00 (juillet 2025) | 1 000,00 | 2 000,00 au 31/07/2025 | 33 000,00 |
| Machine cédée | 30 000,00 | linéaire 60 mois, cession 20/07/2025 | 500,00 | 500,00 | — | 0,00 (produit 26 500,00 ; moins-value 3 000,00) |
| Imprimante totalement amortie | 12 000,00 | linéaire 1 mois | 12 000,00 | 12 000,00 | — | 0,00 |
| Local en construction | 500 000,00 | non amortissable (`draft`) | — | — | — | 500 000,00 |
| Matériel déjà enregistré (fictif) | 120 000,00 | rattaché à une écriture existante, `draft` | — | — | — | 120 000,00 |

Résultat au 30/06/2026 : **VNC totale 1 125 000,00** ; réconciliation avec le grand livre
**équilibrée**, écart **0,0000**. Effet fictif sur le résultat : dotations 21 500,00 +
dépréciation 2 000,00 + moins-value 3 000,00 = **26 500,00**. Le chiffre est vérifiable à partir
des écritures de démonstration ; aucune donnée réelle n'est utilisée.

### Société B — seconde société fictive

| Actif | Coût | Méthode |
|---|---|---|
| Camionnette | 600 000,00 | linéaire 48 mois |
| Presse | 240 000,00 | dégressif 20 %, 60 mois |

Les comptes, journaux et catégories sont propres à chaque société : l'isolation est démontrée.

## 8. Instructions de vérification manuelle

1. Lancer `npm ci`, puis `npm run dev`.
2. Ouvrir la page **Comptabilité → Immobilisations**.
3. Vérifier le registre, les filtres et l'onglet **Catégories**.
4. Simuler une dotation : aucune écriture ne doit être créée avant approbation.
5. Approuver puis comptabiliser un lot : une seule écriture équilibrée doit apparaître.
6. Ouvrir les sept états, exporter le CSV et demander le PDF.
7. Rejouer le même lot : le doublon doit être refusé.
8. Clôturer une période puis tenter de comptabiliser : `PERIOD_CLOSED`.

La démonstration publiée reste sur GitHub Pages depuis la branche de développement, sans
déploiement OVH. **Aucun test navigateur réel n'a été exécuté dans cette mission** : les tests
sont des tests de simulation DOM / moteur, pas un parcours Chrome Windows ou Samsung Android.

## 9. Résultats de tests (exécutés)

| Commande | Résultat |
|---|---|
| `npm run typecheck` (API + web, tests inclus) | **0 erreur** |
| `npm run test -w @mc/api` | **442 réussis, 11 ignorés** (28 fichiers réussis, 1 ignoré) |
| dont `fixed-assets.test.ts` | **9/9** |
| dont `fixed-assets-depreciation.test.ts` | **8/8** |
| `npx vitest run` dans `apps/web` | **210/210** (26 fichiers) |
| dont `demo-fixed-assets.test.ts` | **4/4** |
| dont `demo-equity.test.ts` | **4/4** |
| dont `migration-ui.test.tsx` | **3/3** |
| `npm run build:demo` | **réussi** (3,57 s) |

Non exécutés / non vérifiés : `npm run lint`, tests E2E Playwright, rendu Chrome Windows réel,
Samsung Android physique, `FinanceAct2026.pdf` sections 7/18/28 (hors périmètre de cette
mission), validation par un expert-comptable mauricien.

## 10. Audit transversal

L'audit des dix opérations demandées (comptes courants, capital et prélèvements des associés,
comptes d'attente, emprunts, charges constatées, provisions, stocks, intercompagnies, parties
liées, écarts de change) est documenté dans
[`accounting-gaps-audit.md`](accounting-gaps-audit.md). Aucun de ces modules n'a été développé
pendant la mission 20 ; les manques sont ajoutés à la feuille de route.

## 11. Isolation, sécurité et données

- Chaque requête vérifie l'appartenance de la société et le rôle ; toutes les tables portent
  `company_id` et des clés étrangères composites.
- Les montants transitent en chaînes décimales (`"1000.0000"`), jamais en nombres flottants.
- Approbations et comptabilisations exigent `confirm: true` et une note suffisamment longue.
- Aucune clé API, aucun identifiant bancaire, aucun fichier `.env`, aucune donnée réelle.
- La démonstration ne contacte aucun serveur et ne prétend jamais enregistrer côté serveur.
- Un PDF de démonstration ouvre une impression navigateur, il n'est pas présenté comme un PDF
  généré côté serveur.

## 12. Questions pour l'expert-comptable (en anglais)

> Ces questions sont regroupées pour **une seule revue professionnelle**. Aucune réponse n'est
> supposée acquise et aucune règle n'a été codée en attendant.

### Depreciation policy

1. For each category (land and buildings, plant and machinery, motor vehicles, furniture and
   fixtures, computer equipment, office equipment, intangible assets), what useful lives and
   residual values should the application propose? Should the defaults stay **blank** until the
   client's policy is documented?
2. Do you approve the current monthly convention: a full active month = 1/12, a partial month =
   calendar days active, with the last month completed to the cent? Or do you require a
   full-month or mid-month convention?
3. For reducing balance, should the annual rate be applied to the opening net book value each
   month (1/12 of the annual rate when fully active), or do you use another convention?
4. Should low-value assets be pooled or expensed under a policy threshold? If so, what threshold
   and how should it be documented without hard-coding a tax rule?
5. Do you require component accounting (separate components with different lives) for buildings
   or plant? If yes, what level of granularity is practical?

### Tax versus accounting

6. The application currently computes **accounting depreciation only** and does not calculate
   capital allowances. Do you confirm that tax depreciation must remain a separate, manually
   supplied schedule, with no automatic tax rate or pool in the software?
7. Which information do you need in the tax-tracking fields (tax written-down value, allowance
   claimed, pool reference, period) to review a client's position without the software asserting
   a rate?

### Measurement and events

8. Under the cost model, do you accept that borrowing costs on assets under construction are
   **not** capitalised by default? If capitalisation is required, what evidence and period
   conventions should be used?
9. What impairment indicators do you expect the application to flag, and do you permit reversal
   of impairment? Should reversal be capped at the depreciated historical cost?
10. For a disposal, do you want the gain or loss presented net in one line, or gross proceeds and
    net book value in separate lines? Are there VAT or other tax points to capture?
11. Do you approve prospective treatment of changes in useful life or residual value, with the
    effect recognised over the remaining life and no restatement of prior periods?
12. How should a correction of a prior-period depreciation error be treated: prospective
    adjustment, or a separately identified correcting entry with disclosure?

### Reconciliation and chart of accounts

13. Do you confirm that each category should map to three **client-chosen** accounts: asset
    cost, accumulated depreciation, and impairment (with separate loss/reversal accounts), and
    that assets under construction should have no depreciation accounts?
14. What level of difference is acceptable on the fixed-asset / general-ledger reconciliation
    before a period may be closed? Should a non-zero difference block closing, or only warn?
15. Are the fictitious demo figures in section 7 arithmetically and presentationally acceptable
    for a training dataset? Please identify any figure or label that would mislead a Mauritian
    accountant.

### Entity types and missing modules

16. The `companies` table currently has **no legal-form field**. Which entity types must be
    supported first (limited company, sole trader, partnership), and which statements, capital
    accounts or disclosures differ between them?
17. For directors' and shareholders' current accounts, what should be tracked per person
    (advances, repayments, interest, limits, disclosure), and should debit balances be presented
    as receivables?
18. For partners, do you require a partner-level capital account and a drawings account separate
    from the company-level equity movements already implemented?
19. For suspense and clearing accounts, do you require a dedicated workflow, an ageing report and
    a blocking control before closing? Which balances would you refuse to close?
20. Which of the remaining gaps should be prioritised next: loans and borrowings, accruals and
    prepayments, provisions, inventory, intercompany transactions, or related-party disclosures?
    What minimum data would you need for each?
21. The system offers a "Company Incorporation & Corporate Services" future scope. Which
    registers and documents must be modelled first, and which official forms must **not** be
    reproduced without an archived official source?
22. The application stores an `accounting_standard` value defaulting to `IFRS` but makes no
    compliance claim. Which framework should be presented by default for Mauritian limited
    companies, sole traders and partnerships, and what wording should appear in reports?

## 13. Fichiers principaux

| Chemin | Contenu |
|---|---|
| `apps/api/sql/migrations/0018_fixed_assets.sql` | Schéma, contraintes, triggers |
| `apps/api/src/modules/fixed-assets/depreciation.ts` | Moteur exact |
| `apps/api/src/modules/fixed-assets/service.ts` | Registre, catégories, estimations, événements |
| `apps/api/src/modules/fixed-assets/accounting.ts` | Lots, propositions, contrôles |
| `apps/api/src/modules/fixed-assets/reports.ts` | Sept états, réconciliation |
| `apps/api/src/modules/fixed-assets/pdf.ts` | PDF des états |
| `apps/api/src/modules/fixed-assets/routes.ts` | API et permissions |
| `apps/api/src/lib/errors.ts` | Codes `FIXED_ASSET_*` / `DEPRECIATION_*` |
| `apps/api/src/i18n/index.ts` | Messages FR/EN API |
| `apps/web/src/pages/accounting/FixedAssets.tsx` | Écran quatre onglets |
| `apps/web/src/demo/fixed-assets.ts` | Données fictives et simulation |
| `apps/web/src/demo/runtime.ts` | Routage démonstration, schéma 14 |
| `apps/api/tests/fixed-assets.test.ts` | 9 tests d'intégration |
| `apps/api/tests/fixed-assets-depreciation.test.ts` | 8 tests de calcul |
| `apps/web/tests/demo-fixed-assets.test.ts` | 4 tests de démonstration |
| `docs/accounting-gaps-audit.md` | Audit transversal |
| `docs/company-incorporation-corporate-services.md` | Note de cadrage future |

## 14. Attente

La branche est poussée et une **PR en brouillon** est ouverte. Aucune fusion, aucune publication
de version, aucun déploiement OVH, aucune déclaration MRA ne sera effectué sans autorisation
explicite du propriétaire.
