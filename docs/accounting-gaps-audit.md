# Audit transversal — opérations comptables hors immobilisations

_État au 31 octobre 2026, mission 20. Audit documentaire uniquement : aucun module listé
ci-dessous n'a été développé ou modifié dans le cadre de cette mission, sauf les
immobilisations (objet de [`mission-20-report.md`](mission-20-report.md))._

## 1. Méthode et limites

- Lecture du code des modules `apps/api/src/modules/*`, des migrations `apps/api/sql/migrations/*`
  et des écrans `apps/web/src/pages/*`.
- Trois statuts seulement : **Implémenté**, **Partiel**, **Absent**.
- « Implémenté » signifie que le cycle complet existe avec contrôles, persistance et interface ;
  cela ne vaut **pas** validation comptable, fiscale ou IFRS.
- Aucun taux, seuil, compte obligatoire ni règle mauricienne n'est déduit de cet audit.
- Les comptes cités le sont à titre d'exemple de plan comptable de démonstration, jamais comme
  obligation légale.

## 2. Synthèse

| # | Opération | Statut | Référence principale |
|---|---|---|---|
| 1 | Directors' / shareholders' current accounts | **Absent** | Aucune table ni route dédiée ; écritures manuelles uniquement via `apps/api/src/modules/entries/service.ts` |
| 2 | Partners' capital and drawings | **Partiel** | `apps/api/src/modules/equity/service.ts` (capital, apport, dividende au niveau société) ; aucun registre d'associés ni de prélèvements |
| 3 | Suspense and clearing accounts | **Absent** | `apps/api/src/modules/bank/reconcile.ts` rapproche ou laisse non rapproché ; aucun compte d'attente piloté |
| 4 | Loans and borrowings | **Absent** | Aucun maître d'emprunt ; `payroll ... category 'loan'` n'est qu'une retenue salariale (`0014_payroll_foundation.sql`, l. 131) |
| 5 | Accruals and prepayments | **Partiel** | Acomptes fournisseurs : `apps/api/src/modules/purchases/proposals.ts` (l. 80-105) ; aucun moteur de charges à payer / produits constatés d'avance |
| 6 | Provisions | **Absent** | Aucune provision IAS 37 ; la dépréciation d'immobilisation (`fixed-assets/service.ts`) n'est pas une provision |
| 7 | Inventory | **Absent** | Le compte de stock peut être saisi manuellement (`purchases/proposals.ts`, l. 188) ; ni quantité, ni coût, ni dépréciation de stock |
| 8 | Intercompany transactions | **Absent** | Isolation multi-société seulement (`company_id` sur les tables, `0001_core.sql`) ; aucun appariement ni élimination |
| 9 | Related party transactions | **Absent** | Aucun registre de parties liées ni note annexe |
| 10 | Foreign exchange adjustments | **Implémenté (transactionnel)** / réévaluation latente **Partiel** | `apps/api/src/modules/fx/service.ts` (l. 1-8) et `fx/routes.ts` (l. 165-325) |

## 3. Détail par opération

### 1. Directors' / shareholders' current accounts — Absent

- Aucune table `director_accounts`, `shareholder_accounts` ou équivalent dans les migrations.
- Le module capitaux propres gère des **mouvements de capitaux** (`equity_movements`), pas des
  comptes courants d'associés ou d'administrateurs : pas de solde par personne, pas de limite,
  pas de rémunération, pas d'intérêts, pas de remboursement, pas de présentation courant /
  non courant.
- Contournement actuel : écriture manuelle sur un compte du plan comptable choisi par
  l'utilisateur. Elle est équilibrée et auditée, mais sans suivi de tiers.
- Manque : registre des personnes (rôle, société, date), subledger, politique de remboursement,
  contrôles de dépassement, état et note annexe.

### 2. Partners' capital and drawings — Partiel

- `equity/service.ts` (l. 10) accepte les catégories `capital`, `contribution`, `reserve`,
  `retained_earnings`, `dividend`, `adjustment`, avec justificatif obligatoire, cycle
  brouillon → approbation → comptabilisation et état rapproché de la balance
  (`equity/routes.ts`, l. 87-217).
- Cela couvre l'apport et la distribution **au niveau de la société**, pas au niveau des
  associés : aucun registre de parts, aucun prorata, aucun compte de prélèvements
  (`drawings`), aucune répartition individuelle.
- Le modèle `companies` (`0001_core.sql`) ne porte pas de forme juridique ; rien ne distingue
  techniquement une *Limited Company*, un *Sole Trader* ou un *Partnership*. La distinction
  repose aujourd'hui sur l'usage, pas sur le schéma.
- Manque : registre des associés et de leurs parts, sous-comptes de capital et de prélèvements,
  contrôles de répartition, états par associé.

### 3. Suspense and clearing accounts — Absent

- `bank/reconcile.ts` rapproche une opération bancaire d'une ligne comptable existante ou la
  laisse non rapprochée ; aucune écriture d'attente n'est générée automatiquement.
