# Mission 26 — navigation cabinet, journaux et imports PDF

**Date** : 1er novembre 2026  
**Version** : 0.1.1  
**Branche** : `arena/75369ce7-mauritius-compta`  
**Commit de référence** : `a3be2e8` (mission 26)  
**Pull request** : **nº9**, **brouillon** — <https://github.com/azharshahim/mauritius-compta/pull/9>  
**État** : livrée en brouillon ; **non fusionnée**, **non déployée**, `main` inchangée.

> La PR porte le titre « Mission 26 » ; son numéro GitHub est **9**, pas 26. La numérotation
> des PR est propre à GitHub et ne suit pas le numéro de mission.

## 1. Résultat

Les dix points de la mission 26 sont implémentés, testés et poussés. Aucune migration de
schéma n’a été ajoutée. Aucun envoi à la MRA, aucune donnée réelle, aucune opération OVH ou
Progest, aucune publication de la démo depuis cette branche.

Le changement est volontairement **ergonomique et fonctionnel**, sans refonte du moteur
comptable : les écrans, routes et contrats existants restent utilisés, avec des points
d’entrée plus explicites.

## 2. Les dix critères

| nº | Critère | Livraison |
|---:|---|---|
| 1 | Navigation par **8 groupes repliables**, Banque et États financiers en bas | `apps/web/src/navigation.ts`, sidebar de `App.tsx` |
| 2 | Imports depuis les **journaux achats et ventes** | routes `/accounting/journals/{purchases,sales}/import`, boutons dans Achats, Facturation et Documents |
| 3 | **Un seul moteur OCR** | réutilisation de `modules/documents/extract.ts` de la mission 23 ; aucun second moteur |
| 4 | **Jamais de comptabilisation automatique** | import = document + proposition ; validation humaine = brouillon d’écriture |
| 5 | **Documents = archive** | documents consultables, la recherche reste, les imports démarrent dans les journaux |
| 6 | **Accueil allégé** | société/exercice, six indicateurs, documents en attente, écritures à valider, accès rapides |
| 7 | **FR/EN et mobile** | libellés parité, tiroir refermé après navigation (y compris changement de requête), cibles 44 px |
| 8 | **Sécurité et isolation** | permissions existantes conservées, validation et limites de taille, chemins calculés côté serveur |
| 9 | **Tests avec données fictives uniquement** | fixtures générées, aucun fichier client, aucun PDF bancaire réel |
| 10 | **PR brouillon sans fusion** | PR nº9 `--draft`, aucun merge, aucun déploiement |

## 3. Navigation

Huit groupes, dans cet ordre :

1. **Accueil** — tableau de bord.
2. **Comptabilité** — plan comptable, écritures, journaux (achats, ventes, banque, opérations
   diverses), grand livre, balance.
3. **Facturation** — tableau de bord, factures clients, clients, fournisseurs, factures
   d’achat, avoirs, règlements, échéancier.
4. **Paie et RH** — bulletins, déclarations.
5. **Gestion avancée** — immobilisations, régularisations, provisions, analytique.
6. **Banque et trésorerie** — comptes, imports, rapprochement.
7. **États financiers** — bilan, compte de résultat, autres rapports.
8. **Cabinet et administration** — gestion du cabinet, paramètres, migration, audit.

Comportement :

- un seul groupe actif est ouvert au premier affichage ; l’URL active ouvre son groupe ;
- les groupes restent dépliables indépendamment, sans perdre la route courante ;
- le groupe actif est marqué, les entrées utilisent `aria-current` via `NavLink` ;
- sur mobile, le tiroir se ferme à chaque navigation, **y compris lorsque seule la query
  change** (`?tab=…`) ;
- les modules désactivés restent masqués par les permissions existantes ; le groupe n’est
  affiché que s’il reste au moins une entrée visible.

Aucune route existante n’a été supprimée : les signets et liens de la mission 25 continuent
de fonctionner.

## 4. Factures d’achat et de vente

### Facture externe → OCR

- entrée depuis le journal des achats ou des ventes, ou depuis Documents ;
- PDF natif : extraction texte ; PDF scanné ou image : **OCR local** (mission 23) ;
- métadonnées, lignes et propositions restent **modifiables** ;
- la validation crée un **brouillon** rattaché au bon journal, jamais une écriture validée ;
- un doublon déjà comptabilisé est refusé ;
- le document d’origine reste archivé dans Documents.

