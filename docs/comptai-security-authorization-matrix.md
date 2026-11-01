# COMPTAI — matrice d'autorisation et d'isolation

**Mission 35 — P0-03 — audit interne**
**Date :** 1er novembre 2026
**Base :** `main` = `1590f99` — version 0.1.1
**Nature :** matrice de régression interne, **pas** un rapport de pentest.

> Cette matrice est un point de départ traçable. Elle ne prétend pas couvrir les 443 handlers
> dans toutes leurs branches. Les lignes marquées « testé » ont été exécutées par
> `apps/api/tests/mission35-security.test.ts` ou par la suite existante citée.

## 1. Légende

| Valeur | Signification |
|---|---|
| `A`, `B`, `C` | sociétés fictives distinctes ; utilisateurs et données distincts |
| `404` | non-membre : `COMPANY_NOT_FOUND`, jamais de divulgation d'existence |
| `403` | membre sans rôle/module suffisant : `FORBIDDEN` ou `MODULE_FORBIDDEN` |
| `401` | session absente, expirée ou révoquée |
| `400` | entrée invalide ou règle métier de validation |
| `409` | conflit d'état (dossier archivé, doublon, compte partagé) |
| `200/201/204` | opération autorisée |
| `n/a` | route non applicable à ce rôle |

Rôles : `owner` (O), `admin` (A), `cabinet_admin` (CA), `manager` (M), `accountant` (Ac),
`billing_clerk` (Bc), `payroll_manager` (Pm), `viewer` (V).

## 2. Authentification et session

| Route | Méthode | Rôle | Société | Attendu | Observé / test |
|---|---|---|---|---|---|
| `/api/health` | GET | aucune session | n/a | `200` | conforme |
| `/api/auth/register` | POST | aucune session | n/a | `201` si inscription ouverte, sinon `403` | suite `auth.test.ts` |
| `/api/auth/login` | POST | aucune session | n/a | `200` si valide, `401` sinon, `429` après seuil | M35 : `429` après 5 échecs |
| `/api/auth/me` | GET | session | n/a | `200` | M35 : `401` sans session, après déconnexion, après expiration |
| `/api/auth/logout` | POST | session ou cookie | n/a | `200` + révocation du jeton | M35 : ancien cookie `401` |
| `/api/companies` | GET | tout rôle | toutes | seulement les sociétés de l'utilisateur | M35 : A ne voit pas B/C |
| `/api/companies` | POST | tout utilisateur authentifié | crée A | `201`, créateur `owner` | suite `companies.test.ts` |
| `/api/cabinet/dashboard` | GET | tout rôle avec `cabinet: read` | A uniquement | agrégats filtrés | M35 : 1 client, pas B/C |
| `/api/cabinet/companies` | GET | tout rôle avec `cabinet: read` | A uniquement | A seulement | M35 : conforme |
| `/api/cabinet/team` | GET | tout rôle avec `cabinet: read` | A uniquement | affectations A seulement | M35 : pas B/C |
| `/api/cabinet/companies/:companyId` | GET | membre + `cabinet: read` | B depuis A | `404` | M35 : conforme |
| `/api/cabinet/companies/:companyId` | PATCH | membre + `cabinet: admin` | B depuis A | `404` | M35 : conforme |
| `/api/cabinet/companies/:companyId/archive` | POST | membre + `cabinet: admin` | B depuis A | `404` | M35 : conforme |
| `/api/cabinet/companies/:companyId/members/:userId` | PATCH | membre + `cabinet: admin` | B depuis A | `404` | M35 : conforme |

## 3. Gestion des membres, rôles et statut

