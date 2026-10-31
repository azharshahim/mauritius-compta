# Journal des versions

## Mauritius Business Suite — 31 octobre 2026 (mission 5)

> Correctif Android + moteur IA multi-fournisseurs. Cœur comptable 0.1.1 conservé.

### Corrigé — clavier Android (Samsung)

- Le champ de saisie perdait le focus après **chaque caractère**, ce qui refermait le
  clavier virtuel : l'effet de gestion du focus de `Modal` dépendait de `onClose`,
  recréé à chaque rendu par les formulaires. Chaque frappe relançait l'effet et déplaçait
  le focus vers la boîte de dialogue.
- `onClose` est désormais conservé dans une ref : l'effet ne dépend plus que de `open` ;
  le focus n'entre dans le dialogue que s'il est ailleurs, et ne revient à l'élément
  déclencheur qu'à la fermeture.
- Champs à 16 px sur mobile (évite le zoom automatique de Chrome Android) et hauteur de
  modale en `dvh` quand le clavier est ouvert.
- 10 tests de non-régression saisissent caractère par caractère dans tous les formulaires
  (connexion, recherche dossier, création/modification de dossier, tâche, écriture,
  plan comptable, paramètres comptables, tiroir mobile) et vérifient que le nœud garde le
  focus et reste monté.

### Ajouté — Mauritius AI Engine

- Module `apps/api/src/modules/ai/` : interface `AIAdapter`, registre, adaptateurs OpenAI
  (OpenAI, DeepSeek, Mistral, compatible), Gemini et fournisseur fictif déterministe.
- Catalogue `apps/api/config/ai-providers.json` : URL, modèles, capacités et tarifs
  externalisés ; aucun tarif inventé (`pricing: []`).
- Clés API **BYOK** chiffrées en base (AES-256-GCM, clé dédiée, AAD cabinet + fournisseur,
  rotation par version de clé), jamais retournées, jamais journalisées.
- Budgets : consommation par cabinet/fournisseur/modèle/module, budget mensuel, plafond de
  requêtes, seuil d'alerte, blocage serveur, coût exact en arithmétique entière, coût
  « indisponible » sans tarif daté.
- Sélection manuelle ou automatique (refusée sans tarifs vérifiés), fournisseur de secours,
  timeouts, tentatives limitées, limitation de débit, journal d'audit et journal d'appels
  sans contenu.
- Cas d'usage opérationnel : **assistant de suggestion de compte** contraint au plan
  comptable réel de la société, décision humaine (accepter / corriger / refuser), règles
  réutilisables par dossier, **aucune écriture comptable créée**.
- Écrans Cabinet → Paramètres IA et Cabinet → Assistant comptable, bilingues FR/EN.
- Migration `0005_ai.sql` (additive) : `cabinets`, `ai_settings`, `ai_credentials`,
  `ai_usage`, `ai_suggestions`, `ai_account_rules`, `ai_request_log`, `ai_prices`.
- Démonstration GitHub Pages : moteur IA **entièrement simulé**, aucune clé acceptée, aucun
  appel réseau, coût « indisponible », bandeau « Simulation IA — aucune API externe utilisée ».
- Documentation : `docs/ai-architecture.md`, `ai-providers.md`, `ai-security.md`,
  `ai-cost-control.md`, `ai-account-suggestions.md`, `docs/mission-5-report.md`.

### Ajouté — préparé (non opérationnel)

- Contrats des automatisations futures (OCR factures, relevés bancaires, rapprochement,
  classement documentaire, anomalies de facturation, variables de paie, états financiers)
  exposés et renvoyant explicitement `501 NOT_IMPLEMENTED`.
- Mode « IA incluse dans l'abonnement » : colonne présente, contrainte à `false`.

## Mauritius Business Suite — 31 octobre 2026 (mission 4)

> Ajout fonctionnel sans changement de version applicative (cœur comptable 0.1.1 conservé).

### Ajouté — module Cabinet (opérationnel)

