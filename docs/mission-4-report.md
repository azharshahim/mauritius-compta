# Rapport de mission Nº4 — « Mauritius Business Suite »

**Date** : 31 octobre 2026
**Branche** : `arena/b0b62798-mauritius-compta` (aucune branche dédiée supplémentaire n'a pu être créée — voir §11)
**Pull request** : [#1](https://github.com/azharshahim/mauritius-compta/pull/1) — **brouillon, non fusionnée**, base `main` intacte
**Dernier commit fonctionnel** : `fb97bc0` (interface) + `ce1da60` (API) + `0f485e7` (documentation) + `6e0e2ca` (vérification CI)

Objectif de la mission : faire évoluer *Mauritius Compta* (comptabilité mauricienne V0.1.1) en une suite
mauricienne à **quatre espaces** partageant **une seule base PostgreSQL** et un référentiel commun de
sociétés et d'utilisateurs, avec le **module Cabinet réellement utilisable** en priorité absolue.

---

## 1. Périmètre livré en un coup d'œil

| Espace | Statut | Nature |
|---|---|---|
| **CABINET** | **Implémenté et utilisable** | API + SQL + UI + démo : dossiers clients, équipe, tâches et échéances, tableau de bord, fiche dossier |
| **COMPTABILITÉ** | Conservé, réintégré dans la suite | Toutes les fonctions V0.1 (plan comptable, journaux, écritures, grand livre, balance, états financiers, multidevise, audit) + sous-menus futurs annoncés |
| **FACTURATION** | **Préparé** (fondations seules) | Tables, routes en lecture/`501`, écrans d'attente, aucun calcul ni conformité MRA |
| **PAIE & RH** | **Préparé** (fondations seules) | Tables d'identification, routes en lecture/`501`, écrans d'attente, **aucun calcul PAYE/CSG/NSF** |

Aucune fonctionnalité existante de la V0.1 n'a été supprimée ni réécrite : les écrans comptables sont
inchangés et vérifiés par les tests hérités (61 tests web/racine avant mission 4, toujours verts).

---

## 2. Ce qui est réellement fonctionnel (Cabinet)

### 2.1 Tableau de bord cabinet — `GET /cabinet/dashboard`
Agrégats calculés en SQL, restreints aux dossiers auxquels l'utilisateur a accès :

- nombre de sociétés clientes, dossiers actifs / archivés, dossiers « à réviser » ;
- tâches ouvertes, **tâches en retard** (date limite dépassée et statut non clos) ;
- échéances à venir (14 jours), collaborateurs actifs, activité récente (journal d'audit).

### 2.2 Sociétés clientes (dossiers) — référentiel existant réutilisé
La table `companies` (déjà utilisée par les écritures, journaux et périodes) est **étendue**, pas dupliquée :
`crn`, `client_code` (unique), `dossier_manager_id`, `archived_at`, `status`.

- `GET /cabinet/companies` — liste, recherche texte, filtre statut, tri, pagination ;
- `GET /cabinet/companies/:id` — fiche complète : raison sociale, BRN, CRN, VAT no, adresse, activité,
  devise, dates d'exercice, responsable, collaborateurs et leurs accès, tâches ouvertes, échéances, activité ;
- `PATCH /cabinet/companies/:id` — modification (raison sociale, BRN, CRN, TVA, adresse, devise, exercice) ;
- `POST /cabinet/companies/:id/archive` et `/unarchive` — **archivage réversible**, aucune suppression :
  écritures, factures et historique restent en base et consultables en lecture ;
- création de dossier : formulaire complet, société + exercice + rattachement du créateur.

Toute écriture sur un dossier archivé renvoie **409 `COMPANY_ARCHIVED`** ; les lectures restent permises.

### 2.3 Collaborateurs et permissions — appliquées côté API **et** SQL
`apps/api/src/lib/permissions.ts` + `company_module_access` :

- rôles : `cabinet_admin` (Administrateur Cabinet), `manager` (Responsable de dossier),
  `accountant` (Collaborateur Comptabilité), `billing_clerk` (Collaborateur Facturation),
  `payroll_manager` (Gestionnaire Paie), `viewer` (Lecteur) ; compatibilité `owner`/`admin` = admin ;
- matrice par module (`cabinet`, `accounting`, `billing`, `payroll`) × niveau (`read`/`write`/`admin`) ;
- **permissions paie distinctes** : seul `payroll_manager` (ou admin) écrit dans la paie ; un comptable
  n'y a que la lecture, un gestionnaire paie n'écrit pas en comptabilité ;
- `company_module_access` ne peut qu'**élargir** un droit, jamais le réduire ;
- **isolation multi-société** : un non-membre reçoit **404 `COMPANY_NOT_FOUND`** (pas 403), donc aucune
  fuite d'existence ; modifier l'identifiant dans l'URL ne donne aucun accès ;
- filtrage SQL par jointure sur `company_members` dans chaque requête du module, pas seulement en amont ;
- activation/désactivation d'un collaborateur, consultation de ses accès (`PATCH /cabinet/companies/:id/members/:userId`,
  `GET /cabinet/team`).

La matrice complète est documentée dans [`docs/permissions-matrix.md`](permissions-matrix.md).

### 2.4 Tâches et échéances
`cabinet_tasks` + `cabinet_task_comments` :

- champs : société, collaborateur affecté (contrôlé comme autorisé sur la société), date limite, priorité,
  catégorie (Comptabilité / TVA / Fiscalité / Paie / États financiers / Administratif), statut, commentaires ;
- routes : `GET/POST /companies/:id/tasks`, `GET/PATCH/DELETE /companies/:id/tasks/:taskId`,
  `POST /companies/:id/tasks/:taskId/comments`, `GET /cabinet/tasks` (vue transversale) ;
- modification, changement de statut, clôture, réouverture, suppression logique ; **historique** par
  commentaires horodatés et journal d'audit (`audit_log`) ;
- **aucune échéance légale mauricienne n'est générée automatiquement** : les dates sont saisies par le
  cabinet. Aucun barème, taux, seuil ou délai fiscal n'a été inventé (voir §7).

### 2.5 Interface
- **Navigation Windows** : barre à quatre onglets visibles (Cabinet, Comptabilité, Facturation, Paie & RH),
  sous-menus latéraux, sélecteur **société + exercice** persistant ;
- **Android** : *drawer* de navigation, tableaux transformés en cartes empilées, en-têtes collants,
  **aucun débordement horizontal** (grilles en `minmax(0, 1fr)`, `overflow-x` contenu) ;
- **bilingue FR/EN** : toutes les chaînes de la suite sont dans `i18n.tsx` (`suite.*`, `cabinet.*`,
  `prepared.*`, `error.*`) ;
- sous-menus non encore développés marqués explicitement **« Bientôt disponible »**, jamais simulés.

---

## 3. Ce qui est seulement préparé (Facturation, Paie, Comptabilité future)

| Élément | État |
|---|---|
| Tables `billing_documents`, `payroll_employees` | créées, vides, cloisonnées par société |
| `GET /companies/:id/billing/documents`, `/billing/summary` | lecture réelle (listes vides au départ), `available: false` |
| `GET /companies/:id/payroll/employees`, `/payroll/summary` | idem |
| `POST` facturation / paie | **501 `NOT_IMPLEMENTED`** explicite |
| Écrans Tableau de bord, Clients, Devis, Factures, Avoirs, Encaissements, E-Invoicing MRA | coquilles UI avec liste des fonctions à venir |
| Écrans Salariés, Contrats, Variables, Bulletins, Congés, Déclarations, Transfert comptable | idem |
| Sous-menus Comptabilité futurs (Achats/OCR, Banque/rapprochement, Immobilisations, IFRS for SMEs) | annoncés indisponibles |

**Chaîne de facturation préparée** (non active) : `facture validée → écriture proposée → validation humaine →
comptabilisation`, avec `billing_documents.source_document_id` et `accounting_entry_id` **UNIQUE** pour empêcher
toute double comptabilisation. Voir [`docs/module-integration.md`](module-integration.md).

**Aucune fausse conformité** : pas de mention « conforme MRA », pas de numérotation e-invoicing simulée,
pas de calcul PAYE/CSG/NSF, aucun taux ni plafond inventé.

---

## 4. Base de données et migrations

Migration unique et **non destructrice** : [`apps/api/sql/migrations/0004_cabinet.sql`](../apps/api/sql/migrations/0004_cabinet.sql)
(209 lignes, idempotente `IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`).

| Objet | Détail |
|---|---|
| `companies` (ALTER) | `crn`, `client_code` (+ index unique), `dossier_manager_id` (+ index), `archived_at` |
| `company_members` (ALTER) | contrainte de rôle élargie aux 6 rôles de la suite |
| `company_module_access` | droits par module × société × utilisateur |
| `cabinet_tasks` | tâches : société, affecté, échéance, priorité, catégorie, statut |
| `cabinet_task_comments` | commentaires et historique |
| `billing_documents` | devis/factures/avoirs, `source_document_id`, `accounting_entry_id` UNIQUE |
| `payroll_employees` | identification seule (aucune donnée salariale) |
| `audit_log` | index ajoutés (`user_id, created_at`, `entity_type, entity_id`) |

Domaines logiques : `core` (sociétés, utilisateurs, exercices), `cabinet`, `accounting`, `billing`,
`payroll`, `audit` — tous dans le **même schéma PostgreSQL** avec FK et transactions, conformément à
[`docs/suite-architecture.md`](suite-architecture.md). Migrations `0001`→`0004` rejouées de zéro en CI sur
PostgreSQL 16 (`npm run migrate`), sans `DROP` ni perte de données.

---

## 5. Fichiers principaux ajoutés ou modifiés

**API** — `src/lib/permissions.ts` (nouveau), `src/modules/cabinet/routes.ts` (nouveau, 848 lignes),
`src/modules/billing/routes.ts` (nouveau), `src/modules/payroll/routes.ts` (nouveau),
`src/app.ts`, `src/types.ts`, `src/lib/tenant.ts`, `src/lib/errors.ts` (+`NOT_IMPLEMENTED`, `COMPANY_ARCHIVED`,
`MODULE_FORBIDDEN`), `src/i18n/index.ts`, `src/modules/companies/routes.ts`,
`sql/migrations/0004_cabinet.sql`, `tests/cabinet.test.ts`.

**Web** — `src/modules.ts` (nouveau registre des 4 espaces), `src/App.tsx` (shell unifié, redirections des
anciennes URL), `src/pages/cabinet/{CabinetDashboard,Dossier,Tasks,Team}.tsx` (nouveaux),
`src/pages/prepared/Prepared.tsx` (nouveau), `src/pages/Companies.tsx`, `src/i18n.tsx`,
`src/store.tsx`, `src/styles.css`, `src/demo/runtime.ts`, `src/demo/seed-data.ts`, `src/demo/index.ts`.

**Tests** — `apps/web/tests/demo-app.test.tsx` (nouveau), `demo-engine.test.ts`, `format.test.ts`,
`setup.ts`, `vitest.config.ts`, `tsconfig.test.json`.

**Docs & CI** — `docs/suite-architecture.md`, `docs/cabinet-module.md`, `docs/permissions-matrix.md`,
`docs/module-integration.md`, ce rapport, `.github/workflows/pages.yml`, `README.md`, `CHANGELOG.md`.

---

## 6. Résultats exacts des tests (31/10/2026)

| Commande | Résultat |
|---|---|
| `npm run typecheck` (racine) | **0 erreur** (API + web) |
| `npm test` (racine : racine + API + web) | **9 fichiers passed | 1 skipped** — **84 passed | 4 skipped (88)** |
| `npx vitest run` dans `apps/web` | **3 fichiers passed** — **28 passed (28)** |
| `VITE_DEMO_MODE=true npm run build:demo` | OK — JS **460,47 kB** (gzip 130,75 kB), CSS 15,72 kB |

Répartition des 28 tests web : `demo-engine.test.ts` 17, `demo-app.test.tsx` 7, `format.test.ts` 4.
Répartition API : `cabinet.test.ts` 11 tests (dossiers, tâches, tableau de bord, archivage, permissions
par module, isolation inter-sociétés, fondations 501) ; les **4 tests *skipped*** sont ceux de
`apps/api/tests/concurrency.test.ts`, qui exigent un **vrai serveur PostgreSQL** et ne s'exécutent donc
qu'en CI (job « Tests API PostgreSQL »). Le fichier `apps/web/e2e/app.spec.ts` (Playwright) est également
ignoré localement, Chromium n'étant pas installable dans le bac à sable.

> `npx vitest run` lancé **à la racine** ne reflète pas ces chiffres : il ignore la configuration par
> espace de travail (jsdom, alias). Les commandes de référence sont `npm test` et
> `npm run test -w @mc/web`.

Les 61 tests de la V0.1/V0.2/V0.3 restent verts : aucune régression de la comptabilité.
`fetch` est espionné dans les tests web — **aucun appel réseau** n'est effectué par la démo.

---

## 7. Limites, réserves et anomalies connues

1. **Branche unique** : l'environnement n'autorise que la branche de session ; la mission 4 est donc
   poursuivie sur `arena/b0b62798-mauritius-compta` (voir §11).
2. **Validation légale mauricienne non faite** : aucune échéance légale, aucun taux, aucun seuil n'est
   codé. Les catégories de tâches sont descriptives ; tout futur paramétrage devra être **validé par un
   expert-comptable mauricien** et marqué `À VÉRIFIER` tant que ce n'est pas le cas.
3. **Facturation et paie non fonctionnelles** : écrans et routes présents, aucune création, aucun calcul,
   aucune déclaration. C'est conforme à la demande, mais ces espaces ne doivent pas être présentés comme
   utilisables.
4. **Playwright/Chromium indisponible** dans le bac à sable : le rendu mobile Android et le comportement
   tactile n'ont pas été testés automatiquement au navigateur ; ils ont été vérifiés par revue CSS
   (grilles, `overflow-x`, media queries) et par la démo jsdom. Une passe manuelle sur téléphone reste à faire.
5. **Démo = données fictives locales** (`localStorage`, schéma 2), séparée du backend réel, bandeau
   permanent, réinitialisation possible. Elle ne prouve rien sur le backend, qui n'est couvert que par les
   tests API.
6. **Pas de gestion documentaire** (upload de pièces, OCR) : hors périmètre de cette mission.
7. **Audit** : le journal enregistre les créations/modifications du cabinet, mais il n'existe pas encore
   d'écran de consultation dédié au journal d'audit côté cabinet.

---

## 8. Déploiement et vérifications GitHub

| Élément | Résultat |
|---|---|
| Workflow **CI** (`.github/workflows/ci.yml`) | succès — jobs Typecheck/tests/build, Tests API PostgreSQL 16, Vérification des migrations |
| Workflow **Demo (GitHub Pages)** | succès — run [**41149489345**](https://github.com/azharshahim/mauritius-compta/actions/runs/41149489345) |
| `gh pr checks 1` | tous les contrôles `pass` |
| Publication Pages | `index 200`, bundle `assets/index-qHwn599H.js` **200 (460 465 octets)**, `404.html 200`, lien profond retournant `404` attendu, **4 modules et cabinet présents** |
| URL vérifiée | **https://azharshahim.github.io/mauritius-compta/** |

Le job de publication vérifie désormais la présence des libellés `Mauritius Business Suite`,
`Dossiers clients`, `Tâches & échéances` et du dossier fictif `Vieux Grand Port Logistics` dans le bundle
publié : une régression de navigation ou de données de démonstration fait échouer le déploiement.

Aucun secret, `.env`, base réelle, sauvegarde ou `node_modules` n'est publié ; aucun déploiement OVH.

---

## 9. Conformité aux exigences de la mission

| Exigence | Verdict |
|---|---|
| Quatre espaces accessibles | ✅ onglets + routes + redirections des anciennes URL |
| Cabinet : sociétés et tâches fonctionnelles | ✅ API, SQL, UI et démo (tests dédiés) |
| Permissions réelles côté backend | ✅ API + filtrage SQL, 404 inter-sociétés, 409 archivage |
| Comptabilité existante intacte | ✅ 61 tests hérités verts, écrans inchangés |
| Base commune unique | ✅ `companies` étendue, domains logiques, migration 0004 |
| Facturation/Paie préparées sans faux calculs | ✅ `501`, `available: false`, listes vides |
| Démo GitHub Pages accessible | ✅ run 41149489345, URL vérifiée |
| Tests verts | ✅ 84 passed | 4 skipped (racine), 28 (web) |
| Aucun secret | ✅ |
| `main` non modifiée, PR non fusionnée | ✅ branche de session, PR #1 en brouillon |

---

## 10. Recommandation pour la mission suivante

**Mission Nº5 — Facturation utilisable, de bout en bout, sans conformité déclarée.**

1. Socles clients/articles (réutiliser `companies`, ajouter `billing_customers` si le client diffère de la société).
2. Devis → facture → avoir avec numérotation **séquentielle par société et exercice**, transactionnelle.
3. La chaîne `facture validée → écriture proposée → validation → comptabilisation` déjà spécifiée, avec
   `accounting_entry_id` UNIQUE et écriture d'origine tracée.
4. Encaissements partiels, lettrage simple, balance âgée.
5. PDF/mentions **paramétrables** (BRN, VAT no, conditions) — aucune mention « conforme MRA » avant revue.
6. E-Invoicing MRA : **rester sur une page d'attente** tant que la spécification officielle et un avis
   juridique ne sont pas disponibles ; documenter `À VÉRIFIER`.
7. Combler les deux réserves de la mission 4 : écran du journal d'audit cabinet, parcours tactile vérifié
   sur un vrai appareil Android.

La paie (mission 6) ne doit démarrer qu'après validation externe des règles sociales mauriciennes ; en
attendant, se limiter aux contrats et aux variables non calculées.

---

## 11. Note sur la branche et la PR

L'environnement de travail est lié à une branche unique, `arena/b0b62798-mauritius-compta` : créer une
seconde branche de mission ferait sortir le suivi de session. Conformément à la consigne (« sinon,
travailler sur la branche existante et documenter la limitation »), **tous les commits de la mission 4 sont
sur cette branche** :

```
ce1da60  feat(api): module Cabinet, permissions par module et fondations Facturation/Paie
fb97bc0  feat(web): suite unifiée à quatre espaces et interface Cabinet
0f485e7  docs(suite): architecture, module cabinet, matrice de permissions, intégration
6e0e2ca  ci(pages): vérifier la présence des quatre modules dans le bundle publié
```

La PR #1 reste **en brouillon**, non fusionnée, et `main` n'a reçu aucun commit de cette mission.
