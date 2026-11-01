# RAPPORT DE MISSION ARENA Nº38 — COMPTAI

**Audit de navigation, simplification des menus et terminologie comptable EN/FR**

**Version :** COMPTAI 0.1.1 — démonstration  
**Date :** 1er novembre 2026  
**Branche :** `arena/ec20d0f3-mauritius-compta`  
**Base :** `main` `83cfc9a21bfc980d8b9af60f7177ecad58ee153b` (fusion de la PR nº18, mission 37)  
**PR :** à créer en brouillon après le premier commit  
**Statut :** implémentation et tests locaux terminés ; **non fusionnée**, **non publiée**, **non déployée**  
**Données :** fictives uniquement ; aucun moteur comptable, fiscal ou de paie modifié

---

## 1. Résumé exécutif

La mission 38 simplifie la navigation de COMPTAI sans retirer aucune fonction. La barre latérale passe de **11 à 10 groupes** et de **66 à 60 entrées** (dont la démonstration M37), soit **six doublons réels supprimés**. Les cinq entrées du groupe **Journaux** deviennent cinq **onglets** de **Journal Entries** ; le raccourci **Opening Balances** devient l’onglet **Soldes d’ouverture** de **Financial Years**. **Aucune route, aucun écran et aucune fonction ne disparaît.**

La distinction comptable est désormais explicite :

- **Journal Entries** : registre des écritures, éditeur et onglets par type de journal ;
- **Purchase / Sales / Bank / General Journal** : filtres du registre, accessibles par onglets et par URL directe ;
- **General Ledger** : mouvements par compte, écran distinct ;
- **Trial Balance** : soldes par compte, écran distinct.

La terminologie anglaise est professionnalisée pour un cabinet mauricien : **Client Portfolios**, **Company File**, **Team Members**, **Journal Entries**, **General Ledger**, **Trial Balance**, **Purchase / Sales / Bank / General Journal**, **Bank Reconciliation**, **Year-End Closing**, **Open-Item Matching**, **Accounts Receivable / Payable Aging**. Le libellé **`Client dossiers`** a disparu de l’interface anglaise.

Les résultats reproductibles sont : **web 346 tests / 53 fichiers**, **API 521 tests réussis + 11 ignorés**, **typecheck 0 erreur**, **build réel et build de démonstration réussis**, **vérificateur de démonstration 50/50** et **vérificateur du build réel 5/5**.

**COMPTAI n’est pas déclaré prêt pour la production.** Les points P0-03, P0-04, P0-05 et P1-16 restent ouverts.

## 2. Périmètre et restrictions respectées

**Dans le périmètre :**

- audit de `navigation.ts`, `i18n.tsx`, `glossary.ts`, `modules.ts`, des routes et redirections de `App.tsx`, des onglets, des tableaux de bord et du parcours guidé ;
- suppression des doublons réels de la barre latérale ;
- clarification des sous-menus et des onglets partageant une URL ;
- terminologie anglaise professionnelle et cohérence française ;
- redirections des anciennes URL et conservation des favoris ;
- tests, documentation et accessibilité.

**Hors périmètre, non modifié :**

- aucun moteur comptable, calcul, écriture, balance, état financier, règle TVA ou règle de paie ;
- aucune donnée fictive M37 modifiée ;
- aucune nouvelle fonctionnalité métier, aucun bouton fictif ;
- aucune intégration IA ajoutée ou modifiée fonctionnellement ;
- aucun rôle, droit d’accès ou contrôle de sécurité modifié ;
- aucun secret, aucune donnée réelle, aucun compte bancaire réel ;
- aucun déploiement OVH, aucune publication GitHub Pages, aucun workflow Pages modifié ;
- aucune édition Lite/Standard/Advanced/Enterprise ;
- aucune conformité IFRS, MRA ou paie affirmée.

## 3. Navigation avant / après

| Indicateur | Avant | Après | Écart |
|---|---:|---:|---:|
| Groupes | 11 | **10** | −1 |
| Entrées hors démonstration | 65 | **59** | −6 |
| Entrées avec la démonstration | 66 | **60** | −6 |
| Entrées du groupe Journaux | 5 | **0** | −5 |
| Raccourcis d’exercice | 3 | **2** | −1 |
| Doublons réels de barre latérale | 6 | **0** | −6 |
| Routes supprimées | 0 | **0** | 0 |
| Fonctions supprimées | 0 | **0** | 0 |

