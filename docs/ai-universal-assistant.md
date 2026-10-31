# Assistant IA universel (mission 7)

> Statut : **implémenté en lecture seule**. Aucune règle fiscale n'est affirmée par
> l'assistant, aucune écriture n'est créée automatiquement, aucun fournisseur IA
> réel n'est appelé en démonstration.

## 1. Ce que fait l'assistant

Une pastille discrète **« ✨ Assistant IA »** est présente sur **tous les écrans
authentifiés** des quatre modules (Cabinet, Comptabilité, Facturation, Paie & RH).

- **Ordinateur** : panneau latéral en bas à droite, réductible/fermable, utilisable
  au clavier (tabulation, `Entrée` pour envoyer, `Échap` pour fermer).
- **Téléphone (Android)** : feuille plein écran (`100dvh`), bouton atteignable au
  pouce, safe-areas respectées, composeur collé en bas pour rester visible quand
  le clavier virtuel s'ouvre. **Aucun champ n'est mis au focus automatiquement** :
  ouvrir le panneau ne rouvre jamais le clavier et ne déplace jamais le curseur
  d'un formulaire en cours de saisie (règle issue du correctif Samsung mission 5).
- Le panneau **survit aux changements de module** : la conversation et le
  brouillon de question sont conservés lors d'une navigation ; une saisie de
  formulaire en cours n'est jamais détruite (le lanceur est monté hors des routes).

## 2. Contexte : construit et validé côté serveur

Le navigateur envoie seulement : `companyId`, module affiché, chemin d'écran,
langue et éventuellement une référence d'objet (`invoice`, `proposal`, `entry`,
`customer`, `company`, `task`).

Le serveur (`apps/api/src/modules/ai/assistant.ts`) :

1. vérifie que l'utilisateur est **membre** de la société (`company_members`) ;
2. recalcule les **permissions effectives** des quatre modules
   (`effectiveAccess` + `company_module_access`) ;
3. dérive le **cabinet** depuis la base (`cabinetForCompanyUser`) — jamais depuis
   le navigateur ;
4. vérifie que l'assistant est activé pour le cabinet (`ai_settings.enabled`) ;
5. valide la référence d'objet (elle doit appartenir à la société, sinon elle est
   ignorée) ;
6. nettoie l'écran (caractères autorisés, longueur bornée).

Un `companyId` fourni par le navigateur n'est donc **jamais** utilisé sans
revérification : un non-membre reçoit `404 COMPANY_NOT_FOUND`.

## 3. Orchestration

