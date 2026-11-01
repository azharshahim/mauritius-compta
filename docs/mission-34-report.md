# Mission 34 — P0-02 : sauvegarde, restauration et export complet des dossiers

**Date :** 1er novembre 2026
**Branche :** `arena/adbdb792-mauritius-compta`
**Base :** `main` = `3a31f0639c16f631c3765057f15791a3629d6b70` (fusion de la PR nº14)
**Version :** COMPTAI 0.1.1
**Nature :** nouvelle capacité d’exploitation, sans modification des règles comptables, fiscales ou
de paie, sans donnée réelle et sans configuration de l’infrastructure de production.

**Documents liés :** [guide sauvegarde/restauration](./backup-restore-guide.md) · [registre des
écarts](./comptai-preproduction-gaps.md) · [audit mission 32](./mission-32-audit.md) · [rapport
mission 33](./mission-33-report.md)

## 1. Résultat en une seule phrase

COMPTAI dispose désormais d’une **sauvegarde chiffrée et manifestée** de PostgreSQL et des
documents hors base, d’une **restauration hors ligne vérifiée sur base vide**, d’un **export
portable par société** et d’un **écran d’administration sans bouton fictif** ; la restauration
reste impossible depuis l’API et bloquée par défaut.

## 2. Constat initial et cause exacte

L’audit de la mission 32 constatait :

- aucune procédure de sauvegarde testée ;
- aucune restauration testée sur une base vierge ;
- aucun export complet par société ;
- une documentation qui renvoyait à `pg_dump`/`pg_restore`, insuffisant car **les pièces jointes,
  documents importés et relevés bancaires sont stockés hors PostgreSQL** ;
- aucun registre des sauvegardes, aucune empreinte, aucun chiffrement et aucune séparation entre
  l’export d’un dossier et une sauvegarde globale.

L’inventaire de la mission 34 confirme **141 tables publiques**, dont **137 sauvegardées**, et
**trois familles de fichiers hors base** :

| Stockage | Référence en base |
|---|---|
| `STORAGE_DIR/<companyId>/<fichier>` | `attachments.stored_name` |
| `STORAGE_DIR/documents/<companyId>/<id>.<ext>` | `document_imports.storage_key` |
| `STORAGE_DIR/bank-statements/<companyId>/<hash>-<nom>` | `bank_imports.summary.source.storageKey` |

Les quatre tables exclues sont `schema_migrations`, `sessions`, `login_attempts` et `backup_runs`
(voir le guide pour la justification).

## 3. Solution retenue

### 3.1 Snapshot logique plutôt qu’un simple `pg_dump`

Chaque table est lue dans une transaction `REPEATABLE READ READ ONLY`, sérialisée en JSON et
accompagnée d’un SHA-256. Les montants `numeric` restent des chaînes : aucun flottant JavaScript
n’intervient. La restauration utilise `json_populate_recordset(null::table, ...)`, insère dans
l’ordre des clés étrangères et re-vérifie chaque table avant de valider la transaction.

Ce choix est indépendant du fournisseur PostgreSQL et permet de vérifier les données après
restauration. Il ne remplace pas une sauvegarde physique/WAL et ne prétend pas offrir une reprise
à la seconde (PITR).

### 3.2 Archive chiffrée et manifeste

- Enveloppe **AES-256-GCM** avec sel scrypt aléatoire, IV aléatoire et AAD.
- Phrase de chiffrement d’au moins 16 caractères, jamais stockée.
- ZIP interne : `manifest.json`, `database/<table>.json` ou `data/*.json`, `storage/...`.
- SHA-256 par table, par fichier, par entrée CSV/JSON et pour l’archive complète.
- Écriture atomique dans `BACKUP_DIR` (`.tmp` puis `rename`), permissions `0700`/`0600`.
- Taille maximale compressée et décompressée configurable.

### 3.3 Restauration uniquement hors ligne

Aucune route HTTP de restauration n’existe. La CLI refuse :

- une base cible non vide ;
- un répertoire de stockage non vide ;
- une confirmation différente de l’identifiant du manifeste ;
- une cible identique à `DATABASE_URL` ;
- une archive dont l’historique de migrations diffère ;
- une archive corrompue, incomplète ou dont une empreinte diffère ;
- une restauration sans `BACKUP_RESTORE_ENABLED=true` ;
- une restauration en production sans drapeau et autorisation explicites.

La transaction unique annule les insertions en cas d’échec, et le répertoire de fichiers temporaire
est supprimé.

### 3.4 Export par société

L’export est un ZIP chiffré `.mcexport` contenant l’identification de la société, ses membres sans
hash de mot de passe, **toutes les tables portant `company_id`**, les tables enfants qui en
dépendent, des CSV comptables (plan, journaux, écritures, balance, grand livre, facturation, achats,
immobilisations, stocks, paie), les documents de cette société et un manifeste.

Il est explicitement **non restaurable** et aucun import automatique n’est proposé : l’interface et
le manifeste le disent. Un comptable ou un gestionnaire de paie sans rôle administrateur ne peut
pas l’obtenir.

