# COMPTAI — Mission 35 — audit de sécurité et isolation multi-sociétés

**Date :** 1er novembre 2026
**Version auditée :** 0.1.1
**Branche :** `arena/dd18a210-mauritius-compta`
**Base :** `main` = `1590f99f806a0cc19406de39982aa879e0a11aca` (fusion de la PR nº15)
**Périmètre :** P0-03 — autorisations, isolation multi-sociétés, sécurité API/fichiers et
sécurité des sauvegardes.
**Nature :** **audit interne**. Les tests sont locaux, non destructifs et exécutés sur des
sociétés fictives. **Aucun test d'intrusion indépendant n'a été réalisé.**

> **Statut de P0-03 : toujours ouvert.** Cet audit interne réduit le risque et corrige des
> vulnérabilités réellement observées, mais il ne remplace ni une revue indépendante, ni un
> test d'intrusion, ni une revue de la journalisation. Aucune mise en production n'est
> autorisée par ce rapport.

## 1. Résumé exécutif

L'audit a porté sur **443 déclarations de routes** réparties dans 28 fichiers de routes, les
trois sociétés fictives A, B et C, les huit rôles existants et les quatre modules
(`cabinet`, `accounting`, `billing`, `payroll`).

Le modèle d'autorisation central est globalement solide : toutes les routes métier passent par
un garde d'authentification global, les non-membres reçoivent `404 COMPANY_NOT_FOUND` (jamais
`403`, donc aucune divulgation d'existence), le rôle et la permission de module sont revérifiés
côté serveur, et les identifiants d'objets des autres sociétés ne sont pas retournés.

Des vulnérabilités réelles ont toutefois été constatées puis corrigées :

| ID | Constat | Sévérité initiale | Statut |
|---|---|---|---|
| M35-SEC-01 | Un administrateur de dossier pouvait se promouvoir `owner` via `PATCH /cabinet/companies/:id/members/:userId`, puis rouvrir une période clôturée ou évincer le propriétaire. | **Critique** | Corrigé |
| M35-SEC-02 | Le drapeau global `app_users.is_active` pouvait être modifié par un administrateur, y compris sur le propriétaire ou sur un compte partagé avec un autre dossier ; les sessions survivaient à la réactivation. | **Élevée** | Corrigé |
| M35-SEC-03 | `dossier_manager_id` acceptait un utilisateur arbitraire, et la fiche cabinet retournait son nom et son courriel même s'il n'était pas membre du dossier. | Moyenne | Corrigé |
| M35-SEC-04 | Les routes de sauvegarde globale répondaient `503 BACKUP_ADMIN_NOT_CONFIGURED` avant de vérifier l'autorisation, divulguant l'état de configuration à tout utilisateur connecté. | Moyenne | Corrigé |
| M35-SEC-05 | Un identifiant malformé (UUID invalide) produisait `500 INTERNAL_ERROR` sur plusieurs routes au lieu d'un refus contrôlé. | Moyenne | Corrigé |
| M35-SEC-06 | Un refus d'écriture paie pouvait répondre `400`/`409 MODULE_FORBIDDEN` au lieu de `403`. | Faible | Corrigé |
| M35-SEC-07 | Le mot de passe temporaire d'un collaborateur invité n'appliquait pas la politique de mot de passe de l'inscription. | Faible | Corrigé |
| M35-SEC-08 | En production, `COOKIE_SECURE` restait `false` si l'opérateur omettait la variable. | Moyenne | Corrigé |

Aucune **fuite inter-sociétés de données comptables** n'a été constatée dans les scénarios
testés. Cette absence de constat ne vaut pas preuve d'absence de vulnérabilité : elle est
limitée aux routes, rôles, objets et jeux de données décrits dans la matrice.

## 2. Méthode et limites

### 2.1 Méthode

1. Inventaire statique des handlers Fastify (`app.get/post/put/patch/delete`).
2. Lecture des gardes : `guards.currentUser`, `requireCompany`, `requireModuleAccess`,
   `requireCabinetAdmin`, `requireBackupAdmin`, helpers locaux `actor`.
3. Recherche des requêtes SQL construites par interpolation, des `WHERE id = $1` sans filtre
   de société et des mises à jour par identifiant.
4. Lecture des contrôles d'objet : documents, pièces jointes, paiements, banque, paie,
   immobilisations, stocks, migration, IA, sauvegardes.
5. Tests d'isolation avec **trois sociétés fictives** A, B, C, quatre utilisateurs principaux
   et un compte volontairement partagé entre A et C.
6. Corrections, puis régression complète API, web, typecheck, build et CI.

