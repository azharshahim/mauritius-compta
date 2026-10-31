# Contrats d'intégration entre modules

> Mission 4 : **documentation uniquement**. Aucun de ces moteurs n'est développé. Les tables,
> les permissions et les invariants décrits ici existent déjà ou sont posés ; les traitements
> (OCR, rapprochement, génération d'écritures) restent à construire et à valider.

## 1. Principe commun : idempotence + validation humaine

Toute pièce source (facture fournisseur, relevé bancaire, facture de vente, bulletin) suit le
même cycle :

```
pièce → extraction → proposition (écriture équilibrée) → validation humaine → comptabilisation
```

Règles non négociables :

1. **Une pièce = au plus une écriture.** L'unicité est garantie par un index PostgreSQL
   (`billing_documents.accounting_entry_id UNIQUE`) et par les contraintes existantes
   (`journal_entries_one_reversal_idx`, `journal_entries_reference_unique_idx`).
2. **Rien n'est validé automatiquement** : l'écriture proposée est d'abord un brouillon
   (`journal_entries.status = 'draft'`), validée par un humain habilité.
3. **Traçabilité** : chaque étape écrit dans `audit_log` (append-only) avec la référence de la
   pièce source.
4. **Périmètre comptable inchangé** : les contrôles d'équilibre, de période, de devise et de
   compte actif restent ceux de `apps/api/src/modules/entries/service.ts`.

## 2. Factures fournisseurs (achats / OCR) — préparé

| Étape | Contrat cible | État |
|---|---|---|
| ingestion | `POST /api/companies/:id/purchases/import` (multipart) | non implémenté |
| stockage | réutiliser `attachments` (contrôles binaires existants) | réutilisable |
| extraction | texte + champs (fournisseur, date, devise, montants) | non implémenté |
| rapprochement fournisseur | `companies` / futur `suppliers` | **table absente** |
| proposition d'écriture | brouillon avec `reference = <id pièce>` | non implémenté |
| validation | `POST /entries/:id/post` (existant) | disponible |

Prévention des doublons : la pièce conserve un identifiant unique ; la référence utilisée dans
l'écriture est contrainte (`REFERENCE_TAKEN` en cas de réutilisation).

## 3. Relevés bancaires — préparé

| Étape | Contrat cible | État |
|---|---|---|
| import | PDF / CSV / XLSX / OFX → `bank_statements` | **table absente** |
| normalisation | (date, libellé, montant, sens, devise) | non implémenté |
| détection | règles + score de correspondance avec les écritures de banque | non implémenté |
| rapprochement / lettrage | `bank_reconciliations`, `journal_lines.reconciled_at` | **absents** |
| comptabilisation des frais | brouillon + validation humaine | non implémenté |

Contrainte de conception : un mouvement bancaire importé deux fois (même empreinte
fichier+ligne) ne doit jamais créer deux écritures — clé d'unicité `(company_id, statement_id,
line_no)` prévue.

## 4. Facturation → comptabilité — préparé

Le module Facturation expose aujourd'hui :

- `GET /api/companies/:id/billing/documents` (liste vide, `available: false`) ;
- `GET /api/companies/:id/billing/summary` avec les capacités explicitement à `false`
  (`numbering`, `vatComputation`, `mraEInvoicing`, `postingToAccounting`) ;
- `POST /api/companies/:id/billing/documents` → **501 NOT_IMPLEMENTED**.

Contrat prévu pour la mission suivante :

```
facture validée (status = 'issued')
   → proposition d'écriture équilibrée :
        débit  411 clients        (total TTC)
        crédit 701 ventes         (HT)
        crédit 443 TVA collectée  (TVA)  ← uniquement quand les règles TVA seront validées
   → brouillon (source = 'billing', référence = doc_no)
   → validation humaine → posted
   → billing_documents.accounting_entry_id = <id écriture>   (UNIQUE, anti-double comptabilisation)
```

Aucun taux ni code TVA n'est codé dans le logiciel à ce stade.

## 5. Paie → comptabilité — préparé

- `GET /api/companies/:id/payroll/employees` (liste vide, `available: false`) ;
- `GET /api/companies/:id/payroll/summary` : capacités `paye`, `csg`, `nsf`, `payslips`,
  `leaveManagement`, `statutoryDeclarations`, `accountingTransfer` toutes à `false` ;
- `POST /api/companies/:id/payroll/employees` et `/runs` → **501 NOT_IMPLEMENTED**.

Contrat prévu : un cycle de paie validé produit **un** brouillon d'écriture par période
(salaires, charges patronales, dettes sociales), avec la même clé d'idempotence
(`payroll_runs.accounting_entry_id UNIQUE`, à créer avec le moteur). Aucun montant PAYE/CSG/NSF
n'est calculé tant que les barèmes officiels ne sont pas validés et documentés dans
`docs/mauritius-regulations/`.

## 6. Points d'extension déjà en place

| Élément | Utilité future |
|---|---|
| `journal_entries.source` (`manual` \| `reversal` \| `opening`) | ajouter `billing`, `purchase`, `bank`, `payroll` |
| `audit_log` append-only | piste d'audit par pièce source |
| `company_module_access` | donner le module facturation/paie sans donner la comptabilité |
| `billing_documents.accounting_entry_id UNIQUE` | anti-double comptabilisation |
| `writeAudit()` transactionnel | traçabilité atomique |

## 7. Ce qu'il ne faut pas faire

- Écrire directement en `journal_entries` depuis un module sans passer par le service d'écriture
  (contrôles d'équilibre, de période, de devise).
- Générer des écritures sans validation humaine.
- Stocker un taux de TVA, une cotisation ou un barème « par défaut » sans validation
  réglementaire explicite.
