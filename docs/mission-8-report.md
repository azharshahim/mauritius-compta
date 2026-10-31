# Rapport de mission 8 — assistant de migration comptable

> Date : 31 octobre 2026. Branche : `arena/b0b62798-mauritius-compta`.
> Code et documentation : commit `6fa5079` (base `4784408`), poussés sur la
> branche de développement. PR nº1 (brouillon) mise à jour, **jamais fusionnée** ;
> `main` reste à `9e46f16`.

## 1. Livré

Assistant **Cabinet → Importation & migration** en six étapes : source,
téléversement, correspondances colonne ↔ champ et compte ↔ compte, contrôles,
prévisualisation sans écriture, validation humaine explicite puis import
transactionnel et rapport. Historique des lots, modèles de correspondance par
cabinet/société/type, guide et fichiers d'exemple fictifs téléchargeables.

## 2. Architecture

Voir [`migration-architecture.md`](migration-architecture.md). Le moteur est un
module isolé (`apps/api/src/modules/migration/`) : parsing, normalisation,
profils, validation, service, routes. Il **réutilise** le moteur comptable
existant (`postEntryTx`, périodes, audit, balance) ; aucune seconde base
comptable, aucune insertion directe dans le reporting, aucune modification des
règles de tenue de livres. Une migration additive `0008_migration.sql` ajoute
sept tables préfixées `migration_`.

## 3. Formats réellement lus

`.csv`, `.tsv`, `.txt`, `.xlsx` (multi-feuilles), UTF-8/BOM, UTF-16 et
Windows-1252, séparateurs `,` `;` tabulation, montants internationaux et négatifs
refusés, dates FR/EN et dates Excel. **Aucune macro ni formule n'est exécutée** ;
un classeur `vbaProject.bin` est refusé. Détails et limites :
[`migration-excel-csv.md`](migration-excel-csv.md).

## 4. Sage

Profils Sage 50 / 200 / Accounting **expérimentaux** : lecture de fichiers
d'export uniquement. Aucune connexion, aucun pilote, aucun identifiant Sage,
aucune certification. En-têtes reconnus et différences de modèle :
[`migration-sage.md`](migration-sage.md). Exemple fictif :
`apps/web/public/samples/export-sage-fictif.csv`.

## 5. SAP

Profil SAP **expérimental** : fichiers d'export plats. Company Code, G/L
Account, Posting Date, Document Number, Debit/Credit Indicator, Amount,
Currency et Cost Center sont reconnus comme en-têtes ; les champs non modélisés
(Cost Center, Document Date, Company Code) ne sont **pas importés**. Convention
`SHKZG` : `S = Soll = débit`, `H = Haben = crédit`, relue **par ligne**.
Aucune connexion RFC/BAPI/OData. Voir [`migration-sap.md`](migration-sap.md).

## 6. Multi-sociétés

Un lot cible **une** société choisie explicitement. Aucune affectation par
ressemblance de nom : la correspondance exige une clé vérifiée (BRN/CRN) et
chaque société du fichier doit être mappée. Un lot multi-sociétés dont une seule
société n'est pas résolue est bloqué. Contrôles d'isolation : un lot, un modèle
ou un rapport d'une autre société répond 404.

## 7. Correspondances

