# Migration — sécurité, permissions et limites

## 1. Permissions serveur

Toutes les routes sont montées sous `/companies/:companyId/migration/...` et
revérifient l'appartenance réelle de l'utilisateur à la société :

| Route | Rôle minimal |
|---|---|
| `GET …/profiles`, catalogue des champs et limites | `viewer` |
| Toutes les autres routes (lots, modèles, aperçu, import, rapport) | `accountant` |

Un administrateur de cabinet ne contourne pas ce contrôle : une migration écrit
de la comptabilité, donc un rôle de consultation ne peut ni prévisualiser, ni
exporter, ni confirmer. `jobOfCompany()` vérifie en plus que le lot appartient
bien à la société de l'URL (protection contre l'IDOR) ; un lot d'une autre
société répond 404, jamais 403 avec fuite d'existence.

Les modèles de correspondance sont stockés par `cabinet_id` **et** `company_id` :
un cabinet ne voit jamais les modèles d'un autre cabinet (test 16).

## 2. Ce qui est stocké

- **jamais le fichier binaire** : uniquement les feuilles parsées, en JSONB, avec
  une date d'expiration (`expires_at`) ;
- nom de fichier, taille, empreinte SHA-256, mapping, contrôles, rapport ;
- aucune donnée de paie, aucun secret, aucun identifiant Sage/SAP.

Purge : `purgeExpiredUploads()` supprime les contenus expirés
(`MIGRATION_RETENTION_DAYS=30` par défaut) au début de chaque nouveau lot, et
`DELETE …/jobs/:id` supprime le lot, ses contrôles, ses enregistrements et son
audit associé (cascade). Un lot purgé reste listé sans contenu : il faut
re-téléverser le fichier.

## 3. Limites anti-abus

| Limite | Valeur |
|---|---|
| Taille d'upload | `min(MAX_UPLOAD_BYTES, 8 Mo)` |
| Corps HTTP | 9 Mo (marge base64/multipart) |
| Lignes par feuille | `MIGRATION_MAX_ROWS=5000` (plafond absolu 20 000) |
| Colonnes | 80 par feuille (les suivantes sont ignorées et signalées) |
| Feuilles | 20 par classeur |
| Taille décompressée XLSX | 60 Mo maximum (`MALFORMED_FILE` au-delà) |
| Cellules | 1 000 caractères maximum |

Ces limites sont exposées par `GET …/migration/profiles` et **appliquées côté
serveur**, pas seulement dans l'interface.

## 4. Fichiers malveillants

- aucun code n'est exécuté : CSV/TSV lus comme texte, XLSX décompressé en
  mémoire par `fflate` (pas d'écriture sur disque, pas de chemin d'archive) ;
- un `vbaProject.bin` fait **refuser** le classeur (`UNSUPPORTED_FORMAT`) ;
- `.xls` (BIFF) et `.xlsm` refusés, message explicite ;
- protection contre les bombes ZIP (taille décompressée plafonnée) ;
- aucune évaluation de formule : seule la valeur mise en cache est lue ;
- contenu HTML/script dans une cellule : affiché comme texte (React échappe),
  jamais interprété.

## 5. Injection CSV à l'export

Le rapport CSV (`GET …/report.csv` et le bouton de la démo) applique un
échappement systématique :

- si la cellule commence par `=`, `+`, `-`, `@`, tabulation ou retour chariot
  **et** n'est pas un nombre, un `'` est préfixé ;
- guillemets doublés, valeurs contenant `;`, `,`, `"`, saut de ligne encadrées ;
- BOM UTF-8 pour Excel, séparateur `;`.

Test dédié : un nom de compte `=cmd|' /C calc'!A0` reste inerte dans le rapport.

## 6. Audit

`migration_events` enregistre `job.created`, `mapping_updated`, `imported`,
`failed`, `cancelled`, `purged` avec acteur, IP, horodatage et métadonnées
(compteurs, clé d'idempotence, société). Les journaux applicatifs ne contiennent
ni contenu de cellule, ni fichier, ni secret ; seuls les codes d'erreur et
compteurs sont journalisés.

## 7. Ce que l'assistant IA ne peut pas faire

- aucun outil d'écriture de migration : `migration.jobs.summary` est en lecture
  seule ;
- aucune confirmation d'import par conversation (`confirm: true` vient d'une
  action humaine dans l'écran) ;
- les suggestions (colonnes, comptes) sont affichées **séparément** des contrôles
  obligatoires ; elles ne modifient ni le mapping enregistré ni le résultat de
  `blocksImport` sans action de l'utilisateur ;
- aucune donnée de migration n'est envoyée à un fournisseur IA dans la démo
  (aucun fournisseur réel n'est configuré, aucun coût).

## 8. Démonstration publique

La démo GitHub Pages utilise `localStorage` uniquement, avec une bannière
permanente et un bouton de réinitialisation. Aucun appel réseau vers l'API,
aucun fichier réel, aucun compte. Les fichiers d'exemple sont explicitement
fictifs et étiquetés comme tels.