| Opération | Route | Méthode | Acteur | Cible | Attendu | Observé / test |
|---|---|---|---|---|---|---|
| Lister les membres | `/api/companies/:companyId/members` | GET | owner/admin A | A | `200` | suites existantes |
| Lister les membres | idem | GET | payroll_manager A | A | `403` | M35 : conforme |
| Ajouter un membre existant | `/api/companies/:companyId/members` | POST | owner/admin A | A | `201` | M35 : conforme |
| Ajouter avec mot de passe faible | idem | POST | owner A | A | `400` | M35 : conforme |
| Changer un rôle ordinaire | `/api/cabinet/companies/:companyId/members/:userId` | PATCH | owner/admin A | membre A | `200` | suites existantes |
| **Promouvoir `owner`** | idem | PATCH | admin A | admin A ou autre | **`400`** | M35 : rôle inchangé |
| **Rétrograder `owner`** | idem | PATCH | owner A | owner A | **`400`** | M35 : conforme |
| **Désactiver un compte** | idem | PATCH | admin A | membre A | **`403`** | M35 : conforme |
| **Désactiver son propre compte** | idem | PATCH | owner A | owner A | **`400`** | M35 : conforme |
| **Désactiver un autre owner** | idem | PATCH | owner A | owner A' | **`400`** | M35 : conforme |
| **Désactiver un compte partagé** | idem | PATCH | owner A | membre A+C | **`409`** | M35 : C reste actif |
| Désactiver un compte isolé | idem | PATCH | owner A | membre A | `200`, sessions supprimées | M35 : ancien cookie `401` |
| Réactiver un compte isolé | idem | PATCH | owner A | membre A | `200`, aucune session ressuscitée | M35 : reconnexion requise |
| Retirer un membre | `/api/companies/:companyId/members/:userId` | DELETE | owner/admin A | membre A | `200/204` | suites existantes ; dernier owner protégé |
| Gérer un dossier d'une autre société | routes cabinet B | toutes | admin A | B | `404` | M35 : conforme |

## 4. Modules métier — frontière de société

Toutes les lignes suivantes sont exécutées avec un utilisateur **propriétaire de A** et la
société **B**. Le résultat observé est systématiquement `404 COMPANY_NOT_FOUND`.

| # | Module | Route | Méthode | Rôle | Société | Attendu | Observé |
|---|---|---|---|---|---|---|---|
| 1 | Plan comptable | `/api/companies/:companyId/accounts` | GET | owner A | B | `404` | conforme |
| 2 | Journaux | `/api/companies/:companyId/journals` | GET | owner A | B | `404` | conforme |
| 3 | Écritures / grand livre | `/api/companies/:companyId/entries` | GET | owner A | B | `404` | conforme |
| 4 | Écritures / grand livre | `/api/companies/:companyId/reports/trial-balance` | GET | owner A | B | `404` | conforme |
| 5 | Facturation | `/api/companies/:companyId/billing/documents` | GET | owner A | B | `404` | conforme |
| 6 | Fournisseurs / achats | `/api/companies/:companyId/purchases/documents` | GET | owner A | B | `404` | conforme |
| 7 | Banque / rapprochement | `/api/companies/:companyId/bank/accounts` | GET | owner A | B | `404` | conforme |
| 8 | Immobilisations | `/api/companies/:companyId/fixed-assets` | GET | owner A | B | `404` | conforme |
| 9 | Stocks | `/api/companies/:companyId/inventory/items` | GET | owner A | B | `404` | conforme |
| 10 | Paie / salaires | `/api/companies/:companyId/payroll/employees` | GET | owner A | B | `404` | conforme |
| 11 | Rapports financiers | `/api/companies/:companyId/dashboard` | GET | owner A | B | `404` | conforme |
| 12 | Documents | `/api/companies/:companyId/documents` | GET | owner A | B | `404` | conforme |
| 13 | Paramètres | `/api/companies/:companyId/settings` | GET | owner A | B | `404` | conforme |
| 14 | Utilisateurs | `/api/companies/:companyId/members` | GET | owner A | B | `404` | conforme |
| 15 | Sauvegardes / exports | `/api/companies/:companyId/exports` | GET | owner A | B | `404` | conforme |
| 16 | Tâches cabinet | `/api/companies/:companyId/tasks` | GET | owner A | B | `404` | conforme |
| 17 | Échéanciers | `/api/companies/:companyId/accruals` | GET | owner A | B | `404` | conforme |
| 18 | Provisions | `/api/companies/:companyId/provisions` | GET | owner A | B | `404` | conforme |
| 19 | Devises | `/api/companies/:companyId/fx/rates` | GET | owner A | B | `404` | conforme |
| 20 | Lettrage | `/api/companies/:companyId/lettering` | GET | owner A | B | `404` | conforme |
| 21 | Capitaux propres | `/api/companies/:companyId/equity/overview` | GET | owner A | B | `404` | conforme |
| 22 | Exercices | `/api/companies/:companyId/financial-years/timeline` | GET | owner A | B | `404` | conforme |
| 23 | Migration | `/api/companies/:companyId/migration/jobs` | GET | owner A | B | `404` | conforme |

