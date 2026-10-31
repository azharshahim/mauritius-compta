# Rapport final — mission 11 : Achats & Fournisseurs

> Branche `arena/b0b62798-mauritius-compta`, PR nº1 **en brouillon**, `main`
> intact, aucun déploiement OVH, aucune donnée réelle, aucun fournisseur IA
> payant, aucune dépense. Les taux de démonstration sont explicitement fictifs.

## 1. Audit préalable

✅ **Réalisé en lecture seule avant le code**, documenté dans
[`purchases-audit.md`](purchases-audit.md). Conclusion : le moteur comptable,
les journaux, le plan comptable, les taux configurés, les propositions, la
banque et les pièces jointes existants sont réutilisés. Aucun second grand
livre, aucun second moteur de comptabilisation, aucune copie de dépôt externe.
La table `billing_payment_allocations` a été écartée car sa clé étrangère vise
le sous-ledger clients.

## 2. Rubrique Comptabilité → Achats & Fournisseurs

✅ Route réelle `/accounting/purchases` (le drapeau `prepared` a été retiré),
six onglets : tableau de bord, fournisseurs, factures, avoirs, règlements,
échéancier. Tableaux sur desktop, **cartes empilées sous 640 px** avec actions
pleine largeur ; aucun débordement horizontal volontaire, pastille IA
conservée. Le libellé erroné « Achats & OCR » est corrigé en « Achats &
Fournisseurs » (FR/EN).

## 3. Fiches fournisseurs

✅ Raison sociale, référence, pays, adresse/ville, contact, téléphone, e-mail,
numéro d'enregistrement, numéro fiscal/TVA facultatif, devise, conditions de
paiement, compte fournisseur actif, actif/inactif, notes. Fournisseurs
étrangers autorisés. Doublons **signalés sans fusion automatique** (409 avec
candidats). Isolation société par `company_id` et permissions.

## 4. Factures d'achat

✅ Numéro fournisseur, dates, échéance, devise, lignes charges/actifs, HT/TVA/
TTC exacts, statuts brouillon/validé/annulé, historique. Numérotation
`ACH-AAAA-NNNN` atomique à la validation. Doublon de numéro fournisseur bloqué
par fournisseur et société. Modification impossible après validation.

## 5. Taxes configurées, aucun taux en dur

✅ Les taux viennent uniquement de `billing_tax_rates`. Un taux non vérifié est
refusé ; `vatRecoverable` est une décision explicite. La TVA non récupérable
est incluse au coût. Aucun taux, seuil, règle MRA, reverse charge ou
autoliquidation n'est inventé. Le taux de démonstration `DEMO-15` reste marqué
**fictif et non vérifié**.

## 6. Avoirs

✅ Avoirs liés ou non à une facture, motifs, affectation multi-factures dans la
limite du disponible et du restant dû, désaffectation historisée. Une facture
comptabilisée n'est **jamais** effacée : total inchangé, `credited_amount`
seul mis à jour, annulation refusée (`PURCHASE_ACCOUNTING_POSTED`).

## 7. Règlements

✅ Totaux, partiels, groupés, acomptes, affectation d'avoir, historique.
Scénario imposé exact : **80 000 − 30 000 = 50 000 MUR**, puis solde à
50 000 ; règlement groupé 60 000 + 40 000 ; acompte non affecté ; avoir
10 000. Aucun dépassement de montant, aucune suppression.

## 8. Comptabilisation via le moteur existant

✅ Cycle **Préparer → Vérifier → Valider → Comptabiliser** par
`ai_entry_proposals` + `postProposal`. Contrôles d'équilibre, période, comptes
actifs, devise/taux, TVA, journal, permissions, source, idempotence. Aucune
comptabilisation automatique, aucune comptabilisation par l'IA. Une seconde
comptabilisation renvoie `ACCOUNTING_ALREADY_POSTED`.

## 9. Intégration Banque

🟡 **API et tests complets, interface Banque partielle.** Les routes
`supplier-candidates`, `supplier-payments` et la suppression confirmée sont
implémentées avec verrous, idempotence 201/200, plafonds transaction/règlement
et `bank_matches.purchase_payment_id|purchase_invoice_id`. Aucun second
paiement ni seconde écriture. L'écran Banque n'expose pas encore ces candidats
fournisseur ; l'écran Achats affiche les règlements. Limite déclarée, non
présentée comme terminée.

