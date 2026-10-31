# Contrôle des coûts de l'IA

> Principe : **aucun montant n'est inventé**. Sans tarif daté et vérifié, l'API affiche
> « coût indisponible » et n'oppose que le plafond de requêtes.

## 1. Ce qui est mesuré

`ai_usage`, une ligne par appel (succès comme échec) :

| Colonne | Contenu |
|---|---|
| `cabinet_id`, `company_id` | portée de la dépense |
| `module`, `feature` | origine (`accounting` / `account_suggestion`, …) |
| `provider`, `model` | qui a été appelé |
| `request_count` | 1 par ligne (agrégation SQL pour les totaux) |
| `input_tokens`, `output_tokens` | fournis par le fournisseur, sinon `NULL` |
| `estimated_cost_usd` | `numeric(12,6)`, `NULL` si inconnu |
| `cost_source` | `catalogue` (tarif daté trouvé) ou `unknown` |
| `status` | `ok`, `error`, `timeout`, `blocked`, `refused` |
| `error_code`, `latency_ms` | diagnostic |

Agrégats exposés par `GET /api/cabinet/ai/usage` et par l'écran « Paramètres IA » :
requêtes, tokens entrants/sortants, coût estimé, détail par fournisseur/modèle et par module.

## 2. Calcul exact du coût

`apps/api/src/modules/ai/cost.ts` :

```
coût_microUSD = round(tokens_entrée × prix_entrée_µUSD/MTok / 1e6)
              + round(tokens_sortie × prix_sortie_µUSD/MTok / 1e6)
```

- tout est en **BigInt** (aucun flottant) ;
- arrondi demi-supérieur appliqué à chaque terme ;
- le résultat est rendu sous forme de chaîne à 6 décimales, stockée dans
  `numeric(12,6)` ;
- si un tarif ou un comptage de tokens manque, `estimated_cost_usd = NULL` et
  `cost_source = 'unknown'` — jamais `0`, jamais une estimation silencieuse.

Test unitaire : 1 000 000 tokens d'entrée à 0,15 USD/MTok + 500 000 tokens de sortie à
0,60 USD/MTok = **0.450000 USD** exactement.

## 3. Catalogue de tarifs daté

Table `ai_prices` :

```sql
SELECT * FROM ai_prices
 WHERE provider = 'openai' AND model = 'gpt-4o-mini'
   AND effective_from <= CURRENT_DATE
 ORDER BY effective_from DESC LIMIT 1;
```

- `effective_from` : date d'effet, jamais « maintenant » implicitement ;
- `source` : provenance du tarif (grille officielle, contrat…) ;
- `verified` : **seul** un tarif vérifié est utilisable par le routage automatique ;
- `notes` : réserves éventuelles.

Le fichier `config/ai-providers.json` est livré avec `pricing: []` : le logiciel
n'embarque aucun prix supposé à jour. La démonstration GitHub Pages affiche donc toujours
« coût indisponible ».

## 4. Plafonds appliqués côté serveur

`ai_settings` :

| Champ | Effet | Erreur |
|---|---|---|
| `monthly_budget_usd` | somme des coûts connus du mois ≥ budget → blocage | `402 AI_BUDGET_EXCEEDED` |
| `monthly_request_limit` | nombre de requêtes du mois ≥ plafond → blocage | `402 AI_BUDGET_EXCEEDED` |
| `alert_threshold` (défaut 80 %) | seuil d'alerte affiché (`warning`) | — |
| `AI_RATE_LIMIT_PER_MINUTE` | fenêtre glissante d'une minute par cabinet | `429 AI_RATE_LIMITED` |

Contrôles effectués **avant** l'appel, dans l'ordre : module autorisé → budget et plafond
de requêtes → limitation de débit → sélection du fournisseur.

### Pourquoi un plafond de requêtes ?

Sans aucun tarif configuré, un budget en USD n'est pas opposable (le coût est inconnu). Le
plafond de requêtes est donc le garde-fou qui fonctionne **toujours**, et l'interface le
présente comme tel.

## 5. Ce que l'interface affiche

- « Requêtes : n » ; « Tokens : n » ;
- « Coût estimé : 0.001234 USD » **si** un tarif daté existe ;
- « Coût indisponible » sinon, avec la phrase : « Aucun tarif daté et vérifié n'est
  configuré : les coûts ne sont pas affichés plutôt que d'être inventés. » ;
- état du budget : dans le budget / seuil d'alerte / plafond atteint / coût inconnu ;
- tableau par fournisseur et modèle, coût en « estimation ».

Aucune conversion USD → MUR n'est proposée : elle exigerait un taux daté et une source
fiable, absents de cette mission.

## 6. Ce qui n'est pas fait

- Aucun achat de crédits, aucune facturation, aucun paiement : la mission interdit toute
  dépense.
- Pas de mode « IA incluse dans l'abonnement » : `ai_settings.shared_pool_enabled` est
  contraint à `false` en base.
- Pas de prévisionnel ni de répartition analytique par collaborateur (prévu plus tard).
