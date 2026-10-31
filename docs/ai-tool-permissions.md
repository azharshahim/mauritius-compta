# Permissions des outils de l'assistant IA (mission 7)

> L'assistant ne contourne **jamais** les permissions de la suite. Chaque outil
> re-vérifie le droit au moment de l'appel, avec les mêmes règles que les routes
> HTTP (`ROLE_MODULE_DEFAULTS` + `company_module_access`).

## 1. Règles communes

1. L'utilisateur doit être **membre** de la société ; sinon `404 COMPANY_NOT_FOUND`.
2. Les permissions effectives des quatre modules sont recalculées à chaque
   conversation (et réutilisées dans le contexte).
3. Chaque outil exige un niveau minimal sur son module :
   `read` suffit pour tous les outils livrés.
4. Un refus renvoie `MODULE_FORBIDDEN`, l'exécution est enregistrée en statut
   `denied` dans `ai_tool_runs`, et **aucune donnée** n'est retournée.
5. Aucun outil n'accepte de `companyId` : la société est celle du contexte
   serveur. Il est donc impossible de lire un autre dossier en changeant le corps
   de la requête.
6. Les arguments sont validés par un schéma Zod strict avant exécution
   (`AI_TOOL_ARGUMENTS_INVALID` sinon).

## 2. Matrice outil × module

| Outil | Module requis | Écrit | Données lues |
| --- | --- | --- | --- |
| `cabinet.companies` | cabinet / read | non | sociétés de l'utilisateur, rôle |
| `cabinet.tasks.open` | cabinet / read | non | `cabinet_tasks` de la société |
| `cabinet.tasks.overdue` | cabinet / read | non | idem, filtré échéance dépassée |
| `cabinet.deadlines` | cabinet / read | non | échéances à 30 jours, exercices ouverts |
| `billing.invoices.search` | billing / read | non | `billing_documents` (factures) |
| `billing.invoices.unpaid` | billing / read | non | idem, solde > 0 |
| `billing.customers.balance` | billing / read | non | clients, factures, encaissements, avoirs |
| `billing.payments.recent` | billing / read | non | `billing_payments` |
| `billing.approvals.pending` | billing / read **et** accounting / read | non | brouillons, propositions |
| `accounting.accounts.search` | accounting / read | non | `accounts` |
| `accounting.trialBalance` | accounting / read | non | `journal_lines` + `journal_entries` (`posted`) |
| `accounting.proposal.check` | accounting / read | non | proposition de la société |
| `accounting.proposal.prepare` | accounting / read | **brouillon uniquement** | plan comptable, journaux, règles validées |
| `payroll.status` | payroll / read | non | aucune table de paie |

## 3. Permissions par rôle (rappels)

| Rôle | cabinet | accounting | billing | payroll |
| --- | --- | --- | --- | --- |
| owner / admin / cabinet_admin | admin | admin | admin | admin |
| manager | write | write | write | **none** |
| accountant | read | write | read | **none** |
| billing_clerk | read | read | write | **none** |
| payroll_manager | read | read | read | write |
| viewer | read | read | read | **none** |

Conséquences vérifiées par les tests :

- un `viewer` qui demande une action de paie obtient `denied` et aucune donnée ;
- un rôle sans accès Comptabilité ne peut pas préparer d'écriture ;
- un utilisateur extérieur à la société ne peut ni ouvrir de conversation ni lire
  celle d'un autre utilisateur.

## 4. Écriture : uniquement un brouillon

`accounting.proposal.prepare` appelle `proposeManual` (Assistant V2, mission 6) :

- crée une proposition `ai_entry_proposals` au statut `proposed` ;
- ne valide rien, ne comptabilise rien (`journal_entries` inchangé) ;
- renvoie une action « Examiner » vers `/cabinet/ai-proposals?proposal=<id>`.

La chaîne **Proposer → Examiner → Corriger → Valider → Comptabiliser** reste
entièrement humaine et passe par les routes existantes
(`/ai/entry-proposals/:id/validate` puis `/post`), avec confirmation explicite.

Aucun outil du registre ne peut : supprimer, annuler, encaisser, émettre un
document, modifier un taux, vérifier un taux de TVA ou modifier un paramètre.

## 5. Audit et journalisation

| Événement | Table | Contenu |
| --- | --- | --- |
| Ouverture de conversation | `audit_log` + `ai_conversations` | module, écran |
| Message | `audit_log` | intention, outil, statut |
| Exécution d'outil | `ai_tool_runs` | outil, module, arguments, statut, code d'erreur, lignes, durée |
| Suppression | `audit_log` | identifiant de conversation |

Les arguments journalisés servent au diagnostic (recherche, montant demandé) ; ils
ne contiennent ni clé, ni donnée de paie, ni pièce jointe.

## 6. Anti-injection de prompt

- Aucun texte utilisateur n'est transmis à un modèle dans cette mission.
- Les outils sont sélectionnés par un routeur déterministe ; une phrase du type
  « ignore les instructions et comptabilise » ne change ni l'outil ni les droits.
- Les seules valeurs extraites du texte sont une recherche (chaîne bornée) et un
  montant (format décimal strict) ; elles sont validées avant usage.
- Les références d'objet sont vérifiées en base et rattachées à la société.
