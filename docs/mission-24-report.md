# Mission 24 — Qualité FR/EN, finitions et préparation de l’assistant IA métier

_État au 1er novembre 2026. Branche `arena/35525a62-mauritius-compta`, PR en brouillon,
**aucune fusion**, aucun déploiement GitHub Pages ou OVH, aucune donnée réelle, aucun
envoi d’e-mail, aucun bulletin réel, aucune déclaration MRA, aucune clé API dans le
dépôt ou le frontend. `main` reste intact._

## 1. Branche et commit

- Base : `main` = `a841eb156196f4bfc67ab639cd2b44ee10ff498d` (merge de la PR nº 6,
  mission 23).
- Branche de travail : `arena/35525a62-mauritius-compta`, créée depuis cette base.
- Aucun commit sur `main` ; la PR sera ouverte **en brouillon** et ne sera ni fusionnée
  ni déployée sans autorisation.
- Le hash HEAD final est celui de la branche au moment de la PR (les commits de
  documentation sont ajoutés après les commits de code).
- Migrations : inchangées, maximum **0021**. Schéma de démonstration : **17**.
- Aucun module des missions 1 à 23 n’a été recréé ; les écrans et services existants
  ont été étendus.

## 2. Audit linguistique et corrections

### 2.1 Méthode

1. Extraction statique des clés du dictionnaire `apps/web/src/i18n.tsx` (`fr` et `en`).
2. Recherche AST des appels `t('…')` dans tous les fichiers `.tsx`/`.ts` de
   `apps/web/src` pour trouver les clés utilisées et manquantes.
3. Analyse des nœuds JSX texte et des attributs visibles (`placeholder`, `title`,
   `aria-label`, `alt`) pour repérer les chaînes en dur.
4. Recherche des libellés français dans le dictionnaire anglais et inversement.
5. Contrôle manuel des écrans listés au § 3.

### 2.2 Résultat mesuré

- **1 605 clés par langue** (contre ~1 502 au départ), strictement le même ensemble
  FR/EN.
- Toutes les clés littérales utilisées par le code existent désormais dans les deux
  langues. `fa.noAsset`, seule clé manquante relevée, a été ajoutée.
- **64 codes d’erreur traduits** en FR et EN (contre 30 au départ), dont tous les codes
  récents des documents/OCR, du pont stock, des propositions et de l’assistant.
- Les erreurs serveur sont maintenant traduites **dans le navigateur** par
  `errorMessage()` (`apps/web/src/store.tsx`) : un code inconnu conserve le message
  localisé renvoyé par l’API, mais les 64 codes courants ne s’affichent plus en anglais
  dans une interface française.

### 2.3 Glossaire centralisé

`apps/web/src/glossary.ts` est la source unique des paires canoniques. `i18n.tsx` le
consomme pour les entrées concernées ; un test échoue si une clé s’écarte du glossaire.

| Concept | Français | English |
| --- | --- | --- |
| Plan comptable | Plan comptable | Chart of Accounts |
| Grand livre | Grand livre | General Ledger |
| Balance générale | Balance générale | Trial Balance |
| Compte de résultat | Compte de résultat | Statement of Profit or Loss |
| Bilan | Bilan | Statement of Financial Position |
| Immobilisations | Immobilisations | Fixed Assets |
| Charges constatées d’avance | Charges constatées d’avance | Prepayments |
| Charges à payer | Charges à payer | Accrued Expenses |
| Provisions | Provisions | Provisions |
| Rapprochement bancaire | Rapprochement bancaire | Bank Reconciliation |
| Bulletin de paie | Bulletin de paie | Payslip |
| Écriture comptable | Écriture comptable | Journal Entry |

Règles respectées : aucun code de compte, aucune donnée historique, aucune écriture et
aucune règle comptable modifiés pour une correction linguistique. Les libellés EN/FR
personnalisés du plan comptable (mission 23) restent prioritaires et ne sont jamais
remplacés par une traduction automatique.

### 2.4 Corrections principales

- Navigation et titres alignés sur le glossaire (plan comptable, grand livre, balance,
  immobilisations, rapprochement bancaire, bulletins).
- Écrans passés de chaînes en dur à `t()` : connexion, devises multiples, paramètres,
  clients, transfert comptable de paie, écritures, préparation, équipe cabinet.
