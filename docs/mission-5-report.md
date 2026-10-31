# Rapport de mission Nº5 — Correctif Android + Mauritius AI Engine

**Date** : 31 octobre 2026
**Branche** : `arena/b0b62798-mauritius-compta`
**Pull request** : [#1](https://github.com/azharshahim/mauritius-compta/pull/1) — brouillon, **non fusionnée**, `main` intacte
**Dernier commit applicatif** : `a6c9b66` (interface IA + démo), `b6488a2` (moteur IA), `2f0a8b1` (documentation)

Objectif : (1) corriger à sa source la perte de focus qui ferme le clavier Android, puis
(2) poser les fondations opérationnelles d'un moteur IA multi-fournisseurs.

---

## 1. Cause exacte du bug clavier Android

**Symptôme** (Samsung, Android) : dans un formulaire, le clavier virtuel se refermait après
la **première lettre**, puis à chaque caractère.

**Cause** : dans `apps/web/src/components/ui.tsx`, l'effet de gestion du focus du composant
`Modal` dépendait de `onClose` :

```tsx
useEffect(() => { …dialogRef.current?.focus(); … }, [open, onClose]);
```

Or tous les formulaires passent `onClose` sous forme de fonction fléchée inline
(`onClose={() => setOpen(false)}`). Chaque frappe met à jour l'état contrôlé → rendu du
parent → **nouvelle identité** pour `onClose` → l'effet est relancé → il replace le focus sur
le conteneur `.modal` → **le champ est flouté** → Android referme le clavier.

Ce n'était donc ni un composant déclaré dans un autre composant, ni une clé React instable,
ni un `blur()` explicite : c'était un effet dont les dépendances changeaient à chaque rendu.
Le défaut était reproductible en jsdom, ce qui a permis de le prouver avant correction :
`document.activeElement` valait `.modal` (un `DIV`) dès le premier caractère.

## 2. Correctif appliqué

- `onClose` est conservé dans une **ref** (`onCloseRef`) : l'effet de focus ne dépend plus
  que de `[open]` et ne se relance donc plus pendant la saisie.
- Le focus n'entre dans le dialogue que s'il est **ailleurs** (`!dialog.contains(activeElement)`),
  une seule fois à l'ouverture, avec `preventScroll`.
- Le focus n'est rendu à l'élément déclencheur qu'à la **fermeture** (nettoyage de l'effet).
- `Escape` continue de fermer la modale via la ref (comportement inchangé).
- Complément mobile : champs à **16 px** sur petit écran (Chrome Android zoome au focus en
  dessous) et hauteur de modale en `dvh` quand le clavier est ouvert.

**Aucun contournement** de type « refocus forcé » ou « réouverture du clavier » n'a été
ajouté : la cause a été supprimée.

## 3. Tests de saisie réalisés

`apps/web/tests/input-focus.test.tsx` — **10 tests**. Chaque caractère est saisi séparément
et, après chaque frappe, le test vérifie que le **même nœud DOM** est actif, qu'il est
toujours monté et que la valeur contrôlée suit la saisie.

| Formulaire | Vérifié |
|---|---|
| Connexion (e-mail + mot de passe) | focus conservé |
| Recherche de dossier (déclenche un rechargement) | focus conservé malgré l'appel |
| Création de dossier (nom, CRN, adresse) | identité du nœud conservée |
| Modification d'un dossier existant | idem |
| Création de tâche (titre, description) | idem |
| Éditeur d'écriture (référence, montant décimal) | idem |
| Plan comptable (recherche + création) | idem |
| Paramètres comptables | idem |
| Ouverture/fermeture de modale | focus entrant puis rendu au déclencheur |
| Tiroir de navigation mobile | le champ actif n'est pas volé |

Preuve du pouvoir de détection : **avec le correctif retiré, 5 de ces 10 tests échouent** ;
avec le correctif, 10/10 passent.

**Limite honnête** : jsdom ne rend pas le clavier virtuel d'Android. Ces tests prouvent
l'absence de perte de focus et de démontage, pas le rendu du clavier. **Une validation
manuelle sur le Samsung du propriétaire reste nécessaire** (procédure : ouvrir
Cabinet → Dossiers clients → « Nouveau dossier », taper 10 caractères sans interruption).

