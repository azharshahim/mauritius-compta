# Rapport de mission 10 — rapprochement bancaire avancé & intégration Facturation

> Branche `arena/b0b62798-mauritius-compta`, PR nº1 **ouverte en brouillon**,
> base `d3a4347`. Aucune fusion, aucun déploiement OVH, aucune dépense, aucune
> connexion bancaire réelle, aucune donnée réelle.

## 1. Branche, HEAD et état de la PR

- Dépôt : `azharshahim/mauritius-compta`.
- Branche conservée : `arena/b0b62798-mauritius-compta`.
- Base de la mission : `d3a4347` (correctif Android mission 9).
- Les commits mission 10 sont descriptifs et poussés sur cette seule branche.
- PR nº1 : laissée **ouverte en brouillon** ; le corps est mis à jour avec le
  périmètre mission 10. `main` n'est pas modifiée, aucune release.

## 2. Architecture et migration

- Nouvelle migration : `apps/api/sql/migrations/0010_bank_billing.sql`.
- `bank_matches` devient une affectation chiffrée : `amount`,
  `billing_invoice_id`, `note`, `updated_at`; index uniques partiels sur les
  couples confirmés `(transaction, règlement)` et `(transaction, facture)`.
- Statut de transaction ajouté : `partially_matched`.
- Aucun second grand livre, aucun second moteur de paiement, aucune duplication
  du moteur comptable.
- Nouveaux modules :
  - `apps/api/src/modules/bank/billing.ts` : candidats, confirmation, retrait ;
  - `apps/api/src/modules/bank/reports.ts` : rapport/CSV détaillé.
- Le moteur comptable existant (`postEntryTx`) et le moteur de propositions IA
  existant (`proposeFromBilling` → `validateProposal` → `postProposal`) sont
  réutilisés sans réécriture.

## 3. Rapprochement plusieurs transactions → une facture (n ↔ 1)

- Une facture peut être réglée par plusieurs règlements clients, chacun affecté
  à la facture.
- Chaque règlement est rapproché de sa transaction bancaire avec un montant
  explicite.
- Le total confirmé côté transaction et côté règlement est contrôlé sous verrou.
- Le statut de la facture reste calculé par `refreshInvoiceBalance` à partir des
  affectations ; le restant dû est exact.
- La facture n'est jamais recréée ni dupliquée.

## 4. Rapprochement une transaction → plusieurs factures (1 ↔ n)

- Un règlement unique peut être affecté à plusieurs factures ; la transaction
  est liée à ce règlement et affiche toutes les factures concernées.
- Une transaction peut aussi être affectée à plusieurs règlements ; son statut
  passe de `partially_matched` à `matched` quand le total est atteint.
- Les deux chemins sont couverts par tests et par les scénarios C et D de la
  démonstration.

## 5. Paiements partiels

- Montant initial, affecté, disponible, restant dû de chaque facture.
- Statut `unpaid` / `partial` / `paid` / `overpaid` (existant) conservé.
- Aucun arrondi : `numeric(20,4)` / `bigint` à l'échelle 10⁴.
- Un montant à plus de quatre décimales est refusé par le schéma.
- L'interface affiche « restant dû » même quand une transaction est entièrement
  rapprochée : rapprochement bancaire ≠ solde de facture.

## 6. Intégration Banque / Facturation

- Le détail d'une transaction liste les règlements candidats de la même devise :
  client, date, montant, disponible, factures, restants, état comptable,
  confiance, anomalies.
- La confirmation humaine crée un `bank_match` avec montant exact.
- Aucune comptabilisation n'est effectuée par le rapprochement.
- Le bouton « Comptabiliser ce règlement » appelle le chemin existant :
  `POST /ai/entry-proposals/from-billing`, `validate`, `post`.
- Si le règlement est déjà comptabilisé, le bouton n'est pas proposé ; une
  seconde écriture est refusée par la contrainte unique et par le contrôle de
  `postProposal`.
- `postProposal` met à jour `bank_matches.entry_id` dans la même transaction.

## 7. Verrous anti-doublons

- Contrainte existante `billing_payments.accounting_entry_id UNIQUE`.
- Contrôle `ACCOUNTING_ALREADY_POSTED` avant proposition et avant posting.
- `postProposal` : verrou `FOR UPDATE`, posting, puis
  `UPDATE … WHERE accounting_entry_id IS NULL`; rollback si 0 ligne.
- `bank_matches` : index unique partiel confirmé par couple.
- Confirmation identique répétée : idempotente (`200`, `idempotent: true`).
- Montant différent sur le même couple : `409 BANK_LINK_ALREADY_EXISTS`.
- Un retrait ne supprime pas l'historique : la ligne passe `rejected`.

## 8. Verrouillage et concurrence

- Confirmation : verrou transaction puis règlement, calcul des restants dans la
  même transaction SQL.
- Deux utilisateurs ne peuvent pas dépasser le montant de la transaction ou du
  règlement.
- Trois tests de concurrence PostgreSQL ont été ajoutés
  (`tests/concurrency.test.ts`) : même couple, plafond transaction, plafond
  règlement.
- PGlite étant mono-connexion, ces trois tests sont **ignorés localement** et
  exécutés par le job CI PostgreSQL réel.

## 9. Lettrage comptable

- Audit : **aucun moteur de lettrage de grand livre** n'existait.
- Aucun second moteur n'a été créé.
- Les allocations de règlements aux factures servent d'open-item client.
- Le rapprochement bancaire reste distinct.
- Le lettrage général/fournisseur est déclaré `NON IMPLÉMENTÉ`.

## 10. Audit initial et limites découvertes