- Tables de mappage comptable : rôles traduits (client, fournisseur, banque, caisse,
  TVA, immobilisation, etc.), badge « rôles configurés / total ».
- Stocks : édition catégorie/emplacement/article, colonne Actions, libellés FR/EN.
- Facturation : bouton et modale de pont stock entièrement traduits.
- Paie : les valeurs techniques des listes (`bank_transfer`, `permanent`, `full_time`,
  `monthly`, `draft`, `validated`) sont remplacées par des libellés naturels.
- Banque et devises : « affecté », « Gain / Perte » ne sont plus codés en dur.
- Erreur de typographie « La demander » corrigée dans l’assistant.

## 3. Modules vérifiés

| Espace | Écrans contrôlés |
| --- | --- |
| Tableau de bord et sociétés | `Dashboard`, `Companies`, `CompanySettings`, `Login`, `Settings` |
| Comptabilité générale | `Accounts`, `Entries`, `Ledger`, `TrialBalance`, `Statements`, `FinancialYears`, `Equity` |
| Immobilisations et stocks | `FixedAssets`, `Inventory` (stock, mouvements, inventaires, dépréciations, rapports, paramètres) |
| Régularisations et provisions | `Accruals`, `Provisions` (lecture/validation ; édition non disponible côté API) |
| Achats et facturation | `Purchases`, `billing/Customers`, `billing/Documents`, `billing/Items` |
| Banque et rapprochement | `Bank`, `BankMcb`, `Lettering`, `MultiCurrency` |
| OCR et documents | `documents/ScanImport` |
| Paie et bulletins | `Payroll`, `PayslipView`, `Declarations`, `AccountingTransfer` |
| Cabinet | `CabinetDashboard`, `Dossier`, `Tasks`, `Team`, `Migration`, `AiAssistant`, `AiProposals`, `AiSettings` |
| Transverse | `DemoBanner`, `AssistantPanel`, erreurs et validations |

La vérification est statique (clés, chaînes, typecheck) et par tests jsdom. Elle ne
remplace pas une revue visuelle sur appareil physique.

## 4. Finitions livrées (missions 22 et 23)

1. **Stocks — édition** : catégories, emplacements et articles disposent d’un bouton
   « Modifier », d’un formulaire prérempli et d’un `PUT` ; la création reste un `POST`.
   Le nombre de colonnes des tableaux a été corrigé.
2. **Facturation → stock** : une facture client **émise** affiche « Proposer les
   mouvements de stock ». La modale charge articles, emplacements et journaux actifs,
   pré-mappe par SKU = référence (sinon par nom), envoie
   `POST /companies/:id/inventory/movements/from-billing/:documentId` et affiche un
   lien direct vers les mouvements. Aucun mouvement n’est validé automatiquement.
3. **Mappings comptables** : carte dédiée dans le plan comptable, rôle → compte actif,
   état manquant/configured, compteur de rôles configurés.
4. **OCR → écritures** : le brouillon créé après approbation renvoie vers
   `/accounting/entries?search=<numéro>` ; la recherche est lue par l’écran Écritures.
5. **MCB → rapprochement** : l’import redirige vers
   `/accounting/banking?bankAccountId=<id>` et l’écran Banque lit ce paramètre.
6. **Onglet Stocks** : `?tab=` ouvre directement mouvements, inventaires, etc.
7. **Messages d’erreur** : codes récents traduits, message serveur conservé en repli.
8. **Responsive** : les règles existantes (safe-areas, tableaux défilants, pas de
   `overflow` horizontal) sont conservées ; aucun test sur Samsung Android physique ni
   Chrome Windows n’a pu être exécuté dans cet environnement.
9. **Non livré, faute d’API** : formulaires d’édition des régularisations et provisions.
   Les routes existantes ne proposent que création, décision, validation et
   comptabilisation ; ajouter un formulaire aurait nécessité un nouveau contrat API,
   hors périmètre « uniquement les manques avérés lorsque l’API le permet ».

## 5. État exact de l’API IA existante

### 5.1 Déjà opérationnel en code (sous réserve de configuration)

- `AIService` : keyring `AI_ENCRYPTION_KEY`, budgets, quotas, retries, estimation de
  coût, écriture d’audit.