### 2.2 Limites assumées

- **Pas de pentest indépendant**, pas de test réseau, pas de test sur l'infrastructure OVH.
- Pas de corpus de données réelles, pas d'analyse de vulnérabilités de dépendances au-delà de
  la CI existante.
- L'inventaire statique ne prouve pas l'absence de faille dans chaque branche de chaque
  service : les tests couvrent les routes et objets listés dans la matrice.
- Les contrôles de sécurité n'ont pas été désactivés pour faire passer les tests.
- Les règles comptables, fiscales et de paie n'ont pas été modifiées.

## 3. Modèle d'autorisation observé

| Couche | Contrôle | Comportement |
|---|---|---|
| Authentification | `preHandler` global sur le sous-routeur sécurisé | Toutes les routes métier exigent une session ; `auth/*` et `/api/health` sont publics. |
| Session | Cookie `HttpOnly`, `SameSite=Lax`, jeton aléatoire haché SHA-256 en base | Expiration vérifiée en base, compte `is_active` vérifié à chaque requête. |
| Société | `requireCompany(db, userId, companyId, minRole, module)` | Non-membre → `404 COMPANY_NOT_FOUND` ; rôle insuffisant → `403` ; dossier archivé → `409 COMPANY_ARCHIVED` en écriture. |
| Module | `effectiveAccess` + `requireModuleAccess` | `cabinet`, `accounting`, `billing`, `payroll` ; une dérogation ne peut qu'élargir. |
| Objet | Filtre `company_id` dans les services | Entrée, facture, document, pièce jointe, paiement, bulletin, immobilisation, etc. |
| Cabinet | `requireCabinetAdmin` / `requireModuleAccess(..., 'cabinet', ...)` | Les vues cabinet ne listent que les dossiers de l'utilisateur. |
| Sauvegarde | `requireBackupAdmin` + `assertGlobalBackup` | Allowlist opérateur ; export société réservé à l'admin paie ; aucun endpoint de restauration. |
| Entrées | Zod, `.strict()` sur la plupart des schémas, montants décimaux | Erreurs `400 VALIDATION_ERROR`, sans SQL ni pile. |

Rôles existants : `owner`, `admin`, `cabinet_admin`, `manager`, `accountant`,
`billing_clerk`, `payroll_manager`, `viewer`. **Aucun rôle n'a été inventé.**

## 4. Vulnérabilités constatées et corrections

### 4.1 M35-SEC-01 — élévation de privilège vers `owner` (critique)

**Constat.** `PATCH /api/cabinet/companies/:companyId/members/:userId` autorisait le changement
de rôle vers n'importe quelle valeur de `COMPANY_ROLES`, y compris `owner`, alors que
`POST /api/companies/:companyId/members` l'interdisait déjà. Un `admin` de dossier (ou
`cabinet_admin`) pouvait donc :

1. se promouvoir `owner` ;
2. appeler `POST /api/companies/:companyId/periods/:periodId/reopen`, réservé au rôle
   `owner`, et rouvrir une période comptable clôturée ;
3. avec un second propriétaire, supprimer le propriétaire historique.

**Impact.** Prise de contrôle du dossier et atteinte à l'intégrité des clôtures comptables.
Aucun accès direct aux données d'une autre société n'a été démontré, mais l'élévation permet
des opérations réservées au propriétaire.

**Correction.** Toute attribution de `owner` à un membre qui n'est pas déjà `owner` est
refusée (`400`). La rétrogradation d'un `owner` reste refusée. Le transfert de propriété
n'existe pas et n'a pas été inventé : il reste suivi en P2-06.

**Test.** `mission35-security.test.ts` — promotion refusée, rôle en base inchangé, réouverture
refusée, deux tentatives simultanées refusées, un seul `owner`.

### 4.2 M35-SEC-02 — drapeau global `is_active` (élevée)

**Constat.** Le même endpoint acceptait `isActive` et exécutait
`UPDATE app_users SET is_active = ...`. Ce drapeau est **global** : un administrateur du
dossier A pouvait verrouiller un compte partagé avec le dossier C, ou verrouiller le
propriétaire, puis tenter de prendre la main. Les sessions existantes n'étaient pas révoquées,
donc une réactivation ressuscitait les anciens cookies.

**Correction.**

- seul le rôle `owner` peut changer ce drapeau global ;
- le propriétaire ne peut pas désactiver son propre compte ni un autre `owner` ;
- un compte membre d'un autre dossier est refusé (`409`) ;
- la désactivation supprime toutes les sessions du compte ;
- l'ensemble des écritures du endpoint est transactionnel et audité.

