# Rapport de mission 14 — Paie & RH mauricienne

**Date :** 31 octobre 2026  
**Dépôt :** `azharshahim/mauritius-compta`  
**Branche :** `arena/b0b62798-mauritius-compta`  
**PR :** nº1, ouverte en **brouillon**, non fusionnée  
**`main` :** intact (`9e46f16`), aucune release, aucun déploiement OVH  
**Code :** commit `0d27e62` + commit de documentation

## 1. Branche, HEAD et PR

Le travail est resté sur la branche de session, sans changement de branche. La PR nº1
reste en brouillon ; aucune fusion n’a été demandée ni exécutée. `main` n’a pas été
modifié. Aucun autre dépôt n’a été consulté.

## 2. Audit

`docs/payroll-existing-audit.md` recense l’existant : une table `payroll_employees`
minimale, quatre routes dont `runs` non implémentée, deux écrans `PreparedPage`, une
permission `payroll_manager`. Aucune seconde table ni second moteur n’a été créé :
la migration étend l’existant et les URLs restent identiques. Aucune règle française
n’a été copiée.

## 3. Architecture et migration

Migration additive et idempotente `0014_payroll_foundation.sql` : contrats + événements,
rubriques, assignations, calendriers, jours fériés, temps, absences, règles de congé,
registre de règles versionnées, réglages, périodes, variables + événements, calculs +
lignes, bulletins, événements de paie, triggers de garde. Isolation cabinet/société.
Aucun calcul ne crée d’écriture comptable. Détail :
`docs/mauritius-payroll-architecture.md`.

## 4. Salariés

Identité, naissance, nationalités, adresse, contacts, urgence, statut, embauche/fin,
département, fonction, lieu, manager, centre de coût, devise, mode de paiement,
coordonnées bancaires protégées (`last4` + empreinte SHA-256), identifiants
statutaires masqués, notes. Salariés mauriciens et étrangers. Doublons détectés sans
fusion. Aucun numéro complet stocké. Référence : `docs/employee-master-data.md`.

## 5. Contrats

Permanent/durée déterminée, temps plein/partiel, dates d’effet, salaire mensuel/
horaire/journalier, devise, horaire, fonction, département, lieu, essai, motif,
avenant, suspension, fin. Supersession datée + événement ; aucun écrasement
silencieux ; un contrat actif par salarié (index unique partiel).

## 6. Rémunérations

Rubriques par code, libellé EN/FR, catégorie (gain, remboursement, retenue, avance,
prêt), unité, méthode, dates d’effet, provenance, compte optionnel. Traitement
fiscal/social `UNVERIFIED`. Assignations salarié datées. Aucun taux inventé.

## 7. Temps et absences

Saisie d’heures, heures supplémentaires et retards ; unicité salarié/date ; calendriers
et jours fériés stockés ; import CSV/XLSX (l’API reçoit des lignes déjà parsées).
Les heures supplémentaires ne reçoivent aucune majoration. Les absences approuvées
produisent un avertissement, jamais une retenue inventée.

## 8. Congés

Types annual/sick/unpaid/maternity/paternity/other, demande motivée, approbation,
refus motivé, annulation, justificatif, historique. Sans règle validée : statut
`CONFIGURATION_REQUIRED`, solde `null`. Une règle créée est `UNVERIFIED` et ne crée
aucun droit.

## 9. Variables mensuelles

Saisie unitaire et import tabulaire CSV/XLSX, contrôles d’appartenance, clé
d’importation unique, réimport idempotent (créés/réutilisés), brouillon exclu du
calcul, validation humaine explicite, historique par événements.

## 10. Moteur

Versionné et déterministe. Arithmétique entière BigInt sur montants `numeric(20,4)` :
sommes, quantité × tarif configuré, prorata calendaire documenté, brut, retenues,
remboursements, net arithmétique. Aucun flottant JS, arrondi demi-haut explicite.
Le réglementaire (PAYE, CSG, NSF, employeur) n’est pas implémenté : colonnes `NULL`,
`statutory_complete=false`, `status=blocked`, code
`PAYROLL_STATUTORY_ENGINE_NOT_IMPLEMENTED`. Aucune contribution mise à zéro. Le net
n’est jamais présenté comme légal. `input_hash` SHA-256 pour la reproductibilité.

## 11. Registre des règles

Codes, noms EN/FR, source légale, référence/URL, dates d’effet, catégories, base,
taux/seuils/plafonds/exonérations, arrondi, cinq statuts, reviewer, date, version,
cas de test, notes. Validation `EXPERT_VALIDATED` réservée à un administrateur, avec
confirmation et source documentée, tracée. Les placeholders PAYE/CSG/NSF n’ont **ni
taux ni source**. Points ouverts regroupés dans `docs/payroll-rules-register.md`.

## 12. Périodes

`draft → data_collection → ready_for_review → calculated → approved → finalised`,
plus `blocked`, réouverture contrôlée, version, anti-double traitement, unicité
société/année/mois, historique. La finalisation est refusée aujourd’hui par le moteur
et par trigger. Aucune régularisation n’est simulée comme légale.

## 13. Bulletins

Bilingues, snapshot JSON : société, salarié, période, base, gains, retenues, brut,
contributions (vides), net arithmétique, devise, références, date, version, règles
manquantes. PDF serveur PDFKit avec filigrane **SIMULATION / DRAFT — NOT FOR
PAYMENT**, `Net payable : NON CALCULÉ`, compte masqué. Bulletin final refusé par API
et trigger. Aucune revendication de conformité.

## 14. Sécurité, IA et confidentialité

Isolation cabinet/société testée, permissions paie distinctes de la comptabilité,
masquage bancaire, audit des salaires/contrats/validations, transactions, idempotence,
exports sécurisés. Aucun rôle non autorisé ne reçoit salaire ou donnée bancaire.
Assistant lecture seule : agrégats de préparation, anomalies, règles manquantes,
explication d’un calcul stocké. Interdiction d’inventer un taux, de modifier, approuver,
finaliser, envoyer des données ou créer une déclaration. Aucun fournisseur payant.
Détail : `docs/payroll-security.md`.

## 15. Tests, CI et Pages

- API : **370 tests verts**, 11 ignorés (concurrence locale), dont **44** nouveaux
  tests paie.
- Migrations : **6/6**, dont la migration 0014.
- Web : **179 tests verts** (167 existants + 12 paie/démo).
- Typechecks API et web : 0 erreur.
- Builds API, web et démo Pages vérifiés (voir CI).
- Tests PostgreSQL réels exécutés par le job CI `postgres-tests` ; concurrence
  ignorée en local faute de PostgreSQL natif dans le sandbox.
- Démonstration GitHub Pages depuis la branche de développement, 12 salariés fictifs.
- Non vérifié : appareil Samsung physique, Chrome réel, lecteur d’écran.

## 16. Limites et mission suivante

Non implémenté : moteur réglementaire PAYE/CSG/NSF/employeur, taux et seuils, congés
acquis, majorations d’heures supplémentaires, bulletins finaux, déclarations
officielles, virements, génération automatique d’écritures, réévaluations de paie,
export de fichiers bancaires, rétention/effacement, catégories statutaires et permis.

Aucune conformité MRA/PAYE/CSG/NSF n’est affirmée. Aucune donnée personnelle réelle,
aucune dépense, aucune clé API, aucun accès bancaire.

**Mission suivante proposée :** revue experte-comptable unique des points listés dans
`docs/payroll-rules-register.md`, puis implémentation du moteur réglementaire versionné
avec jeux de tests officiels, avant toute finalisation de bulletin.