### 4.1 Écritures interdites vers une autre société

| Route | Méthode | Acteur | Société cible | Attendu | Observé |
|---|---|---|---|---|---|
| `/api/companies/:companyId/entries` | POST | owner A | B | `404` | conforme |
| `/api/companies/:companyId/billing/customers` | POST | owner A | B | `404` | conforme |
| `/api/companies/:companyId/payroll/employees` | POST | owner A | B | `404` | conforme (payload valide) |
| `/api/companies/:companyId/fixed-assets/:assetId` | PATCH | owner A | B | `404` | conforme |
| `/api/companies/:companyId/entries/:entryId` | DELETE | owner A | B | `404` | conforme |

## 5. IDOR / BOLA — identifiants d'objets

L'acteur est propriétaire de A ; l'objet appartient à B ; le chemin utilise la société A (ou B).

| Objet | Route utilisée | Méthode | Attendu | Observé |
|---|---|---|---|---|
| Écriture B | `/api/companies/A/entries/:entryId` | GET | `404` | conforme, pas de description B |
| Écriture B | `/api/companies/A/entries/:entryId` | PATCH | `404` | conforme |
| Écriture B | `/api/companies/A/entries/:entryId` | DELETE | `404` | conforme |
| Client B | `/api/companies/A/billing/customers/:customerId` | GET | `404` | conforme |
| Salarié B | `/api/companies/A/payroll/employees/:employeeId` | GET | `404` | conforme |
| Salarié B | `/api/companies/A/payroll/employees/:employeeId` | DELETE | `404` | conforme |
| Immobilisation B | `/api/companies/A/fixed-assets/:assetId` | GET | `404` | conforme |
| Pièce jointe B | `/api/companies/A/attachments/:attachmentId` | GET | `404` | conforme |
| Pièce jointe B | `/api/companies/B/attachments/:attachmentId` | GET | `404` | conforme (non-membre) |
| Dossier B | `/api/cabinet/companies/B` | GET/PATCH | `404` | conforme |
| Export B | `/api/companies/B/exports/:exportId/download` | GET | `404` | conforme |
| Sauvegarde globale | `/api/admin/backups/:id/download` | GET | `403` | conforme (non-admin) |
| Restauration | `/api/admin/backups/:id/restore` | POST | `404` | conforme (route absente) |

## 6. Trois sociétés et compte partagé

| Acteur | Société A | Société B | Société C | Attendu | Observé |
|---|---|---|---|---|---|
| owner A | `200` | `404` | `404` | isolation | conforme |
| owner B | `404` | `200` | `404` | isolation | conforme |
| owner C | `404` | `404` | `200` | isolation | conforme |
| comptable partagé A+C | `200` | `404` | `200` | partage explicite uniquement | conforme |

## 7. Paie — séparation des pouvoirs

| Route | Méthode | payroll_manager A | admin/owner A | Attendu |
|---|---|---|---|---|
| `/payroll/employees` | GET | `200` | `200` | lecture paie autorisée |
| `/payroll/payslips` | GET | `200` | `200` | lecture paie autorisée |
| `/payroll/declarations` | GET | `200` | `200` | lecture paie autorisée |
| `/companies/:id/members` | GET | `403` | `200` | pas d'administration |
| `/companies/:id/exports` | POST | `403` | `201` si configuré | export complet réservé admin paie |
| `/cabinet/companies/:id/members/:userId` | PATCH | `403` | `200` | pas de gestion des rôles |
| `/entries` | POST | `403` | `201` | pas d'écriture comptable |