- Aucun écran ni service ne propose un compte d'attente, une affectation ultérieure, une
  justification d'écart ou une balance âgée des comptes d'attente.
- Contournement actuel : choix manuel d'un compte d'attente à la saisie. Aucun contrôle
  spécifique, aucune revue dédiée.
- Manque : politique de compte d'attente, écriture automatique contrôlée, rapport d'ancienneté,
  interdiction de clôture avec solde non justifié (règle à valider).

### 4. Loans and borrowings — Absent

- Aucune table d'emprunt, d'échéancier, de taux, d'intérêts courus ou de ventilation courant /
  non courant.
- La catégorie `loan` de la paie (`apps/api/sql/migrations/0014_payroll_foundation.sql`,
  l. 131 et 408) est une **retenue sur salaire**, pas un emprunt de la société.
- Contournement actuel : écritures manuelles pour le tirage et les remboursements, sans
  rapprochement ni contrôle de solde.
- Manque : maître d'emprunt, échéancier, intérêts, contrôles d'écart, note annexe.

### 5. Accruals and prepayments — Partiel

- Les acomptes fournisseurs peuvent être proposés sur un compte de rôle `prepayment`
  (`purchases/proposals.ts`, l. 80-105) et les règlements d'avance sont tracés
  (`purchases/service.ts`, l. 1371). Le rôle `prepayment` existe aussi côté facturation
  (`billing/service.ts`, l. 384-407).
- Il n'existe **aucun** moteur de charges à payer, produits constatés d'avance, extourne
  automatique à l'ouverture suivante, ni état des postes constatés d'avance.
- Manque : registre daté, compte de charge/produit d'origine, extourne contrôlée, état
  d'ancienneté et rapprochement.

### 6. Provisions — Absent

- Aucune provision pour risques, litiges, garanties, retraites ou restructuration.
- Le module immobilisations apporte une **dépréciation d'actif** (IAS 36, sans affirmation de
  conformité) et sa reprise (`fixed-assets/service.ts`, `fixed-assets/accounting.ts`), ce qui
  n'est pas une provision au sens IAS 37.
- Manque : registre de provisions, base de calcul, actualisation (à valider), reprise,
  présentation courant / non courant, note annexe.

### 7. Inventory — Absent

- Aucun article, aucune quantité, aucun coût unitaire, aucune méthode de valorisation, aucun
  inventaire physique, aucune dépréciation de stock.
- Une ligne d'achat peut être imputée à un compte de stock choisi par l'utilisateur
  (`purchases/proposals.ts`, l. 188), sans suivi de quantité ni sortie de stock.
- Manque : référentiel d'articles, entrées/sorties, valorisation exacte, inventaire, test de
  valeur nette de réalisation, état de stock.

### 8. Intercompany transactions — Absent

- Le cloisonnement par `company_id` est systématique (`0001_core.sql` et migrations suivantes)
  et les rôles sont vérifiés par société ; c'est une protection, pas une comptabilité
  intercompagnies.
- Aucun identifiant de contrepartie groupe, aucun appariement des soldes réciproques, aucune
  élimination, aucun état de consolidation.
- Manque : groupe, contrepartie, appariement, écarts, éliminations, consolidation.

### 9. Related party transactions — Absent

- Aucun registre de parties liées, aucun lien de dépendance, aucun seuil, aucune note annexe.
- Les tiers existants (`purchase_suppliers`, `billing_customers`) ne portent pas de lien de
  partie liée.
- Manque : registre, qualification, transactions, soldes, informations à fournir (règles à
  valider avec un professionnel).

### 10. Foreign exchange adjustments — Implémenté (transactionnel), réévaluation latente partielle

- Écarts de change **réalisés** : rapprochement facture / règlement, proposition d'ajustement,
  validation, comptabilisation et rapport (`fx/service.ts`, `fx/routes.ts`, l. 165-213).
  Les taux ne sont utilisés qu'après validation humaine explicite ; aucun taux de secours.
- Réévaluation **latente** : simulation et validation possibles, mais comptabilisation
  volontairement bloquée (`fx/service.ts`, l. 1-8 ; `fx/routes.ts`, l. 229-271,
  `postingBlocked: true`), en attente de validation du traitement mauricien.
- Non couvert : conversion des états financiers d'une entité, consolidation, présentation des
  écarts de conversion, réévaluation des immobilisations en devise (le module immobilisations
  fige un coût fonctionnel à la date d'acquisition et documente le taux).

## 4. Manques ajoutés à la feuille de route

Voir [`roadmap.md`](roadmap.md#9-manques-transverses-identifiés-en-mission-20).

## 5. Points à faire valider par l'expert-comptable

Les questions regroupées figurent en anglais dans
[`mission-20-report.md`](mission-20-report.md#12-questions-pour-lexpert-comptable-en-anglais).