## 4. Fichiers livrés

| Fichier | Nature |
|---|---|
| `apps/api/src/backup/crypto.ts` | enveloppe AES-256-GCM, scrypt, refus des mauvaises phrases |
| `apps/api/src/backup/archive.ts` | ZIP, manifeste, empreintes, chemins sûrs, limites de taille |
| `apps/api/src/backup/database.ts` | snapshot, ordre des FK, contrôles comptables, restauration |
| `apps/api/src/backup/service.ts` | sauvegarde globale, export société, vérification, restauration |
| `apps/api/src/backup/routes.ts` | API administrateur, téléchargements protégés, aucun restore HTTP |
| `apps/api/src/backup/cli.ts` | CLI `create-global`, `export-company`, `verify`, `restore` |
| `apps/api/sql/migrations/0024_backup_restore.sql` | table `backup_runs` |
| `apps/api/src/config.ts` | `BACKUP_DIR`, clé, liste blanche, limites, drapeau de restauration |
| `apps/api/src/app.ts` | enregistrement des routes de sauvegarde |
| `apps/api/src/lib/errors.ts` | codes d’erreur de sauvegarde/restauration |
| `apps/api/tests/mission34-backup.test.ts` | 8 tests de sauvegarde, restauration, export et sécurité |
| `apps/web/src/pages/settings/DataManagement.tsx` | écran Settings → Data Management |
| `apps/web/src/api.ts` | téléchargement binaire authentifié |
| `apps/web/src/i18n.tsx` | libellés FR/EN |
| `apps/web/tests/mission34-data-management-ui.test.tsx` | preuve que rien n’est simulé en démo |
| `.github/workflows/ci.yml` | base PostgreSQL dédiée pour la restauration réelle |
| `README.md`, `.env.example` | procédure et configuration |
| `docs/backup-restore-guide.md` | guide technique et runbook |
| `docs/comptai-preproduction-gaps.md` | statut P0-02 et suivi d’exploitation |

## 5. Contrôles d’intégrité et contrôles comptables

Le manifeste et la restauration contrôlent :

- nombre de lignes et SHA-256 de chaque table ;
- SHA-256 de chaque fichier et de chaque entrée supplémentaire ;
- nombre de sociétés, d’utilisateurs, d’écritures validées et de lignes ;
- total des débits et des crédits, global et par société ;
- nombre et taille des pièces jointes ;
- présence et hash des documents restaurés ;
- nombre de tables restaurées ;
- absence de sessions et d’historique de sauvegardes dans la cible ;
- ajout d’un événement d’audit `backup.restore` après restauration réussie.

Les écritures, montants, journaux et règles de paie ne sont pas recalculés ni modifiés. Aucun taux,
seuil ou règle n’a été inventé.

## 6. Sécurité et isolation multi-société

| Exigence | Mise en œuvre |
|---|---|
| Société A ne peut pas exporter B | filtre `company_id` et vérification du propriétaire des fichiers ; test croisé |
| Sauvegarde globale non autorisée | liste blanche `BACKUP_ADMIN_EMAILS` ; test 403 |
| Paie non exposée à un rôle comptable | export réservé à un administrateur avec accès paie admin ; test 403 |
| Fichiers joints et liens protégés | téléchargement authentifié, `no-store`, aucune route statique |
| Archives non publiques | `BACKUP_DIR` hors `STORAGE_DIR` et hors build web |
| Fichiers temporaires | `.tmp` supprimés ; restauration dans un répertoire temporaire nettoyé |
| Opérations sensibles auditées | `backup.create`, `backup.verify`, `backup.download`, `company.export`, `company.export.verify`, `company.export.download`, `backup.failed`, `company.export.failed` |
| Archive corrompue | tag GCM + empreintes internes ; tests altération/troncature |
| Secrets techniques | phrase absente de l’archive, de la base, des logs et des réponses ; sessions exclues |
| Archives malveillantes | rejet des chemins absolus, `..`, antislashs, NUL, taille décompressée excessive |
| Écrasement accidentel | base et stockage cibles vides obligatoires, confirmation par identifiant |

## 7. Tests avant / après

### 7.1 Avant la mission

Aucun test de sauvegarde, de restauration ou d’export complet. Le README ne proposait que
`pg_dump`/`pg_restore`, sans les documents hors base, sans manifeste, sans chiffrement et sans
vérification d’intégrité.

### 7.2 Après la mission

| Vérification | Résultat |
|---|---|
| Test ciblé mission 34 | **8 réussis / 8** |
| API complète | **507 réussis, 11 ignorés, 0 échec** (518 tests, 34 fichiers passés + 1 ignoré) |
| Web complet | **290 réussis, 0 échec** (46 fichiers) |
| Typecheck API + web | **0 erreur** |
| Build de production | **succès** |
| Test UI mission 34 | **1 réussi** : boutons désactivés en démo, aucun appel réseau |
| CI avec PostgreSQL réel | **4/4 verts** : typecheck/tests/build, tests API PostgreSQL, migrations PostgreSQL, build démo |

