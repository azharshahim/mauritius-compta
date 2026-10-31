# Fournisseurs d'IA — catalogue et adaptateurs

> Aucune URL, aucun identifiant de modèle, aucune capacité et aucun tarif n'est codé en
> dur dans le code métier. La seule source est `apps/api/config/ai-providers.json`
> (ou le fichier désigné par `AI_CATALOGUE_PATH`).

## 1. Fournisseurs prévus

| Clé | Libellé | Adaptateur | Clé API | État |
|---|---|---|---|---|
| `deepseek` | DeepSeek | `openai` | oui | configurable |
| `openai` | OpenAI | `openai` | oui | configurable |
| `gemini` | Google Gemini | `gemini` | oui | configurable |
| `mistral` | Mistral AI | `openai` | oui | configurable |
| `openai_compatible` | Fournisseur compatible OpenAI | `openai` | oui | URL et modèle saisis par le cabinet |
| `local` | Auto-hébergé (phase ultérieure) | `openai` | non | désactivé par défaut, aucune installation fournie |
| `simulated` | Simulateur fictif | `simulated` | non | démonstration et tests uniquement, hors ligne |

**Aucun test, aucune démonstration et aucune suite de CI n'appelle réellement un
fournisseur.** Les tests remplacent `fetch` par un espion qui échoue s'il est utilisé.

## 2. Ce que déclare une entrée de catalogue

```jsonc
{
  "key": "openai",
  "label": "OpenAI",
  "adapter": "openai",                 // openai | gemini | simulated
  "base_url": "https://api.openai.com/v1",
  "base_url_configurable": false,      // true = le cabinet peut saisir une URL
  "requires_key": true,
  "enabled_by_default": true,
  "capabilities": {
    "structured_output": "json_schema", // json_schema | json_object | prompt_only
    "vision": true,
    "documents": false,
    "streaming": true,
    "token_counting": "provider"        // provider | estimated | unknown
  },
  "models": [
    { "id": "gpt-4o-mini", "label": "GPT-4o mini", "context_tokens": 128000, "max_output_tokens": 16000 }
  ]
}
```

Ces champs pilotent réellement le comportement :

- `structured_output` décide si l'adaptateur envoie un schéma strict, un simple
  `response_format: json_object`, ou rien du tout (la validation serveur reste la même) ;
- `token_counting` détermine si les tokens manquants sont estimés ou laissés inconnus ;
- `base_url_configurable` conditionne l'acceptation d'une URL fournie par le cabinet
  (refusée si le fournisseur ne la prévoit pas) ;
- `requires_key` autorise un fournisseur sans clé (serveur local), sans jamais contourner
  le contrôle de permission.

## 3. Différences d'implémentation, fournisseur par fournisseur

### OpenAI, DeepSeek, Mistral (adaptateur `openai`)
`POST {base_url}/chat/completions`, en-tête `Authorization: Bearer …`.

| Point | Différence réelle gérée |
|---|---|
| Sortie structurée | OpenAI accepte `json_schema` strict ; DeepSeek et Mistral seulement `json_object` |
| Champs de refus | `choices[0].message.refusal` et `error` transformés en `AI_PROVIDER_ERROR` |
| Comptage | `usage.prompt_tokens` / `usage.completion_tokens` ; absents → `null`, jamais estimés silencieusement |

### Google Gemini (adaptateur `gemini`)
`POST {base_url}/models/{model}:generateContent`, clé envoyée dans l'en-tête
`x-goog-api-key` (jamais en paramètre d'URL, pour éviter qu'elle ne finisse dans un journal
d'accès).

| Point | Différence réelle gérée |
|---|---|
| Prompt système | `systemInstruction.parts[].text`, distinct de `messages` |
| Sortie structurée | `generationConfig.responseSchema` avec des types en MAJUSCULES et sans `additionalProperties` (conversion explicite dans `toGeminiSchema`) |
| Comptage | `usageMetadata.promptTokenCount` / `candidatesTokenCount` |
| Filtrage | `promptFeedback.blockReason` remonté comme erreur fournisseur, sans contenu |

### Fournisseur compatible OpenAI (`openai_compatible`)
Même contrat que ci-dessus, mais l'URL de base et le modèle sont **saisis par le cabinet**.
L'URL est validée côté serveur : HTTPS obligatoire (HTTP toléré hors production), hôtes
privés refusés sauf `AI_ALLOW_PRIVATE_BASE_URL=true` (protection SSRF).

### Auto-hébergé (`local`)
Désactivé par défaut (`enabled_by_default: false`). Aucune installation n'est livrée :
le catalogue et la table `ai_settings.provider_options` suffisent à le brancher en phase
ultérieure, sans modification du code métier.

### Simulateur (`simulated`)
- Aucun appel réseau ; réponse construite à partir du plan comptable présent dans le
  prompt et de mots-clés (voir `modules/ai/simulation.ts`).
- Déterministe : la même description donne toujours la même proposition.
- Coût toujours `null` (aucun tarif, aucune dépense).
- Désactivé en production sauf `AI_ALLOW_SIMULATED=true`.

## 4. Ajouter un fournisseur

1. Si le format est **compatible OpenAI** ou **Gemini** : aucune ligne de code, une entrée
   dans le catalogue suffit.
2. Sinon : créer un adaptateur dans `modules/ai/adapters/`, l'enregistrer dans
   `FACTORIES` (`modules/ai/registry.ts`), ajouter sa clé à l'énumération
   `AIAdapterKey`.
3. Renseigner au minimum `structured_output`, `vision`, `documents`, `token_counting`.
4. Ajouter les tarifs **datés** dans `ai_prices` (voir `docs/ai-cost-control.md`) —
   sans tarif vérifié, le routage automatique reste bloqué et aucun coût n'est affiché.

## 5. Tarifs

Le fichier livré contient `"pricing": []` **volontairement** : aucun prix daté et vérifié
n'est fourni avec le logiciel, et l'API n'affiche donc jamais de montant. Pour activer les
coûts :

```sql
INSERT INTO ai_prices
  (provider, model, input_usd_per_mtok, output_usd_per_mtok, effective_from, source, verified)
VALUES
  ('openai', 'gpt-4o-mini', 0.150000, 0.600000, '2026-10-01', 'grille tarifaire du fournisseur (à vérifier)', true);
```

`verified = true` est obligatoire pour que le modèle soit pris en compte par le routage
automatique. Un tarif `verified = false` sert à l'estimation affichée mais pas au choix
automatique.

## 6. Migrer d'un fournisseur à un autre

Le contrat métier ne change pas : `AIService.complete()` reçoit un texte, un schéma et des
contraintes ; il rend un texte validé, un fournisseur, un modèle et un usage. Changer de
fournisseur se limite à modifier `ai_settings` (ou à ajouter un repli).
