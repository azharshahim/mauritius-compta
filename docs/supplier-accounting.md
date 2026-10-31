# Comptabilisation des achats fournisseurs

> Les achats utilisent le **moteur comptable existant**. Aucun second grand
> livre, aucune écriture automatique, aucune validation par IA.

## 1. Cycle obligatoire

```text
Préparer ──> Vérifier ──> Valider ──> Comptabiliser
   │            │            │              │
proposition  contrôles   humain        postProposal
```

1. **Préparer** : `POST /purchases/documents/:id/proposal` ou
   `/purchases/payments/:id/proposal` construit une proposition équilibrée à
   partir du plan comptable actif.
2. **Vérifier** : l'écran des propositions affiche les contrôles (équilibre,
   comptes actifs, période ouverte, devise/taux, journal, TVA, source déjà
   comptabilisée).
3. **Valider** : action humaine explicite (`/ai/entry-proposals/:id/validate`).
4. **Comptabiliser** : action humaine distincte (`/ai/entry-proposals/:id/post`)
   qui appelle le moteur existant `postProposal`, écrit `journal_entries` /
   `journal_lines` et renseigne la source.

Une proposition d'achat ne peut jamais être comptabilisée sans validation.
Deux comptabilisations de la même source renvoient `ACCOUNTING_ALREADY_POSTED`.

## 2. Comptes utilisés

| Élément | Compte | Remarque |
|---|---|---|
| Dette fournisseur | `2000` (ou compte de la fiche, actif/passif) | Plan comptable de la société ; jamais inventé |
| Charge / actif | Compte de chaque ligne | Sélection humaine ; doit être actif |
| TVA récupérable | `1200` | Seulement si `vatRecoverable = true` |
| TVA non récupérable | Compte de charge de la ligne | Incluse au coût |
| Acompte non affecté | `1150` | Reste un actif tant qu'il n'est pas affecté |
| Banque / caisse | `1010` / `1000` | Selon le mode de règlement |
| Journal | `PUR` (achats) ou `OD` | Journal actif de la société |
| Règlement | `BQ` / `CA` | Selon le mode |

Aucun compte n'est créé automatiquement. Si un compte requis est absent ou
inactif, la préparation renvoie `AI_HUMAN_REQUIRED` : un humain doit compléter
le plan comptable.

## 3. Règles de construction

### Facture d'achat

```text
D  compte de charge/actif     net
D  1200 (si TVA récupérable)  taxe
   ou compte de charge        taxe (si non récupérable)
C  2000                       total TTC
```

### Avoir fournisseur

```text
D  2000                       total TTC
C  compte de charge/actif     net
C  1200 (si TVA récupérable)  taxe
   ou compte de charge        taxe (si non récupérable)
```

### Règlement

```text
D  2000                       montant affecté
D  1150                       acompte non affecté
C  1010 / 1000                montant total décaissé
```

### Devise

- Devise fonctionnelle : taux `1.00000000`.
- Devise étrangère : taux **saisi**, jamais déduit, format 8 décimales.
- Une devise manquante bloque la proposition (`PURCHASE_EXCHANGE_RATE_REQUIRED`).
- Aucun écart de change automatique n'est calculé (marqué **NON IMPLÉMENTÉ**).

## 4. Contrôles avant comptabilisation

- débit = crédit, au moins deux lignes ;
- comptes existants **et actifs** dans le plan comptable de la société ;
- journal existant et actif ;
- période ouverte, date autorisée ;
- devise supportée et taux présent ;
- TVA : taux vérifié, récupérabilité explicite ;
- référence unique (`journal_entries_purchase_reference_uniq`) ;
- source non déjà comptabilisée (`accounting_entry_id`) ;
- permissions `accountant` ;
- pièces jointes disponibles (facultatives, non bloquantes) ;
- idempotence : second `post` → `ACCOUNTING_ALREADY_POSTED`.

## 5. Immutabilité et corrections

- Une facture, un avoir ou un règlement comptabilisé ne peut être annulé par
  le sous-ledger (`PURCHASE_ACCOUNTING_POSTED`).
- Aucune écriture n'est supprimée. La correction se fait par **contrepassation
  humaine** dans le moteur existant, puis par un avoir ou un nouveau règlement
  si nécessaire.
- Une facture comptabilisée reste affichée avec son écriture liée ; elle n'est
  jamais masquée.
- L'IA ne peut ni comptabiliser, ni modifier un montant validé, ni valider un
  règlement, ni déclencher un virement.

## 6. Limites déclarées

- Aucun lettrage automatique de grand livre.
- Aucun calcul d'écart de change ou de réévaluation de fin de période.
- Aucune règle MRA, e-invoicing, autoliquidation ou reverse charge.
- Aucune génération de fichier de virement.
- Aucun OCR de facture fournisseur.
