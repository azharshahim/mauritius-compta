# Mauritius Compta

**Logiciel de comptabilité mauricienne bilingue (FR/EN)** — version **0.1.0** (fondations et
cœur comptable).

> ⚠️ **Version de démonstration.** L'application n'est **pas** conforme aux exigences
> réglementaires mauriciennes en l'état : aucune règle fiscale (TVA, impôt, paie) n'est
> implémentée et aucun taux n'est codé en dur. Tous les états et exports portent la mention
> « DOCUMENT DE DÉMONSTRATION ». Voir
> [`docs/mauritius-regulations/`](docs/mauritius-regulations/) et le
> [registre de conformité](docs/mauritius-regulations/compliance-register.md).

---

## 1. Ce qui fonctionne en V0.1.0

| Domaine | Fonctionnalités |
|---|---|
| **Sociétés** | Multi-société, BRN, n° TVA, adresse, activité, exercice, devise fonctionnelle et de présentation, norme comptable, statut ; membres et rôles (owner/admin/accountant/viewer) |
| **Plan comptable** | Comptes hiérarchiques (code, nom, type, parent, devise, actif/inactif, mapping états financiers) ; plan de **démonstration** non officiel ; suppression interdite si le compte est utilisé |
| **Journaux** | Ventes, Achats, Banque, Caisse, Opérations diverses (création possible) |
| **Écritures** | Saisie multi-lignes, brouillon/validée, numérotation automatique `JRN-AAAA-0001`, justificatifs PDF/JPEG/PNG, validation, contrepassation tracée, verrouillage des écritures validées (API **et** PostgreSQL) |
| **Contrôles** | Σ débits = Σ crédits, période clôturée, comptes inactifs, isolation stricte entre sociétés, dates valides, montants exacts (`numeric(20,4)` + BigInt) |
| **Multidevise** | MUR, EUR, USD, GBP ; taux **daté saisi par l'utilisateur** (jamais inventé) ; conservation du montant d'origine et de la contre-valeur fonctionnelle |
| **Grand livre** | Par compte, filtres période/recherche, solde initial, mouvements, solde progressif, totaux, export CSV/PDF |
| **Balance** | Colonnes solde initial / mouvements / solde final (D et C), contrôle d'équilibre, export CSV/PDF |
| **États financiers** | Statement of Financial Position et Statement of Profit or Loss provisoires, contrôle d'équilibre, export CSV/PDF |
| **Interface** | React responsive (utilisable sur Android et Windows), FR/EN commutable, tableau de bord avec indicateurs |
| **Sécurité** | Sessions cookie HttpOnly, scrypt, rôles serveur, requêtes SQL paramétrées, validation Zod, CSRF, CSP, anti-bruteforce, journal d'audit |
| **Exploitation** | Migrations versionnées avec checksums, CI GitHub Actions, documentation technique et réglementaire |

## 2. Stack

- **Backend** : Node.js 20+, TypeScript, Fastify 5, PostgreSQL 14+ (migrations SQL maison).
- **Frontend** : React 19, Vite 6, React Router 7, CSS responsive (sans framework lourd).
- **Exports** : CSV (UTF-8 BOM, séparateur `;`) et PDF (PDFKit).
- **Tests** : Vitest + PGlite (**véritable moteur PostgreSQL en WASM**, aucun service externe).

## 3. Démarrage rapide (sans PostgreSQL installé)

```bash
git clone <dépôt> mauritius-compta && cd mauritius-compta
npm install

# configuration locale (facultatif : des valeurs par défaut sûres s'appliquent)
cp .env.example .env

# base de données + jeu de démonstration (données 100 % fictives)
npm run db:seed

# lancer l'API (:3000) et l'interface (:5173)
npm run dev
```

Ouvrir <http://localhost:5173>.

**Compte de démonstration (fictif) :**

```text
E-mail   : demo@mauritius-compta.test
Mot de passe : DemoPassw0rd2026
Société  : Lagon Bleu Trading Ltd (DEMO)
```

