# Mission 19 — Capitaux propres, clôture annuelle et affectation du résultat

_État au 31 octobre 2026. Branche `arena/4b8027f5-mauritius-compta`, PR ouverte en brouillon,
**aucune fusion**, aucun déploiement, aucune donnée réelle._

## 1. Résumé

Cette mission ajoute un registre des mouvements de capitaux propres, une clôture annuelle
contrôlée avec ouverture de l'exercice suivant, et une affectation du résultat strictement
documentée. Le moteur comptable existant est réutilisé sans modification de ses règles :
`prepareEntry`, `assertOpenPeriod`, `nextEntryNo`, `loadJournal`, `loadAccounts`, `insertLines`,
`computeTrialBalance`.

Aucun numéro de compte mauricien, aucun pourcentage de réserve légale, aucun traitement fiscal
ou IFRS n'est encodé. L'utilisateur choisit les comptes dans son propre plan comptable et
documente chaque décision.

## 2. Périmètre livré

| Élément | État |
|---|---|
| Registre des mouvements (capital, apport, réserve, résultat non distribué, dividende, ajustement) | Livré |
| Justificatif obligatoire et unique par société, historique et pièce jointe par référence | Livré |
| Cycle brouillon → approbation humaine → comptabilisation | Livré |
| Clôture annuelle : contrôles préalables, écriture de clôture, verrouillage de période | Livré |
| Ouverture de l'exercice suivant et report à nouveau via un compte de capitaux propres choisi | Livré |
| Affectation du résultat par décision documentée, total devant égaler exactement le résultat | Livré |
| État des capitaux propres (ouverture, mouvements, clôture) | Livré |
| Rapprochement avec la balance générale et contrôle d'équilibre | Livré |
| Interface FR/EN, Android et Windows (mise en page responsive existante) | Livré |
| Jeu fictif multi-exercices (perte, bénéfice, affectation, brouillon) | Livré |
| Tests API, démo et interface | Livré |
| Suppression/réouverture d'une clôture comptabilisée | **Non implémenté** (volontairement) |
| Règles légales de répartition, dividende obligatoire, impôt | **Non implémenté** (hors périmètre) |

## 3. Migration `0017_equity_closing.sql`

- `journal_entries.source` accepte désormais `equity`, `closing`, `equity_allocation`.
- `equity_sequences` : numérotation `EQ-AAAA-NNNN` par société et par année.
- `equity_movements` : catégorie, sens, montant > 0, compte de capitaux propres, contrepartie,
  journal, description, `document_ref` unique par société, statuts `DRAFT|APPROVED|POSTED|CANCELLED`,
  `entry_id` unique.
- `fiscal_closings` : version, période source, journal, compte de résultat (obligatoirement
  `equity`), dates de l'exercice suivant, résultat signé (bénéfice positif, perte négative),
  contrôles/blocages/avertissements/lignes en `jsonb`, empreinte de source, décision humaine,
  écriture de clôture, un seul `POSTED` par période source.
- `equity_allocations` / `equity_allocation_lines` : décision, dates, journal, note, montant
  affecté, une ligne par compte, statuts `DRAFT|APPROVED|POSTED|REJECTED`.
- Triggers : références inter-sociétés interdites, compte de capitaux propres imposé pour le
  compte de résultat, immutabilité après `POSTED`, lignes d'affectation verrouillées.

## 4. Contrôles de clôture

Chaque contrôle renvoie un code stable, une gravité (`ok`, `warning`, `block`) et un libellé
FR/EN. Une clôture `BLOCKED` ne peut pas être approuvée.

| Code | Gravité | Vérification |
|---|---|---|
| `SOURCE_PERIOD_OPEN` / `SOURCE_PERIOD_CLOSED` | ok / block | La période source doit être ouverte |
| `RESULT_ACCOUNT_EQUITY` / `RESULT_ACCOUNT_NOT_EQUITY` | ok / block | Compte de résultat de type capitaux propres |
| `RESULT_ACCOUNT_INACTIVE`, `JOURNAL_INACTIVE` | block | Comptes et journal actifs |
| `NEXT_PERIOD_DATES_INVALID` | block | Dates de l'exercice suivant cohérentes |
| `DRAFT_ENTRIES_PRESENT` | block | Aucun brouillon dans la période |
| `UNBALANCED_POSTED_ENTRIES` | block | Écritures comptabilisées équilibrées |
| `NO_PROFIT_AND_LOSS_ACTIVITY` | block | Au moins un mouvement de produit/charge |
| `ACCOUNT_INACTIVE` | block | Aucune ligne sur un compte inactif |
| `TOO_MANY_CLOSING_LINES` | block | Limite de 198 comptes de résultat |
| `CLOSING_ENTRY_BALANCED` / `CLOSING_ENTRY_UNBALANCED` | ok / block | Équilibre exact, aucun ajustement créé |
| `NEXT_PERIOD_EXISTS` / `NEXT_PERIOD_WILL_BE_CREATED` / `NEXT_PERIOD_OVERLAP` | ok / ok / block | Exercice suivant |
| `RESULT_ZERO` | warning | Aucune ligne de résultat ajoutée |
| `CLOSING_STALE` (erreur API) | conflit | L'empreinte de la source a changé |
| `CLOSING_ALREADY_POSTED` (erreur API) | conflit | Clôture verrouillée |

