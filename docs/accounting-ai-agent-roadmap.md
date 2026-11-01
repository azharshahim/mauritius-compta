# Assistant IA comptable — feuille de route et architecture cible

_État au 1er novembre 2026 — mission 24. Document de conception, **aucune promesse
d’automatisation** : les phases 2 à 4 ne sont pas livrées. La seule écriture
autorisée aujourd’hui est une **proposition en brouillon**, validée par un humain
dans l’écran des propositions. Aucun fournisseur d’IA n’est présumé configuré, aucune
clé n’est présente dans le navigateur, aucune diffusion externe (e-mail, bulletin,
déclaration MRA) n’existe._

## 1. Résumé exécutif

Le produit dispose déjà de deux briques utiles et séparées :

1. un **assistant déterministe** (routeur d’intentions + outils SQL) qui lit les
   données du dossier actif avec les permissions de l’utilisateur et journalise
   chaque exécution dans `ai_tool_runs` ;
2. un **moteur IA existant** (missions 5 à 7) qui sait appeler un fournisseur
   compatible OpenAI ou Gemini, mais qui n’est **pas** utilisé par l’assistant pour
   décider ou rédiger une réponse.

La cible n’est pas de laisser un modèle écrire librement dans la comptabilité. La
cible est un **agent préparateur supervisé** : le modèle comprend la demande et
choisit un outil parmi un catalogue fermé ; l’outil prépare un objet métier
(proposition d’écriture, brouillon de facture, cycle de paie à calculer) ; l’humain
prévisualise et approuve ; l’exécution reste une action séparée, contrôlée par les
modules existants.

## 2. Périmètre et garde-fous non négociables

- **Aucune clé API** dans le frontend, le dépôt, la démonstration publique ou un
  journal. Les secrets restent côté API, chiffrés par le keyring existant.
- **Aucune donnée réelle** dans la démonstration GitHub Pages.
- **Aucune écriture comptable directe** par un LLM. Une proposition doit passer par
  les validations déterministes existantes (équilibre, comptes actifs, période
  ouverte, doublons, permissions).
- **Aucun envoi réel** de bulletin, contrat, relance ou e-mail tant qu’un connecteur
  n’est pas installé, testé et autorisé. Une prévisualisation n’est pas un envoi.
- **Aucune déclaration MRA/PAYE/CSG/NSF automatique.** Le calcul et l’export sont des
  fonctions du module Paie ; leur transmission reste manuelle.
- **Aucun taux, plafond, seuil ou règle légale inventé.** Les valeurs proviennent de
  la configuration validée du module, sinon l’outil s’arrête avec
  `Configuration required`.
- **Séparation stricte des sociétés** : chaque outil reçoit un `companyId` vérifié
  côté serveur ; le navigateur ne peut pas élargir le périmètre.
- **Journal d’audit** obligatoire pour chaque outil, y compris les refus.
- **Interrupteur général** : si l’IA est désactivée pour le cabinet, aucun outil,
  aucune conversation, aucune proposition.

## 3. État exact de l’existant (audit mission 24)

### 3.1 Opérationnel en code, sous réserve de configuration

| Brique | Preuve dans le dépôt | Limite |
| --- | --- | --- |
| Moteur IA | `apps/api/src/modules/ai/service.ts`, adapters `openai.ts` et `gemini.ts` | Un appel réel exige un fournisseur activé et une clé ; aucun test ne prouve qu’une clé est configurée en production |
| Catalogue fournisseurs | `apps/api/config/ai-providers.json` | Tarifs volontairement vides ⇒ coût estimé `null` |
| Budgets et quotas | `service.ts` (budget mensuel, quota, limite de tours) | Valeurs par défaut, à revoir avant production |
| Assistant déterministe | `assistant.ts`, `tools.ts`, `ai_tool_runs` | Ne fait aucun appel LLM ; routeur par expressions régulières |
| Proposition d’écriture | outil `accounting.proposal.prepare` | Crée une proposition `proposed`, jamais une écriture comptabilisée |
| Écran de propositions | `apps/web/src/pages/cabinet/AiProposals.tsx` | Approbation humaine existante |
| Journal d’audit | `ai_tool_runs` (migration 0007) | Champs `mode`, `risk`, `approval_id` à ajouter pour l’agent |
| Démonstration | fournisseur `simulated`, données fictives | Clairement identifiée ; aucun appel réseau |

