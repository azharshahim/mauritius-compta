# Mauritius Business Suite — architecture

> État : mission 4 (31 octobre 2026). Le module **Cabinet** est opérationnel ; les modules
> **Comptabilité** (moteur existant, préservé), **Facturation** et **Paie & RH** sont préparés
> (tables, permissions, contrats d'intégration) mais leurs moteurs métier ne sont pas développés.

## 1. Vue d'ensemble

```
                        ┌──────────────────────────────────────────┐
                        │        Mauritius Business Suite          │
                        │  React 19 + Vite 6 + TypeScript strict   │
                        └───────────────┬──────────────────────────┘
             ┌──────────────┬───────────┴────────────┬──────────────┐
             │              │                        │              │
        ┌────▼────┐   ┌─────▼─────┐          ┌───────▼────┐   ┌─────▼─────┐
        │ CABINET │   │COMPTABILITÉ│          │ FACTURATION│   │ PAIE & RH │
        └────┬────┘   └─────┬─────┘          └───────┬────┘   └─────┬─────┘
             │              │                        │              │
             └──────────────┴───────────┬────────────┴──────────────┘
                                        │  API Fastify (une seule instance)
                                        │  permissions par module
                        ┌───────────────▼──────────────────────────┐
                        │   PostgreSQL — base commune              │
                        │   core · cabinet · accounting ·          │
                        │   billing · payroll · audit              │
                        └──────────────────────────────────────────┘
```

Principes :

- **Un seul référentiel de sociétés** : `companies` (et `company_members`) sert les quatre
  modules. Aucun second référentiel n'a été créé.
- **Une seule base PostgreSQL** ; les domaines sont séparés **par tables**, pas par base.
- **Modules indépendants au niveau code métier** : `apps/api/src/modules/cabinet`,
  `…/billing`, `…/payroll` sont des routeurs Fastify distincts ; l'interface est découpée de la
  même façon (`apps/web/src/pages/cabinet`, `…/prepared`).
- **Permissions par module** : `company_module_access` + défauts par rôle
  (`apps/api/src/lib/permissions.ts`). Un droit de paie n'implique jamais un droit comptable.
- **Aucune migration destructive** : la mission 4 ajoute `0004_cabinet.sql` (colonnes
  nullables, nouvelles tables, extension du vocabulaire de rôles). Les tables comptables de la
  V0.1.1 et leurs triggers sont inchangés.

## 2. Domaines logiques PostgreSQL

| Domaine | Tables | État |
|---|---|---|
| Core | `app_users`, `sessions`, `companies`, `company_members`, `company_settings`, `company_module_access` | opérationnel |
| Cabinet | `cabinet_tasks`, `cabinet_task_comments` (+ colonnes dossier de `companies`) | opérationnel |
| Accounting | `accounts`, `journals`, `journal_entries`, `journal_lines`, `entry_sequences`, `accounting_periods`, `exchange_rates`, `attachments` | opérationnel (V0.1.1) |
| Billing | `billing_documents` | table de fondation, **aucun moteur** |
| Payroll | `payroll_employees` | table de fondation, **aucun moteur** |
| Audit | `audit_log` (append-only), `login_attempts` | opérationnel |

Migrations (toutes reproductibles, ordre lexicographique) :

1. `0001_core.sql` — schéma initial.
2. `0002_controls.sql` — contrôles métier.
3. `0003_hardening.sql` — intégrité, isolation multi-société, audit append-only.
4. `0004_cabinet.sql` — **mission 4** : dossier (CRN, code client, responsable, archivage),
   rôles étendus, permissions par module, tâches et commentaires, fondations facturation/paie.

## 3. Espaces de l'interface

| Espace | Route de base | Sous-menus |
|---|---|---|
| Cabinet | `/cabinet` | tableau de bord, dossiers clients, tâches & échéances, collaborateurs |
| Comptabilité | `/accounting` | tableau de bord, plan comptable, écritures, grand livre, balance, états financiers, paramètres + 4 entrées annoncées (achats/OCR, banque, immobilisations, IFRS for SMEs) |
| Facturation | `/billing` | tableau de bord + clients, devis, factures, avoirs, encaissements, e-invoicing MRA (annoncés) |
| Paie & RH | `/payroll` | tableau de bord + salariés, contrats, variables, bulletins, congés, déclarations, transfert comptable (annoncés) |

Les anciennes routes V0.1 (`/entries`, `/companies`, …) redirigent vers l'espace
Comptabilité ou Cabinet : aucun lien existant n'est cassé.

## 4. Sécurité et isolation

- `requireCompany()` (comptabilité) et `requireModuleAccess()` (suite) refusent un non-membre
  par **404** — l'existence d'un dossier d'un autre cabinet n'est jamais révélée.
- Les triggers PostgreSQL (`0003`, `0004`) refusent les références croisées entre sociétés :
  journal/écriture, commentaire/tâche, affectation de tâche, accès module/membre.
- Un dossier archivé est en **lecture seule** (`COMPANY_ARCHIVED`, HTTP 409) : l'historique
  comptable reste consultable et exportable.
- Aucune donnée de paie n'est exposée à un rôle comptable : cf. `docs/permissions-matrix.md`.

## 5. Contrats d'intégration (préparés)

Les points d'entrée des futures automatisations sont décrits dans
`docs/module-integration.md` : factures fournisseurs/OCR, relevés bancaires, comptabilisation
des factures de vente, transfert de paie. Le principe commun est **idempotence + validation
humaine** : une pièce source ne peut produire qu'une seule écriture comptable.

## 6. Ce qui n'est pas dans cette mission

- Calcul de paie (PAYE, CSG, NSF), déclarations MRA, TVA, e-invoicing : **non implémentés**,
  marqués « NON IMPLÉMENTÉ » / « À VÉRIFIER » dans `docs/mauritius-regulations/`.
- Facturation : pas de numérotation, pas de calcul de TVA, pas de PDF, pas de soumission MRA.
- IFRS for SMEs complet : les états financiers actuels restent des états provisoires non
  certifiés.
