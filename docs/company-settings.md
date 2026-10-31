# Paramètres société (mission 7)

> Un **seul référentiel** pour la fiche société, accessible depuis deux endroits
> de l'interface. Aucune duplication de données, aucun second enregistrement.

## 1. Accès

| Chemin | Écran |
| --- | --- |
| Cabinet → Sociétés (Dossiers clients) → Fiche société → **Paramètres société** | `/cabinet/companies/:companyId/settings` |
| Comptabilité → Paramètres → lien **Paramètres société** | `/accounting/settings/company` |

Les deux chemins affichent le **même composant** (`apps/web/src/pages/company/CompanySettings.tsx`)
et lisent la **même route** (`GET /companies/:companyId/settings/company`).

## 2. Sections

### Identification
Raison sociale, nom commercial, BRN, n° de TVA, adresse enregistrée, activité,
contact (nom, e-mail, téléphone), langue de la société.

### Comptabilité
Devise fonctionnelle (lecture seule), devise de présentation, norme comptable,
début/fin d'exercice, journaux, périodes (ouvertes/clôturées), comptes par défaut.

### Facturation
Préfixes devis/facture/avoir, politique de numérotation (annuelle ou continue),
délai de paiement par défaut, langue des documents, logo (URL), mentions légales
FR/EN, coordonnées bancaires, comptes par défaut (produits, clients, banque,
achats, TVA récupérable, TVA collectée).

### Fiscalité
Statut TVA de la société, numéro de TVA, liste des taux (voir
`docs/vat-configuration.md`), compteurs vérifiés/non vérifiés, historique.

## 3. Écritures et journalisation

| Route | Droit | Journal |
| --- | --- | --- |
| `GET /companies/:id/settings/company` | cabinet / read | — |
| `PATCH …/settings/identification` | cabinet / admin | `settings.identification.update` (avant/après des champs sensibles) |
| `PATCH …/settings/accounting` | accounting / admin | `settings.accounting.update` |
| `PATCH …/settings/billing` | billing / admin | `settings.billing.update` |

Les entrées d'audit sont lisibles via la section « Historique » de l'écran et
`GET /companies/:id/audit` (admin).

## 4. Verrous et garanties

- **Exercice** : un changement de dates est refusé (`409
  SETTINGS_FINANCIAL_YEAR_LOCKED`) si une écriture **comptabilisée** tombe hors du
  nouvel exercice. L'historique comptable n'est jamais poussé hors de l'exercice.
- **Devise de présentation** : refusée (`409 SETTINGS_CURRENCY_LOCKED`) dès que
  le plan comptable existe (journaux présents).
- **Comptes par défaut** : doivent appartenir au plan comptable de la société
  (`400 SETTINGS_ACCOUNT_NOT_IN_CHART`), sinon aucun compte n'est inventé.
- **Documents émis** : les paramètres de numérotation ne réécrivent jamais un
  numéro déjà attribué (numérotation immuable de la mission 6).
- **Dossier archivé** : lecture seule (`requireCompany` refuse les écritures).
- **Mise à jour partielle** : un `PATCH` n'efface jamais les champs non envoyés.

## 5. Ce que cet écran ne fait pas

- Il ne crée ni ne clôture une période (routes existantes `/periods`).
- Il ne modifie pas les membres ni les rôles (écran Équipe).
- Il n'accorde jamais la vérification d'un taux de TVA à l'IA : cette action
  exige une source documentée et une confirmation humaine explicite.
