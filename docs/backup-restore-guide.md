# COMPTAI — guide technique sauvegarde, restauration et export

**Version :** COMPTAI 0.1.1 — mission 34
**Date :** 1er novembre 2026
**Statut :** mécanisme implémenté et testé sur données fictives. La restauration n’est **pas**
exposée par l’API HTTP et reste bloquée tant qu’elle n’est pas explicitement autorisée.
**Périmètre :** PostgreSQL, documents stockés hors base, export par société, intégrité,
séparation multi-société, traçabilité.

> COMPTAI contient uniquement des données fictives dans cette version. Aucune sauvegarde de
> production, aucun stockage distant et aucun exercice de reprise sur le VPS n’ont été réalisés
> dans cette mission : l’infrastructure réelle ne doit pas être configurée sans autorisation.

## 1. Pourquoi `pg_dump` seul ne suffit pas

Les données comptables sont dans PostgreSQL, mais **les pièces justificatives ne le sont pas**.
Une sauvegarde limitée à `pg_dump` produirait une base apparemment complète dont les factures,
relevés et extractions OCR seraient absents ou non ouvrables.

| Emplacement | Contenu | Sauvegardé par |
|---|---|---|
| PostgreSQL | 141 tables publiques : sociétés, comptabilité, facturation, achats, banque, paie, immobilisations, stocks, IA, audit, etc. | snapshot logique `database/*.json` |
| `STORAGE_DIR/<companyId>/<fichier>` | pièces jointes des écritures et documents d’achat (`attachments`) | archive `storage/<companyId>/...` |
| `STORAGE_DIR/documents/<companyId>/<id>.<ext>` | documents importés, PDF/JPEG/PNG (`document_imports`) | archive `storage/documents/...` |
| `STORAGE_DIR/bank-statements/<companyId>/<hash>-<nom>` | relevés bancaires d’origine (`bank_imports.summary.source`) | archive `storage/bank-statements/...` |
| `BACKUP_DIR` | archives chiffrées de sauvegarde et d’export | hors sauvegarde, répertoire opérationnel 0700 |

Le snapshot couvre **137 des 141 tables**. Quatre tables sont exclues volontairement :

| Table exclue | Raison |
|---|---|
| `schema_migrations` | versionnée séparément dans le manifeste et vérifiée avant restauration |
| `sessions` | jetons de session éphémères : une restauration invalide les sessions, ce qui est le comportement attendu |
| `login_attempts` | journal de sécurité éphémère, non nécessaire à la reprise |
| `backup_runs` | historique opérationnel des sauvegardes ; reconstruit sur la cible |

Les mots de passe (**hashes**) et les identifiants IA chiffrés restent dans la sauvegarde : ils sont
nécessaires pour restaurer les comptes et la configuration. Ils sont protégés par le chiffrement de
l’archive et par leurs propres mécanismes (hash de mot de passe, chiffrement applicatif des clés IA).

## 2. Architecture

| Fichier | Rôle |
|---|---|
| `apps/api/src/backup/database.ts` | snapshot logique, ordre des clés étrangères, contrôles comptables, restauration transactionnelle |
| `apps/api/src/backup/crypto.ts` | enveloppe AES-256-GCM, dérivation scrypt, refus des mauvaises phrases |
| `apps/api/src/backup/archive.ts` | ZIP, manifeste JSON, empreintes, contrôle des chemins |
| `apps/api/src/backup/service.ts` | création, export société, vérification, restauration, historique |
| `apps/api/src/backup/routes.ts` | API administrateur, téléchargements protégés, **aucune route de restauration** |
| `apps/api/src/backup/cli.ts` | commande hors ligne `create-global`, `export-company`, `verify`, `restore` |
| `apps/api/sql/migrations/0024_backup_restore.sql` | table `backup_runs` |
| `apps/web/src/pages/settings/DataManagement.tsx` | écran **Settings → Data Management** |

### 2.1 Cohérence du snapshot