## 8. Sauvegardes et exports (M34)

| Contrôle | Attendu | Observé |
|---|---|---|
| Créer une sauvegarde globale sans allowlist | `403 BACKUP_FORBIDDEN` | M35 : conforme, même non configuré |
| Voir l'état | `200`, `authorized: false` | conforme |
| Créer un export de sa société | admin + paie admin, `201` si clé configurée | suite M34 |
| Vérifier/télécharger un export | admin + paie admin | suite M34 |
| Export d'une autre société | `404` | M35 : conforme |
| Export via route de sauvegarde globale | `404` | suite M34 |
| Restauration HTTP | aucune route | M35 : `404` |
| Archive publique | jamais servie statiquement | suite M34 |
| Secret/clé dans logs ou audit | absent | suite M34 + revue |

## 9. Sécurité API

| Cas | Requête | Attendu | Observé |
|---|---|---|---|
| Sans session | `GET /api/companies/A/accounts` | `401` | conforme |
| Session déconnectée | `GET /api/auth/me` avec ancien cookie | `401` | conforme |
| Session expirée | même requête après `expires_at` passé | `401` | conforme |
| Origine croisée | `POST` avec `Origin: https://evil.example` | `403` | conforme |
| `Sec-Fetch-Site` croisé | `POST` avec `cross-site` | `403` | conforme |
| UUID malformé | `GET /api/companies/A/entries/not-a-uuid` | `400 VALIDATION_ERROR` | conforme |
| UUID malformé (8 routes) | documents, pièces jointes, banque, facturation, paie, provisions, échéanciers | `400` | conforme |
| Erreur interne | réponse d'erreur | pas de pile, pas de SQL | conforme |
| En-têtes | `/api/health` | `DENY`, `nosniff`, CSP | conforme |
| Bruteforce | 6 tentatives de connexion | `429` après seuil | conforme |
| Cookie production | `COOKIE_SECURE` non défini | `true` | conforme |

## 10. Correspondance avec les tests

| Fichier | Cas couverts |
|---|---|
| `apps/api/tests/mission35-security.test.ts` | 14 tests M35 (sections 3 à 9) |
| `apps/api/tests/cabinet.test.ts` | rôles cabinet, dérogations, non-membre |
| `apps/api/tests/companies.test.ts` | création, membres, archivage |
| `apps/api/tests/bank.test.ts` | isolation banque et rapprochement |
| `apps/api/tests/payroll.test.ts` | isolation paie, rôles, bulletins |
| `apps/api/tests/payroll-accounting.test.ts` | séparation paie/comptabilité |
| `apps/api/tests/payroll-declarations.test.ts` | déclarations internes par société |
| `apps/api/tests/mission22.test.ts` | isolation stocks |
| `apps/api/tests/fixed-assets.test.ts` | isolation immobilisations |
| `apps/api/tests/regressions.test.ts` | signatures de pièces jointes, triggers, sessions |
| `apps/api/tests/mission34-backup.test.ts` | sauvegarde, export, absence de restauration HTTP |
| `apps/api/tests/mission23.test.ts` | documents, propositions, règles par société |

## 11. Ce que cette matrice ne prouve pas

- Elle ne couvre pas chaque branche de chaque service ni chaque combinaison de dérogations.
- Elle n'a pas été validée par un auditeur indépendant.
- Elle ne remplace pas un test d'intrusion, une revue de configuration de production ou une
  revue de la journalisation.
- Elle ne couvre pas les dénis de service, les vulnérabilités de dépendances, la sécurité du
  navigateur, l'infrastructure OVH, PostgreSQL réel en dehors de la CI, ni les secrets de
  déploiement.
