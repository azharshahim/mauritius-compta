# Rapport final — Mission 13 : multidevises, taux de change et écarts de change

Branche `arena/b0b62798-mauritius-compta` — PR nº1 **brouillon, non fusionnée**.
Aucune donnée réelle, aucun taux officiel, aucun fournisseur externe, aucune
dépense, aucun déploiement OVH.

## 1. Audit du mécanisme existant

Le grand livre n’a pas été réécrit. L’audit a relevé : `companies.functional_currency`
et `presentation_currency`, `accounts.currency`, `journal_entries.currency` +
`exchange_rate`, `journal_lines.txn_currency`/`txn_amount`/`fx_rate`, une table
`exchange_rates`, les taux sur factures et règlements clients/fournisseurs, et
`bank_accounts.currency`. La conversion existait au niveau de l’écriture, avec le
même taux sur chaque ligne et des garde-fous (`EXCHANGE_RATE_REQUIRED`,
`CURRENCY_MISMATCH`, `resolveExchangeRate`, `BANK_EXCHANGE_RATE_REQUIRED`).

Conclusion : ajouter un registre de taux validés et des propositions d’écarts,
sans dupliquer le moteur comptable ni le moteur de lettrage.

## 2. Migration additive 0013

`0013_multi_currency.sql` crée `company_currencies`, `fx_settings`, `fx_rates`,
`fx_rate_events`, `fx_realized_adjustments`, `fx_revaluations` +
`fx_revaluation_lines`, `fx_transfers`, et étend `journal_entries_source_check`
avec `'fx'`.

Points structurels :

* `rate_policy` figé à `validated_only` ;
* `valuation_posting` contraint à `false` ;
* trigger `mc_guard_fx_settings_accounts` : le compte de gain doit être un produit
  actif, le compte de perte une charge active, sinon `FX_ACCOUNT_INVALID` ;
* un seul taux `validated` par paire et par date ; versions et `supersedes_id` ;
* trigger `mc_guard_fx_rate_immutable` : un taux validé n’est plus modifiable ;
* trigger `mc_guard_functional_currency` : changement interdit après
  comptabilisation (`FUNCTIONAL_CURRENCY_LOCKED`) ;
* un ajustement réalisé unique par facture + règlement, une écriture unique par
  ajustement.

Migration appliquée sur PGlite (6/6 tests de migration), sur PostgreSQL réel en
CI (application + ré-application idempotente + seed fictif) et par la suite API
complète exécutée sur PostgreSQL réel (job `API tests against real PostgreSQL`).

## 3. Taux de change

Trois origines distinctes : `manual`, `imported` (référence obligatoire),
`demo` (fictif de démonstration). Aucun fournisseur externe, aucun taux inventé,
aucun fallback vers le dernier taux. Un taux nul, négatif, absent ou mal formé est
refusé (`FX_RATE_INVALID`). Un taux est créé en brouillon et n’est utilisable
qu’après `validate` avec `confirm: true`. Remplacer un taux validé exige
`supersede: true`. Un taux rejeté reste inutilisable.

La résolution n’accepte que la paire exacte et la date exacte ; l’inverse n’est
calculé que comme réciproque exacte explicite. Messages : `FX_RATE_MISSING`,
`FX_RATE_NOT_VALIDATED`, `FX_RATE_DIRECTION_MISMATCH`.

## 4. Factures multidevises

La facture conserve devise et montant d’origine, taux, date et référence. La
contre-valeur fonctionnelle est calculée une fois, en décimaux exacts. Une facture
comptabilisée n’est jamais modifiée par un taux ultérieur ; un nouveau taux crée
une nouvelle version.

## 5. Règlements

Les écrans distinguent montant facture, montant payé, valeur comptable, taux, date,
référence bancaire, solde commercial en devise et solde comptable en devise
fonctionnelle. Un règlement partiel ne produit d’écart que sur la part réglée.

## 6. Écarts réalisés

Exemple fictif : facture de 1 000 EUR comptabilisée à 50 (50 000 MUR), réglée à
51 (51 000 MUR) ⇒ gain de 1 000 MUR.

