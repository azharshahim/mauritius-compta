# Journal des versions

## Correctif mission 9 — sélection des fichiers sur Samsung Android (31 octobre 2026)

> Corrige le grisement des CSV/TSV/TXT/XLSX dans le sélecteur Android des
> modules Banque et Migration. Aucune modification du moteur comptable, du
> rapprochement ou des règles IA.

### Corrigé

- Politique d'upload commune `apps/web/src/lib/upload.ts` (Banque + Migration).
- `accept` élargi : `.csv`, `.tsv`, `.txt`, `.xlsx` et MIME Android
  `text/*`, `text/csv`, `text/comma-separated-values`,
  `text/plain`, `application/vnd.ms-excel`, XLSX OOXML, ZIP,
  `application/octet-stream`.
- Validation après sélection conservée : extension insensible à la casse,
  fichier vide/plafond, puis validation du contenu par le moteur d'import.
- Message explicite pour un format refusé ; input réinitialisé pour permettre
  la resélection du même fichier.
- Tests : `upload-policy.test.ts` (6), UI Banque (3), UI Migration (3
  assertions d'`accept`). Web : **123 réussis / 13 fichiers**.

### Limite

Aucun appareil Samsung/Android physique dans l'environnement : le filtre MIME
natif n'est pas rejoué par jsdom. Le parcours manuel reste à confirmer sur le
téléphone après déploiement Pages.

## Mauritius Business Suite — 31 octobre 2026 (mission 9)

> Import bancaire, rapprochement comptable et ergonomie Android. Aucune
> connexion bancaire réelle, aucune donnée réelle, aucun fournisseur IA activé,
> aucune PR fusionnée.

### Ajouté — Banque & rapprochement

- Comptes bancaires par société (banque, devise, référence masquée, compte
  d'actif associé), historique des imports et transactions.
- Import CSV, TSV/TXT et XLSX via le parseur de la mission 8 ; 20 codes
  d'anomalie explicites, soldes et successions contrôlés en décimal exact.
- Prévisualisation **sans écriture**, confirmation humaine obligatoire,
  idempotence par empreinte fichier et par identifiant métier.
- Rapprochement 1↔1 et 1↔n avec montant exact, fenêtre de dates, référence,
  facture et libellé ; statuts distincts proposition/rapprochement.
- Propositions comptables postées uniquement après acceptation humaine, via le
  moteur `postEntryTx` existant ; aucun second moteur comptable.
- Suggestions déterministes depuis le plan comptable actif, règles versionnées,
  désactivables et auditables ; salaires proposés sans calcul de paie ; aucun
  compte inventé. Aucun second moteur IA et aucun fournisseur activé.
- Rapport de rapprochement (soldes, rapprochés/non rapprochés, écarts,
  explications) et export CSV ; PDF bancaire **non implémenté**.
- Cas complexes bloqués et documentés : n↔1, paiement partiel, écart de change.

### Ajouté — Démonstration et mobile

- Démo Pages : deux comptes fictifs (MUR/EUR), transactions, factures et
  écritures existantes, quatre relevés fictifs (`releve-bancaire-fictif.csv`,
  `.xlsx`, `-doublons.csv`, `-erreurs.csv`), règles et rapport local.
- Le grand bandeau fixe bas est remplacé par un **indicateur Démo compact**
  dans l'en-tête, toujours visible, avec explication et réinitialisation ;
  l'identification complète reste sur l'écran de connexion. Safe-areas et
  pastille IA préservées.
- Schéma localStorage porté à **7**.

### Base de données et tests

- Migration additive `0009_bank.sql` : sept tables, audit append-only.
- API : **213 réussis, 4 ignorés** (dont 28 tests bancaires) ; web :
  **116 réussis** (12 fichiers) ; typecheck 0 erreur ; build démo OK.
- CI PostgreSQL réel : vérification des sept tables `bank_*` après migration
  et ré-application idempotente.
- CI mission 9 : runs `41192173639` (push) et `41192178271` (PR) verts ;
  Pages `41192173531` vert (déploiement + vérifications HTTPS).
- Limites non revendiquées : OFX/QFX, PDF/OCR, connexion bancaire, PDF du
  rapport, tests Chrome/Android réels, conformité MRA.

## Mauritius Business Suite — 31 octobre 2026 (mission 8)

> Assistant de migration comptable (Excel/CSV, profils Sage et SAP expérimentaux).
> Aucune seconde base comptable, aucun moteur comptable réécrit, aucune
> certification Sage/SAP, aucune PR fusionnée.

### Ajouté — Assistant de migration en six étapes

- Cabinet → **Importation & migration** : source, téléversement, correspondances
  de colonnes et de comptes, contrôles, prévisualisation, validation humaine.
- Formats réels : `.csv`, `.tsv`, `.txt`, `.xlsx` multi-feuilles ; encodages
  UTF-8/BOM, UTF-16 et Windows-1252 ; délimiteurs `,` `;` tabulation ; montants
  et dates FR/EN ; **aucune macro ni formule exécutée**.
- Profils **Sage 50 / 200 / Accounting** et **SAP** marqués *expérimental* :
  fichiers d'export uniquement, aucune connexion, aucune compatibilité
  universelle, aucun nom d'éditeur utilisé comme certification.
- Plan comptable, soldes d'ouverture, journaux, écritures, clients, sociétés
  (BRN/CRN) ; factures historiques et paie **non reprises**.
- Contrôles bloquants vs avertissements : dates, montants, équilibre **par
  écriture**, comptes inconnus/doublons, devises et taux, période comptable,
  doublons et réimports. Aucune contrepartie fabriquée, aucun compte inventé.
- Écritures et soldes d'ouverture créés **via le moteur comptable existant** :
  numérotation, période ouverte, audit et balance inchangés.
- Idempotence par clé `cabinet + société + source + document + empreinte` ;
  réimport = tout ignoré, conflit = aucune écriture, jamais d'écrasement.
- Modèles de correspondance par cabinet, société et type d'import.
- Rapport d'import téléchargeable (CSV échappé contre l'injection), audit
  `migration_events`, purge après `MIGRATION_RETENTION_DAYS` (30 jours).
- Assistant IA : outil **lecture seule** `migration.jobs.summary` (API et démo)
  qui explique les formats et l'état des lots sans jamais confirmer un import.

### Ajouté — Démonstration Pages

- Écran complet avec 9 fichiers d'exemple **fictifs** téléchargeables (plan
  comptable CSV/XLSX, balance d'ouverture, journal FR/EN, exports Sage et SAP
  fictifs, fichier volontairement incorrect), stockés dans `localStorage`
  (schéma 6) avec bannière permanente et réinitialisation.
