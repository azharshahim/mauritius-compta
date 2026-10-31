# Audit préalable — Achats & Fournisseurs (mission 11)

> Audit **lecture seule** réalisé avant toute écriture de code. Aucun dépôt
> extérieur, aucune application française, aucun code tiers n'a été copié.
> Dépôt unique : `azharshahim/mauritius-compta`.

## 1. Ce qui existait déjà et n'a pas été recréé

| Besoin | Composant existant réutilisé | Décision |
|---|---|---|
| Plan comptable | `accounts`, `seed/chart-of-accounts.ts`, `accountForRole` | Les comptes sont lus dans le plan **actif** de la société ; aucun compte n'est créé automatiquement |
| Journaux | `journals` (`PUR`, `BQ`, `CA`, `OD`) | Le journal achats existant est utilisé, ou un journal général actif |
| Écritures | `prepareEntry`, `postProposal`, `journal_entries`, `journal_lines` | **Aucun second grand livre** : toutes les écritures passent par le moteur existant |
| Propositions | `ai_entry_proposals`, `proposal_lines`, `evaluateProposal`, `postProposal` | Les achats produisent des propositions de même nature ; validation et comptabilisation humaines |
| TVA | `billing_tax_rates`, `resolveVat`, écran Paramètres société | Aucun taux en dur ; un taux non vérifié est refusé |
| Banque | `bank_accounts`, `bank_transactions`, `bank_matches`, verrous `FOR UPDATE` | Une affectation de règlement fournisseur s'ajoute à `bank_matches`, sans second rapprochement |
| Pièces jointes | `attachments`, contrôle MIME + signature binaire | Colonne `purchase_document_id` ajoutée ; stockage et contrôles existants conservés |
| Audit | `writeAudit`, `audit_events` append-only | Chaque création, validation, annulation, affectation et comptabilisation est journalisée |
| Permissions | `requireCompany(..., 'accounting')`, `module_access` | Rôles `viewer` / `accountant` ; aucune permission nouvelle parallèle |
| Démonstration | `demo/runtime.ts`, `demo/bank.ts`, schéma localStorage | Schéma porté de **8 à 9**, extension `demo/purchases.ts`, même routeur et même UI |

## 2. Contraintes techniques découvertes

- `billing_payment_allocations.invoice_id` référence `billing_documents` : la
  table **n'est pas réutilisable** pour des factures d'achat. Des tables
  dédiées sont créées, sans toucher au sous-ledger clients.
- `ai_entry_proposals.source_kind` et `journal_entries.source` étaient fermés
  par des contraintes `CHECK`. La migration `0011` les **étend** en conservant
  les valeurs existantes (`manual`, `reversal`, `opening`, `billing`, `ai`,
  `migration`, `migration_opening`) et ajoute `purchase`.
- `attachments.entry_id` ne suffit pas avant comptabilisation : ajout nullable
  de `purchase_document_id`, sans remplacer le lien aux écritures.
- `requireCompany` refuse un module inconnu : le module `accounting` est utilisé
  (pas de module factice `purchases`).
- Le menu `/accounting/purchases` affichait une page « préparée » : le drapeau
  `prepared` a été retiré et la route remplacée par l'écran réel.
- `bank_matches.amount` est obligatoire et strictement positif : toute
  affectation fournisseur fournit un montant exact.

## 3. Décisions d'architecture

1. **Un seul moteur de comptabilisation.** Une facture, un avoir ou un règlement
   fournisseur ne crée jamais directement `journal_entries`. Il crée une
   proposition (`purchase_invoice`, `purchase_credit_note`, `purchase_payment`)
   qui suit le cycle **Préparer → Vérifier → Valider → Comptabiliser**.
2. **Un sous-ledger, pas un second grand livre.** `purchase_documents` et
   `purchase_payments` portent les soldes commerciaux ; le grand livre reste
   `journal_lines`. Les deux sont rapprochés par `accounting_entry_id`.
3. **Immutabilité après comptabilisation.** Une facture comptabilisée ne peut
   être ni modifiée, ni annulée, ni silencieusement supprimée. La correction
   passe par une contrepassation humaine dans le moteur existant puis, si
   nécessaire, un avoir.
4. **Aucune règle fiscale inventée.** Les traitements `exempt`,
   `zero_rated`, `out_of_scope` et `standard` restent des qualifications
   explicites. Aucune règle MRA, reverse charge ou autoliquidation n'est codée.
5. **Devises séparées.** Les soldes, l'échéancier et le tableau de bord
   regroupent par devise ; aucune addition inter-devises.
6. **Concurrence.** Les contrôles de dépassement (facture, règlement,
   transaction bancaire, avoir) sont faits sous verrou PostgreSQL et couverts
   par des tests dédiés.

## 4. Éléments volontairement non implémentés

- E-invoicing MRA, obligations déclaratives et conformité fiscale mauricienne.
- Rapprochement automatique de TVA ou autoliquidation.
- Génération de fichiers de virement bancaire.
- OCR de facture fournisseur.
- APK, PWA, iPhone, mode nuit/jour.
- Taux de change automatique : le taux est toujours saisi et historisé.

Ces points sont marqués **NON IMPLÉMENTÉ** ou **À VÉRIFIER** dans les documents
et l'interface ; ils ne sont pas présentés comme opérationnels.