## 10. Soldes et échéancier

✅ Par fournisseur **et par devise**, filtres, retards, export CSV. Aucune
addition entre devises : le tableau de bord, l'échéancier et l'export groupent
par devise. Une facture avec reliquat n'est jamais affichée soldée.

## 11. Assistant IA

✅ Outils **lecture seule** ajoutés : recherche de fournisseurs, factures
fournisseurs, dettes par devise, doublons potentiels, règlements récents.
Intentions FR/EN dédiées ; les questions fournisseur ne sont pas détournées
vers les clients. Aucun outil ne crée, ne modifie, ne comptabilise, ne valide
un règlement, ni ne déclenche un virement. Les propositions restent humaines.
🟡 La démonstration navigateur utilise l'assistant simulé existant ; les
nouvelles intentions sont couvertes côté API, pas par un test d'écran dédié.

## 12. Sécurité, isolation et concurrence

✅ Isolation `company_id`, permissions `viewer`/`accountant` sur le module
`accounting`, audit append-only, idempotence, verrous `FOR UPDATE`, rollback
transactionnel. Trois tests de concurrence PostgreSQL ajoutés (double
règlement, double lien bancaire, double avoir). **Ignorés en local** sans
`TEST_DATABASE_URL`, exécutés par le job CI PostgreSQL réel.

## 13. Android / mobile

🟡 Mise en page mobile réutilisée (cartes < 640 px), zones sûres et absence de
bandeau DEMO fixe conservées, correctif de sélection de fichiers `d3a4347`
intact (tests `upload-policy` verts). **Aucun test sur Samsung Android physique
n'a été effectué** : l'impossibilité est déclarée, les vérifications sont
DOM/CSS et non une preuve matérielle.

## 14. Démonstration A→H

✅ Schéma localStorage **9**, `demo/purchases.ts`, scénario fictif :
A) facture 80 000 ; B) règlement partiel 30 000 / restant 50 000 ; C)
règlement groupé 60 000 + 40 000 ; D) avoir 10 000 affecté ; E) facture en
retard ; F) facture déjà comptabilisée ; G) tentative de double règlement
refusée ; H) fournisseur étranger en EUR avec solde distinct. Page
`https://azharshahim.github.io/mauritius-compta/` reconstruite par le workflow
Pages après push.

## 15. Tests et CI

✅ **API : 262 tests verts, 10 ignorés** (concurrence sans PostgreSQL local),
dont `purchases.test.ts` **31/31**, `bank.test.ts` 28/28,
`bank-billing.test.ts` 18/18, `migration.test.ts` 23/23 après correction de la
contrainte `journal_entries.source` (les sources `migration` et
`migration_opening` sont conservées).
✅ **Web : 139 tests verts** (127 existants + 11 `demo-purchases` +
1 `purchases-ui`) après la dernière exécution locale.
✅ Typecheck API/web et builds exécutés localement avant commit.
✅ Migration `0011` appliquée par `tests/migrations.test.ts` sur PGlite.
🟡 **PostgreSQL réel via GitHub Actions : à exécuter après push** ; le
résultat sera consigné dans la PR nº1. Aucun test CI n'est annoncé vert avant
son exécution.
⛔ Non exécutés : navigateur Chrome réel, Samsung Android physique, tests
Playwright, déploiement OVH (interdit).

## 16. Documentation et livraison

✅ `docs/purchases-audit.md`, `docs/purchases-suppliers.md`,
`docs/supplier-payments.md`, `docs/supplier-accounting.md`, ce rapport,
CHANGELOG et README. Commits descriptifs sur la branche uniquement. PR nº1
laissée **ouverte en brouillon** ; aucune fusion, aucun changement de `main`,
aucune release.

### Verdict

Le sous-ledger fournisseur, les avoirs, les règlements, les soldes par devise,
la démo et la comptabilisation via le moteur existant sont **opérationnels et
testés localement**. Les limites restantes sont déclarées : interface Banque
fournisseur partielle, absence de test matériel Android, CI PostgreSQL à
confirmer après push, écarts de change et conformité fiscale mauricienne
**NON IMPLÉMENTÉS**.
