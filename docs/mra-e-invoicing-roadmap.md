# MRA e-Invoicing — feuille de route de préparation

**Mission 25 — 1er novembre 2026**
**Statut : À VENIR. Intégration non activée. Aucune inscription, certification, habilitation ni connexion MRA n'est acquise.**

Ce document prépare une future intégration à la facturation électronique mauricienne. Il ne
décrit pas une fonctionnalité livrée : l'écran `Facturation → MRA e-Invoicing — À venir` est
informatif et n'effectue aucun appel réseau. La facturation classique (devis, factures,
avoirs, encaissements, PDF serveur) reste le seul système de facturation opérationnel et
n'est pas modifiée.

## Comment lire ce document

| Marque | Signification |
| --- | --- |
| **CONFIRMÉ** | Exigence ou fait explicitement écrit dans une source officielle consultée. La source et sa date sont citées. |
| **À VÉRIFIER** | Point non tranché, absent des documents consultés, susceptible d'avoir changé, ou contradictoire entre deux documents. Ne doit pas être codé sur une supposition. |
| **HYPOTHÈSE** | Proposition d'architecture ou de conduite, à valider par la MRA, un conseil juridique ou un expert-comptable. Aucune valeur réglementaire. |

Les documents MRA consultés ne portent pas tous une date de dernière mise à jour. Les
versions indiquées sont celles des fichiers publiés au 1er novembre 2026 ; elles doivent être
revérifiées avant toute demande officielle.

## Sources officielles consultées

