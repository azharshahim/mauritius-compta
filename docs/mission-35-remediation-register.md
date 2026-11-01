# COMPTAI — registre de remédiation M35 (P0-03)

**Mission 35 — audit interne de sécurité et isolation multi-sociétés**
**Date :** 1er novembre 2026
**Base :** `main` = `1590f99` — version 0.1.1
**Statut global :** corrections internes appliquées ; **P0-03 reste ouvert** jusqu'à audit
indépendant et test d'intrusion.

## 1. Synthèse

| Sévérité initiale | Nombre | Corrigés | Restant ouverts |
|---|---:|---:|---:|
| Critique | 1 | 1 | 0 |
| Élevée | 1 | 1 | 0 |
| Moyenne | 4 | 4 | 0 |
| Faible | 2 | 2 | 0 |
| **Total** | **8** | **8** | **0** |

Les risques résiduels ne sont pas des vulnérabilités non corrigées de cette liste : ce sont des
limites de périmètre, des exigences d'exploitation ou des points relevant d'un audit
indépendant (section 4).

## 2. Registre détaillé

### M35-SEC-01 — élévation de privilège vers `owner`

| Champ | Valeur |
|---|---|
| Sévérité | **Critique** |
| Statut | **Corrigé** |
| Fichier | `apps/api/src/modules/cabinet/routes.ts` |
| Route | `PATCH /api/cabinet/companies/:companyId/members/:userId` |
| Constat | Le rôle `owner` pouvait être attribué par un `admin`/`cabinet_admin`, malgré l'interdiction sur `POST /members`. |
| Impact | Prise de contrôle du dossier, réouverture d'une période clôturée (route `owner`), éviction du propriétaire. |
| Correction | Refus de toute promotion vers `owner` ; rétrogradation d'un `owner` toujours refusée ; écritures transactionnelles et auditées. |
| Test | Promotion `400`, rôle inchangé en base, réouverture `403`, deux tentatives simultanées refusées, un seul `owner`. |
| Résiduel | Transfert de propriété non implémenté, suivi P2-06. |

### M35-SEC-02 — drapeau global `is_active`

| Champ | Valeur |
|---|---|
| Sévérité | **Élevée** |
| Statut | **Corrigé** |
| Fichier | `apps/api/src/modules/cabinet/routes.ts` |
| Route | `PATCH /api/cabinet/companies/:companyId/members/:userId` |
| Constat | `isActive` modifiait `app_users` globalement, y compris pour le propriétaire ou un compte partagé. |
| Impact | Verrouillage d'un compte utilisé par un autre dossier, prise de contrôle, résurrection de sessions après réactivation. |
| Correction | Réservé au rôle `owner` ; auto-désactivation et désactivation d'un `owner` refusées ; compte partagé refusé (`409`) ; suppression de toutes les sessions à la désactivation ; transaction. |
| Test | `403` admin, `400` auto/owner, `409` compte partagé, `200` compte isolé, ancien cookie `401` après réactivation. |
| Résiduel | Pas d'écran de gestion globale des comptes ; la désactivation reste une opération d'administration exceptionnelle. |

### M35-SEC-03 — gestionnaire de dossier arbitraire

| Champ | Valeur |
|---|---|
| Sévérité | Moyenne |
| Statut | **Corrigé** |
| Fichiers | `apps/api/src/modules/cabinet/routes.ts`, `apps/api/src/modules/companies/routes.ts` |
| Routes | `PATCH /api/cabinet/companies/:companyId`, `PATCH /api/companies/:companyId`, `POST /api/companies` |
| Constat | Un UUID d'utilisateur quelconque pouvait être enregistré comme gestionnaire ; la fiche cabinet retournait son nom et son courriel. |
| Impact | Divulgation limitée d'identité inter-dossiers si l'UUID était connu ; donnée de gestion incohérente. |
| Correction | Le gestionnaire doit être membre du dossier (ou le créateur à la création) ; la jointure de la fiche est restreinte aux membres. |
| Test | Les trois routes refusent un extérieur (`400`) ; un membre est accepté ; une ligne historique invalide n'affiche plus l'utilisateur. |
| Résiduel | Nettoyage des lignes historiques à planifier. |

### M35-SEC-04 — autorisation après configuration (sauvegardes)

| Champ | Valeur |
|---|---|
| Sévérité | Moyenne |
| Statut | **Corrigé** |
| Fichier | `apps/api/src/backup/service.ts` |
| Routes | `/api/admin/backups*` |
| Constat | `requireBackupAdmin` répondait `503` avant de vérifier l'allowlist. |
| Impact | Divulgation de l'état de configuration ; surface administrative exposée à tout utilisateur connecté. |
| Correction | Allowlist vérifiée en premier (`403`), puis disponibilité (`503`). L'état reste consultable sans opération. |
| Test | Utilisateur ordinaire `403`, `authorized: false`, aucune route de restauration. |
| Résiduel | Preuve d'exploitation et copie hors site : P1-16. |

### M35-SEC-05 — identifiants malformés en `500`

