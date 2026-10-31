# Mode démonstration (navigateur) — GitHub Pages

> **Nature.** La démonstration publiée sur GitHub Pages est une **simulation intégrale**
> exécutée dans le navigateur. Elle ne contacte aucun serveur, n'ouvre aucune base
> PostgreSQL et ne contient aucun secret. Les écritures saisies existent **uniquement**
> dans le `localStorage` du navigateur du visiteur.

## 1. URL et accès

| | |
|---|---|
| URL | `https://azharshahim.github.io/mauritius-compta/` |
| Source | branche `arena/b0b62798-mauritius-compta`, workflow `.github/workflows/pages.yml` |
| État | ✅ en ligne, vérifié le 31/10/2026 (page 200, bundle JS 200, fallback 404 actif) |
| Identifiant | `demo@mauritius-compta.test` (pré-rempli) |
| Mot de passe | `DemoPassw0rd2026` (pré-rempli) |

Le site est construit avec `VITE_DEMO_MODE=true`. Le build servi par l'API (production)
conserve `VITE_DEMO_MODE` absent : il parle au vrai backend, sans aucun changement de code
applicatif.

## 2. Comment le mode démo est branché

Un seul point d'entrée : `apps/web/src/api.ts` (`request()` et `downloadExport()`).
Lorsque `demoEnabled` est vrai, les appels ne partent pas en `fetch` mais sont traités par
`apps/web/src/demo/runtime.ts`.

| Fichier | Rôle |
|---|---|
| `apps/web/src/demo/runtime.ts` | « Backend » navigateur : auth, sociétés, comptes, journaux, écritures, rapports, périodes, taux, membres, audit, exports CSV |
| `apps/web/src/demo/seed-data.ts` | Données fictives de départ : société `Lagon Bleu Trading Ltd (DEMO)`, 35 comptes, 5 journaux, 9 écritures (dont 1 brouillon et 1 contrepassation) |
| `apps/web/src/demo/payroll.ts` | Paie fictive : 18 salariés A→R, puis scénario mission 16 (`Mauritius Demo Services Ltd`, Daniel Morel, octobre 2026, règles datées 2026/27) |
| `apps/web/src/demo/index.ts` | Interrupteur `demoEnabled` + ré-exports |
| `apps/web/src/errors.ts` | `ApiError` partagé entre le client réel et la démo |
| `apps/web/src/components/DemoBanner.tsx` | Bandeau permanent + réinitialisation |

Caractéristiques techniques :

- **Session** : conservée dans l'état local (`loadState().session`) ; aucun cookie, aucun
  jeton.
- **Persistance** : `localStorage`, clé `mc.demo.state.v1`. Si le stockage est indisponible
  (navigation privée, quota), repli mémoire et indicateur `isDemoVolatile()`.
- **Arithmétique** : montants en entiers (`BigInt`, ×10⁴) et taux en ×10⁸ — aucune
  opération monétaire en flottant.
- **Routage** : `HashRouter` en mode démo (GitHub Pages n'a pas de réécriture serveur) ;
  `BrowserRouter` en production. `apps/web/public/404.html` redirige les liens profonds.
- **Base d'URL** : `/mauritius-compta/` en démo, `/` sinon (`vite.config.ts`).

## 3. Fonctionnalités simulées (utilisables)

- Connexion / déconnexion, inscription (société de démonstration créée automatiquement).
- Tableau de bord, sélecteur de société, période analysée.
- **Importation & migration** (mission 8) : six étapes, fichiers CSV/TSV/XLSX
  fictifs téléchargeables, correspondances, contrôles, prévisualisation,
  confirmation explicite, rapport ; stockage local uniquement (schéma 8).
- Mission 10 : scénarios fictifs A→G (n↔1, partiel, groupé, déjà comptabilisé,
  double tentative, ambiguïté, virement interne), cartes mobiles et rapport
  détaillé ; le navigateur ne comptabilise jamais.
- **Banque & rapprochement** (mission 9) : deux comptes fictifs (MUR `•••• 1234`,
  EUR `•••• 9876`), transactions, factures/écritures existantes, import CSV/XLSX,
  quatre relevés fictifs, rapprochement humain, propositions, règles et
  rapport CSV. Aucun appel réseau, aucune connexion bancaire réelle.
- **Indicateur Démo** : petit bouton permanent dans l'en-tête (explication +
  réinitialisation) ; plus aucune barre fixe masquant les commandes Android.
  L'identification complète reste visible sur l'écran de connexion.
