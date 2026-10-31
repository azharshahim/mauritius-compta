# Rapport final — Mission 12

**Lettrage comptable clients/fournisseurs et finalisation Banque ↔ Fournisseurs**

Dépôt : `azharshahim/mauritius-compta` — branche
`arena/b0b62798-mauritius-compta` — PR nº1 **ouverte en brouillon**, `main`
intact, aucune fusion, aucun déploiement OVH, aucune dépense.

## 1. Audit préalable

Audit en lecture seule des migrations `0001`→`0011` et du code existant :
`journal_entries`, `journal_lines` (`numeric(20,4)`, devise, montant
transactionnel, taux), journaux, périodes (`open|closed`), comptes tiers,
`postEntryTx`, `postProposal`, `billing_payment_allocations`,
`purchase_payment_allocations`, `purchase_credit_allocations`, `bank_matches`,
permissions et audit. Conclusion : le lettrage peut être **additif**, sans
toucher aux écritures. Aucune modification silencieuse n’a été introduite.

## 2. Migration additive `0012`

`apps/api/sql/migrations/0012_reconciliation_lettering.sql` crée :

- `ledger_letterings` : société, cabinet, compte, code, statut, méthode,
  devise, devise source, montant, débit/crédit totaux, motif, clé d’idempotence,
  auteur, dates, révocation ;
- `ledger_lettering_lines` : affectation exacte par ligne comptable, côté,
  montant, société, cabinet ;
- `ledger_lettering_events` : historique `created|reversed|suggested` ;
- `ledger_lettering_sequences` : numérotation atomique par société et année ;
- index uniques (code insensible à la casse, clé d’idempotence) et index de
  lecture ;
- triggers d’isolation société/cabinet et de refus des écritures non postées ;
- triggers d’immuabilité : allocations non modifiables/supprimables, seule
  transition `active → reversed` avec motif.

## 3. Lettrage client

Scénario validé : facture 100 000 = règlements 40 000 + 35 000 + 25 000.
Le groupe est équilibré, le solde lettré est nul, le montant de la facture
reste inchangé, aucune ligne comptable n’est ajoutée et aucun paiement n’est
créé. Les avoirs et contrepassations se lettrent sur le même compte tiers.

## 4. Lettrage fournisseur

Scénario imposé : facture 80 000 / règlement 30 000 → **30 000 lettrés,
50 000 restants, facture « partiellement lettrée »**. Le document commercial
conserve son montant. Une facture validée mais non comptabilisée n’a aucune
ligne de grand livre : elle reste **en attente de comptabilisation** et aucun
faux lettrage n’est produit.

## 5. Partiels et multiples

Pris en charge : 1↔1, 1↔N, N↔1, facture + avoir + solde, acompte,
contrepassation, plusieurs groupes successifs sur une même ligne dans la limite
du restant. Le disponible est recalculé à chaque opération.

## 6. Contrôles serveur

Refus : dépassement du restant, comptes incompatibles, société différente,
devises différentes sans change validé, ligne non postée, compte non lettrable,
période clôturée, doublon de ligne, déséquilibre, montant nul/négatif.
Les avertissements (absence de document) n’empêchent pas un lettrage
purement comptable mais restent visibles.

## 7. Codes uniques et concurrence

`LET-AAAA-NNNN` via `INSERT … ON CONFLICT DO UPDATE … RETURNING`, plus index
unique. Les lignes sont verrouillées `FOR UPDATE` dans un ordre trié ; le
second lettrage concurrent échoue en 409 au lieu de sur-lettrer.

## 8. Suggestions explicables

Suggestions **déterministes** (pas d’IA générative) : même compte tiers, même
devise, montant restant, références, dates, tiers. Chaque proposition expose
montant, justification, confiance et ambiguïtés. Aucune validation automatique :
prévisualisation puis confirmation humaine.

## 9. Assistant IA en lecture seule

