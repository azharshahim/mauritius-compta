# Rapport de mission 17 — bulletins individuels et préparation des déclarations MRA

Date : 31 octobre 2026. Branche `arena/b0b62798-mauritius-compta`, PR nº1 **ouverte en brouillon**, `main` intacte. **Aucune fusion, aucun déploiement OVH, aucune transmission MRA, aucun identifiant réel, aucun paiement.**

## 1. Impression individuelle d’un bulletin

### Comportement livré

- La liste **Bulletins** ouvre chaque ligne par un lien `Ouvrir / Imprimer` vers
  `/payroll/payslips/:payslipId`.
- Cette page charge **un seul bulletin** et n’affiche que la feuille, ses actions
  et l’avertissement de démonstration.
- Le bouton **Imprimer ce bulletin** appelle `window.print()` une seule fois.
- En démonstration, aucun PDF serveur n’est produit ; l’avertissement le dit
  explicitement.
- En mode API, un bouton de téléchargement du PDF serveur existant reste
  disponible. La démonstration Pages ne l’affiche pas.

### Feuille d’impression dédiée

`apps/web/src/styles.css` définit :

```css
@media print {
  @page { size: A4 portrait; margin: 10mm; }
  body.payslip-print-mode #root * { visibility: hidden; }
  body.payslip-print-mode #root .payslip-print-root,
  body.payslip-print-mode #root .payslip-print-root * { visibility: visible; }
  body.payslip-print-mode .payslip-actions,
  body.payslip-print-mode .alert,
  body.payslip-print-mode .no-print { display: none !important; }
}
```

La classe `payslip-print-mode` est posée sur `<body>` par `PayslipView.tsx` et
retirée au démontage. Les menus, onglets, boutons, formulaires et la pastille
d’assistant sont masqués. La feuille conserve :

- en-tête société et titre du bulletin ;
- identité du salarié, période, devise et référence de calcul ;
- tableau des rémunérations ;
- tableau des retenues (PAYE, CSG, NSF et autres retenues) ;
- net arithmétique, net après cotisations et **net à payer non calculé** ;
- contributions employeur et coût employeur ;
- traçabilité des règles et contrôles ;
- pied de page discret `SIMULATION — NON VALIDÉ POUR PAIEMENT`.

`page-break-inside: avoid` protège les tableaux et le pied de page. Aucun saut de
page forcé n’est ajouté : avec un salarié et une seule ligne de paie, le bulletin
tient sur une page A4.

### Limite honnête

Aucun navigateur graphique n’est installé dans l’environnement de développement
(Chromium/Playwright indisponible). Le rendu papier réel **n’a pas été observé**.
La vérification porte sur les tests jsdom (classe, appel unique à `print`, contenu),
la revue CSS et le build de production. Chrome Windows et Chrome Android restent à
contrôler manuellement selon la procédure de la section 9.

## 2. Suppression des filigranes

- Le PDF serveur et la vue HTML n’ont plus de filigrane central ni de bande
  diagonale.
- Les bandeaux rouges « DEMO » à l’intérieur des documents sont supprimés.
- Seul subsiste le pied de page bilingue discret
  `SIMULATION — NON VALIDÉ POUR PAIEMENT`.
- L’indicateur de démonstration de l’application (barre supérieure) reste présent
  à l’écran, conformément à la règle d’identification du mode démonstration.
- Les blocages de finalisation sont inchangés : `finalisationBlocked: true`,
  `finalisePayslip` renvoie 409 et le net à payer reste `null`.

## 3. Module Déclarations

Menu **Paie & RH → Déclarations**. La période se choisit dans la barre d’outils
commune de la paie.

### Contenu de l’aperçu

| Élément | Source |
|---|---|
| Société, BRN, contacts | table `companies` |
| Période | `payroll_periods` |
| Identifiant employeur | saisie locale fictive, **jamais un ERN MRA** |
| Nombre de salariés | derniers calculs par salarié sur la période |
| Salaire de base, rémunérations, émoluments imposables | `payroll_calculations` |
| PAYE | calcul persisté |
| CSG salarié/employeur | calcul persisté |
| NSF salarié/employeur | calcul persisté |
| Training Levy | calcul persisté |
| Détail par salarié | dernier calcul de chaque salarié |
| Contrôles | service de déclaration |
| Historique | événements `payroll.mra.prepare` |

Aucun montant de déclaration n’est codé en dur. Les totaux sont **recalculés**
depuis les lignes salarié ; ils ne réutilisent pas un cache `totals` qui pouvait
valoir zéro.

### Statuts non interchangeables

- `status` vaut toujours `PREPARATION_ONLY` : une préparation n’est jamais une
  déclaration déposée.