- Toutes les tables sont lues dans **une transaction `REPEATABLE READ READ ONLY`** : la base est vue
  à un instant cohérent.
- Les montants `numeric` restent des chaînes de caractères de bout en bout ; aucun montant ne passe
  par un `float` JavaScript.
- La liste des fichiers est déduite des **références en base**. Un fichier référencé mais absent
  fait **échouer** la sauvegarde (`BACKUP_FILE_MISSING`) : COMPTAI ne produit jamais une archive
  silencieusement incomplète.
- La sauvegarde des fichiers ne bénéficie pas d’un snapshot de système de fichiers. Les fichiers
  COMPTAI sont immuables après écriture ; une suppression concurrente provoque un échec explicite.

### 2.2 Format d’archive

Extension `.mcbackup` (sauvegarde) ou `.mcexport` (export société). L’enveloppe binaire est :

```text
magic « MCBACKUP\x01 » (9 octets)
sel scrypt (16 octets)
IV AES-GCM (12 octets)
tag d’authentification GCM (16 octets)
ciphertext (ZIP chiffré)
```

À l’intérieur du ZIP :

```text
manifest.json
README.md
database/<table>.json           (sauvegarde globale)
data/<table>.json               (export société)
data/company.json               (export société)
data/users.json                 (export société, sans hash de mot de passe)
csv/*.csv                       (export société)
storage/<chemin relatif>        (documents originaux)
```

Une archive n’est lisible qu’avec `BACKUP_ENCRYPTION_KEY`. La phrase n’est écrite ni dans
l’archive, ni dans PostgreSQL, ni dans les journaux, ni dans les réponses API.

## 3. Chiffrement et secrets

| Élément | Choix |
|---|---|
| Chiffrement | AES-256-GCM authentifié |
| Dérivation | scrypt `N=16384, r=8, p=1`, sel aléatoire de 16 octets par archive |
| IV | 12 octets aléatoires par archive |
| Données authentifiées | magie + sel + IV (AAD) |
| Longueur minimale de phrase | 16 caractères |
| Permission répertoire | `BACKUP_DIR` créé en `0700` |
| Permission fichier | archive créée en `0600` |
| Écriture atomique | fichier `.tmp` puis `rename`, suppression du temporaire en cas d’erreur |
| Secrets dans les logs | jamais : seuls les codes d’erreur, tailles, empreintes et compteurs sont journalisés |
| Secrets dans l’archive | la phrase de chiffrement n’y figure jamais ; les hashes de mot de passe et clés IA sont inclus car nécessaires à la reprise, sous chiffrement |

Générer une phrase solide, puis la conserver dans un coffre de secrets séparé :

```bash
openssl rand -base64 32
```

Ne pas réutiliser `AI_ENCRYPTION_KEY`, ne pas la mettre dans `.env.example`, ne pas la transmettre
par messagerie ou ticket.

## 4. Configuration

```dotenv
BACKUP_DIR=./backups
BACKUP_ENCRYPTION_KEY=<phrase de 16 caractères minimum>
BACKUP_ADMIN_EMAILS=admin@example.test,associe@example.test
BACKUP_MAX_BYTES=268435456
BACKUP_MAX_UNCOMPRESSED_BYTES=536870912
BACKUP_RESTORE_ENABLED=false
```

- `BACKUP_ADMIN_EMAILS` est une **liste blanche explicite** : un propriétaire de société n’obtient
  pas automatiquement le droit de sauvegarder toutes les autres sociétés.
- `BACKUP_RESTORE_ENABLED` n’est lu que par la CLI. Aucune route HTTP ne peut restaurer.
- Sans `BACKUP_ENCRYPTION_KEY`, la création et la vérification sont refusées (`503`).
- Sans administrateur dans la liste blanche, la sauvegarde **globale** est refusée ; l’export d’une
  société reste disponible pour son administrateur si la phrase est configurée.

## 5. Sauvegarde globale

### 5.1 Interface