### 3.2 Présent mais non configuré

- Clé de chiffrement `AI_ENCRYPTION_KEY` : si absente, les identifiants ne peuvent
  pas être enregistrés de façon sûre ; l’interface doit l’indiquer.
- Tarification des fournisseurs : vide ⇒ pas de coût estimé, pas de promesse de
  budget en devise.
- Fournisseur `simulated` : interdit en production par `AI_ALLOW_SIMULATED=false`.

### 3.3 Simulé

- Le fournisseur `simulated` et les réponses de démonstration.
- Les écrans de démonstration ne contactent pas l’API réelle.
- Les tests d’assistant espionnent `fetch` ; ils ne prouvent pas un accès réseau réel.

### 3.4 À développer

- Sélection d’outil par un LLM (aujourd’hui : routeur déterministe).
- Prévisualisation riche d’une proposition dans la conversation (aujourd’hui : lien
  vers l’écran de propositions).
- Préparation multi-étapes (paie, contrat, relance) et approbations par seuil.
- Exécution supervisée, idempotence, compensation.
- Connecteurs d’envoi (e-mail, portail salarié) : **absents**.

## 4. Catalogue d’outils : contrat commun

Chaque outil est déclaré dans `apps/api/src/modules/ai/tools.ts` et exposé par
`GET /api/companies/:companyId/ai/assistant/tools`. Le catalogue public ne contient
aucun secret, aucune requête SQL et aucun identifiant de fournisseur.

```ts
type ToolMode = 'read' | 'prepare' | 'execute';
type ToolRisk = 'low' | 'medium' | 'high';

interface ToolDefinition {
  key: string;                 // identifiant stable, ex. accounting.proposal.prepare
  module: 'cabinet' | 'accounting' | 'billing' | 'payroll';
  mode: ToolMode;
  risk: ToolRisk;
  requiredAccess: 'read' | 'write' | 'admin';
  humanValidation: boolean;    // true dès que mode !== 'read'
  companyScoped: true;
  audit: true;
  inputSchema: unknown;        // paramètres autorisés, validés côté serveur
  run(ctx, args): Promise<ToolResult>; // re-vérifie permissions et société
}
```

Règles :

1. **Un outil = une action métier identifiable**, pas un accès SQL générique.
2. Les paramètres sont une liste fermée ; tout champ inconnu est refusé.
3. Le serveur recharge les permissions et la société ; il ne fait jamais confiance
   au `companyId` ni au rôle envoyés par le navigateur.
4. Un outil `prepare` crée un objet au statut `draft`/`proposed` et renvoie
   `preview` + `approveHref` + `auditId`.
5. Un outil `execute` exige un `approvalId` humain, une clé d’idempotence et
   rejoue les contrôles métier au moment de l’exécution.
6. Un outil `high` risque exige deux validateurs ou un rôle administrateur, selon
   la matrice de permissions à valider.
7. Toute erreur renvoie un code stable et un message localisé ; aucun message
   technique brut n’est affiché.

## 5. Architecture cible

```
Navigateur
  └─ AssistantPanel : demande, aperçu, boutons Approuver / Refuser
        │  (aucune clé, aucun appel direct au fournisseur)
        ▼
API /companies/:id/ai/assistant/*
  1. Contexte       : société, rôle, module, écran, objet sélectionné
  2. Politique      : IA activée ? module autorisé ? quota ? risque autorisé ?
  3. Compréhension  : routeur déterministe (phase 1) puis sélection LLM (phase 2)
  4. Outil          : catalogue fermé, schéma d’entrée, re-vérification serveur
  5. Préparation    : objet métier draft/proposed via les services existants
  6. Audit          : ai_tool_runs + ai_approvals (à créer)
  7. Réponse        : résumé localisé, aperçu, lien d’approbation
        │
        ▼
Modules existants (facturation, écritures, stocks, paie, banque)
  └─ validations déterministes, transactions SQL, audits métier
```