## 4. Architecture IA implémentée

```
apps/api/src/modules/ai/
├── types.ts            interface AIAdapter, capacités, catalogue de fonctionnalités
├── catalogue.ts        chargement validé de config/ai-providers.json (Zod)
├── registry.ts         registre fournisseur → adaptateur
├── adapters/openai.ts  OpenAI, DeepSeek, Mistral, compatible, auto-hébergé
├── adapters/gemini.ts  Gemini (systemInstruction, responseSchema, usageMetadata)
├── adapters/simulated.ts fournisseur fictif déterministe, hors ligne
├── service.ts          orchestration, sélection, clés, budget, débit, retries, usage
├── suggestions.ts      suggestion de compte + décisions + règles
├── crypto.ts           AES-256-GCM, AAD, rotation
├── cost.ts             coût exact en BigInt
├── simulation.ts       algorithme partagé avec la démo
└── routes.ts           /cabinet/ai/* et /companies/:id/ai/*
```

- **Registre de fournisseurs** et adaptateurs : ajouter un fournisseur compatible ne demande
  aucune ligne de code métier.
- **Sélection** : manuelle (cabinet) ou automatique, cette dernière **refusée**
  (`409 AI_ROUTING_DISABLED`) tant qu'aucun tarif daté n'est marqué vérifié.
- **Garde-fous** : timeout 20 s, 1 tentative supplémentaire maximum, limitation de débit
  20 req/min/cabinet, plafond de requêtes, budget mensuel, longueur d'entrée limitée.
- **Validation** : toute réponse est une donnée non fiable, validée par schéma puis
  confrontée à la base (compte existant et actif de la société).
- **Traçabilité** : `ai_usage` (tokens, latence, statut, coût éventuel), `ai_request_log`
  (métadonnées, **sans prompt ni réponse**), `audit_log`.
- **Base** : migration `0005_ai.sql`, additive et idempotente — cabinets, réglages IA,
  clés chiffrées, usage, suggestions, règles, tarifs datés. Aucun `DROP`.

## 5. Fournisseurs réellement intégrés et seulement préparés

| Fournisseur | Adaptateur écrit | Testé |
|---|---|---|
| OpenAI | oui (`openai`) | **pas d'appel réel** (interdit par la mission) ; format requête/réponse couvert par le code et les tests du fournisseur simulé |
| DeepSeek | oui (`openai`) | idem |
| Mistral AI | oui (`openai`) | idem |
| Google Gemini | oui (`gemini`) | idem |
| Compatible OpenAI | oui (`openai`) | URL validée, refus des hôtes privés **testé** |
| Auto-hébergé | oui (`openai`) | désactivé par défaut, non testé |
| Simulateur fictif | oui (`simulated`) | **testé de bout en bout** |

Aucune clé réelle n'a été utilisée, aucun crédit acheté, aucune dépense engagée. Les
adaptateurs réseau sont volontairement non exercés : `fetch` est remplacé par un espion qui
fait échouer le test s'il est appelé.

**Seulement préparé** (contrats exposés, `501 NOT_IMPLEMENTED`) : OCR de factures,
extraction fournisseur/date/montant/TVA, propositions d'écritures, détection de doublons,
lecture de relevés PDF/CSV/XLSX/OFX, rapprochement bancaire, lettrage, classement
documentaire, suggestions de tâches, contrôles de révision, anomalies de facturation,
analyse des variables de paie, analyse des états financiers.

## 6. Fonctionnement du système de clés API (BYOK)

1. Un administrateur de cabinet saisit la clé dans **Cabinet → Paramètres IA**.
2. Le serveur vérifie le fournisseur, la longueur et l'absence de caractères de contrôle,
   puis chiffre la clé en **AES-256-GCM** avec `AI_ENCRYPTION_KEY` (clé dédiée, 32 octets,
   absente du dépôt) et des **données authentifiées** `cabinet_id + provider + version`.
3. `ai_credentials` conserve le chiffré, la version de clé, les dates et l'auteur —
   **jamais** la clé, ni ses derniers caractères.
4. L'API ne renvoie que `configured: true/false` ; l'interface affiche « Clé configurée ».
5. Remplacer une clé révoque l'ancienne ligne et en insère une nouvelle (même transaction).
   Supprimer révoque (`revoked_at`), l'historique d'audit est conservé.