**Test.** Administrateur refusé (`403`), auto-désactivation refusée (`400`), propriétaire
refusé (`400`), compte partagé refusé (`409`) et toujours actif, désactivation d'un compte
isolé (`200`), ancien cookie refusé après désactivation **et après réactivation**, reconnexion
explicite nécessaire.

### 4.3 M35-SEC-03 — gestionnaire de dossier arbitraire (moyenne)

**Constat.** `dossier_manager_id` acceptait n'importe quel UUID dans `PATCH /companies/:id`,
`PATCH /cabinet/companies/:id` et `POST /companies`. La fiche cabinet joignait ensuite
`app_users` sans vérifier l'appartenance, ce qui pouvait exposer le nom et le courriel d'un
utilisateur d'un autre dossier si son identifiant était connu.

**Correction.** Le gestionnaire doit être membre du dossier (ou le créateur lors de la
création). La jointure de la fiche cabinet est désormais restreinte aux membres du dossier :
une donnée historique invalide n'affiche plus aucun utilisateur étranger.

**Test.** Gestionnaire extérieur refusé (`400`) sur les trois routes, gestionnaire membre
accepté, ligne historique invalide non divulguée.

### 4.4 M35-SEC-04 — ordre autorisation/configuration des sauvegardes (moyenne)

**Constat.** `requireBackupAdmin` vérifiait la configuration avant l'autorisation. Sur un
serveur sans clé ni allowlist, tout utilisateur connecté recevait `503` au lieu de `403`.

**Correction.** L'allowlist est vérifiée en premier ; un utilisateur non autorisé reçoit
toujours `403 BACKUP_FORBIDDEN`. L'endpoint d'état `/admin/backup/status` reste informatif mais
n'ouvre aucune opération. Aucun endpoint HTTP de restauration n'existe.

**Test.** Utilisateur ordinaire → `403` sur `/admin/backups`, `authorized: false` sur l'état,
`404` sur une route de restauration inexistante ; export d'une autre société → `404`.

### 4.5 M35-SEC-05 — identifiants malformés en erreur 500 (moyenne)

**Constat.** Des UUID invalides dans les paramètres (`entries/not-a-uuid`,
`bank/transactions/not-a-uuid`, etc.) remontaient l'erreur PostgreSQL `22P02` et produisaient
`500 INTERNAL_ERROR`. Cela ne divulguait ni SQL ni pile, mais violait la validation des
entrées et permettait de distinguer une erreur interne d'un refus contrôlé.

**Correction.** `mapDatabaseError` traduit `22P02` en `400 VALIDATION_ERROR` générique.

**Test.** Huit routes représentatives retournent `400 VALIDATION_ERROR` sans
`invalid input syntax` ni `stack`.

### 4.6 M35-SEC-06 — codes de refus paie (faible)

**Constat.** Certains refus d'écriture paie utilisaient `badRequest('MODULE_FORBIDDEN')`
(`400`) ou `conflict('MODULE_FORBIDDEN')` (`409`) au lieu de `403`.

**Correction.** Tous les refus de rôle paie utilisent `forbidden(..., 'MODULE_FORBIDDEN')`.
Aucun contournement n'a été constaté : la vérification de module restait appliquée.

**Test.** Un gestionnaire paie ne peut ni gérer les membres, ni exporter la société, ni
modifier un rôle, ni créer une écriture comptable ; il peut lire et écrire la paie.

### 4.7 M35-SEC-07 — politique de mot de passe des invités (faible)

**Constat.** `temporaryPassword` exigeait seulement 10 caractères, sans la règle
lettres + chiffres appliquée à l'inscription.

**Correction.** Même politique que l'inscription (10 caractères minimum, lettres et chiffres).

**Test.** Deux mots de passe faibles refusés, un mot de passe conforme accepté.

### 4.8 M35-SEC-08 — cookie de session en production (moyenne)

**Constat.** `COOKIE_SECURE` valait `false` par défaut, y compris en production, avec un simple
avertissement dans les journaux.

**Correction.** En production, le cookie est `Secure` par défaut si la variable n'est pas
définie. Un opérateur peut toujours la forcer explicitement, mais le choix sûr est le défaut.

**Test.** `loadConfig({ NODE_ENV: 'production' })` → `COOKIE_SECURE = true` ; valeur explicite
`false` respectée ; développement inchangé.

## 5. Isolation multi-sociétés — résultats

Jeu de données : société A (propriétaire A, administrateur A, gestionnaire paie A, comptable
partagé), société B (propriétaire B, données comptables, client, salarié, immobilisation,
pièce jointe), société C (propriétaire C, comptable partagé avec A, écriture et plan
comptable propres).

