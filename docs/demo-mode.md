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
| Export **PDF** officiel | Généré par PDFKit côté API ; en démo le bouton ouvre l'impression du navigateur |
| Multi-utilisateurs réels, sessions persistées, mots de passe hachés | Le backend applique Argon2id, cookies `HttpOnly`, verrouillage de compte |
| Persistance réelle, sauvegardes, audit inaltérable | PostgreSQL + triggers d'intégrité |
| Contrôles de concurrence (contrepassation concurrente, isolation multi-société en base) | Garantis par les contraintes PostgreSQL |
| Toute fonction réglementaire (TVA/MRA/e-invoicing/paie) | Non implémentée (voir `docs/mauritius-regulations/`) |

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