**Settings → Data Management → Sauvegarde → Créer une sauvegarde**. Le bouton n’est actif que si
l’utilisateur est authentifié, la phrase configurée et son adresse dans la liste blanche. L’écran
affiche l’historique, la taille, l’état et les 12 premiers caractères du SHA-256. Aucun bouton ne
simule une sauvegarde.

### 5.2 CLI

```bash
cd apps/api
npm run backup -- create-global --actor-email admin@example.test
```

La commande affiche un JSON contenant `backupId`, le nom d’archive, la taille, le SHA-256, le
nombre de tables/lignes/fichiers et la durée. L’archive est écrite dans `BACKUP_DIR`.

### 5.3 Contenu du manifeste

```json
{
  "format": "comptai-backup",
  "formatVersion": 1,
  "id": "uuid du backup",
  "kind": "global_backup",
  "createdAt": "ISO-8601",
  "appVersion": "0.1.1",
  "restoreSupported": true,
  "scope": { "companyId": null, "companyName": null },
  "schema": { "migrations": [{ "version": "0001_core.sql", "checksum": "sha256" }], "latestVersion": "0024_backup_restore.sql" },
  "database": {
    "engine": "postgres",
    "rowCount": 103,
    "tables": [{ "name": "companies", "rowCount": 2, "sha256": "..." }],
    "excludedTables": ["schema_migrations", "sessions", "login_attempts", "backup_runs"]
  },
  "files": [{ "path": "<companyId>/<fichier>", "bytes": 46, "sha256": "...", "companyId": "uuid" }],
  "controls": {
    "companies": 2, "users": 1, "postedEntries": 2, "journalLines": 2,
    "debitTotal": "2000.0000", "creditTotal": "2000.0000",
    "perCompany": [{ "companyId": "uuid", "debit": "1000.0000", "credit": "1000.0000", "lines": 1 }],
    "attachments": { "count": 2, "bytes": 92 }
  },
  "warnings": ["..."],
  "encryption": { "algorithm": "aes-256-gcm", "kdf": "scrypt", "keyLength": 32 }
}
```

Chaque table est sérialisée en JSON avec ses valeurs exactes. Chaque fichier et chaque table possède
son SHA-256. Le SHA-256 global de l’enveloppe chiffrée est enregistré dans `backup_runs` et
vérifié avant toute restauration.

## 6. Vérification d’intégrité

Interface : bouton **Vérifier l’intégrité** sur chaque sauvegarde.
CLI :

```bash
npm run backup -- verify ./backups/<archive>.mcbackup
```

La vérification :

1. déchiffre l’enveloppe et vérifie le tag GCM ;
2. contrôle le format et la version du manifeste ;
3. rejette les noms d’entrée absolus, `..`, les antislashs et les noms normalisés différemment ;
4. recompte et re-hache chaque table ;
5. re-hache chaque fichier référencé ;
6. contrôle les entrées supplémentaires (CSV, société, utilisateurs) d’un export ;
7. compare le SHA-256 de l’archive à celui de `backup_runs` lors d’une vérification depuis
   l’interface ; la commande CLI affiche l’empreinte observée et ne consulte pas la base.

Sont refusés : archive tronquée, archive modifiée, mauvais mot de passe, table absente, empreinte de
table ou de fichier différente, chemin dangereux, archive décompressée au-delà de
`BACKUP_MAX_UNCOMPRESSED_BYTES`.

## 7. Restauration hors ligne

### 7.1 Garanties de sécurité

La restauration est **impossible depuis le navigateur et l’API**. Elle exige :

1. un accès shell au serveur et la commande `backup restore` ;
2. `BACKUP_RESTORE_ENABLED=true` ;
3. `BACKUP_ENCRYPTION_KEY` ;
4. une URL cible **différente** de `DATABASE_URL` ;
5. une base cible **vide** (aucune table publique) ;
6. un répertoire de stockage cible **vide ou inexistant** ;
7. `--confirm <backup-id>` égal à l’identifiant du manifeste ;
8. en `NODE_ENV=production`, le drapeau supplémentaire `--allow-production` **et** une autorisation
   écrite. Ce drapeau ne doit pas être utilisé sans procédure de crise validée.