`scanRealizedAdjustments` calcule `S × r_invoice`, `S × r_settle`, la différence et
le sens selon le côté (client ou fournisseur). La proposition est affichée avec son
calcul, ses comptes et une justification. La comptabilisation exige :

1. les deux comptes de change explicitement configurés, sinon
   `FX_ACCOUNTS_NOT_CONFIGURED` ;
2. `confirm: true` ;
3. une période ouverte (`PERIOD_CLOSED` sinon) ;
4. l’idempotence (`reused: true` en cas de rejeu).

Aucun compte de gain n’est prévu par le plan comptable de démonstration : c’est un
choix explicite du dossier, jamais une invention du logiciel.

## 7. Écarts latents

Simulation à une date d’évaluation avec les taux validés de cette date. Les lignes
sans taux sont marquées `blocked_reason`, jamais valorisées à 1. Une même date
réutilise la simulation existante (pas de double évaluation). Une simulation avec
lignes bloquées ne peut être validée (`FX_VALUATION_RATE_MISSING`). La
comptabilisation et la reprise restent bloquées (`FX_VALUATION_POSTING_BLOCKED`) et
`valuation_posting` est `false` en base. Aucune règle mauricienne de réévaluation
n’est affirmée.

## 8. Banque multidevise

Comptes multi-devises déjà supportés par `bank_accounts.currency`. Le virement
inter-devises est un aperçu : comptes distincts, taux explicite, `to_amount` exact,
frais `fee_amount`/`fee_currency` dans un champ séparé, idempotence par
enregistrement, `postingBlocked: true`. Un virement interne ne crée ni produit ni
charge ; un écart de change n’est jamais transformé en frais.

## 9. Lettrage multidevise

Le moteur du module 12 est réutilisé. `validateAllocations` compare les devises
d’origine et ajoute un blocage `LETTERING_CURRENCY_MISMATCH` : aucun taux n’est
inventé pour lettrer deux devises. Solde commercial et solde comptable restent
distincts. Aucun moteur de lettrage n’a été recréé.

## 10. Précision

Montants en `numeric(20,4)`, taux en `numeric(20,8)`, calculs en BigInt
(`multiply`, `formatAmount`). Un seul arrondi comptable, demi-hors-zéro, à quatre
décimales ; l’affichage à deux décimales ne modifie jamais le stockage. Les valeurs
d’origine (devise, montant, taux, date) sont conservées.

## 11. Rapports et CSV

Soldes par devise, créances et dettes en devise avec contre-valeur, soldes
bancaires, gains/pertes réalisés, dernière évaluation latente avec lignes bloquées,
historique des taux (écran) et opérations bloquées. Aucune addition entre devises :
le rapport et le CSV portent explicitement « Aucun total inter-devises ». CSV en
`;` avec BOM UTF-8 et neutralisation des formules (`=`, `+`, `-`, `@`).

## 12. Assistant IA en lecture seule

Quatre outils ajoutés : `fx.rates`, `fx.convert`, `fx.unrated`, `fx.realized`,
tous `readOnly: true`. L’assistant peut expliquer une conversion avec le taux
validé de la date, lister les taux, trouver des factures sans taux et décrire les
écarts réalisés. Il ne peut ni inventer un taux ou un compte, ni choisir un taux non
validé, ni modifier un taux validé, ni comptabiliser automatiquement.

## 13. Corrections ergonomiques Samsung

* **Cases de sélection** : la règle globale `input, select, textarea` imposait
  `width:100%` et `min-height:38px`. Une règle dédiée rétablit 18 × 18 px, ajoute
  une zone tactile de 44 px via `.lettering-check` et conserve un anneau de focus
  clavier visible (`:focus-visible`, outline 3 px). Aucun indicateur de focus n’a
  été supprimé.
* **Montants** : `amountInputValue('50000.0000')` affiche `50 000,00` en FR et
  `50,000.00` en EN. `normalizeDecimalInput` accepte le point **et** la virgule,
  y compris `50 000,12`, sans perdre la précision saisie (0,0001 reste 0,0001).
