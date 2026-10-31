# Rapport de mission Nº6 — Facturation exploitable + Assistant comptable V2

**Date** : 31 octobre 2026
**Branche** : `arena/b0b62798-mauritius-compta`
**Pull request** : [#1](https://github.com/azharshahim/mauritius-compta/pull/1) — **brouillon, non fusionnée** ; `main` reste à `9e46f16`
**Commits de la mission** : `b025a3f` (chaîne de facturation + assistant V2 côté API), `ec14aef` (écrans web + démo), commit de documentation à la suite
**Ordre respecté** : facturation et contrôles comptables d'abord, assistant V2 ensuite.

Aucun code d'une autre application n'a été consulté ou copié. Aucune clé, aucun fournisseur IA
réel, aucun service payant, aucun déploiement OVH. Toutes les données sont fictives.

---

## 1. Branche et état du dépôt

- Dépôt unique : `azharshahim/mauritius-compta`. Branche de travail dédiée, poussée sur GitHub.
- `main` n'a pas été modifiée. La PR nº1 reste **brouillon** ; aucune fusion sans autorisation.
- Le monorepo et les fonctionnalités des missions 1 à 5 sont conservés (aucune réécriture).

## 2. Pull request

PR nº1 (brouillon) : <https://github.com/azharshahim/mauritius-compta/pull/1>. Elle regroupe
l'ensemble des missions ; aucun merge, aucun tag, aucune release.

## 3. Migrations

- `0001` → `0005` **préservées telles quelles** ; aucune migration destructive.
- **`0006_billing.sql`** (additive) : clients, articles, taux de TVA datés (aucun taux seedé),
  paramètres de facturation, documents et lignes, séquences de numérotation
  (`UNIQUE (company_id, kind, year)`), événements de document, encaissements
  (`accounting_entry_id UNIQUE`), affectations, propositions d'écriture et lignes, règles
  apprises (`ai_rules`, unicité par clé active, `account_side`), index anti-doublon.
- §13 : la contrainte `journal_entries.source` accepte `billing` et `ai`, plus un index
  unique partiel `journal_entries_billing_reference_uniq` (une référence de facture ne peut
  produire qu'une seule écriture).
- Migrations rejouables (test d'idempotence) et vérifiées sur PGlite comme sur PostgreSQL 16
  par la CI.

## 4. Fonctions de facturation réellement opérationnelles

| Domaine | Ce qui fonctionne réellement |
|---|---|
| Clients | CRUD, archivage (aucune suppression), BRN/TVA/adresse/contacts/devise/conditions/compte collectif, historique et solde, doublons évidents bloqués (`CUSTOMER_DUPLICATE`), homonymes autorisés après confirmation explicite |
| Articles | Référence unique par société, désignations FR/EN, prix, unité, devise, catégorie, actif, traitement de TVA, compte de produits |
| Devis | Lignes, remises, totaux, statuts, conversion en facture **tracée** (`source_document_id`), conversion unique (`QUOTE_ALREADY_CONVERTED`) |
| Factures | Depuis un devis ou directes, **numérotation séquentielle atomique** (séquence par année, `SELECT … FOR UPDATE`), brouillon modifiable, **verrouillage à l'émission** (`DOCUMENT_LOCKED`), multidevise avec taux documenté |
| Avoirs | Facture d'origine obligatoire, partiels, contrôle du restant créditable et des quantités (`CREDIT_EXCEEDS_INVOICE`), jamais de suppression physique, proposition de contrepassation comptable |
| Encaissements | Totaux/partiels, multi-factures, trop-perçus non affectés, modes, date de valeur, référence, devise + taux, solde dû, **aucune double affectation** (`ALLOCATION_INVALID`), dépassement refusé (`ALLOCATION_EXCEEDS_INVOICE`) |
| Créances | Solde client, balance âgée (`current`, 1–30, 31–60, 61–90, 90+), factures en retard |
| PDF | Génération serveur `pdfkit` A4 FR/EN : devis, factures, avoirs, reçus (`/pdf`, `/receipt.pdf`) |
| Audit | Événements de document et journal d'audit (création, émission, conversion, avoir, encaissement, annulation, comptabilisation) |

Montants : `numeric(20,4)` en base et arithmétique **BigInt** (échelle 4) côté API et côté démo,
jamais de flottant JS.

## 5. Fonctions simulées ou volontairement absentes

- **E-Invoicing MRA : désactivé.** Aucune route, aucun envoi, aucune conformité annoncée ;
  l'écran correspondant reste explicitement « préparé ».
- **Aucun taux de TVA mauricien n'est seedé.** Un taux doit être créé, daté et marqué
  `verified` par un professionnel ; sinon l'émission échoue (`VAT_NOT_CONFIGURED`,
  `VAT_RATE_NOT_VERIFIED`, `VAT_RATE_NOT_APPLICABLE`).
- **PDF en mode démonstration navigateur : non simulé.** Le backend produit le PDF ; la démo
  renvoie une erreur explicite `PDF_NOT_AVAILABLE_IN_DEMO` et l'interface l'affiche. Aucun PDF
  factice n'est présenté comme réel.
- Fournisseur IA réel : **jamais activé**. Seul l'adaptateur `simulated` (déterministe, sans clé)
  répond, dans la démo comme en local.
- Paie & RH : inchangée, toujours « préparée ».

## 6. Assistant comptable V2

- Contrat JSON complet et validé par le backend : journal, date, libellé, référence, devise,
  taux, lignes débit/crédit, justification, éléments manquants, avertissements, confiance,
  fournisseur/modèle.
- **9 scénarios** couverts par l'adaptateur déterministe et les propositions issues de la
  facturation : facture fournisseur, facture client, encaissement, paiement fournisseur, frais
  bancaires, matériel, avoir, TVA configurée, multidevise.
- Comptes **uniquement** issus du plan comptable réel de la société (`AI_ACCOUNT_NOT_IN_CHART`).
- Cycle strict : **Proposition → Vérification → Validation humaine → Comptabilisation**.
  `validate` ne crée jamais d'écriture (`entryCreated: false`), `post` est une action distincte
  et vérifie le statut (`AI_PROPOSAL_NOT_VALIDATED`).
- Écran web : proposition éditable (journal, date, référence, lignes), indicateur d'équilibre,
  liste des 12 contrôles avec sévérité, boutons Enregistrer / Valider / Rejeter / Comptabiliser.
- Les 12 contrôles : équilibre ; comptes existants et actifs ; journal existant/autorité ;
  exercice ouvert ; date autorisée ; devise et taux ; TVA vérifiée/applicable ; droits ;
  absence de doublon ; bonne société ; document source rattaché ; protection contre la
  double comptabilisation.

## 7. Exemple complet d'écriture (données fictives)

Facture client `FAC-DEMO-0002` — 2 × 2 500 MUR, prestation fictive (taux zéro) :

| Compte | Libellé | Débit | Crédit |
|---|---|---|---|
| 1100 — Clients | Créance client | 5 000,0000 | |
| 4000 — Ventes de services | Chiffre d'affaires | | 5 000,0000 |

Journal `SAL`, référence `FAC-DEMO-0002`, proposition `provider: deterministic`, équilibre
vérifié, puis validation humaine et comptabilisation distincte. L'écriture porte
`source = 'billing'` et la référence de la facture, unique en base.

## 8. Règles apprises

- Six types : `counterparty`, `bank_label`, `expense_category`, `billing_item`,
  `payment_method`, `journal`.
- Déterministes, sans entraînement de modèle : correspondance de clé normalisée, priorité,
  version, règle précédente conservée et désactivée, `is_active`, auteur/date, compteur d'usage.
- **Une règle ambiguë n'est jamais appliquée en silence** : en cas de conflit de priorité ou de
  comptes divergents, la proposition retombe sur le moteur déterministe et la trace explique
  le conflit.
- Isolation stricte par société et cabinet : aucune donnée d'un dossier n'alimente un autre.
- Écran : liste (y compris inactives), désactivation, création d'une nouvelle version,
  historique, explication affichée avec la proposition (`ruleTrace`, `ruleApplied`).

## 9. Intégration Facturation → Comptabilité

- `POST /ai/entry-proposals/from-billing` construit une proposition **déterministe** à partir des
  lignes réelles de la facture ou de l'encaissement (créance, produits par compte, TVA si
  configurée, banque, trop-perçu).
- La comptabilisation passe par le **moteur comptable** (`postEntryTx` /
  `prepareEntry` / `assertOpenPeriod` / `nextEntryNo`) : l'IA ne contourne jamais
  l'équilibre, les comptes, la période ni la numérotation.
- Traçabilité bidirectionnelle : `billing_documents.accounting_entry_id`,
  `billing_payments.accounting_entry_id`, `ai_entry_proposals.entry_id`, `journal_entries.source`
  et `reference`.
- Émission ≠ comptabilisation ; encaissement ≠ affectation : chaque étape est une action
  distincte et journalisée.

## 10. Protection contre la double comptabilisation

1. `ai_entry_proposals` : une seule proposition non rejetée par source (`source_kind`, `source_id`).
2. `billing_documents.accounting_entry_id` / `billing_payments.accounting_entry_id` uniques.
3. `journal_entries_billing_reference_uniq` : une référence de facture ne peut produire qu'une
   écriture.
4. Verrous `SELECT … FOR UPDATE` sur la proposition et sur le document source pendant `post`.
5. Statuts explicites : `post` avant validation → `409 AI_PROPOSAL_NOT_VALIDATED` ; second
   `post` → `409 ACCOUNTING_ALREADY_POSTED` ; document en brouillon → `409 DOCUMENT_NOT_ISSUED`.
6. Reprise sur erreur : transaction unique (proposition + écriture + liens) ; en cas d'échec,
   rien n'est écrit.

Tests : double comptabilisation, idempotence et concurrence couverts par
`tests/ai-proposals.test.ts` (16 cas) et `tests/billing.test.ts` (17 cas).

## 11. Tests — résultats exacts

Exécution locale (PGlite), 31 octobre 2026 :

| Suite | Fichiers | Résultat |
|---|---|---|
| API (`npm run test -w @mc/api`) | 13 fichiers, 143 cas | **139 réussis / 4 ignorés** |
| Web (`npm run test -w @mc/web`) | 5 fichiers, 60 cas | **60 réussis** |
| Typecheck (`npm run typecheck`) | API + web + tests | **0 erreur** |
| Build démo (`npm run build:demo`) | bundle | **succès** (642 kB JS, 16 kB CSS) |

Détail API : money 9, migrations 6, auth 9, companies 6, accounts 4, entries 12, reports 10,
regressions 17, cabinet 11, **billing 17**, **ai 22**, **ai-proposals 16**,
concurrency 4 ignorés (PostgreSQL réel uniquement).

Détail web : format 4, demo-engine 22, demo-app 11, **demo-billing 13**, input-focus 10.

Les 4 tests de concurrence sont **ignorés** sur PGlite et exécutés uniquement par la tâche CI
« API tests against real PostgreSQL ».

## 12. Statut des GitHub Actions

- CI (push, code) : run `41156378284` — **succès**.
- CI (PR) : run `41156382220` — **succès**.
- Demo (GitHub Pages, code) : run `41156378229` — **succès** (build + deploy).
- CI (push, documentation) : run `41156618638` — **succès**.
- CI (PR, documentation) : run `41156622518` — **succès**.
- Demo (GitHub Pages, documentation + smoke test renforcé) : run `41156618683` — **succès**.

## 13. Déploiement Pages

- Démo publiée depuis la branche de développement : <https://azharshahim.github.io/mauritius-compta/>
- Contenu : les quatre modules, la facturation réelle de démonstration (clients, devis,
  factures, avoir, encaissement, balance âgée) et l'assistant V2 (proposition, contrôles,
  validation, comptabilisation visible en comptabilité démo).