| Scénario | Résultat attendu | Résultat observé |
|---|---|---|
| A lit une route métier de B (22 modules) | `404 COMPANY_NOT_FOUND` | Conforme |
| A écrit dans B (entrée, client, salarié, immobilisation, suppression) | `404` | Conforme |
| A ouvre la fiche, l'archive ou l'équipe cabinet de B | `404` | Conforme |
| A liste les dossiers, l'équipe et le tableau de bord cabinet | A uniquement | Conforme |
| A utilise un identifiant d'objet de B sous le chemin de A | `404` | Conforme |
| A télécharge une pièce jointe de B | `404` | Conforme |
| C lit A ou B ; A ou B lit C (écriture C incluse) | `404` | Conforme |
| Le compte partagé A+C lit A et C | `200` | Conforme (partage explicite) |
| Le compte partagé lit B | `404` | Conforme |
| Un gestionnaire paie A exporte A | `403` | Conforme |
| Un administrateur A exporte B | `404` | Conforme |
| Un administrateur A forge une sauvegarde globale | `403` | Conforme |
| Aucun endpoint de restauration HTTP | `404` | Conforme |

Détail route par route : [matrice d'autorisation](./comptai-security-authorization-matrix.md).

## 6. Sécurité API et fichiers — vérifications

| Sujet | Vérification | Résultat |
|---|---|---|
| Sessions | Cookie `HttpOnly`, `Secure` en production, `SameSite=Lax`, hash en base, expiration, `is_active` | Conforme après M35-SEC-08 |
| Révocation | Déconnexion, changement de mot de passe, désactivation d'un compte | Sessions supprimées |
| Anti-bruteforce | Limite par courriel et par IP, compte inactif refusé, hash factice pour courriel inconnu | Testé (`429` après 5 échecs), verrouillage temporaire |
| CSRF | `Origin` et `Sec-Fetch-Site` sur les méthodes d'écriture, cookie `SameSite` | `403` sur origine et site croisés |
| En-têtes | `x-content-type-options`, `x-frame-options: DENY`, `Referrer-Policy`, CSP | Présents |
| Erreurs | Pas de pile, pas de SQL, code stable, message localisé | Conforme, y compris UUID malformé |
| Injections SQL | 28 interpolations de requêtes examinées ; index de placeholders, noms de tables/colonnes littéraux, valeurs paramétrées | Aucune injection constatée ; `nextNo` appelé avec des littéraux |
| IDOR/BOLA | Identifiants d'objets d'une autre société | `404`, aucun contenu retourné |
| Téléversements | Taille, type déclaré, signature réelle, nom stocké aléatoire, dossier par société | Conforme ; pas d'antivirus |
| Téléchargements | Pièce jointe filtrée par `company_id`, `Content-Disposition` neutralisé, `nosniff` | Conforme |
| Traversée de chemins | Nom stocké généré, `path.resolve` et clé de stockage non fournie par le client | Aucune traversée constatée |
| Journaux | Cookie et `Authorization` masqués ; pas de clé de chiffrement ni de mot de passe dans l'audit | Conforme sur les actions examinées |
| Sauvegardes | Allowlist, chiffrement, archive hors `STORAGE_DIR`, aucune route de restauration | Conforme ; preuve d'exploitation toujours P1-16 |

## 7. Tests exécutés

| Suite | Périmètre | Résultat |
|---|---|---|
| `apps/api/tests/mission35-security.test.ts` | 14 cas M35 : 3 sociétés, rôles, IDOR, sauvegardes, sessions, CSRF, UUID, bruteforce, cookie | **14/14** |
| API complète (PGlite) | 36 fichiers, contrôles comptables et régressions | **521 réussis, 11 ignorés** |
| Web | 46 fichiers, interfaces et démonstration | **290/290** |
| Typecheck | API + web | **0 erreur** |
| Build | API + web | **OK** |
| PostgreSQL réel | Job CI `postgres-tests` | Voir CI de la PR |
| CI GitHub Actions | Jobs qualité, PostgreSQL réel et migrations | Voir CI de la PR |

Les tests M35 vérifient également : absence de session (`401`), session déconnectée (`401`),
session expirée (`401`), identifiants malformés (`400`), requêtes simultanées de promotion
(refusées), et absence de restauration HTTP.

## 8. Risques résiduels

| Risque | Niveau | Traitement recommandé |
|---|---|---|
| **Absence de revue indépendante et de pentest** | **P0-03 ouvert** | Mandater un tiers ; ne pas considérer cet audit interne comme suffisant. |
| `trustProxy: true` fait confiance à `X-Forwarded-For` | Moyen si le port applicatif est exposé | Maintenir l'écoute sur `127.0.0.1`, faire réécrire l'en-tête par Nginx, restreindre le pare-feu ; à défaut, rendre la confiance proxy configurable. |
| Validation Zod avant la garde de société sur quelques écritures paie | Faible | Un utilisateur authentifié hors société peut obtenir un message de champ, mais aucune donnée ni écriture. Réordonner la garde avant le schéma. |
| Unicité globale du BRN dans `POST/PATCH /companies` | Faible | Révèle qu'un BRN existe déjà et empêche deux dossiers de même BRN chez deux cabinets ; décision métier à documenter. |
| Verrouillage d'un compte par échecs répétés | Faible | Limite par courriel = déni de service ciblé temporaire ; surveiller et prévoir une procédure de déblocage (P1-07). |
| Pas de MFA, réinitialisation de mot de passe ni SSO | Élevé pour les comptes admin | P1-07. |
| Journal d'audit append-only mais non chaîné/WORM | Moyen | P1-14. |
| Pas de HSTS au niveau applicatif | Faible si Nginx le fournit | Vérifier la configuration TLS du proxy. |
| Pas d'antivirus sur les pièces jointes | Faible | Signature PDF/JPEG/PNG et `nosniff` uniquement ; ajouter une analyse si des fichiers clients sont acceptés. |
| Lignes historiques `dossier_manager_id` invalides | Faible | Elles ne sont plus divulguées ; prévoir un nettoyage/migration. |
| Absence de preuve de sauvegarde exploitée hors site | Élevé | P1-16. |

## 9. Vérifications nécessitant un audit indépendant

- Revue d'autorisation **exhaustive** route par route, y compris les branches de service non
  atteintes par les tests.
- Test d'intrusion externe et interne (authentification, session, CSRF, injection, IDOR,
  téléversement, déni de service).