### Facture de vente déjà créée → sans OCR

Lorsque la facture existe déjà dans Facturation, le parcours « importer depuis le journal des
ventes » propose une écriture **déterministe** à partir des données structurées
(client, date, HT, TVA, TTC, devise). Il n’y a ni OCR, ni ressaisie obligatoire, ni écriture
automatique : la proposition est révisée puis validée en brouillon. Un doublon comptabilisé
est refusé.

### Ce qui n’est pas fait

- pas de reconnaissance de facture **manuscrite** revendiquée ;
- pas de format e-invoice MRA importé ;
- pas de création automatique de fournisseur/client à partir d’un texte OCR ;
- pas de comptabilisation sans revue humaine.

## 5. Relevés bancaires PDF

Route : `/accounting/banking/pdf` (même écran que le lecteur MCB, en mode générique).

### Formats réellement testés

| Format | Test | Résultat |
|---|---|---|
| PDF texte généré, profil MCB fictif | `mission23.test.ts` | métadonnées, période, soldes, lignes, import confirmé |
| PDF texte généré, autre banque fictive (SBM) | `mission23.test.ts` | profil générique, métadonnées, avertissement, import confirmé |
| PDF image généré (scan simulé) | `mission23.test.ts` (documents) | OCR réel appelé, texte reconnu |
| CSV / TSV / XLSX bancaires | suites mission 21/23 | inchangés |
| **PDF bancaire réel** | **aucun** | **non testé** |
| **JPG/JPEG de facture** | **aucun fichier JPEG** | accepté par la politique d’upload, non couvert par une fixture |

Les PDF de test sont fabriqués par `pdfkit`. Aucun document d’une banque, d’un client ou
d’une administration n’est versionné ni utilisé.

### Profil MCB prioritaire

Le lecteur MCB reconnaît la mise en page fictive « Savings Regular Account » utilisée depuis
la mission 23. Un relevé non conforme renvoie `BANK_MCB_PROFILE_UNRECOGNISED` ; il n’est pas
forcé dans le profil MCB.

### Autres banques — lecture prudente

- extraction générique des métadonnées (banque, compte, période, devise) ;
- dates de valeur conservées lorsqu’elles sont lisibles ;
- contrôle des soldes d’ouverture/fermeture ;
- **refus** si les soldes ou les colonnes sont ambigus (`BANK_PDF_AMBIGUOUS`,
  `BANK_PDF_REQUIRED`) ;
- avertissement si le solde d’ouverture manque ;
- suggestion de nature (salaire, frais, fournisseur, client) **indicative uniquement**,
  jamais appliquée automatiquement ; le libellé reste à vérifier ;
- case de revue humaine obligatoire avant `Confirmer et importer`.

Aucun « format MCB universel » ni « format bancaire mauricien standard » n’est supposé. La
lecture générique est un filet de sécurité, pas un connecteur bancaire.

### Traçabilité du PDF source

À l’import confirmé :

- le PDF d’origine est conservé sous `bank-statements/<société>/<sha256>-<nom>.pdf` ;
- le SHA‑256 sert d’`idempotencyKey` et empêche un double import ;
- `bank_imports.summary.source` contient le nom, le SHA‑256, la clé de stockage et les
  métadonnées d’extraction ;
- le fichier est écrit avec le mode `0600` et un nom assaini ;
- l’aperçu n’écrit **aucun** fichier ; seule l’importation confirmée le fait.

Le stockage est local au serveur (`STORAGE_DIR`), pas un service cloud. Un import échoué
après l’écriture du fichier peut laisser un fichier orphelin : aucun nettoyage périodique
n’est ajouté dans cette mission.

### API

`POST /companies/:id/bank/{mcb,pdf}/preview` avec
`{ bankAccountId, fileName, contentBase64 }` renvoie :

```json
{
  "mcb": { "bankName": "…", "accountNumber": "…", "periodStart": "…", "periodEnd": "…", "currency": "MUR", "profileKey": "…" },
  "extraction": { "method": "pdf_text | ocr_pdf", "pageCount": 1, "warnings": [] },
  "source": { "fileName": "…", "sha256": "…", "sizeBytes": 1, "storedOnImport": true },
  "preview": { "…": "…" }
}
```

