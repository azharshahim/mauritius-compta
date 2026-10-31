# Préparation des déclarations mensuelles MRA

Date : 31 octobre 2026. Mission 17. **Aucune déclaration n’est transmise à la MRA, aucun identifiant réel n’est utilisé, aucun paiement n’est déclenché et aucune conformité MRA n’est affirmée.**

## 1. Sources officielles consultées

- **Monthly PAYE / CSG / NSF Return** — <https://www.mra.mu/index.php/eservices1/individual/monthly-paye-csg-nsf-return> — page lue le 31 octobre 2026.
- **Specifications/format for file used for Monthly PAYE and Contribution Return (as from December 2024)** — <https://www.mra.mu/download/SpecsMonthlyPACODec2024.pdf> — champs lus.
- **CSV template December 2024** — `https://www.mra.mu/download/csvTemplate_paco_Dec2024.csv` — **indisponible lors de la vérification (HTTP 500)**.
- Les spécifications plus anciennes et les modèles publiés sur la même page ont servi uniquement à comprendre les champs ; ils ne sont **pas** utilisés pour produire un fichier officiel de décembre 2024.
- Ne pas confondre cette déclaration avec l’e-invoicing MRA, qui reste désactivé et hors périmètre.

## 2. Champs déclarés par la spécification PACO de décembre 2024

La spécification décrit notamment :

- en-tête : `Source = MRA`, `Statement Type = PACO`, `Template Version = V1.0` ;
- employeur : ERN (8 chiffres), BRN, nom, période fiscale `YYMM`, téléphone ou mobile, nom du déclarant, adresse e-mail ;
- salarié : NIC/NCID complet (14 caractères), nom, prénoms ;
- assiettes : wage bill hors Wage Relativity Adjustment et Special Allowance 2024, Wage Relativity Adjustment, total wage bill ;
- codes : contribution code (`S`, `D`, `G`, `N`, `V`, `X`), pay code (`D`, `F`, `H`, `M`, `W`), fréquence ;
- montants : CSG, NSF, indicateur Levy `Y/N`, émoluments, temps plein `Y/N`, PAYE, Solidarity Levy, End of Year Bonus, CSG sur bonus, émoluments hors exonérés/bonus/special allowance ;
- montants en **roupies entières, sans centimes**.

## 3. Ce que l’application peut préparer

Les montants proviennent **exclusivement** des calculs de paie enregistrés dans `payroll_calculations`, en sélectionnant la dernière version par salarié et par période :

- total des rémunérations (gross) ;
- salaire de base et émoluments imposables ;
- PAYE ;
- CSG salarié et employeur ;
- NSF salarié et employeur ;
- Training Levy ;
- détail exact par salarié ;
- contrôles de cohérence et historique des préparations.

Aucun taux, montant ou total n’est codé en dur pour représenter une déclaration réelle.

## 4. Pourquoi aucun CSV officiel n’est produit

L’export officiel est **bloqué** pour quatre raisons cumulatives :

1. **NIC/NCID complet absent** : le modèle PACO exige le NIC/NCID du salarié (14 caractères). L’application ne conserve que les quatre derniers chiffres et une empreinte, par minimisation des données.
2. **Identifiants employeur absents** : l’ERN, le nom du déclarant et les coordonnées obligatoires ne sont pas stockés. Le champ « identifiant employeur fictif » de la démonstration est un identifiant local, jamais un ERN MRA.
3. **Modèle non vérifié intégralement** : le fichier CSV officiel de décembre 2024 était indisponible (HTTP 500). Les champs du PDF de spécification ont été lus, mais l’ordre exact des lignes, les types de ligne et les éventuels enregistrements de pied de fichier n’ont pas pu être validés.
4. **Arrondi non fixé** : le modèle officiel attend des roupies entières, alors qu’aucun texte consulté ne fixe l’arrondi CSG/NSF/levy. Les montants exacts à quatre décimales sont donc conservés et **jamais arrondis en silence**.

En conséquence, l’interface affiche « Export officiel non disponible » et propose seulement un **export interne de préparation**. Aucun bouton ne prétend produire un fichier accepté par la MRA.

## 5. Export interne

Nom de fichier :

```
MRA-INTERNAL-PREPARATION-YYYYMM-vN.csv
```

Encodage : UTF-8 avec BOM, séparateur virgule, guillemets RFC 4180, fin de ligne CRLF.

Structure :

1. en-tête `PAYROLL DECLARATION - INTERNAL PREPARATION - NOT SUBMITTED TO MRA` ;
2. mention `SIMULATION - NOT VALIDATED FOR PAYMENT` ;
3. identifiant de préparation, date, société, identifiant employeur local, période, devise, statut ;
4. totaux société ;
5. détail par salarié avec montants exacts à quatre décimales ;
6. liste des contrôles ;
7. raisons pour lesquelles le CSV officiel n’est pas généré.

Cet export est un **document de travail interne**. Il n’est pas au format PACO, ne doit pas être transmis à la MRA et ne constitue pas une déclaration.

## 6. Contrôles

| Code | Effet | Portée |
|---|---|---|
| `COMPANY_ISOLATION` | toutes les lignes sont filtrées par société | interne |
| `EMPLOYEES_PRESENT` | aucun calcul ⇒ blocage | interne |
| `EMPLOYEE_COVERAGE` | salarié actif sans calcul ⇒ avertissement | interne |
| `CALCULATIONS_INCOMPLETE` | calcul bloqué par des règles manquantes ⇒ blocage | interne |
| `STATUTORY_VALUES_NULL` | PAYE/CSG/NSF/levy inconnu ⇒ blocage, jamais zéro | interne |
| `CURRENCY_MISMATCH` | plusieurs devises dans une déclaration mensuelle ⇒ blocage | interne |
| `DUPLICATE_EMPLOYEE_NUMBER` | matricule en doublon ⇒ blocage | interne |
| `EMPLOYEE_NUMBER_MISSING` | matricule absent ⇒ blocage | interne |
| `EMPLOYER_IDENTIFIER_REQUIRED` | identifiant local absent ⇒ archivage bloqué | interne |
| `RULES_NOT_VALIDATED` | règles non validées par un expert ⇒ avertissement | interne |
| `EMPLOYEE_FULL_NIC_MISSING`, `EMPLOYER_ERN_MISSING`, `TEMPLATE_NOT_FULLY_VERIFIED`, `WHOLE_RUPEE_RULE_UNVERIFIED` | export officiel bloqué | officielle |

## 7. Historique et audit

Chaque archivage crée :

- un événement immuable `payroll_events` de type `payroll.mra.prepare` contenant l’instantané de la préparation (version, totaux, détail, contrôles) ;
- une entrée `audit_log` avec la période, la version, le nombre de salariés, les totaux et l’auteur.

La version est incrémentée par période et par société, sous verrou de la période. Aucune modification d’une préparation antérieure n’est possible ; une nouvelle préparation crée une nouvelle version.

## 8. Limites

- Aucune soumission MRA, aucun accès à l’e-filing, aucun identifiant réel.
- Aucun fichier officiel PACO produit.
- Aucune signature électronique.
- Aucun paiement, virement ou ordre de paiement.
- Aucune validation par un expert-comptable ou par la MRA.
