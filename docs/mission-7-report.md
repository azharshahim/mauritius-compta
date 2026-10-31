# Rapport de mission 7 — Assistant IA universel, paramètres société et TVA configurable

> Dépôt : `azharshahim/mauritius-compta` (seul dépôt utilisé).
> Aucune PR fusionnée, `main` intacte, aucune dépense, aucune donnée réelle,
> aucun fournisseur IA réel activé, aucun déploiement OVH.

## 1. Branche et commit

- Branche : `arena/b0b62798-mauritius-compta` (branche de développement suivie par la PR nº1).
- Commit de code de la mission : **`22f643b`** — `feat(mission-7): assistant IA
  universel, paramètres société et TVA configurable`.
- Commit de documentation : celui qui ajoute ce fichier (têtes de branche
  visibles dans l'historique GitHub ; aucun commit sur `main`).
- `main` reste à `9e46f16` : la mission n'a pas modifié la branche principale.

## 2. PR nº1

- PR nº1 : https://github.com/azharshahim/mauritius-compta/pull/1 — **OPEN**,
  **brouillon**, **non fusionnée**.
- Aucune autre PR n'a été créée ; aucun release.

## 3. Migrations

Migration additive et idempotente **`0007_assistant_settings_vat.sql`** (les
migrations 0001–0006 ne sont pas modifiées) :

1. `companies` : `trade_name`, `contact_name`, `contact_email`, `contact_phone`.
2. `billing_settings` : langue des documents, logo, six comptes par défaut
   (produits, clients, banque, achats, TVA récupérable, TVA collectée).
3. `billing_tax_rates` : `treatment` (`taxable`/`zero_rated`/`exempt`/
   `out_of_scope`), `vat_account_id`, `verified_at`, `verified_by`, contraintes
   (période, plage 0–100, pourcentage interdit hors `taxable`).
4. `billing_tax_rate_events` : historique append-only (action, acteur,
   avant/après, horodatage).
5. `ai_conversations`, `ai_messages`, `ai_tool_runs` : sessions, historique borné,
   exécutions d'outils avec statut, code d'erreur, nombre de lignes et durée.

Vérifiée par `npm test -w @mc/api` (les migrations sont appliquées sur PGlite à
chaque suite) et par `tests/migrations.test.ts`. **Aucun taux n'est seedé par la
migration.**

## 4. Pastille et mobile

- Pastille flottante « ✨ Assistant IA » montée **hors des routes**
  (`AssistantLauncher`), donc présente sur **tous** les écrans authentifiés des
  quatre modules et persistante lors des navigations.
- Ordinateur : panneau latéral bas-droite, fermable, `Échap` pris en charge,
  `aria-expanded`/`aria-controls`, boutons accessibles au clavier.
- Téléphone : feuille plein écran `100dvh`, safe-areas, composeur collé en bas,
  bouton à portée de pouce, aucun débordement horizontal ajouté.
- **Aucun focus forcé** : ouvrir le panneau ne déplace pas le curseur et ne
  rouvre pas le clavier virtuel (test jsdom dédié).
- Chargement différé : le panneau est un chunk séparé
  (`dist/assets/AssistantPanel-*.js`, 3,27 kB) ; la pastille reste dans le bundle
  principal.
- Fermeture/réouverture : conversation et brouillon conservés ; changement de
  société = nouvelle conversation.

## 5. Outils réels (lecture seule)

Cabinet : `cabinet.companies`, `cabinet.tasks.open`, `cabinet.tasks.overdue`,
`cabinet.deadlines`.
Facturation : `billing.invoices.search`, `billing.invoices.unpaid`,
`billing.customers.balance`, `billing.payments.recent`,
`billing.approvals.pending`.
Comptabilité : `accounting.accounts.search`, `accounting.trialBalance`,
`accounting.proposal.check`, `accounting.proposal.prepare`.
Paie & RH : `payroll.status` (explique l'indisponibilité).

Tous lisent les tables de la **société active**, après contrôle des permissions
**à chaque appel** (`docs/ai-tool-permissions.md`). Aucune donnée de paie n'est
lue ni inventée.

## 6. Fonctions simulées (démo uniquement)

Dans le build GitHub Pages (`apps/web/src/demo/runtime.ts`, schéma **5**) :

- conversation **réellement interactive** servie par le backend de démonstration
  navigateur, branchée sur les données fictives existantes (factures
  `FAC-DEMO-0001`/`FAC-DEMO-0002`, tâches, plan comptable, balance) ;
- mêmes routes que l'API (`/ai/assistant/*`), même logique d'intentions ;
- cas pris en charge : factures impayées, recherche de facture, solde client,
  encaissements, tâches (dont retards), échéances, sociétés, recherche de compte,
  balance, vérification de proposition, préparation d'écriture, état de la paie ;
- refus explicite sinon ;
- **aucun fournisseur, aucune clé, aucun appel réseau** : un test vérifie que
  `fetch` n'est jamais sollicité ;
- bandeau permanent de démonstration et mention « aucun fournisseur externe
  connecté » dans le panneau.

Ce qui n'est **pas** simulé : le backend réel (PostgreSQL, permissions, audit,
migrations) est couvert par les tests API.

## 7. Paramètres société accessibles

- Cabinet → Dossiers clients → Fiche société → **Paramètres société**
  (`/cabinet/companies/:companyId/settings`).
- Comptabilité → Paramètres → lien **Paramètres société**
  (`/accounting/settings/company`).
- Un seul composant, une seule route de lecture
  (`GET /companies/:companyId/settings/company`), un seul référentiel.
- Sections : Identification, Comptabilité, Facturation, Fiscalité + historique
  des changements.
- Écritures réservées aux administrateurs du module concerné, journalisées ;
  verrou d'exercice et de devise si des écritures existent ; comptes par défaut
  validés contre le plan comptable.

## 8. TVA et contrôles

- Quatre traitements **distincts** (taxable, taux zéro, exonéré, hors champ) avec
  contrainte base + applicatif interdisant un pourcentage hors `taxable`.
- Vérification humaine : `POST …/tax-rates/:id/verify` avec `confirm: true` et
  source documentée ; enregistre validateur et date ; historique append-only.
- Aucun taux seedé en production ; un taux non vérifié **ne peut pas** servir à
  une facture fiscale (`VAT_RATE_NOT_VERIFIED`).
- Taux **gelé** dès qu'un document émis l'utilise (`409 VAT_RATE_LOCKED`) ;
  notes et vérification restent possibles et journalisées.
- L'IA ne peut ni créer ni vérifier un taux : aucune route de vérification dans
  le registre d'outils.
- Démo : taux 15 % **fictif et non vérifié** (`DEMO-15`), clairement étiqueté.

## 9. Exemple obligatoire (3 250 MUR)

Achat de marchandises **3 250,00 HT**, TVA de démonstration **15 %** :

| Compte | Débit | Crédit |
| --- | --- | --- |
| Achats de marchandises | 3 250,00 | |
| TVA récupérable | 487,50 | |
| Banque | | 3 737,50 |

- Total débit = total crédit = **3 737,50** (équilibré).
- Comptes issus du plan comptable réel du dossier ; si un compte manque,
  l'assistant le signale et demande un choix humain.
- Résultat : **proposition** au statut `proposed`, aucune écriture comptable
  (`journal_entries` inchangé) ; validation et comptabilisation restent des
  actions humaines séparées.
- Vérifié en API (`tests/assistant.test.ts`) et en démonstration
  (`tests/demo-assistant.test.ts` : `3250.0000`, `487.5000`, `3737.5000`).

## 10. Tests exécutés (résultats exacts)

Commandes exécutées localement dans le sandbox :

| Commande | Résultat |
| --- | --- |
| `npm test -w @mc/api` | **162 réussis, 4 ignorés** (14 fichiers, 4 cas de concurrence nécessitant un PostgreSQL réel) |
| `npm test -w @mc/web` | **81 réussis** (8 fichiers) |
| `npm run typecheck` | **0 erreur** (API + web, y compris `tsconfig.test.json`) |
| `npm run build:demo` | OK — `index-*.js` 704,70 kB (gzip 192,71 kB), `AssistantPanel-*.js` 3,27 kB, CSS 20,04 kB |

Nouveaux tests de la mission :

- API `tests/assistant.test.ts` (23 cas) : contexte serveur, rejet d'une société
  non autorisée, outil non accordé (`denied`), factures impayées réelles, tâches
  en retard, recherche de compte, balance, paie indisponible, préparation en
  brouillon sans comptabilisation, absence de montant, conversation privée,
  suppression, refus explicite, messages invalides, paramètres société
  (identification, verrou d'exercice, comptes par défaut), TVA (source requise,
  traitements distincts, historique, refus d'un taux non vérifié, gel après
  émission).
- Web `tests/demo-assistant.test.ts` (13 cas), `tests/assistant-ui.test.tsx`
  (5 cas : pastille dans les 4 modules, réponse sur données fictives, `Échap`,
  conservation de la conversation après navigation, focus jamais volé),
  `tests/company-settings-ui.test.tsx` (3 cas : accès depuis les deux chemins,
  quatre sections, taux 15 % non vérifié + source obligatoire).

Tests **non réalisés** (documentés, non revendiqués) :

- Aucune session navigateur réelle (Chrome/Android) : le sandbox n'a pas de
  Chromium ; les tests UI sont exécutés en jsdom.
- Aucun test sur appareil Samsung physique pour cette mission ; le correctif
  clavier de la mission 5 reste couvert par `tests/input-focus.test.tsx`.
- Aucun test de charge, aucun test multi-instance.

## 11. GitHub Actions

- Workflows `CI` et `Demo (GitHub Pages)` : voir la section « Statut des
  exécutions » ci-dessous (complétée après le push).
- Le smoke test Pages vérifie désormais dans le bundle publié : `Assistant IA`,
  `Paramètres société`, `Taux de démonstration 15`, `VAT_SOURCE_REQUIRED`,
  `SETTINGS_FINANCIAL_YEAR_LOCKED`, `assistant-panel`, et la présence du chunk
  différé `AssistantPanel-*.js` au build.

## 12. GitHub Pages

- Démo : https://azharshahim.github.io/mauritius-compta/
- Schéma de stockage local passé à **5** : les anciennes données de démo
  (schéma 4) sont rechargées à partir du jeu fictif mis à jour.
- Publication limitée à la démonstration fictive ; aucun backend déployé.

## 13. Sécurité

- Isolation cabinet/société : société re-vérifiée côté serveur à chaque
  conversation et chaque outil ; cabinet dérivé de la base.
- Conversations privées par utilisateur et par société (lecture d'une
  conversation d'autrui → `404`), suppression possible par l'auteur.
- Permissions par module contrôlées à chaque appel ; refus journalisé.
- Anti-injection : routeur déterministe, aucun texte utilisateur vers un modèle,
  arguments validés par Zod, références d'objet vérifiées en base.
- Limites : 600 caractères par message, 40 messages par conversation,
  120 messages/heure/utilisateur, rétention configurable (30 jours par défaut).
- Aucune clé exposée, aucun credential dans le panneau, aucun accès paie non
  autorisé, aucun outil irréversible.
- Journalisation minimisée : audit des actions + exécutions d'outils, sans secret
  ni donnée de paie.

## 14. Registre réglementaire

`docs/regulatory-review-register.md` : 14 lignes (TVA, e-invoicing, paie
PAYE/CSG/NSF, déclarations, IFRS, BRN/CRN, conservation, TDS, immobilisations)
au statut **À VÉRIFIER**, sans avis professionnel, sans source officielle
fournie. **Aucune validation professionnelle n'est revendiquée.**

## 15. Limites et anomalies connues

- Routeur d'intentions déterministe : une formulation très éloignée des motifs
  prévus reçoit une réponse « non prise en charge » (choix de sécurité).
- Pas de compréhension d'un texte libre par un fournisseur : aucune génération
  de langage dans cette mission.
- La page Paramètres société ne crée/ne clôture pas de période (routes existantes).
- Le chunk principal dépasse 500 kB (avertissement Vite) : la démo reste
  fonctionnelle, l'assistant est déjà code-splitté.
- Aucun test navigateur réel, aucun test sur appareil physique.
- `GET /companies/:id/settings` (clé/valeur, historique) reste en place pour
  compatibilité ; le nouveau référentiel est `GET /companies/:id/settings/company`.
- Une incohérence de libellé de navigation (« Dossiers clients ») a été rencontrée
  dans les tests UI : corrigée côté test, aucun changement fonctionnel.

## 16. Recommandations pour la mission 8

1. Faire **vérifier les lignes TVA et Paie** du registre par un expert-comptable
   avec sources officielles datées, puis activer les calculs correspondants.
2. Ajouter un outil `billing.invoice.draft` (émission en brouillon, sans
   numérotation) et un outil `documents.toReview`, toujours sans action
   irréversible.
3. Implémenter un vrai fournisseur IA **optionnel** derrière le moteur existant,
   avec un contrat strict « données minimales » et un mode désactivé par défaut.
4. Ajouter des tests navigateur réels (Playwright/Chromium) dans une CI dédiée,
   dont un profil mobile Android.
5. Étendre l'historique TVA à l'export (CSV/PDF) et à la comparaison de versions.
6. Traiter la dette du chunk principal (> 500 kB) par un découpage par module.

---

### Statut des exécutions

| Workflow | Exécution | Commit | Résultat |
| --- | --- | --- | --- |
| `CI` (push) | `41184028275` | `4580910` | ✅ |
| `CI` (pull request nº1) | `41184024587` | `4580910` | ✅ |
| `Demo (GitHub Pages)` | `41183941018` | `22f643b` | ✅ (smoke test mission 7 inclus) |

- Les deux exécutions `CI` du commit de code `22f643b` (`41183941019`,
  `41183945304`) ont été **annulées** par la concurrence du workflow lors du push
  de la documentation ; les exécutions finales ci-dessus portent sur la tête de
  branche et sont vertes.
- `Demo (GitHub Pages)` ne se déclenche pas sur un commit de documentation seule
  (`paths: apps/web/**`) : la démonstration publiée correspond donc au commit de
  code `22f643b`, dont le smoke test vérifie la pastille, l'écran Paramètres
  société, le taux de démonstration 15 % et les codes TVA.
- PR nº1 : `OPEN`, `isDraft=true`, `arena/b0b62798-mauritius-compta → main` ;
  `main` reste à `9e46f16`.
