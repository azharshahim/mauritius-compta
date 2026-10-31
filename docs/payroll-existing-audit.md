# Audit du module Paie & RH existant — mission 14

**Date :** 31 octobre 2026  
**Branche :** `arena/b0b62798-mauritius-compta`  
**Périmètre :** dépôt `azharshahim/mauritius-compta` uniquement. Aucun autre dépôt n’a été consulté ou copié.

## 1. Conclusion

La rubrique « Paie & RH » existait comme **coquille préparée**, pas comme module. Elle
possédait une table de salariés minimale, quatre routes et deux écrans « préparés ».
La mission 14 l’a **étendue sur place** : aucune seconde table de salariés, aucun second
moteur, aucun second menu. Les routes et URLs existantes (`/payroll`,
`/companies/:id/payroll/employees`, `/payroll/summary`) restent valides.

Aucune règle de paie française (Progest, Sage Paie ou autre) n’a été lue, copiée ou
transposée. Aucun taux mauricien n’a été inventé.

## 2. Ce qui existait avant la mission

| Élément | Fichier | État initial | Décision mission 14 |
|---|---|---|---|
| Table salariés | `apps/api/sql/migrations/0004_cabinet.sql` §6 `payroll_employees` | `employee_ref`, `full_name`, `job_title`, `start_date`, `end_date`, `status active/ended` | **Étendue** par `ALTER TABLE … ADD COLUMN IF NOT EXISTS` dans `0014` ; colonnes et données conservées |
| Routes | `apps/api/src/modules/payroll/routes.ts` | `GET /payroll/employees` avec `available:false`, `GET /payroll/summary`, `POST /payroll/employees`, `POST /payroll/runs` → `notImplemented` | **Étendues** ; `summary` devient le tableau de bord réel, `runs` remplacé par les routes de période/calcul explicites |
| Écrans | `apps/web/src/pages/prepared/Prepared.tsx` via `/payroll` et `/payroll/:section` | Page « préparée mais pas encore opérationnelle » | **Remplacée** par `pages/payroll/Payroll.tsx`, sans changer les URLs |
| Navigation | `apps/web/src/modules.ts` | 8 entrées, toutes `prepared: true` | 12 entrées opérationnelles ; déclarations et transfert restent marqués préparés |
| Permissions | `apps/api/src/lib/permissions.ts`, `types.ts` | `payroll_manager` = paie `write`, tous les autres rôles `none` | **Conservées**, puis vérifiées route par route ; lecture ajoutée aux rôles d’administration |
| Démo | `apps/web/src/demo/runtime.ts` | `/payroll/summary` minimal, aucun salarié | **Étendue** par `demo/payroll.ts`, 12 dossiers A→L fictifs |
| Assistant | `apps/api/src/modules/ai/tools.ts` | `payroll.status` disait « non implémenté » | **Étendu** en lecture seule : agrégats, règles manquantes, explication d’un calcul existant |

## 3. Ce qui n’existait pas

- contrats et historique salarial ;
- rubriques de paie et assignations ;
- temps, absences, calendriers, jours fériés ;
- règles de congé et soldes ;
- variables mensuelles et import ;
- registre de règles datées avec revue experte ;
- périodes de paie et machine à états ;
- calcul déterministe et lignes de calcul ;
- bulletins, même de simulation ;
- pont comptable ;
- audit spécifique paie ;
- aucune protection des coordonnées bancaires (la table n’en contenait pas).

## 4. Risques identifiés et traitement

1. **Duplication de module** : éviter une table `employees_v2`. Traitement : extension additive de
   `payroll_employees`, tables satellites préfixées `payroll_`.
2. **Écrasement d’un salaire** : éviter un `UPDATE` destructif. Traitement : contrats datés,
   statut `superseded`, `payroll_contract_events`, motif obligatoire.
3. **Faux net légal** : éviter de remplir PAYE/CSG/NSF à zéro. Traitement : colonnes `NULL`,
   statut `blocked`, code `PAYROLL_STATUTORY_ENGINE_NOT_IMPLEMENTED`.
4. **Faux bulletin officiel** : éviter de réutiliser le mot « bulletin final ». Traitement :
   `status = simulation`, filigrane PDF, `net_payable = null`.
5. **Fuite bancaire** : éviter de stocker un numéro complet. Traitement : `last4` + empreinte
   SHA-256, affichage masqué, aucun numéro dans les journaux ni les PDF.
6. **Données personnelles réelles** : jeu de démonstration entièrement fictif, aucun document
   réel dans les tests.

## 5. Réutilisation vérifiée

- `lib/money.ts` : montants `numeric(20,4)` et arithmétique BigInt, aucun flottant JS.
- `lib/errors.ts` : modèle d’erreur stable, codes `PAYROLL_*` ajoutés.
- `lib/audit.ts` : journal d’audit transversal, complété par `payroll_events`.
- `lib/cabinets.ts`, `lib/tenant.ts`, `lib/permissions.ts` : isolation et permissions existantes.
- `pdfkit` et helpers PDF de facturation/rapports : même dépendance, nouveau gabarit paie.
- Démo `localStorage` et `DemoBanner` : même stockage, même mode démonstration.
- Assistant IA déterministe : ajout d’outils, aucun nouveau fournisseur.

## 6. Éléments volontairement non modifiés

- `main` et les migrations `0001`→`0013` ;
- les modules comptabilité, facturation, banque, achats, lettrage et multidevises ;
- la numérotation des écritures et le moteur de propositions ;
- l’e-invoicing MRA, toujours désactivé ;
- le correctif de sélection de fichiers Samsung `d3a4347` ;
- les indicateurs de focus et la pastille d’assistant.

## 7. Limites de l’audit

Aucun accès à un dépôt de référence externe n’était disponible. L’audit porte donc sur
le code de ce dépôt, ses migrations, ses tests et sa documentation. Il ne prétend pas
établir la conformité légale mauricienne du module.