- Mode démo : `localStorage` uniquement (schéma 4), bandeau permanent, réinitialisation
  possible, **aucune clé, aucun appel externe, aucun PDF simulé**.
- Vérifications effectuées : workflow vert, build reproductible, tests jsdom de la démo.
- **Limite honnête** : aucun navigateur réel (Chrome/Android) n'est disponible dans cet
  environnement ; les parcours sont vérifiés par tests jsdom, pas par une session Chrome
  manuelle. Voir `docs/browser-tests.md`.

## 14. Limites fiscales — à vérifier avant tout usage réel

- Aucun taux de TVA/GST mauricien n'est fourni ; la TVA dépend d'un taux vérifié par un
  professionnel, daté et applicable.
- Qualification `zero_rated` / `exempt` / `out_of_scope` : fournie par l'utilisateur, à confirmer
  (`À VÉRIFIER`), jamais déduite.
- Aucune conformité MRA annoncée ; **E-Invoicing MRA désactivé** ; aucun format de facture
  légale certifié.
- Pas de calcul PAYE/CSG/NSF ; la paie reste préparée.
- Le PDF est un document de gestion, **pas** un document fiscal certifié.

## 15. Anomalies et dettes connues

1. PDF uniquement serveur : la démo renvoie 501 et l'indique (« aucun PDF simulé »).
2. Bundle démo passé de 506 kB à 642 kB (facturation + assistant) ; un découpage de code serait
   utile (non bloquant).
3. Les tests de concurrence restent dépendants de PostgreSQL réel (ignorés sur PGlite).
4. Paramétrage TVA non exposé dans l'interface (API prête) : à ajouter en mission 7.
5. Édition d'un brouillon de facture possible mais volontairement simple (pas d'éditeur de
   remises avancé).
6. Aucun test manuel Chrome/Android pour cette mission ; la non-régression clavier est couverte
   par les 10 tests jsdom existants, inchangés et verts.

## 16. Recommandations pour la mission nº7

1. Écran de configuration des taux de TVA (création, vérification, dates) avec piste d'audit.
2. Paramétrage de la facturation (préfixes, politique de numérotation, mentions légales) côté UI.
3. Découpage du bundle démo (imports dynamiques) et mesure de performance mobile.
4. Tests de bout en bout Playwright sur la démo publiée, y compris clavier Android réel.
5. Import de relevés bancaires → propositions (moteur déterministe déjà en place).
6. Contrepassation guidée d'un encaissement déjà comptabilisé.
7. Export comptable (CSV/JSON) des écritures issues de la facturation.
