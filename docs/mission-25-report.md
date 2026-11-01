# Rapport de mission 25 — MRA e-Invoicing « À venir »

**Date : 1er novembre 2026**
**PR : [#8](https://github.com/azharshahim/mauritius-compta/pull/8) — brouillon, ouverte vers `main`, non fusionnée.**
**Branche : `arena/d12d1021-mauritius-compta`**, issue de `main` au commit
`49ee04fee8f5e6151c9e461fb20aa60cafef436d`. Le commit fonctionnel vérifié par la CI est
`8054e94fc7a265ab89395d441fcc7e3089421957` ; le présent rapport est ajouté ensuite, sans
changer le code livré.

> **Aucune fusion, aucune publication depuis une branche Arena, aucune connexion MRA,
> aucune inscription, aucun certificat, aucune donnée réelle, aucune facture électronique.
> La facturation classique reste inchangée et `main` reste intact.**

---

## 1. Publication Mission 24 — vérifiée, non relancée

La publication demandée au point A était déjà réussie avant cette mission. Aucun workflow
n’a été relancé, aucun déploiement n’a été déclenché depuis la branche Arena.

| Preuve | Résultat |
| --- | --- |
| Workflow | **Demo (GitHub Pages)**, run [`41263409932`](https://github.com/azharshahim/mauritius-compta/actions/runs/41263409932) |
| Événement / commit | `push` sur `main`, `headSha 49ee04fee8f5e6151c9e461fb20aa60cafef436d` |
| Conclusion | `success`, tentative 1 |
| Job Build demo bundle | `124721105472` — `success` |
| Job Deploy to GitHub Pages | `124721352003` — `success` |
| Étapes du déploiement | `configure-pages@v5`, `deploy-pages@v4`, **Verify the published HTTPS URL** : toutes `success` |
| Run CI jumeau | `41263409910` — `success` |
| URL publique | <https://azharshahim.github.io/mauritius-compta/> — HTTP 200 |
| Contenu servi | Page de connexion « Mauritius Compta — Comptabilité mauricienne bilingue », identifiants de démonstration pré-remplis, bandeau **MODE DÉMONSTRATION**, avertissement « ne pas utiliser pour des déclarations officielles » |
| Lien profond | `/mauritius-compta/entries` renvoie le HTML de redirection vers la démonstration (`#/entries`) |
| Pages API | `build_type: workflow`, `html_url` attendu, `cname: null` |

Le job **Verify the published HTTPS URL** ne se contente pas de vérifier un code HTTP : il
télécharge l’asset JavaScript publié et y cherche les écrans des missions 23–24
(`Mappings comptables`, `Importer un relevé MCB`, `Scan et import de documents`,
`Proposer les mouvements de stock`, etc.). Sa réussite prouve donc que la version en ligne
est bien celle issue de `49ee04f`, et non un ancien artefact.

### Réserve documentée

`GET /repos/azharshahim/mauritius-compta/deployments` ne liste que trois déploiements du
30 octobre 2026 sur l’ancienne branche `arena/b0b62798`, et aucun pour `49ee04f`. Cette
incohérence de l’API de déploiements est contredite par deux preuves indépendantes :
le job `deploy-pages@v4` a réussi et le contrôle HTTPS post-déploiement a réussi sur le
run `41263409932`. Elle est signalée telle quelle, sans relancer la publication.

---

## 2. Module MRA e-Invoicing livré

### Navigation et route

- Entrée **MRA e-Invoicing — À venir** dans le module **Facturation**, à côté des documents
  classiques.
- Libellé anglais **MRA e-Invoicing — Coming Soon**.
- Route stable conservée : **`/billing/e-invoicing`** (aucune rupture de signet).
- Les permissions existantes ne sont pas modifiées ; aucun nouveau rôle n’est créé.
- La route est servie dans la démonstration GitHub Pages comme dans l’application complète.

### Écran informatif

- En-tête, statut **À venir**, encart **Intégration MRA non activée** et mention
  **« Aucun appel réseau vers la MRA n’est effectué »**.
- Quatre indicateurs : inscription MRA **Aucune**, certification revendiquée **Aucune**,
  appels API MRA **0**, données **Fictives**.
- Périmètre explicite : la facturation classique reste fonctionnelle et inchangée ; l’écran
  **n’est pas un second système de facturation** et ne crée, ne modifie ni n’envoie de
  document.
- Préparation administrative : société, démarches des clients, documents, absence de
  données réelles, questions à vérifier auprès de la MRA.
- Feuille de route en six étapes, toutes **Non commencé**.
- Six fonctionnalités envisagées, toutes **Non disponible** : émission, transmission, suivi
  des statuts, accusés de réception, gestion des erreurs, rapprochement comptable.
- Préparation technique : authentification, JSON, fiscalisation, mode hors ligne,
  numérotation, environnements ; statut **À VÉRIFIER**.
- Sécurité et conservation : secrets côté serveur, stockage inaltérable, piste d’audit,
  rôles, conservation, incidents.
- **Paramètres futurs** : environnement, identifiant EBS MRA, certificat et adresse de
  service, tous désactivés ; boutons **Tester la connexion** et **Enregistrer** désactivés.
  Aucun champ n’est enregistré, aucun secret n’est demandé.
- Glossaire EBS / IFP / IRN et avertissement final : Mauritius Compta n’est ni enregistré, ni
  certifié, ni agréé comme fournisseur de solution MRA ; aucune conformité n’est
  revendiquée.

### Garanties techniques

- L’écran n’importe ni `api`, ni `fetch`, ni `XMLHttpRequest`, ni `axios`, ni `WebSocket`.
- Aucune URL externe dans le composant ; aucun appel réseau au montage, à la navigation ou
  au changement de langue.
- Aucun identifiant, mot de passe, certificat, jeton ou clé MRA dans le code, la
  démonstration ou le bundle.
- Aucun changement de `apps/web/src/pages/billing/Documents.tsx`, du moteur de facturation,
  des migrations, du schéma de démonstration (toujours **17**) ou de l’API.
- Aucune donnée réelle : l’écran n’affiche aucune donnée client et la démonstration reste
  entièrement fictive.

### Internationalisation

- **115 nouvelles clés par langue**, portant le total à **1 720 clés FR et 1 720 clés EN**.
- Glossaire centralisé enrichi de trois termes MRA (EBS, IFP, IRN).
- Le test de qualité i18n vérifie la parité, l’absence de fuite de l’autre langue et la
  résolution de toutes les clés littérales.

### Fichiers principaux

| Fichier | Rôle |
| --- | --- |
| `apps/web/src/pages/billing/MraEInvoicing.tsx` | Écran informatif, sans réseau |
| `apps/web/src/App.tsx` | Route stable `/billing/e-invoicing` |
| `apps/web/src/i18n.tsx` | Libellés FR/EN et nouveaux textes |
| `apps/web/src/glossary.ts` | Termes EBS, IFP, IRN |
| `apps/web/src/styles.css` | Mise en page responsive, états et paramètres inactifs |
| `apps/web/tests/mission25-ui.test.tsx` | Tests ciblés Mission 25 |
| `docs/mra-e-invoicing-roadmap.md` | Feuille de route en six volets |
| `.github/workflows/pages.yml` | Contrôles du bundle et de la page publiée |

---

## 3. Feuille de route MRA

`docs/mra-e-invoicing-roadmap.md` couvre les six volets demandés :

1. inscription de la future société comme éditeur / fournisseur de solution ;
2. démarches des sociétés clientes ;
3. documents administratifs et sociétaires ;
4. spécifications techniques et environnements de test officiels ;
5. sécurité et conservation ;
6. validation et mise en production.

Chaque point est classé **CONFIRMÉ**, **À VÉRIFIER** ou **HYPOTHÈSE**. Les sources
officielles MRA consultées sont citées avec leur version ou date : page e-Invoicing, VAT
(e-Invoicing) Regulations 2023 (GN nº 132, en vigueur le 2 octobre 2023), spécifications
fonctionnelles de juin 2023, guide développeur v1.0, guide technique, modèle de facture,
FAQ et liste des fournisseurs au 16 septembre 2026.

Points importants consignés :

- la MRA indique n’être **pas un organisme de certification** des EBS ; les fournisseurs
  s’auto-certifient ;
- Mauritius Compta **ne figure pas** sur la liste indicative des fournisseurs consultée ;
- l’IRN, le QR code, l’UUID, la mention de l’IRN sur la facture et les API de statut
  présentent des ambiguïtés ou des zones non documentées, marquées **À VÉRIFIER** ;
- la structure **50/50** et la propriété intellectuelle relèvent d’une **étape juridique
  distincte**, avant toute démarche réelle ;
- aucun développement d’API n’est autorisé sur la base des seules hypothèses.

---

## 4. Tests et intégration continue

### Exécutés localement

| Commande | Résultat |
| --- | --- |
| `npm run typecheck` | API et web : **succès** |
| `npm run test -w @mc/web` | **35 fichiers, 250 tests, 250 réussis** |
| `npm run build` | Web et API : **succès** |
| `npm run build:demo` | **succès** ; base `/mauritius-compta/`, 125 modules |
| Greps du bundle démo | titre FR/EN, mention d’intégration non activée, absence de réseau : **OK** |
| Scan de secrets du bundle | **aucun secret détecté** |

Les quatre nouveaux tests couvrent : navigation et statut FR, six fonctions indisponibles,
paramètres désactivés, bascule EN, route stable après rechargement simulé, retour vers la
facturation classique et absence d’appel réseau / d’URL externe dans le composant.

### GitHub Actions sur la PR nº8

| Contrôle | Résultat |
| --- | --- |
| Typecheck, tests and build | **succès** (3 min 33 s) |
| API tests against real PostgreSQL | **succès** (1 min 49 s) |
| Migrations against real PostgreSQL | **succès** (37 s) |
| Build demo bundle | **succès** (1 min 24 s) |
| Deploy to GitHub Pages | **skipping** — attendu, une branche Arena ne publie jamais |

Runs : [`41264512231`](https://github.com/azharshahim/mauritius-compta/actions/runs/41264512231)
(CI) et [`41264512227`](https://github.com/azharshahim/mauritius-compta/actions/runs/41264512227)
(Demo), sur le commit `8054e94`.

---

## 5. État de `main` et suite après fusion

- `main` local et `origin/main` restent à **`49ee04f`** (« Merge pull request #7 »).
- La PR nº8 est **en brouillon**, **non fusionnée**.
- Aucun push sur `main`, aucune modification directe, aucun contournement de protection.
- Aucun déploiement Pages n’a été déclenché par cette branche.

Après une **future fusion autorisée**, le push sur `main` déclenchera le workflow Pages :

1. typecheck et tests web ;
2. build de démonstration avec `base=/mauritius-compta/` et commit injecté ;
3. contrôles du bundle, dont les nouveaux libellés MRA ;
4. upload et déploiement GitHub Pages ;
5. vérification HTTPS de la page publique, dont les libellés MRA.

La page publique affichera alors l’écran **MRA e-Invoicing — À venir / Coming Soon** avec
des données fictives, sans aucune connexion MRA, sans modifier la facturation classique.
La publication restera conditionnée à une fusion autorisée ; rien n’est promis avant.

---

## 6. Limites et points non vérifiés

- **Aucun navigateur réel** dans le sandbox : pas de test Chrome Windows, ni Samsung
  Android physique, ni Playwright. La vérification repose sur jsdom, le build et les greps.
- Aucun test sur un appareil mobile réel ; la mise en page est responsive par construction
  et par les styles existants.
- Aucune API MRA, aucun portail, aucun compte, aucun certificat, aucun test officiel.
- Aucune validation par la MRA, aucun statut d’éditeur ou de conformité.
- Aucune donnée réelle, aucun document sociétaire, aucun secret.
- L’audit des licences et la revue experte restent hors périmètre de cette mission.

**Conclusion :** l’écran informatif et sa feuille de route sont livrés et testés. Le module
MRA reste **désactivé**, aucune démarche officielle n’est engagée, `main` est intact et
aucune fusion ne sera faite sans autorisation explicite.
