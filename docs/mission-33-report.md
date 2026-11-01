# Mission 33 — correction P0-01 : devise de présentation des états financiers

**Date : 1er novembre 2026**
**Branche : `arena/e540350d-mauritius-compta`**
**Base : `main` = `c9d20cf7a9e664b30b7e9bdd81fccdda0548acd0` (fusion de la PR nº13)**
**Version : COMPTAI 0.1.1**
**Livraison : PR nº14 en brouillon (commit initial `92c5a13`), CI verte le 1er novembre 2026 — run `41310452141`**
**Nature : correction ciblée. Aucune règle fiscale, aucun calcul de paie, aucune écriture historique et aucune donnée réelle n'ont été modifiés.**

**Documents liés :** [registre des écarts](./comptai-preproduction-gaps.md) · [audit mission 32](./mission-32-audit.md) · [couverture fonctionnelle](./comptai-functional-coverage.md) · [matrice QuickBooks](./comptai-quickbooks-test-matrix.md)

## 1. Résultat en une phrase

Le risque d'affichage trompeur est **neutralisé** : les états financiers, les exports CSV, les PDF,
l'API et l'écran affichent désormais la **devise fonctionnelle** dans laquelle les montants sont
réellement calculés. La **conversion multidevise complète n'est pas implémentée** ; la devise de
présentation configurée est conservée et signalée comme non appliquée.

## 2. Cause exacte de l'anomalie

`apps/api/src/modules/reports/routes.ts` transmettait
`presentation_currency` à `computeStatements()` :

```ts
const currency = ctx.company.presentation_currency || ctx.company.functional_currency;
const statements = await computeStatements(db, companyId, currency, range);
```

Or `computeStatements()` ne fait aucune conversion : il additionne les lignes du grand livre en
devise fonctionnelle et recopiait simplement l'argument reçu dans `currency`. Le même défaut
existait dans le moteur de démonstration (`apps/web/src/demo/runtime.ts`), qui appelait
`computeStatements(companyId, company.presentation_currency, ...)` et utilisait aussi
`company.presentation_currency` pour le tableau de bord et l'export CSV.

Conséquences observées :

- l'API renvoyait `currency: "EUR"` alors que tous les montants restaient en MUR ;
- `Statements.tsx` affichait `company.presentation_currency` dans l'en-tête ;
- le PDF affichait un en-tête `Currency: MUR` (devise fonctionnelle) mais formatait chaque montant
  avec `st.currency` (devise de présentation) : deux devises contradictoires dans le même document ;
- aucun taux, aucune date de taux et aucune méthode de conversion n'existaient.

## 3. Solution retenue

### 3.1 Protection temporaire, pas de conversion approximative

La solution 2 de la mission a été retenue : **les montants restent en devise fonctionnelle** et
**aucune conversion n'est effectuée**. Aucun taux de change n'a été ajouté, ni en base, ni dans le
code, ni dans les tests.

La configuration `presentation_currency` est **conservée** :

- elle n'est ni effacée, ni remplacée en base ;
- l'API la renvoie dans `presentationCurrency` ;
- `presentationCurrencyApplied` vaut `false` lorsque les deux devises diffèrent ;
- l'écran et les PDF expliquent qu'elle n'est pas appliquée.

### 3.2 Contrat API des états financiers

`GET /companies/:id/reports/statements` renvoie maintenant :

| Champ | Valeur / signification |
|---|---|
| `currency` | Devise réelle de tous les montants : **devise fonctionnelle**. |
| `functionalCurrency` | Devise fonctionnelle de la société. |
| `presentationCurrency` | Devise de présentation configurée, conservée pour l'avenir. |
| `presentationCurrencyApplied` | `true` uniquement si les deux devises sont identiques ; `false` si une conversion serait nécessaire. |
| `currencyBasis` | `functional_currency`. |

Les montants, la balance, le bilan et le compte de résultat ne changent pas : seule l'étiquette de
devise et la métadonnée de présentation sont corrigées.

### 3.3 Fichiers modifiés