- Revue de la journalisation et de la conservation des preuves.
- Revue de la configuration de production : TLS, HSTS, proxy, pare-feu, secrets, sauvegardes.
- Revue de l'implémentation PostgreSQL réelle et des privilèges du compte applicatif.
- Validation par un cabinet mauricien des règles comptables, fiscales et de paie (hors M35).

## 10. Recommandation

1. **Ne pas déclarer P0-03 résolu.** Le statut reste **ouvert** jusqu'à réception d'un rapport
   de revue indépendante et d'un test d'intrusion, avec remédiations vérifiées.
2. **Ne pas mettre en production** tant que P0-03, P0-04, P0-05 et P1-16 ne sont pas clos ou
   formellement acceptés par écrit.
3. Appliquer les corrections M35 avant toute recette de sécurité externe : elles suppriment
   une élévation de privilège critique et trois expositions moyennes.
4. Exécuter la revue indépendante sur cette branche après fusion, avec la matrice fournie comme
   point de départ et non comme preuve d'exhaustivité.
5. Conserver les tests M35 comme régression obligatoire ; toute nouvelle route doit être
   ajoutée à la matrice avec son rôle, sa société et son résultat attendu.

## 11. Fichiers modifiés

| Fichier | Modification |
|---|---|
| `apps/api/src/modules/cabinet/routes.ts` | garde `owner`, statut global, sessions, gestionnaire de dossier, transaction |
| `apps/api/src/modules/companies/routes.ts` | politique mot de passe invité, gestionnaire de dossier membre |
| `apps/api/src/backup/service.ts` | autorisation avant configuration |
| `apps/api/src/lib/errors.ts` | `22P02` → `400 VALIDATION_ERROR` |
| `apps/api/src/config.ts` | cookie `Secure` par défaut en production |
| `apps/api/src/modules/payroll/routes.ts` | refus de rôle en `403` |
| `apps/api/src/modules/payroll/service.ts` | refus de rôle en `403` |
| `apps/api/src/modules/payroll/accounting.ts` | refus de rôle en `403` |
| `apps/api/tests/mission35-security.test.ts` | 14 tests d'isolation et de sécurité |
| `docs/mission-35-security-report.md` | ce rapport |
| `docs/comptai-security-authorization-matrix.md` | matrice route × méthode × rôle × société |
| `docs/mission-35-remediation-register.md` | registre de remédiation |
| `docs/comptai-preproduction-gaps.md` | statut P0-03 mis à jour |
| `docs/permissions-matrix.md` | règles `owner` et statut global précisées |
| `docs/preproduction-audit-checklist.md` | preuves M35 ajoutées aux sections 3.12 à 3.14 |