| Champ | Valeur |
|---|---|
| Sévérité | Moyenne |
| Statut | **Corrigé** |
| Fichier | `apps/api/src/lib/errors.ts` |
| Routes | Toutes les routes recevant un UUID non validé en amont |
| Constat | PostgreSQL `22P02` remontait en `500 INTERNAL_ERROR`. |
| Impact | Validation d'entrée incomplète, distinction erreur interne/refus, bruit de journal. |
| Correction | `22P02` → `400 VALIDATION_ERROR` générique. |
| Test | Huit routes, dont entrées, documents, pièces jointes, banque, facturation, paie, provisions, échéanciers. |
| Résiduel | Certaines routes valident encore l'UUID par SQL plutôt que par Zod ; la réponse est désormais contrôlée. |

### M35-SEC-06 — codes de refus paie

| Champ | Valeur |
|---|---|
| Sévérité | Faible |
| Statut | **Corrigé** |
| Fichiers | `apps/api/src/modules/payroll/routes.ts`, `service.ts`, `accounting.ts` |
| Constat | Refus de rôle en `400` ou `409` au lieu de `403`. |
| Impact | Sémantique incorrecte, pas de contournement constaté. |
| Correction | `forbidden(..., 'MODULE_FORBIDDEN')`. |
| Test | Gestionnaire paie : lecture/écriture paie autorisées, administration et comptabilité refusées. |
| Résiduel | Aucun. |

### M35-SEC-07 — mot de passe temporaire d'un invité

| Champ | Valeur |
|---|---|
| Sévérité | Faible |
| Statut | **Corrigé** |
| Fichier | `apps/api/src/modules/companies/routes.ts` |
| Route | `POST /api/companies/:companyId/members` |
| Constat | Minimum 10 caractères sans exigence de lettres et chiffres. |
| Impact | Mot de passe initial plus faible que la politique d'inscription. |
| Correction | Même politique que l'inscription. |
| Test | Deux mots de passe faibles refusés, un conforme accepté. |
| Résiduel | Pas de vérification contre les mots de passe compromis. |

### M35-SEC-08 — cookie `Secure` en production

| Champ | Valeur |
|---|---|
| Sévérité | Moyenne |
| Statut | **Corrigé** |
| Fichier | `apps/api/src/config.ts` |
| Constat | `COOKIE_SECURE` par défaut `false`, même en production. |
| Impact | Cookie de session susceptible de transiter en clair si HTTPS n'est pas forcé. |
| Correction | Valeur par défaut `true` en production ; surcharge explicite toujours possible. |
| Test | Configuration production, surcharge explicite, développement. |
| Résiduel | HTTPS/HSTS restent à vérifier dans Nginx. |

## 3. Tests de non-régression

| Élément | Résultat |
|---|---|
| `apps/api/tests/mission35-security.test.ts` | 14/14 |
| API complète | 521 réussis, 11 ignorés |
| Web | 290/290 |
| Typecheck API + web | 0 erreur |
| Build | OK |
| PostgreSQL réel | Job CI dédié |
| CI | Jobs qualité, PostgreSQL réel et migrations, voir la PR |

## 4. Risques résiduels et actions hors M35

| # | Risque | Niveau | Action | Propriétaire proposé |
|---|---|---|---|---|
| R-01 | Pas de revue indépendante ni de pentest | **P0-03** | Mandater un tiers sur cette matrice et l'arbre fusionné | Direction / sécurité |
| R-02 | `trustProxy: true` et `X-Forwarded-For` | Moyen si port exposé | Écoute loopback, Nginx réécrit l'en-tête, pare-feu ; envisager une confiance proxy configurable | Exploitation |
| R-03 | Validation Zod avant garde sur quelques écritures paie | Faible | Réordonner la garde avant le schéma | Développement |
| R-04 | Unicité globale du BRN | Faible | Décider de la règle multi-cabinet et documenter | Produit |
| R-05 | Verrouillage de compte par bruteforce ciblé | Faible | Procédure de déblocage, surveillance, MFA | Exploitation / P1-07 |
| R-06 | MFA, réinitialisation, SSO absents | Élevé pour admins | P1-07 | Produit / sécurité |
| R-07 | Audit non chaîné/WORM | Moyen | P1-14 | Sécurité |
| R-08 | HSTS au niveau application absent | Faible | Vérifier Nginx | Exploitation |
| R-09 | Pas d'antivirus sur les fichiers | Faible | Analyse externe si fichiers clients | Sécurité |
| R-10 | Pas de preuve de sauvegarde exploitée | Élevé | P1-16 | Exploitation |
| R-11 | Pas de test sur l'infrastructure OVH | Élevé | Recette infra et exercice de reprise | Exploitation |

## 5. Décision

- Les huit vulnérabilités constatées sont corrigées et couvertes par des tests.
- **P0-03 n'est pas clos** : une revue indépendante, un test d'intrusion et une revue de la
  journalisation restent obligatoires.
- **Aucune mise en production** n'est recommandée avant la clôture de P0-03, P0-04, P0-05 et
  P1-16, ou une acceptation de risque écrite et datée.