Toute restauration échoue si la base contient déjà une table. Elle ne peut donc pas écraser une base
existante par une simple faute de frappe.

### 7.2 Procédure

```bash
# 1. Créer une base PostgreSQL vide et dédiée (ne jamais réutiliser la base de production)
createdb -h 127.0.0.1 -U mc_user mauritius_compta_restore

# 2. Vérifier l’archive
cd apps/api
npm run backup -- verify ./backups/<archive>.mcbackup

# 3. Restaurer dans un répertoire de stockage neuf
BACKUP_RESTORE_ENABLED=true \
npm run backup -- restore ./backups/<archive>.mcbackup \
  --target postgresql://mc_user:...@127.0.0.1:5432/mauritius_compta_restore \
  --storage /tmp/mauritius-compta-restore \
  --confirm <backup-id>
```

La CLI applique les migrations sur la cible vide, compare **exactement** la liste des migrations et
leurs checksums à ceux du manifeste, puis insère toutes les tables dans l’ordre des clés étrangères.
Elle :

- désactive uniquement les triggers `USER` le temps de la transaction (les triggers métier
  d’immuabilité refuseraient un chargement légitime) ;
- laisse actives les clés étrangères et les contraintes `CHECK` ;
- reconstruit les séquences `serial`/`identity` à partir des données restaurées ;
- re-vérifie le nombre de lignes et le SHA-256 de chaque table ;
- re-vérifie les contrôles comptables : nombre de sociétés, utilisateurs, écritures validées,
  lignes, débits, crédits par société, pièces jointes ;
- écrit les fichiers dans un répertoire temporaire, puis le renomme après validation de la base ;
- ajoute un événement `backup.restore` dans `audit_log`.

Le rôle PostgreSQL utilisé pour la restauration doit être propriétaire des tables (nécessaire pour
`ALTER TABLE ... DISABLE TRIGGER USER`). Ce n’est pas nécessairement le rôle applicatif de production.

### 7.3 Après restauration

1. Démarrer une instance **isolée** pointant vers la base restaurée et le répertoire restauré.
2. Vérifier le nombre de sociétés, la balance, le bilan et les pièces jointes.
3. Se reconnecter : les sessions sont exclues, donc tous les utilisateurs doivent se reconnecter.
4. Consigner la date, l’archive, le SHA-256, la durée, l’opérateur et le résultat.
5. Ne pas basculer la production avant validation métier et autorisation.

### 7.4 En cas d’échec

La base est chargée dans **une seule transaction** : une erreur annule les insertions. Le répertoire
temporaire de fichiers est supprimé. Si l’échec intervient après l’application des migrations, la
base cible contient le schéma mais aucune donnée ; il faut la **supprimer et la recréer** avant une
nouvelle tentative, car une base non vide est refusée.

## 8. Export complet d’une société

Interface : **Settings → Data Management → Exporter les données de la société**.
API : `POST /api/companies/:companyId/exports`, puis téléchargement protégé.

L’export est réservé à un administrateur de la société (`owner`, `admin` ou `cabinet_admin`) qui
dispose aussi de l’administration du module paie. Un comptable ou un gestionnaire de paie sans rôle
administrateur est refusé.

Contenu :

- `data/company.json` : identification de la société ;
- `data/users.json` : membres, rôle, nom, e-mail, **sans hash de mot de passe ni session** ;
- toutes les tables portant `company_id`, plus les tables enfants sans `company_id`
  (`ai_entry_proposal_lines`, `ai_messages`, `migration_uploads`, `payroll_calculation_lines`) ;