Trois outils ajoutés au registre existant :
`lettering.unlettered` (lignes non lettrées, factures, soldes),
`lettering.partial` (explication d’un lettrage partiel),
`lettering.payments` (règlements à affecter). Ils sont marqués `readOnly: true`.
L’assistant ne peut ni valider, ni délettrer, ni modifier une écriture, ni
inventer un compte, ni comptabiliser, ni créer un règlement. La distinction
entre suggestion déterministe et réponse générative est explicite dans l’écran
et l’API.

## 10. Délettrage sécurisé

Permission administrateur de dossier, confirmation explicite, motif obligatoire,
statut `reversed`, historique conservé, aucune suppression, recalcul du
lettrable, blocage en période clôturée, aucun impact sur un paiement bancaire.
Audit `lettering.reverse` et événement métier.

## 11. Navigation et écarts

La chaîne est consultable dans les deux sens : numéro d’écriture de chaque
ligne → `/accounting/entries?search=<n°>` (écriture ouverte par recherche),
numéro de facture/avoir → `/billing/invoices|credit-notes?document=<n°>`
(détail ouvert automatiquement), et boutons « Voir le lettrage » depuis le
détail d’une facture, la liste des règlements et le détail d’une écriture
comptabilisée → `/accounting/lettering?search=<référence>`. L’écran affiche
restant commercial, restant comptable et montant lettré, sans arrondi
silencieux ; un document non comptabilisé reste signalé comme tel et ne
produit aucun faux lettrage. Le rapport isole les écarts.

## 12. Interface Banque ↔ Fournisseurs

Le panneau Banque expose désormais **Règlements fournisseurs liés** en
réutilisant l’API mission 11 : candidats, confiance, factures, restant,
confirmation, retrait motivé. Aucun second paiement, aucune écriture, aucune
recomptabilisation. La démo implémente aussi le lien idempotent et son retrait.

## 13. Sécurité

Voir `docs/lettering-security.md` : isolation société/cabinet, permissions,
verrous, unicité, anti-double lettrage, idempotence, rollback, traçabilité,
périodes clôturées, concurrence, contrôles serveur.

## 14. Rapports et exports

Balance tiers non lettrée, factures totalement/partiellement lettrées,
règlements/écritures non lettrés, historique, écarts commercial/comptable.
Filtres compte, statut, devise, dates, recherche. Exports CSV avec en-tête
`Compte;…;Restant;Devise` et neutralisation des formules. Les devises sont
**toujours séparées**, y compris dans le sélecteur de compte.

## 15. Interface

`Comptabilité → Lettrage` bilingue FR/EN, trois onglets (lettrage, historique &
délettrage, rapports). Tableau desktop et cartes Android sous 640 px avec
référence, date, compte, débit, crédit, restant, statut et action ; aucun
débordement horizontal. La pastille Démo et l’assistant restent accessibles.

## 16. Démonstration et tests

Démo Pages, schéma `10`, scénarios **A→I** : client complet, client partiel,
fournisseur 80 000/30 000, multi-factures, avoir fournisseur, double lettrage
refusé, délettrage historisé, règlement rapproché en banque, facture non
comptabilisée bloquée. Toutes les données sont fictives et stockées dans le
navigateur.

Tests :

- `apps/api/tests/lettering.test.ts` : **30 tests** (29 verts, 1 concurrence
  PostgreSQL ignoré localement) ;
- suite API complète : **291 verts / 11 ignorés** ;
- web : **153 verts**, démo lettrage **8**, interface lettrage **5**,
  Banque **6** ;
- typecheck, builds et migrations validés ;
- CI GitHub sur `16c6193` : runs `41203043988` et `41203040241` (CI),
  `41203040366` (Pages) — **tous verts**, y compris PostgreSQL réel et les
  migrations rejouées.

### Limites honnêtes

- La concurrence réelle et PostgreSQL sont exécutés en CI
  (`postgres-tests`), pas dans l’environnement local PGlite.
- Aucun test sur Samsung Android physique ni Chrome réel dans cet
  environnement ; les tests DOM et CSS ne remplacent pas une vérification
  matérielle.
- Aucun fournisseur IA génératif payant n’est activé.
- Les règles fiscales et comptables mauriciennes détaillées restent
  **À VÉRIFIER** ; aucune conformité MRA n’est affirmée.
