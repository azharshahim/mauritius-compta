# Rapport de mission 9 — Import bancaire, rapprochement, ergonomie Android

Date : **31 octobre 2026** · Branche : `arena/b0b62798-mauritius-compta` ·
Périmètre : dépôt `azharshahim/mauritius-compta` uniquement.

## 1. Branche et HEAD

- Branche de développement conservée : `arena/b0b62798-mauritius-compta`.
- Base : `main` à `9e46f16` (intact), mission 8 à `aa1c22e`.
- Les commits de cette mission sont ajoutés à la suite sur la même branche.
- PR nº1 laissée **ouverte en brouillon** : aucune fusion sans autorisation
  explicite du propriétaire.

## 2. Architecture et migrations

- Migration additive `0009_bank.sql` : `bank_accounts`, `bank_imports`,
  `bank_transactions`, `bank_matches`, `bank_rules`, `bank_proposals`,
  `bank_events`.
- Aucun second moteur comptable. L'acceptation d'une proposition appelle
  `postEntryTx` (période, numérotation, équilibre, audit existants).
- Aucun second moteur IA. Les suggestions sont déterministes.
- Code partagé API/démo : `migration/parse`, `bank/profiles`, `bank/engine`,
  `bank/reconcile`, `bank/hash`, `migration/normalize`.
- `bank/hash.ts` remplace `node:crypto` par un digest FNV-1a 64 bits double,
  utilisable dans le navigateur ; l'API utilise le même code pour les
  empreintes de transactions.

## 3. Formats réellement pris en charge

CSV, TSV/TXT et XLSX (vrai ZIP OOXML, sans macro), encodages UTF-8/BOM,
UTF-16, Windows-1252, délimiteurs `,` `;` et tabulation. Champs FR/EN, débit,
crédit, montant signé, devise, solde, référence, identifiant. OFX/QFX, PDF/OCR
et toute connexion bancaire sont **NON IMPLÉMENTÉS** et affichés comme tels.

## 4. Contrôles et idempotence

- 20+ codes d'anomalie explicites ; erreurs bloquantes vs avertissements.
- Soldes d'ouverture/clôture et succession vérifiés en décimal exact.
- Une incohérence de solde n'entraîne **aucune correction automatique**.
- Double idempotence : empreinte fichier + identifiant métier, contrainte
  `UNIQUE (bank_account_id, fingerprint)` et `ON CONFLICT DO NOTHING`.
- Un réimport exact renvoie `reimport: true` et `imported: 0`.

## 5. Rapprochement simple et complexe

- Simple 1↔1 : montant exact, devise, fenêtre de dates, référence, facture,
  libellé ; confirmation humaine obligatoire.
- 1↔n : `SPLIT_MATCH`, sélection humaine des lignes, total exact exigé.
- Ambigu : deux candidats exacts → `ambiguous`, aucun choix automatique.
- Complexe : n↔1, paiement partiel, écart de change → `review`, bloqué et
  documenté. Virement interne détecté, jamais comptabilisé seul.
- Statuts distincts : `unmatched`, `proposed`, `matched`, `review`, `excluded`,
  `cancelled`. Une proposition n'est pas un rapprochement validé.

## 6. IA et règles

- Suggestions déterministes à partir du plan comptable **de la société active**.
- Aucun numéro inventé : la proposition ne peut viser qu'un compte existant et
  actif ; sinon `none` et décision humaine.
- Plusieurs choix si plusieurs règles de même priorité.
- Règles versionnées, désactivables, auditables, jamais enregistrées
  silencieusement.
- AI Engine / assistant V2 existants non dupliqués ; **aucun fournisseur IA
  activé**. Les suggestions génératives sont explicitement non implémentées.

## 7. Salaires

Indices `Salary/Wages/Salaire/Virement salaire/paie` uniquement. Un libellé ne
prouve jamais un salaire : justification bilingue, confiance 0,65, compte de
dette existant ou décision humaine. Aucun calcul de paie, aucun salarié, aucune
charge créée. Test dédié : `payroll_employees` reste vide.

## 8. Facturation

Recherche des numéros de facture dans le libellé, rapprochement de la ligne
d'écriture du règlement existant, aucune création de `billing_payments`.
La double comptabilisation est évitée par l'unicité du rapprochement de ligne
et par le fait qu'une transaction déjà rapprochée ne peut plus l'être. La
traçabilité facture → règlement → banque → écriture reste portée par les
références et l'audit. Le rapprochement direct d'un `billing_payment` non
comptabilisé n'est pas implémenté en V1 (limite).

## 9. Bandeau Android