- `csv/accounts.csv`, `csv/journals.csv`, `csv/journal_entries.csv`, `csv/journal_lines.csv` ;
- `csv/trial_balance.csv` (écritures validées uniquement), `csv/general_ledger.csv` ;
- `csv/billing_documents.csv`, `csv/billing_payments.csv`, `csv/purchase_documents.csv`,
  `csv/fixed_assets.csv`, `csv/inventory_items.csv`, `csv/payroll_employees.csv` ;
- `storage/...` : documents originaux de cette société uniquement ;
- `manifest.json` avec un SHA-256 pour chaque table, chaque fichier et chaque entrée CSV/JSON.

Un export est **portable mais non restaurable** : il ne contient ni les autres sociétés, ni les
tables globales nécessaires à une base autonome. Aucun import automatique de dossier n’est proposé
dans COMPTAI 0.1.1. Un import futur devra être un parcours distinct, avec validation humaine et
nouveaux identifiants, et non une restauration déguisée.

## 9. Isolation multi-société et permissions

| Opération | Contrôle |
|---|---|
| Sauvegarde globale | session valide + adresse dans `BACKUP_ADMIN_EMAILS` |
| Historique global / téléchargement / vérification | même liste blanche |
| Export société | membre `admin` de **cette** société + accès `admin` au module paie + phrase configurée |
| Liste/téléchargement/vérification d’un export | membre `admin` de la société de l’export ; une autre société reçoit `404` |
| Fichiers d’un export | références filtrées par `company_id` ; propriétaire de fichier vérifié |
| Restauration | CLI uniquement, hors HTTP |
| Paie | jamais exportée pour un rôle sans administration paie |
| Archive publique | aucune route statique, aucun répertoire web, téléchargement authentifié `no-store` |

## 10. Tests et mesures

Commande API ciblée :

```bash
npm run test -w @mc/api -- tests/mission34-backup.test.ts
```

Le fichier `apps/api/tests/mission34-backup.test.ts` couvre : création chiffrée, manifeste,
vérification, altération interne, troncature, chemin malveillant, taille décompressée, restauration
sur base vide, deux sociétés, fichiers, utilisateurs, contrôles comptables, refus d’une base non
vide, mauvaise confirmation, interruption avec rollback, export d’une seule société, absence de
hash de mot de passe, refus d’un rôle comptable, isolation inter-société, absence de route HTTP de
restauration, audit et sauvegarde incomplète.

### 10.1 Mesure locale (ne pas extrapoler)

| Paramètre | Valeur mesurée |
|---|---|
| Environnement | bac à sable Linux, Node 22, PGlite (PostgreSQL compilé en WASM), stockage local |
| Jeu de données | 2 sociétés fictives, 2 écritures validées, 2 pièces jointes, 103 lignes, 137 tables |
| Archive | 32 035–32 065 octets selon le passage |
| Sauvegarde | **312–373 ms** selon le passage |
| Restauration sur base vide | **1 177–9 737 ms** selon le passage |
| Vérification d’intégrité | incluse dans le test ciblé ; quelques secondes |

Ces valeurs mesurent un **très petit jeu de données dans le bac à sable**, pas une performance de
production. Le job CI PostgreSQL exécute la même restauration sur un serveur PostgreSQL dédié ; sa
durée n’est pas utilisée comme engagement de reprise (RTO).

## 11. Limites assumées

1. **Compatibilité inter-moteurs non garantie** : la restauration est testée sur PGlite (bac à sable)
   et sur PostgreSQL 16 (CI). Le format est logique, mais les empreintes de tables peuvent différer
   entre un dump PGlite et un serveur PostgreSQL (formats de dates et de `timestamptz`). Une archive
   destinée à la production doit être produite par le même moteur PostgreSQL que la cible.
2. **Pas de sauvegarde planifiée** : la commande existe, le planificateur (cron/systemd timer),
   la rétention et la supervision restent à configurer sur l’infrastructure cible.
3. **Pas de stockage distant** : aucune copie S3/objet, aucune règle d’immutabilité, aucune
   séparation géographique. Copier l’archive chiffrée hors site reste une opération d’exploitation.
