# Mission 27 — import direct depuis le Journal de banque

**Date** : 1er novembre 2026  
**Version** : 0.1.1  
**Branche** : `arena/156cf2d7-mauritius-compta`  
**Base** : `6a1a360` (`main`, mission 26 fusionnée)  
**Commit de code** : `d726692`  
**Pull request** : **nº10, brouillon** — <https://github.com/azharshahim/mauritius-compta/pull/10>  
**État** : livrée en brouillon ; **non fusionnée**, **non publiée**, `main` inchangée.

## 1. Résultat

Le Journal de banque dispose maintenant des deux actions principales demandées :

- **Importer un relevé bancaire** ;
- **Ajouter une écriture**.

L’import ouvre le module bancaire existant, sur l’onglet d’import, avec la société active et
le choix du compte. Les formats déjà pris en charge restent les seuls proposés : **CSV,
TSV/TXT, XLSX** par le sélecteur de fichier, **PDF** par le lecteur de relevés existant. Aucun
second moteur d’extraction n’a été créé.

Après confirmation, l’utilisateur voit trois liens contextuels :

1. **Voir les opérations importées** ;
2. **Préparer le rapprochement bancaire** ;
3. **Retour au Journal de banque**.

Les liens conservent le compte bancaire dans l’URL lorsqu’il est connu. Aucun import ne crée
d’écriture comptable.

## 2. Les points de la mission

| Point | Livraison |
|---|---|
| Bouton dans le Journal de banque | lien vers l’onglet d’import, à côté de « Ajouter une écriture » |
| Priorité à l’import existant | même page Banque, même API, même moteur PDF/OCR |
| Société active | aucune société n’est recréée ou changée ; le module reste borné à la session |
| Choix du compte | sélecteur existant, compte transmis par `bankAccountId` après import |
| PDF, CSV, TSV, XLSX | PDF via le lecteur, les trois formats tabulaires via le sélecteur |
| Prévisualisation | date, libellé, référence, débit, crédit, solde, devise, statut |
| Avertissements | compteurs et liste détaillée ouverte, contrôles bloquants conservés |
| Revue humaine | case obligatoire et confirmation explicite |
| Retour au journal | lien direct, sans perte de la société ni du compte |
| Distinction transaction / écriture | encart après import + état vide explicite du journal |

## 3. Parcours

### Depuis le journal

`/accounting/journals/bank` affiche :

- `⇪ Importer un relevé bancaire` ;
- `+ Ajouter une écriture`.

Le premier lien ouvre :

```text
/accounting/banking?tab=import&returnTo=%2Faccounting%2Fjournals%2Fbank
```

La page Banque applique réellement `tab=import` et affiche le compte de la société. Le second
ouvre l’éditeur d’écriture existant, avec le journal de banque présélectionné.

### Import CSV / TSV / XLSX

1. Choix du compte bancaire.
2. Sélection du fichier.
3. Analyse et prévisualisation.
4. Vérification humaine.
5. Confirmation.
6. Les transactions sont stockées dans le module bancaire ; **aucune écriture n’est créée**.

### Import PDF

Le bouton **Importer un relevé PDF** de l’onglet d’import ouvre le lecteur PDF/OCR existant.
Le compte et le chemin de retour sont transmis. Le parcours de prévisualisation, de revue et
de conservation du PDF source est celui des missions 23 et 26.

## 4. Les trois états restent distincts

| État | Où | Ce qui est créé |
|---|---|---|
| 1. Opérations importées | Banque et trésorerie | des transactions bancaires, pas des écritures |
| 2. Écritures proposées | Banque, propositions et rapprochement | des suggestions modifiables, jamais appliquées seules |
| 3. Écritures comptables | Journal, après action humaine | un brouillon ou une écriture validée selon le contrôle comptable existant |

L’encart de fin d’import dit explicitement :

> Aucune écriture comptable n’a été créée. Vérifiez les opérations, préparez le
> rapprochement, puis comptabilisez uniquement après validation humaine.

Lorsqu’un journal de banque est vide, il n’affiche plus seulement « aucune écriture » : il
explique que les opérations d’un relevé ne sont pas des écritures comptables et propose :

- voir les opérations importées ;
- importer un relevé.

## 5. Prévisualisation

Le tableau de l’import tabulaire montre désormais :

- date ;
- libellé et suggestion éventuelle ;
- référence ;
- **débit** ;
- **crédit** ;
- **solde** ;
- **devise** ;
- statut « À importer » ou « Doublon ».

Les avertissements et contrôles bloquants restent listés avec leur code et leur ligne. Le
lecteur PDF affiche en plus la date de valeur ; sa devise est reprise par transaction lorsqu’elle
est fournie, sinon celle du relevé.

## 6. Navigation et contexte

- Les paramètres `tab`, `bankAccountId` et `returnTo` sont lus par la page Banque.
- Changer d’onglet met l’URL à jour ; un lien direct vers `?tab=transactions` ou `?tab=report`
  fonctionne au chargement.
- Le compte choisi est ajouté aux liens de retour et d’action.
- `returnTo` n’est accepté que s’il commence par `/accounting/journals/` ; sinon le retour par
  défaut est `/accounting/journals/bank`. Aucune redirection externe n’est possible.
- Le retour au journal conserve la société active de la session.

### Défaut corrigé de la mission 26

Les liens de navigation de la mission 26 contenaient déjà `?tab=import`, `?tab=transactions`
et `?tab=report`, mais `BankPage` démarrait toujours sur l’onglet **Comptes** : le paramètre
n’était jamais lu. La mission 27 corrige ce défaut, nécessaire pour que le bouton du journal
ouvre réellement l’import.

