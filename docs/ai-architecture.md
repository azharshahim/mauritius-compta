# Mauritius AI Engine — architecture

> Mission 5. Le moteur est **indépendant des modules métier** : aucun écran, aucun
> service de facturation, de paie ou de comptabilité n'appelle un fournisseur d'IA
> directement. Tous les appels passent par `apps/api/src/modules/ai/`.

## 1. Principe

```
Module métier (comptabilité, facturation, paie, cabinet)
        │  demande structurée (feature, société, texte, schéma attendu)
        ▼
AI Service (orchestrateur)  ──►  Registre de fournisseurs  ──►  Adaptateur
   • permissions            │      (catalogue JSON)              (openai / gemini /
   • plafonds & budget      │                                     simulated)
   • rate limit             │
   • sélection du modèle    └──►  Journal d'audit + consommation (PostgreSQL)
```

**Règle métier invariable : l'IA propose, le moteur métier contrôle, l'utilisateur
autorisé valide.** Le module `ai` ne peut pas écrire dans `journal_entries` : la
seule colonne qui relie une suggestion à la comptabilité, `ai_suggestions.posted_entry_id`,
n'est remplie qu'ultérieurement, par le module comptable, après validation humaine.

## 2. Fichiers

| Fichier | Rôle |
|---|---|
| `modules/ai/types.ts` | Interface `AIProvider`/`AIAdapter`, capacités, catalogue de fonctionnalités |
| `modules/ai/catalogue.ts` | Chargement validé de `apps/api/config/ai-providers.json` (fournisseurs, modèles, capacités, tarifs datés) |
| `modules/ai/registry.ts` | Registre : associe une entrée du catalogue à un adaptateur |
| `modules/ai/adapters/openai.ts` | OpenAI **et** compatibles (`chat/completions`) : DeepSeek, Mistral, passerelle interne |
| `modules/ai/adapters/gemini.ts` | Google Gemini (`generateContent`, schéma et comptage spécifiques) |
| `modules/ai/adapters/simulated.ts` | Fournisseur fictif déterministe, hors ligne, sans coût |
| `modules/ai/service.ts` | Orchestrateur : sélection, clés, budget, débit, timeouts, retries, usage, audit |
| `modules/ai/suggestions.ts` | Cas d'usage « suggestion de compte » et son cycle de décision |
| `modules/ai/crypto.ts` | Chiffrement AES-256-GCM des clés API |
| `modules/ai/cost.ts` | Calcul de coût en arithmétique entière exacte |
| `modules/ai/simulation.ts` | Algorithme déterministe partagé avec la démonstration |
| `modules/ai/routes.ts` | Surface HTTP `/api/cabinet/ai/*` et `/api/companies/:id/ai/*` |
| `lib/cabinets.ts` | Résolution du cabinet, rattachement des dossiers, contrôle des droits |

## 3. Cycle d'un appel

1. **Autorisation** — route cabinet (`cabinet_admin`) ou route société
   (`requireModuleAccess(..., 'accounting', 'read'|'write')`). Un non-membre reçoit
   `404 COMPANY_NOT_FOUND`, jamais 403 : l'existence d'un autre cabinet n'est pas divulguée.
2. **Réglages** — `ai_settings` : IA activée, mode de routage, fournisseur/modèle,
   repli, budget, plafond de requêtes, fonctionnalités par module.