- Adaptateurs fournisseur : **compatible OpenAI** (`POST /chat/completions`) et
  **Gemini** (`generateContent`), avec contrôle d’URL de base contre le SSRF.
- Routes cabinet : réglages, identifiants par fournisseur, test de connexion, usage,
  capacités. Routes société : suggestions, règles d’écriture, propositions, conversations.
- Assistant déterministe : routeur d’intentions, 28 outils métier (15 exposés dans la démo), journal
  `ai_tool_runs`, quotas de messages, limite de 600 caractères par message.
- Outil d’écriture unique : `accounting.proposal.prepare`, qui crée une proposition
  `proposed` dans `ai_entry_proposals`, avec validation humaine ultérieure.

### 5.2 Présent mais non configuré

- `AI_ENCRYPTION_KEY` : nécessaire pour stocker des identifiants de façon sûre.
- Tarifs fournisseurs : volontairement vides dans `config/ai-providers.json`
  ⇒ coût estimé `null`, aucune promesse de budget en devise.
- Fournisseur `simulated` : interdit en production (`AI_ALLOW_SIMULATED=false`).

### 5.3 Simulé

- Le fournisseur `simulated` et les réponses de la démonstration GitHub Pages.
- Les tests d’assistant espionnent `fetch` ; ils ne prouvent pas un appel réseau réel.

### 5.4 À développer

- Aucun appel LLM n’est effectué par l’assistant pour choisir un outil ou rédiger une
  réponse : le routeur est déterministe.
- Pas de prévisualisation riche dans la conversation (lien vers l’écran des propositions).
- Pas de préparation paie/contrat/relance, pas d’exécution supervisée, pas de connecteur
  d’envoi.
- **Aucune clé n’est exposée** : le catalogue renvoyé au navigateur ne contient que des
  métadonnées (`mode`, `risk`, `requiredAccess`, `humanValidation`, `audit`,
  `companyScoped`) et `secretsInFrontend: false`.

### 5.5 Gouvernance ajoutée

`GET /api/companies/:id/ai/assistant/tools` renvoie désormais
`mode: 'deterministic-supervised'` et un bloc `governance` :

```json
{
  "executionEnabled": false,
  "availableModes": ["read", "prepare"],
  "humanValidationRequired": true,
  "companyScoped": true,
  "auditTable": "ai_tool_runs",
  "secretsInFrontend": false
}
```

Chaque outil expose son mode, son risque, l’accès requis et l’obligation de validation
humaine. La démonstration a été alignée sur ce contrat.

## 6. Premier parcours IA livré

**Demande en langage naturel → brouillon métier → prévisualisation → approbation
humaine**, sur le cas déjà couvert de la proposition d’écriture :

1. « Prépare une écriture pour un achat de 3 250 MUR ».
2. `detectIntent` sélectionne `proposal_prepare` ; le montant est extrait avec
   `parseAmount` (arithmétique décimale exacte).
3. `accounting.proposal.prepare` vérifie l’accès `accounting:write`, n’utilise que des
   comptes actifs, contrôle l’équilibre et crée une proposition `proposed`.
4. La réponse contient `examineHref` vers `/cabinet/ai-proposals?proposal=<id>`.
5. L’humain approuve ou refuse ; l’approbation crée une **écriture en brouillon**,
   jamais une écriture comptabilisée.

Ce parcours ne dépend d’aucun fournisseur externe. Il est couvert par
`apps/api/tests/assistant.test.ts` (23 tests). Il ne faut pas le décrire comme un agent
autonome : le modèle ne choisit pas encore l’outil.

## 7. Feuille de route de l’agent

Document complet : **`docs/accounting-ai-agent-roadmap.md`**.

- **Phase 1 — consultatif** : lecture et proposition d’écriture, aucune exécution.
  Livrée.
- **Phase 2 — préparateur** : sélection LLM contrainte par un catalogue fermé,
  prévisualisation, aucun statut `posted`. À développer outil par outil (paie,
  contrats, OCR, rapprochement, relance, clôture).
- **Phase 3 — exécutant supervisé** : `approvalId`, idempotence, double validation pour
  les actions à risque, compensation.
- **Phase 4 — automatisations encadrées** : planificateur, liste blanche, budget,
  désactivation après échecs, revue trimestrielle.