6. Rotation de la clé de chiffrement : nouvelle valeur + `AI_ENCRYPTION_KEY_VERSION`,
   ancienne dans `AI_ENCRYPTION_PREVIOUS_KEYS="v0:…"` pendant la transition.
7. Sans `AI_ENCRYPTION_KEY`, l'enregistrement est **refusé** (`503`) : pas de repli en clair.

Tests correspondants : aller-retour, refus d'un chiffré copié vers un autre cabinet ou un
autre fournisseur, refus d'un payload altéré, version inconnue, rotation, absence de fuite
dans la réponse HTTP et dans la base, refus d'URL privée, refus d'enregistrement sans clé
de chiffrement.

## 7. Fonctionnement du contrôle des coûts

- Une ligne `ai_usage` par appel : cabinet, société, module, fonctionnalité, fournisseur,
  modèle, tokens entrée/sortie, coût estimé, source (`catalogue`/`unknown`), statut, latence.
- Coût calculé en **BigInt** : `tokens × prix(µUSD/MTok) / 1e6`, arrondi demi-supérieur,
  stocké en `numeric(12,6)`. Vérifié par test : 1 M tokens à 0,15 + 0,5 M à 0,60 = **0.450000 USD**.
- **Sans tarif daté**, `estimated_cost_usd = NULL` et l'interface affiche « Coût
  indisponible » : le catalogue livré contient volontairement `"pricing": []`.
- Plafonds appliqués **avant** l'appel, côté serveur : budget mensuel (`402 AI_BUDGET_EXCEEDED`),
  plafond de requêtes (toujours opposable, même sans tarif), seuil d'alerte (80 % par défaut),
  limitation de débit (`429 AI_RATE_LIMITED`).
- Mode « IA incluse dans l'abonnement » : colonne en base contrainte à `false`, aucune clé
  mutualisée, aucune refacturation.

## 8. Résultat de la démonstration de suggestion comptable

Parcours vérifié (tests API + tests jsdom, et visible sur GitHub Pages) :

1. Description « Achat de fournitures de bureau — 2 500 MUR ».
2. Proposition : **compte du plan comptable réel** de la société (par exemple
   `6100 — Fournitures de bureau` dans le plan par défaut), catégorie, justification,
   confiance (≈ 82 % avec correspondance, ≈ 20–35 % sinon), statut **« À vérifier »**.
3. L'utilisateur **accepte**, **corrige** (compte choisi dans la liste) ou **refuse**.
4. Une **règle réutilisable** peut être mémorisée : la proposition suivante contenant le
   même mot-clé est servie par la règle, sans appel fournisseur (`source: "rule"`).
5. **Aucune écriture n'est créée** : le nombre d'écritures de la société est identique avant
   et après la proposition puis l'acceptation (testé côté API et côté démonstration) ;
   la réponse HTTP contient `entryCreated: false`.

Un compte absent du plan comptable est **refusé** : soit le fournisseur est corrigé une
fois, soit la réponse est rejetée (`422 AI_INVALID_RESPONSE`) et rien n'est enregistré.

## 9. Tests exécutés et résultats exacts (31/10/2026)

| Commande | Résultat |
|---|---|
| `npm run typecheck` | **0 erreur** (API + web) |
| `npm test` | **152 passed \| 4 skipped (156)** — API 106/4 sur 11 fichiers, web **46/46** sur 4 fichiers |
| `VITE_DEMO_MODE=true npm run build:demo` | OK — `dist/assets/index-B05WDR_s.js` **506 827 octets** |

Répartition web : `demo-engine` 22, `demo-app` 10, `input-focus` 10, `format` 4.
Répartition API : `ai` **22** (nouveaux), `cabinet` 11, plus les 73 tests hérités. Les
4 ignorés sont les tests de concurrence qui exigent un vrai PostgreSQL (exécutés en CI).

Les 61 tests de la comptabilité V0.1/V0.2/V0.3 restent verts : aucune régression.

## 10. Statut GitHub Actions