### 5.1 Flux « demande → brouillon → prévisualisation → approbation »

1. L’utilisateur écrit : « Prépare une écriture pour un achat de 3 250 MUR ».
2. L’API détecte l’intention `proposal_prepare`, extrait le montant avec
   `parseAmount` (décimaux exacts, jamais de flottants).
3. L’outil `accounting.proposal.prepare` vérifie l’accès `accounting:write`, choisit
   uniquement des comptes actifs du plan, construit l’équilibre et crée une ligne
   dans `ai_entry_proposals` au statut `proposed`.
4. La réponse contient `examineHref` vers `/cabinet/ai-proposals?proposal=<id>`.
5. L’humain ouvre l’écran, vérifie les comptes, approuve ou refuse. L’approbation
   crée une **écriture en brouillon** ; la comptabilisation reste une action
   distincte dans le module Écritures.
6. `ai_tool_runs` conserve l’outil, les arguments, le statut, la durée et l’erreur.

**C’est le premier parcours fonctionnel livrable sans risque, et il est déjà
opérationnel.** Il ne faut pas le présenter comme un agent autonome : le modèle ne
choisit pas encore l’outil et aucune écriture n’est validée automatiquement.

### 5.2 Données à ajouter (proposition, non implémentée)

Migration `0022_ai_agent_governance.sql` :

```sql
ALTER TABLE ai_tool_runs
  ADD COLUMN mode text,
  ADD COLUMN risk text,
  ADD COLUMN approval_id uuid,
  ADD COLUMN idempotency_key text,
  ADD COLUMN proposal_type text,
  ADD COLUMN proposal_id uuid;

CREATE UNIQUE INDEX ai_tool_runs_idempotency_idx
  ON ai_tool_runs (company_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
```

Table `ai_approvals` : `id`, `company_id`, `tool_key`, `proposal_type`,
`proposal_id`, `requested_by`, `approved_by`, `decision`, `reason`,
`created_at`, `decided_at`, `expires_at`. Aucune de ces tables n’est créée dans
cette mission.

### 5.3 Interface

- Panneau assistant : message, résumé structuré, lien « Examiner », jamais un bouton
  « Exécuter » pour un outil `prepare`.
- Écran de propositions : diff avant/après, comptes et montants, avertissements,
  motif d’approbation, historique.
- Bandeau permanent : « Proposition préparée — aucune écriture comptabilisée ».
- Mode démonstration : badge « Simulation » et données fictives.

## 6. Phases de livraison

### Phase 1 — Consultatif (livré)

- Lecture seule : factures impayées, soldes clients/fournisseurs, balance, grand
  livre, échéances, tâches, taux de change, paie.
- Une préparation encadrée : proposition d’écriture.
- Aucun appel LLM pour décider ; réponses déterministes.
- **Critère de sortie** : couverture de tests, audit de chaque outil, aucun accès
  inter-sociétés, documentation utilisateur.

### Phase 2 — Préparateur (prochaine étape)

Objectif : le modèle choisit un outil **parmi le catalogue fermé**, avec un schéma
d’arguments validé ; il ne produit jamais de SQL ni de montant libre.

Outils candidats (à implémenter un par un) :

| Demande | Outil | Sortie | Risque |
| --- | --- | --- | --- |
| « Prépare les bulletins du mois » | `payroll.period.prepare` | période + calcul en `draft`, contrôles | medium |
| « Contrôle les anomalies de paie » | `payroll.anomalies.read` | liste des contrôles existants | low |
| « Prépare un contrat de travail » | `payroll.contract.prepare` | version de contrat `draft` | medium |
| « Analyse ces factures et propose les écritures » | `documents.proposals.prepare` | propositions liées aux documents | medium |
| « Rapproche les opérations bancaires » | `bank.reconciliation.prepare` | suggestions, aucun lettrage validé | medium |
| « Prépare une relance client » | `billing.dunning.prepare` | texte + liste des destinataires, aucun envoi | low |
| « Prépare les documents de clôture » | `closing.checklist.prepare` | checklist, aucun verrouillage | low |