### 3.1 Entrées retirées et remplacement

| Entrée retirée | Ancienne URL | Remplacement |
|---|---|---|
| All Journals | `/accounting/journals` | onglet **Tous les journaux** de Journal Entries ; redirection vers `/accounting/entries` |
| Purchase Journal | `/accounting/journals/purchases` | onglet **Journal des achats** ; route directe conservée |
| Sales Journal | `/accounting/journals/sales` | onglet **Journal des ventes** ; route directe conservée |
| Bank Journal | `/accounting/journals/bank` | onglet **Journal de banque** ; route directe conservée |
| General Journal | `/accounting/journals/general` | onglet **Journal des opérations diverses** ; route directe conservée |
| Opening Balances | `/accounting/financial-years?tab=opening` | onglet **Soldes d’ouverture** ; URL directe conservée |

Le groupe **Journaux** est supprimé ; **Journal Entries** rejoint le groupe **Comptabilité**. Les onglets sont accessibles au clavier et référençables par URL.

### 3.2 Accès alternatifs conservés

- **Year-End Closing** reste une entrée directe vers l’onglet checklist, également présent dans les actions du tableau de bord cabinet et à l’étape 16 du parcours guidé.
- **Banking** conserve quatre onglets réellement distincts : comptes, rapprochement, imports, règles.
- **Purchases** conserve son tableau de bord et cinq onglets : fournisseurs, bills, avoirs, règlements, aging.
- **Company Settings** reste accessible depuis le menu Paramètres, par URL directe et depuis la fiche dossier.
- **Accounting Periods** reste dans Settings : il gère l’ouverture/clôture du statut, alors que la clôture annuelle reste dans Financial Years → Year-End Closing. Un texte d’aide explique cette différence.
- **Assistant IA** conserve son entrée de menu et sa pastille flottante transversale.
- **Documents & Archives** reste l’archive transversale référencée par les imports et le scan.

## 4. Terminologie corrigée

Le détail complet, y compris les termes volontairement non traduits, se trouve dans `docs/comptai-accounting-terminology-en-fr.md`.

| Avant (anglais) | Après | Contexte |
|---|---|---|
| Client dossiers | **Client Portfolios** | groupe Clients & Companies |
| Dossier sheet / New dossier / Open dossier | **Company File / New Company File / Open Company File** | fiche et actions société |
| Collaborators | **Team Members** | équipe du cabinet |
| All journals / Purchases journal / Sales journal / Bank journal / General journal | **All Journals / Purchase Journal / Sales Journal / Bank Journal / General Journal** | onglets et titres |
| Bank reconciliation | **Bank Reconciliation** | glossaire et navigation |
| Reconciliation rules | **Bank Rules** | onglet bancaire |
| Import statement | **Bank Imports** | onglet bancaire |
| Lettering | **Open-Item Matching** | lettrage |
| Accounts Receivable aging / Accounts Payable aging | **Accounts Receivable Aging / Accounts Payable Aging** | balances âgées |
| Settings (entrée de menu) | **Accounting Settings** | lève l’ambiguïté avec le groupe Settings |
| Accounting assistant / Proposed entries | **AI Assistant / AI Proposals** | écrans IA |
| `dossier` dans les messages anglais | **company file** | cabinet, facturation, IA, erreurs |

Le français reste fonctionnel : « Dossiers clients », « Écritures comptables », « Grand livre », « Balance générale », « Journal des achats », « Clôture annuelle », « Lettrage » et « Paramètres comptables » sont conservés.

## 5. Parcours EN/FR

### 5.1 Parcours anglophone

1. **Clients & Companies → Client Portfolios** : recherche d’une société, ouverture d’un **Company File**, accès aux modules.
2. **Accounting → Journal Entries** : registre unique ; onglets **All Journals**, **Purchase Journal**, **Sales Journal**, **Bank Journal**, **General Journal**.
3. **Accounting → General Ledger** puis **Trial Balance** : contrôle par compte et contrôle d’équilibre.
4. **Banking → Bank Reconciliation** : onglet Transactions, rapport d’écart, imports et règles.
5. **Purchases & Expenses** : dashboard, supplier list, bills, credit notes, payments, AP aging.
6. **Reports → Financial Statements / Balance Sheet / Profit & Loss**.
7. **Settings → Accounting Settings / Company Settings / Accounting Periods / Audit Trail / Data & Backups**.
8. **Cabinet Dashboard → Year-End Closing** ou **Accounting → Year-End Closing**.