La partie paie traite explicitement : séparation société/salarié, pseudonymisation par
défaut, contrôles d’anomalies déterministes, destinataires vérifiés (non implémenté),
prévisualisation, approbation, droits, historique des envois, anti-doublons, gestion
d’erreurs et protection des données. **Aucune diffusion réelle, aucune déclaration
automatique** n’est livrée ni promise.

## 8. Préparation GitHub Pages

`.github/workflows/pages.yml` a été revu :

- déclenchement sur `push` **vers `main` uniquement**, sur `pull_request` vers `main`,
  et `workflow_dispatch` ;
- les branches Arena et les PR exécutent `npm ci`, typecheck, tests web, build démo et
  contrôles du bundle, mais **l’upload et le déploiement sont conditionnés à `main`** ;
- `deploy` a sa propre concurrence non annulable, pour ne pas interrompre une
  publication ;
- le build injecte `VITE_BUILD_COMMIT` et vérifie dans le bundle la version, le commit,
  les écrans des missions 23 et 24 ;
- les garde-fous existants sont conservés (base `/mauritius-compta/`, 404, échantillons
  fictifs, analyse du bundle à la recherche de clés `sk-…`, `AIza…` ou de clés privées) ;
- aucune publication n’a été déclenchée par cette mission.

Point d’attention : avant cette mission, le workflow ne publiait que depuis d’anciennes
branches Arena et jamais depuis `main`. Après fusion approuvée, le premier push sur
`main` publiera la démo ; ce déclenchement doit être explicitement autorisé.

## 9. Tests et CI

Exécutés localement le 1er novembre 2026 :

| Commande | Résultat |
| --- | --- |
| `npm run typecheck` (API + web) | 0 erreur |
| `npm run test -w @mc/web` | **240/240** tests, 33 fichiers |
| `npx vitest run apps/api/tests` | **473 réussis / 11 ignorés** (484) |
| `npx vitest run apps/api/tests/assistant.test.ts` | **23/23** |
| `npx vitest run apps/api/tests/mission22.test.ts` | **13/13** |
| `VITE_BUILD_COMMIT=deadbee npm run build:demo` | build OK |
| Contrôles `grep` du bundle (version, commit, OCR, MCB, mappings, pont stock) | OK |

Nouveaux tests :

- `apps/web/tests/i18n-quality.test.ts` : parité FR/EN, glossaire, absence de fuite de
  l’autre langue, résolution de toutes les clés littérales du code source.
- `apps/api/tests/mission22.test.ts` : `PUT` catégorie/emplacement/article et pont
  facture client émise → mouvements de stock proposés, refus d’une quantité supérieure
  à la quantité facturée.

La CI GitHub n’a pas encore exécuté cette branche au moment de la rédaction ; le
workflow PR ne déploiera rien. Aucun test E2E Playwright, aucun test sur Samsung
Android physique, aucun test sur Chrome Windows.

## 10. Limitations et décisions nécessaires

### Limitations assumées

- L’assistant n’appelle aucun LLM : la compréhension est déterministe.
- Aucune preuve qu’un fournisseur réel est configuré ; les tarifs sont vides.
- 64 codes d’erreur traduits ; les codes moins courants utilisent le message serveur.
- Les écrans `Accruals`, `FinancialYears`, `Inventory` (partiellement), `Provisions`
  et `Purchases` utilisent encore le helper local `L(fr, en)` ; les deux langues sont
  professionnelles, mais ces libellés ne sont pas dans le dictionnaire central.
- Pas d’édition des régularisations/provisions : l’API ne l’expose pas.
- Pas de test visuel responsive physique.
- Aucune publication, aucun déploiement, aucune fusion.

### Décisions à regrouper pour une revue professionnelle unique (en anglais)

1. Which tools may move from `prepare` to `execute`, and which need two approvers?
2. May payroll data ever leave the server for an external LLM, or must payroll
   reasoning remain deterministic and local?
3. What retention period applies to `ai_tool_runs` and future `ai_approvals`?
4. Which roles may approve a payroll calculation, a journal entry and a payment?
5. Is a per-company monthly AI budget acceptable, and what happens when it is exceeded?
6. Which client communications may be automated, and through which verified channel?
7. What evidence must be retained for an automated action to be auditable?
8. Should a firm be able to disable one tool without disabling the whole AI feature?