Le grand bandeau fixe bas a été supprimé. Un **indicateur compact « Démo »**
est présent dans l'en-tête à toutes les étapes, avec pastille, explication et
bouton de réinitialisation. Sur l'écran de connexion, l'identification complète
« MODE DÉMONSTRATION » reste visible. `padding-bottom: 64px` supprimé : aucun
bouton, aucune pastille IA ni safe-area n'est masqué. Aucun débordement
horizontal ajouté ; les onglets Banque défilent horizontalement.

## 10. Rapports d'import compacts

Résumé en quatre compteurs (importables, doublons, avertissements, erreurs),
détails repliés dans « Détails techniques », codes conservés, anomalies non
supprimées. L'historique des imports est compact. L'interface française
n'affiche pas de doublon FR+EN.

## 11. Tests exécutés (résultats réels)

| Suite | Résultat |
|---|---|
| API bancaire `tests/bank.test.ts` | **28 / 28** |
| API complète | **213 réussis, 4 ignorés** |
| Web complète | **116 réussis (12 fichiers)** |
| Dont démo banque | **17 / 17** |
| Dont UI banque + indicateur démo | **2 / 2** |
| Typecheck API | 0 erreur |
| Typecheck web | 0 erreur |
| Build production / build démo | OK |
| CI PostgreSQL réel (push) | run `41192173639` ✅ |
| Chrome/Android réels | **Non exécutés** ; tests jsdom uniquement |

Les 30 scénarios du brief sont couverts par la combinaison des tests API
(28), des tests de démonstration (17) et des tests d'interface (2). La
correspondance détaillée figure dans `docs/test-report.md`.

## 12. CI et PostgreSQL

- `ci.yml` : typecheck, tests PGlite, build, tests PostgreSQL réel et
  migrations.
- Vérification ajoutée : présence des sept tables bancaires après migration et
  ré-application idempotente.
- Les tests bancaires s'exécutent avec la suite API, y compris avec
  `TEST_DATABASE_URL` en CI.
- Résultats après push : CI push `41192173639` ✅, CI PR `41192178271` ✅,
  Pages `41192173531` ✅ (build, déploiement et vérifications HTTPS).
- Les tests PostgreSQL réels et les vérifications des sept tables `bank_*`
  sont passés dans ces runs.

## 13. GitHub Pages et fichiers

- Quatre fichiers fictifs : `releve-bancaire-fictif.csv`,
  `releve-bancaire-fictif.xlsx`, `releve-bancaire-doublons.csv`,
  `releve-bancaire-erreurs.csv` (générés par `npm run samples:bank`).
- Vérifications Pages ajoutées : présence des fichiers, greps du bundle
  (`Banque & rapprochement`, `Confirmer le rapprochement`, `Libellé de paie
  détecté`) et téléchargement HTTP 200 d'un relevé.
- Démonstration 100 % locale, deux comptes (MUR/EUR), transactions, factures
  et écritures existantes, opérations rapprochables et non rapprochables,
  salaire, fournisseur, frais, doublon volontaire.

## 14. Limites explicites

- OFX/QFX, PDF/OCR, connexion bancaire : non implémentés.
- Rapprochement direct d'un règlement de facturation non comptabilisé : non
  implémenté ; seules les lignes d'écriture existantes sont rapprochées.
- n↔1, paiement partiel, écart de change : revue humaine, pas d'automatisme.
- Suggestions IA génératives : non implémentées ; moteur déterministe.
- PDF du rapport bancaire : non généré (CSV uniquement).
- Tests navigateur/Android réels non exécutés.
- Aucune conformité MRA revendiquée ; e-invoicing désactivé ; aucun calcul
  PAYE/CSG/NSF.

## 15. Recommandations pour la mission 10

1. Rapprochement direct des règlements de facturation non comptabilisés, avec
   verrou anti-double-encaissement transactionnel.
2. Support n↔1 et paiements partiels avec modèle de ventilation explicite.
3. Génération PDF serveur du rapport de rapprochement signé.
4. Import OFX avec corpus de tests réellement fictif, sans dépendance payante.
5. Assistant IA optionnel pour expliquer les anomalies, sans droit d'écriture,
   avec fournisseur désactivé par défaut et coûts plafonnés.
6. Tests Playwright sur appareil Android réel et Windows, avec captures et
   mesure des safe-areas.

## 16. Conclusion

La mission livre un import bancaire fiable, un rapprochement humain explicite
et une ergonomie mobile corrigée. Aucune fonctionnalité simulée n'est
présentée comme de production ; les cas complexes sont bloqués et documentés.
Aucun dépôt tiers n'a été modifié, aucune PR n'a été fusionnée, aucune dépense
n'a été engagée.