### 5.2 Parcours francophone

1. **Clients et sociétés → Dossiers clients** : portefeuille, fiche dossier, tâches et équipe.
2. **Comptabilité → Écritures comptables** : onglets **Tous les journaux**, **Journal des achats**, **Journal des ventes**, **Journal de banque**, **Journal des opérations diverses**.
3. **Comptabilité → Grand livre** puis **Balance générale**.
4. **Banque → Rapprochement bancaire** : transactions, imports, règles.
5. **Achats et dépenses** : tableau de bord, fournisseurs, factures, avoirs, règlements, balance âgée.
6. **Rapports → Bilan / Compte de résultat / États financiers**.
7. **Paramètres → Paramètres comptables / Paramètres société / Périodes comptables / Piste d’audit / Données et sauvegardes**.
8. **Tableau de bord Cabinet → Clôture annuelle** ou **Comptabilité → Clôture annuelle**.

## 6. Implémentation

### 6.1 Fichiers modifiés

- `apps/web/src/navigation.ts` : 10 groupes, 60 entrées, suppression du groupe Journaux et du raccourci Opening Balances, ordre Bancaire clarifié.
- `apps/web/src/i18n.tsx` : terminologie EN, suppression des clés de groupe mortes (`nav.group.journals`, `nav.group.advanced`, `nav.group.administration`), aide « Accounting Periods ».
- `apps/web/src/glossary.ts` : casse professionnelle des termes canoniques.
- `apps/web/src/pages/Entries.tsx` : cinq onglets de journaux, `role="tablist"`, `aria-selected`, liens focusables.
- `apps/web/src/App.tsx` : redirection de `/accounting/journals` vers `/accounting/entries` en conservant la query string.
- `apps/web/src/modules.ts` : nouvelles redirections de favoris (`/journals`, `/financial-years`, `/accounting/opening-balances`, `/accounting/year-end-closing`, `/year-end-closing`).
- `apps/web/src/pages/accounting/FinancialYears.tsx` : libellés d’onglets alignés sur la terminologie.
- `apps/web/src/pages/accounting/Lettering.tsx` : affichage anglais « matching » au lieu de « lettering ».
- `apps/web/src/pages/GuidedDemo.tsx` : lien Year-End Closing vers l’onglet checklist, libellé « Guided Demo », message de réinitialisation sans « dossier ».
- `apps/web/src/pages/Settings.tsx` : texte d’aide Périodes comptables.
- `apps/web/src/styles.css` : style et focus visible des onglets-liens.
- Tests : `mission38-navigation.test.ts`, `mission38-ui.test.tsx` et mises à jour des suites M26/M36/M37 concernées.

### 6.2 Redirections et compatibilité

| Ancienne URL | Destination |
|---|---|
| `/journals` | `/accounting/entries` |
| `/accounting/journals` | `/accounting/entries` (query conservée) |
| `/financial-years` | `/accounting/financial-years` |
| `/accounting/opening-balances` | `/accounting/financial-years?tab=opening` |
| `/accounting/year-end-closing` | `/accounting/financial-years?tab=checklist` |
| `/year-end-closing` | `/accounting/financial-years?tab=checklist` |

Les redirections V0.1 `/companies`, `/accounts`, `/entries`, `/ledger`, `/trial-balance`, `/statements` et `/settings` restent inchangées. Les routes `/accounting/journals/{purchases,sales,bank,general}` restent des écrans réels.

## 7. Tests et vérifications

### 7.1 Les dix catégories exigées