| Source | Version / date | Ce qui en est retenu |
| --- | --- | --- |
| [MRA — e-Invoicing](https://www.mra.mu/e-invoicing) | Page consultée le 01/11/2026 | Déploiement par phases ; rôles des éditeurs EBS et des opérateurs économiques ; jalons LTD/MSTD ; pouvoir de notification du Director-General ; liens officiels. |
| [The Value Added Tax (e-Invoicing) Regulations 2023](https://www.mra.mu/download/VATeInvoicingReg2023.pdf) | Government Notice nº 132 de 2023, faite le 18/09/2023, entrée en vigueur le **02/10/2023** | Obligations des opérateurs et des fournisseurs d'EBS ; enregistrement, IFP, IRN/QR, facture fiscale et retrait. |
| [Functional Specifications of the Electronic Billing System](https://www.mra.mu/download/eInvoicing/e-InvoicingTechnicalSpecs.pdf) | Juin 2023 | JSON, certificat/token, API, IRN/QR, hachage, séquence, mode hors ligne, stockage, contrôle d'accès, compteur inviolable, fonctions interdites. |
| [General (non-technical) e-Invoicing Guide for Software Developers](https://www.mra.mu/download/eInvoicing/GeneralGuidelinesSoftwareDevelopers.pdf) | v1.0, 21/06/2023 | Parcours du portail développeur, bac à sable, test script, auto-certification, deux API. |
| [Technical Guidelines — MRA e-Invoicing](https://www.mra.mu/download/InvoicingRegulations.pdf) | 2023 | Portail MRAID, clé publique MRA, authentification, jeton, API de transmission, environnement de test. |
| [Standard e-Invoice Template](https://www.mra.mu/download/eInvoicing/StandardeInvoiceTemplate2.pdf) | Version consultée le 01/11/2026 | Champs obligatoires et conditionnels du JSON ; IRN et QR renvoyés par l'IFP. |
| [FAQs e-Invoicing System](https://www.mra.mu/download/eInvoicing/e-InvoicingFAQs.pdf) | Juillet 2023 | EBS, IFP, IRN/QR, obligation, mode dégradé, preuves et rôles. |
| [List of EBS Solution Providers](https://www.mra.mu/download/eInvoicing/EBSSolutionProviders.pdf) | Liste « as at 16 September 2026 » | Liste **indicative** de fournisseurs auto-certifiés. Mauritius Compta n'y figure pas. À revérifier avant toute communication. |

Aucun compte n'a été créé sur le portail développeur ou le portail économique. Aucune
demande, aucun test, aucun certificat et aucun identifiant MRA n'ont été demandés.

---

## 1. Inscription de la future société comme éditeur / fournisseur de solution

### CONFIRMÉ

- La réglementation définit l'**EBS Solution Provider** comme la personne qui développe,
  fabrique, vend ou met à disposition un EBS à toute personne à Maurice (règlement 2).
- Nul ne peut vendre, louer ou mettre à disposition un EBS à un contribuable sans être
  **enregistré auprès du Director-General** pour une marque et un modèle déterminés
  (règlement 7(1)).
- L'enregistrement suppose que le fournisseur certifie **par écrit** que l'EBS est conforme
  aux spécifications techniques et fonctionnelles publiées, après des tests approfondis sur
  le portail développeur (règlements 7(2) et 7(3)).
- Le Director-General peut demander l'accès à l'EBS et toute information utile, traiter la
  demande, publier les détails du fournisseur, de la marque et du modèle, et prononcer un
  retrait en cas de non-conformité ou d'information inexacte (règlement 7).
- Le parcours public du portail comprend : création du compte, profil utilisateur,
  enregistrement de l'EBS, obtention d'un **EBS MRA ID**, tests en bac à sable, test script
  et auto-certification (guide développeur v1.0).
- La MRA indique explicitement n'être **pas un organisme de certification** des EBS :
  l'éditeur auto-certifie la conformité de son produit.
- La liste publique est présentée comme **indicative** et contient des fournisseurs
  auto-certifiés. Être sur cette liste ne signifie pas que la MRA a certifié le logiciel.

### À VÉRIFIER

- Forme sociale exacte, constitution d'une société mauricienne, BRN, statut TVA, siège,
  dirigeants, associés et bénéficiaires effectifs exigés pour une demande d'enregistrement.
- Formulaire de demande, pièces, frais, délais, critères d'acceptation, durée de validité,
  renouvellement et procédure de radiation.
- Périmètre exact d'une marque et d'un modèle : une application web multi-sociétés, ses
  versions et ses modules doivent-ils être enregistrés séparément ?
- Exigences de présence locale, de support, de maintenance, d'assurance, de contrat de
  service et de continuité.
- Conditions du portail (Termes et conditions) et traitement des données de test.
- Mise à jour de la liste des fournisseurs après le 16 septembre 2026.

### HYPOTHÈSE

- Une inscription unique « Mauritius Compta » pourra couvrir une famille de versions, à
  confirmer par la MRA avant tout dépôt.
- Un hébergement serveur hors du poste client sera nécessaire pour protéger les secrets et
  assurer la transmission ; aucune exigence de résidence des données n'est confirmée à ce
  stade.

### Actions autorisées dans cette mission

Aucune. Il est interdit de créer un compte, de soumettre un profil, de demander une licence
ou de solliciter un identifiant MRA avant la constitution de la société et la validation
juridique.

---

## 2. Démarches des sociétés clientes

### CONFIRMÉ

- Les contribuables soumis à l'obligation doivent exploiter un ou plusieurs EBS pour émettre
  des factures fiscales, acquérir un EBS auprès d'un fournisseur enregistré, installer la
  connectivité nécessaire et ne pas utiliser un système non enregistré ou non conforme
  (règlement 4).
- Chaque EBS doit être enregistré sur l'IFP ; un numéro d'identification est délivré par le
  Director-General. L'EBS doit s'authentifier avant de transmettre, recevoir les données
  fiscales et enregistrer l'IRN, puis émettre la facture avec le QR code (règlement 4(3)).
- Le contribuable doit stocker de manière sécurisée son nom d'utilisateur, son mot de passe,
  son identifiant EBS et son jeton, et en préserver la confidentialité (règlement 4(4)(b)).
- La phase 2 impose l'inscription de l'opérateur économique et l'enrôlement de l'EBS ; la
  phase 3 rend la facturation fiscale obligatoire par étapes.
- Jalons publiés sur la page MRA consultée le 01/11/2026 :

| Catégorie | Chiffre d'affaires annuel dépassant (MUR) | Échéance | Statut affiché |
| --- | ---: | --- | --- |
| LTD | 100 millions | 15/05/2024 | Lancé |
| MSTD | 100 millions | 01/08/2025 | Lancé |
| MSTD | 80 millions | 30/06/2026 | Lancé |
| MSTD | 40 millions | 01/09/2026 | Lancé |

- En vertu de la section 20A(2) de la VAT Act, le Director-General peut notifier un
  contribuable et lui imposer une date, **quel que soit son chiffre d'affaires et son statut
  TVA**.
- Les FAQ précisent que le système s'applique aussi aux personnes non enregistrées à la TVA
  lorsqu'elles entrent dans le champ ou reçoivent une notification.

### À VÉRIFIER

- Applicabilité de chaque société cliente à une date donnée, existence d'une notification
  écrite, catégorie LTD/MSTD et seuil retenu.
- Traitement des groupes, succursales, plusieurs lieux d'exploitation, changements de
  chiffre d'affaires et cessation d'activité.
- Procédure exacte d'inscription de l'opérateur, d'enrôlement d'un EBS par lieu, de
  changement d'EBS et de désenregistrement.
- Qui peut agir pour le compte du contribuable (mandat, cabinet, prestataire) et quelles
  preuves de mandat sont acceptées.
- Conséquences d'une facture émise pendant une indisponibilité et procédure de
  régularisation.

### HYPOTHÈSE

- Le cabinet pourra assister les clients, mais **chaque contribuable restera responsable** de
  son enregistrement, de ses identifiants et de ses transmissions.
- Une reprise des factures classiques déjà émises devra être organisée sans réécrire
  l'historique comptable.

---

## 3. Documents administratifs et sociétaires

### CONFIRMÉ

- Le fournisseur doit certifier la conformité, donner accès à l'EBS et fournir les
  informations demandées par le Director-General (règlement 7).
- La liste publique des fournisseurs mentionne la raison sociale, le BRN, la marque, le
  modèle et les fonctionnalités.
- Les identifiants, mots de passe, identifiants EBS et jetons doivent être conservés de
  manière sécurisée (règlement 4(4)(b)).

### À VÉRIFIER

- Liste officielle des pièces pour l'éditeur : constitution, certificat d'incorporation,
  BRN, certificat TVA, pièce d'identité des dirigeants, registre des associés, bénéficiaires
  effectifs, siège, états financiers, attestation fiscale, assurances.
- Preuve de propriété ou de licence des logiciels, codes sources, marques et bases de
  données.
- Contrats clients, conditions générales, politique de confidentialité, accord de
  sous-traitance et registre des activités de traitement.
- Documents exigés des sociétés clientes et durée de conservation des justificatifs.

### HYPOTHÈSE

- Un dossier de type KYC sociétaire sera demandé, mais **aucune liste exhaustive n'est
  confirmée** par les documents consultés. Il ne faut donc pas collecter de documents réels
  avant la confirmation officielle.

### Étape juridique distincte

La répartition **50/50** entre les associés, le pacte d'associés, la gouvernance, la
propriété intellectuelle, les licences, la responsabilité, les contrats clients et la
sortie éventuelle feront l'objet d'une **étape juridique distincte**. Elle doit précéder
l'utilisation de documents sociétaires réels ou de tout engagement auprès de la MRA.
Ce document n'est pas un avis juridique.

---

## 4. Spécifications techniques et environnements de test officiels

### CONFIRMÉ

- Les factures, avoirs et notes de débit doivent être générés en **JSON** selon le modèle
  officiel et transmis en temps réel à l'IFP (spécifications fonctionnelles, §1a).
- L'EBS doit utiliser un certificat numérique valide au nom du contribuable ou un jeton
  délivré par le Director-General pour signer/stamper les données (spécifications, §1b).
- L'EBS doit se connecter à l'API publiée par la MRA pour obtenir un **IRN** et un **QR
  code** pour chaque facture, avoir et note de débit (spécifications, §1c).
- L'EBS doit enregistrer l'IRN, insérer le QR code, générer un **hash** et l'intégrer au
  document suivant dans la séquence, numéroter les factures de façon croissante et
  poursuivre la séquence hors ligne avant d'envoyer le lot à la reconnexion
  (spécifications, §1d à §1g).
- Contrôles d'accès par identifiants et rôles, mot de passe administrateur par défaut
  désactivé, stockage sécurisé et inviolable (spécifications, §2 et §3).
- L'EBS doit résister à l'altération, utiliser un compteur inviolable non réinitialisable et
  ne pas permettre de modifier la date/heure, d'exporter le certificat pendant
  l'initialisation, de réinitialiser le compteur ou de modifier les documents stockés
  (spécifications, §4 et §5).
- Le guide technique décrit **deux API** : authentification de l'EBS (jeton valable un jour,
  clé publique MRA, identifiant EBS MRA) et transmission de facture (réponse avec QR code et
  UUID). Le portail fournit un bac à sable, un test script et un parcours
  d'auto-certification.
- Le modèle standard contient des champs obligatoires et conditionnels (vendeur, acheteur,
  lignes, TVA, totaux, devise, date/heure, numéro séquentiel, BRN, etc.).

### À VÉRIFIER

- Version en vigueur des spécifications fonctionnelles, du guide technique, du modèle JSON
  et du test script ; la version consultée des spécifications date de juin 2023.
- Contrat OpenAPI exact, schémas de requête/réponse, codes d'erreur, idempotence, délais,
  limites de débit, reprise après incident et politique de versionnage.
- **Incohérence apparente à faire trancher** : la réglementation 10(2)(o) exige l'IRN et le QR
  code sur la facture fiscale, tandis que la note du modèle standard indique que l'IRN ne
  doit pas apparaître sur la facture remise au client. Le guide technique parle aussi d'un
  « UUID » dans la réponse de transmission. Il faut obtenir la règle officielle actuelle
  avant de concevoir l'impression.
- API de suivi des statuts, accusés de réception et rejets : le guide consulté ne décrit que
  l'authentification, la transmission et la récupération du QR/UUID. Le suivi envisagé est
  donc une **hypothèse produit**, pas une API confirmée.
- Format et algorithme du hash, chaîne de séquence, contenu exact du QR code, gestion des
  avoirs et notes de débit, mode hors ligne (taille de lot, durée, ordre).
- Accès au bac à sable, durée des tests, jeu de données, critères de réussite et preuve
  d'auto-certification.
- Exigences pour un hébergement SaaS multi-sociétés, la résidence des données, les adresses
  IP autorisées et les proxys.

### HYPOTHÈSE D'ARCHITECTURE (non implémentée)

- Un adaptateur serveur isolerait les secrets et les appels MRA ; le frontend ne verrait
  qu'un état métier.
- Une **outbox** transactionnelle préparerait la transmission, avec idempotence, reprise et
  journal immuable.
- La facture classique resterait la source du document ; l'adaptateur créerait une
  soumission fiscale liée, sans créer un second moteur de facturation.
- Les statuts seraient stockés comme événements horodatés, avec validation humaine des
  corrections et rapprochement comptable.

Ces choix ne doivent pas être codés avant la confirmation des points « À VÉRIFIER ».

---

## 5. Sécurité et conservation

### CONFIRMÉ

- Stockage sécurisé des identifiants, mots de passe, identifiants EBS et jetons
  (règlement 4(4)(b)).
- L'IFP doit préserver la confidentialité et l'intégrité des certificats et signatures
  numériques (règlement 5(f)).
- Stockage électronique sécurisé et inviolable, avec récupération aisée (spécifications, §3).
- Protection contre l'altération et la suppression non détectée, révélation des tentatives
  d'altération (spécifications, §4).
- Compteur inviolable non réinitialisable, enregistré dans chaque document
  (spécifications, §4b).
- Accès protégé, mot de passe administrateur par défaut désactivé, rôles
  (spécifications, §2).

### À VÉRIFIER

- Durée légale de conservation des factures et documents fiscaux à Maurice, archivage,
  restitution et destruction.
- Exigences de chiffrement au repos et en transit, gestion des clés, rotation, coffre-fort
  de secrets, séparation des environnements.
- Résidence des données, sous-traitants, transferts internationaux, obligations au titre de
  la protection des données et formalités auprès du régulateur.
- Journalisation minimale, conservation des journaux, accès des auditeurs, preuve
  d'intégrité, sauvegardes et plan de reprise.
- Notification des incidents, des défauts et des usages abusifs à la MRA ; délais et
  destinataires.
- Tests d'intrusion, revue de code, gestion des vulnérabilités et cycle de vie des
  certificats.

### HYPOTHÈSE

- Les secrets seraient conservés dans un coffre serveur, jamais dans le bundle web ni dans
  Git.
- Les documents fiscaux et les événements de transmission seraient en ajout seul, avec
  empreintes et sauvegardes testées.
- Les rôles MRA seraient séparés des rôles de facturation classique lorsque la MRA l'exige.

---

## 6. Validation et mise en production

### CONFIRMÉ

- L'éditeur doit tester l'EBS sur le portail développeur avant de s'enregistrer comme
  fournisseur (règlement 7(3)).
- Le parcours recommandé comprend l'inscription, le profil, l'enregistrement de l'EBS, les
  tests en bac à sable, le test script, puis l'auto-certification.
- La MRA peut vérifier l'EBS, demander des informations, publier le fournisseur et le
  radier en cas de non-conformité (règlement 7).
- Le fournisseur doit signaler sans délai un défaut ou un usage abusif d'un EBS enregistré
  (règlement 7(7)).
- L'opérateur économique doit réussir les tests et enrôler son EBS avant de transmettre en
  production ; l'EBS MRA ID sert à la transmission réelle.

### À VÉRIFIER

- Critères d'acceptation du test script, preuves à conserver, procédure de reprise en cas
  d'échec et délai de réexécution.
- Autorisation d'accès à l'environnement de production, procédure de mise en service,
  fenêtre de bascule et rollback.
- Validation des nouvelles versions d'un EBS déjà enregistré, obligations de notification
  et re-certification.
- Support, escalation, SLA, maintenance, statut des incidents et communication de crise.
- Revue professionnelle attendue : expert-comptable, juriste, sécurité et, si nécessaire,
  partenaire local à Maurice.

### HYPOTHÈSE DE GOUVERNANCE

Aucune date n'est promise. Les portes de décision proposées sont :

1. **G0 — Société et propriété intellectuelle** : structure 50/50, pacte, licences.
2. **G1 — Dossier officiel** : procédure, pièces, frais et critères confirmés par la MRA.
3. **G2 — Accès au bac à sable** : compte développeur autorisé, sans données réelles.
4. **G3 — Adaptateur et tests** : modèle JSON, authentification, transmission, reprise,
   journalisation et tests automatisés.
5. **G4 — Revue de sécurité** : secrets, stockage, audit, sauvegardes et incident.
6. **G5 — Revue professionnelle** : expert-comptable et juriste.
7. **G6 — Pilote** : société fictive, données fictives, aucun envoi réel.
8. **G7 — Enregistrement et production** : décision MRA et autorisation écrite.
9. **G8 — Lancement commercial** : contrats, support et communication vérifiée.

---

## Architecture fonctionnelle cible (proposition, non implémentée)

```text
Facturation classique (inchangée)
        │  document émis (facture, avoir, note de débit)
        ▼
Adaptateur MRA e-Invoicing (à construire, serveur uniquement)
        │  mapping JSON + file d'attente + idempotence
        ▼
API MRA (authentification puis transmission)
        │  IRN / QR / statut / erreur
        ▼
Journal fiscal immuable + rapprochement comptable
        │
        ▼
Écran de suivi et paramètres (aujourd'hui inactif)
```

Principes :

- **Un seul système de facturation** : la facturation classique reste la source ; l'écran
  MRA n'émet, ne modifie et n'envoie aucun document.
- **Aucun secret dans le navigateur** : l'adaptateur et les identifiants restent côté
  serveur.
- **Aucune écriture comptable automatique** : le rapprochement reste soumis à validation
  humaine.
- **Aucune donnée réelle dans la démonstration** : les données affichées sont fictives.
- **Aucune conformité revendiquée** tant que l'enregistrement, les tests officiels et la
  revue professionnelle ne sont pas achevés.

## Ce qui n'est pas fait dans la mission 25

- Aucun appel à une API MRA, aucun compte, aucune inscription, aucune demande de licence.
- Aucun certificat, identifiant EBS, jeton, mot de passe ou clé MRA.
- Aucune facture électronique émise, transmise ou fiscalisée.
- Aucun document d'identité ou sociétaire réel collecté.
- Aucun statut « certifié », « agréé » ou « conforme MRA » revendiqué.
- Aucune règle réglementaire inventée : les points incertains restent marqués
  **À VÉRIFIER**.
- Aucune migration, aucun nouveau système de facturation, aucune modification du parcours
  de facturation classique.

## Questions à poser lors du premier échange officiel

1. Our planned product is an accounting and billing web application: should it be
   registered as an EBS Solution Provider, and under which brand and model?
2. What are the exact eligibility, incorporation, BRN, ownership and documentation
   requirements for a newly created Mauritius company?
3. Which versions of the functional specifications, technical guide, JSON schema, test
   script and public key are currently in force?
4. How do we obtain sandbox access, and what evidence must be retained for
   self-certification?
5. Regulation 10(2)(o) requires the IRN on the fiscal invoice, while the standard template
   note says the IRN must not appear on the customer invoice. Which rule applies?
6. Does the transmission response return an IRN, a UUID or both, and what should be printed
   and stored?
7. Are status, acknowledgement and rejection APIs available, or must we poll another
   endpoint?
8. What are the requirements for offline sequencing, retries, idempotency and batch limits?
9. What are the retention, data-residency, encryption and incident-notification
   requirements?
10. What is the procedure for production access, version changes, re-certification,
    suspension and deregistration?
11. May a Mauritius company use a multi-tenant SaaS hosted outside Mauritius, and which
    contractual and data-protection safeguards are required?
12. What is the exact role of the client company versus the solution provider during
    onboarding, and are mandates accepted?

---

**Conclusion :** la voie est documentée, mais elle n'est pas ouverte. La prochaine étape
réelle est juridique et administrative (société, 50/50, propriété intellectuelle), puis un
échange officiel avec la MRA. Aucun développement d'API ne doit commencer sur la base des
seuls documents publics consultés.
