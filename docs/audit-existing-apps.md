# Audit des logiciels existants du propriétaire

> Mission V0.1.0 — 30 octobre 2026.
> Objectif : identifier les composants réutilisables **sans jamais** copier de règles fiscales
> françaises, de données confidentielles, de secrets ou du code dont les droits ne sont pas
> établis.

## 1. Méthode

1. Inventaire des dépôts accessibles via l'API GitHub (`azharshahim/*`).
2. Lecture des fichiers publics (README, `package.json`, arborescence) **sans clonage des
   données métier**.
3. Vérification de la stack technique, de la licence et de la présence éventuelle de secrets.
4. Décision : réutiliser / s'inspirer / ne pas utiliser.

## 2. Résultats de l'inventaire

| Application citée | Accès | Constat |
|---|---|---|
| `azharshahim/progest` (paie FR) | **Non accessible** — dépôt privé (HTTP 404 pour le compte connecté) | Aucun code, aucune règle, aucune donnée consultée. |
| Logiciel de comptabilité (`compta.shahim.fr`) | **Dépôt non accessible** | Application privée hébergée ; pas de dépôt public correspondant. |
| Logiciel de facturation (`facture.shahim.fr`) | **Dépôt non accessible** | Application privée hébergée ; pas de dépôt public correspondant. |
| `azharshahim/Scanpro-ai` (OCR) | Public, consulté | Application **JavaScript statique** (scan de documents, 100 % local, tests Playwright). Aucune brique comptable, aucun backend, aucune authentification. |
| `azharshahim/mauritius-compta` | Public, vide au départ (README) | Base du projet actuel. |

> **Conclusion de l'audit** : aucun composant des applications françaises n'étant accessible,
> **rien n'a été copié**. L'architecture a été conçue de façon autonome
> (voir `docs/architecture.md`), conformément à la consigne « ne pas bloquer la mission ».

## 3. Composants recherchés et décision

| Composant recherché | Disponible dans les dépôts accessibles ? | Décision V0.1.0 |
|---|---|---|
| Authentification | Non (ScanPro AI est 100 % local, sans compte) | Développé : sessions cookie HttpOnly + scrypt + contrôle de rôle par société |
| Gestion des entreprises | Non | Développé : module `companies` multi-société |
| Interface utilisateur | Non (ScanPro AI = JS vanilla, UI de scan) | Développé : React 19 + Vite, bilingue, responsive |
| Base PostgreSQL | Non | Développé : schéma PostgreSQL + migrations versionnées |
| Gestion des comptes | Non | Développé : plan de comptes configurable + plan de démonstration |
| Journaux comptables | Non | Développé : 5 journaux standard + écritures contrôlées |
| Grand livre | Non | Développé : solde initial, mouvements, solde progressif |
| Balance | Non | Développé : colonnes initial/mouvements/final + contrôle d'équilibre |
| Export PDF | Non réutilisable (`pdf-lib` côté navigateur pour ScanPro) | Développé : génération serveur PDFKit, documents marqués « démonstration » |
| Export Excel | Non | **CSV (UTF-8 BOM, séparateur `;`)** compatible Excel ; XLSX natif prévu en mission 2 |
| Historique des modifications | Non | Développé : table `audit_log` + page Paramètres |
| OCR / extraction de documents | Oui (`Scanpro-ai`, public) | **Non intégré** en V0.1.0 ; étude d'intégration en mission 2 (voir §5) |

## 4. Points d'attention juridiques

- Aucun code source des applications françaises n'a été lu : **aucun risque de contamination**
  par des règles fiscales françaises ou du code non libre.
- Aucune donnée client, aucun identifiant, aucun secret n'a été copié.
- Les noms « Lagon Bleu Trading Ltd (DEMO) », BRN/VAT `DEMO-*` et les adresses sont inventés.
- Le présent logiciel est **juridiquement indépendant** des applications françaises :
  base de données, schéma, code, configuration et documentation propres.

## 5. Opportunités de réutilisation future (à instruire, droits à confirmer)

| Sujet | Source potentielle | Conditions préalables |
|---|---|---|
| OCR de factures/reçus → brouillon d'écriture | ScanPro AI (public) ou service interne | Vérifier la licence du dépôt, obtenir l'accord écrit du propriétaire, isoler le module, valider la qualité d'extraction (montants, dates, devise), tracer la provenance |
| Modèle de données de paie | progest (privé) | **Interdit sans accès explicite** ; et de toute façon les règles FR ne sont pas transposables |
| Design system | Applications françaises | Autorisation du propriétaire + revue d'originalité |
| Hébergement / sauvegardes | Infrastructure existante | Accord d'accès, cloisonnement réseau, conformité DPA |

## 6. Recommandation

Poursuivre avec l'architecture autonome actuelle. Si le propriétaire souhaite réutiliser des
composants, fournir un accès (dépôt, licence, documentation) afin de réaliser un audit de
réutilisation formel avant toute intégration.