| Fichier | Modification |
|---|---|
| `apps/api/src/modules/reports/service.ts` | `StatementsDto` enrichi ; `computeStatements()` reçoit la devise de présentation comme métadonnée et retourne toujours la devise fonctionnelle comme devise des montants. |
| `apps/api/src/modules/reports/routes.ts` | Les états sont calculés en `functional_currency` ; la devise de présentation est transmise séparément ; le CSV contient une ligne `Devise;MUR` / `Currency;MUR`. |
| `apps/api/src/modules/reports/pdf.ts` | En-tête toujours en devise fonctionnelle ; mention « devise de présentation non appliquée » si les devises diffèrent. |
| `apps/api/src/i18n/index.ts` | Libellés FR/EN de la mention PDF. |
| `apps/web/src/pages/Statements.tsx` | En-tête basé sur la devise réelle ; bandeau explicite si la présentation configurée n'est pas appliquée. |
| `apps/web/src/demo/runtime.ts` | Même correction dans le backend de démonstration : états, tableau de bord, CSV et métadonnées. |
| `apps/web/src/i18n.tsx` | Libellés FR/EN de l'écran et des paramètres. |
| `apps/web/src/pages/company/CompanySettings.tsx` | Aide sous la devise de présentation lorsqu'elle diffère de la devise fonctionnelle. |
| `apps/web/src/pages/Settings.tsx` | Rappel dans la fiche société. |
| `apps/api/tests/mission33-statements-currency.test.ts` | 7 tests API/CSV/PDF, dont la reproduction de l'anomalie. |
| `apps/web/tests/mission33-statements-currency-ui.test.tsx` | 2 tests d'interface sur le build de démonstration. |

Aucun schéma SQL, aucune migration, aucun taux fiscal, aucun calcul de paie et aucun libellé de
marque n'ont été modifiés.

## 4. Contrôles comptables

| Contrôle | Résultat | Preuve |
|---|---|---|
| Montants comptables inchangés | **OK** | Les scénarios MUR/MUR et MUR/EUR produisent les mêmes totaux : produits 50 000, charges 15 000, résultat 35 000, actif 135 000. |
| Écritures historiques non modifiées | **OK** | Test avant/après sur `journal_lines` : même nombre de lignes, même total débit, même total crédit. |
| Balance équilibrée | **OK** | `trial-balance.balanced === true` après consultation des états. |
| Bilan équilibré | **OK** | `financialPosition.balanced === true` dans tous les scénarios. |
| Résultats identiques | **OK** | Les totaux sont identiques entre devise fonctionnelle et présentation configurée ; aucune conversion n'est appliquée. |
| Devise cohérente dans les rapports et exports | **OK** | API : `currency = functionalCurrency` ; CSV : ligne `Currency;MUR` ; PDF : `Amounts in MUR`, aucun `Amounts in EUR`. |
| Aucun taux fictif | **OK** | Aucun taux ajouté ; les montants restent strictement identiques. |
| Sociétés MUR/MUR sans régression | **OK** | `presentationCurrencyApplied = true`, aucun bandeau supplémentaire, états et exports inchangés. |

## 5. Tests avant / après

### 5.1 Avant la correction — reproduction de l'anomalie

Commande :

```bash
npm run test -w @mc/api -- mission33-statements-currency.test.ts
```

Résultat : **6 échecs sur 7 tests**, dont :

```text
expected 'EUR' to be 'MUR'
```

Le test PDF montrait le défaut dans un seul document :

```text
Currency: MUR
...
85,000.00 EUR
50,000.00 EUR
```

Le test CSV échouait sur l'absence de ligne de devise. Le test « écritures non modifiées »
passait déjà, ce qui confirme que l'anomalie était uniquement une étiquette de présentation.

### 5.2 Après la correction

```bash
npm run test -w @mc/api -- mission33-statements-currency.test.ts
```

Résultat : **7 tests réussis sur 7**.

```bash
npm run test -w @mc/web -- mission33-statements-currency-ui.test.tsx
```

Résultat : **2 tests réussis sur 2** :

- MUR fonctionnel / EUR configuré : l'écran affiche MUR et le bandeau
  « Montants exprimés en MUR. Devise de présentation configurée non appliquée à ces états : EUR. » ;
- MUR/MUR : aucun bandeau supplémentaire.

### 5.3 Suites complètes et vérifications

| Vérification | Résultat |
|---|---|
| API — `npm run test -w @mc/api` | **510 tests : 499 réussis, 11 ignorés, 0 échec**, 33 fichiers passés + 1 fichier ignoré |
| Web — `npm run test -w @mc/web` | **289 réussis, 0 échec**, 45 fichiers |
| Typecheck — `npm run typecheck` | **0 erreur** |
| Build — `npm run build` | **succès** ; chunk web 1 239,56 kB (307,43 kB gzip) |
| Test ciblé des rapports existants | **32 réussis** (`reports`, `regressions`, `financial-years`) |
| Tests UI existants | **43 réussis** (`demo-engine`, `demo-app`, `company-settings-ui`, mission 33, i18n) |