| # | Catégorie | Preuve |
|---:|---|---|
| 1 | Absence de doublons inutiles | `mission38-navigation.test.ts` : aucune destination identique, 6 doublons retirés, aucun `to` de journal dans la barre latérale |
| 2 | Unicité des destinations uniques | `mission38-navigation.test.ts` : clés et destinations uniques ; `mission36-navigation.test.ts` : routes déclarées |
| 3 | Onglets partageant une URL | `mission38-navigation.test.ts` : Banking 4, Purchases 6, Financial Years 2, Settings 3 ; `mission38-ui.test.tsx` : navigation par onglets |
| 4 | Journal Entries / Journals / General Ledger distincts | `mission38-navigation.test.ts` : trois routes distinctes, cinq onglets, `role="tablist"` |
| 5 | Cohérence EN/FR | `i18n-quality.test.ts`, `mission38-navigation.test.ts`, `mission36-journeys.test.tsx` FR et EN |
| 6 | Absence de `Client dossiers` en UI EN | `mission38-navigation.test.ts` et `mission38-ui.test.tsx` : aucune valeur anglaise contenant `dossier` ou `collaborator` |
| 7 | Anciennes routes et favoris | `mission38-ui.test.tsx` : `/accounting/journals?search=FAC`, `/journals`, `/year-end-closing` ; `mission38-navigation.test.ts` : table `LEGACY_REDIRECTS` |
| 8 | Permissions par module | `mission38-navigation.test.ts` : chaque entrée porte un module valide ; aucun contrôle serveur modifié |
| 9 | Navigation mobile | `mission38-ui.test.tsx` : tiroir mobile, 10 groupes, ouverture/fermeture, fermeture après navigation |
| 10 | Compatibilité parcours guidé M37 | `mission37-guided-demo.test.tsx`, `mission38-ui.test.tsx` : 14 liens, 16 étapes, lien de clôture correct |

### 7.2 Résultats réels

| Vérification | Résultat |
|---|---|
| Tests web | **346 réussis / 346**, 53 fichiers |
| Tests API | **521 réussis + 11 ignorés** (532) |
| Typecheck | **0 erreur** (`@mc/api` et `@mc/web`, tests inclus) |
| Build réel | **réussi** — `1 256,14 kB` (`311,74 kB` gzip) |
| Build démonstration | **réussi** — `1 280,84 kB` (`319,63 kB` gzip) + `runtime` `717,98 kB` (`199,42 kB` gzip) |
| Vérificateur démo | **50/50** |
| Vérificateur build réel | **5/5** |
| `/#/demo` | **14 destinations, 16 étapes, 8 contrôles de santé** |

Les tests n’ont pas été affaiblis : les assertions M26/M36/M37 ont été adaptées au nouveau contrat de navigation (onglets et libellés), et de nouvelles assertions M38 protègent l’absence de doublons, les redirections et la terminologie.

## 8. Documentation livrée

- `docs/mission-38-report.md` — le présent rapport.
- `docs/comptai-navigation-duplicate-audit.md` — matrice des 66 entrées (60 actuelles + 6 retirées), 8 colonnes.
- `docs/comptai-navigation-before-after.md` — groupes, entrées, onglets, routes et favoris avant/après.
- `docs/comptai-accounting-terminology-en-fr.md` — vocabulaire de référence, corrections et éléments non traduits.

## 9. Limites et points ouverts

- Aucun test manuel sur téléphone ou tablette physique n’a été réalisé ; la navigation mobile est vérifiée en jsdom et par les règles CSS existantes.
- Les écrans **Prepared**, **Coming Soon** et les modules bloqués conservent leur statut ; la mission ne les rend pas opérationnels.
- La route `/accounting/banking/pdf` et `/accounting/banking/mcb` partagent le même composant avec deux modes d’import : variante conservée, documentée, non fusionnée.
- Les messages serveur non mappés conservent le texte renvoyé par l’API ; la traduction exhaustive des erreurs serveur reste hors périmètre.
- Le libellé `Payslip` au singulier dans le menu Paie reste aligné sur le glossaire ; une pluralisation éventuelle fera l’objet d’une mission dédiée.
- **P0-03, P0-04, P0-05 et P1-16 restent ouverts** ; aucune publication, aucun déploiement, aucune déclaration de production.

## 10. Git, PR et CI

| Élément | Valeur |
|---|---|
| Branche | `arena/ec20d0f3-mauritius-compta` |
| Base | `main` `83cfc9a` |
| Commit HEAD | à compléter après commit |
| PR | à compléter après création (brouillon) |
| CI | à compléter après exécution GitHub Actions |
| Fusion | **interdite sans autorisation explicite** |