L'empreinte SHA-256 couvre la période, le journal, le compte de résultat, les dates, le
résultat exact et les soldes de produits/charges. Une modification comptable entre la
préparation et l'approbation ou la comptabilisation renvoie `CLOSING_STALE` : il faut
re-préparer, aucune règle n'est modifiée rétroactivement.

## 5. Affectation du résultat

- Réservée à une clôture `POSTED` avec résultat non nul.
- Somme des lignes strictement égale à la valeur absolue du résultat (arithmétique entière
  `numeric(20,4)`, aucun arrondi).
- Un compte ne peut apparaître qu'une fois.
- Note et référence de décision obligatoires.
- Écriture : résultat positif → débit du compte de résultat et crédit des destinations ;
  résultat négatif → crédit du compte de résultat et débit des destinations.
- Un seul enregistrement d'affectation par clôture, verrouillé après comptabilisation.

## 6. État des capitaux propres et rapprochement

L'état présente, par compte de capitaux propres : ouverture, augmentations, diminutions,
clôture. Le rapprochement compare :

```
actif − passif exigible − comptes de capitaux propres − résultat non affecté = 0
```

Il vérifie aussi que la clôture de chaque compte est identique à la balance générale
(`trialBalanceClosing`) et que la balance est équilibrée. Le « résultat non affecté » est calculé
depuis la dernière clôture comptabilisée et exclut les écritures `source = 'closing'`.

## 7. API

| Méthode | Route | Rôle minimum |
|---|---|---|
| GET | `/companies/:id/equity/overview` | viewer |
| GET | `/companies/:id/equity/statement` | viewer |
| GET/POST | `/companies/:id/equity/movements` | viewer / accountant |
| GET/PATCH/DELETE | `/companies/:id/equity/movements/:id` | viewer / accountant |
| POST | `/companies/:id/equity/movements/:id/approve` | manager |
| POST | `/companies/:id/equity/movements/:id/post` | manager |
| GET/POST | `/companies/:id/equity/closings` | viewer / accountant |
| GET | `/companies/:id/equity/closings/:id` | viewer |
| POST | `.../closings/:id/approve` et `/reject` | manager |
| POST | `.../closings/:id/post` | manager |
| GET/PUT | `.../closings/:id/allocation` | viewer / accountant |
| POST | `.../closings/:id/allocation/approve` et `/post` | manager |

Les approbations et comptabilisations exigent une note d'au moins 10 caractères et une
confirmation explicite. Le dossier archivé reste en lecture seule.

## 8. Interface

Nouvel écran **Comptabilité → Capitaux propres & clôture** (`/accounting/equity`), quatre
onglets :

1. **État des capitaux propres** : tableau ouverture/augmentations/diminutions/clôture, totaux,
   rapprochement, badges de conformité.
2. **Registre des mouvements** : formulaire justifié, historique, approbation, comptabilisation.
3. **Clôture annuelle** : sélection de période, contrôles, lignes proposées, approbation,
   comptabilisation, historique des versions.
4. **Affectation du résultat** : décision, lignes dynamiques, total exact, approbation,
   comptabilisation, affectation enregistrée.

Les écrans réutilisent les composants existants (`Card`, `Field`, `Badge`, `Modal`, `ErrorBanner`),
restent dans la grille responsive et n'ajoutent aucun débordement horizontal. L'approbation se
fait dans une fenêtre modale : la cause racine du correctif Android (focus du clavier) n'est pas
touchée.

## 9. Démonstration fictive

- Deux exercices clôturés : **2023/2024** en perte (15 000) puis **2024/2025** en bénéfice
  (30 000), avec écritures de clôture et affectation documentée (10 000 en réserve, 20 000 en
  report à nouveau).