Les 11 tests ignorés localement le sont faute de `TEST_DATABASE_URL` (concurrence et lettrage).
Le job CI **API tests against real PostgreSQL** les exécute : la suite complète y est passée.

| Job CI (run `41310452141`) | Résultat |
|---|---|
| Typecheck, tests and build | **succès** (4 min 10 s) |
| API tests against real PostgreSQL | **succès** (2 min 12 s) |
| Migrations against real PostgreSQL | **succès** (29 s) |
| Build demo bundle | **succès** (1 min 42 s) ; publication GitHub Pages ignorée, la branche n'étant pas `main` |

La première exécution de la CI avait échoué sur `mission23-ui.test.tsx` (« Compte bancaire »
introuvable), un test d'interface sans rapport avec les états financiers, déjà instable sous charge.
La relance, sans aucun changement de code, a été entièrement verte. Ce point est signalé comme
fragilité de test à traiter séparément ; il ne remet pas en cause la correction P0-01.

## 6. Limites assumées

1. **Aucune conversion** : une société MUR avec présentation EUR voit toujours ses états en MUR.
   C'est volontaire et explicite.
2. **Pas de taux historique, de taux de clôture, de taux moyen ni de réserve de conversion** : ces
   éléments ne peuvent pas être inventés.
3. **Pas de conversion des états antérieurs** : les PDF/CSV déjà générés et archivés ne sont pas
   réécrits.
4. **La devise de présentation reste modifiable** selon les règles existantes ; elle est conservée
   comme préférence, mais n'est pas appliquée aux états.
5. **Les clients API qui lisaient `company.presentation_currency` pour libeller les états** doivent
   utiliser `currency` ou `functionalCurrency`. Le champ `presentationCurrency` reste informatif.
6. **Pas de validation par un expert-comptable** dans cette mission : la neutralisation de
   l'affichage ne vaut pas validation d'une méthode de conversion.

## 7. Exigences pour une future conversion conforme

Une conversion complète ne devra être activée qu'après validation écrite des points suivants :

- **Périmètre** : quels états, quelles périodes, quels comptes et quels documents sont convertis ;
- **Taux** : source officielle, date de chaque taux, taux historique par transaction ou taux de
  clôture, taux moyen pour le compte de résultat ;
- **Méthode** : conversion des produits et charges, du bilan, des capitaux propres et du résultat ;
- **Écarts de conversion** : traitement comptable de la réserve de conversion et du résultat de
  conversion, sans contourner le grand livre ;
- **Arrondis** : précision, arrondi par ligne ou par total, contrôle d'équilibre après conversion ;
- **Comparatifs** : conversion des exercices N-1 et conservation des montants d'origine ;
- **Traçabilité** : version du taux, auteur, source, date, pièce justificative et journal d'audit ;
- **Tests** : identité des montants d'origine, équilibre du bilan converti, réconciliation avec le
  grand livre en devise fonctionnelle, cas de taux manquant ;
- **Validation** : revue d'un expert-comptable mauricien et décision écrite sur la présentation ;
- **Contrat API** : `currencyBasis` devra distinguer explicitement
  `functional_currency` de `presentation_currency_converted`, et `presentationCurrencyApplied`
  ne pourra passer à `true` qu'après conversion réellement exécutée.

## 8. Statut final de P0-01

| Aspect | Statut |
|---|---|
| Risque d'affichage trompeur | **Neutralisé** |
| Montants en devise fonctionnelle | **Corrigé et testé** |
| Devise de présentation conservée | **Oui** |
| Mention « non appliquée » | **Oui, API, écran, CSV et PDF** |
| Conversion multidevise complète | **Non implémentée — P2-13** |
| P0-01 comme blocage de production | **Fermé pour le risque d'affichage** |
| Conversion validée par un expert | **Non — hors périmètre de cette mission** |

**Recommandation de fusion** : la correction peut être fusionnée après revue du diff et CI verte,
car elle supprime le risque d'étiquette mensongère sans toucher aux montants, aux écritures, aux
règles fiscales ni aux calculs de paie. Elle ne doit pas être présentée comme une implémentation
de la conversion multidevise.