| Workflow | Run | Résultat |
|---|---|---|
| `CI` (Typecheck/tests/build, API PostgreSQL, Migrations) | 41153025239 | **success** — 3 jobs `pass` |
| `Demo (GitHub Pages)` | **41153020311** | **success** (build + deploy) |

`gh pr checks 1` → tous les contrôles `pass` (5 contrôles).

## 11. URL HTTPS publiée et vérifiée

**https://azharshahim.github.io/mauritius-compta/**

Vérification exécutée depuis le runner GitHub (le bac à sable de l'assistant n'atteint pas
`*.github.io`), annotation du job de déploiement :

> `index 200`, asset `/mauritius-compta/assets/index-B05WDR_s.js` (**506 827 octets**),
> `404.html 200`, lien profond `404` attendu, 4 modules et cabinet présents.

Le workflow vérifie désormais aussi la présence de **« Simulation IA »**, **« Assistant
comptable »** et **« Intelligence artificielle »** dans le bundle publié : une régression de
l'espace IA fait échouer le déploiement.

## 12. Branche, PR et dernier commit

- Branche de session : `arena/b0b62798-mauritius-compta` — l'environnement n'autorise pas de
  branche supplémentaire ; la contrainte est documentée ici et dans le README.
- PR #1 : **brouillon, non fusionnée**, base `main`.
- `main` : `9e46f16 Initial commit` — **aucun commit de cette mission**.
- Commits de la mission :
  `5d36048` fix clavier Android · `b6488a2` moteur IA (API) · `a6c9b66` écrans IA + démo ·
  `2f0a8b1` documentation + contrôle CI Pages.

## 13. Limitations et anomalies restantes

1. **Aucun appel réel à un fournisseur** n'a été effectué (clé interdite, dépense interdite).
   Les adaptateurs OpenAI et Gemini sont écrits mais non exercés contre l'API réelle : la
   première mise en service devra être validée par un test de connexion manuel.
2. **Validation Android réelle non faite** : jsdom prouve l'absence de perte de focus, pas le
   comportement du clavier Samsung. Validation manuelle à faire.
3. **Aucun tarif** n'est embarqué : les coûts restent « indisponibles » tant qu'un
   administrateur n'a pas saisi un tarif daté. Le budget en USD n'est alors pas opposable
   (seul le plafond de requêtes l'est).
4. **Routage automatique** volontairement bloqué sans tarifs vérifiés ; il n'a donc jamais
   tourné en conditions réelles.
5. **Rétention des données IA** : pas de purge automatique ni de durée configurable
   (documenté comme point à définir avec les cabinets).
6. **Conformité juridique non établie** : aucune mention de conformité (Data Protection Act,
   transferts internationaux) n'est affichée ; une revue juridique reste nécessaire.
7. **Clé de chiffrement** fournie par variable d'environnement : pas encore de KMS/Vault ni
   de rotation automatisée.
8. **Fonctionnalités annoncées** (OCR, banque, rapprochement, paie, facturation) : contrats
   seulement, routes en `501`.
9. Le bundle de démonstration dépasse 500 kB (avertissement Vite informatif) ; un découpage
   par route est à prévoir si l'application grossit.
10. La base existante voit ses sociétés rattachées à un cabinet déduit de leur administrateur
    (migration) ; une installation multi-cabinets historique devra être vérifiée manuellement.

## 14. Recommandation pour la prochaine mission

**Mission Nº6 — Facturation opérationnelle et première extension IA maîtrisée.**

1. Finaliser la facturation (devis → facture → avoir, numérotation séquentielle, encaissements)
   avec la chaîne `facture validée → écriture proposée → validation → comptabilisation` déjà
   spécifiée, et `billing_documents.accounting_entry_id` unique.
2. Brancher **un** cas d'usage IA supplémentaire sur des données structurées et non
   personnelles (détection de doublons de factures), pour mesurer la qualité avant d'ouvrir
   l'OCR.
3. Mettre en place la **rétention configurable** des journaux IA et la rotation externalisée
   de `AI_ENCRYPTION_KEY` (KMS/Vault).
4. Faire réaliser la revue juridique (protection des données, transferts internationaux,
   information des clients des cabinets) avant toute commercialisation du mode IA.
5. Planifier la validation manuelle Android et, si possible, un test automatisé sur
   émulateur (Playwright/Appium) pour le clavier.