| Élément | Implémentation |
| --- | --- |
| Sessions | `ai_conversations`, une conversation ouverte par utilisateur et par société, rattachée au cabinet |
| Historique | `ai_messages`, borné à 200 messages relus et `AI_ASSISTANT_MAX_TURNS` (40 par défaut) messages utilisateur par conversation |
| Messages | rôle `user` / `assistant` (+ `system` réservé), contenu texte, contexte minimal et payload structuré |
| Contexte de navigation | module, écran, société, langue, permissions applicables, référence d'objet |
| Registre d'outils | `apps/api/src/modules/ai/tools.ts` (déclaration unique, schéma Zod par outil) |
| Exécution | serveur uniquement ; les arguments sont validés avant exécution |
| Permissions | vérifiées **à chaque appel** (`requireAccess` dans l'outil), pas seulement à l'ouverture |
| Réponses | texte déterministe + `actions` structurées + `data` lue en base |
| Erreurs | codes explicites (`MODULE_FORBIDDEN`, `AI_INPUT_INCOMPLETE`, `AI_TOOL_ARGUMENTS_INVALID`…) |
| Limitation | 120 messages utilisateur par heure et par utilisateur, plafond de messages par conversation |
| Audit | `ai.conversation.open`, `ai.conversation.message`, `ai.conversation.delete`, plus `ai_tool_runs` par outil |
| Extensibilité | ajouter un outil = une entrée dans `ASSISTANT_TOOLS` |

**Aucun dossier, aucune base et aucune donnée de paie ne sont envoyés à un
fournisseur.** Le routeur d'intentions est déterministe : le texte de
l'utilisateur n'est jamais interprété comme une instruction système, ce qui rend
l'injection de prompt sans effet sur les outils réellement exécutés. Le texte est
nettoyé (caractères de contrôle, 600 caractères) et n'est jamais concaténé dans
une requête SQL.

## 4. Intentions prises en charge (FR/EN)

| Demande | Outil |
| --- | --- |
| Factures impayées | `billing.invoices.unpaid` |
| Rechercher une facture | `billing.invoices.search` |
| Solde d'un client | `billing.customers.balance` |
| Encaissements récents | `billing.payments.recent` |
| Documents/propositions en attente | `billing.approvals.pending` |
| Tâches ouvertes / en retard | `cabinet.tasks.open` / `cabinet.tasks.overdue` |
| Échéances enregistrées | `cabinet.deadlines` |
| Sociétés accessibles | `cabinet.companies` |
| Rechercher un compte | `accounting.accounts.search` |
| Consulter la balance | `accounting.trialBalance` |
| Vérifier une proposition | `accounting.proposal.check` |
| Préparer une écriture (brouillon) | `accounting.proposal.prepare` |
| État de la paie | `payroll.status` (explique l'indisponibilité) |

Toute autre demande reçoit un refus explicite listant les demandes couvertes.

## 5. Garanties

- **Aucun chiffre inventé** : chaque montant provient d'une ligne SQL de la
  société active, après contrôle des droits.
- **Aucune action irréversible** : le seul outil qui écrit crée une *proposition
  d'écriture brouillon* via l'Assistant V2 existant. Un « oui » dans le chat
  n'autorise ni validation ni comptabilisation.
- **Paie** : l'assistant explique l'indisponibilité du module et ne lit ni
  n'invente aucune donnée de paie ; un rôle sans accès Paie reçoit un refus.
- **Aucune clé** : l'assistant n'expose jamais de credential ; le panneau ne
  demande aucune clé.

## 6. Politique de conservation

- `AI_CONVERSATION_RETENTION_DAYS` (30 jours par défaut, 1 à 3650) fixe la date
  d'expiration d'une conversation ; les conversations expirées sont supprimées à
  la création d'une nouvelle.
- L'utilisateur peut fermer (`/close`) ou supprimer (`DELETE`) sa conversation à
  tout moment ; la suppression est journalisée (`ai.conversation.delete`).
- Les conversations ne sont visibles que par leur auteur, dans leur société :
  toute lecture par un autre utilisateur renvoie `404 AI_CONVERSATION_NOT_FOUND`.
- Journal minimal : action, outil, statut ; les arguments d'outils sont stockés
  pour l'audit technique, sans données de paie ni secret.

## 7. Démonstration GitHub Pages

- La démo (`apps/web/src/demo/runtime.ts`, schéma **5**) sert les mêmes routes
  (`/ai/assistant/*`) dans le navigateur : conversation **réellement
  interactive**, alimentée par les données fictives existantes (factures
  `FAC-DEMO-0001/0002`, tâches, plan comptable, balance).
- Aucun fournisseur, aucune clé, aucun appel réseau : un test vérifie que
  `fetch` n'est jamais appelé.
- Bandeau permanent de démonstration + mention « Assistant IA en démonstration —
  aucun fournisseur externe connecté » dans le panneau.
- Cas pris en charge documentés dans le panneau (suggestions) et dans
  `docs/mission-7-report.md` ; refus clair sinon.

## 8. Configuration

| Variable | Défaut | Rôle |
| --- | --- | --- |
| `AI_ENABLED` | `true` | interrupteur global du moteur |
| `AI_ASSISTANT_MAX_TURNS` | `40` | messages utilisateur max par conversation |
| `AI_CONVERSATION_RETENTION_DAYS` | `30` | conservation configurable |
| `ai_settings.enabled` | `false` | interrupteur par cabinet (existant) |

## 9. Limites assumées

- Routeur d'intentions déterministe : pas de compréhension libre d'une question
  hors périmètre ; c'est un choix de sécurité, pas une promesse de NLP.
- Aucune génération de texte par un fournisseur dans cette mission : les
  réponses sont rédigées côté serveur à partir des lignes retournées.
- Aucun outil d'écriture métier (OCR, banque, paie, documents) : registre
  extensible, mais non implémenté.