- Apport en capital comptabilisé (150 000, justificatif `PV-2023-001`).
- Ajustement en brouillon à approuver (`PROJET-AJUST-2025-01`).
- L'exercice courant 2025/2026 contient un brouillon : la préparation de clôture affiche donc
  `DRAFT_ENTRIES_PRESENT` et aucun bouton de comptabilisation n'est proposé.
- Toutes les références (`PV-…`, `CLOSE-…`, `EQ-…`) et tous les montants sont inventés.

L'état de démonstration passe au schéma 13 ; un état plus ancien est régénéré automatiquement
(données fictives locales uniquement, aucun envoi réseau).

## 10. Tests exécutés

| Commande | Résultat |
|---|---|
| `npx vitest run tests/migrations.test.ts` (API) | 6/6 ✅ |
| `npx vitest run tests/equity.test.ts` (API) | 7/7 ✅ |
| `npx vitest run` (API) | **425 ✅, 11 ignorés** |
| `npx tsc --noEmit` (API) | ✅ |
| `npx vitest run tests/demo-equity.test.ts` (web) | 4/4 ✅ |
| `npx vitest run tests/equity-ui.test.tsx` (web) | 4/4 ✅ |
| `npx vitest run` (web) | **206 ✅** |
| `npx tsc --noEmit` (web) | ✅ |
| `npx vite build` | ✅ (avertissement de taille de bundle préexistant) |

Les tests API couvrent : équilibre débit/crédit, doublon de justificatif, isolation entre
sociétés, brouillon bloquant, empreinte de clôture périmée, verrouillage de période après
clôture, double comptabilisation refusée, affectation exacte, rapprochement avec la balance et
conservation de l'historique.

## 11. Limites assumées et points non implémentés

- **Aucune réouverture d'une clôture comptabilisée** : l'historique reste immuable. Une
  correction doit passer par une écriture explicite dans un exercice ouvert.
- **Aucun modèle légal de répartition** (réserve légale, dividende, impôt) : la décision est
  humaine et documentée ; les taux et obligations ne sont pas inventés.
- **Aucun PDF dédié** pour l'état des capitaux propres : l'écran est consultable et les états
  financiers existants restent la référence exportable. Une impression navigateur reste
  possible, sans être présentée comme un état officiel.
- **Aucune connexion bancaire**, aucun paiement de dividende, aucune déclaration MRA.
- **Pas de test sur Samsung Android physique** ni de rendu Chrome Windows dans cet
  environnement : la mise en page responsive est vérifiée par les tests jsdom et les styles
  existants, pas par un appareil réel.
- Le job `postgres-tests` n'a pas été exécuté localement ; la migration est testée sur PGlite.
- Les exercices de démonstration antérieurs à 2025 sont ajoutés au jeu fictif : ils ne
  représentent aucune société réelle.

## 12. Points à faire valider par l'expert-comptable mauricien (revue unique)

1. **Compte de résultat** : confirmer le ou les comptes de capitaux propres à utiliser pour
   solder le résultat et pour le report à nouveau.
2. **Clôture** : valider le principe d'une écriture unique de clôture (soldes de produits et
   charges) et l'ouverture de l'exercice suivant sans écriture d'à-nouveaux distincte.
3. **Affectation** : confirmer les destinations autorisées (report à nouveau, réserves,
   dividendes) et les documents requis (procès-verbal, date de décision).
4. **Dividendes** : préciser les obligations déclaratives et retenues éventuelles ; elles ne
   sont **pas** implémentées.
5. **Verrouillage** : valider qu'aucune réouverture n'est autorisée et que les corrections
   passent par des écritures explicites.
6. **Rapprochement** : confirmer la formule `actif − passif − capitaux propres − résultat = 0`
   et le traitement du résultat non affecté entre deux clôtures.
7. **États** : indiquer si un état des capitaux propres doit être produit en PDF signé et selon
   quel modèle (hors périmètre actuel).
8. **Comptes de démonstration** : rappeler que le plan comptable livré est fictif et ne
   constitue pas un plan officiel mauricien.

## 13. Sécurité et conformité

- Toutes les écritures passent par le moteur existant, avec contrôle d'équilibre et période
  ouverte.
- Les triggers interdisent les références inter-sociétés et toute modification après
  comptabilisation.
- Les opérations irréversibles exigent le rôle `manager`, une note et une confirmation.
- Aucun secret, aucune donnée réelle, aucun appel réseau dans la démonstration.
- Aucune règle mauricienne, aucun taux, aucun numéro de compte officiel n'est affirmé.