- `preparationStatus` vaut `BLOCKED` ou `PREPARATION_ONLY`.
- `regulatoryStatus` et `submission` valent `NOT_SUBMITTED`.
- `regulatoryExportBlocked` vaut toujours `true`.
- Aucun statut « soumis », « accepté » ou « approuvé par la MRA » n’existe.

## 4. Références MRA et champs vérifiés

Sources lues le 31 octobre 2026 :

- <https://www.mra.mu/index.php/eservices1/individual/monthly-paye-csg-nsf-return>
- <https://www.mra.mu/download/SpecsMonthlyPACODec2024.pdf>
- modèle CSV officiel `csvTemplate_paco_Dec2024.csv` : **HTTP 500**, illisible.

Champs documentés : `MRA / PACO / V1.0`, ERN employeur à 8 chiffres, BRN, nom,
période `YYMM`, contacts, déclarant, e-mail ; salarié : NIC/NCID 14 caractères,
nom, prénoms, wage bill, Wage Relativity Adjustment, total wage bill, codes de
contribution et de paie, CSG, NSF, levy `Y/N`, émoluments, temps plein, PAYE,
Solidarity Levy, bonus de fin d’année, CSG sur bonus. Montants officiels en
**roupies entières**.

Le détail figure dans [`mra-declarations.md`](mra-declarations.md) et dans le
registre `MRA_RETURN` de [`regulatory-sources-register.md`](regulatory-sources-register.md)
(`CONTENT CHECKED, TEMPLATE UNAVAILABLE`).

L’e-invoicing MRA reste hors périmètre et désactivé.

## 5. Exports disponibles

| Export | Disponible | Contenu | Transmissible à la MRA |
|---|---|---|---|
| **Export officiel PACO** | **Non** | aucun fichier | sans objet |
| **Export interne de préparation** | Oui, si contrôles bloquants levés | en-tête, totaux, détail salarié, contrôles, raisons du blocage officiel | **Non** |
| Ancien CSV `mra-return.csv` | Oui, hérité | totaux de préparation | **Non** |

Caractéristiques de l’export interne :

- nom `MRA-INTERNAL-PREPARATION-YYYYMM-vN.csv` ;
- UTF-8 avec BOM, séparateur virgule, guillemets RFC 4180, CRLF ;
- première ligne `PAYROLL DECLARATION - INTERNAL PREPARATION - NOT SUBMITTED TO MRA` ;
- aucune colonne ni aucun code MRA inventé ;
- bloc final `OFFICIAL MRA CSV / NOT GENERATED`.

Aucune mention ne prétend que ce fichier est accepté par la MRA.

## 6. Contrôles

Contrôles internes : isolation société, correspondance de période, présence de
calculs, couverture des salariés actifs, complétude des règles, valeurs
statutaires non nulles, cohérence de devise, doublons de matricule, matricule
absent, identifiant employeur, validation experte, statut de période.

Effets :

- **bloquants** : archivage et export interne refusés (HTTP 409
  `PAYROLL_DECLARATION_BLOCKED`) ;
- **avertissements** : préparation possible, mais export officiel toujours bloqué
  et signale l’absence de validation.

Contrôles officiels bloquants : `EMPLOYEE_FULL_NIC_MISSING`,
`EMPLOYER_ERN_MISSING`, `TEMPLATE_NOT_FULLY_VERIFIED`,
`WHOLE_RUPEE_RULE_UNVERIFIED`.

Historique : chaque archivage écrit un événement `payroll_events`
(`entity_type = 'payroll_mra_declaration'`, `action = 'payroll.mra.prepare'`)
et une entrée `audit_log`, sous verrou de la période. Les versions sont
calculées depuis les événements existants et ne sont jamais réécrites.

Isolation : toutes les routes appellent `actor(req, companyId)` ; toutes les
requêtes filtrent `company_id`. Un utilisateur hors société reçoit 403/404.

## 7. Interface bilingue et démonstration

L’écran comprend : sélecteur de période, identifiant employeur, badge de statut,
KPI, tableau des neuf totaux, contrôles, détail par salarié, encart export
officiel indisponible, historique. Les tableaux défilent dans leur conteneur sous
640 px, sans débordement horizontal.

Parcours de démonstration (`https://azharshahim.github.io/mauritius-compta/`) :

1. **Paie & RH → Bulletins** : Daniel Morel, octobre 2026.
2. **Ouvrir / Imprimer** : un seul bulletin, puis impression navigateur.
3. **Paie & RH → Déclarations** : période `10/2026`, identifiant
   `DEMO-ERN-0016`.
4. Vérifier les totaux, les contrôles, archiver, télécharger l’export interne.
5. La société `Lagon Bleu` reste bloquée par `CALCULATIONS_INCOMPLETE`.
6. Aucune soumission MRA n’est simulée.

## 8. Tests et builds

Résultats locaux exécutés le 31 octobre 2026 :