- Tableau de bord cabinet : sociétés clientes, dossiers actifs/archivés, dossiers à réviser,
  tâches à effectuer, en retard, échéances sous 7 jours, collaborateurs, activité récente.
- Dossiers clients : recherche, filtres, création, modification (BRN, CRN, TVA, adresse,
  activité, devise, exercice, responsable, code client), archivage/désarchivage en lecture
  seule, fiche dossier complète.
- Tâches et échéances : catégories, priorités, statuts, affectation contrôlée à un membre,
  commentaires, historique d'audit, filtres « en retard ».
- Collaborateurs : rôles par dossier, activation, consultation des droits par module.
- Migration `0004_cabinet.sql` (additive) : champs dossier, rôles étendus, table
  `company_module_access`, `cabinet_tasks`, `cabinet_task_comments`, triggers d'isolation.
- Permissions par module (`cabinet`, `accounting`, `billing`, `payroll`) avec séparation
  stricte paie/comptabilité, appliquées côté API **et** dans les requêtes SQL.

### Ajouté — préparé (non opérationnel)

- Espaces **Facturation** et **Paie & RH** : navigation, sous-menus, écrans d'annonce,
  capacités explicitement affichées comme non disponibles.
- Tables de fondation `billing_documents` (avec `accounting_entry_id UNIQUE` empêchant la
  double comptabilisation) et `payroll_employees` (aucune donnée salariale, aucun calcul).
- Contrats d'intégration documentés (`docs/module-integration.md`).

### Modifié

- Interface réorganisée en quatre espaces avec barre de modules, sous-menus contextuels et
  sélecteur de société ; anciennes routes conservées via redirections.
- Mode démonstration : 4 dossiers fictifs, 3 collaborateurs fictifs, 9 tâches, permissions
  par module, archivage lecture seule, écrans Cabinet réellement utilisables.

### Correctifs liés

- Un dossier archivé refuse désormais toute écriture (`COMPANY_ARCHIVED`, 409) tout en restant
  consultable et exportable.

## Mode démonstration — 31 octobre 2026 (GitHub Pages, sans serveur)

> Ajout fonctionnel sans changement de version applicative : le backend et l'API restent en
> 0.1.1, le mode démonstration est un build distinct de la même interface.

### Ajouté

- **Démonstration publique hébergée sur GitHub Pages** depuis la branche de développement,
  sans fusion de la PR ni modification de `main`.
- **Backend simulé dans le navigateur** (`apps/web/src/demo/runtime.ts`) : mêmes appels que
  l'API (auth, sociétés, comptes, journaux, écritures, périodes, taux, rapports, membres,
  audit), servis depuis `localStorage` avec une arithmétique décimale exacte (`BigInt`).
- **Jeu de données fictif reproductible** : société `Lagon Bleu Trading Ltd (DEMO)`,
  35 comptes, 5 journaux, 9 écritures (brouillon + contrepassation incluses).
- **Bandeau permanent « MODE DÉMONSTRATION »** + réinitialisation des données locales, et
  identifiants de démonstration pré-remplis sur la page de connexion.
- **Routage par hash** et base `/mauritius-compta/` en mode démo, `404.html` pour les liens
  profonds.
- **Exports CSV** calculés localement (BOM UTF-8, `;`, neutralisation des formules) ; le PDF
  ouvre l'impression du navigateur.
- **Tests web jsdom** (19) : moteur comptable, parcours React complets, formatage.
- Workflow `.github/workflows/pages.yml` (build + tests + déploiement Pages).

### Corrigé

- **Règles des hooks React** : `App` déclarait des `useEffect` après des retours anticipés ;
  le routeur plantait au changement d'état de session (détecté par les tests jsdom).
- **Date d'écriture proposée** : la modale propose désormais une date couverte par une
  période ouverte, au lieu de la date du jour hors exercice (`PERIOD_CLOSED` évitable).

## 0.1.1 — 30 octobre 2026 (audit, fiabilisation)

### Corrigé — comptabilité