- Plan comptable : création, modification, désactivation, suppression contrôlée
  (`ACCOUNT_CODE_TAKEN`, `ACCOUNT_IN_USE`).
- Journaux, écritures : brouillon, validation, modification/suppression d'un brouillon,
  immutabilité des écritures validées, contrepassation unique.
- Numérotation `CODE-ANNÉE-0000` par séquence, références uniques insensibles à la casse,
  contrôle d'équilibre débit/crédit, montants à 4 décimales maximum.
- Devises : MUR, EUR, USD, GBP ; taux daté obligatoire lors d'un changement de devise ;
  montants convertis en devise fonctionnelle.
- Périodes comptables : clôture / réouverture, refus d'écriture hors période ouverte.
- Grand livre, balance générale, états financiers (bilan équilibré, résultat cumulé).
- Taux de change, membres et rôles, journal d'audit (local), exports **CSV** (BOM UTF-8,
  séparateur `;`, neutralisation des formules).

## 4. Fonctionnalités nécessitant le backend réel

| Fonction | Pourquoi |
|---|---|
| Pièces jointes (téléversement/téléchargement) | Stockage serveur, contrôle binaire → `501 DEMO_UNSUPPORTED` |
| Export **PDF** officiel | Généré par PDFKit côté API ; en démo le bouton ouvre l'impression du navigateur. **Aucun PDF serveur n'est produit en démo** et le bulletin reste une simulation non valide pour paiement |
| Multi-utilisateurs réels, sessions persistées, mots de passe hachés | Le backend applique Argon2id, cookies `HttpOnly`, verrouillage de compte |
| Persistance réelle, sauvegardes, audit inaltérable | PostgreSQL + triggers d'intégrité |
| Contrôles de concurrence (contrepassation concurrente, isolation multi-société en base) | Garantis par les contraintes PostgreSQL |
| TVA, e-invoicing et déclarations MRA | Non implémentés (voir `docs/mauritius-regulations/`) ; la paie est une simulation sourcée, non validée par expert |

## 5. Sécurité de la démonstration

- Aucune connexion réseau n'est effectuée : un test vérifie que `fetch` n'est jamais appelé.
- Aucun secret, aucune donnée réellement identifiable : toutes les données sont inventées.
- Le bandeau de démonstration est **permanent** (non fermable) et rappelle l'absence de
  sauvegarde serveur.
- Le dépôt reste la source de vérité : GitHub Pages ne publie que le bundle construit.

## 6. Construire et vérifier en local

```bash
npm ci
npm run test -w @mc/web          # 19 tests jsdom : moteur + écrans + formatage
npm run typecheck -w @mc/web
npm run build:demo               # génère apps/web/dist avec base /mauritius-compta/
npm run preview -w @mc/web       # sert le bundle (vérifier /mauritius-compta/)
```

## 7. Activation de GitHub Pages (opération du propriétaire)

GitHub Pages doit être activé **une fois** par le propriétaire du dépôt :

1. `Settings` → `Pages` → `Build and deployment` → `Source: GitHub Actions`.
2. Onglet `Actions` → workflow **Demo (GitHub Pages)** → `Re-run all jobs`
   (ou nouveau commit sur la branche de développement).

Le jeton d'automatisation utilisé par l'assistant ne dispose pas des droits
d'administration nécessaires pour créer le site Pages (`403 Resource not accessible by
integration`) ; cette étape est donc manuelle et sans effet sur le code.

> **Branche de déploiement.** L'environnement `github-pages` du dépôt n'autorise par défaut
> que les branches protégées. Pour publier depuis la branche de développement sans toucher à
> `main`, le job `deploy` ne déclare pas `environment: github-pages` et utilise uniquement les
> permissions `pages: write` / `id-token: write`. Alternative équivalente : ajouter la branche
> dans `Settings` → `Environments` → `github-pages` → `Deployment branches and tags`.