Détection automatique **bornée** (préfixe/suffixe de mot, alias ordonnés,
exclusion des en-têtes d'indicateur), toujours modifiable manuellement. Les
comptes inconnus peuvent être associés à un compte existant, créés si l'option
est cochée, ou bloquer l'import — jamais remplacés automatiquement. Modèles
enregistrés par cabinet, société et type.

## 8. Écritures et soldes d'ouverture

Regroupement par clé de pièce, équilibre vérifié **par écriture**, période
ouverte exigée, journal existant exigé, devise gérée et taux explicite. Un
déséquilibre ou un compte absent **bloque** l'import : aucune contrepartie, aucun
compte et aucun taux ne sont inventés. Les soldes d'ouverture passent par le
journal et le moteur (`migration_opening`), avec anti-double reprise
(`OPENING_ALREADY_EXISTS`).

## 9. Idempotence

Clé `SHA-256(cabinet + société + type + source + empreinte du fichier)` et clés
métier (`account:<code>`, `opening:<code>`, `entry:<clé>`). Réimport identique :
même clé, toutes les lignes en `skip`, aucune écriture. Un conflit explicite
(`changed`) n'écrase jamais une écriture comptabilisée. Une interruption laisse
un lot sans écriture partielle ; la reprise repart des contrôles serveur.

## 10. Tests exacts exécutés le 31 octobre 2026

| Suite | Commande | Résultat |
|---|---|---|
| API complète | `npm test -w @mc/api` | **184 réussis, 4 ignorés** |
| Migration API | `npx vitest run tests/migration.test.ts` | **23 réussis** |
| Assistant API | `npx vitest run tests/assistant.test.ts` | 24 réussis (dont outil migration) |
| Web complète | `npm test -w @mc/web` | **97 réussis, 10 fichiers** |
| Démo migration | `npx vitest run tests/demo-migration.test.ts` | **12 réussis** |
| UI migration (jsdom) | `npx vitest run tests/migration-ui.test.tsx` | **3 réussis** |
| Typecheck | `npm run typecheck` | 0 erreur (API + web, strict) |
| Build API | `npm run build -w @mc/api` | OK |
| Build démo | `npm run build:demo` | OK (base `/mauritius-compta/`) |

Les 20 scénarios obligatoires (P) sont numérotés 1 à 20 dans
`apps/api/tests/migration.test.ts` : CSV FR, CSV EN, XLSX multi-feuilles,
colonnes manquantes, dates invalides, montants négatifs, écriture déséquilibrée,
compte inexistant, doublon de compte, doublon d'écriture, réimport identique,
interruption/reprise, balance d'ouverture, multi-devises, société non autorisée,
isolation cabinet, lot multi-sociétés, import sans confirmation, aucune écriture
en prévisualisation, non-régression. Trois tests supplémentaires couvrent les
macros/extension refusées, le CSV anti-injection et la convention SAP `S/H`.

## 11. CI et PostgreSQL réel

CI (`.github/workflows/ci.yml`) : typecheck strict, tests API + web, build de
production, contrôle d'absence de secrets, puis deux jobs PostgreSQL 16 réels
(suite API complète et application des migrations `0001`→`0008`, rejeu
idempotent, seed, vérification des sept tables `migration_*`).

Statut du run déclenché par ce commit : **voir la section 17**, mise à jour après
le workflow. Le job PostgreSQL est indispensable : les tests de migration
utilisent des transactions et des contraintes réelles.

## 12. GitHub Pages

Workflow `pages.yml` : build démo, vérification des chaînes de migration dans le
bundle, présence des fichiers d'exemple dans `dist/samples`, publication, puis
contrôle HTTPS de l'URL publiée (page 200, bundle, `404.html`, lien profond,
téléchargement HTTP 200 de deux fichiers d'exemple fictifs). URL :
<https://azharshahim.github.io/mauritius-compta/>. Aucun serveur réel n'est
simulé : bannière permanente, `localStorage`, réinitialisation possible.

## 13. Limites explicites

- **Aucune certification Sage ni SAP**, aucune compatibilité universelle ;
  profils expérimentaux de fichiers d'export, sans connexion.
- Paie non importée ; factures historiques et règlements uniquement si le
  modèle cible est strictement compatible (sinon refus) ; axes analytiques et
  Cost Center non implémentés ; pièces jointes non reprises.
- 5 000 lignes par feuille (plafond 20 000), 8 Mo, rétention 30 jours.
- Aucun test Chrome/Samsung physique exécuté pour cette mission ; l'ergonomie
  Android est couverte par jsdom (tableaux, absence de `min-width` forcé, focus)
  et par la procédure manuelle de `docs/browser-tests.md`.
- Aucune donnée client réelle, aucun fichier réel : uniquement des exemples
  fictifs générés par `scripts/generate-migration-samples.mjs`.

## 14. Fichiers fictifs livrés

`apps/web/public/samples/` : `plan-comptable-fictif.csv`,
`plan-comptable-fictif.xlsx`, `balance-ouverture-fictive.csv`,
`journal-fictif-fr.csv`, `journal-fictif-en.tsv`, `export-sage-fictif.csv`,
`export-sap-fictif.csv`, `fichier-volontairement-incorrect.csv` (+ un
`LISEZ-MOI.txt`). Tous les codes sont hors du plan de démonstration (séries 8100+).

## 15. Sécurité

Permissions serveur (`accountant`, catalogue `viewer`), isolation cabinet et
société, limites de taille/lignes/feuilles/colonnes, refus des macros et des
archives surdimensionnées, aucun fichier binaire stocké, purge, audit
`migration_events`, export CSV neutralisé, aucun secret ni fournisseur IA réel.
Détails : [`migration-security.md`](migration-security.md).

## 16. Recommandations pour la mission 9

1. Faire valider par un expert-comptable mauricien les règles de reprise
   (exercice, ouverture, TVA) avant toute utilisation réelle.
2. Ajouter un rapport de rapprochement post-import (balance avant/après) et un
   contrôle de doublons inter-fichiers au-delà de la clé de contenu.
3. Étudier un import de factures historiques seulement après stabilisation d'un
   modèle compatible strict, avec tests dédiés.
4. Prévoir des tests de charge sur fichiers proches des plafonds et une purge
   planifiée (cron) plutôt qu'à la création du lot suivant.
5. Pour Sage/SAP : obtenir des spécifications officielles sous licence
   compatible avant toute promesse de compatibilité ; sinon conserver le statut
   expérimental.
6. Ajouter un test navigateur réel (Playwright) sur Android pour l'écran de
   migration, sans jamais forcer le focus clavier.

## 17. Statut final

- Branche : `arena/b0b62798-mauritius-compta` — commit principal `6fa5079`.
- PR nº1 : <https://github.com/azharshahim/mauritius-compta/pull/1> — **brouillon
  ouverte, non fusionnée**.
- CI / Pages : à compléter après le push (run et URL exacts consignés dans
  l'historique de la PR).
- `main` : inchangé (`9e46f16`). Aucune release, aucun déploiement OVH, aucun
  paiement.