* **Assistant flottant** : marge basse de page sur mobile
  (`84px + safe-area-inset-bottom`) pour ne plus masquer boutons et champs ; les
  safe-areas de la pastille et du panneau sont conservées.
* Un défaut latent de formatage a été corrigé au passage : `formatScaled`
  appliquait une double division pour les décimales non nulles (par exemple
  `1234,5678` s’affichait de façon erronée) ; il divise désormais par `10^digits`.
  Un test de non-régression couvre `1 234,57` / `1,234.57`.
* Aucun test sur un Samsung Android physique n’a été possible. Les vérifications
  sont des tests jsdom, des tests de formatage et une inspection de la feuille de
  style ; aucun débordement horizontal n’a été observé en jsdom, ce qui ne remplace
  pas un test matériel.

## 14. Interface FR/EN

Rubrique **Multidevises** ajoutée à la navigation Comptabilité, avec six onglets :
Configuration, Taux & conversion, Écarts réalisés, Évaluations latentes, Virements,
Rapports. Cartes mobile et tableaux desktop, libellés FR/EN, avertissement
permanent sur les taux non officiels, mode Démo discret (bandeau d’information, pas
de grand bandeau DEMO). La configuration permet de choisir les comptes de change et
les devises autorisées ; le verrou fonctionnel est expliqué comme irréversible.

## 15. Démonstration fictive A→J

`apps/web/src/demo/fx.ts`, localStorage schéma **11**, tous les taux marqués
`demo` et fictifs :

| Scénario | Démonstration |
| --- | --- |
| A | Facture EUR convertie à un taux fictif validé (50) |
| B | Facture USD réglée à un taux fictif différent |
| C | Fournisseur EUR : perte proposée |
| D | Client EUR : gain de 1 000 MUR proposé |
| E | Règlement partiel : écart calculé sur la part réglée |
| F | Date sans taux : résolution bloquée `FX_RATE_MISSING` |
| G | Taux importé en brouillon : bloqué `FX_RATE_NOT_VALIDATED` |
| H | Lettrage EUR/USD : blocage `LETTERING_CURRENCY_MISMATCH` |
| I | Évaluation de clôture simulée, sans double évaluation, comptabilisation bloquée |
| J | Virement EUR→MUR simulé, frais distincts, comptabilisation bloquée |

Aucune opération de démonstration n’est présentée comme enregistrée sur un serveur.

## 16. Tests et vérifications

* API mission 13 : **35/35** (`apps/api/tests/fx.test.ts`) — taux (création,
  validation, refus, absence, inversion), EUR/USD/GBP→MUR, factures, règlements
  complets et partiels, gains/pertes clients et fournisseurs, comptabilisation
  unique, idempotence, concurrence, rollback, isolation société/cabinet,
  permissions, période clôturée, précision, CSV, lettrage incompatible, outils IA.
* Migration : **6/6** sur PGlite.
* Web : **167/167** sur 19 fichiers (dont 8 tests de démonstration multidevises,
  3 tests d’interface et les tests de formatage Android).
* API complète : **326 passés / 11 ignorés** (concurrence PostgreSQL réelle
  ignorée sans base locale).
* Typecheck API (application + tests), typecheck web (application + tests),
  `npm run build`, `npm run build:demo` et build API : verts localement.
* CI GitHub verte sur PostgreSQL réel : migrations (application + idempotence +
  seed), suite API complète et typecheck/build. Runs `41208339676` et
  `41208333178`, commit `bd118cc`.
* **Non vérifiés** : PostgreSQL réel en CI pour `0013` (la CI le fera), Chrome
  réel, Samsung Android physique, lecteur d’écran sur appareil.

## Limites et éléments non implémentés

* Changement de devise fonctionnelle après comptabilisation : interdit, procédure
  future non implémentée.
* Comptabilisation des réévaluations latentes et des virements inter-devises :
  bloquée volontairement.
* Aucune règle fiscale mauricienne, aucun taux officiel, aucune connexion bancaire
  ou fournisseur de taux.
* Les questions ouvertes pour l’expert-comptable sont dans
  `docs/fx-validation-register.md`.
* La PR nº1 reste en brouillon : aucune fusion sans autorisation explicite.