- `bank_matches.billing_payment_id` existait mais n'était jamais écrit.
- Aucun plafond de somme affectée par transaction n'existait.
- Aucun endpoint `/billing/*` de comptabilisation n'existe : le seul chemin est
  l'AI proposal existant.
- `billing_payment_allocations` n'a pas de dimension fournisseur.
- Les lignes comptables restent rapprochées en totalité (mission 9).
- Les devises différentes et écarts de change ne sont pas sécurisés.
- Les remboursements clients, avoirs fournisseurs et virements internes
  automatiques ne sont pas implémentés.

## 11. Correction Android du tableau Transactions

- Desktop : tableau complet conservé.
- Téléphone (< 640 px) : tableau masqué, cartes compactes avec date, libellé,
  montant + devise, référence, statut entier et action « Ouvrir ».
- Montants et statuts ne sont plus tronqués ; aucun débordement horizontal
  forcé ; le panneau de détail et la pastille IA restent accessibles.
- Le correctif de sélection de fichiers `d3a4347` (`lib/upload.ts`) n'a pas été
  modifié.
- Aucun grand bandeau DEMO n'a été réintroduit : l'indicateur compact d'en-tête
  est conservé.
- **Limite** : aucun appareil Samsung/Android physique dans l'environnement ;
  jsdom ne rejoue pas le filtre MIME natif. La vérification est faite sur les
  styles, le DOM et les tests existants, pas sur matériel réel.

## 12. Tests

- API : **231 réussis | 7 ignorés** (les 7 tests de concurrence PostgreSQL).
- Web : **127 réussis / 13 fichiers**.
- Total : **358 réussis | 7 ignorés (365)**.
- Nouveaux tests API (`tests/bank-billing.test.ts`, 18) :
  n ↔ 1, 1 ↔ n, partiel, plafonds, idempotence, devise, société/cabinet,
  permissions, exclusion, annulation refusée, posting unique, retrait,
  ambiguïté, décimales, rapport/CSV, mélange interdit.
- Tests de concurrence ajoutés : 3 (ignorés sans PostgreSQL).
- Tests web ajoutés : 2 (association depuis l'écran Banque, cartes mobiles).
- Tests démo ajoutés : 2 (scénarios A→G, rapport détaillé).
- Typecheck API + web, build production et build démo : réussis.
- CI `41197327498` (push) et `41197332790` (PR) : **succès** ; les trois jobs
  `quality`, `postgres-tests` et `postgres-migrations` sont verts.
- Démo Pages `41197195778` (commit `a2fb589`) : **succès**.

## 13. CI PostgreSQL réel

- Job `postgres-tests` : exécute toute la suite avec `TEST_DATABASE_URL`, donc
  les **7 tests de concurrence** (dont 3 ajoutés en mission 10) — **succès**.
- Job `postgres-migrations` : applique les migrations `0001`→`0010` sur
  PostgreSQL 16 réel, les rejoue pour l'idempotence, puis vérifie par `psql` les
  colonnes `amount`, `billing_invoice_id`, `note`, `updated_at`, les index
  uniques partiels `bank_matches_*_confirmed` et la contrainte de statut
  incluant `partially_matched` — **succès**.
- Les tests PGlite locaux ne remplacent pas cette vérification.
- **Non exécuté dans le bac à sable** : aucun serveur PostgreSQL local n'est
  disponible ; l'exécution a eu lieu dans GitHub Actions (runs ci-dessus).

## 14. Démonstration Pages A → G

Données fictives dans le navigateur, aucun réseau, aucun posting simulé :

- **A** : trois virements (40 000 + 35 000 + 25 000) pour une facture de
  100 000 ;
- **B** : règlement partiel 30 000 sur une facture de 80 000, restant 50 000 ;
- **C** : un virement de 100 000 pour deux factures (60 000 + 40 000) ;
- **D** : règlement déjà comptabilisé (écriture fictive de démonstration) ;
- **E** : rapprochement déjà confirmé ; nouvelle tentative identique idempotente,
  montant différent refusé ;
- **F** : deux règlements de 5 000 pour deux factures, aucun choix automatique ;
- **G** : virement interne sortie/entrée, détection seulement.

Le schéma localStorage passe à **8** ; les anciennes démos sont réinitialisées.
Les scénarios sont visibles dans l'onglet Transactions et le rapport détaillé
fonctionne sans réseau.

## 15. Limites explicites

- Pas de factures fournisseurs, avoirs fournisseurs, remboursements clients.
- Pas de lettrage de grand livre.
- Pas de rapprochement multi-devises / écarts de change.
- Pas de frais bancaires nets d'un règlement : proposition de charge séparée.
- Pas de paiement partiel sur une ligne comptable (seulement sur les règlements
  clients) ; le test mission 9 « une ligne déjà rapprochée » reste valide.
- Pas d'appariement automatique de virement interne.
- Pas de vérification sur Samsung physique.
- Aucune conformité MRA/fiscale mauricienne n'est affirmée.
- L'IA n'a aucun droit de comptabilisation et aucun fournisseur payant n'est
  appelé.

## 16. Recommandations mission 11

1. Modéliser les factures fournisseurs et leurs règlements pour étendre le
   partiel fournisseur sans détourner le grand livre.
2. Ajouter un lettrage de lignes avec table dédiée, traçabilité et annulation
   explicite, sans dupliquer les allocations de factures.
3. Traiter les écarts de change par un moteur dédié (compte 676/776 à valider)
   avant tout rapprochement multi-devises.
4. Appariement assisté des virements internes avec confirmation humaine.
5. Remboursements/avoirs fournisseurs et contrepassations liées aux règlements.
6. Tests E2E sur appareil Android réel (Samsung) et audit d'accessibilité.
7. Pagination/virtualisation du rapport détaillé au-delà de 5 000 écritures.