Les 11 tests API ignorés localement le sont faute de `TEST_DATABASE_URL` ; le job CI les exécute.
Le job CI prépare en plus une base `mauritius_compta_restore` vide pour que la **restauration soit
exécutée sur un vrai serveur PostgreSQL**, pas seulement sur PGlite.

Couverture du test ciblé :

1. sauvegarde chiffrée de deux sociétés avec manifeste, pièces jointes et contrôles ;
2. vérification, altération du chiffré, troncature, table modifiée, table absente, chemin
   malveillant, limite de taille décompressée ;
3. restauration sur base vide et comparaison des sociétés, écritures, utilisateurs, sessions et
   fichiers ;
4. refus d’une base non vide, d’une mauvaise confirmation et rollback d’une restauration
   interrompue ;
5. export d’une seule société, absence de hash de mot de passe, refus d’un rôle comptable,
   refus de restaurer un export ;
6. autorisation API, absence de route HTTP `restore`, téléchargement protégé, isolation croisée ;
7. historique et audit sans phrase de passe ni chemin interne ;
8. refus d’une sauvegarde incomplète lorsqu’un document référencé a disparu.

### 7.3 Mesure de volume

| Paramètre | Valeur mesurée |
|---|---|
| Environnement | Linux, Node 22, PGlite WASM, stockage local |
| Volume | 2 sociétés fictives, 103 lignes, 137 tables, 2 pièces jointes |
| Archive | 32 035–32 065 octets selon le passage |
| Sauvegarde | 312–373 ms selon le passage |
| Restauration | 1 177–9 737 ms selon le passage |

Ces chiffres proviennent du test local sur un **très petit volume**. Ils ne constituent ni un
engagement de RTO/RPO, ni une mesure de production. Aucune durée n’a été inventée pour
l’infrastructure cible, qui n’a pas été utilisée.

## 8. Limites explicites

1. **Compatibilité inter-moteurs non garantie** : le format est logique, mais une archive produite par
   PGlite peut voir ses empreintes de dates différer lors d’une restauration PostgreSQL. La cible de
   production doit produire et restaurer avec le même moteur.
2. **Pas de planification** : aucun cron, timer, rétention ou supervision configurés.
3. **Pas de stockage distant** : pas de copie objet/S3, pas d’immutabilité, pas de site secondaire.
4. **Pas de PITR/WAL** : snapshot logique cohérent, pas de reprise à la seconde.
5. **Pas de rotation de phrase** : les anciennes archives deviennent illisibles si la clé change
   sans conservation des anciennes phrases.
6. **Traitement en mémoire** : borné par configuration ; un très gros dossier exigera un flux.
7. **Pas d’import de dossier** : l’export n’est pas une restauration et ne s’importe pas
   automatiquement.
8. **Sessions perdues** : reconnexion obligatoire après restauration.
9. **Restauration non exposée à l’interface** : volontaire, pour empêcher un écrasement accidentel.
10. **Aucun test sur le VPS OVH** : l’infrastructure réelle n’a pas été configurée, conformément aux
    restrictions de la mission.
11. **Restauration et stockage réels non testés** : le CI couvre PostgreSQL, pas un stockage objet
    ni un basculement de production.

## 9. Statut final de P0-02

| Aspect | Statut |
|---|---|
| Sauvegarde PostgreSQL | **Implémentée et testée** |
| Documents hors base | **Inclus et vérifiés** |
| Manifeste, empreintes, chiffrement | **Implémentés** |
| Restauration sur base vide | **Implémentée et testée** |
| Restauration sur PostgreSQL réel en CI | **Testée dans le job dédié, vert** |
| Export complet par société | **Implémenté, testé, non restaurable** |
| Isolation multi-société | **Testée** |
| Traçabilité | **`backup_runs` + `audit_log`** |
| Sauvegarde planifiée et stockage distant | **Non implémentés — suivi d’exploitation** |
| Exercice de reprise sur infrastructure cible | **Non réalisé — infrastructure non autorisée** |

**Conclusion :** le blocage **technique** de P0-02 est levé : COMPTAI sait produire une sauvegarde
complète, la vérifier, la restaurer sur une base vierge et exporter un dossier. Le risque résiduel
n’est plus l’absence de mécanisme, mais l’**absence de preuve d’exploitation sur l’environnement
cible** (planification, copie hors site, exercice de reprise daté). Ce point doit rester une porte
de sortie avant production.

## 10. Recommandation

**Fusion recommandée après revue du diff et CI verte.** La mission ajoute une capacité isolée, ne
modifie aucune règle comptable, fiscale ou de paie, et ne peut pas écraser une base par une simple
requête HTTP.

**Je ne fusionne pas et je ne publie pas cette branche sans votre autorisation.** La restauration
reste désactivée par défaut et aucune sauvegarde réelle n’a été configurée sur une infrastructure.