- Parcours jsdom des six étapes, du blocage d'un fichier incorrect et de la
  version anglaise ; aucun appel réseau, aucune donnée réelle.

### Base de données et tests

- Migration additive `0008_migration.sql` : `migration_jobs`, `uploads`,
  `templates`, `findings`, `batches`, `records`, `events`.
- API : **185 réussis, 4 ignorés** (dont 23 tests de migration) ;
  web : **97 réussis** (10 fichiers) ; typecheck strict 0 erreur ; build démo OK.
- CI PostgreSQL réel : les 20 scénarios obligatoires de migration sont exécutés
  (CSV FR/EN, XLSX multi-feuilles, colonnes manquantes, dates invalides,
  négatifs, déséquilibre, compte inconnu, doublons, réimport, reprise,
  ouverture, multi-devises, permissions, lot multi-sociétés, confirmation,
  absence d'écriture en prévisualisation, non-régression).

### Corrigé pendant la mission

- Détection de colonnes : score borné par mot et exclusion des en-têtes
  d'indicateur (évite « Description » au lieu d'« Intitulé »).
- Indicateur débit/crédit SAP : convention `S = Soll = débit`, `H = Haben =
  crédit`, relu **par ligne** (test de non-régression dédié).
- Parité démo/API : la liste des écritures expose la même colonne `source`.

## Mauritius Business Suite — 31 octobre 2026 (mission 7)

> Assistant IA universel, paramètres société et TVA configurable. Aucun module
> existant réécrit, aucune paie mauricienne calculée, aucun second moteur IA,
> aucune PR fusionnée.

### Ajouté — Assistant IA universel

- Pastille « ✨ Assistant IA » sur tous les écrans authentifiés des quatre modules ;
  panneau latéral sur ordinateur, feuille plein écran sur Android (safe-areas,
  composeur visible, chargement différé), survit aux changements de module sans
  perdre une saisie ni rouvrir le clavier.