Exigences de la phase 2 :

- sélection d’outil par LLM avec `tool_choice` contraint, sortie JSON validée par
  schéma, repli déterministe si le modèle échoue ;
- montants et identifiants **jamais** repris du texte libre sans validation
  (`parseAmount`, vérification d’appartenance à la société) ;
- prévisualisation obligatoire ; aucune exécution ;
- journalisation du choix du modèle et de la raison (sans données personnelles
  inutiles) ;
- tests d’injection de prompt : « ignore les règles », « poste directement »,
  « choisis un autre compte » ⇒ refus.

### Phase 3 — Exécutant supervisé

Objectif : après approbation explicite, l’agent peut déclencher une action déjà
supportée par un module (comptabiliser une écriture approuvée, émettre une facture,
appliquer un lettrage, poster un mouvement de stock).

- `execute` uniquement avec `approvalId` valide, non expiré, du bon approbateur ;
- re-vérification de la période, des permissions et des règles métier dans la même
  transaction que l’action ;
- idempotence obligatoire (clé dérivée de l’objet approuvé) ;
- deux personnes pour les actions `high` (paiement, clôture, bulletin finalisé) ;
- compensation documentée, jamais de suppression silencieuse ;
- budget et quota d’exécution par cabinet ;
- journal lisible par l’expert-comptable.

### Phase 4 — Automatisations encadrées

Objectif : tâches récurrentes sur périmètre fermé, jamais une autonomie générale.

- planificateur explicite (quotidien/hebdomadaire), fenêtre horaire, liste blanche
  de sociétés et d’outils ;
- aucune création de société, aucun changement de plan comptable, aucune déclaration ;
- interrupteur par société et par outil ;
- limite de dépense et alerte ;
- revue trimestrielle des exécutions et des erreurs ;
- désactivation automatique après N échecs consécutifs.

## 7. Spécificités paie

La paie est le domaine le plus sensible : séparation stricte entre la **société**
(employeur) et le **salarié** (personne), et entre la **préparation** et la
**diffusion**.

### 7.1 Séparation des données

- L’outil reçoit `companyId` et, si nécessaire, `periodId` ; il ne reçoit jamais un
  identifiant salarié fourni librement par le modèle.
- Le modèle ne voit par défaut qu’un **résumé agrégé et pseudonymisé** (nombre de
  salariés, statuts, contrôles). Les noms, NIC, salaires et coordonnées bancaires
  restent dans le backend.
- Toute explication individuelle exige une sélection explicite d’un salarié par
  l’utilisateur, avec contrôle d’accès renforcé et journal d’audit.
- Aucun contenu de paie n’est envoyé à un fournisseur sans consentement du cabinet
  et mention dans la politique de confidentialité.

### 7.2 Contrôles d’anomalies (déterministes)

Les contrôles existants du module Paie restent la source de vérité. L’agent peut les
lire et les expliquer, jamais les contourner :

- salarié sans contrat actif ou contrat expiré sur la période ;
- doublon probable (même identité, même période) ;
- rémunération négative ou nulle inattendue ;
- heure supplémentaire ou variable sans justification ;
- écart entre calcul et bulletin précédent au-delà d’un seuil **configuré** ;
- taux, plafonds ou règles non validés ⇒ `Configuration required` ;
- période déjà calculée, validée ou clôturée ⇒ refus de recalcul silencieux.

Aucun seuil légal n’est codé en dur dans l’agent. Les règles PAye/CSG/NSF restent
celles du module et de sa documentation (`docs/paye-calculation-specification.md`).

### 7.3 Prévisualisation et approbation

