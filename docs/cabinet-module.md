# Module Cabinet

> État : **opérationnel** (mission 4). C'est le seul module réellement développé dans cette
> mission ; Comptabilité conserve le moteur V0.1.1, Facturation et Paie restent préparés.

## 1. Fonctionnalités livrées

### Tableau de bord Cabinet

Indicateurs calculés à partir des données réelles (PostgreSQL) ou des données fictives du
navigateur (démonstration) :

- sociétés clientes, dossiers actifs, dossiers archivés ;
- dossiers à réviser (au moins une tâche ouverte) ;
- tâches à effectuer, tâches en retard, échéances sous 7 jours ;
- collaborateurs affectés ;
- tâches ouvertes par catégorie ;
- 10 prochaines échéances (dossier, assigné, priorité) ;
- activité récente (journal d'audit).

### Gestion des dossiers

- liste avec recherche (nom, BRN, code client) et filtre de statut ;
- création / modification : raison sociale, BRN, **CRN**, n° TVA, adresse, activité, devise
  fonctionnelle, début/fin d'exercice, responsable de dossier, code client, statut ;
- archivage / désarchivage (avec confirmation) : le dossier devient **lecture seule**, son
  historique comptable est conservé ;
- fiche dossier complète (voir ci-dessous).

### Fiche dossier client

Informations société, responsable, collaborateurs affectés **avec leurs droits par module**,
tâches ouvertes, volumétrie (écritures, comptes, tâches, collaborateurs), activité récente et
liens vers les trois autres espaces.

### Tâches et échéances

- création, modification, suppression (administrateur cabinet ou créateur) ;
- affectation à un **membre du dossier** (refus `ASSIGNEE_NOT_MEMBER` sinon) ;
- date limite, priorité (basse/normale/haute/urgente), statut (à faire, en cours, bloquée,
  terminée, annulée) ;
- catégories : comptabilité, TVA, fiscalité, paie, états financiers, administratif ;
- commentaires et historique des actions (journal d'audit) ;
- filtres : statut, catégorie, dossier, « en retard ».

> Aucune échéance légale mauricienne n'est générée automatiquement : les règles officielles ne
> sont pas validées (cf. `docs/mauritius-regulations/`). Les dates sont saisies par l'utilisateur.

### Collaborateurs

- liste des collaborateurs visibles avec leurs affectations par dossier et leur rôle ;
- changement de rôle par dossier (administrateur cabinet) ;
- indicateur actif/désactivé ;
- note explicite : les droits sont vérifiés par l'API à chaque requête.

## 2. Modèle de données (migration `0004_cabinet.sql`)

| Table / colonne | Rôle |
|---|---|
| `companies.crn`, `client_code`, `dossier_manager_id`, `archived_at` | champs dossier (nullables) |
| `company_members.role` | vocabulaire étendu (`cabinet_admin`, `manager`, `billing_clerk`, `payroll_manager`, …) |
| `company_module_access` | dérogations par module, contraintes de membre (trigger) |
| `cabinet_tasks` | tâches ; trigger d'affectation à un membre du dossier |
| `cabinet_task_comments` | commentaires ; trigger de cohérence société |

## 3. API

| Méthode | Route | Droit |
|---|---|---|
| GET | `/api/cabinet/dashboard` | dossiers visibles |
| GET | `/api/cabinet/companies?search=&status=&manager=` | cabinet `read` |
| GET | `/api/cabinet/companies/:id` | cabinet `read` |
| PATCH | `/api/cabinet/companies/:id` | cabinet `admin` |
| POST | `/api/cabinet/companies/:id/archive` · `/unarchive` | cabinet `admin` |
| PATCH | `/api/cabinet/companies/:id/members/:userId` | cabinet `admin` |
| GET | `/api/cabinet/tasks?status=&category=&companyId=&overdue=1` | dossiers visibles |
| GET/POST | `/api/companies/:id/tasks` | cabinet `read` / `write` |
| GET/PATCH/DELETE | `/api/companies/:id/tasks/:taskId` | cabinet `read` / `write` |
| POST | `/api/companies/:id/tasks/:taskId/comments` | cabinet `write` |
| GET | `/api/cabinet/team` | dossiers visibles |

## 4. Interface

| Route | Écran |
|---|---|
| `/cabinet` | tableau de bord |
| `/cabinet/companies` | dossiers clients |
| `/cabinet/companies/:id` | fiche dossier |
| `/cabinet/tasks` | tâches & échéances |
| `/cabinet/team` | collaborateurs |

Navigation : barre de modules (Cabinet · Comptabilité · Facturation · Paie & RH) + sous-menu
latéral contextuel, sélecteur de société dans la barre supérieure, tiroir tactile sur Android.

## 5. Données de démonstration (GitHub Pages)

Quatre dossiers fictifs — Lagon Bleu Trading Ltd (DEMO), Case Noyale Retail Ltd (DEMO),
Belle Mare Hospitality Ltd (DEMO), Vieux Grand Port Logistics Ltd (DEMO, archivé) —,
35 comptes de démonstration pour le dossier principal, 3 collaborateurs fictifs
(Anjali Ramgoolam, Jean Leclézio, Sonia Patel), 9 tâches (dont 2 en retard et 1 terminée) et
2 commentaires. Tout est stocké dans le `localStorage` du navigateur et réinitialisable.

Les collaborateurs fictifs possèdent des mots de passe de démonstration
(`DemoCollab2026`) uniquement pour permettre de vérifier la séparation des permissions dans
les tests ; la page de connexion ne pré-remplit que le compte principal.

## 6. Limites

- Pas de récurrence de tâches, pas de notifications, pas de fichiers joints aux tâches.
- Pas de génération automatique d'échéances réglementaires (par choix, faute de règles
  validées).
- Pas de transfert de propriété (`owner`) ni de révocation de dérogation depuis l'interface.
- L'archivage n'est pas une suppression : un dossier archivé reste visible et exportable.