3. **Contrôles serveur** — module autorisé (`features[module]`), longueur d'entrée
   (`AI_MAX_INPUT_CHARS`), budget (`AI_BUDGET_EXCEEDED`), débit
   (`AI_RATE_LIMITED`, fenêtre glissante d'une minute par cabinet).
4. **Sélection du fournisseur**
   - manuel : fournisseur/modèle choisis par le cabinet, validés contre le catalogue ;
   - automatique : uniquement parmi les fournisseurs dont un **tarif daté est vérifié** ;
     sinon `409 AI_ROUTING_DISABLED` (aucune prétention de « moins cher » sans tarifs).
   Le fournisseur de secours n'est utilisé que si l'appel principal échoue pour une
   raison **technique** (réseau, 429, 5xx, timeout) — jamais après un refus de permission.
5. **Clé** — déchiffrée à la volée, jamais transmise au navigateur, jamais journalisée.
   Le fournisseur fictif n'en demande pas.
6. **Appel** — timeout (`AI_TIMEOUT_MS`, 20 s par défaut), au plus deux tentatives
   (`AI_MAX_RETRIES=1`), abandon immédiat sur 4xx non réessayable.
7. **Validation** — la réponse est une **donnée non fiable** : JSON extrait, schéma Zod,
   identifiants vérifiés en base (compte appartenant à la société), énumérations
   contrôlées. Un compte inconnu est refusé (`422 AI_INVALID_RESPONSE`) après une
   tentative corrective.
8. **Traçabilité** — `ai_usage` (tokens, latence, statut, coût éventuel), `ai_request_log`
   (métadonnées seulement, **jamais** le prompt ni la réponse), `audit_log`.

## 4. Capacités et différences réelles entre fournisseurs

Le moteur ne suppose pas que les API sont interchangeables. Le catalogue déclare, par
fournisseur : `structured_output` (`json_schema` | `json_object` | `prompt_only`),
`vision`, `documents`, `streaming`, `token_counting` (`provider` | `estimated` | `unknown`).

| Fournisseur | Adaptateur | Sortie structurée | Comptage des tokens |
|---|---|---|---|
| OpenAI | `openai` | `json_schema` strict | `usage.prompt_tokens` / `completion_tokens` |
| DeepSeek | `openai` | `json_object` | `usage` |
| Mistral | `openai` | `json_object` | `usage` |
| Gemini | `gemini` | `generationConfig.responseSchema` (types en MAJUSCULES) | `usageMetadata` |
| Compatible OpenAI | `openai` | `json_object` | souvent absent → `unknown` |
| Auto-hébergé | `openai` | `json_object` | `unknown` |
| Simulateur | `simulated` | schéma interne, déterministe | estimé (aucun coût) |

## 5. Configuration

| Variable | Défaut | Rôle |
|---|---|---|
| `AI_ENABLED` | `true` | interrupteur global (coupe tous les appels) |
| `AI_CATALOGUE_PATH` | `apps/api/config/ai-providers.json` | catalogue de fournisseurs |
| `AI_ENCRYPTION_KEY` | — | **obligatoire** pour stocker une clé (32 octets, hex ou base64) |
| `AI_ENCRYPTION_KEY_VERSION` | `v1` | version de la clé de chiffrement |
| `AI_ENCRYPTION_PREVIOUS_KEYS` | — | `v0:<clé>` pour la rotation |
| `AI_TIMEOUT_MS` | `20000` | délai maximal par appel |
| `AI_MAX_RETRIES` | `1` | tentatives supplémentaires (0–2) |
| `AI_RATE_LIMIT_PER_MINUTE` | `20` | requêtes par cabinet et par minute |
| `AI_MAX_INPUT_CHARS` | `2000` | taille maximale du texte envoyé |
| `AI_ALLOW_SIMULATED` | `true` (faux en production sauf opt-in) | autorise le fournisseur fictif |
| `AI_ALLOW_PRIVATE_BASE_URL` | `false` | autorise une URL privée (serveur local) |

Sans `AI_ENCRYPTION_KEY`, l'API **refuse** d'enregistrer une clé
(`503 AI_ENCRYPTION_NOT_CONFIGURED`) : aucun repli en clair n'existe.

## 6. Isolation

- **Cabinet** : `cabinets` + `companies.cabinet_id`. Les réglages, clés, budgets et
  consommations portent `cabinet_id`. Un utilisateur d'un autre cabinet obtient 404,
  même en modifiant l'identifiant dans l'URL.
- **Société** : chaque suggestion porte `company_id`; le compte proposé doit appartenir
  au plan comptable de cette société; les règles apprises sont propres à la société.
- **Module** : `features` par module; un cabinet peut activer l'IA en comptabilité et la
  désactiver en paie.
- **Cabinet admin** : seuls `owner`/`admin`/`cabinet_admin` accèdent aux réglages et aux
  clés; un comptable obtient `403 AI_FORBIDDEN`.

## 7. Démonstration GitHub Pages

La démonstration **n'utilise pas ce moteur**. `apps/web/src/demo/runtime.ts` embarque une
réplique du fournisseur fictif et de l'algorithme de suggestion :

- aucun `fetch`, aucune clé, aucun coût, aucun tarif ;
- `PUT /cabinet/ai/credentials/:provider` renvoie volontairement `400 DEMO_KEY_NOT_ACCEPTED` ;
- les données restent dans `localStorage` (schéma 3), avec réinitialisation possible ;
- bandeau permanent « Simulation IA — aucune API externe utilisée ».

## 8. Implémenté vs préparé

**Opérationnel** : fournisseurs et registre, clés BYOK chiffrées, budgets et plafonds,
limitation de débit, audit et consommation, suggestion de compte comptable avec décision
humaine et règles réutilisables.

**Contrats seulement** (`AI_FEATURES` avec `implemented: false`, routes renvoyant `501`) :
OCR de factures, extraction fournisseur/date/montant/TVA, propositions d'écritures,
détection de doublons, lecture de relevés (PDF/CSV/XLSX/OFX), rapprochement bancaire,
lettrage, classement documentaire, suggestions de tâches, contrôles de révision,
anomalies de facturation, analyse des variables de paie, analyse des états financiers.

**Désactivé volontairement** : mode « IA incluse dans l'abonnement » (clé mutualisée,
quotas et refacturation) — la colonne `ai_settings.shared_pool_enabled` est contrainte à
`false` en base.