> Sans `DATABASE_URL`, l'API utilise **PGlite** (PostgreSQL embarqué, stockage local dans
> `.data/pglite`). Pratique pour essayer, **déconseillé en production** : utiliser PostgreSQL.

## 4. Démarrage avec PostgreSQL (recommandé)

```bash
docker compose up -d db            # PostgreSQL 16 sur le port 5432
cp .env.example .env               # renseigner DATABASE_URL
npm run db:migrate                 # applique sql/migrations/*.sql
npm run db:seed                    # données fictives (optionnel)
npm run dev
```

`.env` minimal :

```dotenv
DATABASE_URL=postgresql://mc_user:change_me@localhost:5432/mauritius_compta
```

Production (build unique, API + front servi sur un port) :

```bash
npm run build
NODE_ENV=production COOKIE_SECURE=true npm start
```

Voir [`docs/deployment.md`](docs/deployment.md) pour le VPS Ubuntu + Nginx + systemd.

## 5. Tests

```bash
npm test          # 54 tests API (Vitest + PostgreSQL/PGlite)
npm run typecheck # TypeScript strict (API + front)
npm run build     # Build API + front
```

Les tests couvrent les priorités du cahier des charges : création de société fictive,
isolation entre sociétés, comptes, écriture équilibrée, rejet d'écriture déséquilibrée,
protection des écritures validées, grand livre, balance, contrôle débit/crédit, changement de
langue, accès non autorisés et migrations PostgreSQL.
Détail : [`docs/test-report.md`](docs/test-report.md).

## 6. Documentation

| Document | Contenu |
|---|---|
| [`docs/architecture.md`](docs/architecture.md) | Architecture, modèle de données, triggers, sécurité, multidevise, i18n |
| [`docs/api.md`](docs/api.md) | Référence de l'API (routes, corps, erreurs, exemples curl) |
| [`docs/audit-existing-apps.md`](docs/audit-existing-apps.md) | Audit des applications existantes du propriétaire |
| [`docs/deployment.md`](docs/deployment.md) | Préparation VPS Ubuntu + Nginx (non déployé) |
| [`docs/roadmap.md`](docs/roadmap.md) | Fonctionnalités restant à développer, mission 2 |
| [`docs/test-report.md`](docs/test-report.md) | Rapport de tests détaillé |
| [`docs/mauritius-regulations/`](docs/mauritius-regulations/) | Veille réglementaire (comptabilité, TVA, IS, paie, données, sources, registre) |

## 7. Structure

```text
apps/api      API Fastify, migrations SQL, seeds, tests
apps/web      SPA React bilingue
docs/         documentation technique et réglementaire
```

## 8. Sécurité et secrets

- `.env` est ignoré par Git ; `.env.example` ne contient **aucun secret réel**.
- Aucune clé API, aucun mot de passe de production, aucune donnée client dans le dépôt.
- Toutes les données de démonstration sont **fictives** (société, BRN, TVA, montants).
- Signaler toute vulnérabilité au propriétaire du dépôt, sans ouvrir d'issue publique.

## 9. Indépendance

Ce logiciel est **juridiquement et techniquement indépendant** des applications françaises du
propriétaire (paie, comptabilité, facturation) : code, schéma, base et documentation propres.
Aucune règle fiscale française n'a été copiée ni transposée. Aucun dépôt tiers n'a été modifié.

## 10. Licence

Projet privé — **tous droits réservés** au propriétaire. Aucune licence de réutilisation n'est
accordée par ce dépôt (`UNLICENSED` dans `package.json`).

## 11. Limites connues

- États financiers **provisoires**, non IFRS, sans notes annexes ni écritures de clôture.
- Aucun module TVA, impôt, paie, facturation, déclaration MRA (prévus mission 2+).
- Export Excel **CSV** uniquement (XLSX prévu).
- Pas d'authentification à deux facteurs, pas de réinitialisation de mot de passe par e-mail.
- Pas de sauvegarde automatisée intégrée (à mettre en place côté exploitation).