## 7. Ergonomie et responsive

- Le groupe d’actions du journal utilise les boutons et styles existants.
- À partir de 640 px, les boutons du journal et les liens de fin d’import passent sur toute
  la largeur et leur libellé peut revenir à la ligne : pas de débordement horizontal.
- Les cibles tactiles de 44 px de la feuille de styles mobile restent appliquées.
- Les tableaux de prévisualisation restent dans un conteneur à défilement horizontal local,
  sans élargir la page.
- Libellés FR/EN ajoutés pour les nouveaux boutons, l’encart de fin d’import et l’état vide.
- Les états de chargement, d’erreur et de confirmation existants sont réutilisés.

Aucune refonte graphique générale n’a été entreprise.

## 8. Sécurité et intégrité

Aucun changement de contrat API, de permission ou de schéma.

- L’import reste limité à la société active et vérifie l’appartenance du compte bancaire.
- Les contrôles de formats, de taille et de contenu existants restent en place.
- Les doublons sont détectés par le moteur existant.
- Le PDF source et son empreinte sont conservés comme en mission 26.
- Les soldes et colonnes ambiguës bloquent toujours l’import.
- Aucune écriture comptable n’est créée par l’import.
- Aucune donnée bancaire réelle n’est ajoutée au dépôt ou à la démonstration.
- Le paramètre de retour est restreint aux chemins de journaux internes.

## 9. Tests

### Tests ciblés ajoutés

`apps/web/tests/mission27-bank-journal.test.tsx` — **6 tests** :

1. le bouton apparaît dans le journal de banque et **pas** dans les journaux achats, ventes et
   opérations diverses ;
2. l’ouverture conserve la société, sélectionne un compte et expose les formats réels
   (CSV/TSV/TXT/XLSX, PDF via le lecteur) ;
3. l’import fictif ne crée aucune écriture comptable, augmente les transactions bancaires et
   affiche les trois liens ;
4. le journal vide affiche l’explication et les liens, tandis que le journal général garde son
   état vide standard ;
5. le parcours PDF confirmé propose le retour au journal avec le compte ;
6. les libellés anglais du bouton, de l’ajout d’écriture et de l’onglet d’import sont présents.

### Résultats locaux

| Commande | Résultat |
|---|---|
| `npm run typecheck` | ✅ API + web |
| `npm test -w @mc/web` | ✅ **267/267**, 38 fichiers |
| `npm run build` | ✅ |
| `npm run build:demo` | ✅ |
| greps du workflow sur le bundle démo | ✅ `Import bank statement`, `Retour au Journal de banque` |

Les tests API n’ont pas été modifiés : aucun contrat serveur n’a changé. La CI les exécute
néanmoins contre un PostgreSQL réel.

## 10. CI

| Workflow | Run | Résultat |
|---|---|---|
| CI (push) | `41270265006` | ✅ succès — typecheck, tests, build, PostgreSQL, migrations |
| Demo (push) | `41270265022` | ✅ build, déploiement **skipping** |
| CI (PR) | `41270362883` | ✅ succès |
| Demo (PR) | `41270362894` | ✅ build, déploiement **skipping** |

La CI a été exécutée sur `d726692`. Le commit de documentation qui suit ne change aucun code
applicatif.

## 11. Limites et non-livrés

- **Aucun test sur appareil physique** Android/iPhone, Windows ou Mac ; aucun E2E navigateur.
  Le responsive est vérifié par les feuilles de style et les tests DOM, pas par un appareil.
- **Aucun relevé bancaire réel** : la démonstration utilise le fichier fictif
  `releve-bancaire-fictif.csv` et un PDF de démonstration.
- Le PDF est importé par le lecteur PDF, pas par le sélecteur CSV : le bouton du journal ouvre
  l’onglet d’import qui expose les deux chemins. Il n’y a volontairement qu’un seul moteur.
- Aucun test de qualité de scan réel, aucun OCR de reçu manuscrit.
- Aucun envoi MRA, aucune modification des règles fiscales, de la paie, d’OVH ou des autres
  projets.
- Aucune dépendance et aucune migration ajoutées.
- Aucune écriture comptable automatique, aucun tableau des flux de trésorerie.

## 12. Publication et fusion

- PR **nº10** en **brouillon**.
- **Aucune fusion**, `main` reste à `6a1a360`.
- Aucun déploiement GitHub Pages depuis la branche : le job est `skipping`.
- La démo publique de `main` n’a pas été modifiée.

**Consigne** : ne pas fusionner, ne pas publier et ne pas modifier `main` sans autorisation
explicite.

## 13. Fichiers modifiés

| Fichier | Changement |
|---|---|
| `apps/web/src/pages/Entries.tsx` | bouton d’import du journal de banque, état vide explicatif |
| `apps/web/src/pages/accounting/Bank.tsx` | onglet et compte depuis l’URL, prévisualisation enrichie, encart de retour |
| `apps/web/src/pages/accounting/BankMcb.tsx` | compte initial, trois liens de retour après import PDF |
| `apps/web/src/i18n.tsx` | libellés FR/EN des boutons, retours et état vide |
| `apps/web/src/styles.css` | actions de l’en-tête et liens de retour responsives |
| `.github/workflows/pages.yml` | contrôles de contenu du bundle et de la page publiée |
| `apps/web/tests/mission27-bank-journal.test.tsx` | 6 tests ciblés de démonstration |
| `README.md`, `CHANGELOG.md` | documentation de la mission |