1. L’agent prépare une période en brouillon et lance le calcul existant.
2. Il affiche : nombre de bulletins, total brut, retenues, net, contrôles bloquants.
3. L’humain approuve le calcul ; la validation reste celle du module.
4. La génération PDF et la finalisation restent des actions manuelles.
5. **Aucun envoi** : la phase 3 au plus tôt, avec un connecteur dédié.

### 7.4 Diffusion (non livrée)

Si un connecteur est ajouté un jour :

- destinataire vérifié dans la fiche salarié, jamais déduit du texte du modèle ;
- aperçu obligatoire, approbation par lot, journal des envois ;
- clé d’idempotence `payslipId + revision + channel` pour empêcher les doublons ;
- échec partiel signalé, reprise sans renvoi des succès ;
- conservation et suppression selon la politique du cabinet ;
- aucun envoi vers une adresse externe non validée.

### 7.5 Ce qui n’est pas automatisé

- Les bulletins ne sont pas envoyés.
- Les contrats ne sont pas générés comme documents juridiques finaux.
- Les relances ne sont pas expédiées.
- Les déclarations MRA ne sont ni préparées automatiquement ni transmises.
- Aucun agent ne peut finaliser une paie sans validation humaine.

## 8. Sécurité et conformité

- **Moindre privilège** : outil + rôle + module + société + période.
- **Validation serveur** de toutes les entrées, y compris les identifiants.
- **Anti-SSRF** déjà présent sur les URL de fournisseurs (`checkBaseUrl`).
- **Chiffrement** des identifiants fournisseur ; jamais de clé en clair.
- **Journalisation** : outil, mode, risque, arguments minimaux, décision, approbateur,
  résultat, code d’erreur, durée.
- **Rétention** : conversations et journaux selon la configuration existante ;
  aucune durée légale inventée.
- **Injection de prompt** : le modèle ne produit jamais de SQL, d’URL ou de commande ;
  seuls les outils du catalogue sont appelables.
- **Défense en profondeur** : même si le modèle choisit un mauvais outil, les
  validations métier existantes restent applicables.

## 9. Tests attendus par phase

| Phase | Tests |
| --- | --- |
| 1 | outils lecture, permissions, isolation société, audit, refus IA désactivée, proposition équilibrée, comptes inactifs refusés |
| 2 | schéma d’arguments, sélection d’outil, repli déterministe, injection de prompt, aperçu, aucun statut `posted` |
| 3 | approbation expirée, mauvais approbateur, double exécution idempotente, période fermée, compensation |
| 4 | planificateur, limite de budget, désactivation après échecs, revue d’audit |

Les tests de cette mission couvrent la phase 1 : `apps/api/tests/assistant.test.ts`
et la qualité FR/EN `apps/web/tests/i18n-quality.test.ts`. Aucun test ne prétend
qu’un fournisseur réel a été appelé.

## 10. Décisions nécessaires (revue professionnelle unique)

À regrouper pour l’expert-comptable, en anglais :

1. Which tools may ever move from `prepare` to `execute`, and which require two
   approvers?
2. Should payroll data be sent to an external provider at all, or must all payroll
   reasoning stay local/deterministic?
3. What retention period should apply to `ai_tool_runs` and `ai_approvals`
   (no legal duration is assumed in this document)?
4. Which roles may approve a payroll calculation, a journal entry, and a payment?
5. Is a per-company monthly AI budget acceptable, and what is the approval flow
   when it is exceeded?
6. Which client communications (dunning, payslip delivery) may be automated, and
   through which verified channel?
7. What evidence must be retained for an automated action to be auditable by the
   firm and by the client?
8. Should the firm be able to disable an individual tool without disabling the
   whole AI feature?

## 11. Hors périmètre de cette mission

- Aucun appel LLM réel n’est ajouté à l’assistant.
- Aucune migration `0022` n’est créée.
- Aucun connecteur e-mail, SMS, portail salarié ou paiement.
- Aucune déclaration MRA, aucun dépôt, aucune signature électronique.
- Aucun nouveau moteur comptable, de paie ou de rapprochement.
- Aucune publication GitHub Pages, aucun déploiement OVH, aucune fusion.
