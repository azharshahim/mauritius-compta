# Migration comptable — architecture

> Mission 8. Importer un cabinet existant (Excel/CSV, exports Sage ou SAP)
> **sans créer une seconde base comptable** et **sans modifier le moteur
> comptable**. Toute écriture importée passe par le même service que la saisie
> manuelle ; le reporting n'est jamais alimenté directement.

## 1. Périmètre

| Pris en charge | Non pris en charge (documenté) |
|---|---|
| Plan comptable, soldes d'ouverture, écritures et journaux | Paie, bulletins, déclarations sociales |
| Clients / fournisseurs (si le modèle cible est compatible) | Connexion directe à Sage, SAP ou à une base tierce |
| Multi-sociétés avec correspondance **explicite** | Affectation automatique par ressemblance de nom |
| CSV, TSV, XLSX (multi-feuilles), profils Sage/SAP expérimentaux | Macros, formules exécutées, OLE/objets imbriqués |
| Prévisualisation, contrôles, validation humaine, rapport | Import « en un clic » sans confirmation |

## 2. Flux en six étapes

```
1 Source            → cabinet, société cible, type d'import, profil
2 Téléversement     → format, taille, feuilles, détection des colonnes, aperçu
3 Correspondances   → colonne ↔ champ MBS (auto + manuel), compte ↔ compte
4 Contrôles         → bloquants vs avertissements, avant toute écriture
5 Prévisualisation  → différences (create / skip / changed / conflit)
6 Validation        → confirmation explicite + import transactionnel + rapport
```

Étapes 1 à 5 : **lecture seule**. Aucun `INSERT` comptable n'est exécuté avant
l'appel `POST …/jobs/:id/import` avec `{ "confirm": true }`.

## 3. Code

| Fichier | Rôle |
|---|---|
| `apps/api/src/modules/migration/parse.ts` | CSV/TSV/XLSX → feuilles, lignes, encodages, limites |
| `…/normalize.ts` | montants, dates, devises, en-têtes (FR/EN), détection de type |
| `…/profiles.ts` | profils déclarés (générique, Sage 50/200/Accounting, SAP) et scoring de colonnes |
| `…/validate.ts` | contrôles déterministes → findings `blocking` / `warning` |
| `…/service.ts` | cycle de vie du lot, prévisualisation, import transactionnel, rapport, purge |
| `…/hash.ts` | empreintes SHA-256 (contenu, clé d'idempotence) |
| `…/routes.ts` | routes Fastify, permissions, limites, export CSV |
| `apps/web/src/demo/migration.ts` | même moteur, état fictif localStorage (démo Pages) |
| `apps/web/src/pages/cabinet/Migration.tsx` | assistant 6 étapes + historique + modèles |

Le moteur de parsing/validation est **partagé** entre l'API et la démo
(imports depuis `@mc/api` côté web en mode démo) : une règle corrigée l'est pour
les deux.

## 4. Modèle de données (additif, `0008_migration.sql`)

| Table | Contenu |
|---|---|
| `migration_jobs` | lot : cabinet, société, type, source, statut, empreinte, clé d'idempotence, mapping, options, résumé |
| `migration_uploads` | feuilles parsées (JSONB), taille, nom de fichier — **fichier binaire non conservé** |
| `migration_templates` | modèles de correspondance par cabinet, société et type |
| `migration_findings` | contrôles (code stable, sévérité, ligne, colonne, message FR/EN) |
| `migration_batches` | exécution d'import : compteurs, totaux, rapport |
| `migration_records` | clés externes traitées (`account:<code>`, `entry:<key>`, …), action, empreinte |
| `migration_events` | audit (`job.created`, `mapping_updated`, `imported`, `failed`, `cancelled`, `purged`) |

Aucune table existante n'est modifiée. Les statuts sont : `uploaded`,
`mapped`, `previewed`, `importing`, `imported`, `failed`, `cancelled`.

## 5. Import transactionnel

1. Re-vérification serveur de l'appartenance cabinet/société et des permissions.
2. Recalcul complet des contrôles (jamais la confiance dans l'aperçu client).
3. Refus si `blocksImport` (`errors > 0`, ou aucune ligne importable).
4. Une seule transaction : plan comptable → soldes d'ouverture → écritures.
5. Écritures créées via `postEntryTx` (moteur existant) : numérotation,
   période ouverte, audit et balance restent ceux de l'application.
6. Verrou par clé d'idempotence ; en cas d'erreur, rollback complet et statut
   `failed` — **aucune écriture partielle**.

## 6. Idempotence

Clé = SHA-256 de `[cabinetId, companyId, kind, source, empreinte du fichier]`.
Les enregistrements traités conservent en plus une clé métier stable
(`account:<code>`, `opening:<code>`, `entry:<clé externe>`, `customer:<nom>`).
Un réimport identique renvoie des lignes `skip` et la même clé ; aucune écriture
comptabilisée n'est jamais écrasée silencieusement (`changed` = conflit explicite).

## 7. Limites assumées

- `MIGRATION_MAX_ROWS=5000` lignes par feuille (configurable) ; upload ≤ 8 Mo.
- Rétention des lots et aperçus : `MIGRATION_RETENTION_DAYS=30` jours, purge
  manuelle ou planifiée ; aucune sauvegarde du fichier source.
- Les profils Sage/SAP sont des **formats de fichiers**, pas des connecteurs.
- Aucune compatibilité universelle ni certification : voir
  [`migration-sage.md`](migration-sage.md) et [`migration-sap.md`](migration-sap.md).
- Pas de rapprochement automatique de société par nom ; une correspondance
  explicite (BRN/CRN) est obligatoire.
- Cost center SAP et axes analytiques : lus mais **non importés**
  (`NON IMPLÉMENTÉ`) — aucun axe analytique n'existe encore dans le modèle.

## 8. Tests

Voir [`mission-8-report.md`](mission-8-report.md) et
[`test-report.md`](test-report.md). Les 20 scénarios obligatoires sont couverts
par `apps/api/tests/migration.test.ts` (22 cas) sur PostgreSQL réel en CI.