- Contexte construit **côté serveur** (société re-vérifiée, module, écran, langue,
  permissions, référence d'objet) ; un `companyId` du navigateur n'est jamais cru.
- Registre d'outils en lecture seule (cabinet, facturation, comptabilité, paie),
  contrôle de permission à chaque appel, arguments validés, audit et rétention
  configurable (30 jours par défaut).
- Préparation d'écriture uniquement en **proposition brouillon** via l'Assistant V2
  existant : aucune comptabilisation, aucun outil irréversible.

### Ajouté — Paramètres société et TVA

- Écran unique accessible depuis Cabinet → Fiche société → Paramètres et depuis
  Comptabilité → Paramètres société : identification, comptabilité, facturation,
  fiscalité, historique.
- TVA : quatre traitements distincts (taxable / taux zéro / exonéré / hors champ),
  compte de TVA, vérification humaine sourcée et confirmée, historique append-only,
  taux gelé dès qu'un document émis l'utilise, aucun taux seedé.
- Migration additive `0007_assistant_settings_vat.sql` ; verrous d'exercice et de
  devise en présence d'écritures.

### Démonstration

- Schéma de stockage local **5** ; assistant réellement interactif branché sur les
  données fictives existantes, TVA 15 % de démonstration **non vérifiée**, aucun
  appel réseau, bandeau permanent.

### Tests

- API : 162 réussis, 4 ignorés (concurrence PostgreSQL réel). Web : 81 réussis.
  `typecheck` 0 erreur. Build démo : panneau en chunk séparé.

## Mauritius Business Suite — 31 octobre 2026 (mission 6)

> Facturation de bout en bout + assistant comptable V2. Cœur comptable et correctif clavier
> Android conservés ; Paie & RH inchangée.

### Ajouté — Facturation

- Clients (CRUD, archivage, BRN/TVA/adresse/contacts/devise/conditions/compte collectif),
  articles FR/EN, devis convertibles, factures, avoirs partiels, encaissements multi-factures
  avec trop-perçu, solde client, balance âgée, détection déterministe de doublons.
- Numérotation séquentielle atomique par société/type/année (`billing_number_sequences`),
  verrouillage après émission, brouillon modifiable, audit de chaque étape.
- PDF A4 FR/EN réellement générés par le serveur (`pdfkit`) : devis, factures, avoirs, reçus.
- Aucun taux de TVA seedé : un taux daté et vérifié par un professionnel est requis
  (`VAT_NOT_CONFIGURED`, `VAT_RATE_NOT_VERIFIED`, `VAT_RATE_NOT_APPLICABLE`).
- E-invoicing MRA : **désactivé**, aucun envoi, aucune conformité revendiquée.

### Ajouté — Assistant comptable V2

- Proposition d'écriture complète (journal, date, libellé, référence, devise, taux, lignes
  débit/crédit, justification, manques, alertes) sur neuf scénarios, comptes limités au plan
  comptable réel.
- Douze contrôles avant validation (équilibre, comptes, journal, exercice, date, devise/taux,
  TVA, droits, doublon, société, document source, double comptabilisation).
- Cycle strict Proposition → Vérification → Validation humaine → Comptabilisation ;
  `validate` ne crée jamais d'écriture, `post` est une action distincte et unique.
- Règles déterministes (six types) : priorité, versions, désactivation, historique, isolation
  par société, explication de la règle utilisée, aucun conflit appliqué en silence.
- Intégration Facturation → Comptabilité : propositions déterministes depuis les documents,
  comptabilisation via le moteur comptable, traçabilité bidirectionnelle, idempotence garantie
  par la base (référence unique, `accounting_entry_id` unique, verrous `FOR UPDATE`).

### Ajouté — Interface et démonstration

- Écrans `/billing` (tableau de bord, clients, devis, factures, avoirs, encaissements, balance
  âgée) et `/cabinet/ai-proposals` (proposition éditable, contrôles, valider/rejeter/
  comptabiliser, règles).
- Démo GitHub Pages : schéma 4 avec facturation réelle, propositions, règles ; `localStorage`
  uniquement, aucune clé, aucun appel externe, **aucun PDF simulé présenté comme réel**
  (`PDF_NOT_AVAILABLE_IN_DEMO`).

### Tests

- API : 139 réussis / 4 ignorés (PostgreSQL réel). Web : 60 réussis, dont 13 nouveaux cas
  facturation + assistant de la démo et un test d'écran « aucune écriture automatique ».
- CI et publication Pages vertes (`41156378284`, `41156382220`, `41156378229`).

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