`import` exige `confirm: true` et renvoie `201` avec les compteurs `imported` et
`duplicates`. Codes ajoutés : `BANK_PDF_REQUIRED`, `BANK_MCB_PROFILE_UNRECOGNISED`,
`BANK_PDF_AMBIGUOUS` (les codes existants `BANK_IMPORT_BLOCKED` et
`BANK_DUPLICATE_IMPORT` restent utilisés).

## 6. Documents, accueil, bilingue et mobile

- **Documents** devient « consultation et archives » : recherche, historique, corrections,
  propositions, validation et archivage restent disponibles. Les entrées principales
  renvoient vers le journal des achats, le journal des ventes et le lecteur bancaire.
- **Accueil** : suppression des anciens blocs d’imports en tête ; la société et l’exercice
  restent visibles, six indicateurs essentiels, deux files d’attente (documents, écritures)
  et des accès rapides. Les cartes sont cliquables et accessibles au clavier.
- **Bilingue** : nouveaux libellés `home.*`, `nav.billing.dashboard`,
  `nav.billing.invoicesClients`, `journals.*`, `documents.archives.*`, `bank.pdf.*` en FR et
  EN, avec les mêmes clés. Le test de qualité i18n vérifie la parité.
- **Mobile** : groupes repliables, libellés qui ne débordent pas, défilement indépendant,
  cibles de 44 px, fermeture du tiroir après navigation.

## 7. Sécurité, permissions et isolation

- Aucun contournement des permissions : les routes API existantes vérifient toujours
  l’utilisateur, la société et le module ; le cabinet reste limité à ses sociétés.
- L’import bancaire vérifie que le compte appartient à la société active.
- Les noms de fichiers sont assainis et les chemins sont construits côté serveur ; aucun
  chemin fourni par le client n’est utilisé tel quel.
- Les limites d’upload existantes (taille, types MIME) restent en vigueur.
- Le PDF source est stocké hors du dossier public, avec un nom imprévisible (hash).
- Aucune écriture comptable n’est validée automatiquement ; le seul effet d’un import est un
  document, une proposition ou un brouillon.
- Aucun secret, identifiant MRA ou certificat n’est ajouté.

## 8. Tests et résultats

### Local, avant la PR

| Commande | Résultat |
|---|---|
| `npm run typecheck` | ✅ API + web |
| `npm test -w @mc/web` | ✅ **261/261**, 37 fichiers |
| `npm test -w @mc/api` | ✅ **477/477**, 11 tests PostgreSQL réels ignorés |
| `npm run build` | ✅ |
| `npm run build:demo` | ✅ |

La suite API complète a été exécutée sur PGlite ; la CI exécute en plus les tests contre un
vrai PostgreSQL et les migrations (application + ré-application idempotente).

### CI de la PR

- **CI** (`41267296581`, push) : ✅ `success` — typecheck/tests/build, PostgreSQL réel,
  migrations.
- **Demo (GitHub Pages)** (`41267296814`, push) : ✅ `success` — bundle construit et
  vérifications de contenu ; **déploiement sauté** car la branche n’est pas `main`.
- **CI de la PR** (`41267303766`) : ✅ `success` — PostgreSQL réel, migrations,
  typecheck/tests/build.
- **Demo de la PR** (`41267303714`) : bundle ✅, déploiement `skipping`.

La CI vérifie aussi que le bundle et la page publiée contiennent les libellés de navigation
et d’import de la mission 26, ainsi que « Documents — consultation et archives ».

### Tests ajoutés ou étendus

- `apps/web/tests/mission26-navigation.test.ts` : 5 tests purs sur la structure des groupes
  (8 groupes, ordre, Banque/États financiers en bas, routes, aucun doublon de route).
- `apps/web/tests/mission26-ui.test.tsx` : 6 tests de démonstration — import d’achat depuis
  le journal, liens d’import achats/ventes, facture de vente déjà créée sans OCR, relevé PDF
  avec métadonnées/revue/confirmation, fermeture du tiroir sur navigation avec query,
  accueil allégé.
- `apps/api/tests/mission23.test.ts` : profil MCB fictif, PDF générique fictif, conservation
  du hash et de `summary.source`, suggestion de nature non appliquée automatiquement.
- Tests web existants adaptés à la nouvelle navigation et aux nouveaux libellés.

