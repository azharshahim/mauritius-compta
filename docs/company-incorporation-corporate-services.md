# Note de cadrage — Company Incorporation & Corporate Services

_Note prospective, 31 octobre 2026. **Aucun développement réalisé** dans la mission 20. Aucune
règle, échéance, taxe, frais ni obligation mauricienne n'est affirmée ci-dessous : chaque point
marqué `À VÉRIFIER` doit être confirmé par un professionnel et par les textes en vigueur._

## 1. Objet

Préparer une future mission distincte couvrant la constitution de sociétés mauriciennes et les
services de secrétariat juridique, sans élargir la mission 20 (immobilisations). Cette note sert
uniquement à cadrer le périmètre, les dépendances et les questions ouvertes.

## 2. Ce qui existe déjà et peut être réutilisé

| Élément existant | Réutilisation envisagée |
|---|---|
| `companies` (`apps/api/sql/migrations/0001_core.sql`) | Fiche société, adresse, BRN, TVA, devise fonctionnelle, exercice |
| Rôles et accès par société (`company_members`, `requireCompany`) | Séparation cabinet / client, droits de lecture et d'écriture |
| Journal d'audit (`apps/api/src/lib/audit.ts`) | Traçabilité des dépôts, validations et changements d'état |
| Pièces jointes (`attachments`) | Statuts, résolutions, pièces d'identité, justificatifs |
| Module cabinet (`apps/api/src/modules/cabinet/*`) | Portefeuille, tâches, échéances |
| Registre des capitaux (`equity_movements`) | Mouvements de capital après constitution, sans lien automatique avec les parts |
| Formulaires bilingues FR/EN et mode démonstration | Maquettage sans donnée réelle |

Aucun de ces éléments ne constitue aujourd'hui un registre juridique de société : ils ne
prouvent ni la constitution, ni la propriété des parts, ni la nomination des dirigeants.

## 3. Périmètre fonctionnel proposé (à valider)

1. **Dossier de constitution** : demande, parties, associés, répartition des parts, dirigeants,
   siège, agent, documents requis.
2. **Réservation de nom et suivi des dépôts** : statuts, formulaires, accusés, références.
3. **Registres statutaires** : associés, parts, administrateurs, dirigeants, procès-verbaux,
   résolutions, registre des charges (si applicable).
4. **Cycle de vie** : constitution, changements statutaires, augmentations / réductions de
   capital, transferts de parts, démissions et nominations, dissolution.
5. **Obligations périodiques** : annuelles et événementielles, avec calendrier paramétré par
   texte officiel — **aucune échéance codée en dur**.
6. **Corporate services** : siège social, agent, tenue de registres, production de documents,
   facturation des services **uniquement** via le module de facturation existant et après
   validation.
7. **Portail client** : consultation des documents et des échéances, sans exposer les données
   d'autres sociétés.

## 4. Ce qui ne doit pas être fait sans validation

- Aucun formulaire officiel reproduit sans spécification et autorisation ; aucun envoi
  automatique à une autorité.
- Aucun délai, frais, seuil de capital, taux ou sanction inventé.
- Aucune affirmation de conformité au Companies Act, aux règles du Registrar of Companies, de la
  FSC ou de la MRA.
- Aucune signature électronique présentée comme valable juridiquement.
- Aucun document réel, aucune pièce d'identité réelle dans la démonstration ou les tests.
- Aucune fusion avec les données comptables sans décision explicite : le lien entre registre des
  parts et capital comptable doit être défini.

## 5. Dépendances techniques probables

| Dépendance | Impact |
|---|---|
| Forme juridique absente du modèle `companies` | Ajouter un type d'entité *configurable* ; impact sur les états et les rôles |
| Absence de registre de personnes (associés, dirigeants) | Nouvelle table et nouveau domaine de permissions |
| Absence de registre de parties liées | La mission Corporate Services pourrait alimenter la note annexe |
| Comptes courants d'associés absents (voir audit) | La constitution crée des apports ; le suivi des comptes courants reste un manque |
| Documents PDF existants | Réutiliser la génération, sans prétendre à un document officiel |
| Stockage des pièces | Politique de conservation et de chiffrement à définir |

## 6. Risques

- **Juridique** : reproduire un formulaire ou une obligation de mémoire est dangereux.
- **Confidentialité** : pièces d'identité, pactes, données personnelles ; accès à minimiser.
- **Séparation des missions** : ne pas mélanger constitution, comptabilité et paie dans un même
  flux irréversible.
- **Attente utilisateur** : un dossier « prêt » ne doit jamais être présenté comme déposé.
- **Périmètre** : la mission pourrait devenir un produit distinct ; la découper en lots.

## 7. Découpage suggéré

1. **Lot 1 — Cadrage et glossaire** : sources officielles archivées, entretien expert, maquettes
   non fonctionnelles.
2. **Lot 2 — Registres statutaires** : personnes, parts, mandats, documents, historique.
3. **Lot 3 — Dossier de constitution** : checklist, pièces, états, aucune transmission.
4. **Lot 4 — Cycle de vie** : changements statutaires et résolutions.
5. **Lot 5 — Obligations et portail** : calendrier paramétré, rappels, consultation.
6. **Lot 6 — Corporate services facturés** : réutilisation de la facturation, validation humaine.

Chaque lot reste soumis à une revue professionnelle unique et à une autorisation explicite
avant développement.

## 8. Questions à poser avant lancement

Voir la section 12 du rapport de mission 20 (questions en anglais, regroupées pour une revue
unique).