4. **Pas de PITR/WAL** : le snapshot logique donne un point cohérent, pas une reprise à la seconde.
5. **Pas de rotation de phrase** : changer `BACKUP_ENCRYPTION_KEY` rend les anciennes archives
   illisibles. Une rotation doit conserver les anciennes phrases dans un coffre et documenter la
   période de compatibilité.
6. **Mémoire** : le ZIP est construit en mémoire. `BACKUP_MAX_BYTES` et
   `BACKUP_MAX_UNCOMPRESSED_BYTES` bornent la taille ; au-delà, la sauvegarde échoue. Un jeu de
   données volumineux exigera un archivage en flux.
7. **Pas d’import de dossier** : l’export est portable, pas réimportable automatiquement.
8. **Pas de sauvegarde des sessions** : après restauration, reconnexion obligatoire.
9. **Pas de garantie de conformité réglementaire de conservation** : les durées doivent être
   fixées par le cabinet (P2-12).
10. **Pas de test sur infrastructure réelle** : aucun VPS, aucun stockage objet, aucune clé réelle
   n’ont été configurés dans cette mission.

## 12. Codes d’erreur utiles

| Code | Signification |
|---|---|
| `BACKUP_KEY_NOT_CONFIGURED` | phrase absente ou trop courte |
| `BACKUP_ADMIN_NOT_CONFIGURED` | liste blanche absente |
| `BACKUP_FORBIDDEN` | compte hors liste blanche |
| `BACKUP_PAYROLL_FORBIDDEN` | export société demandé sans administration paie |
| `BACKUP_ARCHIVE_INVALID` | enveloppe ou ZIP invalide, entrée manquante, chemin dangereux |
| `BACKUP_DECRYPTION_FAILED` | mauvaise phrase ou archive modifiée |
| `BACKUP_MANIFEST_INVALID` | manifeste incomplet, incohérent ou non supporté |
| `BACKUP_INTEGRITY_FAILED` | empreinte de table, fichier ou archive différente |
| `BACKUP_TOO_LARGE` | archive ou contenu décompressé au-delà des limites |
| `BACKUP_FILE_MISSING` | document référencé absent du stockage |
| `BACKUP_CROSS_COMPANY_FILE` | fichier attribué à une autre société |
| `BACKUP_TARGET_NOT_EMPTY` | base cible non vide |
| `BACKUP_STORAGE_NOT_EMPTY` | répertoire de stockage cible non vide |
| `BACKUP_SCHEMA_MISMATCH` | migrations de l’archive différentes de la cible |
| `BACKUP_CONFIRMATION_REQUIRED` | `--confirm` absent ou différent de l’identifiant |
| `BACKUP_NOT_RESTORABLE` | export société présenté comme sauvegarde |
| `BACKUP_RESTORE_BLOCKED` | restauration désactivée, production ou même base |
| `BACKUP_RESTORE_VERIFICATION_FAILED` | contrôles de lignes, empreintes ou comptabilité différents |

## 13. Portes de sortie avant une vraie reprise

- [ ] phrase de chiffrement générée et stockée dans un coffre ;
- [ ] liste blanche nominative revue ;
- [ ] `BACKUP_DIR` sur un volume sauvegardé et surveillé, permissions vérifiées ;
- [ ] copie hors site chiffrée et testée en lecture ;
- [ ] planification et alerte en cas d’échec ;
- [ ] exercice de restauration daté sur une base PostgreSQL réelle **hors production** ;
- [ ] durée et intégrité consignées, avec un jeu de volumétrie représentatif ;
- [ ] procédure de crise et décision d’autorisation de restauration production signées ;
- [ ] test que les utilisateurs se reconnectent et que les documents sont ouvrables ;
- [ ] revue de sécurité indépendante (P0-03) et procédure d’exploitation (P1-08).

Tant que ces points ne sont pas faits, COMPTAI ne doit pas être déclaré prêt pour la production.