## 9. Bugs réels trouvés par les tests

Les deux défauts ont été corrigés dans le code de production, pas dans les tests.

1. **Période d’un relevé PDF silencieusement ignorée.** Un `RegExp` construit à partir d’un
   fragment dynamique ne correspondait jamais à « Statement Period: 01 Jan 2026 to
   31 Jan 2026 ». Remplacé par une expression littérale couvrant `to`, `au`, `jusqu’au` et
   le tiret. `periodStart`/`periodEnd` sont désormais corrects.
2. **`summary.source` perdu à l’import bancaire.** Le JSON contenant le nom, le SHA‑256 et la
   clé de stockage était bien inséré, puis réécrit par l’`UPDATE` final qui ne conservait que
   les compteurs. Le résumé complet est maintenant calculé une fois (`summaryWithSource`) et
   utilisé dans l’`INSERT` **et** l’`UPDATE`.

## 10. Limites et éléments non livrés

- **Aucun test sur appareil physique** (Android Samsung, Chrome Windows) et **aucun E2E
  Playwright**. Les vérifications mobiles sont des tests DOM et des règles CSS.
- **Aucun relevé bancaire réel** : les PDF testés sont générés. Un vrai relevé peut avoir une
  mise en page, une police ou un scan différents ; le refus explicite est prévu, pas une
  reconnaissance universelle.
- **Aucun test JPEG** de facture ; le chemin image est couvert par un PNG.
- Les PDF scannés dépendent de la netteté du scan ; la reconstruction des colonnes peut être
  refusée.
- **Aucun envoi MRA**, aucune certification, aucun import du portail e-invoicing.
- **Aucun tableau des flux de trésorerie** : cet état n’existe pas encore ; il n’a pas été
  inventé.
- **Aucun connecteur bancaire** ni synchronisation automatique.
- Pas de dédoublonnage par empreinte visuelle de facture au-delà des contrôles existants.
- Les fichiers source orphelins après un échec d’import ne sont pas nettoyés
  automatiquement.
- Pas de nouvelle migration ; le schéma reste à **0021** et le schéma de démonstration à
  **17**.

## 11. Publication et fusion

- La PR **nº9** est **en brouillon**.
- **Aucune fusion** n’a été effectuée ; `main` reste à `ef20fde`.
- **Aucun déploiement Pages** n’a été déclenché depuis cette branche : le job de déploiement
  est explicitement sauté sur une branche Arena.
- La démo publique existante est celle de la mission 25, publiée depuis `main`
  (run `41265578405`, `success`) ; elle n’a pas été modifiée par cette mission.
- Le contrôle du contenu de la démo publique M25 est limité à la page servie et aux
  vérifications du workflow de publication ; aucun parcours visuel après connexion n’a été
  automatisé.

**Consigne maintenue** : ne pas fusionner cette PR sans autorisation explicite, ne pas
publier la démo depuis la branche, ne pas modifier `main`.

## 12. Fichiers principaux

| Fichier | Rôle |
|---|---|
| `apps/web/src/navigation.ts` | définition des 8 groupes et des entrées |
| `apps/web/src/App.tsx` | sidebar repliable, groupe actif, tiroir mobile, routes |
| `apps/web/src/pages/Entries.tsx` | journaux paramétrés et actions d’import |
| `apps/web/src/pages/accounting/Purchases.tsx` | import d’achat depuis le journal |
| `apps/web/src/pages/accounting/BankMcb.tsx` | lecteur PDF MCB et générique |
| `apps/web/src/pages/documents/ScanImport.tsx` | import de facture, reprise d’une facture de vente |
| `apps/web/src/pages/billing/Documents.tsx` | archive et points d’entrée |
| `apps/web/src/pages/cabinet/CabinetDashboard.tsx` | accueil allégé |
| `apps/api/src/modules/bank/{mcb,profiles,engine,service,routes}.ts` | lecture, métadonnées, import, conservation du source |
| `apps/api/src/lib/errors.ts` | codes PDF |
| `apps/api/tests/mission23.test.ts` | fixtures PDF génériques, OCR, source |
| `apps/web/tests/mission26-{navigation,ui}.test.*` | navigation et parcours de démonstration |
| `.github/workflows/pages.yml` | contrôles de contenu du bundle et de la page publiée |