| Suite | Résultat |
|---|---|
| API complète (`npx vitest run`, `apps/api`) | **407 réussis, 11 ignorés** |
| dont `payroll-statutory.test.ts` | 22/22 |
| dont `payroll-2026-27.test.ts` | 4/4 |
| dont `payroll-declarations.test.ts` | **5/5** |
| Web complète (`npx vitest run`, `apps/web`) | **190 réussis** (22 fichiers) |
| dont `demo-declarations.test.ts` | **4/4** |
| dont `payroll-ui.test.tsx` | **7/7** |
| Typecheck API | réussit |
| Typecheck Web | réussit |
| `npm run build` (web + API) | réussit |
| `npm run build:demo` (Pages) | réussit |

Les 11 tests ignorés sont ceux qui exigent une base PostgreSQL réelle ou un
environnement de concurrence dédié ; la CI `postgres-tests` les exécute. Aucun
test n’a été modifié pour masquer un échec.

### CI GitHub Actions

Commit `634e813`, poussé sur `arena/b0b62798-mauritius-compta` :

| Workflow | Résultat | Lien |
|---|---|---|
| CI (push) | **succès** — migrations PostgreSQL, tests API PostgreSQL, typecheck/tests/build | [run 41224891019](https://github.com/azharshahim/mauritius-compta/actions/runs/41224891019) |
| CI (pull request nº1) | **succès** | [run 41224895970](https://github.com/azharshahim/mauritius-compta/actions/runs/41224895970) |
| Demo (GitHub Pages) | **succès** — build et déploiement de la démonstration | [run 41224891073](https://github.com/azharshahim/mauritius-compta/actions/runs/41224891073) |

Les trois jobs de la CI sont verts : `Migrations against real PostgreSQL`,
`API tests against real PostgreSQL`, `Typecheck, tests and build`. Les
avertissements visibles concernent uniquement la dépréciation de Node 20 dans les
actions et la migration d’image `ubuntu-latest` ; ils ne sont pas des échecs.

### Non testé

- rendu papier réel dans Chrome Windows et Chrome Android ;
- lecteur d’écran et appareil Samsung physique ;
- acceptation d’un fichier par la MRA (aucune spécification complète, aucun
  identifiant) ;
- `npm run lint` n’a pas été exécuté dans cette mission ;
- scénario multi-utilisateurs concurrents sur PostgreSQL local (couvert par la CI).

## 9. Procédure Windows et Android

### Windows — Chrome/Edge

1. Ouvrir `https://azharshahim.github.io/mauritius-compta/`, se connecter.
2. **Paie & RH → Bulletins**, puis **Ouvrir / Imprimer** sur Daniel Morel.
3. Vérifier que la page ne contient qu’un bulletin.
4. **Imprimer ce bulletin**, choisir A4, marges par défaut, sans en-têtes du
   navigateur. « Enregistrer en PDF » produit un fichier local de simulation.
5. **Déclarations** : vérifier les neuf totaux et les contrôles, archiver,
   télécharger l’export interne, vérifier l’absence d’export officiel.

### Android — Chrome

1. Ouvrir la même adresse, se connecter, sélectionner la société de démonstration.
2. **Bulletins → Ouvrir / Imprimer → Imprimer ce bulletin** ; choisir
   « Enregistrer en PDF » ou une imprimante.
3. Vérifier une page A4, l’absence de menu et le pied de page de simulation.
4. **Déclarations** : les tableaux défilent dans leur conteneur, aucun clavier
   n’est ouvert automatiquement, la pastille d’assistant reste visible à l’écran.
5. **Non vérifié sur appareil physique** : le comportement d’impression Android
   réel et le rendu Samsung restent à confirmer.

## 10. Points restant à valider — revue professionnelle unique

1. Obtenir le **modèle CSV PACO de décembre 2024** et confirmer l’ordre exact des
   lignes, les champs obligatoires, les types de ligne et l’absence de pied de
   fichier non documenté.
2. Décider du **stockage du NIC/NCID complet**, de l’ERN, du déclarant et des
   coordonnées, ou d’une saisie ponctuelle sécurisée pour l’export officiel.
3. Fixer la **règle d’arrondi** en roupie entière de la CSG, de la NSF et de la
   Training Levy, avec référence officielle.
4. Confirmer les **codes de contribution et de paie** applicables aux cas réels
   (temps plein, temps partiel, journalier, etc.).
5. Valider la **périodicité**, l’échéance et le traitement des **déclarations
   rectificatives**.
6. Valider les **règles de paie 2026/27** et les montants du bulletin.
7. Décider de l’exposition d’un historique d’audit plus détaillé dans l’écran
   Déclarations.
8. Module **Transfert comptable** : reporté à la mission 18.

Aucune approbation de la MRA, de la loi ou d’un expert-comptable n’est affirmée.