- **Bilan équilibré en cours d'historique** : le Statement of Financial Position utilisait le
  résultat de la période au lieu du résultat cumulé depuis l'origine (bilan faux dès que la
  période analysée commençait après les premières écritures).
- **Changement de devise d'un brouillon** : un taux daté est désormais exigé ; l'ancien taux
  (souvent 1) n'est plus réutilisé silencieusement.
- **Devises** : seules MUR, EUR, USD et GBP sont acceptées (`INVALID_CURRENCY`).
- **Précision** : les montants à plus de 4 décimales sont refusés au lieu d'être arrondis.
- **Montants convertis** : un montant qui s'arrondit à zéro en devise fonctionnelle est refusé.
- **Numérotation** : un brouillon déplacé vers un autre journal ou exercice est renuméroté.
- **Références** : unicité par société, insensible à la casse (`REFERENCE_TAKEN`).
- **Validation** : les comptes sont revérifiés (société + activation) au moment de la validation.
- **Grand livre** : les comptes désactivés conservant des mouvements restent visibles.
- **Sociétés** : une période comptable est toujours créée, même sans plan comptable de
  démonstration (auparavant aucune écriture n'était possible).
- **Taux de change** : validation en HTTP 400 (au lieu de 409) ; taux inverse calculé en
  arithmétique entière (8 décimales).

### Corrigé — sécurité et intégrité

- **Pièces jointes** : vérification de la signature binaire (PDF/JPEG/PNG) et rejet des fichiers
  vides ; suppression des fichiers lorsqu'un brouillon est supprimé.
- **Injection de formules CSV** : les cellules commençant par `=`, `+`, `-`, `@` sont neutralisées.
- **Contrepassation unique** : index unique partiel (protection contre une course).
- **Isolation société en base** : triggers sur les écritures, contrepassations, pièces jointes et
  comptes parents.
- **Journal d'audit append-only** : modifications et suppressions refusées par PostgreSQL.
- **Sessions** : purge des sessions expirées et des anciennes tentatives, limitation par adresse
  IP en plus du compte, comparaison de hachage systématique à la connexion (anti-énumération).
- **Changement de mot de passe** : toutes les sessions sont invalidées et l'interface invite à se
  reconnecter.
- **Production** : inscription fermée par défaut, `db:seed` refusé (sauf `ALLOW_DEMO_SEED=true`).

### Amélioré — interface

- Édition des brouillons depuis l'interface (bouton « Modifier le brouillon »).
- Formatage monétaire exact (BigInt) et contrôle d'équilibre sans virgule flottante.
- Modales : fermeture par Échap, gestion du focus, bouton de fermeture traduit.
- Navigation mobile : tiroir refermé à la navigation, par Échap ou clic extérieur.
- Messages d'erreur supplémentaires traduits FR/EN.

### Ajouté

- `apps/api/sql/migrations/0003_hardening.sql` (intégrité et index).
- `tests/regressions.test.ts` (17 tests de non-régression).
- `tests/concurrency.test.ts` (4 tests, PostgreSQL réel).
- Tâche CI `API tests against real PostgreSQL`.
- Tests navigateur Playwright + `docs/browser-tests.md` (**non exécutés** dans l'environnement
  d'audit).
- `docs/audit-v0.1.1.md`, `docs/github-project-integrity.md`, `CHANGELOG.md`, `.nvmrc`,
  `.editorconfig`.
- README réécrit : installation Windows/Linux, PostgreSQL, mode démonstration, tests,
  reconstruction, limites réglementaires, dépannage.

### Notes

- Aucun déploiement, aucune fusion de PR : le propriétaire conserve la décision.
- Les règles réglementaires restent marquées « À VÉRIFIER » / « NON IMPLÉMENTÉ ».

## 0.1.0 — 30 octobre 2026

- Première version : sociétés, plan comptable, journaux, écritures, grand livre, balance, états
  financiers provisoires, exports CSV/PDF, FR/EN, migrations PostgreSQL, CI.
